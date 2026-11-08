import type { Metadata } from 'next';
import { localizedPath } from '@minhaj/contracts';
import { getTranslations } from 'next-intl/server';

import { PERSONAL_LIMITS, targetKey } from '@minhaj/contracts/personalisation';

import { pageLinks } from '@/components/hadith/presentation';
import { MyPage } from '@/components/my/frame';
import { myPageMetadata } from '@/components/my/metadata';
import { myTabs } from '@/components/my/sections';
import { TargetItem } from '@/components/my/targets';
import { shortDate } from '@/components/my/time';
import { refusalMessages } from '@/components/personal/parts';
import {
  personalOffsetHref,
  readPersonalOffset,
} from '@/components/personal/presentation';
import { personalRead } from '@/components/personal/read';
import { Alert, EmptyState, Pager } from '@/components/ui';
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
  const related = { label: t('nav.label'), links: historyLinks(locale, t) };
  const my = await getTranslations({ locale, namespace: 'my' });
  const actor = { accountId: session.account.id };
  const offset = readPersonalOffset(await searchParams);
  const { history, settings } = personalisationRuntime();
  const read = await personalRead('personal-watch-history', () =>
    Promise.all([settings.settings(actor), history.watching(actor, offset)]),
  );
  const tabs = {
    label: my('tabs.label.history'),
    items: myTabs(locale, 'history', 'watch', (key) => my(`tabs.${key}`)),
  };

  if (!read.ok)
    return (
      <MyPage related={related} title={t('history.watchTitle')} tabs={tabs}>
        <Alert tone="error">{t('failure.load')}</Alert>
      </MyPage>
    );

  const [current, page] = read.value;
  const video = (id: string) => ({ kind: 'video' as const, id });
  const titles = await resolvePersonalTargets(
    page.items.map((entry) => video(entry.videoId)),
    locale,
  );
  const links = pageLinks(page.offset, PERSONAL_LIMITS.page, page.total);
  const timeZone = session.account.timezone;

  return (
    <MyPage
      related={related}
      title={t('history.watchTitle')}
      description={<p>{t('history.watchDescription')}</p>}
      tabs={tabs}
    >
      {current.historyEnabled ? null : <HistoryOffNotice locale={locale} t={t} />}

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
          <EmptyState>{t('list.beyond')}</EmptyState>
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

      <Pager
        label={t('history.watchList')}
        previous={
          links.previous === null ? null : personalOffsetHref(path, links.previous)
        }
        next={links.next === null ? null : personalOffsetHref(path, links.next)}
        previousLabel={t('list.previous')}
        nextLabel={t('list.next')}
      />

      {page.total === 0 ? null : <ClearHistory locale={locale} t={t} />}
    </MyPage>
  );
}
