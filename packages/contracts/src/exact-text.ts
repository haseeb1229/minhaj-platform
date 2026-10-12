import { z } from 'zod';

/**
 * Exact text — the Layer-0 schemas every religious-text context shares.
 *
 * Quran and Hadith both store sourced text that must never be normalised, and
 * neither may depend on the other (DOMAIN_MODEL.md §3.1), so the one definition
 * of "exactly as supplied" lives here rather than in either. Nothing below
 * trims, folds, re-composes or substitutes a character of religious text: where
 * surrounding whitespace, a control character or an unpaired surrogate would be
 * wrong it is REFUSED, because a repaired text is a different text.
 */

/**
 * A C0 control character other than tab, line feed and carriage return, or
 * DEL. Tested by code unit rather than by a pattern of control characters.
 */
const FORBIDDEN_CONTROL = {
  test(value: string): boolean {
    for (let index = 0; index < value.length; index += 1) {
      const unit = value.charCodeAt(index);
      if (
        (unit < 0x20 && unit !== 0x09 && unit !== 0x0a && unit !== 0x0d) ||
        unit === 0x7f
      )
        return true;
    }
    return false;
  },
};

/** An unpaired UTF-16 surrogate: a string that is not valid Unicode text. */
const LONE_SURROGATE =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/** Is this string well-formed Unicode — no unpaired surrogate anywhere? */
export function isWellFormedText(value: string): boolean {
  return !LONE_SURROGATE.test(value);
}

/** Does this string hold any C0 control character or DEL — line breaks and tabs included? */
export function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit < 0x20 || unit === 0x7f) return true;
  }
  return false;
}

/**
 * Religious text as supplied: non-empty, bounded, well-formed UTF-16, no
 * control characters beyond line breaks and tabs, and no surrounding
 * whitespace. A violation is REFUSED rather than repaired.
 */
export function exactText(max: number) {
  return z
    .string()
    .min(1)
    .max(max)
    .refine(isWellFormedText, 'Text must be well-formed Unicode.')
    .refine((value) => !FORBIDDEN_CONTROL.test(value), 'Text holds a control character.')
    .refine(
      (value) => value === value.trim(),
      'Text may not begin or end with whitespace.',
    );
}

/** Operator-entered descriptive text (names, attribution) — trimmed like any label. */
export function labelText(max: number) {
  return z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((value) => !FORBIDDEN_CONTROL.test(value), 'Text holds a control character.');
}
