import { getLocale, getTranslations } from 'next-intl/server';

import { Button, Container, Prose, TextInput } from '@/components/ui';
import { directionOf, isSupportedLocale } from '@/config/locale';

/**
 * The localised 404 (ROUTE_MAP.md §9.7, and §25 of the phase contract).
 *
 * IT DOES NOT REDIRECT. A missing page that silently bounced a visitor to the
 * home page would turn every broken citation into a mystery, and a citation
 * that survives for decades is a product requirement here (§10 rule 8). The
 * response is a 404, and it says so.
 *
 * IT DISCLOSES NOTHING. No stack, no internal path, no environment name, no
 * provider or database detail — a 404 is reached by definition by people
 * probing for things that are not there (SECURITY_BASELINE.md §1.1).
 *
 * IT NEEDS NO SESSION. It renders identically signed in and signed out, which
 * is what lets it appear inside the cached public tree at all.
 *
 * THE LOCALE SURVIVES. `[locale]` matched before this rendered, so the visitor
 * stays in the language they were reading, and the links below go to routes
 * that exist rather than to a hopeful guess at what they meant.
 *
 * WHY `lang` AND `dir` ARE ON THIS ELEMENT RATHER THAN ON `<html>`.
 *
 * Next.js owns the document element of a not-found response: it serves the
 * boundary inside its own `<html id="__next_error__">` shell rather than
 * re-rendering the root layout, so the `lang` and `dir` that
 * `app/[locale]/layout.tsx` sets for every other page are absent here. That is
 * framework behaviour, not something this route can opt out of.
 *
 * Leaving it would mean a 404 in Urdu or Arabic laid out left-to-right and
 * pronounced as English — on the one page a lost visitor is most likely to
 * reach. Declaring both on the outermost element this route DOES own restores
 * the direction and the pronunciation for everything inside it, which is the
 * whole of the page. The browser suite asserts it here for that reason.
 */
export default async function PublicNotFound() {
  const locale = await getLocale();
  const t = await getTranslations('shell');
  const direction = isSupportedLocale(locale) ? directionOf(locale) : 'ltr';

  return (
    <Container>
      <div lang={locale} dir={direction} className="flex flex-col gap-6 py-16">
        <Prose>
          <h1 className="text-3xl font-semibold tracking-tight">{t('notFound.title')}</h1>
          <p className="text-[color:var(--color-foreground-muted)]">
            {t('notFound.body')}
          </p>
        </Prose>

        {/*
         * "404 with search and nearest-section links" (ROUTE_MAP.md §9.3). A
         * plain GET to the public search page: it needs no JavaScript, and it
         * sends the visitor somewhere that works rather than guessing for them.
         */}
        <form
          method="get"
          action={`/${locale}/search`}
          role="search"
          className="flex max-w-md flex-wrap items-end gap-3"
        >
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <label htmlFor="not-found-search" className="text-sm font-medium">
              {t('notFound.searchLabel')}
            </label>
            <TextInput id="not-found-search" type="search" name="q" maxLength={200} />
          </div>
          <Button>{t('notFound.searchSubmit')}</Button>
        </form>

        <nav aria-label={t('notFound.title')}>
          <ul className="flex flex-col gap-2 text-sm">
            <li>
              <a href={`/${locale}`} className="underline underline-offset-2">
                {t('nav.home')}
              </a>
            </li>
            <li>
              <a href={`/${locale}/explore`} className="underline underline-offset-2">
                {t('nav.explore')}
              </a>
            </li>
            <li>
              <a href={`/${locale}/sitemap`} className="underline underline-offset-2">
                {t('nav.sitemap')}
              </a>
            </li>
          </ul>
        </nav>
      </div>
    </Container>
  );
}
