import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { PathDetailPage } from '@/components/learning/paths';
import { learningPathMetadata, readLearningPath } from '@/components/learning/read';
import { requireLocale } from '@/config/route-locale';

/**
 * `/{locale}/learn/paths/{slug}` — THE canonical address of one LearningPath
 * (ROUTE_MAP.md §3.5).
 *
 * PUBLISHED ONLY: a draft or archived path, and a malformed slug, is a 404. A
 * FORMER slug never reaches this page — the request proxy answers it with a
 * single 301 through Learning's own slug history (DOMAIN_MODEL.md §19.7). The
 * Courses it lists are the published ones, in the path's order.
 */
export const dynamic = 'force-dynamic';

interface PathParams {
  readonly params: Promise<{ readonly locale: string; readonly slug: string }>;
}

export async function generateMetadata({ params }: PathParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const { slug } = await params;
  const record = await readLearningPath(slug);
  // A 404 carries no canonical and no alternates (ROUTE_MAP.md §9.2).
  if (record === null) return { robots: { index: false, follow: false } };
  return learningPathMetadata(locale, record);
}

export default async function LearningPathPage({ params }: PathParams) {
  const locale = await requireLocale(params);
  const { slug } = await params;
  const record = await readLearningPath(slug);
  if (record === null) notFound();
  return <PathDetailPage locale={locale} record={record} />;
}
