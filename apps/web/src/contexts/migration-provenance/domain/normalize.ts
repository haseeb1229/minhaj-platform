import 'server-only';

import { createHash } from 'node:crypto';

import sanitizeHtml from 'sanitize-html';

/**
 * NORMALISATION (MIGRATION_STRATEGY.md §4.6) — sanitisation, conservative text
 * handling, comparison keys, slugs and incidental personal data.
 *
 * ARABIC AND URDU BYTES ARE NEVER RE-COMPOSED. Stored text receives no NFC or
 * NFKC: a normalisation form can silently alter religious text. What changes
 * is only what is never content — C0 control characters (tab and newline
 * kept), CRLF line endings, and leading/trailing whitespace of a title. The
 * folded `titleKey` alone uses NFKC, because it is a duplicate-candidate
 * signal for a person and never shown or published.
 */

/** Recorded on every run and staged revision; bump when any output below changes. */
export const NORMALIZER_VERSION = '30.2';

const sha256Hex = (value: string): string =>
  createHash('sha256').update(value, 'utf8').digest('hex');

/* ===========================================================================
 * Text
 * ========================================================================= */

/**
 * CRLF and lone CR become LF; every other C0 control except tab and newline is
 * removed. Nothing else changes.
 */
export function normalizeText(value: string): string {
  let out = '';
  for (const char of value.replace(/\r\n?/g, '\n')) {
    const code = char.charCodeAt(0);
    if (code < 0x20 && code !== 0x09 && code !== 0x0a) continue;
    out += char;
  }
  return out;
}

/**
 * A title: normalised text on one line. A run of ASCII whitespace collapses to
 * one space — the same text a browser renders from the legacy markup — and the
 * ends are trimmed. Non-ASCII spacing and every letter are left exactly.
 */
export function normalizeTitle(value: string): string {
  return normalizeText(value)
    .replace(/[\t\n\f ]+/g, ' ')
    .trim();
}

/**
 * The duplicate-candidate comparison key: NFKC, lower-cased, punctuation and
 * symbols removed, whitespace collapsed. A signal for a person, never content.
 */
export function foldTitle(title: string): string {
  return normalizeText(title)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 240);
}

/* ===========================================================================
 * Sanitisation — before staging, never at render time (SECURITY_BASELINE §10.2)
 * ========================================================================= */

/** Elements discarded WITH everything inside them. */
const DISCARDED_REGIONS = Object.freeze([
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'form',
  'svg',
  'math',
  'noscript',
  'template',
  'meta',
  'link',
  'textarea',
  'select',
  'option',
  'title',
  'head',
] as const);

/** An href the stored HTML may carry: absolute http(s), or a site-relative path. */
export function isSafeStoredHref(href: string): boolean {
  if (href.length === 0 || href.length > 2000) return false;
  // No space, control character or backslash: a stored href is already exact.
  for (const char of href) if (char.charCodeAt(0) <= 0x20 || char === '\\') return false;
  if (href.startsWith('/')) return !href.startsWith('//');
  try {
    const url = new URL(href);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.username === '' &&
      url.password === ''
    );
  } catch {
    return false;
  }
}

/** Decides an anchor's final href, or `null` to keep its text without a link. */
export type HrefRewrite = (href: string) => string | null;

function anchorTransform(rewrite: HrefRewrite): sanitizeHtml.Transformer {
  return (_tag, attribs) => {
    const raw = attribs['href'];
    const decided = raw === undefined ? null : rewrite(raw);
    // An anchor whose href is refused keeps its words and loses its link; it
    // stays an `a` (rather than being renamed away) so the output is balanced.
    return {
      tagName: 'a',
      attribs:
        decided !== null && isSafeStoredHref(decided)
          ? { href: decided, rel: 'noopener noreferrer' }
          : { rel: 'noopener noreferrer' },
    };
  };
}

/** Headings outside the h2–h4 range are re-levelled, never dropped with their words. */
const HEADING_TRANSFORMS = Object.freeze({ h1: 'h2', h5: 'h4', h6: 'h4' });

/** Without a link scope, an href survives only if it is already safe to store. */
const keepSafeHref: HrefRewrite = (href) =>
  isSafeStoredHref(href.trim()) ? href.trim() : null;

/**
 * THE ALLOWLIST, exactly. Paragraph, heading and list structure, quotation,
 * emphasis and links — nothing that executes, embeds, styles or submits.
 * Phase 30 admits section headings, because long-form legacy articles carry
 * them: `h1` becomes `h2` (a record's own title is its only `h1`), and
 * `h5`/`h6` become `h4`. The
 * scheme allowlist and `allowProtocolRelative: false` re-check every href the
 * transform lets through, so a mistake in one layer is caught by the other.
 */
export const MIGRATION_SANITIZE_OPTIONS: sanitizeHtml.IOptions = Object.freeze({
  allowedTags: [
    'p',
    'br',
    'strong',
    'em',
    'ul',
    'ol',
    'li',
    'blockquote',
    'a',
    'h2',
    'h3',
    'h4',
  ],
  allowedAttributes: { a: ['href', 'rel'] },
  allowedSchemes: ['http', 'https'],
  allowedSchemesByTag: {},
  allowedSchemesAppliedToAttributes: ['href'],
  allowProtocolRelative: false,
  allowVulnerableTags: false,
  disallowedTagsMode: 'discard',
  nonTextTags: [...DISCARDED_REGIONS],
  enforceHtmlBoundary: false,
  parseStyleAttributes: false,
  transformTags: {
    ...HEADING_TRANSFORMS,
    b: 'strong',
    i: 'em',
    a: anchorTransform(keepSafeHref),
  },
});

/**
 * Sanitises untrusted legacy markup. `rewrite` decides each anchor's href
 * (link rewriting, §4.5); `redact` replaces incidental personal data in every
 * text node. The input is first normalised as text (control characters).
 */
export function sanitizeFragment(
  html: string,
  options: { readonly rewrite?: HrefRewrite; readonly redact?: boolean } = {},
): string {
  const rewrite = options.rewrite ?? keepSafeHref;
  return sanitizeHtml(normalizeText(html), {
    ...MIGRATION_SANITIZE_OPTIONS,
    transformTags: {
      ...HEADING_TRANSFORMS,
      b: 'strong',
      i: 'em',
      a: anchorTransform(rewrite),
    },
    ...(options.redact === true
      ? { textFilter: (text: string) => detectPersonalData(text).redacted }
      : {}),
  });
}

/** Every anchor href in the markup, in document order, as the source wrote it. */
export function anchorHrefs(html: string): string[] {
  const hrefs: string[] = [];
  sanitizeFragment(html, {
    rewrite: (href) => {
      hrefs.push(href);
      return null;
    },
  });
  return hrefs;
}

const ENTITIES: Readonly<Record<string, string>> = Object.freeze({
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
});

export function decodeEntities(text: string): string {
  return text.replace(
    /&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|[a-z]+);/g,
    (match, body: string) => {
      if (body.startsWith('#x') || body.startsWith('#')) {
        const code = body.startsWith('#x')
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
        return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
          ? String.fromCodePoint(code)
          : match;
      }
      if (body === 'amp') return '&';
      return Object.hasOwn(ENTITIES, body) ? (ENTITIES[body] ?? match) : match;
    },
  );
}

/**
 * Plain text from markup, as a reader would see it: the markup is sanitised
 * first (so only allowlisted tags remain and every `<` in text is escaped),
 * block boundaries become blank lines, `<br>` a newline, and runs of ASCII
 * whitespace a single space — HTML's own rendering rule, never a change to
 * the letters themselves.
 */
export function plainText(html: string): string {
  // Sanitised output: every `<` left is an allowlisted tag (text `<` is
  // escaped), so splitting on tags is exact.
  let text = '';
  for (const part of sanitizeFragment(html).split(/(<[^>]*>)/)) {
    if (part.startsWith('<')) {
      if (/^<br\b/.test(part)) text += '\n';
      else if (/^<\/?(?:p|li|ul|ol|blockquote|h2|h3|h4)\b/.test(part)) text += '\n\n';
      continue;
    }
    text += decodeEntities(part).replace(/[\t\n\f\r ]+/g, ' ');
  }
  return text
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/* ===========================================================================
 * Slugs
 * ========================================================================= */

const SLUG_MAX = 120;

function asciiSlug(value: string): string {
  const slug = value
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (slug.length <= SLUG_MAX) return slug;
  return slug.slice(0, SLUG_MAX).replace(/-+$/g, '');
}

/**
 * A deterministic slug: ASCII words of the legacy identifier, else of the
 * title, else `video-` and a short digest of what identified the record — so
 * a title in Urdu or Arabic still has a stable address. Never random.
 */
export function slugFor(input: {
  readonly legacyIdentifier: string | null;
  readonly title: string;
  readonly fallbackSeed: string;
  /** The kind's word for a digest slug (`video`, `book`, `news` …). */
  readonly prefix?: string;
}): string {
  for (const candidate of [input.legacyIdentifier, input.title]) {
    if (candidate === null) continue;
    const slug = asciiSlug(candidate);
    if (slug.length >= 2) return slug;
  }
  const seed =
    input.legacyIdentifier ?? (input.title.length > 0 ? input.title : input.fallbackSeed);
  return `${input.prefix ?? 'video'}-${sha256Hex(seed).slice(0, 12)}`;
}

/* ===========================================================================
 * Incidental personal data (MIGRATION_STRATEGY.md §8.3)
 * ========================================================================= */

const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.\p{L}{2,}/gu;

/** ASCII, Arabic-Indic and Extended Arabic-Indic (Urdu) digits. */
const DIGIT = '[0-9٠-٩۰-۹]';

/**
 * A phone-number-like run: an optional `+`, then at least nine digits with at
 * most a few separators (space, dot, hyphen, parentheses) between them, not
 * glued to a word or to URL punctuation on either side.
 */
const PHONE = new RegExp(
  `(?<![\\p{L}\\p{N}_/=#?&:%@.+-])\\+?\\(?${DIGIT}(?:[ ().-]{0,3}${DIGIT}){8,}\\)?(?![\\p{L}\\p{N}_/])`,
  'gu',
);

/** An ISO date (optionally with an hour) is a date, not a telephone. */
const ISO_DATE_LIKE = /^\d{4}-\d{2}-\d{2}(?:[ T]\d{2})?$/;

export const REDACTED = '[redacted]';

/**
 * Detects email addresses and phone-like digit runs, and returns the text
 * with each replaced by `[redacted]`. Conservative by design: a false positive
 * only holds a record for a person; a false negative would carry personal
 * data forward.
 */
export function detectPersonalData(text: string): {
  readonly flagged: boolean;
  readonly redacted: string;
} {
  let flagged = false;
  const redacted = text
    .replace(EMAIL, () => {
      flagged = true;
      return REDACTED;
    })
    .replace(PHONE, (match) => {
      if (ISO_DATE_LIKE.test(match.trim())) return match;
      flagged = true;
      return REDACTED;
    });
  return { flagged, redacted };
}
