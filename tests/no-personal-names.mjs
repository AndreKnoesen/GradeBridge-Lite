// =====================================================
// Nothing tracked points at a person or a machine
// =====================================================
// Three scans over every tracked file, one process, one exit code:
//
//   1. no absolute path — no drive letter, no user-home or home-directory
//      path segment, no such directory named as a quoted path component
//   2. no metadata in a tracked image — no EXIF beyond an orientation flag in a
//      JPEG, no text or provenance chunk in a PNG
//   3. no personal name, as a whole token, against a hashed list
//
// The rule behind check 3, why it exists, and why the list is hashed rather
// than written out are all in `tests/forbiddenNames.mjs` — as is the honest
// account of what a hashed list can and cannot catch.
//
// **Checks 1 and 2 need no name list, and that is the point.** A shortened
// personal name got past check 3 for as long as it existed. What did not get
// past anything was a structural rule: a photograph either has an EXIF block or
// it does not, and a string either contains a drive letter or it does not.
// Where a rule can be structural, make it structural.
//
// It tokenises every tracked file into letter runs, hashes each token the same
// way the list was hashed, and fails on a match. Hashing what it finds is what
// lets the list stay hashed: neither this file nor that one contains a name, so
// **neither needs an exemption from its own scan**, and both are scanned like
// everything else.
//
// The failure message prints the offending line, which necessarily contains the
// name. That is runtime output on a developer's terminal, not something stored
// in the repository, and it is the difference between a guard you can act on
// and one that says only "a name is somewhere in the tree".
//
// Why this exists at all: the same class of thing drifted once already. A name
// and student ID line was ordered removed on 2026-08-15 and survived on two
// export paths for three weeks, because the guard was scoped to one file. This
// one is scoped to every tracked file.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FORBIDDEN_NAME_HASHES, hashName } from './forbiddenNames.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Paths where a match is a known false positive, with the evidence.
 *
 * **Excluded by path, never by deleting the fixture.** This capture is one of
 * the eleven photographs the whole detector is calibrated against.
 *
 * The entry says nothing about which name collided, because that would put back
 * the mapping this guard exists to keep out. What it says is where the bytes
 * are and why they cannot be a name: a four-letter run inside the compressed
 * scan data of a JPEG, far past the end of its metadata.
 */
const EXCUSED = new Map([
  ['tests/captures/real/cap02.jpg',
   'a letter run at ~byte 803093 of 1,379,962 bytes of compressed JPEG scan ' +
   'data. Its metadata segment ends at byte 2562, so this is image ' +
   'content and not a name.'],
]);

let failed = 0;
const fail = (msg) => { console.error(`  FAIL  ${msg}`); failed++; };

const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: REPO, maxBuffer: 64 << 20 })
  .toString('utf8').split('\0').filter(Boolean);

const contents = new Map();
for (const path of tracked) {
  try { contents.set(path, readFileSync(resolve(REPO, path))); } catch { /* gone */ }
}

console.log(`\nno local traces — ${tracked.length} tracked files\n`);

// =====================================================
// 1. No absolute path
// =====================================================
// A path into somebody's machine publishes a username, and often a surname as a
// folder and the shape of their Documents tree. Three of these lived as
// harmless-looking `??` defaults on test harnesses until 2026-09-03.
//
// Three shapes are matched:
//
//   a DRIVE LETTER — one letter, a colon, a separator, not preceded by a letter
//     or a digit. The lookbehind is the whole difference between this and a
//     pattern that fires on every URL scheme in `package-lock.json`.
//   a USER-HOME SEGMENT — the users or home directory as a path component.
//   the SAME DIRECTORY QUOTED — which is how `join('C', ...)` spells an
//     absolute path a component at a time, with no separator anywhere in it.
//     Two of the three findings on 2026-09-03 were written that way.
//
// **The strings are assembled from fragments below rather than written out, so
// that this file does not contain what it forbids.** That is the same property
// check 3 depends on — neither this file nor the hash list contains a name —
// and it is why neither needs an exemption from its own scan. An exemption for
// the scanner is a hole in the scanner, and it is a hole exactly where somebody
// working on the scanner would put a path.
//
// **Expect false positives from regexes and from prose elsewhere.** The fix is
// an entry in EXCUSED_LINES naming the exact file and line and saying why,
// never a looser pattern: a pattern loosened to admit one legitimate string
// admits every illegitimate one shaped like it.
const HOME_DIRS = ['Us' + 'ers', 'ho' + 'me'];
const DOCS_DIR = 'Docu' + 'ments';

const PATH_PATTERNS = [
  { name: 'drive letter', re: /(?<![A-Za-z0-9])[A-Za-z]:[\\/]/ },
  { name: 'user-home path segment', re: new RegExp(`/(?:${HOME_DIRS.join('|')})/`) },
  {
    name: 'quoted path component',
    re: new RegExp(`['"](?:${HOME_DIRS[0]}|${DOCS_DIR})['"]`),
  },
];

/**
 * `path:line` -> why the match there is not an absolute path.
 *
 * Empty in this repository. The Assignment Maker's copy carries one entry, for
 * a Windows temp path inside its LaTeX-escaping fixture: a string under test,
 * not a path anything opens.
 */
const EXCUSED_LINES = new Map();

/**
 * Text, for the purposes of check 1.
 *
 * A NUL byte anywhere is git's own test and it is the right one here: a
 * photograph's compressed scan data will sooner or later contain a home-
 * directory segment by chance, and failing on that would teach the next person
 * to disable this check rather than read it.
 */
const isText = (buf) => !buf.includes(0);

{
  let scanned = 0;
  for (const [path, buf] of contents) {
    if (!isText(buf)) continue;
    scanned++;
    const lines = buf.toString('utf8').split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      for (const { name, re } of PATH_PATTERNS) {
        if (!re.test(lines[i])) continue;
        const at = `${path}:${i + 1}`;
        if (EXCUSED_LINES.has(at)) continue;
        const shown = lines[i].length > 140 ? `${lines[i].slice(0, 140)}…` : lines[i];
        fail(`an absolute path (${name}) in ${at}\n          ${shown.trim()}`);
      }
    }
  }
  console.log(`  1. no absolute path — ${scanned} text files`);
}

// An exemption for a line that has moved protects nothing and hides the next
// real match behind a stale entry.
for (const at of EXCUSED_LINES.keys()) {
  const [path] = at.split(':');
  if (!tracked.includes(path)) {
    fail(`the excused line ${at} is in a file that is no longer tracked — ` +
      `delete its entry rather than leaving an exemption that protects nothing`);
  }
}

// =====================================================
// 2. No metadata in a tracked image
// =====================================================
// Sixteen tracked photographs carried an intact EXIF block naming the camera
// make and model, the operating system version and the capture time to the
// second, plus a 1.5 KB MakerNote and an embedded thumbnail. A tracked logo
// carried an XMP packet and a C2PA provenance manifest. None of that is pixel
// data and none of it belongs in a public repository.
//
// **This is structural and needs no name list**, which is what makes it worth
// more than check 3.
//
// THE ONE THING A JPEG MAY STILL CARRY, AND WHY
//
//   A minimal APP1 holding nothing but the Orientation tag: 34 bytes, one IFD0
//   entry, no second IFD. All sixteen photographs are orientation 6 or 3, and
//   the pipeline under test reads that flag and stands the page upright before
//   anything else touches it. Dropping it would leave every one of them
//   sideways and move the detection table; baking the rotation into the pixels
//   would mean re-encoding the evidence. So the identifying block goes and the
//   one functional field stays.
//
//   Anything else — a larger Exif block, an ICC profile, a maker's APPn, a
//   comment — fails, by marker and by size rather than by content.
const jpegSegments = (buf) => {
  if (buf.length < 4 || buf.readUInt16BE(0) !== 0xffd8) return null;
  const out = [];
  let offset = 2;
  while (offset + 4 <= buf.length) {
    // Resync past 0xFF fill bytes, exactly as imageIngest.readJpegInfo does.
    if (buf[offset] !== 0xff) { offset++; continue; }
    let markerAt = offset + 1;
    while (markerAt < buf.length && buf[markerAt] === 0xff) markerAt++;
    if (markerAt >= buf.length) break;
    const marker = buf[markerAt];
    offset = markerAt + 1;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (marker === 0xda || marker === 0xd9) break;      // start of scan / end
    if (offset + 2 > buf.length) break;
    const size = buf.readUInt16BE(offset);
    if (size < 2) break;
    out.push({ marker, size, payloadStart: offset + 2 });
    offset += size;
  }
  return out;
};

/** A 34-byte APP1 whose whole content is one IFD0 Orientation entry. */
const isOrientationOnlyExif = (buf, seg) => {
  if (seg.size !== 34) return false;
  const tiff = seg.payloadStart + 6;
  if (buf.readUInt16BE(tiff) !== 0x4d4d) return false;     // big-endian only
  if (buf.readUInt16BE(tiff + 2) !== 0x002a) return false;
  if (buf.readUInt32BE(tiff + 4) !== 8) return false;      // IFD0 at +8
  if (buf.readUInt16BE(tiff + 8) !== 1) return false;      // exactly one entry
  if (buf.readUInt16BE(tiff + 10) !== 0x0112) return false; // and it is Orientation
  return buf.readUInt32BE(tiff + 22) === 0;                // no IFD1
};

const APP_NAME = (m) => (m === 0xfe ? 'COM' : `APP${m - 0xe0}`);

/**
 * PNG chunks that say how to render the pixels, not who made them.
 *
 * An allowlist rather than a list of banned types: `tEXt`, `iTXt` and `eXIf`
 * are the ones anybody thinks of, and the logo in this repository was carrying
 * `caBX` — 16 KB of C2PA provenance nobody would have written a rule for.
 */
const PNG_KEEP = new Set([
  'IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'sRGB', 'gAMA', 'pHYs', 'cHRM',
  'iCCP', 'sBIT', 'bKGD',
]);

const pngChunks = (buf) => {
  const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buf.length < 8 || !buf.subarray(0, 8).equals(SIG)) return null;
  const out = [];
  let o = 8;
  while (o + 8 <= buf.length) {
    const len = buf.readUInt32BE(o);
    const type = buf.subarray(o + 4, o + 8).toString('latin1');
    out.push({ type, len });
    o += 12 + len;
    if (type === 'IEND') break;
  }
  return out;
};

{
  let scanned = 0;
  for (const [path, buf] of contents) {
    if (/\.jpe?g$/i.test(path)) {
      scanned++;
      const segs = jpegSegments(buf);
      if (!segs) { fail(`${path} does not parse as a JPEG`); continue; }
      for (const seg of segs) {
        const isApp = seg.marker >= 0xe0 && seg.marker <= 0xef;
        if (!isApp && seg.marker !== 0xfe) continue;
        const isExif = seg.marker === 0xe1 &&
          buf.subarray(seg.payloadStart, seg.payloadStart + 6).toString('latin1') === 'Exif\0\0';
        if (isExif && isOrientationOnlyExif(buf, seg)) continue;
        fail(`${path} carries a ${APP_NAME(seg.marker)} segment of ${seg.size} bytes` +
          `${isExif ? ' (Exif, beyond an orientation flag)' : ''} — strip it without ` +
          `re-encoding the image, so the entropy-coded scan stays byte-identical`);
      }
    } else if (/\.png$/i.test(path)) {
      scanned++;
      const chunks = pngChunks(buf);
      if (!chunks) { fail(`${path} does not parse as a PNG`); continue; }
      for (const c of chunks) {
        if (PNG_KEEP.has(c.type)) continue;
        fail(`${path} carries a ${c.type} chunk of ${c.len} bytes — strip it; ` +
          `only pixel and rendering chunks belong in a tracked image`);
      }
    }
  }
  console.log(`  2. no metadata in a tracked image — ${scanned} images`);
}

// =====================================================
// 3. No personal name
// =====================================================
console.log(`  3. no personal names`);

/**
 * Every letter run of at least `min`, from one decoding of the bytes.
 *
 * **`min` is 3 in a text file and 4 in a binary one, and that is a measurement
 * rather than a preference.** A three-letter entry was added to the list on
 * 2026-09-03 — the shortened form of a name that had been used as a capture-set
 * prefix. Scanned at three letters over the 25 MB of compressed photographs in
 * this repository it collided by chance in six of the sixteen, twice each. The
 * alternative was excusing six of the sixteen photographs outright, which would
 * have switched the name scan off across most of the evidence in order to keep
 * a check that cannot work there: three letters of entropy do not survive 25 MB
 * of arithmetic-coded data.
 *
 * So a short entry is enforced where a short identifier actually lives — in
 * source, in data files, in documentation — and not inside a JPEG's scan. Say
 * so plainly rather than tuning the number until the output is green.
 */
const tokensOf = (text, min) => {
  const out = new Set();
  const re = new RegExp(`\\p{L}{${min},}`, 'gu');
  let m;
  while ((m = re.exec(text)) !== null) out.add(m[0]);
  return out;
};

/**
 * **Each file is read twice, and both readings are needed.**
 *
 * `utf8` with a Unicode letter class is what catches an accented name.
 * `hashName` folds accents, but it only ever sees what the tokeniser hands it,
 * and an ASCII-only tokeniser breaks a name at its accented letter into two
 * fragments that hash to nothing. That gap was real: it survived the first
 * version of this guard, and was found by reintroducing a name in accented form
 * and watching the guard stay silent.
 *
 * `latin1` is byte-preserving and is what catches a name sitting inside a
 * binary, where a utf8 decode would replace the bytes with U+FFFD and destroy
 * the very sequence being looked for.
 */
const READINGS = ['utf8', 'latin1'];

let scanned = 0, excusedHits = 0;
for (const [path, buf] of contents) {
  scanned++;

  const min = isText(buf) ? 3 : 4;
  const hits = new Set();
  const decodings = [];
  for (const encoding of READINGS) {
    const decoded = buf.toString(encoding);
    decodings.push(decoded);
    for (const token of tokensOf(decoded, min)) {
      if (FORBIDDEN_NAME_HASHES.has(hashName(token))) hits.add(token);
    }
  }
  if (hits.size === 0) continue;
  if (EXCUSED.has(path)) { excusedHits += hits.size; continue; }

  // Locate each hit so the failure names a line, not just a file. Both
  // decodings are searched: a token found in one may not appear literally
  // in the other.
  for (const token of hits) {
    const re = new RegExp(token, "i");
    const at = decodings
      .flatMap((d) => d.split(/\r?\n/).map((line, n) => ({ line, n })))
      .filter(({ line }) => re.test(line))
      .slice(0, 3);
    if (at.length === 0) {
      fail(`a forbidden name appears in ${path} (not on any line — binary?)`);
      continue;
    }
    for (const { line, n } of at) {
      const shown = line.length > 140 ? `${line.slice(0, 140)}…` : line;
      fail(`a forbidden name in ${path}:${n + 1}\n          ${shown.trim()}`);
    }
  }
}

// An exemption for a file that has gone protects nothing and hides the next
// real match behind a stale entry.
for (const [path, why] of EXCUSED) {
  if (!tracked.includes(path)) {
    fail(`the excused path ${path} is no longer tracked — delete its entry ` +
      `rather than leaving an exemption that protects nothing`);
  } else {
    console.log(`  note  ${path} excused — ${why}`);
  }
}

console.log(`\n  ${scanned} files read, ${excusedHits} excused match(es)`);
if (failed > 0) {
  console.error(`\n  ${failed} finding(s). Fix them in the file named above. For a ` +
    `name, do NOT remove it from tests/forbiddenNames.mjs — that list is what is ` +
    `forbidden, not what is permitted.\n`);
  process.exit(1);
}
console.log('  nothing tracked points at a person or a machine\n');
