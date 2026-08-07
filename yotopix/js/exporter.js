// 16x16 PNG export.
//
// SPEC §9: the exported file must be exactly 16x16, alpha strictly 0 or 255,
// and RGB exactly equal to the hex the user picked. That means a dedicated
// offscreen canvas and fillRect per pixel — never drawImage from the display
// canvas, never any scaling, never smoothing. Canvas premultiplies alpha, which
// silently mangles values whenever alpha is between 0 and 255; the binary-alpha
// model (SPEC §4) is what keeps this exact.

import { SIZE, idx, inRegion } from './state.js';

/** Draws the document onto a fresh, exactly 16x16 canvas. */
export function renderExact(doc) {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, SIZE, SIZE);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const color = doc.pixels[idx(x, y)];
      if (color === null) continue;
      // Export is always exactly 16x16; in odd-grid mode the dropped row and
      // column are simply transparent, whatever the array happens to hold.
      if (!inRegion(doc.grid ?? 'full', x, y)) continue;
      ctx.fillStyle = color;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return canvas;
}

export function toBlob(doc) {
  return new Promise((resolve, reject) => {
    renderExact(doc).toBlob((blob) => {
      blob ? resolve(blob) : reject(new Error('PNG encoding failed'));
    }, 'image/png');
  });
}

export function slugify(name) {
  const slug = String(name ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return slug || 'icon';
}

export async function downloadPNG(doc) {
  const blob = await toBlob(doc);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${slugify(doc.name)}.png`;
  document.body.append(a);
  a.click();
  a.remove();
  // Revoking immediately can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return `${slugify(doc.name)}.png`;
}

/**
 * Reads a rendered document back as raw RGBA bytes. This is the round-trip
 * check demanded by SPEC §9 / §14 and is used by test.html.
 */
export function readBackPixels(doc) {
  const canvas = renderExact(doc);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  return ctx.getImageData(0, 0, SIZE, SIZE).data;
}

/**
 * Decodes an encoded PNG blob back to RGBA bytes — the honest round trip,
 * going through the actual PNG encoder and decoder rather than reading back
 * the canvas we just drew.
 */
export async function decodeBlob(blob) {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close?.();
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { width: canvas.width, height: canvas.height, data };
}
