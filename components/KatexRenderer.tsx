import React, { useEffect, useState } from 'react';
import katex from 'katex';
import { splitMath, segToSource } from '../services/mathDelimiters';

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

export const LatexContent: React.FC<{ content: string }> = ({ content }) => {
    if (!content) return null;

    // The splitter lives in services/mathDelimiters.ts, mirrored byte-for-byte
    // from the Assignment Maker, so what the instructor authored renders here
    // exactly as it did there. Do not reintroduce a local copy of the regex.
    return (
        <span className="whitespace-pre-wrap break-words">
            {splitMath(content).map((seg, index) => {
                if (seg.kind === 'text') return <span key={index}>{seg.value}</span>;
                // KatexRenderer wants the full span, delimiters and all, so its
                // fallback can show the raw source rather than stripped LaTeX.
                return (
                    <KatexRenderer
                        key={index}
                        expression={segToSource(seg)}
                        block={seg.kind === 'display'}
                        className={seg.kind === 'display' ? 'block my-4 text-center' : ''}
                    />
                );
            })}
        </span>
    );
}

export default KatexRenderer;