import { getFormatter, getTranslations } from 'next-intl/server';

import { requireAdminPage } from '@/composition/authorization';
import { identityRuntime } from '@/composition/identity';
import { requireLocale } from '@/config/route-locale';
import {
  Alert,
  DetailRow,
  PageHeading,
  Panel,
  SectionHeading,
  StatusBadge,
  TextLink,
} from '@/components/ui';

/**
 * Identity security — READ-ONLY, and structurally so.
 *
 * It reports two things: the caller's own privileged second-factor posture, and
 * whether the one-time administrator bootstrap has happened.
 *
 * THERE IS NO BOOTSTRAP BUTTON, AND THERE NEVER WILL BE. The bootstrap is a
 * host-only stored procedure that the web application's database principal is
 * explicitly DENIED EXECUTE on, so even an action that tried would be refused
 * by SQL Server. A public, permanently open bootstrap endpoint is the first
 * thing SECURITY_BASELINE.md §8.3 forbids, and the same reasoning covers the
 * lockout recovery: no administrator action may silently disable a second
 * factor to restore privileged access (§8.2).
 *
 * WHAT IT DOES SHOW is the state an operator needs before running either
 * command — whether a bootstrap is still outstanding, who performed the one
 * that happened, and under what ticket.
 *
 * IT DOES NOT REQUIRE A COMPLETE POSTURE. Reading this is how a freshly
 * bootstrapped administrator discovers what is missing; gating it on what it
 * reports would be circular.
 */
export const metadata = { robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function IdentitySecurityPage({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}) {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'admin' });
  const format = await getFormatter({ locale });

  const page = await requireAdminPage(
    locale,
    'security.read',
    `/${locale}/admin/identity/security`,
  );

  const { administration, privilegedSecurity } = identityRuntime();
  const [bootstrap, posture] = await Promise.all([
    administration.bootstrapStatus(),
    privilegedSecurity.describe(page.session.account.id),
  ]);

  return (
    <main className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <PageHeading>{t('security.title')}</PageHeading>
        <p className="text-sm text-[color:var(--color-foreground-muted)]">
          {t('security.description')}
        </p>
      </header>

      <Panel>
        <div className="flex flex-col gap-3">
          <SectionHeading>{t('security.posture')}</SectionHeading>

          <dl className="flex flex-col divide-y divide-[color:var(--color-border)]">
            <DetailRow term={t('security.posture')}>
              <StatusBadge tone={posture.secondFactorEnrolled ? 'positive' : 'caution'}>
                {posture.secondFactorEnrolled
                  ? t('security.enrolled')
                  : t('security.notEnrolled')}
              </StatusBadge>
            </DetailRow>

            <DetailRow term={t('security.codesConfirmed')}>
              <StatusBadge tone={posture.recoveryCodesConfirmed ? 'positive' : 'caution'}>
                {posture.recoveryCodesConfirmed
                  ? t('security.codesConfirmed')
                  : t('security.codesNotConfirmed')}
              </StatusBadge>
            </DetailRow>

            {posture.reenrolmentRequired ? (
              <DetailRow term={t('security.reenrolment')}>
                <StatusBadge tone="caution">{t('security.reenrolment')}</StatusBadge>
              </DetailRow>
            ) : null}
          </dl>

          <p className="text-sm">
            <TextLink href={`/${locale}/my/settings/security`}>
              {t('security.manage')}
            </TextLink>
          </p>
        </div>
      </Panel>

      <Panel>
        <div className="flex flex-col gap-3">
          <SectionHeading>{t('security.bootstrap')}</SectionHeading>

          <dl className="flex flex-col divide-y divide-[color:var(--color-border)]">
            <DetailRow term={t('security.bootstrap')}>
              <StatusBadge tone={bootstrap.completed ? 'positive' : 'caution'}>
                {bootstrap.completed
                  ? t('security.bootstrapCompleted')
                  : t('security.bootstrapPending')}
              </StatusBadge>
            </DetailRow>

            {bootstrap.completedAt === null ? null : (
              <DetailRow term={t('security.bootstrapAt')}>
                {format.dateTime(bootstrap.completedAt, {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })}
              </DetailRow>
            )}

            {bootstrap.operator === null ? null : (
              <DetailRow term={t('security.bootstrapOperator')}>
                <code className="text-xs">{bootstrap.operator}</code>
              </DetailRow>
            )}

            {bootstrap.ticket === null ? null : (
              <DetailRow term={t('security.bootstrapTicket')}>
                {bootstrap.ticket}
              </DetailRow>
            )}

            <DetailRow term={t('security.administrators')}>
              {bootstrap.administratorCount}
            </DetailRow>
          </dl>

          <Alert tone="info">{t('security.hostOnly')}</Alert>
        </div>
      </Panel>
    </main>
  );
}
