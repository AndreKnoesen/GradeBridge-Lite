# The capture set

What the registration pipeline is measured against.

```
captures/
  synthetic/      generated, gitignored — `npm run captures` rebuilds it
  real/           eleven phone photographs, cap01..cap11
  stale/          five more of an older layout, stale01..stale05
  android/          thirteen from a Samsung Galaxy S22, android01..android13
                  — NOT YET TRACKED: they exist on one machine
  students/       twelve real student photographs — six from an iPhone 13 Pro
                  Max (ios1_01..ios1_06) and six from an iPhone 17 Pro Max
                  (ios2_01..ios2_06). NOT YET TRACKED.
  LABELS.csv      the specification: what each of the 41 should do
  REPORT_SEQUENCE_2026-09-02.md  START HERE for anything about registration.
                  The five reports below were written in one day, three of them
                  interact, and the order is not recoverable from this listing.
  BASELINE_2026-09-01.md   what the pipeline did before the gate was built
  REPORT_DECODER_ZXING_2026-09-01.md   the jsqr-vs-zxing decoder measurement
  REPORT_THREE_MARK_FIT_2026-09-02.md  the three-mark change, and the two
                  defects that still reject ios2_05 — read before touching the
                  mark detector, registration.ts, or the legibility floor
  REPORT_PADDING_MASK_2026-09-02.md    the validity mask that fixed the first
                  of those two. ios2_05 passes; the permutation defect is still
                  open, and a third one is now exposed
  REPORT_FIT_SCORING_2026-09-02.md     the third one, fixed: a fit is scored
                  against the evidence it declined, DEGRADED_PENALTY_MM is gone,
                  and no message asserts a cause the app has not measured
  REPORT_THREE_MARK_LABELLING_2026-09-02.md  the last of the four: three marks
                  are named the way four are. Note its §3 — cap02 and cap03
                  moved, both keeping their verdict
  REPORT_CROP_FLAGS_2026-09-03.md      low-resolution retired on measurement;
                  edge-contact NOT built, because the populations do not
                  separate. Its §3 is the formulation that would work
  REPORT_FULL_ASSIGNMENT_2026-09-03.md  sixteen pages and seventeen crops
                  through the whole path. Read its §3 before quoting an archive
                  size and its §4 before trusting the memory picture
  REPORT_NO_STUDENT_NAME_2026-09-03.md  student_name removed from the payload.
                  BREAKING — ZIP spec v5.0. Filenames changed with it
  layout_fixture.csv       the map the synthetic sheet was drawn from
```

## Why a measurement report is tracked here

`BASELINE_2026-09-01.md` and `REPORT_DECODER_ZXING_2026-09-01.md` are the two
records of what this capture set actually measured, and they are tracked for the
same reason the photographs are: **`GradeBridge2026\` is not a git repository**,
so a measurement written only into `workorders/` exists on one machine. Anything
whose conclusion a later session would otherwise have to re-derive by re-running
the pipeline belongs in here, next to the evidence it was derived from.

**`REPORT_SEQUENCE_2026-09-02.md` is the way in.** It puts the five 2026-09-02
reports in the order they were written, says which constants may not be moved
and why, and lists what is still open. Read it before any of the others.

`REPORT_THREE_MARK_LABELLING_2026-09-02.md` is the last of the four and closes
the sequence. It gives the three-mark branch the geometric sort the four-mark
path always had. **Read its §3 before trusting the `cap02` and `cap03` rows in
any earlier report** — those two moved, both keeping their verdict, and the
numbers they used to carry were meaningless.

`REPORT_FIT_SCORING_2026-09-02.md` deletes
`DEGRADED_PENALTY_MM` and scores a fit against every mark it declined near one
of its own predicted corners, which is what finally gives `ios2_05` a four-mark
fit. **Read its §1 before changing `HELDOUT_MAX_MM` and its §3 before changing
`consider`** — §3 records why a magnitude alone was not enough, which is not
obvious and cost four synthetic captures to find.

`REPORT_PADDING_MASK_2026-09-02.md` supersedes the
first report's §4: `rotateGray`'s white padding was entering `adaptiveInk`'s
local mean and erasing real marks at the frame edge, and `Gray` now carries a
validity mask so the mean averages only real pixels. **`ios2_05` passes.** Read
its §5 before touching `DEGRADED_PENALTY_MM`.

`REPORT_THREE_MARK_FIT_2026-09-02.md` answers
`GradeBridge2026\workorders\WORKORDER_THREE_MARK_FIT_2026-09-02.md`. It records
why the gate stopped requiring four corner marks, why `ios2_01` is refused anyway
and why its legibility floor must not be moved, and — its §4 and §5 — **two
unfixed defects that reject `ios2_05`, a photograph whose label is PASS and whose
label is right**. Either one alone is enough to reject it. Read it before
touching `markDetect.ts`, `registration.ts` or `LEGIBILITY_MIN_TILE_LUMA`.

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

`tests/gate-tests.mjs` asserts **exact agreement** with that column across all
41 — of which the sixteen are 12 pass, 4 reject. Not a rate. A capture in the PASS set that the gate rejects is a failure
of the same weight as one in the FAIL set that it passes — a threshold that
rejects good work costs a student a photograph they should not have had to take.

### All 41 are labelled, and the sixteen are still the calibration set

`LABELS.csv` gained the other twenty-five rows on 2026-09-02, so
`gate-tests.mjs` now holds the whole set to exact agreement. **The sixteen keep
a separate assertion of their own 12/4 split**, because every threshold in the
detector and in the gate is fitted to them and a change that moves that number
has moved a calibration. No threshold is fitted to the other twenty-five; they
are held to the labels and nothing more.

Two rows to read before trusting the rest:

- **`ios2_01` was reviewed PASS and corrected to FAIL the same day.** The eye said
  legible; the measurement said 55.0 on the darkest page tile against a floor of
  70, with every passing capture at 94.7 or brighter. It is the photographer's
  own shadow, hard edged, across the answer box — and the first photograph in
  the set ever to reach the legibility check, which until then had never fired
  on anything.
- **`ios2_05` is reviewed PASS and the gate rejects it.** That disagreement is
  real and is pinned in `KNOWN_OPEN` in `gate-tests.mjs`, along with `android04`.

### `KNOWN_OPEN` is a list that must shrink

Where the gate disagrees with a label, the capture is named in `KNOWN_OPEN` with
the reason — never quietly excluded. Each entry asserts the **current wrong
verdict**, so fixing the cause turns the suite red and forces the entry out. A
new disagreement, on any of the 41, fails.

### Seeing all 41 with the numbers

```bash
node tests/gateProbe.mjs                  # every folder
node tests/gateProbe.mjs students android   # just these
node tests/gate-tests.mjs --table         # the suite, with its table
```

`gateProbe.mjs` is a diagnostic and asserts nothing. `gate-tests.mjs` is the
suite.

### Keeping the two copies in step

`GradeBridge2026\CaptureSet\LABELS.csv` is the other copy. **Whichever you edit,
copy it to the other in the same change** — the one in this folder is what the
suite reads, and a stale copy elsewhere is how a corrected label gets lost.

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
