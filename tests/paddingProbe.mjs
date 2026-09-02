// =====================================================
// Why a corner mark near the frame edge is never a blob
// =====================================================
// Diagnostic for WORKORDER_THREE_MARK_FIT_2026-09-02 Part B. Not part of
// `npm test`, and it changes nothing in services/ — it measures.
//
// `rotateGray` pads the rotated canvas with **255**, the brightest value there
// is. `adaptiveInk` then thresholds every pixel against the mean of a box of
// radius `MARK_SIZE_MM * LOCAL_RADIUS_MARKS` around it, and near the frame edge
// that box is up to half padding. The mean goes up, the offset of 18 is not
// nearly enough to absorb it, and a wide strip of ordinary paper is classified
// as ink — which bridges any mark inside the strip into one frame-spanning
// component, rejected on area.
//
//   node tests/paddingProbe.mjs students/ios2_05 SW
//   node tests/paddingProbe.mjs students/ios2_01 SW
//
// Prints the grey / local-mean / ink table across the strip, the size of the
// component the mark ends up in, and what that component would be if the
// padding were kept out of the average. Writes a grey-vs-mask picture to
// tests/captures/_probe/.
import { webcrypto } from 'node:crypto';
globalThis.crypto ??= webcrypto;
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { loadModule, CAPTURE_DIR } from './captureSet.mjs';
import { ingestLikeApp } from './realCaptures.mjs';

const fmt = await loadModule('services/pageFormat.ts', 'f_pad.mjs');
const ras = await loadModule('services/raster.ts', 'r_pad.mjs');
const md = await loadModule('services/markDetect.ts', 'm_pad.mjs');
const qrd = await loadModule('services/qrDecode.ts', 'q_pad.mjs');

const OUT = join(CAPTURE_DIR, '_probe');
mkdirSync(OUT, { recursive: true });
const QR_KEYS = ['topLeft', 'topRight', 'bottomRight', 'bottomLeft'];
const CORNERS = ['NW', 'NE', 'SW', 'SE'];

const [folder, name] = (process.argv[2] ?? 'students/ios2_05').split('/');
const want = process.argv[3] ?? 'SW';

const img = ingestLikeApp(join(CAPTURE_DIR, folder, name + '.jpg'));
const readings = qrd.decodePageQrCandidates(img, { budgetMs: 1400 });
if (!readings.length) { console.log(`${name}: no QR`); process.exit(0); }
const qr = readings[0];
const gray = ras.toGray(img);
const up = ras.rotateGray(gray, qr.theta);
const W = up.width, H = up.height;

const inUp = (p) => { const [x, y] = up.fromSource(p.x, p.y); return { x, y }; };
const qrUp = QR_KEYS.map(k => inUp(qr.corners[k]));
const wMm = fmt.QR_RECT_MM.x1 - fmt.QR_RECT_MM.x0, hMm = fmt.QR_RECT_MM.y1 - fmt.QR_RECT_MM.y0;
const wPx = (Math.hypot(qrUp[1].x - qrUp[0].x, qrUp[1].y - qrUp[0].y)
           + Math.hypot(qrUp[2].x - qrUp[3].x, qrUp[2].y - qrUp[3].y)) / 2;
const hPx = (Math.hypot(qrUp[3].x - qrUp[0].x, qrUp[3].y - qrUp[0].y)
           + Math.hypot(qrUp[2].x - qrUp[1].x, qrUp[2].y - qrUp[1].y)) / 2;
const s = (wPx / wMm + hPx / hMm) / 2;
const origin = { x: qrUp[0].x - fmt.QR_RECT_MM.x0 * s, y: qrUp[0].y - fmt.QR_RECT_MM.y0 * s };
const ci = CORNERS.indexOf(want);
const p = {
  x: origin.x + fmt.MARK_CENTRES_MM[ci][0] * s,
  y: origin.y + fmt.MARK_CENTRES_MM[ci][1] * s,
};
const side = fmt.MARK_SIZE_MM * s;
const rad = Math.round(side * md.LOCAL_RADIUS_MARKS);

console.log(`${name} ${want}`);
console.log(`  ingested ${img.width}x${img.height} -> upright ${W}x${H} ` +
  `(theta ${(qr.theta * 180 / Math.PI).toFixed(2)} deg)`);
console.log(`  mark side ${side.toFixed(1)} px, nominal area ${(side * side) | 0}, ` +
  `local-mean radius ${rad}, ink offset ${md.INK_OFFSET}`);
console.log(`  predicted centre (${p.x.toFixed(0)}, ${p.y.toFixed(0)})`);

const isPad = (x, y) => {
  const [sx, sy] = up.toSource(x, y);
  return !(sx >= 0 && sy >= 0 && sx < gray.width && sy < gray.height);
};

// ---------- the two masks ----------
const shipped = ras.adaptiveInk(up, 0, 0, W, H, side * md.LOCAL_RADIUS_MARKS, md.INK_OFFSET);

const withoutPadding = (() => {
  const sum = new Float64Array((W + 1) * (H + 1));
  const cnt = new Float64Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) {
    let rs = 0, rc = 0;
    for (let x = 0; x < W; x++) {
      const pad = isPad(x, y);
      rs += pad ? 0 : up.data[y * W + x];
      rc += pad ? 0 : 1;
      sum[(y + 1) * (W + 1) + (x + 1)] = sum[y * (W + 1) + (x + 1)] + rs;
      cnt[(y + 1) * (W + 1) + (x + 1)] = cnt[y * (W + 1) + (x + 1)] + rc;
    }
  }
  const box = (a, ay, b, by, t) => t[(by + 1) * (W + 1) + (b + 1)] - t[ay * (W + 1) + (b + 1)]
    - t[(by + 1) * (W + 1) + a] + t[ay * (W + 1) + a];
  const m = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    const ay = Math.max(0, y - rad), by = Math.min(H - 1, y + rad);
    for (let x = 0; x < W; x++) {
      const ax = Math.max(0, x - rad), bx = Math.min(W - 1, x + rad);
      const n = box(ax, ay, bx, by, cnt);
      const mean = n > 0 ? box(ax, ay, bx, by, sum) / n : 255;
      m[y * W + x] = up.data[y * W + x] < mean - md.INK_OFFSET ? 1 : 0;
    }
  }
  return m;
})();

// ---------- the strip, pixel by pixel ----------
const horizontal = want === 'NW' || want === 'SW';
console.log(`\n  across the ${horizontal ? 'left' : 'right'} edge at ` +
  `${horizontal ? `y=${Math.round(p.y)}` : `y=${Math.round(p.y)}`}:\n`);
console.log('     off  grey   mean(shipped)  ink    mean(no padding)  ink    padding in box');
const y = Math.round(p.y);
for (let d = 0; d <= 160; d += 10) {
  const x = horizontal ? d : W - 1 - d;
  if (x < 0 || x >= W) continue;
  const ax = Math.max(0, x - rad), bx = Math.min(W - 1, x + rad);
  const ay = Math.max(0, y - rad), by = Math.min(H - 1, y + rad);
  let t1 = 0, n1 = 0, t2 = 0, n2 = 0, padN = 0;
  for (let yy = ay; yy <= by; yy++) for (let xx = ax; xx <= bx; xx++) {
    const v = up.data[yy * W + xx];
    t1 += v; n1++;
    if (isPad(xx, yy)) padN++; else { t2 += v; n2++; }
  }
  const g = up.data[y * W + x];
  const m1 = t1 / n1, m2 = n2 ? t2 / n2 : 255;
  console.log(
    String(d).padStart(8), String(g).padStart(6), m1.toFixed(1).padStart(15),
    (g < m1 - md.INK_OFFSET ? 'INK' : ' . ').padStart(6),
    m2.toFixed(1).padStart(18), (g < m2 - md.INK_OFFSET ? 'INK' : ' . ').padStart(6),
    `${(100 * padN / n1).toFixed(1)}%`.padStart(15));
}

// ---------- the component the mark lands in, either way ----------
const componentAt = (mask, cx, cy, reach) => {
  let seed = -1, best = Infinity;
  for (let yy = Math.max(0, cy - reach); yy < Math.min(H, cy + reach); yy++) {
    for (let xx = Math.max(0, cx - reach); xx < Math.min(W, cx + reach); xx++) {
      if (!mask[yy * W + xx]) continue;
      const d = (xx - cx) ** 2 + (yy - cy) ** 2;
      if (d < best) { best = d; seed = yy * W + xx; }
    }
  }
  if (seed < 0) return null;
  const seen = new Uint8Array(W * H); const stack = [seed]; seen[seed] = 1;
  let count = 0, minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
  while (stack.length) {
    const q = stack.pop(); const x = q % W, yy = (q / W) | 0;
    count++;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (yy < minY) minY = yy; if (yy > maxY) maxY = yy;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx, ny = yy + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const k = ny * W + nx;
      if (mask[k] && !seen[k]) { seen[k] = 1; stack.push(k); }
    }
  }
  return { count, w: maxX - minX + 1, h: maxY - minY + 1, seedD: Math.sqrt(best) };
};

const nominal = side * side;
const band = `${(md.PHOTO_TOLERANCE.areaMin * nominal) | 0}..${(md.PHOTO_TOLERANCE.areaMax * nominal) | 0}`;
console.log(`\n  the connected component the mark belongs to (area band admits ${band} px):`);
for (const [tag, mask] of [['as shipped     ', shipped], ['no padding     ', withoutPadding]]) {
  const c = componentAt(mask, Math.round(p.x), Math.round(p.y), Math.round(3 * side));
  console.log(`    ${tag} ` + (c
    ? `${String(c.count).padStart(7)} px  ${c.w}x${c.h}  (${(c.count / nominal).toFixed(2)}x nominal)  ` +
      (c.count >= md.PHOTO_TOLERANCE.areaMin * nominal && c.count <= md.PHOTO_TOLERANCE.areaMax * nominal
        ? 'INSIDE the area band' : 'rejected on AREA')
    : 'no ink within reach'));
}

// ---------- picture ----------
{
  const x0 = Math.max(0, Math.round(p.x - 4 * side)), y0 = Math.max(0, Math.round(p.y - 4 * side));
  const x1 = Math.min(W, Math.round(p.x + 4 * side)), y1 = Math.min(H, Math.round(p.y + 4 * side));
  const w = x1 - x0, h = y1 - y0, gap = 4;
  const outW = w * 3 + gap * 2;
  const png = new PNG({ width: outW, height: h });
  for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < outW; xx++) {
    const o = (yy * outW + xx) * 4;
    png.data[o] = 255; png.data[o + 1] = 0; png.data[o + 2] = 0; png.data[o + 3] = 255;
  }
  const put = (col, xx, yy, v) => {
    const o = (yy * outW + col * (w + gap) + xx) * 4;
    png.data[o] = png.data[o + 1] = png.data[o + 2] = v; png.data[o + 3] = 255;
  };
  for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
    const i = (yy + y0) * W + (xx + x0);
    put(0, xx, yy, up.data[i]);
    put(1, xx, yy, shipped[i] ? 0 : 255);
    put(2, xx, yy, withoutPadding[i] ? 0 : 255);
  }
  const file = join(OUT, `${name}_${want}_padding.png`);
  writeFileSync(file, PNG.sync.write(png));
  console.log(`\n  wrote ${file}`);
  console.log('    grey  |  ink as shipped  |  ink with the padding out of the mean');
}
