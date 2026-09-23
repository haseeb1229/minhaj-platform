import { getLocale, getTranslations } from 'next-intl/server';

import { Container } from '@/components/ui';

/**
 * The pending state while a results page renders on the server.
 *
 * A POLITE STATUS, NOT A SPINNER. It is announced once, it does not move — so it
 * needs no reduced-motion exception — and it keeps the page from looking
 * unresponsive on a slow connection (ARCHITECTURE.md §13.4, §13.6).
 */
export default async function SearchLoading() {
  const locale = await getLocale();
  const t = await getTranslations({ locale, namespace: 'search' });

  return (
    <Container>
      <p role="status" className="py-12 text-[color:var(--color-foreground-muted)]">
        {t('loading')}
      </p>
    </Container>
  );
}
