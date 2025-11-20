import React from 'react';
import { Problem, Subsection, SubmissionData } from '../types';
import SubmissionWidget from './SubmissionWidget';
import { LatexContent } from './KatexRenderer';

interface ProblemRendererProps {
  problem: Problem;
  problemIndex: number;
  submissionData: SubmissionData;
  onSubmissionChange: (id: string, data: SubmissionData['key']) => void;
}

const ProblemRenderer: React.FC<ProblemRendererProps> = ({ problem, problemIndex, submissionData, onSubmissionChange }) => {
  const problemId = `p${problemIndex}`;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden mb-8 transition-all hover:shadow-md">
      {/* Problem Header */}
      <div className="bg-slate-50 px-6 py-4 border-b border-gray-200 flex justify-between items-center">
        <h2 className="text-lg font-bold text-slate-800">
          Problem {problemIndex + 1}
        </h2>
        <span className="bg-blue-100 text-blue-800 text-xs font-medium px-2.5 py-0.5 rounded-full border border-blue-200">
          {problem.points} Points
        </span>
      </div>

      <div className="p-6 space-y-6">
        {/* Problem Statement */}
        <div className="prose max-w-none text-gray-800">
          <LatexContent content={problem.problem_statement} />
        </div>

        {/* Problem Image */}
        {problem.problem_image && (
          <div className="my-4 p-2 border border-gray-100 rounded-lg bg-gray-50 inline-block">
            <img 
              src={`data:${problem.problem_image.content_type};base64,${problem.problem_image.data}`} 
              alt="Problem Diagram" 
              className="max-w-full h-auto rounded shadow-sm max-h-[400px]"
            />
          </div>
        )}

        {/* Subsections */}
        {problem.subsections && problem.subsections.length > 0 ? (
          <div className="space-y-8 mt-6 pl-4 border-l-2 border-gray-100">
            {problem.subsections.map((sub: Subsection, sIdx: number) => {
              const subId = `${problemId}_s${sIdx}`;
              return (
                <div key={sIdx} className="space-y-4">
                  <div className="font-serif font-medium text-gray-900">
                    <span className="mr-2 text-gray-500 font-sans text-sm uppercase tracking-wide">Part {String.fromCharCode(97 + sIdx)}</span>
                    <LatexContent content={sub.subsection_statement} />
                    <span className="ml-2 text-gray-400 text-sm font-sans">({sub.points} pts)</span>
                  </div>

                  <div className="pl-2 space-y-4">
                    {sub.submission_elements.map((elementType, eIdx) => (
                      <SubmissionWidget
                        key={eIdx}
                        type={elementType}
                        id={subId}
                        maxImages={sub.max_images_allowed}
                        data={submissionData[subId] || {}}
                        onChange={onSubmissionChange}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          /* No Subsections - Top level submissions */
          <div className="space-y-4 pt-2">
            {problem.submission_elements?.map((elementType, eIdx) => (
              <SubmissionWidget
                key={eIdx}
                type={elementType}
                id={problemId}
                maxImages={problem.max_images_allowed}
                data={submissionData[problemId] || {}}
                onChange={onSubmissionChange}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default ProblemRenderer;