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
// 1 and 2. The gb2 envelope, against whatever keypair is available
// =====================================================
// **These assertions used to run only when the uncommitted fixture was
// present**, which meant they ran on one machine and nowhere else. CI went
// green on 2026-09-03 having never encrypted anything.
//
// Almost none of them needed that fixture. The prefix, the base64 alphabet, the
// envelope geometry, the round trip and the tamper response are properties of
// the format and hold for any 2048-bit RSA keypair, so they are parameterised
// here and run against an ephemeral pair generated in-process. The fixture,
// when present, runs the same body a second time — a real instructor key
// exercising the same path — plus the one check below that genuinely needs it.
//
// **What only the committed fixture can do**, and why an ephemeral pair cannot:
// `sample_gb2_string` is a gb2 envelope produced by the AUTOGRADER's Python
// implementation, not by this one. Decoding it is the only check in the suite
// that proves the two implementations agree rather than that this one is
// self-consistent. That needs a fixed keypair and a fixed ciphertext, so it is
// skipped loudly rather than faked.
const gb2Body = async (label, pubPem, privPem, payload) => {
  const encoded = await svc.encryptJsonGb2(payload, pubPem);
  const decoded = await decryptGb2(encoded, privPem);

  check(`[${label}] gb2 output carries the gb2: prefix`, () =>
    assert(encoded.startsWith('gb2:'), `got "${encoded.slice(0, 8)}..."`));

  check(`[${label}] gb2 round-trip: the plaintext survives encrypt -> decrypt`, () =>
    assertEqual(decoded, payload, 'decrypted payload differs from the plaintext'));

  check(`[${label}] gb2 base64 is standard (padded, non-URL-safe)`, () => {
    const b64 = encoded.slice(4);
    assert(!/[-_]/.test(b64), 'base64 body contains URL-safe alphabet characters');
    assert(b64.length % 4 === 0, 'base64 body is not padded to a multiple of 4');
  });

  // --- envelope shape ---
  const env = parseGb2Envelope(encoded);
  check(`[${label}] envelope: first two bytes are 0x01 0x00 (wrappedKeyLen = 256)`, () => {
    assertEqual([env.raw[0], env.raw[1]], [0x01, 0x00], 'wrappedKeyLen prefix bytes wrong');
    assert(env.wrappedKeyLen === 256, `wrappedKeyLen is ${env.wrappedKeyLen}, expected 256`);
  });
  check(`[${label}] envelope: wrappedKey length equals the declared wrappedKeyLen`, () =>
    assert(env.wrappedKey.length === env.wrappedKeyLen,
      `wrappedKey is ${env.wrappedKey.length} bytes, declared ${env.wrappedKeyLen}`));
  check(`[${label}] envelope: 12-byte IV follows the wrapped key`, () =>
    assert(env.iv.length === 12, `iv is ${env.iv.length} bytes`));
  check(`[${label}] envelope: ciphertext+tag is at least 17 bytes`, () =>
    assert(env.ciphertextPlusTag.length >= 17,
      `ciphertext+tag is ${env.ciphertextPlusTag.length} bytes`));
  check(`[${label}] envelope: total length is exactly 2 + wrappedKeyLen + 12 + ciphertext+tag`, () =>
    assert(env.raw.length === 2 + env.wrappedKeyLen + 12 + env.ciphertextPlusTag.length,
      'envelope length does not add up'));

  // --- tamper ---
  let tamperRaised = false;
  const tamperedEnv = Buffer.from(env.raw);
  tamperedEnv[tamperedEnv.length - 1] ^= 0xff; // flip a byte inside ciphertext+tag
  try {
    await decryptGb2('gb2:' + tamperedEnv.toString('base64'), privPem);
  } catch {
    tamperRaised = true;
  }
  check(`[${label}] tamper: flipping a ciphertext byte makes decryption raise`, () =>
    assert(tamperRaised, 'tampered envelope decrypted without error'));

  // --- de-identification survives the round trip ---
  // Asserting on the DECRYPTED payload rather than the intermediate object is
  // the point: it is what a course private key holder actually receives.
  const withPii = {
    student_name: 'Jane Smith', email: 'jane@example.edu', sid: '123456789',
    student_id: 'A00123456', course_code: 'ENG17', assignment_id: 'ENG17_HW1',
    pdf_filename: 'x.pdf', ai_feedback: true,
    submission_data: { p0s0: { answer: 'hi', images_submitted: 0 } },
  };
  const cleanEncoded = await svc.encryptJsonGb2(svc.deidentifyForGb2(withPii), pubPem);
  const cleanDecoded = await decryptGb2(cleanEncoded, privPem);
  check(`[${label}] de-identify: the decrypted gb2 payload contains no PII fields`, () => {
    for (const f of ['student_name', 'email', 'sid', 'student_id']) {
      assert(!(f in cleanDecoded), `"${f}" present in decrypted payload`);
    }
    assert('assignment_id' in cleanDecoded && 'submission_data' in cleanDecoded,
      'decrypted payload is missing assignment_id or submission_data');
    assert(cleanDecoded.ai_feedback === true,
      `ai_feedback is ${JSON.stringify(cleanDecoded.ai_feedback)} in the decrypted payload, expected true`);
  });
  check(`[${label}] de-identify: the name appears nowhere in the decrypted JSON text`, () =>
    assert(!JSON.stringify(cleanDecoded).includes('Jane Smith'),
      'student name found in decrypted payload'));
};

// ---- always: an ephemeral 2048-bit keypair, generated in-process ----
const ephemeral = await (async () => {
  const pair = await webcrypto.subtle.generateKey(
    { name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true, ['encrypt', 'decrypt']
  );
  return {
    pub: spkiPem(await webcrypto.subtle.exportKey('spki', pair.publicKey)),
    priv: pkcs8Pem(await webcrypto.subtle.exportKey('pkcs8', pair.privateKey)),
  };
})();

const EPHEMERAL_PAYLOAD = {
  assignment_id: 'X_Lab1',
  submission_data: { p0s0: { answer: 'hi', images_submitted: 0 } },
};
await gb2Body('ephemeral', ephemeral.pub, ephemeral.priv, EPHEMERAL_PAYLOAD);

{
  const { pub: pubPem, priv: privPem } = ephemeral;
  // PEM tolerance: no trailing newline, CRLF line endings, extra whitespace.
  const gnarly = pubPem.trim().replace(/\n/g, '\r\n');
  const decoded2 = await decryptGb2(
    await svc.encryptJsonGb2(EPHEMERAL_PAYLOAD, `  ${gnarly}  `), privPem);
  check('gb2 accepts a CRLF / untrimmed / newline-less PEM', () =>
    assertEqual(decoded2, EPHEMERAL_PAYLOAD, 'gnarly-PEM round-trip mismatch'));

  // Two encryptions of the same payload must differ (fresh content key + IV).
  const a = await svc.encryptJsonGb2(EPHEMERAL_PAYLOAD, pubPem);
  const b = await svc.encryptJsonGb2(EPHEMERAL_PAYLOAD, pubPem);
  check('gb2 is non-deterministic (fresh content key and IV per call)', () =>
    assert(a !== b, 'two encryptions of the same payload produced identical output'));
}

// ---- when present: the same body against the real fixture keypair ----
if (fixture) {
  await gb2Body('fixture', fixture.public_key_spki_pem, fixture.private_key_pkcs8_pem,
    fixture.plaintext_submission);

  // The one check an ephemeral keypair cannot stand in for.
  const sampleDecoded = await decryptGb2(fixture.sample_gb2_string, fixture.private_key_pkcs8_pem);
  check('[fixture] interop: a gb2 string produced by the autograder decodes here', () =>
    assertEqual(sampleDecoded, fixture.plaintext_submission, 'sample_gb2_string mismatch'));
} else {
  // Loud, and complete. The previous version listed four names while ten checks
  // stopped running, so six vanished with no line of output at all — the exact
  // failure the X-1 rule was adopted to stop. This says what did not run and
  // what is therefore unproven.
  skip('[fixture] the envelope body against a real instructor keypair',
    'fixture not found — the same assertions ran against the ephemeral keypair above');
  skip('[fixture] interop: a gb2 string produced by the autograder decodes here',
    'fixture not found — NOTHING ELSE COVERS THIS. The format is verified ' +
    'self-consistently; that the autograder and this app agree is not verified on ' +
    'this run');
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

  // The end-to-end form of this — PII absent from the DECRYPTED ciphertext, not
  // just from the intermediate object — now runs in `gb2Body` above, against
  // the ephemeral keypair and again against the fixture when there is one. It
  // was fixture-only until 2026-09-04, which meant the assertion that matters
  // most here never ran on CI.
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

// =====================================================
// 6. The envelope over bytes — one implementation, not two
// =====================================================
// Added 2026-09-03 with `WORKORDER_STUDENT_ENCRYPT_IMAGES`. The images in a
// submission are sealed with the same envelope as the payload, so the envelope
// is defined over BYTES and the JSON form is that function plus stringify plus
// base64 plus the tag. These check that it really is one implementation: if
// `encryptJsonGb2` ever grows a second copy, the last check here fails.
{
  const pair = await webcrypto.subtle.generateKey(
    { name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true, ['encrypt', 'decrypt']
  );
  const pubPem = spkiPem(await webcrypto.subtle.exportKey('spki', pair.publicKey));
  const privPem = pkcs8Pem(await webcrypto.subtle.exportKey('pkcs8', pair.privateKey));

  // The autograder's side, over raw bytes: no base64 to strip, no tag to skip.
  const openBytes = async (raw) => {
    const wrappedKeyLen = (raw[0] << 8) | raw[1];
    const wrappedKey = raw.subarray(2, 2 + wrappedKeyLen);
    const iv = raw.subarray(2 + wrappedKeyLen, 2 + wrappedKeyLen + 12);
    const ciphertextPlusTag = raw.subarray(2 + wrappedKeyLen + 12);
    const contentKey = privateDecrypt(
      { key: createPrivateKey(privPem), padding: cryptoConstants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
      Buffer.from(wrappedKey));
    const key = await webcrypto.subtle.importKey('raw', contentKey, { name: 'AES-GCM' }, false, ['decrypt']);
    return new Uint8Array(await webcrypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertextPlusTag));
  };

  // Deliberately not valid UTF-8: an image is bytes, and a path that decoded
  // them as text would corrupt exactly this.
  const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x80, 0xfe, 0xc0, 0x00, 0xff, 0xd9]);
  const sealed = await svc.encryptBytesGb2(jpegBytes, pubPem);

  check('bytes: the envelope is 2 + wrappedKeyLen + 12 + ciphertext + 16', () => {
    const wrappedKeyLen = (sealed[0] << 8) | sealed[1];
    assert(wrappedKeyLen === 256, `wrappedKeyLen is ${wrappedKeyLen}, expected 256`);
    assert(sealed.length === 2 + 256 + 12 + jpegBytes.length + 16,
      `envelope is ${sealed.length} bytes for a ${jpegBytes.length}-byte input`);
  });

  check('bytes: no gb2: tag and no base64 — the entry is the envelope itself', () => {
    assert(sealed[0] === 0x01 && sealed[1] === 0x00, 'the envelope does not open with a uint16 BE length');
    assert(Buffer.from(sealed.subarray(0, 4)).toString('latin1') !== 'gb2:', 'the byte form carries the text tag');
  });

  const opened = await openBytes(sealed);
  check('bytes: round-trip returns the input exactly, invalid UTF-8 and all', () =>
    assertEqual([...opened], [...jpegBytes], 'the bytes did not survive the envelope'));

  const empty = await svc.encryptBytesGb2(new Uint8Array(0), pubPem);
  const openedEmpty = await openBytes(empty);
  check('bytes: an empty input seals and opens rather than throwing', () => {
    assert(empty.length === 2 + 256 + 12 + 16, `empty envelope is ${empty.length} bytes`);
    assert(openedEmpty.length === 0, `empty input came back as ${openedEmpty.length} bytes`);
  });

  const a = await svc.encryptBytesGb2(jpegBytes, pubPem);
  const b = await svc.encryptBytesGb2(jpegBytes, pubPem);
  check('bytes: a fresh content key and IV every call', () => {
    assert(Buffer.compare(Buffer.from(a), Buffer.from(b)) !== 0,
      'two seals of the same bytes are identical');
    const ivA = Buffer.from(a.subarray(258, 270)).toString('hex');
    const ivB = Buffer.from(b.subarray(258, 270)).toString('hex');
    assert(ivA !== ivB, `the IV repeated across calls: ${ivA}`);
  });

  {
    const realConsoleError = console.error;
    let threw = null;
    console.error = () => {};
    try { await svc.encryptBytesGb2(jpegBytes, 'not a key'); }
    catch (err) { threw = err; } finally { console.error = realConsoleError; }
    check('bytes: a bad key throws instead of returning output', () => {
      assert(threw !== null, 'encryptBytesGb2 resolved with an invalid key');
      assert(threw.name === svc.GB2_KEY_ERROR, `error name is "${threw.name}"`);
    });
  }

  // The one that keeps the two forms from drifting: decrypt the JSON envelope
  // as BYTES and you get the serialised object, character for character.
  const payload = { assignment_id: 'X_Lab1', submission_data: { p0s0: { answer: 'hi', images_submitted: 0 } } };
  const jsonEnvelope = new Uint8Array(Buffer.from((await svc.encryptJsonGb2(payload, pubPem)).slice(4), 'base64'));
  const jsonBytes = await openBytes(jsonEnvelope);
  check('the JSON form is the byte form plus stringify, base64 and the tag', () =>
    assertEqual(Buffer.from(jsonBytes).toString('utf8'), JSON.stringify(payload),
      'the gb2 JSON envelope is not the byte envelope over JSON.stringify'));
}

// ---------- report ----------
console.log(results.join('\n'));
console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped\n`);
rmSync(outDir, { recursive: true, force: true });
process.exit(failed > 0 ? 1 : 0);
