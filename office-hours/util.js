// util.js — small shared helpers. No DOM, no side effects.

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const lerp = (a, b, t) => a + (b - a) * t;

export function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

// Deterministic PRNG so every viewer draws the same plant and the same sky.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Integer hash to [0, 1). Used for time-keyed noise.
export function hash01(n) {
  let x = (n | 0) ^ 0x5bd1e995;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const v = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

export function rgbToHex([r, g, b]) {
  const c = v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0');
  return '#' + c(r) + c(g) + c(b);
}

export function lerpHex(a, b, t) {
  const A = hexToRgb(a), B = hexToRgb(b);
  t = clamp(t, 0, 1);
  return rgbToHex([lerp(A[0], B[0], t), lerp(A[1], B[1], t), lerp(A[2], B[2], t)]);
}

// Weighted average of colours: [[hex, weight], ...]
export function mixHex(entries) {
  let r = 0, g = 0, b = 0, tw = 0;
  for (const [hex, w] of entries) {
    if (!(w > 0)) continue;
    const c = hexToRgb(hex);
    r += c[0] * w; g += c[1] * w; b += c[2] * w; tw += w;
  }
  if (!tw) return entries[0][0];
  return rgbToHex([r / tw, g / tw, b / tw]);
}

export function shadeHex(hex, f) {
  return rgbToHex(hexToRgb(hex).map(v => v * f));
}

// Compact number for SVG attributes.
export const n = v => (Math.round(v * 10) / 10).toString();
