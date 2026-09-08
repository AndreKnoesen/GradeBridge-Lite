// =====================================================
// The QR decoder, against a student's own seventeen photographs
// =====================================================
// `WORKORDER_SS_QR_DECODER_2026-09-08.md`. The property: **a student who
// photographs a page correctly must not be told to retake it.** Twelve good
// pages must read, three true defects — blur, steep angle, dim room — must not.
//
// **The corpus is a student's photographs and is not in this repository.** It
// is referenced by path and nothing else; when the path is absent this file
// prints why it is skipping and exits clean, rather than passing silently and
// letting a green suite mean nothing.
//
//   QR_CORPUS=<folder of the seventeen frames>  node tests/qr-corpus-tests.mjs
//
// The expectations live in `tests/fixtures/qr_corpus_expectations.tsv`, which
// IS in the repository: it names files and payloads, no image and no person.
//
// This drives `services/qrDecode.ts` itself, not a replica. That is deliberate
// and it is the only way the run proves anything: a decoder swap where the old
// path is still live looks exactly like a successful one on a green suite. The
// negative control is in the completion notes — stub `readSymbols` in
// `services/zxingReader.ts` to `return []` and this file must go red.
// =====================================================

import { existsSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadModule } from './captureSet.mjs';
import { ingestLikeApp } from './realCaptures.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const CORPUS = process.env.QR_CORPUS ?? '';

console.log('\nThe QR decoder against a real capture set\n');

if (!CORPUS) {
  console.log('  SKIP: QR_CORPUS is not set.');
  console.log('        These are a student\'s photographs and do not live in this repository.');
  console.log('        Point QR_CORPUS at the seventeen-frame folder to run this.\n');
  process.exit(0);
}
if (!existsSync(CORPUS)) {
  console.log(`  SKIP: QR_CORPUS does not exist: ${CORPUS}\n`);
  process.exit(0);
}

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `\n          ${detail}`}`);
  if (!ok) failures++;
};

// ---------- expectations ----------
const EXPECTATIONS = readFileSync(
  join(HERE, 'fixtures', 'qr_corpus_expectations.tsv'), 'utf8')
  .split(/\r?\n/)
  .filter(l => l.trim() && !l.startsWith('#'))
  .map(l => {
    const [file, kind, expect, payload] = l.split('\t').map(c => c.trim());
    return { file, kind, expect, payload };
  });

// ---------- the app's own decoder, through the app's own ingest ----------
const qrDecode = await loadModule('services/qrDecode.ts', 'qc_qrdecode.mjs');
const constants = await loadModule('constants.ts', 'qc_const.mjs');

await qrDecode.initQrReader();
check('the decoder built from the inlined binary', qrDecode.qrReaderReady());

const results = [];
let missing = [];
for (const row of EXPECTATIONS) {
  const path = join(CORPUS, row.file);
  if (!existsSync(path)) { missing.push(row.file); continue; }
  const image = ingestLikeApp(path, {
    maxEdge: constants.PAGE_MAX_EDGE,
    quality: Math.round(constants.PAGE_JPEG_QUALITY * 100),
  });
  const started = Date.now();
  const readings = qrDecode.decodePageQrCandidates(image);
  results.push({
    ...row,
    got: readings[0]?.payload ?? null,
    foundBy: readings[0]?.foundBy ?? '',
    symbols: readings.length,
    ms: Date.now() - started,
  });
}

if (missing.length) {
  console.log(`\n  SKIP: ${missing.length} expected frame(s) are not in QR_CORPUS: ${missing.join(', ')}\n`);
  process.exit(0);
}

console.log('\n    frame        kind             expected  read      ms   found by');
for (const r of results) {
  const verdict = r.got === null ? '—' : (r.got === r.payload ? 'READ' : 'WRONG');
  console.log(
    `    ${r.file.replace(/\.jpe?g$/i, '').padEnd(12)} ${r.kind.padEnd(16)} ` +
    `${r.expect.padEnd(9)} ${verdict.padEnd(9)} ${String(r.ms).padStart(4)}  ${r.foundBy}`);
}
console.log('');

const read = (r) => r.got !== null && r.got === r.payload;
const good = results.filter(r => r.kind === 'good');
const shadow = results.filter(r => r.kind === 'defect-shadow');
const refuse = results.filter(r => r.expect === 'REFUSE');
const thumb = results.filter(r => r.kind === 'defect-corner');

// ---- the acceptance ----
check(`all twelve good pages read (${good.filter(read).length} of ${good.length})`,
  good.length === 12 && good.every(read),
  good.filter(r => !read(r)).map(r => `${r.file}: ${r.got ?? 'nothing'}`).join('\n          '));

// A wrong payload is worse than none: it would register the page against
// another sheet's map. Asserted separately so the two never blur together.
check('no frame returned a payload that is not its own',
  results.every(r => r.got === null || r.got === r.payload),
  results.filter(r => r.got !== null && r.got !== r.payload)
    .map(r => `${r.file}: ${r.got}`).join('\n          '));

check('the hard-shadow frame still reads', shadow.length === 1 && shadow.every(read),
  shadow.map(r => `${r.file}: ${r.got ?? 'nothing'}`).join(', '));

check(`the three true defects are still refused (${refuse.filter(r => r.got === null).length} of ${refuse.length})`,
  refuse.length === 3 && refuse.every(r => r.got === null),
  refuse.filter(r => r.got !== null).map(r => `${r.file} decoded`).join(', '));

// RECORD-ONLY. Its QR reads under every decoder tried and the page is still
// unusable: registration crops against four corner squares and a thumb is over
// one of them. **A decode is not an accept.** Whatever refuses this frame
// belongs in registration and is a separate order; this asserts only that the
// decoder behaves as recorded, so a change of behaviour is noticed.
check('the thumb-over-a-corner frame still decodes, and is still not an accept',
  thumb.length === 1 && thumb.every(read),
  thumb.map(r => `${r.file}: ${r.got ?? 'nothing'}`).join(', '));

const worst = Math.max(...results.map(r => r.ms));
console.log(`\n  slowest frame ${worst} ms; total ${results.reduce((s, r) => s + r.ms, 0)} ms over ${results.length}\n`);

if (failures > 0) {
  console.error(`  ${failures} check(s) failed\n`);
  process.exit(1);
}
console.log('  all checks passed\n');
