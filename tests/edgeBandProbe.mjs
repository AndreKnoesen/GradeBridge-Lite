// =====================================================
// Does ink in a band along a crop's edge tell a truncated answer from a whole one?
// =====================================================
// The measurement behind WORKORDER_CROP_FLAGS_2026-09-03 item 2, kept because
// its answer was **no** and the next person to propose an `edge-contact` flag
// should not have to re-derive that.
//
// It measures, for each of the 23 OCR triage crops, the fraction of ink in a
// band along each of the four edges — under BOTH definitions of ink the
// codebase has:
//
//   global   cropRegions.inkFraction: whole-crop mean, minus 40 grey levels
//   local    raster.adaptiveInk: a local mean, the definition built for shading
//
// Neither separates the populations, and they disagree about which crops are
// extreme. See REPORT_CROP_FLAGS_2026-09-03.md §2.
//
//   node tests/edgeBandProbe.mjs [bandMm] [radiusMm] [offset]
//
// Needs GradeBridge2026/CaptureSet/ocr_triage, which is not in this repository.
import { webcrypto } from 'node:crypto';
globalThis.crypto ??= webcrypto;
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { loadModule } from './captureSet.mjs';

const DIR = process.env.OCR_TRIAGE
  ?? 'C:/Users/aknoesen/Documents/BridgeSuite/GradeBridge2026/CaptureSet/ocr_triage';
if (!existsSync(join(DIR, 'INDEX.json'))) {
  console.log(`SKIP: the OCR triage crops are not checked out at ${DIR}`);
  console.log('Set OCR_TRIAGE to their folder to run this.');
  process.exit(0);
}

const ras = await loadModule('services/raster.ts', 'r_ebp.mjs');
const BAND_MM = Number(process.argv[2] ?? 2.0);
const RADIUS_MM = Number(process.argv[3] ?? 3.0);
const OFFSET = Number(process.argv[4] ?? 18);

const index = JSON.parse(readFileSync(join(DIR, 'INDEX.json'), 'utf8'));
const byFile = Object.fromEntries(index.map(r => [r.file, r]));

/** The triage's own list, its section 3.1: the answer is outside the crop. */
const TRUNCATED = new Set([
  'ios2_02__p4.png', 'ios2_03__p4.png',
  ...['android09_p3_angle', 'android10_p3_dim', 'android11_p3_others', 'android12_p3_quick1', 'android13_p3_quick2']
    .flatMap(c => [`${c}__p1b.png`, `${c}__p1c.png`]),
]);

const luma = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
const EDGES = ['top', 'bottom', 'left', 'right'];

const rows = [];
for (const file of readdirSync(join(DIR, 'crops')).filter(f => f.endsWith('.png')).sort()) {
  const meta = byFile[file];
  if (!meta) continue;
  const { width: w, height: h, data } = PNG.sync.read(readFileSync(join(DIR, 'crops', file)));
  const n = w * h;
  const band = Math.max(1, Math.round(BAND_MM * meta.pxPerMm));

  // --- global: exactly what cropRegions.inkFraction calls ink ---
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) sum += luma(data, i);
  const cut = sum / n - 40;
  const globalMask = new Uint8Array(n);
  for (let p = 0, i = 0; p < n; p++, i += 4) globalMask[p] = luma(data, i) < cut ? 1 : 0;

  // --- local: exactly what raster.adaptiveInk calls ink ---
  const gray = { data: new Uint8Array(n), width: w, height: h };
  for (let p = 0, i = 0; p < n; p++, i += 4) gray.data[p] = luma(data, i) | 0;
  const localMask = ras.adaptiveInk(gray, 0, 0, w, h, RADIUS_MM * meta.pxPerMm, OFFSET);

  const frac = (mask, x0, y0, x1, y1) => {
    let d = 0, t = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { t++; if (mask[y * w + x]) d++; }
    return t ? d / t : 0;
  };
  const edges = (mask) => ({
    top: frac(mask, 0, 0, w, Math.min(band, h)),
    bottom: frac(mask, 0, Math.max(0, h - band), w, h),
    left: frac(mask, 0, 0, Math.min(band, w), h),
    right: frac(mask, Math.max(0, w - band), 0, w, h),
  });
  rows.push({
    name: file.replace('.png', ''), truncated: TRUNCATED.has(file), pxPerMm: meta.pxPerMm,
    global: edges(globalMask), local: edges(localMask),
  });
}

const pc = (v) => (100 * v).toFixed(2).padStart(6);
const worst = (e) => Math.max(...EDGES.map(k => e[k]));

console.log(`band ${BAND_MM} mm; local-mean radius ${RADIUS_MM} mm, offset ${OFFSET}\n`);
console.log('crop                             px/mm  ---- global ink ----  ---- local ink -----   T');
console.log('                                          worst  edge          worst  edge');
for (const r of rows) {
  const gw = worst(r.global), lw = worst(r.local);
  console.log(
    r.name.padEnd(32), String(r.pxPerMm).padStart(5),
    pc(gw), EDGES.filter(k => r.global[k] === gw).join(',').padEnd(8),
    pc(lw), EDGES.filter(k => r.local[k] === lw).join(',').padEnd(8),
    r.truncated ? ' *' : '');
}

for (const [label, pick] of [['global', r => worst(r.global)], ['local', r => worst(r.local)]]) {
  const T = rows.filter(r => r.truncated).map(pick).sort((a, b) => a - b);
  const U = rows.filter(r => !r.truncated).map(pick).sort((a, b) => a - b);
  const sep = T[0] > U[U.length - 1];
  console.log(`\n${label}: truncated ${pc(T[0])} .. ${pc(T[T.length - 1])}   ` +
    `untruncated ${pc(U[0])} .. ${pc(U[U.length - 1])}   ` +
    (sep ? `SEPARATE` : `OVERLAP over ${pc(Math.min(T[T.length - 1], U[U.length - 1]) - Math.max(T[0], U[0]))} of range`));
}
console.log('\n* = the triage\'s section 3.1 list: 12 of 23 crops whose answer is outside the crop.');
