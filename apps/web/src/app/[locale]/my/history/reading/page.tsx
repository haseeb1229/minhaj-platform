import type { Metadata } from 'next';
import { localizedPath } from '@minhaj/contracts';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import {
  READABLE_TARGET_KINDS,
  targetKey,
  type ReadableTargetKind,
} from '@minhaj/contracts/personalisation';

import { MyPage } from '@/components/my/frame';
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
import { myTabs, myTrail } from '@/components/my/sections';
import { TargetItem } from '@/components/my/targets';
import { shortDate } from '@/components/my/time';
import { refusalMessages } from '@/components/personal/parts';
import { encodeTarget } from '@/components/personal/presentation';
import { personalRead } from '@/components/personal/read';
import { Alert, EmptyState } from '@/components/ui';
import { personalisationRuntime } from '@/composition/personalisation';
import { resolvePersonalTargets } from '@/composition/personal-targets';
import { historyLinks } from '@/components/personal/nav';
import { requireLocale } from '@/config/route-locale';
import { ActionForm } from '../../../(identity)/form-state';
import { requireActiveSession } from '../../guard';
import { removeReadAction } from '../actions';
import { ClearHistory, HistoryOffNotice } from '../shared';

/**
 * Reading history — what the person has read, most recent first, recorded
 * ONLY while they have history turned on (ROUTE_MAP.md §5.1; Phase 21).
 *
 * PRIVATE CONTINUITY, NOT ANALYTICS. One entry per item, the last time it was
 * read, kept only for the person themselves — and every entry, or all of them,
 * can be removed here.
 *
 * MY MINHAJ PART 1: counted kinds as tabs (`?kind=`), "Showing n–m of N",
 * numbered pages (`?page=`), one address per view (`list-view.ts`), and a
 * removal said aloud once its row has gone.
 */
export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}): Promise<Metadata> {
  return myPageMetadata(params, 'reading');
}

/** PER REQUEST, always: this surface reads a session. */
export const dynamic = 'force-dynamic';

export default async function ReadingHistoryPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const locale = await requireLocale(params);
  const path = localizedPath(locale, '/my/history/reading');
  const session = await requireActiveSession(locale, path);
  const t = await getTranslations({ locale, namespace: 'personal' });
  const my = await getTranslations({ locale, namespace: 'my' });
  const related = { label: t('nav.label'), links: historyLinks(locale, t) };
  const spec: MyListSpec<ReadableTargetKind> = {
    path,
    param: 'kind',
    filters: READABLE_TARGET_KINDS,
  };
  const asked = readMyList(spec, await searchParams);
  if (asked.outcome === 'redirect') redirect(asked.to);

  const frame = {
    related,
    title: t('history.readingTitle'),
    description: <p>{t('history.readingDescription')}</p>,
    tabs: {
      label: my('tabs.label.history'),
      items: myTabs(locale, 'history', 'reading', (key) => my(`tabs.${key}`)),
    },
    trail: {
      label: my('trail.label'),
      crumbs: myTrail(locale, my('trail.home'), [{ text: t('history.readingTitle') }]),
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
  const read = await personalRead('personal-reading-history', () =>
    Promise.all([
      settings.settings(actor),
      history.reading(actor, myListOffset(view.page), view.filter),
      history.readingKinds(actor),
    ]),
  );

  if (!read.ok)
    return (
      <MyPage {...frame}>
        <Alert tone="error">{t('failure.load')}</Alert>
      </MyPage>
    );

  const [current, page, kinds] = read.value;
  const everything = READABLE_TARGET_KINDS.reduce((sum, kind) => sum + kinds[kind], 0);
  const titles = await resolvePersonalTargets(
    page.items.map((entry) => entry.target),
    locale,
  );
  const timeZone = session.account.timezone;
  const number = new Intl.NumberFormat(locale);
  const range = myListRange(view.page, page.items.length);

  return (
    <MyPage
      {...frame}
      announce={{
        value: `${view.filter ?? 'all'}:${String(page.total)}`,
        message: my('live.list', { count: page.total }),
      }}
    >
      {current.historyEnabled ? null : <HistoryOffNotice locale={locale} t={t} />}

      {everything === 0 ? null : (
        <div className="flex flex-col gap-3">
          <MyListFilters
            label={my('list.kinds')}
            spec={spec}
            current={view.filter}
            format={(count) => number.format(count)}
            items={[
              { value: null, text: my('list.allKinds'), count: everything },
              ...READABLE_TARGET_KINDS.map((kind) => ({
                value: kind,
                text: my(`kinds.${kind}`),
                count: kinds[kind],
              })),
            ]}
          />
          {range === null ? null : (
            <MyListStatus>
              {my('count.reading', { ...range, total: page.total })}
            </MyListStatus>
          )}
        </div>
      )}

      {page.items.length === 0 ? (
        everything === 0 ? (
          <EmptyState
            icon="book"
            title={my('history.emptyTitle')}
            action={{
              href: localizedPath(locale, '/library'),
              text: my('saved.explore'),
            }}
          >
            {t('history.readingEmpty')}
          </EmptyState>
        ) : page.total === 0 ? (
          <EmptyState
            icon="book"
            title={my('list.noneOfKind')}
            action={{ href: path, text: my('list.all') }}
          >
            {my('history.noneOfKind', {
              kind: view.filter === null ? '' : my(`kinds.${view.filter}`),
            })}
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
          aria-label={t('history.readingList')}
          className="flex flex-col border-t border-border"
        >
          {page.items.map((entry) => (
            <TargetItem
              key={targetKey(entry.target)}
              kind={entry.target.kind}
              resolved={titles.get(targetKey(entry.target))}
              words={{
                kind: (kind) => t(`kinds.${kind}`),
                unavailable: t('target.unavailable'),
                unknown: t('target.unknown'),
              }}
              meta={[
                my('history.read', {
                  date: shortDate(new Date(entry.lastReadAt), locale, timeZone),
                }),
              ]}
              actions={
                <ActionForm
                  action={removeReadAction}
                  submitLabel={t('history.remove')}
                  pendingLabel={t('common.working')}
                  tone="secondary"
                  messages={refusalMessages(t)}
                >
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="target" value={encodeTarget(entry.target)} />
                </ActionForm>
              }
            />
          ))}
        </ol>
      )}

      <MyListPager
        label={t('history.readingList')}
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

      {everything === 0 ? null : <ClearHistory locale={locale} t={t} />}
    </MyPage>
  );
}
