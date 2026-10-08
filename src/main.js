/** Entry point: starts the engine worker and the app. */

import { LinefocusApp } from './app.js';

const worker = new Worker(new URL('./worker/engine.worker.js', import.meta.url), { type: 'module' });
const app = new LinefocusApp(worker);
/** @type {any} */ (window).linefocus = app;
app.start().catch(error => {
  console.error(error);
  document.body.dataset.bootError = error instanceof Error ? error.message : String(error);
});
