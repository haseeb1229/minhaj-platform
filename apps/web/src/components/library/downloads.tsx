import 'server-only';

import { getTranslations } from 'next-intl/server';

import { localizedPath, type Locale } from '@minhaj/contracts';
import { LIBRARY_DOWNLOADS_PAGE } from '@minhaj/contracts/library';

import { libraryReadRuntime, libraryReferenceNames } from '@/composition/library-read';
import { servableDownloadFiles } from '@/composition/library-files';
import { directionOf } from '@/config/locale';
import { pageCount, pageRange } from '@/components/topic-hub/address';
import { libraryBooksHref } from '@/components/topic-hub/books-view';
import {
  ActiveFilters,
  ExploreFilters,
  ExploreHero,
  languageName,
} from '@/components/topic-hub/parts';
import {
  ActionLink,
  Cover,
  EmptyState,
  Field,
  Icon,
  MetaRow,
  Pager,
  SectionHeader,
  Select,
} from '@/components/ui';
import { BrowseFrame, ClosingNote, RangeSummary } from './browse-parts';
import {
  DEFAULT_DOWNLOADS_VIEW,
  DOWNLOADS_PATH,
  downloadsHref,
  fileFormat,
  fileSize,
  type DownloadsView,
} from './browse-view';
import { editionCoverPath } from './cover';
import { assetPath, EDITION_PARAM, labelFor, workPath } from './presentation';

/**
 * `/library/downloads` — EVERY EDITION THAT MAY BE DOWNLOADED (Library Part 2;
 * ROUTE_MAP.md §3.6, "Access"): one entry per published Edition of a public
 * Work whose stored availability allows a download with a file recorded
 * (Library's `downloads` read — the very decision the asset route enforces),
 * with its language, year, publisher and pages, its format and size, and the
 * rights statement. Filters with counts (content language, Topic), two
 * orders, 24 a page; the view is the address (`./browse-view`).
 *
 * THE DOWNLOAD IS THE EXISTING ASSET ROUTE, UNCHANGED:
 * `/assets/library/editions/{editionId}/download/{assetId}`, which decides
 * again, per request, with Library's policy and Storage's custody. The page
 * asks Storage only a technical question about the files Library's read
 * already allowed (`servableDownloadFiles`): what each is and whether it can
 * be served now — a file that cannot is stated as unavailable, never linked.
 *
 * NO LICENCE IS STATED beyond the recorded availability, because the data
 * carries none and inventing one would be inventing law. Signed out, always.
 */
export async function LibraryDownloadsPage({
  locale,
  view,
}: {
  readonly locale: Locale;
  readonly view: DownloadsView;
}) {
  const [t, hub, shell] = await Promise.all([
    getTranslations({ locale, namespace: 'library' }),
    getTranslations({ locale, namespace: 'topicHub' }),
    getTranslations({ locale, namespace: 'shell' }),
  ]);
  const library = libraryReadRuntime();
  const query = {
    language: view.language,
    topic: view.topic,
    sort: view.sort,
    titleLocale: locale,
    offset: (view.page - 1) * LIBRARY_DOWNLOADS_PAGE,
  };
  const [page, facets] = await Promise.all([
    library.downloads(query),
    library.downloadFacets(query),
  ]);
  const [files, names] = await Promise.all([
    servableDownloadFiles(page.items.map((item) => item.assetId)),
    libraryReferenceNames(
      {
        personIds: [],
        topicIds: [
          ...facets.topics.items.map((facet) => facet.id),
          ...(view.topic === null ? [] : [view.topic]),
        ],
      },
      locale,
    ),
  ]);

  const href = (change: Partial<DownloadsView>) =>
    downloadsHref(locale, view, { page: 1, ...change });
  const base = downloadsHref(locale, DEFAULT_DOWNLOADS_VIEW);
  const filtered = view.language !== null || view.topic !== null;
  const pages = pageCount(page.total, LIBRARY_DOWNLOADS_PAGE);
  const range = pageRange(view.page, page.items.length, LIBRARY_DOWNLOADS_PAGE);
  const number = (value: number) => new Intl.NumberFormat(locale).format(value);
  // Identifiers in lower case, as the address spells them: Taxonomy and
  // Library answer in whatever case a row was written in.
  const topicNames = new Map(
    [...names.topics].map(([id, topic]) => [id.toLowerCase(), topic.name]),
  );
  const topicOptions = facets.topics.items.flatMap((facet) => {
    const id = facet.id.toLowerCase();
    const name = topicNames.get(id);
    return name === undefined ? [] : [{ id, name, count: facet.editions }];
  });
  const topicName =
    view.topic === null
      ? null
      : (topicNames.get(view.topic) ?? hub('books.unknownTopic'));
  const showLanguage = facets.languages.items.length > 1 || view.language !== null;
  const showTopic = topicOptions.length > 0 || view.topic !== null;
  const title = t('section.downloads');
  const listId = 'library-downloads-list';

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
        lede={t('browse.downloads.lede')}
        notice={t('browse.downloads.notice')}
        stats={
          facets.editions === 0
            ? []
            : [
                {
                  value: facets.editions,
                  label: t('browse.downloads.stat', { count: facets.editions }),
                },
                {
                  value: facets.works,
                  label: t('browse.downloads.statBooks', { count: facets.works }),
                  href: libraryBooksHref(locale, { library: { downloadable: true } }),
                },
                ...(facets.languageCount < 2
                  ? []
                  : [
                      {
                        value: facets.languageCount,
                        label: t('browse.downloads.statLanguages', {
                          count: facets.languageCount,
                        }),
                      },
                    ]),
              ]
        }
        actions={[
          {
            href: localizedPath(locale, '/library/books'),
            text: t('landing.browseBooks'),
          },
          {
            href: localizedPath(locale, '/library/sale-points'),
            text: t('browse.downloads.salePoints'),
          },
        ]}
      />

      {facets.editions === 0 ? (
        <EmptyState
          icon="download"
          title={t('browse.downloads.emptyTitle')}
          action={{
            href: localizedPath(locale, '/library/books'),
            text: t('landing.browseBooks'),
          }}
        >
          {t('browse.downloads.empty')}
        </EmptyState>
      ) : (
        <section aria-labelledby={listId} className="flex flex-col gap-5">
          <SectionHeader
            id={listId}
            heading={t('browse.downloads.listHeading')}
            intro={t('browse.downloads.listIntro')}
          />

          <ExploreFilters
            action={localizedPath(locale, DOWNLOADS_PATH)}
            label={t('browse.downloads.filters')}
            hidden={[]}
            submit={t('browse.downloads.apply')}
            reset={filtered ? { href: base, text: hub('common.reset') } : null}
          >
            {showLanguage ? (
              <Field id="downloads-language" label={hub('common.filterLanguage')}>
                {(props) => (
                  <Select {...props} name="language" defaultValue={view.language ?? ''}>
                    <option value="">{hub('common.anyLanguage')}</option>
                    {facets.languages.items.map((facet) => (
                      <option key={facet.id} value={facet.id}>
                        {hub('common.option', {
                          name: languageName(facet.id, locale),
                          count: facet.editions,
                        })}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            ) : null}
            {showTopic ? (
              <Field id="downloads-topic" label={hub('books.filterTopic')}>
                {(props) => (
                  <Select {...props} name="topic" defaultValue={view.topic ?? ''}>
                    <option value="">{hub('books.anyTopic')}</option>
                    {topicOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {hub('common.option', { name: option.name, count: option.count })}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            ) : null}
            <Field id="downloads-sort" label={hub('common.filterSort')}>
              {(props) => (
                <Select {...props} name="sort" defaultValue={view.sort}>
                  <option value="title">{hub('common.sort.title')}</option>
                  <option value="newest">{hub('common.sort.newest')}</option>
                </Select>
              )}
            </Field>
          </ExploreFilters>

          <ActiveFilters
            label={hub('common.active')}
            filters={[
              ...(view.language === null
                ? []
                : [
                    {
                      key: 'language',
                      text: languageName(view.language, locale),
                      removeHref: href({ language: null }),
                      removeLabel: hub('common.remove', {
                        name: languageName(view.language, locale),
                      }),
                    },
                  ]),
              ...(view.topic === null || topicName === null
                ? []
                : [
                    {
                      key: 'topic',
                      text: topicName,
                      removeHref: href({ topic: null }),
                      removeLabel: hub('common.remove', { name: topicName }),
                    },
                  ]),
            ]}
          />

          {range === null ? null : (
            <RangeSummary>
              {t('browse.downloads.summary', {
                from: number(range.from),
                to: number(range.to),
                total: page.total,
              })}
            </RangeSummary>
          )}

          {page.items.length === 0 ? (
            view.page > 1 && page.total > 0 ? (
              <EmptyState
                title={hub('common.pastEndTitle')}
                action={{ href: href({}), text: hub('common.firstPage') }}
              >
                {t('browse.downloads.pastEnd', { page: view.page })}
              </EmptyState>
            ) : (
              <EmptyState
                title={t('browse.downloads.noResultsTitle')}
                action={{ href: base, text: hub('common.reset') }}
              >
                {t('browse.downloads.noResults')}
              </EmptyState>
            )
          ) : (
            <ul aria-label={title} className="flex list-none flex-col gap-4 p-0">
              {page.items.map((item) => {
                const label = labelFor(
                  {
                    labels: item.work.labels.map((entry) => ({
                      ...entry,
                      description: '',
                    })),
                    primaryLocale: item.work.primaryLocale,
                  },
                  locale,
                );
                const file = files.get(item.assetId);
                const format = file === undefined ? null : fileFormat(file.mediaType);
                const size = file === undefined ? null : fileSize(file.byteSize, locale);
                const facts = [
                  languageName(item.languageCode, locale),
                  ...(item.publicationYear === null
                    ? []
                    : [
                        new Intl.NumberFormat(locale, { useGrouping: false }).format(
                          item.publicationYear,
                        ),
                      ]),
                  ...(item.publisher === null ? [] : [item.publisher]),
                  ...(item.pageCount === null
                    ? []
                    : [t('browse.downloads.pages', { count: item.pageCount })]),
                ];
                return (
                  <li
                    key={item.editionId}
                    className="grid min-w-0 grid-cols-[4.5rem_minmax(0,1fr)] gap-4 rounded-panel border border-border bg-surface-raised p-4 sm:grid-cols-[6rem_minmax(0,1fr)] sm:p-5"
                  >
                    <div>
                      {item.cover === null ? (
                        <span
                          aria-hidden="true"
                          className="flex aspect-[2/3] items-center justify-center rounded-control border border-border bg-surface-sunken text-foreground-muted"
                        >
                          <Icon name="book" size={24} />
                        </span>
                      ) : (
                        <Cover
                          path={editionCoverPath(item.editionId, item.cover.assetId)}
                          width={item.cover.width}
                          height={item.cover.height}
                          sizes="6rem"
                          alt=""
                        />
                      )}
                    </div>
                    <div className="flex min-w-0 flex-col gap-2">
                      <h3
                        className="text-subheading font-semibold wrap-anywhere"
                        lang={label.locale}
                        dir={directionOf(label.locale)}
                      >
                        <a
                          href={`${workPath(locale, item.work.slug)}?${EDITION_PARAM}=${encodeURIComponent(item.editionId)}`}
                          className="text-foreground no-underline decoration-accent-rule underline-offset-4 hover:underline"
                        >
                          {label.title}
                        </a>
                      </h3>
                      <p className="text-sm wrap-anywhere" dir="auto">
                        {item.label}
                      </p>
                      <MetaRow items={facts} />
                      <p className="flex items-start gap-2 text-sm text-foreground-muted">
                        <Icon
                          name="check"
                          size={16}
                          className="mt-[0.2em] shrink-0 text-accent"
                        />
                        <span>{t('browse.downloads.rights')}</span>
                      </p>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-1">
                        {format === null || size === null ? (
                          <p className="text-sm text-foreground-muted">
                            {t('browse.downloads.fileUnavailable')}
                          </p>
                        ) : (
                          <>
                            <ActionLink
                              href={assetPath(item.editionId, 'download', item.assetId)}
                            >
                              <Icon name="download" size={16} />
                              <span className="ms-2">
                                {t('browse.downloads.download')}
                                <span className="sr-only"> {item.label}</span>
                              </span>
                            </ActionLink>
                            <span className="text-sm text-foreground-muted tabular-nums">
                              {t('browse.downloads.file', { format, size })}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {page.items.length === 0 ? null : (
            <Pager
              label={t('browse.downloads.pager')}
              previous={view.page > 1 ? href({ page: view.page - 1 }) : null}
              next={page.hasMore ? href({ page: view.page + 1 }) : null}
              previousLabel={t('previous')}
              nextLabel={t('next')}
              pages={{
                current: view.page,
                total: pages,
                href: (number_) => href({ page: number_ }),
                label: (number_) => hub('common.pageLabel', { page: number_ }),
                format: (number_) => number(number_),
              }}
            />
          )}
        </section>
      )}

      <ClosingNote
        text={t('browse.downloads.about')}
        links={[
          {
            href: localizedPath(locale, '/library/books'),
            text: t('landing.browseBooks'),
          },
          {
            href: localizedPath(locale, '/library/sale-points'),
            text: t('browse.downloads.salePoints'),
          },
        ]}
      />
    </BrowseFrame>
  );
}
