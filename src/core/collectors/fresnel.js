/** Linear Fresnel reflector: rows of flat or cylindrical mirrors on a horizontal field, each turned so its normal
 * bisects the sun and the receiver, with a tube or flat receiver above and an optional trapezoidal cavity. */

import { tubeReceiverSurfaces, flatReceiverSurfaces, tubeOuterRadius } from './receiver.js';

/** @import { OpticalScene, Surface, MirrorMaterial } from '../types.js' */
/** @import { FresnelCollector, Receiver, Optics } from '../model.js' */

/** Clearance between a tube receiver and the cavity walls, metres. */
const CAVITY_CLEARANCE = 0.005;

/** Pivot x-positions of the rows, symmetric about the receiver. @param {FresnelCollector} c */
export function rowPositions(c) {
  return Array.from({ length: c.rows }, (_, i) => (i - (c.rows - 1) / 2) * c.pitch);
}

/**
 * Unit normal of a row whose pivot is at (x, 0), bisecting the projected sun direction and the direction to the
 * aim point (0, h).
 * @param {number} x @param {number} h @param {number} aimDeg sun's transversal angle the row tracks
 */
export function rowNormal(x, h, aimDeg) {
  const t = (aimDeg * Math.PI) / 180;
  const rl = Math.hypot(x, h);
  const nx = Math.sin(t) - x / rl, ny = Math.cos(t) + h / rl;
  const len = Math.hypot(nx, ny);
  return [nx / len, ny / len];
}

/**
 * One mirror row as a surface: a segment for a flat row, or a circular arc concave towards the receiver.
 * @param {string} id @param {string} label @param {number} x pivot @param {number} width @param {number[]} normal
 * @param {number | null} radius @param {MirrorMaterial} material
 * @returns {Surface}
 */
export function mirrorRow(id, label, x, width, [nx, ny], radius, material) {
  if (radius === null) {
    // The left-hand normal of a segment from P1 to P2 is the row normal when P2 − P1 = (ny, −nx).
    const tx = ny, ty = -nx;
    return { id, label, group: 'primary', material, shape: { kind: 'segment', x1: x - (tx * width) / 2, y1: -(ty * width) / 2, x2: x + (tx * width) / 2, y2: (ty * width) / 2 } };
  }
  const half = Math.asin(Math.min(1, width / (2 * radius)));
  const centreAngle = Math.atan2(-ny, -nx);
  // The arc's own front faces away from its centre; the mirror reflects on the inside, so flip it.
  return { id, label, group: 'primary', material, flip: true, shape: { kind: 'arc', cx: x + nx * radius, cy: ny * radius, r: radius, start: centreAngle - half, sweep: 2 * half } };
}

/**
 * @param {FresnelCollector} c @param {Receiver} receiver @param {Optics} optics @param {number} aimDeg
 * @returns {OpticalScene}
 */
export function buildFresnel(c, receiver, optics, aimDeg) {
  const material = /** @type {MirrorMaterial} */ ({ kind: 'mirror', reflectance: optics.reflectance, slopeErrorMrad: optics.slopeErrorMrad, specularityMrad: optics.specularityMrad });
  const h = c.receiverHeight;
  const radius = c.curvature === 'cylindrical' ? c.curvatureRadius : null;
  const xs = rowPositions(c);
  /** @type {Surface[]} */
  const surfaces = xs.map((x, i) => mirrorRow(`row-${i + 1}`, `Mirror row ${i + 1}`, x, c.mirrorWidth, rowNormal(x, h, aimDeg), radius, material));
  surfaces.push(...(receiver.type === 'tube' ? tubeReceiverSurfaces(receiver, 0, h) : flatReceiverSurfaces(receiver, 0, h)));
  if (c.secondary.kind === 'trapezoid') surfaces.push(...cavitySurfaces(c.secondary, receiver, h, material));
  return {
    surfaces,
    // The usual LFR convention: efficiency is relative to DNI on the mirror area, so the field's cosine loss
    // sits inside the efficiency and its incidence modifiers stay at or below 1.
    reference: { width: c.rows * c.mirrorWidth, label: 'Total mirror width', cosine: false },
    meanReceiverDistance: xs.reduce((sum, x) => sum + Math.hypot(x, h), 0) / xs.length,
  };
}

/**
 * Trapezoidal cavity: two mirror walls from the top of the receiver down and out to the mouth, closed above by an
 * opaque, insulated cover.
 * @param {{ depth: number, mouthWidth: number }} cavity @param {Receiver} receiver @param {number} h @param {MirrorMaterial} material
 * @returns {Surface[]}
 */
export function cavitySurfaces(cavity, receiver, h, material) {
  // A tube sits inside the cavity under an insulated cover; a flat absorber is itself the top of the cavity.
  const tube = receiver.type === 'tube';
  const top = tube ? h + tubeOuterRadius(receiver) + CAVITY_CLEARANCE : h;
  const topHalf = tube ? tubeOuterRadius(receiver) + CAVITY_CLEARANCE : receiver.width / 2;
  const mouthY = top - cavity.depth, mouthHalf = cavity.mouthWidth / 2;
  /** @type {Surface[]} */
  const walls = [
    // Each wall runs so that its left-hand normal faces into the cavity.
    { id: 'cavity-left', label: 'Cavity wall (left)', group: 'secondary', material, shape: { kind: 'segment', x1: -topHalf, y1: top, x2: -mouthHalf, y2: mouthY } },
    { id: 'cavity-right', label: 'Cavity wall (right)', group: 'secondary', material, shape: { kind: 'segment', x1: mouthHalf, y1: mouthY, x2: topHalf, y2: top } },
  ];
  if (tube) walls.push({ id: 'cavity-cover', label: 'Cavity cover', group: 'secondary', material: { kind: 'opaque' }, shape: { kind: 'segment', x1: -topHalf, y1: top, x2: topHalf, y2: top } });
  return walls;
}
