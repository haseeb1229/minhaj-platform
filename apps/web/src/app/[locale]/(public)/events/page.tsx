import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { EventsPage } from '@/components/editorial/events';
import { requireLocale } from '@/config/route-locale';
import { shellMetadata } from '@/seo/metadata';
import { requireRoute } from '@/shell/registry';

/**
 * `/{locale}/events` — upcoming Events by default, `?when=past` for those that
 * have ended, narrowed by `?country=`, `?city=` and `?centre=` (ROUTE_MAP.md
 * §3.9). Every query is canonical to `/events` and none is a sitemap entry
 * (§2.3). `force-dynamic`: what is upcoming is decided by the server's clock on
 * every request, and Events are published and withdrawn.
 */
export const dynamic = 'force-dynamic';

interface EventsParams {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: EventsParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'events' });
  return shellMetadata({
    locale,
    route: requireRoute('events'),
    title: t('title'),
    description: t('description'),
  });
}

export default async function EventsRoute({ params, searchParams }: EventsParams) {
  const locale = await requireLocale(params);
  return <EventsPage locale={locale} query={await searchParams} />;
}
