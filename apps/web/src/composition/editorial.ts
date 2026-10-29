import 'server-only';
import type { Locale } from '@minhaj/contracts';
import { peopleRuntime } from './people';
import {
  createEditorialPersistence,
  createCorrespondencePersistence,
  createRateLimiter,
  rateLimitKey,
} from '@minhaj/database';
import {
  createEditorialService,
  createCorrespondenceService,
  createLeadImagePolicy,
  type LeadImageRequest,
} from '@/contexts/editorial';
import type { AssetAuthorizationPort } from '@minhaj/contracts/platform';
import { memberToken } from '@minhaj/contracts/editorial';
import { centreReferences } from './global';
import { galleryReferences } from './media';
import { resolveCollectionMembers } from './collection-members';
import { identityRuntime } from './identity';
import { peopleReadRuntime } from './people-read';
import { taxonomyRuntime } from './taxonomy';
import { appLogger } from './logging';
import { serverEnv } from '@/config/server-env';
import { storageRuntime } from './storage';

function buildEditorialRuntime() {
  const environment = serverEnv();
  const authority = {
    permits: (id: string, permission: string) =>
      identityRuntime().authorization.hasPermission(id, permission),
  };
  const configuration = {
    digestKey: environment.RATE_LIMIT_DIGEST_KEY,
    digestKeyVersion: environment.RATE_LIMIT_DIGEST_KEY_VERSION,
  };
  return {
    editorial: createEditorialService({
      persistence: createEditorialPersistence(),
      authority,
      references: {
        async validContributors(ids) {
          const unique = [...new Set(ids)];
          return (
            (await peopleReadRuntime().people.contributorReferences(unique, 'en'))
              .length === unique.length
          );
        },
        async validTopics(ids) {
          return (
            (await taxonomyRuntime().taxonomy.topicReferences(ids, 'en')).length ===
            ids.length
          );
        },
        async validLanguages(codes) {
          const active = await taxonomyRuntime().taxonomy.listLanguages({
            includeRetired: false,
          });
          return codes.every((code) => active.some((entry) => entry.code === code));
        },
        // Phase 16: Global's reference interface answers; Editorial reads no
        // Global table (DOMAIN_MODEL.md §3.2, Editorial → Global Network).
        selectableCentre: (id) => centreReferences().centreSelectable(id),
        // Phase 14: Media's reference interface answers; Editorial reads no
        // Media table (DOMAIN_MODEL.md §3.2, Editorial → Media).
        selectableGallery: (id) => galleryReferences().gallerySelectable(id),
        // Phase 15: each member's OWNER answers whether it is public now —
        // Editorial's own published predicate, Library's (Editorial → Library)
        // and Media's (Editorial → Media) — one grouped read per owner, and an
        // owner that cannot be asked is an error, never a "no".
        async selectableMembers(members) {
          const { targets } = await resolveCollectionMembers(members, { strict: true });
          return members.every((member) => targets.has(memberToken(member)));
        },
        // Phase 30-R: a lead image is Storage's answer — a servable still
        // image. Editorial reads no Asset table (ARCHITECTURE.md §4.1).
        async usableImage(assetId) {
          return (await (await storageRuntime()).servableImages([assetId])).has(assetId);
        },
      },
      reportFailure: (operation) =>
        appLogger().error({ operation }, 'Editorial operation failed.'),
    }),
    correspondence: createCorrespondenceService({
      persistence: createCorrespondencePersistence(),
      authority,
      limiter: createRateLimiter(configuration),
      retentionDays: environment.CORRESPONDENCE_RETENTION_DAYS ?? null,
      key: (kind, subject) =>
        rateLimitKey({ purpose: `editorial-${kind}`, subject, configuration }),
    }),
  };
}
let runtime: ReturnType<typeof buildEditorialRuntime> | null = null;
export function editorialRuntime() {
  return (runtime ??= buildEditorialRuntime());
}

/** Bounded owner-provided choices; invoked only after the editor's permission check. */
export async function editorialReferenceChoices(locale: Locale, query: string) {
  const [people, topics, centres, galleries] = await Promise.all([
    peopleRuntime().people.listPeople({
      query: query || null,
      status: 'published',
      profileKind: null,
      locale,
      offset: 0,
    }),
    taxonomyRuntime().taxonomy.listTree({ locale, includeArchived: false }),
    centreReferences().centreChoices(query || null),
    galleryReferences().galleryChoices(query || null),
  ]);
  return {
    people: people.items.map(({ id, label }) => ({ id, name: label.name })),
    topics: topics.map(({ id, label }) => ({ id, name: label.name })),
    centres,
    galleries,
  };
}

/**
 * The Centre a NewsArticle revision already names, WHATEVER its state now — so
 * the editor shows an archived Centre truthfully instead of silently clearing
 * it. Invoked only after the editor's permission check.
 */
export function editorialCentreChoice(id: string) {
  return centreReferences()
    .centresByIds([id])
    .then((found) => found[0] ?? null);
}

/**
 * The Galleries an Event revision already associates, WHATEVER their state now
 * — so the editor shows an archived Gallery truthfully instead of silently
 * dropping it. Invoked only after the editor's permission check.
 */
export function editorialGalleryChoices(ids: readonly string[]) {
  return ids.length === 0 ? Promise.resolve([]) : galleryReferences().galleriesByIds(ids);
}

/**
 * PHASE 30-R — the ADMINISTRATIVE preview policy of a lead image: the record's
 * CURRENT revision names it, whatever its state, and the caller holds
 * `content.read` right now, read live. Lives here, beside Identity, so the
 * public byte route's graph never reaches it.
 */
let previewPersistence: ReturnType<typeof createEditorialPersistence> | null = null;
export function leadImagePreviewPolicy(
  request: LeadImageRequest,
  accountId: string,
): AssetAuthorizationPort {
  const persistence = (previewPersistence ??= createEditorialPersistence());
  return createLeadImagePolicy({
    request,
    relation: (family, recordId, assetId) =>
      persistence.currentLeadImage(family, recordId, assetId),
    preview: {
      accountId,
      authority: {
        permits: (id, permission) =>
          identityRuntime().authorization.hasPermission(id, permission),
      },
    },
  });
}
