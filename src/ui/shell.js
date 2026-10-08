/** Shell furniture shared by every view: commands, ribbon, command palette, dialogs, toasts and tooltips. */

import { h, byId, escapeHtml } from './dom.js';
import { hydrateIcons } from './icons.js';

/**
 * A user command. Every button, palette entry and shortcut runs one of these.
 * @typedef {{ id: string, label: string, icon?: string, shortcut?: string, run: () => void | Promise<void>,
 *   enabled?: () => boolean, pressed?: () => boolean, hint?: string, palette?: boolean }} Command
 */

/**
 * Ribbon layout: tabs of groups of items. Items name commands; `size` picks large or stacked small buttons.
 * @typedef {{ caption: string, items: { cmd: string, size?: 'large' | 'small', label?: string, className?: string }[] }} RibbonGroup
 * @typedef {{ id: string, label: string, groups: RibbonGroup[] }} RibbonTab
 */

export class Commands {
  constructor() {
    /** @type {Map<string, Command>} */
    this.map = new Map();
    /** @type {(() => void) | null} Called after every command, so pressed and enabled states stay current. */
    this.onRun = null;
  }

  /** @param {Command[]} list */
  register(list) { for (const c of list) this.map.set(c.id, c); }

  /** @param {string} id */
  get(id) { return this.map.get(id); }

  /** @param {string} id */
  async run(id) {
    const command = this.map.get(id);
    if (!command || (command.enabled && !command.enabled())) return;
    await command.run();
    this.onRun?.();
  }
}

export class Ribbon {
  /**
   * @param {{ tabs: HTMLElement, ribbon: HTMLElement, commands: Commands, layout: RibbonTab[], onShow: () => void }} options
   */
  constructor({ tabs, ribbon, commands, layout, onShow }) {
    this.tabsEl = tabs;
    this.ribbonEl = ribbon;
    this.commands = commands;
    this.layout = layout;
    this.onShow = onShow;
    this.active = layout[1]?.id ?? layout[0].id;
  }

  render() {
    this.tabsEl.replaceChildren(...this.layout.map(tab => {
      const button = h('button', { class: 'tab', role: 'tab', type: 'button', 'aria-selected': String(tab.id === this.active), text: tab.label, 'data-tab': tab.id });
      button.addEventListener('click', () => { this.active = tab.id; this.onShow(); this.render(); });
      return button;
    }));
    const tab = this.layout.find(t => t.id === this.active) ?? this.layout[0];
    this.ribbonEl.replaceChildren(...tab.groups.map(group => {
      const large = group.items.filter(i => i.size !== 'small');
      const small = group.items.filter(i => i.size === 'small');
      const items = h('div', { class: 'ribbon-items' }, large.map(i => this.button(i, 'tool')));
      for (let k = 0; k < small.length; k += 2) items.append(h('div', { class: 'tool-stack' }, small.slice(k, k + 2).map(i => this.button(i, 'tool-small'))));
      return h('div', { class: 'ribbon-group', role: 'group', 'aria-label': group.caption }, [items, h('div', { class: 'ribbon-caption', text: group.caption })]);
    }));
    hydrateIcons(this.ribbonEl);
    this.refresh();
  }

  /** Updates enabled and pressed states without rebuilding. */
  refresh() {
    for (const button of /** @type {NodeListOf<HTMLButtonElement>} */ (document.querySelectorAll('[data-cmd]'))) {
      const command = this.commands.get(button.dataset.cmd ?? '');
      if (!command) continue;
      button.disabled = command.enabled ? !command.enabled() : false;
      if (command.pressed) button.setAttribute('aria-pressed', String(command.pressed()));
    }
  }

  /** @param {{ cmd: string, label?: string, className?: string }} item @param {string} cls */
  button(item, cls) {
    const command = this.commands.get(item.cmd);
    if (!command) throw new Error(`Unknown command ${item.cmd}`);
    const tipText = [command.hint ?? command.label, command.shortcut ? `(${command.shortcut})` : ''].filter(Boolean).join(' ');
    return h('button', { class: `${cls}${item.className ? ` ${item.className}` : ''}`, type: 'button', 'data-cmd': item.cmd, 'data-tip': tipText }, [
      command.icon ? h('span', { 'data-icon': command.icon }) : null,
      h('span', { text: item.label ?? command.label }),
    ]);
  }
}

/** Short-lived messages at the bottom of the window. */
export class Toasts {
  constructor() { this.root = byId('toasts'); }

  /** @param {string} message @param {{ kind?: 'info' | 'error', action?: { label: string, run: () => void }, ms?: number }} [options] */
  show(message, { kind = 'info', action, ms = 4200 } = {}) {
    const toast = h('div', { class: 'toast', 'data-kind': kind, role: kind === 'error' ? 'alert' : 'status' }, [h('span', { text: message })]);
    if (action) {
      const button = h('button', { type: 'button', text: action.label });
      button.addEventListener('click', () => { action.run(); toast.remove(); });
      toast.append(button);
    }
    this.root.append(toast);
    setTimeout(() => toast.remove(), ms);
  }
}

/** Hover tooltips for any element with data-tip. */
export function installTooltips() {
  const tip = byId('tooltip');
  /** @type {HTMLElement | null} */
  let current = null;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  const hide = () => { clearTimeout(timer); tip.hidden = true; current = null; };
  document.addEventListener('pointerover', e => {
    const target = /** @type {HTMLElement | null} */ (e.target instanceof Element ? e.target.closest('[data-tip]') : null);
    if (target === current) return;
    hide();
    if (!target || !target.dataset.tip) return;
    current = target;
    timer = setTimeout(() => {
      if (current !== target || !target.isConnected) return;
      tip.textContent = target.dataset.tip ?? '';
      tip.hidden = false;
      const r = target.getBoundingClientRect();
      const w = tip.offsetWidth, ht = tip.offsetHeight;
      const below = r.bottom + 8 + ht < window.innerHeight;
      tip.style.left = `${Math.max(6, Math.min(window.innerWidth - w - 6, r.left + r.width / 2 - w / 2))}px`;
      tip.style.top = `${below ? r.bottom + 8 : r.top - ht - 8}px`;
    }, 420);
  });
  document.addEventListener('pointerdown', hide, true);
  window.addEventListener('blur', hide);
}

/** Modal dialogs on the native <dialog> element. */
export class Dialogs {
  constructor() { this.el = /** @type {HTMLDialogElement} */ (byId('dialog')); }

  /**
   * @param {{ title: string, body: (Node | string)[], actions: { label: string, value: string, primary?: boolean }[], className?: string }} options
   * @returns {Promise<string>} the chosen action's value, or '' when dismissed
   */
  open({ title, body, actions, className = '' }) {
    const el = this.el;
    el.className = `dialog ${className}`.trim();
    const close = h('button', { class: 'icon-button', type: 'button', 'aria-label': 'Close' }, [h('span', { 'data-icon': 'close' })]);
    const foot = h('div', { class: 'dialog-foot' }, actions.map(a => h('button', { class: a.primary ? 'primary-button' : 'outline-button', type: 'button', value: a.value, text: a.label })));
    el.replaceChildren(h('div', { class: 'dialog-head' }, [h('h2', { text: title }), close]), h('div', { class: 'dialog-body' }, body), foot);
    hydrateIcons(el);
    return new Promise(resolve => {
      /** @param {string} value */
      const finish = value => { el.close(); resolve(value); };
      close.addEventListener('click', () => finish(''));
      for (const button of foot.querySelectorAll('button')) button.addEventListener('click', () => finish(button.value));
      el.addEventListener('cancel', () => resolve(''), { once: true });
      el.showModal();
      /** @type {HTMLElement | null} */ (foot.querySelector('.primary-button'))?.focus();
    });
  }

  /** @param {string} title @param {string} label @param {string} value @returns {Promise<string | null>} */
  async prompt(title, label, value) {
    const input = h('input', { class: 'text-input', value, 'aria-label': label });
    const form = h('label', { class: 'field wide' }, [h('span', { class: 'field-label', text: label }), input]);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); /** @type {HTMLButtonElement | null} */ (this.el.querySelector('.primary-button'))?.click(); } });
    const result = this.open({ title, body: [form], actions: [{ label: 'Cancel', value: '' }, { label: 'Save', value: 'ok', primary: true }] });
    queueMicrotask(() => { input.focus(); input.select(); });
    return (await result) === 'ok' ? input.value : null;
  }

  /**
   * Ctrl+K: type to filter commands, Enter to run.
   * @param {Commands} commands
   */
  palette(commands) {
    const el = this.el;
    el.className = 'dialog palette';
    const input = h('input', { placeholder: 'Find a command', 'aria-label': 'Find a command', role: 'combobox', 'aria-expanded': 'true', 'aria-controls': 'paletteList' });
    const list = h('div', { class: 'palette-list', role: 'listbox', id: 'paletteList' });
    el.replaceChildren(input, list);
    let index = 0;
    /** @type {import('./shell.js').Command[]} */
    let matches = [];
    const render = () => {
      const q = input.value.trim().toLowerCase();
      matches = [...commands.map.values()].filter(c => c.palette !== false && (!c.enabled || c.enabled()) && (!q || c.label.toLowerCase().includes(q) || c.id.includes(q)));
      index = Math.min(index, Math.max(0, matches.length - 1));
      list.replaceChildren(...(matches.length ? matches.map((c, i) => {
        const item = h('button', { class: 'palette-item', type: 'button', role: 'option', 'aria-selected': String(i === index) }, [c.icon ? h('span', { 'data-icon': c.icon }) : h('span', { 'data-icon': 'chevron-right' }), c.label, c.shortcut ? h('kbd', { text: c.shortcut }) : null]);
        item.addEventListener('click', () => { el.close(); commands.run(c.id); });
        return item;
      }) : [h('div', { class: 'palette-empty', text: 'No command matches. Try “trace”, “export” or “fit”.' })]));
      hydrateIcons(list);
      /** @type {HTMLElement | undefined} */ (list.children[index])?.scrollIntoView({ block: 'nearest' });
    };
    input.addEventListener('input', () => { index = 0; render(); });
    input.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { e.preventDefault(); index = Math.min(matches.length - 1, index + 1); render(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); index = Math.max(0, index - 1); render(); }
      if (e.key === 'Enter' && matches[index]) { e.preventDefault(); el.close(); commands.run(matches[index].id); }
    });
    render();
    el.showModal();
    input.focus();
  }

  /** @param {[string, string][]} shortcuts */
  help(shortcuts) {
    const table = h('table', { class: 'shortcut-table' }, [h('tbody', {}, shortcuts.map(([action, keys]) => h('tr', {}, [h('td', { text: action }), h('td', { text: keys })])))]);
    const intro = h('p', {});
    intro.innerHTML = `Linefocus traces sunlight through a collector's cross-section. Change any value on the right and the trace updates. Drag the white handles or the sun to reshape the design, and drag a field's label to scrub its value. ${escapeHtml('Designs are kept in this browser; download a copy to keep it safe.')}`;
    return this.open({ title: 'Help and keyboard shortcuts', body: [intro, table], actions: [{ label: 'Done', value: 'ok', primary: true }] });
  }
}
