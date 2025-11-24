import React, { useState, useRef } from 'react';
import { SUBMISSION_TYPES } from '../constants';
import { SubmissionData } from '../types';
import { Image as ImageIcon, Trash2, X, Lightbulb } from 'lucide-react';
import { LatexContent } from './KatexRenderer';

interface SubmissionWidgetProps {
  type: string;
  id: string;
  maxImages?: number;
  data: SubmissionData['key'];
  onChange: (id: string, data: SubmissionData['key']) => void;
}

const SubmissionWidget: React.FC<SubmissionWidgetProps> = ({ type, id, maxImages = 1, data, onChange }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>, field: 'textAnswer' | 'aiReflective') => {
    onChange(id, { ...data, [field]: e.target.value });
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const files = Array.from(e.target.files);
    processFiles(files);
  };

  const processFiles = (files: File[]) => {
    const currentImages = data?.imageAnswers || [];
    
    if (currentImages.length + files.length > maxImages) {
      alert(`Maximum ${maxImages} images allowed for this problem.`);
      return;
    }

    const promises = files.map(file => {
      return new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target?.result as string);
        reader.readAsDataURL(file);
      });
    });

    Promise.all(promises).then(base64Images => {
      onChange(id, { 
        ...data, 
        imageAnswers: [...currentImages, ...base64Images] 
      });
    });
  };

  const removeImage = (index: number) => {
    const currentImages = data?.imageAnswers || [];
    const newImages = currentImages.filter((_, i) => i !== index);
    onChange(id, { ...data, imageAnswers: newImages });
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (type === SUBMISSION_TYPES.IMAGE) {
      if (e.type === "dragenter" || e.type === "dragover") {
        setDragActive(true);
      } else if (e.type === "dragleave") {
        setDragActive(false);
      }
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (type === SUBMISSION_TYPES.IMAGE && e.dataTransfer.files && e.dataTransfer.files[0]) {
      processFiles(Array.from(e.dataTransfer.files));
    }
  };

  // Render Answer as Text
  if (type === SUBMISSION_TYPES.TEXT) {
    const textVal = data?.textAnswer || '';
    return (
      <div className="space-y-2 w-full">
        <label className="block text-sm font-medium text-gray-700">
          Your Answer (Text/LaTeX math format supported):
        </label>
        <textarea
          value={textVal}
          onChange={(e) => handleTextChange(e, 'textAnswer')}
          className="w-full p-3 border border-gray-300 bg-white text-gray-900 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 min-h-[150px] font-mono text-sm placeholder-gray-500"
          placeholder="Type your answer here... Use $...$ for inline math and $$...$$ for display math."
        />
        {textVal && (textVal.includes('$') || textVal.includes('\\')) && (
          <div className="mt-2 p-3 bg-gray-50 border border-gray-200 rounded-md">
            <p className="text-xs text-gray-500 mb-1 font-bold uppercase">Preview:</p>
            <div className="prose prose-sm max-w-none">
              <LatexContent content={textVal} />
            </div>
          </div>
        )}
        <div className="flex items-center gap-1.5 text-xs text-slate-500 mt-1">
          <Lightbulb className="w-3 h-3" />
          <span>Focus on your answer - PDF formatting is handled automatically for Gradescope.</span>
        </div>
      </div>
    );
  }

  // Render Answer as Image
  if (type === SUBMISSION_TYPES.IMAGE) {
    const images = data?.imageAnswers || [];
    
    return (
      <div className="space-y-3 w-full">
        <label className="block text-sm font-medium text-gray-700">
          Your Answer (Images - Max {maxImages}):
        </label>
        
        <div 
          className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
            dragActive ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-gray-400'
          }`}
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={handleImageUpload}
            className="hidden"
          />
          <div className="flex flex-col items-center justify-center space-y-2">
            <ImageIcon className="w-8 h-8 text-gray-400" />
            <div className="text-sm text-gray-600">
              <button 
                onClick={() => fileInputRef.current?.click()}
                className="font-medium text-blue-600 hover:text-blue-500"
              >
                Upload images
              </button>
              <span className="mx-1">or drag and drop</span>
            </div>
            <p className="text-xs text-gray-500">PNG, JPG, GIF up to 10MB</p>
          </div>
        </div>

        {images.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mt-4">
            {images.map((img, idx) => (
              <div key={idx} className="relative group aspect-w-4 aspect-h-3 bg-gray-100 rounded-lg overflow-hidden border border-gray-200">
                <img src={img} alt={`Uploaded ${idx + 1}`} className="object-cover w-full h-full" />
                <button
                  onClick={() => removeImage(idx)}
                  className="absolute top-1 right-1 bg-red-600 text-white p-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Remove image"
                >
                  <X className="w-4 h-4" />
                </button>
                <div className="absolute bottom-0 left-0 right-0 bg-black bg-opacity-50 text-white text-xs p-1 text-center">
                  Image {idx + 1}
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-center justify-between text-xs text-gray-500">
          <div className="flex items-center gap-1.5 text-slate-500">
            <Lightbulb className="w-3 h-3" />
            <span>Upload clear images - PDF layout is optimized for Gradescope.</span>
          </div>
          <span>{images.length} / {maxImages} images uploaded</span>
        </div>
      </div>
    );
  }

  // Render AI Reflective
  if (type === SUBMISSION_TYPES.AI) {
    return (
      <div className="space-y-2 w-full">
         <label className="block text-sm font-medium text-purple-700 flex items-center gap-2">
          <span className="bg-purple-100 text-purple-800 text-xs px-2 py-0.5 rounded-full border border-purple-200">Reflective</span>
          AI Tool Usage Documentation:
        </label>
        <textarea
          value={data?.aiReflective || ''}
          onChange={(e) => handleTextChange(e, 'aiReflective')}
          className="w-full p-3 border border-purple-200 bg-purple-50 text-gray-900 rounded-md shadow-sm focus:ring-purple-500 focus:border-purple-500 min-h-[120px] text-sm placeholder-purple-300"
          placeholder="Describe how you used AI tools for this problem (prompts used, validation steps, etc.)..."
        />
        <div className="flex items-center gap-1.5 text-xs text-purple-400 mt-1">
          <Lightbulb className="w-3 h-3" />
          <span>Document your process - formatting is handled automatically.</span>
        </div>
      </div>
    );
  }

  return null;
};

export default SubmissionWidget;