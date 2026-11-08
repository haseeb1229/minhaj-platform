import { getLocale, getTranslations } from 'next-intl/server';

import { Container, Skeleton } from '@/components/ui';

/**
 * The pending state while a results page renders on the server.
 *
 * A POLITE STATUS, IN THE SHAPE OF WHAT IS COMING. The words are announced once;
 * the result-shaped placeholders under them are decorative (hidden from
 * assistive technology) and their pulse stops under reduced motion, so the
 * page reads as "results on their way" rather than blank (ARCHITECTURE.md
 * §13.4, §13.6; R2).
 */
export default async function SearchLoading() {
  const locale = await getLocale();
  const t = await getTranslations({ locale, namespace: 'search' });

  return (
    <Container>
      <div className="flex max-w-3xl flex-col gap-6 py-12">
        <p role="status" className="text-foreground-muted">
          {t('loading')}
        </p>
        {[0, 1, 2].map((row) => (
          <div key={row} className="flex flex-col gap-2 border-b border-border pb-5">
            <Skeleton shape="title" />
            <Skeleton />
            <Skeleton />
          </div>
        ))}
      </div>
    </Container>
  );
}
