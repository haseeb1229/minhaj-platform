import { notFound, redirect } from 'next/navigation';

import { requireOwnSession } from '@/composition/authorization';
import { identityRuntime } from '@/composition/identity';
import { requireLocale } from '@/config/route-locale';

/**
 * `/{locale}/admin/learning` — the area root, and nothing else
 * (ROUTE_MAP.md §7; the Fatwa-area precedent).
 *
 * Since Phase 23 two key families open this area: the catalogue's
 * `learning.read` and the classes' `learning.classes.read`. Each holder is sent
 * to the first surface their keys open; holding neither is the administrative
 * 404. The destination re-checks its own key — this redirect decides nothing.
 */
export const dynamic = 'force-dynamic';

export default async function LearningAdminRoot({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}) {
  const locale = await requireLocale(params);
  const base = `/${locale}/admin/learning`;
  const active = await requireOwnSession(locale);
  if (active === null) redirect(`/${locale}/signin?returnTo=${encodeURIComponent(base)}`);
  const held = (await identityRuntime().authorization.evaluate(active.session))
    .permissions;
  if (held.has('learning.read')) redirect(`${base}/courses`);
  if (held.has('learning.classes.read')) redirect(`${base}/classes`);
  notFound();
}
