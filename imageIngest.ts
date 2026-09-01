// =====================================================
// Page image ingest — handwritten submissions
// =====================================================
// One photographed page in, one upright downsampled JPEG blob out.
// The step order is load-bearing (HANDWRITTEN_REGIONS_SPEC.md §5.2.1):
//
//   HEIC → JPEG  →  orientation normalise  →  dimension gate
//                →  stepped downsample to the OCR target  →  quality check
//
// Orientation is settled before anything else because regions are marked
// against the STORED frame: a page stored sideways would be marked sideways
// and the container would crop a different rectangle than the student drew.
//
// No dependency was added for EXIF. The orientation flag is read out of the
// JPEG's APP1 segment here and applied to the canvas ourselves. That keeps the
// app's zero-third-party-request property intact (nothing new to bundle beyond
// what already ships) and, more importantly, makes the result independent of
// per-browser decode defaults instead of trusting them.
//
// This module is used only by the handwritten page pool. The per-question
// image path in SubmissionWidget.tsx / App.tsx is deliberately untouched.
// =====================================================

import heic2any from 'heic2any';
import {
  PAGE_MAX_EDGE,
  PAGE_JPEG_QUALITY,
  PAGE_MIN_SOURCE_EDGE,
  PAGE_BLUR_WARN_VARIANCE,
  PAGE_CONTRAST_WARN_SPREAD,
} from './constants';

export interface IngestedPage {
  blob: Blob;
  /** Dimensions of the STORED image — regions denormalise against these. */
  width: number;
  height: number;
  bytes: number;
  sourceName: string;
  /** Advisory only. A warned page is still accepted. */
  warnings: string[];
}

export interface IngestResult {
  /** null when the file was rejected — `reason` then says why, in student words. */
  page: IngestedPage | null;
  sourceName: string;
  reason?: string;
}

// ---------- HEIC (shared with the per-question image path) ----------

export const isHeic = (f: File): boolean =>
  f.type === 'image/heic' || f.type === 'image/heif' ||
  /\.heic$/i.test(f.name) || /\.heif$/i.test(f.name);

/**
 * Converts a HEIC/HEIF file to a JPEG blob. Non-HEIC files pass through.
 * The default quality is the one the per-question image path has always used;
 * page ingest asks for more because the result is downsampled afterwards and
 * intermediate loss shows up in the OCR, not on screen.
 */
export const convertHeicIfNeeded = async (file: File, quality = 0.85): Promise<Blob> => {
  if (!isHeic(file)) return file;
  const result = await heic2any({ blob: file, toType: 'image/jpeg', quality });
  return Array.isArray(result) ? result[0] : (result as Blob);
};

// ---------- JPEG header: EXIF orientation + raw SOF dimensions ----------

interface JpegInfo {
  /** EXIF orientation 1–8; 1 when absent. */
  orientation: number;
  /** Raw stored pixel dimensions from the SOF marker; 0 when not found. */
  width: number;
  height: number;
}

const readExifOrientation = (view: DataView, tiffStart: number): number => {
  if (tiffStart + 8 > view.byteLength) return 1;
  const endian = view.getUint16(tiffStart);
  const little = endian === 0x4949;
  if (!little && endian !== 0x4d4d) return 1;
  if (view.getUint16(tiffStart + 2, little) !== 0x002a) return 1;

  const ifd0 = tiffStart + view.getUint32(tiffStart + 4, little);
  if (ifd0 + 2 > view.byteLength) return 1;
  const entries = view.getUint16(ifd0, little);
  for (let i = 0; i < entries; i++) {
    const entry = ifd0 + 2 + i * 12;
    if (entry + 12 > view.byteLength) break;
    if (view.getUint16(entry, little) === 0x0112) {
      const value = view.getUint16(entry + 8, little);
      return value >= 1 && value <= 8 ? value : 1;
    }
  }
  return 1;
};

/** Walks the JPEG segment chain. Returns null for anything that is not a JPEG. */
export const readJpegInfo = (buffer: ArrayBuffer): JpegInfo | null => {
  const view = new DataView(buffer);
  if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return null;

  const info: JpegInfo = { orientation: 1, width: 0, height: 0 };
  let offset = 2;
  while (offset + 4 <= view.byteLength) {
    if (view.getUint8(offset) !== 0xff) { offset++; continue; }   // resync on padding

    // A marker may be preceded by any number of 0xFF fill bytes (ITU T.81
    // B.1.1.3) and encoders do emit them — the probe image below carries three
    // before its SOF. Reading the first 0xFF as the identifier turns the next
    // two bytes into a bogus segment length, the walk jumps past the end of
    // the file, and the frame dimensions come back 0. That is silent: nothing
    // fails, the orientation cross-check just stops being available and every
    // rotated page rests on the decoder probe alone.
    let markerAt = offset + 1;
    while (markerAt < view.byteLength && view.getUint8(markerAt) === 0xff) markerAt++;
    if (markerAt >= view.byteLength) break;
    const marker = view.getUint8(markerAt);
    offset = markerAt + 1;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (marker === 0xda || marker === 0xd9) break;                // start of scan / end
    if (offset + 2 > view.byteLength) break;
    const size = view.getUint16(offset);
    if (size < 2) break;
    const segStart = offset + 2;
    const segEnd = offset + size;

    // APP1 "Exif\0\0" — the orientation flag lives in IFD0
    if (marker === 0xe1 && segStart + 6 <= view.byteLength &&
        view.getUint32(segStart) === 0x45786966 && view.getUint16(segStart + 4) === 0x0000) {
      info.orientation = readExifOrientation(view, segStart + 6);
    }

    // SOFn (frame header) carries the raw dimensions. c4/c8/cc are not frames.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (segStart + 5 <= view.byteLength) {
        info.height = view.getUint16(segStart + 1);
        info.width = view.getUint16(segStart + 3);
      }
      break;  // APP1 always precedes SOF, so both fields are settled here
    }
    offset = segEnd;
  }
  return info;
};

// ---------- decode ----------

export interface Decoded {
  source: CanvasImageSource;
  width: number;
  height: number;
  path: 'bitmap' | 'img';
  release: () => void;
}

// A 16×8 JPEG carrying EXIF orientation 6. Decoded by an engine that honours
// the flag it comes back 8×16; by one that ignores it, 16×8.
//
// This exists because asking is not reliable: Chrome reads
// `imageOrientation: 'none'` (a getter on the dictionary is invoked) and then
// returns the oriented image anyway. Guessing from the decoded dimensions only
// resolves the rotating flags 5–8 — for 3 (180°) and the mirrors the dimensions
// are identical either way, and a wrong guess there means a page stored upside
// down. So measure the engine once, on a known image, and trust the result.
//
// Exported so the test suite can assert the probe still is what it claims to
// be: an orientation-6, 16×8 JPEG. A probe that silently stopped carrying the
// flag would measure every engine as "applies it" and break flags 2/3/4.
export const ORIENTATION_PROBE_JPEG =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/4QAiRXhpZgAATU0AKgAAAAgAAQESAAMAAAABAAYAAAAAAAD/2wBDAFA3PEY8MlBGQUZaVVBf' +
  'eMiCeG5uePWvuZHI////////////////////////////////////////////////////2wBDAVVaWnhpeOuCguv/////////////' +
  '////////////////////////////////////////////////////wAARCAAIABADASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAA' +
  'AAAAAAT/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAM' +
  'AwEAAhEDEQA/ALQAf//Z';

const probeBlob = (): Blob => {
  const binary = atob(ORIENTATION_PROBE_JPEG);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: 'image/jpeg' });
};

/** Does this decode path apply the EXIF flag for us? Measured once, cached. */
const decoderApplies: Partial<Record<'bitmap' | 'img', Promise<boolean>>> = {};

const decoderAppliesExif = (path: 'bitmap' | 'img'): Promise<boolean> => {
  if (!decoderApplies[path]) {
    decoderApplies[path] = (async () => {
      try {
        const blob = probeBlob();
        if (path === 'bitmap') {
          const bitmap = await createImageBitmap(blob);
          const applied = bitmap.height > bitmap.width;
          bitmap.close();
          return applied;
        }
        const url = URL.createObjectURL(blob);
        try {
          const img = await new Promise<HTMLImageElement>((resolve, reject) => {
            const el = new Image();
            el.onload = () => resolve(el);
            el.onerror = () => reject(new Error('probe decode failed'));
            el.src = url;
          });
          return img.naturalHeight > img.naturalWidth;
        } finally {
          URL.revokeObjectURL(url);
        }
      } catch {
        // Unmeasurable: assume the modern behaviour (the decoder applies it),
        // which leaves the image as the browser would render it anywhere else.
        return true;
      }
    })();
  }
  return decoderApplies[path]!;
};

const decodeBlob = async (blob: Blob): Promise<Decoded> => {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(blob);
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        path: 'bitmap',
        release: () => bitmap.close(),
      };
    } catch {
      /* fall through to the <img> path (Safari rejects some blobs here) */
    }
  }

  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('decode failed'));
      el.src = url;
    });
    return {
      source: img,
      width: img.naturalWidth,
      height: img.naturalHeight,
      path: 'img',
      release: () => URL.revokeObjectURL(url),
    };
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
};

/**
 * Which orientation transform we still owe the image.
 *
 * Applying the flag twice is worse than not applying it at all, so this is
 * decided by measurement (the probe above), with the decoded dimensions as a
 * cross-check for the rotating flags: if the image came back swapped relative
 * to its raw SOF dimensions, the decoder has already rotated it whatever the
 * probe said.
 *
 * Exported for the orientation test suite.
 */
export const pendingOrientation = async (info: JpegInfo | null, decoded: Decoded): Promise<number> => {
  if (!info || info.orientation === 1) return 1;

  if (info.orientation >= 5 && info.width > 0 && info.height > 0 && info.width !== info.height) {
    const decoderRotated = decoded.width === info.height && decoded.height === info.width;
    return decoderRotated ? 1 : info.orientation;
  }

  return (await decoderAppliesExif(decoded.path)) ? 1 : info.orientation;
};

/**
 * Canvas transform for an EXIF flag, expressed in RAW image coordinates.
 * Exported for the orientation test suite, which checks the matrices by
 * mapping the raw corners through them.
 */
export const applyOrientation = (
  ctx: CanvasRenderingContext2D, orientation: number, w: number, h: number
): void => {
  switch (orientation) {
    case 2: ctx.transform(-1, 0, 0, 1, w, 0); break;
    case 3: ctx.transform(-1, 0, 0, -1, w, h); break;
    case 4: ctx.transform(1, 0, 0, -1, 0, h); break;
    case 5: ctx.transform(0, 1, 1, 0, 0, 0); break;
    case 6: ctx.transform(0, 1, -1, 0, h, 0); break;
    case 7: ctx.transform(0, -1, -1, 0, h, w); break;
    case 8: ctx.transform(0, -1, 1, 0, 0, w); break;
    default: break;
  }
};

const makeCanvas = (w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] => {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return [canvas, ctx];
};

/** Frees the backing store immediately rather than waiting for GC. */
const releaseCanvas = (canvas: HTMLCanvasElement): void => {
  canvas.width = 0;
  canvas.height = 0;
};

// ---------- quality heuristics ----------

/**
 * Contrast spread and a Laplacian blur estimate on a small proxy of the page.
 * Both are advisory: the point is to catch an unusable photo while the student
 * still has the paper in front of them. Thresholds are deliberately loose —
 * a false warning costs a glance, a missed blur costs a regrade.
 */
const assessQuality = (canvas: HTMLCanvasElement): string[] => {
  const warnings: string[] = [];
  const scale = Math.min(1, 400 / Math.max(canvas.width, canvas.height));
  const w = Math.max(1, Math.round(canvas.width * scale));
  const h = Math.max(1, Math.round(canvas.height * scale));

  const [proxy, ctx] = makeCanvas(w, h);
  try {
    ctx.drawImage(canvas, 0, 0, w, h);
    const { data } = ctx.getImageData(0, 0, w, h);

    const luma = new Float32Array(w * h);
    const histogram = new Uint32Array(256);
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      const y = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      luma[p] = y;
      histogram[Math.min(255, Math.max(0, Math.round(y)))]++;
    }

    // Contrast: 5th–95th percentile spread survives large flat white areas,
    // which a plain standard deviation does not.
    const total = w * h;
    const percentile = (fraction: number): number => {
      let seen = 0;
      const want = fraction * total;
      for (let v = 0; v < 256; v++) {
        seen += histogram[v];
        if (seen >= want) return v;
      }
      return 255;
    };
    const spread = percentile(0.95) - percentile(0.05);
    if (spread < PAGE_CONTRAST_WARN_SPREAD) {
      warnings.push('Low contrast — the writing may be hard to read. More even light usually fixes it.');
    }

    // Blur: variance of the Laplacian. Sharp pen strokes produce strong
    // second derivatives; a blurred page produces almost none.
    if (w > 2 && h > 2) {
      let sum = 0, sumSq = 0, n = 0;
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const i = y * w + x;
          const lap = 4 * luma[i] - luma[i - 1] - luma[i + 1] - luma[i - w] - luma[i + w];
          sum += lap;
          sumSq += lap * lap;
          n++;
        }
      }
      const variance = n > 0 ? sumSq / n - (sum / n) ** 2 : 0;
      if (variance < PAGE_BLUR_WARN_VARIANCE) {
        warnings.push('This page looks blurry — worth retaking now while you still have the paper.');
      }
    }
  } catch {
    // getImageData can fail under strict privacy settings; quality checks are
    // advisory, so a failure here must never block the upload.
  } finally {
    releaseCanvas(proxy);
  }
  return warnings;
};

// ---------- the pipeline ----------

const canvasToBlob = (canvas: HTMLCanvasElement, quality: number): Promise<Blob> =>
  new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('encode failed'))),
      'image/jpeg',
      quality
    );
  });

/**
 * Ingests one page. Resolves with a rejection reason rather than throwing for
 * the expected failures (unreadable file, page photographed too small), so the
 * caller can report per-file outcomes for a multi-file selection.
 */
export const ingestPage = async (file: File): Promise<IngestResult> => {
  const sourceName = file.name || 'page';
  const reject = (reason: string): IngestResult => ({ page: null, sourceName, reason });

  let sourceBlob: Blob;
  try {
    sourceBlob = await convertHeicIfNeeded(file, 0.92);
  } catch {
    return reject('HEIC image could not be converted. Save it as JPEG and try again.');
  }

  const info = readJpegInfo(await sourceBlob.slice(0, 256 * 1024).arrayBuffer());

  let decoded: Decoded;
  try {
    decoded = await decodeBlob(sourceBlob);
  } catch {
    return reject('This file could not be read as an image.');
  }

  try {
    const orientation = await pendingOrientation(info, decoded);
    const swap = orientation >= 5;
    const uprightW = swap ? decoded.height : decoded.width;
    const uprightH = swap ? decoded.width : decoded.height;

    if (!uprightW || !uprightH) return reject('This file could not be read as an image.');

    // Dimension gate replaces a file-size gate: we downsample anyway, so the
    // only thing worth rejecting is a photo with too few pixels to transcribe.
    const longEdge = Math.max(uprightW, uprightH);
    if (longEdge < PAGE_MIN_SOURCE_EDGE) {
      return reject(
        `Too low resolution (${uprightW}×${uprightH}). Pages need at least ${PAGE_MIN_SOURCE_EDGE} px ` +
        `on the long side — move closer, or check your camera is not set to a small size.`
      );
    }

    const targetScale = Math.min(1, PAGE_MAX_EDGE / longEdge);
    const targetW = Math.max(1, Math.round(uprightW * targetScale));
    const targetH = Math.max(1, Math.round(uprightH * targetScale));

    // Step down in halves. One naive jump from a 12 MP photo aliases 2–4 px pen
    // strokes into dotted lines — the page still looks fine and OCR quietly
    // degrades. The first step also carries the orientation transform so the
    // original is resampled exactly once.
    const halveFirst = uprightW > targetW * 2 && uprightH > targetH * 2;
    const stepW = halveFirst ? Math.round(uprightW / 2) : targetW;
    const stepH = halveFirst ? Math.round(uprightH / 2) : targetH;

    const [first, firstCtx] = makeCanvas(stepW, stepH);
    firstCtx.scale(stepW / uprightW, stepH / uprightH);
    applyOrientation(firstCtx, orientation, decoded.width, decoded.height);
    firstCtx.drawImage(decoded.source, 0, 0, decoded.width, decoded.height);
    decoded.release();

    let current = first;
    while (current.width > targetW * 2 && current.height > targetH * 2) {
      const nextW = Math.max(targetW, Math.round(current.width / 2));
      const nextH = Math.max(targetH, Math.round(current.height / 2));
      const [next, nextCtx] = makeCanvas(nextW, nextH);
      nextCtx.drawImage(current, 0, 0, nextW, nextH);
      releaseCanvas(current);
      current = next;
    }

    if (current.width !== targetW || current.height !== targetH) {
      const [last, lastCtx] = makeCanvas(targetW, targetH);
      lastCtx.drawImage(current, 0, 0, targetW, targetH);
      releaseCanvas(current);
      current = last;
    }

    const warnings = assessQuality(current);
    const blob = await canvasToBlob(current, PAGE_JPEG_QUALITY);
    releaseCanvas(current);

    return {
      sourceName,
      page: {
        blob,
        width: targetW,
        height: targetH,
        bytes: blob.size,
        sourceName,
        warnings,
      },
    };
  } catch {
    try { decoded.release(); } catch { /* already released */ }
    return reject('This page could not be processed. Try retaking or re-saving it as a JPEG.');
  }
};

// ---------- manual rotation ----------

export interface RotatedPage {
  blob: Blob;
  width: number;
  height: number;
  bytes: number;
}

/**
 * Turns a stored page a quarter turn clockwise and re-encodes it.
 *
 * This rewrites the stored bitmap rather than applying a CSS transform,
 * because the stored frame is what registration measures and what ships in the
 * submission ZIP — a display-only rotation would leave the transform fitted to
 * one bitmap and the exported page being another. Dimensions therefore swap,
 * and the caller must swap PageRef.width / PageRef.height with them, and
 * re-register the page: the marks are on the paper and the paper just moved.
 *
 * (This comment used to say the rotation matters because regions are normalised
 * against the stored frame. There are no student-drawn regions — the rectangles
 * come from the instructor's map — and the pages did not in fact ship until the
 * 2026-09-01 work order. Both halves are now true.)
 *
 * EXIF flag 6 *is* "a quarter turn clockwise" written in raw image
 * coordinates, so the ingest transform table already covers this case.
 *
 * Repeated rotation re-encodes JPEG each time. The pages are downsampled
 * photographs of pen on paper and the quality is 0.85; four turns to get back
 * where you started is not a path worth engineering around.
 */
export const rotatePageBlob = async (blob: Blob): Promise<RotatedPage> => {
  const decoded = await decodeBlob(blob);
  try {
    const { width: w, height: h } = decoded;
    if (!w || !h) throw new Error('image has no dimensions');

    const [canvas, ctx] = makeCanvas(h, w);
    applyOrientation(ctx, 6, w, h);
    ctx.drawImage(decoded.source, 0, 0, w, h);
    decoded.release();

    const rotated = await canvasToBlob(canvas, PAGE_JPEG_QUALITY);
    releaseCanvas(canvas);
    return { blob: rotated, width: h, height: w, bytes: rotated.size };
  } catch (err) {
    try { decoded.release(); } catch { /* already released */ }
    throw err;
  }
};

/** Base64 data URI → Blob, decoded locally (no fetch, no network surface). */
export const dataUriToBlob = (uri: string): Blob => {
  const comma = uri.indexOf(',');
  const meta = uri.slice(0, comma);
  const binary = atob(uri.slice(comma + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: /:(.*?);/.exec(meta)?.[1] || 'image/jpeg' });
};

export const blobToDataUri = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('read failed'));
    reader.readAsDataURL(blob);
  });

/** "2.4 MB" / "812 KB" — used by the uploader's running total. */
export const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};
