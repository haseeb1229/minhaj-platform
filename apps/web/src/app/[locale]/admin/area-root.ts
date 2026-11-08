import 'server-only';

import { localizedPath } from '@minhaj/contracts';
import { notFound, redirect } from 'next/navigation';

import { requireOwnSession } from '@/composition/authorization';
import { identityRuntime } from '@/composition/identity';
import { requireLocale } from '@/config/route-locale';
import { reachableSurfaces } from './surfaces';

/**
 * AN AREA'S ROOT ADDRESS (R2, audit F30) — `/admin/quran`, `/admin/identity`,
 * `/admin/system`… — sends the reader to the first surface of that area their
 * keys open, in the navigation's own order (`./surfaces`); holding none is the
 * administrative 404, exactly as a hand-typed address beneath would answer.
 * Before R2 these addresses were 404s for everyone, which made a trimmed URL
 * look broken. The Fatwa, Learning and Messaging roots keep their own rules.
 *
 * It decides nothing: the destination re-checks its own permission.
 */
export function areaEntry(area: string, held: ReadonlySet<string>): string | null {
  const surface = reachableSurfaces(held).find(
    (entry) =>
      entry.path === area ||
      entry.path.startsWith(`${area}/`) ||
      ('area' in entry && entry.area === area),
  );
  return surface === undefined ? null : surface.path;
}

export async function enterArea(
  params: Promise<{ readonly locale: string }>,
  area: string,
): Promise<never> {
  const locale = await requireLocale(params);
  const active = await requireOwnSession(locale);
  if (active === null)
    redirect(
      localizedPath(
        locale,
        `/signin?returnTo=${encodeURIComponent(localizedPath(locale, '/admin'))}`,
      ),
    );
  const held = (await identityRuntime().authorization.evaluate(active.session))
    .permissions;
  const entry = areaEntry(area, held);
  if (entry === null) notFound();
  redirect(localizedPath(locale, `/admin/${entry}`));
}
