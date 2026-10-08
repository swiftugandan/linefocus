/** Browser-local storage of the current design: IndexedDB, falling back to localStorage when IndexedDB is not
 * available. A downloaded .linefocus.json file is the portable copy. */

import { parseDesign, serializeDesign } from '../core/model.js';

/** @import { Design } from '../core/model.js' */

const DB_NAME = 'linefocus';
const STORE = 'designs';
const KEY = 'current';
const FALLBACK_KEY = 'linefocus-design';

export class Persistence {
  constructor() {
    /** @type {IDBDatabase | null} */
    this.db = null;
    this.fallback = false;
    /** Saves run one at a time, in order. */
    this.queue = Promise.resolve();
  }

  async open() {
    if (this.db || this.fallback) return;
    try {
      this.db = await new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => request.result.createObjectStore(STORE);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error('Storage upgrade is blocked by another tab.'));
      });
    } catch {
      this.fallback = true;
    }
  }

  /** @returns {Promise<Design | null>} */
  async load() {
    await this.open();
    /** @type {string | undefined | null} */
    let text;
    if (this.fallback || !this.db) text = localStorage.getItem(FALLBACK_KEY);
    else {
      const db = this.db;
      text = await new Promise((resolve, reject) => {
        const request = db.transaction(STORE).objectStore(STORE).get(KEY);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }
    return text ? parseDesign(text) : null;
  }

  /** @param {Design} design */
  save(design) {
    const text = serializeDesign(design);
    this.queue = this.queue.catch(() => {}).then(async () => {
      await this.open();
      if (this.fallback || !this.db) { localStorage.setItem(FALLBACK_KEY, text); return; }
      const db = this.db;
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(text, KEY);
        tx.oncomplete = () => resolve(undefined);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error ?? new Error('The save was aborted.'));
      });
    });
    return this.queue;
  }
}
