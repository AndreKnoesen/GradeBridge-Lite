// =====================================================
// No process record is tracked
// =====================================================
// Reports, handoffs, directives, session notes, milestone reports, memos and
// start-here files are how one working session hands off to the next. They are
// not developer documentation, they name people and describe individual pieces
// of coursework, and this repository is public.
//
// **An ignore file is not a guard.** The `.gitignore` block for these existed,
// with a comment explaining the reasoning, while nineteen of them were tracked
// anyway: nine under `tests/captures/`, which the patterns did not reach, and
// the rest added before the block was written or added with `-f`. `.gitignore`
// says nothing about a file that is already in the index. This does.
//
// **There is no exemption list, deliberately.** A document that genuinely
// belongs to developers gets a name that is not a process-record name —
// `README.md`, `AUTOGRADER_ZIP_SPEC.md`, `tests/captures/BASELINE_*.md`. An
// exemption list is where the next process record comes to live.
import { execFileSync } from 'node:child_process';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * The same set the `.gitignore` block carries, as regexes over the BASENAME.
 *
 * Matched at any depth: these arrive in subdirectories as often as at the root,
 * and that is exactly how nine of them arrived.
 */
const PROCESS_RECORD = [
  /^HANDOFF_.*\.md$/i,
  /^COMPLETION_.*\.md$/i,
  /^WORKORDER_.*\.md$/i,
  /^WORK_ORDERS_.*\.md$/i,
  /^CORRECTION_.*\.md$/i,
  /^REPORT_.*\.md$/i,
  /^DIRECTIVE_.*\.md$/i,
  /^DECISION_.*\.md$/i,
  /^SESSION_.*\.md$/i,
  /^MILESTONE_.*\.md$/i,
  /^NOTE_.*\.md$/i,
  /^PLAN_.*\.md$/i,
  /^SCHEDULE_.*\.md$/i,
  /^RESUME_.*\.md$/i,
  /^HANDOVER_.*\.md$/i,
  /^BRIEF_.*\.md$/i,
  /^START_HERE.*\.md$/i,
  /_Memo_.*\.md$/i,
  /_Test_Battery_.*\.md$/i,
];

// `git ls-files`, not the working directory. An untracked note beside the code
// is a working file and must not trip this; a committed one must always trip
// it, whether it is ignored or not — `git add -f` beats `.gitignore` and this
// is the thing that catches that.
const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: REPO, maxBuffer: 64 << 20 })
  .toString('utf8').split('\0').filter(Boolean);

const offenders = tracked.filter(
  (path) => PROCESS_RECORD.some((re) => re.test(basename(path))));

let failed = 0;
const fail = (msg) => { console.error(`  FAIL  ${msg}`); failed++; };

console.log(`\nno process records — ${tracked.length} tracked files\n`);

// =====================================================
// X-1: a check that scanned nothing must say so
// =====================================================
// Three findings in one week had this shape: one NUL byte hid 143 KB of source
// from a scan; a capture probe compared twelve names against an empty set;
// check 2 of the name guard scanned nothing in a repository with no images. All
// three were GREEN.
//
// **Green and correct look identical from outside, and that is the defect.**
//
// So both sets this file depends on are counted out loud on every run, and an
// empty one fails rather than passing vacuously. This check is allowed to find
// nothing. It is not allowed to be silent about having looked at nothing.
if (tracked.length === 0) {
  fail('git ls-files returned nothing — this check would pass by scanning an ' +
    'empty tree');
}
if (PROCESS_RECORD.length === 0) {
  fail('the pattern list is empty — every filename would be compared against ' +
    'nothing and reported clean');
}
console.log(`  ${plural(PROCESS_RECORD.length, 'filename pattern', 'filename patterns')} ` +
  `over ${plural(tracked.length, 'tracked file', 'tracked files')}`);

// ---- the patterns are exercised, on names built here and tracked nowhere ----
// SS-3. **The Assignment Maker dropped this to stay in step with this copy and
// said it thought that a loss. It was.**
//
// Without it the only evidence the matcher works is the tree happening to
// contain a process record — and the whole point of the guard is that the tree
// does not. So it passed by matching nothing, which from outside is
// indistinguishable from matching correctly. That is the same failure this week
// produced three times.
//
// The names are strings in memory. Nothing is tracked, so nothing here can
// itself become a finding.
{
  const matches = (name) => PROCESS_RECORD.some((re) => re.test(name));

  // One dirty name per pattern, derived from the patterns themselves so a new
  // pattern cannot be added without a case: an exercise that has to be updated
  // by hand is one that stops being updated.
  const DIRTY = PROCESS_RECORD.map((re) => {
    const src = re.source;
    const prefix = /^\^([A-Z_]+)/.exec(src);
    if (prefix) return `${prefix[1]}2026-09-03.md`;
    const infix = /^([A-Za-z_]+)\.\*/.exec(src.replace(/^\^/, ''));
    return infix ? `EEC100${infix[1]}2026-09-03.md` : null;
  });

  // Real filenames from this repository that must NOT match. Developer
  // documentation is the thing most easily caught by a pattern reaching too
  // far, and a false positive here is what would get the guard deleted.
  const CLEAN = [
    'README.md', 'AUTOGRADER_ZIP_SPEC.md', 'CONTRIBUTING.md',
    'BASELINE_2026-09-01.md', 'LABELS.csv', 'types.ts', 'index.html',
  ];

  let ran = 0;
  for (let i = 0; i < DIRTY.length; i++) {
    const name = DIRTY[i];
    if (name === null) {
      fail(`the self-check could not build a filename for pattern ` +
        `${PROCESS_RECORD[i]} — add one by hand rather than leaving it unexercised`);
      continue;
    }
    ran++;
    if (!matches(name)) {
      fail(`the pattern list no longer matches ${name}, which pattern ` +
        `${PROCESS_RECORD[i]} exists to catch`);
    }
  }
  for (const name of CLEAN) {
    ran++;
    if (matches(name)) {
      fail(`the pattern list matches ${name}, which is developer documentation ` +
        `and must never be treated as a process record`);
    }
  }
  if (ran === 0) fail('the self-check exercised no filenames at all');
  console.log(`  self-check — ${ran} filenames, ${DIRTY.filter(Boolean).length} that ` +
    `must match and ${CLEAN.length} that must not`);
}

if (offenders.length > 0) {
  for (const path of offenders) fail(`tracked process record: ${path}`);
  console.error(
    `\n  ${offenders.length} process record(s) tracked. Move them out of the ` +
    `repository — they belong in the engineering record, not in a public code ` +
    `repository — then \`git rm --cached\` each one. Do not add an exemption.\n`);
  process.exit(1);
}
if (failed > 0) {
  console.error(`\n  ${failed} finding(s) — the guard itself is not working as ` +
    `described above.\n`);
  process.exit(1);
}
console.log('\n  no process records tracked\n');
