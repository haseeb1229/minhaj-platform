import type {
  AudioAssetRelation,
  AudioSearchRecord,
  AudioSeriesPage,
  AudioSeriesRecord,
  AudioSeriesValue,
  AudioTrackPage,
  AudioTrackQuery,
  AudioTrackRecord,
  AudioTrackValue,
} from './audio.ts';
import type {
  ArchiveMonth,
  ArchiveYear,
  GalleryDetail,
  GalleryPage,
  GalleryRecord,
  GalleryValue,
  PhotoAdminQuery,
  PhotoArchiveQuery,
  PhotoAssetRelation,
  PhotoPage,
  PhotoRecord,
  PhotoValue,
  PublicGallery,
  PublicGalleryPage,
} from './photo.ts';
import type {
  MediaAdminQuery,
  MediaSitemapRow,
  PlaylistDetail,
  PlaylistPage,
  PlaylistRecord,
  PlaylistValue,
  SeriesKind,
  SeriesPage,
  SeriesRecord,
  SeriesValue,
  SpeakerFacetPage,
  VideoPage,
  VideoQuery,
  VideoRecord,
  VideoSearchRecord,
  VideoValue,
} from './values.ts';

/**
 * The ports between the Media context and what it depends on
 * (ARCHITECTURE.md §3.1.1, §4.1).
 *
 * The context lives in `apps/web/src/contexts/media/` and its adapter in
 * `packages/database/src/adapters/media/`; neither imports the other, and both
 * import this. Every operation is ONE named act with its own bounds — no
 * repository, no `where`, no transaction handle, no generic page type.
 *
 * TWO READ SURFACES, AND THE SPLIT IS A SECURITY BOUNDARY. `MediaPublicReaderPort`
 * has no method that returns a draft, an archived record or anything an
 * operator only sees, and takes no actor: the public Watch pages are built on it
 * and cannot render withheld state by forgetting a check. `MediaPersistencePort`
 * is reached only through the Media service, which re-checks `media.read` or
 * `media.administer` live on every call.
 */

export interface MediaActor {
  readonly accountId: string;
}

/** The ONE thing Media asks Identity: does this account hold this permission now? */
export interface MediaAuthorityPort {
  permits(accountId: string, permission: string): Promise<boolean>;
}

/**
 * The questions Media asks its two Layer-1 owners, answered at Layer 4.
 *
 * A speaker must be a published People contributor, a topic an active Taxonomy
 * topic, a content language an active Taxonomy language. Media never reads
 * those owners' tables, and holds no copy of a name.
 */
export interface MediaReferencesPort {
  validPeople(ids: readonly string[]): Promise<boolean>;
  validTopics(ids: readonly string[]): Promise<boolean>;
  validLanguage(code: string): Promise<boolean>;
}

/* ===========================================================================
 * Public reads
 * ========================================================================= */

export interface MediaPublicReaderPort {
  /** One bounded page of PUBLISHED Videos, newest provider date first. */
  videos(query: VideoQuery): Promise<VideoPage>;
  /** One published Video by its CURRENT slug. */
  video(slug: string): Promise<VideoRecord | null>;
  /** The current slug a current or FORMER slug of a published Video resolves to. */
  videoCanonicalSlug(slug: string): Promise<string | null>;
  /** The published Playlists a published Video appears in. Bounded. */
  videoPlaylists(videoId: string): Promise<readonly PlaylistRecord[]>;

  /** One bounded page of published Series of one kind. */
  seriesList(kind: SeriesKind, offset: number): Promise<SeriesPage>;
  /** One published Series by its CURRENT slug, whatever its kind. */
  series(slug: string): Promise<SeriesRecord | null>;
  /**
   * The current kind and slug a current or FORMER Series slug resolves to — both
   * at once, so a renamed series that has also become a programme is ONE hop.
   */
  seriesCanonical(
    slug: string,
  ): Promise<{ readonly kind: SeriesKind; readonly slug: string } | null>;
  /** One page of a published Series' published episodes, in episode order. */
  seriesVideos(seriesId: string, offset: number): Promise<VideoPage>;

  playlists(offset: number): Promise<PlaylistPage>;
  playlist(slug: string): Promise<PlaylistRecord | null>;
  playlistCanonicalSlug(slug: string): Promise<string | null>;
  /** One page of a published Playlist's published Videos, in playlist order. */
  playlistVideos(playlistId: string, offset: number): Promise<VideoPage>;

  /**
   * The People named as speakers on at least one published Video, with counts.
   * Identifiers only: the names come from People, for a whole page at once.
   */
  speakerFacets(offset: number): Promise<SpeakerFacetPage>;

  sitemap(
    kind: 'video' | 'series' | 'playlist',
    offset: number,
    limit: number,
  ): Promise<readonly MediaSitemapRow[]>;

  /** Search projection reads, under the same public predicate. */
  searchVideo(id: string): Promise<VideoSearchRecord | null>;
  searchVideos(input: {
    readonly after: string | null;
    readonly limit: number;
  }): Promise<readonly { readonly id: string; readonly stamp: string }[]>;
  /** Current public addresses of whichever of `ids` are published now. Bounded. */
  publicVideoTargets(
    ids: readonly string[],
  ): Promise<readonly { readonly id: string; readonly slug: string }[]>;

  /* ---- Phase 11 — AudioTrack and AudioSeries --------------------------- */

  /** One bounded page of PUBLISHED AudioTracks, most recently recorded first. */
  audioTracks(query: AudioTrackQuery): Promise<AudioTrackPage>;
  /** One published AudioTrack by its CURRENT slug. */
  audioTrack(slug: string): Promise<AudioTrackRecord | null>;
  /** The current slug a current or FORMER slug of a published AudioTrack resolves to. */
  audioTrackCanonicalSlug(slug: string): Promise<string | null>;
  audioSeriesList(offset: number): Promise<AudioSeriesPage>;
  audioSeries(slug: string): Promise<AudioSeriesRecord | null>;
  audioSeriesCanonicalSlug(slug: string): Promise<string | null>;
  /** One page of a published AudioSeries' published tracks, in series order. */
  audioSeriesTracks(seriesId: string, offset: number): Promise<AudioTrackPage>;
  audioSitemap(
    kind: 'track' | 'series',
    offset: number,
    limit: number,
  ): Promise<readonly MediaSitemapRow[]>;
  searchAudio(id: string): Promise<AudioSearchRecord | null>;
  searchAudioTracks(input: {
    readonly after: string | null;
    readonly limit: number;
  }): Promise<readonly { readonly id: string; readonly stamp: string }[]>;
  publicAudioTargets(
    ids: readonly string[],
  ): Promise<readonly { readonly id: string; readonly slug: string }[]>;

  /* ---- Phase 12 — Photo, Gallery and the historical archive ------------ */

  /** One bounded page of PUBLISHED Photos with an image, most recently added first. */
  photos(offset: number): Promise<PhotoPage>;
  /**
   * One bounded page of the historical archive: published Photos whose date
   * is KNOWN, latest first, narrowed to a year and a month when given.
   */
  archivePhotos(query: PhotoArchiveQuery): Promise<PhotoPage>;
  /** The years the archive holds public Photos in, with counts. Bounded. */
  archiveYears(): Promise<readonly ArchiveYear[]>;
  /** The known months of one archive year, with counts. */
  archiveMonths(year: number): Promise<readonly ArchiveMonth[]>;
  /**
   * One bounded page of published Galleries that hold at least one public
   * Photo, most recently created first, each with its count and cover.
   */
  galleries(offset: number): Promise<PublicGalleryPage>;
  /** One published Gallery by its CURRENT slug, with its count and cover. */
  gallery(slug: string): Promise<PublicGallery | null>;
  /** The current slug a current or FORMER slug of a published Gallery resolves to. */
  galleryCanonicalSlug(slug: string): Promise<string | null>;
  /** One page of a published Gallery's published Photos, in its order. */
  galleryPhotos(galleryId: string, offset: number): Promise<PhotoPage>;
  /** Canonical sitemap rows: published Galleries holding a public Photo. */
  gallerySitemap(offset: number, limit: number): Promise<readonly MediaSitemapRow[]>;
}

/**
 * The ONE question Media's audio serving policy asks: which asset is recorded
 * against this track, and in what lifecycle state is the track?
 *
 * A PORT OF ITS OWN, AND THE SEPARATION IS THE POINT. It answers for ANY track —
 * a draft's asset identifier included — so it is not on the public reader, where
 * every public page could reach it. Its only consumer is the serving decision,
 * which checks the state in the same breath (Library's `assetRelation` makes the
 * same trade for Editions).
 */
export interface MediaAssetRelationPort {
  audioAsset(trackId: string): Promise<AudioAssetRelation | null>;
  /** Phase 12 — the same question for a Photo's image. */
  photoAsset(photoId: string): Promise<PhotoAssetRelation | null>;
}

/* ===========================================================================
 * Administration
 * ========================================================================= */

export interface MediaPersistencePort {
  videos(query: MediaAdminQuery): Promise<VideoPage>;
  video(id: string): Promise<VideoRecord | null>;
  /**
   * Creates (`id === null`) or updates one Video under its expected version,
   * replacing its label, speaker and topic sets, reserving its slug, recording
   * its audit entry and its search intent — in ONE transaction.
   */
  saveVideo(input: {
    readonly actorId: string;
    readonly id: string | null;
    readonly expectedVersion: number | null;
    readonly value: VideoValue;
  }): Promise<VideoRecord>;

  seriesDirectory(query: MediaAdminQuery): Promise<SeriesPage>;
  series(id: string): Promise<SeriesRecord | null>;
  /** Every episode of one Series, any state, in episode order. Bounded. */
  seriesEpisodes(seriesId: string, offset: number): Promise<VideoPage>;
  /** Every Series, any state, for the Video form's choice. Bounded. */
  seriesChoices(): Promise<readonly SeriesRecord[]>;
  saveSeries(input: {
    readonly actorId: string;
    readonly id: string | null;
    readonly expectedVersion: number | null;
    readonly value: SeriesValue;
  }): Promise<SeriesRecord>;

  playlists(query: MediaAdminQuery): Promise<PlaylistPage>;
  playlist(id: string): Promise<PlaylistDetail | null>;
  savePlaylist(input: {
    readonly actorId: string;
    readonly id: string | null;
    readonly expectedVersion: number | null;
    readonly value: PlaylistValue;
  }): Promise<PlaylistRecord>;
  /**
   * Replaces a Playlist's ordered membership with `videoIds` — ONLY if the
   * Playlist is still at `expectedVersion` — and audits the named change.
   */
  setPlaylistVideos(input: {
    readonly actorId: string;
    readonly playlistId: string;
    readonly expectedVersion: number;
    readonly videoIds: readonly string[];
    readonly change: 'add' | 'remove' | 'move';
  }): Promise<PlaylistDetail>;

  /* ---- Phase 11 — AudioTrack and AudioSeries --------------------------- */

  audioTracks(query: MediaAdminQuery): Promise<AudioTrackPage>;
  audioTrack(id: string): Promise<AudioTrackRecord | null>;
  /**
   * Creates or updates one AudioTrack under its expected version — its labels,
   * speakers and topics, slug reservation, audit entry and search intent in ONE
   * transaction. The attached asset is NEVER changed here.
   */
  saveAudioTrack(input: {
    readonly actorId: string;
    readonly id: string | null;
    readonly expectedVersion: number | null;
    readonly value: AudioTrackValue;
  }): Promise<AudioTrackRecord>;
  /**
   * Records `assetId` as the track's audio — ONLY if the track is still at
   * `expectedVersion` — and audits the replacement. The previous asset is left
   * untouched in Storage: it simply stops being the one this track serves.
   */
  attachAudioAsset(input: {
    readonly actorId: string;
    readonly trackId: string;
    readonly expectedVersion: number;
    readonly assetId: string;
  }): Promise<AudioTrackRecord>;

  audioSeriesDirectory(query: MediaAdminQuery): Promise<AudioSeriesPage>;
  audioSeries(id: string): Promise<AudioSeriesRecord | null>;
  /** Every track of one AudioSeries, any state, in series order. Bounded. */
  audioSeriesTracks(seriesId: string, offset: number): Promise<AudioTrackPage>;
  /** Every AudioSeries, any state, for the track form's choice. Bounded. */
  audioSeriesChoices(): Promise<readonly AudioSeriesRecord[]>;
  saveAudioSeries(input: {
    readonly actorId: string;
    readonly id: string | null;
    readonly expectedVersion: number | null;
    readonly value: AudioSeriesValue;
  }): Promise<AudioSeriesRecord>;

  /* ---- Phase 12 — Photo and Gallery ------------------------------------- */

  photos(query: PhotoAdminQuery): Promise<PhotoPage>;
  photo(id: string): Promise<PhotoRecord | null>;
  /** The Galleries, any state, a Photo appears in. Bounded. */
  photoGalleries(photoId: string): Promise<readonly GalleryRecord[]>;
  /**
   * Creates or updates one Photo's metadata and lifecycle under its expected
   * version — its labels and its audit entry — in ONE transaction. The attached image
   * is NEVER changed here.
   */
  savePhoto(input: {
    readonly actorId: string;
    readonly id: string | null;
    readonly expectedVersion: number | null;
    readonly value: PhotoValue;
  }): Promise<PhotoRecord>;
  /**
   * Records `assetId` — with the dimensions Storage measured — as the Photo's
   * image, ONLY if the Photo is still at `expectedVersion`, and audits the
   * replacement. The previous asset is left untouched in Storage.
   */
  attachPhotoAsset(input: {
    readonly actorId: string;
    readonly photoId: string;
    readonly expectedVersion: number;
    readonly assetId: string;
    readonly width: number;
    readonly height: number;
  }): Promise<PhotoRecord>;

  galleries(query: MediaAdminQuery): Promise<GalleryPage>;
  gallery(id: string): Promise<GalleryDetail | null>;
  saveGallery(input: {
    readonly actorId: string;
    readonly id: string | null;
    readonly expectedVersion: number | null;
    readonly value: GalleryValue;
  }): Promise<GalleryRecord>;
  /**
   * Replaces a Gallery's ordered membership with `photoIds` — ONLY if the
   * Gallery is still at `expectedVersion` — and audits the named change.
   */
  setGalleryPhotos(input: {
    readonly actorId: string;
    readonly galleryId: string;
    readonly expectedVersion: number;
    readonly photoIds: readonly string[];
    readonly change: 'add' | 'remove' | 'move';
  }): Promise<GalleryDetail>;
}
