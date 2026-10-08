/** Shared type definitions for the physics core. This module has no runtime code. */

/**
 * @typedef {{ shape: 'pillbox', halfAngleMrad: number }
 *   | { shape: 'gaussian', sigmaMrad: number }
 *   | { shape: 'buie', csr: number }} SunSpec
 */

/**
 * Geometry primitives in the collector cross-section (metres). Angles are radians, counter-clockwise from +x.
 * @typedef {{ kind: 'segment', x1: number, y1: number, x2: number, y2: number }} SegmentShape
 *   Front normal is the left-hand normal of the direction from (x1, y1) to (x2, y2).
 * @typedef {{ kind: 'circle', cx: number, cy: number, r: number }} CircleShape
 *   Front normal points outwards.
 * @typedef {{ kind: 'arc', cx: number, cy: number, r: number, start: number, sweep: number }} ArcShape
 *   Counter-clockwise from `start` through `sweep` (> 0). Front normal points outwards.
 * @typedef {{ kind: 'parabola', vx: number, vy: number, angle: number, f: number, u0: number, u1: number }} ParabolaShape
 *   Local curve v = u²/(4f) with vertex (vx, vy), local +v rotated by `angle` from +y. Front normal faces the focus.
 * @typedef {{ kind: 'polyline', points: number[], normals: number[] }} PolylineShape
 *   Flat [x0, y0, x1, y1, …] vertices with unit front normals at each vertex, interpolated along each segment.
 * @typedef {SegmentShape | CircleShape | ArcShape | ParabolaShape | PolylineShape} Shape
 */

/**
 * @typedef {{ n: number, k: number }} Medium  Refractive index and absorption coefficient (1/m).
 * @typedef {{ kind: 'mirror', reflectance: number, slopeErrorMrad: number, specularityMrad: number }} MirrorMaterial
 * @typedef {{ kind: 'absorber', absorptance: number }} AbsorberMaterial
 * @typedef {{ kind: 'dielectric', front: Medium, back: Medium }} DielectricMaterial
 * @typedef {{ kind: 'thin-glass', transmittance: number }} ThinGlassMaterial
 * @typedef {{ kind: 'opaque' }} OpaqueMaterial
 * @typedef {MirrorMaterial | AbsorberMaterial | DielectricMaterial | ThinGlassMaterial | OpaqueMaterial} Material
 */

/**
 * @typedef {'primary' | 'secondary' | 'receiver' | 'structure'} SurfaceGroup
 * @typedef {{ id: string, label: string, group: SurfaceGroup, shape: Shape, material: Material, flip?: boolean }} Surface
 *   `flip` swaps the front side of the shape.
 */

/**
 * A traceable cross-section. With `reference.cosine`, P_ref = DNI · width · cos θi; without it (an LFR field),
 * P_ref = DNI · width.
 * @typedef {{
 *   surfaces: Surface[],
 *   reference: { width: number, label: string, cosine: boolean },
 *   meanReceiverDistance: number,
 * }} OpticalScene
 */

/**
 * @typedef {'absorbed' | 'absorberReflection' | 'reflectorAbsorption' | 'glassAbsorption' | 'glassReflection'
 *   | 'spillage' | 'shading' | 'blocking' | 'receiverShading' | 'trapped' | 'missed'} Bucket
 */

/**
 * @typedef {{
 *   sun: SunSpec,
 *   transversalDeg: number,
 *   longitudinalDeg: number,
 *   dni: number,
 *   rays: number,
 *   seed: number,
 *   pathCount?: number,
 *   fluxBins?: number,
 * }} TraceOptions
 */

/**
 * @typedef {{ surfaceId: string, kind: 'angle' | 'position', start: number, step: number, length: number, power: number[] }} FluxMap
 *   `power` is absorbed W/m per bin. For 'angle' bins, `start` and `step` are radians measured counter-clockwise
 *   from −y (the side facing the primary). For 'position' bins they are metres along the absorber.
 * @typedef {{ points: number[], bucket: Bucket }} RayPath
 * @typedef {{
 *   launched: number,
 *   reference: number,
 *   ledger: Record<Bucket, number>,
 *   efficiency: number,
 *   intercept: number,
 *   reflected: number,
 *   intercepted: number,
 *   flux: FluxMap[],
 *   paths: RayPath[],
 *   rays: number,
 *   cosIncidence: number,
 * }} TraceResult
 */

export {};
