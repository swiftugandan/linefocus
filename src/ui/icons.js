/** Inline 24×24 stroke icons. Elements with data-icon="name" are filled in by hydrateIcons. */

/** @type {Record<string, string>} */
export const ICONS = {
  download: '<path d="M12 4v11m0 0 4.5-4.5M12 15l-4.5-4.5M5 19.5h14"/>',
  open: '<path d="M3.5 7.5v10a1.5 1.5 0 0 0 1.5 1.5h14a1.5 1.5 0 0 0 1.5-1.5V9.5A1.5 1.5 0 0 0 19 8h-7l-2-2.5H5A1.5 1.5 0 0 0 3.5 7v.5Z"/>',
  new: '<path d="M6 3.5h8l4 4V20a.5.5 0 0 1-.5.5h-11A.5.5 0 0 1 6 20V3.5Zm8 0V8h4M12 11v6m-3-3h6"/>',
  undo: '<path d="M9 7 4.5 11.5 9 16"/><path d="M4.5 11.5H15a4.5 4.5 0 0 1 0 9h-2"/>',
  redo: '<path d="M15 7l4.5 4.5L15 16"/><path d="M19.5 11.5H9a4.5 4.5 0 0 0 0 9h2"/>',
  search: '<circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 5 5"/>',
  chevron: '<path d="m6 9.5 6 6 6-6"/>',
  'chevron-right': '<path d="m9.5 6 6 6-6 6"/>',
  'panel-left': '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M9.5 4.5v15"/>',
  'panel-right': '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M14.5 4.5v15"/>',
  fit: '<path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9m6 0h3.5A1.5 1.5 0 0 1 20 5.5V9m0 6v3.5a1.5 1.5 0 0 1-1.5 1.5H15m-6 0H5.5A1.5 1.5 0 0 1 4 18.5V15"/>',
  share: '<path d="M14 4.5h5.5V10M19.5 4.5 11 13"/><path d="M17 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 4 18.5v-10A1.5 1.5 0 0 1 5.5 7H10"/>',
  minus: '<path d="M5 12h14"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trough: '<path d="M3 7c1.4 13 16.6 13 18 0"/><circle cx="12" cy="10.5" r="1.8"/><path d="M12 3v4.7"/>',
  fresnel: '<path d="M2.5 18.5l3-1.2M7.5 19.2l3-.6M13.5 18.6l3 .6M18.5 17.3l3 1.2"/><rect x="9.5" y="4" width="5" height="3" rx=".8"/><path d="M4 17.8 12 7M9 18.9 12 7M15 18.9 12 7M20 17.8 12 7" opacity=".55"/>',
  cpc: '<path d="M4 4c.6 8 3.5 12.5 6 14.5M20 4c-.6 8-3.5 12.5-6 14.5"/><path d="M9.5 19.5h5"/>',
  tube: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="3.5"/>',
  flat: '<path d="M4 9.5h16M4 9.5v-3h16v3"/><path d="M6 14h12" opacity=".55"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/>',
  trace: '<path d="M4 4.5 12 13l8-8.5"/><path d="M12 13v6.5"/><circle cx="12" cy="13" r="1.6"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r=".8"/>',
  acceptance: '<path d="M3.5 18.5h17"/><path d="M4.5 17.5C7 17.5 8 6 12 6s5 11.5 7.5 11.5"/>',
  incidence: '<path d="M4 19.5h16M4 19.5 17 6.5"/><path d="M10 19.5a6 6 0 0 0-1.6-4.1"/>',
  day: '<path d="M3.5 18.5h17"/><path d="M5 18.5c2-9 12-9 14 0"/><circle cx="12" cy="8" r="1.5"/>',
  year: '<rect x="4" y="5.5" width="16" height="14" rx="1.5"/><path d="M4 9.5h16M8.5 3.5v4M15.5 3.5v4"/>',
  optimise: '<path d="M4 18.5c3-1 4-9.5 8-9.5s4 6 8-5"/><circle cx="20" cy="4" r="1.4"/>',
  moon: '<path d="M19.5 14.5A7.5 7.5 0 0 1 9.5 4.5a7.5 7.5 0 1 0 10 10Z"/>',
  rays: '<path d="M4 4l6 9M10 4v9M16 4l-6 9"/><path d="M10 13l-4 7M10 13l4 7"/>',
  flux: '<circle cx="12" cy="12" r="3"/><path d="M12 5.5v-2M12 20.5v-2M18.5 12h2M3.5 12h2M16.6 7.4l1.4-1.4M6 18l1.4-1.4M16.6 16.6 18 18M6 6l1.4 1.4"/>',
  table: '<rect x="4" y="5" width="16" height="14" rx="1.5"/><path d="M4 10h16M4 14.5h16M10 10v9"/>',
  image: '<rect x="3.5" y="5" width="17" height="14" rx="1.5"/><circle cx="9" cy="10" r="1.6"/><path d="m20.5 16-5-5-8.5 8"/>',
  json: '<path d="M8.5 4.5c-2 0-2.5 1-2.5 2.5v2.5c0 1.5-1 2.5-2 2.5 1 0 2 1 2 2.5V17c0 1.5.5 2.5 2.5 2.5M15.5 4.5c2 0 2.5 1 2.5 2.5v2.5c0 1.5 1 2.5 2 2.5-1 0-2 1-2 2.5V17c0 1.5-.5 2.5-2.5 2.5"/>',
  weather: '<path d="M7 18.5h10.5a3.5 3.5 0 0 0 .3-7A5.5 5.5 0 0 0 7.3 10 4.3 4.3 0 0 0 7 18.5Z"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.6 3.5 5.4 3.5 8.5s-1 5.9-3.5 8.5c-2.5-2.6-3.5-5.4-3.5-8.5s1-5.9 3.5-8.5Z"/>',
  help: '<circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.5a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .8-1 1.5v.7M12 17v.2"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  refresh: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4"/>',
  stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="1.5"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  layers: '<path d="m12 4 8.5 4.5L12 13 3.5 8.5 12 4Z"/><path d="m3.5 12.5 8.5 4.5 8.5-4.5"/>',
};

/** @param {string} name */
export function iconSvg(name) {
  const body = ICONS[name];
  if (!body) return '';
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

/** @param {ParentNode} root */
export function hydrateIcons(root) {
  for (const el of root.querySelectorAll('[data-icon]')) {
    const name = /** @type {HTMLElement} */ (el).dataset.icon ?? '';
    if (el.getAttribute('data-icon-done') === name) continue;
    el.innerHTML = iconSvg(name);
    el.setAttribute('data-icon-done', name);
  }
}
