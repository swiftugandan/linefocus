import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultDesign, switchVariant } from '../src/core/model.js';
import { buildDesignScene, designPointOptions } from '../src/core/design-scene.js';
import { trace, BUCKETS } from '../src/core/tracer.js';
import { rowPositions, rowNormal } from '../src/core/collectors/fresnel.js';
import { iamGrid, interpolateEta, acceptanceStudy } from '../src/core/studies.js';

const lfr = () => { const d = defaultDesign(); switchVariant(d, 'collector', 'fresnel'); return d; };

test('every row reflects the sun centre onto the receiver centre', () => {
  const d = lfr();
  const c = /** @type {any} */ (d.collector);
  for (const sun of [-60, -20, 0, 35, 70]) {
    for (const x of rowPositions(c)) {
      const [nx, ny] = rowNormal(x, c.receiverHeight, sun);
      const s = [Math.sin((sun * Math.PI) / 180), Math.cos((sun * Math.PI) / 180)];
      const dot = -s[0] * nx - s[1] * ny;
      const r = [-s[0] - 2 * dot * nx, -s[1] - 2 * dot * ny];
      const k = c.receiverHeight / r[1];
      assert.ok(Math.abs(x + k * r[0]) < 1e-9, `row at ${x} with sun at ${sun}°`);
    }
  }
});

test('the default LFR is plausible: most reflected light reaches the absorber', () => {
  const d = lfr();
  const { scene } = buildDesignScene(d);
  const r = trace(scene, designPointOptions(d, { rays: 100000 }));
  assert.ok(r.intercept > 0.9, `γ ${r.intercept}`);
  assert.ok(r.efficiency > 0.6 && r.efficiency < 0.8, `η ${r.efficiency}`);
});

test('every launched watt is accounted for in an LFR, with cavity and glass', () => {
  const d = lfr();
  d.receiver = { ...d.receiver, cover: { ...(/** @type {any} */ (d.receiver)).cover, mode: 'physical' } };
  for (const [t, l] of [[0, 0], [40, 20], [-65, 50]]) {
    d.designPoint.transversalDeg = t; d.designPoint.longitudinalDeg = l;
    const { scene } = buildDesignScene(d);
    const r = trace(scene, designPointOptions(d, { rays: 20000 }));
    const total = BUCKETS.reduce((sum, b) => sum + r.ledger[b], 0);
    assert.ok(Math.abs(total - r.launched) / r.launched < 1e-9, `θT ${t}, θL ${l}`);
  }
});

test('the signed incidence grid is symmetric for a symmetric field', async () => {
  const d = lfr();
  d.simulation.rays = 80000;
  const { scene } = buildDesignScene(d);
  const grid = await iamGrid(d, scene);
  assert.ok(grid && !grid.tracking);
  for (const t of [15, 30, 60]) {
    const a = interpolateEta(grid, t, 20), b = interpolateEta(grid, -t, 20);
    assert.ok(Math.abs(a - b) < 0.01, `η(${t}) ${a} vs η(${-t}) ${b}`);
  }
  // Interpolation follows the sign of θT rather than folding it.
  assert.equal(interpolateEta(grid, -85, 0), grid.eta[1][0]);
});

test('LFR acceptance is measured about the rows\' aiming direction', async () => {
  const d = lfr();
  d.designPoint.transversalDeg = 30;
  const { scene } = buildDesignScene(d);
  const a = await acceptanceStudy(d, scene);
  assert.ok(a && a.halfAngle90 !== null && a.halfAngle90 > 0.1 && a.halfAngle90 < 3, `θ90 ${a?.halfAngle90}`);
  assert.ok(Math.abs(Math.max(...a.relative) - 1) < 1e-12);
});
