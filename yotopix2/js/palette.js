/**
 * Palette groups deliberately leave room for future shading ramps. All saved
 * swatch colours use the Yoto Mini-safe 18-level RGB lattice (0…255 by 15).
 */
export const MINI_CHANNEL_STEP = 15;
export const MINI_CHANNEL_MAX = 255;
export const CUSTOM_SLOT_COUNT = 8;
export const RECENT_COLOR_LIMIT = 8;

export const DEFAULT_PALETTE = Object.freeze([
  ["#FFF0E1"], ["#FFD269"], ["#FFB44B"], ["#FF873C"], ["#E15A3C"], ["#D23C5A"],
  ["#B44B96"], ["#785AC3"], ["#4B78C3"], ["#4BA5E1"], ["#4BC3C3"], ["#5AC378"],
  ["#2DA55A"], ["#0F784B"], ["#96D25A"], ["#69963C"], ["#B4783C"], ["#875A2D"],
  ["#5A3C2D"], ["#FFE1C3"], ["#F0B487"], ["#C3875A"], ["#965A3C"], ["#693C2D"],
  ["#000000"], ["#0F0F0F"], ["#1E1E1E"], ["#2D2D2D"], ["#3C3C3C"], ["#787878"],
  ["#F0F0F0"], ["#FFFFFF"],
].map((colors) => Object.freeze({ colors: Object.freeze(colors) })));

export const SWATCH_METADATA = Object.freeze({
  "#000000": Object.freeze({ tooltip: "Pure black will not light up on the Yoto display." }),
  "#0F0F0F": Object.freeze({ tooltip: "Very dark grey — it may read as off on the Yoto display." }),
  "#1E1E1E": Object.freeze({ tooltip: "Very dark grey — it may read as off on the Yoto display." }),
});

export function paletteColors(groups = DEFAULT_PALETTE) {
  if (!Array.isArray(groups)) throw new TypeError("Palette groups must be an array.");
  return groups.flatMap((group) => {
    if (!group || !Array.isArray(group.colors)) throw new TypeError("Each palette group must contain a colors array.");
    return group.colors.map(normalizePaletteColor);
  });
}

export function swatchMetadata(color) {
  return SWATCH_METADATA[normalizeHexColor(color)] ?? {};
}

/** Whether a colour already lies on the Mini-safe 18-level RGB lattice. */
export function isMiniSafeColor(color) {
  const { red, green, blue } = colorChannels(color);
  return [red, green, blue].every((channel) => channel <= MINI_CHANNEL_MAX && channel % MINI_CHANNEL_STEP === 0);
}

/** Snap a single byte to the nearest allowed Mini-safe channel; midpoint ties go up. */
export function snapMiniChannel(channel) {
  if (!Number.isFinite(channel) || channel < 0 || channel > 255) {
    throw new TypeError("A colour channel must be a number from 0 to 255.");
  }
  return Math.min(MINI_CHANNEL_MAX, Math.floor((channel + (MINI_CHANNEL_STEP / 2)) / MINI_CHANNEL_STEP) * MINI_CHANNEL_STEP);
}

/** Snap any valid #RRGGBB colour to the Mini-safe lattice. */
export function snapColorToMiniSafe(color) {
  const { red, green, blue } = colorChannels(color);
  return `#${channelHex(snapMiniChannel(red))}${channelHex(snapMiniChannel(green))}${channelHex(snapMiniChannel(blue))}`;
}

/** Validate/snap custom slots into exactly eight Mini-safe colours or nulls. */
export function normalizeCustomSlots(slots = null) {
  if (slots === null || slots === undefined) return Array(CUSTOM_SLOT_COUNT).fill(null);
  if (!Array.isArray(slots) || slots.length !== CUSTOM_SLOT_COUNT) {
    throw new TypeError(`Custom slots must contain exactly ${CUSTOM_SLOT_COUNT} entries.`);
  }
  return slots.map((color) => color === null ? null : snapColorToMiniSafe(color));
}

/** Assign one custom slot without mutating the caller's array. */
export function assignCustomSlot(slots, slotIndex, color) {
  if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= CUSTOM_SLOT_COUNT) {
    throw new RangeError(`Custom slot index must be from 0 to ${CUSTOM_SLOT_COUNT - 1}.`);
  }
  const next = normalizeCustomSlots(slots);
  next[slotIndex] = color === null ? null : snapColorToMiniSafe(color);
  return next;
}

/** Normalise a persisted recent-colour row to distinct, newest-first, max eight values. */
export function normalizeRecentColors(colors = []) {
  if (!Array.isArray(colors)) throw new TypeError("Recent colours must be an array.");
  const unique = [];
  for (const color of colors) {
    const snapped = snapColorToMiniSafe(color);
    if (!unique.includes(snapped)) unique.push(snapped);
    if (unique.length === RECENT_COLOR_LIMIT) break;
  }
  return unique;
}

/** Put a used colour first in the last-eight distinct recent-colour list. */
export function recordRecentColor(colors, color) {
  const snapped = snapColorToMiniSafe(color);
  return normalizeRecentColors([snapped, ...normalizeRecentColors(colors)]);
}

/** Convert the eight custom slots to palette groups without flattening their model. */
export function customSlotGroups(slots) {
  return normalizeCustomSlots(slots).map((color) => Object.freeze({ colors: Object.freeze(color === null ? [] : [color]) }));
}

/** Restore eight custom slots from their persisted palette-group shape. */
export function customSlotsFromGroups(groups = []) {
  if (!Array.isArray(groups)) throw new TypeError("Custom palette groups must be an array.");
  if (groups.length === 0) return normalizeCustomSlots();
  if (groups.length !== CUSTOM_SLOT_COUNT) {
    throw new TypeError(`Custom palette groups must contain exactly ${CUSTOM_SLOT_COUNT} entries.`);
  }
  return normalizeCustomSlots(groups.map((group) => {
    if (!group || !Array.isArray(group.colors) || group.colors.length > 1) {
      throw new TypeError("Each custom palette group must contain zero or one colour.");
    }
    return group.colors[0] ?? null;
  }));
}

function normalizePaletteColor(color) {
  const normalized = normalizeHexColor(color);
  if (!isMiniSafeColor(normalized)) throw new TypeError(`Palette colour is not Mini-safe: ${normalized}`);
  return normalized;
}

function normalizeHexColor(color) {
  if (typeof color !== "string") throw new TypeError("A colour must be a #RRGGBB string.");
  const normalized = color.trim().toUpperCase();
  if (!/^#[0-9A-F]{6}$/.test(normalized)) throw new TypeError(`Invalid colour: ${color}`);
  return normalized;
}

function colorChannels(color) {
  const normalized = normalizeHexColor(color);
  return {
    red: Number.parseInt(normalized.slice(1, 3), 16),
    green: Number.parseInt(normalized.slice(3, 5), 16),
    blue: Number.parseInt(normalized.slice(5, 7), 16),
  };
}

function channelHex(channel) {
  return channel.toString(16).padStart(2, "0").toUpperCase();
}
