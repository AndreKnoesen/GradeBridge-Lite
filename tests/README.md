# cryptoService tests

Two layers. The first runs on its own; the second proves the browser and the
Gradescope autograder agree.

## 1. Unit suite — `npm test`

`run-tests.mjs`. Plain Node (>= 18), no test framework: it transpiles
`cryptoService.ts` with the esbuild that ships inside Vite and runs it against
the same WebCrypto API the browser uses. 28 checks covering

- gb2 round trip against the verified fixture, and against a freshly generated
  ephemeral keypair
- envelope layout — `wrappedKeyLen[uint16 BE] | wrappedKey | iv[12] | ciphertext+tag`,
  `0x01 0x00` length prefix for a 2048-bit key, standard padded base64
- de-identification — `student_name` / `email` / `sid` / `student_id` gone from
  the *decrypted* payload, `assignment_id` / `submission_data` / `ai_feedback`
  still there. **Since 2026-09-03 the app emits none of those four in the first
  place**; the fixtures feed them in deliberately, because a stripper tested
  against a payload that never had the field proves nothing.
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
- `ai-feedback-tests.mjs` — the per-assignment `aiFeedback` pass-through: the
  field is on `Assignment`, the submission JSON emits `ai_feedback` as a real
  boolean for every spec shape (`true` / `false` / absent / `"true"` / `1` /
  `null`), the flag survives the autosave round-trip, and no student-facing
  surface mentions it. These read the expression out of `App.tsx` and evaluate
  it, rather than restating it — App.tsx cannot be imported here.

## 2. Interoperability check — this app and the real autograder, both directions

### CI DOES NOT RUN THIS. Read that first.

**A green tick on CI does not include anything in this section.** The check
needs a private key; the key cannot be committed; CI has no other way to obtain
it. That is deliberate and it stays.

It is therefore a **local, manual, two-command run**, not part of `npm test`.
Nothing here is wired into `npm test`, and it must not be: an interoperability
claim that quietly degrades into a self-consistency claim when a file is
missing is worse than no claim at all.

**Do not "fix" this by generating a keypair in-process and calling the result
interop.** An ephemeral pair proves this app agrees with itself, which
`run-tests.mjs` already covers thoroughly. It cannot prove agreement with
another implementation, because both ends would be ours.

### What each direction proves

| | direction | proves |
|---|---|---|
| **forward** | our output → his decrypt | the autograder can open what the app produces |
| **reverse** | his output → our reading | the app reads what the autograder produces |

The two are independent and neither implies the other. Until 2026-09-05 the
reverse direction ran against a keypair *we* had generated, so it was closer to
a self-consistency check than its name suggested; it now runs against the
autograder author's own test keypair and a `gb2:` string his implementation
produced.

### Forward: our output, his decrypt

```bash
node tests/interop-emit.mjs > emitted.json    # encrypts using the app's cryptoService.ts
python tests/interop-check.py emitted.json    # decrypts using the autograder's crypto_utils.py
```

Requires Python with `cryptography` installed. It sets `GB2_PRIVATE_KEY_PEM`
from the fixture — the same environment variable Gradescope will hold the real
course private key in.

### Reverse: his output, our reading

```bash
node tests/interop-reverse.mjs
```

Deliberately does **not** call `crypto_utils.py`: opening his ciphertext with
his own decryptor would prove only that his code agrees with itself. The
envelope is parsed from the format `cryptoService.ts` documents, so a
disagreement in layout, padding or field order surfaces as a failure instead of
being absorbed by shared code.

Every failure names **which layer caught it** — RSA-OAEP unwrap, AES-GCM tag
verification, JSON parse, or the final equality assertion. That distinction is
the point: if a corrupted envelope is only ever caught by the equality
assertion, authentication is not doing its job.

Without a fixture it **skips loudly**, naming what did not run and what is
therefore unproven. It never silently passes.

### Proving both can go red

A check nobody has watched fail is a comment. Both directions have been made to
fail on purpose, on a single flipped byte, and both were caught by the
cryptography rather than by the final comparison:

```bash
# reverse — flip a byte inside ciphertext+tag, feed it in without touching the fixture
GB2_OVERRIDE='gb2:<corrupted>' node tests/interop-reverse.mjs
#   -> FAIL  AES-256-GCM decrypts and the tag verifies
#      CAUGHT BY: AES-GCM tag verification

# forward — flip a byte inside the wrapped key in emitted.json, then re-check
python tests/interop-check.py emitted_corrupt_wrappedkey.json
#   -> Exception: gb2: decryption/unwrap failed (file may be tampered or wrong key)
#      caught at the RSA-OAEP unwrap
```

Last run **2026-09-05** against
`Encryption/updated_encryption_BA_7_13_2026/crypto_utils.py` (cryptography
41.0.0, Python 3.13.5): forward all 6 checks passed; reverse an exact match,
including key order and compact separators. Both went red as above on one
corrupted byte and green again on the untouched fixture.

## The fixture

Both directions need `gb2_test_fixture.json`:

| field | read at |
|---|---|
| `public_key_spki_pem` | `tests/interop-emit.mjs:64,65`, `tests/run-tests.mjs:246` |
| `private_key_pkcs8_pem` | `tests/interop-check.py:38`, `tests/run-tests.mjs:246,250`, `tests/interop-reverse.mjs` |
| `plaintext_submission` | `tests/interop-emit.mjs:65,78`, `tests/run-tests.mjs:247,252` |
| `sample_gb2_string` | `tests/run-tests.mjs:250`, `tests/interop-reverse.mjs` |

`sample_gb2_string` is the one field an ephemeral keypair cannot stand in for:
it is an envelope produced by the *other* implementation.

Since 2026-09-05 the fixture is assembled from the five files the autograder
author delivered, and the keypair is **RSA-4096**, not the 2048-bit pair used
before. That matters: **the live ENG17 Fall course key is also 4096-bit**, so
this is the first fixture that exercises the configuration production will
actually run. `wrappedKeyLen` is 512 rather than 256 and the envelope prefix is
`0x02 0x00` rather than `0x01 0x00` — which is why `run-tests.mjs` no longer
asserts a fixed key size, only that the big-endian prefix decodes to the length
that follows it.

Per-file sealing overhead follows the key: **542 bytes at 4096-bit**, against
the 286 measured at 2048-bit and quoted in `CLAUDE.md`.

It is **not committed**: it contains a private key, test-only or not, and this
repo is public. It lives outside both app repositories, under
`GradeBridge2026/Encryption/`, which the root `.gitignore` excludes entirely.
Default lookup is `../Encryption/gb2_test_fixture.json` relative to the repo
root; override with `GB2_FIXTURE`:

```bash
GB2_FIXTURE=/path/to/gb2_test_fixture.json npm test
```

Without the fixture `npm test` still runs everything using an ephemeral
keypair and reports the fixture-bound checks as SKIPPED. Neither interop
direction can run without it.

**Never add a private key to this repo, and never let one into the app
bundle.** The app holds public keys only — `cryptoService.ts` exports no gb2
decrypt at all, and a check in `milestone-zero.mjs` holds it that way.
