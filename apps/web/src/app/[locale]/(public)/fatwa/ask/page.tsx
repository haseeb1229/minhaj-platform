import { redirect } from 'next/navigation';

import { requireLocale } from '@/config/route-locale';

/**
 * `/{locale}/fatwa/ask` — the public entry to asking (ROUTE_MAP.md §3.8).
 *
 * IT READS NOTHING AND DECIDES NOTHING. The public tree has no session, cookie
 * or header access (ARCHITECTURE.md §8.1), so this route cannot know whether
 * the visitor is signed in — and does not try. It sends EVERY visitor to the
 * Fatwa-owned, authenticated `/my/questions/ask`, whose own guard sends an
 * anonymous visitor through sign-in with a validated return path back to it.
 */
export const dynamic = 'force-dynamic';

export const metadata = { robots: { index: false, follow: false } };

export default async function FatwaAskRoute({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}) {
  const locale = await requireLocale(params);
  redirect(`/${locale}/my/questions/ask`);
}
