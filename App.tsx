import React, { useState, useEffect, useCallback, useRef } from 'react';
import JSZip from 'jszip';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import Sidebar from './components/Sidebar';
import ProblemRenderer from './components/ProblemRenderer';
import PageUploader from './components/PageUploader';
import PrintView from './components/PrintView';
import { PrivacyNotice } from './components/PrivacyNotice';
import { AppState, Assignment, PageRef, SubmissionData, BackupData } from './types';
import { STORAGE_KEY, PRIVACY_KEY, VERSION, AI_GRADED_TYPES } from './constants';
import { IngestedPage, blobToDataUri, dataUriToBlob, rotatePageBlob } from './imageIngest';
import { downloadBlob } from './downloadFile';
import { clearPageBlobs, deletePageBlob, getPageBlob, putPageBlob, pruneExcept } from './pageStore';
import { DEMO_ASSIGNMENT, DEMO_LOADED_MESSAGE } from './demoAssignment';
import { AlertTriangle, Download, ChevronLeft, Info, X, Monitor, Smartphone, Save } from 'lucide-react';
import { isEncoded, decryptJson, encryptJson, encryptJsonGb2, deidentifyForGb2, GB2_KEY_ERROR } from './cryptoService';

function downsampleImage(dataUri: string, maxPx = 1920, quality = 0.82): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > maxPx || height > maxPx) {
        const scale = maxPx / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d')!.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.src = dataUri;
  });
}

// Page order drives the filenames inside the submission ZIP, so it is
// recomputed on every add, removal and reorder. Regions bind to PageRef.id,
// never to the filename, so reordering never invalidates a marking.
const renumberPages = (pages: PageRef[]): PageRef[] =>
  pages.map((page, idx) => ({ ...page, file: `page_${idx + 1}.jpg` }));

const newPageId = (): string =>
  `pg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

// A quarter turn clockwise carries anything marked on the page with it:
// in the normalized frame (x, y, w, h) → (1 − y − h, x, h, w).
// Nothing writes regions yet — the marker is stage 2b — but rotation and
// marking are independent controls on the same page, so a student will
// eventually do them in either order, and a stale rectangle would crop the
// wrong part of the page with nothing on screen to show it went wrong.
const rotateRegionsClockwise = (data: SubmissionData, pageId: string): SubmissionData => {
  let changed = false;
  const next: SubmissionData = {};
  for (const [key, entry] of Object.entries(data)) {
    const regions = entry.regions;
    if (!regions?.some(r => r.page === pageId)) {
      next[key] = entry;
      continue;
    }
    changed = true;
    next[key] = {
      ...entry,
      regions: regions.map(r => r.page === pageId
        ? { page: r.page, x: 1 - r.y - r.h, y: r.x, w: r.h, h: r.w }
        : r)
    };
  }
  return changed ? next : data;
};

const App: React.FC = () => {
  const [state, setState] = useState<AppState>({
    studentName: '',
    assignment: null,
    submissionData: {},
    pages: [],
    viewMode: 'edit',
    lastSaved: null,
    privacyAcknowledged: false
  });
  const [showPrivacyModal, setShowPrivacyModal] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [showMobileBanner, setShowMobileBanner] = useState(false);
  const [pdfProgress, setPdfProgress] = useState<{ active: boolean; phase: 'pdf' | 'packaging'; current: number; total: number }>({ active: false, phase: 'pdf', current: 0, total: 0 });

  // Object URLs for the stored page bitmaps. A page with no entry here has
  // metadata but no image — the uploader surfaces it as needing re-upload.
  const [pageUrls, setPageUrls] = useState<Record<string, string>>({});
  const pageUrlsRef = useRef<Record<string, string>>({});

  const isHandwritten = state.assignment?.inputMode === 'handwritten';

  const setPageUrl = useCallback((id: string, blob: Blob) => {
    const previous = pageUrlsRef.current[id];
    if (previous) URL.revokeObjectURL(previous);
    pageUrlsRef.current = { ...pageUrlsRef.current, [id]: URL.createObjectURL(blob) };
    setPageUrls(pageUrlsRef.current);
  }, []);

  const dropPageUrl = useCallback((id: string) => {
    const previous = pageUrlsRef.current[id];
    if (!previous) return;
    URL.revokeObjectURL(previous);
    const { [id]: _removed, ...rest } = pageUrlsRef.current;
    pageUrlsRef.current = rest;
    setPageUrls(rest);
  }, []);

  const dropAllPageUrls = useCallback(() => {
    Object.values(pageUrlsRef.current).forEach(URL.revokeObjectURL);
    pageUrlsRef.current = {};
    setPageUrls({});
  }, []);

  // Revoke on unmount so a long session does not leak page bitmaps.
  useEffect(() => () => {
    Object.values(pageUrlsRef.current).forEach(URL.revokeObjectURL);
  }, []);

  /** Pulls stored bitmaps for a page list; anything missing stays missing. */
  const hydratePages = useCallback(async (pages: PageRef[]) => {
    for (const page of pages) {
      const blob = await getPageBlob(page.id);
      if (blob) setPageUrl(page.id, blob);
    }
    await pruneExcept(pages.map((p) => p.id));
  }, [setPageUrl]);

  // Mobile detection
  useEffect(() => {
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || window.innerWidth < 768;
    if (isMobile) {
      setShowMobileBanner(true);
    }
  }, []);

  // Initial Load
  useEffect(() => {
    // Privacy Check
    const privacy = localStorage.getItem(PRIVACY_KEY);
    if (privacy !== 'true') {
      setShowPrivacyModal(true);
    } else {
      setState(s => ({ ...s, privacyAcknowledged: true }));
    }

    // Data Restore
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        // Only restore if version matches or simple check passes
        if (parsed.submissionData) {
           const pages: PageRef[] = Array.isArray(parsed.pages) ? parsed.pages : [];
           setState(prev => ({
             ...prev,
             studentName: parsed.studentName || '',
             assignment: parsed.assignment || null,
             submissionData: parsed.submissionData || {},
             pages,
             lastSaved: parsed.lastSaved || null,
             privacyAcknowledged: true // If they have data, they likely ack'd privacy
           }));
           // Page bitmaps live in IndexedDB, so they restore separately and may
           // be gone (cleared cache, different browser). Regions are kept either
           // way — re-uploading the same page in the same slot revalidates them.
           if (pages.length > 0) void hydratePages(pages);
        }
      } catch (e) {
        console.error("Failed to restore session", e);
      }
    }
  }, []);

  // Auto Save Debounced
  // Only the small data goes here. Page bitmaps are written to IndexedDB as
  // they are ingested; localStorage keeps their metadata, which is a few
  // hundred bytes a page instead of a few hundred kilobytes.
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (state.studentName || Object.keys(state.submissionData).length > 0 || state.pages.length > 0) {
        const toSave = {
          studentName: state.studentName,
          assignment: state.assignment,
          submissionData: state.submissionData,
          pages: state.pages,
          lastSaved: new Date().toISOString()
        };
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
          setState(s => ({ ...s, lastSaved: toSave.lastSaved }));
        } catch (err) {
          // A silent autosave failure is how drafts disappear. Say so, and
          // point at the backup file, which does not use this quota.
          console.error('Autosave failed', err);
          setStatusMessage('Auto-save failed — this browser is out of storage. Use "Save Backup" to keep your work.');
        }
      }
    }, 1000);

    return () => clearTimeout(timeoutId);
  }, [state.studentName, state.submissionData, state.assignment, state.pages]);

  // Handlers
  const handleUpdateStudent = (field: string, value: string) => {
    setState(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmissionChange = (id: string, data: SubmissionData['key']) => {
    setState(prev => ({
      ...prev,
      submissionData: {
        ...prev.submissionData,
        [id]: data
      }
    }));
  };

  // --- Handwritten page pool ---

  const handleAddPage = async (ingested: IngestedPage) => {
    const id = newPageId();
    await putPageBlob(id, ingested.blob);
    setPageUrl(id, ingested.blob);
    setState(prev => ({
      ...prev,
      pages: renumberPages([
        ...prev.pages,
        {
          id,
          file: '',
          width: ingested.width,
          height: ingested.height,
          bytes: ingested.bytes,
          sourceName: ingested.sourceName,
          warnings: ingested.warnings
        }
      ])
    }));
  };

  // Keeps the id, so any regions already marked against this slot stay valid.
  const handleReplacePage = async (id: string, ingested: IngestedPage) => {
    await putPageBlob(id, ingested.blob);
    setPageUrl(id, ingested.blob);
    setState(prev => ({
      ...prev,
      pages: prev.pages.map(page => page.id === id
        ? {
            ...page,
            width: ingested.width,
            height: ingested.height,
            bytes: ingested.bytes,
            sourceName: ingested.sourceName,
            warnings: ingested.warnings
          }
        : page)
    }));
  };

  // Rotation rewrites the stored bitmap, so width/height swap with it and the
  // autosave picks the new metadata up on the next tick. The blob itself is
  // already in IndexedDB by the time this returns.
  const handleRotatePage = async (id: string) => {
    const blob = await getPageBlob(id);
    if (!blob) {
      setStatusMessage('That page image is no longer stored in this browser — upload it again to rotate it.');
      return;
    }
    try {
      const rotated = await rotatePageBlob(blob);
      await putPageBlob(id, rotated.blob);
      setPageUrl(id, rotated.blob);
      setState(prev => ({
        ...prev,
        submissionData: rotateRegionsClockwise(prev.submissionData, id),
        pages: prev.pages.map(page => page.id === id
          ? { ...page, width: rotated.width, height: rotated.height, bytes: rotated.bytes }
          : page)
      }));
    } catch (err) {
      console.error('Rotate failed', err);
      setStatusMessage('This page could not be rotated. Try retaking it.');
    }
  };

  const handleRemovePage = (id: string) => {
    if (!window.confirm("Remove this page? You can upload it again afterwards, but anything you have marked on it will be lost.")) {
      return;
    }
    void deletePageBlob(id);
    dropPageUrl(id);
    setState(prev => ({ ...prev, pages: renumberPages(prev.pages.filter(page => page.id !== id)) }));
  };

  const handleMovePage = (id: string, delta: number) => {
    setState(prev => {
      const from = prev.pages.findIndex(page => page.id === id);
      const to = from + delta;
      if (from < 0 || to < 0 || to >= prev.pages.length) return prev;
      const pages = [...prev.pages];
      const [moved] = pages.splice(from, 1);
      pages.splice(to, 0, moved);
      return { ...prev, pages: renumberPages(pages) };
    });
  };

  const handleLoadAssignment = (file: File) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const raw = (e.target?.result as string).trim();
        // Decode if encoded by Assignment Maker (gb1:…), otherwise parse plain JSON
        const decoded = (isEncoded(raw)
          ? await decryptJson(raw)
          : JSON.parse(raw)) as unknown;

        // Path-3 wrong-app detection: if this looks like an MQ assignment
        // (has questionPool[]), redirect the student to the MQ app instead
        // of failing with a confusing parse error.
        const obj = decoded as { questionPool?: unknown; problems?: unknown };
        if (Array.isArray(obj?.questionPool) && !Array.isArray(obj?.problems)) {
          if (window.confirm(
            "Wrong app for this file.\n\n" +
            "The file you loaded is an MQ (multiple-choice quiz) assignment, " +
            "not a lab/homework assignment. This app handles lab and homework " +
            "submissions.\n\n" +
            "Click OK to open the MQ Student Submission app in a new tab.\n" +
            "Click Cancel to stay here and try a different file."
          )) {
            window.open(
              'https://bridgesuite.github.io/GradeBridge-MQ-Student-Submission/',
              '_blank',
              'noopener'
            );
          }
          return;
        }

        const json = decoded as Assignment;
        // Basic validation
        if (!json.problems || !json.title || !json.courseCode) {
          throw new Error("Invalid assignment file format");
        }
        // Loading an assignment starts a fresh submission. Answers have always
        // been cleared here; pages are photographs, so ask before dropping them.
        if (state.pages.length > 0 && !window.confirm(
          "Loading an assignment clears your current work, including the " +
          `${state.pages.length} page image${state.pages.length === 1 ? '' : 's'} you uploaded.\n\n` +
          "Continue?"
        )) {
          return;
        }
        void clearPageBlobs();
        dropAllPageUrls();
        setState(prev => ({ ...prev, assignment: json, submissionData: {}, pages: [] }));
      } catch (err) {
        alert(
          "Invalid Assignment File\n\n" +
          "This file doesn't appear to be a valid assignment.\n\n" +
          "Please use the assignment JSON file provided by your course/instructor.\n\n" +
          "If you're trying to restore your previous work, use \"Load Work\" instead."
        );
      }
    };
    reader.readAsText(file);
  };

  const handleLoadDemo = () => {
    // Load the demo assignment directly without file upload
    void clearPageBlobs();
    dropAllPageUrls();
    setState(prev => ({ ...prev, assignment: DEMO_ASSIGNMENT, submissionData: {}, pages: [] }));
    setStatusMessage(DEMO_LOADED_MESSAGE);
    // Clear the message after 5 seconds
    setTimeout(() => setStatusMessage(''), 5000);
  };

  const handleExportWork = async () => {
    if (!state.assignment) return;
    const backup: BackupData = {
      student_name: state.studentName,
      submission_data: state.submissionData,
      assignment_title: state.assignment.title,
      course_code: state.assignment.courseCode,
      exported_at: new Date().toISOString(),
      version: VERSION
    };

    // A backup that omitted the pages would send a student who restores it
    // back out to re-photograph everything, so carry the bitmaps too.
    if (state.pages.length > 0) {
      setStatusMessage('Packing your pages into the backup...');
      const images: Record<string, string> = {};
      for (const page of state.pages) {
        const pageBlob = await getPageBlob(page.id);
        if (pageBlob) images[page.id] = await blobToDataUri(pageBlob);
      }
      backup.pages = state.pages;
      backup.page_images = images;
      setStatusMessage('');
    }

    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const fileName = `${state.studentName}_${state.assignment.courseCode}.json`.replace(/[^a-z0-9_\-\.]/gi, '_');
    downloadBlob(blob, fileName);
    // Nothing here knows whether the file was written — on iOS the download is
    // still behind a confirmation the student has not seen yet. Tell them what
    // to do next instead of claiming it is done.
    alert(
      "Backup file created.\n\n" +
      `File: ${fileName}\n\n` +
      "If your browser asks whether to download it, confirm. It saves wherever your " +
      "browser puts downloads — the Files app on a phone, the Downloads folder on a computer.\n\n" +
      "You can also upload this JSON to your LMS (Canvas, etc.) as a backup of your work."
    );
  };

  const handleLoadWork = (file: File) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const json = JSON.parse(e.target?.result as string);

        // Check if user accidentally loaded an assignment file instead of a backup
        if (json.problems && json.courseCode && !json.submission_data) {
          alert(
            "Wrong file type!\n\n" +
            "You selected an ASSIGNMENT file (used to define problems).\n\n" +
            "To restore your work, use a BACKUP file instead.\n" +
            "Backup files are named like: CourseCode_Title_backup.json\n\n" +
            "To load an assignment, use 'Upload JSON' in the Assignment section above."
          );
          return;
        }

        // Validate backup format
        if (!json.submission_data || !json.course_code) {
          alert(
            "Invalid backup file format.\n\n" +
            "Make sure you're loading a backup file created by 'Save Backup'.\n" +
            "Backup files contain your answers and are named: CourseCode_Title_backup.json"
          );
          return;
        }

        const backupData = json as BackupData;

        // We need the assignment structure to render
        if (!state.assignment && !window.confirm(
          "You haven't loaded an assignment file yet.\n\n" +
          "This backup might not display correctly without the original assignment structure.\n\n" +
          "Recommended: First upload the assignment JSON, then load your backup.\n\n" +
          "Continue anyway?"
        )) {
          return;
        }

        // Logic to verify course code match if assignment exists
        if (state.assignment && state.assignment.courseCode !== backupData.course_code) {
          if (!window.confirm(
            `Course code mismatch!\n\n` +
            `Backup is for: ${backupData.course_code}\n` +
            `Loaded assignment is: ${state.assignment.courseCode}\n\n` +
            `This backup may not match the current assignment. Continue anyway?`
          )) {
            return;
          }
        }

        // Pages, when the backup carries them. Written back into IndexedDB so
        // they behave exactly like freshly uploaded pages from here on.
        const restoredPages = Array.isArray(backupData.pages) ? backupData.pages : [];
        if (restoredPages.length > 0) {
          setStatusMessage('Restoring your pages...');
          await clearPageBlobs();
          dropAllPageUrls();
          for (const page of restoredPages) {
            const dataUri = backupData.page_images?.[page.id];
            if (!dataUri) continue;
            try {
              const pageBlob = dataUriToBlob(dataUri);
              await putPageBlob(page.id, pageBlob);
              setPageUrl(page.id, pageBlob);
            } catch (err) {
              console.error(`Could not restore page ${page.id}`, err);
            }
          }
          setStatusMessage('');
        }

        setState(prev => ({
          ...prev,
          studentName: backupData.student_name,
          submissionData: backupData.submission_data,
          pages: restoredPages.length > 0 ? renumberPages(restoredPages) : prev.pages,
          lastSaved: new Date().toISOString()
        }));
        alert("Work restored successfully!");
      } catch (err) {
        alert(
          "Could not read file.\n\n" +
          "Make sure the file is a valid JSON backup created by this app.\n" +
          "Backup files are named: CourseCode_Title_backup.json"
        );
      }
    };
    reader.readAsText(file);
  };

  const handleClearWork = () => {
    if (window.confirm("Are you sure you want to clear all work? This cannot be undone.")) {
      if (window.confirm("Really delete everything? Type 'YES' to confirm if you are unsure, or just click OK.")) {
         localStorage.removeItem(STORAGE_KEY);
         void clearPageBlobs();
         dropAllPageUrls();
         setState({
            studentName: '',
            assignment: null,
            submissionData: {},
            pages: [],
            viewMode: 'edit',
            lastSaved: null,
            privacyAcknowledged: true
         });
      }
    }
  };

  // Returns the raw PDF bytes, or null on error (caller handles overlay/cleanup).
  const buildPdfBytes = async (
    onPageProgress: (current: number, total: number) => void
  ): Promise<Uint8Array | null> => {
    const html2canvasLib = html2canvas;
    const jsPDFLib = jsPDF;

    const pdfContent = document.getElementById('pdf-content');
    if (!pdfContent) {
      alert("PDF content element not found. Please refresh and try again.");
      return null;
    }

    const captureWrapper = document.createElement('div');
    captureWrapper.style.cssText = 'position:fixed;left:-99999px;top:0;pointer-events:none;z-index:-9999;';
    const clone = pdfContent.cloneNode(true) as HTMLElement;
    captureWrapper.appendChild(clone);
    document.body.appendChild(captureWrapper);

    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));

    try {
      const clonePages = Array.from(clone.querySelectorAll('.pdf-page')) as HTMLElement[];
      if (clonePages.length === 0) throw new Error('No pages found in PDF content');

      onPageProgress(0, clonePages.length);
      const containerRect = clone.getBoundingClientRect();
      let pdf: any = null;

      for (let i = 0; i < clonePages.length; i++) {
        onPageProgress(i + 1, clonePages.length);
        const pageEl = clonePages[i];
        const pageRect = pageEl.getBoundingClientRect();
        const cropX = pageRect.left - containerRect.left;
        const cropY = pageRect.top - containerRect.top;
        const cropW = pageRect.width;
        const cropH = pageRect.height;

        if (cropW === 0 || cropH === 0) {
          throw new Error(`Page ${i + 1} has zero dimensions (${cropW}×${cropH})`);
        }

        const canvas = await html2canvasLib(clone, {
          scale: 2,
          useCORS: true,
          scrollX: 0,
          scrollY: 0,
          x: cropX,
          y: cropY,
          width: cropW,
          height: cropH,
        });

        const pdfPageWidth = 210;
        const pdfPageHeight = canvas.width > 0
          ? (canvas.height / canvas.width) * pdfPageWidth
          : 297;

        if (!isFinite(pdfPageHeight) || pdfPageHeight <= 0) {
          throw new Error(`Page ${i + 1}: invalid canvas size ${canvas.width}×${canvas.height}`);
        }

        if (i === 0) {
          pdf = new jsPDFLib({ unit: 'mm', format: [pdfPageWidth, pdfPageHeight], orientation: 'portrait' });
        } else {
          pdf.addPage([pdfPageWidth, pdfPageHeight]);
        }

        const imgData = canvas.toDataURL('image/jpeg', 0.98);
        pdf.addImage(imgData, 'JPEG', 0, 0, pdfPageWidth, pdfPageHeight);
      }

      return pdf.output('arraybuffer') as Uint8Array;
    } finally {
      document.body.removeChild(captureWrapper);
    }
  };

  // Returns the encrypted JSON bytes, or null if validation fails.
  const buildSubmissionJsonBytes = async (): Promise<{ bytes: Uint8Array; filename: string } | null> => {
    if (!state.assignment) return null;
    if (!state.studentName.trim()) {
      alert("Please enter your name before submitting.");
      return null;
    }

    const convertedData: Record<string, { answer: string | null; images_submitted: number }> = {};

    state.assignment.problems.forEach((problem, pIdx) => {
      problem.subsections.forEach((sub, sIdx) => {
        const internalKey = `p${pIdx}_s${sIdx}`;
        const autograderKey = `p${pIdx}s${sIdx}`;
        const subData = state.submissionData[internalKey];
        const isAiGraded = typeof sub.submissionType === 'string' && AI_GRADED_TYPES.has(sub.submissionType);

        if (sub.submissionType === 'Image') {
          convertedData[autograderKey] = {
            answer: null,
            images_submitted: subData?.imageAnswers?.length ?? 0
          };
        } else if (sub.submissionType === 'Text and Image') {
          convertedData[autograderKey] = {
            answer: subData?.textAnswer ?? null,
            images_submitted: subData?.imageAnswers?.length ?? 0
          };
        } else if (isAiGraded) {
          convertedData[autograderKey] = {
            answer: subData?.aiAnswer ?? null,
            images_submitted: 0
          };
        } else {
          convertedData[autograderKey] = {
            answer: subData?.textAnswer ?? null,
            images_submitted: 0
          };
        }
      });
    });

    const assignmentId = `${state.assignment.courseCode}_${state.assignment.title.replace(/\s+/g, '_')}`;
    const pdfFilename = `${state.studentName}_${state.assignment.courseCode}_submission.pdf`
      .replace(/[^a-z0-9_\-\.]/gi, '_');

    const submissionJson = {
      student_name: state.studentName,
      course_code: state.assignment.courseCode,
      assignment_id: assignmentId,
      pdf_filename: pdfFilename,
      submission_data: convertedData,
      last_saved: new Date().toISOString()
    };

    // Format selection: a spec carrying a course public key gets the hardened
    // gb2 envelope with a de-identified payload; everything else stays on gb1.
    // A spec that asked for gb2 must never silently downgrade to gb1, so any
    // gb2 failure propagates out of here rather than being caught.
    const coursePublicKey = state.assignment.coursePublicKey?.trim();
    let encoded: string;
    if (coursePublicKey) {
      // Identity comes from Gradescope's authenticated submitter metadata, not
      // the payload. The PDF and all filenames keep the student's name.
      encoded = await encryptJsonGb2(deidentifyForGb2(submissionJson), coursePublicKey);
    } else {
      encoded = await encryptJson(submissionJson);
    }
    const bytes = new TextEncoder().encode(encoded);
    const filename = `${state.studentName}_${state.assignment.courseCode}_submission.json`
      .replace(/[^a-z0-9_\-\.]/gi, '_');

    return { bytes, filename };
  };

  const handleDownloadForGradescope = async () => {
    if (!state.assignment) return;
    if (!state.studentName.trim()) {
      alert("Please enter your name before submitting.");
      return;
    }

    setPdfProgress({ active: true, phase: 'pdf', current: 0, total: 0 });
    setStatusMessage("Generating submission package...");

    try {
      // Phase 1: build PDF
      const pdfBytes = await buildPdfBytes((current, total) => {
        setPdfProgress({ active: true, phase: 'pdf', current, total });
        setStatusMessage(`Generating PDF... Page ${current} of ${total}`);
      });
      if (!pdfBytes) return;

      // Phase 2: build JSON
      setPdfProgress({ active: true, phase: 'packaging', current: 0, total: 0 });
      setStatusMessage("Packaging submission...");

      const jsonResult = await buildSubmissionJsonBytes();
      if (!jsonResult) return;

      // Phase 3: zip both files
      const zip = new JSZip();
      const baseName = `${state.studentName}_${state.assignment.courseCode}_submission`
        .replace(/[^a-z0-9_\-]/gi, '_');

      zip.file(`${baseName}.json`, jsonResult.bytes);
      zip.file(`${baseName}.pdf`, pdfBytes);

      for (let pIdx = 0; pIdx < state.assignment.problems.length; pIdx++) {
        const problem = state.assignment.problems[pIdx];
        for (let sIdx = 0; sIdx < problem.subsections.length; sIdx++) {
          const sub = problem.subsections[sIdx];
          if (sub.submissionType === 'Image' || sub.submissionType === 'Text and Image') {
            const autograderKey = `p${pIdx}s${sIdx}`;
            const images = state.submissionData[`p${pIdx}_s${sIdx}`]?.imageAnswers ?? [];
            for (let imgIdx = 0; imgIdx < images.length; imgIdx++) {
              const downsampled = await downsampleImage(images[imgIdx]);
              zip.file(`${autograderKey}_image_${imgIdx}.jpg`, downsampled.replace(/^data:[^;]+;base64,/, ''), { base64: true });
            }
          }
        }
      }

      const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });

      downloadBlob(zipBlob, `${baseName}.zip`);

      setStatusMessage("Submission package created — confirm the download if your browser asks.");
      alert(
        `Submission package created.\n\n` +
        `File: ${baseName}.zip\n\n` +
        `If your browser asks whether to download it, confirm. It saves wherever your ` +
        `browser puts downloads — the Files app on a phone, the Downloads folder on a computer.\n\n` +
        `This ZIP contains your PDF and submission data.\n` +
        `Upload the ZIP file to Gradescope to submit your assignment.\n\n` +
        `Check you have the file before you close this page.`
      );
      setTimeout(() => setStatusMessage(''), 6000);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error("Submission package error:", error);
      // A bad course encryption key is not something the student can retry
      // their way out of — show the instruction on its own.
      if (error instanceof Error && error.name === GB2_KEY_ERROR) {
        setStatusMessage("Assignment file problem — submission not created.");
        alert(msg);
      } else {
        setStatusMessage("Error generating submission.");
        alert(`There was an error generating your submission:\n\n${msg}\n\nPlease refresh the page and try again.`);
      }
    } finally {
      setPdfProgress({ active: false, phase: 'pdf', current: 0, total: 0 });
    }
  };

  const acceptPrivacy = () => {
    localStorage.setItem(PRIVACY_KEY, 'true');
    setState(s => ({ ...s, privacyAcknowledged: true }));
    setShowPrivacyModal(false);
  };

  // Below lg the shell is one long document scroll: the sidebar stacks on top
  // and the content follows it. Pinning the shell to the viewport height at
  // every width (as `h-screen overflow-hidden` used to) let the sidebar's
  // `h-full` claim the whole screen, squeezing the content pane — and with it
  // the page uploader — to zero height on phones.
  return (
    <div className="flex min-h-screen flex-col bg-gray-50 font-sans lg:h-screen lg:flex-row lg:overflow-hidden">

      {/* Submission Generation Overlay */}
      {pdfProgress.active && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/75 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl p-8 flex flex-col items-center gap-5 w-80 text-center">
            {/* Spinner */}
            <svg className="animate-spin w-12 h-12 text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" />
            </svg>
            <div>
              <p className="text-gray-900 font-semibold text-lg">
                {pdfProgress.phase === 'packaging' ? 'Packaging Submission' : 'Generating PDF'}
              </p>
              <p className="text-gray-500 text-sm mt-1">Please wait — do not close this tab</p>
            </div>
            {/* Step indicators */}
            <div className="w-full flex items-center gap-2 text-xs">
              <div className={`flex-1 flex items-center gap-1.5 px-2 py-1.5 rounded ${pdfProgress.phase === 'pdf' ? 'bg-blue-50 text-blue-700 font-semibold' : 'bg-green-50 text-green-700'}`}>
                <span>{pdfProgress.phase === 'pdf' ? '⏳' : '✓'}</span>
                <span>Rendering PDF</span>
              </div>
              <div className="text-gray-300">→</div>
              <div className={`flex-1 flex items-center gap-1.5 px-2 py-1.5 rounded ${pdfProgress.phase === 'packaging' ? 'bg-blue-50 text-blue-700 font-semibold' : 'bg-gray-50 text-gray-400'}`}>
                <span>{pdfProgress.phase === 'packaging' ? '⏳' : '○'}</span>
                <span>Building ZIP</span>
              </div>
            </div>
            {pdfProgress.phase === 'pdf' && pdfProgress.total > 0 && (
              <>
                <div className="w-full bg-gray-200 rounded-full h-2.5">
                  <div
                    className="bg-blue-600 h-2.5 rounded-full transition-all duration-300"
                    style={{ width: `${Math.round((pdfProgress.current / pdfProgress.total) * 100)}%` }}
                  />
                </div>
                <p className="text-gray-600 text-sm font-medium">
                  Page {pdfProgress.current} of {pdfProgress.total}
                </p>
              </>
            )}
          </div>
        </div>
      )}

      {/* Mobile Warning Banner — in flow on a phone, where a fixed banner
          would sit on top of the sidebar header and hide the version line.
          Fixed from lg up, where it is one line and the header clears it.
          A handwritten assignment is photographed on the phone, so the
          desktop advice is wrong there; anything else — including no
          assignment loaded yet — keeps it. */}
      {showMobileBanner && (
        <div className="w-full lg:fixed lg:top-0 lg:left-0 lg:right-0 bg-amber-500 text-amber-950 p-3 z-50 shadow-lg">
          <div className="flex items-center justify-between gap-3 max-w-4xl mx-auto">
            <div className="flex items-center gap-3">
              {isHandwritten
                ? <Smartphone className="w-5 h-5 flex-shrink-0" />
                : <Monitor className="w-5 h-5 flex-shrink-0" />}
              <p className="text-sm font-medium">
                {isHandwritten
                  ? 'Your phone is the right device for this. Photograph your handwritten pages right here. One note: files you save or download land in your Downloads or Files app, so that is where to look for them.'
                  : 'For the best experience, use a desktop or laptop. Files you download can be hard to find on mobile.'}
              </p>
            </div>
            <button
              onClick={() => setShowMobileBanner(false)}
              className="p-1 hover:bg-amber-600 rounded transition-colors flex-shrink-0"
              aria-label="Dismiss"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}

      {/* Sidebar */}
      <Sidebar
        state={state}
        onUpdateStudent={handleUpdateStudent}
        onLoadAssignment={handleLoadAssignment}
        onLoadDemo={handleLoadDemo}
        onLoadWork={handleLoadWork}
        onExportWork={handleExportWork}
        onClearWork={handleClearWork}
        onToggleView={() => setState(s => ({ ...s, viewMode: s.viewMode === 'edit' ? 'print' : 'edit' }))}
        onDownloadForGradescope={handleDownloadForGradescope}
        statusMessage={statusMessage}
      />

      {/* Main Content */}
      <div className="flex-1 lg:overflow-y-auto relative scroll-smooth" id="main-scroll">
        
        {/* Edit Mode View */}
        {state.viewMode === 'edit' && (
          <div className="max-w-4xl mx-auto p-6 lg:p-12 pb-action-bar">
            {!state.assignment ? (
              <div className="flex flex-col items-center justify-center min-h-[60vh] text-center text-gray-400 py-8">
                <h2 className="text-xl font-semibold text-gray-600 mb-6">
                  {!state.studentName.trim()
                    ? "Welcome! Let's Get Started"
                    : "Ready to Load Your Assignment"}
                </h2>

                {/* How-To Guide */}
                <div className="max-w-lg mb-8 text-left bg-blue-50 border border-blue-200 rounded-lg p-5 shadow-sm">
                  <h3 className="font-bold text-blue-800 mb-3 text-center">How to Submit Your Assignment</h3>
                  <ol className="space-y-3 text-sm text-blue-900">
                    <li className={`flex items-start gap-3 p-2 rounded ${state.studentName.trim() ? 'bg-green-50' : 'bg-blue-100'}`}>
                      <span className={`w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center flex-shrink-0 ${state.studentName.trim() ? 'bg-green-500 text-white' : 'bg-blue-600 text-white animate-pulse'}`}>1</span>
                      <span><strong>Enter your name</strong> - Type your Full Name in the sidebar (left panel)</span>
                    </li>
                    <li className={`flex items-start gap-3 p-2 rounded ${state.assignment ? 'bg-green-50' : state.studentName.trim() ? 'bg-blue-100' : 'bg-gray-50'}`}>
                      <span className={`w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center flex-shrink-0 ${state.assignment ? 'bg-green-500 text-white' : state.studentName.trim() ? 'bg-blue-600 text-white animate-pulse' : 'bg-gray-400 text-white'}`}>2</span>
                      <span><strong>Load assignment</strong> - Upload the JSON file your instructor provided (or try demo)</span>
                    </li>
                    <li className="flex items-start gap-3 p-2 rounded bg-gray-50">
                      <span className="w-6 h-6 rounded-full bg-gray-400 text-white text-xs font-bold flex items-center justify-center flex-shrink-0">3</span>
                      <span><strong>Complete your work</strong> - Fill in answers for each problem</span>
                    </li>
                    <li className="flex items-start gap-3 p-2 rounded bg-gray-50">
                      <span className="w-6 h-6 rounded-full bg-gray-400 text-white text-xs font-bold flex items-center justify-center flex-shrink-0">4</span>
                      <span><strong>Download &amp; Submit</strong> - Click <em>Download for Gradescope</em> to get a single ZIP file, then upload that ZIP to Gradescope</span>
                    </li>
                  </ol>
                  <div className="mt-4 p-2 bg-amber-50 border border-amber-200 rounded text-xs text-amber-800">
                    <strong>Tip:</strong> Your work auto-saves in this browser. Use "Save Backup" to keep a copy you can restore later.
                  </div>
                </div>

                {state.studentName.trim() ? (
                  <div className="flex flex-col items-center gap-3">
                    <p className="text-sm text-gray-600 font-medium">Upload an assignment JSON from the sidebar, or try the demo:</p>
                    <button
                      onClick={handleLoadDemo}
                      className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 text-white rounded-lg shadow-lg transition-all font-medium"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                      </svg>
                      Try Demo Assignment
                    </button>
                    <p className="text-xs text-gray-400 max-w-xs">
                      Explore all features with a sample math assignment
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-3 p-4 bg-amber-50 border border-amber-200 rounded-lg">
                    <p className="text-amber-700 font-medium">Please enter your name first</p>
                    <p className="text-sm text-amber-600">Complete Step 1 in the sidebar (left panel) to continue</p>
                  </div>
                )}
              </div>
            ) : (
              <>
                 <div className="mb-8 border-b border-gray-200 pb-6">
                    <div className="text-sm font-bold text-blue-800 uppercase tracking-wide mb-1">{state.assignment.courseCode}</div>
                    <h1 className="text-3xl font-serif font-bold text-gray-900 mb-4">{state.assignment.title}</h1>
                    {state.assignment.preamble && (
                        <div className="bg-blue-50 p-4 rounded-lg border border-blue-100 text-blue-900 text-sm leading-relaxed">
                            <strong>Instructions:</strong> {state.assignment.preamble}
                        </div>
                    )}
                 </div>

                 {/* Handwritten assignments answer on paper: the pages are the
                     submission, so the page pool leads. Electronic assignments
                     never reach this branch and are untouched. */}
                 {isHandwritten && (
                   <PageUploader
                     pages={state.pages}
                     pageUrls={pageUrls}
                     onAddPage={handleAddPage}
                     onReplacePage={handleReplacePage}
                     onRemovePage={handleRemovePage}
                     onMovePage={handleMovePage}
                     onRotatePage={handleRotatePage}
                   />
                 )}

                 <div>
                   {state.assignment.problems.map((problem, idx) => (
                     <ProblemRenderer
                       key={idx}
                       problem={problem}
                       problemIndex={idx}
                       submissionData={state.submissionData}
                       onSubmissionChange={handleSubmissionChange}
                     />
                   ))}
                 </div>

                 {/* Floating Bottom Bar — wraps to two rows on a phone rather
                     than letting the buttons spill outside the bar. */}
                 <div className="fixed bottom-0 left-0 right-0 lg:left-[320px] bg-gradient-to-t from-slate-900 to-slate-800 border-t border-slate-700 shadow-2xl z-40 min-h-[5rem] flex items-center pb-safe">
                   <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-3 max-w-3xl mx-auto w-full px-4 py-3">
                     <button
                       onClick={handleExportWork}
                       className="py-2 px-3 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-medium flex items-center justify-center gap-2 transition-all text-sm"
                     >
                       <Save className="w-4 h-4" />
                       Save Backup
                     </button>
                     <p className="hidden sm:block text-amber-300 text-xs font-medium px-1 text-center">
                       Ready to submit?
                     </p>
                     <button
                       onClick={handleDownloadForGradescope}
                       className="py-3 px-5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-bold flex items-center justify-center gap-2 transition-all shadow-xl"
                     >
                       <Download className="w-5 h-5" />
                       Download for Gradescope
                     </button>
                     <button
                       onClick={() => setState(s => ({ ...s, viewMode: 'print' }))}
                       className="py-2 px-3 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-medium flex items-center justify-center gap-2 transition-all text-sm"
                     >
                       <ChevronLeft className="w-4 h-4 rotate-180" />
                       Preview
                     </button>
                   </div>
                 </div>
              </>
            )}
          </div>
        )}

        {/* Print Preview Mode — always rendered so html2canvas can capture #pdf-content
            from edit mode. When not in print mode, fixed off-screen so it is invisible
            and non-interactive but still laid out by the browser. */}
        <div
          className="flex flex-col bg-gray-500 min-h-full"
          style={state.viewMode !== 'print' ? { position: 'fixed', left: '-99999px', top: 0, width: '210mm', pointerEvents: 'none', zIndex: -1 } : {}}
        >
           {state.assignment && (
               <>
                   {/* Scrollable Preview Area */}
                   <div className="flex-1 overflow-y-auto p-8 pb-action-bar flex justify-center">
                       <div className="shadow-2xl">
                           <PrintView
                             assignment={state.assignment}
                             submissionData={state.submissionData}
                             studentName={state.studentName}
                           />
                       </div>
                   </div>

                   {/* Fixed Download Bar - Always visible at bottom */}
                   <div className="fixed bottom-0 left-0 right-0 lg:left-[320px] bg-gradient-to-t from-slate-900 to-slate-800 border-t border-slate-700 shadow-2xl z-40 min-h-[5rem] flex items-center pb-safe">
                     <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-3 max-w-3xl mx-auto w-full px-4 py-3">
                       <button
                         onClick={() => setState(s => ({ ...s, viewMode: 'edit' }))}
                         className="py-2 px-3 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-medium flex items-center justify-center gap-2 transition-all text-sm"
                       >
                         <ChevronLeft className="w-4 h-4" />
                         Back
                       </button>
                       <button
                         onClick={handleDownloadForGradescope}
                         className="py-3 px-5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-bold flex items-center justify-center gap-2 transition-all shadow-xl"
                       >
                         <Download className="w-5 h-5" />
                         Download for Gradescope
                       </button>
                     </div>
                   </div>
               </>
           )}
        </div>

      </div>

      {/* Privacy Modal */}
      {showPrivacyModal && <PrivacyNotice onAccept={acceptPrivacy} />}
    </div>
  );
};

export default App;