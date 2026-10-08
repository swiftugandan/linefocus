/** Sun position (NOAA algorithm, after Meeus), ASHRAE clear-sky beam irradiance, EPW weather files, and the
 * conversion from a sun position to a collector's transversal and longitudinal angles. See docs/PHYSICS.md. */

import { HOURS_PER_YEAR } from './model.js';

/** @import { Mounting, Site } from './model.js' */

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

/** Days before each month in a non-leap year. */
export const MONTH_START = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334, 365];
export const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Julian day of a UTC date. @param {number} year @param {number} month 1–12 @param {number} day may be fractional */
export function julianDay(year, month, day) {
  let y = year, m = month;
  if (m <= 2) { y -= 1; m += 12; }
  const a = Math.floor(y / 100), b = 2 - a + Math.floor(a / 4);
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + day + b - 1524.5;
}

/**
 * Declination (degrees) and equation of time (minutes) at a Julian day.
 * @param {number} jd
 */
export function solarCoordinates(jd) {
  const t = (jd - 2451545) / 36525;
  const l0 = ((280.46646 + t * (36000.76983 + t * 0.0003032)) % 360 + 360) % 360;
  const m = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const c = Math.sin(m * RAD) * (1.914602 - t * (0.004817 + 0.000014 * t)) + Math.sin(2 * m * RAD) * (0.019993 - 0.000101 * t) + Math.sin(3 * m * RAD) * 0.000289;
  const omega = 125.04 - 1934.136 * t;
  const apparentLongitude = l0 + c - 0.00569 - 0.00478 * Math.sin(omega * RAD);
  const meanObliquity = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const obliquity = meanObliquity + 0.00256 * Math.cos(omega * RAD);
  const declination = Math.asin(Math.sin(obliquity * RAD) * Math.sin(apparentLongitude * RAD)) * DEG;
  const y = Math.tan((obliquity / 2) * RAD) ** 2;
  const eq = y * Math.sin(2 * l0 * RAD) - 2 * e * Math.sin(m * RAD) + 4 * e * y * Math.sin(m * RAD) * Math.cos(2 * l0 * RAD)
    - 0.5 * y * y * Math.sin(4 * l0 * RAD) - 1.25 * e * e * Math.sin(2 * m * RAD);
  return { declination, equationOfTime: 4 * eq * DEG };
}

/**
 * Sun position for a site at a local standard time.
 * @param {Site} site
 * @param {number} dayOfYear 1–365 in a non-leap year
 * @param {number} hour local standard time, hours since midnight (may be fractional)
 * @param {number} [year]
 * @returns {{ zenith: number, azimuth: number }} degrees; azimuth clockwise from north. Zenith includes refraction.
 */
export function sunPosition(site, dayOfYear, hour, year = 2026) {
  const utcHours = hour - site.timezone;
  const jd = julianDay(year, 1, dayOfYear) + utcHours / 24;
  const { declination, equationOfTime } = solarCoordinates(jd);
  const trueSolarMinutes = ((hour * 60 + equationOfTime + 4 * site.longitude - 60 * site.timezone) % 1440 + 1440) % 1440;
  const hourAngle = trueSolarMinutes / 4 < 0 ? trueSolarMinutes / 4 + 180 : trueSolarMinutes / 4 - 180;
  const lat = site.latitude * RAD, dec = declination * RAD, ha = hourAngle * RAD;
  const cosZ = Math.min(1, Math.max(-1, Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(ha)));
  const zenith = Math.acos(cosZ) * DEG;
  let azimuth;
  const sinZ = Math.sin(zenith * RAD);
  if (Math.abs(Math.cos(lat) * sinZ) < 1e-12) azimuth = site.latitude > 0 ? 180 : 0;
  else {
    const arg = Math.min(1, Math.max(-1, (Math.sin(lat) * cosZ - Math.sin(dec)) / (Math.cos(lat) * sinZ)));
    azimuth = hourAngle > 0 ? (Math.acos(arg) * DEG + 180) % 360 : (540 - Math.acos(arg) * DEG) % 360;
  }
  return { zenith: zenith - refraction(90 - zenith), azimuth };
}

/** NOAA's approximate atmospheric refraction, in degrees, for a true solar elevation. @param {number} elevation */
export function refraction(elevation) {
  if (elevation > 85) return 0;
  const te = Math.tan(elevation * RAD);
  let arcsec;
  if (elevation > 5) arcsec = 58.1 / te - 0.07 / te ** 3 + 0.000086 / te ** 5;
  else if (elevation > -0.575) arcsec = 1735 + elevation * (-518.2 + elevation * (103.4 + elevation * (-12.79 + elevation * 0.711)));
  else arcsec = -20.772 / te;
  return arcsec / 3600;
}

/** ASHRAE clear-sky constants by month: A (W/m²) and B. */
export const ASHRAE_A = [1230, 1215, 1186, 1136, 1104, 1088, 1085, 1107, 1151, 1192, 1221, 1233];
export const ASHRAE_B = [0.142, 0.144, 0.156, 0.180, 0.196, 0.205, 0.207, 0.201, 0.177, 0.160, 0.149, 0.142];

/** Month index (0–11) of a day of a non-leap year. @param {number} dayOfYear 1–365 */
export function monthOf(dayOfYear) {
  let m = 0;
  while (m < 11 && dayOfYear > MONTH_START[m + 1]) m++;
  return m;
}

/** Clear-sky direct normal irradiance, W/m². @param {number} dayOfYear @param {number} zenith degrees */
export function clearSkyDni(dayOfYear, zenith) {
  if (zenith >= 90) return 0;
  const m = monthOf(dayOfYear);
  return ASHRAE_A[m] * Math.exp(-ASHRAE_B[m] / Math.cos(zenith * RAD));
}

/**
 * Reads an EnergyPlus weather (EPW) file: site from the LOCATION line, and hourly DNI (column 15) for 8,760
 * hours. A leap-year file loses 29 February. Missing values (9999) count as zero.
 * @param {string} text @param {string} name
 */
export function parseEpw(text, name) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  const location = lines[0]?.split(',');
  if (!location || location[0].trim().toUpperCase() !== 'LOCATION' || location.length < 10) throw new Error('This is not an EPW weather file: the first line should start with LOCATION.');
  const [latitude, longitude, timezone, elevation] = location.slice(6, 10).map(Number);
  if (![latitude, longitude, timezone, elevation].every(Number.isFinite)) throw new Error('The EPW LOCATION line has no usable latitude, longitude, time zone or elevation.');
  /** @type {number[]} */
  const dni = [];
  for (const line of lines.slice(8)) {
    if (!line.trim()) continue;
    const f = line.split(',');
    if (f.length < 16) throw new Error(`An EPW data row has ${f.length} fields; 35 are expected.`);
    if (Number(f[1]) === 2 && Number(f[2]) === 29) continue;
    const value = Number(f[14]);
    dni.push(Number.isFinite(value) && value < 9999 ? Math.max(0, Math.min(1500, value)) : 0);
  }
  if (dni.length !== HOURS_PER_YEAR) throw new Error(`The EPW file has ${dni.length} hours of data; Linefocus needs a full year of ${HOURS_PER_YEAR}.`);
  const city = [location[1], location[3]].map(s => s.trim()).filter(Boolean).join(', ');
  return {
    site: { name: city.slice(0, 120) || name, latitude, longitude, timezone, elevation },
    weather: /** @type {const} */ ({ source: 'epw', name: name.slice(0, 200), dni }),
  };
}

/**
 * Sun position in a collector's frame. See the mounting table in docs/PHYSICS.md.
 * @param {{ zenith: number, azimuth: number }} sun
 * @param {Mounting} mounting
 * @param {'tracking' | 'fixed'} tracking a tracking collector follows θT; a fixed one is tilted by mounting.tiltDeg
 * @returns {{ transversalDeg: number, longitudinalDeg: number, cosIncidence: number } | null} null when the sun is below the horizon or behind the aperture
 */
export function collectorAngles(sun, mounting, tracking) {
  if (sun.zenith >= 90) return null;
  const z = sun.zenith * RAD, g = sun.azimuth * RAD, a = mounting.axisAzimuthDeg * RAD;
  const se = Math.sin(z) * Math.sin(g), sn = Math.sin(z) * Math.cos(g), su = Math.cos(z);
  const along = se * Math.sin(a) + sn * Math.cos(a);
  const across = se * Math.cos(a) - sn * Math.sin(a);
  const fixedT = Math.atan2(across, su) * DEG;
  const longitudinalDeg = Math.asin(Math.max(-1, Math.min(1, along))) * DEG;
  const transversalDeg = tracking === 'tracking' ? -(mounting.trackingErrorMrad * 1e-3) * DEG : fixedT - mounting.tiltDeg;
  if (Math.abs(transversalDeg) >= 90) return null;
  const cosIncidence = Math.cos(longitudinalDeg * RAD) * Math.cos(transversalDeg * RAD);
  return { transversalDeg, longitudinalDeg, cosIncidence };
}
