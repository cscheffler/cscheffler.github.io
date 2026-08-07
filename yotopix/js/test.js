// Standalone test runner for the icon editor's pure/near-pure modules.
// No framework, no runner: just a tiny harness, assertions, and a page render.
// Covers state.js, exporter.js, tools.js. Deliberately does NOT touch
// canvas.js / main.js / palette.js / preview.js — those need the live app DOM.

import {
  idx, xy, inBounds, createDoc, setPixel, clearPixels, litCount, normaliseHex,
  region, inRegion, isOdd, mirrorX, mirrorY, symmetryCells, createHistory, SYMMETRY_MODES,
  PIXEL_COUNT, GRID_MODES,
} from './state.js';
import { toBlob, decodeBlob, slugify } from './exporter.js';
import {
  bresenham, linePoints, rectPoints, floodFillCells, shiftPixels, applyCells, deadZoneCells,
} from './tools.js';
import {
  sanitiseDoc, parseBackup, toBackupJSON, backupFilename, isQuotaError, createSaver, SCHEMA_VERSION,
} from './storage.js';

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
  doc.pixels[0] = '#FF4747';
  doc.pixels[5] = '#2E8B57';
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
  pixels[0] = '#FF4747'; // valid — must survive exactly
  pixels[1] = 'not-a-colour';
  pixels[2] = 123;
  pixels[3] = {};
  pixels[4] = '#GGGGGG';
  pixels[5] = undefined;
  doc.pixels = pixels;

  const out = sanitiseDoc(doc);
  assert(out, 'a doc with some bad pixel values should still sanitise, not be rejected wholesale');
  assertEqual(out.pixels.length, 256, 'pixels.length should stay 256 even with bad values mixed in');
  assertEqual(out.pixels[0], '#FF4747', 'the one valid pixel value should survive exactly');
  assertEqual(out.pixels[1], null, "'not-a-colour' should degrade to null");
  assertEqual(out.pixels[2], null, '123 (a number) should degrade to null');
  assertEqual(out.pixels[3], null, '{} should degrade to null');
  assertEqual(out.pixels[4], null, "'#GGGGGG' (non-hex digits) should degrade to null");
  assertEqual(out.pixels[5], null, 'undefined should degrade to null');
});

await test('sanitiseDoc: pixel hex values are normalised — lowercase uppercased, 3-digit expanded', () => {
  const doc = createDoc();
  const pixels = new Array(PIXEL_COUNT).fill(null);
  pixels[0] = '#ff4747';
  pixels[1] = '#abc';
  doc.pixels = pixels;
  const out = sanitiseDoc(doc);
  assertEqual(out.pixels[0], '#FF4747', "'#ff4747' should normalise to '#FF4747'");
  assertEqual(out.pixels[1], '#AABBCC', "'#abc' should expand and normalise to '#AABBCC'");
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
  docs[0].pixels[0] = '#FF4747';
  docs[1].pixels[10] = '#2E8B57';
  docs[1].grid = 'odd-tl';
  docs[2].pixels[255] = '#4FA8FF';

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
