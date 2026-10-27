import 'server-only';

import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import { SEARCH_QUERY_MAX_LENGTH } from '@minhaj/contracts/search';
import type { QuranAvailability } from '@minhaj/contracts/quran';

import { quranReadRuntime } from '@/composition/quran-read';
import {
  ActionLink,
  Alert,
  Breadcrumbs,
  Button,
  CardGrid,
  Container,
  LinkCard,
  PageHero,
  SectionHeader,
  TextInput,
  TextLink,
} from '@/components/ui';
import { pathFor, requireRoute } from '@/shell/registry';
import { FixtureNotice, quranTrail } from './parts';
import { quranPath } from './presentation';
import { readQuranTopic } from './read';
import { RELATED_KINDS } from './related';

/**
 * `/quran` — the Quran landing (ROUTE_MAP.md §3.3).
 *
 * A KNOWLEDGE LANDING, NOT A SHOWCASE. It opens with the way in — start
 * reading, or search the text — and then lays the section out the way a
 * reader uses it: READ (by Surah, by Juz), STUDY (the published works beside
 * the text), EXPLORE (what the rest of the platform classifies under the
 * Quran) and LEARN (courses). A study aid, the recitations or a related view
 * is listed ONLY when there is something public behind it. No statistics, no
 * sample verse, no "coming soon", and nothing moves.
 */

interface Entry {
  readonly key: string;
  readonly href: string;
}

/** One part of the section: its header and a rail of whole-card links. */
function EntryRail({
  id,
  heading,
  intro,
  entries,
  columns,
  title,
  body,
  action,
}: {
  readonly id: string;
  readonly heading: string;
  readonly intro: string;
  readonly entries: readonly Entry[];
  readonly columns: 2 | 3 | 4;
  readonly title: (key: string) => string;
  readonly body: (key: string) => string;
  readonly action?: { readonly href: string; readonly text: string };
}) {
  if (entries.length === 0) return null;
  return (
    <section className="flex flex-col gap-5" aria-labelledby={id}>
      <SectionHeader
        id={id}
        heading={heading}
        intro={intro}
        {...(action === undefined ? {} : { action })}
      />
      <CardGrid columns={columns}>
        {entries.map((entry) => (
          <LinkCard
            key={entry.key}
            href={entry.href}
            title={title(entry.key)}
            description={body(entry.key)}
          />
        ))}
      </CardGrid>
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
  const read = ['surah', 'juz'].map(section);
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
          { key: 'topics', href: `/${locale}/topics/${encodeURIComponent(topic.slug)}` },
        ];
  const learn = topic === null ? [] : [section('courses')];
  const title = (key: string) => t(`sections.${key}` as 'sections.read');
  const body = (key: string) => t(`sectionBody.${key}` as 'sectionBody.read');

  return (
    <>
      <Container>
        <div className="flex flex-col gap-4 pt-6">
          <FixtureNotice locale={locale} availability={availability} />
          <Breadcrumbs label={parts.label} trail={[parts.home, { text: t('title') }]} />
        </div>
      </Container>

      <PageHero
        eyebrow={t('landing.eyebrow')}
        title={t('title')}
        lede={t('intro')}
        actions={
          <ActionLink href={quranPath(locale, 'read')}>{t('sections.read')}</ActionLink>
        }
      >
        <form
          method="get"
          action={quranPath(locale, 'search')}
          role="search"
          aria-label={t('sections.search')}
          className="flex w-full max-w-2xl flex-col gap-2 pt-2"
        >
          <label htmlFor="quran-landing-search" className="text-sm font-medium">
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
      </PageHero>

      <Container>
        <div className="flex flex-col gap-[var(--space-section)] py-[var(--space-section)]">
          <EntryRail
            id="quran-read"
            heading={t('landing.read')}
            intro={t('landing.readIntro')}
            entries={read}
            columns={2}
            title={title}
            body={body}
          />
          <EntryRail
            id="quran-study"
            heading={t('landing.study')}
            intro={t('landing.studyIntro')}
            entries={study}
            columns={3}
            title={title}
            body={body}
          />
          <EntryRail
            id="quran-explore"
            heading={t('landing.explore')}
            intro={t('landing.exploreIntro')}
            entries={explore}
            columns={4}
            title={title}
            body={body}
          />
          <EntryRail
            id="quran-learn"
            heading={t('landing.learn')}
            intro={t('landing.learnIntro')}
            entries={learn}
            columns={2}
            title={title}
            body={body}
            action={{
              href: pathFor(locale, requireRoute('learn')),
              text: t('landing.learnAll'),
            }}
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

      <PageHero
        eyebrow={t('landing.eyebrow')}
        title={t('title')}
        lede={t('unavailable.lede')}
      >
        <div className="max-w-[var(--measure-prose)]">
          <Alert tone="info">{t('unavailable.body')}</Alert>
        </div>
      </PageHero>

      <Container>
        <div className="flex flex-col gap-[var(--space-section)] py-[var(--space-section)]">
          <section className="flex flex-col gap-5" aria-labelledby="quran-structure">
            <SectionHeader
              id="quran-structure"
              heading={t('unavailable.structureHeading')}
              intro={t('unavailable.structureIntro')}
            />
            <ul className="grid list-none grid-cols-1 gap-4 p-0 *:min-w-0 sm:grid-cols-2 lg:grid-cols-4">
              {parts4.map((part) => (
                <li
                  key={part.key}
                  className="flex h-full min-w-0 flex-col gap-2.5 rounded-[var(--radius-panel)] border border-[color:var(--color-border)] bg-[color:var(--color-surface-raised)] p-5 shadow-[var(--shadow-panel)]"
                >
                  <h3 className="text-subheading font-semibold">
                    {t(`landing.${part.key}`)}
                  </h3>
                  <p className="text-sm text-[color:var(--color-foreground-muted)]">
                    {t(`unavailable.parts.${part.key}`)}
                  </p>
                  <p className="mt-auto pt-1 text-sm">
                    {part.href === null ? (
                      <span className="text-caption font-medium text-[color:var(--color-foreground-muted)]">
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
            <TextLink href={`/${locale}`}>{t('unavailable.home')}</TextLink>
          </p>
        </div>
      </Container>
    </>
  );
}
