import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { designJsonSchema } from '../src/core/schema.js';
import { defaultDesign, defaultCollector, defaultReceiver } from '../src/core/model.js';
import { schemaErrors } from './json-schema.mjs';

const committed = JSON.parse(readFileSync(new URL('../schema/linefocus.design.v1.schema.json', import.meta.url), 'utf8'));

test('the committed schema matches the design spec (run node scripts/build-schema.mjs)', () => {
  assert.deepEqual(designJsonSchema(), committed);
});

test('the schema accepts every design variant the app can write', () => {
  const base = defaultDesign();
  const designs = [
    base,
    { ...structuredClone(base), collector: defaultCollector('fresnel'), receiver: defaultReceiver('flat') },
    { ...structuredClone(base), collector: defaultCollector('cpc') },
    { ...structuredClone(base), sun: { shape: 'pillbox', halfAngleMrad: 4.65 } },
    { ...structuredClone(base), weather: { source: 'epw', name: 'a.epw', dni: new Array(8760).fill(0) } },
  ];
  for (const design of designs) assert.deepEqual(schemaErrors(committed, design), []);
});

test('the schema rejects the structural errors the loader rejects', () => {
  const bad = [
    d => { d.collector.apertureWidth = -1; },
    d => { d.optics.extra = 1; },
    d => { delete d.sun.csr; },
    d => { d.simulation.rays = 1.5; },
    d => { d.collector.type = 'dish'; },
    d => { d.weather = { source: 'epw', name: 'x', dni: [1] }; },
  ];
  for (const mutate of bad) {
    const design = defaultDesign(); mutate(design);
    assert.notDeepEqual(schemaErrors(committed, design), []);
  }
});
