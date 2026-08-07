/** Core document helpers. Pixel data is always a 16 × 16 row-major array. */
export const GRID_SIZE = 16;
export const PIXEL_COUNT = GRID_SIZE * GRID_SIZE;

export const GRID_MODES = Object.freeze(["full", "odd-tl", "odd-tr", "odd-bl", "odd-br"]);

export function indexFor(x, y) {
  if (!isInBounds(x, y)) return -1;
  return y * GRID_SIZE + x;
}

export function pointFor(index) {
  if (!Number.isInteger(index) || index < 0 || index >= PIXEL_COUNT) return null;
  return { x: index % GRID_SIZE, y: Math.floor(index / GRID_SIZE) };
}

export function isInBounds(x, y) {
  return Number.isInteger(x) && Number.isInteger(y)
    && x >= 0 && x < GRID_SIZE && y >= 0 && y < GRID_SIZE;
}

/** Normalise a binary-alpha display colour, returning null for transparency. */
export function normalizeColor(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") throw new TypeError("Pixel colours must be null or a #RRGGBB string.");
  const color = value.trim().toUpperCase();
  if (!/^#[0-9A-F]{6}$/.test(color)) {
    throw new TypeError(`Invalid pixel colour: ${value}`);
  }
  return color;
}

export function createPixels(pixels = null) {
  if (pixels === null || pixels === undefined) return Array(PIXEL_COUNT).fill(null);
  if (!Array.isArray(pixels) || pixels.length !== PIXEL_COUNT) {
    throw new TypeError(`pixels must contain exactly ${PIXEL_COUNT} entries.`);
  }
  return pixels.map(normalizeColor);
}

export function isGridMode(grid) {
  return GRID_MODES.includes(grid);
}

export function normalizeGrid(grid = "full") {
  if (!isGridMode(grid)) throw new TypeError(`Unknown grid mode: ${grid}`);
  return grid;
}

/** The drawable bounds, inclusive, for a grid mode. */
export function activeBounds(grid = "full") {
  switch (normalizeGrid(grid)) {
    case "odd-tl": return { x0: 0, y0: 0, x1: 14, y1: 14 };
    case "odd-tr": return { x0: 1, y0: 0, x1: 15, y1: 14 };
    case "odd-bl": return { x0: 0, y0: 1, x1: 14, y1: 15 };
    case "odd-br": return { x0: 1, y0: 1, x1: 15, y1: 15 };
    default: return { x0: 0, y0: 0, x1: 15, y1: 15 };
  }
}

export function isActiveCell(x, y, grid = "full") {
  const bounds = activeBounds(grid);
  return isInBounds(x, y) && x >= bounds.x0 && x <= bounds.x1 && y >= bounds.y0 && y <= bounds.y1;
}

export function createDocument({ id = crypto.randomUUID(), name = "Untitled icon", createdAt = Date.now(), updatedAt = createdAt, pixels = null, grid = "full" } = {}) {
  return { id, name: String(name), createdAt, updatedAt, pixels: createPixels(pixels), grid: normalizeGrid(grid) };
}

export function setPixel(document, x, y, color) {
  if (!isActiveCell(x, y, document.grid)) return false;
  const index = indexFor(x, y);
  if (index < 0) return false;
  const next = normalizeColor(color);
  if (document.pixels[index] === next) return false;
  document.pixels[index] = next;
  document.updatedAt = Date.now();
  return true;
}

/**
 * Snapshot-based undo history for an icon document. Snapshots deliberately
 * contain only the 256 pixel values: document metadata is not an edit made by
 * a drawing tool, and restoring a snapshot marks the document as newly
 * updated. A history instance belongs to one currently-open document.
 */
export class PixelHistory {
  constructor({ limit = 100 } = {}) {
    if (!Number.isInteger(limit) || limit < 50) {
      throw new RangeError("History limit must be an integer of at least 50 entries.");
    }
    this.limit = limit;
    this.undoStack = [];
    this.redoStack = [];
    this.transaction = null;
  }

  get canUndo() {
    return this.undoStack.length > 0;
  }

  get canRedo() {
    return this.redoStack.length > 0;
  }

  get isTransacting() {
    return this.transaction !== null;
  }

  /** Start one atomic edit, for example at pointerdown or before a fill. */
  begin(document) {
    if (this.transaction !== null) {
      throw new Error("A history transaction is already active.");
    }
    this.transaction = snapshotPixels(document);
  }

  /**
   * Commit the active edit. Returns true only when pixels actually changed,
   * so no-op strokes and fills do not consume undo entries.
   */
  commit(document) {
    const before = this.takeTransaction();
    const after = snapshotPixels(document);
    if (pixelsEqual(before, after)) return false;

    this.undoStack.push(before);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack.length = 0;
    document.updatedAt = Date.now();
    return true;
  }

  /** Discard an active transaction without adding a history entry. */
  cancel() {
    this.transaction = null;
  }

  /**
   * Execute a synchronous edit atomically. The edit may use setPixel or
   * replace document.pixels; it is recorded only when its final pixels differ.
   */
  run(document, edit) {
    this.begin(document);
    try {
      const result = edit(document);
      this.commit(document);
      return result;
    } catch (error) {
      this.cancel();
      throw error;
    }
  }

  undo(document) {
    if (this.transaction !== null) {
      throw new Error("Cannot undo while a history transaction is active.");
    }
    if (!this.canUndo) return false;
    const current = snapshotPixels(document);
    const previous = this.undoStack.pop();
    this.redoStack.push(current);
    this.restore(document, previous);
    return true;
  }

  redo(document) {
    if (this.transaction !== null) {
      throw new Error("Cannot redo while a history transaction is active.");
    }
    if (!this.canRedo) return false;
    const current = snapshotPixels(document);
    const next = this.redoStack.pop();
    this.undoStack.push(current);
    this.restore(document, next);
    return true;
  }

  clear() {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.transaction = null;
  }

  takeTransaction() {
    if (this.transaction === null) {
      throw new Error("No history transaction is active.");
    }
    const snapshot = this.transaction;
    this.transaction = null;
    return snapshot;
  }

  restore(document, pixels) {
    if (!document || typeof document !== "object") {
      throw new TypeError("A document is required to restore history.");
    }
    document.pixels = createPixels(pixels);
    document.updatedAt = Date.now();
  }
}

export function createPixelHistory(options) {
  return new PixelHistory(options);
}

function pixelsEqual(first, second) {
  return first.length === second.length && first.every((pixel, index) => pixel === second[index]);
}

function snapshotPixels(document) {
  if (!document || typeof document !== "object") {
    throw new TypeError("A document is required for history.");
  }
  return createPixels(document.pixels);
}
