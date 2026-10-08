// The linefocus agent skill (.claude/skills/linefocus) builds and measures designs with this checkout's model,
// tracer and studies. These tests catch a change to src/core that would make the skill write files the app won't
// open, or report numbers the app doesn't show.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseDesign, serializeDesign } from '../src/core/model.js';

const SKILL = '.claude/skills/linefocus';
const env = { ...process.env, LINEFOCUS: process.cwd() };
const run = (script, args) => spawnSync(process.execPath, [join(SKILL, script), ...args], { env, encoding: 'utf8' });

test('the skill example writes designs the app loads unchanged, byte for byte the same every time', () => {
  const [a, b] = [mkdtempSync(join(tmpdir(), 'lf-skill-')), mkdtempSync(join(tmpdir(), 'lf-skill-'))];
  for (const dir of [a, b]) execFileSync(process.execPath, [join(SKILL, 'examples/process-heat-trough.mjs'), dir], { env });
  for (const name of ['dairy-trough.linefocus.json', 'dairy-lfr.linefocus.json']) {
    const text = readFileSync(join(a, name), 'utf8');
    assert.equal(serializeDesign(parseDesign(text)), text, name);
    assert.equal(readFileSync(join(b, name), 'utf8'), text, `${name} is deterministic`);
  }
});

test('the builder names the field when a value is out of range', async () => {
  const { trough } = await import(`../${SKILL}/scripts/linefocus.mjs`);
  assert.throws(() => trough({ collector: { focalLength: 40 } }), /collector\.focalLength/);
  assert.throws(() => trough({ receiver: { type: 'flat' } }), /receiver\.type/);
});

test('verify.mjs reports a valid design and refuses a broken one', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lf-skill-'));
  execFileSync(process.execPath, [join(SKILL, 'examples/process-heat-trough.mjs'), dir], { env });
  const good = run('scripts/verify.mjs', [join(dir, 'dairy-trough.linefocus.json'), '--json', join(dir, 'report.json')]);
  assert.equal(good.status, 0, good.stderr);
  assert.match(good.stdout, /Loads in Linefocus unchanged/);
  const report = JSON.parse(readFileSync(join(dir, 'report.json'), 'utf8'));
  assert.ok(report.designPoint.efficiency > 0.8 && report.year.kWhPerM2Aperture > 1000);
  writeFileSync(join(dir, 'broken.linefocus.json'), '{"format":"linefocus.design","version":1}');
  const bad = run('scripts/verify.mjs', [join(dir, 'broken.linefocus.json')]);
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /refuses to open/);
});

test('optimise.mjs runs the app\'s optimiser and reports against noise', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lf-skill-'));
  execFileSync(process.execPath, [join(SKILL, 'examples/process-heat-trough.mjs'), dir], { env });
  const r = run('scripts/optimise.mjs', [join(dir, 'dairy-trough.linefocus.json'), '--objective', 'efficiency', '--vary', 'collector.focalLength=0.6..1.2', '--evaluations', '12']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /collector\.focalLength: 0\.76 → /);
  assert.match(r.stdout, /Confirmed|No gain beyond sampling noise/);
});
