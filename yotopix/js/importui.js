// The import modal: crop box, live preview, and the controls from SPEC §8.
//
// Kept out of main.js because it is a self-contained piece of UI with its own
// interaction state. It knows nothing about the document — it resolves to a
// plain array of pixels and lets the caller apply it as one undoable edit.

import { SIZE, region, idx } from './state.js';
import { drawPreview } from './preview.js';
import {
  decodeToImageData, centreCrop, clampCrop, buildPixels, BOX, NEAREST,
} from './importer.js';

const CROP_STAGE_MAX = 320;

export function createImportUI({ dialog, elements, getGrid, getPalette, onApply }) {
  const el = elements;
  let image = null;      // ImageData of the source
  let crop = null;       // in source pixel coordinates
  let scale = 1;         // source px -> stage px
  let result = null;     // last built pixel array
  let targetSize = SIZE;

  // ---------------------------------------------------------------- options

  function options() {
    return {
      crop,
      size: targetSize,
      method: [...el.methods].find((r) => r.checked)?.value === 'nearest' ? NEAREST : BOX,
      alphaThreshold: Number(el.alpha.value) / 100,
      brightness: Number(el.brightness.value),
      saturation: Number(el.saturation.value),
      palette: el.quantise.checked ? getPalette() : null,
    };
  }

  // ---------------------------------------------------------------- render

  function drawSource() {
    const stage = el.cropStage;
    const maxSide = Math.min(CROP_STAGE_MAX, stage.clientWidth || CROP_STAGE_MAX);
    scale = Math.min(maxSide / image.width, maxSide / image.height);
    const w = Math.max(1, Math.round(image.width * scale));
    const h = Math.max(1, Math.round(image.height * scale));

    el.cropCanvas.width = w;
    el.cropCanvas.height = h;
    el.cropCanvas.style.width = `${w}px`;
    el.cropCanvas.style.height = `${h}px`;

    // Paint the source through an offscreen canvas at native size, then let the
    // browser scale it down smoothly — this is a photo, not pixel art.
    const off = document.createElement('canvas');
    off.width = image.width;
    off.height = image.height;
    off.getContext('2d').putImageData(image, 0, 0);
    const ctx = el.cropCanvas.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(off, 0, 0, w, h);
  }

  function drawCropBox() {
    const box = el.cropBox;
    box.style.left = `${Math.round(crop.x * scale)}px`;
    box.style.top = `${Math.round(crop.y * scale)}px`;
    box.style.width = `${Math.round(crop.size * scale)}px`;
    box.style.height = `${Math.round(crop.size * scale)}px`;
  }

  function renderResult() {
    result = buildPixels(image, options());

    // Both previews have to fit side by side in the 260px control column. Any
    // bigger and .import-body scrolls horizontally, which in Chrome also makes
    // it focusable and draws a focus ring around the whole modal.
    const cell = 7;
    const side = targetSize * cell;
    el.result.width = side;
    el.result.height = side;
    el.result.style.width = `${side}px`;
    el.result.style.height = `${side}px`;
    const ctx = el.result.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    for (let y = 0; y < targetSize; y++) {
      for (let x = 0; x < targetSize; x++) {
        const light = (x + y) % 2 === 0;
        ctx.fillStyle = light ? '#E9E7E2' : '#D0CDC7';
        ctx.fillRect(x * cell, y * cell, cell, cell);
        const color = result[y * targetSize + x];
        if (color === null) continue;
        ctx.fillStyle = color;
        ctx.fillRect(x * cell, y * cell, cell, cell);
      }
    }

    // Device preview: place the result into a full 16x16 document so odd-grid
    // imports are previewed where they will actually land.
    drawPreview(el.device, { pixels: placeIntoDocument(result) }, { cssSize: 112 });

    const lit = result.filter(Boolean).length;
    el.note.textContent = `${lit} of ${targetSize * targetSize} cells lit`
      + (targetSize === SIZE ? '' : `, placed in the ${targetSize} × ${targetSize} drawing area`);
  }

  /** Maps a size×size result into a full 256-cell array at the region origin. */
  function placeIntoDocument(cells) {
    const pixels = new Array(SIZE * SIZE).fill(null);
    const { x0, y0 } = region(getGrid());
    for (let y = 0; y < targetSize; y++) {
      for (let x = 0; x < targetSize; x++) {
        pixels[idx(x0 + x, y0 + y)] = cells[y * targetSize + x];
      }
    }
    return pixels;
  }

  function refresh() {
    el.outAlpha.textContent = `${el.alpha.value}%`;
    const b = Number(el.brightness.value);
    const s = Number(el.saturation.value);
    el.outBrightness.textContent = b > 0 ? `+${b}` : String(b);
    el.outSaturation.textContent = s > 0 ? `+${s}` : String(s);
    drawCropBox();
    renderResult();
  }

  // ------------------------------------------------------------ crop drag

  let dragging = null;

  el.cropBox.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    try {
      el.cropBox.setPointerCapture(event.pointerId);
    } catch {
      // Same as the canvas: capture is an optimisation, not a requirement.
    }
    dragging = { px: event.clientX, py: event.clientY, x: crop.x, y: crop.y };
  });

  el.cropBox.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    const dx = (event.clientX - dragging.px) / scale;
    const dy = (event.clientY - dragging.py) / scale;
    crop = clampCrop(
      { x: dragging.x + dx, y: dragging.y + dy, size: crop.size },
      image.width, image.height,
    );
    refresh();
  });

  const endDrag = () => { dragging = null; };
  el.cropBox.addEventListener('pointerup', endDrag);
  el.cropBox.addEventListener('pointercancel', endDrag);

  el.cropBox.addEventListener('keydown', (event) => {
    const step = event.shiftKey ? 10 : 1;
    const moves = {
      ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step],
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    crop = clampCrop(
      { x: crop.x + move[0], y: crop.y + move[1], size: crop.size },
      image.width, image.height,
    );
    refresh();
  });

  el.cropSize.addEventListener('input', () => {
    const max = Math.min(image.width, image.height);
    const next = Math.max(1, Math.round((Number(el.cropSize.value) / 100) * max));
    // Grow around the centre so the subject stays put.
    const cx = crop.x + crop.size / 2;
    const cy = crop.y + crop.size / 2;
    crop = clampCrop({ x: cx - next / 2, y: cy - next / 2, size: next }, image.width, image.height);
    refresh();
  });

  for (const input of [el.alpha, el.brightness, el.saturation]) {
    input.addEventListener('input', refresh);
  }
  for (const radio of el.methods) radio.addEventListener('change', refresh);
  el.quantise.addEventListener('change', refresh);

  el.apply.addEventListener('click', () => {
    dialog.close();
    onApply(placeIntoDocument(result));
  });
  el.cancel.addEventListener('click', () => dialog.close());

  // ------------------------------------------------------------------ open

  return {
    async open(source) {
      image = await decodeToImageData(source);
      targetSize = region(getGrid()).size;
      crop = centreCrop(image.width, image.height);
      el.cropSize.value = '100';
      dialog.showModal();
      // Sizing needs the dialog laid out, so draw after it is open.
      drawSource();
      refresh();
      // Put focus somewhere useful and predictable. Without this the browser
      // picks the first focusable thing, which can be the scrollable body.
      el.cropBox.focus();
    },
  };
}
