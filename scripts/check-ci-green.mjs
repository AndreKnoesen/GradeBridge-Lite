// =====================================================
// The deploy gate: refuse to publish a commit CI has not passed
// =====================================================
// On 2026-09-08 the decoder was deployed to production while `main` had been
// red for nearly twenty hours. Three failed runs had been delivered and were
// sitting unread in the GitHub inbox: **the signal existed, and it was not on
// the path between `git push` and `npm run deploy`.** Turning notifications on
// would not have helped, because they were already on; a fourth channel would
// not help either. This sits inside the one command that does the harm.
//
// The harm was never the red CI, which was recoverable. It was publishing a
// build that nothing had verified.
//
// **No credential is needed.** The repository is public and run conclusions are
// readable unauthenticated; only the LOGS endpoint returns 403. That
// distinction cost a cycle to learn, so it is written down here rather than
// rediscovered as "this needs a token".
//
// REFUSES on: a failed run, a cancelled run, no run at all, a run still in
// progress, and any error reaching the API. **A gate that opens when it cannot
// see is not a gate**, so a rate limit or a dropped connection refuses exactly
// like a red run does.
//
// "No run at all" is the case most likely to be dismissed as pedantry, and it
// is the one that matters most: ninety seconds after a push there is nothing to
// find, and a commit that was never pushed has no run and never will. **Silence
// is not success.**
import { execFileSync } from 'node:child_process';

const OVERRIDE = 'GB_ALLOW_RED_CI';
const API = 'https://api.github.com';
const TIMEOUT_MS = 15000;

// Any non-empty value counts except the two that a person plainly means as off.
const raw = process.env[OVERRIDE] ?? '';
const overridden = raw !== '' && raw !== '0' && raw.toLowerCase() !== 'false';

const say = (line) => console.log(`[deploy gate] ${line}`);
const detail = (line) => console.log(`              ${line}`);

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

/** `owner/repo` from the origin remote, SSH or HTTPS. Derived, never hardcoded. */
const slug = () => {
  const url = git('remote', 'get-url', 'origin');
  const m = url.match(/github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/);
  if (!m) throw new Error(`cannot read owner/repo from the origin remote: ${url}`);
  return `${m[1]}/${m[2]}`;
};

const describe = (run) => [
  `${run.name} #${run.run_number} — ${run.status}${run.conclusion ? `, ${run.conclusion}` : ''}`,
  run.html_url,
];

/**
 * The single exit point for every refusal reason.
 *
 * Under the override this reports and returns control to the build rather than
 * blocking — but it says so in full, naming the reason it would have refused
 * and the runs it looked at. **The override is never silent**: a deploy that
 * skips the check must be as legible afterwards as one that passed it.
 */
const refuse = (reason, extra = []) => {
  if (overridden) {
    say(`*** OVERRIDDEN — ${OVERRIDE} is set, deploying anyway ***`);
    detail(`Would have refused: ${reason}`);
    for (const line of extra) detail(line);
    detail('');
    detail('The build about to be published has NOT been verified by CI.');
    process.exit(0);
  }
  say('REFUSING TO DEPLOY');
  detail(reason);
  for (const line of extra) detail(line);
  detail('');
  detail('If this refusal is understood and deliberate, set the override:');
  detail(`  ${OVERRIDE}=1 npm run deploy`);
  process.exit(1);
};

const sha = git('rev-parse', 'HEAD');
const short = sha.slice(0, 7);
const repo = slug();

let runs;
try {
  const res = await fetch(`${API}/repos/${repo}/actions/runs?head_sha=${sha}&per_page=20`, {
    headers: { 'User-Agent': 'gradebridge-deploy-gate', Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 403 || res.status === 429) {
    const reset = res.headers.get('x-ratelimit-reset');
    refuse('the GitHub API refused the request — rate limit, or forbidden.', [
      `HTTP ${res.status} for ${repo}`,
      reset ? `the rate limit resets at ${new Date(Number(reset) * 1000).toISOString()}` : '',
      'Refusing rather than passing: a gate that cannot see must not open.',
    ].filter(Boolean));
  } else if (!res.ok) {
    refuse(`the GitHub API returned HTTP ${res.status} for ${repo}.`, [
      'Refusing rather than passing: a gate that cannot see must not open.',
    ]);
  }
  runs = (await res.json()).workflow_runs ?? [];
} catch (err) {
  refuse('could not reach the GitHub API to check CI.', [
    String(err?.message ?? err),
    'Refusing rather than passing: a gate that cannot see must not open.',
  ]);
}

if (runs.length === 0) {
  refuse(`no CI run exists for ${short}.`, [
    `repository ${repo}`,
    'Either this commit has not been pushed, or its run has not been created yet.',
    'Silence is not success — push, let the run finish, then deploy.',
  ]);
}

const unfinished = runs.filter((r) => r.status !== 'completed');
if (unfinished.length > 0) {
  refuse(`CI has not finished for ${short}.`, unfinished.flatMap(describe));
}

const bad = runs.filter((r) => r.conclusion !== 'success');
if (bad.length > 0) {
  refuse(`CI is not green for ${short}.`, bad.flatMap(describe));
}

say(`CI is green for ${short}`);
for (const r of runs) describe(r).forEach(detail);