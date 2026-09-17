import { getFormatter, getTranslations } from 'next-intl/server';

import { requireAdminPage } from '@/composition/authorization';
import { identityRuntime } from '@/composition/identity';
import { requireLocale } from '@/config/route-locale';
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
import { ActionForm } from '../../../(identity)/form-state';
import { grantAssignmentAction, revokeAssignmentAction } from '../../actions';
import { StepUpPrompt } from '../../step-up';
import { PAGE_SIZE, adminCopy, pageOffset, queryValue } from '../../shared';

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
export const metadata = { robots: { index: false, follow: false } };
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
    `/${locale}/admin/identity/assignments`,
  );
  const copy = await adminCopy(locale);

  const includeRevoked = queryValue(query, 'revoked') === '1';

  const { administration } = identityRuntime();
  const [assignments, roles] = await Promise.all([
    administration.listAssignments({
      includeRevoked,
      limit: PAGE_SIZE,
      offset: pageOffset(query, PAGE_SIZE),
    }),
    administration.listRoles({ includeDeactivated: false }),
  ]);

  const mayGrant = page.authorization.can('permissions.grant');

  return (
    <main className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <PageHeading>{t('assignments.title')}</PageHeading>
        <p className="text-sm text-[color:var(--color-foreground-muted)]">
          {t('assignments.description')}
        </p>
      </header>

      {mayGrant ? (
        <StepUpPrompt
          locale={locale}
          purpose="privilege-administration"
          labels={copy.stepUp}
        />
      ) : null}

      {mayGrant ? (
        <Panel>
          <div className="flex flex-col gap-3">
            <SectionHeading>{t('assignments.grantTitle')}</SectionHeading>

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
                  />
                )}
              </Field>

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
          <TextLink href={`/${locale}/admin/identity/assignments`}>
            {t('assignments.showLive')}
          </TextLink>
        ) : (
          <TextLink href={`/${locale}/admin/identity/assignments?revoked=1`}>
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
                  <code className="block text-xs break-all text-[color:var(--color-foreground-muted)]">
                    {assignment.accountId}
                  </code>
                </DataCell>

                <DataCell wrap>
                  <span className="block">{assignment.roleName}</span>
                  <code className="block text-xs text-[color:var(--color-foreground-muted)]">
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
                      <span className="mt-1 block text-xs text-[color:var(--color-foreground-muted)]">
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
                      >
                        <input type="hidden" name="locale" value={locale} />
                        <input type="hidden" name="assignmentId" value={assignment.id} />

                        <Field
                          id={`revoke-reason-${assignment.id}`}
                          label={t('assignments.reason')}
                        >
                          {(props) => (
                            <TextInput
                              {...props}
                              name="reason"
                              type="text"
                              maxLength={200}
                            />
                          )}
                        </Field>
                      </ActionForm>
                    ) : (
                      <span className="text-xs text-[color:var(--color-foreground-muted)]">
                        —
                      </span>
                    )}
                  </DataCell>
                ) : null}
              </DataRow>
            ))}
          </DataTable>
        </Panel>
      )}

      {assignments.more ? <Alert tone="info">{t('common.more')}</Alert> : null}
    </main>
  );
}
