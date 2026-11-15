import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { LibraryAuthorsPage } from '@/components/library/authors';
import {
  authorsCanonicalRedirect,
  readAuthorsView,
} from '@/components/library/browse-view';
import { requireLocale } from '@/config/route-locale';
import { shellMetadata } from '@/seo/metadata';
import { requireRoute } from '@/shell/registry';

/**
 * `/{locale}/library/authors` — the contributor directory: everyone credited
 * on a public Work, named by People, with their roles and books,
 * `?letter, role, q, page` (Library Part 2; ROUTE_MAP.md §3.6). A name opens
 * the canonical People profile; `/library/authors/{slug}` still 301s there.
 * One address per view: a form's empty controls, another order, a malformed
 * value or a former `?offset=` is one redirect to the canonical spelling.
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
    route: requireRoute('library.authors'),
    title: t('section.authors'),
    description: t('sectionBody.authors'),
  });
}

export default async function Page({ params, searchParams }: BrowseParams) {
  const locale = await requireLocale(params);
  const query = await searchParams;
  const canonical = authorsCanonicalRedirect(locale, query);
  if (canonical !== null) redirect(canonical);
  return <LibraryAuthorsPage locale={locale} view={readAuthorsView(query, locale)} />;
}
