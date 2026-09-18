'use client';

import { localeSchema, type Locale } from '@minhaj/contracts';
import type { QueryParams } from 'next-intl/navigation';
import { useSearchParams } from 'next/navigation';

import { directionOf, endonymOf } from '@/config/locale';
import { localeCookieValue } from '@/config/locale-cookie';
import { Link, usePathname } from '@/i18n/navigation';
import { toQueryParams } from '@/i18n/query';

/**
 * The language-choice control (ROUTE_MAP.md §1.3).
 *
 * WHY THIS IS A CLIENT COMPONENT — the only one in the application.
 *
 * Switching must preserve the current route and its parameters, and both are
 * request state. `usePathname` and `useSearchParams` are the supported way to
 * read them without making the enclosing page dynamic: a Server Component
 * reaching for `searchParams` or `headers()` would opt every locale root out of
 * static rendering, which ARCHITECTURE.md §8 exists to prevent.
 *
 * The boundary is kept to this file. The page and the layout remain Server
 * Components, no message catalogue crosses to the browser, and the label
 * arrives already translated as a prop.
 */

interface LocaleSwitcherLinksProps {
  /** The locale currently being viewed. */
  readonly locale: Locale;
  /** Accessible name for the control, translated by the server. */
  readonly label: string;
}

/**
 * Renders the list of languages.
 *
 * `query` is supplied by the caller rather than read here, because the two
 * callers below differ in exactly that: one has the current query and one
 * cannot yet have it. Everything else about the control is identical, and
 * duplicating it would be two things to keep in step.
 */
function LanguageList({
  locale,
  label,
  query,
}: LocaleSwitcherLinksProps & { readonly query: QueryParams }) {
  const pathname = usePathname();

  return (
    <nav aria-label={label}>
      <ul className="flex list-none flex-wrap gap-4 p-0">
        {localeSchema.options.map((option) => {
          const isCurrent = option === locale;

          return (
            <li key={option}>
              <Link
                /**
                 * A PATHNAME and a query, never a URL. The origin comes from
                 * the browser, so nothing in the current request — a query
                 * parameter, an `Accept-Language` header, a forwarded host —
                 * can move this link to another site. `href` is a route-
                 * relative object by construction, which is what makes an open
                 * redirect impossible here rather than merely unlikely.
                 */
                href={{ pathname, query }}
                locale={option}
                onClick={() => {
                  if (isCurrent) return;

                  // Store a preference only when the person uses the language
                  // control. Merely rendering or requesting a public page must
                  // not emit Set-Cookie and turn a shared response private.
                  document.cookie = localeCookieValue(
                    option,
                    process.env.NODE_ENV === 'production',
                  );
                }}
                /**
                 * The label is written in the language it names, so it carries
                 * that language's own `lang` and `dir` regardless of the
                 * document's. This is the mixed-direction case Phase 3A
                 * actually has: اردو inside an English page, and `English`
                 * inside an Arabic one (ARCHITECTURE.md §9).
                 */
                lang={option}
                dir={directionOf(option)}
                /**
                 * The current language is announced, not merely styled.
                 *
                 * `page` rather than `true`: these links all address the same
                 * content, and the active one IS the page being viewed, so
                 * assistive technology announces "current page" instead of the
                 * vaguer "current item".
                 *
                 * Weight and underline offset carry the same state visually.
                 * Neither is a colour, because colour alone is not a state
                 * indicator (WCAG 2.2).
                 */
                aria-current={isCurrent ? 'page' : undefined}
                className={
                  isCurrent ? 'font-semibold underline underline-offset-4' : 'underline'
                }
              >
                {endonymOf(option)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * The control as it appears BEFORE the browser takes over.
 *
 * A statically rendered route is served from a prerendered file, so the server
 * genuinely cannot know the query string a visitor arrived with — the same HTML
 * answers `/en` and `/en?page=2`. That is a property of static rendering, not a
 * shortcoming of this component, and the honest response is to render links
 * that are complete and correct without it.
 *
 * These links work with no JavaScript, are crawlable, and lose only the query
 * — which the hydrated version below then restores.
 */
export function LocaleSwitcherFallbackLinks(props: LocaleSwitcherLinksProps) {
  return <LanguageList {...props} query={{}} />;
}

/**
 * The control once the current query string is readable.
 *
 * `/en/foo?a=1` → `/ur/foo?a=1`, and `/ar/foo?x=1&x=2` → `/en/foo?x=1&x=2`:
 * repeated keys are preserved as arrays rather than collapsed to the last
 * value, and every value is re-encoded by the URL builder rather than
 * concatenated as text.
 */
export function LocaleSwitcherLinks(props: LocaleSwitcherLinksProps) {
  const searchParams = useSearchParams();

  return <LanguageList {...props} query={toQueryParams(searchParams)} />;
}
