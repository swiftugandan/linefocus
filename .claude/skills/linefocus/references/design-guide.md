# Design guide

Typical values to start from, and how to read what Linefocus reports. The ranges are rules of thumb for concept
design, drawn from published collector classes. They aren't the datasheet of any product. Check a real product's
datasheet before quoting its numbers.

## Starting points by collector class

| Class | Use | Starting values |
|---|---|---|
| Large utility trough (EuroTrough / LS-3 class) | Power plants, 300–400 °C oil | Aperture 5.77 m, focal length 1.71 m (rim angle about 80°), 70 mm absorber in a 125 mm envelope, row length 150 m. The app's default trough |
| Very large trough | Newer power plants | Aperture about 7.5–8.6 m, absorber about 90 mm, rim angle 80–90° |
| Process-heat trough | Industry, 100–250 °C | Aperture 1–2.5 m, rim angle 70–90°, absorber 25–40 mm in a 50–70 mm envelope, rows 20–100 m |
| Linear Fresnel reflector | Steam for power or industry, cheap land use | 10–25 rows of 0.5–1.2 m mirrors, ground cover 0.6–0.9, receiver 4–15 m up, cylindrical rows with radius about twice the receiver height, flat absorber 0.2–0.5 m in a cavity. The app's default LFR: 16 rows of 0.75 m at 0.95 m pitch, 7.4 m up |
| Stationary CPC | Low-temperature heat, no tracking | Acceptance half-angle 30–60°, truncated to 50–80% of full height, evacuated tube about 47 mm in a 58 mm envelope, east–west axis tilted to about the latitude |

## Optical properties

| Property | Typical | Notes |
|---|---|---|
| Mirror reflectance | 0.93–0.95 silvered glass (new); 0.88–0.92 polished aluminium | Soiling lowers this by a few points between cleanings |
| Slope error | 2–3 mrad for good trough mirrors; 2–4 mrad for LFR rows; more for formed aluminium CPC reflectors | Per axis. It doubles in the reflected ray |
| Specularity error | 0–0.5 mrad for glass mirrors | Leave at 0 when the slope error already includes it |
| Absorptance | 0.94–0.96 for selective coatings | Above 0.97 is optimistic |
| Envelope transmittance | 0.96–0.97 with anti-reflective coating; about 0.92 without | Use the datasheet τ ("Datasheet τ" mode) |
| Sunshape | Buie, circumsolar ratio 0.02–0.1 on clear days; 0.05 is a fair default | A pillbox of 4.65 mrad is the textbook sun |

## Reading the figures

- **Optical efficiency η.** The absorbed power over the reference power. For troughs and CPCs the reference is DNI on the
  aperture with cos θ. For an LFR it is DNI on the total mirror width without cos θ, the usual LFR convention.
  Always say which.
- **Intercept factor γ.** The share of reflected light reaching the absorber, with glass losses excluded. Aim for 0.9 or more.
  A tube CPC's γ is lowered mainly by the gap between envelope and absorber.
- **Acceptance half-angle (90%).** How far the sun can move off the aiming direction before transmission falls to
  90%. Troughs and LFRs sit around ±0.4–1°. Tracking and structural errors eat into it, so more is safer.
- **C · sin θ90.** Concentration bought per unit of tolerance. In 2D the ideal limit is 1. Well-designed troughs
  reach about 0.2–0.35, and CPCs approach 1.
- **Incidence angle modifier.** η at an angle over η at normal incidence. For troughs the modifier excludes cos θ.
  For LFRs it includes the field's cosine and shading. A steeply falling longitudinal modifier means end losses or glass
  losses at oblique sun.
- **Year.** The clear-sky model gives an upper bound: real sites deliver less, often 60–80% of clear-sky DNI. Quote
  yields from an EPW weather file. "Share of DNI" includes cosine and end losses, so it is the fairest single
  comparison between a tracking trough, an LFR and a fixed CPC.
- **Sampling noise.** verify.mjs traces twice with different seeds and prints the difference. Treat any two designs
  that differ by less than about twice that as equal.

## Comparing collector types fairly

Compare at the same site and weather, with the same sunshape and comparable optical properties. Then compare yearly
energy per m² of aperture (or per m² of land for land-limited sites), not design-point efficiency. A tracking trough
always wins at the design point; the year shows how much of that survives cosine, end losses and the seasons.
