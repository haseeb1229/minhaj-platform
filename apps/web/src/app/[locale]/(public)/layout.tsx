import { NextIntlClientProvider } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { ReactNode } from 'react';

import { SiteFooter } from '@/components/shell/site-footer';
import { SiteHeader } from '@/components/shell/site-header';
import { requireLocale } from '@/config/route-locale';

/**
 * THE PUBLIC SHELL.
 *
 * A ROUTE GROUP, so the chrome is scoped without changing a single URL:
 * `(public)` contributes no path segment, and `/en`, `/en/explore` and
 * `/en/legal/privacy` address exactly what they addressed before
 * (ROUTE_MAP.md §1.1 is untouched).
 *
 * WHY THE SPLIT EXISTS AT ALL. `/my`, `/admin` and the authentication surfaces
 * are not public pages with a header on them: they are private, `no-store`,
 * `noindex` surfaces with their own security shell (ARCHITECTURE.md §8.3), and
 * wrapping them in public marketing chrome would put a public navigation around
 * a private page and — far worse — invite the session-reading header this
 * architecture forbids. They sit OUTSIDE this group and are unaffected by it.
 *
 * NOTHING HERE READS A SESSION. No cookie, no header, no user, no permission.
 * That is what lets the whole public tree render statically and be served from
 * one cache entry to every visitor, signed in or not (ARCHITECTURE.md §8.1).
 * A signed-in visitor sees the same public page; personalisation, when a phase
 * that owns some arrives, is composed in explicitly uncached islands beside it
 * (§8.2) — not by making this layout ask who is looking.
 */
export default async function PublicLayout({
  children,
  params,
}: {
  readonly children: ReactNode;
  readonly params: Promise<{ readonly locale: string }>;
}) {
  const locale = await requireLocale(params);
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: 'shell' });

  return (
    <div className="flex min-h-screen flex-col">
      {/*
       * THE SKIP LINK, and it is first in the document for the reason it
       * exists: a keyboard visitor must be able to pass the navigation on
       * every page without tabbing through it (SECURITY_BASELINE.md §16.1).
       * It is off-screen rather than hidden, so it stays in the tab order.
       */}
      <a href="#main-content" className="shell-skip-link">
        {t('nav.skipToContent')}
      </a>

      <SiteHeader locale={locale} />

      {/*
       * ONE `main` LANDMARK PER PAGE, provided here rather than by each route.
       * Two `main` elements is an accessibility defect that appears the moment
       * a page forgets the layout already rendered one.
       */}
      <main id="main-content" className="flex-1">
        {/*
         * THREE STRINGS CROSS TO THE BROWSER, and only three.
         *
         * `error.tsx` is a React error boundary, so it MUST be a Client
         * Component, and a client component cannot translate on the server.
         * Handing `NextIntlClientProvider` the whole catalogue would serialise
         * four hundred messages into every public page to cover a surface most
         * visitors never see; handing it exactly the error strings costs a few
         * dozen bytes and keeps them in the catalogue where the parity test can
         * still see them (ARCHITECTURE.md §13.8).
         */}
        <NextIntlClientProvider
          locale={locale}
          messages={{
            shell: {
              error: {
                title: t('error.title'),
                body: t('error.body'),
                retry: t('error.retry'),
              },
            },
          }}
        >
          {children}
        </NextIntlClientProvider>
      </main>

      <SiteFooter locale={locale} />
    </div>
  );
}
