// =====================================================
// Blob download — the one place a file leaves the app
// =====================================================
// Both downloads the student can start (Save Backup, Download for Gradescope)
// go through here. They used to be two copies of the same snippet, and both
// carried the same iOS Safari bug:
//
//   const url = URL.createObjectURL(blob);
//   a.href = url; a.download = name; a.click();
//   URL.revokeObjectURL(url);          // <-- synchronous
//
// On a desktop the browser starts fetching the blob during click(), so
// revoking on the next line is harmless. iOS Safari instead *defers* the
// download behind its own "Do you want to download …?" confirmation. By the
// time the student taps Download, the object URL has already been revoked and
// there is nothing left to fetch: the prompt appears, the tap does nothing,
// and no file is ever written. Observed on a real iPhone against v3.7.3 —
// backup, and by construction the submission ZIP too.
//
// So the URL has to outlive the click. It is released on a timer instead,
// long enough for a student to read the prompt and decide. The cost of the
// delay is one blob held a minute longer; the cost of getting it wrong is a
// submission that silently never downloads.
//
// No library was added for this (FileSaver and friends): the app's
// zero-third-party-request property is verified, and the fix is a timer.
// =====================================================

/**
 * How long a download's object URL stays alive after the click.
 *
 * Covers a student reading Safari's confirmation prompt and tapping through
 * it. Anything they leave sitting longer than this loses the download rather
 * than leaking the blob for the rest of the session.
 */
export const DOWNLOAD_URL_TTL_MS = 60_000;

/**
 * Hands `blob` to the browser as a download named `filename`.
 *
 * Must be called from a user gesture — a browser may refuse a download that
 * is not traceable to a tap or click.
 *
 * There is no reliable signal that a download finished (iOS gives none at
 * all), so this returns nothing and callers must not tell the student the
 * file is saved. Say a file was *created* and that they may need to confirm
 * the download; anything stronger is a claim we cannot check.
 */
export const downloadBlob = (blob: Blob, filename: string): void => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  anchor.style.display = 'none';

  // Attached before the click: a detached anchor's click() is ignored by some
  // WebKit builds, which is the other way this quietly does nothing.
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  // The anchor is finished the moment it is clicked. The URL is not — see
  // above; this is the actual fix.
  setTimeout(() => URL.revokeObjectURL(url), DOWNLOAD_URL_TTL_MS);
};
