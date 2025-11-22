import React from 'react';
import { Assignment, SubmissionData, Problem, Subsection, SubmissionType } from '../types';
import { SUBMISSION_TYPES } from '../constants';
import { LatexContent } from './KatexRenderer';

interface PrintViewProps {
  assignment: Assignment;
  submissionData: SubmissionData;
  studentName: string;
  studentId: string;
}

// Helper to convert submissionType to widget type string
const getSubmissionElements = (submissionType: SubmissionType | string): string[] => {
  switch (submissionType) {
    case SubmissionType.TEXT:
    case 'Text':
      return [SUBMISSION_TYPES.TEXT];
    case SubmissionType.IMAGE:
    case 'Image':
      return [SUBMISSION_TYPES.IMAGE];
    case SubmissionType.AI_REFLECTIVE:
    case 'AI Reflective':
      return [SUBMISSION_TYPES.AI];
    default:
      return [SUBMISSION_TYPES.TEXT];
  }
};

// Calculate total points from all subsections
const calculateTotalPoints = (problems: Problem[]): number => {
  return problems.reduce((sum, p) =>
    sum + p.subsections.reduce((s, sub) => s + sub.points, 0), 0);
};

// Calculate problem points from its subsections
const calculateProblemPoints = (problem: Problem): number => {
  return problem.subsections.reduce((sum, sub) => sum + sub.points, 0);
};

const PrintView: React.FC<PrintViewProps> = ({ assignment, submissionData, studentName, studentId }) => {
  const totalPoints = calculateTotalPoints(assignment.problems);

  // --- Internal Components ---

  // A reusable Page wrapper that handles dimensions, padding, and the Header.
  const Page = ({
    children,
    title,
    subtitle,
    isTitlePage = false,
    noBreak = false
  }: {
    children: React.ReactNode;
    title?: string;
    subtitle?: string;
    isTitlePage?: boolean;
    noBreak?: boolean;
  }) => (
    <div
      className={`bg-white mx-auto text-black font-sans relative box-border flex flex-col ${!noBreak ? 'html2pdf__page-break' : ''}`}
      style={{
        width: '210mm',
        minHeight: isTitlePage ? '280mm' : '260mm',
        padding: '20mm',
        paddingTop: '15mm',
        paddingBottom: '15mm'
      }}
    >
      {/* Header Section - Always at top */}
      {!isTitlePage && title && subtitle && (
        <div className="border-b-4 border-gray-900 pb-4 mb-6 flex justify-between items-end w-full flex-none">
          <div className="flex flex-col">
            <span className="text-xl font-bold text-black uppercase tracking-tight">ID: {studentId}</span>
            <span className="text-base font-medium text-gray-700">{studentName}</span>
          </div>
          <div className="text-right">
            <div className="text-lg font-bold text-black uppercase">{title}</div>
            <div className="text-sm text-gray-600 font-medium">{subtitle}</div>
          </div>
        </div>
      )}

      {/* Content Wrapper */}
      <div className={`flex-1 flex flex-col ${isTitlePage ? 'justify-center items-center' : ''}`}>
         {children}
      </div>
    </div>
  );

  const StartMarker = () => (
    <div className="mb-4 mt-2 text-red-700 text-sm font-bold tracking-widest border-t-2 border-red-200 pt-2 uppercase flex-none w-full">
      Start of Answer
    </div>
  );

  const EndMarker = () => (
    <div className="mt-auto pt-8 text-blue-700 text-sm font-bold tracking-widest border-b-2 border-blue-200 pb-2 uppercase flex-none w-full">
      End of Answer
    </div>
  );

  // Renders the Answer content.
  const RenderMainAnswer = ({ data, elements }: { data: SubmissionData['key'] | undefined, elements: string[] }) => {
    if (!data) return <div className="text-gray-400 italic p-4 border border-gray-200 bg-gray-50 rounded mb-4">No answer submitted.</div>;

    return (
      <div className="space-y-6">
        {elements.map((type, idx) => {
          if (type === SUBMISSION_TYPES.TEXT && data.textAnswer) {
            return (
              <div key={idx} className="font-serif text-base leading-relaxed text-black">
                <LatexContent content={data.textAnswer} />
              </div>
            );
          }
          if (type === SUBMISSION_TYPES.IMAGE && data.imageAnswers && data.imageAnswers.length > 0) {
            return (
              <div key={idx} className="text-center">
                <div className="text-xs text-gray-500 mb-1 text-left font-bold uppercase tracking-wider">Image 1 of {data.imageAnswers.length}</div>
                <img
                  src={data.imageAnswers[0]}
                  alt="Student work"
                  className="max-w-full max-h-[140mm] border-2 border-gray-800 shadow-sm inline-block object-contain"
                />
              </div>
            );
          }
          if (type === SUBMISSION_TYPES.AI && data.aiReflective) {
            return (
              <div key={idx} className="text-sm text-gray-900">
                <strong className="block text-gray-700 text-base mb-2 uppercase tracking-wide">AI Reflection & Tools Used:</strong>
                <div className="whitespace-pre-wrap"><LatexContent content={data.aiReflective} /></div>
              </div>
            );
          }
          return null;
        })}
      </div>
    );
  };

  return (
    <div id="pdf-content">

      {/* --- Title Page --- */}
      <Page isTitlePage noBreak={true}>
        <div className="mb-12 p-10 border-8 border-double border-gray-900 w-full bg-gray-50 text-center">
          <h1 className="text-5xl font-black mb-6 font-sans uppercase tracking-widest text-black">{assignment.courseCode}</h1>
          <h2 className="text-3xl mb-10 font-serif text-gray-800 font-bold">{assignment.title}</h2>

          <div className="w-48 h-2 bg-black mx-auto mb-10"></div>

          <div className="text-left inline-block mx-auto space-y-6 text-2xl">
            <div className="grid grid-cols-[180px_1fr] gap-4 items-baseline">
               <span className="font-bold text-gray-600 uppercase text-lg">Student Name</span>
               <span className="font-bold text-black border-b-2 border-gray-300 pb-1">{studentName}</span>
            </div>
            <div className="grid grid-cols-[180px_1fr] gap-4 items-baseline">
               <span className="font-bold text-gray-600 uppercase text-lg">Student ID</span>
               <span className="font-bold text-black border-b-2 border-gray-300 pb-1">{studentId}</span>
            </div>
            <div className="grid grid-cols-[180px_1fr] gap-4 items-baseline">
               <span className="font-bold text-gray-600 uppercase text-lg">Total Points</span>
               <span className="font-bold text-black">{totalPoints}</span>
            </div>
          </div>
        </div>
        <div className="absolute bottom-10 text-sm text-gray-400 font-mono">Generated by GradeBridge Lite</div>
      </Page>

      {/* --- Loop Problems --- */}
      {assignment.problems.map((problem, pIdx) => {
         const problemId = `p${pIdx}`;
         const problemPoints = calculateProblemPoints(problem);
         const problemStatement = problem.description || problem.name;

         // Problems always have subsections in the new format
         return (
           <React.Fragment key={pIdx}>
              {/* 1. Problem Statement Page (No Answer) */}
              <Page title={assignment.courseCode} subtitle={`Problem ${pIdx + 1}`}>
                 <div className="flex justify-between items-baseline mb-6 border-b-2 border-gray-100 pb-4 flex-none">
                    <h3 className="text-3xl font-bold text-black">Problem {pIdx + 1}{problem.name ? `: ${problem.name}` : ''}</h3>
                    <span className="text-xl font-bold text-gray-600 bg-gray-100 px-4 py-1 rounded">{problemPoints} Points</span>
                 </div>
                 {problem.description && (
                   <div className="font-serif text-xl leading-relaxed text-gray-800 text-justify flex-none">
                      <LatexContent content={problem.description} />
                   </div>
                 )}
              </Page>

              {/* 2. Subsection Pages */}
              {problem.subsections.map((sub, sIdx) => {
                 const subId = `${problemId}_s${sIdx}`;
                 const submission = submissionData[subId];
                 const maxImages = sub.maxImages || 0;
                 const uploadedImages = submission?.imageAnswers || [];
                 const hasExtraPages = maxImages > 1;
                 const submissionElements = getSubmissionElements(sub.submissionType);
                 const subStatement = sub.description || sub.name;

                 return (
                   <React.Fragment key={sIdx}>
                      <Page title={assignment.courseCode} subtitle={`Problem ${pIdx + 1} - Part (${String.fromCharCode(97 + sIdx)})`}>
                         <div className="text-2xl font-bold mb-4 text-gray-900 flex items-center gap-3 flex-none">
                            <span className="bg-gray-900 text-white w-10 h-10 flex items-center justify-center rounded-full text-xl">
                              {String.fromCharCode(97 + sIdx)}
                            </span>
                            <span>Part {String.fromCharCode(97 + sIdx)}{sub.name ? `: ${sub.name}` : ''}</span>
                            <span className="text-lg font-normal text-gray-500 ml-auto">({sub.points} points)</span>
                         </div>

                         {sub.description && (
                           <div className="p-4 bg-gray-50 border-l-4 border-gray-300 mb-6 font-serif text-lg text-gray-800 flex-none">
                              <LatexContent content={sub.description} />
                           </div>
                         )}

                         <StartMarker />

                         <div className="flex-none">
                           <RenderMainAnswer data={submission} elements={submissionElements} />
                         </div>

                         {!hasExtraPages && <EndMarker />}
                      </Page>

                      {/* Extra Pages for Additional Images in Subsection */}
                      {maxImages > 1 && Array.from({ length: maxImages - 1 }).map((_, imgIdx) => {
                        const actualImageIndex = imgIdx + 1;
                        const img = uploadedImages[actualImageIndex];
                        const isLast = imgIdx === maxImages - 2;

                        return (
                          <Page key={`sub-extra-${imgIdx}`} title={assignment.courseCode} subtitle={`Problem ${pIdx + 1}(${String.fromCharCode(97 + sIdx)}) - Image ${actualImageIndex + 1}`}>
                                <div className="text-sm text-gray-500 mb-2 font-bold uppercase tracking-wider flex-none">
                                  Image {actualImageIndex + 1} of {maxImages}
                                </div>
                                <div className="flex-1 flex items-start justify-center">
                                    {img ? (
                                      <img
                                        src={img}
                                        alt={`Student work ${actualImageIndex + 1}`}
                                        className="max-w-full max-h-[240mm] border-2 border-gray-800 shadow-sm object-contain"
                                      />
                                    ) : (
                                      <div className="text-gray-400 italic text-center p-8 border-2 border-dashed border-gray-300 rounded">
                                        No image submitted for this slot
                                      </div>
                                    )}
                                </div>
                                {isLast && <EndMarker />}
                          </Page>
                        );
                      })}
                   </React.Fragment>
                 );
              })}
           </React.Fragment>
         );
      })}
    </div>
  );
};

export default PrintView;
