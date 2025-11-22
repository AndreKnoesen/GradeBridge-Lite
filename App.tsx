import React, { useState, useEffect, useCallback } from 'react';
import Sidebar from './components/Sidebar';
import ProblemRenderer from './components/ProblemRenderer';
import PrintView from './components/PrintView';
import { PrivacyNotice } from './components/PrivacyNotice';
import { AppState, Assignment, SubmissionData, BackupData } from './types';
import { STORAGE_KEY, PRIVACY_KEY, VERSION } from './constants';
import { DEMO_ASSIGNMENT, DEMO_LOADED_MESSAGE } from './demoAssignment';
import { AlertTriangle } from 'lucide-react';

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
        // Basic validation
        if (!json.problems || !json.assignment_title || !json.course_code) {
          throw new Error("Invalid assignment file format");
        }
        setState(prev => ({ ...prev, assignment: json, submissionData: {} })); // Reset submission on new assignment? Or keep? Let's reset to be safe or maybe keep matching IDs. Let's reset for now to avoid conflicts.
        // Actually, prompting might be better, but let's keep it simple: New Assignment = New Start usually.
        // To be safe, we'll clear submission data if the assignment changes.
      } catch (err) {
        alert("Error loading assignment: Invalid JSON format.");
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
      assignment_title: state.assignment.assignment_title,
      course_code: state.assignment.course_code,
      exported_at: new Date().toISOString(),
      version: VERSION
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${state.assignment.course_code}_${state.assignment.assignment_title}_backup.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleLoadWork = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const json = JSON.parse(e.target?.result as string) as BackupData;
        // Validate
        if (!json.submission_data || !json.course_code) throw new Error();
        
        // We need the assignment structure to render. 
        // If the user hasn't loaded the assignment JSON yet, this backup assumes they have, 
        // OR the backup should ideally contain the assignment structure too, but the prompt separates them.
        // However, if the current state doesn't have an assignment, we warn them.
        if (!state.assignment && !window.confirm("You haven't loaded an assignment file yet. This backup might not display correctly without the original assignment structure. Continue?")) {
            return;
        }
        
        // Logic to verify course code match if assignment exists
        if (state.assignment && state.assignment.course_code !== json.course_code) {
            alert(`Warning: Backup is for ${json.course_code} but loaded assignment is ${state.assignment.course_code}.`);
        }

        setState(prev => ({
          ...prev,
          studentName: json.student_name,
          studentId: json.student_id,
          submissionData: json.submission_data,
          lastSaved: new Date().toISOString()
        }));
        alert("Work restored successfully.");
      } catch (err) {
        alert("Invalid backup file.");
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
      filename: `${state.studentId}_${state.studentName}_${state.assignment.course_code}.pdf`.replace(/[^a-z0-9_\-\.]/gi, '_'),
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
              <div className="flex flex-col items-center justify-center h-[60vh] text-center text-gray-400">
                <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mb-4">
                  <AlertTriangle className="w-10 h-10 text-gray-300" />
                </div>
                <h2 className="text-xl font-semibold text-gray-600 mb-2">No Assignment Loaded</h2>
                <p className="max-w-md mb-6">Upload an assignment JSON file from the sidebar to begin your work.</p>

                <div className="flex flex-col items-center gap-3">
                  <p className="text-sm text-gray-500">New here? Try a demo first:</p>
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
                    Explore all features with a sample math assignment - no file needed!
                  </p>
                </div>
              </div>
            ) : (
              <>
                 <div className="mb-8 border-b border-gray-200 pb-6">
                    <div className="text-sm font-bold text-blue-800 uppercase tracking-wide mb-1">{state.assignment.course_code}</div>
                    <h1 className="text-3xl font-serif font-bold text-gray-900 mb-4">{state.assignment.assignment_title}</h1>
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
              </>
            )}
          </div>
        )}

        {/* Print Preview Mode */}
        <div className={`${state.viewMode === 'print' ? 'block' : 'hidden'} bg-gray-500 p-8 min-h-full flex justify-center`}>
           {state.assignment && (
               <div className="shadow-2xl">
                   <PrintView 
                     assignment={state.assignment}
                     submissionData={state.submissionData}
                     studentName={state.studentName}
                     studentId={state.studentId}
                   />
               </div>
           )}
        </div>

      </div>

      {/* Privacy Modal */}
      {showPrivacyModal && <PrivacyNotice onAccept={acceptPrivacy} />}
    </div>
  );
};

export default App;