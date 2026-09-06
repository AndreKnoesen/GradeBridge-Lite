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
 * nothing.
 *
 * **Since 2026-09-06 a bare spec can be a COMPLETE handwritten assignment.**
 * The spec may carry the map inside it as `layoutCsv` / `layoutCsvName`, so
 * the student receives a sheet to print and one file to upload, with nothing
 * to open and no second file to choose wrongly. `chooseLayoutSource` decides
 * between the two, and a separate `layout_*.csv` still wins.
 *
 * A *handwritten* assignment with a map from neither place is refused by the
 * caller at load time: it can be photographed but never cropped, and a student
 * must not get sixteen pages in before finding that out.
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

// ---- where the map came from --------------------------------------------

/** The map to parse, and which of the two places it was found in. */
export interface LayoutSource {
  name: string;
  text: string;
  from: 'bundle' | 'spec';
}

/** Only the two fields of the spec this decision reads. */
export interface EmbeddedLayoutFields {
  layoutCsvName?: unknown;
  layoutCsv?: unknown;
}

/** Blank is absent. A generator writing `""` has written nothing. */
const presentString = (v: unknown): string | null =>
  typeof v === 'string' && v.trim().length > 0 ? v : null;

/**
 * Which layout map to use: the one beside the spec, or the one inside it.
 *
 * **A separate `layout_*.csv`, when present, wins.** Every packet already in
 * circulation is that shape, and a tester holding one must not have his run
 * depend on when he starts it. The embedded copy is what makes a single spec
 * file a complete assignment; it is not a replacement for the file that has
 * always worked.
 *
 * Half a pair is refused rather than ignored. The contract is "both fields or
 * neither", so a spec carrying one of them was built by something broken, and
 * saying that is more use than falling through to "this file has no map in it".
 * It cannot fire on valid material, because valid material never has one.
 */
export const chooseLayoutSource = (
  bundleLayout: { name: string; text: string } | null,
  spec: EmbeddedLayoutFields | null | undefined,
): LayoutSource | null => {
  if (bundleLayout) return { ...bundleLayout, from: 'bundle' };

  const text = presentString(spec?.layoutCsv);
  const name = presentString(spec?.layoutCsvName);
  if (text && name) return { name, text, from: 'spec' };
  if (text || name) {
    throw new BundleError(
      'That assignment file is incomplete: it carries ' +
      (text ? 'a layout map with no file name' : 'a layout file name with no map') +
      '.\n\nDownload the assignment file from your course again, and tell your instructor if ' +
      'the new one does the same thing.'
    );
  }
  return null;
};

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
