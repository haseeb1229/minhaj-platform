import 'server-only';

import {
  createEditorialPersistence,
  createLibraryPersistence,
  createMediaPersistence,
  createPersonalHoldings,
} from '@minhaj/database';
import type { LibraryReferencesPort } from '@minhaj/contracts/library';
import {
  MEDIA_PAGE,
  type MediaActor,
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

export { routeMigrationTargets } from './migration-target-router.ts';

import { createEditorialService } from '../contexts/editorial/index.ts';
import { createLibraryService } from '../contexts/library/index.ts';
import { createMediaService, mediaFailure } from '../contexts/media/index.ts';
import { createHoldingService } from '../contexts/personalisation-notifications/index.ts';
import {
  editorialTargetOver,
  migrationEditorialReferences,
} from './migration-editorial-targets.ts';
import {
  libraryMagazineIssueTargetOver,
  libraryMagazineTargetOver,
  libraryWorkTargetOver,
} from './migration-library-targets.ts';
import {
  ADOPTION_PAGES,
  askerOf,
  publishing,
  refusal,
  withdrawalRefusal,
  withdrawing,
} from './migration-target-support.ts';

/**
 * The `media.video` publication target — Layer 4 (Phase 29, unchanged in
 * behaviour by Phase 30; MIGRATION_STRATEGY.md §4.12, §7) — and the ONE
 * factory both composition roots build every per-kind target from
 * (`createMigrationTargets`), which `./migration-target-router.ts` routes
 * between.
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

/** The locale-free canonical path; routing adds the locale prefix. */
const canonicalPath = (slug: string) => `/watch/videos/${slug}`;

const ask = askerOf(mediaFailure);

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
          target: { kind: 'media.video', id: video.id },
          stage: 'public',
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
      return publishing(async () => {
        const saved = await ask(() =>
          media.saveVideo(mediaActor, null, null, videoInput(payload, topicIds)),
        );
        if (saved.ok)
          return {
            status: 'published',
            target: { kind: 'media.video', id: saved.value.id },
            stage: 'public',
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
      });
    },

    async inspect({ target, actor }) {
      if (!supports(target.kind)) return null;
      const video = await media.video(asMedia(actor), target.id);
      if (video === null) return { exists: false, version: 0, referencedByPeople: false };
      return {
        exists: true,
        version: video.version,
        referencedByPeople: await deps.holdings.videoHeld(video.id),
      };
    },

    async withdraw({ target, expectedVersion, actor }) {
      if (!supports(target.kind)) return withdrawalRefusal('unsupported-kind');
      const mediaActor = asMedia(actor);
      return withdrawing(async () => {
        const found = await ask(() => media.video(mediaActor, target.id));
        if (!found.ok) return withdrawalRefusal(found.reason);
        const video = found.value;
        if (video === null) return withdrawalRefusal('not-found');
        if (video.version !== expectedVersion) return withdrawalRefusal('conflict');
        const archived = await ask(() =>
          media.saveVideo(
            mediaActor,
            video.id,
            expectedVersion,
            currentInput(video, 'archived'),
          ),
        );
        if (!archived.ok) return withdrawalRefusal(archived.reason);
        return { status: 'withdrawn', version: archived.value.version };
      });
    },
  };
}

/**
 * EVERY publication target, as both processes compose them: each owning
 * domain's PUBLIC service over that domain's own adapter — exactly as the
 * domain's composition builds it — with the caller's live authority and the
 * owner references Media's and Library's compositions use, and
 * Personalisation's holding answers over its own adapter.
 *
 *   media.video             Media        `saveVideo`
 *   library.work            Library      `saveWork` + `saveEdition`
 *   library.magazine        Library      `saveScholarly('magazine')`
 *   library.magazine-issue  Library      `saveScholarly('magazine-issue')`
 *   editorial.news          Editorial    `create('news-article')` + `submit`
 *   editorial.article       Editorial    `create('article')` + `submit`
 *
 * The review-only kinds (Fatwa, Quran) have no target here, by design. The
 * caller hands the list to `routeMigrationTargets`, which refuses a kind two
 * targets claim and supports nothing else.
 */
export function createMigrationTargets(deps: {
  readonly authority: {
    permits(accountId: string, permission: string): Promise<boolean>;
  };
  readonly references: MediaReferencesPort & LibraryReferencesPort;
}): readonly MigrationPublicationTargetPort[] {
  const holdings = createHoldingService({ holdings: createPersonalHoldings() });
  const library = createLibraryService({
    persistence: createLibraryPersistence(),
    authority: deps.authority,
    references: deps.references,
  });
  const editorial = createEditorialService({
    persistence: createEditorialPersistence(),
    authority: deps.authority,
    references: migrationEditorialReferences(deps.references),
    // Only the scheduled-publication sweep reports through this, and the
    // targets never run it.
    reportFailure: () => undefined,
  });
  return [
    mediaVideoTargetOver({
      media: createMediaService({
        persistence: createMediaPersistence(),
        authority: deps.authority,
        references: deps.references,
      }),
      holdings,
    }),
    libraryWorkTargetOver({ library, holdings }),
    libraryMagazineTargetOver({ library }),
    libraryMagazineIssueTargetOver({ library }),
    editorialTargetOver({ kind: 'editorial.news', editorial, holdings }),
    editorialTargetOver({ kind: 'editorial.article', editorial, holdings }),
  ];
}
