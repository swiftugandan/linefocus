/** Turns a design document into a traceable cross-section, the trace settings for its design point, and the
 * derived figures an engineer reads alongside it. */

import { buildTrough, troughRimAngle } from './collectors/trough.js';
import { tubeOuterRadius } from './collectors/receiver.js';
import { sunshapeSigmaMrad } from './sunshape.js';

/** @import { Design } from './model.js' */
/** @import { OpticalScene, TraceOptions } from './types.js' */

/**
 * A derived, read-only figure about the design.
 * @typedef {{ key: string, label: string, value: number, unit: string, digits: number, help?: string }} Figure
 */

/** Collector types whose aperture follows the sun across the transversal plane. @param {Design} design */
export function tracksTransversally(design) {
  return design.collector.type === 'trough';
}

/**
 * @param {Design} design
 * @returns {{ scene: OpticalScene, figures: Figure[] }}
 */
export function buildDesignScene(design) {
  const c = design.collector, r = design.receiver;
  if (c.type === 'trough') {
    if (r.type !== 'tube') throw new Error('A parabolic trough needs an absorber tube.');
    const scene = buildTrough(c, r, design.optics);
    const rim = troughRimAngle(c);
    return {
      scene,
      figures: [
        { key: 'rimAngle', label: 'Rim angle', value: (rim * 180) / Math.PI, unit: '°', digits: 1 },
        { key: 'concentration', label: 'Geometric concentration', value: c.apertureWidth / (Math.PI * r.absorberDiameter), unit: '×', digits: 1, help: 'Aperture width over absorber circumference' },
        { key: 'shading', label: 'Receiver shadow', value: (2 * tubeOuterRadius(r)) / c.apertureWidth * 100, unit: '%', digits: 2, help: 'Share of the aperture behind the receiver' },
        { key: 'opticalError', label: 'Combined optical error', value: combinedErrorMrad(design), unit: 'mrad', digits: 2, help: '√(σsun² + 4σslope² + σspec²), for comparison only' },
      ],
    };
  }
  throw new Error(`${c.type === 'fresnel' ? 'Linear Fresnel' : 'CPC'} collectors are not available yet.`);
}

/** The usual combined-error estimate. Shown for comparison; the trace does not use it. @param {Design} design */
export function combinedErrorMrad(design) {
  const o = design.optics;
  return Math.sqrt(sunshapeSigmaMrad(design.sun) ** 2 + 4 * o.slopeErrorMrad ** 2 + o.specularityMrad ** 2);
}

/**
 * Trace settings at the design point. The design point is the sun direction relative to the reference aperture,
 * exactly as traced; a tracking collector's misalignment is part of it. Tracking error from the mounting applies
 * only when sun positions are converted to the collector frame in the day and year studies.
 * @param {Design} design @param {{ rays?: number, pathCount?: number }} [overrides]
 * @returns {TraceOptions}
 */
export function designPointOptions(design, overrides = {}) {
  return {
    sun: design.sun,
    transversalDeg: design.designPoint.transversalDeg,
    longitudinalDeg: design.designPoint.longitudinalDeg,
    dni: design.designPoint.dni,
    rays: overrides.rays ?? design.simulation.rays,
    seed: design.simulation.seed,
    pathCount: overrides.pathCount ?? 0,
  };
}
