import 'server-only';

import { localeSchema, type Locale } from '@minhaj/contracts';
import {
  MIGRATION_LIMITS,
  MIGRATION_VIDEO_PROVIDERS,
  languageCodeSchema,
  stagedVideoPayloadSchema,
  type MigrationVideoProvider,
  type ParsedVideo,
  type StagedLabel,
  type ValidationIssue,
} from '@minhaj/contracts/migration';

import {
  detectPersonalData,
  foldTitle,
  normalizeText,
  normalizeTitle,
  plainText,
  sanitizeFragment,
  slugFor,
  type HrefRewrite,
} from './normalize.ts';

/**
 * A parsed legacy video → Migration's staged payload, plus the validation
 * issues that block it (MIGRATION_STRATEGY.md §4.7).
 *
 * NEVER AUTO-CORRECTED. An invalid value becomes an issue and stays what the
 * source said (or absent); nothing is guessed, defaulted from elsewhere or
 * invented — except the source's DECLARED default language, which is the
 * source's own statement, not a guess.
 *
 * PROVIDER REFERENCES ARE PARSED HERE, not by Media: Migration depends on no
 * target context, and a target re-validates whatever it receives anyway.
 */

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const VIMEO_ID = /^[0-9]{1,12}$/;
const YOUTUBE_HOSTS: ReadonlySet<string> = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
]);
const VIMEO_HOSTS: ReadonlySet<string> = new Set([
  'vimeo.com',
  'www.vimeo.com',
  'player.vimeo.com',
]);

/** The provider named, case-insensitively, or `null` when it is not one Migration carries. */
export function videoProvider(value: string): MigrationVideoProvider | null {
  const name = value.trim().toLowerCase();
  return (MIGRATION_VIDEO_PROVIDERS as readonly string[]).includes(name)
    ? (name as MigrationVideoProvider)
    : null;
}

/**
 * The provider's own id from a bare id or one of the provider's URL forms:
 * YouTube `watch?v=`, `youtu.be/`, `embed/`; Vimeo `vimeo.com/<n>`,
 * `player.vimeo.com/video/<n>`. Anything else is `null` — never a guess.
 */
export function providerVideoId(
  provider: MigrationVideoProvider,
  reference: string,
): string | null {
  const text = reference.trim();
  if (text.length === 0 || text.length > MIGRATION_LIMITS.url) return null;
  if (provider === 'youtube' && YOUTUBE_ID.test(text)) return text;
  if (provider === 'vimeo' && VIMEO_ID.test(text)) return text;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username !== '' || url.password !== '' || url.port !== '') return null;
  const host = url.hostname.toLowerCase();
  const segments = url.pathname.split('/').filter((segment) => segment.length > 0);
  if (provider === 'youtube') {
    let id: string | null = null;
    if (host === 'youtu.be' && segments.length === 1) id = segments[0] ?? null;
    else if (YOUTUBE_HOSTS.has(host)) {
      if (segments.length === 1 && segments[0] === 'watch')
        id = url.searchParams.get('v');
      else if (segments.length === 2 && segments[0] === 'embed') id = segments[1] ?? null;
    }
    return id !== null && YOUTUBE_ID.test(id) ? id : null;
  }
  if (!VIMEO_HOSTS.has(host)) return null;
  const id =
    host === 'player.vimeo.com'
      ? segments.length === 2 && segments[0] === 'video'
        ? segments[1]
        : undefined
      : segments.length === 1
        ? segments[0]
        : undefined;
  return id !== undefined && VIMEO_ID.test(id) ? id : null;
}

/** The earliest plausible publication date of a migrated video. */
const EARLIEST_DATE = '1900-01-01';

/** A real calendar date `YYYY-MM-DD`, not after `now` and not before 1900. */
export function plausibleDate(value: string, now: Date): boolean {
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)) return false;
  const at = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(at.getTime()) || at.toISOString().slice(0, 10) !== value) return false;
  return value >= EARLIEST_DATE && at.getTime() <= now.getTime();
}

/** At most `max` UTF-16 units, never splitting a surrogate pair. */
export function clip(value: string, max: number): string {
  if (value.length <= max) return value;
  let out = '';
  for (const char of value) {
    if (out.length + char.length > max) break;
    out += char;
  }
  return out;
}

/** The staged payload as normalisation produced it — every field, valid or not. */
export interface StagedVideoCandidate {
  readonly kind: 'media.video';
  readonly slug: string;
  readonly primaryLocale: Locale | null;
  readonly languageCode: string | null;
  readonly provider: string | null;
  readonly providerVideoId: string | null;
  readonly labels: readonly StagedLabel[];
  readonly descriptionHtml: string;
  readonly publishedOn: string | null;
  readonly durationSeconds: number | null;
  readonly legacyIdentifier: string | null;
}

export interface VideoNormalisation {
  readonly payload: StagedVideoCandidate;
  readonly issues: readonly ValidationIssue[];
  /** The record's row title: never empty, at most 240 units. */
  readonly title: string;
  readonly titleKey: string;
  readonly dedupeKey: string | null;
  /** The language code when it is a valid one, else `null`. */
  readonly languageCode: string | null;
  readonly personalData: boolean;
}

export function normalizeVideo(input: {
  readonly parsed: ParsedVideo;
  /** The source's declared default language, used only when the record names none. */
  readonly defaultLanguageCode: string | null;
  /** The legacy identifier discovery recorded (already bounded by the record). */
  readonly legacyIdentifier: string | null;
  /** The record's external key: the last resort for a slug seed and a row title. */
  readonly externalKey: string;
  /** Decides each anchor's href (link rewriting). */
  readonly rewrite: HrefRewrite;
  readonly now: Date;
}): VideoNormalisation {
  const { parsed } = input;
  const issues = new Set<ValidationIssue>();
  let personalData = false;
  const redact = (text: string): string => {
    const found = detectPersonalData(text);
    if (found.flagged) personalData = true;
    return found.redacted;
  };

  // Words: sanitised before anything is stored; personal data redacted and flagged.
  const title = redact(normalizeTitle(parsed.title));
  if (title.length === 0) issues.add('title-missing');
  else if (title.length > MIGRATION_LIMITS.title) issues.add('title-too-long');

  const describe = (html: string) => {
    const descriptionHtml = sanitizeFragment(html, {
      rewrite: input.rewrite,
      redact: true,
    });
    const description = redact(plainText(descriptionHtml));
    if (descriptionHtml !== sanitizeFragment(html, { rewrite: input.rewrite }))
      personalData = true;
    if (description.length > MIGRATION_LIMITS.description)
      issues.add('description-too-long');
    return { descriptionHtml, description };
  };

  const locale = localeSchema.safeParse(parsed.primaryLocale);
  const primaryLocale: Locale | null = locale.success ? locale.data : null;
  if (primaryLocale === null) issues.add('primary-label-missing');

  const primary = describe(parsed.descriptionHtml);
  if (primary.descriptionHtml.length > MIGRATION_LIMITS.payload / 2)
    issues.add('description-too-long');

  const labels: StagedLabel[] = [];
  if (primaryLocale !== null)
    labels.push({ locale: primaryLocale, title, description: primary.description });
  for (const extra of parsed.labels) {
    const extraLocale = localeSchema.safeParse(extra.locale);
    if (!extraLocale.success) continue;
    // One label per locale: the record's primary words, then the first of each other locale.
    if (labels.some((label) => label.locale === extraLocale.data)) continue;
    const extraTitle = redact(normalizeTitle(extra.title));
    if (extraTitle.length === 0) continue;
    if (extraTitle.length > MIGRATION_LIMITS.title) issues.add('title-too-long');
    labels.push({
      locale: extraLocale.data,
      title: extraTitle,
      description: describe(extra.descriptionHtml).description,
    });
  }

  const declared = parsed.languageCode ?? input.defaultLanguageCode;
  const languageText = declared === null ? null : normalizeText(declared).trim();
  let languageCode: string | null = null;
  if (languageText === null || languageText.length === 0) issues.add('language-missing');
  else if (languageCodeSchema.safeParse(languageText).success)
    languageCode = languageText;
  else issues.add('language-invalid');

  const providerText =
    parsed.provider === null ? '' : normalizeText(parsed.provider).trim();
  const provider = providerText.length === 0 ? null : videoProvider(providerText);
  if (providerText.length === 0) issues.add('provider-missing');
  else if (provider === null) issues.add('provider-invalid');
  const videoId =
    provider === null || parsed.providerReference === null
      ? null
      : providerVideoId(provider, parsed.providerReference);
  if (provider !== null && videoId === null) issues.add('provider-id-invalid');

  const publishedOn =
    parsed.publishedOn === null ? null : normalizeText(parsed.publishedOn).trim();
  if (publishedOn !== null && !plausibleDate(publishedOn, input.now))
    issues.add('date-implausible');

  const duration = parsed.durationSeconds;
  if (
    duration !== null &&
    !(Number.isInteger(duration) && duration >= 1 && duration <= 360_000)
  )
    issues.add('duration-invalid');

  const parsedIdentifier =
    parsed.legacyIdentifier === null
      ? null
      : normalizeText(parsed.legacyIdentifier).trim();
  const legacyIdentifier =
    input.legacyIdentifier ??
    (parsedIdentifier !== null &&
    parsedIdentifier.length > 0 &&
    parsedIdentifier.length <= 200
      ? parsedIdentifier
      : null);

  const slug = slugFor({ legacyIdentifier, title, fallbackSeed: input.externalKey });

  const payload: StagedVideoCandidate = {
    kind: 'media.video',
    slug,
    primaryLocale,
    languageCode: languageText,
    provider: provider ?? (providerText.length === 0 ? null : providerText),
    providerVideoId: videoId,
    labels,
    descriptionHtml: primary.descriptionHtml,
    publishedOn,
    durationSeconds: duration,
    legacyIdentifier,
  };

  // The contract's own schema is the last word: a value no issue named above
  // still cannot pass as valid.
  if (issues.size === 0 && !stagedVideoPayloadSchema.safeParse(payload).success)
    issues.add('slug-invalid');

  const rowTitle = clip(
    title.length > 0 ? title : (legacyIdentifier ?? input.externalKey),
    MIGRATION_LIMITS.title,
  );

  return {
    payload,
    issues: [...issues],
    title: rowTitle.length > 0 ? rowTitle : '-',
    titleKey: foldTitle(title),
    dedupeKey: provider !== null && videoId !== null ? `${provider}:${videoId}` : null,
    languageCode,
    personalData,
  };
}

/** A pair is cross-language when both languages are known and their primary subtags differ. */
export function crossLanguage(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return false;
  const primary = (code: string) =>
    code.split('-')[0]?.toLowerCase() ?? code.toLowerCase();
  return primary(a) !== primary(b);
}
