import 'server-only';

import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import { FATWA_PAGE_SIZE, type FatwaAvailability } from '@minhaj/contracts/fatwa';
import type { TopicView } from '@minhaj/contracts/taxonomy';

import { fatwaReadRuntime } from '@/composition/fatwa-read';
import { pageLinks } from '@/components/hadith/presentation';
import { Pagination } from '@/components/media/parts';
import { EmptyState, PageHeading, TextLink } from '@/components/ui';
import { directionOf } from '@/config/locale';
import { categoryLabels, FatwaList } from './list';
import { FatwaFixtureNotice, FatwaFrame, fatwaTrail } from './parts';
import { fatwaTopicHref, offsetHref } from './presentation';
import { fatwaAvailability } from './read';

/**
 * The published rulings on a Topic — a filtered view and a topic-hub section
 * (ROUTE_MAP.md §2.2, §3.8).
 *
 * A FILTERED VIEW, NOT A RESOURCE. `/fatwa/topics/{slug}` canonicalises to the
 * topic hub and is never a sitemap entry. Taxonomy owns the Topic; Fatwa
 * decides which rulings are on it — those whose CURRENT published revision
 * lists it, or whose category maps onto it.
 */

/** How many rulings the topic hub previews before linking to the full view. */
const HUB_PREVIEW = 5;

export async function FatwaTopicPage({
  locale,
  availability,
  topic,
  offset,
}: {
  readonly locale: Locale;
  readonly availability: FatwaAvailability;
  readonly topic: TopicView;
  readonly offset: number;
}) {
  const t = await getTranslations({ locale, namespace: 'fatwa' });
  const parts = await fatwaTrail(locale);
  const [page, categories] = await Promise.all([
    fatwaReadRuntime().reader.browse({
      sort: 'latest',
      categoryId: null,
      topicId: topic.id,
      offset,
    }),
    categoryLabels(locale),
  ]);
  const path = fatwaTopicHref(locale, topic.slug);
  const links = pageLinks(page.offset, FATWA_PAGE_SIZE, page.total);
  const labelLocale = topic.label.resolvedLocale;

  return (
    <FatwaFrame
      locale={locale}
      availability={availability}
      trail={[parts.home, parts.fatwa, { text: topic.label.name }]}
    >
      <div className="flex flex-col gap-2">
        <PageHeading>
          {t('topicTitle')}:{' '}
          <span lang={labelLocale} dir={directionOf(labelLocale)}>
            {topic.label.name}
          </span>
        </PageHeading>
        <p>
          <TextLink href={`/${locale}/topics/${encodeURIComponent(topic.slug)}`}>
            {t('topicHub')}
          </TextLink>
        </p>
      </div>
      {page.items.length === 0 ? (
        <EmptyState>{t('topicEmpty')}</EmptyState>
      ) : (
        <FatwaList
          locale={locale}
          items={page.items}
          categories={categories}
          label={topic.label.name}
          headingLevel="h2"
          t={t}
        />
      )}
      <Pagination
        label={topic.label.name}
        previous={links.previous === null ? null : offsetHref(path, links.previous)}
        next={links.next === null ? null : offsetHref(path, links.next)}
        previousLabel={t('previous')}
        nextLabel={t('next')}
      />
    </FatwaFrame>
  );
}

/**
 * The topic hub's Fatwa section — a bounded preview composed into
 * `/topics/{slug}` at Layer 4. Renders NOTHING while the service is inactive
 * or no published ruling is on the Topic, so the hub carries no empty frame
 * (ROUTE_MAP.md §5.2). Fixture text carries the fixture banner here too.
 */
export async function FatwaTopicSection({
  locale,
  topic,
  heading,
  headingId,
}: {
  readonly locale: Locale;
  readonly topic: Pick<TopicView, 'id' | 'slug'>;
  readonly heading: string;
  readonly headingId: string;
}) {
  const availability = await fatwaAvailability();
  if (!availability.active) return null;
  const page = await fatwaReadRuntime().reader.browse({
    sort: 'latest',
    categoryId: null,
    topicId: topic.id,
    offset: 0,
  });
  if (page.items.length === 0) return null;
  const [t, categories] = await Promise.all([
    getTranslations({ locale, namespace: 'fatwa' }),
    categoryLabels(locale),
  ]);

  return (
    <section className="flex flex-col gap-4" aria-labelledby={headingId}>
      <h2 id={headingId} className="text-lg font-semibold">
        {heading}
      </h2>
      <FatwaFixtureNotice locale={locale} availability={availability} />
      <FatwaList
        locale={locale}
        items={page.items.slice(0, HUB_PREVIEW)}
        categories={categories}
        label={heading}
        headingLevel="h3"
        t={t}
      />
      <p>
        <TextLink href={fatwaTopicHref(locale, topic.slug)}>{t('topicAll')}</TextLink>
      </p>
    </section>
  );
}
