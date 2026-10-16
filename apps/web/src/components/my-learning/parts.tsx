import 'server-only';

import type { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import { courseCompleted, type OutlineLabel } from '@minhaj/contracts/learning';

import { StatusBadge } from '@/components/ui';
import { pickLabel } from './presentation';

/**
 * The parts every My Learning page shares (Phase 22).
 *
 * PROGRESS IS WORDS FIRST. "Lessons complete: 3 of 10" and "Completed" are
 * text; a tick beside "Completed" is decoration, hidden from assistive
 * technology, and no state is ever carried by colour alone
 * (SECURITY_BASELINE.md §16.1).
 *
 * A TITLE CARRIES ITS LANGUAGE, so a Urdu course title on an English page is
 * announced and shaped as Urdu. LOGICAL PROPERTIES ONLY (`check:rtl`).
 */

export type LearningTranslator = Awaited<
  ReturnType<typeof getTranslations<'myLearning'>>
>;

/** A record's title in the reader's locale where it has one. */
export function LearningTitle({
  labels,
  primaryLocale,
  locale,
}: {
  readonly labels: readonly OutlineLabel[];
  readonly primaryLocale: Locale;
  readonly locale: Locale;
}) {
  const label = pickLabel(labels, locale, primaryLocale);
  return (
    <span lang={label?.locale} dir="auto" className="wrap-anywhere">
      {label?.title}
    </span>
  );
}

/** How far the person is through a Course, in words. */
export function ProgressStatus({
  completed,
  lessons,
  t,
}: {
  readonly completed: number;
  readonly lessons: number;
  readonly t: LearningTranslator;
}) {
  if (courseCompleted(completed, lessons))
    return (
      <StatusBadge tone="positive">
        <span aria-hidden="true">✓ </span>
        {t('progress.completed')}
      </StatusBadge>
    );
  return (
    <span className="text-sm">
      {t('progress.lessons', {
        completed: String(Math.min(completed, lessons)),
        total: String(lessons),
      })}
    </span>
  );
}

/**
 * The words for every refusal a My Learning action can return — a category,
 * never content; `overrides` gives one form its own wording.
 */
export function learningMessages(
  t: LearningTranslator,
  overrides: Readonly<Record<string, string>> = {},
): Readonly<Record<string, string>> {
  return {
    invalid: t('failure.invalid'),
    'not-found': t('failure.invalid'),
    'not-enrolled': t('failure.notEnrolled'),
    'course-unavailable': t('failure.courseUnavailable'),
    booked: t('failure.booked'),
    'rate-limited': t('failure.rateLimited'),
    'confirm-required': t('failure.confirmRequired'),
    'no-session': t('failure.noSession'),
    denied: t('failure.noSession'),
    unavailable: t('failure.unavailable'),
    unknown: t('failure.unavailable'),
    ...overrides,
  };
}
