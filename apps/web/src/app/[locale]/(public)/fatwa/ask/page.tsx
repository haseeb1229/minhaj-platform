import { localizedPath } from '@minhaj/contracts';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { FatwaAwaiting } from '@/components/fatwa/guide';
import { fatwaAvailability } from '@/components/fatwa/read';
import { requireLocale } from '@/config/route-locale';

/**
 * `/{locale}/fatwa/ask` — the public entry to asking (ROUTE_MAP.md §3.8).
 *
 * IT READS NO SESSION AND DECIDES NO AUTHORITY. The public tree has no
 * session, cookie or header access (ARCHITECTURE.md §8.1), so this route
 * cannot know whether the visitor is signed in — and does not try. It reads
 * one thing, through Fatwa's session-free public reader: whether the service
 * is activated.
 *
 *   ACTIVE    — every visitor is sent to the Fatwa-owned, authenticated
 *               `/my/questions/ask`, whose own guard sends an anonymous
 *               visitor through sign-in with a validated return path back to
 *               it (Phase 20, unchanged).
 *   INACTIVE  — the page awaits the service (`FatwaAwaiting`, Fatwa Part 1):
 *               it says why asking is closed and renders NO form, so nobody is
 *               sent through sign-in only to find nothing to fill in, and no
 *               sensitive text can be typed into a service nobody is
 *               authorised to answer. The question action and the database
 *               refuse a question without an activation regardless.
 *
 * `noindex` in both states: asking is a private flow, never a search result.
 */
export const dynamic = 'force-dynamic';

interface AskParams {
  readonly params: Promise<{ readonly locale: string }>;
}

export async function generateMetadata({ params }: AskParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'fatwa' });
  return {
    title: t('sections.ask'),
    description: t('sectionBody.ask'),
    robots: { index: false, follow: false },
  };
}

export default async function FatwaAskRoute({ params }: AskParams) {
  const locale = await requireLocale(params);
  if (!(await fatwaAvailability()).active)
    return <FatwaAwaiting locale={locale} section="ask" />;
  redirect(localizedPath(locale, '/my/questions/ask'));
}
