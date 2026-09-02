// =====================================================
// The capture quality gate, against the forty-one photographs
// =====================================================
// `tests/captures/LABELS.csv` is the specification and its `review` column is
// the target. This suite is the acceptance criterion from
// `workorders/WORKORDER_QUALITY_GATE_2026-09-01.md`, and it is deliberately an
// EXACT agreement rather than a rate: a capture in the PASS set that the gate
// rejects is a failure, and so is a capture in the FAIL set that it passes.
//
// It was the sixteen in `real/` and `stale/` until 2026-09-02, when the other
// twenty-five — thirteen from a Samsung Galaxy S22 and twelve of real student
// work from two iPhones — were labelled. The sixteen remain the calibration
// set: every threshold in the detector and in the gate is set from them, and
// their 12/4 split is asserted separately for that reason. The other
// twenty-five are held to the same exact agreement but no threshold is fitted
// to them; where the gate disagrees with a label it is pinned in `KNOWN_OPEN`,
// which is a list that must shrink.
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
//
// All four folders. `real/` and `stale/` are the original sixteen and are
// tracked; `android/` (a Samsung Galaxy S22) and `students/` (two iPhones, real
// student work) are not yet, so they may be absent on a given machine. The
// suite says so rather than counting an absent photograph as agreement.
const TRACKED = ['real', 'stale'];
const UNTRACKED = ['android', 'students'];

const captures = [];
const missingFolders = [];
for (const folder of [...TRACKED, ...UNTRACKED]) {
  const dir = join(CAPTURE_DIR, folder);
  if (!existsSync(dir)) { missingFolders.push(folder); continue; }
  for (const file of readdirSync(dir).filter(n => /\.(jpe?g|png)$/i.test(n)).sort()) {
    const name = file.replace(/\.[^.]+$/, '');
    captures.push({ name, folder, path: join(dir, file), want: labels.get(name) });
  }
}

console.log(`capture quality gate — ${captures.length} photographs\n`);
for (const folder of missingFolders) console.log(`  SKIP  ${folder}/ is not checked out`);

check('every capture on disk is labelled',
  captures.every(c => c.want === 'PASS' || c.want === 'FAIL'),
  captures.filter(c => c.want !== 'PASS' && c.want !== 'FAIL').map(c => c.name).join(', '));

// The other direction, which is what catches a photograph deleted or renamed
// out from under a row that still claims to specify it.
{
  const onDisk = new Set(captures.map(c => c.name));
  const orphans = [...labels.keys()].filter(n => !onDisk.has(n));
  check('every label has a photograph', orphans.length === 0 || missingFolders.length > 0,
    orphans.join(', '));
  if (orphans.length && missingFolders.length > 0) {
    console.log(`  SKIP  ${orphans.length} labelled captures are not checked out`);
  }
}
check('the tracked set is the sixteen',
  captures.filter(c => TRACKED.includes(c.folder)).length === 16,
  `found ${captures.filter(c => TRACKED.includes(c.folder)).length}`);

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

//
// Exact agreement with `LABELS.csv` is the criterion, and these two do not
// agree. They are enumerated here rather than excused, and each entry asserts
// the CURRENT wrong verdict — so when the underlying cause is fixed this suite
// goes RED and the entry has to be deleted. An exemption that outlives its own
// fix is how a known bug becomes a permanent one.
//
// Anything not on this list must agree. A new disagreement fails.
// ---------- the captures the gate currently gets wrong ----------
//
// Exact agreement with `LABELS.csv` is the criterion, and one capture does not
// agree. It is enumerated here rather than excused, and the entry asserts the
// CURRENT wrong verdict — so when the underlying cause is fixed this suite goes
// RED and the entry has to be deleted. An exemption that outlives its own fix
// is how a known bug becomes a permanent one.
//
// **`ios2_05` was here until 2026-09-02 and is gone because it was fixed**, which
// is the mechanism working: the padding-mask change made it agree, this suite
// failed on "it agrees now — delete this KNOWN_OPEN entry", and the entry was
// deleted. Nothing else may leave this list any other way.
//
// Anything not on this list must agree. A new disagreement fails.
const KNOWN_OPEN = {
  android04_p2_others_qr: {
    got: 'FAIL', failed: 'page_code',
    why: 'the target page is fully visible and readable, and no symbol on it '
      + 'decodes while neighbouring sheets show their own codes. Reviewed PASS',
  },
};

// ---------- the acceptance criteria ----------
for (const r of rows) {
  // "Fail closed. Any throw, timeout, or inconclusive check is a rejection with
  //  a reason. Never a blank screen, never a silent partial success."
  check(`${r.name}: no throw`, r.threw === null, r.threw && String(r.threw.message));
  if (!r.verdict) continue;

  const got = r.verdict.pass ? 'PASS' : 'FAIL';
  const open = KNOWN_OPEN[r.name];
  if (open) {
    // Pinned, not excused. Both halves must still hold: the gate still returns
    // this answer, AND it is still the wrong one.
    check(`${r.name}: still the known-open verdict — ${open.why}`,
      got === open.got && r.verdict.failed === open.failed,
      `now ${got}${r.verdict.failed ? ` (${r.verdict.failed})` : ''}`);
    check(`${r.name}: still disagrees with LABELS.csv, so the entry is still needed`,
      got !== r.want, 'it agrees now — delete this KNOWN_OPEN entry');
  } else {
    check(`${r.name}: gate agrees with LABELS.csv`, got === r.want,
      `wanted ${r.want}, got ${got}${r.verdict.failed ? ` (${r.verdict.failed})` : ''}`);
  }

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
    // Three or four. The sixteen all find four and that is asserted below as a
    // property of THIS set, not of the gate — the gate's own floor is
    // `MARKS_MIN`, and a capture that met it on three would be a legitimate
    // pass, just not one of these.
    check(`${r.name}: at least ${gate.MARKS_MIN} marks`,
      r.verdict.measurements.marksFound >= gate.MARKS_MIN,
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

// The original sixteen keep their own count, stated separately, because every
// threshold in the detector and in this gate was set from them and a change
// that moves this number has moved a calibration.
const sixteen = rows.filter(r => TRACKED.includes(r.folder));
if (sixteen.length === 16) {
  const p16 = sixteen.filter(r => r.verdict && r.verdict.pass).length;
  check('of the sixteen, exactly 12 pass', p16 === 12, String(p16));
  check('of the sixteen, exactly 4 are rejected', 16 - p16 === 4, String(16 - p16));
  // The 2026-09-02 three-mark change must not have moved this set at all, and
  // the strongest form of that is the count itself: all twelve passes here are
  // four-mark fits, before the change and after it. A three-mark pass would be
  // legitimate under `MARKS_MIN` — it just would not be one of these.
  check('all twelve of the sixteen that pass are four-mark fits',
    sixteen.filter(r => r.verdict && r.verdict.pass)
      .every(r => r.verdict.measurements.marksFound === 4),
    sixteen.filter(r => r.verdict && r.verdict.pass && r.verdict.measurements.marksFound !== 4)
      .map(r => `${r.name}=${r.verdict.measurements.marksFound}`).join(', '));
}

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

// ---------- registration mechanism, WORKORDER_PADDING_MASK_2026-09-02 ----------
//
// The verdicts above come from `LABELS.csv`, which covers all 41. What this
// asserts is the MECHANISM underneath five of them, which a pass/fail column
// cannot express: how many marks the fit used, which corners, how far out it
// landed, and — for a page accepted on three — that the record says so.
//
// These five are where two changes met. `MARKS_MIN` went to 3 on 2026-09-02
// because a three-mark fit at a good residual is worth accepting; the padding
// mask landed the same day and gave two of these captures back the mark they
// had been losing to `rotateGray`'s white fill. Both are asserted here, on the
// same captures, because the interaction is the thing most likely to be broken
// by a later edit to either.
const MECHANISM_CASES = [
  {
    name: 'ios2_01', folder: 'students',
    // Before the padding mask: 3 marks (NW+NE+SE) at 0.611 mm. After: the SW
    // mark is recovered and it is an ordinary four-mark fit.
    marks: 4, detected: ['NW', 'NE', 'SW', 'SE'], status: 'ok',
    maxResidual: fmt.RESIDUAL_MAX_MM,
    // And it is STILL refused, by a different check. The shadow is real: the
    // photographer's own head and shoulders lie hard across the answer box.
    // Recovering a corner mark does not make a page legible, and the two
    // questions are meant to stay separate.
    want: 'FAIL', failed: 'legibility',
  },
  {
    name: 'ios2_05', folder: 'students',
    // The capture this work order was written for. It now PASSES.
    //
    // It registers on THREE marks, not four, and that is not a leftover of the
    // padding defect — all four are found. The three-mark affine reprojects the
    // QR to 0.416 mm and the four-mark homography to 0.756 mm, and
    // `DEGRADED_PENALTY_MM` is 0.25, so the affine wins on score by 0.09 mm.
    // See the report: measured against the marks themselves rather than the QR,
    // that affine is 3.162 mm out at the NW mark it declined to use. The
    // penalty is a threshold and this work order forbids moving one, so the
    // behaviour is pinned here rather than changed.
    want: 'PASS', marks: 3, detected: ['NE', 'SW', 'SE'], status: 'degraded',
    maxResidual: fmt.RESIDUAL_MAX_MM, degraded: true,
  },
  {
    name: 'ios2_04', folder: 'students',
    // The page is genuinely cut off at the right and the bottom: only NW and NE
    // are on the paper that was photographed. Two candidates cannot make a fit,
    // so `marksFound` is 0 — no fit was formed, which is not the same as no
    // candidate being found, and the distinction is why this case is here.
    want: 'FAIL', failed: 'corner_marks', marks: 0, status: 'too_few_marks',
  },
  {
    name: 'android01_p2_straight', folder: 'android',
    want: 'FAIL', failed: 'corner_marks', marks: 4, minResidual: 1.0,
  },
  {
    name: 'android08_p3_straight', folder: 'android',
    want: 'FAIL', failed: 'corner_marks', marks: 4, minResidual: 2.0,
  },
];

for (const c of MECHANISM_CASES) {
  const path = join(CAPTURE_DIR, c.folder, `${c.name}.jpg`);
  if (!existsSync(path)) {
    console.log(`  SKIP  ${c.name}: not checked out (${c.folder}/)`);
    continue;
  }
  const v = gate.runCaptureGate(ingestLikeApp(path));
  const m = v.measurements;
  const seen = `${v.pass ? 'PASS' : `FAIL (${v.failed})`} on ${m.marksFound} marks` +
    `${v.registration && v.registration.marksDetected.length ? ` (${v.registration.marksDetected.join('+')})` : ''}` +
    `, residual ${m.residualMm === null ? 'none' : m.residualMm.toFixed(3)} mm` +
    `${m.minTileLuma === null ? '' : `, luma ${m.minTileLuma.toFixed(1)}`}`;

  check(`${c.name}: ${c.want}`, (v.pass ? 'PASS' : 'FAIL') === c.want, seen);
  if (c.failed) check(`${c.name}: refused at ${c.failed}`, v.failed === c.failed, seen);
  check(`${c.name}: registers on ${c.marks} marks`, m.marksFound === c.marks, seen);
  if (c.detected) {
    check(`${c.name}: on ${c.detected.join('+')}`,
      v.registration !== null && v.registration.marksDetected.join('+') === c.detected.join('+'),
      v.registration ? v.registration.marksDetected.join('+') || 'none' : 'none');
  }
  if (c.status) {
    check(`${c.name}: registration status ${c.status}`,
      v.registration !== null && v.registration.status === c.status,
      v.registration ? v.registration.status : 'none');
  }
  if (typeof c.maxResidual === 'number') {
    check(`${c.name}: residual under ${c.maxResidual} mm`,
      typeof m.residualMm === 'number' && m.residualMm < c.maxResidual, seen);
  }
  if (typeof c.minResidual === 'number') {
    // The rejection must stay a residual rejection. If this number ever falls
    // inside the budget the page is passing for a reason nothing here tested.
    check(`${c.name}: residual still over ${c.minResidual} mm`,
      typeof m.residualMm === 'number' && m.residualMm > c.minResidual, seen);
  }
  // A page registered on three marks must SAY so, and say WHICH three: the
  // status, the count and the corner list all travel into the submission
  // manifest as `registration`, `marks_found` and `marks_detected`, which is
  // where a grader looking at a disputed crop reads them. The absent corner
  // names the end of the sheet the transform inferred rather than measured.
  if (c.degraded) {
    check(`${c.name}: the record says which three it registered on`,
      v.registration !== null && v.registration.status === 'degraded' &&
      v.registration.marksFound === 3 && v.registration.marksDetected.length === 3,
      v.registration ? `${v.registration.status} / ${v.registration.marksDetected.join('+')}` : 'none');
  }
}

// The floor itself, so a future edit that walks it back to four has to argue
// with this line rather than with a capture that may not be checked out.
check('the mark floor is three', gate.MARKS_MIN === 3, String(gate.MARKS_MIN));

// ---------- the table ----------
const table = process.argv.includes('--table') || failures > 0;
if (table) {
  console.log(
    'name                want  got   failing check   marks  detected      ' +
    'residual   sharp   minLuma   ms');
  for (const r of rows) {
    const v = r.verdict;
    const m = v ? v.measurements : null;
    const num = (x, d) => (typeof x === 'number' ? x.toFixed(d) : '—');
    console.log(
      (r.name + (KNOWN_OPEN[r.name] ? ' *' : '')).padEnd(19),
      String(r.want).padEnd(5),
      (v ? (v.pass ? 'PASS' : 'FAIL') : 'THREW').padEnd(5),
      String(v && v.failed ? v.failed : '').padEnd(15),
      String(m ? m.marksFound : '—').padEnd(6),
      String(v && v.registration ? v.registration.marksDetected.join('+') : '').padEnd(13),
      (m && m.residualMm !== null ? `${num(m.residualMm, 3)} mm` : '—').padEnd(10),
      num(m && m.sharpness, 4).padEnd(7),
      num(m && m.minTileLuma, 1).padEnd(9),
      String(r.wallMs),
    );
  }
  console.log('\n  * a known-open disagreement — see KNOWN_OPEN in this file');
  console.log();
}

// Never claim exact agreement while `KNOWN_OPEN` has entries. A green suite
// with two pinned disagreements is a different, weaker statement than a green
// suite with none, and the summary line has to say which one it is.
const openHere = rows.filter(r => KNOWN_OPEN[r.name]).map(r => r.name);
console.log(`${passed} pass, ${rejected} rejected` + (
  failures > 0 ? '\n'
    : openHere.length === 0 ? ' — exact agreement with LABELS.csv\n'
    : ` — agrees with LABELS.csv except ${openHere.length} known open: ` +
      `${openHere.join(', ')}\n`));

if (failures > 0) {
  console.error(`capture gate: ${failures} check(s) failed`);
  process.exit(1);
}
console.log('capture gate: all checks passed');
