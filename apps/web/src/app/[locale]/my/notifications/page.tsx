import type { Metadata } from 'next';
import { localizedPath } from '@minhaj/contracts';
import { getTranslations } from 'next-intl/server';

import {
  PERSONAL_LIMITS,
  isInternalDestination,
} from '@minhaj/contracts/personalisation';

import { pageLinks } from '@/components/hadith/presentation';
import { MyPage, OnwardLink } from '@/components/my/frame';
import { myPageMetadata } from '@/components/my/metadata';
import { PersonalTime, refusalMessages } from '@/components/personal/parts';
import {
  personalOffsetHref,
  readPersonalOffset,
} from '@/components/personal/presentation';
import { personalRead } from '@/components/personal/read';
import { Alert, Badge, EmptyState, Icon, Pager } from '@/components/ui';
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
 * (ROUTE_MAP.md §5.1; DOMAIN_MODEL.md §14.1; Phase 21; redesigned in R2).
 *
 * WHAT A NOTIFICATION SAYS IS A KEY THIS PAGE TRANSLATES — never stored prose —
 * so it reads in the interface language the person is using now.
 *
 * A LINK ONLY TO THIS SITE. A notification's destination is a stored same-site
 * path; it is re-checked here with the contract's own rule before it becomes an
 * `href`, so even a row that somehow held anything else renders no link at all.
 *
 * UNREAD IS SAID IN WORDS (a badge) and by weight — never by a dot alone.
 */
export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}): Promise<Metadata> {
  return myPageMetadata(params, 'notifications');
}

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
  const path = localizedPath(locale, '/my/notifications');
  const session = await requireActiveSession(locale, path);
  const t = await getTranslations({ locale, namespace: 'personal' });
  const my = await getTranslations({ locale, namespace: 'my' });
  const actor = { accountId: session.account.id };
  const offset = readPersonalOffset(await searchParams);
  const { notifications } = personalisationRuntime();
  const read = await personalRead('personal-notifications', () =>
    Promise.all([
      notifications.notifications(actor, offset),
      notifications.unread(actor),
    ]),
  );
  const settings = (
    <OnwardLink href={localizedPath(locale, '/my/settings/notifications')}>
      {t('nav.notificationSettings')}
    </OnwardLink>
  );

  if (!read.ok)
    return (
      <MyPage title={t('notifications.title')} action={settings}>
        <Alert tone="error">{t('failure.load')}</Alert>
      </MyPage>
    );

  const [page, unread] = read.value;
  const links = pageLinks(page.offset, PERSONAL_LIMITS.page, page.total);
  const messages = refusalMessages(t);

  return (
    <MyPage
      title={t('notifications.title')}
      description={
        <>
          <p>{t('notifications.description')}</p>
          <p className="font-semibold text-foreground">
            {t('notifications.unreadCount', { count: unread })}
          </p>
        </>
      }
      action={settings}
      measure="reading"
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
        page.total === 0 ? (
          <EmptyState icon="bell" title={my('notifications.emptyTitle')}>
            {t('notifications.empty')}
          </EmptyState>
        ) : (
          <EmptyState>{t('list.beyond')}</EmptyState>
        )
      ) : (
        <ol
          aria-label={t('notifications.list')}
          className="flex flex-col border-t border-border"
        >
          {page.items.map((entry) => {
            const destination =
              entry.destination !== null && isInternalDestination(entry.destination)
                ? localizedPath(locale, `${entry.destination}`)
                : null;
            const unreadEntry = entry.readAt === null;
            return (
              <li
                key={entry.id}
                className={`flex min-w-0 flex-col gap-3 border-b border-border py-4 sm:flex-row sm:items-start ${
                  unreadEntry ? '' : 'text-foreground-muted'
                }`}
              >
                <div className="flex min-w-0 flex-1 items-start gap-4">
                  <span
                    aria-hidden="true"
                    className={`flex size-10 shrink-0 items-center justify-center rounded-full ${
                      unreadEntry
                        ? 'bg-accent-surface text-accent'
                        : 'bg-surface-sunken text-foreground-muted'
                    }`}
                  >
                    <Icon name="bell" size={20} />
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="flex flex-wrap items-center gap-2 text-caption">
                      {unreadEntry ? (
                        <Badge kind="status" tone="caution">
                          {t('notifications.unread')}
                        </Badge>
                      ) : (
                        <Badge kind="status">{t('notifications.read')}</Badge>
                      )}
                      <PersonalTime
                        value={entry.createdAt}
                        locale={locale}
                        timeZone={session.account.timezone}
                      />
                    </span>
                    <p
                      className={
                        unreadEntry ? 'font-semibold text-foreground' : 'text-foreground'
                      }
                    >
                      {t(`notifications.kind.${entry.kind}`)}
                    </p>
                    {destination === null ? null : (
                      <p>
                        <OnwardLink href={destination}>
                          {t('notifications.open')}
                        </OnwardLink>
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap items-start gap-2 ps-14 sm:ps-0">
                  {unreadEntry ? (
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
              </li>
            );
          })}
        </ol>
      )}

      <Pager
        label={t('notifications.list')}
        previous={
          links.previous === null ? null : personalOffsetHref(path, links.previous)
        }
        next={links.next === null ? null : personalOffsetHref(path, links.next)}
        previousLabel={t('list.previous')}
        nextLabel={t('list.next')}
      />
    </MyPage>
  );
}
