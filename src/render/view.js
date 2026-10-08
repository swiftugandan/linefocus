/** Canvas renderer for the collector cross-section: geometry, traced rays, the absorber flux ring, the sun and
 * the drag handles. World units are metres with +y up; the camera maps them to CSS pixels. */

import { opticalBounds } from '../core/tracer.js';

/** @import { OpticalScene, TraceResult, Surface, Bucket, FluxMap } from '../core/types.js' */
/** @import { Handle } from '../core/handles.js' */

/** Ray colours by where the ray ended. Absorbed light is the brightest thing on screen. */
export const RAY_STYLES = /** @type {Record<Bucket, { colour: string, weight: number, label: string }>} */ ({
  absorbed: { colour: '255, 186, 48', weight: 1, label: 'Absorbed' },
  absorberReflection: { colour: '255, 186, 48', weight: 1, label: 'Absorbed' },
  glassAbsorption: { colour: '255, 186, 48', weight: 1, label: 'Absorbed' },
  glassReflection: { colour: '120, 214, 236', weight: .55, label: 'Reflected by glass' },
  spillage: { colour: '255, 104, 72', weight: .7, label: 'Spilled' },
  reflectorAbsorption: { colour: '255, 104, 72', weight: .7, label: 'Spilled' },
  blocking: { colour: '255, 104, 72', weight: .7, label: 'Spilled' },
  shading: { colour: '150, 166, 196', weight: .35, label: 'Shaded' },
  receiverShading: { colour: '150, 166, 196', weight: .35, label: 'Shaded' },
  trapped: { colour: '150, 166, 196', weight: .35, label: 'Shaded' },
  missed: { colour: '120, 138, 170', weight: .16, label: 'Missed' },
});

const COLOURS = {
  background: '#0e1625',
  gridMinor: 'rgba(120, 146, 196, 0.07)',
  gridMajor: 'rgba(120, 146, 196, 0.14)',
  axis: 'rgba(150, 172, 214, 0.22)',
  mirror: '#e3e9f4',
  mirrorBack: '#56627c',
  absorberFill: '#1f2b4d',
  absorberEdge: '#d39443',
  glass: 'rgba(132, 214, 236, 0.75)',
  opaque: '#5b667e',
  sun: '#f2a516',
  handle: '#ffffff',
  handleRing: '#82a9dc',
};

/**
 * Heat ramp for the flux ring: deep amber to near-white (semantic heat, shown with a scale legend).
 * @param {number} t 0–1
 */
export function heat(t) {
  const stops = [[0, [92, 34, 10]], [0.35, [196, 84, 18]], [0.7, [248, 170, 40]], [1, [255, 240, 196]]];
  const x = Math.min(1, Math.max(0, t));
  for (let i = 1; i < stops.length; i++) {
    const [t1, c1] = /** @type {[number, number[]]} */ (stops[i]);
    const [t0, c0] = /** @type {[number, number[]]} */ (stops[i - 1]);
    if (x <= t1) {
      const f = (x - t0) / (t1 - t0);
      return `rgb(${c0.map((c, k) => Math.round(c + (c1[k] - c) * f)).join(', ')})`;
    }
  }
  return 'rgb(255, 240, 196)';
}

export class CrossSectionView {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is not available in this browser.');
    this.ctx = ctx;
    this.camera = { cx: 0, cy: 0, scale: 100 };
    this.width = 0;
    this.height = 0;
    /** @type {OpticalScene | null} */
    this.scene = null;
    /** @type {TraceResult | null} */
    this.trace = null;
    /** @type {Handle[]} */
    this.handles = [];
    /** @type {{ cx: number, cy: number, r: number } | null} */
    this.sunArc = null;
    /** @type {string | null} */
    this.hoverHandle = null;
    /** @type {string | null} */
    this.activeHandle = null;
    this.sunDirection = [0, 1];
    this.showRays = true;
    this.showMissed = false;
    this.showFlux = true;
    this.frame = 0;
    this.fitted = false;
  }

  /** Matches the backing store to the element size. */
  resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.width = rect.width;
    this.height = rect.height;
    this.canvas.width = Math.max(1, Math.round(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.round(rect.height * dpr));
    this.request();
  }

  /** Coalesces draws into one animation frame. */
  request() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => { this.frame = 0; this.draw(); });
  }

  /** @param {number} x @param {number} y */
  toScreen(x, y) {
    return [this.width / 2 + (x - this.camera.cx) * this.camera.scale, this.height / 2 - (y - this.camera.cy) * this.camera.scale];
  }

  /** @param {number} sx @param {number} sy */
  toWorld(sx, sy) {
    return [this.camera.cx + (sx - this.width / 2) / this.camera.scale, this.camera.cy - (sy - this.height / 2) / this.camera.scale];
  }

  /** Frames the geometry and the sun handle. */
  fit() {
    if (!this.scene || !this.width) return;
    const b = opticalBounds(this.scene);
    let minX = b.minX, maxX = b.maxX, minY = b.minY, maxY = b.maxY;
    for (const h of this.handles) { minX = Math.min(minX, h.x); maxX = Math.max(maxX, h.x); minY = Math.min(minY, h.y); maxY = Math.max(maxY, h.y); }
    const w = Math.max(maxX - minX, 1e-3), hgt = Math.max(maxY - minY, 1e-3);
    const scale = Math.min((this.width * 0.82) / w, (this.height * 0.8) / hgt);
    this.camera = { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, scale };
    this.fitted = true;
    this.request();
  }

  /** Zooms about a screen point. @param {number} factor @param {number} [sx] @param {number} [sy] */
  zoom(factor, sx = this.width / 2, sy = this.height / 2) {
    const [wx, wy] = this.toWorld(sx, sy);
    this.camera.scale = Math.min(2e6, Math.max(2, this.camera.scale * factor));
    const [nx, ny] = this.toWorld(sx, sy);
    this.camera.cx += wx - nx; this.camera.cy += wy - ny;
    this.request();
  }

  /** @param {number} dx @param {number} dy screen pixels */
  pan(dx, dy) {
    this.camera.cx -= dx / this.camera.scale;
    this.camera.cy += dy / this.camera.scale;
    this.request();
  }

  /** Nearest handle within reach of a screen point. @param {number} sx @param {number} sy */
  handleAt(sx, sy) {
    let best = null, bestD = 14;
    for (const h of this.handles) {
      const [hx, hy] = this.toScreen(h.x, h.y);
      const d = Math.hypot(hx - sx, hy - sy);
      if (d < bestD) { bestD = d; best = h; }
    }
    return best;
  }

  /** Surface nearest a screen point, for tooltips. @param {number} sx @param {number} sy @returns {Surface | null} */
  surfaceAt(sx, sy) {
    if (!this.scene) return null;
    const [wx, wy] = this.toWorld(sx, sy);
    const tolerance = 6 / this.camera.scale;
    let best = null, bestD = tolerance;
    for (const s of this.scene.surfaces) {
      const d = distanceToShape(s, wx, wy);
      if (d < bestD) { bestD = d; best = s; }
    }
    return best;
  }

  draw() {
    const { ctx } = this;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = COLOURS.background;
    ctx.fillRect(0, 0, this.width, this.height);
    this.drawGrid();
    if (this.scene) {
      if (this.showRays && this.trace) this.drawRays(this.trace);
      for (const s of this.scene.surfaces) this.drawSurface(s);
      if (this.showFlux && this.trace) for (const map of this.trace.flux) this.drawFlux(map);
    }
    this.drawSunArc();
    this.drawHandles();
  }

  /** "Nice" grid spacing near 90 screen pixels. */
  gridStep() {
    const raw = 90 / this.camera.scale;
    const p = 10 ** Math.floor(Math.log10(raw));
    for (const m of [1, 2, 5, 10]) if (m * p >= raw) return m * p;
    return 10 * p;
  }

  drawGrid() {
    const { ctx } = this;
    const step = this.gridStep() / 5;
    const [x0, y1] = this.toWorld(0, 0), [x1, y0] = this.toWorld(this.width, this.height);
    ctx.lineWidth = 1;
    for (const major of [false, true]) {
      ctx.strokeStyle = major ? COLOURS.gridMajor : COLOURS.gridMinor;
      ctx.beginPath();
      const s = major ? step * 5 : step;
      for (let x = Math.ceil(x0 / s) * s; x <= x1; x += s) {
        if (!major && Math.abs(Math.round(x / step) % 5) === 0) continue;
        const [sx] = this.toScreen(x, 0); ctx.moveTo(Math.round(sx) + .5, 0); ctx.lineTo(Math.round(sx) + .5, this.height);
      }
      for (let y = Math.ceil(y0 / s) * s; y <= y1; y += s) {
        if (!major && Math.abs(Math.round(y / step) % 5) === 0) continue;
        const [, sy] = this.toScreen(0, y); ctx.moveTo(0, Math.round(sy) + .5); ctx.lineTo(this.width, Math.round(sy) + .5);
      }
      ctx.stroke();
    }
    // The collector's x axis (aperture plane reference) and symmetry line.
    ctx.strokeStyle = COLOURS.axis;
    ctx.beginPath();
    const [ox, oy] = this.toScreen(0, 0);
    ctx.moveTo(0, Math.round(oy) + .5); ctx.lineTo(this.width, Math.round(oy) + .5);
    ctx.moveTo(Math.round(ox) + .5, 0); ctx.lineTo(Math.round(ox) + .5, this.height);
    ctx.stroke();
  }

  /** @param {TraceResult} trace */
  drawRays(trace) {
    const { ctx } = this;
    const n = Math.max(1, trace.paths.length);
    const base = Math.min(0.32, Math.max(0.05, 4.2 / Math.sqrt(n)));
    // Incoming sunlight is drawn from beyond the top of the view, fainter than the reflected light.
    const reach = 2 * Math.hypot(this.width, this.height) / this.camera.scale;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineWidth = 1;
    ctx.lineJoin = 'round';
    for (const path of trace.paths) {
      if (path.bucket === 'missed' && !this.showMissed) continue;
      const style = RAY_STYLES[path.bucket];
      const pts = path.points;
      if (pts.length < 4) continue;
      const dx = pts[2] - pts[0], dy = pts[3] - pts[1], len = Math.hypot(dx, dy) || 1;
      const [ax, ay] = this.toScreen(pts[0] - (dx / len) * reach, pts[1] - (dy / len) * reach);
      const [bx, by] = this.toScreen(pts[2], pts[3]);
      ctx.strokeStyle = `rgba(255, 214, 120, ${base * 0.45})`;
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      if (pts.length < 6) continue;
      ctx.strokeStyle = `rgba(${style.colour}, ${base * style.weight})`;
      ctx.beginPath();
      ctx.moveTo(bx, by);
      for (let i = 4; i < pts.length; i += 2) { const [sx, sy] = this.toScreen(pts[i], pts[i + 1]); ctx.lineTo(sx, sy); }
      ctx.stroke();
    }
    ctx.restore();
  }

  /** @param {Surface} surface */
  drawSurface(surface) {
    const { ctx } = this;
    const m = surface.material;
    const sign = surface.flip ? -1 : 1;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (surface.shape.kind === 'circle') {
      const [sx, sy] = this.toScreen(surface.shape.cx, surface.shape.cy);
      const r = surface.shape.r * this.camera.scale;
      ctx.beginPath();
      ctx.arc(sx, sy, Math.max(r, 1.5), 0, Math.PI * 2);
      if (m.kind === 'absorber') {
        ctx.fillStyle = COLOURS.absorberFill; ctx.fill();
        ctx.strokeStyle = COLOURS.absorberEdge; ctx.lineWidth = 1.5; ctx.stroke();
      } else if (m.kind === 'dielectric' || m.kind === 'thin-glass') {
        ctx.strokeStyle = COLOURS.glass; ctx.lineWidth = 1.2; ctx.stroke();
      } else {
        ctx.fillStyle = COLOURS.opaque; ctx.fill();
      }
      ctx.restore();
      return;
    }
    const pts = sampleSurface(surface);
    if (m.kind === 'mirror') {
      // The opaque back is drawn as a darker line just behind the reflecting face.
      ctx.strokeStyle = COLOURS.mirrorBack; ctx.lineWidth = 3;
      this.strokePolyline(pts, -2.2 * sign);
      ctx.strokeStyle = COLOURS.mirror; ctx.lineWidth = 2;
      this.strokePolyline(pts, 0);
    } else if (m.kind === 'absorber') {
      ctx.strokeStyle = COLOURS.absorberEdge; ctx.lineWidth = 3; this.strokePolyline(pts, 0);
    } else if (m.kind === 'dielectric' || m.kind === 'thin-glass') {
      ctx.strokeStyle = COLOURS.glass; ctx.lineWidth = 1.2; this.strokePolyline(pts, 0);
    } else {
      ctx.strokeStyle = COLOURS.opaque; ctx.lineWidth = 3; this.strokePolyline(pts, 0);
    }
    ctx.restore();
  }

  /**
   * Strokes world points, optionally offset along the left-hand normal by a number of screen pixels.
   * @param {number[]} pts @param {number} offsetPx
   */
  strokePolyline(pts, offsetPx) {
    const { ctx } = this;
    const screen = [];
    for (let i = 0; i < pts.length; i += 2) screen.push(this.toScreen(pts[i], pts[i + 1]));
    ctx.beginPath();
    for (let i = 0; i < screen.length; i++) {
      let [x, y] = screen[i];
      if (offsetPx) {
        const a = screen[Math.max(0, i - 1)], b = screen[Math.min(screen.length - 1, i + 1)];
        const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
        // Screen y points down, so the world left-hand normal is (dy, -dx) here.
        x += (dy / len) * offsetPx; y += (-dx / len) * offsetPx;
      }
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  /** Radial bars around a tube absorber, or a strip under a flat one, coloured and sized by absorbed flux. @param {FluxMap} map */
  drawFlux(map) {
    if (!this.scene) return;
    const surface = this.scene.surfaces.find(s => s.id === map.surfaceId);
    if (!surface) return;
    const max = Math.max(...map.power);
    if (!(max > 0)) return;
    const { ctx } = this;
    ctx.save();
    if (surface.shape.kind === 'circle') {
      const { cx, cy, r } = surface.shape;
      const [sx, sy] = this.toScreen(cx, cy);
      const rs = r * this.camera.scale;
      const reach = Math.max(10, Math.min(46, rs * 1.4));
      map.power.forEach((p, i) => {
        if (p <= 0) return;
        const t = p / max;
        const a0 = map.start + i * map.step, a1 = a0 + map.step;
        // World angles run counter-clockwise from −y. With screen y pointing down, a world direction
        // (sin a, −cos a) appears at canvas angle π/2 − a, so increasing a turns anticlockwise on the canvas.
        const c0 = Math.PI / 2 - a0, c1 = Math.PI / 2 - a1;
        ctx.beginPath();
        ctx.arc(sx, sy, rs + 2, c0, c1, true);
        ctx.arc(sx, sy, rs + 2 + reach * t, c1, c0, false);
        ctx.closePath();
        ctx.fillStyle = heat(t);
        ctx.globalAlpha = 0.92;
        ctx.fill();
      });
    } else if (surface.shape.kind === 'segment') {
      const { x1, y1, x2, y2 } = surface.shape;
      const len = Math.hypot(x2 - x1, y2 - y1);
      const nx = -(y2 - y1) / len * (surface.flip ? -1 : 1), ny = (x2 - x1) / len * (surface.flip ? -1 : 1);
      map.power.forEach((p, i) => {
        if (p <= 0) return;
        const t = p / max;
        const u0 = (i * map.step) / len, u1 = ((i + 1) * map.step) / len;
        const gap = 2 / this.camera.scale, reach = gap + (18 * t) / this.camera.scale;
        const quad = [
          [x1 + (x2 - x1) * u0 + nx * gap, y1 + (y2 - y1) * u0 + ny * gap],
          [x1 + (x2 - x1) * u1 + nx * gap, y1 + (y2 - y1) * u1 + ny * gap],
          [x1 + (x2 - x1) * u1 + nx * reach, y1 + (y2 - y1) * u1 + ny * reach],
          [x1 + (x2 - x1) * u0 + nx * reach, y1 + (y2 - y1) * u0 + ny * reach],
        ].map(([x, y]) => this.toScreen(x, y));
        ctx.beginPath();
        quad.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.closePath();
        ctx.fillStyle = heat(t);
        ctx.globalAlpha = 0.9;
        ctx.fill();
      });
    }
    ctx.restore();
  }

  drawSunArc() {
    const arc = this.sunArc;
    const sun = this.handles.find(h => h.id === 'sun');
    if (!arc || !sun) return;
    const { ctx } = this;
    const [cx, cy] = this.toScreen(arc.cx, arc.cy);
    const r = arc.r * this.camera.scale;
    ctx.save();
    ctx.strokeStyle = 'rgba(242, 165, 22, 0.22)';
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI / 2 - 1.2, -Math.PI / 2 + 1.2);
    ctx.stroke();
    // Zenith tick of the collector frame.
    ctx.beginPath(); ctx.moveTo(cx, cy - r - 5); ctx.lineTo(cx, cy - r + 5); ctx.stroke();
    const [sx, sy] = this.toScreen(sun.x, sun.y);
    // Sun glyph.
    ctx.fillStyle = COLOURS.sun;
    ctx.strokeStyle = COLOURS.sun;
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(sx, sy, 7, 0, Math.PI * 2); ctx.fill();
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4;
      ctx.beginPath(); ctx.moveTo(sx + Math.cos(a) * 10, sy + Math.sin(a) * 10); ctx.lineTo(sx + Math.cos(a) * 13.5, sy + Math.sin(a) * 13.5); ctx.stroke();
    }
    ctx.restore();
  }

  drawHandles() {
    const { ctx } = this;
    for (const h of this.handles) {
      if (h.id === 'sun') {
        if (this.hoverHandle === 'sun' || this.activeHandle === 'sun') {
          const [sx, sy] = this.toScreen(h.x, h.y);
          ctx.strokeStyle = COLOURS.handle; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.arc(sx, sy, 17, 0, Math.PI * 2); ctx.stroke();
        }
        continue;
      }
      const [sx, sy] = this.toScreen(h.x, h.y);
      const hot = this.hoverHandle === h.id || this.activeHandle === h.id;
      ctx.beginPath();
      ctx.arc(sx, sy, hot ? 6.5 : 5, 0, Math.PI * 2);
      ctx.fillStyle = COLOURS.handle;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = COLOURS.handleRing;
      ctx.stroke();
    }
  }
}

/** World-space points along a surface for drawing. @param {Surface} surface @returns {number[]} */
export function sampleSurface(surface) {
  const s = surface.shape;
  if (s.kind === 'segment') return [s.x1, s.y1, s.x2, s.y2];
  if (s.kind === 'polyline') return s.points;
  if (s.kind === 'arc') {
    const out = [];
    for (let i = 0; i <= 48; i++) { const a = s.start + (s.sweep * i) / 48; out.push(s.cx + s.r * Math.cos(a), s.cy + s.r * Math.sin(a)); }
    return out;
  }
  if (s.kind === 'parabola') {
    const c = Math.cos(s.angle), sn = Math.sin(s.angle), out = [];
    for (let i = 0; i <= 160; i++) {
      const u = s.u0 + ((s.u1 - s.u0) * i) / 160, v = (u * u) / (4 * s.f);
      out.push(s.vx + u * c - v * sn, s.vy + u * sn + v * c);
    }
    return out;
  }
  const out = [];
  for (let i = 0; i <= 64; i++) { const a = (2 * Math.PI * i) / 64; out.push(s.cx + s.r * Math.cos(a), s.cy + s.r * Math.sin(a)); }
  return out;
}

/** Distance from a world point to a surface. @param {Surface} surface @param {number} x @param {number} y */
function distanceToShape(surface, x, y) {
  const s = surface.shape;
  if (s.kind === 'circle') return Math.abs(Math.hypot(x - s.cx, y - s.cy) - s.r);
  const pts = sampleSurface(surface);
  let best = Infinity;
  for (let i = 2; i < pts.length; i += 2) {
    const ax = pts[i - 2], ay = pts[i - 1], bx = pts[i], by = pts[i + 1];
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
    best = Math.min(best, Math.hypot(x - ax - t * dx, y - ay - t * dy));
  }
  return best;
}
