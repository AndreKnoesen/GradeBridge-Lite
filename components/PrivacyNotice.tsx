import React from 'react';
import { ShieldCheck, Info, AlertCircle } from 'lucide-react';

interface PrivacyNoticeProps {
  onAccept: () => void;
}

export const PrivacyNotice: React.FC<PrivacyNoticeProps> = ({ onAccept }) => {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-2xl max-w-5xl w-full max-h-[95vh] overflow-y-auto">
        <div className="bg-gradient-to-r from-academic-800 to-academic-900 text-white p-6 rounded-t-lg">
          <div className="flex items-center gap-3">
            <ShieldCheck className="w-8 h-8" />
            <div>
              <h2 className="text-2xl font-bold">Welcome to BridgeSuite Student Submission</h2>
              <p className="text-blue-200 text-sm mt-1">Privacy & Data Notice</p>
            </div>
          </div>
        </div>

        <div className="p-6 space-y-4">
          <div className="flex items-start gap-3 p-4 bg-green-50 border border-green-200 rounded-lg">
            <ShieldCheck className="w-6 h-6 text-green-600 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-bold text-green-900 mb-2">100% Local Execution</h3>
              <p className="text-green-800 text-sm">
                This application runs entirely in your browser. No student data, answers, images, or files are ever sent to a server.
                Your submissions remain completely private and under your control until you export the final PDF.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3 p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <Info className="w-6 h-6 text-blue-600 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-bold text-blue-900 mb-2">FERPA Compliance & Data Persistence</h3>
              <p className="text-blue-800 text-sm mb-2">
                Because data never leaves your device until you submit the final PDF to your instructor,
                your educational records remain in your control and FERPA-compliant.
              </p>
              <p className="text-blue-800 text-sm">
                Your work is automatically saved to your browser's "Local Storage". Please do not clear your
                browser cache while working on an assignment. We strongly recommend using the "Backup" feature
                frequently to export your work.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-lg">
            <AlertCircle className="w-6 h-6 text-amber-600 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-bold text-amber-900 mb-2">Important Recommendations</h3>
              <ul className="text-amber-800 text-sm space-y-1 list-disc list-inside">
                <li>Export your work regularly using the "Backup" feature</li>
                <li>Use the same browser and device for consistent access to your data</li>
                <li>Avoid using private/incognito mode as it may clear your data when closed</li>
                <li>Download your PDF submission before the deadline</li>
              </ul>
            </div>
          </div>

          <div className="border-t border-gray-200 pt-4">
            <h3 className="font-bold text-gray-900 mb-2">Disclaimer</h3>
            <p className="text-gray-600 text-sm">
              This software is provided "as is", without warranty of any kind, express or implied,
              including but not limited to the warranties of merchantability, fitness for a particular
              purpose and noninfringement. Copyright © 2026 The Regents of the University of
              California. This application is made available under the Apache License, Version 2.0.
            </p>
          </div>

          <div className="border-t border-gray-200 pt-4">
            <p className="text-gray-500 text-xs text-center">
              Provided free of charge by <span className="font-bold text-[#00A4E4]">BridgeSuite</span>
            </p>
          </div>
        </div>

        <div className="p-4 bg-gray-50 border-t border-gray-200 rounded-b-lg">
          <button
            onClick={onAccept}
            className="w-full bg-academic-800 text-white py-2.5 px-6 rounded-md font-medium hover:bg-academic-900 transition-colors shadow-sm"
          >
            I Understand - Continue to Submission App
          </button>
        </div>
      </div>
    </div>
  );
};
