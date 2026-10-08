/** Messages between the page and the engine worker. This module has no runtime code. */

/** @import { Design } from '../core/model.js' */
/** @import { TraceResult, OpticalScene } from '../core/types.js' */
/** @import { Figure } from '../core/design-scene.js' */

/**
 * A request. Jobs on the same channel supersede each other: the worker abandons an older job between chunks
 * once a newer one arrives on its channel.
 * @typedef {{ kind: 'design-point', id: number, channel: string, design: Design, rays: number, pathCount: number }} EngineRequest
 */

/**
 * @typedef {{ scene: OpticalScene, figures: Figure[], trace: TraceResult, elapsedMs: number }} DesignPointResult
 * @typedef {{ type: 'progress', id: number, done: number, total: number }
 *   | { type: 'result', id: number, result: DesignPointResult }
 *   | { type: 'error', id: number, message: string }
 *   | { type: 'superseded', id: number }} EngineResponse
 */

export {};
