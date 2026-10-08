/** The design inspector. Sections and fields are generated from the design spec, so labels, units, ranges and help
 * text have one source. Every edit goes through the store as a labelled transaction. */

import { DESIGN_SPEC, getPath, setPath, switchVariant } from '../core/model.js';
import { specAt, ValidationError, rangeText } from '../core/spec.js';
import { h, fmt } from './dom.js';
import { hydrateIcons } from './icons.js';

/** @import { Design } from '../core/model.js' */
/** @import { Spec, NumberSpec, ObjectSpec, UnionSpec } from '../core/spec.js' */
/** @import { DesignStore } from '../core/history.js' */
/** @import { Figure } from '../core/design-scene.js' */

/**
 * @typedef {{ id: string, title: string, paths: string[], summary?: (d: Design) => string }} Section
 */

/** @type {Section[]} */
const SECTIONS = [
  { id: 'collector', title: 'Collector', paths: ['collector'] },
  { id: 'receiver', title: 'Receiver', paths: ['receiver'] },
  { id: 'optics', title: 'Mirror optics', paths: ['optics'], summary: d => `ρ ${fmt(d.optics.reflectance * 100, 1)}%` },
  { id: 'sun', title: 'Sun', paths: ['sun'] },
  { id: 'point', title: 'Design point', paths: ['designPoint'], summary: d => `${fmt(d.designPoint.dni, 0)} W/m²` },
  { id: 'site', title: 'Site and mounting', paths: ['site', 'mounting.axisAzimuthDeg', 'mounting.tiltDeg', 'mounting.trackingErrorMrad', 'mounting.rowLength'], summary: d => d.site.name },
  { id: 'simulation', title: 'Simulation', paths: ['simulation'], summary: d => `${fmt(d.simulation.rays / 1000, 0)}k rays` },
];

/** Fields shown only in some states. */
/** @type {Record<string, (d: Design) => boolean>} */
const VISIBLE = {
  'receiver.envelope.outerDiameter': d => d.receiver.type === 'tube' && d.receiver.envelope.mode !== 'none',
  'receiver.envelope.thickness': d => d.receiver.type === 'tube' && d.receiver.envelope.mode === 'physical',
  'receiver.envelope.refractiveIndex': d => d.receiver.type === 'tube' && d.receiver.envelope.mode === 'physical',
  'receiver.envelope.extinction': d => d.receiver.type === 'tube' && d.receiver.envelope.mode === 'physical',
  'receiver.envelope.transmittance': d => d.receiver.type === 'tube' && d.receiver.envelope.mode === 'fixed',
  'receiver.cover.gap': d => d.receiver.type === 'flat' && d.receiver.cover.mode !== 'none',
  'receiver.cover.overhang': d => d.receiver.type === 'flat' && d.receiver.cover.mode !== 'none',
  'receiver.cover.thickness': d => d.receiver.type === 'flat' && d.receiver.cover.mode === 'physical',
  'receiver.cover.refractiveIndex': d => d.receiver.type === 'flat' && d.receiver.cover.mode === 'physical',
  'receiver.cover.extinction': d => d.receiver.type === 'flat' && d.receiver.cover.mode === 'physical',
  'receiver.cover.transmittance': d => d.receiver.type === 'flat' && d.receiver.cover.mode === 'fixed',
  'collector.curvatureRadius': d => d.collector.type === 'fresnel' && d.collector.curvature === 'cylindrical',
  'mounting.trackingErrorMrad': d => d.collector.type === 'trough',
  'mounting.tiltDeg': d => d.collector.type === 'cpc',
};

/** Union variants that cannot be chosen in the current design, with the reason. */
/** @type {Record<string, (d: Design, tag: string) => string | null>} */
const UNAVAILABLE = {
  collector: (_, tag) => (tag === 'cpc' ? 'CPC collectors are on the way' : null),
  receiver: (d, tag) => (d.collector.type === 'trough' && tag === 'flat' ? 'A parabolic trough uses an absorber tube' : null),
  weather: (_, tag) => (tag === 'epw' ? 'Import an EPW file from the Site tab' : null),
};

/** Decimal places for a number field in display units. @param {NumberSpec} spec */
function digitsFor(spec) {
  if (spec.integer) return 0;
  if (spec.display) return spec.display.digits;
  const step = spec.step ?? 0.01;
  return Math.max(0, Math.min(6, Math.ceil(-Math.log10(step) - 1e-9)));
}

export class Inspector {
  /**
   * @param {HTMLElement} root
   * @param {{ store: DesignStore, onError: (message: string) => void, figures: () => Figure[] }} options
   */
  constructor(root, { store, onError, figures }) {
    this.root = root;
    this.store = store;
    this.onError = onError;
    this.figures = figures;
    /** @type {Map<string, boolean>} */
    this.open = new Map();
    /** @type {Map<string, (design: Design, keepErrors: boolean) => void>} */
    this.updaters = new Map();
  }

  /** Rebuilds the inspector, keeping scroll position, open sections and the focused field. */
  render() {
    const design = this.store.design;
    const scroll = this.root.scrollTop;
    const focused = /** @type {HTMLElement | null} */ (this.root.querySelector(':focus'))?.dataset.path ?? null;
    this.updaters.clear();
    const sections = SECTIONS.map(section => this.section(section, design));
    this.root.replaceChildren(...sections);
    hydrateIcons(this.root);
    this.root.scrollTop = scroll;
    if (focused) /** @type {HTMLElement | null} */ (this.root.querySelector(`[data-path="${focused}"]`))?.focus();
  }

  /**
   * Refreshes displayed values without rebuilding, for live previews and rolled-back edits. With keepErrors, a field
   * showing a refused value keeps its text and message so the user can correct it.
   * @param {boolean} [keepErrors]
   */
  refreshValues(keepErrors = false) {
    for (const update of this.updaters.values()) update(this.store.design, keepErrors);
  }

  /** @param {Section} section @param {Design} design */
  section(section, design) {
    const open = this.open.get(section.id) ?? true;
    const body = h('div', { class: 'section-body' });
    for (const path of section.paths) this.renderPath(body, path, design, section.paths.length > 1 && !path.includes('.'));
    if (section.id === 'collector') {
      const figures = this.figures();
      if (figures.length) {
        body.append(h('div', { class: 'figures' }, figures.map(f => h('div', { class: 'figure', 'data-tip': f.help }, [h('span', { text: f.label }), h('span', { text: `${fmt(f.value, f.digits)} ${f.unit}`.trim() })]))));
      }
    }
    const head = h('button', { class: 'section-head', type: 'button', 'aria-expanded': String(open) }, [
      h('span', { 'data-icon': 'chevron' }), section.title,
      section.summary ? h('span', { class: 'section-summary', text: section.summary(design) }) : null,
    ]);
    const el = h('section', { class: 'section', 'data-open': String(open), 'data-section': section.id }, [head, body]);
    head.addEventListener('click', () => {
      const next = el.dataset.open !== 'true';
      this.open.set(section.id, next);
      el.dataset.open = String(next);
      head.setAttribute('aria-expanded', String(next));
    });
    return el;
  }

  /**
   * Renders the fields under a path into a container.
   * @param {HTMLElement} into @param {string} path @param {Design} design @param {boolean} withHeading
   */
  renderPath(into, path, design, withHeading) {
    const spec = specAt(DESIGN_SPEC, design, path);
    if (!spec) return;
    if (spec.kind === 'union') {
      into.append(this.variantField(path, spec, design, !path.includes('.')));
      const tag = /** @type {Record<string, unknown>} */ (getPath(design, path))[spec.tag];
      this.renderObject(into, path, spec.variants[String(tag)], design, spec.tag);
      return;
    }
    if (spec.kind === 'object') {
      if (withHeading) into.append(h('div', { class: 'subhead', text: spec.label }));
      this.renderObject(into, path, spec, design, null);
      return;
    }
    this.renderField(into, path, spec, design);
  }

  /** @param {HTMLElement} into @param {string} path @param {ObjectSpec} spec @param {Design} design @param {string | null} skip */
  renderObject(into, path, spec, design, skip) {
    for (const [key, field] of Object.entries(spec.fields)) {
      if (key === skip || field.kind === 'const' || field.kind === 'array') continue;
      const child = `${path}.${key}`;
      if (field.kind === 'object') { into.append(h('div', { class: 'subhead', text: field.label })); this.renderObject(into, child, field, design, null); continue; }
      if (field.kind === 'union') { this.renderPath(into, child, design, false); continue; }
      this.renderField(into, child, field, design);
    }
  }

  /** @param {HTMLElement} into @param {string} path @param {Spec} spec @param {Design} design */
  renderField(into, path, spec, design) {
    const visible = VISIBLE[path];
    if (visible && !visible(design)) return;
    if (spec.kind === 'number') into.append(this.numberField(path, spec));
    else if (spec.kind === 'enum') into.append(this.enumField(path, spec.label, spec.values.map(v => [v, spec.labels[v]]), String(getPath(design, path)), tag => this.commit(`Set ${spec.label.toLowerCase()}`, d => setPath(d, path, tag)), spec.help));
    else if (spec.kind === 'string') into.append(this.textField(path, spec.label));
  }

  /** @param {string} path @param {UnionSpec} spec @param {Design} design @param {boolean} [unlabelled] the section title already names it */
  variantField(path, spec, design, unlabelled = false) {
    const current = String(/** @type {Record<string, unknown>} */ (getPath(design, path))[spec.tag]);
    const options = Object.keys(spec.variants).map(tag => /** @type {[string, string]} */ ([tag, spec.labels[tag]]));
    const unavailable = UNAVAILABLE[path];
    return this.enumField(path, spec.label, options, current, tag => {
      if (tag === current) return;
      this.commit(`Choose ${spec.label.toLowerCase()}: ${spec.labels[tag]}`, d => switchVariant(d, path, tag));
    }, undefined, tag => (unavailable ? unavailable(design, tag) : null), unlabelled);
  }

  /**
   * Segmented control for up to four options, a select beyond that.
   * @param {string} path @param {string} label @param {[string, string][]} options @param {string} current
   * @param {(value: string) => void} choose @param {string} [help] @param {(value: string) => string | null} [disabledReason]
   * @param {boolean} [unlabelled]
   */
  enumField(path, label, options, current, choose, help, disabledReason = () => null, unlabelled = false) {
    if (options.length <= 4) {
      const group = h('div', { class: 'segmented', role: 'group', 'aria-label': label });
      for (const [value, text] of options) {
        const reason = disabledReason(value);
        const button = h('button', { type: 'button', 'aria-pressed': String(value === current), 'data-path': `${path}:${value}`, disabled: !!reason, 'data-tip': reason ?? undefined, text });
        button.addEventListener('click', () => choose(value));
        group.append(button);
      }
      return h('div', { class: 'field wide' }, [unlabelled ? null : h('span', { class: 'field-label', text: label, 'data-tip': help }), group]);
    }
    const select = h('select', { class: 'select', 'data-path': path, 'aria-label': label });
    for (const [value, text] of options) select.append(h('option', { value, text, selected: value === current }));
    select.addEventListener('change', () => choose(select.value));
    return h('label', { class: 'field' }, [h('span', { class: 'field-label', text: label }), select]);
  }

  /** @param {string} path @param {string} label */
  textField(path, label) {
    const input = h('input', { class: 'text-input', 'data-path': path, 'aria-label': label, value: String(getPath(this.store.design, path)) });
    input.addEventListener('change', () => this.commit(`Rename ${label.toLowerCase()}`, d => setPath(d, path, input.value.trim())));
    this.updaters.set(path, d => { if (document.activeElement !== input) input.value = String(getPath(d, path)); });
    return h('label', { class: 'field' }, [h('span', { class: 'field-label', text: label }), input]);
  }

  /** @param {string} path @param {NumberSpec} spec */
  numberField(path, spec) {
    const factor = spec.display?.factor ?? 1;
    const unit = spec.display?.unit ?? spec.unit;
    const digits = digitsFor(spec);
    const step = (spec.step ?? 10 ** -digits) * factor;
    /** @param {Design} d */
    const shown = d => fmt(/** @type {number} */ (getPath(d, path)) * factor, digits).replace(/,/g, '');
    const input = h('input', {
      'data-path': path, inputmode: spec.integer ? 'numeric' : 'decimal', autocomplete: 'off', spellcheck: 'false',
      'aria-label': `${spec.label}${unit ? ` (${unit})` : ''}`, value: shown(this.store.design),
    });
    const label = h('span', { class: 'field-label scrub', text: spec.label, 'data-tip': `${spec.help ? `${spec.help}. ` : ''}Drag to adjust; ${rangeText(spec)}` });
    const error = h('div', { class: 'field-error', hidden: true });
    const field = h('div', { class: 'field', 'data-invalid': 'false' }, [
      label, h('div', { class: 'number-input' }, [input, unit ? h('span', { class: 'unit', text: unit }) : null]), error,
    ]);
    /** @param {string | null} message */
    const setError = message => {
      field.dataset.invalid = String(!!message);
      error.hidden = !message;
      error.textContent = message ?? '';
    };
    /** @param {number} displayValue @param {boolean} [quiet] */
    const apply = (displayValue, quiet = false) => {
      let value = displayValue / factor;
      if (spec.integer) value = Math.round(value);
      try {
        this.store.transact(`Change ${spec.label.toLowerCase()}`, d => setPath(d, path, value));
        setError(null);
        return true;
      } catch (e) {
        const message = describeError(e, path, spec.label);
        if (quiet) this.onError(message); else setError(message);
        return false;
      }
    };
    input.addEventListener('change', () => {
      const parsed = Number(input.value.replace(',', '.').trim());
      if (!Number.isFinite(parsed) || input.value.trim() === '') { setError('Enter a number.'); return; }
      apply(parsed);
    });
    input.addEventListener('keydown', e => {
      if (e.key === 'Escape') { input.value = shown(this.store.design); setError(null); input.blur(); }
      if (e.key === 'Enter') input.blur();
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const current = /** @type {number} */ (getPath(this.store.design, path)) * factor;
        const delta = (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : e.altKey ? 0.1 : 1);
        const next = clamp(current + delta, spec, factor);
        if (apply(+next.toFixed(Math.max(digits, 6)), true)) input.value = shown(this.store.design);
      }
    });
    this.scrub(label, path, spec, factor, step);
    this.updaters.set(path, (d, keepErrors) => {
      if (document.activeElement === input || (keepErrors && field.dataset.invalid === 'true')) return;
      input.value = shown(d); setError(null);
    });
    return field;
  }

  /**
   * Dragging a label changes the value: one step per 4 px, Shift for ×10, Alt for ×0.1. The drag is one
   * transaction with live previews.
   * @param {HTMLElement} label @param {string} path @param {NumberSpec} spec @param {number} factor @param {number} step
   */
  scrub(label, path, spec, factor, step) {
    label.addEventListener('pointerdown', down => {
      if (down.button !== 0) return;
      down.preventDefault();
      label.setPointerCapture(down.pointerId);
      const start = /** @type {number} */ (getPath(this.store.design, path)) * factor;
      let begun = false;
      /** @param {PointerEvent} e */
      const move = e => {
        const steps = Math.round((e.clientX - down.clientX) / 4);
        if (!begun) { if (steps === 0) return; this.store.begin(`Change ${spec.label.toLowerCase()}`); begun = true; }
        const k = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
        let value = clamp(start + steps * step * k, spec, factor) / factor;
        if (spec.integer) value = Math.round(value);
        setPath(this.store.design, path, value);
        this.store.preview();
        this.refreshValues();
      };
      const end = () => {
        label.removeEventListener('pointermove', move);
        label.removeEventListener('pointerup', end);
        label.removeEventListener('pointercancel', cancel);
        if (!begun) return;
        try { this.store.commit(); } catch (e) { this.onError(describeError(e, path, spec.label)); }
      };
      const cancel = () => { label.removeEventListener('pointermove', move); label.removeEventListener('pointerup', end); if (begun) this.store.cancel(); };
      label.addEventListener('pointermove', move);
      label.addEventListener('pointerup', end);
      label.addEventListener('pointercancel', cancel);
    });
  }

  /** @param {string} label @param {(d: Design) => void} mutate */
  commit(label, mutate) {
    try { this.store.transact(label, mutate); } catch (e) { this.onError(e instanceof Error ? e.message : String(e)); }
  }
}

/** Keeps a display value inside the spec's range. @param {number} v @param {NumberSpec} spec @param {number} factor */
function clamp(v, spec, factor) {
  const lo = spec.min * factor, hi = spec.max * factor;
  const eps = (hi - lo) * 1e-9;
  return Math.min(spec.exclusiveMax ? hi - eps : hi, Math.max(spec.exclusiveMin ? lo + eps : lo, v));
}

/** @param {string} reason */
function sentence(reason) {
  const text = reason.endsWith('.') ? reason : `${reason}.`;
  return text[0].toUpperCase() + text.slice(1);
}

/**
 * A message for a rejected edit. Range errors on the edited field read "Focal length must be …"; rule errors from
 * other fields stand on their own.
 * @param {unknown} error @param {string} path @param {string} label
 */
function describeError(error, path, label) {
  if (!(error instanceof ValidationError)) return error instanceof Error ? error.message : String(error);
  if (error.path === path) return `${label} ${error.reason.endsWith('.') ? error.reason : `${error.reason}.`}`;
  return sentence(error.reason);
}
