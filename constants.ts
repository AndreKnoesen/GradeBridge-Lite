export const STORAGE_KEY = 'gradebridge_submission';
export const PRIVACY_KEY = 'gradebridge_privacy_acknowledged';
export const PDF_NOTICE_KEY = 'gradebridge_pdf_notice_shown';
export const VERSION = 'v3.7.2';

// =====================================================
// Handwritten page pool (HANDWRITTEN_REGIONS_SPEC.md §5.2.1)
// =====================================================
// 2200 px on the long edge is ~200 DPI on a letter page — the resolution the
// EEC130B corpus transcribed at, and the last comfortable stop before
// superscripts (12–15 px at 200 DPI) start breaking up.
export const PAGE_MAX_EDGE = 2200;
export const PAGE_JPEG_QUALITY = 0.85;
// Replaces a file-size gate: pages are downsampled anyway, so the only input
// worth rejecting is one photographed with too few pixels to transcribe.
export const PAGE_MIN_SOURCE_EDGE = 1500;
// Soft guard against a pathological upload, not a real ceiling — Gradescope
// allows 100 MB for programming assignments and a typical submission is ~6 MB.
export const PAGE_TOTAL_SIZE_TARGET = 15 * 1024 * 1024;
// Advisory capture-time quality thresholds, measured on a 400 px proxy of the
// page. Loose on purpose: a false warning costs a glance, a missed blur costs
// a regrade. Tune from real student uploads.
export const PAGE_BLUR_WARN_VARIANCE = 40;
export const PAGE_CONTRAST_WARN_SPREAD = 60;

export const SUBMISSION_TYPES = {
  TEXT: 'Answer as text',
  IMAGE: 'Answer as image',
  TEXT_AND_IMAGE: 'Text and Image',
  AI_BINARY:    'AI Graded: Binary',
  AI_SHORT:     'AI Graded: Short',
  AI_MEDIUM:    'AI Graded: Medium',
  AI_LONG:      'AI Graded: Long',
  AI_FORMATIVE: 'AI Formative',
};

export const AI_GRADED_TYPES = new Set([
  'AI Graded: Binary',
  'AI Graded: Short',
  'AI Graded: Medium',
  'AI Graded: Long',
  'AI Formative',
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
