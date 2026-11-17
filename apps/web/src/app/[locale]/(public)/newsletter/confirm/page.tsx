import { localizedPath } from '@minhaj/contracts';
import type { Metadata } from 'next';

import { NEWSLETTER_CONFIRMATION_HOURS } from '@minhaj/contracts/personalisation';
import { getTranslations } from 'next-intl/server';

import { newsletterReadRuntime } from '@/composition/newsletter-read';
import { Alert, Container, Icon, PageHeading, TextLink } from '@/components/ui';
import { requireLocale } from '@/config/route-locale';
import { confirmNewsletter } from '../actions';
import { NewsletterForm } from '../newsletter-form';

/**
 * The emailed newsletter confirmation link — protocol class D
 * (SECURITY_BASELINE.md §7.4, ROUTE_MAP.md §4).
 *
 * THIS GET CONFIRMS NOTHING. It asks only whether the link is still usable and
 * renders a button, so a mail scanner, a link prefetcher or a security
 * appliance opening the link cannot subscribe anybody. The subscription is
 * confirmed by the POST the person submits, which consumes the token once.
 *
 * NEUTRAL WHEN IT FAILS. Expired, already used, rotated or unknown all read the
 * same, and nothing here names the address the link was for. The token
 * appears in the page only as the hidden field the confirming POST carries,
 * and only once it has the shape of a real one.
 *
 * `noindex, nofollow`, per request, and with no canonical, alternates or
 * structured data: a URL carrying a token is never a resource to advertise.
 */
export const dynamic = 'force-dynamic';

interface LinkParams {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: LinkParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'newsletter' });

  return { title: t('confirm.title'), robots: { index: false, follow: false } };
}

export default async function NewsletterConfirmPage({
  params,
  searchParams,
}: LinkParams) {
  const locale = await requireLocale(params);
  const query = await searchParams;
  const t = await getTranslations({ locale, namespace: 'newsletter' });

  const token = typeof query['token'] === 'string' ? query['token'] : null;
  const status =
    token === null
      ? 'invalid'
      : await newsletterReadRuntime().linkStatus('confirm', token);

  return (
    <Container>
      <div className="flex max-w-md flex-col gap-6 py-12">
        <PageHeading>{t('confirm.title')}</PageHeading>

        {status === 'valid' && token !== null ? (
          <>
            <p className="text-foreground-muted">{t('confirm.description')}</p>
            <NewsletterForm
              headingLevel="h2"
              action={confirmNewsletter}
              labels={{
                submit: t('confirm.submit'),
                pending: t('confirm.pending'),
                doneHeading: t('confirm.doneHeading'),
                done: t('confirm.done'),
                failures: {
                  'invalid-link': t('link.invalid'),
                  'rate-limited': t('result.rateLimited'),
                  unknown: t('result.unavailable'),
                },
              }}
              next={{ href: localizedPath(locale, '/news'), text: t('confirm.next') }}
            >
              <input type="hidden" name="token" value={token} />
            </NewsletterForm>
          </>
        ) : (
          <div className="flex flex-col gap-3">
            <Alert tone="warning">{t('link.invalid')}</Alert>
            <p className="flex items-start gap-2 text-sm text-foreground-muted">
              <Icon name="info" size={16} className="mt-[0.2em] shrink-0" />
              <span>
                {t('link.confirmHelp', { hours: NEWSLETTER_CONFIRMATION_HOURS })}
              </span>
            </p>
          </div>
        )}

        <TextLink href={localizedPath(locale, '/newsletter')}>{t('link.back')}</TextLink>
      </div>
    </Container>
  );
}
