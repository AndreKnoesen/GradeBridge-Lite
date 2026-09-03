// =====================================================
// The answers are encrypted, not just the envelope
// =====================================================
// `workorders/WORKORDER_STUDENT_ENCRYPT_IMAGES_2026-09-03.md`.
//
// Until that order the package encrypted exactly one entry, the payload — and
// on the handwritten path the payload contains no answers at all: every
// `submission_data` entry is `null`, because the graded artefact is the crop
// images, and those shipped beside it as plain JPEGs. A hardened gb2 course
// encrypted the envelope and shipped the letter in the clear.
//
//   node tests/package-encryption-tests.mjs
//
// **The keypair is generated here, per run, and never written to disk.** The
// real course keypair is the autograder author's and lives in his image; this
// suite must not be able to be mistaken for holding one. Nothing here reads
// `Encryption/gb2_test_fixture.json` either — an ephemeral pair makes the suite
// runnable by anyone who clones the repo.
//
// What it does NOT cover: geometry, registration, the capture gate, `layout_id`.
// This order touches none of them, and `registration-tests.mjs` and
// `gate-tests.mjs` hold them.
// =====================================================

import { webcrypto } from 'node:crypto';
globalThis.crypto ??= webcrypto;

import { createPrivateKey, privateDecrypt, constants as cryptoConstants } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { loadModule } from './captureSet.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

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

const pkg = await loadModule('services/submissionPackage.ts', 'pe_pkg.mjs');
const svc = await loadModule('cryptoService.ts', 'pe_crypto.mjs');

console.log('\nthe submission package — every image sealed, or none\n');

// =====================================================
// A test keypair, and the consumer's half of the contract
// =====================================================
const pair = await webcrypto.subtle.generateKey(
  { name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true, ['encrypt', 'decrypt']);
const pem = (label, der) =>
  `-----BEGIN ${label}-----\n${Buffer.from(der).toString('base64').replace(/(.{64})/g, '$1\n').trimEnd()}\n-----END ${label}-----\n`;
const PUBLIC_KEY = pem('PUBLIC KEY', await webcrypto.subtle.exportKey('spki', pair.publicKey));
const PRIVATE_KEY = pem('PRIVATE KEY', await webcrypto.subtle.exportKey('pkcs8', pair.privateKey));

/**
 * Parse the envelope out of raw bytes. This is the autograder's side of ITEM 5
 * written in JavaScript: an image entry is the envelope with nothing around it,
 * where the JSON entry is the same envelope base64'd behind a `gb2:` tag.
 */
const parseEnvelope = (raw) => {
  const wrappedKeyLen = (raw[0] << 8) | raw[1];
  return {
    wrappedKeyLen,
    wrappedKey: raw.subarray(2, 2 + wrappedKeyLen),
    iv: raw.subarray(2 + wrappedKeyLen, 2 + wrappedKeyLen + 12),
    ciphertextPlusTag: raw.subarray(2 + wrappedKeyLen + 12),
  };
};
const unwrapContentKey = (wrappedKey) => privateDecrypt(
  { key: createPrivateKey(PRIVATE_KEY), padding: cryptoConstants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
  Buffer.from(wrappedKey));
const openEnvelope = async (raw) => {
  const { wrappedKey, iv, ciphertextPlusTag } = parseEnvelope(raw);
  const key = await webcrypto.subtle.importKey(
    'raw', unwrapContentKey(wrappedKey), { name: 'AES-GCM' }, false, ['decrypt']);
  return new Uint8Array(await webcrypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertextPlusTag));
};

// =====================================================
// The fixture: a handwritten submission with pages and crops, and an
// electronic one with image answers. Distinct bytes everywhere, so an entry
// written from the wrong blob is visible rather than merely equal in length.
// =====================================================
const jpegish = (seed, length) => {
  const out = new Uint8Array(length);
  out.set([0xff, 0xd8, 0xff, 0xe0], 0);
  for (let i = 4; i < length; i++) out[i] = (seed * 37 + i * 11) & 0xff;
  return out;
};

const PAGE_BYTES = { pg0: jpegish(1, 5000), pg1: jpegish(2, 4096) };
const CROP_BYTES = { p1a: jpegish(3, 900), p1b: jpegish(4, 1200) };

const handwrittenSources = (coursePublicKey) => ({
  assignment: {
    id: 'a1', courseCode: 'ENG17', title: 'Homework 1', inputMode: 'handwritten',
    ...(coursePublicKey ? { coursePublicKey } : {}),
    problems: [{
      id: 'p0', title: 'P', description: '', subsections: [
        { id: 's0', title: 'a', description: '', points: 10, submissionType: 'Text' },
      ],
    }],
  },
  submissionData: {},
  isHandwritten: true,
  layoutId: '95438EDF',
  now: '2026-09-03T12:34:56.000Z',
  pages: [
    { id: 'pg0', file: 'page_1.jpg', width: 1650, height: 2200,
      registration: { status: 'ok', k: 2, n: 16, marksFound: 4, marksDetected: ['NW', 'NE', 'SW', 'SE'], marksDeclined: [], residualMm: 0.5, heldOutMm: 0 } },
    { id: 'pg1', file: 'page_2.jpg', width: 1650, height: 2200,
      registration: { status: 'ok', k: 3, n: 16, marksFound: 4, marksDetected: ['NW', 'NE', 'SW', 'SE'], marksDeclined: [], residualMm: 0.4, heldOutMm: 0 } },
  ],
  crops: {
    p1a: { regionId: 'p1a', partId: '1(a)', pageK: 2, isDrawing: false, maxPoints: 5,
      cropSource: 'registration', review: 'signed_off', qualityFlags: [],
      file: 'crops/p1a.jpg', width: 842, height: 542, bytes: 900 },
    p1b: { regionId: 'p1b', partId: '1(b)', pageK: 3, isDrawing: false, maxPoints: 5,
      cropSource: 'registration', review: 'signed_off', qualityFlags: [],
      file: 'crops/p1b.jpg', width: 1033, height: 324, bytes: 1200 },
  },
});

const ELECTRONIC_IMAGE = jpegish(9, 2048);
const ELECTRONIC_DATA_URI = `data:image/jpeg;base64,${Buffer.from(ELECTRONIC_IMAGE).toString('base64')}`;

const electronicSources = (coursePublicKey) => ({
  assignment: {
    id: 'a2', courseCode: 'EEC1', title: 'Lab 1',
    ...(coursePublicKey ? { coursePublicKey } : {}),
    problems: [{
      id: 'p0', title: 'P', description: '', subsections: [
        { id: 's0', title: 'a', description: '', points: 50, submissionType: 'Text' },
        { id: 's1', title: 'b', description: '', points: 50, submissionType: 'Image' },
      ],
    }],
  },
  submissionData: { p0_s0: { textAnswer: 'the answer' }, p0_s1: { imageAnswers: [ELECTRONIC_DATA_URI] } },
  isHandwritten: false,
  layoutId: null,
  now: '2026-09-03T12:34:56.000Z',
  pages: [],
  crops: {},
});

const assets = {
  pdfBytes: Uint8Array.from([0x25, 0x50, 0x44, 0x46]),
  readBlob: async (key) => PAGE_BYTES[key] ?? CROP_BYTES[key.replace(/^crop_/, '')] ?? null,
  downsampleImage: async (uri) => uri,
};

const manifestOf = async (built) => {
  const zip = await JSZip.loadAsync(await built.zip.generateAsync({
    type: 'nodebuffer', ...pkg.SUBMISSION_ZIP_OPTIONS }));
  const out = new Map();
  for (const name of Object.keys(zip.files)) {
    if (zip.files[name].dir) continue;
    out.set(name, await zip.files[name].async('uint8array'));
  }
  return out;
};

const plainBuild = await pkg.buildSubmissionPackage(handwrittenSources(null), assets);
const sealedBuild = await pkg.buildSubmissionPackage(handwrittenSources(PUBLIC_KEY), assets);
const plainManifest = await manifestOf(plainBuild);
const sealedManifest = await manifestOf(sealedBuild);

const plainElectronic = await pkg.buildSubmissionPackage(electronicSources(null), assets);
const sealedElectronic = await pkg.buildSubmissionPackage(electronicSources(PUBLIC_KEY), assets);
const plainElectronicManifest = await manifestOf(plainElectronic);
const sealedElectronicManifest = await manifestOf(sealedElectronic);

// =====================================================
// 1. A course with no key does not move
// =====================================================
// The acceptance is byte-identity, and it is the reason the unencrypted path
// still hands JSZip exactly what it handed it before rather than being routed
// through the new code with the encryption switched off.
console.log('  1. a gb1 course is unchanged');

check('no entry name gains a suffix', () => {
  for (const name of plainManifest.keys()) {
    assert(!name.endsWith('.gb2'), `${name} is named as encrypted on a course with no key`);
  }
});

check('the page and crop entries are the stored bytes, untouched', () => {
  for (const [name, expected] of [
    ['page_1.jpg', PAGE_BYTES.pg0], ['page_2.jpg', PAGE_BYTES.pg1],
    ['crops/p1a.jpg', CROP_BYTES.p1a], ['crops/p1b.jpg', CROP_BYTES.p1b],
  ]) {
    assert(plainManifest.has(name), `${name} is missing`);
    assertEqual([...plainManifest.get(name)], [...expected], `${name} is not the stored bytes`);
  }
});

check('the electronic image answer is the stored bytes, untouched', () => {
  assert(plainElectronicManifest.has('p0s1_image_0.jpg'), 'p0s1_image_0.jpg is missing');
  assertEqual([...plainElectronicManifest.get('p0s1_image_0.jpg')], [...ELECTRONIC_IMAGE],
    'the electronic image answer changed on a course with no key');
});

await checkAsync('the payload gains no key at all', async () => {
  const payload = await svc.decryptJson(
    Buffer.from(plainManifest.get(`${plainBuild.baseName}.json`)).toString('utf8'));
  for (const key of ['image_encryption', 'encrypted_entries']) {
    assert(!(key in payload), `${key} is in a gb1 payload — it must be absent, not empty`);
  }
  assertEqual(payload.pages.map(p => p.file), ['page_1.jpg', 'page_2.jpg'],
    'a gb1 payload names encrypted entries');
  assertEqual(Object.values(payload.crops).map(c => c.file), ['crops/p1a.jpg', 'crops/p1b.jpg'],
    'a gb1 payload names encrypted crop entries');
  assert(plainBuild.imageEncryption === null, 'the build reports encryption on a course with no key');
});

// =====================================================
// 2. With a key, every image is sealed
// =====================================================
console.log('  2. with a course key, every image is sealed');

const IMAGE_ENTRIES = [
  ['page_1.jpg.gb2', PAGE_BYTES.pg0], ['page_2.jpg.gb2', PAGE_BYTES.pg1],
  ['crops/p1a.jpg.gb2', CROP_BYTES.p1a], ['crops/p1b.jpg.gb2', CROP_BYTES.p1b],
];

check('every image entry is named as encrypted, and no .jpg image survives', () => {
  const names = [...sealedManifest.keys()].filter(n => !n.endsWith('.json'));
  assertEqual(names.sort(), IMAGE_ENTRIES.map(([n]) => n).sort(),
    'the sealed archive does not hold exactly the sealed images');
});

await checkAsync('each one decrypts to the plain build\'s bytes, exactly', async () => {
  for (const [name, expected] of IMAGE_ENTRIES) {
    const opened = await openEnvelope(sealedManifest.get(name));
    assertEqual([...opened], [...expected], `${name} did not decrypt to the original image`);
  }
  // ...and against the plain BUILD, not only the fixture, so a builder that
  // sealed something other than what it ships unencrypted is caught.
  for (const [name, plainName] of [
    ['page_1.jpg.gb2', 'page_1.jpg'], ['crops/p1b.jpg.gb2', 'crops/p1b.jpg'],
  ]) {
    assertEqual([...(await openEnvelope(sealedManifest.get(name)))],
      [...plainManifest.get(plainName)], `${name} differs from the plain build's ${plainName}`);
  }
});

check('the electronic image answer is sealed too', () => {
  assert(sealedElectronicManifest.has('p0s1_image_0.jpg.gb2'),
    `the electronic image answer is not sealed: ${[...sealedElectronicManifest.keys()].join(', ')}`);
  assert(!sealedElectronicManifest.has('p0s1_image_0.jpg'), 'a plain image answer survives');
});

await checkAsync('...and it decrypts to the same bytes the plain build wrote', async () => {
  const opened = await openEnvelope(sealedElectronicManifest.get('p0s1_image_0.jpg.gb2'));
  assertEqual([...opened], [...plainElectronicManifest.get('p0s1_image_0.jpg')],
    'the electronic image answer did not survive the envelope');
});

check('the PDF is NOT sealed, and that is scope rather than a finding', () => {
  // The work order names the page photographs, the crops and the image answers.
  // On an electronic gb2 course the PDF still carries the written answers in
  // the clear. Asserted so the state of affairs is recorded rather than
  // discovered later by someone reading the archive.
  assert(sealedElectronicManifest.has(`${sealedElectronic.baseName}.pdf`),
    'the electronic PDF is gone — this test records that it is NOT sealed, not that it vanished');
});

// =====================================================
// 3. The envelope is the standard one, per file
// =====================================================
console.log('  3. the envelope, per file');

check('each entry is 2 + wrappedKeyLen + 12 + ciphertext + 16 bytes and nothing more', () => {
  for (const [name, plainBytes] of IMAGE_ENTRIES) {
    const raw = sealedManifest.get(name);
    const env = parseEnvelope(raw);
    assert(env.wrappedKeyLen === 256, `${name}: wrappedKeyLen is ${env.wrappedKeyLen}, expected 256 for RSA-2048`);
    assert(env.iv.length === 12, `${name}: iv is ${env.iv.length} bytes`);
    assertEqual(env.ciphertextPlusTag.length, plainBytes.length + 16,
      `${name}: ciphertext+tag is not the plaintext plus a 128-bit tag`);
    assertEqual(raw.length, 2 + 256 + 12 + plainBytes.length + 16,
      `${name}: the envelope carries bytes the format does not describe`);
  }
});

check('the overhead is 286 bytes a file, measured', () => {
  for (const [name, plainBytes] of IMAGE_ENTRIES) {
    assertEqual(sealedManifest.get(name).length - plainBytes.length, 286,
      `${name}: unexpected per-file overhead`);
  }
});

check('the bytes are raw — the image entry is not base64', () => {
  // base64 of a JPEG is printable ASCII throughout and would be ~4/3 the size.
  // The tell that costs nothing to check: a raw envelope's first two bytes are
  // the big-endian length 0x01 0x00, which is not printable.
  for (const [name] of IMAGE_ENTRIES) {
    const raw = sealedManifest.get(name);
    assert(raw[0] === 0x01 && raw[1] === 0x00, `${name} does not begin with a uint16 BE length`);
    const printable = [...raw.subarray(0, 512)].every(b => b >= 0x20 && b < 0x7f);
    assert(!printable, `${name} looks like text — has it been base64'd?`);
  }
});

check('no image entry carries a gb2: text tag', () => {
  // The tag belongs to the STRING form. An image entry is the envelope itself,
  // starting at wrappedKeyLen, so a consumer parses it without stripping
  // anything. Documented in AUTOGRADER_ZIP_SPEC.md; asserted here.
  for (const [name] of IMAGE_ENTRIES) {
    const head = Buffer.from(sealedManifest.get(name).subarray(0, 4)).toString('latin1');
    assert(head !== 'gb2:', `${name} begins with a gb2: tag`);
  }
});

check('no IV repeats within a submission', () => {
  const ivs = new Set();
  for (const name of sealedManifest.keys()) {
    if (name.endsWith('.json')) continue;
    const hex = Buffer.from(parseEnvelope(sealedManifest.get(name)).iv).toString('hex');
    assert(!ivs.has(hex), `IV ${hex} is used twice — reusing a GCM IV under one key leaks plaintext`);
    ivs.add(hex);
  }
  assert(ivs.size === IMAGE_ENTRIES.length, `${ivs.size} IVs for ${IMAGE_ENTRIES.length} entries`);
});

check('each file has its OWN content key — the withdrawn shared-key draft is not back', () => {
  // An earlier draft of the work order wrapped one content key for the whole
  // submission. It was withdrawn because it is a format the autograder does not
  // implement. Two files sharing a wrapped key is exactly what that looks like.
  const wrapped = new Set();
  for (const [name] of IMAGE_ENTRIES) {
    const hex = Buffer.from(parseEnvelope(sealedManifest.get(name)).wrappedKey).toString('hex');
    assert(!wrapped.has(hex), `${name} reuses another entry's wrapped key`);
    wrapped.add(hex);
  }
  // RSA-OAEP is randomised, so distinct wraps could still hide one key. Unwrap
  // and compare the keys themselves.
  const keys = new Set(IMAGE_ENTRIES.map(([name]) =>
    unwrapContentKey(parseEnvelope(sealedManifest.get(name)).wrappedKey).toString('hex')));
  assertEqual(keys.size, IMAGE_ENTRIES.length, 'two entries share a content key');
});

// =====================================================
// 4. The payload says which entries are sealed
// =====================================================
console.log('  4. the payload declares what it sealed');

const sealedPayloadText = Buffer.from(
  sealedManifest.get(`${sealedBuild.baseName}.json`)).toString('utf8');

await checkAsync('the payload itself is a gb2 envelope', async () => {
  assert(sealedPayloadText.startsWith('gb2:'), `the payload is ${sealedPayloadText.slice(0, 4)}`);
  const raw = new Uint8Array(Buffer.from(sealedPayloadText.slice(4), 'base64'));
  const opened = await openEnvelope(raw);
  JSON.parse(Buffer.from(opened).toString('utf8'));
});

const openPayload = async (text) => JSON.parse(Buffer.from(
  await openEnvelope(new Uint8Array(Buffer.from(text.slice(4), 'base64')))).toString('utf8'));

// **Opened defensively, on purpose.** A build that mangles the envelope makes
// this throw, and a suite that dies here reports a stack trace instead of the
// checks below — which are the ones that say WHAT is wrong. Mutation-tested:
// base64-ing the envelope used to crash the run rather than fail a named check.
let sealedPayload = {};
try {
  sealedPayload = await openPayload(sealedPayloadText);
} catch (err) {
  results.push(`  FAIL  the sealed payload could not be opened\n          ${err.message}`);
  failed++;
}

check('it declares the format', () =>
  assertEqual(sealedPayload.image_encryption, 'gb2', 'image_encryption is not declared as gb2'));

check('the declared list is exactly what is in the archive', () => {
  assert(Array.isArray(sealedPayload.encrypted_entries),
    'the payload declares no encrypted_entries list');
  const inArchive = [...sealedManifest.keys()].filter(n => n.endsWith('.gb2')).sort();
  assertEqual([...sealedPayload.encrypted_entries].sort(), inArchive,
    'the payload\'s encrypted_entries and the archive disagree');
});

check('every page and crop names the entry that is actually there', () => {
  assert(Array.isArray(sealedPayload.pages), 'the sealed payload could not be read');
  for (const page of sealedPayload.pages) {
    assert(sealedManifest.has(page.file), `pages[] names ${page.file}, which is not in the archive`);
  }
  for (const crop of Object.values(sealedPayload.crops)) {
    assert(sealedManifest.has(crop.file), `crops names ${crop.file}, which is not in the archive`);
  }
});

await checkAsync('a page the store could not produce is not listed as sealed', async () => {
  // A partial submission is a real state and packages without complaint. The
  // list has to come from what was written, not from what was intended, or a
  // consumer is told to open a file that is not there.
  const sources = handwrittenSources(PUBLIC_KEY);
  const partial = await pkg.buildSubmissionPackage(sources, {
    ...assets,
    readBlob: async (key) => (key === 'pg1' ? null : await assets.readBlob(key)),
  });
  const manifest = await manifestOf(partial);
  const payload = await openPayload(Buffer.from(
    manifest.get(`${partial.baseName}.json`)).toString('utf8'));
  assert(!payload.encrypted_entries.includes('page_2.jpg.gb2'),
    'a page that was never written is listed as an encrypted entry');
  assertEqual([...payload.encrypted_entries].sort(),
    [...manifest.keys()].filter(n => n.endsWith('.gb2')).sort(),
    'the list and the archive disagree on a partial submission');
});

// =====================================================
// 5. The app cannot decrypt anything
// =====================================================
console.log('  5. the app holds no private key');

check('cryptoService exports no gb2 decrypt and mentions no private key', () => {
  assert(typeof svc.decryptBytesGb2 !== 'function', 'the app can decrypt gb2 bytes');
  assert(typeof svc.decryptJsonGb2 !== 'function', 'the app can decrypt gb2 JSON');
  const src = readFileSync(join(REPO, 'cryptoService.ts'), 'utf8');
  assert(!/BEGIN [A-Z ]*PRIVATE KEY/.test(src), 'a private key is in the source');
  // gb1 is symmetric and its key IS imported with a decrypt usage — that is how
  // the app reads an assignment spec, and it is not what this guards. What must
  // never appear is asymmetric private-key material: a PKCS#8 import, an RSA
  // key pair, or anything on the gb2 path that decrypts.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '');
  assert(!/'pkcs8'|privateKey|generateKey\(\s*\{\s*name:\s*'RSA/.test(code),
    'cryptoService holds or generates asymmetric private key material');
  // The gb2 section only: from the byte envelope to where gb1's own
  // `encryptJson` begins. gb1's `decryptJson` below it is the spec reader and
  // is meant to be there.
  const gb2 = code.slice(code.indexOf('encryptBytesGb2'), code.indexOf('export const encryptJson = async'));
  assert(gb2.length > 0, 'the gb2 section could not be located in cryptoService.ts');
  assert(!/subtle\.decrypt|unwrapKey/.test(gb2), 'the gb2 path decrypts something');
});

check('nothing in the app decrypts a gb2 envelope', () => {
  for (const file of ['App.tsx', 'services/submissionPackage.ts', 'services/assignmentBundle.ts']) {
    const src = readFileSync(join(REPO, file), 'utf8');
    assert(!/decryptGb2|gb2Decrypt|coursePrivateKey/.test(src), `${file} reaches for a gb2 decrypt`);
  }
});

// =====================================================
// 6. A bad key stops the submission, and never downgrades it
// =====================================================
console.log('  6. a bad key refuses');

await checkAsync('a spec with an unusable course key produces no package at all', async () => {
  const realError = console.error;
  console.error = () => {};
  let threw = null;
  try {
    await pkg.buildSubmissionPackage(handwrittenSources('-----BEGIN PUBLIC KEY-----\nbm90YWtleQ==\n-----END PUBLIC KEY-----\n'), assets);
  } catch (err) { threw = err; } finally { console.error = realError; }
  assert(threw !== null, 'the package was built with an unusable course key');
  assert(threw.name === svc.GB2_KEY_ERROR, `error name is ${threw.name}`);
  assert(/NOT created/.test(threw.message), 'the message does not tell the student no file was produced');
});

// ---------- report ----------
console.log(results.join('\n'));
const sealedTotal = [...sealedManifest.values()].reduce((s, b) => s + b.length, 0);
const plainTotal = [...plainManifest.values()].reduce((s, b) => s + b.length, 0);
console.log(`\n  entry bytes: ${plainTotal.toLocaleString()} plain -> ${sealedTotal.toLocaleString()} sealed ` +
  `(+${sealedTotal - plainTotal} over ${IMAGE_ENTRIES.length} images and the payload)`);
console.log(`  sealing took ${sealedBuild.imageEncryptionMs} ms for ` +
  `${sealedBuild.imagePlainBytes.toLocaleString()} image bytes`);
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
