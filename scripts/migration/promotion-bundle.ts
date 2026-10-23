import { randomBytes } from 'node:crypto';
import {
  link,
  mkdir,
  readdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';

import {
  MIGRATION_CONTENT_KINDS,
  migrationIdSchema,
  type MigrationPromotionDestinationPort,
  type PromotionItem,
} from '@minhaj/contracts/migration';

import { canonicalJson, sha256Hex } from './canonical-json.ts';

/**
 * THE PHASE-29 PROMOTION DESTINATION: a local, checksummed BUNDLE directory
 * (MIGRATION_STRATEGY.md §10.1.1; Phase-29 decision 13).
 *
 *   <directory>/entries/<promotionEntryId>.json — one file per promotion
 *       entry: exactly the `PromotionItem` fields plus `sha256`, the
 *       SHA-256 of those fields' canonical JSON;
 *   <directory>/manifest.json — every entry id with its checksum, written
 *       by `writeManifest` after re-verifying each entry file.
 *
 * IDEMPOTENT AND RESUMABLE. An entry file is published by hard-linking a
 * fully written temporary file into place, which — unlike a rename — can
 * never replace a file that is already there. A resumed promotion that finds
 * an identical file adopts it; a DIFFERENT file under the same entry id is a
 * conflict and throws, never an overwrite.
 *
 * NOTHING BUT CONTENT. The schema is closed: an item carrying any field
 * beyond the `PromotionItem` contract is refused rather than written, so no
 * account, session, credential or configuration can ride along.
 */

/** The item fields an entry carries — the whole schema, sorted. */
export const BUNDLE_ITEM_FIELDS = Object.freeze([
  'canonicalPath',
  'contentKind',
  'externalKey',
  'inputChecksum',
  'legacyUrls',
  'manifestEntryId',
  'payload',
  'payloadChecksum',
  'promotionEntryId',
  'provenance',
  'publishedAt',
  'reviewedAt',
  'sourceKey',
] as const);

export const BUNDLE_PROVENANCE_FIELDS = Object.freeze([
  'adapterKey',
  'adapterVersion',
  'codeRevision',
  'normalizerVersion',
  'parserKey',
  'parserVersion',
] as const);

/** Everything an entry file holds: the item fields and its checksum. */
export const BUNDLE_ENTRY_FIELDS = Object.freeze(
  [...BUNDLE_ITEM_FIELDS, 'sha256'].sort(),
);

const HEX64 = /^[0-9a-f]{64}$/;

function hasExactly(value: object, fields: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  const expected = [...fields].sort();
  return (
    keys.length === expected.length && keys.every((key, index) => key === expected[index])
  );
}

/** Copies exactly the contract's fields, refusing anything else or anything malformed. */
function closedItem(item: PromotionItem): Record<keyof PromotionItem, unknown> {
  if (typeof item !== 'object' || item === null || !hasExactly(item, BUNDLE_ITEM_FIELDS))
    throw new Error('promotion item does not match the bundle schema');
  const provenance = item.provenance as object | null;
  if (
    typeof provenance !== 'object' ||
    provenance === null ||
    !hasExactly(provenance, BUNDLE_PROVENANCE_FIELDS)
  )
    throw new Error('promotion provenance does not match the bundle schema');
  const strings = [
    item.canonicalPath,
    item.externalKey,
    item.payload,
    item.sourceKey,
    item.reviewedAt,
    item.publishedAt,
    ...BUNDLE_PROVENANCE_FIELDS.map((field) => item.provenance[field]),
  ];
  if (
    !migrationIdSchema.safeParse(item.promotionEntryId).success ||
    !migrationIdSchema.safeParse(item.manifestEntryId).success ||
    !(MIGRATION_CONTENT_KINDS as readonly string[]).includes(item.contentKind) ||
    !HEX64.test(item.payloadChecksum) ||
    !HEX64.test(item.inputChecksum) ||
    strings.some((value) => typeof value !== 'string') ||
    !Array.isArray(item.legacyUrls) ||
    item.legacyUrls.some((url) => typeof url !== 'string')
  )
    throw new Error('promotion item carries a malformed field');
  return {
    canonicalPath: item.canonicalPath,
    contentKind: item.contentKind,
    externalKey: item.externalKey,
    inputChecksum: item.inputChecksum,
    legacyUrls: [...item.legacyUrls],
    manifestEntryId: item.manifestEntryId,
    payload: item.payload,
    payloadChecksum: item.payloadChecksum,
    promotionEntryId: item.promotionEntryId,
    provenance: {
      adapterKey: item.provenance.adapterKey,
      adapterVersion: item.provenance.adapterVersion,
      codeRevision: item.provenance.codeRevision,
      normalizerVersion: item.provenance.normalizerVersion,
      parserKey: item.provenance.parserKey,
      parserVersion: item.provenance.parserVersion,
    },
    publishedAt: item.publishedAt,
    reviewedAt: item.reviewedAt,
    sourceKey: item.sourceKey,
  };
}

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : undefined;
}

async function readIfPresent(file: string): Promise<string | null> {
  try {
    return await readFile(file, 'utf8');
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return null;
    throw error;
  }
}

export interface BundleManifest {
  readonly promotionId: string;
  readonly entries: readonly {
    readonly promotionEntryId: string;
    readonly sha256: string;
  }[];
  readonly sha256: string;
}

export interface BundleDestination extends MigrationPromotionDestinationPort {
  /**
   * Re-verifies every entry file and writes `manifest.json` listing them.
   * Throws on any entry whose bytes no longer match its checksum or name.
   */
  writeManifest(input: { readonly promotionId: string }): Promise<BundleManifest>;
}

export function createBundleDestination(directory: string): BundleDestination {
  const root = path.resolve(directory);
  const entries = path.join(root, 'entries');

  return {
    destination: 'bundle',

    async put(item: PromotionItem): Promise<{ readonly destinationRef: string }> {
      const fields = closedItem(item);
      const sha256 = sha256Hex(canonicalJson(fields));
      const text = canonicalJson({ ...fields, sha256 });
      const destinationRef = `bundle:${item.promotionEntryId}:${sha256}`;
      const target = path.join(entries, `${item.promotionEntryId}.json`);

      await mkdir(entries, { recursive: true });
      const existing = await readIfPresent(target);
      if (existing !== null) {
        if (existing === text) return { destinationRef };
        throw new Error(
          'bundle conflict: a different entry already exists under this id',
        );
      }

      const temporary = path.join(
        entries,
        `.${item.promotionEntryId}.${randomBytes(8).toString('hex')}.tmp`,
      );
      await writeFile(temporary, text, { encoding: 'utf8', flag: 'wx' });
      try {
        await link(temporary, target);
      } catch (error) {
        if (errorCode(error) !== 'EEXIST') throw error;
        // A concurrent writer got there first: adopt it only if identical.
        if ((await readIfPresent(target)) !== text)
          throw new Error(
            'bundle conflict: a different entry already exists under this id',
            { cause: error },
          );
      } finally {
        await unlink(temporary);
      }
      return { destinationRef };
    },

    async writeManifest({ promotionId }) {
      if (!migrationIdSchema.safeParse(promotionId).success)
        throw new Error('invalid promotion id');
      const names = (await readdir(entries))
        .filter((name) => !name.startsWith('.') && name.endsWith('.json'))
        .sort();
      const listed: { promotionEntryId: string; sha256: string }[] = [];
      for (const name of names) {
        const parsed = JSON.parse(
          await readFile(path.join(entries, name), 'utf8'),
        ) as Record<string, unknown>;
        const { sha256, ...fields } = parsed;
        if (
          !hasExactly(parsed, BUNDLE_ENTRY_FIELDS) ||
          typeof sha256 !== 'string' ||
          sha256 !== sha256Hex(canonicalJson(fields)) ||
          `${String(fields['promotionEntryId'])}.json` !== name
        )
          throw new Error('bundle entry failed verification');
        listed.push({ promotionEntryId: String(fields['promotionEntryId']), sha256 });
      }
      const body = { promotionId, entries: listed };
      const manifest: BundleManifest = {
        ...body,
        sha256: sha256Hex(canonicalJson(body)),
      };
      const temporary = path.join(
        root,
        `.manifest.${randomBytes(8).toString('hex')}.tmp`,
      );
      await writeFile(
        temporary,
        canonicalJson({ ...manifest, entries: [...manifest.entries] }),
        {
          encoding: 'utf8',
          flag: 'wx',
        },
      );
      // The manifest is a derived index, so a later, fuller one may replace it.
      await rename(temporary, path.join(root, 'manifest.json'));
      return manifest;
    },
  };
}
