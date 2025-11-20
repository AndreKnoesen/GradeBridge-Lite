import React, { useEffect, useState } from 'react';

// --- Global KaTeX Loader ---
// Tracks if the KaTeX library is available on the window object.
// This prevents race conditions where components mount before the script loads.

let isGlobalKatexLoaded = false;
if (typeof window !== 'undefined' && (window as any).katex) {
  isGlobalKatexLoaded = true;
}

const listeners = new Set<(loaded: boolean) => void>();

// Poll for KaTeX availability globally
if (typeof window !== 'undefined' && !isGlobalKatexLoaded) {
  const intervalId = setInterval(() => {
    if ((window as any).katex) {
      isGlobalKatexLoaded = true;
      listeners.forEach(cb => cb(true));
      clearInterval(intervalId);
    }
  }, 100);
  
  // Stop polling after 30 seconds to prevent infinite background work
  setTimeout(() => clearInterval(intervalId), 30000);
}

const useKatexLoaded = () => {
  const [loaded, setLoaded] = useState(isGlobalKatexLoaded);

  useEffect(() => {
    if (loaded) return;
    if (isGlobalKatexLoaded) {
      setLoaded(true);
      return;
    }
    
    const handler = (l: boolean) => setLoaded(l);
    listeners.add(handler);
    return () => { listeners.delete(handler); };
  }, [loaded]);

  return loaded;
};

interface KatexRendererProps {
  expression: string; // Expects full string WITH delimiters (e.g. "$\sin(x)$")
  block?: boolean;
  className?: string;
}

const KatexRenderer: React.FC<KatexRendererProps> = ({ expression, block = false, className = '' }) => {
  const isLoaded = useKatexLoaded();
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    // Only attempt render if KaTeX is loaded globally
    if (isLoaded && (window as any).katex) {
      // Strip delimiters immediately before rendering
      // This ensures the component state 'expression' always holds the fallback-safe raw text
      let clean = expression;
      if (block && clean.startsWith('$$') && clean.endsWith('$$')) {
        clean = clean.slice(2, -2);
      } else if (!block && clean.startsWith('$') && clean.endsWith('$')) {
        clean = clean.slice(1, -1);
      }

      try {
        const rendered = (window as any).katex.renderToString(clean, {
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
    }
  }, [expression, block, isLoaded]);

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