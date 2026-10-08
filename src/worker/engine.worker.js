/// <reference lib="webworker" />
/** The engine worker: runs traces and studies off the main thread, in chunks, so newer requests can supersede
 * older ones without waiting for them to finish. */

import { buildDesignScene, designPointOptions } from '../core/design-scene.js';
import { trace, mergeTraces, RAY_BLOCK } from '../core/tracer.js';
import { acceptanceStudy, iamGrid, yearStudy, dayStudy } from '../core/studies.js';
import { optimise } from '../core/optimise.js';

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

/**
 * Progress callback for studies: reports, yields, and tells the study to stop once the job is superseded.
 * @param {EngineRequest} job
 */
const progressFor = job => async (/** @type {number} */ done, /** @type {number} */ total) => {
  await yieldToMessages();
  if (latest.get(job.channel) !== job.id) return false;
  post({ type: 'progress', id: job.id, done, total });
  return true;
};

/** @param {Extract<EngineRequest, { kind: 'design-point' }>} job */
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

/** @param {Extract<EngineRequest, { kind: 'acceptance' }>} job */
async function acceptance(job) {
  const started = performance.now();
  const { scene } = buildDesignScene(job.design);
  const result = await acceptanceStudy(job.design, scene, progressFor(job));
  if (!result) return post({ type: 'superseded', id: job.id });
  post({ type: 'result', id: job.id, result: { acceptance: result, elapsedMs: performance.now() - started } });
}

/** @param {Extract<EngineRequest, { kind: 'annual' }>} job */
async function annual(job) {
  const started = performance.now();
  const { scene } = buildDesignScene(job.design);
  const grid = await iamGrid(job.design, scene, progressFor(job));
  if (!grid) return post({ type: 'superseded', id: job.id });
  post({ type: 'result', id: job.id, result: { grid, year: yearStudy(job.design, scene, grid), days: dayStudy(job.design, scene, grid), elapsedMs: performance.now() - started } });
}

/** @param {Extract<EngineRequest, { kind: 'optimise' }>} job */
async function optimiseJob(job) {
  const started = performance.now();
  const result = await optimise(job.design, { objective: job.objective, variables: job.variables, maxEvaluations: job.maxEvaluations }, async (best, count) => {
    await yieldToMessages();
    if (latest.get(job.channel) !== job.id) return false;
    post({ type: 'progress', id: job.id, done: count, total: job.maxEvaluations, value: best });
    return true;
  });
  if (!result || latest.get(job.channel) !== job.id) return post({ type: 'superseded', id: job.id });
  post({ type: 'result', id: job.id, result: { optimisation: result, elapsedMs: performance.now() - started } });
}

scope.onmessage = async event => {
  const job = /** @type {EngineRequest} */ (event.data);
  latest.set(job.channel, job.id);
  // A cancel only marks its channel; the running job notices at its next progress check.
  if (job.kind === 'cancel') return;
  try {
    if (job.kind === 'design-point') await designPoint(job);
    else if (job.kind === 'acceptance') await acceptance(job);
    else if (job.kind === 'optimise') await optimiseJob(job);
    else await annual(job);
  } catch (error) {
    post({ type: 'error', id: job.id, message: error instanceof Error ? error.message : String(error) });
  }
};
