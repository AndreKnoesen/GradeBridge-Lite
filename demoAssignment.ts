import { Assignment } from './types';

/**
 * Demo assignment showcasing all features of GradeBridge Student Submission.
 * This allows users to try the app without needing to upload a JSON file.
 *
 * Note: The app renders LaTeX but NOT markdown, so use plain text formatting.
 */
export const DEMO_ASSIGNMENT: Assignment = {
  assignment_title: 'Sample Mathematics Assignment - Demo',
  course_code: 'MATH 101',
  course_name: 'Calculus I (Demo)',
  preamble: `Welcome to this demo assignment! This sample showcases the features of GradeBridge Student Submission.

You can:
- Enter text answers with LaTeX math formatting (use $...$ for inline math, $$...$$ for display math)
- Upload images of handwritten work or diagrams
- Document your AI tool usage in the AI Reflective sections
- Preview and download your submission as a PDF

Try filling out each question to see how the app works. Your work is automatically saved to your browser.`,
  total_points: 100,
  problems: [
    {
      problem_statement: `PROBLEM 1: Calculus - Derivatives and Integrals

Demonstrate your understanding of fundamental calculus concepts. Use LaTeX notation for mathematical expressions.

LaTeX Example - try typing this in your answer box (include the dollar signs):
\\frac{d}{dx}[x^2] = 2x`,
      points: 25,
      subsections: [
        {
          subsection_statement: `Find the derivative of the following function and show your work:

$$f(x) = 3x^4 - 2x^3 + 5x^2 - 7x + 1$$

Express your answer using proper mathematical notation.

Hint: Try typing (with dollar signs): f'(x) = 12x^3 - 6x^2 + 10x - 7`,
          points: 10,
          submission_elements: ['Answer as text'],
          max_images_allowed: 0
        },
        {
          subsection_statement: `Evaluate the following definite integral:

$$\\int_0^2 (x^2 + 2x) \\, dx$$

Show all steps of your calculation.

Hint: Try typing (with dollar signs): \\int x^2 dx = \\frac{x^3}{3} + C`,
          points: 10,
          submission_elements: ['Answer as text'],
          max_images_allowed: 0
        },
        {
          subsection_statement: `Sketch the graph of $f(x) = x^3 - 3x$ on paper, marking all critical points, inflection points, and intercepts. Then upload a photo of your work.

This question demonstrates the image upload feature.`,
          points: 5,
          submission_elements: ['Answer as image'],
          max_images_allowed: 2
        }
      ]
    },
    {
      problem_statement: `PROBLEM 2: Physics - Kinematics

A ball is thrown vertically upward from ground level with an initial velocity of $v_0 = 20$ m/s. Assume $g = 10$ m/s$^2$ and neglect air resistance.`,
      points: 25,
      subsections: [
        {
          subsection_statement: `Calculate the maximum height reached by the ball. Use the kinematic equations and show your derivation.

Try typing (with dollar signs): v^2 = v_0^2 - 2gh or h = v_0 t - \\frac{1}{2}gt^2`,
          points: 8,
          submission_elements: ['Answer as text'],
          max_images_allowed: 0
        },
        {
          subsection_statement: `Determine the total time the ball is in the air before it returns to ground level.

Express your answer with proper units.`,
          points: 7,
          submission_elements: ['Answer as text'],
          max_images_allowed: 0
        },
        {
          subsection_statement: `Draw a velocity-time graph and a position-time graph for the ball's motion. Upload your sketches.

This demonstrates uploading multiple images for a single question.`,
          points: 10,
          submission_elements: ['Answer as image'],
          max_images_allowed: 3
        }
      ]
    },
    {
      problem_statement: `PROBLEM 3: Computer Science - Algorithm Analysis

Analyze the following sorting algorithm:

def mystery_sort(arr):
    n = len(arr)
    for i in range(n):
        for j in range(0, n-i-1):
            if arr[j] > arr[j+1]:
                arr[j], arr[j+1] = arr[j+1], arr[j]
    return arr`,
      points: 20,
      subsections: [
        {
          subsection_statement: `Identify the sorting algorithm implemented in the code above. Explain how it works step by step.`,
          points: 8,
          submission_elements: ['Answer as text'],
          max_images_allowed: 0
        },
        {
          subsection_statement: `Analyze the time complexity of this algorithm in Big-O notation. Consider:

- Best case
- Average case
- Worst case

Justify your answers. Try typing (with dollar signs): O(n^2) or O(n \\log n)`,
          points: 12,
          submission_elements: ['Answer as text'],
          max_images_allowed: 0
        }
      ]
    },
    {
      problem_statement: `PROBLEM 4: Mathematical Concepts - Essay Question

This question assesses your conceptual understanding and ability to communicate mathematical ideas clearly.`,
      points: 15,
      subsections: [
        {
          subsection_statement: `In your own words, explain the relationship between derivatives and integrals (the Fundamental Theorem of Calculus). Why is this theorem considered one of the most important results in mathematics?

Your response should be 150-300 words and include at least one concrete example.

This demonstrates a longer text response.`,
          points: 15,
          submission_elements: ['Answer as text'],
          max_images_allowed: 0
        }
      ]
    },
    {
      problem_statement: `PROBLEM 5: AI-Assisted Problem Solving

This section tests your ability to effectively use and document AI assistance in solving mathematical problems.`,
      points: 15,
      subsections: [
        {
          subsection_statement: `Solve the following differential equation using any method:

$$\\frac{dy}{dx} = 2xy$$

with initial condition $y(0) = 1$.

You may use AI tools (ChatGPT, Wolfram Alpha, etc.) to help you, but you MUST document your process in the AI Reflective section below.

This demonstrates the AI Reflective documentation feature.`,
          points: 10,
          submission_elements: ['Answer as text', 'AI Reflective'],
          max_images_allowed: 0
        },
        {
          subsection_statement: `Verify your solution by substituting it back into the original differential equation. Show this verification step clearly.

You can type your verification OR upload a handwritten solution - this question accepts both!`,
          points: 5,
          submission_elements: ['Answer as text', 'Answer as image'],
          max_images_allowed: 2
        }
      ]
    }
  ]
};

/**
 * Message shown when demo assignment is loaded
 */
export const DEMO_LOADED_MESSAGE = 'Demo assignment loaded! Try all features - your work is automatically saved.';
