/** Export a cross-section to a Ray Optics Simulation scene (https://phydemo.app/ray-optics/, scene version 5).
 * Ray Optics is 2D and has ideal two-sided mirrors and transparent detectors, so the export adds blockers behind
 * mirrors and absorbers to match Linefocus's opaque backs. Glass is omitted: Ray Optics has no thin shells. */

import { launchFrame, opticalBounds, sunVector } from './tracer.js';

/** @import { OpticalScene, SunSpec, Surface } from './types.js' */

/** Gap between a mirror or detector and the blocker behind it, in metres. */
const BACKING_GAP = 0.0005;

/**
 * @param {OpticalScene} scene
 * @param {{ sun: SunSpec, transversalDeg: number, name: string, pixelsPerMetre?: number, rayDensity?: number }} options
 * @returns {{ json: Record<string, unknown>, skipped: string[] }}
 */
export function toRayOptics(scene, options) {
  const scale = options.pixelsPerMetre ?? 1000;
  const [sx, sy] = sunVector(options.transversalDeg, 0);
  const bounds = opticalBounds(scene);
  const frame = launchFrame(bounds, sx, sy);
  const margin = 0.05 * frame.diag;
  const minX = Math.min(bounds.minX, frame.ends[0], frame.ends[2]) - margin;
  const maxY = Math.max(bounds.maxY, frame.ends[1], frame.ends[3]) + margin;
  /** @param {number} x @param {number} y */
  const pt = (x, y) => ({ x: round((x - minX) * scale), y: round((maxY - y) * scale) });

  /** @type {Record<string, unknown>[]} */
  const objs = [];
  /** @type {string[]} */
  const skipped = [];
  const sun = options.sun;
  // Ray Optics' beam fans rays uniformly over its full divergence angle, in degrees.
  const emisAngle = sun.shape === 'pillbox' ? round((2 * sun.halfAngleMrad * 1e-3 * 180) / Math.PI, 6) : 0;
  // The beam emits to the right of p1 → p2 in screen coordinates; this order points it away from the sun.
  objs.push({ type: 'Beam', p1: pt(frame.ends[2], frame.ends[3]), p2: pt(frame.ends[0], frame.ends[1]), brightness: 1, emisAngle });

  for (const surface of scene.surfaces) {
    const added = exportSurface(surface, pt);
    if (added) objs.push(...added); else skipped.push(surface.label);
  }
  const width = Math.ceil((Math.max(bounds.maxX, frame.ends[0], frame.ends[2]) + margin - minX) * scale);
  const height = Math.ceil((maxY - Math.min(bounds.minY, frame.ends[1], frame.ends[3]) + margin) * scale);
  const json = {
    version: 5,
    name: options.name,
    objs,
    width,
    height,
    rayModeDensity: options.rayDensity ?? 1,
    maxRayDepth: 200,
    lengthScale: 1,
    origin: { x: 0, y: 0 },
    scale: 1,
  };
  return { json, skipped };
}

/**
 * @param {Surface} surface @param {(x: number, y: number) => { x: number, y: number }} pt
 * @returns {Record<string, unknown>[] | null}
 */
function exportSurface(surface, pt) {
  const { shape, material } = surface;
  const sign = surface.flip ? -1 : 1;
  if (material.kind === 'dielectric' || material.kind === 'thin-glass') return null;

  if (shape.kind === 'segment') {
    const ex = shape.x2 - shape.x1, ey = shape.y2 - shape.y1, len = Math.hypot(ex, ey);
    const nx = (-ey / len) * sign, ny = (ex / len) * sign;
    const bx = -nx * BACKING_GAP, by = -ny * BACKING_GAP;
    const backing = { type: 'Blocker', p1: pt(shape.x1 + bx, shape.y1 + by), p2: pt(shape.x2 + bx, shape.y2 + by) };
    if (material.kind === 'mirror') return [{ type: 'Mirror', p1: pt(shape.x1, shape.y1), p2: pt(shape.x2, shape.y2) }, backing];
    if (material.kind === 'absorber') {
      // A one-sided detector counts rays that cross with a positive screen cross product, which is the reverse of
      // the segment's own direction once y is flipped.
      const [a, b] = sign > 0 ? [pt(shape.x2, shape.y2), pt(shape.x1, shape.y1)] : [pt(shape.x1, shape.y1), pt(shape.x2, shape.y2)];
      return [{ type: 'Detector', p1: a, p2: b, twoSided: false }, backing];
    }
    return [{ type: 'Blocker', p1: pt(shape.x1, shape.y1), p2: pt(shape.x2, shape.y2) }];
  }

  if (shape.kind === 'circle') {
    if (material.kind === 'absorber' || material.kind === 'opaque') {
      return [{ type: 'CircleBlocker', p1: pt(shape.cx, shape.cy), p2: pt(shape.cx + shape.r, shape.cy) }];
    }
    return null;
  }

  const samples = sampleWithNormals(shape, sign);
  if (material.kind !== 'mirror' || !samples) return null;
  /** @type {Record<string, unknown>[]} */
  const out = [];
  if (shape.kind === 'parabola' && Math.abs(shape.u0 + shape.u1) < 1e-12) {
    const c = Math.cos(shape.angle), s = Math.sin(shape.angle);
    /** @param {number} u */
    const at = u => { const v = (u * u) / (4 * shape.f); return pt(shape.vx + u * c - v * s, shape.vy + u * s + v * c); };
    out.push({ type: 'ParabolicMirror', p1: at(shape.u0), p2: at(shape.u1), p3: at(0) });
  } else if (shape.kind === 'arc') {
    /** @param {number} a */
    const at = a => pt(shape.cx + shape.r * Math.cos(a), shape.cy + shape.r * Math.sin(a));
    out.push({ type: 'ArcMirror', p1: at(shape.start), p2: at(shape.start + shape.sweep), p3: at(shape.start + shape.sweep / 2) });
  } else {
    // Sampled curves and asymmetric parabolas become chains of flat mirrors.
    for (let i = 4; i < samples.length; i += 4) out.push({ type: 'Mirror', p1: pt(samples[i - 4], samples[i - 3]), p2: pt(samples[i], samples[i + 1]) });
  }
  // A chain of blockers just behind the reflecting face stands in for the opaque back.
  for (let i = 4; i < samples.length; i += 4) {
    out.push({
      type: 'Blocker',
      p1: pt(samples[i - 4] - samples[i - 2] * BACKING_GAP, samples[i - 3] - samples[i - 1] * BACKING_GAP),
      p2: pt(samples[i] - samples[i + 2] * BACKING_GAP, samples[i + 1] - samples[i + 3] * BACKING_GAP),
    });
  }
  return out;
}

/**
 * Points along a curved shape with their unit front normals, as flat [x, y, nx, ny, …].
 * @param {import('./types.js').Shape} shape @param {number} sign
 * @returns {number[] | null}
 */
function sampleWithNormals(shape, sign) {
  const out = [];
  if (shape.kind === 'polyline') {
    for (let i = 0; i < shape.points.length; i += 2) out.push(shape.points[i], shape.points[i + 1], shape.normals[i] * sign, shape.normals[i + 1] * sign);
    return out;
  }
  if (shape.kind === 'parabola') {
    const c = Math.cos(shape.angle), s = Math.sin(shape.angle), n = 64;
    for (let i = 0; i <= n; i++) {
      const u = shape.u0 + ((shape.u1 - shape.u0) * i) / n, v = (u * u) / (4 * shape.f);
      const lnx = -u / (2 * shape.f), len = Math.hypot(lnx, 1);
      out.push(shape.vx + u * c - v * s, shape.vy + u * s + v * c, ((lnx * c - s) / len) * sign, ((lnx * s + c) / len) * sign);
    }
    return out;
  }
  if (shape.kind === 'arc') {
    const n = 32;
    for (let i = 0; i <= n; i++) {
      const a = shape.start + (shape.sweep * i) / n, cx = Math.cos(a), cy = Math.sin(a);
      out.push(shape.cx + shape.r * cx, shape.cy + shape.r * cy, cx * sign, cy * sign);
    }
    return out;
  }
  return null;
}

/** @param {number} value @param {number} [digits] */
function round(value, digits = 3) {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}
