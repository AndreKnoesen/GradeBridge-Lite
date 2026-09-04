// Scratch: is the QR-derived scale right? Find every mark-like blob in the whole
// upright frame, then compare the spacing it implies against the QR's.
//   node tests/scaleProbe.mjs
import { webcrypto } from 'node:crypto';
globalThis.crypto ??= webcrypto;
import { loadModule } from './captureSet.mjs';
import { ingestLikeApp, listRealCaptures } from './realCaptures.mjs';

const fmt = await loadModule('services/pageFormat.ts', 'f_sp.mjs');
const ras = await loadModule('services/raster.ts', 'ra_sp.mjs');
const qrd = await loadModule('services/qrDecode.ts', 'q_sp.mjs');

/** Every solid dark square in the frame, over a wide size range. */
const allSquares = (gray, minSide, maxSide) => {
  const { width: w, height: h } = gray;
  const ink = ras.adaptiveInk(gray, 0, 0, w, h, Math.max(8, maxSide * 1.5), 18);
  const seen = new Uint8Array(w * h);
  const stack = [];
  const out = [];
  for (let start = 0; start < ink.length; start++) {
    if (!ink[start] || seen[start]) continue;
    seen[start] = 1; stack.length = 0; stack.push(start);
    let count = 0, sx = 0, sy = 0;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    while (stack.length) {
      const p = stack.pop();
      const px = p % w, py = (p / w) | 0;
      count++; sx += px; sy += py;
      if (px < minX) minX = px; if (px > maxX) maxX = px;
      if (py < minY) minY = py; if (py > maxY) maxY = py;
      if (count > 400000) break;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = px + dx, ny = py + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const q = ny * w + nx;
        if (ink[q] && !seen[q]) { seen[q] = 1; stack.push(q); }
      }
    }
    const bw = maxX - minX + 1, bh = maxY - minY + 1;
    if (bw < minSide || bh < minSide || bw > maxSide || bh > maxSide) continue;
    const fill = count / (bw * bh);
    const aspect = bw / bh;
    if (fill < 0.85 || aspect < 0.8 || aspect > 1.25) continue;
    out.push({ x: sx / count, y: sy / count, side: (bw + bh) / 2, fill, area: count });
  }
  return out;
};

console.log('');
for (const c of listRealCaptures()) {
  const img = ingestLikeApp(c.path);
  const qr = qrd.decodePageQr(img);
  if (!qr) { console.log(`${c.file}  no QR`); continue; }
  const upright = ras.rotateGray(ras.toGray(img), qr.theta);
  const inUp = (p) => { const [x, y] = upright.fromSource(p.x, p.y); return { x, y }; };
  const q = [inUp(qr.corners.topLeft), inUp(qr.corners.topRight),
             inUp(qr.corners.bottomRight), inUp(qr.corners.bottomLeft)];
  const wPx = (Math.hypot(q[1].x - q[0].x, q[1].y - q[0].y) + Math.hypot(q[2].x - q[3].x, q[2].y - q[3].y)) / 2;
  const hPx = (Math.hypot(q[3].x - q[0].x, q[3].y - q[0].y) + Math.hypot(q[2].x - q[1].x, q[2].y - q[1].y)) / 2;
  const qrSideMm = fmt.QR_RECT_MM.x1 - fmt.QR_RECT_MM.x0;
  const sQr = (wPx / qrSideMm + hPx / qrSideMm) / 2;

  // Search a wide band of square sizes so the true marks cannot fall outside it.
  const squares = allSquares(upright, 8, 90);

  // The four marks of ONE page form a rectangle 186.9 by 250.4 mm. Look for the
  // pair with the widest horizontal separation at a similar y — that is the top
  // edge of some page, and it pins a scale independent of the QR.
  let best = null;
  for (let i = 0; i < squares.length; i++) {
    for (let j = i + 1; j < squares.length; j++) {
      const a = squares[i], b = squares[j];
      const dx = Math.abs(a.x - b.x), dy = Math.abs(a.y - b.y);
      if (dx < 100 || dy > 0.08 * dx) continue;
      if (Math.abs(a.side - b.side) > 0.35 * Math.max(a.side, b.side)) continue;
      if (!best || dx > best.dx) best = { dx, a, b };
    }
  }
  const sMarks = best ? best.dx / (fmt.MARK_CENTRES_MM[1][0] - fmt.MARK_CENTRES_MM[0][0]) : null;
  const sideMm = best ? ((best.a.side + best.b.side) / 2) / (sMarks || 1) : null;

  console.log(
    c.file.padEnd(13),
    `frame=${upright.width}x${upright.height}`.padEnd(20),
    `qrPx=${wPx.toFixed(0)}x${hPx.toFixed(0)}`.padEnd(16),
    `s(qr)=${sQr.toFixed(2)}`.padEnd(12),
    sMarks ? `s(marks)=${sMarks.toFixed(2)}  ratio=${(sMarks / sQr).toFixed(2)}  markSide=${sideMm.toFixed(1)}mm  squares=${squares.length}`
           : `s(marks)=?  squares=${squares.length}`
  );
}
console.log('');
