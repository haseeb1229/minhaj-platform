import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { libraryReadRuntime } from '@/composition/library-read';
import { ScholarlyDetail, scholarlyMetadataInput } from '@/components/library/scholarly';
import { requireLocale } from '@/config/route-locale';
import { contentMetadata } from '@/seo/metadata';

/**
 * `/{locale}/library/magazines/{slug}/issues/{issueSlug}` — one issue, beneath
 * its Magazine (ROUTE_MAP.md §3.6).
 *
 * Public only while BOTH the issue and its Magazine are published. A former
 * Magazine slug, a former issue slug, or both, are answered by the request proxy
 * with ONE 301 to the current full address — never a chain.
 */
export const dynamic = 'force-dynamic';

interface IssueParams {
  readonly params: Promise<{
    readonly locale: string;
    readonly slug: string;
    readonly issueSlug: string;
  }>;
}

export async function generateMetadata({ params }: IssueParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const { slug, issueSlug } = await params;
  const record = await libraryReadRuntime().magazineIssue(slug, issueSlug);
  if (record === null) return { robots: { index: false, follow: false } };
  return contentMetadata({ locale, ...scholarlyMetadataInput(locale, record) });
}

export default async function MagazineIssuePage({ params }: IssueParams) {
  const locale = await requireLocale(params);
  const { slug, issueSlug } = await params;
  const record = await libraryReadRuntime().magazineIssue(slug, issueSlug);
  if (record === null) notFound();
  return <ScholarlyDetail locale={locale} record={record} />;
}
