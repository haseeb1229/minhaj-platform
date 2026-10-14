import { getTranslations } from 'next-intl/server';

import { PERSONAL_LIMITS, targetKey } from '@minhaj/contracts/personalisation';

import { pageLinks } from '@/components/hadith/presentation';
import { Pagination } from '@/components/media/parts';
import { historyLinks } from '@/components/personal/nav';
import {
  KindBadge,
  PersonalFrame,
  PersonalLinks,
  PersonalTime,
  TargetTitle,
  refusalMessages,
} from '@/components/personal/parts';
import {
  personalOffsetHref,
  readPersonalOffset,
} from '@/components/personal/presentation';
import { personalRead } from '@/components/personal/read';
import { Alert, EmptyState, Panel } from '@/components/ui';
import { personalisationRuntime } from '@/composition/personalisation';
import { resolvePersonalTargets } from '@/composition/personal-targets';
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
export const metadata = { robots: { index: false, follow: false } };

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
  const path = `/${locale}/my/history/watch`;
  const session = await requireActiveSession(locale, path);
  const t = await getTranslations({ locale, namespace: 'personal' });
  const actor = { accountId: session.account.id };
  const offset = readPersonalOffset(await searchParams);
  const { history, settings } = personalisationRuntime();
  const read = await personalRead('personal-watch-history', () =>
    Promise.all([settings.settings(actor), history.watching(actor, offset)]),
  );
  const back = <PersonalLinks label={t('nav.label')} links={historyLinks(locale, t)} />;

  if (!read.ok)
    return (
      <PersonalFrame title={t('history.watchTitle')} back={back}>
        <Alert tone="error">{t('failure.load')}</Alert>
      </PersonalFrame>
    );

  const [current, page] = read.value;
  const videos = page.items.map((entry) => ({
    kind: 'video' as const,
    id: entry.videoId,
  }));
  const titles = await resolvePersonalTargets(videos, locale);
  const links = pageLinks(page.offset, PERSONAL_LIMITS.page, page.total);

  return (
    <PersonalFrame
      title={t('history.watchTitle')}
      description={<p>{t('history.watchDescription')}</p>}
      back={back}
    >
      {current.historyEnabled ? null : <HistoryOffNotice locale={locale} t={t} />}

      {page.items.length === 0 ? (
        <EmptyState>
          {page.total === 0 ? t('history.watchEmpty') : t('list.beyond')}
        </EmptyState>
      ) : (
        <ol aria-label={t('history.watchList')} className="flex flex-col gap-3">
          {page.items.map((entry) => (
            <Panel key={entry.videoId} as="li">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 flex-col gap-2">
                  <TargetTitle
                    resolved={titles.get(targetKey({ kind: 'video', id: entry.videoId }))}
                    t={t}
                  />
                  <div className="flex flex-wrap items-center gap-3 text-sm text-[color:var(--color-foreground-muted)]">
                    <KindBadge kind="video" t={t} />
                    <span>
                      {t('history.lastWatched')}{' '}
                      <PersonalTime
                        value={entry.lastWatchedAt}
                        locale={locale}
                        timeZone={session.account.timezone}
                      />
                    </span>
                  </div>
                </div>
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
              </div>
            </Panel>
          ))}
        </ol>
      )}

      <Pagination
        label={t('history.watchList')}
        previous={
          links.previous === null ? null : personalOffsetHref(path, links.previous)
        }
        next={links.next === null ? null : personalOffsetHref(path, links.next)}
        previousLabel={t('list.previous')}
        nextLabel={t('list.next')}
      />

      {page.total === 0 ? null : <ClearHistory locale={locale} t={t} />}
    </PersonalFrame>
  );
}
