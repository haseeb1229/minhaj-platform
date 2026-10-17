import { getTranslations } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';

import type { PermissionKey } from '@minhaj/contracts/identity';

import { requireOwnSession } from '@/composition/authorization';
import { identityRuntime } from '@/composition/identity';
import { requireLocale } from '@/config/route-locale';
import { PageHeading, TextLink } from '@/components/ui';

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
 * (SECURITY_BASELINE.md §3.4 rule 1).
 *
 * Phase 4 owns the canonical application shell. This is the minimum an
 * administrative surface needs to be navigable, built from the same shared
 * primitives rather than styled locally (ARCHITECTURE.md §13).
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

/**
 * Each surface, the permission that opens it, and where it lives. A list of
 * permissions means ANY one of them opens the entry.
 */
const SURFACES: readonly {
  key: string;
  permission: PermissionKey | readonly PermissionKey[];
  path: string;
}[] = [
  { key: 'editorial', permission: 'content.read', path: 'editorial/articles' },
  {
    key: 'correspondence',
    permission: 'correspondence.read',
    path: 'editorial/correspondence',
  },
  { key: 'users', permission: 'users.read', path: 'identity/users' },
  { key: 'roles', permission: 'roles.read', path: 'identity/roles' },
  { key: 'permissions', permission: 'permissions.read', path: 'identity/permissions' },
  { key: 'assignments', permission: 'assignments.read', path: 'identity/assignments' },
  { key: 'security', permission: 'security.read', path: 'identity/security' },
  // Phase 3B. One nav entry for the taxonomy area: `taxonomy.read` opens all
  // four of its surfaces, and four entries for one permission would be four
  // links that appear and disappear together.
  { key: 'taxonomy', permission: 'taxonomy.read', path: 'taxonomy/topics' },
  // Phase 5. One nav entry for the People area, for the same reason Taxonomy
  // has one: `people.read` opens all five of its surfaces, and five entries for
  // one permission would be five links that appear and disappear together.
  { key: 'people', permission: 'people.read', path: 'people/persons' },
  // Phase 8. One entry for the Library area: `library.read` opens all of its
  // surfaces — Phase 9's included — so an entry per surface would be links that
  // appear and disappear together.
  { key: 'library', permission: 'library.read', path: 'library/works' },
  // Phase 10. One entry for Media: `media.read` opens its three surfaces —
  // videos, series and playlists — and every action re-checks
  // `media.administer`.
  { key: 'media', permission: 'media.read', path: 'media/videos' },
  // Phase 16. One entry for the Global Network: `global.read` opens its four
  // surfaces — Countries, Regions, Cities and Centres — and every action
  // re-checks `global.administer`.
  { key: 'global', permission: 'global.read', path: 'global/countries' },
  // Phase 18. One entry for the Quran area: `quran.read` opens all of its
  // surfaces, every layered-work action re-checks `quran.administer`, and the
  // one canonical correction needs `quran.editCanonical` with its own step-up.
  { key: 'quran', permission: 'quran.read', path: 'quran/surahs' },
  // Phase 19. One entry for the Hadith area, never folded into the Quran's:
  // `hadith.read` opens all of its surfaces, every layered-work action
  // re-checks `hadith.administer`, and every sourced write needs
  // `hadith.editCanonical` with its own step-up.
  { key: 'hadith', permission: 'hadith.read', path: 'hadith/records' },
  // Phase 20. One entry for the Fatwa area, opened by ANY of its three stage
  // keys — none implies another, and no administrator key confers them. The
  // area's root sends each holder to the first stage their keys open.
  {
    key: 'fatwa',
    permission: ['question.receive', 'fatwa.answer', 'fatwa.publish'],
    path: 'fatwa',
  },
  // Phase 22. One entry for Learning: `learning.read` opens its courses, paths
  // and the enrolment and trial-request COUNTS; every catalogue action
  // re-checks `learning.administer`. There is no classes surface yet.
  // Phase 23: the class keys open the same entry. The Learning area root
  // sends each holder to the first surface their keys open.
  {
    key: 'learning',
    permission: ['learning.read', 'learning.classes.read'],
    path: 'learning',
  },
  // Phase 24. One entry for Messaging, opened by EITHER of its two externally
  // gated keys — support staff and moderators are different people, and
  // neither key implies the other. The area root sends each holder to the
  // first surface their key opens.
  {
    key: 'messaging',
    permission: ['messaging.support', 'messaging.moderate'],
    path: 'messaging',
  },
  // Phase 4. A READ-ONLY view of the public shell's effective navigation; the
  // registry behind it is code, so there is no editing surface to reach.
  { key: 'navigation', permission: 'navigation.read', path: 'system/navigation' },
  { key: 'audit', permission: 'audit.read', path: 'system/audit' },
  { key: 'integrations', permission: 'integrations.read', path: 'system/integrations' },
  { key: 'delivery', permission: 'delivery.read', path: 'communications/delivery' },
  // Phase 21. Newsletter subscription and suppression state under
  // Personalisation & Notifications. `newsletter.read` opens the page; the
  // suppress and reinstate actions re-check `newsletter.operate`, which alone
  // opens nothing here, so it does not show the entry.
  { key: 'newsletter', permission: 'newsletter.read', path: 'communications/newsletter' },
  // Phase 17. Indexing lag and failures; operating the indexer needs
  // `search.operate` as well, re-checked by every action.
  { key: 'search', permission: 'search.read', path: 'system/search' },
];

export default async function AdminLayout({ children, params }: LayoutProps) {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'admin' });

  const active = await requireOwnSession(locale);
  if (active === null) {
    redirect(
      '/' + locale + '/signin?returnTo=' + encodeURIComponent('/' + locale + '/admin'),
    );
  }

  const held = (await identityRuntime().authorization.evaluate(active.session))
    .permissions;

  const visible = SURFACES.filter((surface) =>
    typeof surface.permission === 'string'
      ? held.has(surface.permission)
      : surface.permission.some((permission) => held.has(permission)),
  );
  if (visible.length === 0) notFound();

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8">
      <header className="flex flex-col gap-2">
        <PageHeading>{t('title')}</PageHeading>
        <p className="text-sm text-[color:var(--color-foreground-muted)]">
          {t('description')}
        </p>
      </header>

      <nav aria-label={t('title')}>
        <ul className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
          <li>
            <TextLink href={`/${locale}/admin`}>{t('nav.dashboard')}</TextLink>
          </li>
          {visible.map((surface) => (
            <li key={surface.key}>
              <TextLink href={`/${locale}/admin/${surface.path}`}>
                {t(`nav.${surface.key}` as 'nav.users')}
              </TextLink>
            </li>
          ))}
        </ul>
      </nav>

      {children}
    </div>
  );
}
