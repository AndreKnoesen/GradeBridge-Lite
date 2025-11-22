import React from 'react';
import { Problem, Subsection, SubmissionData, SubmissionType } from '../types';
import SubmissionWidget from './SubmissionWidget';
import { LatexContent } from './KatexRenderer';

interface ProblemRendererProps {
  problem: Problem;
  problemIndex: number;
  submissionData: SubmissionData;
  onSubmissionChange: (id: string, data: SubmissionData['key']) => void;
}

// Convert submissionType to widget type string
const getWidgetType = (submissionType: SubmissionType | string): string => {
  switch (submissionType) {
    case SubmissionType.TEXT:
    case 'Text':
      return 'Answer as text';
    case SubmissionType.IMAGE:
    case 'Image':
      return 'Answer as image';
    case SubmissionType.AI_REFLECTIVE:
    case 'AI Reflective':
      return 'AI Reflective';
    default:
      return 'Answer as text';
  }
};

// Combine name and description for display
const getStatement = (name: string, description: string): string => {
  if (name && description) {
    return `${name}\n\n${description}`;
  }
  return name || description || '';
};

// Calculate total points for a problem from its subsections
const calculateProblemPoints = (subsections: Subsection[]): number => {
  return subsections.reduce((sum, sub) => sum + sub.points, 0);
};

const ProblemRenderer: React.FC<ProblemRendererProps> = ({ problem, problemIndex, submissionData, onSubmissionChange }) => {
  const problemId = `p${problemIndex}`;
  const problemPoints = calculateProblemPoints(problem.subsections);
  const problemStatement = getStatement(problem.name, problem.description);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden mb-8 transition-all hover:shadow-md">
      {/* Problem Header */}
      <div className="bg-slate-50 px-6 py-4 border-b border-gray-200 flex justify-between items-center">
        <h2 className="text-lg font-bold text-slate-800">
          Problem {problemIndex + 1}{problem.name ? `: ${problem.name}` : ''}
        </h2>
        <span className="bg-blue-100 text-blue-800 text-xs font-medium px-2.5 py-0.5 rounded-full border border-blue-200">
          {problemPoints} Points
        </span>
      </div>

      <div className="p-6 space-y-6">
        {/* Problem Description */}
        {problem.description && (
          <div className="prose max-w-none text-gray-800">
            <LatexContent content={problem.description} />
          </div>
        )}

        {/* Subsections */}
        {problem.subsections && problem.subsections.length > 0 && (
          <div className="space-y-8 mt-6 pl-4 border-l-2 border-gray-100">
            {problem.subsections.map((sub: Subsection, sIdx: number) => {
              const subId = `${problemId}_s${sIdx}`;
              const subStatement = sub.name || sub.description;
              const widgetType = getWidgetType(sub.submissionType);

              return (
                <div key={sub.id || sIdx} className="space-y-4">
                  <div className="font-serif font-medium text-gray-900">
                    <span className="mr-2 text-gray-500 font-sans text-sm uppercase tracking-wide">Part {String.fromCharCode(97 + sIdx)}</span>
                    {sub.name && <span className="font-bold">{sub.name}</span>}
                    <span className="ml-2 text-gray-400 text-sm font-sans">({sub.points} pts)</span>
                  </div>

                  {sub.description && (
                    <div className="prose max-w-none text-gray-700 text-sm">
                      <LatexContent content={sub.description} />
                    </div>
                  )}

                  <div className="pl-2 space-y-4">
                    <SubmissionWidget
                      type={widgetType}
                      id={subId}
                      maxImages={sub.maxImages}
                      data={submissionData[subId] || {}}
                      onChange={onSubmissionChange}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default ProblemRenderer;