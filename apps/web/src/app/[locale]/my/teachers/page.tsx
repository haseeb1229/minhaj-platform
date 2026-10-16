import { getTranslations } from 'next-intl/server';

import { TeacherName } from '@/components/live-learning/parts';
import { classLinks } from '@/components/my-classes/parts';
import { LearningTitle } from '@/components/my-learning/parts';
import { learningRead } from '@/components/my-learning/read';
import { PersonalFrame, PersonalLinks, PersonalTime } from '@/components/personal/parts';
import { Alert, EmptyState, Panel, TextLink } from '@/components/ui';
import { learningRuntime } from '@/composition/learning';
import { teacherProfilesFor } from '@/composition/learning-teachers';
import { requireLocale } from '@/config/route-locale';
import { requireActiveSession } from '../guard';

/**
 * My Teachers — the teachers the person has a GENUINE relationship with
 * (ROUTE_MAP.md §5.1; DELIVERY_PLAN.md Phase 23): those currently teaching a
 * Course the person is enrolled on, or whose class the person has attended or
 * is booked on. Learning answers that by account; People's PUBLIC reader
 * answers the name and the profile address, and a teacher with no published
 * profile is "Teacher", in words, with no link.
 *
 * NOTHING HERE MESSAGES, RATES OR CONTACTS A TEACHER: messaging is a later
 * phase and no frame for it is drawn (ROUTE_MAP.md §5.2).
 */
export const metadata = { robots: { index: false, follow: false } };

/** PER REQUEST, always: this surface reads a session. */
export const dynamic = 'force-dynamic';

export default async function MyTeachersPage({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}) {
  const locale = await requireLocale(params);
  const path = `/${locale}/my/teachers`;
  const session = await requireActiveSession(locale, path);
  const t = await getTranslations({ locale, namespace: 'myClasses' });
  const back = <PersonalLinks label={t('nav.label')} links={classLinks(locale, t)} />;
  const description = <p>{t('teachers.description')}</p>;

  const read = await learningRead('learning-my-teachers', async () => {
    const teachers = await learningRuntime().myClasses.teachers({
      accountId: session.account.id,
    });
    const profiles = await teacherProfilesFor(
      teachers.map((teacher) => teacher.teacherAccountId),
      locale,
    );
    return { teachers, profiles };
  });

  if (!read.ok)
    return (
      <PersonalFrame title={t('teachers.title')} description={description} back={back}>
        <Alert tone="error">{t('failure.load')}</Alert>
      </PersonalFrame>
    );

  const { teachers, profiles } = read.value;
  const timeZone = session.account.timezone;

  return (
    <PersonalFrame title={t('teachers.title')} description={description} back={back}>
      {teachers.length === 0 ? (
        <>
          <EmptyState>{t('teachers.empty')}</EmptyState>
          <p>
            <TextLink href={`/${locale}/learn/teachers`}>{t('teachers.find')}</TextLink>
          </p>
        </>
      ) : (
        <ul aria-label={t('teachers.title')} className="flex flex-col gap-3">
          {teachers.map((teacher) => (
            <Panel key={teacher.teacherAccountId} as="li">
              <div className="flex min-w-0 flex-col gap-2">
                <p className="text-lg font-semibold">
                  <TeacherName
                    profile={profiles.get(teacher.teacherAccountId)}
                    locale={locale}
                    fallback={t('teachers.unnamed')}
                  />
                </p>
                {teacher.courses.length === 0 ? null : (
                  <div className="flex flex-col gap-1 text-sm">
                    <span className="text-[color:var(--color-foreground-muted)]">
                      {t('teachers.courses')}
                    </span>
                    <ul className="flex flex-col gap-1 ps-4">
                      {teacher.courses.map((course) => (
                        <li key={course.id} className="list-disc">
                          <LearningTitle
                            labels={course.labels}
                            primaryLocale={course.primaryLocale}
                            locale={locale}
                          />
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <p className="text-sm">
                  {t('teachers.upcoming', { count: teacher.upcoming })}
                </p>
                <p className="text-sm text-[color:var(--color-foreground-muted)]">
                  {teacher.lastClassAt === null ? (
                    t('teachers.noLast')
                  ) : (
                    <>
                      {t('teachers.last')}{' '}
                      <PersonalTime
                        value={teacher.lastClassAt.toISOString()}
                        locale={locale}
                        timeZone={timeZone}
                      />
                    </>
                  )}
                </p>
              </div>
            </Panel>
          ))}
        </ul>
      )}
    </PersonalFrame>
  );
}
