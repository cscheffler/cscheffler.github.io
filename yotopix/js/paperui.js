// The paper-to-pixel modal: place four corners on the photographed grid, see
// the result, apply it — SPEC §15.2.
//
// Like importui.js, this holds only interaction state. The maths lives in
// homography.js and paper.js, where it can be tested without a camera.

import { SIZE, region, idx } from './state.js';
import { drawPreview } from './preview.js';
import { decodeToImageData } from './importer.js';
import { buildFromPhoto } from './paper.js';
import { isValidQuad } from './homography.js';

const STAGE_MAX = 420;
/** Corners start inset from the photo edge — the sheet is never edge to edge. */
const START_INSET = 0.12;

export function createPaperUI({ dialog, elements, getGrid, getPalette, onApply }) {
  const el = elements;
  let image = null;
  let scale = 1;          // photo px -> stage px
  let corners = null;     // in photo coordinates, [tl, tr, br, bl]
  let result = null;
  let targetSize = SIZE;

  const options = () => ({
    size: targetSize,
    paperThreshold: Number(el.threshold.value) / 100,
    saturation: Number(el.saturation.value),
    palette: el.snap.checked ? getPalette() : null,
    whiteBalance: el.balance.checked,
  });

  // ---------------------------------------------------------------- drawing

  function drawPhoto() {
    const maxSide = Math.min(STAGE_MAX, el.stage.clientWidth || STAGE_MAX);
    scale = Math.min(maxSide / image.width, maxSide / image.height);
    const w = Math.max(1, Math.round(image.width * scale));
    const h = Math.max(1, Math.round(image.height * scale));

    el.canvas.width = w;
    el.canvas.height = h;
    el.canvas.style.width = `${w}px`;
    el.canvas.style.height = `${h}px`;

    const off = document.createElement('canvas');
    off.width = image.width;
    off.height = image.height;
    off.getContext('2d').putImageData(image, 0, 0);
    const ctx = el.canvas.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(off, 0, 0, w, h);
  }

  /** The quad outline, drawn over the photo so the mapping is legible. */
  function drawQuad() {
    const svg = el.overlay;
    svg.setAttribute('viewBox', `0 0 ${el.canvas.width} ${el.canvas.height}`);
    svg.style.width = `${el.canvas.width}px`;
    svg.style.height = `${el.canvas.height}px`;

    const points = corners.map((c) => `${c.x * scale},${c.y * scale}`).join(' ');
    el.outline.setAttribute('points', points);

    // Two interior lines, so a twisted quad is obvious before you apply it.
    const mid = (a, b) => ({ x: (a.x + b.x) / 2 * scale, y: (a.y + b.y) / 2 * scale });
    const [tl, tr, br, bl] = corners;
    const h1 = mid(tl, bl);
    const h2 = mid(tr, br);
    const v1 = mid(tl, tr);
    const v2 = mid(bl, br);
    el.crossH.setAttribute('x1', h1.x); el.crossH.setAttribute('y1', h1.y);
    el.crossH.setAttribute('x2', h2.x); el.crossH.setAttribute('y2', h2.y);
    el.crossV.setAttribute('x1', v1.x); el.crossV.setAttribute('y1', v1.y);
    el.crossV.setAttribute('x2', v2.x); el.crossV.setAttribute('y2', v2.y);

    el.handles.forEach((handle, i) => {
      // Not rounded: on a large photo one source pixel is a fraction of a stage
      // pixel, and rounding made small adjustments look like nothing happened.
      handle.style.left = `${(corners[i].x * scale).toFixed(2)}px`;
      handle.style.top = `${(corners[i].y * scale).toFixed(2)}px`;
    });
  }

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

  function renderResult() {
    const valid = isValidQuad(corners);
    el.apply.disabled = !valid;

    if (!valid) {
      el.note.textContent = 'The corners are crossed or on top of each other. '
        + 'Put them on the four corners of the grid, in order.';
      result = null;
      return;
    }

    result = buildFromPhoto(image, corners, options());
    if (!result) {
      el.note.textContent = 'Could not read a grid from those corners.';
      el.apply.disabled = true;
      return;
    }

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
        ctx.fillStyle = (x + y) % 2 === 0 ? '#E9E7E2' : '#D0CDC7';
        ctx.fillRect(x * cell, y * cell, cell, cell);
        const colour = result[y * targetSize + x];
        if (colour === null) continue;
        ctx.fillStyle = colour;
        ctx.fillRect(x * cell, y * cell, cell, cell);
      }
    }

    drawPreview(el.device, { pixels: placeIntoDocument(result) }, { cssSize: 112 });

    const lit = result.filter(Boolean).length;
    el.note.textContent = `${lit} of ${targetSize * targetSize} squares picked up.`
      + (lit === 0 ? ' Lower the paper threshold if the drawing is faint.' : '');
  }

  function refresh() {
    el.outThreshold.textContent = `${el.threshold.value}%`;
    const s = Number(el.saturation.value);
    el.outSaturation.textContent = s > 0 ? `+${s}` : String(s);
    drawQuad();
    renderResult();
  }

  // ------------------------------------------------------------- dragging

  let dragging = -1;

  el.handles.forEach((handle, i) => {
    handle.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      try {
        handle.setPointerCapture(event.pointerId);
      } catch {
        // Throws InvalidPointerId if the pointer is not active. Capture only
        // helps a drag that leaves the handle; losing it must not abort the drag.
      }
      dragging = i;
    });
    handle.addEventListener('pointermove', (event) => {
      if (dragging !== i) return;
      const box = el.canvas.getBoundingClientRect();
      corners[i] = {
        x: Math.max(0, Math.min(image.width, (event.clientX - box.left) / scale)),
        y: Math.max(0, Math.min(image.height, (event.clientY - box.top) / scale)),
      };
      refresh();
    });
    const stop = () => { dragging = -1; };
    handle.addEventListener('pointerup', stop);
    handle.addEventListener('pointercancel', stop);

    // Nudging matters here: getting a corner exactly on a crop mark by drag
    // alone is fiddly, and the whole result depends on it.
    handle.addEventListener('keydown', (event) => {
      // One press moves one pixel on screen, whatever the photo's resolution:
      // a fixed step in source pixels feels dead on a 3000px phone photo and
      // jumpy on a small one.
      const onScreen = event.shiftKey ? 10 : 1;
      const step = scale > 0 ? onScreen / scale : onScreen;
      const moves = {
        ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step],
      };
      const move = moves[event.key];
      if (!move) return;
      event.preventDefault();
      corners[i] = {
        x: Math.max(0, Math.min(image.width, corners[i].x + move[0])),
        y: Math.max(0, Math.min(image.height, corners[i].y + move[1])),
      };
      refresh();
    });
  });

  for (const input of [el.threshold, el.saturation]) {
    input.addEventListener('input', refresh);
  }
  for (const box of [el.snap, el.balance]) {
    box.addEventListener('change', refresh);
  }

  el.reset.addEventListener('click', () => {
    corners = defaultCorners();
    refresh();
  });

  el.apply.addEventListener('click', () => {
    if (!result) return;
    dialog.close();
    onApply(placeIntoDocument(result));
  });
  el.cancel.addEventListener('click', () => dialog.close());

  function defaultCorners() {
    const ix = image.width * START_INSET;
    const iy = image.height * START_INSET;
    return [
      { x: ix, y: iy },
      { x: image.width - ix, y: iy },
      { x: image.width - ix, y: image.height - iy },
      { x: ix, y: image.height - iy },
    ];
  }

  return {
    async open(source) {
      image = await decodeToImageData(source);
      targetSize = region(getGrid()).size;
      corners = defaultCorners();
      dialog.showModal();
      drawPhoto();
      refresh();
      el.handles[0].focus();
    },
  };
}
