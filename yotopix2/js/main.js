import { PixelCanvas } from "./canvas.js";
import { DevicePreview } from "./device-preview.js";
import { createExampleDocuments, upgradeExampleDocuments } from "./examples.js";
import { downloadPng } from "./exporter.js";
import { ImageImportDialog } from "./import-dialog.js";
import { analyzeDocument, clearInactiveGutters, replaceExactColor } from "./lint.js";
import {
  CUSTOM_SLOT_COUNT,
  DEFAULT_PALETTE,
  assignCustomSlot,
  customSlotGroups,
  customSlotsFromGroups,
  normalizeRecentColors,
  paletteColors,
  recordRecentColor,
  snapColorToMiniSafe,
  swatchMetadata,
} from "./palette.js";
import {
  GRID_SIZE,
  createDocument,
  createPixelHistory,
  indexFor,
  isActiveCell,
  normalizeColor,
} from "./state.js";
import {
  createEmptyEnvelope,
  createGalleryStorage,
  parseBackup,
  serializeBackup,
} from "./storage.js";
import { shiftPixels } from "./tools.js";

const elements = {
  appStatus: document.querySelector("#app-status"),
  canvas: document.querySelector("#drawing-canvas"),
  canvasFrame: document.querySelector(".canvas-frame"),
  coordinateReadout: document.querySelector("#coordinate-readout"),
  gridToggle: document.querySelector("#grid-toggle"),
  gridMode: document.querySelector("#grid-mode"),
  mirrorToggle: document.querySelector("#mirror-toggle"),
  palette: document.querySelector("#palette"),
  activeColourSwatch: document.querySelector("#active-colour-swatch"),
  activeColourHex: document.querySelector("#active-colour-hex"),
  hexInputError: document.querySelector("#hex-input-error"),
  colourPicker: document.querySelector("#colour-picker"),
  customColourSlots: [...document.querySelectorAll(".custom-colour-slot")],
  assignCustomColour: document.querySelector("#assign-custom-colour"),
  recentColours: document.querySelector("#recent-colours"),
  recentColoursEmpty: document.querySelector("#recent-colours-empty"),
  iconName: document.querySelector("#icon-name"),
  exportPng: document.querySelector("#export-png"),
  clearCanvas: document.querySelector("#clear-canvas"),
  clearDialog: document.querySelector("#clear-confirm-dialog"),
  gridDialog: document.querySelector("#grid-change-dialog"),
  gridChangeMessage: document.querySelector("#grid-change-message"),
  gridShiftNote: document.querySelector("#grid-shift-note"),
  gridShift: document.querySelector("#grid-shift"),
  undo: document.querySelector("#undo"),
  redo: document.querySelector("#redo"),
  toolButtons: [...document.querySelectorAll("[data-tool]")],
  newIcon: document.querySelector("#new-icon"),
  exportBackup: document.querySelector("#export-backup"),
  importBackup: document.querySelector("#import-backup"),
  backupFileInput: document.querySelector("#backup-file-input"),
  galleryCount: document.querySelector("#gallery-count"),
  galleryGrid: document.querySelector("#gallery-grid"),
  galleryEmptyState: document.querySelector("#gallery-empty-state"),
  storageError: document.querySelector("#storage-error"),
  storageErrorMessage: document.querySelector("#storage-error-message"),
  resetGalleryStorage: document.querySelector("#reset-gallery-storage"),
  resetGalleryDialog: document.querySelector("#reset-gallery-dialog"),
  deleteDialog: document.querySelector("#delete-icon-dialog"),
  deleteMessage: document.querySelector("#delete-icon-message"),
  replaceGalleryDialog: document.querySelector("#replace-gallery-dialog"),
  replaceGalleryMessage: document.querySelector("#replace-gallery-message"),
  importImage: document.querySelector("#import-image"),
  imageFileInput: document.querySelector("#image-file-input"),
  importImageDialog: document.querySelector("#import-image-dialog"),
  importImageForm: document.querySelector("#import-image-form"),
  importClose: document.querySelector("#import-close"),
  importCancel: document.querySelector("#import-cancel"),
  importApply: document.querySelector("#import-apply"),
  importResetCrop: document.querySelector("#import-reset-crop"),
  importSourceSummary: document.querySelector("#import-source-summary"),
  importStatus: document.querySelector("#import-status"),
  importCropCanvas: document.querySelector("#import-crop-canvas"),
  importResultPreview: document.querySelector("#import-result-preview"),
  importDevicePreview: document.querySelector("#import-device-preview"),
  importAlphaThreshold: document.querySelector("#import-alpha-threshold"),
  importAlphaValue: document.querySelector("#import-alpha-value"),
  importBrightness: document.querySelector("#import-brightness"),
  importBrightnessValue: document.querySelector("#import-brightness-value"),
  importSaturation: document.querySelector("#import-saturation"),
  importSaturationValue: document.querySelector("#import-saturation-value"),
  importQuantise: document.querySelector("#import-quantise"),
  devicePreviewLife: document.querySelector("#device-preview-life"),
  devicePreviewDetail: document.querySelector("#device-preview-detail"),
  deviceGlowToggle: document.querySelector("#device-glow-toggle"),
  lintCount: document.querySelector("#lint-count"),
  lintList: document.querySelector("#lint-list"),
  lintEmpty: document.querySelector("#lint-empty"),
};

const VALID_TOOLS = new Set(["pen", "eraser", "fill", "eyedropper", "line", "rectangle"]);
const DEFAULT_PREFERENCES = Object.freeze({
  activeColor: "#FFB44B",
  previousColor: "#FFF0E1",
  activeTool: "pen",
  gridVisible: true,
  mirrorEnabled: false,
  glowEnabled: false,
  recentColors: Object.freeze([]),
  selectedCustomSlot: 0,
});

let galleryStorage = null;
let appState = createEmptyEnvelope();
let firstLoad = false;
let bootstrapError = null;
let upgradedExampleCount = 0;

try {
  galleryStorage = createGalleryStorage();
  const loaded = galleryStorage.load();
  appState = loaded.envelope;
  firstLoad = loaded.firstLoad;
} catch (error) {
  bootstrapError = error;
  firstLoad = galleryStorage === null;
}

if (firstLoad) {
  appState.documents = createExampleDocuments();
  appState.lastOpenId = appState.documents[0]?.id ?? null;
} else {
  const upgrade = upgradeExampleDocuments(appState.documents);
  appState.documents = upgrade.documents;
  upgradedExampleCount = upgrade.upgraded;
}

const preferences = normalizePreferences(appState.preferences);
let customSlots = customSlotsFromGroups(appState.palette);
let recentColors = preferences.recentColors;
let selectedCustomSlot = preferences.selectedCustomSlot;
let icon = appState.documents.find((documentModel) => documentModel.id === appState.lastOpenId)
  ?? appState.documents[0]
  ?? createDocument();
let activeColor = preferences.activeColor;
let previousColor = preferences.previousColor;
let activeTool = preferences.activeTool;
let renderFrame = null;
let displayFrame = null;
let bootstrapping = true;

const history = createPixelHistory({ limit: 100 });
const editorCanvas = new PixelCanvas(elements.canvas, {
  icon,
  history,
  activeColor,
  activeTool,
  showGrid: preferences.gridVisible,
  mirrorEnabled: preferences.mirrorEnabled,
  onChange: handleDocumentChange,
  onCoordinateChange(cell) {
    elements.coordinateReadout.value = cell ? `x ${cell.x}, y ${cell.y}` : "x —, y —";
  },
  onPickColor(color) {
    setActiveColor(color);
  },
  onUseColor(color) {
    recordColorUse(color);
  },
});
const devicePreview = new DevicePreview(elements.devicePreviewLife, elements.devicePreviewDetail, {
  glowEnabled: preferences.glowEnabled,
});

new ImageImportDialog({
  dialog: elements.importImageDialog,
  form: elements.importImageForm,
  openButton: elements.importImage,
  fileInput: elements.imageFileInput,
  dropTarget: elements.canvasFrame,
  cropCanvas: elements.importCropCanvas,
  resultCanvas: elements.importResultPreview,
  deviceCanvas: elements.importDevicePreview,
  closeButton: elements.importClose,
  cancelButton: elements.importCancel,
  applyButton: elements.importApply,
  resetCropButton: elements.importResetCrop,
  sourceSummary: elements.importSourceSummary,
  status: elements.importStatus,
  alphaThreshold: elements.importAlphaThreshold,
  alphaValue: elements.importAlphaValue,
  brightness: elements.importBrightness,
  brightnessValue: elements.importBrightnessValue,
  saturation: elements.importSaturation,
  saturationValue: elements.importSaturationValue,
  quantize: elements.importQuantise,
  getGrid: () => icon.grid,
  getPalette: () => [...DEFAULT_PALETTE, ...customSlotGroups(customSlots)],
  onApply: applyImportedPixels,
  onError(message) {
    showAppStatus(`${message} Try another image or export it again from its source.`, { error: true });
    elements.importImage.focus();
  },
});

function normalizePreferences(value) {
  const stored = value && typeof value === "object" ? value : {};
  return {
    activeColor: safeColor(stored.activeColor, DEFAULT_PREFERENCES.activeColor),
    previousColor: safeColor(stored.previousColor, DEFAULT_PREFERENCES.previousColor),
    activeTool: VALID_TOOLS.has(stored.activeTool) ? stored.activeTool : DEFAULT_PREFERENCES.activeTool,
    gridVisible: typeof stored.gridVisible === "boolean" ? stored.gridVisible : DEFAULT_PREFERENCES.gridVisible,
    mirrorEnabled: typeof stored.mirrorEnabled === "boolean" ? stored.mirrorEnabled : DEFAULT_PREFERENCES.mirrorEnabled,
    glowEnabled: typeof stored.glowEnabled === "boolean" ? stored.glowEnabled : DEFAULT_PREFERENCES.glowEnabled,
    recentColors: safeRecentColors(stored.recentColors),
    selectedCustomSlot: Number.isInteger(stored.selectedCustomSlot)
      && stored.selectedCustomSlot >= 0
      && stored.selectedCustomSlot < CUSTOM_SLOT_COUNT
      ? stored.selectedCustomSlot
      : DEFAULT_PREFERENCES.selectedCustomSlot,
  };
}

function safeColor(value, fallback) {
  try {
    return snapColorToMiniSafe(normalizeColor(value) ?? fallback);
  } catch {
    return fallback;
  }
}

function safeRecentColors(value) {
  try {
    return normalizeRecentColors(value ?? DEFAULT_PREFERENCES.recentColors);
  } catch {
    return [];
  }
}

function syncPreferences() {
  appState.palette = customSlotGroups(customSlots);
  appState.preferences = {
    activeColor,
    previousColor,
    activeTool,
    gridVisible: elements.gridToggle.checked,
    mirrorEnabled: elements.mirrorToggle.checked,
    glowEnabled: elements.deviceGlowToggle.checked,
    recentColors,
    selectedCustomSlot,
  };
}

function showAppStatus(message, { error = false } = {}) {
  elements.appStatus.textContent = message;
  elements.appStatus.classList.toggle("is-error", error);
  elements.appStatus.setAttribute("role", error ? "alert" : "status");
  elements.appStatus.hidden = false;
}

function showStorageError(message, { canReset = false } = {}) {
  elements.storageErrorMessage.textContent = message;
  elements.resetGalleryStorage.hidden = !canReset;
  elements.storageError.hidden = false;
}

function clearStorageError() {
  elements.storageError.hidden = true;
  elements.storageErrorMessage.textContent = "";
  elements.resetGalleryStorage.hidden = true;
}

function handleStorageError(error) {
  console.error(error);
  showStorageError(error?.message ?? "The gallery could not be saved. Export a backup to keep your work safe.", {
    canReset: error?.code === "corrupt" && galleryStorage !== null,
  });
}

function scheduleSave() {
  if (bootstrapping) return;
  syncPreferences();
  if (!galleryStorage) return;
  try {
    galleryStorage.schedule(appState, { onError: handleStorageError, onSuccess: clearStorageError });
  } catch (error) {
    handleStorageError(error);
  }
}

function flushSave() {
  if (!galleryStorage) return;
  try {
    if (galleryStorage.flush()) clearStorageError();
  } catch (error) {
    handleStorageError(error);
  }
}

function isCurrentIconSaved() {
  return appState.documents.some((documentModel) => documentModel === icon || documentModel.id === icon.id);
}

function ensureCurrentIconSaved() {
  if (!isCurrentIconSaved()) appState.documents.push(icon);
  appState.lastOpenId = icon.id;
}

function handleDocumentChange() {
  ensureCurrentIconSaved();
  scheduleSave();
  updateHistoryControls();
  queueGalleryRender();
  queueDisplayRender();
}

function queueDisplayRender() {
  if (displayFrame !== null) return;
  displayFrame = requestAnimationFrame(() => {
    displayFrame = null;
    renderDisplayFeedback();
  });
}

function renderDisplayFeedback() {
  devicePreview.setIcon(icon);
  const warnings = analyzeDocument(icon);
  const fragment = document.createDocumentFragment();

  for (const warning of warnings) {
    const item = document.createElement("article");
    item.className = `lint-item lint-${warning.severity}`;
    item.dataset.lintId = warning.id;

    const message = document.createElement("p");
    message.textContent = warning.message;
    item.append(message);

    if (warning.actions.length > 0) {
      const actions = document.createElement("div");
      actions.className = "lint-actions";
      for (const action of warning.actions) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "lint-action";
        button.textContent = action.label;
        button.setAttribute("aria-label", `${action.label}. ${warning.message}`);
        button.addEventListener("click", () => applyLintFix(warning.id, action));
        actions.append(button);
      }
      item.append(actions);
    }
    fragment.append(item);
  }

  elements.lintList.replaceChildren(fragment);
  elements.lintCount.textContent = warnings.length === 0
    ? "Clear"
    : `${warnings.length} ${warnings.length === 1 ? "issue" : "issues"}`;
  elements.lintEmpty.hidden = warnings.length > 0;
}

function applyLintFix(warningId, action) {
  if (history.isTransacting) return;
  let nextPixels = null;
  if (warningId === "pure-black") {
    nextPixels = replaceExactColor(icon.pixels, "#000000", action.replacement, icon.grid);
  } else if (warningId === "inactive-gutter" && action.id === "clear-inactive-gutter") {
    nextPixels = clearInactiveGutters(icon.pixels, icon.grid);
  }
  if (nextPixels === null) return;

  history.run(icon, (documentModel) => {
    documentModel.pixels = nextPixels;
  });
  editorCanvas.refresh();
  handleDocumentChange();
}

function updateHistoryControls() {
  elements.undo.disabled = history.isTransacting || !history.canUndo;
  elements.redo.disabled = history.isTransacting || !history.canRedo;
}

function setActiveTool(tool, { persist = true } = {}) {
  if (!VALID_TOOLS.has(tool)) return;
  activeTool = tool;
  editorCanvas.setActiveTool(tool);
  for (const button of elements.toolButtons) {
    const selected = button.dataset.tool === tool;
    button.classList.toggle("is-active", selected);
    button.setAttribute("aria-pressed", String(selected));
  }
  if (persist) scheduleSave();
}

function setActiveColor(color, { rememberPrevious = true, persist = true, recordRecent = true } = {}) {
  const validColor = normalizeColor(color);
  if (validColor === null) return;
  const normalized = snapColorToMiniSafe(validColor);
  if (rememberPrevious && normalized !== activeColor) previousColor = activeColor;
  activeColor = normalized;
  editorCanvas.setActiveColor(normalized);
  elements.activeColourHex.value = normalized;
  elements.activeColourHex.setCustomValidity("");
  elements.activeColourHex.removeAttribute("aria-invalid");
  elements.hexInputError.hidden = true;
  elements.colourPicker.value = normalized;
  elements.activeColourSwatch.style.backgroundColor = normalized;
  elements.activeColourSwatch.setAttribute("aria-label", `Active colour ${normalized}`);
  for (const swatch of document.querySelectorAll(".swatch, .recent-colour")) {
    const selected = swatch.dataset.color === normalized;
    swatch.classList.toggle("is-active", selected);
    swatch.setAttribute("aria-pressed", String(selected));
  }
  if (recordRecent) recordColorUse(normalized, { persist: false });
  if (persist) scheduleSave();
}

function swapActiveColors() {
  const current = activeColor;
  setActiveColor(previousColor, { rememberPrevious: false, persist: false });
  previousColor = current;
  scheduleSave();
}

function recordColorUse(color, { persist = true } = {}) {
  const next = recordRecentColor(recentColors, color);
  if (next.length === recentColors.length && next.every((entry, index) => entry === recentColors[index])) return;
  recentColors = next;
  renderRecentColors();
  if (persist) scheduleSave();
}

function renderPalette() {
  const fragment = document.createDocumentFragment();
  for (const color of paletteColors(DEFAULT_PALETTE)) {
    const button = document.createElement("button");
    const metadata = swatchMetadata(color);
    button.type = "button";
    button.className = "swatch";
    button.dataset.color = color;
    button.style.setProperty("--swatch-colour", color);
    button.setAttribute("aria-label", `Use ${color}`);
    button.setAttribute("aria-pressed", "false");
    button.title = metadata.tooltip ? `${color} — ${metadata.tooltip}` : color;
    button.addEventListener("click", () => setActiveColor(color));
    fragment.append(button);
  }
  elements.palette.replaceChildren(fragment);
}

function renderCustomSlots() {
  for (const button of elements.customColourSlots) {
    const slotIndex = Number(button.dataset.slot);
    const color = customSlots[slotIndex];
    const selected = slotIndex === selectedCustomSlot;
    button.classList.toggle("is-selected", selected);
    button.classList.toggle("is-empty", color === null);
    button.setAttribute("aria-pressed", String(selected));
    button.style.setProperty("--custom-colour", color ?? "transparent");
    if (color === null) delete button.dataset.color;
    else button.dataset.color = color;
    button.title = color === null
      ? `Custom colour slot ${slotIndex + 1}, empty`
      : `Custom colour slot ${slotIndex + 1}, ${color}`;
    const accessibleLabel = button.querySelector(".sr-only");
    if (accessibleLabel) accessibleLabel.textContent = button.title;
  }
}

function renderRecentColors() {
  const fragment = document.createDocumentFragment();
  for (const color of recentColors) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "recent-colour";
    button.dataset.color = color;
    button.style.setProperty("--recent-colour", color);
    button.classList.toggle("is-active", color === activeColor);
    button.setAttribute("aria-label", `Use recent colour ${color}`);
    button.setAttribute("aria-pressed", String(color === activeColor));
    button.title = color;
    button.addEventListener("click", () => setActiveColor(color));
    fragment.append(button);
  }
  elements.recentColours.replaceChildren(fragment);
  elements.recentColoursEmpty.hidden = recentColors.length > 0;
}

function selectCustomSlot(slotIndex, { activate = true, persist = true } = {}) {
  if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= CUSTOM_SLOT_COUNT) return;
  selectedCustomSlot = slotIndex;
  renderCustomSlots();
  const color = customSlots[slotIndex];
  if (activate && color !== null) setActiveColor(color, { persist: false });
  if (persist) scheduleSave();
}

function assignActiveColorToCustomSlot() {
  customSlots = assignCustomSlot(customSlots, selectedCustomSlot, activeColor);
  renderCustomSlots();
  scheduleSave();
}

function commitHexColor() {
  const value = elements.activeColourHex.value.trim().toUpperCase();
  if (!/^#[0-9A-F]{6}$/.test(value)) {
    elements.activeColourHex.setCustomValidity("Enter a colour as #RRGGBB.");
    elements.activeColourHex.setAttribute("aria-invalid", "true");
    elements.hexInputError.hidden = false;
    elements.activeColourHex.reportValidity();
    return false;
  }
  setActiveColor(value);
  return true;
}

async function exportDocument(documentModel, button = null) {
  if (button?.getAttribute("aria-busy") === "true") return;
  if (button) {
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
  }
  try {
    await downloadPng(documentModel);
    showAppStatus(`${documentModel.name || "Icon"} downloaded as an exact 16 × 16 PNG.`);
  } catch (error) {
    console.error(error);
    showAppStatus("The PNG could not be exported. Keep this page open and try the export again.", { error: true });
  } finally {
    if (button) {
      button.disabled = false;
      button.removeAttribute("aria-busy");
    }
  }
}

function exportIcon() {
  return exportDocument(icon, elements.exportPng);
}

function undo() {
  if (history.isTransacting || !history.undo(icon)) return;
  editorCanvas.refresh();
  handleDocumentChange();
}

function redo() {
  if (history.isTransacting || !history.redo(icon)) return;
  editorCanvas.refresh();
  handleDocumentChange();
}

function shiftIcon(offsetX, offsetY) {
  if (history.isTransacting) return;
  history.run(icon, (documentModel) => {
    documentModel.pixels = shiftPixels(documentModel.pixels, offsetX, offsetY);
  });
  editorCanvas.refresh();
  handleDocumentChange();
}

function showDialog(dialog) {
  if (dialog.open) return Promise.resolve("cancel");
  dialog.returnValue = "cancel";
  return new Promise((resolve) => {
    dialog.addEventListener("close", () => resolve(dialog.returnValue || "cancel"), { once: true });
    dialog.showModal();
  });
}

async function requestClearCanvas() {
  if (history.isTransacting || icon.pixels.every((pixel) => pixel === null)) return;
  const choice = await showDialog(elements.clearDialog);
  if (choice !== "confirm") return;
  history.run(icon, (documentModel) => {
    documentModel.pixels = Array(GRID_SIZE * GRID_SIZE).fill(null);
  });
  editorCanvas.refresh();
  handleDocumentChange();
}

function applyImportedPixels(pixels) {
  if (history.isTransacting || !Array.isArray(pixels) || pixels.length !== GRID_SIZE * GRID_SIZE) return false;
  history.run(icon, (documentModel) => {
    documentModel.pixels = pixels.slice();
  });
  editorCanvas.refresh();
  handleDocumentChange();
  return true;
}

function countInactivePixels(pixels, grid) {
  let count = 0;
  for (let y = 0; y < GRID_SIZE; y += 1) {
    for (let x = 0; x < GRID_SIZE; x += 1) {
      if (pixels[indexFor(x, y)] !== null && !isActiveCell(x, y, grid)) count += 1;
    }
  }
  return count;
}

function suggestedOddGridShift(grid) {
  const horizontal = grid.endsWith("r") ? 1 : -1;
  const vertical = grid.startsWith("odd-b") ? 1 : -1;
  return { horizontal, vertical };
}

function shiftArrow(horizontal, vertical) {
  return new Map([
    ["-1,-1", "↖"], ["1,-1", "↗"], ["-1,1", "↙"], ["1,1", "↘"],
  ]).get(`${horizontal},${vertical}`);
}

function applyGridMode(grid) {
  icon.grid = grid;
  icon.updatedAt = Date.now();
  elements.gridMode.value = grid;
  editorCanvas.gridModeChanged();
  handleDocumentChange();
}

async function requestGridMode(grid) {
  const previousGrid = icon.grid;
  if (grid === previousGrid) return;
  if (grid === "full") {
    applyGridMode(grid);
    return;
  }

  const affected = countInactivePixels(icon.pixels, grid);
  if (affected === 0) {
    applyGridMode(grid);
    return;
  }

  const { horizontal, vertical } = suggestedOddGridShift(grid);
  const shiftedPixels = shiftPixels(icon.pixels, horizontal, vertical);
  const affectedAfterShift = countInactivePixels(shiftedPixels, grid);
  const arrow = shiftArrow(horizontal, vertical);
  elements.gridChangeMessage.textContent = `${affected} painted ${affected === 1 ? "pixel falls" : "pixels fall"} in the new inactive gutter. Gutter pixels cannot be edited and export transparent.`;
  elements.gridShift.textContent = `Shift image ${arrow}`;
  elements.gridShiftNote.textContent = affectedAfterShift === 0
    ? `A wrapping one-pixel shift ${arrow} keeps every painted pixel in the active region.`
    : `After a wrapping one-pixel shift ${arrow}, ${affectedAfterShift} painted ${affectedAfterShift === 1 ? "pixel remains" : "pixels remain"} masked.`;
  elements.gridMode.disabled = true;
  const choice = await showDialog(elements.gridDialog);
  elements.gridMode.disabled = false;

  if (choice === "cancel") {
    elements.gridMode.value = previousGrid;
    return;
  }
  if (choice === "shift") {
    history.run(icon, (documentModel) => {
      documentModel.pixels = shiftedPixels;
    });
  }
  applyGridMode(grid);
}

function setMirrorEnabled(enabled, { persist = true } = {}) {
  elements.mirrorToggle.checked = enabled;
  editorCanvas.setMirrorEnabled(enabled);
  if (persist) scheduleSave();
}

function selectDocument(documentModel, { persist = true } = {}) {
  if (!documentModel || history.isTransacting) return;
  icon = documentModel;
  history.clear();
  editorCanvas.setIcon(icon);
  elements.iconName.value = icon.name;
  elements.gridMode.value = icon.grid;
  appState.lastOpenId = isCurrentIconSaved() ? icon.id : null;
  updateHistoryControls();
  renderGallery();
  queueDisplayRender();
  if (persist) scheduleSave();
}

function createNewIcon() {
  const documentModel = createDocument();
  appState.documents.push(documentModel);
  selectDocument(documentModel);
  elements.iconName.focus();
  elements.iconName.select();
}

function duplicateDocument(documentModel = icon) {
  if (!documentModel) return;
  if (documentModel === icon) ensureCurrentIconSaved();
  const duplicate = createDocument({
    name: `${documentModel.name || "Untitled icon"} copy`,
    pixels: documentModel.pixels,
    grid: documentModel.grid,
  });
  const sourceIndex = appState.documents.findIndex((candidate) => candidate.id === documentModel.id);
  appState.documents.splice(sourceIndex < 0 ? appState.documents.length : sourceIndex + 1, 0, duplicate);
  selectDocument(duplicate);
}

function renameDocument(documentModel) {
  selectDocument(documentModel);
  elements.iconName.focus();
  elements.iconName.select();
}

async function requestDeleteDocument(documentModel) {
  if (!documentModel || !appState.documents.some((candidate) => candidate.id === documentModel.id)) return;
  elements.deleteMessage.textContent = `“${documentModel.name || "Untitled icon"}” will be removed from this browser. This cannot be undone.`;
  const choice = await showDialog(elements.deleteDialog);
  if (choice !== "confirm") return;

  const index = appState.documents.findIndex((candidate) => candidate.id === documentModel.id);
  if (index < 0) return;
  const deletingCurrent = documentModel.id === icon.id;
  appState.documents.splice(index, 1);
  if (deletingCurrent) {
    const next = appState.documents[Math.min(index, appState.documents.length - 1)] ?? createDocument();
    selectDocument(next, { persist: false });
  } else {
    renderGallery();
  }
  appState.lastOpenId = isCurrentIconSaved() ? icon.id : null;
  scheduleSave();
}

function queueGalleryRender() {
  if (renderFrame !== null) return;
  renderFrame = requestAnimationFrame(() => {
    renderFrame = null;
    renderGallery();
  });
}

function renderGalleryPreview(documentModel) {
  const canvas = document.createElement("canvas");
  canvas.width = 48;
  canvas.height = 48;
  canvas.setAttribute("aria-hidden", "true");
  const context = canvas.getContext("2d", { alpha: false });
  context.imageSmoothingEnabled = false;
  context.fillStyle = "#0E0D11";
  context.fillRect(0, 0, 48, 48);
  for (let y = 0; y < GRID_SIZE; y += 1) {
    for (let x = 0; x < GRID_SIZE; x += 1) {
      const color = documentModel.pixels[indexFor(x, y)];
      if (color === null || color === "#000000" || !isActiveCell(x, y, documentModel.grid)) continue;
      context.fillStyle = color;
      context.fillRect(x * 3, y * 3, 3, 3);
    }
  }
  return canvas;
}

function createCardAction(label, action, handler) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "gallery-card-action";
  button.dataset.action = action;
  button.textContent = label;
  button.addEventListener("click", handler);
  return button;
}

function renderGallery() {
  const fragment = document.createDocumentFragment();
  for (const documentModel of appState.documents) {
    const card = document.createElement("article");
    card.className = "gallery-card";
    card.classList.toggle("is-current", documentModel.id === icon.id);

    const load = document.createElement("button");
    load.type = "button";
    load.className = "gallery-card-load";
    load.setAttribute("aria-label", `Open ${documentModel.name || "Untitled icon"}`);
    const preview = document.createElement("span");
    preview.className = "gallery-preview";
    preview.append(renderGalleryPreview(documentModel));
    const name = document.createElement("span");
    name.className = "gallery-card-name";
    name.textContent = documentModel.name || "Untitled icon";
    load.append(preview, name);
    load.addEventListener("click", () => selectDocument(documentModel));

    const actions = document.createElement("div");
    actions.className = "gallery-card-actions";
    actions.append(
      createCardAction("Rename", "rename", () => renameDocument(documentModel)),
      createCardAction("Duplicate", "duplicate", () => duplicateDocument(documentModel)),
      createCardAction("Export", "export", (event) => exportDocument(documentModel, event.currentTarget)),
      createCardAction("Delete", "delete", () => requestDeleteDocument(documentModel)),
    );
    card.append(load, actions);
    fragment.append(card);
  }
  elements.galleryGrid.replaceChildren(fragment);
  const count = appState.documents.length;
  elements.galleryCount.textContent = `${count} ${count === 1 ? "icon" : "icons"}`;
  elements.galleryGrid.hidden = count === 0;
  elements.galleryEmptyState.hidden = count !== 0;
}

function downloadBackup() {
  syncPreferences();
  let json;
  try {
    json = serializeBackup(appState);
  } catch (error) {
    handleStorageError(error);
    return;
  }
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `yotopix-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function requestBackupImport(file) {
  if (!file) return;
  try {
    const replacement = parseBackup(await file.text());
    const exampleUpgrade = upgradeExampleDocuments(replacement.documents);
    replacement.documents = exampleUpgrade.documents;
    const count = replacement.documents.length;
    elements.replaceGalleryMessage.textContent = `Import “${file.name}” with ${count} ${count === 1 ? "icon" : "icons"}? Your current gallery will be replaced.`;
    const choice = await showDialog(elements.replaceGalleryDialog);
    if (choice !== "confirm") return;

    appState = replacement;
    const importedPreferences = normalizePreferences(appState.preferences);
    customSlots = customSlotsFromGroups(appState.palette);
    recentColors = importedPreferences.recentColors;
    selectedCustomSlot = importedPreferences.selectedCustomSlot;
    activeColor = importedPreferences.activeColor;
    previousColor = importedPreferences.previousColor;
    elements.gridToggle.checked = importedPreferences.gridVisible;
    editorCanvas.setGridVisible(importedPreferences.gridVisible);
    setMirrorEnabled(importedPreferences.mirrorEnabled, { persist: false });
    setGlowEnabled(importedPreferences.glowEnabled, { persist: false });
    renderCustomSlots();
    renderRecentColors();
    setActiveColor(importedPreferences.activeColor, { rememberPrevious: false, persist: false, recordRecent: false });
    previousColor = importedPreferences.previousColor;
    setActiveTool(importedPreferences.activeTool, { persist: false });

    const next = appState.documents.find((documentModel) => documentModel.id === appState.lastOpenId)
      ?? appState.documents[0]
      ?? createDocument();
    selectDocument(next, { persist: false });
    appState.lastOpenId = isCurrentIconSaved() ? icon.id : null;
    scheduleSave();
    flushSave();
  } catch (error) {
    console.error(error);
    showStorageError(`The backup was not imported: ${error.message} Your gallery was not changed.`);
  } finally {
    elements.backupFileInput.value = "";
  }
}

async function requestStorageReset() {
  if (!galleryStorage) return;
  const choice = await showDialog(elements.resetGalleryDialog);
  if (choice !== "confirm") return;

  try {
    galleryStorage.cancel();
    ensureCurrentIconSaved();
    syncPreferences();
    galleryStorage.schedule(appState, { onError: handleStorageError });
    galleryStorage.flush();
    clearStorageError();
    showAppStatus("Saved gallery data was reset. The icons from this session are now stored in this browser.");
  } catch (error) {
    handleStorageError(error);
  }
}

function setGlowEnabled(enabled, { persist = true } = {}) {
  elements.deviceGlowToggle.checked = Boolean(enabled);
  devicePreview.setGlowEnabled(enabled);
  if (persist) scheduleSave();
}

function isTextEditingTarget(target) {
  return target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement
    || target?.isContentEditable;
}

for (const button of elements.toolButtons) {
  button.addEventListener("click", () => setActiveTool(button.dataset.tool));
}
for (const button of elements.customColourSlots) {
  button.addEventListener("click", () => selectCustomSlot(Number(button.dataset.slot)));
}

elements.undo.addEventListener("click", undo);
elements.redo.addEventListener("click", redo);
elements.gridToggle.addEventListener("change", () => {
  editorCanvas.setGridVisible(elements.gridToggle.checked);
  scheduleSave();
});
elements.mirrorToggle.addEventListener("change", () => setMirrorEnabled(elements.mirrorToggle.checked));
elements.deviceGlowToggle.addEventListener("change", () => setGlowEnabled(elements.deviceGlowToggle.checked));
elements.gridMode.addEventListener("change", () => requestGridMode(elements.gridMode.value));
elements.clearCanvas.addEventListener("click", requestClearCanvas);
elements.iconName.addEventListener("input", () => {
  icon.name = elements.iconName.value;
  icon.updatedAt = Date.now();
  handleDocumentChange();
});
elements.exportPng.addEventListener("click", exportIcon);
elements.newIcon.addEventListener("click", createNewIcon);
elements.exportBackup.addEventListener("click", downloadBackup);
elements.importBackup.addEventListener("click", () => elements.backupFileInput.click());
elements.backupFileInput.addEventListener("change", () => requestBackupImport(elements.backupFileInput.files?.[0]));
elements.resetGalleryStorage.addEventListener("click", requestStorageReset);
elements.assignCustomColour.addEventListener("click", assignActiveColorToCustomSlot);
elements.colourPicker.addEventListener("input", () => setActiveColor(elements.colourPicker.value));
elements.activeColourHex.addEventListener("input", () => {
  elements.activeColourHex.setCustomValidity("");
  elements.activeColourHex.removeAttribute("aria-invalid");
  elements.hexInputError.hidden = true;
});
elements.activeColourHex.addEventListener("change", commitHexColor);
elements.activeColourHex.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    commitHexColor();
  } else if (event.key === "Escape") {
    elements.activeColourHex.value = activeColor;
    elements.activeColourHex.setCustomValidity("");
    elements.activeColourHex.removeAttribute("aria-invalid");
    elements.hexInputError.hidden = true;
  }
});

document.addEventListener("keydown", (event) => {
  const key = event.key.toLowerCase();
  const command = event.metaKey || event.ctrlKey;
  if (document.querySelector("dialog[open]")) return;
  if (command && key === "s") {
    event.preventDefault();
    exportIcon();
    return;
  }
  if (isTextEditingTarget(event.target)) return;

  if (command && key === "z") {
    event.preventDefault();
    if (event.shiftKey) redo();
    else undo();
    return;
  }
  if (command && key === "d") {
    event.preventDefault();
    if (!event.repeat) duplicateDocument();
    return;
  }
  if (command || event.altKey) return;

  const shifts = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
  };
  if (shifts[event.key]) {
    event.preventDefault();
    shiftIcon(...shifts[event.key]);
    return;
  }
  if (key === "delete" || event.key === "Backspace") {
    event.preventDefault();
    if (!event.repeat) requestClearCanvas();
    return;
  }
  if (key === "m") {
    if (!event.repeat) setMirrorEnabled(!elements.mirrorToggle.checked);
    return;
  }
  if (key === "x") {
    if (!event.repeat) swapActiveColors();
    return;
  }
  if (/^[1-8]$/.test(event.key)) {
    selectCustomSlot(Number(event.key) - 1);
    return;
  }

  const shortcuts = { b: "pen", e: "eraser", g: "fill", i: "eyedropper", l: "line", r: "rectangle" };
  if (shortcuts[key]) setActiveTool(shortcuts[key]);
});

window.addEventListener("beforeunload", flushSave);

renderPalette();
renderCustomSlots();
renderRecentColors();
elements.gridToggle.checked = preferences.gridVisible;
elements.iconName.value = icon.name;
elements.gridMode.value = icon.grid;
setActiveColor(activeColor, { rememberPrevious: false, persist: false, recordRecent: false });
previousColor = preferences.previousColor;
setActiveTool(activeTool, { persist: false });
setMirrorEnabled(preferences.mirrorEnabled, { persist: false });
setGlowEnabled(preferences.glowEnabled, { persist: false });
renderGallery();
renderDisplayFeedback();
updateHistoryControls();
bootstrapping = false;

if (bootstrapError) {
  handleStorageError(bootstrapError);
}
if (firstLoad || upgradedExampleCount > 0) {
  scheduleSave();
  flushSave();
}
