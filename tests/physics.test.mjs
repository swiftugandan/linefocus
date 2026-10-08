import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rng } from '../src/core/rng.js';
import { radialSampler, sunshapeSigmaMrad } from '../src/core/sunshape.js';
import { trace, fresnelReflectance, crossDielectric, reflectWithErrors, perpendicularBasis, BUCKETS } from '../src/core/tracer.js';
import { buildTrough, troughMinimumDiameter, troughRimAngle } from '../src/core/collectors/trough.js';

const PILLBOX = { shape: 'pillbox', halfAngleMrad: 4.65 };
const IDEAL_OPTICS = { reflectance: 1, slopeErrorMrad: 0, specularityMrad: 0 };
const BARE_TUBE = d => ({ type: 'tube', absorberDiameter: d, absorptance: 1, envelope: { mode: 'none', outerDiameter: 0, thickness: 0, refractiveIndex: 1.5, extinction: 0, transmittance: 1 } });
const TROUGH = { type: 'trough', apertureWidth: 5.77, focalLength: 1.71 };
const sum = values => values.reduce((a, b) => a + b, 0);
const ledgerTotal = result => sum(BUCKETS.map(b => result.ledger[b]));

test('the generator is deterministic and roughly uniform and normal', () => {
  const a = new Rng(42), b = new Rng(42);
  for (let i = 0; i < 100; i++) assert.equal(a.next(), b.next());
  const rng = new Rng(7);
  let mean = 0, m2 = 0;
  const n = 200000;
  for (let i = 0; i < n; i++) { const x = rng.normal(); mean += x; m2 += x * x; }
  mean /= n;
  assert.ok(Math.abs(mean) < 0.01);
  assert.ok(Math.abs(Math.sqrt(m2 / n) - 1) < 0.01);
});

test('perpendicular bases are orthonormal', () => {
  for (const v of [[0, -1, 0], [0.6, -0.8, 0], [0.3, -0.5, 0.812404]]) {
    const len = Math.hypot(...v); const [x, y, z] = v.map(c => c / len);
    const [ax, ay, az, bx, by, bz] = perpendicularBasis(x, y, z);
    assert.ok(Math.abs(ax * x + ay * y + az * z) < 1e-12);
    assert.ok(Math.abs(bx * x + by * y + bz * z) < 1e-12);
    assert.ok(Math.abs(ax * bx + ay * by + az * bz) < 1e-12);
    assert.ok(Math.abs(Math.hypot(ax, ay, az) - 1) < 1e-12 && Math.abs(Math.hypot(bx, by, bz) - 1) < 1e-12);
  }
});

test('Fresnel reflectance matches ((n−1)/(n+1))² at normal incidence and is total beyond the critical angle', () => {
  assert.ok(Math.abs(fresnelReflectance(1, 1.5, 1) - 0.04) < 1e-12);
  assert.ok(Math.abs(fresnelReflectance(1.5, 1, 1) - 0.04) < 1e-12);
  const critical = Math.asin(1 / 1.5);
  assert.equal(fresnelReflectance(1.5, 1, Math.cos(critical + 0.01)), 1);
  assert.ok(fresnelReflectance(1.5, 1, Math.cos(critical - 0.01)) < 1);
});

test('refraction of an oblique ray follows the Bravais effective index in projection', () => {
  const n = 1.5, longitudinal = 0.6, a = 0.4;
  const d = [Math.cos(longitudinal) * Math.sin(a), -Math.cos(longitudinal) * Math.cos(a), Math.sin(longitudinal)];
  const transmit = { next: () => 0.999999 };
  const out = crossDielectric(d[0], d[1], d[2], 0, 1, true, { kind: 'dielectric', front: { n: 1, k: 0 }, back: { n, k: 0 } }, transmit);
  assert.equal(out.reflected, false);
  assert.ok(Math.abs(Math.hypot(out.dx, out.dy, out.dz) - 1) < 1e-12);
  const projected = Math.atan2(out.dx, -out.dy);
  const bravais = Math.sqrt(n * n - Math.sin(longitudinal) ** 2) / Math.cos(longitudinal);
  assert.ok(Math.abs(Math.sin(a) - bravais * Math.sin(projected)) < 1e-12);
});

test('a slope error σ spreads the reflected ray by 2σ', () => {
  const rng = new Rng(3), sigma = 2;
  const mirror = { kind: 'mirror', reflectance: 1, slopeErrorMrad: sigma, specularityMrad: 0 };
  let m2 = 0; const n = 100000;
  for (let i = 0; i < n; i++) {
    const [rx, ry] = reflectWithErrors(0, -1, 0, 0, 1, mirror, rng);
    const angle = Math.atan2(rx, ry);
    m2 += angle * angle;
  }
  const spread = Math.sqrt(m2 / n) * 1e3;
  assert.ok(Math.abs(spread - 2 * sigma) / (2 * sigma) < 0.02, `spread ${spread} mrad`);
});

test('sunshape samplers stay within their bounds and report sensible spreads', () => {
  const rng = new Rng(11);
  const pill = radialSampler(PILLBOX);
  for (let i = 0; i < 10000; i++) assert.ok(pill(rng) <= 4.65e-3);
  const buie = radialSampler({ shape: 'buie', csr: 0.05 });
  let inside = 0;
  for (let i = 0; i < 20000; i++) { const r = buie(rng); assert.ok(r <= 43.6e-3 + 1e-12); if (r <= 4.65e-3) inside++; }
  // With χ = 5% of the energy in the aureole, about 95% of samples land on the disc.
  assert.ok(Math.abs(inside / 20000 - 0.95) < 0.01, `disc fraction ${inside / 20000}`);
  assert.ok(Math.abs(sunshapeSigmaMrad(PILLBOX) - 2.325) < 1e-9);
  assert.ok(sunshapeSigmaMrad({ shape: 'buie', csr: 0.1 }) > sunshapeSigmaMrad({ shape: 'buie', csr: 0.02 }));
});

test('every launched watt ends in exactly one ledger bucket', () => {
  const receiver = { type: 'tube', absorberDiameter: 0.07, absorptance: 0.95, envelope: { mode: 'physical', outerDiameter: 0.125, thickness: 0.003, refractiveIndex: 1.47, extinction: 4, transmittance: 1 } };
  const scene = buildTrough(TROUGH, receiver, { reflectance: 0.93, slopeErrorMrad: 3, specularityMrad: 0.5 });
  for (const [t, l] of [[0, 0], [0.3, 30], [-1.2, 60], [5, 10]]) {
    const result = trace(scene, { sun: { shape: 'buie', csr: 0.05 }, transversalDeg: t, longitudinalDeg: l, dni: 1000, rays: 20000, seed: 1 });
    assert.ok(Math.abs(ledgerTotal(result) - result.launched) / result.launched < 1e-9, `θT=${t} θL=${l}`);
  }
});

test('an ideal trough intercepts everything when the tube is at least the minimum diameter', () => {
  const dMin = troughMinimumDiameter(TROUGH, 4.65e-3);
  assert.ok(Math.abs(troughRimAngle(TROUGH) * 180 / Math.PI - 80.3) < 0.1);
  const options = { sun: PILLBOX, transversalDeg: 0, longitudinalDeg: 0, dni: 1000, rays: 40000, seed: 5 };
  const atMin = trace(buildTrough(TROUGH, BARE_TUBE(dMin * 1.02), IDEAL_OPTICS), options);
  assert.ok(atMin.intercept > 0.9999, `γ = ${atMin.intercept}`);
  // Every ray through the aperture is absorbed, directly or after one reflection.
  assert.ok(Math.abs(atMin.efficiency - 1) < 0.002, `η = ${atMin.efficiency}`);
  // Just below the minimum, rays from the rim start to miss; at half size most of the rim is lost.
  const below = trace(buildTrough(TROUGH, BARE_TUBE(dMin * 0.9), IDEAL_OPTICS), options);
  assert.ok(below.intercept < 0.999, `γ = ${below.intercept}`);
  const half = trace(buildTrough(TROUGH, BARE_TUBE(dMin * 0.5), IDEAL_OPTICS), options);
  assert.ok(half.intercept < 0.9 && half.intercept > 0.6, `γ = ${half.intercept}`);
});

test('the same seed gives identical results', () => {
  const scene = buildTrough(TROUGH, BARE_TUBE(0.07), { reflectance: 0.94, slopeErrorMrad: 2.5, specularityMrad: 0 });
  const options = { sun: PILLBOX, transversalDeg: 0.1, longitudinalDeg: 20, dni: 900, rays: 5000, seed: 99, pathCount: 10 };
  assert.deepEqual(trace(scene, options), trace(scene, options));
});

/** Error function (Abramowitz–Stegun 7.1.26 is too coarse here; use a series/continued-fraction pair). */
function erf(x) {
  const sign = Math.sign(x); x = Math.abs(x);
  if (x < 3) { let term = x, total = x; for (let n = 1; n < 80; n++) { term *= -x * x / n; total += term / (2 * n + 1); } return sign * total * 2 / Math.sqrt(Math.PI); }
  return sign * (1 - Math.exp(-x * x) / (x * Math.sqrt(Math.PI)) * (1 - 1 / (2 * x * x)));
}

test('trough intercept matches the semi-analytic Gaussian result', () => {
  // With a Gaussian sun and slope error, a ray leaving the mirror at x has a Gaussian transversal error with
  // σ = √(σsun² + 4σslope²) and reaches a tube of radius r at distance d when |error| < asin(r/d).
  const r = 0.035, sigmaSun = 2.5, slope = 3;
  const scene = buildTrough(TROUGH, BARE_TUBE(2 * r), { reflectance: 1, slopeErrorMrad: slope, specularityMrad: 0 });
  const result = trace(scene, { sun: { shape: 'gaussian', sigmaMrad: sigmaSun }, transversalDeg: 0, longitudinalDeg: 0, dni: 1000, rays: 400000, seed: 21 });
  const sigma = Math.hypot(sigmaSun, 2 * slope) * 1e-3, f = TROUGH.focalLength, half = TROUGH.apertureWidth / 2;
  let num = 0, den = 0; const n = 20000;
  for (let i = 0; i < n; i++) {
    const x = r + (half - r) * (i + 0.5) / n, d = f + x * x / (4 * f);
    num += erf(Math.asin(r / d) / (sigma * Math.SQRT2)); den += 1;
  }
  const expected = num / den;
  assert.ok(Math.abs(result.intercept - expected) < 0.003, `γ traced ${result.intercept.toFixed(4)} vs analytic ${expected.toFixed(4)}`);
});

test('a trace split into block-aligned chunks equals one uninterrupted trace', async () => {
  const { mergeTraces, RAY_BLOCK } = await import('../src/core/tracer.js');
  const scene = buildTrough(TROUGH, BARE_TUBE(0.07), { reflectance: 0.94, slopeErrorMrad: 2.5, specularityMrad: 0.3 });
  const options = { sun: { shape: 'buie', csr: 0.05 }, transversalDeg: 0.2, longitudinalDeg: 25, dni: 900, rays: 3 * RAY_BLOCK + 1000, seed: 4, pathCount: 40 };
  const whole = trace(scene, options);
  const parts = [[0, RAY_BLOCK], [RAY_BLOCK, 3 * RAY_BLOCK], [3 * RAY_BLOCK, options.rays]].map(([from, to]) => trace(scene, options, { from, to }));
  const merged = mergeTraces(parts);
  for (const b of BUCKETS) assert.ok(Math.abs(merged.ledger[b] - whole.ledger[b]) < 1e-9 * whole.launched, b);
  assert.deepEqual(merged.paths, whole.paths);
  assert.equal(merged.paths.length, 40);
  assert.ok(Math.abs(merged.intercept - whole.intercept) < 1e-12);
});
