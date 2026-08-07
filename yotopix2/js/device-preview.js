/**
 * Render a 16 × 16 icon as it appears on Yoto's emissive display.
 *
 * The class deliberately has no application dependencies: pass it the two
 * canvases that make up the preview and then provide an icon document through
 * setIcon().  It also accepts a bare 256-entry pixel array for lightweight
 * previews such as an import dialog.
 */
const GRID_SIZE = 16;
const PIXEL_COUNT = GRID_SIZE * GRID_SIZE;
const PANEL_COLOR = "#0B0B0E";
const BLACK = "#000000";

export class DevicePreview {
  /**
   * @param {HTMLCanvasElement} lifeCanvas roughly 64 CSS pixels square
   * @param {HTMLCanvasElement} detailCanvas roughly 160 CSS pixels square
   * @param {{ glowEnabled?: boolean }} options
   */
  constructor(lifeCanvas, detailCanvas, { glowEnabled = false } = {}) {
    this.canvases = [lifeCanvas, detailCanvas];
    if (!this.canvases.every((canvas) => canvas instanceof HTMLCanvasElement)) {
      throw new TypeError("DevicePreview requires two canvas elements.");
    }

    this.icon = { pixels: Array(PIXEL_COUNT).fill(null), grid: "full" };
    this.glowEnabled = Boolean(glowEnabled);
    this.contexts = this.canvases.map((canvas, index) => {
      canvas.setAttribute("role", canvas.getAttribute("role") || "img");
      if (!canvas.hasAttribute("aria-label")) {
        canvas.setAttribute("aria-label", index === 0
          ? "Life-size Yoto display preview"
          : "Enlarged Yoto display preview");
      }
      const context = canvas.getContext("2d", { alpha: false });
      context.imageSmoothingEnabled = false;
      return context;
    });

    this.resizeObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(() => this.render());
    this.resizeObserver?.observe(lifeCanvas);
    this.resizeObserver?.observe(detailCanvas);
    this.render();
  }

  /** Set the displayed icon document, or a 256-entry array of pixel colours. */
  setIcon(icon) {
    const pixels = Array.isArray(icon) ? icon : icon?.pixels;
    if (!Array.isArray(pixels) || pixels.length !== PIXEL_COUNT) {
      throw new TypeError("A device preview icon must contain exactly 256 pixels.");
    }
    this.icon = { pixels: pixels.slice(), grid: Array.isArray(icon) ? "full" : icon.grid || "full" };
    this.render();
  }

  /** Enable or disable the deliberately optional LED bloom. It is off by default. */
  setGlowEnabled(enabled) {
    this.glowEnabled = Boolean(enabled);
    this.render();
  }

  render() {
    this.canvases.forEach((canvas, index) => this.renderCanvas(canvas, this.contexts[index]));
  }

  destroy() {
    this.resizeObserver?.disconnect();
  }

  renderCanvas(canvas, context) {
    const { width, height, dpr } = prepareCanvas(canvas, context);
    const side = Math.min(width, height);
    const offsetX = (width - side) / 2;
    const offsetY = (height - side) / 2;
    const cell = side / GRID_SIZE;
    // A one-CSS-pixel gutter is legible at both supplied target sizes.
    const gap = Math.min(1, Math.max(0, cell - 1));

    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.imageSmoothingEnabled = false;
    context.globalCompositeOperation = "source-over";
    context.globalAlpha = 1;
    context.shadowBlur = 0;
    context.fillStyle = PANEL_COLOR;
    context.fillRect(0, 0, width, height);

    for (let y = 0; y < GRID_SIZE; y += 1) {
      for (let x = 0; x < GRID_SIZE; x += 1) {
        if (!isActiveCell(x, y, this.icon.grid)) continue;
        const color = normalisedLitColor(this.icon.pixels[y * GRID_SIZE + x]);
        // Transparent and pure black are both physically unlit on the panel.
        if (!color) continue;

        const left = offsetX + x * cell + gap / 2;
        const top = offsetY + y * cell + gap / 2;
        const ledSize = Math.max(0, cell - gap);
        context.fillStyle = color;
        if (this.glowEnabled) {
          context.shadowColor = color;
          context.shadowBlur = Math.max(1, cell * 0.2);
        } else {
          // This explicit reset keeps colour judgement byte-for-byte faithful.
          context.shadowBlur = 0;
        }
        context.fillRect(left, top, ledSize, ledSize);
      }
    }
    context.shadowBlur = 0;
  }
}

function prepareCanvas(canvas, context) {
  const rect = canvas.getBoundingClientRect();
  // Attribute dimensions are a useful fallback for hidden/detached previews.
  const width = rect.width || Number(canvas.dataset.previewWidth) || canvas.width || 160;
  const height = rect.height || Number(canvas.dataset.previewHeight) || canvas.height || width;
  const dpr = window.devicePixelRatio || 1;
  const backingWidth = Math.max(1, Math.round(width * dpr));
  const backingHeight = Math.max(1, Math.round(height * dpr));

  // Cache the layout size before width/height become HiDPI backing pixels.
  // Stylesheets own the CSS size so responsive breakpoints can still resize it.
  if (!canvas.dataset.previewWidth) canvas.dataset.previewWidth = String(width);
  if (!canvas.dataset.previewHeight) canvas.dataset.previewHeight = String(height);
  if (canvas.width !== backingWidth || canvas.height !== backingHeight) {
    canvas.width = backingWidth;
    canvas.height = backingHeight;
    context.imageSmoothingEnabled = false;
  }
  return { width, height, dpr };
}

function normalisedLitColor(value) {
  if (typeof value !== "string") return null;
  const color = value.trim().toUpperCase();
  return /^#[0-9A-F]{6}$/.test(color) && color !== BLACK ? color : null;
}

function isActiveCell(x, y, grid) {
  switch (grid) {
    case "odd-tl": return x <= 14 && y <= 14;
    case "odd-tr": return x >= 1 && y <= 14;
    case "odd-bl": return x <= 14 && y >= 1;
    case "odd-br": return x >= 1 && y >= 1;
    default: return true;
  }
}
