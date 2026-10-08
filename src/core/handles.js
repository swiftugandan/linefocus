/** Direct-manipulation handles on the cross-section. Each handle maps a dragged point in the collector frame
 * back to one design value. Pure functions, so the canvas and tests share them. */

import { tracksTransversally } from './design-scene.js';
import { opticalBounds } from './tracer.js';
import { buildCpc } from './collectors/cpc.js';

/** @import { Design } from './model.js' */
/** @import { OpticalScene } from './types.js' */

/**
 * @typedef {{ id: string, x: number, y: number, axis: 'x' | 'y' | 'angle', label: string, cx?: number, cy?: number, base?: number, span?: number }} Handle
 *   For 'angle' handles, (cx, cy) is the pivot. For a proportional handle, the value is (position − base) / span.
 */

/** Radius of the sun handle's arc, relative to the scene size. */
const SUN_ARC = 0.5;

/**
 * Pivot and radius of the sun handle, from the scene bounds.
 * @param {OpticalScene} scene
 */
export function sunArc(scene) {
  const b = opticalBounds(scene);
  const width = b.maxX - b.minX, height = b.maxY - b.minY;
  const cx = (b.minX + b.maxX) / 2, cy = b.minY + height * 0.35;
  return { cx, cy, r: Math.max(width, height) * SUN_ARC + height * 0.25 };
}

/**
 * @param {Design} design @param {OpticalScene} scene
 * @returns {Handle[]}
 */
export function handlesFor(design, scene) {
  /** @type {Handle[]} */
  const out = [];
  const c = design.collector;
  if (c.type === 'trough') {
    const half = c.apertureWidth / 2;
    out.push({ id: 'aperture', x: half, y: (half * half) / (4 * c.focalLength), axis: 'x', label: 'Aperture width' });
    out.push({ id: 'focal', x: 0, y: c.focalLength, axis: 'y', label: 'Focal length' });
  }
  if (c.type === 'fresnel') {
    const outer = ((c.rows - 1) / 2) * c.pitch;
    out.push({ id: 'receiverHeight', x: 0, y: c.receiverHeight + 0.35, axis: 'y', label: 'Receiver height' });
    if (c.rows > 1) out.push({ id: 'pitch', x: outer, y: -0.25, axis: 'x', label: 'Row pitch' });
  }
  if (c.type === 'cpc') {
    const cpc = buildCpc(c, design.receiver, design.optics);
    out.push({ id: 'truncation', x: cpc.aperture / 2, y: cpc.bottom + cpc.height, axis: 'y', label: 'Height kept', base: cpc.bottom, span: cpc.fullHeight });
  }
  const arc = sunArc(scene);
  const angle = (design.designPoint.transversalDeg * Math.PI) / 180;
  out.push({ id: 'sun', x: arc.cx + arc.r * Math.sin(angle), y: arc.cy + arc.r * Math.cos(angle), axis: 'angle', label: tracksTransversally(design) ? 'Misalignment to the sun' : 'Sun angle', cx: arc.cx, cy: arc.cy });
  return out;
}

/** Rounds to a step. @param {number} value @param {number} step */
const snap = (value, step) => Math.round(value / step) * step;

/**
 * Applies a dragged handle position to the design (mutating it). Values snap to sensible steps.
 * @param {Design} design @param {Handle} handle @param {number} x @param {number} y
 */
export function applyHandle(design, handle, x, y) {
  const c = design.collector;
  if (handle.id === 'aperture' && c.type === 'trough') c.apertureWidth = Math.min(12, Math.max(0.1, snap(2 * Math.abs(x), 0.01)));
  else if (handle.id === 'focal' && c.type === 'trough') c.focalLength = Math.min(6, Math.max(0.02, snap(y, 0.005)));
  else if (handle.id === 'receiverHeight' && c.type === 'fresnel') c.receiverHeight = Math.min(40, Math.max(0.1, snap(y - 0.35, 0.01)));
  else if (handle.id === 'pitch' && c.type === 'fresnel' && c.rows > 1) c.pitch = Math.min(6, Math.max(c.mirrorWidth, snap(Math.abs(x) / ((c.rows - 1) / 2), 0.005)));
  else if (handle.id === 'truncation' && c.type === 'cpc') {
    c.truncation = Math.min(1, Math.max(0.05, snap((y - (handle.base ?? 0)) / (handle.span ?? 1), 0.01)));
  }
  else if (handle.id === 'sun') {
    const deg = (Math.atan2(x - (handle.cx ?? 0), y - (handle.cy ?? 0)) * 180) / Math.PI;
    design.designPoint.transversalDeg = Math.min(89, Math.max(-89, snap(deg, 0.1)));
  }
}
