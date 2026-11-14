import 'server-only';

import { getTranslations } from 'next-intl/server';

import { localizedPath, type Locale } from '@minhaj/contracts';
import type { QuranResearchItem } from '@minhaj/contracts/library';
import { CONTRIBUTION_ROLES, type ContributionRole } from '@minhaj/contracts/people';
import type { QuranAvailability } from '@minhaj/contracts/quran';

import {
  libraryContentLanguages,
  libraryReadRuntime,
  libraryReferenceNames,
  type ContentLanguage,
} from '@/composition/library-read';
import {
  doiHref,
  scholarlyLabel,
  scholarlyListPath,
  scholarlyPath,
} from '@/components/library/scholarly-presentation';
import {
  Badge,
  EmptyState,
  Field,
  Icon,
  LinkTabs,
  Pager,
  SectionHeader,
  Select,
} from '@/components/ui';
import { directionOf } from '@/config/locale';
import { ActiveFilters, ExploreFilters, ExploreHero, languageName } from './explore';
import { QuranFrame, quranTrail } from './parts';
import { quranPath } from './presentation';
import { readQuranTopic } from './read';
import {
  KIND_WORDS,
  RESEARCH_PATH,
  byDecade,
  excerptOf,
  researchFiltered,
  researchHref,
  researchPageCount,
  researchRange,
  researchReadQuery,
  type ResearchQuery,
} from './research-view';

/**
 * THE QURAN RESEARCH HUB (Quran Part 12) — `/quran/research`.
 *
 * LAYER-4 COMPOSITION OF LIBRARY'S OWN PUBLIC READS (DOMAIN_MODEL.md §3.1,
 * §10.2): the research is Library's — the public Research and ResearchPaper
 * records on Taxonomy's `quran` Topic — read through Library's public
 * `quranResearch` and `quranResearchFacets`; the names of their contributors
 * are People's, the content languages' directions Taxonomy's. Quran imports
 * nothing of Library; only this presentation layer composes them.
 *
 * READ MODE: SCHOLARLY, PRECISE, CALM. A record is a catalogue entry, not a
 * poster: its kind, content language and date; its title in its own language,
 * linked to Library's canonical address; its authors; where it appeared or the
 * institution it comes from; the opening of its abstract in the abstract's own
 * language and direction; and, below, the way to its full text, its DOI and how
 * many works it cites. In the chronological orders the list reads as a
 * timeline, grouped by decade. No record carries a Quran passage, so there are
 * no Surah links — nothing is stated that Library did not answer.
 *
 * ONE ADDRESS PER VIEW (`./research-view`): a kind, a content language, an
 * author, a decade, "full text on the platform", an order and a page, each a
 * GET parameter, so the hub works without script and every view can be shared.
 */

type QuranTranslator = Awaited<ReturnType<typeof getTranslations<'quran'>>>;
type Names = Awaited<ReturnType<typeof libraryReferenceNames>>;

const LIST_ID = 'quran-research-list';

function isRole(role: string): role is ContributionRole {
  return (CONTRIBUTION_ROLES as readonly string[]).includes(role);
}

/** A year as written in the interface's numerals, never grouped ("2021", not "2,021"). */
function yearText(year: number, locale: Locale): string {
  return new Intl.NumberFormat(locale, { useGrouping: false }).format(year);
}

/** A decade's name: "1990s"; or the undated group's. */
function decadeText(decade: number | null, locale: Locale, t: QuranTranslator): string {
  return decade === null
    ? t('researchHub.undated')
    : t('researchHub.decade', { decade: yearText(decade, locale) });
}

/** The People credited on a record, as one line; a role other than author is named. */
function creditLine(item: QuranResearchItem, names: Names, t: QuranTranslator): string {
  return item.contributors
    .flatMap((entry) => {
      const person = names.people.get(entry.personId);
      if (person === undefined) return [];
      return [
        entry.role === 'author' || !isRole(entry.role)
          ? person.name
          : t('booksHub.credit', {
              name: person.name,
              role: t(`booksHub.roles.${entry.role}`),
            }),
      ];
    })
    .join(' · ');
}

/** The record's date: the day when it is known (a date, never shifted by a zone), else the year. */
function dateOf(
  item: QuranResearchItem,
  locale: Locale,
): { readonly text: string; readonly machine: string } | null {
  if (item.publishedOn !== null)
    return {
      text: new Intl.DateTimeFormat(locale, {
        dateStyle: 'long',
        timeZone: 'UTC',
      }).format(new Date(`${item.publishedOn}T00:00:00Z`)),
      machine: item.publishedOn,
    };
  if (item.publicationYear !== null)
    return {
      text: yearText(item.publicationYear, locale),
      machine: String(item.publicationYear).padStart(4, '0'),
    };
  return null;
}

/**
 * ONE RECORD, as a catalogue entry. The title is the record's one link to its
 * page; the actions beneath — the full text or the details, the DOI — are
 * links of their own, never overlapping it.
 */
function ResearchEntry({
  locale,
  item,
  names,
  languages,
  heading,
  t,
}: {
  readonly locale: Locale;
  readonly item: QuranResearchItem;
  readonly names: Names;
  readonly languages: ReadonlyMap<string, ContentLanguage>;
  readonly heading: 'h3' | 'h4';
  readonly t: QuranTranslator;
}) {
  const label = scholarlyLabel(item, locale);
  const title = { lang: label.locale, dir: directionOf(label.locale) };
  const href = scholarlyPath(locale, item.kind, item.slug);
  const credits = creditLine(item, names, t);
  const date = dateOf(item, locale);
  const abstract = excerptOf(item.abstract);
  const summary = abstract === null ? excerptOf(label.summary) : null;
  const contentDirection = languages.get(item.languageCode)?.direction ?? 'ltr';
  const Heading = heading;

  return (
    <li className="flex min-w-0 flex-col gap-3 rounded-panel border border-border bg-surface-raised p-4 sm:p-6">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-foreground-muted">
        <Badge>{t(`researchHub.kind.${item.kind}`)}</Badge>
        <span>{languageName(item.languageCode, locale)}</span>
        {date === null ? null : (
          <>
            <span aria-hidden="true">·</span>
            <time dateTime={date.machine}>{date.text}</time>
          </>
        )}
      </p>
      <div className="flex min-w-0 flex-col gap-1.5">
        <Heading
          className="font-serif text-subheading font-semibold text-balance wrap-anywhere"
          {...title}
        >
          <a
            href={href}
            className="text-foreground underline decoration-accent-rule decoration-1 underline-offset-4 hover:decoration-accent active:text-action"
          >
            {label.title}
          </a>
        </Heading>
        {credits === '' ? null : (
          <p className="text-sm font-medium wrap-anywhere text-foreground" dir="auto">
            {credits}
          </p>
        )}
        {item.venue === null ? null : (
          <p className="text-sm wrap-anywhere text-foreground-muted">
            {t('researchHub.venue')} <bdi className="italic">{item.venue}</bdi>
          </p>
        )}
        {item.institutionalContext === null ? null : (
          <p className="text-sm wrap-anywhere text-foreground-muted" dir="auto">
            {item.institutionalContext}
          </p>
        )}
      </div>
      {abstract === null && summary === null ? null : (
        <p
          className="max-w-[var(--measure-prose)] border-s-2 border-accent-rule ps-4 text-sm leading-relaxed wrap-anywhere text-foreground-muted"
          {...(abstract === null
            ? title
            : { lang: item.languageCode, dir: contentDirection })}
        >
          {abstract ?? summary}
        </p>
      )}
      <ul className="flex flex-wrap items-center gap-x-6 gap-y-1 border-t border-border pt-2 text-sm">
        <li>
          <a
            href={href}
            aria-label={t(
              item.readable ? 'researchHub.readFullNamed' : 'researchHub.detailsNamed',
              { title: label.title },
            )}
            className="inline-flex min-h-11 items-center gap-1.5 font-semibold text-action underline-offset-4 hover:underline"
          >
            {t(item.readable ? 'researchHub.readFull' : 'researchHub.details')}
            <Icon name="arrow-end" size={16} />
          </a>
        </li>
        {item.doi === null ? null : (
          <li className="min-w-0">
            <a
              href={doiHref(item.doi)}
              rel="noopener noreferrer"
              className="inline-flex min-h-11 max-w-full items-center gap-1.5 text-action underline-offset-4 hover:underline"
            >
              <span className="font-semibold">{t('researchHub.doi')}</span>
              <bdi dir="ltr" className="min-w-0 wrap-anywhere">
                {item.doi}
              </bdi>
              <Icon name="external" size={16} className="shrink-0" />
            </a>
          </li>
        )}
        {item.citations === 0 ? null : (
          <li className="inline-flex min-h-11 items-center text-foreground-muted">
            {t('researchHub.citations', { count: item.citations })}
          </li>
        )}
      </ul>
    </li>
  );
}

export async function QuranResearchPage({
  locale,
  availability,
  query,
}: {
  readonly locale: Locale;
  readonly availability: QuranAvailability;
  readonly query: ResearchQuery;
}) {
  const t = await getTranslations({ locale, namespace: 'quran' });
  const parts = await quranTrail(locale);
  const topic = await readQuranTopic(locale);
  const library = libraryReadRuntime();
  const read = researchReadQuery(query, topic?.id ?? null, locale);
  const [page, facets, languages] = await Promise.all([
    library.quranResearch(read),
    library.quranResearchFacets(read),
    libraryContentLanguages(),
  ]);
  const names = await libraryReferenceNames(
    {
      personIds: [
        ...page.items.flatMap((item) => item.contributors.map((entry) => entry.personId)),
        ...facets.contributors.items.map((facet) => facet.id),
        ...(query.contributor === null ? [] : [query.contributor]),
      ],
      topicIds: [],
    },
    locale,
  );

  const title = t('sections.research');
  const hub = facets.hub;
  const filtered = researchFiltered(query);
  const base = researchHref(locale, query, {
    kind: 'all',
    language: null,
    contributor: null,
    decade: null,
    fullText: false,
  });
  const pages = researchPageCount(page.total);
  const range = researchRange(query.page, page.items.length);

  const contributorOptions = facets.contributors.items.flatMap((facet) => {
    const person = names.people.get(facet.id);
    return person === undefined
      ? []
      : [{ id: facet.id, name: person.name, records: facet.records }];
  });
  const showLanguage = facets.languages.items.length > 1 || query.language !== null;
  const showContributor = contributorOptions.length > 0 || query.contributor !== null;
  const showDecade = facets.decades.length > 1 || query.decade !== null;
  const showFullText = (hub.readable > 0 && hub.readable < hub.records) || query.fullText;
  const showKinds = (hub.research > 0 && hub.papers > 0) || query.kind !== 'all';
  const contributorName =
    query.contributor === null
      ? null
      : (names.people.get(query.contributor)?.name ?? null);
  const span =
    hub.earliest === null || hub.latest === null
      ? null
      : hub.earliest === hub.latest
        ? yearText(hub.earliest, locale)
        : t('researchHub.span', {
            from: yearText(hub.earliest, locale),
            to: yearText(hub.latest, locale),
          });

  const active = [
    ...(query.language === null
      ? []
      : [
          {
            key: 'language',
            text: languageName(query.language, locale),
            removeHref: researchHref(locale, query, { language: null }),
          },
        ]),
    ...(query.contributor === null
      ? []
      : [
          {
            key: 'contributor',
            text: contributorName ?? t('booksHub.unknownContributor'),
            removeHref: researchHref(locale, query, { contributor: null }),
          },
        ]),
    ...(query.decade === null
      ? []
      : [
          {
            key: 'decade',
            text: decadeText(query.decade, locale, t),
            removeHref: researchHref(locale, query, { decade: null }),
          },
        ]),
    ...(query.fullText
      ? [
          {
            key: 'fulltext',
            text: t('researchHub.fullTextOnly'),
            removeHref: researchHref(locale, query, { fullText: false }),
          },
        ]
      : []),
  ].map((filter) => ({
    ...filter,
    removeLabel: t('booksHub.remove', { name: filter.text }),
  }));

  // In the chronological orders the page reads as a timeline, by decade.
  const chronological = query.sort !== 'title';
  const groups = chronological
    ? byDecade(page.items)
    : [{ decade: null, items: page.items }];

  return (
    <QuranFrame
      locale={locale}
      availability={availability}
      trail={[parts.home, parts.quran, { text: title }]}
    >
      <ExploreHero
        eyebrow={t('researchHub.eyebrow')}
        title={title}
        lede={t('researchHub.lede')}
        stats={[
          ...(hub.records === 0
            ? []
            : [
                {
                  value: hub.records,
                  label: t('researchHub.statRecords', { count: hub.records }),
                  href: `#${LIST_ID}`,
                },
              ]),
          ...(hub.research === 0 || hub.papers === 0
            ? []
            : [
                {
                  value: hub.papers,
                  label: t('researchHub.statPapers', { count: hub.papers }),
                  href: researchHref(locale, query, {
                    kind: 'research-paper',
                    language: null,
                    contributor: null,
                    decade: null,
                    fullText: false,
                  }),
                },
              ]),
          ...(hub.readable === 0
            ? []
            : [
                {
                  value: hub.readable,
                  label: t('researchHub.statReadable', { count: hub.readable }),
                  href: researchHref(locale, query, {
                    kind: 'all',
                    language: null,
                    contributor: null,
                    decade: null,
                    fullText: true,
                  }),
                },
              ]),
          ...(hub.contributors === 0
            ? []
            : [
                {
                  value: hub.contributors,
                  label: t('researchHub.statContributors', { count: hub.contributors }),
                },
              ]),
          ...(hub.languages < 2
            ? []
            : [
                {
                  value: hub.languages,
                  label: t('booksHub.statLanguages', { count: hub.languages }),
                },
              ]),
          ...(span === null ? [] : [{ value: span, label: t('researchHub.statSpan') }]),
        ]}
        actions={[
          { href: quranPath(locale, 'tafsir'), text: t('booksHub.tafsirLink') },
          { href: quranPath(locale, 'books'), text: t('sections.books') },
        ]}
      />

      {hub.records === 0 ? (
        <EmptyState
          icon="book"
          title={t('researchHub.emptyTitle')}
          action={{
            href: scholarlyListPath(locale, 'research'),
            text: t('researchHub.libraryResearch'),
          }}
        >
          {t('researchHub.empty')}
        </EmptyState>
      ) : (
        <section aria-labelledby={LIST_ID} className="flex flex-col gap-5">
          <SectionHeader
            id={LIST_ID}
            heading={t('researchHub.listHeading')}
            intro={t(`researchHub.kindHelp.${query.kind}`)}
          />

          {showKinds ? (
            <LinkTabs
              label={t('researchHub.kinds')}
              tabs={(['all', 'research', 'research-paper'] as const).map((kind) => ({
                href: researchHref(locale, query, { kind }),
                text: t(`researchHub.tab.${kind}`),
                current: query.kind === kind,
                count: String(
                  kind === 'all'
                    ? facets.kinds.all
                    : kind === 'research'
                      ? facets.kinds.research
                      : facets.kinds.papers,
                ),
              }))}
            />
          ) : null}

          <ExploreFilters
            action={localizedPath(locale, RESEARCH_PATH)}
            label={t('researchHub.filters')}
            hidden={
              query.kind === 'all'
                ? []
                : [{ name: 'kind', value: KIND_WORDS[query.kind] }]
            }
            submit={t('researchHub.apply')}
            reset={filtered ? { href: base, text: t('booksHub.reset') } : null}
          >
            {showLanguage ? (
              <Field id="research-language" label={t('booksHub.filterLanguage')}>
                {(props) => (
                  <Select {...props} name="language" defaultValue={query.language ?? ''}>
                    <option value="">{t('booksHub.anyLanguage')}</option>
                    {facets.languages.items.map((facet) => (
                      <option key={facet.id} value={facet.id}>
                        {t('booksHub.option', {
                          name: languageName(facet.id, locale),
                          count: facet.records,
                        })}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            ) : null}
            {showContributor ? (
              <Field id="research-contributor" label={t('booksHub.filterContributor')}>
                {(props) => (
                  <Select
                    {...props}
                    name="contributor"
                    defaultValue={query.contributor ?? ''}
                  >
                    <option value="">{t('booksHub.anyContributor')}</option>
                    {contributorOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {t('booksHub.option', {
                          name: option.name,
                          count: option.records,
                        })}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            ) : null}
            {showDecade ? (
              <Field id="research-decade" label={t('researchHub.filterDecade')}>
                {(props) => (
                  <Select
                    {...props}
                    name="decade"
                    defaultValue={query.decade === null ? '' : String(query.decade)}
                  >
                    <option value="">{t('researchHub.anyDecade')}</option>
                    {facets.decades.map((row) => (
                      <option key={row.decade} value={String(row.decade)}>
                        {t('booksHub.option', {
                          name: decadeText(row.decade, locale, t),
                          count: row.records,
                        })}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            ) : null}
            {showFullText ? (
              <Field id="research-fulltext" label={t('researchHub.filterFullText')}>
                {(props) => (
                  <Select
                    {...props}
                    name="fulltext"
                    defaultValue={query.fullText ? '1' : ''}
                  >
                    <option value="">{t('researchHub.anyText')}</option>
                    <option value="1">
                      {t('booksHub.option', {
                        name: t('researchHub.fullTextOnly'),
                        count: facets.readable,
                      })}
                    </option>
                  </Select>
                )}
              </Field>
            ) : null}
            <Field id="research-sort" label={t('booksHub.filterSort')}>
              {(props) => (
                <Select {...props} name="sort" defaultValue={query.sort}>
                  <option value="newest">{t('booksHub.sort.newest')}</option>
                  <option value="oldest">{t('researchHub.sortOldest')}</option>
                  <option value="title">{t('booksHub.sort.title')}</option>
                </Select>
              )}
            </Field>
          </ExploreFilters>

          <ActiveFilters label={t('booksHub.active')} filters={active} />

          {range === null ? null : (
            <p className="text-sm text-foreground-muted">
              {t('researchHub.summary', {
                from: range.from,
                to: range.to,
                total: page.total,
              })}
            </p>
          )}

          {page.items.length === 0 ? (
            query.page > 1 && page.total > 0 ? (
              <EmptyState
                title={t('booksHub.pastEndTitle')}
                action={{
                  href: researchHref(locale, query, { page: 1 }),
                  text: t('booksHub.firstPage'),
                }}
              >
                {t('researchHub.pastEnd', { page: query.page })}
              </EmptyState>
            ) : (
              <EmptyState
                title={t('researchHub.noResultsTitle')}
                action={{ href: base, text: t('booksHub.reset') }}
              >
                {t('researchHub.noResults')}
              </EmptyState>
            )
          ) : chronological ? (
            <div className="flex flex-col gap-8">
              {groups.map((group, index) => {
                const id = `quran-research-decade-${String(index)}`;
                const name = decadeText(group.decade, locale, t);
                return (
                  <section
                    key={id}
                    aria-labelledby={id}
                    className="grid grid-cols-1 gap-3 md:grid-cols-[8rem_minmax(0,1fr)] md:gap-6"
                  >
                    <h3
                      id={id}
                      className="font-serif text-heading font-semibold text-accent tabular-nums md:sticky md:top-24 md:self-start md:pt-4"
                    >
                      {name}
                    </h3>
                    <ul aria-label={name} className="flex min-w-0 flex-col gap-4">
                      {group.items.map((item) => (
                        <ResearchEntry
                          key={`${item.kind}:${item.id}`}
                          locale={locale}
                          item={item}
                          names={names}
                          languages={languages}
                          heading="h4"
                          t={t}
                        />
                      ))}
                    </ul>
                  </section>
                );
              })}
            </div>
          ) : (
            <ul aria-label={title} className="flex min-w-0 flex-col gap-4">
              {page.items.map((item) => (
                <ResearchEntry
                  key={`${item.kind}:${item.id}`}
                  locale={locale}
                  item={item}
                  names={names}
                  languages={languages}
                  heading="h3"
                  t={t}
                />
              ))}
            </ul>
          )}

          {page.items.length === 0 ? null : (
            <Pager
              label={t('researchHub.pages')}
              previous={
                query.page > 1
                  ? researchHref(locale, query, { page: query.page - 1 })
                  : null
              }
              next={
                page.hasMore
                  ? researchHref(locale, query, { page: query.page + 1 })
                  : null
              }
              previousLabel={t('previous')}
              nextLabel={t('next')}
              pages={{
                current: query.page,
                total: pages,
                href: (number) => researchHref(locale, query, { page: number }),
                label: (number) => t('booksHub.pageLabel', { page: number }),
                format: (number) => new Intl.NumberFormat(locale).format(number),
              }}
            />
          )}
        </section>
      )}

      <div className="flex flex-col gap-3 border-t border-border pt-4">
        <p className="max-w-[var(--measure-prose)] text-sm text-foreground-muted">
          {t('researchHub.about')}
        </p>
        <ul className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
          {(['research', 'research-paper'] as const).map((kind) => (
            <li key={kind}>
              <a
                href={`${scholarlyListPath(locale, kind)}${
                  topic === null ? '' : `?topic=${encodeURIComponent(topic.id)}`
                }`}
                className="inline-flex min-h-11 items-center gap-1.5 font-semibold text-action underline-offset-4 hover:underline"
              >
                {t(
                  kind === 'research'
                    ? 'researchHub.libraryResearch'
                    : 'researchHub.libraryPapers',
                )}
                <Icon name="arrow-end" size={16} />
              </a>
            </li>
          ))}
        </ul>
      </div>
    </QuranFrame>
  );
}
