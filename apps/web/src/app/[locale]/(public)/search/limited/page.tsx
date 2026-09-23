import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Alert, Breadcrumbs, Container, PageHeading, TextLink } from '@/components/ui';
import { requireLocale } from '@/config/route-locale';

/**
 * `/{locale}/search/limited` — where a throttled search is sent.
 *
 * THE RATE-LIMITED STATE, AS ITS OWN STATIC PAGE. The request proxy decides
 * admission before the results page renders (`composition/search-admission.ts`)
 * and sends a visitor who has searched too often here. This page runs no query,
 * reads no data and holds nothing about the visitor, so reaching it directly is
 * harmless — it only says to wait — and it can be prerendered like the rest of
 * the shell.
 *
 * `noindex, nofollow`: a state, not a resource.
 */

export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}): Promise<Metadata> {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'search' });

  return { title: t('limitedTitle'), robots: { index: false, follow: false } };
}

export default async function SearchLimitedPage({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}) {
  const locale = await requireLocale(params);
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: 'search' });
  const shell = await getTranslations({ locale, namespace: 'shell' });

  return (
    <Container>
      <div className="flex flex-col gap-6 py-12">
        <Breadcrumbs
          label={shell('nav.breadcrumbs')}
          trail={[
            { href: `/${locale}`, text: shell('nav.home') },
            { href: `/${locale}/search`, text: t('title') },
            { text: t('limitedTitle') },
          ]}
        />
        <PageHeading>{t('limitedTitle')}</PageHeading>
        <Alert tone="warning">{t('rateLimited')}</Alert>
        <p>
          <TextLink href={`/${locale}/search`}>{t('backToSearch')}</TextLink>
        </p>
      </div>
    </Container>
  );
}
