import { getTranslations } from 'next-intl/server';

import { teacherLinks } from '@/components/teacher/nav';
import { WorkspaceShell } from '@/components/workspace/parts';
import { WorkspaceNav } from '@/components/workspace/workspace-nav';
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
 *
 * THE WORKSPACE FRAME names the area in its header band as text, not a
 * heading, so each page keeps exactly one `h1` inside its own `main`. The
 * sections are a column beside the content on a wide screen and a horizontal
 * scroller on a narrow one; while live learning is not activated there is no
 * navigation at all, because no section has content to reach.
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
  const w = await getTranslations({ locale, namespace: 'workspace' });
  const gate = await requireTeacher(locale, `/${locale}/teacher`);

  return (
    <WorkspaceShell
      locale={locale}
      skipLabel={w('skip')}
      area={t('title')}
      width="wide"
      nav={
        gate.activated ? (
          <WorkspaceNav
            label={t('nav.label')}
            variant="sidebar"
            groups={[
              {
                key: 'teacher',
                links: teacherLinks(locale, t).map((link) => ({
                  ...link,
                  // The overview is the area's root, which every page sits under.
                  exact: link.key === 'overview',
                })),
              },
            ]}
          />
        ) : null
      }
    >
      {children}
    </WorkspaceShell>
  );
}
