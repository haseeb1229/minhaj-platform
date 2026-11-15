import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { TeacherDirectoryPage } from '@/components/live-learning/directory';
import {
  readTeacherDirectoryQuery,
  teacherDirectoryCanonicalRedirect,
} from '@/components/live-learning/presentation';
import { requireLocale } from '@/config/route-locale';
import { shellMetadata } from '@/seo/metadata';
import { requireRoute } from '@/shell/registry';

/**
 * `/{locale}/learn/teachers` — Find a Teacher, `?subject, language,
 * availability` (ROUTE_MAP.md §3.5; DELIVERY_PLAN.md Phase 23).
 *
 * Who is listed is a RUNTIME intersection of three owners' current facts and
 * of the live-learning activation, so the route is `excluded` from the
 * build-bound sitemap and `noindex` (ROUTE_MAP.md §9.5), and `force-dynamic`.
 * A filtered view is canonical to this listing. ONE ADDRESS PER VIEW (Learn
 * Part 2): a form's empty controls or another order of the same filters is ONE
 * redirect to the canonical spelling; a malformed or repeated filter is
 * answered in place, listing nothing. Nothing here reads a session.
 */
export const dynamic = 'force-dynamic';

interface TeachersParams {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: TeachersParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'learnTeachers' });
  return shellMetadata({
    locale,
    route: requireRoute('learn.teachers'),
    title: t('title'),
    description: t('description'),
  });
}

export default async function TeachersRoute({ params, searchParams }: TeachersParams) {
  const locale = await requireLocale(params);
  const query = await searchParams;
  const canonical = teacherDirectoryCanonicalRedirect(locale, query);
  if (canonical !== null) redirect(canonical);
  return (
    <TeacherDirectoryPage locale={locale} filters={readTeacherDirectoryQuery(query)} />
  );
}
