import { load } from 'cheerio';

import { localeSchema, type Locale } from '@minhaj/contracts';
import {
  MIGRATION_LIMITS,
  canonicalSourceUrl,
  type DiscoveredItem,
  type MigrationSourceAdapter,
  type ParseResult,
  type PendingItem,
  type RetrievedEvidence,
} from '@minhaj/contracts/migration';

import { canonicalJson } from '../canonical-json.ts';
import {
  legacyVideoRowFrom,
  type LegacyVideoRow,
  type SyntheticExportSource,
} from '../export/export-source.ts';

/**
 * THE FIXTURE EXPORT ADAPTER — the synthetic legacy export read as a source
 * (`accessMethod: 'export'`, MIGRATION_STRATEGY.md §1.3).
 *
 * It never uses the fetcher it is handed: there is no network in an export.
 * Discovery pages through the export by id; retrieval turns one row into
 * evidence whose bytes are the row's CANONICAL JSON, so the raw snapshot's
 * checksum is a statement about the row and an unchanged row is recognised
 * as unchanged; parsing maps that JSON to a `ParsedVideo`. The export's
 * markup is untrusted exactly as a page's is, and is passed on unsanitised.
 */

export const FIXTURE_EXPORT_ADAPTER_KEY = 'fixture-export';
export const EXPORT_ROW_CONTENT_TYPE = 'application/x-legacy-export-row+json';

const KEY_PREFIX = 'export://fixture/legacy_video/';
const KEY_PATTERN = /^export:\/\/fixture\/legacy_video\/([1-9][0-9]{0,9})$/;
const CURSOR_PATTERN = /^(0|[1-9][0-9]{0,9})$/;
const ROW_FIELDS = Object.freeze([
  'body_html',
  'cat_key',
  'cat_label',
  'duration_s',
  'id',
  'lang',
  'provider',
  'published',
  'ref',
  'title_en',
  'title_ur',
]);

/** The canonical external key of one export row. */
export function exportRowKey(id: number): string {
  return canonicalSourceUrl(new URL(`${KEY_PREFIX}${id}`));
}

function isLocale(value: string): value is Locale {
  return localeSchema.safeParse(value).success;
}

function hrefsOf(fragment: string): string[] {
  const $ = load(fragment, null, false);
  return $('a[href]')
    .toArray()
    .map((element) => $(element).attr('href') ?? '');
}

function rowFromBody(body: Uint8Array): LegacyVideoRow | null {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const keys = Object.keys(value).sort();
  if (
    keys.length !== ROW_FIELDS.length ||
    keys.some((key, index) => key !== ROW_FIELDS[index])
  )
    return null;
  try {
    const row = legacyVideoRowFrom(value as Record<string, unknown>);
    // Any field the reader had to coerce (a number where text belongs, say)
    // makes the row read back differently: such a row is malformed.
    return canonicalJson({ ...row }) === canonicalJson(value) ? row : null;
  } catch {
    return null;
  }
}

export function createFixtureExportAdapter(
  exportSource: SyntheticExportSource,
): MigrationSourceAdapter {
  return {
    adapterKey: FIXTURE_EXPORT_ADAPTER_KEY,
    adapterVersion: '1',
    parserKey: 'json-fixture-export',
    parserVersion: '1',
    contentKind: 'media.video',
    accessMethod: 'export',

    async discover(cursor: string | null) {
      if (cursor !== null && !CURSOR_PATTERN.test(cursor))
        throw new Error('invalid discovery cursor');
      const rows = exportSource.rows(
        cursor === null ? 0 : Number(cursor),
        MIGRATION_LIMITS.batch,
      );
      const items: DiscoveredItem[] = rows.map((row) => ({
        externalKey: exportRowKey(row.id),
        originalUrl: null,
        legacyIdentifier: String(row.id),
      }));
      const last = rows.at(-1);
      const next =
        rows.length === MIGRATION_LIMITS.batch && last !== undefined
          ? String(last.id)
          : null;
      return { kind: 'page', items, next } as const;
    },

    async retrieve(item: PendingItem): Promise<RetrievedEvidence> {
      const match = KEY_PATTERN.exec(item.externalKey);
      if (match === null)
        return {
          kind: 'outcome',
          outcome: {
            kind: 'refused',
            classification: 'scope-refused',
            requestedUrl: item.externalKey,
            detail: 'export-key-invalid',
          },
        };
      const row = exportSource.row(Number(match[1]));
      if (row === null)
        // The export no longer has the row: reported in the vocabulary the
        // pipeline already classifies (`not-found`, never retried).
        return {
          kind: 'outcome',
          outcome: {
            kind: 'response',
            status: 404,
            requestedUrl: item.externalKey,
            finalUrl: item.externalKey,
            contentType: null,
            headers: {},
            body: new Uint8Array(0),
            retryAfter: null,
          },
        };
      return {
        kind: 'evidence',
        requestedUrl: item.externalKey,
        finalUrl: exportRowKey(row.id),
        httpStatus: null,
        contentType: EXPORT_ROW_CONTENT_TYPE,
        headers: {},
        body: new TextEncoder().encode(canonicalJson({ ...row })),
      };
    },

    parse(evidence): ParseResult {
      if (evidence.contentType !== EXPORT_ROW_CONTENT_TYPE)
        return { kind: 'failed', detail: 'unsupported-content-type' };
      const row = rowFromBody(evidence.body);
      if (row === null) return { kind: 'failed', detail: 'export-row-malformed' };
      if (!isLocale(row.lang))
        return { kind: 'failed', detail: 'primary-locale-invalid' };
      const title = (row.lang === 'ur' ? row.title_ur : row.title_en)?.trim() ?? '';
      if (title.length === 0) return { kind: 'failed', detail: 'title-missing' };

      const labels: { locale: Locale; title: string; descriptionHtml: string }[] = [];
      if (row.lang !== 'en')
        labels.push({ locale: 'en', title: row.title_en, descriptionHtml: '' });
      if (row.lang !== 'ur' && row.title_ur !== null)
        labels.push({ locale: 'ur', title: row.title_ur, descriptionHtml: '' });

      const descriptionHtml = row.body_html ?? '';
      return {
        kind: 'parsed',
        record: {
          kind: 'media.video',
          title,
          primaryLocale: row.lang,
          languageCode: row.lang,
          provider: row.provider,
          providerReference: row.ref,
          labels,
          descriptionHtml,
          publishedOn: row.published,
          durationSeconds: row.duration_s,
          legacyIdentifier: String(row.id),
          categories:
            row.cat_key !== null && row.cat_label !== null
              ? [{ key: row.cat_key, label: row.cat_label }]
              : [],
          links: hrefsOf(descriptionHtml),
          assets: [],
        },
      };
    },
  };
}
