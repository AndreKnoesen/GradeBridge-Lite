// =====================================================
// The real capture set — eleven phone photographs of a printed sheet
// =====================================================
// This is the section 8 evidence. The synthetic set in captureSet.mjs is not,
// and where the two disagree these files win.
//
// **Registration never sees the original.** A photograph off this phone is
// 4032 x 3024 with an EXIF orientation flag, and `imageIngest.ingestPage`
// stands it upright, steps it down to PAGE_MAX_EDGE on the long edge and
// re-encodes it at PAGE_JPEG_QUALITY before anything else touches it. So does
// this module. Measuring the detector on the untouched original would be
// measuring an image the app never processes, and flattering it — the original
// has three times the pixels and none of the recompression.
// =====================================================

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, extname } from 'node:path';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import { REAL_DIR } from './captureSet.mjs';

// ---------- EXIF orientation ----------
// The same APP1 walk as imageIngest.ts, including the fill-byte resync: a
// marker may be preceded by any number of 0xFF bytes, and reading the first as
// the identifier sends the walk past the end of the file and silently reports
// orientation 1 — which on this set would leave six of eleven pages sideways.
export const readExifOrientation = (buf) => {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return 1;
  let offset = 2;
  while (offset + 4 <= view.byteLength) {
    if (view.getUint8(offset) !== 0xff) { offset++; continue; }
    let markerAt = offset + 1;
    while (markerAt < view.byteLength && view.getUint8(markerAt) === 0xff) markerAt++;
    if (markerAt >= view.byteLength) break;
    const marker = view.getUint8(markerAt);
    offset = markerAt + 1;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (marker === 0xda || marker === 0xd9) break;
    if (offset + 2 > view.byteLength) break;
    const size = view.getUint16(offset);
    if (size < 2) break;
    const segStart = offset + 2;
    if (marker === 0xe1 && segStart + 6 <= view.byteLength &&
        view.getUint32(segStart) === 0x45786966 && view.getUint16(segStart + 4) === 0x0000) {
      const tiff = segStart + 6;
      if (tiff + 8 > view.byteLength) return 1;
      const endian = view.getUint16(tiff);
      const little = endian === 0x4949;
      if (!little && endian !== 0x4d4d) return 1;
      if (view.getUint16(tiff + 2, little) !== 0x002a) return 1;
      const ifd0 = tiff + view.getUint32(tiff + 4, little);
      if (ifd0 + 2 > view.byteLength) return 1;
      const entries = view.getUint16(ifd0, little);
      for (let i = 0; i < entries; i++) {
        const entry = ifd0 + 2 + i * 12;
        if (entry + 12 > view.byteLength) break;
        if (view.getUint16(entry, little) === 0x0112) {
          const v = view.getUint16(entry + 8, little);
          return v >= 1 && v <= 8 ? v : 1;
        }
      }
      return 1;
    }
    offset += size;
  }
  return 1;
};

// Destination pixel for a source pixel, per EXIF flag — the same table
// imageIngest.applyOrientation expresses as a canvas transform.
const EXIF_MAP = {
  1: (x, y) => [x, y],
  2: (x, y, w) => [w - 1 - x, y],
  3: (x, y, w, h) => [w - 1 - x, h - 1 - y],
  4: (x, y, w, h) => [x, h - 1 - y],
  5: (x, y) => [y, x],
  6: (x, y, w, h) => [h - 1 - y, x],
  7: (x, y, w, h) => [h - 1 - y, w - 1 - x],
  8: (x, y, w) => [y, w - 1 - x],
};

const applyExif = (img, orientation) => {
  if (!orientation || orientation === 1) return img;
  const swap = orientation >= 5;
  const width = swap ? img.height : img.width;
  const height = swap ? img.width : img.height;
  const data = new Uint8ClampedArray(width * height * 4);
  const map = EXIF_MAP[orientation];
  for (let sy = 0; sy < img.height; sy++) {
    for (let sx = 0; sx < img.width; sx++) {
      const [dx, dy] = map(sx, sy, img.width, img.height);
      const s = (sy * img.width + sx) * 4;
      const d = (dy * width + dx) * 4;
      data[d] = img.data[s]; data[d + 1] = img.data[s + 1];
      data[d + 2] = img.data[s + 2]; data[d + 3] = 255;
    }
  }
  return { data, width, height };
};

// ---------- downsample, in halves ----------
// One naive jump from a 12 megapixel photo aliases a 2 px pen stroke into a
// dotted line; the app steps down in halves for that reason and so does this.
const halve = (img) => {
  const width = Math.max(1, img.width >> 1), height = Math.max(1, img.height >> 1);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      const y0 = 2 * y, y1 = Math.min(2 * y + 1, img.height - 1);
      const x0 = 2 * x, x1 = Math.min(2 * x + 1, img.width - 1);
      for (let c = 0; c < 3; c++) {
        data[o + c] = (
          img.data[(y0 * img.width + x0) * 4 + c] + img.data[(y0 * img.width + x1) * 4 + c] +
          img.data[(y1 * img.width + x0) * 4 + c] + img.data[(y1 * img.width + x1) * 4 + c]
        ) / 4;
      }
      data[o + 3] = 255;
    }
  }
  return { data, width, height };
};

const bilinear = (src, x, y, c) => {
  const cx = Math.max(0, Math.min(src.width - 1, x));
  const cy = Math.max(0, Math.min(src.height - 1, y));
  const x0 = Math.floor(cx), y0 = Math.floor(cy);
  const x1 = Math.min(x0 + 1, src.width - 1), y1 = Math.min(y0 + 1, src.height - 1);
  const fx = cx - x0, fy = cy - y0;
  const at = (xx, yy) => src.data[(yy * src.width + xx) * 4 + c];
  return (at(x0, y0) * (1 - fx) + at(x1, y0) * fx) * (1 - fy)
       + (at(x0, y1) * (1 - fx) + at(x1, y1) * fx) * fy;
};

const resampleTo = (img, w, h) => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = ((x + 0.5) * img.width) / w - 0.5;
      const sy = ((y + 0.5) * img.height) / h - 0.5;
      const o = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) data[o + c] = bilinear(img, sx, sy, c);
      data[o + 3] = 255;
    }
  }
  return { data, width: w, height: h };
};

const decodeAny = (path) => {
  const buf = readFileSync(path);
  if (extname(path).toLowerCase() === '.png') {
    const png = PNG.sync.read(buf);
    return { img: { data: new Uint8ClampedArray(png.data), width: png.width, height: png.height }, buf };
  }
  const raw = jpeg.decode(buf, { useTArray: true });
  return { img: { data: new Uint8ClampedArray(raw.data), width: raw.width, height: raw.height }, buf };
};

/** Mirrors `imageIngest.ingestPage`: upright, stepped to `maxEdge`, re-encoded. */
export const ingestLikeApp = (path, { maxEdge = 2200, quality = 85 } = {}) => {
  const { img: raw, buf } = decodeAny(path);
  const orientation = readExifOrientation(buf);
  let img = applyExif(raw, orientation);

  const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
  const targetW = Math.max(1, Math.round(img.width * scale));
  const targetH = Math.max(1, Math.round(img.height * scale));
  while (img.width > targetW * 2 && img.height > targetH * 2) img = halve(img);
  if (img.width !== targetW || img.height !== targetH) img = resampleTo(img, targetW, targetH);

  const encoded = jpeg.encode(
    { data: Buffer.from(img.data.buffer.slice(0)), width: img.width, height: img.height }, quality
  ).data;
  const back = jpeg.decode(encoded, { useTArray: true });
  return {
    data: new Uint8ClampedArray(back.data), width: back.width, height: back.height,
    orientation, sourceWidth: raw.width, sourceHeight: raw.height,
  };
};

/** The eleven photographs, with whatever CAPTURE_MANIFEST.csv claims about each. */
export const listRealCaptures = () => {
  if (!existsSync(REAL_DIR)) return [];
  const manifestPath = join(REAL_DIR, 'CAPTURE_MANIFEST.csv');
  const truth = {};
  if (existsSync(manifestPath)) {
    const lines = readFileSync(manifestPath, 'utf8').trim().split(/\r?\n/);
    const head = lines[0].split(',').map(h => h.trim());
    for (const line of lines.slice(1)) {
      const cells = line.split(',');
      const row = {};
      head.forEach((h, i) => { row[h] = (cells[i] ?? '').trim(); });
      truth[row.file] = row;
    }
  }
  return readdirSync(REAL_DIR)
    .filter(n => /\.(jpe?g|png)$/i.test(n))
    .sort()
    .map(file => ({ file, path: join(REAL_DIR, file), truth: truth[file] ?? null }));
};
