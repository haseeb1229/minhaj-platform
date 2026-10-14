import { getTranslations } from 'next-intl/server';

import { settingsLinks } from '@/components/personal/nav';
import {
  PersonalFrame,
  PersonalLinks,
  refusalMessages,
} from '@/components/personal/parts';
import { personalRead } from '@/components/personal/read';
import { Alert, Panel, StatusBadge, TextLink } from '@/components/ui';
import { personalisationRuntime } from '@/composition/personalisation';
import { requireLocale } from '@/config/route-locale';
import { ActionForm } from '../../../(identity)/form-state';
import { requireActiveSession } from '../../guard';
import { setNotificationPreferenceAction } from './actions';

/**
 * Notification preferences (ROUTE_MAP.md §5.1; Phase 21).
 *
 * ONLY WHAT EXISTS IS OFFERED. One switch per category on each channel the
 * platform actually delivers — today, updates about the person's own questions,
 * in-app. No email switch is shown, because no notification is emailed.
 *
 * WHAT CANNOT BE TURNED OFF IS SAID SO. Verification, password-reset and
 * security mail are Identity's and are always sent; the newsletter is a
 * separate subscription, managed from its own emails (ARCHITECTURE.md §4.6.1).
 */
export const metadata = { robots: { index: false, follow: false } };

/** PER REQUEST, always: this surface reads a session. */
export const dynamic = 'force-dynamic';

export default async function NotificationSettingsPage({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}) {
  const locale = await requireLocale(params);
  const session = await requireActiveSession(
    locale,
    `/${locale}/my/settings/notifications`,
  );
  const t = await getTranslations({ locale, namespace: 'personal' });
  const read = await personalRead('personal-notification-preferences', () =>
    personalisationRuntime().notifications.preferences({ accountId: session.account.id }),
  );
  const back = <PersonalLinks label={t('nav.label')} links={settingsLinks(locale, t)} />;
  const description = (
    <>
      <p>{t('notificationSettings.description')}</p>
      <ul className="flex list-disc flex-col gap-1 ps-5 text-sm">
        <li>{t('notificationSettings.inAppOnly')}</li>
        <li>{t('notificationSettings.security')}</li>
        <li>
          {t('notificationSettings.newsletter')}{' '}
          <TextLink href={`/${locale}/newsletter`}>
            {t('notificationSettings.newsletterLink')}
          </TextLink>
        </li>
      </ul>
    </>
  );

  return (
    <PersonalFrame
      title={t('notificationSettings.title')}
      description={description}
      back={back}
    >
      {!read.ok ? (
        <Alert tone="error">{t('failure.load')}</Alert>
      ) : (
        <ul aria-label={t('notificationSettings.list')} className="flex flex-col gap-3">
          {read.value.map((preference) => (
            <Panel key={`${preference.category}:${preference.channel}`} as="li">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 flex-col gap-1">
                  <p className="font-medium">
                    {t(`notificationSettings.category.${preference.category}`)}
                  </p>
                  <p className="text-sm text-[color:var(--color-foreground-muted)]">
                    {t(`notificationSettings.channel.${preference.channel}`)}
                  </p>
                  <p>
                    <StatusBadge tone={preference.enabled ? 'positive' : 'neutral'}>
                      {preference.enabled
                        ? t('notificationSettings.on')
                        : t('notificationSettings.off')}
                    </StatusBadge>
                  </p>
                </div>
                <ActionForm
                  action={setNotificationPreferenceAction}
                  submitLabel={
                    preference.enabled
                      ? t('notificationSettings.turnOff')
                      : t('notificationSettings.turnOn')
                  }
                  pendingLabel={t('common.working')}
                  tone="secondary"
                  messages={refusalMessages(t)}
                >
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="category" value={preference.category} />
                  <input type="hidden" name="channel" value={preference.channel} />
                  <input
                    type="hidden"
                    name="enabled"
                    value={preference.enabled ? 'false' : 'true'}
                  />
                </ActionForm>
              </div>
            </Panel>
          ))}
        </ul>
      )}
    </PersonalFrame>
  );
}
