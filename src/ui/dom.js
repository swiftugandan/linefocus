/** Small DOM helpers. Text always goes through textContent or escapeHtml, never raw interpolation. */

/** @param {string} id @returns {HTMLElement} */
export function byId(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el;
}

/** @param {unknown} value */
export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}

/**
 * Creates an element.
 * @template {keyof HTMLElementTagNameMap} K
 * @param {K} tag @param {Record<string, string | boolean | number | undefined>} [attrs] @param {(Node | string | null | undefined | false)[]} [children]
 * @returns {HTMLElementTagNameMap[K]}
 */
export function h(tag, attrs = {}, children = []) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (key === 'class') el.className = String(value);
    else if (key === 'text') el.textContent = String(value);
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children) if (child !== null && child !== undefined && child !== false) el.append(child);
  return el;
}

/** Formats a number with a fixed count of decimals and thin grouping. @param {number} value @param {number} digits */
export function fmt(value, digits) {
  if (!Number.isFinite(value)) return '–';
  return value.toLocaleString('en-GB', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** Formats a share (0–1) as a percentage. @param {number} share @param {number} [digits] */
export function pct(share, digits = 1) {
  return `${fmt(share * 100, digits)}%`;
}

/**
 * Debounces a function.
 * @template {unknown[]} A
 * @param {(...args: A) => void} fn @param {number} ms
 */
export function debounce(fn, ms) {
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  /** @param {A} args */
  const run = (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
  run.cancel = () => clearTimeout(timer);
  return run;
}

/** Saves a blob through a temporary link. @param {string} filename @param {Blob} blob */
export function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const link = h('a', { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 15000);
}

/** A file name made from a title. @param {string} title @param {string} suffix */
export function fileName(title, suffix) {
  const base = title.trim().replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').slice(0, 80) || 'design';
  return `${base}${suffix}`;
}
