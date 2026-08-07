/**
 * Versioned, fail-loud local gallery persistence.
 *
 * The UI owns the in-memory model. This module never mutates it and never
 * treats a failed write as success, so callers can keep editing and offer a
 * backup download when browser storage is unavailable or full.
 */
import { createPixels, normalizeGrid } from "./state.js";
import {
  CUSTOM_SLOT_COUNT,
  customSlotGroups,
  customSlotsFromGroups,
  normalizeRecentColors,
  snapColorToMiniSafe,
} from "./palette.js";

export const STORAGE_KEY = "yoto-icon-editor.gallery";
export const SCHEMA_VERSION = 1;

export class GalleryStorageError extends Error {
  constructor(code, message, { cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "GalleryStorageError";
    this.code = code;
  }
}

export function createEmptyEnvelope() {
  return {
    schemaVersion: SCHEMA_VERSION,
    documents: [],
    palette: customSlotGroups(),
    lastOpenId: null,
    preferences: {},
  };
}

/** Strictly validate and clone one persisted document. */
export function normalizeDocument(value) {
  if (!isPlainObject(value)) throw validationError("A document must be an object.");
  if (typeof value.id !== "string" || value.id.trim() === "") {
    throw validationError("A document id must be a non-empty string.");
  }
  if (typeof value.name !== "string") throw validationError("A document name must be a string.");
  if (!isTimestamp(value.createdAt) || !isTimestamp(value.updatedAt)) {
    throw validationError("Document timestamps must be finite non-negative numbers.");
  }
  if (value.updatedAt < value.createdAt) {
    throw validationError("A document updatedAt value cannot precede createdAt.");
  }

  let pixels;
  let grid;
  try {
    pixels = createPixels(value.pixels);
    grid = normalizeGrid(value.grid);
  } catch (error) {
    throw validationError(error.message, error);
  }
  return {
    id: value.id,
    name: value.name,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    pixels,
    grid,
  };
}

/** Strictly validate and clone the version-one persistence envelope. */
export function normalizeEnvelope(value) {
  if (!isPlainObject(value)) throw validationError("Gallery data must be an object.");
  if (value.schemaVersion !== SCHEMA_VERSION) {
    throw validationError(`Unsupported gallery schema version: ${String(value.schemaVersion)}.`);
  }
  if (!Array.isArray(value.documents)) throw validationError("Gallery documents must be an array.");
  const documents = value.documents.map(normalizeDocument);
  const ids = new Set();
  for (const documentModel of documents) {
    if (ids.has(documentModel.id)) throw validationError("Gallery document ids must be unique.");
    ids.add(documentModel.id);
  }
  if (value.lastOpenId !== null && (typeof value.lastOpenId !== "string" || !ids.has(value.lastOpenId))) {
    throw validationError("lastOpenId must be null or identify a document in the gallery.");
  }
  if (!isPlainObject(value.preferences)) throw validationError("Preferences must be an object.");

  let palette;
  let preferences;
  try {
    palette = customSlotGroups(customSlotsFromGroups(value.palette));
    preferences = normalizePalettePreferences(value.preferences);
  } catch (error) {
    throw validationError(error.message, error);
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    documents,
    palette,
    lastOpenId: value.lastOpenId,
    preferences,
  };
}

/** Convert a validated gallery into the portable .json backup format. */
export function serializeBackup(envelope) {
  return JSON.stringify(normalizeEnvelope(envelope), null, 2);
}

/** Parse a portable backup. Callers must ask for confirmation before replacing. */
export function parseBackup(json) {
  if (typeof json !== "string") throw validationError("Backup data must be text.");
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw new GalleryStorageError("corrupt", "The backup is not valid JSON.", { cause: error });
  }
  return normalizeEnvelope(parsed);
}

export class GalleryStorage {
  constructor({
    storage,
    key = STORAGE_KEY,
    delay = 500,
    setTimer = (...args) => globalThis.setTimeout(...args),
    clearTimer = (...args) => globalThis.clearTimeout(...args),
  } = {}) {
    if (storage === undefined) {
      try {
        storage = globalThis.localStorage;
      } catch (error) {
        throw new GalleryStorageError("unavailable", "Local storage is unavailable. Export a backup to keep your work safe.", { cause: error });
      }
    }
    if (!storage || typeof storage.getItem !== "function" || typeof storage.setItem !== "function") {
      throw new GalleryStorageError("unavailable", "Local storage is unavailable. Export a backup to keep your work safe.");
    }
    if (!Number.isFinite(delay) || delay < 0) throw new TypeError("Storage delay must be a non-negative number.");
    this.storage = storage;
    this.key = key;
    this.delay = delay;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.timer = null;
    this.pending = null;
    this.lastError = null;
  }

  /** Missing key is intentionally distinct from an existing, empty gallery. */
  load() {
    let raw;
    try {
      raw = this.storage.getItem(this.key);
    } catch (error) {
      throw storageError(error, "read");
    }
    if (raw === null) return { firstLoad: true, envelope: createEmptyEnvelope() };
    try {
      return { firstLoad: false, envelope: parseBackup(raw) };
    } catch (error) {
      throw new GalleryStorageError("corrupt", "Saved gallery data is invalid. Export any current work before resetting it.", { cause: error });
    }
  }

  /** Queue an approximately 500 ms write. Completion is reported to the supplied callbacks. */
  schedule(envelope, { onError, onSuccess } = {}) {
    this.pending = normalizeEnvelope(envelope);
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = this.setTimer(() => {
      this.timer = null;
      try {
        const wrote = this.flush();
        if (wrote && typeof onSuccess === "function") onSuccess();
      } catch (error) {
        if (typeof onError === "function") onError(error);
      }
    }, this.delay);
  }

  /** Write any queued envelope immediately, for unload/navigation or explicit save. */
  flush() {
    if (this.timer !== null) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
    if (this.pending === null) return false;
    const serialised = JSON.stringify(this.pending);
    try {
      this.storage.setItem(this.key, serialised);
    } catch (error) {
      const wrapped = storageError(error, "write");
      this.lastError = wrapped;
      throw wrapped;
    }
    this.pending = null;
    this.lastError = null;
    return true;
  }

  cancel() {
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
    this.pending = null;
  }
}

export function createGalleryStorage(options) {
  return new GalleryStorage(options);
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isTimestamp(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function cloneJson(value, label) {
  try {
    const cloned = JSON.parse(JSON.stringify(value));
    if (cloned === undefined) throw new TypeError("not JSON-compatible");
    return cloned;
  } catch (error) {
    throw validationError(`${label} must be JSON-compatible.`, error);
  }
}

function normalizePalettePreferences(value) {
  const preferences = cloneJson(value, "Preferences");
  if (Object.hasOwn(preferences, "activeColor")) {
    preferences.activeColor = snapColorToMiniSafe(preferences.activeColor);
  }
  if (Object.hasOwn(preferences, "previousColor")) {
    preferences.previousColor = snapColorToMiniSafe(preferences.previousColor);
  }
  if (Object.hasOwn(preferences, "recentColors")) {
    preferences.recentColors = normalizeRecentColors(preferences.recentColors);
  }
  if (Object.hasOwn(preferences, "selectedCustomSlot")
    && (!Number.isInteger(preferences.selectedCustomSlot)
      || preferences.selectedCustomSlot < 0
      || preferences.selectedCustomSlot >= CUSTOM_SLOT_COUNT)) {
    throw new TypeError(`Selected custom slot must be from 0 to ${CUSTOM_SLOT_COUNT - 1}.`);
  }
  return preferences;
}

function validationError(message, cause) {
  return new GalleryStorageError("invalid", message, cause ? { cause } : undefined);
}

function storageError(error, operation) {
  const quota = error?.name === "QuotaExceededError" || error?.code === 22 || error?.code === 1014;
  if (quota) {
    return new GalleryStorageError("quota", "Browser storage is full. Download a gallery backup before freeing space or trying again.", { cause: error });
  }
  return new GalleryStorageError("unavailable", `Browser storage could not ${operation} the gallery. Export a backup to keep your work safe.`, { cause: error });
}
