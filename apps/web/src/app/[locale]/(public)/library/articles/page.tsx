import { z } from 'zod';
import { getTranslations } from 'next-intl/server';
import { requireLocale } from '@/config/route-locale';
import { editorialReadRuntime } from '@/composition/editorial-read';
import { translationFor } from '@/components/editorial/public-content';
import { Container, PageHeading, EmptyState, TextLink } from '@/components/ui';
export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };
export default async function Articles({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ offset?: string }>;
}) {
  const locale = await requireLocale(params),
    t = await getTranslations({ locale, namespace: 'editorial' });
  const offset = z.coerce
    .number()
    .int()
    .min(0)
    .max(10_000_000)
    .catch(0)
    .parse((await searchParams).offset);
  const records = await editorialReadRuntime().articles(offset);
  return (
    <Container>
      <div className="flex flex-col gap-6 py-12">
        <PageHeading>{t('articles')}</PageHeading>
        {records.length ? (
          <ul className="flex flex-col gap-6">
            {records.map((record) => {
              const translation = translationFor(record, locale);
              return (
                <li key={record.slug} lang={translation.languageCode} dir="auto">
                  <TextLink
                    href={
                      '/' +
                      locale +
                      '/library/articles/' +
                      encodeURIComponent(record.slug)
                    }
                  >
                    {translation.title}
                  </TextLink>
                  <p>{translation.excerpt}</p>
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState>{t('empty')}</EmptyState>
        )}
        <nav className="flex gap-4" aria-label={t('articles')}>
          {offset > 0 ? (
            <TextLink href={'?offset=' + Math.max(0, offset - 25)}>
              {t('previous')}
            </TextLink>
          ) : null}
          {records.length === 25 ? (
            <TextLink href={'?offset=' + (offset + 25)}>{t('next')}</TextLink>
          ) : null}
        </nav>
      </div>
    </Container>
  );
}
