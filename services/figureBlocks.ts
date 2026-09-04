/**
 * figureBlocks.ts — the figure contract, shared verbatim between
 * GradeBridge-Assignment-Maker and GradeBridge-Student-Submission.
 *
 * ============================================================================
 * MIRRORED FILE — both repos hold a byte-identical copy at services/figureBlocks.ts.
 * Edit one, copy it to the other. Each repo's `npm test` fails if they diverge,
 * because a difference here means a figure the instructor drew renders one way
 * in the Assignment Maker and another way — or not at all — for the student.
 * ============================================================================
 *
 * **Lift figures before splitting math.** An SVG document is full of characters
 * the `$...$` splitter and KaTeX mis-handle: a stray `$` in path data or an
 * attribute value reads as a math delimiter, and the drawing is shredded into
 * text fragments and KaTeX spans. Nothing downstream notices — the file still
 * parses, the math checker still reports clean — so the only defence is
 * ordering. Every surface calls `splitFigures()` FIRST, runs `splitMath()` on
 * the text segments only, and re-places each figure at its anchor.
 *
 * Two accepted forms (documented in ASSIGNMENT_MD_SPEC.md §11):
 *
 *   ```svg
 *   <svg viewBox="0 0 400 200" xmlns="http://www.w3.org/2000/svg">...</svg>
 *   ```
 *
 *   ![alt text](data:image/png;base64,...)
 *
 * Both must sit alone on their own lines. A figure belongs in the problem stem,
 * above the first sub-part; nothing may assume one figure per problem, and two
 * problems carrying identical figure content is valid, not a duplicate.
 */

export type Figure =
  /** A fenced ```svg block: a complete SVG document, inline. */
  | { form: 'svg'; svg: string }
  /** The fallback: a Markdown image. `url` is normally a data: URI. */
  | { form: 'image'; alt: string; url: string };

export type FigureSeg =
  | { kind: 'text'; value: string }
  /** `source` is the authored block, verbatim and without its trailing newline. */
  | { kind: 'figure'; figure: Figure; source: string };

/** ```` ```svg ```` on its own line opens a block; a bare ```` ``` ```` closes it. */
export const FIGURE_FENCE_OPEN_RE = /^[ \t]*```[ \t]*svg[ \t]*$/;
export const FIGURE_FENCE_CLOSE_RE = /^[ \t]*```[ \t]*$/;
/** `![alt](url)` alone on a line. Anything else on the line is prose. */
export const FIGURE_IMAGE_RE = /^[ \t]*!\[([^\]]*)\]\(\s*([^)\s]+)\s*\)[ \t]*$/;

/**
 * Split authored text into figures and everything else.
 *
 * Exact: concatenating the segments back (text values plus figure `source`s,
 * with the newline a figure consumed restored) reproduces the input — see
 * `figureSegsToSource()`. That is what lets a `.md` round-trip byte-for-byte.
 *
 * An unterminated fence is still lifted, to the end of the text. Half a figure
 * is a bug in the source; feeding half an SVG to KaTeX would be a bug here.
 */
export const splitFigures = (input: string): FigureSeg[] => {
  if (!input) return [];
  const lines = input.split('\n');
  const segs: FigureSeg[] = [];

  let buf: string[] = [];
  // The newline between a figure's last line and whatever follows belongs to
  // the following text segment, so a figure's `source` stays clean.
  let owedNewline = false;

  const flushText = (beforeFigure: boolean) => {
    if (!buf.length && !owedNewline) return;
    const lead = owedNewline ? '\n' : '';
    const trail = beforeFigure && buf.length ? '\n' : '';
    segs.push({ kind: 'text', value: lead + buf.join('\n') + trail });
    buf = [];
    owedNewline = false;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const image = line.match(FIGURE_IMAGE_RE);
    if (image) {
      flushText(true);
      segs.push({ kind: 'figure', figure: { form: 'image', alt: image[1], url: image[2] }, source: line });
      owedNewline = i < lines.length - 1;
      continue;
    }

    if (FIGURE_FENCE_OPEN_RE.test(line)) {
      let end = i + 1;
      while (end < lines.length && !FIGURE_FENCE_CLOSE_RE.test(lines[end])) end++;
      const closed = end < lines.length;
      const block = lines.slice(i, closed ? end + 1 : end);
      flushText(true);
      segs.push({
        kind: 'figure',
        figure: { form: 'svg', svg: lines.slice(i + 1, end).join('\n') },
        source: block.join('\n'),
      });
      i = closed ? end : lines.length - 1;
      owedNewline = i < lines.length - 1;
      continue;
    }

    buf.push(line);
  }
  flushText(false);
  return segs;
};

/** The inverse of `splitFigures()` — for asserting the split lost nothing. */
export const figureSegsToSource = (segs: FigureSeg[]): string =>
  segs.map(s => (s.kind === 'text' ? s.value : s.source)).join('');

/** True when the text carries at least one figure — check this before rendering. */
export const hasFigure = (input: string): boolean =>
  !!input && splitFigures(input).some(s => s.kind === 'figure');

/**
 * The same segments, with the single newline either side of a figure dropped.
 * Renderers want this: the figure is a block element, so the authored line break
 * that separated it from the prose would otherwise print as a blank line.
 * Reserialising is not what this is for — use the untrimmed split for that.
 */
export const trimAroundFigures = (segs: FigureSeg[]): FigureSeg[] => {
  const out: FigureSeg[] = [];
  segs.forEach((seg, i) => {
    if (seg.kind !== 'text') { out.push(seg); return; }
    let value = seg.value;
    if (segs[i - 1]?.kind === 'figure' && value.startsWith('\n')) value = value.slice(1);
    if (segs[i + 1]?.kind === 'figure' && value.endsWith('\n')) value = value.slice(0, -1);
    if (value) out.push({ kind: 'text', value });
  });
  return out;
};

/**
 * A short human label for a figure, used wherever a drawing cannot be drawn —
 * the PDF's plain-text fallback, the .tex export, the grader's plain text.
 * An SVG's `<title>` is what names it, so author one; it is also what a screen
 * reader announces.
 */
export const figureLabel = (figure: Figure): string => {
  if (figure.form === 'image') return figure.alt.trim();
  const title = figure.svg.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return title ? title[1].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim() : '';
};

/** `[figure: circuit for Problem 3]`, or plain `[figure]` when it has no title. */
export const figurePlaceholder = (figure: Figure): string => {
  const label = figureLabel(figure);
  return label ? `[figure: ${label}]` : '[figure]';
};

/**
 * Strip what must never run when an authored SVG is inlined into a page:
 * `<script>`, `on*` handlers and `javascript:` URLs. The document is
 * instructor-authored, so this is depth rather than a boundary — but a spec
 * file can be forwarded, and a drawing has no business executing anything.
 */
export const sanitizeSvg = (svg: string): string =>
  svg
    .replace(/<script[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<script[^>]*\/>/gi, '')
    .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '')
    .replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, '')
    .replace(/(\s(?:xlink:)?href\s*=\s*["'])\s*javascript:[^"']*(["'])/gi, '$1$2');

/**
 * Prefix every id the document declares, and every reference to one.
 *
 * Ids are document-global. Two problems may legitimately show the same figure
 * (a textbook prints one drawing for two numbered problems), and two different
 * figures may each define `#arrow` — inline both and the second one's markers,
 * gradients and clip paths silently resolve to the first one's. Only ids that
 * are actually declared here are rewritten, so a reference to something defined
 * elsewhere is left alone.
 */
export const namespaceSvgIds = (svg: string, prefix: string): string => {
  const ids = new Set<string>();
  for (const m of svg.matchAll(/\sid\s*=\s*["']([^"']+)["']/g)) ids.add(m[1]);
  if (!ids.size || !prefix) return svg;

  const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Longest first, so `#gridline` is not rewritten as a prefixed `#grid`.
  const alt = [...ids].sort((a, b) => b.length - a.length).map(escapeRe).join('|');

  return svg
    .replace(new RegExp(`(\\sid\\s*=\\s*["'])(${alt})(["'])`, 'g'), (_m, a, id, b) => `${a}${prefix}${id}${b}`)
    .replace(new RegExp(`(url\\(\\s*["']?)#(${alt})(["']?\\s*\\))`, 'g'), (_m, a, id, b) => `${a}#${prefix}${id}${b}`)
    .replace(new RegExp(`((?:xlink:)?href\\s*=\\s*["'])#(${alt})(["'])`, 'g'), (_m, a, id, b) => `${a}#${prefix}${id}${b}`)
    // CSS selectors inside the drawing's own stylesheet.
    .replace(/<style[\s\S]*?<\/style\s*>/gi, block =>
      block.replace(new RegExp(`#(${alt})`, 'g'), (_m, id) => `#${prefix}${id}`));
};

/**
 * An authored SVG document, ready to drop into the DOM: no prolog, nothing
 * executable, ids namespaced, and sized so it fits the column it lands in.
 *
 * Sizing, in one rule: **the drawing is as wide as it says it is, and never
 * wider than the column.** An `<svg>` carrying only a `viewBox` is a replaced
 * element with no intrinsic width, so the browser stretches it to 100% of
 * whatever contains it — a 240×120 circuit blown up to the full page. So the
 * viewBox's own width becomes the drawn width, with `max-width:100%` to shrink
 * it when the column is narrower and `height:auto` to keep the aspect ratio. An
 * SVG that declares its own `width` keeps it, capped the same way.
 *
 * Give every figure a `viewBox`: without one there is no aspect ratio to scale
 * by, and the drawing can only be clipped.
 */
export const prepareSvgForInline = (svg: string, idPrefix: string): string => {
  const body = sanitizeSvg(svg)
    .replace(/^\s*<\?xml[\s\S]*?\?>\s*/i, '')
    .replace(/^\s*<!DOCTYPE[^>]*>\s*/i, '')
    .trim();

  const sized = body.replace(/^<svg\b([^>]*)>/i, (_whole, attrs: string) => {
    const declaresWidth = /\swidth\s*=/i.test(attrs);
    const viewBox = attrs.match(/\sviewBox\s*=\s*["']\s*[-\d.eE]+[,\s]+[-\d.eE]+[,\s]+([\d.eE]+)/i);
    const width = !declaresWidth && viewBox ? `width:${viewBox[1]}px;` : '';
    const css = `${width}max-width:100%;height:auto;`;
    if (/\sstyle\s*=/i.test(attrs)) {
      return `<svg${attrs.replace(/(\sstyle\s*=\s*["'])/i, `$1${css}`)}>`;
    }
    return `<svg${attrs} style="${css.replace(/;$/, '')}">`;
  });

  return namespaceSvgIds(sized, idPrefix);
};
