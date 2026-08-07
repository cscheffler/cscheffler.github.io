import {
  GRID_SIZE,
  createPixels,
  indexFor,
  isActiveCell,
  normalizeColor,
  normalizeGrid,
} from "./state.js";

/** WCAG relative luminance for an opaque #RRGGBB display colour. */
export function relativeLuminance(color) {
  const value = normalizeColor(color);
  if (value === null) return 0;
  const channels = [1, 3, 5].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16) / 255);
  const linear = channels.map((channel) => (
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  ));
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

export const DARK_LUMINANCE_THRESHOLD = 0.08;

/** Metadata lets the UI render stable, accessible actions without lint owning DOM. */
export const BLACK_FIXES = Object.freeze([
  Object.freeze({ id: "black-transparent", label: "Make transparent", replacement: null }),
  Object.freeze({ id: "black-1e1e1e", label: "Replace with #1E1E1E", replacement: "#1E1E1E" }),
  Object.freeze({ id: "black-3c3c3c", label: "Replace with #3C3C3C", replacement: "#3C3C3C" }),
]);

/**
 * Analyse only drawable cells for display warnings. Inactive odd-grid gutter
 * pixels are reported separately: they cannot appear in an export.
 */
export function analyzeDocument(document, { darkLuminanceThreshold = DARK_LUMINANCE_THRESHOLD } = {}) {
  if (!document || typeof document !== "object") {
    throw new TypeError("A document is required for linting.");
  }
  if (!Number.isFinite(darkLuminanceThreshold) || darkLuminanceThreshold < 0) {
    throw new RangeError("darkLuminanceThreshold must be a non-negative finite number.");
  }

  const pixels = createPixels(document.pixels);
  const grid = normalizeGrid(document.grid ?? "full");
  let painted = 0;
  let black = 0;
  let veryDark = 0;
  let gutter = 0;
  const edges = { top: false, right: false, bottom: false, left: false };

  for (let y = 0; y < GRID_SIZE; y += 1) {
    for (let x = 0; x < GRID_SIZE; x += 1) {
      const color = pixels[indexFor(x, y)];
      if (color === null) continue;
      if (!isActiveCell(x, y, grid)) {
        gutter += 1;
        continue;
      }

      painted += 1;
      if (color === "#000000") {
        black += 1;
      } else if (relativeLuminance(color) < darkLuminanceThreshold) {
        // Black has its own, clearer warning and is intentionally not duplicated.
        veryDark += 1;
      }
      edges.top ||= !isActiveCell(x, y - 1, grid);
      edges.right ||= !isActiveCell(x + 1, y, grid);
      edges.bottom ||= !isActiveCell(x, y + 1, grid);
      edges.left ||= !isActiveCell(x - 1, y, grid);
    }
  }

  const warnings = [];
  if (black > 0) {
    warnings.push({
      id: "pure-black",
      severity: "warning",
      count: black,
      message: `${black} ${plural(black, "pixel is", "pixels are")} pure black. These won't light up on the display.`,
      actions: BLACK_FIXES,
    });
  }
  if (veryDark > 0) {
    warnings.push({
      id: "very-dark",
      severity: "warning",
      count: veryDark,
      message: `${veryDark} ${plural(veryDark, "pixel may", "pixels may")} be too dark to read on the display.`,
      actions: Object.freeze([]),
    });
  }
  if (painted === 0) {
    warnings.push({
      id: "empty-icon",
      severity: "info",
      count: 0,
      message: "This icon is empty. Draw or import something to begin.",
      actions: Object.freeze([]),
    });
  }
  if (edges.top && edges.right && edges.bottom && edges.left) {
    warnings.push({
      id: "touches-all-edges",
      severity: "info",
      count: 4,
      message: "This icon touches all four edges. A little space can help its silhouette read on the dark panel.",
      actions: Object.freeze([]),
    });
  }
  if (gutter > 0) {
    warnings.push({
      id: "inactive-gutter",
      severity: "warning",
      count: gutter,
      message: `${gutter} ${plural(gutter, "painted pixel is", "painted pixels are")} in the inactive gutter. They export as transparent.`,
      actions: Object.freeze([Object.freeze({ id: "clear-inactive-gutter", label: "Clear gutter" })]),
    });
  }
  return warnings;
}

/** Return a new pixel array with one exact colour replaced in drawable cells. */
export function replaceExactColor(pixels, fromColor, toColor, grid = "full") {
  const source = createPixels(pixels);
  const from = normalizeColor(fromColor);
  const to = normalizeColor(toColor);
  const mode = normalizeGrid(grid);
  return source.map((color, index) => {
    const x = index % GRID_SIZE;
    const y = Math.floor(index / GRID_SIZE);
    return isActiveCell(x, y, mode) && color === from ? to : color;
  });
}

/** Return a new pixel array with every inactive odd-grid cell cleared. */
export function clearInactiveGutters(pixels, grid = "full") {
  const source = createPixels(pixels);
  const mode = normalizeGrid(grid);
  return source.map((color, index) => {
    const x = index % GRID_SIZE;
    const y = Math.floor(index / GRID_SIZE);
    return isActiveCell(x, y, mode) ? color : null;
  });
}

/** Replace active pure-black pixels using one of the documented black fixes. */
export function replacePureBlack(pixels, replacement, grid = "full") {
  return replaceExactColor(pixels, "#000000", replacement, grid);
}

export function makePureBlackTransparent(pixels, grid = "full") {
  return replacePureBlack(pixels, null, grid);
}

export function replacePureBlackWith1E(pixels, grid = "full") {
  return replacePureBlack(pixels, "#1E1E1E", grid);
}

export function replacePureBlackWith3C(pixels, grid = "full") {
  return replacePureBlack(pixels, "#3C3C3C", grid);
}

function plural(count, singular, pluralForm) {
  return count === 1 ? singular : pluralForm;
}
