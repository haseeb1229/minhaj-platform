import { getTranslations } from 'next-intl/server';

import { requireAdminPage } from '@/composition/authorization';
import { identityRuntime } from '@/composition/identity';
import { requireLocale } from '@/config/route-locale';
import { serverEnv } from '@/config/server-env';
import {
  Alert,
  DetailRow,
  PageHeading,
  Panel,
  SectionHeading,
  StatusBadge,
} from '@/components/ui';

/**
 * Provider configuration and status — for the Phase-2 email integration.
 *
 * WHAT IT SHOWS: whether sending is configured, which provider, what sender
 * identity mail carries, and whether inbound provider events can be verified.
 *
 * WHAT IT NEVER SHOWS, AND HAS NO WAY TO: the API key, the webhook signing
 * secret, or any part of either. It reports PRESENCE — a boolean the
 * environment already answers — and nothing that could be read back
 * (SECURITY_BASELINE.md §18.1).
 *
 * THERE IS NO SECRET EDITOR. Credentials arrive through deployment
 * configuration, which is where a rotation is reviewed and where the value
 * never passes through a browser. A web form that wrote one would put a live
 * provider credential into a request body, a server log and an operator's
 * screen, and would need a secure non-secret configuration model nobody has
 * specified (CLAUDE.md §24, §29).
 *
 * CAPABILITY-CONDITIONAL, NOT PRETEND. An absent key means the provider
 * reports itself unavailable and refuses to send; it never turns a real send
 * into a silent one, and this page says which of the two is true.
 */
export const metadata = { robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function IntegrationsPage({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}) {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'admin' });

  await requireAdminPage(
    locale,
    'integrations.read',
    `/${locale}/admin/system/integrations`,
  );

  const { provider, deliveries } = identityRuntime();
  const environment = serverEnv();
  const summary = await deliveries.summarise();

  // PRESENCE ONLY. Never the value, never a prefix, never a length — a length
  // is a fact about a secret, and a prefix is part of one.
  const webhookConfigured = environment.RESEND_WEBHOOK_SECRET !== undefined;

  return (
    <main className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <PageHeading>{t('integrations.title')}</PageHeading>
        <p className="text-sm text-[color:var(--color-foreground-muted)]">
          {t('integrations.description')}
        </p>
      </header>

      <Panel>
        <div className="flex flex-col gap-3">
          <SectionHeading>{t('integrations.provider')}</SectionHeading>

          <dl className="flex flex-col divide-y divide-[color:var(--color-border)]">
            <DetailRow term={t('integrations.provider')}>
              <code className="text-xs">{provider.providerName}</code>
            </DetailRow>

            <DetailRow term={t('integrations.state')}>
              <StatusBadge tone={provider.available ? 'positive' : 'caution'}>
                {provider.available
                  ? t('integrations.available')
                  : t('integrations.unavailable')}
              </StatusBadge>
            </DetailRow>

            <DetailRow term={t('integrations.sender')}>
              {environment.EMAIL_FROM_ADDRESS}
            </DetailRow>

            <DetailRow term={t('integrations.senderName')}>
              {environment.EMAIL_FROM_NAME}
            </DetailRow>

            <DetailRow term={t('integrations.webhook')}>
              <StatusBadge tone={webhookConfigured ? 'positive' : 'caution'}>
                {webhookConfigured
                  ? t('integrations.webhookConfigured')
                  : t('integrations.webhookMissing')}
              </StatusBadge>
            </DetailRow>
          </dl>

          <Alert tone="info">{t('integrations.secretsNote')}</Alert>
        </div>
      </Panel>

      <Panel>
        <div className="flex flex-col gap-3">
          <SectionHeading>{t('delivery.title')}</SectionHeading>

          <dl className="flex flex-col divide-y divide-[color:var(--color-border)]">
            <DetailRow term={t('delivery.pending')}>{summary.pending}</DetailRow>
            <DetailRow term={t('delivery.failed')}>{summary.failed}</DetailRow>
            <DetailRow term={t('delivery.suppressed')}>{summary.suppressed}</DetailRow>
          </dl>
        </div>
      </Panel>
    </main>
  );
}
