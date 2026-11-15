import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { LibraryTopicsPage } from '@/components/library/topics';
import { bareRedirect } from '@/components/library/browse-view';
import { requireLocale } from '@/config/route-locale';
import { shellMetadata } from '@/seo/metadata';
import { requireRoute } from '@/shell/registry';

/**
 * `/{locale}/library/topics` — the Library by subject: Taxonomy's active
 * Topics, grouped by subject area, each with its public records by kind and
 * each count leading to that kind's listing narrowed to the Topic (Library
 * Part 2; ROUTE_MAP.md §3.6). Taxonomy remains the owner; the composition is
 * Layer 4's. One view: a former `?offset=` is one redirect to the page.
 *
 * `force-dynamic`, because every figure here is data an administrator
 * changes: a cached copy would keep offering a record since withdrawn. Signed
 * out, always — nothing here reaches Identity or a cookie.
 */
export const dynamic = 'force-dynamic';

interface BrowseParams {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: BrowseParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'library' });

  return shellMetadata({
    locale,
    route: requireRoute('library.topics'),
    title: t('section.topics'),
    description: t('sectionBody.topics'),
  });
}

export default async function Page({ params, searchParams }: BrowseParams) {
  const locale = await requireLocale(params);
  const query = await searchParams;
  const canonical = bareRedirect(locale, '/library/topics', query);
  if (canonical !== null) redirect(canonical);
  return <LibraryTopicsPage locale={locale} />;
}
