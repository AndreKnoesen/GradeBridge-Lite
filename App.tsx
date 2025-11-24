import React, { useState, useEffect, useCallback } from 'react';
import Sidebar from './components/Sidebar';
import ProblemRenderer from './components/ProblemRenderer';
import PrintView from './components/PrintView';
import { PrivacyNotice } from './components/PrivacyNotice';
import { AppState, Assignment, SubmissionData, BackupData } from './types';
import { STORAGE_KEY, PRIVACY_KEY, VERSION } from './constants';
import { DEMO_ASSIGNMENT, DEMO_LOADED_MESSAGE } from './demoAssignment';
import { AlertTriangle, Download, ChevronLeft } from 'lucide-react';

const App: React.FC = () => {
  const [state, setState] = useState<AppState>({
    studentName: '',
    studentId: '',
    assignment: null,
    submissionData: {},
    viewMode: 'edit',
    lastSaved: null,
    privacyAcknowledged: false
  });
  const [showPrivacyModal, setShowPrivacyModal] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');

  // Initial Load
  useEffect(() => {
    // Privacy Check
    const privacy = localStorage.getItem(PRIVACY_KEY);
    if (privacy !== 'true') {
      setShowPrivacyModal(true);
    } else {
      setState(s => ({ ...s, privacyAcknowledged: true }));
    }

    // Data Restore
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        // Only restore if version matches or simple check passes
        if (parsed.submissionData) {
           setState(prev => ({
             ...prev,
             studentName: parsed.studentName || '',
             studentId: parsed.studentId || '',
             assignment: parsed.assignment || null,
             submissionData: parsed.submissionData || {},
             lastSaved: parsed.lastSaved || null,
             privacyAcknowledged: true // If they have data, they likely ack'd privacy
           }));
        }
      } catch (e) {
        console.error("Failed to restore session", e);
      }
    }
  }, []);

  // Auto Save Debounced
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (state.studentName || state.studentId || Object.keys(state.submissionData).length > 0) {
        const toSave = {
          studentName: state.studentName,
          studentId: state.studentId,
          assignment: state.assignment,
          submissionData: state.submissionData,
          lastSaved: new Date().toISOString()
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
        setState(s => ({ ...s, lastSaved: toSave.lastSaved }));
      }
    }, 1000);

    return () => clearTimeout(timeoutId);
  }, [state.studentName, state.studentId, state.submissionData, state.assignment]);

  // Handlers
  const handleUpdateStudent = (field: string, value: string) => {
    setState(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmissionChange = (id: string, data: SubmissionData['key']) => {
    setState(prev => ({
      ...prev,
      submissionData: {
        ...prev.submissionData,
        [id]: data
      }
    }));
  };

  const handleLoadAssignment = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const json = JSON.parse(e.target?.result as string) as Assignment;
        // Basic validation - Assignment Maker format uses courseCode, title, problems
        if (!json.problems || !json.title || !json.courseCode) {
          throw new Error("Invalid assignment file format");
        }
        setState(prev => ({ ...prev, assignment: json, submissionData: {} }));
      } catch (err) {
        alert(
          "Invalid Assignment File\n\n" +
          "This file doesn't appear to be a valid assignment.\n\n" +
          "Please use the assignment JSON file provided by your course/instructor.\n\n" +
          "If you're trying to restore your previous work, use \"Load Work\" instead."
        );
      }
    };
    reader.readAsText(file);
  };

  const handleLoadDemo = () => {
    // Load the demo assignment directly without file upload
    setState(prev => ({ ...prev, assignment: DEMO_ASSIGNMENT, submissionData: {} }));
    setStatusMessage(DEMO_LOADED_MESSAGE);
    // Clear the message after 5 seconds
    setTimeout(() => setStatusMessage(''), 5000);
  };

  const handleExportWork = () => {
    if (!state.assignment) return;
    const backup: BackupData = {
      student_name: state.studentName,
      student_id: state.studentId,
      submission_data: state.submissionData,
      assignment_title: state.assignment.title,
      course_code: state.assignment.courseCode,
      exported_at: new Date().toISOString(),
      version: VERSION
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${state.assignment.courseCode}_${state.assignment.title}_backup.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleLoadWork = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const json = JSON.parse(e.target?.result as string);

        // Check if user accidentally loaded an assignment file instead of a backup
        if (json.problems && json.courseCode && !json.submission_data) {
          alert(
            "Wrong file type!\n\n" +
            "You selected an ASSIGNMENT file (used to define problems).\n\n" +
            "To restore your work, use a BACKUP file instead.\n" +
            "Backup files are named like: CourseCode_Title_backup.json\n\n" +
            "To load an assignment, use 'Upload JSON' in the Assignment section above."
          );
          return;
        }

        // Validate backup format
        if (!json.submission_data || !json.course_code) {
          alert(
            "Invalid backup file format.\n\n" +
            "Make sure you're loading a backup file created by 'Save Backup'.\n" +
            "Backup files contain your answers and are named: CourseCode_Title_backup.json"
          );
          return;
        }

        const backupData = json as BackupData;

        // We need the assignment structure to render
        if (!state.assignment && !window.confirm(
          "You haven't loaded an assignment file yet.\n\n" +
          "This backup might not display correctly without the original assignment structure.\n\n" +
          "Recommended: First upload the assignment JSON, then load your backup.\n\n" +
          "Continue anyway?"
        )) {
          return;
        }

        // Logic to verify course code match if assignment exists
        if (state.assignment && state.assignment.courseCode !== backupData.course_code) {
          if (!window.confirm(
            `Course code mismatch!\n\n` +
            `Backup is for: ${backupData.course_code}\n` +
            `Loaded assignment is: ${state.assignment.courseCode}\n\n` +
            `This backup may not match the current assignment. Continue anyway?`
          )) {
            return;
          }
        }

        setState(prev => ({
          ...prev,
          studentName: backupData.student_name,
          studentId: backupData.student_id,
          submissionData: backupData.submission_data,
          lastSaved: new Date().toISOString()
        }));
        alert("Work restored successfully!");
      } catch (err) {
        alert(
          "Could not read file.\n\n" +
          "Make sure the file is a valid JSON backup created by this app.\n" +
          "Backup files are named: CourseCode_Title_backup.json"
        );
      }
    };
    reader.readAsText(file);
  };

  const handleClearWork = () => {
    if (window.confirm("Are you sure you want to clear all work? This cannot be undone.")) {
      if (window.confirm("Really delete everything? Type 'YES' to confirm if you are unsure, or just click OK.")) {
         localStorage.removeItem(STORAGE_KEY);
         setState({
            studentName: '',
            studentId: '',
            assignment: null,
            submissionData: {},
            viewMode: 'edit',
            lastSaved: null,
            privacyAcknowledged: true
         });
      }
    }
  };

  const handleDownloadPDF = async () => {
    if (!state.assignment) return;
    
    // 1. Auto Backup JSON
    setStatusMessage("Saving JSON backup...");
    handleExportWork(); 

    // 2. Wait briefly to ensure JSON download starts and UI is ready
    await new Promise(r => setTimeout(r, 800));
    setStatusMessage("Generating PDF... Please wait.");

    const element = document.getElementById('pdf-content');
    if (!element) {
        setStatusMessage("Error: PDF Content not found. Try refreshing.");
        return;
    }

    // 3. HTML2PDF Options
    const opt = {
      margin: 0, // Critical: margin 0 to prevent offset issues with our full-page divs
      filename: `${state.studentId}_${state.studentName}_${state.assignment.courseCode}.pdf`.replace(/[^a-z0-9_\-\.]/gi, '_'),
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true, letterRendering: true, scrollY: 0 },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      pagebreak: { mode: ['avoid-all', 'css', 'legacy'] }
    };

    // 4. Execute PDF Generation
    if ((window as any).html2pdf) {
        try {
            const worker = (window as any).html2pdf().set(opt).from(element);
            await worker.save(); // Waits for the PDF download to trigger
            setStatusMessage("PDF Downloaded Successfully!");
            setTimeout(() => setStatusMessage(''), 5000);
        } catch (error) {
            console.error("PDF Generation Error:", error);
            setStatusMessage("Error generating PDF. See console for details.");
            alert("There was an error generating the PDF. Please check the console or try reducing the number of images.");
        }
    } else {
        alert("PDF library not loaded. Please check your internet connection and refresh.");
        setStatusMessage("");
    }
  };

  const acceptPrivacy = () => {
    localStorage.setItem(PRIVACY_KEY, 'true');
    setState(s => ({ ...s, privacyAcknowledged: true }));
    setShowPrivacyModal(false);
  };

  return (
    <div className="flex h-screen flex-col lg:flex-row overflow-hidden bg-gray-50 font-sans">
      {/* Sidebar */}
      <Sidebar
        state={state}
        onUpdateStudent={handleUpdateStudent}
        onLoadAssignment={handleLoadAssignment}
        onLoadDemo={handleLoadDemo}
        onLoadWork={handleLoadWork}
        onExportWork={handleExportWork}
        onClearWork={handleClearWork}
        onToggleView={() => setState(s => ({ ...s, viewMode: s.viewMode === 'edit' ? 'print' : 'edit' }))}
        onDownloadPDF={handleDownloadPDF}
        statusMessage={statusMessage}
      />

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto relative scroll-smooth" id="main-scroll">
        
        {/* Edit Mode View */}
        {state.viewMode === 'edit' && (
          <div className="max-w-4xl mx-auto p-6 lg:p-12 pb-32">
            {!state.assignment ? (
              <div className="flex flex-col items-center justify-center min-h-[60vh] text-center text-gray-400 py-8">
                <h2 className="text-xl font-semibold text-gray-600 mb-6">
                  {!state.studentName.trim() || !state.studentId.trim()
                    ? "Welcome! Let's Get Started"
                    : "Ready to Load Your Assignment"}
                </h2>

                {/* How-To Guide */}
                <div className="max-w-lg mb-8 text-left bg-blue-50 border border-blue-200 rounded-lg p-5 shadow-sm">
                  <h3 className="font-bold text-blue-800 mb-3 text-center">How to Submit Your Assignment</h3>
                  <ol className="space-y-3 text-sm text-blue-900">
                    <li className={`flex items-start gap-3 p-2 rounded ${state.studentName.trim() && state.studentId.trim() ? 'bg-green-50' : 'bg-blue-100'}`}>
                      <span className={`w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center flex-shrink-0 ${state.studentName.trim() && state.studentId.trim() ? 'bg-green-500 text-white' : 'bg-blue-600 text-white animate-pulse'}`}>1</span>
                      <span><strong>Enter your info</strong> - Type your Full Name and Student ID in the sidebar (left panel)</span>
                    </li>
                    <li className={`flex items-start gap-3 p-2 rounded ${state.assignment ? 'bg-green-50' : state.studentName.trim() && state.studentId.trim() ? 'bg-blue-100' : 'bg-gray-50'}`}>
                      <span className={`w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center flex-shrink-0 ${state.assignment ? 'bg-green-500 text-white' : state.studentName.trim() && state.studentId.trim() ? 'bg-blue-600 text-white animate-pulse' : 'bg-gray-400 text-white'}`}>2</span>
                      <span><strong>Load assignment</strong> - Upload the JSON file your instructor provided (or try demo)</span>
                    </li>
                    <li className="flex items-start gap-3 p-2 rounded bg-gray-50">
                      <span className="w-6 h-6 rounded-full bg-gray-400 text-white text-xs font-bold flex items-center justify-center flex-shrink-0">3</span>
                      <span><strong>Complete your work</strong> - Fill in answers for each problem</span>
                    </li>
                    <li className="flex items-start gap-3 p-2 rounded bg-gray-50">
                      <span className="w-6 h-6 rounded-full bg-gray-400 text-white text-xs font-bold flex items-center justify-center flex-shrink-0">4</span>
                      <span><strong>Download PDF</strong> - Click the green "Preview & Download PDF" button in the sidebar</span>
                    </li>
                  </ol>
                  <div className="mt-4 p-2 bg-amber-50 border border-amber-200 rounded text-xs text-amber-800">
                    <strong>Tip:</strong> Your work auto-saves in this browser. Use "Save Backup" to keep a copy you can restore later.
                  </div>
                </div>

                {state.studentName.trim() && state.studentId.trim() ? (
                  <div className="flex flex-col items-center gap-3">
                    <p className="text-sm text-gray-600 font-medium">Upload an assignment JSON from the sidebar, or try the demo:</p>
                    <button
                      onClick={handleLoadDemo}
                      className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 text-white rounded-lg shadow-lg transition-all font-medium"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                      </svg>
                      Try Demo Assignment
                    </button>
                    <p className="text-xs text-gray-400 max-w-xs">
                      Explore all features with a sample math assignment
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-3 p-4 bg-amber-50 border border-amber-200 rounded-lg">
                    <p className="text-amber-700 font-medium">Please enter your Name and Student ID first</p>
                    <p className="text-sm text-amber-600">Complete Step 1 in the sidebar (left panel) to continue</p>
                  </div>
                )}
              </div>
            ) : (
              <>
                 <div className="mb-8 border-b border-gray-200 pb-6">
                    <div className="text-sm font-bold text-blue-800 uppercase tracking-wide mb-1">{state.assignment.courseCode}</div>
                    <h1 className="text-3xl font-serif font-bold text-gray-900 mb-4">{state.assignment.title}</h1>
                    {state.assignment.preamble && (
                        <div className="bg-blue-50 p-4 rounded-lg border border-blue-100 text-blue-900 text-sm leading-relaxed">
                            <strong>Instructions:</strong> {state.assignment.preamble}
                        </div>
                    )}
                 </div>

                 <div>
                   {state.assignment.problems.map((problem, idx) => (
                     <ProblemRenderer
                       key={idx}
                       problem={problem}
                       problemIndex={idx}
                       submissionData={state.submissionData}
                       onSubmissionChange={handleSubmissionChange}
                     />
                   ))}
                 </div>

                 {/* Floating Download Reminder - appears at bottom when scrolled */}
                 <div className="fixed bottom-0 left-0 right-0 lg:left-[320px] bg-gradient-to-t from-green-600 to-green-500 text-white p-4 shadow-2xl z-40 flex items-center justify-center gap-4">
                   <span className="text-sm font-medium">Ready to submit?</span>
                   <button
                     onClick={() => setState(s => ({ ...s, viewMode: 'print' }))}
                     className="flex items-center gap-2 bg-white text-green-700 px-4 py-2 rounded-lg font-bold text-sm hover:bg-green-50 transition-colors shadow"
                   >
                     <Download className="w-4 h-4" />
                     Preview & Download PDF
                   </button>
                 </div>
              </>
            )}
          </div>
        )}

        {/* Print Preview Mode */}
        <div className={`${state.viewMode === 'print' ? 'flex flex-col' : 'hidden'} bg-gray-500 min-h-full`}>
           {state.assignment && (
               <>
                   {/* Scrollable Preview Area */}
                   <div className="flex-1 overflow-y-auto p-8 pb-40 flex justify-center">
                       <div className="shadow-2xl">
                           <PrintView
                             assignment={state.assignment}
                             submissionData={state.submissionData}
                             studentName={state.studentName}
                             studentId={state.studentId}
                           />
                       </div>
                   </div>

                   {/* Fixed Download Bar - Always visible at bottom */}
                   <div className="fixed bottom-0 left-0 right-0 lg:left-[320px] bg-gradient-to-t from-slate-900 to-slate-800 border-t border-slate-700 p-4 shadow-2xl z-40">
                     <div className="flex items-center justify-center gap-4 max-w-2xl mx-auto">
                       <button
                         onClick={() => setState(s => ({ ...s, viewMode: 'edit' }))}
                         className="py-3 px-5 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-medium flex items-center justify-center gap-2 transition-all"
                       >
                         <ChevronLeft className="w-5 h-5" />
                         Back to Edit
                       </button>
                       <button
                         onClick={handleDownloadPDF}
                         className="py-3 px-6 bg-green-600 hover:bg-green-500 text-white rounded-lg font-bold text-lg flex items-center justify-center gap-3 transition-all shadow-xl"
                       >
                         <Download className="w-6 h-6" />
                         Download Submission PDF
                       </button>
                     </div>
                     <p className="text-slate-400 text-xs text-center mt-2">
                       Scroll up to review your submission
                     </p>
                   </div>
               </>
           )}
        </div>

      </div>

      {/* Privacy Modal */}
      {showPrivacyModal && <PrivacyNotice onAccept={acceptPrivacy} />}
    </div>
  );
};

export default App;