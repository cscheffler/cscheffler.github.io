// The gallery strip: saved icons drawn on the dark device background, so the
// list is judged the way the Player will show them — SPEC §10.

import { drawPreview } from './preview.js';

const THUMB_SIZE = 48;

export function createGallery({ container, onSelect }) {
  // id -> thumbnail canvas, so a stroke can repaint one tile instead of
  // rebuilding the whole strip on every autosave.
  const thumbs = new Map();
  let currentId = null;

  function tile(doc, selected) {
    const item = document.createElement('li');
    item.className = 'gallery-item';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'gallery-tile';
    button.dataset.id = doc.id;
    button.setAttribute('aria-current', selected ? 'true' : 'false');
    button.title = doc.name;

    const canvas = document.createElement('canvas');
    canvas.className = 'gallery-thumb';
    drawPreview(canvas, doc, { cssSize: THUMB_SIZE });

    const name = document.createElement('span');
    name.className = 'gallery-name';
    name.textContent = doc.name;

    button.append(canvas, name);
    button.addEventListener('click', () => onSelect(doc.id));
    item.append(button);
    thumbs.set(doc.id, { canvas, name, button });
    return item;
  }

  return {
    render(icons, selectedId) {
      currentId = selectedId;
      thumbs.clear();
      container.replaceChildren();

      if (icons.length === 0) {
        const empty = document.createElement('li');
        empty.className = 'gallery-empty';
        empty.textContent = 'No icons. New starts one.';
        container.append(empty);
        return;
      }
      for (const doc of icons) container.append(tile(doc, doc.id === selectedId));
    },

    /** Repaint one tile in place — used while drawing. */
    refresh(doc) {
      const entry = thumbs.get(doc.id);
      if (!entry) return;
      drawPreview(entry.canvas, doc, { cssSize: THUMB_SIZE });
      if (entry.name.textContent !== doc.name) {
        entry.name.textContent = doc.name;
        entry.button.title = doc.name;
      }
    },

    select(id) {
      if (currentId === id) return;
      currentId = id;
      for (const [key, entry] of thumbs) {
        entry.button.setAttribute('aria-current', key === id ? 'true' : 'false');
      }
    },

    /** Bring the selected tile into view after a load from elsewhere. */
    scrollTo(id) {
      thumbs.get(id)?.button.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    },
  };
}
