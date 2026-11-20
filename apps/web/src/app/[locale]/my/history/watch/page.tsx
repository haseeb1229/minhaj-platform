import type { Metadata } from 'next';
import { localizedPath } from '@minhaj/contracts';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { targetKey } from '@minhaj/contracts/personalisation';

import { MyPage } from '@/components/my/frame';
import {
  MyListBeyond,
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
import { myTabs, myTrail } from '@/components/my/sections';
import { TargetItem } from '@/components/my/targets';
import { shortDate } from '@/components/my/time';
import { refusalMessages } from '@/components/personal/parts';
import { personalRead } from '@/components/personal/read';
import { Alert, EmptyState } from '@/components/ui';
import { personalisationRuntime } from '@/composition/personalisation';
import { resolvePersonalTargets } from '@/composition/personal-targets';
import { historyLinks } from '@/components/personal/nav';
import { requireLocale } from '@/config/route-locale';
import { ActionForm } from '../../../(identity)/form-state';
import { requireActiveSession } from '../../guard';
import { removeWatchAction } from '../actions';
import { ClearHistory, HistoryOffNotice } from '../shared';

/**
 * Watch history — the videos the person has watched, most recent first,
 * recorded ONLY while they have history turned on (ROUTE_MAP.md §5.1;
 * Phase 21). One entry per video, the last time it was watched, and every
 * entry removable here.
 *
 * MY MINHAJ PART 1: "Showing n–m of N", numbered pages (`?page=`, one address
 * per view), and a removal said aloud once its row has gone. Every entry is a
 * video, so there is nothing to filter by.
 */
export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}): Promise<Metadata> {
  return myPageMetadata(params, 'watch');
}

/** PER REQUEST, always: this surface reads a session. */
export const dynamic = 'force-dynamic';

export default async function WatchHistoryPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const locale = await requireLocale(params);
  const path = localizedPath(locale, '/my/history/watch');
  const session = await requireActiveSession(locale, path);
  const t = await getTranslations({ locale, namespace: 'personal' });
  const my = await getTranslations({ locale, namespace: 'my' });
  const related = { label: t('nav.label'), links: historyLinks(locale, t) };
  const spec: MyListSpec<never> = { path };
  const asked = readMyList(spec, await searchParams);
  if (asked.outcome === 'redirect') redirect(asked.to);

  const frame = {
    related,
    title: t('history.watchTitle'),
    description: <p>{t('history.watchDescription')}</p>,
    tabs: {
      label: my('tabs.label.history'),
      items: myTabs(locale, 'history', 'watch', (key) => my(`tabs.${key}`)),
    },
    trail: {
      label: my('trail.label'),
      crumbs: myTrail(locale, my('trail.home'), [{ text: t('history.watchTitle') }]),
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
  const actor = { accountId: session.account.id };
  const { history, settings } = personalisationRuntime();
  const read = await personalRead('personal-watch-history', () =>
    Promise.all([
      settings.settings(actor),
      history.watching(actor, myListOffset(view.page)),
    ]),
  );

  if (!read.ok)
    return (
      <MyPage {...frame}>
        <Alert tone="error">{t('failure.load')}</Alert>
      </MyPage>
    );

  const [current, page] = read.value;
  const video = (id: string) => ({ kind: 'video' as const, id });
  const titles = await resolvePersonalTargets(
    page.items.map((entry) => video(entry.videoId)),
    locale,
  );
  const timeZone = session.account.timezone;
  const range = myListRange(view.page, page.items.length);

  return (
    <MyPage
      {...frame}
      announce={{
        value: String(page.total),
        message: my('live.list', { count: page.total }),
      }}
    >
      {current.historyEnabled ? null : <HistoryOffNotice locale={locale} t={t} />}

      {range === null ? null : (
        <MyListStatus>{my('count.watch', { ...range, total: page.total })}</MyListStatus>
      )}

      {page.items.length === 0 ? (
        page.total === 0 ? (
          <EmptyState
            icon="video"
            title={my('history.emptyTitle')}
            action={{
              href: localizedPath(locale, '/watch'),
              text: my('history.watchExplore'),
            }}
          >
            {t('history.watchEmpty')}
          </EmptyState>
        ) : (
          <MyListBeyond
            text={my('list.beyond')}
            first={myListHref(spec, { page: 1, filter: null })}
            firstText={my('list.first')}
          />
        )
      ) : (
        <ol
          aria-label={t('history.watchList')}
          className="flex flex-col border-t border-border"
        >
          {page.items.map((entry) => (
            <TargetItem
              key={entry.videoId}
              kind="video"
              resolved={titles.get(targetKey(video(entry.videoId)))}
              words={{
                kind: (kind) => t(`kinds.${kind}`),
                unavailable: t('target.unavailable'),
                unknown: t('target.unknown'),
              }}
              meta={[
                my('history.watched', {
                  date: shortDate(new Date(entry.lastWatchedAt), locale, timeZone),
                }),
              ]}
              actions={
                <ActionForm
                  action={removeWatchAction}
                  submitLabel={t('history.remove')}
                  pendingLabel={t('common.working')}
                  tone="secondary"
                  messages={refusalMessages(t)}
                >
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="videoId" value={entry.videoId} />
                </ActionForm>
              }
            />
          ))}
        </ol>
      )}

      <MyListPager
        label={t('history.watchList')}
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

      {page.total === 0 ? null : <ClearHistory locale={locale} t={t} />}
    </MyPage>
  );
}
