// Reference tracing — SPEC §15.1.
//
// An image sits behind the grid to draw over. Three constraints from the spec
// shape all of this:
//
//   * It is never exported and never part of the pixel data. Nothing here ever
//     touches a document; the canvas draws it and that is all.
//   * It renders BEHIND the checkerboard, so a transparent cell still reads as
//     transparent rather than as "something is drawn here".
//   * It is session-only. Reference images are large next to 256 hex strings and
//     localStorage has no room for them; persisting one would be an IndexedDB
//     job, not a localStorage one. Closing the tab forgets it, on purpose.

export const REFERENCE_DEFAULTS = {
  opacity: 45,
  scale: 100,
  x: 0,
  y: 0,
  visible: true,
};

/**
 * Longest edge of the copy kept for colour sampling. We only ever need 256 cell
 * averages, and holding a 12-megapixel photo as ImageData would be ~48MB of
 * session state for no gain.
 */
const SAMPLE_MAX = 1024;
/** Virtual canvas span used to express the placement when sampling. */
const SAMPLE_SPAN = 1024;
/**
 * Side of the block averaged by a point pick, in sample-copy pixels. Not 1: a
 * single pixel of a photograph is JPEG noise as often as it is the colour you
 * were pointing at. At the sampling resolution one grid cell is 64 pixels
 * across, so 3 is about a pixel and a half on screen — still "that spot".
 */
const POINT_BOX = 3;

export function createReference() {
  let bitmap = null;
  let sample = null;   // ImageData of the downscaled copy
  let state = { ...REFERENCE_DEFAULTS };

  /**
   * Where the image sits on a square canvas of `span`. Shared by drawing and
   * sampling so the two can never disagree about what is under a cell.
   */
  /**
   * Alpha-weighted mean of a half-open rectangle of the sample copy, as
   * "#RRGGBB", or null if the rectangle is empty or fully transparent.
   *
   * Alpha-weighted for the same reason the importer is: a transparent pixel
   * carries RGB 0 and would drag the average toward black, ringing a cut-out
   * subject with dark edges.
   */
  function averageBox(x0, y0, x1, y1) {
    const left = Math.max(0, x0);
    const top = Math.max(0, y0);
    const right = Math.min(sample.width, x1);
    const bottom = Math.min(sample.height, y1);
    if (right <= left || bottom <= top) return null;

    let r = 0;
    let g = 0;
    let b = 0;
    let weight = 0;
    for (let y = top; y < bottom; y++) {
      for (let x = left; x < right; x++) {
        const i = (y * sample.width + x) * 4;
        const a = sample.data[i + 3];
        r += sample.data[i] * a;
        g += sample.data[i + 1] * a;
        b += sample.data[i + 2] * a;
        weight += a;
      }
    }
    if (weight === 0) return null;

    const hex = (v) => Math.round(v / weight).toString(16).padStart(2, '0');
    return `#${hex(r)}${hex(g)}${hex(b)}`.toUpperCase();
  }

  function placement(span) {
    const contain = Math.min(span / bitmap.width, span / bitmap.height);
    const factor = contain * (state.scale / 100);
    const w = bitmap.width * factor;
    const h = bitmap.height * factor;
    const cell = span / 16;
    return {
      x: (span - w) / 2 + state.x * cell,
      y: (span - h) / 2 + state.y * cell,
      w,
      h,
    };
  }

  return {
    async load(source) {
      const next = await createImageBitmap(source);
      bitmap?.close?.();
      bitmap = next;
      state = { ...REFERENCE_DEFAULTS };

      const shrink = Math.min(1, SAMPLE_MAX / Math.max(next.width, next.height));
      const sw = Math.max(1, Math.round(next.width * shrink));
      const sh = Math.max(1, Math.round(next.height * shrink));
      const surface = document.createElement('canvas');
      surface.width = sw;
      surface.height = sh;
      const ctx = surface.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(next, 0, 0, sw, sh);
      sample = ctx.getImageData(0, 0, sw, sh);
      return true;
    },

    clear() {
      bitmap?.close?.();
      bitmap = null;
      sample = null;
      state = { ...REFERENCE_DEFAULTS };
    },

    has: () => bitmap !== null,
    get: () => ({ ...state }),
    /** True when it is actually contributing something to the canvas. */
    showing: () => bitmap !== null && state.visible && state.opacity > 0,

    set(patch) {
      state = { ...state, ...patch };
      return { ...state };
    },

    toggle() {
      state.visible = !state.visible;
      return state.visible;
    },

    /**
     * The reference's own colour under one grid cell, as "#RRGGBB", or null if
     * that cell falls outside the image.
     *
     * Sampled from the source, NOT from what is on screen: the canvas shows the
     * reference blended with a translucent checkerboard and dimmed by the
     * opacity slider, so picking from there would mean the colour you get
     * changes when you dim the image, which is useless.
     *
     * Averaging the whole cell is what makes an anti-aliased edge usable: the
     * colour you get is the one that square's worth of picture actually
     * resolves to. When the cell straddles two colours and you want one of
     * them, that is what `samplePoint` is for.
     */
    sampleCell(cx, cy) {
      if (!bitmap || !sample || !state.visible) return null;

      const place = placement(SAMPLE_SPAN);
      const cell = SAMPLE_SPAN / 16;
      const toX = (v) => ((v - place.x) / place.w) * sample.width;
      const toY = (v) => ((v - place.y) / place.h) * sample.height;

      return averageBox(
        Math.floor(toX(cx * cell)),
        Math.floor(toY(cy * cell)),
        Math.ceil(toX((cx + 1) * cell)),
        Math.ceil(toY((cy + 1) * cell)),
      );
    },

    /**
     * The reference's colour at one spot, given in fractional grid coordinates
     * — (0,0) is the grid's top-left corner and (16,16) its bottom-right, so
     * (4.5, 2.25) is a quarter of the way down cell (4,2). Null if that spot
     * falls outside the image.
     *
     * The counterpart to `sampleCell`: this reads a patch far smaller than a
     * cell, for lifting one colour out of a square that straddles several.
     * Both are needed and neither is a better default — hence the choice in the
     * panel rather than one behaviour replacing the other.
     */
    samplePoint(u, v) {
      if (!bitmap || !sample || !state.visible) return null;

      const place = placement(SAMPLE_SPAN);
      const cell = SAMPLE_SPAN / 16;
      const x = ((u * cell - place.x) / place.w) * sample.width;
      const y = ((v * cell - place.y) / place.h) * sample.height;
      // Tested before the block is clamped, so a spot beyond the edge picks
      // nothing rather than smearing the nearest edge pixel inwards.
      if (!(x >= 0 && x < sample.width && y >= 0 && y < sample.height)) return null;

      const half = (POINT_BOX - 1) / 2;
      const cx = Math.floor(x);
      const cy = Math.floor(y);
      return averageBox(cx - half, cy - half, cx + half + 1, cy + half + 1);
    },

    /**
     * Draws into a square canvas of `span` device pixels. Scale 100 means the
     * image is contained in the grid, so a reference always starts visible and
     * whole however big the source is; position is in cells, so nudging moves
     * by something meaningful at this size.
     */
    draw(ctx, span) {
      if (!this.showing()) return false;

      const { x, y, w, h } = placement(span);

      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, state.opacity / 100));
      // A reference is a photograph or a sketch, not pixel art: it should be
      // resampled smoothly even though everything else on this canvas is not.
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(bitmap, x, y, w, h);
      ctx.restore();
      return true;
    },
  };
}
