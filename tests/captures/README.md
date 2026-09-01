# The capture set

What the registration pipeline is measured against.

```
captures/
  synthetic/      generated, gitignored — `npm run captures` rebuilds it
  real/           put real photographs here
  layout_fixture.csv   the map the synthetic sheet was drawn from
```

## What is in `synthetic/` and what it is worth

Twelve renderings of one sheet, degraded in code: perspective, rotation
including the 180 degree case, a lighting gradient, a shadow across a corner,
defocus, JPEG loss, a dark desk with the page small in frame, and one capture
with most of it at once.

The **geometry is true**: the sheet is drawn from `services/pageFormat.ts`, the
same canonical constants the Assignment Maker prints from, so the marks, the QR
and the answer boxes are where a real sheet would put them. Only the degradation
is synthetic.

**This is not the section 8 evidence, and every threshold in the mark detector
and the capture-quality checks is untuned against a phone photograph.** The work
order asks for a printed sheet photographed a dozen ways before any of them is
trusted, and that has not happened. What a renderer cannot produce is precisely
what breaks registration in the field:

- paper curl, which bends the page out of the plane the transform assumes
- a specular highlight off a ballpoint line
- motion blur, which is directional, unlike the symmetric defocus here
- whatever a particular phone's image pipeline does with sharpening and noise
- a thumb, a desk edge, or a second sheet in frame

## Adding real photographs

Drop `.jpg` or `.png` files into `real/`. The suite picks them up with no code
change. They carry no ground truth, so they are scored on whether the page
registers at all, and that number is reported separately from the synthetic one.

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
