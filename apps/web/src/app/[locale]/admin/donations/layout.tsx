import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { NextIntlClientProvider } from 'next-intl';
import { getTranslations } from 'next-intl/server';

import { requireOwnSession } from '@/composition/authorization';
import { identityRuntime } from '@/composition/identity';
import { requireLocale } from '@/config/route-locale';
import { WorkspaceNav } from '@/components/workspace/workspace-nav';

/**
 * The Donations administration shell (DELIVERY_PLAN.md Phase 27):
 * `/admin/donations` — the donation records, each record's detail with its
 * refunds — and `/admin/donations/campaigns`, the campaigns and their
 * currency policies.
 *
 * THREE KEYS, NONE IMPLYING ANOTHER. `donations.read` opens every screen
 * here; every campaign change and every reconciliation re-checks
 * `donations.administer` in its own Server Action; a refund needs
 * `donations.refund` — externally gated, bundled into no role — with a live
 * `donation-refund` step-up. The service checks each again, live, and the
 * database refuses a refund without both a third time.
 *
 * `noindex, nofollow` for the whole subtree and rendered per request. A
 * signed-in session without `donations.read` is refused HERE, above the
 * area's loading boundary, so the refusal is a real 404 status; a signed-out
 * visitor reaches the page's own guard, which sends them to sign in.
 *
 * THE CLIENT PROVIDER CARRIES THREE STRINGS — the error boundary's copy.
 */
export const metadata = { robots: { index: false, follow: false } };

export const dynamic = 'force-dynamic';

const SURFACES = [
  { key: 'records', path: '' },
  { key: 'campaigns', path: '/campaigns' },
] as const;

export default async function DonationsAdminLayout({
  children,
  params,
}: {
  readonly children: ReactNode;
  readonly params: Promise<{ readonly locale: string }>;
}) {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'adminDonations' });

  const active = await requireOwnSession(locale);
  const held = active
    ? (await identityRuntime().authorization.evaluate(active.session)).permissions
    : new Set<string>();
  if (active !== null && !held.has('donations.read')) notFound();

  return (
    <>
      {active === null ? null : (
        <WorkspaceNav
          label={t('title')}
          variant="tabs"
          groups={[
            {
              key: 'donations',
              links: SURFACES.map((surface) => ({
                key: surface.key,
                href: `/${locale}/admin/donations${surface.path}`,
                text: t(`surface.${surface.key}`),
              })),
            },
          ]}
        />
      )}

      <NextIntlClientProvider
        locale={locale}
        messages={{
          adminDonations: {
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
