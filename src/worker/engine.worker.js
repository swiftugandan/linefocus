/// <reference lib="webworker" />
/** The engine worker: runs traces and studies off the main thread, in chunks, so newer requests can supersede
 * older ones without waiting for them to finish. */

import { buildDesignScene, designPointOptions } from '../core/design-scene.js';
import { trace, mergeTraces, RAY_BLOCK } from '../core/tracer.js';

/** @import { EngineRequest, EngineResponse } from './protocol.js' */
/** @import { TraceResult } from '../core/types.js' */

const scope = /** @type {DedicatedWorkerGlobalScope} */ (/** @type {unknown} */ (self));
/** Latest job id per channel. */
const latest = new Map();
const CHUNK_RAYS = 8 * RAY_BLOCK;

/** @param {EngineResponse} message */
const post = message => scope.postMessage(message);
/** Lets queued messages arrive between chunks. */
const yieldToMessages = () => new Promise(resolve => setTimeout(resolve, 0));

/** @param {EngineRequest} job */
async function designPoint(job) {
  const started = performance.now();
  const { scene, figures } = buildDesignScene(job.design);
  const options = designPointOptions(job.design, { rays: job.rays, pathCount: job.pathCount });
  /** @type {TraceResult[]} */
  const parts = [];
  for (let from = 0; from < options.rays; from += CHUNK_RAYS) {
    if (from > 0) {
      await yieldToMessages();
      if (latest.get(job.channel) !== job.id) return post({ type: 'superseded', id: job.id });
      post({ type: 'progress', id: job.id, done: from, total: options.rays });
    }
    parts.push(trace(scene, options, { from, to: Math.min(options.rays, from + CHUNK_RAYS) }));
  }
  post({ type: 'result', id: job.id, result: { scene, figures, trace: mergeTraces(parts), elapsedMs: performance.now() - started } });
}

scope.onmessage = async event => {
  const job = /** @type {EngineRequest} */ (event.data);
  latest.set(job.channel, job.id);
  try {
    if (job.kind === 'design-point') await designPoint(job);
  } catch (error) {
    post({ type: 'error', id: job.id, message: error instanceof Error ? error.message : String(error) });
  }
};
