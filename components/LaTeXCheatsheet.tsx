import React, { useState } from 'react';
import { X, BookOpen } from 'lucide-react';

interface LaTeXCheatsheetProps {
  isOpen: boolean;
  onClose: () => void;
}

type TabType = 'basics' | 'symbols' | 'calculus' | 'matrices';

export const LaTeXCheatsheet: React.FC<LaTeXCheatsheetProps> = ({ isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState<TabType>('basics');

  if (!isOpen) return null;

  const tabs: { id: TabType; label: string }[] = [
    { id: 'basics', label: 'Basics' },
    { id: 'symbols', label: 'Symbols' },
    { id: 'calculus', label: 'Calculus' },
    { id: 'matrices', label: 'Matrices' },
  ];

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-3xl w-full max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 bg-gradient-to-r from-blue-600 to-purple-600 rounded-t-xl">
          <div className="flex items-center gap-3">
            <BookOpen className="w-6 h-6 text-white" />
            <h2 className="text-xl font-bold text-white">LaTeX Math Cheatsheet</h2>
          </div>
          <button
            onClick={onClose}
            className="text-white/80 hover:text-white hover:bg-white/20 rounded-full p-1 transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200 bg-gray-50">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 py-3 px-4 text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? 'text-blue-600 border-b-2 border-blue-600 bg-white'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === 'basics' && <BasicsTab />}
          {activeTab === 'symbols' && <SymbolsTab />}
          {activeTab === 'calculus' && <CalculusTab />}
          {activeTab === 'matrices' && <MatricesTab />}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-200 bg-gray-50 rounded-b-xl">
          <p className="text-xs text-gray-500 text-center">
            Wrap your LaTeX code with <code className="bg-gray-200 px-1 rounded">$...$</code> for inline math or <code className="bg-gray-200 px-1 rounded">$$...$$</code> for display math
          </p>
        </div>
      </div>
    </div>
  );
};

const CheatsheetTable: React.FC<{ rows: { desc: string; code: string; note?: string }[] }> = ({ rows }) => (
  <table className="w-full text-sm">
    <thead>
      <tr className="border-b border-gray-200">
        <th className="text-left py-2 px-3 font-semibold text-gray-700">Description</th>
        <th className="text-left py-2 px-3 font-semibold text-gray-700">LaTeX Code</th>
        <th className="text-left py-2 px-3 font-semibold text-gray-700">Notes</th>
      </tr>
    </thead>
    <tbody>
      {rows.map((row, idx) => (
        <tr key={idx} className="border-b border-gray-100 hover:bg-gray-50">
          <td className="py-2 px-3 text-gray-600">{row.desc}</td>
          <td className="py-2 px-3">
            <code className="bg-blue-50 text-blue-800 px-2 py-0.5 rounded font-mono text-xs">{row.code}</code>
          </td>
          <td className="py-2 px-3 text-gray-500 text-xs">{row.note || ''}</td>
        </tr>
      ))}
    </tbody>
  </table>
);

const BasicsTab: React.FC = () => (
  <div className="space-y-6">
    {/* Golden Rule */}
    <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
      <h3 className="font-bold text-amber-800 mb-2">The Golden Rule: Curly Braces {'{}'}</h3>
      <p className="text-sm text-amber-700 mb-3">
        Commands usually only apply to the <strong>next single character</strong>. To group multiple characters, wrap them in curly braces.
      </p>
      <div className="grid grid-cols-2 gap-4 text-sm">
        <div className="bg-red-50 p-2 rounded border border-red-200">
          <span className="text-red-600 font-medium">Bad:</span>
          <code className="ml-2 font-mono">x^10</code>
          <span className="text-gray-500 ml-2">(only '1' gets exponent)</span>
        </div>
        <div className="bg-green-50 p-2 rounded border border-green-200">
          <span className="text-green-600 font-medium">Good:</span>
          <code className="ml-2 font-mono">x^{'{10}'}</code>
          <span className="text-gray-500 ml-2">(both digits)</span>
        </div>
      </div>
    </div>

    {/* Basic Syntax */}
    <div>
      <h3 className="font-bold text-gray-800 mb-3">Basic Syntax & Operations</h3>
      <CheatsheetTable
        rows={[
          { desc: 'Fraction', code: '\\frac{a}{b}', note: 'Numerator, denominator' },
          { desc: 'Exponents (power)', code: 'x^2 or x^{10}', note: 'Use braces for multiple chars' },
          { desc: 'Subscripts', code: 'x_1 or x_{total}', note: 'Use braces for multiple chars' },
          { desc: 'Square Root', code: '\\sqrt{x}', note: '' },
          { desc: 'Nth Root', code: '\\sqrt[3]{x}', note: 'Cube root example' },
          { desc: 'Multiplication', code: 'a \\cdot b or a \\times b', note: 'Dot or cross' },
          { desc: 'Division', code: 'a \\div b', note: 'Division symbol' },
          { desc: 'Text in Math', code: '\\text{is even}', note: 'For words in equations' },
        ]}
      />
    </div>

    {/* Parentheses */}
    <div>
      <h3 className="font-bold text-gray-800 mb-3">Parentheses (Auto-Sizing)</h3>
      <p className="text-sm text-gray-600 mb-3">
        Use <code className="bg-gray-100 px-1 rounded">\left(</code> and <code className="bg-gray-100 px-1 rounded">\right)</code> to make parentheses grow to fit content.
      </p>
      <CheatsheetTable
        rows={[
          { desc: 'Auto-size parentheses', code: '\\left( \\frac{a}{b} \\right)', note: 'Grows to fit fraction' },
          { desc: 'Square brackets', code: '\\left[ x^2 \\right]', note: '' },
          { desc: 'Curly braces', code: '\\left\\{ x \\right\\}', note: 'Need backslash for braces' },
          { desc: 'Absolute value', code: '\\left| x \\right|', note: '' },
        ]}
      />
    </div>
  </div>
);

const SymbolsTab: React.FC = () => (
  <div className="space-y-6">
    {/* Greek Letters */}
    <div>
      <h3 className="font-bold text-gray-800 mb-3">Greek Letters</h3>
      <CheatsheetTable
        rows={[
          { desc: 'Alpha', code: '\\alpha', note: '' },
          { desc: 'Beta', code: '\\beta', note: '' },
          { desc: 'Gamma', code: '\\gamma or \\Gamma', note: 'Lower/uppercase' },
          { desc: 'Delta', code: '\\delta or \\Delta', note: 'Lower/uppercase' },
          { desc: 'Theta', code: '\\theta', note: '' },
          { desc: 'Lambda', code: '\\lambda', note: '' },
          { desc: 'Pi', code: '\\pi', note: '' },
          { desc: 'Sigma', code: '\\sigma or \\Sigma', note: 'Lower/uppercase' },
          { desc: 'Omega', code: '\\omega or \\Omega', note: 'Lower/uppercase' },
        ]}
      />
    </div>

    {/* Comparison & Logic */}
    <div>
      <h3 className="font-bold text-gray-800 mb-3">Comparison & Logic</h3>
      <CheatsheetTable
        rows={[
          { desc: 'Not equal', code: '\\neq', note: '' },
          { desc: 'Approximately', code: '\\approx', note: '' },
          { desc: 'Less than or equal', code: '\\leq', note: '' },
          { desc: 'Greater than or equal', code: '\\geq', note: '' },
          { desc: 'Much less than', code: '\\ll', note: '' },
          { desc: 'Much greater than', code: '\\gg', note: '' },
          { desc: 'Plus or minus', code: '\\pm', note: '' },
          { desc: 'Infinity', code: '\\infty', note: '' },
        ]}
      />
    </div>

    {/* Arrows */}
    <div>
      <h3 className="font-bold text-gray-800 mb-3">Arrows</h3>
      <CheatsheetTable
        rows={[
          { desc: 'Right arrow', code: '\\rightarrow or \\to', note: '' },
          { desc: 'Left arrow', code: '\\leftarrow', note: '' },
          { desc: 'Double arrow', code: '\\Rightarrow', note: 'Implies' },
          { desc: 'Left-right', code: '\\leftrightarrow', note: 'If and only if' },
          { desc: 'Maps to', code: '\\mapsto', note: 'Function mapping' },
        ]}
      />
    </div>

    {/* Sets */}
    <div>
      <h3 className="font-bold text-gray-800 mb-3">Sets</h3>
      <CheatsheetTable
        rows={[
          { desc: 'Element of', code: '\\in', note: '' },
          { desc: 'Not element of', code: '\\notin', note: '' },
          { desc: 'Subset', code: '\\subset or \\subseteq', note: 'Proper/non-proper' },
          { desc: 'Union', code: '\\cup', note: '' },
          { desc: 'Intersection', code: '\\cap', note: '' },
          { desc: 'Empty set', code: '\\emptyset', note: '' },
        ]}
      />
    </div>
  </div>
);

const CalculusTab: React.FC = () => (
  <div className="space-y-6">
    {/* Calculus */}
    <div>
      <h3 className="font-bold text-gray-800 mb-3">Derivatives & Integrals</h3>
      <CheatsheetTable
        rows={[
          { desc: 'Derivative', code: '\\frac{dy}{dx}', note: 'Leibniz notation' },
          { desc: 'Partial derivative', code: '\\frac{\\partial f}{\\partial x}', note: '' },
          { desc: 'Prime notation', code: "f'(x) or f''(x)", note: 'First/second derivative' },
          { desc: 'Indefinite integral', code: '\\int f(x) dx', note: '' },
          { desc: 'Definite integral', code: '\\int_{a}^{b} f(x) dx', note: 'With limits' },
          { desc: 'Double integral', code: '\\iint', note: '' },
          { desc: 'Triple integral', code: '\\iiint', note: '' },
          { desc: 'Contour integral', code: '\\oint', note: '' },
        ]}
      />
    </div>

    {/* Limits & Sums */}
    <div>
      <h3 className="font-bold text-gray-800 mb-3">Limits, Sums & Products</h3>
      <CheatsheetTable
        rows={[
          { desc: 'Limit', code: '\\lim_{x \\to a} f(x)', note: '' },
          { desc: 'Limit at infinity', code: '\\lim_{x \\to \\infty}', note: '' },
          { desc: 'Summation', code: '\\sum_{i=1}^{n} i^2', note: '' },
          { desc: 'Product', code: '\\prod_{i=1}^{n} i', note: '' },
        ]}
      />
    </div>

    {/* Common Functions */}
    <div>
      <h3 className="font-bold text-gray-800 mb-3">Common Functions</h3>
      <CheatsheetTable
        rows={[
          { desc: 'Sine, Cosine, Tan', code: '\\sin, \\cos, \\tan', note: 'Trig functions' },
          { desc: 'Inverse trig', code: '\\arcsin, \\arccos', note: '' },
          { desc: 'Natural log', code: '\\ln x', note: '' },
          { desc: 'Logarithm', code: '\\log_{10} x', note: 'With base' },
          { desc: 'Exponential', code: 'e^{x} or \\exp(x)', note: '' },
          { desc: 'Min/Max', code: '\\min, \\max', note: '' },
        ]}
      />
    </div>

    {/* Example */}
    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
      <h4 className="font-bold text-blue-800 mb-2">Example: Fundamental Theorem of Calculus</h4>
      <code className="text-sm font-mono text-blue-700 block bg-white p-2 rounded border border-blue-100">
        \frac{'{d}'}{'{dx}'} \int_a^x f(t) dt = f(x)
      </code>
    </div>
  </div>
);

const MatricesTab: React.FC = () => (
  <div className="space-y-6">
    {/* Matrix Basics */}
    <div>
      <h3 className="font-bold text-gray-800 mb-3">Matrix Syntax</h3>
      <p className="text-sm text-gray-600 mb-3">
        Matrices use <code className="bg-gray-100 px-1 rounded">\begin{'{matrix}'}</code> environment.
        Use <code className="bg-gray-100 px-1 rounded">&</code> to separate columns and <code className="bg-gray-100 px-1 rounded">\\</code> for new rows.
      </p>

      <div className="bg-gray-50 rounded-lg p-4 mb-4">
        <h4 className="font-semibold text-gray-700 mb-2">Basic Matrix (no brackets)</h4>
        <pre className="text-sm font-mono bg-white p-3 rounded border overflow-x-auto">
{`\\begin{matrix}
a & b \\\\
c & d
\\end{matrix}`}
        </pre>
      </div>
    </div>

    {/* Matrix Types */}
    <div>
      <h3 className="font-bold text-gray-800 mb-3">Matrix Bracket Types</h3>
      <CheatsheetTable
        rows={[
          { desc: 'No brackets', code: '\\begin{matrix}...\\end{matrix}', note: '' },
          { desc: 'Parentheses ( )', code: '\\begin{pmatrix}...\\end{pmatrix}', note: 'Most common' },
          { desc: 'Square brackets [ ]', code: '\\begin{bmatrix}...\\end{bmatrix}', note: '' },
          { desc: 'Curly braces { }', code: '\\begin{Bmatrix}...\\end{Bmatrix}', note: '' },
          { desc: 'Vertical bars | |', code: '\\begin{vmatrix}...\\end{vmatrix}', note: 'Determinant' },
          { desc: 'Double bars || ||', code: '\\begin{Vmatrix}...\\end{Vmatrix}', note: 'Norm' },
        ]}
      />
    </div>

    {/* Examples */}
    <div>
      <h3 className="font-bold text-gray-800 mb-3">Complete Examples</h3>

      <div className="space-y-4">
        <div className="bg-green-50 rounded-lg p-4">
          <h4 className="font-semibold text-green-800 mb-2">2x2 Matrix with Parentheses</h4>
          <pre className="text-sm font-mono bg-white p-3 rounded border overflow-x-auto">
{`\\begin{pmatrix}
1 & 2 \\\\
3 & 4
\\end{pmatrix}`}
          </pre>
        </div>

        <div className="bg-purple-50 rounded-lg p-4">
          <h4 className="font-semibold text-purple-800 mb-2">3x3 Matrix with Square Brackets</h4>
          <pre className="text-sm font-mono bg-white p-3 rounded border overflow-x-auto">
{`\\begin{bmatrix}
a_{11} & a_{12} & a_{13} \\\\
a_{21} & a_{22} & a_{23} \\\\
a_{31} & a_{32} & a_{33}
\\end{bmatrix}`}
          </pre>
        </div>

        <div className="bg-orange-50 rounded-lg p-4">
          <h4 className="font-semibold text-orange-800 mb-2">Determinant</h4>
          <pre className="text-sm font-mono bg-white p-3 rounded border overflow-x-auto">
{`\\begin{vmatrix}
a & b \\\\
c & d
\\end{vmatrix} = ad - bc`}
          </pre>
        </div>

        <div className="bg-blue-50 rounded-lg p-4">
          <h4 className="font-semibold text-blue-800 mb-2">Augmented Matrix (for systems)</h4>
          <pre className="text-sm font-mono bg-white p-3 rounded border overflow-x-auto">
{`\\left[
\\begin{array}{cc|c}
1 & 2 & 3 \\\\
4 & 5 & 6
\\end{array}
\\right]`}
          </pre>
        </div>
      </div>
    </div>

    {/* Vectors */}
    <div>
      <h3 className="font-bold text-gray-800 mb-3">Vectors</h3>
      <CheatsheetTable
        rows={[
          { desc: 'Column vector', code: '\\begin{pmatrix} x \\\\ y \\\\ z \\end{pmatrix}', note: '' },
          { desc: 'Row vector', code: '\\begin{pmatrix} x & y & z \\end{pmatrix}', note: '' },
          { desc: 'Vector notation', code: '\\vec{v} or \\mathbf{v}', note: 'Arrow or bold' },
          { desc: 'Dot product', code: '\\vec{a} \\cdot \\vec{b}', note: '' },
          { desc: 'Cross product', code: '\\vec{a} \\times \\vec{b}', note: '' },
        ]}
      />
    </div>
  </div>
);

export default LaTeXCheatsheet;
