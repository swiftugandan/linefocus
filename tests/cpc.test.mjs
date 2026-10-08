import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCpc, flatCpcParabola, tubeCpcPoint } from '../src/core/collectors/cpc.js';
import { trace, BUCKETS } from '../src/core/tracer.js';
import { defaultDesign, switchVariant } from '../src/core/model.js';
import { buildDesignScene, designPointOptions } from '../src/core/design-scene.js';

const IDEAL = { reflectance: 1, slopeErrorMrad: 0, specularityMrad: 0 };
const COLLIMATED = { shape: 'pillbox', halfAngleMrad: 0 };
const FLAT = { type: 'flat', width: 0.1, absorptance: 1, insulation: 0.01, cover: { mode: 'none', gap: 0, overhang: 0, thickness: 0.004, refractiveIndex: 1.5, extinction: 0, transmittance: 1 } };
const TUBE = { type: 'tube', absorberDiameter: 0.05, absorptance: 1, envelope: { mode: 'none', outerDiameter: 0.06, thickness: 0.002, refractiveIndex: 1.5, extinction: 0, transmittance: 1 } };
const near = (a, b, tol, label) => assert.ok(Math.abs(a - b) <= tol, `${label}: ${a} vs ${b}`);

test('the flat CPC runs from the absorber edge to (a′/sin θa, (a + a′)/tan θa) with a vertical tangent at the top', () => {
  for (const deg of [10, 30, 60]) {
    const th = (deg * Math.PI) / 180, half = 0.05;
    const p = flatCpcParabola(half, th);
    const [x0, y0] = p.at(p.uMin), [x1, y1] = p.at(p.uFull);
    near(x0, half, 1e-12, 'start x'); near(y0, 0, 1e-12, 'start y');
    const a = half / Math.sin(th);
    near(x1, a, 1e-12, 'top x'); near(y1, (a + half) / Math.tan(th), 1e-12, 'top y');
    const [xe] = p.at(p.uFull * (1 - 1e-7));
    near((x1 - xe) / (p.uFull * 1e-7), 0, 1e-5, 'vertical tangent');
  }
});

test('the tube CPC starts at the cusp, joins its two sections smoothly and tops out at πr / sin θa', () => {
  const r = 0.03, th = (35 * Math.PI) / 180, join = th + Math.PI / 2;
  const [cx, cy] = tubeCpcPoint(r, th, 0);
  near(cx, 0, 1e-15, 'cusp x'); near(cy, -r, 1e-15, 'cusp y');
  const before = tubeCpcPoint(r, th, join - 1e-9), after = tubeCpcPoint(r, th, join + 1e-9);
  near(Math.hypot(before[0] - after[0], before[1] - after[1]), 0, 1e-9, 'continuity');
  near(tubeCpcPoint(r, th, 1.5 * Math.PI - th)[0], (Math.PI * r) / Math.sin(th), 1e-12, 'top x');
});

test('an ideal full CPC accepts all light inside ±θa and none outside', () => {
  for (const receiver of [FLAT, TUBE]) {
    const scene = buildCpc({ type: 'cpc', acceptanceHalfAngleDeg: 30, truncation: 1, gap: 0 }, receiver, IDEAL);
    const eta = t => trace(scene, { sun: COLLIMATED, transversalDeg: t, longitudinalDeg: 0, dni: 1000, rays: 20000, seed: 3 }).efficiency;
    for (const t of [0, 15, -25, 29.5]) near(eta(t), 1, 0.002, `${receiver.type} at ${t}°`);
    for (const t of [30.5, -33, 45]) near(eta(t), 0, 0.002, `${receiver.type} at ${t}°`);
  }
});

test('truncation shortens the reflector from its lowest point and widens acceptance', () => {
  const full = buildCpc({ type: 'cpc', acceptanceHalfAngleDeg: 20, truncation: 1, gap: 0 }, TUBE, IDEAL);
  const cut = buildCpc({ type: 'cpc', acceptanceHalfAngleDeg: 20, truncation: 0.5, gap: 0 }, TUBE, IDEAL);
  near(cut.height, full.height / 2, 1e-9, 'half height');
  assert.ok(cut.aperture < full.aperture);
  const eta = (scene, t) => trace(scene, { sun: COLLIMATED, transversalDeg: t, longitudinalDeg: 0, dni: 1000, rays: 20000, seed: 3 }).efficiency;
  assert.ok(eta(cut, 25) > 0.1 && eta(full, 25) < 0.01, 'a truncated CPC still collects some light beyond θa');
});

test('the default CPC design conserves energy and faces the equator', () => {
  const d = defaultDesign();
  switchVariant(d, 'collector', 'cpc');
  assert.equal(d.mounting.axisAzimuthDeg, 90);
  assert.ok(d.mounting.tiltDeg > 30 && d.mounting.tiltDeg < 45, `tilt ${d.mounting.tiltDeg}`);
  const { scene } = buildDesignScene(d);
  for (const t of [0, 20, -40]) {
    d.designPoint.transversalDeg = t;
    const r = trace(scene, designPointOptions(d, { rays: 20000 }));
    const total = BUCKETS.reduce((s, b) => s + r.ledger[b], 0);
    assert.ok(Math.abs(total - r.launched) / r.launched < 1e-9);
  }
});
