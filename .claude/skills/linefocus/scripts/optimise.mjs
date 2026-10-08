#!/usr/bin/env node
// Optimise a Linefocus design with the app's own optimiser, from the command line.
//
//   node optimise.mjs design.linefocus.json --objective annualPerArea \
//     --vary collector.apertureWidth=3..7 --vary collector.focalLength=1..2.2 [--out better.linefocus.json]
//
// Objectives: efficiency, annualPerArea, annualPerLength (trough, CPC), annualPerLand (LFR), cap.
// Each --vary names a design field and its range, in the file's units (metres, degrees, fractions).
// Prints the search, the confirmed result against sampling noise, and any value that stopped at a range limit.
// With --out it writes the optimised design, but only when the gain is larger than twice the noise.
import { readFileSync, writeFileSync } from 'node:fs';
import { core } from './checkout.mjs';

const model = await core('model.js');
const { optimise, OBJECTIVES, objectivesFor } = await core('optimise.js');

const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith('--') && !args[args.indexOf(a) - 1]?.startsWith('--'));
const value = flag => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
const all = flag => args.flatMap((a, i) => (a === flag ? [args[i + 1]] : []));
if (!file) { console.error('Usage: node optimise.mjs design.linefocus.json --objective <name> --vary path=min..max [--vary …] [--out file]'); process.exit(2); }

const design = model.parseDesign(readFileSync(file, 'utf8'));
const objective = value('--objective') ?? 'annualPerArea';
if (!objectivesFor(design.collector.type).includes(objective)) {
  console.error(`"${objective}" isn't an objective for a ${design.collector.type}. Use one of: ${objectivesFor(design.collector.type).join(', ')}.`);
  process.exit(2);
}
const variables = all('--vary').map(spec => {
  const match = /^([\w.]+)=(-?[\d.]+)\.\.(-?[\d.]+)$/.exec(spec ?? '');
  if (!match) { console.error(`Can't read --vary ${spec}. Write it as path=min..max, for example collector.focalLength=1..2.5`); process.exit(2); }
  return { path: match[1], min: Number(match[2]), max: Number(match[3]) };
});
if (!variables.length) { console.error('Name at least one value to vary with --vary path=min..max.'); process.exit(2); }

const maxEvaluations = Number(value('--evaluations') ?? 30 + 25 * variables.length);
const started = Date.now();
let last = 0;
const result = await optimise(design, { objective, variables, maxEvaluations }, async (best, count) => {
  if (count >= maxEvaluations) process.stderr.write('  confirming with fresh rays…\n');
  else if (count - last >= 10) { process.stderr.write(`  candidate ${count}: best ${best.toFixed(3)}\n`); last = count; }
  return true;
});
if (!result) { console.error('The optimiser stopped before finishing.'); process.exit(1); }

const o = OBJECTIVES[objective];
const gain = result.confirmation.best - result.confirmation.start, noise = result.confirmation.noise;
const real = gain > 2 * noise;
console.log(`Objective: ${o.label}${o.unit ? ` (${o.unit})` : ''}. ${result.evaluations} candidates in ${((Date.now() - started) / 1000).toFixed(0)} s${result.bins ? `, ${result.bins} sun positions for the year` : ''}.`);
for (const [i, v] of result.variables.entries()) {
  const edge = (result.best.values[i] - v.min) / (v.max - v.min);
  const limit = edge < 0.01 ? '  (at the lowest limit)' : edge > 0.99 ? '  (at the highest limit)' : '';
  console.log(`  ${v.path}: ${result.start.values[i]} → ${+result.best.values[i].toPrecision(5)}${limit}`);
}
console.log(real
  ? `Confirmed: ${result.confirmation.start.toFixed(2)} → ${result.confirmation.best.toFixed(2)}, a gain of ${gain.toFixed(2)} against sampling noise of about ±${noise.toFixed(2)}.`
  : `No gain beyond sampling noise (±${noise.toFixed(2)}): the design is already at or near the best in these ranges.`);
const out = value('--out');
if (out && real) {
  const better = structuredClone(design);
  result.variables.forEach((v, i) => model.setPath(better, v.path, result.best.values[i]));
  writeFileSync(out, model.serializeDesign(model.validateDesign(better)));
  console.log(`Wrote ${out}.`);
} else if (out) console.log(`Did not write ${out}: there is no real gain to keep.`);
