import { z } from 'zod';
import { editorialReadRuntime } from '@/composition/editorial-read';
import { translationFor } from '@/components/editorial/public-content';
import { getTranslations } from 'next-intl/server';
import { requireLocale } from '@/config/route-locale';
import { ListingIntro } from '@/components/editorial/frame';
import { Pagination } from '@/components/media/parts';
import {
  ActionLink,
  CardGrid,
  Container,
  LinkCard,
  SectionHeader,
} from '@/components/ui';
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
  const [pages, shell] = await Promise.all([
    editorialReadRuntime().helpPages(offset),
    getTranslations({ locale, namespace: 'shell' }),
  ]);
  return (
    <>
      {record ? (
        <PublicContent record={record} locale={locale} path="/help" kind="WebPage" />
      ) : (
        <>
          <ListingIntro
            trailLabel={shell('nav.breadcrumbs')}
            trail={[{ href: '/' + locale, text: shell('nav.home') }, { text: t('help') }]}
            title={t('help')}
          />
          <Container>
            <div className="pt-[var(--space-page)]">
              <PublicationStatus locale={locale} />
            </div>
          </Container>
        </>
      )}
      <Container>
        <div className="flex flex-col gap-10 py-[var(--space-page)]">
          {pages.length === 0 && offset === 0 ? null : (
            <section aria-labelledby="help-articles" className="flex flex-col gap-5">
              <SectionHeader id="help-articles" heading={t('helpArticles')} />
              <CardGrid>
                {pages.map((page) => {
                  const translation = translationFor(page, locale);
                  return (
                    <LinkCard
                      key={page.slug}
                      href={'/' + locale + '/help/' + encodeURIComponent(page.slug)}
                      title={translation.title}
                      description={translation.excerpt}
                      lang={translation.languageCode}
                      dir={translation.languageCode === 'en' ? 'ltr' : 'rtl'}
                    />
                  );
                })}
              </CardGrid>
              <Pagination
                label={t('pages')}
                previous={offset > 0 ? '?offset=' + Math.max(0, offset - 25) : null}
                next={pages.length === 25 ? '?offset=' + (offset + 25) : null}
                previousLabel={t('previous')}
                nextLabel={t('next')}
              />
            </section>
          )}
          <nav
            aria-label={t('help')}
            className="flex flex-col gap-4 rounded-[var(--radius-panel)] border border-[color:var(--color-border)] bg-[color:var(--color-surface-sunken)] p-5 sm:flex-row sm:items-center sm:justify-between"
          >
            <p className="max-w-[var(--measure-prose)] text-sm text-[color:var(--color-foreground-muted)]">
              {t('helpMore')}
            </p>
            <div className="flex flex-wrap gap-3">
              <ActionLink href={'/' + locale + '/contact'} tone="secondary">
                {t('contact')}
              </ActionLink>
              <ActionLink href={'/' + locale + '/feedback'} tone="secondary">
                {t('feedback')}
              </ActionLink>
            </div>
          </nav>
        </div>
      </Container>
    </>
  );
}
