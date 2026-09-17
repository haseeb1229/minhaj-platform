import { getFormatter, getTranslations } from 'next-intl/server';

import type { AccountStatus } from '@minhaj/contracts/identity';
import { accountStatusSchema } from '@minhaj/contracts/identity';

import { requireAdminPage } from '@/composition/authorization';
import { identityRuntime } from '@/composition/identity';
import { requireLocale } from '@/config/route-locale';
import {
  Alert,
  Button,
  DataCell,
  DataRow,
  DataTable,
  EmptyState,
  Field,
  PageHeading,
  Panel,
  Select,
  StatusBadge,
  TextInput,
} from '@/components/ui';
import { ActionForm } from '../../../(identity)/form-state';
import { changeAccountStatusAction } from '../../actions';
import { StepUpPrompt } from '../../step-up';
import { PAGE_SIZE, adminCopy, pageOffset, queryValue } from '../../shared';

/**
 * Identity account administration.
 *
 * WHAT PHASE 2 ACTUALLY SUPPORTS, and no more: a bounded search, the account's
 * status, and the roles it holds. There is no profile editing, no password
 * reset on somebody's behalf and no second-factor disable — the last of those
 * is absent because "no administrator action may silently disable a second
 * factor to restore privileged access" (SECURITY_BASELINE.md §8.2), and the
 * only route is the audited host-only recovery procedure.
 *
 * THE SEARCH IS BOUNDED AND PREFIX-ANCHORED. One page at a time, ordered
 * deterministically, over indexed columns — never the whole table, which on a
 * platform with a real membership is both a performance problem and a bulk
 * disclosure of everyone's address at once (§28, §41).
 */
export const metadata = { robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

const STATUS_TONE: Record<AccountStatus, 'neutral' | 'positive' | 'caution'> = {
  active: 'positive',
  disabled: 'caution',
  suspended: 'caution',
  closed: 'neutral',
};

export default async function UsersPage({
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
    'users.read',
    `/${locale}/admin/identity/users`,
  );
  const copy = await adminCopy(locale);

  const search = queryValue(query, 'q');
  const statusFilter = accountStatusSchema.safeParse(queryValue(query, 'status'));

  const { administration } = identityRuntime();
  const results = await administration.searchAccounts({
    query: search,
    status: statusFilter.success ? statusFilter.data : null,
    limit: PAGE_SIZE,
    offset: pageOffset(query, PAGE_SIZE),
  });

  // UI hiding is defence in depth, never the control: the action re-checks.
  const mayAdminister = page.authorization.can('users.administer');

  const statusLabel = (status: AccountStatus): string =>
    status === 'active'
      ? t('users.statusActive')
      : status === 'disabled'
        ? t('users.statusDisabled')
        : status === 'suspended'
          ? t('users.statusSuspended')
          : t('users.statusClosed');

  return (
    <main className="flex flex-col gap-4">
      <header className="flex flex-col gap-2">
        <PageHeading>{t('users.title')}</PageHeading>
        <p className="text-sm text-[color:var(--color-foreground-muted)]">
          {t('users.description')}
        </p>
      </header>

      {/*
       * A GET form. Searching changes nothing, so it is not a mutation and must
       * not be a POST — and it keeps the result addressable, which is what lets
       * an operator share or bookmark a filtered view (SECURITY_BASELINE.md §7.1).
       */}
      <Panel>
        <form method="get" className="flex flex-wrap items-end gap-3">
          <div className="min-w-48 grow">
            <Field id="q" label={t('common.search')}>
              {(props) => (
                <TextInput
                  {...props}
                  name="q"
                  type="search"
                  defaultValue={search ?? ''}
                />
              )}
            </Field>
          </div>

          <div className="min-w-40">
            <Field id="status" label={t('users.status')}>
              {(props) => (
                <Select
                  {...props}
                  name="status"
                  defaultValue={statusFilter.success ? statusFilter.data : ''}
                >
                  <option value="">{t('delivery.all')}</option>
                  {accountStatusSchema.options.map((status) => (
                    <option key={status} value={status}>
                      {statusLabel(status)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>

          <Button tone="secondary">{t('common.searchSubmit')}</Button>
        </form>
      </Panel>

      {mayAdminister ? (
        <StepUpPrompt
          locale={locale}
          purpose="account-administration"
          labels={copy.stepUp}
        />
      ) : null}

      {results.items.length === 0 ? (
        <EmptyState>{t('common.none')}</EmptyState>
      ) : (
        <Panel>
          <DataTable
            caption={t('users.title')}
            columns={[
              t('users.email'),
              t('users.status'),
              t('users.roles'),
              t('users.created'),
              ...(mayAdminister ? [t('users.changeStatus')] : []),
            ]}
          >
            {results.items.map((account) => (
              <DataRow key={account.id}>
                <DataCell wrap>
                  <span className="block">{account.email}</span>
                  <span className="block text-xs text-[color:var(--color-foreground-muted)]">
                    {account.name}
                  </span>
                  {/* The internal identifier, because the grant form takes it
                      and an address is not a stable identity (§4.6). */}
                  <code className="block text-xs break-all text-[color:var(--color-foreground-muted)]">
                    {account.id}
                  </code>
                </DataCell>

                <DataCell>
                  <StatusBadge tone={STATUS_TONE[account.status]}>
                    {statusLabel(account.status)}
                  </StatusBadge>
                  <span className="mt-1 block text-xs text-[color:var(--color-foreground-muted)]">
                    {account.emailVerified ? t('users.verified') : t('users.unverified')}
                  </span>
                </DataCell>

                <DataCell wrap>
                  {account.roleKeys.length === 0 ? (
                    <span className="text-xs text-[color:var(--color-foreground-muted)]">
                      {t('users.noRoles')}
                    </span>
                  ) : (
                    <ul className="flex flex-col gap-1 text-xs">
                      {account.roleKeys.map((key) => (
                        <li key={key}>
                          <code>{key}</code>
                        </li>
                      ))}
                    </ul>
                  )}
                </DataCell>

                <DataCell>
                  {format.dateTime(account.createdAt, { dateStyle: 'medium' })}
                </DataCell>

                {mayAdminister ? (
                  <DataCell>
                    <ActionForm
                      action={changeAccountStatusAction}
                      submitLabel={t('users.apply')}
                      pendingLabel={t('common.pending')}
                      tone="secondary"
                      messages={{ ...copy.messages, success: t('users.changed') }}
                    >
                      <input type="hidden" name="locale" value={locale} />
                      <input type="hidden" name="accountId" value={account.id} />

                      <Field id={`status-${account.id}`} label={t('users.changeStatus')}>
                        {(props) => (
                          <Select {...props} name="status" defaultValue={account.status}>
                            {accountStatusSchema.options.map((status) => (
                              <option key={status} value={status}>
                                {statusLabel(status)}
                              </option>
                            ))}
                          </Select>
                        )}
                      </Field>
                    </ActionForm>
                  </DataCell>
                ) : null}
              </DataRow>
            ))}
          </DataTable>
        </Panel>
      )}

      {results.more ? <Alert tone="info">{t('common.more')}</Alert> : null}
    </main>
  );
}
