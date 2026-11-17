import 'server-only';

import { getTranslations } from 'next-intl/server';

import { localizedPath, type Locale } from '@minhaj/contracts';
import { MEDIA_GROUP_FACETS_MAX } from '@minhaj/contracts/media';

import { mediaReadRuntime } from '@/composition/media-read';
import { contributorCards, contributorNames } from '@/composition/public-references';
import { ClosingNote, RangeSummary } from '@/components/library/browse-parts';
import { PersonMark } from '@/components/people/portrait';
import { caseless, pageCount, pageRange } from '@/components/topic-hub/address';
import {
  ActiveFilters,
  ExploreFilters,
  ExploreHero,
  languageName,
  LetterIndex,
} from '@/components/topic-hub/parts';
import { watchVideosHref } from '@/components/topic-hub/videos-view';
import {
  Breadcrumbs,
  Container,
  EmptyState,
  Field,
  Icon,
  Pager,
  SectionHeader,
  Select,
  TextInput,
} from '@/components/ui';
import { directionOf } from '@/config/locale';
import {
  DEFAULT_SPEAKERS_VIEW,
  SPEAKERS_PAGE,
  SPEAKERS_PATH,
  sortSpeakers,
  speakerMatches,
  speakerRow,
  speakersHref,
  type SpeakersView,
} from './groups-view';
import { mediaLabel } from './presentation';

/**
 * `/watch/speakers` — THE SPEAKERS' DIRECTORY (Watch Part 2; ROUTE_MAP.md
 * §3.7): everyone named as a speaker on a published Video, from Media's
 * directory read (`speakerDirectory`: their Videos, languages and published
 * Series), named by People — the owner of a Person — in bounded batches and
 * ordered by name in the reader's locale, as Library Part 2's authors are. A
 * Person People does not return as published is omitted.
 *
 * A PROJECTION OF PEOPLE, NEVER A SECOND SPEAKER RECORD. Each name opens the
 * ONE canonical profile (`/people/{slug}`; `/watch/speakers/{slug}` 301s
 * there), and each count opens the Videos listing filtered by the Person
 * (`watchVideosHref`). A first letter, a content language and a name search
 * (every word; accents, vowel marks and the tatweel ignored) narrow it, each
 * counted under the others; 48 a page. Signed out, always.
 */
export async function SpeakerDirectoryPage({
  locale,
  view,
}: {
  readonly locale: Locale;
  readonly view: SpeakersView;
}) {
  const [t, hub, shell] = await Promise.all([
    getTranslations({ locale, namespace: 'watch' }),
    getTranslations({ locale, namespace: 'topicHub' }),
    getTranslations({ locale, namespace: 'shell' }),
  ]);
  const directory = await mediaReadRuntime().speakerDirectory();
  const named = caseless(
    await contributorNames(
      directory.items.map((entry) => entry.personId),
      locale,
    ),
  );
  const collator = new Intl.Collator(locale, { sensitivity: 'base', numeric: true });
  const everyone = directory.items.flatMap((entry) => {
    const person = named.get(entry.personId.toLowerCase());
    return person === undefined ? [] : [speakerRow(entry, person, locale)];
  });

  const letterCounts = new Map<string, number>();
  for (const row of everyone.filter((entry) => speakerMatches(entry, view, 'letter')))
    letterCounts.set(row.letter, (letterCounts.get(row.letter) ?? 0) + 1);
  const letters = [...letterCounts.keys()].sort((a, b) =>
    a === '#' ? 1 : b === '#' ? -1 : collator.compare(a, b),
  );
  const languageCounts = new Map<string, number>();
  for (const row of everyone.filter((entry) => speakerMatches(entry, view, 'language')))
    for (const value of row.entry.languages)
      languageCounts.set(value.id, (languageCounts.get(value.id) ?? 0) + 1);
  const languageOptions = [...languageCounts]
    .map(([id, count]) => ({ id, count }))
    .sort((a, b) => b.count - a.count || (a.id < b.id ? -1 : 1));

  const shown = sortSpeakers(
    everyone.filter((entry) => speakerMatches(entry, view)),
    view.sort,
    collator,
  );
  const pages = pageCount(shown.length, SPEAKERS_PAGE);
  const slice = shown.slice((view.page - 1) * SPEAKERS_PAGE, view.page * SPEAKERS_PAGE);
  const range = pageRange(view.page, slice.length, SPEAKERS_PAGE);
  const cards = caseless(
    await contributorCards(
      slice.map((row) => row.entry.personId),
      locale,
    ),
  );
  const seriesOf = new Map(
    directory.series.map((series) => [series.id.toLowerCase(), series]),
  );

  const href = (change: Partial<SpeakersView>) =>
    speakersHref(locale, view, { page: 1, ...change });
  const base = speakersHref(locale, { ...DEFAULT_SPEAKERS_VIEW, sort: view.sort });
  const filtered = view.letter !== null || view.language !== null || view.q !== null;
  const number = (value: number) => new Intl.NumberFormat(locale).format(value);
  const letterText = (letter: string) =>
    letter === '#' ? t('speakerDirectory.letterOther') : letter;
  // A distinct count of languages is stated only while no speaker reached the
  // read's per-speaker bound, so it is never smaller than the truth.
  const languages = everyone.some(
    (row) => row.entry.languages.length >= MEDIA_GROUP_FACETS_MAX,
  )
    ? 0
    : new Set(everyone.flatMap((row) => row.entry.languages.map((value) => value.id)))
        .size;
  const inSeries = everyone.filter((row) => row.entry.seriesTotal > 0).length;
  const title = t('sections.speakers');
  const listId = 'watch-speakers-list';

  const chip = (key: string, text: string, removeHref: string) => ({
    key,
    text,
    removeHref,
    removeLabel: hub('common.remove', { name: text }),
  });

  return (
    <Container>
      <div className="flex min-w-0 flex-col gap-8 pt-6 pb-[var(--space-section)]">
        <Breadcrumbs
          label={shell('nav.breadcrumbs')}
          trail={[
            { href: localizedPath(locale, ''), text: shell('nav.home') },
            { href: localizedPath(locale, '/watch'), text: t('title') },
            { text: title },
          ]}
        />
        <ExploreHero
          eyebrow={t('title')}
          title={title}
          lede={t('speakerDirectory.lede')}
          notice={t('speakerDirectory.notice')}
          stats={[
            ...(everyone.length === 0
              ? []
              : [
                  {
                    value: number(everyone.length),
                    label: t('speakerDirectory.stat', { count: everyone.length }),
                    href: `#${listId}`,
                  },
                ]),
            ...(inSeries === 0
              ? []
              : [
                  {
                    value: number(inSeries),
                    label: t('speakerDirectory.statInSeries', { count: inSeries }),
                  },
                ]),
            ...(languages < 2
              ? []
              : [
                  {
                    value: number(languages),
                    label: hub('common.statLanguages', { count: languages }),
                  },
                ]),
          ]}
          actions={[
            { href: watchVideosHref(locale), text: t('allVideos') },
            { href: localizedPath(locale, '/watch/series'), text: t('sections.series') },
            {
              href: localizedPath(locale, '/watch/programs'),
              text: t('sections.programs'),
            },
          ]}
        />

        {everyone.length === 0 ? (
          <EmptyState
            icon="user"
            title={t('speakerDirectory.emptyTitle')}
            action={{ href: localizedPath(locale, '/watch'), text: t('homeLink') }}
          >
            {t('speakersEmpty')}
          </EmptyState>
        ) : (
          <section aria-labelledby={listId} className="flex flex-col gap-5">
            <SectionHeader
              id={listId}
              heading={t('speakerDirectory.listHeading')}
              intro={t('speakerDirectory.listIntro')}
            />

            <ExploreFilters
              action={localizedPath(locale, SPEAKERS_PATH)}
              label={t('speakerDirectory.filters')}
              hidden={
                view.letter === null ? [] : [{ name: 'letter', value: view.letter }]
              }
              submit={t('speakerDirectory.apply')}
              reset={filtered ? { href: base, text: hub('common.reset') } : null}
            >
              <Field
                id="speakers-q"
                label={t('speakerDirectory.search')}
                help={t('speakerDirectory.searchHelp')}
              >
                {(props) => (
                  <TextInput
                    {...props}
                    type="search"
                    name="q"
                    maxLength={60}
                    defaultValue={view.q ?? ''}
                    autoComplete="off"
                  />
                )}
              </Field>
              {languageOptions.length > 1 || view.language !== null ? (
                <Field id="speakers-language" label={t('speakerDirectory.speaksIn')}>
                  {(props) => (
                    <Select {...props} name="language" defaultValue={view.language ?? ''}>
                      <option value="">{hub('common.anyLanguage')}</option>
                      {languageOptions.map((option) => (
                        <option key={option.id} value={option.id}>
                          {hub('common.option', {
                            name: languageName(option.id, locale),
                            count: option.count,
                          })}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              ) : null}
              <Field id="speakers-sort" label={hub('common.filterSort')}>
                {(props) => (
                  <Select {...props} name="sort" defaultValue={view.sort}>
                    <option value="name">{t('speakerDirectory.sort.name')}</option>
                    <option value="videos">{t('speakerDirectory.sort.videos')}</option>
                  </Select>
                )}
              </Field>
            </ExploreFilters>

            {letters.length < 2 && view.letter === null ? null : (
              <LetterIndex
                label={t('speakerDirectory.letters')}
                all={{
                  text: t('speakerDirectory.allLetters'),
                  href: href({ letter: null }),
                  current: view.letter === null,
                }}
                letters={letters.map((letter) => ({
                  key: letter,
                  text: letterText(letter),
                  label: t('speakerDirectory.letterLabel', {
                    letter: letterText(letter),
                    count: letterCounts.get(letter) ?? 0,
                  }),
                  href: href({ letter }),
                  current: view.letter === letter,
                }))}
              />
            )}

            <ActiveFilters
              label={hub('common.active')}
              filters={[
                ...(view.letter === null
                  ? []
                  : [
                      chip(
                        'letter',
                        t('speakerDirectory.chipLetter', {
                          letter: letterText(view.letter),
                        }),
                        href({ letter: null }),
                      ),
                    ]),
                ...(view.language === null
                  ? []
                  : [
                      chip(
                        'language',
                        languageName(view.language, locale),
                        href({ language: null }),
                      ),
                    ]),
                ...(view.q === null
                  ? []
                  : [
                      chip(
                        'q',
                        t('speakerDirectory.chipName', { q: view.q }),
                        href({ q: null }),
                      ),
                    ]),
              ]}
            />

            {range === null ? null : (
              <RangeSummary>
                {t('speakerDirectory.summary', {
                  from: number(range.from),
                  to: number(range.to),
                  total: shown.length,
                })}
              </RangeSummary>
            )}

            {slice.length === 0 ? (
              view.page > 1 && shown.length > 0 ? (
                <EmptyState
                  title={hub('common.pastEndTitle')}
                  action={{ href: href({}), text: hub('common.firstPage') }}
                >
                  {t('speakerDirectory.pastEnd', { page: view.page })}
                </EmptyState>
              ) : (
                <EmptyState
                  title={t('speakerDirectory.noResultsTitle')}
                  action={{ href: base, text: hub('common.reset') }}
                >
                  {t('speakerDirectory.noResults')}
                </EmptyState>
              )
            ) : (
              <ul
                aria-label={title}
                className="grid list-none grid-cols-1 gap-4 p-0 *:min-w-0 sm:grid-cols-2 xl:grid-cols-3"
              >
                {slice.map((row) => {
                  const card = cards.get(row.entry.personId.toLowerCase());
                  const name = card?.name ?? row.name;
                  const nameLocale = card?.resolvedLocale ?? null;
                  const own =
                    nameLocale === null
                      ? { dir: 'auto' as const }
                      : { lang: nameLocale, dir: directionOf(nameLocale) };
                  const series = row.entry.series.flatMap((value) => {
                    const found = seriesOf.get(value.id.toLowerCase());
                    return found === undefined ? [] : [mediaLabel(found, locale)];
                  });
                  const more = row.entry.seriesTotal - Math.min(series.length, 2);
                  return (
                    <li
                      key={row.entry.personId}
                      className="flex min-w-0 flex-col gap-4 rounded-panel border border-border bg-surface-raised p-5"
                    >
                      <div className="flex min-w-0 items-center gap-4">
                        <PersonMark
                          personId={row.entry.personId}
                          portrait={card?.portrait ?? null}
                          letter={row.letter}
                          own={own}
                        />
                        <h3
                          className="min-w-0 text-subheading font-semibold wrap-anywhere"
                          {...own}
                        >
                          <a
                            href={localizedPath(
                              locale,
                              `/people/${encodeURIComponent(row.slug)}`,
                            )}
                            className="text-foreground no-underline decoration-accent-rule underline-offset-4 hover:underline"
                          >
                            {name}
                          </a>
                        </h3>
                      </div>
                      <dl className="flex flex-col gap-1.5 text-sm">
                        {series.length === 0 ? null : (
                          <div className="flex min-w-0 flex-wrap gap-x-1.5">
                            <dt className="text-foreground-muted">
                              {t('speakerDirectory.inSeries')}
                            </dt>
                            <dd className="min-w-0 wrap-anywhere">
                              {series.slice(0, 2).map((label, index) => (
                                <span key={index}>
                                  {index === 0 ? null : ' · '}
                                  <span
                                    lang={label.locale}
                                    dir={directionOf(label.locale)}
                                  >
                                    {label.title}
                                  </span>
                                </span>
                              ))}
                              {more > 0
                                ? ` ${t('speakerDirectory.moreSeries', { count: more })}`
                                : null}
                            </dd>
                          </div>
                        )}
                        {row.entry.languages.length === 0 ? null : (
                          <div className="flex min-w-0 flex-wrap gap-x-1.5">
                            <dt className="text-foreground-muted">
                              {t('speakerDirectory.speaksIn')}
                            </dt>
                            <dd className="min-w-0">
                              {row.entry.languages
                                .map((value) => languageName(value.id, locale))
                                .join(' · ')}
                            </dd>
                          </div>
                        )}
                      </dl>
                      <p className="mt-auto">
                        <a
                          href={watchVideosHref(locale, { speaker: row.entry.personId })}
                          className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-action underline-offset-4 hover:underline"
                        >
                          <span>
                            {t('speakerDirectory.videos', { count: row.entry.videos })}
                            <span className="sr-only">
                              {' '}
                              {t('speakerDirectory.videosWith', { name })}
                            </span>
                          </span>
                          <Icon name="arrow-end" size={16} />
                        </a>
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}

            {slice.length === 0 ? null : (
              <Pager
                label={t('speakerDirectory.pager')}
                previous={view.page > 1 ? href({ page: view.page - 1 }) : null}
                next={view.page < pages ? href({ page: view.page + 1 }) : null}
                previousLabel={t('previous')}
                nextLabel={t('next')}
                pages={{
                  current: view.page,
                  total: pages,
                  href: (page) => href({ page }),
                  label: (page) => hub('common.pageLabel', { page }),
                  format: number,
                }}
              />
            )}

            {directory.hasMore ? (
              <p className="text-sm text-foreground-muted">
                {t('speakerDirectory.truncated', { count: directory.items.length })}
              </p>
            ) : null}
          </section>
        )}

        <ClosingNote
          text={t('speakerDirectory.about')}
          links={[
            { href: localizedPath(locale, '/topics'), text: t('sections.topics') },
            { href: localizedPath(locale, '/listen'), text: t('sections.listen') },
          ]}
        />
      </div>
    </Container>
  );
}
