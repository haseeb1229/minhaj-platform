import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import { EVENT_PAGE, NEWS_PAGE } from '@minhaj/contracts/editorial';
import { globalPaths, type PublicCentre } from '@minhaj/contracts/global';

import { EventGrid } from '@/components/editorial/events';
import { NewsGrid } from '@/components/editorial/news';
import { RangeSummary } from '@/components/library/browse-parts';
import { pageCount, pageRange } from '@/components/topic-hub/address';
import { Alert, EmptyState, LinkTabs, Pager } from '@/components/ui';
import { centreEvents, centreNews, centreTrail, CentreSubpageHero } from './centre';
import { DirectoryBody, DirectoryCrumbs, numberIn } from './frame';
import {
  centreEventsHref,
  placeHref,
  type CentreEventsView,
  type PlaceView,
} from './global-view';

/**
 * A Centre's own listings (ROUTE_MAP.md §3.9) — Phase 16 and Phase 14, rebuilt
 * in R2 to the listing standard:
 *
 *   `/global/centres/{slug}/news`     its News: "Showing n–m of N", numbered
 *   `/global/centres/{slug}/events`   its Events: upcoming and past as counted
 *                                     tabs, the range, numbered
 *
 * LAYER-4 COMPOSITION, NEVER A JOIN. Global resolved the Centre before either
 * page is rendered; Editorial lists the published News and Events naming its
 * identifier. A failure on Editorial's side is said in words, never a crash.
 */

/* ===========================================================================
 * /global/centres/{slug}/news
 * ========================================================================= */

/**
 * A Centre's News: "Showing n–m of N", the stories newest first, numbered
 * pages (`?page`), and honest empty and past-the-end states.
 */
export async function CentreNewsPage({
  locale,
  centre,
  view,
}: {
  readonly locale: Locale;
  readonly centre: PublicCentre;
  readonly view: PlaceView;
}) {
  const [t, news, hub] = await Promise.all([
    getTranslations({ locale, namespace: 'global' }),
    getTranslations({ locale, namespace: 'news' }),
    getTranslations({ locale, namespace: 'topicHub' }),
  ]);
  const trail = await centreTrail(locale, centre);
  const page = await centreNews(centre.id, (view.page - 1) * NEWS_PAGE, NEWS_PAGE);
  const base = globalPaths.centreNews(locale, centre.slug);
  const back = globalPaths.centre(locale, centre.slug);
  const title = t('centreNews.title', { centre: trail.name });
  const number = numberIn(locale);
  const href = (target: number) => placeHref(base, view, { page: target });
  const range = page === null ? null : pageRange(view.page, page.items.length, NEWS_PAGE);

  return (
    <>
      <DirectoryCrumbs
        label={trail.label}
        trail={[
          ...trail.base,
          { href: back, text: trail.name },
          { text: t('centre.news') },
        ]}
      />
      <CentreSubpageHero
        title={title}
        lede={t('centreNews.intro')}
        back={{ href: back, text: t('centreNews.back', { centre: trail.name }) }}
      />
      <DirectoryBody>
        <div className="flex min-w-0 flex-col gap-6">
          {page === null ? (
            <Alert tone="info">{t('centre.newsUnavailable')}</Alert>
          ) : page.items.length === 0 ? (
            view.page > 1 && page.total > 0 ? (
              <EmptyState
                title={hub('common.pastEndTitle')}
                action={{ href: href(1), text: hub('common.firstPage') }}
              >
                {t('pageEmpty')}
              </EmptyState>
            ) : (
              <EmptyState
                icon="news"
                action={{
                  href: back,
                  text: t('centreNews.back', { centre: trail.name }),
                }}
              >
                {t('centre.newsEmpty')}
              </EmptyState>
            )
          ) : (
            <>
              {range === null ? null : (
                <RangeSummary>
                  {t('results.news', {
                    from: number(range.from),
                    to: number(range.to),
                    total: page.total,
                  })}
                </RangeSummary>
              )}
              <NewsGrid
                locale={locale}
                items={page.items}
                label={title}
                showType={false}
              />
              <Pager
                label={t('results.pages', { list: title })}
                previous={view.page > 1 ? href(view.page - 1) : null}
                next={page.more ? href(view.page + 1) : null}
                previousLabel={news('previous')}
                nextLabel={news('next')}
                pages={{
                  current: view.page,
                  total: pageCount(page.total, NEWS_PAGE),
                  href,
                  label: (target) => hub('common.pageLabel', { page: target }),
                  format: number,
                }}
              />
            </>
          )}
        </div>
      </DirectoryBody>
    </>
  );
}

/* ===========================================================================
 * /global/centres/{slug}/events
 * ========================================================================= */

/**
 * A Centre's Events — Local Events (INFORMATION_ARCHITECTURE.md §3.9) —
 * upcoming by default and `?when=past` for those held, as counted tabs; the
 * range; numbered pages; and honest empty, refused and past-the-end states.
 * Global resolves the Centre; Editorial lists the published Events naming it.
 * Not public when the Centre is not, whatever its Events' own state.
 */
export async function CentreEventsPage({
  locale,
  centre,
  view,
}: {
  readonly locale: Locale;
  readonly centre: PublicCentre;
  readonly view: CentreEventsView;
}) {
  const [t, events, hub] = await Promise.all([
    getTranslations({ locale, namespace: 'global' }),
    getTranslations({ locale, namespace: 'events' }),
    getTranslations({ locale, namespace: 'topicHub' }),
  ]);
  const trail = await centreTrail(locale, centre);
  const result = view.invalid
    ? null
    : await centreEvents(centre.id, view.when, (view.page - 1) * EVENT_PAGE, EVENT_PAGE);
  const base = globalPaths.centreEvents(locale, centre.slug);
  const back = globalPaths.centre(locale, centre.slug);
  const title = t('centreEvents.title', { centre: trail.name });
  const number = numberIn(locale);
  const href = (change: Partial<Omit<CentreEventsView, 'invalid'>>) =>
    centreEventsHref(base, view, change);
  const total = result === null ? 0 : result.counts[view.when];
  const range =
    result === null ? null : pageRange(view.page, result.page.items.length, EVENT_PAGE);

  return (
    <>
      <DirectoryCrumbs
        label={trail.label}
        trail={[
          ...trail.base,
          { href: back, text: trail.name },
          { text: t('centre.events') },
        ]}
      />
      <CentreSubpageHero
        title={title}
        lede={t('centreEvents.intro')}
        back={{ href: back, text: t('centreNews.back', { centre: trail.name }) }}
      />
      <DirectoryBody>
        <div className="flex min-w-0 flex-col gap-6">
          <LinkTabs
            label={events('whenLabel')}
            tabs={(['upcoming', 'past'] as const).map((when) => ({
              href: href({ when, page: 1 }),
              text: events(`when.${when}`),
              current: !view.invalid && view.when === when,
              ...(result === null ? {} : { count: number(result.counts[when]) }),
            }))}
          />
          {view.invalid ? (
            <EmptyState
              title={t('centreEvents.invalidTitle')}
              action={{ href: base, text: events('when.upcoming') }}
            >
              {t('centreEvents.invalid')}
            </EmptyState>
          ) : result === null ? (
            <Alert tone="info">{t('centre.eventsUnavailable')}</Alert>
          ) : result.page.items.length === 0 ? (
            view.page > 1 && total > 0 ? (
              <EmptyState
                title={hub('common.pastEndTitle')}
                action={{ href: href({ page: 1 }), text: hub('common.firstPage') }}
              >
                {t('pageEmpty')}
              </EmptyState>
            ) : (
              <EmptyState
                icon="calendar"
                {...(view.when === 'upcoming' && result.counts.past > 0
                  ? {
                      action: {
                        href: href({ when: 'past', page: 1 }),
                        text: t('centreEvents.seePast', { count: result.counts.past }),
                      },
                    }
                  : {})}
              >
                {events(`centreNone.${view.when}`)}
              </EmptyState>
            )
          ) : (
            <>
              {range === null ? null : (
                <RangeSummary>
                  {t('results.events', {
                    from: number(range.from),
                    to: number(range.to),
                    total,
                  })}
                </RangeSummary>
              )}
              <EventGrid
                locale={locale}
                items={result.page.items}
                when={view.when}
                label={title}
              />
              <Pager
                label={t('results.pages', { list: title })}
                previous={view.page > 1 ? href({ page: view.page - 1 }) : null}
                next={result.page.more ? href({ page: view.page + 1 }) : null}
                previousLabel={events('previous')}
                nextLabel={events('next')}
                pages={{
                  current: view.page,
                  total: pageCount(total, EVENT_PAGE),
                  href: (target) => href({ page: target }),
                  label: (target) => hub('common.pageLabel', { page: target }),
                  format: number,
                }}
              />
            </>
          )}
        </div>
      </DirectoryBody>
    </>
  );
}
