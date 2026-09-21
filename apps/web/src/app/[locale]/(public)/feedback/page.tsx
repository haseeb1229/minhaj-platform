import { getTranslations } from 'next-intl/server';
import { requireLocale } from '@/config/route-locale';
import { Container, PageHeading, TextLink } from '@/components/ui';
import {
  readPage,
  publishedPageMetadata,
  PublicContent,
} from '@/components/editorial/public-content';
import { CorrespondenceForm } from '../correspondence-form';
export const dynamic = 'force-dynamic';
interface Props {
  params: Promise<{ locale: string }>;
}
export async function generateMetadata({ params }: Props) {
  const locale = await requireLocale(params);
  return (
    (await publishedPageMetadata(locale, '/feedback')) ?? {
      robots: { index: false, follow: false },
    }
  );
}
export default async function PublicPage({ params }: Props) {
  const locale = await requireLocale(params),
    t = await getTranslations({ locale, namespace: 'editorial' });
  const record = await readPage('/feedback');
  return (
    <>
      {record ? (
        <PublicContent record={record} locale={locale} path="/feedback" kind="WebPage" />
      ) : (
        <Container>
          <div className="flex flex-col gap-6 py-12">
            <PageHeading>{t('feedback')}</PageHeading>
          </div>
        </Container>
      )}
      <Container>
        <div className="flex flex-col gap-6 pb-12">
          <CorrespondenceForm locale={locale} kind="feedback" />
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
