# GradeBridge Student Submission

Complete academic assignments with LaTeX support and generate professional PDFs for Gradescope - entirely in your browser.

![Version](https://img.shields.io/badge/version-3.0.0-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)

**[Live Demo](https://bridgesuite.github.io/GradeBridge-Student-Submission/)** 

---

## The Problem

**Traditional submissions:** Inconsistent formatting, broken equations, messy PDFs that are a nightmare to grade.

**GradeBridge workflow:** Guided, structured submission forms that auto-generate perfectly formatted PDFs.

**The two-app workflow:**
1. **[Assignment Maker](https://github.com/BridgeSuite/GradeBridge-Assignment-Maker)** - Instructors create structured assignments
2. **Student Submission** (this app) - Students complete work and generate grading-ready PDFs

**Result:** No more "my formatting broke" excuses. Consistent submissions that make grading 50% faster.

---

## Key Features

- **100% Browser-Based** - No server, no account, no data transmission. Everything stays on your computer.
- **Auto-Save** - Work saved every second to browser storage
- **LaTeX Math Support** - Live preview with built-in cheatsheet (fractions, integrals, Greek letters, matrices)
- **Multiple Answer Types** - Text with LaTeX, image uploads, AI reflective documentation
- **Professional PDF Generation** - Gradescope-compatible output matching instructor templates
- **Try Demo** - One-click sample assignment to explore features instantly
- **Backup & Restore** - Export/import work as JSON

---

## Quick Start

### Try It Now
1. Go to the [Live Demo](https://bridgesuite.github.io/GradeBridge-Student-Submission/)
2. Click **"Try Demo Assignment"** in the sidebar
3. Click **"LaTeX Math Help"** for math notation reference

### Complete an Assignment
1. Get assignment JSON from instructor
2. Click **"Upload JSON"** in sidebar
3. Enter your full name
4. Complete each problem (text/images/AI-graded response)
5. Click **"Download for Gradescope"** — downloads both the submission JSON and PDF
6. Upload both files to Gradescope

### Local Development
```bash
git clone https://github.com/BridgeSuite/GradeBridge-Student-Submission.git
cd GradeBridge-Student-Submission
npm install
npm run dev
```

---

## Assignment JSON Format

Assignments are created using the **[Assignment Maker](https://github.com/BridgeSuite/GradeBridge-Assignment-Maker)**:

```json
{
  "courseCode": "ECE416",
  "title": "Mini-Project 1",
  "preamble": "Instructions for the entire assignment...",
  "problems": [
    {
      "name": "System Analysis",
      "description": "Analyze the following system...",
      "subsections": [
        {
          "name": "Transfer Function",
          "description": "Derive the transfer function",
          "points": 50,
          "submissionType": "Text"
        },
        {
          "name": "Step Response",
          "description": "Plot the step response",
          "points": 30,
          "submissionType": "Image",
          "maxImages": 2
        },
        {
          "name": "Reflection",
          "description": "Explain your approach",
          "points": 20,
          "submissionType": "AI Graded: Short",
          "aiGradingConfig": { "gradingPrompt": "..." }
        }
      ]
    }
  ]
}
```

**Submission Types:** `Text`, `Image`, `AI Graded: Binary`, `AI Graded: Short`, `AI Graded: Medium`, `AI Graded: Long`

---

## Data & Privacy

- All data stored in browser localStorage
- No server communication, no analytics, no account required
- Data persists across browser restarts
- **Always export JSON backups** - data is lost if you clear browser cache

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Assignment won't load | Verify JSON was exported from Assignment Maker (encrypted `.json` file) |
| LaTeX not rendering | Refresh page; KaTeX loads from CDN |
| PDF generation fails | Check internet connection; html2pdf loads from CDN |
| Lost work | Use "Save Backup" regularly; restore with "Load Work" |
| Images too large | Files over 4 MB are rejected; compress or use JPG instead of PNG |
| Word count displayed | Shows current word count as guidance — no minimum or maximum is enforced |

---

## Gradescope Integration

PDFs are designed to match Assignment Maker templates:
- One page per subsection
- Consistent headers on all pages
- Image answers get dedicated pages

See [GRADESCOPE_COORDINATION.md](./GRADESCOPE_COORDINATION.md) for technical details.

---

## Development

### Tech Stack
React 19 + TypeScript + Vite + Tailwind CSS + KaTeX (CDN) + html2pdf.js (CDN)

### Build & Deploy
```bash
npm run build      # Production build
npm run deploy     # Deploy to GitHub Pages
```

---

## Known Limitations

- **CDN Dependencies** - KaTeX and html2pdf.js load from CDN; internet required for LaTeX rendering and PDF generation
- **Long Text Answers** - Very long answers that exceed one page may have imperfect breaks (html2pdf limitation)
- **Mobile Experience** - Optimized for desktop; functional but not ideal on phones

## Browser Support

Chrome 90+, Firefox 88+, Safari 14+, Edge 90+

---

## Contributing

1. Fork the repository
2. Create feature branch
3. Make changes with clear commits
4. Submit pull request

---

## License

MIT License - Free for personal and commercial use.

---

## Links

- **Live App**: [bridgesuite.github.io/GradeBridge-Student-Submission](https://bridgesuite.github.io/GradeBridge-Student-Submission/)
- **Assignment Maker**: [bridgesuite.github.io/GradeBridge-Assignment-Maker](https://bridgesuite.github.io/GradeBridge-Assignment-Maker/)
- **Issues**: [GitHub Issues](https://github.com/BridgeSuite/GradeBridge-Student-Submission/issues)

---

Built with React, TypeScript, [KaTeX](https://katex.org/), [html2pdf.js](https://github.com/eKoopmans/html2pdf.js), and [Lucide](https://lucide.dev/).

Provided free by **[BridgeSuite](https://github.com/BridgeSuite)**.
