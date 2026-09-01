/**
 * registration.ts — page-format spec section 6, stages 1 to 4.
 *
 * **The stage order is load-bearing and is not reordered for convenience.**
 * The spec establishes it by measurement, not tidiness:
 *
 *   1. Decode the QR. It is the only self-orienting element on the page; the
 *      marks are identical and unkeyed and cannot tell you which way is up.
 *   2. Reorient, the 180 degree case included. Searching for the marks on a
 *      page rotated by six degrees drops detection from 4 of 4 to 2 of 4,
 *      because the axis-aligned search windows miss. An implementation that
 *      swaps stages 2 and 3 works on clean captures and fails on real ones.
 *   3. Find the four marks (spec 3.2 — `markDetect.ts`).
 *   4. Fit the transform, and check the residual against the 1.0 mm budget.
 *
 * Stage 5 is cropping and lives in `cropRegions.ts`, because **the page is
 * never rectified**: we hold declared rectangles, so each is sampled through
 * the transform directly. N small resamples, no full-page warp.
 *
 * ## Choosing the marks is a geometry problem, not a shape problem
 *
 * The first version took the best-looking blob in each corner window and fitted
 * to those four. On the eleven real captures that gave four-of-four on 2 of 11,
 * and the reason is that no per-blob shape test can tell a 5 mm printed square
 * from a full stop, the corner of an answer box, or a mark belonging to **a
 * different sheet lying in the same photograph** — which several of these
 * captures contain.
 *
 * So each corner now contributes a shortlist and the *combination* is chosen:
 * the four points that, read as the page's mark centres, best reproject the QR
 * onto where the QR actually is. One score, three jobs. It rejects a false blob,
 * because a wrong point cannot fit the rectangle. It picks the right sheet,
 * because only one sheet's marks agree with the QR that was decoded. And it is
 * the same independent residual the page is then gated on, so what is accepted
 * is by construction the best fit available rather than whichever blob happened
 * to look squarest.
 *
 * Degradation is graded, not binary. Four marks give the full perspective fit.
 * Three give an affine fit with the fourth inferred and the page flagged. Two
 * or fewer is not a dead end the student should be shown — the caller routes
 * them to direct capture, where they photograph the answer area itself.
 */

import {
  MARK_CENTRES_MM, MARK_CORNER_NAMES, MARK_SIZE_MM, MARK_SEARCH_WINDOW_MM,
  QR_RECT_MM, RESIDUAL_MAX_MM,
} from './pageFormat';
import {
  Matrix3, Point, affineFromPoints, applyMatrix, homographyFromPoints, homographyFromQuad,
} from './homography';
import { MarkCandidate, findMarksInWindow } from './markDetect';
import { QrReading, decodePageQrCandidates } from './qrDecode';
import { Rgba, rotateGray, toGray } from './raster';

export type RegistrationStatus = 'ok' | 'degraded' | 'no_qr' | 'too_few_marks' | 'residual';

export interface RegistrationResult {
  status: RegistrationStatus;
  /** True when `transform` may be used to crop. */
  usable: boolean;
  qr: QrReading | null;
  /** Canonical page millimetres to ORIGINAL image pixels. */
  transform: Matrix3 | null;
  marksFound: number;
  /** Which of NW, NE, SW, SE were used in the fit. */
  marksDetected: string[];
  /** QR reprojection error in page millimetres — independent of the fit's inputs. */
  residualMm: number | null;
  /** Student-facing, one sentence. Empty when nothing is wrong. */
  message: string;
  /** Set only when registration threw: the exception text, for the report. */
  failureReason?: string;
  /** Which rung of the decode ladder produced the symbol, for the report. */
  foundBy?: string;
}

/** The QR symbol's four corners as canonical page millimetres. */
const QR_CORNERS_MM: Point[] = [
  { x: QR_RECT_MM.x0, y: QR_RECT_MM.y0 },
  { x: QR_RECT_MM.x1, y: QR_RECT_MM.y0 },
  { x: QR_RECT_MM.x1, y: QR_RECT_MM.y1 },
  { x: QR_RECT_MM.x0, y: QR_RECT_MM.y1 },
];
const QR_CORNER_KEYS = ['topLeft', 'topRight', 'bottomRight', 'bottomLeft'] as const;

/**
 * A three-mark fit is affine and cannot represent perspective, so holding it to
 * the four-point budget rejects pages whose crops would have been usable. It is
 * still bounded — a fit this far out is wrong, not approximate — and such a page
 * is flagged either way, which puts the crops in front of the student to judge.
 */
const DEGRADED_RESIDUAL_MAX_MM = 3.0;

/**
 * How many of the frame's square blobs each corner shortlists. Four to the
 * fourth is 256 combinations, each an 8x8 solve — nothing on a phone. Raising
 * it costs the fourth power and buys nothing measurable: on the real captures
 * the true mark is the nearest or second-nearest candidate every time.
 */
const CANDIDATES_PER_CORNER = 4;

/**
 * What a three-mark fit gives up against a four-mark one, in millimetres of
 * residual. Small, because the residual is the real evidence: this only breaks
 * ties between fits that are both good, in favour of the one that can represent
 * perspective.
 */
const DEGRADED_PENALTY_MM = 0.25;

/**
 * How far beyond the symbol the mask reaches, in millimetres — chosen so the
 * masked region is the spec 2.3 **QR keep-out**, x 166.0 to 198.0 and y 5.0 to
 * 37.0 mm, rather than the symbol alone. The symbol is x 169.9 to 193.9, y 9.0
 * to 33.0, so the keep-out is it plus about 4 mm on every side.
 *
 * No corner mark can ever be inside the keep-out — the generator refuses to
 * print anything there — so nothing real is lost, and what is gained is the
 * three finder patterns, which are 7 modules of 0.7273 mm and therefore 5.1 mm
 * squares: the same size as a registration mark, as solid, and as square.
 *
 * It cannot grow further. The NE mark's centroid is at x 201.4, only 3.4 mm
 * past the keep-out edge, and a mask that swallowed it would be worse than no
 * mask at all — that failure has already happened once here.
 */
const QR_KEEPOUT_MARGIN_MM = 4.0;

/** Straight-line fit of the page's scale from the QR alone: pixels per millimetre. */
const qrScalePxPerMm = (corners: Point[]): number => {
  const [tl, tr, br, bl] = corners;
  const wMm = QR_RECT_MM.x1 - QR_RECT_MM.x0;
  const hMm = QR_RECT_MM.y1 - QR_RECT_MM.y0;
  const wPx = (Math.hypot(tr.x - tl.x, tr.y - tl.y) + Math.hypot(br.x - bl.x, br.y - bl.y)) / 2;
  const hPx = (Math.hypot(bl.x - tl.x, bl.y - tl.y) + Math.hypot(br.x - tr.x, br.y - tr.y)) / 2;
  return (wPx / wMm + hPx / hMm) / 2;
};

/**
 * Axis-aligned bounds of the decoded symbol, with a small margin, in a given
 * frame. The margin covers the quiet zone and nothing more: the NE mark's edge
 * is 5 mm clear of the symbol, so anything generous here excludes a real mark.
 */
const qrBounds = (corners: Point[], marginPx: number) => ({
  x0: Math.min(...corners.map(c => c.x)) - marginPx,
  y0: Math.min(...corners.map(c => c.y)) - marginPx,
  x1: Math.max(...corners.map(c => c.x)) + marginPx,
  y1: Math.max(...corners.map(c => c.y)) + marginPx,
});

interface Fit {
  transform: Matrix3;
  residual: number;
  used: number[];
  degraded: boolean;
  /** Residual plus the degraded penalty — what fits are actually ordered by. */
  score: number;
}

const fail = (status: RegistrationStatus, message: string, qr: QrReading | null = null,
              marksDetected: string[] = []): RegistrationResult => ({
  status, usable: false, qr, transform: null,
  marksFound: marksDetected.length, marksDetected, residualMm: null, message,
});

/**
 * Stages 2 to 4 against ONE decoded symbol.
 *
 * Split out because a photograph can hold more than one sheet — on the real
 * capture set one does, with both symbols decoding at almost the same size —
 * and nothing about the symbols themselves says which sheet the student meant.
 * The geometry says it: run this for each, and the sheet whose four corner
 * marks actually fit is the sheet in the picture.
 */
const registerAgainstQr = (
  image: Rgba, qr: QrReading, allReadings: QrReading[]
): RegistrationResult => {
  // ---- Stage 2: reorient ----
  const upright = rotateGray(toGray(image), qr.theta);
  const inUpright = (p: Point): Point => {
    const [x, y] = upright.fromSource(p.x, p.y);
    return { x, y };
  };
  const qrUpright = QR_CORNER_KEYS.map(k => inUpright(qr.corners[k]));

  const pxPerMm = qrScalePxPerMm(qrUpright);
  if (!Number.isFinite(pxPerMm) || pxPerMm <= 0) {
    return fail('no_qr', 'That page could not be measured. Retake the photo straight on.', qr);
  }

  // ---- Stage 3: collect candidates ----
  //
  // A window has to be placed before it can be searched, and the only thing
  // available to place it with is the QR's position and scale. That is a
  // similarity estimate: right about where the page is and roughly how big,
  // silent about how it is tilted. Every blob that survives the shape tests is
  // kept as a *candidate*; which one is a mark is settled in stage 4.
  const expectedSidePx = MARK_SIZE_MM * pxPerMm;
  // **Every** symbol in the frame is masked, not just this one. A QR finder
  // pattern is 7 modules of 0.7273 mm — 5.1 mm, the same size as a registration
  // mark, as solid and as square — so the three finders of a second sheet lying
  // in the same photograph are three perfect false fiducials. Masking only the
  // sheet being registered left them in play, and on two real captures the fit
  // chose them and landed 125 mm out while reporting four marks found.
  //
  // The margin is 1 mm: the quiet zone and no more. The NE mark's own edge is
  // 5 mm clear of the symbol, so anything generous here excludes a real mark —
  // which is a failure mode this already had once.
  const exclude = allReadings.map(r =>
    qrBounds(QR_CORNER_KEYS.map(k => inUpright(r.corners[k])), QR_KEEPOUT_MARGIN_MM * pxPerMm));

  const qrTl = qrUpright[0];
  const origin = { x: qrTl.x - QR_RECT_MM.x0 * pxPerMm, y: qrTl.y - QR_RECT_MM.y0 * pxPerMm };
  const bySimilarity = (p: Point): Point =>
    ({ x: origin.x + p.x * pxPerMm, y: origin.y + p.y * pxPerMm });

  const qrCentreMm = {
    x: (QR_RECT_MM.x0 + QR_RECT_MM.x1) / 2,
    y: (QR_RECT_MM.y0 + QR_RECT_MM.y1) / 2,
  };

  /**
   * The taper is the point of this. The spec's 30 mm window is sized for a page
   * already rectified to the canonical frame. Placed on an unrectified
   * photograph from a QR-anchored estimate, that estimate's error grows with
   * distance from its anchor — on the real set the near corners land within a
   * few millimetres and the far ones 25 to 50 mm out. So the window grows with
   * the same distance rather than being uniformly loose, and never drops below
   * a floor, because the QR's own scale runs up to 10% out even at the corner
   * beside it.
   */
  const windowMm = (mm: Point): number => Math.max(
    MARK_SEARCH_WINDOW_MM + 0.35 * Math.hypot(mm.x - qrCentreMm.x, mm.y - qrCentreMm.y),
    MARK_SEARCH_WINDOW_MM * 1.5
  );

  const candidates: MarkCandidate[][] = [[], [], [], []];

  // The whole frame is searched once, rather than four windows placed from an
  // estimate. Window placement was the last thing standing between this and the
  // real captures: the window has to be positioned by the QR, the QR's scale is
  // up to 25% out on a tilted sheet, and a window that misses cannot be recovered
  // from by any amount of care further down. A frame-wide search cannot miss.
  //
  // It is affordable because the shape tests are the expensive filter and they
  // run per blob either way, and because the alternative — several overlapping
  // windows, each re-binarized — was not much cheaper.
  // Searched at three assumed mark sizes, and this is not belt-and-braces.
  // `expectedSidePx` comes from the QR's scale, which is up to 25% low on a
  // tilted sheet, and the binarizer's local-mean radius is derived from it: too
  // small a radius means the mark's own interior drags the local mean down with
  // it, the interior stops reading as ink, and the mark is not a blob at all.
  // That is what a single pass was doing — on the three captures with the
  // lowest QR scale it found one or two squares in the entire frame. Each pass
  // brings its own radius and its own area band, so a mark half again the size
  // the QR predicted is found properly by the pass that assumes it.
  const SEARCH_SCALES = [0.7, 1.0, 1.45];
  const squares: MarkCandidate[] = [];
  for (const factor of SEARCH_SCALES) {
    const found = findMarksInWindow(
      upright, { x0: 0, y0: 0, x1: upright.width, y1: upright.height },
      expectedSidePx * factor, { exclude, limit: 64 }
    );
    for (const c of found) {
      const duplicate = squares.some(e =>
        Math.hypot(e.x - c.x, e.y - c.y) < Math.max(expectedSidePx, c.width) * 0.6);
      if (!duplicate) squares.push(c);
    }
  }

  // The marks are found by their arrangement, not by where the QR predicts them.
  //
  // Ranking each corner's candidates by distance to a QR-derived prediction was
  // the previous attempt, and it fails for the same reason window placement
  // did: on a steeply tilted sheet the prediction is tens of millimetres out, so
  // it does not even order the shortlist correctly, and the combination that
  // wins is four wrong blobs — residuals of 27, 125 and 143 mm on three of the
  // real captures. The QR is a 24 mm patch in one corner. It is an excellent
  // *witness* and a poor *surveyor*, so it is used only as the former.
  //
  // Instead: take every pair of squares as a hypothetical NW and NE. That pair
  // alone fixes a rotation and a scale — the two marks are a known 186.9 mm
  // apart — and therefore predicts SW and SE to within the sheet's own
  // flatness. Each hypothesis is scored by where it puts the QR. Only the scale
  // sanity band comes from the QR, and it is deliberately loose.
  const MARK_SPAN_X_MM = MARK_CENTRES_MM[1][0] - MARK_CENTRES_MM[0][0];
  const MARK_SPAN_Y_MM = MARK_CENTRES_MM[2][1] - MARK_CENTRES_MM[0][1];

  /**
   * How far a square may sit from where the NW-NE pair predicts it, and it has
   * to grow with distance from that baseline. The pair fixes a *similarity* —
   * rotation, scale, translation — and a photographed sheet is not a similarity
   * of the page: the far edge is nearer or further from the lens, so the two
   * bottom marks land tens of millimetres from where a rigid scaling puts them.
   * Measured: 43 mm on IMG_0371, at a page height of 250 mm. A flat 14 mm
   * tolerance matched neither bottom mark on three of the captures, which left
   * only a two-point hypothesis and nothing to fit.
   */
  const matchToleranceMm = (mm: Point): number =>
    10 + 0.20 * Math.hypot(mm.x - MARK_CENTRES_MM[0][0], mm.y - MARK_CENTRES_MM[0][1]);
  /** How far the pair's implied scale may sit from the QR's, either way. */
  const SCALE_BAND = 1.6;
  /**
   * The most one side of the sheet may be foreshortened against another. A page
   * photographed at a steep angle has a far edge shorter than its near one;
   * beyond this the four points are not the corners of one sheet held at an
   * angle, they are four points from two different things.
   */
  const MAX_FORESHORTENING = 1.8;
  /** How far from horizontal the NW-NE edge may lie once the page is upright. */
  const MAX_EDGE_TILT_RAD = (25 * Math.PI) / 180;

  const hypotheses: Array<{ used: number[]; picks: MarkCandidate[] }> = [];

  for (const a of squares) {
    for (const b of squares) {
      if (a === b) continue;
      const dx = b.x - a.x, dy = b.y - a.y;
      const span = Math.hypot(dx, dy);
      if (span < expectedSidePx * 2) continue;

      const scale = span / MARK_SPAN_X_MM;
      if (scale > pxPerMm * SCALE_BAND || scale < pxPerMm / SCALE_BAND) continue;
      const theta = Math.atan2(dy, dx);
      if (Math.abs(theta) > MAX_EDGE_TILT_RAD) continue;

      // The similarity this pair implies, as a map from canonical mm.
      const cos = Math.cos(theta), sin = Math.sin(theta);
      const place = (mm: Point): Point => {
        const ux = (mm.x - MARK_CENTRES_MM[0][0]) * scale;
        const uy = (mm.y - MARK_CENTRES_MM[0][1]) * scale;
        return { x: a.x + cos * ux - sin * uy, y: a.y + sin * ux + cos * uy };
      };

      const nearest = (mm: Point): MarkCandidate | null => {
        let found: MarkCandidate | null = null;
        let bestD = matchToleranceMm(mm) * scale;
        const target = place(mm);
        for (const c of squares) {
          if (c === a || c === b) continue;
          const d = Math.hypot(c.x - target.x, c.y - target.y);
          if (d < bestD) { bestD = d; found = c; }
        }
        return found;
      };

      const sw = nearest({ x: MARK_CENTRES_MM[2][0], y: MARK_CENTRES_MM[2][1] });
      const se = nearest({ x: MARK_CENTRES_MM[3][0], y: MARK_CENTRES_MM[3][1] });
      if (sw && se && sw !== se) hypotheses.push({ used: [0, 1, 2, 3], picks: [a, b, sw, se] });
      else if (sw) hypotheses.push({ used: [0, 1, 2], picks: [a, b, sw] });
      else if (se) hypotheses.push({ used: [0, 1, 3], picks: [a, b, se] });
    }
  }

  // Keep the per-corner shortlists as a fallback for a sheet whose top edge is
  // clipped, so no NW-NE pair exists to seed a hypothesis. Ordering there is by
  // the QR prediction, which is the best available when nothing else is.
  const byPerspective = homographyFromQuad(QR_CORNERS_MM, qrUpright);
  const distanceTo = (corner: Point, c: MarkCandidate): number => {
    const a = bySimilarity(corner);
    let best = Math.hypot(a.x - c.x, a.y - c.y);
    if (byPerspective) {
      const b = applyMatrix(byPerspective, corner);
      if (Number.isFinite(b.x) && Number.isFinite(b.y)) {
        best = Math.min(best, Math.hypot(b.x - c.x, b.y - c.y));
      }
    }
    return best;
  };

  MARK_CENTRES_MM.forEach(([mmX, mmY], i) => {
    const corner = { x: mmX, y: mmY };
    candidates[i] = [...squares]
      .sort((a, b) => distanceTo(corner, a) - distanceTo(corner, b))
      .slice(0, CANDIDATES_PER_CORNER);
  });

  // ---- Stage 4: choose the combination, then fit ----
  //
  // Stage 3 produced possibilities. This picks among them by the only measure
  // that separates a registration mark from a blob that resembles one: whether
  // the four of them, read as the page's corners, put the QR where the QR is.
  const toSource = (c: MarkCandidate): Point => {
    const [x, y] = upright.toSource(c.x, c.y);
    return { x, y };
  };

  /**
   * QR reprojection error, in millimetres. The residual has to be measured
   * against something the fit did not consume: four marks through a four-point
   * solve reproject exactly by construction, so scoring a fit on its own inputs
   * reports zero for every page including a badly wrong one. The QR is the
   * independent witness — same sheet, same canonical frame, and nothing in the
   * fit has seen it.
   */
  const scoreFit = (transform: Matrix3 | null): number => {
    if (!transform) return Infinity;
    let worstPx = 0;
    for (let i = 0; i < 4; i++) {
      const p = applyMatrix(transform, QR_CORNERS_MM[i]);
      const q = qr.corners[QR_CORNER_KEYS[i]];
      const d = Math.hypot(p.x - q.x, p.y - q.y);
      if (!Number.isFinite(d)) return Infinity;
      worstPx = Math.max(worstPx, d);
    }
    return worstPx / pxPerMm;
  };

  const cornerMm = (i: number): Point => ({ x: MARK_CENTRES_MM[i][0], y: MARK_CENTRES_MM[i][1] });

  let best: Fit | null = null;

  /**
   * Do these points even look like the corners of one sheet?
   *
   * Applied before the fit, so a bad set is rejected and something else can
   * win, rather than becoming the best available answer and being reported as a
   * 125 mm residual. Two sheets in one photograph will otherwise contribute a
   * set whose members are individually plausible and collectively nonsense.
   *
   * Each observed side implies a scale, because the mark spacing is known:
   * 186.9 mm across, 250.4 mm down. Every implied scale has to sit near the
   * QR's, and near the others — perspective makes a far edge shorter than a
   * near one, but only so much.
   */
  const arrangementIsPlausible = (used: number[], picks: MarkCandidate[]): boolean => {
    const at = (corner: number): MarkCandidate | null => {
      const k = used.indexOf(corner);
      return k < 0 ? null : picks[k];
    };
    const [nw, ne, sw, se] = [at(0), at(1), at(2), at(3)];
    const scales: number[] = [];
    const side = (a: MarkCandidate | null, b: MarkCandidate | null, mm: number): void => {
      if (!a || !b) return;
      scales.push(Math.hypot(b.x - a.x, b.y - a.y) / mm);
    };
    side(nw, ne, MARK_SPAN_X_MM);
    side(sw, se, MARK_SPAN_X_MM);
    side(nw, sw, MARK_SPAN_Y_MM);
    side(ne, se, MARK_SPAN_Y_MM);
    if (scales.length < 2) return false;

    for (const s of scales) {
      if (!Number.isFinite(s) || s <= 0) return false;
      if (s > pxPerMm * SCALE_BAND || s < pxPerMm / SCALE_BAND) return false;
    }
    const lo = Math.min(...scales), hi = Math.max(...scales);
    if (hi / lo > MAX_FORESHORTENING) return false;

    // Orientation, in the upright frame: east of, and south of, as printed.
    if (nw && ne && ne.x <= nw.x) return false;
    if (sw && se && se.x <= sw.x) return false;
    if (nw && sw && sw.y <= nw.y) return false;
    if (ne && se && se.y <= ne.y) return false;
    return true;
  };

  const consider = (used: number[], picks: MarkCandidate[]): void => {
    if (!arrangementIsPlausible(used, picks)) return;
    const degraded = used.length < 4;
    const transform = degraded
      ? affineFromPoints(used.map(cornerMm), picks.map(toSource))
      : homographyFromQuad(used.map(cornerMm), picks.map(toSource));
    if (!transform) return;
    const residual = scoreFit(transform);
    if (!Number.isFinite(residual)) return;
    // **The residual decides, not the number of marks.** An earlier version
    // preferred any four-mark fit over any three-mark one, on the reasoning that
    // four measured points beat three plus an inference. That is true only when
    // the fourth point is a mark. On a capture whose bottom-left corner is
    // outside the frame there is no fourth mark to find, so the rule promoted a
    // speck of header text into the corner and took a 0.5 mm fit to a 21 mm one.
    // A small penalty keeps the original preference where it was right: between
    // two fits of comparable quality, the one that can model perspective wins.
    const score = residual + (degraded ? DEGRADED_PENALTY_MM : 0);
    if (!best || score < best.score) best = { transform, residual, used, degraded, score };
  };

  /** Every way of choosing one candidate from each named corner. */
  const enumerate = (used: number[]): void => {
    const lists = used.map(i => candidates[i]);
    if (lists.some(l => l.length === 0)) return;
    const picks: MarkCandidate[] = new Array(used.length);
    const walk = (depth: number): void => {
      if (depth === used.length) { consider(used, picks); return; }
      for (const c of lists[depth]) { picks[depth] = c; walk(depth + 1); }
    };
    walk(0);
  };

  // The arrangement hypotheses first — they are the ones that know the marks
  // are 186.9 by 250.4 mm apart.
  for (const h of hypotheses) consider(h.used, h.picks);

  // Then the QR-ordered shortlists, which only matter when no NW-NE pair was
  // found at all — a sheet with its top edge out of frame, say.
  if (!best) {
    enumerate([0, 1, 2, 3]);
    if (!best) for (const trio of [[0, 1, 2], [0, 1, 3], [0, 2, 3], [1, 2, 3]]) enumerate(trio);
  }

  const chosen: Fit | null = best;
  if (!chosen) {
    const have = candidates.filter(c => c.length > 0);
    return fail('too_few_marks',
      `Only ${have.length} of the 4 corner squares could be found on this page. Retake it flat, ` +
      'with all four corners of the paper in the photo.', qr,
      candidates.map((c, i) => (c.length ? MARK_CORNER_NAMES[i] : '')).filter(Boolean));
  }

  const marksDetected = chosen.used.map(i => MARK_CORNER_NAMES[i]);
  const missing = MARK_CORNER_NAMES.filter(n => !marksDetected.includes(n));
  const budget = chosen.degraded ? DEGRADED_RESIDUAL_MAX_MM : RESIDUAL_MAX_MM;

  if (chosen.residual > budget) {
    return {
      ...fail('residual',
        'This page did not line up accurately enough to cut the answers out of it. Retake it flat, ' +
        'from directly above, with the whole sheet in the picture.', qr, marksDetected),
      // Kept on the failure too: it is how far out the best available fit was,
      // which is what tells a second sheet in frame apart from a bad photograph.
      residualMm: chosen.residual,
    };
  }

  return {
    status: chosen.degraded ? 'degraded' : 'ok',
    usable: true,
    qr,
    transform: chosen.transform,
    marksFound: marksDetected.length,
    marksDetected,
    residualMm: chosen.residual,
    message: chosen.degraded
      ? `Only ${marksDetected.length} of the 4 corner squares were found (${missing.join(', ')} missing), ` +
        'so the crops from this page may be slightly off. Check them below.'
      : '',
  };
};

/**
 * How good a registration is, for choosing between sheets in one photograph.
 * Failures are ranked too, and by residual: when both sheets miss, the one that
 * missed by less is the one the photograph is of, and its message is the more
 * useful thing to show.
 */
const rank = (r: RegistrationResult): number => {
  const closeness = -Math.min(9999, (r.residualMm ?? 9999));
  if (r.usable) return (r.status === 'ok' ? 30000 : 20000) + closeness;
  if (r.status === 'residual') return 10000 + closeness;
  return closeness;
};

const registerPageOrThrow = (image: Rgba): RegistrationResult => {
  // ---- Stage 1: decode the QR ----
  const readings = decodePageQrCandidates(image);
  if (readings.length === 0) {
    return fail('no_qr',
      'The code in the top-right corner of the page could not be read. Retake the photo with the ' +
      'whole sheet in frame and more light on it.');
  }

  // Usually one symbol, and then this is a single pass. When a second sheet is
  // in frame, each is registered and the one whose corner marks actually fit
  // wins — the sheet the student was photographing is the one that is all there.
  let best: RegistrationResult | null = null;
  for (const qr of readings) {
    const result = registerAgainstQr(image, qr, readings);
    if (!best || rank(result) > rank(best)) best = result;
    if (best.status === 'ok') break;
  }
  const result = best as RegistrationResult;
  return result.qr ? { ...result, foundBy: result.qr.foundBy } : result;
};

/**
 * **Every path out of here returns a status the UI can render.** A student
 * holding a phone must never see a blank screen, and registration is the part
 * of this app most able to produce one: it allocates summed-area tables over a
 * multi-megapixel frame, so on a device under memory pressure the honest
 * outcome is an allocation failure, not a bad answer.
 *
 * A throw is converted to the same `no_qr` branch a failed decode takes,
 * because the student's next action is identical — take the photograph again —
 * and it is the branch the whole recovery flow is already built around. The
 * reason is carried in the result and logged, so a crash does not become
 * indistinguishable from a dark room.
 */
export const registerPage = (image: Rgba): RegistrationResult => {
  try {
    return registerPageOrThrow(image);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error('registerPage failed', err);
    return {
      ...fail('no_qr',
        'This page could not be read on this device. Retake the photo, and if it keeps happening, ' +
        'close some other apps and try again.'),
      failureReason: reason,
    };
  }
};
