/** Studies built on the tracer: acceptance, the incidence-angle grid, and day and year energy. Definitions are in
 * docs/PHYSICS.md under Studies. Every point of a study uses the same seed (common random numbers), so curves are
 * smooth and differences between designs are real rather than sampling noise. */

import { trace } from './tracer.js';
import { sunPosition, clearSkyDni, collectorAngles, MONTH_START } from './solar.js';
import { tracksTransversally, tracksSun, buildDesignScene } from './design-scene.js';

/** @import { Design } from './model.js' */
/** @import { OpticalScene, TraceOptions } from './types.js' */

/** @typedef {(done: number, total: number) => Promise<boolean>} Progress  Resolves false to abandon the study. */

/**
 * @typedef {{ angles: number[], efficiency: number[], intercept: number[], relative: number[],
 *   halfAngle95: number | null, halfAngle90: number | null, concentration: number, cap90: number | null }} AcceptanceResult
 * @typedef {{ transversal: number[], longitudinal: number[], eta: number[][], tracking: boolean }} IamGrid
 *   eta[i][j] is the optical efficiency at transversal[i], longitudinal[j]; angles are absolute values in degrees.
 * @typedef {{ day: number, label: string, points: [number, number][], energy: number }} DayCurve
 *   points are [local standard hour, absorbed W/m]; energy is Wh/m over the day.
 * @typedef {{ monthly: number[], total: number, perArea: number, dni: number, beamOnAperture: number, efficiencyVsDni: number,
 *   efficiencyVsAperture: number, hoursOfSun: number, source: string }} YearResult
 *   monthly and total are kWh/m of collector; perArea is kWh/m² of reference aperture; dni is kWh/m².
 */

/** Rays per study point: a tenth of the design's ray count, within sensible bounds. @param {Design} design */
export function studyRays(design) {
  return Math.max(8192, Math.min(65536, Math.round(design.simulation.rays / 10)));
}

/** @param {Design} design @param {number} t @param {number} l @param {number} rays @returns {TraceOptions} */
function options(design, t, l, rays) {
  return { sun: design.sun, transversalDeg: t, longitudinalDeg: l, dni: 1000, rays, seed: design.simulation.seed };
}

/** Geometric concentration: reference aperture over absorber perimeter (tube) or width (plate). @param {Design} design @param {OpticalScene} scene */
export function geometricConcentration(design, scene) {
  const r = design.receiver;
  return scene.reference.width / (r.type === 'tube' ? Math.PI * r.absorberDiameter : r.width);
}

/**
 * Optical efficiency against misalignment: the sun moves by δ across the aperture while the collector stays aimed.
 * A trough and a CPC are aimed along their aperture normal; LFR rows are aimed at the design point's sun. The sweep
 * runs at the design's longitudinal angle and covers both sides, since not every collector is symmetric.
 * @param {Design} design @param {OpticalScene} scene @param {Progress} [progress]
 * @returns {Promise<AcceptanceResult | null>}
 */
export async function acceptanceStudy(design, scene, progress) {
  const rays = studyRays(design);
  const aim = tracksSun(design) ? design.designPoint.transversalDeg : 0;
  const aimed = tracksSun(design) ? buildDesignScene(design, aim).scene : scene;
  const l = design.designPoint.longitudinalDeg;
  const at = /** @param {number} delta */ delta => trace(aimed, options(design, aim + delta, l, rays));
  const centre = at(0);
  // Widen the sweep until transmission has clearly fallen away on both sides, up to 45°.
  let range = design.collector.type === 'cpc' ? Math.max(2, design.collector.acceptanceHalfAngleDeg * 1.6) : 0.4;
  while (range < 45) {
    if (Math.max(at(range).efficiency, at(-range).efficiency) < 0.35 * centre.efficiency) break;
    range = Math.min(45, range * 1.6);
  }
  const steps = 24;
  /** @type {number[]} */
  const angles = [];
  for (let i = -steps; i <= steps; i++) angles.push((range * i) / steps);
  /** @type {{ efficiency: number, intercept: number }[]} */
  const points = [];
  for (let i = 0; i < angles.length; i++) {
    if (progress && !(await progress(i, angles.length))) return null;
    const res = angles[i] === 0 ? centre : at(angles[i]);
    points.push({ efficiency: res.efficiency, intercept: res.intercept });
  }
  const peak = Math.max(...points.map(p => p.efficiency), 1e-12);
  const relative = points.map(p => p.efficiency / peak);
  const concentration = geometricConcentration(design, scene);
  // Half-angles average the two sides; for a symmetric collector they are equal.
  const halfAngle = /** @param {number} level */ level => {
    const mid = steps;
    const right = crossing(angles.slice(mid), relative.slice(mid), level);
    const left = crossing(angles.slice(0, mid + 1).reverse().map(a => -a), relative.slice(0, mid + 1).reverse(), level);
    return right === null || left === null ? null : (right + left) / 2;
  };
  const halfAngle90 = halfAngle(0.9);
  return {
    angles,
    efficiency: points.map(p => p.efficiency),
    intercept: points.map(p => p.intercept),
    relative,
    halfAngle95: halfAngle(0.95),
    halfAngle90,
    concentration,
    cap90: halfAngle90 === null ? null : concentration * Math.sin((halfAngle90 * Math.PI) / 180),
  };
}

/** First angle where a falling curve drops below a level, by linear interpolation. @param {number[]} x @param {number[]} y @param {number} level */
export function crossing(x, y, level) {
  // Start from the best point so a dip at the centre (for example a receiver shadow) doesn't count.
  let start = 0;
  for (let i = 1; i < y.length; i++) if (y[i] > y[start]) start = i;
  for (let i = start + 1; i < y.length; i++) {
    if (y[i] < level && y[i - 1] >= level) return x[i - 1] + ((y[i - 1] - level) / (y[i - 1] - y[i])) * (x[i] - x[i - 1]);
  }
  return null;
}

/**
 * Traced optical efficiency on a grid of sun angles. A tracking trough needs only the longitudinal angle, at its
 * tracking error; fixed collectors need both.
 * @param {Design} design @param {OpticalScene} scene @param {Progress} [progress]
 * @returns {Promise<IamGrid | null>}
 */
export async function iamGrid(design, scene, progress) {
  const tracking = tracksTransversally(design);
  const rays = studyRays(design);
  // A tracking trough needs one row at its tracking error. Fixed collectors are not symmetric in θT: an LFR's
  // receiver shades different rows morning and evening, and a tilted CPC is lopsided by design.
  const transversal = tracking ? [-(design.mounting.trackingErrorMrad * 1e-3 * 180) / Math.PI] : [-89, ...range(-85, 85, 5), 89];
  // Fixed collectors need the two-axis grid; 10° steps along the axis keep it to a few seconds.
  const longitudinal = tracking ? range(0, 85, 5).concat([89]) : range(0, 80, 10).concat([89]);
  const total = transversal.length * longitudinal.length;
  /** @type {number[][]} */
  const eta = [];
  let done = 0;
  for (const t of transversal) {
    /** @type {number[]} */
    const row = [];
    // Collectors whose rows track the sun are rebuilt for each sun angle.
    const sceneAtT = tracksSun(design) ? buildDesignScene(design, t).scene : scene;
    for (const l of longitudinal) {
      if (progress && !(await progress(done, total))) return null;
      row.push(trace(sceneAtT, options(design, t, l, rays)).efficiency);
      done++;
    }
    eta.push(row);
  }
  return { transversal, longitudinal, eta, tracking };
}

/** @param {number} from @param {number} to @param {number} step */
function range(from, to, step) {
  const out = [];
  for (let v = from; v <= to + 1e-9; v += step) out.push(v);
  return out;
}

/** Bilinear interpolation of the grid at θT and |θL|. @param {IamGrid} grid @param {number} t @param {number} l */
export function interpolateEta(grid, t, l) {
  /** @param {number[]} axis @param {number} v */
  const locate = (axis, v) => {
    if (axis.length === 1) return [0, 0, 0];
    const x = Math.min(axis.at(-1) ?? 0, Math.max(axis[0], v));
    let i = 0;
    while (i < axis.length - 2 && axis[i + 1] < x) i++;
    return [i, i + 1, (x - axis[i]) / (axis[i + 1] - axis[i])];
  };
  const [i0, i1, ft] = locate(grid.transversal, t);
  const [j0, j1, fl] = locate(grid.longitudinal, Math.abs(l));
  const e = grid.eta;
  return (1 - ft) * ((1 - fl) * e[i0][j0] + fl * e[i0][j1]) + ft * ((1 - fl) * e[i1][j0] + fl * e[i1][j1]);
}

/** Share of a finite row's reflected light that stays on the receiver. @param {OpticalScene} scene @param {Design} design @param {number} longitudinalDeg */
export function endLossFactor(scene, design, longitudinalDeg) {
  return Math.max(0, 1 - (scene.meanReceiverDistance * Math.tan(Math.abs(longitudinalDeg) * Math.PI / 180)) / design.mounting.rowLength);
}

/**
 * Absorbed power per metre of collector at one moment.
 * @param {Design} design @param {OpticalScene} scene @param {IamGrid} grid @param {number} dayOfYear @param {number} hour @param {number} dni
 */
export function powerAt(design, scene, grid, dayOfYear, hour, dni) {
  if (!(dni > 0)) return 0;
  const sun = sunPosition(design.site, dayOfYear, hour);
  const angles = collectorAngles(sun, design.mounting, grid.tracking ? 'tracking' : 'fixed');
  if (!angles || angles.cosIncidence <= 0) return 0;
  return dni * scene.reference.width * (scene.reference.cosine ? angles.cosIncidence : 1) * interpolateEta(grid, angles.transversalDeg, angles.longitudinalDeg) * endLossFactor(scene, design, angles.longitudinalDeg);
}

/** DNI at an hour of the year: from the weather file, or the clear-sky model. @param {Design} design @param {number} dayOfYear @param {number} hour */
export function dniAt(design, dayOfYear, hour) {
  if (design.weather.source === 'epw') return design.weather.dni[(dayOfYear - 1) * 24 + Math.floor(hour)] ?? 0;
  return clearSkyDni(dayOfYear, sunPosition(design.site, dayOfYear, hour).zenith);
}

/** Representative days: the equinoxes and solstices. */
export const DAYS = [{ day: 80, label: '21 March' }, { day: 172, label: '21 June' }, { day: 264, label: '21 September' }, { day: 355, label: '21 December' }];

/** Absorbed power through four representative days, every ten minutes. @param {Design} design @param {OpticalScene} scene @param {IamGrid} grid @returns {DayCurve[]} */
export function dayStudy(design, scene, grid) {
  return DAYS.map(({ day, label }) => {
    /** @type {[number, number][]} */
    const points = [];
    let energy = 0;
    for (let m = 0; m <= 24 * 60; m += 10) {
      const hour = m / 60;
      const dni = design.weather.source === 'epw' ? dniAt(design, day, Math.min(23.99, hour)) : clearSkyDni(day, sunPosition(design.site, day, hour).zenith);
      const q = powerAt(design, scene, grid, day, hour, dni);
      points.push([hour, q]);
      energy += (q * 10) / 60;
    }
    return { day, label, points, energy };
  });
}

/** Hourly integration over a 365-day year, at the middle of each hour. @param {Design} design @param {OpticalScene} scene @param {IamGrid} grid @returns {YearResult} */
export function yearStudy(design, scene, grid) {
  const monthly = new Array(12).fill(0);
  let total = 0, dniTotal = 0, beamOnAperture = 0, hoursOfSun = 0;
  for (let h = 0; h < 8760; h++) {
    const day = Math.floor(h / 24) + 1, hour = (h % 24) + 0.5;
    const dni = dniAt(design, day, hour);
    if (!(dni > 0)) continue;
    const sun = sunPosition(design.site, day, hour);
    if (sun.zenith >= 90) continue;
    hoursOfSun++;
    dniTotal += dni;
    const angles = collectorAngles(sun, design.mounting, grid.tracking ? 'tracking' : 'fixed');
    if (!angles || angles.cosIncidence <= 0) continue;
    beamOnAperture += dni * angles.cosIncidence;
    const q = dni * scene.reference.width * (scene.reference.cosine ? angles.cosIncidence : 1) * interpolateEta(grid, angles.transversalDeg, angles.longitudinalDeg) * endLossFactor(scene, design, angles.longitudinalDeg);
    let month = 0;
    while (month < 11 && day > MONTH_START[month + 1]) month++;
    monthly[month] += q / 1000;
    total += q / 1000;
  }
  const width = scene.reference.width;
  return {
    monthly, total, perArea: total / width, dni: dniTotal / 1000, beamOnAperture: beamOnAperture / 1000,
    efficiencyVsDni: dniTotal > 0 ? (total * 1000) / (dniTotal * width) : 0,
    efficiencyVsAperture: beamOnAperture > 0 ? (total * 1000) / (beamOnAperture * width) : 0,
    hoursOfSun,
    source: design.weather.source === 'epw' ? design.weather.name : 'ASHRAE clear sky',
  };
}
