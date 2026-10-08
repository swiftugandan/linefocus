/** The Linefocus application: wires the design store, the engine worker, the canvas, the inspector, the results
 * dock and the shell together. window.linefocus exposes it for scripting and browser tests. */

import { DesignStore } from './core/history.js';
import { defaultDesign, parseDesign, serializeDesign, switchVariant, APP_VERSION } from './core/model.js';
import { buildDesignScene } from './core/design-scene.js';
import { handlesFor, sunArc } from './core/handles.js';
import { toRayOptics } from './core/rayoptics.js';
import { CrossSectionView, RAY_STYLES } from './render/view.js';
import { EngineClient } from './worker/client.js';
import { Inspector } from './ui/inspector.js';
import { installCanvasInteractions } from './ui/canvas-interactions.js';
import { designPointView, ledgerShares, concentrationProfile } from './ui/design-point-view.js';
import { acceptanceView, incidenceView, dayView, yearView } from './ui/study-views.js';
import { parseEpw } from './core/solar.js';
import { Persistence } from './ui/persistence.js';
import { Commands, Ribbon, Toasts, Dialogs, installTooltips } from './ui/shell.js';
import { byId, h, fmt, pct, debounce, downloadBlob, fileName } from './ui/dom.js';
import { hydrateIcons } from './ui/icons.js';

/** @import { Design, CollectorType } from './core/model.js' */
/** @import { DesignPointResult, AcceptanceJobResult, AnnualResult } from './worker/protocol.js' */
/** @import { StudyState } from './ui/study-views.js' */
/** @import { OpticalScene } from './core/types.js' */
/** @import { Figure } from './core/design-scene.js' */
/** @import { ChangeDetail } from './core/history.js' */
/** @import { RibbonTab } from './ui/shell.js' */

const PREVIEW_RAYS = 8192;
const PREVIEW_PATHS = 260;
const FULL_PATHS = 520;
const COLLECTOR_NAMES = { trough: 'Parabolic trough', fresnel: 'Linear Fresnel', cpc: 'Compound parabolic' };

/** @param {string} key @returns {string | null} */
function readPref(key) { try { return localStorage.getItem(key); } catch { return null; } }
/** @param {string} key @param {string} value */
function writePref(key, value) { try { localStorage.setItem(key, value); } catch { /* preferences are optional */ } }

export class LinefocusApp {
  /** @param {Worker} worker */
  constructor(worker) {
    this.ready = false;
    this.version = APP_VERSION;
    this.engine = new EngineClient(worker);
    this.persistence = new Persistence();
    this.toasts = new Toasts();
    this.dialogs = new Dialogs();
    this.commands = new Commands();
    this.root = byId('app');
    this.view = new CrossSectionView(/** @type {HTMLCanvasElement} */ (byId('view')));
    /** @type {DesignStore} */
    this.store = new DesignStore(defaultDesign());
    /** @type {DesignPointResult | null} */
    this.result = null;
    /** @type {string | null} */
    this.error = null;
    this.running = false;
    /** Revision of the design the current result belongs to. */
    this.resultRevision = -1;
    /** @type {Figure[]} */
    this.figures = [];
    /** @type {OpticalScene | null} */
    this.scene = null;
    this.saveState = 'saved';
    /** @type {StudyId} */
    this.study = 'design-point';
    /** @type {{ result: AcceptanceJobResult | null, revision: number, state: StudyState }} */
    this.acceptance = { result: null, revision: -1, state: { running: false, progress: null, error: null, stale: false } };
    /** @type {{ result: AnnualResult | null, revision: number, state: StudyState }} */
    this.annual = { result: null, revision: -1, state: { running: false, progress: null, error: null, stale: false } };
    this.scheduleStudies = debounce(() => this.runStudies(), 350);
    this.fitScale = 0;
    this.inspector = new Inspector(byId('inspectorBody'), { store: this.store, onError: message => this.toasts.show(message, { kind: 'error' }), figures: () => this.figures });
    this.ribbon = new Ribbon({ tabs: byId('tabs'), ribbon: byId('ribbon'), commands: this.commands, layout: this.ribbonLayout(), onShow: () => this.setPanel('ribbon', true) });
    this.autosave = debounce(() => this.save(), 450);
    this.previewTrace = debounce(() => this.trace('preview'), 0);
    this.fullTrace = debounce(() => this.trace('full'), 180);
  }

  async start() {
    installTooltips();
    this.applyTheme(readPref('linefocus-theme'));
    if (window.innerWidth <= 720) { this.root.dataset.studies = 'closed'; this.root.dataset.inspector = 'closed'; }
    else if (window.innerWidth <= 980) this.root.dataset.inspector = 'closed';
    const dock = Number(readPref('linefocus-dock'));
    if (dock > 0) this.root.style.setProperty('--dock-height', `${dock}px`);
    this.registerCommands();
    this.commands.onRun = () => this.ribbon.refresh();
    this.ribbon.render();
    hydrateIcons(document.body);
    try {
      const saved = await this.persistence.load();
      if (saved) this.store.replace(saved);
    } catch (error) {
      this.toasts.show(`The saved design could not be opened (${error instanceof Error ? error.message : error}). Starting a new one.`, { kind: 'error', ms: 8000 });
    }
    this.store.addEventListener('change', event => this.onChange(/** @type {CustomEvent<ChangeDetail>} */ (event).detail));
    installCanvasInteractions({
      view: this.view, viewport: byId('viewport'), tooltip: byId('viewTooltip'), store: this.store,
      onError: message => this.toasts.show(message, { kind: 'error' }), onZoom: () => this.updateZoom(),
    });
    this.installKeyboard();
    this.installSplitter();
    this.installFileDrop();
    new ResizeObserver(() => { this.view.resize(); if (!this.view.fitted) this.fitView(); }).observe(byId('viewport'));
    new ResizeObserver(debounce(() => this.renderDock(), 60)).observe(byId('dock'));
    window.addEventListener('beforeunload', e => { if (this.saveState !== 'saved') e.preventDefault(); });
    this.rebuildScene();
    this.renderAll();
    this.view.resize();
    this.fitView();
    await this.trace('full');
    this.ready = true;
  }

  // ---------- Design changes ----------

  /** @param {ChangeDetail} detail */
  onChange(detail) {
    this.rebuildScene();
    for (const slot of [this.acceptance, this.annual]) slot.state = { ...slot.state, stale: slot.result !== null };
    if (detail.kind === 'preview') {
      this.inspector.refreshValues();
      this.previewTrace();
      return;
    }
    if (detail.kind === 'rollback') {
      // The design is back to its committed state; only a cancelled drag left stale values on screen.
      this.inspector.refreshValues(true);
      this.trace('preview').then(() => this.fullTrace());
      return;
    }
    this.renderAll();
    if (detail.kind === 'load') this.fitView();
    this.saveState = 'pending';
    this.renderSaveState();
    this.autosave();
    this.setStatus(detail.kind === 'undo' ? `Undid ${detail.label.toLowerCase()}` : detail.kind === 'redo' ? `Redid ${detail.label.toLowerCase()}` : detail.kind === 'load' ? 'Design opened' : detail.label);
    this.trace('preview').then(() => this.fullTrace());
  }

  /** Builds the scene on the main thread so geometry follows a drag immediately. */
  rebuildScene() {
    try {
      const { scene, figures } = buildDesignScene(this.store.design);
      this.scene = scene;
      this.figures = figures;
      this.error = null;
    } catch (error) {
      this.scene = null;
      this.figures = [];
      this.error = error instanceof Error ? error.message : String(error);
    }
    this.view.scene = this.scene;
    this.view.handles = this.scene ? handlesFor(this.store.design, this.scene) : [];
    this.view.sunArc = this.scene ? sunArc(this.scene) : null;
    this.view.request();
  }

  /**
   * Traces the design point. A preview uses few rays for instant feedback; a full trace uses the design's ray count.
   * @param {'preview' | 'full'} quality
   */
  async trace(quality) {
    if (!this.scene) { this.result = null; this.renderResults(); return; }
    const design = structuredClone(this.store.design);
    const revision = this.store.revision;
    const rays = quality === 'preview' ? Math.min(PREVIEW_RAYS, design.simulation.rays) : design.simulation.rays;
    this.running = true;
    this.renderTraceState(quality === 'full' ? 0 : null);
    try {
      const result = await this.engine.designPoint(design, {
        rays, pathCount: quality === 'preview' ? PREVIEW_PATHS : FULL_PATHS,
        onProgress: (done, total) => this.renderTraceState(done / total),
      });
      if (!result) return;
      this.result = result;
      this.resultRevision = revision;
      this.error = null;
      this.running = quality === 'preview';
    } catch (error) {
      this.result = null;
      this.error = error instanceof Error ? error.message : String(error);
      this.running = false;
    }
    this.view.trace = this.result?.trace ?? null;
    this.view.request();
    this.renderResults();
    if (quality === 'full' && this.result && this.resultRevision === this.store.revision) this.scheduleStudies();
  }

  /** Runs the acceptance and annual studies for the current design, one after the other. */
  async runStudies() {
    if (!this.scene) return;
    const design = structuredClone(this.store.design);
    const revision = this.store.revision;
    /**
     * @template T
     * @param {{ revision: number, state: StudyState }} slot @param {() => Promise<T | null>} run @param {(result: T) => void} keep
     */
    const runOne = async (slot, run, keep) => {
      slot.state = { ...slot.state, running: true, progress: 0, error: null };
      this.renderStudyChrome();
      try {
        const result = await run();
        if (!result) return false;
        keep(result);
        slot.revision = revision;
        slot.state = { running: false, progress: null, error: null, stale: revision !== this.store.revision };
      } catch (error) {
        slot.state = { running: false, progress: null, error: error instanceof Error ? error.message : String(error), stale: false };
      }
      this.renderStudyChrome();
      return true;
    };
    /** @param {{ state: StudyState }} slot */
    const progress = slot => (/** @type {number} */ done, /** @type {number} */ total) => { slot.state = { ...slot.state, progress: done / total }; this.renderStudyChrome(); };
    if (!(await runOne(this.acceptance, () => this.engine.acceptance(design, progress(this.acceptance)), r => { this.acceptance.result = r; }))) return;
    await runOne(this.annual, () => this.engine.annual(design, progress(this.annual)), r => { this.annual.result = r; });
  }

  /** Refreshes the study list and, when a study is showing, the dock. */
  renderStudyChrome() {
    this.renderStudies();
    if (this.study !== 'design-point') this.renderDock();
  }

  // ---------- Rendering ----------

  renderAll() {
    this.inspector.render();
    this.ribbon.refresh();
    this.renderTitle();
    this.renderBreadcrumb();
    this.renderLegend();
    this.renderResults();
    this.renderSaveState();
    this.updateUndoTips();
  }

  renderResults() {
    this.renderStudies();
    this.renderDock();
    this.renderTraceState(null);
    const t = this.result?.trace;
    byId('statusRays').textContent = t && this.result ? `${fmt(t.rays, 0)} rays in ${fmt(this.result.elapsedMs / 1000, 2)} s` : '';
  }

  renderDock() {
    const dock = byId('dock');
    const wide = window.innerWidth > 1280;
    const width = Math.floor((dock.clientWidth - 36 - (wide ? 18 : 0)) / (wide ? 2 : 1));
    // Study views put a 220 px column of tiles beside one chart.
    const studyWidth = window.innerWidth > 720 ? dock.clientWidth - 36 - 238 : dock.clientWidth - 36;
    const design = this.store.design;
    const scroll = dock.scrollTop;
    /** @type {HTMLElement} */
    let view;
    if (this.study === 'acceptance') view = acceptanceView({ result: this.acceptance.result, state: this.acceptance.state, width: studyWidth });
    else if (this.study === 'incidence') view = incidenceView({ design, scene: this.scene, result: this.annual.result, state: this.annual.state, width: studyWidth });
    else if (this.study === 'day') view = dayView({ result: this.annual.result, state: this.annual.state, width: studyWidth });
    else if (this.study === 'year') view = yearView({ design, result: this.annual.result, state: this.annual.state, width: studyWidth });
    else view = designPointView({ design, result: this.result, error: this.error, running: this.running, width });
    dock.replaceChildren(view);
    dock.scrollTop = scroll;
  }

  /** @param {StudyId} study */
  showStudy(study) {
    this.study = study;
    this.renderStudies();
    this.renderDock();
    this.ribbon.refresh();
  }

  renderStudies() {
    const t = this.result?.trace;
    const a = this.acceptance.result?.acceptance;
    const annual = this.annual.result;
    /** @param {StudyState} st */
    const stateOf = st => (st.error ? ['error', 'Needs attention'] : st.running ? ['running', st.progress !== null && st.progress > 0 ? `${Math.round(st.progress * 100)}%` : 'Running'] : st.stale ? ['stale', 'Updating'] : ['done', 'Up to date']);
    const dp = /** @type {StudyState} */ ({ running: this.running, progress: null, error: this.error, stale: false });
    const eta0 = annual ? annual.grid.eta[0][0] : 0;
    /** @type {[StudyId, string, StudyState, (string | Node)[], string][]} */
    const items = [
      ['design-point', 'Design point', dp, t ? [pct(t.efficiency, 1), h('small', { text: 'optical efficiency' })] : ['–'], t ? `Intercept factor ${fmt(t.intercept, 3)}` : 'No trace yet'],
      ['acceptance', 'Acceptance', this.acceptance.state, a && a.halfAngle90 !== null ? [`±${fmt(a.halfAngle90, a.halfAngle90 < 1 ? 2 : 1)}°`, h('small', { text: 'at 90%' })] : ['–'], a ? `Concentration × acceptance ${a.cap90 === null ? '–' : fmt(a.cap90, 2)}` : 'Tolerance to misalignment'],
      ['incidence', 'Incidence angle', this.annual.state, annual ? [fmt(eta0 > 0 ? (annual.grid.tracking ? annual.grid.eta[0][annual.grid.longitudinal.indexOf(45)] : annual.grid.eta[annual.grid.transversal.indexOf(45)][0]) / eta0 : 0, 3), h('small', { text: 'modifier at 45°' })] : ['–'], 'Efficiency against sun angle'],
      ['day', 'Day', this.annual.state, annual ? [fmt(annual.days[1].energy / 1000, 1), h('small', { text: 'kWh/m on 21 June' })] : ['–'], annual ? `21 December: ${fmt(annual.days[3].energy / 1000, 1)} kWh/m` : 'Equinoxes and solstices'],
      ['year', 'Year', this.annual.state, annual ? [fmt(annual.year.perArea, 0), h('small', { text: 'kWh/m² a year' })] : ['–'], annual ? (this.store.design.weather.source === 'clear-sky' ? 'Clear sky, an upper bound' : annual.year.source) : 'Energy over a year'],
    ];
    byId('studyList').replaceChildren(...items.map(([id, name, st, value, sub]) => {
      const [code, label] = stateOf(st);
      const item = h('button', { class: 'study', type: 'button', 'aria-current': String(this.study === id), 'data-study': id }, [
        h('span', { class: 'study-name', text: name }),
        h('span', { class: 'study-state', 'data-state': code, text: label }),
        h('span', { class: 'study-value' }, value),
        h('span', { class: 'study-sub', text: sub }),
      ]);
      item.addEventListener('click', () => this.showStudy(id));
      return item;
    }));
    byId('studiesFoot').replaceChildren(h('strong', { text: 'Traced in your browser' }), 'Every ray runs on this computer. Nothing is uploaded.');
  }

  /** @param {number | null} progress */
  renderTraceState(progress) {
    const el = byId('traceState');
    if (this.error) { el.dataset.state = 'error'; el.textContent = 'Cannot trace this design'; return; }
    if (this.running) { el.dataset.state = 'running'; el.textContent = progress !== null ? `Tracing ${Math.round(progress * 100)}%` : 'Refining…'; return; }
    el.dataset.state = '';
    el.textContent = this.result ? `${fmt(this.result.trace.rays / 1000, 0)}k rays` : '';
  }

  renderTitle() {
    const title = this.store.design.title || 'Untitled';
    byId('docTitle').textContent = title;
    document.title = `${title} — Linefocus`;
  }

  renderBreadcrumb() {
    const d = this.store.design;
    byId('breadcrumb').replaceChildren(h('strong', { text: COLLECTOR_NAMES[d.collector.type] }), h('span', { class: 'sep', text: '/' }), 'Cross-section');
  }

  renderLegend() {
    const entries = [['Absorbed', RAY_STYLES.absorbed.colour], ['Spilled', RAY_STYLES.spillage.colour], ['Reflected by glass', RAY_STYLES.glassReflection.colour]];
    byId('viewLegend').replaceChildren(...entries.map(([label, colour]) => h('span', {}, [h('i', { style: `background: rgb(${colour})` }), label])));
    byId('viewHint').textContent = 'Drag the handles or the sun. Scroll to zoom.';
  }

  renderSaveState() {
    const el = byId('saveState');
    el.dataset.state = this.saveState;
    el.textContent = this.saveState === 'saved' ? 'Saved on this device' : this.saveState === 'pending' ? 'Saving…' : 'Not saved. Download a copy';
  }

  updateUndoTips() {
    const undo = document.querySelector('.titlebar [data-cmd="undo"]'), redo = document.querySelector('.titlebar [data-cmd="redo"]');
    undo?.setAttribute('data-tip', this.store.canUndo ? `Undo ${this.store.undoLabel.toLowerCase()} (Ctrl+Z)` : 'Nothing to undo');
    redo?.setAttribute('data-tip', this.store.canRedo ? `Redo ${this.store.redoLabel.toLowerCase()} (Ctrl+Shift+Z)` : 'Nothing to redo');
  }

  fitView() {
    this.view.fit();
    this.fitScale = this.view.camera.scale;
    this.updateZoom();
  }

  /** Zoom relative to the fitted view, and a scale bar of a round length near 110 px. */
  updateZoom() {
    const scale = this.view.camera.scale;
    byId('zoomLabel').textContent = `${fmt((scale / (this.fitScale || scale)) * 100, 0)}%`;
    const target = 110 / scale;
    const p = 10 ** Math.floor(Math.log10(target));
    const length = [1, 2, 5, 10].map(m => m * p).reduce((best, v) => (Math.abs(v - target) < Math.abs(best - target) ? v : best));
    const bar = byId('scaleBar');
    /** @type {HTMLElement} */ (bar.querySelector('i')).style.width = `${length * scale}px`;
    /** @type {HTMLElement} */ (bar.querySelector('span')).textContent = length >= 1 ? `${fmt(length, 0)} m` : length >= 0.01 ? `${fmt(length * 100, 0)} cm` : `${fmt(length * 1000, length >= 0.001 ? 0 : 1)} mm`;
  }

  /** @param {string} message */
  setStatus(message) { byId('statusMessage').textContent = message; }

  /** @param {'ribbon' | 'studies' | 'inspector'} panel @param {boolean} [open] */
  setPanel(panel, open) {
    const next = open ?? this.root.dataset[panel] !== 'open';
    this.root.dataset[panel] = next ? 'open' : 'closed';
    if (panel === 'ribbon') {
      const toggle = document.querySelector('.ribbon-toggle');
      toggle?.setAttribute('aria-pressed', String(next));
      toggle?.setAttribute('data-tip', next ? 'Hide the ribbon' : 'Show the ribbon');
    }
    this.ribbon.refresh();
    requestAnimationFrame(() => this.view.resize());
  }

  /** @param {string | null} theme */
  applyTheme(theme) {
    const dark = theme ? theme === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  }

  // ---------- Files ----------

  async save() {
    try {
      await this.persistence.save(this.store.design);
      this.saveState = 'saved';
    } catch {
      this.saveState = 'error';
      this.toasts.show('This browser could not store the design. Download a copy to keep your work.', { kind: 'error', action: { label: 'Download', run: () => this.download() }, ms: 9000 });
    }
    this.renderSaveState();
  }

  download() {
    const d = this.store.design;
    downloadBlob(fileName(d.title, '.linefocus.json'), new Blob([serializeDesign(d)], { type: 'application/json' }));
    this.setStatus('Design downloaded');
  }

  /** Asks before replacing the current design, which is the only one kept in the browser. */
  async confirmReplace() {
    const choice = await this.dialogs.open({
      title: 'Replace the current design?',
      body: [h('p', { text: `“${this.store.design.title}” is kept only in this browser. Download a copy first if you want to keep it.` })],
      actions: [{ label: 'Cancel', value: '' }, { label: 'Download first', value: 'download' }, { label: 'Replace', value: 'replace', primary: true }],
    });
    if (choice === 'download') { this.download(); return true; }
    return choice === 'replace';
  }

  /** @param {CollectorType} type */
  async newDesign(type) {
    if (!(await this.confirmReplace())) return;
    const design = defaultDesign();
    switchVariant(design, 'collector', type);
    design.title = `Untitled ${COLLECTOR_NAMES[type].toLowerCase()}`;
    this.store.replace(design);
  }

  /** @param {File} file */
  async openFile(file) {
    try {
      const design = parseDesign(await file.text());
      if (!(await this.confirmReplace())) return;
      this.store.replace(design);
      this.toasts.show(`Opened “${design.title}”`);
    } catch (error) {
      this.toasts.show(`${file.name} could not be opened. ${error instanceof Error ? error.message : error}`, { kind: 'error', ms: 8000 });
    }
  }

  exportRayOptics() {
    if (!this.scene) return;
    const d = this.store.design;
    const { json, skipped } = toRayOptics(this.scene, { sun: d.sun, transversalDeg: d.designPoint.transversalDeg, name: d.title, rayDensity: 0.25 });
    downloadBlob(fileName(d.title, '.rayoptics.json'), new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' }));
    const note = skipped.length ? ` Ray Optics has no thin glass, so ${skipped.join(', ').toLowerCase()} ${skipped.length > 1 ? 'are' : 'is'} left out.` : '';
    this.toasts.show(`Downloaded the scene. In Ray Optics, choose File, then Open, and pick it.${note}`, { action: { label: 'Open Ray Optics', run: () => window.open('https://phydemo.app/ray-optics/simulator/', '_blank', 'noopener') }, ms: 9000 });
  }

  exportCsv() {
    if (!this.result) return;
    const t = this.result.trace, d = this.store.design;
    const lines = ['section,item,value,unit'];
    lines.push(`summary,optical efficiency,${t.efficiency},fraction`, `summary,intercept factor,${t.intercept},fraction`, `summary,absorbed,${t.ledger.absorbed},W/m`, `summary,reference power,${t.reference},W/m`, `summary,rays,${t.rays},`);
    for (const row of ledgerShares(this.result)) lines.push(`ledger,${row.label},${row.share},fraction of reference`);
    const map = t.flux[0];
    const absorber = this.result.scene.surfaces.find(s => s.id === map?.surfaceId);
    if (map) for (const [x, c] of concentrationProfile(map, d.designPoint.dni, absorber?.shape.kind === 'circle' ? absorber.shape.r : 0)) lines.push(`flux,${x},${c},${map.kind === 'angle' ? 'degrees; local concentration' : 'mm; local concentration'}`);
    downloadBlob(fileName(d.title, ' results.csv'), new Blob([lines.join('\n') + '\n'], { type: 'text/csv' }));
  }

  exportImage() {
    this.view.draw();
    this.view.canvas.toBlob(blob => { if (blob) downloadBlob(fileName(this.store.design.title, ' cross-section.png'), blob); }, 'image/png');
  }

  // ---------- Commands ----------

  registerCommands() {
    const d = () => this.store.design;
    /** @param {string} label @param {(design: Design) => void} mutate */
    const edit = (label, mutate) => { try { this.store.transact(label, mutate); } catch (e) { this.toasts.show(e instanceof Error ? e.message : String(e), { kind: 'error' }); } };
    /** @param {CollectorType} type */
    const collector = type => ({ id: `collector-${type}`, label: COLLECTOR_NAMES[type], icon: type, hint: type === 'trough' ? 'Make this a parabolic trough' : `${COLLECTOR_NAMES[type]} collectors are on the way`, enabled: () => type === 'trough', pressed: () => d().collector.type === type, run: () => { if (d().collector.type !== type) edit(`Use ${COLLECTOR_NAMES[type].toLowerCase()}`, x => switchVariant(x, 'collector', type)); } });
    /** @param {number} rays @param {string} label */
    const quality = (rays, label) => ({ id: `rays-${rays}`, label, icon: 'rays', hint: `${fmt(rays, 0)} rays per trace`, pressed: () => d().simulation.rays === rays, run: () => edit(`Use ${label.toLowerCase()} quality`, x => { x.simulation.rays = rays; }) });
    /** @param {'showRays' | 'showMissed' | 'showFlux'} key */
    const viewToggle = key => () => { this.view[key] = !this.view[key]; this.view.request(); this.ribbon.refresh(); };
    this.commands.register([
      { id: 'new-trough', label: 'New trough', icon: 'trough', run: () => this.newDesign('trough') },
      { id: 'new-fresnel', label: 'New linear Fresnel', icon: 'fresnel', enabled: () => false, hint: 'Linear Fresnel collectors are on the way', run: () => this.newDesign('fresnel') },
      { id: 'new-cpc', label: 'New CPC', icon: 'cpc', enabled: () => false, hint: 'CPC collectors are on the way', run: () => this.newDesign('cpc') },
      { id: 'open', label: 'Open design', icon: 'open', shortcut: 'Ctrl+O', run: () => byId('fileInput').click() },
      { id: 'save', label: 'Download design', icon: 'download', shortcut: 'Ctrl+S', run: () => this.download() },
      { id: 'rename', label: 'Rename design', icon: 'new', palette: true, run: async () => { const name = await this.dialogs.prompt('Rename design', 'Title', d().title); if (name !== null) edit('Rename design', x => { x.title = name.trim().slice(0, 160) || 'Untitled'; }); } },
      { id: 'export-ray-optics', label: 'Open in Ray Optics', icon: 'share', hint: 'Download this cross-section as a Ray Optics Simulation scene', enabled: () => !!this.scene, run: () => this.exportRayOptics() },
      { id: 'export-csv', label: 'Results as CSV', icon: 'table', enabled: () => !!this.result, run: () => this.exportCsv() },
      { id: 'export-png', label: 'Image of view', icon: 'image', run: () => this.exportImage() },
      { id: 'undo', label: 'Undo', icon: 'undo', shortcut: 'Ctrl+Z', enabled: () => this.store.canUndo, run: () => this.store.undo() },
      { id: 'redo', label: 'Redo', icon: 'redo', shortcut: 'Ctrl+Shift+Z', enabled: () => this.store.canRedo, run: () => this.store.redo() },
      collector('trough'), collector('fresnel'), collector('cpc'),
      ...(/** @type {[StudyId, string, string][]} */ ([['design-point', 'Design point', 'target'], ['acceptance', 'Acceptance', 'acceptance'], ['incidence', 'Incidence angle', 'incidence'], ['day', 'Day', 'day'], ['year', 'Year', 'year']]))
        .map(([id, label, icon]) => ({ id: `study-${id}`, label: `Show ${label.toLowerCase()} study`, icon, pressed: () => this.study === id, run: () => this.showStudy(id) })),
      { id: 'rerun-studies', label: 'Run studies again', icon: 'refresh', hint: 'Run the acceptance and annual studies again', enabled: () => !!this.scene, run: () => this.runStudies() },
      { id: 'import-epw', label: 'Import weather file', icon: 'weather', hint: 'Use hourly DNI and the site from an EnergyPlus weather (EPW) file', run: () => byId('epwInput').click() },
      { id: 'clear-sky', label: 'Clear sky', icon: 'sun', hint: 'Use the ASHRAE clear-sky model for DNI', pressed: () => d().weather.source === 'clear-sky', run: () => edit('Use the clear-sky model', x => { x.weather = { source: 'clear-sky' }; }) },
      ...SITES.map(site => ({ id: `site-${site.key}`, label: site.name, icon: 'globe', hint: `${site.name}: ${site.latitude}°, ${site.longitude}°`, pressed: () => d().site.name === site.name && d().weather.source === 'clear-sky',
        run: () => edit(`Move to ${site.name}`, x => { x.site = { name: site.name, latitude: site.latitude, longitude: site.longitude, timezone: site.timezone, elevation: site.elevation }; x.weather = { source: 'clear-sky' }; }) })),
      { id: 'axis-ns', label: 'North–south axis', icon: 'trough', pressed: () => d().mounting.axisAzimuthDeg === 0, run: () => edit('Turn the axis north–south', x => { x.mounting.axisAzimuthDeg = 0; }) },
      { id: 'axis-ew', label: 'East–west axis', icon: 'trough', pressed: () => d().mounting.axisAzimuthDeg === 90, run: () => edit('Turn the axis east–west', x => { x.mounting.axisAzimuthDeg = 90; }) },
      { id: 'trace', label: 'Trace now', icon: 'trace', shortcut: 'T', hint: 'Trace the design point again', run: () => this.trace('full') },
      quality(20000, 'Draft'), quality(200000, 'Standard'), quality(1000000, 'Fine'),
      { id: 'new-seed', label: 'New random seed', icon: 'refresh', hint: 'Trace with different random rays to see the sampling noise', run: () => edit('Use a new random seed', x => { x.simulation.seed = (x.simulation.seed * 1103515245 + 12345) >>> 0; }) },
      { id: 'fit', label: 'Fit to view', icon: 'fit', shortcut: 'F', run: () => this.fitView() },
      { id: 'zoom-in', label: 'Zoom in', icon: 'plus', shortcut: '+', run: () => { this.view.zoom(1.25); this.updateZoom(); } },
      { id: 'zoom-out', label: 'Zoom out', icon: 'minus', shortcut: '−', run: () => { this.view.zoom(0.8); this.updateZoom(); } },
      { id: 'toggle-rays', label: 'Rays', icon: 'rays', hint: 'Show traced rays', pressed: () => this.view.showRays, run: viewToggle('showRays') },
      { id: 'toggle-missed', label: 'Missed rays', icon: 'rays', hint: 'Show rays that miss the collector', pressed: () => this.view.showMissed, run: viewToggle('showMissed') },
      { id: 'toggle-flux', label: 'Flux ring', icon: 'flux', hint: 'Show absorbed flux around the absorber', pressed: () => this.view.showFlux, run: viewToggle('showFlux') },
      { id: 'toggle-theme', label: 'Dark theme', icon: 'moon', pressed: () => document.documentElement.dataset.theme === 'dark', run: () => { const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; writePref('linefocus-theme', next); this.applyTheme(next); this.ribbon.refresh(); this.renderDock(); } },
      { id: 'toggle-ribbon', label: 'Ribbon', icon: 'chevron', pressed: () => this.root.dataset.ribbon === 'open', run: () => this.setPanel('ribbon') },
      { id: 'toggle-studies', label: 'Studies panel', icon: 'panel-left', pressed: () => this.root.dataset.studies === 'open', run: () => this.setPanel('studies') },
      { id: 'toggle-inspector', label: 'Design panel', icon: 'panel-right', pressed: () => this.root.dataset.inspector === 'open', run: () => this.setPanel('inspector') },
      { id: 'palette', label: 'Find a command', icon: 'search', shortcut: 'Ctrl+K', palette: false, run: () => this.dialogs.palette(this.commands) },
      { id: 'help', label: 'Help and keyboard shortcuts', icon: 'help', shortcut: 'F1', run: () => { this.dialogs.help(SHORTCUTS); } },
    ]);
    // One delegated listener serves every [data-cmd] button, including ribbon buttons rebuilt on each tab switch.
    document.addEventListener('click', event => {
      const button = event.target instanceof Element ? event.target.closest('[data-cmd]') : null;
      if (!(button instanceof HTMLElement) || (button instanceof HTMLButtonElement && button.disabled)) return;
      this.commands.run(button.dataset.cmd ?? '').catch(error => this.toasts.show(error instanceof Error ? error.message : String(error), { kind: 'error' }));
    });
    byId('epwInput').addEventListener('change', async e => {
      const input = /** @type {HTMLInputElement} */ (e.target);
      const file = input.files?.[0];
      input.value = '';
      if (!file) return;
      try {
        const { site, weather } = parseEpw(await file.text(), file.name);
        edit(`Use weather from ${file.name}`, x => { x.site = site; x.weather = { ...weather, dni: [...weather.dni] }; });
        const annual = weather.dni.reduce((a, b) => a + b, 0) / 1000;
        this.toasts.show(`Using ${site.name}: ${fmt(annual, 0)} kWh/m² of direct normal irradiation a year.`);
        this.showStudy('year');
      } catch (error) {
        this.toasts.show(`${file.name} could not be used. ${error instanceof Error ? error.message : error}`, { kind: 'error', ms: 8000 });
      }
    });
    byId('fileInput').addEventListener('change', e => {
      const input = /** @type {HTMLInputElement} */ (e.target);
      const file = input.files?.[0];
      input.value = '';
      if (file) this.openFile(file);
    });
  }

  /** @returns {RibbonTab[]} */
  ribbonLayout() {
    return [
      { id: 'file', label: 'File', groups: [
        { caption: 'New', items: [{ cmd: 'new-trough', size: 'small', label: 'Trough' }, { cmd: 'new-fresnel', size: 'small', label: 'Linear Fresnel' }, { cmd: 'new-cpc', size: 'small', label: 'CPC' }] },
        { caption: 'Design file', items: [{ cmd: 'open', label: 'Open' }, { cmd: 'save', label: 'Download' }] },
        { caption: 'Export', items: [{ cmd: 'export-ray-optics', label: 'Ray Optics' }, { cmd: 'export-csv', label: 'Results CSV' }, { cmd: 'export-png', label: 'Image' }] },
      ] },
      { id: 'design', label: 'Design', groups: [
        { caption: 'Collector', items: [{ cmd: 'collector-trough', label: 'Trough' }, { cmd: 'collector-fresnel', label: 'Fresnel' }, { cmd: 'collector-cpc', label: 'CPC' }] },
        { caption: 'Edit', items: [{ cmd: 'undo', size: 'small' }, { cmd: 'redo', size: 'small' }, { cmd: 'rename', size: 'small', label: 'Rename' }] },
      ] },
      { id: 'analyse', label: 'Analyse', groups: [
        { caption: 'Studies', items: [{ cmd: 'study-design-point', label: 'Design point' }, { cmd: 'study-acceptance', label: 'Acceptance' }, { cmd: 'study-incidence', label: 'Incidence' }, { cmd: 'study-day', label: 'Day' }, { cmd: 'study-year', label: 'Year' }] },
        { caption: 'Run', items: [{ cmd: 'trace', label: 'Trace now', className: 'sun' }, { cmd: 'rerun-studies', size: 'small', label: 'Studies again' }, { cmd: 'new-seed', size: 'small', label: 'New seed' }] },
        { caption: 'Quality', items: [{ cmd: 'rays-20000', label: 'Draft' }, { cmd: 'rays-200000', label: 'Standard' }, { cmd: 'rays-1000000', label: 'Fine' }] },
      ] },
      { id: 'site', label: 'Site', groups: [
        { caption: 'Weather', items: [{ cmd: 'import-epw', label: 'Weather file' }, { cmd: 'clear-sky', label: 'Clear sky' }] },
        { caption: 'Example sites', items: SITES.map(site => ({ cmd: `site-${site.key}`, size: /** @type {const} */ ('small'), label: site.name })) },
        { caption: 'Axis', items: [{ cmd: 'axis-ns', size: 'small', label: 'North–south' }, { cmd: 'axis-ew', size: 'small', label: 'East–west' }] },
      ] },
      { id: 'view', label: 'View', groups: [
        { caption: 'Camera', items: [{ cmd: 'fit', label: 'Fit' }, { cmd: 'zoom-in', size: 'small' }, { cmd: 'zoom-out', size: 'small' }] },
        { caption: 'Show', items: [{ cmd: 'toggle-rays', label: 'Rays' }, { cmd: 'toggle-missed', label: 'Missed' }, { cmd: 'toggle-flux', label: 'Flux ring' }] },
        { caption: 'Panels', items: [{ cmd: 'toggle-studies', size: 'small', label: 'Studies' }, { cmd: 'toggle-inspector', size: 'small', label: 'Design' }, { cmd: 'toggle-theme', label: 'Dark theme' }] },
      ] },
    ];
  }

  installKeyboard() {
    window.addEventListener('keydown', e => {
      const target = /** @type {HTMLElement} */ (e.target);
      const typing = target.matches('input, textarea, select, [contenteditable="true"]');
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (byId('dialog').hasAttribute('open')) return;
      /** @param {string} id */
      const run = id => { e.preventDefault(); this.commands.run(id); };
      if (mod && key === 'k') return run('palette');
      if (mod && key === 's') return run('save');
      if (mod && key === 'o') return run('open');
      if (mod && key === 'z' && !typing) return run(e.shiftKey ? 'redo' : 'undo');
      if (mod && key === 'y' && !typing) return run('redo');
      if (e.key === 'F1') return run('help');
      if (typing || mod || e.altKey) return;
      if (key === 'f') return run('fit');
      if (key === 't') return run('trace');
      if (key === '+' || key === '=') return run('zoom-in');
      if (key === '-') return run('zoom-out');
      if (key === '?') return run('help');
    });
  }

  installSplitter() {
    const splitter = byId('dockSplitter');
    const area = /** @type {HTMLElement} */ (splitter.parentElement);
    /** @param {number} height */
    const set = height => {
      const max = area.clientHeight - 44 - 140;
      const value = Math.round(Math.max(150, Math.min(max, height)));
      this.root.style.setProperty('--dock-height', `${value}px`);
      writePref('linefocus-dock', String(value));
      this.view.resize();
    };
    splitter.addEventListener('pointerdown', down => {
      splitter.setPointerCapture(down.pointerId);
      const start = byId('dock').clientHeight;
      /** @param {PointerEvent} e */
      const move = e => set(start - (e.clientY - down.clientY));
      const up = () => { splitter.removeEventListener('pointermove', move); splitter.removeEventListener('pointerup', up); };
      splitter.addEventListener('pointermove', move);
      splitter.addEventListener('pointerup', up);
    });
    splitter.addEventListener('keydown', e => {
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); set(byId('dock').clientHeight + (e.key === 'ArrowUp' ? 24 : -24)); }
    });
  }

  installFileDrop() {
    window.addEventListener('dragover', e => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault(); });
    window.addEventListener('drop', e => {
      const file = e.dataTransfer?.files[0];
      if (!file) return;
      e.preventDefault();
      this.openFile(file);
    });
  }
}

/** @typedef {'design-point' | 'acceptance' | 'incidence' | 'day' | 'year'} StudyId */

/** Example sites with strong direct sunlight, for quick comparisons. */
const SITES = [
  { key: 'almeria', name: 'Almería, Spain', latitude: 37.09, longitude: -2.36, timezone: 1, elevation: 500 },
  { key: 'daggett', name: 'Daggett, California', latitude: 34.86, longitude: -116.79, timezone: -8, elevation: 588 },
  { key: 'ouarzazate', name: 'Ouarzazate, Morocco', latitude: 30.93, longitude: -6.9, timezone: 1, elevation: 1140 },
  { key: 'upington', name: 'Upington, South Africa', latitude: -28.41, longitude: 21.27, timezone: 2, elevation: 836 },
];

/** @type {[string, string][]} */
const SHORTCUTS = [
  ['Find a command', 'Ctrl+K'],
  ['Undo / redo', 'Ctrl+Z / Ctrl+Shift+Z'],
  ['Download the design', 'Ctrl+S'],
  ['Open a design file', 'Ctrl+O'],
  ['Trace the design point again', 'T'],
  ['Fit the cross-section to the view', 'F or double-click'],
  ['Zoom', 'Scroll, or + and −'],
  ['Pan', 'Drag empty space'],
  ['Change a value', 'Drag its label; Shift ×10, Alt ×0.1'],
  ['Step a value', '↑ / ↓ in the field'],
  ['Cancel a drag', 'Esc'],
  ['Help', 'F1 or ?'],
];
