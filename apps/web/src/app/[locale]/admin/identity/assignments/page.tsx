import { localizedPath } from '@minhaj/contracts';
import { getFormatter, getTranslations } from 'next-intl/server';

import { requireAdminPage } from '@/composition/authorization';
import { identityRuntime } from '@/composition/identity';
import { requireLocale } from '@/config/route-locale';
import {
  Button,
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
import { ActionForm } from '../../../(identity)/form-state';
import { grantAssignmentAction, revokeAssignmentAction } from '../../actions';
import { StepUpPrompt } from '../../step-up';
import { AdminPager } from '../../pager';
import { adminPageHref } from '../../paging';
import { PAGE_SIZE, adminCopy, pageOffset, queryValue } from '../../shared';
import { adminPageMetadata } from '../../metadata';

/**
 * Role assignments — who holds what, and the history of every change.
 *
 * THE ACCOUNT IS NAMED BY ITS IDENTIFIER, not its address. `User.id` is
 * authoritative: an address can be released by closure and re-registered by
 * somebody else, so a grant keyed on one could reach a different person
 * entirely (DOMAIN_MODEL.md §4.6, CLAUDE.md §11). The accounts surface shows
 * the identifier beside each address for exactly this.
 *
 * NO UNBOUNDED PICKER. There is no "select a user" dropdown listing everyone,
 * because on a platform with a real membership that control is both unusable
 * and a bulk disclosure. The operator finds the account on the accounts
 * surface, which is bounded and searchable, and brings its identifier here.
 *
 * REVOKED ROWS ARE RETAINED. "This person held the administrator role between
 * these dates" is what an investigation reads, and it is exactly what a delete
 * would destroy (SECURITY_BASELINE.md §13.3).
 */
export const generateMetadata = adminPageMetadata('admin', 'assignments.title');

/** How many accounts the picker offers for one search. */
const PICKER_SIZE = 8;
export const dynamic = 'force-dynamic';

export default async function AssignmentsPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const locale = await requireLocale(params);
  const query = await searchParams;
  const t = await getTranslations({ locale, namespace: 'admin' });
  const format = await getFormatter({ locale });

  const page = await requireAdminPage(
    locale,
    'assignments.read',
    localizedPath(locale, '/admin/identity/assignments'),
  );
  const copy = await adminCopy(locale);

  const includeRevoked = queryValue(query, 'revoked') === '1';
  const offset = pageOffset(query, PAGE_SIZE);
  const pageNumber = offset / PAGE_SIZE + 1;

  const { administration } = identityRuntime();
  const [assignments, roles] = await Promise.all([
    administration.listAssignments({
      includeRevoked,
      limit: PAGE_SIZE,
      offset,
    }),
    administration.listRoles({ includeDeactivated: false }),
  ]);

  const mayGrant = page.authorization.can('permissions.grant');

  // R2: the account picker. A bounded search over ACTIVE accounts — only for
  // somebody who may also read accounts (`users.read`), since it shows
  // addresses; anyone else grants by identifier as before.
  const mayFind = mayGrant && page.authorization.can('users.read');
  const accountQuery = mayFind ? queryValue(query, 'account') : null;
  const candidates =
    accountQuery === null
      ? null
      : await administration.searchAccounts({
          query: accountQuery,
          status: 'active',
          limit: PICKER_SIZE,
          offset: 0,
        });

  return (
    <main className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <PageHeading>{t('assignments.title')}</PageHeading>
        <p className="text-sm text-foreground-muted">{t('assignments.description')}</p>
      </header>

      {mayGrant ? (
        <StepUpPrompt
          locale={locale}
          purpose="privilege-administration"
          labels={copy.stepUp}
          returnTo={adminPageHref(localizedPath(locale, '/admin/identity/assignments'), {
            revoked: includeRevoked ? '1' : null,
            account: accountQuery,
          })(pageNumber)}
        />
      ) : null}

      {mayGrant ? (
        <Panel>
          <div className="flex flex-col gap-3">
            <SectionHeading>{t('assignments.grantTitle')}</SectionHeading>

            {mayFind ? (
              <form method="get" className="flex flex-wrap items-end gap-3">
                {includeRevoked ? <input type="hidden" name="revoked" value="1" /> : null}
                <div className="min-w-48 grow">
                  <Field
                    id="find-account"
                    label={t('assignments.findAccount')}
                    help={t('assignments.findAccountHelp')}
                  >
                    {(props) => (
                      <TextInput
                        {...props}
                        name="account"
                        type="search"
                        defaultValue={accountQuery ?? ''}
                        maxLength={200}
                      />
                    )}
                  </Field>
                </div>
                <Button tone="secondary">{t('common.searchSubmit')}</Button>
              </form>
            ) : null}

            <ActionForm
              action={grantAssignmentAction}
              submitLabel={t('assignments.grantSubmit')}
              pendingLabel={t('common.saving')}
              messages={{
                ...copy.messages,
                success: t('assignments.grantedMessage'),
              }}
            >
              <input type="hidden" name="locale" value={locale} />

              {candidates !== null && candidates.items.length > 0 ? (
                <fieldset className="flex flex-col gap-1">
                  <legend className="mb-1 text-sm font-medium">
                    {t('assignments.account')}
                  </legend>
                  {candidates.items.map((account, index) => (
                    <label
                      key={account.id}
                      className="flex min-h-11 items-center gap-3 rounded-control border border-border px-3 py-2 has-[:checked]:border-action"
                    >
                      <input
                        type="radio"
                        name="accountId"
                        value={account.id}
                        required
                        defaultChecked={index === 0 && candidates.items.length === 1}
                      />
                      <span className="flex min-w-0 flex-col">
                        <span className="font-medium break-all">{account.email}</span>
                        <span className="text-xs text-foreground-muted">
                          {account.name}
                        </span>
                      </span>
                    </label>
                  ))}
                  {candidates.more ? (
                    <p className="text-xs text-foreground-muted">
                      {t('assignments.findAccountMore')}
                    </p>
                  ) : null}
                </fieldset>
              ) : (
                <>
                  {candidates !== null ? (
                    <p className="text-sm text-foreground-muted" role="status">
                      {t('assignments.findAccountNone')}
                    </p>
                  ) : null}
                  <Field
                    id="grant-account"
                    label={t('assignments.grantAccount')}
                    help={t('assignments.grantAccountHelp')}
                  >
                    {(props) => (
                      <TextInput
                        {...props}
                        name="accountId"
                        type="text"
                        required
                        maxLength={36}
                        dir="ltr"
                      />
                    )}
                  </Field>
                </>
              )}

              <Field id="grant-role" label={t('assignments.grantRole')}>
                {(props) => (
                  <Select {...props} name="roleId" required defaultValue="">
                    <option value="" disabled>
                      —
                    </option>
                    {roles.map((role) => (
                      <option key={role.id} value={role.id}>
                        {role.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>

              <Field id="grant-reason" label={t('assignments.grantReason')}>
                {(props) => (
                  <TextInput {...props} name="reason" type="text" maxLength={200} />
                )}
              </Field>
            </ActionForm>
          </div>
        </Panel>
      ) : null}

      <nav className="text-sm">
        {includeRevoked ? (
          <TextLink href={localizedPath(locale, '/admin/identity/assignments')}>
            {t('assignments.showLive')}
          </TextLink>
        ) : (
          <TextLink href={localizedPath(locale, '/admin/identity/assignments?revoked=1')}>
            {t('assignments.showRevoked')}
          </TextLink>
        )}
      </nav>

      {assignments.items.length === 0 ? (
        <EmptyState>{t('common.none')}</EmptyState>
      ) : (
        <Panel>
          <DataTable
            caption={t('assignments.title')}
            columns={[
              t('assignments.account'),
              t('assignments.role'),
              t('assignments.granted'),
              t('assignments.reason'),
              ...(mayGrant ? [t('assignments.revokeSubmit')] : []),
            ]}
          >
            {assignments.items.map((assignment) => (
              <DataRow key={assignment.id}>
                <DataCell wrap>
                  <span className="block">{assignment.accountEmail}</span>
                  <code className="block text-xs break-all text-foreground-muted">
                    {assignment.accountId}
                  </code>
                </DataCell>

                <DataCell wrap>
                  <span className="block">{assignment.roleName}</span>
                  <code className="block text-xs text-foreground-muted">
                    {assignment.roleKey}
                  </code>
                </DataCell>

                <DataCell>
                  <span className="block">
                    {format.dateTime(assignment.grantedAt, { dateStyle: 'medium' })}
                  </span>
                  {assignment.revokedAt === null ? (
                    <StatusBadge tone="positive">{t('assignments.live')}</StatusBadge>
                  ) : (
                    <>
                      <StatusBadge tone="neutral">{t('assignments.revoked')}</StatusBadge>
                      <span className="mt-1 block text-xs text-foreground-muted">
                        {format.dateTime(assignment.revokedAt, { dateStyle: 'medium' })}
                      </span>
                    </>
                  )}
                </DataCell>

                <DataCell wrap>
                  <span className="text-xs">
                    {assignment.revokedAt === null
                      ? (assignment.grantedReason ?? '—')
                      : (assignment.revokedReason ?? '—')}
                  </span>
                </DataCell>

                {mayGrant ? (
                  <DataCell>
                    {assignment.revokedAt === null ? (
                      <ActionForm
                        action={revokeAssignmentAction}
                        submitLabel={t('assignments.revokeSubmit')}
                        pendingLabel={t('common.pending')}
                        tone="destructive"
                        messages={{
                          ...copy.messages,
                          success: t('assignments.revokedMessage'),
                        }}
                        confirm={{
                          title: t('confirm.revoke.title'),
                          body: t('confirm.revoke.body'),
                          confirmLabel: t('confirm.revoke.confirm'),
                          cancelLabel: t('confirm.cancel'),
                          // The service records this reason with the revoke.
                          reason: {
                            name: 'reason',
                            label: t('assignments.reason'),
                            help: t('confirm.reasonRecorded'),
                            required: false,
                            maxLength: 200,
                          },
                        }}
                      >
                        <input type="hidden" name="locale" value={locale} />
                        <input type="hidden" name="assignmentId" value={assignment.id} />
                      </ActionForm>
                    ) : (
                      <span className="text-xs text-foreground-muted">—</span>
                    )}
                  </DataCell>
                ) : null}
              </DataRow>
            ))}
          </DataTable>
        </Panel>
      )}

      <AdminPager
        label={t('pager.label')}
        offset={offset}
        pageSize={PAGE_SIZE}
        more={assignments.more}
        href={adminPageHref(localizedPath(locale, '/admin/identity/assignments'), {
          revoked: includeRevoked ? '1' : null,
        })}
        previousLabel={t('pager.previous')}
        nextLabel={t('pager.next')}
      />
    </main>
  );
}
