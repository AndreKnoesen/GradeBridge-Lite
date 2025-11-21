# GradeBridge-Lite

A pure client-side student submission application for academic assignments with auto-save, LaTeX support, and professional PDF generation designed for Gradescope compatibility.

![Version](https://img.shields.io/badge/version-3.0.0-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)

**🚀 [Live Demo](https://andreknoesen.github.io/GradeBridge-Student-Submission/)** - Try the app now!

## Overview

**GradeBridge-Lite** is a React-based web application that enables students to complete and submit academic assignments in a structured, professional format. All processing happens **entirely in the browser** - no server required, no data transmitted anywhere.

### Key Features

- **100% Client-Side Processing**: All work is stored locally in your browser
- **Auto-Save**: Work is automatically saved every second to prevent data loss
- **LaTeX Math Support**: Write mathematical expressions using `$...$` for inline and `$$...$$` for display math
- **Professional PDF Generation**: Export submissions as properly formatted PDFs for Gradescope
- **Multiple Submission Types**:
  - Text answers with LaTeX rendering
  - Image uploads (photos of handwritten work, diagrams, plots)
  - AI Reflective documentation (describe AI tool usage)
- **Backup & Restore**: Export your work as JSON and restore it later
- **Print Preview**: See exactly how your PDF will look before downloading
- **Privacy-First**: Explicit privacy notice on first use
- **Gradescope Integration**: PDF format designed to match instructor templates

## Technology Stack

- **React 19.2** - UI framework
- **TypeScript** - Type safety
- **Vite** - Build tool and dev server
- **Lucide React** - Icon library
- **KaTeX** - LaTeX rendering (loaded from CDN)
- **html2pdf.js** - PDF generation (loaded from CDN)

## Installation & Setup

### Prerequisites

- Node.js (v18 or higher recommended)
- npm or yarn

### Local Development

1. **Clone the repository**:
   ```bash
   git clone https://github.com/AndreKnoesen/GradeBridge-Student-Submission.git
   cd GradeBridge-Student-Submission
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Run the development server**:
   ```bash
   npm run dev
   ```

4. **Open in browser**:
   - Navigate to `http://localhost:5173` (or the port shown in terminal)

### Build for Production

```bash
npm run build
```

The built files will be in the `dist` directory, ready to deploy to any static hosting service.

### Preview Production Build

```bash
npm run preview
```

## Usage Guide

### 1. First Time Setup

When you first open GradeBridge-Lite, you'll see a **privacy notice** explaining that all data is stored locally in your browser. Click "I Understand" to proceed.

### 2. Load an Assignment

1. Obtain an assignment JSON file from your instructor
2. In the sidebar, click **"Load Assignment"**
3. Select the JSON file from your computer
4. The assignment will load with all problems and instructions

### 3. Enter Student Information

Fill in your:
- **Student Name** (as it appears on official records)
- **Student ID**

This information appears on every page of your PDF submission.

### 4. Complete Problems

For each problem/subsection:

- **Text Answers**: Type directly into the text area
  - Use LaTeX: `$x^2 + y^2 = z^2$` for inline math
  - Use LaTeX: `$$\int_0^\infty e^{-x^2} dx$$` for display math
  - Preview appears automatically below the input

- **Image Answers**:
  - Drag and drop images, or click to browse
  - Upload photos of handwritten work, plots, diagrams
  - Supports PNG, JPG, GIF (up to 10MB each)
  - Maximum images per problem set by instructor

- **AI Reflective**:
  - Document how you used AI tools (ChatGPT, Copilot, etc.)
  - Describe prompts, validation steps, and learning outcomes
  - Required for assignments with AI usage policies

### 5. Save and Export

#### Auto-Save
Your work is automatically saved to browser storage every second. The sidebar shows the last save time.

#### Manual Backup
Click **"Export Work"** to download a JSON backup file containing:
- Student information
- All answers (text, images, AI documentation)
- Assignment metadata

**Recommendation**: Export frequently, especially before:
- Clearing browser cache
- Switching browsers
- Generating final PDF

#### Restore Work
Click **"Load Work"** and select a previously exported JSON backup to restore your progress.

### 6. Generate PDF

1. Click **"Preview PDF"** to see how your submission will look
2. Review all answers, formatting, and page breaks
3. Click **"Download PDF"** to generate the final submission
4. **Two files download automatically**:
   - A JSON backup (for your records)
   - The PDF submission (upload to Gradescope)

**PDF Naming Convention**:
`{StudentID}_{StudentName}_{CourseCode}.pdf`

### 7. Submit to Gradescope

1. Upload the generated PDF to Gradescope
2. Gradescope should auto-detect problem regions (if instructor configured properly)
3. Verify all pages are included before finalizing submission

## Assignment JSON Format

Instructors create assignments using the **GradeBridge-Lite Assignment Maker**. The JSON structure:

```json
{
  "assignment_title": "Mini-Project 1",
  "course_code": "ECE416",
  "course_name": "Digital Control Systems",
  "preamble": "Instructions for the entire assignment...",
  "total_points": 50,
  "problems": [
    {
      "problem_statement": "Analyze the following system...",
      "points": 10,
      "problem_image": {
        "data": "base64_encoded_image",
        "content_type": "image/png",
        "filename": "system_diagram.png"
      },
      "subsections": [
        {
          "subsection_statement": "Derive the transfer function",
          "points": 5,
          "submission_elements": ["Answer as text"],
          "max_images_allowed": 0
        },
        {
          "subsection_statement": "Plot the step response",
          "points": 5,
          "submission_elements": ["Answer as image"],
          "max_images_allowed": 2
        }
      ]
    }
  ]
}
```

### Key Fields

- **`submission_elements`**: Array of allowed answer types:
  - `"Answer as text"` - Text/LaTeX input
  - `"Answer as image"` - Image uploads
  - `"AI Reflective"` - AI usage documentation
- **`max_images_allowed`**: Maximum number of images for image-based answers
- **`problem_image`**: Base64-encoded image attached to problem statement
- **`subsections`**: Optional sub-parts of a problem

## Data Storage & Privacy

### What Gets Stored

GradeBridge-Lite stores data in **browser localStorage**:

- **Key**: `gradebridge_submission`
- **Contains**: Student info, assignment structure, all answers
- **Size**: Typically 1-5 MB (varies with image uploads)

### Privacy Guarantees

✅ **No server communication** - everything runs in your browser
✅ **No analytics or tracking**
✅ **No account required**
✅ **Data never leaves your computer** (unless you export)

### Data Persistence

- Data survives browser restarts
- Data survives computer restarts
- Data is **lost** if you:
  - Clear browser cache/localStorage
  - Use incognito/private mode
  - Switch browsers or computers

**Always export backups before clearing data or switching devices.**

## File Structure

```
GradeBridge-Lite/
├── App.tsx                          # Main application component
├── index.tsx                        # Entry point
├── types.ts                         # TypeScript interfaces
├── constants.ts                     # App constants and colors
├── components/
│   ├── Sidebar.tsx                  # Left sidebar with controls
│   ├── ProblemRenderer.tsx          # Renders problems and subsections
│   ├── SubmissionWidget.tsx         # Text/image/AI input widgets
│   ├── PrintView.tsx                # PDF layout component
│   ├── KatexRenderer.tsx            # LaTeX rendering wrapper
│   └── PrivacyNotice.tsx            # Privacy modal
├── index.html                       # HTML entry (loads KaTeX and html2pdf CDNs)
├── package.json                     # Dependencies
├── vite.config.ts                   # Vite configuration
├── tsconfig.json                    # TypeScript configuration
├── GRADESCOPE_COORDINATION.md       # Technical doc for Gradescope alignment
└── README.md                        # This file
```

## Gradescope Coordination

GradeBridge-Lite PDFs are designed to match **Assignment Maker** template PDFs for Gradescope auto-grading.

**Critical Requirements**:
- One page per subsection
- Consistent headers on all pages
- Image answers get dedicated pages
- Matching problem/subsection numbering

See [GRADESCOPE_COORDINATION.md](./GRADESCOPE_COORDINATION.md) for detailed technical specifications.

## Troubleshooting

### PDF Generation Fails

**Cause**: `html2pdf` library failed to load from CDN
**Solution**: Check internet connection, refresh page, try different browser

### LaTeX Not Rendering

**Cause**: KaTeX library failed to load from CDN
**Solution**: Check internet connection, refresh page

### Lost Work After Closing Browser

**Cause**: Data was not saved or localStorage was cleared
**Solution**: Always export JSON backups before closing. Check browser settings for localStorage persistence.

### Assignment Won't Load

**Cause**: Invalid JSON format
**Solution**: Verify JSON file is valid (use a JSON validator). Ensure file was generated by Assignment Maker.

### Images Too Large

**Cause**: Uploaded images exceed recommended size
**Solution**: Compress images before uploading. Use JPG instead of PNG for photos.

## Development

### Code Style

- TypeScript with strict type checking
- Functional React components with hooks
- Tailwind CSS classes (embedded in JSX)
- ESLint/Prettier recommended (not enforced)

### Key Dependencies

- **react** and **react-dom**: UI framework
- **lucide-react**: Icon library
- **@vitejs/plugin-react**: Vite React plugin

### Adding Features

1. Create feature branch: `git checkout -b feature/new-feature`
2. Implement changes
3. Test locally: `npm run dev`
4. Build: `npm run build && npm run preview`
5. Commit and push
6. Create pull request

## Browser Compatibility

Tested and working on:

- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

**Not recommended**: Internet Explorer (not supported)

## Known Issues

1. **Page breaks in PDF**: Complex layouts may have imperfect page breaks (html2pdf limitation)
2. **Large images**: PDFs with many large images may take 10-20 seconds to generate
3. **Mobile devices**: Optimized for desktop/laptop use; mobile experience is functional but not ideal

## Roadmap

Potential future enhancements:

- [ ] Dark mode
- [ ] Offline PWA support
- [ ] Better mobile responsiveness
- [ ] In-browser PDF preview without library dependency
- [ ] Assignment validation (check for required fields)
- [ ] Multi-language support

## Contributing

Contributions welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes with clear commit messages
4. Ensure code compiles and runs
5. Submit a pull request

## License

MIT License - see LICENSE file for details

## Contact & Support

- **GitHub**: [AndreKnoesen/GradeBridge-Student-Submission](https://github.com/AndreKnoesen/GradeBridge-Student-Submission)
- **Issues**: [GitHub Issues](https://github.com/AndreKnoesen/GradeBridge-Student-Submission/issues)
- **Live App**: [https://andreknoesen.github.io/GradeBridge-Student-Submission/](https://andreknoesen.github.io/GradeBridge-Student-Submission/)

## Acknowledgments

- Built with React and TypeScript
- LaTeX rendering by [KaTeX](https://katex.org/)
- PDF generation by [html2pdf.js](https://github.com/eKoopmans/html2pdf.js)
- Icons by [Lucide](https://lucide.dev/)

---

**Version**: 3.0.0
**Last Updated**: November 2025
