/**
 * homography.ts — the four-point transform, and nothing more.
 *
 * This is the one piece of the registration pipeline that is genuinely new
 * (the QR decode and the mark detector are ports). It is a small linear solve,
 * not a computer-vision library: the CONSUME contract forbids a network fetch
 * of a wasm build, and opencv is not something to bundle for eight unknowns.
 *
 * **The page is never rectified.** We hold declared rectangles, so mapping four
 * corners each and sampling that quad is N small resamples instead of one
 * 2550 x 3300 warp — cheaper on a phone, and it never resamples a region twice.
 */

/** Row-major 3x3. Maps [x, y, 1] to a homogeneous triple. */
export type Matrix3 = readonly [
  number, number, number,
  number, number, number,
  number, number, number,
];

export interface Point { x: number; y: number }

export const applyMatrix = (m: Matrix3, p: Point): Point => {
  const w = m[6] * p.x + m[7] * p.y + m[8];
  return {
    x: (m[0] * p.x + m[1] * p.y + m[2]) / w,
    y: (m[3] * p.x + m[4] * p.y + m[5]) / w,
  };
};

/** Gaussian elimination with partial pivoting. Returns null for a singular system. */
const solve = (a: number[][], b: number[]): number[] | null => {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
    }
    if (Math.abs(m[pivot][col]) < 1e-12) return null;
    [m[col], m[pivot]] = [m[pivot], m[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = m[r][col] / m[col][col];
      if (f === 0) continue;
      for (let c = col; c <= n; c++) m[r][c] -= f * m[col][c];
    }
  }
  return m.map((row, i) => row[n] / row[i]);
};

/**
 * Direct linear transform over exactly four correspondences: the eight unknowns
 * of a perspective map with h33 fixed at 1. Four is what we have — the four
 * registration marks — so there is nothing to least-squares over.
 */
export const homographyFromQuad = (from: Point[], to: Point[]): Matrix3 | null => {
  if (from.length !== 4 || to.length !== 4) return null;
  const a: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = from[i];
    const { x: u, y: v } = to[i];
    a.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    a.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  const h = solve(a, b);
  if (!h || h.some(n => !Number.isFinite(n))) return null;
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
};

/**
 * Least-squares DLT over four or more correspondences.
 *
 * Used only to *predict where to look*: when the first pass finds fewer than
 * four marks, the marks it did find plus the QR's own four corners are enough
 * to place a much better search window than a scale-only guess can. A page
 * photographed at an angle is exactly the case where a similarity estimate puts
 * the far corner outside its window, and it is also the case a phone produces
 * most often.
 */
export const homographyFromPoints = (from: Point[], to: Point[]): Matrix3 | null => {
  if (from.length < 4 || from.length !== to.length) return null;
  const n = 8;
  const ata: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  const atb: number[] = new Array(n).fill(0);
  const accumulate = (row: number[], rhs: number): void => {
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) ata[r][c] += row[r] * row[c];
      atb[r] += row[r] * rhs;
    }
  };
  for (let i = 0; i < from.length; i++) {
    const { x, y } = from[i];
    const { x: u, y: v } = to[i];
    accumulate([x, y, 1, 0, 0, 0, -u * x, -u * y], u);
    accumulate([0, 0, 0, x, y, 1, -v * x, -v * y], v);
  }
  const h = solve(ata, atb);
  if (!h || h.some(v => !Number.isFinite(v))) return null;
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
};

/**
 * Least-squares affine over three or more correspondences, expressed as a
 * Matrix3 with a zero bottom row so callers need no second code path.
 *
 * This is the three-mark case. An affine fit cannot represent the perspective
 * of a page photographed at an angle, so a page fitted this way is **flagged**
 * — it is a usable answer with a known weakness, not an equal one.
 */
export const affineFromPoints = (from: Point[], to: Point[]): Matrix3 | null => {
  if (from.length < 3 || from.length !== to.length) return null;
  // Normal equations for [x y 1] · [a b c] = u  and  · [d e f] = v.
  const s = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const tu = [0, 0, 0], tv = [0, 0, 0];
  for (let i = 0; i < from.length; i++) {
    const row = [from[i].x, from[i].y, 1];
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) s[r][c] += row[r] * row[c];
      tu[r] += row[r] * to[i].x;
      tv[r] += row[r] * to[i].y;
    }
  }
  const abc = solve(s.map(r => [...r]), [...tu]);
  const def = solve(s.map(r => [...r]), [...tv]);
  if (!abc || !def) return null;
  if ([...abc, ...def].some(n => !Number.isFinite(n))) return null;
  return [abc[0], abc[1], abc[2], def[0], def[1], def[2], 0, 0, 1];
};

/**
 * Local pixels-per-unit of the map at a point — the average of the two axis
 * derivatives. Used to size a crop honestly: sampling a region at more pixels
 * per millimetre than the photograph actually carries invents detail and costs
 * bytes in a submission that has to reach Gradescope over a phone connection.
 */
export const localScale = (m: Matrix3, p: Point): number => {
  const o = applyMatrix(m, p);
  const dx = applyMatrix(m, { x: p.x + 1, y: p.y });
  const dy = applyMatrix(m, { x: p.x, y: p.y + 1 });
  const sx = Math.hypot(dx.x - o.x, dx.y - o.y);
  const sy = Math.hypot(dy.x - o.x, dy.y - o.y);
  return (sx + sy) / 2;
};
