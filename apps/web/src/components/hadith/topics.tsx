import 'server-only';

import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import { HADITH_PAGE, type HadithAvailability } from '@minhaj/contracts/hadith';
import type { TopicView } from '@minhaj/contracts/taxonomy';

import { hadithReadRuntime } from '@/composition/hadith-read';
import { contentLanguages } from '@/composition/public-references';
import { Pagination } from '@/components/media/parts';
import { EmptyState, PageHeading, TextLink } from '@/components/ui';
import { directionOf } from '@/config/locale';
import {
  CitationList,
  FixtureNotice,
  HadithFrame,
  collectionLabels,
  hadithTrail,
} from './parts';
import { hadithTopicPath, offsetPathOf, pageLinks } from './presentation';
import { hadithAvailability } from './read';

/**
 * The public citations assigned to a Topic — a filtered view and a topic-hub
 * section (ROUTE_MAP.md §2.2, §3.4).
 *
 * A FILTERED VIEW, NOT A RESOURCE. `/hadith/topics/{slug}` canonicalises to the
 * topic hub; it is never a sitemap entry. Taxonomy owns the Topic and Hadith
 * owns the assignment; this page composes the two at Layer 4.
 *
 * THE CITATION IS THE LINK. Each narration is shown by its original text, in
 * its own language and direction, linked to its short canonical address.
 */

/** How many citations the topic hub previews before linking to the full view. */
const HUB_PREVIEW = 5;

export async function HadithTopicPage({
  locale,
  availability,
  topic,
  offset,
}: {
  readonly locale: Locale;
  readonly availability: HadithAvailability;
  readonly topic: TopicView;
  readonly offset: number;
}) {
  const t = await getTranslations({ locale, namespace: 'hadith' });
  const parts = await hadithTrail(locale);
  const [page, collections, languages] = await Promise.all([
    hadithReadRuntime().reader.topicCitations(topic.id, offset),
    collectionLabels(locale),
    contentLanguages(),
  ]);
  const path = hadithTopicPath(locale, topic.slug);
  const links = pageLinks(page.offset, HADITH_PAGE, page.total);
  const labelLocale = topic.label.resolvedLocale;

  return (
    <HadithFrame
      locale={locale}
      availability={availability}
      trail={[parts.home, parts.hadith, { text: topic.label.name }]}
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
        <CitationList
          locale={locale}
          citations={page.items}
          collections={collections}
          languages={languages}
          label={topic.label.name}
          idPrefix="topic-citation"
          headingLevel="h2"
          t={t}
        />
      )}
      <Pagination
        label={topic.label.name}
        previous={links.previous === null ? null : offsetPathOf(path, links.previous)}
        next={links.next === null ? null : offsetPathOf(path, links.next)}
        previousLabel={t('previous')}
        nextLabel={t('next')}
      />
    </HadithFrame>
  );
}

/**
 * The topic hub's Hadith section — a bounded preview composed into
 * `/topics/{slug}` at Layer 4. Renders NOTHING while no collection is
 * activated or the Topic has no public citation, so the hub carries no empty
 * frame (ROUTE_MAP.md §5.2). Fixture text carries the fixture banner here too.
 */
export async function HadithTopicSection({
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
  const availability = await hadithAvailability();
  if (!availability.active) return null;
  const page = await hadithReadRuntime().reader.topicCitations(topic.id, 0);
  if (page.items.length === 0) return null;
  const [t, collections, languages] = await Promise.all([
    getTranslations({ locale, namespace: 'hadith' }),
    collectionLabels(locale),
    contentLanguages(),
  ]);

  return (
    <section className="flex flex-col gap-4" aria-labelledby={headingId}>
      <h2 id={headingId} className="text-lg font-semibold">
        {heading}
      </h2>
      <FixtureNotice locale={locale} availability={availability} />
      <CitationList
        locale={locale}
        citations={page.items.slice(0, HUB_PREVIEW)}
        collections={collections}
        languages={languages}
        label={heading}
        idPrefix="hub-hadith"
        headingLevel="h3"
        t={t}
      />
      <p>
        <TextLink href={hadithTopicPath(locale, topic.slug)}>{t('topicAll')}</TextLink>
      </p>
    </section>
  );
}
