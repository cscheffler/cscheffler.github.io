// Wiring and app bootstrap.

import {
  createDoc, clearPixels, litCount, normaliseHex,
  createHistory, region, isOdd, idx,
} from './state.js';
import { createGridView } from './canvas.js';
import {
  PEN, ERASER, FILL, EYEDROPPER, LINE, RECT,
  shiftPixels, deadZoneCells,
} from './tools.js';
import { createPalette, DEFAULT_PALETTE } from './palette.js';
import { drawPreview } from './preview.js';
import { downloadPNG } from './exporter.js';
import { createGallery } from './gallery.js';
import { buildExamples } from './examples.js';
import {
  storageAvailable, load, createSaver, isQuotaError,
  downloadBackup, parseBackup,
} from './storage.js';

const $ = (id) => document.getElementById(id);

const el = {
  frame: $('canvas-frame'),
  canvas: $('grid-canvas'),
  stage: document.querySelector('.stage'),
  coords: $('coords'),
  litCount: $('lit-count'),
  toggleGrid: $('toggle-grid'),
  toggleMirror: $('toggle-mirror'),
  undo: $('undo'),
  redo: $('redo'),
  clear: $('clear-canvas'),
  gridMode: $('grid-mode'),
  gridHint: $('grid-hint'),
  palette: $('palette'),
  activeSwatch: $('active-swatch'),
  activeHex: $('active-hex'),
  previewLife: $('preview-life'),
  previewLarge: $('preview-large'),
  toggleGlow: $('toggle-glow'),
  name: $('icon-name'),
  export: $('export-png'),
  toast: $('toast'),
  dialog: $('deadzone-dialog'),
  dialogMessage: $('deadzone-message'),
  dialogShift: $('deadzone-shift'),
  dialogDrop: $('deadzone-drop'),
  dialogCancel: $('deadzone-cancel'),
  strip: $('gallery-strip'),
  storageNote: $('storage-note'),
  newIcon: $('new-icon'),
  duplicateIcon: $('duplicate-icon'),
  deleteIcon: $('delete-icon'),
  backupExport: $('backup-export'),
  backupImport: $('backup-import'),
  backupFile: $('backup-file'),
  tools: [...document.querySelectorAll('.tool[data-tool]')],
};

const app = {
  icons: [],
  doc: null,
  tool: PEN,
  color: '#FFC13B',
  previousColor: '#4FA8FF',
  glow: false,
  symmetry: 'off',
  persists: true,
};

const history = createHistory();

/**
 * Resolves which documents exist and which one is open. This runs BEFORE the
 * canvas view is constructed, because createGridView() renders immediately and
 * needs a document to render.
 */
function loadGallery() {
  if (!storageAvailable()) {
    app.persists = false;
    note('Storage is unavailable in this browser, so nothing is saved. Use Back up to keep your work.');
  }

  const stored = app.persists ? load() : null;

  if (stored === null) {
    // Nothing has ever been stored: seed the examples so the first load is not
    // a blank grid with no context. Deleting them sticks, because the key
    // exists from here on.
    app.icons = buildExamples();
  } else {
    app.icons = stored.icons;
    if (stored.corrupt) {
      note('The saved gallery could not be read. It has been left untouched, and this session started empty.');
    }
  }

  if (app.icons.length === 0) app.icons.push(createDoc('Untitled'));

  const last = stored?.lastOpenId
    ? app.icons.find((icon) => icon.id === stored.lastOpenId)
    : null;
  app.doc = last ?? app.icons[0];
}

loadGallery();

// ---------------------------------------------------------------- storage

const saver = createSaver({
  onError(error) {
    if (isQuotaError(error)) {
      app.persists = false;
      note('Storage is full. Back up your gallery, then delete some icons.');
      toast('Storage is full — nothing more will be saved.');
    } else {
      app.persists = false;
      note(`Could not save: ${error.message}. Use Back up to keep your work.`);
    }
  },
});

const snapshotState = () => ({ icons: app.icons, lastOpenId: app.doc?.id ?? null });

function persist() {
  if (!app.persists) return;
  saver.schedule(snapshotState);
}

/** Write now rather than in 500ms — before anything destructive or on unload. */
function persistNow() {
  if (!app.persists) return;
  saver.flush(snapshotState);
}

function note(message) {
  el.storageNote.textContent = message;
}

// ---------------------------------------------------------------- rendering

function renderPreviews() {
  drawPreview(el.previewLife, app.doc, { cssSize: 64, glow: app.glow });
  drawPreview(el.previewLarge, app.doc, { cssSize: 160, glow: app.glow });
}

function renderHistoryButtons() {
  el.undo.disabled = !history.canUndo();
  el.redo.disabled = !history.canRedo();
}

function renderGridUI() {
  el.gridMode.value = app.doc.grid;
  el.gridHint.hidden = !isOdd(app.doc.grid);
}

function onDocChanged() {
  renderPreviews();
  el.litCount.textContent = `${litCount(app.doc)} lit`;
  gallery.refresh(app.doc);
  persist();
}

/** After anything that changes the document wholesale (undo, shift, mode). */
function refreshAll() {
  view.render();
  renderGridUI();
  renderHistoryButtons();
  onDocChanged();
}

// ------------------------------------------------------------------ colour

function setColor(hex, { fromInput = false } = {}) {
  const next = normaliseHex(hex);
  if (!next || next === app.color) {
    if (!fromInput) return;
    el.activeHex.value = app.color; // reject junk, snap the field back
    return;
  }
  app.previousColor = app.color;
  app.color = next;
  el.activeSwatch.style.background = next;
  if (el.activeHex.value.toUpperCase() !== next) el.activeHex.value = next;
  paletteUI.setActive(next);
}

const paletteUI = createPalette({
  container: el.palette,
  palette: DEFAULT_PALETTE,
  onPick: (hex) => setColor(hex),
});

// SPEC §12.6: <input type="color"> fires input continuously while dragging.
// This is a text field, but the same principle applies — only commit on change
// or Enter, never on every keystroke.
el.activeHex.addEventListener('change', () => setColor(el.activeHex.value, { fromInput: true }));
el.activeHex.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    setColor(el.activeHex.value, { fromInput: true });
    el.activeHex.blur();
  }
});

// ------------------------------------------------------------------- tools

function setTool(tool) {
  app.tool = tool;
  for (const button of el.tools) {
    const active = button.dataset.tool === tool;
    button.setAttribute('aria-checked', String(active));
    button.tabIndex = active ? 0 : -1;
  }
}

for (const button of el.tools) {
  button.addEventListener('click', () => setTool(button.dataset.tool));
}

// Roving focus inside the radiogroup, as the ARIA pattern expects.
el.tools[0].parentElement.addEventListener('keydown', (e) => {
  const keys = ['ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight'];
  if (!keys.includes(e.key)) return;
  e.preventDefault();
  const dir = e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 1;
  const i = el.tools.findIndex((b) => b.dataset.tool === app.tool);
  const next = el.tools[(i + dir + el.tools.length) % el.tools.length];
  setTool(next.dataset.tool);
  next.focus();
});

// ----------------------------------------------------------------- gallery

const gallery = createGallery({
  container: el.strip,
  onSelect: (id) => selectIcon(id),
});

function renderGallery() {
  gallery.render(app.icons, app.doc?.id ?? null);
}

/**
 * Switches the editor to another icon. The undo stack is per-document and
 * session-only (DECISIONS.md #3), so it is dropped here rather than restored.
 */
function selectIcon(id) {
  const doc = app.icons.find((icon) => icon.id === id);
  if (!doc || doc === app.doc) return;
  persistNow();
  app.doc = doc;
  history.clear();
  el.name.value = doc.name;
  gallery.select(id);
  gallery.scrollTo(id);
  refreshAll();
}

function addIcon(doc, { after = null } = {}) {
  const at = after ? app.icons.findIndex((icon) => icon.id === after) + 1 : app.icons.length;
  app.icons.splice(at, 0, doc);
  app.doc = doc;
  history.clear();
  el.name.value = doc.name;
  renderGallery();
  gallery.scrollTo(doc.id);
  refreshAll();
}

function newIcon() {
  addIcon(createDoc('Untitled'));
  toast('New icon');
}

function duplicateIcon() {
  const source = app.doc;
  const copy = createDoc(`${source.name} copy`.slice(0, 64));
  copy.pixels = source.pixels.slice();
  copy.grid = source.grid;
  addIcon(copy, { after: source.id });
  toast(`Duplicated ${source.name}`);
}

function deleteIcon() {
  const doomed = app.doc;
  if (!confirm(`Delete "${doomed.name}"? Back up first if you want to keep it.`)) return;

  const at = app.icons.findIndex((icon) => icon.id === doomed.id);
  app.icons.splice(at, 1);

  // The editor always needs a document, so emptying the gallery starts a fresh
  // one rather than leaving nothing to draw on.
  if (app.icons.length === 0) {
    app.doc = createDoc('Untitled');
    app.icons.push(app.doc);
  } else {
    app.doc = app.icons[Math.min(at, app.icons.length - 1)];
  }
  history.clear();
  el.name.value = app.doc.name;
  renderGallery();
  refreshAll();
  persistNow();
  toast(`Deleted ${doomed.name}`);
}

el.newIcon.addEventListener('click', newIcon);
el.duplicateIcon.addEventListener('click', duplicateIcon);
el.deleteIcon.addEventListener('click', deleteIcon);

// ------------------------------------------------------------------ backup

el.backupExport.addEventListener('click', () => {
  try {
    const filename = downloadBackup(app.icons);
    toast(`Backed up ${app.icons.length} icons to ${filename}`);
  } catch (error) {
    toast(`Backup failed: ${error.message}`);
  }
});

el.backupImport.addEventListener('click', () => el.backupFile.click());

el.backupFile.addEventListener('change', async () => {
  const file = el.backupFile.files?.[0];
  el.backupFile.value = ''; // let the same file be chosen twice
  if (!file) return;
  try {
    const { icons, skipped } = parseBackup(await file.text());
    const message = `Restore ${icons.length} icons? This replaces the ${app.icons.length} `
      + `currently in the gallery.${skipped ? ` ${skipped} unreadable entries will be skipped.` : ''}`;
    if (!confirm(message)) return;
    app.icons = icons;
    app.doc = icons[0];
    history.clear();
    el.name.value = app.doc.name;
    renderGallery();
    refreshAll();
    persistNow();
    toast(`Restored ${icons.length} icons`);
  } catch (error) {
    toast(error.message);
  }
});

// ------------------------------------------------------------------ canvas

const view = createGridView({
  canvas: el.canvas,
  frame: el.frame,
  getDoc: () => app.doc,
  getTool: () => app.tool,
  getColor: () => app.color,
  getSymmetry: () => app.symmetry,
  onStrokeStart: () => history.begin(app.doc),
  onStrokeEnd: () => {
    if (history.commit(app.doc)) renderHistoryButtons();
  },
  onChange: onDocChanged,
  onPick: (hex) => setColor(hex),
  onHover: (cell) => {
    el.coords.textContent = cell ? `${cell.x},${cell.y}` : '--,--';
  },
  onResize: (cssSize) => {
    el.stage.style.setProperty('--canvas-size', `${cssSize}px`);
  },
});

// ------------------------------------------------------------------ history

function undo() {
  if (!history.undo(app.doc)) return;
  refreshAll();
}

function redo() {
  if (!history.redo(app.doc)) return;
  refreshAll();
}

el.undo.addEventListener('click', undo);
el.redo.addEventListener('click', redo);

/** Runs `mutate` as one undoable step. */
function edit(mutate) {
  history.begin(app.doc);
  mutate();
  const changed = history.commit(app.doc);
  refreshAll();
  return changed;
}

// ------------------------------------------------------- toggles and shift

let showGrid = true;
el.toggleGrid.addEventListener('click', () => {
  showGrid = !showGrid;
  el.toggleGrid.setAttribute('aria-pressed', String(showGrid));
  view.setShowGrid(showGrid);
});

function setMirror(on) {
  app.symmetry = on ? 'vertical' : 'off';
  el.toggleMirror.setAttribute('aria-pressed', String(on));
  view.render();
}

el.toggleMirror.addEventListener('click', () => setMirror(app.symmetry === 'off'));

el.toggleGlow.addEventListener('change', () => {
  app.glow = el.toggleGlow.checked;
  renderPreviews();
});

/** Arrow keys move the whole image by one pixel, wrapping — SPEC §5. */
function shiftCanvas(dx, dy) {
  edit(() => {
    app.doc.pixels = shiftPixels(app.doc.pixels, dx, dy);
  });
}

// -------------------------------------------------------------- grid modes

function applyGridMode(next, { shift = null, drop = false } = {}) {
  edit(() => {
    if (shift) app.doc.pixels = shiftPixels(app.doc.pixels, shift.dx, shift.dy);
    app.doc.grid = next;
    if (drop) {
      for (const { x, y } of deadZoneCells(app.doc, next)) {
        app.doc.pixels[idx(x, y)] = null;
      }
    }
  });
}

/**
 * Switching to a smaller region can destroy art. SPEC §5: don't do it silently
 * — say how many pixels are affected and offer to shift them clear first, which
 * is exactly what the wrapping arrow-key shift already does.
 */
function requestGridMode(next) {
  if (next === app.doc.grid) return;

  const dead = deadZoneCells(app.doc, next);
  if (dead.length === 0) {
    applyGridMode(next);
    return;
  }

  const { x0, y0 } = region(next);
  const dx = x0 === 0 ? -1 : 1;
  const dy = y0 === 0 ? -1 : 1;
  const shifted = shiftPixels(app.doc.pixels, dx, dy);
  const shiftClears = deadZoneCells({ pixels: shifted }, next).length === 0;

  const n = dead.length;
  el.dialogMessage.textContent = shiftClears
    ? `${n} ${n === 1 ? 'pixel sits' : 'pixels sit'} in the row and column this mode drops. `
      + 'Shifting the whole image one pixel moves them into the drawing area.'
    : `${n} ${n === 1 ? 'pixel sits' : 'pixels sit'} in the row and column this mode drops. `
      + 'Shifting will not help — the opposite edge is occupied too.';
  // Set display directly: .btn is display:block, which would win over [hidden].
  el.dialogShift.style.display = shiftClears ? '' : 'none';

  const cleanup = () => {
    el.dialogShift.onclick = null;
    el.dialogDrop.onclick = null;
    el.dialogCancel.onclick = null;
  };
  el.dialogShift.onclick = () => {
    cleanup();
    el.dialog.close();
    applyGridMode(next, { shift: { dx, dy } });
  };
  el.dialogDrop.onclick = () => {
    cleanup();
    el.dialog.close();
    applyGridMode(next, { drop: true });
  };
  el.dialogCancel.onclick = () => {
    cleanup();
    el.dialog.close();
    renderGridUI(); // put the select back where it was
  };
  el.dialog.showModal();
}

el.gridMode.addEventListener('change', () => requestGridMode(el.gridMode.value));
el.dialog.addEventListener('cancel', () => renderGridUI());

// ------------------------------------------------------------------- clear

function clearCanvas() {
  if (litCount(app.doc) === 0) return;
  if (!confirm('Clear the canvas?')) return;
  edit(() => clearPixels(app.doc));
  toast('Canvas cleared. Cmd+Z brings it back.');
}

el.clear.addEventListener('click', clearCanvas);

// ------------------------------------------------------------------ export

el.name.addEventListener('change', () => {
  app.doc.name = el.name.value.trim().slice(0, 64) || 'Untitled';
  el.name.value = app.doc.name;
  app.doc.updatedAt = Date.now();
  gallery.refresh(app.doc);
  persist();
});

async function exportPNG() {
  try {
    const filename = await downloadPNG(app.doc);
    toast(`Exported ${filename}`);
  } catch (error) {
    toast(`Export failed: ${error.message}`);
  }
}

el.export.addEventListener('click', exportPNG);

// ------------------------------------------------------------------- toast

let toastTimer;
function toast(message) {
  el.toast.textContent = message;
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.toast.hidden = true;
  }, 2400);
}

// ---------------------------------------------------------------- keyboard

const TOOL_KEYS = { b: PEN, e: ERASER, g: FILL, i: EYEDROPPER, l: LINE, r: RECT };
const ARROWS = {
  ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
};

function isTyping(target) {
  return target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement;
}

window.addEventListener('keydown', (e) => {
  // While the modal is up it owns the keyboard; Escape is handled by <dialog>.
  if (el.dialog.open) return;

  const mod = e.metaKey || e.ctrlKey;
  const typing = isTyping(e.target);
  const key = e.key.toLowerCase();

  if (mod && key === 'd') {
    e.preventDefault();
    duplicateIcon();
    return;
  }
  // Export stays available while naming the icon.
  if (mod && key === 's') {
    e.preventDefault();
    exportPNG();
    return;
  }
  if (mod && key === 'z') {
    // In a text field this belongs to the field, not the drawing.
    if (typing) return;
    e.preventDefault();
    e.shiftKey ? redo() : undo();
    return;
  }

  if (typing || mod || e.altKey) return;

  // Bare arrows shift the image. Shift+arrows move the canvas caret and are
  // handled (and stopped) by canvas.js, so they never reach here.
  const inRail = e.target instanceof Element && e.target.closest('.rail, .gallery');
  const arrow = ARROWS[e.key];
  if (arrow && !e.shiftKey && !inRail) {
    e.preventDefault();
    shiftCanvas(arrow[0], arrow[1]);
    return;
  }

  if (TOOL_KEYS[key]) {
    setTool(TOOL_KEYS[key]);
    return;
  }

  switch (key) {
    case 'm':
      setMirror(app.symmetry === 'off');
      break;
    case 'x':
      setColor(app.previousColor);
      break;
    // Digits 1-8 are reserved for custom palette slots (phase 4), so the grid
    // toggle takes '#' alone.
    case '#':
      el.toggleGrid.click();
      break;
    case 'delete':
    case 'backspace':
      e.preventDefault();
      clearCanvas();
      break;
    default:
      return;
  }
});

// A 500ms debounce can outlive the page; make sure the last stroke lands.
addEventListener('pagehide', () => persistNow());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') persistNow();
});

// -------------------------------------------------------------- first paint

function boot() {
  setTool(PEN);
  el.activeSwatch.style.background = app.color;
  el.activeHex.value = app.color;
  paletteUI.setActive(app.color);
  el.name.value = app.doc.name;
  renderGallery();
  renderGridUI();
  renderHistoryButtons();
  refreshAll();
  persistNow();
}

boot();
