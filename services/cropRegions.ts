/**
 * cropRegions.ts — page-format spec section 6, stage 5.
 *
 * "Select rows with matching page_k, multiply fractions by the page, cut. No
 * detection, no edge finding, no adjustment." The declared rectangle is the
 * answer to where the answer is; the printed box on the paper is redundancy for
 * a human eye, never an input here.
 *
 * **The 3 mm region pad is already baked into the stored rectangle. It is not
 * applied again.** Padding twice eats into the neighbouring part.
 *
 * Nothing rectifies the page. Each rectangle's four corners go through the
 * transform and that quad is sampled — so a region is resampled exactly once,
 * from the original photograph, at a resolution the photograph actually has.
 */

import { LayoutRow } from './layoutMap';
import { Matrix3, applyMatrix, localScale } from './homography';
import { PX_PER_MM, fractionRectToMm } from './pageFormat';
import { Rgba, sampleRgba } from './raster';

/** Advisory only. A flagged crop is still submitted; see the work order, section 6. */
export const CROP_FLAG_LOOKS_EMPTY = 'looks-empty';

/**
 * ## `low-resolution` was retired on 2026-09-03, and it does not come back
 * ## without a photograph as its evidence
 *
 * It fired when a crop came in under 150 dpi. The OCR triage of 23 real crops
 * measured every one of its four firings and **all four were false** — each of
 * those crops read completely.
 *
 * The controlled pair settles it. `android09_p3_angle__p1b` at **118 dpi** and
 * `android10_p3_dim__p1b` at **194 dpi** are the same answer region on the same
 * sheet: same reading, same content, same two edges failing. **65% more linear
 * resolution changed nothing.** An independent hand comparison found the same,
 * one line cut at 195 dpi being indistinguishable from the same line at full
 * camera resolution.
 *
 * **Do not lower the threshold instead.** 118 dpi read cleanly, so this set
 * contains no evidence for any value, and choosing one would be the
 * split-the-difference this project has refused three times.
 *
 * Worse than useless on two of the four: the flag said the problem was image
 * quality when the actual problem was that the writer worked outside the box.
 * **A flag that misdescribes the defect sends the student to fix the wrong
 * thing** — they reshoot a page that was never the issue.
 *
 * `pxPerMm` below stays, on the region and in the submission manifest. The
 * number is real and useful; the threshold on it was not.
 *
 * If a capture is ever genuinely defeated by resolution, this comes back **with
 * that capture as its evidence** and not before.
 */

export interface CroppedRegion {
  row: LayoutRow;
  image: Rgba;
  /** Millimetres of paper per pixel of crop, for the report. */
  pxPerMm: number;
  flags: string[];
}

/** Fraction of pixels darker than the local paper that counts as "something is written here". */
const INK_FRACTION_EMPTY = 0.004;

const inkFraction = (image: Rgba): number => {
  const { data, width, height } = image;
  const n = width * height;
  if (n === 0) return 0;
  // Paper is the bright mode; anything a clear step below it is a stroke.
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) {
    sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  const mean = sum / n;
  const threshold = mean - 40;
  let dark = 0;
  for (let i = 0; i < data.length; i += 4) {
    const y = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    if (y < threshold) dark++;
  }
  return dark / n;
};

/**
 * Cuts one declared rectangle out of a registered page.
 *
 * `transform` maps canonical page millimetres to this photograph's pixels. The
 * output resolution is the photograph's own, capped at the canonical 300 dpi:
 * upsampling past what the camera delivered invents detail and costs bytes in a
 * submission that has to reach Gradescope over a phone connection.
 */
export const cropRegion = (page: Rgba, transform: Matrix3, row: LayoutRow): CroppedRegion => {
  const mm = fractionRectToMm({ x0: row.x0, y0: row.y0, x1: row.x1, y1: row.y1 });
  const wMm = mm.x1 - mm.x0;
  const hMm = mm.y1 - mm.y0;

  const centre = { x: (mm.x0 + mm.x1) / 2, y: (mm.y0 + mm.y1) / 2 };
  const available = localScale(transform, centre);
  const pxPerMm = Math.max(1, Math.min(available, PX_PER_MM));

  const width = Math.max(1, Math.round(wMm * pxPerMm));
  const height = Math.max(1, Math.round(hMm * pxPerMm));
  const data = new Uint8ClampedArray(width * height * 4);

  for (let j = 0; j < height; j++) {
    const my = mm.y0 + ((j + 0.5) / height) * hMm;
    for (let i = 0; i < width; i++) {
      const mx = mm.x0 + ((i + 0.5) / width) * wMm;
      const p = applyMatrix(transform, { x: mx, y: my });
      sampleRgba(page, p.x, p.y, data, (j * width + i) * 4);
    }
  }

  const image: Rgba = { data, width, height };
  const flags: string[] = [];
  if (inkFraction(image) < INK_FRACTION_EMPTY) flags.push(CROP_FLAG_LOOKS_EMPTY);

  return { row, image, pxPerMm, flags };
};

export const cropRegions = (page: Rgba, transform: Matrix3, rows: LayoutRow[]): CroppedRegion[] =>
  rows.map(row => cropRegion(page, transform, row));
