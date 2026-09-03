# GradeBridge — submission ZIP interface

**Version:** v5.0
**Date:** 2026-09-03

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

**Supersedes:** v4.3, earlier the same day
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
GradeBridge2026\CaptureSet\milestone_zero\ENG17_Homework_1_submission_20260903-0303.zip
```

re-emitted on 2026-09-02 with `marks_detected` (every other entry byte-identical
to the 2026-09-01 archive this document was first written from), by
`GradeBridge-Student-Submission/tests/milestone-zero.mjs`
(`npm run milestone:zero`), from ENG17 Homework 1 (`layout_id` **95438EDF**) and
two phone photographs. Its three crops were inspected by eye and confirmed to
land on their own regions with the right handwriting in each. Where this document
states something that archive does not contain, it says so explicitly.

**Nothing here is aspirational.** If a statement is not marked as unobserved, it
came off that ZIP.

---

## 1. The archive

One file, uploaded to Gradescope:

```
{StudentName}_{CourseCode}_submission.zip
```

Sanitised with `[^a-z0-9_\-] → _`. The stem is
`{assignment_id}_submission_{YYYYMMDD-HHMM}` — no name, because the app does not
have one, and a timestamp because without a discriminator every student in a
class downloads an identically named file. The timestamp is `last_saved` in
**UTC**. DEFLATE, level 6.

### Observed manifest

| bytes | entry |
|---:|---|
| 2,728 | `ENG17_Homework_1_submission_20260903-0303.json` |
| 40,696 | `crops/p1a.jpg` |
| 38,285 | `crops/p1b.jpg` |
| 81,454 | `crops/p1c.jpg` |
| 474,470 | `page_1.jpg` |
| 501,463 | `page_2.jpg` |

Archive total 1,117,435 bytes. The six entries are byte-identical between runs of
the same inputs; the total moves a byte or two because `last_saved` is a
timestamp inside the encrypted payload.

**There is no PDF.** See §5 — this is a decision, not an omission.

**It is not flat.** There is a `crops/` directory entry. An extractor that calls
`os.path.basename()` on every member — as the v3.1 snippet does — collapses
`crops/p1a.jpg` into `p1a.jpg` and silently breaks the `file` paths the payload
gives you. See §7.

### Entry kinds

| pattern | count here | magic | what it is |
|---|---|---|---|
| `*_submission.json` | 1 | `67 62 31 3a` (`gb1:`) | the payload, §3 |
| `crops/{region_id}.jpg` | 3 | `ff d8 ff e0` | **the grader's input**, §4 |
| `page_{n}.jpg` | 2 | `ff d8 ff e0` | **retained, not consumed**, §4 |

**Consumed is not the same as retained.** The crops are the interface; the page
images are the record of what the student photographed, kept so a dispute can be
adjudicated. Do not feed the pages to a grader. §4 says why both exist.

**No `*_submission.pdf`** on the handwritten path. §5.

**Not present in this archive, and declared by the app rather than observed:**
`p{i}s{j}_image_{n}.jpg` at the archive root, written only for an *electronic*
assignment's `Image` or `Text and Image` parts. A handwritten submission has
none.

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
| alternative | `gb2:` — used when the assignment spec carries a `coursePublicKey`. **Not observed here**; the ENG17 spec carries none. A spec that asks for gb2 never downgrades to gb1. |

Read the first four characters and branch. Do not assume `gb1:`.

A `gb2:` payload is **de-identified**: identity comes from Gradescope's
authenticated submitter metadata, not from the payload. The archive's filenames
keep the student's name in both cases.

### Decrypted structure — all nine top-level keys, as observed

```json
{
  "course_code":    "ENG17",
  "assignment_id":  "ENG17_Homework_1",
  "ai_feedback":    false,
  "submission_data": { "p0s0": { "answer": null, "images_submitted": 0 }, … },
  "last_saved":     "2026-09-03T03:03:00.000Z",
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
| `pdf_filename` | string | **Electronic only.** Absent from a handwritten payload, because a handwritten archive has no PDF and a field naming a file that is not there is a defect rather than a courtesy. Do not index it unconditionally. |
| `ai_feedback` | boolean | Always a real boolean, never absent, so "off" is never confusable with an older app version. |
| `submission_data` | object | §3.1 |
| `last_saved` | string | ISO 8601, UTC. |
| `input_mode` | string | `"handwritten"` observed. **Absent entirely on an electronic assignment** — its absence is the signal, so test for presence rather than for a value. |
| `layout_id` | string | The map the app recomputed. Must equal the `layout_id` in every page's QR; the app refuses to crop when it does not. |
| `pages` | array | §3.2. Handwritten only. |
| `crops` | object | §3.3. Handwritten only. |

`input_mode`, `layout_id`, `pages` and `crops` are written **only** when the
assignment is handwritten; an electronic payload carries the other seven keys and
none of these four. See §8 for the one key that has been added since v3.1.

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
| `file` | Entry name in this archive. |
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
| `file` | `crops/p1a.jpg` | Path **including the `crops/` prefix**. Use it as given. |
| `width`, `height` | see above | Pixels. |

---

## 4. The images

### The crops — measured off this archive

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

### The page photographs — retained, not consumed

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

if payload.get('input_mode') == 'handwritten':
    for region_id, crop in payload['crops'].items():
        image = os.path.join(SUBMISSION_DIR, crop['file'])   # 'crops/p1a.jpg'
        # crop['part_id']      -> the label a human recognises
        # crop['max_points']   -> from the map
        # crop['page_k']       -> which sheet page
        # crop['student_review'], crop['quality_flags'] -> advisory only
else:
    ...                                   # v3.1 behaviour, unchanged
```

---

## 8. Backward compatibility

Unchanged from v3.1, and still true:

| student uploads | behaviour |
|---|---|
| `submission.zip`, electronic | Extracts, `input_mode` absent, grade from `submission_data` exactly as before |
| `submission.zip`, handwritten | Extracts, `input_mode == "handwritten"`, grade from `crops`. **No PDF, and no `pdf_filename`** |
| `submission.json` + `submission.pdf` (v3.0) | No ZIP found, proceeds as before |

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
  already in the image.
- **Anything about how to grade.** This document says what is in the box.

### One thing to check on arrival

The payload must contain **no answer-key material**: no `aiGradingPrompt`, no
`grading_prompt`, no `REFERENCE:` text, no `graderNote`, no rubric. That was
verified on this archive and on the `assignment_spec.json` the student loads,
both clean. It is worth re-checking on the first real submission, because a spec
carrying grading prompts shipped to students once already — see
`GradeBridge2026/CLAUDE.md`, Recent Changes 2026-08-31.

---

## Provenance

Every number, filename and value above was read out of
`ENG17_Homework_1_submission_20260903-0303.zip`. Regenerate it with `npm run milestone:zero`
in `GradeBridge-Student-Submission`; the harness re-derives the whole package from
the assignment export and two photographs, and prints the manifest, the decrypted
payload and the crop measurements.

Full report on how the package was produced, including §6's `low-resolution`,
which is still open:
`GradeBridge-Student-Submission/MILESTONE_ZERO_REPORT_2026-09-01.md`.
