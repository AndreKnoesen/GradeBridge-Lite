// =====================================================
// aiFeedback pass-through tests
// =====================================================
// One per-assignment boolean, set in the Assignment Maker, carried by this app
// to Gradescope, which owns the election, the tally and the pointer. The app
// itself never reads it and must never show it.
//
//   npm test
//
// Why these are source-level. The two things that can break are both inside
// App.tsx: the key emitted into the submission JSON, and the autosave that has
// to carry the flag across a closed tab. App.tsx cannot be imported here (it
// pulls React and the whole component tree), so instead of restating its logic
// in a copy that could quietly diverge, each check EXTRACTS the real expression
// from the file and evaluates that. A rename, a dropped `=== true`, or an
// autosave that switches to picking named assignment fields fails here.
// =====================================================

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');

// ---------- tiny assertion harness (mirrors the other suites) ----------
let passed = 0, failed = 0;
const results = [];
const check = (name, fn) => {
  try { fn(); passed++; results.push(`  PASS  ${name}`); }
  catch (err) { failed++; results.push(`  FAIL  ${name}\n          ${err.message}`); }
};
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

const appSrc = readFileSync(join(REPO, 'App.tsx'), 'utf8');
const typesSrc = readFileSync(join(REPO, 'types.ts'), 'utf8');

console.log('\naiFeedback — pass-through contract\n');

// =====================================================
// 1. The field exists on Assignment, and only as an optional boolean
// =====================================================
check('types.ts: Assignment carries `aiFeedback?: boolean`', () =>
  assert(/\n\s*aiFeedback\?:\s*boolean;/.test(typesSrc),
    'no `aiFeedback?: boolean;` member found on the Assignment interface'));

// =====================================================
// 2. The emitted key, and the value it produces for every spec shape
// =====================================================
const emitMatch = appSrc.match(/\n\s*ai_feedback:\s*([^\n]+?),?\s*\n/);

check('App.tsx: the submission JSON emits an `ai_feedback` key', () =>
  assert(emitMatch, 'no `ai_feedback:` key found in App.tsx'));

check('App.tsx: `ai_feedback` sits in the submissionJson object literal', () => {
  const start = appSrc.indexOf('const submissionJson = {');
  assert(start !== -1, 'submissionJson object literal not found');
  const end = appSrc.indexOf('\n    };', start);
  assert(end !== -1, 'end of the submissionJson literal not found');
  assert(appSrc.slice(start, end).includes('ai_feedback:'),
    'ai_feedback is somewhere in App.tsx but not inside submissionJson');
});

if (emitMatch) {
  // The real expression out of the file, evaluated against a mock state. Not a
  // restatement of it — if the source says something else, this runs that.
  const expr = emitMatch[1];
  const emit = new Function('state', `return (${expr});`);
  const withFlag = (v) => ({ assignment: v === undefined ? {} : { aiFeedback: v } });

  check('spec `aiFeedback: true` -> `ai_feedback: true`', () => {
    const out = emit(withFlag(true));
    assert(out === true, `got ${JSON.stringify(out)}`);
  });

  // Absent-means-off is the spec's convention on the way IN. On the way OUT the
  // field is always present and always a real boolean, so the autograder never
  // has to distinguish "off" from "an older app version".
  for (const [label, value] of [
    ['false', false],
    ['absent', undefined],
    ['the string "true"', 'true'],
    ['the number 1', 1],
    ['null', null],
  ]) {
    check(`spec ${label} -> \`ai_feedback: false\` (a real boolean)`, () => {
      const out = emit(withFlag(value));
      assert(out === false, `got ${JSON.stringify(out)} (typeof ${typeof out})`);
    });
  }
}

// =====================================================
// 3. The autosave round-trip
// =====================================================
// A student loads a spec, closes the tab, comes back tomorrow and submits. The
// flag rides in state.assignment through localStorage, so the autosave has to
// store the assignment object wholesale rather than picking named fields.
{
  const start = appSrc.indexOf('const toSave = {');
  const literalStart = start === -1 ? -1 : appSrc.indexOf('{', start);
  const literalEnd = start === -1 ? -1 : appSrc.indexOf('\n        };', start);

  check('App.tsx: the autosave `toSave` literal is present', () =>
    assert(start !== -1 && literalEnd !== -1, 'could not locate the autosave toSave object literal'));

  if (start !== -1 && literalEnd !== -1) {
    const literal = appSrc.slice(literalStart, literalEnd + '\n        }'.length);
    const buildToSave = new Function('state', `return (${literal});`);
    const state = {
      studentName: 'Jane Smith',
      assignment: { id: 'a1', courseCode: 'EEC1', title: 'Lab 1', problems: [], aiFeedback: true },
      submissionData: { p0s0: { textAnswer: 'a' } },
      pages: [],
    };

    check('autosave: writes the assignment object wholesale, flag included', () => {
      const saved = buildToSave(state);
      assert(saved.assignment && saved.assignment.aiFeedback === true,
        `autosave dropped the flag: assignment = ${JSON.stringify(saved.assignment)}`);
    });

    check('autosave: flag survives JSON.stringify -> localStorage -> JSON.parse', () => {
      const parsed = JSON.parse(JSON.stringify(buildToSave(state)));
      // The restore path in App.tsx reads `parsed.assignment || null`.
      const restored = parsed.assignment || null;
      assert(restored !== null, 'restore produced a null assignment');
      assert(restored.aiFeedback === true,
        `restored assignment has aiFeedback = ${JSON.stringify(restored.aiFeedback)}`);
    });

    check('restore: App.tsx still restores the assignment wholesale', () =>
      assert(/assignment:\s*parsed\.assignment\s*\|\|\s*null/.test(appSrc),
        'the restore path no longer reads `parsed.assignment || null` — check it still carries aiFeedback'));
  }
}

// =====================================================
// 4. No student-visible surface
// =====================================================
// The app is pass-through only. If a student can see this flag, the change is
// wrong. App.tsx is allowed exactly the one emission line; nothing under
// components/ may mention it at all.
//
// The pattern is the flag's own two spellings, `aiFeedback` / `ai_feedback`,
// not the words "AI feedback". It was written that way because SubmissionWidget
// then said "AI feedback is advisory" in copy belonging to the AI Formative
// submission type, which predated this flag and was unrelated to it. That type
// was removed on 2026-08-18, so no such copy is left — but the pattern stays
// the flag's own spellings, because that is the thing being kept off the page.
{
  const componentFiles = readdirSync(join(REPO, 'components'))
    .filter((f) => /\.(ts|tsx)$/.test(f));

  check('components/: nothing references the aiFeedback flag', () => {
    const hits = [];
    for (const f of componentFiles) {
      const src = readFileSync(join(REPO, 'components', f), 'utf8');
      src.split('\n').forEach((line, i) => {
        if (/aiFeedback|ai_feedback/.test(line)) hits.push(`${f}:${i + 1}: ${line.trim()}`);
      });
    }
    assert(hits.length === 0, `student-facing reference to AI feedback:\n          ${hits.join('\n          ')}`);
  });

  check('App.tsx: mentions the flag only where it is typed, read and emitted', () => {
    const hits = appSrc.split('\n')
      .map((line, i) => [i + 1, line])
      .filter(([, line]) => /aiFeedback|ai_feedback/.test(line))
      .filter(([, line]) => !/^(\/\/|\*)/.test(line.trim()));
    for (const [n, line] of hits) {
      assert(/ai_feedback:\s*state\.assignment\.aiFeedback === true,/.test(line),
        `unexpected AI-feedback reference at App.tsx:${n}: ${line.trim()}`);
    }
    assert(hits.length === 1, `expected exactly one non-comment AI-feedback line in App.tsx, found ${hits.length}`);
  });
}

// ---------- report ----------
console.log(results.join('\n'));
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
