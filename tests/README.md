# cryptoService tests

Two layers. The first runs on its own; the second proves the browser and the
Gradescope autograder agree.

## 1. Unit suite — `npm test`

`run-tests.mjs`. Plain Node (>= 18), no test framework: it transpiles
`cryptoService.ts` with the esbuild that ships inside Vite and runs it against
the same WebCrypto API the browser uses. 27 checks covering

- gb2 round trip against the verified fixture, and against a freshly generated
  ephemeral keypair
- envelope layout — `wrappedKeyLen[uint16 BE] | wrappedKey | iv[12] | ciphertext+tag`,
  `0x01 0x00` length prefix for a 2048-bit key, standard padded base64
- de-identification — `student_name` / `email` / `sid` / `student_id` gone from
  the *decrypted* payload, `assignment_id` / `submission_data` still there
- bad course keys throw `Gb2KeyError` and never return output (no silent
  downgrade to gb1)
- gb1 regression — prefix, round trip, envelope length, `isEncoded()`

`npm test` also runs the rendering-contract suites, both of which guard files
held byte-identical with the Assignment Maker (each SKIPs its mirror check when
that repo is not checked out alongside):

- `math-delimiter-tests.mjs` — `services/mathDelimiters.ts`: the `$...$` /
  `$$...$$` split, and no second copy of the regex anywhere in the tree.
- `figure-tests.mjs` — `services/figureBlocks.ts`: a ` ```svg ` block or a
  `![alt](url)` line is lifted out **before** the math splitter ever sees it (a
  `$` in the drawing's path data would otherwise shred it), the split is exact,
  each inlined copy of a drawing gets its own id namespace so the same figure on
  two problems cannot capture the other's markers, and nothing executable
  survives into the student's page.

## 2. Interop check — browser output into the real autograder

The unit suite decrypts with Node. This one decrypts browser-produced gb2
strings with the **delivered** `crypto_utils.py`, so the contract is verified
end to end rather than against our own reading of it.

```bash
node tests/interop-emit.mjs > emitted.json    # encrypts using the app's cryptoService.ts
python tests/interop-check.py emitted.json    # decrypts using the autograder's crypto_utils.py
```

Requires Python with `cryptography` installed. It sets `GB2_PRIVATE_KEY_PEM`
from the fixture — the same environment variable Gradescope will hold the real
course private key in.

Last run 2026-08-10 against
`Encryption/updated_encryption_BA_7_13_2026/crypto_utils.py`
(cryptography 41.0.0, Python 3.13.5) — all 6 checks passed:
`is_encoded()` detects the string; `decrypt_json()` returns both the fixture
plaintext and the de-identified App payload byte-identically; no PII fields
survive; `assignment_id` and `submission_data` are present; a flipped
ciphertext byte raises.

## The fixture

Both layers need `gb2_test_fixture.json` — a throwaway 2048-bit keypair, a
sample plaintext, and a known-good `gb2:` string generated on the autograder
side.

It is **not committed**: it contains a private key, test-only or not, and this
repo is public. Default lookup is `../Encryption/gb2_test_fixture.json`
relative to the repo root; override with `GB2_FIXTURE`:

```bash
GB2_FIXTURE=/path/to/gb2_test_fixture.json npm test
```

Without the fixture `npm test` still runs everything using an ephemeral
keypair and reports the fixture-bound checks as SKIPPED. The interop check
cannot run without it.

**Never add a private key to this repo, and never let one into the app
bundle.** The app holds public keys only.
