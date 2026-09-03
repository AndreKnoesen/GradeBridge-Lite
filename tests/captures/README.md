# The capture set

What the registration pipeline is measured against.

```
captures/
  synthetic/      generated, gitignored — `npm run captures` rebuilds it
  real/           eleven phone photographs, cap01..cap11
  stale/          five more of an older layout, stale01..stale05
  android/        thirteen captures from an Android phone, contributed
                  for testing, android01..android13
                  — NOT TRACKED, see .gitignore
  students/       twelve photographs of real submitted coursework, six from
                  each of two iPhones, ios1_01..ios1_06 and ios2_01..ios2_06
                  — NOT TRACKED, see .gitignore
  LABELS.csv      the specification: what each of the 41 should do
  BASELINE_2026-09-01.md   what the pipeline did before the gate was built
  layout_fixture.csv       the map the synthetic sheet was drawn from
```

**Only `real/` and `stale/` are in this repository.** The other twenty-five
photographs are of other people's work and are not ours to publish. `LABELS.csv`
still specifies all 41, and the suite reports the ones it cannot see rather than
counting an absent photograph as agreement — so a fresh clone runs the sixteen
and prints a SKIP line for the rest.

The tracked photographs are the maintainer's own blank template with his own
handwriting on it.

## What is in `synthetic/` and what it is worth

Twelve renderings of one sheet, degraded in code: perspective, rotation
including the 180 degree case, a lighting gradient, a shadow across a corner,
defocus, JPEG loss, a dark desk with the page small in frame, and one capture
with most of it at once.

The **geometry is true**: the sheet is drawn from `services/pageFormat.ts`, the
same canonical constants the Assignment Maker prints from, so the marks, the QR
and the answer boxes are where a real sheet would put them. Only the degradation
is synthetic.

**No threshold is set from it, and the gap is measured rather than assumed:**
this detector once scored 12 of 12 on these synthetics and 4 of 11 on the real
photographs. What a renderer cannot produce is precisely what breaks
registration in the field:

- paper curl, which bends the page out of the plane the transform assumes
- a specular highlight off a ballpoint line
- motion blur, which is directional, unlike the symmetric defocus here
- whatever a particular phone's image pipeline does with sharpening and noise
- a thumb, a desk edge, or a second sheet in frame

The synthetics do hold one thing the photographs cannot: they carry **no
perspective**, so on them a three-point affine is the correct model. That is why
four of them caught a scoring defect no photograph would have — see *the tier
rule* below.

## LABELS.csv is the specification

Its **`review` column is the target** — not the `verdict` column, which is the
first-pass judgement by eye and is wrong twice. `cap05` was called a shadow
failure and is a soft gradient that stays legible; `cap09` was called acceptable
clutter and is soft-focus enough that its QR does not decode at all. Where the
two columns disagree the row says `DISAGREE:` and gives the reason.

`tests/gate-tests.mjs` asserts **exact agreement** with that column across all
41. Not a rate. A capture in the PASS set that the gate rejects is a failure of
the same weight as one in the FAIL set that it passes — a threshold that rejects
good work costs a student a photograph they should not have had to take.

**The sixteen in `real/` and `stale/` keep a separate assertion of their own
12 pass / 4 reject split**, because every threshold in the detector and the gate
is fitted to them and a change that moves that number has moved a calibration.
No threshold is fitted to the other twenty-five; they are held to the labels and
nothing more.

Two rows to read before trusting the rest:

- **`ios2_01` was reviewed PASS and corrected to FAIL the same day.** The eye said
  legible; the measurement said 55.0 on the darkest page tile against a floor of
  70, with every passing capture at 94.7 or brighter. It is the photographer's
  own shadow, hard edged, across the answer box — and the first photograph in
  the set ever to reach the legibility check, which until then had never fired
  on anything.
- **`android04` is reviewed PASS and the gate rejects it**, at `page_code`: the
  target page is fully visible and readable and no symbol on it decodes, while
  neighbouring sheets show their own codes. Nobody has investigated it.

### `KNOWN_OPEN` is a list that must shrink

Where the gate disagrees with a label, the capture is named in `KNOWN_OPEN` in
`gate-tests.mjs` with the reason — never quietly excluded. Each entry asserts the
**current wrong verdict**, so fixing the cause turns the suite red and forces the
entry out. A new disagreement, on any of the 41, fails. `android04` is the only
entry.

## Thresholds that must not be moved, and why

Each constant carries its own measurement in the comment beside it. These are the
four where the measurement is easy to lose and the temptation to tune is real.

| constant | value | why it is where it is |
|---|---|---|
| `captureGate.MARKS_MIN` | **3** | A three-mark fit is sometimes excellent and sometimes catastrophic, and the residual tells them apart by a factor of seventy — `ios2_01` fits on three marks to 0.61 mm, `ios2_05` once fitted on three to 42.33 mm. A count cannot separate those; the residual can. |
| `captureGate.LEGIBILITY_MIN_TILE_LUMA` | **70** | **Do not lower this to admit `ios2_01`.** Its darkest page tile is 55.0; every capture that passes measures 94.7 or brighter and the sixteen run 98.3 to 176.5. That is not a boundary case, and moving the floor to admit one page splits the difference against populations that do not overlap. |
| `registration.HELDOUT_MAX_MM` | **10.0** | How near a predicted corner a declined mark must sit to count as evidence. Measured on all 41: the nearest true declined mark is 3.16 mm and the nearest blob belonging to something else is 20.25 mm, so 10.0 sits in a 17 mm gap. Raising it to 100 breaks `cap01`, `cap04` and `cap06`, which are the multi-sheet and cluttered-desk captures. |
| ~~`DEGRADED_PENALTY_MM`~~ | **deleted** | It was a fixed penalty standing in for a measurement nobody was taking. A fit is now scored against every mark it declined near one of its own corners. **Do not reintroduce it**, and a test asserts it has not been. |

### The tier rule in `registration.consider`

A magnitude alone is not enough, and this is the least obvious thing in the
detector. On a page with **no perspective** — which is every synthetic capture —
a three-point affine is the correct model, so it fits the QR marginally better
than the homography *and* predicts the mark it declined to within 0.08 mm.
Scored on distance alone it wins, and the page is then reported as registering
on three marks when four were found and usable.

So fits are ranked in two tiers: **a fit that declined nothing it could have
used beats one that did, whatever the millimetres say.** Within a tier, the lower
score wins. Four synthetic captures found this; no photograph would have.

## Two captures whose numbers moved without their verdicts

`cap02` and `cap03` are the two "sheet cut off" captures. When the three-mark
branch gained the geometric sort the four-mark path always had, both changed
what they report while keeping their verdict:

- `cap02` went from **no fit at all** to a three-mark fit at 4.948 mm. The
  correct reading of its three real marks had never been generated; it is still
  refused, well outside both the 3.0 mm degraded budget and the 1.0 mm gate.
- `cap03` went from a **232 mm "fit"** to no fit. That number was a wrong
  reading that happened to be plausible, and it was never information.

Both are labelled FAIL and both still fail. Any earlier note quoting their old
numbers is describing a detector that no longer exists.

## The decoder question, and when to re-open it

jsQR plus a quadrant pass is what ships. Replacing it with zxing-cpp's wasm
build was measured on 2026-09-01 and **the answer was: not yet.**

zxing passed every acceptance criterion and was faster — 1530 ms to 42 ms on the
worst case — but the gap was **two photographs out of twenty-nine**, against
+413 KB gzip at best (+963 KB if the host does not compress wasm) paid by every
student on every load, a dependency on a flag the library marks
`@experimental`, and a decode budget that becomes unenforceable. The pipeline is
inside its 2 s budget as it stands.

**Re-open it if either becomes true:** the bundle cost stops mattering (a
different delivery path, or the library ships a smaller build), or the decode
failure rate on real captures rises above the two-in-twenty-nine measured then.
Do not re-run the comparison from scratch without checking those first.

## Seeing all 41 with the numbers

```bash
node tests/gate-tests.mjs            # the suite
node tests/gate-tests.mjs --table    # the suite, with its table
node tests/gateProbe.mjs             # every folder, no assertions
node tests/gateProbe.mjs students android
```

`gateProbe.mjs` is a diagnostic and asserts nothing. `gate-tests.mjs` is the
suite. Both print a SKIP line for any folder that is not checked out.

## Keeping the two copies of LABELS.csv in step

A working copy lives outside this repository beside the untracked photographs.
**Whichever you edit, copy it to the other in the same change** — the one in this
folder is what the suite reads, and a stale copy elsewhere is how a corrected
label gets lost.

## Adding real photographs

Drop `.jpg` or `.png` files into `real/` and add a row to `LABELS.csv`. The suite
picks them up with no code change, and an unlabelled capture fails the suite
rather than being quietly skipped.

To make them: print `assignment.pdf` from a real assignment zip at 100% (no
"fit to page" — it changes the scale and the marks move), write something in a
few boxes, and photograph it badly on purpose. Bad light, at an angle, curled,
on a dark desk, in a hurry, with a shadow across it.

**The photographs in `real/` and `stale/` are of a blank instructor template
with the maintainer's own handwriting on it. Do not put anyone else's work in
this folder**, and do not write a name or a student ID on a sheet you are about
to commit.

## Rebuilding

```bash
npm run captures      # regenerate synthetic/ and layout_fixture.csv
npm test              # runs registration-tests.mjs, which regenerates if stale
```

The suite regenerates the set automatically when the fixture's `layout_id` has
moved, because a stale capture set tests yesterday's geometry and passes.
