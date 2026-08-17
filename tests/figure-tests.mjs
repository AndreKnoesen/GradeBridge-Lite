// =====================================================
// Figure tests — the ```svg / ![alt](url) contract
// =====================================================
// services/figureBlocks.ts is mirrored byte-for-byte from the Assignment Maker,
// exactly as services/mathDelimiters.ts is. If the two copies drift, a drawing
// the instructor placed in a problem stem renders one way when they write it
// and another way — or not at all — when the student reads it.
//
//   npm test
//
// The ordering these checks exist for: an SVG document is full of characters
// the `$...$` splitter mis-handles. A `$` in path data or an attribute value
// reads as a math delimiter, so a drawing that reaches splitMath is shredded
// into text fragments and KaTeX spans, with nothing downstream noticing. The
// figure comes out of the text FIRST, everywhere.
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
const MIRROR = join('services', 'figureBlocks.ts');

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

const outDir = mkdtempSync(join(tmpdir(), 'gb-student-figure-'));
const loadModule = async (entry, outName) => {
  const outfile = join(outDir, outName);
  await build({
    entryPoints: [entry], outfile, format: 'esm', target: 'es2022',
    bundle: true, absWorkingDir: dirname(entry), logLevel: 'silent',
  });
  return import(pathToFileURL(outfile).href);
};

const {
  splitFigures, figureSegsToSource, hasFigure, trimAroundFigures,
  figureLabel, figurePlaceholder, sanitizeSvg, namespaceSvgIds, prepareSvgForInline,
} = await loadModule(join(REPO, MIRROR), 'figureBlocks.mjs');
const { splitMath } = await loadModule(join(REPO, 'services', 'mathDelimiters.ts'), 'mathDelimiters.mjs');

console.log('\nStudent Submission — figure contract\n');

// ---------- the mirror ----------
{
  const here = join(REPO, MIRROR);
  const there = resolve(REPO, '..', 'GradeBridge-Assignment-Maker', MIRROR);
  if (existsSync(there)) {
    // Line endings are a checkout artefact (core.autocrlf), not a divergence.
    const norm = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
    check("the mirrored figure file is byte-identical to the Assignment Maker's", () =>
      assert(norm(here) === norm(there),
        `the mirrored file has diverged.\n          copy ${there}\n          over ${here} (or the other way) and re-run`));
  } else {
    skip("the mirrored figure file is byte-identical to the Assignment Maker's",
      'Assignment Maker repo not alongside this one');
  }

  check('the mirrored file is the only figure splitter in this repo', () => {
    const offenders = [];
    const walk = (dir) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (/^(node_modules|dist|\.git)$/.test(e.name)) continue;
        const full = join(dir, e.name);
        if (e.isDirectory()) { walk(full); continue; }
        if (!/\.tsx?$/.test(e.name) || full === here) continue;
        if (/```\[ \\t\]\*svg|svg\[ \\t\]\*\$/.test(readFileSync(full, 'utf8'))) offenders.push(full);
      }
    };
    walk(REPO);
    assertEqual(offenders.map(f => f.slice(REPO.length + 1)), [],
      'a second copy of the fence regex appeared');
  });
}

// ---------- the contract ----------
check('a fenced svg block is lifted out of the prose around it', () => {
  const segs = splitFigures('lead\n\n```svg\n<svg viewBox="0 0 1 1"/>\n```\n\ntail');
  assertEqual(segs.map(s => s.kind), ['text', 'figure', 'text'], 'wrong segmentation');
  assertEqual(segs[1].figure, { form: 'svg', svg: '<svg viewBox="0 0 1 1"/>' }, 'the svg was not lifted whole');
});

check('the split is exact — every form reassembles to the input byte-for-byte', () => {
  for (const src of [
    'a\n```svg\n<svg>X</svg>\n```\nb',
    '```svg\n<svg>X</svg>\n```',
    '```svg\n<svg>X</svg>\n```\n',
    '```svg\nA\n```\n![x](data:image/png;base64,AA)\n',
    'prose only, no figure',
    '```svg\nan unterminated fence\nis still lifted',
    '',
  ]) {
    assertEqual(figureSegsToSource(splitFigures(src)), src, `reassembly changed: ${JSON.stringify(src)}`);
  }
});

check('a markdown image on its own line is a figure; one inside a sentence is prose', () => {
  assert(hasFigure('![plot](data:image/png;base64,AA)') === true, 'a lone image was not lifted');
  assert(hasFigure('see ![plot](data:image/png;base64,AA) above') === false, 'an inline image was lifted');
  assert(hasFigure('no figures here') === false, 'prose counted as a figure');
});

check('the drawing never reaches the math splitter', () => {
  const block = '```svg\n<svg><text>cost $5 each, $9 total</text></svg>\n```';
  // What would happen if it did: splitMath reads `$5 each, $` as inline math.
  assert(splitMath(block).some(s => s.kind !== 'text'),
    'sanity: the raw block does look like math — which is the whole point');
  const segs = trimAroundFigures(splitFigures(block));
  assertEqual(segs.map(s => s.kind), ['figure'], 'the block was not lifted whole');
  assertEqual(segs[0].figure.svg, '<svg><text>cost $5 each, $9 total</text></svg>', 'the drawing was altered');
});

check('math beside a figure still splits normally', () => {
  const segs = trimAroundFigures(splitFigures('Given $V_{in}$.\n\n```svg\n<svg/>\n```\n\nFind $V_{out}$.'));
  assertEqual(segs.map(s => s.kind), ['text', 'figure', 'text'], 'wrong segmentation');
  assertEqual(splitMath(segs[0].value).filter(s => s.kind !== 'text').length, 1, 'the prose math was lost');
  assertEqual(splitMath(segs[2].value).filter(s => s.kind !== 'text').length, 1, 'the trailing math was lost');
});

check('trimAroundFigures drops the one newline either side, and nothing else', () => {
  const segs = trimAroundFigures(splitFigures('a\n\n```svg\n<svg/>\n```\n\nb'));
  assertEqual(segs.map(s => (s.kind === 'text' ? s.value : 'FIG')), ['a\n', 'FIG', '\nb'],
    'the authored blank line either side was not preserved');
});

check('inlining namespaces the ids, so the same drawing twice cannot capture itself', () => {
  const svg = '<svg><defs><marker id="arrow"/><style>#arrow { fill: red }</style></defs>'
    + '<path marker-end="url(#arrow)"/><use href="#arrow"/></svg>';
  const a = prepareSvgForInline(svg, 'p0-');
  const b = prepareSvgForInline(svg, 'p1-');
  for (const [label, out, prefix] of [['first', a, 'p0-'], ['second', b, 'p1-']]) {
    assert(out.includes(`id="${prefix}arrow"`), `${label}: the id was not prefixed`);
    assert(out.includes(`url(#${prefix}arrow)`), `${label}: the url() reference was not prefixed`);
    assert(out.includes(`href="#${prefix}arrow"`), `${label}: the href reference was not prefixed`);
    assert(out.includes(`#${prefix}arrow { fill: red }`), `${label}: the CSS selector was not prefixed`);
  }
  assert(a !== b, 'both copies got the same id namespace');
  assertEqual(namespaceSvgIds('<svg><rect/></svg>', 'p-'), '<svg><rect/></svg>',
    'a drawing with no ids was rewritten');
});

check('a drawing cannot bring script into the student\'s page', () => {
  const out = sanitizeSvg('<svg><script>alert(1)</script><rect onclick="steal()" onload=x /><a href="javascript:x">t</a></svg>');
  assert(!/script/i.test(out), `a script survived: ${out}`);
  assert(!/onclick|onload/i.test(out), `an event handler survived: ${out}`);
  assert(!/javascript:/i.test(out), `a javascript: URL survived: ${out}`);
  assert(out.includes('<rect'), 'the drawing itself was removed');
});

check('an inlined drawing is as wide as it says it is, and never wider than the column', () => {
  const declared = prepareSvgForInline('<?xml version="1.0"?>\n<svg viewBox="0 0 800 400" width="800"/>', 'q-');
  assert(!declared.includes('<?xml'), 'the XML prolog was inlined into the page');
  assert(/max-width:100%/.test(declared), 'the drawing was not constrained to the column');
  assert(!/style="[^"]*width:800px/.test(declared), 'a declared width was overridden');

  // viewBox only: without an intrinsic width the browser stretches a replaced
  // element to 100% of its container — a 240x120 circuit filling the page.
  const viewBoxOnly = prepareSvgForInline('<svg viewBox="0 0 240 120"><rect/></svg>', 'q-');
  assert(/style="width:240px;max-width:100%;height:auto"/.test(viewBoxOnly),
    `the viewBox width was not adopted: ${viewBoxOnly}`);
});

check('the placeholder names the drawing from its <title>', () => {
  assertEqual(figureLabel({ form: 'svg', svg: '<svg><title>circuit for Problem 3</title></svg>' }),
    'circuit for Problem 3', 'the title was not read');
  assertEqual(figurePlaceholder({ form: 'svg', svg: '<svg/>' }), '[figure]', 'wrong untitled placeholder');
  assertEqual(figurePlaceholder({ form: 'image', alt: 'Bode plot', url: 'data:image/png;base64,AA' }),
    '[figure: Bode plot]', 'the alt text was not used');
});

console.log(results.join('\n'));
console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped\n`);
rmSync(outDir, { recursive: true, force: true });
process.exit(failed > 0 ? 1 : 0);
