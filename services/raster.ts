/**
 * raster.ts — DOM-free image primitives for the registration pipeline.
 *
 * Everything downstream of a decoded photograph works on plain typed arrays:
 * no canvas, no ImageData, no browser. That is deliberate. The mark detector
 * and the transform are the two pieces most likely to be wrong, and a Node
 * test suite can only exercise them if they do not reach for a DOM. The thin
 * canvas wrapper lives in `pageCrops.ts` and does nothing but convert.
 */

export interface Rgba {
  data: Uint8ClampedArray;   // RGBA, 4 bytes per pixel
  width: number;
  height: number;
}

export interface Gray {
  data: Uint8Array;          // 1 byte per pixel, 0 = black
  width: number;
  height: number;
}

export const toGray = ({ data, width, height }: Rgba): Gray => {
  const out = new Uint8Array(width * height);
  for (let p = 0, i = 0; p < out.length; p++, i += 4) {
    out[p] = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) | 0;
  }
  return { data: out, width, height };
};

/** Nearest-neighbour box downscale, used only to give the QR decoder a smaller image. */
export const downscaleRgba = (src: Rgba, factor: number): Rgba => {
  if (factor <= 1) return src;
  const width = Math.max(1, Math.floor(src.width / factor));
  const height = Math.max(1, Math.floor(src.height / factor));
  const data = new Uint8ClampedArray(width * height * 4);
  const step = Math.max(1, Math.round(factor));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0, n = 0;
      for (let dy = 0; dy < step; dy++) {
        const sy = y * step + dy;
        if (sy >= src.height) break;
        for (let dx = 0; dx < step; dx++) {
          const sx = x * step + dx;
          if (sx >= src.width) break;
          const i = (sy * src.width + sx) * 4;
          r += src.data[i]; g += src.data[i + 1]; b += src.data[i + 2]; n++;
        }
      }
      const o = (y * width + x) * 4;
      data[o] = r / n; data[o + 1] = g / n; data[o + 2] = b / n; data[o + 3] = 255;
    }
  }
  return { data, width, height };
};

/** A rectangular window of an RGBA image, copied out. Bounds are clamped. */
export const cropRgba = (src: Rgba, x0: number, y0: number, w: number, h: number): Rgba => {
  const ax = Math.max(0, Math.min(src.width - 1, Math.round(x0)));
  const ay = Math.max(0, Math.min(src.height - 1, Math.round(y0)));
  const width = Math.max(1, Math.min(src.width - ax, Math.round(w)));
  const height = Math.max(1, Math.min(src.height - ay, Math.round(h)));
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const from = ((ay + y) * src.width + ax) * 4;
    data.set(src.data.subarray(from, from + width * 4), y * width * 4);
  }
  return { data, width, height };
};

/**
 * Per-pixel contrast normalisation against a local mean and spread, for the QR
 * decoder only. A phone photograph taken in poor light delivers the symbol as a
 * narrow band of greys — on this capture set two sheets came in at a mean luma
 * of 64 and 96 — and jsqr's own binarizer, which works on the raw range, cannot
 * find a module grid in it. Stretching each neighbourhood to full range costs
 * one pass and is tried only after the plain image has already failed.
 *
 * Not used anywhere but the QR search: it is a decode aid, and nothing that
 * measures geometry should ever see a contrast-altered pixel.
 */
export const localNormalize = (src: Rgba, radius = 24): Rgba => {
  const gray = toGray(src);
  const { width: w, height: h } = gray;
  const sum = new Float64Array((w + 1) * (h + 1));
  const sumSq = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let rs = 0, rq = 0;
    for (let x = 0; x < w; x++) {
      const v = gray.data[y * w + x];
      rs += v; rq += v * v;
      sum[(y + 1) * (w + 1) + (x + 1)] = sum[y * (w + 1) + (x + 1)] + rs;
      sumSq[(y + 1) * (w + 1) + (x + 1)] = sumSq[y * (w + 1) + (x + 1)] + rq;
    }
  }
  const box = (t: Float64Array, ax: number, ay: number, bx: number, by: number): number =>
    t[(by + 1) * (w + 1) + (bx + 1)] - t[ay * (w + 1) + (bx + 1)]
    - t[(by + 1) * (w + 1) + ax] + t[ay * (w + 1) + ax];

  const data = new Uint8ClampedArray(w * h * 4);
  const r = Math.max(2, Math.round(radius));
  for (let y = 0; y < h; y++) {
    const ay = Math.max(0, y - r), by = Math.min(h - 1, y + r);
    for (let x = 0; x < w; x++) {
      const ax = Math.max(0, x - r), bx = Math.min(w - 1, x + r);
      const n = (bx - ax + 1) * (by - ay + 1);
      const mean = box(sum, ax, ay, bx, by) / n;
      const variance = Math.max(0, box(sumSq, ax, ay, bx, by) / n - mean * mean);
      const sd = Math.sqrt(variance);
      // A flat neighbourhood has nothing to stretch; leave it mid-grey rather
      // than amplifying its sensor noise into a false module pattern.
      const v = sd < 4
        ? 128
        : 128 + ((gray.data[y * w + x] - mean) * 64) / sd;
      const o = (y * w + x) * 4;
      data[o] = data[o + 1] = data[o + 2] = Math.max(0, Math.min(255, v));
      data[o + 3] = 255;
    }
  }
  return { data, width: w, height: h };
};

export interface RotatedGray extends Gray {
  /** Maps a point in this rotated frame back to the source image's pixel frame. */
  toSource: (x: number, y: number) => [number, number];
  /** Maps a source pixel into this rotated frame. */
  fromSource: (x: number, y: number) => [number, number];
}

/**
 * Turns the image by −theta, so an image whose content sits at +theta comes out
 * upright. The canvas grows to hold the rotated corners; nothing is cropped.
 *
 * `toSource` is the reason this returns more than a bitmap. Mark centroids are
 * found in the upright frame — that is the whole point of reorienting first,
 * because an axis-aligned search window on a page rotated even six degrees
 * misses two marks of four — but the homography must be fitted in the original
 * pixel frame, so the crop resamples the photograph exactly once instead of
 * once per stage.
 */
export const rotateGray = (src: Gray, theta: number): RotatedGray => {
  const cos = Math.cos(theta), sin = Math.sin(theta);
  const cs = { x: src.width / 2, y: src.height / 2 };

  // Corners of the source, turned by −theta, give the output extent.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of [[0, 0], [src.width, 0], [0, src.height], [src.width, src.height]]) {
    const dx = x - cs.x, dy = y - cs.y;
    const rx = cos * dx + sin * dy;
    const ry = -sin * dx + cos * dy;
    if (rx < minX) minX = rx; if (rx > maxX) maxX = rx;
    if (ry < minY) minY = ry; if (ry > maxY) maxY = ry;
  }
  const width = Math.max(1, Math.ceil(maxX - minX));
  const height = Math.max(1, Math.ceil(maxY - minY));
  const co = { x: -minX, y: -minY };

  const toSource = (x: number, y: number): [number, number] => {
    const dx = x - co.x, dy = y - co.y;
    return [cos * dx - sin * dy + cs.x, sin * dx + cos * dy + cs.y];
  };
  const fromSource = (x: number, y: number): [number, number] => {
    const dx = x - cs.x, dy = y - cs.y;
    return [cos * dx + sin * dy + co.x, -sin * dx + cos * dy + co.y];
  };

  const data = new Uint8Array(width * height).fill(255);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [sx, sy] = toSource(x + 0.5, y + 0.5);
      const ix = sx | 0, iy = sy | 0;
      if (ix < 0 || iy < 0 || ix >= src.width || iy >= src.height) continue;
      data[y * width + x] = src.data[iy * src.width + ix];
    }
  }
  return { data, width, height, toSource, fromSource };
};

/** Bilinear sample of an RGBA image; out-of-bounds reads come back white. */
export const sampleRgba = (
  src: Rgba, x: number, y: number, out: Uint8ClampedArray, at: number
): void => {
  if (x < 0 || y < 0 || x > src.width - 1 || y > src.height - 1) {
    out[at] = out[at + 1] = out[at + 2] = 255;
    out[at + 3] = 255;
    return;
  }
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, src.width - 1), y1 = Math.min(y0 + 1, src.height - 1);
  const fx = x - x0, fy = y - y0;
  for (let c = 0; c < 3; c++) {
    const a = src.data[(y0 * src.width + x0) * 4 + c];
    const b = src.data[(y0 * src.width + x1) * 4 + c];
    const d = src.data[(y1 * src.width + x0) * 4 + c];
    const e = src.data[(y1 * src.width + x1) * 4 + c];
    out[at + c] = (a * (1 - fx) + b * fx) * (1 - fy) + (d * (1 - fx) + e * fx) * fy;
  }
  out[at + 3] = 255;
};

/**
 * Adaptive binarization: a pixel is ink when it is `offset` grey levels below
 * the mean of the box of side `2 * radius + 1` around it. Computed in one pass
 * over a summed-area table, so the radius is free.
 *
 * **This replaced a per-window Otsu, and the reason is the whole point.** Otsu
 * assumes the window holds two populations and puts the threshold between them.
 * On a rendered sheet those are ink and paper and it works. On a real
 * photograph the corner window very often holds *paper and desk* — the sheet
 * does not fill the frame, and a 5 mm mark is a rounding error next to the
 * background behind it. Otsu then splits paper from desk, the whole page reads
 * as "white", and the mark it was looking for is never even a candidate. On the
 * eleven real captures that failure took four-of-four detection down to 2 of 11.
 *
 * A local mean has no such assumption: a large flat dark desk is close to its
 * own mean and produces nothing, while a small black square on paper sits far
 * below the mean of the paper around it and produces exactly one blob. The
 * radius must therefore be comfortably larger than a mark and comfortably
 * smaller than the window — see MARK_LOCAL_RADIUS_MM.
 */
export const adaptiveInk = (
  gray: Gray, x0: number, y0: number, x1: number, y1: number,
  radius: number, offset: number
): Uint8Array => {
  const w = x1 - x0, h = y1 - y0;
  const ink = new Uint8Array(w * h);
  if (w <= 0 || h <= 0) return ink;

  // Summed-area table over the window, with a zero row and column.
  const sum = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let rowSum = 0;
    for (let x = 0; x < w; x++) {
      rowSum += gray.data[(y0 + y) * gray.width + (x0 + x)];
      sum[(y + 1) * (w + 1) + (x + 1)] = sum[y * (w + 1) + (x + 1)] + rowSum;
    }
  }

  const r = Math.max(1, Math.round(radius));
  for (let y = 0; y < h; y++) {
    const ay = Math.max(0, y - r), by = Math.min(h - 1, y + r);
    for (let x = 0; x < w; x++) {
      const ax = Math.max(0, x - r), bx = Math.min(w - 1, x + r);
      const area = (bx - ax + 1) * (by - ay + 1);
      const total = sum[(by + 1) * (w + 1) + (bx + 1)]
                  - sum[ay * (w + 1) + (bx + 1)]
                  - sum[(by + 1) * (w + 1) + ax]
                  + sum[ay * (w + 1) + ax];
      const mean = total / area;
      ink[y * w + x] = gray.data[(y0 + y) * gray.width + (x0 + x)] < mean - offset ? 1 : 0;
    }
  }
  return ink;
};

/**
 * Otsu's threshold over one window. No longer used by the mark detector (see
 * `adaptiveInk` above for why) and kept because it is the right tool when the
 * window really does hold two populations — the crop-level ink measures.
 */
export const otsuThreshold = (
  gray: Gray, x0: number, y0: number, x1: number, y1: number
): number => {
  const histogram = new Uint32Array(256);
  let total = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      histogram[gray.data[y * gray.width + x]]++;
      total++;
    }
  }
  if (total === 0) return 128;

  let sum = 0;
  for (let v = 0; v < 256; v++) sum += v * histogram[v];

  let sumB = 0, wB = 0, best = 0, threshold = 128;
  for (let v = 0; v < 256; v++) {
    wB += histogram[v];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += v * histogram[v];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) { best = between; threshold = v; }
  }
  return threshold;
};
