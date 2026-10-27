import { getTranslations } from 'next-intl/server';

import { requireOwnSession } from '@/composition/authorization';
import { identityRuntime } from '@/composition/identity';
import { requireLocale } from '@/config/route-locale';
import { notFound, redirect } from 'next/navigation';
import { Alert, CardGrid, LinkCard, PageHeading, TextLink } from '@/components/ui';
import { groupedSurfaces, reachableSurfaces } from './surfaces';

/**
 * The administrative landing page.
 *
 * It composes what the CALLER may actually reach, and nothing else. A dashboard
 * that listed every surface and let the unreachable ones 404 would be a map of
 * the platform's privileged shape handed to anyone with an account
 * (SECURITY_BASELINE.md §1.5).
 *
 * Its policy is the union of the delivered administrative read permissions —
 * the SAME list the shell's navigation is filtered from (`./surfaces`), so a
 * holder of one domain's key alone (Fatwa, Learning, Messaging, Membership…)
 * finds that area here as well as in the navigation, and the two never
 * disagree. An account holding none receives the same 404 as any other denied
 * admin route; rendering even an empty shell would contradict the route-map
 * rule that every admin route is permission checked server-side.
 *
 * Each card says what the area holds, grouped by purpose. The groups are
 * wayfinding, never ownership: each area remains its own context's.
 */
export const metadata = { robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function AdminDashboard({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}) {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'admin' });

  const active = await requireOwnSession(locale);
  if (active === null) {
    redirect(`/${locale}/signin?returnTo=${encodeURIComponent(`/${locale}/admin`)}`);
  }

  const { authorization, privilegedSecurity } = identityRuntime();
  const held = await authorization.evaluate(active.session);
  const posture = await privilegedSecurity.describe(active.session.account.id);

  const reachable = reachableSurfaces(held.permissions);
  if (reachable.length === 0) notFound();

  return (
    <main className="flex min-w-0 flex-col gap-8">
      <header className="flex flex-col gap-2">
        <PageHeading>{t('nav.dashboard')}</PageHeading>
        <p className="text-foreground-muted">{t('home.description')}</p>
      </header>

      {/*
       * The one thing a freshly bootstrapped administrator most needs to be
       * told, said before anything else: the role is held, and no privileged
       * change will work until the second factor and its recovery codes are
       * finished (SECURITY_BASELINE.md §8.3).
       */}
      {posture.complete ? null : (
        <Alert tone="warning">
          {t('denied.secondFactorRequired')}{' '}
          <TextLink href={`/${locale}/my/settings/security`}>
            {t('security.manage')}
          </TextLink>
        </Alert>
      )}

      {groupedSurfaces(reachable).map(({ group, surfaces }) => (
        <section key={group} className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">{t(`groups.${group}`)}</h2>
          <CardGrid columns={2}>
            {surfaces.map((surface) => (
              <LinkCard
                key={surface.key}
                href={`/${locale}/admin/${surface.path}`}
                title={t(`nav.${surface.key}`)}
                description={t(`summary.${surface.key}`)}
              />
            ))}
          </CardGrid>
        </section>
      ))}
    </main>
  );
}
