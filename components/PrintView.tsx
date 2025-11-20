import React from 'react';
import { Assignment, SubmissionData, Problem, Subsection } from '../types';
import { SUBMISSION_TYPES } from '../constants';
import { LatexContent } from './KatexRenderer';

interface PrintViewProps {
  assignment: Assignment;
  submissionData: SubmissionData;
  studentName: string;
  studentId: string;
}

const PrintView: React.FC<PrintViewProps> = ({ assignment, submissionData, studentName, studentId }) => {
  
  // --- Internal Components ---

  // A reusable Page wrapper that handles dimensions, padding, and the Header.
  // Uses flexbox to allow pushing content (End Marker) to the bottom.
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
        // Safe min-height for A4 (297mm). Using 260mm leaves buffer for margins to avoid accidental overflow breaks.
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
      
      {/* Content Wrapper - Grows to fill space, allowing mt-auto elements to hit bottom */}
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

  // mt-auto pushes this element to the bottom of the flex container (Page)
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
          // Only render the FIRST image here.
          if (type === SUBMISSION_TYPES.IMAGE && data.imageAnswers && data.imageAnswers.length > 0) {
            return (
              <div key={idx} className="text-center">
                <div className="text-xs text-gray-500 mb-1 text-left font-bold uppercase tracking-wider">Image 1 of {data.imageAnswers.length}</div>
                <img
                  src={data.imageAnswers[0]}
                  alt="Student work"
                  // Increased to 140mm for better readability
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
          <h1 className="text-5xl font-black mb-6 font-sans uppercase tracking-widest text-black">{assignment.course_code}</h1>
          <h2 className="text-3xl mb-10 font-serif text-gray-800 font-bold">{assignment.assignment_title}</h2>
          
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
               <span className="font-bold text-black">{assignment.total_points}</span>
            </div>
          </div>
        </div>
        <div className="absolute bottom-10 text-sm text-gray-400 font-mono">Generated by GradeBridge Lite</div>
      </Page>

      {/* --- Loop Problems --- */}
      {assignment.problems.map((problem, pIdx) => {
         const problemId = `p${pIdx}`;
         const hasSubsections = problem.subsections && problem.subsections.length > 0;

         // Case A: NO Subsections
         if (!hasSubsections) {
            const submission = submissionData[problemId];
            const maxImages = problem.max_images_allowed || 0;
            const uploadedImages = submission?.imageAnswers || [];
            const hasExtraPages = maxImages > 1; // Extra pages if max > 1 (first image is on main page)

            return (
              <React.Fragment key={pIdx}>
                {/* Main Problem Page - Start Marker ALWAYS here */}
                <Page title={assignment.course_code} subtitle={`Problem ${pIdx + 1}`}>
                  <div className="flex justify-between items-baseline mb-4 border-b-2 border-gray-100 pb-2 flex-none">
                      <h3 className="text-2xl font-bold text-black">Problem {pIdx + 1}</h3>
                      <span className="text-lg font-bold text-gray-600 bg-gray-100 px-3 py-1 rounded">{problem.points} Points</span>
                  </div>

                  <div className="mb-6 font-serif text-lg leading-relaxed text-gray-800 text-justify flex-none">
                      <LatexContent content={problem.problem_statement} />
                  </div>

                  {problem.problem_image && (
                    <div className="mb-6 text-center flex-none">
                      <img
                        src={`data:${problem.problem_image.content_type};base64,${problem.problem_image.data}`}
                        className="max-w-full max-h-[120mm] mx-auto shadow-sm border border-gray-200"
                        alt="Problem Diagram"
                      />
                    </div>
                  )}

                  {/* Red Line: Start of Answer */}
                  <StartMarker />

                  <div className="flex-none">
                    <RenderMainAnswer data={submission} elements={problem.submission_elements || []} />
                  </div>

                  {/* Blue Line: End of Answer (Only if NO extra pages) */}
                  {!hasExtraPages && <EndMarker />}
                </Page>

                {/* Extra Pages for Additional Images - ALWAYS create pages for max_images_allowed */}
                {maxImages > 1 && Array.from({ length: maxImages - 1 }).map((_, imgIdx) => {
                   const actualImageIndex = imgIdx + 1; // Images 2, 3, etc.
                   const img = uploadedImages[actualImageIndex];
                   const isLast = imgIdx === maxImages - 2; // Last slot

                   return (
                    <Page key={`extra-${imgIdx}`} title={assignment.course_code} subtitle={`Problem ${pIdx + 1} (Image ${actualImageIndex + 1})`}>
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
         }

         // Case B: HAS Subsections
         return (
           <React.Fragment key={pIdx}>
              {/* 1. Problem Statement Page (No Answer) */}
              <Page title={assignment.course_code} subtitle={`Problem ${pIdx + 1}`}>
                 <div className="flex justify-between items-baseline mb-6 border-b-2 border-gray-100 pb-4 flex-none">
                    <h3 className="text-3xl font-bold text-black">Problem {pIdx + 1}</h3>
                    <span className="text-xl font-bold text-gray-600 bg-gray-100 px-4 py-1 rounded">{problem.points} Points</span>
                 </div>
                 <div className="font-serif text-xl leading-relaxed text-gray-800 text-justify flex-none">
                    <LatexContent content={problem.problem_statement} />
                 </div>
                 {problem.problem_image && (
                    <div className="mt-8 text-center flex-none">
                      <img
                        src={`data:${problem.problem_image.content_type};base64,${problem.problem_image.data}`}
                        className="max-w-full max-h-[160mm] mx-auto shadow-sm border border-gray-200"
                        alt="Problem Diagram"
                      />
                    </div>
                 )}
              </Page>

              {/* 2. Subsection Pages */}
              {problem.subsections!.map((sub, sIdx) => {
                 const subId = `${problemId}_s${sIdx}`;
                 const submission = submissionData[subId];
                 const maxImages = sub.max_images_allowed || 0;
                 const uploadedImages = submission?.imageAnswers || [];
                 const hasExtraPages = maxImages > 1; // Extra pages if max > 1 (first image is on main page)

                 return (
                   <React.Fragment key={sIdx}>
                      <Page title={assignment.course_code} subtitle={`Problem ${pIdx + 1} - Part (${String.fromCharCode(97 + sIdx)})`}>
                         <div className="text-2xl font-bold mb-4 text-gray-900 flex items-center gap-3 flex-none">
                            <span className="bg-gray-900 text-white w-10 h-10 flex items-center justify-center rounded-full text-xl">
                              {String.fromCharCode(97 + sIdx)}
                            </span>
                            <span>Part {String.fromCharCode(97 + sIdx)}</span>
                            <span className="text-lg font-normal text-gray-500 ml-auto">({sub.points} points)</span>
                         </div>

                         <div className="p-4 bg-gray-50 border-l-4 border-gray-300 mb-6 font-serif text-lg text-gray-800 flex-none">
                            <LatexContent content={sub.subsection_statement} />
                         </div>

                         <StartMarker />

                         <div className="flex-none">
                           <RenderMainAnswer data={submission} elements={sub.submission_elements} />
                         </div>

                         {!hasExtraPages && <EndMarker />}
                      </Page>

                      {/* Extra Pages for Additional Images in Subsection - ALWAYS create pages for max_images_allowed */}
                      {maxImages > 1 && Array.from({ length: maxImages - 1 }).map((_, imgIdx) => {
                        const actualImageIndex = imgIdx + 1; // Images 2, 3, etc.
                        const img = uploadedImages[actualImageIndex];
                        const isLast = imgIdx === maxImages - 2; // Last slot

                        return (
                          <Page key={`sub-extra-${imgIdx}`} title={assignment.course_code} subtitle={`Problem ${pIdx + 1}(${String.fromCharCode(97 + sIdx)}) - Image ${actualImageIndex + 1}`}>
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