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
  fill: number;
  aspect: number;
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
  aspectMin: number;
  aspectMax: number;
}

/** Spec 3.2, verbatim. Correct for a rendered sheet; unreachable on a phone. */
export const RASTER_TOLERANCE: MarkTolerance = {
  areaMin: 0.5, areaMax: 2.0, fillMin: 0.85, aspectMin: 0.80, aspectMax: 1.25,
};

/**
 * What the real captures actually deliver. Every bound is set below the worst
 * true mark observed across the eleven, with margin:
 *
 *   fill    observed 0.81 to 0.94   -> floor 0.72
 *   aspect  observed 0.85 to 1.26   -> band 0.70 to 1.45
 *   area    observed 0.87x to 2.06x -> band 0.35x to 3.0x
 *
 * The area band is the widest of the three on purpose. Its nominal comes from
 * the QR's own scale, and on a page held at an angle the QR is a 24 mm patch in
 * one corner whose local scale can be 25% off the far corner's, which squares
 * into a 1.6x error in the area before any real variation.
 */
export const PHOTO_TOLERANCE: MarkTolerance = {
  areaMin: 0.35, areaMax: 3.0, fillMin: 0.72, aspectMin: 0.70, aspectMax: 1.45,
};

/**
 * Local-mean radius, as a multiple of the mark's own side. It has to be
 * comfortably bigger than a mark — or the mark's interior drags the mean down
 * with it and only its edge reads as ink — and comfortably smaller than the
 * window, or the desk is back in the average.
 */
export const LOCAL_RADIUS_MARKS = 3.0;

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

  for (let start = 0; start < ink.length; start++) {
    if (!ink[start] || seen[start]) continue;
    seen[start] = 1;
    stack.length = 0;
    stack.push(start);

    let count = 0, sx = 0, sy = 0;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    while (stack.length) {
      const p = stack.pop()!;
      const px = p % w, py = (p / w) | 0;
      count++; sx += px; sy += py;
      if (px < minX) minX = px; if (px > maxX) maxX = px;
      if (py < minY) minY = py; if (py > maxY) maxY = py;

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
    const fill = count / (bw * bh);
    const aspect = bw / bh;
    if (fill < tol.fillMin || aspect < tol.aspectMin || aspect > tol.aspectMax) continue;

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
