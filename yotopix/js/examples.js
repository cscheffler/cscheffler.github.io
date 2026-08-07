// Preloaded example icons, so a first-time user does not open a blank grid.
//
// Each is a hand-authored 16x16 character map where '.' means transparent and
// every other character is a key into that icon's own `legend`, mapping to an
// uppercase #RRGGBB colour taken from the curated palette (see palette.js).
//
// None of these use black. Black is a legitimate colour on this panel when it is
// enclosed by lit pixels (SPEC §1), but at 16x16 these three read best as solid
// silhouettes, and black touching an edge would erode them.
//
// Every colour also sits on the display's 15-step channel grid (see state.js).
//
// All three keep the outer ring transparent: an icon that touches all four
// edges loses its silhouette against the dark panel.

import { createDoc, idx } from './state.js';

export const EXAMPLE_ICONS = [
  {
    // Side view: head and neck upper right, tapering tail left, four-square
    // legs. The silhouette does the work — at this size interior detail reads
    // as noise, so the only marking is the eye.
    name: 'Dinosaur',
    grid: 'full',
    legend: { G: '#4BB44B', D: '#2D875A', W: '#FFFFFF' },
    rows: [
      '................',
      '..........GGGG..',
      '..........GWGG..',
      '..........GGGG..',
      '..........GG....',
      '..........GG....',
      '.G.......GGGG...',
      '.GG....GGGGGG...',
      '.GGGGGGGGGGGG...',
      '..GGGGGGGGGGG...',
      '...DDDDDDDDDD...',
      '....DDDDDDDD....',
      '....DD...DD.....',
      '....DD...DD.....',
      '....DDD..DDD....',
      '................',
    ],
  },
  {
    // A true crescent: a disc with an offset disc subtracted, so both edges
    // curve the same way and the limb keeps an even thickness. A filled disc
    // with a ragged edge reads as a lemon, not a moon.
    name: 'Crescent moon',
    grid: 'full',
    legend: { M: '#FFC33C', H: '#FFE14B', S: '#FFFFFF' },
    rows: [
      '................',
      '.....HMMMM......',
      '....HMMM........',
      '...HMMM....S....',
      '..HMMM..........',
      '.HMMM...........',
      '.HMMM...........',
      '.HMMM...........',
      '.HMMM...........',
      '.HMMM...........',
      '..HMMM.......S..',
      '...HMMM.........',
      '....HMMM........',
      '.....HMMMM......',
      '................',
      '................',
    ],
  },
  {
    name: 'Cat face',
    grid: 'full',
    legend: { F: '#C3C3C3', D: '#878787', E: '#C3E14B', N: '#FF96B4' },
    rows: [
      '................',
      '.....F....F.....',
      '....FF....FF....',
      '...FDDF..FDDF...',
      '...FFFFFFFFFF...',
      '...FFFFFFFFFF...',
      '...FFFFFFFFFF...',
      '...FFEEFFEEFF...',
      '...FFEEFFEEFF...',
      '...FFFFFFFFFF...',
      '...FFFFNNFFFF...',
      '....FFFFFFFF....',
      '.....FFFFFF.....',
      '......FFFF......',
      '................',
      '................',
    ],
  },
];

/**
 * Builds fresh documents for the examples. Returns new objects and new pixel
 * arrays on every call — nothing is shared between invocations, so seeding the
 * gallery twice cannot alias two entries onto one array.
 */
export function buildExamples() {
  return EXAMPLE_ICONS.map((example) => {
    const doc = createDoc(example.name);
    doc.grid = example.grid;
    for (let y = 0; y < example.rows.length; y++) {
      const row = example.rows[y];
      for (let x = 0; x < row.length; x++) {
        const char = row[x];
        if (char === '.') continue;
        doc.pixels[idx(x, y)] = example.legend[char];
      }
    }
    return doc;
  });
}
