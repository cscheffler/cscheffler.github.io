// Device preview: renders the icon the way the Player's LED panel actually
// shows it. This is the signature element of the app — SPEC §6.

import { SIZE, idx, isPureBlack } from './state.js';

const PANEL_BG = '#0B0B0D'; // near-black chrome; never pure black — that's reserved (see isUnlit).

/**
 * True for a pixel the display cannot light: transparent, or authored as
 * pure black. The hardware has no way to distinguish "no colour" from
 * "#000000" — both are simply an LED that stays off — so the preview must
 * render them identically, on purpose, rather than treating black as a
 * normal (if dark) colour.
 */
export function isUnlit(color) {
  return color === null || isPureBlack(color);
}

/**
 * Draws `doc` onto `canvas` as the device would show it.
 * `options`: { cssSize, glow = false }.
 */
export function drawPreview(canvas, doc, { cssSize, glow = false }) {
  // DPR can change between calls (window dragged to another monitor), so this
  // is re-checked every draw. But `canvas.width = n` clears the canvas and
  // forces a backing-store realloc even when n is unchanged, and drawPreview
  // runs on every stroke — so only touch it when the pixel size actually moved.
  const dpr = window.devicePixelRatio || 1;
  const pxSize = Math.round(cssSize * dpr);
  if (canvas.width !== pxSize || canvas.height !== pxSize) {
    canvas.width = pxSize;
    canvas.height = pxSize;
  }
  canvas.style.width = `${cssSize}px`;
  canvas.style.height = `${cssSize}px`;

  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // draw in CSS-pixel units from here on
  ctx.imageSmoothingEnabled = false;

  ctx.fillStyle = PANEL_BG;
  ctx.fillRect(0, 0, cssSize, cssSize);

  const cellSize = cssSize / SIZE;
  const gutter = Math.max(0.5, cellSize * 0.09);
  const lit = cellSize - gutter * 2;

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const color = doc.pixels[idx(x, y)];
      if (isUnlit(color)) continue; // bare panel shows through — no fillRect needed

      // Snap to device pixels so the inset square stays crisp instead of
      // blurring across a fractional boundary at HiDPI scales.
      const left = Math.round((x * cellSize + gutter) * dpr) / dpr;
      const top = Math.round((y * cellSize + gutter) * dpr) / dpr;
      const size = Math.round(lit * dpr) / dpr;

      if (glow) {
        ctx.shadowColor = color;
        ctx.shadowBlur = cellSize * 0.6;
      }
      ctx.fillStyle = color;
      ctx.fillRect(left, top, size, size);
      if (glow) {
        // Reset immediately so the shadow never leaks onto the next cell,
        // and so the non-glow path (which never sets it) is never at risk.
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
      }
    }
  }
}
