// Scratch: draw what the mark search is looking at.
//   node tests/markProbe.mjs [file...]
// Writes annotated PNGs to tests/captures/_probe/.
import { webcrypto } from 'node:crypto';
globalThis.crypto ??= webcrypto;
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { loadModule, CAPTURE_DIR } from './captureSet.mjs';
import { ingestLikeApp, listRealCaptures } from './realCaptures.mjs';

const OUT = join(CAPTURE_DIR, '_probe');
mkdirSync(OUT, { recursive: true });

const fmt = await loadModule('services/pageFormat.ts', 'f_mp.mjs');
const ras = await loadModule('services/raster.ts', 'ra_mp.mjs');
const md = await loadModule('services/markDetect.ts', 'md_mp.mjs');
const qrd = await loadModule('services/qrDecode.ts', 'q_mp.mjs');

const only = process.argv.slice(2);

const writePng = (name, img) => {
  const png = new PNG({ width: img.width, height: img.height });
  png.data = Buffer.from(img.data.buffer.slice(0));
  writeFileSync(join(OUT, name), PNG.sync.write(png));
};

const rgbaFromGray = (g) => {
  const data = new Uint8ClampedArray(g.width * g.height * 4);
  for (let p = 0; p < g.width * g.height; p++) {
    data[p * 4] = data[p * 4 + 1] = data[p * 4 + 2] = g.data[p];
    data[p * 4 + 3] = 255;
  }
  return { data, width: g.width, height: g.height };
};

const box = (img, x0, y0, x1, y1, colour) => {
  const put = (x, y) => {
    if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
    const i = (y * img.width + x) * 4;
    img.data[i] = colour[0]; img.data[i + 1] = colour[1]; img.data[i + 2] = colour[2];
  };
  for (let x = Math.round(x0); x <= Math.round(x1); x++) {
    for (let t = 0; t < 3; t++) { put(x, Math.round(y0) + t); put(x, Math.round(y1) - t); }
  }
  for (let y = Math.round(y0); y <= Math.round(y1); y++) {
    for (let t = 0; t < 3; t++) { put(Math.round(x0) + t, y); put(Math.round(x1) - t, y); }
  }
};

const cross = (img, cx, cy, colour, r = 14) => {
  for (let d = -r; d <= r; d++) {
    for (let t = -1; t <= 1; t++) {
      const put = (x, y) => {
        if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
        const i = (y * img.width + x) * 4;
        img.data[i] = colour[0]; img.data[i + 1] = colour[1]; img.data[i + 2] = colour[2];
      };
      put(Math.round(cx + d), Math.round(cy + t));
      put(Math.round(cx + t), Math.round(cy + d));
    }
  }
};

const QR_CORNERS_MM = [
  { x: fmt.QR_RECT_MM.x0, y: fmt.QR_RECT_MM.y0 },
  { x: fmt.QR_RECT_MM.x1, y: fmt.QR_RECT_MM.y0 },
  { x: fmt.QR_RECT_MM.x1, y: fmt.QR_RECT_MM.y1 },
  { x: fmt.QR_RECT_MM.x0, y: fmt.QR_RECT_MM.y1 },
];

for (const c of listRealCaptures()) {
  if (only.length && !only.some(o => c.file.includes(o))) continue;
  const img = ingestLikeApp(c.path);
  const qr = qrd.decodePageQr(img);
  if (!qr) { console.log(c.file, 'NO QR'); continue; }

  const upright = ras.rotateGray(ras.toGray(img), qr.theta);
  const inUp = (p) => { const [x, y] = upright.fromSource(p.x, p.y); return { x, y }; };
  const qrUp = [inUp(qr.corners.topLeft), inUp(qr.corners.topRight),
                inUp(qr.corners.bottomRight), inUp(qr.corners.bottomLeft)];
  const wMm = fmt.QR_RECT_MM.x1 - fmt.QR_RECT_MM.x0;
  const wPx = (Math.hypot(qrUp[1].x - qrUp[0].x, qrUp[1].y - qrUp[0].y)
             + Math.hypot(qrUp[2].x - qrUp[3].x, qrUp[2].y - qrUp[3].y)) / 2;
  const hPx = (Math.hypot(qrUp[3].x - qrUp[0].x, qrUp[3].y - qrUp[0].y)
             + Math.hypot(qrUp[2].x - qrUp[1].x, qrUp[2].y - qrUp[1].y)) / 2;
  const s = (wPx / wMm + hPx / wMm) / 2;
  const origin = { x: qrUp[0].x - fmt.QR_RECT_MM.x0 * s, y: qrUp[0].y - fmt.QR_RECT_MM.y0 * s };
  const predict = (mx, my) => ({ x: origin.x + mx * s, y: origin.y + my * s });

  const vis = rgbaFromGray(upright);
  const lines = [];
  const qrCentre = { x: (fmt.QR_RECT_MM.x0 + fmt.QR_RECT_MM.x1) / 2, y: (fmt.QR_RECT_MM.y0 + fmt.QR_RECT_MM.y1) / 2 };

  fmt.MARK_CENTRES_MM.forEach(([mx, my], i) => {
    const p = predict(mx, my);
    const windowMm = Math.max(30 + 0.35 * Math.hypot(mx - qrCentre.x, my - qrCentre.y), 45);
    const half = (windowMm * s) / 2;
    box(vis, p.x - half, p.y - half, p.x + half, p.y + half, [255, 0, 0]);
    const exclude = {
      x0: Math.min(...qrUp.map(c => c.x)) - s, y0: Math.min(...qrUp.map(c => c.y)) - s,
      x1: Math.max(...qrUp.map(c => c.x)) + s, y1: Math.max(...qrUp.map(c => c.y)) + s,
    };
    const found = md.findMarksInWindow(upright, {
      x0: p.x - half, y0: p.y - half, x1: p.x + half, y1: p.y + half,
    }, fmt.MARK_SIZE_MM * s, { exclude });
    found.slice(0, 3).forEach((f, n) => cross(vis, f.x, f.y, n === 0 ? [0, 200, 0] : [0, 120, 255]));
    lines.push(`   ${['NW', 'NE', 'SW', 'SE'][i]} win=${windowMm.toFixed(0)}mm pred=(${p.x.toFixed(0)},${p.y.toFixed(0)}) ` +
      `cands=${found.length}` +
      (found.length ? ` best area=${found[0].area} (want ${(fmt.MARK_SIZE_MM * s) ** 2 | 0}) fill=${found[0].fill.toFixed(2)} asp=${found[0].aspect.toFixed(2)} wh=${found[0].width}x${found[0].height}` : ''));
    cross(vis, p.x, p.y, [255, 0, 255], 8);
  });

  // Also show where the page edges would be under the scale-only estimate.
  box(vis, origin.x, origin.y, origin.x + fmt.PAGE_W_MM * s, origin.y + fmt.PAGE_H_MM * s, [255, 200, 0]);

  writePng(c.file.replace(/\.jpe?g$/i, '') + '_marks.png', vis);
  console.log(`${c.file}  px/mm=${s.toFixed(2)}  upright=${upright.width}x${upright.height}  foundBy=${qr.foundBy}`);
  lines.forEach(l => console.log(l));
}
console.log('\nWrote annotated PNGs to', OUT);
