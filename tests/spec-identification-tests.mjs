// =====================================================
// The spec is found by what it IS, not by what it is called
// =====================================================
// `workorders/WORKORDER_SS_ACCEPT_THE_STUDENT_ZIP_2026-09-06.md`.
//
//   node tests/spec-identification-tests.mjs      (also runs as part of `npm test`)
//
// ## What went wrong, so nobody re-introduces it
//
// The loader looked inside a zip for an entry **named** `assignment_spec.json`.
// The same day the Assignment Maker began writing that file as
// `{stem}_OPEN_IN_APP.json` and attaching ONE zip to Canvas holding the PDF and
// the spec, a student who uploaded the zip they were given was told
//
//     That zip has no assignment_spec.json in it.
//
// while holding exactly the right file. The names had changed and the rule was
// keyed to a name.
//
// So an entry qualifies **structurally**: `gb1:`, or a JSON object. The last
// check in this file asserts that no filename comparison for the spec has come
// back — that is the check that matters most here, because the fix is only as
// durable as its absence.
//
// The layout `layout_*.csv` lookup is still by name and that is deliberate:
// "a separate CSV wins over the embedded map" makes a false positive there
// worse than a miss. It is a KNOWN RESIDUAL of the same shape, one file along,
// and it is asserted below so it is visible rather than forgotten.
// =====================================================

import JSZip from 'jszip';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadModule } from './captureSet.mjs';

globalThis.crypto ??= webcrypto;

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');

let passed = 0, failed = 0;
const results = [];
const check = (name, fn) => {
  try { fn(); passed++; results.push(`  PASS  ${name}`); }
  catch (err) { failed++; results.push(`  FAIL  ${name}\n          ${err.message}`); }
};
const checkAsync = async (name, fn) => {
  try { await fn(); passed++; results.push(`  PASS  ${name}`); }
  catch (err) { failed++; results.push(`  FAIL  ${name}\n          ${err.message}`); }
};
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const assertEqual = (actual, expected, msg) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg}\n          expected: ${e}\n          actual:   ${a}`);
};

const bundle = await loadModule('services/assignmentBundle.ts', 'si_bundle.mjs');
const lay = await loadModule('services/layoutMap.ts', 'si_layout.mjs');
const cryptoSvc = await loadModule('cryptoService.ts', 'si_crypto.mjs');
const bundleSrc = readFileSync(join(REPO, 'services', 'assignmentBundle.ts'), 'utf8');

const CSV_NAME = 'layout_ENG17HOM496F.csv';
const CSV_TEXT = readFileSync(join(HERE, 'fixtures', CSV_NAME), 'utf8');
const EXPECTED_LAYOUT_ID = '95438EDF';
const enc = (s) => new TextEncoder().encode(s);

const specObject = (extra = {}) => ({
  id: 'ENG17HOM496F', courseCode: 'ENG17', title: 'Homework 1',
  inputMode: 'handwritten', preamble: '', problems: [{ id: 'p1', subsections: [] }],
  createdAt: 0, updatedAt: 0, ...extra,
});
const withMap = () => specObject({ layoutCsvName: CSV_NAME, layoutCsv: CSV_TEXT });

// A real PDF header; the rest does not matter, only that it is binary and big.
const PDF_BYTES = (() => {
  const head = enc('%PDF-1.7\n%\xE2\xE3\xCF\xD3\n');
  const out = new Uint8Array(head.length + 4096);
  out.set(head); for (let i = head.length; i < out.length; i++) out[i] = (i * 31) & 0xff;
  return out;
})();

const asFile = (bytes) => ({
  arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
});
const zipOf = async (entries) => {
  const z = new JSZip();
  for (const [name, data] of entries) z.file(name, data);
  return z.generateAsync({ type: 'uint8array' });
};
/** Load a zip and report where the map came from and what it hashes to. */
const openZip = async (entries) => {
  const loaded = await bundle.loadAssignmentBundle(asFile(await zipOf(entries)));
  const spec = cryptoSvc.isEncoded(loaded.specText)
    ? await cryptoSvc.decryptJson(loaded.specText) : JSON.parse(loaded.specText);
  const src = bundle.chooseLayoutSource(loaded.layout, spec);
  const map = src ? await lay.parseLayoutCsv(src.text, src.name) : null;
  return { loaded, spec, src, map };
};
const refusal = async (fn) => {
  try { await fn(); return null; } catch (e) { return e; }
};

console.log('\nStudent Submission — finding the spec by content\n');

// =====================================================
// 1. The classifiers, over bytes
// =====================================================
console.log('  1. what a file is, from its own bytes');

const gb1Text = await cryptoSvc.encryptJson(specObject());

check('a gb1: envelope is a spec', () =>
  assert(bundle.looksLikeSpec(enc(gb1Text)), 'gb1: text not recognised'));

check('a JSON object is a spec', () =>
  assert(bundle.looksLikeSpec(enc(JSON.stringify(specObject()))), 'plain JSON object not recognised'));

check('leading whitespace and a BOM do not hide either', () => {
  assert(bundle.looksLikeSpec(enc('﻿  \n' + gb1Text)), 'BOM + whitespace hid a gb1 spec');
  assert(bundle.looksLikeSpec(enc('﻿\n\t' + JSON.stringify(specObject()))), 'BOM + whitespace hid a JSON spec');
});

check('a JSON array is NOT a spec', () =>
  assert(!bundle.looksLikeSpec(enc('[{"courseCode":"ENG17"}]')), 'an array qualified as a spec'));

check('a PDF is NOT a spec', () =>
  assert(!bundle.looksLikeSpec(PDF_BYTES), 'a PDF qualified as a spec'));

check('a layout CSV is NOT a spec', () =>
  assert(!bundle.looksLikeSpec(enc(CSV_TEXT)), 'the layout map qualified as a spec'));

check('truncated and empty input are NOT a spec', () => {
  assert(!bundle.looksLikeSpec(enc('')), 'empty input qualified');
  assert(!bundle.looksLikeSpec(enc('gb')), 'a truncated prefix qualified');
  assert(!bundle.looksLikeSpec(enc('{"courseCode":')), 'truncated JSON qualified');
});

// gb2 is deliberately excluded: this app holds no gb2 private key and
// `cryptoService.ts` exports no gb2 decrypt, so accepting one here would only
// move the failure later and make it less legible.
check('a gb2: envelope is NOT accepted as a spec', () =>
  assert(!bundle.looksLikeSpec(enc('gb2:AAAABBBB')), 'a gb2 envelope qualified as a spec'));

check('the PDF and layout classifiers recognise their own', () => {
  assert(bundle.looksLikePdf(PDF_BYTES), 'the PDF was not recognised');
  assert(!bundle.looksLikePdf(enc(gb1Text)), 'a spec was called a PDF');
  assert(bundle.looksLikeLayoutCsv(enc(CSV_TEXT)), 'the layout map was not recognised');
  assert(!bundle.looksLikeLayoutCsv(enc('a,b,c\n1,2,3\n')), 'an unrelated CSV was called a layout map');
});

// =====================================================
// 2. A zip loads whatever the spec is called
// =====================================================
console.log('\n  2. the spec under any name');

for (const name of [
  'ENG17_Homework_1_OPEN_IN_APP.json',   // what the Assignment Maker writes today
  'assignment_spec.json',                // what it wrote yesterday
  'Homework 1 (1).json',                 // what a second download is called
  'spec.txt',                            // wrong extension entirely
  'student/ENG17_Homework_1_OPEN_IN_APP.json',  // nested, as an export folder zips
]) {
  await checkAsync(`a zip whose spec is called "${name}" loads`, async () => {
    const { loaded, src, map } = await openZip([
      ['ENG17_Homework_1.pdf', PDF_BYTES],
      [name, await cryptoSvc.encryptJson(withMap())],
    ]);
    assertEqual(loaded.kind, 'zip', 'not read as a zip');
    assertEqual(src.from, 'spec', 'the embedded map was not used');
    assertEqual(map.computedLayoutId, EXPECTED_LAYOUT_ID, 'the hash moved');
    assertEqual(map.rows.length, 17, 'wrong region count');
    assertEqual(map.maxPageK, 16, 'wrong page count');
  });
}

await checkAsync('an unencoded (plain JSON) spec in a zip loads the same way', async () => {
  const { src, map } = await openZip([
    ['ENG17_Homework_1.pdf', PDF_BYTES],
    ['whatever.json', JSON.stringify(withMap())],
  ]);
  assertEqual(src.from, 'spec', 'the embedded map was not used');
  assertEqual(map.computedLayoutId, EXPECTED_LAYOUT_ID, 'the hash moved');
});

// =====================================================
// 3. The old three-file zip is untouched
// =====================================================
console.log('\n  3. old material');

await checkAsync('the old three-file zip loads, map from the SEPARATE csv', async () => {
  const { loaded, spec, src, map } = await openZip([
    ['assignment.pdf', PDF_BYTES],
    ['assignment_spec.json', await cryptoSvc.encryptJson(specObject())],
    [CSV_NAME, CSV_TEXT],
  ]);
  assertEqual(loaded.entries.length, 3, 'the zip did not carry three files');
  assert(!spec.layoutCsv, 'the old spec grew an embedded map');
  assertEqual(src.from, 'bundle', 'the map did not come from the file beside the spec');
  assertEqual(map.computedLayoutId, EXPECTED_LAYOUT_ID, 'the hash moved');
});

// The rule from the previous order, re-asserted here because this change
// rewrote the code path that reaches it.
await checkAsync('a separate csv still WINS over an embedded map', async () => {
  const { src, map } = await openZip([
    ['ENG17_Homework_1.pdf', PDF_BYTES],
    ['ENG17_Homework_1_OPEN_IN_APP.json', await cryptoSvc.encryptJson(withMap())],
    [CSV_NAME, CSV_TEXT],
  ]);
  assertEqual(src.from, 'bundle', 'the embedded map displaced the file beside the spec');
  assertEqual(map.computedLayoutId, EXPECTED_LAYOUT_ID, 'the hash moved');
});

await checkAsync('a bare spec under any name still loads', async () => {
  const loaded = await bundle.loadAssignmentBundle(
    asFile(enc(await cryptoSvc.encryptJson(withMap()))));
  assertEqual(loaded.kind, 'json', 'a bare spec was read as a zip');
  const spec = await cryptoSvc.decryptJson(loaded.specText);
  const map = await lay.parseLayoutCsv(spec.layoutCsv, spec.layoutCsvName);
  assertEqual(map.computedLayoutId, EXPECTED_LAYOUT_ID, 'the hash moved');
});

// =====================================================
// 4. Ambiguity and absence both refuse
// =====================================================
console.log('\n  4. refusals');

await checkAsync('two qualifying specs refuse, and name them', async () => {
  const err = await refusal(async () => openZip([
    ['ENG17_Homework_1.pdf', PDF_BYTES],
    ['a.json', await cryptoSvc.encryptJson(withMap())],
    ['b.json', await cryptoSvc.encryptJson(withMap())],
  ]));
  assert(err && err.name === 'BundleError', `expected a BundleError, got ${err && err.message}`);
  assert(/more than one assignment file/.test(err.message), `wrong refusal: ${err.message}`);
  assert(/a\.json/.test(err.message) && /b\.json/.test(err.message),
    `the refusal does not name both files: ${err.message}`);
});

// The instructor export carries the authoring backup and the grading rubric,
// both plain JSON objects. Loading it must never pick one of them; ambiguity
// refusing is what makes that safe rather than lucky.
await checkAsync('an instructor-shaped zip refuses rather than loading the answer key', async () => {
  const err = await refusal(async () => openZip([
    ['ENG17_Homework_1.pdf', PDF_BYTES],
    ['ENG17_Homework_1_OPEN_IN_APP.json', await cryptoSvc.encryptJson(withMap())],
    ['instructor/ENG17_Homework_1_authoring_backup.json', JSON.stringify({ answerKey: true })],
    ['instructor/ENG17_Homework_1_grading_rubric.json', JSON.stringify({ rubrics: {} })],
    ['instructor/' + CSV_NAME, CSV_TEXT],
  ]));
  assert(err && /more than one assignment file/.test(err.message),
    `the instructor zip did not refuse: ${err && err.message}`);
});

await checkAsync('a zip with no qualifying spec refuses, and names the PDF it did hold', async () => {
  const err = await refusal(async () => openZip([
    ['ENG17_Homework_1.pdf', PDF_BYTES],
    [CSV_NAME, CSV_TEXT],
  ]));
  assert(err && /no assignment file/.test(err.message), `wrong refusal: ${err && err.message}`);
  assert(/ENG17_Homework_1\.pdf/.test(err.message) && /sheet you print/.test(err.message),
    `the refusal does not point at the PDF: ${err.message}`);
});

await checkAsync('a bare PDF is refused as the sheet to print', async () => {
  const err = await refusal(async () => bundle.loadAssignmentBundle(asFile(PDF_BYTES)));
  assert(err && err.name === 'BundleError', `expected a BundleError, got ${err && err.message}`);
  assert(/sheet you print/.test(err.message), `wrong refusal: ${err.message}`);
});

await checkAsync('a bare layout csv is refused as the layout file', async () => {
  const err = await refusal(async () => bundle.loadAssignmentBundle(asFile(enc(CSV_TEXT))));
  assert(err && err.name === 'BundleError', `expected a BundleError, got ${err && err.message}`);
  assert(/layout file/.test(err.message), `wrong refusal: ${err.message}`);
});

// Everything else keeps falling through to App.tsx's generic message. A loader
// that threw on any unrecognised bare file would be guessing.
await checkAsync('an unrecognised bare file is NOT refused here', async () => {
  const loaded = await bundle.loadAssignmentBundle(asFile(enc('hello, world')));
  assertEqual(loaded.kind, 'json', 'an unrecognised file was not passed through');
  assertEqual(loaded.specText, 'hello, world', 'the text was altered');
});

// =====================================================
// 5. The fix is only as durable as the absence of a name rule
// =====================================================
console.log('\n  5. no filename rule for the spec has come back');

check('assignmentBundle.ts compares no filename to find the spec', () => {
  // Comments are allowed to name the file — the header explains the incident.
  // Code is not. Strip comments, then look for any comparison against a name.
  const code = bundleSrc
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  const offenders = [];
  for (const [label, re] of [
    ['a literal spec filename', /['"`][^'"`]*assignment_spec[^'"`]*['"`]/i],
    ['an OPEN_IN_APP special case', /OPEN_IN_APP/i],
    ['a .json extension test', /\.json['"`]|endsWith\(\s*['"`]\.json/i],
  ]) if (re.test(code)) offenders.push(label);
  assert(offenders.length === 0,
    `a filename rule for the spec is back in the code: ${offenders.join('; ')}`);
});

check('the spec is selected through the byte classifier, not a name', () => {
  const code = bundleSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert(/const specFiles = read\.filter\(e => looksLikeSpec\(e\.bytes\)\)/.test(code),
    'the spec is no longer chosen by looksLikeSpec over the entry bytes');
});

// KNOWN RESIDUAL, asserted so it stays visible: the map is still found by name.
// Rename the CSV and the trap this order fixed returns, one file along.
check('KNOWN RESIDUAL: the layout map is still located by filename', () => {
  const code = bundleSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert(/\^layout_\.\+\\\.csv\$/.test(code) || /layout_/.test(code),
    'the layout lookup changed — if it is now by content, delete this check and ' +
    'the residual note in the header; if it is gone, that is a defect');
});

// =====================================================
console.log('');
for (const line of results) console.log(line);
console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
