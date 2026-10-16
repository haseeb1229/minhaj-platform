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
  StatusBadge,
  TextInput,
  TextLink,
} from '@/components/ui';
import { requireAdminPage } from '@/composition/authorization';
import { learningRuntime } from '@/composition/learning';
import { requireLocale } from '@/config/route-locale';
import { ActionForm } from '../../../../(identity)/form-state';
import { pageOffset, queryValue } from '../../../shared';
import { endScopeAction, grantScopeAction } from '../../actions';
import { Title, learningCopy, titleText, type ListParams } from '../../shared';
import {
  ActivationNotice,
  ClassPager,
  PersonName,
  classesBase,
  pagedHref,
  participantNameMap,
} from '../parts';

/**
 * `/{locale}/admin/learning/classes/scopes` — which teacher teaches which
 * Course, current and ended (ROUTE_MAP.md §7; DELIVERY_PLAN.md Phase 23).
 *
 * A SCOPE GRANTS NO IDENTITY KEY. It names an account Identity ALREADY reports
 * holding a live `teaching.perform` assignment, which People reports as a
 * published TeacherProfile; the service refuses anything else with
 * `not-a-teacher`. The account identifier is the one Identity lists under
 * `/admin/identity/assignments` — there is deliberately no directory search
 * here, so this page never becomes a way to look people up.
 *
 * Ending a scope is confirmed and carries the version shown; the row stays as
 * safe history.
 */
export const dynamic = 'force-dynamic';

/** The most catalogue pages consulted for the Course choice. */
const COURSE_PAGES = 4;

export default async function ScopesPage({ params, searchParams }: ListParams) {
  const locale = await requireLocale(params);
  const query = await searchParams;
  const base = `${classesBase(locale)}/scopes`;
  const context = await requireAdminPage(locale, 'learning.classes.read', base);
  const copy = await learningCopy(locale);
  const { t } = copy;
  const actor = { accountId: context.session.account.id };
  const administer = context.authorization.can('learning.classes.administer');
  const ended = queryValue(query, 'show') === 'ended';
  const offset = pageOffset(query, 24);
  const { classes } = learningRuntime();

  const [mode, page] = await Promise.all([
    classes.activation(actor),
    classes.scopes(actor, { current: !ended }, offset),
  ]);
  const items = page.items;
  const names = await participantNameMap(items.map((item) => item.scope.accountId));

  // Live-format Courses, for the grant form — only when it is offered, read
  // under the class keys themselves, so no catalogue key is needed beside them.
  const courses = administer
    ? await (async () => {
        const found = [];
        for (let index = 0; index < COURSE_PAGES; index += 1) {
          const result = await classes.liveCourses(actor, index * 24);
          found.push(...result.items);
          if (!result.hasMore) break;
        }
        return found;
      })()
    : [];

  return (
    <main className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <PageHeading>{t('classes.scopes')}</PageHeading>
        <p className="text-sm text-[color:var(--color-foreground-muted)]">
          {t('classes.scopesDescription')}
        </p>
        <p>
          <TextLink href={classesBase(locale)}>{t('backToList')}</TextLink>
        </p>
      </div>
      <ActivationNotice mode={mode} copy={copy} />

      <nav className="flex flex-wrap gap-4" aria-label={t('classes.scopes')}>
        <TextLink href={base}>{t('classes.scopesCurrent')}</TextLink>
        <TextLink href={`${base}?show=ended`}>{t('classes.scopesEnded')}</TextLink>
      </nav>

      <section className="flex flex-col gap-3" aria-labelledby="scopes-list">
        <SectionHeading>
          <span id="scopes-list">
            {ended ? t('classes.scopesEnded') : t('classes.scopesCurrent')}
          </span>
        </SectionHeading>
        {items.length === 0 ? (
          <EmptyState>{t('classes.scopesEmpty')}</EmptyState>
        ) : (
          <DataTable
            caption={ended ? t('classes.scopesEnded') : t('classes.scopesCurrent')}
            columns={[
              t('classes.course'),
              t('classes.teacher'),
              t('state'),
              ...(administer && !ended ? [t('classes.scopeActions')] : []),
            ]}
          >
            {items.map((item) => (
              <DataRow key={item.scope.id}>
                <DataCell wrap>
                  <Title record={item.course} locale={locale} />
                </DataCell>
                <DataCell wrap>
                  <PersonName
                    accountId={item.scope.accountId}
                    names={names}
                    fallback={t('classes.teacherUnnamed')}
                  />
                </DataCell>
                <DataCell>
                  <StatusBadge
                    tone={item.scope.endedAt === null ? 'positive' : 'neutral'}
                  >
                    {item.scope.endedAt === null
                      ? t('classes.scopeCurrent')
                      : t('classes.scopeEnded')}
                  </StatusBadge>
                </DataCell>
                {administer && !ended ? (
                  <DataCell>
                    <div className="flex flex-col gap-3">
                      {item.scope.endedAt === null ? (
                        <TextLink
                          href={`${classesBase(locale)}/new?scope=${item.scope.id}`}
                        >
                          {t('classes.scheduleFor', {
                            title: titleText(
                              item.course.labels,
                              locale,
                              item.course.primaryLocale,
                            ),
                          })}
                        </TextLink>
                      ) : null}
                      {item.scope.endedAt === null ? (
                        <ActionForm
                          action={endScopeAction}
                          submitLabel={t('classes.endScope')}
                          pendingLabel={t('pending')}
                          tone="destructive"
                          messages={copy.messages}
                        >
                          <input type="hidden" name="locale" value={locale} />
                          <input type="hidden" name="id" value={item.scope.id} />
                          <input
                            type="hidden"
                            name="version"
                            value={String(item.scope.version)}
                          />
                          <ConfirmField
                            id={`end-${item.scope.id}`}
                            label={t('classes.endScopeConfirm')}
                          />
                        </ActionForm>
                      ) : null}
                    </div>
                  </DataCell>
                ) : null}
              </DataRow>
            ))}
          </DataTable>
        )}
        <ClassPager
          offset={offset}
          hasMore={page.hasMore}
          hrefFor={pagedHref(base, ended ? { show: 'ended' } : {})}
          label={t('classes.scopes')}
          copy={copy}
        />
      </section>

      {!administer ? null : (
        <section className="flex flex-col gap-3" aria-labelledby="scopes-grant">
          <SectionHeading>
            <span id="scopes-grant">{t('classes.grant')}</span>
          </SectionHeading>
          <p className="text-sm text-[color:var(--color-foreground-muted)]">
            {t('classes.grantHelp')}
          </p>
          {courses.length === 0 ? (
            <Alert tone="info">{t('classes.grantNoCourses')}</Alert>
          ) : (
            <Panel>
              <ActionForm
                action={grantScopeAction}
                submitLabel={t('classes.grantSubmit')}
                pendingLabel={t('pending')}
                messages={copy.messages}
                preserveInput
              >
                <input type="hidden" name="locale" value={locale} />
                <Field id="grant-course" label={t('classes.course')}>
                  {(props) => (
                    <Select {...props} name="courseId" required defaultValue="">
                      <option value="" disabled>
                        {t('classes.chooseCourse')}
                      </option>
                      {courses.map((course) => (
                        <option key={course.id} value={course.id}>
                          {titleText(course.labels, locale, course.primaryLocale)}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field
                  id="grant-account"
                  label={t('classes.accountId')}
                  help={t('classes.accountIdHelp')}
                >
                  {(props) => (
                    <TextInput
                      {...props}
                      name="accountId"
                      required
                      maxLength={64}
                      autoComplete="off"
                      spellCheck={false}
                      dir="ltr"
                    />
                  )}
                </Field>
                <p className="text-sm">
                  <TextLink href={`/${locale}/admin/identity/assignments`}>
                    {t('classes.assignmentsLink')}
                  </TextLink>
                </p>
              </ActionForm>
            </Panel>
          )}
        </section>
      )}
    </main>
  );
}
