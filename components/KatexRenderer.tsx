import React, { useEffect, useState } from 'react';
import katex from 'katex';

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
    
    // Improved Regex:
    // 1. $$ ... $$ (Block)
    // 2. $ ... $ (Inline)
    const parts = content.split(/(\$\$[\s\S]+?\$\$|\$[^\$]+?\$)/g);

    return (
        <span className="whitespace-pre-wrap break-words">
            {parts.map((part, index) => {
                // Block Math
                if (part.startsWith('$$') && part.endsWith('$$') && part.length >= 4) {
                    // Pass the FULL part including delimiters
                    return <KatexRenderer key={index} expression={part} block={true} className="block my-4 text-center" />;
                } 
                // Inline Math
                else if (part.startsWith('$') && part.endsWith('$') && part.length >= 2) {
                    // Pass the FULL part including delimiters
                    return <KatexRenderer key={index} expression={part} block={false} />;
                } 
                // Plain Text
                else if (part) {
                    return <span key={index}>{part}</span>;
                }
                return null;
            })}
        </span>
    );
}

export default KatexRenderer;