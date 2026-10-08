import { test } from 'node:test';
import assert from 'node:assert/strict';
import { julianDay, solarCoordinates, sunPosition, clearSkyDni, parseEpw, collectorAngles, refraction } from '../src/core/solar.js';

const near = (a, b, tol, label) => assert.ok(Math.abs(a - b) <= tol, `${label}: ${a} vs ${b}`);

test('Julian day matches Meeus', () => {
  // Meeus, Astronomical Algorithms, example 7.a: 1957 October 4.81 = JD 2436116.31.
  near(julianDay(1957, 10, 4.81), 2436116.31, 1e-6, 'JD');
  near(julianDay(2000, 1, 1.5), 2451545, 1e-9, 'J2000');
});

test('solar declination matches Meeus example 25.a', () => {
  // 1992 October 13.0 TD: apparent declination −7.78507°.
  near(solarCoordinates(2448908.5).declination, -7.78507, 0.01, 'declination');
});

test('declination at the solstices and the equation of time at its extremes', () => {
  near(solarCoordinates(julianDay(2026, 6, 21.5)).declination, 23.44, 0.05, 'June solstice');
  near(solarCoordinates(julianDay(2026, 12, 21.5)).declination, -23.44, 0.05, 'December solstice');
  // The sun runs about 16.4 minutes fast in early November and 14.2 minutes slow in mid-February.
  near(solarCoordinates(julianDay(2026, 11, 3.5)).equationOfTime, 16.4, 0.2, 'November');
  near(solarCoordinates(julianDay(2026, 2, 11.5)).equationOfTime, -14.2, 0.2, 'February');
});

test('the sun is overhead at local solar noon on the Tropic of Cancer at the June solstice', () => {
  // On the Greenwich meridian with UTC as local time, solar noon is noon minus the equation of time.
  const site = { name: 'Tropic', latitude: 23.44, longitude: 0, timezone: 0, elevation: 0 };
  const day = 172; // 21 June
  const eot = solarCoordinates(julianDay(2026, 1, day + 0.5)).equationOfTime;
  const { zenith } = sunPosition(site, day, 12 - eot / 60);
  near(zenith, 0, 0.1, 'zenith');
});

test('azimuth conventions: morning sun in the east, noon sun south of a northern site', () => {
  const site = { name: 'Almería', latitude: 37.09, longitude: -2.36, timezone: 1, elevation: 0 };
  const morning = sunPosition(site, 80, 8.5), noon = sunPosition(site, 80, 13.2), evening = sunPosition(site, 80, 18);
  assert.ok(morning.azimuth > 80 && morning.azimuth < 120, `morning ${morning.azimuth}`);
  near(noon.azimuth, 180, 6, 'noon azimuth');
  near(noon.zenith, 37.09 - 0.1, 1.5, 'equinox noon zenith ≈ latitude');
  assert.ok(evening.azimuth > 240 && evening.azimuth < 280, `evening ${evening.azimuth}`);
  const south = { ...site, latitude: -33.9, longitude: 18.4, timezone: 2 };
  near(sunPosition(south, 80, 12.8).azimuth, 0, 8, 'noon sun north of a southern site');
});

test('refraction lifts the sun by about half a degree at the horizon and nothing overhead', () => {
  near(refraction(0), 1735 / 3600, 1e-9, 'horizon');
  assert.equal(refraction(89), 0);
});

test('clear-sky DNI follows the ASHRAE model', () => {
  near(clearSkyDni(15, 0), 1230 * Math.exp(-0.142), 1e-9, 'January, overhead');
  near(clearSkyDni(196, 60), 1085 * Math.exp(-0.207 * 2), 1e-9, 'July, 60°');
  assert.equal(clearSkyDni(100, 95), 0);
});

test('an EPW file gives the site and 8,760 hours of DNI', () => {
  const header = ['LOCATION,Almeria,AND,ESP,SWEC,084870,36.85,-2.38,1.0,21.0', ...Array(7).fill('X')];
  const rows = [];
  for (let d = 0; d < 365; d++) for (let h = 1; h <= 24; h++) {
    const fields = Array(35).fill('0');
    fields[0] = '2005'; fields[1] = '1'; fields[2] = '1'; fields[3] = String(h);
    fields[14] = h === 13 ? '900' : h === 3 ? '9999' : '0';
    rows.push(fields.join(','));
  }
  const { site, weather } = parseEpw([...header, ...rows].join('\n'), 'almeria.epw');
  assert.equal(site.name, 'Almeria, ESP');
  assert.equal(site.latitude, 36.85);
  assert.equal(site.timezone, 1);
  assert.equal(weather.dni.length, 8760);
  assert.equal(weather.dni[12], 900);
  assert.equal(weather.dni[2], 0);
  assert.throws(() => parseEpw('not a weather file', 'x.epw'), /LOCATION/);
  assert.throws(() => parseEpw(header.join('\n') + '\n' + rows.slice(0, 100).join('\n'), 'short.epw'), /100 hours/);
});

test('collector angles: a north–south trough sees the morning sun across its aperture', () => {
  const mounting = { axisAzimuthDeg: 0, tiltDeg: 0, trackingErrorMrad: 0, rowLength: 100 };
  // Sun due east, 30° up: entirely across a north–south axis.
  const east = collectorAngles({ zenith: 60, azimuth: 90 }, mounting, 'fixed');
  near(east?.transversalDeg ?? NaN, 60, 1e-9, 'θT');
  near(east?.longitudinalDeg ?? NaN, 0, 1e-9, 'θL');
  // Sun due south, 30° up: entirely along the axis, so a tracking trough sees θL = 60°.
  const south = collectorAngles({ zenith: 60, azimuth: 180 }, mounting, 'tracking');
  near(south?.longitudinalDeg ?? NaN, -60, 1e-9, 'θL south');
  near(south?.cosIncidence ?? NaN, 0.5, 1e-9, 'cos θi');
  assert.equal(collectorAngles({ zenith: 95, azimuth: 90 }, mounting, 'tracking'), null);
});
