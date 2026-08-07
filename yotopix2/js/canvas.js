import {
  GRID_SIZE,
  activeBounds,
  indexFor,
  isActiveCell,
  normalizeColor,
  setPixel,
} from "./state.js";
import {
  bresenhamLine,
  floodFillCells,
  rectangleCells,
  verticalMirrorCells,
} from "./tools.js";

const MAX_CANVAS_SIZE = 640;
const CHECKER_LIGHT = "#DDDAD4";
const CHECKER_DARK = "#C7C4BE";

export class PixelCanvas {
  constructor(canvas, {
    icon,
    history,
    activeColor,
    activeTool = "pen",
    showGrid = true,
    mirrorEnabled = false,
    onChange = () => {},
    onCoordinateChange = () => {},
    onPickColor = () => {},
    onUseColor = () => {},
  }) {
    this.canvas = canvas;
    this.frame = canvas.parentElement;
    this.region = canvas.closest(".canvas-region") ?? this.frame;
    this.controls = this.region.querySelector(".canvas-controls");
    this.icon = icon;
    this.history = history;
    this.activeColor = activeColor;
    this.activeTool = activeTool;
    this.showGrid = showGrid;
    this.mirrorEnabled = mirrorEnabled;
    this.onChange = onChange;
    this.onCoordinateChange = onCoordinateChange;
    this.onPickColor = onPickColor;
    this.onUseColor = onUseColor;
    this.cssSize = GRID_SIZE;

    this.pointerId = null;
    this.pointerMode = null;
    this.strokeTool = null;
    this.lastCell = null;
    this.shapeStart = null;
    this.shapeBasePixels = null;
    this.previewPixels = null;
    this.keyboardCell = this.defaultKeyboardCell();

    this.context = canvas.getContext("2d", { alpha: false });
    this.context.imageSmoothingEnabled = false;

    this.handlePointerDown = this.handlePointerDown.bind(this);
    this.handlePointerMove = this.handlePointerMove.bind(this);
    this.handlePointerUp = this.handlePointerUp.bind(this);
    this.handlePointerLeave = this.handlePointerLeave.bind(this);
    this.handleContextMenu = (event) => event.preventDefault();
    this.handleKeyDown = this.handleKeyDown.bind(this);
    this.handleFocus = () => {
      this.announceKeyboardCell();
      this.render();
    };
    this.handleBlur = () => {
      this.onCoordinateChange(null);
      this.render();
    };
    this.handleWindowResize = () => this.resize();

    canvas.addEventListener("pointerdown", this.handlePointerDown);
    canvas.addEventListener("pointermove", this.handlePointerMove);
    canvas.addEventListener("pointerup", this.handlePointerUp);
    canvas.addEventListener("pointercancel", this.handlePointerUp);
    canvas.addEventListener("pointerleave", this.handlePointerLeave);
    canvas.addEventListener("contextmenu", this.handleContextMenu);
    canvas.addEventListener("keydown", this.handleKeyDown);
    canvas.addEventListener("focus", this.handleFocus);
    canvas.addEventListener("blur", this.handleBlur);
    window.addEventListener("resize", this.handleWindowResize);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.region);
    this.watchDevicePixelRatio();
    this.setActiveTool(activeTool);
    this.updateRegionOverlay();
    this.resize();
  }

  setIcon(icon) {
    this.icon = icon;
    this.keyboardCell = this.defaultKeyboardCell();
    this.announceKeyboardCell();
    this.clearPreview();
    this.updateRegionOverlay();
    this.render();
  }

  setActiveColor(color) {
    this.activeColor = normalizeColor(color);
  }

  setActiveTool(tool) {
    this.activeTool = tool;
    this.canvas.dataset.tool = tool;
    this.canvas.style.cursor = tool === "eyedropper" ? "copy" : "crosshair";
    if (this.keyboardCell) this.announceKeyboardCell();
  }

  setGridVisible(visible) {
    this.showGrid = visible;
    this.render();
  }

  setMirrorEnabled(enabled) {
    this.mirrorEnabled = enabled;
    this.updateRegionOverlay();
  }

  gridModeChanged() {
    this.clearPreview();
    this.keyboardCell = this.defaultKeyboardCell();
    this.announceKeyboardCell();
    this.updateRegionOverlay();
    this.render();
  }

  refresh() {
    this.clearPreview();
    this.render();
  }

  watchDevicePixelRatio() {
    this.dprQuery?.removeEventListener("change", this.handleDprChange);
    this.handleDprChange = () => {
      this.watchDevicePixelRatio();
      this.resize();
    };
    this.dprQuery = matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    this.dprQuery.addEventListener("change", this.handleDprChange, { once: true });
  }

  resize() {
    const styles = getComputedStyle(this.region);
    const frameStyles = getComputedStyle(this.frame);
    const horizontalPadding = parseFloat(styles.paddingLeft) + parseFloat(styles.paddingRight);
    const frameChromeX = parseFloat(frameStyles.borderLeftWidth) + parseFloat(frameStyles.borderRightWidth);
    const frameChromeY = parseFloat(frameStyles.borderTopWidth) + parseFloat(frameStyles.borderBottomWidth);
    const availableWidth = this.region.clientWidth - horizontalPadding - frameChromeX;
    const frameTop = this.frame.getBoundingClientRect().top + window.scrollY;
    const controlsHeight = this.controls?.offsetHeight ?? 0;
    const rowGap = parseFloat(styles.rowGap) || 0;
    const availableHeight = window.innerHeight
      - frameTop
      - frameChromeY
      - controlsHeight
      - rowGap
      - parseFloat(styles.paddingBottom);
    const available = Math.max(GRID_SIZE, Math.min(availableWidth, availableHeight));
    const nextSize = Math.max(
      GRID_SIZE,
      Math.floor(Math.min(MAX_CANVAS_SIZE, available) / GRID_SIZE) * GRID_SIZE,
    );
    const dpr = window.devicePixelRatio || 1;
    const backingSize = Math.round(nextSize * dpr);

    this.cssSize = nextSize;
    this.frame.style.width = `${nextSize}px`;
    this.frame.style.height = `${nextSize}px`;
    if (this.controls) this.controls.style.width = `${nextSize}px`;
    if (this.canvas.width !== backingSize || this.canvas.height !== backingSize) {
      this.canvas.width = backingSize;
      this.canvas.height = backingSize;
    }
    this.context.setTransform(backingSize / nextSize, 0, 0, backingSize / nextSize, 0, 0);
    this.context.imageSmoothingEnabled = false;
    this.render();
  }

  render() {
    const context = this.context;
    const size = this.cssSize;
    const cellSize = size / GRID_SIZE;
    const pixels = this.previewPixels ?? this.icon.pixels;
    context.clearRect(0, 0, size, size);
    this.renderCheckerboard(context, size, cellSize);

    for (let y = 0; y < GRID_SIZE; y += 1) {
      for (let x = 0; x < GRID_SIZE; x += 1) {
        const color = pixels[indexFor(x, y)];
        if (color === null) continue;
        context.fillStyle = color;
        context.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
      }
    }

    if (this.showGrid) this.renderGrid(context, size, cellSize);
    if (document.activeElement === this.canvas) this.renderKeyboardCursor(context, cellSize);
  }

  renderKeyboardCursor(context, cellSize) {
    const { x, y } = this.keyboardCell;
    context.save();
    context.strokeStyle = "#16151A";
    context.lineWidth = Math.max(3, cellSize * 0.1);
    context.strokeRect(x * cellSize + 2, y * cellSize + 2, cellSize - 4, cellSize - 4);
    context.strokeStyle = "#FFB347";
    context.lineWidth = Math.max(1.5, cellSize * 0.05);
    context.strokeRect(x * cellSize + 2, y * cellSize + 2, cellSize - 4, cellSize - 4);
    context.restore();
  }

  renderCheckerboard(context, size, cellSize) {
    const checkerSize = Math.max(2, Math.floor(cellSize / 4));
    context.fillStyle = CHECKER_LIGHT;
    context.fillRect(0, 0, size, size);
    context.fillStyle = CHECKER_DARK;
    const count = Math.ceil(size / checkerSize);
    for (let y = 0; y < count; y += 1) {
      for (let x = y % 2; x < count; x += 2) {
        context.fillRect(x * checkerSize, y * checkerSize, checkerSize, checkerSize);
      }
    }
  }

  renderGrid(context, size, cellSize) {
    const drawVertical = (position, width, color) => {
      context.fillStyle = color;
      context.fillRect(position - width / 2, 0, width, size);
    };
    const drawHorizontal = (position, width, color) => {
      context.fillStyle = color;
      context.fillRect(0, position - width / 2, size, width);
    };

    for (let line = 1; line < GRID_SIZE; line += 1) {
      drawVertical(line * cellSize, 0.7, "rgba(38, 35, 45, 0.22)");
      drawHorizontal(line * cellSize, 0.7, "rgba(38, 35, 45, 0.22)");
    }

    const bounds = activeBounds(this.icon.grid);
    for (let line = bounds.x0 + 4; line <= bounds.x1; line += 4) {
      drawVertical(line * cellSize, 1.2, "rgba(38, 35, 45, 0.42)");
    }
    for (let line = bounds.y0 + 4; line <= bounds.y1; line += 4) {
      drawHorizontal(line * cellSize, 1.2, "rgba(38, 35, 45, 0.42)");
    }

    const centreX = this.icon.grid === "full" ? 8 : bounds.x0 + 7.5;
    const centreY = this.icon.grid === "full" ? 8 : bounds.y0 + 7.5;
    drawVertical(centreX * cellSize, 2, "rgba(38, 35, 45, 0.64)");
    drawHorizontal(centreY * cellSize, 2, "rgba(38, 35, 45, 0.64)");
  }

  updateRegionOverlay() {
    this.frame.classList.toggle("mirror-active", this.mirrorEnabled);
    const bounds = activeBounds(this.icon.grid);
    const mirrorAxis = (bounds.x0 + bounds.x1 + 1) / 2 / GRID_SIZE * 100;
    this.frame.style.setProperty("--mirror-axis", `${mirrorAxis}%`);

    this.frame.querySelectorAll(".odd-gutter").forEach((gutter) => gutter.remove());
    const odd = this.icon.grid !== "full";
    this.frame.classList.toggle("odd-grid-active", odd);
    if (!odd) return;

    const sides = [
      bounds.x0 === 1 ? "left" : "right",
      bounds.y0 === 1 ? "top" : "bottom",
    ];
    for (const side of sides) {
      const gutter = document.createElement("span");
      gutter.className = `odd-gutter odd-gutter-${side}`;
      gutter.setAttribute("aria-hidden", "true");
      this.frame.append(gutter);
    }
  }

  cellFromEvent(event) {
    const bounds = this.canvas.getBoundingClientRect();
    const relativeX = event.clientX - bounds.left;
    const relativeY = event.clientY - bounds.top;
    if (relativeX < 0 || relativeY < 0 || relativeX >= bounds.width || relativeY >= bounds.height) {
      return null;
    }
    return {
      x: Math.floor(relativeX / bounds.width * GRID_SIZE),
      y: Math.floor(relativeY / bounds.height * GRID_SIZE),
    };
  }

  handlePointerDown(event) {
    if (this.pointerId !== null || (event.button !== 0 && event.button !== 2)) return;
    const cell = this.cellFromEvent(event);
    if (cell && isActiveCell(cell.x, cell.y, this.icon.grid)) {
      this.keyboardCell = cell;
      this.announceKeyboardCell();
    }
    this.onCoordinateChange(cell);
    if (!cell || !isActiveCell(cell.x, cell.y, this.icon.grid)) return;

    event.preventDefault();
    if (event.button === 0 && !event.altKey && this.activeTool === "fill") {
      this.applyFill(cell);
      return;
    }

    this.pointerId = event.pointerId;
    this.lastCell = cell;
    this.canvas.setPointerCapture(event.pointerId);

    if (event.button === 0 && (event.altKey || this.activeTool === "eyedropper")) {
      this.pointerMode = "eyedropper";
      this.pickColor(cell);
      return;
    }

    if (event.button === 0 && (this.activeTool === "line" || this.activeTool === "rectangle")) {
      this.pointerMode = "shape";
      this.strokeTool = this.activeTool;
      this.shapeStart = cell;
      this.shapeBasePixels = this.icon.pixels.slice();
      this.history.begin(this.icon);
      this.onChange(this.icon);
      this.updateShapePreview(cell, event.shiftKey);
      return;
    }

    this.pointerMode = "brush";
    this.strokeTool = event.button === 2 ? "eraser" : this.activeTool;
    this.history.begin(this.icon);
    this.onChange(this.icon);
    this.paintDocumentCells([cell], this.strokeTool === "eraser" ? null : this.activeColor);
  }

  handlePointerMove(event) {
    if (event.pointerId !== this.pointerId) {
      this.onCoordinateChange(this.cellFromEvent(event));
      return;
    }

    const samples = typeof event.getCoalescedEvents === "function"
      ? [...event.getCoalescedEvents(), event]
      : [event];
    if (this.pointerMode === "brush") {
      for (const sample of samples) {
        const cell = this.cellFromEvent(sample);
        if (!cell || !isActiveCell(cell.x, cell.y, this.icon.grid)) continue;
        const cells = this.lastCell
          ? bresenhamLine(this.lastCell.x, this.lastCell.y, cell.x, cell.y)
          : [cell];
        this.paintDocumentCells(cells, this.strokeTool === "eraser" ? null : this.activeColor);
        this.lastCell = cell;
      }
    } else {
      const cell = this.cellFromEvent(event);
      if (cell && isActiveCell(cell.x, cell.y, this.icon.grid)) {
        this.lastCell = cell;
        if (this.pointerMode === "eyedropper") this.pickColor(cell);
        if (this.pointerMode === "shape") this.updateShapePreview(cell, event.shiftKey);
      }
    }
    this.onCoordinateChange(this.lastCell);
  }

  handlePointerUp(event) {
    if (event.pointerId !== this.pointerId) return;
    const cell = this.cellFromEvent(event);
    if (this.pointerMode === "shape" && cell && isActiveCell(cell.x, cell.y, this.icon.grid)) {
      this.lastCell = cell;
      this.updateShapePreview(cell, event.shiftKey);
    }

    if (this.pointerMode === "shape") {
      this.icon.pixels = this.previewPixels ?? this.shapeBasePixels;
      this.clearPreview();
      const changed = this.history.commit(this.icon);
      if (changed) this.onUseColor(this.activeColor);
      this.render();
      this.onChange(this.icon);
    } else if (this.pointerMode === "brush") {
      if (cell && isActiveCell(cell.x, cell.y, this.icon.grid)) {
        const cells = this.lastCell
          ? bresenhamLine(this.lastCell.x, this.lastCell.y, cell.x, cell.y)
          : [cell];
        this.paintDocumentCells(cells, this.strokeTool === "eraser" ? null : this.activeColor);
        this.lastCell = cell;
      }
      this.history.commit(this.icon);
      this.onChange(this.icon);
    }

    if (this.canvas.hasPointerCapture(event.pointerId)) {
      this.canvas.releasePointerCapture(event.pointerId);
    }
    this.pointerId = null;
    this.pointerMode = null;
    this.strokeTool = null;
    this.lastCell = null;
    this.shapeStart = null;
    this.shapeBasePixels = null;
  }

  handlePointerLeave(event) {
    if (event.pointerId !== this.pointerId) this.onCoordinateChange(null);
  }

  handleKeyDown(event) {
    const moves = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    if (moves[event.key]) {
      event.preventDefault();
      event.stopPropagation();
      this.moveKeyboardCell(...moves[event.key]);
      return;
    }

    const activate = event.key === " " || event.key === "Enter";
    const erase = event.key === "Delete" || event.key === "Backspace";
    if (!activate && !erase) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.repeat) return;

    const cell = this.keyboardCell;
    if (activate && (event.altKey || this.activeTool === "eyedropper")) {
      this.pickColor(cell);
      return;
    }
    if (activate && this.activeTool === "fill") {
      this.applyFill(cell);
      this.announceKeyboardCell();
      return;
    }
    const color = erase || this.activeTool === "eraser" ? null : this.activeColor;
    this.history.run(this.icon, (documentModel) => {
      for (const target of this.expandMirrorCells([cell])) {
        setPixel(documentModel, target.x, target.y, color);
      }
    });
    if (color !== null) this.onUseColor(color);
    this.render();
    this.announceKeyboardCell();
    this.onChange(this.icon);
  }

  defaultKeyboardCell() {
    const bounds = activeBounds(this.icon.grid);
    return {
      x: Math.floor((bounds.x0 + bounds.x1) / 2),
      y: Math.floor((bounds.y0 + bounds.y1) / 2),
    };
  }

  moveKeyboardCell(offsetX, offsetY) {
    const bounds = activeBounds(this.icon.grid);
    this.keyboardCell = {
      x: Math.min(bounds.x1, Math.max(bounds.x0, this.keyboardCell.x + offsetX)),
      y: Math.min(bounds.y1, Math.max(bounds.y0, this.keyboardCell.y + offsetY)),
    };
    this.announceKeyboardCell();
    this.render();
  }

  announceKeyboardCell() {
    const { x, y } = this.keyboardCell;
    const color = this.icon.pixels[indexFor(x, y)] ?? "transparent";
    if (document.activeElement === this.canvas) this.onCoordinateChange(this.keyboardCell);
    this.canvas.setAttribute("aria-label", `16 by 16 pixel drawing canvas. ${this.activeTool} tool. Cell x ${x}, y ${y}, ${color}.`);
  }

  applyFill(cell) {
    const cells = floodFillCells(this.icon.pixels, cell.x, cell.y, this.icon.grid);
    this.history.run(this.icon, () => this.paintDocumentCells(cells, this.activeColor));
    this.render();
    this.onChange(this.icon);
  }

  updateShapePreview(cell, filled) {
    const cells = this.strokeTool === "line"
      ? bresenhamLine(this.shapeStart.x, this.shapeStart.y, cell.x, cell.y)
      : rectangleCells(this.shapeStart.x, this.shapeStart.y, cell.x, cell.y, {
          filled,
          grid: this.icon.grid,
        });
    this.previewPixels = this.shapeBasePixels.slice();
    this.paintPixelArray(this.previewPixels, cells, this.activeColor);
    this.render();
  }

  paintDocumentCells(cells, color) {
    let changed = false;
    for (const cell of this.expandMirrorCells(cells)) {
      changed = setPixel(this.icon, cell.x, cell.y, color) || changed;
    }
    if (changed) {
      if (color !== null) this.onUseColor(color);
      this.render();
      this.onChange(this.icon);
    }
    return changed;
  }

  paintPixelArray(pixels, cells, color) {
    const normalized = normalizeColor(color);
    for (const cell of this.expandMirrorCells(cells)) {
      pixels[indexFor(cell.x, cell.y)] = normalized;
    }
  }

  expandMirrorCells(cells) {
    const unique = new Map();
    for (const cell of cells) {
      const expanded = this.mirrorEnabled
        ? verticalMirrorCells(cell.x, cell.y, this.icon.grid)
        : isActiveCell(cell.x, cell.y, this.icon.grid) ? [cell] : [];
      for (const result of expanded) unique.set(indexFor(result.x, result.y), result);
    }
    return unique.values();
  }

  pickColor(cell) {
    const color = this.icon.pixels[indexFor(cell.x, cell.y)];
    if (color !== null) this.onPickColor(color);
  }

  clearPreview() {
    this.previewPixels = null;
    this.shapeBasePixels = null;
  }

  destroy() {
    this.resizeObserver.disconnect();
    this.dprQuery?.removeEventListener("change", this.handleDprChange);
    window.removeEventListener("resize", this.handleWindowResize);
    this.canvas.removeEventListener("pointerdown", this.handlePointerDown);
    this.canvas.removeEventListener("pointermove", this.handlePointerMove);
    this.canvas.removeEventListener("pointerup", this.handlePointerUp);
    this.canvas.removeEventListener("pointercancel", this.handlePointerUp);
    this.canvas.removeEventListener("pointerleave", this.handlePointerLeave);
    this.canvas.removeEventListener("contextmenu", this.handleContextMenu);
    this.canvas.removeEventListener("keydown", this.handleKeyDown);
    this.canvas.removeEventListener("focus", this.handleFocus);
    this.canvas.removeEventListener("blur", this.handleBlur);
  }
}
