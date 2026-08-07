/**
 * First-run gallery examples. These are intentionally hand-authored rather
 * than generated: at 16px a clear silhouette is more useful than detail.
 */
import { createDocument, indexFor } from "./state.js";

const EXAMPLE_TIMESTAMP = 1_704_067_200_000;

const EXAMPLES = Object.freeze([
  Object.freeze({
    id: "2f4fe6e4-0a10-4f5a-8d3a-000000000001",
    name: "Dinosaur",
    colors: Object.freeze({ G: "#0F784B", L: "#5AC378", H: "#96D25A", B: "#B4783C" }),
    pixels: Object.freeze([
      "................",
      "................",
      "..........GG....",
      ".........GHHG...",
      "...GG...GHHHHG..",
      "..GHHG.GHHHHHG..",
      ".GHHHHGGHHHHHG..",
      ".GHHHHHHHHHHHG..",
      "..GHHHHHHHHHGG..",
      "...GHHHHHHHG....",
      "....GHHHHHGG....",
      "....GHHHHHG.....",
      "....GGHHHGG.....",
      "...G.BGGG.GG....",
      "..G..G....G.....",
      "................",
    ]),
  }),
  Object.freeze({
    id: "2f4fe6e4-0a10-4f5a-8d3a-000000000002",
    name: "Rocket",
    colors: Object.freeze({ R: "#E15A3C", O: "#FFB44B", W: "#FFF0E1", B: "#4B78C3", C: "#4BA5E1" }),
    pixels: Object.freeze([
      ".......R........",
      "......RRR.......",
      ".....RWWWR......",
      "....RWWWWWR.....",
      "....RWWWWWR.....",
      "...RWWBBWWR.....",
      "...RWWBBWWR.....",
      "..RWWWWWWWWR....",
      "..RWWWWWWWWR....",
      ".RWWWWWWWWWWR...",
      ".RRRWWWWWWRRR...",
      "...ROWWWWOR.....",
      "....ROWWOR......",
      ".....ROOR.......",
      "......CC........",
      ".....C..C.......",
    ]),
  }),
  Object.freeze({
    id: "2f4fe6e4-0a10-4f5a-8d3a-000000000003",
    name: "Music",
    colors: Object.freeze({ P: "#785AC3", V: "#B44B96", A: "#FFB44B", W: "#FFF0E1" }),
    pixels: Object.freeze([
      "................",
      "....PPPPPPPP....",
      "....PWWWWWWP....",
      "....P....VVP....",
      "....P....VVP....",
      "....P....VVP....",
      "....P....VVP....",
      ".AAA....VVP.....",
      ".A.A....VVP.....",
      ".AAA...VVVP.....",
      ".......V.V......",
      "......VVVV......",
      "......V..V......",
      "......VVVV......",
      "................",
      "................",
    ]),
  }),
]);

function pixelsFromMap(rows, colors) {
  if (rows.length !== 16 || rows.some((row) => row.length !== 16)) {
    throw new Error("Example maps must be exactly 16 by 16 cells.");
  }

  const pixels = Array(256).fill(null);
  rows.forEach((row, y) => {
    [...row].forEach((cell, x) => {
      if (cell === ".") return;
      const color = colors[cell];
      if (!color) throw new Error(`Unknown example map colour: ${cell}`);
      pixels[indexFor(x, y)] = color;
    });
  });
  return pixels;
}

/** Return fresh, editable documents suitable for seeding an empty gallery. */
export function createExampleDocuments() {
  return EXAMPLES.map((example) => createDocument({
    id: example.id,
    name: example.name,
    createdAt: EXAMPLE_TIMESTAMP,
    updatedAt: EXAMPLE_TIMESTAMP,
    pixels: pixelsFromMap(example.pixels, example.colors),
    grid: "full",
  }));
}
