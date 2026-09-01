import React, { useEffect, useRef, useState } from 'react';
import {
  Camera, Upload, X, ArrowLeft, ArrowRight, AlertTriangle, RefreshCw, FileImage, RotateCw,
} from 'lucide-react';
import { PageRef } from '../types';
import { PAGE_TOTAL_SIZE_TARGET } from '../constants';
import { IngestedPage, formatBytes, ingestPage } from '../imageIngest';

interface PageUploaderProps {
  pages: PageRef[];
  /** PageRef.id → object URL for the stored bitmap. Missing id ⇒ bitmap gone. */
  pageUrls: Record<string, string>;
  onAddPage: (page: IngestedPage) => Promise<void>;
  onReplacePage: (id: string, page: IngestedPage) => Promise<void>;
  onRemovePage: (id: string) => void;
  onMovePage: (id: string, delta: number) => void;
  /** Rewrites the stored bitmap a quarter turn clockwise. */
  onRotatePage: (id: string) => Promise<void>;
}

interface Rejection {
  sourceName: string;
  reason: string;
}

const PageUploader: React.FC<PageUploaderProps> = ({
  pages, pageUrls, onAddPage, onReplacePage, onRemovePage, onMovePage, onRotatePage,
}) => {
  const chooseRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);
  const retakeRef = useRef<HTMLInputElement>(null);
  const replaceTargetRef = useRef<string | null>(null);

  const [busy, setBusy] = useState<{ current: number; total: number; name: string } | null>(null);
  const [rejections, setRejections] = useState<Rejection[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [hasCamera, setHasCamera] = useState(false);
  const [rotatingId, setRotatingId] = useState<string | null>(null);

  // A camera-capture input on a desktop just opens the file picker again, so
  // only offer it where it does something different.
  useEffect(() => {
    setHasCamera(
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(pointer: coarse)').matches
    );
  }, []);

  const totalBytes = pages.reduce((sum, p) => sum + (p.bytes ?? 0), 0);
  const overBudget = totalBytes > PAGE_TOTAL_SIZE_TARGET;
  const missingIds = pages.filter((p) => !pageUrls[p.id]).map((p) => p.id);

  // Two photographs of the same sheet. Each cuts the same regions, so the
  // second silently replaces the first's answers — which is right if it is a
  // better photo and wrong if it is the one they meant to delete. Either way
  // the student is the only one who can tell, so say it rather than pick.
  const seenK = new Map<number, number>();
  for (const page of pages) {
    const k = page.registration?.k;
    if (k) seenK.set(k, (seenK.get(k) ?? 0) + 1);
  }
  const duplicateK = [...seenK.entries()].filter(([, n]) => n > 1).map(([k]) => k);

  // Pages the assignment has that nothing uploaded covers. `N` comes from the
  // QR on the paper, so this is only knowable once at least one page is in.
  const declaredN = pages.map((p) => p.registration?.n).find((n) => typeof n === 'number');
  const missingK = declaredN
    ? Array.from({ length: declaredN }, (_, i) => i + 1).filter((k) => !seenK.has(k))
    : [];

  /**
   * One page at a time, released before the next starts. Eight 12-megapixel
   * photos decoded concurrently will take a budget phone's tab down with it.
   */
  const processFiles = async (files: File[], replaceId?: string) => {
    if (files.length === 0) return;
    const failures: Rejection[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setBusy({ current: i + 1, total: files.length, name: file.name || 'page' });
      // Yield so the progress line paints before a long decode blocks the thread.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));

      const result = await ingestPage(file);
      if (!result.page) {
        failures.push({ sourceName: result.sourceName, reason: result.reason ?? 'Could not be processed.' });
        continue;
      }
      if (replaceId) {
        await onReplacePage(replaceId, result.page);
      } else {
        await onAddPage(result.page);
      }
    }

    setBusy(null);
    setRejections(failures);
  };

  const handleChoose = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = (e.target.files ? Array.from(e.target.files) : []) as File[];
    e.target.value = '';           // so the same file can be picked again
    void processFiles(files);
  };

  const handleReplace = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = (e.target.files ? Array.from(e.target.files) : []) as File[];
    e.target.value = '';
    const target = replaceTargetRef.current;
    replaceTargetRef.current = null;
    if (target && files.length > 0) void processFiles([files[0]], target);
  };

  /**
   * `source: 'camera'` reopens the rear camera so a bad page can actually be
   * re-shot; 'file' stays the fallback for a denied or absent camera, and is
   * the only option on a desktop.
   */
  const startReplace = (id: string, source: 'camera' | 'file' = 'file') => {
    replaceTargetRef.current = id;
    const input = source === 'camera' ? retakeRef.current : replaceRef.current;
    input?.click();
  };

  const handleRotate = async (id: string) => {
    if (rotatingId) return;
    setRotatingId(id);
    try {
      await onRotatePage(id);
    } finally {
      setRotatingId(null);
    }
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') setDragActive(true);
    else if (e.type === 'dragleave') setDragActive(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    void processFiles((e.dataTransfer.files ? Array.from(e.dataTransfer.files) : []) as File[]);
  };

  return (
    <section className="bg-white rounded-xl shadow-sm border border-gray-200 mb-8" aria-labelledby="pages-heading">
      <div className="bg-slate-50 px-6 py-4 border-b border-gray-200 flex justify-between items-center gap-3 flex-wrap">
        <h2 id="pages-heading" className="text-lg font-bold text-slate-800 flex items-center gap-2">
          <FileImage className="w-5 h-5 text-slate-500" />
          Your Pages
        </h2>
        <span className={`text-xs font-medium px-2.5 py-0.5 rounded-full border ${
          overBudget
            ? 'bg-amber-100 text-amber-900 border-amber-300'
            : 'bg-blue-100 text-blue-800 border-blue-200'
        }`}>
          {pages.length} {pages.length === 1 ? 'page' : 'pages'} · {formatBytes(totalBytes)}
        </span>
      </div>

      <div className="p-6 space-y-5">
        <p className="text-sm text-gray-600">
          <span className="font-semibold text-gray-800">
            Take all your photos first, then upload them together
          </span>{' '}
          — photograph every page with your phone&rsquo;s normal camera app, then choose
          &ldquo;Choose files&rdquo; and select them all at once, in order. The in-app camera is
          there for a quick single page.
        </p>

        {/* --- Upload controls --- */}
        <div
          className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
            dragActive ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-gray-400'
          }`}
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
        >
          <input
            ref={chooseRef}
            type="file"
            accept="image/*,.heic,.heif"
            multiple
            onChange={handleChoose}
            className="hidden"
          />
          {/* Single-shot on purpose: `capture` is one photo at a time, and pairing
              it with `multiple` makes some mobile browsers drop the camera hint and
              open the library picker instead — the batch path already has a picker.
              `handleChoose` takes an array of any length, so nothing else changes. */}
          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleChoose}
            className="hidden"
          />
          <input
            ref={replaceRef}
            type="file"
            accept="image/*,.heic,.heif"
            onChange={handleReplace}
            className="hidden"
          />
          {/* Same handler as the picker above — only `capture` differs, so a
              browser that ignores it (or has no camera) still opens a picker
              and the retake completes anyway. */}
          <input
            ref={retakeRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleReplace}
            className="hidden"
          />

          <div className="flex flex-col items-center gap-3">
            <div className="flex flex-wrap items-center justify-center gap-3">
              {hasCamera && (
                <button
                  type="button"
                  onClick={() => cameraRef.current?.click()}
                  disabled={busy !== null}
                  className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-300 text-white rounded-lg font-medium text-sm transition-colors"
                >
                  <Camera className="w-4 h-4" />
                  Take photo
                </button>
              )}
              <button
                type="button"
                onClick={() => chooseRef.current?.click()}
                disabled={busy !== null}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-lg font-medium text-sm transition-colors ${
                  hasCamera
                    ? 'bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-300'
                    : 'bg-blue-600 hover:bg-blue-500 disabled:bg-blue-300 text-white'
                }`}
              >
                <Upload className="w-4 h-4" />
                Choose files
              </button>
            </div>
            <p className="text-xs text-gray-500">
              JPG, PNG or HEIC — drag and drop works too. Large photos are fine; each page is
              resized for you.
            </p>
          </div>
        </div>

        {/* --- Progress --- */}
        {busy && (
          <div className="flex items-center gap-3 text-sm text-blue-800 bg-blue-50 border border-blue-200 rounded-lg px-4 py-3">
            <RefreshCw className="w-4 h-4 animate-spin flex-shrink-0" />
            <span>
              Processing page {busy.current} of {busy.total} — <span className="font-medium">{busy.name}</span>
            </span>
          </div>
        )}

        {/* --- Rejected files --- */}
        {rejections.length > 0 && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3" role="alert">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2 text-sm text-red-800">
                <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <div className="space-y-1">
                  <p className="font-semibold">
                    {rejections.length === 1 ? 'One file was not added:' : `${rejections.length} files were not added:`}
                  </p>
                  <ul className="space-y-1">
                    {rejections.map((r, idx) => (
                      <li key={idx}>
                        <span className="font-medium">{r.sourceName}</span> — {r.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setRejections([])}
                className="p-1 rounded hover:bg-red-100 text-red-700 flex-shrink-0"
                aria-label="Dismiss"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* --- Missing bitmaps after a restore --- */}
        {missingIds.length > 0 && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="alert">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-semibold">
                  {missingIds.length === 1
                    ? 'One page image is no longer stored in this browser.'
                    : `${missingIds.length} page images are no longer stored in this browser.`}
                </p>
                <p className="mt-1">
                  Re-upload{' '}
                  {pages
                    .map((p, idx) => ({ p, idx }))
                    .filter(({ p }) => !pageUrls[p.id])
                    .map(({ idx }) => `page ${idx + 1}`)
                    .join(', ')}{' '}
                  using the button on each empty slot. The answers already cut from those pages are
                  kept, and re-uploading the same page cuts them again from the new photo.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* --- The same sheet photographed twice --- */}
        {duplicateK.length > 0 && (
          <p className="text-sm text-amber-900 bg-amber-50 border border-amber-300 rounded-lg px-4 py-3" role="alert">
            You have uploaded {duplicateK.length === 1 ? 'page' : 'pages'}{' '}
            {duplicateK.join(', ')} more than once. Only the last photo of each is used for your
            answers — remove the ones you do not want.
          </p>
        )}

        {/* --- Pages the assignment has that are not here yet --- */}
        {missingK.length > 0 && (
          <p className="text-sm text-blue-900 bg-blue-50 border border-blue-200 rounded-lg px-4 py-3">
            This assignment has {declaredN} pages. You have not photographed{' '}
            {missingK.length === 1 ? 'page' : 'pages'} {missingK.join(', ')} yet. If you left a page
            blank on purpose you can still submit.
          </p>
        )}

        {/* --- Size guard --- */}
        {overBudget && (
          <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
            These pages total {formatBytes(totalBytes)}, above the {formatBytes(PAGE_TOTAL_SIZE_TARGET)} we
            aim for. You can still submit — but check you have not uploaded the same page twice.
          </p>
        )}

        {/* --- Gallery --- */}
        {pages.length === 0 ? (
          <p className="text-sm text-gray-400 italic text-center py-6">No pages uploaded yet.</p>
        ) : (
          <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {pages.map((page, idx) => {
              const url = pageUrls[page.id];
              const warnings = page.warnings ?? [];
              return (
                <li
                  key={page.id}
                  className="border border-gray-200 rounded-lg overflow-hidden bg-gray-50 flex flex-col"
                >
                  <div className="relative bg-white aspect-[3/4] flex items-center justify-center overflow-hidden">
                    {url ? (
                      <img
                        src={url}
                        alt={`Page ${idx + 1}`}
                        className="object-contain w-full h-full"
                      />
                    ) : (
                      <div className="flex flex-col items-center gap-2 p-3 text-center">
                        <AlertTriangle className="w-6 h-6 text-amber-500" />
                        <span className="text-xs text-gray-500">Image not stored</span>
                        <button
                          type="button"
                          onClick={() => startReplace(page.id)}
                          className="text-xs font-medium text-blue-700 hover:text-blue-600 underline"
                        >
                          Re-upload page {idx + 1}
                        </button>
                      </div>
                    )}
                    <span className="absolute top-1 left-1 bg-slate-900/80 text-white text-xs font-semibold px-2 py-0.5 rounded">
                      {page.registration?.k ? `p${page.registration.k}` : idx + 1}
                    </span>
                    <button
                      type="button"
                      onClick={() => onRemovePage(page.id)}
                      className="absolute top-1 right-1 bg-red-600 hover:bg-red-500 text-white p-1 rounded-full"
                      aria-label={`Remove page ${idx + 1}`}
                      title={`Remove page ${idx + 1}`}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="p-2 space-y-2">
                    <div className="flex items-center justify-between gap-1">
                      <button
                        type="button"
                        onClick={() => onMovePage(page.id, -1)}
                        disabled={idx === 0}
                        className="p-1.5 rounded border border-gray-300 bg-white text-gray-700 hover:bg-gray-100 disabled:opacity-40 disabled:hover:bg-white"
                        aria-label={`Move page ${idx + 1} earlier`}
                        title="Move earlier"
                      >
                        <ArrowLeft className="w-3.5 h-3.5" />
                      </button>
                      <span className="text-[11px] text-gray-500">
                        {page.bytes ? formatBytes(page.bytes) : '—'}
                      </span>
                      <button
                        type="button"
                        onClick={() => onMovePage(page.id, 1)}
                        disabled={idx === pages.length - 1}
                        className="p-1.5 rounded border border-gray-300 bg-white text-gray-700 hover:bg-gray-100 disabled:opacity-40 disabled:hover:bg-white"
                        aria-label={`Move page ${idx + 1} later`}
                        title="Move later"
                      >
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {url && (
                      <div className="grid grid-cols-2 gap-1.5">
                        {/* Rotation is the catch-all for a misoriented page:
                            it fixes paper turned the wrong way round, which no
                            amount of EXIF handling can detect. */}
                        <button
                          type="button"
                          onClick={() => void handleRotate(page.id)}
                          disabled={rotatingId !== null || busy !== null}
                          className="min-h-[44px] flex items-center justify-center gap-1 rounded border border-gray-300 bg-white text-gray-700 hover:bg-gray-100 disabled:opacity-40 text-[11px] font-medium"
                          aria-label={`Rotate page ${idx + 1}`}
                          title="Rotate 90° clockwise"
                        >
                          {rotatingId === page.id
                            ? <RefreshCw className="w-4 h-4 animate-spin" />
                            : <RotateCw className="w-4 h-4" />}
                          Rotate
                        </button>
                        <button
                          type="button"
                          onClick={() => startReplace(page.id, hasCamera ? 'camera' : 'file')}
                          disabled={rotatingId !== null || busy !== null}
                          className="min-h-[44px] flex items-center justify-center gap-1 rounded border border-gray-300 bg-white text-gray-700 hover:bg-gray-100 disabled:opacity-40 text-[11px] font-medium"
                          aria-label={`${hasCamera ? 'Retake' : 'Replace'} page ${idx + 1}`}
                          title={hasCamera ? 'Retake this page with the camera' : 'Replace this page with another file'}
                        >
                          {hasCamera ? <Camera className="w-4 h-4" /> : <Upload className="w-4 h-4" />}
                          {hasCamera ? 'Retake' : 'Replace'}
                        </button>
                        {/* Fallback when the camera is denied or unavailable —
                            the retake must never become a dead end. */}
                        {hasCamera && (
                          <button
                            type="button"
                            onClick={() => startReplace(page.id, 'file')}
                            disabled={rotatingId !== null || busy !== null}
                            className="col-span-2 min-h-[44px] flex items-center justify-center gap-1 rounded border border-gray-200 bg-slate-50 text-gray-600 hover:bg-slate-100 disabled:opacity-40 text-[11px]"
                            aria-label={`Replace page ${idx + 1} with a file`}
                            title="Choose a file instead"
                          >
                            <Upload className="w-3.5 h-3.5" />
                            Choose file instead
                          </button>
                        )}
                      </div>
                    )}

                    {/* What registration made of this page. A student whose
                        photo did not line up needs to know here, holding the
                        paper, not at submission time. */}
                    {url && page.registration && page.registration.status !== 'ok' && (
                      <div className={`text-[11px] rounded p-1.5 border ${
                        page.registration.status === 'pending'
                          ? 'text-slate-600 bg-slate-50 border-slate-200'
                          : page.registration.status === 'degraded'
                            ? 'text-amber-900 bg-amber-50 border-amber-200'
                            : 'text-red-800 bg-red-50 border-red-200'
                      }`}>
                        {page.registration.status === 'pending'
                          ? 'Reading this page…'
                          : page.registration.message
                            ?? 'This page could not be read. Retake it flat, with all four corners in frame.'}
                      </div>
                    )}
                    {url && page.registration?.status === 'ok' && (
                      <p className="text-[11px] text-green-800 bg-green-50 border border-green-200 rounded p-1.5">
                        Read as page {page.registration.k} of {page.registration.n}.
                      </p>
                    )}

                    {warnings.length > 0 && (
                      <div className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded p-1.5 space-y-1">
                        {warnings.map((w, wIdx) => (
                          <p key={wIdx} className="flex items-start gap-1">
                            <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                            <span>{w}</span>
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <p className="text-xs text-gray-500">
          You do not have to upload the pages in order. Each page says which page of the assignment
          it is, in the code printed in its top-right corner, and your answers are cut out from
          that. Check them in the next section before you submit.
        </p>
      </div>
    </section>
  );
};

export default PageUploader;
