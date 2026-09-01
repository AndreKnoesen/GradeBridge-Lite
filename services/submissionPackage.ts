/**
 * submissionPackage.ts — what the student uploads to Gradescope.
 *
 * ## Why this is a service and not a handler
 *
 * It used to live inside `App.tsx`, in the React component, reading `state`
 * directly and interleaved with `setStatusMessage`, a progress overlay and an
 * `alert`. That made the one artefact the whole app exists to produce reachable
 * only by a person clicking a button in a browser: it could not be built in a
 * test, could not be opened, and could not be handed to whoever is writing the
 * autograder — who cannot build against a description of a ZIP.
 *
 * So the packaging is here, as functions over plain data, and the component
 * calls them. Nothing about the UI's behaviour changes: the same files go in,
 * in the same order, under the same names, with the same compression.
 *
 * ## What stays outside
 *
 * Two things are deliberately parameters rather than imports.
 *
 * **The PDF arrives as bytes, and only an electronic submission has one.**
 * Building it means rasterising a live DOM with `html2canvas`, which needs a
 * browser laying out real elements; it cannot be lifted out of the component and
 * cannot run in Node, so this file takes the result rather than pretending to own
 * the step. A handwritten submission carries no PDF at all — see
 * `buildSubmissionPackage`.
 *
 * **The page and crop bitmaps arrive through a reader.** In the app they live
 * in IndexedDB under keys this module names; a test supplies them from memory.
 * Passing the store in rather than importing it is what makes the package
 * buildable anywhere, and it keeps this file honest about the fact that it
 * writes bytes it did not produce.
 */

import JSZip from 'jszip';
import { Assignment, CropRef, PageRef, SubmissionData } from '../types';
import { AI_GRADED_TYPES } from '../constants';
import { deidentifyForGb2, encryptJson, encryptJsonGb2 } from '../cryptoService';

/**
 * Key a crop's bitmap is stored under. Pages use their own `PageRef.id`; crops
 * have no id of their own, so `region_id` is namespaced to keep the two apart
 * in one store.
 */
export const cropBlobKey = (regionId: string): string => `crop_${regionId}`;

/**
 * The crops as a list, in the record's own key order.
 *
 * That order is not upload order and does not need sorting: the record is
 * created with one entry per region the moment the layout map is parsed, so its
 * keys are the map's row order, which is the order the sheet was authored in. A
 * student photographing page 9 first does not reorder anything.
 *
 * Kept as a function because it is also where `Object.values` used to lose its
 * element type — `state` was untyped while `@types/react` was missing, so every
 * crop loop in the app went through here to stay typed. The types are installed
 * now and that reason has expired, but the ordering guarantee has not.
 */
export const cropList = (crops: Record<string, CropRef>): CropRef[] =>
  Object.keys(crops).map((regionId) => crops[regionId]);

/** Filenames are built from this, so it strips anything a filesystem might object to. */
export const submissionBaseName = (studentName: string, courseCode: string): string =>
  `${studentName}_${courseCode}_submission`.replace(/[^a-z0-9_\-]/gi, '_');

export interface SubmissionSources {
  studentName: string;
  assignment: Assignment;
  submissionData: SubmissionData;
  /** `assignment.inputMode === 'handwritten'` — passed in so the caller owns the rule. */
  isHandwritten: boolean;
  /** The map's recomputed `layout_id`. Null for an electronic assignment. */
  layoutId: string | null;
  pages: PageRef[];
  crops: Record<string, CropRef>;
}

/**
 * The submission payload, before encoding.
 *
 * Every branch here is the one that was in the component, moved unchanged. The
 * electronic payload is byte-for-byte what it was; the handwritten keys are
 * only ever added when `isHandwritten`.
 */
export const buildSubmissionJson = (s: SubmissionSources): Record<string, unknown> => {
  const convertedData: Record<string, { answer: string | null; images_submitted: number }> = {};

  s.assignment.problems.forEach((problem, pIdx) => {
    problem.subsections.forEach((sub, sIdx) => {
      const internalKey = `p${pIdx}_s${sIdx}`;
      const autograderKey = `p${pIdx}s${sIdx}`;
      const subData = s.submissionData[internalKey];
      const isAiGraded = typeof sub.submissionType === 'string' && AI_GRADED_TYPES.has(sub.submissionType);

      if (sub.submissionType === 'Image') {
        convertedData[autograderKey] = {
          answer: null,
          images_submitted: subData?.imageAnswers?.length ?? 0,
        };
      } else if (sub.submissionType === 'Text and Image') {
        convertedData[autograderKey] = {
          answer: subData?.textAnswer ?? null,
          images_submitted: subData?.imageAnswers?.length ?? 0,
        };
      } else if (isAiGraded) {
        convertedData[autograderKey] = {
          answer: subData?.aiAnswer ?? null,
          images_submitted: 0,
        };
      } else {
        convertedData[autograderKey] = {
          answer: subData?.textAnswer ?? null,
          images_submitted: 0,
        };
      }
    });
  });

  const assignmentId = `${s.assignment.courseCode}_${s.assignment.title.replace(/\s+/g, '_')}`;
  const pdfFilename = `${s.studentName}_${s.assignment.courseCode}_submission.pdf`
    .replace(/[^a-z0-9_\-\.]/gi, '_');

  const submissionJson: Record<string, unknown> = {
    student_name: s.studentName,
    course_code: s.assignment.courseCode,
    assignment_id: assignmentId,
    pdf_filename: pdfFilename,
    // Pass-through, per-assignment. Always a real boolean so the autograder
    // never has to tell "off" apart from "an older app version".
    ai_feedback: s.assignment.aiFeedback === true,
    submission_data: convertedData,
    last_saved: new Date().toISOString(),
  };

  // Handwritten: the pages, the crops and what the student said about each.
  // Nothing here is emitted for an electronic assignment.
  if (s.isHandwritten) {
    // No PDF is written for a handwritten submission, so the field naming one
    // is deleted rather than left pointing at a file that is not in the archive.
    // A consumer that opens what a payload names is doing the right thing; a
    // payload that names something absent is the defect.
    //
    // It is removed here rather than left out of the literal above so that an
    // ELECTRONIC payload keeps its exact key order, which is unchanged by any of
    // this.
    delete submissionJson.pdf_filename;

    submissionJson.input_mode = 'handwritten';
    submissionJson.layout_id = s.layoutId;
    // `k` and `N` come from each page's own QR, never from upload order.
    submissionJson.pages = s.pages.map(page => ({
      file: page.file,
      width: page.width,
      height: page.height,
      k: page.registration?.k ?? null,
      n: page.registration?.n ?? null,
      registration: page.registration?.status ?? 'pending',
      marks_found: page.registration?.marksFound ?? 0,
      residual_mm: page.registration?.residualMm ?? null,
    }));
    const crops: Record<string, unknown> = {};
    for (const crop of cropList(s.crops)) {
      crops[crop.regionId] = {
        region_id: crop.regionId,
        part_id: crop.partId,
        page_k: crop.pageK,
        is_drawing: crop.isDrawing,
        max_points: crop.maxPoints,
        // How it was obtained. A grader must not assume a direct capture came
        // from a known rectangle on a registered page.
        crop_source: crop.cropSource,
        // What the student said after looking at it. A part they never reached
        // is neither signed off nor flagged.
        student_review: crop.review,
        quality_flags: crop.qualityFlags,
        file: crop.file,
        width: crop.width,
        height: crop.height,
      };
    }
    submissionJson.crops = crops;
  }

  return submissionJson;
};

export interface EncodedSubmission {
  bytes: Uint8Array;
  /** Which envelope was used, for the report and for the autograder's reader. */
  format: 'gb1' | 'gb2';
}

/**
 * Encode the payload.
 *
 * A spec carrying a course public key gets the hardened `gb2` envelope with a
 * de-identified payload; everything else stays on `gb1`. **A spec that asked
 * for gb2 must never silently downgrade to gb1**, so any gb2 failure propagates
 * out of here rather than being caught.
 */
export const encodeSubmissionJson = async (
  submissionJson: Record<string, unknown>, coursePublicKey?: string | null,
): Promise<EncodedSubmission> => {
  const key = coursePublicKey?.trim();
  if (key) {
    // Identity comes from Gradescope's authenticated submitter metadata, not
    // the payload. The PDF and all filenames keep the student's name.
    const encoded = await encryptJsonGb2(deidentifyForGb2(submissionJson), key);
    return { bytes: new TextEncoder().encode(encoded), format: 'gb2' };
  }
  const encoded = await encryptJson(submissionJson);
  return { bytes: new TextEncoder().encode(encoded), format: 'gb1' };
};

/**
 * Compression for the submission ZIP. Named so the app and any harness that
 * builds one produce the same archive rather than differing by a default.
 */
export const SUBMISSION_ZIP_OPTIONS = {
  compression: 'DEFLATE',
  compressionOptions: { level: 6 },
} as const;

export interface PackageAssets {
  /**
   * The rendered submission PDF, for an ELECTRONIC submission only. Omit it for
   * a handwritten one; passing it there is ignored rather than honoured, because
   * whether the archive carries a PDF is a property of the submission and not of
   * what the caller happened to have to hand.
   */
  pdfBytes?: Uint8Array;
  /** Page and crop bitmaps by store key: `PageRef.id`, or `cropBlobKey(regionId)`. */
  readBlob: (key: string) => Promise<Blob | Uint8Array | null>;
  /**
   * Downsampler for the electronic image-answer path, which holds its images as
   * data URIs in state rather than in the blob store. Only called when an
   * assignment has `Image` or `Text and Image` parts.
   */
  downsampleImage: (dataUri: string) => Promise<string>;
}

export interface BuiltPackage {
  zip: JSZip;
  baseName: string;
  format: 'gb1' | 'gb2';
  /** What went in, in the order it went in. */
  entries: string[];
  /** The payload before encoding, so a caller can report on it without decrypting. */
  submissionJson: Record<string, unknown>;
}

/**
 * Assemble the submission ZIP.
 *
 * The order is the order the component wrote it in and is kept: JSON, PDF, the
 * page photographs, the crops, then any electronic image answers.
 *
 * **A partial submission packages without complaint, deliberately.** A student
 * part-way through sixteen pages is a real state, and refusing to build a
 * package for one would leave them with nothing to hand in. What a page or a
 * part is missing is visible in the payload — a page absent from `pages`, a
 * crop whose `student_review` is `not_reviewed` — rather than by the package
 * failing to exist.
 */
export const buildSubmissionPackage = async (
  sources: SubmissionSources, assets: PackageAssets,
): Promise<BuiltPackage> => {
  const submissionJson = buildSubmissionJson(sources);
  const encoded = await encodeSubmissionJson(submissionJson, sources.assignment.coursePublicKey);

  const zip = new JSZip();
  const baseName = submissionBaseName(sources.studentName, sources.assignment.courseCode);
  const entries: string[] = [];
  const add = (
    name: string, data: Blob | Uint8Array | string, options?: JSZip.JSZipFileOptions,
  ): void => {
    zip.file(name, data, options);
    entries.push(name);
  };

  add(`${baseName}.json`, encoded.bytes);

  // **A handwritten submission carries no PDF.** Andre, 2026-09-01, in
  // `workorders/DECISION_PACKAGE_CONTENTS_2026-09-01.md`.
  //
  // `PrintView` never receives the pages or the crops, so the PDF a handwritten
  // submission used to carry was the blank question paper. The instinct is to
  // fill it with the student's photographs; the decision is not to. Nothing
  // consumes it — Gradescope does not render it on the autograder path — it was
  // roughly half the archive by bytes, and it duplicates `page_N.jpg`, which is
  // kept. **A blank PDF nobody is supposed to read is worse than no PDF**,
  // because sooner or later somebody opens it and concludes the student
  // submitted nothing.
  //
  // Removing a thing that can be wrong beats maintaining a second copy of
  // something already kept. The electronic path is untouched.
  if (!sources.isHandwritten) {
    if (!assets.pdfBytes) {
      throw new Error('An electronic submission needs a PDF, and none was supplied.');
    }
    add(`${baseName}.pdf`, assets.pdfBytes);
  }

  // The pages and the crops. Until this landed the ZIP builder never referenced
  // the pages at all, so a handwritten student submitted a PDF of the blank
  // question paper and a JSON in which every answer was null — and nothing
  // anywhere said so.
  for (const page of sources.pages) {
    const pageBlob = await assets.readBlob(page.id);
    if (pageBlob) add(page.file, pageBlob);
  }
  for (const crop of cropList(sources.crops)) {
    const cropBlob = await assets.readBlob(cropBlobKey(crop.regionId));
    if (cropBlob) add(crop.file, cropBlob);
  }

  for (let pIdx = 0; pIdx < sources.assignment.problems.length; pIdx++) {
    const problem = sources.assignment.problems[pIdx];
    for (let sIdx = 0; sIdx < problem.subsections.length; sIdx++) {
      const sub = problem.subsections[sIdx];
      if (sub.submissionType === 'Image' || sub.submissionType === 'Text and Image') {
        const autograderKey = `p${pIdx}s${sIdx}`;
        const images = sources.submissionData[`p${pIdx}_s${sIdx}`]?.imageAnswers ?? [];
        for (let imgIdx = 0; imgIdx < images.length; imgIdx++) {
          const downsampled = await assets.downsampleImage(images[imgIdx]);
          add(
            `${autograderKey}_image_${imgIdx}.jpg`,
            downsampled.replace(/^data:[^;]+;base64,/, ''),
            { base64: true },
          );
        }
      }
    }
  }

  return { zip, baseName, format: encoded.format, entries, submissionJson };
};
