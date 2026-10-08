#!/usr/bin/env node
/** Regenerates the Ray Optics golden results in tests/oracle/. It traces each oracle case with Ray Optics
 * Simulation at a pinned commit and records the fraction of beam power that reaches the absorber.
 *
 * Usage: node scripts/ray-optics-oracle.mjs [path/to/ray-optics/dist-node/rayOptics.js]
 * Without a path, it clones and builds the pinned commit into .cache/ray-optics (needs git and npm). */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toRayOptics } from '../src/core/rayoptics.js';
import { ORACLE_CASES } from '../tests/oracle/cases.mjs';

export const RAY_OPTICS_COMMIT = 'daf76772c73a85e1a2568c4e2e71613bba1fab77';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function rayOpticsModule() {
  if (process.argv[2]) return resolve(process.argv[2]);
  const checkout = join(root, '.cache', 'ray-optics');
  const built = join(checkout, 'dist-node', 'rayOptics.js');
  if (existsSync(built)) return built;
  mkdirSync(join(root, '.cache'), { recursive: true });
  const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: 'inherit' });
  if (!existsSync(checkout)) run('git', ['clone', 'https://github.com/ricktu288/ray-optics.git', checkout], root);
  run('git', ['checkout', RAY_OPTICS_COMMIT], checkout);
  run('npm', ['install', '--no-optional', '--ignore-scripts'], checkout);
  run('npm', ['run', 'build-node'], checkout);
  return built;
}

const require = createRequire(import.meta.url);
const rayOptics = require(rayOpticsModule());

async function run(json) {
  const scene = new rayOptics.Scene();
  await new Promise(done => scene.loadJSON(JSON.stringify(json), (_, completed) => { if (completed) done(); }));
  if (scene.error) throw new Error(scene.error);
  const simulator = new rayOptics.Simulator(scene, null, null, null, null, null, false, 1e8);
  await new Promise(done => {
    simulator.eventListeners = {};
    simulator.on('simulationComplete', done);
    simulator.on('simulationStop', done);
    simulator.updateSimulation(false, false);
  });
  if (simulator.error) throw new Error(simulator.error);
  const detectors = scene.objs.filter(o => o.constructor.type === 'Detector');
  return { detectors, warning: simulator.warning, rays: simulator.processedRayCount };
}

const goldens = {};
for (const c of ORACLE_CASES) {
  const { json } = toRayOptics(c.scene, { sun: c.sun, transversalDeg: c.transversalDeg, name: c.name, rayDensity: 4 });
  writeFileSync(join(root, 'tests', 'oracle', `${c.name}.scene.json`), JSON.stringify(json, null, 2) + '\n');
  // Measure the beam's total power with a transparent detector just downstream of the beam, in the same direction.
  const beam = json.objs[0];
  const ex = beam.p2.x - beam.p1.x, ey = beam.p2.y - beam.p1.y, el = Math.hypot(ex, ey);
  const ox = ey / el, oy = -ex / el;
  const probe = structuredClone(json);
  probe.objs.push({ type: 'Detector', p1: { x: beam.p1.x + ox, y: beam.p1.y + oy }, p2: { x: beam.p2.x + ox, y: beam.p2.y + oy }, twoSided: false });
  const { detectors, warning, rays } = await run(probe);
  const absorbed = detectors[0].power, total = detectors.at(-1).power;
  if (!(total > 0)) throw new Error(`${c.name}: no beam power measured`);
  goldens[c.name] = { fraction: absorbed / total, rays, ...(warning ? { warning } : {}) };
  console.log(`${c.name}: ${(absorbed / total).toFixed(5)} of beam power on the absorber (${rays} rays)`);
}
writeFileSync(join(root, 'tests', 'oracle', 'goldens.json'), JSON.stringify({ rayOpticsCommit: RAY_OPTICS_COMMIT, cases: goldens }, null, 2) + '\n');
