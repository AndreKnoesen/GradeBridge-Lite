// Scratch: draw every square the frame-wide detector finds, and the QR it is
// registering against.
//   node tests/squareProbe.mjs IMG_0371
import { webcrypto } from 'node:crypto';
globalThis.crypto ??= webcrypto;
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { loadModule, CAPTURE_DIR } from './captureSet.mjs';
import { ingestLikeApp, listRealCaptures } from './realCaptures.mjs';

const OUT = join(CAPTURE_DIR, '_probe');
mkdirSync(OUT, { recursive: true });
const fmt = await loadModule('services/pageFormat.ts', 'f_sq.mjs');
const ras = await loadModule('services/raster.ts', 'ra_sq.mjs');
const md = await loadModule('services/markDetect.ts', 'md_sq.mjs');
const qrd = await loadModule('services/qrDecode.ts', 'q_sq.mjs');

const only = process.argv.slice(2);

const rgbaFromGray = (g) => {
  const data = new Uint8ClampedArray(g.width * g.height * 4);
  for (let p = 0; p < g.width * g.height; p++) {
    data[p * 4] = data[p * 4 + 1] = data[p * 4 + 2] = g.data[p];
    data[p * 4 + 3] = 255;
  }
  return { data, width: g.width, height: g.height };
};
const box = (img, x0, y0, x1, y1, colour, t = 3) => {
  const put = (x, y) => {
    if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
    const i = (y * img.width + x) * 4;
    img.data[i] = colour[0]; img.data[i + 1] = colour[1]; img.data[i + 2] = colour[2];
  };
  for (let x = Math.round(x0); x <= Math.round(x1); x++)
    for (let k = 0; k < t; k++) { put(x, Math.round(y0) + k); put(x, Math.round(y1) - k); }
  for (let y = Math.round(y0); y <= Math.round(y1); y++)
    for (let k = 0; k < t; k++) { put(Math.round(x0) + k, y); put(Math.round(x1) - k, y); }
};

for (const c of listRealCaptures()) {
  if (only.length && !only.some(o => c.file.includes(o))) continue;
  const img = ingestLikeApp(c.path);
  const readings = qrd.decodePageQrCandidates(img);
  readings.forEach((qr, n) => {
    const up = ras.rotateGray(ras.toGray(img), qr.theta);
    const inUp = (p) => { const [x, y] = up.fromSource(p.x, p.y); return { x, y }; };
    const q = [inUp(qr.corners.topLeft), inUp(qr.corners.topRight),
               inUp(qr.corners.bottomRight), inUp(qr.corners.bottomLeft)];
    const side = fmt.QR_RECT_MM.x1 - fmt.QR_RECT_MM.x0;
    const wPx = (Math.hypot(q[1].x - q[0].x, q[1].y - q[0].y) + Math.hypot(q[2].x - q[3].x, q[2].y - q[3].y)) / 2;
    const hPx = (Math.hypot(q[3].x - q[0].x, q[3].y - q[0].y) + Math.hypot(q[2].x - q[1].x, q[2].y - q[1].y)) / 2;
    const s = (wPx / side + hPx / side) / 2;
    const exp = fmt.MARK_SIZE_MM * s;
    const excl = {
      x0: Math.min(...q.map(p => p.x)) - s, y0: Math.min(...q.map(p => p.y)) - s,
      x1: Math.max(...q.map(p => p.x)) + s, y1: Math.max(...q.map(p => p.y)) + s,
    };
    const all = [];
    for (const f of [0.7, 1.0, 1.45]) {
      for (const m of md.findMarksInWindow(up, { x0: 0, y0: 0, x1: up.width, y1: up.height },
        exp * f, { exclude: [excl], limit: 64 })) {
        if (!all.some(e => Math.hypot(e.x - m.x, e.y - m.y) < Math.max(exp, m.width) * 0.6)) {
          all.push({ ...m, f });
        }
      }
    }
    const vis = rgbaFromGray(up);
    box(vis, excl.x0, excl.y0, excl.x1, excl.y1, [255, 0, 255], 4);
    for (const m of all) {
      box(vis, m.x - m.width, m.y - m.height, m.x + m.width, m.y + m.height, [0, 220, 0], 4);
    }
    writeFileSync(join(OUT, `${c.file.replace(/\.jpe?g$/i, '')}_k${qr.fields.k}_squares.png`),
      PNG.sync.write(Object.assign(new PNG({ width: vis.width, height: vis.height }),
        { data: Buffer.from(vis.data.buffer.slice(0)) })));
    console.log(`${c.file} k=${qr.fields.k} s=${s.toFixed(2)} exp=${exp.toFixed(0)} squares=${all.length}`);
    for (const m of all) {
      console.log(`    (${m.x.toFixed(0)},${m.y.toFixed(0)}) ${m.width}x${m.height} fill=${m.fill.toFixed(2)} asp=${m.aspect.toFixed(2)} area=${m.area} @${m.f}`);
    }
  });
}
console.log('\nWrote to', OUT);
