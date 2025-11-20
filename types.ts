export interface AssignmentImage {
  data: string; // Base64
  content_type: string;
  filename: string;
}

export interface Subsection {
  subsection_statement: string;
  points: number;
  submission_elements: string[];
  max_images_allowed?: number;
  allow_pdf_upload?: boolean;
}

export interface Problem {
  problem_statement: string;
  points: number;
  problem_image?: AssignmentImage;
  submission_elements?: string[]; // Optional if subsections exist
  max_images_allowed?: number;
  allow_pdf_upload?: boolean;
  subsections?: Subsection[];
}

export interface Assignment {
  assignment_title: string;
  course_code: string;
  course_name?: string;
  preamble?: string;
  total_points: number;
  problems: Problem[];
}

export interface SubmissionData {
  [key: string]: {
    textAnswer?: string;
    imageAnswers?: string[]; // Array of base64 strings
    aiReflective?: string;
  };
}

export interface AppState {
  studentName: string;
  studentId: string;
  assignment: Assignment | null;
  submissionData: SubmissionData;
  viewMode: 'edit' | 'print';
  lastSaved: string | null;
  privacyAcknowledged: boolean;
}

export interface BackupData {
  student_name: string;
  student_id: string;
  submission_data: SubmissionData;
  assignment_title: string;
  course_code: string;
  exported_at: string;
  version: string;
}