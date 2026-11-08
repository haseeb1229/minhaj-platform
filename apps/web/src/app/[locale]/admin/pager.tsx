import { getLocale, getTranslations } from 'next-intl/server';

import { Pager } from '@/components/ui';

import { adminPagerState, type AdminPagerExtent } from './paging';

/**
 * THE ADMINISTRATIVE PAGER — the shared `Pager`, fed from an offset.
 *
 * Each listing keeps its own address scheme (`href`) and its own previous and
 * next wording; this only works out which pages exist. A listing that knows
 * its total gets the numbered window, one that only knows whether more rows
 * follow gets previous and next, and a single page renders nothing.
 */
export async function AdminPager({
  label,
  offset,
  pageSize,
  href,
  previousLabel,
  nextLabel,
  ...extent
}: {
  /** The navigation's accessible name. */
  readonly label: string;
  readonly offset: number;
  readonly pageSize: number;
  readonly href: (page: number) => string;
  readonly previousLabel: string;
  readonly nextLabel: string;
} & AdminPagerExtent) {
  const state = adminPagerState(
    offset,
    pageSize,
    'total' in extent ? { total: extent.total } : { more: extent.more },
  );
  const locale = await getLocale();
  const t = await getTranslations({ locale, namespace: 'admin.pager' });
  const number = new Intl.NumberFormat(locale);

  return (
    <Pager
      label={label}
      previous={state.previous === null ? null : href(state.previous)}
      next={state.next === null ? null : href(state.next)}
      previousLabel={previousLabel}
      nextLabel={nextLabel}
      {...(state.pages === null
        ? {}
        : {
            pages: {
              current: state.current,
              total: state.pages,
              href,
              label: (page: number) => t('page', { page: number.format(page) }),
              format: (page: number) => number.format(page),
            },
          })}
    />
  );
}
