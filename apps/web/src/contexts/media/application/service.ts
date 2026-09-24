import 'server-only';

import { z } from 'zod';

import {
  applyPlaylistChange,
  mediaAdminQuerySchema,
  mediaIdSchema,
  mediaVersionSchema,
  playlistChangeSchema,
  playlistInputSchema,
  seriesInputSchema,
  videoInputSchema,
  type MediaActor,
  type MediaAuthorityPort,
  type MediaPersistencePort,
  type MediaReferencesPort,
} from '@minhaj/contracts/media';

/**
 * The Media administrative service — Video, Series and Playlist.
 *
 * TWO AUTHORITIES, RE-CHECKED LIVE ON EVERY CALL. `media.read` opens a record;
 * `media.administer` is what every change requires. The check is a read of the
 * principal's CURRENT permission set through the authority port, so a revoked
 * Media role refuses the next action rather than the next sign-in
 * (SECURITY_BASELINE.md §3.4 rule 2). A SpeakerProfile is never consulted: being
 * named on a Video is attribution and grants nothing.
 *
 * EVERY INPUT IS PARSED HERE, by strict schemas. A field nobody named is a
 * refusal, a provider reference that does not parse is a refusal, and an
 * expected version is compared rather than trusted.
 *
 * REFERENCES ARE ASKED OF THEIR OWNERS. A speaker must be a published People
 * contributor, a topic an active Taxonomy topic and a content language an active
 * Taxonomy language — answered through the references port at Layer 4, never by
 * a Media query against another context's tables.
 */

class MediaRefusal extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

/** Every answer a Media mutation can give that the interface has words for. */
const FAILURES: ReadonlySet<string> = new Set([
  'denied',
  'invalid',
  'conflict',
  'not-found',
  'duplicate-slug',
  'duplicate-video',
  'duplicate-position',
  'duplicate-member',
  'limit',
]);

/** A thrown value mapped onto that fixed vocabulary; anything else is `unavailable`. */
export function mediaFailure(error: unknown): string {
  if (error instanceof z.ZodError) return 'invalid';
  const reason = (error as { reason?: unknown } | null)?.reason;
  return typeof reason === 'string' && FAILURES.has(reason) ? reason : 'unavailable';
}

export function createMediaService(deps: {
  readonly persistence: MediaPersistencePort;
  readonly authority: MediaAuthorityPort;
  readonly references: MediaReferencesPort;
}) {
  const store = deps.persistence;

  async function permit(actor: MediaActor, key: 'media.read' | 'media.administer') {
    if (!actor?.accountId || !(await deps.authority.permits(actor.accountId, key)))
      throw new MediaRefusal('denied');
  }

  /** An edit names a record and its expected version; a create names neither. */
  function edit(id: string | null, version: number | null): void {
    if (id !== null) {
      mediaIdSchema.parse(id);
      mediaVersionSchema.parse(version);
    } else if (version !== null) throw new MediaRefusal('invalid');
  }

  const offset = (value: number) => z.number().int().min(0).max(25_000).parse(value);

  return {
    async videos(actor: MediaActor, raw: unknown = {}) {
      await permit(actor, 'media.read');
      return store.videos(mediaAdminQuerySchema.parse(raw));
    },

    async video(actor: MediaActor, id: string) {
      await permit(actor, 'media.read');
      return store.video(mediaIdSchema.parse(id));
    },

    async saveVideo(
      actor: MediaActor,
      id: string | null,
      expectedVersion: number | null,
      raw: unknown,
    ) {
      await permit(actor, 'media.administer');
      edit(id, expectedVersion);
      const value = videoInputSchema.parse(raw);
      const checks = await Promise.all([
        deps.references.validPeople(value.speakerIds),
        deps.references.validTopics(value.topicIds),
        deps.references.validLanguage(value.languageCode),
        value.seriesId === null
          ? Promise.resolve(true)
          : store.series(value.seriesId).then((series) => series !== null),
      ]);
      if (checks.includes(false)) throw new MediaRefusal('invalid');
      return store.saveVideo({ actorId: actor.accountId, id, expectedVersion, value });
    },

    async seriesDirectory(actor: MediaActor, raw: unknown = {}) {
      await permit(actor, 'media.read');
      return store.seriesDirectory(mediaAdminQuerySchema.parse(raw));
    },

    async series(actor: MediaActor, id: string) {
      await permit(actor, 'media.read');
      return store.series(mediaIdSchema.parse(id));
    },

    async seriesEpisodes(actor: MediaActor, seriesId: string, start = 0) {
      await permit(actor, 'media.read');
      return store.seriesEpisodes(mediaIdSchema.parse(seriesId), offset(start));
    },

    async seriesChoices(actor: MediaActor) {
      await permit(actor, 'media.read');
      return store.seriesChoices();
    },

    async saveSeries(
      actor: MediaActor,
      id: string | null,
      expectedVersion: number | null,
      raw: unknown,
    ) {
      await permit(actor, 'media.administer');
      edit(id, expectedVersion);
      return store.saveSeries({
        actorId: actor.accountId,
        id,
        expectedVersion,
        value: seriesInputSchema.parse(raw),
      });
    },

    async playlists(actor: MediaActor, raw: unknown = {}) {
      await permit(actor, 'media.read');
      return store.playlists(mediaAdminQuerySchema.parse(raw));
    },

    async playlist(actor: MediaActor, id: string) {
      await permit(actor, 'media.read');
      return store.playlist(mediaIdSchema.parse(id));
    },

    async savePlaylist(
      actor: MediaActor,
      id: string | null,
      expectedVersion: number | null,
      raw: unknown,
    ) {
      await permit(actor, 'media.administer');
      edit(id, expectedVersion);
      return store.savePlaylist({
        actorId: actor.accountId,
        id,
        expectedVersion,
        value: playlistInputSchema.parse(raw),
      });
    },

    /**
     * One named change to a Playlist's order, applied to the membership the
     * operator was shown.
     *
     * THE CHANGE IS COMPUTED FROM CURRENT STATE, AND ONLY IF THAT STATE IS THE
     * VERSION THE OPERATOR SAW. The adapter then claims that same version
     * atomically, so a second operator's change made in between is a conflict
     * rather than something this change silently reorders or drops.
     */
    async changePlaylist(
      actor: MediaActor,
      playlistId: string,
      expectedVersion: number,
      raw: unknown,
    ) {
      await permit(actor, 'media.administer');
      const id = mediaIdSchema.parse(playlistId);
      const version = mediaVersionSchema.parse(expectedVersion);
      const change = playlistChangeSchema.parse(raw);

      const current = await store.playlist(id);
      if (current === null) throw new MediaRefusal('not-found');
      if (current.version !== version) throw new MediaRefusal('conflict');

      const outcome = applyPlaylistChange(
        current.videos.map((video) => video.id),
        change,
      );
      if ('refusal' in outcome) throw new MediaRefusal(outcome.refusal);

      if (change.op === 'add' && (await store.video(change.videoId)) === null)
        throw new MediaRefusal('invalid');

      return store.setPlaylistVideos({
        actorId: actor.accountId,
        playlistId: id,
        expectedVersion: version,
        videoIds: outcome.videoIds,
        change: change.op,
      });
    },
  };
}
