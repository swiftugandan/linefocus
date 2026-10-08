/** Page-side handle on the engine worker. Each request returns a promise; a request superseded by a newer one on
 * the same channel resolves to null. */

/** @import { EngineRequest, EngineResponse, DesignPointResult } from './protocol.js' */
/** @import { Design } from '../core/model.js' */

/** @typedef {{ channel: string, resolve: (value: DesignPointResult | null) => void, reject: (error: Error) => void, onProgress?: (done: number, total: number) => void }} Pending */

export class EngineClient {
  /** @param {Worker} worker */
  constructor(worker) {
    this.worker = worker;
    this.nextId = 1;
    /** @type {Map<number, Pending>} */
    this.pending = new Map();
    worker.onmessage = event => this.receive(/** @type {EngineResponse} */ (event.data));
    worker.onerror = event => {
      const error = new Error(event.message || 'The engine stopped unexpectedly.');
      for (const p of this.pending.values()) p.reject(error);
      this.pending.clear();
    };
  }

  /** @param {EngineResponse} message */
  receive(message) {
    const pending = this.pending.get(message.id);
    if (!pending) return;
    if (message.type === 'progress') { pending.onProgress?.(message.done, message.total); return; }
    this.pending.delete(message.id);
    if (message.type === 'result') pending.resolve(message.result);
    else if (message.type === 'superseded') pending.resolve(null);
    else pending.reject(new Error(message.message));
  }

  /**
   * Traces the design point.
   * @param {string} channel @param {Design} design @param {{ rays: number, pathCount: number, onProgress?: (done: number, total: number) => void }} options
   * @returns {Promise<DesignPointResult | null>}
   */
  designPoint(channel, design, { rays, pathCount, onProgress }) {
    const id = this.nextId++;
    // Any older job on this channel will be dropped by the worker; settle it here too.
    for (const [otherId, p] of this.pending) if (p.channel === channel) { this.pending.delete(otherId); p.resolve(null); }
    /** @type {EngineRequest} */
    const request = { kind: 'design-point', id, channel, design, rays, pathCount };
    return new Promise((resolve, reject) => {
      this.pending.set(id, { channel, resolve, reject, onProgress });
      this.worker.postMessage(request);
    });
  }
}
