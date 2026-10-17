import { notFound, redirect } from 'next/navigation';

import { requireOwnSession } from '@/composition/authorization';
import { identityRuntime } from '@/composition/identity';
import { requireLocale } from '@/config/route-locale';
import { MESSAGING_SURFACES } from './shared';

/**
 * `/{locale}/admin/messaging` — no screen of its own (the Fatwa and Learning
 * precedent). It sends each holder to the first surface their keys open: the
 * support queue for `messaging.support`, the moderation queue for
 * `messaging.moderate`. Holding neither is the administrative 404. The
 * destination re-checks its own key — this redirect decides nothing.
 */
export const dynamic = 'force-dynamic';

export default async function MessagingAdminRoot({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}) {
  const locale = await requireLocale(params);
  const base = `/${locale}/admin/messaging`;
  const active = await requireOwnSession(locale);
  if (active === null) redirect(`/${locale}/signin?returnTo=${encodeURIComponent(base)}`);
  const held = (await identityRuntime().authorization.evaluate(active.session))
    .permissions;
  const first = MESSAGING_SURFACES.find((surface) => held.has(surface.permission));
  if (first === undefined) notFound();
  redirect(`${base}/${first.key}`);
}
