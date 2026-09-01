/**
 * markDetect.ts — the spec 3.2 registration-mark detector.
 *
 * Ported from the Assignment Maker's `tests/templateTests.mjs` (check 8b), the
 * reference implementation of spec 3.2. The shape of the algorithm is its
 * shape: threshold, connected components, then area, **fill ratio counted in
 * PIXELS rather than contour area**, and aspect.
 *
 * ## What had to change to meet a photograph, and the measurements behind it
 *
 * The reference runs on a clean 300 dpi raster of the generated PDF, where a
 * printed 5 mm square is 59 px across and geometrically perfect. The eleven
 * real captures deliver that same square at **20 to 27 px** after the app's
 * downsample, softened by the lens, the JPEG and the paper. Three changes, each
 * measured rather than guessed:
 *
 *  1. **Binarization is adaptive, against a local mean.** It was a per-window
 *     Otsu, and Otsu splits the two populations it is given: a corner window
 *     usually holds *paper and desk*, not ink and paper, so it thresholded the
 *     sheet against the table, the page came out uniformly "white", and the
 *     mark was never a candidate at all.
 *  2. **The shape tolerances are the photograph's, not the raster's.** Every
 *     single rejection on the real set was by a hair — fill 0.83 and 0.84
 *     against a 0.85 floor, aspect 1.26 against a 1.25 ceiling, area 2.06x
 *     against a 2.0x ceiling. At 20 px a one-pixel soft edge is 5% of the fill
 *     and 4% of the aspect, so the raster numbers are not a bar a real
 *     photograph can clear. `PHOTO_TOLERANCE` widens them; `RASTER_TOLERANCE`
 *     keeps the spec's for a rendered sheet.
 *  3. **The QR is masked out.** The spec is explicit that the fill test is what
 *     stops a QR finder pattern being taken for a fiducial — and a finder is
 *     7 modules of 0.7273 mm, which is 5.1 mm, almost exactly mark-sized. That
 *     is the one false positive that matters, and after a successful decode we
 *     know precisely where the symbol is, so the caller excludes it by
 *     geometry. Removing that class by exact means is what makes relaxing the
 *     fill ratio honest rather than a weakening.
 *
 * The caller no longer takes the best blob per corner on its own merits: it
 * takes several from each and picks the combination that fits the page
 * rectangle. See `registration.ts`. A per-blob shape test cannot tell a mark
 * from a full stop; four points that form a 186.9 by 250.4 mm rectangle can.
 */

import { Gray, adaptiveInk } from './raster';

export interface MarkCandidate {
  /** Centroid in the frame the window was given in. */
  x: number;
  y: number;
  /** Foreground pixel count. */
  area: number;
  /** Pixel count over the area of the blob's MINIMUM-AREA rectangle. */
  fill: number;
  /** That rectangle's long side over its short side. Never below 1. */
  aspect: number;
  /** Axis-aligned bounds, which is all the caller uses them for. */
  width: number;
  height: number;
}

export interface MarkWindow {
  x0: number; y0: number; x1: number; y1: number;
}

export interface MarkTolerance {
  areaMin: number;
  areaMax: number;
  fillMin: number;
  /**
   * There is no `aspectMin`. `aspect` is a long side over a short one and so
   * cannot fall below 1; a floor there could never bind, and a bound that
   * cannot bind reads as protection that is not there.
   */
  aspectMax: number;
}

/** Spec 3.2, verbatim. Correct for a rendered sheet; unreachable on a phone. */
export const RASTER_TOLERANCE: MarkTolerance = {
  areaMin: 0.5, areaMax: 2.0, fillMin: 0.85, aspectMax: 1.25,
};

/**
 * What the real captures actually deliver. Every bound is set below the worst
 * true mark observed across the eleven, with margin:
 *
 *   fill    observed 0.72 to 0.95   -> floor 0.65
 *   aspect  observed 1.00 to 1.47   -> ceiling 1.80
 *   area    observed 0.56x to 3.27x -> band 0.30x to 4.0x
 *
 * The observations are the **true** marks of the twelve captures reviewed PASS,
 * identified as the four-subset that best reprojects the QR onto itself, at one
 * detector pass. Two of them set every bound between them and both are extreme
 * for a reason worth stating:
 *
 *  - `stale05` is steeply tilted. Its NW mark reads fill 0.72 and its SW aspect
 *    1.46 — a printed square photographed as a sheared parallelogram.
 *  - `cap04` is close to the lens and angled. Its NW and NE marks are squashed
 *    to aspect **1.47**, and its SW and SE marks are **3.3 times** the area the
 *    QR predicts, because the QR is 250 mm away up the page at a smaller scale.
 *
 * The bounds are placed against those worst true marks and not between them and
 * anything: on this set there is no population of false blobs to leave room
 * from, because **the shape tests are not the discriminator**. Their job is to
 * keep the candidate list small enough to enumerate exhaustively; whether four
 * blobs are the marks is settled by whether they put the QR where the QR is.
 * The one bound that is load-bearing is the aspect ceiling — `cap02`'s SW mark
 * is clipped by the frame edge to aspect 2.48, and admitting it would give a
 * sheet with three marks a four-mark fit at 0.45 mm. Worst true 1.47, clipped
 * 2.48, ceiling 1.80: inside the gap, on the strict side of centre.
 *
 * The area band is the widest of the three on purpose. Its nominal comes from
 * the QR's own scale, and on a page held at an angle the QR is a 24 mm patch in
 * one corner whose local scale can be 25% off the far corner's, which squares
 * into a 1.6x error in the area before any real variation.
 */
export const PHOTO_TOLERANCE: MarkTolerance = {
  areaMin: 0.30, areaMax: 4.0, fillMin: 0.65, aspectMax: 1.80,
};

/**
 * Local-mean radius, as a multiple of the mark's own side. It has to be
 * comfortably bigger than a mark — or the mark's interior drags the mean down
 * with it and only its edge reads as ink — and comfortably smaller than the
 * window, or the desk is back in the average.
 */
export const LOCAL_RADIUS_MARKS = 2.5;

/** Grey levels below the local mean before a pixel counts as ink. */
export const INK_OFFSET = 18;

export interface FindOptions {
  tolerance?: MarkTolerance;
  /**
   * Rectangles to ignore entirely — **every** decoded QR in the frame, with
   * margin, not just the one being registered against. A QR finder pattern is
   * 7 modules of 0.7273 mm, which is 5.1 mm: the same size as a registration
   * mark, equally solid, and equally square. Masking only the current sheet's
   * symbol leaves a second sheet's three finders in play, and on two of the
   * real captures the fit then chose three of them and landed 125 mm out.
   */
  exclude?: MarkWindow[] | null;
  /** Most candidates to return. The caller re-ranks them by geometry. */
  limit?: number;
}

const contains = (r: MarkWindow, x: number, y: number): boolean =>
  x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;

/**
 * ## Why the shape tests are measured in the blob's own frame
 *
 * They used to be measured in the image's. `fill` was the pixel count over the
 * **axis-aligned** bounding box, and that quantity is not rotation invariant: a
 * perfectly solid square turned by phi has an axis-aligned fill of
 * `1 / (cos phi + sin phi)^2`. So the 0.72 floor was, unintentionally, a
 * declaration that a mark may not be rotated by more than about 11.4 degrees —
 *
 *     0 deg 1.00   4 deg 0.88   8 deg 0.78   11 deg 0.73   15 deg 0.67
 *
 * — and the page-format spec says in as many words that rotation is not a
 * defect and the homography handles it. On `stale05`, a capture labelled
 * "tilted" and reviewed PASS, this rejected the NW mark at fill 0.71 against
 * the floor of 0.72 and the SE mark at 0.66; only the NE mark, beside the QR
 * and barely turned, survived. One square in the whole frame, no NW-NE pair, no
 * hypothesis, `too_few_marks` on a clean photograph.
 *
 * A camera maps the printed square to a rotated, sheared parallelogram, so the
 * test has to be invariant to that: `fill` is now the pixel count over the
 * **minimum-area** rectangle and `aspect` is that rectangle's own long-to-short
 * ratio. Both are unchanged for a mark lying square to the frame, and neither
 * charges a mark for the angle it was photographed at.
 *
 * **It is still a pixel count.** Spec 3.2 counts filled pixels rather than
 * contour area because contour area nearly matched a QR finder pattern; that
 * concern is about the numerator and is untouched. A finder's outer ring is 24
 * modules inside a 49-module hull, so it scores 0.49 here exactly as it did
 * before. What changes is the denominator, from a rectangle the page did not
 * choose to the one the blob did.
 *
 * The rotation invariance has to be bought on both tests or not at all. Fill
 * alone would admit a new class: a printed rule or an underline lying at 45
 * degrees has an axis-aligned aspect of 1.0 and a minimum-rectangle fill near
 * 1.0, and is caught only by the minimum rectangle's aspect.
 */

/** Convex hull of `pts` (x, y interleaved), monotone chain, counter-clockwise. */
const convexHull = (pts: Float64Array, n: number): Float64Array => {
  const idx = Array.from({ length: n }, (_, i) => i);
  idx.sort((a, b) => (pts[2 * a] - pts[2 * b]) || (pts[2 * a + 1] - pts[2 * b + 1]));
  const cross = (o: number, a: number, b: number): number =>
    (pts[2 * a] - pts[2 * o]) * (pts[2 * b + 1] - pts[2 * o + 1]) -
    (pts[2 * a + 1] - pts[2 * o + 1]) * (pts[2 * b] - pts[2 * o]);
  const hull: number[] = [];
  for (const i of idx) {
    while (hull.length >= 2 && cross(hull[hull.length - 2], hull[hull.length - 1], i) <= 0) hull.pop();
    hull.push(i);
  }
  const lower = hull.length + 1;
  for (let k = idx.length - 2; k >= 0; k--) {
    const i = idx[k];
    while (hull.length >= lower && cross(hull[hull.length - 2], hull[hull.length - 1], i) <= 0) hull.pop();
    hull.push(i);
  }
  hull.pop();
  const out = new Float64Array(hull.length * 2);
  hull.forEach((i, k) => { out[2 * k] = pts[2 * i]; out[2 * k + 1] = pts[2 * i + 1]; });
  return out;
};

/**
 * Smallest-area rectangle enclosing a convex polygon, as `[area, long, short]`.
 *
 * By the rotating-calipers theorem one of its sides lies along a hull edge, so
 * every edge is tried and the extents measured in that edge's frame. The hull
 * of a mark-sized blob is a few dozen points and the area band has already
 * thrown out everything bigger, so the quadratic loop is bounded and small.
 */
const minAreaRect = (hull: Float64Array): [number, number, number] => {
  const n = hull.length / 2;
  if (n < 3) return [0, 0, 0];
  let bestArea = Infinity, bestLong = 0, bestShort = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ex = hull[2 * j] - hull[2 * i], ey = hull[2 * j + 1] - hull[2 * i + 1];
    const len = Math.hypot(ex, ey);
    if (len < 1e-9) continue;
    const ux = ex / len, uy = ey / len;
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (let k = 0; k < n; k++) {
      const dx = hull[2 * k] - hull[2 * i], dy = hull[2 * k + 1] - hull[2 * i + 1];
      const a = ux * dx + uy * dy, b = -uy * dx + ux * dy;
      if (a < a0) a0 = a; if (a > a1) a1 = a;
      if (b < b0) b0 = b; if (b > b1) b1 = b;
    }
    const w = a1 - a0, h = b1 - b0, area = w * h;
    if (area < bestArea) {
      bestArea = area;
      bestLong = Math.max(w, h);
      bestShort = Math.min(w, h);
    }
  }
  return Number.isFinite(bestArea) ? [bestArea, bestLong, bestShort] : [0, 0, 0];
};

/**
 * Every blob in one window that could be a mark, best first.
 *
 * `expectedSidePx` is the mark's side in this image's pixels, predicted from
 * the QR's measured scale. The reference derives it from a known 300 dpi; a
 * photograph has no known scale, so it is measured — and the area band above is
 * sized for how wrong that measurement can be.
 */
export const findMarksInWindow = (
  gray: Gray, window: MarkWindow, expectedSidePx: number, options: FindOptions = {}
): MarkCandidate[] => {
  const tol = options.tolerance ?? PHOTO_TOLERANCE;
  const limit = options.limit ?? 6;

  const x0 = Math.max(0, Math.floor(window.x0));
  const y0 = Math.max(0, Math.floor(window.y0));
  const x1 = Math.min(gray.width, Math.ceil(window.x1));
  const y1 = Math.min(gray.height, Math.ceil(window.y1));
  const w = x1 - x0, h = y1 - y0;
  if (w < 3 || h < 3) return [];

  const ink = adaptiveInk(gray, x0, y0, x1, y1, expectedSidePx * LOCAL_RADIUS_MARKS, INK_OFFSET);

  const nominalArea = expectedSidePx * expectedSidePx;
  const areaMin = tol.areaMin * nominalArea;
  const areaMax = tol.areaMax * nominalArea;

  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  const found: MarkCandidate[] = [];

  // Leftmost and rightmost ink pixel of each row of the blob being filled. Every
  // other pixel of a row is interior to the hull, so these are the only ones the
  // hull can need — which keeps the point set at 4 per row rather than one per
  // pixel. `rowStamp` says which blob owns a row's entry, so the arrays are
  // allocated once per window and never cleared.
  const rowMin = new Int32Array(h);
  const rowMax = new Int32Array(h);
  const rowStamp = new Int32Array(h).fill(-1);
  const rowsTouched: number[] = [];
  let blobIndex = 0;

  for (let start = 0; start < ink.length; start++) {
    if (!ink[start] || seen[start]) continue;
    seen[start] = 1;
    stack.length = 0;
    stack.push(start);

    let count = 0, sx = 0, sy = 0;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const stamp = blobIndex++;
    rowsTouched.length = 0;

    while (stack.length) {
      const p = stack.pop()!;
      const px = p % w, py = (p / w) | 0;
      count++; sx += px; sy += py;
      if (px < minX) minX = px; if (px > maxX) maxX = px;
      if (py < minY) minY = py; if (py > maxY) maxY = py;
      if (rowStamp[py] !== stamp) {
        rowStamp[py] = stamp; rowMin[py] = px; rowMax[py] = px; rowsTouched.push(py);
      } else {
        if (px < rowMin[py]) rowMin[py] = px;
        if (px > rowMax[py]) rowMax[py] = px;
      }

      // 8-connectivity: a JPEG-softened square edge loses its 4-connected
      // corner pixels first, which splits one mark into two undersized blobs.
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = px + dx, ny = py + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const q = ny * w + nx;
          if (ink[q] && !seen[q]) { seen[q] = 1; stack.push(q); }
        }
      }
    }

    if (count < areaMin || count > areaMax) continue;
    const bw = maxX - minX + 1, bh = maxY - minY + 1;

    // The hull is taken over pixel CORNERS, not pixel centres, so that a solid
    // rectangle lying square to the frame encloses exactly `bw * bh` and scores
    // a fill of 1.0. Over centres it would enclose `(bw - 1) * (bh - 1)` and a
    // 30 px mark would score 1.07 — a fill ratio above one is a sign the
    // denominator is measuring something the numerator is not.
    const pts = new Float64Array(rowsTouched.length * 8);
    let n = 0;
    for (const py of rowsTouched) {
      const l = rowMin[py] - 0.5, r = rowMax[py] + 0.5, t = py - 0.5, b = py + 0.5;
      pts[2 * n] = l; pts[2 * n + 1] = t; n++;
      pts[2 * n] = l; pts[2 * n + 1] = b; n++;
      pts[2 * n] = r; pts[2 * n + 1] = t; n++;
      pts[2 * n] = r; pts[2 * n + 1] = b; n++;
    }
    const [rectArea, rectLong, rectShort] = minAreaRect(convexHull(pts, n));
    if (!(rectArea > 0) || !(rectShort > 0)) continue;
    const fill = count / rectArea;
    const aspect = rectLong / rectShort;
    if (fill < tol.fillMin || aspect > tol.aspectMax) continue;

    const candidate: MarkCandidate = {
      x: x0 + sx / count,
      y: y0 + sy / count,
      area: count,
      fill,
      aspect,
      width: bw,
      height: bh,
    };

    // The decoded QR's own finder patterns are 5.1 mm squares that pass every
    // shape test a 5.0 mm mark passes. They are excluded by knowing where the
    // symbol is, not by hoping a ratio separates them.
    //
    // Containment of the CENTROID, not overlap of the bounding box. The NE
    // registration mark's own edge is only 5 mm clear of the symbol, so an
    // overlap test with any margin at all swallows the very mark it is meant to
    // sit beside — which is exactly what happened, and took four-of-four
    // detection on the real set to 0 of 11.
    if (options.exclude?.some(r => contains(r, candidate.x, candidate.y))) continue;

    found.push(candidate);
  }

  // A solid square is what we want: fullest first, then nearest the nominal
  // area. This only orders the shortlist — which of them is actually a mark is
  // settled by the caller, geometrically.
  found.sort((a, b) =>
    (b.fill - a.fill) ||
    (Math.abs(a.area - nominalArea) - Math.abs(b.area - nominalArea)));

  return found.slice(0, limit);
};
