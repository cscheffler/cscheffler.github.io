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

export function createReference() {
  let bitmap = null;
  let state = { ...REFERENCE_DEFAULTS };

  return {
    async load(source) {
      const next = await createImageBitmap(source);
      bitmap?.close?.();
      bitmap = next;
      state = { ...REFERENCE_DEFAULTS };
      return true;
    },

    clear() {
      bitmap?.close?.();
      bitmap = null;
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
     * Draws into a square canvas of `span` device pixels. Scale 100 means the
     * image is contained in the grid, so a reference always starts visible and
     * whole however big the source is; position is in cells, so nudging moves
     * by something meaningful at this size.
     */
    draw(ctx, span) {
      if (!this.showing()) return false;

      const contain = Math.min(span / bitmap.width, span / bitmap.height);
      const factor = contain * (state.scale / 100);
      const w = bitmap.width * factor;
      const h = bitmap.height * factor;
      const cell = span / 16;

      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, state.opacity / 100));
      // A reference is a photograph or a sketch, not pixel art: it should be
      // resampled smoothly even though everything else on this canvas is not.
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(
        bitmap,
        (span - w) / 2 + state.x * cell,
        (span - h) / 2 + state.y * cell,
        w,
        h,
      );
      ctx.restore();
      return true;
    },
  };
}
