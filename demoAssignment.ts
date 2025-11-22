import { Assignment, SubmissionType } from './types';

/**
 * Demo assignment showcasing all features of GradeBridge Student Submission.
 * This allows users to try the app without needing to upload a JSON file.
 *
 * Format matches Assignment Maker export format.
 */
export const DEMO_ASSIGNMENT: Assignment = {
  id: 'demo-assignment-001',
  courseCode: 'MATH 101',
  title: 'Sample Mathematics Assignment - Demo',
  dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // 14 days from now
  dueTime: '23:59',
  preamble: `Welcome to this demo assignment! This sample showcases the features of GradeBridge Student Submission.

You can:
- Enter text answers with LaTeX math formatting (use $...$ for inline math, $$...$$ for display math)
- Upload images of handwritten work or diagrams
- Document your AI tool usage in the AI Reflective sections
- Preview and download your submission as a PDF

Try filling out each question to see how the app works. Your work is automatically saved to your browser.`,
  problems: [
    {
      id: 'prob-1',
      name: 'Calculus - Derivatives and Integrals',
      description: `Demonstrate your understanding of fundamental calculus concepts. Use LaTeX notation for mathematical expressions.

LaTeX Example - try typing this in your answer box (include the dollar signs):
\\frac{d}{dx}[x^2] = 2x`,
      subsections: [
        {
          id: 'prob-1-a',
          name: 'Find the Derivative',
          description: `Find the derivative of the following function and show your work:

$$f(x) = 3x^4 - 2x^3 + 5x^2 - 7x + 1$$

Express your answer using proper mathematical notation.

Hint: Try typing (with dollar signs): f'(x) = 12x^3 - 6x^2 + 10x - 7`,
          points: 10,
          submissionType: SubmissionType.TEXT,
          maxImages: 0
        },
        {
          id: 'prob-1-b',
          name: 'Evaluate the Integral',
          description: `Evaluate the following definite integral:

$$\\int_0^2 (x^2 + 2x) \\, dx$$

Show all steps of your calculation.

Hint: Try typing (with dollar signs): \\int x^2 dx = \\frac{x^3}{3} + C`,
          points: 10,
          submissionType: SubmissionType.TEXT,
          maxImages: 0
        },
        {
          id: 'prob-1-c',
          name: 'Graph Sketch',
          description: `Sketch the graph of $f(x) = x^3 - 3x$ on paper, marking all critical points, inflection points, and intercepts. Then upload a photo of your work.

This question demonstrates the image upload feature.`,
          points: 5,
          submissionType: SubmissionType.IMAGE,
          maxImages: 2
        }
      ]
    },
    {
      id: 'prob-2',
      name: 'Physics - Kinematics',
      description: `A ball is thrown vertically upward from ground level with an initial velocity of $v_0 = 20$ m/s. Assume $g = 10$ m/s$^2$ and neglect air resistance.`,
      subsections: [
        {
          id: 'prob-2-a',
          name: 'Maximum Height',
          description: `Calculate the maximum height reached by the ball. Use the kinematic equations and show your derivation.

Try typing (with dollar signs): v^2 = v_0^2 - 2gh or h = v_0 t - \\frac{1}{2}gt^2`,
          points: 8,
          submissionType: SubmissionType.TEXT,
          maxImages: 0
        },
        {
          id: 'prob-2-b',
          name: 'Total Time in Air',
          description: `Determine the total time the ball is in the air before it returns to ground level.

Express your answer with proper units.`,
          points: 7,
          submissionType: SubmissionType.TEXT,
          maxImages: 0
        },
        {
          id: 'prob-2-c',
          name: 'Motion Graphs',
          description: `Draw a velocity-time graph and a position-time graph for the ball's motion. Upload your sketches.

This demonstrates uploading multiple images for a single question.`,
          points: 10,
          submissionType: SubmissionType.IMAGE,
          maxImages: 3
        }
      ]
    },
    {
      id: 'prob-3',
      name: 'Computer Science - Algorithm Analysis',
      description: `Analyze the following sorting algorithm:

def mystery_sort(arr):
    n = len(arr)
    for i in range(n):
        for j in range(0, n-i-1):
            if arr[j] > arr[j+1]:
                arr[j], arr[j+1] = arr[j+1], arr[j]
    return arr`,
      subsections: [
        {
          id: 'prob-3-a',
          name: 'Identify the Algorithm',
          description: `Identify the sorting algorithm implemented in the code above. Explain how it works step by step.`,
          points: 8,
          submissionType: SubmissionType.TEXT,
          maxImages: 0
        },
        {
          id: 'prob-3-b',
          name: 'Time Complexity Analysis',
          description: `Analyze the time complexity of this algorithm in Big-O notation. Consider:

- Best case
- Average case
- Worst case

Justify your answers. Try typing (with dollar signs): O(n^2) or O(n \\log n)`,
          points: 12,
          submissionType: SubmissionType.TEXT,
          maxImages: 0
        }
      ]
    },
    {
      id: 'prob-4',
      name: 'Mathematical Concepts - Essay',
      description: `This question assesses your conceptual understanding and ability to communicate mathematical ideas clearly.`,
      subsections: [
        {
          id: 'prob-4-a',
          name: 'Fundamental Theorem of Calculus',
          description: `In your own words, explain the relationship between derivatives and integrals (the Fundamental Theorem of Calculus). Why is this theorem considered one of the most important results in mathematics?

Your response should be 150-300 words and include at least one concrete example.

This demonstrates a longer text response.`,
          points: 15,
          submissionType: SubmissionType.TEXT,
          maxImages: 0
        }
      ]
    },
    {
      id: 'prob-5',
      name: 'AI-Assisted Problem Solving',
      description: `This section tests your ability to effectively use and document AI assistance in solving mathematical problems.`,
      subsections: [
        {
          id: 'prob-5-a',
          name: 'Differential Equation',
          description: `Solve the following differential equation using any method:

$$\\frac{dy}{dx} = 2xy$$

with initial condition $y(0) = 1$.

You may use AI tools (ChatGPT, Wolfram Alpha, etc.) to help you, but you MUST document your process in the AI Reflective section below.

This demonstrates the AI Reflective documentation feature.`,
          points: 10,
          submissionType: SubmissionType.AI_REFLECTIVE,
          maxImages: 0
        },
        {
          id: 'prob-5-b',
          name: 'Verify Your Solution',
          description: `Verify your solution by substituting it back into the original differential equation. Show this verification step clearly.

You can upload a handwritten solution.`,
          points: 5,
          submissionType: SubmissionType.IMAGE,
          maxImages: 2
        }
      ]
    }
  ],
  createdAt: Date.now(),
  updatedAt: Date.now()
};

/**
 * Message shown when demo assignment is loaded
 */
export const DEMO_LOADED_MESSAGE = 'Demo assignment loaded! Try all features - your work is automatically saved.';
