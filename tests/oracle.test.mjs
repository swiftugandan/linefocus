import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { trace } from '../src/core/tracer.js';
import { toRayOptics } from '../src/core/rayoptics.js';
import { ORACLE_CASES } from './oracle/cases.mjs';

const goldens = JSON.parse(readFileSync(new URL('./oracle/goldens.json', import.meta.url), 'utf8'));

for (const c of ORACLE_CASES) {
  test(`Linefocus agrees with Ray Optics Simulation: ${c.name}`, () => {
    const golden = goldens.cases[c.name];
    assert.ok(golden, `No golden for ${c.name}. Run node scripts/ray-optics-oracle.mjs.`);
    // The committed scene must be what the exporter writes today, or the golden describes a different scene.
    const { json } = toRayOptics(c.scene, { sun: c.sun, transversalDeg: c.transversalDeg, name: c.name, rayDensity: 4 });
    const committed = JSON.parse(readFileSync(new URL(`./oracle/${c.name}.scene.json`, import.meta.url), 'utf8'));
    assert.deepEqual(json, committed);
    const result = trace(c.scene, { sun: c.sun, transversalDeg: c.transversalDeg, longitudinalDeg: 0, dni: 1000, rays: 200000, seed: 1 });
    const fraction = result.ledger.absorbed / result.launched;
    assert.ok(Math.abs(fraction - golden.fraction) < 0.002, `Linefocus ${fraction.toFixed(5)} vs Ray Optics ${golden.fraction.toFixed(5)}`);
  });
}
