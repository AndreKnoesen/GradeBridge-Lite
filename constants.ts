export const STORAGE_KEY = 'gradebridge_submission';
export const PRIVACY_KEY = 'gradebridge_privacy_acknowledged';
export const PDF_NOTICE_KEY = 'gradebridge_pdf_notice_shown';
export const VERSION = 'v3.2.0';

export const SUBMISSION_TYPES = {
  TEXT: 'Answer as text',
  IMAGE: 'Answer as image',
  AI_BINARY: 'AI Graded: Binary',
  AI_SHORT:  'AI Graded: Short',
  AI_MEDIUM: 'AI Graded: Medium',
  AI_LONG:   'AI Graded: Long',
};

export const AI_GRADED_TYPES = new Set([
  'AI Graded: Binary',
  'AI Graded: Short',
  'AI Graded: Medium',
  'AI Graded: Long',
]);

export const AI_GRADED_WORD_RANGES: Record<string, { min: number; max: number; label: string }> = {
  'AI Graded: Binary': { min: 20,  max: 40,  label: 'Binary'  },
  'AI Graded: Short':  { min: 50,  max: 100, label: 'Short'   },
  'AI Graded: Medium': { min: 100, max: 150, label: 'Medium'  },
  'AI Graded: Long':   { min: 150, max: 250, label: 'Long'    },
};

export const COLORS = {
  primary: '#1e3a8a',
  danger: '#dc2626',
  success: '#059669',
  bg: '#f9fafb'
};
