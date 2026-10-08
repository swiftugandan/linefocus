#!/usr/bin/env node
/** Writes schema/linefocus.design.v1.schema.json from the design spec. Run after changing src/core/model.js. */
import { writeFileSync } from 'node:fs';
import { designJsonSchema } from '../src/core/schema.js';
import { FORMAT_VERSION } from '../src/core/model.js';

const path = new URL(`../schema/linefocus.design.v${FORMAT_VERSION}.schema.json`, import.meta.url);
writeFileSync(path, JSON.stringify(designJsonSchema(), null, 2) + '\n');
console.log(`Wrote ${path.pathname}`);
