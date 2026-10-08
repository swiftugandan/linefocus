import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultDesign } from '../src/core/model.js';
import { buildDesignScene } from '../src/core/design-scene.js';
import { iamGrid, interpolateEta, yearStudy, dayStudy, acceptanceStudy, crossing, endLossFactor } from '../src/core/studies.js';

const design = defaultDesign();
const { scene } = buildDesignScene(design);
const grid = await iamGrid(design, scene);

test('the incidence grid is exact at its nodes and falls towards grazing incidence', () => {
  assert.equal(grid.tracking, true);
  assert.equal(grid.transversal.length, 1);
  grid.longitudinal.forEach((l, j) => assert.equal(interpolateEta(grid, 0, l), grid.eta[0][j]));
  assert.ok(grid.eta[0][0] > 0.8 && grid.eta[0].at(-1) < grid.eta[0][0] / 2);
  const mid = interpolateEta(grid, 0, 2.5);
  assert.ok(Math.abs(mid - (grid.eta[0][0] + grid.eta[0][1]) / 2) < 1e-12);
});

test('end losses grow with incidence and vanish at normal incidence', () => {
  assert.equal(endLossFactor(scene, design, 0), 1);
  const f = endLossFactor(scene, design, 45);
  assert.ok(Math.abs(f - (1 - scene.meanReceiverDistance / design.mounting.rowLength)) < 1e-12);
});

test('the year adds up month by month and stays inside physical bounds', () => {
  const year = yearStudy(design, scene, grid);
  assert.ok(Math.abs(year.monthly.reduce((a, b) => a + b, 0) - year.total) < 1e-6);
  assert.ok(year.efficiencyVsAperture <= grid.eta[0][0] + 1e-9, 'cannot beat normal-incidence efficiency');
  assert.ok(year.efficiencyVsDni < year.efficiencyVsAperture, 'cosine loss lowers efficiency against DNI');
  assert.ok(year.beamOnAperture < year.dni);
  // Summer months collect more than winter at a northern site.
  assert.ok(year.monthly[5] > year.monthly[11]);
  assert.ok(Math.abs(year.perArea * scene.reference.width - year.total) < 1e-6);
});

test('a weather file drives the year', () => {
  const dark = { ...structuredClone(design), weather: { source: 'epw', name: 'dark.epw', dni: new Array(8760).fill(0) } };
  assert.equal(yearStudy(dark, scene, grid).total, 0);
  const bright = { ...structuredClone(design), weather: { source: 'epw', name: 'flat.epw', dni: new Array(8760).fill(800) } };
  const year = yearStudy(bright, scene, grid);
  assert.ok(Math.abs(year.dni - (800 * year.hoursOfSun) / 1000) < 1e-6);
});

test('a clear day is symmetric about solar noon for a north–south trough', async () => {
  const { solarCoordinates, julianDay } = await import('../src/core/solar.js');
  const [march] = dayStudy(design, scene, grid);
  const eot = solarCoordinates(julianDay(2026, 1, march.day + 0.5)).equationOfTime;
  const noon = 12 + design.site.timezone - design.site.longitude / 15 - eot / 60;
  const before = march.points.filter(([h]) => h < noon).reduce((s, [, q]) => s + q, 0);
  const after = march.points.filter(([h]) => h > noon).reduce((s, [, q]) => s + q, 0);
  assert.ok(Math.abs(before - after) / (before + after) < 0.03, `before ${before}, after ${after}`);
  // With the sun along the axis at noon, a north–south trough collects less then than mid-morning.
  const at = /** @param {number} h */ h => march.points.reduce((best, p) => (Math.abs(p[0] - h) < Math.abs(best[0] - h) ? p : best))[1];
  assert.ok(at(noon) < at(noon - 3), 'midday dip');
});

test('acceptance: transmission peaks at alignment and the 90% angle lies beyond the 95% angle', async () => {
  const a = await acceptanceStudy(design, scene);
  assert.ok(a);
  assert.ok(Math.abs(Math.max(...a.relative) - 1) < 1e-12);
  assert.ok(a.halfAngle95 !== null && a.halfAngle90 !== null && a.halfAngle90 > a.halfAngle95);
  assert.ok(a.halfAngle90 > 0.2 && a.halfAngle90 < 2, `θ90 ${a.halfAngle90}`);
  assert.deepEqual(a.angles.map(x => 0 - x + 0).reverse(), a.angles);
});

test('crossing interpolates the first fall below a level after the peak', () => {
  assert.equal(crossing([0, 1, 2, 3], [0.98, 1, 0.8, 0.2], 0.9), 1.5);
  assert.equal(crossing([0, 1], [1, 0.95], 0.9), null);
});
