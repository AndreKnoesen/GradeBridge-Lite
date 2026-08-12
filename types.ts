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
  AI_FORMATIVE = 'AI Formative',
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
  dueDate: string;
  dueTime: string;
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
}

// =====================================================
// Handwritten pages (HANDWRITTEN_REGIONS_SPEC.md §5.1)
// =====================================================

/** A rectangle on one page, normalized to [0,1] against that page's frame. */
export interface Region {
  page: string;  // PageRef.id
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PageRef {
  id: string;
  file: string;    // name inside the submission ZIP, e.g. page_1.jpg
  width: number;   // dimensions of the STORED (ingested) image
  height: number;
  // Local bookkeeping for the uploader. The exported submission JSON carries
  // only the four fields above.
  bytes?: number;
  sourceName?: string;
  warnings?: string[];
}

export interface SubmissionData {
  [key: string]: {
    textAnswer?: string;
    imageAnswers?: string[]; // Array of base64 strings
    aiAnswer?: string;
    // Handwritten only. Declared now, written by the region marker (stage 2b).
    regions?: Region[];
    status?: 'marked' | 'not_attempted';
  };
}

export interface AppState {
  studentName: string;
  assignment: Assignment | null;
  submissionData: SubmissionData;
  /** Handwritten page pool — metadata only; the bitmaps live in IndexedDB. */
  pages: PageRef[];
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
}