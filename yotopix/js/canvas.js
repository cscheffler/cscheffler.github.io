// Grid rendering, hit-testing and pointer handling.
//
// Everything here is computed in DEVICE pixels with an integer number of device
// pixels per cell. That is what actually makes the grid crisp; sizing the CSS
// box to a multiple of 16 is only a proxy for it and breaks on fractional DPR.

import { SIZE, idx, region, inRegion, centre, symmetryCells } from './state.js';
import {
  bresenham, applyCells, cellsForShape, floodFillCells,
  PEN, ERASER, FILL, EYEDROPPER, SHAPE_TOOLS,
} from './tools.js';

// Screen-space, deliberately NOT scaled with zoom: at 32x a "2px at 1x" checker
// would be 64px, larger than a cell, and would read as blocks behind the art
// rather than as texture. See DECISIONS.md.
const CHECKER_CSS = 8;
const CHECKER_LIGHT = '#E9E7E2';
const CHECKER_DARK = '#D0CDC7';
const ACCENT = '#FFB347';

export function createGridView({
  canvas,
  frame,
  getDoc,
  getTool,
  getColor,
  getSymmetry,
  onStrokeStart,
  onStrokeEnd,
  onChange,
  onHover,
  onResize,
  onPick,
}) {
  const ctx = canvas.getContext('2d', { alpha: false });
  let dpr = 1;
  let cell = 1; // device px per cell
  let showGrid = true;

  let drawing = false;
  let activeTool = PEN;
  let strokeColor = null;
  let last = null; // last painted cell, for interpolation
  let anchor = null; // shape origin
  let preview = null; // { cells, color }

  let cursor = { x: 0, y: 0 }; // keyboard caret
  let cursorVisible = false;

  const grid = () => getDoc().grid ?? 'full';
  const symmetry = () => getSymmetry?.() ?? 'off';

  function measure() {
    dpr = window.devicePixelRatio || 1;
    const rect = frame.getBoundingClientRect();
    const avail = Math.min(rect.width, rect.height);
    if (!(avail > 0)) return false;

    let c = Math.floor((avail * dpr) / SIZE);
    // On integer DPR, snapping the cell to a whole number of CSS pixels keeps
    // the canvas box a clean multiple of 16 as well.
    if (Number.isInteger(dpr) && dpr > 1) c -= c % dpr;
    c = Math.max(dpr, c);

    const backing = c * SIZE;
    if (canvas.width !== backing || canvas.height !== backing) {
      canvas.width = backing;
      canvas.height = backing;
    }
    const css = backing / dpr;
    canvas.style.width = `${css}px`;
    canvas.style.height = `${css}px`;
    cell = c;
    ctx.imageSmoothingEnabled = false;
    // The status strip lines up with the canvas edges rather than the stage.
    onResize?.(css);
    return true;
  }

  function drawChecker() {
    const size = Math.max(2, Math.round(CHECKER_CSS * dpr));
    const n = Math.ceil(canvas.width / size);
    ctx.fillStyle = CHECKER_LIGHT;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = CHECKER_DARK;
    for (let row = 0; row < n; row++) {
      for (let col = row % 2; col < n; col += 2) {
        ctx.fillRect(col * size, row * size, size, size);
      }
    }
  }

  function drawPixels(doc) {
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const color = doc.pixels[idx(x, y)];
        if (color === null) continue;
        ctx.fillStyle = color;
        ctx.fillRect(x * cell, y * cell, cell, cell);
      }
    }
  }

  /**
   * The in-progress shape. Symmetry is expanded here, at render time, so the
   * preview shows exactly what release will paint — the raw cells stay raw so
   * the commit path can apply symmetry itself. Without this the preview shows
   * one half of a mirrored shape and then paints both.
   */
  function drawPreview() {
    if (!preview) return;
    const g = grid();
    const mode = symmetry();
    const drawn = new Set();

    // Note: not named `cell` — that is the device-pixels-per-cell size above.
    for (const source of preview.cells) {
      // symmetryCells already clips to the active region and de-duplicates.
      for (const { x, y } of symmetryCells(g, source.x, source.y, mode)) {
        const i = idx(x, y);
        if (drawn.has(i)) continue;
        drawn.add(i);

        if (preview.color === null) {
          // Erase preview: show the checkerboard through, plus a tint so the
          // shape is still readable over transparent areas.
          ctx.fillStyle = CHECKER_LIGHT;
          ctx.fillRect(x * cell, y * cell, cell, cell);
          ctx.fillStyle = 'rgba(255,179,71,0.25)';
        } else {
          ctx.fillStyle = preview.color;
        }
        ctx.fillRect(x * cell, y * cell, cell, cell);
      }
    }
  }

  /**
   * The row and column odd-grid mode gives up. Rendered as a dimmed hatched
   * gutter rather than simply hidden — SPEC §5 wants the user to see exactly
   * what they have sacrificed.
   */
  function drawGutter() {
    const g = grid();
    if (g === 'full') return;
    const hatch = Math.max(2, Math.round(dpr * 3));

    ctx.save();
    ctx.beginPath();
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        if (inRegion(g, x, y)) continue;
        ctx.rect(x * cell, y * cell, cell, cell);
      }
    }
    ctx.clip();

    ctx.fillStyle = 'rgba(22,21,26,0.55)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = 'rgba(232,228,220,0.16)';
    ctx.lineWidth = Math.max(1, Math.round(dpr));
    ctx.beginPath();
    for (let d = -canvas.height; d < canvas.width; d += hatch * 2) {
      ctx.moveTo(d, 0);
      ctx.lineTo(d + canvas.height, canvas.height);
    }
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Which kind of guide sits at boundary `i` along one axis. Computed from the
   * region, never hardcoded: in odd mode the centre crosshair falls ON a cell,
   * so it is drawn as that cell's two edges rather than as one line.
   */
  function guideKind(origin, size, i) {
    const rel = i - origin;
    if (rel < 0 || rel > size) return 'hair';
    if (size % 2 === 0) {
      if (rel === size / 2) return 'centre';
    } else if (rel === (size - 1) / 2 || rel === (size + 1) / 2) {
      return 'centre';
    }
    if (rel % 4 === 0 && rel !== 0 && rel !== size) return 'major';
    return 'hair';
  }

  function drawGrid() {
    const span = canvas.width;
    const { x0, y0, size } = region(grid());
    const hair = Math.max(1, Math.round(dpr * 0.5));
    const major = Math.max(1, Math.round(dpr));
    const style = {
      centre: 'rgba(20,18,26,0.55)',
      major: 'rgba(20,18,26,0.34)',
      hair: 'rgba(20,18,26,0.16)',
    };

    for (let i = 1; i < SIZE; i++) {
      const kx = guideKind(x0, size, i);
      ctx.fillStyle = style[kx];
      const wx = kx === 'hair' ? hair : major;
      ctx.fillRect(i * cell - Math.floor(wx / 2), 0, wx, span);

      const ky = guideKind(y0, size, i);
      ctx.fillStyle = style[ky];
      const wy = ky === 'hair' ? hair : major;
      ctx.fillRect(0, i * cell - Math.floor(wy / 2), span, wy);
    }

    // Region edges, when they are not the canvas edges.
    if (grid() !== 'full') {
      ctx.fillStyle = 'rgba(20,18,26,0.45)';
      const w = Math.max(1, Math.round(dpr));
      for (const bx of [x0, x0 + size]) {
        if (bx > 0 && bx < SIZE) ctx.fillRect(bx * cell - Math.floor(w / 2), 0, w, span);
      }
      for (const by of [y0, y0 + size]) {
        if (by > 0 && by < SIZE) ctx.fillRect(0, by * cell - Math.floor(w / 2), span, w);
      }
    }
  }

  /** Dashed line on the mirror axis while symmetry is active — SPEC §5. */
  function drawMirrorAxis() {
    if (symmetry() === 'off') return;
    const axis = (centre(grid()).x + 0.5) * cell;
    ctx.save();
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = Math.max(1, Math.round(dpr));
    ctx.setLineDash([Math.round(cell * 0.35), Math.round(cell * 0.3)]);
    ctx.beginPath();
    ctx.moveTo(axis, 0);
    ctx.lineTo(axis, canvas.height);
    ctx.stroke();
    ctx.restore();
  }

  function drawCursor() {
    if (!cursorVisible) return;
    const w = Math.max(2, Math.round(dpr * 1.5));
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = w;
    ctx.strokeRect(cursor.x * cell + w / 2, cursor.y * cell + w / 2, cell - w, cell - w);
  }

  function render() {
    const doc = getDoc();
    // The view can be constructed before a document is ready; drawing nothing
    // is better than throwing out of a resize observer.
    if (canvas.width === 0 || !doc) return;
    drawChecker();
    drawPixels(doc);
    drawPreview();
    if (showGrid) drawGrid();
    drawGutter();
    drawMirrorAxis();
    drawCursor();
  }

  function cellFromEvent(e) {
    const rect = canvas.getBoundingClientRect();
    const size = rect.width / SIZE;
    const x = Math.floor((e.clientX - rect.left) / size);
    const y = Math.floor((e.clientY - rect.top) / size);
    return {
      x: Math.min(SIZE - 1, Math.max(0, x)),
      y: Math.min(SIZE - 1, Math.max(0, y)),
      inside: x >= 0 && y >= 0 && x < SIZE && y < SIZE,
    };
  }

  function write(cells, color) {
    const changed = applyCells(getDoc(), cells, color, { grid: grid(), symmetry: symmetry() });
    if (changed) {
      render();
      onChange?.();
    }
    return changed;
  }

  function strokeTo(x, y) {
    const cells = [];
    if (last) bresenham(last.x, last.y, x, y, (px, py) => cells.push({ x: px, y: py }));
    else cells.push({ x, y });
    last = { x, y };
    return write(cells, strokeColor);
  }

  function pickAt(x, y) {
    const color = getDoc().pixels[idx(x, y)];
    if (color !== null) onPick?.(color);
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.button !== 2) return;
    e.preventDefault();
    canvas.focus();
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // Throws InvalidPointerId if the pointer is already gone. Capture is an
      // optimisation for drags that leave the canvas, not a requirement.
    }

    const { x, y } = cellFromEvent(e);
    cursor = { x, y };
    cursorVisible = false;
    last = null;
    anchor = null;
    preview = null;

    // Right-click erases regardless of the active tool; Alt is the eyedropper
    // and reverts to the active tool afterwards (SPEC §5, DECISIONS.md #1).
    activeTool = e.button === 2 ? ERASER : e.altKey ? EYEDROPPER : getTool();

    if (activeTool === EYEDROPPER) {
      pickAt(x, y);
      return;
    }

    drawing = true;
    strokeColor = activeTool === ERASER ? null : getColor();

    if (activeTool === FILL) {
      onStrokeStart?.();
      write(floodFillCells(getDoc(), x, y, grid()), strokeColor);
      drawing = false;
      onStrokeEnd?.(strokeColor);
      return;
    }

    if (SHAPE_TOOLS.has(activeTool)) {
      anchor = { x, y };
      preview = { cells: [{ x, y }], color: strokeColor };
      render();
      return;
    }

    onStrokeStart?.();
    strokeTo(x, y);
  });

  canvas.addEventListener('pointermove', (e) => {
    const { x, y, inside } = cellFromEvent(e);
    onHover?.(inside || drawing ? { x, y } : null);
    if (!drawing) return;

    if (anchor) {
      preview = {
        cells: cellsForShape(activeTool, anchor.x, anchor.y, x, y, e.shiftKey),
        color: strokeColor,
      };
      render();
      return;
    }
    strokeTo(x, y);
  });

  function endStroke(e) {
    if (!drawing) {
      preview = null;
      return;
    }
    drawing = false;

    if (anchor && preview) {
      const cells = preview.cells;
      preview = null;
      anchor = null;
      onStrokeStart?.();
      write(cells, strokeColor);
      onStrokeEnd?.(strokeColor);
    } else {
      onStrokeEnd?.(strokeColor);
    }

    last = null;
    if (e && canvas.hasPointerCapture?.(e.pointerId)) {
      canvas.releasePointerCapture(e.pointerId);
    }
  }

  canvas.addEventListener('pointerup', endStroke);
  canvas.addEventListener('pointercancel', endStroke);
  canvas.addEventListener('pointerleave', () => {
    if (!drawing) onHover?.(null);
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  // Keyboard drawing. Bare arrows shift the whole canvas (handled in main.js),
  // so the caret moves on Shift+arrows — DECISIONS.md #2.
  canvas.addEventListener('keydown', (e) => {
    const delta = {
      ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
    }[e.key];

    if (delta && e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      cursorVisible = true;
      cursor = {
        x: Math.min(SIZE - 1, Math.max(0, cursor.x + delta[0])),
        y: Math.min(SIZE - 1, Math.max(0, cursor.y + delta[1])),
      };
      onHover?.({ ...cursor });
      render();
      return;
    }

    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      cursorVisible = true;
      const tool = getTool();
      onStrokeStart?.();
      if (tool === FILL) {
        write(floodFillCells(getDoc(), cursor.x, cursor.y, grid()), getColor());
      } else if (tool === EYEDROPPER) {
        pickAt(cursor.x, cursor.y);
      } else {
        write([{ ...cursor }], tool === ERASER ? null : getColor());
      }
      onStrokeEnd?.(tool === ERASER ? null : getColor());
      render();
    }
  });

  canvas.addEventListener('focus', () => {
    cursorVisible = true;
    render();
  });
  canvas.addEventListener('blur', () => {
    cursorVisible = false;
    render();
  });

  const ro = new ResizeObserver(() => {
    if (measure()) render();
  });
  ro.observe(frame);
  // DPR changes when the window moves to another monitor; ResizeObserver does
  // not fire for that, so watch the resolution media query too.
  let dprQuery;
  function watchDpr() {
    dprQuery?.removeEventListener('change', onDprChange);
    dprQuery = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    dprQuery.addEventListener('change', onDprChange);
  }
  function onDprChange() {
    watchDpr();
    if (measure()) render();
  }
  watchDpr();

  measure();
  render();

  return {
    render,
    setShowGrid(v) {
      showGrid = v;
      render();
    },
    destroy() {
      ro.disconnect();
      dprQuery?.removeEventListener('change', onDprChange);
    },
  };
}
