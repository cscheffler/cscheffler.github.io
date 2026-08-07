// Live, non-blocking warnings — SPEC §7.
//
// Voice: what is wrong, what to do. No apologising, no exclamation marks.
//
// Pure: every function takes a document and returns indices or descriptors, so
// the whole panel is testable without a DOM.

import {
  SIZE, idx, xy, region, inRegion, isOdd, luminance, isPureBlack,
} from './state.js';

/** Below this, a pixel is effectively unlit — DECISIONS.md #4. */
export const DARK_THRESHOLD = 0.02;
/** The one-click "make it visible" colour. On the 15-step grid, luminance 0.10. */
export const LIGHTEN_TO = '#5A5A5A';

const NEIGHBOURS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/**
 * Black pixels that touch the outside — SPEC §1, §7.
 *
 * Black enclosed by lit pixels is the reason black is in the palette: it reads
 * as a deliberate hole. Black that is 4-connected to a transparent cell, or to
 * the edge of the drawing area, reads as transparent instead and quietly eats
 * the silhouette. Only the second kind is a problem, so only it is flagged.
 */
export function findEdgeBlack(doc) {
  const grid = doc.grid ?? 'full';
  const isBlack = (x, y) => {
    if (!inRegion(grid, x, y)) return false;
    const color = doc.pixels[idx(x, y)];
    return color !== null && isPureBlack(color);
  };

  // Seeds: black cells with a transparent 4-neighbour, or one outside the
  // drawing area — both count as "the outside".
  const queue = [];
  const seen = new Set();
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (!isBlack(x, y)) continue;
      const exposed = NEIGHBOURS.some(([dx, dy]) => {
        const nx = x + dx;
        const ny = y + dy;
        if (!inRegion(grid, nx, ny)) return true;
        return doc.pixels[idx(nx, ny)] === null;
      });
      if (!exposed) continue;
      seen.add(idx(x, y));
      queue.push([x, y]);
    }
  }

  // Then spread through connected black. A black pixel whose only route to the
  // outside is through other black pixels is just as invisible as they are —
  // the whole connected run reads as one bite out of the silhouette, so
  // flagging only its rim would undercount what the user actually loses.
  while (queue.length) {
    const [x, y] = queue.pop();
    for (const [dx, dy] of NEIGHBOURS) {
      const nx = x + dx;
      const ny = y + dy;
      if (!isBlack(nx, ny)) continue;
      const i = idx(nx, ny);
      if (seen.has(i)) continue;
      seen.add(i);
      queue.push([nx, ny]);
    }
  }
  return [...seen].sort((a, b) => a - b);
}

/**
 * Pixels too dark to read. Pure black is excluded — it is handled above, and
 * enclosed black is deliberate rather than a mistake.
 */
export function findVeryDark(doc) {
  const grid = doc.grid ?? 'full';
  const out = [];
  for (let i = 0; i < doc.pixels.length; i++) {
    const color = doc.pixels[i];
    if (color === null || isPureBlack(color)) continue;
    const { x, y } = xy(i);
    if (!inRegion(grid, x, y)) continue;
    if (luminance(color) < DARK_THRESHOLD) out.push(i);
  }
  return out;
}

/** Paint stranded in the row and column odd-grid mode drops — SPEC §5. */
export function findGutter(doc) {
  const grid = doc.grid ?? 'full';
  if (!isOdd(grid)) return [];
  const out = [];
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (inRegion(grid, x, y)) continue;
      if (doc.pixels[idx(x, y)] !== null) out.push(idx(x, y));
    }
  }
  return out;
}

export function litCountInRegion(doc) {
  const grid = doc.grid ?? 'full';
  let n = 0;
  for (let i = 0; i < doc.pixels.length; i++) {
    if (doc.pixels[i] === null) continue;
    const { x, y } = xy(i);
    if (inRegion(grid, x, y)) n++;
  }
  return n;
}

/** True when paint reaches all four edges of the drawing area. */
export function touchesAllEdges(doc) {
  const grid = doc.grid ?? 'full';
  const { x0, y0, size } = region(grid);
  const x1 = x0 + size - 1;
  const y1 = y0 + size - 1;
  let left = false;
  let right = false;
  let top = false;
  let bottom = false;

  for (let y = y0; y <= y1; y++) {
    if (doc.pixels[idx(x0, y)] !== null) left = true;
    if (doc.pixels[idx(x1, y)] !== null) right = true;
  }
  for (let x = x0; x <= x1; x++) {
    if (doc.pixels[idx(x, y0)] !== null) top = true;
    if (doc.pixels[idx(x, y1)] !== null) bottom = true;
  }
  return left && right && top && bottom;
}

const plural = (n, one, many) => (n === 1 ? one : many);

/**
 * All warnings for a document, most actionable first. An empty array means
 * there is nothing to say — the panel shows its all-clear state.
 *
 * SPEC §7.4 (low contrast between adjacent regions) is deliberately not
 * implemented; see DECISIONS.md.
 */
export function runLint(doc) {
  const warnings = [];

  const gutter = findGutter(doc);
  if (gutter.length) {
    warnings.push({
      id: 'gutter',
      cells: gutter,
      message: `${gutter.length} ${plural(gutter.length, 'pixel sits', 'pixels sit')} in the row and column this grid mode drops. They will not be exported.`,
      fixes: [{ label: 'Clear them', action: 'clear' }],
    });
  }

  const edgeBlack = findEdgeBlack(doc);
  if (edgeBlack.length) {
    warnings.push({
      id: 'black-edge',
      cells: edgeBlack,
      message: `${edgeBlack.length} black ${plural(edgeBlack.length, 'pixel touches', 'pixels touch')} the outside. They will read as transparent and change the silhouette.`,
      fixes: [
        { label: 'Make transparent', action: 'clear' },
        { label: `Lighten to ${LIGHTEN_TO}`, action: 'lighten' },
      ],
    });
  }

  const dark = findVeryDark(doc);
  if (dark.length) {
    warnings.push({
      id: 'too-dark',
      cells: dark,
      message: `${dark.length} ${plural(dark.length, 'pixel is', 'pixels are')} too dark to read on the display.`,
      fixes: [{ label: `Lighten to ${LIGHTEN_TO}`, action: 'lighten' }],
    });
  }

  if (litCountInRegion(doc) === 0) {
    warnings.push({ id: 'empty', cells: [], message: 'Nothing is drawn yet.', fixes: [] });
  } else if (touchesAllEdges(doc)) {
    warnings.push({
      id: 'edges',
      cells: [],
      message: 'The drawing reaches all four edges. Edge-to-edge designs lose their silhouette against the dark panel.',
      fixes: [],
    });
  }

  return warnings;
}

/** Applies a warning's one-click fix. Returns true if the document changed. */
export function applyFix(doc, cells, action) {
  let changed = false;
  for (const i of cells) {
    const next = action === 'lighten' ? LIGHTEN_TO : null;
    if (doc.pixels[i] === next) continue;
    doc.pixels[i] = next;
    changed = true;
  }
  if (changed) doc.updatedAt = Date.now();
  return changed;
}
