// =====================================================
// aiFeedback pass-through tests
// =====================================================
// One per-assignment boolean, set in the Assignment Maker, carried by this app
// to Gradescope, which owns the election, the tally and the pointer. The app
// itself never reads it and must never show it.
//
//   npm test
//
// Why these are source-level. Two things can break: the key emitted into the
// submission JSON, and the autosave that has to carry the flag across a closed
// tab. The emission now lives in `services/submissionPackage.ts` — it was in
// `App.tsx` until the packaging was lifted out of the component so a test could
// build a submission — and the autosave is still in `App.tsx`, which cannot be
// imported here because it pulls React and the whole component tree. So instead
// of restating the logic in a copy that could quietly diverge, each check
// EXTRACTS the real expression from the file and evaluates that. A rename, a
// dropped `=== true`, or an autosave that switches to picking named assignment
// fields fails here.
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
const pkgSrc = readFileSync(join(REPO, 'services', 'submissionPackage.ts'), 'utf8');
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
const emitMatch = pkgSrc.match(/\n\s*ai_feedback:\s*([^\n]+?),?\s*\n/);

check('submissionPackage: the submission JSON emits an `ai_feedback` key', () =>
  assert(emitMatch, 'no `ai_feedback:` key found in services/submissionPackage.ts'));

/** The `submissionJson` literal, wherever it lives, closed at its own indent. */
const submissionJsonLiteral = () => {
  const start = pkgSrc.search(/const submissionJson(: [^=]+)? = \{/);
  assert(start !== -1, 'submissionJson object literal not found');
  const end = pkgSrc.indexOf('\n  };', start);
  assert(end !== -1, 'end of the submissionJson literal not found');
  return pkgSrc.slice(start, end);
};

check('submissionPackage: `ai_feedback` sits in the submissionJson object literal', () => {
  // The declaration may carry a type annotation (it gained one when the
  // handwritten fields were added, which are set on the object afterwards).
  // What this check is for is unchanged: the flag must be part of the literal
  // every submission is built from, not spliced in on some branch.
  assert(submissionJsonLiteral().includes('ai_feedback:'),
    'ai_feedback is somewhere in submissionPackage.ts but not inside submissionJson');
});

check('submissionPackage: the handwritten rewrite did not put `ai_feedback` behind a branch', () => {
  assert(!/\bif\s*\(/.test(submissionJsonLiteral()),
    'the submissionJson literal now contains a conditional — ai_feedback must be unconditional');
});

if (emitMatch) {
  // The real expression out of the file, evaluated against a mock state. Not a
  // restatement of it — if the source says something else, this runs that.
  const expr = emitMatch[1];
  // The parameter is named `s` because that is what the expression in
  // `buildSubmissionJson` reads from — the sources object, not React state.
  const emit = new Function('s', `return (${expr});`);
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
// wrong. `services/submissionPackage.ts` is allowed exactly the one emission
// line, `App.tsx` none at all now that the packaging has moved out of it, and
// nothing under components/ may mention it.
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

  const nonComment = (src) => src.split('\n')
    .map((line, i) => [i + 1, line])
    .filter(([, line]) => /aiFeedback|ai_feedback/.test(line))
    .filter(([, line]) => !/^(\/\/|\*)/.test(line.trim()));

  check('submissionPackage: mentions the flag only where it is read and emitted', () => {
    const hits = nonComment(pkgSrc);
    for (const [n, line] of hits) {
      assert(/ai_feedback:\s*s\.assignment\.aiFeedback === true,/.test(line),
        `unexpected AI-feedback reference at services/submissionPackage.ts:${n}: ${line.trim()}`);
    }
    assert(hits.length === 1,
      `expected exactly one non-comment AI-feedback line in submissionPackage.ts, found ${hits.length}`);
  });

  // App.tsx used to carry the emission line. It carries none now that the
  // packaging moved out, and it must not grow one back: a second place that
  // decides this flag is a second place that can disagree.
  check('App.tsx: no longer mentions the flag at all', () => {
    const hits = nonComment(appSrc);
    assert(hits.length === 0,
      `App.tsx should not reference AI feedback now that packaging has moved:\n          ` +
      hits.map(([n, l]) => `${n}: ${l.trim()}`).join('\n          '));
  });
}

// ---------- report ----------
console.log(results.join('\n'));
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
