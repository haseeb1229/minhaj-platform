import type { Metadata } from 'next';
import { localizedPath } from '@minhaj/contracts';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { isInternalDestination } from '@minhaj/contracts/personalisation';

import { MyPage, OnwardLink } from '@/components/my/frame';
import {
  MyListBeyond,
  MyListFilters,
  MyListPager,
  MyListRefused,
  MyListStatus,
} from '@/components/my/list-parts';
import {
  myListHref,
  myListOffset,
  myListRange,
  readMyList,
  type MyListSpec,
} from '@/components/my/list-view';
import { myPageMetadata } from '@/components/my/metadata';
import { myTrail } from '@/components/my/sections';
import { dayDistance } from '@/components/my/time';
import { PersonalTime, refusalMessages } from '@/components/personal/parts';
import { personalRead } from '@/components/personal/read';
import { Alert, Badge, EmptyState, Icon } from '@/components/ui';
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
 *
 * MY MINHAJ PART 1: All and Unread as counted tabs (`?show=unread`), "Showing
 * n–m of N", numbered pages (`?page=`), one address per view (`list-view.ts`),
 * today and yesterday said as such, a confirmation before read notifications
 * are cleared for good, and every change said aloud once the page has it.
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
  const spec: MyListSpec<'unread'> = { path, param: 'show', filters: ['unread'] };
  const asked = readMyList(spec, await searchParams);
  if (asked.outcome === 'redirect') redirect(asked.to);

  const settings = (
    <OnwardLink href={localizedPath(locale, '/my/settings/notifications')}>
      {t('nav.notificationSettings')}
    </OnwardLink>
  );
  const frame = {
    title: t('notifications.title'),
    action: settings,
    measure: 'reading' as const,
    trail: {
      label: my('trail.label'),
      crumbs: myTrail(locale, my('trail.home'), [{ text: t('notifications.title') }]),
    },
  };

  if (asked.outcome === 'refused')
    return (
      <MyPage {...frame}>
        <MyListRefused
          title={my('list.refusedTitle')}
          text={my('list.refused')}
          all={path}
          allText={my('list.all')}
        />
      </MyPage>
    );

  const view = asked.view;
  const unreadOnly = view.filter === 'unread';
  const actor = { accountId: session.account.id };
  const { notifications } = personalisationRuntime();
  const read = await personalRead('personal-notifications', () =>
    Promise.all([
      notifications.notifications(actor, myListOffset(view.page), unreadOnly),
      notifications.unread(actor),
      // The whole list's total, for its tab, when the page shows the unread.
      unreadOnly ? notifications.notifications(actor, 0) : null,
    ]),
  );

  if (!read.ok)
    return (
      <MyPage {...frame}>
        <Alert tone="error">{t('failure.load')}</Alert>
      </MyPage>
    );

  const [page, unread, everything] = read.value;
  const total = everything === null ? page.total : everything.total;
  const messages = refusalMessages(t);
  const number = new Intl.NumberFormat(locale);
  const range = myListRange(view.page, page.items.length);
  const now = new Date();
  const timeZone = session.account.timezone;

  return (
    <MyPage
      {...frame}
      description={
        <>
          <p>{t('notifications.description')}</p>
          <p className="font-semibold text-foreground">
            {t('notifications.unreadCount', { count: unread })}
          </p>
        </>
      }
      announce={{
        value: `${view.filter ?? 'all'}:${String(total)}:${String(unread)}`,
        message: my('live.notifications', { total, unread }),
      }}
    >
      {total === 0 ? null : (
        <div className="flex flex-col gap-4">
          <MyListFilters
            label={my('list.notificationViews')}
            spec={spec}
            current={view.filter}
            minimum={2}
            format={(count) => number.format(count)}
            items={[
              { value: null, text: my('list.allNotifications'), count: total },
              { value: 'unread', text: t('notifications.unread'), count: unread },
            ]}
          />
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
            {total === unread ? null : (
              <ActionForm
                action={clearReadNotificationsAction}
                submitLabel={t('notifications.clearRead')}
                pendingLabel={t('common.working')}
                tone="secondary"
                messages={messages}
                confirm={{
                  title: my('confirm.clearRead.title'),
                  body: my('confirm.clearRead.body', { count: total - unread }),
                  confirmLabel: my('confirm.clearRead.confirm'),
                  cancelLabel: my('confirm.cancel'),
                }}
              >
                <input type="hidden" name="locale" value={locale} />
              </ActionForm>
            )}
          </div>
          {range === null ? null : (
            <MyListStatus>
              {my(unreadOnly ? 'count.unread' : 'count.notifications', {
                ...range,
                total: page.total,
              })}
            </MyListStatus>
          )}
        </div>
      )}

      {page.items.length === 0 ? (
        total === 0 ? (
          <EmptyState icon="bell" title={my('notifications.emptyTitle')}>
            {t('notifications.empty')}
          </EmptyState>
        ) : page.total === 0 ? (
          <EmptyState
            icon="check"
            title={my('notifications.noUnreadTitle')}
            action={{ href: path, text: my('notifications.seeAll') }}
          >
            {my('notifications.noUnread')}
          </EmptyState>
        ) : (
          <MyListBeyond
            text={my('list.beyond')}
            first={myListHref(spec, { page: 1, filter: view.filter })}
            firstText={my('list.first')}
          />
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
            const distance = dayDistance(new Date(entry.createdAt), now, timeZone);
            const day = distance === 0 ? 'today' : distance === -1 ? 'yesterday' : null;
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
                      {day === null ? null : (
                        <span className="font-semibold">
                          {my(`notifications.${day}`)}
                        </span>
                      )}
                      <PersonalTime
                        value={entry.createdAt}
                        locale={locale}
                        timeZone={timeZone}
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

      <MyListPager
        label={t('notifications.list')}
        spec={spec}
        view={view}
        total={page.total}
        locale={locale}
        words={{
          previous: t('list.previous'),
          next: t('list.next'),
          page: (number) => my('list.page', { page: number }),
        }}
      />
    </MyPage>
  );
}
