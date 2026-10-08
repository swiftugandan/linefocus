/** A small declarative schema language. One specification drives three things: strict validation of design
 * documents, the published JSON Schema, and the labels, units and ranges the inspector shows. */

/**
 * Display unit for a number field. The document stores SI base units; `factor` converts to the display unit.
 * @typedef {{ unit: string, factor: number, digits: number }} Display
 */

/**
 * @typedef {{ kind: 'number', label: string, unit: string, min: number, max: number, exclusiveMin?: boolean, exclusiveMax?: boolean,
 *   integer?: boolean, display?: Display, step?: number, help?: string }} NumberSpec
 * @typedef {{ kind: 'string', label: string, maxLength: number, pattern?: RegExp, help?: string }} StringSpec
 * @typedef {{ kind: 'const', value: string | number }} ConstSpec
 * @typedef {{ kind: 'enum', label: string, values: string[], labels: Record<string, string>, help?: string }} EnumSpec
 * @typedef {{ kind: 'array', label: string, items: NumberSpec, minItems: number, maxItems: number }} ArraySpec
 * @typedef {{ kind: 'object', label: string, fields: Record<string, Spec> }} ObjectSpec
 * @typedef {{ kind: 'union', label: string, tag: string, variants: Record<string, ObjectSpec>, labels: Record<string, string> }} UnionSpec
 * @typedef {NumberSpec | StringSpec | ConstSpec | EnumSpec | ArraySpec | ObjectSpec | UnionSpec} Spec
 */

/** @param {string} label @param {string} unit @param {number} min @param {number} max @param {Partial<NumberSpec>} [extra] @returns {NumberSpec} */
export const number = (label, unit, min, max, extra = {}) => ({ kind: 'number', label, unit, min, max, ...extra });
/** @param {string} label @param {number} maxLength @param {Partial<StringSpec>} [extra] @returns {StringSpec} */
export const string = (label, maxLength, extra = {}) => ({ kind: 'string', label, maxLength, ...extra });
/** @param {string | number} value @returns {ConstSpec} */
export const constant = value => ({ kind: 'const', value });
/** @param {string} label @param {Record<string, string>} labels @param {string} [help] @returns {EnumSpec} */
export const choice = (label, labels, help) => ({ kind: 'enum', label, values: Object.keys(labels), labels, ...(help ? { help } : {}) });
/** @param {string} label @param {Record<string, Spec>} fields @returns {ObjectSpec} */
export const object = (label, fields) => ({ kind: 'object', label, fields });
/** @param {string} label @param {string} tag @param {Record<string, [string, ObjectSpec]>} variants @returns {UnionSpec} */
export const union = (label, tag, variants) => ({
  kind: 'union', label, tag,
  variants: Object.fromEntries(Object.entries(variants).map(([key, [, spec]]) => [key, spec])),
  labels: Object.fromEntries(Object.entries(variants).map(([key, [name]]) => [key, name])),
});
/** @param {string} label @param {NumberSpec} items @param {number} minItems @param {number} maxItems @returns {ArraySpec} */
export const array = (label, items, minItems, maxItems) => ({ kind: 'array', label, items, minItems, maxItems });

/** Display helpers. */
export const MM = { unit: 'mm', factor: 1000, digits: 1 };
export const METRES = { unit: 'm', factor: 1, digits: 3 };
export const PERCENT = { unit: '%', factor: 100, digits: 1 };

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** A validation failure with the JSON path of the offending value. */
export class ValidationError extends Error {
  /** @param {string} path @param {string} message */
  constructor(path, message) {
    super(path ? `${path}: ${message}` : message);
    this.name = 'ValidationError';
    this.path = path;
    this.reason = message;
  }
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

/** @param {string} path @param {string} key */
const join = (path, key) => (path ? `${path}.${key}` : key);

/**
 * Validates `value` against `spec` and returns a clean deep copy. Unknown keys, missing keys, wrong types and
 * out-of-range numbers are errors: nothing is coerced or clamped.
 * @param {Spec} spec @param {unknown} value @param {string} [path]
 * @returns {unknown}
 */
export function validate(spec, value, path = '') {
  switch (spec.kind) {
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) throw new ValidationError(path, 'must be a finite number');
      if (spec.integer && !Number.isInteger(value)) throw new ValidationError(path, 'must be a whole number');
      const low = spec.exclusiveMin ? value <= spec.min : value < spec.min;
      const high = spec.exclusiveMax ? value >= spec.max : value > spec.max;
      if (low || high) throw new ValidationError(path, `must be ${rangeText(spec)}`);
      return value;
    }
    case 'string':
      if (typeof value !== 'string') throw new ValidationError(path, 'must be text');
      if (value.length > spec.maxLength) throw new ValidationError(path, `must be at most ${spec.maxLength} characters`);
      if (spec.pattern && !spec.pattern.test(value)) throw new ValidationError(path, 'has an invalid format');
      return value;
    case 'const':
      if (value !== spec.value) throw new ValidationError(path, `must be ${JSON.stringify(spec.value)}`);
      return value;
    case 'enum':
      if (typeof value !== 'string' || !spec.values.includes(value)) throw new ValidationError(path, `must be one of ${spec.values.map(v => JSON.stringify(v)).join(', ')}`);
      return value;
    case 'array': {
      if (!Array.isArray(value)) throw new ValidationError(path, 'must be a list');
      if (value.length < spec.minItems || value.length > spec.maxItems) {
        throw new ValidationError(path, spec.minItems === spec.maxItems ? `must have exactly ${spec.minItems} values` : `must have ${spec.minItems}–${spec.maxItems} values`);
      }
      return value.map((item, i) => validate(spec.items, item, `${path}[${i}]`));
    }
    case 'object': return validateObject(spec, value, path);
    case 'union': {
      if (!isPlainObject(value)) throw new ValidationError(path, 'must be an object');
      const tag = value[spec.tag];
      const variant = typeof tag === 'string' && Object.hasOwn(spec.variants, tag) ? spec.variants[tag] : null;
      if (!variant) throw new ValidationError(join(path, spec.tag), `must be one of ${Object.keys(spec.variants).map(v => JSON.stringify(v)).join(', ')}`);
      return validateObject(variant, value, path);
    }
  }
}

/** @param {ObjectSpec} spec @param {unknown} value @param {string} path */
function validateObject(spec, value, path) {
  if (!isPlainObject(value)) throw new ValidationError(path, 'must be an object');
  for (const key of Object.keys(value)) {
    if (UNSAFE_KEYS.has(key)) throw new ValidationError(join(path, key), 'is not an allowed key');
    if (!Object.hasOwn(spec.fields, key)) throw new ValidationError(join(path, key), 'is not a known field');
  }
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [key, field] of Object.entries(spec.fields)) {
    if (!Object.hasOwn(value, key)) throw new ValidationError(join(path, key), 'is missing');
    out[key] = validate(field, value[key], join(path, key));
  }
  return out;
}

/** Human description of a number range, in display units. @param {NumberSpec} spec */
export function rangeText(spec) {
  const d = spec.display ?? { unit: spec.unit, factor: 1, digits: 6 };
  /** @param {number} v */
  const fmt = v => `${+(v * d.factor).toFixed(Math.max(d.digits, 0) + 2)}`;
  const unit = d.unit ? ` ${d.unit}` : '';
  const lo = spec.exclusiveMin ? 'more than' : 'at least';
  const hi = spec.exclusiveMax ? 'less than' : 'at most';
  return `${lo} ${fmt(spec.min)}${unit} and ${hi} ${fmt(spec.max)}${unit}`;
}

/**
 * JSON Schema (draft 2020-12) for a spec.
 * @param {Spec} spec
 * @returns {Record<string, unknown>}
 */
export function toJsonSchema(spec) {
  switch (spec.kind) {
    case 'number': {
      /** @type {Record<string, unknown>} */
      const out = { type: spec.integer ? 'integer' : 'number', description: describe(spec.label, spec.unit, spec.help) };
      out[spec.exclusiveMin ? 'exclusiveMinimum' : 'minimum'] = spec.min;
      out[spec.exclusiveMax ? 'exclusiveMaximum' : 'maximum'] = spec.max;
      return out;
    }
    case 'string': return { type: 'string', maxLength: spec.maxLength, ...(spec.pattern ? { pattern: spec.pattern.source } : {}), description: describe(spec.label, '', spec.help) };
    case 'const': return { const: spec.value };
    case 'enum': return { enum: spec.values, description: describe(spec.label, '', spec.help) };
    case 'array': return { type: 'array', items: toJsonSchema(spec.items), minItems: spec.minItems, maxItems: spec.maxItems, description: spec.label };
    case 'object': return objectSchema(spec);
    case 'union': return {
      description: spec.label,
      oneOf: Object.entries(spec.variants).map(([key, variant]) => objectSchema(variant, spec.tag, key)),
    };
  }
}

/** @param {ObjectSpec} spec @param {string} [tag] @param {string} [tagValue] */
function objectSchema(spec, tag, tagValue) {
  /** @type {Record<string, unknown>} */
  const properties = {};
  for (const [key, field] of Object.entries(spec.fields)) properties[key] = key === tag ? { const: tagValue } : toJsonSchema(field);
  return { type: 'object', description: spec.label, additionalProperties: false, required: Object.keys(spec.fields), properties };
}

/** @param {string} label @param {string} unit @param {string | undefined} help */
function describe(label, unit, help) {
  return `${label}${unit ? ` (${unit})` : ''}${help ? `. ${help}` : ''}`;
}

/**
 * Looks up the spec for a dotted path inside a value, following union tags present in `value`.
 * @param {Spec} spec @param {unknown} value @param {string} path
 * @returns {Spec | null}
 */
export function specAt(spec, value, path) {
  let current = /** @type {Spec | null} */ (spec);
  let node = value;
  for (const key of path.split('.')) {
    if (!current) return null;
    if (current.kind === 'union') {
      const tag = isPlainObject(node) ? node[current.tag] : undefined;
      current = typeof tag === 'string' ? current.variants[tag] ?? null : null;
      if (!current) return null;
    }
    if (current.kind !== 'object' || !Object.hasOwn(current.fields, key)) return null;
    current = current.fields[key];
    node = isPlainObject(node) ? node[key] : undefined;
  }
  return current;
}
