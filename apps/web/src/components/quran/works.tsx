import 'server-only';

import { getTranslations } from 'next-intl/server';

import { localeSchema, type Locale } from '@minhaj/contracts';
import {
  QURAN_PAGE,
  type PublicLayerWork,
  type PublicSurah,
  type PublicTajweedRule,
  type PublicTransliteration,
  type QuranAvailability,
} from '@minhaj/contracts/quran';

import {
  contentLanguages,
  referenceNames,
  type ContentLanguage,
} from '@/composition/public-references';
import { quranReadRuntime } from '@/composition/quran-read';
import { paragraphsOf } from '@/components/library/scholarly-presentation';
import { BreadcrumbData, formatDate, Pagination } from '@/components/media/parts';
import {
  Alert,
  DetailRow,
  EmptyState,
  PageHeading,
  Panel,
  Prose,
  SectionHeading,
  TextLink,
} from '@/components/ui';
import { QuranFrame, languageOf, quranTrail, segmentRange } from './parts';
import {
  NO_READING_CHOICE,
  ayahPath,
  offsetPathOf,
  pageLinks,
  quranPath,
  surahName,
  surahPath,
  tafsirPath,
  tajweedLocales,
  tajweedRulePath,
  tajweedTextFor,
  translationPath,
  withReading,
} from './presentation';
import { quranIndexable, readSurahs } from './read';

/**
 * The layered works and study aids — Translations, Tafsir, Transliteration and
 * Tajweed (ROUTE_MAP.md §3.3; DOMAIN_MODEL.md §8.2).
 *
 * EACH WORK IS ITS OWN THING, AND NONE IS PRIVILEGED. A page names the work, its
 * language, its contributors and the attribution its source supplied — never a
 * claim the source did not make — and offers to read the Quran WITH it, which
 * is a query preference on the reader, never a second address for an Ayah.
 *
 * ONLY WHAT IS PUBLIC NOW. Every list is the public reader's, which holds no
 * draft, no archived work and no work without a registered source.
 */

type QuranTranslator = Awaited<ReturnType<typeof getTranslations<'quran'>>>;
type Names = Awaited<ReturnType<typeof referenceNames>>;
type WorkKind = 'translations' | 'tafsir';

/** A work's language, named in its own script and marked with its own code. */
function LanguageName({
  languages,
  code,
}: {
  readonly languages: ReadonlyMap<string, ContentLanguage>;
  readonly code: string;
}) {
  const language = languageOf(languages, code);
  return (
    <span lang={language.code} dir={language.direction}>
      {language.name}
    </span>
  );
}

/** The contributors of a work whose People profile is public, linked to it. */
function Contributors({
  locale,
  work,
  names,
  t,
}: {
  readonly locale: Locale;
  readonly work: PublicLayerWork;
  readonly names: Names;
  readonly t: QuranTranslator;
}) {
  const rows = work.contributors.flatMap((contributor) => {
    const person = names.people.get(contributor.personId);
    return person === undefined ? [] : [{ ...person, role: contributor.role }];
  });
  if (rows.length === 0) return null;
  return (
    <p className="text-sm break-words" dir="auto">
      {rows.map((row, index) => (
        <span key={`${row.slug}:${row.role}`}>
          {index === 0 ? null : ' · '}
          <TextLink href={`/${locale}/people/${encodeURIComponent(row.slug)}`}>
            {row.name}
          </TextLink>{' '}
          <span className="text-[color:var(--color-foreground-muted)]">
            ({t(`role.${row.role}`)})
          </span>
        </span>
      ))}
    </p>
  );
}

/** One work as a row of a listing. */
function WorkRow({
  locale,
  kind,
  work,
  languages,
  names,
  t,
  scheme = null,
}: {
  readonly locale: Locale;
  readonly kind: WorkKind | 'transliteration';
  readonly work: PublicLayerWork;
  readonly languages: ReadonlyMap<string, ContentLanguage>;
  readonly names: Names;
  readonly t: QuranTranslator;
  readonly scheme?: string | null;
}) {
  const href =
    kind === 'translations'
      ? translationPath(locale, work.slug)
      : kind === 'tafsir'
        ? tafsirPath(locale, work.slug)
        : null;
  return (
    <Panel as="li">
      <div className="flex min-w-0 flex-col gap-2">
        <h2 className="text-lg font-semibold break-words" dir="auto">
          {href === null ? work.name : <TextLink href={href}>{work.name}</TextLink>}
        </h2>
        <p className="text-sm text-[color:var(--color-foreground-muted)]">
          <LanguageName languages={languages} code={work.languageCode} />
        </p>
        <Contributors locale={locale} work={work} names={names} t={t} />
        {work.description === null ? null : (
          <p className="line-clamp-3 text-sm break-words" dir="auto">
            {work.description}
          </p>
        )}
        {scheme === null ? null : (
          <p className="text-sm break-words" dir="auto">
            <span className="text-[color:var(--color-foreground-muted)]">
              {t('work.scheme')}:{' '}
            </span>
            {scheme}
          </p>
        )}
        {work.attribution === null ? null : (
          <p
            className="text-xs break-words text-[color:var(--color-foreground-muted)]"
            dir="auto"
          >
            {work.attribution}
          </p>
        )}
      </div>
    </Panel>
  );
}

/* ===========================================================================
 * /quran/translations, /quran/tafsir, /quran/transliteration
 * ========================================================================= */

export async function WorkListingPage({
  locale,
  availability,
  kind,
}: {
  readonly locale: Locale;
  readonly availability: QuranAvailability;
  readonly kind: WorkKind | 'transliteration';
}) {
  const t = await getTranslations({ locale, namespace: 'quran' });
  const parts = await quranTrail(locale);
  const reader = quranReadRuntime().reader;
  const [works, languages, surahs] = await Promise.all([
    kind === 'translations'
      ? reader.translations()
      : kind === 'tafsir'
        ? reader.tafsirs()
        : reader.transliterations(),
    contentLanguages(),
    readSurahs(),
  ]);
  const names = await referenceNames(
    {
      personIds: works.flatMap((work) => work.contributors.map((c) => c.personId)),
      topicIds: [],
    },
    locale,
  );
  const title = t(`sections.${kind}`);
  const first = surahs[0];
  const layer =
    kind === 'translations'
      ? 'translation'
      : kind === 'tafsir'
        ? 'tafsir'
        : 'transliteration';

  return (
    <QuranFrame
      locale={locale}
      availability={availability}
      trail={[parts.home, parts.quran, { text: title }]}
    >
      <div className="flex flex-col gap-2">
        <PageHeading>{title}</PageHeading>
        <p className="text-[color:var(--color-foreground-muted)]">
          {t(`sectionBody.${kind}`)}
        </p>
      </div>
      {works.length === 0 ? (
        <EmptyState>{t(`worksEmpty.${kind}`)}</EmptyState>
      ) : (
        <ul aria-label={title} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {works.map((work) => (
            <WorkRow
              key={work.id}
              locale={locale}
              kind={kind}
              work={work}
              languages={languages}
              names={names}
              t={t}
              scheme={'scheme' in work ? (work as PublicTransliteration).scheme : null}
            />
          ))}
        </ul>
      )}
      {kind !== 'transliteration' || first === undefined || works.length === 0 ? null : (
        <section className="flex flex-col gap-3" aria-labelledby="transliteration-read">
          <SectionHeading>
            <span id="transliteration-read">{t('work.readWith')}</span>
          </SectionHeading>
          <ul className="flex flex-col gap-2">
            {works.map((work) => (
              <li key={work.id}>
                <TextLink
                  href={withReading(surahPath(locale, first.number), {
                    ...NO_READING_CHOICE,
                    [layer]: work.slug,
                  })}
                >
                  <span dir="auto">{t('work.readWithName', { name: work.name })}</span>
                </TextLink>
              </li>
            ))}
          </ul>
        </section>
      )}
    </QuranFrame>
  );
}

/* ===========================================================================
 * /quran/translations/{slug} and /quran/tafsir/{slug}
 * ========================================================================= */

/** Every Surah, linked to the reader WITH this work chosen. */
function ReadWithSurahs({
  locale,
  surahs,
  layer,
  slug,
  t,
}: {
  readonly locale: Locale;
  readonly surahs: readonly PublicSurah[];
  readonly layer: 'translation' | 'tafsir';
  readonly slug: string;
  readonly t: QuranTranslator;
}) {
  if (surahs.length === 0) return null;
  return (
    <section className="flex flex-col gap-3" aria-labelledby="work-read">
      <SectionHeading>
        <span id="work-read">{t('work.readWith')}</span>
      </SectionHeading>
      <ol
        aria-labelledby="work-read"
        className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-4"
      >
        {surahs.map((surah) => {
          const name = surahName(surah, locale);
          return (
            <li key={surah.number} className="min-w-0 break-words">
              <TextLink
                href={withReading(surahPath(locale, surah.number), {
                  ...NO_READING_CHOICE,
                  [layer]: slug,
                })}
              >
                {t('surahName', { number: surah.number })}
                {name === null ? null : (
                  <span lang={name.locale}>{` · ${name.text}`}</span>
                )}
              </TextLink>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function WorkFacts({
  locale,
  work,
  languages,
  names,
  t,
}: {
  readonly locale: Locale;
  readonly work: PublicLayerWork;
  readonly languages: ReadonlyMap<string, ContentLanguage>;
  readonly names: Names;
  readonly t: QuranTranslator;
}) {
  return (
    <section className="flex flex-col gap-3" aria-labelledby="work-facts">
      <h2 id="work-facts" className="text-lg font-semibold">
        {t('facts')}
      </h2>
      <dl className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
        <DetailRow term={t('work.language')}>
          <LanguageName languages={languages} code={work.languageCode} />
        </DetailRow>
        <DetailRow term={t('work.published')}>
          <time dateTime={work.publishedAt.toISOString().slice(0, 10)}>
            {formatDate(work.publishedAt.toISOString().slice(0, 10), locale)}
          </time>
        </DetailRow>
        {work.attribution === null ? null : (
          <DetailRow term={t('work.attribution')}>
            <span dir="auto">{work.attribution}</span>
          </DetailRow>
        )}
      </dl>
      <Contributors locale={locale} work={work} names={names} t={t} />
    </section>
  );
}

/**
 * One Translation or Tafsir: what it is, who made it, what its source
 * attributes — and, for a Tafsir, its entries in canonical order in bounded
 * pages, each linked to the Ayah it comments on with this Tafsir chosen.
 */
export async function WorkDetailPage({
  locale,
  availability,
  kind,
  work,
  offset,
}: {
  readonly locale: Locale;
  readonly availability: QuranAvailability;
  readonly kind: WorkKind;
  readonly work: PublicLayerWork;
  readonly offset: number;
}) {
  const t = await getTranslations({ locale, namespace: 'quran' });
  const parts = await quranTrail(locale);
  const reader = quranReadRuntime().reader;
  const path =
    kind === 'translations'
      ? translationPath(locale, work.slug)
      : tafsirPath(locale, work.slug);
  const [languages, names, surahs, entries] = await Promise.all([
    contentLanguages(),
    referenceNames(
      { personIds: work.contributors.map((c) => c.personId), topicIds: [] },
      locale,
    ),
    kind === 'translations' ? readSurahs() : Promise.resolve([]),
    kind === 'tafsir' ? reader.tafsirEntryPage(work.id, offset) : Promise.resolve(null),
  ]);
  const language = languageOf(languages, work.languageCode);
  const sectionTitle = t(`sections.${kind}`);
  const trail = [
    { name: parts.home.text, path: parts.home.href },
    { name: parts.quran.text, path: parts.quran.href },
    { name: sectionTitle, path: quranPath(locale, kind) },
    { name: work.name, path },
  ];
  const links =
    entries === null ? null : pageLinks(entries.offset, QURAN_PAGE, entries.total);

  return (
    <QuranFrame
      locale={locale}
      availability={availability}
      trail={[
        ...trail.slice(0, -1).map((entry) => ({ href: entry.path, text: entry.name })),
        { text: work.name },
      ]}
    >
      <article aria-labelledby="work-heading" className="flex min-w-0 flex-col gap-8">
        <Prose>
          <h1
            id="work-heading"
            className="text-3xl font-semibold tracking-tight break-words"
            dir="auto"
          >
            {work.name}
          </h1>
          {work.description === null
            ? null
            : paragraphsOf(work.description).map((paragraph, index) => (
                <p key={index} dir="auto">
                  {paragraph}
                </p>
              ))}
        </Prose>

        <WorkFacts
          locale={locale}
          work={work}
          languages={languages}
          names={names}
          t={t}
        />

        {kind === 'translations' ? (
          <ReadWithSurahs
            locale={locale}
            surahs={surahs}
            layer="translation"
            slug={work.slug}
            t={t}
          />
        ) : null}

        {entries === null || links === null ? null : (
          <section className="flex flex-col gap-4" aria-labelledby="tafsir-entries">
            <SectionHeading>
              <span id="tafsir-entries">{t('work.entries')}</span>
            </SectionHeading>
            {entries.items.length === 0 ? (
              <EmptyState>{t('work.entriesEmpty')}</EmptyState>
            ) : (
              <ol aria-labelledby="tafsir-entries" className="flex flex-col gap-4">
                {entries.items.map((entry) => (
                  <li key={entry.id} className="flex flex-col gap-2">
                    <h3 className="font-semibold">
                      <TextLink
                        href={withReading(
                          ayahPath(locale, { surah: entry.surah, ayah: entry.startAyah }),
                          { ...NO_READING_CHOICE, tafsir: work.slug },
                        )}
                      >
                        {segmentRange(t, entry)}
                      </TextLink>
                    </h3>
                    <details className="rounded-[var(--radius-control)] border border-[color:var(--color-border)] px-4 py-2">
                      <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium">
                        {t('work.readEntry')}
                      </summary>
                      <div
                        lang={language.code}
                        dir={language.direction}
                        className="flex max-w-[var(--measure-prose)] flex-col gap-3 pb-2"
                      >
                        {paragraphsOf(entry.text).map((paragraph, index) => (
                          <p key={index} className="break-words">
                            {paragraph}
                          </p>
                        ))}
                      </div>
                    </details>
                  </li>
                ))}
              </ol>
            )}
            <Pagination
              label={t('work.entries')}
              previous={
                links.previous === null ? null : offsetPathOf(path, links.previous)
              }
              next={links.next === null ? null : offsetPathOf(path, links.next)}
              previousLabel={t('previous')}
              nextLabel={t('next')}
            />
          </section>
        )}
      </article>

      <BreadcrumbData
        contentLocales={quranIndexable(availability) ? localeSchema.options : []}
        trail={trail}
      />
    </QuranFrame>
  );
}

/* ===========================================================================
 * /quran/tajweed and /quran/tajweed/{rule}
 * ========================================================================= */

export async function TajweedListingPage({
  locale,
  availability,
}: {
  readonly locale: Locale;
  readonly availability: QuranAvailability;
}) {
  const t = await getTranslations({ locale, namespace: 'quran' });
  const parts = await quranTrail(locale);
  const [rules, languages] = await Promise.all([
    quranReadRuntime().reader.tajweedRules(),
    contentLanguages(),
  ]);
  const title = t('sections.tajweed');

  return (
    <QuranFrame
      locale={locale}
      availability={availability}
      trail={[parts.home, parts.quran, { text: title }]}
    >
      <div className="flex flex-col gap-2">
        <PageHeading>{title}</PageHeading>
        <p className="text-[color:var(--color-foreground-muted)]">
          {t('sectionBody.tajweed')}
        </p>
      </div>
      {rules.length === 0 ? (
        <EmptyState>{t('worksEmpty.tajweed')}</EmptyState>
      ) : (
        <ol aria-label={title} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {rules.map((rule) => {
            const shown = tajweedTextFor(rule, locale);
            if (shown === null) return null;
            const language = languageOf(languages, shown.text.languageCode);
            return (
              <Panel key={rule.slug} as="li">
                <h2
                  className="text-lg font-semibold break-words"
                  lang={language.code}
                  dir={language.direction}
                >
                  <TextLink href={tajweedRulePath(locale, rule.slug)}>
                    {shown.text.title}
                  </TextLink>
                </h2>
              </Panel>
            );
          })}
        </ol>
      )}
    </QuranFrame>
  );
}

export async function TajweedRulePage({
  locale,
  availability,
  rule,
}: {
  readonly locale: Locale;
  readonly availability: QuranAvailability;
  readonly rule: PublicTajweedRule;
}) {
  const t = await getTranslations({ locale, namespace: 'quran' });
  const parts = await quranTrail(locale);
  const languages = await contentLanguages();
  const shown = tajweedTextFor(rule, locale);
  const title = shown?.text.title ?? rule.slug;
  const language = languageOf(languages, shown?.text.languageCode ?? 'und');
  const path = tajweedRulePath(locale, rule.slug);
  const trail = [
    { name: parts.home.text, path: parts.home.href },
    { name: parts.quran.text, path: parts.quran.href },
    { name: t('sections.tajweed'), path: quranPath(locale, 'tajweed') },
    { name: title, path },
  ];
  const contentLocales = tajweedLocales(rule);

  return (
    <QuranFrame
      locale={locale}
      availability={availability}
      trail={[
        ...trail.slice(0, -1).map((entry) => ({ href: entry.path, text: entry.name })),
        { text: title },
      ]}
    >
      <article aria-labelledby="rule-heading" className="flex min-w-0 flex-col gap-6">
        {shown?.fallback === true ? (
          <Alert tone="info">{t('tajweedFallback', { language: language.name })}</Alert>
        ) : null}
        <div
          lang={language.code}
          dir={language.direction}
          className="flex flex-col gap-4"
        >
          <h1
            id="rule-heading"
            className="text-3xl font-semibold tracking-tight break-words"
          >
            {title}
          </h1>
          <div className="flex max-w-[var(--measure-prose)] flex-col gap-4">
            {shown === null
              ? null
              : paragraphsOf(shown.text.body).map((paragraph, index) => (
                  <p key={index} className="break-words">
                    {paragraph}
                  </p>
                ))}
          </div>
        </div>
        {rule.attribution === null ? null : (
          <p
            className="text-sm break-words text-[color:var(--color-foreground-muted)]"
            dir="auto"
          >
            {rule.attribution}
          </p>
        )}
      </article>
      <BreadcrumbData
        contentLocales={quranIndexable(availability) ? contentLocales : []}
        trail={trail}
      />
    </QuranFrame>
  );
}
