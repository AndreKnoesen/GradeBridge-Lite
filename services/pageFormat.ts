/**
 * pageFormat.ts — the canonical frame of the GradeBridge page format, v1.
 *
 * **Ported subset.** The authoritative copy is
 * `GradeBridge-Assignment-Maker/services/pageFormat.ts`, which is itself a
 * transcription of `GradeBridge2026/QR Format Page/GradeBridge_Page_Format_v1.md`
 * Appendix A. Only the constants this app registers against are carried here —
 * the page, the four registration marks, the QR rectangle, and the fraction
 * helpers. Nothing about drawing a sheet is ported, because this app never
 * draws one.
 *
 * **Nothing here may be tuned.** The generator prints against these numbers and
 * this app registers a photograph against them; a change on one side silently
 * mis-crops every answer on the other. Change the spec, then both copies.
 *
 * Where the spec's prose and the Assignment Maker's TypeScript disagree, the
 * TypeScript is right and this file follows it. Specifically: spec 4.5 and the
 * Appendix A comment still describe the QR as spanning y 9.0–27.0 mm, which is
 * the superseded 18 mm symbol. It is 24 mm and runs to y = 33.0. Do not
 * reconcile those by averaging or by preferring the document.
 *
 * Coordinate system (spec 4.2): US Letter, origin TOP-LEFT, x rightward,
 * y DOWNWARD. A smaller y is higher on the page. Stored rectangles are page
 * fractions 0..1 to four decimal places.
 *
 * Naming caution: the page-format QR tag `GB1` has nothing to do with the
 * submission-JSON encryption prefixes `gb1:` / `gb2:`. Same letters, different
 * namespaces.
 */

// ---- Page ----------------------------------------------------------------
export const PAGE_W_MM = 215.9;   // US Letter
export const PAGE_H_MM = 279.4;
export const CANONICAL_DPI = 300;
export const CANONICAL_W_PX = 2550;
export const CANONICAL_H_PX = 3300;
export const PX_PER_MM = 11.8110;

// ---- Registration marks (spec 3.1) ---------------------------------------
export const MARK_SIZE_MM = 5.0;
export const MARK_CLEAR_MM = 12.0; // clear to both nearest page edges

/** Mark centres, mm, in NW, NE, SW, SE order. */
export const MARK_CENTRES_MM: ReadonlyArray<readonly [number, number]> = [
  [14.5, 14.5], [201.4, 14.5], [14.5, 264.9], [201.4, 264.9],
];

export const MARK_CORNER_NAMES = ['NW', 'NE', 'SW', 'SE'] as const;
export type MarkCorner = (typeof MARK_CORNER_NAMES)[number];

// ---- QR (spec 2.3) -------------------------------------------------------
export const QR_SIZE_MM = 24.0;
export const QR_MODULES = 33;              // version 4
/** Symbol rectangle, mm: x0, y0, x1, y1. Anchored 22 mm from the right edge, 9 mm from the top. */
export const QR_RECT_MM = { x0: 169.9, y0: 9.0, x1: 193.9, y1: 33.0 } as const;

// ---- Tolerances ----------------------------------------------------------
/** Spec 3.3: the consumer rejects a page whose fit residual exceeds this. */
export const RESIDUAL_MAX_MM = 1.0;
/** Spec 3.2: the search window placed on each predicted mark centre. */
export const MARK_SEARCH_WINDOW_MM = 30.0;

// ---- Fractions -----------------------------------------------------------

export interface RectMm { x0: number; y0: number; x1: number; y1: number }
export interface RectFr { x0: number; y0: number; x1: number; y1: number }

export const fractionRectToMm = (r: RectFr): RectMm => ({
  x0: r.x0 * PAGE_W_MM, y0: r.y0 * PAGE_H_MM,
  x1: r.x1 * PAGE_W_MM, y1: r.y1 * PAGE_H_MM,
});

export const round4 = (n: number): number => Math.round(n * 10000) / 10000;
/** The map's on-disk form: exactly four decimal places, and what the hash sees. */
export const fmt4 = (n: number): string => n.toFixed(4);
