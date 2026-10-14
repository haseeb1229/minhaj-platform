import 'server-only';

import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';

import { LearningIsland, type LearningIslandLabels } from './learning-island';

/**
 * Places the private Learning island on a public Course page.
 *
 * SESSION-FREE BY CONSTRUCTION. Everything it hands the island is the same for
 * every visitor: the interface locale, the Course's public identifier, slug and
 * format — values the page already shows — the addresses built from them, and
 * labels from the public message catalogue. Nothing here can reach a session,
 * so the page's shared render stays what it was (ARCHITECTURE.md §8.1).
 *
 * The sign-in link returns to THIS Course page, a destination the safe
 * return-to allowlist admits by its exact shape (`composition/return-to.ts`).
 */
export async function LearningControls({
  locale,
  courseId,
  courseSlug,
  live,
}: {
  readonly locale: Locale;
  readonly courseId: string;
  readonly courseSlug: string;
  /** A `live` Course also takes trial-class requests. */
  readonly live: boolean;
}) {
  const t = await getTranslations({ locale, namespace: 'learningIsland' });
  const slug = encodeURIComponent(courseSlug);
  const coursePage = `/${locale}/learn/courses/${slug}`;

  const labels: LearningIslandLabels = {
    heading: t('heading'),
    privacy: t('privacy'),
    signedOutPrompt: t('signedOutPrompt'),
    signedOutLivePrompt: t('signedOutLivePrompt'),
    signInToEnrol: t('signInToEnrol'),
    signInToRequestTrial: t('signInToRequestTrial'),
    sessionEnded: t('sessionEnded'),
    enrol: t('enrol'),
    enrolHelp: t('enrolHelp'),
    enrolled: t('enrolled'),
    enrolledStatus: t('enrolledStatus'),
    continueLearning: t('continueLearning'),
    requestTrial: t('requestTrial'),
    trialHelp: t('trialHelp'),
    trialRequested: t('trialRequested'),
    trialRequestedStatus: t('trialRequestedStatus'),
    trialManage: t('trialManage'),
    working: t('working'),
    failures: {
      invalid: t('failureInvalid'),
      'too-large': t('failureInvalid'),
      unsupported: t('failureInvalid'),
      'course-unavailable': t('failureCourseUnavailable'),
      'rate-limited': t('failureRateLimited'),
      denied: t('failureDenied'),
      unavailable: t('failureUnavailable'),
    },
  };

  return (
    <LearningIsland
      courseId={courseId}
      live={live}
      signInHref={`/${locale}/signin?returnTo=${encodeURIComponent(coursePage)}`}
      myCourseHref={`/${locale}/my/learning/courses/${slug}`}
      myLearningHref={`/${locale}/my/learning`}
      labels={labels}
    />
  );
}
