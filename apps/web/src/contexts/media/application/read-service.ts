import { z } from 'zod';

import {
  audioTrackQuerySchema,
  mediaIdSchema,
  mediaSlugSchema,
  PHOTO_LIMITS,
  photoArchiveQuerySchema,
  seriesKindSchema,
  videoQuerySchema,
  type MediaPublicReaderPort,
  type SeriesKind,
  type SeriesRecord,
} from '@minhaj/contracts/media';

/**
 * The PUBLIC Media reads — what every Watch, Listen and photograph page is
 * built on.
 *
 * NO ACTOR, NO SESSION, NO PERMISSION, and the SHAPE is what makes that
 * structural: there is no parameter a viewer's identity could arrive through,
 * so no answer can vary with one (ARCHITECTURE.md §8.1). Watching and listening
 * are not recorded here or anywhere — watch history is Phase 21's, and it needs
 * an account this surface never sees; no listening history is authorised.
 *
 * EVERY INPUT IS VALIDATED HERE, at the trust boundary. A slug from a URL
 * segment that does not match the grammar resolves to `null` — the page's own
 * 404 — rather than reaching a query.
 */

/** Offsets are bounded at BOTH ends: negative is nonsense, unbounded is a walk. */
const browseOffset = z.number().int().min(0).max(25_000);

const validSlug = (slug: string): boolean => mediaSlugSchema.safeParse(slug).success;

export function createMediaReadService(reader: MediaPublicReaderPort) {
  return {
    videos(raw: unknown = {}) {
      return reader.videos(videoQuerySchema.parse(raw));
    },

    video(slug: string) {
      return validSlug(slug) ? reader.video(slug) : Promise.resolve(null);
    },

    videoCanonicalSlug(slug: string) {
      return validSlug(slug) ? reader.videoCanonicalSlug(slug) : Promise.resolve(null);
    },

    videoPlaylists(videoId: string) {
      return reader.videoPlaylists(mediaIdSchema.parse(videoId));
    },

    seriesList(kind: SeriesKind, offset = 0) {
      return reader.seriesList(seriesKindSchema.parse(kind), browseOffset.parse(offset));
    },

    /**
     * One published Series, ONLY at the route family its kind names. A
     * programme requested as a series is `null` here — the page's 404 — because
     * the proxy has already answered its one canonical address with a 301, and
     * rendering it at both would give one resource two canonical URLs.
     */
    async series(kind: SeriesKind, slug: string): Promise<SeriesRecord | null> {
      if (!validSlug(slug)) return null;
      const record = await reader.series(slug);
      return record !== null && record.kind === seriesKindSchema.parse(kind)
        ? record
        : null;
    },

    seriesCanonical(slug: string) {
      return validSlug(slug) ? reader.seriesCanonical(slug) : Promise.resolve(null);
    },

    seriesVideos(seriesId: string, offset = 0) {
      return reader.seriesVideos(
        mediaIdSchema.parse(seriesId),
        browseOffset.parse(offset),
      );
    },

    playlists(offset = 0) {
      return reader.playlists(browseOffset.parse(offset));
    },

    playlist(slug: string) {
      return validSlug(slug) ? reader.playlist(slug) : Promise.resolve(null);
    },

    playlistCanonicalSlug(slug: string) {
      return validSlug(slug) ? reader.playlistCanonicalSlug(slug) : Promise.resolve(null);
    },

    playlistVideos(playlistId: string, offset = 0) {
      return reader.playlistVideos(
        mediaIdSchema.parse(playlistId),
        browseOffset.parse(offset),
      );
    },

    speakerFacets(offset = 0) {
      return reader.speakerFacets(browseOffset.parse(offset));
    },

    /**
     * One page of canonical URLs for the machine sitemap. A WIDER offset bound
     * than a browse, because the sitemap reads the whole published catalogue in
     * bounded pages and a visitor's ceiling would silently truncate it.
     */
    sitemap(kind: 'video' | 'series' | 'playlist', offset: number, limit: number) {
      return reader.sitemap(
        z.enum(['video', 'series', 'playlist']).parse(kind),
        z.number().int().min(0).max(10_000_000).parse(offset),
        z.number().int().min(1).max(5000).parse(limit),
      );
    },

    /* ---- Phase 11 — the public Listen reads ----------------------------- */

    audioTracks(raw: unknown = {}) {
      return reader.audioTracks(audioTrackQuerySchema.parse(raw));
    },

    audioTrack(slug: string) {
      return validSlug(slug) ? reader.audioTrack(slug) : Promise.resolve(null);
    },

    audioTrackCanonicalSlug(slug: string) {
      return validSlug(slug)
        ? reader.audioTrackCanonicalSlug(slug)
        : Promise.resolve(null);
    },

    audioSeriesList(offset = 0) {
      return reader.audioSeriesList(browseOffset.parse(offset));
    },

    audioSeries(slug: string) {
      return validSlug(slug) ? reader.audioSeries(slug) : Promise.resolve(null);
    },

    audioSeriesCanonicalSlug(slug: string) {
      return validSlug(slug)
        ? reader.audioSeriesCanonicalSlug(slug)
        : Promise.resolve(null);
    },

    audioSeriesTracks(seriesId: string, offset = 0) {
      return reader.audioSeriesTracks(
        mediaIdSchema.parse(seriesId),
        browseOffset.parse(offset),
      );
    },

    audioSitemap(kind: 'track' | 'series', offset: number, limit: number) {
      return reader.audioSitemap(
        z.enum(['track', 'series']).parse(kind),
        z.number().int().min(0).max(10_000_000).parse(offset),
        z.number().int().min(1).max(5000).parse(limit),
      );
    },

    /* ---- Phase 12 — photographs, galleries and the archive -------------- */

    photos(offset = 0) {
      return reader.photos(browseOffset.parse(offset));
    },

    archivePhotos(raw: unknown = {}) {
      return reader.archivePhotos(photoArchiveQuerySchema.parse(raw));
    },

    archiveYears() {
      return reader.archiveYears();
    },

    archiveMonths(year: number) {
      return reader.archiveMonths(
        z.number().int().min(PHOTO_LIMITS.earliestYear).max(9999).parse(year),
      );
    },

    galleries(offset = 0) {
      return reader.galleries(browseOffset.parse(offset));
    },

    gallery(slug: string) {
      return validSlug(slug) ? reader.gallery(slug) : Promise.resolve(null);
    },

    galleryCanonicalSlug(slug: string) {
      return validSlug(slug) ? reader.galleryCanonicalSlug(slug) : Promise.resolve(null);
    },

    galleryPhotos(galleryId: string, offset = 0) {
      return reader.galleryPhotos(
        mediaIdSchema.parse(galleryId),
        browseOffset.parse(offset),
      );
    },

    gallerySitemap(offset: number, limit: number) {
      return reader.gallerySitemap(
        z.number().int().min(0).max(10_000_000).parse(offset),
        z.number().int().min(1).max(5000).parse(limit),
      );
    },
  };
}
