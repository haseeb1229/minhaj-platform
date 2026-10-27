import 'server-only';

import { localeSchema, type Locale } from '@minhaj/contracts';
import {
  EDITORIAL_MIGRATION_LANGUAGES,
  MIGRATION_LIMITS,
  SURAH_AYAH_COUNTS,
  STAGED_PAYLOAD_SCHEMAS,
  canonicalSourceUrl,
  languageCodeSchema,
  type MigrationContentKind,
  type ParsedEditorial,
  type ParsedFatwa,
  type ParsedMagazine,
  type ParsedMagazineIssue,
  type ParsedQuranTranslation,
  type ParsedRecord,
  type ParsedWork,
  type StagedBlock,
  type StagedLabel,
  type ValidationIssue,
} from '@minhaj/contracts/migration';

import {
  anchorHrefs,
  detectPersonalData,
  foldTitle,
  normalizeText,
  normalizeTitle,
  plainText,
  sanitizeFragment,
  slugFor,
  type HrefRewrite,
} from './normalize.ts';
import { blocksFrom, blocksText } from './rich-text.ts';
import { clip, normalizeVideo, plausibleDate } from './video.ts';

/**
 * ONE NORMALISER PER CONTENT KIND (MIGRATION_STRATEGY.md §4.6–§4.7), behind
 * one dispatcher the pipeline calls.
 *
 * NEVER AUTO-CORRECTED. An invalid value becomes a validation issue and stays
 * what the source said (or absent): nothing is guessed, defaulted from
 * elsewhere or invented — except the source's DECLARED default language, the
 * source's own statement. Untrusted markup is sanitised here, before anything
 * is staged; incidental personal data is redacted AND flagged, so a flagged
 * revision can never be approved (a CHECK holds that too).
 *
 * The contract's strict schema for the kind is the last word: a payload no
 * issue named still cannot pass as valid.
 */

/** What every kind's normalisation produces. */
export interface Normalisation {
  readonly kind: MigrationContentKind;
  /** The candidate payload — every field, valid or not — serialised as staged. */
  readonly payload: { readonly kind: MigrationContentKind };
  readonly issues: readonly ValidationIssue[];
  /** The record's row title: never empty, at most 240 units. */
  readonly title: string;
  readonly titleKey: string;
  /**
   * A duplicate signal by identity. `hard` (a provider's own id) collapses the
   * record automatically; an `identifier` (an ISBN, a source reference number)
   * only ever asks a person (MIGRATION_STRATEGY.md §5.2).
   */
  readonly identity: {
    readonly key: string;
    readonly signal: 'provider-id' | 'identifier';
    readonly hard: boolean;
  } | null;
  readonly languageCode: string | null;
  readonly personalData: boolean;
}

export interface NormaliseInput {
  readonly parsed: ParsedRecord;
  readonly defaultLanguageCode: string | null;
  readonly legacyIdentifier: string | null;
  readonly externalKey: string;
  readonly rewrite: HrefRewrite;
  readonly now: Date;
}

/** Every markup string of a record, for link extraction (§4.5). */
export function recordMarkup(record: ParsedRecord): string[] {
  switch (record.kind) {
    case 'media.video':
      return [
        record.descriptionHtml,
        ...record.labels.map((label) => label.descriptionHtml),
      ];
    case 'library.work':
    case 'library.magazine':
      return [record.descriptionHtml];
    case 'library.magazine-issue':
      return record.bodyHtml === null ? [] : [record.bodyHtml];
    case 'editorial.news':
    case 'editorial.article':
      return [
        record.bodyHtml,
        ...(record.excerptHtml === null ? [] : [record.excerptHtml]),
      ];
    case 'fatwa.ruling':
      return [record.questionHtml, record.answerHtml];
    case 'quran.translation':
      return [];
  }
}

/** Every href of a record — outside and inside its markup — in document order. */
export function recordHrefs(record: ParsedRecord): string[] {
  return [...record.links, ...recordMarkup(record).flatMap(anchorHrefs)];
}

/* ===========================================================================
 * Shared word handling
 * ========================================================================= */

class Words {
  readonly issues = new Set<ValidationIssue>();
  personalData = false;

  private readonly rewrite: HrefRewrite;

  /** A declared field, not a parameter property: the CLIs run this under plain Node. */
  constructor(rewrite: HrefRewrite) {
    this.rewrite = rewrite;
  }

  redact(text: string): string {
    const found = detectPersonalData(text);
    if (found.flagged) this.personalData = true;
    return found.redacted;
  }

  title(raw: string, max: number = MIGRATION_LIMITS.title): string {
    const title = this.redact(normalizeTitle(raw));
    if (title.length === 0) this.issues.add('title-missing');
    else if (title.length > max) this.issues.add('title-too-long');
    return title;
  }

  /** Plain description words from markup, links rewritten, personal data redacted. */
  description(html: string): string {
    const rewritten = sanitizeFragment(html, { rewrite: this.rewrite });
    const redacted = sanitizeFragment(html, { rewrite: this.rewrite, redact: true });
    if (redacted !== rewritten) this.personalData = true;
    const text = this.redact(plainText(redacted));
    if (text.length > MIGRATION_LIMITS.description)
      this.issues.add('description-too-long');
    return text;
  }

  /** Rich blocks from markup, links rewritten, personal data redacted. */
  blocks(html: string): StagedBlock[] {
    const plain = blocksFrom(html, { rewrite: this.rewrite });
    if (detectPersonalData(blocksText(plain)).flagged) this.personalData = true;
    return blocksFrom(html, { rewrite: this.rewrite, redact: true });
  }

  /** A short optional field (a publisher, a volume): normalised, bounded, else null. */
  field(raw: string | null, max: number): string | null {
    if (raw === null) return null;
    const value = this.redact(normalizeTitle(raw));
    return value.length === 0 || value.length > max ? null : value;
  }
}

function locale(value: string): Locale | null {
  const parsed = localeSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** The record's language, or the source's declared default; never another guess. */
function language(
  words: Words,
  declared: string | null,
  fallback: string | null,
): { readonly text: string | null; readonly code: string | null } {
  const raw = declared ?? fallback;
  const text = raw === null ? null : normalizeText(raw).trim();
  if (text === null || text.length === 0) {
    words.issues.add('language-missing');
    return { text: null, code: null };
  }
  if (!languageCodeSchema.safeParse(text).success) {
    words.issues.add('language-invalid');
    return { text, code: null };
  }
  return { text, code: text };
}

function date(words: Words, raw: string | null, now: Date): string | null {
  if (raw === null) return null;
  const value = normalizeText(raw).trim();
  if (!plausibleDate(value, now)) words.issues.add('date-implausible');
  return value;
}

function identifier(input: NormaliseInput, parsed: string | null): string | null {
  if (input.legacyIdentifier !== null) return input.legacyIdentifier;
  if (parsed === null) return null;
  const value = normalizeText(parsed).trim();
  return value.length > 0 && value.length <= 200 ? value : null;
}

/** An https URL in its canonical form, or null when it is not one. */
function httpsUrl(raw: string | null): string | null {
  if (raw === null) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username !== '' || url.password !== '')
      return null;
    const canonical = canonicalSourceUrl(url);
    return canonical.length <= MIGRATION_LIMITS.url ? canonical : null;
  } catch {
    return null;
  }
}

function finish(
  kind: MigrationContentKind,
  payload: { readonly kind: MigrationContentKind },
  words: Words,
  rest: {
    readonly title: string;
    readonly fallbackTitle: string;
    readonly identity: Normalisation['identity'];
    readonly languageCode: string | null;
  },
): Normalisation {
  if (words.issues.size === 0 && !STAGED_PAYLOAD_SCHEMAS[kind].safeParse(payload).success)
    words.issues.add('payload-invalid');
  const rowTitle = clip(
    rest.title.length > 0 ? rest.title : rest.fallbackTitle,
    MIGRATION_LIMITS.title,
  );
  return {
    kind,
    payload,
    issues: [...words.issues],
    title: rowTitle.length > 0 ? rowTitle : '-',
    titleKey: foldTitle(rest.title),
    identity: rest.identity,
    languageCode: rest.languageCode,
    personalData: words.personalData,
  };
}

/** The record's primary label, and one more per other locale the source gave. */
function primaryLabel(
  words: Words,
  record: { readonly primaryLocale: string; readonly title: string },
  descriptionHtml: string,
): {
  readonly labels: StagedLabel[];
  readonly locale: Locale | null;
  readonly title: string;
} {
  const title = words.title(record.title);
  const primary = locale(record.primaryLocale);
  if (primary === null) words.issues.add('primary-label-missing');
  const description = words.description(descriptionHtml);
  return {
    labels: primary === null ? [] : [{ locale: primary, title, description }],
    locale: primary,
    title,
  };
}

/* ===========================================================================
 * library.work
 * ========================================================================= */

/** An ISBN-10 or ISBN-13 with a correct check digit, separators removed; else null. */
export function normalIsbn(raw: string): string | null {
  const isbn = raw.replace(/[\s-]/g, '').toUpperCase();
  if (/^[0-9]{9}[0-9X]$/.test(isbn)) {
    let sum = 0;
    for (let index = 0; index < 10; index += 1) {
      const char = isbn[index] ?? '0';
      sum += (char === 'X' ? 10 : Number(char)) * (10 - index);
    }
    return sum % 11 === 0 ? isbn : null;
  }
  if (/^97[89][0-9]{10}$/.test(isbn)) {
    let sum = 0;
    for (let index = 0; index < 13; index += 1)
      sum += Number(isbn[index] ?? '0') * (index % 2 === 0 ? 1 : 3);
    return sum % 10 === 0 ? isbn : null;
  }
  return null;
}

function work(input: NormaliseInput, record: ParsedWork): Normalisation {
  const words = new Words(input.rewrite);
  const {
    labels,
    locale: primaryLocale,
    title,
  } = primaryLabel(words, record, record.descriptionHtml);
  const lang = language(words, record.languageCode, input.defaultLanguageCode);
  const legacyIdentifier = identifier(input, record.legacyIdentifier);
  const edition = record.edition;

  const label = words.field(edition.label, 160);
  if (label === null) words.issues.add('edition-label-missing');
  let publicationYear: number | null = null;
  if (edition.publicationYear !== null) {
    const text = normalizeText(edition.publicationYear).trim();
    const year = /^[0-9]{4}$/.test(text) ? Number(text) : Number.NaN;
    if (Number.isInteger(year) && year >= 1000 && year <= input.now.getUTCFullYear())
      publicationYear = year;
    else words.issues.add('year-invalid');
  }
  let isbn: string | null = null;
  if (edition.isbn !== null) {
    isbn = normalIsbn(edition.isbn);
    if (isbn === null) words.issues.add('isbn-invalid');
  }
  let pageCount: number | null = null;
  if (edition.pageCount !== null) {
    const text = normalizeText(edition.pageCount).trim();
    const pages = /^[0-9]{1,6}$/.test(text) ? Number(text) : Number.NaN;
    if (Number.isInteger(pages) && pages >= 1 && pages <= 100_000) pageCount = pages;
    else words.issues.add('page-count-invalid');
  }

  const payload = {
    kind: 'library.work' as const,
    slug: slugFor({
      legacyIdentifier,
      title,
      fallbackSeed: input.externalKey,
      prefix: 'book',
    }),
    primaryLocale,
    languageCode: lang.text,
    labels,
    legacyIdentifier,
    edition: {
      label: label ?? '',
      publisher: words.field(edition.publisher, 200),
      publicationYear,
      isbn,
      pageCount,
      readableAssetUrl: httpsUrl(edition.readableAssetUrl),
      downloadAssetUrl: httpsUrl(edition.downloadAssetUrl),
    },
  };
  return finish('library.work', payload, words, {
    title,
    fallbackTitle: legacyIdentifier ?? input.externalKey,
    identity:
      isbn === null ? null : { key: `isbn:${isbn}`, signal: 'identifier', hard: false },
    languageCode: lang.code,
  });
}

/* ===========================================================================
 * library.magazine and library.magazine-issue
 * ========================================================================= */

function magazine(input: NormaliseInput, record: ParsedMagazine): Normalisation {
  const words = new Words(input.rewrite);
  const {
    labels,
    locale: primaryLocale,
    title,
  } = primaryLabel(words, record, record.descriptionHtml);
  const lang = language(words, record.languageCode, input.defaultLanguageCode);
  const legacyIdentifier = identifier(input, record.legacyIdentifier);
  const payload = {
    kind: 'library.magazine' as const,
    slug: slugFor({
      legacyIdentifier,
      title,
      fallbackSeed: input.externalKey,
      prefix: 'magazine',
    }),
    primaryLocale,
    labels,
    legacyIdentifier,
  };
  return finish('library.magazine', payload, words, {
    title,
    fallbackTitle: legacyIdentifier ?? input.externalKey,
    identity: null,
    languageCode: lang.code,
  });
}

function magazineIssue(
  input: NormaliseInput,
  record: ParsedMagazineIssue,
): Normalisation {
  const words = new Words(input.rewrite);
  const { labels, locale: primaryLocale, title } = primaryLabel(words, record, '');
  const lang = language(words, record.languageCode, input.defaultLanguageCode);
  const legacyIdentifier = identifier(input, record.legacyIdentifier);
  const magazineUrl = httpsUrl(record.magazineUrl);
  if (magazineUrl === null) words.issues.add('reference-missing');
  const body = record.bodyHtml === null ? null : words.blocks(record.bodyHtml);
  const payload = {
    kind: 'library.magazine-issue' as const,
    slug: slugFor({
      legacyIdentifier,
      title,
      fallbackSeed: input.externalKey,
      prefix: 'issue',
    }),
    primaryLocale,
    languageCode: lang.text,
    labels,
    publishedOn: date(words, record.publishedOn, input.now),
    volume: words.field(record.volume, 40),
    issueNumber: words.field(record.issueNumber, 40),
    magazine: { role: 'magazine' as const, legacyUrl: magazineUrl ?? '' },
    body: body !== null && body.length > 0 ? body : null,
    legacyIdentifier,
  };
  return finish('library.magazine-issue', payload, words, {
    title,
    fallbackTitle: legacyIdentifier ?? input.externalKey,
    identity: null,
    languageCode: lang.code,
  });
}

/* ===========================================================================
 * editorial.news and editorial.article
 * ========================================================================= */

function editorial(input: NormaliseInput, record: ParsedEditorial): Normalisation {
  const words = new Words(input.rewrite);
  const title = words.title(record.title, 200);
  const lang = language(words, record.languageCode, input.defaultLanguageCode);
  if (
    lang.code !== null &&
    !(EDITORIAL_MIGRATION_LANGUAGES as readonly string[]).includes(lang.code)
  )
    words.issues.add('language-unsupported');
  const body = words.blocks(record.bodyHtml);
  if (body.length === 0) words.issues.add('body-missing');
  const excerpt =
    record.excerptHtml === null ? '' : words.description(record.excerptHtml);
  if (excerpt.length > 600) words.issues.add('excerpt-too-long');
  const legacyIdentifier = identifier(input, record.legacyIdentifier);
  const payload = {
    kind: record.kind,
    slug: slugFor({
      legacyIdentifier,
      title,
      fallbackSeed: input.externalKey,
      prefix: record.kind === 'editorial.news' ? 'news' : 'article',
    }),
    languageCode: lang.text,
    title,
    excerpt,
    body,
    publishedOn: date(words, record.publishedOn, input.now),
    legacyIdentifier,
  };
  return finish(record.kind, payload, words, {
    title,
    fallbackTitle: legacyIdentifier ?? input.externalKey,
    identity: null,
    languageCode: lang.code,
  });
}

/* ===========================================================================
 * REVIEW-ONLY: fatwa.ruling and quran.translation
 * ========================================================================= */

function fatwa(input: NormaliseInput, record: ParsedFatwa): Normalisation {
  const words = new Words(input.rewrite);
  const title = words.title(record.title);
  const lang = language(words, record.languageCode, input.defaultLanguageCode);
  const question = words.blocks(record.questionHtml);
  if (question.length === 0) words.issues.add('question-missing');
  const answer = words.blocks(record.answerHtml);
  if (answer.length === 0) words.issues.add('answer-missing');
  const legacyIdentifier = identifier(input, record.legacyIdentifier);
  const sourceReference = words.field(record.sourceReference, 80);
  const payload = {
    kind: 'fatwa.ruling' as const,
    slug: slugFor({
      legacyIdentifier,
      title,
      fallbackSeed: input.externalKey,
      prefix: 'fatwa',
    }),
    languageCode: lang.text,
    title,
    question,
    answer,
    sourceReference,
    attributedTo: words.field(record.attributedTo, 200),
    publishedOn: date(words, record.publishedOn, input.now),
    legacyIdentifier,
  };
  return finish('fatwa.ruling', payload, words, {
    title,
    fallbackTitle: legacyIdentifier ?? input.externalKey,
    identity:
      sourceReference === null
        ? null
        : {
            key: `fatwa:${foldTitle(sourceReference)}`,
            signal: 'identifier',
            hard: false,
          },
    languageCode: lang.code,
  });
}

function quranTranslation(
  input: NormaliseInput,
  record: ParsedQuranTranslation,
): Normalisation {
  const words = new Words(input.rewrite);
  const work = normalizeTitle(record.work);
  if (work.length === 0) words.issues.add('title-missing');
  else if (work.length > 200) words.issues.add('title-too-long');
  const lang = language(words, record.languageCode, input.defaultLanguageCode);
  const surah = record.surah;
  const count =
    surah !== null && Number.isInteger(surah) ? (SURAH_AYAH_COUNTS[surah - 1] ?? 0) : 0;
  if (count === 0) words.issues.add('surah-invalid');
  const seen = new Set<number>();
  const ayat: { ayah: number; text: string }[] = [];
  for (const entry of record.ayat) {
    // Exact words: control characters and line endings only, then the ends
    // of the run trimmed of ASCII whitespace — never a letter changed.
    const text = normalizeText(entry.text).replace(/^[\t\n ]+|[\t\n ]+$/g, '');
    const ayah = entry.ayah;
    if (
      ayah === null ||
      !Number.isInteger(ayah) ||
      ayah < 1 ||
      ayah > count ||
      seen.has(ayah)
    ) {
      words.issues.add('ayah-invalid');
      continue;
    }
    if (text.length === 0) {
      words.issues.add('body-missing');
      continue;
    }
    if (detectPersonalData(text).flagged) words.personalData = true;
    seen.add(ayah);
    ayat.push({ ayah, text });
  }
  if (ayat.length === 0) words.issues.add('body-missing');
  const title = clip(`${work} · ${surah ?? '?'}`, MIGRATION_LIMITS.title);
  const payload = {
    kind: 'quran.translation' as const,
    work,
    languageCode: lang.text,
    surah: surah ?? 0,
    ayat,
    legacyIdentifier: identifier(input, record.legacyIdentifier),
  };
  return finish('quran.translation', payload, words, {
    title,
    fallbackTitle: input.externalKey,
    identity:
      surah === null || lang.code === null
        ? null
        : {
            key: `quran:${foldTitle(work)}:${lang.code}:${surah}`,
            signal: 'identifier',
            hard: false,
          },
    languageCode: lang.code,
  });
}

/* ===========================================================================
 * The dispatcher
 * ========================================================================= */

export function normaliseRecord(input: NormaliseInput): Normalisation {
  const { parsed } = input;
  switch (parsed.kind) {
    case 'media.video': {
      const video = normalizeVideo({ ...input, parsed });
      return {
        kind: 'media.video',
        payload: video.payload,
        issues: video.issues,
        title: video.title,
        titleKey: video.titleKey,
        identity:
          video.dedupeKey === null
            ? null
            : { key: video.dedupeKey, signal: 'provider-id', hard: true },
        languageCode: video.languageCode,
        personalData: video.personalData,
      };
    }
    case 'library.work':
      return work(input, parsed);
    case 'library.magazine':
      return magazine(input, parsed);
    case 'library.magazine-issue':
      return magazineIssue(input, parsed);
    case 'editorial.news':
    case 'editorial.article':
      return editorial(input, parsed);
    case 'fatwa.ruling':
      return fatwa(input, parsed);
    case 'quran.translation':
      return quranTranslation(input, parsed);
  }
}
