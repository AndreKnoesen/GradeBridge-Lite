/**
 * assignmentBundle.ts — the student loads one file, and it is the zip.
 *
 * The unit the instructor hands out is the `student/` folder of the export,
 * zipped:
 *
 *     assignment.pdf          the student prints this; this app ignores it
 *     assignment_spec.json    the questions, gb1- or gb2-encoded as today
 *     layout_{ID}.csv         the geometry
 *
 * A bare `assignment_spec.json` still loads. Electronic assignments have no
 * map and never needed one, and every file already in circulation is a bare
 * spec — a loader that stopped accepting one would break them all to buy
 * nothing. A *handwritten* assignment loaded without a map is a different
 * matter: it can be photographed but never cropped, and the caller says so
 * plainly at load time rather than letting it fail somewhere further down.
 *
 * `jszip` was already a dependency (the submission package is a zip), so this
 * adds no bundle weight and no network surface.
 */

import JSZip from 'jszip';

export interface BundleEntry {
  name: string;
  /** Path as stored in the zip, for diagnostics. */
  path: string;
}

export interface LoadedBundle {
  kind: 'zip' | 'json';
  /** Raw text of `assignment_spec.json` — still encoded if it arrived encoded. */
  specText: string;
  /** The layout map, when the bundle carries one. */
  layout: { name: string; text: string } | null;
  /** Everything the zip held, in stored order. Empty for a bare spec. */
  entries: BundleEntry[];
}

export class BundleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BundleError';
  }
}

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];

/**
 * Sniffed from the bytes, not the extension. A phone that renames a download
 * `assignment.zip.txt`, or a student who saved the spec as `bundle.zip`, both
 * still land in the right branch.
 */
export const looksLikeZip = (bytes: Uint8Array): boolean =>
  bytes.length >= 4 && ZIP_MAGIC.every((b, i) => bytes[i] === b);

/** Ignores directory prefixes, so `student/assignment_spec.json` matches too. */
const baseName = (path: string): string => path.split('/').pop() ?? path;

const isMacJunk = (path: string): boolean =>
  path.startsWith('__MACOSX/') || baseName(path).startsWith('._');

export const loadAssignmentBundle = async (file: File): Promise<LoadedBundle> => {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  if (!looksLikeZip(bytes)) {
    return { kind: 'json', specText: new TextDecoder().decode(bytes).trim(), layout: null, entries: [] };
  }

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    throw new BundleError(
      'That zip could not be opened. Download the assignment file from your course again — ' +
      'a partly downloaded file looks exactly like this.'
    );
  }

  const files = Object.values(zip.files).filter(f => !f.dir && !isMacJunk(f.name));
  const entries: BundleEntry[] = files.map(f => ({ name: baseName(f.name), path: f.name }));

  const specFiles = files.filter(f => baseName(f.name).toLowerCase() === 'assignment_spec.json');
  if (specFiles.length === 0) {
    throw new BundleError(
      'That zip has no assignment_spec.json in it.\n\n' +
      'Load the assignment zip your instructor gave you — the one you printed the PDF from. ' +
      `This zip contains: ${entries.map(e => e.name).join(', ') || '(nothing)'}`
    );
  }
  if (specFiles.length > 1) {
    throw new BundleError(
      'That zip has more than one assignment_spec.json in it, so there is no way to tell which ' +
      'assignment you meant. Load the zip for a single assignment.'
    );
  }

  const layoutFiles = files.filter(f => /^layout_.+\.csv$/i.test(baseName(f.name)));
  if (layoutFiles.length > 1) {
    throw new BundleError(
      'That zip has more than one layout file in it, so there is no way to tell which sheet you ' +
      'printed. Load the zip for a single assignment.'
    );
  }

  const specText = (await specFiles[0].async('string')).trim();
  const layout = layoutFiles.length === 1
    ? { name: baseName(layoutFiles[0].name), text: await layoutFiles[0].async('string') }
    : null;

  return { kind: 'zip', specText, layout, entries };
};
