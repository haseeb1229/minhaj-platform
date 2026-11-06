import { localizedPath, type Locale } from '@minhaj/contracts';
import { getTranslations } from 'next-intl/server';

import { LocaleSwitcher } from '@/components/locale-switcher';
import { BrandWordmark } from '@/components/shell/brand-wordmark';

/**
 * THE PRODUCT BAR — one frame for every private surface (Rebaseline R1).
 *
 * My Minhaj, Teaching, Administration and the sign-in pages are their own
 * surfaces with their own navigation, but they are ONE product with the public
 * site: each carries the One Minhaj wordmark (home), the name of the area the
 * visitor is in, a plain way back to the public site, and the language switcher
 * (which keeps the exact page). It reads nothing about the visitor; the area's
 * own layout has already decided whether they may be here.
 */
export async function ProductBar({
  locale,
  area,
  columnClassName = 'mx-auto w-full max-w-6xl px-[var(--space-gutter)]',
}: {
  readonly locale: Locale;
  /** The private area's name, or nothing on the sign-in pages. */
  readonly area?: string;
  readonly columnClassName?: string;
}) {
  const t = await getTranslations({ locale, namespace: 'shell' });
  const home = localizedPath(locale, '');

  return (
    <header className="border-b border-border bg-surface-raised">
      <div
        className={`${columnClassName} flex min-h-16 flex-wrap items-center gap-x-4 gap-y-2 py-2`}
      >
        <a
          href={home}
          className="inline-flex min-h-11 items-center rounded-control no-underline"
        >
          <BrandWordmark />
          <span className="sr-only"> — {t('nav.home')}</span>
        </a>
        {area === undefined ? null : (
          <>
            <span aria-hidden="true" className="hidden h-6 w-px bg-border sm:block" />
            <span className="text-sm font-semibold text-foreground-muted">{area}</span>
          </>
        )}
        <div className="ms-auto flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
          <a
            href={home}
            className="inline-flex min-h-11 items-center gap-1.5 text-action no-underline hover:underline hover:underline-offset-4"
          >
            <span aria-hidden="true" className="rtl:-scale-x-100">
              ←
            </span>
            {t('private.backToSite')}
          </a>
          <LocaleSwitcher locale={locale} />
        </div>
      </div>
    </header>
  );
}
