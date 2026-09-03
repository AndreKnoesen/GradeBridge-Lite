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
import { deidentifyForGb2, encryptBytesGb2, encryptJson, encryptJsonGb2 } from '../cryptoService';

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

/**
 * The stem every file in the download shares.
 *
 * **No name is in it, because the app no longer has one** (2026-09-03). What
 * replaces it is the moment: without a discriminator every student in a class
 * downloads an identically named file, and a second attempt lands beside the
 * first as `(1)` in a Downloads folder rather than as something a student can
 * recognise.
 *
 * `assignmentId` already begins with the course code — it is built as
 * `${courseCode}_${title}` — so the course code is not repeated here. The work
 * order specified `{course_code}_{assignment_id}_…`, which would have read
 * `ENG17_ENG17_Homework_1_…`; this keeps the intent and drops the stutter.
 *
 * The timestamp is `last_saved` from the payload, so the filename and the
 * contents cannot disagree about when the submission was made.
 */
export const submissionBaseName = (assignmentId: string, isoTimestamp: string): string => {
  const t = isoTimestamp.replace(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}).*$/, '$1$2$3-$4$5');
  return `${assignmentId}_submission_${t}`.replace(/[^a-z0-9_\-]/gi, '_');
};

/**
 * What an encrypted entry is called: `page_01.jpg.gb2`, `crops/p1a.jpg.gb2`.
 *
 * **A file that is not a JPEG must not be named `.jpg`** (work order ITEM 3).
 * Someone double-clicks it, sees corruption, and concludes the submission is
 * broken. The suffix is added to the whole name rather than replacing `.jpg`,
 * so the entry still says what comes out of the envelope.
 */
export const ENCRYPTED_ENTRY_SUFFIX = '.gb2';

export const encryptedEntryName = (entry: string): string => `${entry}${ENCRYPTED_ENTRY_SUFFIX}`;

/** What the payload declares about its image entries when they are sealed. */
export interface ImageEncryption {
  /** The envelope. `'gb2'` is the only value today. */
  format: 'gb2';
  /** Every sealed entry name, in archive order. */
  entries: string[];
}

/**
 * The two facts every name in the download is built from.
 *
 * **Extracted so the clock is read once.** `buildSubmissionJson` used to derive
 * both inline, and the package's archive name was then derived back out of the
 * finished payload so the two could not disagree. Sealing the PDF broke that
 * order — the payload has to list the sealed entries, and the PDF's entry name
 * is built from the identity — so the identity is now computed first and the
 * payload is built with `now` pinned to it. Same one derivation, same one
 * `new Date()`, and the filename still cannot disagree with the contents.
 */
export const submissionIdentity = (
  s: SubmissionSources,
): { assignmentId: string; lastSaved: string } => ({
  assignmentId: `${s.assignment.courseCode}_${s.assignment.title.replace(/\s+/g, '_')}`,
  lastSaved: s.now ?? new Date().toISOString(),
});

export interface SubmissionSources {
  assignment: Assignment;
  submissionData: SubmissionData;
  /** `assignment.inputMode === 'handwritten'` — passed in so the caller owns the rule. */
  isHandwritten: boolean;
  /** The map's recomputed `layout_id`. Null for an electronic assignment. */
  layoutId: string | null;
  pages: PageRef[];
  /** Injectable clock, for tests that need a stable filename. Defaults to now. */
  now?: string;
  crops: Record<string, CropRef>;
}

/**
 * The submission payload, before encoding.
 *
 * Every branch here is the one that was in the component, moved unchanged. The
 * electronic payload is byte-for-byte what it was; the handwritten keys are
 * only ever added when `isHandwritten`.
 */
export const buildSubmissionJson = (
  s: SubmissionSources, images?: ImageEncryption | null,
): Record<string, unknown> => {
  // Where the entries are sealed, the payload must name what is actually in the
  // archive — `page_01.jpg.gb2`, not `page_01.jpg`. The `file` field (and
  // `pdf_filename`) is the string a consumer opens; a payload that names a file
  // the archive does not have is the defect, not a courtesy.
  const entryName = (file: string): string => (images ? encryptedEntryName(file) : file);

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

  const { assignmentId, lastSaved } = submissionIdentity(s);
  // The PDF is sealed like everything else on a course with a key, so the field
  // names `{stem}.pdf.gb2` there. **A payload that names a file the archive does
  // not contain is the defect** — that is why the handwritten path deletes this
  // field rather than leaving it pointing at a PDF it does not ship.
  const pdfFilename = entryName(`${submissionBaseName(assignmentId, lastSaved)}.pdf`);

  // **`student_name` is not here, and its absence is the point** (2026-09-03).
  //
  // Identity comes from Gradescope's authenticated submitter. A name typed into
  // a box is unverified, trivially wrong, and PII carried through an encrypted
  // envelope for no gain — `cryptoService.GB2_PII_FIELDS` had already reached
  // that conclusion for the gb2 path and this finishes it for gb1.
  //
  // What is given up, deliberately: the spec used to say "compare against
  // Gradescope's submitter; a mismatch is for instructor review". That check is
  // gone. A self-typed name never caught an impostor, only a typo.
  const submissionJson: Record<string, unknown> = {
    course_code: s.assignment.courseCode,
    assignment_id: assignmentId,
    pdf_filename: pdfFilename,
    // Pass-through, per-assignment. Always a real boolean so the autograder
    // never has to tell "off" apart from "an older app version".
    ai_feedback: s.assignment.aiFeedback === true,
    submission_data: convertedData,
    last_saved: lastSaved,
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
      file: entryName(page.file),
      width: page.width,
      height: page.height,
      k: page.registration?.k ?? null,
      n: page.registration?.n ?? null,
      registration: page.registration?.status ?? 'pending',
      marks_found: page.registration?.marksFound ?? 0,
      // WHICH corners, not just how many. A page may be registered on three
      // marks (`marks_found: 3`, `registration: "degraded"`), and then the one
      // that is absent names the end of the sheet the transform inferred
      // instead of measuring. That is the first thing to look at when a crop
      // from such a page is disputed, and a count alone cannot say it.
      marks_detected: page.registration?.marksDetected ?? [],
      // Detected, and NOT used by the fit that was chosen. This is not the
      // complement of `marks_detected`: a corner absent from both was never
      // found at all, and a corner listed here was found, measured and
      // declined. A grader deciding a disputed crop needs those to be
      // different facts, because the second one means the app had better
      // information about that end of the sheet than it used.
      marks_declined: page.registration?.marksDeclined ?? [],
      residual_mm: page.registration?.residualMm ?? null,
      // QR reprojection is `residual_mm`; this is the worst error at a declined
      // mark near one of the fit's own corners, in millimetres. 0 when the fit
      // used every candidate near its corners.
      held_out_mm: page.registration?.heldOutMm ?? null,
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
        file: entryName(crop.file),
        width: crop.width,
        height: crop.height,
      };
    }
    submissionJson.crops = crops;
  }

  // **Which entries are sealed, declared rather than inferred from a filename**
  // (work order ITEM 3). Both keys are absent on a course with no key, so a gb1
  // payload is exactly what it was.
  //
  // Two keys and not one: `encrypted_entries` says *which*, and
  // `image_encryption` says *what*. A sealed entry is raw bytes, so unlike the
  // JSON entry it carries no `gb2:` tag to read the format off — the
  // declaration is the only place a consumer can branch on it.
  //
  // **`image_encryption` covers every sealed entry, including the electronic
  // PDF** (supplement 1, 2026-09-03). The name is narrower than the fact and
  // was kept deliberately: it had already been given to the autograder author,
  // and renaming a key to improve an adjective is how a consumer breaks for no
  // gain. `entry_encryption` is the better name if it is ever worth one
  // coordinated change.
  //
  // Set here, after the handwritten branch, because it is the one field that
  // belongs to BOTH paths: an electronic assignment's PDF and its
  // `p{i}s{j}_image_{n}` entries are sealed too.
  if (images) {
    submissionJson.image_encryption = images.format;
    submissionJson.encrypted_entries = images.entries;
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
  /** What was sealed, or null on a course with no key. The same object the payload declares. */
  imageEncryption: ImageEncryption | null;
  /**
   * Milliseconds spent sealing, and the plaintext bytes that went through it.
   * Reported rather than predicted: "AES-GCM over 9 MB is fast" is an
   * assumption until a real archive has been through it.
   */
  sealMs: number;
  sealedPlainBytes: number;
}

/**
 * One sealable entry on its way into the archive, before anything is sealed:
 * a page photograph, a crop, an electronic image answer, or the electronic PDF.
 *
 * Named for what it is rather than for images — the PDF joined the list in
 * supplement 1 of the 2026-09-03 work order, on the finding that it renders in
 * the clear the same typed answers the payload beside it encrypts.
 */
interface PlainEntry {
  name: string;
  /** A blob or bytes from the store, or -- for the electronic path -- base64 text. */
  data: Blob | Uint8Array | string;
  base64?: boolean;
}

interface SealedEntry {
  name: string;
  bytes: Uint8Array;
}

/**
 * An entry as bytes, whatever the caller had.
 *
 * The electronic path holds its answers as base64 in React state and hands them
 * to JSZip to decode; encryption needs the real bytes, so that decode happens
 * here instead. `atob` is a browser global and is also global in Node 18+,
 * which is what the harnesses run on.
 */
const entryBytes = async (image: PlainEntry): Promise<Uint8Array> => {
  const { data } = image;
  if (typeof data === 'string') {
    const binary = atob(data);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  }
  // A Node Buffer is a Uint8Array, so a harness's bytes take this branch too.
  if (data instanceof Uint8Array) return data;
  return new Uint8Array(await data.arrayBuffer());
};

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
  // **On a gb2 course the images are sealed too, one standard envelope each.**
  //
  // Until 2026-09-03 this function encrypted exactly one thing, the payload —
  // and for a handwritten submission the payload contains no answers at all:
  // every `submission_data` entry is `null`, because the graded artefact is the
  // crop images. So a hardened course encrypted the envelope and shipped the
  // letter in the clear beside it, as plain JPEGs.
  //
  // Three decisions, all from
  // `workorders/WORKORDER_STUDENT_ENCRYPT_IMAGES_2026-09-03.md`:
  //
  //   * **The standard gb2 envelope per file, each with its own content key.**
  //     An earlier draft shared one content key across the submission to save
  //     sixteen RSA operations. That would be a format the autograder does not
  //     implement; this one it already does, so opening an image is its
  //     existing decrypt, called once more.
  //   * **Raw bytes into the ZIP entry, never base64.** A real submission is
  //     megabytes and base64 would add a third of them for nothing. The
  //     overhead is the 258-byte wrapped key, the 12-byte IV and the 16-byte
  //     tag, per file.
  //   * **Every image, not only the handwritten ones.** Page photographs, crops
  //     and the electronic path's `p{i}s{j}_image_{n}` alike. None of them was
  //     ever encrypted.
  //
  // **Supplement 1, the same day: the electronic PDF is sealed too.** It was
  // outside the original order's scope and was reported rather than quietly
  // included; Andre took the decision on that finding. It renders in the clear
  // the same typed answers the payload beside it encrypts, so leaving it was
  // the same defect one file along. It is one more entry through the same
  // function — no new format, no new key, no new decision.
  //
  // **A course with no key is untouched, byte for byte** — same entry names,
  // same bytes, same payload keys. A course with no key had no protection to
  // weaken, and inventing a weaker scheme for it is not the answer; issuing a
  // key is.
  const courseKey = sources.assignment.coursePublicKey?.trim() || null;

  // The identity, computed once and then pinned. Everything in the archive is
  // named from it, including the PDF entry that now has to be known before the
  // payload can list it. `now` is pinned onto the sources so `buildSubmissionJson`
  // reads the clock zero further times and the filename cannot disagree with
  // `last_saved` inside the payload.
  const { assignmentId, lastSaved } = submissionIdentity(sources);
  const pinned: SubmissionSources = { ...sources, now: lastSaved };
  const baseName = submissionBaseName(assignmentId, lastSaved);

  // 1. Collect every sealable entry the archive will carry, in archive order.
  //
  // Collected BEFORE the payload is built, which is the reordering this work
  // needed: the payload has to list the sealed entries, and a list built from
  // what the app INTENDED to write would name entries a partial submission does
  // not have. `readBlob` returning null is a real case — see the note on
  // partial submissions below — so the list is built from what was read.
  const plain: PlainEntry[] = [];

  // **The PDF is first, because it is written first**, and the order of this
  // list is the order of the archive. An ELECTRONIC submission only: a
  // handwritten one carries no PDF at all (the decision below), so there is
  // nothing here to seal and nothing changes for it.
  if (!sources.isHandwritten) {
    if (!assets.pdfBytes) {
      throw new Error('An electronic submission needs a PDF, and none was supplied.');
    }
    plain.push({ name: `${baseName}.pdf`, data: assets.pdfBytes });
  }

  for (const page of sources.pages) {
    const pageBlob = await assets.readBlob(page.id);
    if (pageBlob) plain.push({ name: page.file, data: pageBlob });
  }
  for (const crop of cropList(sources.crops)) {
    const cropBlob = await assets.readBlob(cropBlobKey(crop.regionId));
    if (cropBlob) plain.push({ name: crop.file, data: cropBlob });
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
          plain.push({
            name: `${autograderKey}_image_${imgIdx}.jpg`,
            data: downsampled.replace(/^data:[^;]+;base64,/, ''),
            base64: true,
          });
        }
      }
    }
  }

  // 2. Seal them, if the course has a key.
  const sealStarted = Date.now();
  let sealed: SealedEntry[] | null = null;
  let plainBytes = 0;
  if (courseKey) {
    sealed = [];
    for (const entry of plain) {
      const bytes = await entryBytes(entry);
      plainBytes += bytes.length;
      sealed.push({
        name: encryptedEntryName(entry.name),
        bytes: await encryptBytesGb2(bytes, courseKey),
      });
    }
  }
  const sealMs = courseKey ? Date.now() - sealStarted : 0;
  const imageEncryption: ImageEncryption | null =
    sealed ? { format: 'gb2', entries: sealed.map(e => e.name) } : null;

  // 3. The payload, which now knows what was sealed and under what names. Built
  // from the pinned sources, so `assignment_id` and `last_saved` in it are the
  // same two values `baseName` was built from and the archive, the PDF and the
  // JSON inside it cannot disagree.
  const submissionJson = buildSubmissionJson(pinned, imageEncryption);
  const encoded = await encodeSubmissionJson(submissionJson, sources.assignment.coursePublicKey);

  const zip = new JSZip();
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
  //
  // The PDF an electronic submission does carry is collected above with
  // everything else, and is sealed with everything else on a course with a key
  // (supplement 1). It is still written here, first, before the pages.
  //
  // The pages, the crops, then any electronic image answers.
  //
  // Until the handwritten work landed the ZIP builder never referenced the
  // pages at all, so a handwritten student submitted a PDF of the blank
  // question paper and a JSON in which every answer was null — and nothing
  // anywhere said so.
  if (sealed) {
    for (const image of sealed) add(image.name, image.bytes);
  } else {
    // Byte-identical to what a course with no key produced before any of this:
    // the blob straight through, and the electronic answers still handed to
    // JSZip as base64 for it to decode.
    for (const image of plain) {
      add(image.name, image.data as Blob | Uint8Array | string,
        image.base64 ? { base64: true } : undefined);
    }
  }

  return {
    zip, baseName, format: encoded.format, entries, submissionJson,
    imageEncryption, sealMs, sealedPlainBytes: plainBytes,
  };
};

