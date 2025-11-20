# Gradescope Coordination: Assignment Maker ↔ Submission App

## Critical Issue: PDF Layout Must Match for Gradescope Grading

For Gradescope to work, the **Template PDF** (instructor) and **Submission PDF** (student) must have:
1. Same page structure
2. Same headers/footers
3. Same page breaks
4. Same problem/subsection ordering

---

## Current Status Analysis

### 📄 Assignment Maker (Template PDF Generation)
**File:** `gradebridge-lite-assignment-maker/services/exportService.ts`

**Layout Rules:**
- ✅ One page per subsection (strict)
- ✅ Student Name/ID header on EVERY page at Y=15
- ✅ Image subsections: Multiple pages based on `maxImages`
- ✅ Format: "(a) [5 pts] Subsection Name"
- ✅ Grading box on each page for instructor

### 📄 Submission App (Student PDF Generation)
**File:** `GradeBridge-Lite/Gemini 3 Stage 2/components/PrintView.tsx`

**Layout Rules:**
- ⚠️ First image shares page with text/other content
- ⚠️ Extra images get own pages
- ✅ Student Name/ID header on problem pages
- ✅ Format: "Problem 1 - Part (a)" with points

---

## 🔴 CRITICAL MISMATCHES IDENTIFIED

### 1. **Page Break Strategy Mismatch**

| Aspect | Assignment Maker | Submission App | Status |
|--------|-----------------|----------------|--------|
| **Subsection pages** | One page per subsection | Multiple subsections per page | ❌ MISMATCH |
| **First image** | Dedicated page | Shares page with text | ❌ MISMATCH |
| **Extra images** | One page each | One page each | ✅ MATCH |

**Impact:** Gradescope region mapping will fail because page counts don't match!

### 2. **Header Format Mismatch**

| Aspect | Assignment Maker | Submission App | Status |
|--------|-----------------|----------------|--------|
| **Header text** | "Student Name: ___ Student ID: ___" | "ID: {id} \| Student Name: {name}" | ❌ MISMATCH |
| **Y-position** | Y=15 | Inside page header div | ⚠️ UNCERTAIN |
| **On every page** | Yes | Only on problem pages | ❌ MISMATCH |

### 3. **Problem/Subsection Numbering**

| Aspect | Assignment Maker | Submission App | Status |
|--------|-----------------|----------------|--------|
| **Problem format** | "Problem {n}: {name}" | "Problem {n}" | ⚠️ MINOR |
| **Subsection format** | "(a) [5 pts] {name}" | "Part (a)" | ❌ MISMATCH |
| **Points display** | Inline with label | Separate line | ⚠️ MINOR |

---

## 🎯 Required Fixes for Coordination

### Priority 1: Page Break Strategy (CRITICAL)

**Problem:** Assignment Maker creates one page per subsection, but Submission App puts multiple subsections on one page.

**Solution:** Submission App must create **one page per subsection** to match template.

**Code Changes Needed:**
```tsx
// PrintView.tsx - EACH subsection needs own Page wrapper
{problem.subsections!.map((sub, sIdx) => {
   return (
     <Page ...>  // ✅ New page for EACH subsection
       <SubsectionContent />
     </Page>
   );
})}
```

### Priority 2: Student Name/ID Header (CRITICAL)

**Problem:** Header format and placement don't match.

**Assignment Maker Header:**
```
Student Name: ______________________________   Student ID: __________________
```

**Submission App Header:**
```
ID: ABC123 | Student Name: John Doe
```

**Solution:** Submission App must match Assignment Maker format EXACTLY.

**Code Changes Needed:**
```tsx
// PrintView.tsx - Header component needs to output:
<div style={{ position: 'absolute', top: '15mm', left: '20mm', fontSize: '10pt' }}>
  Student Name: {studentName}   Student ID: {studentId}
</div>
```

### Priority 3: Image Page Allocation (CRITICAL)

**Problem:** First image shares page with other content in Submission App, but gets dedicated page in Assignment Maker.

**Solution:** 
- If a subsection has `submission_elements: ["Answer as image"]`, ALL images must get dedicated pages
- Remove image rendering from `RenderMainAnswer` 
- Create separate pages for EACH image

**Code Changes Needed:**
```tsx
// For image-only subsections:
const imageCount = data.imageAnswers?.length || 0;
for (let i = 0; i < imageCount; i++) {
  <Page title={...} subtitle={`Image ${i+1} of {imageCount}`}>
    <img src={data.imageAnswers[i]} className="max-h-[220mm]" />
  </Page>
}
```

---

## 📋 JSON Contract Requirements

The Assignment Maker JSON must explicitly define page structure expectations:

### Required Fields (Already Present):
- ✅ `max_images_allowed` - Controls page count for image subsections
- ✅ `submission_elements` - Defines answer type(s)
- ✅ `points` - Point value for each subsection
- ✅ `subsection_statement` - Text to display

### Recommended Additions:
- ⚠️ `page_break_before` - Force page break before subsection
- ⚠️ `grading_region_id` - Explicit Gradescope region identifier
- ⚠️ `expected_page_count` - Validation check

---

## 🧪 Test Case: Mini-Project 2 Example

From `TEST_ASSIGNMENT.json`:

**Problem 2, Subsection (a):**
```json
{
  "subsection_statement": "Include below, the annotated plot...",
  "points": 4,
  "submission_elements": ["Answer as image"],
  "max_images_allowed": 2
}
```

**Assignment Maker Output:**
- Page 1: Problem statement
- Page 2: Subsection (a) - Image 1 placeholder
- Page 3: Subsection (a) - Image 2 placeholder

**Submission App Output (CURRENT - WRONG):**
- Page 1: Problem statement + Subsection (a) + Image 1 (small)
- Page 2: Image 2

**Submission App Output (REQUIRED - CORRECT):**
- Page 1: Problem statement
- Page 2: Subsection (a) label + Image 1 (large)
- Page 3: Subsection (a) label + Image 2 (large)

---

## 🔧 Implementation Plan

### Phase 1: Fix Page Break Strategy
1. Modify PrintView.tsx to create one page per subsection
2. Separate image rendering from text rendering
3. Ensure each image gets dedicated page when appropriate

### Phase 2: Fix Header Format
1. Match Assignment Maker header text exactly
2. Position at Y=15mm on every page
3. Use same font/size (Times, 10pt)

### Phase 3: Fix Subsection Labeling
1. Match format: "(a) [4 pts] Subsection Name"
2. Ensure consistent numbering (a, b, c...)
3. Align points display with template

### Phase 4: Validation
1. Generate template PDF from Assignment Maker
2. Generate submission PDF from Submission App
3. Compare page counts (must match!)
4. Compare headers (must match!)
5. Upload to Gradescope and verify regions align

---

## ✅ Success Criteria

The coordination is successful when:
1. ✅ Page count matches exactly (template = submission)
2. ✅ Headers match on every page
3. ✅ Subsections start on same page numbers
4. ✅ Image placeholders align with actual images
5. ✅ Gradescope auto-detects regions correctly

---

## 📝 Next Steps

1. **Implement fixes in Submission App PrintView.tsx**
2. **Test with TEST_ASSIGNMENT.json**
3. **Generate both PDFs and compare visually**
4. **Upload test submission to Gradescope**
5. **Verify grading regions align perfectly**

---

## 🚨 Breaking Changes Alert

When implementing these fixes:
- Student PDFs will have MORE pages (one per subsection)
- File sizes will increase slightly
- Existing student submissions won't match old templates
- Need to regenerate templates for all assignments

