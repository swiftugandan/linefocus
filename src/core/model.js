/** The Linefocus design document: types, defaults, limits and validation. A design stores only the
 * engineer's intent. Geometry, traces and study results are derived and never saved. */

import { number, string, constant, choice, object, union, array, validate, ValidationError, MM, PERCENT } from './spec.js';

/** @import { SunSpec } from './types.js' */

export const FORMAT = 'linefocus.design';
export const FORMAT_VERSION = 1;
export const APP_VERSION = '0.1.0';

/**
 * @typedef {{ mode: 'none' | 'fixed' | 'physical', outerDiameter: number, thickness: number, refractiveIndex: number, extinction: number, transmittance: number }} Envelope
 * @typedef {{ type: 'tube', absorberDiameter: number, absorptance: number, envelope: Envelope }} TubeReceiver
 * @typedef {{ mode: 'none' | 'fixed' | 'physical', gap: number, overhang: number, thickness: number, refractiveIndex: number, extinction: number, transmittance: number }} Cover
 * @typedef {{ type: 'flat', width: number, absorptance: number, insulation: number, cover: Cover }} FlatReceiver
 * @typedef {TubeReceiver | FlatReceiver} Receiver
 */

/**
 * @typedef {{ type: 'trough', apertureWidth: number, focalLength: number }} TroughCollector
 * @typedef {{ kind: 'none' } | { kind: 'trapezoid', depth: number, mouthWidth: number }} Secondary
 * @typedef {{ type: 'fresnel', rows: number, mirrorWidth: number, pitch: number, receiverHeight: number, curvature: 'flat' | 'cylindrical', curvatureRadius: number, secondary: Secondary }} FresnelCollector
 * @typedef {{ type: 'cpc', acceptanceHalfAngleDeg: number, truncation: number, gap: number }} CpcCollector
 * @typedef {TroughCollector | FresnelCollector | CpcCollector} Collector
 * @typedef {Collector['type']} CollectorType
 */

/**
 * @typedef {{ reflectance: number, slopeErrorMrad: number, specularityMrad: number }} Optics
 * @typedef {{ name: string, latitude: number, longitude: number, timezone: number, elevation: number }} Site
 * @typedef {{ source: 'clear-sky' } | { source: 'epw', name: string, dni: number[] }} Weather
 * @typedef {{ axisAzimuthDeg: number, tiltDeg: number, trackingErrorMrad: number, rowLength: number }} Mounting
 * @typedef {{ transversalDeg: number, longitudinalDeg: number, dni: number }} DesignPoint
 * @typedef {{ rays: number, seed: number }} Simulation
 */

/**
 * @typedef {{
 *   format: typeof FORMAT,
 *   version: typeof FORMAT_VERSION,
 *   id: string,
 *   title: string,
 *   notes: string,
 *   collector: Collector,
 *   receiver: Receiver,
 *   optics: Optics,
 *   sun: SunSpec,
 *   site: Site,
 *   weather: Weather,
 *   mounting: Mounting,
 *   designPoint: DesignPoint,
 *   simulation: Simulation,
 * }} Design
 */

/** Most rays a single trace may use. */
export const MAX_RAYS = 2_000_000;
export const HOURS_PER_YEAR = 8760;

const fraction = /** @param {string} label @param {string} [help] */ (label, help) => number(label, '', 0, 1, { display: PERCENT, step: 0.001, ...(help ? { help } : {}) });

const ENVELOPE = object('Glass envelope', {
  mode: choice('Model', { none: 'None', fixed: 'Datasheet τ', physical: 'Physical' }, 'Datasheet τ applies a fixed transmittance; physical refracts through real glass.'),
  outerDiameter: number('Outer diameter', 'm', 0.005, 0.5, { display: MM, step: 0.001 }),
  thickness: number('Wall thickness', 'm', 0.0002, 0.02, { display: MM, step: 0.0001 }),
  refractiveIndex: number('Refractive index', '', 1, 2.5, { step: 0.01 }),
  extinction: number('Extinction coefficient', '1/m', 0, 1000, { step: 0.5, help: 'Bulk absorption of the glass' }),
  transmittance: fraction('Transmittance', 'Used in fixed mode'),
});

const COVER = object('Glass cover', {
  mode: choice('Model', { none: 'None', fixed: 'Datasheet τ', physical: 'Physical' }),
  gap: number('Gap below absorber', 'm', 0, 0.5, { display: MM, step: 0.001 }),
  overhang: number('Overhang each side', 'm', 0, 0.5, { display: MM, step: 0.001 }),
  thickness: number('Thickness', 'm', 0.0005, 0.03, { display: MM, step: 0.0005 }),
  refractiveIndex: number('Refractive index', '', 1, 2.5, { step: 0.01 }),
  extinction: number('Extinction coefficient', '1/m', 0, 1000, { step: 0.5 }),
  transmittance: fraction('Transmittance', 'Used in fixed mode'),
});

export const RECEIVER_SPEC = union('Receiver', 'type', {
  tube: ['Tube', object('Absorber tube', {
    type: constant('tube'),
    absorberDiameter: number('Absorber diameter', 'm', 0.002, 0.5, { display: MM, step: 0.001 }),
    absorptance: fraction('Absorptance'),
    envelope: ENVELOPE,
  })],
  flat: ['Flat plate', object('Flat absorber', {
    type: constant('flat'),
    width: number('Absorber width', 'm', 0.005, 3, { display: MM, step: 0.001 }),
    absorptance: fraction('Absorptance'),
    insulation: number('Insulation thickness', 'm', 0, 0.5, { display: MM, step: 0.001, help: 'Opaque back above the absorber plate' }),
    cover: COVER,
  })],
});

export const COLLECTOR_SPEC = union('Collector', 'type', {
  trough: ['Trough', object('Parabolic trough', {
    type: constant('trough'),
    apertureWidth: number('Aperture width', 'm', 0.1, 12, { step: 0.01 }),
    focalLength: number('Focal length', 'm', 0.02, 6, { step: 0.01 }),
  })],
  fresnel: ['Fresnel', object('Linear Fresnel reflector', {
    type: constant('fresnel'),
    rows: number('Mirror rows', '', 1, 60, { integer: true, step: 1 }),
    mirrorWidth: number('Mirror width', 'm', 0.02, 3, { step: 0.01 }),
    pitch: number('Row pitch', 'm', 0.02, 6, { step: 0.01, help: 'Centre-to-centre distance between rows' }),
    receiverHeight: number('Receiver height', 'm', 0.1, 40, { step: 0.05 }),
    curvature: choice('Mirror shape', { flat: 'Flat', cylindrical: 'Cylindrical' }),
    curvatureRadius: number('Curvature radius', 'm', 0.2, 500, { step: 0.1, help: 'Used for cylindrical rows' }),
    secondary: union('Secondary reflector', 'kind', {
      none: ['None', object('No secondary', { kind: constant('none') })],
      trapezoid: ['Cavity', object('Trapezoidal cavity', {
        kind: constant('trapezoid'),
        depth: number('Cavity depth', 'm', 0.005, 2, { display: MM, step: 0.005 }),
        mouthWidth: number('Mouth width', 'm', 0.01, 3, { display: MM, step: 0.005 }),
      })],
    }),
  })],
  cpc: ['CPC', object('Compound parabolic concentrator', {
    type: constant('cpc'),
    acceptanceHalfAngleDeg: number('Acceptance half-angle', '°', 1, 89, { step: 0.5 }),
    truncation: number('Height kept', '', 0, 1, { exclusiveMin: true, display: PERCENT, step: 0.01, help: 'Fraction of the full CPC height' }),
    gap: number('Clearance gap', 'm', 0, 0.05, { display: MM, step: 0.0005, help: 'Space between the receiver and the reflector cusp' }),
  })],
});

export const SUN_SPEC = union('Sunshape', 'shape', {
  pillbox: ['Pillbox', object('Pillbox sun', { shape: constant('pillbox'), halfAngleMrad: number('Half-angle', 'mrad', 0, 50, { step: 0.05 }) })],
  gaussian: ['Gaussian', object('Gaussian sun', { shape: constant('gaussian'), sigmaMrad: number('Standard deviation', 'mrad', 0.01, 50, { step: 0.05 }) })],
  buie: ['Buie', object('Buie sun', { shape: constant('buie'), csr: number('Circumsolar ratio', '', 0.001, 0.5, { display: PERCENT, step: 0.005 }) })],
});

export const DESIGN_SPEC = object('Linefocus design', {
  format: constant(FORMAT),
  version: constant(FORMAT_VERSION),
  id: string('Identifier', 64, { pattern: /^[A-Za-z0-9_-]+$/ }),
  title: string('Title', 160),
  notes: string('Notes', 20000),
  collector: COLLECTOR_SPEC,
  receiver: RECEIVER_SPEC,
  optics: object('Mirror optics', {
    reflectance: fraction('Reflectance'),
    slopeErrorMrad: number('Slope error', 'mrad', 0, 50, { step: 0.1, help: 'Standard deviation per axis of the surface normal' }),
    specularityMrad: number('Specularity error', 'mrad', 0, 50, { step: 0.1, help: 'Extra spread of the reflected ray, per axis' }),
  }),
  sun: SUN_SPEC,
  site: object('Site', {
    name: string('Site name', 120),
    latitude: number('Latitude', '°', -90, 90, { step: 0.01 }),
    longitude: number('Longitude', '°', -180, 180, { step: 0.01 }),
    timezone: number('Time zone', 'h', -14, 14, { step: 0.5, help: 'Offset of local standard time from UTC' }),
    elevation: number('Elevation', 'm', -500, 9000, { step: 1 }),
  }),
  weather: union('Weather', 'source', {
    'clear-sky': ['Clear sky', object('Clear-sky model', { source: constant('clear-sky') })],
    epw: ['Weather file', object('Hourly weather file', {
      source: constant('epw'),
      name: string('File name', 200),
      dni: array('Hourly direct normal irradiance (W/m²)', number('DNI', 'W/m²', 0, 1500), HOURS_PER_YEAR, HOURS_PER_YEAR),
    })],
  }),
  mounting: object('Mounting', {
    axisAzimuthDeg: number('Axis azimuth', '°', -180, 180, { step: 1, help: '0° is a north–south axis, 90° is east–west' }),
    tiltDeg: number('Tilt', '°', -90, 90, { step: 0.5, help: 'Fixed CPC tilt about its axis, towards +x' }),
    trackingErrorMrad: number('Tracking error', 'mrad', -100, 100, { step: 0.1, help: 'Constant misalignment of a tracking trough, used in the day and year studies' }),
    rowLength: number('Row length', 'm', 0.5, 5000, { step: 1, help: 'Used for end losses' }),
  }),
  designPoint: object('Design point', {
    transversalDeg: number('Transversal angle', '°', -89, 89, { step: 0.1, help: 'Sun angle across the aperture, as traced. For a trough this is its misalignment' }),
    longitudinalDeg: number('Longitudinal angle', '°', -89, 89, { step: 0.1 }),
    dni: number('DNI', 'W/m²', 0, 1500, { step: 10 }),
  }),
  simulation: object('Simulation', {
    rays: number('Rays', '', 1000, MAX_RAYS, { integer: true, step: 1000 }),
    seed: number('Random seed', '', 0, 4294967295, { integer: true, step: 1 }),
  }),
});

/**
 * Design rules that span several fields. A JSON Schema cannot express them, so the loader checks them after
 * structural validation. docs/SCHEMA.md lists the same rules.
 * @param {Design} d
 * @returns {ValidationError[]}
 */
export function designRuleViolations(d) {
  /** @type {ValidationError[]} */
  const out = [];
  const c = d.collector, r = d.receiver;
  if (c.type === 'trough' && r.type !== 'tube') out.push(new ValidationError('receiver.type', 'a parabolic trough needs an absorber tube'));
  if (r.type === 'tube' && r.envelope.mode !== 'none') {
    const e = r.envelope;
    const inner = e.mode === 'physical' ? e.outerDiameter - 2 * e.thickness : e.outerDiameter;
    if (!(inner > r.absorberDiameter)) out.push(new ValidationError('receiver.envelope.outerDiameter', e.mode === 'physical' ? 'the envelope bore must be wider than the absorber' : 'the envelope must be wider than the absorber'));
  }
  if (c.type === 'fresnel') {
    if (c.pitch < c.mirrorWidth) out.push(new ValidationError('collector.pitch', 'rows would overlap: the pitch must be at least the mirror width'));
    if (c.curvature === 'cylindrical' && c.curvatureRadius < c.mirrorWidth / 2 * 1.0001) out.push(new ValidationError('collector.curvatureRadius', 'must be more than half the mirror width'));
    if (c.secondary.kind === 'trapezoid') {
      const opening = r.type === 'tube' ? 2 * receiverOuterRadius(r) : r.width;
      if (c.secondary.mouthWidth <= opening) out.push(new ValidationError('collector.secondary.mouthWidth', 'must be wider than the receiver'));
    }
  }
  if (c.type === 'trough' && r.type === 'tube' && 2 * receiverOuterRadius(r) >= c.apertureWidth) out.push(new ValidationError('receiver.absorberDiameter', 'the receiver is wider than the aperture'));
  return out;
}

/** @param {TubeReceiver} r */
function receiverOuterRadius(r) {
  return r.envelope.mode === 'none' ? r.absorberDiameter / 2 : r.envelope.outerDiameter / 2;
}

/**
 * Validates a design and returns a clean copy. Throws a ValidationError naming the first problem.
 * @param {unknown} raw
 * @returns {Design}
 */
export function validateDesign(raw) {
  const design = /** @type {Design} */ (validate(DESIGN_SPEC, raw));
  const [first] = designRuleViolations(design);
  if (first) throw first;
  return design;
}

/** Parses design JSON from a file or storage. @param {string} text */
export function parseDesign(text) {
  if (text.length > 4 * 1024 * 1024) throw new ValidationError('', 'This file is larger than 4 MB, which is too large for a Linefocus design.');
  let raw;
  try { raw = JSON.parse(text); } catch { throw new ValidationError('', 'This file is not valid JSON.'); }
  if (!raw || typeof raw !== 'object' || /** @type {{format?: unknown}} */ (raw).format !== FORMAT) {
    throw new ValidationError('', 'This is not a Linefocus design.');
  }
  if (/** @type {{version?: unknown}} */ (raw).version !== FORMAT_VERSION) {
    throw new ValidationError('version', `This design uses format version ${String(/** @type {{version?: unknown}} */ (raw).version)}; this app reads version ${FORMAT_VERSION}.`);
  }
  return validateDesign(raw);
}

/** Canonical, stable JSON for files and storage. @param {Design} design */
export function serializeDesign(design) {
  return JSON.stringify(design, null, 2) + '\n';
}

/** @returns {string} */
export function newDesignId() {
  const bytes = new Uint8Array(9);
  crypto.getRandomValues(bytes);
  return 'design_' + Array.from(bytes, b => b.toString(36).padStart(2, '0')).join('').slice(0, 16);
}

/** @param {CollectorType} type @returns {Collector} */
export function defaultCollector(type) {
  if (type === 'fresnel') return { type, rows: 16, mirrorWidth: 0.75, pitch: 0.95, receiverHeight: 7.4, curvature: 'cylindrical', curvatureRadius: 15, secondary: { kind: 'trapezoid', depth: 0.12, mouthWidth: 0.55 } };
  if (type === 'cpc') return { type, acceptanceHalfAngleDeg: 35, truncation: 0.6, gap: 0.002 };
  return { type: 'trough', apertureWidth: 5.77, focalLength: 1.71 };
}

/** @param {Receiver['type']} type @returns {Receiver} */
export function defaultReceiver(type) {
  if (type === 'flat') {
    return { type, width: 0.3, absorptance: 0.95, insulation: 0.05, cover: { mode: 'fixed', gap: 0.03, overhang: 0.02, thickness: 0.004, refractiveIndex: 1.52, extinction: 4, transmittance: 0.92 } };
  }
  return { type: 'tube', absorberDiameter: 0.07, absorptance: 0.955, envelope: { mode: 'fixed', outerDiameter: 0.125, thickness: 0.003, refractiveIndex: 1.47, extinction: 4, transmittance: 0.965 } };
}

/** A EuroTrough-class parabolic trough at a sunny site; the app's starting design. @returns {Design} */
export function defaultDesign() {
  return {
    format: FORMAT,
    version: FORMAT_VERSION,
    id: newDesignId(),
    title: 'Untitled trough',
    notes: '',
    collector: defaultCollector('trough'),
    receiver: defaultReceiver('tube'),
    optics: { reflectance: 0.935, slopeErrorMrad: 2.5, specularityMrad: 0 },
    sun: { shape: 'buie', csr: 0.05 },
    site: { name: 'Almería, Spain', latitude: 37.09, longitude: -2.36, timezone: 1, elevation: 500 },
    weather: { source: 'clear-sky' },
    mounting: { axisAzimuthDeg: 0, tiltDeg: 0, trackingErrorMrad: 0, rowLength: 150 },
    designPoint: { transversalDeg: 0, longitudinalDeg: 0, dni: 900 },
    simulation: { rays: 200000, seed: 1 },
  };
}

/** Lower-case names used in default titles. */
export const COLLECTOR_TITLES = { trough: 'trough', fresnel: 'linear Fresnel', cpc: 'CPC' };

/** Reads a dotted path. @param {unknown} root @param {string} path @returns {unknown} */
export function getPath(root, path) {
  let node = root;
  for (const key of path.split('.')) node = node && typeof node === 'object' ? /** @type {Record<string, unknown>} */ (node)[key] : undefined;
  return node;
}

/** Writes a dotted path that already exists. @param {unknown} root @param {string} path @param {unknown} value */
export function setPath(root, path, value) {
  const keys = path.split('.');
  let node = /** @type {Record<string, unknown>} */ (root);
  for (const key of keys.slice(0, -1)) node = /** @type {Record<string, unknown>} */ (node[key]);
  const last = /** @type {string} */ (keys.at(-1));
  if (!Object.hasOwn(node, last)) throw new Error(`Unknown design field ${path}`);
  node[last] = value;
}

/**
 * Switches a union field to another variant inside a transaction, filling the new variant with defaults and
 * keeping the rest of the design consistent.
 * @param {Design} design @param {string} path @param {string} tag
 */
export function switchVariant(design, path, tag) {
  if (path === 'collector') {
    const type = /** @type {CollectorType} */ (tag);
    design.collector = defaultCollector(type);
    const tube = /** @type {TubeReceiver} */ (defaultReceiver('tube'));
    // Each collector starts with the receiver it is usually built with: a flat absorber in a cavity for an LFR.
    if (type === 'cpc') design.receiver = { ...tube, absorberDiameter: 0.047, envelope: { ...tube.envelope, outerDiameter: 0.058, transmittance: 0.92 } };
    else if (type === 'fresnel') design.receiver = { ...(/** @type {FlatReceiver} */ (defaultReceiver('flat'))), width: 0.35 };
    else design.receiver = tube;
    design.mounting = { ...design.mounting, axisAzimuthDeg: type === 'cpc' ? 90 : 0, tiltDeg: 0 };
    // A design still carrying its starting title follows the collector it now describes.
    if (/^Untitled /.test(design.title)) design.title = `Untitled ${COLLECTOR_TITLES[type]}`;
    return;
  }
  if (path === 'receiver') { design.receiver = defaultReceiver(/** @type {Receiver['type']} */ (tag)); return; }
  if (path === 'sun') {
    design.sun = tag === 'pillbox' ? { shape: 'pillbox', halfAngleMrad: 4.65 } : tag === 'gaussian' ? { shape: 'gaussian', sigmaMrad: 2.5 } : { shape: 'buie', csr: 0.05 };
    return;
  }
  if (path === 'collector.secondary' && design.collector.type === 'fresnel') {
    design.collector.secondary = tag === 'trapezoid' ? { kind: 'trapezoid', depth: 0.12, mouthWidth: 0.55 } : { kind: 'none' };
    return;
  }
  if (path === 'weather' && tag === 'clear-sky') { design.weather = { source: 'clear-sky' }; return; }
  throw new Error(`Cannot switch ${path} to ${tag} here.`);
}
