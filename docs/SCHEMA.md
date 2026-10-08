# Design file format

A Linefocus design is a JSON file, usually named `<title>.linefocus.json`. The [JSON Schema](../schema/linefocus.design.v1.schema.json) (draft 2020-12) describes its structure and value ranges. This page covers what the schema cannot express.

## Identity

Every file starts with `"format": "linefocus.design"` and `"version": 1`. The app refuses anything else and names the problem. It refuses files from other apps and files from a newer format version.

## Units

Lengths are metres, angular errors are milliradians, sun angles and acceptance angles are degrees, irradiance is W/m², and shares (reflectance, transmittance, absorptance, truncation) are fractions from 0 to 1. The app shows some values in friendlier units, such as millimetres and percent. Files always store the units listed here.

## Strictness

Unknown keys, missing required keys, wrong types and out-of-range numbers are errors. The loader never fills in, clamps or coerces a value. Keys named `__proto__`, `constructor` or `prototype` are rejected wherever they appear.

## Rules across fields

The loader checks these after the schema. The same rules run before every edit commits in the app (`designRuleViolations` in `src/core/model.js`).

| Rule | Field reported |
|---|---|
| A parabolic trough uses a tube receiver | `receiver.type` |
| A glass envelope's bore is wider than the absorber: outer diameter − 2 × thickness in physical mode, the outer diameter in fixed mode | `receiver.envelope.outerDiameter` |
| A trough's receiver, including its envelope, is narrower than its aperture | `receiver.absorberDiameter` |
| Linear Fresnel rows don't overlap: the pitch is at least the mirror width | `collector.pitch` |
| A cylindrical row's radius is more than half its width | `collector.curvatureRadius` |
| A trapezoidal cavity's mouth is wider than the receiver | `collector.secondary.mouthWidth` |

## Unions

Some objects take one of several shapes, chosen by a tag field:

| Object | Tag | Values |
|---|---|---|
| `collector` | `type` | `trough`, `fresnel`, `cpc` |
| `receiver` | `type` | `tube`, `flat` |
| `collector.secondary` (Fresnel only) | `kind` | `none`, `trapezoid` |
| `sun` | `shape` | `pillbox`, `gaussian`, `buie` |
| `weather` | `source` | `clear-sky`, `epw` (with 8,760 hourly DNI values) |

## Versioning

Within version 1, the format only gains optional fields, so every version 1 file stays readable. A change that would break an existing file needs version 2, with a new schema `$id`, and the loader must go on reading version 1.

## Example

`defaultDesign()` in `src/core/model.js` is the design a new trough starts from. Download it from the app to see a complete file.
