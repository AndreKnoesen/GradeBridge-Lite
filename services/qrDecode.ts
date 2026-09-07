/**
 * qrDecode.ts — stage 1 of the registration pipeline.
 *
 * ## The reader is zxing-cpp, and jsQR is why
 *
 * `jsqr` held this position because it is pure JavaScript and fetches nothing,
 * which the CONSUME contract requires. It reads **7 of the 12 good pages** in
 * the 2026-09-07 seventeen-frame corpus — five students' photographs refused for
 * no defect — and Peiqi Zhu's independent set agrees at 5 of 16.
 *
 * Four of those frames, `IMG_8575`, `IMG_8577`, `IMG_8580` and `IMG_8582`, fail
 * **every** treatment measured in `WORKORDER_SS_QR_DECODER_2026-09-08.md`: six
 * ladder rungs, five preprocessing variants, a native-resolution crop, upscaling,
 * perspective-correcting the symbol to a square, and both other pure-JavaScript
 * decoders (`@zxing/library`, `@nuintun/qrcode`) — which top out at 8 of 12.
 * Handed the symbol perfectly located, tightly cropped, quiet-zoned and
 * rectified, jsQR still refuses those four. **It is not failing to find the
 * symbol; it is failing to read it**, and nothing in front of a decoder fixes
 * that. Nor is it the images: at the size the app decodes, the four failures
 * carry QR sides of 169–177 px and region contrast of 158–192, indistinguishable
 * from the frames that read.
 *
 * So the reader is swapped and **the ladder is kept** — the ladder is sound, and
 * it rejects all three true defects (blur, steep angle, dim room) under every
 * decoder tried. `services/zxingReader.ts` carries the reader and, more
 * importantly, why the wasm is inlined into the bundle rather than fetched.
 *
 * The QR is decoded **first** because it is the only self-orienting element on
 * the page. The registration marks are four identical unkeyed squares: they can
 * say where the corners are but never which corner is which, and a sheet
 * photographed upside down looks exactly like one photographed upright until
 * something on the page says otherwise.
 *
 * ## The search is two passes, and it used to be three
 *
 * **The contrast-normalizing rung is deleted.** It rewrote every pixel of the
 * frame and then re-ran both other passes over the result, and measured across
 * all sixteen captures it decoded **nothing that the first two did not**. What
 * it did was own the whole of the over-budget time: `cap08` and `cap09`, the
 * two with no readable symbol, spent 4.5 s and 3.7 s reaching the same answer
 * they reach in 0.6 s without it. It was built on the reasoning that those two
 * are short of range rather than short of pixels, which is true, and on the hope
 * that normalizing would recover them, which measurement does not support.
 *
 * That is the policy as much as the measurement: a photograph that does not
 * decode is reshot, not rescued, and the only thing worth optimising about
 * failure is how fast it arrives.
 *
 * What remains:
 *
 *   - **The whole frame**, at native size and at half.
 *   - **Four overlapping quadrants**, native size only, run only if the first
 *     rung found nothing.
 *
 * **Measured over all 58 photographs this project holds** — the 41 in
 * `tests/captures/` plus the 2026-09-07 corpus of 17 — the first rung ends it
 * for every frame that reads: 37 at native size, 17 at half, 4 read by nothing.
 * **The quadrant rung now finds no symbol that the whole frame does not.**
 *
 * It is kept anyway, and the reason is recorded rather than assumed. Under jsQR
 * it was load-bearing: `cap04` decoded from a quadrant of the very same image
 * that failed as a whole, because a frame holding three sheets and a dark desk
 * gives a global binarizer a range in which the symbol's light and dark modules
 * land on the same side, and a tile holding mostly paper does not. zxing does
 * its own local binarization and no longer needs the help. Deleting the rung is
 * a separate decision with its own evidence — it is the only thing standing
 * between a decoder change and a page that reads today — and the cost of
 * keeping it is paid only by a photograph that has already failed.
 */

import { Rgba, cropRgba, downscaleRgba } from './raster';
import { QrFields, parsePayload } from './qrPayload';
import { Point } from './homography';
import { RawSymbol, readSymbols, qrReaderReady } from './zxingReader';

export { initQrReader, qrReaderReady } from './zxingReader';

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
 * Native size, then half. A page photographed to fill a 2200 px frame carries
 * about 5 px per QR module, and halving that is already marginal — the half pass
 * is there for a sheet that fills the frame so completely that the finder search
 * struggles, and it still earns its place under zxing: **17 of the 54 frames
 * that read need it**, including `cap06` and `cap10`. **A third pass at
 * one-third size is deleted.** No capture in the set was ever found by it.
 *
 * The half pass has a cost worth knowing about. A symbol found at 1/2 has its
 * corners multiplied by 2, so they land on even pixels — a ±1 px quantisation of
 * the seed that the mark search and the page fit inherit. On `cap06`, the
 * worst-fitting capture that passes, that is the difference between a 0.971 mm
 * residual and a 1.002 mm one, against a 1.0 mm budget.
 */
const SCALES = [1, 2];

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

const readingFrom = (attempt: Attempt, symbol: RawSymbol): QrReading | null => {
  const fields = parsePayload(symbol.text);
  // A QR that decodes but is not a GradeBridge page payload is somebody else's
  // symbol in the photograph. Keep looking rather than claiming it.
  if (!fields) return null;

  const corners = {
    topLeft: attempt.toSource(symbol.corners.topLeft),
    topRight: attempt.toSource(symbol.corners.topRight),
    bottomRight: attempt.toSource(symbol.corners.bottomRight),
    bottomLeft: attempt.toSource(symbol.corners.bottomLeft),
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

  return { payload: symbol.text, fields, corners, theta, foundBy: attempt.label };
};

/**
 * **Every** GradeBridge symbol this attempt's raster holds, not the first.
 *
 * jsQR returned at most one symbol per call, so a frame with two sheets in it
 * only yielded both because the tile rung cut them apart. zxing returns all of
 * them from one call, which is what `registration.ts` wants: it masks every
 * decoded symbol's keep-out before hunting for marks, because a neighbouring
 * sheet's three finder patterns are perfect false fiducials.
 */
const decodeAttempt = (attempt: Attempt): QrReading[] => {
  const { image } = attempt;
  if (image.width < 60 || image.height < 60) return [];

  let symbols: RawSymbol[];
  try {
    symbols = readSymbols(image);
  } catch {
    return [];
  }
  const out: QrReading[] = [];
  for (const symbol of symbols) {
    const reading = readingFrom(attempt, symbol);
    if (reading) out.push(reading);
  }
  return out;
};

/**
 * The rungs, each a lazy list of attempts. A rung is run to completion — so
 * that a frame holding two sheets yields both symbols rather than the first —
 * and the next rung is only built if the previous one yielded nothing. So a
 * well-lit photograph pays for the first rung and nothing else.
 *
 * **Running the rung to completion matters less than it did, and the reason is
 * worth writing down rather than rediscovering.** jsQR returned at most one
 * symbol per call, so a frame holding two sheets only yielded both because the
 * quadrant rung cut them apart — which is how `cap04` came to return two.
 * zxing returns every symbol it finds from one call, but measured over all 58
 * photographs it returns **one per frame**, never two, where jsQR's quadrant
 * pass on `cap04` returned two. `registration.ts` masks every decoded symbol's
 * keep-out before hunting for marks, because a neighbouring sheet's three
 * finder patterns are perfect false fiducials, so fewer symbols means less
 * masking. It has not hurt any capture in the set — `cap04` improves from 0.536
 * to 0.416 mm — but the hazard that comment describes is guarded slightly less
 * well than it was, and that is a change, not a non-event.
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
        // Native size only. The half-size tile pass is deleted with the rest
        // of the ladder: `cap04` is the one capture that needs a tile at all
        // and it decodes both of its symbols at 1/1, so the half pass never
        // found anything and was paid for on every photograph that fails.
        yield {
          image: cropRgba(source, t.x0, t.y0, t.w, t.h),
          toSource: (p) => ({ x: t.x0 + p.x, y: t.y0 + p.y }),
          label: `${tag} ${t.name} 1/1`,
        };
      }
    }
  };

  return [
    // The whole frame. Ends it for all 54 of the 58 photographs that decode.
    () => whole(image, 'image'),
    // Overlapping quadrants. Same pixels, a binarization that can see them.
    // A 3x3 grid is deleted with the normalizing rung: nothing was ever found
    // in it either, and both were paid for on every photograph that fails.
    () => tiled(image, 'image', [2]),
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
  // **Loud, not quiet.** The reader is a wasm module and building it is
  // asynchronous, so this synchronous function has a precondition it cannot
  // satisfy itself. Returning "no symbol found" when the module is simply not
  // built yet would be indistinguishable from a dark room, and a caller that
  // forgot to await `initQrReader()` would ship looking like a decoder that
  // rejects every page. `registerPage` turns this into its own message and
  // records the reason, so a wiring mistake reads as a wiring mistake.
  if (!qrReaderReady()) {
    throw new Error('QR decoder not built: initQrReader() must be awaited before decoding');
  }

  const now = options.now ?? Date.now;
  const deadline = now() + (options.budgetMs ?? QR_SEARCH_BUDGET_MS);
  const byPayload = new Map<string, QrReading>();

  for (const rung of rungs(image)) {
    // The check is between attempts rather than inside jsqr: one attempt is
    // bounded and interrupting it would mean forking the decoder.
    if (now() > deadline) break;
    for (const attempt of rung()) {
      if (now() > deadline) break;
      for (const reading of decodeAttempt(attempt)) {
        const previous = byPayload.get(reading.payload);
        // Keep the biggest instance of each symbol: it is the least foreshortened
        // read, and every geometric estimate downstream comes from its corners.
        if (!previous || symbolArea(reading) > symbolArea(previous)) {
          byPayload.set(reading.payload, reading);
        }
      }
    }
    if (byPayload.size > 0) break;
  }
  return [...byPayload.values()].sort((a, b) => symbolArea(b) - symbolArea(a));
};

export const decodePageQr = (image: Rgba): QrReading | null =>
  decodePageQrCandidates(image)[0] ?? null;
