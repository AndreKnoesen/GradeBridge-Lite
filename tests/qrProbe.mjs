// Scratch: what does it actually take to decode the QR on the real set?
//   node tests/qrProbe.mjs
import { webcrypto } from 'node:crypto';
globalThis.crypto ??= webcrypto;
import jsQR from 'jsqr';
import { ingestLikeApp, listRealCaptures } from './realCaptures.mjs';

const crop = (img, x0, y0, w, h) => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = ((y0 + y) * img.width + (x0 + x)) * 4;
      const d = (y * w + x) * 4;
      data[d] = img.data[s]; data[d + 1] = img.data[s + 1];
      data[d + 2] = img.data[s + 2]; data[d + 3] = 255;
    }
  }
  return { data, width: w, height: h };
};

const down = (img, f) => {
  if (f <= 1) return img;
  const w = Math.floor(img.width / f), h = Math.floor(img.height / f);
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r = 0, g = 0, b = 0, n = 0;
    for (let dy = 0; dy < f; dy++) for (let dx = 0; dx < f; dx++) {
      const sy = y * f + dy, sx = x * f + dx;
      if (sy >= img.height || sx >= img.width) continue;
      const i = (sy * img.width + sx) * 4;
      r += img.data[i]; g += img.data[i + 1]; b += img.data[i + 2]; n++;
    }
    const o = (y * w + x) * 4;
    data[o] = r / n; data[o + 1] = g / n; data[o + 2] = b / n; data[o + 3] = 255;
  }
  return { data, width: w, height: h };
};

const tryDecode = (img) => {
  try { return jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' }); }
  catch { return null; }
};

/** Overlapping tiles: grid x grid, each 2/(grid+1) of the frame, 50% overlap. */
const tiles = (img, grid) => {
  const out = [];
  const tw = Math.floor((2 * img.width) / (grid + 1));
  const th = Math.floor((2 * img.height) / (grid + 1));
  const stepX = Math.floor((img.width - tw) / Math.max(1, grid - 1));
  const stepY = Math.floor((img.height - th) / Math.max(1, grid - 1));
  for (let gy = 0; gy < grid; gy++) {
    for (let gx = 0; gx < grid; gx++) {
      out.push({
        name: `${grid}x${grid}[${gx},${gy}]`,
        x0: gx * stepX, y0: gy * stepY, w: tw, h: th,
      });
    }
  }
  return out;
};

console.log('\nWhat finds the QR, on the image the app actually registers (2200 px long edge):\n');
for (const c of listRealCaptures()) {
  const ing = ingestLikeApp(c.path);
  const orig = ingestLikeApp(c.path, { maxEdge: 4032, quality: 92 });
  const found = [];

  for (const [label, img] of [['ingest', ing], ['orig', orig]]) {
    for (const f of [1, 2, 3]) {
      const scaled = down(img, f);
      if (tryDecode(scaled)) found.push(`${label} full 1/${f}`);
      if (found.length) break;
    }
    if (found.length) continue;
    for (const grid of [2, 3]) {
      let hit = null;
      for (const t of tiles(img, grid)) {
        for (const f of [1, 2]) {
          const sub = down(crop(img, t.x0, t.y0, t.w, t.h), f);
          if (sub.width < 60 || sub.height < 60) continue;
          if (tryDecode(sub)) { hit = `${label} ${t.name} 1/${f}`; break; }
        }
        if (hit) break;
      }
      if (hit) { found.push(hit); break; }
    }
    if (found.length) break;
  }

  console.log(
    c.file.padEnd(13),
    (c.truth && c.truth.found_by ? `manifest:${c.truth.found_by}` : 'manifest:none').padEnd(22),
    found.length ? `-> ${found[0]}` : '-> NOT FOUND anywhere'
  );
}
console.log('');
