import { localizedPath } from '@minhaj/contracts';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { newsletterReadRuntime } from '@/composition/newsletter-read';
import { Alert, Container, Icon, PageHeading, TextLink } from '@/components/ui';
import { requireLocale } from '@/config/route-locale';
import { unsubscribeNewsletter } from '../actions';
import { NewsletterForm } from '../newsletter-form';

/**
 * The emailed newsletter unsubscribe link — protocol class D
 * (SECURITY_BASELINE.md §7.4, ROUTE_MAP.md §4).
 *
 * NO SIGN-IN, AND NO MUTATION ON GET. Unsubscribing never needs an account
 * (DOMAIN_MODEL.md §14.5), and opening the link only renders a button: a
 * scanner or prefetcher that follows it unsubscribes nobody. The POST does it,
 * and is idempotent — the same link pressed again answers the same.
 *
 * MARKETING MAIL ONLY. Leaving the newsletter never suppresses security or
 * account-service mail; the page says so, because a person deciding whether to
 * press the button should know.
 *
 * `noindex, nofollow`, per request, with no canonical, alternates or
 * structured data, and the token only in the hidden field the POST carries.
 */
export const dynamic = 'force-dynamic';

interface LinkParams {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: LinkParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'newsletter' });

  return { title: t('unsubscribe.title'), robots: { index: false, follow: false } };
}

export default async function NewsletterUnsubscribePage({
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
      : await newsletterReadRuntime().linkStatus('unsubscribe', token);

  return (
    <Container>
      <div className="flex max-w-md flex-col gap-6 py-12">
        <PageHeading>{t('unsubscribe.title')}</PageHeading>

        {status === 'valid' && token !== null ? (
          <>
            <p className="text-foreground-muted">{t('unsubscribe.description')}</p>
            <NewsletterForm
              headingLevel="h2"
              action={unsubscribeNewsletter}
              labels={{
                submit: t('unsubscribe.submit'),
                pending: t('unsubscribe.pending'),
                doneHeading: t('unsubscribe.doneHeading'),
                done: t('unsubscribe.done'),
                failures: {
                  'invalid-link': t('link.invalid'),
                  'rate-limited': t('result.rateLimited'),
                  unknown: t('result.unavailable'),
                },
              }}
            >
              <input type="hidden" name="token" value={token} />
            </NewsletterForm>
          </>
        ) : (
          <div className="flex flex-col gap-3">
            <Alert tone="warning">{t('link.invalid')}</Alert>
            <p className="flex items-start gap-2 text-sm text-foreground-muted">
              <Icon name="info" size={16} className="mt-[0.2em] shrink-0" />
              <span>{t('link.unsubscribeHelp')}</span>
            </p>
          </div>
        )}

        <TextLink href={localizedPath(locale, '/newsletter')}>{t('link.back')}</TextLink>
      </div>
    </Container>
  );
}
