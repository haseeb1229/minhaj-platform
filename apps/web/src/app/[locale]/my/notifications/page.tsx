import { getTranslations } from 'next-intl/server';

import {
  PERSONAL_LIMITS,
  isInternalDestination,
} from '@minhaj/contracts/personalisation';

import { pageLinks } from '@/components/hadith/presentation';
import { Pagination } from '@/components/media/parts';
import {
  PersonalFrame,
  PersonalLinks,
  PersonalTime,
  refusalMessages,
} from '@/components/personal/parts';
import {
  personalOffsetHref,
  readPersonalOffset,
} from '@/components/personal/presentation';
import { personalRead } from '@/components/personal/read';
import { Alert, EmptyState, Panel, StatusBadge, TextLink } from '@/components/ui';
import { personalisationRuntime } from '@/composition/personalisation';
import { requireLocale } from '@/config/route-locale';
import { ActionForm } from '../../(identity)/form-state';
import { requireActiveSession } from '../guard';
import {
  clearReadNotificationsAction,
  markAllNotificationsReadAction,
  markNotificationReadAction,
  removeNotificationAction,
} from './actions';

/**
 * Notifications — system-generated, one-directional, the person's own
 * (ROUTE_MAP.md §5.1; DOMAIN_MODEL.md §14.1; Phase 21).
 *
 * WHAT A NOTIFICATION SAYS IS A KEY THIS PAGE TRANSLATES — never stored prose —
 * so it reads in the interface language the person is using now.
 *
 * A LINK ONLY TO THIS SITE. A notification's destination is a stored same-site
 * path; it is re-checked here with the contract's own rule before it becomes an
 * `href`, so even a row that somehow held anything else renders no link at all.
 */
export const metadata = { robots: { index: false, follow: false } };

/** PER REQUEST, always: this surface reads a session. */
export const dynamic = 'force-dynamic';

export default async function NotificationsPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const locale = await requireLocale(params);
  const path = `/${locale}/my/notifications`;
  const session = await requireActiveSession(locale, path);
  const t = await getTranslations({ locale, namespace: 'personal' });
  const actor = { accountId: session.account.id };
  const offset = readPersonalOffset(await searchParams);
  const { notifications } = personalisationRuntime();
  const read = await personalRead('personal-notifications', () =>
    Promise.all([
      notifications.notifications(actor, offset),
      notifications.unread(actor),
    ]),
  );
  const back = (
    <PersonalLinks
      label={t('nav.label')}
      links={[
        {
          href: `/${locale}/my/settings/notifications`,
          text: t('nav.notificationSettings'),
        },
        { href: `/${locale}/my`, text: t('nav.account') },
      ]}
    />
  );

  if (!read.ok)
    return (
      <PersonalFrame title={t('notifications.title')} back={back}>
        <Alert tone="error">{t('failure.load')}</Alert>
      </PersonalFrame>
    );

  const [page, unread] = read.value;
  const links = pageLinks(page.offset, PERSONAL_LIMITS.page, page.total);
  const messages = refusalMessages(t);

  return (
    <PersonalFrame
      title={t('notifications.title')}
      description={
        <>
          <p>{t('notifications.description')}</p>
          <p>{t('notifications.unreadCount', { count: unread })}</p>
        </>
      }
      back={back}
    >
      {page.total === 0 ? null : (
        <div className="flex flex-wrap items-start gap-2">
          {unread === 0 ? null : (
            <ActionForm
              action={markAllNotificationsReadAction}
              submitLabel={t('notifications.markAllRead')}
              pendingLabel={t('common.working')}
              tone="secondary"
              messages={messages}
            >
              <input type="hidden" name="locale" value={locale} />
            </ActionForm>
          )}
          {page.total === unread ? null : (
            <ActionForm
              action={clearReadNotificationsAction}
              submitLabel={t('notifications.clearRead')}
              pendingLabel={t('common.working')}
              tone="secondary"
              messages={messages}
            >
              <input type="hidden" name="locale" value={locale} />
            </ActionForm>
          )}
        </div>
      )}

      {page.items.length === 0 ? (
        <EmptyState>
          {page.total === 0 ? t('notifications.empty') : t('list.beyond')}
        </EmptyState>
      ) : (
        <ol aria-label={t('notifications.list')} className="flex flex-col gap-3">
          {page.items.map((entry) => {
            const destination =
              entry.destination !== null && isInternalDestination(entry.destination)
                ? `/${locale}${entry.destination}`
                : null;
            return (
              <Panel key={entry.id} as="li">
                <div className="flex min-w-0 flex-col gap-3">
                  <div className="flex flex-wrap items-center gap-3">
                    {entry.readAt === null ? (
                      <StatusBadge tone="caution">
                        {t('notifications.unread')}
                      </StatusBadge>
                    ) : (
                      <StatusBadge tone="neutral">{t('notifications.read')}</StatusBadge>
                    )}
                    <span className="text-sm text-[color:var(--color-foreground-muted)]">
                      <PersonalTime
                        value={entry.createdAt}
                        locale={locale}
                        timeZone={session.account.timezone}
                      />
                    </span>
                  </div>
                  <p className={entry.readAt === null ? 'font-semibold' : undefined}>
                    {t(`notifications.kind.${entry.kind}`)}
                  </p>
                  {destination === null ? null : (
                    <p>
                      <TextLink href={destination}>{t('notifications.open')}</TextLink>
                    </p>
                  )}
                  <div className="flex flex-wrap items-start gap-2">
                    {entry.readAt === null ? (
                      <ActionForm
                        action={markNotificationReadAction}
                        submitLabel={t('notifications.markRead')}
                        pendingLabel={t('common.working')}
                        tone="secondary"
                        messages={messages}
                      >
                        <input type="hidden" name="locale" value={locale} />
                        <input type="hidden" name="id" value={entry.id} />
                      </ActionForm>
                    ) : null}
                    <ActionForm
                      action={removeNotificationAction}
                      submitLabel={t('notifications.remove')}
                      pendingLabel={t('common.working')}
                      tone="secondary"
                      messages={messages}
                    >
                      <input type="hidden" name="locale" value={locale} />
                      <input type="hidden" name="id" value={entry.id} />
                    </ActionForm>
                  </div>
                </div>
              </Panel>
            );
          })}
        </ol>
      )}

      <Pagination
        label={t('notifications.list')}
        previous={
          links.previous === null ? null : personalOffsetHref(path, links.previous)
        }
        next={links.next === null ? null : personalOffsetHref(path, links.next)}
        previousLabel={t('list.previous')}
        nextLabel={t('list.next')}
      />
    </PersonalFrame>
  );
}
