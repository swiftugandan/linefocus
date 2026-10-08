import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nelderMead, optimise, sunBins, variablesFor } from '../src/core/optimise.js';
import { defaultDesign } from '../src/core/model.js';

test('Nelder–Mead finds the minimum of a quadratic bowl inside the unit box', async () => {
  const target = [0.3, 0.72, 0.55];
  const f = async x => x.reduce((s, v, i) => s + (i + 1) * (v - target[i]) ** 2, 0);
  const r = await nelderMead(f, [0.9, 0.1, 0.5], { maxEvaluations: 400 });
  r.x.forEach((v, i) => assert.ok(Math.abs(v - target[i]) < 0.01, `x${i} ${v}`));
});

test('candidates that break a design rule are penalised, not fatal', async () => {
  const d = defaultDesign();
  // A 2–8 m aperture with a tube up to 7 m wide: many candidates are invalid.
  const r = await optimise(d, { objective: 'efficiency', variables: [{ path: 'receiver.absorberDiameter', min: 0.02, max: 0.5 }, { path: 'collector.apertureWidth', min: 0.2, max: 8 }], maxEvaluations: 25, rays: 4096 });
  assert.ok(r && Number.isFinite(r.best.score));
});

test('optimising an LFR receiver height finds the same interior optimum from either side', async () => {
  // Cylindrical rows with a 15 m radius focus at about 7.5 m: too low and rows block each other, too high and the
  // image outgrows the receiver. A scan with the same random rays brackets the optimum between 6 and 8 m.
  const { switchVariant } = await import('../src/core/model.js');
  const run = async h0 => {
    const d = defaultDesign(); switchVariant(d, 'collector', 'fresnel'); d.collector.receiverHeight = h0;
    const r = await optimise(d, { objective: 'efficiency', variables: [{ path: 'collector.receiverHeight', min: 3, max: 14 }], maxEvaluations: 30, rays: 20000 });
    return r;
  };
  const [low, high] = [await run(4.5), await run(12)];
  const [a, b] = [low?.best.values[0] ?? NaN, high?.best.values[0] ?? NaN];
  assert.ok(Math.abs(a - b) < 0.5, `from 4.5 m: ${a}, from 12 m: ${b}`);
  assert.ok(a > 6 && a < 8, `optimum ${a}`);
  assert.ok((low?.best.score ?? 0) > (low?.start.score ?? 0) + 3, 'a real improvement from a poor start');
});

test('the trough focal length has a flat optimum, which the confirmation reports as within noise', async () => {
  const d = defaultDesign();
  const r = await optimise(d, { objective: 'efficiency', variables: [{ path: 'collector.focalLength', min: 1.0, max: 2.5 }], maxEvaluations: 20, rays: 20000 });
  assert.ok(r);
  // Confirmed gain is no more than a few sampling-noise widths: no claim of a meaningful improvement.
  assert.ok(Math.abs(r.confirmation.best - r.confirmation.start) < 1, `gain ${r.confirmation.best - r.confirmation.start}`);
});

test('sun bins keep the year\'s energy in a few dozen angles', () => {
  const bins = sunBins(defaultDesign());
  assert.ok(bins.length > 3 && bins.length < 60, `${bins.length} bins`);
  assert.ok(bins.every(b => Math.abs(b.transversalDeg) < 1e-9), 'a tracking trough sees no transversal angle');
});

test('variables default to a range around the current value', () => {
  const vars = variablesFor(defaultDesign());
  const f = vars.find(v => v.path === 'collector.focalLength');
  assert.ok(f && f.min < 1.71 && f.max > 1.71);
});
