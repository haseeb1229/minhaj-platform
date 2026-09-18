import { notFound } from 'next/navigation';

/**
 * Every public URL that matches nothing.
 *
 * WHY THIS ROUTE EXISTS AT ALL, and why it is not dead code: a Next.js
 * `not-found` boundary only renders inside a segment that MATCHED, and the
 * locale is a route parameter. Without a catch-all beneath `[locale]`, a URL
 * like `/ur/does-not-exist` matches nothing at all, so the localised 404 of
 * `not-found.tsx` never runs and the framework's own untranslated default
 * answers instead — in English, with no navigation, on a platform whose
 * visitors may read neither.
 *
 * Matching here means `[locale]/layout.tsx` runs first, the locale is validated
 * and established, and `notFound()` then renders THIS locale's 404 inside the
 * public shell.
 *
 * IT RENDERS NOTHING ITSELF. The one statement in the component is the point:
 * the response is a 404 with the not-found boundary's body, never a page.
 *
 * IT NEVER SHADOWS A REAL ROUTE. A catch-all is the lowest-priority match in
 * the App Router, so every concrete and dynamic route above it answers first —
 * including `/{locale}/my` and `/{locale}/admin`, which live outside this route
 * group entirely and keep their own private shells.
 */
export default function UnmatchedPublicRoute(): never {
  notFound();
}
