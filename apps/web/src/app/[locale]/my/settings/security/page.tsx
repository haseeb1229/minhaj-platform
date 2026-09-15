import { getFormatter, getTranslations } from 'next-intl/server';

import { identityRuntime } from '@/composition/identity';
import { requestContext } from '@/composition/request';
import { requireLocale } from '@/config/route-locale';
import { MIN_PASSWORD_LENGTH } from '@minhaj/contracts/identity';
import {
  Alert,
  Field,
  PageHeading,
  Panel,
  SectionHeading,
  SessionList,
  SessionRow,
  TextInput,
} from '@/components/ui';
import { ActionForm } from '../../../(identity)/form-state';
import {
  changePasswordAction,
  closeAccountAction,
  requestEmailChangeAction,
  revokeOtherSessionsAction,
} from '../../../(identity)/actions';
import { requireActiveSession } from '../../guard';
import { RevokeSessionForm } from './revoke-form';

/**
 * Account & Security — the NON-PRIVILEGED self-service surface (ROUTE_MAP.md
 * §5.1).
 *
 * DOMAIN_MODEL.md §4.6 is explicit that these capabilities "must be reachable
 * in the product": a password change or a session revocation that exists only
 * as a backend service is not delivered. Everything here is the account acting
 * on itself.
 *
 * WHAT IS DELIBERATELY ABSENT. No second-factor enrolment, no recovery codes,
 * no role or permission display, no privileged administration. Those need the
 * authorisation enforcement that arrives with Chunk 2, and a surface that
 * showed them without it would be a control that does not control anything
 * (SECURITY_BASELINE.md §3.4).
 */
export const metadata = { robots: { index: false, follow: false } };

/**
 * PER REQUEST, always. This surface reads a session or a one-time token, so
 * there is nothing to prerender and a cached copy would be somebody else's.
 */
export const dynamic = 'force-dynamic';

export default async function SecurityPage({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}) {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'identity' });
  const format = await getFormatter({ locale });

  const session = await requireActiveSession(locale, `/${locale}/my/settings/security`);

  const { identity } = identityRuntime();
  const context = await requestContext(locale);

  const sessions = await identity.listSessions(context);
  const methods = await identity.describeAuthenticationMethods(session);

  const others = sessions.filter((entry) => !entry.current);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-10">
      <header className="flex flex-col gap-2">
        <PageHeading>{t('security.title')}</PageHeading>
        <p className="text-[color:var(--color-foreground-muted)]">
          {t('security.description')}
        </p>
      </header>

      {/* ---- Password ---------------------------------------------------- */}

      <section className="flex flex-col gap-3" aria-labelledby="password-heading">
        <span id="password-heading">
          <SectionHeading>{t('security.changePassword')}</SectionHeading>
        </span>

        <Panel>
          <ActionForm
            action={changePasswordAction}
            submitLabel={t('security.changePassword')}
            pendingLabel={t('common.working')}
            messages={{
              success: t('security.passwordChanged'),
              'invalid-credentials': t('security.passwordWrong'),
              'invalid-input': t('common.checkFields'),
              'rate-limited': t('common.rateLimited'),
              unknown: t('common.unavailable'),
            }}
          >
            <input type="hidden" name="locale" value={locale} />

            <Field id="currentPassword" label={t('common.currentPassword')}>
              {(props) => (
                <TextInput
                  {...props}
                  name="currentPassword"
                  type="password"
                  autoComplete="current-password"
                  required
                />
              )}
            </Field>

            <Field
              id="newPassword"
              label={t('common.newPassword')}
              help={t('common.passwordHelp', { min: MIN_PASSWORD_LENGTH })}
            >
              {(props) => (
                <TextInput
                  {...props}
                  name="newPassword"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={MIN_PASSWORD_LENGTH}
                />
              )}
            </Field>
          </ActionForm>
        </Panel>
      </section>

      {/* ---- Email address ----------------------------------------------- */}

      <section className="flex flex-col gap-3" aria-labelledby="email-heading">
        <span id="email-heading">
          <SectionHeading>{t('security.changeEmail')}</SectionHeading>
        </span>

        <Panel>
          <ActionForm
            action={requestEmailChangeAction}
            submitLabel={t('security.changeEmail')}
            pendingLabel={t('common.working')}
            messages={{
              // The SAME message whether or not the target address is already
              // registered. An authenticated form is still an enumeration
              // oracle if it answers that question.
              success: t('security.emailSubmitted'),
              'invalid-credentials': t('security.passwordWrong'),
              'invalid-input': t('common.checkFields'),
              'rate-limited': t('common.rateLimited'),
              unknown: t('common.unavailable'),
            }}
          >
            <input type="hidden" name="locale" value={locale} />

            <Field
              id="newEmail"
              label={t('security.newEmail')}
              help={t('security.changeEmailHelp')}
            >
              {(props) => <TextInput {...props} name="newEmail" type="email" required />}
            </Field>

            {/* The address is the root of every recovery path, so moving it
                costs the password — not merely a live session. */}
            <Field id="emailCurrentPassword" label={t('common.currentPassword')}>
              {(props) => (
                <TextInput
                  {...props}
                  name="currentPassword"
                  type="password"
                  autoComplete="current-password"
                  required
                />
              )}
            </Field>
          </ActionForm>
        </Panel>
      </section>

      {/* ---- Sessions ----------------------------------------------------- */}

      <section className="flex flex-col gap-3" aria-labelledby="sessions-heading">
        <span id="sessions-heading">
          <SectionHeading>{t('security.sessions')}</SectionHeading>
        </span>
        <p className="text-sm text-[color:var(--color-foreground-muted)]">
          {t('security.sessionsHelp')}
        </p>

        <SessionList label={t('security.sessions')}>
          {sessions.map((entry) => (
            <SessionRow
              key={entry.id}
              current={entry.current}
              currentLabel={t('security.currentSession')}
              detail={
                <>
                  <span className="text-sm">
                    {t('security.signedInAt')}{' '}
                    {format.dateTime(entry.createdAt, {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                  </span>
                  {entry.ipAddress === null ? null : (
                    <span className="truncate text-xs text-[color:var(--color-foreground-muted)]">
                      {t('security.lastSeenFrom')} {entry.ipAddress}
                    </span>
                  )}
                </>
              }
              action={
                entry.current ? undefined : (
                  <RevokeSessionForm
                    locale={locale}
                    sessionId={entry.id}
                    label={t('security.revoke')}
                    pendingLabel={t('common.working')}
                    failureLabel={t('common.unavailable')}
                  />
                )
              }
            />
          ))}
        </SessionList>

        {/*
         * THE OUTCOME IS THE CONFIRMATION, as it is for revoking one session.
         *
         * Success removes every other session, so `others` becomes empty and
         * this branch swaps to the notice below — which is a polite live
         * region announcing "No other sessions." A `success:` message on the
         * form could never be seen, because success is precisely what unmounts
         * the form that would render it.
         */}
        {others.length === 0 ? (
          <Alert tone="info">{t('security.noSessions')}</Alert>
        ) : (
          <ActionForm
            action={revokeOtherSessionsAction}
            submitLabel={t('security.revokeOthers')}
            pendingLabel={t('common.working')}
            tone="secondary"
            messages={{ unknown: t('common.unavailable') }}
          >
            <input type="hidden" name="locale" value={locale} />
          </ActionForm>
        )}
      </section>

      {/* ---- Sign-in methods ---------------------------------------------- */}

      <section className="flex flex-col gap-3" aria-labelledby="methods-heading">
        <span id="methods-heading">
          <SectionHeading>{t('security.methods')}</SectionHeading>
        </span>
        <p className="text-sm text-[color:var(--color-foreground-muted)]">
          {t('security.methodsHelp')}
        </p>

        <Panel>
          <p className="text-sm font-medium">{t('security.methodPassword')}</p>

          {/* The final-method rule, stated where it applies. Phase 2G adds
              Google through the same count, so this needs no rewriting — and
              no Google affordance appears until it genuinely works. */}
          {methods.canRemoveOne ? null : (
            <p className="mt-1 text-xs text-[color:var(--color-foreground-muted)]">
              {t('security.methodFinal')}
            </p>
          )}
        </Panel>
      </section>

      {/* ---- Closure ------------------------------------------------------ */}

      <section className="flex flex-col gap-3" aria-labelledby="close-heading">
        <span id="close-heading">
          <SectionHeading>{t('security.close')}</SectionHeading>
        </span>
        <p className="text-sm text-[color:var(--color-foreground-muted)]">
          {t('security.closeHelp')}
        </p>

        <Panel>
          <ActionForm
            action={closeAccountAction}
            submitLabel={t('security.closeSubmit')}
            pendingLabel={t('common.working')}
            tone="destructive"
            messages={{
              'invalid-credentials': t('security.passwordWrong'),
              'invalid-input': t('common.checkFields'),
              'rate-limited': t('common.rateLimited'),
              unknown: t('common.unavailable'),
            }}
          >
            <input type="hidden" name="locale" value={locale} />

            {/* Re-proving the credential is the only confirmation that means
                anything. A typed "DELETE" proves someone can type, which is
                not the question when a browser is left unlocked. */}
            <Field id="closePassword" label={t('security.closeConfirm')}>
              {(props) => (
                <TextInput
                  {...props}
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                />
              )}
            </Field>
          </ActionForm>
        </Panel>
      </section>
    </main>
  );
}
