import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import {
  DONATION_STATUS_COOKIE,
  donatePath,
  donationStatusPath,
  myDonationsPath,
  readStatusToken,
} from '@/components/donations/presentation';
import { Container, PageHeading, Prose, TextLink } from '@/components/ui';
import { requireLocale } from '@/config/route-locale';

/**
 * `/{locale}/donate/return` — where the payment provider sends a donor back,
 * after paying and after cancelling alike (DELIVERY_PLAN.md Phase 27).
 *
 * THIS GET NEVER MUTATES, AND TRUSTS NOTHING IT IS GIVEN. Whatever query
 * string the provider or anybody else appends is not even read: a return
 * visit is not evidence that anything was paid. The page only looks for the
 * status cookie THIS browser was given when it started a donation, and — if
 * it holds a well-formed token — sends the donor to that donation's status
 * page, where the state shown is what the provider reported server-to-server.
 *
 * NO COOKIE, NO GUESS. A browser that started no donation here, or whose
 * cookie has expired, is told so plainly and pointed to My donations and the
 * giving page; nothing is looked up by any other means.
 *
 * Per request, `noindex`, `no-referrer`, and `private, no-store` from the
 * response headers (`next.config.ts`).
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export const dynamic = 'force-dynamic';

export default async function DonationReturnPage({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}) {
  const locale = await requireLocale(params);
  const token = readStatusToken((await cookies()).get(DONATION_STATUS_COOKIE)?.value);
  if (token !== null) redirect(donationStatusPath(locale, token));

  const t = await getTranslations({ locale, namespace: 'donations' });
  return (
    <Container>
      <div className="flex min-w-0 flex-col gap-6 py-12">
        <Prose>
          <PageHeading>{t('return.title')}</PageHeading>
          <p>{t('return.missing')}</p>
          <p className="text-sm text-[color:var(--color-foreground-muted)]">
            {t('return.help')}
          </p>
        </Prose>
        <nav aria-label={t('return.title')} className="flex flex-wrap gap-x-6 gap-y-2">
          <TextLink href={myDonationsPath(locale)}>{t('return.mine')}</TextLink>
          <TextLink href={donatePath(locale)}>{t('return.donate')}</TextLink>
        </nav>
      </div>
    </Container>
  );
}
