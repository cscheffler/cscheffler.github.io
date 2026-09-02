// weather.js — what is outside the window.
//
// Two sources of weather:
//   1. Live conditions for the office from Open-Meteo (fetchWeather), used by
//      default. Every viewer fetches the same current block, so they agree.
//   2. A synthetic, deterministic weather (weatherAt) keyed on UTC time and a
//      seed, used while the live data is loading or unavailable, for previews,
//      and for the cloud drift "gusts".
// Plus the sun: real sunrise, sunset, elevation and azimuth for the office's
// coordinates, so twilight lasts as long as it really does at that latitude.

import { clamp, hash01, lerpHex, smoothstep } from './util.js';

export const HOUR_MS = 3600e3;

// ---------------------------------------------------------------- synthetic weather

// Smooth value noise: random values at keyframes, cosine-interpolated.
export function smoothNoise(t, period, salt) {
  const p = t / period;
  const i = Math.floor(p);
  const f = p - i;
  const a = hash01(i * 7919 + salt * 104729);
  const b = hash01((i + 1) * 7919 + salt * 104729);
  const u = 0.5 - 0.5 * Math.cos(f * Math.PI);
  return a + (b - a) * u;
}

// cloud 0..1 (clear..overcast), rain 0..1, wind 0..1. All drift over hours.
export function weatherAt(tMs, seed = 0) {
  const h = tMs / HOUR_MS;
  let cloud = 0.55 * smoothNoise(h, 5, seed + 1) + 0.3 * smoothNoise(h, 1.7, seed + 2) + 0.15 * smoothNoise(h, 0.5, seed + 3);
  cloud = clamp((cloud - 0.2) / 0.6, 0, 1);
  const wet = smoothNoise(h, 3.5, seed + 4);
  const wind = 0.15 + 0.85 * smoothNoise(h, 2.5, seed + 5);
  return { cloud, wet, rain: rainFrom(cloud, wet), snow: 0, fog: 0, wind, source: 'synthetic' };
}

// Rain only falls from a mostly cloudy sky, and only when the air is wet.
export function rainFrom(cloud, wet) {
  return clamp((wet - 0.5) / 0.4, 0, 1) * clamp((cloud - 0.5) / 0.35, 0, 1);
}

// ---------------------------------------------------------------- live weather

// Current conditions from Open-Meteo (free, no key, allows browser requests).
// Resolves to the same shape as weatherAt(): cloud, rain, snow, fog, wind in 0..1.
export async function fetchWeather(latitude, longitude) {
  const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + latitude + '&longitude=' + longitude
    + '&current=cloud_cover,precipitation,snowfall,weather_code,wind_speed_10m';
  const res = await fetch(url);
  if (!res.ok) throw new Error('Open-Meteo answered HTTP ' + res.status);
  const data = await res.json();
  return weatherFromOpenMeteo(data.current);
}

// WMO weather codes that imply precipitation, with a visual intensity.
const CODE_INTENSITY = {
  51: 0.15, 53: 0.3, 55: 0.45, 56: 0.2, 57: 0.4,      // drizzle
  61: 0.3, 63: 0.55, 65: 0.85, 66: 0.4, 67: 0.7,      // rain
  71: 0.3, 73: 0.55, 75: 0.85, 77: 0.3,               // snow
  80: 0.35, 81: 0.6, 82: 0.9, 85: 0.4, 86: 0.75,      // showers
  95: 0.7, 96: 0.85, 99: 1                            // thunderstorms
};
const SNOW_CODES = [71, 73, 75, 77, 85, 86];

export function weatherFromOpenMeteo(c) {
  const code = Number(c.weather_code) || 0;
  let cloud = clamp((Number(c.cloud_cover) || 0) / 100, 0, 1);
  // "precipitation" is millimetres in the current 15-minute interval; 6 mm/h is heavy.
  let rain = clamp((Number(c.precipitation) || 0) * 4 / 6, 0, 1);
  if (CODE_INTENSITY[code] != null) rain = Math.max(rain, CODE_INTENSITY[code]);
  const snow = (Number(c.snowfall) || 0) > 0 || SNOW_CODES.includes(code) ? 1 : 0;
  const fog = code === 45 || code === 48 ? 1 : 0;
  const wind = clamp((Number(c.wind_speed_10m) || 0) / 45, 0, 1);
  if (rain > 0) cloud = Math.max(cloud, 0.6);
  return { cloud, rain, snow, fog, wind, code, time: c.time, source: 'open-meteo' };
}

// ---------------------------------------------------------------- seasons

// Northern-hemisphere meteorological seasons as weights that sum to one,
// blending over about three weeks at each boundary.
export function seasonWeights(doy) {
  const d = ((doy % 365) + 365) % 365;
  const band = (start, end) => {
    const w = 10;
    if (start < end) return smoothstep(start - w, start + w, d) * (1 - smoothstep(end - w, end + w, d));
    return Math.max(smoothstep(start - w, start + w, d), 1 - smoothstep(end - w, end + w, d));
  };
  const s = { spring: band(60, 152), summer: band(152, 244), autumn: band(244, 335), winter: band(335, 60) };
  const total = s.spring + s.summer + s.autumn + s.winter || 1;
  for (const k in s) s[k] /= total;
  return s;
}

// ---------------------------------------------------------------- office clock

function zoneParts(tMs, timeZone) {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone, hourCycle: 'h23',
      year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric'
    }).formatToParts(new Date(tMs));
  } catch (e) { return null; }
}

// Wall-clock time in the office's time zone.
export function officeClock(tMs, timeZone) {
  const d = new Date(tMs);
  const parts = zoneParts(tMs, timeZone);
  const get = type => parts ? Number((parts.find(p => p.type === type) || {}).value) : NaN;
  let year = get('year'), hour = get('hour'), minute = get('minute'), second = get('second'), month = get('month'), day = get('day');
  if (!Number.isFinite(hour)) {
    year = d.getFullYear(); hour = d.getHours(); minute = d.getMinutes(); second = d.getSeconds();
    month = d.getMonth() + 1; day = d.getDate();
  }
  hour = hour % 24;
  const cum = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  const doy = cum[month - 1] + day;
  return { hours: hour + minute / 60 + second / 3600, hour, minute, second, doy, year, utcOffset: utcOffsetHours(tMs, timeZone) };
}

// Hours the office clock is ahead of UTC at the given instant (handles daylight saving).
export function utcOffsetHours(tMs, timeZone) {
  const parts = zoneParts(tMs, timeZone);
  if (!parts) return -new Date(tMs).getTimezoneOffset() / 60;
  const g = t => Number(parts.find(p => p.type === t).value);
  const asUtc = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute'), g('second'));
  return Math.round((asUtc - tMs) / 60000) / 60;
}

// ---------------------------------------------------------------- the sun

// NOAA solar equations: equation of time (minutes) and declination (radians).
function solarBasics(doy, utcHours) {
  const g = 2 * Math.PI / 365 * (doy - 1 + (utcHours - 12) / 24);
  const eqTime = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g)
    - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g)
    + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  return { eqTime, decl };
}

// Where the sun is: elevation above the horizon in degrees, and azimuth in
// degrees from south, west positive (-90 is east, +90 is west).
export function solarPosition(hours, doy, latitude, longitude, utcOffset) {
  const utcHours = hours - utcOffset;
  const { eqTime, decl } = solarBasics(doy, utcHours);
  const trueSolarMin = utcHours * 60 + eqTime + 4 * longitude;
  const ha = (trueSolarMin / 4 - 180) * Math.PI / 180;
  const lat = latitude * Math.PI / 180;
  const cosZen = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(ha);
  const elevation = 90 - Math.acos(clamp(cosZen, -1, 1)) * 180 / Math.PI;
  const azimuth = Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(lat) - Math.tan(decl) * Math.cos(lat)) * 180 / Math.PI;
  return { elevation, azimuth };
}

// Sunrise, sunset and solar noon in office clock hours. Accurate to a couple
// of minutes, which is plenty for a window.
export function sunTimes(doy, latitude, longitude, utcOffset) {
  const { eqTime, decl } = solarBasics(doy, 12);
  const lat = latitude * Math.PI / 180;
  const cosHa = Math.cos(90.833 * Math.PI / 180) / (Math.cos(lat) * Math.cos(decl)) - Math.tan(lat) * Math.tan(decl);
  const ha = Math.acos(clamp(cosHa, -1, 1)) * 180 / Math.PI;
  const noonMin = 720 - 4 * longitude - eqTime;
  const toLocal = min => min / 60 + utcOffset;
  return { sunrise: toLocal(noonMin - 4 * ha), sunset: toLocal(noonMin + 4 * ha), noon: toLocal(noonMin) };
}

// Light at the window, driven by the sun's elevation:
//   daylight 0..1  brightness: full above 3°, a quarter at civil dusk (-6°),
//                  almost nothing below nautical dusk (-12°)
//   twilight 0..1  strength of sunrise/sunset colours, peaking just below the horizon
//   stars    0..1  how many stars show; only bright ones during nautical twilight
//   x        0..1  where the sun is across a south-facing window (0 east, 1 west)
//   moonFrac 0..1  how far the night has progressed, for the moon's arc
export function sunState(hours, doy, latitude, longitude, utcOffset) {
  const { sunrise, sunset } = sunTimes(doy, latitude, longitude, utcOffset);
  const { elevation, azimuth } = solarPosition(hours, doy, latitude, longitude, utcOffset);
  const daylight = 0.75 * smoothstep(-6, 3, elevation) + 0.22 * smoothstep(-12, -6, elevation) + 0.03 * smoothstep(-15, -12, elevation);
  const twilight = smoothstep(-10, -3, elevation) * (1 - smoothstep(0, 8, elevation));
  const stars = 1 - smoothstep(-14, -5, elevation);
  const nightLen = 24 - (sunset - sunrise);
  const sinceSunset = ((hours - sunset) % 24 + 24) % 24;
  const moonFrac = sinceSunset / nightLen;
  return { daylight, twilight, stars, elevation, azimuth, x: (azimuth + 90) / 180, moonFrac, sunrise, sunset };
}

// Sky gradient colours for the current light, weather and season.
export function skyColors(daylight, twilight, wx, dayTop = '#3d8fdc', dayBot = '#c3e4f8') {
  const night = ['#0a1230', '#1b2a4a'];
  const day = [dayTop, dayBot];
  const dawn = ['#6d6fa8', '#f2b07a'];
  let top = lerpHex(night[0], day[0], daylight);
  let bot = lerpHex(night[1], day[1], daylight);
  top = lerpHex(top, dawn[0], twilight * 0.6);
  bot = lerpHex(bot, dawn[1], twilight * 0.9);
  const grey = wx.cloud * 0.55 * daylight + wx.rain * 0.3 * daylight + wx.fog * 0.6 * daylight;
  top = lerpHex(top, '#7d8896', grey);
  bot = lerpHex(bot, '#b4bcc4', grey);
  return [top, bot];
}
