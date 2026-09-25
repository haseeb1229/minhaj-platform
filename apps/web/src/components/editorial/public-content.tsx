import 'server-only';
import { cache } from 'react';
import { getTranslations } from 'next-intl/server';
import type { Locale } from '@minhaj/contracts';
import { pagePath, type PublicEditorial } from '@minhaj/contracts/editorial';
import {
  editorialReadRuntime,
  editorialPublicReferences,
} from '@/composition/editorial-read';
import { Alert, Breadcrumbs, Container, Prose, TextLink } from '@/components/ui';
import { translationFor } from './presentation';
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
  const shell = await getTranslations({ locale, namespace: 'shell' });
  const translation = translationFor(record, locale);
  const references = await editorialPublicReferences(record, locale);
  const contentLocales = record.translations.map((row) => row.languageCode);
  return (
    <Container>
      <article className="flex flex-col gap-6 py-12">
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
        {translation.languageCode !== locale ? (
          <Alert tone="info">
            {t('fallback', { language: translation.languageCode })}
          </Alert>
        ) : null}
        <Prose>
          <div
            lang={translation.languageCode}
            dir={translation.languageCode === 'en' ? 'ltr' : 'rtl'}
          >
            <h1 className="text-3xl font-semibold tracking-tight">{translation.title}</h1>
            {translation.excerpt ? <p>{translation.excerpt}</p> : null}
            <div
              className="editorial-prose"
              dangerouslySetInnerHTML={{ __html: translation.html }}
            />
          </div>
        </Prose>
        {references.people.length ? (
          <ul className="flex flex-wrap gap-4">
            {record.contributors.map((credit) => {
              const person = references.people.find((row) => row.id === credit.personId);
              return person ? (
                <li key={credit.personId + ':' + credit.role}>
                  <TextLink
                    href={'/' + locale + '/people/' + encodeURIComponent(person.slug)}
                  >
                    {person.name}
                  </TextLink>{' '}
                  — {t(credit.role as 'author')}
                </li>
              ) : null;
            })}
          </ul>
        ) : null}
        {references.topics.length ? (
          <ul className="flex flex-wrap gap-4">
            {references.topics.map((topic) => (
              <li key={topic.id}>{topic.name}</li>
            ))}
          </ul>
        ) : null}
        <time dateTime={record.publishedAt.toISOString()}>
          {record.publishedAt.toISOString().slice(0, 10)}
        </time>
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
                    datePublished: record.publishedAt.toISOString(),
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
