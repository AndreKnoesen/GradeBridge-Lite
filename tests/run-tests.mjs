// =====================================================
// cryptoService test runner
// =====================================================
// Plain Node (>=18) — no test framework. Transpiles cryptoService.ts with the
// esbuild that ships inside Vite, then exercises gb1 and gb2 against the
// browser-identical WebCrypto global.
//
//   npm test
//
// The gb2 round-trip needs the verified fixture (test keypair + plaintext +
// a known-good gb2: string). It is NOT committed — it contains a private key,
// test-only or not. Default location:
//
//   ../../Encryption/gb2_test_fixture.json      (relative to the repo root)
//
// Override with:  GB2_FIXTURE=/path/to/gb2_test_fixture.json npm test
//
// Without the fixture the suite still runs every check using an ephemeral
// keypair generated here, and reports the fixture-bound checks as SKIPPED.
// =====================================================

import { build } from 'esbuild';
import { createPrivateKey, privateDecrypt, constants as cryptoConstants } from 'node:crypto';
import { webcrypto } from 'node:crypto';
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');

// cryptoService.ts is browser code: it reaches for the crypto/btoa/atob globals.
globalThis.crypto ??= webcrypto;

// ---------- tiny assertion harness ----------
let passed = 0, failed = 0, skipped = 0;
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
const skip = (name, why) => {
  skipped++;
  results.push(`  SKIP  ${name} (${why})`);
};
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const assertEqual = (actual, expected, msg) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg}\n          expected: ${e}\n          actual:   ${a}`);
};

// ---------- load cryptoService.ts ----------
const outDir = mkdtempSync(join(tmpdir(), 'gb-crypto-test-'));
const outFile = join(outDir, 'cryptoService.mjs');
await build({
  entryPoints: [join(REPO, 'cryptoService.ts')],
  outfile: outFile,
  format: 'esm',
  target: 'es2022',
  bundle: false,
  logLevel: 'silent',
});
const svc = await import(pathToFileURL(outFile).href);

// ---------- helpers mirroring the autograder's decode path ----------
const parseGb2Envelope = (gb2String) => {
  assert(gb2String.startsWith('gb2:'), 'string is not gb2: prefixed');
  const raw = Buffer.from(gb2String.slice(4), 'base64');
  const wrappedKeyLen = raw.readUInt16BE(0);
  return {
    raw,
    wrappedKeyLen,
    wrappedKey: raw.subarray(2, 2 + wrappedKeyLen),
    iv: raw.subarray(2 + wrappedKeyLen, 2 + wrappedKeyLen + 12),
    ciphertextPlusTag: raw.subarray(2 + wrappedKeyLen + 12),
  };
};

// RSA-OAEP-SHA256 unwrap + AES-256-GCM decrypt — the same two steps
// crypto_utils._decrypt_gb2() performs.
const decryptGb2 = async (gb2String, privateKeyPem) => {
  const { wrappedKey, iv, ciphertextPlusTag } = parseGb2Envelope(gb2String);
  const contentKeyBytes = privateDecrypt(
    {
      key: createPrivateKey(privateKeyPem),
      padding: cryptoConstants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256',
    },
    wrappedKey
  );
  assert(contentKeyBytes.length === 32, `unwrapped content key is ${contentKeyBytes.length} bytes, expected 32`);
  const key = await webcrypto.subtle.importKey('raw', contentKeyBytes, { name: 'AES-GCM' }, false, ['decrypt']);
  const plain = await webcrypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertextPlusTag);
  return JSON.parse(Buffer.from(plain).toString('utf8'));
};

const spkiPem = (der) =>
  `-----BEGIN PUBLIC KEY-----\n${Buffer.from(der).toString('base64').replace(/(.{64})/g, '$1\n').trimEnd()}\n-----END PUBLIC KEY-----\n`;
const pkcs8Pem = (der) =>
  `-----BEGIN PRIVATE KEY-----\n${Buffer.from(der).toString('base64').replace(/(.{64})/g, '$1\n').trimEnd()}\n-----END PRIVATE KEY-----\n`;

// ---------- fixture ----------
const fixturePath = process.env.GB2_FIXTURE
  ? resolve(process.env.GB2_FIXTURE)
  : resolve(REPO, '..', 'Encryption', 'gb2_test_fixture.json');
const fixture = existsSync(fixturePath) ? JSON.parse(readFileSync(fixturePath, 'utf8')) : null;

console.log('\ncryptoService — gb1 / gb2 test suite');
console.log(`fixture: ${fixture ? fixturePath : `NOT FOUND at ${fixturePath}`}\n`);

// =====================================================
// 1. gb2 round-trip against the verified fixture
// =====================================================
if (fixture) {
  const encoded = await svc.encryptJsonGb2(fixture.plaintext_submission, fixture.public_key_spki_pem);
  const decoded = await decryptGb2(encoded, fixture.private_key_pkcs8_pem);

  check('gb2 output carries the gb2: prefix', () =>
    assert(encoded.startsWith('gb2:'), `got "${encoded.slice(0, 8)}..."`));

  check('gb2 round-trip: fixture plaintext survives encrypt -> decrypt', () =>
    assertEqual(decoded, fixture.plaintext_submission, 'decrypted payload differs from fixture plaintext'));

  check('gb2 base64 is standard (padded, non-URL-safe)', () => {
    const b64 = encoded.slice(4);
    assert(!/[-_]/.test(b64), 'base64 body contains URL-safe alphabet characters');
    assert(b64.length % 4 === 0, 'base64 body is not padded to a multiple of 4');
  });

  // --- envelope shape ---
  const env = parseGb2Envelope(encoded);
  check('envelope: first two bytes are 0x01 0x00 (wrappedKeyLen = 256)', () => {
    assertEqual([env.raw[0], env.raw[1]], [0x01, 0x00], 'wrappedKeyLen prefix bytes wrong');
    assert(env.wrappedKeyLen === 256, `wrappedKeyLen is ${env.wrappedKeyLen}, expected 256`);
  });
  check('envelope: wrappedKey length equals the declared wrappedKeyLen', () =>
    assert(env.wrappedKey.length === env.wrappedKeyLen,
      `wrappedKey is ${env.wrappedKey.length} bytes, declared ${env.wrappedKeyLen}`));
  check('envelope: 12-byte IV follows the wrapped key', () =>
    assert(env.iv.length === 12, `iv is ${env.iv.length} bytes`));
  check('envelope: ciphertext+tag is at least 17 bytes', () =>
    assert(env.ciphertextPlusTag.length >= 17,
      `ciphertext+tag is ${env.ciphertextPlusTag.length} bytes`));
  check('envelope: total length is exactly 2 + wrappedKeyLen + 12 + ciphertext+tag', () =>
    assert(env.raw.length === 2 + env.wrappedKeyLen + 12 + env.ciphertextPlusTag.length,
      'envelope length does not add up'));

  // --- our decoder agrees with the known-good sample from the autograder side ---
  const sampleDecoded = await decryptGb2(fixture.sample_gb2_string, fixture.private_key_pkcs8_pem);
  check('fixture sample_gb2_string decodes to the fixture plaintext (decoder sanity)', () =>
    assertEqual(sampleDecoded, fixture.plaintext_submission, 'sample_gb2_string mismatch'));

  // --- tamper ---
  let tamperRaised = false;
  const tamperedEnv = Buffer.from(env.raw);
  tamperedEnv[tamperedEnv.length - 1] ^= 0xff; // flip a byte inside ciphertext+tag
  try {
    await decryptGb2('gb2:' + tamperedEnv.toString('base64'), fixture.private_key_pkcs8_pem);
  } catch {
    tamperRaised = true;
  }
  check('tamper: flipping a ciphertext byte makes decryption raise', () =>
    assert(tamperRaised, 'tampered envelope decrypted without error'));
} else {
  for (const name of [
    'gb2 round-trip: fixture plaintext survives encrypt -> decrypt',
    'envelope: first two bytes are 0x01 0x00 (wrappedKeyLen = 256)',
    'fixture sample_gb2_string decodes to the fixture plaintext (decoder sanity)',
    'tamper: flipping a ciphertext byte makes decryption raise',
  ]) skip(name, 'fixture not found');
}

// =====================================================
// 2. gb2 with an ephemeral keypair (fixture-independent)
// =====================================================
{
  const pair = await webcrypto.subtle.generateKey(
    { name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true, ['encrypt', 'decrypt']
  );
  const pubPem = spkiPem(await webcrypto.subtle.exportKey('spki', pair.publicKey));
  const privPem = pkcs8Pem(await webcrypto.subtle.exportKey('pkcs8', pair.privateKey));

  const payload = { assignment_id: 'X_Lab1', submission_data: { p0s0: { answer: 'hi', images_submitted: 0 } } };
  const decoded = await decryptGb2(await svc.encryptJsonGb2(payload, pubPem), privPem);
  check('gb2 round-trip with an ephemeral 2048-bit keypair', () =>
    assertEqual(decoded, payload, 'ephemeral round-trip mismatch'));

  // PEM tolerance: no trailing newline, CRLF line endings, extra whitespace.
  const gnarly = pubPem.trim().replace(/\n/g, '\r\n');
  const decoded2 = await decryptGb2(await svc.encryptJsonGb2(payload, `  ${gnarly}  `), privPem);
  check('gb2 accepts a CRLF / untrimmed / newline-less PEM', () =>
    assertEqual(decoded2, payload, 'gnarly-PEM round-trip mismatch'));

  // Two encryptions of the same payload must differ (fresh content key + IV).
  const a = await svc.encryptJsonGb2(payload, pubPem);
  const b = await svc.encryptJsonGb2(payload, pubPem);
  check('gb2 is non-deterministic (fresh content key and IV per call)', () =>
    assert(a !== b, 'two encryptions of the same payload produced identical output'));
}

// =====================================================
// 3. Bad key material must throw, never fall back
// =====================================================
{
  const badKeys = {
    'empty string': '',
    'whitespace only': '   \n  ',
    'not a PEM': 'this is not a key',
    'PEM wrapper with garbage body': '-----BEGIN PUBLIC KEY-----\nbm90YWtleQ==\n-----END PUBLIC KEY-----\n',
  };
  // The service logs key-import details to the console by design; these
  // failures are deliberate, so keep them out of the test report.
  const realConsoleError = console.error;
  for (const [label, key] of Object.entries(badKeys)) {
    let threw = null;
    console.error = () => {};
    try {
      await svc.encryptJsonGb2({ a: 1 }, key);
    } catch (err) { threw = err; } finally { console.error = realConsoleError; }
    check(`bad key (${label}) throws instead of returning output`, () => {
      assert(threw !== null, 'encryptJsonGb2 resolved with an invalid key');
      assert(threw.name === svc.GB2_KEY_ERROR,
        `error name is "${threw.name}", expected "${svc.GB2_KEY_ERROR}"`);
      assert(/could not be (read|used)/.test(threw.message),
        `error message is not the user-facing one: "${threw.message}"`);
      assert(/NOT created/.test(threw.message),
        'error message does not tell the student no file was produced');
    });
  }
}

// =====================================================
// 4. De-identification
// =====================================================
{
  const full = {
    student_name: 'Jane Smith',
    email: 'jane@example.edu',
    sid: '912345678',
    student_id: '912345678',
    course_code: 'EEC1',
    assignment_id: 'EEC1_Lab1_InLab',
    pdf_filename: 'Jane_Smith_EEC1_submission.pdf',
    submission_data: { p0s0: { answer: 'a', images_submitted: 0 } },
    ai_feedback: true,
    last_saved: '2026-08-10T00:00:00.000Z',
  };
  const clean = svc.deidentifyForGb2(full);

  check('de-identify: strips student_name, email, sid, student_id', () => {
    for (const f of ['student_name', 'email', 'sid', 'student_id']) {
      assert(!(f in clean), `"${f}" survived de-identification`);
    }
  });
  check('de-identify: keeps assignment_id and submission_data', () => {
    assert('assignment_id' in clean, 'assignment_id was dropped');
    assert('submission_data' in clean, 'submission_data was dropped');
    assertEqual(clean.submission_data, full.submission_data, 'submission_data was altered');
  });
  // ai_feedback is a pass-through flag, not PII. It is not in GB2_PII_FIELDS,
  // so it should survive — asserted rather than assumed, because Gradescope
  // reads it out of the de-identified payload and nothing else would notice.
  check('de-identify: keeps ai_feedback, still boolean true', () => {
    assert('ai_feedback' in clean, 'ai_feedback was stripped by de-identification');
    assert(clean.ai_feedback === true, `ai_feedback is ${JSON.stringify(clean.ai_feedback)}, expected boolean true`);
  });
  check('de-identify: keeps the allowed course_code and pdf_filename', () => {
    assert(clean.course_code === 'EEC1', 'course_code was dropped');
    assert(clean.pdf_filename === full.pdf_filename, 'pdf_filename was dropped or altered');
  });
  check('de-identify: does not mutate its input', () =>
    assert(full.student_name === 'Jane Smith', 'input object was mutated'));

  // End-to-end: the PII must be absent from the decrypted ciphertext, not just
  // from the intermediate object.
  if (fixture) {
    const encoded = await svc.encryptJsonGb2(svc.deidentifyForGb2(full), fixture.public_key_spki_pem);
    const decoded = await decryptGb2(encoded, fixture.private_key_pkcs8_pem);
    check('de-identify: decrypted gb2 payload contains no PII fields', () => {
      for (const f of ['student_name', 'email', 'sid', 'student_id']) {
        assert(!(f in decoded), `"${f}" present in decrypted payload`);
      }
      assert('assignment_id' in decoded && 'submission_data' in decoded,
        'decrypted payload is missing assignment_id or submission_data');
      assert(decoded.ai_feedback === true,
        `ai_feedback is ${JSON.stringify(decoded.ai_feedback)} in the decrypted payload, expected true`);
    });
    check('de-identify: "Jane Smith" appears nowhere in the decrypted JSON text', () =>
      assert(!JSON.stringify(decoded).includes('Jane Smith'),
        'student name found in decrypted payload'));
  } else {
    skip('de-identify: decrypted gb2 payload contains no PII fields', 'fixture not found');
  }
}

// =====================================================
// 5. gb1 unchanged
// =====================================================
{
  const payload = { student_name: 'Jane Smith', course_code: 'EEC1', submission_data: { p0s0: { answer: 'a', images_submitted: 0 } } };
  const gb1 = await svc.encryptJson(payload);

  check('gb1: still emits the gb1: prefix', () =>
    assert(gb1.startsWith('gb1:'), `got "${gb1.slice(0, 8)}..."`));
  const back = await svc.decryptJson(gb1);
  check('gb1: decryptJson returns the original object', () =>
    assertEqual(back, payload, 'gb1 round-trip mismatch'));
  check('gb1: envelope is iv[12] | ciphertext+tag (no length prefix)', () => {
    const raw = Buffer.from(gb1.slice(4), 'base64');
    const expected = 12 + new TextEncoder().encode(JSON.stringify(payload)).length + 16;
    assert(raw.length === expected, `gb1 envelope is ${raw.length} bytes, expected ${expected}`);
  });
  check('gb1: isEncoded() still recognises gb1 and rejects gb2', () => {
    assert(svc.isEncoded(gb1) === true, 'isEncoded() rejected a gb1 string');
    assert(svc.isEncoded('gb2:AQA=') === false, 'isEncoded() accepted a gb2 string');
  });
}

// ---------- report ----------
console.log(results.join('\n'));
console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped\n`);
rmSync(outDir, { recursive: true, force: true });
process.exit(failed > 0 ? 1 : 0);
