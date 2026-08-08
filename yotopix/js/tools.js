// Tools: pen, eraser, flood fill, eyedropper, line, rectangle, canvas shift.
//
// Every write to the document goes through applyCells(), which is the single
// place symmetry and the region mask are enforced. Tools produce a set of
// cells; applyCells decides what actually lands.

import { SIZE, PIXEL_COUNT, idx, inRegion, symmetryCells } from './state.js';

export const PEN = 'pen';
export const ERASER = 'eraser';
export const FILL = 'fill';
export const EYEDROPPER = 'eyedropper';
export const LINE = 'line';
export const RECT = 'rect';
export const SHADE = 'shade';

/** Tools that paint by dragging a continuous stroke. */
export const STROKE_TOOLS = new Set([PEN, ERASER, SHADE]);
/** Tools that preview a shape while dragging and commit on release. */
export const SHAPE_TOOLS = new Set([LINE, RECT]);

/**
 * Bresenham between two cells, inclusive of both ends. Pointer samples are far
 * apart on a fast drag, so every stroke goes through this — SPEC §12.1, the
 * number one bug in hand-rolled pixel editors.
 */
export function bresenham(x0, y0, x1, y1, visit) {
  let x = x0;
  let y = y0;
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    visit(x, y);
    if (x === x1 && y === y1) return;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

export function linePoints(x0, y0, x1, y1) {
  const out = [];
  bresenham(x0, y0, x1, y1, (x, y) => out.push({ x, y }));
  return out;
}

/** Rectangle between two corners. Outline by default, solid when filled. */
export function rectPoints(x0, y0, x1, y1, filled = false) {
  const left = Math.min(x0, x1);
  const right = Math.max(x0, x1);
  const top = Math.min(y0, y1);
  const bottom = Math.max(y0, y1);
  const out = [];
  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) {
      const edge = x === left || x === right || y === top || y === bottom;
      if (filled || edge) out.push({ x, y });
    }
  }
  return out;
}

/**
 * 4-connected flood fill. Returns the contiguous run of cells matching the
 * colour at the start cell.
 *
 * SPEC §12.8: null is a fillable colour, not a cell to skip. Filling a
 * transparent region is one of the things this tool is most used for.
 */
export function floodFillCells(doc, sx, sy, grid) {
  if (!inRegion(grid, sx, sy)) return [];
  const target = doc.pixels[idx(sx, sy)];
  const seen = new Uint8Array(PIXEL_COUNT);
  const out = [];
  const stack = [[sx, sy]];
  seen[idx(sx, sy)] = 1;

  while (stack.length) {
    const [x, y] = stack.pop();
    out.push({ x, y });
    const neighbours = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
    for (const [nx, ny] of neighbours) {
      if (!inRegion(grid, nx, ny)) continue;
      const i = idx(nx, ny);
      if (seen[i] || doc.pixels[i] !== target) continue;
      seen[i] = 1;
      stack.push([nx, ny]);
    }
  }
  return out;
}

/**
 * Moves the whole image by one or more cells, WRAPPING at the edges — SPEC §5.
 * Always operates on the full 16x16 array, never just the active region: its
 * main job in odd-grid mode is to move art out of the dead zone, which means
 * moving it across the region boundary.
 */
export function shiftPixels(pixels, dx, dy) {
  const out = new Array(PIXEL_COUNT).fill(null);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const nx = (((x + dx) % SIZE) + SIZE) % SIZE;
      const ny = (((y + dy) % SIZE) + SIZE) % SIZE;
      out[idx(nx, ny)] = pixels[idx(x, y)];
    }
  }
  return out;
}

/**
 * The single write path. Applies `color` (null erases) to every given cell plus
 * its symmetric partners, clipped to the active region.
 *
 * Mirroring works on the RESULT of a tool, not on its input: a mirrored flood
 * fill paints the mirror of the filled area rather than running a second fill.
 * De-duplication means a cell on the mirror axis is painted exactly once.
 */
export function applyCells(doc, cells, color, { grid = 'full', symmetry = 'off' } = {}) {
  const written = new Set();
  let changed = false;

  for (const { x, y } of cells) {
    for (const cell of symmetryCells(grid, x, y, symmetry)) {
      const i = idx(cell.x, cell.y);
      if (written.has(i)) continue;
      written.add(i);
      if (doc.pixels[i] === color) continue;
      doc.pixels[i] = color;
      changed = true;
    }
  }
  if (changed) doc.updatedAt = Date.now();
  return changed;
}

/**
 * Like applyCells, but each cell's new colour is computed from what is already
 * there — the shading tool steps a pixel along a ramp rather than painting one
 * value (SPEC §15.1). `getNext` returns null to leave a cell alone.
 *
 * Symmetry mirrors the OPERATION, not the value: a mirrored cell is stepped
 * from its own current colour, which is the only reading that behaves when the
 * two sides are already shaded differently.
 */
export function applyShade(doc, cells, getNext, { grid = 'full', symmetry = 'off' } = {}) {
  const written = new Set();
  let changed = false;

  for (const { x, y } of cells) {
    for (const cell of symmetryCells(grid, x, y, symmetry)) {
      const i = idx(cell.x, cell.y);
      if (written.has(i)) continue;
      written.add(i);
      const next = getNext(doc.pixels[i]);
      if (next === null || next === undefined || doc.pixels[i] === next) continue;
      doc.pixels[i] = next;
      changed = true;
    }
  }
  if (changed) doc.updatedAt = Date.now();
  return changed;
}

/** Cells that a given tool produces for a drag from one cell to another. */
export function cellsForShape(tool, x0, y0, x1, y1, filled) {
  if (tool === LINE) return linePoints(x0, y0, x1, y1);
  if (tool === RECT) return rectPoints(x0, y0, x1, y1, filled);
  return [];
}

/** Non-empty pixels that would be lost by switching to `grid`. */
export function deadZoneCells(doc, grid) {
  const out = [];
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (inRegion(grid, x, y)) continue;
      if (doc.pixels[idx(x, y)] !== null) out.push({ x, y });
    }
  }
  return out;
}
