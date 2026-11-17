import 'server-only';

import { Prisma } from '@prisma/client';

import type { Locale } from '@minhaj/contracts';
import {
  AUDIO_SERIES_DIRECTORY_MAX,
  AUDIO_SERIES_FACETS_MAX,
  MEDIA_FACET_PAGE,
  TOPIC_VIDEO_LENGTHS,
  type AudioCount,
  type AudioListingQuery,
  type AudioListingTrack,
  type AudioSeriesEntry,
  type MediaPublicReaderPort,
  type TopicVideoLength,
} from '@minhaj/contracts/media';

import { getDatabaseClient } from '../../client.ts';
import { IN_SERIES, LISTING_SELECT, toListing } from './audio.ts';
import { boundedOffset, LABELS, labelsOf, PUBLISHED } from './shared.ts';

/**
 * WATCH PART 3 — LISTEN's public reads (DOMAIN_MODEL.md §8.1, §11): the audio
 * lectures listing and its aggregates (`audioListing`, `audioListingFacets`),
 * the audio series' directory and summaries (`audioSeriesDirectory`,
 * `audioSeriesSummary`) and a track's place in its series
 * (`audioSeriesNeighbours`). Spread into Media's ONE public reader, typed by
 * Media's own port; nothing here leaves the adapter but those five answers.
 *
 * THE ORDINARY PUBLIC PREDICATE, IN EVERY STATEMENT. A track is listed,
 * counted or summed only while published; an AudioSeries is named, filtered by
 * or counted only while it is itself published. Every value is a bound
 * parameter.
 *
 * TWO READS, THE SECOND AUTHORITATIVE. An ordering or aggregate statement
 * returns identifiers; the rows a page shows are loaded again under the public
 * predicate, so an error in the first could only drop a record, never admit
 * one. A fixed number of statements, whatever the count.
 */

/** A SQL `date` as the `YYYY-MM-DD` it is, converted in SQL — never shifted by a zone. */
const isoDay = (column: Prisma.Sql) => Prisma.sql`CONVERT(char(10), ${column}, 23)`;

/** Stored identifiers keep their case while SQL Server compares without it: maps key in lower case. */
const key = (id: string) => id.toLowerCase();

/** Which of a view's filters a statement applies. */
interface Use {
  readonly topic: boolean;
  readonly language: boolean;
  readonly speaker: boolean;
  readonly series: boolean;
  readonly length: boolean;
}

const EVERY_FILTER: Use = {
  topic: true,
  language: true,
  speaker: true,
  series: true,
  length: true,
};

/**
 * THE LISTING'S SET, as SQL over `[dbo].[AudioTrack] a`: the ONE public
 * predicate (published) and whichever of the view's filters `use` names — a
 * series only while it is itself published, a length by the contract's bands.
 */
function listingWhere(q: AudioListingQuery, use: Use): Prisma.Sql {
  const conditions = [Prisma.sql`a.[state] = N'published'`];
  if (use.topic && q.topic !== null)
    conditions.push(
      Prisma.sql`EXISTS (SELECT 1 FROM [dbo].[AudioTrackTopic] o WHERE o.[trackId] = a.[id] AND o.[topicId] = ${q.topic})`,
    );
  if (use.language && q.language !== null)
    conditions.push(Prisma.sql`a.[languageCode] = ${q.language}`);
  if (use.speaker && q.speaker !== null)
    conditions.push(
      Prisma.sql`EXISTS (SELECT 1 FROM [dbo].[AudioTrackSpeaker] c WHERE c.[trackId] = a.[id] AND c.[personId] = ${q.speaker})`,
    );
  if (use.series && q.series !== null)
    conditions.push(
      Prisma.sql`a.[seriesId] = ${q.series} AND EXISTS (SELECT 1 FROM [dbo].[AudioSeries] r WHERE r.[id] = a.[seriesId] AND r.[state] = N'published')`,
    );
  if (use.length && q.length !== null) {
    const band = TOPIC_VIDEO_LENGTHS[q.length];
    conditions.push(Prisma.sql`a.[durationSeconds] BETWEEN ${band.from} AND ${band.to}`);
  }
  return Prisma.join(conditions, ' AND ');
}

/** A recorded running time's band, as SQL — the contract's bounds, bound. */
const LENGTH_BAND = Prisma.sql`CASE
  WHEN a.[durationSeconds] BETWEEN ${TOPIC_VIDEO_LENGTHS.short.from} AND ${TOPIC_VIDEO_LENGTHS.short.to} THEN N'short'
  WHEN a.[durationSeconds] BETWEEN ${TOPIC_VIDEO_LENGTHS.medium.from} AND ${TOPIC_VIDEO_LENGTHS.medium.to} THEN N'medium'
  WHEN a.[durationSeconds] BETWEEN ${TOPIC_VIDEO_LENGTHS.long.from} AND ${TOPIC_VIDEO_LENGTHS.long.to} THEN N'long'
END`;

const LENGTH_ORDER = Object.keys(TOPIC_VIDEO_LENGTHS) as TopicVideoLength[];

/** An AudioSeries' address and titles, as a facet or a listed track names it. */
const SERIES_REF_SELECT = {
  id: true,
  slug: true,
  primaryLocale: true,
  labels: LABELS,
} satisfies Prisma.AudioSeriesSelect;

interface CountRow {
  readonly groupId: string;
  readonly id: string;
  readonly tracks: number;
}

/** Grouped rows as each series' commonest values, in the read's order. */
function bySeries(rows: readonly CountRow[]): Map<string, AudioCount[]> {
  const out = new Map<string, AudioCount[]>();
  for (const row of rows) {
    const list = out.get(key(row.groupId)) ?? [];
    list.push({ id: row.id, tracks: Number(row.tracks) });
    out.set(key(row.groupId), list);
  }
  return out;
}

type ListenReader = Pick<
  MediaPublicReaderPort,
  | 'audioListing'
  | 'audioListingFacets'
  | 'audioSeriesDirectory'
  | 'audioSeriesSummary'
  | 'audioSeriesNeighbours'
>;

export function listenPublicReader(): ListenReader {
  const db = getDatabaseClient();

  /** How many published tracks a set holds. */
  async function count(where: Prisma.Sql): Promise<number> {
    const [row] = await db.$queryRaw<{ tracks: number }[]>`
      SELECT COUNT(*) AS [tracks] FROM [dbo].[AudioTrack] a WHERE ${where};`;
    return Number(row?.tracks ?? 0);
  }

  /**
   * The entries of the named published AudioSeries, in the order given: four
   * grouped statements over their PUBLISHED tracks, then the series themselves
   * under the public predicate again.
   */
  async function entries(ids: readonly string[]): Promise<AudioSeriesEntry[]> {
    if (ids.length === 0) return [];
    const named = Prisma.join([...ids]);
    const members = Prisma.sql`SELECT a.[seriesId] AS [groupId], a.[id] AS [trackId]
      FROM [dbo].[AudioTrack] a
      JOIN [dbo].[AudioSeries] s ON s.[id] = a.[seriesId] AND s.[state] = N'published'
      WHERE a.[state] = N'published' AND a.[seriesId] IN (${named})`;
    const facet = (column: Prisma.Sql, from: Prisma.Sql) => db.$queryRaw<CountRow[]>`
      SELECT r.[groupId], r.[id], r.[tracks] FROM (
        SELECT m.[groupId], ${column} AS [id], COUNT(DISTINCT m.[trackId]) AS [tracks],
               ROW_NUMBER() OVER (PARTITION BY m.[groupId]
                                  ORDER BY COUNT(DISTINCT m.[trackId]) DESC, ${column} ASC) AS [rank]
        FROM (${members}) m ${from}
        GROUP BY m.[groupId], ${column}
      ) r
      WHERE r.[rank] <= ${AUDIO_SERIES_FACETS_MAX}
      ORDER BY r.[groupId], r.[rank];`;
    const [totals, languages, speakers, topics, series] = await Promise.all([
      db.$queryRaw<
        {
          groupId: string;
          tracks: number;
          seconds: bigint | number | null;
          firstOn: string | null;
          lastOn: string | null;
        }[]
      >`
        SELECT m.[groupId], COUNT(*) AS [tracks],
               SUM(CAST(a.[durationSeconds] AS BIGINT)) AS [seconds],
               ${isoDay(Prisma.sql`MIN(a.[recordedOn])`)} AS [firstOn],
               ${isoDay(Prisma.sql`MAX(a.[recordedOn])`)} AS [lastOn]
        FROM (${members}) m JOIN [dbo].[AudioTrack] a ON a.[id] = m.[trackId]
        GROUP BY m.[groupId];`,
      facet(
        Prisma.sql`a.[languageCode]`,
        Prisma.sql`JOIN [dbo].[AudioTrack] a ON a.[id] = m.[trackId]`,
      ),
      facet(
        Prisma.sql`c.[personId]`,
        Prisma.sql`JOIN [dbo].[AudioTrackSpeaker] c ON c.[trackId] = m.[trackId]`,
      ),
      facet(
        Prisma.sql`o.[topicId]`,
        Prisma.sql`JOIN [dbo].[AudioTrackTopic] o ON o.[trackId] = m.[trackId]`,
      ),
      db.audioSeries.findMany({
        where: { ...PUBLISHED, id: { in: [...ids] } },
        select: { ...SERIES_REF_SELECT, updatedAt: true },
      }),
    ]);
    const totalOf = new Map(totals.map((row) => [key(row.groupId), row]));
    const languagesOf = bySeries(languages);
    const speakersOf = bySeries(speakers);
    const topicsOf = bySeries(topics);
    const seriesOf = new Map(series.map((row) => [key(row.id), row]));

    return ids.flatMap((asked) => {
      const id = key(asked);
      const row = seriesOf.get(id);
      if (row === undefined) return [];
      const total = totalOf.get(id);
      return [
        {
          id: row.id,
          slug: row.slug,
          primaryLocale: row.primaryLocale as Locale,
          labels: labelsOf(row.labels),
          updatedAt: row.updatedAt,
          tracks: Number(total?.tracks ?? 0),
          seconds: Number(total?.seconds ?? 0),
          firstOn: total?.firstOn ?? null,
          lastOn: total?.lastOn ?? null,
          languages: languagesOf.get(id) ?? [],
          speakers: speakersOf.get(id) ?? [],
          topics: topicsOf.get(id) ?? [],
        },
      ];
    });
  }

  return {
    async audioListing(q) {
      const where = listingWhere(q, EVERY_FILTER);
      const order =
        q.sort === 'title'
          ? Prisma.sql`t.[title] ASC, a.[id] ASC`
          : // Most recently recorded first; an undated track after every dated one.
            Prisma.sql`CASE WHEN a.[recordedOn] IS NULL THEN 1 ELSE 0 END, a.[recordedOn] DESC, t.[title] ASC, a.[id] ASC`;
      const page = await db.$queryRaw<{ id: string; total: number }[]>`
        SELECT a.[id], COUNT(*) OVER () AS [total]
        FROM [dbo].[AudioTrack] a
        OUTER APPLY (
          SELECT TOP (1) l.[title] FROM [dbo].[AudioTrackLabel] l
          WHERE l.[trackId] = a.[id]
          ORDER BY CASE WHEN l.[locale] = ${q.titleLocale} THEN 0
                        WHEN l.[locale] = a.[primaryLocale] THEN 1 ELSE 2 END, l.[locale]
        ) t
        WHERE ${where}
        ORDER BY ${order}
        OFFSET ${boundedOffset(q.offset)} ROWS FETCH NEXT ${q.limit + 1} ROWS ONLY;`;

      // Past the end there is no row to carry the total; it is counted alone.
      const total =
        page[0] === undefined
          ? q.offset === 0
            ? 0
            : await count(where)
          : Number(page[0].total);
      const ids = page.slice(0, q.limit).map((row) => row.id);
      if (ids.length === 0) return { items: [], total, hasMore: false };

      const rows = await db.audioTrack.findMany({
        where: { ...PUBLISHED, id: { in: ids } },
        select: {
          ...LISTING_SELECT,
          series: { select: { ...SERIES_REF_SELECT, state: true } },
        },
      });
      const byId = new Map(rows.map((row) => [key(row.id), row]));
      const items: AudioListingTrack[] = ids.flatMap((id) => {
        const row = byId.get(key(id));
        if (row === undefined) return [];
        return [
          {
            ...toListing(row),
            // A series is named only while it is itself published.
            series:
              row.series === null ||
              row.seriesPosition === null ||
              row.series.state !== 'published'
                ? null
                : {
                    id: row.series.id,
                    slug: row.series.slug,
                    primaryLocale: row.series.primaryLocale as Locale,
                    labels: labelsOf(row.series.labels),
                    position: row.seriesPosition,
                  },
          },
        ];
      });
      return { items, total, hasMore: page.length > q.limit };
    },

    /**
     * GROUPED READS, each bounded: a facet's own filter is left out of its own
     * counts, so every option says how many tracks choosing it would show.
     */
    async audioListingFacets(q) {
      const except = (omit: keyof Use) =>
        listingWhere(q, { ...EVERY_FILTER, [omit]: false });
      const whole = Prisma.sql`a.[state] = N'published'`;
      const [all, languages, speakers, topics, series, lengths] = await Promise.all([
        db.$queryRaw<
          { tracks: number; seconds: bigint | number | null; languages: number }[]
        >`
          SELECT COUNT(*) AS [tracks], SUM(CAST(a.[durationSeconds] AS BIGINT)) AS [seconds],
                 COUNT(DISTINCT a.[languageCode]) AS [languages]
          FROM [dbo].[AudioTrack] a
          WHERE ${whole};`,
        db.$queryRaw<{ id: string; count: number }[]>`
          SELECT TOP (${MEDIA_FACET_PAGE + 1}) a.[languageCode] AS [id], COUNT(*) AS [count]
          FROM [dbo].[AudioTrack] a
          WHERE ${except('language')}
          GROUP BY a.[languageCode]
          ORDER BY [count] DESC, [id] ASC;`,
        db.$queryRaw<{ id: string; count: number }[]>`
          SELECT TOP (${MEDIA_FACET_PAGE + 1}) c.[personId] AS [id], COUNT(DISTINCT c.[trackId]) AS [count]
          FROM [dbo].[AudioTrackSpeaker] c
          WHERE c.[trackId] IN (SELECT a.[id] FROM [dbo].[AudioTrack] a WHERE ${except('speaker')})
          GROUP BY c.[personId]
          ORDER BY [count] DESC, [id] ASC;`,
        db.$queryRaw<{ id: string; count: number }[]>`
          SELECT TOP (${MEDIA_FACET_PAGE + 1}) o.[topicId] AS [id], COUNT(DISTINCT o.[trackId]) AS [count]
          FROM [dbo].[AudioTrackTopic] o
          WHERE o.[trackId] IN (SELECT a.[id] FROM [dbo].[AudioTrack] a WHERE ${except('topic')})
          GROUP BY o.[topicId]
          ORDER BY [count] DESC, [id] ASC;`,
        db.$queryRaw<{ id: string; count: number }[]>`
          SELECT TOP (${MEDIA_FACET_PAGE + 1}) a.[seriesId] AS [id], COUNT(*) AS [count]
          FROM [dbo].[AudioTrack] a
          WHERE ${except('series')}
            AND a.[seriesId] IS NOT NULL
            AND EXISTS (SELECT 1 FROM [dbo].[AudioSeries] r WHERE r.[id] = a.[seriesId] AND r.[state] = N'published')
          GROUP BY a.[seriesId]
          ORDER BY [count] DESC, [id] ASC;`,
        db.$queryRaw<{ length: string; count: number }[]>`
          SELECT b.[length], COUNT(*) AS [count]
          FROM (SELECT ${LENGTH_BAND} AS [length]
                FROM [dbo].[AudioTrack] a
                WHERE ${except('length')}) b
          WHERE b.[length] IS NOT NULL
          GROUP BY b.[length];`,
      ]);

      const facet = (rows: readonly { id: string; count: number }[]) => ({
        items: rows
          .slice(0, MEDIA_FACET_PAGE)
          .map((row) => ({ id: row.id, tracks: Number(row.count) })),
        hasMore: rows.length > MEDIA_FACET_PAGE,
      });
      const seriesFacet = facet(series);
      // The series' addresses and titles, under the public predicate again.
      const seriesRows =
        seriesFacet.items.length === 0
          ? []
          : await db.audioSeries.findMany({
              where: { ...PUBLISHED, id: { in: seriesFacet.items.map((row) => row.id) } },
              select: SERIES_REF_SELECT,
            });
      const seriesById = new Map(seriesRows.map((row) => [key(row.id), row]));
      const byLength = new Map(lengths.map((row) => [row.length, Number(row.count)]));

      return {
        all: {
          tracks: Number(all[0]?.tracks ?? 0),
          seconds: Number(all[0]?.seconds ?? 0),
          languages: Number(all[0]?.languages ?? 0),
        },
        topics: facet(topics),
        languages: facet(languages),
        speakers: facet(speakers),
        series: {
          items: seriesFacet.items.flatMap((row) => {
            const found = seriesById.get(key(row.id));
            return found === undefined
              ? []
              : [
                  {
                    id: found.id,
                    slug: found.slug,
                    primaryLocale: found.primaryLocale as Locale,
                    labels: labelsOf(found.labels),
                    tracks: row.tracks,
                  },
                ];
          }),
          hasMore: seriesFacet.hasMore,
        },
        lengths: LENGTH_ORDER.flatMap((length) => {
          const tracks = byLength.get(length) ?? 0;
          return tracks === 0 ? [] : [{ length, tracks }];
        }),
      };
    },

    async audioSeriesDirectory() {
      const page = await db.$queryRaw<{ id: string }[]>`
        SELECT TOP (${AUDIO_SERIES_DIRECTORY_MAX + 1}) s.[id]
        FROM [dbo].[AudioSeries] s
        OUTER APPLY (
          SELECT COUNT(*) AS [n] FROM [dbo].[AudioTrack] a
          WHERE a.[seriesId] = s.[id] AND a.[state] = N'published'
        ) c
        WHERE s.[state] = N'published'
        ORDER BY c.[n] DESC, s.[slug] ASC, s.[id] ASC;`;
      const ids = page.slice(0, AUDIO_SERIES_DIRECTORY_MAX).map((row) => row.id);
      return {
        items: await entries(ids),
        hasMore: page.length > AUDIO_SERIES_DIRECTORY_MAX,
      };
    },

    async audioSeriesSummary(seriesId) {
      const [entry] = await entries([seriesId]);
      if (entry === undefined) return null;
      const tracks = { seriesId, ...PUBLISHED, series: PUBLISHED };
      const [first, latest] = await Promise.all([
        db.audioTrack.findFirst({
          where: tracks,
          select: LISTING_SELECT,
          orderBy: [...IN_SERIES],
        }),
        // SQL Server sorts NULL lowest, so a descending date puts an undated
        // track after every dated one; then the highest place.
        db.audioTrack.findFirst({
          where: tracks,
          select: LISTING_SELECT,
          orderBy: [{ recordedOn: 'desc' }, { seriesPosition: 'desc' }, { id: 'asc' }],
        }),
      ]);
      return {
        entry,
        first: first === null ? null : toListing(first),
        latest: latest === null ? null : toListing(latest),
      };
    },

    /**
     * A track's place is unique within its series (a filtered unique index), so
     * "just before" and "just after" are exact; a draft between is skipped.
     */
    async audioSeriesNeighbours({ series, position }) {
      const tracks = { seriesId: series, ...PUBLISHED, series: PUBLISHED };
      const [previous, next, total] = await Promise.all([
        db.audioTrack.findFirst({
          where: { ...tracks, seriesPosition: { lt: position } },
          select: LISTING_SELECT,
          orderBy: [{ seriesPosition: 'desc' }, { id: 'desc' }],
        }),
        db.audioTrack.findFirst({
          where: { ...tracks, seriesPosition: { gt: position } },
          select: LISTING_SELECT,
          orderBy: [...IN_SERIES],
        }),
        db.audioTrack.count({ where: tracks }),
      ]);
      return {
        previous: previous === null ? null : toListing(previous),
        next: next === null ? null : toListing(next),
        tracks: total,
      };
    },
  };
}
