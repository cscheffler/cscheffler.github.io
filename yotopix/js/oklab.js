// OKLab / OKLCh conversions, and gamut mapping back to sRGB.
//
// Promoted out of importer.js, which had the forward transform only: ramps
// (SPEC §15.1) need the inverse as well, and §15.2's "apply this palette to a
// set" will want both. OKLab is near-uniform perceptually, so equal steps in it
// look like equal steps — which is the whole reason the spec insists on it
// rather than RGB or HSL.
//
// Hue is in degrees. Reference hues, useful when reading the ramp code:
// red ~29, yellow ~110, green ~142, cyan ~195, blue ~264, magenta ~328.

const clamp01 = (v) => Math.max(0, Math.min(1, v));

function srgbToLinear(c) {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(v) {
  const c = v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
  return c * 255;
}

export function srgbToOklab(r, g, b) {
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);

  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);

  return {
    L: 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  };
}

/** Returns floating-point RGB in 0..255, which may fall outside the gamut. */
export function oklabToSrgbRaw({ L, a, b }) {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  return {
    r: linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s),
  };
}

// ------------------------------------------------------------------- OKLCh

export function oklabToOklch({ L, a, b }) {
  return {
    L,
    C: Math.sqrt(a * a + b * b),
    // Normalised to [0, 360): atan2 returns negative angles for half the wheel,
    // which makes hues awkward to compare and to read in a debug dump.
    h: (((Math.atan2(b, a) * 180) / Math.PI) + 360) % 360,
  };
}

export function oklchToOklab({ L, C, h }) {
  const rad = (h * Math.PI) / 180;
  return { L, a: C * Math.cos(rad), b: C * Math.sin(rad) };
}

export function hexToOklch(hex) {
  const n = parseInt(hex.slice(1), 16);
  return oklabToOklch(srgbToOklab((n >> 16) & 255, (n >> 8) & 255, n & 255));
}

const TOLERANCE = 0.6; // in 0..255 terms, i.e. under a quarter of a grid step

function inGamut({ r, g, b }) {
  return [r, g, b].every((v) => v >= -TOLERANCE && v <= 255 + TOLERANCE);
}

/**
 * OKLCh to a hex string, reducing chroma until the colour fits in sRGB.
 *
 * Naively clipping each channel shifts hue — a too-saturated blue clips to a
 * different blue. Walking chroma down keeps hue and lightness, which is what a
 * ramp needs: the steps must stay on the same hue line to read as one material.
 */
export function oklchToHex({ L, C, h }) {
  let chroma = Math.max(0, C);
  let rgb = oklabToSrgbRaw(oklchToOklab({ L, C: chroma, h }));

  if (!inGamut(rgb)) {
    let lo = 0;
    let hi = chroma;
    // 18 halvings resolves chroma far finer than the display can show.
    for (let i = 0; i < 18; i++) {
      const mid = (lo + hi) / 2;
      const candidate = oklabToSrgbRaw(oklchToOklab({ L, C: mid, h }));
      if (inGamut(candidate)) {
        lo = mid;
        rgb = candidate;
      } else {
        hi = mid;
      }
    }
  }

  const part = (v) => Math.round(clamp01(v / 255) * 255).toString(16).padStart(2, '0');
  return `#${part(rgb.r)}${part(rgb.g)}${part(rgb.b)}`.toUpperCase();
}

/**
 * Rotates `from` toward `target` by at most `amount` degrees, along the shorter
 * arc. Used so "warmer" means the same thing whatever hue you start on.
 */
export function rotateToward(from, target, amount) {
  let delta = ((target - from + 540) % 360) - 180;
  if (Math.abs(delta) > amount) delta = Math.sign(delta) * amount;
  return (from + delta + 360) % 360;
}
