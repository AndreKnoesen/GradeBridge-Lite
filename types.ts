// =====================================================
// Assignment Format (matches Assignment Maker export)
// =====================================================

export enum SubmissionType {
  TEXT = 'Text',
  IMAGE = 'Image',
  TEXT_AND_IMAGE = 'Text and Image',
  AI_GRADED_BINARY = 'AI Graded: Binary',
  AI_GRADED_SHORT = 'AI Graded: Short',
  AI_GRADED_MEDIUM = 'AI Graded: Medium',
  AI_GRADED_LONG = 'AI Graded: Long',
  HANDWRITTEN = 'Handwritten',
  MATLAB_GRADER = 'MatlabGrader',
  CODE = 'Code',
  FILE_UPLOAD = 'File Upload'
}

export interface Subsection {
  id: string;
  name: string;
  description: string;
  points: number;
  submissionType: SubmissionType | string;
  maxImages?: number;
  config?: string;
  minWords?: number;
}

export interface Problem {
  id: string;
  name: string;
  description: string;
  subsections: Subsection[];
}

/** How students answer. Absent on older assignments, which means 'electronic'. */
export type InputMode = 'electronic' | 'handwritten';

export interface Assignment {
  id: string;
  courseCode: string;
  title: string;
  inputMode?: InputMode;
  // No dueDate / dueTime, deliberately (removed 2026-08-31). They were declared
  // **required** here and read nowhere in this app, while the Assignment Maker
  // never sent them: its markdown parser never set them and its editor stripped
  // them on load. A required field that is never present is a type that lies to
  // the next person who trusts it. Due dates are set in Canvas.
  preamble: string;
  problems: Problem[];
  createdAt: number;
  updatedAt: number;
  /**
   * RSA public key (SPKI PEM) for the course/term, set by the instructor in
   * the Assignment Maker. When present, the submission JSON is encoded as a
   * de-identified gb2: envelope instead of gb1:. Never a private key.
   */
  coursePublicKey?: string;
  /**
   * Per-assignment AI-feedback flag, set in the Assignment Maker. Absent means
   * off. The app is pass-through only: it carries the flag to Gradescope, which
   * owns the election, the tally, and the pointer. No UI here.
   */
  aiFeedback?: boolean;
}

// =====================================================
// Handwritten pages and crops
// =====================================================

/** What stage 6 of the registration pipeline made of one photographed page. */
export interface PageRegistrationInfo {
  status: 'pending' | 'ok' | 'degraded' | 'failed' | 'layout_mismatch';
  /** Page number and page count, read from the QR on the paper — never from upload order. */
  k?: number;
  n?: number;
  /** `layout_id` as printed on the page. Compared against the loaded map's. */
  layoutId?: string;
  marksFound?: number;
  residualMm?: number;
  /** Student-facing, one sentence. */
  message?: string;
}

export interface PageRef {
  id: string;
  file: string;    // name inside the submission ZIP, e.g. page_1.jpg
  width: number;   // dimensions of the STORED (ingested) image
  height: number;
  // Local bookkeeping for the uploader. The exported submission JSON carries
  // only the four fields above, plus `registration` where a page has one.
  bytes?: number;
  sourceName?: string;
  warnings?: string[];
  registration?: PageRegistrationInfo;
}

/**
 * How a crop was obtained. The grader must not assume a direct capture came
 * from a known rectangle on a registered page: nothing was registered, no
 * rectangle was declared, and the framing is the student's.
 */
export type CropSource = 'registration' | 'direct_capture';

/** What the student said about the crop after looking at it. */
export type StudentReview = 'signed_off' | 'flagged' | 'not_reviewed';

/**
 * One answer, cut out and shown back. Every field above `cropSource` is read
 * from the map row — never parsed out of `region_id`, never inferred from the
 * order pages were uploaded in.
 */
export interface CropRef {
  regionId: string;
  partId: string;
  pageK: number;
  isDrawing: boolean;
  maxPoints: number;
  cropSource: CropSource;
  review: StudentReview;
  /** Advisory only. A flagged or warned crop still submits. */
  qualityFlags: string[];
  /** Name inside the submission ZIP. */
  file: string;
  width: number;
  height: number;
  bytes: number;
  /** PageRef.id this was cut from. Absent for a direct capture. */
  fromPage?: string;
}

export interface SubmissionData {
  [key: string]: {
    textAnswer?: string;
    imageAnswers?: string[]; // Array of base64 strings
    aiAnswer?: string;
  };
}

/**
 * The geometry map, as loaded from `layout_{ID}.csv` in the assignment zip.
 * Structurally identical to `services/layoutMap.ts`'s `LayoutMap`; declared
 * here too because `AppState` is autosaved and restored as plain JSON.
 */
export interface StoredLayoutMap {
  rows: Array<{
    assignmentId: string;
    layoutId: string;
    regionId: string;
    partId: string;
    pageK: number;
    x0: number; y0: number; x1: number; y1: number;
    isDrawing: boolean;
    maxPoints: number;
  }>;
  assignmentId: string;
  declaredLayoutId: string;
  computedLayoutId: string;
  maxPageK: number;
  sourceName: string;
}

export interface AppState {
  studentName: string;
  assignment: Assignment | null;
  submissionData: SubmissionData;
  /** Handwritten page pool — metadata only; the bitmaps live in IndexedDB. */
  pages: PageRef[];
  /** The map from the assignment zip. Null for electronic assignments. */
  layout: StoredLayoutMap | null;
  /** One entry per region the map declares, keyed by region_id. */
  crops: Record<string, CropRef>;
  viewMode: 'edit' | 'print';
  lastSaved: string | null;
  privacyAcknowledged: boolean;
}

export interface BackupData {
  student_name: string;
  submission_data: SubmissionData;
  assignment_title: string;
  course_code: string;
  exported_at: string;
  version: string;
  // Handwritten backups carry the pages too, so the file is genuinely complete
  // and a restore does not send the student back to re-photograph everything.
  pages?: PageRef[];
  page_images?: Record<string, string>;  // PageRef.id → data URI
  // ...and the crops, including the sign-off state, so a restore does not send
  // them back through the review either.
  layout?: StoredLayoutMap | null;
  crops?: Record<string, CropRef>;
  crop_images?: Record<string, string>;  // region_id → data URI
}