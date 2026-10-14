import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { NextIntlClientProvider } from 'next-intl';
import { getTranslations } from 'next-intl/server';

import { NEWSLETTER_PERMISSIONS } from '@minhaj/contracts/personalisation';

import { requireOwnSession } from '@/composition/authorization';
import { identityRuntime } from '@/composition/identity';
import { requireLocale } from '@/config/route-locale';

/**
 * The newsletter operator surface's shell (ROUTE_MAP.md §7:
 * `/admin/communications/newsletter`), Phase 21.
 *
 * `noindex, nofollow` and rendered per request, like everything under
 * `/admin`: the page reads a session and privilege state (§17).
 *
 * A signed-in session without `newsletter.read` is refused HERE, above the
 * loading boundary, so the refusal is a real 404 status rather than a 404 page
 * streamed under a 200. A signed-out visitor falls through to the page's own
 * guard, which sends them to sign in; the page and every action still re-check
 * their own key (SECURITY_BASELINE.md §3.4 rule 1).
 *
 * THE CLIENT PROVIDER CARRIES TWO STRINGS — the error boundary's copy — rather
 * than shipping the surface's messages to the browser.
 */
export const metadata = { robots: { index: false, follow: false } };

export const dynamic = 'force-dynamic';

export default async function NewsletterAdminLayout({
  children,
  params,
}: {
  readonly children: ReactNode;
  readonly params: Promise<{ readonly locale: string }>;
}) {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'newsletter.admin' });

  const active = await requireOwnSession(locale);
  if (active !== null) {
    const held = await identityRuntime().authorization.evaluate(active.session);
    if (!held.can(NEWSLETTER_PERMISSIONS.read)) notFound();
  }

  return (
    <NextIntlClientProvider
      locale={locale}
      messages={{ newsletter: { admin: { unknown: t('unknown'), reload: t('reload') } } }}
    >
      {children}
    </NextIntlClientProvider>
  );
}
