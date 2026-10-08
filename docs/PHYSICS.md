# Physics model

This page defines what Linefocus computes and how, so that every number in the app can be checked by hand. The tracer and its tests follow these definitions. If the code and this page disagree, that is a bug.

## Scope

Linefocus models **linear** concentrators: collectors whose cross-section is the same along their length. These are parabolic troughs, linear Fresnel reflectors (LFR) and compound parabolic concentrators (CPC). The cross-section is traced in 2D. Each ray still carries a full 3D direction, so sunlight arriving at an angle along the collector axis is handled exactly. This includes refraction and Fresnel reflection at a glass envelope, and the longer path through the glass. Some effects need finite length or a full 3D model, and the app covers them separately or not at all:

| Effect | How Linefocus treats it |
|---|---|
| End losses of a finite row | Analytic factor, outside the trace (see [End losses](#end-losses)) |
| Diffuse reflection, scattering from dust | Not modelled. Mirrors are specular with Gaussian slope and specularity errors |
| Heat loss, fluid temperature, pressure drop | Not modelled. Linefocus reports absorbed optical power only |
| Row-to-row shading in a trough or CPC field | Not modelled. Single row |
| Polarisation | Fresnel losses use unpolarised light: the mean of the s and p reflectances |

## Units and frames

The document stores lengths in metres, angular errors in milliradians (mrad) and sun geometry in degrees. Power is in watts per metre of collector length (W/m). Annual energy is in kWh per metre of length or per square metre of reference aperture.

The **collector frame** is right-handed:

- **x** runs across the collector.
- **y** is the collector's reference-aperture normal. For a trough this is the direction the aperture faces. For an LFR it is the vertical. For a CPC it is the tilted aperture normal.
- **z** runs along the collector axis.

All geometry lives in the xy-plane and extends without end along z.

The sun direction **s** is a unit vector from the collector towards the sun centre. It is described by two angles:

- The **transversal angle θT** is the angle between the projection of **s** onto the xy-plane and +y. It is positive towards +x.
- The **longitudinal angle θL** is the angle between **s** and the xy-plane.

```
s = (cos θL · sin θT,  cos θL · cos θT,  sin θL)
cos θi = s · ŷ = cos θL · cos θT
```

θi is the incidence angle on the reference aperture. For a tracking trough θT is only the tracking error, and θL equals the incidence angle. Some LFR literature defines the longitudinal angle in the yz-plane instead (tan θL′ = s_z / s_y). Convert with `θL′ = atan(tan θL / cos θT)`.

### From sun position to the collector frame

Solar zenith θz and azimuth γs (clockwise from north) give the world vector in east, north, up components:

```
s_world = (sin θz · sin γs,  sin θz · cos γs,  cos θz)
```

The collector axis is horizontal, with axis azimuth α measured clockwise from north. So α = 0° is a north–south axis and α = 90° is east–west.

```
axis  a = (sin α, cos α, 0)
cross e = (cos α, −sin α, 0)      (for a north–south axis, e points east)
up    u = (0, 0, 1)

θT,fixed = atan2(s_world · e, s_world · u)
θL       = asin(s_world · a)
```

How θT,fixed becomes the collector-frame θT depends on the mounting:

| Mounting | θT used in the trace |
|---|---|
| Tracking trough | −(tracking error). The aperture follows θT,fixed |
| LFR (horizontal field, mirrors track individually) | θT,fixed |
| Fixed CPC tilted by β about its axis | θT,fixed − β |

The app takes no energy from hours with the sun below the horizon, or with |θT| ≥ 90° in the collector frame.

### The design point

The design point is one sun direction in the collector frame, (θT, θL), plus a DNI. It is traced exactly as entered. For a tracking trough, θT is the angle between the sun and the aperture normal, so a non-zero θT is a misalignment. The mounting's tracking error is a separate, constant bias. It is applied only when the day and year studies convert real sun positions to the collector frame, so the two never add up behind the user's back.

## Sun and optical errors

Each ray's direction starts at the sun centre and is perturbed by a sampled **sunshape**:

| Sunshape | Radial distribution of the angular offset r |
|---|---|
| Pillbox, half-angle θs (default 4.65 mrad) | Uniform over the solar disc: r = θs·√u |
| Gaussian, σ per axis | Rayleigh: r = σ·√(−2 ln u) |
| Buie, circumsolar ratio χ | Disc φ(θ) = cos(0.326θ)/cos(0.308θ) for θ ≤ 4.65 mrad, and aureole φ(θ) = e^κ θ^γ for 4.65 < θ ≤ 43.6 mrad. Here κ = 0.9 ln(13.5χ) χ^−0.3 and γ = 2.2 ln(0.52χ) χ^0.43 − 0.1. Sampled from a tabulated CDF of φ(θ)·θ |

The azimuth of the offset is uniform. The offset is applied in a plane perpendicular to **s**.

At every reflection off a primary or secondary mirror, the surface normal is perturbed by a Gaussian **slope error** σ_slope on each of two axes. This turns into an angular error of about 2σ_slope in the reflected ray. A separate Gaussian **specularity error** σ_spec, also per axis, is then applied to the reflected direction. Slope error and specularity are separate inputs. The default specularity is zero so the same effect isn't counted twice. Measured slope-error data usually already includes the mirror's specular spread.

A **tracking error** is a fixed angular misalignment of a tracking collector at the design point. The acceptance study sweeps it.

For comparison only, the app also shows the usual combined estimate σ_total² = σ_sun² + 4σ_slope² + σ_spec², where σ_sun is the sunshape's standard deviation. The trace does not use this combined value.

## Rays and power

Rays start on a **launch window**: a line segment perpendicular to the projection of **s** onto the xy-plane, placed upstream of the whole geometry and wide enough to cover it. Launch positions are stratified (one jittered ray per equal strip), and directions are sampled independently. The power entering through the window, per metre of collector length, is

```
P_launch = DNI · L_window · √(s_x² + s_y²)
```

Each of the N rays starts with weight P_launch / N.

The **reference aperture** of each collector type has width W_ref and normal ŷ:

| Collector | W_ref |
|---|---|
| Parabolic trough | Rim-to-rim aperture width W |
| LFR | Total mirror width: rows × mirror width |
| CPC | Entry aperture width at the top of the (possibly truncated) reflector |

The **reference power** is `P_ref = DNI · W_ref · cos θi`, and the **optical efficiency** is `η = P_absorbed / P_ref`. Cosine loss on the reference aperture is outside η. For an LFR, η still includes the cosine and gap effects of the tilted rows, because the mirror area does not equal the area the field projects towards the sun. This matches common LFR practice.

The **intercept factor** γ is the fraction of power leaving the primary reflector that reaches the absorber, directly or by way of a secondary reflector. Each ray is weighted by its power just after its first primary reflection. A ray that meets a glass envelope or cover counts as intercepted when its straight path continues to the absorber, so glass losses don't reduce γ. The receiver term ρ·τ·α is therefore not part of γ.

The **geometric concentration ratio** is W_ref divided by the absorber's perimeter (for a tube, π·D) or width (for a flat absorber).

## Surfaces and materials

Geometry is built from four primitives: line segments, circles, circular arcs and parabolic arcs. Sampled curves (the CPC profiles) are polylines whose normals are interpolated between exact vertex normals. Every surface has a **front** side, given by its normal, and a material:

| Material | Front side | Back side |
|---|---|---|
| Mirror (reflectance ρ, slope σ, specularity σ) | Specular reflection, weight × ρ | Opaque |
| Absorber (absorptance α) | Absorbs α of the weight. The rest is lost as absorber reflection | Opaque, counted as receiver structure |
| Dielectric (refractive index and absorption coefficient on each side) | Refraction or Fresnel reflection | Same, mirrored |
| Opaque (housing, insulation) | Stops the ray | Stops the ray |

Refraction follows the vector form of Snell's law in 3D. The surface normal lies in the xy-plane and the z component of n·**d** is conserved, so a ray's projected path bends with the Bravais effective index rather than plain n. Fresnel reflectance is the unpolarised mean of R_s and R_p at the true 3D incidence angle. The ray takes the reflected or transmitted branch with probability R or 1 − R. This keeps one path per ray and has no bias on average. Total internal reflection is exact. Inside an absorbing medium the weight falls by e^(−k·ℓ), where ℓ is the 3D path length.

A glass envelope can be modelled in two ways. **Physical** mode uses two concentric dielectric circles with refractive index n and absorption coefficient k. **Fixed transmittance** mode passes rays straight through the envelope with weight × τ. Use fixed mode to reproduce a datasheet value, such as an anti-reflective coating's τ = 0.96.

## Energy ledger

Every launched ray ends in exactly one bucket, so the buckets always add up to P_launch. The tests enforce this for every collector type and incidence angle.

| Bucket | Meaning |
|---|---|
| Absorbed | Absorbed by the absorber: α of the arriving weight |
| Absorber reflection | The remaining 1 − α at the absorber. Not traced further |
| Reflector absorption | 1 − ρ at each mirror reflection |
| Glass absorption | Absorbed inside glass. In fixed-transmittance mode it also takes 1 − τ each time a ray crosses the envelope. A datasheet τ already covers both faces of the glass wall, so a ray that reaches the absorber pays it once, and a ray that passes in and out again pays it twice |
| Glass reflection | Escaped after its last interaction was a Fresnel reflection |
| Spillage | Escaped, or stopped by structure, after a mirror reflection without reaching the absorber |
| Shading | First hit was the back of a primary mirror (a neighbouring LFR row in the sun's path) |
| Blocking | Hit the back of a primary mirror after a primary reflection |
| Receiver shading | First hit was an opaque or back face of the receiver assembly (housing, secondary back) before reaching any mirror |
| Trapped | Exceeded 64 interactions. Should stay near zero |
| Missed | Never touched the collector. It passed beside the reflector or between LFR rows |

The loss waterfall shows each bucket as a fraction of P_ref. For an LFR, the gap between P_ref and the power the field actually intercepts is shown as **cosine and gaps**: P_ref minus every bucket except Missed. For a trough or CPC this gap is zero up to sampling noise and is hidden below 0.05%.

## Collector geometry

### Parabolic trough

The mirror is y = x²/(4f) for |x| ≤ W/2, with its vertex at the origin. The rim angle is φr = 2·atan(W / 4f). The absorber tube of diameter D sits at the focus (0, f) and may have an envelope. With a pillbox sun of half-angle θs and no errors, every ray leaving the mirror is intercepted when D ≥ W·sin θs / sin φr. Below that, γ falls. The tests check this.

### Linear Fresnel reflector

N rows of width w sit at pitch p, symmetric about the receiver at x = 0, with pivots at y = 0. The receiver centre is at height H. Each row turns about its pivot so that its normal bisects the projected sun direction and the direction from the pivot to the aim point (0, H). This is exact single-axis tracking. Reflection preserves the ray's z component, so the transversal geometry alone sets the row angle. Rows are flat, or circular arcs of radius R_c (concave towards the receiver). The receiver is a tube, with or without an envelope, or a downward-facing flat absorber with an optional glass cover. Either can sit in a trapezoidal cavity: mirror walls reflective on the inside, with an opaque, insulated top.

### Compound parabolic concentrator

The **flat-absorber CPC** has an absorber from (−a′, 0) to (a′, 0) and acceptance half-angle θa. The right reflector is a parabola with:

- its focus at the left absorber edge;
- its axis parallel to the extreme ray at θa;
- focal length f = a′(1 + sin θa).

It runs from the right absorber edge up to the point where its tangent is vertical. The full height is H = (a + a′)/tan θa, with aperture half-width a = a′/sin θa.

The **tube CPC** is designed for a radius r_d: the absorber or envelope radius plus a clearance gap. The reflector point at parameter θ (measured from the cusp under the tube) is

```
P(θ) = r_d·(sin θ, −cos θ) − ρ(θ)·(cos θ, sin θ)
ρ(θ) = r_d·θ                                                 for 0 ≤ θ ≤ θa + π/2  (involute)
ρ(θ) = r_d·(θ + θa + π/2 − cos(θ − θa)) / (1 + sin(θ − θa))   for θa + π/2 ≤ θ ≤ 3π/2 − θa
```

Both CPCs can be truncated at a chosen height, which trades concentration for reflector material. The ideal concentration of a full CPC is 1/sin θa. With no errors, γ is 1 inside ±θa and drops sharply outside. The tests check both.

## Studies

| Study | What it computes |
|---|---|
| Design point | One trace at the chosen θT, θL: ledger, η, γ, absorber flux map, sample ray paths |
| Acceptance | γ against tracking error. Reports the half-angles where γ falls to 95% and 90% of its peak, and the concentration–acceptance product C·sin(θ₉₀) |
| Incidence angle modifier | η(θT, θL)/η(0, 0) on a grid. Tracking troughs need only θL. LFRs and fixed CPCs need both axes |
| Day | Absorbed W/m through one day at the site, every 10 minutes |
| Year | Hourly sum over a 365-day year. Results by month, plus kWh per metre and per m² of reference aperture |

Day and year use the IAM grid (bilinear interpolation) rather than tracing every hour:

```
q(t) = DNI(t) · W_ref · cos θi(t) · η(θT(t), θL(t)) · η_end(θL(t))
```

### End losses

A finite row of length L loses the light that reflects past its end. Linefocus uses the standard factor, ignoring light recovered by the next row:

```
η_end = max(0, 1 − d̄ · tan θL / L)
```

Here d̄ is the mean distance from mirror to receiver measured in the transversal plane. For a trough d̄ = f·(1 + W²/(48f²)). For an LFR it is the mean path length from the rows to the receiver centre. A CPC sits close to its absorber, so it uses its mean reflector-to-absorber height.

### Solar position and DNI

Solar position uses the NOAA algorithm. It is based on Meeus and accurate to about 0.01° between 1950 and 2050. Hours are timed at their midpoint in local standard time.

Without weather data, DNI comes from the ASHRAE clear-sky model, DNI = A·exp(−B / cos θz), with these monthly constants:

| Month | Jan | Feb | Mar | Apr | May | Jun | Jul | Aug | Sep | Oct | Nov | Dec |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| A (W/m²) | 1230 | 1215 | 1186 | 1136 | 1104 | 1088 | 1085 | 1107 | 1151 | 1192 | 1221 | 1233 |
| B | 0.142 | 0.144 | 0.156 | 0.180 | 0.196 | 0.205 | 0.207 | 0.201 | 0.177 | 0.160 | 0.149 | 0.142 |

Clear-sky totals are an upper bound with no cloud. Treat them as indicative. Importing an EPW weather file replaces them with measured or typical-year hourly DNI, and the file's header supplies the site's latitude, longitude and time zone.

## Validation

Linefocus checks itself against three kinds of evidence. All of them run in `npm test`.

1. **Analytic results.** These include ledger conservation at several sun angles, Fresnel reflectance at normal incidence ((n−1)/(n+1))², total internal reflection, the Bravais index, the 2σ slope-error rule, sunshape bounds, and the trough's minimum receiver size.
2. **A semi-analytic intercept factor.** With a Gaussian sun and Gaussian slope error, a ray leaving a trough mirror at x has a Gaussian transversal error with σ = √(σ_sun² + 4σ_slope²). It reaches a tube of radius r at distance d(x) = f + x²/4f when the error is smaller than asin(r/d). Averaging that probability over the aperture gives γ to within 0.003 of the trace.
3. **An independent tracer.** Six scenes are traced by Linefocus and by [Ray Optics Simulation](https://phydemo.app/ray-optics/) at pinned commit `daf7677`: troughs on and off axis, and LFR fields at three sun angles, one with heavy blocking. The scenes use ideal mirrors, collimated light and flat absorbers. The exported scenes and Ray Optics' detector results are committed under `tests/oracle/`, and the tests require agreement within 0.002 of the beam power. At the time of writing every case agrees within 0.0001. `scripts/ray-optics-oracle.mjs` regenerates the goldens.

Published intercept factors for commercial troughs (about 0.92–0.95) are lower than a trace of the mirror alone. They also include receiver misalignment, structural deflection, tracking and soiling. Model those as extra slope or tracking error if you want to compare.

Linefocus is for concept design and comparison. Check final designs with an established tool such as SolTrace or Tonatiuh, using measured optical properties.
