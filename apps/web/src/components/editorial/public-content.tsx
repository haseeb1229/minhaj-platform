import { localizedPath } from '@minhaj/contracts';
import 'server-only';
import { cache } from 'react';
import { getTranslations } from 'next-intl/server';
import type { Locale } from '@minhaj/contracts';
import {
  leadImagePath,
  pagePath,
  type PublicEditorial,
} from '@minhaj/contracts/editorial';
import {
  editorialReadRuntime,
  editorialPublicReferences,
} from '@/composition/editorial-read';
import {
  Badge,
  Breadcrumbs,
  CardGrid,
  Container,
  Icon,
  LanguageBadge,
  SectionHeader,
  TextLink,
  TopicChips,
} from '@/components/ui';
import { directionOf } from '@/config/locale';
import { ArticleCard } from './article-card';
import { RecordSection } from './frame';
import { translationFor } from './presentation';
import { LeadFigure } from './lead-image';
import { revisedAfterPublication, withContents } from './long-form';
import { AuthorChips, Contents, ReadingDates } from './reading';
import { absoluteUrl } from '@/config/origin';
import {
  contentMetadata,
  isContentIndexable,
  serializeStructuredData,
} from '@/seo/metadata';

// React cache deduplicates metadata/body reads only inside the current request.
export const readArticle = cache((slug: string) => editorialReadRuntime().article(slug));
export const readPage = cache((binding: string, slug = 'page') =>
  editorialReadRuntime().page(binding, slug),
);
export { translationFor };
export function editorialMetadata(record: PublicEditorial, locale: Locale, path: string) {
  const translation = translationFor(record, locale);
  return contentMetadata({
    locale,
    contentLocales: record.translations.map((row) => row.languageCode),
    primaryLocale: record.primaryLanguage,
    pathFor: (language) => localizedPath(language, path),
    title: translation.seoTitle || translation.title,
    description: translation.seoDescription || translation.excerpt,
  });
}
export async function publishedPageMetadata(
  locale: Locale,
  binding: string,
  slug = 'page',
) {
  const record = await readPage(binding, slug);
  return record
    ? editorialMetadata(record, locale, pagePath(record.routeBinding, record.slug))
    : null;
}

/** How many other Articles an Article page closes with. */
const RELATED_ARTICLES = 3;

/**
 * An Article or a Page, set for reading (R2): the header — for an Article its
 * type, headline, standfirst, byline and dates; for a Page its title and
 * standfirst alone — the lead picture, then the body at a reading measure
 * with its contents beside it when it has sections, then its other credits
 * and topics, and, for an Article, more Articles.
 */
export async function PublicContent({
  record,
  locale,
  path,
  kind,
}: {
  record: PublicEditorial;
  locale: Locale;
  path: string;
  kind: 'Article' | 'WebPage';
}) {
  const t = await getTranslations({ locale, namespace: 'editorial' });
  const news = await getTranslations({ locale, namespace: 'news' });
  const shell = await getTranslations({ locale, namespace: 'shell' });
  const translation = translationFor(record, locale);
  const article = kind === 'Article';
  const [references, latest] = await Promise.all([
    editorialPublicReferences(record, locale),
    article ? editorialReadRuntime().articles(0) : Promise.resolve([]),
  ]);
  const contentLocales = record.translations.map((row) => row.languageCode);
  const direction = directionOf(translation.languageCode);
  // A date-only fact in the interface locale, never shifted by the reader's zone.
  // An Article's date is its CHRONOLOGY (Phase 30-R): its source's own
  // publication date where it states one — never the day it was migrated.
  const dated = record.chronologyAt ?? record.publishedAt;
  // Phase 30-RF. A WebPage — an organisational, help or legal destination —
  // carries no source chronology, so the only date it has is the day the
  // platform published it, which on a migrated page (a 2009 profile) reads as
  // if the content were new. It shows no dateline and states no publication
  // date; its structured data keeps the true `dateModified`.
  const showsDate = article;
  const format = (value: Date) => ({
    text: new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(
      value,
    ),
    machine: value.toISOString().slice(0, 10),
  });
  const image = record.leadImage ?? null;
  const credits = record.contributors.flatMap((credit) => {
    const person = references.people.find((row) => row.id === credit.personId);
    return person === undefined ? [] : [{ credit, person }];
  });
  const authors = credits.filter(({ credit }) => credit.role === 'author');
  const others = credits.filter(({ credit }) => credit.role !== 'author');
  const body = withContents(translation.html);
  const related = latest
    .filter((row) => row.slug !== record.slug)
    .slice(0, RELATED_ARTICLES);
  const dates = showsDate
    ? [
        { term: news('published'), ...format(dated) },
        ...(revisedAfterPublication(record.publishedAt, record.updatedAt)
          ? [{ term: news('updated'), ...format(record.updatedAt) }]
          : []),
      ]
    : [];

  return (
    <Container>
      <article className="flex flex-col gap-10 pt-6 pb-[var(--space-section)]">
        <Breadcrumbs
          label={shell('nav.breadcrumbs')}
          trail={[
            { href: localizedPath(locale, ''), text: shell('nav.home') },
            ...(article
              ? [
                  {
                    href: localizedPath(locale, '/library/articles'),
                    text: t('articles'),
                  },
                ]
              : []),
            { text: translation.title },
          ]}
        />

        <header className="flex max-w-3xl flex-col gap-5">
          {article || translation.languageCode !== locale ? (
            <p className="flex flex-wrap items-center gap-2">
              {article ? <Badge>{news('type.article')}</Badge> : null}
              {translation.languageCode === locale ? null : (
                <LanguageBadge
                  label={news(`languages.${translation.languageCode}`)}
                  code={translation.languageCode}
                />
              )}
            </p>
          ) : null}
          <div
            className="flex flex-col gap-4"
            lang={translation.languageCode}
            dir={direction}
          >
            <h1 className="text-title font-semibold tracking-[var(--tracking-display)] text-balance wrap-anywhere">
              {translation.title}
            </h1>
            {translation.excerpt ? (
              <p className="reading-face text-lede max-w-[var(--measure-prose)] text-foreground-muted">
                {translation.excerpt}
              </p>
            ) : null}
          </div>
          {translation.languageCode !== locale ? (
            <p
              role="status"
              className="flex items-start gap-2 text-sm text-foreground-muted"
            >
              <Icon name="globe" size={16} className="mt-1 shrink-0" />
              <span>{t('fallback', { language: translation.languageCode })}</span>
            </p>
          ) : null}
          {authors.length === 0 && dates.length === 0 ? null : (
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-border pt-4">
              <AuthorChips
                locale={locale}
                label={news('authors')}
                people={authors.map(({ person }) => person)}
              />
              <ReadingDates dates={dates} />
            </div>
          )}
        </header>

        {image === null ? null : (
          <LeadFigure
            image={image}
            alt={translation.leadAlt ?? ''}
            lang={translation.languageCode}
            caption={
              image.credit === null ? null : t('leadCredit', { credit: image.credit })
            }
          />
        )}

        <div
          className={
            body.entries.length === 0
              ? 'flex min-w-0 flex-col gap-10'
              : 'grid gap-10 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-14'
          }
        >
          <Contents entries={body.entries} label={news('contents')} />
          <div className="flex min-w-0 flex-col gap-10">
            <div
              className="editorial-prose long-form"
              lang={translation.languageCode}
              dir={direction}
              dangerouslySetInnerHTML={{ __html: body.html }}
            />

            {others.length === 0 && references.topics.length === 0 ? null : (
              <div className="flex max-w-[70ch] flex-col gap-8">
                {others.length === 0 ? null : (
                  <RecordSection id="content-contributors" heading={news('contributors')}>
                    <ul className="flex flex-col gap-2 text-sm">
                      {others.map(({ credit, person }) => (
                        <li key={credit.personId + ':' + credit.role} className="min-w-0">
                          <TextLink
                            href={localizedPath(
                              locale,
                              '/people/' + encodeURIComponent(person.slug),
                            )}
                          >
                            {person.name}
                          </TextLink>
                          <span className="text-foreground-muted">
                            {' '}
                            — {t(credit.role as 'author')}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </RecordSection>
                )}
                {references.topics.length === 0 ? null : (
                  <RecordSection id="content-topics" heading={news('topics')}>
                    <TopicChips
                      label={news('topics')}
                      topics={references.topics.map((topic) => ({
                        href: localizedPath(
                          locale,
                          '/topics/' + encodeURIComponent(topic.slug),
                        ),
                        text: topic.name,
                      }))}
                    />
                  </RecordSection>
                )}
              </div>
            )}
          </div>
        </div>

        {related.length === 0 ? null : (
          <section
            className="flex flex-col gap-6 border-t border-border pt-[var(--space-page)]"
            aria-labelledby="content-related"
          >
            <SectionHeader
              id="content-related"
              heading={news('moreArticles')}
              action={{
                href: localizedPath(locale, '/library/articles'),
                text: news('allArticles'),
              }}
            />
            <CardGrid label={news('moreArticles')}>
              {related.map((row) => (
                <ArticleCard
                  key={row.slug}
                  locale={locale}
                  record={row}
                  headingLevel="h3"
                />
              ))}
            </CardGrid>
          </section>
        )}

        {isContentIndexable({ contentLocales }) ? (
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{
              __html: serializeStructuredData({
                '@context': 'https://schema.org',
                '@graph': [
                  {
                    '@type': 'BreadcrumbList',
                    itemListElement: [
                      {
                        '@type': 'ListItem',
                        position: 1,
                        name: shell('nav.home'),
                        item: absoluteUrl(localizedPath(translation.languageCode, '')),
                      },
                      {
                        '@type': 'ListItem',
                        position: 2,
                        name: translation.title,
                        item: absoluteUrl(localizedPath(translation.languageCode, path)),
                      },
                    ],
                  },
                  {
                    '@type': kind,
                    headline: translation.title,
                    inLanguage: translation.languageCode,
                    url: absoluteUrl(localizedPath(translation.languageCode, path)),
                    ...(image === null
                      ? {}
                      : { image: absoluteUrl(leadImagePath(image)) }),
                    ...(showsDate ? { datePublished: dated.toISOString() } : {}),
                    dateModified: record.updatedAt.toISOString(),
                  },
                ],
              }),
            }}
          />
        ) : null}
      </article>
    </Container>
  );
}
