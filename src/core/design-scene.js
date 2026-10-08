/** Turns a design document into a traceable cross-section, the trace settings for its design point, and the
 * derived figures an engineer reads alongside it. */

import { buildTrough, troughRimAngle } from './collectors/trough.js';
import { tubeOuterRadius } from './collectors/receiver.js';
import { buildFresnel, rowPositions } from './collectors/fresnel.js';
import { buildCpc } from './collectors/cpc.js';
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

/** Collectors whose mirrors turn with the sun, so their geometry depends on the sun angle. @param {Design} design */
export function tracksSun(design) {
  return design.collector.type === 'fresnel';
}

/**
 * Builds the cross-section. LFR rows are aimed for a sun at `aimDeg` across the field; other collectors ignore it.
 * @param {Design} design @param {number} [aimDeg] defaults to the design point
 * @returns {{ scene: OpticalScene, figures: Figure[] }}
 */
export function buildDesignScene(design, aimDeg = design.designPoint.transversalDeg) {
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
  if (c.type === 'fresnel') {
    const scene = buildFresnel(c, r, design.optics, aimDeg);
    const outer = Math.max(...rowPositions(c).map(Math.abs));
    const absorber = r.type === 'tube' ? Math.PI * r.absorberDiameter : r.width;
    return {
      scene,
      figures: [
        { key: 'fieldWidth', label: 'Field width', value: c.rows * c.pitch, unit: 'm', digits: 2, help: 'Rows × pitch' },
        { key: 'fill', label: 'Ground cover', value: (c.mirrorWidth / c.pitch) * 100, unit: '%', digits: 1, help: 'Mirror width over pitch' },
        { key: 'rim', label: 'Outer row angle', value: (Math.atan(outer / c.receiverHeight) * 180) / Math.PI, unit: '°', digits: 1, help: 'Angle from the receiver down to the outermost row, from vertical' },
        { key: 'concentration', label: 'Geometric concentration', value: scene.reference.width / absorber, unit: '×', digits: 1, help: 'Mirror width over absorber perimeter or width' },
        { key: 'opticalError', label: 'Combined optical error', value: combinedErrorMrad(design), unit: 'mrad', digits: 2, help: '√(σsun² + 4σslope² + σspec²), for comparison only' },
      ],
    };
  }
  const built = buildCpc(c, r, design.optics);
  const { aperture, fullAperture, height, fullHeight, bottom, absorberSize, ...scene } = built;
  return {
    scene,
    figures: [
      { key: 'aperture', label: 'Aperture width', value: aperture * 1000, unit: 'mm', digits: 0 },
      { key: 'height', label: 'Reflector height', value: height * 1000, unit: 'mm', digits: 0, help: 'From the lowest point of the reflector to the top' },
      { key: 'concentration', label: 'Geometric concentration', value: aperture / absorberSize, unit: '×', digits: 2, help: 'Aperture width over absorber perimeter or width' },
      { key: 'ideal', label: 'Ideal concentration', value: 1 / Math.sin((c.acceptanceHalfAngleDeg * Math.PI) / 180), unit: '×', digits: 2, help: '1 / sin θa, for a full CPC with no gap' },
      { key: 'fullAperture', label: 'Untruncated aperture', value: fullAperture * 1000, unit: 'mm', digits: 0 },
    ],
  };
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
