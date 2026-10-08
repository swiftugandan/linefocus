/** Parabolic trough: mirror y = x²/(4f) for |x| ≤ W/2 with a tube receiver at the focus. */

import { tubeReceiverSurfaces } from './receiver.js';

/** @import { OpticalScene } from '../types.js' */
/** @import { TroughCollector, TubeReceiver, Optics } from '../model.js' */

/** Rim angle in radians. @param {TroughCollector} c */
export function troughRimAngle(c) {
  return 2 * Math.atan(c.apertureWidth / (4 * c.focalLength));
}

/**
 * Smallest absorber diameter that intercepts every ray from an error-free mirror under a pillbox sun.
 * @param {TroughCollector} c @param {number} halfAngleRad
 */
export function troughMinimumDiameter(c, halfAngleRad) {
  return (c.apertureWidth * Math.sin(halfAngleRad)) / Math.sin(troughRimAngle(c));
}

/**
 * @param {TroughCollector} c @param {TubeReceiver} receiver @param {Optics} optics
 * @returns {OpticalScene}
 */
export function buildTrough(c, receiver, optics) {
  const half = c.apertureWidth / 2;
  return {
    surfaces: [
      {
        id: 'mirror', label: 'Parabolic mirror', group: 'primary',
        shape: { kind: 'parabola', vx: 0, vy: 0, angle: 0, f: c.focalLength, u0: -half, u1: half },
        material: { kind: 'mirror', reflectance: optics.reflectance, slopeErrorMrad: optics.slopeErrorMrad, specularityMrad: optics.specularityMrad },
      },
      ...tubeReceiverSurfaces(receiver, 0, c.focalLength),
    ],
    reference: { width: c.apertureWidth, label: 'Aperture width', cosine: true },
    meanReceiverDistance: c.focalLength * (1 + (c.apertureWidth * c.apertureWidth) / (48 * c.focalLength * c.focalLength)),
  };
}
