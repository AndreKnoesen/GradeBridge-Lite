// =====================================================
// The map travels inside the spec — and the hash does not move
// =====================================================
// `workorders/WORKORDER_BOTH_ONE_UPLOAD_FILE_2026-09-06.md`, Part A.
//
//   node tests/embedded-layout-tests.mjs      (also runs as part of `npm test`)
//
// A student used to get a zip of three files and had to open it to reach the
// PDF, which put a spec and an editable geometry map in front of them and left
// them a file to choose wrongly. The spec can now carry the map inside it:
//
//     layoutCsvName   "layout_ENG17HOM496F.csv"
//     layoutCsv       the EXACT text of that file, newlines and all
//
// ## Why this suite exists, and what it is actually guarding
//
// `computeLayoutId` hashes `canonicalMapSerialization(rows)` — the rows
// `parseLayoutCsv` produced — and **not** the file's bytes. So embedding the
// same text and parsing it with the same parser gives identical rows by
// construction and the hash cannot move. That is an argument. §3 below is the
// measurement, over the real ENG17 Homework 1 map:
//
//     computedLayoutId  95438EDF from both routes
//     parsed rows       deeply equal
//     canonical form    byte-identical
//
// **95438EDF is printed into the QR code on every sheet of paper this project
// has produced**, including the whole capture set. Every other mistake in this
// change is a redeploy. That one is a reprint. Which is why the fixture is
// committed rather than reached for through an environment variable: this is
// the check in this repository that must never SKIP.
//
// Nothing here touches `canonicalMapSerialization`, `computeLayoutId`, `fmt4`
// or `parseLayoutCsv`, and nothing here may: `qrPayload.ts` says in its own
// header that those are byte-identical across both apps and must not be
// "improved". This suite reads them, it does not restate them.
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

const bundle = await loadModule('services/assignmentBundle.ts', 'el_bundle.mjs');
const lay = await loadModule('services/layoutMap.ts', 'el_layout.mjs');
const qrp = await loadModule('services/qrPayload.ts', 'el_qrPayload.mjs');
const cryptoSvc = await loadModule('cryptoService.ts', 'el_crypto.mjs');

const appSrc = readFileSync(join(REPO, 'App.tsx'), 'utf8');
const typesSrc = readFileSync(join(REPO, 'types.ts'), 'utf8');

// The real ENG17 Homework 1 map, byte for byte. See tests/fixtures/README.md.
const CSV_NAME = 'layout_ENG17HOM496F.csv';
const CSV_TEXT = readFileSync(join(HERE, 'fixtures', CSV_NAME), 'utf8');
const EXPECTED_LAYOUT_ID = '95438EDF';

/** `loadAssignmentBundle` takes a File; it only ever calls `arrayBuffer()`. */
const asFile = (bytes) => ({
  arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
});

const specObject = (extra = {}) => ({
  id: 'ENG17HOM496F', courseCode: 'ENG17', title: 'Homework 1',
  inputMode: 'handwritten', preamble: '', problems: [{ id: 'p1', subsections: [] }],
  createdAt: 0, updatedAt: 0, ...extra,
});

console.log('\nStudent Submission — the map inside the spec\n');

// =====================================================
// 1. The contract, as this repository declares it
// =====================================================
console.log('  1. the two fields');

check('types.ts: Assignment carries `layoutCsvName?: string`', () =>
  assert(/\n\s*layoutCsvName\?:\s*string;/.test(typesSrc),
    'no `layoutCsvName?: string;` member found on the Assignment interface'));

check('types.ts: Assignment carries `layoutCsv?: string`', () =>
  assert(/\n\s*layoutCsv\?:\s*string;/.test(typesSrc),
    'no `layoutCsv?: string;` member found on the Assignment interface'));

// The fixture is the contract's own claim about itself: "the EXACT text of
// that CSV, unchanged, newlines and all". A fixture an editor had normalised
// would still pass every hash check below while no longer testing the thing.
check('the fixture is the exact bytes of the exported map', () => {
  assert(CSV_TEXT.length === 1175, `fixture is ${CSV_TEXT.length} bytes, expected 1175`);
  assert(!CSV_TEXT.includes('\r'), 'fixture has CRLF endings; the exported map has LF');
  assert(CSV_TEXT.endsWith('\n'), 'fixture lost its trailing newline');
});

// =====================================================
// 2. Where the map comes from
// =====================================================
console.log('\n  2. which map wins');

check('a separate layout_*.csv is used when the bundle carries one', () => {
  const source = bundle.chooseLayoutSource({ name: CSV_NAME, text: CSV_TEXT }, specObject());
  assertEqual(source.from, 'bundle', 'the separate CSV was not chosen');
  assertEqual(source.name, CSV_NAME, 'the wrong name was carried through');
});

// A1, and this is not tidiness. A tester holds an old-shape packet and his
// timing is unknown; his run must not depend on when he starts it. If the two
// copies ever disagree, the file the student actually printed from is the one
// beside the spec.
check('a separate layout_*.csv WINS over an embedded one', () => {
  const embedded = CSV_TEXT.replace('ENG17HOM496F,95438EDF,p1a', 'ENG17HOM496F,95438EDF,pXX');
  const source = bundle.chooseLayoutSource(
    { name: CSV_NAME, text: CSV_TEXT },
    specObject({ layoutCsvName: 'layout_OTHER.csv', layoutCsv: embedded }));
  assertEqual(source.from, 'bundle', 'the embedded map displaced the separate file');
  assert(source.text === CSV_TEXT, 'the embedded text was used instead of the file beside the spec');
});

check('the embedded map is used when there is no separate file', () => {
  const source = bundle.chooseLayoutSource(null,
    specObject({ layoutCsvName: CSV_NAME, layoutCsv: CSV_TEXT }));
  assertEqual(source.from, 'spec', 'the embedded map was not chosen');
  assertEqual(source.name, CSV_NAME, 'layoutCsvName was not used as the source name');
  assert(source.text === CSV_TEXT, 'the embedded text was altered on the way through');
});

check('a spec carrying neither field yields no map', () =>
  assertEqual(bundle.chooseLayoutSource(null, specObject()), null, 'a map was invented'));

// "Both fields present or both absent. Never one." Half a pair was built by
// something broken, and saying so beats falling through to "this file has no
// map in it". It cannot fire on valid material, because valid material never
// has one.
for (const [label, extra] of [
  ['layoutCsv with no layoutCsvName', { layoutCsv: CSV_TEXT }],
  ['layoutCsvName with no layoutCsv', { layoutCsvName: CSV_NAME }],
]) {
  check(`half a pair is refused: ${label}`, () => {
    let threw = null;
    try { bundle.chooseLayoutSource(null, specObject(extra)); } catch (e) { threw = e; }
    assert(threw && threw.name === 'BundleError',
      `expected a BundleError, got: ${threw && threw.message}`);
  });
}

// An empty string is a generator writing nothing, not half a pair. Refusing it
// would reject an electronic assignment whose exporter fills both fields in
// unconditionally, which is a real shape and not a broken one.
check('blank fields are read as absent, not as half a pair', () =>
  assertEqual(bundle.chooseLayoutSource(null, specObject({ layoutCsvName: '', layoutCsv: '' })),
    null, 'a blank pair was not treated as absent'));

// =====================================================
// 3. THE ACCEPTANCE TEST — the hash does not move
// =====================================================
console.log('\n  3. ENG17 Homework 1, both routes');

// --- the old way: a zip with the map beside the spec ---
const oldZip = new JSZip();
oldZip.file('assignment.pdf', new Uint8Array([0x25, 0x50, 0x44, 0x46]));
oldZip.file('assignment_spec.json', await cryptoSvc.encryptJson(specObject()));
oldZip.file(CSV_NAME, CSV_TEXT);
const oldBytes = await oldZip.generateAsync({ type: 'uint8array' });

const oldLoaded = await bundle.loadAssignmentBundle(asFile(oldBytes));
const oldSpec = await cryptoSvc.decryptJson(oldLoaded.specText);
const oldSource = bundle.chooseLayoutSource(oldLoaded.layout, oldSpec);
const oldMap = await lay.parseLayoutCsv(oldSource.text, oldSource.name);

// --- the new way: one file, gb1-encoded, the map inside it ---
const newSpecText = await cryptoSvc.encryptJson(
  specObject({ layoutCsvName: CSV_NAME, layoutCsv: CSV_TEXT }));
const newLoaded = await bundle.loadAssignmentBundle(
  asFile(new TextEncoder().encode(newSpecText)));
const newSpec = await cryptoSvc.decryptJson(newLoaded.specText);
const newSource = bundle.chooseLayoutSource(newLoaded.layout, newSpec);
const newMap = await lay.parseLayoutCsv(newSource.text, newSource.name);

check('the old route is a zip with the map beside the spec', () => {
  assertEqual(oldLoaded.kind, 'zip', 'the zip was not recognised');
  assert(oldLoaded.layout !== null, 'the zip carried no separate map');
  assertEqual(oldSource.from, 'bundle', 'the old route did not read the file beside the spec');
});

check('the new route is one file, and it carries the map', () => {
  assertEqual(newLoaded.kind, 'json', 'a bare spec was read as a zip');
  assertEqual(newLoaded.layout, null, 'a bare spec somehow produced a separate map');
  assertEqual(newLoaded.entries, [], 'a bare spec listed zip entries');
  assertEqual(newSource.from, 'spec', 'the new route did not read the embedded map');
});

check('gb1 carries the CSV text through verbatim', () =>
  assert(newSource.text === CSV_TEXT,
    'the embedded text differs from the fixture after an encode/decode round trip'));

check(`computedLayoutId is ${EXPECTED_LAYOUT_ID} from the separate CSV`, () =>
  assertEqual(oldMap.computedLayoutId, EXPECTED_LAYOUT_ID, 'the old route moved the hash'));

check(`computedLayoutId is ${EXPECTED_LAYOUT_ID} from the embedded CSV`, () =>
  assertEqual(newMap.computedLayoutId, EXPECTED_LAYOUT_ID, 'the new route moved the hash'));

check('the declared layout_id agrees with the computed one on both routes', () => {
  assertEqual(oldMap.declaredLayoutId, EXPECTED_LAYOUT_ID, 'old route: declared id wrong');
  assertEqual(newMap.declaredLayoutId, EXPECTED_LAYOUT_ID, 'new route: declared id wrong');
});

check('the parsed rows are deeply equal', () => {
  assertEqual(newMap.rows.length, 17, 'the embedded map does not declare 17 regions');
  assertEqual(oldMap.rows.length, newMap.rows.length, 'row counts differ');
  assertEqual(newMap.rows, oldMap.rows, 'the two routes parsed different rows');
});

check('the sheet is 16 pages either way', () => {
  assertEqual(oldMap.maxPageK, 16, 'old route: wrong page count');
  assertEqual(newMap.maxPageK, 16, 'new route: wrong page count');
});

// The hash is taken over this string. Comparing it directly says WHERE two
// routes diverged, where comparing only the digest says merely that they did.
const canonical = (map) => qrp.canonicalMapSerialization(map.rows.map(r => ({
  regionId: r.regionId, partId: r.partId, pageK: r.pageK,
  x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1,
})));

check('canonicalMapSerialization is byte-identical', () => {
  const a = canonical(oldMap), b = canonical(newMap);
  if (a !== b) {
    const at = [...a].findIndex((c, i) => c !== b[i]);
    throw new Error(`the two canonical forms diverge at byte ${at}\n` +
      `          separate: ${JSON.stringify(a.slice(Math.max(0, at - 20), at + 20))}\n` +
      `          embedded: ${JSON.stringify(b.slice(Math.max(0, at - 20), at + 20))}`);
  }
  assert(a.length > 0, 'the canonical form is empty');
});

// The hash's own arithmetic, independent of `parseLayoutCsv`: recomputed
// straight from the canonical string, so a parser that agreed with itself
// while both routes were wrong would still be caught here.
await checkAsync(`computeLayoutId over that string is ${EXPECTED_LAYOUT_ID}`, async () => {
  const hashable = newMap.rows.map(r => ({
    regionId: r.regionId, partId: r.partId, pageK: r.pageK,
    x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1,
  }));
  assertEqual(await qrp.computeLayoutId(hashable), EXPECTED_LAYOUT_ID,
    'the hash over the embedded rows is not the one on the paper');
});

// The QR on the paper is checked against this. If the two ever disagreed, the
// symptom would be silent: correct rectangles, wrong labels, no error anywhere.
check('a page printed with 95438EDF matches the embedded map', () => {
  const fields = qrp.parsePayload(`GB1-ENG17HOM496F-HWMSTR-2-16-${EXPECTED_LAYOUT_ID}`);
  assert(fields !== null, 'a well-formed ENG17 HW1 payload did not parse');
  assertEqual(fields.layoutId, newMap.computedLayoutId, 'the page and the embedded map disagree');
});

console.log(`\n    layout_id: separate ${oldMap.computedLayoutId}, ` +
  `embedded ${newMap.computedLayoutId}, ` +
  `${newMap.rows.length} regions, ${newMap.maxPageK} pages, ` +
  `canonical form ${canonical(newMap).length} bytes\n`);

// =====================================================
// 4. An edited map is still rejected, wherever it came from
// =====================================================
console.log('  4. the stale-map check applies to both routes');

for (const [label, mutate] of [
  ['a coordinate moved', t => t.replace('0.4689', '0.4700')],
  ['a region renamed', t => t.replace(',p1a,', ',p1z,')],
  ['a row deleted', t => t.split('\n').filter((_, i) => i !== 3).join('\n')],
]) {
  await checkAsync(`embedded map, ${label}: computed id no longer matches declared`, async () => {
    const map = await lay.parseLayoutCsv(mutate(CSV_TEXT), CSV_NAME);
    assertEqual(map.declaredLayoutId, EXPECTED_LAYOUT_ID, 'the fixture stopped declaring 95438EDF');
    assert(map.computedLayoutId !== EXPECTED_LAYOUT_ID,
      `an edited map still hashed to ${EXPECTED_LAYOUT_ID} — the check would pass it`);
  });
}

// The refusal itself lives in App.tsx, which cannot be imported here. Extract
// the comparison rather than restate it, so a rename or a dropped `!==` fails.
check('App.tsx compares declaredLayoutId against computedLayoutId', () =>
  assert(/layout\.declaredLayoutId\s*&&\s*layout\.declaredLayoutId\s*!==\s*layout\.computedLayoutId/
    .test(appSrc), 'the stale-map comparison is no longer in the load path'));

check('App.tsx names the source file in the stale-map message', () =>
  assert(/\$\{source\.name\} says its layout id is/.test(appSrc),
    'the stale-map message no longer names the file the map arrived under'));

// =====================================================
// 5. Handwritten with no map REFUSES — and refuses before anything moves
// =====================================================
console.log('\n  5. refuse, not warn');

// A2. This used to warn and load anyway: `setState` ran and *then* the alert
// fired, leaving the student in exactly the broken state the message described
// and free to photograph sixteen pages before finding out. The ordering is the
// whole fix, so the ordering is what is asserted — by position in the shipped
// source, not by the presence of a string.
const handlerAt = appSrc.indexOf('const handleLoadAssignment');
check('App.tsx still has the load handler', () =>
  assert(handlerAt > 0, 'handleLoadAssignment not found in App.tsx'));

const refuseAt = appSrc.indexOf("json.inputMode === 'handwritten' && !layout", handlerAt);
const setStateAt = appSrc.indexOf('setState(prev => ({', handlerAt);
const clearAt = appSrc.indexOf('void clearPageBlobs();', handlerAt);
const returnAfterRefuse = appSrc.indexOf('return;', refuseAt);

check('the handwritten-with-no-map branch is in the load handler', () =>
  assert(refuseAt > handlerAt, 'the no-map branch is gone from handleLoadAssignment'));

check('it RETURNS rather than falling through', () => {
  assert(returnAfterRefuse > refuseAt, 'no `return;` follows the no-map branch');
  assert(returnAfterRefuse < setStateAt,
    'the `return;` after the no-map branch comes after setState — the load proceeds anyway');
});

check('nothing is dropped and no state moves before the refusal', () => {
  assert(refuseAt < setStateAt,
    `the no-map branch is at ${refuseAt}, setState at ${setStateAt} — state moves first`);
  assert(refuseAt < clearAt,
    'the page blobs are cleared before the assignment is refused');
});

// The message was already good; the work order says to keep the wording.
check('the refusal still says what to load instead', () =>
  assert(/is written on paper, but the file you loaded has no layout map in it/.test(appSrc),
    'the no-map wording changed'));

// The student is not asked to discard sixteen photographs for a load that is
// about to be refused.
const confirmAt = appSrc.indexOf('Loading an assignment clears your current work', handlerAt);
check('the discard-your-pages confirm comes after the file is accepted', () => {
  assert(confirmAt > 0, 'the clear-work confirm is gone');
  assert(confirmAt > refuseAt,
    'the student is asked to discard their pages before the file is known to be loadable');
});

// A bare handwritten spec that DOES carry a map has nothing to warn about, and
// this is the input the refusal branch reads.
check('a handwritten spec carrying a map produces a map', () => {
  const source = bundle.chooseLayoutSource(null,
    specObject({ layoutCsvName: CSV_NAME, layoutCsv: CSV_TEXT }));
  assert(source !== null, 'a complete single-file assignment would be refused');
});

check('a handwritten spec carrying no map produces none', () =>
  assertEqual(bundle.chooseLayoutSource(null, specObject()), null,
    'a spec with no map did not reach the refusal'));

// =====================================================
// 6. The old shape keeps working, end to end
// =====================================================
console.log('\n  6. old material, untouched');

await checkAsync('an old-shape zip with no embedded fields loads exactly as before', async () => {
  const spec = await cryptoSvc.decryptJson(oldLoaded.specText);
  assert(!('layoutCsv' in spec), 'the old spec grew a layoutCsv from somewhere');
  assert(!('layoutCsvName' in spec), 'the old spec grew a layoutCsvName from somewhere');
  assertEqual(oldLoaded.entries.length, 3, 'the old zip did not carry three files');
  assertEqual(oldMap.computedLayoutId, EXPECTED_LAYOUT_ID, 'the old route moved the hash');
});

await checkAsync('a plain (unencoded) spec carrying the map also loads', async () => {
  const text = JSON.stringify(specObject({ layoutCsvName: CSV_NAME, layoutCsv: CSV_TEXT }));
  const loaded = await bundle.loadAssignmentBundle(asFile(new TextEncoder().encode(text)));
  const source = bundle.chooseLayoutSource(loaded.layout, JSON.parse(loaded.specText));
  const map = await lay.parseLayoutCsv(source.text, source.name);
  assertEqual(map.computedLayoutId, EXPECTED_LAYOUT_ID, 'JSON round-tripping moved the hash');
});

// =====================================================
console.log('');
for (const line of results) console.log(line);
console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
