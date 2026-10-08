/** Monte Carlo ray tracer for linear concentrators. The definitions it implements are in docs/PHYSICS.md:
 * launch window, reference power, the energy ledger, mirror errors and dielectric interfaces. */

import { Rng } from './rng.js';
import { radialSampler } from './sunshape.js';
import { compileSurface, rayBox, sceneBounds } from './geometry.js';

/** @import { Bucket, OpticalScene, TraceOptions, TraceResult, FluxMap, RayPath, MirrorMaterial, DielectricMaterial } from './types.js' */
/** @import { Hit } from './geometry.js' */

export const MAX_INTERACTIONS = 64;
/** Rays per random-number block. Each block has its own seed, so a trace split into block-aligned chunks gives
 * exactly the same result as one uninterrupted trace. */
export const RAY_BLOCK = 4096;

/** @param {number} seed @param {number} block */
function blockSeed(seed, block) {
  return (Math.imul(seed ^ 0x5bd1e995, 0x01000193) + Math.imul(block + 1, 0x9e3779b1)) >>> 0;
}

/** @type {Bucket[]} */
export const BUCKETS = ['absorbed', 'absorberReflection', 'reflectorAbsorption', 'glassAbsorption', 'glassReflection', 'spillage', 'shading', 'blocking', 'receiverShading', 'trapped', 'missed'];

/** @returns {Record<Bucket, number>} */
export function emptyLedger() {
  return /** @type {Record<Bucket, number>} */ (Object.fromEntries(BUCKETS.map(b => [b, 0])));
}

/**
 * Unit vector from the collector towards the sun centre in the collector frame.
 * @param {number} transversalDeg @param {number} longitudinalDeg
 */
export function sunVector(transversalDeg, longitudinalDeg) {
  const t = (transversalDeg * Math.PI) / 180, l = (longitudinalDeg * Math.PI) / 180;
  return [Math.cos(l) * Math.sin(t), Math.cos(l) * Math.cos(t), Math.sin(l)];
}

/**
 * Two unit vectors perpendicular to v and to each other.
 * @param {number} x @param {number} y @param {number} z
 */
export function perpendicularBasis(x, y, z) {
  // Cross with the coordinate axis least aligned with v.
  const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
  let ux, uy, uz;
  if (ax <= ay && ax <= az) { ux = 0; uy = -z; uz = y; }
  else if (ay <= az) { ux = z; uy = 0; uz = -x; }
  else { ux = -y; uy = x; uz = 0; }
  const ul = Math.hypot(ux, uy, uz);
  ux /= ul; uy /= ul; uz /= ul;
  return [ux, uy, uz, y * uz - z * uy, z * ux - x * uz, x * uy - y * ux];
}

/** Unpolarised Fresnel reflectance. @param {number} n1 @param {number} n2 @param {number} cosI */
export function fresnelReflectance(n1, n2, cosI) {
  const eta = n1 / n2, sin2T = eta * eta * (1 - cosI * cosI);
  if (sin2T >= 1) return 1;
  const cosT = Math.sqrt(1 - sin2T);
  const rs = (n1 * cosI - n2 * cosT) / (n1 * cosI + n2 * cosT);
  const rp = (n1 * cosT - n2 * cosI) / (n1 * cosT + n2 * cosI);
  return 0.5 * (rs * rs + rp * rp);
}

/**
 * The launch window: a segment perpendicular to the projected sun direction, upstream of every surface and wide
 * enough to cover them all.
 * @param {{ minX: number, minY: number, maxX: number, maxY: number }} bounds
 * @param {number} sx @param {number} sy  sun vector components in the cross-section
 */
export function launchFrame(bounds, sx, sy) {
  const sxy = Math.hypot(sx, sy);
  const diag = Math.hypot(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) || 1;
  const pad = 0.02 * diag;
  const ppx = sx / sxy, ppy = sy / sxy;
  const qx = ppy, qy = -ppx;
  let qMin = Infinity, qMax = -Infinity, pMax = -Infinity;
  for (const [x, y] of [[bounds.minX, bounds.minY], [bounds.maxX, bounds.minY], [bounds.minX, bounds.maxY], [bounds.maxX, bounds.maxY]]) {
    qMin = Math.min(qMin, x * qx + y * qy); qMax = Math.max(qMax, x * qx + y * qy); pMax = Math.max(pMax, x * ppx + y * ppy);
  }
  qMin -= pad; qMax += pad;
  const start = pMax + pad;
  return {
    diag, tMin: 1e-9 * diag, ppx, ppy, qx, qy, qMin, start, length: qMax - qMin,
    /** End points of the window. */
    ends: [start * ppx + qMin * qx, start * ppy + qMin * qy, start * ppx + qMax * qx, start * ppy + qMax * qy],
  };
}

/** Bounds of a scene's surfaces. @param {OpticalScene} scene */
export function opticalBounds(scene) {
  return sceneBounds(scene.surfaces.map(compileSurface));
}

/**
 * Traces sunlight through a cross-section. With `range`, traces only rays [from, to) of the full set, which must
 * start on a RAY_BLOCK boundary; merge the parts with mergeTraces.
 * @param {OpticalScene} scene
 * @param {TraceOptions} options
 * @param {{ from: number, to: number }} [range]
 * @returns {TraceResult}
 */
export function trace(scene, options, range) {
  const compiled = scene.surfaces.map(compileSurface);
  /** @type {number[][]} */
  let boxes = [];
  const ledger = emptyLedger();
  const rays = Math.max(1, Math.floor(options.rays));
  const to = Math.min(rays, range?.to ?? rays);
  const from = range?.from ?? 0;
  if (from % RAY_BLOCK !== 0) throw new Error('A partial trace must start on a ray block boundary.');
  let rng = new Rng(blockSeed(options.seed, 0));
  const sampleSun = radialSampler(options.sun);
  const [sx, sy, sz] = sunVector(options.transversalDeg, options.longitudinalDeg);
  const cosIncidence = sy;
  const reference = Math.max(0, options.dni * scene.reference.width * cosIncidence);

  /** @type {FluxMap[]} */
  const flux = [];
  /** @type {(FluxMap | null)[]} */
  const fluxBySurface = compiled.map(c => {
    if (c.surface.material.kind !== 'absorber') return null;
    const map = fluxMapFor(c.surface.shape, c.surface.id, options.fluxBins);
    flux.push(map);
    return map;
  });

  /** @type {RayPath[]} */
  const paths = [];
  const sxy = Math.hypot(sx, sy);
  if (compiled.length === 0 || sxy < 1e-9 || sy <= 0) {
    return { launched: 0, reference, ledger, efficiency: 0, intercept: 0, reflected: 0, intercepted: 0, flux, paths, rays: 0, cosIncidence };
  }

  const bounds = sceneBounds(compiled);
  const { diag, tMin, ppx, ppy, qx, qy, qMin, start, length: windowLength } = launchFrame(bounds, sx, sy);
  boxes = compiled.map(c => [c.minX - tMin, c.minY - tMin, c.maxX + tMin, c.maxY + tMin]);
  const w0 = (options.dni * windowLength * sxy) / rays;
  const launched = w0 * Math.max(0, to - from);

  // Central ray direction points away from the sun.
  const cx = -sx, cy = -sy, cz = -sz;
  const [b1x, b1y, b1z, b2x, b2y, b2z] = perpendicularBasis(cx, cy, cz);
  const pathCount = Math.max(0, Math.min(rays, options.pathCount ?? 0));
  const pathStride = pathCount > 0 ? rays / pathCount : Infinity;

  /** @type {Hit} */
  const hit = { t: Infinity, nx: 0, ny: 0, u: 0, index: -1 };
  /** @type {Hit} */
  const probe = { t: Infinity, nx: 0, ny: 0, u: 0, index: -1 };
  const absorberIndices = compiled.flatMap((c, k) => c.surface.material.kind === 'absorber' ? [k] : []);
  /** @param {number} px @param {number} py @param {number} dx @param {number} dy */
  const straightPathMeetsAbsorber = (px, py, dx, dy) => {
    probe.t = Infinity; probe.index = -1;
    for (const k of absorberIndices) compiled[k].intersect(px, py, dx, dy, tMin, probe, k);
    return probe.index >= 0 && probe.nx * dx + probe.ny * dy < 0;
  };
  let reflected = 0, intercepted = 0;

  for (let i = from; i < to; i++) {
    if (i % RAY_BLOCK === 0) rng = new Rng(blockSeed(options.seed, i / RAY_BLOCK));
    const q = qMin + ((i + rng.next()) / rays) * windowLength;
    let px = start * ppx + q * qx, py = start * ppy + q * qy;
    const r = sampleSun(rng), phi = 2 * Math.PI * rng.next();
    const cr = Math.cos(r), sr = Math.sin(r), cp = Math.cos(phi), sp = Math.sin(phi);
    let dx = cr * cx + sr * (cp * b1x + sp * b2x);
    let dy = cr * cy + sr * (cp * b1y + sp * b2y);
    let dz = cr * cz + sr * (cp * b1z + sp * b2z);

    /** @type {number[] | null} */
    let path = null;
    // Record the first ray of every stride, so the sample is the same however the trace is split.
    if (pathCount > 0 && (i === 0 || Math.floor(i / pathStride) !== Math.floor((i - 1) / pathStride))) path = [px, py];

    let w = w0, mediumK = 0;
    let mirrorHit = false, primaryHit = false, interceptDecided = false, lastGlassReflection = false, primaryWeight = 0;
    /** @type {Bucket | null} */
    let ended = null;

    for (let step = 0; step < MAX_INTERACTIONS; step++) {
      hit.t = Infinity; hit.index = -1;
      for (let k = 0; k < compiled.length; k++) {
        const c = compiled[k];
        if (!rayBox(px, py, dx, dy, boxes[k], tMin, hit.t)) continue;
        c.intersect(px, py, dx, dy, tMin, hit, k);
      }
      if (hit.index < 0) {
        ended = lastGlassReflection ? 'glassReflection' : mirrorHit ? 'spillage' : 'missed';
        ledger[ended] += w; w = 0;
        if (path) { const ext = diag * 0.6 / Math.max(1e-6, Math.hypot(dx, dy)); path.push(px + dx * ext, py + dy * ext); }
        break;
      }
      const t = hit.t;
      if (mediumK > 0) { const lost = w * (1 - Math.exp(-mediumK * t)); ledger.glassAbsorption += lost; w -= lost; }
      px += dx * t; py += dy * t;
      if (path) path.push(px, py);

      const surface = compiled[hit.index].surface;
      const material = surface.material;
      const nx = hit.nx, ny = hit.ny;
      const front = dx * nx + dy * ny < 0;
      const group = surface.group;
      if (!interceptDecided && primaryHit && group === 'receiver') {
        // γ ignores glass losses: a ray counts when its straight path through the envelope meets the absorber.
        if (material.kind === 'absorber' ? front : straightPathMeetsAbsorber(px, py, dx, dy)) { intercepted += primaryWeight; interceptDecided = true; }
      }

      if (material.kind === 'mirror') {
        if (!front) { ended = mirrorHit ? (group === 'primary' ? 'blocking' : 'spillage') : (group === 'primary' ? 'shading' : 'receiverShading'); break; }
        const lost = w * (1 - material.reflectance);
        ledger.reflectorAbsorption += lost; w -= lost;
        const out = reflectWithErrors(dx, dy, dz, nx, ny, material, rng);
        dx = out[0]; dy = out[1]; dz = out[2];
        if (group === 'primary' && !primaryHit) { primaryHit = true; primaryWeight = w; reflected += w; }
        mirrorHit = true; lastGlassReflection = false;
        continue;
      }
      if (material.kind === 'absorber') {
        if (!front) { ended = mirrorHit ? 'spillage' : 'receiverShading'; break; }
        const absorbed = w * material.absorptance;
        ledger.absorbed += absorbed;
        ledger.absorberReflection += w - absorbed;
        const map = fluxBySurface[hit.index];
        if (map) addFlux(map, hit.u, absorbed);
        w = 0; ended = 'absorbed';
        break;
      }
      if (material.kind === 'opaque') { ended = mirrorHit ? 'spillage' : (group === 'primary' ? 'shading' : 'receiverShading'); break; }
      if (material.kind === 'thin-glass') {
        const lost = w * (1 - material.transmittance);
        ledger.glassAbsorption += lost; w -= lost;
        continue;
      }
      const out = crossDielectric(dx, dy, dz, nx, ny, front, material, rng);
      dx = out.dx; dy = out.dy; dz = out.dz; mediumK = out.k; lastGlassReflection = out.reflected;
    }
    if (ended === null) ended = 'trapped';
    if (w > 0) ledger[ended] += w;
    if (path) paths.push({ points: path, bucket: ended });
  }

  return {
    launched,
    reference,
    ledger,
    efficiency: reference > 0 ? ledger.absorbed / reference : 0,
    intercept: reflected > 0 ? intercepted / reflected : 0,
    reflected,
    intercepted,
    flux,
    paths,
    rays: Math.max(0, to - from),
    cosIncidence,
  };
}

/**
 * Combines partial traces of one scene into a single result.
 * @param {TraceResult[]} parts
 * @returns {TraceResult}
 */
export function mergeTraces(parts) {
  if (!parts.length) throw new Error('Nothing to merge.');
  const ledger = emptyLedger();
  const first = parts[0];
  const flux = first.flux.map(map => ({ ...map, power: map.power.map(() => 0) }));
  let launched = 0, reflected = 0, intercepted = 0, rays = 0;
  /** @type {RayPath[]} */
  const paths = [];
  for (const part of parts) {
    for (const b of BUCKETS) ledger[b] += part.ledger[b];
    part.flux.forEach((map, k) => map.power.forEach((p, i) => { flux[k].power[i] += p; }));
    launched += part.launched; reflected += part.reflected; intercepted += part.intercepted; rays += part.rays;
    paths.push(...part.paths);
  }
  return {
    launched, reference: first.reference, ledger, flux, paths, rays, reflected, intercepted, cosIncidence: first.cosIncidence,
    efficiency: first.reference > 0 ? ledger.absorbed / first.reference : 0,
    intercept: reflected > 0 ? intercepted / reflected : 0,
  };
}

/**
 * Specular reflection with Gaussian slope error on the normal and specularity error on the reflected ray.
 * @param {number} dx @param {number} dy @param {number} dz @param {number} nx @param {number} ny
 * @param {MirrorMaterial} m @param {Rng} rng
 */
export function reflectWithErrors(dx, dy, dz, nx, ny, m, rng) {
  const slope = m.slopeErrorMrad * 1e-3, spec = m.specularityMrad * 1e-3;
  for (let attempt = 0; attempt < 8; attempt++) {
    let mx = nx, my = ny, mz = 0;
    if (slope > 0) {
      // Tilt the normal along the in-plane tangent (−ny, nx, 0) and along the axis (0, 0, 1).
      const a = Math.tan(slope * rng.normal()), b = Math.tan(slope * rng.normal());
      mx = nx - a * ny; my = ny + a * nx; mz = b;
      const len = Math.hypot(mx, my, mz); mx /= len; my /= len; mz /= len;
    }
    const dot = dx * mx + dy * my + dz * mz;
    let rx = dx - 2 * dot * mx, ry = dy - 2 * dot * my, rz = dz - 2 * dot * mz;
    if (spec > 0) {
      const [b1x, b1y, b1z, b2x, b2y, b2z] = perpendicularBasis(rx, ry, rz);
      const a = Math.tan(spec * rng.normal()), b = Math.tan(spec * rng.normal());
      rx += a * b1x + b * b2x; ry += a * b1y + b * b2y; rz += a * b1z + b * b2z;
      const len = Math.hypot(rx, ry, rz); rx /= len; ry /= len; rz /= len;
    }
    // A perturbed ray must still leave from the reflecting side of the real surface.
    if (rx * nx + ry * ny > 0) return [rx, ry, rz];
  }
  const dot = dx * nx + dy * ny;
  return [dx - 2 * dot * nx, dy - 2 * dot * ny, dz];
}

/**
 * Fresnel reflection or refraction at a dielectric interface, chosen with probability R.
 * @param {number} dx @param {number} dy @param {number} dz @param {number} nx @param {number} ny
 * @param {boolean} front whether the ray arrives on the front side
 * @param {DielectricMaterial} m @param {Rng} rng
 */
export function crossDielectric(dx, dy, dz, nx, ny, front, m, rng) {
  const from = front ? m.front : m.back, to = front ? m.back : m.front;
  // Normal on the incident side.
  const mx = front ? nx : -nx, my = front ? ny : -ny;
  const cosI = -(dx * mx + dy * my);
  const reflectance = fresnelReflectance(from.n, to.n, cosI);
  if (reflectance >= 1 || rng.next() < reflectance) {
    return { dx: dx + 2 * cosI * mx, dy: dy + 2 * cosI * my, dz, k: from.k, reflected: true };
  }
  const eta = from.n / to.n;
  const cosT = Math.sqrt(1 - eta * eta * (1 - cosI * cosI));
  const f = eta * cosI - cosT;
  return { dx: eta * dx + f * mx, dy: eta * dy + f * my, dz: eta * dz, k: to.k, reflected: false };
}

/** @param {import('./types.js').Shape} shape @param {string} id @param {number | undefined} bins */
function fluxMapFor(shape, id, bins) {
  if (shape.kind === 'circle' || shape.kind === 'arc') {
    const n = bins ?? 72;
    return { surfaceId: id, kind: /** @type {const} */ ('angle'), start: 0, step: (2 * Math.PI) / n, length: 2 * Math.PI * shape.r, power: new Array(n).fill(0) };
  }
  const n = bins ?? 60;
  let start = 0, length = 0;
  if (shape.kind === 'segment') length = Math.hypot(shape.x2 - shape.x1, shape.y2 - shape.y1);
  else if (shape.kind === 'parabola') { start = shape.u0; length = shape.u1 - shape.u0; }
  else { for (let i = 2; i < shape.points.length; i += 2) length += Math.hypot(shape.points[i] - shape.points[i - 2], shape.points[i + 1] - shape.points[i - 1]); }
  return { surfaceId: id, kind: /** @type {const} */ ('position'), start, step: length / n, length, power: new Array(n).fill(0) };
}

/** @param {FluxMap} map @param {number} u @param {number} power */
function addFlux(map, u, power) {
  const n = map.power.length;
  const i = Math.min(n - 1, Math.max(0, Math.floor((u - map.start) / map.step)));
  map.power[i] += power;
}
