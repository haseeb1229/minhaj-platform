import type { Locale } from '@minhaj/contracts';
import { NextIntlClientProvider } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import {
  LocaleSwitcherFallbackLinks,
  LocaleSwitcherLinks,
} from './locale-switcher-links';

/**
 * Route-preserving locale switching (ROUTE_MAP.md §1.3).
 *
 * A Server Component wrapping the smallest possible client boundary, so a
 * caller renders `<LocaleSwitcher locale={locale} />` and inherits the whole
 * arrangement. Phase 4 places this in the shared header; nothing about it
 * assumes the foundation page it currently sits on.
 *
 * THE CLIENT PAYLOAD IS DELIBERATELY LOCALE-ONLY.
 *
 * `NextIntlClientProvider` is required because next-intl's `Link` reads the
 * active locale from context. Left to itself it would also resolve the whole
 * message catalogue and serialise it into the browser payload, which is a lot
 * of bytes for a component that needs one string. `messages={null}` suppresses
 * that, and the one string it does need — the control's accessible name — is
 * translated here, on the server, and handed over as a prop.
 *
 * THE SUSPENSE BOUNDARY IS NOT DECORATION. A statically rendered route is
 * served as a prerendered file, so the query string cannot be known while it is
 * generated. The boundary lets the prerender emit complete, working,
 * no-JavaScript links, which the browser then replaces with query-preserving
 * ones. Without it, `useSearchParams` would either fail the build or take the
 * locale roots out of static rendering entirely (ARCHITECTURE.md §8).
 */
export async function LocaleSwitcher({ locale }: { readonly locale: Locale }) {
  const t = await getTranslations({ locale, namespace: 'localeSwitcher' });
  const label = t('label');

  return (
    <NextIntlClientProvider locale={locale} messages={null}>
      <Suspense fallback={<LocaleSwitcherFallbackLinks locale={locale} label={label} />}>
        <LocaleSwitcherLinks locale={locale} label={label} />
      </Suspense>
    </NextIntlClientProvider>
  );
}
