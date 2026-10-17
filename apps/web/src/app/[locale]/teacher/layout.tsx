import { getTranslations } from 'next-intl/server';

import { teacherLinks } from '@/components/teacher/nav';
import { TextLink } from '@/components/ui';
import { requireLocale } from '@/config/route-locale';
import { requireTeacher } from './guard';

/**
 * The Teacher area's shell (ROUTE_MAP.md §6; DELIVERY_PLAN.md Phase 23).
 *
 * `noindex, nofollow` for the whole tree, inherited by every page beneath. A
 * teacher's schedule, students and attendance in a search index would be a
 * disclosure of exactly what §13.4 keeps private.
 *
 * THE SHELL IS GUARDED AS WELL AS EACH PAGE. A page's `notFound()` renders the
 * 404 INSIDE its layouts, so an unguarded shell would frame the 404 with this
 * navigation — and hand a non-teacher the area's map. The guard here is the
 * same live question each page asks again.
 *
 * MESSAGES ARE PART OF THE AREA since Phase 24 — the teacher's conversations
 * with learners on the Courses they teach now — and the entry is listed like
 * every other section.
 */
export const metadata = { robots: { index: false, follow: false } };

/** PER REQUEST, always: every page beneath reads a session and live privilege. */
export const dynamic = 'force-dynamic';

export default async function TeacherLayout({
  children,
  params,
}: {
  readonly children: React.ReactNode;
  readonly params: Promise<{ readonly locale: string }>;
}) {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'teacher' });
  const gate = await requireTeacher(locale, `/${locale}/teacher`);

  return (
    <div className="mx-auto flex w-full max-w-5xl min-w-0 flex-col gap-6 px-4 py-8">
      {gate.activated ? (
        <nav aria-label={t('nav.label')}>
          <ul className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
            {teacherLinks(locale, t).map((link) => (
              <li key={link.key}>
                <TextLink href={link.href}>{link.text}</TextLink>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
      {children}
    </div>
  );
}
