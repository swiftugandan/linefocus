/** Receiver assemblies shared by the collector builders. */

/** @import { Surface } from '../types.js' */
/** @import { TubeReceiver, FlatReceiver } from '../model.js' */

/**
 * Absorber tube with an optional glass envelope, centred at (cx, cy).
 * @param {TubeReceiver} receiver @param {number} cx @param {number} cy
 * @returns {Surface[]}
 */
export function tubeReceiverSurfaces(receiver, cx, cy) {
  /** @type {Surface[]} */
  const surfaces = [{
    id: 'absorber', label: 'Absorber tube', group: 'receiver',
    shape: { kind: 'circle', cx, cy, r: receiver.absorberDiameter / 2 },
    material: { kind: 'absorber', absorptance: receiver.absorptance },
  }];
  const envelope = receiver.envelope;
  if (envelope.mode === 'fixed') {
    surfaces.push({
      id: 'envelope', label: 'Glass envelope', group: 'receiver',
      shape: { kind: 'circle', cx, cy, r: envelope.outerDiameter / 2 },
      material: { kind: 'thin-glass', transmittance: envelope.transmittance },
    });
  } else if (envelope.mode === 'physical') {
    const glass = { n: envelope.refractiveIndex, k: envelope.extinction };
    surfaces.push({
      id: 'envelope-outer', label: 'Glass envelope (outer)', group: 'receiver',
      shape: { kind: 'circle', cx, cy, r: envelope.outerDiameter / 2 },
      material: { kind: 'dielectric', front: { n: 1, k: 0 }, back: glass },
    }, {
      id: 'envelope-inner', label: 'Glass envelope (inner)', group: 'receiver',
      shape: { kind: 'circle', cx, cy, r: envelope.outerDiameter / 2 - envelope.thickness },
      material: { kind: 'dielectric', front: glass, back: { n: 1, k: 0 } },
    });
  }
  return surfaces;
}

/** Outer radius of a tube receiver, including its envelope. @param {TubeReceiver} receiver */
export function tubeOuterRadius(receiver) {
  return receiver.envelope.mode === 'none' ? receiver.absorberDiameter / 2 : receiver.envelope.outerDiameter / 2;
}

/**
 * Downward-facing flat absorber centred at (cx, cy), with an insulated top and an optional glass cover
 * below it. The cover is a closed slab so the tracer always knows which medium a ray is in.
 * @param {FlatReceiver} receiver @param {number} cx @param {number} cy
 * @returns {Surface[]}
 */
export function flatReceiverSurfaces(receiver, cx, cy) {
  const half = receiver.width / 2;
  /** @type {Surface[]} */
  const surfaces = [{
    // Drawn right-to-left so the front (left-hand) normal points down, towards the field.
    id: 'absorber', label: 'Absorber plate', group: 'receiver',
    shape: { kind: 'segment', x1: cx + half, y1: cy, x2: cx - half, y2: cy },
    material: { kind: 'absorber', absorptance: receiver.absorptance },
  }, {
    id: 'insulation', label: 'Insulated back', group: 'receiver',
    shape: { kind: 'segment', x1: cx - half, y1: cy + receiver.insulation, x2: cx + half, y2: cy + receiver.insulation },
    material: { kind: 'opaque' },
  }];
  const cover = receiver.cover;
  if (cover.mode === 'none') return surfaces;
  const y0 = cy - cover.gap, w = half + cover.overhang;
  if (cover.mode === 'fixed') {
    surfaces.push({
      id: 'cover', label: 'Glass cover', group: 'receiver',
      shape: { kind: 'segment', x1: cx + w, y1: y0, x2: cx - w, y2: y0 },
      material: { kind: 'thin-glass', transmittance: cover.transmittance },
    });
    return surfaces;
  }
  const glass = { n: cover.refractiveIndex, k: cover.extinction }, air = { n: 1, k: 0 };
  const y1 = y0 - cover.thickness;
  /** @type {[number, number, number, number, string][]} */
  const sides = [
    // Counter-clockwise around the slab, so every left-hand normal points out of the glass.
    [cx - w, y1, cx + w, y1, 'bottom'], [cx + w, y1, cx + w, y0, 'right'], [cx + w, y0, cx - w, y0, 'top'], [cx - w, y0, cx - w, y1, 'left'],
  ];
  for (const [x1, ya, x2, yb, side] of sides) {
    surfaces.push({
      id: `cover-${side}`, label: `Glass cover (${side})`, group: 'receiver',
      shape: { kind: 'segment', x1, y1: ya, x2, y2: yb },
      // The left-hand normal of a counter-clockwise loop points inwards, so the glass is on the front side.
      material: { kind: 'dielectric', front: glass, back: air },
    });
  }
  return surfaces;
}
