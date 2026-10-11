import 'server-only';

import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import {
  QURAN_PAGE,
  citationOf,
  type PublicTopicAyah,
  type QuranAvailability,
} from '@minhaj/contracts/quran';
import type { TopicView } from '@minhaj/contracts/taxonomy';

import { quranReadRuntime } from '@/composition/quran-read';
import { Pagination } from '@/components/media/parts';
import { EmptyState, PageHeading, TextLink } from '@/components/ui';
import { directionOf } from '@/config/locale';
import { ArabicText, FixtureNotice, QuranFrame, quranTrail } from './parts';
import { DEFAULT_TEXT_SIZE, ayahPath, offsetPathOf, pageLinks } from './presentation';
import { quranAvailability } from './read';

/**
 * The public ayat assigned to a Topic — a filtered view and a topic-hub section
 * (ROUTE_MAP.md §2.2, §3.3).
 *
 * A FILTERED VIEW, NOT A RESOURCE. `/quran/topics/{slug}` canonicalises to the
 * topic hub; it is never a sitemap entry. Taxonomy owns the Topic and Quran owns
 * the assignment; this page composes the two at Layer 4.
 *
 * THE CITATION IS THE LINK. Each Ayah is shown as its canonical Arabic, marked
 * `lang="ar" dir="rtl"`, and linked to its canonical address.
 */

type QuranTranslator = Awaited<ReturnType<typeof getTranslations<'quran'>>>;

/** How many ayat the topic hub previews before linking to the full view. */
const HUB_PREVIEW = 5;

function TopicAyatList({
  locale,
  ayat,
  label,
  t,
  headingLevel,
}: {
  readonly locale: Locale;
  readonly ayat: readonly PublicTopicAyah[];
  readonly label: string;
  readonly t: QuranTranslator;
  readonly headingLevel: 'h2' | 'h3';
}) {
  const Heading = headingLevel;
  return (
    <ol aria-label={label} className="flex flex-col">
      {ayat.map((ayah) => {
        const ref = { surah: ayah.surah, ayah: ayah.ayah };
        const key = `${String(ayah.surah)}-${String(ayah.ayah)}`;
        return (
          <li key={key}>
            <article
              aria-label={t('ayahName', ref)}
              className="flex min-w-0 flex-col gap-2 border-b border-[color:var(--color-border)] py-4"
            >
              <Heading className="text-sm font-semibold">
                <TextLink href={ayahPath(locale, ref)}>
                  {t('ayahName', ref)} <span dir="ltr">({citationOf(ref)})</span>
                </TextLink>
              </Heading>
              <div className="max-w-[var(--measure-prose)]">
                <ArabicText
                  id={`topic-arabic-${key}`}
                  label={t('layer.arabic')}
                  text={ayah.text}
                  size={DEFAULT_TEXT_SIZE}
                />
              </div>
            </article>
          </li>
        );
      })}
    </ol>
  );
}

export async function QuranTopicPage({
  locale,
  availability,
  topic,
  offset,
}: {
  readonly locale: Locale;
  readonly availability: QuranAvailability;
  readonly topic: TopicView;
  readonly offset: number;
}) {
  const t = await getTranslations({ locale, namespace: 'quran' });
  const parts = await quranTrail(locale);
  const page = await quranReadRuntime().reader.topicAyat(topic.id, offset);
  const path = `/${locale}/quran/topics/${encodeURIComponent(topic.slug)}`;
  const links = pageLinks(page.offset, QURAN_PAGE, page.total);
  const labelLocale = topic.label.resolvedLocale;

  return (
    <QuranFrame
      locale={locale}
      availability={availability}
      trail={[parts.home, parts.quran, { text: topic.label.name }]}
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
        <TopicAyatList
          locale={locale}
          ayat={page.items}
          label={topic.label.name}
          t={t}
          headingLevel="h2"
        />
      )}
      <Pagination
        label={topic.label.name}
        previous={links.previous === null ? null : offsetPathOf(path, links.previous)}
        next={links.next === null ? null : offsetPathOf(path, links.next)}
        previousLabel={t('previous')}
        nextLabel={t('next')}
      />
    </QuranFrame>
  );
}

/**
 * The topic hub's Quran section — a bounded preview composed into
 * `/topics/{slug}` at Layer 4. Renders NOTHING while the corpus is inactive or
 * the Topic has no public Ayah, so the hub carries no empty frame
 * (ROUTE_MAP.md §5.2). Fixture text carries the fixture banner here too.
 */
export async function QuranTopicSection({
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
  const availability = await quranAvailability();
  if (!availability.active) return null;
  const page = await quranReadRuntime().reader.topicAyat(topic.id, 0);
  if (page.items.length === 0) return null;
  const t = await getTranslations({ locale, namespace: 'quran' });

  return (
    <section className="flex flex-col gap-4" aria-labelledby={headingId}>
      <h2 id={headingId} className="text-lg font-semibold">
        {heading}
      </h2>
      <FixtureNotice locale={locale} availability={availability} />
      <TopicAyatList
        locale={locale}
        ayat={page.items.slice(0, HUB_PREVIEW)}
        label={heading}
        t={t}
        headingLevel="h3"
      />
      <p>
        <TextLink href={`/${locale}/quran/topics/${encodeURIComponent(topic.slug)}`}>
          {t('topicAll')}
        </TextLink>
      </p>
    </section>
  );
}
