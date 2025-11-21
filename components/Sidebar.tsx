import React, { useRef } from 'react';
import { Upload, FileJson, Save, RefreshCw, Trash2, Eye, Download, ArrowLeft, AlertCircle } from 'lucide-react';
import { AppState } from '../types';
import { VERSION } from '../constants';

interface SidebarProps {
  state: AppState;
  onUpdateStudent: (field: string, value: string) => void;
  onLoadAssignment: (file: File) => void;
  onLoadWork: (file: File) => void;
  onExportWork: () => void;
  onClearWork: () => void;
  onToggleView: () => void;
  onDownloadPDF: () => void;
  statusMessage: string;
}

const Sidebar: React.FC<SidebarProps> = ({
  state,
  onUpdateStudent,
  onLoadAssignment,
  onLoadWork,
  onExportWork,
  onClearWork,
  onToggleView,
  onDownloadPDF,
  statusMessage
}) => {
  const assignmentInputRef = useRef<HTMLInputElement>(null);
  const workInputRef = useRef<HTMLInputElement>(null);

  const handleAssignmentClick = () => assignmentInputRef.current?.click();
  const handleWorkClick = () => workInputRef.current?.click();

  const isReadyForPDF = state.studentName && state.studentId && state.assignment;

  return (
    <div className="w-full lg:w-[320px] bg-slate-900 text-slate-100 flex flex-col h-full shadow-2xl overflow-y-auto z-20">
      <div className="p-6 border-b border-slate-700 bg-slate-950">
        <div className="flex items-center gap-3 mb-2">
          <img src="/logos/BridgeSuite.png" alt="BridgeSuite" className="w-10 h-10 object-contain" />
          <div>
            <h1 className="text-lg font-bold text-white">Veri<span className="text-[#00A4E4]">Q</span>Ai</h1>
            <div className="text-xs text-slate-400">Student Submission</div>
          </div>
        </div>
        <div className="text-[10px] text-slate-600 mt-1 font-mono">{VERSION}</div>
      </div>

      <div className="p-6 space-y-8 flex-1">
        
        {/* Student Info */}
        <div className="space-y-4">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Student Info</h3>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium mb-1 text-slate-300">Full Name *</label>
              <input
                type="text"
                value={state.studentName}
                onChange={(e) => onUpdateStudent('studentName', e.target.value)}
                placeholder="Jane Doe"
                className="w-full bg-white border border-slate-300 rounded p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none text-black placeholder-gray-400 transition-all font-medium shadow-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1 text-slate-300">Student ID *</label>
              <input
                type="text"
                value={state.studentId}
                onChange={(e) => onUpdateStudent('studentId', e.target.value)}
                placeholder="A12345678"
                className="w-full bg-white border border-slate-300 rounded p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none text-black placeholder-gray-400 transition-all font-medium shadow-sm"
              />
            </div>
          </div>
        </div>

        {/* Assignment Section */}
        <div className="space-y-4">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Assignment</h3>
          
          {!state.assignment ? (
            <button
              onClick={handleAssignmentClick}
              className="w-full flex items-center justify-center gap-2 p-4 border-2 border-dashed border-slate-600 rounded-lg hover:border-blue-500 hover:bg-slate-800 transition-all text-slate-300 group"
            >
              <Upload className="w-5 h-5 group-hover:text-blue-400" />
              <span className="text-sm font-medium">Upload JSON</span>
            </button>
          ) : (
             <div className="bg-slate-800 rounded-lg p-4 border border-slate-700 shadow-sm">
              <div className="flex justify-between items-start mb-2">
                 <span className="bg-green-900 text-green-300 text-[10px] px-2 py-0.5 rounded border border-green-800">Loaded</span>
                 <button onClick={handleAssignmentClick} className="text-xs text-blue-400 hover:text-blue-300 hover:underline">Change</button>
              </div>
              <h4 className="font-bold text-white text-sm mb-1">{state.assignment.course_code}</h4>
              <p className="text-xs text-slate-300 line-clamp-2">{state.assignment.assignment_title}</p>
              <div className="mt-3 pt-3 border-t border-slate-700 text-xs flex justify-between text-slate-400">
                 <span>{state.assignment.problems.length} Problems</span>
                 <span>{state.assignment.total_points} Pts</span>
              </div>
             </div>
          )}
          <input type="file" ref={assignmentInputRef} onChange={(e) => e.target.files?.[0] && onLoadAssignment(e.target.files[0])} accept=".json" className="hidden" />
        </div>

        {/* Actions */}
        <div className="space-y-4">
           <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Data Management</h3>
           <div className="grid grid-cols-2 gap-2">
             <button onClick={onExportWork} disabled={!state.assignment} className="flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 p-2 rounded border border-slate-700 text-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-slate-200">
                <Save className="w-4 h-4" /> Save Backup
             </button>
             <button onClick={handleWorkClick} className="flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 p-2 rounded border border-slate-700 text-xs transition-colors text-slate-200">
                <FileJson className="w-4 h-4" /> Load Work
             </button>
           </div>
           <input type="file" ref={workInputRef} onChange={(e) => e.target.files?.[0] && onLoadWork(e.target.files[0])} accept=".json" className="hidden" />
           
           <button onClick={onClearWork} className="w-full flex items-center justify-center gap-2 text-red-400 hover:bg-red-950/30 hover:text-red-300 p-2 rounded border border-transparent hover:border-red-900 transition-colors text-xs">
              <Trash2 className="w-4 h-4" /> Clear All Data
           </button>
        </div>

        {/* Preview / Print */}
        <div className="pt-4 border-t border-slate-700">
           {state.viewMode === 'edit' ? (
             <button 
                onClick={onToggleView}
                disabled={!isReadyForPDF}
                className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-500 text-white rounded font-medium flex items-center justify-center gap-2 transition-all shadow-lg disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-slate-700"
              >
                <Eye className="w-4 h-4" /> Preview & Download PDF
              </button>
           ) : (
             <div className="space-y-3">
                <button 
                  onClick={onDownloadPDF}
                  className="w-full py-3 px-4 bg-green-600 hover:bg-green-500 text-white rounded font-medium flex items-center justify-center gap-2 transition-all shadow-lg animate-pulse hover:animate-none"
                >
                  <Download className="w-4 h-4" /> Download Submission
                </button>
                <button 
                  onClick={onToggleView}
                  className="w-full py-2 px-4 bg-slate-700 hover:bg-slate-600 text-white rounded font-medium flex items-center justify-center gap-2 transition-all text-sm"
                >
                  <ArrowLeft className="w-4 h-4" /> Back to Edit
                </button>
             </div>
           )}
           {!isReadyForPDF && state.viewMode === 'edit' && (
             <div className="mt-3 p-3 bg-amber-900/20 border border-amber-700/50 rounded-lg">
               <div className="flex items-start gap-2">
                 <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                 <p className="text-xs text-amber-300 leading-relaxed">
                   <strong>Required:</strong> Enter your Name, Student ID, and upload an Assignment to preview your submission.
                 </p>
               </div>
             </div>
           )}
        </div>
      </div>

      {/* Footer Status */}
      <div className="p-4 bg-slate-950 border-t border-slate-800 text-[10px] text-slate-500 flex justify-between items-center">
        <div className="flex items-center gap-2">
           {statusMessage ? (
             <span className="text-blue-400 animate-pulse">{statusMessage}</span>
           ) : state.lastSaved ? (
             <span className="text-green-500 flex items-center gap-1"><RefreshCw className="w-3 h-3" /> Saved {new Date(state.lastSaved).toLocaleTimeString()}</span>
           ) : (
             <span>Ready</span>
           )}
        </div>
      </div>
    </div>
  );
};

export default Sidebar;