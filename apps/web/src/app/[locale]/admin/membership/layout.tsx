import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { NextIntlClientProvider } from 'next-intl';
import { getTranslations } from 'next-intl/server';

import { requireOwnSession } from '@/composition/authorization';
import { identityRuntime } from '@/composition/identity';
import { requireLocale } from '@/config/route-locale';
import { TextLink } from '@/components/ui';

/**
 * The Membership administration shell (DELIVERY_PLAN.md Phase 26):
 * `/admin/membership` — the types, their words and lifecycle, and the members
 * — and `/admin/membership/applications`, the queue and each application.
 *
 * ONE KEY OPENS IT, ANOTHER ACTS. `membership.read` opens every screen here;
 * every create, edit, publication, review, decision and closure re-checks
 * `membership.administer` in its own Server Action, and the service checks
 * both again, live. Both are ordinary keys bundled into the Platform
 * Administrator role; neither changes what any account may do, so no act
 * here is a step-up operation.
 *
 * `noindex, nofollow` for the whole subtree and rendered per request. A
 * signed-in session without `membership.read` is refused HERE, above the
 * area's loading boundary, so the refusal is a real 404 status; a signed-out
 * visitor reaches the page's own guard, which sends them to sign in.
 *
 * OPERATOR TEXT NEVER WIDENS THE PAGE. A type's words may hold a long
 * unbroken token, and may break anywhere rather than push a phone-width
 * screen sideways.
 *
 * THE CLIENT PROVIDER CARRIES THREE STRINGS — the error boundary's copy.
 */
export const metadata = { robots: { index: false, follow: false } };

export const dynamic = 'force-dynamic';

const SURFACES = [
  { key: 'types', path: '' },
  { key: 'applications', path: '/applications' },
] as const;

export default async function MembershipAdminLayout({
  children,
  params,
}: {
  readonly children: ReactNode;
  readonly params: Promise<{ readonly locale: string }>;
}) {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'adminMembership' });

  const active = await requireOwnSession(locale);
  const held = active
    ? (await identityRuntime().authorization.evaluate(active.session)).permissions
    : new Set<string>();
  if (active !== null && !held.has('membership.read')) notFound();

  return (
    <>
      {active === null ? null : (
        <nav className="flex flex-wrap gap-4" aria-label={t('title')}>
          {SURFACES.map((surface) => (
            <TextLink
              key={surface.key}
              href={`/${locale}/admin/membership${surface.path}`}
            >
              {t(`surface.${surface.key}`)}
            </TextLink>
          ))}
        </nav>
      )}

      <NextIntlClientProvider
        locale={locale}
        messages={{
          adminMembership: {
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
