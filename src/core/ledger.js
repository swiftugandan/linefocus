/** Plain names for the energy ledger, shared by the app and the agent skill. See docs/PHYSICS.md. */

/** @import { Bucket } from './types.js' */

/** Ledger rows in a fixed order, with plain names. */
/** @type {[Bucket | 'gaps', string, string][]} */
export const LEDGER_ROWS = [
  ['absorbed', 'Absorbed', 'Power absorbed by the absorber'],
  ['gaps', 'Cosine and gaps', 'Sun on the mirror area that the tilted rows do not intercept'],
  ['spillage', 'Spilled past receiver', 'Reflected light that misses the absorber'],
  ['reflectorAbsorption', 'Absorbed by mirrors', '1 − ρ at each mirror reflection'],
  ['glassReflection', 'Reflected by glass', 'Fresnel reflection at the envelope or cover'],
  ['glassAbsorption', 'Lost in glass', 'Absorbed in the glass, or 1 − τ in fixed mode'],
  ['absorberReflection', 'Reflected by absorber', '1 − α at the absorber'],
  ['shading', 'Shaded by rows', 'Sunlight stopped by the back of a mirror row'],
  ['blocking', 'Blocked by rows', 'Reflected light stopped by the back of a mirror row'],
  ['receiverShading', 'Shaded by receiver', 'Sunlight stopped by the receiver housing'],
  ['trapped', 'Trapped', 'Rays that bounced more than 64 times'],
];
