import { localizedPath } from '@minhaj/contracts';
import 'server-only';

import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import type { QuranAvailability } from '@minhaj/contracts/quran';
import { SEARCH_QUERY_MAX_LENGTH } from '@minhaj/contracts/search';

import { quranReadRuntime } from '@/composition/quran-read';
import { LibraryDirectory } from '@/components/library/landing';
import {
  ActionLink,
  Alert,
  Breadcrumbs,
  Button,
  Container,
  EmptyState,
  Hero,
  SectionHeader,
  TextInput,
  TextLink,
} from '@/components/ui';
import { Tabs } from '@/components/ui/tabs';
import { pathFor, requireRoute } from '@/shell/registry';
import { ContinueReading, QuickJumpForm } from './landing-islands';
import { AboutThisText, CorpusNotice, quranTrail } from './parts';
import { quranPath } from './presentation';
import { readLastPage, readQuranTopic, readSurahs } from './read';
import {
  JuzIndexList,
  SurahIndexList,
  continueProps,
  jumpIndex,
  quickJumpLabels,
} from './reader';
import { RELATED_KINDS } from './related';

/**
 * `/quran` — the Quran landing (ROUTE_MAP.md §3.3; R2).
 *
 * THE WAY IN FIRST. It opens with where a reader wants to go — type a place
 * ("18:10", a Surah's name, "juz 15", "page 50"), search the text and its
 * published translations for words (a GET form to `/quran/search`, working
 * without JavaScript), continue where the reader stopped (their own signed-in
 * position, else this browser's last place — Quran Part 1), or start at the
 * beginning — and then lays the whole text out as an index:
 * every Surah (number, title, ayat, revelation and its Arabic name in the
 * Quran face) and, in the second tab, every Juz. Below it a quiet directory
 * of the rest of the section — reading, the published works beside the text,
 * what the platform classifies under the Quran, and courses — each listed ONLY
 * when there is something public behind it. On the reference preview it ends
 * with "About this text". No statistics, no sample verse, nothing moves.
 */

interface Link {
  readonly key: string;
  readonly href: string;
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
  const [
    surahs,
    juzList,
    translations,
    tafsirs,
    transliterations,
    tajweed,
    recitations,
    topic,
    lastPage,
  ] = await Promise.all([
    readSurahs(),
    reader.juzList(),
    reader.translations(),
    reader.tafsirs(),
    reader.transliterations(),
    reader.tajweedRules(),
    reader.recitations(),
    readQuranTopic(locale),
    readLastPage(),
  ]);

  const section = (key: string): Link => ({ key, href: quranPath(locale, key) });
  const read = ['read', 'surah', 'juz', 'search'].map(section);
  const study = [
    ...(translations.length > 0 ? [section('translations')] : []),
    ...(tafsirs.length > 0 ? [section('tafsir')] : []),
    ...(transliterations.length > 0 ? [section('transliteration')] : []),
    ...(tajweed.length > 0 ? [section('tajweed')] : []),
    ...(recitations.length > 0 ? [section('recitations')] : []),
  ];
  const explore =
    topic === null
      ? []
      : [
          ...RELATED_KINDS.filter((kind) => kind !== 'courses').map(section),
          {
            key: 'topics',
            href: localizedPath(locale, `/topics/${encodeURIComponent(topic.slug)}`),
          },
        ];
  const learn =
    topic === null
      ? []
      : [
          section('courses'),
          { key: 'learnAll', href: pathFor(locale, requireRoute('learn')) },
        ];
  const linksOf = (links: readonly Link[]) =>
    links.map((link) => ({
      href: link.href,
      title:
        link.key === 'learnAll'
          ? t('landing.learnAll')
          : t(`sections.${link.key}` as 'sections.read'),
      description:
        link.key === 'learnAll'
          ? t('landing.learnIntro')
          : t(`sectionBody.${link.key}` as 'sectionBody.read'),
    }));
  const directory = [
    {
      id: 'quran-read',
      heading: t('landing.read'),
      intro: t('landing.readIntro'),
      links: linksOf(read),
    },
    {
      id: 'quran-study',
      heading: t('landing.study'),
      intro: t('landing.studyIntro'),
      links: linksOf(study),
    },
    {
      id: 'quran-explore',
      heading: t('landing.explore'),
      intro: t('landing.exploreIntro'),
      links: linksOf(explore),
    },
    { id: 'quran-learn', heading: t('landing.learn'), links: linksOf(learn) },
  ].filter((group) => group.links.length > 0);

  return (
    <>
      <Container>
        <div className="flex flex-col gap-4 pt-6">
          <CorpusNotice locale={locale} availability={availability} />
          <Breadcrumbs label={parts.label} trail={[parts.home, { text: t('title') }]} />
        </div>
      </Container>

      <Hero
        title={t('title')}
        lede={t('intro')}
        actions={
          <>
            <ContinueReading {...await continueProps(locale, surahs)} />
            <ActionLink href={quranPath(locale, 'read')} tone="secondary">
              {t('sections.read')}
            </ActionLink>
          </>
        }
      >
        {surahs.length === 0 ? null : (
          <QuickJumpForm
            locale={locale}
            action={quranPath(locale, 'read')}
            index={jumpIndex(surahs)}
            lastPage={lastPage}
            labels={await quickJumpLabels(locale)}
          />
        )}
        <form
          method="get"
          action={quranPath(locale, 'search')}
          role="search"
          aria-label={t('sections.search')}
          className="flex w-full max-w-2xl flex-col gap-2"
        >
          <label htmlFor="quran-landing-search" className="text-sm font-semibold">
            {t('search.label')}
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="min-w-0 flex-1">
              <TextInput
                id="quran-landing-search"
                type="search"
                name="q"
                maxLength={SEARCH_QUERY_MAX_LENGTH}
                autoComplete="off"
              />
            </div>
            <Button tone="secondary">{t('search.submit')}</Button>
          </div>
        </form>
      </Hero>

      <Container>
        <div className="flex flex-col gap-[var(--space-section)] py-[var(--space-section)]">
          <section className="flex flex-col gap-5" aria-labelledby="quran-index">
            <SectionHeader
              id="quran-index"
              heading={t('index.heading')}
              intro={t('index.intro')}
            />
            {surahs.length === 0 ? (
              <EmptyState>{t('empty')}</EmptyState>
            ) : (
              <Tabs
                label={t('index.tabs')}
                tabs={[
                  {
                    id: 'surahs',
                    label: t('sections.surah'),
                    panel: (
                      <SurahIndexList
                        locale={locale}
                        surahs={surahs}
                        label={t('sections.surah')}
                        t={t}
                        headingLevel="h3"
                      />
                    ),
                  },
                  {
                    id: 'juz',
                    label: t('sections.juz'),
                    panel: (
                      <JuzIndexList
                        locale={locale}
                        list={juzList}
                        label={t('sections.juz')}
                        t={t}
                        headingLevel="h3"
                      />
                    ),
                  },
                ]}
              />
            )}
          </section>

          <section className="flex flex-col gap-6" aria-labelledby="quran-more">
            <SectionHeader id="quran-more" heading={t('landing.more')} />
            <LibraryDirectory groups={directory} />
          </section>

          <AboutThisText
            locale={locale}
            availability={availability}
            translation={translations.length > 0}
          />
        </div>
      </Container>
    </>
  );
}

/**
 * THE LANDING WHILE NO CORPUS IS ACTIVE.
 *
 * It says so first and plainly, then describes how the section is organised —
 * in words, with no link into it, no count, no sample and no search, because
 * there is nothing behind any of them yet. The two parts that do not depend on
 * the corpus point at the delivered areas that already serve them (the topic
 * hub and Learn); the rest say what they will hold once a corpus is activated.
 */
export async function QuranLandingUnavailable({ locale }: { readonly locale: Locale }) {
  const t = await getTranslations({ locale, namespace: 'quran' });
  const parts = await quranTrail(locale);
  const parts4 = [
    { key: 'read', href: null },
    { key: 'study', href: null },
    { key: 'explore', href: pathFor(locale, requireRoute('topics')) },
    { key: 'learn', href: pathFor(locale, requireRoute('learn')) },
  ] as const;

  return (
    <>
      <Container>
        <div className="pt-6">
          <Breadcrumbs label={parts.label} trail={[parts.home, { text: t('title') }]} />
        </div>
      </Container>

      <Hero title={t('title')} lede={t('unavailable.lede')}>
        <div className="max-w-[var(--measure-prose)]">
          <Alert tone="info">{t('unavailable.body')}</Alert>
        </div>
      </Hero>

      <Container>
        <div className="flex flex-col gap-[var(--space-section)] py-[var(--space-section)]">
          <section className="flex flex-col gap-5" aria-labelledby="quran-structure">
            <SectionHeader
              id="quran-structure"
              heading={t('unavailable.structureHeading')}
              intro={t('unavailable.structureIntro')}
            />
            <ul className="grid list-none grid-cols-1 gap-x-10 gap-y-8 p-0 *:min-w-0 sm:grid-cols-2 lg:grid-cols-4">
              {parts4.map((part) => (
                <li key={part.key} className="flex h-full min-w-0 flex-col gap-2.5">
                  <h3 className="border-b border-border pb-2 text-subheading font-semibold">
                    {t(`landing.${part.key}`)}
                  </h3>
                  <p className="text-sm text-foreground-muted">
                    {t(`unavailable.parts.${part.key}`)}
                  </p>
                  <p className="mt-auto pt-1 text-sm">
                    {part.href === null ? (
                      <span className="text-caption font-medium text-foreground-muted">
                        {t('unavailable.awaiting')}
                      </span>
                    ) : (
                      <TextLink href={part.href}>
                        {t(`unavailable.go.${part.key}`)}
                      </TextLink>
                    )}
                  </p>
                </li>
              ))}
            </ul>
          </section>

          <p>
            <TextLink href={localizedPath(locale, '')}>{t('unavailable.home')}</TextLink>
          </p>
        </div>
      </Container>
    </>
  );
}
