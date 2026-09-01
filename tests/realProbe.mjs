// Scratch diagnostic for the real set — not part of `npm test`.
//   node tests/realProbe.mjs
import { webcrypto } from 'node:crypto';
globalThis.crypto ??= webcrypto;

import { loadModule } from './captureSet.mjs';
import { ingestLikeApp, listRealCaptures } from './realCaptures.mjs';

const qrd = await loadModule('services/qrDecode.ts', 'q_probe.mjs');
const reg = await loadModule('services/registration.ts', 'r_probe.mjs');

console.log('\nfile          ingested     exif  QR    marks  status          residual    manifest');
let qrOk = 0, usable = 0, marks4 = 0;
let totalMs = 0, worstMs = 0;
const rows = listRealCaptures();
for (const c of rows) {
  const img = ingestLikeApp(c.path);
  const t0 = Date.now();
  const r = reg.registerPage(img);
  const ms = Date.now() - t0;
  totalMs += ms; worstMs = Math.max(worstMs, ms);
  const qr = r.qr;
  if (qr) qrOk++;
  if (r.usable) usable++;
  if (r.marksFound === 4) marks4++;
  const t = c.truth;
  console.log(
    c.file.padEnd(13),
    `${img.width}x${img.height}`.padEnd(12),
    String(img.orientation).padEnd(5),
    (qr ? 'ok' : 'FAIL').padEnd(5),
    `${r.marksFound}/4`.padEnd(6),
    r.status.padEnd(15),
    (r.residualMm === null ? '   —    ' : `${r.residualMm.toFixed(3)} mm`).padEnd(12),
    `${(ms / 1000).toFixed(1)}s`.padEnd(6),
    (qr ? qr.foundBy : '') + (t && t.page_k ? `  [manifest k=${t.page_k}]` : '  [manifest: no decode]')
  );
}
console.log(`\nREAL SET: QR ${qrOk}/${rows.length}, 4-of-4 marks ${marks4}/${rows.length}, usable ${usable}/${rows.length}\n`);
