// =====================================================
// Legacy submission-type tests — the archived-spec contract
// =====================================================
// `Subsection.submissionType` is declared `SubmissionType | string`. That union
// is the whole reason a submission type can be deleted from the enum without a
// deprecation shim: an archived assignment_spec.json carrying a type this build
// no longer knows is just a string that matches nothing, and every dispatch in
// the app falls through to its plain-text default.
//
//   npm test
//
// AI Formative was removed on 2026-08-18 (WORKORDER_STUDENT_REMOVE_AI_FORMATIVE).
// These checks are the property that removal relied on, held for it and for any
// type retired after it: an unknown type LOADS, and renders as text — it never
// throws, never renders blank, and never lands in the AI-graded branch.
//
// Why source-level. The three dispatch points live inside files that cannot be
// imported here (React and the whole component tree come with them), so each
// check EXTRACTS the real function or expression out of the file, transpiles
// it, and runs that — rather than restating logic that could quietly diverge.
// =====================================================

import { transform } from 'esbuild';
import { readFileSync, readdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');

// ---------- tiny assertion harness (mirrors the other suites) ----------
let passed = 0, failed = 0;
const results = [];
const check = (name, fn) => {
  try { fn(); passed++; results.push(`  PASS  ${name}`); }
  catch (err) { failed++; results.push(`  FAIL  ${name}\n          ${err.message}`); }
};
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const assertEqual = (actual, expected, msg) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg}\n          expected: ${e}\n          actual:   ${a}`);
};

// The type this suite was written for. Kept as a named constant so the next
// retirement can be added to the list rather than the file rewritten.
const RETIRED = 'AI Formative';

const typesSrc  = readFileSync(join(REPO, 'types.ts'), 'utf8');
const constSrc  = readFileSync(join(REPO, 'constants.ts'), 'utf8');
const rendSrc   = readFileSync(join(REPO, 'components', 'ProblemRenderer.tsx'), 'utf8');
const printSrc  = readFileSync(join(REPO, 'components', 'PrintView.tsx'), 'utf8');
const widgetSrc = readFileSync(join(REPO, 'components', 'SubmissionWidget.tsx'), 'utf8');
const appSrc    = readFileSync(join(REPO, 'App.tsx'), 'utf8');

// Lift a top-level declaration out of a source file by its opening marker and
// the terminator that closes it, both matched literally.
const lift = (src, marker, terminator, what) => {
  const start = src.indexOf(marker);
  if (start === -1) throw new Error(`could not find ${what} (marker: ${marker})`);
  const end = src.indexOf(terminator, start);
  if (end === -1) throw new Error(`could not find the end of ${what}`);
  return src.slice(start, end + terminator.length);
};

const outDir = mkdtempSync(join(tmpdir(), 'gb-student-legacy-'));
let seq = 0;
const loadSnippet = async (ts) => {
  const { code } = await transform(ts, { loader: 'ts', format: 'esm', target: 'es2022' });
  const outfile = join(outDir, `snippet-${seq++}.mjs`);
  writeFileSync(outfile, code, 'utf8');
  return import(pathToFileURL(outfile).href);
};

console.log('\nLegacy submission types — archived specs still load\n');

// =====================================================
// 1. The union that makes this safe is still declared
// =====================================================
check('types.ts: Subsection.submissionType is `SubmissionType | string`', () =>
  assert(/\n\s*submissionType:\s*SubmissionType\s*\|\s*string;/.test(typesSrc),
    'Subsection.submissionType is no longer widened with `| string` — an archived spec '
    + 'carrying a retired type is now a type error, and this suite\'s premise is gone'));

check(`types.ts: the ${RETIRED} enum member is gone`, () =>
  assert(!/AI_FORMATIVE/.test(typesSrc), 'SubmissionType still declares AI_FORMATIVE'));

// =====================================================
// 2. A retired type is not AI-graded, and every surviving one has a word range
// =====================================================
{
  const enumBlock = lift(typesSrc, 'export enum SubmissionType {', '\n}\n', 'the SubmissionType enum');
  const constants = await loadSnippet(constSrc);

  check(`constants.ts: AI_GRADED_TYPES does not contain "${RETIRED}"`, () =>
    assert(!constants.AI_GRADED_TYPES.has(RETIRED),
      `AI_GRADED_TYPES still contains "${RETIRED}"`));

  check('constants.ts: every AI_GRADED_TYPES member has a word range', () => {
    const missing = [...constants.AI_GRADED_TYPES]
      .filter((t) => !constants.AI_GRADED_WORD_RANGES[t]);
    assert(missing.length === 0,
      `no AI_GRADED_WORD_RANGES entry for: ${missing.join(', ')} — SubmissionWidget reads `
      + '`range.label` and `range.max` unguarded');
  });

  check('constants.ts: SUBMISSION_TYPES no longer offers the retired type', () =>
    assert(!Object.values(constants.SUBMISSION_TYPES).includes(RETIRED),
      `SUBMISSION_TYPES still exposes "${RETIRED}"`));

  // ---------- 3. ProblemRenderer dispatch ----------
  const widgetTypeMod = await loadSnippet([
    enumBlock,
    lift(rendSrc, 'const AI_GRADED_STRINGS = new Set([', '\n]);\n', 'ProblemRenderer AI_GRADED_STRINGS'),
    lift(rendSrc, 'const getWidgetType =', '\n};\n', 'ProblemRenderer getWidgetType'),
    'export { getWidgetType, AI_GRADED_STRINGS };\n',
  ].join('\n'));

  check(`ProblemRenderer: "${RETIRED}" resolves to the plain-text widget`, () =>
    assertEqual(widgetTypeMod.getWidgetType(RETIRED), 'Answer as text',
      'an archived AI Formative part no longer renders through the text branch'));

  check('ProblemRenderer: an arbitrary unknown type resolves to the plain-text widget', () =>
    assertEqual(widgetTypeMod.getWidgetType('Some Type From 2031'), 'Answer as text',
      'an unknown submission type no longer falls through to text'));

  check(`ProblemRenderer: AI_GRADED_STRINGS does not contain "${RETIRED}"`, () =>
    assert(!widgetTypeMod.AI_GRADED_STRINGS.has(RETIRED),
      `ProblemRenderer's AI_GRADED_STRINGS still contains "${RETIRED}"`));

  check('ProblemRenderer: the four surviving AI types still resolve to themselves', () => {
    for (const t of constants.AI_GRADED_TYPES) {
      assertEqual(widgetTypeMod.getWidgetType(t), t, `getWidgetType("${t}") changed`);
    }
    assertEqual(constants.AI_GRADED_TYPES.size, 4,
      'expected exactly four AI-graded types after the removal');
  });

  // ---------- 4. PrintView dispatch ----------
  const printMod = await loadSnippet([
    enumBlock,
    lift(constSrc, 'export const SUBMISSION_TYPES = {', '\n};\n', 'SUBMISSION_TYPES'),
    lift(printSrc, 'const AI_GRADED_STRINGS = new Set([', '\n]);\n', 'PrintView AI_GRADED_STRINGS'),
    lift(printSrc, 'const getSubmissionElements =', '\n};\n', 'PrintView getSubmissionElements'),
    'export { getSubmissionElements };\n',
  ].join('\n'));

  check(`PrintView: "${RETIRED}" prints as a text element`, () =>
    assertEqual(printMod.getSubmissionElements(RETIRED), [constants.SUBMISSION_TYPES.TEXT],
      'an archived AI Formative part no longer prints through the text element'));

  // ---------- 5. App.tsx export mapping ----------
  // The archived part must take the `textAnswer` branch, not the `aiAnswer` one,
  // because the plain-text widget it now renders as writes to textAnswer.
  {
    const exprLine = appSrc.match(/const isAiGraded = ([^\n]+?);\n/);
    check('App.tsx: the `isAiGraded` test is still present', () =>
      assert(exprLine, 'could not find `const isAiGraded = ...` in App.tsx'));

    if (exprLine) {
      const isAiGraded = new Function('sub', 'AI_GRADED_TYPES', `return (${exprLine[1]});`);
      check(`App.tsx: "${RETIRED}" exports through the textAnswer branch`, () =>
        assert(isAiGraded({ submissionType: RETIRED }, constants.AI_GRADED_TYPES) === false,
          'an archived AI Formative part is still treated as AI-graded on export, so it '
          + 'would read aiAnswer while the widget writes textAnswer'));

      check('App.tsx: the four surviving AI types still export through the aiAnswer branch', () => {
        for (const t of constants.AI_GRADED_TYPES) {
          assert(isAiGraded({ submissionType: t }, constants.AI_GRADED_TYPES) === true,
            `"${t}" is no longer recognised as AI-graded on export`);
        }
      });
    }
  }

  // ---------- 6. A whole archived spec still parses ----------
  const ARCHIVED_SPEC = JSON.stringify({
    id: 'EEC1_Lab8_Report',
    courseCode: 'EEC1',
    title: 'Lab 8 Milestone Report',
    dueDate: '2026-05-15',
    dueTime: '23:59',
    preamble: 'Archived Spring 2026 spec.',
    problems: [{
      id: 'p1', name: 'Report', description: '',
      subsections: [
        { id: 'p1a', name: 'Method', description: 'Describe your method.', points: 60,
          submissionType: 'AI Formative', maxImages: 0 },
        { id: 'p1b', name: 'Result', description: 'State your result.', points: 40,
          submissionType: 'AI Graded: Short', maxImages: 0 },
      ],
    }],
    createdAt: 1747000000000,
    updatedAt: 1747000000000,
  });

  check('an archived spec carrying "AI Formative" parses, and both parts dispatch', () => {
    const spec = JSON.parse(ARCHIVED_SPEC);
    const [legacy, surviving] = spec.problems[0].subsections;
    assertEqual(widgetTypeMod.getWidgetType(legacy.submissionType), 'Answer as text',
      'the archived part did not fall through to the text widget');
    assertEqual(widgetTypeMod.getWidgetType(surviving.submissionType), 'AI Graded: Short',
      'the surviving AI part stopped resolving');
    assertEqual(spec.problems[0].subsections.reduce((s, x) => s + x.points, 0), 100,
      'the archived spec did not survive the round trip intact');
  });
}

// =====================================================
// 7. No student-facing promise of a resubmission or revision round
// =====================================================
// The removed formative copy was the only place the app told a student they
// could submit again for another pass. The successor concept — the per-assignment
// aiFeedback flag — is elected, one per problem, and spent when used; nothing
// here may imply otherwise.
{
  const componentFiles = readdirSync(join(REPO, 'components')).filter((f) => /\.(ts|tsx)$/.test(f));
  const files = [['App.tsx', appSrc], ['demoAssignment.ts', readFileSync(join(REPO, 'demoAssignment.ts'), 'utf8')]];
  for (const f of componentFiles) files.push([`components/${f}`, readFileSync(join(REPO, 'components', f), 'utf8')]);

  check('no source file promises a resubmit or a revision round', () => {
    const hits = [];
    for (const [name, src] of files) {
      src.split('\n').forEach((line, i) => {
        if (/resubmit|revision round|submit again/i.test(line)) hits.push(`${name}:${i + 1}: ${line.trim()}`);
      });
    }
    assert(hits.length === 0, `resubmission promise still in the tree:\n          ${hits.join('\n          ')}`);
  });

  check(`no source file mentions "${RETIRED}"`, () => {
    const hits = [];
    for (const [name, src] of files.concat([['types.ts', typesSrc], ['constants.ts', constSrc]])) {
      src.split('\n').forEach((line, i) => {
        if (/AI Formative|AI_FORMATIVE|ai_formative/.test(line)) hits.push(`${name}:${i + 1}: ${line.trim()}`);
      });
    }
    assert(hits.length === 0, `AI Formative still referenced:\n          ${hits.join('\n          ')}`);
  });

  check('SubmissionWidget: the AI-graded branch reads its word range unguarded', () =>
    assert(!/range\?\./.test(widgetSrc),
      'SubmissionWidget still guards `range` — every AI-graded type has a range now'));
}

// ---------- report ----------
rmSync(outDir, { recursive: true, force: true });
console.log(results.join('\n'));
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
