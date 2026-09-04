// Scratch diagnostic: the capture gate over every folder in tests/captures/.
// Not part of `npm test` — `gate-tests.mjs` is the suite, and it asserts only
// against the labelled sixteen. This prints the table for all of them.
//   node tests/gateProbe.mjs [folder...]
import { webcrypto } from 'node:crypto';
globalThis.crypto ??= webcrypto;

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadModule, CAPTURE_DIR } from './captureSet.mjs';
import { ingestLikeApp } from './realCaptures.mjs';

const gate = await loadModule('services/captureGate.ts', 'captureGate_probe.mjs');

const FOLDERS = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['real', 'stale', 'students', 'android'];

// The `review` column, where there is one. Only the sixteen in real/ and
// stale/ are labelled; students/ and android/ print a blank `want`, which is the
// honest thing to show — there is no ground truth for them to disagree with.
const labels = new Map();
{
  const labelPath = join(CAPTURE_DIR, 'LABELS.csv');
  if (existsSync(labelPath)) {
    const rows = readFileSync(labelPath, 'utf8').trim().split(/\r?\n/);
    // Several `reason` cells are quoted prose containing commas.
    const cellsOf = (line) => line.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/);
    const head = cellsOf(rows[0]).map(h => h.trim());
    const nameAt = head.indexOf('name'), reviewAt = head.indexOf('review');
    for (const line of rows.slice(1)) {
      const cells = cellsOf(line);
      if (cells[nameAt]) labels.set(cells[nameAt].trim(), (cells[reviewAt] ?? '').trim());
    }
  }
}

console.log('name        folder    want  got   failing check   marks  detected      residual     status      sharp   minLuma   ms');
let n = 0;
for (const folder of FOLDERS) {
  const dir = join(CAPTURE_DIR, folder);
  if (!existsSync(dir)) continue;
  for (const file of readdirSync(dir).filter(f => /\.(jpe?g|png)$/i.test(f)).sort()) {
    const name = file.replace(/\.[^.]+$/, '');
    const image = ingestLikeApp(join(dir, file));
    const t0 = Date.now();
    let v = null, threw = null;
    try { v = gate.runCaptureGate(image); } catch (e) { threw = e; }
    const ms = Date.now() - t0;
    const m = v ? v.measurements : null;
    const num = (x, d) => (typeof x === 'number' ? x.toFixed(d) : '—');
    n++;
    console.log(
      name.padEnd(11),
      folder.padEnd(9),
      String(labels.get(name) ?? '').padEnd(5),
      (v ? (v.pass ? 'PASS' : 'FAIL') : 'THREW').padEnd(5),
      String(v && v.failed ? v.failed : '').padEnd(15),
      String(m ? m.marksFound : '—').padEnd(6),
      String(v && v.registration ? v.registration.marksDetected.join('+') : '').padEnd(13),
      (m && m.residualMm !== null ? `${num(m.residualMm, 3)} mm` : '—').padEnd(12),
      String(v && v.registration ? v.registration.status : (threw ? 'THREW' : '')).padEnd(11),
      num(m && m.sharpness, 4).padEnd(7),
      num(m && m.minTileLuma, 1).padEnd(9),
      String(ms),
    );
  }
}
console.log(`\n${n} captures\n`);
