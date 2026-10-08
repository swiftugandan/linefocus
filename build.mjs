#!/usr/bin/env node
/** Builds dist/Linefocus.html: the whole app in one offline file. Modules are wrapped in a tiny require registry,
 * the engine worker runs from a Blob URL, and the stylesheet, font and favicon are inlined.
 *
 * This is not a general bundler. It supports the subset the source uses: single-line `import { … } from '…'`
 * statements and `export function|class|const|let` declarations. Anything else fails the build. */

import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));

/** @param {string} dir @returns {Promise<string[]>} */
async function collect(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await collect(path));
    else if (entry.name.endsWith('.js')) out.push(path);
  }
  return out;
}

/** @param {string} spec @param {string} base */
function resolveId(spec, base) {
  const parts = (spec.startsWith('/') ? spec : base.slice(0, base.lastIndexOf('/') + 1) + spec).split('/');
  const out = [];
  for (const p of parts) { if (p === '..') out.pop(); else if (p && p !== '.') out.push(p); }
  return '/' + out.join('/');
}

/** Transforms every module and records its dependencies. */
export async function loadModules() {
  /** @type {Map<string, { code: string, deps: string[] }>} */
  const modules = new Map();
  for (const file of await collect(join(root, 'src'))) {
    const id = '/' + relative(root, file).replaceAll('\\', '/');
    let source = await readFile(file, 'utf8');
    const exported = [...source.matchAll(/^export\s+(?:async\s+)?(?:function|class|const|let)\s+(\w+)/gm)].map(m => m[1]);
    /** @type {string[]} */
    const deps = [];
    source = source
      .replace(/^import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"];?[ \t]*$/gm, (_, names, spec) => {
        deps.push(resolveId(spec, id));
        return `const {${names.replace(/\s+as\s+/g, ': ')}} = require(${JSON.stringify(spec)});`;
      })
      .replace(/^export\s*\{\s*\};?[ \t]*$/gm, '')
      .replace(/^export\s+(?=(?:async\s+)?(?:function|class|const|let)\s)/gm, '')
      .replace("new Worker(new URL('./worker/engine.worker.js', import.meta.url), { type: 'module' })", 'new Worker(globalThis.__LINEFOCUS_WORKER_URL__)');
    // Check code only: JSDoc type imports such as import('./types.js').Shape are fine.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    if (/^\s*(import|export)\s|\bimport\.meta\b|\bimport\(/m.test(code)) throw new Error(`Unsupported module syntax in ${id}`);
    modules.set(id, { code: `function(module, exports, require){\n'use strict';\n${source}\nObject.assign(exports, {${exported.join(',')}});\n}`, deps });
  }
  return modules;
}

/** @param {Map<string, { code: string, deps: string[] }>} modules @param {string} entry */
function closure(modules, entry) {
  const seen = new Set(), stack = [entry];
  while (stack.length) {
    const id = /** @type {string} */ (stack.pop());
    if (seen.has(id)) continue;
    const mod = modules.get(id);
    if (!mod) throw new Error(`Missing module ${id}`);
    seen.add(id);
    stack.push(...mod.deps);
  }
  return [...seen].sort();
}

/** @param {Map<string, { code: string, deps: string[] }>} modules @param {string[]} ids @param {string} entry */
function program(modules, ids, entry) {
  return `(()=>{const factories={${ids.map(id => `${JSON.stringify(id)}:${modules.get(id)?.code}`).join(',\n')}};const cache=Object.create(null);
function norm(spec,base){const parts=(spec.startsWith('/')?spec:base.slice(0,base.lastIndexOf('/')+1)+spec).split('/'),out=[];for(const p of parts){if(p==='..')out.pop();else if(p&&p!=='.')out.push(p);}return '/'+out.join('/');}
function req(spec,base){const id=norm(spec,base);if(cache[id])return cache[id].exports;const f=factories[id];if(!f)throw new Error('Unknown bundled module '+id);const m={exports:{}};cache[id]=m;f(m,m.exports,next=>req(next,id));return m.exports;}
req(${JSON.stringify(entry)},'/');})();`;
}

/** Builds the single-file HTML and returns it. */
export async function buildApp() {
  const modules = await loadModules();
  const worker = program(modules, closure(modules, '/src/worker/engine.worker.js'), '/src/worker/engine.worker.js');
  const app = program(modules, closure(modules, '/src/main.js'), '/src/main.js');
  const bundle = `globalThis.__LINEFOCUS_WORKER_URL__=URL.createObjectURL(new Blob([${JSON.stringify(worker)}],{type:'text/javascript'}));\n${app}`.replace(/<\/script/gi, '<\\/script');
  const font = (await readFile(join(root, 'brand/fonts/archivo-latin-wdth-normal.woff2'))).toString('base64');
  const css = (await readFile(join(root, 'style.css'), 'utf8')).replace('url("./brand/fonts/archivo-latin-wdth-normal.woff2")', `url(data:font/woff2;base64,${font})`);
  const favicon = await readFile(join(root, 'favicon.svg'), 'utf8');
  let html = await readFile(join(root, 'index.html'), 'utf8');
  const swaps = /** @type {[string, string][]} */ ([
    ['<link rel="stylesheet" href="./style.css">', `<style>${css}</style>`],
    ['href="./favicon.svg"', `href="data:image/svg+xml,${encodeURIComponent(favicon)}"`],
    ['<script type="module" src="./src/main.js"></script>', `<script>${bundle}</script>`],
  ]);
  for (const [from, to] of swaps) {
    if (!html.includes(from)) throw new Error(`index.html no longer contains ${from}`);
    html = html.replace(from, () => to);
  }
  return html;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const html = await buildApp();
  await mkdir(join(root, 'dist'), { recursive: true });
  await writeFile(join(root, 'dist', 'Linefocus.html'), html);
  console.log(`Built dist/Linefocus.html (${(Buffer.byteLength(html) / 1024).toFixed(1)} KiB)`);
}
