import { localizedPath, splitLocalePath } from '@minhaj/contracts';

/**
 * Destination validation for post-authentication redirects.
 *
 * FRAMEWORK-FREE, deliberately. It lives beside `request.ts` rather than
 * inside it because that module imports `next/headers`, and dragging the
 * framework in behind an open-redirect check would make the check testable
 * only inside a request. This is the one rule on the platform whose failure
 * mode is somebody else's phishing page, so it is tested directly and
 * exhaustively.
 */

/**
 * Rejects control characters.
 *
 * A newline in a value that is ever echoed into a header would split it, and a
 * NUL truncates in several downstream parsers. Written as a code-point test
 * rather than a regular-expression character class: a class containing literal
 * control characters is unreadable in review, which is precisely what the
 * `no-control-regex` rule exists to prevent.
 */
function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/**
 * One of the asker's own questions: `/my/questions/` and a canonical lowercase
 * UUID, nothing else — the id is opaque, so no other shape can name one.
 */
const OWN_QUESTION =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** A public slug, as every owner's slug grammar admits one. */
const SLUG = '[a-z0-9]+(?:-[a-z0-9]+)*';

/**
 * Phase 21: the public pages whose private island offers "sign in to save" —
 * an Article, a book (Work), a Video, an Ayah and a Hadith citation. Exact
 * shapes, same origin, nothing a visitor can widen.
 */
const SAVEABLE_PAGES: readonly RegExp[] = [
  new RegExp(`^/library/articles/${SLUG}$`),
  new RegExp(`^/library/books/${SLUG}$`),
  new RegExp(`^/watch/videos/${SLUG}$`),
  /^\/quran\/surah\/[1-9][0-9]{0,2}\/[1-9][0-9]{0,2}$/,
  new RegExp(`^/hadith/${SLUG}/[1-9][0-9]{0,5}$`),
  // Phase 22: a public Course page, whose island offers "sign in to enrol".
  new RegExp(`^/learn/courses/${SLUG}$`),
];

/**
 * Phase 22: the person's own Learning pages that are addressed by a slug — a
 * Course they are enrolled on and a path they stand on.
 */
const OWN_LEARNING_PAGES: readonly RegExp[] = [
  new RegExp(`^/my/learning/courses/${SLUG}$`),
  new RegExp(`^/my/learning/paths/${SLUG}$`),
];

/**
 * Destinations that actually exist and a sign-in may return to, matched on the
 * LOCALE-FREE pathname (`/my`, not `/ur/my`): the locale is split off once,
 * by the one locale-path contract, before any of this runs.
 */
const KNOWN_DESTINATIONS = new Set([
  '/account-setup',
  '/my',
  '/my/settings/profile',
  '/my/settings/security',
  '/my/settings/language',
  // Phase 20 — Fatwa's `/my/questions`.
  '/my/questions',
  '/my/questions/ask',
  // Phase 21 — Personalisation & Notifications.
  '/my/saved',
  '/my/saved/bookmarks',
  '/my/saved/notes',
  '/my/saved/collections',
  '/my/history/reading',
  '/my/history/watch',
  '/my/progress/quran',
  '/my/notifications',
  '/my/settings/interests',
  '/my/settings/notifications',
  '/my/settings/privacy',
  // Phase 22 — Learning's `/my/learning` and course progress.
  '/my/learning',
  '/my/progress/courses',
  // R1 — the teacher and administration entry points, which send their own
  // address as `returnTo` and were previously dropped to `/my`. Each page
  // still makes its own authorisation decision after sign-in.
  '/teacher',
  '/admin',
]);

function isKnownDestination(rest: string): boolean {
  const path = rest.replace(/\/$/, '');
  if (KNOWN_DESTINATIONS.has(path)) return true;
  const question = '/my/questions/';
  if (path.startsWith(question)) return OWN_QUESTION.test(path.slice(question.length));
  // One of the person's own private collections, by its opaque id.
  const collection = '/my/saved/collections/';
  if (path.startsWith(collection))
    return OWN_QUESTION.test(path.slice(collection.length));
  return [...SAVEABLE_PAGES, ...OWN_LEARNING_PAGES].some((pattern) => pattern.test(path));
}

/**
 * Validates a `returnTo` destination.
 *
 * Open redirects enable phishing under a trusted domain — a particular
 * reputational risk for a religious organisation, whose visitors have every
 * reason to trust a link that appears to come from it
 * (SECURITY_BASELINE.md §9.3).
 *
 * ALLOWLIST, NOT DENYLIST. Only a same-origin absolute PATH naming a known
 * destination is accepted — unprefixed (English) or under the `ur`/`ar`
 * prefix; a legacy `/en/…` value is returned in its canonical unprefixed form.
 * Everything else falls back:
 *
 *   - absolute URLs (`https://evil.example/x`)
 *   - protocol-relative URLs (`//evil.example`)
 *   - backslash variants (`/\evil.example`) that some parsers treat as `//`
 *   - scheme-bearing values (`javascript:…`, `data:…`)
 *   - encoded traversal (`/en/%2e%2e/…`, `/en/..%2f…`)
 *   - anything that does not parse as a path at all
 */
export function safeReturnTo(candidate: string | null, locale: string): string {
  const fallback = localizedPath(locale, '/my');

  if (candidate === null || candidate === '') return fallback;

  // Must be an absolute path, and must not begin a network-path reference.
  if (!candidate.startsWith('/')) return fallback;
  if (candidate.startsWith('//') || candidate.startsWith('/\\')) return fallback;

  // A scheme anywhere before the first slash is not a path.
  if (/^[a-z][a-z0-9+.-]*:/i.test(candidate)) return fallback;

  let decoded: string;
  try {
    decoded = decodeURIComponent(candidate);
  } catch {
    // Malformed percent-encoding. A value that cannot be decoded cannot be
    // reasoned about, so it is not trusted.
    return fallback;
  }

  // Traversal, in either the raw or the decoded form. Checking only one leaves
  // the other as a bypass.
  if (candidate.includes('..') || decoded.includes('..')) return fallback;
  if (decoded.includes('\\') || decoded.includes('//')) return fallback;

  // Control characters, including the newline that would let a value split a
  // header if it were ever echoed into one.
  if (hasControlCharacters(decoded)) return fallback;

  // It must be a known route on this application. An unprefixed path is
  // English; `/ur/…` and `/ar/…` keep their locale (ROUTE_MAP.md §1.1).
  const pathname = decoded.split(/[?#]/, 1)[0];
  if (pathname === undefined) return fallback;
  const parts = splitLocalePath(pathname);
  if (!isKnownDestination(parts.rest)) return fallback;

  return localizedPath(parts.locale, parts.rest + decoded.slice(pathname.length));
}
