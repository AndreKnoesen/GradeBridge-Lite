// =====================================================
// The capture quality gate, against the sixteen photographs
// =====================================================
// `tests/captures/LABELS.csv` is the specification and its `review` column is
// the target. This suite is the acceptance criterion from
// `workorders/WORKORDER_QUALITY_GATE_2026-09-01.md`, and it is deliberately an
// EXACT agreement rather than a rate: a capture in the PASS set that the gate
// rejects is a failure, and so is a capture in the FAIL set that it passes.
//
// The photographs are the evidence. Nothing here is measured against a
// synthetic or a rendered-then-degraded page — the detector once scored 12 of
// 12 on its own synthetics and 4 of 11 on real photographs, which is the whole
// reason this file exists separately from `registration-tests.mjs`.
//
//   node tests/gate-tests.mjs            run it
//   node tests/gate-tests.mjs --table    run it and print the full table
// =====================================================

import { webcrypto } from 'node:crypto';
globalThis.crypto ??= webcrypto;

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadModule, CAPTURE_DIR } from './captureSet.mjs';
import { ingestLikeApp } from './realCaptures.mjs';

const gate = await loadModule('services/captureGate.ts', 'captureGate.mjs');
const fmt = await loadModule('services/pageFormat.ts', 'pageFormat_gate.mjs');
const qrp = await loadModule('services/qrPayload.ts', 'qrPayload_gate.mjs');

let failures = 0;
const check = (name, condition, detail = '') => {
  if (condition) return;
  failures++;
  console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
};

// ---------- the labels ----------
const labelPath = join(CAPTURE_DIR, 'LABELS.csv');
if (!existsSync(labelPath)) {
  console.error('tests/captures/LABELS.csv is missing — it is the specification for this suite.');
  process.exit(1);
}
// The `reason` columns are prose in double quotes and several of them contain
// commas, so a plain split on `,` reads the wrong field and silently mislabels
// two captures — which in a suite whose whole point is exact agreement with this
// file would be a very quiet way to test nothing.
const splitCsvLine = (line) => {
  const cells = [];
  let cell = '', quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { cells.push(cell); cell = ''; }
    else cell += ch;
  }
  cells.push(cell);
  return cells.map(c => c.trim());
};

const labels = new Map();
{
  const lines = readFileSync(labelPath, 'utf8').trim().split(/\r?\n/);
  const head = splitCsvLine(lines[0]);
  const nameAt = head.indexOf('name'), reviewAt = head.indexOf('review');
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line);
    labels.set(cells[nameAt], cells[reviewAt]);
  }
}

// ---------- the captures ----------
const captures = [];
for (const folder of ['real', 'stale']) {
  const dir = join(CAPTURE_DIR, folder);
  if (!existsSync(dir)) continue;
  for (const file of readdirSync(dir).filter(n => /\.(jpe?g|png)$/i.test(n)).sort()) {
    const name = file.replace(/\.[^.]+$/, '');
    captures.push({ name, path: join(dir, file), want: labels.get(name) });
  }
}

console.log(`capture quality gate — ${captures.length} photographs\n`);
check('every capture is labelled', captures.every(c => c.want === 'PASS' || c.want === 'FAIL'),
  captures.filter(c => !c.want).map(c => c.name).join(', '));
check('the set is the sixteen the work order names', captures.length === 16,
  `found ${captures.length}`);

// ---------- run ----------
const rows = [];
for (const c of captures) {
  const image = ingestLikeApp(c.path);
  let verdict = null, threw = null;
  const t0 = Date.now();
  try {
    verdict = gate.runCaptureGate(image);
  } catch (err) {
    threw = err;
  }
  const wallMs = Date.now() - t0;
  rows.push({ ...c, verdict, threw, wallMs });
}

// ---------- the acceptance criteria ----------
for (const r of rows) {
  // "Fail closed. Any throw, timeout, or inconclusive check is a rejection with
  //  a reason. Never a blank screen, never a silent partial success."
  check(`${r.name}: no throw`, r.threw === null, r.threw && String(r.threw.message));
  if (!r.verdict) continue;

  const got = r.verdict.pass ? 'PASS' : 'FAIL';
  check(`${r.name}: gate agrees with LABELS.csv`, got === r.want,
    `wanted ${r.want}, got ${got}${r.verdict.failed ? ` (${r.verdict.failed})` : ''}`);

  // "Every rejection returns the check that failed and the student-facing message."
  if (!r.verdict.pass) {
    check(`${r.name}: names the failing check`, typeof r.verdict.failed === 'string' && r.verdict.failed);
    check(`${r.name}: carries a student-facing message`, r.verdict.message.length > 20);
  } else {
    check(`${r.name}: a pass names no failing check`, r.verdict.failed === null);
    check(`${r.name}: a pass shows the student nothing`, r.verdict.message === '');
    // "Registration residual under 1.0 mm on all 12 that pass."
    const residual = r.verdict.measurements.residualMm;
    check(`${r.name}: residual under ${fmt.RESIDUAL_MAX_MM} mm`,
      typeof residual === 'number' && residual < fmt.RESIDUAL_MAX_MM, `${residual} mm`);
    check(`${r.name}: four marks`, r.verdict.measurements.marksFound === 4,
      String(r.verdict.measurements.marksFound));
    check(`${r.name}: a pass carries the transform the crops need`,
      r.verdict.registration !== null && r.verdict.registration.transform !== null);
  }

  // "Hard budget, 2 s per page. Budget spent equals reject."
  check(`${r.name}: inside the ${gate.GATE_BUDGET_MS} ms budget`, r.wallMs <= gate.GATE_BUDGET_MS,
    `${r.wallMs} ms`);
}

const passed = rows.filter(r => r.verdict && r.verdict.pass).length;
const rejected = rows.length - passed;
check('exactly 12 pass', passed === 12, String(passed));
check('exactly 4 are rejected', rejected === 4, String(rejected));

// ---------- the guards that are not about the sixteen ----------
//
// The hazard `cap09` was supposed to demonstrate — a decode that succeeds and
// returns an empty string, carrying an empty layout_id into the pipeline — does
// not reproduce at the resolution the app works in. The guard against it is one
// line and is kept regardless, because the hazard is real at other scales. This
// asserts the guard rather than the capture.
check('an empty payload is not a page payload', qrp.parsePayload('') === null);
check('a foreign QR is not a page payload', qrp.parsePayload('https://example.com') === null);
check('a truncated page payload is rejected', qrp.parsePayload('GB1-ENG17HOM496F-HWMSTR-6-14') === null);
check('a well-formed page payload parses',
  qrp.parsePayload('GB1-ENG17HOM496F-HWMSTR-6-14-2DCC8D1E') !== null);

// A verdict must be renderable on every path, including the one where the image
// is nonsense. This is the fail-closed contract, exercised rather than asserted.
{
  const empty = { data: new Uint8ClampedArray(4 * 4 * 4), width: 4, height: 4 };
  let verdict = null;
  try {
    verdict = gate.runCaptureGate(empty);
  } catch (err) {
    check('a 4x4 image does not throw', false, String(err.message));
  }
  check('a 4x4 image is rejected with a reason',
    verdict !== null && verdict.pass === false && verdict.failed !== null && verdict.message !== '');
}

// ---------- the table ----------
const table = process.argv.includes('--table') || failures > 0;
if (table) {
  console.log('name     want  got   failing check   marks  residual   sharp   minLuma   ms');
  for (const r of rows) {
    const v = r.verdict;
    const m = v ? v.measurements : null;
    const num = (x, d) => (typeof x === 'number' ? x.toFixed(d) : '—');
    console.log(
      r.name.padEnd(8),
      String(r.want).padEnd(5),
      (v ? (v.pass ? 'PASS' : 'FAIL') : 'THREW').padEnd(5),
      String(v && v.failed ? v.failed : '').padEnd(15),
      String(m ? m.marksFound : '—').padEnd(6),
      (m && m.residualMm !== null ? `${num(m.residualMm, 3)} mm` : '—').padEnd(10),
      num(m && m.sharpness, 4).padEnd(7),
      num(m && m.minTileLuma, 1).padEnd(9),
      String(r.wallMs),
    );
  }
  console.log();
}

console.log(`${passed} pass, ${rejected} rejected` +
  (failures === 0 ? ' — exact agreement with LABELS.csv\n' : '\n'));

if (failures > 0) {
  console.error(`capture gate: ${failures} check(s) failed`);
  process.exit(1);
}
console.log('capture gate: all checks passed');
