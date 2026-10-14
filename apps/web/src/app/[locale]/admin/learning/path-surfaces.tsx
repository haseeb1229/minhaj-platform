import { notFound } from 'next/navigation';

import type { Locale } from '@minhaj/contracts';
import { LEARNING_LIMITS, type PathDetail } from '@minhaj/contracts/learning';

import {
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
import { requireLocale } from '@/config/route-locale';
import { ActionForm } from '../../(identity)/form-state';
import { queryValue } from '../shared';
import { changePathAction, savePathAction, transitionPathAction } from './actions';
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
} from './shared';

/**
 * The LearningPath administration — the directory and one path's words,
 * lifecycle and ordered Courses (ROUTE_MAP.md §7; Phase 22).
 *
 * A PATH IS AN ORDER OF COURSES, CHANGED ONE NAMED STEP AT A TIME — add,
 * remove, move earlier or later — against the version the operator was shown.
 * Only a published Course may be added, and publishing a path needs at least
 * one. A person "on" a path is derived from their own Enrolments; nothing here
 * enrols anybody or shows who is studying.
 */

/* ===========================================================================
 * Directory
 * ========================================================================= */

export async function PathDirectory({ params, searchParams }: ListParams) {
  const locale = await requireLocale(params);
  const query = await searchParams;
  const base = `/${locale}/admin/learning/paths`;
  const context = await requireAdminPage(locale, 'learning.read', base);
  const copy = await learningCopy(locale);
  const { t } = copy;
  const filter = directoryQuery(query);
  const page = await learningRuntime().learning.paths(
    { accountId: context.session.account.id },
    filter,
  );

  return (
    <main className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageHeading>{t('surface.paths')}</PageHeading>
        <TextLink href={`${base}/new`}>{t('path.create')}</TextLink>
      </div>
      <DirectoryFilter base={base} filter={filter} copy={copy} />
      {page.items.length === 0 ? (
        <EmptyState>{t('empty')}</EmptyState>
      ) : (
        <DataTable
          caption={t('surface.paths')}
          columns={[
            t('labelTitle'),
            t('slug'),
            t('state'),
            t('path.courseCount'),
            t('version'),
          ]}
        >
          {page.items.map((path) => (
            <DataRow key={path.id}>
              <DataCell wrap>
                <TextLink href={`${base}/${path.id}`}>
                  <Title record={path} locale={locale} />
                </TextLink>
              </DataCell>
              <DataCell wrap>{path.slug}</DataCell>
              <DataCell>
                <StateBadge state={path.state} copy={copy} />
              </DataCell>
              <DataCell>{path.courses}</DataCell>
              <DataCell>{path.version}</DataCell>
            </DataRow>
          ))}
        </DataTable>
      )}
      <Pager
        offset={filter.offset}
        hasMore={page.hasMore}
        hrefFor={directoryHref(base, filter)}
        label={t('surface.paths')}
        copy={copy}
      />
    </main>
  );
}

/* ===========================================================================
 * One path
 * ========================================================================= */

/**
 * One membership change, as its own small form: the path, the version the
 * operator is looking at, the Course and the named change.
 */
function ChangeForm({
  locale,
  path,
  courseId,
  op,
  direction,
  label,
  copy,
  tone = 'secondary',
}: {
  readonly locale: Locale;
  readonly path: PathDetail;
  readonly courseId: string;
  readonly op: 'remove' | 'move';
  readonly direction?: 'earlier' | 'later';
  readonly label: string;
  readonly copy: Copy;
  readonly tone?: 'secondary' | 'destructive';
}) {
  return (
    <ActionForm
      action={changePathAction}
      submitLabel={label}
      pendingLabel={copy.t('pending')}
      messages={copy.messages}
      tone={tone}
    >
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="pathId" value={path.id} />
      <input type="hidden" name="version" value={String(path.version)} />
      <input type="hidden" name="courseId" value={courseId} />
      <input type="hidden" name="op" value={op} />
      {direction === undefined ? null : (
        <input type="hidden" name="direction" value={direction} />
      )}
    </ActionForm>
  );
}

function PathForm({
  locale,
  record,
  copy,
}: {
  readonly locale: Locale;
  readonly record: PathDetail | null;
  readonly copy: Copy;
}) {
  const { t } = copy;
  const prefix = record === null ? 'new-path' : 'path';
  return (
    <ActionForm
      action={savePathAction}
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
      <LabelFields
        prefix={prefix}
        locale={locale}
        labels={record?.labels ?? []}
        primaryLocale={record?.primaryLocale ?? null}
        kind="catalogue"
        copy={copy}
      />
    </ActionForm>
  );
}

export async function PathEditor({ params, searchParams }: EditorParams) {
  const locale = await requireLocale(params);
  const id = editorTarget((await params).id);
  const query = await searchParams;
  const base = `/${locale}/admin/learning/paths`;
  const context = await requireAdminPage(locale, 'learning.read', `${base}/${id}`);
  const copy = await learningCopy(locale);
  const { t } = copy;
  const actor = { accountId: context.session.account.id };

  const record =
    id === 'new'
      ? null
      : await learningRuntime()
          .learning.path(actor, id)
          .catch(() => null);
  if (id !== 'new' && record === null) notFound();

  return (
    <main className="flex flex-col gap-8">
      <p className="text-sm">
        <TextLink href={base}>{t('backToList')}</TextLink>
      </p>
      <div className="flex flex-col gap-2">
        <PageHeading>
          {record === null ? t('path.create') : <Title record={record} locale={locale} />}
        </PageHeading>
        {record === null ? null : (
          <p className="flex flex-wrap items-center gap-3 text-sm">
            <StateBadge state={record.state} copy={copy} />
            <span>
              {t('version')}: {record.version}
            </span>
            {record.state === 'published' ? (
              <TextLink
                href={`/${locale}/learn/paths/${encodeURIComponent(record.slug)}`}
              >
                {t('viewPublic')}
              </TextLink>
            ) : null}
          </p>
        )}
      </div>

      {record === null ? null : (
        <>
          <Transitions
            locale={locale}
            record={record}
            action={transitionPathAction}
            kind="path"
            copy={copy}
          />
          <Members
            locale={locale}
            record={record}
            find={queryValue(query, 'find')}
            administers={context.authorization.can('learning.administer')}
            accountId={actor.accountId}
            copy={copy}
          />
        </>
      )}

      <Panel>
        <div className="flex flex-col gap-4">
          <SectionHeading>
            {record === null ? t('path.create') : t('path.edit')}
          </SectionHeading>
          <PathForm locale={locale} record={record} copy={copy} />
        </div>
      </Panel>
    </main>
  );
}

async function Members({
  locale,
  record,
  find,
  administers,
  accountId,
  copy,
}: {
  readonly locale: Locale;
  readonly record: PathDetail;
  readonly find: string | null;
  /** Course choices are an administering read; a reader is shown the order only. */
  readonly administers: boolean;
  readonly accountId: string;
  readonly copy: Copy;
}) {
  const { t } = copy;
  const total = record.members.length;
  const full = total >= LEARNING_LIMITS.pathCourses;
  const members = new Set(record.members.map((course) => course.id));
  const candidates = administers
    ? await learningRuntime().learning.courseChoices({ accountId }, find)
    : [];
  const addable = candidates.filter((course) => !members.has(course.id));

  return (
    <section className="flex flex-col gap-4" aria-labelledby="path-courses">
      <SectionHeading>
        <span id="path-courses">{t('path.courses')}</span>
      </SectionHeading>
      <p className="text-sm text-[color:var(--color-foreground-muted)]">
        {t('path.coursesHelp')}
      </p>
      {total === 0 ? (
        <EmptyState>{t('path.coursesEmpty')}</EmptyState>
      ) : (
        <ol aria-labelledby="path-courses" className="flex flex-col gap-3">
          {record.members.map((course, index) => {
            const title = titleText(course.labels, locale, course.primaryLocale);
            const place = { title, position: String(index + 1), total: String(total) };
            return (
              <Panel key={course.id} as="li">
                <div className="flex flex-col gap-3">
                  <p className="flex flex-wrap items-center gap-3">
                    <span className="text-sm text-[color:var(--color-foreground-muted)]">
                      {t('path.position', {
                        position: place.position,
                        total: place.total,
                      })}
                    </span>
                    <TextLink href={`/${locale}/admin/learning/courses/${course.id}`}>
                      <Title record={course} locale={locale} />
                    </TextLink>
                    <StateBadge state={course.state} copy={copy} />
                  </p>
                  <div className="flex flex-wrap gap-3">
                    {index === 0 ? null : (
                      <ChangeForm
                        locale={locale}
                        path={record}
                        courseId={course.id}
                        op="move"
                        direction="earlier"
                        label={t('path.moveEarlier', place)}
                        copy={copy}
                      />
                    )}
                    {index === total - 1 ? null : (
                      <ChangeForm
                        locale={locale}
                        path={record}
                        courseId={course.id}
                        op="move"
                        direction="later"
                        label={t('path.moveLater', place)}
                        copy={copy}
                      />
                    )}
                    <ChangeForm
                      locale={locale}
                      path={record}
                      courseId={course.id}
                      op="remove"
                      label={t('path.remove', place)}
                      copy={copy}
                      tone="destructive"
                    />
                  </div>
                </div>
              </Panel>
            );
          })}
        </ol>
      )}

      {!administers ? null : (
        <Panel>
          <div className="flex flex-col gap-4">
            <SectionHeading>{t('path.add')}</SectionHeading>
            <form method="get" className="flex flex-wrap items-end gap-3">
              <Field id="course-find" label={t('path.findLabel')}>
                {(props) => (
                  <TextInput
                    {...props}
                    name="find"
                    defaultValue={find ?? ''}
                    maxLength={120}
                  />
                )}
              </Field>
              <button
                type="submit"
                className="inline-flex min-h-11 items-center rounded-[var(--radius-control)] border border-[color:var(--color-border-strong)] px-4 text-sm font-medium"
              >
                {t('path.find')}
              </button>
            </form>
            {full ? (
              <EmptyState>{t('failure.limit')}</EmptyState>
            ) : addable.length === 0 ? (
              <EmptyState>{t('path.noCandidates')}</EmptyState>
            ) : (
              <ActionForm
                action={changePathAction}
                submitLabel={t('path.addSubmit')}
                pendingLabel={t('pending')}
                messages={copy.messages}
              >
                <input type="hidden" name="locale" value={locale} />
                <input type="hidden" name="pathId" value={record.id} />
                <input type="hidden" name="version" value={String(record.version)} />
                <input type="hidden" name="op" value="add" />
                <Field id="path-add-course" label={t('path.addCourse')}>
                  {(props) => (
                    <Select {...props} name="courseId" required defaultValue="">
                      <option value="">{t('none')}</option>
                      {addable.map((course) => (
                        <option key={course.id} value={course.id}>
                          {`${titleText(course.labels, locale, course.primaryLocale)} (${course.slug})`}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              </ActionForm>
            )}
          </div>
        </Panel>
      )}
    </section>
  );
}
