'use client';

// FIXTURE CONTROL — MUST BUILD.
// A real Client Component using the BROWSER-SAFE root of `@minhaj/contracts`
// and its public client-environment subpath. Everything exported from these is
// inert schema and types, and may legitimately reach a browser bundle.
//
// This route lives permanently in `src/app`, so EVERY build in the suite —
// including each violating variant's — proves it still compiles.
import { localeSchema, parseClientEnv } from '@minhaj/contracts';

export default function BrowserSafePage() {
  const locales = localeSchema.options.join(', ');

  return (
    <button
      onClick={() =>
        parseClientEnv({
          NEXT_PUBLIC_SITE_URL: 'https://example.org',
          NEXT_PUBLIC_DEFAULT_LOCALE: 'en',
        })
      }
    >
      {locales}
    </button>
  );
}
