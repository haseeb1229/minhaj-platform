import { getTranslations } from 'next-intl/server';

import { PERSONAL_LIMITS, targetKey } from '@minhaj/contracts/personalisation';

import { pageLinks } from '@/components/hadith/presentation';
import { Pagination } from '@/components/media/parts';
import { savedLinks } from '@/components/personal/nav';
import {
  KindBadge,
  PersonalFrame,
  PersonalLinks,
  PersonalTime,
  TargetTitle,
  refusalMessages,
} from '@/components/personal/parts';
import {
  encodeTarget,
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
import { unbookmarkAction } from '../actions';

/**
 * Bookmarks — the person's OWN saved pointers to Quran ayat, Hadith, articles,
 * videos and books (ROUTE_MAP.md §5.1; INFORMATION_ARCHITECTURE.md §5).
 *
 * Each row is a typed reference resolved by its owner now: a title linking to
 * the public page, or the honest "no longer available" when the owner no
 * longer shows it to anybody — and a removal that works either way.
 */
export const metadata = { robots: { index: false, follow: false } };

/** PER REQUEST, always: this surface reads a session. */
export const dynamic = 'force-dynamic';

export default async function BookmarksPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const locale = await requireLocale(params);
  const path = `/${locale}/my/saved/bookmarks`;
  const session = await requireActiveSession(locale, path);
  const t = await getTranslations({ locale, namespace: 'personal' });
  const offset = readPersonalOffset(await searchParams);
  const read = await personalRead('personal-bookmarks', () =>
    personalisationRuntime().saved.bookmarks({ accountId: session.account.id }, offset),
  );
  const back = <PersonalLinks label={t('nav.label')} links={savedLinks(locale, t)} />;

  if (!read.ok)
    return (
      <PersonalFrame title={t('bookmarks.title')} back={back}>
        <Alert tone="error">{t('failure.load')}</Alert>
      </PersonalFrame>
    );

  const page = read.value;
  const titles = await resolvePersonalTargets(
    page.items.map((entry) => entry.target),
    locale,
  );
  const links = pageLinks(page.offset, PERSONAL_LIMITS.page, page.total);

  return (
    <PersonalFrame
      title={t('bookmarks.title')}
      description={<p>{t('bookmarks.description')}</p>}
      back={back}
    >
      {page.items.length === 0 ? (
        <EmptyState>
          {page.total === 0 ? t('bookmarks.empty') : t('list.beyond')}
        </EmptyState>
      ) : (
        <ol aria-label={t('bookmarks.list')} className="flex flex-col gap-3">
          {page.items.map((entry) => (
            <Panel key={entry.savedItemId} as="li">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 flex-col gap-2">
                  <TargetTitle resolved={titles.get(targetKey(entry.target))} t={t} />
                  <div className="flex flex-wrap items-center gap-3 text-sm text-[color:var(--color-foreground-muted)]">
                    <KindBadge kind={entry.target.kind} t={t} />
                    <span>
                      {t('target.savedAt')}{' '}
                      <PersonalTime
                        value={entry.bookmarkedAt}
                        locale={locale}
                        timeZone={session.account.timezone}
                      />
                    </span>
                  </div>
                </div>
                <ActionForm
                  action={unbookmarkAction}
                  submitLabel={t('bookmarks.remove')}
                  pendingLabel={t('common.working')}
                  tone="secondary"
                  messages={refusalMessages(t)}
                >
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="target" value={encodeTarget(entry.target)} />
                </ActionForm>
              </div>
            </Panel>
          ))}
        </ol>
      )}

      <Pagination
        label={t('bookmarks.list')}
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
