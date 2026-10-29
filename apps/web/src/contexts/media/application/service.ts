import 'server-only';

import { z } from 'zod';

import {
  applyGalleryChange,
  applyPlaylistChange,
  audioSeriesInputSchema,
  audioTrackInputSchema,
  galleryChangeSchema,
  galleryInputSchema,
  mediaAdminQuerySchema,
  mediaIdSchema,
  mediaVersionSchema,
  playlistChangeSchema,
  photoAdminQuerySchema,
  photoInputSchema,
  playlistInputSchema,
  seriesInputSchema,
  videoInputSchema,
  type MediaActor,
  type MediaAuthorityPort,
  type MediaPersistencePort,
  type MediaReferencesPort,
} from '@minhaj/contracts/media';

import { MediaRefusal } from './refusal.ts';

/**
 * The Media administrative service — Video, Series and Playlist, and (Phase 11)
 * AudioTrack and AudioSeries.
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
 *
 * PHASE 11 — AUDIO BY THE SAME RULES. AudioTrack and AudioSeries use the same two
 * keys, the same strict schemas and the same reference checks. A track's FILE is
 * never set here: it arrives only through the upload (`./audio-upload.ts`),
 * which records the relation after Storage has cleared the bytes.
 *
 * PHASE 12 — PHOTOGRAPHS AND GALLERIES BY THE SAME RULES. The same two keys, the
 * same strict schemas, the same expected versions. A Photo's image arrives only
 * through its upload (`./photo-upload.ts`); a Gallery's membership changes only
 * by named changes applied to the version the operator was shown.
 */

export function createMediaService(deps: {
  readonly persistence: MediaPersistencePort;
  readonly authority: MediaAuthorityPort;
  readonly references: MediaReferencesPort;
  /**
   * Phase 30-R. Storage's servable-still-image answer, asked before a Video's
   * poster is recorded. A service built without it refuses every poster
   * rather than recording one unchecked: absence fails closed.
   */
  readonly images?: {
    servableImages(assetIds: readonly string[]): Promise<ReadonlySet<string>>;
  };
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

  /** No poster needs no answer; a poster needs Storage's yes, and no port is a no. */
  async function usablePoster(assetId: string | null): Promise<boolean> {
    if (assetId === null) return true;
    if (deps.images === undefined) return false;
    return (await deps.images.servableImages([assetId])).has(assetId);
  }

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
        usablePoster(value.poster?.assetId ?? null),
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

    /* ---- Phase 11 — AudioTrack and AudioSeries ------------------------- */

    async audioTracks(actor: MediaActor, raw: unknown = {}) {
      await permit(actor, 'media.read');
      return store.audioTracks(mediaAdminQuerySchema.parse(raw));
    },

    async audioTrack(actor: MediaActor, id: string) {
      await permit(actor, 'media.read');
      return store.audioTrack(mediaIdSchema.parse(id));
    },

    /**
     * A track's metadata and lifecycle.
     *
     * A PUBLISHED TRACK HAS AUDIO. Publishing one with no attached file is
     * refused as `no-audio` — here, so the operator is told what to do, and
     * again by the adapter under the expected version and by a SQL CHECK, so no
     * writer can publish a page with nothing to hear.
     */
    async saveAudioTrack(
      actor: MediaActor,
      id: string | null,
      expectedVersion: number | null,
      raw: unknown,
    ) {
      await permit(actor, 'media.administer');
      edit(id, expectedVersion);
      const value = audioTrackInputSchema.parse(raw);
      const [people, topics, language, series, current] = await Promise.all([
        deps.references.validPeople(value.speakerIds),
        deps.references.validTopics(value.topicIds),
        deps.references.validLanguage(value.languageCode),
        value.seriesId === null
          ? Promise.resolve(true)
          : store.audioSeries(value.seriesId).then((found) => found !== null),
        id === null ? Promise.resolve(null) : store.audioTrack(id),
      ]);
      if (!people || !topics || !language || !series) throw new MediaRefusal('invalid');
      if (value.state === 'published' && (current?.assetId ?? null) === null)
        throw new MediaRefusal('no-audio');
      return store.saveAudioTrack({
        actorId: actor.accountId,
        id,
        expectedVersion,
        value,
      });
    },

    async audioSeriesDirectory(actor: MediaActor, raw: unknown = {}) {
      await permit(actor, 'media.read');
      return store.audioSeriesDirectory(mediaAdminQuerySchema.parse(raw));
    },

    async audioSeries(actor: MediaActor, id: string) {
      await permit(actor, 'media.read');
      return store.audioSeries(mediaIdSchema.parse(id));
    },

    async audioSeriesTracks(actor: MediaActor, seriesId: string, start = 0) {
      await permit(actor, 'media.read');
      return store.audioSeriesTracks(mediaIdSchema.parse(seriesId), offset(start));
    },

    async audioSeriesChoices(actor: MediaActor) {
      await permit(actor, 'media.read');
      return store.audioSeriesChoices();
    },

    async saveAudioSeries(
      actor: MediaActor,
      id: string | null,
      expectedVersion: number | null,
      raw: unknown,
    ) {
      await permit(actor, 'media.administer');
      edit(id, expectedVersion);
      return store.saveAudioSeries({
        actorId: actor.accountId,
        id,
        expectedVersion,
        value: audioSeriesInputSchema.parse(raw),
      });
    },

    /* ---- Phase 12 — Photo and Gallery ---------------------------------- */

    async photos(actor: MediaActor, raw: unknown = {}) {
      await permit(actor, 'media.read');
      return store.photos(photoAdminQuerySchema.parse(raw));
    },

    async photo(actor: MediaActor, id: string) {
      await permit(actor, 'media.read');
      return store.photo(mediaIdSchema.parse(id));
    },

    async photoGalleries(actor: MediaActor, photoId: string) {
      await permit(actor, 'media.read');
      return store.photoGalleries(mediaIdSchema.parse(photoId));
    },

    /**
     * A Photo's words, credit, date and lifecycle.
     *
     * A PUBLISHED PHOTO HAS AN IMAGE. Publishing one with none is refused as
     * `no-image` — here, so the operator is told what to do, and again by the
     * adapter under the expected version and by a SQL CHECK.
     */
    async savePhoto(
      actor: MediaActor,
      id: string | null,
      expectedVersion: number | null,
      raw: unknown,
    ) {
      await permit(actor, 'media.administer');
      edit(id, expectedVersion);
      const value = photoInputSchema.parse(raw);
      const current = id === null ? null : await store.photo(id);
      if (id !== null && current === null) throw new MediaRefusal('not-found');
      if (value.state === 'published' && (current?.assetId ?? null) === null)
        throw new MediaRefusal('no-image');
      return store.savePhoto({ actorId: actor.accountId, id, expectedVersion, value });
    },

    async galleries(actor: MediaActor, raw: unknown = {}) {
      await permit(actor, 'media.read');
      return store.galleries(mediaAdminQuerySchema.parse(raw));
    },

    async gallery(actor: MediaActor, id: string) {
      await permit(actor, 'media.read');
      return store.gallery(mediaIdSchema.parse(id));
    },

    async saveGallery(
      actor: MediaActor,
      id: string | null,
      expectedVersion: number | null,
      raw: unknown,
    ) {
      await permit(actor, 'media.administer');
      edit(id, expectedVersion);
      return store.saveGallery({
        actorId: actor.accountId,
        id,
        expectedVersion,
        value: galleryInputSchema.parse(raw),
      });
    },

    /**
     * One named change to a Gallery's membership, applied to the membership
     * the operator was shown — computed from current state, only if that state
     * is the expected version, which the adapter then claims atomically. A
     * Photo that does not exist is refused by its foreign key.
     */
    async changeGallery(
      actor: MediaActor,
      galleryId: string,
      expectedVersion: number,
      raw: unknown,
    ) {
      await permit(actor, 'media.administer');
      const id = mediaIdSchema.parse(galleryId);
      const version = mediaVersionSchema.parse(expectedVersion);
      const change = galleryChangeSchema.parse(raw);

      const current = await store.gallery(id);
      if (current === null) throw new MediaRefusal('not-found');
      if (current.version !== version) throw new MediaRefusal('conflict');

      const outcome = applyGalleryChange(
        current.photos.map((photo) => photo.id),
        change,
      );
      if ('refusal' in outcome) throw new MediaRefusal(outcome.refusal);

      return store.setGalleryPhotos({
        actorId: actor.accountId,
        galleryId: id,
        expectedVersion: version,
        photoIds: outcome.photoIds,
        change: change.op,
      });
    },
  };
}
