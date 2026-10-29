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
  Alert,
  Breadcrumbs,
  Container,
  MetaRow,
  Prose,
  TextLink,
  TopicChips,
} from '@/components/ui';
import { RecordSection } from './frame';
import { translationFor } from './presentation';
import { LeadFigure } from './lead-image';
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
    pathFor: (language) => '/' + language + path,
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
  const references = await editorialPublicReferences(record, locale);
  const contentLocales = record.translations.map((row) => row.languageCode);
  const direction = translation.languageCode === 'en' ? 'ltr' : 'rtl';
  // A date-only fact in the interface locale, never shifted by the reader's zone.
  // An Article's date is its CHRONOLOGY (Phase 30-R): its source's own
  // publication date where it states one — never the day it was migrated.
  const dated = record.chronologyAt ?? record.publishedAt;
  const published = new Intl.DateTimeFormat(locale, {
    dateStyle: 'long',
    timeZone: 'UTC',
  }).format(dated);
  const image = record.leadImage ?? null;
  const credits = record.contributors.flatMap((credit) => {
    const person = references.people.find((row) => row.id === credit.personId);
    return person === undefined ? [] : [{ credit, person }];
  });
  return (
    <Container>
      <article className="flex flex-col gap-8 pt-6 pb-[var(--space-section)]">
        <Breadcrumbs
          label={shell('nav.breadcrumbs')}
          trail={[
            { href: '/' + locale, text: shell('nav.home') },
            ...(kind === 'Article'
              ? [{ href: '/' + locale + '/library/articles', text: t('articles') }]
              : []),
            { text: translation.title },
          ]}
        />

        {/* THE HEADER: what it is and when, the title, its standfirst, its byline. */}
        <header className="flex max-w-3xl flex-col gap-4 border-b border-[color:var(--color-border)] pb-8">
          <MetaRow
            items={[
              kind === 'Article' ? (
                <span
                  key="type"
                  className="font-semibold tracking-[var(--tracking-eyebrow)] text-[color:var(--color-accent)] uppercase"
                >
                  {t('articles')}
                </span>
              ) : null,
              <time key="date" dateTime={dated.toISOString().slice(0, 10)}>
                {news('published')} {published}
              </time>,
            ]}
          />
          {translation.languageCode !== locale ? (
            <Alert tone="info">
              {t('fallback', { language: translation.languageCode })}
            </Alert>
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
              <p className="text-lede max-w-[var(--measure-prose)] text-[color:var(--color-foreground-muted)]">
                {translation.excerpt}
              </p>
            ) : null}
          </div>
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
            credits.length === 0 && references.topics.length === 0
              ? 'flex min-w-0 flex-col'
              : 'grid gap-10 lg:grid-cols-[minmax(0,1fr)_18rem] lg:gap-14'
          }
        >
          <Prose>
            <div
              className="editorial-prose"
              lang={translation.languageCode}
              dir={direction}
              dangerouslySetInnerHTML={{ __html: translation.html }}
            />
          </Prose>

          {credits.length === 0 && references.topics.length === 0 ? null : (
            <aside className="flex min-w-0 flex-col gap-8">
              {credits.length === 0 ? null : (
                <RecordSection id="content-contributors" heading={news('contributors')}>
                  <ul className="flex flex-col gap-2 text-sm">
                    {credits.map(({ credit, person }) => (
                      <li key={credit.personId + ':' + credit.role} className="min-w-0">
                        <TextLink
                          href={
                            '/' + locale + '/people/' + encodeURIComponent(person.slug)
                          }
                        >
                          {person.name}
                        </TextLink>
                        <span className="text-[color:var(--color-foreground-muted)]">
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
                      href: '/' + locale + '/topics/' + encodeURIComponent(topic.slug),
                      text: topic.name,
                    }))}
                  />
                </RecordSection>
              )}
            </aside>
          )}
        </div>
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
                        item: absoluteUrl('/' + translation.languageCode),
                      },
                      {
                        '@type': 'ListItem',
                        position: 2,
                        name: translation.title,
                        item: absoluteUrl('/' + translation.languageCode + path),
                      },
                    ],
                  },
                  {
                    '@type': kind,
                    headline: translation.title,
                    inLanguage: translation.languageCode,
                    url: absoluteUrl('/' + translation.languageCode + path),
                    ...(image === null
                      ? {}
                      : { image: absoluteUrl(leadImagePath(image)) }),
                    datePublished: dated.toISOString(),
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
