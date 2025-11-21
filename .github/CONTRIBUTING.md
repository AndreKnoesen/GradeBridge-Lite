# Contributing to GradeBridge Student Submission

Thank you for your interest in contributing to GradeBridge Student Submission! This tool helps students complete and submit academic assignments with professional formatting. We welcome contributions from educators, students, and developers alike.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [How Can I Contribute?](#how-can-i-contribute)
- [Reporting Bugs](#reporting-bugs)
- [Suggesting Features](#suggesting-features)
- [Contributing Code](#contributing-code)
- [Style Guidelines](#style-guidelines)
- [Testing Guidelines](#testing-guidelines)
- [Documentation](#documentation)
- [Questions?](#questions)

## Code of Conduct

This project is maintained by BridgeSuite for the educational community. We are committed to providing a welcoming and inclusive environment for all contributors. Please be respectful, constructive, and professional in all interactions.

## How Can I Contribute?

### For Educators and Non-Developers

You don't need to be a professional developer to contribute! Here are ways you can help:

- **Report bugs** you encounter while using the app
- **Suggest features** that would help your students
- **Improve documentation** by clarifying instructions
- **Share use cases** and feedback from your classroom
- **Test new features** and provide feedback

### For Developers

- Fix bugs and improve code quality
- Implement new features
- Improve performance and accessibility
- Write tests and documentation
- Review pull requests

## Reporting Bugs

Before creating a bug report, please check the [existing issues](https://github.com/BridgeSuite/GradeBridge-Student-Submission/issues) to avoid duplicates.

### How to Submit a Bug Report

1. Use the [bug report template](https://github.com/BridgeSuite/GradeBridge-Student-Submission/issues/new?template=bug_report.md)
2. Provide a clear, descriptive title
3. Include detailed steps to reproduce the issue
4. Describe what you expected to happen vs. what actually happened
5. Include browser information and screenshots if possible
6. Mention if the issue affects student workflow or data integrity

**Important**: This is a client-side application. All bugs should be reproducible in a standard browser environment. Include your browser version and OS.

## Suggesting Features

We love hearing ideas for improving the student experience! Before suggesting a feature:

1. Check [existing feature requests](https://github.com/BridgeSuite/GradeBridge-Student-Submission/issues?q=is%3Aissue+is%3Aopen+label%3Aenhancement)
2. Consider whether it aligns with our goals:
   - **Client-side processing** (no server dependencies)
   - **Privacy-first** (data stays on student's device)
   - **Gradescope compatibility**
   - **Student-friendly** (simple, intuitive interface)
   - **Educator-approved** (supports academic integrity)

### How to Submit a Feature Request

1. Use the [feature request template](https://github.com/BridgeSuite/GradeBridge-Student-Submission/issues/new?template=feature_request.md)
2. Describe the problem or pain point
3. Propose a solution
4. Explain how it benefits students and educators
5. Consider any potential downsides or challenges

## Contributing Code

### Prerequisites

- Node.js (v18+)
- npm or yarn
- Git
- A modern code editor (VS Code recommended)
- Basic understanding of React and TypeScript

### Getting Started

1. **Fork the repository**
   ```bash
   # Click "Fork" on GitHub, then clone your fork:
   git clone https://github.com/YOUR_USERNAME/GradeBridge-Student-Submission.git
   cd GradeBridge-Student-Submission
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Create a branch**
   ```bash
   git checkout -b feature/your-feature-name
   # or
   git checkout -b fix/bug-description
   ```

4. **Make your changes**
   - Write clean, readable code
   - Follow existing code patterns
   - Add comments for complex logic
   - Update documentation if needed

5. **Test your changes**
   ```bash
   npm run dev      # Test in development mode
   npm run build    # Ensure it builds
   npm run preview  # Test the production build
   ```

6. **Commit your changes**
   ```bash
   git add .
   git commit -m "Brief description of changes"
   ```

   Use clear, concise commit messages:
   - `Add feature: LaTeX equation editor`
   - `Fix: PDF generation with large images`
   - `Update: README installation instructions`

7. **Push and create a Pull Request**
   ```bash
   git push origin feature/your-feature-name
   ```
   Then open a PR on GitHub using our [PR template](../.github/PULL_REQUEST_TEMPLATE.md)

### Development Workflow

- **Keep PRs focused**: One feature or fix per PR
- **Update from main regularly**: Rebase or merge to stay current
- **Test thoroughly**: Include test cases if possible
- **Document changes**: Update README or add inline comments
- **Be responsive**: Address review feedback promptly

## Style Guidelines

### TypeScript/React

- Use **TypeScript** with strict type checking
- Write **functional components** with hooks
- Follow **React best practices**:
  - Use descriptive component and variable names
  - Extract reusable logic into custom hooks
  - Keep components small and focused
  - Avoid prop drilling (use context when appropriate)

### Code Formatting

- Use **2 spaces** for indentation
- Use **single quotes** for strings
- Add **trailing commas** in multi-line arrays/objects
- Use **const** by default, **let** only when reassignment is needed
- Avoid **any** types - use proper TypeScript types

Example:
```typescript
// Good
const [studentName, setStudentName] = useState<string>('');

interface ProblemProps {
  problem: Problem;
  onSubmit: (data: SubmissionData) => void;
}

export const ProblemRenderer: React.FC<ProblemProps> = ({ problem, onSubmit }) => {
  // Component logic
};

// Avoid
var name = '';  // Use const/let
const handleSubmit = (data: any) => {};  // Use proper types
```

### File Organization

- **Components**: One component per file
- **Naming**: PascalCase for components, camelCase for utilities
- **Location**: Place files in appropriate directories (components/, services/, types/)

### Comments

- Write self-documenting code with clear names
- Add comments for:
  - Complex algorithms or business logic
  - Browser-specific workarounds
  - Educational context (why certain approaches are used)
  - Security or privacy considerations

```typescript
// Good: Explains why, not what
// Auto-save debounced to prevent excessive localStorage writes
// which can cause performance issues on older devices
useEffect(() => {
  const timeoutId = setTimeout(() => {
    saveToLocalStorage(data);
  }, 1000);
  return () => clearTimeout(timeoutId);
}, [data]);
```

## Testing Guidelines

### Manual Testing

Before submitting a PR, test:

1. **Core Workflows**
   - Load an assignment JSON
   - Enter student information
   - Complete different problem types (text, image, AI reflective)
   - Generate PDF
   - Export/import backup JSON

2. **Edge Cases**
   - Large images (5MB+)
   - Many problems (20+)
   - Long text answers with LaTeX
   - Browser refresh (auto-save recovery)

3. **Browser Compatibility**
   - Test on Chrome, Firefox, Safari, and Edge
   - Test on both desktop and tablet if possible

4. **Privacy/Security**
   - Verify no data is sent to external servers (check Network tab)
   - Test localStorage persistence
   - Ensure exported files contain expected data

### Automated Testing

While we don't currently have a comprehensive test suite, contributions of tests are welcome:

- Unit tests for utility functions
- Integration tests for key workflows
- Accessibility tests

## Documentation

### Code Documentation

- Add JSDoc comments to exported functions and components
- Document complex types and interfaces
- Include examples for non-obvious usage

```typescript
/**
 * Renders a problem with its statement and submission widget
 * @param problem - The problem configuration from assignment JSON
 * @param submissionData - Current student answers for this problem
 * @param onSubmit - Callback when student updates their answer
 */
export const ProblemRenderer: React.FC<ProblemProps> = ({ ... }) => {
  // ...
};
```

### User Documentation

If your change affects how students use the app:

- Update the README.md
- Add examples or screenshots
- Consider creating a brief guide in comments
- Mention it in your PR description

## Privacy and Educational Context

### Privacy Requirements

All contributions **must maintain**:

- **Client-side processing**: No data sent to servers
- **LocalStorage only**: No cookies, tracking, or analytics
- **Export control**: Students can backup and delete their data
- **No external dependencies** that compromise privacy

### Educational Considerations

Remember that this tool is used in academic settings:

- **Maintain academic integrity**: No features that facilitate cheating
- **Accessibility**: Consider students with disabilities
- **Reliability**: Students depend on this for graded work
- **Simplicity**: Students need to focus on content, not the tool
- **Cross-platform**: Works on school computers, personal devices, etc.

## Response Times

This is a community edition tool maintained by BridgeSuite as time permits. Please be patient:

- **Bug reports**: We aim to respond within 1 week
- **Feature requests**: May take longer to evaluate and implement
- **Pull requests**: We'll review as quickly as possible, usually within 2 weeks
- **Questions**: Check existing issues first; we'll respond when available

For urgent issues affecting student coursework, please clearly mark them as such.

## Recognition

Contributors will be:

- Listed in release notes
- Credited in the README (for significant contributions)
- Added to the GitHub contributors list

## Questions?

- **General questions**: Open a [GitHub Discussion](https://github.com/BridgeSuite/GradeBridge-Student-Submission/discussions)
- **Bug reports**: Use the [bug template](https://github.com/BridgeSuite/GradeBridge-Student-Submission/issues/new?template=bug_report.md)
- **Feature ideas**: Use the [feature template](https://github.com/BridgeSuite/GradeBridge-Student-Submission/issues/new?template=feature_request.md)

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

---

**Thank you for helping make GradeBridge better for students and educators!** 🎓
