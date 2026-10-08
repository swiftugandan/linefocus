/** Numbers and pictures for the marketing page, computed by the real engine at build time so the page never
 * claims anything the app does not produce. */

import { defaultDesign } from '../src/core/model.js';
import { buildDesignScene, designPointOptions } from '../src/core/design-scene.js';
import { trace } from '../src/core/tracer.js';
import { sampleSurface } from '../src/render/view.js';
import { ORACLE_CASES } from '../tests/oracle/cases.mjs';
import { readFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** @param {number} v */
const r = v => +v.toFixed(4);

/** The default trough, traced at its design point with a slightly off-axis sun so a little light spills. */
export function heroSvg() {
  const design = defaultDesign();
  design.designPoint.transversalDeg = 0.25;
  const { scene } = buildDesignScene(design);
  const result = trace(scene, { ...designPointOptions(design, { rays: 60000, pathCount: 150 }), seed: 7 });
  const W = design.collector.type === 'trough' ? design.collector.apertureWidth : 6;
  const top = 3.2, bottom = -0.25, left = -W / 2 - 0.5, right = W / 2 + 0.5;
  /** @param {number} x @param {number} y */
  const pt = (x, y) => `${r(x)},${r(-y)}`;
  const rays = result.paths.map(path => {
    const pts = path.points;
    const dx = pts[2] - pts[0], dy = pts[3] - pts[1], len = Math.hypot(dx, dy);
    // Extend incoming light from above the frame.
    const sx = pts[0] - (dx / len) * 4, sy = pts[1] - (dy / len) * 4;
    const reflected = pts.length > 4 ? `<path class="${path.bucket === 'absorbed' ? 'ray-hit' : 'ray-spill'}" d="M${pt(pts[2], pts[3])}${pts.slice(4).reduce((s, v, i, a) => (i % 2 ? s : `${s}L${pt(v, a[i + 1])}`), '')}"/>` : '';
    return `<path class="ray-in" d="M${pt(sx, sy)}L${pt(pts[2], pts[3])}"/>${reflected}`;
  }).join('');
  const surfaces = scene.surfaces.map(s => {
    if (s.shape.kind === 'circle') return `<circle class="${s.material.kind === 'absorber' ? 'absorber' : 'glass'}" cx="${r(s.shape.cx)}" cy="${r(-s.shape.cy)}" r="${r(s.shape.r)}"/>`;
    const pts = sampleSurface(s);
    return `<path class="mirror" d="M${pts.reduce((acc, v, i, a) => (i % 2 ? acc : `${acc}${i ? 'L' : ''}${pt(v, a[i + 1])}`), '')}"/>`;
  }).join('');
  return `<svg class="hero-trace" viewBox="${r(left)} ${r(-top)} ${r(right - left)} ${r(top - bottom)}" role="img" aria-label="Sunlight traced through a parabolic trough and focused onto its absorber tube">${rays}${surfaces}</svg>`;
}

/** The energy ledger of the default design, as shares of the sunlight on the aperture. */
export function ledgerNumbers() {
  const design = defaultDesign();
  const { scene } = buildDesignScene(design);
  const t = trace(scene, designPointOptions(design, { rays: 200000 }));
  const share = /** @param {number} v */ v => v / t.reference;
  return {
    efficiency: t.efficiency,
    intercept: t.intercept,
    rows: [
      ['Absorbed by the tube', share(t.ledger.absorbed)],
      ['Absorbed by the mirror', share(t.ledger.reflectorAbsorption)],
      ['Reflected by the absorber', share(t.ledger.absorberReflection)],
      ['Lost in the glass envelope', share(t.ledger.glassAbsorption + t.ledger.glassReflection)],
      ['Spilled past the receiver', share(t.ledger.spillage)],
    ],
  };
}

/** Largest difference between Linefocus and Ray Optics over the oracle cases. */
export function oracleAgreement() {
  const goldens = JSON.parse(readFileSync(new URL('../tests/oracle/goldens.json', import.meta.url), 'utf8'));
  let worst = 0;
  for (const c of ORACLE_CASES) {
    const res = trace(c.scene, { sun: c.sun, transversalDeg: c.transversalDeg, longitudinalDeg: 0, dni: 1000, rays: 200000, seed: 1 });
    worst = Math.max(worst, Math.abs(res.ledger.absorbed / res.launched - goldens.cases[c.name].fraction));
  }
  return { cases: ORACLE_CASES.length, worst };
}

/** A real verifier report for the skill's example trough, for the marketing page's agent section. */
export function agentSample() {
  const dir = mkdtempSync(join(tmpdir(), 'lf-site-'));
  const root = fileURLToPath(new URL('..', import.meta.url));
  const env = { ...process.env, LINEFOCUS: root };
  execFileSync(process.execPath, [join(root, '.claude/skills/linefocus/examples/process-heat-trough.mjs'), dir], { env });
  const out = execFileSync(process.execPath, [join(root, '.claude/skills/linefocus/scripts/verify.mjs'), join(dir, 'dairy-trough.linefocus.json')], { env, encoding: 'utf8' });
  const escape = text => text.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
  return escape(`$ node verify.mjs dairy-trough.linefocus.json\n${out.trim()}`);
}
