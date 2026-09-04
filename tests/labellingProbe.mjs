// =====================================================
// The three-mark enumeration never permutes its points
// =====================================================
// Diagnostic for WORKORDER_THREE_MARK_FIT_2026-09-02 Part B. Not part of
// `npm test`, and it changes nothing in services/ — it measures.
//
// `registration.ts` scores every four-mark subset through `label()`, which
// sorts the four geometrically (by x+y and x-y) before assigning corners. The
// three-mark branch has no such step. It passes
// `[squares[a], squares[b], squares[c]]` with a < b < c — the detector's own
// order, which is fullest-blob-first — and varies only WHICH of the four
// corners is taken to be the missing one.
//
// So of the 4 x 3! = 24 ways three points can be read as three of four printed
// corners, exactly 4 are ever scored: the identity permutation of a list sorted
// by fill ratio. That is correct only when the fill ranking happens to agree
// with reading order, which is luck.
//
//   node tests/labellingProbe.mjs students/ios2_05
//
// Enumerates all 24 per trio, applies the same `arrangementIsPlausible` rules,
// and prints what the shipped four can reach against what a permuting search
// would find.
import { webcrypto } from 'node:crypto';
globalThis.crypto ??= webcrypto;
import { join } from 'node:path';
import { loadModule, CAPTURE_DIR } from './captureSet.mjs';
import { ingestLikeApp } from './realCaptures.mjs';

const fmt = await loadModule('services/pageFormat.ts', 'f_pb6.mjs');
const ras = await loadModule('services/raster.ts', 'r_pb6.mjs');
const md = await loadModule('services/markDetect.ts', 'm_pb6.mjs');
const qrd = await loadModule('services/qrDecode.ts', 'q_pb6.mjs');
const hom = await loadModule('services/homography.ts', 'h_pb6.mjs');

const QR_KEYS = ['topLeft', 'topRight', 'bottomRight', 'bottomLeft'];
const CORNERS = ['NW', 'NE', 'SW', 'SE'];
const QR_CORNERS_MM = [
  { x: fmt.QR_RECT_MM.x0, y: fmt.QR_RECT_MM.y0 },
  { x: fmt.QR_RECT_MM.x1, y: fmt.QR_RECT_MM.y0 },
  { x: fmt.QR_RECT_MM.x1, y: fmt.QR_RECT_MM.y1 },
  { x: fmt.QR_RECT_MM.x0, y: fmt.QR_RECT_MM.y1 },
];
// registration.ts's THREE_MARK_LABELLINGS, verbatim.
const THREE_MARK_LABELLINGS = [[1, 2, 3], [0, 2, 3], [0, 1, 3], [0, 1, 2]];

const [folder, name] = process.argv[2].split('/');
const img = ingestLikeApp(join(CAPTURE_DIR, folder, name + '.jpg'));
const readings = qrd.decodePageQrCandidates(img, { budgetMs: 1400 });
const qr = readings[0];
const up = ras.rotateGray(ras.toGray(img), qr.theta);
const inUp = (p) => { const [x, y] = up.fromSource(p.x, p.y); return { x, y }; };
const qrUp = QR_KEYS.map(k => inUp(qr.corners[k]));
const wMm = fmt.QR_RECT_MM.x1 - fmt.QR_RECT_MM.x0, hMm = fmt.QR_RECT_MM.y1 - fmt.QR_RECT_MM.y0;
const wPx = (Math.hypot(qrUp[1].x - qrUp[0].x, qrUp[1].y - qrUp[0].y)
           + Math.hypot(qrUp[2].x - qrUp[3].x, qrUp[2].y - qrUp[3].y)) / 2;
const hPx = (Math.hypot(qrUp[3].x - qrUp[0].x, qrUp[3].y - qrUp[0].y)
           + Math.hypot(qrUp[2].x - qrUp[1].x, qrUp[2].y - qrUp[1].y)) / 2;
const pxPerMm = (wPx / wMm + hPx / hMm) / 2;
const side = fmt.MARK_SIZE_MM * pxPerMm;

const exclude = readings.map(r => {
  const c = QR_KEYS.map(k => inUp(r.corners[k]));
  const m = 4.0 * pxPerMm;
  return {
    x0: Math.min(...c.map(p => p.x)) - m, y0: Math.min(...c.map(p => p.y)) - m,
    x1: Math.max(...c.map(p => p.x)) + m, y1: Math.max(...c.map(p => p.y)) + m,
  };
});
const squares = md.findMarksInWindow(up, { x0: 0, y0: 0, x1: up.width, y1: up.height },
  side, { exclude, limit: 24 });

const toSource = (c) => { const [x, y] = up.toSource(c.x, c.y); return { x, y }; };
const cornerMm = (i) => ({ x: fmt.MARK_CENTRES_MM[i][0], y: fmt.MARK_CENTRES_MM[i][1] });
const scoreFit = (t) => {
  if (!t) return Infinity;
  let worst = 0;
  for (let i = 0; i < 4; i++) {
    const p = hom.applyMatrix(t, QR_CORNERS_MM[i]);
    const q = qr.corners[QR_KEYS[i]];
    const d = Math.hypot(p.x - q.x, p.y - q.y);
    if (!Number.isFinite(d)) return Infinity;
    worst = Math.max(worst, d);
  }
  return worst / pxPerMm;
};

console.log(`${name}: ${squares.length} candidates, in the detector's own order (fill first)\n`);
squares.forEach((c, i) => console.log(
  `  [${i}] (${c.x.toFixed(0)}, ${c.y.toFixed(0)})  area=${c.area}  fill=${c.fill.toFixed(3)}  aspect=${c.aspect.toFixed(2)}`));

const PERMS = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];

// registration.ts's arrangementIsPlausible, verbatim in behaviour.
const SPAN_X = fmt.MARK_CENTRES_MM[1][0] - fmt.MARK_CENTRES_MM[0][0];
const SPAN_Y = fmt.MARK_CENTRES_MM[2][1] - fmt.MARK_CENTRES_MM[0][1];
const SCALE_BAND = 2.1, MAX_FORESHORTENING = 1.9;
const plausible = (used, picks) => {
  const at = (c) => { const k = used.indexOf(c); return k < 0 ? null : picks[k]; };
  const [nw, ne, sw, se] = [at(0), at(1), at(2), at(3)];
  const scales = [];
  const side2 = (a, b, mm) => { if (a && b) scales.push(Math.hypot(b.x - a.x, b.y - a.y) / mm); };
  side2(nw, ne, SPAN_X); side2(sw, se, SPAN_X); side2(nw, sw, SPAN_Y); side2(ne, se, SPAN_Y);
  if (scales.length < 2) return false;
  for (const v of scales) {
    if (!Number.isFinite(v) || v <= 0) return false;
    if (v > pxPerMm * SCALE_BAND || v < pxPerMm / SCALE_BAND) return false;
  }
  if (Math.max(...scales) / Math.min(...scales) > MAX_FORESHORTENING) return false;
  if (nw && ne && ne.x <= nw.x) return false;
  if (sw && se && se.x <= sw.x) return false;
  if (nw && sw && sw.y <= nw.y) return false;
  if (ne && se && se.y <= ne.y) return false;
  return true;
};
const n = squares.length;
const results = [];
for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) for (let c = b + 1; c < n; c++) {
  const trio = [squares[a], squares[b], squares[c]];
  for (const used of THREE_MARK_LABELLINGS) {
    for (const [pi, perm] of PERMS.entries()) {
      const picks = perm.map(k => trio[k]);
      const t = hom.affineFromPoints(used.map(cornerMm), picks.map(toSource));
      const residual = scoreFit(t);
      results.push({
        idx: [a, b, c], used, perm, shipped: pi === 0, residual,
        plausible: plausible(used, picks),
        label: used.map((u, k) => `${CORNERS[u]}<-[${[a, b, c][perm[k]]}]`).join(' '),
      });
    }
  }
}

const finite = results.filter(r => Number.isFinite(r.residual)).sort((x, y) => x.residual - y.residual);
console.log(`\n${results.length} labellings enumerated ` +
  `(${results.filter(r => r.shipped).length} of them are the ones registration.ts actually scores)\n`);
console.log('  best ten by QR reprojection residual:');
for (const r of finite.slice(0, 10)) {
  console.log(`    ${r.residual.toFixed(2).padStart(8)} mm   ${r.label.padEnd(40)} ` +
    `${r.plausible ? 'plausible' : 'IMPLAUSIBLE'}  ` +
    `${r.shipped ? 'SCORED by registration.ts' : 'never scored — permuted'}`);
}
const ok = finite.filter(r => r.plausible);
const bestShipped = ok.find(r => r.shipped) ?? finite.find(r => r.shipped);
console.log(`\n  best that registration.ts can reach: ${bestShipped.residual.toFixed(2)} mm  (${bestShipped.label})`);
console.log(`  best over all permutations:          ${ok[0].residual.toFixed(2)} mm  (${ok[0].label})`);
console.log(`  (both restricted to arrangements registration.ts calls plausible)`);
