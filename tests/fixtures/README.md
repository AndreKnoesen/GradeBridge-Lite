# tests/fixtures

## `layout_ENG17HOM496F.csv`

The real ENG17 Homework 1 layout map, byte for byte, as it was exported and as
it sits in `CaptureSet/frozen_export/student/`. 1175 bytes, LF endings, one
trailing newline. 17 regions across 16 pages, `layout_id` **95438EDF**.

It is here rather than pointed at by an environment variable because the test
it exists for — that the same CSV text hashes to the same `layout_id` whether it
arrives as a file beside the spec or as text inside it — is the one test in this
repository that must never SKIP. `95438EDF` is printed into the QR code on every
sheet of paper this project has produced, including the whole capture set. Every
other mistake here is a redeploy; that one is a reprint.

Nothing in it is confidential. It is geometry: rectangles, page numbers, part
labels and point values, with no question text, no answer and no person's name.
It is a file that was handed to students, and the same identifiers already
appear in `tests/milestone-zero.mjs`, `tests/full-assignment.mjs` and
`tests/gate-tests.mjs`.

**Do not reformat it.** Line endings, spacing and the trailing newline are part
of what it proves: the embedded copy is the file's exact text, and a fixture
normalised by an editor would quietly stop testing that.
