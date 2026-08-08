// Wiring and app bootstrap.

import {
  createDoc, clearPixels, litCount, quantiseHex,
  createHistory, region, isOdd, idx, SYMMETRY_MODES,
} from './state.js';
import { createGridView } from './canvas.js';
import {
  PEN, ERASER, FILL, EYEDROPPER, LINE, RECT, SHADE,
  shiftPixels, deadZoneCells,
} from './tools.js';
import {
  createPalette, createSlots, createRecents, createRamps, pushRecent, allSwatches,
  DEFAULT_PALETTE, SLOT_COUNT,
} from './palette.js';
import {
  createRamp, generateRamp, findRampFor, shadeStep, RAMP_DEFAULTS,
} from './ramp.js';
import { drawPreview } from './preview.js';
import { downloadPNG } from './exporter.js';
import { createGallery } from './gallery.js';
import { createImportUI } from './importui.js';
import { createPaperUI } from './paperui.js';
import { runLint, applyFix } from './lint.js';
import { buildExamples } from './examples.js';
import {
  storageAvailable, load, createSaver, isQuotaError,
  downloadBackup, parseBackup, sanitisePalette,
} from './storage.js';

const $ = (id) => document.getElementById(id);

const el = {
  frame: $('canvas-frame'),
  canvas: $('grid-canvas'),
  stage: document.querySelector('.stage'),
  coords: $('coords'),
  litCount: $('lit-count'),
  toggleGrid: $('toggle-grid'),
  symmetryButtons: [...document.querySelectorAll('.tool[data-symmetry]')],
  undo: $('undo'),
  redo: $('redo'),
  clear: $('clear-canvas'),
  gridMode: $('grid-mode'),
  gridHint: $('grid-hint'),
  palette: $('palette'),
  slots: $('slots'),
  recents: $('recents'),
  customPicker: $('custom-picker'),
  saveSlot: $('save-slot'),
  ramps: $('ramps'),
  newRamp: $('new-ramp'),
  rampDialog: $('ramp-dialog'),
  rampPreview: $('ramp-preview'),
  rampHexes: $('ramp-hexes'),
  rampBase: $('ramp-base'),
  rampBaseHex: $('ramp-base-hex'),
  rampSteps: $('ramp-steps'),
  rampHue: $('ramp-hue'),
  rampName: $('ramp-name'),
  rampCreate: $('ramp-create'),
  rampCancel: $('ramp-cancel'),
  outSteps: $('out-steps'),
  outHue: $('out-hue'),
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
  lint: $('lint'),
  importOpen: $('import-open'),
  importFile: $('import-file'),
  importDialog: $('import-dialog'),
  paperOpen: $('paper-open'),
  paperFile: $('paper-file'),
  paperDialog: $('paper-dialog'),
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
  color: '#FFC33C',
  previousColor: '#4BA5FF',
  glow: false,
  symmetry: 'off',
  persists: true,
  slots: new Array(SLOT_COUNT).fill(null),
  recents: [],
  ramps: [],
  activeRampId: null,
};

const history = createHistory();

/** Cell under the pointer or the keyboard caret, for the bracket-key shading. */
let lastCell = null;

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

  const palette = stored?.palette ?? sanitisePalette(null);
  app.slots = palette.slots;
  app.recents = palette.recents;
  app.ramps = palette.ramps;
  app.activeRampId = app.ramps[0]?.id ?? null;
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

const snapshotState = () => ({
  icons: app.icons,
  lastOpenId: app.doc?.id ?? null,
  palette: { slots: app.slots, recents: app.recents, ramps: app.ramps },
});

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
  renderLint();
  gallery.refresh(app.doc);
  persist();
}

/**
 * Non-blocking warnings, updated live — SPEC §7. The container is aria-live, so
 * it is rebuilt rather than diffed; at this size that costs nothing and keeps
 * announcements honest.
 */
function renderLint() {
  const warnings = runLint(app.doc);
  el.lint.replaceChildren();

  if (warnings.length === 0) {
    const clear = document.createElement('p');
    clear.className = 'lint-clear';
    clear.textContent = 'Nothing to flag. This will read correctly on the display.';
    el.lint.append(clear);
    return;
  }

  for (const warning of warnings) {
    const item = document.createElement('div');
    item.className = 'lint-item';

    const text = document.createElement('p');
    text.className = 'lint-message';
    text.textContent = warning.message;
    item.append(text);

    if (warning.fixes.length) {
      const row = document.createElement('div');
      row.className = 'lint-fixes';
      for (const fix of warning.fixes) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn btn-sm';
        button.textContent = fix.label;
        button.addEventListener('click', () => {
          edit(() => applyFix(app.doc, warning.cells, fix.action));
        });
        row.append(button);
      }
      item.append(row);
    }
    el.lint.append(item);
  }
}

/** After anything that changes the document wholesale (undo, shift, mode). */
function refreshAll() {
  view.render();
  renderGridUI();
  renderHistoryButtons();
  onDocChanged();
}

// ------------------------------------------------------------------ colour

/**
 * The one place a colour becomes active. Everything is snapped to the display's
 * 15-step channel grid on the way in, so the app never holds a colour the panel
 * cannot show — see state.js.
 */
function setColor(hex, { fromInput = false } = {}) {
  const next = quantiseHex(hex);
  if (!next || next === app.color) {
    // Junk, or a colour that snapped to the one already active: put the field
    // back so it always shows what is really selected.
    if (fromInput) el.activeHex.value = app.color;
    syncColorUI();
    return;
  }
  app.previousColor = app.color;
  app.color = next;
  syncColorUI();
}

function syncColorUI() {
  // A colour that belongs to a ramp activates that ramp — this is the
  // ramp-aware eyedropper from SPEC §15.1, and it covers every route to a
  // colour at once: the dropper, a ramp swatch, the hex field, recents.
  const owned = findRampFor(app.ramps, app.color);
  if (owned) app.activeRampId = owned.ramp.id;

  el.activeSwatch.style.background = app.color;
  // Exact comparison, not case-insensitive: typing "#ff0000" must be rewritten
  // as the canonical "#FF0000" rather than left as the user spelled it. The
  // guard only exists to avoid pointlessly rewriting an identical value.
  if (el.activeHex.value !== app.color) el.activeHex.value = app.color;
  // The native colour input always reports lowercase, so compare case-folded
  // or this would rewrite it on every sync.
  if (el.customPicker.value.toUpperCase() !== app.color) el.customPicker.value = app.color;
  paletteUI.setActive(app.color);
  slotsUI.setActive(app.color);
  recentsUI.render(app.recents, app.color);
  renderRamps();
}

const paletteUI = createPalette({
  container: el.palette,
  palette: DEFAULT_PALETTE,
  onPick: (hex) => setColor(hex),
});

const slotsUI = createSlots({
  container: el.slots,
  onPick: (hex) => setColor(hex),
  onAssign: (index) => assignSlot(index, app.color),
  onClear: (index) => {
    if (app.slots[index] === null) return;
    app.slots[index] = null;
    slotsUI.set(app.slots, app.color);
    persist();
    toast(`Slot ${index + 1} cleared`);
  },
});

const recentsUI = createRecents({
  container: el.recents,
  onPick: (hex) => setColor(hex),
});

const rampsUI = createRamps({
  container: el.ramps,
  onPick: (hex, rampId) => {
    app.activeRampId = rampId;
    setColor(hex);
  },
  onDelete: (rampId) => {
    const ramp = app.ramps.find((r) => r.id === rampId);
    if (!ramp) return;
    if (!confirm(`Delete the ramp "${ramp.name}"?`)) return;
    app.ramps = app.ramps.filter((r) => r.id !== rampId);
    if (app.activeRampId === rampId) app.activeRampId = app.ramps[0]?.id ?? null;
    renderRamps();
    persist();
    toast(`Deleted ${ramp.name}`);
  },
});

function activeRamp() {
  return app.ramps.find((r) => r.id === app.activeRampId) ?? null;
}

function renderRamps() {
  rampsUI.render(app.ramps, app.color, app.activeRampId);
}

// ------------------------------------------------------------ ramp dialog

function rampSettings() {
  return {
    steps: Number(el.rampSteps.value),
    hueShift: Number(el.rampHue.value),
    direction: [...document.querySelectorAll('input[name="ramp-dir"]')]
      .find((r) => r.checked)?.value ?? RAMP_DEFAULTS.direction,
  };
}

function renderRampPreview() {
  const base = quantiseHex(el.rampBase.value) ?? '#FF4B4B';
  const generated = generateRamp(base, rampSettings());

  el.rampBaseHex.textContent = base;
  el.outSteps.textContent = String(generated.steps);
  el.outHue.textContent = `${el.rampHue.value}°`;

  el.rampPreview.replaceChildren();
  for (const hex of generated.swatches) {
    const step = document.createElement('span');
    step.className = 'ramp-step-view';
    step.style.background = hex;
    el.rampPreview.append(step);
  }
  el.rampPreview.setAttribute('aria-label', `Ramp preview: ${generated.swatches.join(', ')}`);
  el.rampHexes.textContent = generated.swatches.join('  ');
  return generated;
}

for (const input of [el.rampBase, el.rampSteps, el.rampHue]) {
  // Ranges and the colour input both fire `input` continuously; the preview is
  // cheap and this is not a committed edit, so live is right here.
  input.addEventListener('input', renderRampPreview);
}
for (const radio of document.querySelectorAll('input[name="ramp-dir"]')) {
  radio.addEventListener('change', renderRampPreview);
}

el.newRamp.addEventListener('click', () => {
  el.rampBase.value = app.color;
  el.rampSteps.value = String(RAMP_DEFAULTS.steps);
  el.rampHue.value = String(RAMP_DEFAULTS.hueShift);
  el.rampName.value = '';
  const warm = document.querySelector('input[name="ramp-dir"][value="warm-light"]');
  if (warm) warm.checked = true;
  renderRampPreview();
  el.rampDialog.showModal();
  el.rampName.focus();
});

el.rampCancel.addEventListener('click', () => el.rampDialog.close());

el.rampCreate.addEventListener('click', () => {
  const base = quantiseHex(el.rampBase.value) ?? app.color;
  const ramp = createRamp(base, rampSettings(), el.rampName.value.trim());
  app.ramps.push(ramp);
  app.activeRampId = ramp.id;
  el.rampDialog.close();
  renderRamps();
  persist();
  setTool(SHADE);
  toast(`${ramp.name} created. Drag to lighten, Shift-drag to darken.`);
});

function assignSlot(index, hex) {
  const colour = quantiseHex(hex);
  if (!colour) return;
  app.slots[index] = colour;
  slotsUI.set(app.slots, app.color);
  persist();
  toast(`Saved ${colour} to slot ${index + 1}`);
}

/** Stores the active colour in the first free slot — SPEC §5's 8 custom slots. */
function saveToSlot() {
  const existing = app.slots.indexOf(app.color);
  if (existing !== -1) {
    toast(`${app.color} is already in slot ${existing + 1}`);
    return;
  }
  const free = app.slots.indexOf(null);
  if (free === -1) {
    toast('All eight slots are full. Right-click or press Delete on one to clear it.');
    return;
  }
  assignSlot(free, app.color);
}

el.saveSlot.addEventListener('click', saveToSlot);

// SPEC §12.6: <input type="color"> fires `input` continuously while the user
// drags around the picker. Only `change` is a committed choice.
el.customPicker.addEventListener('change', () => setColor(el.customPicker.value));

/** Records a colour actually painted with, not merely selected — SPEC §5. */
function recordRecent(hex) {
  const next = pushRecent(app.recents, hex);
  if (next[0] === app.recents[0] && next.length === app.recents.length) return;
  app.recents = next;
  recentsUI.render(app.recents, app.color);
  persist();
}

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
  if (tool === SHADE && app.ramps.length === 0) {
    toast('The shade tool needs a ramp. Make one under Shading ramps.');
    return;
  }
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
    const filename = downloadBackup(app.icons, { slots: app.slots, recents: app.recents });
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
    const { icons, skipped, palette } = parseBackup(await file.text());
    const message = `Restore ${icons.length} icons? This replaces the ${app.icons.length} `
      + `currently in the gallery.${skipped ? ` ${skipped} unreadable entries will be skipped.` : ''}`;
    if (!confirm(message)) return;
    app.icons = icons;
    app.doc = icons[0];
    // Older backups have no palette; keep the current slots rather than wiping
    // them, since the file simply has nothing to say about them.
    if (palette) {
      app.slots = palette.slots;
      app.recents = palette.recents;
      slotsUI.set(app.slots, app.color);
    }
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
  onStrokeEnd: (usedColor) => {
    if (!history.commit(app.doc)) return;
    renderHistoryButtons();
    // Recents records what was actually painted with, not what is merely
    // selected — and `usedColor` is null for an erase, including a right-drag
    // erase that overrode the active tool.
    if (usedColor) recordRecent(usedColor);
  },
  onChange: onDocChanged,
  onPick: (hex) => setColor(hex),
  onHover: (cell) => {
    lastCell = cell;
    el.coords.textContent = cell ? `${cell.x},${cell.y}` : '--,--';
  },
  onResize: (cssSize) => {
    el.stage.style.setProperty('--canvas-size', `${cssSize}px`);
  },
  getShade: (current, delta) => shadeStep(activeRamp(), current, delta),
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

/**
 * Symmetry: off / vertical / horizontal / quad / eight — SPEC §15.1.
 *
 * The helper behind this has handled all five modes, region-aware, since mirror
 * mode was built (DECISIONS #12), which is exactly what §15.3 asked for. This
 * only exposes them.
 */
function setSymmetry(mode) {
  if (!SYMMETRY_MODES.includes(mode)) return;
  app.symmetry = mode;
  for (const button of el.symmetryButtons) {
    const active = button.dataset.symmetry === mode;
    button.setAttribute('aria-checked', String(active));
    button.tabIndex = active ? 0 : -1;
  }
  view.render();
}

for (const button of el.symmetryButtons) {
  button.addEventListener('click', () => setSymmetry(button.dataset.symmetry));
}

// Roving focus inside the radiogroup, as the ARIA pattern expects.
el.symmetryButtons[0].parentElement.addEventListener('keydown', (e) => {
  const keys = ['ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight'];
  if (!keys.includes(e.key)) return;
  e.preventDefault();
  const dir = e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 1;
  const i = SYMMETRY_MODES.indexOf(app.symmetry);
  const next = SYMMETRY_MODES[(i + dir + SYMMETRY_MODES.length) % SYMMETRY_MODES.length];
  setSymmetry(next);
  el.symmetryButtons.find((b) => b.dataset.symmetry === next)?.focus();
});

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

// ------------------------------------------------------------------ import

const importUI = createImportUI({
  dialog: el.importDialog,
  getGrid: () => app.doc.grid,
  getPalette: () => allSwatches(DEFAULT_PALETTE).concat(app.slots.filter(Boolean)),
  onApply: (pixels) => {
    // An import is a normal, undoable edit to the current icon — SPEC §8.
    edit(() => {
      app.doc.pixels = pixels;
    });
    toast('Image imported. Cmd+Z undoes it.');
  },
  elements: {
    cropStage: $('crop-stage'),
    cropCanvas: $('crop-canvas'),
    cropBox: $('crop-box'),
    cropSize: $('crop-size'),
    result: $('import-result'),
    device: $('import-device'),
    methods: [...document.querySelectorAll('input[name="method"]')],
    alpha: $('in-alpha'),
    brightness: $('in-brightness'),
    saturation: $('in-saturation'),
    quantise: $('in-quantise'),
    outAlpha: $('out-alpha'),
    outBrightness: $('out-brightness'),
    outSaturation: $('out-saturation'),
    note: $('import-note'),
    apply: $('import-apply'),
    cancel: $('import-cancel'),
  },
});

async function openImport(source) {
  try {
    await importUI.open(source);
  } catch (error) {
    toast(`Could not read that image: ${error.message}`);
  }
}

el.importOpen.addEventListener('click', () => el.importFile.click());
el.importFile.addEventListener('change', () => {
  const file = el.importFile.files?.[0];
  el.importFile.value = ''; // let the same file be chosen twice
  if (file) openImport(file);
});

// Drop an image anywhere on the drawing stage — SPEC §8.
for (const type of ['dragenter', 'dragover']) {
  el.stage.addEventListener(type, (event) => {
    if (![...event.dataTransfer.types].includes('Files')) return;
    event.preventDefault();
    el.stage.classList.add('drop-target');
  });
}
for (const type of ['dragleave', 'drop']) {
  el.stage.addEventListener(type, () => el.stage.classList.remove('drop-target'));
}
el.stage.addEventListener('drop', (event) => {
  const file = [...(event.dataTransfer?.files ?? [])].find((f) => f.type.startsWith('image/'));
  if (!file) return;
  event.preventDefault();
  openImport(file);
});

// -------------------------------------------------------- paper to pixel

const paperUI = createPaperUI({
  dialog: el.paperDialog,
  getGrid: () => app.doc.grid,
  getPalette: () => allSwatches(DEFAULT_PALETTE).concat(app.slots.filter(Boolean)),
  onApply: (pixels) => {
    edit(() => {
      app.doc.pixels = pixels;
    });
    toast('Drawing imported from paper. Cmd+Z undoes it.');
  },
  elements: {
    stage: $('paper-stage'),
    canvas: $('paper-canvas'),
    overlay: $('paper-overlay'),
    outline: $('paper-outline'),
    crossH: $('paper-cross-h'),
    crossV: $('paper-cross-v'),
    handles: [$('paper-tl'), $('paper-tr'), $('paper-br'), $('paper-bl')],
    result: $('paper-result'),
    device: $('paper-device'),
    threshold: $('in-paper'),
    saturation: $('in-paper-sat'),
    snap: $('in-paper-snap'),
    balance: $('in-paper-balance'),
    outThreshold: $('out-paper'),
    outSaturation: $('out-paper-sat'),
    note: $('paper-note'),
    apply: $('paper-apply'),
    reset: $('paper-reset'),
    cancel: $('paper-cancel'),
  },
});

el.paperOpen.addEventListener('click', () => el.paperFile.click());
el.paperFile.addEventListener('change', async () => {
  const file = el.paperFile.files?.[0];
  el.paperFile.value = '';
  if (!file) return;
  try {
    await paperUI.open(file);
  } catch (error) {
    toast(`Could not read that photo: ${error.message}`);
  }
});

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

const TOOL_KEYS = {
  b: PEN, e: ERASER, g: FILL, i: EYEDROPPER, l: LINE, r: RECT, d: SHADE,
};
const ARROWS = {
  ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
};

function isTyping(target) {
  return target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement;
}

window.addEventListener('keydown', (e) => {
  // While a modal is up it owns the keyboard; Escape is handled by <dialog>.
  if (el.dialog.open || el.importDialog.open || el.rampDialog.open
    || el.paperDialog.open) return;

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

  // Step the pixel under the cursor along the ramp without changing tools —
  // the fast path SPEC §15.1 asks for. Alt is already the eyedropper, so this
  // uses bracket keys rather than a mouse modifier; see DECISIONS.md.
  if (key === '[' || key === ']') {
    e.preventDefault();
    const ramp = activeRamp();
    if (!ramp) {
      toast('No ramp yet. Make one under Shading ramps.');
      return;
    }
    if (!lastCell) {
      toast('Point at a pixel first.');
      return;
    }
    const i = idx(lastCell.x, lastCell.y);
    const next = shadeStep(ramp, app.doc.pixels[i], key === ']' ? 1 : -1);
    if (next === null) return;
    edit(() => {
      app.doc.pixels[i] = next;
    });
    return;
  }

  if (TOOL_KEYS[key]) {
    setTool(TOOL_KEYS[key]);
    return;
  }

  // Digits 1-8 select the custom slots — SPEC §5.
  if (/^[1-8]$/.test(key)) {
    const hex = app.slots[Number(key) - 1];
    if (hex) setColor(hex);
    else toast(`Slot ${key} is empty`);
    return;
  }

  switch (key) {
    case 'm':
      setSymmetry(SYMMETRY_MODES[(SYMMETRY_MODES.indexOf(app.symmetry) + 1) % SYMMETRY_MODES.length]);
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
  slotsUI.set(app.slots, app.color);
  renderRamps();
  syncColorUI();
  el.name.value = app.doc.name;
  renderGallery();
  renderGridUI();
  renderHistoryButtons();
  refreshAll();
  persistNow();
}

boot();
