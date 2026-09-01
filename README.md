# GradeBridge Student Submission

Complete academic assignments with LaTeX support and generate professional PDFs for Gradescope - entirely in your browser.

![Version](https://img.shields.io/badge/version-3.6.0-blue.svg)
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
- **Professional PDF Generation** - Gradescope-compatible output matching instructor templates
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
3. Enter your full name
4. Complete each problem (text / images / text+image / AI-graded response)
5. Click **"Download for Gradescope"** — downloads a single ZIP containing the submission JSON and PDF
6. Upload the ZIP file to Gradescope

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

Assignments are created using the **[Assignment Maker](https://github.com/BridgeSuite/GradeBridge-Assignment-Maker)**:

```json
{
  "courseCode": "ECE416",
  "title": "Mini-Project 1",
  "preamble": "Instructions for the entire assignment...",
  "problems": [
    {
      "name": "System Analysis",
      "description": "Analyze the following system...",
      "subsections": [
        {
          "name": "Transfer Function",
          "description": "Derive the transfer function",
          "points": 50,
          "submissionType": "Text"
        },
        {
          "name": "Step Response",
          "description": "Plot the step response",
          "points": 30,
          "submissionType": "Image",
          "maxImages": 2
        },
        {
          "name": "Reflection",
          "description": "Explain your approach",
          "points": 20,
          "submissionType": "AI Graded: Short",
          "aiGradingConfig": { "gradingPrompt": "..." }
        }
      ]
    }
  ]
}
```

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

## Data & Privacy

- All data stored in browser localStorage
- No server communication, no analytics, no account required
- Data persists across browser restarts
- **Always export JSON backups** - data is lost if you clear browser cache

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

## Gradescope Integration

The **"Download for Gradescope"** button produces a single ZIP containing:
- `*_submission.json` — encrypted answer data (text responses, image counts)
- `*_submission.pdf` — formatted PDF matching the instructor template (one page per subsection)
- `p{N}s{N}_image_{N}.jpg` — one file per uploaded image, downsampled for fast loading

### Submission encoding: gb1 and gb2

The submission JSON is encoded in one of two formats. The autograder detects which by prefix; the choice is driven entirely by the assignment file:

| Spec field | Format | Payload |
|---|---|---|
| no `coursePublicKey` | `gb1:` — shared-key AES-256-GCM | includes `student_name` |
| `coursePublicKey` present | `gb2:` — public-key envelope | **de-identified**: `student_name`, `email`, `sid`, `student_id` removed |

`gb2:` wraps a per-submission random AES-256-GCM content key with the course RSA public key (RSA-OAEP, SHA-256/MGF1-SHA256, empty label) and lays out the envelope as `wrappedKeyLen[uint16 BE] | wrappedKey | iv[12] | ciphertext+tag`, standard-base64 encoded. Only the course private key — held by the autograder, never by this app — can open it.

The PDF and all filenames are identical in both cases and still carry the student's name; de-identification applies to the JSON payload only. Identity is taken from Gradescope's authenticated submitter metadata. If a spec carries a `coursePublicKey` that cannot be read, the submission fails with an error rather than downgrading to `gb1:`.

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

The gb2 round-trip checks need the verified test fixture (test keypair + plaintext + a known-good `gb2:` string). It is deliberately **not** committed — it contains a private key. The runner looks for `../Encryption/gb2_test_fixture.json` relative to the repo, or wherever `GB2_FIXTURE` points:
```bash
GB2_FIXTURE=/path/to/gb2_test_fixture.json npm test
```
Without it the suite still runs everything using an ephemeral keypair and marks the fixture-bound checks SKIPPED.

---

## Changelog

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
- **`gb2:` hardened submission encoding.** When the loaded assignment spec carries a `coursePublicKey` (SPKI PEM), the submission JSON is encoded as a public-key envelope and de-identified — `student_name`, `email`, `sid`, and `student_id` are stripped from the payload. Specs without that field are unaffected and still produce `gb1:`. See [Gradescope Integration](#submission-encoding-gb1-and-gb2).
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
- **Registration thresholds are untuned against real photographs.** The mark detector has been measured only on rendered and synthetically degraded captures. See `tests/captures/README.md`.

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
