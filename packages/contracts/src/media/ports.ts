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
}
