// Standalone test runner for the icon editor's pure/near-pure modules.
// No framework, no runner: just a tiny harness, assertions, and a page render.
// Covers state.js, exporter.js, tools.js. Deliberately does NOT touch
// canvas.js / main.js / palette.js / preview.js — those need the live app DOM.

import {
  idx, xy, inBounds, createDoc, setPixel, clearPixels, litCount, normaliseHex,
  region, inRegion, isOdd, mirrorX, mirrorY, symmetryCells, createHistory, SYMMETRY_MODES,
  PIXEL_COUNT, GRID_MODES, isOnGrid, luminance,
} from './state.js';
import { toBlob, decodeBlob, slugify } from './exporter.js';
import {
  bresenham, linePoints, rectPoints, floodFillCells, shiftPixels, applyCells, deadZoneCells,
} from './tools.js';
import {
  sanitiseDoc, parseBackup, toBackupJSON, backupFilename, isQuotaError, createSaver, SCHEMA_VERSION,
} from './storage.js';
import { DEFAULT_PALETTE, allSwatches, pushRecent, RECENT_COUNT } from './palette.js';
import {
  centreCrop, clampCrop, boxSample, nearestSample, adjustColor, oklab,
  preparePalette, nearestPaletteColor, buildPixels,
} from './importer.js';
import {
  findEdgeBlack, findVeryDark, findGutter, litCountInRegion, touchesAllEdges, runLint, applyFix,
  DARK_THRESHOLD, LIGHTEN_TO,
} from './lint.js';

// ---- Tiny assertion harness -------------------------------------------

const results = [];
let current = null;

function assert(cond, msg) {
  if (!current) throw new Error('assert() called outside test()');
  if (!cond) throw new Error(msg || 'assertion failed');
}

function deepEqual(a, b) {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  }
  return Object.is(a, b);
}

function assertEqual(actual, expected, msg) {
  if (!deepEqual(actual, expected)) {
    throw new Error(
      `${msg || 'values differ'} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

async function test(name, fn) {
  current = name;
  try {
    await fn();
    results.push({ name, pass: true });
  } catch (err) {
    results.push({ name, pass: false, error: err.message });
  }
  current = null;
}

// ---- 1. Index helpers ---------------------------------------------------

await test('idx: known coordinates map to the documented offsets', () => {
  assertEqual(idx(0, 0), 0, 'idx(0,0) should be 0');
  assertEqual(idx(15, 15), 255, 'idx(15,15) should be 255 (last cell)');
  assertEqual(idx(5, 3), 53, 'idx(5,3) should be 53 (3*16+5)');
});

await test('idx: classic off-by-one boundary (end of row vs start of next row)', () => {
  assertEqual(idx(15, 0), 15, 'idx(15,0), last column of row 0, should be 15');
  assertEqual(idx(0, 1), 16, 'idx(0,1), first column of row 1, should be 16, not 15 or 17');
});

await test('xy: round-trips for every one of the 256 indices', () => {
  for (let i = 0; i < 256; i++) {
    const { x, y } = xy(i);
    const back = idx(x, y);
    assertEqual(back, i, `xy(${i}) -> {x:${x},y:${y}} -> idx() should return ${i}, got ${back}`);
  }
});

await test('inBounds: accepts the full 0..15 range and rejects -1 and 16 on both axes', () => {
  assert(inBounds(0, 0), '(0,0) should be in bounds');
  assert(inBounds(15, 15), '(15,15) should be in bounds');
  assert(!inBounds(-1, 0), '(-1,0) should be out of bounds');
  assert(!inBounds(0, -1), '(0,-1) should be out of bounds');
  assert(!inBounds(16, 0), '(16,0) should be out of bounds (16 is one past the last column)');
  assert(!inBounds(0, 16), '(0,16) should be out of bounds (16 is one past the last row)');
});

// ---- 2. PNG export round-trip -------------------------------------------

await test('PNG export round-trip: encode then decode preserves geometry, alpha and colour exactly', async () => {
  const doc = createDoc('Round Trip');

  const paint = [
    // Four corners.
    [0, 0, '#FF4747'],
    [15, 0, '#2E8B57'],
    [0, 15, '#4FA8FF'],
    [15, 15, '#FFE44D'],
    // Interior pixels, including the near-black the palette ships and pure
    // white. Pure black is in here too: the display cannot show it, but a user
    // can still type it into the hex field, and if it ever survives to export
    // it must survive exactly rather than being silently mangled or dropped.
    [5, 5, '#1A1A1A'],
    [6, 5, '#FFFFFF'],
    [4, 5, '#000000'],
    [7, 7, '#FF4747'],
    [8, 8, '#2E8B57'],
    [9, 9, '#4FA8FF'],
    [3, 12, '#FFE44D'],
    [12, 3, '#1A1A1A'],
  ];
  for (const [x, y, color] of paint) {
    setPixel(doc, x, y, color);
  }
  // Everything else is left as-created: null, i.e. transparent.

  const blob = await toBlob(doc);
  assertEqual(blob.type, 'image/png', 'blob.type should be image/png');
  assert(blob.size > 0, 'blob.size should be non-zero');

  const { width, height, data } = await decodeBlob(blob);
  assertEqual(width, 16, 'decoded width should be 16');
  assertEqual(height, 16, 'decoded height should be 16');

  // Alpha must be strictly binary: the app's model has no partial transparency,
  // and premultiplication in a naive pipeline could smear that. Check every pixel.
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const i = (y * 16 + x) * 4;
      const a = data[i + 3];
      if (a !== 0 && a !== 255) {
        throw new Error(`pixel (${x},${y}) has alpha ${a}, expected exactly 0 or 255`);
      }
    }
  }

  // For every doc pixel, check the decoded pixel matches: transparent stays
  // transparent (alpha 0), and coloured pixels decode to alpha 255 with exact RGB.
  //
  // NOTE: we deliberately only compare R/G/B where alpha is 255. A fully
  // transparent PNG pixel has no meaningful colour — the spec doesn't define
  // its RGB, and browsers commonly zero those bytes out. Asserting RGB on a
  // transparent pixel would fail for a reason that has nothing to do with
  // whether the export is correct, so we skip it there by construction below.
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const docColor = doc.pixels[y * 16 + x];
      const i = (y * 16 + x) * 4;
      const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
      if (docColor === null) {
        assertEqual(a, 0, `pixel (${x},${y}) is transparent in the doc but decoded alpha is ${a}`);
        // RGB intentionally not checked here — see note above.
      } else {
        assertEqual(a, 255, `pixel (${x},${y}) should be opaque (doc colour ${docColor}) but decoded alpha is ${a}`);
        const hex = `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
        assertEqual(
          hex,
          docColor,
          `pixel (${x},${y}) should decode to ${docColor} but got ${hex} (r=${r},g=${g},b=${b})`,
        );
      }
    }
  }
});

// ---- 3. Bresenham continuity ---------------------------------------------

const bresenhamCases = [
  { label: 'diagonal (0,0)->(15,15)', from: [0, 0], to: [15, 15] },
  { label: 'anti-diagonal (0,15)->(15,0)', from: [0, 15], to: [15, 0] },
  { label: 'shallow (0,0)->(15,3)', from: [0, 0], to: [15, 3] },
  { label: 'steep (0,0)->(3,15)', from: [0, 0], to: [3, 15] },
  { label: 'vertical (3,0)->(3,15)', from: [3, 0], to: [3, 15] },
  { label: 'horizontal (0,7)->(15,7)', from: [0, 7], to: [15, 7] },
  { label: 'reverse diagonal (15,15)->(0,0)', from: [15, 15], to: [0, 0] },
];

for (const { label, from, to } of bresenhamCases) {
  await test(`bresenham: ${label} is a gap-free, non-repeating, in-bounds path`, () => {
    const visited = [];
    bresenham(from[0], from[1], to[0], to[1], (x, y) => visited.push([x, y]));

    assert(visited.length > 0, 'no cells were visited at all');
    assertEqual(visited[0], from, `first visited cell should be the start ${JSON.stringify(from)}`);
    assertEqual(
      visited[visited.length - 1],
      to,
      `last visited cell should be the end ${JSON.stringify(to)}`,
    );

    const seen = new Set();
    for (const [x, y] of visited) {
      assert(inBounds(x, y), `visited cell (${x},${y}) is out of bounds for an in-bounds line`);
      const key = `${x},${y}`;
      assert(!seen.has(key), `cell (${x},${y}) was visited more than once`);
      seen.add(key);
    }

    for (let i = 1; i < visited.length; i++) {
      const [px, py] = visited[i - 1];
      const [cx, cy] = visited[i];
      const step = Math.max(Math.abs(cx - px), Math.abs(cy - py));
      assert(
        step === 1,
        `gap between (${px},${py}) and (${cx},${cy}): step is ${step}, must be 1 (8-connected) so a fast drag can't skip cells`,
      );
    }
  });
}

// ---- 4. normaliseHex ------------------------------------------------------

await test('normaliseHex: expands and uppercases valid short and long forms', () => {
  assertEqual(normaliseHex('#abc'), '#AABBCC', "'#abc' should expand to '#AABBCC'");
  assertEqual(normaliseHex('aabbcc'), '#AABBCC', "'aabbcc' should normalise to '#AABBCC'");
  assertEqual(normaliseHex('#FF4747'), '#FF4747', "'#FF4747' should be returned unchanged (already normal)");
});

await test('normaliseHex: rejects anything that is not a valid hex colour', () => {
  assertEqual(normaliseHex('nonsense'), null, "'nonsense' should be rejected");
  assertEqual(normaliseHex(''), null, "empty string should be rejected");
  assertEqual(normaliseHex('#GGGGGG'), null, "'#GGGGGG' has non-hex digits and should be rejected");
  assertEqual(normaliseHex('#1234'), null, "'#1234' is the wrong length (4 digits) and should be rejected");
  assertEqual(normaliseHex(null), null, 'null should be rejected, not thrown on');
  assertEqual(normaliseHex(123), null, 'a number should be rejected, not thrown on');
});

// ---- 5. slugify -------------------------------------------------------

await test('slugify: lowercases a simple name', () => {
  assertEqual(slugify('Dinosaur'), 'dinosaur', "'Dinosaur' should slugify to 'dinosaur'");
});

await test('slugify: punctuation collapses to single interior dashes, no leading/trailing/doubled dashes', () => {
  const slug = slugify('Chapter 7: The End!');
  assert(!slug.startsWith('-'), `slug '${slug}' should not start with a dash`);
  assert(!slug.endsWith('-'), `slug '${slug}' should not end with a dash`);
  assert(!slug.includes('--'), `slug '${slug}' should not contain doubled dashes`);
  assertEqual(slug, 'chapter-7-the-end', `expected 'chapter-7-the-end', got '${slug}'`);
});

await test('slugify: empty or all-punctuation names fall back to "icon"', () => {
  assertEqual(slugify(''), 'icon', "empty string should slugify to 'icon'");
  assertEqual(slugify('   '), 'icon', "whitespace-only should slugify to 'icon'");
  assertEqual(slugify('!!!'), 'icon', "all-punctuation should slugify to 'icon'");
});

// ---- 6. setPixel / clearPixels / litCount ---------------------------------

await test('setPixel: returns false when the value is unchanged, true when it changes', () => {
  const doc = createDoc();
  assertEqual(setPixel(doc, 4, 4, '#FF4747'), true, 'first paint of a null cell should change it and return true');
  assertEqual(setPixel(doc, 4, 4, '#FF4747'), false, 'painting the same colour again should return false');
  assertEqual(setPixel(doc, 4, 4, '#2E8B57'), true, 'painting a different colour should return true');
  assertEqual(setPixel(doc, 4, 4, null), true, 'clearing a painted cell should return true');
  assertEqual(setPixel(doc, 4, 4, null), false, 'clearing an already-null cell should return false');
});

await test('setPixel: out-of-bounds writes are no-ops that do not throw or corrupt the array', () => {
  const doc = createDoc();
  let threw = false;
  let result;
  try {
    result = setPixel(doc, -1, 0, '#FF4747');
  } catch {
    threw = true;
  }
  assert(!threw, 'setPixel with x=-1 should not throw');
  assertEqual(result, false, 'setPixel with x=-1 should return false');
  assertEqual(doc.pixels.length, 256, 'pixels array length should stay 256 after an out-of-bounds write');

  try {
    result = setPixel(doc, 0, 16, '#FF4747');
  } catch {
    threw = true;
  }
  assert(!threw, 'setPixel with y=16 should not throw');
  assertEqual(result, false, 'setPixel with y=16 should return false');
  assertEqual(doc.pixels.length, 256, 'pixels array length should stay 256 after an out-of-bounds write');
  assert(doc.pixels.every((p) => p === null), 'no pixel should have been written by the out-of-bounds calls');
});

await test('litCount: counts painted pixels correctly as pixels are set and cleared', () => {
  const doc = createDoc();
  assertEqual(litCount(doc), 0, 'a fresh doc should have litCount 0');
  setPixel(doc, 0, 0, '#FF4747');
  setPixel(doc, 1, 1, '#2E8B57');
  setPixel(doc, 2, 2, '#4FA8FF');
  assertEqual(litCount(doc), 3, 'after painting 3 distinct pixels, litCount should be 3');
  setPixel(doc, 1, 1, null);
  assertEqual(litCount(doc), 2, 'after clearing one of them, litCount should drop to 2');
  setPixel(doc, 0, 0, '#FFFFFF'); // recolouring, not adding
  assertEqual(litCount(doc), 2, 'recolouring an already-lit pixel should not change litCount');
});

await test('clearPixels: empties the document and reports whether anything was there', () => {
  const doc = createDoc();
  assertEqual(clearPixels(doc), false, 'clearing an already-empty doc should return false');
  setPixel(doc, 3, 3, '#FF4747');
  setPixel(doc, 4, 4, '#2E8B57');
  assertEqual(clearPixels(doc), true, 'clearing a doc with paint on it should return true');
  assertEqual(litCount(doc), 0, 'after clearPixels, litCount should be 0');
  assert(doc.pixels.every((p) => p === null), 'after clearPixels, every pixel should be null');
});

// ---- 7. region / inRegion / isOdd (odd-grid mode) --------------------------

await test('region: each grid mode returns the documented anchor and size', () => {
  const cases = [
    ['full', { x0: 0, y0: 0, size: 16 }],
    ['odd-tl', { x0: 0, y0: 0, size: 15 }],
    ['odd-tr', { x0: 1, y0: 0, size: 15 }],
    ['odd-bl', { x0: 0, y0: 1, size: 15 }],
    ['odd-br', { x0: 1, y0: 1, size: 15 }],
  ];
  for (const [grid, expected] of cases) {
    const r = region(grid);
    assertEqual(r.x0, expected.x0, `region('${grid}').x0 should be ${expected.x0}`);
    assertEqual(r.y0, expected.y0, `region('${grid}').y0 should be ${expected.y0}`);
    assertEqual(r.size, expected.size, `region('${grid}').size should be ${expected.size}`);
  }
});

await test('isOdd: false for full, true for every odd-* mode', () => {
  assert(!isOdd('full'), "isOdd('full') should be false");
  assert(isOdd('odd-tl'), "isOdd('odd-tl') should be true");
  assert(isOdd('odd-tr'), "isOdd('odd-tr') should be true");
  assert(isOdd('odd-bl'), "isOdd('odd-bl') should be true");
  assert(isOdd('odd-br'), "isOdd('odd-br') should be true");
});

await test('inRegion: odd-br drops the top row and left column, keeps its own corners', () => {
  for (let x = 0; x < 16; x++) {
    assert(!inRegion('odd-br', x, 0), `odd-br: (${x},0) is in the dropped top row, should be OUT`);
  }
  for (let y = 0; y < 16; y++) {
    assert(!inRegion('odd-br', 0, y), `odd-br: (0,${y}) is in the dropped left column, should be OUT`);
  }
  assert(inRegion('odd-br', 1, 1), 'odd-br: (1,1), the region corner, should be IN');
  assert(inRegion('odd-br', 15, 15), 'odd-br: (15,15), the region corner, should be IN');
});

await test('inRegion: odd-tl drops the bottom row and right column, keeps its own corners', () => {
  for (let y = 0; y < 16; y++) {
    assert(!inRegion('odd-tl', 15, y), `odd-tl: (15,${y}) is in the dropped right column, should be OUT`);
  }
  for (let x = 0; x < 16; x++) {
    assert(!inRegion('odd-tl', x, 15), `odd-tl: (${x},15) is in the dropped bottom row, should be OUT`);
  }
  assert(inRegion('odd-tl', 0, 0), 'odd-tl: (0,0), the region corner, should be IN');
  assert(inRegion('odd-tl', 14, 14), 'odd-tl: (14,14), the region corner, should be IN');
});

await test('inRegion: odd-tr and odd-bl drop the complementary row/column for their corner', () => {
  // odd-tr anchors at x0=1,y0=0: drops the left column and the bottom row.
  assert(!inRegion('odd-tr', 0, 5), 'odd-tr: (0,5) is in the dropped left column, should be OUT');
  assert(!inRegion('odd-tr', 5, 15), 'odd-tr: (5,15) is in the dropped bottom row, should be OUT');
  assert(inRegion('odd-tr', 1, 0), 'odd-tr: (1,0), the region corner, should be IN');
  assert(inRegion('odd-tr', 15, 14), 'odd-tr: (15,14), the region corner, should be IN');

  // odd-bl anchors at x0=0,y0=1: drops the right column and the top row.
  assert(!inRegion('odd-bl', 15, 5), 'odd-bl: (15,5) is in the dropped right column, should be OUT');
  assert(!inRegion('odd-bl', 5, 0), 'odd-bl: (5,0) is in the dropped top row, should be OUT');
  assert(inRegion('odd-bl', 0, 1), 'odd-bl: (0,1), the region corner, should be IN');
  assert(inRegion('odd-bl', 14, 15), 'odd-bl: (14,15), the region corner, should be IN');
});

// ---- 8. mirrorX / mirrorY --------------------------------------------------

await test('mirrorX: full grid — 16 is even, so the axis falls BETWEEN columns 7 and 8', () => {
  assertEqual(mirrorX('full', 0), 15, "mirrorX('full', 0) should be 15");
  assertEqual(mirrorX('full', 15), 0, "mirrorX('full', 15) should be 0");
  // There is no centre column on a 16-wide grid: 7 and 8 are each other's
  // mirror, and neither maps to itself. This is the off-by-one odd-grid mode
  // exists to give users an escape from.
  assertEqual(mirrorX('full', 7), 8, "mirrorX('full', 7) should be 8 — the axis sits between columns 7 and 8");
  assertEqual(mirrorX('full', 8), 7, "mirrorX('full', 8) should be 7 — the axis sits between columns 7 and 8");
});

await test('mirrorX: odd-br has a real centre column that maps to itself', () => {
  assertEqual(mirrorX('odd-br', 1), 15, "mirrorX('odd-br', 1) should be 15 (region left edge mirrors to the right edge)");
  assertEqual(mirrorX('odd-br', 15), 1, "mirrorX('odd-br', 15) should be 1 (region right edge mirrors to the left edge)");
  assertEqual(mirrorX('odd-br', 8), 8, "mirrorX('odd-br', 8) should be 8 — the true centre column maps to itself");
});

await test('mirrorY: full grid has the same even-grid axis-between-rows behaviour as mirrorX', () => {
  assertEqual(mirrorY('full', 0), 15, "mirrorY('full', 0) should be 15");
  assertEqual(mirrorY('full', 15), 0, "mirrorY('full', 15) should be 0");
  assertEqual(mirrorY('full', 7), 8, "mirrorY('full', 7) should be 8 — the axis sits between rows 7 and 8");
});

await test('mirrorY: odd-tr has y0=0, so it mirrors like a full-height column', () => {
  assertEqual(mirrorY('odd-tr', 0), 14, "mirrorY('odd-tr', 0) should be 14 (y0=0, size=15)");
  assertEqual(mirrorY('odd-tr', 14), 0, "mirrorY('odd-tr', 14) should be 0");
});

await test('mirrorY: odd-br has y0=1, so its centre row maps to itself', () => {
  assertEqual(mirrorY('odd-br', 1), 15, "mirrorY('odd-br', 1) should be 15 (region top edge mirrors to the bottom edge)");
  assertEqual(mirrorY('odd-br', 8), 8, "mirrorY('odd-br', 8) should be 8 — the true centre row maps to itself");
  assertEqual(mirrorY('odd-br', 15), 1, "mirrorY('odd-br', 15) should be 1 (region bottom edge mirrors to the top edge)");
});

// Cells from symmetryCells() come back in an unspecified order, so every
// comparison below treats the result as a SET: map to "x,y" strings and sort.
function cellSet(cells) {
  return cells.map(({ x, y }) => `${x},${y}`).sort();
}

// ---- 9. symmetryCells -------------------------------------------------------

await test('symmetryCells: quad in full grid painting a corner lights all four corners', () => {
  const cells = symmetryCells('full', 0, 0, 'quad');
  assertEqual(cellSet(cells), ['0,0', '15,0', '0,15', '15,15'].sort(), 'quad symmetry at (0,0) in full grid should light exactly the four corners');
});

await test("symmetryCells: quad in odd-br painting its corner lights the region's four corners", () => {
  const cells = symmetryCells('odd-br', 1, 1, 'quad');
  assertEqual(cellSet(cells), ['1,1', '15,1', '1,15', '15,15'].sort(), 'quad symmetry at (1,1) in odd-br should light exactly the region corners');
});

await test('symmetryCells: vertical in full grid at (7,3) lights the pair straddling the axis', () => {
  const cells = symmetryCells('full', 7, 3, 'vertical');
  assertEqual(cellSet(cells), ['7,3', '8,3'].sort(), 'vertical symmetry at (7,3) in full grid should light (7,3) and its mirror (8,3)');
});

await test('symmetryCells: vertical in odd-br at the true centre column de-duplicates to one cell', () => {
  // (8,5) is its own mirror in odd-br (mirrorX('odd-br', 8) === 8), so the
  // mirrored copy lands on the same cell as the original and must not be
  // reported twice.
  const cells = symmetryCells('odd-br', 8, 5, 'vertical');
  assertEqual(cellSet(cells), ['8,5'], 'painting the centre column under vertical symmetry should light exactly one cell, not two overlapping copies');
});

await test("symmetryCells: 'off' always returns exactly the one painted cell, in any grid mode", () => {
  const cases = [
    ['full', 3, 4],
    ['odd-br', 8, 8],
    ['odd-tl', 0, 0],
  ];
  for (const [grid, x, y] of cases) {
    const cells = symmetryCells(grid, x, y, 'off');
    assertEqual(cells.length, 1, `'off' in ${grid} at (${x},${y}) should return exactly one cell, got ${cells.length}`);
    assertEqual(cellSet(cells), [`${x},${y}`], `'off' in ${grid} at (${x},${y}) should return only that cell`);
  }
});

await test("symmetryCells: 'eight' at a full-grid corner adds nothing beyond the quad reflection", () => {
  const cells = symmetryCells('full', 0, 0, 'eight');
  assertEqual(cellSet(cells), ['0,0', '15,0', '0,15', '15,15'].sort(), 'eight symmetry at a corner: the extra diagonal reflections coincide with the quad cells, so no new cells appear');
});

await test("symmetryCells: 'eight' off-axis returns 8 distinct in-bounds cells", () => {
  const cells = symmetryCells('full', 2, 5, 'eight');
  assertEqual(cells.length, 8, `eight symmetry at (2,5) should return 8 distinct cells, got ${cells.length}`);
  assertEqual(new Set(cellSet(cells)).size, 8, 'the 8 cells from eight symmetry at (2,5) should all be distinct');
  for (const { x, y } of cells) {
    assert(inBounds(x, y), `eight symmetry cell (${x},${y}) is out of bounds`);
  }
});

await test('symmetryCells: every produced cell stays inside the odd-tl region (x!==15 and y!==15)', () => {
  const coords = [[0, 0], [14, 14], [5, 12], [12, 5], [0, 14], [14, 0]];
  for (const [x, y] of coords) {
    for (const mode of SYMMETRY_MODES) {
      const cells = symmetryCells('odd-tl', x, y, mode);
      for (const c of cells) {
        assert(c.x !== 15, `symmetryCells('odd-tl', ${x}, ${y}, '${mode}') produced (${c.x},${c.y}) with x===15, outside the odd-tl region`);
        assert(c.y !== 15, `symmetryCells('odd-tl', ${x}, ${y}, '${mode}') produced (${c.x},${c.y}) with y===15, outside the odd-tl region`);
      }
    }
  }
});

// ---- 10. floodFillCells -----------------------------------------------------

await test('floodFillCells: fills exactly the transparent interior of a closed outline — outline and exterior are excluded', () => {
  const doc = createDoc();
  const outline = rectPoints(2, 2, 7, 7, false);
  for (const { x, y } of outline) setPixel(doc, x, y, '#FF4747');

  const filled = floodFillCells(doc, 4, 4, 'full');
  const filledSet = cellSet(filled);

  const expected = [];
  for (let y = 3; y <= 6; y++) {
    for (let x = 3; x <= 6; x++) expected.push(`${x},${y}`);
  }
  assertEqual(filledSet, expected.sort(), 'flood fill from inside a closed 6x6 outline should return exactly the 4x4 transparent interior');
  assert(!filledSet.includes('2,2'), 'flood fill leaked onto the outline corner (2,2)');
  assert(!filledSet.includes('9,9'), 'flood fill leaked outside the outline to (9,9)');
});

await test('floodFillCells: null is a fillable colour — an all-transparent doc fills all 256 cells from any start', () => {
  // SPEC §12.8 pitfall: a naive implementation treats null as "empty, skip it"
  // rather than as a real target colour, so filling a blank canvas silently
  // does nothing. null must be fillable like any other colour.
  const doc = createDoc();
  const filled = floodFillCells(doc, 9, 9, 'full');
  assertEqual(filled.length, 256, `flood fill of an all-transparent doc should return all 256 cells, got ${filled.length}`);
});

await test('floodFillCells: is 4-connected, not 8 — a diagonal barrier is not crossed at the corner touch', () => {
  const doc = createDoc();
  // A one-cell-wide diagonal from (0,0) to (15,15) touches itself only
  // corner-to-corner. An 8-connected fill would hop across those corners and
  // flood the whole canvas; a 4-connected fill must stay on one side.
  for (let i = 0; i < 16; i++) setPixel(doc, i, i, '#FF4747');

  const filled = floodFillCells(doc, 0, 1, 'full');
  assert(filled.length > 0, 'flood fill from (0,1) should return at least the starting cell');
  assert(filled.some((c) => c.x === 0 && c.y === 1), 'flood fill should include its own starting cell (0,1)');
  for (const { x, y } of filled) {
    assert(x < y, `4-connected fill from (0,1) leaked across the diagonal barrier to (${x},${y})`);
  }
});

await test('floodFillCells: in odd-br, fills the whole region and never returns a cell with x===0 or y===0', () => {
  const doc = createDoc();
  const filled = floodFillCells(doc, 8, 8, 'odd-br');
  assertEqual(filled.length, 225, `an empty odd-br region is 15x15=225 cells, got ${filled.length}`);
  for (const { x, y } of filled) {
    assert(x !== 0, `floodFillCells in odd-br returned (${x},${y}) with x===0, in the dropped column`);
    assert(y !== 0, `floodFillCells in odd-br returned (${x},${y}) with y===0, in the dropped row`);
  }
});

// ---- 11. applyCells ---------------------------------------------------------

await test('applyCells: writes the given cells and reports whether anything changed', () => {
  const doc = createDoc();
  const changed1 = applyCells(doc, [{ x: 2, y: 2 }, { x: 3, y: 3 }], '#FF4747', { grid: 'full', symmetry: 'off' });
  assertEqual(changed1, true, 'painting two fresh cells should return true');
  assertEqual(doc.pixels[idx(2, 2)], '#FF4747', '(2,2) should now be painted');
  assertEqual(doc.pixels[idx(3, 3)], '#FF4747', '(3,3) should now be painted');

  const changed2 = applyCells(doc, [{ x: 2, y: 2 }, { x: 3, y: 3 }], '#FF4747', { grid: 'full', symmetry: 'off' });
  assertEqual(changed2, false, 'painting the same cells with the same colour again should return false');
});

await test('applyCells: never writes outside the active region', () => {
  const doc = createDoc();
  const changed = applyCells(doc, [{ x: 0, y: 0 }, { x: 8, y: 8 }], '#FF4747', { grid: 'odd-br', symmetry: 'off' });
  assertEqual(changed, true, 'painting (8,8), which is inside the odd-br region, should still report a change');
  assertEqual(doc.pixels[idx(0, 0)], null, '(0,0) is outside the odd-br region (dropped row/column) and must stay null');
  assertEqual(doc.pixels[idx(8, 8)], '#FF4747', '(8,8) is inside the odd-br region and should be painted');
});

await test('applyCells: vertical symmetry in odd-br on the true centre column paints exactly one pixel', () => {
  const doc = createDoc();
  applyCells(doc, [{ x: 8, y: 8 }], '#FF4747', { grid: 'odd-br', symmetry: 'vertical' });
  assertEqual(litCount(doc), 1, 'painting the odd-br centre column under vertical symmetry should light exactly one pixel, not two overlapping writes');
  assertEqual(doc.pixels[idx(8, 8)], '#FF4747', '(8,8) should be the one painted pixel');
});

// ---- 12. shiftPixels ---------------------------------------------------------

await test('shiftPixels: wraps at the right/bottom edges rather than dropping pixels that fall off', () => {
  const doc = createDoc();
  setPixel(doc, 15, 5, '#FF4747');
  const shifted = shiftPixels(doc.pixels, 1, 0);
  assertEqual(shifted[idx(0, 5)], '#FF4747', 'a pixel at x=15 shifted by +1 should wrap around to x=0');
  assertEqual(shifted[idx(15, 5)], null, 'the source cell should no longer hold the pixel after the shift');
});

await test('shiftPixels: wraps at the top/left edges too, on negative shifts', () => {
  const doc = createDoc();
  setPixel(doc, 5, 0, '#2E8B57');
  const shifted = shiftPixels(doc.pixels, 0, -1);
  assertEqual(shifted[idx(5, 15)], '#2E8B57', 'a pixel at y=0 shifted by -1 should wrap around to y=15');
});

await test('shiftPixels: returns a fresh 256-length array and does not mutate the input', () => {
  const doc = createDoc();
  setPixel(doc, 3, 3, '#4FA8FF');
  const before = doc.pixels.slice();
  const shifted = shiftPixels(doc.pixels, 2, 2);
  assert(shifted !== doc.pixels, 'shiftPixels should return a new array, not the same reference');
  assertEqual(shifted.length, 256, 'the shifted array should have 256 entries');
  assertEqual(doc.pixels, before, 'the input array should not be mutated by shiftPixels');
});

await test('shiftPixels: a shift and its inverse round-trip back to the original arrangement', () => {
  const doc = createDoc();
  setPixel(doc, 0, 0, '#FF4747');
  setPixel(doc, 15, 15, '#2E8B57');
  setPixel(doc, 7, 9, '#4FA8FF');
  const original = doc.pixels.slice();
  const forward = shiftPixels(doc.pixels, 1, 0);
  const back = shiftPixels(forward, -1, 0);
  assertEqual(back, original, 'shifting by (+1,0) then (-1,0) should restore the original arrangement, including the wrapped pixel');
});

await test('shiftPixels: a diagonal shift moves both axes at once', () => {
  const doc = createDoc();
  setPixel(doc, 4, 4, '#FF4747');
  const shifted = shiftPixels(doc.pixels, 3, 5);
  assertEqual(shifted[idx(7, 9)], '#FF4747', 'a diagonal shift of (+3,+5) should move (4,4) to (7,9)');
  assertEqual(shifted.filter((p) => p !== null).length, 1, 'exactly one pixel should be lit after shifting a single-pixel doc');
});

// ---- 13. undo/redo history ---------------------------------------------------

await test('history: 50 successive strokes undo one-by-one back to empty, then redo back to the end — SPEC acceptance criterion', () => {
  const doc = createDoc();
  const history = createHistory();
  const snapshots = [doc.pixels.slice()]; // snapshots[0]: the empty starting state

  for (let i = 0; i < 50; i++) {
    history.begin(doc);
    const { x, y } = xy(i); // 50 distinct cells, one per stroke
    setPixel(doc, x, y, '#FF4747');
    const committed = history.commit(doc);
    assert(committed, `stroke ${i} should have committed (it changed the document)`);
    snapshots.push(doc.pixels.slice());
  }
  assertEqual(history.depth(), 50, 'after 50 committed strokes, history depth should be 50');

  for (let i = 50; i >= 1; i--) {
    const ok = history.undo(doc);
    assert(ok, `undo should succeed while ${i} stroke(s) remain on the stack`);
    assertEqual(doc.pixels, snapshots[i - 1], `after undoing stroke ${i}, doc should exactly match the state captured before it`);
  }
  assert(!history.canUndo(), 'canUndo() should be false once all 50 strokes have been undone');
  assert(doc.pixels.every((p) => p === null), 'doc should be completely empty after undoing all 50 strokes');

  for (let i = 1; i <= 50; i++) {
    const ok = history.redo(doc);
    assert(ok, `redo should succeed while replaying stroke ${i}`);
    assertEqual(doc.pixels, snapshots[i], `after redoing stroke ${i}, doc should exactly match the state captured after it`);
  }
  assert(!history.canRedo(), 'canRedo() should be false once all 50 strokes have been redone');
});

await test('history.commit: returns false and pushes nothing when the document did not change', () => {
  const doc = createDoc();
  const history = createHistory();
  history.begin(doc);
  const committed = history.commit(doc);
  assertEqual(committed, false, 'commit with no intervening edit should return false');
  assertEqual(history.depth(), 0, 'a no-op commit should not push anything onto the history stack');
  assert(!history.canUndo(), 'canUndo() should be false after a no-op commit');
});

await test('history: a new commit after an undo clears the redo stack', () => {
  const doc = createDoc();
  const history = createHistory();

  history.begin(doc);
  setPixel(doc, 1, 1, '#FF4747');
  history.commit(doc);

  history.undo(doc);
  assert(history.canRedo(), 'canRedo() should be true immediately after an undo');

  history.begin(doc);
  setPixel(doc, 2, 2, '#2E8B57');
  history.commit(doc);

  assert(!history.canRedo(), 'a new edit after an undo should clear the redo stack');
});

await test('history: createHistory(limit) caps depth, dropping old entries but not the ability to undo', () => {
  const doc = createDoc();
  const history = createHistory(5);

  for (let i = 0; i < 8; i++) {
    history.begin(doc);
    const { x, y } = xy(i);
    setPixel(doc, x, y, '#FF4747');
    history.commit(doc);
  }
  assertEqual(history.depth(), 5, 'history capped at 5 should report depth 5 after 8 edits');

  let threw = false;
  try {
    for (let i = 0; i < 5; i++) history.undo(doc);
  } catch {
    threw = true;
  }
  assert(!threw, 'undoing 5 times on a history capped at 5 should not throw');
  assert(!history.canUndo(), 'after undoing all 5 retained entries, canUndo() should be false');
});

await test('history: undo restores doc.grid, not just doc.pixels', () => {
  const doc = createDoc();
  const history = createHistory();
  setPixel(doc, 8, 8, '#FF4747'); // paint before history starts tracking
  assertEqual(doc.grid, 'full', 'a fresh doc should start in full grid mode');

  history.begin(doc);
  doc.grid = 'odd-br';
  setPixel(doc, 8, 8, null); // switch grid mode and clear the pixel in the same edit
  const committed = history.commit(doc);
  assert(committed, 'switching grid mode and clearing a pixel should count as a change');

  const ok = history.undo(doc);
  assert(ok, 'undo should succeed');
  assertEqual(doc.grid, 'full', 'undo should restore grid back to full, not just the pixel data');
  assertEqual(doc.pixels[idx(8, 8)], '#FF4747', 'undo should also restore the pixel that was cleared alongside the grid switch');
});

// ---- 14. PNG export masks the odd-grid dead zone -----------------------------

await test('toBlob/decodeBlob: odd-br export makes the dropped row and column transparent, even if the array holds paint there', async () => {
  const doc = createDoc('Odd Grid Export');
  // Write directly into doc.pixels, bypassing setPixel, to prove the masking
  // happens at export time (SPEC §9) and not merely because the array was
  // already clean in the dead zone.
  doc.pixels[idx(0, 5)] = '#FF4747'; // dropped column
  doc.pixels[idx(5, 0)] = '#2E8B57'; // dropped row
  doc.pixels[idx(0, 0)] = '#4FA8FF'; // dropped row AND column
  doc.pixels[idx(8, 8)] = '#FFE44D'; // inside the region — should survive
  doc.grid = 'odd-br';

  const blob = await toBlob(doc);
  const { data } = await decodeBlob(blob);

  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      if (x === 0 || y === 0) {
        const a = data[(y * 16 + x) * 4 + 3];
        assertEqual(a, 0, `(${x},${y}) is in the odd-br dropped row/column and must be transparent in the export, got alpha ${a}`);
      }
    }
  }

  const i = (8 * 16 + 8) * 4;
  const hex = `#${[data[i], data[i + 1], data[i + 2]].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
  assertEqual(data[i + 3], 255, '(8,8) is inside the odd-br region and should be opaque in the export');
  assertEqual(hex, '#FFE44D', `(8,8) should decode to #FFE44D but got ${hex}`);
});

// ---- 15. deadZoneCells --------------------------------------------------------

await test('deadZoneCells: empty for full grid — nothing is ever outside the full region', () => {
  const doc = createDoc();
  setPixel(doc, 0, 0, '#FF4747');
  setPixel(doc, 15, 15, '#2E8B57');
  assertEqual(deadZoneCells(doc, 'full').length, 0, 'switching to full grid should never drop any pixels');
});

await test('deadZoneCells: finds a pixel that switching to odd-br would destroy', () => {
  const doc = createDoc();
  setPixel(doc, 0, 0, '#FF4747');
  const dead = deadZoneCells(doc, 'odd-br');
  assertEqual(dead.length, 1, 'exactly one painted pixel sits in the odd-br dead zone');
  assertEqual(dead[0].x, 0, 'the dead pixel should be at x=0');
  assertEqual(dead[0].y, 0, 'the dead pixel should be at y=0');
});

await test('deadZoneCells: never reports transparent cells, even inside the dead zone', () => {
  const doc = createDoc(); // entirely transparent
  assertEqual(deadZoneCells(doc, 'odd-br').length, 0, 'an all-transparent doc has nothing to lose, dead zone or not');
});

// ---- 16. rectPoints / linePoints ----------------------------------------------

await test('rectPoints: outline of a 4x4 square is exactly its 12 perimeter cells, no interior', () => {
  const outline = rectPoints(2, 2, 5, 5, false);
  assertEqual(outline.length, 12, `a 4x4 square outline should have 12 cells, got ${outline.length}`);
  const expected = [];
  for (let y = 2; y <= 5; y++) {
    for (let x = 2; x <= 5; x++) {
      if (x === 2 || x === 5 || y === 2 || y === 5) expected.push(`${x},${y}`);
    }
  }
  assertEqual(cellSet(outline), expected.sort(), 'rectPoints outline should be exactly the perimeter of the 4x4 square');
});

await test('rectPoints: filled 4x4 square is all 16 cells', () => {
  const filled = rectPoints(2, 2, 5, 5, true);
  assertEqual(filled.length, 16, `a filled 4x4 square should have 16 cells, got ${filled.length}`);
});

await test('rectPoints: corner order does not matter — swapped corners give the same set', () => {
  const a = cellSet(rectPoints(2, 2, 5, 5, false));
  const b = cellSet(rectPoints(5, 5, 2, 2, false));
  assertEqual(b, a, 'rectPoints(5,5,2,2) should return the same set of cells as rectPoints(2,2,5,5)');
});

await test('linePoints: includes both endpoints and is 8-connected with no gaps', () => {
  const points = linePoints(1, 1, 6, 4);
  const first = points[0];
  const last = points[points.length - 1];
  assertEqual(first.x, 1, 'first point x should be the start x');
  assertEqual(first.y, 1, 'first point y should be the start y');
  assertEqual(last.x, 6, 'last point x should be the end x');
  assertEqual(last.y, 4, 'last point y should be the end y');

  for (let i = 1; i < points.length; i++) {
    const step = Math.max(Math.abs(points[i].x - points[i - 1].x), Math.abs(points[i].y - points[i - 1].y));
    assert(step === 1, `gap between line point ${i - 1} and ${i}: step is ${step}, must be 1 (8-connected)`);
  }
});

// ---- 17. storage.js: sanitiseDoc — the gate every document passes through ---
//
// Everything here proves the app cannot be broken by bad stored data: a
// corrupt or hand-edited document must degrade gracefully, never throw.

await test('sanitiseDoc: a valid document round-trips unchanged', () => {
  const doc = createDoc('My Icon');
  // On-grid colours, so "unchanged" is a meaningful claim: quantising a colour
  // that already sits on the display's 15-step grid is a no-op.
  doc.pixels[0] = '#FF4B4B';
  doc.pixels[5] = '#2D875A';
  doc.grid = 'odd-br';
  const out = sanitiseDoc(doc);
  assert(out, 'a valid document should not be rejected');
  assertEqual(out.name, 'My Icon', 'name should survive the round trip');
  assertEqual(out.grid, 'odd-br', 'grid should survive the round trip');
  assertEqual(out.pixels, doc.pixels, 'pixels should survive the round trip exactly');
  assertEqual(out.pixels.length, 256, 'pixels.length should be 256');
});

await test('sanitiseDoc: returns null, and never throws, for structurally broken input', () => {
  const bad = [
    null,
    undefined,
    'a string',
    42,
    {}, // no pixels property at all
    { name: 'X' }, // pixels missing
    { pixels: 'not-an-array' },
    { pixels: {} }, // not an array, but an object
    { pixels: new Array(255).fill(null) }, // one short
    { pixels: new Array(257).fill(null) }, // one over
  ];
  for (const input of bad) {
    let threw = false;
    let result;
    try {
      result = sanitiseDoc(input);
    } catch {
      threw = true;
    }
    assert(!threw, `sanitiseDoc(${JSON.stringify(input)}) should not throw`);
    assertEqual(result, null, `sanitiseDoc(${JSON.stringify(input)}) should return null`);
  }
});

await test('sanitiseDoc: bad individual pixel values degrade to null, not the whole icon', () => {
  // A single hand-edited or truncated pixel value must not cost the user the
  // other 255 pixels of a picture — only that one cell should be lost.
  const doc = createDoc('Mixed');
  const pixels = new Array(PIXEL_COUNT).fill(null);
  pixels[0] = '#FF4747'; // valid, though off-grid: snaps to #FF4B4B
  pixels[1] = 'not-a-colour';
  pixels[2] = 123;
  pixels[3] = {};
  pixels[4] = '#GGGGGG';
  pixels[5] = undefined;
  doc.pixels = pixels;

  const out = sanitiseDoc(doc);
  assert(out, 'a doc with some bad pixel values should still sanitise, not be rejected wholesale');
  assertEqual(out.pixels.length, 256, 'pixels.length should stay 256 even with bad values mixed in');
  assertEqual(out.pixels[0], '#FF4B4B', 'the one valid pixel value should survive, snapped to the display grid');
  assertEqual(out.pixels[1], null, "'not-a-colour' should degrade to null");
  assertEqual(out.pixels[2], null, '123 (a number) should degrade to null');
  assertEqual(out.pixels[3], null, '{} should degrade to null');
  assertEqual(out.pixels[4], null, "'#GGGGGG' (non-hex digits) should degrade to null");
  assertEqual(out.pixels[5], null, 'undefined should degrade to null');
});

await test('sanitiseDoc: pixel hex values are normalised and snapped to the display grid', () => {
  const doc = createDoc();
  const pixels = new Array(PIXEL_COUNT).fill(null);
  pixels[0] = '#ff4747';   // lowercase AND off-grid
  pixels[1] = '#abc';      // 3-digit -> #AABBCC (170,187,204), all off-grid
  pixels[2] = '#0f0f0f';   // already on the grid: must be left alone
  doc.pixels = pixels;
  const out = sanitiseDoc(doc);
  // The display only resolves channel values in steps of 15, so storage snaps
  // every colour to that grid on the way in. This doubles as the schema 1 -> 2
  // migration for art saved before the grid was known.
  assertEqual(out.pixels[0], '#FF4B4B', "'#ff4747' should uppercase and snap to '#FF4B4B'");
  assertEqual(out.pixels[1], '#A5B4D2', "'#abc' should expand to #AABBCC and snap to '#A5B4D2'");
  assertEqual(out.pixels[2], '#0F0F0F', "'#0f0f0f' is already on the grid and should be untouched");
});

await test('sanitiseDoc: an unknown or missing grid falls back to full; every real mode is preserved', () => {
  const base = createDoc();
  assertEqual(sanitiseDoc({ ...base, grid: 'not-a-real-mode' }).grid, 'full', 'an unrecognised grid string should fall back to full');
  assertEqual(sanitiseDoc({ ...base, grid: undefined }).grid, 'full', 'grid: undefined should fall back to full');
  const { grid, ...withoutGrid } = base;
  assertEqual(sanitiseDoc(withoutGrid).grid, 'full', 'a doc missing the grid property entirely should fall back to full');
  for (const mode of GRID_MODES) {
    assertEqual(sanitiseDoc({ ...base, grid: mode }).grid, mode, `grid '${mode}' from GRID_MODES should be preserved exactly`);
  }
});

await test('sanitiseDoc: a missing or blank name becomes Untitled; long names truncate; names are trimmed', () => {
  const base = createDoc();
  assertEqual(sanitiseDoc({ ...base, name: undefined }).name, 'Untitled', 'a missing name should become Untitled');
  assertEqual(sanitiseDoc({ ...base, name: '' }).name, 'Untitled', 'an empty name should become Untitled');
  assertEqual(sanitiseDoc({ ...base, name: '   ' }).name, 'Untitled', 'a whitespace-only name should become Untitled');
  assertEqual(sanitiseDoc({ ...base, name: '  Spaced  ' }).name, 'Spaced', 'surrounding whitespace should be trimmed off a name');
  const out = sanitiseDoc({ ...base, name: 'x'.repeat(300) });
  assert(out.name.length <= 64, `a 300-character name should be truncated to at most 64 characters, got ${out.name.length}`);
});

await test('sanitiseDoc: a missing id still produces a document with a non-empty string id', () => {
  const base = createDoc();
  const { id, ...withoutId } = base;
  const out = sanitiseDoc(withoutId);
  assert(typeof out.id === 'string' && out.id.length > 0, 'sanitiseDoc should invent an id when the raw document has none');
});

await test('sanitiseDoc: non-finite or missing createdAt/updatedAt become finite numbers', () => {
  const base = createDoc();
  const badTimes = [undefined, NaN, Infinity, -Infinity, 'not-a-number', null];
  for (const bad of badTimes) {
    const out = sanitiseDoc({ ...base, createdAt: bad, updatedAt: bad });
    assert(Number.isFinite(out.createdAt), `createdAt ${bad} should become a finite number, got ${out.createdAt}`);
    assert(Number.isFinite(out.updatedAt), `updatedAt ${bad} should become a finite number, got ${out.updatedAt}`);
  }
});

// ---- 18. storage.js: parseBackup -------------------------------------------

await test('parseBackup: round-trips with toBackupJSON', () => {
  const docs = [createDoc('Alpha'), createDoc('Beta'), createDoc('Gamma')];
  // On-grid colours, so "keeps its pixels exactly" stays a meaningful claim
  // once storage snaps everything to the display's 15-step grid.
  docs[0].pixels[0] = '#FF4B4B';
  docs[1].pixels[10] = '#2D875A';
  docs[1].grid = 'odd-tl';
  docs[2].pixels[255] = '#4BA5FF';

  const { icons } = parseBackup(toBackupJSON(docs));
  assertEqual(icons.length, 3, 'round-tripping 3 docs through toBackupJSON/parseBackup should yield 3 icons');
  for (const original of docs) {
    const match = icons.find((ic) => ic.name === original.name);
    assert(match, `an icon named '${original.name}' should survive the round trip`);
    assertEqual(match.grid, original.grid, `icon '${original.name}' should keep its grid mode`);
    assertEqual(match.pixels, original.pixels, `icon '${original.name}' should keep its pixels exactly`);
  }
});

await test('parseBackup: accepts a bare top-level array as well as the {schemaVersion, icons} object form', () => {
  const docs = [createDoc('One'), createDoc('Two')];

  const { icons: fromArray } = parseBackup(JSON.stringify(docs));
  assertEqual(fromArray.length, 2, 'a bare top-level array of documents should be accepted');

  const { icons: fromObject } = parseBackup(toBackupJSON(docs));
  assertEqual(fromObject.length, 2, 'the {schemaVersion, icons} object form should also be accepted');
});

await test('parseBackup: throws a descriptive Error for invalid JSON and JSON that is not a backup', () => {
  const cases = ['not json at all {', '{"hello":1}', '42', '"text"'];
  for (const text of cases) {
    let threw = false;
    let message = null;
    try {
      parseBackup(text);
    } catch (error) {
      threw = true;
      message = error.message;
    }
    assert(threw, `parseBackup(${JSON.stringify(text)}) should throw, not return a bogus result`);
    assert(typeof message === 'string' && message.length > 0, `parseBackup(${JSON.stringify(text)}) should throw with a non-empty message, got ${JSON.stringify(message)}`);
  }
});

await test('parseBackup: throws when every entry in the backup is unusable', () => {
  const text = JSON.stringify({ schemaVersion: 1, icons: [{ pixels: [] }, { not: 'a doc' }, null, 42] });
  let threw = false;
  let message = null;
  try {
    parseBackup(text);
  } catch (error) {
    threw = true;
    message = error.message;
  }
  assert(threw, 'a backup whose entries are all unusable should throw rather than return an empty gallery');
  assert(typeof message === 'string' && message.length > 0, 'the "no usable icons" error should have a non-empty message');
});

await test('parseBackup: reports skipped correctly — 2 good and 2 broken entries yields 2 icons, skipped 2', () => {
  const text = JSON.stringify({
    schemaVersion: 1,
    icons: [
      createDoc('Keeper One'),
      { pixels: 'not-an-array' },
      createDoc('Keeper Two'),
      { pixels: new Array(255).fill(null) },
    ],
  });
  const { icons, skipped } = parseBackup(text);
  assertEqual(icons.length, 2, 'exactly the 2 good entries should survive');
  assertEqual(skipped, 2, 'the 2 broken entries should be reported as skipped');
});

await test("parseBackup: recovered documents are independent objects — mutating one doesn't affect another", () => {
  const a = createDoc('A');
  const b = createDoc('B');
  a.pixels[0] = '#FF4747';
  b.pixels[0] = '#2E8B57';

  const { icons } = parseBackup(toBackupJSON([a, b]));
  const iconA = icons.find((ic) => ic.name === 'A');
  const iconB = icons.find((ic) => ic.name === 'B');
  assert(iconA.pixels !== iconB.pixels, 'recovered icons should not share the same pixels array reference');

  iconA.pixels[1] = '#4FA8FF';
  assertEqual(iconB.pixels[1], null, "mutating one recovered icon's pixels must not affect another icon's pixels");
});

// ---- 19. storage.js: duplicate ids ------------------------------------------

await test('parseBackup: two documents sharing the same id come back with distinct ids', () => {
  // Selection elsewhere in the app is by id, so a collision would make it
  // ambiguous which of two icons the user meant to open.
  const a = createDoc('First');
  const b = createDoc('Second');
  b.id = a.id; // force a collision

  const { icons } = parseBackup(toBackupJSON([a, b]));
  assertEqual(icons.length, 2, 'both documents should still be recovered despite the id collision');
  assert(icons[0].id !== icons[1].id, `duplicate ids must be re-keyed — got the same id '${icons[0].id}' twice`);
});

// ---- 20. storage.js: toBackupJSON --------------------------------------------

await test('toBackupJSON: produces valid JSON with the schema version and an icons array of the right length', () => {
  const docs = [createDoc('One'), createDoc('Two'), createDoc('Three')];
  const json = toBackupJSON(docs);

  let parsed;
  let threw = false;
  try {
    parsed = JSON.parse(json);
  } catch {
    threw = true;
  }
  assert(!threw, 'toBackupJSON output should be valid JSON');
  assertEqual(parsed.schemaVersion, SCHEMA_VERSION, 'schemaVersion in the backup should match the exported SCHEMA_VERSION');
  assert(Array.isArray(parsed.icons), 'the backup should have an icons array');
  assertEqual(parsed.icons.length, 3, 'the icons array should have one entry per document passed in');
});

// ---- 21. storage.js: backupFilename ------------------------------------------

await test('backupFilename: embeds the ISO date and ends with .json', () => {
  const name = backupFilename(new Date('2026-03-09T12:00:00Z'));
  assert(name.includes('2026-03-09'), `filename '${name}' should contain the date 2026-03-09`);
  assert(name.endsWith('.json'), `filename '${name}' should end with .json`);
});

// ---- 22. storage.js: isQuotaError ---------------------------------------------

await test('isQuotaError: true for a QuotaExceededError DOMException, false for a plain Error or null', () => {
  const quota = new DOMException('full', 'QuotaExceededError');
  assert(isQuotaError(quota), 'a DOMException named QuotaExceededError should be recognised as a quota error');
  assert(!isQuotaError(new Error('nope')), 'a plain Error should not be treated as a quota error');
  assert(!isQuotaError(null), 'null should not be treated as a quota error');
});

// ---- 23. storage.js: createSaver — the debounced writer ----------------------

await test('createSaver.schedule: does not call getState synchronously', () => {
  let calls = 0;
  const saver = createSaver({ onError: () => {} });
  saver.schedule(() => {
    calls++;
    return { icons: [], lastOpenId: null };
  });
  assertEqual(calls, 0, 'schedule() should defer the write, not call getState synchronously');
  saver.cancel(); // don't leave a real write pending once this test has moved on
});

await test('createSaver.cancel: prevents a scheduled write from ever happening', async () => {
  let calls = 0;
  const saver = createSaver({ onError: () => {} });
  saver.schedule(() => {
    calls++;
    return { icons: [], lastOpenId: null };
  });
  saver.cancel();
  await new Promise((r) => setTimeout(r, 40));
  assertEqual(calls, 0, 'cancel() called before the delay elapses should stop the scheduled write from ever running');
});

await test('createSaver.flush: writes immediately and returns a boolean', () => {
  // flush() calls the real save(), which writes to storage.js's gallery key
  // ('yotopix.gallery' — not exported, so the literal is repeated here).
  // test.html is served from the same origin as the app, so that is the SAME
  // key holding the developer's real gallery: writing an empty gallery over it,
  // or removing it, would destroy their icons and make the app reseed the
  // examples on next load. So snapshot the existing value and put it back,
  // in a finally so a failed assertion still restores it.
  const KEY = 'yotopix.gallery';
  let original = null;
  try {
    original = localStorage.getItem(KEY);
  } catch {
    // Storage unavailable; flush() will report that by returning false.
  }

  try {
    const saver = createSaver({ onError: () => {} });
    const result = saver.flush(() => ({ icons: [], lastOpenId: null }));
    // Storage being unavailable in this environment is not a test failure —
    // flush() reports that by returning false. Only the return type is asserted.
    assertEqual(typeof result, 'boolean', `flush() should return a boolean, got ${typeof result}`);
  } finally {
    try {
      if (original === null) localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, original);
    } catch {
      // Nothing more we can do if storage is gone.
    }
  }
});


// ---- 24. palette.js: the curated defaults ----------------------------------

await test('DEFAULT_PALETTE: every swatch sits on the display\'s 15-step channel grid', () => {
  const offGrid = allSwatches().filter((hex) => !isOnGrid(hex));
  assertEqual(offGrid, [], `these swatches are not on the 15-step grid: ${offGrid.join(', ')}`);
});

await test('DEFAULT_PALETTE: no duplicate swatches, and the count is in the documented range', () => {
  const swatches = allSwatches();
  const unique = new Set(swatches);
  assertEqual(unique.size, swatches.length, 'the palette contains a duplicate colour');
  assert(
    swatches.length >= 24 && swatches.length <= 33,
    `SPEC §5 asks for 24-33 swatches, got ${swatches.length}`,
  );
});

await test('DEFAULT_PALETTE: is groups of swatches, not a flat list', () => {
  // Shading ramps (SPEC §15.1) are groups of related colours. v1 only ever
  // creates single-swatch groups, but the shape has to be right now to avoid a
  // storage migration later.
  for (const group of DEFAULT_PALETTE) {
    assert(Array.isArray(group.swatches), `group '${group.id}' should have a swatches array`);
    assert(group.swatches.length > 0, `group '${group.id}' should have at least one swatch`);
    assert(typeof group.name === 'string' && group.name.length > 0, `group '${group.id}' needs a name`);
  }
});

await test('DEFAULT_PALETTE: includes pure black, deliberately', () => {
  // SPEC §1: black is an unlit pixel, so enclosed by lit pixels it reads as a
  // hole (an eye, a gap) — the only way to draw one on an emissive panel. It
  // only betrays you where it touches the silhouette edge, which is a lint
  // concern, not a reason to withhold the colour.
  const swatches = allSwatches();
  assert(swatches.includes('#000000'), 'pure black should be in the palette');
  assertEqual(
    swatches.filter((hex) => hex === '#000000').length, 1,
    'pure black should appear exactly once',
  );
  assert(swatches.includes('#1E1E1E'), 'the near-black should still be there, for a pixel that is nearly off rather than off');
});

await test('pushRecent: most recent first, distinct, quantised, and capped', () => {
  let list = [];
  list = pushRecent(list, '#FF4B4B');
  list = pushRecent(list, '#4BB44B');
  assertEqual(list[0], '#4BB44B', 'the newest colour should be first');
  assertEqual(list.length, 2, 'two distinct colours should both be kept');

  list = pushRecent(list, '#FF4B4B');
  assertEqual(list[0], '#FF4B4B', 're-using a colour should move it to the front');
  assertEqual(list.length, 2, 're-using a colour should not add a duplicate entry');

  // Off-grid input is snapped, so the list can never suggest an undisplayable colour.
  assertEqual(pushRecent([], '#FF4747')[0], '#FF4B4B', 'a recent colour should be snapped to the grid');
  assertEqual(pushRecent([], 'nonsense'), [], 'junk should be ignored, not stored');

  let long = [];
  for (let i = 0; i <= RECENT_COUNT + 4; i++) {
    long = pushRecent(long, `#${(i * 15).toString(16).padStart(2, '0')}0000`);
  }
  assert(long.length <= RECENT_COUNT, `recents should cap at ${RECENT_COUNT}, got ${long.length}`);
});

// ---- 25. importer.js: centreCrop -------------------------------------------

await test('centreCrop: a wide image crops from the sides, keeping the full height', () => {
  const crop = centreCrop(100, 60);
  assertEqual(crop.x, 20, 'centreCrop(100,60).x should be 20');
  assertEqual(crop.y, 0, 'centreCrop(100,60).y should be 0');
  assertEqual(crop.size, 60, 'centreCrop(100,60).size should be 60');
});

await test('centreCrop: a tall image crops from the top and bottom, keeping the full width', () => {
  const crop = centreCrop(60, 100);
  assertEqual(crop.x, 0, 'centreCrop(60,100).x should be 0');
  assertEqual(crop.y, 20, 'centreCrop(60,100).y should be 20');
  assertEqual(crop.size, 60, 'centreCrop(60,100).size should be 60');
});

await test('centreCrop: a square image returns the whole thing', () => {
  const crop = centreCrop(40, 40);
  assertEqual(crop.x, 0, 'centreCrop(40,40).x should be 0');
  assertEqual(crop.y, 0, 'centreCrop(40,40).y should be 0');
  assertEqual(crop.size, 40, 'centreCrop(40,40).size should be 40');
});

await test('centreCrop: odd dimensions never produce fractional or out-of-range values', () => {
  const cases = [[101, 60], [60, 101], [99, 99], [1, 1], [7, 2]];
  for (const [w, h] of cases) {
    const { x, y, size } = centreCrop(w, h);
    assert(
      Number.isInteger(x) && Number.isInteger(y) && Number.isInteger(size),
      `centreCrop(${w},${h}) should return integers, got x=${x} y=${y} size=${size}`,
    );
    assert(size >= 1, `centreCrop(${w},${h}) size should be at least 1, got ${size}`);
    assert(x >= 0 && x + size <= w, `centreCrop(${w},${h}) x=${x} size=${size} runs outside width ${w}`);
    assert(y >= 0 && y + size <= h, `centreCrop(${w},${h}) y=${y} size=${size} runs outside height ${h}`);
  }
});

// ---- 26. importer.js: clampCrop --------------------------------------------

await test('clampCrop: an already-valid crop is returned unchanged', () => {
  const out = clampCrop({ x: 5, y: 5, size: 10 }, 40, 40);
  assertEqual(out.x, 5, 'a valid crop x should be unchanged');
  assertEqual(out.y, 5, 'a valid crop y should be unchanged');
  assertEqual(out.size, 10, 'a valid crop size should be unchanged');
});

await test('clampCrop: negative x/y are pulled back inside the image', () => {
  const out = clampCrop({ x: -20, y: -20, size: 10 }, 40, 40);
  assert(out.x >= 0, `clampCrop with negative x should clamp to >= 0, got ${out.x}`);
  assert(out.y >= 0, `clampCrop with negative y should clamp to >= 0, got ${out.y}`);
  assertEqual(out.size, 10, 'size should be unaffected by a negative origin');
});

await test('clampCrop: x/y past the far edge are pulled back so the crop stays inside', () => {
  const out = clampCrop({ x: 100, y: 100, size: 10 }, 40, 40);
  assert(out.x + out.size <= 40, `clampCrop x=${out.x} size=${out.size} should stay within width 40`);
  assert(out.y + out.size <= 40, `clampCrop y=${out.y} size=${out.size} should stay within height 40`);
  assert(out.size >= 1, `clampCrop size should stay at least 1, got ${out.size}`);
});

await test('clampCrop: a size larger than the image is capped, and stays square and inside bounds', () => {
  const out = clampCrop({ x: 0, y: 0, size: 999 }, 40, 30);
  assertEqual(out.size, 30, 'size should be capped to the smaller image dimension (30)');
  assert(out.x >= 0 && out.x + out.size <= 40, `clamped crop x=${out.x} size=${out.size} should stay within width 40`);
  assert(out.y >= 0 && out.y + out.size <= 30, `clamped crop y=${out.y} size=${out.size} should stay within height 30`);
});

await test('clampCrop: a zero size is floored to at least 1px', () => {
  const out = clampCrop({ x: 0, y: 0, size: 0 }, 40, 40);
  assert(out.size >= 1, `clampCrop with size 0 should floor to at least 1px, got ${out.size}`);
});

// ---- 27. importer.js: boxSample --------------------------------------------

// closeTo: boxSample and adjustColor divide/lerp, so results are floats even
// when the "obviously correct" answer is a round number — compare with a
// tolerance instead of exact equality.
function closeTo(actual, expected, tolerance, msg) {
  assert(
    Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance,
    `${msg || 'value not close enough'} — expected ${expected} ± ${tolerance}, got ${actual}`,
  );
}

// Builds a synthetic { width, height, data } image for importer.js's pure
// pipeline functions. fn(x, y) returns [r, g, b, a] for that pixel. Nothing
// past decodeToImageData needs a real decoded image, just this shape.
function makeImage(width, height, fn) {
  const data = new Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = fn(x, y);
      const i = (y * width + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = a;
    }
  }
  return { width, height, data };
}

await test('boxSample: a flat-colour region averages to exactly that colour', () => {
  const image = makeImage(4, 4, () => [100, 150, 200, 255]);
  const sample = boxSample(image, 0, 0, 4, 4);
  assertEqual(sample.r, 100, 'flat region r should average to exactly 100');
  assertEqual(sample.g, 150, 'flat region g should average to exactly 150');
  assertEqual(sample.b, 200, 'flat region b should average to exactly 200');
  assertEqual(sample.a, 255, 'flat region a should average to exactly 255');
});

await test('boxSample: a black pixel and a white pixel average to about 128', () => {
  const image = makeImage(2, 1, (x) => (x === 0 ? [0, 0, 0, 255] : [255, 255, 255, 255]));
  const sample = boxSample(image, 0, 0, 2, 1);
  closeTo(sample.r, 128, 1, 'black+white average r should be about 128');
  closeTo(sample.g, 128, 1, 'black+white average g should be about 128');
  closeTo(sample.b, 128, 1, 'black+white average b should be about 128');
});

await test('boxSample: alpha weighting — a transparent neighbour does not drag an opaque pixel toward black', () => {
  // A fully transparent pixel normally carries RGB 0 (nothing was ever drawn
  // there). A naive unweighted mean would blend that 0 straight into the
  // result, dragging every edge toward black and putting a dark halo around
  // cut-out artwork. boxSample instead accumulates premultiplied colour and
  // divides by total alpha, so a transparent neighbour contributes nothing to
  // the resulting colour — only to how transparent the averaged cell is.
  const image = makeImage(2, 1, (x) => (x === 0 ? [255, 0, 0, 255] : [0, 0, 0, 0]));
  const sample = boxSample(image, 0, 0, 2, 1);
  assertEqual(sample.r, 255, 'opaque red + transparent black should average to pure red (r=255), not a darkened half-red');
  assertEqual(sample.g, 0, 'opaque red + transparent black should average to pure red (g=0)');
  assertEqual(sample.b, 0, 'opaque red + transparent black should average to pure red (b=0)');
  closeTo(sample.a, 128, 1, 'alpha itself should still average normally, to about 128');
});

await test('boxSample: a fully transparent region returns alpha 0 without dividing by zero or producing NaN', () => {
  const image = makeImage(3, 3, () => [50, 60, 70, 0]);
  const sample = boxSample(image, 0, 0, 3, 3);
  assertEqual(sample.a, 0, 'a fully transparent region should average to alpha 0');
  assert(Number.isFinite(sample.r), `r should be finite, got ${sample.r}`);
  assert(Number.isFinite(sample.g), `g should be finite, got ${sample.g}`);
  assert(Number.isFinite(sample.b), `b should be finite, got ${sample.b}`);
  assert(Number.isFinite(sample.a), `a should be finite, got ${sample.a}`);
});

// ---- 28. importer.js: nearestSample ----------------------------------------

await test('nearestSample: picks the pixel at the centre of the rect, not a corner', () => {
  const image = makeImage(4, 1, (x) => [x * 50, 0, 0, 255]); // gradient: 0, 50, 100, 150
  const sample = nearestSample(image, 0, 0, 4, 1);
  assertEqual(sample.r, 100, 'nearestSample over the full 4px width should pick x=2 (the centre), not x=0 or x=3');
});

// ---- 29. importer.js: adjustColor ------------------------------------------

await test('adjustColor: (0, 0) is the identity — no brightness or saturation change', () => {
  const out = adjustColor({ r: 10, g: 130, b: 240 }, 0, 0);
  closeTo(out.r, 10, 0.001, 'r should be unchanged at brightness/saturation 0');
  closeTo(out.g, 130, 0.001, 'g should be unchanged at brightness/saturation 0');
  closeTo(out.b, 240, 0.001, 'b should be unchanged at brightness/saturation 0');
});

await test('adjustColor: brightness +100 doubles a mid grey', () => {
  const out = adjustColor({ r: 100, g: 100, b: 100 }, 100, 0);
  closeTo(out.r, 200, 0.001, 'brightness +100 should double r (gain 2x) for a mid grey');
  closeTo(out.g, 200, 0.001, 'brightness +100 should double g (gain 2x) for a mid grey');
  closeTo(out.b, 200, 0.001, 'brightness +100 should double b (gain 2x) for a mid grey');
});

await test('adjustColor: brightness clamps at 255 and never goes below 0, even at the extremes', () => {
  const bright = adjustColor({ r: 200, g: 200, b: 200 }, 100, 0);
  assertEqual(bright.r, 255, 'brightness +100 on r=200 (gain 2x -> 400) should clamp to 255');
  assertEqual(bright.g, 255, 'brightness +100 on g=200 should clamp to 255');
  assertEqual(bright.b, 255, 'brightness +100 on b=200 should clamp to 255');

  const dark = adjustColor({ r: 200, g: 200, b: 200 }, -100, 0);
  assertEqual(dark.r, 0, 'brightness -100 (gain 0x) should floor to 0');
  assertEqual(dark.g, 0, 'brightness -100 (gain 0x) should floor to 0');
  assertEqual(dark.b, 0, 'brightness -100 (gain 0x) should floor to 0');
});

await test('adjustColor: saturating a neutral grey leaves it grey — there is nothing to saturate', () => {
  const out = adjustColor({ r: 128, g: 128, b: 128 }, 0, 100);
  closeTo(out.r, 128, 0.001, 'saturating a neutral grey should not change r');
  closeTo(out.g, 128, 0.001, 'saturating a neutral grey should not change g');
  closeTo(out.b, 128, 0.001, 'saturating a neutral grey should not change b');
});

await test('adjustColor: saturation +100 pushes a reddish colour further apart from its other channels', () => {
  const base = { r: 180, g: 100, b: 100 };
  const out = adjustColor(base, 0, 100);
  assert(out.r > base.r, `saturation +100 should push r up from ${base.r}, got ${out.r}`);
  assert(out.g < base.g, `saturation +100 should push g down from ${base.g}, got ${out.g}`);
});

await test('adjustColor: saturation -100 collapses a colour to a neutral grey (r, g, b within 1 of each other)', () => {
  const out = adjustColor({ r: 180, g: 100, b: 100 }, 0, -100);
  assert(Math.abs(out.r - out.g) <= 1, `saturation -100 should collapse r and g together, got r=${out.r} g=${out.g}`);
  assert(Math.abs(out.g - out.b) <= 1, `saturation -100 should collapse g and b together, got g=${out.g} b=${out.b}`);
});

await test('adjustColor: every returned channel is finite and within 0..255 for a sweep of inputs', () => {
  const brightnesses = [-100, -50, 0, 50, 100];
  const saturations = [-100, -50, 0, 50, 100];
  const colours = [
    { r: 0, g: 0, b: 0 },
    { r: 255, g: 255, b: 255 },
    { r: 255, g: 0, b: 0 },
    { r: 12, g: 200, b: 90 },
  ];
  for (const brightness of brightnesses) {
    for (const saturation of saturations) {
      for (const colour of colours) {
        const out = adjustColor(colour, brightness, saturation);
        for (const ch of ['r', 'g', 'b']) {
          assert(
            Number.isFinite(out[ch]),
            `adjustColor(${JSON.stringify(colour)}, ${brightness}, ${saturation}).${ch} should be finite, got ${out[ch]}`,
          );
          assert(
            out[ch] >= 0 && out[ch] <= 255,
            `adjustColor(${JSON.stringify(colour)}, ${brightness}, ${saturation}).${ch} should be within 0..255, got ${out[ch]}`,
          );
        }
      }
    }
  }
});

// ---- 30. importer.js: oklab ------------------------------------------------
//
// These are the properties nearestPaletteColor relies on: a near-uniform
// lightness axis and a hue/chroma pair that is genuinely 0 for anything grey,
// so nearest-by-distance actually means "looks closest".

await test('oklab: white has L about 1', () => {
  const { L } = oklab(255, 255, 255);
  closeTo(L, 1, 0.01, 'oklab(255,255,255).L should be about 1');
});

await test('oklab: black has L about 0', () => {
  const { L } = oklab(0, 0, 0);
  closeTo(L, 0, 0.01, 'oklab(0,0,0).L should be about 0');
});

await test('oklab: a neutral grey has a and b about 0', () => {
  const { a, b } = oklab(128, 128, 128);
  closeTo(a, 0, 0.01, 'oklab(128,128,128).a should be about 0 for a neutral grey');
  closeTo(b, 0, 0.01, 'oklab(128,128,128).b should be about 0 for a neutral grey');
});

// ---- 31. importer.js: nearestPaletteColor / preparePalette ----------------

await test('nearestPaletteColor: near-white picks white, a dark red picks red rather than black, a mid grey picks grey', () => {
  // A small, explicit palette so the expected winner is obvious by eye, and
  // one that includes both a saturated colour and true black so "closest" is
  // a real choice rather than the only option available.
  const palette = ['#FFFFFF', '#000000', '#CC2222', '#0000CC', '#808080'];
  const prepared = preparePalette(palette);

  assertEqual(nearestPaletteColor({ r: 250, g: 248, b: 245 }, prepared), '#FFFFFF', 'a near-white colour should match white');
  assertEqual(nearestPaletteColor({ r: 130, g: 15, b: 10 }, prepared), '#CC2222', 'a dark red colour should match red, not black');
  assertEqual(nearestPaletteColor({ r: 130, g: 130, b: 130 }, prepared), '#808080', 'a mid grey colour should match the grey swatch, not a saturated colour');
});

await test('nearestPaletteColor: the result is always one of the palette entries', () => {
  const palette = ['#FFFFFF', '#000000', '#CC2222', '#0000CC', '#808080', '#22CC22'];
  const prepared = preparePalette(palette);
  const samples = [
    { r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 }, { r: 12, g: 200, b: 90 },
    { r: 90, g: 12, b: 200 }, { r: 200, g: 90, b: 12 }, { r: 60, g: 60, b: 60 },
  ];
  for (const rgb of samples) {
    const match = nearestPaletteColor(rgb, prepared);
    assert(palette.includes(match), `nearestPaletteColor(${JSON.stringify(rgb)}) returned '${match}', which is not in the palette`);
  }
});

// ---- 32. importer.js: buildPixels — the whole import pipeline -------------

await test('buildPixels: returns exactly size*size entries — 16 gives 256, 15 gives the odd-grid target of 225', () => {
  const image = makeImage(16, 16, (x, y) => [x * 16, 255 - x * 16, (y * 16) % 256, 255]);
  assertEqual(buildPixels(image, { size: 16 }).length, 256, 'size:16 should produce 256 entries');
  assertEqual(buildPixels(image, { size: 15 }).length, 225, 'size:15 should produce 225 entries');
});

await test('buildPixels: every non-null entry sits on the 15-step display grid, with or without a palette', () => {
  // Mandatory and independent of the palette option: the panel cannot show
  // anything off this grid, whether or not the user asked for palette colours.
  const image = makeImage(16, 16, (x, y) => [x * 16, 255 - x * 16, (y * 16) % 256, 255]);

  const withoutPalette = buildPixels(image, { size: 16 });
  const offGrid1 = withoutPalette.filter((hex) => hex !== null && !isOnGrid(hex));
  assertEqual(offGrid1, [], `every non-null pixel without a palette should be on-grid, found off-grid: ${offGrid1.join(', ')}`);

  const withPalette = buildPixels(image, { size: 16, palette: allSwatches() });
  const offGrid2 = withPalette.filter((hex) => hex !== null && !isOnGrid(hex));
  assertEqual(offGrid2, [], `every non-null pixel with a palette should also be on-grid, found off-grid: ${offGrid2.join(', ')}`);
});

await test('buildPixels: alpha threshold — 120/255 alpha comes out entirely transparent at 0.5 and entirely opaque at 0.4', () => {
  const image = makeImage(16, 16, () => [200, 50, 50, 120]); // 120/255 ≈ 0.47
  const highThreshold = buildPixels(image, { size: 16, alphaThreshold: 0.5 });
  assert(highThreshold.every((p) => p === null), 'alphaThreshold 0.5 with source alpha ~0.47 should produce an entirely transparent result');

  const lowThreshold = buildPixels(image, { size: 16, alphaThreshold: 0.4 });
  assert(lowThreshold.every((p) => p !== null), 'alphaThreshold 0.4 with source alpha ~0.47 should produce an entirely opaque result');
});

await test('buildPixels: with a palette, every non-null output is a member of that palette', () => {
  const image = makeImage(32, 32, (x, y) => [(x * 7) % 256, (y * 11) % 256, ((x + y) * 5) % 256, 255]);
  const swatches = allSwatches();
  const out = buildPixels(image, { size: 16, palette: swatches });
  const foreign = out.filter((hex) => hex !== null && !swatches.includes(hex));
  assertEqual(foreign, [], `every non-null pixel should be a palette member, found non-members: ${foreign.join(', ')}`);
});

await test("buildPixels: 'nearest' and the default box method both produce on-grid output, and actually differ on a busy image", () => {
  // A pixel-level checkerboard, downsampled 4x: each output cell mixes black
  // and white source pixels, so box-averaging (mid grey) and nearest-picking
  // (whichever one pixel lands on the centre) should disagree.
  const checker = makeImage(64, 64, (x, y) => ((x + y) % 2 === 0 ? [255, 255, 255, 255] : [0, 0, 0, 255]));
  const boxOut = buildPixels(checker, { size: 16 });
  const nearOut = buildPixels(checker, { size: 16, method: 'nearest' });

  assert(
    boxOut.every((p) => p === null || isOnGrid(p)),
    'box method output should be entirely on-grid',
  );
  assert(
    nearOut.every((p) => p === null || isOnGrid(p)),
    'nearest method output should be entirely on-grid',
  );
  assert(
    JSON.stringify(boxOut) !== JSON.stringify(nearOut),
    'box and nearest sampling should disagree somewhere on a busy checkerboard image',
  );
});

await test('buildPixels: an entirely transparent source produces an all-null result', () => {
  const image = makeImage(16, 16, () => [10, 20, 30, 0]);
  const out = buildPixels(image, { size: 16 });
  assert(out.every((p) => p === null), 'a fully transparent source image should produce nothing but null pixels');
});

await test('buildPixels: does not mutate the input image data', () => {
  const image = makeImage(16, 16, (x, y) => [x * 16, 255 - x * 16, (y * 16) % 256, 255]);
  const before = image.data.slice();
  buildPixels(image, { size: 16, palette: allSwatches() });
  assertEqual(image.data, before, 'buildPixels should not modify the source image data array');
});

// ---- 33. lint.js: findEdgeBlack — enclosed vs exposed black ----------------
//
// This is the crux of the whole lint module (SPEC §1, §7): on an emissive
// panel, black and "off" are the same physical thing. Black surrounded by lit
// pixels reads as a deliberate hole (an eye, a mouth) and must never be
// flagged. Black that is 4-connected to a transparent pixel, or to the edge
// of the drawing area, reads as transparent and erodes the silhouette — that
// is the only case that should be flagged. Getting this backwards would make
// the tool nag about exactly the reason black is in the palette, so both
// directions are tested explicitly below.

// Builds a document from an array of equal-length strings, one character per
// pixel, via a legend mapping characters to colours (or null for
// transparent). Rows are placed at the top-left of the 16x16 canvas; any cell
// beyond the given rows/columns is left transparent. Turns the pixel pictures
// in the comments below into the actual documents under test.
function docFromRows(rows, legend, grid = 'full') {
  const doc = createDoc();
  doc.grid = grid;
  for (let y = 0; y < rows.length; y++) {
    const row = rows[y];
    for (let x = 0; x < row.length; x++) {
      const color = legend[row[x]];
      if (color !== undefined) doc.pixels[idx(x, y)] = color;
    }
  }
  return doc;
}

await test('findEdgeBlack: a black pixel fully enclosed by lit pixels is a deliberate hole and is not flagged', () => {
  // A solid 5x5 blob with one black pixel dead centre: all four of its
  // neighbours are lit, so this reads as an eye or a gap cut into the shape —
  // exactly what black in the palette exists for.
  const doc = docFromRows([
    '........',
    '........',
    '..XXXXX.',
    '..XXXXX.',
    '..XXKXX.',
    '..XXXXX.',
    '..XXXXX.',
    '........',
  ], { '.': null, X: '#FF4747', K: '#000000' });

  assertEqual(findEdgeBlack(doc), [], 'a black pixel enclosed on all four sides by lit pixels should never be flagged');
});

await test('findEdgeBlack: the same blob with the black pixel moved to its boundary is flagged', () => {
  // Same shape, but the black pixel now sits on the blob's left edge: its
  // west neighbour is transparent, so it reads as transparent itself and eats
  // into the silhouette.
  const doc = docFromRows([
    '........',
    '........',
    '..XXXXX.',
    '..XXXXX.',
    '..KXXXX.',
    '..XXXXX.',
    '..XXXXX.',
    '........',
  ], { '.': null, X: '#FF4747', K: '#000000' });

  assertEqual(findEdgeBlack(doc), [idx(2, 4)], "a black pixel with a transparent neighbour on the blob's boundary should be flagged, exactly that one cell");
});

await test('findEdgeBlack: a black pixel at the canvas edge is flagged — outside the canvas counts as outside the icon', () => {
  const doc = docFromRows(['K'], { K: '#000000' }); // (0,0), everything else transparent
  assertEqual(findEdgeBlack(doc), [idx(0, 0)], 'a black pixel at (0,0) with nothing else painted should be flagged');
});

await test("findEdgeBlack: odd-br — a black pixel against the region boundary is flagged, because the region edge is the icon's edge", () => {
  // (1,1) is the region's own top-left corner in odd-br (region x0=1,y0=1).
  // Its in-region neighbours (2,1) and (1,2) are lit, so it is not exposed by
  // an ordinary null neighbour — it is exposed only because the dropped row
  // (y=0) and dropped column (x=0) sit right next to it, and that boundary
  // counts as the edge of the drawing area.
  const doc = docFromRows([
    '.......',
    '.KX....',
    '.X.....',
  ], { '.': null, X: '#FF4747', K: '#000000' }, 'odd-br');

  assertEqual(findEdgeBlack(doc), [idx(1, 1)], 'a black pixel at the odd-br region corner (1,1) should be flagged');
});

await test('findEdgeBlack: diagonal-only exposure does not count — the rule is 4-connected, not 8', () => {
  // Black pixel at the centre of a plus of lit pixels: all four 4-neighbours
  // are lit, but a diagonal neighbour (3,3) is transparent. An 8-connected
  // rule would flag this; the correct 4-connected rule must not.
  const doc = docFromRows([
    '.......',
    '.......',
    '.......',
    '....X..',
    '...XKX.',
    '....X..',
    '.......',
  ], { '.': null, X: '#FF4747', K: '#000000' });

  assertEqual(findEdgeBlack(doc), [], 'a black pixel with all 4-neighbours lit must not be flagged just because a diagonal neighbour is transparent');
});

// ---- 34. lint.js: findVeryDark ----------------------------------------------

await test('findVeryDark: LIGHTEN_TO does not itself re-trigger the warning it exists to fix', () => {
  // If the one-click fix colour were itself below DARK_THRESHOLD, applying
  // the fix would leave the pixel just as flagged as before — an embarrassing
  // loop dressed up as a fix.
  assert(
    luminance(LIGHTEN_TO) > DARK_THRESHOLD,
    `luminance(LIGHTEN_TO) (${luminance(LIGHTEN_TO)}) should be above DARK_THRESHOLD (${DARK_THRESHOLD})`,
  );
});

await test('findVeryDark: a near-black grey below DARK_THRESHOLD is flagged; a bright colour and pure black are not', () => {
  const doc = docFromRows(['DBK'], { D: '#1E1E1E', B: '#FF4747', K: '#000000' });
  // (0,0) is #1E1E1E (dark), (1,0) is a bright colour, (2,0) is pure black —
  // pure black is excluded here because it is findEdgeBlack's business, and
  // enclosed black is deliberate rather than a mistake.
  assertEqual(findVeryDark(doc), [idx(0, 0)], '#1E1E1E should be the only flagged pixel');
});

// ---- 35. lint.js: findGutter -------------------------------------------------

await test('findGutter: odd grid mode reports painted pixels outside the region, and none inside it', () => {
  const doc = docFromRows([
    'X........',
    '.Y.......',
  ], { X: '#FF4747', Y: '#2E8B57', '.': null }, 'odd-br');
  // (0,0) is in the dropped row AND column; (1,1) is the region's own corner.

  assertEqual(findGutter(doc), [idx(0, 0)], 'only the pixel outside the odd-br region should be reported as gutter paint');
});

await test('findGutter: full grid mode always returns empty, regardless of content', () => {
  const doc = docFromRows([
    'X........',
    '.Y.......',
  ], { X: '#FF4747', Y: '#2E8B57', '.': null }, 'full');

  assertEqual(findGutter(doc), [], 'full grid mode has no gutter, so findGutter should return empty no matter what is painted');
});

// ---- 36. lint.js: litCountInRegion -------------------------------------------

await test('litCountInRegion: counts only paint inside the active region, ignoring the gutter', () => {
  const doc = docFromRows([
    'X........',
    '.YY......',
  ], { X: '#FF4747', Y: '#2E8B57', '.': null }, 'odd-br');
  // (0,0) is gutter (dropped row+column); (1,1) and (2,1) are inside the region.

  assertEqual(litCountInRegion(doc), 2, 'litCountInRegion should count the 2 in-region pixels and skip the 1 gutter pixel');
});

// ---- 37. lint.js: touchesAllEdges --------------------------------------------

await test('touchesAllEdges: false for inset art that reaches no edge', () => {
  const doc = createDoc();
  setPixel(doc, 7, 7, '#FF4747');
  setPixel(doc, 8, 8, '#FF4747');
  assert(!touchesAllEdges(doc), 'a small inset shape should not report touching all four edges');
});

await test('touchesAllEdges: false when only three of the four edges are reached', () => {
  const doc = createDoc();
  setPixel(doc, 0, 5, '#FF4747');  // left
  setPixel(doc, 15, 5, '#FF4747'); // right
  setPixel(doc, 5, 0, '#FF4747');  // top
  // bottom (y=15) deliberately left untouched
  assert(!touchesAllEdges(doc), 'reaching only three of the four edges should not count as touching all edges');
});

await test('touchesAllEdges: true once paint reaches all four edges of a full-grid canvas', () => {
  const doc = createDoc();
  setPixel(doc, 0, 5, '#FF4747');  // left
  setPixel(doc, 15, 5, '#FF4747'); // right
  setPixel(doc, 5, 0, '#FF4747');  // top
  setPixel(doc, 5, 15, '#FF4747'); // bottom
  assert(touchesAllEdges(doc), 'paint touching all four canvas edges should report true');
});

await test("touchesAllEdges: odd-br — the edges are the region's edges (x=1/x=15, y=1/y=15), not the canvas edges", () => {
  const doc = createDoc();
  doc.grid = 'odd-br';
  setPixel(doc, 1, 8, '#FF4747');  // region left edge (x0=1)
  setPixel(doc, 15, 8, '#FF4747'); // region right edge
  setPixel(doc, 8, 1, '#FF4747');  // region top edge (y0=1)
  setPixel(doc, 8, 15, '#FF4747'); // region bottom edge
  assert(touchesAllEdges(doc), 'paint touching all four edges of the odd-br region should report true');

  // Remove the region's own left-edge pixel: the canvas still has an x=0
  // column, but it is outside the region and must not stand in for it.
  setPixel(doc, 1, 8, null);
  assert(!touchesAllEdges(doc), "without paint on the region's own left edge, touchesAllEdges should be false");
});

// ---- 38. lint.js: runLint ----------------------------------------------------

await test('runLint: a clean, inset, mid-brightness icon has nothing to say', () => {
  const doc = createDoc();
  setPixel(doc, 6, 6, '#FF4747');
  setPixel(doc, 7, 7, '#4FA8FF');
  setPixel(doc, 8, 8, '#2E8B57');
  assertEqual(runLint(doc), [], 'a small, inset, well-lit icon should produce no warnings');
});

await test('runLint: an empty document gets the empty warning, and not the edges warning too', () => {
  const warnings = runLint(createDoc());
  const ids = warnings.map((w) => w.id);
  assert(ids.includes('empty'), 'an empty document should get the empty warning');
  assert(!ids.includes('edges'), 'an empty document touches no edge, so it must not also get the edges warning');
});

await test('runLint: messages are non-empty, end with a full stop, use no exclamation marks, and count-based ones include the count', () => {
  const doc = createDoc();
  doc.grid = 'odd-br';
  setPixel(doc, 0, 0, '#FF4747');  // gutter: outside the region
  setPixel(doc, 1, 1, '#000000'); // black-edge: exposed black at the region corner
  setPixel(doc, 5, 5, '#1E1E1E'); // too-dark
  setPixel(doc, 15, 8, '#4FA8FF'); // region right edge
  setPixel(doc, 8, 15, '#4FA8FF'); // region bottom edge
  // (1,1) above sits on both the region's left and top edges, so together with
  // the two pixels just above this document should trigger all of gutter,
  // black-edge, too-dark and edges at once.

  const warnings = runLint(doc);
  const ids = warnings.map((w) => w.id);
  for (const id of ['gutter', 'black-edge', 'too-dark', 'edges']) {
    assert(ids.includes(id), `expected the '${id}' warning to be triggered by this document, got ${JSON.stringify(ids)}`);
  }

  for (const w of warnings) {
    assert(typeof w.message === 'string' && w.message.length > 0, `warning '${w.id}' should have a non-empty message`);
    assert(w.message.endsWith('.'), `warning '${w.id}' message should end with a full stop, got '${w.message}'`);
    // SPEC §7: say what is wrong and what to do — no apologising, no exclamation marks.
    assert(!w.message.includes('!'), `warning '${w.id}' message should contain no exclamation mark, got '${w.message}'`);
  }

  for (const id of ['gutter', 'black-edge', 'too-dark']) {
    const w = warnings.find((x) => x.id === id);
    assert(w.message.includes('1'), `'${id}' message should mention its count (1), got '${w.message}'`);
  }
});

await test("runLint: warnings that offer fixes have well-formed entries; the empty warning offers none", () => {
  const doc = createDoc();
  doc.grid = 'odd-br';
  setPixel(doc, 0, 0, '#FF4747');  // gutter
  setPixel(doc, 1, 5, '#000000'); // black-edge
  setPixel(doc, 5, 5, '#1E1E1E'); // too-dark

  const warnings = runLint(doc);
  for (const id of ['gutter', 'black-edge', 'too-dark']) {
    const w = warnings.find((x) => x.id === id);
    assert(w, `expected the '${id}' warning`);
    assert(Array.isArray(w.fixes) && w.fixes.length > 0, `warning '${id}' should offer at least one fix`);
    for (const fix of w.fixes) {
      assert(typeof fix.label === 'string' && fix.label.length > 0, `a fix for '${id}' should have a non-empty label string`);
      assert(typeof fix.action === 'string' && fix.action.length > 0, `a fix for '${id}' should have a non-empty action string`);
    }
  }

  const emptyWarning = runLint(createDoc()).find((w) => w.id === 'empty');
  assertEqual(emptyWarning.fixes, [], 'the empty warning has nothing to fix, so its fixes array should be empty');
});

// ---- 39. lint.js: applyFix ---------------------------------------------------

await test('applyFix: lighten sets cells to LIGHTEN_TO and reports a change; a second call reports none', () => {
  const doc = createDoc();
  setPixel(doc, 4, 4, '#1E1E1E');
  const first = applyFix(doc, [idx(4, 4)], 'lighten');
  assertEqual(first, true, 'lightening a dark pixel should report a change');
  assertEqual(doc.pixels[idx(4, 4)], LIGHTEN_TO, 'the fixed cell should now hold LIGHTEN_TO');

  const second = applyFix(doc, [idx(4, 4)], 'lighten');
  assertEqual(second, false, 'lightening an already-lightened cell again should report no change');
});

await test('applyFix: clear sets cells to null and reports a change', () => {
  const doc = createDoc();
  setPixel(doc, 4, 4, '#000000');
  const changed = applyFix(doc, [idx(4, 4)], 'clear');
  assertEqual(changed, true, 'clearing a painted cell should report a change');
  assertEqual(doc.pixels[idx(4, 4)], null, 'the cleared cell should now be null');
});

await test("applyFix: only touches the cells it was given, leaving a neighbour untouched", () => {
  const doc = createDoc();
  setPixel(doc, 4, 4, '#000000');
  setPixel(doc, 5, 4, '#FF4747');
  applyFix(doc, [idx(4, 4)], 'clear');
  assertEqual(doc.pixels[idx(5, 4)], '#FF4747', "applyFix should not touch a neighbouring cell it wasn't given");
});

await test('applyFix: fixing the flagged cells actually resolves the black-edge warning', () => {
  const doc = createDoc();
  setPixel(doc, 4, 4, '#000000'); // exposed: every neighbour is transparent
  let warnings = runLint(doc);
  const blackWarning = warnings.find((w) => w.id === 'black-edge');
  assert(blackWarning, 'expected the black-edge warning to be present before the fix');

  applyFix(doc, blackWarning.cells, 'clear');
  warnings = runLint(doc);
  assert(!warnings.some((w) => w.id === 'black-edge'), 'after applying the fix, the black-edge warning should be gone');
});

// ---- Render results to the page and console -------------------------------

const passed = results.filter((r) => r.pass).length;
const failed = results.length - passed;

const list = document.getElementById('results');
for (const r of results) {
  const li = document.createElement('li');
  li.className = r.pass ? 'pass' : 'fail';
  if (r.pass) {
    li.textContent = `✓ ${r.name}`;
  } else {
    const head = document.createElement('div');
    head.textContent = `✗ ${r.name}`;
    const detail = document.createElement('div');
    detail.className = 'detail';
    detail.textContent = r.error;
    li.append(head, detail);
  }
  list.append(li);
}

const summary = document.getElementById('summary');
summary.textContent = `${passed} passed, ${failed} failed`;
summary.className = failed === 0 ? 'pass' : 'fail';

console.log(`[test.js] ${passed} passed, ${failed} failed`);
for (const r of results) {
  if (!r.pass) console.error(`[test.js] FAIL: ${r.name} — ${r.error}`);
}
