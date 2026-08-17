import React, { useEffect, useState } from 'react';
import katex from 'katex';
import { splitMath, segToSource } from '../services/mathDelimiters';
import { Figure, prepareSvgForInline, figurePlaceholder, splitFigures, trimAroundFigures } from '../services/figureBlocks';

interface KatexRendererProps {
  expression: string; // Expects full string WITH delimiters (e.g. "$\sin(x)$")
  block?: boolean;
  className?: string;
}

const KatexRenderer: React.FC<KatexRendererProps> = ({ expression, block = false, className = '' }) => {
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    // Strip delimiters immediately before rendering
    // This ensures the component state 'expression' always holds the fallback-safe raw text
    let clean = expression;
    if (block && clean.startsWith('$$') && clean.endsWith('$$')) {
      clean = clean.slice(2, -2);
    } else if (!block && clean.startsWith('$') && clean.endsWith('$')) {
      clean = clean.slice(1, -1);
    }

    try {
      const rendered = katex.renderToString(clean, {
        throwOnError: false,
        displayMode: block,
        output: 'html',
        strict: false,
        trust: true,
        fleqn: false
      });
      setHtml(rendered);
    } catch (e) {
      console.warn('KaTeX render error:', e);
      setHtml(null);
    }
  }, [expression, block]);

  // Fallback: If render failed or not loaded, show the RAW expression WITH delimiters.
  // This prevents the "stripped text" issue (e.g. showing "\sin(x)" instead of "$\sin(x)$").
  if (!html) {
    return <span className={`font-mono text-gray-500 ${className}`}>{expression}</span>;
  }

  return (
    <span 
      className={className} 
      dangerouslySetInnerHTML={{ __html: html }} 
    />
  );
};

/**
 * A figure from the problem stem. The `svg` form is inlined so it stays vector
 * and scales with the column; the fallback form is an image.
 *
 * `idPrefix` must be unique on the page: ids are document-global, and the same
 * drawing may legitimately appear on two problems — inline both unprefixed and
 * the second one's markers and gradients resolve to the first one's.
 */
const FigureBlock: React.FC<{ figure: Figure; idPrefix: string }> = ({ figure, idPrefix }) => {
    if (figure.form === 'svg') {
        return (
            <span
                className="block my-4 text-center"
                dangerouslySetInnerHTML={{ __html: prepareSvgForInline(figure.svg, idPrefix) }}
            />
        );
    }
    const safe = /^\s*(?:data:image\/|https?:\/\/|\.{0,2}\/)/i.test(figure.url);
    if (!safe) return <span className="block my-4 text-center font-mono text-gray-500">{figurePlaceholder(figure)}</span>;
    return (
        <span className="block my-4 text-center">
            <img src={figure.url} alt={figure.alt} className="inline-block max-w-full h-auto" />
        </span>
    );
};

export const LatexContent: React.FC<{ content: string }> = ({ content }) => {
    const uid = React.useId().replace(/[^a-zA-Z0-9]/g, '');
    if (!content) return null;

    // Figures come out first, before the math splitter ever sees the text: an
    // SVG is full of characters `$...$` mis-reads — a stray `$` in path data is
    // enough — and the drawing would be shredded into KaTeX spans with nothing
    // downstream noticing. services/figureBlocks.ts is mirrored byte-for-byte
    // from the Assignment Maker, as services/mathDelimiters.ts is, so a figure
    // and its math render here exactly as they did when they were authored.
    // Do not reintroduce a local copy of either splitter.
    let figureIndex = 0;
    return (
        <span className="whitespace-pre-wrap break-words">
            {trimAroundFigures(splitFigures(content)).map((fig, index) => {
                if (fig.kind === 'figure') {
                    return <FigureBlock key={index} figure={fig.figure} idPrefix={`f${uid}-${figureIndex++}-`} />;
                }
                return splitMath(fig.value).map((seg, mIndex) => {
                    const key = `${index}-${mIndex}`;
                    if (seg.kind === 'text') return <span key={key}>{seg.value}</span>;
                    // KatexRenderer wants the full span, delimiters and all, so its
                    // fallback can show the raw source rather than stripped LaTeX.
                    return (
                        <KatexRenderer
                            key={key}
                            expression={segToSource(seg)}
                            block={seg.kind === 'display'}
                            className={seg.kind === 'display' ? 'block my-4 text-center' : ''}
                        />
                    );
                });
            })}
        </span>
    );
}

export default KatexRenderer;