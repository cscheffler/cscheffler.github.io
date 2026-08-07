// Palette model + UI.
//
// SPEC §5: the palette is an array of GROUPS, not a flat array of swatches,
// even though v1 only ever creates single-swatch groups. Shading ramps (§15.1)
// are groups of related colours and are the top v2 priority; getting this shape
// right now avoids a storage migration later. Do not flatten this.

import { normaliseHex, luminance } from './state.js';

/**
 * Curated for an emissive LED matrix: saturated, mid-to-high luminance, nothing
 * that dies on the panel. Weighted toward skin tones and foliage greens/browns,
 * because animals and plants dominate this use case.
 *
 * There is no pure black, by design (SPEC §1). #1A1A1A is included as the one
 * deliberate "off" colour and carries a warning in its tooltip.
 */
export const DEFAULT_PALETTE = [
  { id: 'red', name: 'Red', swatches: ['#FF4747'] },
  { id: 'coral', name: 'Coral', swatches: ['#FF7A5C'] },
  { id: 'orange', name: 'Orange', swatches: ['#FF9528'] },
  { id: 'amber', name: 'Amber', swatches: ['#FFC13B'] },
  { id: 'yellow', name: 'Yellow', swatches: ['#FFE44D'] },
  { id: 'lime', name: 'Lime', swatches: ['#C6E44A'] },
  { id: 'leaf', name: 'Leaf green', swatches: ['#7DC63F'] },
  { id: 'grass', name: 'Grass green', swatches: ['#4CAF50'] },
  { id: 'forest', name: 'Forest green', swatches: ['#2E8B57'] },
  { id: 'teal', name: 'Teal', swatches: ['#2FBFA0'] },
  { id: 'cyan', name: 'Cyan', swatches: ['#45D3E0'] },
  { id: 'sky', name: 'Sky blue', swatches: ['#4FA8FF'] },
  { id: 'blue', name: 'Blue', swatches: ['#3D6FE0'] },
  { id: 'violet', name: 'Violet', swatches: ['#7A5CE0'] },
  { id: 'purple', name: 'Purple', swatches: ['#A855D6'] },
  { id: 'magenta', name: 'Magenta', swatches: ['#E255A8'] },
  { id: 'pink', name: 'Pink', swatches: ['#FF8FB8'] },
  { id: 'skin-1', name: 'Skin, palest', swatches: ['#FFD9B8'] },
  { id: 'skin-2', name: 'Skin, light', swatches: ['#F0BC90'] },
  { id: 'skin-3', name: 'Skin, medium', swatches: ['#D99A6C'] },
  { id: 'skin-4', name: 'Skin, tan', swatches: ['#B57446'] },
  { id: 'skin-5', name: 'Skin, deep', swatches: ['#8C5230'] },
  { id: 'skin-6', name: 'Skin, deepest', swatches: ['#5E3418'] },
  { id: 'wood', name: 'Wood', swatches: ['#A9743F'] },
  { id: 'bark', name: 'Bark', swatches: ['#6B4423'] },
  { id: 'olive', name: 'Olive', swatches: ['#8A8F3C'] },
  { id: 'white', name: 'White', swatches: ['#FFFFFF'] },
  { id: 'bone', name: 'Bone', swatches: ['#E8E4DC'] },
  { id: 'grey-light', name: 'Light grey', swatches: ['#C8C8C8'] },
  { id: 'grey-mid', name: 'Mid grey', swatches: ['#8A8A8A'] },
  { id: 'grey-dark', name: 'Dark grey', swatches: ['#5A5A5A'] },
  { id: 'grey-off', name: 'Near black', swatches: ['#1A1A1A'] },
];

/** Flat list of swatch hexes, in palette order. */
export function allSwatches(palette = DEFAULT_PALETTE) {
  return palette.flatMap((group) => group.swatches);
}

function labelFor(palette, hex) {
  const group = palette.find((g) => g.swatches.includes(hex));
  const name = group ? group.name : hex;
  // The one swatch that needs an explanation rather than a name.
  if (luminance(hex) < 0.02) {
    return `${name} ${hex} — too dark to light up; it will read as off on the display`;
  }
  return `${name} ${hex}`;
}

/**
 * Renders the palette into `container` and calls `onPick(hex)` on selection.
 * Returns { setActive(hex) } so the caller can keep the selection ring in sync
 * when the colour changes from somewhere else (hex field, eyedropper later).
 */
export function createPalette({ container, palette = DEFAULT_PALETTE, onPick }) {
  const buttons = new Map();
  container.replaceChildren();

  for (const group of palette) {
    for (const hex of group.swatches) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'swatch';
      button.style.background = hex;
      button.dataset.hex = hex;
      button.setAttribute('role', 'option');
      button.setAttribute('aria-selected', 'false');
      button.title = labelFor(palette, hex);
      button.setAttribute('aria-label', button.title);
      button.addEventListener('click', () => onPick(hex));
      container.append(button);
      buttons.set(hex, button);
    }
  }

  return {
    setActive(hex) {
      const target = normaliseHex(hex);
      for (const [swatch, button] of buttons) {
        button.setAttribute('aria-selected', swatch === target ? 'true' : 'false');
      }
    },
  };
}
