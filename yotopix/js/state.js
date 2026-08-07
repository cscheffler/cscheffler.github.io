// Document model and the pixel-index helpers.
//
// SPEC §12.9: the y*16+x maths is written once, here, and every other module
// goes through it. Do not inline the arithmetic anywhere else.

export const SIZE = 16;
export const PIXEL_COUNT = SIZE * SIZE;

/** Index into `pixels` for a cell. Row-major. */
export function idx(x, y) {
  return y * SIZE + x;
}

/** Inverse of idx(). */
export function xy(i) {
  return { x: i % SIZE, y: (i / SIZE) | 0 };
}

export function inBounds(x, y) {
  return x >= 0 && y >= 0 && x < SIZE && y < SIZE;
}

function uuid() {
  // crypto.randomUUID needs a secure context; http://localhost qualifies but a
  // LAN address does not, and the app has to keep working there.
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((n) => n.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function createDoc(name = 'Untitled') {
  const now = Date.now();
  return {
    id: uuid(),
    name,
    createdAt: now,
    updatedAt: now,
    pixels: new Array(PIXEL_COUNT).fill(null),
    grid: 'full',
  };
}

export function getPixel(doc, x, y) {
  return inBounds(x, y) ? doc.pixels[idx(x, y)] : null;
}

/** Returns true if the document actually changed. */
export function setPixel(doc, x, y, color) {
  if (!inBounds(x, y)) return false;
  const i = idx(x, y);
  if (doc.pixels[i] === color) return false;
  doc.pixels[i] = color;
  doc.updatedAt = Date.now();
  return true;
}

export function clearPixels(doc) {
  const had = doc.pixels.some((p) => p !== null);
  doc.pixels.fill(null);
  if (had) doc.updatedAt = Date.now();
  return had;
}

export function litCount(doc) {
  let n = 0;
  for (const p of doc.pixels) if (p !== null) n++;
  return n;
}

/**
 * Accepts "#abc", "abc", "#AABBCC", "aabbcc". Returns "#RRGGBB" uppercase,
 * or null if it isn't a colour. The model stores nothing else — SPEC §4.
 */
export function normaliseHex(value) {
  if (typeof value !== 'string') return null;
  let s = value.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(s)) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
  else if (!/^[0-9a-fA-F]{6}$/.test(s)) return null;
  return `#${s.toUpperCase()}`;
}

/** sRGB relative luminance, 0..1. Used by the device preview and (later) lint. */
export function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

/** Pure black is the one colour the display cannot show — SPEC §1. */
export function isPureBlack(hex) {
  return hex === '#000000';
}

// ---------------------------------------------------------------- regions
//
// SPEC §5, odd-grid mode. 16 is even, so a 16x16 canvas has no centre pixel —
// the axis falls BETWEEN columns 7 and 8. Odd-grid mode restricts drawing to a
// 15x15 region so a real centre pixel exists.
//
// It is a MASK, never a resize: the document is always 256 pixels. The name
// says which corner the active region is anchored to, so `odd-br` drops the top
// row and the left column.

export const GRID_MODES = ['full', 'odd-tl', 'odd-tr', 'odd-bl', 'odd-br'];

export function region(grid) {
  switch (grid) {
    case 'odd-tl': return { x0: 0, y0: 0, size: 15 };
    case 'odd-tr': return { x0: 1, y0: 0, size: 15 };
    case 'odd-bl': return { x0: 0, y0: 1, size: 15 };
    case 'odd-br': return { x0: 1, y0: 1, size: 15 };
    default: return { x0: 0, y0: 0, size: SIZE };
  }
}

export function isOdd(grid) {
  return grid !== 'full';
}

export function inRegion(grid, x, y) {
  const { x0, y0, size } = region(grid);
  return x >= x0 && y >= y0 && x < x0 + size && y < y0 + size;
}

/**
 * Mirror of x across the region's vertical centre.
 * Full grid: 15 - x. odd-br (x0 = 1): 16 - x.
 * Write it once here and use it for every symmetry mode — SPEC §5, §15.3.
 */
export function mirrorX(grid, x) {
  const { x0, size } = region(grid);
  return 2 * x0 + size - 1 - x;
}

export function mirrorY(grid, y) {
  const { y0, size } = region(grid);
  return 2 * y0 + size - 1 - y;
}

/** Reflect across y = x. Valid only because the region is always square. */
export function transpose(grid, x, y) {
  const { x0, y0 } = region(grid);
  return { x: x0 + (y - y0), y: y0 + (x - x0) };
}

/**
 * Centre of the active region, in cell coordinates. In odd mode this lands ON
 * a cell (an integer); in full mode it lands BETWEEN cells (an .5 value). Grid
 * guides are computed from this rather than hardcoded.
 */
export function centre(grid) {
  const { x0, y0, size } = region(grid);
  return { x: x0 + (size - 1) / 2, y: y0 + (size - 1) / 2 };
}

export const SYMMETRY_MODES = ['off', 'vertical', 'horizontal', 'quad', 'eight'];

/**
 * Every cell an edit at (x, y) should touch under a symmetry mode, de-duplicated
 * and clipped to the active region.
 *
 * v1 only exposes 'off' and 'vertical'. The other modes are implemented because
 * SPEC §15.3 explicitly asks for the helper to be region-aware from the start —
 * this is one of the two places the working agreement sanctions groundwork. No
 * UI exposes them.
 */
export function symmetryCells(grid, x, y, mode = 'off') {
  const out = [];
  const seen = new Set();
  const add = (cx, cy) => {
    if (!inRegion(grid, cx, cy)) return;
    const key = idx(cx, cy);
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ x: cx, y: cy });
  };

  add(x, y);
  if (mode === 'off') return out;

  const mx = mirrorX(grid, x);
  const my = mirrorY(grid, y);

  if (mode === 'vertical' || mode === 'quad' || mode === 'eight') add(mx, y);
  if (mode === 'horizontal' || mode === 'quad' || mode === 'eight') add(x, my);
  if (mode === 'quad' || mode === 'eight') add(mx, my);

  if (mode === 'eight') {
    // Reflect the four cells produced so far across y = x.
    for (const cell of [...out]) {
      const t = transpose(grid, cell.x, cell.y);
      add(t.x, t.y);
    }
  }
  return out;
}

// ---------------------------------------------------------------- history
//
// SPEC §4: whole-pixel snapshots, capped. One entry per stroke, not per pixel
// (SPEC §12.5) — the caller marks a stroke with begin()/commit().
//
// Snapshots carry `grid` as well as `pixels`, because switching grid mode can
// shift or drop pixels; undoing that has to restore the mode too or the user is
// left with art that no longer matches the mask.

const HISTORY_LIMIT = 100;

function snapshot(doc) {
  return { pixels: doc.pixels.slice(), grid: doc.grid };
}

function restore(doc, snap) {
  doc.pixels = snap.pixels.slice();
  doc.grid = snap.grid;
  doc.updatedAt = Date.now();
}

function sameState(snap, doc) {
  if (snap.grid !== doc.grid) return false;
  for (let i = 0; i < PIXEL_COUNT; i++) {
    if (snap.pixels[i] !== doc.pixels[i]) return false;
  }
  return true;
}

export function createHistory(limit = HISTORY_LIMIT) {
  let past = [];
  let future = [];
  let pending = null;

  return {
    /** Capture the pre-edit state. Safe to call repeatedly; last one wins. */
    begin(doc) {
      pending = snapshot(doc);
    },
    /** Push the captured state if the document actually changed. */
    commit(doc) {
      if (!pending) return false;
      const before = pending;
      pending = null;
      if (sameState(before, doc)) return false;
      past.push(before);
      if (past.length > limit) past.shift();
      future = [];
      return true;
    },
    cancel() {
      pending = null;
    },
    undo(doc) {
      if (!past.length) return false;
      future.push(snapshot(doc));
      restore(doc, past.pop());
      return true;
    },
    redo(doc) {
      if (!future.length) return false;
      past.push(snapshot(doc));
      restore(doc, future.pop());
      return true;
    },
    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
    depth: () => past.length,
    clear() {
      past = [];
      future = [];
      pending = null;
    },
  };
}
