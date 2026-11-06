'use client';

import { localeSchema, localizedPath, type Locale } from '@minhaj/contracts';
import { useSearchParams } from 'next/navigation';

import { directionOf, endonymOf } from '@/config/locale';
import { usePathname } from '@/i18n/navigation';

/**
 * The language-choice control (ROUTE_MAP.md §1.3).
 *
 * WHY THIS IS A CLIENT COMPONENT. Switching must preserve the current resource
 * and its query, and both are request state. `usePathname` and
 * `useSearchParams` read them without making the enclosing page dynamic. The
 * page and the layout remain Server Components, no message catalogue crosses
 * to the browser, and the label arrives already translated as a prop.
 *
 * EACH LINK IS THE TARGET LOCALE'S CANONICAL ADDRESS, built by the one
 * locale-path contract (`localizedPath`): English is unprefixed, so switching to
 * English never passes through a `/en/…` redirect hop (Rebaseline R1). The
 * address is the whole decision — nothing is stored, because an unprefixed URL
 * is English deterministically and no cookie or `Accept-Language` header
 * chooses a language for it.
 */

interface LocaleSwitcherLinksProps {
  /** The locale currently being viewed. */
  readonly locale: Locale;
  /** Accessible name for the control, translated by the server. */
  readonly label: string;
}

function LanguageList({
  locale,
  label,
  query,
}: LocaleSwitcherLinksProps & { readonly query: string }) {
  // next-intl reports the locale-free pathname for every locale.
  const pathname = usePathname();
  const rest = pathname === '/' ? '' : pathname;

  return (
    <nav aria-label={label}>
      <ul className="flex list-none flex-wrap gap-x-4 gap-y-1 p-0">
        {localeSchema.options.map((option) => {
          const isCurrent = option === locale;
          return (
            <li key={option}>
              <a
                href={localizedPath(option, query === '' ? rest : `${rest}?${query}`)}
                lang={option}
                hrefLang={option}
                dir={directionOf(option)}
                aria-current={isCurrent ? 'page' : undefined}
                className={
                  isCurrent
                    ? 'font-semibold text-foreground underline decoration-accent decoration-2 underline-offset-[6px]'
                    : 'text-foreground-muted underline-offset-[6px] hover:text-foreground hover:underline'
                }
              >
                {endonymOf(option)}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * Rendered before the query is known (and without JavaScript): the same
 * resource in each locale, without its query string.
 */
export function LocaleSwitcherFallbackLinks(props: LocaleSwitcherLinksProps) {
  return <LanguageList {...props} query="" />;
}

export function LocaleSwitcherLinks(props: LocaleSwitcherLinksProps) {
  const searchParams = useSearchParams();
  return <LanguageList {...props} query={searchParams.toString()} />;
}
