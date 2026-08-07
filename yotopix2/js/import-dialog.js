import { importRgbaToDocumentPixels, centredSquareCrop } from "./importer.js";
import { GRID_SIZE, indexFor } from "./state.js";

const CROP_CANVAS_WIDTH = 640;
const CROP_CANVAS_HEIGHT = 420;
const CROP_PADDING = 14;
const HANDLE_RADIUS = 12;

/** Browser UI for the Phase 5 crop, adjustment, and import workflow. */
export class ImageImportDialog {
  constructor({
    dialog,
    form,
    openButton,
    fileInput,
    dropTarget,
    cropCanvas,
    resultCanvas,
    deviceCanvas,
    closeButton,
    cancelButton,
    applyButton,
    resetCropButton,
    sourceSummary,
    status,
    alphaThreshold,
    alphaValue,
    brightness,
    brightnessValue,
    saturation,
    saturationValue,
    quantize,
    getGrid,
    getPalette,
    onApply,
    onError = () => {},
  }) {
    this.dialog = dialog;
    this.form = form;
    this.openButton = openButton;
    this.fileInput = fileInput;
    this.dropTarget = dropTarget;
    this.cropCanvas = cropCanvas;
    this.resultCanvas = resultCanvas;
    this.deviceCanvas = deviceCanvas;
    this.closeButton = closeButton;
    this.cancelButton = cancelButton;
    this.applyButton = applyButton;
    this.resetCropButton = resetCropButton;
    this.sourceSummary = sourceSummary;
    this.status = status;
    this.alphaThreshold = alphaThreshold;
    this.alphaValue = alphaValue;
    this.brightness = brightness;
    this.brightnessValue = brightnessValue;
    this.saturation = saturation;
    this.saturationValue = saturationValue;
    this.quantize = quantize;
    this.getGrid = getGrid;
    this.getPalette = getPalette;
    this.onApply = onApply;
    this.onError = onError;

    this.source = null;
    this.crop = null;
    this.view = null;
    this.currentPixels = null;
    this.drag = null;
    this.previewFrame = null;
    this.decodeRequest = 0;

    this.cropContext = cropCanvas.getContext("2d", { alpha: false });
    this.resultContext = resultCanvas.getContext("2d", { alpha: false });
    this.deviceContext = deviceCanvas.getContext("2d", { alpha: false });
    this.cropContext.imageSmoothingEnabled = true;
    this.resultContext.imageSmoothingEnabled = false;
    this.deviceContext.imageSmoothingEnabled = false;

    this.bindEvents();
    this.clearPreviewCanvases();
  }

  bindEvents() {
    this.openButton.addEventListener("click", () => {
      this.fileInput.value = "";
      this.fileInput.click();
    });
    this.fileInput.addEventListener("change", () => this.openFile(this.fileInput.files?.[0]));
    this.closeButton.addEventListener("click", () => this.dialog.close("cancel"));
    this.cancelButton.addEventListener("click", () => this.dialog.close("cancel"));
    this.resetCropButton.addEventListener("click", () => this.resetCrop());
    this.form.addEventListener("submit", (event) => this.apply(event));
    this.dialog.addEventListener("close", () => this.releaseSource());

    for (const radio of this.form.elements["import-method"]) {
      radio.addEventListener("change", () => this.schedulePreview());
    }
    for (const input of [this.alphaThreshold, this.brightness, this.saturation]) {
      input.addEventListener("input", () => {
        this.updateControlLabels();
        this.schedulePreview();
      });
    }
    this.quantize.addEventListener("change", () => this.schedulePreview());

    this.cropCanvas.addEventListener("pointerdown", (event) => this.beginCropDrag(event));
    this.cropCanvas.addEventListener("pointermove", (event) => this.moveCropDrag(event));
    this.cropCanvas.addEventListener("pointerup", (event) => this.endCropDrag(event));
    this.cropCanvas.addEventListener("pointercancel", (event) => this.endCropDrag(event));
    this.cropCanvas.addEventListener("keydown", (event) => this.nudgeCrop(event));

    const hasFiles = (event) => [...(event.dataTransfer?.types ?? [])].includes("Files");
    this.dropTarget.addEventListener("dragenter", (event) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      this.dropTarget.classList.add("is-import-dragging");
    });
    this.dropTarget.addEventListener("dragover", (event) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      this.dropTarget.classList.add("is-import-dragging");
    });
    this.dropTarget.addEventListener("dragleave", (event) => {
      if (!this.dropTarget.contains(event.relatedTarget)) this.dropTarget.classList.remove("is-import-dragging");
    });
    this.dropTarget.addEventListener("drop", (event) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      this.dropTarget.classList.remove("is-import-dragging");
      const files = [...(event.dataTransfer?.files ?? [])];
      this.openFile(files.find((file) => file.type.startsWith("image/")) ?? files[0]);
    });
  }

  async openFile(file) {
    if (!file) return;
    const request = ++this.decodeRequest;
    this.openButton.disabled = true;
    let bitmap = null;
    try {
      bitmap = await createImageBitmap(file);
      if (request !== this.decodeRequest) {
        bitmap.close();
        bitmap = null;
        return;
      }
      const decodeCanvas = document.createElement("canvas");
      decodeCanvas.width = bitmap.width;
      decodeCanvas.height = bitmap.height;
      const context = decodeCanvas.getContext("2d", { willReadFrequently: true });
      context.drawImage(bitmap, 0, 0);
      const rgba = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
      decodeCanvas.width = 1;
      decodeCanvas.height = 1;

      this.releaseSource();
      this.source = { bitmap, rgba, width: bitmap.width, height: bitmap.height, name: file.name || "image" };
      bitmap = null;
      this.crop = centredSquareCrop(this.source.width, this.source.height);
      this.resetControls();
      this.sourceSummary.textContent = `${this.source.name} · ${this.source.width} × ${this.source.height}. Crop and tune it before replacing the canvas.`;
      this.applyButton.disabled = false;
      if (!this.dialog.open) this.dialog.showModal();
      this.renderCrop();
      this.updatePreview();
      this.cropCanvas.focus();
    } catch (error) {
      bitmap?.close();
      if (request !== this.decodeRequest) return;
      console.error(error);
      this.releaseSource();
      this.onError("That image could not be opened. Choose a PNG, JPEG, GIF, or WebP file.");
    } finally {
      if (request === this.decodeRequest) {
        this.openButton.disabled = false;
        this.fileInput.value = "";
      }
    }
  }

  resetControls() {
    this.form.elements["import-method"].value = "box";
    this.alphaThreshold.value = "50";
    this.brightness.value = "0";
    this.saturation.value = "20";
    this.quantize.checked = false;
    this.status.classList.remove("is-error");
    this.updateControlLabels();
  }

  updateControlLabels() {
    this.alphaValue.value = `${this.alphaThreshold.value}%`;
    this.brightnessValue.value = signedValue(this.brightness.value);
    this.saturationValue.value = `${signedValue(this.saturation.value)}%`;
  }

  resetCrop() {
    if (!this.source) return;
    this.crop = centredSquareCrop(this.source.width, this.source.height);
    this.renderCrop();
    this.schedulePreview();
  }

  schedulePreview() {
    if (this.previewFrame !== null) return;
    this.previewFrame = requestAnimationFrame(() => {
      this.previewFrame = null;
      this.updatePreview();
    });
  }

  updatePreview() {
    if (!this.source || !this.crop) return;
    try {
      this.currentPixels = importRgbaToDocumentPixels(
        this.source.rgba,
        this.source.width,
        this.source.height,
        {
          crop: this.crop,
          grid: this.getGrid(),
          method: this.form.elements["import-method"].value,
          alphaThreshold: Number(this.alphaThreshold.value),
          brightness: Number(this.brightness.value),
          saturation: Number(this.saturation.value),
          quantize: this.quantize.checked,
          palette: this.getPalette(),
        },
      );
      this.renderPixelPreview(this.currentPixels);
      this.renderDevicePreview(this.currentPixels);
      const painted = this.currentPixels.filter(Boolean);
      const colors = new Set(painted);
      const activeSize = this.getGrid() === "full" ? "16 × 16" : "15 × 15";
      this.status.textContent = `${activeSize} · ${painted.length} painted ${painted.length === 1 ? "pixel" : "pixels"} · ${colors.size} ${colors.size === 1 ? "colour" : "colours"}`;
      this.status.classList.remove("is-error");
      this.applyButton.disabled = false;
    } catch (error) {
      console.error(error);
      this.currentPixels = null;
      this.status.textContent = "The preview could not be processed. Adjust the crop or choose another image.";
      this.status.classList.add("is-error");
      this.applyButton.disabled = true;
    }
  }

  renderCrop() {
    if (!this.source || !this.crop) return;
    const context = this.cropContext;
    const { bitmap, width, height } = this.source;
    const scale = Math.min(
      (CROP_CANVAS_WIDTH - CROP_PADDING * 2) / width,
      (CROP_CANVAS_HEIGHT - CROP_PADDING * 2) / height,
    );
    const displayWidth = width * scale;
    const displayHeight = height * scale;
    const offsetX = (CROP_CANVAS_WIDTH - displayWidth) / 2;
    const offsetY = (CROP_CANVAS_HEIGHT - displayHeight) / 2;
    this.view = { scale, offsetX, offsetY };

    context.fillStyle = "#111015";
    context.fillRect(0, 0, CROP_CANVAS_WIDTH, CROP_CANVAS_HEIGHT);
    context.drawImage(bitmap, offsetX, offsetY, displayWidth, displayHeight);

    const cropX = offsetX + this.crop.x * scale;
    const cropY = offsetY + this.crop.y * scale;
    const cropSize = this.crop.size * scale;
    context.fillStyle = "rgba(10, 9, 13, 0.66)";
    context.fillRect(offsetX, offsetY, displayWidth, cropY - offsetY);
    context.fillRect(offsetX, cropY + cropSize, displayWidth, offsetY + displayHeight - cropY - cropSize);
    context.fillRect(offsetX, cropY, cropX - offsetX, cropSize);
    context.fillRect(cropX + cropSize, cropY, offsetX + displayWidth - cropX - cropSize, cropSize);
    context.strokeStyle = "#FFB347";
    context.lineWidth = 2;
    context.strokeRect(cropX, cropY, cropSize, cropSize);

    for (const point of this.cropHandlePoints()) {
      context.fillStyle = "#16151A";
      context.fillRect(point.x - 6, point.y - 6, 12, 12);
      context.strokeStyle = "#FFB347";
      context.lineWidth = 2;
      context.strokeRect(point.x - 6, point.y - 6, 12, 12);
    }
  }

  renderPixelPreview(pixels) {
    const context = this.resultContext;
    const size = this.resultCanvas.width;
    const cellSize = size / GRID_SIZE;
    const checker = cellSize / 2;
    context.fillStyle = "#DDDAD4";
    context.fillRect(0, 0, size, size);
    context.fillStyle = "#C7C4BE";
    for (let y = 0; y < GRID_SIZE * 2; y += 1) {
      for (let x = y % 2; x < GRID_SIZE * 2; x += 2) {
        context.fillRect(x * checker, y * checker, checker, checker);
      }
    }
    for (let y = 0; y < GRID_SIZE; y += 1) {
      for (let x = 0; x < GRID_SIZE; x += 1) {
        const color = pixels[indexFor(x, y)];
        if (color === null) continue;
        context.fillStyle = color;
        context.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
      }
    }
  }

  renderDevicePreview(pixels) {
    const context = this.deviceContext;
    const size = this.deviceCanvas.width;
    const cellSize = size / GRID_SIZE;
    const gap = Math.max(1, Math.round(cellSize / 10));
    context.fillStyle = "#0E0D11";
    context.fillRect(0, 0, size, size);
    for (let y = 0; y < GRID_SIZE; y += 1) {
      for (let x = 0; x < GRID_SIZE; x += 1) {
        const color = pixels[indexFor(x, y)];
        if (color === null || color === "#000000") continue;
        context.fillStyle = color;
        context.fillRect(x * cellSize + gap, y * cellSize + gap, cellSize - gap * 2, cellSize - gap * 2);
      }
    }
  }

  clearPreviewCanvases() {
    this.cropContext.fillStyle = "#111015";
    this.cropContext.fillRect(0, 0, this.cropCanvas.width, this.cropCanvas.height);
    this.resultContext.fillStyle = "#111015";
    this.resultContext.fillRect(0, 0, this.resultCanvas.width, this.resultCanvas.height);
    this.deviceContext.fillStyle = "#0E0D11";
    this.deviceContext.fillRect(0, 0, this.deviceCanvas.width, this.deviceCanvas.height);
  }

  beginCropDrag(event) {
    if (!this.source || event.button !== 0) return;
    const point = this.eventCanvasPoint(event);
    const handle = this.hitCropHandle(point);
    const sourcePoint = this.canvasToSource(point);
    if (!handle && !this.pointInsideCrop(sourcePoint)) return;
    event.preventDefault();
    this.cropCanvas.setPointerCapture(event.pointerId);
    this.drag = handle
      ? { type: "resize", pointerId: event.pointerId, handle }
      : { type: "move", pointerId: event.pointerId, start: sourcePoint, crop: { ...this.crop } };
  }

  moveCropDrag(event) {
    if (!this.source || !this.crop) return;
    const canvasPoint = this.eventCanvasPoint(event);
    if (!this.drag || event.pointerId !== this.drag.pointerId) {
      const handle = this.hitCropHandle(canvasPoint);
      this.cropCanvas.style.cursor = handle ? cornerCursor(handle) : this.pointInsideCrop(this.canvasToSource(canvasPoint)) ? "move" : "default";
      return;
    }
    event.preventDefault();
    const point = this.canvasToSource(canvasPoint);
    if (this.drag.type === "move") {
      const x = clamp(this.drag.crop.x + point.x - this.drag.start.x, 0, this.source.width - this.crop.size);
      const y = clamp(this.drag.crop.y + point.y - this.drag.start.y, 0, this.source.height - this.crop.size);
      this.crop = { ...this.crop, x, y };
    } else {
      this.resizeCropFromCorner(this.drag.handle, point);
    }
    this.renderCrop();
    this.schedulePreview();
  }

  endCropDrag(event) {
    if (!this.drag || event.pointerId !== this.drag.pointerId) return;
    if (this.cropCanvas.hasPointerCapture(event.pointerId)) this.cropCanvas.releasePointerCapture(event.pointerId);
    this.drag = null;
  }

  resizeCropFromCorner(handle, point) {
    const left = handle.includes("left");
    const top = handle.includes("top");
    const oppositeX = left ? this.crop.x + this.crop.size : this.crop.x;
    const oppositeY = top ? this.crop.y + this.crop.size : this.crop.y;
    const directionX = left ? -1 : 1;
    const directionY = top ? -1 : 1;
    const requested = Math.max(directionX * (point.x - oppositeX), directionY * (point.y - oppositeY));
    const maximumX = left ? oppositeX : this.source.width - oppositeX;
    const maximumY = top ? oppositeY : this.source.height - oppositeY;
    const minimum = Math.max(1, Math.min(this.source.width, this.source.height) / 100);
    const size = clamp(requested, minimum, Math.min(maximumX, maximumY));
    this.crop = {
      x: left ? oppositeX - size : oppositeX,
      y: top ? oppositeY - size : oppositeY,
      size,
    };
  }

  nudgeCrop(event) {
    const directions = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const direction = directions[event.key];
    const resizeDirection = event.key === "+" || event.key === "=" ? 1
      : event.key === "-" || event.key === "_" ? -1 : 0;
    if ((!direction && resizeDirection === 0) || !this.source || !this.crop) return;
    event.preventDefault();
    const base = Math.max(1, Math.min(this.source.width, this.source.height) / 200);
    const step = base * (event.shiftKey ? 10 : 1);
    if (direction) {
      this.crop = {
        ...this.crop,
        x: clamp(this.crop.x + direction[0] * step, 0, this.source.width - this.crop.size),
        y: clamp(this.crop.y + direction[1] * step, 0, this.source.height - this.crop.size),
      };
    } else {
      const centerX = this.crop.x + this.crop.size / 2;
      const centerY = this.crop.y + this.crop.size / 2;
      const maximum = Math.min(centerX, this.source.width - centerX, centerY, this.source.height - centerY) * 2;
      const minimum = Math.max(1, Math.min(this.source.width, this.source.height) / 100);
      const size = clamp(this.crop.size + resizeDirection * step, minimum, maximum);
      this.crop = { x: centerX - size / 2, y: centerY - size / 2, size };
    }
    this.renderCrop();
    this.schedulePreview();
  }

  cropHandlePoints() {
    const { scale, offsetX, offsetY } = this.view;
    const left = offsetX + this.crop.x * scale;
    const top = offsetY + this.crop.y * scale;
    const right = left + this.crop.size * scale;
    const bottom = top + this.crop.size * scale;
    return [
      { name: "top-left", x: left, y: top },
      { name: "top-right", x: right, y: top },
      { name: "bottom-left", x: left, y: bottom },
      { name: "bottom-right", x: right, y: bottom },
    ];
  }

  hitCropHandle(point) {
    if (!this.view) return null;
    return this.cropHandlePoints().find((handle) => Math.hypot(handle.x - point.x, handle.y - point.y) <= HANDLE_RADIUS)?.name ?? null;
  }

  pointInsideCrop(point) {
    return point.x >= this.crop.x && point.x <= this.crop.x + this.crop.size
      && point.y >= this.crop.y && point.y <= this.crop.y + this.crop.size;
  }

  eventCanvasPoint(event) {
    const bounds = this.cropCanvas.getBoundingClientRect();
    return {
      x: (event.clientX - bounds.left) / bounds.width * this.cropCanvas.width,
      y: (event.clientY - bounds.top) / bounds.height * this.cropCanvas.height,
    };
  }

  canvasToSource(point) {
    return {
      x: (point.x - this.view.offsetX) / this.view.scale,
      y: (point.y - this.view.offsetY) / this.view.scale,
    };
  }

  apply(event) {
    event.preventDefault();
    if (!this.currentPixels) return;
    if (this.onApply(this.currentPixels.slice()) !== false) this.dialog.close("apply");
  }

  releaseSource() {
    if (this.previewFrame !== null) cancelAnimationFrame(this.previewFrame);
    this.previewFrame = null;
    this.source?.bitmap.close();
    this.source = null;
    this.crop = null;
    this.view = null;
    this.currentPixels = null;
    this.drag = null;
    this.fileInput.value = "";
    this.clearPreviewCanvases();
  }
}

function cornerCursor(handle) {
  return handle === "top-left" || handle === "bottom-right" ? "nwse-resize" : "nesw-resize";
}

function signedValue(value) {
  const number = Number(value);
  return number > 0 ? `+${number}` : String(number);
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}
