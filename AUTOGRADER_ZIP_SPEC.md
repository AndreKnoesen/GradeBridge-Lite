# GradeBridge — submission ZIP interface

**Version:** v6.0
**Date:** 2026-09-03

> ## BREAKING, on a course that has a key. **Everything but the payload's own envelope is encrypted.**
>
> On a course whose assignment spec carries a `coursePublicKey`, the page
> photographs, the answer crops, the electronic path's image answers **and the
> electronic submission PDF** are each written as a **gb2 envelope over the raw
> bytes**, under a name ending `.gb2`:
>
> ```
> page_1.jpg.gb2   crops/p1a.jpg.gb2   p0s1_image_0.jpg.gb2   {stem}.pdf.gb2
> ```
>
> A consumer that opens `crops/p1a.jpg` on such a course finds nothing there.
> **The envelope is the one this autograder already decrypts** — the same
> `wrappedKeyLen | wrappedKey | iv | ciphertext+tag` as the payload — so opening
> an image is the existing decrypt called once per file, over bytes instead of
> over a base64 string. §4.2 gives the layout and §10 a reference implementation.
>
> **Why.** Until today the archive encrypted exactly one entry, the payload —
> and on the handwritten path the payload contains **no answers at all**: every
> `submission_data` entry is `null`, because the graded artefact is the crop
> images. A hardened course was encrypting the envelope and shipping the letter
> in the clear beside it. §3.1 has said the payload is empty since v4.0; what
> changed is that everything carrying an answer is now covered too.
>
> **The PDF is in that list for the same reason, one file along.** On an
> electronic assignment it renders the same typed answers the payload encrypts.
> It was left out of the first pass of this change deliberately and reported
> rather than quietly included; the decision to seal it followed the same day.
> **`pdf_filename` therefore names `{stem}.pdf.gb2` on a sealed course** — it
> names the entry that is in the archive, as `pages[].file` and `crops[].file`
> always have.
>
> **Two consequences that are not optional to plan for:**
>
> 1. **The autograder needs the course private key in the container** — the same
>    key it already needs for a gb2 payload, used once more per image entry.
> 2. **Adjudication now requires the private key.** The page images exist
>    expressly so "I wrote it and the tool cut it off" can be settled by looking.
>    Nobody can eyeball a disputed page without the key any more. §10.
>
> **A course with no key does not move.** Same entry names, same bytes, same
> payload keys, `gb1:` as before — verified byte-for-byte against a package
> built by the previous code (§1). A course with no key had no protection to
> weaken, and the answer to that is to issue a key rather than to invent a
> weaker scheme.

**Supersedes:** v5.1, 2026-09-03 — which corrected four stale statements in v5.0
and changed no code. Everything it says still holds for a course with no key.

> ### v5.1 corrected v5.0. Read this if you started a consumer against v5.0.
>
> **The archive filename block in §1 was stale.** It read
> `{StudentName}_{CourseCode}_submission.zip`, which has not been the pattern
> since `b48fa36` — the prose four lines below it already said so, and the
> observed manifest already showed the real name. **A consumer written against
> that code block would glob for a student name that never arrives.** The stem
> is `{assignment_id}_submission_{YYYYMMDD-HHMM}` and carries no name.
>
> Three more statements were stale for the same reason and are corrected here:
> §3 said the filenames "keep the student's name in both cases"; §3 said an
> electronic payload carries "the other seven keys", which is six now that
> `student_name` has gone; and §1's sanitiser was described in a way that
> implied it lowercases.
>
> **Nothing about the code changed in v5.1.** Only this document was wrong. The
> audit that found these is in the completion note for the work order that
> ordered it, and the filename claim is now checked by a test rather than by
> proofreading — see §9.

**Also supersedes:** v5.0, 2026-09-03

> ## BREAKING. `student_name` is REMOVED from the payload.
>
> **It is absent, not empty, and not deprecated-but-present.** A consumer that
> reads `submission["student_name"]` will raise a `KeyError`. That is the whole
> of the breaking change; everything else in v4.3 still holds.
>
> **Identity is Gradescope's authenticated submitter metadata**
> (`/autograder/submission_metadata.json`), and it always was — a name typed
> into a box in the browser is unverified, trivially wrong, and PII carried
> through an encrypted envelope for no gain. `cryptoService.GB2_PII_FIELDS` had
> already reached that conclusion for the hardened gb2 path since April; this
> finishes it for gb1.
>
> **What is given up, deliberately.** v4.3 said of this field: *"Compare against
> Gradescope's submitter; a mismatch is for instructor review."* **That check is
> gone.** After this, nothing inside the package ties the handwriting to a person
> except the account that uploaded it. It is the right trade — a self-typed name
> never detected an impostor, only a typo — but it is a real capability and it
> was removed on purpose, not lost.
>
> **Filenames changed with it**, since they were built from the name:
> `{assignment_id}_submission_{YYYYMMDD-HHMM}` for the archive, the PDF and the
> backup JSON alike. The timestamp is `last_saved`, so the name of the file and
> the contents cannot disagree; it is **UTC**, like `last_saved` itself, so a
> late-evening submission can carry the next day's date.

**Also supersedes:** v4.3, 2026-09-03
**Also supersedes:** v4.2, 2026-09-02 — **the `low-resolution` quality flag is
retired and is never emitted again.** `quality_flags` is now `[]` on all three
crops. Nothing else changed. A reader that switched on that string will simply
stop seeing it; one that displayed it verbatim shows nothing. See §6.
**Supersedes:** v4.1, 2026-09-02 — `pages[]` gained `marks_declined` and
`held_out_mm`. Nothing was removed or renamed, so a v4.1 or v4.0 reader still
works.
**Supersedes:** v4.0, 2026-09-01 — which is accurate except that `pages[]` has
gained `marks_detected`, and a page may now report `marks_found: 3`. Both are in
§3.2.
**Supersedes:** v3.1, 2026-04-08
**Audience:** whoever writes the autograder

---

## What changed, and why v3.1 must not be used

v3.1 described the archive as **flat, one JSON and one PDF**, and said "all
downstream file formats are unchanged". That was true of an electronic
assignment in April. It is not true of a handwritten one, and a reader following
it would extract two files, find every answer `null`, and conclude the student
submitted nothing.

**This document is written from one real archive, not from the code.** Every
filename, field, type, byte size and value below was read out of:

```
GradeBridge2026\CaptureSet\milestone_zero\ENG17_Homework_1_submission_{timestamp}.zip
```

re-emitted on 2026-09-02 with `marks_detected` (every other entry byte-identical
to the 2026-09-01 archive this document was first written from), by
`GradeBridge-Student-Submission/tests/milestone-zero.mjs`
(`npm run milestone:zero`), from ENG17 Homework 1 (`layout_id` **95438EDF**) and
two phone photographs. Its three crops were inspected by eye and confirmed to
land on their own regions with the right handwriting in each. Where this document
states something that archive does not contain, it says so explicitly.

**v6.0 was written from two runs of that harness on the same two photographs**,
one with no course key and one with a test keypair generated for the run — so
every sealed size below is a measurement of the same bytes, not an estimate of
them. The keypair was ephemeral and is not written down anywhere; the sealed
archive was measured and opened in memory and deliberately not kept, because a
file nobody can ever open is a support question waiting to happen.

The scale numbers in §4.3 come from a second harness,
`tests/full-assignment.mjs`, over all sixteen pages and all seventeen regions.

**Nothing here is aspirational.** If a statement is not marked as unobserved, it
came off that ZIP.

---

## 1. The archive

One file, uploaded to Gradescope:

```
{assignment_id}_submission_{YYYYMMDD-HHMM}.zip
```

**No name is in it**, because the app does not have one, and a timestamp because
without a discriminator every student in a class downloads an identically named
file. The timestamp is `last_saved`, in **UTC**, so a late-evening submission can
carry the next day's date.

Sanitised by replacing anything outside `a-z A-Z 0-9 _ -` with `_`. **Case is
preserved** — `ENG17` stays `ENG17`.

The `.json`, the `.pdf` where there is one, and the backup JSON all share this
stem. DEFLATE, level 6.

### Observed manifest

| bytes | entry |
|---:|---|
| 2,728 | `ENG17_Homework_1_submission_{timestamp}.json` |
| 40,696 | `crops/p1a.jpg` |
| 38,285 | `crops/p1b.jpg` |
| 81,454 | `crops/p1c.jpg` |
| 474,470 | `page_1.jpg` |
| 501,463 | `page_2.jpg` |

Archive total 1,117,431 bytes. The six entries are byte-identical between runs of
the same inputs; the total moves a byte or two because `last_saved` is a
timestamp inside the encrypted payload. (v5.x recorded 1,117,435 for the same
reason.)

### The same submission on a course WITH a key

Same two photographs, same crops, same pixels — only the course key differs.

| bytes | entry | plain equivalent |
|---:|---|---:|
| 3,284 | `ENG17_Homework_1_submission_{timestamp}.json` | 2,728 |
| 40,982 | `crops/p1a.jpg.gb2` | 40,696 |
| 38,571 | `crops/p1b.jpg.gb2` | 38,285 |
| 81,740 | `crops/p1c.jpg.gb2` | 81,454 |
| 474,756 | `page_1.jpg.gb2` | 474,470 |
| 501,749 | `page_2.jpg.gb2` | 501,463 |

Archive total **1,141,466 bytes, up 24,035 (+2.15%)**.

**Every image entry is larger than its plaintext by a fixed amount set by the
course key size**: the wrapped key (2 bytes of length prefix plus the RSA
modulus), a 12-byte IV and a 16-byte GCM tag.

| course key | wrapped key | + IV + tag | **overhead per entry** |
|---|---:|---:|---:|
| RSA-2048 | 258 | 28 | **286 bytes** |
| RSA-4096 | 514 | 28 | **542 bytes** |

The run tabulated above used a 2048-bit key, so five images is 1,430 bytes.
**The live ENG17 Fall course key is 4096-bit**, where the same five would be
2,710. Read the length prefix; never assume either number.
The rest of the 24,035 is not overhead in the envelope — it is **DEFLATE giving
up**: a photograph deflates by a percent or two inside the ZIP and ciphertext
deflates by nothing, so the archive loses the compression it used to get.

The payload entry grew 556 bytes: the gb2 envelope is bigger than the gb1 one
(the wrapped key rides inside it) and the payload gained the two keys of §3.

**There is no PDF.** See §5 — this is a decision, not an omission.

**It is not flat.** There is a `crops/` directory entry. An extractor that calls
`os.path.basename()` on every member — as the v3.1 snippet does — collapses
`crops/p1a.jpg` into `p1a.jpg` and silently breaks the `file` paths the payload
gives you. See §7.

### Entry kinds

On a course with **no** key — the archive above:

| pattern | count here | magic | what it is |
|---|---|---|---|
| `*_submission.json` | 1 | `67 62 31 3a` (`gb1:`) | the payload, §3 |
| `crops/{region_id}.jpg` | 3 | `ff d8 ff e0` | **the grader's input**, §4 |
| `page_{n}.jpg` | 2 | `ff d8 ff e0` | **retained, not consumed**, §4 |

On a course **with** a key, every image entry takes a `.gb2` suffix and the
JPEG magic moves inside the envelope:

| pattern | count here | first bytes | what it is |
|---|---|---|---|
| `*_submission.json` | 1 | `67 62 32 3a` (`gb2:`) | the payload, §3 |
| `crops/{region_id}.jpg.gb2` | 3 | `01 00` | a sealed crop, §4.2 |
| `page_{n}.jpg.gb2` | 2 | `01 00` | a sealed page, §4.2 |
| `*_submission.pdf.gb2` | 0 here | `01 00` | a sealed PDF — **electronic only**, §5 |
| `p{i}s{j}_image_{n}.jpg.gb2` | 0 here | `01 00` | a sealed image answer — electronic only |

`01 00` is `wrappedKeyLen` — 256, big-endian, for the RSA-2048 test key; a
4096-bit course key makes it `02 00`. **Do not identify a sealed entry by those
bytes.** The payload's `encrypted_entries` (§3) is the list, and the `.gb2`
suffix is the human-readable half of the same statement.

**A file that is not a JPEG is not named `.jpg`.** The suffix is appended rather
than replacing the extension, so `page_1.jpg.gb2` still says what comes out of
the envelope.

**Consumed is not the same as retained.** The crops are the interface; the page
images are the record of what the student photographed, kept so a dispute can be
adjudicated. Do not feed the pages to a grader. §4 says why both exist.

**No `*_submission.pdf`** on the handwritten path. §5.

**Not present in this archive, and declared by the app rather than observed:**
`p{i}s{j}_image_{n}.jpg` at the archive root, written only for an *electronic*
assignment's `Image` or `Text and Image` parts. A handwritten submission has
none. **These are sealed too** on a course with a key — `p0s1_image_0.jpg.gb2` —
and that path is covered by `tests/package-encryption-tests.mjs` rather than by
an archive on disk.

**The electronic `*_submission.pdf` is sealed too**, as `{stem}.pdf.gb2`, and is
listed in `encrypted_entries` like everything else. It is written in the same
position it always was — immediately after the payload, before the images — so
the archive order a consumer has always seen is unchanged.

`{n}` in `page_{n}.jpg` is **the position in the ZIP, counting from 1**. It is
not the page of the sheet. See §4.

---

## 2. Do not assume every file is there

The observed archive is a **partial submission**: 2 pages of a 16-page sheet, 3
regions of 17. This is not a degraded case to be handled defensively — it is a
student part-way through, and the app packages it deliberately and without
complaint.

So:

- **A region absent from `crops` is a region the student has not reached.** Not
  an error, not a missing file. Award it what an unattempted part gets.
- **A page absent from `pages` was never photographed.**
- There is no field anywhere that says "this submission is complete", because the
  app does not know and does not ask.

---

## 3. The payload

### Envelope

The JSON entry is **not** JSON on disk. It is a text file beginning with a
four-character envelope tag.

| observed | `gb1:` |
|---|---|
| meaning | AES-256-GCM, the shared key already in the autograder |
| alternative | `gb2:` — used when the assignment spec carries a `coursePublicKey`. The ENG17 spec carries none, so the archive of §1 is gb1; the sealed archive in §1 is the same submission with a test key. A spec that asks for gb2 never downgrades to gb1. |

Read the first four characters and branch. Do not assume `gb1:`.

**The envelope tag is on the JSON entry only.** An image entry is the envelope
itself, starting at `wrappedKeyLen`, with no tag and no base64 — see §4.2 for
why. Branch on the payload's `image_encryption`, not on a file's first bytes.

**Neither payload carries an identity field**, and neither do the filenames.
Since v5.0 the app emits no `student_name` at all, and `gb2:` additionally strips
that key and three others on the way out — belt and braces rather than the
mechanism. Identity is the authenticated upload, not anything in the archive.

### Decrypted structure — all nine top-level keys, as observed

```json
{
  "course_code":    "ENG17",
  "assignment_id":  "ENG17_Homework_1",
  "ai_feedback":    false,
  "submission_data": { "p0s0": { "answer": null, "images_submitted": 0 }, … },
  "last_saved":     "2026-09-03T05:27:36.837Z",
  "input_mode":     "handwritten",
  "layout_id":      "95438EDF",
  "pages":          [ … ],
  "crops":          { … }
}
```

| key | type | note |
|---|---|---|
| ~~`student_name`~~ | — | **REMOVED in v5.0. The key is absent.** Do not read it, and do not fall back to `""` — there is nothing to fall back from. Identity is Gradescope's authenticated submitter. |
| `course_code` | string | |
| `assignment_id` | string | `{courseCode}_{title with spaces → _}`. **Not** the `assignment_id` in `layout_*.csv`, which is `ENG17HOM496F`. Two different identifiers; do not join on this one. |
| `pdf_filename` | string | **Electronic only.** Absent from a handwritten payload, because a handwritten archive has no PDF and a field naming a file that is not there is a defect rather than a courtesy. Do not index it unconditionally. **On a sealed course it ends `.pdf.gb2`** and appears in `encrypted_entries`: it names the entry, not the file that comes out of it. |
| `ai_feedback` | boolean | Always a real boolean, never absent, so "off" is never confusable with an older app version. |
| `submission_data` | object | §3.1 |
| `last_saved` | string | ISO 8601, UTC. |
| `input_mode` | string | `"handwritten"` observed. **Absent entirely on an electronic assignment** — its absence is the signal, so test for presence rather than for a value. |
| `layout_id` | string | The map the app recomputed. Must equal the `layout_id` in every page's QR; the app refuses to crop when it does not. |
| `pages` | array | §3.2. Handwritten only. |
| `crops` | object | §3.3. Handwritten only. |
| `image_encryption` | string | **Added v6.0.** `"gb2"`, and only ever that today. **Absent when the course has no key** — absent, not `null` and not `"none"`, so test for presence. Both paths carry it: an electronic assignment's image answers are sealed too. |
| `encrypted_entries` | array | **Added v6.0.** Every sealed entry name, in archive order — `["page_1.jpg.gb2", …, "crops/p1a.jpg.gb2", …]`. Absent when the course has no key. **It lists what was actually written**, so a partial submission's list is short rather than wrong: a page the app could not read from its own store is in neither the archive nor this list. |

The `file` field of every `pages[]` and `crops` entry **names the entry as it
appears in the archive**, so on a sealed course it ends `.gb2`. Open what the
payload names; never reconstruct a name by appending or stripping a suffix.

`input_mode`, `layout_id`, `pages` and `crops` are written **only** when the
assignment is handwritten, and `image_encryption` / `encrypted_entries` only
when the course has a key; an electronic payload with no key carries the other
**six** keys
— `course_code`, `assignment_id`, `pdf_filename`, `ai_feedback`,
`submission_data`, `last_saved` — and none of these four. Measured on a real
electronic build, not counted off this table. See §8 for the one key that has been added since v3.1.

### 3.1 `submission_data` — read this, then ignore it

Seventeen entries observed, `p0s0` `p0s1` `p0s2` `p0s3` `p1s0` `p1s1` `p1s2`
`p2s0` `p2s1` `p2s2` `p3s0` `p4s0` `p5s0` `p6s0` `p7s0` `p8s0` `p9s0`. Every one
of them:

```json
{ "answer": null, "images_submitted": 0 }
```

**This is correct for a handwritten submission and it looks exactly like an empty
one.** The answers are images, and they are in `crops`. The keys here are
`p{problem}s{subsection}` positions in the *spec*; they do not correspond to
`region_id` and cannot be joined to it.

On an electronic assignment this object is the whole submission and behaves as
v3.1 described.

### 3.2 `pages` — both entries, verbatim

```json
[
  { "file": "page_1.jpg", "width": 1650, "height": 2200,
    "k": 2, "n": 16, "registration": "ok",
    "marks_found": 4, "marks_detected": ["NW", "NE", "SW", "SE"],
    "marks_declined": [], "residual_mm": 0.4958780733592441, "held_out_mm": 0 },
  { "file": "page_2.jpg", "width": 1650, "height": 2200,
    "k": 3, "n": 16, "registration": "ok",
    "marks_found": 4, "marks_detected": ["NW", "NE", "SW", "SE"],
    "marks_declined": [], "residual_mm": 0.34332017809218907, "held_out_mm": 0 }
]
```

| field | note |
|---|---|
| `file` | Entry name in this archive. `page_1.jpg.gb2` on a sealed course. |
| `width`, `height` | Pixels of the **stored** image, after the app's ingest. |
| `k`, `n` | Page number and page count **read from that page's own QR**, never from upload order. |
| `registration` | `"ok"` observed. `"degraded"` (a three-mark affine fit, crops may be slightly off) is declared but **not observed here**. |
| `marks_found` | 4 observed. Since 2026-09-02 a page may legitimately register on **3**: the capture gate accepts a three-mark fit that meets the same 1.0 mm residual budget as a four-mark one. Such a page reads `"registration": "degraded"`. |
| `marks_detected` | **Added 2026-09-02.** Which of `NW`, `NE`, `SW`, `SE` the fit was built on, in that order. `[]` when nothing fitted. On a `degraded` page the absent corner names the end of the sheet the transform **inferred rather than measured**, which is where to look first if a crop from that page is disputed. `marks_found` is this array's length. |
| `marks_declined` | **Added 2026-09-02.** Corners where a mark **was detected and the chosen fit did not use it**. `[]` observed, and `[]` on every capture in the set. **This is not the complement of `marks_detected`:** a corner in neither list was never found, and a corner here was found, measured and set aside. Only the second means the app had better information about that end of the sheet than it used. |
| `residual_mm` | QR reprojection error. Full float precision; do not expect it rounded. |
| `held_out_mm` | **Added 2026-09-02.** Worst error, in millimetres, at a mark named in `marks_declined`. `0` observed, and `0` whenever `marks_declined` is empty. `residual_mm` is measured at the QR, which is one point in the NE corner; this is measured at the marks the fit threw away. A page with a small `residual_mm` and a large `held_out_mm` is a fit that has tilted itself to satisfy the symbol. |

**`page_1.jpg` is page 2 of the sheet.** The filename counts position in the ZIP;
`k` counts position on the paper. Always use `k`.

### 3.3 `crops` — all three, verbatim

```json
{
  "p1a": { "region_id": "p1a", "part_id": "1(a)", "page_k": 2,
           "is_drawing": false, "max_points": 5,
           "crop_source": "registration", "student_review": "signed_off",
           "quality_flags": [],
           "file": "crops/p1a.jpg", "width": 842, "height": 542 },
  "p1b": { …, "part_id": "1(b)", "page_k": 3, "file": "crops/p1b.jpg",
           "width": 1033, "height": 324 },
  "p1c": { …, "part_id": "1(c)", "page_k": 3, "file": "crops/p1c.jpg",
           "width": 1095, "height": 602 }
}
```

Keyed by `region_id`. Every label a grader needs is on the row — nothing is
parsed out of `region_id`, which is opaque and must stay so.

| field | observed | note |
|---|---|---|
| `region_id` | `p1a` `p1b` `p1c` | Opaque. Do not parse. |
| `part_id` | `1(a)` `1(b)` `1(c)` | The human label. Display this. |
| `page_k` | 2, 3 | Which sheet page it was cut from. |
| `is_drawing` | `false` | What the **author** asked for. See §6. |
| `max_points` | 5 | From the map. |
| `crop_source` | `registration` | Cut from a declared rectangle on a registered page. `direct_capture` — the student framed the answer themselves, no rectangle, no registration, framing is theirs — is declared but **not observed here**. Do not assume `registration`. |
| `student_review` | `signed_off` | What the student said after looking at it. `flagged` and `not_reviewed` are declared but **not observed here**. |
| `quality_flags` | `[]` | Advisory, never blocks. `looks-empty` is the only flag the app now emits and is **not observed here**. `low-resolution` was retired on 2026-09-03 and is never emitted again — see §6. |
| `file` | `crops/p1a.jpg` | Path **including the `crops/` prefix**, and including the `.gb2` suffix on a sealed course. Use it as given. |
| `width`, `height` | see above | Pixels. |

---

## 4. The images

### 4.1 On a sealed course they are not JPEGs

Everything in §4.2 through §4.4 describes the JPEG that comes **out** of the
envelope. On a course with a key the entry on disk is the envelope; decrypt
first, then everything below applies unchanged — the pixels, the dimensions and
the bytes are identical to what a course with no key ships. That is asserted on
every entry of a sixteen-page run, not argued: §4.3.

**The electronic PDF goes through the identical envelope**, and what comes out
of it begins `%PDF`. Nothing in §4.2 is specific to an image; the section is
named for images because that is what the handwritten archive contains.

### 4.2 The envelope on an image entry

```
wrappedKeyLen[uint16 BE] | wrappedKey | iv[12] | ciphertext+tag
```

**Byte for byte the same envelope as the payload**, and the same for every
sealed entry — page, crop, image answer, PDF. That is the point: this is the
format the autograder already decrypts. Two differences from the JSON entry,
both about packaging rather than cryptography:

- **No `gb2:` tag and no base64.** The JSON entry is text, so it is tagged and
  base64'd; an image entry is a raw byte stream in a ZIP. Base64 would have
  added a third to a multi-megabyte archive for nothing. **Parse from offset 0.**
- **The result is JPEG bytes** — or PDF bytes for `{stem}.pdf.gb2` — **not
  JSON.** Do not `json.loads` it.

**One content key per file**, freshly generated, RSA-OAEP-wrapped with the course
public key (SHA-256, MGF1-SHA256, empty label) — exactly as for the payload. An
earlier draft of this change shared one content key across the submission to save
sixteen RSA operations; it was withdrawn, because it would be a second format for
this autograder to implement and seventeen RSA-2048 unwraps cost a few
milliseconds. **Sixteen page entries therefore carry sixteen different wrapped
keys, and that is correct, not a bug.**

**A fresh 12-byte IV per file**, from the platform CSPRNG. Asserted distinct
across all 33 entries of the sixteen-page run.

**Overhead per file: exactly 286 bytes with an RSA-2048 course key, exactly 542
with an RSA-4096 one** — wrapped key 258 or 514 (2-byte length prefix plus the
modulus), 12 IV, 16 GCM tag. Measured on every entry, not computed. **The live
ENG17 Fall course key is 4096-bit, so 542 is the number in production**; the
worked example below and the §1 table were both measured at 2048.

Worked example, from `crops/p1a.jpg.gb2` in §1 — 40,982 bytes on disk, 40,696
bytes of JPEG:

| offset | length | what |
|---:|---:|---|
| 0 | 2 | `01 00` — `wrappedKeyLen` = 256 |
| 2 | 256 | the wrapped content key |
| 258 | 12 | the IV |
| 270 | 40,712 | ciphertext (40,696) followed by the 16-byte tag |

§10 is the code.

### 4.3 What sealing costs, measured

Two runs, both real, and they disagree by a lot for a reason worth knowing.

| run | sealed entries | plain archive | sealed archive | delta |
|---|---:|---:|---:|---:|
| two phone photographs, 3 crops (§1) | 5 | 1,117,431 | 1,141,466 | **+24,035 (+2.15%)** |
| electronic: a real app-built PDF + 1 image answer | 2 | 962,660 | 985,880 | **+23,220 (+2.41%)** |
| sixteen RENDERED pages, 17 crops | 33 | 2,594,920 | 4,998,140 | +2,403,220 (+92.6%) |

**The second number is an artefact of the fixture and must not be quoted as the
cost.** Those sixteen pages are rendered from the assignment PDF rather than
photographed, and a render deflates to **51.9%** of its size inside the ZIP.
Ciphertext deflates to 100%. So sealing does not add 2.4 MB — it stops DEFLATE
removing 2.4 MB that a real photograph never offers in the first place. A phone
photograph is already entropy-dense, which is why the honest measurement is the
first row: **about 2%, plus the per-entry overhead — 286 bytes a file at
RSA-2048, 542 at RSA-4096.**

**The electronic row measures the same effect and lands in the same place.** The
PDF the app builds is `jsPDF` over `html2canvas` rasters — 979,728 bytes that
DEFLATE only to **98.1%** — so sealing it costs its one entry's overhead (286
bytes at RSA-2048, 542 at RSA-4096) and the 1.9% the
ZIP was getting. **This is a property of that PDF, not of PDFs.** The ENG17
*assignment* PDF, which is vector text, deflates to **61.9%**, and sealing a PDF
like that would cost **+62%** of the archive. If the submission PDF ever becomes
vector rather than raster, re-measure this row before quoting it.

**Time and memory**, on the sixteen-page run: the encryption step took **24, 26
and 38 ms** across three runs, for 4.7 MB of image bytes and 33 RSA-2048 wraps —
**125 to 200 MB/s**, the spread being what a laptop does, not what the algorithm
does. A full ~9 MB photographic submission is therefore well under a fifth of a
second, and the prediction that WebCrypto would be fast enough is confirmed
rather than assumed. Those 33 wraps live inside that same figure, which is why
the per-file content key of §4.2 cost nothing worth trading a second format for.
Peak RSS was **387 to 393 MB** across both builds, against **395 MB** for the
plain build alone: sealing did not move it, because the work is one entry at a
time and the archive is already held. (Archive totals move a byte or two between
runs — the payload carries a timestamp.)

### 4.4 The crops — measured off this archive

| region | pixels | declared rectangle | mm per pixel | px per mm | ink | bytes |
|---|---|---|---|---|---|---|
| p1a | 842 × 542 | 191.2 × 123.0 mm | 0.2271 | 4.40 | 0.48% | 40,696 |
| p1b | 1033 × 324 | 191.2 × 60.0 mm | 0.1851 | 5.40 | 0.98% | 38,285 |
| p1c | 1095 × 602 | 191.2 × 105.0 mm | 0.1746 | 5.73 | 0.97% | 81,454 |

Pixels × mm-per-pixel reproduces each declared rectangle to within **0.1 mm**, so
a crop covers the rectangle the map declares and nothing else. JPEG, quality 0.9,
never upsampled past the resolution the photograph actually had.

**One caveat on the byte sizes.** The app encodes its JPEGs with the browser's
canvas; the harness that produced this archive cannot, so it used `jpeg-js` at the
same quality. Same format, same pixels, same dimensions — but **an archive
produced by a browser will have slightly different byte sizes**. Treat the sizes
in §1 as the right order of magnitude and the dimensions, paths and fields as
exact.

**Confirmed by eye, 2026-09-01**: each crop lands on its own region, correctly
rectified, with the right handwriting in it; `p1b` and `p1c` are not swapped
(aspect ratios 0.314 and 0.550 against declared 0.3138 and 0.5492).

### 4.5 The page photographs — retained, not consumed

`page_1.jpg`, `page_2.jpg` — 1650 × 2200 each, the student's own pictures after
the app's ingest (EXIF-uprighted, long edge stepped to 2200 px, JPEG 0.85).

**These are not a grader input and must not be treated as one.** They are kept
for one reason: **a crop is a derived artefact.** It depends on the layout map
being right and on the homography being right for that page. If either is wrong,
or a student says "I wrote it and the tool cut it off", the page image is the
only thing that can settle it — and once discarded, that evidence does not come
back.

So they are what a dispute is adjudicated against. Roughly 0.5 MB per page, about
8 MB for a full sixteen-page HW1; cheap for what it buys.

Do not run a reading pass over them. §6 says why.

---

## 5. There is no PDF

**A handwritten submission carries no PDF.** Decision of 2026-09-01,
`GradeBridge2026\workorders\DECISION_PACKAGE_CONTENTS_2026-09-01.md`. The
electronic path still carries one and is unchanged.

Until that decision the archive held a `*_submission.pdf`, and it was **the blank
question paper**: `PrintView` receives only `assignment`, `submissionData` and
`studentName` — never `pages` or `crops` — so a handwritten submission's PDF was
the electronic answer-sheet render with every answer empty.

The obvious fix was to fill it with the student's photographs. That is not what
was decided, and the reasoning is worth carrying because it applies again the
next time something in this archive has no reader:

- **Nothing consumes it.** On the autograder path Gradescope does not render it.
- **It was roughly half the archive.** 0.98 MB of 2.08 MB. Removing it took the
  observed package from 2,079,104 bytes to **1,117,339**.
- **It duplicated `page_N.jpg`**, which is kept.
- **A blank PDF that nobody is supposed to read is worse than no PDF**, because
  sooner or later somebody opens it and concludes the student submitted nothing.

Removing a thing that can be wrong beats maintaining a second copy of something
already kept.

**The electronic path still carries one, and since v6.0 it is sealed** on a
course with a key: `{stem}.pdf.gb2`, in `encrypted_entries`, `pdf_filename`
naming it. It rendered the same typed answers the payload encrypts, which made
it the one remaining entry that handed over in the clear what the envelope beside
it protected.

**Consequences for a reader:**

- Do not look for a PDF in a handwritten archive, and do not treat its absence as
  a malformed submission.
- `pdf_filename` is **absent from a handwritten payload**. Indexing it
  unconditionally raises. Test `input_mode` first.
- If a human grader needs to see the whole page, `page_N.jpg` is that, at full
  ingest resolution.

---

## 6. How to read a crop

Three findings from the visual inspection of this archive. Each is a real
observation, not a precaution.

**`is_drawing` does not predict what the answer looks like.** `p1c` is declared
`is_drawing: false` and the student answered it with drawn circuit fragments. The
field says what the *author* asked for, not what the *student* did. Do not route
on it as though it forecast prose, and do not treat a drawing found under
`is_drawing: false` as an error.

**Some crops are genuinely unreadable, and the assist must say so.** `p1a` is
faint pencil and partly illegible **to a person**. An assist that guesses at faint
pencil produces a confident wrong transcription, which is worse than returning
nothing: the next person to notice is a student disputing a mark on work they did
correctly. Make "cannot read this" a first-class outcome that reaches a human.

**Page-level OCR is unnecessary.** The crops are clean enough to work from
directly. Running OCR across a whole page and then attributing text back to
regions reintroduces exactly the attribution problem the declared rectangles have
already solved, and it is the step most likely to put one part's answer under
another part's mark.

On `low-resolution`: **retired 2026-09-03, never emitted again.** Until then
every crop in this archive carried it, which was structural rather than a comment
on these photographs — the flag fired below 150 dpi and the app's ingest caps the
long edge at 2200 px, so even `cap11`, the cleanest capture in the set at 0.34 mm
residual, tripped it.

It was retired because it was measured and found false. The OCR triage of 23 real
crops caught all four of its firings and **every one of those crops read
completely**. The controlled pair: `android09_p3_angle__p1b` at **118 dpi** and
`android10_p3_dim__p1b` at **194 dpi** are the same answer region, and 65% more
linear resolution changed nothing about the reading. On two of the four the flag
was actively harmful — it reported an image-quality problem when the real problem
was that the writer had worked outside the box, sending the student to reshoot a
page that was never the issue.

**`px_per_mm` is unaffected and stays.** The measurement was real; the threshold
on it was not. Use it directly if you want to reason about a crop's resolution.

---

## 7. Extraction

Replace the v3.1 snippet. It filters to `.json` and `.pdf`, which drops every
image, and it flattens with `basename()`, which breaks `crops/…` paths.

```python
import os, zipfile, glob

SUBMISSION_DIR = '/autograder/submission/'

def _safe_join(base, member):
    """Resolve a ZIP member under base, or return None if it escapes."""
    target = os.path.realpath(os.path.join(base, member))
    if os.path.commonpath([os.path.realpath(base), target]) != os.path.realpath(base):
        return None                      # path traversal — refuse it
    return target

for archive in glob.glob(os.path.join(SUBMISSION_DIR, '*.zip')):
    with zipfile.ZipFile(archive) as z:
        for member in z.namelist():
            if member.endswith('/'):
                continue                 # directory entry, e.g. "crops/"
            target = _safe_join(SUBMISSION_DIR, member)
            if target is None:
                continue
            os.makedirs(os.path.dirname(target), exist_ok=True)
            with z.open(member) as src, open(target, 'wb') as dst:
                dst.write(src.read())
```

**Keep the directory structure.** `crops/p1a.jpg` must land at `crops/p1a.jpg`,
because that is the string the payload's `file` field gives you. Path traversal
is still refused, by containment rather than by flattening.

Then:

```python
payload = decrypt(open(glob.glob(SUBMISSION_DIR + '*_submission.json')[0]).read())

# v6.0: on a course with a key every image entry AND the electronic PDF is a
# gb2 envelope over the raw bytes. `crop['file']` and `payload['pdf_filename']`
# already name the entry as it is — 'crops/p1a.jpg.gb2' — so nothing here
# appends or strips a suffix.
sealed = payload.get('image_encryption') == 'gb2'

def entry_bytes(entry):
    raw = open(os.path.join(SUBMISSION_DIR, entry), 'rb').read()
    return decrypt_gb2_bytes(raw) if sealed else raw     # §10

if payload.get('input_mode') == 'handwritten':
    for region_id, crop in payload['crops'].items():
        jpeg = entry_bytes(crop['file'])
        # crop['part_id']      -> the label a human recognises
        # crop['max_points']   -> from the map
        # crop['page_k']       -> which sheet page
        # crop['student_review'], crop['quality_flags'] -> advisory only
else:
    pdf = entry_bytes(payload['pdf_filename'])   # '{stem}.pdf.gb2' when sealed
    ...                                          # v3.1 behaviour otherwise
```

`payload['encrypted_entries']` is the same statement as a list, for a consumer
that would rather check the archive against the payload than trust a suffix.
**Driving the loop off that list rather than off filenames is why the PDF cost
its reader nothing:** it simply appeared in the list one day.

---

## 8. Backward compatibility

Unchanged from v3.1, and still true:

| student uploads | behaviour |
|---|---|
| `submission.zip`, electronic | Extracts, `input_mode` absent, grade from `submission_data` exactly as before |
| `submission.zip`, handwritten | Extracts, `input_mode == "handwritten"`, grade from `crops`. **No PDF, and no `pdf_filename`** |
| `submission.json` + `submission.pdf` (v3.0) | No ZIP found, proceeds as before |
| any of the above from a course **with a key** | The payload is `gb2:` and every image entry is sealed. **Needs the course private key, which the same course's autograder image already carries for the payload.** v6.0 |

Nothing in this document changes the electronic path: `input_mode`, `layout_id`,
`pages` and `crops` are written only for a handwritten assignment, and an
electronic payload is untouched by the handwritten work.

It is **not** identical to April's, though, and v3.1's "all downstream file
formats are unchanged" has quietly expired in one more place: `ai_feedback` was
added to every payload on 2026-08-18. It is always present and always a real
boolean. If the autograder validates the payload against a fixed key set, that
key has to be in it.

---

## 9. What this document does not cover

- **`grading_rubric.json`** — unchanged, and it is the file that carries
  `answer_modality`, `problem_statement` and the grading prompts. It reaches the
  autograder by its own route and never travels in a student's ZIP.
- **`results.json`** — unchanged.
- **The decryption keys** — unchanged; `gb1:` uses the shared AES-256-GCM key
  already in the image, and `gb2:` the course private key installed at
  `/etc/gradebridge/course_private_key.pem` (or `GB2_PRIVATE_KEY_PEM` /
  `GB2_PRIVATE_KEY_PATH`). **v6.0 does not introduce a key, a key format or a
  key path** — it uses the one that is already there for one more thing.
- **Key generation and custody** — unchanged, and settled in
  `Encryption/GB2_KEY_MANAGEMENT_DECISION_2026-08-10.md`: the autograder author
  generates the pair per offering with `Encryption/gen_course_keypair.py`, keeps
  the private half in that course's image, and sends the instructor only the
  public half.
- **Anything about how to grade.** This document says what is in the box.

### One thing to check on arrival

The payload must contain **no answer-key material**: no `aiGradingPrompt`, no
`grading_prompt`, no `REFERENCE:` text, no `graderNote`, no rubric. That was
verified on this archive and on the `assignment_spec.json` the student loads,
both clean. It is worth re-checking on the first real submission, because a spec
carrying grading prompts shipped to students once already — see
`GradeBridge2026/CLAUDE.md`, Recent Changes 2026-08-31.

---

## 10. Opening a sealed submission by hand

**A person holding the course private key must still be able to look at a page.**
That is not a nicety: §4.5 keeps the page photographs for exactly one purpose,
settling "I wrote it and the tool cut it off", and v6.0 removes the ability to
do that by double-clicking. **Adjudication now requires the private key.** An
instructor discovering that in the middle of a grade dispute is the failure this
section exists to prevent.

Where such a tool lives — inside the autograder repository or beside it — is the
autograder author's call. What follows is the contract it has to implement.

### The order of operations

1. Read the payload entry, `*_submission.json`. Its first four bytes say `gb2:`;
   base64-decode the rest into the envelope.
2. Unwrap: `RSA-OAEP(SHA-256, MGF1-SHA-256, empty label)` over `wrappedKey` with
   the course private key gives 32 bytes — the content key for **that entry**.
3. `AES-256-GCM` decrypt `ciphertext+tag` under that key and `iv`, no AAD. The
   result is UTF-8 JSON.
4. If `image_encryption == "gb2"`, every name in `encrypted_entries` is an
   envelope on disk — the pages, the crops, an electronic assignment's image
   answers, and its PDF. Repeat 2 and 3 **per entry, starting at offset 0** — no
   base64, no tag to strip — and the result is the original bytes, JPEG or PDF.
   Each entry has its own content key and its own IV; nothing is shared, and
   nothing is cached between entries.

   **The key name says `image_encryption` and it covers the PDF as well.** The
   name is narrower than the fact and was kept on purpose: it had already been
   circulated, and renaming a key to improve an adjective breaks a consumer for
   nothing. `entry_encryption` is the better name if it is ever worth one
   coordinated change.
5. Write them out under the same names without `.gb2` and open them normally.

### Reference

```python
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

def decrypt_gb2_bytes(raw: bytes, private_key) -> bytes:
    """Open one gb2 envelope over raw bytes. The image half of crypto_utils.

    Identical to _decrypt_gb2() except that it takes bytes rather than a
    'gb2:'-tagged base64 string, and returns bytes rather than json.loads().
    """
    wrapped_len = int.from_bytes(raw[0:2], 'big')
    if len(raw) < 2 + wrapped_len + 12 + 16:
        raise ValueError('gb2: envelope too short')
    wrapped     = raw[2:2 + wrapped_len]
    iv          = raw[2 + wrapped_len:2 + wrapped_len + 12]
    ct_and_tag  = raw[2 + wrapped_len + 12:]

    content_key = private_key.decrypt(wrapped, padding.OAEP(
        mgf=padding.MGF1(algorithm=hashes.SHA256()),
        algorithm=hashes.SHA256(), label=None))
    return AESGCM(content_key).decrypt(iv, ct_and_tag, None)
```

`AESGCM.decrypt` raises `InvalidTag` on a tampered or truncated entry. **Let it
raise.** A crop that fails authentication is not a crop to grade leniently; it is
an archive to escalate.

### Worked numbers to check an implementation against

From `crops/p1a.jpg.gb2` in §1, with an RSA-2048 key:

```
len(raw)              40,982
raw[0:2]              01 00            -> wrapped_len = 256
raw[2:258]            wrapped content key
raw[258:270]          iv, 12 bytes
raw[270:]             40,712 bytes = 40,696 ciphertext + 16 tag
len(plaintext)        40,696           -> starts ff d8 ff e0 (JPEG)
len(raw) - len(plain) 286              -> 258 + 12 + 16, on every entry
```

A 4096-bit course key changes `wrapped_len` to 512 and the overhead to 542. Read
the length; never assume it.

### What the student app can and cannot do

The app **encodes only**. It holds no private key, generates none, and cannot
open anything it has written — asserted in
`tests/package-encryption-tests.mjs` §5, which fails if `cryptoService.ts` ever
grows PKCS#8 material or a decrypt on the gb2 path. A student's browser cannot
read another student's submission, and cannot read its own.

---

## Provenance

Every number, filename and value above was read out of
`ENG17_Homework_1_submission_{timestamp}.zip`. Regenerate it with `npm run milestone:zero`
in `GradeBridge-Student-Submission`; the harness re-derives the whole package from
the assignment export and two photographs, and prints the manifest, the decrypted
payload and the crop measurements — and, since v6.0, the same package sealed with
a keypair it generates for the run, its manifest beside the plain one and every
entry decrypted and compared byte for byte.

The §4.3 scale numbers come from `FULL_PAGES=… npm run full:assignment`, which
does the same over sixteen pages and seventeen regions and reports the archive
sizes, the encryption wall clock and peak RSS.

Full report on how the package was produced, including §6's `low-resolution`,
which is still open:
the harness output itself; re-run `npm run milestone:zero` to reproduce it.
