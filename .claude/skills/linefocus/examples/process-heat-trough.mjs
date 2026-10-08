// A process-heat trough for a dairy near Almería, then a linear Fresnel alternative on the same site, written as
// Linefocus design files. Run: node process-heat-trough.mjs [output-folder]
import { trough, fresnel, save } from '../scripts/linefocus.mjs';

const out = process.argv[2] ?? '.';

const dairy = trough({
  title: 'Dairy process heat trough',
  notes: 'About 150 °C steam for pasteurising. The receiver is a stock 35 mm evacuated tube.',
  site: 'almeria',                                  // an example site, or { name, latitude, longitude, timezone, elevation }
  // weather: epw('almeria.epw'),                   // a real year; without it the clear-sky model gives an upper bound
  collector: { apertureWidth: 2.3, focalLength: 0.76 },
  receiver: { absorberDiameter: 0.035, absorptance: 0.95, envelope: { mode: 'fixed', outerDiameter: 0.065, transmittance: 0.96 } },
  optics: { reflectance: 0.94, slopeErrorMrad: 3 },
  sun: { shape: 'buie', csr: 0.05 },
  mounting: { axisAzimuthDeg: 0, rowLength: 60 },   // north–south rows, 60 m long
  designPoint: { dni: 850 },
  simulation: { rays: 200000, seed: 1 },
});

const field = fresnel({
  title: 'Dairy process heat LFR',
  notes: 'The same site and duty, on cheaper structure and less land.',
  site: 'almeria',
  collector: { rows: 12, mirrorWidth: 0.6, pitch: 0.75, receiverHeight: 5, curvatureRadius: 10, secondary: { kind: 'trapezoid', depth: 0.1, mouthWidth: 0.45 } },
  receiver: { type: 'flat', width: 0.28 },
  optics: { reflectance: 0.94, slopeErrorMrad: 3 },
  mounting: { axisAzimuthDeg: 0, rowLength: 60 },
  designPoint: { dni: 850 },
});

console.log(save(dairy, `${out}/dairy-trough.linefocus.json`));
console.log(save(field, `${out}/dairy-lfr.linefocus.json`));
