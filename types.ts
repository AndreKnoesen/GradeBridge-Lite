// =====================================================
// Assignment Format (matches Assignment Maker export)
// =====================================================

export enum SubmissionType {
  TEXT = 'Text',
  IMAGE = 'Image',
  AI_GRADED_BINARY = 'AI Graded: Binary',
  AI_GRADED_SHORT = 'AI Graded: Short',
  AI_GRADED_MEDIUM = 'AI Graded: Medium',
  AI_GRADED_LONG = 'AI Graded: Long',
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

export interface Assignment {
  id: string;
  courseCode: string;
  title: string;
  dueDate: string;
  dueTime: string;
  preamble: string;
  problems: Problem[];
  createdAt: number;
  updatedAt: number;
}

export interface SubmissionData {
  [key: string]: {
    textAnswer?: string;
    imageAnswers?: string[]; // Array of base64 strings
    aiAnswer?: string;
  };
}

export interface AppState {
  studentName: string;
  assignment: Assignment | null;
  submissionData: SubmissionData;
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
}