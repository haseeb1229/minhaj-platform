'use client';

import { useTranslations } from 'next-intl';

/**
 * The localised unexpected-error surface (§25 of the phase contract).
 *
 * A CLIENT COMPONENT because React error boundaries are, and the only one this
 * phase adds besides the two navigation islands. Its three strings reach it
 * through the narrow `NextIntlClientProvider` the public layout installs — not
 * the whole catalogue.
 *
 * WHAT IT DELIBERATELY DOES NOT SHOW. No `error.message`, no stack, no digest,
 * no component name, no environment or provider detail. Next.js already
 * redacts a server error's message in production, but a surface that printed
 * whatever it was handed would disclose everything the day something threw on
 * the client instead — so it prints nothing it was handed at all. The operator
 * finds the cause in the logs, which is where the detail belongs
 * (ARCHITECTURE.md §8.5, SECURITY_BASELINE.md §19.2).
 *
 * IT OFFERS A WAY OUT. `reset()` re-renders the failed segment, which is the
 * right first move for a transient failure, and it is a real `<button>` so it
 * is reachable by keyboard like anything else.
 */
export default function PublicError({ reset }: { readonly reset: () => void }) {
  const t = useTranslations('shell.error');

  return (
    <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
      <div className="flex max-w-[var(--measure-prose)] flex-col gap-4 py-16">
        {/*
         * `role="alert"` so the failure is announced rather than silently
         * replacing the page for somebody who cannot see it change.
         */}
        <h1 role="alert" className="text-3xl font-semibold tracking-tight">
          {t('title')}
        </h1>

        <p className="text-[color:var(--color-foreground-muted)]">{t('body')}</p>

        <div>
          <button
            type="button"
            onClick={reset}
            className="inline-flex min-h-11 items-center rounded-[var(--radius-control)] border border-[color:var(--color-border-strong)] bg-[color:var(--color-surface-raised)] px-4 py-2 text-sm font-medium"
          >
            {t('retry')}
          </button>
        </div>
      </div>
    </div>
  );
}
