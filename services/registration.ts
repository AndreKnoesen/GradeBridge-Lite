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
 * Most square blobs the whole frame may contribute before the enumeration is
 * cut off. The detector returns them fullest-first, so a cap keeps the best.
 *
 * On all sixteen captures the real number is four to eight, and the exhaustive
 * search over them is microseconds. The cap exists for the photograph this set
 * does not contain — a desk strewn with printed squares — where the cost is the
 * fourth power. Twenty-four gives 10,626 four-subsets, which is still a few
 * milliseconds, and a page needing the twenty-fifth-best blob is a page that
 * should be reshot.
 */
const MAX_CANDIDATES = 24;

/**
 * A trio of marks read four ways — one labelling per corner that might be the
 * missing one. Which it is cannot be told from the three points alone, so all
 * four are scored and the QR decides.
 */
const THREE_MARK_LABELLINGS: number[][] = [[1, 2, 3], [0, 2, 3], [0, 1, 3], [0, 1, 2]];

/** The printed mark spacing: 186.9 mm across the sheet, 250.4 mm down it. */
const MARK_SPAN_X_MM = MARK_CENTRES_MM[1][0] - MARK_CENTRES_MM[0][0];
const MARK_SPAN_Y_MM = MARK_CENTRES_MM[2][1] - MARK_CENTRES_MM[0][1];

/**
 * How far a set's implied scale may sit from the QR's, either way.
 *
 * Measured over the twelve captures that pass, taking the four true marks of
 * each and the four side lengths they imply: **0.87 to 1.71 times the QR's own
 * scale.** `cap04` is the 1.71, and it is not an artifact — the page is close to
 * the lens and steeply angled, so its lower edge is genuinely 1.7 times the
 * scale the QR reads in the far top corner. The previous 1.6 would have thrown
 * that capture's true mark set away, and did.
 */
const SCALE_BAND = 2.1;

/**
 * The most one side of the sheet may be foreshortened against another. Beyond
 * this the four points are not the corners of one sheet held at an angle, they
 * are four points from two different things. Measured worst on the twelve:
 * **1.49**, again `cap04`.
 */
const MAX_FORESHORTENING = 1.9;

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
  // One binarization, one assumed mark size, one pass over the frame.
  //
  // It used to be three passes at 0.7, 1.0 and 1.45 times the QR's predicted
  // mark size, because the shape tests were measured in the image's frame and a
  // mark turned or squashed by the camera failed them at its true size. Now that
  // `fill` and `aspect` are measured in the blob's own frame (`markDetect.ts`)
  // that is no longer true, and the sweep was measured to be worse than useless:
  // on all sixteen captures a single pass finds every true mark, and it finds
  // FEWER false ones — the extra passes were what gave `cap02` a four-mark set
  // at 9.5 mm and `cap03` one at 65.0 mm, both of which vanish entirely when the
  // frame is read once. It is also a third of the work, which is most of how a
  // page came in under the gate's two-second budget.
  const expectedSidePx = MARK_SIZE_MM * pxPerMm;
  // **Every** symbol in the frame is masked, not just this one. A QR finder
  // pattern is 7 modules of 0.7273 mm — 5.1 mm, the same size as a registration
  // mark, as solid and as square — so the three finders of a second sheet lying
  // in the same photograph are three perfect false fiducials. Masking only the
  // sheet being registered left them in play, and on two real captures the fit
  // chose them and landed 125 mm out while reporting four marks found.
  const exclude = allReadings.map(r =>
    qrBounds(QR_CORNER_KEYS.map(k => inUpright(r.corners[k])), QR_KEEPOUT_MARGIN_MM * pxPerMm));

  const squares = findMarksInWindow(
    upright, { x0: 0, y0: 0, x1: upright.width, y1: upright.height },
    expectedSidePx, { exclude, limit: MAX_CANDIDATES }
  );

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

  /**
   * Which of the four printed corners each of these points is, decided by where
   * they lie relative to one another rather than by where the QR guessed they
   * would be. The frame has already been turned by the QR's angle, so the page
   * is within a few degrees of upright and the extremes of the two diagonals
   * name the corners unambiguously.
   *
   * The QR is used to SCORE a set, never to place one. Ranking each corner's
   * candidates by distance to a QR-derived prediction was the previous design,
   * and it failed the way window placement failed before it: the prediction is
   * tens of millimetres out on a tilted sheet — measured at 25 mm for `stale05`'s
   * NW mark and 61 mm for its SE — so it did not even order the shortlist
   * correctly, and the combination that won was four wrong blobs.
   */
  const label = (four: MarkCandidate[]): MarkCandidate[] | null => {
    const bySum = [...four].sort((a, b) => (a.x + a.y) - (b.x + b.y));
    const byDif = [...four].sort((a, b) => (a.x - a.y) - (b.x - b.y));
    const nw = bySum[0], se = bySum[3], sw = byDif[0], ne = byDif[3];
    if (new Set([nw, ne, sw, se]).size !== 4) return null;
    return [nw, ne, sw, se];   // MARK_CENTRES_MM order
  };

  // Every four of them, and every three, scored by where they put the QR.
  //
  // Exhaustive because it is now cheap enough to be: one detector pass at one
  // scale with shape tests that no longer charge a mark for its angle returns
  // four to eight candidates on all sixteen captures, and the cap keeps the
  // worst case bounded on a photograph of a desk covered in printed squares.
  // The previous design could not afford this and paid for it — it seeded
  // hypotheses from NW-NE pairs and only fell back to enumeration when no pair
  // survived, so on `stale05`, where a three-mark hypothesis did survive, the
  // true four-mark combination was never considered at all. It scores 0.257 mm.
  const n = squares.length;
  for (let a = 0; a < n; a++) {
    for (let b = a + 1; b < n; b++) {
      for (let c = b + 1; c < n; c++) {
        for (let d = c + 1; d < n; d++) {
          const four = label([squares[a], squares[b], squares[c], squares[d]]);
          if (four) consider([0, 1, 2, 3], four);
        }
        // The same three, read four ways: any one of the corners may be the one
        // that is missing, and which it is cannot be told from the three alone.
        for (const trio of THREE_MARK_LABELLINGS) {
          consider(trio, [squares[a], squares[b], squares[c]]);
        }
      }
    }
  }

  const chosen: Fit | null = best;
  if (!chosen) {
    return fail('too_few_marks',
      'The four corner squares could not all be found on this page. Get the whole sheet in the ' +
      'picture and shoot it flat, from directly above.', qr);
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

export interface RegisterOptions {
  /**
   * Ceiling on the QR search alone. The caller owns the page's total budget and
   * the decode is the only unbounded part of this, so the caller has to be able
   * to say how much of that total the search may spend. Without it the decoder's
   * own default silently outranks the gate's ceiling, which is how a photograph
   * that cannot decode came to take longer than the budget that was supposed to
   * stop it.
   */
  decodeBudgetMs?: number;
}

const registerPageOrThrow = (image: Rgba, options: RegisterOptions): RegistrationResult => {
  // ---- Stage 1: decode the QR ----
  const readings = decodePageQrCandidates(
    image, options.decodeBudgetMs === undefined ? {} : { budgetMs: options.decodeBudgetMs });
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
export const registerPage = (image: Rgba, options: RegisterOptions = {}): RegistrationResult => {
  try {
    return registerPageOrThrow(image, options);
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
