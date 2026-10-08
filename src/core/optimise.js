/** Design optimisation: Nelder–Mead over a few design values inside user bounds, scored by the tracer with common
 * random numbers. Every candidate is validated; a rule violation is a penalty, never a crash. See docs/PHYSICS.md. */

import { DESIGN_SPEC, getPath, setPath, validateDesign } from './model.js';
import { specAt, ValidationError } from './spec.js';
import { buildDesignScene, designPointOptions, tracksSun, tracksTransversally } from './design-scene.js';
import { trace } from './tracer.js';
import { sunPosition, collectorAngles } from './solar.js';
import { dniAt, endLossFactor, acceptanceStudy } from './studies.js';

/** @import { Design } from './model.js' */
/** @import { NumberSpec } from './spec.js' */

/**
 * @typedef {'efficiency' | 'annualPerArea' | 'annualPerField' | 'cap'} Objective
 * @typedef {{ path: string, min: number, max: number }} Variable
 * @typedef {{ transversalDeg: number, longitudinalDeg: number, weight: number }} SunBin
 *   weight is the year's DNI (times cos θi when the reference has a cosine) in this bin, in Wh/m².
 * @typedef {{ values: number[], score: number }} Point
 * @typedef {{ objective: Objective, variables: Variable[], start: Point, best: Point, history: number[], evaluations: number,
 *   confirmation: { start: number, best: number, noise: number }, bins: number }} OptimiseResult
 */

/** Most sun positions an annual objective traces per candidate. */
const MAX_BINS = 36;

/** @type {Record<Objective, { label: string, unit: string, help: string }>} */
export const OBJECTIVES = {
  efficiency: { label: 'Optical efficiency', unit: '%', help: 'At the design point. Watch for the trivial answer of a larger absorber' },
  annualPerArea: { label: 'Energy per m² of aperture', unit: 'kWh/m²', help: 'A year at your site, per square metre of reference aperture. With the receiver fixed, this favours a smaller aperture; compare with energy per metre of field' },
  annualPerField: { label: 'Energy per metre of field', unit: 'kWh/m', help: 'A year at your site, per metre of field width across the collector: rows × pitch for an LFR, the aperture otherwise' },
  cap: { label: 'Concentration × acceptance', unit: '', help: 'C · sin θ90: how much concentration the design buys for its tolerance' },
};

/** Values worth optimising, per collector type. Receivers are included; fix them by unticking. */
/** @type {Record<Design['collector']['type'], string[]>} */
export const CANDIDATES = {
  trough: ['collector.apertureWidth', 'collector.focalLength', 'receiver.absorberDiameter'],
  fresnel: ['collector.pitch', 'collector.receiverHeight', 'collector.curvatureRadius', 'collector.mirrorWidth', 'collector.secondary.mouthWidth', 'collector.secondary.depth', 'receiver.width', 'receiver.absorberDiameter'],
  cpc: ['collector.acceptanceHalfAngleDeg', 'collector.truncation', 'collector.gap', 'mounting.tiltDeg'],
};

/**
 * The variables available for a design, with default bounds of −40% to +50% around the current value, inside the
 * field's own range.
 * @param {Design} design
 * @returns {(Variable & { label: string, spec: NumberSpec })[]}
 */
export function variablesFor(design) {
  return CANDIDATES[design.collector.type].flatMap(path => {
    const spec = specAt(DESIGN_SPEC, design, path);
    if (!spec || spec.kind !== 'number') return [];
    const v = /** @type {number} */ (getPath(design, path));
    const lo = Math.max(spec.min, v === 0 ? spec.min : v * 0.6), hi = Math.min(spec.max, v === 0 ? spec.max / 10 : v * 1.5);
    return [{ path, label: spec.label, spec, min: +lo.toPrecision(4), max: +hi.toPrecision(4) }];
  });
}

/**
 * Nelder–Mead minimisation in the unit box. Points outside the box are clamped into it.
 * @param {(x: number[]) => Promise<number>} f @param {number[]} x0 in [0, 1]^k
 * @param {{ maxEvaluations: number, step?: number, tolerance?: number, onEvaluate?: (best: number, count: number) => Promise<boolean> }} options
 * @returns {Promise<{ x: number[], value: number, evaluations: number, stopped: boolean }>}
 */
export async function nelderMead(f, x0, { maxEvaluations, step = 0.12, tolerance = 1e-5, onEvaluate }) {
  const k = x0.length;
  const clamp = /** @param {number[]} x */ x => x.map(v => Math.min(1, Math.max(0, v)));
  let evaluations = 0, best = Infinity, stopped = false;
  /** @param {number[]} x */
  const evaluate = async x => {
    const value = await f(clamp(x));
    evaluations++;
    best = Math.min(best, value);
    if (onEvaluate && !(await onEvaluate(best, evaluations))) stopped = true;
    return value;
  };
  /** @type {{ x: number[], v: number }[]} */
  const simplex = [{ x: clamp(x0), v: await evaluate(x0) }];
  for (let i = 0; i < k && !stopped; i++) {
    const x = [...x0];
    x[i] = x[i] + step <= 1 ? x[i] + step : x[i] - step;
    simplex.push({ x: clamp(x), v: await evaluate(x) });
  }
  while (!stopped && evaluations < maxEvaluations) {
    simplex.sort((a, b) => a.v - b.v);
    const spread = Math.abs(simplex[k].v - simplex[0].v);
    const size = Math.max(...simplex.slice(1).map(p => Math.max(...p.x.map((v, i) => Math.abs(v - simplex[0].x[i])))));
    if (spread <= tolerance * (Math.abs(simplex[0].v) + 1e-12) && size < 1e-3) break;
    const centroid = Array.from({ length: k }, (_, i) => simplex.slice(0, k).reduce((s, p) => s + p.x[i], 0) / k);
    const worst = simplex[k];
    /** @param {number} t */
    const along = t => clamp(centroid.map((c, i) => c + t * (worst.x[i] - c)));
    const reflected = along(-1), vr = await evaluate(reflected);
    if (vr < simplex[0].v) {
      const expanded = along(-2), ve = await evaluate(expanded);
      simplex[k] = ve < vr ? { x: expanded, v: ve } : { x: reflected, v: vr };
    } else if (vr < simplex[k - 1].v) {
      simplex[k] = { x: reflected, v: vr };
    } else {
      const contracted = vr < worst.v ? along(-0.5) : along(0.5);
      const vc = await evaluate(contracted);
      if (vc < Math.min(vr, worst.v)) simplex[k] = { x: contracted, v: vc };
      else {
        // Shrink towards the best point.
        for (let j = 1; j <= k && !stopped; j++) {
          const x = clamp(simplex[j].x.map((v, i) => simplex[0].x[i] + 0.5 * (v - simplex[0].x[i])));
          simplex[j] = { x, v: await evaluate(x) };
        }
      }
    }
  }
  simplex.sort((a, b) => a.v - b.v);
  return { x: simplex[0].x, value: simplex[0].v, evaluations, stopped };
}

/**
 * The year condensed into at most 36 energy-weighted sun positions: hours are grouped in 2° cells of (θT, θL), then
 * clustered. Every hour's energy is kept. The bins depend on the site, mounting and weather only, so one set serves
 * every candidate.
 * @param {Design} design
 * @returns {SunBin[]}
 */
export function sunBins(design) {
  const tracking = tracksTransversally(design);
  const cosine = design.collector.type !== 'fresnel';
  /** @type {Map<string, { t: number, l: number, w: number }>} */
  const cells = new Map();
  for (let h = 0; h < 8760; h++) {
    const day = Math.floor(h / 24) + 1, hour = (h % 24) + 0.5;
    const dni = dniAt(design, day, hour);
    if (!(dni > 0)) continue;
    const angles = collectorAngles(sunPosition(design.site, day, hour), design.mounting, tracking ? 'tracking' : 'fixed');
    if (!angles || angles.cosIncidence <= 0) continue;
    const w = dni * (cosine ? angles.cosIncidence : 1);
    const key = `${Math.round(angles.transversalDeg / 2)}:${Math.round(angles.longitudinalDeg / 2)}`;
    const cell = cells.get(key) ?? { t: 0, l: 0, w: 0 };
    cell.t += angles.transversalDeg * w; cell.l += angles.longitudinalDeg * w; cell.w += w;
    cells.set(key, cell);
  }
  const sorted = [...cells.values()].sort((a, b) => b.w - a.w);
  const total = sorted.reduce((s, c) => s + c.w, 0);
  const points = sorted.map(c => ({ t: c.t / c.w, l: c.l / c.w, w: c.w }));
  // Fixed collectors spread the year over hundreds of cells. Weighted k-means, seeded deterministically with the
  // heaviest cells, condenses them to a few dozen representative sun positions that keep every hour's energy.
  const centres = points.slice(0, MAX_BINS).map(p => ({ t: p.t, l: p.l }));
  if (points.length > MAX_BINS) {
    for (let iteration = 0; iteration < 25; iteration++) {
      const sums = centres.map(() => ({ t: 0, l: 0, w: 0 }));
      for (const p of points) {
        let best = 0, bestD = Infinity;
        centres.forEach((c, k) => { const d = (c.t - p.t) ** 2 + (c.l - p.l) ** 2; if (d < bestD) { bestD = d; best = k; } });
        sums[best].t += p.t * p.w; sums[best].l += p.l * p.w; sums[best].w += p.w;
      }
      sums.forEach((sum, k) => { if (sum.w > 0) centres[k] = { t: sum.t / sum.w, l: sum.l / sum.w }; });
    }
  }
  const weights = centres.map(() => 0);
  for (const p of points) {
    let best = 0, bestD = Infinity;
    centres.forEach((c, k) => { const d = (c.t - p.t) ** 2 + (c.l - p.l) ** 2; if (d < bestD) { bestD = d; best = k; } });
    weights[best] += p.w;
  }
  return centres.map((c, k) => ({ transversalDeg: c.t, longitudinalDeg: c.l, weight: weights[k] })).filter(b => b.weight > 1e-9 * total);
}

/**
 * Scores one design. Higher is better.
 * @param {Design} design @param {Objective} objective @param {SunBin[]} bins @param {{ rays: number, seed: number }} sampling
 */
export async function score(design, objective, bins, { rays, seed }) {
  if (objective === 'efficiency') {
    const { scene } = buildDesignScene(design);
    return trace(scene, { ...designPointOptions(design, { rays }), seed }).efficiency * 100;
  }
  if (objective === 'cap') {
    const { scene } = buildDesignScene(design);
    const sized = { ...design, simulation: { rays: rays * 10, seed } };
    const a = await acceptanceStudy(sized, scene);
    return a?.cap90 ?? 0;
  }
  const { scene } = buildDesignScene(design);
  let energy = 0;
  for (const bin of bins) {
    const at = tracksSun(design) ? buildDesignScene(design, bin.transversalDeg).scene : scene;
    const eta = trace(at, { sun: design.sun, transversalDeg: bin.transversalDeg, longitudinalDeg: bin.longitudinalDeg, dni: 1000, rays, seed }).efficiency;
    energy += bin.weight * eta * endLossFactor(scene, design, bin.longitudinalDeg);
  }
  // energy is Wh per m² of reference aperture over the year.
  if (objective === 'annualPerArea') return energy / 1000;
  const field = design.collector.type === 'fresnel' ? design.collector.rows * design.collector.pitch : scene.reference.width;
  return (energy * scene.reference.width) / field / 1000;
}

/**
 * Optimises a design. Candidates use the same random rays (common random numbers); the result is confirmed with a
 * second, independent seed so the reported gain can be compared with sampling noise.
 * @param {Design} design @param {{ objective: Objective, variables: Variable[], maxEvaluations?: number, rays?: number }} options
 * @param {(best: number, count: number) => Promise<boolean>} [progress]
 * @returns {Promise<OptimiseResult | null>} null when stopped before any result
 */
export async function optimise(design, { objective, variables, maxEvaluations = 90, rays }, progress) {
  if (!variables.length) throw new Error('Choose at least one value to optimise.');
  for (const v of variables) if (!(v.max > v.min)) throw new Error(`The range for ${v.path} needs a maximum above its minimum.`);
  const bins = objective === 'annualPerArea' || objective === 'annualPerField' ? sunBins(design) : [];
  const perEvaluation = rays ?? Math.max(8192, Math.min(40000, Math.round(design.simulation.rays / (bins.length > 8 ? 10 : 4))));
  const sampling = { rays: perEvaluation, seed: design.simulation.seed };
  /** @param {number[]} x */
  const toDesign = x => {
    const d = structuredClone(design);
    variables.forEach((v, i) => {
      const spec = /** @type {NumberSpec} */ (specAt(DESIGN_SPEC, d, v.path));
      let value = v.min + x[i] * (v.max - v.min);
      if (spec.integer) value = Math.round(value);
      setPath(d, v.path, value);
    });
    return d;
  };
  /** @param {number[]} x */
  const objectiveAt = async x => {
    try { return await score(validateDesign(toDesign(x)), objective, bins, sampling); }
    catch (error) { if (error instanceof ValidationError) return -Infinity; throw error; }
  };
  const x0 = variables.map(v => Math.min(1, Math.max(0, (/** @type {number} */ (getPath(design, v.path)) - v.min) / (v.max - v.min))));
  const startScore = await objectiveAt(x0);
  /** @type {number[]} */
  const history = [];
  const result = await nelderMead(async x => -(await objectiveAt(x)), x0, {
    maxEvaluations,
    onEvaluate: async (best, count) => { history.push(-best); return progress ? progress(-best, count) : true; },
  });
  if (!Number.isFinite(result.value) && result.stopped) return null;
  const bestDesign = toDesign(result.x);
  // Confirm with more rays and two fresh seeds: the spread between them estimates the sampling noise.
  const confirm = { rays: perEvaluation * 2, seed: (design.simulation.seed + 7919) >>> 0 };
  const confirmTwin = { rays: perEvaluation * 2, seed: (design.simulation.seed + 104729) >>> 0 };
  const startConfirmed = await score(design, objective, bins, confirm);
  const bestConfirmed = await score(validateDesign(bestDesign), objective, bins, confirm);
  const bestTwin = await score(validateDesign(bestDesign), objective, bins, confirmTwin);
  return {
    objective, variables, history, evaluations: result.evaluations, bins: bins.length,
    start: { values: variables.map(v => /** @type {number} */ (getPath(design, v.path))), score: startScore },
    best: { values: variables.map(v => /** @type {number} */ (getPath(bestDesign, v.path))), score: -result.value },
    confirmation: { start: startConfirmed, best: bestConfirmed, noise: Math.abs(bestConfirmed - bestTwin) },
  };
}
