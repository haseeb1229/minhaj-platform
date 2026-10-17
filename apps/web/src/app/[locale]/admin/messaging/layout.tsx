import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { NextIntlClientProvider } from 'next-intl';
import { getTranslations } from 'next-intl/server';

import { requireOwnSession } from '@/composition/authorization';
import { identityRuntime } from '@/composition/identity';
import { requireLocale } from '@/config/route-locale';
import { TextLink } from '@/components/ui';
import { MESSAGING_KEYS, MESSAGING_SURFACES } from './shared';

/**
 * The Messaging administration shell (ROUTE_MAP.md §7:
 * `/admin/messaging/{support|moderation|reports}`), Phase 24.
 *
 * TWO KEYS, NEITHER IMPLYING THE OTHER. `messaging.support` opens the support
 * queue and lets its holder claim, answer and resolve support conversations;
 * `messaging.moderate` opens the reports, their bounded evidence and the
 * moderation decision. Both are EXTERNALLY GATED: no administrator bundle
 * confers them, and a Platform Administrator without an explicit assignment
 * sees neither.
 *
 * CONTENT IS NEVER LISTED. The queues show identifiers, states and times only;
 * reading a support conversation or a report's evidence is a separate,
 * audited act on its own page.
 *
 * `noindex, nofollow` for the whole subtree and rendered per request. A
 * signed-in session holding neither key is refused HERE, above the area's
 * loading boundary, so the refusal is a real 404 status; every page and every
 * action re-checks its own key, and the service checks it again, live.
 *
 * THE CLIENT PROVIDER CARRIES THREE STRINGS — the error boundary's copy.
 */
export const metadata = { robots: { index: false, follow: false } };

export const dynamic = 'force-dynamic';

export default async function MessagingAdminLayout({
  children,
  params,
}: {
  readonly children: ReactNode;
  readonly params: Promise<{ readonly locale: string }>;
}) {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'adminMessaging' });

  const active = await requireOwnSession(locale);
  const held = active
    ? (await identityRuntime().authorization.evaluate(active.session)).permissions
    : new Set<string>();
  if (active !== null && !MESSAGING_KEYS.some((key) => held.has(key))) notFound();

  const visible = MESSAGING_SURFACES.filter((surface) => held.has(surface.permission));

  return (
    <>
      {visible.length === 0 ? null : (
        <nav className="flex flex-wrap gap-4" aria-label={t('title')}>
          {visible.map((surface) => (
            <TextLink
              key={surface.key}
              href={`/${locale}/admin/messaging/${surface.key}`}
            >
              {t(`surface.${surface.key}`)}
            </TextLink>
          ))}
        </nav>
      )}

      <NextIntlClientProvider
        locale={locale}
        messages={{
          adminMessaging: {
            unknown: t('unknown'),
            reload: t('reload'),
            loading: t('loading'),
          },
        }}
      >
        <div className="min-w-0 wrap-anywhere">{children}</div>
      </NextIntlClientProvider>
    </>
  );
}
