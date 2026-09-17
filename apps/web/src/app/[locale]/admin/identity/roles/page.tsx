import { getTranslations } from 'next-intl/server';

import { requireAdminPage } from '@/composition/authorization';
import { identityRuntime } from '@/composition/identity';
import { requireLocale } from '@/config/route-locale';
import {
  Alert,
  Field,
  PageHeading,
  Panel,
  SectionHeading,
  StatusBadge,
  TextInput,
} from '@/components/ui';
import { ActionForm } from '../../../(identity)/form-state';
import {
  createRoleAction,
  deactivateRoleAction,
  renameRoleAction,
  setRolePermissionsAction,
} from '../../actions';
import { StepUpPrompt } from '../../step-up';
import { adminCopy } from '../../shared';

/**
 * Role administration.
 *
 * THE PROTECTED ROLE IS VISIBLE AND UNTOUCHABLE. It is shown because an
 * operator needs to know it exists and who holds it; its controls are absent
 * from the markup entirely, and the service and the persistence adapter each
 * refuse it again. A disabled control alone would be a client-side rule
 * (SECURITY_BASELINE.md §3.4 rule 1, CLAUDE.md §26).
 *
 * TWO DIFFERENT AUTHORITIES ON ONE PAGE, and the split is deliberate:
 * `roles.administer` renames and deactivates a custom role, while changing what
 * a role PERMITS costs `permissions.grant` — the authority §3.4 rule 6 names
 * for changing what an account may do. An operator can be trusted to tidy names
 * without being trusted to widen privilege.
 */
export const metadata = { robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function RolesPage({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}) {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'admin' });

  const page = await requireAdminPage(
    locale,
    'roles.read',
    `/${locale}/admin/identity/roles`,
  );
  const copy = await adminCopy(locale);

  const { administration } = identityRuntime();
  const [roles, catalogue] = await Promise.all([
    administration.listRoles({ includeDeactivated: true }),
    administration.catalogue(),
  ]);

  const mayAdminister = page.authorization.can('roles.administer');
  const mayGrant = page.authorization.can('permissions.grant');

  return (
    <main className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <PageHeading>{t('roles.title')}</PageHeading>
        <p className="text-sm text-[color:var(--color-foreground-muted)]">
          {t('roles.description')}
        </p>
      </header>

      {mayAdminister || mayGrant ? (
        <StepUpPrompt
          locale={locale}
          purpose="privilege-administration"
          labels={copy.stepUp}
        />
      ) : null}

      {/* ---- Create a custom role ---------------------------------------- */}
      {mayAdminister ? (
        <Panel>
          <div className="flex flex-col gap-3">
            <SectionHeading>{t('roles.createTitle')}</SectionHeading>

            <ActionForm
              action={createRoleAction}
              submitLabel={t('roles.createSubmit')}
              pendingLabel={t('common.saving')}
              messages={{ ...copy.messages, success: t('roles.created') }}
            >
              <input type="hidden" name="locale" value={locale} />

              <Field id="role-key" label={t('roles.key')} help={t('roles.keyHelp')}>
                {(props) => (
                  <TextInput {...props} name="key" type="text" required maxLength={64} />
                )}
              </Field>

              <Field id="role-name" label={t('roles.name')}>
                {(props) => (
                  <TextInput
                    {...props}
                    name="name"
                    type="text"
                    required
                    maxLength={120}
                  />
                )}
              </Field>

              <Field id="role-description" label={t('roles.roleDescription')}>
                {(props) => (
                  <TextInput
                    {...props}
                    name="description"
                    type="text"
                    required
                    maxLength={400}
                  />
                )}
              </Field>

              <fieldset className="flex flex-col gap-2">
                <legend className="text-sm font-medium">{t('roles.permissions')}</legend>
                {catalogue.map((entry) => (
                  <label key={entry.key} className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      name="permissions"
                      value={entry.key}
                      className="mt-1"
                    />
                    <span>
                      <code className="text-xs">{entry.key}</code>
                      <span className="block text-xs text-[color:var(--color-foreground-muted)]">
                        {entry.description}
                      </span>
                    </span>
                  </label>
                ))}
              </fieldset>
            </ActionForm>
          </div>
        </Panel>
      ) : null}

      {/* ---- Existing roles ---------------------------------------------- */}
      <ul className="flex flex-col gap-4">
        {roles.map((role) => (
          <Panel key={role.id} as="li">
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <SectionHeading>{role.name}</SectionHeading>
                <StatusBadge tone={role.system ? 'caution' : 'neutral'}>
                  {role.system ? t('roles.system') : t('roles.custom')}
                </StatusBadge>
                {role.deactivatedAt === null ? null : (
                  <StatusBadge tone="caution">{t('roles.deactivated')}</StatusBadge>
                )}
              </div>

              <p className="text-sm text-[color:var(--color-foreground-muted)]">
                <code className="text-xs">{role.key}</code> — {role.description}
              </p>

              <p className="text-sm">
                {t('roles.holders')}: {role.activeAssignments}
              </p>

              <div className="flex flex-col gap-1">
                <span className="text-sm font-medium">{t('roles.permissions')}</span>
                {role.permissions.length === 0 ? (
                  <span className="text-xs text-[color:var(--color-foreground-muted)]">
                    {t('roles.noPermissions')}
                  </span>
                ) : (
                  <ul className="flex flex-wrap gap-2 text-xs">
                    {role.permissions.map((key) => (
                      <li key={key}>
                        <code>{key}</code>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {role.system ? (
                <Alert tone="info">{t('roles.protectedNote')}</Alert>
              ) : (
                <>
                  {mayAdminister && role.deactivatedAt === null ? (
                    <ActionForm
                      action={renameRoleAction}
                      submitLabel={t('roles.renameSubmit')}
                      pendingLabel={t('common.saving')}
                      tone="secondary"
                      messages={{ ...copy.messages, success: t('roles.renamed') }}
                    >
                      <input type="hidden" name="locale" value={locale} />
                      <input type="hidden" name="roleId" value={role.id} />

                      <Field id={`name-${role.id}`} label={t('roles.name')}>
                        {(props) => (
                          <TextInput
                            {...props}
                            name="name"
                            type="text"
                            required
                            defaultValue={role.name}
                            maxLength={120}
                          />
                        )}
                      </Field>

                      <Field
                        id={`description-${role.id}`}
                        label={t('roles.roleDescription')}
                      >
                        {(props) => (
                          <TextInput
                            {...props}
                            name="description"
                            type="text"
                            required
                            defaultValue={role.description}
                            maxLength={400}
                          />
                        )}
                      </Field>
                    </ActionForm>
                  ) : null}

                  {mayGrant && role.deactivatedAt === null ? (
                    <ActionForm
                      action={setRolePermissionsAction}
                      submitLabel={t('roles.bundleSubmit')}
                      pendingLabel={t('common.saving')}
                      tone="secondary"
                      messages={{ ...copy.messages, success: t('roles.bundleUpdated') }}
                    >
                      <input type="hidden" name="locale" value={locale} />
                      <input type="hidden" name="roleId" value={role.id} />

                      <fieldset className="flex flex-col gap-2">
                        <legend className="text-sm font-medium">
                          {t('roles.bundleTitle')}
                        </legend>
                        {catalogue.map((entry) => (
                          <label
                            key={entry.key}
                            className="flex items-start gap-2 text-sm"
                          >
                            <input
                              type="checkbox"
                              name="permissions"
                              value={entry.key}
                              defaultChecked={role.permissions.includes(entry.key)}
                              className="mt-1"
                            />
                            <code className="text-xs">{entry.key}</code>
                          </label>
                        ))}
                      </fieldset>
                    </ActionForm>
                  ) : null}

                  {mayAdminister && role.deactivatedAt === null ? (
                    <ActionForm
                      action={deactivateRoleAction}
                      submitLabel={t('roles.deactivateSubmit')}
                      pendingLabel={t('common.saving')}
                      tone="destructive"
                      messages={{ ...copy.messages, success: t('roles.deactivated2') }}
                    >
                      <input type="hidden" name="locale" value={locale} />
                      <input type="hidden" name="roleId" value={role.id} />
                    </ActionForm>
                  ) : null}
                </>
              )}
            </div>
          </Panel>
        ))}
      </ul>
    </main>
  );
}
