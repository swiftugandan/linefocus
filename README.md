# Linefocus

Linefocus is a browser app for designing line-focus solar collectors. It traces sunlight through the collector's cross-section, ray by ray, and shows where every watt goes. You can see how much reaches the absorber and how much is lost to the mirror, the glass, the absorber's own reflection or spillage. There is nothing to install, no account and no server. Your design stays on your computer.

Today Linefocus designs parabolic troughs. Linear Fresnel reflectors and compound parabolic concentrators are being built next.

**Try it:** [swiftugandan.github.io/linefocus](https://swiftugandan.github.io/linefocus/), or download `Linefocus.html` from the same page and open it offline.

## Run it on your machine

You need Node.js 22 or later.

```sh
npm install          # installs TypeScript, used only for type checking
npm start            # http://127.0.0.1:8765/
```

The app runs straight from `src/` with no build step. `npm run build` writes the single-file app to `dist/Linefocus.html`.

## Using it

**Change the design.** Every value lives in the Design panel on the right, in the units engineers use: metres for the trough, millimetres for the receiver, milliradians for optical errors. Type a value, use the arrow keys to step it, or drag a field's label to scrub it (Shift for ×10, Alt for ×0.1).

**Shape it on the canvas.** Drag the white handles to change the aperture width or the focal length, and drag the sun to tilt the light. Drag empty space to pan and scroll to zoom. Each drag is one undo step, and Esc cancels a drag.

**Read the results.** The dock under the canvas shows the optical efficiency, the intercept factor, the absorbed power per metre and the peak concentration. It also shows where the sunlight goes and the flux around the absorber. Each chart has a table view.

**Find any command** with Ctrl+K.

| Action | Keys |
|---|---|
| Find a command | Ctrl+K |
| Undo, redo | Ctrl+Z, Ctrl+Shift+Z |
| Download the design | Ctrl+S |
| Open a design file | Ctrl+O, or drop a file on the window |
| Trace again | T |
| Fit to view | F, or double-click the canvas |
| Help | F1 or ? |

## Saving and files

The design saves itself in your browser as you work. The title bar says "Saved on this device" when it is up to date. Browser storage can be cleared, so download the design (Ctrl+S) to keep a copy. Design files are plain JSON ending in `.linefocus.json`. They are described by a published [JSON Schema](schema/linefocus.design.v1.schema.json) and the rules in [docs/SCHEMA.md](docs/SCHEMA.md).

**Open in Ray Optics** downloads the cross-section as a scene for [Ray Optics Simulation](https://phydemo.app/ray-optics/), the open-source optics sandbox this project grew out of. Open it there with File, then Open.

## How the physics works

[docs/PHYSICS.md](docs/PHYSICS.md) defines every quantity Linefocus reports: the coordinate frame, the sun and error models, the energy ledger, the collector geometry and the validation. It is the authority. If the code and that page disagree, the code is wrong.

## For developers

| If you want to change… | Look in |
|---|---|
| The physics: tracing, materials, the ledger | `src/core/tracer.js`, `src/core/geometry.js` |
| Collector and receiver geometry | `src/core/collectors/` |
| The design file format, defaults and rules | `src/core/model.js` (the field spec drives the validator, the schema and the inspector) |
| Undo and redo | `src/core/history.js` |
| Background tracing | `src/worker/` |
| The canvas | `src/render/view.js`, `src/ui/canvas-interactions.js` |
| The design panel | `src/ui/inspector.js` |
| Results and charts | `src/ui/design-point-view.js`, `src/ui/charts.js` |
| Ribbon, commands, dialogs | `src/app.js`, `src/ui/shell.js` |
| Colours and type | `style.css` (see [docs/BRAND.md](docs/BRAND.md)) |
| The marketing page | `site/index.html`, `scripts/site-data.mjs` |

[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) explains how the pieces fit together.

### Checks and tests

```sh
npm run check        # strict type checking of the JSDoc-typed source (page and worker separately)
npm test             # physics, model, history, schema and Ray Optics oracle tests
python3 tests/browser_test.py   # end-to-end checks in Chromium; needs `npm start` running
```

The browser test needs Python Playwright (`pip install playwright==1.57.0 && playwright install chromium`). Set `CHROMIUM_PATH` to use a Chromium you already have, and `LINEFOCUS_URL` to test another address. It writes screenshots and a report to `test-results/`.

### Generated files

Two committed files are generated. Regenerate them instead of editing them:

- `schema/linefocus.design.v1.schema.json`: run `node scripts/build-schema.mjs` after changing the field spec in `src/core/model.js`. A test fails if it is out of date.
- `tests/oracle/*.scene.json` and `goldens.json`: run `node scripts/ray-optics-oracle.mjs` after changing the Ray Optics exporter or the oracle cases. It clones and builds Ray Optics Simulation at a pinned commit.
- `site/editor.png`: run `python3 scripts/capture-screenshot.py` with `npm start` running.

### Deployment

Every push to `main` runs `.github/workflows/pages.yml`. It type-checks, runs the tests, builds the site with `npm run build:pages`, runs the browser tests against the built app, and publishes `_site/` to GitHub Pages:

| Path | Content |
|---|---|
| `/` | Marketing page, with figures computed by the engine at build time |
| `/app/` | The app |
| `/Linefocus.html` | The app as one offline file |
| `/schema/` | The design file schema |
| `/build-info.json` | Version and source commit |

## What it doesn't do

- It designs parabolic troughs only, for now.
- It traces a 2D cross-section of an infinitely long collector. End losses are an analytic correction.
- Mirrors are specular with Gaussian errors. It does not model dust or diffuse scattering.
- It reports absorbed optical power, not heat loss or fluid temperature.
- It is for concept design and comparison. Check final designs with an established tool such as SolTrace or Tonatiuh.

## Licence

Apache License 2.0. The Archivo typeface is under the SIL Open Font License (`brand/fonts/OFL.txt`).
