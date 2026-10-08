/** Page-side handle on the engine worker. Each request returns a promise; a request superseded by a newer one on
 * the same channel resolves to null. */

/** @import { EngineRequest, EngineResponse, EngineResult, DesignPointResult, AcceptanceJobResult, AnnualResult, OptimiseJobResult } from './protocol.js' */
/** @import { Objective, Variable } from '../core/optimise.js' */
/** @import { Design } from '../core/model.js' */

/** @typedef {(done: number, total: number, value?: number) => void} OnProgress */
/** A request without its id, kept as a union of the request kinds. */
/** @typedef {EngineRequest extends infer R ? (R extends unknown ? Omit<R, 'id'> : never) : never} RequestBody */
/** @typedef {{ channel: string, resolve: (value: EngineResult | null) => void, reject: (error: Error) => void, onProgress?: OnProgress }} Pending */

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
    if (message.type === 'progress') { pending.onProgress?.(message.done, message.total, message.value); return; }
    this.pending.delete(message.id);
    if (message.type === 'result') pending.resolve(message.result);
    else if (message.type === 'superseded') pending.resolve(null);
    else pending.reject(new Error(message.message));
  }

  /**
   * Sends a job, settling any older job on the same channel as superseded.
   * @param {RequestBody} body @param {OnProgress} [onProgress]
   * @returns {Promise<EngineResult | null>}
   */
  send(body, onProgress) {
    const id = this.nextId++;
    for (const [otherId, p] of this.pending) if (p.channel === body.channel) { this.pending.delete(otherId); p.resolve(null); }
    const request = /** @type {EngineRequest} */ ({ ...body, id });
    return new Promise((resolve, reject) => {
      this.pending.set(id, { channel: body.channel, resolve, reject, onProgress });
      this.worker.postMessage(request);
    });
  }

  /** @param {Design} design @param {{ rays: number, pathCount: number, onProgress?: OnProgress }} options */
  async designPoint(design, { rays, pathCount, onProgress }) {
    return /** @type {DesignPointResult | null} */ (await this.send({ kind: 'design-point', channel: 'design-point', design, rays, pathCount }, onProgress));
  }

  /** @param {Design} design @param {OnProgress} [onProgress] */
  async acceptance(design, onProgress) {
    return /** @type {AcceptanceJobResult | null} */ (await this.send({ kind: 'acceptance', channel: 'acceptance', design }, onProgress));
  }

  /**
   * @param {Design} design @param {{ objective: Objective, variables: Variable[], maxEvaluations: number }} setup @param {OnProgress} [onProgress]
   */
  async optimise(design, setup, onProgress) {
    return /** @type {OptimiseJobResult | null} */ (await this.send({ kind: 'optimise', channel: 'optimise', design, ...setup }, onProgress));
  }

  /** Stops whatever is running on a channel; its promise resolves to null. @param {string} channel */
  cancel(channel) {
    for (const [id, p] of this.pending) if (p.channel === channel) { this.pending.delete(id); p.resolve(null); }
    this.worker.postMessage(/** @type {EngineRequest} */ ({ kind: 'cancel', id: this.nextId++, channel }));
  }

  /** @param {Design} design @param {OnProgress} [onProgress] */
  async annual(design, onProgress) {
    return /** @type {AnnualResult | null} */ (await this.send({ kind: 'annual', channel: 'annual', design }, onProgress));
  }
}
