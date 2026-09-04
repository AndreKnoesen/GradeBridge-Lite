/**
 * mathDelimiters.ts — the `$...$` / `$$...$$` contract, shared verbatim between
 * GradeBridge-Assignment-Maker and GradeBridge-Student-Submission.
 *
 * ============================================================================
 * MIRRORED FILE — both repos hold a byte-identical copy at services/mathDelimiters.ts.
 * Edit one, copy it to the other. Each repo's `npm test` fails if they diverge,
 * because a difference here means an instructor authors math that renders one
 * way in the Assignment Maker and another way for the student.
 * ============================================================================
 *
 * Rules (documented in ASSIGNMENT_MD_SPEC.md §6):
 *   - inline `$...$`, display `$$...$$`
 *   - every `$` must be paired; an inline span may not contain a `$`
 *   - a lone unpaired `$` is prose, not a delimiter
 */

export type MathSeg =
  | { kind: 'text'; value: string }
  | { kind: 'inline'; tex: string }
  | { kind: 'display'; tex: string };

/** The one delimiter regex of record. */
export const MATH_DELIMITER_RE = /(\$\$[\s\S]+?\$\$|\$[^$]+?\$)/g;

export const splitMath = (input: string): MathSeg[] => {
  if (!input) return [];
  const segs: MathSeg[] = [];
  // String.split with a capturing group keeps the delimiters as their own parts.
  for (const part of input.split(MATH_DELIMITER_RE)) {
    if (!part) continue;
    if (part.length >= 4 && part.startsWith('$$') && part.endsWith('$$')) {
      segs.push({ kind: 'display', tex: part.slice(2, -2) });
    } else if (part.length >= 3 && part.startsWith('$') && part.endsWith('$')) {
      segs.push({ kind: 'inline', tex: part.slice(1, -1) });
    } else {
      segs.push({ kind: 'text', value: part });
    }
  }
  return segs;
};

/** True when the text has at least one math span worth rendering. */
export const hasMath = (input: string): boolean =>
  !!input && splitMath(input).some(s => s.kind !== 'text');

/** A segment back in its authored form, delimiters and all. */
export const segToSource = (seg: MathSeg): string =>
  seg.kind === 'text' ? seg.value
  : seg.kind === 'display' ? `$$${seg.tex}$$`
  : `$${seg.tex}$`;
