#!/usr/bin/env node
// Check Linefocus designs with the app's own loader and engine, and report the figures an engineer reads.
//
//   node verify.mjs design.linefocus.json                 # check one design and print a report
//   node verify.mjs a.linefocus.json b.linefocus.json     # check several and compare them side by side
//   node verify.mjs design.linefocus.json --json out.json # also write the full report as JSON
//
// For each design it runs, with the checkout's modules: the loader (parseDesign), the design-point trace at the
// design's ray count with two seeds (so the report shows the sampling noise), the acceptance study, and the
// incidence grid with the day and year studies. It then applies engineering checks and prints errors, warnings and
// notes. Exits 1 when any design has an error.
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { core } from './checkout.mjs';

const model = await core('model.js');
const { buildDesignScene, designPointOptions, combinedErrorMrad } = await core('design-scene.js');
const { trace, BUCKETS } = await core('tracer.js');
const studies = await core('studies.js');
const { LEDGER_ROWS } = await core('ledger.js');
const LABEL = Object.fromEntries(LEDGER_ROWS.map(([key, label]) => [key, label.toLowerCase()]));

const COLLECTORS = { trough: 'parabolic trough', fresnel: 'linear Fresnel reflector', cpc: 'compound parabolic concentrator' };
const pct = (v, d = 1) => `${(v * 100).toFixed(d)}%`;
const num = (v, d = 0) => v.toLocaleString('en-GB', { minimumFractionDigits: d, maximumFractionDigits: d });

/** @param {string} path */
async function verify(path) {
  const findings = [];
  const add = (level, message) => findings.push({ level, message });
  let design;
  const text = readFileSync(path, 'utf8');
  try { design = model.parseDesign(text); } catch (error) {
    add('error', `The app refuses to open this file: ${error.message}`);
    return { path, findings };
  }
  if (model.serializeDesign(design) !== text) add('note', 'The file is valid but not in canonical form; save it with the builder or the app to keep diffs clean.');

  const { scene, figures } = buildDesignScene(design);
  const options = designPointOptions(design);
  const t = trace(scene, options);
  const twin = trace(scene, { ...options, seed: (options.seed + 7919) >>> 0 });
  const noise = Math.abs(t.efficiency - twin.efficiency);
  const closure = Math.abs(BUCKETS.reduce((s, b) => s + t.ledger[b], 0) - t.launched) / t.launched;
  if (closure > 1e-9) add('error', `The energy ledger doesn't close (${closure}). Report this as a Linefocus bug.`);
  const acceptance = await studies.acceptanceStudy(design, scene);
  const grid = await studies.iamGrid(design, scene);
  const year = studies.yearStudy(design, scene, grid);
  const days = studies.dayStudy(design, scene, grid);
  const share = b => (t.reference > 0 ? t.ledger[b] / t.reference : 0);
  const c = design.collector, r = design.receiver;

  // Engineering checks. Thresholds are rules of thumb for concept design, stated in the messages.
  if (t.intercept < 0.9) {
    const advice = c.type === 'cpc'
      ? (r.type === 'tube' && r.envelope.mode !== 'none' ? 'In a tube CPC most of the loss is light slipping through the gap between the glass envelope and the absorber: a larger absorber or a smaller envelope and clearance narrow it.' : 'Reduce the clearance gap, or check the acceptance angle against the sun angle.')
      : c.type === 'fresnel' ? 'Widen the receiver or the cavity mouth, match the row curvature to the receiver height, or lower the slope error.'
        : 'Widen the absorber, shorten the focal length, or lower the slope error.';
    add('warning', `Only ${pct(t.intercept)} of reflected light reaches the absorber (intercept factor ${t.intercept.toFixed(3)}); most collectors aim for 0.9 or more. ${advice}`);
  }
  if (noise > 0.005) add('warning', `Two seeds disagree by ${pct(noise, 2)} at the design point. Raise simulation.rays for firmer figures.`);
  if (share('receiverShading') > 0.08) add('warning', `The receiver shades ${pct(share('receiverShading'))} of the sunlight on the aperture.`);
  if (c.type === 'trough') {
    const rim = figures.find(f => f.key === 'rimAngle')?.value ?? 0;
    if (rim < 60 || rim > 120) add('note', `The rim angle is ${rim.toFixed(0)}°. Commercial troughs sit between about 70° and 110°; outside that, check the structure and the receiver size.`);
  }
  if (c.type === 'fresnel') {
    const blocked = share('shading') + share('blocking');
    if (blocked > 0.03) add('warning', `Rows shade or block ${pct(blocked)} of the light at the design point. Increase the pitch or raise the receiver.`);
    const outer = figures.find(f => f.key === 'rim')?.value ?? 0;
    if (outer > 50) add('note', `The outer rows look at the receiver from ${outer.toFixed(0)}° off vertical; their images spread and their cosine loss grows.`);
    if (c.mirrorWidth / c.pitch < 0.5) add('note', `Ground cover is ${pct(c.mirrorWidth / c.pitch)}; much of the land under the field collects nothing.`);
  }
  if (c.type === 'cpc') {
    if (c.truncation < 0.35) add('note', `Only ${pct(c.truncation, 0)} of the full CPC height is kept, so the reflector does little concentrating.`);
    const lat = Math.abs(design.site.latitude), tilt = Math.abs(design.mounting.tiltDeg);
    if (design.mounting.axisAzimuthDeg === 90 && Math.abs(lat - tilt) > c.acceptanceHalfAngleDeg - 23.5) add('warning', `With a ${tilt}° tilt at latitude ${lat.toFixed(1)}° and ±${c.acceptanceHalfAngleDeg}° acceptance, the noon sun leaves the acceptance window for part of the year.`);
  }
  if (design.optics.reflectance > 0.97) add('note', `A mirror reflectance of ${pct(design.optics.reflectance)} is optimistic for a clean silvered glass mirror (about 0.93–0.95 new).`);
  if (r.absorptance > 0.98) add('note', `An absorptance of ${pct(r.absorptance)} is optimistic; selective coatings reach about 0.94–0.96.`);
  if (design.weather.source === 'clear-sky') add('note', 'Year figures use the clear-sky model, an upper bound with no cloud. Import an EPW weather file for a realistic yield.');
  if (acceptance?.halfAngle90 !== null && acceptance?.halfAngle90 !== undefined && c.type !== 'cpc' && acceptance.halfAngle90 < 0.3) add('warning', `The 90% acceptance half-angle is only ±${acceptance.halfAngle90.toFixed(2)}°; tracking and structural errors will cost energy.`);

  return {
    path, title: design.title, collector: c.type, findings,
    figures: Object.fromEntries(figures.map(f => [f.key, { label: f.label, value: f.value, unit: f.unit }])),
    designPoint: {
      transversalDeg: options.transversalDeg, longitudinalDeg: options.longitudinalDeg, dni: options.dni, rays: t.rays,
      efficiency: t.efficiency, efficiencyNoise: noise, intercept: t.intercept, absorbedWPerM: t.ledger.absorbed,
      referenceWPerM: t.reference, referenceIncludesCosine: scene.reference.cosine,
      ledger: Object.fromEntries(BUCKETS.filter(b => b !== 'missed').map(b => [b, share(b)])),
      combinedOpticalErrorMrad: combinedErrorMrad(design),
    },
    acceptance: acceptance && { halfAngle95: acceptance.halfAngle95, halfAngle90: acceptance.halfAngle90, concentration: acceptance.concentration, cap90: acceptance.cap90 },
    year: { kWhPerM2Aperture: year.perArea, kWhPerMetre: year.total, efficiencyVsDni: year.efficiencyVsDni, dniKWhPerM2: year.dni, monthlyKWhPerMetre: year.monthly, weather: year.source, site: design.site.name },
    days: days.map(d => ({ day: d.label, kWhPerMetre: d.energy / 1000 })),
  };
}

/** @param {any} r */
function report(r) {
  const lines = [];
  if (!r.title) {
    lines.push(`✗ ${basename(r.path)}`);
    for (const f of r.findings) lines.push(`  ${f.level}: ${f.message}`);
    return lines.join('\n');
  }
  const p = r.designPoint, a = r.acceptance, y = r.year;
  lines.push(`${r.title} — ${COLLECTORS[r.collector]} (${basename(r.path)})`);
  lines.push(`  Loads in Linefocus unchanged.`);
  lines.push(`  Geometry: ${Object.values(r.figures).map(f => `${f.label.toLowerCase()} ${num(f.value, f.unit === '°' || f.unit === '%' ? 1 : f.value < 10 ? 2 : 0)}${f.unit === '%' || f.unit === '°' ? '' : ' '}${f.unit}`).join(', ')}`);
  lines.push(`  Design point (sun ${p.transversalDeg.toFixed(1)}° across, ${p.longitudinalDeg.toFixed(1)}° along, DNI ${p.dni} W/m², ${num(p.rays)} rays):`);
  lines.push(`    optical efficiency ${pct(p.efficiency)} ±${pct(p.efficiencyNoise, 2)} (of DNI on the ${p.referenceIncludesCosine ? 'aperture, with cos θ' : 'mirror area, without cos θ'}), intercept factor ${p.intercept.toFixed(3)}, absorbed ${num(p.absorbedWPerM / 1000, 2)} kW/m`);
  const losses = Object.entries(p.ledger).filter(([k, v]) => k !== 'absorbed' && v >= 0.002).sort((x, y2) => y2[1] - x[1]).map(([k, v]) => `${LABEL[k] ?? k} ${pct(v)}`);
  if (losses.length) lines.push(`    losses: ${losses.join(', ')}`);
  if (a) lines.push(`  Acceptance: ±${a.halfAngle90?.toFixed(2) ?? '–'}° at 90%, ±${a.halfAngle95?.toFixed(2) ?? '–'}° at 95%, C·sin θ90 ${a.cap90?.toFixed(2) ?? '–'}`);
  lines.push(`  Year at ${y.site} (${y.weather}): ${num(y.kWhPerM2Aperture)} kWh/m² of aperture, ${num(y.kWhPerMetre)} kWh per metre, ${pct(y.efficiencyVsDni)} of DNI, from ${num(y.dniKWhPerM2)} kWh/m² DNI`);
  lines.push(`  Days: ${r.days.map(d => `${d.day} ${d.kWhPerMetre.toFixed(1)} kWh/m`).join(', ')}`);
  for (const f of r.findings) lines.push(`  ${f.level === 'warning' ? '⚠' : f.level === 'error' ? '✗' : '·'} ${f.message}`);
  return lines.join('\n');
}

/** @param {any[]} results */
function comparison(results) {
  const ok = results.filter(r => r.title);
  if (ok.length < 2) return '';
  const rows = [
    ['Design', ...ok.map(r => r.title)],
    ['Collector', ...ok.map(r => COLLECTORS[r.collector])],
    ['Optical efficiency', ...ok.map(r => pct(r.designPoint.efficiency))],
    ['Intercept factor', ...ok.map(r => r.designPoint.intercept.toFixed(3))],
    ['Acceptance at 90%', ...ok.map(r => (r.acceptance?.halfAngle90 != null ? `±${r.acceptance.halfAngle90.toFixed(2)}°` : '–'))],
    ['kWh/m² aperture a year', ...ok.map(r => num(r.year.kWhPerM2Aperture))],
    ['kWh per metre a year', ...ok.map(r => num(r.year.kWhPerMetre))],
    ['Share of DNI', ...ok.map(r => pct(r.year.efficiencyVsDni))],
  ];
  const widths = rows[0].map((_, i) => Math.max(...rows.map(row => String(row[i]).length)));
  return '\n' + rows.map((row, k) => {
    const line = row.map((cell, i) => String(cell).padEnd(widths[i])).join('  ');
    return k === 0 ? `${line}\n${widths.map(w => '-'.repeat(w)).join('  ')}` : line;
  }).join('\n');
}

const args = process.argv.slice(2);
const jsonAt = args.indexOf('--json');
const jsonPath = jsonAt >= 0 ? args[jsonAt + 1] : null;
const files = args.filter((a, i) => !a.startsWith('--') && (jsonAt < 0 || i !== jsonAt + 1));
if (!files.length) { console.error('Usage: node verify.mjs design.linefocus.json [more.linefocus.json …] [--json report.json]'); process.exit(2); }
const results = [];
for (const file of files) results.push(await verify(file));
console.log(results.map(report).join('\n\n') + comparison(results));
if (jsonPath) writeFileSync(jsonPath, JSON.stringify(results.length === 1 ? results[0] : results, null, 2) + '\n');
const errors = results.reduce((n, r) => n + r.findings.filter(f => f.level === 'error').length, 0);
process.exit(errors ? 1 : 0);
