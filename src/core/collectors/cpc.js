/** Compound parabolic concentrators: the flat-absorber CPC (two tilted parabolas) and the tube CPC (involute plus
 * parabolic section, after Winston and Rabl). Geometry is in docs/PHYSICS.md. */

import { tubeReceiverSurfaces, tubeOuterRadius } from './receiver.js';

/** @import { OpticalScene, Surface, MirrorMaterial } from '../types.js' */
/** @import { CpcCollector, Receiver, FlatReceiver, TubeReceiver, Optics } from '../model.js' */

/** @param {Optics} optics @returns {MirrorMaterial} */
const mirror = optics => ({ kind: 'mirror', reflectance: optics.reflectance, slopeErrorMrad: optics.slopeErrorMrad, specularityMrad: optics.specularityMrad });

/**
 * The right reflector of a flat-absorber CPC as a parabola: focus at the left absorber edge (−a′, 0), axis along
 * the extreme ray at θa, focal length a′(1 + sin θa).
 * @param {number} halfWidth absorber half-width a′ @param {number} acceptanceRad θa
 */
export function flatCpcParabola(halfWidth, acceptanceRad) {
  const s = Math.sin(acceptanceRad), c = Math.cos(acceptanceRad);
  const f = halfWidth * (1 + s);
  // Vertex = focus − f · (opening direction), with the parabola opening towards (−s, c).
  const vx = -halfWidth + f * s, vy = -f * c;
  const uMin = 2 * halfWidth * c, uFull = (2 * f * c) / s;
  /** Global point at local coordinate u. @param {number} u */
  const at = u => { const v = (u * u) / (4 * f); return [vx + u * c - v * s, vy + u * s + v * c]; };
  /** Local u where the reflector reaches height y. @param {number} y */
  const uAtHeight = y => {
    // (c/4f)u² + s·u + (vy − y) = 0, taking the root on the reflector.
    const a = c / (4 * f), b = s, k = vy - y;
    return a > 1e-12 ? (-b + Math.sqrt(b * b - 4 * a * k)) / (2 * a) : -k / b;
  };
  return { f, vx, vy, uMin, uFull, at, uAtHeight, fullHeight: at(uFull)[1] };
}

/**
 * Right-hand profile of a tube CPC for design radius r: P(θ) = r(sin θ, −cos θ) − ρ(θ)(cos θ, sin θ).
 * @param {number} r @param {number} acceptanceRad @param {number} theta
 */
export function tubeCpcPoint(r, acceptanceRad, theta) {
  const a = acceptanceRad;
  const rho = theta <= a + Math.PI / 2 ? r * theta : (r * (theta + a + Math.PI / 2 - Math.cos(theta - a))) / (1 + Math.sin(theta - a));
  return [r * Math.sin(theta) - rho * Math.cos(theta), -r * Math.cos(theta) - rho * Math.sin(theta)];
}

/**
 * Upward-facing flat absorber centred at (0, 0) with insulation below and an optional glass cover above.
 * @param {FlatReceiver} receiver
 * @returns {Surface[]}
 */
export function upwardFlatReceiverSurfaces(receiver) {
  const half = receiver.width / 2;
  /** @type {Surface[]} */
  const surfaces = [
    // Left to right, so the front (left-hand) normal points up into the CPC.
    { id: 'absorber', label: 'Absorber plate', group: 'receiver', shape: { kind: 'segment', x1: -half, y1: 0, x2: half, y2: 0 }, material: { kind: 'absorber', absorptance: receiver.absorptance } },
    { id: 'insulation', label: 'Insulated back', group: 'receiver', shape: { kind: 'segment', x1: half, y1: -receiver.insulation, x2: -half, y2: -receiver.insulation }, material: { kind: 'opaque' } },
  ];
  const cover = receiver.cover;
  if (cover.mode === 'none') return surfaces;
  // A cover can't overhang into the reflectors, so it spans the absorber only.
  const y0 = cover.gap;
  if (cover.mode === 'fixed') {
    surfaces.push({ id: 'cover', label: 'Glass cover', group: 'receiver', shape: { kind: 'segment', x1: -half, y1: y0, x2: half, y2: y0 }, material: { kind: 'thin-glass', transmittance: cover.transmittance } });
    return surfaces;
  }
  const glass = { n: cover.refractiveIndex, k: cover.extinction }, air = { n: 1, k: 0 };
  const y1 = y0 + cover.thickness;
  /** @type {[number, number, number, number, string][]} */
  const sides = [[-half, y0, half, y0, 'bottom'], [half, y0, half, y1, 'right'], [half, y1, -half, y1, 'top'], [-half, y1, -half, y0, 'left']];
  for (const [x1, ya, x2, yb, side] of sides) {
    surfaces.push({ id: `cover-${side}`, label: `Glass cover (${side})`, group: 'receiver', shape: { kind: 'segment', x1, y1: ya, x2, y2: yb }, material: { kind: 'dielectric', front: glass, back: air } });
  }
  return surfaces;
}

/**
 * @param {CpcCollector} c @param {Receiver} receiver @param {Optics} optics
 * @returns {OpticalScene & { aperture: number, fullAperture: number, height: number, fullHeight: number, bottom: number, absorberSize: number }}
 */
export function buildCpc(c, receiver, optics) {
  const theta = (c.acceptanceHalfAngleDeg * Math.PI) / 180;
  const material = mirror(optics);
  if (receiver.type === 'flat') {
    const halfWidth = receiver.width / 2 + c.gap;
    const p = flatCpcParabola(halfWidth, theta);
    const top = p.uAtHeight(c.truncation * p.fullHeight);
    const [xTop] = p.at(top);
    // The reflectors start at the absorber plane, c.gap beyond its edges.
    return {
      surfaces: [
        { id: 'reflector-right', label: 'Reflector (right)', group: 'primary', material, shape: { kind: 'parabola', vx: p.vx, vy: p.vy, angle: theta, f: p.f, u0: p.uMin, u1: top } },
        { id: 'reflector-left', label: 'Reflector (left)', group: 'primary', material, shape: { kind: 'parabola', vx: -p.vx, vy: p.vy, angle: -theta, f: p.f, u0: -top, u1: -p.uMin } },
        ...upwardFlatReceiverSurfaces(receiver),
      ],
      reference: { width: 2 * xTop, label: 'Aperture width', cosine: true },
      meanReceiverDistance: (c.truncation * p.fullHeight) / 2,
      aperture: 2 * xTop,
      fullAperture: 2 * p.at(p.uFull)[0],
      height: c.truncation * p.fullHeight,
      fullHeight: p.fullHeight,
      bottom: 0,
      absorberSize: receiver.width,
    };
  }
  return buildTubeCpc(c, receiver, material, theta);
}

/**
 * @param {CpcCollector} c @param {TubeReceiver} receiver @param {MirrorMaterial} material @param {number} theta
 */
function buildTubeCpc(c, receiver, material, theta) {
  const r = tubeOuterRadius(receiver) + c.gap;
  const end = 1.5 * Math.PI - theta;
  const samples = 720;
  /** @type {number[][]} */
  const pts = [];
  for (let i = 0; i <= samples; i++) pts.push(tubeCpcPoint(r, theta, Math.max(1e-6, (end * i) / samples)));
  // The involute first dips below the cusp, then the profile rises to the top. Height is kept from the lowest point.
  let iMin = 0;
  for (let i = 1; i < pts.length; i++) if (pts[i][1] < pts[iMin][1]) iMin = i;
  const yMin = pts[iMin][1];
  const yFull = pts[pts.length - 1][1];
  const yCut = yMin + c.truncation * (yFull - yMin);
  /** @type {number[][]} */
  const kept = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (i > iMin && p[1] >= yCut && pts[i - 1][1] < yCut) {
      const q = pts[i - 1], f = (yCut - q[1]) / (p[1] - q[1]);
      kept.push([q[0] + f * (p[0] - q[0]), yCut]);
      break;
    }
    kept.push(p);
  }
  const points = kept.flat();
  const normals = profileNormals(kept);
  const mirrored = kept.map(([x, y]) => [-x, y]).reverse();
  const xTop = kept[kept.length - 1][0];
  /** @type {Surface[]} */
  const surfaces = [
    { id: 'reflector-right', label: 'Reflector (right)', group: 'primary', material, shape: { kind: 'polyline', points, normals } },
    { id: 'reflector-left', label: 'Reflector (left)', group: 'primary', material, shape: { kind: 'polyline', points: mirrored.flat(), normals: profileNormals(mirrored) } },
    ...tubeReceiverSurfaces(receiver, 0, 0),
  ];
  return {
    surfaces,
    reference: { width: 2 * xTop, label: 'Aperture width', cosine: true },
    meanReceiverDistance: (yCut - yMin) / 2,
    aperture: 2 * xTop,
    fullAperture: (2 * Math.PI * r) / Math.sin(theta),
    height: yCut - yMin,
    fullHeight: yFull - yMin,
    bottom: yMin,
    absorberSize: Math.PI * receiver.absorberDiameter,
  };
}

/**
 * Unit normals along a profile, perpendicular to the local tangent and facing the tube centre at the origin.
 * @param {number[][]} pts
 */
function profileNormals(pts) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    let nx = -(b[1] - a[1]), ny = b[0] - a[0];
    const len = Math.hypot(nx, ny) || 1;
    nx /= len; ny /= len;
    if (nx * -pts[i][0] + ny * -pts[i][1] < 0) { nx = -nx; ny = -ny; }
    out.push(nx, ny);
  }
  return out;
}
