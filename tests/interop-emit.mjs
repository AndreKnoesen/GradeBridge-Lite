// =====================================================
// Emit gb2: strings for the Python interop check
// =====================================================
// Produces gb2 strings using the ACTUAL app cryptoService.ts, so the Python
// side is verifying browser output rather than a re-implementation.
// Writes a JSON bundle to stdout; interop-check.py consumes it.
//
//   node tests/interop-emit.mjs > emitted.json
//   python tests/interop-check.py emitted.json
//
// See tests/README.md.
// =====================================================

import { build } from 'esbuild';
import { webcrypto } from 'node:crypto';
import { readFileSync, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');

globalThis.crypto ??= webcrypto;

const fixturePath = process.env.GB2_FIXTURE
  ? resolve(process.env.GB2_FIXTURE)
  : resolve(REPO, '..', 'Encryption', 'gb2_test_fixture.json');
if (!existsSync(fixturePath)) {
  console.error(`gb2 fixture not found at ${fixturePath}\nSet GB2_FIXTURE to its location.`);
  process.exit(2);
}
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));

const outFile = join(mkdtempSync(join(tmpdir(), 'gb-interop-')), 'cryptoService.mjs');
await build({
  entryPoints: [join(REPO, 'cryptoService.ts')],
  outfile: outFile,
  format: 'esm',
  target: 'es2022',
  logLevel: 'silent',
});
const svc = await import(pathToFileURL(outFile).href);

// **This deliberately carries `student_name`, which App.tsx no longer emits.**
//
// Since 2026-09-03 the app builds no such field: identity is Gradescope's
// authenticated submitter. `deidentifyForGb2` is kept anyway, and so is this
// fixture, because the stripper is the belt to that decision's braces — if the
// field ever returns by accident, the gb2 path must still remove it. Feeding it
// a payload that already lacks the field would prove nothing.
const appPayload = svc.deidentifyForGb2({
  student_name: 'Jane Smith',
  course_code: 'TEST',
  assignment_id: 'TEST_ASSIGNMENT_1',
  pdf_filename: 'TEST_ASSIGNMENT_1_submission_20260810-0000.pdf',
  submission_data: {
    p0s0: { answer: 'The quick brown fox', images_submitted: 0 },
    p1s0: { answer: '42', images_submitted: 1 },
  },
  last_saved: '2026-08-10T00:00:00.000Z',
});

const clean = await svc.encryptJsonGb2(appPayload, fixture.public_key_spki_pem);
const fixtureExact = await svc.encryptJsonGb2(fixture.plaintext_submission, fixture.public_key_spki_pem);

// Flip one byte inside ciphertext+tag.
const raw = Buffer.from(clean.slice(4), 'base64');
raw[raw.length - 1] ^= 0xff;
const tampered = 'gb2:' + raw.toString('base64');

process.stdout.write(JSON.stringify({
  fixturePath,
  clean,
  fixtureExact,
  tampered,
  appPayload,
  fixturePlaintext: fixture.plaintext_submission,
}));
