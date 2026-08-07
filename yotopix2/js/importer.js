/**
 * Pure image-import helpers. RGBA buffers use straight (unpremultiplied)
 * colour channels, as returned by ImageData. No canvas or DOM is required.
 */
import { GRID_SIZE, activeBounds, indexFor, normalizeGrid } from "./state.js";

/** Return the largest centred square that fits inside the source image. */
export function centredSquareCrop(sourceWidth, sourceHeight) {
  assertDimensions(sourceWidth, sourceHeight);
  const size = Math.min(sourceWidth, sourceHeight);
  return { x: (sourceWidth - size) / 2, y: (sourceHeight - size) / 2, size };
}

/** Clamp a user crop to a non-empty square entirely within the source image. */
export function normalizeSquareCrop(crop, sourceWidth, sourceHeight) {
  assertDimensions(sourceWidth, sourceHeight);
  if (!crop || !Number.isFinite(crop.x) || !Number.isFinite(crop.y) || !Number.isFinite(crop.size)) {
    throw new TypeError("A square crop needs finite x, y, and size values.");
  }
  const maximum = Math.min(sourceWidth, sourceHeight);
  const size = clamp(crop.size, Number.EPSILON, maximum);
  return {
    x: clamp(crop.x, 0, sourceWidth - size),
    y: clamp(crop.y, 0, sourceHeight - size),
    size,
  };
}

/** Sample the centre of each destination cell, preserving hard pixel-art edges. */
export function downsampleNearestRgba(source, sourceWidth, sourceHeight, crop, targetWidth, targetHeight) {
  const sourcePixels = assertRgba(source, sourceWidth, sourceHeight);
  const square = normalizeSquareCrop(crop, sourceWidth, sourceHeight);
  assertDimensions(targetWidth, targetHeight);
  const output = new Uint8ClampedArray(targetWidth * targetHeight * 4);

  for (let y = 0; y < targetHeight; y += 1) {
    const sourceY = clamp(Math.floor(square.y + ((y + 0.5) * square.size) / targetHeight), 0, sourceHeight - 1);
    for (let x = 0; x < targetWidth; x += 1) {
      const sourceX = clamp(Math.floor(square.x + ((x + 0.5) * square.size) / targetWidth), 0, sourceWidth - 1);
      const from = (sourceY * sourceWidth + sourceX) * 4;
      const to = (y * targetWidth + x) * 4;
      output[to] = sourcePixels[from];
      output[to + 1] = sourcePixels[from + 1];
      output[to + 2] = sourcePixels[from + 2];
      output[to + 3] = sourcePixels[from + 3];
    }
  }
  return output;
}

/**
 * Area-resample with a box filter. RGB is accumulated premultiplied by alpha,
 * then unpremultiplied, avoiding transparent edge colours bleeding into art.
 */
export function downsampleBoxAverageRgba(source, sourceWidth, sourceHeight, crop, targetWidth, targetHeight) {
  const sourcePixels = assertRgba(source, sourceWidth, sourceHeight);
  const square = normalizeSquareCrop(crop, sourceWidth, sourceHeight);
  assertDimensions(targetWidth, targetHeight);
  const output = new Uint8ClampedArray(targetWidth * targetHeight * 4);
  const cellWidth = square.size / targetWidth;
  const cellHeight = square.size / targetHeight;
  const cellArea = cellWidth * cellHeight;

  for (let y = 0; y < targetHeight; y += 1) {
    const top = square.y + y * cellHeight;
    const bottom = top + cellHeight;
    for (let x = 0; x < targetWidth; x += 1) {
      const left = square.x + x * cellWidth;
      const right = left + cellWidth;
      let alphaArea = 0;
      let redArea = 0;
      let greenArea = 0;
      let blueArea = 0;
      const startY = Math.floor(top);
      const endY = Math.ceil(bottom);
      const startX = Math.floor(left);
      const endX = Math.ceil(right);

      for (let sourceY = startY; sourceY < endY; sourceY += 1) {
        if (sourceY < 0 || sourceY >= sourceHeight) continue;
        const overlapY = Math.max(0, Math.min(bottom, sourceY + 1) - Math.max(top, sourceY));
        if (overlapY === 0) continue;
        for (let sourceX = startX; sourceX < endX; sourceX += 1) {
          if (sourceX < 0 || sourceX >= sourceWidth) continue;
          const area = overlapY * Math.max(0, Math.min(right, sourceX + 1) - Math.max(left, sourceX));
          if (area === 0) continue;
          const from = (sourceY * sourceWidth + sourceX) * 4;
          const alpha = sourcePixels[from + 3] / 255;
          const weightedAlpha = alpha * area;
          alphaArea += weightedAlpha;
          redArea += sourcePixels[from] * weightedAlpha;
          greenArea += sourcePixels[from + 1] * weightedAlpha;
          blueArea += sourcePixels[from + 2] * weightedAlpha;
        }
      }

      const to = (y * targetWidth + x) * 4;
      output[to + 3] = Math.round((alphaArea / cellArea) * 255);
      if (alphaArea > 0) {
        output[to] = Math.round(redArea / alphaArea);
        output[to + 1] = Math.round(greenArea / alphaArea);
        output[to + 2] = Math.round(blueArea / alphaArea);
      }
    }
  }
  return output;
}

/** Make alpha binary. A threshold may be 0…1 or a UI percentage from 0…100. */
export function thresholdAlphaRgba(rgba, threshold = 0.5) {
  const input = assertRgbaBuffer(rgba);
  const cutoff = alphaThresholdByte(threshold);
  const output = new Uint8ClampedArray(input.length);
  for (let offset = 0; offset < input.length; offset += 4) {
    if (input[offset + 3] > cutoff) {
      output[offset] = input[offset];
      output[offset + 1] = input[offset + 1];
      output[offset + 2] = input[offset + 2];
      output[offset + 3] = 255;
    }
  }
  return output;
}

/** Apply percentage adjustments: 0 is neutral; +20 saturation means 1.2×. */
export function adjustRgba(rgba, { brightness = 0, saturation = 0 } = {}) {
  const input = assertRgbaBuffer(rgba);
  if (!Number.isFinite(brightness) || !Number.isFinite(saturation)) {
    throw new TypeError("Brightness and saturation must be finite percentage values.");
  }
  const output = new Uint8ClampedArray(input);
  const brightnessScale = Math.max(0, 1 + brightness / 100);
  const saturationScale = Math.max(0, 1 + saturation / 100);
  for (let offset = 0; offset < output.length; offset += 4) {
    if (output[offset + 3] === 0) continue;
    const red = clamp(output[offset] * brightnessScale, 0, 255);
    const green = clamp(output[offset + 1] * brightnessScale, 0, 255);
    const blue = clamp(output[offset + 2] * brightnessScale, 0, 255);
    const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    output[offset] = Math.round(clamp(luminance + (red - luminance) * saturationScale, 0, 255));
    output[offset + 1] = Math.round(clamp(luminance + (green - luminance) * saturationScale, 0, 255));
    output[offset + 2] = Math.round(clamp(luminance + (blue - luminance) * saturationScale, 0, 255));
  }
  return output;
}

/** Quantise opaque pixels to the closest #RRGGBB palette colour in OKLab. */
export function quantizeRgbaToPalette(rgba, palette) {
  const input = assertRgbaBuffer(rgba);
  const candidates = flattenPalette(palette).map((color) => ({ color, lab: hexToOklab(color) }));
  if (candidates.length === 0) throw new TypeError("Quantisation requires at least one palette colour.");
  const output = new Uint8ClampedArray(input);
  for (let offset = 0; offset < output.length; offset += 4) {
    if (output[offset + 3] === 0) continue;
    const lab = rgbToOklab(output[offset], output[offset + 1], output[offset + 2]);
    let closest = candidates[0];
    let closestDistance = oklabDistanceSquared(lab, closest.lab);
    for (let index = 1; index < candidates.length; index += 1) {
      const candidate = candidates[index];
      const distance = oklabDistanceSquared(lab, candidate.lab);
      if (distance < closestDistance) {
        closest = candidate;
        closestDistance = distance;
      }
    }
    const [red, green, blue] = hexChannels(closest.color);
    output[offset] = red;
    output[offset + 1] = green;
    output[offset + 2] = blue;
  }
  return output;
}

/** Convert a binary RGBA target into a complete 16×16 document, respecting gutters. */
export function placeRgbaIntoDocument(rgba, targetWidth, targetHeight, grid = "full") {
  const input = assertRgbaBuffer(rgba);
  if (input.length !== targetWidth * targetHeight * 4) throw new TypeError("RGBA length does not match target dimensions.");
  const mode = normalizeGrid(grid);
  const bounds = activeBounds(mode);
  const activeWidth = bounds.x1 - bounds.x0 + 1;
  const activeHeight = bounds.y1 - bounds.y0 + 1;
  if (targetWidth !== activeWidth || targetHeight !== activeHeight) {
    throw new RangeError(`Target must be ${activeWidth}×${activeHeight} for ${mode} grid mode.`);
  }
  const pixels = Array(GRID_SIZE * GRID_SIZE).fill(null);
  for (let y = 0; y < targetHeight; y += 1) {
    for (let x = 0; x < targetWidth; x += 1) {
      const from = (y * targetWidth + x) * 4;
      if (input[from + 3] === 0) continue;
      pixels[indexFor(bounds.x0 + x, bounds.y0 + y)] = rgbHex(input[from], input[from + 1], input[from + 2]);
    }
  }
  return pixels;
}

/** Full Phase 5 processing pipeline, returning model-ready 16×16 pixels. */
export function importRgbaToDocumentPixels(source, sourceWidth, sourceHeight, {
  crop = centredSquareCrop(sourceWidth, sourceHeight),
  grid = "full",
  method = "box",
  alphaThreshold = 0.5,
  brightness = 0,
  saturation = 20,
  quantize = false,
  palette = [],
} = {}) {
  const bounds = activeBounds(normalizeGrid(grid));
  const targetWidth = bounds.x1 - bounds.x0 + 1;
  const targetHeight = bounds.y1 - bounds.y0 + 1;
  const downsample = method === "box" ? downsampleBoxAverageRgba
    : method === "nearest" ? downsampleNearestRgba : null;
  if (!downsample) throw new TypeError('Import method must be "box" or "nearest".');
  let target = downsample(source, sourceWidth, sourceHeight, crop, targetWidth, targetHeight);
  target = thresholdAlphaRgba(target, alphaThreshold);
  target = adjustRgba(target, { brightness, saturation });
  if (quantize) target = quantizeRgbaToPalette(target, palette);
  return placeRgbaIntoDocument(target, targetWidth, targetHeight, grid);
}

function flattenPalette(palette) {
  if (!Array.isArray(palette)) throw new TypeError("Palette must be an array of colours or palette groups.");
  return palette.flatMap((entry) => Array.isArray(entry?.colors) ? entry.colors : [entry]).map(normalizeHex);
}

function hexToOklab(hex) { return rgbToOklab(...hexChannels(hex)); }

// Björn Ottosson's OKLab transform: perceptual, dependency-free RGB matching.
function rgbToOklab(red, green, blue) {
  const [r, g, b] = [red, green, blue].map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function oklabDistanceSquared(a, b) {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
}

function alphaThresholdByte(threshold) {
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) {
    throw new RangeError("Alpha threshold must be from 0 to 1, or 0 to 100 percent.");
  }
  return threshold <= 1 ? threshold * 255 : (threshold / 100) * 255;
}

function assertDimensions(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new TypeError("Image dimensions must be positive integers.");
  }
}

function assertRgba(source, width, height) {
  assertDimensions(width, height);
  const rgba = assertRgbaBuffer(source);
  if (rgba.length !== width * height * 4) throw new TypeError("RGBA length does not match source dimensions.");
  return rgba;
}

function assertRgbaBuffer(rgba) {
  if (!ArrayBuffer.isView(rgba) || !Number.isInteger(rgba.length) || rgba.length % 4 !== 0) {
    throw new TypeError("RGBA must be a typed array with four channels per pixel.");
  }
  return rgba;
}

function normalizeHex(color) {
  if (typeof color !== "string" || !/^#[0-9a-f]{6}$/i.test(color.trim())) {
    throw new TypeError("Palette colours must be #RRGGBB strings.");
  }
  return color.trim().toUpperCase();
}

function hexChannels(color) {
  const normalized = normalizeHex(color);
  return [
    Number.parseInt(normalized.slice(1, 3), 16),
    Number.parseInt(normalized.slice(3, 5), 16),
    Number.parseInt(normalized.slice(5, 7), 16),
  ];
}

function rgbHex(red, green, blue) {
  return `#${[red, green, blue].map((channel) => channel.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
