# Brand

Linefocus has its own identity, drawn from what it models: concentrated sunlight falling on a dark absorber.

## Colour

| Token | Value | Role |
|---|---|---|
| `--ink` | `#182033` | Title bar and headings. Named after the deep blue-black cermet coating on receiver tubes |
| `--sun` | `#f2a516` | Sunlight. Reserved for light, energy and the one main action on a page. Never decoration |
| `--accent` | `#2c5d99` | Steel blue for interface state: selected tabs, focus rings, links |
| `--canvas` | `#0e1625` | Night sky behind the cross-section, so traced light reads as light |
| neutrals | `#eceff4` to `#ffffff` | Cool greys for panels and lines |

Ray colours on the canvas encode where each ray ended: gold for absorbed, coral for spilled, cyan for reflected by glass, grey for shaded or missed. The absorber flux ring uses a heat ramp from deep amber to near-white. Errors use red and warnings amber, and neither is used for anything else. Dark mode keeps the same roles with its own values (`:root[data-theme="dark"]` in `style.css`).

## Type

One family: [Archivo](https://github.com/Omnibus-Type/Archivo), a variable grotesque with weight and width axes, under the SIL Open Font License (`brand/fonts/`). Wide settings (about 110–122%) carry the wordmark, headlines and big result figures. The normal width carries the interface, and a slightly condensed width carries field labels. Columns of numbers use tabular figures. Labels are in sentence case.

## Mark

A trough section in the ink or light colour, with three gold rays meeting at a gold focus (`favicon.svg` and the `#mark` symbol in `index.html`).
