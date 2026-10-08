import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { APP_VERSION, defaultDesign, defaultCollector, defaultReceiver, parseDesign, serializeDesign, validateDesign, DESIGN_SPEC } from '../src/core/model.js';
import { specAt, ValidationError } from '../src/core/spec.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const clone = value => structuredClone(value);

test('the app version matches package.json', () => {
  assert.equal(APP_VERSION, pkg.version);
});

test('the default design is valid and round-trips through a file', () => {
  const design = defaultDesign();
  assert.deepEqual(parseDesign(serializeDesign(design)), design);
});

test('every collector, receiver, sunshape and weather variant validates', () => {
  const base = defaultDesign();
  const dni = Array.from({ length: 8760 }, (_, h) => (h % 24 > 6 && h % 24 < 18 ? 800 : 0));
  const variants = [
    { ...clone(base), collector: defaultCollector('fresnel'), receiver: defaultReceiver('flat') },
    { ...clone(base), collector: defaultCollector('fresnel'), receiver: defaultReceiver('tube') },
    { ...clone(base), collector: { ...defaultCollector('fresnel'), secondary: { kind: 'none' }, curvature: 'flat' } },
    { ...clone(base), collector: defaultCollector('cpc'), receiver: defaultReceiver('flat') },
    { ...clone(base), collector: defaultCollector('cpc'), receiver: { ...defaultReceiver('tube'), envelope: { ...defaultReceiver('tube').envelope, mode: 'physical' } } },
    { ...clone(base), sun: { shape: 'pillbox', halfAngleMrad: 4.65 } },
    { ...clone(base), sun: { shape: 'gaussian', sigmaMrad: 2.5 } },
    { ...clone(base), weather: { source: 'epw', name: 'site.epw', dni } },
  ];
  for (const design of variants) assert.deepEqual(parseDesign(serializeDesign(design)), design);
});

test('structural errors name the offending field', () => {
  const cases = [
    [d => { d.collector.apertureWidth = -1; }, 'collector.apertureWidth'],
    [d => { d.collector.type = 'dish'; }, 'collector.type'],
    [d => { d.optics.extra = 1; }, 'optics.extra'],
    [d => { delete d.sun.csr; }, 'sun.csr'],
    [d => { d.simulation.rays = 1500.5; }, 'simulation.rays'],
    [d => { d.weather = { source: 'epw', name: 'x', dni: [1, 2, 3] }; }, 'weather.dni'],
    [d => { d.title = 'x'.repeat(161); }, 'title'],
  ];
  for (const [mutate, path] of cases) {
    const design = defaultDesign(); mutate(design);
    assert.throws(() => validateDesign(design), error => error instanceof ValidationError && error.path === path, path);
  }
});

test('unsafe keys are rejected even when JSON.parse creates them', () => {
  const text = serializeDesign(defaultDesign()).replace('"optics": {', '"optics": { "__proto__": { "polluted": true },');
  assert.throws(() => parseDesign(text), /__proto__/);
  assert.equal(/** @type {any} */ ({}).polluted, undefined);
});

test('cross-field design rules are enforced', () => {
  const cases = [
    [d => { d.receiver = defaultReceiver('flat'); }, 'receiver.type'],
    [d => { d.receiver.envelope.outerDiameter = 0.06; }, 'receiver.envelope.outerDiameter'],
    [d => { d.collector = { ...defaultCollector('fresnel'), pitch: 0.5, mirrorWidth: 0.6 }; }, 'collector.pitch'],
    [d => { d.collector = { ...defaultCollector('fresnel'), curvatureRadius: 0.3, mirrorWidth: 0.75 }; }, 'collector.curvatureRadius'],
    [d => { d.collector = { ...defaultCollector('fresnel'), secondary: { kind: 'trapezoid', depth: 0.1, mouthWidth: 0.1 } }; }, 'collector.secondary.mouthWidth'],
  ];
  for (const [mutate, path] of cases) {
    const design = defaultDesign(); mutate(design);
    assert.throws(() => validateDesign(design), error => error instanceof ValidationError && error.path === path, path);
  }
});

test('files from other apps and future versions are refused with a clear message', () => {
  assert.throws(() => parseDesign('{"format":"kdiagram.diagram"}'), /not a Linefocus design/);
  assert.throws(() => parseDesign(serializeDesign(defaultDesign()).replace('"version": 1', '"version": 2')), /version 2/);
  assert.throws(() => parseDesign('{'), /not valid JSON/);
});

test('field specs can be found by path through union variants', () => {
  const design = defaultDesign();
  assert.equal(specAt(DESIGN_SPEC, design, 'collector.focalLength')?.kind, 'number');
  assert.equal(specAt(DESIGN_SPEC, design, 'receiver.envelope.transmittance')?.kind, 'number');
  assert.equal(specAt(DESIGN_SPEC, design, 'collector.rows'), null);
});
