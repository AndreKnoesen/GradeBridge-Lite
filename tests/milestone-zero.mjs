// =====================================================
// Milestone zero — one printed sheet, all the way to a package that opens
// =====================================================
// `workorders/WORKORDER_MILESTONE_ZERO_2026-09-01.md`. Everything else this app
// does sits upstream of this path and until now nobody had run it end to end.
//
//   node tests/milestone-zero.mjs
//
// It drives the same functions the UI drives — `loadAssignmentBundle`,
// `parseLayoutCsv`, `runCaptureGate`, `registerPage`, `cropRegions`,
// `buildSubmissionPackage` — writes the archive to disk, unzips it, and
// measures what came out.
//
// ## What it does NOT do
//
// **It does not judge the crops.** Whether `crops/p1a.jpg` actually contains
// the handwriting for part 1(a) is a judgement only a person can make, and it
// is the one thing this exercise exists to establish. So the crops are measured
// and copied out to be looked at; nothing here asserts they are right.
//
// ## Two substitutions, both unavoidable, both named
//
// 1. **Ingest.** `imageIngest.ingestPage` is canvas-bound. `ingestLikeApp` in
//    `realCaptures.mjs` mirrors it exactly — EXIF upright, halved to
//    PAGE_MAX_EDGE, re-encoded at PAGE_JPEG_QUALITY — and is what the gate
//    suite already measures against.
// 2. **JPEG encoding.** `pageCrops.rgbaToJpegBlob` is canvas-bound too, so the
//    crops are encoded here with `jpeg-js` at the same CROP_JPEG_QUALITY. The
//    pixels handed to the encoder are `cropRegions`' own output, untouched.
//
// There is no third. A handwritten submission carries no PDF at all; see part 3.
// =====================================================

import { webcrypto } from 'node:crypto';
globalThis.crypto ??= webcrypto;

import { createPrivateKey, privateDecrypt, constants as cryptoConstants } from 'node:crypto';
import {
  cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import jpeg from 'jpeg-js';
import { loadModule, CAPTURE_DIR } from './captureSet.mjs';
import { ingestLikeApp } from './realCaptures.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const SUITE = resolve(REPO, '..');

// `Export (2)` was the folder on 2026-09-01 and is gone; `Export (4)` is the
// same assignment re-exported after the target-points fix, same `layout_id`
// 95438EDF, and it is the one that totals 200. Override with MILESTONE_EXPORT.
//
// **Do not point this at `CaptureSet/frozen_export/student`.** It carries the
// same `layout_id` and the same geometry — points are outside the hash — but it
// predates the 2026-09-01 target-points fix and its map totals 100, so every
// `max_points` in the package comes out halved. It fails the points check here,
// which is the only thing that catches it.
const EXPORT_DIR = process.env.MILESTONE_EXPORT ?? join(
  'C:', 'Users', 'aknoesen', 'Documents', 'Knoesen', 'ENG17-Assignments',
  'Processed Assignments', 'ENG17_Homework_1_Export (4)', 'student');
const OUT_DIR = process.env.MILESTONE_OUT ?? join(SUITE, 'CaptureSet', 'milestone_zero');

// The package carries no student name since 2026-09-03 — identity is
// Gradescope's authenticated submitter. This is kept only to label the report.
const HARNESS_LABEL = 'Milestone Zero';
const EXPECTED_LAYOUT_ID = '95438EDF';

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failures++;
};
const fatal = (msg) => { console.error(`\n  STOPPED: ${msg}\n`); process.exit(1); };

// =====================================================
// The app's own modules
// =====================================================
const bundleSvc = await loadModule('services/assignmentBundle.ts', 'mz_bundle.mjs');
const layoutSvc = await loadModule('services/layoutMap.ts', 'mz_layout.mjs');
const gateSvc = await loadModule('services/captureGate.ts', 'mz_gate.mjs');
const regSvc = await loadModule('services/registration.ts', 'mz_reg.mjs');
const cropSvc = await loadModule('services/cropRegions.ts', 'mz_crop.mjs');
const pkgSvc = await loadModule('services/submissionPackage.ts', 'mz_pkg.mjs');
const cryptoSvc = await loadModule('cryptoService.ts', 'mz_crypto.mjs');
const constants = await loadModule('constants.ts', 'mz_const.mjs');
const pageCropsConst = await loadModule('services/pageCrops.ts', 'mz_pagecrops.mjs');

console.log('\nMilestone zero — one sheet, photographed, to a package that opens\n');

// =====================================================
// 1. Load the assignment zip
// =====================================================
console.log('  1. the assignment zip');

if (!existsSync(EXPORT_DIR)) fatal(`assignment export not found at ${EXPORT_DIR}`);

const assignmentZip = new JSZip();
for (const name of readdirSync(EXPORT_DIR)) {
  assignmentZip.file(name, readFileSync(join(EXPORT_DIR, name)));
}
const assignmentZipBytes = await assignmentZip.generateAsync({ type: 'uint8array' });

// `loadAssignmentBundle` takes a File; it only ever calls `arrayBuffer()`.
const loaded = await bundleSvc.loadAssignmentBundle({
  arrayBuffer: async () => assignmentZipBytes.buffer.slice(
    assignmentZipBytes.byteOffset, assignmentZipBytes.byteOffset + assignmentZipBytes.byteLength),
});
check('the zip is recognised as a bundle', loaded.kind === 'zip', loaded.kind);
check('it carries a layout map', loaded.layout !== null);
check('it carries the three student files', loaded.entries.length === 3,
  loaded.entries.map(e => e.name).join(', '));

const specText = loaded.specText;
const spec = cryptoSvc.isEncoded(specText)
  ? await cryptoSvc.decryptJson(specText)
  : JSON.parse(specText);
check('the spec decodes', spec !== null && typeof spec === 'object');
check('the spec is handwritten', spec.inputMode === 'handwritten', String(spec.inputMode));

const layout = await layoutSvc.parseLayoutCsv(loaded.layout.text, loaded.layout.name);
check(`the recomputed layout_id is ${EXPECTED_LAYOUT_ID}`,
  layout.computedLayoutId === EXPECTED_LAYOUT_ID, layout.computedLayoutId);
check('the map declares 17 regions', layout.rows.length === 17, String(layout.rows.length));
check('the sheet is 16 pages', layout.maxPageK === 16, String(layout.maxPageK));
const totalPoints = layout.rows.reduce((s, r) => s + r.maxPoints, 0);
check('the map totals 200 points', totalPoints === 200, String(totalPoints));

// =====================================================
// 2. Ingest, gate, register, crop
// =====================================================
console.log('\n  2. the photographs');

const PHOTOS = [
  { name: 'cap01', file: join(CAPTURE_DIR, 'real', 'cap01.jpg') },
  { name: 'cap11', file: join(CAPTURE_DIR, 'real', 'cap11.jpg') },
];

/** Mirrors `pageCrops.rgbaToJpegBlob`, which needs a canvas. */
const encodeJpeg = (image, quality) => jpeg.encode({
  data: Buffer.from(image.data.buffer.slice(
    image.data.byteOffset, image.data.byteOffset + image.data.byteLength)),
  width: image.width,
  height: image.height,
}, Math.round(quality * 100)).data;

const blobStore = new Map();
const pages = [];
const crops = {};
const cropReport = [];
const refusals = [];

for (const [index, photo] of PHOTOS.entries()) {
  if (!existsSync(photo.file)) fatal(`capture not found: ${photo.file}`);
  const ingested = ingestLikeApp(photo.file, {
    maxEdge: constants.PAGE_MAX_EDGE,
    quality: Math.round(constants.PAGE_JPEG_QUALITY * 100),
  });

  const verdict = gateSvc.runCaptureGate(ingested);
  check(`${photo.name}: passes the capture gate`, verdict.pass,
    `${verdict.failed} — ${verdict.message}`);
  if (!verdict.pass) { refusals.push(`${photo.name} was refused by the gate: ${verdict.failed}`); continue; }

  const registration = verdict.registration;
  const k = registration.qr.fields.k;
  check(`${photo.name}: the page QR names layout ${EXPECTED_LAYOUT_ID}`,
    registration.qr.fields.layoutId === layout.computedLayoutId,
    registration.qr.fields.layoutId);

  const pageId = `pg_milestone_${index}`;
  const pageJpeg = encodeJpeg(ingested, constants.PAGE_JPEG_QUALITY);
  blobStore.set(pageId, pageJpeg);
  pages.push({
    id: pageId,
    file: `page_${index + 1}.jpg`,
    width: ingested.width,
    height: ingested.height,
    bytes: pageJpeg.length,
    sourceName: `${photo.name}.jpg`,
    registration: {
      status: registration.status === 'degraded' ? 'degraded' : 'ok',
      k, n: registration.qr.fields.n,
      layoutId: registration.qr.fields.layoutId,
      marksFound: registration.marksFound,
      marksDetected: registration.marksDetected,
      marksDeclined: registration.marksDeclined,
      residualMm: registration.residualMm ?? undefined,
      heldOutMm: registration.heldOutMm ?? undefined,
      message: registration.message,
    },
  });

  const rows = layoutSvc.rowsForPage(layout, k);
  const cut = cropSvc.cropRegions(ingested, registration.transform, rows);
  check(`${photo.name}: page ${k} — every declared region was cut`,
    cut.length === rows.length, `${cut.length} of ${rows.length}`);

  for (const c of cut) {
    const bytes = encodeJpeg(c.image, pageCropsConst.CROP_JPEG_QUALITY);
    blobStore.set(pkgSvc.cropBlobKey(c.row.regionId), bytes);
    crops[c.row.regionId] = {
      regionId: c.row.regionId,
      partId: c.row.partId,
      pageK: c.row.pageK,
      isDrawing: c.row.isDrawing,
      maxPoints: c.row.maxPoints,
      cropSource: 'registration',
      // The review path, driven as the UI drives it: `handleReviewCrop` sets
      // exactly this field and nothing else.
      review: 'signed_off',
      qualityFlags: c.flags,
      file: `crops/${c.row.regionId.replace(/[^a-z0-9_\-]/gi, '_')}.jpg`,
      width: c.image.width,
      height: c.image.height,
      bytes: bytes.length,
      fromPage: pageId,
    };
    cropReport.push({
      regionId: c.row.regionId,
      partId: c.row.partId,
      pageK: c.row.pageK,
      width: c.image.width,
      height: c.image.height,
      mmPerPx: 1 / c.pxPerMm,
      pxPerMm: c.pxPerMm,
      inkFraction: inkFractionOf(c.image),
      flags: c.flags,
      bytes: bytes.length,
    });
  }
}

/** The same measure `cropRegions` flags on, recomputed here so it can be reported. */
function inkFractionOf(image) {
  const { data, width, height } = image;
  const n = width * height;
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) {
    sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  const threshold = sum / n - 40;
  let dark = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2] < threshold) dark++;
  }
  return dark / n;
}

check('two pages registered', pages.length === 2, String(pages.length));
check('three regions were cut', Object.keys(crops).length === 3,
  Object.keys(crops).join(', '));
check('the regions are the three the work order names',
  ['p1a', 'p1b', 'p1c'].every(id => id in crops), Object.keys(crops).join(', '));

// =====================================================
// 3. No PDF
// =====================================================
// **A handwritten submission carries no PDF.** Andre, 2026-09-01,
// `workorders/DECISION_PACKAGE_CONTENTS_2026-09-01.md`.
//
// This harness used to build one, because the app's own PDF path is
// `html2canvas` over a live DOM and cannot run in Node — and because the PDF the
// app would have produced was the blank question paper, `PrintView` never having
// received the pages or the crops. Filling it was the obvious fix and it is not
// the decision. Nothing consumes it, Gradescope does not render it on the
// autograder path, it was roughly half the archive by bytes, and it duplicates
// `page_N.jpg`, which is kept as the record of what the student photographed.
//
// So there is nothing to build here; the check is that the archive has none.
console.log('\n  3. no PDF (handwritten)');

// =====================================================
// 4. Build the package
// =====================================================
console.log('\n  4. the submission package');

const assignment = spec;
let built = null;
try {
  built = await pkgSvc.buildSubmissionPackage(
    {
      assignment,
      submissionData: {},
      isHandwritten: assignment.inputMode === 'handwritten',
      layoutId: layout.computedLayoutId,
      pages,
      crops,
    },
    {
      readBlob: async (key) => blobStore.get(key) ?? null,
      downsampleImage: async (uri) => uri,
    },
  );
} catch (err) {
  refusals.push(`buildSubmissionPackage threw: ${err.message}`);
  fatal(`the package could not be built: ${err.message}`);
}

check('a partial submission packages without complaint (2 pages of 16)', built !== null);
const builtPayloadPreview = built.submissionJson;

const zipBytes = await built.zip.generateAsync({
  type: 'nodebuffer', ...pkgSvc.SUBMISSION_ZIP_OPTIONS,
});

// =====================================================
// 5. Write it out, and open it
// =====================================================
console.log('\n  5. write and unzip');

// Clear only what this harness writes. `rmSync(OUT_DIR)` used to take the whole
// folder, which quietly deleted anything a person had put beside the package —
// including the written report, on its first re-run. A test that destroys the
// notes someone made about its own output is a bad neighbour.
for (const owned of ['unzipped', 'crops_for_inspection']) {
  rmSync(join(OUT_DIR, owned), { recursive: true, force: true });
}
mkdirSync(OUT_DIR, { recursive: true });
for (const stale of readdirSync(OUT_DIR).filter(n => n.endsWith('.zip'))) {
  rmSync(join(OUT_DIR, stale), { force: true });
}
const zipPath = join(OUT_DIR, `${built.baseName}.zip`);
writeFileSync(zipPath, zipBytes);
check('the .zip exists on disk', existsSync(zipPath) && statSync(zipPath).size > 0,
  `${statSync(zipPath).size} bytes`);

const reopened = await JSZip.loadAsync(readFileSync(zipPath));
const manifest = [];
const unzipDir = join(OUT_DIR, 'unzipped');
for (const name of Object.keys(reopened.files).sort()) {
  const entry = reopened.files[name];
  if (entry.dir) continue;
  const content = await entry.async('nodebuffer');
  manifest.push({ name, bytes: content.length });
  const dest = join(unzipDir, name);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, content);
}
check('the archive reopens', manifest.length > 0, `${manifest.length} entries`);

// The decision, asserted rather than assumed. Filling the PDF was the obvious
// fix and is not what was decided, so the check is for absence.
check('the archive carries no PDF', !manifest.some(m => m.name.toLowerCase().endsWith('.pdf')),
  manifest.filter(m => m.name.toLowerCase().endsWith('.pdf')).map(m => m.name).join(', '));
check('the payload names no PDF either',
  !('pdf_filename' in builtPayloadPreview),
  String(builtPayloadPreview.pdf_filename));
check('every entry is non-empty', manifest.every(m => m.bytes > 0),
  manifest.filter(m => !m.bytes).map(m => m.name).join(', '));

// The page images must be the student's photographs, not the question paper.
for (const [i, page] of pages.entries()) {
  const inZip = manifest.find(m => m.name === page.file);
  const stored = blobStore.get(page.id);
  check(`${page.file} is the student's own photograph`,
    inZip !== undefined && inZip.bytes === stored.length,
    inZip ? `${inZip.bytes} vs ${stored.length} stored` : 'missing');
  void i;
}

// =====================================================
// 6. The JSON, and what must not be in it
// =====================================================
console.log('\n  6. the payload');

const jsonEntry = manifest.find(m => m.name.endsWith('.json'));
const jsonText = await reopened.file(jsonEntry.name).async('string');
const envelope = jsonText.slice(0, 4);
check('the payload is an encoded envelope', cryptoSvc.isEncoded(jsonText), envelope);
check(`the envelope is ${built.format}`, jsonText.startsWith(`${built.format}:`), envelope);

const payload = await cryptoSvc.decryptJson(jsonText);
check('the payload decrypts', payload !== null && typeof payload === 'object');
check('it names the assignment', typeof payload.assignment_id === 'string' && payload.assignment_id.length > 0,
  String(payload.assignment_id));
check('it carries the layout_id', payload.layout_id === EXPECTED_LAYOUT_ID, String(payload.layout_id));
check('it declares the handwritten mode', payload.input_mode === 'handwritten', String(payload.input_mode));
check('it lists both pages', Array.isArray(payload.pages) && payload.pages.length === 2,
  String(payload.pages && payload.pages.length));
check('it lists all three crops', payload.crops && Object.keys(payload.crops).length === 3,
  Object.keys(payload.crops ?? {}).join(', '));
check('every crop is signed off',
  Object.values(payload.crops ?? {}).every(c => c.student_review === 'signed_off'));

// --- the answer key check. This shipped to students once already. ---
const flat = JSON.stringify(payload);
const FORBIDDEN = [
  ['aiGradingPrompt', /aiGradingPrompt/i],
  ['grading_prompt', /grading_prompt/i],
  ['REFERENCE:', /REFERENCE\s*:/],
  ['graderNote', /graderNote/i],
  ['grader_note', /grader_note/i],
  ['rubric', /rubric/i],
  ['answer key', /answer\s*key/i],
  ['aiGradingConfig', /aiGradingConfig/i],
];
for (const [label, re] of FORBIDDEN) {
  check(`the payload carries no ${label}`, !re.test(flat));
}
// The spec the student loaded is the other half of the same question.
const specFlat = JSON.stringify(spec);
for (const [label, re] of FORBIDDEN) {
  check(`the loaded spec carries no ${label}`, !re.test(specFlat));
}

// =====================================================
// 6b. The same package with a course key — real photographs, sealed
// =====================================================
// `workorders/WORKORDER_STUDENT_ENCRYPT_IMAGES_2026-09-03.md`. The ENG17 spec
// carries no `coursePublicKey`, so what this archive shows is the gb1 case; the
// gb2 case is built here from the same bytes with a keypair generated for this
// run and never written down.
//
// **This is the honest size measurement.** `full-assignment.mjs` runs on pages
// RENDERED from the PDF, and a render deflates to about half its size inside
// the ZIP, so sealing it — ciphertext does not compress — nearly doubles that
// archive. These two are real phone photographs, which is what a student
// actually uploads.
console.log('\n  6b. the same package, sealed with a test course key');

const mzPair = await webcrypto.subtle.generateKey(
  { name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true, ['encrypt', 'decrypt']);
const mzPem = (label, der) =>
  `-----BEGIN ${label}-----\n${Buffer.from(der).toString('base64').replace(/(.{64})/g, '$1\n').trimEnd()}\n-----END ${label}-----\n`;
const MZ_PUBLIC = mzPem('PUBLIC KEY', await webcrypto.subtle.exportKey('spki', mzPair.publicKey));
const MZ_PRIVATE = mzPem('PRIVATE KEY', await webcrypto.subtle.exportKey('pkcs8', mzPair.privateKey));

const mzOpen = async (raw) => {
  const wrappedKeyLen = (raw[0] << 8) | raw[1];
  const iv = raw.subarray(2 + wrappedKeyLen, 2 + wrappedKeyLen + 12);
  const contentKey = privateDecrypt(
    { key: createPrivateKey(MZ_PRIVATE), padding: cryptoConstants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
    Buffer.from(raw.subarray(2, 2 + wrappedKeyLen)));
  const key = await webcrypto.subtle.importKey('raw', contentKey, { name: 'AES-GCM' }, false, ['decrypt']);
  return {
    iv: Buffer.from(iv).toString('hex'),
    bytes: new Uint8Array(await webcrypto.subtle.decrypt(
      { name: 'AES-GCM', iv }, key, raw.subarray(2 + wrappedKeyLen + 12))),
  };
};

const sealedBuild = await pkgSvc.buildSubmissionPackage(
  {
    assignment: { ...assignment, coursePublicKey: MZ_PUBLIC },
    submissionData: {},
    isHandwritten: assignment.inputMode === 'handwritten',
    layoutId: layout.computedLayoutId,
    pages,
    crops,
  },
  { readBlob: async (key) => blobStore.get(key) ?? null, downsampleImage: async (uri) => uri },
);
const sealedZip = await sealedBuild.zip.generateAsync({
  type: 'nodebuffer', ...pkgSvc.SUBMISSION_ZIP_OPTIONS });
const sealedOpened = await JSZip.loadAsync(sealedZip);
const sealedManifest = [];
const sealedIvs = new Set();
let sealedMismatch = [];
for (const name of Object.keys(sealedOpened.files).sort()) {
  if (sealedOpened.files[name].dir) continue;
  const bytes = await sealedOpened.files[name].async('nodebuffer');
  sealedManifest.push({ name, bytes: bytes.length });
  if (!name.endsWith('.gb2')) continue;
  const opened = await mzOpen(new Uint8Array(bytes));
  sealedIvs.add(opened.iv);
  const plain = manifest.find(m => m.name === name.replace(/\.gb2$/, ''));
  const plainBytes = await reopened.file(name.replace(/\.gb2$/, '')).async('nodebuffer');
  if (!plain || Buffer.compare(Buffer.from(opened.bytes), plainBytes) !== 0) {
    sealedMismatch.push(name);
  }
}
const sealedImages = sealedManifest.filter(m => m.name.endsWith('.gb2'));
check('every page and crop is sealed', sealedImages.length === 5, `${sealedImages.length} of 5`);
check('no plain .jpg survives', !sealedManifest.some(m => m.name.endsWith('.jpg')),
  sealedManifest.filter(m => m.name.endsWith('.jpg')).map(m => m.name).join(', '));
check('each decrypts to the byte-identical JPEG of the plain build',
  sealedMismatch.length === 0, sealedMismatch.join(', '));
check('no IV repeats', sealedIvs.size === sealedImages.length, `${sealedIvs.size} distinct`);

const sealedJson = sealedManifest.find(m => m.name.endsWith('.json'));
const sealedJsonText = await sealedOpened.file(sealedJson.name).async('string');
check('the payload is a gb2 envelope', sealedJsonText.startsWith('gb2:'), sealedJsonText.slice(0, 4));
const sealedPayload = JSON.parse(Buffer.from((await mzOpen(
  new Uint8Array(Buffer.from(sealedJsonText.slice(4), 'base64')))).bytes).toString('utf8'));
check('it declares gb2 image encryption', sealedPayload.image_encryption === 'gb2',
  String(sealedPayload.image_encryption));
check('the declared list matches the archive',
  JSON.stringify([...sealedPayload.encrypted_entries].sort()) ===
  JSON.stringify(sealedImages.map(m => m.name).sort()),
  `${sealedPayload.encrypted_entries.length} declared, ${sealedImages.length} present`);
check('every page and crop names an entry that is in the archive',
  sealedPayload.pages.every(p => sealedManifest.some(m => m.name === p.file)) &&
  Object.values(sealedPayload.crops).every(c => sealedManifest.some(m => m.name === c.file)));

// =====================================================
// 7. Report
// =====================================================
console.log('\n=== ZIP MANIFEST ===');
for (const m of manifest) console.log(`  ${String(m.bytes).padStart(9)}  ${m.name}`);
console.log(`  ${String(zipBytes.length).padStart(9)}  (the archive itself)`);

console.log('\n=== THE SAME PACKAGE, SEALED (test key, gb2) ===');
for (const m of sealedManifest) console.log(`  ${String(m.bytes).padStart(9)}  ${m.name}`);
console.log(`  ${String(sealedZip.length).padStart(9)}  (the archive itself)`);
console.log(`\n  archive ${zipBytes.length.toLocaleString()} -> ${sealedZip.length.toLocaleString()} bytes ` +
  `(${sealedZip.length - zipBytes.length >= 0 ? '+' : ''}${(sealedZip.length - zipBytes.length).toLocaleString()}, ` +
  `${((sealedZip.length - zipBytes.length) / zipBytes.length * 100).toFixed(2)}%)`);
console.log(`  per file 286 bytes: 258 wrapped key + 12 IV + 16 tag`);
console.log(`  encryption step ${sealedBuild.imageEncryptionMs} ms for ` +
  `${(sealedBuild.imagePlainBytes / 1048576).toFixed(2)} MB of image bytes`);
console.log(`  peak RSS ${(process.memoryUsage().rss / 1048576).toFixed(1)} MB at the end of the run`);

console.log('\n=== PAYLOAD ===');
console.log(`  envelope: ${built.format}`);
const shape = (v, depth = 0) => {
  if (Array.isArray(v)) return `array[${v.length}]`;
  if (v && typeof v === 'object') {
    if (depth >= 1) return `{${Object.keys(v).join(', ')}}`;
    return `{\n${Object.entries(v).map(([k, x]) => `      ${k}: ${shape(x, depth + 1)}`).join('\n')}\n    }`;
  }
  return JSON.stringify(v);
};
for (const [k, v] of Object.entries(payload)) {
  console.log(`  ${k}: ${shape(v)}`);
}
console.log('\n  pages:');
for (const p of payload.pages) {
  console.log(`    ${p.file}  k=${p.k}/${p.n}  ${p.width}x${p.height}  ` +
    `${p.registration}  marks=${p.marks_found} (${(p.marks_detected ?? []).join('+') || 'none'})  ` +
    `declined=${(p.marks_declined ?? []).join('+') || 'none'}  ` +
    `residual=${p.residual_mm?.toFixed(3)} mm  held-out=${(p.held_out_mm ?? 0).toFixed(3)} mm`);
}
console.log('\n  crops:');
for (const c of Object.values(payload.crops)) {
  console.log(`    ${c.region_id}  part ${c.part_id}  page ${c.page_k}  ${c.width}x${c.height}  ` +
    `${c.max_points} pts  drawing=${c.is_drawing}  ${c.crop_source}  ${c.student_review}  ` +
    `flags=[${c.quality_flags.join(', ')}]`);
}

console.log('\n=== CROPS, MEASURED (not judged) ===');
console.log('  region  part   page  pixels        mm/px    px/mm   ink      bytes   flags');
for (const c of cropReport) {
  console.log(`  ${c.regionId.padEnd(7)} ${c.partId.padEnd(6)} ${String(c.pageK).padEnd(5)} ` +
    `${`${c.width}x${c.height}`.padEnd(13)} ${c.mmPerPx.toFixed(4)}  ${c.pxPerMm.toFixed(2).padStart(6)}  ` +
    `${(c.inkFraction * 100).toFixed(2).padStart(5)}%  ${String(c.bytes).padStart(6)}  ` +
    `${c.flags.join(', ') || '—'}`);
}

console.log('\n=== PDF ===');
console.log('  none, by decision — a handwritten submission carries no PDF.');
console.log('  workorders/DECISION_PACKAGE_CONTENTS_2026-09-01.md');

if (refusals.length) {
  console.log('\n=== THE PIPELINE REFUSED ===');
  for (const r of refusals) console.log(`  ${r}`);
}

writeFileSync(join(OUT_DIR, 'README.txt'),
  [
    'Milestone zero — produced by GradeBridge-Student-Submission/tests/milestone-zero.mjs',
    '',
    `assignment : ENG17 HW1, layout_id ${EXPECTED_LAYOUT_ID}, 16 pages, 17 regions, 200 points`,
    `photographs: cap01 (page 2), cap11 (page 3) — 2 of 16 pages, a deliberate partial submission`,
    `student    : none — the package carries no name (${HARNESS_LABEL} harness)`,
    `envelope   : ${built.format}`,
    '',
    'Re-run this harness for the manifest, the decrypted payload,',
    'crop measurements, what moved out of App.tsx, and three findings.',
    '',
    'LOOK AT THE CROPS. Whether crops/p1a.jpg, p1b.jpg and p1c.jpg actually contain',
    'the handwriting for parts 1(a), 1(b) and 1(c) is the one thing no test can',
    'establish. Everything else in here has been checked.',
    '',
    'PDF: none. A handwritten submission carries no PDF, by the decision of',
    '2026-09-01: nothing consumes it, and a blank one invites a reader to',
    'conclude the student submitted nothing. page_N.jpg is the record instead.',
    '',
    'Manifest:',
    ...manifest.map(m => `  ${String(m.bytes).padStart(9)}  ${m.name}`),
  ].join('\n'));

// Copy the crops to the top of the output folder so they are one click away.
const cropsOut = join(OUT_DIR, 'crops_for_inspection');
mkdirSync(cropsOut, { recursive: true });
for (const c of Object.values(crops)) {
  cpSync(join(unzipDir, c.file), join(cropsOut, `${c.regionId}_part_${c.partId.replace(/[^a-z0-9]/gi, '')}.jpg`));
}

console.log(`\n  package written to: ${OUT_DIR}`);
console.log(`  crops for inspection: ${cropsOut}`);
console.log(`\n  ${failures === 0 ? 'all checks passed' : `${failures} check(s) failed`}\n`);
process.exit(failures > 0 ? 1 : 0);
