/**
 * pageCrops.ts — the only part of the registration pipeline that touches a DOM.
 *
 * Everything above it (`registration.ts`, `markDetect.ts`, `cropRegions.ts`,
 * `homography.ts`, `raster.ts`) is plain typed arrays with no browser in sight,
 * so the two pieces most likely to be wrong — the detector and the transform —
 * are testable in Node against a capture set. This file converts, and converts
 * only.
 */

import { LayoutMap, LayoutRow, rowsForPage } from './layoutMap';
import { RegistrationResult, registerPage } from './registration';
import { CroppedRegion, cropRegions } from './cropRegions';
import { Rgba } from './raster';

export const CROP_JPEG_QUALITY = 0.9;

const decodeToRgba = async (blob: Blob): Promise<Rgba> => {
  let width = 0, height = 0;
  let draw: (ctx: CanvasRenderingContext2D) => void;
  let release = (): void => {};

  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(blob);
      width = bitmap.width; height = bitmap.height;
      draw = (ctx) => ctx.drawImage(bitmap, 0, 0);
      release = () => bitmap.close();
    } catch {
      /* fall through to the <img> path (Safari rejects some blobs here) */
    }
  }

  if (!width) {
    const url = URL.createObjectURL(blob);
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('decode failed'));
      el.src = url;
    });
    width = img.naturalWidth; height = img.naturalHeight;
    draw = (ctx) => ctx.drawImage(img, 0, 0);
    release = () => URL.revokeObjectURL(url);
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  draw!(ctx);
  release();
  const data = ctx.getImageData(0, 0, width, height).data;
  canvas.width = 0; canvas.height = 0;
  return { data, width, height };
};

export const rgbaToJpegBlob = (image: Rgba, quality = CROP_JPEG_QUALITY): Promise<Blob> => {
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d')!;
  ctx.putImageData(new ImageData(image.data, image.width, image.height), 0, 0);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        canvas.width = 0; canvas.height = 0;
        blob ? resolve(blob) : reject(new Error('encode failed'));
      },
      'image/jpeg',
      quality
    );
  });
};

export interface PageCropResult {
  registration: RegistrationResult;
  /** Empty when the page did not register, or when the map has no rows for its k. */
  crops: Array<{ row: LayoutRow; blob: Blob; flags: string[]; width: number; height: number }>;
  /** Set when the page registered but its QR disagrees with the loaded map. */
  layoutMismatch: { onPage: string; inFile: string } | null;
}

/**
 * Registers one photographed page and cuts every region the map declares for it.
 *
 * The `layout_id` check happens here and it is absolute: a page whose QR names a
 * different layout than the file the student loaded is **not cropped**. The
 * rectangles would land perfectly and carry the wrong labels, and nothing
 * downstream — not the student, not the grader, not the autograder — would see
 * an error. That is the one silent failure this whole check exists for.
 */
export const registerAndCropPage = async (
  pageBlob: Blob, map: LayoutMap | null
): Promise<PageCropResult> => {
  const image = await decodeToRgba(pageBlob);
  const registration = registerPage(image);

  if (!registration.usable || !registration.transform || !registration.qr) {
    return { registration, crops: [], layoutMismatch: null };
  }

  if (map && registration.qr.fields.layoutId !== map.computedLayoutId) {
    return {
      registration,
      crops: [],
      layoutMismatch: { onPage: registration.qr.fields.layoutId, inFile: map.computedLayoutId },
    };
  }
  if (!map) return { registration, crops: [], layoutMismatch: null };

  const rows = rowsForPage(map, registration.qr.fields.k);
  const cropped: CroppedRegion[] = cropRegions(image, registration.transform, rows);

  const crops = [];
  for (const c of cropped) {
    crops.push({
      row: c.row,
      blob: await rgbaToJpegBlob(c.image),
      flags: c.flags,
      width: c.image.width,
      height: c.image.height,
    });
  }
  return { registration, crops, layoutMismatch: null };
};
