import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { LearnLandingPage } from '@/components/learning/landing';
import { requireLocale } from '@/config/route-locale';
import { shellMetadata } from '@/seo/metadata';
import { requireRoute } from '@/shell/registry';

/**
 * `/{locale}/learn` — the Learn landing (ROUTE_MAP.md §3.5; Phase 22).
 *
 * It says what Learn offers and links only what is delivered — the catalogue,
 * the learning paths and the trial-class explanation — and shows the most
 * recently published Courses and paths, or says plainly that nothing is
 * published yet. Signed out, and `force-dynamic` because Courses are published
 * and withdrawn.
 */
export const dynamic = 'force-dynamic';

interface LearnParams {
  readonly params: Promise<{ readonly locale: string }>;
}

export async function generateMetadata({ params }: LearnParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'learn' });
  return shellMetadata({
    locale,
    route: requireRoute('learn'),
    title: t('title'),
    description: t('description'),
  });
}

export default async function LearnPage({ params }: LearnParams) {
  const locale = await requireLocale(params);
  return <LearnLandingPage locale={locale} />;
}
