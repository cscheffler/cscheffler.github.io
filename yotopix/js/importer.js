// Image -> 16x16 (or 15x15 in odd-grid mode) downscaling — SPEC §8.
//
// Everything below the decode step is pure and works on a plain
// { width, height, data } image, so it can be tested without a DOM.
//
// Pipeline order matters and follows the spec: crop -> downsample -> alpha
// threshold -> brightness/saturation -> optional perceptual palette match ->
// mandatory snap to the display's 15-step channel grid (§1). The last step is
// not optional and is separate from the palette match: the panel cannot show
// anything off that grid, whether or not the user asked for palette colours.
//
// No dithering. At 16x16 it reads as noise (§8).

import { quantiseHex } from './state.js';
import { srgbToOklab } from './oklab.js';

export const BOX = 'box';
export const NEAREST = 'nearest';

// ------------------------------------------------------------------ decode

/** Browser-only: file or blob -> ImageData. */
export async function decodeToImageData(source) {
  const bitmap = await createImageBitmap(source);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close?.();
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

// -------------------------------------------------------------------- crop

/** Largest centred square. Squashing a rectangle to 16x16 always looks wrong. */
export function centreCrop(width, height) {
  const size = Math.min(width, height);
  return {
    x: Math.floor((width - size) / 2),
    y: Math.floor((height - size) / 2),
    size,
  };
}

/** Keeps a crop square, at least 1px, and fully inside the image. */
export function clampCrop(crop, width, height) {
  const max = Math.min(width, height);
  const size = Math.max(1, Math.min(Math.round(crop.size), max));
  return {
    size,
    x: Math.max(0, Math.min(Math.round(crop.x), width - size)),
    y: Math.max(0, Math.min(Math.round(crop.y), height - size)),
  };
}

// -------------------------------------------------------------- sampling

/**
 * Averages a source rectangle, weighting colour by alpha.
 *
 * The weighting matters: a transparent pixel usually carries RGB 0, so a naive
 * mean drags every edge toward black and produces a dark halo around cut-out
 * artwork. Accumulating premultiplied colour and dividing by total alpha is the
 * correct un-premultiply and keeps edges the colour they look.
 */
export function boxSample(image, x0, y0, x1, y1) {
  const { width, data } = image;
  let sr = 0;
  let sg = 0;
  let sb = 0;
  let sa = 0;
  let n = 0;

  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * width + x) * 4;
      const a = data[i + 3];
      sr += data[i] * a;
      sg += data[i + 1] * a;
      sb += data[i + 2] * a;
      sa += a;
      n++;
    }
  }
  if (n === 0) return { r: 0, g: 0, b: 0, a: 0 };
  if (sa === 0) return { r: 0, g: 0, b: 0, a: 0 };
  return { r: sr / sa, g: sg / sa, b: sb / sa, a: sa / n };
}

export function nearestSample(image, x0, y0, x1, y1) {
  const { width, data } = image;
  const x = Math.min(x1 - 1, Math.floor((x0 + x1) / 2));
  const y = Math.min(y1 - 1, Math.floor((y0 + y1) / 2));
  const i = (y * width + x) * 4;
  return { r: data[i], g: data[i + 1], b: data[i + 2], a: data[i + 3] };
}

// --------------------------------------------------------------- adjust

const clamp255 = (v) => Math.max(0, Math.min(255, v));

/**
 * Brightness is a gain, saturation a lerp away from luma. Downscaled images come
 * out muddy on this display, so the caller defaults saturation to +20% (§8).
 */
export function adjustColor({ r, g, b }, brightness = 0, saturation = 0) {
  const gain = 1 + brightness / 100;
  let nr = r * gain;
  let ng = g * gain;
  let nb = b * gain;

  const s = 1 + saturation / 100;
  const luma = 0.2126 * nr + 0.7152 * ng + 0.0722 * nb;
  nr = luma + (nr - luma) * s;
  ng = luma + (ng - luma) * s;
  nb = luma + (nb - luma) * s;

  return { r: clamp255(nr), g: clamp255(ng), b: clamp255(nb) };
}

// --------------------------------------------------------------- OKLab

/**
 * Re-exported so the perceptual match reads the same as it always did. The
 * transform itself now lives in oklab.js, shared with the ramp generator.
 */
export const oklab = (r, g, b) => srgbToOklab(r, g, b);

export function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHex({ r, g, b }) {
  const part = (v) => Math.round(v).toString(16).padStart(2, '0');
  return `#${part(r)}${part(g)}${part(b)}`.toUpperCase();
}

/** Precomputes OKLab for a palette so matching is not O(n) conversions per cell. */
export function preparePalette(hexes) {
  return hexes.map((hex) => {
    const { r, g, b } = hexToRgb(hex);
    return { hex, lab: oklab(r, g, b) };
  });
}

export function nearestPaletteColor({ r, g, b }, prepared) {
  const target = oklab(r, g, b);
  let best = null;
  let bestDistance = Infinity;
  for (const entry of prepared) {
    const dL = target.L - entry.lab.L;
    const da = target.a - entry.lab.a;
    const db = target.b - entry.lab.b;
    const distance = dL * dL + da * da + db * db;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = entry.hex;
    }
  }
  return best;
}

// ------------------------------------------------------------------ build

/**
 * Produces `size * size` entries of "#RRGGBB" or null, row-major.
 *
 * `alphaThreshold` is 0..1. Source alpha above it becomes fully opaque, below it
 * fully transparent — the model is binary alpha and nothing else is
 * representable (§4).
 */
export function buildPixels(image, {
  crop,
  size = 16,
  method = BOX,
  alphaThreshold = 0.5,
  brightness = 0,
  saturation = 0,
  palette = null,
} = {}) {
  const area = clampCrop(crop ?? centreCrop(image.width, image.height), image.width, image.height);
  const prepared = palette && palette.length ? preparePalette(palette) : null;
  const sample = method === NEAREST ? nearestSample : boxSample;
  const out = new Array(size * size).fill(null);

  for (let cy = 0; cy < size; cy++) {
    for (let cx = 0; cx < size; cx++) {
      const x0 = area.x + Math.floor((cx * area.size) / size);
      const y0 = area.y + Math.floor((cy * area.size) / size);
      // At least one source pixel per cell, even when the crop is tiny.
      const x1 = Math.max(x0 + 1, area.x + Math.floor(((cx + 1) * area.size) / size));
      const y1 = Math.max(y0 + 1, area.y + Math.floor(((cy + 1) * area.size) / size));

      const raw = sample(image, x0, y0, Math.min(x1, image.width), Math.min(y1, image.height));
      if (raw.a / 255 < alphaThreshold) continue;

      const adjusted = adjustColor(raw, brightness, saturation);
      const hex = prepared
        ? nearestPaletteColor(adjusted, prepared)
        : rgbToHex(adjusted);
      // Mandatory, whether or not a palette match happened: the panel resolves
      // channels only in steps of 15. Palette colours are already on the grid,
      // so this is a no-op for them.
      out[cy * size + cx] = quantiseHex(hex);
    }
  }
  return out;
}
