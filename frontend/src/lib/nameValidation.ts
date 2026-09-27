/**
 * Name rules for sign-up: letters and spaces only.
 *
 * Mirrors backend/services/validation.py, which is the check that actually
 * enforces this -- the code here just gives instant feedback. Keep the two in
 * step if the rule ever changes.
 *
 * "Letters" means letters of any alphabet (\p{L}) plus the combining marks
 * (\p{M}) that scripts such as Devanagari and Gurmukhi use to write a single
 * letter. Digits, underscores, hyphens, apostrophes, punctuation, symbols and
 * emoji are all rejected.
 */

export const NAME_RULE_MESSAGE = "Name can only contain letters and spaces.";

/** Anything that is not a letter, a combining mark, or a plain space. */
const DISALLOWED_NAME_CHARS = /[^\p{L}\p{M} ]/gu;

/** One or more words of letters, separated by single spaces. */
const NAME_PATTERN = /^\p{L}[\p{L}\p{M}]*(?: \p{L}[\p{L}\p{M}]*)*$/u;

/** True when `raw` contains anything other than letters, marks and spaces. */
export function hasDisallowedNameChars(raw: string): boolean {
  return /[^\p{L}\p{M} ]/u.test(raw.normalize("NFC"));
}

/**
 * Strips disallowed characters from what the user typed or pasted, so a digit
 * or symbol never appears in the field at all. Also collapses runs of spaces
 * and drops a leading space, but keeps one trailing space so the user can
 * still type a second word.
 */
export function sanitizeNameInput(raw: string): string {
  return raw
    .normalize("NFC")
    .replace(DISALLOWED_NAME_CHARS, "")
    .replace(/ {2,}/g, " ")
    .replace(/^ /, "");
}

/** Returns an error message, or null when the name is acceptable. */
export function validateName(name: string): string | null {
  // Collapse runs of spaces the same way the backend does, so both sides
  // accept and reject exactly the same input.
  const trimmed = name
    .normalize("NFC")
    .replace(/^ +| +$/g, "")
    .replace(/ {2,}/g, " ");
  if (!trimmed) return "Enter your full name.";
  if (!NAME_PATTERN.test(trimmed)) return NAME_RULE_MESSAGE;
  return null;
}
