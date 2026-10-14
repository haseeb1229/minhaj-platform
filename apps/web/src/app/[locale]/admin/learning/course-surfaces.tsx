import { notFound } from 'next/navigation';

import type { Locale } from '@minhaj/contracts';
import {
  COURSE_FORMATS,
  COURSE_LEVELS,
  LEARNING_LIMITS,
  learningIdSchema,
  type CourseDetail,
  type ModuleOutline,
} from '@minhaj/contracts/learning';

import { paragraphs, pickLabel } from '@/components/my-learning/presentation';
import { ConfirmField } from '@/components/personal/parts';
import {
  Alert,
  DataCell,
  DataRow,
  DataTable,
  EmptyState,
  Field,
  PageHeading,
  Panel,
  SectionHeading,
  Select,
  TextInput,
  TextLink,
} from '@/components/ui';
import { requireAdminPage } from '@/composition/authorization';
import { learningRuntime } from '@/composition/learning';
import { ownerReferenceChoices } from '@/composition/owner-references';
import { requireLocale } from '@/config/route-locale';
import { ActionForm } from '../../(identity)/form-state';
import { queryValue } from '../shared';
import {
  changeLessonAction,
  changeModuleAction,
  saveCourseAction,
  transitionCourseAction,
} from './actions';
import { LEARNING_FORM_ROWS } from './forms';
import {
  CatalogueIdentityFields,
  DirectoryFilter,
  EditIdentity,
  LabelFields,
  Pager,
  StateBadge,
  Title,
  Transitions,
  directoryHref,
  directoryQuery,
  editorTarget,
  learningCopy,
  titleText,
  type Copy,
  type EditorParams,
  type ListParams,
  type Query,
} from './shared';

/**
 * The Course administration — the directory, one Course's catalogue facts,
 * lifecycle and syllabus, and one lesson's words (ROUTE_MAP.md §7;
 * DELIVERY_PLAN.md Phase 22).
 *
 * A PUBLISHED SYLLABUS IS FROZEN. Modules and lessons change only while the
 * Course is a draft, so the public never sees a half-built outline; on a
 * published or archived Course every outline control is withheld with the
 * reason and the way forward — return it to draft.
 *
 * TEACHERS ARE ATTRIBUTION. They are chosen from People's published
 * contributors and confer nothing on anybody. Topics and the content language
 * come from Taxonomy's active vocabularies. Each owner produces its own
 * options (`ownerReferenceChoices`).
 *
 * NO LEARNER IS VISIBLE HERE. An operator sees the catalogue; who studies it
 * is never shown, and nothing here edits anybody's progress.
 */

type Choices = Awaited<ReturnType<typeof ownerReferenceChoices>>;

/** The currently selected option stays offered even when off the first page. */
function withSelected<T extends { readonly id: string }>(
  options: readonly T[],
  selected: string | undefined,
  make: (id: string) => T,
): readonly T[] {
  if (selected === undefined || options.some((option) => option.id === selected))
    return options;
  return [make(selected), ...options];
}

/** A narrowing GET form for the teacher choices, beside — never inside — a save form. */
function ReferenceSearch({
  query,
  copy,
}: {
  readonly query: string;
  readonly copy: Copy;
}) {
  const { t } = copy;
  return (
    <>
      <form method="get" className="flex flex-wrap items-end gap-3">
        <Field id="reference-query" label={t('course.teacherQuery')}>
          {(props) => (
            <TextInput {...props} name="q" defaultValue={query} maxLength={200} />
          )}
        </Field>
        <button
          type="submit"
          className="inline-flex min-h-11 items-center rounded-[var(--radius-control)] border border-[color:var(--color-border-strong)] px-4 text-sm font-medium"
        >
          {t('course.findTeachers')}
        </button>
      </form>
      <p className="text-sm text-[color:var(--color-foreground-muted)]">
        {t('course.teacherQueryHelp')}
      </p>
    </>
  );
}

/* ===========================================================================
 * Directory
 * ========================================================================= */

export async function CourseDirectory({ params, searchParams }: ListParams) {
  const locale = await requireLocale(params);
  const query = await searchParams;
  const base = `/${locale}/admin/learning/courses`;
  const context = await requireAdminPage(locale, 'learning.read', base);
  const copy = await learningCopy(locale);
  const { t } = copy;
  const filter = directoryQuery(query);
  const page = await learningRuntime().learning.courses(
    { accountId: context.session.account.id },
    filter,
  );

  return (
    <main className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageHeading>{t('surface.courses')}</PageHeading>
        <TextLink href={`${base}/new`}>{t('course.create')}</TextLink>
      </div>
      <DirectoryFilter base={base} filter={filter} copy={copy} />
      {page.items.length === 0 ? (
        <EmptyState>{t('empty')}</EmptyState>
      ) : (
        <DataTable
          caption={t('surface.courses')}
          columns={[
            t('labelTitle'),
            t('slug'),
            t('course.format'),
            t('state'),
            t('course.syllabusCount'),
            t('version'),
          ]}
        >
          {page.items.map((course) => (
            <DataRow key={course.id}>
              <DataCell wrap>
                <TextLink href={`${base}/${course.id}`}>
                  <Title record={course} locale={locale} />
                </TextLink>
              </DataCell>
              <DataCell wrap>{course.slug}</DataCell>
              <DataCell>{t(`course.formatName.${course.format}`)}</DataCell>
              <DataCell>
                <StateBadge state={course.state} copy={copy} />
              </DataCell>
              <DataCell>
                {t('course.syllabusSize', {
                  modules: String(course.modules),
                  lessons: String(course.lessons),
                })}
              </DataCell>
              <DataCell>{course.version}</DataCell>
            </DataRow>
          ))}
        </DataTable>
      )}
      <Pager
        offset={filter.offset}
        hasMore={page.hasMore}
        hrefFor={directoryHref(base, filter)}
        label={t('surface.courses')}
        copy={copy}
      />
    </main>
  );
}

/* ===========================================================================
 * One Course
 * ========================================================================= */

export async function CourseEditor({ params, searchParams }: EditorParams) {
  const locale = await requireLocale(params);
  const id = editorTarget((await params).id);
  const query: Query = await searchParams;
  const base = `/${locale}/admin/learning/courses`;
  const context = await requireAdminPage(locale, 'learning.read', `${base}/${id}`);
  const copy = await learningCopy(locale);
  const { t } = copy;
  const actor = { accountId: context.session.account.id };

  // A malformed or unknown identifier is the page's own 404, not an error boundary.
  const record =
    id === 'new'
      ? null
      : await learningRuntime()
          .learning.course(actor, id)
          .catch(() => null);
  if (id !== 'new' && record === null) notFound();

  const reference = queryValue(query, 'q') ?? '';
  const choices = await ownerReferenceChoices(locale, reference);

  return (
    <main className="flex flex-col gap-8">
      <p className="text-sm">
        <TextLink href={base}>{t('backToList')}</TextLink>
      </p>
      <div className="flex flex-col gap-2">
        <PageHeading>
          {record === null ? (
            t('course.create')
          ) : (
            <Title record={record} locale={locale} />
          )}
        </PageHeading>
        {record === null ? null : (
          <p className="flex flex-wrap items-center gap-3 text-sm">
            <StateBadge state={record.state} copy={copy} />
            <span>{t(`course.formatName.${record.format}`)}</span>
            <span>
              {t('version')}: {record.version}
            </span>
            {record.state === 'published' ? (
              <TextLink
                href={`/${locale}/learn/courses/${encodeURIComponent(record.slug)}`}
              >
                {t('viewPublic')}
              </TextLink>
            ) : null}
          </p>
        )}
      </div>

      {record === null ? null : (
        <Transitions
          locale={locale}
          record={record}
          action={transitionCourseAction}
          kind="course"
          copy={copy}
        />
      )}

      {record === null ? null : <Outline locale={locale} course={record} copy={copy} />}

      <Panel>
        <div className="flex flex-col gap-4">
          <SectionHeading>
            {record === null ? t('course.create') : t('course.edit')}
          </SectionHeading>
          <ReferenceSearch query={reference} copy={copy} />
          <CourseForm locale={locale} record={record} choices={choices} copy={copy} />
        </div>
      </Panel>
    </main>
  );
}

function CourseForm({
  locale,
  record,
  choices,
  copy,
}: {
  readonly locale: Locale;
  /** `null` creates a draft. An existing record edits, and carries its expected version. */
  readonly record: CourseDetail | null;
  readonly choices: Choices;
  readonly copy: Copy;
}) {
  const { t } = copy;
  const prefix = record === null ? 'new-course' : 'course';

  return (
    <ActionForm
      action={saveCourseAction}
      submitLabel={record === null ? t('create') : t('save')}
      pendingLabel={t('pending')}
      messages={copy.messages}
      preserveInput
    >
      <EditIdentity locale={locale} record={record} />
      <CatalogueIdentityFields
        prefix={prefix}
        locale={locale}
        record={record}
        copy={copy}
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <Field
          id={`${prefix}-format`}
          label={t('course.format')}
          help={t('course.formatHelp')}
        >
          {(props) => (
            <Select
              {...props}
              name="format"
              defaultValue={record?.format ?? 'self-paced'}
            >
              {COURSE_FORMATS.map((format) => (
                <option key={format} value={format}>
                  {t(`course.formatName.${format}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field
          id={`${prefix}-level`}
          label={t('course.level')}
          help={t('course.levelHelp')}
        >
          {(props) => (
            <Select {...props} name="level" defaultValue={record?.level ?? ''}>
              <option value="">{t('course.levelNone')}</option>
              {COURSE_LEVELS.map((level) => (
                <option key={level} value={level}>
                  {t(`course.levelName.${level}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field
          id={`${prefix}-language`}
          label={t('course.contentLanguage')}
          help={t('course.contentLanguageHelp')}
        >
          {(props) => (
            <Select
              {...props}
              name="languageCode"
              required
              defaultValue={record?.languageCode ?? ''}
            >
              <option value="">{t('none')}</option>
              {choices.languages.map((language) => (
                <option key={language.code} value={language.code}>
                  {language.name} ({language.code})
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>

      <LabelFields
        prefix={prefix}
        locale={locale}
        labels={record?.labels ?? []}
        primaryLocale={record?.primaryLocale ?? null}
        kind="catalogue"
        copy={copy}
      />

      <SectionHeading>{t('course.teachers')}</SectionHeading>
      <p className="text-sm text-[color:var(--color-foreground-muted)]">
        {t('course.teachersHelp')}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {Array.from({ length: LEARNING_FORM_ROWS.teachers }, (_, index) => {
          const selected = record?.teacherIds[index];
          return (
            <Field
              key={index}
              id={`${prefix}-teacher-${String(index)}`}
              label={t('course.teacher', { number: String(index + 1) })}
            >
              {(props) => (
                <Select
                  {...props}
                  name={`teacher-${String(index)}`}
                  defaultValue={selected ?? ''}
                >
                  <option value="">{t('none')}</option>
                  {withSelected(choices.people, selected, (id) => ({ id, name: id })).map(
                    (person) => (
                      <option key={person.id} value={person.id}>
                        {person.name}
                      </option>
                    ),
                  )}
                </Select>
              )}
            </Field>
          );
        })}
      </div>

      <SectionHeading>{t('course.topics')}</SectionHeading>
      <div className="grid gap-3 sm:grid-cols-2">
        {Array.from({ length: LEARNING_FORM_ROWS.topics }, (_, index) => (
          <Field
            key={index}
            id={`${prefix}-topic-${String(index)}`}
            label={t('course.topic', { number: String(index + 1) })}
          >
            {(props) => (
              <Select
                {...props}
                name={`topic-${String(index)}`}
                defaultValue={record?.topicIds[index] ?? ''}
              >
                <option value="">{t('none')}</option>
                {choices.topics.map((topic) => (
                  <option key={topic.id} value={topic.id}>
                    {topic.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ))}
      </div>
    </ActionForm>
  );
}

/* ===========================================================================
 * The syllabus
 * ========================================================================= */

/** The hidden fields every outline change carries: the Course and the version shown. */
function OutlineIdentity({
  locale,
  course,
  op,
}: {
  readonly locale: Locale;
  readonly course: CourseDetail;
  readonly op: 'add' | 'edit' | 'remove' | 'move';
}) {
  return (
    <>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="courseId" value={course.id} />
      <input type="hidden" name="version" value={String(course.version)} />
      <input type="hidden" name="op" value={op} />
    </>
  );
}

/** One move, as its own small form. Its name says what moves, where, and from which place. */
function MoveForm({
  locale,
  course,
  target,
  direction,
  label,
  copy,
}: {
  readonly locale: Locale;
  readonly course: CourseDetail;
  readonly target: { readonly field: 'moduleId' | 'lessonId'; readonly id: string };
  readonly direction: 'earlier' | 'later';
  readonly label: string;
  readonly copy: Copy;
}) {
  return (
    <ActionForm
      action={target.field === 'moduleId' ? changeModuleAction : changeLessonAction}
      submitLabel={label}
      pendingLabel={copy.t('pending')}
      messages={copy.messages}
      tone="secondary"
    >
      <OutlineIdentity locale={locale} course={course} op="move" />
      <input type="hidden" name={target.field} value={target.id} />
      <input type="hidden" name="direction" value={direction} />
    </ActionForm>
  );
}

/** A removal behind a disclosure and an explicit confirmation. */
function RemoveForm({
  locale,
  course,
  target,
  summary,
  confirm,
  copy,
}: {
  readonly locale: Locale;
  readonly course: CourseDetail;
  readonly target: { readonly field: 'moduleId' | 'lessonId'; readonly id: string };
  readonly summary: string;
  readonly confirm: string;
  readonly copy: Copy;
}) {
  return (
    <details>
      <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm font-medium">
        {summary}
      </summary>
      <div className="pt-2">
        <ActionForm
          action={target.field === 'moduleId' ? changeModuleAction : changeLessonAction}
          submitLabel={summary}
          pendingLabel={copy.t('pending')}
          messages={copy.messages}
          tone="destructive"
        >
          <OutlineIdentity locale={locale} course={course} op="remove" />
          <input type="hidden" name={target.field} value={target.id} />
          <ConfirmField id={`remove-${target.id}`} label={confirm} />
        </ActionForm>
      </div>
    </details>
  );
}

function Outline({
  locale,
  course,
  copy,
}: {
  readonly locale: Locale;
  readonly course: CourseDetail;
  readonly copy: Copy;
}) {
  const { t } = copy;
  const editable = course.state === 'draft';
  const name = (labels: ModuleOutline['labels']) =>
    titleText(labels, locale, course.primaryLocale);

  return (
    <section className="flex flex-col gap-4" aria-labelledby="course-outline">
      <SectionHeading>
        <span id="course-outline">{t('outline.heading')}</span>
      </SectionHeading>
      <p className="text-sm text-[color:var(--color-foreground-muted)]">
        {t('outline.help')}
      </p>
      {editable ? null : <Alert tone="info">{t('outline.frozen')}</Alert>}

      {course.outline.length === 0 ? (
        <EmptyState>{t('outline.empty')}</EmptyState>
      ) : (
        <ol aria-labelledby="course-outline" className="flex flex-col gap-4">
          {course.outline.map((part, index) => {
            const title = name(part.labels);
            const total = course.outline.length;
            const place = { title, position: String(index + 1), total: String(total) };
            return (
              <Panel key={part.id} as="li">
                <div className="flex flex-col gap-3">
                  <h3 className="flex flex-wrap items-baseline gap-2 font-semibold">
                    <span className="text-sm font-normal text-[color:var(--color-foreground-muted)]">
                      {t('outline.modulePosition', {
                        position: place.position,
                        total: place.total,
                      })}
                    </span>
                    <span
                      lang={pickLabel(part.labels, locale, course.primaryLocale)?.locale}
                      dir="auto"
                    >
                      {title}
                    </span>
                  </h3>

                  {editable ? (
                    <div className="flex flex-wrap items-start gap-3">
                      {index === 0 ? null : (
                        <MoveForm
                          locale={locale}
                          course={course}
                          target={{ field: 'moduleId', id: part.id }}
                          direction="earlier"
                          label={t('outline.moveModuleEarlier', place)}
                          copy={copy}
                        />
                      )}
                      {index === total - 1 ? null : (
                        <MoveForm
                          locale={locale}
                          course={course}
                          target={{ field: 'moduleId', id: part.id }}
                          direction="later"
                          label={t('outline.moveModuleLater', place)}
                          copy={copy}
                        />
                      )}
                    </div>
                  ) : null}

                  <Lessons
                    locale={locale}
                    course={course}
                    part={part}
                    editable={editable}
                    copy={copy}
                  />

                  {editable ? (
                    <>
                      <details>
                        <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm font-medium">
                          {t('outline.editModule', place)}
                        </summary>
                        <div className="pt-2">
                          <ActionForm
                            action={changeModuleAction}
                            submitLabel={t('save')}
                            pendingLabel={t('pending')}
                            messages={copy.messages}
                            preserveInput
                          >
                            <OutlineIdentity locale={locale} course={course} op="edit" />
                            <input type="hidden" name="moduleId" value={part.id} />
                            <LabelFields
                              prefix={`module-${part.id}`}
                              locale={locale}
                              labels={part.labels}
                              primaryLocale={course.primaryLocale}
                              kind="outline"
                              copy={copy}
                            />
                          </ActionForm>
                        </div>
                      </details>
                      <RemoveForm
                        locale={locale}
                        course={course}
                        target={{ field: 'moduleId', id: part.id }}
                        summary={t('outline.removeModule', place)}
                        confirm={t('outline.removeModuleConfirm')}
                        copy={copy}
                      />
                    </>
                  ) : null}
                </div>
              </Panel>
            );
          })}
        </ol>
      )}

      {!editable ? null : course.outline.length >= LEARNING_LIMITS.modules ? (
        <EmptyState>{t('outline.modulesFull')}</EmptyState>
      ) : (
        <Panel>
          <div className="flex flex-col gap-4">
            <SectionHeading>{t('outline.addModule')}</SectionHeading>
            <ActionForm
              action={changeModuleAction}
              submitLabel={t('outline.addModule')}
              pendingLabel={t('pending')}
              messages={copy.messages}
            >
              <OutlineIdentity locale={locale} course={course} op="add" />
              <LabelFields
                prefix="new-module"
                locale={locale}
                labels={[]}
                primaryLocale={course.primaryLocale}
                kind="outline"
                copy={copy}
              />
            </ActionForm>
          </div>
        </Panel>
      )}
    </section>
  );
}

function Lessons({
  locale,
  course,
  part,
  editable,
  copy,
}: {
  readonly locale: Locale;
  readonly course: CourseDetail;
  readonly part: ModuleOutline;
  readonly editable: boolean;
  readonly copy: Copy;
}) {
  const { t } = copy;
  const moduleTitle = titleText(part.labels, locale, course.primaryLocale);
  const total = part.lessons.length;

  return (
    <div className="flex flex-col gap-3 border-s-2 border-[color:var(--color-border)] ps-4">
      {total === 0 ? (
        <p className="text-sm text-[color:var(--color-foreground-muted)]">
          {t('outline.noLessons')}
        </p>
      ) : (
        <ol
          aria-label={t('outline.lessonsOf', { title: moduleTitle })}
          className="flex flex-col gap-3"
        >
          {part.lessons.map((lesson, index) => {
            const title = titleText(lesson.labels, locale, course.primaryLocale);
            const place = { title, position: String(index + 1), total: String(total) };
            return (
              <li key={lesson.id} className="flex flex-col gap-2">
                <p className="flex flex-wrap items-baseline gap-2">
                  <span className="text-sm text-[color:var(--color-foreground-muted)]">
                    {t('outline.lessonPosition', {
                      position: place.position,
                      total: place.total,
                    })}
                  </span>
                  <TextLink
                    href={`/${locale}/admin/learning/courses/${course.id}/lessons/${lesson.id}`}
                  >
                    <span
                      lang={
                        pickLabel(lesson.labels, locale, course.primaryLocale)?.locale
                      }
                      dir="auto"
                    >
                      {title}
                    </span>
                  </TextLink>
                </p>
                {editable ? (
                  <div className="flex flex-wrap items-start gap-3">
                    {index === 0 ? null : (
                      <MoveForm
                        locale={locale}
                        course={course}
                        target={{ field: 'lessonId', id: lesson.id }}
                        direction="earlier"
                        label={t('outline.moveLessonEarlier', place)}
                        copy={copy}
                      />
                    )}
                    {index === total - 1 ? null : (
                      <MoveForm
                        locale={locale}
                        course={course}
                        target={{ field: 'lessonId', id: lesson.id }}
                        direction="later"
                        label={t('outline.moveLessonLater', place)}
                        copy={copy}
                      />
                    )}
                    <RemoveForm
                      locale={locale}
                      course={course}
                      target={{ field: 'lessonId', id: lesson.id }}
                      summary={t('outline.removeLesson', place)}
                      confirm={t('outline.removeLessonConfirm')}
                      copy={copy}
                    />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}

      {!editable ? null : total >= LEARNING_LIMITS.lessons ? (
        <p className="text-sm">{t('outline.lessonsFull')}</p>
      ) : (
        <details>
          <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm font-medium">
            {t('outline.addLesson', { title: moduleTitle })}
          </summary>
          <div className="pt-2">
            <ActionForm
              action={changeLessonAction}
              submitLabel={t('outline.addLessonSubmit')}
              pendingLabel={t('pending')}
              messages={copy.messages}
              preserveInput
            >
              <OutlineIdentity locale={locale} course={course} op="add" />
              <input type="hidden" name="moduleId" value={part.id} />
              <LabelFields
                prefix={`new-lesson-${part.id}`}
                locale={locale}
                labels={[]}
                primaryLocale={course.primaryLocale}
                kind="lesson"
                copy={copy}
              />
            </ActionForm>
          </div>
        </details>
      )}
    </div>
  );
}

/* ===========================================================================
 * One lesson
 * ========================================================================= */

export async function LessonEditor({
  params,
}: {
  readonly params: Promise<{
    readonly locale: string;
    readonly id: string;
    readonly lessonId: string;
  }>;
}) {
  const locale = await requireLocale(params);
  const { id, lessonId } = await params;
  if (
    !learningIdSchema.safeParse(id).success ||
    !learningIdSchema.safeParse(lessonId).success
  )
    notFound();
  const courseBase = `/${locale}/admin/learning/courses/${id}`;
  const context = await requireAdminPage(
    locale,
    'learning.read',
    `${courseBase}/lessons/${lessonId}`,
  );
  const copy = await learningCopy(locale);
  const { t } = copy;
  const actor = { accountId: context.session.account.id };
  const { learning } = learningRuntime();

  const [course, lesson] = await Promise.all([
    learning.course(actor, id).catch(() => null),
    learning.lesson(actor, lessonId).catch(() => null),
  ]);
  // A lesson is addressed beneath its own Course and nowhere else.
  if (course === null || lesson === null || lesson.courseId !== course.id) notFound();

  const editable = course.state === 'draft';
  const part = course.outline.find((entry) => entry.id === lesson.moduleId);
  const label = pickLabel(lesson.labels, locale, course.primaryLocale);

  return (
    <main className="flex flex-col gap-8">
      <p className="text-sm">
        <TextLink href={courseBase}>{t('lesson.backToCourse')}</TextLink>
      </p>
      <div className="flex flex-col gap-2">
        <PageHeading>
          <span lang={label?.locale} dir="auto" className="wrap-anywhere">
            {label?.title}
          </span>
        </PageHeading>
        <p className="flex flex-wrap items-center gap-3 text-sm">
          <span>
            <Title record={course} locale={locale} />
          </span>
          {part === undefined ? null : (
            <span>
              {t('lesson.inModule', {
                title: titleText(part.labels, locale, course.primaryLocale),
              })}
            </span>
          )}
          <StateBadge state={course.state} copy={copy} />
        </p>
      </div>

      {editable ? (
        <Panel>
          <div className="flex flex-col gap-4">
            <SectionHeading>{t('lesson.edit')}</SectionHeading>
            <p className="text-sm text-[color:var(--color-foreground-muted)]">
              {t('lesson.plainText')}
            </p>
            <ActionForm
              action={changeLessonAction}
              submitLabel={t('save')}
              pendingLabel={t('pending')}
              messages={copy.messages}
              preserveInput
            >
              <OutlineIdentity locale={locale} course={course} op="edit" />
              <input type="hidden" name="lessonId" value={lesson.id} />
              <LabelFields
                prefix="lesson"
                locale={locale}
                labels={lesson.labels}
                primaryLocale={course.primaryLocale}
                kind="lesson"
                copy={copy}
              />
            </ActionForm>
          </div>
        </Panel>
      ) : (
        <>
          <Alert tone="info">{t('outline.frozen')}</Alert>
          {lesson.labels.map((entry) => (
            <Panel key={entry.locale}>
              <div
                lang={entry.locale}
                dir="auto"
                className="flex flex-col gap-3 wrap-anywhere"
              >
                <SectionHeading>{entry.title}</SectionHeading>
                {entry.summary === '' ? null : (
                  <p className="font-medium">{entry.summary}</p>
                )}
                {paragraphs(entry.body).map((paragraph, index) => (
                  <p key={index} className="whitespace-pre-line">
                    {paragraph}
                  </p>
                ))}
              </div>
            </Panel>
          ))}
        </>
      )}
    </main>
  );
}
