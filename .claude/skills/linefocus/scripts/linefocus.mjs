// Build Linefocus designs (.linefocus.json) from the app's own defaults, rules and serializer.
//
//   import { trough, fresnel, cpc, save } from '/path/to/skills/linefocus/scripts/linefocus.mjs';
//   const d = trough({ title: 'Dairy process heat', site: 'almeria',
//     collector: { apertureWidth: 2.3, focalLength: 0.76 },
//     receiver: { absorberDiameter: 0.035, envelope: { outerDiameter: 0.065 } } });
//   save(d, 'dairy-trough.linefocus.json');
//
// Each builder starts from the design a new collector of that type gets in the app, deep-merges your changes, and
// validates the result with the app's loader. A wrong field or value throws with its path, for example
// "collector.focalLength: must be at least 0.02 m and at most 6 m". Lengths are metres, angular errors milliradians,
// angles degrees, and shares fractions from 0 to 1, exactly as in the file.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { core } from './checkout.mjs';

const model = await core('model.js');
const { SITES } = await core('sites.js');
const { parseEpw } = await core('solar.js');

export { SITES };

const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Deep merge: objects merge key by key, everything else replaces. */
function merge(base, change) {
  if (!isObject(change)) return change;
  const out = { ...base };
  for (const [k, v] of Object.entries(change)) out[k] = isObject(v) && isObject(base?.[k]) ? merge(base[k], v) : v;
  return out;
}

/**
 * Site from an example name ('almeria', 'daggett', 'ouarzazate', 'upington') or a full site object.
 * @param {string | { name: string, latitude: number, longitude: number, timezone: number, elevation: number }} site
 */
export function site(site) {
  if (typeof site !== 'string') return site;
  const found = SITES.find(s => s.key === site.toLowerCase() || s.name.toLowerCase().startsWith(site.toLowerCase()));
  if (!found) throw new Error(`Unknown site "${site}". Use one of ${SITES.map(s => s.key).join(', ')}, or give { name, latitude, longitude, timezone, elevation }.`);
  const { key, ...rest } = found;
  return rest;
}

/**
 * Hourly weather from an EnergyPlus (EPW) file. Returns the file's site and its 8,760 hours of DNI.
 * @param {string} path
 */
export function epw(path) {
  return parseEpw(readFileSync(path, 'utf8'), path.split(/[\\/]/).pop() ?? path);
}

/** A stable id from the title, so the same script always writes the same file. @param {string} title */
function stableId(title) {
  return 'design_' + createHash('sha256').update(title).digest('hex').slice(0, 16);
}

/**
 * @param {'trough' | 'fresnel' | 'cpc'} type
 * @param {object} options title, notes, collector, receiver, optics, sun, site, weather, mounting, designPoint, simulation
 */
export function design(type, options = {}) {
  const base = model.defaultDesign();
  model.switchVariant(base, 'collector', type);
  const { title = `Untitled ${model.COLLECTOR_TITLES[type]}`, site: siteOption, weather, receiver, sun, ...rest } = options;
  let d = merge(base, rest);
  d.title = title;
  d.id = stableId(title);
  // A receiver of another type starts from that type's defaults; a sunshape of another shape replaces the old one.
  if (receiver) d.receiver = merge(receiver.type && receiver.type !== d.receiver.type ? model.defaultReceiver(receiver.type) : d.receiver, receiver);
  if (sun) d.sun = sun.shape && sun.shape !== d.sun.shape ? sun : merge(d.sun, sun);
  if (siteOption) {
    d.site = site(siteOption);
    // A fixed CPC faces the equator at its site unless a tilt was given.
    if (type === 'cpc' && rest.mounting?.tiltDeg === undefined) d.mounting.tiltDeg = Math.round(d.site.latitude);
  }
  if (weather === 'clear-sky') d.weather = { source: 'clear-sky' };
  else if (weather?.source === 'epw' || weather?.weather) {
    const w = weather.weather ?? weather;
    d.weather = w;
    if (weather.site && !siteOption) d.site = weather.site;
  }
  try {
    return model.validateDesign(d);
  } catch (error) {
    throw new Error(`The design is not valid. ${error.message}`);
  }
}

/** Parabolic trough. See design() for options. */
export const trough = options => design('trough', options);
/** Linear Fresnel reflector. See design() for options. */
export const fresnel = options => design('fresnel', options);
/** Compound parabolic concentrator. See design() for options. */
export const cpc = options => design('cpc', options);

/** Writes a design in the app's own canonical JSON. @param {object} d @param {string} path */
export function save(d, path) {
  writeFileSync(path, model.serializeDesign(model.validateDesign(d)));
  return path;
}

/** Reads and validates a design file with the app's loader. @param {string} path */
export function load(path) {
  return model.parseDesign(readFileSync(path, 'utf8'));
}
