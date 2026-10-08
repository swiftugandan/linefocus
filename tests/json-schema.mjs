/** A strict validator for the JSON Schema subset Linefocus publishes. It throws on any keyword it does not
 * implement, so the schema can't quietly grow constraints the tests never check. */

const KNOWN = new Set(['$schema', '$id', 'title', 'description', 'type', 'const', 'enum', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum',
  'maxLength', 'pattern', 'required', 'additionalProperties', 'properties', 'oneOf', 'items', 'minItems', 'maxItems']);

export function schemaErrors(schema, value, path = '$') {
  for (const key of Object.keys(schema)) if (!KNOWN.has(key)) throw new Error(`Unsupported schema keyword ${key} at ${path}`);
  const errors = [];
  if ('const' in schema && value !== schema.const) errors.push(`${path}: expected ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${path}: not in enum`);
  if (schema.oneOf) {
    const matches = schema.oneOf.filter(s => schemaErrors(s, value, path).length === 0).length;
    if (matches !== 1) errors.push(`${path}: matches ${matches} of oneOf`);
  }
  if (schema.type) {
    const ok = schema.type === 'integer' ? Number.isInteger(value)
      : schema.type === 'number' ? typeof value === 'number' && Number.isFinite(value)
        : schema.type === 'array' ? Array.isArray(value)
          : schema.type === 'object' ? value !== null && typeof value === 'object' && !Array.isArray(value)
            : typeof value === schema.type;
    if (!ok) return [...errors, `${path}: expected ${schema.type}`];
  }
  if (typeof value === 'number') {
    if ('minimum' in schema && value < schema.minimum) errors.push(`${path}: below minimum`);
    if ('maximum' in schema && value > schema.maximum) errors.push(`${path}: above maximum`);
    if ('exclusiveMinimum' in schema && value <= schema.exclusiveMinimum) errors.push(`${path}: not above exclusive minimum`);
    if ('exclusiveMaximum' in schema && value >= schema.exclusiveMaximum) errors.push(`${path}: not below exclusive maximum`);
  }
  if (typeof value === 'string') {
    if ('maxLength' in schema && [...value].length > schema.maxLength) errors.push(`${path}: too long`);
    if (schema.pattern && !new RegExp(schema.pattern, 'u').test(value)) errors.push(`${path}: pattern`);
  }
  if (Array.isArray(value)) {
    if ('minItems' in schema && value.length < schema.minItems) errors.push(`${path}: too few items`);
    if ('maxItems' in schema && value.length > schema.maxItems) errors.push(`${path}: too many items`);
    if (schema.items) value.forEach((item, i) => errors.push(...schemaErrors(schema.items, item, `${path}[${i}]`)));
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of schema.required ?? []) if (!(key in value)) errors.push(`${path}.${key}: required`);
    for (const [key, item] of Object.entries(value)) {
      if (schema.properties?.[key]) errors.push(...schemaErrors(schema.properties[key], item, `${path}.${key}`));
      else if (schema.additionalProperties === false) errors.push(`${path}.${key}: additional property`);
    }
  }
  return errors;
}
