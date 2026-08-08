// Perspective transform for paper-to-pixel — SPEC §15.2.
//
// A photo of a printed grid is never square on: the page is tilted, the camera
// is off to one side, and the four corners land wherever they land. A homography
// is the map that undoes exactly that, and four corner correspondences determine
// it completely.
//
// The map goes from the unit square (grid space) to the photo, so sampling a
// cell is a forward evaluation and no matrix inversion is needed:
//
//     (0,0) top-left      (1,0) top-right
//     (0,1) bottom-left   (1,1) bottom-right
//
// Pure maths, no DOM, no dependencies.

/**
 * Gaussian elimination with partial pivoting. Returns null for a singular
 * system, which here means the four corners are degenerate — three in a line,
 * or two on top of each other.
 */
export function solveLinear(matrix, rhs) {
  const n = rhs.length;
  // Work on a copy: the caller's arrays are built per call, but mutating an
  // argument is a trap waiting for the day they are not.
  const a = matrix.map((row, i) => [...row, rhs[i]]);

  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    }
    if (Math.abs(a[pivot][col]) < 1e-12) return null;
    [a[col], a[pivot]] = [a[pivot], a[col]];

    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = a[row][col] / a[col][col];
      if (factor === 0) continue;
      for (let k = col; k <= n; k++) a[row][k] -= factor * a[col][k];
    }
  }
  return a.map((row, i) => row[n] / row[i]);
}

/**
 * Is this a quad a photographed rectangle could actually have produced?
 *
 * The 8x8 solve does not protect us here: two coincident corners still give a
 * non-singular system and a perfectly "valid" map that collapses one edge to a
 * point, and crossed handles give a bow-tie that samples nonsense. A photo of a
 * rectangle is always a convex quadrilateral with real area, so require that.
 */
export function isValidQuad(quad) {
  if (!Array.isArray(quad) || quad.length !== 4) return false;
  if (quad.some((p) => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y))) return false;

  for (let i = 0; i < 4; i++) {
    for (let j = i + 1; j < 4; j++) {
      if (Math.hypot(quad[i].x - quad[j].x, quad[i].y - quad[j].y) < 1e-6) return false;
    }
  }

  // Convex and consistently wound: every turn goes the same way.
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = quad[i];
    const b = quad[(i + 1) % 4];
    const c = quad[(i + 2) % 4];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < 1e-9) return false;
    const s = Math.sign(cross);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }

  // Shoelace area, as a final guard against a vanishingly thin sliver.
  let area = 0;
  for (let i = 0; i < 4; i++) {
    const a = quad[i];
    const b = quad[(i + 1) % 4];
    area += a.x * b.y - b.x * a.y;
  }
  return Math.abs(area / 2) > 1e-6;
}

/**
 * The homography taking the unit square to `quad`, given as
 * [top-left, top-right, bottom-right, bottom-left] in photo coordinates.
 *
 * Returns the eight free coefficients [a,b,c,d,e,f,g,h]; the ninth is fixed at
 * 1, which is the usual normalisation and costs no generality.
 */
export function solveHomography(quad) {
  if (!isValidQuad(quad)) return null;

  const corners = [[0, 0], [1, 0], [1, 1], [0, 1]];
  const matrix = [];
  const rhs = [];

  for (let i = 0; i < 4; i++) {
    const [u, v] = corners[i];
    const { x, y } = quad[i];
    //  x = (a·u + b·v + c) / (g·u + h·v + 1)  ->  a·u + b·v + c − g·u·x − h·v·x = x
    matrix.push([u, v, 1, 0, 0, 0, -u * x, -v * x]);
    rhs.push(x);
    //  y = (d·u + e·v + f) / (g·u + h·v + 1)  ->  d·u + e·v + f − g·u·y − h·v·y = y
    matrix.push([0, 0, 0, u, v, 1, -u * y, -v * y]);
    rhs.push(y);
  }

  const solved = solveLinear(matrix, rhs);
  if (!solved || solved.some((n) => !Number.isFinite(n))) return null;
  return solved;
}

/** Where grid point (u, v) — both in 0..1 — lands in the photo. */
export function project(h, u, v) {
  const [a, b, c, d, e, f, g, hh] = h;
  const w = g * u + hh * v + 1;
  // A point on the horizon maps to infinity. Callers sample inside the quad, so
  // this only fires for a degenerate corner set that slipped through.
  if (Math.abs(w) < 1e-12) return null;
  return { x: (a * u + b * v + c) / w, y: (d * u + e * v + f) / w };
}
