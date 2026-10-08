/** The optimiser's dock view: choose an objective and the values to vary, run, watch convergence, and apply. */

import { h, fmt } from './dom.js';
import { lineChart, chartFrame, dataTable } from './charts.js';
import { OBJECTIVES, variablesFor } from '../core/optimise.js';
import { DESIGN_SPEC, getPath } from '../core/model.js';
import { specAt } from '../core/spec.js';

/** @import { Design } from '../core/model.js' */
/** @import { Objective, Variable, OptimiseResult } from '../core/optimise.js' */
/** @import { NumberSpec } from '../core/spec.js' */

/**
 * Optimiser setup kept for the session, per collector type.
 * @typedef {{ objective: Objective, chosen: Record<string, { enabled: boolean, min: number, max: number }> }} OptimiseSetup
 * @typedef {{ running: boolean, done: number, total: number, history: number[], result: OptimiseResult | null, error: string | null, revision: number }} OptimiseState
 */

/** Default setup: annual energy per square metre, varying the collector's own geometry and leaving the receiver fixed. @param {Design} design @returns {OptimiseSetup} */
export function defaultSetup(design) {
  /** @type {OptimiseSetup['chosen']} */
  const chosen = {};
  for (const v of variablesFor(design)) chosen[v.path] = { enabled: v.path.startsWith('collector.') && !v.path.includes('secondary') && v.path !== 'collector.mirrorWidth', min: v.min, max: v.max };
  return { objective: 'annualPerArea', chosen };
}

/** @param {Objective} objective @param {number} v */
export function formatScore(objective, v) {
  if (!Number.isFinite(v)) return '–';
  if (objective === 'efficiency') return `${fmt(v, 2)}%`;
  if (objective === 'cap') return fmt(v, 3);
  return `${fmt(v, 0)} ${OBJECTIVES[objective].unit}`;
}

/**
 * @param {{ design: Design, setup: OptimiseSetup, state: OptimiseState, width: number, revision: number,
 *   onSetup: (setup: OptimiseSetup) => void, onRun: () => void, onStop: () => void, onApply: () => void }} props
 */
export function optimiseView({ design, setup, state, width, revision, onSetup, onRun, onStop, onApply }) {
  const vars = variablesFor(design);
  const objective = h('select', { class: 'select', 'aria-label': 'Objective', disabled: state.running });
  for (const [key, o] of Object.entries(OBJECTIVES)) objective.append(h('option', { value: key, text: o.label, selected: key === setup.objective }));
  objective.addEventListener('change', () => onSetup({ ...setup, objective: /** @type {Objective} */ (objective.value) }));

  const rows = vars.map(v => {
    const chosen = setup.chosen[v.path] ?? { enabled: false, min: v.min, max: v.max };
    const factor = v.spec.display?.factor ?? 1, unit = v.spec.display?.unit ?? v.spec.unit;
    const digits = v.spec.integer ? 0 : (v.spec.display?.digits ?? 2);
    const box = h('input', { type: 'checkbox', checked: chosen.enabled, disabled: state.running, 'aria-label': `Vary ${v.label}` });
    /** @param {'min' | 'max'} key */
    const bound = key => {
      const input = h('input', { class: 'text-input bound', value: fmt(chosen[key] * factor, digits).replace(/,/g, ''), disabled: state.running || !chosen.enabled, 'aria-label': `${key === 'min' ? 'Lowest' : 'Highest'} ${v.label}`, inputmode: 'decimal' });
      input.addEventListener('change', () => {
        const value = Number(input.value.replace(',', '.')) / factor;
        if (Number.isFinite(value)) onSetup({ ...setup, chosen: { ...setup.chosen, [v.path]: { ...chosen, [key]: Math.min(v.spec.max, Math.max(v.spec.min, value)) } } });
      });
      return input;
    };
    box.addEventListener('change', () => onSetup({ ...setup, chosen: { ...setup.chosen, [v.path]: { ...chosen, enabled: box.checked } } }));
    return h('div', { class: 'opt-var', 'data-enabled': String(chosen.enabled) }, [
      h('label', { class: 'opt-name', 'data-tip': v.label }, [box, h('span', { text: v.label })]),
      bound('min'), h('span', { class: 'opt-dash', text: 'to' }), bound('max'), h('span', { class: 'opt-unit', text: unit }),
    ]);
  });
  const anyChosen = vars.some(v => setup.chosen[v.path]?.enabled);
  const action = state.running
    ? h('button', { class: 'outline-button', type: 'button', text: 'Stop' })
    : h('button', { class: 'primary-button', type: 'button', disabled: !anyChosen, text: 'Optimise' });
  action.addEventListener('click', () => (state.running ? onStop() : onRun()));

  const setupPanel = h('div', { class: 'opt-setup' }, [
    h('label', { class: 'field wide' }, [h('span', { class: 'field-label', text: 'Make as large as possible' }), objective]),
    h('p', { class: 'opt-help', text: OBJECTIVES[setup.objective].help }),
    h('div', { class: 'subhead', text: 'Values to vary, and their range' }),
    ...rows,
    h('div', { class: 'opt-actions' }, [action, state.running ? h('span', { class: 'opt-progress', text: `Candidate ${state.done} of up to ${state.total}` }) : null]),
  ]);

  /** @type {(Node | null)[]} */
  const results = [];
  if (state.error) results.push(h('div', { class: 'error-note', text: state.error }));
  if (state.history.length) {
    const points = state.history.map((v, i) => /** @type {[number, number]} */ ([i + 1, v])).filter(([, v]) => Number.isFinite(v));
    results.push(chartFrame({
      title: 'Best so far',
      subtitle: `${OBJECTIVES[state.result?.objective ?? setup.objective].label} against candidates tried`,
      chart: lineChart({ series: [{ name: 'Best', colour: 'var(--series-1)', points }], x: { label: 'Candidates tried', format: v => fmt(v, 0) }, y: { zero: false, label: OBJECTIVES[state.result?.objective ?? setup.objective].unit || 'Score', format: v => fmt(v, setup.objective === 'efficiency' ? 1 : setup.objective === 'cap' ? 2 : 0) }, width: Math.max(260, width), height: 140 }),
      table: dataTable(['Candidate', 'Best'], points.map(([i, v]) => [String(i), formatScore(setup.objective, v)])),
    }));
  }
  if (state.result) results.push(summary(design, state.result, revision !== state.revision, onApply));
  if (!results.length) results.push(h('div', { class: 'empty-state' }, [h('strong', { text: 'Let the tracer search for you' }), 'Tick the values to vary, set their ranges, and press Optimise. Every candidate is checked against the design rules and traced with the same random rays, so differences are real.']));

  return h('div', { class: 'dock-inner' }, [
    h('div', { class: 'dock-title' }, [h('h3', { text: 'Optimise' }), h('p', { text: 'Search for better values with the tracer, within the ranges you set' })]),
    h('div', { class: 'opt-layout' }, [setupPanel, h('div', { class: 'opt-results' }, results)]),
  ]);
}

/** @param {Design} design @param {OptimiseResult} r @param {boolean} changed @param {() => void} onApply */
function summary(design, r, changed, onApply) {
  const gain = r.confirmation.best - r.confirmation.start;
  const noise = Math.max(r.confirmation.noise, 1e-12);
  const real = gain > 2 * noise;
  const verdict = real
    ? `Confirmed with fresh rays: ${formatScore(r.objective, r.confirmation.start)} → ${formatScore(r.objective, r.confirmation.best)}, a gain of ${formatGain(r.objective, gain)} against sampling noise of about ±${formatGain(r.objective, noise)}.`
    : `No gain beyond sampling noise (±${formatGain(r.objective, noise)}): the design is already at or near the best in these ranges.`;
  const apply = h('button', { class: 'primary-button', type: 'button', disabled: !real, text: 'Apply these values' });
  apply.addEventListener('click', onApply);
  return h('div', { class: 'opt-summary' }, [
    dataTable(['Value', 'Before', 'After'], r.variables.map((v, i) => {
      const spec = /** @type {NumberSpec} */ (specAt(DESIGN_SPEC, design, v.path));
      const factor = spec.display?.factor ?? 1, unit = spec.display?.unit ?? spec.unit, digits = spec.integer ? 0 : (spec.display?.digits ?? 3);
      const edge = (r.best.values[i] - v.min) / (v.max - v.min);
      const limit = edge < 0.01 ? ' (at the lowest limit)' : edge > 0.99 ? ' (at the highest limit)' : '';
      return [spec.label, `${fmt(r.start.values[i] * factor, digits)} ${unit}`, `${fmt(r.best.values[i] * factor, digits)} ${unit}${limit}`];
    })),
    h('p', { class: real ? 'opt-verdict' : 'opt-verdict muted', text: verdict }),
    r.best.values.some((x, i) => { const e = (x - r.variables[i].min) / (r.variables[i].max - r.variables[i].min); return e < 0.01 || e > 0.99; })
      ? h('p', { class: 'opt-help', text: 'A value stopped at the edge of its range. The best design may lie beyond it; widen the range if that is buildable.' }) : null,
    changed ? h('p', { class: 'opt-help', text: 'The design has changed since this run. Applying sets only the values in the table.' }) : null,
    h('div', { class: 'opt-actions' }, [apply, h('span', { class: 'opt-progress', text: `${r.evaluations} candidates${r.bins ? `, ${r.bins} sun positions for the year` : ''}` })]),
  ]);
}

/** @param {Objective} objective @param {number} v */
function formatGain(objective, v) {
  if (objective === 'efficiency') return `${fmt(v, 2)} points`;
  if (objective === 'cap') return fmt(v, 3);
  return `${fmt(v, 0)} ${OBJECTIVES[objective].unit}`;
}

/** Variables chosen in a setup, as the optimiser expects them. @param {Design} design @param {OptimiseSetup} setup @returns {Variable[]} */
export function chosenVariables(design, setup) {
  return variablesFor(design).filter(v => setup.chosen[v.path]?.enabled).map(v => {
    const c = setup.chosen[v.path];
    const current = /** @type {number} */ (getPath(design, v.path));
    // Keep the current value inside the range so the search starts from the design as it is.
    return { path: v.path, min: Math.min(c.min, current), max: Math.max(c.max, current) };
  });
}
