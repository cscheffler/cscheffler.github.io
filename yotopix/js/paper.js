// Paper to pixel — SPEC §15.2.
//
// Print a blank grid, let a child colour it in, photograph it, and recover the
// icon. The photo is never square on and never well lit, so the pipeline is:
//
//   four corner handles -> homography -> average each cell -> white balance
//   -> drop the blank cells -> snap to the palette -> snap to the 15-step grid
//
// Pure: works on a plain { width, height, data } image, so all of it is
// testable without a DOM or a camera.

import { quantiseHex } from './state.js';
import { solveHomography, project } from './homography.js';
import { preparePalette, nearestPaletteColor, rgbToHex } from './importer.js';

/**
 * How far into each cell to sample, as a fraction of the cell. The printed grid
 * has ruled lines and children colour over them, so the outer band of every
 * cell is unreliable; only the middle is the child's colour choice.
 */
const CELL_INSET = 0.26;
/** Samples per axis inside that middle region. 4x4 = 16 per cell. */
const SAMPLES = 4;

const clamp255 = (v) => Math.max(0, Math.min(255, v));

function pixelAt(image, x, y) {
  const px = Math.max(0, Math.min(image.width - 1, Math.round(x)));
  const py = Math.max(0, Math.min(image.height - 1, Math.round(y)));
  const i = (py * image.width + px) * 4;
  return { r: image.data[i], g: image.data[i + 1], b: image.data[i + 2] };
}

/**
 * Average colour of every cell, in row-major order. Returns nulls-free RGB —
 * "is this cell blank" is decided later, after white balance, because a cream
 * photo of white paper is not white until it has been corrected.
 */
export function sampleCells(image, quad, size = 16) {
  const h = solveHomography(quad);
  if (!h) return null;

  const out = [];
  const step = (1 - 2 * CELL_INSET) / (SAMPLES - 1);

  for (let cy = 0; cy < size; cy++) {
    for (let cx = 0; cx < size; cx++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;

      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const u = (cx + CELL_INSET + sx * step) / size;
          const v = (cy + CELL_INSET + sy * step) / size;
          const point = project(h, u, v);
          if (!point) continue;
          const p = pixelAt(image, point.x, point.y);
          r += p.r;
          g += p.g;
          b += p.b;
          n++;
        }
      }
      out.push(n ? { r: r / n, g: g / n, b: b / n } : { r: 0, g: 0, b: 0 });
    }
  }
  return out;
}

const luma = ({ r, g, b }) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

/** Saturation as a fraction, so a bright yellow is not mistaken for paper. */
export function saturationOf({ r, g, b }) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max <= 0 ? 0 : (max - min) / max;
}

/**
 * Estimates the paper colour from the brightest cells.
 *
 * Photographed white paper is rarely white — indoor light makes it cream, a
 * window makes it blue. Everything downstream compares against "paper", so
 * getting this wrong tints the whole icon. The brightest cells are the
 * uncoloured ones, which is the most reliable white reference in the frame.
 */
export function estimatePaperWhite(samples) {
  if (!samples.length) return { r: 255, g: 255, b: 255 };
  const sorted = [...samples].sort((a, b) => luma(b) - luma(a));
  const take = Math.max(1, Math.round(sorted.length * 0.15));
  const top = sorted.slice(0, take);
  const sum = top.reduce((acc, s) => ({ r: acc.r + s.r, g: acc.g + s.g, b: acc.b + s.b }), { r: 0, g: 0, b: 0 });
  return { r: sum.r / take, g: sum.g / take, b: sum.b / take };
}

/**
 * Per-channel gain so the paper reads as white. Gains are clamped: a wild
 * correction usually means the estimate was wrong, and blowing the picture out
 * is worse than leaving it slightly warm.
 */
export function whiteBalanceGains(paper) {
  const gain = (c) => Math.max(0.5, Math.min(2.5, c > 1 ? 255 / c : 1));
  return { r: gain(paper.r), g: gain(paper.g), b: gain(paper.b) };
}

export function applyGains(sample, gains) {
  return {
    r: clamp255(sample.r * gains.r),
    g: clamp255(sample.g * gains.g),
    b: clamp255(sample.b * gains.b),
  };
}

/**
 * Blank means "the child left the paper showing": bright AND unsaturated. The
 * brightness test alone would erase a yellow crayon, which is bright and very
 * much a colour.
 */
export function isBlank(sample, threshold) {
  return luma(sample) >= threshold && saturationOf(sample) < 0.22;
}

export function boostSaturation({ r, g, b }, amount) {
  if (!amount) return { r, g, b };
  const s = 1 + amount / 100;
  const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return {
    r: clamp255(l + (r - l) * s),
    g: clamp255(l + (g - l) * s),
    b: clamp255(l + (b - l) * s),
  };
}

/**
 * The whole pipeline: photo plus four corners in, `size * size` entries of
 * "#RRGGBB" or null out.
 *
 * `palette` is snapped to by default here, unlike the ordinary image importer:
 * crayon on paper under household light lands nowhere near a clean colour, and
 * matching it to the palette is what makes the result look drawn rather than
 * photographed.
 */
export function buildFromPhoto(image, quad, {
  size = 16,
  paperThreshold = 0.72,
  saturation = 25,
  palette = null,
  whiteBalance = true,
} = {}) {
  const samples = sampleCells(image, quad, size);
  if (!samples) return null;

  const gains = whiteBalance
    ? whiteBalanceGains(estimatePaperWhite(samples))
    : { r: 1, g: 1, b: 1 };
  const prepared = palette && palette.length ? preparePalette(palette) : null;

  return samples.map((raw) => {
    const balanced = applyGains(raw, gains);
    if (isBlank(balanced, paperThreshold)) return null;
    const boosted = boostSaturation(balanced, saturation);
    const hex = prepared ? nearestPaletteColor(boosted, prepared) : rgbToHex(boosted);
    // Mandatory whatever else happened: the panel resolves channels in steps
    // of 15 (SPEC §1).
    return quantiseHex(hex);
  });
}
