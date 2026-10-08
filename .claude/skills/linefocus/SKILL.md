---
name: linefocus
description: Design and analyse line-focus solar collectors (parabolic troughs, linear Fresnel reflectors, compound parabolic concentrators) as Linefocus design files (.linefocus.json), checked and measured with the app's own ray tracer, studies and optimiser, and previewed in the real app. Use this whenever someone wants a solar concentrator, CSP collector, solar process-heat collector, trough, LFR or CPC sized, designed, compared, optimised or explained with numbers; asks for optical efficiency, intercept factor, acceptance angle, incidence angle modifiers or annual yield of such a collector; mentions Linefocus (github.com/swiftugandan/linefocus or swiftugandan.github.io/linefocus); or asks for a .linefocus.json file.
---

# Line-focus solar collectors in Linefocus

Linefocus is a browser app that designs linear solar concentrators by tracing sunlight through their cross-section.
Its native file, `.linefocus.json`, is plain JSON holding the engineer's intent: collector geometry, receiver,
mirror optics, sunshape, site, weather, mounting, design point and ray count. This skill builds that file with the
app's own model, then measures it with the app's own tracer and studies, so every number you report is the number
the person will see when they open the file in Linefocus.

Nothing physical lives in this skill. The scripts import `src/core/` from a Linefocus checkout (found by
`scripts/checkout.mjs`). `docs/PHYSICS.md` in that checkout defines every figure and is the authority when you
explain one. `references/design-guide.md` here holds typical parameter ranges and how to read the results.

## Workflow

**1. Pin down the brief.** Find out what the heat is for (power, industrial process heat, building heat), the
temperature or output needed, the site, and any fixed constraints (a receiver the client already buys, land width,
row length, budget for tracking). Ask only for what changes the design; sensible defaults cover the rest. A tracking
trough suits medium and high temperatures; an LFR trades optical efficiency for cheap land and low structures; a
stationary CPC with an evacuated tube suits low temperatures without tracking.

**2. Choose starting values** from `references/design-guide.md`. Start from a known class of collector, not from
nothing.

**3. Write a generator script** next to the output, importing the builder from wherever this skill lives:

```js
import { trough, save } from '/path/to/skills/linefocus/scripts/linefocus.mjs';

const d = trough({
  title: 'Dairy process heat trough',
  site: 'almeria',                         // or { name, latitude, longitude, timezone, elevation }
  collector: { apertureWidth: 2.3, focalLength: 0.76 },
  receiver: { absorberDiameter: 0.035, envelope: { outerDiameter: 0.065 } },
  mounting: { rowLength: 60 },
  notes: 'Sized for 150 °C steam for a dairy; receiver is a stock 35 mm evacuated tube.',
});
save(d, 'dairy-trough.linefocus.json');
```

`fresnel()` and `cpc()` work the same way. Each starts from the design the app gives a new collector of that type,
deep-merges your changes and validates the result with the app's loader. A bad value throws with its path, such as
`collector.focalLength: must be at least 0.02 m and at most 6 m`. Units are the file's: metres, milliradians for
optical errors, degrees for angles, fractions for reflectance, absorptance and transmittance. For a realistic year,
pass `weather: epw('site.epw')` (free EPW files: climate.onebuilding.org); the file's location becomes the site.
`examples/process-heat-trough.mjs` shows every option. The schema is `schema/linefocus.design.v1.schema.json` in
the checkout, and its cross-field rules are in `docs/SCHEMA.md`.

**4. Verify.** This step is not optional:

```sh
node /path/to/skills/linefocus/scripts/verify.mjs dairy-trough.linefocus.json
```

It loads the file with the app's loader, traces the design point twice with different seeds (so you know the
sampling noise), runs the acceptance study and the full year, and checks the design against engineering rules of
thumb: intercept factor, row blocking, rim angle, CPC acceptance against latitude and tilt, optimistic material
values, and clear-sky weather. Fix every error. Act on every warning, or say why it doesn't apply. Pass several
files to compare designs side by side, and `--json report.json` to keep the figures.

**5. Optimise when the brief asks for "best".**

```sh
node /path/to/skills/linefocus/scripts/optimise.mjs dairy-trough.linefocus.json \
  --objective annualPerArea --vary collector.focalLength=0.5..1.2 --vary collector.apertureWidth=1.8..3 \
  --out dairy-trough-optimised.linefocus.json
```

Objectives: `efficiency` (design point), `annualPerArea` (kWh/m² of aperture), `annualPerLength` (kWh per metre of
trough or CPC), `annualPerLand` (kWh/m² of land under an LFR) and `cap` (concentration × acceptance). It writes the
new file only when the confirmed gain beats twice the sampling noise. Read the output honestly. A value "at the
lowest limit" means the best design may lie beyond your range. With the receiver fixed, `annualPerArea` always
favours a smaller aperture and `annualPerLength` a larger one, so the engineering answer comes from the pair plus
cost, not from either alone. Verify the optimised file again.

**6. Look at it.** Render the design in the real app and open the pictures:

```sh
python3 /path/to/skills/linefocus/scripts/preview.py dairy-trough.linefocus.json
```

It writes `overview.png` (cross-section with traced rays, design panel, design-point results) and one image per study
into `<name>-preview/`. Open `overview.png` and check that the geometry looks like what you meant: rays converging on
the receiver, no spill where you didn't expect it, rows not blocking each other.

**7. Deliver.** Give the person the `.linefocus.json` file and tell them to open it in Linefocus
(https://swiftugandan.github.io/linefocus/app/, then File → Open, or drop the file on the window). Report the
figures that answer their question with their definitions. Say "optical efficiency 85.5% of DNI on the aperture",
not just "85.5%". Then state the limits that apply: clear-sky years are an upper bound; the trace is 2D with
analytic end losses; Linefocus gives absorbed optical power, not heat delivered after thermal losses; it's for
concept design and comparison. Keep the generator script with the file.

## Things that go wrong

- **"The design is not valid. receiver.type: a parabolic trough needs an absorber tube."** The cross-field rules in
  `docs/SCHEMA.md` apply. Others: an envelope's bore must clear the absorber; LFR pitch must be at least the mirror
  width; a cylindrical row's radius must exceed half its width; a cavity's mouth must be wider than the receiver.
- **Low intercept factor on an LFR.** A bare tube is too small for a field's image. Use a flat absorber in a cavity
  (the default), or match the row curvature radius to about twice the receiver height.
- **A CPC's year collapses.** Its tilt must face the equator at about the latitude. The builder sets this when you
  give a site; an explicit `mounting.tiltDeg` overrides it.
- **Year results look too good.** You are on the clear-sky model. Import an EPW file before quoting a yield.
- **verify.mjs can't find Linefocus.** It uses `$LINEFOCUS`, then the checkout this skill sits in, then clones the
  public repository. Point `LINEFOCUS` at a checkout if you are offline.
- **preview.py has no browser.** It needs Python Playwright (`python3 -m pip install playwright` and
  `playwright install chromium`), an installed Google Chrome, or `CHROMIUM_PATH`.

## Bundled files

- `scripts/linefocus.mjs`: the builder (`trough`, `fresnel`, `cpc`, `design`, `site`, `epw`, `save`, `load`,
  `SITES`).
- `scripts/verify.mjs`: loads, traces, studies and checks designs; compares several.
- `scripts/optimise.mjs`: the app's optimiser from the command line.
- `scripts/preview.py`: opens a design in the real app and saves screenshots.
- `scripts/checkout.mjs`: finds the Linefocus checkout the others use.
- `examples/process-heat-trough.mjs`: a commented generator script using every builder option.
- `references/design-guide.md`: typical values by collector class, and how to read the figures.
