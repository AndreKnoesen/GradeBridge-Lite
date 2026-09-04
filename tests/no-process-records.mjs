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

console.log(`\nno process records — ${tracked.length} tracked files\n`);

if (offenders.length > 0) {
  for (const path of offenders) console.error(`  FAIL  tracked process record: ${path}`);
  console.error(
    `\n  ${offenders.length} process record(s) tracked. Move them out of the ` +
    `repository — they belong in the engineering record, not in a public code ` +
    `repository — then \`git rm --cached\` each one. Do not add an exemption.\n`);
  process.exit(1);
}
console.log('  no process records tracked\n');
