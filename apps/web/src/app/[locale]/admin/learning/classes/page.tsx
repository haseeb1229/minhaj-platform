import { SESSION_KINDS, SESSION_STATES } from '@minhaj/contracts/learning';

import {
  Button,
  DataCell,
  DataRow,
  DataTable,
  EmptyState,
  Field,
  PageHeading,
  Select,
  TextLink,
} from '@/components/ui';
import { requireAdminPage } from '@/composition/authorization';
import { learningRuntime } from '@/composition/learning';
import { requireLocale } from '@/config/route-locale';
import { Title, learningCopy, type ListParams } from '../shared';
import {
  ActivationNotice,
  ClassPager,
  PersonName,
  SessionKindBadge,
  SessionStateBadge,
  SessionTimes,
  classesBase,
  participantNameMap,
  sessionsHref,
  sessionsQuery,
} from './parts';

/**
 * `/{locale}/admin/learning/classes` — every class, by state, kind and Course
 * (ROUTE_MAP.md §7; DELIVERY_PLAN.md Phase 23).
 *
 * `learning.classes.read` OPENS IT — a key distinct from the catalogue's
 * `learning.read`, because a class names a teacher and leads to its
 * participants. The Course choices are the Courses with a CURRENT teaching
 * scope, read under the same key; the directory never needs the catalogue's.
 *
 * THE ACTIVATION IS SAID. An operator may prepare scopes before live learning
 * is switched on, but no class can be scheduled until it is; the banner says
 * which state the platform is in rather than leaving a refusal to explain it.
 */
export const dynamic = 'force-dynamic';

export default async function ClassDirectoryPage({ params, searchParams }: ListParams) {
  const locale = await requireLocale(params);
  const query = await searchParams;
  const base = classesBase(locale);
  const context = await requireAdminPage(locale, 'learning.classes.read', base);
  const copy = await learningCopy(locale);
  const { t } = copy;
  const actor = { accountId: context.session.account.id };
  const filter = sessionsQuery(query);
  const { classes } = learningRuntime();
  const [mode, page, scopes] = await Promise.all([
    classes.activation(actor),
    classes.sessions(actor, filter),
    classes.scopes(actor, { current: true }, 0),
  ]);
  const names = await participantNameMap(
    page.items.map((row) => row.session.teacherAccountId),
  );

  // The Courses an operator may narrow to: those with a current scope, each once.
  const courses = new Map(scopes.items.map((scope) => [scope.course.id, scope.course]));
  for (const row of page.items) courses.set(row.course.id, row.course);

  return (
    <main className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageHeading>{t('surface.classes')}</PageHeading>
        <nav className="flex flex-wrap gap-4" aria-label={t('surface.classes')}>
          <TextLink href={`${base}/new`}>{t('classes.create')}</TextLink>
          <TextLink href={`${base}/scopes`}>{t('classes.scopes')}</TextLink>
        </nav>
      </div>
      <p className="text-sm text-[color:var(--color-foreground-muted)]">
        {t('classes.description')}
      </p>
      <ActivationNotice mode={mode} copy={copy} />

      <form method="get" action={base} className="flex flex-wrap items-end gap-3">
        <Field id="classes-state" label={t('state')}>
          {(props) => (
            <Select {...props} name="state" defaultValue={filter.state ?? ''}>
              <option value="">{t('allStates')}</option>
              {SESSION_STATES.map((state) => (
                <option key={state} value={state}>
                  {t(`classes.stateName.${state}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field id="classes-kind" label={t('classes.kind')}>
          {(props) => (
            <Select {...props} name="kind" defaultValue={filter.kind ?? ''}>
              <option value="">{t('classes.anyKind')}</option>
              {SESSION_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {t(`classes.kindName.${kind}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field id="classes-course" label={t('classes.course')}>
          {(props) => (
            <Select {...props} name="course" defaultValue={filter.courseId ?? ''}>
              <option value="">{t('classes.anyCourse')}</option>
              {[...courses.values()].map((course) => (
                <option key={course.id} value={course.id}>
                  {course.labels.find((label) => label.locale === locale)?.title ??
                    course.labels[0]?.title ??
                    course.slug}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Button tone="secondary">{t('filterApply')}</Button>
      </form>

      {page.items.length === 0 ? (
        <EmptyState>{t('classes.empty')}</EmptyState>
      ) : (
        <DataTable
          caption={t('surface.classes')}
          columns={[
            t('classes.when'),
            t('labelTitle'),
            t('classes.teacher'),
            t('classes.kind'),
            t('state'),
            t('classes.meeting'),
          ]}
        >
          {page.items.map((row) => (
            <DataRow key={row.session.id}>
              <DataCell wrap>
                <TextLink href={`${base}/${row.session.id}`}>
                  <SessionTimes session={row.session} locale={locale} copy={copy} />
                </TextLink>
              </DataCell>
              <DataCell wrap>
                <Title record={row.course} locale={locale} />
              </DataCell>
              <DataCell wrap>
                <PersonName
                  accountId={row.session.teacherAccountId}
                  names={names}
                  fallback={t('classes.teacherUnnamed')}
                />
              </DataCell>
              <DataCell>
                <SessionKindBadge kind={row.session.kind} copy={copy} />
              </DataCell>
              <DataCell>
                <SessionStateBadge state={row.session.state} copy={copy} />
              </DataCell>
              <DataCell>
                {row.session.hasMeetingUrl
                  ? t('classes.meetingHeld')
                  : t('classes.meetingNone')}
              </DataCell>
            </DataRow>
          ))}
        </DataTable>
      )}
      <ClassPager
        offset={filter.offset}
        hasMore={page.hasMore}
        hrefFor={sessionsHref(base, filter)}
        label={t('surface.classes')}
        copy={copy}
      />
    </main>
  );
}
