import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import {
  readScheduleQuery,
  scheduleCanonicalRedirect,
} from '@/components/live-learning/presentation';
import { LiveSchedulePage } from '@/components/live-learning/schedule';
import { requireLocale } from '@/config/route-locale';
import { shellMetadata } from '@/seo/metadata';
import { requireRoute } from '@/shell/registry';

/**
 * `/{locale}/learn/live` — Live Learning: the public schedule of upcoming
 * classes, `?course, teacher, language, offset` (ROUTE_MAP.md §3.5;
 * DELIVERY_PLAN.md Phase 23; Learn Part 2).
 *
 * Whether anything is shown is a RUNTIME fact of the live-learning activation,
 * so the route is `excluded` from the build-bound sitemap and `noindex`
 * (ROUTE_MAP.md §9.5), and `force-dynamic` because classes are scheduled,
 * moved and cancelled. ONE ADDRESS PER VIEW: a form's empty controls, another
 * order of the same filters or a zero offset is ONE redirect to the canonical
 * spelling; a malformed or repeated filter is answered in place, listing
 * nothing. Every view is canonical to this address. Nothing here reads a
 * session.
 */
export const dynamic = 'force-dynamic';

interface LiveParams {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: LiveParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'learnLive' });
  return shellMetadata({
    locale,
    route: requireRoute('learn.live'),
    title: t('title'),
    description: t('description'),
  });
}

export default async function LiveRoute({ params, searchParams }: LiveParams) {
  const locale = await requireLocale(params);
  const query = await searchParams;
  const canonical = scheduleCanonicalRedirect(locale, query);
  if (canonical !== null) redirect(canonical);
  return <LiveSchedulePage locale={locale} query={readScheduleQuery(query)} />;
}
