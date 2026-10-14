import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { learningLinks } from '@/components/my-learning/nav';
import {
  LearningTitle,
  ProgressStatus,
  learningMessages,
} from '@/components/my-learning/parts';
import {
  lessonsInOrder,
  paragraphs,
  pickLabel,
  selectedLesson,
} from '@/components/my-learning/presentation';
import { learningRead } from '@/components/my-learning/read';
import { ConfirmField, PersonalFrame, PersonalLinks } from '@/components/personal/parts';
import { Alert, Panel, SectionHeading, TextLink } from '@/components/ui';
import { learningRuntime } from '@/composition/learning';
import { requireLocale } from '@/config/route-locale';
import { ActionForm } from '../../../../(identity)/form-state';
import { requireActiveSession } from '../../../guard';
import { completeLessonAction, leaveCourseAction } from '../../actions';

/**
 * One Course the person is enrolled on — its syllabus with their own completed
 * lessons, one lesson's text, and leaving (ROUTE_MAP.md §5.1; Phase 22).
 *
 * ONLY THE PERSON'S OWN ENROLMENT OPENS IT. The Course is read through the
 * session account's Enrolment, so a Course they are not on is this page's 404
 * exactly like one that does not exist.
 *
 * READING RECORDS NOTHING. `?lesson=` chooses which lesson's text is shown —
 * by default the first not yet completed — and progress moves only when the
 * person presses "Mark lesson complete", a POST.
 *
 * A LESSON BODY IS PLAIN TEXT, rendered as paragraphs of text nodes. It is
 * read only while the Course is published: a Course that has left the
 * catalogue shows an honest notice and no syllabus — a draft's outline may be
 * mid-edit — and the person's progress on it is kept.
 */
export const metadata = { robots: { index: false, follow: false } };

/** PER REQUEST, always: this surface reads a session. */
export const dynamic = 'force-dynamic';

/** The first value of `?lesson=`, or `null`. */
function requestedLesson(query: Record<string, string | string[] | undefined>) {
  const raw = query['lesson'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === 'string' && value.length <= 64 ? value : null;
}

export default async function MyCoursePage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly locale: string; readonly slug: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const locale = await requireLocale(params);
  const { slug } = await params;
  const path = `/${locale}/my/learning/courses/${encodeURIComponent(slug)}`;
  const session = await requireActiveSession(locale, path);
  const t = await getTranslations({ locale, namespace: 'myLearning' });
  const actor = { accountId: session.account.id };
  const back = <PersonalLinks label={t('nav.label')} links={learningLinks(locale, t)} />;

  const read = await learningRead('learning-my-course', () =>
    learningRuntime().learner.course(actor, slug),
  );
  if (!read.ok)
    return (
      <PersonalFrame title={t('course.fallbackTitle')} back={back}>
        <Alert tone="error">{t('failure.load')}</Alert>
      </PersonalFrame>
    );
  if (read.value === null) notFound();

  const { course, available } = read.value;
  const completed = new Set(read.value.completedLessonIds);
  const lessons = lessonsInOrder(course.outline);
  const done = lessons.filter((lesson) => completed.has(lesson.id)).length;
  const label = pickLabel(course.labels, locale, course.primaryLocale);
  const chosen = available
    ? selectedLesson(course.outline, completed, requestedLesson(await searchParams))
    : null;
  const lessonRead =
    chosen === null
      ? null
      : await learningRead('learning-my-lesson', () =>
          learningRuntime().learner.lesson(actor, course.id, chosen),
        );
  const lesson = lessonRead?.ok ? lessonRead.value : null;
  const lessonLabel =
    lesson === null ? null : pickLabel(lesson.labels, locale, course.primaryLocale);
  const position =
    chosen === null ? -1 : lessons.findIndex((entry) => entry.id === chosen);
  const next = position === -1 ? undefined : lessons[position + 1];

  return (
    <PersonalFrame
      title={
        <span lang={label?.locale} dir="auto" className="wrap-anywhere">
          {label?.title}
        </span>
      }
      description={
        <>
          {label === null || label.summary === '' ? null : (
            <p lang={label.locale} dir="auto" className="wrap-anywhere">
              {label.summary}
            </p>
          )}
          <p className="flex flex-wrap items-center gap-3">
            {available ? (
              <ProgressStatus completed={done} lessons={lessons.length} t={t} />
            ) : null}
            {available ? (
              <TextLink
                href={`/${locale}/learn/courses/${encodeURIComponent(course.slug)}`}
              >
                {t('course.publicPage')}
              </TextLink>
            ) : null}
          </p>
        </>
      }
      back={back}
    >
      {available ? null : <Alert tone="info">{t('course.unavailable')}</Alert>}

      {/* ---- Syllabus ---------------------------------------------------- */}
      {/* While the Course is not published its syllabus may be mid-edit, so a
          learner sees none of it until it is published again; the progress
          already recorded is kept and returns with it. */}

      {available ? (
        <section className="flex flex-col gap-3" aria-labelledby="course-syllabus">
          <span id="course-syllabus">
            <SectionHeading>{t('course.syllabus')}</SectionHeading>
          </span>
          {course.outline.map((part, index) => (
            <Panel key={part.id}>
              <div className="flex flex-col gap-2">
                <h3 className="font-semibold">
                  {t('course.module', { number: String(index + 1) })}{' '}
                  <LearningTitle
                    labels={part.labels}
                    primaryLocale={course.primaryLocale}
                    locale={locale}
                  />
                </h3>
                <ol className="flex flex-col gap-1">
                  {part.lessons.map((entry) => {
                    const finished = completed.has(entry.id);
                    const title = (
                      <LearningTitle
                        labels={entry.labels}
                        primaryLocale={course.primaryLocale}
                        locale={locale}
                      />
                    );
                    return (
                      <li
                        key={entry.id}
                        className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-1"
                      >
                        {available ? (
                          <a
                            href={`${path}?lesson=${entry.id}`}
                            aria-current={entry.id === chosen ? 'page' : undefined}
                            className="min-w-0 font-medium text-[color:var(--color-action)] underline underline-offset-2 aria-[current=page]:no-underline"
                          >
                            {title}
                          </a>
                        ) : (
                          <span className="min-w-0">{title}</span>
                        )}
                        <span className="text-xs text-[color:var(--color-foreground-muted)]">
                          {finished ? (
                            <>
                              <span aria-hidden="true">✓ </span>
                              {t('lesson.completed')}
                            </>
                          ) : (
                            t('lesson.notCompleted')
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ol>
              </div>
            </Panel>
          ))}
        </section>
      ) : null}

      {/* ---- The chosen lesson ------------------------------------------- */}

      {chosen === null ? null : lesson === null || lessonLabel === null ? (
        <Alert tone="error">{t('lesson.unavailable')}</Alert>
      ) : (
        <section className="flex flex-col gap-4" aria-labelledby="course-lesson">
          <span id="course-lesson">
            <SectionHeading>
              <span lang={lessonLabel.locale} dir="auto" className="wrap-anywhere">
                {lessonLabel.title}
              </span>
            </SectionHeading>
          </span>
          <p className="text-sm text-[color:var(--color-foreground-muted)]">
            {t('lesson.position', {
              number: String(position + 1),
              total: String(lessons.length),
            })}
          </p>
          {lessonLabel.summary === '' ? null : (
            <p lang={lessonLabel.locale} dir="auto" className="font-medium wrap-anywhere">
              {lessonLabel.summary}
            </p>
          )}
          <div lang={lessonLabel.locale} dir="auto" className="flex flex-col gap-3">
            {paragraphs(lessonLabel.body).map((paragraph, index) => (
              <p key={index} className="whitespace-pre-line wrap-anywhere">
                {paragraph}
              </p>
            ))}
          </div>
          {completed.has(lesson.id) ? (
            <p className="text-sm font-medium">
              <span aria-hidden="true">✓ </span>
              {t('lesson.alreadyCompleted')}
            </p>
          ) : (
            <div className="self-start">
              <ActionForm
                action={completeLessonAction}
                submitLabel={t('lesson.complete')}
                pendingLabel={t('common.working')}
                messages={learningMessages(t, { success: t('lesson.completedStatus') })}
              >
                <input type="hidden" name="locale" value={locale} />
                <input type="hidden" name="courseId" value={course.id} />
                <input type="hidden" name="lessonId" value={lesson.id} />
                <input type="hidden" name="slug" value={course.slug} />
              </ActionForm>
            </div>
          )}
          {next === undefined ? null : (
            <p>
              <TextLink href={`${path}?lesson=${next.id}`}>{t('lesson.next')}</TextLink>
            </p>
          )}
        </section>
      )}

      {/* ---- Leaving ----------------------------------------------------- */}

      <section className="flex flex-col gap-3" aria-labelledby="course-leave">
        <span id="course-leave">
          <SectionHeading>{t('leave.heading')}</SectionHeading>
        </span>
        <p className="text-sm">{t('leave.body')}</p>
        <div className="self-start">
          <ActionForm
            action={leaveCourseAction}
            submitLabel={t('leave.submit')}
            pendingLabel={t('common.working')}
            tone="destructive"
            messages={learningMessages(t)}
          >
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="courseId" value={course.id} />
            <ConfirmField id="leave-confirm" label={t('leave.confirm')} />
          </ActionForm>
        </div>
      </section>
    </PersonalFrame>
  );
}
