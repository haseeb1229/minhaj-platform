import 'server-only';

import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import { SEARCH_QUERY_MAX_LENGTH } from '@minhaj/contracts/search';
import type { QuranAvailability } from '@minhaj/contracts/quran';

import { quranReadRuntime } from '@/composition/quran-read';
import {
  Button,
  Panel,
  PageHeading,
  Prose,
  SectionHeading,
  TextInput,
  TextLink,
} from '@/components/ui';
import { QuranFrame, quranTrail } from './parts';
import { quranPath } from './presentation';
import { readQuranTopic } from './read';
import { RELATED_KINDS } from './related';

/**
 * `/quran` — the Quran landing (ROUTE_MAP.md §3.3).
 *
 * A KNOWLEDGE LANDING, NOT A SHOWCASE. It says what the section holds and how
 * to enter it — by Surah, by Juz, by citation, by search — and lists a study
 * aid, the recitations or a related view ONLY when there is something public
 * behind it. No statistics, no sample verse, no "coming soon".
 */

interface Entry {
  readonly key: string;
  readonly href: string;
}

function EntryList({
  id,
  heading,
  entries,
  title,
  body,
}: {
  readonly id: string;
  readonly heading: string;
  readonly entries: readonly Entry[];
  readonly title: (key: string) => string;
  readonly body: (key: string) => string;
}) {
  if (entries.length === 0) return null;
  return (
    <section className="flex flex-col gap-4" aria-labelledby={id}>
      <SectionHeading>
        <span id={id}>{heading}</span>
      </SectionHeading>
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {entries.map((entry) => (
          <Panel key={entry.key} as="li">
            <div className="flex flex-col gap-2">
              <h3 className="text-lg font-semibold">
                <TextLink href={entry.href}>{title(entry.key)}</TextLink>
              </h3>
              <p className="text-sm text-[color:var(--color-foreground-muted)]">
                {body(entry.key)}
              </p>
            </div>
          </Panel>
        ))}
      </ul>
    </section>
  );
}

export async function QuranLandingPage({
  locale,
  availability,
}: {
  readonly locale: Locale;
  readonly availability: QuranAvailability;
}) {
  const t = await getTranslations({ locale, namespace: 'quran' });
  const parts = await quranTrail(locale);
  const reader = quranReadRuntime().reader;
  const [translations, tafsirs, transliterations, tajweed, recitations, topic] =
    await Promise.all([
      reader.translations(),
      reader.tafsirs(),
      reader.transliterations(),
      reader.tajweedRules(),
      reader.recitations(),
      readQuranTopic(locale),
    ]);

  const section = (key: string): Entry => ({ key, href: quranPath(locale, key) });
  const read = ['read', 'surah', 'juz'].map(section);
  const study = [
    ...(translations.length > 0 ? [section('translations')] : []),
    ...(tafsirs.length > 0 ? [section('tafsir')] : []),
    ...(transliterations.length > 0 ? [section('transliteration')] : []),
    ...(tajweed.length > 0 ? [section('tajweed')] : []),
  ];
  const listen = recitations.length > 0 ? [section('recitations')] : [];
  const related =
    topic === null
      ? []
      : [
          ...RELATED_KINDS.map(section),
          { key: 'topics', href: `/${locale}/topics/${encodeURIComponent(topic.slug)}` },
        ];
  const title = (key: string) => t(`sections.${key}` as 'sections.read');
  const body = (key: string) => t(`sectionBody.${key}` as 'sectionBody.read');

  return (
    <QuranFrame
      locale={locale}
      availability={availability}
      trail={[parts.home, { text: t('title') }]}
    >
      <Prose>
        <PageHeading>{t('title')}</PageHeading>
        <p>{t('intro')}</p>
      </Prose>

      <Panel>
        <form
          method="get"
          action={quranPath(locale, 'search')}
          role="search"
          aria-label={t('sections.search')}
          className="flex flex-col gap-3"
        >
          <SectionHeading>{t('sections.search')}</SectionHeading>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <label htmlFor="quran-landing-search" className="text-sm font-medium">
                {t('search.label')}
              </label>
              <TextInput
                id="quran-landing-search"
                type="search"
                name="q"
                maxLength={SEARCH_QUERY_MAX_LENGTH}
                autoComplete="off"
              />
            </div>
            <Button>{t('search.submit')}</Button>
          </div>
        </form>
      </Panel>

      <EntryList
        id="quran-read"
        heading={t('landing.read')}
        entries={read}
        title={title}
        body={body}
      />
      <EntryList
        id="quran-study"
        heading={t('landing.study')}
        entries={study}
        title={title}
        body={body}
      />
      <EntryList
        id="quran-listen"
        heading={t('landing.listen')}
        entries={listen}
        title={title}
        body={body}
      />
      <EntryList
        id="quran-related"
        heading={t('landing.related')}
        entries={related}
        title={title}
        body={body}
      />
    </QuranFrame>
  );
}
