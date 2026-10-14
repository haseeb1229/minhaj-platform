import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { LearningControls } from '@/components/learning-island/learning-controls';
import { CourseDetailPage } from '@/components/learning/course';
import { courseMetadata, readCourse } from '@/components/learning/read';
import { requireLocale } from '@/config/route-locale';

/**
 * `/{locale}/learn/courses/{slug}` — THE canonical address of one Course
 * (ROUTE_MAP.md §3.5).
 *
 * PUBLISHED ONLY, and the predicate is in the query: a draft or archived Course
 * is a 404 here, and so is a malformed slug. A FORMER slug never reaches this
 * page — the request proxy answers it with a single 301 through Learning's own
 * slug history (DOMAIN_MODEL.md §19.7).
 *
 * THE SAME DOCUMENT FOR EVERY VISITOR. Enrolment, progress and a trial-class
 * request belong to the private island, which reads the signed-in visitor's
 * state through `/api/my/learning/*` after the page has loaded; nothing here
 * reads a session (ARCHITECTURE.md §8.1).
 */
export const dynamic = 'force-dynamic';

interface CourseParams {
  readonly params: Promise<{ readonly locale: string; readonly slug: string }>;
}

export async function generateMetadata({ params }: CourseParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const { slug } = await params;
  const record = await readCourse(slug);
  // A 404 carries no canonical and no alternates (ROUTE_MAP.md §9.2).
  if (record === null) return { robots: { index: false, follow: false } };
  return courseMetadata(locale, record);
}

export default async function CoursePage({ params }: CourseParams) {
  const locale = await requireLocale(params);
  const { slug } = await params;
  const record = await readCourse(slug);
  if (record === null) notFound();
  return (
    <CourseDetailPage
      locale={locale}
      record={record}
      controls={
        <LearningControls
          locale={locale}
          courseId={record.id}
          courseSlug={record.slug}
          live={record.format === 'live'}
        />
      }
    />
  );
}
