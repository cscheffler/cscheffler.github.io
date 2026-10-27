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

import { clamp, hash01, lerp, lerpHex, smoothstep } from './util.js';

export const HOUR_MS = 3600e3;

// The weather the scene draws (every value 0..1 unless noted):
//   cloud     low and middle cloud, the kind that hides the sky
//   cirrus    high, thin cloud: streaks and a milky veil
//   rain      precipitation intensity; snow (0 or 1) says whether it falls as snow
//   fog       mist and fog
//   wind      wind speed; windX is the drift across the window, -1 left .. 1 right
//   storm     how far beyond an ordinary windy day it is: 0 up to a strong breeze,
//             1 in a gale. Bends the trees and tears off leaves.
//   gloomData how much less light gets through than on a clear day, from the modelled
//             sunshine; null when unknown (night, synthetic weather)
//   sunData   how much of that light is direct sunshine, i.e. how visible the sun is; null when unknown
// finishWeather() turns these into gloom and sunVis, which is what the scene uses.

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

// All drift over hours. Leans cloudy, as central Scotland does, and the wind is
// mostly westerly, so the clouds mostly drift left.
export function weatherAt(tMs, seed = 0) {
  const h = tMs / HOUR_MS;
  let cloud = 0.55 * smoothNoise(h, 5, seed + 1) + 0.3 * smoothNoise(h, 1.7, seed + 2) + 0.15 * smoothNoise(h, 0.5, seed + 3);
  cloud = clamp((cloud - 0.05) / 0.6, 0, 1);
  const wet = smoothNoise(h, 3.5, seed + 4);
  const rain = rainFrom(cloud, wet);
  if (rain > 0) cloud = Math.max(cloud, 0.85 + 0.15 * rain);
  const cirrus = clamp(1.6 * smoothNoise(h, 6, seed + 6) - 0.6, 0, 1);
  const wind = 0.15 + 0.85 * smoothNoise(h, 2.5, seed + 5);
  const windX = -0.35 - 0.65 * smoothNoise(h, 9, seed + 7);
  return { cloud, cirrus, wet, rain, snow: 0, fog: 0, wind, windX, storm: 0, gloomData: null, sunData: null, source: 'synthetic' };
}

// Rain only falls from a mostly cloudy sky, and only when the air is wet.
export function rainFrom(cloud, wet) {
  return clamp((wet - 0.5) / 0.4, 0, 1) * clamp((cloud - 0.5) / 0.35, 0, 1);
}

// ---------------------------------------------------------------- live weather

// Models averaged for the cloud and the light. A single high-resolution model flips
// between 0% and 100% from hour to hour, and is often an hour out; the mean of three
// models over a few hours is steadier and closer to the sky outside. The first model
// also supplies the "current" block: precipitation, weather code, visibility and wind.
// For Stirling the UK Met Office model is the one Open-Meteo would pick by itself.
export const WEATHER_MODELS = ['ukmo_seamless', 'icon_seamless', 'ecmwf_ifs025'];
const HOURLY = ['cloud_cover', 'cloud_cover_low', 'cloud_cover_mid', 'cloud_cover_high',
  'shortwave_radiation', 'direct_radiation', 'terrestrial_radiation'];

// Current conditions from Open-Meteo (free, no key, allows browser requests).
// Resolves to the same shape as weatherAt().
export async function fetchWeather(latitude, longitude, nowMs = Date.now()) {
  const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + latitude + '&longitude=' + longitude
    + '&models=' + WEATHER_MODELS.join(',')
    + '&current=precipitation,snowfall,weather_code,visibility,wind_speed_10m,wind_direction_10m,wind_gusts_10m'
    + '&hourly=' + HOURLY.join(',')
    + '&past_hours=3&forecast_hours=4&timeformat=unixtime';
  const res = await fetch(url);
  if (!res.ok) throw new Error('Open-Meteo answered HTTP ' + res.status);
  return weatherFromOpenMeteo(await res.json(), nowMs);
}

// Mean of an hourly series around time t (seconds), weighted by a triangle `half` seconds wide each side.
function around(times, values, t, half) {
  let sw = 0, sv = 0;
  times.forEach((ts, i) => {
    const w = 1 - Math.abs(ts - t) / half;
    if (w > 0 && Number.isFinite(values[i])) { sw += w; sv += w * values[i]; }
  });
  return sw ? sv / sw : null;
}

// Ratio of two series' weighted sums around t, skipping hours where the denominator is
// below `min` (the sun too low for the ratio to mean much).
function ratioAround(times, num, den, t, half, min) {
  let a = 0, b = 0;
  times.forEach((ts, i) => {
    const w = 1 - Math.abs(ts - t) / half;
    if (w > 0 && Number.isFinite(num[i]) && den[i] >= min) { a += w * num[i]; b += w * den[i]; }
  });
  return b ? clamp(a / b, 0, 1) : null;
}

// Drift across a south-facing window: wind from the west carries clouds left (east).
// Winds from due north or south still drift a little, so the sky never freezes.
export function windAcross(fromDeg) {
  if (!Number.isFinite(fromDeg)) return -0.6;
  const s = Math.sin(fromDeg * Math.PI / 180);
  return (s < 0 ? -1 : 1) * Math.max(Math.abs(s), 0.3);
}

// The least cloud a weather code allows: rain falls from a broken sky only in showers.
function cloudFloor(code, rain) {
  if ((code >= 51 && code <= 67) || (code >= 71 && code <= 77)) return 0.95;  // drizzle, rain, snow
  if (code >= 95) return 0.85;                                                // thunderstorms
  if (code >= 80 && code <= 86) return 0.6;                                   // showers
  if (code === 3) return 0.9;                                                 // overcast
  return rain > 0 ? 0.7 : 0;
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

export function weatherFromOpenMeteo(data, nowMs = Date.now()) {
  const c = data.current || {};
  const hr = data.hourly || {};
  const times = hr.time || [];
  const t = nowMs / 1000;
  // Cloud is instantaneous at each hour; radiation is the mean over the hour before.
  const models = WEATHER_MODELS.map(m => {
    const get = k => hr[k + '_' + m] || hr[k] || [];
    const avg = k => around(times, get(k), t, 2 * 3600);
    const ratio = (a, b, min) => ratioAround(times, get(a), get(b), t - 1800, 1.5 * 3600, min);
    return {
      model: m, total: avg('cloud_cover'), low: avg('cloud_cover_low'), mid: avg('cloud_cover_mid'), high: avg('cloud_cover_high'),
      kt: ratio('shortwave_radiation', 'terrestrial_radiation', 60),
      direct: ratio('direct_radiation', 'shortwave_radiation', 30)
    };
  });
  const mean = k => {
    const v = models.map(m => m[k]).filter(Number.isFinite);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  if (mean('total') == null) throw new Error('Open-Meteo returned no cloud cover');
  const pct = k => clamp((mean(k) ?? mean('total')) / 100, 0, 1);
  const total = pct('total'), low = pct('low'), mid = pct('mid'), high = pct('high');

  const code = Number(c.weather_code) || 0;
  // "precipitation" is millimetres in the current 15-minute interval; 6 mm/h is heavy.
  let rain = clamp((Number(c.precipitation) || 0) * 4 / 6, 0, 1);
  if (CODE_INTENSITY[code] != null) rain = Math.max(rain, CODE_INTENSITY[code]);
  const snow = (Number(c.snowfall) || 0) > 0 || SNOW_CODES.includes(code) ? 1 : 0;

  // What hides the sky is the low and middle cloud, combined as if they overlap at
  // random; high cirrus is thin and drawn separately.
  let cloud = Math.max(low, 0.85 * mid, Math.min(total, 1 - (1 - low) * (1 - 0.85 * mid)));
  cloud = Math.max(cloud, cloudFloor(code, rain));

  // Mist from visibility, on a log scale: 10 km clear, 2 km misty, 400 m thick fog.
  // Rain cuts visibility too, and has its own veil, so it counts for less while raining.
  const vis = Number(c.visibility);
  let fog = vis > 0 ? clamp(Math.log(10000 / vis) / Math.log(10000 / 400), 0, 1) * (1 - rain) : 0;
  if (code === 45 || code === 48) fog = Math.max(fog, 0.85);

  // The clearness index (sunlight at the ground over sunlight above the atmosphere) is
  // about 0.7 under a clear sky and 0.1 to 0.2 under thick cloud.
  const kt = mean('kt'), direct = mean('direct');
  const gloomData = kt == null ? null : clamp((0.7 - kt) / 0.5, 0, 1);
  const sunData = direct == null ? null : smoothstep(0.1, 0.5, direct);

  const speed = Number(c.wind_speed_10m) || 0, gusts = Number(c.wind_gusts_10m) || 0;
  const wind = clamp(speed / 45, 0, 1);
  const windX = windAcross(Number(c.wind_direction_10m));
  // A blustery Stirling day (35 km/h, gusts to 70) is not a storm. Trees start to bend
  // from a strong breeze (40 km/h, or gusts over 75) and thrash in a gale (65, or gusts of 110).
  const storm = Math.max(smoothstep(40, 65, speed), smoothstep(75, 110, gusts));
  return {
    cloud, cirrus: high, rain, snow, fog, wind, windX, storm, gloomData, sunData, code, time: c.time, source: 'open-meteo',
    debug: { fetched: nowMs, models, total, low, mid, high, current: c }
  };
}

// How dull the day is (gloom) and how visible the sun is (sunVis), from the modelled
// sunshine when there is some, otherwise from the cloud and rain.
export function finishWeather(wx) {
  const fromCloud = clamp(0.85 * smoothstep(0.5, 1, wx.cloud) + 0.35 * wx.rain + 0.25 * wx.fog, 0, 1);
  let gloom = wx.gloomData != null ? 0.65 * wx.gloomData + 0.35 * fromCloud : fromCloud;
  if (wx.rain > 0.02) gloom = Math.max(gloom, 0.45 + 0.55 * wx.rain);
  const sunVis = wx.sunData != null ? wx.sunData : (1 - smoothstep(0.8, 1, wx.cloud)) * (1 - 0.4 * wx.cirrus);
  return { ...wx, gloom: clamp(gloom, 0, 1), sunVis: clamp(sunVis, 0, 1) };
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
// wx must have been through finishWeather().
export function skyColors(daylight, twilight, wx, dayTop = '#3d8fdc', dayBot = '#c3e4f8') {
  const night = ['#0a1230', '#1b2a4a'];
  const day = [dayTop, dayBot];
  const dawn = ['#6d6fa8', '#f2b07a'];
  let top = lerpHex(night[0], day[0], daylight);
  let bot = lerpHex(night[1], day[1], daylight);
  const colour = twilight * (1 - 0.7 * wx.cloud);
  top = lerpHex(top, dawn[0], colour * 0.6);
  bot = lerpHex(bot, dawn[1], colour * 0.9);
  // High cirrus turns the blue milky.
  top = lerpHex(top, '#c4d0dc', 0.35 * wx.cirrus * daylight);
  bot = lerpHex(bot, '#dde3e8', 0.3 * wx.cirrus * daylight);
  // Behind heavy low cloud the sky is grey. By day the gaps stay blue until the cover
  // is nearly complete; by night a cloudy sky is one even glow.
  const [overTop, overBot] = overcastSky(daylight, twilight, wx.gloom);
  const grey = clamp(lerp(smoothstep(0.2, 0.9, wx.cloud), 0.65 * smoothstep(0.3, 1, wx.cloud), daylight)
    + 0.6 * wx.fog + 0.3 * wx.rain, 0, 1);
  return [lerpHex(top, overTop, grey), lerpHex(bot, overBot, grey)];
}

// An overcast sky: light grey by day, darker the duller the day, and at night the
// dull orange-grey of cloud lit from below by the town.
export function overcastSky(daylight, twilight, gloom) {
  const top = lerpHex('#2a2930', lerpHex('#b2b8be', '#6f767e', 0.8 * gloom), daylight);
  let bot = lerpHex('#463b36', lerpHex('#aeb4ba', '#7a8087', 0.8 * gloom), daylight);
  bot = lerpHex(bot, '#a08880', 0.25 * twilight);
  return [top, bot];
}
