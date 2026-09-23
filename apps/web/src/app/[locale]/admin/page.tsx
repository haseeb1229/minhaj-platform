import { getTranslations } from 'next-intl/server';

import type { PermissionKey } from '@minhaj/contracts/identity';

import { requireOwnSession } from '@/composition/authorization';
import { identityRuntime } from '@/composition/identity';
import { requireLocale } from '@/config/route-locale';
import { notFound, redirect } from 'next/navigation';
import { Alert, Panel, SectionHeading, TextLink } from '@/components/ui';

/**
 * The administrative landing page.
 *
 * It composes what the CALLER may actually reach, and nothing else. A dashboard
 * that listed every surface and let the unreachable ones 404 would be a map of
 * the platform's privileged shape handed to anyone with an account
 * (SECURITY_BASELINE.md §1.5).
 *
 * Its policy is the union of the currently delivered administrative read
 * permissions. An account holding none receives the same 404 as any other
 * denied admin route; rendering even an empty shell would contradict the
 * route-map rule that every admin route is permission checked server-side.
 */
export const metadata = { robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

const SURFACES: readonly {
  key:
    | 'users'
    | 'roles'
    | 'permissions'
    | 'assignments'
    | 'security'
    | 'taxonomy'
    | 'audit'
    | 'integrations'
    | 'delivery'
    | 'search';
  permission: PermissionKey;
  path: string;
}[] = [
  { key: 'users', permission: 'users.read', path: 'identity/users' },
  { key: 'roles', permission: 'roles.read', path: 'identity/roles' },
  { key: 'permissions', permission: 'permissions.read', path: 'identity/permissions' },
  { key: 'assignments', permission: 'assignments.read', path: 'identity/assignments' },
  { key: 'security', permission: 'security.read', path: 'identity/security' },
  { key: 'taxonomy', permission: 'taxonomy.read', path: 'taxonomy/topics' },
  { key: 'audit', permission: 'audit.read', path: 'system/audit' },
  { key: 'integrations', permission: 'integrations.read', path: 'system/integrations' },
  { key: 'delivery', permission: 'delivery.read', path: 'communications/delivery' },
  { key: 'search', permission: 'search.read', path: 'system/search' },
];

const DESCRIPTIONS = {
  users: 'users.description',
  roles: 'roles.description',
  permissions: 'permissions.description',
  assignments: 'assignments.description',
  security: 'security.description',
  taxonomy: 'taxonomy.description',
  audit: 'audit.description',
  integrations: 'integrations.description',
  delivery: 'delivery.description',
  search: 'search.description',
} as const;

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

  const reachable = SURFACES.filter((surface) => held.can(surface.permission));
  if (reachable.length === 0) notFound();

  return (
    <main className="flex flex-col gap-6">
      {/*
       * The one thing a freshly bootstrapped administrator most needs to be
       * told, said before anything else: the role is held, and no privileged
       * change will work until the second factor and its recovery codes are
       * finished (SECURITY_BASELINE.md §8.3).
       */}
      {reachable.length > 0 && !posture.complete ? (
        <Alert tone="warning">
          {t('denied.secondFactorRequired')}{' '}
          <TextLink href={`/${locale}/my/settings/security`}>
            {t('security.manage')}
          </TextLink>
        </Alert>
      ) : null}

      <ul className="grid gap-4 sm:grid-cols-2">
        {reachable.map((surface) => (
          <Panel key={surface.key} as="li">
            <div className="flex flex-col gap-2">
              <SectionHeading>
                <TextLink href={`/${locale}/admin/${surface.path}`}>
                  {t(`nav.${surface.key}` as 'nav.users')}
                </TextLink>
              </SectionHeading>
              <p className="text-sm text-[color:var(--color-foreground-muted)]">
                {t(DESCRIPTIONS[surface.key] as 'users.description')}
              </p>
            </div>
          </Panel>
        ))}
      </ul>
    </main>
  );
}
