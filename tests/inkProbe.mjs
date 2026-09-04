// Scratch: dump the binarized corner windows the mark detector actually sees.
//   node tests/inkProbe.mjs IMG_0372
import { webcrypto } from 'node:crypto';
globalThis.crypto ??= webcrypto;
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { loadModule, CAPTURE_DIR } from './captureSet.mjs';
import { ingestLikeApp, listRealCaptures } from './realCaptures.mjs';

const OUT = join(CAPTURE_DIR, '_probe');
mkdirSync(OUT, { recursive: true });

const fmt = await loadModule('services/pageFormat.ts', 'f_ip.mjs');
const ras = await loadModule('services/raster.ts', 'ra_ip.mjs');
const md = await loadModule('services/markDetect.ts', 'md_ip.mjs');
const qrd = await loadModule('services/qrDecode.ts', 'q_ip.mjs');

const only = process.argv.slice(2);
const NAMES = ['NW', 'NE', 'SW', 'SE'];

const writeMask = (name, ink, w, h, grey) => {
  const png = new PNG({ width: w * 2 + 8, height: h });
  png.data.fill(255);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const g = grey[y * w + x];
      let i = (y * (w * 2 + 8) + x) * 4;
      png.data[i] = png.data[i + 1] = png.data[i + 2] = g; png.data[i + 3] = 255;
      const v = ink[y * w + x] ? 0 : 255;
      i = (y * (w * 2 + 8) + (x + w + 8)) * 4;
      png.data[i] = png.data[i + 1] = png.data[i + 2] = v; png.data[i + 3] = 255;
    }
  }
  writeFileSync(join(OUT, name), PNG.sync.write(png));
};

for (const c of listRealCaptures()) {
  if (only.length && !only.some(o => c.file.includes(o))) continue;
  const img = ingestLikeApp(c.path);
  const qr = qrd.decodePageQr(img);
  if (!qr) { console.log(c.file, 'no QR'); continue; }
  const upright = ras.rotateGray(ras.toGray(img), qr.theta);
  const inUp = (p) => { const [x, y] = upright.fromSource(p.x, p.y); return { x, y }; };
  const q = [inUp(qr.corners.topLeft), inUp(qr.corners.topRight),
             inUp(qr.corners.bottomRight), inUp(qr.corners.bottomLeft)];
  const side = fmt.QR_RECT_MM.x1 - fmt.QR_RECT_MM.x0;
  const wPx = (Math.hypot(q[1].x - q[0].x, q[1].y - q[0].y) + Math.hypot(q[2].x - q[3].x, q[2].y - q[3].y)) / 2;
  const hPx = (Math.hypot(q[3].x - q[0].x, q[3].y - q[0].y) + Math.hypot(q[2].x - q[1].x, q[2].y - q[1].y)) / 2;
  const s = (wPx / side + hPx / side) / 2;
  const origin = { x: q[0].x - fmt.QR_RECT_MM.x0 * s, y: q[0].y - fmt.QR_RECT_MM.y0 * s };
  const qrCentre = { x: (fmt.QR_RECT_MM.x0 + fmt.QR_RECT_MM.x1) / 2, y: (fmt.QR_RECT_MM.y0 + fmt.QR_RECT_MM.y1) / 2 };
  const expected = fmt.MARK_SIZE_MM * s;

  console.log(`\n${c.file}  s=${s.toFixed(2)} px/mm  expected mark side ${expected.toFixed(1)} px  frame ${upright.width}x${upright.height}`);
  fmt.MARK_CENTRES_MM.forEach(([mx, my], i) => {
    const p = { x: origin.x + mx * s, y: origin.y + my * s };
    const windowMm = 30 + 0.35 * Math.hypot(mx - qrCentre.x, my - qrCentre.y);
    const half = (windowMm * s) / 2;
    const x0 = Math.max(0, Math.floor(p.x - half)), y0 = Math.max(0, Math.floor(p.y - half));
    const x1 = Math.min(upright.width, Math.ceil(p.x + half)), y1 = Math.min(upright.height, Math.ceil(p.y + half));
    const w = x1 - x0, h = y1 - y0;
    if (w < 3 || h < 3) { console.log(`  ${NAMES[i]}: window off-frame`); return; }

    const ink = ras.adaptiveInk(upright, x0, y0, x1, y1, expected * md.LOCAL_RADIUS_MARKS, md.INK_OFFSET);
    const grey = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) grey[y * w + x] = upright.data[(y0 + y) * upright.width + (x0 + x)];
    writeMask(`${c.file.replace(/\.jpe?g$/i, '')}_${NAMES[i]}.png`, ink, w, h, grey);

    let inkCount = 0;
    for (const v of ink) inkCount += v;
    const found = md.findMarksInWindow(upright, { x0, y0, x1, y1 }, expected);
    console.log(`  ${NAMES[i]}: window ${w}x${h} (${windowMm.toFixed(0)}mm)  ink=${(100 * inkCount / (w * h)).toFixed(1)}%  passed=${found.length}` +
      (found.length ? `  best area=${found[0].area} fill=${found[0].fill.toFixed(2)} asp=${found[0].aspect.toFixed(2)}` : ''));
  });
}
console.log('\nWrote masks to', OUT, '(left = grey, right = ink)\n');
