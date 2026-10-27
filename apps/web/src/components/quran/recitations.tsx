import 'server-only';

import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import type {
  PublicRecitation,
  PublicRecitationSegment,
  PublicSurah,
  QuranAvailability,
} from '@minhaj/contracts/quran';

import { referenceNames } from '@/composition/public-references';
import { playableSegments } from '@/composition/quran-assets';
import { quranReadRuntime } from '@/composition/quran-read';
import { BreadcrumbData } from '@/components/media/parts';
import {
  Breadcrumbs,
  Container,
  EmptyState,
  PageHeading,
  Panel,
  Prose,
  TextLink,
} from '@/components/ui';
import {
  FixtureNotice,
  QuranFrame,
  SegmentPlayer,
  quranTrail,
  segmentRange,
} from './parts';
import {
  NO_READING_CHOICE,
  quranPath,
  reciterPath,
  surahPath,
  withReading,
} from './presentation';
import { quranIndexable, readSurahs } from './read';

/**
 * Recitations — OWNED BY QURAN (DOMAIN_MODEL.md §8.1; ROUTE_MAP.md §3.3, §3.7).
 *
 * A Recitation is a reciter's work: a People Person (being one grants nothing)
 * and segments of audio over same-Surah ranges. Everything here is Quran's
 * public reader and People's public names — never Media: an AudioTrack can
 * neither fill nor appear in this catalogue.
 *
 * `/listen/recitations` is the SAME catalogue projected into Listen at Layer 4,
 * canonical to `/quran/recitations`, so the two never compete.
 *
 * THE BROWSER'S PLAYER, NOTHING MORE. Each segment is a native `<audio>` with
 * no autoplay, nothing fetched until asked, and no download link.
 */

type QuranTranslator = Awaited<ReturnType<typeof getTranslations<'quran'>>>;
type Names = Awaited<ReturnType<typeof referenceNames>>;

/** One recitation as a catalogue row. */
function RecitationRow({
  locale,
  recitation,
  names,
  first,
  t,
  headingLevel,
}: {
  readonly locale: Locale;
  readonly recitation: PublicRecitation;
  readonly names: Names;
  readonly first: PublicSurah | undefined;
  readonly t: QuranTranslator;
  readonly headingLevel: 'h2' | 'h3';
}) {
  const reciter = names.people.get(recitation.reciterId);
  const Heading = headingLevel;
  return (
    <Panel as="li">
      <div className="flex min-w-0 flex-col gap-2">
        <Heading className="text-lg font-semibold break-words" dir="auto">
          {recitation.name}
        </Heading>
        {reciter === undefined ? null : (
          <p className="text-sm break-words" dir="auto">
            <span className="text-[color:var(--color-foreground-muted)]">
              {t('reciter')}:{' '}
            </span>
            <TextLink href={reciterPath(locale, reciter.slug)}>{reciter.name}</TextLink>
          </p>
        )}
        {recitation.style === null ? null : (
          <p className="text-sm break-words" dir="auto">
            <span className="text-[color:var(--color-foreground-muted)]">
              {t('style')}:{' '}
            </span>
            {recitation.style}
          </p>
        )}
        {recitation.attribution === null ? null : (
          <p
            className="text-xs break-words text-[color:var(--color-foreground-muted)]"
            dir="auto"
          >
            {recitation.attribution}
          </p>
        )}
        {first === undefined ? null : (
          <p className="text-sm">
            <TextLink
              href={withReading(surahPath(locale, first.number), {
                ...NO_READING_CHOICE,
                reciter: recitation.slug,
              })}
            >
              {t('listenWithReader')}
            </TextLink>
          </p>
        )}
      </div>
    </Panel>
  );
}

/** Every public recitation, with each reciter's name resolved in ONE People call. */
async function RecitationList({
  locale,
  recitations,
  label,
  headingLevel = 'h2',
}: {
  readonly locale: Locale;
  readonly recitations: readonly PublicRecitation[];
  readonly label: string;
  readonly headingLevel?: 'h2' | 'h3';
}) {
  const t = await getTranslations({ locale, namespace: 'quran' });
  const [names, surahs] = await Promise.all([
    referenceNames(
      { personIds: recitations.map((recitation) => recitation.reciterId), topicIds: [] },
      locale,
    ),
    readSurahs(),
  ]);
  return (
    <ul aria-label={label} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {recitations.map((recitation) => (
        <RecitationRow
          key={recitation.id}
          locale={locale}
          recitation={recitation}
          names={names}
          first={surahs[0]}
          t={t}
          headingLevel={headingLevel}
        />
      ))}
    </ul>
  );
}

/* ===========================================================================
 * /quran/recitations
 * ========================================================================= */

export async function RecitationsPage({
  locale,
  availability,
}: {
  readonly locale: Locale;
  readonly availability: QuranAvailability;
}) {
  const t = await getTranslations({ locale, namespace: 'quran' });
  const parts = await quranTrail(locale);
  const recitations = await quranReadRuntime().reader.recitations();
  const title = t('sections.recitations');

  return (
    <QuranFrame
      locale={locale}
      availability={availability}
      trail={[parts.home, parts.quran, { text: title }]}
    >
      <div className="flex flex-col gap-2">
        <PageHeading>{title}</PageHeading>
        <p className="text-[color:var(--color-foreground-muted)]">
          {t('sectionBody.recitations')}
        </p>
      </div>
      {recitations.length === 0 ? (
        <EmptyState>{t('worksEmpty.recitations')}</EmptyState>
      ) : (
        <RecitationList locale={locale} recitations={recitations} label={title} />
      )}
    </QuranFrame>
  );
}

/* ===========================================================================
 * /listen/recitations — the Listen projection of the same catalogue
 * ========================================================================= */

/**
 * The recitation catalogue as Listen shows it: Listen's trail, Quran's data.
 * The page passes the reader's own list in, so this projection cannot be filled
 * from anywhere else.
 */
export async function ListenRecitationsPage({
  locale,
  availability,
  recitations,
}: {
  readonly locale: Locale;
  readonly availability: QuranAvailability;
  readonly recitations: readonly PublicRecitation[];
}) {
  const t = await getTranslations({ locale, namespace: 'quran' });
  const listen = await getTranslations({ locale, namespace: 'listen' });
  const shell = await getTranslations({ locale, namespace: 'shell' });
  const title = t('sections.recitations');

  return (
    <Container>
      <div className="flex flex-col gap-8 pt-6 pb-[var(--space-section)]">
        <FixtureNotice locale={locale} availability={availability} />
        <Breadcrumbs
          label={shell('nav.breadcrumbs')}
          trail={[
            { href: `/${locale}`, text: shell('nav.home') },
            { href: `/${locale}/listen`, text: listen('title') },
            { text: title },
          ]}
        />
        <Prose>
          <PageHeading>{title}</PageHeading>
          <p>{t('sectionBody.recitations')}</p>
          <p>
            <TextLink href={quranPath(locale, 'recitations')}>
              {t('recitationsHome')}
            </TextLink>
          </p>
        </Prose>
        {recitations.length === 0 ? (
          <EmptyState>{t('worksEmpty.recitations')}</EmptyState>
        ) : (
          <RecitationList locale={locale} recitations={recitations} label={title} />
        )}
      </div>
    </Container>
  );
}

/* ===========================================================================
 * /quran/recitations/{reciter}
 * ========================================================================= */

/** One recitation's segments, each with its own native player, collapsed. */
async function RecitationSegments({
  locale,
  recitation,
  segments,
  t,
}: {
  readonly locale: Locale;
  readonly recitation: PublicRecitation;
  readonly segments: readonly PublicRecitationSegment[];
  readonly t: QuranTranslator;
}) {
  if (segments.length === 0) return <EmptyState>{t('recitationEmpty')}</EmptyState>;
  return (
    <details className="rounded-[var(--radius-control)] border border-[color:var(--color-border)] px-4 py-2">
      <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium">
        {t('segmentsShow', { count: segments.length })}
      </summary>
      <ol className="flex flex-col gap-4 pb-2">
        {segments.map((segment) => (
          <li key={segment.id} className="flex flex-col gap-2">
            <p className="text-sm font-medium">
              <TextLink
                href={withReading(surahPath(locale, segment.surah), {
                  ...NO_READING_CHOICE,
                  reciter: recitation.slug,
                })}
              >
                {segmentRange(t, segment)}
              </TextLink>
            </p>
            <SegmentPlayer locale={locale} recitation={recitation} segment={segment} />
          </li>
        ))}
      </ol>
    </details>
  );
}

export async function ReciterPage({
  locale,
  availability,
  reciter,
  recitations,
}: {
  readonly locale: Locale;
  readonly availability: QuranAvailability;
  readonly reciter: {
    readonly slug: string;
    readonly name: string;
    readonly locales: readonly Locale[];
  };
  readonly recitations: readonly PublicRecitation[];
}) {
  const t = await getTranslations({ locale, namespace: 'quran' });
  const parts = await quranTrail(locale);
  const reader = quranReadRuntime().reader;
  const segments = await Promise.all(
    recitations.map((recitation) =>
      reader.recitationSegments(recitation.id, null).then(playableSegments),
    ),
  );
  const path = reciterPath(locale, reciter.slug);
  const trail = [
    { name: parts.home.text, path: parts.home.href },
    { name: parts.quran.text, path: parts.quran.href },
    { name: t('sections.recitations'), path: quranPath(locale, 'recitations') },
    { name: reciter.name, path },
  ];

  return (
    <QuranFrame
      locale={locale}
      availability={availability}
      trail={[
        ...trail.slice(0, -1).map((entry) => ({ href: entry.path, text: entry.name })),
        { text: reciter.name },
      ]}
    >
      <Prose>
        <h1 className="text-3xl font-semibold tracking-tight break-words" dir="auto">
          {reciter.name}
        </h1>
        <p>
          <TextLink href={`/${locale}/people/${encodeURIComponent(reciter.slug)}`}>
            {t('reciterProfile')}
          </TextLink>
        </p>
      </Prose>
      <ul aria-label={t('sections.recitations')} className="flex flex-col gap-6">
        {recitations.map((recitation, index) => (
          <Panel key={recitation.id} as="li">
            <div className="flex min-w-0 flex-col gap-3">
              <h2 className="text-lg font-semibold break-words" dir="auto">
                {recitation.name}
              </h2>
              {recitation.style === null ? null : (
                <p className="text-sm break-words" dir="auto">
                  <span className="text-[color:var(--color-foreground-muted)]">
                    {t('style')}:{' '}
                  </span>
                  {recitation.style}
                </p>
              )}
              {recitation.attribution === null ? null : (
                <p
                  className="text-xs break-words text-[color:var(--color-foreground-muted)]"
                  dir="auto"
                >
                  {recitation.attribution}
                </p>
              )}
              <RecitationSegments
                locale={locale}
                recitation={recitation}
                segments={segments[index] ?? []}
                t={t}
              />
            </div>
          </Panel>
        ))}
      </ul>
      <BreadcrumbData
        contentLocales={quranIndexable(availability) ? [...reciter.locales] : []}
        trail={trail}
      />
    </QuranFrame>
  );
}
