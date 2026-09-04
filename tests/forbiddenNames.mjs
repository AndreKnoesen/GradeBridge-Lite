// =====================================================
// Names that must never appear in this repository
// =====================================================
// Required by the name-guard work order of 2026-09-03, issued because this
// repository is going public.
//
// THE RULE
//
//   No personal name of any living individual may appear anywhere in this
//   repository: not in a file, not in a comment, not in a test source, not in
//   a .gitignore, and not in a path.
//
//   Not students, and not colleagues either. Nobody consents to having their
//   name published in a code repository by working on it, and being asked
//   afterwards by the person who runs the project is not a free choice.
//
//   The one exception is the repository owner's own git identity, which the
//   host attaches to every commit and which is his to publish. It is
//   deliberately absent from the list below.
//
// THIS LIST IS WHAT IS FORBIDDEN, NOT WHAT IS PERMITTED.
//
//   Adding a name here is NOT how you permit a name. There is no allow list and
//   there is no exception mechanism. If the guard fires, the fix is to remove
//   the name from the file, never to remove it from this list. The next person
//   to hit this will be tempted, which is why it is written down.
//
// WHY HASHES AND NOT NAMES
//
//   The rule above forbids a personal name in a test source. A plaintext list
//   would put every name on it into a public repository, under a heading
//   announcing that these are people associated with the project, and would
//   leave this repository worse than it is today: it currently contains none.
//   So the list stores a hash of each name and the scanner hashes what it finds.
//
//   This is obfuscation, not secrecy, and it is worth being plain about that: a
//   short common given name would not survive someone determined with a
//   dictionary. It is sized for the threat that actually exists, which is an
//   accidental commit plus casual reading and search indexing of a public repo.
//   Against that it works, and the alternative publishes the names outright.
//
//   For the same reason there are no comments beside the hashes. A note saying
//   which pseudonym, role, device or institution a hash belongs to would turn
//   this file into the lookup table it exists to avoid.
//
// HOW TO ADD A NAME
//
//   node -e "import('./tests/forbiddenNames.mjs').then(m => console.log(m.hashName('<the name>')))"
//
//   Add the printed hash below, with no comment saying whose it is. Add each
//   form separately: the guard matches whole tokens, so "sam" does not cover
//   "samuel" and a surname does not cover a given name.
//
// WHAT THIS LIST CANNOT DO, AND WHAT ACTUALLY WORKS
//
//   It matches whole tokens against hashes of names somebody has already
//   written down here. **It cannot detect an arbitrary abbreviation of a name
//   it has never seen.** A capture set keyed on the first three letters of a
//   colleague's given name passed this guard for as long as it existed, in
//   thirteen data rows, in two shipped source comments and in a contract
//   document, because the shortened form is not the name and nothing hashed to
//   it. Adding that fragment on 2026-09-03 is what refuses it from now on, and
//   that is all adding a fragment ever does: it closes one hole after somebody
//   noticed it. Do not read the list as a detector.
//
//   The same day, two more of exactly that shape were found on a second capture
//   set — and they were found by reading the `.gitignore` that documented them,
//   not by any scan. Three fragments have now been added after the fact and
//   none of the three was caught. That is the measurement; read the list
//   accordingly.
//
//   The control that works is upstream of this file: **a capture set, a
//   fixture, a folder or a test identifier must not be named after a person in
//   the first place.** Name it for what it is — the device class, the defect,
//   the page. Then there is no fragment to abbreviate and nothing for this list
//   to have missed.
//
// The same list, produced the same way, is used by the Assignment Maker
// repository. Keep the two in step.

import { createHash } from 'node:crypto';

/**
 * Normalise then hash. Lowercased, accents folded, and everything that is not a
 * letter dropped, so `Jean-Luc`, `jean luc` and `JeanLuc` all hash alike.
 * Truncated to 16 hex characters: 64 bits is far past collision range for a
 * list this size, and a short string keeps the list readable as a list.
 *
 * `normaliseName` is exported separately because **the length of the normalised
 * form is the only length that means anything here.** A scanner that measures a
 * token before normalising is measuring characters this function is about to
 * throw away: a four-letter run whose first character folds to nothing hashes
 * as three, so a floor applied to the raw run does not hold. See the run-length
 * note in `tests/no-personal-names.mjs`.
 */
export const normaliseName = (name) => String(name)
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .toLowerCase()
  .replace(/[^a-z]/g, '');

export const hashName = (name) => {
  const normalised = normaliseName(name);
  if (!normalised) return '';
  return createHash('sha256').update(normalised).digest('hex').slice(0, 16);
};

/** One entry per forbidden name. No comments, no ordering that carries meaning. */
export const FORBIDDEN_NAME_HASHES = new Set([
  '2f8a0c01f668bca7',
  '5ca1b7b104433c8e',
  '780a23528c754a50',
  'ba0850ca04c64d0c',
  '386a85d8c88778b0',
  '710c3906ca8b54f8',
  'd9a31550033ee07d',
  'fc053e14afa732e2',
  'fc52fabe94c0e037',
  'fdc97875a4c7d086',
]);
