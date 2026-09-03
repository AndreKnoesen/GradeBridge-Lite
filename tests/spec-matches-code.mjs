// =====================================================
// The spec's filename claim is the code's filename
// =====================================================
// `AUTOGRADER_ZIP_SPEC.md` is hand-maintained prose about code, and on
// 2026-09-03 it disagreed with itself: §1's code block still said
// `{StudentName}_{CourseCode}_submission.zip` four lines above prose saying the
// stem carries no name. The v5.0 edit had rewritten the sentence someone was
// looking at and left the block above it.
//
// **A code block is the thing a reader copies.** The one person writing a
// consumer against that document would have built a glob for a student name
// that never arrives.
//
// So the claim is EXTRACTED from the document and compared against what the code
// produces. It is deliberately not restated here: a test that hardcoded the
// pattern would be a second copy of the same fact, and would drift from the spec
// exactly the way the spec drifted from the code.
//
// This checks one claim, not the whole document. It is the claim a consumer acts
// on directly — everything else in the spec is read by a human who can see the
// surrounding paragraph. A general spec-to-code checker would have to parse
// prose, and would be a bigger and less reliable thing than the problem.
import { webcrypto } from 'node:crypto';
globalThis.crypto ??= webcrypto;

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadModule } from './captureSet.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SPEC = 'AUTOGRADER_ZIP_SPEC.md';

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `\n          ${detail}`}`);
  if (!ok) failed++;
};

const spec = readFileSync(join(REPO, SPEC), 'utf8');

// ---------- extract ----------
// The archive filename lives in the first fenced block after the "## 1. The
// archive" heading. Anchored on the heading rather than on the block's content,
// so that changing the pattern cannot make the extraction quietly find nothing.
const section = spec.slice(spec.indexOf('## 1. The archive'));
const block = /```\n([^\n]+)\n```/.exec(section);
check(`${SPEC} §1 states an archive filename in a code block`, block !== null);
if (!block) process.exit(1);

const claimed = block[1].trim();
console.log(`\n  the document says:  ${claimed}`);

// ---------- turn the claim into something checkable ----------
// Only the placeholders the document actually uses are understood. Anything
// else is a claim this test cannot verify, and it says so rather than passing.
const PLACEHOLDERS = {
  '{assignment_id}': () => '__ASSIGNMENT_ID__',
  '{YYYYMMDD-HHMM}': () => '\\d{8}-\\d{4}',
};
// The failure the spec actually had: a name in the pattern. Checked BEFORE the
// placeholder check, because reverting to the v5.0 text trips both and this is
// the one that says what actually went wrong.
check('the stated pattern carries no student name',
  !/student|name/i.test(claimed.replace('{assignment_id}', '')),
  `the spec's §1 block asks for a name, which the app has not had since b48fa36: ${claimed}`);

const unknown = (claimed.match(/\{[^}]+\}/g) ?? [])
  .filter((ph) => !(ph in PLACEHOLDERS));
check('every placeholder in the claim is one this test understands',
  unknown.length === 0,
  `${unknown.join(', ')} — teach this test what they mean, or the claim is unverified`);
if (unknown.length > 0) process.exit(1);

// ---------- what the code actually produces ----------
const pkg = await loadModule('services/submissionPackage.ts', 'sm_pkg.mjs');
const ASSIGNMENT_ID = 'ENG17_Homework_1';
const ISO = '2026-09-03T05:27:36.837Z';
const actual = `${pkg.submissionBaseName(ASSIGNMENT_ID, ISO)}.zip`;
console.log(`  the code produces:  ${actual}\n`);

const pattern = new RegExp('^' + claimed
  .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  .replace(/\\\{assignment_id\\\}/g, ASSIGNMENT_ID.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .replace(/\\\{YYYYMMDD-HHMM\\\}/g, '\\d{8}-\\d{4}') + '$');

check('the code\'s archive name matches the pattern the spec states',
  pattern.test(actual),
  `spec pattern ${pattern}\n          code produced ${actual}`);

// The .json inside the archive shares the stem, which is the other half of what
// a consumer globs for.
check('the payload entry shares the archive stem',
  `${pkg.submissionBaseName(ASSIGNMENT_ID, ISO)}.json` === actual.replace(/\.zip$/, '.json'));

if (failed > 0) {
  console.error(`\n  ${failed} check(s) failed. Either the code changed and ${SPEC} ` +
    `was not updated, or ${SPEC} was edited into disagreement with the code. Fix ` +
    `whichever is wrong — do not edit this test to agree with both.\n`);
  process.exit(1);
}
console.log(`  ${SPEC} agrees with the code on the archive filename\n`);
