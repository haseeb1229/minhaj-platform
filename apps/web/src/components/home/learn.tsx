import type { Locale } from '@minhaj/contracts';
import type { CourseListing } from '@minhaj/contracts/learning';
import { getTranslations } from 'next-intl/server';

import { CourseGrid } from '@/components/learning/parts';
import { pathFor, requireRoute } from '@/shell/registry';

import { HomeSection } from './section';

/**
 * LEARN, WHEN THERE IS SOMETHING TO LEARN (R2): Learning's newest published
 * courses in Learning's own card. Absent — not an empty frame — until a course
 * is published.
 */
export async function LearnModule({
  locale,
  courses,
}: {
  readonly locale: Locale;
  readonly courses: readonly CourseListing[];
}) {
  if (courses.length === 0) return null;
  const learn = await getTranslations({ locale, namespace: 'learn' });

  return (
    <HomeSection
      id="home-learn"
      header={{
        heading: learn('landing.courses'),
        action: {
          href: pathFor(locale, requireRoute('learn.courses')),
          text: learn('landing.allCourses'),
        },
      }}
    >
      <CourseGrid
        locale={locale}
        courses={courses}
        label={learn('landing.courses')}
        headingLevel="h3"
      />
    </HomeSection>
  );
}
