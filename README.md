# GradeBridge Student Submission

Complete academic assignments in your browser: type answers with LaTeX support and get a PDF, or photograph a printed sheet and get one cropped image per answer. Either way you download a single ZIP and upload it to your course's learning management system. Nothing is sent anywhere.

![Version](https://img.shields.io/badge/version-3.9.0-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)

**[Live Demo](https://bridgesuite.github.io/GradeBridge-Student-Submission/)** 

---

## The Problem

**Traditional submissions:** Inconsistent formatting, broken equations, messy PDFs that are a nightmare to grade.

**GradeBridge workflow:** Guided, structured submission forms that auto-generate perfectly formatted PDFs.

**The GradeBridge apps:**

This app handles lab reports, mini-projects, and homework:
1. **[Assignment Maker](https://github.com/BridgeSuite/GradeBridge-Assignment-Maker)** - Instructors create structured assignments
2. **Student Submission** (this app) - Students complete work and generate grading-ready PDFs

**Result:** No more "my formatting broke" excuses. Consistent submissions that make grading 50% faster.

---

## Key Features

- **100% Browser-Based** - No server, no account, no data transmission. Everything stays on your computer.
- **Auto-Save** - Work saved every second to browser storage
- **LaTeX Math Support** - Live preview with built-in cheatsheet (fractions, integrals, Greek letters, matrices)
- **Multiple Answer Types** - Text with LaTeX, image uploads, text + image combined, AI-graded responses
- **PDF generation** - output matching the instructor's template, for typed assignments
- **Images in ZIP** - Uploaded images are included as individual files in the submission ZIP so graders can see them without opening the PDF
- **Try Demo** - One-click sample assignment to explore features instantly
- **Backup & Restore** - Export/import work as JSON

---

## Quick Start

### Try It Now
1. Go to the [Live Demo](https://bridgesuite.github.io/GradeBridge-Student-Submission/)
2. Click **"Try Demo Assignment"** in the sidebar
3. Click **"LaTeX Math Help"** for math notation reference

### Complete an assignment — typed
1. Get the assignment file from your instructor
2. Click **"Upload assignment"** in the sidebar
3. Complete each problem (text / images / text+image / AI-graded response)
4. Click **"Download for Gradescope"** — downloads a single ZIP containing the submission JSON and PDF
5. Upload the ZIP file to Gradescope

The app never asks who you are, in either walkthrough. You are identified by the
authenticated upload in step 5 — see [Data and privacy](#data-and-privacy).

### Complete an assignment — handwritten
Handwritten assignments are answered on paper. You get **one file**, a zip, and
you use it twice.

1. Open the zip and print `assignment.pdf` **at 100%** — not "fit to page", which
   changes the scale and moves the corner marks the app registers against
2. Write your answers in the printed boxes
3. Load **that same zip** in the app (it holds the questions and the page geometry
   together, which is what lets the app tell a stale sheet from a current one)
4. Photograph your pages and upload them. They do not have to be in order — each
   page says which page it is, in the code printed in its top-right corner
5. **Check every answer.** The app shows you each one cut out, exactly as your
   grader will see it. Sign each off, or flag it
6. If a picture is wrong: retake the whole page, or photograph just that answer
   and hand that picture in directly. Either works
7. Click **"Download for Gradescope"** and upload the ZIP

Flagging an answer does **not** stop you submitting — the flag goes to your
grader with the picture.

### Local Development
```bash
git clone https://github.com/BridgeSuite/GradeBridge-Student-Submission.git
cd GradeBridge-Student-Submission
npm install
npm run dev
```

---

## Assignment JSON Format

Assignments are created in the **[Assignment Maker](https://github.com/BridgeSuite/GradeBridge-Assignment-Maker)**
and reach you as `assignment_spec.json`, on its own or inside the assignment zip
alongside `layout_{ID}.csv` and `assignment.pdf`. On disk it is a single
`gb1:`-prefixed string; below is what it decodes to.

**The spec carries no grading material of any kind** — no grading prompts, no
grader notes, no answer key, no reference solutions. That is not a convention
anyone has to remember: the Assignment Maker builds this file from an explicit
whitelist of the fields this app reads (`STUDENT_SPEC_FIELDS` in its
`services/exportService.ts`), so a field added for the grader is excluded by
default rather than included by accident. Grading material travels to the
autograder by its own route, in a file students never receive.

Every field below is one this app actually reads; the shape is `types.ts`.

```json
{
  "id": "a3f1c8e0-4b21-4d9a-9c77-2e5b1f0a6d34",
  "courseCode": "ENG17",
  "title": "Homework 1",
  "preamble": "Show your working. Answers without working receive no credit.",
  "createdAt": 1756944000000,
  "updatedAt": 1756944000000,
  "inputMode": "handwritten",
  "aiFeedback": false,
  "coursePublicKey": "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkq...\n-----END PUBLIC KEY-----\n",
  "problems": [
    {
      "id": "p1",
      "name": "Node Voltage",
      "description": "The circuit below is driven by 10 V.",
      "subsections": [
        {
          "id": "p1a",
          "name": "Transfer function",
          "description": "Derive the transfer function.",
          "points": 50,
          "submissionType": "Text"
        },
        {
          "id": "p1b",
          "name": "Step response",
          "description": "Plot the step response.",
          "points": 30,
          "submissionType": "Image",
          "maxImages": 2
        },
        {
          "id": "p1c",
          "name": "Reflection",
          "description": "Explain your approach.",
          "points": 20,
          "submissionType": "AI Graded: Short",
          "minWords": 50,
          "config": "half"
        }
      ]
    }
  ]
}
```

**Assignment level.** `id`, `courseCode`, `title`, `preamble`, `problems`,
`createdAt` and `updatedAt` are always present. Three are written only when the
assignment carries them, so a spec from before a field existed is byte-for-byte
what it was:

| field | meaning |
|---|---|
| `inputMode` | `"electronic"` or `"handwritten"`. Absent means electronic. |
| `aiFeedback` | Per-assignment AI-feedback flag, carried through to Gradescope. Absent means off. |
| `coursePublicKey` | RSA public key (SPKI PEM) for the course. When present the submission is sealed with `gb2:` instead of `gb1:` — see [Submission encoding](#submission-encoding-gb1-and-gb2). **Never a private key**; this app never holds one. |

**Problem level.** `id`, `name`, `description`, `subsections` — all required.

**Subsection level.** `id`, `name`, `description`, `points` and `submissionType`
are always present. `minWords`, `maxImages` and `config` appear only where the
author set them: `maxImages` caps an image upload, `minWords` is guidance shown
beside an AI-graded answer and is never enforced, and `config` carries the
authored answer-space size for a handwritten part.

**Submission Types:** `Text`, `Image`, `Text and Image`, `AI Graded: Binary`, `AI Graded: Short`, `AI Graded: Medium`, `AI Graded: Long`

`AI Formative` was retired on 2026-08-18. An archived spec that still names it loads unchanged — the part renders as plain text.

---

## Math notation (LaTeX)

Problem and subsection descriptions support LaTeX math, rendered with KaTeX, using the same
convention as the Assignment Maker (so what the instructor authored is what you see).

- **Inline:** single dollars, `$...$` — e.g. `$V_x = 6\,\text{V}$`, `$I = 0.1\,V_x$`.
- **Display:** double dollars, `$$...$$` — a centered block equation.
- Use LaTeX for anything with structure: subscripts `$V_x$`, fractions `$\frac{17}{7}$`,
  exponentials `$e^{-0.2(t-8)}$`, Greek and units `$\Omega$`. Plain text is fine for a bare symbol.
- Every `$` must be paired; an inline expression may not contain a `$`; a literal dollar sign in
  prose will be mis-parsed. Invalid LaTeX is never dropped silently — KaTeX flags the offending part
  in the rendered output, and if rendering fails outright the raw expression is shown with its
  delimiters — so keep the LaTeX valid.

Single-dollar inline works because rendering uses a custom splitter, not KaTeX auto-render. That
splitter lives in **`services/mathDelimiters.ts`, a byte-identical mirror of the same file in
`GradeBridge-Assignment-Maker`** — so an instructor's math cannot render one way when they author it
and another way when the student reads it. `npm test` compares the two copies and fails if they
drift, and also greps the tree for a second copy of the regex. Edit one, copy it to the other; never
re-implement the splitter locally.

---

## Data and privacy

**This app collects no student-identifying information.** There is no name
field, no student ID field, no email field, no account and no login. It asks
who you are at no point, because it never needs to know.

### Where identity actually comes from

You download a submission file and upload it yourself to your institution's
learning management system. **You authenticate there**, under the agreement your
institution already holds with that provider, and that authenticated upload is
what ties the work to you. Identity is established once, by your institution's
own system, and this app is not part of it.

The tool is LMS-neutral. It produces a file. Where that file goes is the
instructor's and the institution's choice.

### What the app does with your work

- **Once the page has loaded, nothing leaves your browser.** The app makes no
  request to any server after load — no analytics, no telemetry, no fonts, no
  CDN. Verified on the live site: the only requests after load are `blob:` URLs,
  which are handles to data already in your own browser. Your work is held in
  browser storage on your device until you download it.
- **The submission file carries no identity field.** Not your name, not an ID,
  not an email. Filenames carry none either; they are built from the assignment
  and a timestamp, like `ENG17_Homework_1_submission_20260903-0303.zip`.
- **Photograph metadata is removed.** Phone photographs carry EXIF data naming
  the device, the software version and the time and sometimes the place of
  capture. The app decodes and re-encodes every page, and **all** of it goes,
  not only EXIF: measured on a photograph as it came off the phone, an
  8,912-byte EXIF block plus two further metadata segments, against a 16-byte
  JFIF header and nothing else in the corresponding image inside the
  submission. (The photographs in this repository's own test set have since had
  their metadata stripped, so that first figure cannot be reproduced from them.)

### For handwritten assignments

- **The printed sheet has no name or ID line, deliberately.** Page 1 tells you:
  *"Do not write your name or student ID anywhere on these pages. You are
  identified when you upload."*
- **You see exactly what will be submitted, before you download it.** The review
  step shows every image that will be sent — one per answer, cut from your
  pages — and you confirm each one.

### What this app cannot do, stated plainly

- **Confirming each image is not enforced, on purpose.** You can download and
  submit without confirming anything, and nothing blocks you: a student part-way
  through sixteen pages at a deadline must still be able to hand in what they
  have. Whether you confirmed each answer is *recorded* in the submission for
  your grader to see, rather than being a gate in front of you.
- **It cannot read your handwriting, so it cannot detect identifying information
  you write on the page.** The instruction and the review step are the controls;
  the app does not screen the content of an image. Downstream processing may
  apply a best-effort screen, but the reliable protection is that the sheet never
  asks for your name and you check what is sent.
- **A page photograph is the whole frame.** Whatever else is in shot is in the
  image. Photograph the page on a plain surface.
- **`gb1:` encoding is tamper resistance, not confidentiality.** The key is in
  the shipped JavaScript, deliberately: it exists to stop casual editing of an
  assignment file between download and submission, not to keep secrets. This is
  only acceptable because no identity field is in the payload, which is enforced
  by test. Where a course supplies a public key, `gb2:` provides real
  confidentiality — only the holder of the course private key can open it, and
  this app never holds one.
- **On a `gb2:` course the photographs, the crops and the PDF are encrypted
  too.** Every entry in the archive beyond the JSON's own envelope is sealed
  individually and named `.gb2`. This matters most on a handwritten assignment,
  where the JSON holds no answers at all — the answers are the images. **On a
  course with no key nothing is encrypted beyond the JSON**, and such a
  submission is as readable as it has always been. See the
  [changelog](#changelog) for when this changed and what it replaced.
- **Your work is in browser storage and can be lost.** Clearing site data
  deletes it. Use *Save Backup*.

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Assignment won't load | Verify JSON was exported from Assignment Maker (encrypted `.json` file) |
| LaTeX not rendering | Refresh the page. KaTeX is bundled, so this is not a connection problem |
| Single `$...$` shows as raw text | Check the `$` signs are paired and the expression is valid LaTeX (see [Math notation](#math-notation-latex)) |
| PDF generation fails | Refresh and try again. Everything needed is bundled; the app makes no network requests |
| Lost work | Use "Save Backup" regularly; restore with "Load Work" |
| Images too large | Files over 4 MB are rejected; compress or use JPG instead of PNG |
| Word count displayed | Shows current word count as guidance — no minimum or maximum is enforced |

---

## The submission package

The download button produces a single ZIP. For a typed assignment it contains:
- `*_submission.json` — encrypted answer data (text responses, image counts)
- `*_submission.pdf` — formatted PDF matching the instructor template (one page per subsection)
- `p{N}s{N}_image_{N}.jpg` — one file per uploaded image, downsampled for fast loading

For a handwritten assignment it contains the JSON, `page_{n}.jpg` for each page
you photographed, and `crops/{region}.jpg` for each answer cut out of them. There
is no PDF.

**On a course with a public key every entry but the JSON gains a `.gb2` suffix**
— `page_1.jpg.gb2`, `crops/p1a.jpg.gb2`, `p0s1_image_0.jpg.gb2` and
`*_submission.pdf.gb2` — because it is an encrypted envelope rather than a JPEG
or a PDF, and a file that is not one should not be named as one. The payload
lists them under `encrypted_entries`, and `pdf_filename` names the sealed entry.

### Submission encoding: gb1 and gb2

The submission JSON is encoded in one of two formats. The autograder detects which by prefix; the choice is driven entirely by the assignment file:

| Spec field | Format | Confidentiality |
|---|---|---|
| no `coursePublicKey` | `gb1:` — shared-key AES-256-GCM | Tamper resistance only. The key ships in the JavaScript. |
| `coursePublicKey` present | `gb2:` — public-key envelope | Real. Only the course private key opens it, and this app never holds one. |

**Neither format carries an identity field.** The payload has had no
`student_name` since v3.9.0 — before that `gb2:` stripped it (v3.6.0) while
`gb1:` still carried it — and it never carried an email or a student ID. `gb2:`
still strips those four keys on the way out, which is belt and braces rather
than the mechanism: if one ever returned to the payload by accident, the `gb2:`
path would still remove it.

`gb2:` wraps a random AES-256-GCM content key with the course RSA public key (RSA-OAEP, SHA-256/MGF1-SHA256, empty label) and lays out the envelope as `wrappedKeyLen[uint16 BE] | wrappedKey | iv[12] | ciphertext+tag`, standard-base64 encoded. Only the course private key — held by the autograder, never by this app — can open it.

**Each sealed entry is the same envelope over its raw bytes**, with its own
content key and its own IV, written into the ZIP unencoded: base64 would add a
third to a multi-megabyte archive for nothing. The overhead per file is set by
the course key size — **286 bytes with an RSA-2048 key** (258 wrapped key, 12
IV, 16 tag) and **542 with an RSA-4096 one** (514, 12, 16). The live ENG17 Fall
key is 4096-bit. Measured at **+2.15%** on a real handwritten two-page
submission and **+2.41%** on a typed one carrying a real PDF, both at 2048. The full
interface, including how to open one by hand, is `AUTOGRADER_ZIP_SPEC.md` v6.0.

Identity comes from the authenticated upload to your institution's LMS, not from anything in the file. If a spec carries a `coursePublicKey` that cannot be read, the submission fails with an error rather than downgrading to `gb1:`.

The PDF is designed to match Assignment Maker templates:
- One page per subsection
- Consistent headers on all pages
- Image answers get dedicated pages

See the [Assignment Maker README](https://github.com/BridgeSuite/GradeBridge-Assignment-Maker#readme) for technical details on the grading rubric format.

---

## Development

### Tech Stack
React 19 + TypeScript + Vite + Tailwind CSS + KaTeX + html2canvas + jsPDF + JSZip + jsqr

**Everything is bundled into `dist/` at build time.** No CDN script tag, no
runtime `fetch`, no wasm pulled from a URL, no dynamic import from a URL — a
student photographing homework on a phone with no signal must still be able to
submit. `jsqr` was chosen over the better-known QR decoders for exactly this
reason: it is pure JavaScript and needs no wasm. (The one `cdnjs` string in the
built bundle is a literal inside jsPDF's own `pdfobject` viewer path, which this
app never calls; it is not a request.)

### Build & Deploy
```bash
npm run build      # Production build
npm run deploy     # Deploy to GitHub Pages
```

### Tests
```bash
npm test           # every suite, including registration and crop
npm run captures   # regenerate the synthetic capture set on its own
```
`tests/registration-tests.mjs` runs the handwritten path end to end in plain
Node: the zip loader, the `layout_id` hash check, QR decode, mark detection, the
transform and the crops, over a generated set of degraded captures. It prints a
detection table. **That set is synthetic and is not the evidence the work order
asks for** — see `tests/captures/README.md`, and drop real photographs into
`tests/captures/real/` to have them scored alongside.

**The encryption is exercised wherever the suite runs.** The envelope
assertions — prefix, base64 alphabet, envelope geometry, round trip, tamper
response and de-identification of the decrypted payload — are properties of the
format, so they run against a 2048-bit keypair generated in-process on every
run, including CI.

One check needs the verified test fixture and cannot be faked: `sample_gb2_string`
is a `gb2:` envelope produced by the **autograder's** Python implementation, and
decoding it is the only evidence the two implementations agree rather than that
this one is self-consistent. That needs a fixed keypair and a fixed ciphertext.

The fixture is deliberately **not** committed — it contains a private key. The
runner looks for `../Encryption/gb2_test_fixture.json` relative to the repo, or
wherever `GB2_FIXTURE` points:
```bash
GB2_FIXTURE=/path/to/gb2_test_fixture.json npm test
```
Without it the suite reports **two loud skips** and says which is which: the
fixture-keypair pass over the same body (covered by the ephemeral run), and the
interop check (**covered by nothing else**). With it, 45 checks pass and none
skip; without it, 33 pass and 2 skip.

---

## Changelog

### v3.9.0 — the submission carries no identity, and a keyed course seals everything
- **`student_name` is gone from the payload and from every filename.** There was
  never a field to type it into; the app was carrying a value it had inferred.
  Identity is the authenticated upload to your institution's LMS and nothing
  else. Filenames are built from the assignment and a timestamp, like
  `ENG17_Homework_1_submission_20260903-0303.zip`. The `gb2` strip list still
  names `student_name`, `email`, `sid` and `student_id` — that is belt and
  braces over a payload that no longer builds them, not the mechanism.
  **What is given up, deliberately:** the spec used to say a grader should
  compare the typed name against Gradescope's submitter and flag a mismatch.
  That check is gone. A self-typed name never caught an impostor, only a typo.
- **On a course with a key, every entry in the archive is sealed — not only the
  JSON.** Page photographs, answer crops, uploaded image answers and the
  submission PDF each get their own standard `gb2` envelope with its own content
  key and IV, and are named `.gb2`: `page_1.jpg.gb2`, `crops/p1a.jpg.gb2`,
  `{stem}.pdf.gb2`. The defect this closes is specific: on a handwritten
  assignment the JSON holds no answers at all — the answers *are* the images —
  so a hardened course was encrypting the envelope and shipping the letter in
  the clear. The PDF was the same thing one file along.
- **The payload declares what it sealed**, in `image_encryption` (`"gb2"`) and
  `encrypted_entries` (every sealed entry name, in archive order).
  **A consumer should drive its decrypt from that list, not from filenames it
  decides in advance**: the list names what was *actually written*, so a partial
  submission's list is short rather than wrong. Both fields are absent — absent,
  not `null` — when the course has no key, so test for presence.
- **A course with no key is unchanged**, byte for byte. Nothing about the
  keyless path moved, and a submission from such a course is as readable as it
  always was.
- Interface details for consumers: `AUTOGRADER_ZIP_SPEC.md` v6.0, which is
  **breaking for a course with a key** and carries the decrypt reference.

### v3.8.0 — the handwritten submission path
- **The student loads one file: the assignment zip.** It carries
  `assignment_spec.json` and `layout_{ID}.csv` together. A bare
  `assignment_spec.json` still loads, so electronic assignments and every file
  already in circulation are unaffected.
- **`layout_id` is recomputed from the map and checked against the QR on every
  page.** On a mismatch nothing is cropped and the student is told the file does
  not match their pages. This is the one check that catches a student printing
  this week's sheet and loading last week's zip — a failure that is otherwise
  completely silent, producing correct rectangles under the wrong labels.
- **Pages are registered and answers are cut out**: QR decode, reorient
  (including 180 degrees), find the four registration marks, fit a four-point
  transform, sample each declared rectangle. No network, no wasm, no full-page
  warp. `jsqr` is the only new runtime dependency.
- **Every answer is shown back before submission**, in assignment order,
  labelled as exactly what the grader will see. The student signs each off or
  flags it. **A flag never blocks submission.**
- **Two recovery routes**: retake the whole page, or photograph just that answer
  area — in which case the photograph *is* the crop, recorded as
  `crop_source: "direct_capture"`. The second route also covers a student with
  no printer, who writes on blank paper.
- **Fixed: the pages never shipped.** The ZIP builder did not reference the
  uploaded pages at all, so a handwritten student submitted a PDF of the blank
  question paper and a JSON in which every answer was `null`. Three comments in
  the tree asserted otherwise; all three are corrected.
- Submission JSON gains `input_mode`, `layout_id`, `pages` (each with its `k`
  and `N` from its own QR) and `crops`. `ai_feedback` is unchanged.

### v3.6.0
- **`gb2:` hardened submission encoding.** When the loaded assignment spec carries a `coursePublicKey` (SPKI PEM), the submission JSON is encoded as a public-key envelope and de-identified — `student_name`, `email`, `sid`, and `student_id` are stripped from the payload. Specs without that field are unaffected and still produce `gb1:`. See [The submission package](#submission-encoding-gb1-and-gb2).
- A spec whose `coursePublicKey` cannot be imported now fails the download with a clear message instead of silently falling back to `gb1:`.
- PDF, ZIP filename, and image files are unchanged in both paths.
- Added `npm test` — a dependency-free `cryptoService` suite covering the gb2 round trip, envelope layout, de-identification, key-failure handling, and gb1 regression.

### v3.5.0
- Uploaded images are written into the submission ZIP as individual downsampled JPEGs (`p{N}s{N}_image_{n}.jpg`) so human graders can see them inline.

### v3.2.0
- HEIC image support — iPhone photos are converted on upload.

### v3.1.0
- "Download for Gradescope" produces a single ZIP containing both the submission JSON and the PDF.

---

## Known Limitations

- **Long Text Answers** - Very long answers that exceed one page may have imperfect breaks (html2pdf limitation)
- **Mobile Experience** - Optimized for desktop for typed assignments; a handwritten assignment is meant to be done on the phone that took the photographs
- **The capture path has not been walked by hand end to end.** Registration thresholds *are* measured against real photographs — 41 of them, and the gate agrees with their reviewed labels — but the whole flow from loading an assignment to downloading a package has been exercised by test harnesses rather than by a person clicking through it. See `tests/captures/README.md`.

## Browser Support

Chrome 90+, Firefox 88+, Safari 14+, Edge 90+

---

## Contributing

1. Fork the repository
2. Create feature branch
3. Make changes with clear commits
4. Submit pull request

---

## License

MIT License - Free for personal and commercial use.

---

## Links

- **Live App**: [bridgesuite.github.io/GradeBridge-Student-Submission](https://bridgesuite.github.io/GradeBridge-Student-Submission/)
- **Assignment Maker**: [bridgesuite.github.io/GradeBridge-Assignment-Maker](https://bridgesuite.github.io/GradeBridge-Assignment-Maker/)
- **Issues**: [GitHub Issues](https://github.com/BridgeSuite/GradeBridge-Student-Submission/issues)

---

Built with React, TypeScript, [KaTeX](https://katex.org/), [html2canvas](https://html2canvas.hertzen.com/), [jsPDF](https://github.com/parallax/jsPDF), [JSZip](https://stuk.github.io/jszip/), and [Lucide](https://lucide.dev/).

MIT License · © 2026 The Regents of the University of California · Provided free by **UC Davis**.
