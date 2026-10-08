/** Scenes traced by both Linefocus and Ray Optics Simulation. They use only what Ray Optics models the same
 * way: ideal mirrors, opaque backs, collimated light and flat absorbers. */

import { rowPositions, rowNormal, mirrorRow, buildFresnel } from '../../src/core/collectors/fresnel.js';

const MIRROR = { kind: 'mirror', reflectance: 1, slopeErrorMrad: 0, specularityMrad: 0 };
const ABSORBER = { kind: 'absorber', absorptance: 1 };
const COLLIMATED = { shape: 'pillbox', halfAngleMrad: 0 };

/** Downward-facing flat absorber of width w centred at (0, h). */
const absorber = (w, h) => ({ id: 'absorber', label: 'Absorber', group: 'receiver', shape: { kind: 'segment', x1: w / 2, y1: h, x2: -w / 2, y2: h }, material: ABSORBER });

const parabola = (f, width) => ({ id: 'mirror', label: 'Mirror', group: 'primary', shape: { kind: 'parabola', vx: 0, vy: 0, angle: 0, f, u0: -width / 2, u1: width / 2 }, material: MIRROR });

/** Flat Fresnel rows aimed at (0, h) for a sun at transversal angle θ (degrees), built by the app's own LFR code. */
function fresnelRows(count, width, pitch, h, thetaDeg) {
  return rowPositions({ rows: count, pitch }).map((x, i) => mirrorRow(`row-${i}`, `Row ${i + 1}`, x, width, rowNormal(x, h, thetaDeg), null, MIRROR));
}

const scene = (surfaces, width) => ({ surfaces, reference: { width, label: 'Reference', cosine: true }, meanReceiverDistance: 1 });

export const ORACLE_CASES = [
  { name: 'trough-on-axis', scene: scene([parabola(1, 3), absorber(0.04, 1)], 3), sun: COLLIMATED, transversalDeg: 0 },
  { name: 'trough-half-degree', scene: scene([parabola(1, 3), absorber(0.04, 1)], 3), sun: COLLIMATED, transversalDeg: 0.5 },
  { name: 'trough-one-degree', scene: scene([parabola(1, 3), absorber(0.06, 1)], 3), sun: COLLIMATED, transversalDeg: 1 },
  { name: 'fresnel-30-degrees', scene: scene([...fresnelRows(7, 0.5, 0.6, 4, 30), absorber(0.3, 4)], 3.5), sun: COLLIMATED, transversalDeg: 30 },
  // A low receiver makes reflected rays run into the backs of neighbouring rows (blocking).
  { name: 'fresnel-blocking', scene: scene([...fresnelRows(9, 0.5, 0.5, 0.8, 45), absorber(0.3, 0.8)], 4.5), sun: COLLIMATED, transversalDeg: 45 },
  // The app's full LFR builder with cylindrical rows, a flat absorber and its insulated back.
  { name: 'fresnel-builder-cylindrical', scene: buildFresnel(
    { type: 'fresnel', rows: 8, mirrorWidth: 0.5, pitch: 0.6, receiverHeight: 3, curvature: 'cylindrical', curvatureRadius: 6.5, secondary: { kind: 'none' } },
    { type: 'flat', width: 0.12, absorptance: 1, insulation: 0.03, cover: { mode: 'none', gap: 0, overhang: 0, thickness: 0.004, refractiveIndex: 1.5, extinction: 0, transmittance: 1 } },
    { reflectance: 1, slopeErrorMrad: 0, specularityMrad: 0 }, 20), sun: COLLIMATED, transversalDeg: 20 },
  { name: 'fresnel-60-degrees', scene: scene([...fresnelRows(7, 0.5, 0.5, 2, 60), absorber(0.3, 2)], 3.5), sun: COLLIMATED, transversalDeg: 60 },
];
