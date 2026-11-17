import 'server-only';

import { Prisma } from '@prisma/client';

import type { Locale } from '@minhaj/contracts';
import {
  MEDIA_GROUP_DIRECTORY_MAX,
  MEDIA_GROUP_FACETS_MAX,
  MEDIA_SPEAKER_DIRECTORY_MAX,
  MEDIA_SPEAKER_SERIES_MAX,
  type GroupEpisode,
  type MediaCount,
  type MediaGroupEntry,
  type MediaGroupKind,
  type MediaGroupRef,
  type MediaPublicReaderPort,
  type SeriesKind,
  type VideoAvailability,
  type VideoFormat,
} from '@minhaj/contracts/media';

import { getDatabaseClient } from '../../client.ts';
import {
  boundedOffset,
  isoDate,
  LABELS,
  labelsOf,
  PASSAGES,
  passageOf,
  posterOf,
  PUBLISHED,
  SPEAKERS,
} from './shared.ts';

/**
 * WATCH PART 2 — the groupings' and the speakers' public reads
 * (DOMAIN_MODEL.md §11): `groupDirectory`, `groupSummary`, `groupEpisodes`
 * and `speakerDirectory`. Spread into Media's ONE public reader, typed by
 * Media's own port; nothing here leaves the adapter but those four answers.
 *
 * THE ORDINARY PUBLIC PREDICATE, IN EVERY STATEMENT. A grouping is named only
 * while it is published, and only its published Videos are counted, listed or
 * pictured; a speaker's Series is named only while it is published. Every
 * value is a bound parameter.
 *
 * BOUNDED, AND A FIXED NUMBER OF STATEMENTS. A directory is one ordered page
 * of at most `MEDIA_GROUP_DIRECTORY_MAX` groupings and one grouped statement
 * per aggregate (counts, languages, speakers, Topics, cover) restricted to
 * them; each per-grouping facet keeps its commonest `MEDIA_GROUP_FACETS_MAX`.
 * The titles come from a second, AUTHORITATIVE read under the predicate again,
 * so an error in an aggregate could only drop a grouping, never admit one.
 */

/** A SQL `date` as the `YYYY-MM-DD` it is, converted in SQL — never shifted by a zone. */
const isoDay = (column: Prisma.Sql) => Prisma.sql`CONVERT(char(10), ${column}, 23)`;

/**
 * THE MEMBERS of the named groupings as `(groupId, videoId, place)` over
 * published Videos of published groupings: a Series' episodes (their place the
 * episode number), or a Playlist's Videos (their place the curated position).
 */
function members(kind: MediaGroupKind, ids: readonly string[]): Prisma.Sql {
  const named = Prisma.join([...ids]);
  return kind === 'playlist'
    ? Prisma.sql`SELECT pv.[playlistId] AS [groupId], v.[id] AS [videoId], pv.[position] AS [place]
        FROM [dbo].[PlaylistVideo] pv
        JOIN [dbo].[Video] v ON v.[id] = pv.[videoId] AND v.[state] = N'published'
        JOIN [dbo].[Playlist] p ON p.[id] = pv.[playlistId] AND p.[state] = N'published'
        WHERE pv.[playlistId] IN (${named})`
    : Prisma.sql`SELECT v.[seriesId] AS [groupId], v.[id] AS [videoId], v.[seriesPosition] AS [place]
        FROM [dbo].[Video] v
        JOIN [dbo].[Series] s ON s.[id] = v.[seriesId] AND s.[state] = N'published'
        WHERE v.[state] = N'published' AND v.[seriesId] IN (${named})`;
}

interface CountRow {
  readonly groupId: string;
  readonly id: string;
  readonly videos: number;
}

/**
 * An identifier as a key: stored identifiers keep whatever case they were
 * written in, while SQL Server compares them without case — so every map of
 * this module is keyed in lower case and looked up the same way.
 */
const key = (id: string) => id.toLowerCase();

/** Grouped rows as each grouping's commonest values, in the read's order. */
function byGroup(rows: readonly CountRow[]): Map<string, MediaCount[]> {
  const out = new Map<string, MediaCount[]>();
  for (const row of rows) {
    const list = out.get(key(row.groupId)) ?? [];
    list.push({ id: row.id, videos: Number(row.videos) });
    out.set(key(row.groupId), list);
  }
  return out;
}

const EPISODE_SELECT = {
  id: true,
  slug: true,
  primaryLocale: true,
  availability: true,
  format: true,
  languageCode: true,
  durationSeconds: true,
  publishedOn: true,
  posterAssetId: true,
  posterWidth: true,
  posterHeight: true,
  labels: LABELS,
  speakers: SPEAKERS,
  quranPassages: PASSAGES,
} satisfies Prisma.VideoSelect;

const GROUP_SELECT = {
  id: true,
  slug: true,
  primaryLocale: true,
  updatedAt: true,
  labels: LABELS,
} satisfies Prisma.PlaylistSelect & Prisma.SeriesSelect;

export function groupsPublicReader(): Pick<
  MediaPublicReaderPort,
  'groupDirectory' | 'groupSummary' | 'groupEpisodes' | 'speakerDirectory'
> {
  const db = getDatabaseClient();

  /**
   * The entries of the named groupings of one kind, in the order given:
   * five grouped statements over their members, then the groupings themselves
   * under the public predicate (and, for a Series, its kind) again.
   */
  async function entries(
    kind: MediaGroupKind,
    ids: readonly string[],
  ): Promise<MediaGroupEntry[]> {
    if (ids.length === 0) return [];
    const m = members(kind, ids);
    const facet = (column: Prisma.Sql, from: Prisma.Sql) => db.$queryRaw<CountRow[]>`
      SELECT r.[groupId], r.[id], r.[videos] FROM (
        SELECT m.[groupId], ${column} AS [id], COUNT(DISTINCT m.[videoId]) AS [videos],
               ROW_NUMBER() OVER (PARTITION BY m.[groupId]
                                  ORDER BY COUNT(DISTINCT m.[videoId]) DESC, ${column} ASC) AS [rank]
        FROM (${m}) m ${from}
        GROUP BY m.[groupId], ${column}
      ) r
      WHERE r.[rank] <= ${MEDIA_GROUP_FACETS_MAX}
      ORDER BY r.[groupId], r.[rank];`;
    const [totals, languages, speakers, topics, covers, groups] = await Promise.all([
      db.$queryRaw<
        {
          groupId: string;
          videos: number;
          seconds: bigint | number | null;
          firstOn: string | null;
          lastOn: string | null;
        }[]
      >`
        SELECT m.[groupId], COUNT(*) AS [videos],
               SUM(CAST(v.[durationSeconds] AS BIGINT)) AS [seconds],
               ${isoDay(Prisma.sql`MIN(v.[publishedOn])`)} AS [firstOn],
               ${isoDay(Prisma.sql`MAX(v.[publishedOn])`)} AS [lastOn]
        FROM (${m}) m JOIN [dbo].[Video] v ON v.[id] = m.[videoId]
        GROUP BY m.[groupId];`,
      facet(
        Prisma.sql`v.[languageCode]`,
        Prisma.sql`JOIN [dbo].[Video] v ON v.[id] = m.[videoId]`,
      ),
      facet(
        Prisma.sql`c.[personId]`,
        Prisma.sql`JOIN [dbo].[VideoSpeaker] c ON c.[videoId] = m.[videoId]`,
      ),
      facet(
        Prisma.sql`o.[topicId]`,
        Prisma.sql`JOIN [dbo].[VideoTopic] o ON o.[videoId] = m.[videoId]`,
      ),
      db.$queryRaw<
        {
          groupId: string;
          videoId: string;
          posterAssetId: string;
          posterWidth: number;
          posterHeight: number;
        }[]
      >`
        SELECT r.[groupId], r.[videoId], r.[posterAssetId], r.[posterWidth], r.[posterHeight] FROM (
          SELECT m.[groupId], m.[videoId], v.[posterAssetId], v.[posterWidth], v.[posterHeight],
                 ROW_NUMBER() OVER (PARTITION BY m.[groupId] ORDER BY m.[place], m.[videoId]) AS [rank]
          FROM (${m}) m JOIN [dbo].[Video] v ON v.[id] = m.[videoId]
          WHERE v.[posterAssetId] IS NOT NULL
        ) r
        WHERE r.[rank] = 1;`,
      kind === 'playlist'
        ? db.playlist
            .findMany({
              where: { ...PUBLISHED, id: { in: [...ids] } },
              select: GROUP_SELECT,
            })
            .then((rows) => rows.map((row) => ({ ...row, kind: 'playlist' as const })))
        : db.series
            .findMany({
              where: { ...PUBLISHED, kind, id: { in: [...ids] } },
              select: { ...GROUP_SELECT, kind: true },
            })
            .then((rows) =>
              rows.map((row) => ({ ...row, kind: row.kind as MediaGroupKind })),
            ),
    ]);
    const totalOf = new Map(totals.map((row) => [key(row.groupId), row]));
    const languagesOf = byGroup(languages);
    const speakersOf = byGroup(speakers);
    const topicsOf = byGroup(topics);
    const coverOf = new Map(covers.map((row) => [key(row.groupId), row]));
    const groupOf = new Map(groups.map((row) => [key(row.id), row]));

    return ids.flatMap((asked) => {
      const id = key(asked);
      const group = groupOf.get(id);
      if (group === undefined) return [];
      const total = totalOf.get(id);
      const cover = coverOf.get(id);
      const poster =
        cover === undefined
          ? null
          : posterOf({
              posterAssetId: cover.posterAssetId,
              posterWidth: Number(cover.posterWidth),
              posterHeight: Number(cover.posterHeight),
            });
      return [
        {
          id: group.id,
          slug: group.slug,
          kind: group.kind,
          primaryLocale: group.primaryLocale as Locale,
          labels: labelsOf(group.labels),
          updatedAt: group.updatedAt,
          videos: Number(total?.videos ?? 0),
          seconds: Number(total?.seconds ?? 0),
          firstOn: total?.firstOn ?? null,
          lastOn: total?.lastOn ?? null,
          languages: languagesOf.get(id) ?? [],
          speakers: speakersOf.get(id) ?? [],
          topics: topicsOf.get(id) ?? [],
          cover:
            cover === undefined || poster === null
              ? null
              : { videoId: cover.videoId, poster },
        },
      ];
    });
  }

  /**
   * The named published Videos as a grouping lists them, in the order given,
   * hydrated under the public predicate again — an id the ordering statement
   * returned that is no longer published simply drops.
   */
  async function episodes(
    order: readonly { readonly id: string; readonly number: number }[],
  ): Promise<GroupEpisode[]> {
    if (order.length === 0) return [];
    const rows = await db.video.findMany({
      where: { ...PUBLISHED, id: { in: order.map((entry) => entry.id) } },
      select: EPISODE_SELECT,
    });
    const byId = new Map(rows.map((row) => [key(row.id), row]));
    return order.flatMap(({ id, number }) => {
      const row = byId.get(key(id));
      return row === undefined
        ? []
        : [
            {
              id: row.id,
              slug: row.slug,
              primaryLocale: row.primaryLocale as Locale,
              availability: row.availability as VideoAvailability,
              format: row.format as VideoFormat | null,
              languageCode: row.languageCode,
              labels: labelsOf(row.labels),
              durationSeconds: row.durationSeconds,
              publishedOn: isoDate(row.publishedOn),
              poster: posterOf(row),
              speakerIds: row.speakers.map((entry) => entry.personId),
              number,
              passages: row.quranPassages.map(passageOf),
            },
          ];
    });
  }

  /**
   * ONE ORDERED STATEMENT over a grouping's published members: the page's
   * identifiers and numbers with the total. A Playlist's number is a Video's
   * place among its PUBLISHED members, so a draft between two leaves no gap.
   */
  async function ordered(
    group: MediaGroupRef,
    order: Prisma.Sql,
    offset: number,
    take: number,
  ) {
    return group.of === 'playlist'
      ? db.$queryRaw<{ id: string; number: bigint | number; total: number }[]>`
          SELECT v.[id], ROW_NUMBER() OVER (ORDER BY pv.[position], v.[id]) AS [number],
                 COUNT(*) OVER () AS [total]
          FROM [dbo].[PlaylistVideo] pv
          JOIN [dbo].[Video] v ON v.[id] = pv.[videoId] AND v.[state] = N'published'
          JOIN [dbo].[Playlist] p ON p.[id] = pv.[playlistId] AND p.[state] = N'published'
          WHERE pv.[playlistId] = ${group.id}
          ORDER BY ${order}
          OFFSET ${boundedOffset(offset)} ROWS FETCH NEXT ${take} ROWS ONLY;`
      : db.$queryRaw<{ id: string; number: bigint | number; total: number }[]>`
          SELECT v.[id], v.[seriesPosition] AS [number], COUNT(*) OVER () AS [total]
          FROM [dbo].[Video] v
          JOIN [dbo].[Series] s ON s.[id] = v.[seriesId] AND s.[state] = N'published'
          WHERE v.[state] = N'published' AND v.[seriesId] = ${group.id}
          ORDER BY ${order}
          OFFSET ${boundedOffset(offset)} ROWS FETCH NEXT ${take} ROWS ONLY;`;
  }

  /** A grouping's own order: the curated position, or the episode number. */
  const inOrder = (group: MediaGroupRef) =>
    group.of === 'playlist'
      ? Prisma.sql`pv.[position] ASC, v.[id] ASC`
      : Prisma.sql`v.[seriesPosition] ASC, v.[id] ASC`;

  const numbered = (rows: readonly { id: string; number: bigint | number }[]) =>
    rows.map((row) => ({ id: row.id, number: Number(row.number) }));

  return {
    async groupDirectory(kind) {
      const page =
        kind === 'playlist'
          ? await db.$queryRaw<{ id: string }[]>`
              SELECT TOP (${MEDIA_GROUP_DIRECTORY_MAX + 1}) p.[id]
              FROM [dbo].[Playlist] p
              OUTER APPLY (
                SELECT COUNT(*) AS [n] FROM [dbo].[PlaylistVideo] pv
                JOIN [dbo].[Video] v ON v.[id] = pv.[videoId] AND v.[state] = N'published'
                WHERE pv.[playlistId] = p.[id]
              ) c
              WHERE p.[state] = N'published'
              ORDER BY c.[n] DESC, p.[slug] ASC, p.[id] ASC;`
          : await db.$queryRaw<{ id: string }[]>`
              SELECT TOP (${MEDIA_GROUP_DIRECTORY_MAX + 1}) s.[id]
              FROM [dbo].[Series] s
              OUTER APPLY (
                SELECT COUNT(*) AS [n] FROM [dbo].[Video] v
                WHERE v.[seriesId] = s.[id] AND v.[state] = N'published'
              ) c
              WHERE s.[state] = N'published' AND s.[kind] = ${kind}
              ORDER BY c.[n] DESC, s.[slug] ASC, s.[id] ASC;`;
      const ids = page.slice(0, MEDIA_GROUP_DIRECTORY_MAX).map((row) => row.id);
      return {
        items: await entries(kind, ids),
        hasMore: page.length > MEDIA_GROUP_DIRECTORY_MAX,
      };
    },

    async groupSummary(group) {
      const kind: MediaGroupKind | null =
        group.of === 'playlist'
          ? 'playlist'
          : (((
              await db.series.findFirst({
                where: { ...PUBLISHED, id: group.id },
                select: { kind: true },
              })
            )?.kind as SeriesKind | undefined) ?? null);
      if (kind === null) return null;
      const [entry] = await entries(kind, [group.id]);
      if (entry === undefined) return null;
      const [first, latest] = await Promise.all([
        ordered(group, inOrder(group), 0, 1),
        // A Playlist's order is its meaning: it has no "latest".
        group.of === 'playlist'
          ? Promise.resolve([])
          : ordered(
              group,
              Prisma.sql`CASE WHEN v.[publishedOn] IS NULL THEN 1 ELSE 0 END, v.[publishedOn] DESC, v.[seriesPosition] DESC, v.[id] ASC`,
              0,
              1,
            ),
      ]);
      const [firstEpisode] = await episodes(numbered(first));
      const [latestEpisode] = await episodes(numbered(latest));
      return {
        entry,
        first: firstEpisode ?? null,
        latest: latestEpisode ?? null,
      };
    },

    async groupEpisodes({ group, offset, limit }) {
      const page = await ordered(group, inOrder(group), offset, limit + 1);
      const total =
        page[0] === undefined
          ? Number((await ordered(group, inOrder(group), 0, 1))[0]?.total ?? 0)
          : Number(page[0].total);
      return {
        items: await episodes(numbered(page.slice(0, limit))),
        total,
        hasMore: page.length > limit,
      };
    },

    async speakerDirectory() {
      const page = await db.$queryRaw<
        {
          id: string;
          videos: number;
          seconds: bigint | number | null;
          lastOn: string | null;
        }[]
      >`
        SELECT TOP (${MEDIA_SPEAKER_DIRECTORY_MAX + 1}) c.[personId] AS [id],
               COUNT(*) AS [videos],
               SUM(CAST(v.[durationSeconds] AS BIGINT)) AS [seconds],
               ${isoDay(Prisma.sql`MAX(v.[publishedOn])`)} AS [lastOn]
        FROM [dbo].[VideoSpeaker] c
        JOIN [dbo].[Video] v ON v.[id] = c.[videoId] AND v.[state] = N'published'
        GROUP BY c.[personId]
        ORDER BY [videos] DESC, [id] ASC;`;
      const rows = page.slice(0, MEDIA_SPEAKER_DIRECTORY_MAX);
      if (rows.length === 0) return { items: [], hasMore: false, series: [] };
      const named = Prisma.join(rows.map((row) => row.id));
      const [languages, series] = await Promise.all([
        db.$queryRaw<CountRow[]>`
          SELECT r.[groupId], r.[id], r.[videos] FROM (
            SELECT c.[personId] AS [groupId], v.[languageCode] AS [id], COUNT(*) AS [videos],
                   ROW_NUMBER() OVER (PARTITION BY c.[personId]
                                      ORDER BY COUNT(*) DESC, v.[languageCode] ASC) AS [rank]
            FROM [dbo].[VideoSpeaker] c
            JOIN [dbo].[Video] v ON v.[id] = c.[videoId] AND v.[state] = N'published'
            WHERE c.[personId] IN (${named})
            GROUP BY c.[personId], v.[languageCode]
          ) r
          WHERE r.[rank] <= ${MEDIA_GROUP_FACETS_MAX}
          ORDER BY r.[groupId], r.[rank];`,
        db.$queryRaw<(CountRow & { total: number })[]>`
          SELECT r.[groupId], r.[id], r.[videos], r.[total] FROM (
            SELECT c.[personId] AS [groupId], v.[seriesId] AS [id], COUNT(*) AS [videos],
                   COUNT(*) OVER (PARTITION BY c.[personId]) AS [total],
                   ROW_NUMBER() OVER (PARTITION BY c.[personId]
                                      ORDER BY COUNT(*) DESC, v.[seriesId] ASC) AS [rank]
            FROM [dbo].[VideoSpeaker] c
            JOIN [dbo].[Video] v ON v.[id] = c.[videoId] AND v.[state] = N'published'
            JOIN [dbo].[Series] s ON s.[id] = v.[seriesId] AND s.[state] = N'published'
            WHERE c.[personId] IN (${named})
            GROUP BY c.[personId], v.[seriesId]
          ) r
          WHERE r.[rank] <= ${MEDIA_SPEAKER_SERIES_MAX}
          ORDER BY r.[groupId], r.[rank];`,
      ]);
      const languagesOf = byGroup(languages);
      const seriesOf = byGroup(series);
      const seriesTotal = new Map(
        series.map((row) => [key(row.groupId), Number(row.total)]),
      );
      // The Series' addresses and titles, under the public predicate again.
      const seriesIds = [...new Set(series.map((row) => row.id))];
      const refs: {
        id: string;
        slug: string;
        kind: string;
        primaryLocale: string;
        labels: { locale: string; title: string; description: string }[];
      }[] = [];
      for (let start = 0; start < seriesIds.length; start += MEDIA_GROUP_DIRECTORY_MAX)
        refs.push(
          ...(await db.series.findMany({
            where: {
              ...PUBLISHED,
              id: { in: seriesIds.slice(start, start + MEDIA_GROUP_DIRECTORY_MAX) },
            },
            select: {
              id: true,
              slug: true,
              kind: true,
              primaryLocale: true,
              labels: LABELS,
            },
          })),
        );
      const published = new Set(refs.map((ref) => key(ref.id)));
      return {
        items: rows.map((row) => {
          const named = (seriesOf.get(key(row.id)) ?? []).filter((entry) =>
            published.has(key(entry.id)),
          );
          return {
            personId: row.id,
            videos: Number(row.videos),
            seconds: Number(row.seconds ?? 0),
            lastOn: row.lastOn,
            languages: languagesOf.get(key(row.id)) ?? [],
            series: named,
            seriesTotal: seriesTotal.get(key(row.id)) ?? named.length,
          };
        }),
        hasMore: page.length > MEDIA_SPEAKER_DIRECTORY_MAX,
        series: refs.map((ref) => ({
          id: ref.id,
          slug: ref.slug,
          kind: ref.kind as SeriesKind,
          primaryLocale: ref.primaryLocale as Locale,
          labels: labelsOf(ref.labels),
        })),
      };
    },
  };
}
