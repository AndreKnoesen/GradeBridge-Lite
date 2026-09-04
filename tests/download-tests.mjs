// =====================================================
// downloadFile test suite
// =====================================================
// Plain Node (>=18) — no test framework, same shape as the other suites.
//
//   node tests/download-tests.mjs        (also runs as part of `npm test`)
//
// Why this exists: the first iPhone test (v3.7.3) found that Save Backup
// writes no file on iOS Safari. The cause is timing, not content — the object
// URL was revoked on the line after click(), while iOS defers the download
// behind a "Do you want to download …?" confirmation. The student taps
// Download and the blob is already gone.
//
// That failure is invisible on a desktop and invisible in a type check: the
// code looks right, and every browser we can drive locally passes. So the
// ordering is pinned here instead — a revoke that moves back before the
// confirmation fails this suite rather than one student's submission.
// =====================================================

import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');

// ---------- tiny assertion harness (mirrors the other suites) ----------
let passed = 0, failed = 0;
const results = [];

const check = (name, fn) => {
  try {
    fn();
    passed++;
    results.push(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    results.push(`  FAIL  ${name}\n          ${err.message}`);
  }
};
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const assertEqual = (actual, expected, msg) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg}\n          expected: ${e}\n          actual:   ${a}`);
};

// ---------- build downloadFile.ts ----------
const outDir = mkdtempSync(join(tmpdir(), 'gb-download-test-'));
const outFile = join(outDir, 'downloadFile.mjs');
await build({
  entryPoints: [join(REPO, 'downloadFile.ts')],
  outfile: outFile,
  format: 'esm',
  target: 'es2022',
  bundle: false,
  logLevel: 'silent',
});
const { downloadBlob, DOWNLOAD_URL_TTL_MS } = await import(pathToFileURL(outFile).href);

// ---------- the smallest DOM the helper needs ----------
// Every call the helper makes is recorded in order, because order is the
// whole bug: what matters is not that revoke happens, but when.
const harness = () => {
  const log = [];
  const timers = [];
  let created = 0;

  const anchor = {
    href: '', download: '', rel: '', style: {},
    click() { log.push({ op: 'click', attached: body.children.includes(anchor) }); },
    remove() { log.push({ op: 'remove' }); body.children = body.children.filter(c => c !== anchor); },
  };
  const body = {
    children: [],
    appendChild(el) { log.push({ op: 'appendChild' }); body.children.push(el); return el; },
  };

  const realDocument = globalThis.document;
  const realCreate = URL.createObjectURL;
  const realRevoke = URL.revokeObjectURL;
  const realSetTimeout = globalThis.setTimeout;

  globalThis.document = {
    body,
    createElement(tag) { log.push({ op: 'createElement', tag }); return anchor; },
  };
  URL.createObjectURL = (blob) => {
    const url = `blob:test/${++created}`;
    log.push({ op: 'createObjectURL', url, size: blob?.size });
    return url;
  };
  URL.revokeObjectURL = (url) => { log.push({ op: 'revokeObjectURL', url }); };
  globalThis.setTimeout = (fn, ms) => {
    log.push({ op: 'setTimeout', ms });
    timers.push({ fn, ms });
    return timers.length;
  };

  return {
    log, timers, anchor, body,
    /** Runs every scheduled timer, as the browser would once the delay elapses. */
    flush() { const pending = timers.splice(0); pending.forEach(t => t.fn()); },
    restore() {
      globalThis.document = realDocument;
      URL.createObjectURL = realCreate;
      URL.revokeObjectURL = realRevoke;
      globalThis.setTimeout = realSetTimeout;
    },
  };
};

const ops = (log) => log.map(e => e.op);

console.log('\ndownloadFile — iOS deferred-download suite\n');

// =====================================================
// 1. The download itself
// =====================================================
{
  const h = harness();
  let snapshot;
  try {
    downloadBlob(new Blob(['{"a":1}'], { type: 'application/json' }), 'Jane_EEC130.json');
    snapshot = { log: [...h.log], href: h.anchor.href, download: h.anchor.download, attached: h.body.children.length };
  } finally { h.restore(); }

  check('the anchor gets the object URL and the requested filename', () => {
    assertEqual(snapshot.href, 'blob:test/1', 'href is not the created object URL');
    assertEqual(snapshot.download, 'Jane_EEC130.json', 'download attribute is wrong');
  });

  check('the anchor is in the document when it is clicked', () => {
    const clicked = snapshot.log.find(e => e.op === 'click');
    assert(clicked, 'the anchor was never clicked');
    assert(clicked.attached, 'clicked while detached — some WebKit builds ignore that');
  });

  check('the anchor is removed again, leaving no litter in the DOM', () =>
    assertEqual(snapshot.attached, 0, 'the anchor was left attached to the body'));
}

// =====================================================
// 2. The iOS bug itself: the URL must outlive the click
// =====================================================
{
  const h = harness();
  let sync, afterFlush, scheduled;
  try {
    downloadBlob(new Blob(['zip bytes']), 'submission.zip');
    sync = [...h.log];                      // everything that happened synchronously
    scheduled = h.timers.map(t => t.ms);
    h.flush();                              // now let the deferred work run
    afterFlush = [...h.log];
  } finally { h.restore(); }

  // The regression that broke a real student's iPhone. On iOS the download is
  // still behind a confirmation at this point; revoking here means the tap on
  // "Download" finds nothing to fetch and writes no file, silently.
  check('the object URL is NOT revoked synchronously after the click', () => {
    assert(!ops(sync).includes('revokeObjectURL'),
      `revoked during the click — iOS would have nothing left to download.\n          ` +
      `synchronous order was: ${ops(sync).join(' -> ')}`);
  });

  check('the revoke is deferred onto a timer instead', () =>
    assertEqual(scheduled, [DOWNLOAD_URL_TTL_MS], 'no revoke timer, or the wrong delay'));

  check('the deferred timer revokes the URL that was handed out', () => {
    const revoked = afterFlush.filter(e => e.op === 'revokeObjectURL');
    assertEqual(revoked.map(e => e.url), ['blob:test/1'], 'wrong URL revoked, or revoked more than once');
  });

  check('the click happens before the revoke, never after', () => {
    const order = ops(afterFlush);
    assert(order.indexOf('click') < order.indexOf('revokeObjectURL'),
      `ordering is wrong: ${order.join(' -> ')}`);
  });

  // A "tidy-up" that shortens this back towards zero reintroduces the bug on
  // any browser that asks the user first, so hold it to a human-scale delay.
  check('the URL lives long enough for a student to answer a download prompt', () =>
    assert(DOWNLOAD_URL_TTL_MS >= 10_000,
      `TTL is ${DOWNLOAD_URL_TTL_MS} ms — too short for a confirmation dialog`));
}

// =====================================================
// 3. Two downloads in a row keep their own URLs
// =====================================================
{
  const h = harness();
  let log;
  try {
    downloadBlob(new Blob(['a']), 'first.json');
    downloadBlob(new Blob(['b']), 'second.zip');
    h.flush();
    log = [...h.log];
  } finally { h.restore(); }

  check('a second download does not revoke the first one early', () => {
    const created = log.filter(e => e.op === 'createObjectURL').map(e => e.url);
    const revoked = log.filter(e => e.op === 'revokeObjectURL').map(e => e.url);
    assertEqual(created, ['blob:test/1', 'blob:test/2'], 'each download needs its own object URL');
    assertEqual(revoked, ['blob:test/1', 'blob:test/2'], 'both URLs should be released, once each');
    // Neither revoke may land before both clicks have happened.
    const order = ops(log);
    assert(order.lastIndexOf('click') < order.indexOf('revokeObjectURL'),
      `a revoke ran before the second click: ${order.join(' -> ')}`);
  });
}

// =====================================================
// 4. Both student-facing downloads route through the helper
// =====================================================
// The bug was duplicated because the snippet was. If App.tsx grows a third
// hand-rolled anchor download, this catches it.
{
  const { readFileSync } = await import('node:fs');
  const app = readFileSync(join(REPO, 'App.tsx'), 'utf8');

  // App.tsx still creates object URLs legitimately — page thumbnails — so the
  // guard is on the anchor, which only a hand-rolled download needs.
  check('App.tsx builds no download anchors of its own', () => {
    assert(!/\.download\s*=/.test(app),
      'App.tsx sets a download attribute directly — route it through downloadBlob() instead');
    assert(!/createElement\(\s*['"]a['"]\s*\)/.test(app),
      'App.tsx creates an anchor element — route downloads through downloadBlob() instead');
  });

  check('App.tsx calls downloadBlob for both the backup and the submission ZIP', () => {
    const calls = app.match(/downloadBlob\(/g) ?? [];
    assert(calls.length >= 2, `found ${calls.length} downloadBlob() call(s), expected the backup and the ZIP`);
    assert(/import \{ downloadBlob \} from '\.\/downloadFile'/.test(app), 'downloadBlob is not imported');
  });

  check('no download message claims the file is already saved', () => {
    assert(!/is in your Downloads folder/.test(app),
      'a message still asserts the file was written — iOS gives no such signal');
    assert(!/[Dd]ownloaded!/.test(app),
      'a message still announces a completed download before it is confirmed');
  });
}

// ---------- report ----------
console.log(results.join('\n'));
console.log(`\n${passed} passed, ${failed} failed\n`);
rmSync(outDir, { recursive: true, force: true });
process.exit(failed > 0 ? 1 : 0);
