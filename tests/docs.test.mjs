import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ORACLE_CASES } from './oracle/cases.mjs';

const physics = readFileSync(new URL('../docs/PHYSICS.md', import.meta.url), 'utf8');

test('the physics doc counts the Ray Optics oracle scenes correctly', () => {
  assert.ok(physics.includes(`${ORACLE_CASES.length} scenes are traced by Linefocus and by`), `docs/PHYSICS.md should say ${ORACLE_CASES.length} scenes`);
});
