// =====================================================
// Nothing tracked points at a person or a machine
// =====================================================
// Four scans over every tracked file, one process, one exit code:
//
//   1. no absolute path — no drive letter, no user-home or home-directory
//      path segment, no such directory named as a quoted path component
//   2. no metadata in a tracked image — no EXIF beyond an orientation flag in a
//      JPEG, no text or provenance chunk in a PNG
//   3. no personal name, as a whole token, against a hashed list
//   4. no product name — a separate hashed list, checked in paths as well as
//      contents, because what triggered that rule was a filename
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
//
// THE ASSIGNMENT MAKER IS CANONICAL for this file (supplement 3). Checks 1 and
// 2 were written here first, because this is where the photographs and the
// absolute paths were; that version went there, gained the extension-based text
// decision, the report-once fix, check 4 and the in-memory fixtures, and came
// back. **Change both or neither**, and change the canonical copy first.
//
// Only four things below are deliberately repository-specific and each says so
// where it sits: the two exclusion lists, and the two places the prose states a
// fact about which tree it is in.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FORBIDDEN_NAME_HASHES, hashName, normaliseName } from './forbiddenNames.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Paths where a check-3 match is a known false positive, with the evidence.
 *
 * **Excluded by path, never by deleting the fixture.** Any entry here must say
 * where the bytes are and why they cannot be a name — never which name
 * collided, because that would put back the mapping this guard exists to keep
 * out.
 *
 * **One entry here, and the Assignment Maker's copy has none** — its map is
 * empty and its comment says so. The difference is the evidence: this tree
 * carries 25 MB of compressed photograph, which is where a chance letter run
 * long enough to hash to a short entry actually comes from.
 */
const EXCUSED = new Map([
  ['tests/captures/real/cap02.jpg',
   'a letter run at ~byte 803093 of 1,379,962 bytes of compressed JPEG scan ' +
   'data. Its metadata segment ends at byte 2562, so this is image ' +
   'content and not a name.'],
  ['vendor/zxingReaderWasm.ts',
   'three letter runs inside 1,457,720 characters of base64 over a ' +
   '64-character alphabet. The file is generated, not written: ' +
   'tests/qr-decoder-tests.mjs decodes it and asserts it is byte-identical to ' +
   "node_modules/zxing-wasm's shipped binary and starts with the WebAssembly " +
   'magic number, so every byte in it came from a compiler and none from a ' +
   'person. Regenerate it with scripts/vendor-zxing.mjs.'],
]);

let failed = 0;
const fail = (msg) => { console.error(`  FAIL  ${msg}`); failed++; };
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: REPO, maxBuffer: 64 << 20 })
  .toString('utf8').split('\0').filter(Boolean);

const contents = new Map();
for (const path of tracked) {
  try { contents.set(path, readFileSync(resolve(REPO, path))); } catch { /* gone */ }
}

console.log(`\nno local traces — ${tracked.length} tracked files\n`);

// =====================================================
// X-1: a check that scanned nothing must say so
// =====================================================
// Three findings in one week had this shape: one NUL byte hid 143 KB of source
// from check 1; a probe next door compared twelve names against an empty set;
// check 2 scanned nothing in a repository with no images. All three were GREEN.
//
// **Green and correct look identical from outside, and that is the defect.**
//
// So every set this file compares against is counted out loud on every run, and
// an empty one fails rather than passing vacuously. A guard is allowed to find
// nothing. It is not allowed to be silent about having looked at nothing.
if (tracked.length === 0) {
  fail('git ls-files returned nothing — every check below would pass by ' +
    'scanning an empty tree');
}
if (contents.size !== tracked.length) {
  console.log(`  note  ${tracked.length - contents.size} tracked file(s) could not be ` +
    `read and were not scanned`);
}

// =====================================================
// 1. No absolute path
// =====================================================
// A path into somebody's machine publishes a username, and often a surname as a
// folder and the shape of their home directory tree. **This is the repository
// that had them:** three lived as harmless-looking `??` defaults on the test
// harnesses here until 2026-09-03, one written as a drive letter and two as
// quoted path components. The Assignment Maker had none, and added the check
// anyway — it was true there, and nothing was holding it true.
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
 * **Empty here. The Assignment Maker's copy carries two**, both the same string
 * twice: a Windows temp path inside its LaTeX-escaping fixture and the
 * assertion that checks it survives the escape. That fixture has no counterpart
 * in this repository, so there is nothing to excuse.
 *
 * The mechanism is kept rather than deleted, because the next false positive
 * here is excused the same way: by exact file and line, with a reason, and NOT
 * by loosening a pattern. A pattern relaxed to admit one legitimate string
 * admits every real absolute path shaped like it.
 *
 * A reason written here must describe the offending string rather than quote
 * it, for the same reason the patterns above are assembled from fragments: this
 * file must not contain what it forbids.
 */
const EXCUSED_LINES = new Map();

/**
 * Text, for the purposes of checks 1 and 3 — decided by EXTENSION, not content.
 *
 * **It was the NUL-byte test until 2026-09-03, and that was a silent hole.**
 * A single NUL is git's own definition of binary, and one raw NUL written
 * inside a regex in `tests/templateTests.mjs` took 143 KB of test source out of
 * check 1 completely, and dropped it to the weaker floor in check 3. Nothing was
 * printed. A mutation planting an absolute path in that file passed, and it was
 * not a bad mutation.
 *
 * The reason for the NUL test was sound — a photograph's compressed scan will
 * eventually contain a home-directory segment by chance, and a check that fires
 * on that gets switched off. But the property wanted is "this file is a
 * photograph", and the extension says so directly, where content only implies
 * it.
 *
 * **The list is of BINARY types, not textual ones, so the default is to scan.**
 * A source or data extension nobody thought of is read as text and checked;
 * under the opposite arrangement it would be skipped in silence, which is the
 * failure being fixed.
 *
 * Nothing is skipped quietly either way: every file treated as binary, and every
 * text file carrying a NUL, is named in the output below.
 */
const BINARY_EXTENSIONS = new Set([
  // images
  'png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'ico', 'tif', 'tiff', 'avif', 'heic', 'heif',
  // fonts
  'woff', 'woff2', 'ttf', 'otf', 'eot',
  // documents and archives
  'pdf', 'zip', 'gz', 'tgz', 'bz2', 'xz', '7z', 'rar', 'jar',
  // media
  'mp3', 'mp4', 'm4a', 'mov', 'avi', 'webm', 'wav', 'ogg',
  // compiled and binary data
  'wasm', 'exe', 'dll', 'so', 'dylib', 'class', 'pyc', 'bin', 'db', 'sqlite', 'sqlite3',
]);

const extensionOf = (path) => {
  const name = basename(path);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
};

const isText = (path) => !BINARY_EXTENSIONS.has(extensionOf(path));

{
  let scanned = 0;
  const skipped = [], withNul = [];
  for (const [path, buf] of contents) {
    if (!isText(path)) { skipped.push(path); continue; }
    if (buf.includes(0)) withNul.push(path);
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
  if (scanned === 0) {
    fail('check 1 scanned no text files at all — every file was classified binary, ' +
      'which cannot be right and would make this check pass by doing nothing');
  }
  console.log(`  1. no absolute path — ${scanned} text files, ` +
    `${PATH_PATTERNS.length} patterns, ${EXCUSED_LINES.size} excused line(s)`);
  // Never silently. A file this check did not read is reported, so a guard that
  // has gone quiet says so instead of passing. Grouped by extension and capped,
  // because on a repository that tracks photographs this would otherwise be
  // twenty lines of noise on every green run, and noise is how a reader learns
  // to skip the output that matters.
  if (skipped.length > 0) {
    const byExt = new Map();
    for (const path of skipped) {
      const ext = extensionOf(path) || '(none)';
      byExt.set(ext, (byExt.get(ext) || 0) + 1);
    }
    const summary = [...byExt.entries()].sort().map(([ext, n]) => `.${ext} ×${n}`).join(', ');
    console.log(`  note  ${skipped.length} file(s) not scanned as text — ${summary}`);
    for (const path of skipped.slice(0, 8)) console.log(`          ${path}`);
    if (skipped.length > 8) console.log(`          …and ${skipped.length - 8} more`);
  }
  // Scanned anyway, but a NUL in something claiming to be source is worth
  // seeing: it is what made this check silent before 2026-09-03.
  for (const path of withNul) {
    console.log(`  note  ${path} contains a NUL byte and was scanned as text anyway ` +
      `— write it as an escape (see tests/templateTests.mjs)`);
  }
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
// **This repository is where the photographs are.** Sixteen tracked ones carried
// an intact EXIF block naming the camera make and model, the operating system
// version and the capture time to the second, plus a 1.5 KB MakerNote and an
// embedded thumbnail; a tracked logo carried an XMP packet and a 16 KB C2PA
// provenance manifest. None of that is pixel data and none of it belongs in a
// public repository. The logo is now deleted in both trees under check 4; the
// photographs are stripped and stay, because they are the evidence.
//
// The Assignment Maker tracks no image at all, which is why the self-check
// below exists: there, this scan would otherwise pass by running over nothing.
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

/**
 * Every reason one image is unacceptable, as strings. Empty means clean.
 *
 * Lifted out of the scan loop so it can be run against fixtures rather than only
 * against whatever the tree happens to contain — see the self-check below.
 */
const imageFindings = (path, buf) => {
  const out = [];
  if (/\.jpe?g$/i.test(path)) {
    const segs = jpegSegments(buf);
    if (!segs) return [`${path} does not parse as a JPEG`];
    for (const seg of segs) {
      const isApp = seg.marker >= 0xe0 && seg.marker <= 0xef;
      if (!isApp && seg.marker !== 0xfe) continue;
      const isExif = seg.marker === 0xe1 &&
        buf.subarray(seg.payloadStart, seg.payloadStart + 6).toString('latin1') === 'Exif\0\0';
      if (isExif && isOrientationOnlyExif(buf, seg)) continue;
      out.push(`${path} carries a ${APP_NAME(seg.marker)} segment of ${seg.size} bytes` +
        `${isExif ? ' (Exif, beyond an orientation flag)' : ''} — strip it without ` +
        `re-encoding the image, so the entropy-coded scan stays byte-identical`);
    }
  } else if (/\.png$/i.test(path)) {
    const chunks = pngChunks(buf);
    if (!chunks) return [`${path} does not parse as a PNG`];
    for (const c of chunks) {
      if (PNG_KEEP.has(c.type)) continue;
      out.push(`${path} carries a ${c.type} chunk of ${c.len} bytes — strip it; ` +
        `only pixel and rendering chunks belong in a tracked image`);
    }
  }
  return out;
};

const isImagePath = (path) => /\.(jpe?g|png)$/i.test(path);

{
  let scanned = 0;
  for (const [path, buf] of contents) {
    if (!isImagePath(path)) continue;
    scanned++;
    for (const finding of imageFindings(path, buf)) fail(finding);
  }
  // X-1: a check that scanned nothing has to say so. This one scans zero images
  // in a repository that tracks none, and green then means "not run", which from
  // outside is indistinguishable from "passed".
  console.log(scanned === 0
    ? '  2. no metadata in a tracked image — NO TRACKED IMAGE; the scan ran over ' +
      'nothing (the self-check below is what exercises it)'
    : `  2. no metadata in a tracked image — ${scanned} images`);
}

// ---- check 2 exercises itself, on fixtures built here and tracked nowhere ----
// Check 2 used to be proven only by the tree containing a dirty image. Both
// repositories have now cleaned theirs, and this one tracks no image at all, so
// the check went green by scanning nothing and a break in either parser would
// have surfaced whenever somebody next added a photograph.
//
// The fixtures are a few dozen bytes each and are built in memory: nothing is
// tracked, so nothing here can itself become a finding for check 1 or 3.
//
// **The Orientation pair is the point of the exercise.** That exemption is the
// one deviation the strip work took, and an exception nobody probes is a hole
// with a comment over it. One tag wider must be refused.
{
  const be16 = (n) => Buffer.from([n >> 8 & 0xff, n & 0xff]);
  const be32 = (n) => Buffer.from([n >>> 24 & 0xff, n >>> 16 & 0xff, n >>> 8 & 0xff, n & 0xff]);

  const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  // The CRC is never read by pngChunks, so a placeholder keeps the fixture
  // honest about its shape without pulling in a CRC implementation.
  const pngChunk = (type, data = Buffer.alloc(0)) => Buffer.concat([
    be32(data.length), Buffer.from(type, 'latin1'), data, be32(0),
  ]);
  const png = (...extra) => Buffer.concat([
    PNG_SIG,
    pngChunk('IHDR', Buffer.alloc(13)),
    ...extra,
    pngChunk('IDAT', Buffer.alloc(8)),
    pngChunk('IEND'),
  ]);

  // An Exif APP1: 'Exif\0\0', a big-endian TIFF header, then `entries` IFD0
  // entries and a nul next-IFD pointer. One entry is the shape the exception
  // admits; two is one tag wider.
  const exifApp1 = (entries) => {
    const tags = [];
    for (let i = 0; i < entries; i++) {
      tags.push(Buffer.concat([
        be16(i === 0 ? 0x0112 : 0x0132),  // Orientation, then DateTime
        be16(3), be32(1), be32(6 << 16),
      ]));
    }
    const tiff = Buffer.concat([
      Buffer.from('MM', 'latin1'), be16(0x002a), be32(8),
      be16(entries), ...tags, be32(0),
    ]);
    const payload = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
    return Buffer.concat([Buffer.from([0xff, 0xe1]), be16(payload.length + 2), payload]);
  };

  // A one-entry Exif with junk after the IFD. Size 34 is what the exception
  // pins, and the entry count alone does not catch this: mutating `size !== 34`
  // to `size >= 34` left every other fixture still refused, because they widen
  // the IFD. This is the shape that slips through when only the size is relaxed,
  // and it is here because that mutation survived without it.
  const exifApp1WithTrailer = (trailer) => {
    const base = exifApp1(1);
    const payload = Buffer.concat([base.subarray(4), Buffer.alloc(trailer)]);
    return Buffer.concat([Buffer.from([0xff, 0xe1]), be16(payload.length + 2), payload]);
  };

  const jpeg = (...segments) => Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    ...segments,
    Buffer.from([0xff, 0xdb]), be16(4), Buffer.alloc(2),   // a DQT, so it is not all APPn
    Buffer.from([0xff, 0xda]), be16(4), Buffer.alloc(2),   // SOS ends the segment walk
    Buffer.from([0xff, 0xd9]),
  ]);
  const comSegment = Buffer.concat([Buffer.from([0xff, 0xfe]), be16(6), Buffer.alloc(4)]);

  const CASES = [
    ['a clean PNG', 'fixture.png', png(), false],
    ['a PNG carrying tEXt', 'fixture.png', png(pngChunk('tEXt', Buffer.from('a\0b'))), true],
    ['a PNG carrying iTXt', 'fixture.png', png(pngChunk('iTXt', Buffer.from('a\0b'))), true],
    ['a PNG carrying a C2PA caBX', 'fixture.png', png(pngChunk('caBX', Buffer.alloc(16))), true],
    ['a clean JPEG', 'fixture.jpg', jpeg(), false],
    ['a JPEG with an orientation-only Exif', 'fixture.jpg', jpeg(exifApp1(1)), false],
    ['a JPEG with an Exif one tag wider', 'fixture.jpg', jpeg(exifApp1(2)), true],
    ['a JPEG with a one-entry Exif and trailing bytes', 'fixture.jpg',
     jpeg(exifApp1WithTrailer(12)), true],
    ['a JPEG carrying a COM comment', 'fixture.jpg', jpeg(comSegment), true],
  ];

  let ran = 0;
  for (const [what, name, buf, shouldFail] of CASES) {
    ran++;
    const findings = imageFindings(name, buf);
    if (shouldFail && findings.length === 0) {
      fail(`check 2 accepted ${what} — its parser is not seeing what it is meant to see`);
    }
    if (!shouldFail && findings.length > 0) {
      fail(`check 2 rejected ${what}: ${findings.join('; ')}`);
    }
  }
  // The exemption's boundary, asserted as a pair rather than two separate cases,
  // because what matters is that they differ.
  const narrow = imageFindings('fixture.jpg', jpeg(exifApp1(1)));
  const wider = imageFindings('fixture.jpg', jpeg(exifApp1(2)));
  if (!(narrow.length === 0 && wider.length > 0)) {
    fail('the orientation-only Exif exception no longer distinguishes one tag from two — ' +
      `narrow: ${narrow.length} finding(s), wider: ${wider.length}`);
  }
  // The exception is pinned on the SIZE as well as the entry count, and both
  // halves need their own case: relaxing the size alone leaves every
  // wider-IFD fixture still refused, so without this the mutation is invisible.
  const padded = imageFindings('fixture.jpg', jpeg(exifApp1WithTrailer(12)));
  if (padded.length === 0) {
    fail('a one-entry Exif with trailing bytes was accepted — the exception is ' +
      'pinned on the entry count but no longer on the 34-byte size');
  }
  if (ran !== CASES.length) fail(`check 2 self-check ran ${ran} of ${CASES.length} fixtures`);
  console.log(`     self-check — ${ran} in-memory fixtures, ` +
    `${CASES.filter((c) => c[3]).length} of them dirty, including both sides of the ` +
    `orientation exception`);
}

// =====================================================
// 3. No personal name
// =====================================================
if (FORBIDDEN_NAME_HASHES.size === 0) {
  fail('the forbidden-name list is empty — check 3 would compare every token ' +
    'against nothing and report clean');
}
console.log(`  3. no personal names — ${plural(FORBIDDEN_NAME_HASHES.size, 'hashed entry', 'hashed entries')}`);

/**
 * Every letter run whose NORMALISED form is at least `min` characters.
 *
 * **`min` is 3 in a text file and 4 in a binary one, and that is a measurement
 * rather than a preference.** Three-letter entries went on the list on
 * 2026-09-03 — shortened forms of names that had been used as capture-set
 * prefixes. Three letters of entropy do not survive 25 MB of arithmetic-coded
 * photograph: scanned at three, one such entry collided by chance in six of the
 * sixteen tracked photographs and three of them collided in fifteen files. The
 * alternative to a floor was excusing most of the evidence outright, which
 * switches the name scan off exactly where a name would be hardest to see.
 *
 * So a short entry is enforced where a short identifier actually lives — in
 * source, in data files, in documentation — and not inside a JPEG's scan. Say
 * so plainly rather than tuning the number until the output is green.
 *
 * **THE FLOOR IS APPLIED AFTER NORMALISING, AND THE FIRST VERSION OF IT WAS
 * NOT.** `hashName` drops everything that is not an unaccented letter, so a
 * four-character run beginning with a character that folds to nothing — and a
 * latin1 decode of compressed data is full of them — hashes as a three-letter
 * name and walked straight past a floor of four. That version was measured
 * against one entry, which happened not to collide that way, and it looked
 * correct. Two more entries the next hour produced 46 findings across 15 files.
 * A length test upstream of the normalisation it is protecting is not a length
 * test.
 */
const tokensOf = (text, min) => {
  const out = new Set();
  const re = /\p{L}{3,}/gu;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (normaliseName(m[0]).length >= min) out.add(m[0]);
  }
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

/**
 * Up to three PLACES, deduplicated — not up to three places per token.
 *
 * Two things each used to multiply one finding into several, and both are the
 * same mistake: reporting per cause rather than per location.
 *
 *   Both decodings are searched, because a token found in one may not appear
 *   literally in the other — but for a text file utf8 and latin1 are the same
 *   string, so everything was printed twice.
 *
 *   And several distinct tokens can hash to one forbidden entry: a name, the
 *   same name accented, the same name upper-cased. One line carrying all three
 *   was printed three times.
 *
 * **A guard that turns one finding into three teaches whoever reads its output
 * to discount it**, which is the opposite of what a guard is for. So every
 * matching token is searched for at once and the results are keyed on the line
 * number alone.
 */
const locate = (decodings, tokens) => {
  const re = new RegExp([...tokens].join('|'), 'i');
  const seen = new Map();
  for (const decoded of decodings) {
    const lines = decoded.split(/\r?\n/);
    for (let n = 0; n < lines.length; n++) {
      if (!re.test(lines[n])) continue;
      // Keyed on the LINE NUMBER alone. Keying on the text as well looks
      // safer and is not: the two decodings render an accented line
      // differently, so the same line of the same file came back as two
      // findings — which is the whole defect this is fixing, one level down.
      if (!seen.has(n)) seen.set(n, { line: lines[n], n });
      if (seen.size >= 3) return [...seen.values()];
    }
  }
  return [...seen.values()];
};

const show = (line) => (line.length > 140 ? `${line.slice(0, 140)}…` : line).trim();

let scanned = 0, excusedHits = 0;
for (const [path, buf] of contents) {
  scanned++;

  const min = isText(path) ? 3 : 4;
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

  const at = locate(decodings, hits);
  if (at.length === 0) {
    fail(`a forbidden name appears in ${path} (not on any line — binary?)`);
  }
  for (const { line, n } of at) {
    fail(`a forbidden name in ${path}:${n + 1}\n          ${show(line)}`);
  }
}

// =====================================================
// 4. No product name
// =====================================================
// A SEPARATE LIST FROM THE NAMES, DELIBERATELY.
//
//   `forbiddenNames.mjs` is about people, and its whole justification — that
//   nobody consents to being published by working on a project — does not apply
//   to a brand. Mixing them would make one list mean two things and invite the
//   next person to reason about a name using an argument that was written for a
//   product. Same mechanism, same hash function, different list and different
//   reason.
//
// WHY IT IS HASHED ANYWAY
//
//   Not privacy. The instruction is that neither repository contains anything
//   about the former product name, and a guard that spells it out in order to
//   forbid it is a repository that contains it. Same trap as a path scanner
//   holding a path, and the same answer.
//
// WHY PATHS AS WELL AS CONTENTS
//
//   Check 3 reads file contents. What triggered this rule was a FILENAME — a
//   tracked logo, referenced by nothing, whose name was the only thing about it
//   that mattered. A content-only scan would have passed it every time.
//
//   The file is deleted. Its metadata was stripped first, under an order that
//   assumed it had to stay; that work was not wasted, since the strip is what
//   established the manifest named no person. But the file itself is gone, and
//   this is what stops it or its name coming back.
//
// The name is in past commit messages and in blob history. That is a rewrite,
// it is Andre's decision, and it is explicitly not this guard's business.
const FORBIDDEN_PRODUCT_HASHES = new Set([
  '1c653d25d68fb2ad',
]);

{
  let hitFiles = 0;
  for (const [path, buf] of contents) {
    const min = isText(path) ? 3 : 4;

    // The path first, because that is the shape this rule was written for.
    for (const token of tokensOf(path, min)) {
      if (!FORBIDDEN_PRODUCT_HASHES.has(hashName(token))) continue;
      fail(`a forbidden product name in the PATH ${path} — the filename is the ` +
        `reference; renaming it is not enough if the file is not needed`);
      hitFiles++;
      break;
    }

    const decodings = READINGS.map((encoding) => buf.toString(encoding));
    const hits = new Set();
    for (const decoded of decodings) {
      for (const token of tokensOf(decoded, min)) {
        if (FORBIDDEN_PRODUCT_HASHES.has(hashName(token))) hits.add(token);
      }
    }
    if (hits.size === 0) continue;
    hitFiles++;
    for (const token of hits) {
      const at = locate(decodings, token);
      if (at.length === 0) {
        fail(`a forbidden product name appears in ${path} (not on any line — binary?)`);
        continue;
      }
      for (const { line, n } of at) {
        fail(`a forbidden product name in ${path}:${n + 1}
          ${show(line)}`);
      }
    }
  }
  if (FORBIDDEN_PRODUCT_HASHES.size === 0) {
    fail('the forbidden-product list is empty — check 4 would compare every token ' +
      'against nothing and report clean');
  }
  console.log(`  4. no product names — ${plural(FORBIDDEN_PRODUCT_HASHES.size, 'hashed entry', 'hashed entries')}` +
    `${hitFiles ? `, ${hitFiles} file(s) with findings` : ''}`);
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
