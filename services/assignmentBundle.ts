/**
 * assignmentBundle.ts — the student loads one file, whatever it is called.
 *
 * ## The spec is found by what it IS, not by what it is called
 *
 * This loader used to look inside a zip for an entry **named**
 * `assignment_spec.json`. On 2026-09-06 the Assignment Maker began writing that
 * file as `{stem}_OPEN_IN_APP.json` and attaching one zip to Canvas holding the
 * PDF and the spec. A student who uploads the zip they were given — which is
 * the thing they were given — was told *"That zip has no assignment_spec.json
 * in it"* while holding exactly the right file.
 *
 * So an entry qualifies as the spec **structurally**: its text begins `gb1:`,
 * or it parses as a JSON object. No decryption is needed for that decision —
 * the prefix is a cheap test and the decode happens later, in `App.tsx`. A PDF
 * is binary and cannot qualify; a layout CSV starts with its header row and
 * cannot either.
 *
 *   - exactly one qualifying entry → that is the spec, under any name
 *   - more than one → refuse. Ambiguity must stay an error
 *   - none → refuse, and say what the zip did contain
 *
 * **There is no filename matching for the spec anywhere in this file, and none
 * may be added.** A rule keyed to a name is what caused this, the names have
 * already changed once, and a special case for `_OPEN_IN_APP.json` would be the
 * same defect wearing the next name along.
 *
 * The `layout_*.csv` lookup is still by name, deliberately and narrowly: the
 * work order left it unchanged, and "a separate CSV wins over the embedded map"
 * makes a false positive there worse than a miss — it would displace a correct
 * map with whatever else matched. **That is a known residual of the same
 * shape**, one file along: rename the CSV and this trap returns for the map.
 *
 * ## What still loads, unchanged
 *
 *     an old three-file zip     assignment_spec.json + layout_{ID}.csv + PDF
 *     a bare spec, any name     electronic assignments, and everything already
 *                               in circulation
 *
 * **Since 2026-09-06 a bare spec can be a COMPLETE handwritten assignment.**
 * The spec may carry the map inside it as `layoutCsv` / `layoutCsvName`, so the
 * student receives a sheet to print and one file to upload, with nothing to
 * open and no second file to choose wrongly. `chooseLayoutSource` decides
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
import { LAYOUT_COLUMNS } from './layoutMap';

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

// ---- what a file IS, from its own bytes ---------------------------------
//
// Every test below reads the leading bytes and never the name. They are the
// whole reason a renamed spec still loads, so they are exported and tested
// directly rather than being reachable only through `loadAssignmentBundle`.

/**
 * The `gb1:` envelope prefix. Deliberately NOT `gb2:`: this app holds no gb2
 * private key and `cryptoService.ts` exports no gb2 decrypt, so a gb2 file is
 * not something the loader could go on to open. Accepting one here would only
 * move the failure later and make it less clear.
 */
const GB1_PREFIX = 'gb1:';
const PDF_MAGIC = '%PDF-';

/** First byte that is not a UTF-8 BOM or ASCII whitespace. */
const firstMeaningfulByte = (bytes: Uint8Array): number => {
  let i = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
  while (i < bytes.length && (bytes[i] === 0x20 || bytes[i] === 0x09 || bytes[i] === 0x0a || bytes[i] === 0x0d)) i++;
  return i;
};

const hasAsciiPrefix = (bytes: Uint8Array, prefix: string, from = 0): boolean => {
  if (bytes.length - from < prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) if (bytes[from + i] !== prefix.charCodeAt(i)) return false;
  return true;
};

/**
 * Is this the assignment spec? `gb1:`, or a JSON object.
 *
 * The `{` check runs first so a 1.6 MB PDF is rejected on one byte rather than
 * being decoded as UTF-8 and handed to `JSON.parse`. A JSON *array* does not
 * qualify — the spec is an object, and `[` never reaches the parse.
 */
export const looksLikeSpec = (bytes: Uint8Array): boolean => {
  const at = firstMeaningfulByte(bytes);
  if (hasAsciiPrefix(bytes, GB1_PREFIX, at)) return true;
  if (bytes[at] !== 0x7b /* { */) return false;
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  } catch {
    return false;
  }
};

export const looksLikePdf = (bytes: Uint8Array): boolean =>
  hasAsciiPrefix(bytes, PDF_MAGIC, firstMeaningfulByte(bytes));

/**
 * A layout map, recognised by its header row carrying every declared column —
 * read from `LAYOUT_COLUMNS`, so this cannot drift from the real contract. Used
 * only to tell a student which wrong file they picked; the map itself is still
 * located by name.
 */
export const looksLikeLayoutCsv = (bytes: Uint8Array): boolean => {
  const head = new TextDecoder().decode(bytes.subarray(0, 512)).replace(/^﻿/, '');
  const header = (head.split(/\r\n|\n|\r/)[0] ?? '').toLowerCase();
  const cells = new Set(header.split(',').map(c => c.trim()));
  return LAYOUT_COLUMNS.every(c => cells.has(c));
};

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
    // A student who picked the wrong file is told WHICH wrong file. Both of
    // these sit in the same download as the spec and are the two plausible
    // mistakes; anything else falls through to the caller's generic message.
    if (looksLikePdf(bytes)) {
      throw new BundleError(
        'That is the sheet you print, not the file you load.\n\n' +
        'Print it, write your answers on it, then come back and load the other file from the ' +
        'same download.'
      );
    }
    if (looksLikeLayoutCsv(bytes)) {
      throw new BundleError(
        'That is the layout file, and you do not load it on its own.\n\n' +
        'It travels inside the assignment file. Load the other file from the same download — ' +
        'the one you print the PDF from, or the one named for your assignment.'
      );
    }
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

  // Each entry is read once and classified by its own bytes. The read is the
  // decompression jszip would do anyway; `looksLikeSpec` rejects a PDF on its
  // first meaningful byte rather than decoding megabytes as text.
  const read = await Promise.all(files.map(async f => ({
    file: f,
    name: baseName(f.name),
    bytes: await f.async('uint8array'),
  })));

  const specFiles = read.filter(e => looksLikeSpec(e.bytes));
  if (specFiles.length === 0) {
    // Name the two files a student is most likely to be holding instead, since
    // a bare list of names does not tell them what to do next.
    const pdf = read.find(e => looksLikePdf(e.bytes));
    const hint = pdf
      ? `\n\nThat zip does hold ${pdf.name}, which is the sheet you print. The file you load ` +
        'should be in the same download.'
      : '';
    throw new BundleError(
      'That zip has no assignment file in it.\n\n' +
      'Load the assignment your instructor gave you — the zip or the file you printed the PDF ' +
      `from. This zip contains: ${entries.map(e => e.name).join(', ') || '(nothing)'}${hint}`
    );
  }
  if (specFiles.length > 1) {
    throw new BundleError(
      'That zip has more than one assignment file in it, so there is no way to tell which ' +
      'assignment you meant. Load the zip for a single assignment.\n\n' +
      `Those files are: ${specFiles.map(e => e.name).join(', ')}`
    );
  }

  const layoutFiles = files.filter(f => /^layout_.+\.csv$/i.test(baseName(f.name)));
  if (layoutFiles.length > 1) {
    throw new BundleError(
      'That zip has more than one layout file in it, so there is no way to tell which sheet you ' +
      'printed. Load the zip for a single assignment.'
    );
  }

  const decoder = new TextDecoder();
  const specText = decoder.decode(specFiles[0].bytes).trim();
  const layout = layoutFiles.length === 1
    ? { name: baseName(layoutFiles[0].name), text: await layoutFiles[0].async('string') }
    : null;

  return { kind: 'zip', specText, layout, entries };
};
