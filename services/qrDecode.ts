/**
 * qrDecode.ts — stage 1 of the registration pipeline.
 *
 * `jsqr` is pure JavaScript with no wasm and no runtime fetch, which is the
 * whole reason it is the decoder here: the CONSUME contract is offline, and a
 * library that pulls a `.wasm` at runtime cannot satisfy it however good it is.
 * It is also already the decoder the Assignment Maker's own template self-test
 * uses, so the two ends of the contract are checked by the same reader.
 *
 * The QR is decoded **first** because it is the only self-orienting element on
 * the page. The registration marks are four identical unkeyed squares: they can
 * say where the corners are but never which corner is which, and a sheet
 * photographed upside down looks exactly like one photographed upright until
 * something on the page says otherwise.
 *
 * ## The search, and why it is a ladder
 *
 * Measured on the eleven real captures. A whole-frame pass at native size finds
 * the symbol on 8 of 11 and is nearly free, so it goes first and almost always
 * ends it. What the other three needed:
 *
 *   - **Tiles.** One sheet decodes from the top-left quadrant of the very same
 *     image that fails as a whole. Nothing is added by cropping except a
 *     different binarization: jsqr thresholds against the range it is given, and
 *     a frame holding a bright sheet and a dark desk gives it a range in which
 *     the symbol's own light and dark modules land on the same side. A tile
 *     holding mostly paper does not.
 *   - **Contrast.** Two sheets photographed at a mean luma of 64 and 96 do not
 *     decode at any scale, in any tile, at any resolution — not even from the
 *     4032 px original. They are not short of pixels, they are short of range,
 *     so the last rung normalizes locally and tries again.
 *
 * Each rung runs only when the one before it failed, so a well-lit photograph
 * pays for none of them.
 */

import jsQR from 'jsqr';
import { Rgba, cropRgba, downscaleRgba, localNormalize } from './raster';
import { QrFields, parsePayload } from './qrPayload';
import { Point } from './homography';

export interface QrReading {
  payload: string;
  fields: QrFields;
  /** Symbol corners in the ORIGINAL image's pixel frame, excluding the quiet zone. */
  corners: { topLeft: Point; topRight: Point; bottomRight: Point; bottomLeft: Point };
  /** Angle of the symbol's own x-axis in the image, radians. Rotate by −this to stand the page up. */
  theta: number;
  /** Which rung of the ladder found it, for the report. */
  foundBy: string;
}

/**
 * Native size first. A page photographed to fill a 2200 px frame carries about
 * 5 px per QR module, and halving that is already marginal — the smaller passes
 * are there for a sheet that fills the frame so completely that jsqr's finder
 * search struggles, not as the common case.
 */
const SCALES = [1, 2, 3];

/** Overlapping tiles: `grid` by `grid`, each 2/(grid+1) of the frame, 50% overlap. */
const tileWindows = (
  image: Rgba, grid: number
): Array<{ name: string; x0: number; y0: number; w: number; h: number }> => {
  const out = [];
  const w = Math.floor((2 * image.width) / (grid + 1));
  const h = Math.floor((2 * image.height) / (grid + 1));
  const stepX = Math.floor((image.width - w) / Math.max(1, grid - 1));
  const stepY = Math.floor((image.height - h) / Math.max(1, grid - 1));
  for (let gy = 0; gy < grid; gy++) {
    for (let gx = 0; gx < grid; gx++) {
      out.push({ name: `${grid}x${grid}[${gx},${gy}]`, x0: gx * stepX, y0: gy * stepY, w, h });
    }
  }
  return out;
};

interface Attempt {
  image: Rgba;
  /** Maps a point in this attempt's frame back to the original image. */
  toSource: (p: { x: number; y: number }) => Point;
  label: string;
}

const decodeAttempt = (attempt: Attempt): QrReading | null => {
  const { image } = attempt;
  if (image.width < 60 || image.height < 60) return null;

  let result: ReturnType<typeof jsQR>;
  try {
    result = jsQR(image.data, image.width, image.height, { inversionAttempts: 'attemptBoth' });
  } catch {
    return null;
  }
  if (!result) return null;

  const fields = parsePayload(result.data);
  // A QR that decodes but is not a GradeBridge page payload is somebody else's
  // symbol in the photograph. Keep looking rather than claiming it.
  if (!fields) return null;

  const corners = {
    topLeft: attempt.toSource(result.location.topLeftCorner),
    topRight: attempt.toSource(result.location.topRightCorner),
    bottomRight: attempt.toSource(result.location.bottomRightCorner),
    bottomLeft: attempt.toSource(result.location.bottomLeftCorner),
  };

  // Both edges of the symbol vote on the angle, so a single mis-located corner
  // cannot swing it. The 180 degree case needs no special handling here and
  // must not get any: the symbol is self-orienting, so a flipped sheet simply
  // reports theta near pi.
  const top = Math.atan2(corners.topRight.y - corners.topLeft.y, corners.topRight.x - corners.topLeft.x);
  const bottom = Math.atan2(corners.bottomRight.y - corners.bottomLeft.y, corners.bottomRight.x - corners.bottomLeft.x);
  const theta = Math.atan2(
    (Math.sin(top) + Math.sin(bottom)) / 2,
    (Math.cos(top) + Math.cos(bottom)) / 2
  );

  return { payload: result.data, fields, corners, theta, foundBy: attempt.label };
};

/**
 * The rungs, each a lazy list of attempts. A rung is run to completion — so
 * that a frame holding two sheets yields both symbols rather than the first —
 * and the next rung is only built if the previous one yielded nothing. That
 * matters: rung 3 rewrites every pixel of the image, and a well-lit photograph
 * must never pay for it.
 */
const rungs = (image: Rgba): Array<() => Generator<Attempt>> => {
  const whole = function* (source: Rgba, tag: string): Generator<Attempt> {
    for (const scale of SCALES) {
      const scaled = scale === 1 ? source : downscaleRgba(source, scale);
      yield {
        image: scaled,
        toSource: (p) => ({ x: p.x * scale, y: p.y * scale }),
        label: `${tag} full 1/${scale}`,
      };
    }
  };

  const tiled = function* (source: Rgba, tag: string, grids: number[]): Generator<Attempt> {
    for (const grid of grids) {
      for (const t of tileWindows(source, grid)) {
        const tile = cropRgba(source, t.x0, t.y0, t.w, t.h);
        for (const scale of [1, 2]) {
          const scaled = scale === 1 ? tile : downscaleRgba(tile, scale);
          yield {
            image: scaled,
            toSource: (p) => ({ x: t.x0 + p.x * scale, y: t.y0 + p.y * scale }),
            label: `${tag} ${t.name} 1/${scale}`,
          };
        }
      }
    }
  };

  return [
    // Rung 1 — the whole frame. Ends it for 8 of the 11 real captures.
    () => whole(image, 'image'),
    // Rung 2 — overlapping tiles. Same pixels, a binarization that can see them.
    () => tiled(image, 'image', [2, 3]),
    // Rung 3 — both of the above on a locally contrast-normalized copy. Last
    // resort, and the only expensive one.
    function* () {
      const normalized = localNormalize(image);
      yield* whole(normalized, 'normalized');
      yield* tiled(normalized, 'normalized', [2, 3]);
    },
  ];
};

/** Signed area of the decoded symbol's quad, in this image's pixels. */
const symbolArea = (r: QrReading): number => {
  const { topLeft: a, topRight: b, bottomRight: c, bottomLeft: d } = r.corners;
  return Math.abs(
    (a.x * b.y - b.x * a.y) + (b.x * c.y - c.x * b.y) +
    (c.x * d.y - d.x * c.y) + (d.x * a.y - a.x * d.y)
  ) / 2;
};

/**
 * Every distinct GradeBridge page symbol in the photograph, largest first.
 *
 * There can be more than one, and on this capture set there is: a student
 * photographing page 3 caught the edge of page 2 lying beside it, and **both
 * symbols decode, at almost the same size**. Returning the first hit picked the
 * clipped sheet, whose corners are outside the frame, and the page failed.
 *
 * Which one is the subject of the photograph is not a question the decoder can
 * answer, so it does not try: it hands the caller all of them, and the caller —
 * which is about to fit a page rectangle to each — decides by whether the marks
 * agree. Ordering by symbol area only makes the usual case come first.
 */
/**
 * Wall-clock ceiling on the whole search, in milliseconds.
 *
 * **Failure is a supported branch, not something to search harder for.** The
 * ladder existed without a ceiling and the two captures with no readable symbol
 * ran it to exhaustion — 63 s and 47 s on a desktop, and a phone is several
 * times slower again. A student photographing ten pages cannot spend that on
 * two of them only to be told to reshoot anyway.
 *
 * A page that decodes almost always does so on the first rung, well inside a
 * second, so this budget is not a quality trade for the common case: it is
 * strictly a cap on how long giving up takes. When it expires the caller gets
 * whatever was found, which is usually nothing, and the student is asked for a
 * better photograph — the same outcome as before, minutes sooner.
 */
export const QR_SEARCH_BUDGET_MS = 3500;

export interface DecodeOptions {
  budgetMs?: number;
  /** Injectable for tests; defaults to `Date.now`. */
  now?: () => number;
}

export const decodePageQrCandidates = (
  image: Rgba, options: DecodeOptions = {}
): QrReading[] => {
  const now = options.now ?? Date.now;
  const deadline = now() + (options.budgetMs ?? QR_SEARCH_BUDGET_MS);
  const byPayload = new Map<string, QrReading>();

  for (const rung of rungs(image)) {
    // The check is between attempts rather than inside jsqr: one attempt is
    // bounded and interrupting it would mean forking the decoder.
    if (now() > deadline) break;
    for (const attempt of rung()) {
      if (now() > deadline) break;
      const reading = decodeAttempt(attempt);
      if (!reading) continue;
      const previous = byPayload.get(reading.payload);
      // Keep the biggest instance of each symbol: it is the least foreshortened
      // read, and every geometric estimate downstream comes from its corners.
      if (!previous || symbolArea(reading) > symbolArea(previous)) {
        byPayload.set(reading.payload, reading);
      }
    }
    if (byPayload.size > 0) break;
  }
  return [...byPayload.values()].sort((a, b) => symbolArea(b) - symbolArea(a));
};

export const decodePageQr = (image: Rgba): QrReading | null =>
  decodePageQrCandidates(image)[0] ?? null;
