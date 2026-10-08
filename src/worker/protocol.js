/** Messages between the page and the engine worker. This module has no runtime code. */

/** @import { Design } from '../core/model.js' */
/** @import { TraceResult, OpticalScene } from '../core/types.js' */
/** @import { Figure } from '../core/design-scene.js' */
/** @import { AcceptanceResult, IamGrid, YearResult, DayCurve } from '../core/studies.js' */
/** @import { Objective, Variable, OptimiseResult } from '../core/optimise.js' */

/**
 * A request. Jobs on the same channel supersede each other: the worker abandons an older job between chunks once a
 * newer one arrives on its channel.
 * @typedef {{ kind: 'design-point', id: number, channel: string, design: Design, rays: number, pathCount: number }
 *   | { kind: 'acceptance', id: number, channel: string, design: Design }
 *   | { kind: 'annual', id: number, channel: string, design: Design }
 *   | { kind: 'optimise', id: number, channel: string, design: Design, objective: Objective, variables: Variable[], maxEvaluations: number }
 *   | { kind: 'cancel', id: number, channel: string }} EngineRequest
 */

/**
 * @typedef {{ scene: OpticalScene, figures: Figure[], trace: TraceResult, elapsedMs: number }} DesignPointResult
 * @typedef {{ acceptance: AcceptanceResult, elapsedMs: number }} AcceptanceJobResult
 * @typedef {{ grid: IamGrid, year: YearResult, days: DayCurve[], elapsedMs: number }} AnnualResult
 * @typedef {{ optimisation: OptimiseResult, elapsedMs: number }} OptimiseJobResult
 * @typedef {DesignPointResult | AcceptanceJobResult | AnnualResult | OptimiseJobResult} EngineResult
 * @typedef {{ type: 'progress', id: number, done: number, total: number, value?: number }
 *   | { type: 'result', id: number, result: EngineResult }
 *   | { type: 'error', id: number, message: string }
 *   | { type: 'superseded', id: number }} EngineResponse
 */

export {};
