import { localeSchema } from '@minhaj/contracts';
import { LEARNING_LIMITS } from '@minhaj/contracts/learning';

/**
 * How the Learning administration's forms become the raw values its service
 * parses — PURE, so every rule here is proved without a request.
 *
 * NO MASS ASSIGNMENT. Each reader names the fields it takes and nothing else,
 * so a field the page never rendered — an account, a state smuggled into a
 * save, a learner's progress — is never read. Nothing here VALIDATES: the
 * service parses every value with the contract's strict schemas, so a reader
 * only shapes what the form sent, never repairs or guesses it.
 *
 * FIXED CEILINGS. Topics and teachers are offered as a fixed number of rows,
 * the domain's own bounds, never a count the browser supplies.
 */

/** The one method these readers need, so a test can hand in a plain FormData. */
export interface FormValues {
  get(name: string): FormDataEntryValue | null;
}

export const LEARNING_FORM_ROWS = Object.freeze({
  topics: LEARNING_LIMITS.topics,
  teachers: LEARNING_LIMITS.teachers,
});

/** One form value, trimmed, or `null` when absent or empty. */
export function formValue(form: FormValues, field: string): string | null {
  const raw = form.get(field);
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed;
}

/** A whole number as typed, `null` when absent; anything else is `NaN`, a refusal. */
export function formInteger(form: FormValues, field: string): number | null {
  const raw = formValue(form, field);
  if (raw === null) return null;
  return /^[0-9]{1,10}$/u.test(raw) ? Number(raw) : Number.NaN;
}

/**
 * A text area's text, transport-decoded and otherwise exactly as typed: the
 * form encoding's CRLF becomes the LF the text area held. An absent field is
 * empty text. The contract trims.
 */
function multiline(form: FormValues, field: string): string {
  const raw = form.get(field);
  return typeof raw === 'string' ? raw.replace(/\r\n/gu, '\n') : '';
}

/** A single-line field as sent; an absent one is `null`, which the contract refuses. */
function line(form: FormValues, field: string): string | null {
  const raw = form.get(field);
  return typeof raw === 'string' ? raw : null;
}

/** The repeated rows an operator filled, in order; an empty row is no entry. */
function rows(form: FormValues, prefix: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) =>
    formValue(form, `${prefix}-${String(index)}`),
  ).filter((entry): entry is string => entry !== null);
}

/** The interface locales an operator enabled — an unchecked one is absent, not empty. */
function enabled(form: FormValues) {
  return localeSchema.options.filter((locale) => form.get(`${locale}-enabled`) === 'on');
}

/** A Course's or a path's words per enabled locale: title, summary, description. */
export function catalogueLabels(form: FormValues) {
  return enabled(form).map((locale) => ({
    locale,
    title: line(form, `${locale}-title`),
    summary: multiline(form, `${locale}-summary`),
    description: multiline(form, `${locale}-description`),
  }));
}

/** A module's words per enabled locale: title and summary. */
export function outlineLabels(form: FormValues) {
  return enabled(form).map((locale) => ({
    locale,
    title: line(form, `${locale}-title`),
    summary: multiline(form, `${locale}-summary`),
  }));
}

/** A lesson's words per enabled locale: title, summary and its plain-text body. */
export function lessonLabels(form: FormValues) {
  return enabled(form).map((locale) => ({
    locale,
    title: line(form, `${locale}-title`),
    summary: multiline(form, `${locale}-summary`),
    body: multiline(form, `${locale}-body`),
  }));
}

/** A Course's catalogue facts. Its lifecycle is never here — that is a transition. */
export function courseFields(form: FormValues) {
  return {
    slug: line(form, 'slug'),
    primaryLocale: line(form, 'primaryLocale'),
    level: formValue(form, 'level'),
    format: line(form, 'format'),
    languageCode: line(form, 'languageCode'),
    labels: catalogueLabels(form),
    topicIds: rows(form, 'topic', LEARNING_FORM_ROWS.topics),
    teacherIds: rows(form, 'teacher', LEARNING_FORM_ROWS.teachers),
  };
}

/** A LearningPath's own words. Its Courses change one named change at a time. */
export function pathFields(form: FormValues) {
  return {
    slug: line(form, 'slug'),
    primaryLocale: line(form, 'primaryLocale'),
    labels: catalogueLabels(form),
  };
}

const direction = (form: FormValues) => line(form, 'direction');

/** One named module change, or `null` for an operation no form offers. */
export function moduleChange(form: FormValues): object | null {
  const moduleId = line(form, 'moduleId');
  switch (form.get('op')) {
    case 'add':
      return { op: 'add', labels: outlineLabels(form) };
    case 'edit':
      return { op: 'edit', moduleId, labels: outlineLabels(form) };
    case 'remove':
      return { op: 'remove', moduleId };
    case 'move':
      return { op: 'move', moduleId, direction: direction(form) };
    default:
      return null;
  }
}

/** One named lesson change, or `null`. A lesson never changes module. */
export function lessonChange(form: FormValues): object | null {
  const lessonId = line(form, 'lessonId');
  switch (form.get('op')) {
    case 'add':
      return { op: 'add', moduleId: line(form, 'moduleId'), labels: lessonLabels(form) };
    case 'edit':
      return { op: 'edit', lessonId, labels: lessonLabels(form) };
    case 'remove':
      return { op: 'remove', lessonId };
    case 'move':
      return { op: 'move', lessonId, direction: direction(form) };
    default:
      return null;
  }
}

/** One named change to a path's ordered Courses, or `null`. */
export function pathChange(form: FormValues): object | null {
  const courseId = line(form, 'courseId');
  switch (form.get('op')) {
    case 'add':
    case 'remove':
      return { op: form.get('op'), courseId };
    case 'move':
      return { op: 'move', courseId, direction: direction(form) };
    default:
      return null;
  }
}
