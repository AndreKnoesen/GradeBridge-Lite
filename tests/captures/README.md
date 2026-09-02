# The capture set

What the registration pipeline is measured against.

```
captures/
  synthetic/      generated, gitignored — `npm run captures` rebuilds it
  real/           eleven phone photographs, cap01..cap11
  stale/          five more of an older layout, stale01..stale05
  android/          thirteen from a Samsung Galaxy S22, android01..android13
                  — unlabelled, and NOT YET TRACKED: they exist on one machine
  LABELS.csv      the specification: what each of the sixteen should do
  BASELINE_2026-09-01.md   what the pipeline did before the gate was built
  REPORT_DECODER_ZXING_2026-09-01.md   the jsqr-vs-zxing decoder measurement
  layout_fixture.csv       the map the synthetic sheet was drawn from
```

## Why a measurement report is tracked here

`BASELINE_2026-09-01.md` and `REPORT_DECODER_ZXING_2026-09-01.md` are the two
records of what this capture set actually measured, and they are tracked for the
same reason the photographs are: **`GradeBridge2026\` is not a git repository**,
so a measurement written only into `workorders/` exists on one machine. Anything
whose conclusion a later session would otherwise have to re-derive by re-running
the pipeline belongs in here, next to the evidence it was derived from.

The decoder report answers
`GradeBridge2026\workorders\WORKORDER_DECODER_ZXING_2026-09-01.md`, which asked
whether zxing-cpp's wasm build should replace jsQR. **The answer taken on
2026-09-01 was not yet**, and the report carries the numbers, the two verdict
changes, and — in its section 10 — the two triggers that would make it worth
asking again. Read those before re-opening the question; the evaluation cost an
afternoon and does not need repeating from scratch.

## What is in `synthetic/` and what it is worth

Twelve renderings of one sheet, degraded in code: perspective, rotation
including the 180 degree case, a lighting gradient, a shadow across a corner,
defocus, JPEG loss, a dark desk with the page small in frame, and one capture
with most of it at once.

The **geometry is true**: the sheet is drawn from `services/pageFormat.ts`, the
same canonical constants the Assignment Maker prints from, so the marks, the QR
and the answer boxes are where a real sheet would put them. Only the degradation
is synthetic.

**This is not the section 8 evidence, and no threshold is set from it.** The
gap is not small and it is measured: this detector once scored 12 of 12 on these
synthetics and 4 of 11 on the real photographs. What a renderer cannot produce is
precisely what breaks registration in the field:

- paper curl, which bends the page out of the plane the transform assumes
- a specular highlight off a ballpoint line
- motion blur, which is directional, unlike the symmetric defocus here
- whatever a particular phone's image pipeline does with sharpening and noise
- a thumb, a desk edge, or a second sheet in frame

## LABELS.csv is the specification

The sixteen photographs are labelled, and **the `review` column is the target**
— not the `verdict` column, which is the first-pass judgement by eye and is
wrong twice. `cap05` was called a shadow failure and is a soft gradient that
stays legible; `cap09` was called acceptable clutter and is soft-focus enough
that its QR does not decode at all. Where the two columns disagree the row says
`DISAGREE:` and gives the reason.

`tests/gate-tests.mjs` asserts **exact agreement** with that column: 12 pass, 4
reject. Not a rate. A capture in the PASS set that the gate rejects is a failure
of the same weight as one in the FAIL set that it passes — a threshold that
rejects good work costs a student a photograph they should not have had to take.

**Every threshold in the mark detector and the capture gate is set from these
sixteen**, and each one carries the measurement that justifies it in the comment
beside it. Changing any of them means re-running all sixteen and reporting the
before-and-after table in the same message as the change.

## Adding real photographs

Drop `.jpg` or `.png` files into `real/` and add a row to `LABELS.csv`. The
suite picks them up with no code change, and an unlabelled capture fails the
suite rather than being quietly skipped.

To make them: print `assignment.pdf` from a real assignment zip at 100% (no
"fit to page" — it changes the scale and the marks move), write something in a
few boxes, and photograph it badly on purpose. Bad light, at an angle, curled,
on a dark desk, in a hurry, with a shadow across it.

The photographs are of an instructor's blank template with your own handwriting
on it. Do not put a student's work in this folder, and do not write a name or a
student ID on a sheet you are about to commit.

## Rebuilding

```bash
npm run captures      # regenerate synthetic/ and layout_fixture.csv
npm test              # runs registration-tests.mjs, which regenerates if stale
```

The suite regenerates the set automatically when the fixture's `layout_id` has
moved, because a stale capture set tests yesterday's geometry and passes.
