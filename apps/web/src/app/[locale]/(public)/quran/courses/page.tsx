import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { QuranCoursesPage } from '@/components/quran/courses';
import {
  COURSES_PATH,
  coursesCanonicalRedirect,
  readCoursesQuery,
} from '@/components/quran/courses-view';
import { QuranUnavailable } from '@/components/quran/parts';
import { quranAvailability, quranMetadata } from '@/components/quran/read';
import { requireLocale } from '@/config/route-locale';

/**
 * `/{locale}/quran/courses` — THE QURAN COURSES HUB (Quran Part 13;
 * ROUTE_MAP.md §3.3): Learning's published Courses on Taxonomy's `quran`
 * Topic, composed at Layer 4 from Learning's own public reads — a format, a
 * level, a content language, a teacher, an order and a page, each a GET
 * parameter, every view at ONE address (any other spelling of it is one
 * redirect there). Enrolment stays on each course's own Learn page; nothing
 * here writes.
 *
 * CANONICAL TO ITSELF, the bare path, since Part 13: the hub is a curated
 * navigational view of its own (ROUTE_MAP.md §2.3), no longer a mirror of
 * `/learn/courses` (its canonical from Phase 22 to Quran Part 12, historical);
 * every filtered or paged view canonicalises to it. While the corpus is not
 * approved the page claims no canonical at all (`quranMetadata`). Without the
 * `quran` Topic no course is on the Quran: the hub says so, as an empty
 * state, never a 404.
 *
 * Signed out and `force-dynamic`: every part is mutable public data. The
 * honest unavailable state while no corpus is active, as on every Quran page.
 */
export const dynamic = 'force-dynamic';

interface CoursesParams {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: CoursesParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'quran' });
  return quranMetadata({
    locale,
    availability: await quranAvailability(),
    canonicalPath: COURSES_PATH,
    title: t('sections.courses'),
    description: t('sectionBody.courses'),
  });
}

export default async function QuranCoursesRoute({ params, searchParams }: CoursesParams) {
  const locale = await requireLocale(params);
  const availability = await quranAvailability();
  if (!availability.active) {
    const t = await getTranslations({ locale, namespace: 'quran' });
    return <QuranUnavailable locale={locale} section={t('sections.courses')} />;
  }
  const query = await searchParams;
  // One address per view: a form's empty controls, a malformed value or
  // another order is ONE redirect to the canonical spelling.
  const canonical = coursesCanonicalRedirect(locale, query);
  if (canonical !== null) redirect(canonical);
  return (
    <QuranCoursesPage
      locale={locale}
      availability={availability}
      query={readCoursesQuery(query)}
    />
  );
}
