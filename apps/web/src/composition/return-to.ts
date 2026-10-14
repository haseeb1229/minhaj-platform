import { isSupportedLocale } from '@/config/locale';

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
];

/** Destinations that actually exist and a sign-in may return to. */
function isKnownDestination(pathname: string, locale: string): boolean {
  const path = pathname.replace(/\/$/, '');
  if (
    new Set([
      `/${locale}/account-setup`,
      `/${locale}/my`,
      `/${locale}/my/settings/profile`,
      `/${locale}/my/settings/security`,
      `/${locale}/my/settings/language`,
      // Phase 20 — Fatwa's `/my/questions`.
      `/${locale}/my/questions`,
      `/${locale}/my/questions/ask`,
      // Phase 21 — Personalisation & Notifications.
      `/${locale}/my/saved`,
      `/${locale}/my/saved/bookmarks`,
      `/${locale}/my/saved/notes`,
      `/${locale}/my/saved/collections`,
      `/${locale}/my/history/reading`,
      `/${locale}/my/history/watch`,
      `/${locale}/my/progress/quran`,
      `/${locale}/my/notifications`,
      `/${locale}/my/settings/interests`,
      `/${locale}/my/settings/notifications`,
      `/${locale}/my/settings/privacy`,
    ]).has(path)
  )
    return true;
  const question = `/${locale}/my/questions/`;
  if (path.startsWith(question)) return OWN_QUESTION.test(path.slice(question.length));
  // One of the person's own private collections, by its opaque id.
  const collection = `/${locale}/my/saved/collections/`;
  if (path.startsWith(collection))
    return OWN_QUESTION.test(path.slice(collection.length));
  const prefix = `/${locale}`;
  return (
    path.startsWith(`${prefix}/`) &&
    SAVEABLE_PAGES.some((pattern) => pattern.test(path.slice(prefix.length)))
  );
}

/**
 * Validates a `returnTo` destination.
 *
 * Open redirects enable phishing under a trusted domain — a particular
 * reputational risk for a religious organisation, whose visitors have every
 * reason to trust a link that appears to come from it
 * (SECURITY_BASELINE.md §9.3).
 *
 * ALLOWLIST, NOT DENYLIST. Only a same-origin absolute PATH is accepted, and it
 * must be under a known locale prefix. Everything else falls back:
 *
 *   - absolute URLs (`https://evil.example/x`)
 *   - protocol-relative URLs (`//evil.example`)
 *   - backslash variants (`/\evil.example`) that some parsers treat as `//`
 *   - scheme-bearing values (`javascript:…`, `data:…`)
 *   - encoded traversal (`/en/%2e%2e/…`, `/en/..%2f…`)
 *   - anything that does not parse as a path at all
 */
export function safeReturnTo(candidate: string | null, locale: string): string {
  const fallback = `/${locale}/my`;

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

  // It must be a route on this application, under a supported locale.
  const segments = decoded.split('/');
  const prefix = segments[1];
  if (prefix === undefined || !isSupportedLocale(prefix)) return fallback;

  const pathname = decoded.split(/[?#]/, 1)[0];
  if (pathname === undefined || !isKnownDestination(pathname, prefix)) return fallback;

  return decoded;
}
