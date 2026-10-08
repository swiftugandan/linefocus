/** Results for the design-point trace: headline figures, where the sunlight goes, and the flux on the absorber. */

import { h, fmt, pct } from './dom.js';
import { barList, lineChart, chartFrame, dataTable } from './charts.js';

/** @import { DesignPointResult } from '../worker/protocol.js' */
/** @import { Design } from '../core/model.js' */
/** @import { Bucket, FluxMap } from '../core/types.js' */

/** Ledger rows in a fixed order, with plain names. */
/** @type {[Bucket | 'gaps', string, string][]} */
export const LEDGER_ROWS = [
  ['absorbed', 'Absorbed', 'Power absorbed by the absorber'],
  ['gaps', 'Cosine and gaps', 'Sun on the mirror area that the tilted rows do not intercept'],
  ['spillage', 'Spilled past receiver', 'Reflected light that misses the absorber'],
  ['reflectorAbsorption', 'Absorbed by mirrors', '1 − ρ at each mirror reflection'],
  ['glassReflection', 'Reflected by glass', 'Fresnel reflection at the envelope or cover'],
  ['glassAbsorption', 'Lost in glass', 'Absorbed in the glass, or 1 − τ in fixed mode'],
  ['absorberReflection', 'Reflected by absorber', '1 − α at the absorber'],
  ['shading', 'Shaded by rows', 'Sunlight stopped by the back of a mirror row'],
  ['blocking', 'Blocked by rows', 'Reflected light stopped by the back of a mirror row'],
  ['receiverShading', 'Shaded by receiver', 'Sunlight stopped by the receiver housing'],
  ['trapped', 'Trapped', 'Rays that bounced more than 64 times'],
];

/**
 * Ledger shares of the reference power. "Cosine and gaps" is what the field does not intercept.
 * @param {DesignPointResult} result
 */
export function ledgerShares(result) {
  const t = result.trace;
  const ref = t.reference;
  if (!(ref > 0)) return [];
  const intercepted = Object.entries(t.ledger).reduce((sum, [k, v]) => (k === 'missed' ? sum : sum + v), 0);
  const gaps = Math.max(0, ref - intercepted);
  return LEDGER_ROWS.map(([key, label, note]) => ({ key, label, note, share: (key === 'gaps' ? gaps : t.ledger[key]) / ref }))
    .filter(row => row.key === 'absorbed' || row.share >= 0.0005);
}

/**
 * Local concentration ratio around the absorber.
 * @param {FluxMap} map @param {number} dni @param {number} radius metres, for angle maps
 * @returns {[number, number][]}
 */
export function concentrationProfile(map, dni, radius) {
  return map.power.map((p, i) => {
    const width = map.kind === 'angle' ? radius * map.step : map.step;
    const x = map.kind === 'angle' ? ((map.start + (i + 0.5) * map.step) * 180) / Math.PI : (map.start + (i + 0.5) * map.step) * 1000;
    return /** @type {[number, number]} */ ([x, dni > 0 ? p / width / dni : 0]);
  });
}

/**
 * @param {{ design: Design, result: DesignPointResult | null, error: string | null, running: boolean, width: number }} state
 */
export function designPointView({ design, result, error, running, width }) {
  const p = design.designPoint;
  const header = h('div', { class: 'dock-title' }, [
    h('h3', { text: 'Design point' }),
    h('p', { text: `Sun ${fmt(p.transversalDeg, 1)}° across and ${fmt(p.longitudinalDeg, 1)}° along the axis, DNI ${fmt(p.dni, 0)} W/m²` }),
  ]);
  if (error) return h('div', { class: 'dock-inner' }, [header, h('div', { class: 'error-note', text: error })]);
  if (!result) {
    return h('div', { class: 'dock-inner' }, [header, h('div', { class: 'empty-state' }, [h('strong', { text: running ? 'Tracing the design point…' : 'No trace yet' }), running ? 'Results appear here as soon as the first rays are in.' : 'Change any value to trace the design.'])]);
  }
  const t = result.trace;
  const absorbedKw = t.ledger.absorbed / 1000;
  const map = t.flux[0];
  const absorber = result.scene.surfaces.find(s => s.id === map?.surfaceId);
  const radius = absorber?.shape.kind === 'circle' ? absorber.shape.r : 0;
  const profile = map ? concentrationProfile(map, design.designPoint.dni, radius) : [];
  const peak = profile.reduce((m, [, v]) => Math.max(m, v), 0);

  const tiles = h('div', { class: 'tiles' }, [
    tile('Optical efficiency', pct(t.efficiency, 1), '', 'Absorbed ÷ sunlight on the aperture', true),
    tile('Intercept factor', fmt(t.intercept, 3), '', 'Reflected light reaching the absorber'),
    tile('Absorbed', fmt(absorbedKw, 2), 'kW/m', 'Per metre of collector'),
    tile('Peak concentration', fmt(peak, 0), '×', 'Highest local flux over DNI'),
  ]);

  const rows = ledgerShares(result);
  const ledger = chartFrame({
    title: 'Where the sunlight goes',
    subtitle: `Share of ${fmt(t.reference / 1000, 2)} kW/m on the aperture`,
    chart: barList({ rows: rows.map(r => ({ label: r.label, value: r.share, emphasis: r.key === 'absorbed', note: r.note })), max: 1, width: Math.max(260, width), format: v => pct(v, v < 0.01 ? 2 : 1) }),
    table: dataTable(['Destination', 'Share', 'kW/m'], rows.map(r => [r.label, pct(r.share, 2), fmt((r.share * t.reference) / 1000, 3)])),
  });

  const angle = map?.kind === 'angle';
  const flux = map ? chartFrame({
    title: 'Flux on the absorber',
    subtitle: angle ? 'Around the tube; 0° faces the mirror' : 'Across the absorber plate',
    chart: lineChart({
      series: [{ name: 'Local concentration', colour: 'var(--sun-strong)', points: profile }],
      x: { label: angle ? 'Angle around the tube (°)' : 'Position (mm)', format: v => fmt(v, 0), domain: angle ? [0, 360] : [profile[0]?.[0] ?? 0, profile.at(-1)?.[0] ?? 1], ...(angle ? { ticks: [0, 90, 180, 270, 360] } : {}) },
      y: { label: 'Suns', format: v => fmt(v, 0) },
      width: Math.max(260, width), height: 172,
    }),
    table: dataTable([angle ? 'Angle (°)' : 'Position (mm)', 'Concentration (×)', 'Flux (kW/m²)'], profile.map(([x, c]) => [fmt(x, 1), fmt(c, 1), fmt((c * design.designPoint.dni) / 1000, 2)])),
  }) : null;

  return h('div', { class: 'dock-inner' }, [header, tiles, h('div', { class: 'charts' }, [ledger, flux])]);
}

/** @param {string} label @param {string} value @param {string} unit @param {string} note @param {boolean} [hero] */
function tile(label, value, unit, note, hero = false) {
  return h('div', { class: `tile${hero ? ' hero' : ''}`, 'data-tip': note }, [
    h('div', { class: 'tile-label', text: label }),
    h('div', { class: 'tile-value' }, [value, unit ? h('small', { text: unit }) : null]),
  ]);
}
