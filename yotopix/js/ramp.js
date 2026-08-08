// Shading ramps — SPEC §15.1.
//
// A ramp is 3-5 related colours running dark to light, generated in OKLCh so
// the steps look evenly spaced rather than merely measuring so. Three things
// separate this from a naive lightness ramp, and the spec is emphatic that the
// naive kind is the most recognisable mark of amateur pixel art:
//
//   1. Lightness follows a slight S-curve, not a straight line.
//   2. Hue shifts as it goes — warmer toward the highlights, cooler toward the
//      shadows — rotating toward a fixed warm or cool target, so "warmer" means
//      the same thing whatever hue you start from.
//   3. Chroma arcs up through the mid-steps and drops at both ends.
//
// Every step is then snapped to the display's 15-step channel grid, which is
// coarse enough that two steps can land on the same colour; generateRamp()
// widens the offending step until the run is distinct.

import { quantiseHex } from './state.js';
import { hexToOklch, oklchToHex, rotateToward, srgbToOklab } from './oklab.js';

/** Yellow-orange and blue in OKLCh — the ends artists shift toward. */
export const WARM_HUE = 90;
export const COOL_HUE = 264;

export const MIN_STEPS = 3;
export const MAX_STEPS = 5;

export const RAMP_DEFAULTS = {
  steps: 5,
  /** Degrees per step. SPEC §15.1 calls for roughly 8-14. */
  hueShift: 11,
  direction: 'warm-light',
};

/** How much of the S-curve to mix in. 1 would be a full smoothstep. */
const CURVE = 0.55;
/**
 * How far the ramp reaches above and below the base, in OKLab lightness.
 * Chosen by rendering candidates side by side: a wider span (0.30/0.32) pushes
 * the end steps to near-neutral — a red ramp ending on #FFF0E1 — which throws
 * away the material identity the ramp exists to hold. At this span every step
 * still reads as the same colour while staying clearly distinguishable.
 */
const LIFT = 0.21;
const DROP = 0.23;
/** Floor for bases near white or black, which would otherwise have no room. */
const MIN_SPAN = 0.34;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function lightnessSpan(L0) {
  let hi = Math.min(0.96, L0 + LIFT);
  let lo = Math.max(0.10, L0 - DROP);
  // A base near white or black would otherwise collapse the ramp to nothing;
  // take the missing range from whichever end still has room.
  if (hi - lo < MIN_SPAN) {
    const shortfall = MIN_SPAN - (hi - lo);
    const roomBelow = lo - 0.10;
    const roomAbove = 0.96 - hi;
    const takeBelow = Math.min(shortfall, roomBelow);
    lo -= takeBelow;
    hi += Math.min(shortfall - takeBelow, roomAbove);
  }
  return { lo, hi };
}

function stepColour({ lo, hi }, base, options, i, steps, extraLift = 0) {
  const t = steps === 1 ? 0.5 : i / (steps - 1);
  const eased = t * t * (3 - 2 * t);
  const curved = t + (eased - t) * CURVE;

  const L = clamp(lo + (hi - lo) * curved + extraLift, 0.02, 0.995);

  // Offset from the middle step: negative is shadow, positive is highlight.
  const centre = (steps - 1) / 2;
  const k = i - centre;
  const warm = options.direction === 'cool-light' ? COOL_HUE : WARM_HUE;
  const cool = options.direction === 'cool-light' ? WARM_HUE : COOL_HUE;
  const h = k === 0
    ? base.h
    : rotateToward(base.h, k > 0 ? warm : cool, Math.abs(k) * options.hueShift);

  // Up through the middle, down at both ends.
  const C = base.C * (0.78 + 0.34 * Math.sin(Math.PI * t));

  return quantiseHex(oklchToHex({ L, C, h }));
}

/**
 * Builds a ramp from a base colour. The base sits in the middle of the run, so
 * a 5-step ramp gives two shadows and two highlights.
 */
export function generateRamp(baseHex, options = {}) {
  const settings = { ...RAMP_DEFAULTS, ...options };
  const steps = clamp(Math.round(settings.steps), MIN_STEPS, MAX_STEPS);
  const base = hexToOklch(quantiseHex(baseHex) ?? '#878787');
  const span = lightnessSpan(base.L);

  const swatches = [];
  for (let i = 0; i < steps; i++) {
    let colour = stepColour(span, base, settings, i, steps);
    // The 15-step grid is coarse enough that neighbouring steps can quantise
    // onto the same colour. Push this one lighter until it separates.
    let extra = 0;
    while (i > 0 && colour === swatches[i - 1] && extra < 0.16) {
      extra += 0.012;
      colour = stepColour(span, base, settings, i, steps, extra);
    }
    swatches.push(colour);
  }

  return {
    swatches,
    base: quantiseHex(baseHex),
    steps,
    hueShift: settings.hueShift,
    direction: settings.direction,
  };
}

function uuid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `ramp-${Math.random().toString(36).slice(2, 10)}`;
}

/** A ramp is a palette group with generator settings attached — SPEC §5, §15.1. */
export function createRamp(baseHex, options = {}, name = null) {
  const generated = generateRamp(baseHex, options);
  return {
    id: uuid(),
    name: name || `Ramp ${generated.base}`,
    ...generated,
  };
}

// ------------------------------------------------------------- ramp lookup

/** The ramp containing this exact colour, and where in it — SPEC §15.1. */
export function findRampFor(ramps, hex) {
  for (const ramp of ramps) {
    const index = ramp.swatches.indexOf(hex);
    if (index !== -1) return { ramp, index };
  }
  return null;
}

function distance(a, b) {
  const dL = a.L - b.L;
  const da = a.a - b.a;
  const db = a.b - b.b;
  return dL * dL + da * da + db * db;
}

function labOf(hex) {
  const n = parseInt(hex.slice(1), 16);
  return srgbToOklab((n >> 16) & 255, (n >> 8) & 255, n & 255);
}

/** Perceptually closest step, so shading can start from a flat colour. */
export function nearestStep(ramp, hex) {
  const target = labOf(hex);
  let best = 0;
  let bestDistance = Infinity;
  ramp.swatches.forEach((swatch, i) => {
    const d = distance(target, labOf(swatch));
    if (d < bestDistance) {
      bestDistance = d;
      best = i;
    }
  });
  return best;
}

/**
 * One step lighter or darker within a ramp — the shading tool's whole job.
 *
 * A colour that is not in the ramp enters it at its nearest step first, so the
 * tool works on flat artwork rather than only on pixels it painted itself.
 * Returns null when there is nowhere to go, so the caller can leave the pixel
 * alone rather than writing the same value back.
 */
export function shadeStep(ramp, hex, delta) {
  if (!ramp || !ramp.swatches.length || hex === null) return null;
  const exact = ramp.swatches.indexOf(hex);
  const from = exact === -1 ? nearestStep(ramp, hex) : exact;
  const to = clamp(from + delta, 0, ramp.swatches.length - 1);
  // Entering the ramp is a real change even when the index does not move.
  if (to === from && exact !== -1) return null;
  const next = ramp.swatches[to];
  return next === hex ? null : next;
}
