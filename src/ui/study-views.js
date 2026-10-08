/** Dock views for the acceptance, incidence-angle, day and year studies. */

import { h, fmt, pct } from './dom.js';
import { lineChart, columnChart, chartFrame, dataTable } from './charts.js';
import { interpolateEta, endLossFactor } from '../core/studies.js';
import { MONTH_NAMES } from '../core/solar.js';

/** @import { Design } from '../core/model.js' */
/** @import { AcceptanceJobResult, AnnualResult } from '../worker/protocol.js' */
/** @import { OpticalScene } from '../core/types.js' */

/** Categorical series colours, validated for colour-blind separation (see docs/BRAND.md). */
export const SERIES = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)'];

/**
 * @typedef {{ running: boolean, progress: number | null, error: string | null, stale: boolean }} StudyState
 */

/** @param {string} title @param {string} subtitle @param {StudyState} state */
function header(title, subtitle, state) {
  const note = state.running ? `Running${state.progress !== null ? ` ${Math.round(state.progress * 100)}%` : ''}…` : state.stale ? 'Out of date: tracing the new design' : '';
  return h('div', { class: 'dock-title' }, [h('h3', { text: title }), h('p', { text: subtitle }), note ? h('p', { class: 'dock-status', text: note }) : null]);
}

/** @param {string} title @param {StudyState} state @param {string} waiting */
function placeholder(title, state, waiting) {
  if (state.error) return h('div', { class: 'dock-inner' }, [header(title, '', state), h('div', { class: 'error-note', text: state.error })]);
  return h('div', { class: 'dock-inner' }, [header(title, '', state), h('div', { class: 'empty-state' }, [h('strong', { text: state.running ? 'Working on it…' : 'Not run yet' }), waiting])]);
}

/** Tiles in a column beside the study's chart. @param {HTMLElement[]} tiles @param {HTMLElement} chart */
function layout(tiles, chart) {
  return h('div', { class: 'study-layout' }, [h('div', { class: 'tiles stacked' }, tiles), chart]);
}

/** @param {string} label @param {string} value @param {string} unit @param {string} note @param {boolean} [hero] */
export function tile(label, value, unit, note, hero = false) {
  return h('div', { class: `tile${hero ? ' hero' : ''}`, 'data-tip': note }, [
    h('div', { class: 'tile-label', text: label }),
    h('div', { class: 'tile-value' }, [value, unit ? h('small', { text: unit }) : null]),
  ]);
}

/** @param {number | null} v */
const angle = v => (v === null ? '–' : `±${fmt(v, v < 1 ? 2 : 1)}`);

/** @param {{ design: Design, result: AcceptanceJobResult | null, state: StudyState, width: number }} props */
export function acceptanceView({ design, result, state, width }) {
  const title = 'Acceptance';
  if (!result) return placeholder(title, state, 'Acceptance shows how far the sun can be off the aperture normal before the collector loses light.');
  const a = result.acceptance;
  const points = a.angles.map((x, i) => /** @type {[number, number]} */ ([x, a.relative[i] * 100]));
  const markers = a.halfAngle90 === null ? [] : [{ x: -a.halfAngle90, label: '' }, { x: a.halfAngle90, label: '90%' }];
  return h('div', { class: 'dock-inner' }, [
    header(title, `Transmission as the sun moves off the aiming direction, at ${fmt(design.designPoint.longitudinalDeg, 0)}° along the axis`, state),
    layout([
      tile('Half-angle at 90%', angle(a.halfAngle90), '°', 'Misalignment at which transmission falls to 90% of its best', true),
      tile('Half-angle at 95%', angle(a.halfAngle95), '°', 'Misalignment at which transmission falls to 95% of its best'),
      tile('Concentration', fmt(a.concentration, 1), '×', 'Reference aperture over absorber perimeter or width'),
      tile('Concentration × acceptance', a.cap90 === null ? '–' : fmt(a.cap90, 2), '', 'C · sin θ90. The ideal limit in two dimensions is 1'),
    ], chartFrame({
      title: 'Transmission',
      subtitle: 'Optical efficiency relative to its best',
      chart: lineChart({
        series: [{ name: 'Transmission', colour: 'var(--series-1)', points }],
        x: { label: 'Misalignment (°)', format: v => fmt(v, Math.abs(a.angles.at(-1) ?? 1) < 3 ? 1 : 0) },
        y: { label: 'Transmission (%)', format: v => fmt(v, 0), domain: [0, 100], ticks: [0, 25, 50, 75, 100] },
        width: Math.max(280, width), height: 200, markers,
      }),
      table: dataTable(['Misalignment (°)', 'Transmission', 'Optical efficiency', 'Intercept factor'], a.angles.map((x, i) => [fmt(x, 3), pct(a.relative[i], 1), pct(a.efficiency[i], 1), fmt(a.intercept[i], 3)])),
    })),
  ]);
}

/** @param {{ design: Design, scene: OpticalScene | null, result: AnnualResult | null, state: StudyState, width: number }} props */
export function incidenceView({ design, scene, result, state, width }) {
  const title = 'Incidence angle';
  if (!result || !scene) return placeholder(title, state, 'The incidence study traces the collector at many sun angles. The day and year studies are built on it.');
  const g = result.grid;
  const eta0 = interpolateEta(g, g.tracking ? g.transversal[0] : 0, 0) || 1;
  const L = g.longitudinal.filter(l => l <= 85);
  /** @type {import('./charts.js').Series[]} */
  const series = g.tracking
    ? [
      { name: 'Optics', colour: SERIES[0], points: L.map(l => [l, (interpolateEta(g, g.transversal[0], l) / eta0) * 100]) },
      { name: 'With end losses', colour: SERIES[1], points: L.map(l => [l, (interpolateEta(g, g.transversal[0], l) / eta0) * endLossFactor(scene, design, l) * 100]) },
    ]
    : [
      { name: 'Across', colour: SERIES[0], points: g.transversal.filter(t => t >= 0 && t <= 85).map(t => [t, (interpolateEta(g, t, 0) / eta0) * 100]) },
      { name: 'Along', colour: SERIES[1], points: L.map(l => [l, (interpolateEta(g, 0, l) / eta0) * 100]) },
    ];
  const at = /** @param {number} deg */ deg => (g.tracking ? interpolateEta(g, g.transversal[0], deg) : interpolateEta(g, 0, deg)) / eta0;
  return h('div', { class: 'dock-inner' }, [
    header(title, g.tracking ? 'Incidence angle modifier of the tracking trough, from the traced optics' : 'Incidence angle modifiers across and along the axis', state),
    layout([
      tile('Efficiency at normal incidence', pct(eta0, 1), '', 'Optical efficiency with the sun on the aperture normal', true),
      tile('Modifier at 30°', fmt(at(30), 3), '', 'Efficiency at 30° over efficiency at normal incidence'),
      tile('Modifier at 60°', fmt(at(60), 3), '', 'Efficiency at 60° over efficiency at normal incidence'),
      tile('Row length', fmt(design.mounting.rowLength, 0), 'm', 'Used for the end-loss correction'),
    ], chartFrame({
      title: 'Incidence angle modifier',
      subtitle: scene.reference.cosine ? 'Cosine loss on the aperture is not included' : "Includes the field's cosine, shading and blocking",
      chart: lineChart({ series, x: { label: g.tracking ? 'Incidence angle (°)' : 'Angle (°)', format: v => fmt(v, 0), domain: [0, 85], ticks: [0, 15, 30, 45, 60, 75] }, y: { label: 'Modifier (%)', format: v => fmt(v, 0), domain: [0, 100], ticks: [0, 25, 50, 75, 100] }, width: Math.max(280, width), height: 210 }),
      table: dataTable(['Angle (°)', ...series.map(s => `${s.name} (%)`)], series[0].points.map(([x], i) => [fmt(x, 0), ...series.map(s => (s.points[i] ? fmt(s.points[i][1], 1) : '–'))])),
    })),
  ]);
}

/** @param {{ result: AnnualResult | null, state: StudyState, width: number }} props */
export function dayView({ result, state, width }) {
  const title = 'Day';
  if (!result) return placeholder(title, state, 'Absorbed power through the equinoxes and solstices at your site.');
  const days = result.days;
  const series = days.map((d, i) => ({ name: d.label, colour: SERIES[i], points: d.points.filter(([, q], k, all) => q > 0 || (all[k - 1]?.[1] ?? 0) > 0 || (all[k + 1]?.[1] ?? 0) > 0).map(([x, q]) => /** @type {[number, number]} */ ([x, q / 1000])) }));
  return h('div', { class: 'dock-inner' }, [
    header(title, `Absorbed power per metre of collector, local standard time, ${result.year.source === 'ASHRAE clear sky' ? 'clear sky' : `from ${result.year.source}`}`, state),
    layout(days.map((d, i) => tile(d.label, fmt(d.energy / 1000, 1), 'kWh/m', 'Energy absorbed per metre of collector over the day', i === 1)), chartFrame({
      title: 'Absorbed power',
      subtitle: 'kW per metre of collector',
      chart: lineChart({ series, x: { label: 'Hour', format: v => `${fmt(v, 0)}:00`, domain: [4, 21], ticks: [4, 6, 8, 10, 12, 14, 16, 18, 20] }, y: { label: 'kW/m', format: v => fmt(v, 1) }, width: Math.max(280, width), height: 220 }),
      table: dataTable(['Hour', ...days.map(d => `${d.label} (kW/m)`)], days[0].points.filter((_, k) => k % 3 === 0).map(([hr], k) => [`${String(Math.floor(hr)).padStart(2, '0')}:${String(Math.round((hr % 1) * 60)).padStart(2, '0')}`, ...days.map(d => fmt(d.points[k * 3][1] / 1000, 2))])),
    })),
  ]);
}

/** @param {{ design: Design, result: AnnualResult | null, state: StudyState, width: number }} props */
export function yearView({ design, result, state, width }) {
  const title = 'Year';
  if (!result) return placeholder(title, state, 'Energy absorbed over a year at your site, hour by hour.');
  const y = result.year;
  const clear = design.weather.source === 'clear-sky';
  return h('div', { class: 'dock-inner' }, [
    header(title, clear ? 'Hourly over a year with the ASHRAE clear-sky model, an upper bound with no cloud. Import a weather file for a realistic figure' : `Hourly over a typical year from ${y.source}`, state),
    layout([
      tile('Per square metre of aperture', fmt(y.perArea, 0), 'kWh/m²', 'Energy absorbed per year per square metre of reference aperture', true),
      tile('Per metre of collector', fmt(y.total / 1000, 2), 'MWh/m', 'Energy absorbed per year per metre of collector'),
      tile('Efficiency against DNI', pct(y.efficiencyVsDni, 1), '', 'Absorbed energy over DNI on the aperture area, including cosine and end losses'),
      tile('Direct normal irradiation', fmt(y.dni, 0), 'kWh/m²', clear ? 'Clear-sky model' : `From ${y.source}`),
    ], chartFrame({
      title: 'Energy by month',
      subtitle: 'kWh per metre of collector',
      chart: columnChart({ rows: y.monthly.map((v, i) => ({ label: MONTH_NAMES[i], value: v })), y: { label: 'kWh/m', format: v => fmt(v, 0) }, width: Math.max(280, width), height: 210, colour: 'var(--sun)' }),
      table: dataTable(['Month', 'kWh per metre', 'kWh per m² of aperture'], y.monthly.map((v, i) => [MONTH_NAMES[i], fmt(v, 1), fmt(v / (y.total / y.perArea || 1), 1)])),
    })),
  ]);
}
