/** Sunshape sampling: the angular distribution of sunlight around the sun centre. See docs/PHYSICS.md. */

/** @import { Rng } from './rng.js' */
/** @import { SunSpec } from './types.js' */

/** Edge of the solar disc used by the Buie model, in milliradians. */
export const BUIE_DISC_MRAD = 4.65;
/** Outer edge of the Buie circumsolar aureole, in milliradians. */
export const BUIE_AUREOLE_MRAD = 43.6;

/** @param {number} csr circumsolar ratio χ */
export function buieIntensity(csr) {
  const kappa = 0.9 * Math.log(13.5 * csr) * Math.pow(csr, -0.3);
  const gamma = 2.2 * Math.log(0.52 * csr) * Math.pow(csr, 0.43) - 0.1;
  /** @param {number} theta angle from centre in mrad */
  return theta => theta <= BUIE_DISC_MRAD
    ? Math.cos(0.326 * theta) / Math.cos(0.308 * theta)
    : Math.exp(kappa) * Math.pow(theta, gamma);
}

/** @type {Map<number, {theta: Float64Array, cdf: Float64Array}>} */
const buieTables = new Map();

/** Cumulative distribution of the radial offset for a Buie sun, tabulated on a fine grid. @param {number} csr */
function buieTable(csr) {
  const key = Math.round(csr * 1e6);
  const cached = buieTables.get(key);
  if (cached) return cached;
  const phi = buieIntensity(csr), n = 4096;
  const theta = new Float64Array(n + 1), cdf = new Float64Array(n + 1);
  // Denser sampling inside the disc, where most of the energy is.
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    theta[i] = u <= 0.6 ? (u / 0.6) * BUIE_DISC_MRAD : BUIE_DISC_MRAD + ((u - 0.6) / 0.4) * (BUIE_AUREOLE_MRAD - BUIE_DISC_MRAD);
  }
  for (let i = 1; i <= n; i++) {
    const a = theta[i - 1], b = theta[i];
    cdf[i] = cdf[i - 1] + 0.5 * (phi(a) * a + phi(b) * b) * (b - a);
  }
  for (let i = 1; i <= n; i++) cdf[i] /= cdf[n];
  const table = { theta, cdf };
  buieTables.set(key, table);
  return table;
}

/**
 * Builds a sampler that returns radial offsets from the sun centre, in radians.
 * @param {SunSpec} sun
 * @returns {(rng: Rng) => number}
 */
export function radialSampler(sun) {
  if (sun.shape === 'pillbox') {
    const half = sun.halfAngleMrad * 1e-3;
    return rng => half * Math.sqrt(rng.next());
  }
  if (sun.shape === 'gaussian') {
    const sigma = sun.sigmaMrad * 1e-3;
    return rng => sigma * Math.sqrt(-2 * Math.log(rng.open()));
  }
  const { theta, cdf } = buieTable(sun.csr);
  return rng => {
    const u = rng.next();
    let lo = 0, hi = cdf.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cdf[mid] < u) lo = mid; else hi = mid; }
    const span = cdf[hi] - cdf[lo];
    const f = span > 0 ? (u - cdf[lo]) / span : 0;
    return (theta[lo] + f * (theta[hi] - theta[lo])) * 1e-3;
  };
}

/**
 * Standard deviation of the sunshape projected on one axis, in mrad. Used only for the combined-error
 * estimate shown alongside results.
 * @param {SunSpec} sun
 */
export function sunshapeSigmaMrad(sun) {
  if (sun.shape === 'pillbox') return sun.halfAngleMrad / 2;
  if (sun.shape === 'gaussian') return sun.sigmaMrad;
  const { theta, cdf } = buieTable(sun.csr);
  // E[r²]/2 per axis for an isotropic radial distribution.
  let m2 = 0;
  for (let i = 1; i < theta.length; i++) {
    const r = 0.5 * (theta[i] + theta[i - 1]);
    m2 += r * r * (cdf[i] - cdf[i - 1]);
  }
  return Math.sqrt(m2 / 2);
}
