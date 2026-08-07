// localStorage gallery, and the JSON backup that makes localStorage acceptable
// as the only store — SPEC §4, §10.
//
// Everything read back from storage or from a backup file is treated as
// untrusted: it may have been written by an older version, hand-edited, or
// truncated by a full disk. sanitiseDoc() is the only way documents enter the
// app, and it never throws — a corrupt entry is dropped, not fatal.

import { PIXEL_COUNT, GRID_MODES, normaliseHex, createDoc } from './state.js';

export const SCHEMA_VERSION = 1;
const KEY = 'yotopix.gallery';
const SAVE_DELAY = 500;

/**
 * localStorage throws on access in some privacy modes rather than merely being
 * empty, so probing is the only reliable test.
 */
export function storageAvailable() {
  try {
    const probe = '__yotopix_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

export function isQuotaError(error) {
  return (
    error instanceof DOMException
    && (error.name === 'QuotaExceededError'
      || error.name === 'NS_ERROR_DOM_QUOTA_REACHED'
      || error.code === 22)
  );
}

function safeId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 64 ? value : null;
}

function safeTime(value) {
  return Number.isFinite(value) && value > 0 ? value : Date.now();
}

/**
 * Coerces one untrusted object into a valid document, or returns null if it is
 * too broken to use. Pixels that are not a recognisable colour become
 * transparent rather than invalidating the whole icon.
 */
export function sanitiseDoc(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (!Array.isArray(raw.pixels) || raw.pixels.length !== PIXEL_COUNT) return null;

  const pixels = raw.pixels.map((value) => (value === null ? null : normaliseHex(value)));

  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 64) : 'Untitled';
  const doc = createDoc(name);
  doc.id = safeId(raw.id) ?? doc.id;
  doc.pixels = pixels;
  doc.grid = GRID_MODES.includes(raw.grid) ? raw.grid : 'full';
  doc.createdAt = safeTime(raw.createdAt);
  doc.updatedAt = safeTime(raw.updatedAt);
  return doc;
}

function sanitiseIcons(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    const doc = sanitiseDoc(raw);
    if (!doc) continue;
    // Duplicate ids would make selection ambiguous; re-key the later one.
    if (seen.has(doc.id)) doc.id = createDoc().id;
    seen.add(doc.id);
    out.push(doc);
  }
  return out;
}

/**
 * Reads the gallery. Returns null when there is nothing stored at all, which
 * the caller uses to decide whether to seed the examples — distinct from an
 * empty gallery the user has deliberately emptied.
 */
export function load() {
  let text;
  try {
    text = localStorage.getItem(KEY);
  } catch {
    return null;
  }
  if (text === null) return null;

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Corrupt JSON: treat as empty rather than wiping it, so the user still has
    // the raw value in devtools if they want to recover it by hand.
    return { icons: [], lastOpenId: null, corrupt: true };
  }

  return {
    icons: sanitiseIcons(parsed?.icons),
    lastOpenId: safeId(parsed?.lastOpenId),
    corrupt: false,
  };
}

/** Writes the gallery. Throws on quota; the caller must surface that. */
export function save({ icons, lastOpenId }) {
  const payload = JSON.stringify({
    schemaVersion: SCHEMA_VERSION,
    lastOpenId: lastOpenId ?? null,
    icons,
  });
  localStorage.setItem(KEY, payload);
}

/**
 * Debounced saver — painting must not hammer storage (SPEC §4). `onError` is
 * called with the error and a hint; a failing save is reported once and then
 * suppressed until a later save succeeds, so a full disk cannot spam the user
 * on every stroke.
 */
export function createSaver({ onError, delay = SAVE_DELAY } = {}) {
  let timer = null;
  let reported = false;

  function flush(getState) {
    clearTimeout(timer);
    timer = null;
    try {
      save(getState());
      reported = false;
      return true;
    } catch (error) {
      if (!reported) {
        reported = true;
        onError?.(error);
      }
      return false;
    }
  }

  return {
    schedule(getState) {
      clearTimeout(timer);
      timer = setTimeout(() => flush(getState), delay);
    },
    /** Write immediately — used before destructive actions and on unload. */
    flush,
    cancel() {
      clearTimeout(timer);
      timer = null;
    },
  };
}

// ------------------------------------------------------------------ backup

export function backupFilename(date = new Date()) {
  const stamp = date.toISOString().slice(0, 10);
  return `yotopix-gallery-${stamp}.json`;
}

export function toBackupJSON(icons) {
  return JSON.stringify({ schemaVersion: SCHEMA_VERSION, icons }, null, 2);
}

/**
 * Parses a backup file. Throws an Error with a message worth showing the user;
 * returns the icons it could recover, plus how many entries it had to drop.
 */
export function parseBackup(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('That file is not valid JSON.');
  }
  const list = Array.isArray(parsed) ? parsed : parsed?.icons;
  if (!Array.isArray(list)) {
    throw new Error('That file does not look like a Yoto Icon Editor backup.');
  }
  const icons = sanitiseIcons(list);
  if (icons.length === 0) {
    throw new Error('That backup contains no usable icons.');
  }
  return { icons, skipped: list.length - icons.length };
}

export function downloadBackup(icons) {
  const blob = new Blob([toBackupJSON(icons)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = backupFilename();
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return a.download;
}
