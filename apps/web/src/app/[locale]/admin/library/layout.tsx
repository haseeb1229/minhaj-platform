import type { ReactNode } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { getTranslations } from 'next-intl/server';

import { requireOwnSession } from '@/composition/authorization';
import { identityRuntime } from '@/composition/identity';
import { requireLocale } from '@/config/route-locale';
import { WorkspaceNav } from '@/components/workspace/workspace-nav';

/**
 * The Library administration shell (ROUTE_MAP.md §7, and this phase's §17).
 *
 * THE ROUTE MAP'S LIBRARY FAMILIES (ROUTE_MAP.md §7). `works`, `editions`,
 * `translations` and `sale-points` are Phase 8's; `research` (with research papers
 * beneath it), `publications`, `magazines` (with their issues beneath each) and
 * `encyclopedias` are Phase 9's. No family has a permission key of its own:
 * `library.read` opens every one and `library.administer` is what each action
 * re-checks.
 *
 * `noindex, nofollow` FOR THE WHOLE SUBTREE, inherited from the parent
 * administrative layout and restated here because a privileged surface in a search
 * index would disclose the platform's shape to everyone (ROUTE_MAP.md §7, §9.6).
 *
 * THE NAVIGATION IS FILTERED BY PERMISSION, AND THAT IS PRESENTATION ONLY. Hiding a
 * link somebody cannot use is a kindness, not a control: every page beneath
 * re-checks `library.read` server-side and every action re-checks
 * `library.administer` again, so a hand-typed URL reaches the same refusal
 * (SECURITY_BASELINE.md §3.4 rule 1).
 *
 * ONE NAV ENTRY PER SURFACE, ALL GATED ON THE SAME KEY, because `library.read`
 * genuinely opens all of them — a key per family for one authority would be links
 * that appear and disappear together (see the permission catalogue's own note).
 *
 * THE CLIENT PROVIDER CARRIES THREE STRINGS. `error.tsx` and the form islands are
 * Client Components and need their copy; handing them the whole catalogue would ship
 * every locale's administrative messages to the browser for the sake of three
 * labels.
 */
export const metadata = { robots: { index: false, follow: false } };

/** PER REQUEST, always. Every page beneath reads a session and a permission set. */
export const dynamic = 'force-dynamic';

const SURFACES = [
  'works',
  'editions',
  'translations',
  'sale-points',
  'research',
  'publications',
  'magazines',
  'encyclopedias',
] as const;

export default async function LibraryAdminLayout({
  children,
  params,
}: {
  readonly children: ReactNode;
  readonly params: Promise<{ readonly locale: string }>;
}) {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'library' });

  const active = await requireOwnSession(locale);
  const held = active
    ? (await identityRuntime().authorization.evaluate(active.session)).permissions
    : new Set<string>();

  return (
    <>
      {held.has('library.read') ? (
        <WorkspaceNav
          label={t('title')}
          variant="tabs"
          groups={[
            {
              key: 'library',
              links: SURFACES.map((surface) => ({
                key: surface,
                href: `/${locale}/admin/library/${surface}`,
                text: t(`admin.${surface}`),
              })),
            },
          ]}
        />
      ) : null}

      <NextIntlClientProvider
        locale={locale}
        messages={{
          library: {
            unknown: t('unknown'),
            reload: t('reload'),
            loading: t('loading'),
          },
        }}
      >
        {children}
      </NextIntlClientProvider>
    </>
  );
}
