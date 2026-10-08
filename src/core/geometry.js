/** Ray–surface intersection kernels for the cross-section primitives. Rays are 3D, but the geometry is
 * extruded along z, so intersections are found with the ray's xy components. The parameter t is the 3D
 * path length when the ray direction is a unit vector. */

/** @import { Shape, Surface } from './types.js' */

/**
 * Mutable record for the nearest hit found so far.
 * @typedef {{ t: number, nx: number, ny: number, u: number, index: number }} Hit
 *   (nx, ny) is the unit front normal at the hit. u is the flux-binning coordinate: radians from −y for circles
 *   and arcs, distance along the shape for segments and polylines, local x for parabolas.
 */

/**
 * @typedef {{
 *   surface: Surface,
 *   minX: number, minY: number, maxX: number, maxY: number,
 *   intersect: (px: number, py: number, dx: number, dy: number, tMin: number, hit: Hit, index: number) => void,
 * }} CompiledSurface
 */

const TAU = Math.PI * 2;

/** Angle of (x, y) measured counter-clockwise from −y, in [0, 2π). @param {number} x @param {number} y */
export function angleFromBottom(x, y) {
  const a = Math.atan2(x, -y);
  return a < 0 ? a + TAU : a;
}

/** @param {number} sign @param {Shape} shape */
function compileShape(shape, sign) {
  switch (shape.kind) {
    case 'segment': return compileSegment(shape.x1, shape.y1, shape.x2, shape.y2, sign);
    case 'circle': return compileCircle(shape.cx, shape.cy, shape.r, 0, TAU, sign, true);
    case 'arc': return compileCircle(shape.cx, shape.cy, shape.r, shape.start, shape.sweep, sign, false);
    case 'parabola': return compileParabola(shape, sign);
    case 'polyline': return compilePolyline(shape.points, shape.normals, sign);
  }
}

/** @param {Surface} surface @returns {CompiledSurface} */
export function compileSurface(surface) {
  const { box, intersect } = compileShape(surface.shape, surface.flip ? -1 : 1);
  return { surface, minX: box[0], minY: box[1], maxX: box[2], maxY: box[3], intersect };
}

/** @param {number} x1 @param {number} y1 @param {number} x2 @param {number} y2 @param {number} sign */
function compileSegment(x1, y1, x2, y2, sign) {
  const ex = x2 - x1, ey = y2 - y1, len = Math.hypot(ex, ey);
  if (!(len > 0)) throw new Error('A segment needs two distinct end points.');
  const nx = (-ey / len) * sign, ny = (ex / len) * sign;
  return {
    box: [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)],
    /** @type {CompiledSurface['intersect']} */
    intersect(px, py, dx, dy, tMin, hit, index) {
      const denom = dx * ey - dy * ex;
      if (denom === 0) return;
      const wx = x1 - px, wy = y1 - py;
      const t = (wx * ey - wy * ex) / denom;
      if (t <= tMin || t >= hit.t) return;
      const s = (wx * dy - wy * dx) / denom;
      if (s < 0 || s > 1) return;
      hit.t = t; hit.nx = nx; hit.ny = ny; hit.u = s * len; hit.index = index;
    },
  };
}

/**
 * Full circle or counter-clockwise arc.
 * @param {number} cx @param {number} cy @param {number} r @param {number} start @param {number} sweep
 * @param {number} sign @param {boolean} full
 */
function compileCircle(cx, cy, r, start, sweep, sign, full) {
  if (!(r > 0)) throw new Error('A circle needs a positive radius.');
  if (!full && !(sweep > 0 && sweep <= TAU)) throw new Error('An arc needs a sweep between 0 and 2π.');
  let box = [cx - r, cy - r, cx + r, cy + r];
  if (!full) {
    // Bound the arc by its end points and any axis extremes it passes through.
    const xs = [cx + r * Math.cos(start), cx + r * Math.cos(start + sweep)];
    const ys = [cy + r * Math.sin(start), cy + r * Math.sin(start + sweep)];
    for (let k = 0; k < 4; k++) {
      const a = (k * Math.PI) / 2;
      let rel = (a - start) % TAU; if (rel < 0) rel += TAU;
      if (rel <= sweep) { xs.push(cx + r * Math.cos(a)); ys.push(cy + r * Math.sin(a)); }
    }
    box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  }
  /** @param {number} hx @param {number} hy */
  const onArc = (hx, hy) => {
    if (full) return true;
    let rel = (Math.atan2(hy - cy, hx - cx) - start) % TAU; if (rel < 0) rel += TAU;
    return rel <= sweep;
  };
  return {
    box,
    /** @type {CompiledSurface['intersect']} */
    intersect(px, py, dx, dy, tMin, hit, index) {
      const ox = px - cx, oy = py - cy;
      const a = dx * dx + dy * dy;
      if (a === 0) return;
      const b = ox * dx + oy * dy, c = ox * ox + oy * oy - r * r;
      const disc = b * b - a * c;
      if (disc < 0) return;
      const root = Math.sqrt(disc);
      // Numerically stable pair of roots.
      const q = b >= 0 ? -(b + root) : -(b - root);
      const t1 = q / a, t2 = q !== 0 ? c / q : t1;
      const lo = Math.min(t1, t2), hi = Math.max(t1, t2);
      for (const t of [lo, hi]) {
        if (t <= tMin || t >= hit.t) continue;
        const hx = ox + t * dx, hy = oy + t * dy;
        if (!onArc(hx + cx, hy + cy)) continue;
        hit.t = t; hit.nx = (hx / r) * sign; hit.ny = (hy / r) * sign; hit.u = angleFromBottom(hx, hy); hit.index = index;
        return;
      }
    },
  };
}

/** @param {import('./types.js').ParabolaShape} shape @param {number} sign */
function compileParabola(shape, sign) {
  const { vx, vy, angle, f, u0, u1 } = shape;
  if (!(f > 0) || !(u1 > u0)) throw new Error('A parabola needs a positive focal length and an increasing range.');
  const c = Math.cos(angle), s = Math.sin(angle);
  /** Local (u, v) to global. @param {number} u @param {number} v */
  const toGlobal = (u, v) => [vx + u * c - v * s, vy + u * s + v * c];
  const xs = [], ys = [];
  for (let i = 0; i <= 32; i++) { const u = u0 + ((u1 - u0) * i) / 32; const [x, y] = toGlobal(u, (u * u) / (4 * f)); xs.push(x); ys.push(y); }
  // The sampled hull of a convex arc is within its sagitta of the true bound; pad by a small margin.
  const pad = ((u1 - u0) / 32) ** 2 / (8 * f) + 1e-12;
  return {
    box: [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad],
    /** @type {CompiledSurface['intersect']} */
    intersect(px, py, dx, dy, tMin, hit, index) {
      const rx = px - vx, ry = py - vy;
      const pu = rx * c + ry * s, pv = -rx * s + ry * c;
      const du = dx * c + dy * s, dv = -dx * s + dy * c;
      const a = du * du, b = 2 * pu * du - 4 * f * dv, cc = pu * pu - 4 * f * pv;
      /** @type {number[]} */
      let roots;
      if (Math.abs(a) < 1e-14 * Math.max(1, Math.abs(b))) roots = b !== 0 ? [-cc / b] : [];
      else {
        const disc = b * b - 4 * a * cc;
        if (disc < 0) return;
        const root = Math.sqrt(disc);
        const q = -0.5 * (b + (b >= 0 ? root : -root));
        roots = q !== 0 ? [q / a, cc / q] : [-b / (2 * a)];
        if (roots[0] > roots[1]) roots.reverse();
      }
      for (const t of roots) {
        if (t <= tMin || t >= hit.t) continue;
        const u = pu + t * du;
        if (u < u0 || u > u1) continue;
        // Local normal towards the focus is (−u/2f, 1).
        const lnx = -u / (2 * f), len = Math.hypot(lnx, 1);
        const nu = lnx / len, nv = 1 / len;
        hit.t = t; hit.nx = (nu * c - nv * s) * sign; hit.ny = (nu * s + nv * c) * sign; hit.u = u; hit.index = index;
        return;
      }
    },
  };
}

const CHUNK = 16;

/** @param {number[]} points @param {number[]} normals @param {number} sign */
function compilePolyline(points, normals, sign) {
  const count = points.length / 2;
  if (count < 2 || points.length % 2 || normals.length !== points.length) throw new Error('A polyline needs matching points and normals.');
  const lengths = [0];
  for (let i = 1; i < count; i++) lengths.push(lengths[i - 1] + Math.hypot(points[2 * i] - points[2 * i - 2], points[2 * i + 1] - points[2 * i - 1]));
  /** @type {{ from: number, to: number, box: number[] }[]} */
  const chunks = [];
  for (let from = 0; from < count - 1; from += CHUNK) {
    const to = Math.min(count - 1, from + CHUNK);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = from; i <= to; i++) { const x = points[2 * i], y = points[2 * i + 1]; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    chunks.push({ from, to, box: [x0, y0, x1, y1] });
  }
  const box = [Math.min(...chunks.map(c => c.box[0])), Math.min(...chunks.map(c => c.box[1])), Math.max(...chunks.map(c => c.box[2])), Math.max(...chunks.map(c => c.box[3]))];
  return {
    box,
    /** @type {CompiledSurface['intersect']} */
    intersect(px, py, dx, dy, tMin, hit, index) {
      for (const chunk of chunks) {
        if (!rayBox(px, py, dx, dy, chunk.box, tMin, hit.t)) continue;
        for (let i = chunk.from; i < chunk.to; i++) {
          const ax = points[2 * i], ay = points[2 * i + 1];
          const ex = points[2 * i + 2] - ax, ey = points[2 * i + 3] - ay;
          const denom = dx * ey - dy * ex;
          if (denom === 0) continue;
          const wx = ax - px, wy = ay - py;
          const t = (wx * ey - wy * ex) / denom;
          if (t <= tMin || t >= hit.t) continue;
          const sp = (wx * dy - wy * dx) / denom;
          if (sp < 0 || sp > 1) continue;
          const nx = (1 - sp) * normals[2 * i] + sp * normals[2 * i + 2];
          const ny = (1 - sp) * normals[2 * i + 1] + sp * normals[2 * i + 3];
          const len = Math.hypot(nx, ny);
          hit.t = t; hit.nx = (nx / len) * sign; hit.ny = (ny / len) * sign;
          hit.u = lengths[i] + sp * (lengths[i + 1] - lengths[i]); hit.index = index;
        }
      }
    },
  };
}

/**
 * Slab test: does the ray meet the box between tMin and tMax?
 * @param {number} px @param {number} py @param {number} dx @param {number} dy @param {number[]} box
 * @param {number} tMin @param {number} tMax
 */
export function rayBox(px, py, dx, dy, box, tMin, tMax) {
  let lo = tMin, hi = tMax;
  if (dx !== 0) {
    let a = (box[0] - px) / dx, b = (box[2] - px) / dx;
    if (a > b) { const tmp = a; a = b; b = tmp; }
    lo = Math.max(lo, a); hi = Math.min(hi, b);
  } else if (px < box[0] || px > box[2]) return false;
  if (dy !== 0) {
    let a = (box[1] - py) / dy, b = (box[3] - py) / dy;
    if (a > b) { const tmp = a; a = b; b = tmp; }
    lo = Math.max(lo, a); hi = Math.min(hi, b);
  } else if (py < box[1] || py > box[3]) return false;
  return lo <= hi;
}

/** Bounding box of compiled surfaces. @param {CompiledSurface[]} surfaces */
export function sceneBounds(surfaces) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of surfaces) { minX = Math.min(minX, s.minX); minY = Math.min(minY, s.minY); maxX = Math.max(maxX, s.maxX); maxY = Math.max(maxY, s.maxY); }
  return { minX, minY, maxX, maxY };
}
