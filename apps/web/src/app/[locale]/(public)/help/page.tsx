import { z } from 'zod';
import { editorialReadRuntime } from '@/composition/editorial-read';
import { translationFor } from '@/components/editorial/public-content';
import { getTranslations } from 'next-intl/server';
import { requireLocale } from '@/config/route-locale';
import { Container, PageHeading, TextLink } from '@/components/ui';
import { PublicationStatus } from '@/components/shell/publication-status';
import {
  readPage,
  publishedPageMetadata,
  PublicContent,
} from '@/components/editorial/public-content';

export const dynamic = 'force-dynamic';
interface Props {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ offset?: string }>;
}
export async function generateMetadata({ params }: Props) {
  const locale = await requireLocale(params);
  return (
    (await publishedPageMetadata(locale, '/help')) ?? {
      robots: { index: false, follow: false },
    }
  );
}
export default async function PublicPage({ params, searchParams }: Props) {
  const locale = await requireLocale(params),
    t = await getTranslations({ locale, namespace: 'editorial' });
  const record = await readPage('/help');
  const offset = z.coerce
    .number()
    .int()
    .min(0)
    .max(10_000_000)
    .catch(0)
    .parse((await searchParams).offset);
  const pages = await editorialReadRuntime().helpPages(offset);
  return (
    <>
      {record ? (
        <PublicContent record={record} locale={locale} path="/help" kind="WebPage" />
      ) : (
        <Container>
          <div className="flex flex-col gap-6 py-12">
            <PageHeading>{t('help')}</PageHeading>
            <PublicationStatus locale={locale} />
          </div>
        </Container>
      )}
      <Container>
        <div className="flex flex-col gap-6 pb-12">
          <ul className="flex flex-col gap-4">
            {pages.map((page) => (
              <li key={page.slug}>
                <TextLink href={'/' + locale + '/help/' + encodeURIComponent(page.slug)}>
                  {translationFor(page, locale).title}
                </TextLink>
              </li>
            ))}
          </ul>
          <nav aria-label={t('pages')} className="flex gap-4">
            {offset > 0 ? (
              <TextLink href={'?offset=' + Math.max(0, offset - 25)}>
                {t('previous')}
              </TextLink>
            ) : null}
            {pages.length === 25 ? (
              <TextLink href={'?offset=' + (offset + 25)}>{t('next')}</TextLink>
            ) : null}
          </nav>
          <nav className="flex flex-wrap gap-4" aria-label={t('help')}>
            <TextLink href={'/' + locale + '/help'}>{t('help')}</TextLink>
            <TextLink href={'/' + locale + '/contact'}>{t('contact')}</TextLink>
            <TextLink href={'/' + locale + '/feedback'}>{t('feedback')}</TextLink>
          </nav>
        </div>
      </Container>
    </>
  );
}
