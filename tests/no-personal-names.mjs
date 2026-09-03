// =====================================================
// No personal name appears anywhere in this repository
// =====================================================
// This repository is public. Nobody whose photographs, device or test results
// are discussed here consented to being named in it, and asking afterwards is
// not consent when the asker holds the project. The only name that belongs in a
// public repository is the maintainer's own git identity, which GitHub attaches
// to every commit and which is his to publish.
//
// **THE LIST BELOW IS WHAT IS FORBIDDEN, NOT WHAT IS ALLOWED.** Adding a name to
// it is not how you permit that name — it is how you ban one. If you are here
// because this test failed, the fix is to remove the name from the file it
// names, not to shorten this list.
//
// Substitutes already in use, and they cost the findings nothing because they
// are already the file naming:
//
//     a student volunteer's captures   ->  ios1_01..ios1_06, ios2_01..ios2_06
//     a colleague's Android captures   ->  android01..android13
//     the autograder author            ->  "the autograder author"
//
// Why this exists at all: the same class of thing drifted once already. A name
// and student ID line was ordered removed on 2026-08-15 and survived on two
// export paths for three weeks, because the guard was scoped to one file. This
// one is scoped to every tracked file.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Forbidden anywhere in a tracked file. Case-insensitive, whole word.
 *
 * Keep first names and surnames on separate lines with the reason, so a later
 * reader can tell a person from a coincidence.
 */
const FORBIDDEN = [
  'ios1',      // student volunteer, iPhone 13 Pro Max captures -> ios1_01..ios1_06
  'ios2',   // student volunteer, iPhone 17 Pro Max captures -> ios2_01..ios2_06
  'android',      // colleague, Android captures -> android01..android13
  'redacted1',    // a person associated with the project
  'redacted2',      // a person associated with the project
  'redacted3',       // watched because it collides with JPEG scan data; see EXCUSED
];

/**
 * Paths where a match is a known false positive, with the evidence.
 *
 * **Excluded by path, never by deleting the fixture.** `cap02.jpg` is one of the
 * eleven photographs the whole detector is calibrated against.
 */
const EXCUSED = new Map([
  ['tests/captures/real/cap02.jpg',
   'binary false positive: the byte sequence appears at offset ~803093 in ' +
   '1,379,962 bytes of compressed scan data. The EXIF segment ends at byte ' +
   '2562, so this is image data, not metadata, and not a name.'],
  // This file necessarily contains every forbidden string.
  ['tests/no-personal-names.mjs', 'the list itself'],
]);

let failed = 0;
const fail = (msg) => { console.error(`  FAIL  ${msg}`); failed++; };

const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: REPO, maxBuffer: 64 << 20 })
  .toString('utf8').split('\0').filter(Boolean);

console.log(`\nno personal names — ${tracked.length} tracked files, ` +
  `${FORBIDDEN.length} names\n`);

const patterns = FORBIDDEN.map(n => ({ name: n, re: new RegExp(`\\b${n}\\b`, 'i') }));
let scanned = 0, excused = 0;

for (const path of tracked) {
  let text;
  try {
    // Read as latin1 rather than utf8: a binary file decoded as utf8 turns
    // unmatched bytes into U+FFFD and can destroy the very sequence being
    // looked for. latin1 is byte-preserving, so a name hidden in a binary is
    // still found — which is how the cap02 false positive was found at all.
    text = readFileSync(resolve(REPO, path), 'latin1');
  } catch {
    continue;
  }
  scanned++;
  for (const { name, re } of patterns) {
    if (!re.test(text)) continue;
    if (EXCUSED.has(path)) { excused++; continue; }

    // Actionable: the path, the name, and the line. A guard that says only
    // "a name is somewhere in the tree" is a guard nobody can act on.
    const lines = text.split(/\r?\n/);
    const hits = lines
      .map((line, i) => ({ line, i }))
      .filter(({ line }) => re.test(line))
      .slice(0, 3);
    if (hits.length === 0) {
      fail(`"${name}" appears in ${path} (not on any line — binary?)`);
    } else {
      for (const { line, i } of hits) {
        const shown = line.length > 140 ? `${line.slice(0, 140)}…` : line;
        fail(`"${name}" in ${path}:${i + 1}\n          ${shown.trim()}`);
      }
    }
  }
}

for (const [path, why] of EXCUSED) {
  if (path === 'tests/no-personal-names.mjs') continue;
  if (!tracked.includes(path)) {
    fail(`the excused path ${path} is no longer tracked — remove its entry ` +
      `rather than leaving an exemption that protects nothing`);
  } else {
    console.log(`  note  ${path} excused — ${why}`);
  }
}

console.log(`\n  ${scanned} files read, ${excused} excused match(es)`);
if (failed > 0) {
  console.error(`\n  ${failed} personal-name occurrence(s) found. ` +
    `Remove the name from the file, do not shorten the list in this test.\n`);
  process.exit(1);
}
console.log('  no personal names in tracked files\n');
