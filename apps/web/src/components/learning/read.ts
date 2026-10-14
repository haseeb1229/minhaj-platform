import 'server-only';

import { cache } from 'react';
import type { Metadata } from 'next';

import type { Locale } from '@minhaj/contracts';
import type { CourseDetail, PathDetail } from '@minhaj/contracts/learning';
import { personSlugSchema } from '@minhaj/contracts/people';
import { topicSlugSchema } from '@minhaj/contracts/taxonomy';

import { learningReadRuntime } from '@/composition/learning-read';
import { peopleReadRuntime } from '@/composition/people-read';
import { taxonomyRuntime } from '@/composition/taxonomy';
import { contentMetadata } from '@/seo/metadata';
import {
  courseHref,
  courseLabel,
  learningDescription,
  learningLocales,
  learningPathHref,
} from './presentation';

/**
 * The public Learn reads a request shares, and the ONE metadata rule each Learn
 * entity page follows.
 *
 * READ ONCE PER REQUEST. `generateMetadata` and the page body ask the same
 * questions — which Course or path is this — so each is wrapped in React's
 * request cache and answered by the reader once.
 *
 * SESSION-FREE BY CONSTRUCTION. Everything here reaches the PUBLIC roots —
 * `learningReadRuntime()`, People's reader and Taxonomy — none of which takes
 * an actor or returns a draft, a lesson body or anybody's enrolment. The
 * authenticated `@/composition/learning` is never in this graph
 * (ARCHITECTURE.md §8.1).
 */

export const readCourse = cache((slug: string) => learningReadRuntime().course(slug));

export const readLearningPath = cache((slug: string) => learningReadRuntime().path(slug));

/** An ACTIVE Topic by slug, or `null` — Taxonomy decides, never Learning. */
export const readActiveTopic = cache(async (locale: Locale, slug: string) => {
  if (!topicSlugSchema.safeParse(slug).success) return null;
  const topic = await taxonomyRuntime().taxonomy.findTopicBySlug({ slug, locale });
  return topic !== null && topic.status === 'active' ? topic : null;
});

/**
 * A PUBLIC Person by their People slug, or `null` — People decides. What the
 * catalogue's `?teacher=` names; Learning only ever receives the identifier.
 */
export const readPublicPerson = cache(async (locale: Locale, slug: string) => {
  if (!personSlugSchema.safeParse(slug).success) return null;
  return peopleReadRuntime().people.publicProfile({ slug, locale });
});

/**
 * Metadata for one published Course — through the shared content rule: its
 * alternates are the locales it genuinely has words in, and a Course described
 * only in Urdu canonicalises to its Urdu address (ROUTE_MAP.md §9.2, §9.3).
 */
export function courseMetadata(locale: Locale, record: CourseDetail): Metadata {
  const label = courseLabel(record, locale);
  const description = learningDescription(
    label.summary === '' ? label.description : label.summary,
  );
  return contentMetadata({
    locale,
    contentLocales: learningLocales(record),
    primaryLocale: record.primaryLocale,
    pathFor: (target) => courseHref(target, record.slug),
    title: label.title,
    ...(description === undefined ? {} : { description }),
  });
}

/** The same rule for one published LearningPath. */
export function learningPathMetadata(locale: Locale, record: PathDetail): Metadata {
  const label = courseLabel(record, locale);
  const description = learningDescription(
    label.summary === '' ? label.description : label.summary,
  );
  return contentMetadata({
    locale,
    contentLocales: learningLocales(record),
    primaryLocale: record.primaryLocale,
    pathFor: (target) => learningPathHref(target, record.slug),
    title: label.title,
    ...(description === undefined ? {} : { description }),
  });
}
