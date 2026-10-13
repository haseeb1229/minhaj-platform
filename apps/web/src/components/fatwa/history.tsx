import 'server-only';

import type { Locale } from '@minhaj/contracts';
import type { PublicFatwaHistoryEntry } from '@minhaj/contracts/fatwa';

import { FatwaDate, type FatwaTranslator } from './parts';
import { fatwaTextDirection } from './presentation';

/**
 * The VISIBLE correction history of a published ruling (DOMAIN_MODEL.md §12).
 *
 * A CORRECTION IS NEVER SILENT. Every earlier published version stays readable
 * here exactly as it was published — its title, its anonymised public question
 * and its ruling — each beside the public reason given by the correction that
 * replaced it. Nothing is shown for a draft that was never published, and no
 * private review note ever appears.
 *
 * NATIVE DISCLOSURE. Each version is a `<details>` element, so it opens and
 * closes with the keyboard and a screen reader without any script, and nothing
 * animates.
 */
export function FatwaHistory({
  locale,
  current,
  previous,
  t,
}: {
  readonly locale: Locale;
  readonly current: PublicFatwaHistoryEntry;
  /** Older published versions, newest first. */
  readonly previous: readonly PublicFatwaHistoryEntry[];
  readonly t: FatwaTranslator;
}) {
  if (previous.length === 0) return null;
  return (
    <section className="flex flex-col gap-4" aria-labelledby="fatwa-history">
      <h2 id="fatwa-history" className="text-lg font-semibold">
        {t('ruling.history')}
      </h2>
      <p className="text-sm text-[color:var(--color-foreground-muted)]">
        {t('ruling.historyIntro')}
      </p>
      <ol className="flex flex-col gap-3">
        {previous.map((entry, index) => {
          // The version that REPLACED this one carries the public reason.
          const replacement = index === 0 ? current : previous[index - 1];
          const direction = fatwaTextDirection(entry.language);
          return (
            <li key={entry.revisionId}>
              <details className="rounded-[var(--radius-panel)] border border-[color:var(--color-border)] p-4">
                <summary className="cursor-pointer font-medium">
                  {t('ruling.version')}:{' '}
                  <FatwaDate value={entry.publishedAt} locale={locale} />
                </summary>
                <div className="mt-4 flex min-w-0 flex-col gap-4">
                  {replacement?.correctionReason ? (
                    <div className="flex flex-col gap-1">
                      <h3 className="text-sm font-semibold">
                        {t('ruling.correctionReason')}
                      </h3>
                      <p className="text-sm whitespace-pre-wrap wrap-anywhere" dir="auto">
                        {replacement.correctionReason}
                      </p>
                    </div>
                  ) : null}
                  <div className="flex flex-col gap-1">
                    <h3 className="text-sm font-semibold">{t('ruling.previousTitle')}</h3>
                    <p className="wrap-anywhere" lang={entry.language} dir={direction}>
                      {entry.title}
                    </p>
                  </div>
                  <div className="flex flex-col gap-1">
                    <h3 className="text-sm font-semibold">{t('ruling.question')}</h3>
                    <p
                      className="whitespace-pre-wrap wrap-anywhere"
                      lang={entry.language}
                      dir={direction}
                    >
                      {entry.publicQuestion}
                    </p>
                  </div>
                  <div className="flex flex-col gap-1">
                    <h3 className="text-sm font-semibold">{t('ruling.answer')}</h3>
                    <p
                      className="whitespace-pre-wrap wrap-anywhere"
                      lang={entry.language}
                      dir={direction}
                    >
                      {entry.ruling}
                    </p>
                  </div>
                </div>
              </details>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
