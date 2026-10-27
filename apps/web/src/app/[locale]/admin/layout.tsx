import { getTranslations } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';

import { requireOwnSession } from '@/composition/authorization';
import { identityRuntime } from '@/composition/identity';
import { requireLocale } from '@/config/route-locale';
import { WorkspaceShell } from '@/components/workspace/parts';
import { WorkspaceNav } from '@/components/workspace/workspace-nav';
import { groupedSurfaces, reachableSurfaces } from './surfaces';

/**
 * The administrative shell.
 *
 * `noindex, nofollow` for the whole tree, and it inherits to every page beneath
 * (ROUTE_MAP.md §7, §9.6). An administrative surface that turned up in a search
 * index would disclose the platform's privileged shape to everyone.
 *
 * THE NAVIGATION IS FILTERED BY PERMISSION, and that is presentation only.
 * Hiding a link somebody cannot use is a kindness, not a control: every page
 * beneath re-checks its own permission server-side and every action re-checks
 * again, so a hand-typed URL reaches exactly the same refusal
 * (SECURITY_BASELINE.md §3.4 rule 1). The surfaces, their permissions and
 * their groups are one list in `./surfaces`, shared with the dashboard.
 *
 * THE WORKSPACE FRAME. The area's name is the document's first heading, in the
 * header band OUTSIDE `main`; each page's own `h1` sits inside its `main`. The
 * navigation is a grouped column beside the content on a wide screen and a
 * horizontal scroller on a narrow one, and the content column is wide enough
 * for an administrative table on a wide desktop (ARCHITECTURE.md §13.5).
 */
export const metadata = { robots: { index: false, follow: false } };

/**
 * PER REQUEST, always. Every page beneath reads a session and privilege state,
 * and a cached copy of any of it would be somebody else's (§17).
 */
export const dynamic = 'force-dynamic';

interface LayoutProps {
  readonly children: React.ReactNode;
  readonly params: Promise<{ readonly locale: string }>;
}

export default async function AdminLayout({ children, params }: LayoutProps) {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'admin' });
  const w = await getTranslations({ locale, namespace: 'workspace' });

  const active = await requireOwnSession(locale);
  if (active === null) {
    redirect(
      '/' + locale + '/signin?returnTo=' + encodeURIComponent('/' + locale + '/admin'),
    );
  }

  const held = (await identityRuntime().authorization.evaluate(active.session))
    .permissions;

  const visible = reachableSurfaces(held);
  if (visible.length === 0) notFound();

  const root = `/${locale}/admin`;

  return (
    <WorkspaceShell
      locale={locale}
      skipLabel={w('skip')}
      area={t('title')}
      areaIsHeading
      description={t('description')}
      width="wide"
      nav={
        <WorkspaceNav
          label={t('title')}
          variant="sidebar"
          groups={[
            {
              key: 'dashboard',
              links: [
                { key: 'dashboard', href: root, text: t('nav.dashboard'), exact: true },
              ],
            },
            ...groupedSurfaces(visible).map(({ group, surfaces }) => ({
              key: group,
              label: t(`groups.${group}`),
              links: surfaces.map((surface) => ({
                key: surface.key,
                href: `${root}/${surface.path}`,
                text: t(`nav.${surface.key}`),
                ...('area' in surface ? { also: [`${root}/${surface.area}`] } : {}),
              })),
            })),
          ]}
        />
      }
    >
      {children}
    </WorkspaceShell>
  );
}
