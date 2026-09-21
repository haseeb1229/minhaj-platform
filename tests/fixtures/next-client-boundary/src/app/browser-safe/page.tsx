'use client';

// FIXTURE CONTROL — MUST BUILD.
// A real Client Component using the BROWSER-SAFE root of `@minhaj/contracts`.
// Everything exported from it is inert schema and types, and may legitimately
// reach a browser bundle.
//
// This route lives permanently in `src/app`, so EVERY build in the suite —
// including each violating variant's — proves it still compiles.
import { editorialExtensions } from '@minhaj/contracts/editorial/editor';
import { localeSchema } from '@minhaj/contracts';

export default function BrowserSafePage() {
  const extensions = editorialExtensions();
  const locales = localeSchema.options.join(', ');

  return (
    <button onClick={() => locales.toUpperCase()}>
      {locales} {extensions.length}
    </button>
  );
}
