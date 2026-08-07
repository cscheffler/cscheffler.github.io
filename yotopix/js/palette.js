// Palette model + UI: the curated defaults, 8 custom slots, and recently used.
//
// SPEC §5: the palette is an array of GROUPS, not a flat array of swatches,
// even though v1 only ever creates single-swatch groups. Shading ramps (§15.1)
// are groups of related colours and are the top v2 priority; getting this shape
// right now avoids a storage migration later. Do not flatten this.
//
// Every colour here sits on the display's 15-step channel grid (see
// state.js). The values below were quantised from the original hand-picked
// palette; `bone` was re-chosen by hand because snapping flattened its warmth
// into a neutral grey that duplicated the light grey swatch.

import { normaliseHex, quantiseHex, luminance, isPureBlack } from './state.js';

export const SLOT_COUNT = 8;
export const RECENT_COUNT = 8;

/**
 * Curated for an emissive LED matrix: saturated, mid-to-high luminance, nothing
 * that dies on the panel. Weighted toward skin tones and foliage greens/browns,
 * because animals and plants dominate this use case.
 *
 * Pure black IS included (SPEC §1): enclosed by lit pixels it reads as a
 * deliberate hole, which is the only way to draw an eye or a gap on an emissive
 * panel. Its tooltip says when that stops being true. #1E1E1E sits alongside it
 * for a pixel that is nearly off rather than off.
 */
export const DEFAULT_PALETTE = [
  { id: 'red', name: 'Red', swatches: ['#FF4B4B'] },
  { id: 'coral', name: 'Coral', swatches: ['#FF785A'] },
  { id: 'orange', name: 'Orange', swatches: ['#FF962D'] },
  { id: 'amber', name: 'Amber', swatches: ['#FFC33C'] },
  { id: 'yellow', name: 'Yellow', swatches: ['#FFE14B'] },
  { id: 'lime', name: 'Lime', swatches: ['#C3E14B'] },
  { id: 'leaf', name: 'Leaf green', swatches: ['#78C33C'] },
  { id: 'grass', name: 'Grass green', swatches: ['#4BB44B'] },
  { id: 'forest', name: 'Forest green', swatches: ['#2D875A'] },
  { id: 'teal', name: 'Teal', swatches: ['#2DC3A5'] },
  { id: 'cyan', name: 'Cyan', swatches: ['#4BD2E1'] },
  { id: 'sky', name: 'Sky blue', swatches: ['#4BA5FF'] },
  { id: 'blue', name: 'Blue', swatches: ['#3C69E1'] },
  { id: 'violet', name: 'Violet', swatches: ['#785AE1'] },
  { id: 'purple', name: 'Purple', swatches: ['#A55AD2'] },
  { id: 'magenta', name: 'Magenta', swatches: ['#E15AA5'] },
  { id: 'pink', name: 'Pink', swatches: ['#FF96B4'] },
  { id: 'skin-1', name: 'Skin, palest', swatches: ['#FFD2B4'] },
  { id: 'skin-2', name: 'Skin, light', swatches: ['#F0C396'] },
  { id: 'skin-3', name: 'Skin, medium', swatches: ['#D29669'] },
  { id: 'skin-4', name: 'Skin, tan', swatches: ['#B4784B'] },
  { id: 'skin-5', name: 'Skin, deep', swatches: ['#874B2D'] },
  { id: 'skin-6', name: 'Skin, deepest', swatches: ['#5A2D1E'] },
  { id: 'wood', name: 'Wood', swatches: ['#A5783C'] },
  { id: 'bark', name: 'Bark', swatches: ['#694B1E'] },
  { id: 'olive', name: 'Olive', swatches: ['#87963C'] },
  { id: 'white', name: 'White', swatches: ['#FFFFFF'] },
  { id: 'cream', name: 'Cream', swatches: ['#F0E1C3'] },
  { id: 'grey-light', name: 'Light grey', swatches: ['#C3C3C3'] },
  { id: 'grey-mid', name: 'Mid grey', swatches: ['#878787'] },
  { id: 'grey-dark', name: 'Dark grey', swatches: ['#5A5A5A'] },
  { id: 'grey-off', name: 'Near black', swatches: ['#1E1E1E'] },
  { id: 'black', name: 'Black', swatches: ['#000000'] },
];

export function allSwatches(palette = DEFAULT_PALETTE) {
  return palette.flatMap((group) => group.swatches);
}

function labelFor(hex, palette = DEFAULT_PALETTE) {
  const group = palette.find((g) => g.swatches.includes(hex));
  const name = group ? group.name : hex;

  // Black is an unlit pixel, exactly like a transparent one — but what it reads
  // as depends on what surrounds it (SPEC §1). Enclosed by lit pixels it is a
  // deliberate hole; touching the outside it silently eats the silhouette.
  if (isPureBlack(hex)) {
    return `${name} ${hex} — unlit. Enclosed by lit pixels it reads as a hole; touching the outside it reads as transparent`;
  }
  // Matches the lint threshold agreed in DECISIONS.md #4.
  if (luminance(hex) < 0.02) {
    return `${name} ${hex} — barely lit; it will read as very nearly off on the display`;
  }
  return group ? `${name} ${hex}` : hex;
}

function swatchButton(hex, { label, empty = false } = {}) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = empty ? 'swatch swatch-empty' : 'swatch';
  if (!empty) button.style.background = hex;
  if (hex) button.dataset.hex = hex;
  button.setAttribute('role', 'option');
  button.setAttribute('aria-selected', 'false');
  button.tabIndex = -1;
  button.title = label;
  button.setAttribute('aria-label', label);
  return button;
}

/**
 * Keyboard support for a swatch list. SPEC §11 asks that everything be
 * reachable by keyboard; a listbox is meant to be ONE tab stop with arrow-key
 * navigation inside it, not 32 consecutive tab stops. Movement is linear rather
 * than grid-shaped because the grid reflows with the rail width, so there is no
 * stable column count to step by.
 */
function wireRovingList(container, { onClear } = {}) {
  container.addEventListener('keydown', (event) => {
    const items = [...container.querySelectorAll('.swatch')];
    const index = items.indexOf(document.activeElement);
    if (index === -1) return;

    if (onClear && (event.key === 'Delete' || event.key === 'Backspace')) {
      event.preventDefault();
      onClear(index);
      return;
    }

    let next;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        next = items[(index + 1) % items.length];
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        next = items[(index - 1 + items.length) % items.length];
        break;
      case 'Home':
        [next] = items;
        break;
      case 'End':
        next = items.at(-1);
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
    for (const item of items) item.tabIndex = item === next ? 0 : -1;
    next.focus();
  });
}

/** Keeps exactly one item tabbable — the selected one, else the first. */
function updateSelection(container, activeHex) {
  const items = [...container.querySelectorAll('.swatch')];
  let selectedIndex = -1;
  items.forEach((item, i) => {
    const match = item.dataset.hex === activeHex;
    item.setAttribute('aria-selected', match ? 'true' : 'false');
    if (match && selectedIndex === -1) selectedIndex = i;
  });
  const tabbable = selectedIndex === -1 ? 0 : selectedIndex;
  items.forEach((item, i) => {
    item.tabIndex = i === tabbable ? 0 : -1;
  });
}

// ------------------------------------------------------------ default grid

export function createPalette({ container, palette = DEFAULT_PALETTE, onPick }) {
  container.replaceChildren();
  for (const group of palette) {
    for (const hex of group.swatches) {
      const button = swatchButton(hex, { label: labelFor(hex, palette) });
      button.addEventListener('click', () => onPick(hex));
      container.append(button);
    }
  }
  wireRovingList(container);
  return {
    setActive(hex) {
      updateSelection(container, normaliseHex(hex));
    },
  };
}

// ----------------------------------------------------------- custom slots

/**
 * Eight assignable slots (SPEC §5), persisted with the gallery. An empty slot
 * stores the active colour when clicked; a filled slot selects its colour.
 * Delete or Backspace on a focused slot clears it, and right-click does the
 * same for mouse users — both are spelled out in the tooltip, because a
 * hover-only affordance on a 24px square would be neither discoverable nor
 * reachable by keyboard.
 */
export function createSlots({ container, onPick, onAssign, onClear }) {
  let slots = new Array(SLOT_COUNT).fill(null);

  function render(activeHex = null) {
    container.replaceChildren();
    slots.forEach((hex, i) => {
      const filled = hex !== null;
      const label = filled
        ? `Slot ${i + 1}: ${labelFor(hex)} — click to use, Delete or right-click to clear`
        : `Slot ${i + 1}: empty — click to store the active colour`;
      const button = swatchButton(hex, { label, empty: !filled });
      button.dataset.slot = String(i);
      button.addEventListener('click', () => (filled ? onPick(hex) : onAssign(i)));
      button.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        if (filled) onClear(i);
      });
      container.append(button);
    });
    updateSelection(container, activeHex);
  }

  wireRovingList(container, { onClear });

  return {
    render,
    set(next, activeHex) {
      slots = next;
      render(activeHex);
    },
    get: () => slots.slice(),
    setActive(hex) {
      updateSelection(container, normaliseHex(hex));
    },
  };
}

// ---------------------------------------------------------------- recents

/** The last RECENT_COUNT distinct colours actually painted with — SPEC §5. */
export function pushRecent(list, hex) {
  const colour = quantiseHex(hex);
  if (!colour) return list;
  return [colour, ...list.filter((c) => c !== colour)].slice(0, RECENT_COUNT);
}

export function createRecents({ container, onPick }) {
  function render(list, activeHex = null) {
    container.replaceChildren();
    if (list.length === 0) {
      const empty = document.createElement('span');
      empty.className = 'swatch-row-empty';
      empty.textContent = 'Nothing yet';
      container.append(empty);
      return;
    }
    for (const hex of list) {
      const button = swatchButton(hex, { label: labelFor(hex) });
      button.addEventListener('click', () => onPick(hex));
      container.append(button);
    }
    updateSelection(container, activeHex);
  }
  wireRovingList(container);
  return { render };
}
