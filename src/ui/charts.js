/** Hand-built SVG charts: thin marks, hairline grids, value labels where they help, a hover layer on every chart
 * and a table view behind each one. Colours come from CSS tokens so light and dark themes both work. */

import { h, escapeHtml } from './dom.js';

const SVG = 'http://www.w3.org/2000/svg';
let clipCount = 0;

/**
 * @param {string} tag @param {Record<string, string | number>} [attrs] @param {string} [text]
 * @returns {SVGElement}
 */
function s(tag, attrs = {}, text) {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  if (text !== undefined) el.textContent = text;
  return el;
}

/** @type {HTMLElement | null} */
let tip = null;
/** @param {string} html @param {number} x @param {number} y */
function showTip(html, x, y) {
  if (!tip) { tip = h('div', { class: 'chart-tip', role: 'tooltip' }); document.body.append(tip); }
  tip.innerHTML = html;
  tip.hidden = false;
  const w = tip.offsetWidth, hgt = tip.offsetHeight;
  tip.style.left = `${Math.min(window.innerWidth - w - 8, x + 14)}px`;
  tip.style.top = `${Math.max(8, y - hgt - 10)}px`;
}
function hideTip() { if (tip) tip.hidden = true; }

/** Rounded "nice" ticks covering [lo, hi]. @param {number} lo @param {number} hi @param {number} count */
export function niceTicks(lo, hi, count = 5) {
  if (!(hi > lo)) hi = lo + 1;
  const raw = (hi - lo) / count;
  const p = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map(m => m * p).find(m => m >= raw) ?? 10 * p;
  const start = Math.floor(lo / step + 1e-9) * step, end = Math.ceil(hi / step - 1e-9) * step;
  const ticks = [];
  for (let v = start; v <= end + step * 1e-6; v += step) ticks.push(+v.toFixed(10));
  return ticks;
}

/**
 * Wraps a chart with a heading and a chart/table toggle.
 * @param {{ title: string, subtitle?: string, chart: Element, table: HTMLTableElement }} parts
 */
export function chartFrame({ title, subtitle, chart, table }) {
  const toggle = h('button', { class: 'text-button', type: 'button', text: 'Show table' });
  const body = h('div', {}, [chart]);
  let showingTable = false;
  toggle.addEventListener('click', () => {
    showingTable = !showingTable;
    body.replaceChildren(showingTable ? table : chart);
    toggle.textContent = showingTable ? 'Show chart' : 'Show table';
  });
  return h('figure', { class: 'chart', style: 'margin:0' }, [
    h('div', { class: 'chart-head' }, [h('h4', { text: title }), subtitle ? h('p', { text: subtitle }) : null, toggle]),
    body,
  ]);
}

/** @param {string[]} headers @param {(string | number)[][]} rows */
export function dataTable(headers, rows) {
  return h('table', { class: 'data-table' }, [
    h('thead', {}, [h('tr', {}, headers.map(text => h('th', { text })))]),
    h('tbody', {}, rows.map(r => h('tr', {}, r.map(v => h('td', { text: String(v) }))))),
  ]);
}

/**
 * Horizontal bars sharing one scale from zero, with the value at each bar's tip. One row can be emphasised.
 * @param {{ rows: { label: string, value: number, emphasis?: boolean, note?: string }[], max: number, width: number, format: (v: number) => string }} options
 */
export function barList({ rows, max, width, format }) {
  const labelWidth = Math.min(170, Math.max(120, width * 0.3));
  const valueWidth = 64, barHeight = 14, gap = 10, top = 2;
  const plot = Math.max(40, width - labelWidth - valueWidth);
  const height = top + rows.length * (barHeight + gap);
  const svg = s('svg', { viewBox: `0 0 ${width} ${height}`, height, role: 'img' });
  rows.forEach((row, i) => {
    const y = top + i * (barHeight + gap);
    const w = Math.max(0, (row.value / max) * plot);
    svg.append(s('text', { x: 0, y: y + barHeight - 3 }, row.label));
    svg.append(s('line', { class: 'baseline', x1: labelWidth, x2: labelWidth, y1: y - 3, y2: y + barHeight + 3 }));
    const r = Math.min(4, w / 2);
    const bar = s('path', {
      class: 'mark',
      d: w > 0 ? `M${labelWidth},${y}h${w - r}a${r},${r} 0 0 1 ${r},${r}v${barHeight - 2 * r}a${r},${r} 0 0 1 ${-r},${r}h${-(w - r)}Z` : '',
      fill: row.emphasis ? 'var(--sun)' : 'var(--chart-loss)',
    });
    svg.append(bar);
    svg.append(s('text', { class: 'value-label', x: labelWidth + w + 6, y: y + barHeight - 3 }, format(row.value)));
    const hit = s('rect', { x: 0, y: y - gap / 2, width, height: barHeight + gap, fill: 'transparent' });
    hit.addEventListener('pointermove', e => showTip(`<b>${escapeHtml(row.label)}</b><br>${escapeHtml(format(row.value))}${row.note ? `<br>${escapeHtml(row.note)}` : ''}`, e.clientX, e.clientY));
    hit.addEventListener('pointerleave', hideTip);
    svg.append(hit);
  });
  svg.setAttribute('aria-label', rows.map(r => `${r.label} ${format(r.value)}`).join('; '));
  return svg;
}

/**
 * @typedef {{ name: string, colour: string, points: [number, number][], dashed?: boolean }} Series
 * @typedef {{ label: string, format: (v: number) => string, domain?: [number, number], ticks?: number[], zero?: boolean }} Axis
 *   zero: false lets a y axis start near the data instead of at zero, for change-over-time views.
 */

/**
 * Line chart with one shared y axis, a crosshair and a tooltip. A single series gets a soft area wash; two or more
 * get a legend and labels at their line ends.
 * @param {{ series: Series[], x: Axis, y: Axis, width: number, height: number, markers?: { x: number, label: string }[] }} options
 */
export function lineChart({ series, x, y, width, height, markers = [] }) {
  const all = series.flatMap(sr => sr.points);
  const xs = all.map(p => p[0]), ys = all.map(p => p[1]);
  const xd = x.domain ?? [Math.min(...xs), Math.max(...xs)];
  const yTicks = y.ticks ?? niceTicks(y.domain?.[0] ?? (y.zero === false ? Math.min(...ys) : Math.min(0, ...ys)), y.domain?.[1] ?? Math.max(...ys), 4);
  const yd = /** @type {[number, number]} */ ([yTicks[0], yTicks.at(-1) ?? 1]);
  const xTicks = x.ticks ?? niceTicks(xd[0], xd[1], Math.max(3, Math.floor(width / 90)));
  const multi = series.length > 1;
  // The left margin fits the widest tick label plus the rotated axis title.
  const pad = { left: Math.max(46, 30 + 6.4 * Math.max(...yTicks.map(t => y.format(t).length))), right: 14, top: 10, bottom: 34 };
  if (multi) {
    // Leave room for end labels only if they will be drawn.
    const yEnds = series.map(sr => sr.points.at(-1)?.[1]).filter(v => v !== undefined);
    const span = (Math.max(...ys) - Math.min(0, ...ys)) || 1;
    const sorted = /** @type {number[]} */ (yEnds).sort((a, b) => a - b);
    if (sorted.every((v, i) => i === 0 || ((v - sorted[i - 1]) / span) * (height - 44) >= 14)) pad.right = 96;
  }
  const pw = Math.max(40, width - pad.left - pad.right), ph = Math.max(40, height - pad.top - pad.bottom);
  /** @param {number} v */
  const sx = v => pad.left + ((v - xd[0]) / (xd[1] - xd[0] || 1)) * pw;
  /** @param {number} v */
  const sy = v => pad.top + ph - ((v - yd[0]) / (yd[1] - yd[0] || 1)) * ph;
  const svg = s('svg', { viewBox: `0 0 ${width} ${height}`, height, role: 'img', 'aria-label': `${y.label} against ${x.label}` });
  for (const t of yTicks) {
    svg.append(s('line', { class: 'grid', x1: pad.left, x2: pad.left + pw, y1: sy(t), y2: sy(t) }));
    svg.append(s('text', { x: pad.left - 8, y: sy(t) + 4, 'text-anchor': 'end' }, y.format(t)));
  }
  for (const t of xTicks) {
    if (t < xd[0] - 1e-9 || t > xd[1] + 1e-9) continue;
    svg.append(s('text', { x: sx(t), y: pad.top + ph + 16, 'text-anchor': 'middle' }, x.format(t)));
  }
  svg.append(s('line', { class: 'baseline', x1: pad.left, x2: pad.left + pw, y1: sy(yd[0]), y2: sy(yd[0]) }));
  svg.append(s('text', { class: 'axis-label', x: pad.left + pw / 2, y: height - 4, 'text-anchor': 'middle' }, x.label));
  svg.append(s('text', { class: 'axis-label', x: 12, y: pad.top + ph / 2, transform: `rotate(-90 12 ${pad.top + ph / 2})`, 'text-anchor': 'middle' }, y.label));
  for (const m of markers) {
    svg.append(s('line', { x1: sx(m.x), x2: sx(m.x), y1: pad.top, y2: pad.top + ph, stroke: 'var(--faint)', 'stroke-width': 1 }));
    svg.append(s('text', { x: sx(m.x) + 4, y: pad.top + 10 }, m.label));
  }
  // End labels help only while they stay apart; when line ends converge, the legend and tooltip carry identity.
  const ends = series.map(sr => sr.points.at(-1)).filter(p => p !== undefined).map(p => sy(/** @type {[number, number]} */ (p)[1])).sort((a, b) => a - b);
  const labelEnds = multi && ends.every((y, i) => i === 0 || y - ends[i - 1] >= 14);
  // Marks never draw outside the plot area, whatever the data's range.
  const clipId = `clip-${++clipCount}`;
  svg.append(s('clipPath', { id: clipId }, undefined));
  /** @type {SVGElement} */ (svg.lastChild).append(s('rect', { x: pad.left, y: pad.top - 4, width: pw, height: ph + 8 }));
  const plot = s('g', { 'clip-path': `url(#${clipId})` });
  svg.append(plot);
  for (const sr of series) {
    if (!sr.points.length) continue;
    const d = sr.points.map((p, i) => `${i ? 'L' : 'M'}${sx(p[0]).toFixed(1)},${sy(p[1]).toFixed(1)}`).join('');
    if (!multi) {
      const area = `${d}L${sx(sr.points.at(-1)?.[0] ?? 0).toFixed(1)},${sy(yd[0])}L${sx(sr.points[0][0]).toFixed(1)},${sy(yd[0])}Z`;
      plot.append(s('path', { d: area, fill: sr.colour, opacity: 0.1 }));
    }
    plot.append(s('path', { d, fill: 'none', stroke: sr.colour, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', ...(sr.dashed ? { 'stroke-dasharray': '5 4' } : {}) }));
    if (labelEnds) {
      const last = sr.points.at(-1);
      if (last) {
        svg.append(s('circle', { cx: sx(last[0]), cy: sy(last[1]), r: 4, fill: sr.colour, stroke: 'var(--panel)', 'stroke-width': 2 }));
        svg.append(s('text', { x: sx(last[0]) + 8, y: sy(last[1]) + 4 }, sr.name));
      }
    }
  }
  // Crosshair and tooltip.
  const cross = s('line', { y1: pad.top, y2: pad.top + ph, stroke: 'var(--faint)', 'stroke-width': 1, opacity: 0 });
  const dots = series.map(sr => s('circle', { r: 4, fill: sr.colour, stroke: 'var(--panel)', 'stroke-width': 2, opacity: 0 }));
  svg.append(cross, ...dots);
  const hit = s('rect', { x: pad.left, y: pad.top, width: pw, height: ph, fill: 'transparent' });
  hit.addEventListener('pointermove', e => {
    const rect = svg.getBoundingClientRect();
    const vx = xd[0] + (((e.clientX - rect.left) * (width / rect.width) - pad.left) / pw) * (xd[1] - xd[0]);
    const lines = [`<b>${escapeHtml(x.label)}: ${escapeHtml(x.format(vx))}</b>`];
    let px = null;
    series.forEach((sr, k) => {
      if (!sr.points.length) return;
      let best = sr.points[0];
      for (const p of sr.points) if (Math.abs(p[0] - vx) < Math.abs(best[0] - vx)) best = p;
      px = best[0];
      dots[k].setAttribute('cx', String(sx(best[0]))); dots[k].setAttribute('cy', String(sy(best[1]))); dots[k].setAttribute('opacity', '1');
      lines.push(`${multi ? `${escapeHtml(sr.name)}: ` : ''}${escapeHtml(y.format(best[1]))}`);
    });
    if (px !== null) { cross.setAttribute('x1', String(sx(px))); cross.setAttribute('x2', String(sx(px))); cross.setAttribute('opacity', '1'); }
    showTip(lines.join('<br>'), e.clientX, e.clientY);
  });
  hit.addEventListener('pointerleave', () => { hideTip(); cross.setAttribute('opacity', '0'); dots.forEach(d => d.setAttribute('opacity', '0')); });
  svg.append(hit);
  if (!multi) return svg;
  const legend = h('div', { style: 'display:flex;gap:14px;margin:0 0 4px 46px;font-size:11.5px;color:var(--muted)' },
    series.map(sr => h('span', { style: 'display:inline-flex;align-items:center;gap:6px' }, [h('i', { style: `display:inline-block;width:14px;height:2px;background:${sr.colour}` }), sr.name])));
  return h('div', {}, [legend, svg]);
}

/**
 * Columns from a zero baseline with values on the caps.
 * @param {{ rows: { label: string, value: number }[], y: Axis, width: number, height: number, colour: string }} options
 */
export function columnChart({ rows, y, width, height, colour }) {
  const yTicks = y.ticks ?? niceTicks(0, Math.max(...rows.map(r => r.value), 1e-9), 4);
  const top = yTicks.at(-1) ?? 1;
  const pad = { left: 46, right: 8, top: 16, bottom: 22 };
  const pw = width - pad.left - pad.right, ph = height - pad.top - pad.bottom;
  const band = pw / rows.length, bw = Math.min(24, band * 0.62);
  /** @param {number} v */
  const sy = v => pad.top + ph - (v / top) * ph;
  const svg = s('svg', { viewBox: `0 0 ${width} ${height}`, height, role: 'img', 'aria-label': rows.map(r => `${r.label} ${y.format(r.value)}`).join('; ') });
  for (const t of yTicks) {
    svg.append(s('line', { class: 'grid', x1: pad.left, x2: pad.left + pw, y1: sy(t), y2: sy(t) }));
    svg.append(s('text', { x: pad.left - 8, y: sy(t) + 4, 'text-anchor': 'end' }, y.format(t)));
  }
  const peak = rows.reduce((a, r) => (r.value > a.value ? r : a), rows[0]);
  rows.forEach((r, i) => {
    const cx = pad.left + band * (i + 0.5), x0 = cx - bw / 2, hgt = Math.max(0, sy(0) - sy(r.value));
    const rr = Math.min(4, hgt / 2, bw / 2);
    svg.append(s('path', {
      class: 'mark', fill: colour,
      d: hgt > 0 ? `M${x0},${sy(0)}v${-(hgt - rr)}a${rr},${rr} 0 0 1 ${rr},${-rr}h${bw - 2 * rr}a${rr},${rr} 0 0 1 ${rr},${rr}v${hgt - rr}Z` : '',
    }));
    svg.append(s('text', { x: cx, y: height - 6, 'text-anchor': 'middle' }, r.label));
    if (r === peak) svg.append(s('text', { class: 'value-label', x: cx, y: sy(r.value) - 5, 'text-anchor': 'middle' }, y.format(r.value)));
    const hit = s('rect', { x: cx - band / 2, y: pad.top, width: band, height: ph, fill: 'transparent' });
    hit.addEventListener('pointermove', e => showTip(`<b>${escapeHtml(r.label)}</b><br>${escapeHtml(y.format(r.value))}`, e.clientX, e.clientY));
    hit.addEventListener('pointerleave', hideTip);
    svg.append(hit);
  });
  svg.append(s('line', { class: 'baseline', x1: pad.left, x2: pad.left + pw, y1: sy(0), y2: sy(0) }));
  return svg;
}

