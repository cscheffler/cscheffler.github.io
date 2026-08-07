import { GRID_SIZE, isActiveCell, normalizeColor } from "./state.js";

export function slugifyFilename(name) {
  const slug = String(name ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug || "icon"}.png`;
}

/** Render only the model to a fresh, exact-size canvas; never scale a UI canvas. */
export function renderExportCanvas(icon) {
  if (!icon?.pixels || icon.pixels.length !== GRID_SIZE * GRID_SIZE) {
    throw new TypeError("A 16×16 icon document is required for export.");
  }
  const canvas = globalThis.document.createElement("canvas");
  canvas.width = GRID_SIZE;
  canvas.height = GRID_SIZE;
  const context = canvas.getContext("2d", { alpha: true, willReadFrequently: true });
  context.imageSmoothingEnabled = false;
  context.clearRect(0, 0, GRID_SIZE, GRID_SIZE);

  for (let y = 0; y < GRID_SIZE; y += 1) {
    for (let x = 0; x < GRID_SIZE; x += 1) {
      if (!isActiveCell(x, y, icon.grid)) continue;
      const color = normalizeColor(icon.pixels[y * GRID_SIZE + x]);
      if (color === null) continue;
      context.fillStyle = color;
      context.fillRect(x, y, 1, 1);
    }
  }
  return canvas;
}

export function exportPngBlob(icon) {
  const canvas = renderExportCanvas(icon);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("PNG export failed.")), "image/png");
  });
}

export async function downloadPng(icon) {
  const blob = await exportPngBlob(icon);
  const url = URL.createObjectURL(blob);
  const anchor = globalThis.document.createElement("a");
  anchor.href = url;
  anchor.download = slugifyFilename(icon.name);
  globalThis.document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
