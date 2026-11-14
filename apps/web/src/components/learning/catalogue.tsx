import 'server-only';

import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';

import { Breadcrumbs, Container } from '@/components/ui';
import { CoursesHub, type NamedReference } from '@/components/topic-hub/courses';
import { LEARN_COURSES, type CoursesQuery } from '@/components/topic-hub/courses-view';
import { learnTrail } from './parts';
import { learnPath } from './presentation';
import { readActiveTopic, readPublicPerson } from './read';

/**
 * `/learn/courses` — THE COURSE CATALOGUE (ROUTE_MAP.md §3.5; Learn Part 1):
 * every published Course, as the shared Courses listing
 * (`@/components/topic-hub/courses`) presents a subject's — figures, the
 * format tabs, filters with counts (Topic, level, content language and
 * teacher), orders, level grouping, numbered pages — without a Topic scope.
 *
 * THE ADDRESS'S SLUGS ARE RESOLVED BY THEIR OWNERS, here at Layer 4: the
 * Topic by Taxonomy (only an ACTIVE Topic resolves) and the teacher by People
 * (only a PUBLIC Person resolves); Learning only ever receives their
 * identifiers. A slug that resolves to nothing is the catalogue's own explained
 * empty result, exactly as a malformed value is — never every Course.
 *
 * Learning-paths, live classes, trial classes and Find a Teacher are the
 * catalogue's ways onward; nothing here reads a session or writes anything.
 */
export async function CourseCataloguePage({
  locale,
  query,
  invalid,
}: {
  readonly locale: Locale;
  readonly query: CoursesQuery;
  /** A filter in the address is malformed or repeated (`readCatalogueQuery`). */
  readonly invalid: boolean;
}) {
  const [t, trail, topicView, person] = await Promise.all([
    getTranslations({ locale, namespace: 'learn' }),
    learnTrail(locale),
    query.topic === null ? null : readActiveTopic(locale, query.topic),
    query.teacher === null ? null : readPublicPerson(locale, query.teacher),
  ]);
  const topic: NamedReference | null =
    topicView === null
      ? null
      : { id: topicView.id, slug: topicView.slug, name: topicView.label.name };
  const teacher: NamedReference | null =
    person === null
      ? null
      : { id: person.id, slug: person.slug, name: person.label.name };
  const unresolved =
    (query.topic !== null && topic === null) ||
    (query.teacher !== null && teacher === null);
  const title = t('sections.courses');

  return (
    <CoursesHub
      domain={{
        key: 'learn',
        locale,
        topicId: null,
        title,
        frame: (children) => (
          <Container>
            <div className="flex min-w-0 flex-col gap-8 pt-6 pb-[var(--space-section)]">
              <Breadcrumbs
                label={trail.label}
                trail={[trail.home, trail.learn, { text: title }]}
              />
              {children}
            </div>
          </Container>
        ),
        previous: t('previous'),
        next: t('next'),
      }}
      scope={LEARN_COURSES}
      query={query}
      copy={{
        eyebrow: t('title'),
        lede: t('catalogue.lede'),
        stat: (count) => t('catalogue.statCourses', { count }),
        listIntro: t('catalogue.listIntro'),
        emptyTitle: t('catalogue.emptyTitle'),
        empty: t('coursesEmpty'),
        noResults: t('filter.empty'),
        pathsIntro: t('sectionBody.paths'),
        alongsideIntro: t('catalogue.alongsideIntro'),
      }}
      alongside={(['live', 'trial', 'teachers'] as const).map((key) => ({
        key,
        href: learnPath(locale, key),
        title: t(`sections.${key}`),
        body: t(`sectionBody.${key}`),
      }))}
      catalogue={{
        topic,
        teacher,
        invalid: invalid || unresolved,
        invalidTitle: t('filter.invalidTitle'),
        invalidText: t('filter.invalid'),
        actions: [
          { href: learnPath(locale, 'paths'), text: t('sections.paths') },
          { href: learnPath(locale, 'trial'), text: t('sections.trial') },
        ],
      }}
    />
  );
}
