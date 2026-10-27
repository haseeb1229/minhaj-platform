import { z } from 'zod';
import { getTranslations } from 'next-intl/server';
import { requireLocale } from '@/config/route-locale';
import { editorialReadRuntime } from '@/composition/editorial-read';
import { translationFor } from '@/components/editorial/public-content';
import { ListingFrame, Pager } from '@/components/library/frame';
import { CardGrid, EmptyState, LinkCard } from '@/components/ui';
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
    t = await getTranslations({ locale, namespace: 'editorial' }),
    library = await getTranslations({ locale, namespace: 'library' }),
    shell = await getTranslations({ locale, namespace: 'shell' });
  const offset = z.coerce
    .number()
    .int()
    .min(0)
    .max(10_000_000)
    .catch(0)
    .parse((await searchParams).offset);
  const records = await editorialReadRuntime().articles(offset);
  return (
    <ListingFrame
      breadcrumbLabel={shell('nav.breadcrumbs')}
      trail={[
        { href: '/' + locale, text: shell('nav.home') },
        { href: '/' + locale + '/library', text: library('title') },
        { text: t('articles') },
      ]}
      title={t('articles')}
      lede={library('sectionBody.articles')}
    >
      {records.length ? (
        <CardGrid label={t('articles')}>
          {records.map((record) => {
            // Editorial's own resolution of which language version is shown.
            const translation = translationFor(record, locale);
            return (
              <LinkCard
                key={record.slug}
                href={
                  '/' + locale + '/library/articles/' + encodeURIComponent(record.slug)
                }
                title={translation.title}
                description={translation.excerpt}
                headingLevel="h2"
                lang={translation.languageCode}
                dir={translation.languageCode === 'en' ? 'ltr' : 'rtl'}
              />
            );
          })}
        </CardGrid>
      ) : (
        <EmptyState>{t('empty')}</EmptyState>
      )}
      <Pager
        label={t('articles')}
        previous={offset > 0 ? '?offset=' + Math.max(0, offset - 25) : null}
        next={records.length === 25 ? '?offset=' + (offset + 25) : null}
        previousLabel={t('previous')}
        nextLabel={t('next')}
      />
    </ListingFrame>
  );
}
