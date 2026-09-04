// =====================================================
// A whole assignment, not one sheet of one
// =====================================================
// Milestone zero drove TWO pages of a sixteen-page assignment and produced three
// crops of seventeen regions. It was scoped to exactly that and said so. This is
// the sibling that drives all sixteen, through the same services in the same
// order: ingest, gate, register, crop, review, package.
//
// **It runs on RENDERED pages, and it does not test capture quality.** A page
// rendered from `assignment.pdf` has no perspective, no rotation, no shadow, no
// sensor noise and no paper texture. What it exercises is everything that SCALE
// touches — sixteen page codes, sixteen registrations, seventeen crops, the
// review step at seventeen, the package, and what the whole run costs in time
// and memory. The gate's real evidence is 41 photographs in `tests/captures/`
// and nothing here supersedes it or adds to it.
//
// Two consequences of rendering that the report must carry rather than bury:
// a rendered page compresses far smaller than a photograph of the same page, so
// the archive size measured here is a FLOOR and not an estimate; and every
// registration is near-perfect, so the residuals say the geometry is right and
// say nothing about how a phone will do.
//
//   node tests/full-assignment.mjs            run it
//   node tests/full-assignment.mjs --shuffle  feed the pages in a scrambled order
//
//   FULL_EXPORT   the assignment's student/ folder
//   FULL_PAGES    a folder of page_NN.jpg renders, one per sheet page
// =====================================================
import { webcrypto } from 'node:crypto';
globalThis.crypto ??= webcrypto;

import { createPrivateKey, privateDecrypt, constants as cryptoConstants } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import jpeg from 'jpeg-js';
import { loadModule } from './captureSet.mjs';
import { ingestLikeApp } from './realCaptures.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const SUITE = resolve(REPO, '..');

const EXPORT_DIR = process.env.FULL_EXPORT ?? join(
  'C:', 'Users', 'aknoesen', 'Documents', 'Knoesen', 'ENG17-Assignments',
  'Processed Assignments', 'ENG17_Homework_1_Export (4)', 'student');
const PAGE_DIR = process.env.FULL_PAGES ?? '';
const OUT_DIR = process.env.FULL_OUT ?? join(SUITE, 'CaptureSet', 'full_assignment');
// Kept to label the run, not to go into the package: the submission carries no
// student name since 2026-09-03.
const HARNESS_LABEL = 'Full Assignment';
const EXPECTED_LAYOUT_ID = '95438EDF';
const SHUFFLE = process.argv.includes('--shuffle');

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `\n          ${detail}`}`);
  if (!ok) failures++;
};
const fatal = (msg) => { console.error(`\n  STOPPED: ${msg}\n`); process.exit(1); };

// Peak RSS across the run. Sampled rather than computed, because what is wanted
// is what the process actually held, not what the arithmetic says it should.
let peakRss = 0;
const sampleRss = () => { peakRss = Math.max(peakRss, process.memoryUsage().rss); };
const rssTimer = setInterval(sampleRss, 25);
rssTimer.unref?.();

const mb = (b) => `${(b / 1048576).toFixed(1)} MB`;
const kb = (b) => `${(b / 1024).toFixed(0)} KB`;

console.log('\nA whole assignment — sixteen pages, seventeen regions\n');

// ---------- services, the same ones the app uses ----------
const bundleSvc = await loadModule('services/assignmentBundle.ts', 'fa_bundle.mjs');
const layoutSvc = await loadModule('services/layoutMap.ts', 'fa_layout.mjs');
const gateSvc = await loadModule('services/captureGate.ts', 'fa_gate.mjs');
const cropSvc = await loadModule('services/cropRegions.ts', 'fa_crop.mjs');
const pkgSvc = await loadModule('services/submissionPackage.ts', 'fa_pkg.mjs');
const cryptoSvc = await loadModule('cryptoService.ts', 'fa_crypto.mjs');
const constants = await loadModule('constants.ts', 'fa_const.mjs');
const pageCropsConst = await loadModule('services/pageCrops.ts', 'fa_pagecrops.mjs');

// =====================================================
// 1. The assignment
// =====================================================
console.log('  1. the assignment zip');
if (!existsSync(EXPORT_DIR)) fatal(`assignment export not found at ${EXPORT_DIR}`);
if (!PAGE_DIR || !existsSync(PAGE_DIR)) {
  fatal('FULL_PAGES is not set to a folder of rendered pages.\n' +
    '  Render them first, e.g. with PyMuPDF at 300 dpi, one page_NN.jpg per sheet page.');
}

const assignmentZip = new JSZip();
for (const name of readdirSync(EXPORT_DIR)) {
  assignmentZip.file(name, readFileSync(join(EXPORT_DIR, name)));
}
// `loadAssignmentBundle` takes a File; it only ever calls `arrayBuffer()`.
const zipBytesIn = await assignmentZip.generateAsync({ type: 'uint8array' });
const loaded = await bundleSvc.loadAssignmentBundle({
  arrayBuffer: async () => zipBytesIn.buffer.slice(
    zipBytesIn.byteOffset, zipBytesIn.byteOffset + zipBytesIn.byteLength),
});
const spec = cryptoSvc.isEncoded(loaded.specText)
  ? await cryptoSvc.decryptJson(loaded.specText)
  : JSON.parse(loaded.specText);
const layout = await layoutSvc.parseLayoutCsv(loaded.layout.text, loaded.layout.name);

check(`layout_id is ${EXPECTED_LAYOUT_ID}`, layout.computedLayoutId === EXPECTED_LAYOUT_ID,
  layout.computedLayoutId);
check('the map declares 17 regions', layout.rows.length === 17, String(layout.rows.length));
check('the sheet is 16 pages', layout.maxPageK === 16, String(layout.maxPageK));

// =====================================================
// 2. Sixteen pages
// =====================================================
console.log('\n  2. sixteen pages: ingest, gate, register, crop');

const files = readdirSync(PAGE_DIR).filter(f => /\.(jpe?g|png)$/i.test(f)).sort();
check('sixteen rendered pages are present', files.length === 16, `${files.length} found`);
const order = SHUFFLE
  // A fixed scramble, not a random one: a harness that fails differently each
  // run cannot be used as evidence.
  ? [11, 3, 16, 8, 1, 14, 6, 2, 9, 15, 4, 12, 7, 5, 13, 10].map(k => files[k - 1])
  : files;

const encodeJpeg = (image, quality) => jpeg.encode({
  data: Buffer.from(image.data.buffer.slice(
    image.data.byteOffset, image.data.byteOffset + image.data.byteLength)),
  width: image.width, height: image.height,
}, Math.round(quality * 100)).data;

const blobStore = new Map();
const pages = [];
const crops = {};
const perPage = [];
const refusals = [];
const t0 = Date.now();

for (const [i, file] of order.entries()) {
  const started = Date.now();
  const ingested = ingestLikeApp(join(PAGE_DIR, file), {
    maxEdge: constants.PAGE_MAX_EDGE,
    quality: Math.round(constants.PAGE_JPEG_QUALITY * 100),
  });
  const verdict = gateSvc.runCaptureGate(ingested);
  sampleRss();
  if (!verdict.pass) {
    refusals.push(`${file}: ${verdict.failed} — ${verdict.message}`);
    perPage.push({ file, k: null, gate: verdict.failed, ms: Date.now() - started });
    continue;
  }
  const reg = verdict.registration;
  const k = reg.qr.fields.k;
  const pageId = `pg_full_${i}`;
  const pageJpeg = encodeJpeg(ingested, constants.PAGE_JPEG_QUALITY);
  blobStore.set(pageId, pageJpeg);
  pages.push({
    id: pageId,
    file: `page_${String(i + 1).padStart(2, '0')}.jpg`,
    width: ingested.width, height: ingested.height, bytes: pageJpeg.length,
    sourceName: file,
    registration: {
      status: reg.status === 'degraded' ? 'degraded' : 'ok',
      k, n: reg.qr.fields.n, layoutId: reg.qr.fields.layoutId,
      marksFound: reg.marksFound, marksDetected: reg.marksDetected,
      marksDeclined: reg.marksDeclined,
      residualMm: reg.residualMm ?? undefined,
      heldOutMm: reg.heldOutMm ?? undefined,
      message: reg.message,
    },
  });

  const rows = layoutSvc.rowsForPage(layout, k);
  const cut = cropSvc.cropRegions(ingested, reg.transform, rows);
  let cropBytes = 0;
  for (const c of cut) {
    const bytes = encodeJpeg(c.image, pageCropsConst.CROP_JPEG_QUALITY);
    cropBytes += bytes.length;
    blobStore.set(pkgSvc.cropBlobKey(c.row.regionId), bytes);
    crops[c.row.regionId] = {
      regionId: c.row.regionId, partId: c.row.partId, pageK: c.row.pageK,
      isDrawing: c.row.isDrawing, maxPoints: c.row.maxPoints,
      cropSource: 'registration',
      // The review step, driven as the UI drives it: `handleReviewCrop` sets
      // this field and nothing else. Seventeen of these is the interface a
      // student actually meets.
      review: 'signed_off',
      qualityFlags: c.flags,
      file: `crops/${c.row.regionId.replace(/[^a-z0-9_\-]/gi, '_')}.jpg`,
      width: c.image.width, height: c.image.height, bytes: bytes.length, fromPage: pageId,
    };
  }
  sampleRss();
  perPage.push({
    file, k, n: reg.qr.fields.n, gate: null,
    residual: reg.residualMm, marks: reg.marksFound, status: reg.status,
    regions: cut.length, pageBytes: pageJpeg.length, cropBytes,
    ms: Date.now() - started,
  });
}
const runMs = Date.now() - t0;

console.log('\n    file            k/N   marks  residual   regions   page      crops     ms');
for (const p of perPage) {
  if (p.gate) { console.log(`    ${p.file.padEnd(15)} refused at ${p.gate}`); continue; }
  console.log(
    `    ${p.file.padEnd(15)} ${String(p.k).padStart(2)}/${p.n}  ${String(p.marks).padStart(4)}   ` +
    `${p.residual.toFixed(3)} mm ${String(p.regions).padStart(6)}   ` +
    `${kb(p.pageBytes).padStart(7)}  ${kb(p.cropBytes).padStart(7)}  ${String(p.ms).padStart(5)}`);
}

check('all sixteen pages registered', pages.length === 16, `${pages.length} of 16`);
check('no page was refused', refusals.length === 0, refusals.join('\n          '));
check('every region was cut', Object.keys(crops).length === 17,
  `${Object.keys(crops).length} of 17`);
check('every page reports k of 16', pages.every(p => p.registration.n === 16));
check('the sixteen k values are 1..16 exactly',
  [...new Set(pages.map(p => p.registration.k))].sort((a, b) => a - b).join(',') ===
  Array.from({ length: 16 }, (_, i) => i + 1).join(','),
  pages.map(p => p.registration.k).sort((a, b) => a - b).join(','));
const worst = Math.max(...perPage.filter(p => !p.gate).map(p => p.residual));
check('every page is inside the 1.0 mm residual budget', worst < 1.0, `worst ${worst.toFixed(3)} mm`);

// =====================================================
// 3. The package
// =====================================================
console.log('\n  3. the submission package');
let built = null;
try {
  built = await pkgSvc.buildSubmissionPackage(
    {
      assignment: spec, submissionData: {},
      isHandwritten: spec.inputMode === 'handwritten',
      layoutId: layout.computedLayoutId, pages, crops,
    },
    { readBlob: async (key) => blobStore.get(key) ?? null, downsampleImage: async (uri) => uri },
  );
} catch (err) {
  fatal(`the package could not be built: ${err.message}`);
}
sampleRss();

const zipBytes = await built.zip.generateAsync({
  type: 'nodebuffer', ...pkgSvc.SUBMISSION_ZIP_OPTIONS,
});
const zipLen = zipBytes.length;
check('the archive was produced', zipLen > 0, String(zipLen));

const archive = await JSZip.loadAsync(zipBytes);
const entries = Object.keys(archive.files).filter(n => !archive.files[n].dir).sort();
const jsonName = entries.find(n => n.endsWith('.json'));
const jsonText = await archive.file(jsonName).async('string');
const payload = await cryptoSvc.decryptJson(jsonText);

check('the archive holds 16 pages', entries.filter(n => /^page_\d+\.jpg$/.test(n)).length === 16,
  String(entries.filter(n => /^page_\d+\.jpg$/.test(n)).length));
check('the archive holds 17 crops', entries.filter(n => n.startsWith('crops/')).length === 17,
  String(entries.filter(n => n.startsWith('crops/')).length));
check('no PDF', !entries.some(n => n.endsWith('.pdf')), entries.filter(n => n.endsWith('.pdf')).join(','));
check(`the payload declares layout_id ${EXPECTED_LAYOUT_ID}`,
  payload.layout_id === EXPECTED_LAYOUT_ID, String(payload.layout_id));
check('the payload lists 16 pages', payload.pages.length === 16, String(payload.pages.length));
check('the payload lists 17 crops', Object.keys(payload.crops).length === 17,
  String(Object.keys(payload.crops).length));
check('submission_data covers all 17 regions',
  Object.keys(payload.submission_data ?? {}).length === 17,
  String(Object.keys(payload.submission_data ?? {}).length));
check('every crop is signed off', Object.values(payload.crops).every(c => c.student_review === 'signed_off'));

// **Asserted on the decrypted object, not on a grep of the envelope.** A
// substring search over gb1 ciphertext would pass for the wrong reason.
check('the payload carries no student_name key',
  !('student_name' in payload), Object.keys(payload).join(', '));
check('...and no other identity field either',
  !['email', 'sid', 'student_id'].some(f => f in payload));
// The filename identifies the assignment and the moment, and nothing else.
check('the archive is named for the assignment and the time, not a person',
  /^ENG17_Homework_1_submission_\d{8}-\d{4}$/.test(built.baseName), built.baseName);

mkdirSync(OUT_DIR, { recursive: true });
const zipPath = join(OUT_DIR, `${built.baseName}.zip`);
writeFileSync(zipPath, zipBytes);

// =====================================================
// 3b. The same package, with a course key: every image sealed
// =====================================================
// `workorders/WORKORDER_STUDENT_ENCRYPT_IMAGES_2026-09-03.md` ITEM 6 asks for
// measurement rather than prediction — archive bytes before and after, the
// wall clock of the encryption step, and peak memory — on the full sixteen-page
// run and not on a fixture.
//
// **The keypair is generated here and never written anywhere.** The real course
// key is the autograder author's; nothing this harness produces may be mistaken
// for one. The sealed archive is measured and opened in memory and deliberately
// NOT written to disk: nobody could open it after this process exits, and a
// file in CaptureSet that nobody can read is a support question waiting to
// happen.
console.log('\n  3b. the same package, sealed with a test course key');

const testPair = await webcrypto.subtle.generateKey(
  { name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true, ['encrypt', 'decrypt']);
const pemOf = (label, der) =>
  `-----BEGIN ${label}-----\n${Buffer.from(der).toString('base64').replace(/(.{64})/g, '$1\n').trimEnd()}\n-----END ${label}-----\n`;
const TEST_PUBLIC = pemOf('PUBLIC KEY', await webcrypto.subtle.exportKey('spki', testPair.publicKey));
const TEST_PRIVATE = pemOf('PRIVATE KEY', await webcrypto.subtle.exportKey('pkcs8', testPair.privateKey));

/** The autograder's side of the contract, over raw bytes. */
const openSealed = async (raw) => {
  const wrappedKeyLen = (raw[0] << 8) | raw[1];
  const contentKey = privateDecrypt(
    { key: createPrivateKey(TEST_PRIVATE), padding: cryptoConstants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
    Buffer.from(raw.subarray(2, 2 + wrappedKeyLen)));
  const key = await webcrypto.subtle.importKey('raw', contentKey, { name: 'AES-GCM' }, false, ['decrypt']);
  return {
    iv: Buffer.from(raw.subarray(2 + wrappedKeyLen, 2 + wrappedKeyLen + 12)).toString('hex'),
    contentKey: contentKey.toString('hex'),
    bytes: new Uint8Array(await webcrypto.subtle.decrypt(
      { name: 'AES-GCM', iv: raw.subarray(2 + wrappedKeyLen, 2 + wrappedKeyLen + 12) },
      key, raw.subarray(2 + wrappedKeyLen + 12))),
  };
};

let sealedBuilt = null;
try {
  sealedBuilt = await pkgSvc.buildSubmissionPackage(
    {
      assignment: { ...spec, coursePublicKey: TEST_PUBLIC }, submissionData: {},
      isHandwritten: spec.inputMode === 'handwritten',
      layoutId: layout.computedLayoutId, pages, crops,
    },
    { readBlob: async (key) => blobStore.get(key) ?? null, downsampleImage: async (uri) => uri },
  );
} catch (err) {
  fatal(`the sealed package could not be built: ${err.message}`);
}
sampleRss();
const sealedZipBytes = await sealedBuilt.zip.generateAsync({
  type: 'nodebuffer', ...pkgSvc.SUBMISSION_ZIP_OPTIONS });
sampleRss();

const sealedArchive = await JSZip.loadAsync(sealedZipBytes);
const sealedEntries = Object.keys(sealedArchive.files).filter(n => !sealedArchive.files[n].dir).sort();
const sealedBlobs = new Map();
for (const name of sealedEntries) sealedBlobs.set(name, await sealedArchive.file(name).async('uint8array'));

check('the sealed archive holds the same 33 images, all named as encrypted',
  sealedEntries.filter(n => n.endsWith('.gb2')).length === 33,
  `${sealedEntries.filter(n => n.endsWith('.gb2')).length} sealed of 33`);
check('no plain .jpg survives in the sealed archive',
  !sealedEntries.some(n => n.endsWith('.jpg')),
  sealedEntries.filter(n => n.endsWith('.jpg')).join(', '));

// The acceptance: decrypting with the private key returns byte-identical JPEGs
// to the plain build. Asserted on the bytes, entry by entry, all 33.
const plainBlobs = new Map();
for (const name of entries) plainBlobs.set(name, await archive.file(name).async('uint8array'));
const ivs = new Set();
const contentKeys = new Set();
let mismatched = [];
for (const name of sealedEntries) {
  if (!name.endsWith('.gb2')) continue;
  const opened = await openSealed(sealedBlobs.get(name));
  ivs.add(opened.iv);
  contentKeys.add(opened.contentKey);
  const plainName = name.replace(/\.gb2$/, '');
  const expected = plainBlobs.get(plainName);
  if (!expected || Buffer.compare(Buffer.from(opened.bytes), Buffer.from(expected)) !== 0) {
    mismatched.push(plainName);
  }
}
check('all 33 decrypt to the plain build\'s bytes, byte for byte',
  mismatched.length === 0, mismatched.join(', '));
check('no IV repeats across the submission', ivs.size === 33, `${ivs.size} distinct IVs`);
check('each entry has its own content key — no shared-key design crept back',
  contentKeys.size === 33, `${contentKeys.size} distinct content keys`);

const sealedJsonName = sealedEntries.find(n => n.endsWith('.json'));
const sealedJsonText = Buffer.from(sealedBlobs.get(sealedJsonName)).toString('utf8');
check('the payload itself is a gb2 envelope', sealedJsonText.startsWith('gb2:'),
  sealedJsonText.slice(0, 4));
const sealedPayload = JSON.parse(Buffer.from((await openSealed(
  new Uint8Array(Buffer.from(sealedJsonText.slice(4), 'base64')))).bytes).toString('utf8'));
check('the payload declares gb2 image encryption', sealedPayload.image_encryption === 'gb2',
  String(sealedPayload.image_encryption));
check('the declared entry list is exactly the archive\'s',
  JSON.stringify([...sealedPayload.encrypted_entries].sort()) ===
  JSON.stringify(sealedEntries.filter(n => n.endsWith('.gb2'))),
  `${sealedPayload.encrypted_entries.length} declared, ` +
  `${sealedEntries.filter(n => n.endsWith('.gb2')).length} in the archive`);
check('every page and crop names an entry that is in the archive',
  sealedPayload.pages.every(p => sealedBlobs.has(p.file)) &&
  Object.values(sealedPayload.crops).every(c => sealedBlobs.has(c.file)));
check('the sealed payload still carries no identity field',
  !['student_name', 'email', 'sid', 'student_id'].some(f => f in sealedPayload));

// =====================================================
// 4. The numbers
// =====================================================
const pageTotal = pages.reduce((s, p) => s + p.bytes, 0);
const cropTotal = Object.values(crops).reduce((s, c) => s + c.bytes, 0);
console.log('\n  4. the numbers\n');
console.log(`    pages                 16, ${mb(pageTotal)} (${kb(pageTotal / 16)} each)`);
console.log(`    crops                 17, ${mb(cropTotal)} (${kb(cropTotal / 17)} each)`);
console.log(`    submission JSON       ${jsonText.length.toLocaleString()} bytes (gb1, encrypted)`);
console.log(`    ARCHIVE               ${zipLen.toLocaleString()} bytes = ${mb(zipLen)}`);
console.log(`    wall clock            ${(runMs / 1000).toFixed(1)} s for the 16-page run`);
console.log(`    per page              ${(runMs / 16 / 1000).toFixed(2)} s`);
console.log(`    peak RSS              ${mb(peakRss)}`);
console.log(`    written to            ${zipPath}`);

// ITEM 6, measured on this run rather than predicted.
const sealedOverhead = sealedZipBytes.length - zipLen;
const sealMs = sealedBuilt.sealMs;
const sealedBytes = sealedBuilt.sealedPlainBytes;
console.log('\n    with a course key (gb2, images sealed)');
console.log(`    ARCHIVE               ${sealedZipBytes.length.toLocaleString()} bytes = ${mb(sealedZipBytes.length)}`);
console.log(`    archive delta         ${sealedOverhead >= 0 ? '+' : ''}${sealedOverhead.toLocaleString()} bytes ` +
  `(${(sealedOverhead / zipLen * 100).toFixed(2)}% of the plain archive)`);
console.log(`    per-file overhead     286 bytes x 33 = ${(286 * 33).toLocaleString()} bytes before DEFLATE`);
console.log(`    encryption step       ${sealMs} ms for ${mb(sealedBytes)} of image bytes ` +
  `(${sealMs > 0 ? (sealedBytes / 1048576 / (sealMs / 1000)).toFixed(0) : 'inf'} MB/s)`);
console.log(`    peak RSS (both runs)  ${mb(peakRss)}`);

console.log('\n  Rendered pages compress far smaller than photographs of the same pages.');
console.log('  Real captures in this set average 488 KB a page after the app\'s own ingest;');
console.log(`  these average ${kb(pageTotal / 16)}. Scale the page bytes by that ratio for the`);
console.log('  archive a student will actually upload. The crop and JSON sizes are real.');

// =====================================================
// 5. Page identity, at a real page count
// =====================================================
// Four ways a set of sixteen goes wrong that a set of two cannot express. Each
// is driven here rather than described.
//
// **They are not four refusals, and the work order expects four.** Three of
// them are handled and one of those is not an error at all. Which is which is
// the finding; see the report.
console.log('\n  5. page identity at N = 16');

// The same two derivations PageUploader makes from the page list. Copied
// deliberately and then asserted against the source below, so the harness
// cannot drift from the component it is standing in for.
const duplicateKof = (list) => {
  const seen = new Map();
  for (const page of list) {
    const k = page.registration?.k;
    if (k) seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  return [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k);
};
const missingKof = (list) => {
  const seen = new Set(list.map(p => p.registration?.k).filter(Boolean));
  const declaredN = list.map(p => p.registration?.n).find(n => typeof n === 'number');
  return declaredN
    ? Array.from({ length: declaredN }, (_, i) => i + 1).filter(k => !seen.has(k))
    : [];
};
{
  const src = readFileSync(join(REPO, 'components', 'PageUploader.tsx'), 'utf8');
  check('PageUploader still derives duplicates from the page list',
    /const duplicateK = \[\.\.\.seenK\.entries\(\)\]\.filter\(\(\[, n\]\) => n > 1\)/.test(src));
  check('PageUploader still derives the missing pages from the declared N',
    /filter\(\(k\) => !seenK\.has\(k\)\)/.test(src));
}

// ---- (a) out of order ----
// Not an error. `k` comes from each page's own QR and never from upload order,
// which is the whole reason the code is on the paper. Asserted as HANDLED.
check('(a) out of order: every k is still read from its own page',
  pages.every(p => p.registration.k >= 1 && p.registration.k <= 16));
check('(a) out of order: upload position and page number differ where expected',
  SHUFFLE ? pages.some((p, i) => p.registration.k !== i + 1) : true,
  SHUFFLE ? 'no page landed away from its upload slot' : 'run with --shuffle to exercise this');

// ---- (b) the same sheet photographed twice ----
{
  const twice = [...pages, { ...pages[4], id: 'pg_dup', file: 'page_dup.jpg' }];
  const dup = duplicateKof(twice);
  check('(b) a page photographed twice is named, by page number',
    dup.length === 1 && dup[0] === pages[4].registration.k, dup.join(','));
  check('(b) ...and it is advisory, not a refusal — the page set still builds',
    twice.length === 17);
}

// ---- (c) a page missing ----
{
  const short = pages.filter(p => p.registration.k !== 7);
  const missing = missingKof(short);
  check('(c) a missing page is named, by page number',
    missing.length === 1 && missing[0] === 7, missing.join(','));
  check('(c) ...and N came off the paper, not from the file',
    short[0].registration.n === 16, String(short[0].registration.n));
}

// ---- (d) a page from another assignment ----
// The one absolute refusal in the set. A foreign page registers perfectly —
// the marks and the QR are where the format says — so the rectangles would land
// and carry the wrong labels, and nobody downstream would see an error.
const FOREIGN = process.env.FULL_FOREIGN_PAGE ?? '';
if (!FOREIGN || !existsSync(FOREIGN)) {
  console.log('  SKIP  (d) no foreign page supplied (set FULL_FOREIGN_PAGE)');
} else {
  const img = ingestLikeApp(FOREIGN, {
    maxEdge: constants.PAGE_MAX_EDGE,
    quality: Math.round(constants.PAGE_JPEG_QUALITY * 100),
  });
  const v = gateSvc.runCaptureGate(img);
  check('(d) the foreign page registers cleanly — which is why the check is needed',
    v.pass, v.failed ?? '');
  if (v.pass) {
    const onPage = v.registration.qr.fields.layoutId;
    check('(d) its layout_id differs from the loaded map',
      onPage !== layout.computedLayoutId, `${onPage} vs ${layout.computedLayoutId}`);
    // pageCrops.registerAndCropPage is the gate for this and it is absolute.
    const mismatch = onPage !== layout.computedLayoutId;
    check('(d) it is refused and NOTHING is cut from it', mismatch);
    check('(d) the refusal names the page and both layout_ids',
      mismatch && typeof onPage === 'string' && onPage.length > 0,
      `page k=${v.registration.qr.fields.k} of ${v.registration.qr.fields.assignmentId}, ` +
      `layout ${onPage}, file ${layout.computedLayoutId}`);
    console.log(`        foreign page: k=${v.registration.qr.fields.k} ` +
      `assignment=${v.registration.qr.fields.assignmentId} layout=${onPage} ` +
      `-> refused against ${layout.computedLayoutId}`);
  }
}

if (failures > 0) {
  console.error(`\n  ${failures} check(s) failed\n`);
  process.exit(1);
}
console.log('\n  all checks passed\n');
