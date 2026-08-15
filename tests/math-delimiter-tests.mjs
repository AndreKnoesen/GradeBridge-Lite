// =====================================================
// Math delimiter tests — the `$...$` / `$$...$$` contract
// =====================================================
// services/mathDelimiters.ts is mirrored byte-for-byte from the Assignment
// Maker. If the two copies drift, an instructor authors math that renders one
// way when they write it and another way when the student reads it — which is
// exactly how the Maker's four export paths drifted apart in August 2026.
//
//   npm test
//
// The mirror check SKIPs when GradeBridge-Assignment-Maker is not checked out
// alongside this repo; the behaviour checks always run.
// =====================================================

import { build } from 'esbuild';
import { readFileSync, existsSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const MIRROR = join('services', 'mathDelimiters.ts');

let passed = 0, failed = 0, skipped = 0;
const results = [];
const check = (name, fn) => {
  try { fn(); passed++; results.push(`  PASS  ${name}`); }
  catch (err) { failed++; results.push(`  FAIL  ${name}\n          ${err.message}`); }
};
const skip = (name, why) => { skipped++; results.push(`  SKIP  ${name} (${why})`); };
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const assertEqual = (actual, expected, msg) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg}\n          expected: ${e}\n          actual:   ${a}`);
};

const outDir = mkdtempSync(join(tmpdir(), 'gb-student-math-'));
const entry = join(REPO, MIRROR);
const outfile = join(outDir, 'mathDelimiters.mjs');
await build({
  entryPoints: [entry], outfile, format: 'esm', target: 'es2022',
  bundle: true, absWorkingDir: dirname(entry), logLevel: 'silent',
});
const { splitMath, hasMath, segToSource, MATH_DELIMITER_RE } = await import(pathToFileURL(outfile).href);

console.log('\nStudent Submission — math delimiter contract\n');

// ---------- the mirror ----------
{
  const here = join(REPO, MIRROR);
  const there = resolve(REPO, '..', 'GradeBridge-Assignment-Maker', MIRROR);
  if (existsSync(there)) {
    // Line endings are a checkout artefact (core.autocrlf), not a divergence.
    const norm = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
    check('the mirrored delimiter file is byte-identical to the Assignment Maker\'s', () =>
      assert(norm(here) === norm(there),
        `the mirrored file has diverged.\n          copy ${there}\n          over ${here} (or the other way) and re-run`));
  } else {
    skip('the mirrored delimiter file is byte-identical to the Assignment Maker\'s',
      'Assignment Maker repo not alongside this one');
  }

  check('the mirrored file is the only splitter in this repo', () => {
    const offenders = [];
    const walk = (dir) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (/^(node_modules|dist|\.git)$/.test(e.name)) continue;
        const full = join(dir, e.name);
        if (e.isDirectory()) { walk(full); continue; }
        if (!/\.tsx?$/.test(e.name) || full === here) continue;
        if (/\\\$\\\$\[\\s\\S\]/.test(readFileSync(full, 'utf8'))) offenders.push(full);
      }
    };
    walk(REPO);
    assertEqual(offenders.map(f => f.slice(REPO.length + 1)), [],
      'a second copy of the delimiter regex appeared');
  });
}

// ---------- the contract ----------
check('the regex is the one of record', () =>
  assertEqual(MATH_DELIMITER_RE.source, '(\\$\\$[\\s\\S]+?\\$\\$|\\$[^$]+?\\$)', 'the delimiter regex changed'));

check('inline, display and prose are separated', () =>
  assertEqual(splitMath('a $x$ b $$y$$ c'), [
    { kind: 'text', value: 'a ' },
    { kind: 'inline', tex: 'x' },
    { kind: 'text', value: ' b ' },
    { kind: 'display', tex: 'y' },
    { kind: 'text', value: ' c' },
  ], 'wrong segmentation'));

check('prose with no math is left whole', () => {
  assertEqual(splitMath('plain prose'), [{ kind: 'text', value: 'plain prose' }], 'prose was split');
  assertEqual(splitMath(''), [], 'empty input should give no segments');
});

check('an unpaired dollar is prose, not a delimiter', () => {
  assert(hasMath('costs $5 and 50%') === false, 'a stray dollar counted as math');
  assert(hasMath('a $x$ b') === true, 'real math was not detected');
});

check('real authored math from an assignment survives the split', () => {
  const src = 'six resistors of $6\\,\\Omega$, $\\{3\\,\\Omega, 5\\,\\Omega\\}$ and $V_{out}$';
  assertEqual(splitMath(src).map(segToSource).join(''), src, 'the round trip changed the text');
  assertEqual(splitMath(src).filter(s => s.kind !== 'text').length, 3, 'wrong number of math spans');
});

check('segToSource restores the delimiters it stripped', () => {
  assertEqual(segToSource({ kind: 'inline', tex: 'V_x' }), '$V_x$', 'inline delimiters lost');
  assertEqual(segToSource({ kind: 'display', tex: 'E=mc^2' }), '$$E=mc^2$$', 'display delimiters lost');
  assertEqual(segToSource({ kind: 'text', value: 'hi' }), 'hi', 'prose was altered');
});

console.log(results.join('\n'));
console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped\n`);
rmSync(outDir, { recursive: true, force: true });
process.exit(failed > 0 ? 1 : 0);
