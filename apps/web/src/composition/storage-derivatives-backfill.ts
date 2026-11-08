import 'server-only';

import { EDITORIAL_LEAD_FAMILIES } from '@minhaj/contracts/editorial';
import type {
  AssetAuthorizationPort,
  PictureReference,
  StorageServicePort,
} from '@minhaj/contracts/platform';
import {
  createEditorialPublicReader,
  createLibraryPublicReader,
  createMediaAssetRelations,
  createPeopleReader,
  publishedCoverReferences,
  publishedLeadImageReferences,
  publishedMediaPictureReferences,
  publishedPortraitReferences,
} from '@minhaj/database';

import { createLeadImagePolicy } from '../contexts/editorial/index.ts';
import { createLibraryCoverPolicy } from '../contexts/library/index.ts';
import {
  createPhotoAssetPolicy,
  createVideoPosterPolicy,
} from '../contexts/media/index.ts';
import { createPortraitAssetPolicy } from '../contexts/people-contributors/index.ts';
import { storageRuntime } from './storage.ts';

/**
 * The operator's DERIVATIVE BACKFILL (Rebaseline R2) — a node-runnable Layer-4
 * root of its own, run by `scripts/storage/derivatives-backfill.ts`.
 *
 * WHAT IS DERIVED IS EXACTLY WHAT IS PUBLIC NOW. Each picture family is
 * enumerated by its OWNING context's adapter (published records that name a
 * picture), and every candidate is then put to the very policy its public byte
 * route builds — Editorial's lead image, Library's cover, Media's photo and
 * poster, People's portrait — which Storage asks again, about the source asset,
 * before a pixel is decoded. A restricted acquisition no record shows, a draft
 * and a withdrawn record are never enumerated and would be refused if they
 * were. Storage reads no consumer table; this root names both sides.
 *
 * IDEMPOTENT, BOUNDED, RESUMABLE. A width already derived is kept, so a second
 * run creates nothing; `limit` caps how many pictures one run examines; a run
 * cut short is resumed by running it again (what was done is skipped).
 */

/** One family of public pictures: how to page through it, and its public policy. */
interface PictureFamily {
  readonly name: string;
  page(after: string | null, limit: number): Promise<readonly PictureReference[]>;
  policy(reference: PictureReference): AssetAuthorizationPort;
}

function families(): readonly PictureFamily[] {
  const editorial = createEditorialPublicReader();
  const library = createLibraryPublicReader();
  const media = createMediaAssetRelations();
  const people = createPeopleReader();
  return [
    ...EDITORIAL_LEAD_FAMILIES.map((family): PictureFamily => ({
      name: `editorial:${family}`,
      page: (after, limit) => publishedLeadImageReferences(family, after, limit),
      policy: ({ recordId, assetId }) =>
        createLeadImagePolicy({
          request: { family, recordId, assetId },
          relation: (owner, record, asset) =>
            editorial.publishedLeadImage(owner, record, asset),
        }),
    })),
    ...(['edition', 'issue'] as const).map((owner): PictureFamily => ({
      name: `library:${owner}-cover`,
      page: (after, limit) => publishedCoverReferences(owner, after, limit),
      policy: ({ recordId, assetId }) =>
        createLibraryCoverPolicy({
          reader: library,
          request: { owner, ownerId: recordId, assetId },
        }),
    })),
    {
      name: 'media:photo',
      page: (after, limit) => publishedMediaPictureReferences('photo', after, limit),
      policy: ({ recordId, assetId }) =>
        createPhotoAssetPolicy({
          relations: media,
          request: { photoId: recordId, assetId },
        }),
    },
    {
      name: 'media:poster',
      page: (after, limit) => publishedMediaPictureReferences('poster', after, limit),
      policy: ({ recordId, assetId }) =>
        createVideoPosterPolicy({
          relations: media,
          request: { videoId: recordId, assetId },
        }),
    },
    {
      name: 'people:portrait',
      page: (after, limit) => publishedPortraitReferences(after, limit),
      policy: ({ recordId, assetId }) =>
        createPortraitAssetPolicy({
          relations: people,
          request: { personId: recordId, assetId },
        }),
    },
  ];
}

export interface BackfillCounts {
  /** Public pictures put to their policy. */
  examined: number;
  /** Refused by the policy or by Storage's custody: nothing was decoded. */
  refused: number;
  /** Pictures that could not be decoded within bounds, or whose derivative was refused. */
  failed: number;
  /** Derivatives written and cleared by this run. */
  created: number;
  /** Derivatives that already existed. */
  existing: number;
  /** Derivatives written but awaiting the scanner; served once reconciled. */
  withheld: number;
}

const PAGE = 100;

function noCounts(): BackfillCounts {
  return { examined: 0, refused: 0, failed: 0, created: 0, existing: 0, withheld: 0 };
}

/**
 * Derives every public picture's missing widths, examining at most `limit`
 * pictures. `complete` is false when the limit stopped the run: run it again.
 */
export async function backfillDerivatives(
  limit: number,
  /** The deployed Storage, unless a proof supplies one over its own root. */
  given?: StorageServicePort,
): Promise<{
  readonly totals: BackfillCounts;
  readonly families: Readonly<Record<string, BackfillCounts>>;
  readonly complete: boolean;
}> {
  const storage = given ?? (await storageRuntime());
  const totals = noCounts();
  const byFamily: Record<string, BackfillCounts> = {};
  // A picture two records share is derived once per run.
  const seen = new Set<string>();

  for (const family of families()) {
    const counts = noCounts();
    byFamily[family.name] = counts;
    let after: string | null = null;
    for (;;) {
      if (totals.examined >= limit)
        return { totals, families: byFamily, complete: false };
      const page = await family.page(after, Math.min(PAGE, limit - totals.examined));
      if (page.length === 0) break;
      for (const reference of page) {
        counts.examined += 1;
        totals.examined += 1;
        if (seen.has(reference.assetId)) continue;
        seen.add(reference.assetId);
        const outcome = await storage.derive(reference.assetId, family.policy(reference));
        if (outcome.status === 'derived') {
          for (const key of ['created', 'existing', 'withheld'] as const) {
            counts[key] += outcome[key];
            totals[key] += outcome[key];
          }
        } else {
          counts[outcome.status] += 1;
          totals[outcome.status] += 1;
        }
      }
      after = page.at(-1)?.recordId ?? null;
    }
  }
  return { totals, families: byFamily, complete: true };
}
