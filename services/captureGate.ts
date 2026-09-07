/**
 * captureGate.ts — judge one photograph, at the moment it is taken.
 *
 * ## The policy
 *
 * > I am NOT interested in an app that attempts to correct or process bad
 * > images. A bad image will cause increasingly more problems, and a bad image
 * > is easy to correct upon intake. So, no need to take risk. Be conservative.
 * > — Andre, 2026-09-01
 *
 * The costs are asymmetric and the asymmetry is extreme. A **false accept**
 * propagates: a bad crop reaches the grader, the OCR reads nothing or reads
 * wrong, and the first person to find out is a student disputing a mark on work
 * they did correctly. A **false reject** costs two seconds and another
 * photograph.
 *
 * So this gate refuses rather than rescues, and **its strictness is what buys
 * the simplicity of everything downstream** — the crops, the OCR and the grader
 * are all allowed to assume clean input precisely because nothing else gets
 * through. That is why the escalating decode ladder was deleted rather than
 * tuned, and why there is no enhancement anywhere in this path: one
 * binarization, one parameter set, one pass.
 *
 * A false reject is still a defect. Being conservative is never licence to
 * reject a photograph a student should not have to take twice, and every
 * threshold below is placed against a measured worst case from the capture set
 * rather than chosen to look safe.
 *
 * ## Gate at capture time, not at submission time
 *
 * A page judged the moment it is photographed is reshot while the sheet is
 * still on the desk under the same light. A page judged after sixteen pages
 * have been taken and the papers put away is not a two-second fix, and at that
 * point the pressure to accept marginal input becomes overwhelming.
 *
 * ## What the checks are, and how they differ from the work order
 *
 * The work order specifies four checks in the order: whole sheet in frame,
 * sharpness, legibility, four marks. Three of those survive contact with the
 * sixteen captures unchanged in substance. The first does not, and the reason
 * is measured rather than argued — see `SHEET_IN_FRAME` below.
 */

import { Rgba, toGray } from './raster';
import { Matrix3, Point, applyMatrix, homographyFromQuad } from './homography';
import { RegistrationResult, registerPage } from './registration';

// See the note in registration.ts: the gate runs synchronously over a decoder
// that must be built first, and a caller should not have to go two modules
// deeper to find the initialiser.
export { initQrReader, qrReaderReady } from './registration';
import {
  PAGE_H_MM, PAGE_W_MM, QR_MODULES, QR_RECT_MM, QR_SIZE_MM, RESIDUAL_MAX_MM,
} from './pageFormat';

/**
 * ## SHEET_IN_FRAME — why there is no separate "whole sheet in frame" check
 *
 * The work order asks for one, ahead of everything else: locate the sheet the
 * QR sits on, and require all four of its corners to be inside the frame with a
 * margin. It is justified by `cap02` and `cap03`, and that justification is
 * sound — in both, the sheet runs out of the picture and only three corner
 * marks physically exist. It was built and measured, twice, and neither
 * measurement supports the check as specified.
 *
 * **Tracing the sheet by brightness does not work on these photographs.** The
 * outline was grown from the QR's quiet zone out to whatever was no longer
 * paper, bounded to a page and a third so a neighbour could not inflate it, and
 * measured as a multiple of the page's own known area at nine thresholds from
 * 0.40 to 0.85 of the paper's brightness beside the QR. There is no threshold
 * that traces the sheet. At every one of them `cap03` reads 3.8 to 4.3 pages —
 * it leaks across a bright background — while at the same settings `cap05` and
 * `stale03` collapse to 0.2 to 0.5 of a page, eaten by their own shading. The
 * populations overlap everywhere. The work order's own rule for that outcome is
 * explicit: the metric is wrong, find a better measurement, do not split the
 * difference.
 *
 * **The paper's corners are the wrong thing to measure anyway.** Given the
 * marks, the page's four corners are known exactly, so the check can be asked
 * of a real fit rather than a mask. Measured that way over all sixteen, the
 * page-corner inset from the frame edge is NEGATIVE on `cap04` (-9.0 mm),
 * `cap10` (-7.0 mm) and `stale03` (-3.7 mm) — three captures reviewed PASS,
 * which register at 0.54, 0.88 and 0.60 mm — and POSITIVE on `cap02`
 * (+20.3 mm), which is a FAIL. A check on paper corners rejects three good
 * photographs and admits a bad one. It is not that the threshold is wrong; the
 * quantity does not carry the distinction.
 *
 * What does carry it is the thing the work order's own justification names:
 * *"only three corner marks physically exist in the image."* A clipped page is
 * a **missing mark**, and a missing mark is what `CORNER_MARKS` tests. On the
 * sixteen, that check rejects `cap02` and `cap03` and no others — the exact
 * verdicts check 1 was asked for. So the two are one check here, and its
 * message names framing first, because framing is the likeliest cause and
 * "get the whole sheet in" is the action either way.
 *
 * The other half of check 1's job — bounding the mark search so a neighbouring
 * sheet cannot supply false fiducials — is done, but by geometry rather than by
 * an outline: every set of four is scored on whether it puts the decoded QR
 * where that QR actually is, so only the sheet the symbol is printed on can
 * win. `cap04` has three sheets in frame and registers at 0.54 mm.
 *
 * **This is a deviation from a written work order and it is flagged, not
 * buried.** If a sheet outline is wanted for its own sake, it needs a
 * measurement this capture set cannot give: an edge-based tracer, and
 * photographs that separate a cut-off page from a page whose blank corner is
 * merely cropped.
 */
export type GateCheckId =
  | 'page_code'
  | 'sharpness'
  | 'corner_marks'
  | 'legibility'
  | 'budget';

/**
 * Hard wall-clock ceiling for one page. Budget spent equals reject: a gate that
 * can run long is a gate a student can be stuck behind, and the honest thing to
 * do with a photograph that is taking too long to judge is to ask for another.
 *
 * Measured worst on the sixteen: 1.58 s (`cap08`, which does not decode). Every
 * capture that passes is under 1.5 s, and eleven of the twelve are under 0.7 s.
 */
export const GATE_BUDGET_MS = 2000;

/**
 * How much of that ceiling the QR search may spend.
 *
 * The decode is the only open-ended stage — everything after it is bounded by
 * the number of blobs in the frame — so it is the one that has to be told when
 * to stop. Measured across the sixteen: the slowest SUCCESSFUL decode is
 * `cap04` at 1.01 s, which needs a quadrant pass because three sheets and a
 * dark desk defeat the whole-frame binarization; the slowest failure is `cap08`
 * at 1.87 s, which is the search running to exhaustion and finding nothing.
 *
 * 1400 ms sits between them: 39% of margin over the worst real decode, and
 * below the point where giving up would push the page past its budget. A search
 * cut short here is a `page_code` rejection, which is the same answer
 * exhaustion would have reached, sooner.
 */
export const QR_DECODE_BUDGET_MS = 1400;

/**
 * Sharpness floor, measured on the QR block as mean gradient magnitude over the
 * block's own dynamic range, sampled at four points per module.
 *
 * **This threshold is not calibrated, because the capture set contains nothing
 * to calibrate it against, and that is worth stating plainly.** The check is
 * justified in the work order by `cap09`, on the report that its decoder
 * *succeeded and returned an empty string* — which would have carried an empty
 * `layout_id` into the pipeline. At the resolution the app actually works in,
 * 2200 px on the long edge, that does not reproduce: `cap09` fails to decode at
 * all, which is the safe outcome, and it never reaches this check. Nor does
 * `cap08`. So the set holds no photograph that decodes and is then blurred.
 *
 * Measured over the fourteen that do decode, the metric runs 0.129 to 0.201 and
 * does not separate anything: `cap02` and `cap03` sit at 0.131 and 0.129 while
 * `stale04`, reviewed PASS, sits at 0.133. The floor is therefore placed below
 * the worst PASS with margin and nowhere near the others. It can catch a gross
 * case and is claimed to do nothing more.
 *
 * The hazard itself is real at other scales and is guarded elsewhere and
 * cheaply: `qrPayload.PAYLOAD_RE` means an empty or foreign string can never
 * become a reading in the first place (`qrDecode.decodeAttempt`). That guard is
 * the one that would actually have caught `cap09`, and it costs one line.
 */
export const SHARPNESS_MIN = 0.10;

/**
 * The fewest corner marks a fit may be built on.
 *
 * **Three, and the residual is what does the work.** This was four until
 * 2026-09-02, on the reasoning that a three-mark fit is affine, cannot
 * represent perspective, and is allowed a 3.0 mm budget in `registration.ts`
 * because a flagged page in front of a student to judge is better than nothing
 * — whereas this gate is what lets everything downstream assume clean input.
 *
 * That reasoning holds for the 3.0 mm budget and does not hold for the count.
 * The two real photographs that settle it are both three-mark fits from the
 * same phone: `ios2_01` finds NW, NE and SE and reprojects the QR to **0.61 mm**;
 * `ios2_05` finds NE, SW and SE and reprojects it to **42.33 mm**. Three marks is
 * sometimes excellent and sometimes catastrophic, and the residual already
 * tells the two apart by a factor of seventy. A count cannot: it rejects both.
 *
 * **The residual is trustworthy on three points because it is not measured
 * against them.** `registration.scoreFit` scores a fit by where it puts the
 * decoded QR, which the fit never consumed, so a three-point solve is not
 * self-satisfying here — an affine fit through three wrong points has nothing
 * pulling it towards the symbol, which is exactly what `ios2_05`'s 42 mm is.
 *
 * So a count of four was redundant with the residual check and stricter in the
 * wrong direction: it rejected a photograph that fits to 0.61 mm while adding
 * nothing to the rejection of one that fits to 42 mm. `ios2_01` is the first time
 * this gate told a real student to reshoot a photograph that was already
 * correct, and a threshold that rejects good work is a defect of the same
 * weight as one that accepts bad work.
 *
 * **What did NOT change, and is what keeps this safe.** The budget below three
 * is unchanged — two marks or fewer cannot be fitted and the caller routes the
 * student to direct capture. The gate's own residual budget stays at
 * `RESIDUAL_MAX_MM` (1.0 mm) for three-mark fits and four-mark fits alike, so
 * the 3.0 mm degraded budget in `registration.ts` never reaches a submission
 * through here. The geometry gate on the accepted set stays, so a set that does
 * not match the printed mark spacing is still refused outright. And the
 * QR-anchored scoring stays, which is both what makes the residual meaningful
 * on three points and what stops a neighbouring sheet supplying a mark.
 *
 * A page accepted on three is still recorded as such: `marksFound` is 3 and
 * `registration.status` is `degraded`, both of which reach the submission
 * manifest as `marks_found` and `registration`, so a grader looking at a
 * disputed crop can see the page registered on three.
 */
export const MARKS_MIN = 3;

/**
 * Legibility floor: the darkest tile of the page, as a mean grey level, over an
 * 8 by 11 grid sampled through the page transform.
 *
 * Local by construction, because the defect is local. The work order is right
 * that a global mean does not see it — `cap05` and `cap08` were both called
 * "shadow" by eye, and the difference between them is that one has a soft
 * gradient and stays legible everywhere while the other has a hard edge across
 * the answer box.
 *
 * **Also uncalibrated, for the same reason**: `cap08`, the one hard-shadow
 * capture, does not decode and so never reaches here. Measured over the twelve
 * that register, the darkest page tile runs 98.3 (`stale03`) to 155.5
 * (`cap01`); the floor sits below that with roughly 30% of margin. `cap08`'s
 * whole-frame mean is 64, so it would very likely trip this — but "very likely"
 * is not a measurement and is not claimed as one.
 */
export const LEGIBILITY_MIN_TILE_LUMA = 70;

/** Tiles across and down the page for the legibility check. */
const LEGIBILITY_GRID_X = 8;
const LEGIBILITY_GRID_Y = 11;
/** Samples per tile, each way. */
const LEGIBILITY_SAMPLES = 7;

export interface GateMeasurements {
  /** Milliseconds the whole gate took. */
  ms: number;
  /** QR module size in image pixels, or null when nothing decoded. */
  qrModulePx: number | null;
  /** The sharpness metric on the QR block, or null. */
  sharpness: number | null;
  /** Darkest page tile's mean grey, or null when the page did not register. */
  minTileLuma: number | null;
  /** How many corner marks the fit used. */
  marksFound: number;
  /** QR reprojection residual in millimetres, or null. */
  residualMm: number | null;
}

export interface GateVerdict {
  /** True only when every check passed. */
  pass: boolean;
  /** The check that refused it, or null when it passed. */
  failed: GateCheckId | null;
  /** One sentence, in the student's words, naming what to do. Empty when passing. */
  message: string;
  measurements: GateMeasurements;
  /** The registration, when there is one — the transform the crops need. */
  registration: RegistrationResult | null;
}

/**
 * **Say what was observed, then what to do. Never why.**
 *
 * The app knows what it measured. It does not know what was in front of the
 * lens, and every message that named a cause was asserting more than it had:
 * "Too blurry" and "Part of the page is in shadow" are both diagnoses of a
 * photograph from a number about a photograph. A dark region might be a shadow,
 * a grey desk showing through a thin sheet, or a phone that metered for a
 * window. The student is standing there and can see which; the app cannot.
 *
 * **The hedge belongs on the diagnosis, not on the instruction.** "Take the
 * photo again" is a thing to do, not a claim about the world, and softening it
 * into "you may wish to consider" would help nobody. So each of these describes
 * an observation in the app's own terms and then gives a plain instruction.
 *
 * `page_code` and `budget` were already fact-about-the-app and are unchanged.
 */
const MESSAGES: Record<GateCheckId, string> = {
  page_code:
    'The code in the top-right corner of the page could not be read. Move somewhere brighter, ' +
    'hold the phone still, and take the photo again with the whole sheet in the picture.',
  sharpness:
    'This page does not look sharp enough to read. Hold the phone steady and take it again.',
  // Aim, not rule: the gate accepts a fit on three marks that lands inside the
  // residual budget (`MARKS_MIN`). A student who is being shown this message
  // has fewer than three or a fit that does not hold, and getting all four into
  // the frame is the action either way — but the sentence must not state a
  // requirement the gate does not enforce.
  corner_marks:
    'Get the whole page in the frame. Aim to get all four corner squares in the picture — ' +
    'shoot the whole sheet from directly above.',
  legibility:
    'Part of the page looks too dark to read. Move the page or the light and take it again.',
  budget:
    'This page took too long to check. Take the photo again with the whole sheet in the picture.',
};

const bilinear = (
  data: Uint8Array | Uint8ClampedArray, width: number, height: number, x: number, y: number,
): number => {
  const cx = Math.max(0, Math.min(width - 1, x));
  const cy = Math.max(0, Math.min(height - 1, y));
  const x0 = Math.floor(cx), y0 = Math.floor(cy);
  const x1 = Math.min(x0 + 1, width - 1), y1 = Math.min(y0 + 1, height - 1);
  const fx = cx - x0, fy = cy - y0;
  const at = (a: number, b: number): number => data[b * width + a];
  return (at(x0, y0) * (1 - fx) + at(x1, y0) * fx) * (1 - fy)
       + (at(x0, y1) * (1 - fx) + at(x1, y1) * fx) * fy;
};

const percentile = (values: number[], p: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const i = Math.floor(sorted.length * p);
  return sorted[Math.min(sorted.length - 1, Math.max(0, i))];
};

const UNIT_SQUARE: Point[] = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];

/**
 * Sharpness of the decoded symbol, sampled in the symbol's own frame.
 *
 * Measured on the QR block and not the whole frame, because the QR is fixed
 * known furniture, identical in every build, the finest detail on the page, and
 * exactly the detail that must survive for anything downstream to work. A
 * whole-frame metric measures how much ink the author put on the page as much
 * as it measures focus.
 *
 * Sampling through the symbol's own quad at a fixed number of points per module
 * is what makes the number comparable between a sheet that fills the frame and
 * one photographed from further back.
 */
const qrSharpness = (
  gray: { data: Uint8Array; width: number; height: number }, corners: Point[],
): number | null => {
  const toImage = homographyFromQuad(UNIT_SQUARE, corners);
  if (!toImage) return null;
  const n = QR_MODULES * 4;
  const patch = new Float64Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const p = applyMatrix(toImage, { x: (i + 0.5) / n, y: (j + 0.5) / n });
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
      patch[j * n + i] = bilinear(gray.data, gray.width, gray.height, p.x, p.y);
    }
  }
  const values = Array.from(patch);
  const range = Math.max(1, percentile(values, 0.95) - percentile(values, 0.05));
  let sum = 0, count = 0;
  for (let j = 1; j < n - 1; j++) {
    for (let i = 1; i < n - 1; i++) {
      const gx = (patch[j * n + i + 1] - patch[j * n + i - 1]) / 2;
      const gy = (patch[(j + 1) * n + i] - patch[(j - 1) * n + i]) / 2;
      sum += Math.hypot(gx, gy);
      count++;
    }
  }
  return count === 0 ? null : (sum / count) / range;
};

/**
 * The darkest tile of the page.
 *
 * Measured through the registration's own transform, which is why this check
 * runs after the marks rather than before them as the work order lists it. The
 * check is defined as a local measure *within the sheet outline*, and the fit
 * is the only thing in this app that produces one. The alternative — a page
 * rectangle extrapolated from the QR — was measured to land 25 to 68 mm out at
 * the far corners on a tilted sheet, so it samples the desk. Reporting the desk
 * as a shadow on the student's page would be a false reject manufactured by the
 * measurement, which is the one thing this gate must not do.
 */
const darkestPageTile = (
  gray: { data: Uint8Array; width: number; height: number }, transform: Matrix3,
): number | null => {
  let darkest = Infinity;
  for (let ty = 0; ty < LEGIBILITY_GRID_Y; ty++) {
    for (let tx = 0; tx < LEGIBILITY_GRID_X; tx++) {
      let sum = 0, count = 0, offPage = false;
      for (let sy = 0; sy < LEGIBILITY_SAMPLES && !offPage; sy++) {
        for (let sx = 0; sx < LEGIBILITY_SAMPLES; sx++) {
          const mmX = ((tx + (sx + 0.5) / LEGIBILITY_SAMPLES) / LEGIBILITY_GRID_X) * PAGE_W_MM;
          const mmY = ((ty + (sy + 0.5) / LEGIBILITY_SAMPLES) / LEGIBILITY_GRID_Y) * PAGE_H_MM;
          const p = applyMatrix(transform, { x: mmX, y: mmY });
          if (!Number.isFinite(p.x) || !Number.isFinite(p.y) ||
              p.x < 0 || p.y < 0 || p.x >= gray.width || p.y >= gray.height) {
            // A tile that falls outside the photograph is not evidence of a
            // shadow. It is the corner of the paper the student cropped, which
            // the marks have already been asked about.
            offPage = true;
            break;
          }
          sum += bilinear(gray.data, gray.width, gray.height, p.x, p.y);
          count++;
        }
      }
      if (offPage || count === 0) continue;
      darkest = Math.min(darkest, sum / count);
    }
  }
  return Number.isFinite(darkest) ? darkest : null;
};

export interface GateOptions {
  budgetMs?: number;
  /** Injectable for tests; defaults to `Date.now`. */
  now?: () => number;
  /**
   * Ceiling on the QR search alone; defaults to `QR_DECODE_BUDGET_MS`.
   *
   * **Injectable for tests, and for one reason: so a test can ask what the
   * detector decides rather than what the machine had time for.** A capture
   * whose decode lands near the 1400 ms ceiling — `ios2_04` measures 1.1 to
   * 1.8 s — reads as `too_few_marks` on an idle machine and `no_qr` on a busy
   * one, which makes a mechanism assertion about that capture a measurement of
   * the host. Nothing in the app passes this; the student path keeps the
   * constant, which is product behaviour.
   */
  decodeBudgetMs?: number;
}

/**
 * Run the gate over one already-ingested page image.
 *
 * **Every path out of here returns a verdict the UI can render.** A student
 * holding a phone must never see a blank screen, so a throw becomes a
 * rejection carrying the same instruction as a timeout: take it again. The
 * exception text is not shown to the student but is kept for the report.
 */
export const runCaptureGate = (image: Rgba, options: GateOptions = {}): GateVerdict => {
  const now = options.now ?? Date.now;
  const budget = options.budgetMs ?? GATE_BUDGET_MS;
  const started = now();

  const measurements: GateMeasurements = {
    ms: 0, qrModulePx: null, sharpness: null, minTileLuma: null,
    marksFound: 0, residualMm: null,
  };

  const done = (failed: GateCheckId | null, registration: RegistrationResult | null): GateVerdict => {
    measurements.ms = now() - started;
    return {
      pass: failed === null,
      failed,
      message: failed === null ? '' : MESSAGES[failed],
      measurements,
      registration,
    };
  };

  try {
    // Registration is one call because its own stages are ordered by necessity
    // — the QR must be decoded before the page can be stood upright, and the
    // page must be upright before the marks can be found — and the gate reads
    // its result rather than re-deriving any of it.
    const registration = registerPage(image, {
      decodeBudgetMs: options.decodeBudgetMs ?? QR_DECODE_BUDGET_MS,
    });
    measurements.marksFound = registration.marksFound;
    measurements.residualMm = registration.residualMm;

    // ---- 1. The page code reads ----
    // A payload that is not a GradeBridge page payload never becomes a reading
    // at all (`qrPayload.PAYLOAD_RE`), so reaching here with a `qr` means the
    // symbol decoded AND said what it should.
    if (!registration.qr) return done('page_code', registration);
    if (now() - started > budget) return done('budget', registration);

    const gray = toGray(image);
    const corners = [
      registration.qr.corners.topLeft, registration.qr.corners.topRight,
      registration.qr.corners.bottomRight, registration.qr.corners.bottomLeft,
    ];
    const wPx = (
      Math.hypot(corners[1].x - corners[0].x, corners[1].y - corners[0].y) +
      Math.hypot(corners[2].x - corners[3].x, corners[2].y - corners[3].y)
    ) / 2;
    const hPx = (
      Math.hypot(corners[3].x - corners[0].x, corners[3].y - corners[0].y) +
      Math.hypot(corners[2].x - corners[1].x, corners[2].y - corners[1].y)
    ) / 2;
    const pxPerMm = (wPx / (QR_RECT_MM.x1 - QR_RECT_MM.x0) + hPx / (QR_RECT_MM.y1 - QR_RECT_MM.y0)) / 2;
    measurements.qrModulePx = Number.isFinite(pxPerMm) && pxPerMm > 0
      ? (QR_SIZE_MM * pxPerMm) / QR_MODULES
      : null;

    // ---- 2. Sharpness, on the QR block ----
    const sharpness = qrSharpness(gray, corners);
    measurements.sharpness = sharpness;
    // An inconclusive measurement is a rejection, not a pass. Fail closed.
    if (sharpness === null) return done('sharpness', registration);
    if (sharpness < SHARPNESS_MIN) return done('sharpness', registration);
    if (now() - started > budget) return done('budget', registration);

    // ---- 3. Enough marks, one sheet, and a fit inside the budget ----
    // `registerPage` refuses a set whose sides do not match the printed mark
    // spacing, and refuses a fit it cannot form, so what arrives here usable is
    // three or four marks on one sheet. It is never a confident fit with a
    // large residual.
    if (!registration.usable || !registration.transform) return done('corner_marks', registration);
    if (registration.marksFound < MARKS_MIN) return done('corner_marks', registration);
    if (registration.residualMm === null || registration.residualMm > RESIDUAL_MAX_MM) {
      return done('corner_marks', registration);
    }
    if (now() - started > budget) return done('budget', registration);

    // ---- 4. Legibility across the sheet ----
    const minTileLuma = darkestPageTile(gray, registration.transform);
    measurements.minTileLuma = minTileLuma;
    if (minTileLuma === null) return done('legibility', registration);
    if (minTileLuma < LEGIBILITY_MIN_TILE_LUMA) return done('legibility', registration);

    if (now() - started > budget) return done('budget', registration);
    return done(null, registration);
  } catch (err) {
    console.error('captureGate failed', err);
    return done('budget', null);
  }
};
