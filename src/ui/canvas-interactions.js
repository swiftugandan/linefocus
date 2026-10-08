/** Pointer and wheel input on the cross-section: drag handles, pan, zoom, and surface tooltips. A handle drag is one
 * transaction with live previews; Escape, a lost pointer or a window blur cancels it. */

import { applyHandle } from '../core/handles.js';
import { escapeHtml } from './dom.js';

/** @import { CrossSectionView } from '../render/view.js' */
/** @import { DesignStore } from '../core/history.js' */
/** @import { Surface } from '../core/types.js' */

const MATERIAL_NAMES = { mirror: 'Mirror', absorber: 'Absorber', dielectric: 'Glass', 'thin-glass': 'Glass (fixed transmittance)', opaque: 'Opaque' };

/**
 * @param {{ view: CrossSectionView, viewport: HTMLElement, tooltip: HTMLElement, store: DesignStore, onError: (message: string) => void, onZoom: () => void }} options
 */
export function installCanvasInteractions({ view, viewport, tooltip, store, onError, onZoom }) {
  const canvas = view.canvas;
  /** @type {{ kind: 'handle', id: string, pointer: number } | { kind: 'pan', x: number, y: number, pointer: number } | null} */
  let gesture = null;

  /** @param {PointerEvent} e */
  const local = e => {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };

  const cancel = () => {
    if (gesture?.kind === 'handle' && store.pending) store.cancel();
    gesture = null;
    view.activeHandle = null;
    viewport.dataset.cursor = '';
    view.request();
  };

  canvas.addEventListener('pointerdown', e => {
    if (e.button !== 0 && e.button !== 1) return;
    canvas.focus();
    const [x, y] = local(e);
    const handle = e.button === 0 ? view.handleAt(x, y) : null;
    canvas.setPointerCapture(e.pointerId);
    tooltip.hidden = true;
    if (handle) {
      gesture = { kind: 'handle', id: handle.id, pointer: e.pointerId };
      view.activeHandle = handle.id;
      store.begin(handle.id === 'sun' ? 'Move the sun' : `Drag ${handle.label.toLowerCase()}`);
    } else {
      gesture = { kind: 'pan', x, y, pointer: e.pointerId };
      viewport.dataset.cursor = 'grabbing';
    }
    view.request();
  });

  canvas.addEventListener('pointermove', e => {
    const [x, y] = local(e);
    if (gesture?.kind === 'pan') {
      view.pan(x - gesture.x, y - gesture.y);
      gesture.x = x; gesture.y = y;
      return;
    }
    if (gesture?.kind === 'handle') {
      const id = gesture.id;
      const handle = view.handles.find(h => h.id === id);
      if (!handle) return;
      const [wx, wy] = view.toWorld(x, y);
      applyHandle(store.design, handle, wx, wy);
      store.preview();
      return;
    }
    const handle = view.handleAt(x, y);
    if ((handle?.id ?? null) !== view.hoverHandle) { view.hoverHandle = handle?.id ?? null; view.request(); }
    viewport.dataset.cursor = handle ? (handle.axis === 'x' ? 'ew' : handle.axis === 'y' ? 'ns' : 'handle') : 'grab';
    showTooltip(handle ? `<b>${escapeHtml(handle.label)}</b><br>Drag to change` : describe(view.surfaceAt(x, y)), x, y);
  });

  /** @param {string | null} html @param {number} x @param {number} y */
  const showTooltip = (html, x, y) => {
    if (!html) { tooltip.hidden = true; return; }
    tooltip.innerHTML = html;
    tooltip.hidden = false;
    tooltip.style.left = `${Math.min(viewport.clientWidth - tooltip.offsetWidth - 8, x + 14)}px`;
    tooltip.style.top = `${Math.max(8, y - tooltip.offsetHeight - 10)}px`;
  };

  const finish = () => {
    if (gesture?.kind === 'handle') {
      try { store.commit(); } catch (error) { onError(error instanceof Error ? error.message : String(error)); }
    }
    gesture = null;
    view.activeHandle = null;
    viewport.dataset.cursor = '';
    view.request();
  };
  canvas.addEventListener('pointerup', finish);
  canvas.addEventListener('pointercancel', cancel);
  canvas.addEventListener('lostpointercapture', () => { if (gesture) finish(); });
  canvas.addEventListener('pointerleave', () => { if (!gesture) { tooltip.hidden = true; view.hoverHandle = null; view.request(); } });
  window.addEventListener('blur', () => { if (gesture) cancel(); });
  window.addEventListener('keydown', e => { if (e.key === 'Escape' && gesture) { e.preventDefault(); cancel(); } });

  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const [x, y] = local(/** @type {PointerEvent} */ (/** @type {unknown} */ (e)));
    const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015));
    view.zoom(factor, x, y);
    onZoom();
  }, { passive: false });

  canvas.addEventListener('dblclick', () => { view.fit(); onZoom(); });
}

/** @param {Surface | null} surface */
function describe(surface) {
  if (!surface) return null;
  const m = surface.material;
  const detail = m.kind === 'mirror' ? `Reflectance ${(m.reflectance * 100).toFixed(1)}%` : m.kind === 'absorber' ? `Absorptance ${(m.absorptance * 100).toFixed(1)}%`
    : m.kind === 'thin-glass' ? `Transmittance ${(m.transmittance * 100).toFixed(1)}%` : m.kind === 'dielectric' ? `n ${m.back.n === 1 ? m.front.n : m.back.n}` : 'Stops light';
  return `<b>${escapeHtml(surface.label)}</b><br>${escapeHtml(MATERIAL_NAMES[m.kind])}. ${escapeHtml(detail)}`;
}
