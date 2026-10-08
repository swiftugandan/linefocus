#!/usr/bin/env node
/** Builds the GitHub Pages site into _site/: the marketing page at /, the app at /app/, the single-file download,
 * the published schema and example designs, and build-info.json. */

import { readFile, writeFile, mkdir, rm, cp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildApp } from './build.mjs';
import { heroSvg, ledgerNumbers, oracleAgreement, agentSample } from './scripts/site-data.mjs';
import { APP_VERSION } from './src/core/model.js';

const root = dirname(fileURLToPath(import.meta.url));
const out = join(root, '_site');
export const REPO_URL = 'https://github.com/swiftugandan/linefocus';

/** @param {number} v @param {number} d */
const pct = (v, d = 1) => `${(v * 100).toFixed(d)}%`;

export async function buildSite() {
  const app = await buildApp();
  const ledger = ledgerNumbers();
  const oracle = oracleAgreement();
  const favicon = `data:image/svg+xml,${encodeURIComponent(await readFile(join(root, 'favicon.svg'), 'utf8'))}`;
  const rows = ledger.rows.map(([label, share], i) => `<div class="bar${i === 0 ? ' hit' : ''}"><span>${label}</span><span class="track"><span class="fill" style="display:block;width:${(share * 100).toFixed(2)}%"></span></span><span class="value">${pct(share)}</span></div>`).join('\n        ');
  const values = {
    version: APP_VERSION, repo: REPO_URL, favicon, hero: heroSvg(), ledger: rows,
    agentSample: agentSample(),
    efficiency: pct(ledger.efficiency), oracleCases: String(oracle.cases), oracleWorst: oracle.worst < 0.0001 ? '< 0.0001' : oracle.worst.toFixed(4),
  };
  let page = await readFile(join(root, 'site', 'index.html'), 'utf8');
  page = page.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    if (!(key in values)) throw new Error(`site/index.html uses unknown placeholder ${match}`);
    return values[/** @type {keyof typeof values} */ (key)];
  });
  await rm(out, { recursive: true, force: true });
  await mkdir(join(out, 'app'), { recursive: true });
  await mkdir(join(out, 'fonts'), { recursive: true });
  await writeFile(join(out, 'index.html'), page);
  await writeFile(join(out, 'app', 'index.html'), app);
  await writeFile(join(out, 'Linefocus.html'), app);
  await cp(join(root, 'brand', 'fonts', 'archivo-latin-wdth-normal.woff2'), join(out, 'fonts', 'archivo.woff2'));
  if (existsSync(join(root, 'site', 'editor.png'))) await cp(join(root, 'site', 'editor.png'), join(out, 'editor.png'));
  await cp(join(root, 'favicon.svg'), join(out, 'favicon.svg'));
  await cp(join(root, 'schema'), join(out, 'schema'), { recursive: true });
  if (existsSync(join(root, 'examples'))) await cp(join(root, 'examples'), join(out, 'examples'), { recursive: true });
  await writeFile(join(out, 'build-info.json'), JSON.stringify({ name: 'linefocus', version: APP_VERSION, sourceRevision: process.env.GITHUB_SHA ?? null }, null, 2) + '\n');
  await writeFile(join(out, '.nojekyll'), '');
  return { efficiency: ledger.efficiency, oracle };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const info = await buildSite();
  console.log(`Built _site/ (optical efficiency on the page ${pct(info.efficiency)}, Ray Optics agreement ${info.oracle.worst.toExponential(1)})`);
}
