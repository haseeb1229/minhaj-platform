import type { Locale } from '@minhaj/contracts';
import type { ModuleOutline } from '@minhaj/contracts/learning';

/**
 * Presentation decisions for the Learning surfaces a person or an operator
 * reads — PURE and free of React (DELIVERY_PLAN.md Phase 22).
 *
 * Which label a page shows, how a plain-text lesson body becomes paragraphs,
 * and which lesson a learner's course page opens on. Each has ONE
 * implementation, so My Learning and the Learning administration read them the
 * same way.
 */

/**
 * The label in the interface locale, else in the record's primary locale, else
 * the first there is. A label is descriptive text in a language, never a
 * translation the platform made up, so a missing locale falls back rather than
 * rendering empty.
 */
export function pickLabel<L extends { readonly locale: Locale }>(
  labels: readonly L[],
  locale: Locale,
  primaryLocale: Locale,
): L | null {
  return (
    labels.find((label) => label.locale === locale) ??
    labels.find((label) => label.locale === primaryLocale) ??
    labels[0] ??
    null
  );
}

/**
 * A plain-text body as paragraphs: blank lines separate them, single line
 * breaks stay inside one. The text is rendered as TEXT NODES by the caller —
 * there is no markup in a lesson body to interpret.
 */
export function paragraphs(body: string): readonly string[] {
  return body
    .replace(/\r\n?/gu, '\n')
    .split(/\n[ \t]*\n/u)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph !== '');
}

/** Every lesson of a syllabus, in reading order. */
export function lessonsInOrder(outline: readonly ModuleOutline[]) {
  return outline.flatMap((part) => part.lessons);
}

/**
 * The lesson a learner's Course page opens: the one the address asks for when
 * it is genuinely in this syllabus; otherwise the first not yet completed;
 * otherwise the first. `null` only for a syllabus with no lessons. An unknown
 * or malformed `?lesson=` is never trusted — it simply selects nothing.
 */
export function selectedLesson(
  outline: readonly ModuleOutline[],
  completed: ReadonlySet<string>,
  requested: string | null,
): string | null {
  const lessons = lessonsInOrder(outline);
  if (requested !== null && lessons.some((lesson) => lesson.id === requested))
    return requested;
  return (
    lessons.find((lesson) => !completed.has(lesson.id))?.id ?? lessons[0]?.id ?? null
  );
}
