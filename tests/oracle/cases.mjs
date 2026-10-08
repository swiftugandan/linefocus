/** Scenes traced by both Linefocus and Ray Optics Simulation. They use only what Ray Optics models the same
 * way: ideal mirrors, opaque backs, collimated light and flat absorbers. */

const MIRROR = { kind: 'mirror', reflectance: 1, slopeErrorMrad: 0, specularityMrad: 0 };
const ABSORBER = { kind: 'absorber', absorptance: 1 };
const COLLIMATED = { shape: 'pillbox', halfAngleMrad: 0 };

/** Downward-facing flat absorber of width w centred at (0, h). */
const absorber = (w, h) => ({ id: 'absorber', label: 'Absorber', group: 'receiver', shape: { kind: 'segment', x1: w / 2, y1: h, x2: -w / 2, y2: h }, material: ABSORBER });

const parabola = (f, width) => ({ id: 'mirror', label: 'Mirror', group: 'primary', shape: { kind: 'parabola', vx: 0, vy: 0, angle: 0, f, u0: -width / 2, u1: width / 2 }, material: MIRROR });

/** Flat Fresnel rows aimed at (0, h) for a sun at transversal angle θ (degrees). */
function fresnelRows(count, width, pitch, h, thetaDeg) {
  const t = (thetaDeg * Math.PI) / 180, sx = Math.sin(t), sy = Math.cos(t);
  const rows = [];
  for (let i = 0; i < count; i++) {
    const x = (i - (count - 1) / 2) * pitch;
    const rx = -x, ry = h, rl = Math.hypot(rx, ry);
    let nx = sx + rx / rl, ny = sy + ry / rl; const nl = Math.hypot(nx, ny); nx /= nl; ny /= nl;
    // Tangent chosen so the left-hand normal is the mirror normal.
    const tx = ny, ty = -nx;
    rows.push({ id: `row-${i}`, label: `Row ${i + 1}`, group: 'primary', shape: { kind: 'segment', x1: x - (tx * width) / 2, y1: -(ty * width) / 2, x2: x + (tx * width) / 2, y2: (ty * width) / 2 }, material: MIRROR });
  }
  return rows;
}

const scene = (surfaces, width) => ({ surfaces, reference: { width, label: 'Reference' }, meanReceiverDistance: 1 });

export const ORACLE_CASES = [
  { name: 'trough-on-axis', scene: scene([parabola(1, 3), absorber(0.04, 1)], 3), sun: COLLIMATED, transversalDeg: 0 },
  { name: 'trough-half-degree', scene: scene([parabola(1, 3), absorber(0.04, 1)], 3), sun: COLLIMATED, transversalDeg: 0.5 },
  { name: 'trough-one-degree', scene: scene([parabola(1, 3), absorber(0.06, 1)], 3), sun: COLLIMATED, transversalDeg: 1 },
  { name: 'fresnel-30-degrees', scene: scene([...fresnelRows(7, 0.5, 0.6, 4, 30), absorber(0.3, 4)], 3.5), sun: COLLIMATED, transversalDeg: 30 },
  // A low receiver makes reflected rays run into the backs of neighbouring rows (blocking).
  { name: 'fresnel-blocking', scene: scene([...fresnelRows(9, 0.5, 0.5, 0.8, 45), absorber(0.3, 0.8)], 4.5), sun: COLLIMATED, transversalDeg: 45 },
  { name: 'fresnel-60-degrees', scene: scene([...fresnelRows(7, 0.5, 0.5, 2, 60), absorber(0.3, 2)], 3.5), sun: COLLIMATED, transversalDeg: 60 },
];
