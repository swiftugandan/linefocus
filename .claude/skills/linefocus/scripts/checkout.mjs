// Find a Linefocus checkout, so the builder, verifier and optimiser use the app's own model, tracer and studies
// rather than copies that drift.
//
// Looks in this order: $LINEFOCUS, a checkout this script sits inside (the copy at .claude/skills/linefocus in the
// Linefocus repository needs nothing else), then a shallow clone of the public repository into a temp cache. Run
// directly, it prints the path, which is how preview.py finds it.
import { execFileSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_URL = 'https://github.com/swiftugandan/linefocus';
const isCheckout = dir => existsSync(join(dir, 'src/core/model.js')) && existsSync(join(dir, 'src/core/tracer.js')) && existsSync(join(dir, 'serve.mjs'));

function enclosingCheckout() {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    if (isCheckout(dir)) return dir;
    const parent = resolve(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export function linefocusCheckout() {
  if (process.env.LINEFOCUS) {
    const dir = resolve(process.env.LINEFOCUS);
    if (!isCheckout(dir)) throw new Error(`LINEFOCUS=${dir} is not a Linefocus checkout (no src/core/model.js, src/core/tracer.js and serve.mjs).`);
    return dir;
  }
  const local = enclosingCheckout();
  if (local) return local;
  const dir = join(tmpdir(), 'linefocus-src');
  if (!isCheckout(dir)) {
    rmSync(dir, { recursive: true, force: true });
    process.stderr.write(`cloning ${REPO_URL} ...\n`);
    try {
      execFileSync('git', ['clone', '--depth', '1', '--quiet', REPO_URL, dir], { stdio: ['ignore', 'ignore', 'inherit'] });
    } catch {
      throw new Error(`Could not clone ${REPO_URL}. If you already have a checkout, point at it instead:  LINEFOCUS=/path/to/linefocus`);
    }
  }
  return dir;
}

/** Imports a module from the checkout, for example core('model.js'). @param {string} name */
export async function core(name) {
  return import(pathToFileURL(join(linefocusCheckout(), 'src', 'core', name)).href);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.stdout.write(linefocusCheckout() + '\n'); }
  catch (error) { console.error(error.message); process.exit(2); }
}
