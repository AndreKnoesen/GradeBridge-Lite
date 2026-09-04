// =====================================================
// No personal name appears in any tracked file
// =====================================================
// The rule, why it exists, and why the list is hashed rather than written out
// are all in `tests/forbiddenNames.mjs`. This file is only the scan.
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

console.log(`\nno personal names — ${tracked.length} tracked files\n`);

/**
 * Every letter run of three or more, from one decoding of the bytes.
 *
 * Three, because nothing on the list is shorter and two-letter runs are what
 * binary files are made of.
 */
const tokensOf = (text, re) => {
  const out = new Set();
  re.lastIndex = 0;
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
const READINGS = [
  { encoding: 'utf8', re: /\p{L}{3,}/gu },
  { encoding: 'latin1', re: /[A-Za-z]{3,}/g },
];

let scanned = 0, excusedHits = 0;
for (const path of tracked) {
  let buf;
  try {
    buf = readFileSync(resolve(REPO, path));
  } catch {
    continue;
  }
  scanned++;

  const hits = new Set();
  const decodings = [];
  for (const { encoding, re } of READINGS) {
    const decoded = buf.toString(encoding);
    decodings.push(decoded);
    for (const token of tokensOf(decoded, re)) {
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
  console.error(`\n  ${failed} personal-name occurrence(s) found. Remove the name ` +
    `from the file named above. Do NOT remove it from tests/forbiddenNames.mjs — ` +
    `that list is what is forbidden, not what is permitted.\n`);
  process.exit(1);
}
console.log('  no personal names in tracked files\n');
