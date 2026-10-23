import 'server-only';

import { createMediaPersistence, createPersonalHoldings } from '@minhaj/database';
import {
  MEDIA_PAGE,
  type MediaActor,
  type MediaAuthorityPort,
  type MediaReferencesPort,
  type VideoRecord,
} from '@minhaj/contracts/media';
import type {
  MigrationActor,
  MigrationContentKind,
  MigrationPublicationTargetPort,
  StagedVideoPayload,
  TargetPublication,
} from '@minhaj/contracts/migration';

import { createMediaService, mediaFailure } from '../contexts/media/index.ts';
import { createHoldingService } from '../contexts/personalisation-notifications/index.ts';

/**
 * Migration's ONE real publication target, `media.video` — Layer 4
 * (Phase 29; MIGRATION_STRATEGY.md §4.12, §7).
 *
 * THROUGH MEDIA'S PUBLIC SERVICE, NEVER ITS TABLES. A migrated Video is saved by
 * `createMediaService(...).saveVideo` exactly as an operator's is: Media's
 * strict schema parses it, Media asks People and Taxonomy about its references,
 * Media's authority (`media.administer`, read live) decides, and Media writes
 * its own audit row and search intent. A refusal from Media is final and is
 * reported as one; only a THROWN failure is "unavailable".
 *
 * IDEMPOTENT PER ENTRY. A publication interrupted after Media committed but
 * before Migration recorded it — and only such a RESUMED entry — is completed by
 * ADOPTION: Media answers that the
 * provider identifier or the slug is taken, the Video is found through Media's
 * own administrative read, and it is adopted only when it is PUBLISHED and both
 * its provider identity and its slug are the payload's. Anything else — an
 * archived Video, another record's slug, the same provider id under another
 * slug — is a refusal for a person to resolve, never an overwrite.
 *
 * WITHDRAWAL IS AN ARCHIVE AT THE PUBLISHED VERSION: the Video is re-read, its
 * version must still be the one Migration recorded, and it is saved `archived`
 * with every other value exactly as Media holds it — so nothing a person did
 * meanwhile is undone silently, and a Video edited since is left alone.
 *
 * WHETHER A PERSON HOLDS IT is Personalisation's answer (`videoHeld`), asked
 * through that context's own public service; a held Video is never withdrawn
 * automatically.
 *
 * NODE-RUNNABLE. Shared by the web process and the migration CLIs, so it names
 * packages and explicit `.ts` paths only — never the `@/` alias.
 */

/** The Media operations the target uses, and nothing else of Media. */
type MediaService = ReturnType<typeof createMediaService>;
export type MediaVideoOperations = Pick<MediaService, 'saveVideo' | 'video' | 'videos'>;

/** Personalisation's one-bit answer about a Video. */
export interface VideoHoldings {
  videoHeld(videoId: string): Promise<boolean>;
}

/** Pages of Media's administrative listing searched when adopting. */
const ADOPTION_PAGES = 20;

/** The locale-free canonical path; routing adds the locale prefix. */
const canonicalPath = (slug: string) => `/watch/videos/${slug}`;

/** A Media refusal as a short code the manifest entry may store. */
function refusal(reason: string): TargetPublication {
  return { status: 'refused', reason: reason.slice(0, 32) };
}

class Unavailable extends Error {}

/**
 * Media's answer to a call: the value, a refusal code, or `Unavailable` thrown
 * for an outage. Media's own vocabulary decides which is which.
 */
async function ask<T>(
  work: () => Promise<T>,
): Promise<
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: string }
> {
  try {
    return { ok: true, value: await work() };
  } catch (error) {
    const reason = mediaFailure(error);
    if (reason === 'unavailable') throw new Unavailable();
    return { ok: false, reason };
  }
}

/** The staged payload as Media's own `videoInputSchema` input. */
function videoInput(payload: StagedVideoPayload, topicIds: readonly string[]) {
  return {
    slug: payload.slug,
    primaryLocale: payload.primaryLocale,
    state: 'published',
    isFeatured: false,
    provider: payload.provider,
    providerReference: payload.providerVideoId,
    availability: 'available',
    format: null,
    languageCode: payload.languageCode,
    labels: payload.labels.map((label) => ({
      locale: label.locale,
      title: label.title,
      description: label.description,
    })),
    durationSeconds: payload.durationSeconds,
    publishedOn: payload.publishedOn,
    thumbnailUrl: null,
    captions: false,
    transcript: null,
    seriesId: null,
    seriesPosition: null,
    speakerIds: [],
    topicIds: [...topicIds],
  };
}

/** A Video exactly as Media holds it, as input, in the lifecycle state given. */
function currentInput(video: VideoRecord, state: 'archived') {
  return {
    slug: video.slug,
    primaryLocale: video.primaryLocale,
    state,
    isFeatured: video.isFeatured,
    provider: video.provider,
    providerReference: video.providerVideoId,
    availability: video.availability,
    format: video.format,
    languageCode: video.languageCode,
    labels: video.labels.map((label) => ({
      locale: label.locale,
      title: label.title,
      description: label.description,
    })),
    durationSeconds: video.durationSeconds,
    publishedOn: video.publishedOn,
    thumbnailUrl: video.thumbnailUrl,
    captions: video.captions,
    transcript: video.transcript,
    seriesId: video.series?.id ?? null,
    seriesPosition: video.series?.position ?? null,
    speakerIds: [...video.speakerIds],
    topicIds: [...video.topicIds],
  };
}

/** The publication target over Media's operations and Personalisation's answer. */
export function mediaVideoTargetOver(deps: {
  readonly media: MediaVideoOperations;
  readonly holdings: VideoHoldings;
}): MigrationPublicationTargetPort {
  const { media } = deps;
  const supports = (kind: MigrationContentKind) => kind === 'media.video';
  const asMedia = (actor: MigrationActor): MediaActor => ({ accountId: actor.accountId });

  /** The Video an interrupted publication made, when it is exactly this payload's. */
  async function adopt(
    actor: MediaActor,
    payload: StagedVideoPayload,
  ): Promise<TargetPublication> {
    for (let page = 0; page < ADOPTION_PAGES; page += 1) {
      const listing = await ask(() =>
        media.videos(actor, {
          offset: page * MEDIA_PAGE,
          state: null,
          text: payload.slug,
        }),
      );
      if (!listing.ok) return refusal(listing.reason);
      const match = listing.value.items.find((item) => item.slug === payload.slug);
      if (match !== undefined) {
        const found = await ask(() => media.video(actor, match.id));
        if (!found.ok) return refusal(found.reason);
        const video = found.value;
        if (
          video === null ||
          video.slug !== payload.slug ||
          video.provider !== payload.provider ||
          video.providerVideoId !== payload.providerVideoId
        )
          return refusal('target-conflict');
        if (video.state !== 'published') return refusal('target-not-published');
        return {
          status: 'published',
          videoId: video.id,
          version: video.version,
          canonicalPath: canonicalPath(video.slug),
        };
      }
      if (!listing.value.hasMore) break;
    }
    // The provider id is catalogued under another slug, or the slug is a
    // former slug of another Video: not this payload's record.
    return refusal('target-conflict');
  }

  return {
    supports,

    async publish({ kind, payload, topicIds, actor, resumed }) {
      if (!supports(kind) || payload.kind !== 'media.video')
        return refusal('unsupported-kind');
      const mediaActor = asMedia(actor);
      try {
        const saved = await ask(() =>
          media.saveVideo(mediaActor, null, null, videoInput(payload, topicIds)),
        );
        if (saved.ok)
          return {
            status: 'published',
            videoId: saved.value.id,
            version: saved.value.version,
            canonicalPath: canonicalPath(saved.value.slug),
          };
        // Adoption is for an interrupted publication of THIS entry only. A fresh
        // entry meeting an existing Video — an earlier revision already
        // published, or another record — is left for a person: never claimed,
        // never overwritten.
        if (saved.reason === 'duplicate-video' || saved.reason === 'duplicate-slug')
          return resumed ? await adopt(mediaActor, payload) : refusal('target-exists');
        return refusal(saved.reason);
      } catch (error) {
        if (error instanceof Unavailable) return { status: 'unavailable' };
        throw error;
      }
    },

    async inspect({ kind, videoId, actor }) {
      if (!supports(kind)) return null;
      const video = await media.video(asMedia(actor), videoId);
      if (video === null) return { exists: false, version: 0, referencedByPeople: false };
      return {
        exists: true,
        version: video.version,
        referencedByPeople: await deps.holdings.videoHeld(video.id),
      };
    },

    async withdraw({ kind, videoId, expectedVersion, actor }) {
      if (!supports(kind)) return { status: 'refused', reason: 'unsupported-kind' };
      const mediaActor = asMedia(actor);
      try {
        const found = await ask(() => media.video(mediaActor, videoId));
        if (!found.ok) return { status: 'refused', reason: found.reason.slice(0, 32) };
        const video = found.value;
        if (video === null) return { status: 'refused', reason: 'not-found' };
        if (video.version !== expectedVersion)
          return { status: 'refused', reason: 'conflict' };
        const archived = await ask(() =>
          media.saveVideo(
            mediaActor,
            video.id,
            expectedVersion,
            currentInput(video, 'archived'),
          ),
        );
        if (!archived.ok)
          return { status: 'refused', reason: archived.reason.slice(0, 32) };
        return { status: 'withdrawn', version: archived.value.version };
      } catch (error) {
        if (error instanceof Unavailable) return { status: 'unavailable' };
        throw error;
      }
    },
  };
}

/**
 * The target as both processes compose it: Media's PUBLIC service over Media's
 * own adapter — exactly as Media's composition builds it — with the caller's
 * live authority and owner references, and Personalisation's holding answer
 * over its own adapter.
 */
export function createMediaVideoTarget(deps: {
  readonly authority: MediaAuthorityPort;
  readonly references: MediaReferencesPort;
}): MigrationPublicationTargetPort {
  return mediaVideoTargetOver({
    media: createMediaService({
      persistence: createMediaPersistence(),
      authority: deps.authority,
      references: deps.references,
    }),
    holdings: createHoldingService({ holdings: createPersonalHoldings() }),
  });
}
