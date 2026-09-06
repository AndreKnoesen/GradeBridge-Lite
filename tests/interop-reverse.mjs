// =====================================================
// gb2 interop, REVERSE: the autograder's output, read by this app
// =====================================================
// The other half of `interop-emit.mjs` + `interop-check.py`. Those two prove the
// autograder can open what this app writes. This one proves the opposite
// direction: that a gb2 envelope produced by the AUTOGRADER's Python
// implementation is read correctly here.
//
//   node tests/interop-reverse.mjs [fixture.json]
//   GB2_FIXTURE=/path/to/gb2_test_fixture.json node tests/interop-reverse.mjs
//
// **This is not part of `npm test` and cannot be.** It needs a private key, the
// key cannot be committed, and CI has no other way to obtain it. See
// tests/README.md.
//
// ## Why this does not call crypto_utils.py
//
// Opening his ciphertext with his own decryptor would prove that his code
// agrees with itself. The envelope is parsed here from the format
// `cryptoService.ts` documents — `wrappedKeyLen[uint16 BE] | wrappedKey |
// iv[12] | ciphertext+tag` — so a disagreement in layout, padding or field
// order shows up as a failure rather than being absorbed by shared code.
//
// `cryptoService.ts` itself exports no gb2 decrypt and never will: the app
// encrypts to the course public key and has no business holding a private one.
// The unwrap below is Node's, driven by this harness, exactly as
// `milestone-zero.mjs` and `run-tests.mjs` do it.
//
// ## Which layer caught it
//
// Every failure path names the layer that caught it — RSA-OAEP unwrap, AES-GCM
// tag verification, JSON parse, or the final equality assertion. That
// distinction is the point of the check. **If a corrupted envelope is caught
// only by the equality assertion, the authentication is not doing its job** and
// that is a finding, not a pass with extra steps.
// =====================================================

import { webcrypto, createPrivateKey, privateDecrypt, constants } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');

const fixturePath = process.argv[2]
  ? resolve(process.argv[2])
  : (process.env.GB2_FIXTURE
    ? resolve(process.env.GB2_FIXTURE)
    : resolve(REPO, '..', 'Encryption', 'gb2_test_fixture.json'));

// Skipped loudly rather than faked. An ephemeral keypair would prove this app
// is self-consistent, which the suite already covers, and would say nothing
// about the other implementation — so there is nothing to substitute here.
if (!existsSync(fixturePath)) {
  console.log(`\nSKIP: gb2 interop reverse direction did not run.` +
    `\n  No fixture at ${fixturePath}. Set GB2_FIXTURE to its location.` +
    `\n  UNPROVEN while skipped: that a gb2 envelope written by the autograder's` +
    `\n  Python implementation is read correctly by this app.\n`);
  process.exit(0);
}

const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));

// `GB2_OVERRIDE` exists so a deliberately corrupted envelope can be pushed
// through this same path without touching the fixture on disk. It is how the
// "prove it can go red" exercise is run.
const gb2 = process.env.GB2_OVERRIDE ?? fixture.sample_gb2_string;

let fails = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) fails++;
};
const died = (layer) => {
  console.log(`\n  CAUGHT BY: ${layer}\n`);
  process.exit(1);
};

console.log('\ngb2 interop, REVERSE: autograder Python output -> this app\'s reading\n');
console.log(`  fixture: ${fixturePath}`);
if (process.env.GB2_OVERRIDE) console.log('  ** GB2_OVERRIDE set — reading a supplied envelope, not the fixture\'s **');
console.log();

check('the string carries the gb2: prefix', typeof gb2 === 'string' && gb2.startsWith('gb2:'),
  String(gb2).slice(0, 8));
if (fails) died('the gb2: prefix');

const raw = Buffer.from(gb2.slice(4), 'base64');
const wrappedKeyLen = (raw[0] << 8) | raw[1];
const ctLen = raw.length - 2 - wrappedKeyLen - 12;
console.log(`        envelope: wrappedKeyLen=${wrappedKeyLen} (RSA-${wrappedKeyLen * 8}), ` +
  `iv=12, ciphertext+tag=${ctLen}, total=${raw.length}`);

// The key size is reported, not required. His test key and the live ENG17 Fall
// course key are both RSA-4096; the format carries the length precisely so that
// no reader has to assume one.
check('the declared wrappedKeyLen fits inside the envelope', ctLen >= 17,
  `ciphertext+tag would be ${ctLen} bytes`);
if (fails) died('envelope geometry');

// ---- layer 1: RSA-OAEP unwrap. A wrong or corrupted wrapped key dies here. ----
let contentKey;
try {
  contentKey = privateDecrypt(
    {
      key: createPrivateKey(fixture.private_key_pkcs8_pem),
      padding: constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256',
    },
    raw.subarray(2, 2 + wrappedKeyLen));
  check('the content key unwraps with RSA-OAEP/SHA-256', true);
} catch (err) {
  check('the content key unwraps with RSA-OAEP/SHA-256', false,
    `${err.constructor.name}: ${err.message}`);
  died('RSA-OAEP unwrap');
}
check('the unwrapped content key is 32 bytes (AES-256)', contentKey.length === 32,
  `${contentKey.length} bytes`);

// ---- layer 2: AES-GCM. The tag is verified here; a corrupted ciphertext dies here. ----
let plainBytes;
try {
  const key = await webcrypto.subtle.importKey('raw', contentKey, { name: 'AES-GCM' }, false, ['decrypt']);
  plainBytes = Buffer.from(new Uint8Array(await webcrypto.subtle.decrypt(
    { name: 'AES-GCM', iv: raw.subarray(2 + wrappedKeyLen, 2 + wrappedKeyLen + 12) },
    key, raw.subarray(2 + wrappedKeyLen + 12))));
  check('AES-256-GCM decrypts and the tag verifies', true);
} catch (err) {
  // WebCrypto deliberately gives AES-GCM failures an opaque message, so the
  // layer name above is what makes this readable.
  check('AES-256-GCM decrypts and the tag verifies', false,
    `${err.constructor.name}: ${err.message || '(no message — WebCrypto AES-GCM failures are opaque)'}`);
  died('AES-GCM tag verification');
}

// ---- layer 3: JSON parse ----
let got;
try {
  got = JSON.parse(plainBytes.toString('utf8'));
  check('the plaintext is valid UTF-8 JSON', true);
} catch (err) {
  check('the plaintext is valid UTF-8 JSON', false, err.message);
  died('JSON parse');
}

// ---- layer 4: equality. Reaching here on a corrupt envelope would be a finding. ----
const a = JSON.stringify(got);
const b = JSON.stringify(fixture.plaintext_submission);
check('it equals the fixture plaintext exactly', a === b,
  `\n          got      ${a}\n          expected ${b}`);

// Reported, not asserted: only the decoded VALUE is contractual. His encoder's
// key order and separators are his own, and a difference in either would be
// worth knowing about without being a failure.
console.log(`\n        decoded ${plainBytes.length} bytes of UTF-8 JSON`);
console.log(`        key order as decoded : ${Object.keys(got).join(', ')}`);
console.log(`        key order in fixture : ${Object.keys(fixture.plaintext_submission).join(', ')}`);
console.log(`        separators           : ${/[,:]\s/.test(plainBytes.toString('utf8')) ? 'spaced' : 'compact'}`);

console.log(`\n  ${fails === 0 ? 'REVERSE DIRECTION: EXACT MATCH' : `${fails} REVERSE CHECK(S) FAILED`}\n`);
process.exit(fails ? 1 : 0);
