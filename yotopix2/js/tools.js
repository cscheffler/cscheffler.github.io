import {
  GRID_SIZE,
  activeBounds,
  createPixels,
  indexFor,
  isActiveCell,
  isInBounds,
  normalizeColor,
} from "./state.js";

/**
 * Return every integer cell touched by a line, including both endpoints.
 * Keeping interpolation independent of pointer handling makes it reusable by
 * the later line and symmetry tools.
 */
export function bresenhamLine(x0, y0, x1, y1) {
  const cells = [];
  let x = x0;
  let y = y0;
  const dx = Math.abs(x1 - x0);
  const sx = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0);
  const sy = y0 < y1 ? 1 : -1;
  let error = dx + dy;

  while (true) {
    cells.push({ x, y });
    if (x === x1 && y === y1) break;

    const doubledError = 2 * error;
    if (doubledError >= dy) {
      error += dy;
      x += sx;
    }
    if (doubledError <= dx) {
      error += dx;
      y += sy;
    }
  }

  return cells;
}

/**
 * Return the 4-connected active cells that have the same value as (x, y).
 * `null` is deliberately an ordinary fill target: transparent areas fill just
 * like coloured ones. Inactive odd-grid gutters never participate.
 */
export function floodFillCells(pixels, x, y, grid = "full") {
  const source = createPixels(pixels);
  if (!isActiveCell(x, y, grid)) return [];

  const target = source[indexFor(x, y)];
  const visited = new Set();
  const cells = [];
  const pending = [{ x, y }];

  while (pending.length > 0) {
    const cell = pending.pop();
    const index = indexFor(cell.x, cell.y);
    if (index < 0 || visited.has(index) || !isActiveCell(cell.x, cell.y, grid)) continue;
    visited.add(index);
    if (source[index] !== target) continue;

    cells.push(cell);
    pending.push(
      { x: cell.x + 1, y: cell.y },
      { x: cell.x - 1, y: cell.y },
      { x: cell.x, y: cell.y + 1 },
      { x: cell.x, y: cell.y - 1 },
    );
  }

  return cells;
}

/** Return a new pixel array after a 4-connected fill, without mutating input. */
export function floodFill(pixels, x, y, color, grid = "full") {
  const next = createPixels(pixels);
  const fillColor = normalizeColor(color);
  for (const cell of floodFillCells(next, x, y, grid)) {
    next[indexFor(cell.x, cell.y)] = fillColor;
  }
  return next;
}

/**
 * Produce the active cells in an inclusive rectangle. Coordinates may be in
 * either drag direction and may be outside the canvas; returned cells are
 * clipped to the active grid. Use `filled: true` for the rectangle interior.
 */
export function rectangleCells(x0, y0, x1, y1, { filled = false, grid = "full" } = {}) {
  if (![x0, y0, x1, y1].every(Number.isInteger)) {
    throw new TypeError("Rectangle coordinates must be integers.");
  }

  const left = Math.min(x0, x1);
  const right = Math.max(x0, x1);
  const top = Math.min(y0, y1);
  const bottom = Math.max(y0, y1);
  const cells = [];

  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) {
      const isEdge = x === left || x === right || y === top || y === bottom;
      if ((filled || isEdge) && isActiveCell(x, y, grid)) cells.push({ x, y });
    }
  }
  return cells;
}

/**
 * Shift every canvas cell by the supplied integer offsets, wrapping at all
 * edges. This intentionally shifts the full 16x16 document, including odd
 * grid gutters, so a user can move artwork out of a newly inactive gutter.
 */
export function shiftPixels(pixels, offsetX, offsetY) {
  if (!Number.isInteger(offsetX) || !Number.isInteger(offsetY)) {
    throw new TypeError("Shift offsets must be integers.");
  }
  const source = createPixels(pixels);
  const next = Array(GRID_SIZE * GRID_SIZE).fill(null);
  const wrap = (value) => ((value % GRID_SIZE) + GRID_SIZE) % GRID_SIZE;

  for (let y = 0; y < GRID_SIZE; y += 1) {
    for (let x = 0; x < GRID_SIZE; x += 1) {
      next[indexFor(wrap(x + offsetX), wrap(y + offsetY))] = source[indexFor(x, y)];
    }
  }
  return next;
}

/**
 * Expand a cell to its vertical-mirror partner within the active region.
 * Odd grids mirror around their actual centre column; the centre maps to
 * itself and is returned once. Inactive/out-of-bounds source cells return [].
 */
export function verticalMirrorCells(x, y, grid = "full") {
  if (!isInBounds(x, y) || !isActiveCell(x, y, grid)) return [];
  const { x0, x1 } = activeBounds(grid);
  const mirrorX = x0 + x1 - x;
  const cells = [{ x, y }];
  if (mirrorX !== x) cells.push({ x: mirrorX, y });
  return cells;
}
