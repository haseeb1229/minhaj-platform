import 'server-only';

import { getTranslations } from 'next-intl/server';

import { localizedPath, type Locale } from '@minhaj/contracts';
import { CONTRIBUTION_ROLES, type ContributionRole } from '@minhaj/contracts/people';

import {
  libraryContributorCards,
  libraryContributorNames,
  libraryReadRuntime,
} from '@/composition/library-read';
import { directionOf } from '@/config/locale';
import { PersonMark } from '@/components/people/portrait';
import { libraryBooksHref } from '@/components/topic-hub/books-view';
import {
  initialOf,
  nameMatches,
  pageCount,
  pageRange,
} from '@/components/topic-hub/address';
import {
  ActiveFilters,
  ExploreFilters,
  ExploreHero,
  LetterIndex,
} from '@/components/topic-hub/parts';
import {
  EmptyState,
  Field,
  Icon,
  Pager,
  SectionHeader,
  Select,
  TextInput,
} from '@/components/ui';
import {
  AUTHORS_PAGE,
  AUTHORS_PATH,
  DEFAULT_AUTHORS_VIEW,
  authorsHref,
  type AuthorsView,
} from './browse-view';
import { BrowseFrame, ClosingNote, RangeSummary } from './browse-parts';

/**
 * `/library/authors` — THE LIBRARY'S CONTRIBUTOR DIRECTORY (Library Part 2;
 * ROUTE_MAP.md §3.6). Everyone credited on a public Work, from Library's
 * grouped read (`contributorDirectory`: the Works and the Works per role),
 * named by People — the owner of a Person (DOMAIN_MODEL.md §10.1: "Library no
 * longer owns Author") — in bounded batches, and ordered by name in the
 * reader's locale. A Person People does not return as published is omitted.
 *
 * THE VIEW IS THE ADDRESS (`./browse-view`): a first letter (`?letter`), a
 * role (`?role`) and a name search (`?q`, every word, accents and vowel signs
 * ignored), 48 a page (`?page`). Each filter's options are counted under the
 * others, so every option says what choosing it would show. One page's
 * portraits and names-in-their-own-language come from People's public cards
 * in one call; a contributor without a portrait has an initial tile.
 *
 * Each name opens the canonical People profile (`/people/{slug}` — the
 * `/library/authors/{slug}` alias still 301s there); each count opens the
 * books listing filtered by the Person (`libraryBooksHref`). Signed out,
 * always.
 */
export async function LibraryAuthorsPage({
  locale,
  view,
}: {
  readonly locale: Locale;
  readonly view: AuthorsView;
}) {
  const [t, hub, shell] = await Promise.all([
    getTranslations({ locale, namespace: 'library' }),
    getTranslations({ locale, namespace: 'topicHub' }),
    getTranslations({ locale, namespace: 'shell' }),
  ]);
  const directory = await libraryReadRuntime().contributorDirectory();
  const names = await libraryContributorNames(
    directory.items.map((entry) => entry.personId),
    locale,
  );
  const collator = new Intl.Collator(locale, { sensitivity: 'base', numeric: true });
  const everyone = directory.items
    .flatMap((entry) => {
      const person = names.get(entry.personId);
      return person === undefined
        ? []
        : [
            {
              ...entry,
              slug: person.slug,
              name: person.name,
              letter: initialOf(person.name, locale),
            },
          ];
    })
    .sort(
      (a, b) => collator.compare(a.name, b.name) || a.personId.localeCompare(b.personId),
    );

  type Person = (typeof everyone)[number];
  const byRole = (person: Person) =>
    view.role === null || person.roles.some((entry) => entry.role === view.role);
  const byLetter = (person: Person) =>
    view.letter === null || person.letter === view.letter;
  const byName = (person: Person) => view.q === null || nameMatches(person.name, view.q);

  const letterCounts = new Map<string, number>();
  for (const person of everyone.filter((entry) => byRole(entry) && byName(entry)))
    letterCounts.set(person.letter, (letterCounts.get(person.letter) ?? 0) + 1);
  const letters = [...letterCounts.keys()].sort((a, b) =>
    a === '#' ? 1 : b === '#' ? -1 : collator.compare(a, b),
  );
  const roleCounts = new Map<ContributionRole, number>();
  for (const person of everyone.filter((entry) => byLetter(entry) && byName(entry)))
    for (const entry of person.roles)
      roleCounts.set(entry.role, (roleCounts.get(entry.role) ?? 0) + 1);
  const roleOptions = CONTRIBUTION_ROLES.filter(
    (role) => (roleCounts.get(role) ?? 0) > 0,
  );

  const shown = everyone.filter(
    (entry) => byRole(entry) && byLetter(entry) && byName(entry),
  );
  const pages = pageCount(shown.length, AUTHORS_PAGE);
  const slice = shown.slice((view.page - 1) * AUTHORS_PAGE, view.page * AUTHORS_PAGE);
  const range = pageRange(view.page, slice.length, AUTHORS_PAGE);
  const cards = await libraryContributorCards(
    slice.map((entry) => entry.personId),
    locale,
  );

  const href = (change: Partial<AuthorsView>) =>
    authorsHref(locale, view, { page: 1, ...change });
  const base = authorsHref(locale, DEFAULT_AUTHORS_VIEW);
  const filtered = view.letter !== null || view.role !== null || view.q !== null;
  const number = (value: number) => new Intl.NumberFormat(locale).format(value);
  const letterText = (letter: string) =>
    letter === '#' ? t('browse.authors.letterOther') : letter;
  const roleName = (role: ContributionRole) => t(`role.${role}`);
  const holders = (role: ContributionRole) =>
    everyone.filter((entry) => entry.roles.some((held) => held.role === role)).length;
  const authors = holders('author');
  const translators = holders('translator');
  const title = t('section.authors');
  const listId = 'library-authors-list';

  return (
    <BrowseFrame
      locale={locale}
      breadcrumbLabel={shell('nav.breadcrumbs')}
      home={shell('nav.home')}
      library={t('title')}
      title={title}
    >
      <ExploreHero
        eyebrow={t('title')}
        title={title}
        lede={t('browse.authors.lede')}
        notice={t('browse.authors.notice')}
        stats={[
          ...(everyone.length === 0
            ? []
            : [
                {
                  value: everyone.length,
                  label: t('browse.authors.stat', { count: everyone.length }),
                },
              ]),
          ...(authors === 0
            ? []
            : [
                {
                  value: authors,
                  label: t('browse.authors.statAuthors', { count: authors }),
                  href: href({ role: 'author', letter: null, q: null }),
                },
              ]),
          ...(translators === 0
            ? []
            : [
                {
                  value: translators,
                  label: t('browse.authors.statTranslators', { count: translators }),
                  href: href({ role: 'translator', letter: null, q: null }),
                },
              ]),
        ]}
        actions={[
          {
            href: localizedPath(locale, '/library/books'),
            text: t('landing.browseBooks'),
          },
          { href: localizedPath(locale, '/library/topics'), text: t('section.topics') },
          {
            href: localizedPath(locale, '/library/languages'),
            text: t('section.languages'),
          },
        ]}
      />

      {everyone.length === 0 ? (
        <EmptyState
          icon="user"
          title={t('browse.authors.emptyTitle')}
          action={{
            href: localizedPath(locale, '/library/books'),
            text: t('landing.browseBooks'),
          }}
        >
          {t('browse.authors.empty')}
        </EmptyState>
      ) : (
        <section aria-labelledby={listId} className="flex flex-col gap-5">
          <SectionHeader
            id={listId}
            heading={t('browse.authors.listHeading')}
            intro={t('browse.authors.listIntro')}
          />

          <ExploreFilters
            action={localizedPath(locale, AUTHORS_PATH)}
            label={t('browse.authors.filters')}
            hidden={view.letter === null ? [] : [{ name: 'letter', value: view.letter }]}
            submit={t('browse.authors.apply')}
            reset={filtered ? { href: base, text: hub('common.reset') } : null}
          >
            <Field
              id="authors-q"
              label={t('browse.authors.search')}
              help={t('browse.authors.searchHelp')}
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
            {roleOptions.length === 0 && view.role === null ? null : (
              <Field id="authors-role" label={t('browse.authors.role')}>
                {(props) => (
                  <Select {...props} name="role" defaultValue={view.role ?? ''}>
                    <option value="">{t('browse.authors.anyRole')}</option>
                    {roleOptions.map((role) => (
                      <option key={role} value={role}>
                        {hub('common.option', {
                          name: roleName(role),
                          count: roleCounts.get(role) ?? 0,
                        })}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            )}
          </ExploreFilters>

          {letters.length < 2 && view.letter === null ? null : (
            <LetterIndex
              label={t('browse.authors.letters')}
              all={{
                text: t('browse.authors.allLetters'),
                href: href({ letter: null }),
                current: view.letter === null,
              }}
              letters={letters.map((letter) => ({
                key: letter,
                text: letterText(letter),
                label: t('browse.authors.letterLabel', {
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
                    {
                      key: 'letter',
                      text: t('browse.authors.chipLetter', {
                        letter: letterText(view.letter),
                      }),
                      removeHref: href({ letter: null }),
                      removeLabel: hub('common.remove', {
                        name: t('browse.authors.chipLetter', {
                          letter: letterText(view.letter),
                        }),
                      }),
                    },
                  ]),
              ...(view.role === null
                ? []
                : [
                    {
                      key: 'role',
                      text: roleName(view.role),
                      removeHref: href({ role: null }),
                      removeLabel: hub('common.remove', { name: roleName(view.role) }),
                    },
                  ]),
              ...(view.q === null
                ? []
                : [
                    {
                      key: 'q',
                      text: t('browse.authors.chipName', { q: view.q }),
                      removeHref: href({ q: null }),
                      removeLabel: hub('common.remove', {
                        name: t('browse.authors.chipName', { q: view.q }),
                      }),
                    },
                  ]),
            ]}
          />

          {range === null ? null : (
            <RangeSummary>
              {t('browse.authors.summary', {
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
                {t('browse.authors.pastEnd', { page: view.page })}
              </EmptyState>
            ) : (
              <EmptyState
                title={t('browse.authors.noResultsTitle')}
                action={{ href: base, text: hub('common.reset') }}
              >
                {t('browse.authors.noResults')}
              </EmptyState>
            )
          ) : (
            <ul
              aria-label={title}
              className="grid list-none grid-cols-1 gap-4 p-0 *:min-w-0 sm:grid-cols-2 xl:grid-cols-3"
            >
              {slice.map((person) => {
                const card = cards.get(person.personId);
                const name = card?.name ?? person.name;
                const nameLocale = card?.resolvedLocale ?? null;
                const portrait = card?.portrait ?? null;
                const own =
                  nameLocale === null
                    ? { dir: 'auto' as const }
                    : { lang: nameLocale, dir: directionOf(nameLocale) };
                const profile = localizedPath(
                  locale,
                  `/people/${encodeURIComponent(person.slug)}`,
                );
                return (
                  <li
                    key={person.personId}
                    className="flex min-w-0 flex-col gap-4 rounded-panel border border-border bg-surface-raised p-5"
                  >
                    <div className="flex min-w-0 items-center gap-4">
                      <PersonMark
                        personId={person.personId}
                        portrait={portrait}
                        letter={person.letter}
                        own={own}
                      />
                      <h3
                        className="min-w-0 text-subheading font-semibold wrap-anywhere"
                        {...own}
                      >
                        <a
                          href={profile}
                          className="text-foreground no-underline decoration-accent-rule underline-offset-4 hover:underline"
                        >
                          {name}
                        </a>
                      </h3>
                    </div>
                    <ul
                      aria-label={t('browse.authors.rolesOf', { name })}
                      className="flex list-none flex-col gap-1 p-0 text-sm text-foreground-muted"
                    >
                      {person.roles.map((entry) => (
                        <li key={entry.role}>
                          {t(`browse.authors.roles.${entry.role}`, {
                            count: entry.works,
                          })}
                        </li>
                      ))}
                    </ul>
                    <p className="mt-auto">
                      <a
                        href={libraryBooksHref(locale, {
                          contributor: person.personId.toLowerCase(),
                        })}
                        className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-action underline-offset-4 hover:underline"
                      >
                        <span>
                          {t('browse.authors.books', { count: person.works })}
                          <span className="sr-only">
                            {' '}
                            {t('browse.authors.booksBy', { name })}
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
              label={t('browse.authors.pager')}
              previous={view.page > 1 ? href({ page: view.page - 1 }) : null}
              next={view.page < pages ? href({ page: view.page + 1 }) : null}
              previousLabel={t('previous')}
              nextLabel={t('next')}
              pages={{
                current: view.page,
                total: pages,
                href: (page) => href({ page }),
                label: (page) => hub('common.pageLabel', { page }),
                format: (page) => number(page),
              }}
            />
          )}

          {directory.hasMore ? (
            <p className="text-sm text-foreground-muted">
              {t('browse.authors.truncated', { count: directory.items.length })}
            </p>
          ) : null}
        </section>
      )}

      <ClosingNote
        text={t('browse.authors.about')}
        links={[
          {
            href: localizedPath(locale, '/library/books'),
            text: t('landing.browseBooks'),
          },
          {
            href: localizedPath(locale, '/library/resources'),
            text: t('landing.allResources'),
          },
        ]}
      />
    </BrowseFrame>
  );
}
