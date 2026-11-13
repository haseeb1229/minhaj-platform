import 'server-only';

import { randomUUID } from 'node:crypto';

import { Prisma } from '@prisma/client';

import {
  QURAN_AYAH_NUMBER_MAX,
  QURAN_TAJWEED_EXAMPLES_MAX,
  QURAN_TAJWEED_RULES,
  QURAN_TAJWEED_SPANS_MAX,
  isTajweedRule,
  type PublicAyahTajweed,
  type PublicTajweedRuleUse,
  type QuranPersistencePort,
  type QuranPublicReaderPort,
  type TajweedAyahValue,
  type TajweedOverlayRecord,
  type TajweedRule,
  type TajweedSpan,
} from '@minhaj/contracts/quran';

import { getDatabaseClient } from '../../client.ts';
import {
  activeMode,
  audit,
  authorityOf,
  ayahRange,
  BY_SLUG,
  claim,
  publication,
  publicWork,
  QuranDataError,
  refuse,
  stateOf,
  WORK_LIST,
  type Client,
  type QuranAdmission,
} from './shared.ts';

/**
 * The Quran adapter's TAJWEED COLOUR OVERLAYS (Quran Part 9; DOMAIN_MODEL.md
 * §8.9). Owned by the Quran context, hosted here, and spread into Quran's one
 * persistence port and its one public reader.
 *
 * AN OVERLAY NEVER TOUCHES THE TEXT. A recorded Ayah carries the SHA-256 of
 * the canonical text its spans were aligned to; the database checks it equals
 * the Ayah's current text when it is written (51407), and every public read
 * below compares it with `HASHBYTES('SHA2_256', Ayah.text)` again — so after
 * any canonical correction the Ayah is simply not coloured (fail closed),
 * never coloured over text its spans do not describe.
 *
 * WRITTEN ONCE. Recording a Surah's ayat inserts each Ayah not yet recorded
 * with ALL its spans, in ONE transaction under the overlay's expected version
 * with one audit entry (counts only); an Ayah already recorded is kept, never
 * edited. The runtime holds no UPDATE or DELETE on either table.
 */

const OVERLAY_SELECT = {
  id: true,
  slug: true,
  name: true,
  description: true,
  attribution: true,
  sourceId: true,
  state: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  publishedAt: true,
  source: { select: { authority: true } },
} satisfies Prisma.QuranTajweedOverlaySelect;

interface OverlayRow {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly description: string | null;
  readonly attribution: string | null;
  readonly sourceId: string | null;
  readonly state: string;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly publishedAt: Date | null;
  readonly source: { readonly authority: string } | null;
}

interface OverlayCounts {
  readonly ayahCount: number;
  readonly spanCount: number;
  readonly staleAyat: number;
  readonly rules: readonly { readonly rule: TajweedRule; readonly spans: number }[];
}

const NO_COUNTS: OverlayCounts = { ayahCount: 0, spanCount: 0, staleAyat: 0, rules: [] };

/**
 * What each of these overlays records — ayat, spans, ayat whose canonical text
 * has changed since, and spans per rule — in TWO grouped reads.
 */
async function countsOf(
  db: Client,
  ids: readonly string[],
): Promise<ReadonlyMap<string, OverlayCounts>> {
  if (ids.length === 0) return new Map();
  const [ayat, rules] = await Promise.all([
    db.$queryRaw<{ overlayId: string; ayat: number; spans: number; stale: number }[]>`
      SELECT o.[overlayId] AS [overlayId], COUNT_BIG(*) AS [ayat],
             SUM(CAST(o.[spanCount] AS BIGINT)) AS [spans],
             SUM(CASE WHEN o.[textSha256] = HASHBYTES('SHA2_256', a.[text]) THEN 0 ELSE 1 END) AS [stale]
      FROM [dbo].[QuranTajweedOverlayAyah] o
      JOIN [dbo].[Ayah] a ON a.[surahNumber] = o.[surahNumber] AND a.[ayahNumber] = o.[ayahNumber]
      WHERE o.[overlayId] IN (${Prisma.join([...ids])})
      GROUP BY o.[overlayId]`,
    db.$queryRaw<{ overlayId: string; rule: string; spans: number }[]>`
      SELECT [overlayId], [rule], COUNT_BIG(*) AS [spans]
      FROM [dbo].[QuranTajweedSpan]
      WHERE [overlayId] IN (${Prisma.join([...ids])})
      GROUP BY [overlayId], [rule]`,
  ]);
  return new Map(
    ids.map((id) => {
      const held = ayat.find((row) => row.overlayId === id);
      return [
        id,
        {
          ayahCount: Number(held?.ayat ?? 0),
          spanCount: Number(held?.spans ?? 0),
          staleAyat: Number(held?.stale ?? 0),
          rules: QURAN_TAJWEED_RULES.flatMap((rule) => {
            const row = rules.find(
              (entry) => entry.overlayId === id && entry.rule === rule,
            );
            return row === undefined ? [] : [{ rule, spans: Number(row.spans) }];
          }),
        },
      ];
    }),
  );
}

function toRecord(row: OverlayRow, counts: OverlayCounts): TajweedOverlayRecord {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    attribution: row.attribution,
    sourceId: row.sourceId,
    sourceAuthority: authorityOf(row.source),
    state: stateOf(row.state),
    version: row.version,
    ...counts,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    publishedAt: row.publishedAt,
  };
}

async function recordOf(db: Client, id: string): Promise<TajweedOverlayRecord> {
  const row = await db.quranTajweedOverlay.findUnique({
    where: { id },
    select: OVERLAY_SELECT,
  });
  if (row === null) throw new QuranDataError('conflict');
  return toRecord(row, (await countsOf(db, [id])).get(id) ?? NO_COUNTS);
}

/**
 * Inserts each named Ayah of one Surah that the overlay does not yet record,
 * with all its spans, in two set-based statements over bound JSON documents
 * (`OPENJSON`): the Ayah rows first, then their spans. An Ayah already
 * recorded is left exactly as it is. Returns how many were inserted.
 */
async function insertAyat(
  tx: Client,
  overlayId: string,
  surah: number,
  ayat: readonly TajweedAyahValue[],
): Promise<number> {
  const recorded = await tx.quranTajweedOverlayAyah.findMany({
    where: { overlayId, surahNumber: surah, ayahNumber: { in: ayat.map((a) => a.ayah) } },
    select: { ayahNumber: true },
  });
  const held = new Set(recorded.map((row) => row.ayahNumber));
  const fresh = ayat.filter((entry) => !held.has(entry.ayah));
  if (fresh.length === 0) return 0;
  const rows = JSON.stringify(
    fresh.map((entry) => ({
      ayah: entry.ayah,
      digest: entry.textSha256,
      spans: entry.spans.length,
    })),
  );
  await tx.$executeRaw`INSERT INTO [dbo].[QuranTajweedOverlayAyah] ([overlayId], [surahNumber], [ayahNumber], [textSha256], [spanCount])
    SELECT ${overlayId}, ${surah}, j.[ayah], CONVERT(BINARY(32), j.[digest], 2), j.[spans]
    FROM OPENJSON(${rows}) WITH ([ayah] INT '$.ayah', [digest] CHAR(64) '$.digest', [spans] INT '$.spans') j`;
  const spans = fresh.flatMap((entry) =>
    entry.spans.map((span, index) => ({
      ayah: entry.ayah,
      ordinal: index + 1,
      rule: span.rule,
      start: span.start,
      end: span.end,
    })),
  );
  if (spans.length > 0)
    await tx.$executeRaw`INSERT INTO [dbo].[QuranTajweedSpan] ([overlayId], [surahNumber], [ayahNumber], [ordinal], [rule], [startCodepoint], [endCodepoint])
      SELECT ${overlayId}, ${surah}, j.[ayah], j.[ordinal], j.[rule], j.[start], j.[end]
      FROM OPENJSON(${JSON.stringify(spans)}) WITH ([ayah] INT '$.ayah', [ordinal] INT '$.ordinal', [rule] NVARCHAR(32) '$.rule', [start] INT '$.start', [end] INT '$.end') j`;
  return fresh.length;
}

type TajweedPersistence = Pick<
  QuranPersistencePort,
  | 'tajweedOverlays'
  | 'tajweedOverlay'
  | 'tajweedOverlayBySlug'
  | 'createTajweedOverlay'
  | 'setTajweedOverlayState'
  | 'tajweedAyat'
  | 'saveTajweedAyat'
>;

export function tajweedOverlayPersistence(): TajweedPersistence {
  const db = getDatabaseClient();

  return {
    async tajweedOverlays() {
      const rows = await db.quranTajweedOverlay.findMany({
        select: OVERLAY_SELECT,
        orderBy: [...BY_SLUG],
        take: WORK_LIST,
      });
      const counts = await countsOf(
        db,
        rows.map((row) => row.id),
      );
      return rows.map((row) => toRecord(row, counts.get(row.id) ?? NO_COUNTS));
    },

    async tajweedOverlay(id) {
      const row = await db.quranTajweedOverlay.findUnique({
        where: { id },
        select: OVERLAY_SELECT,
      });
      return row === null
        ? null
        : toRecord(row, (await countsOf(db, [row.id])).get(row.id) ?? NO_COUNTS);
    },

    async tajweedOverlayBySlug(slug) {
      const row = await db.quranTajweedOverlay.findUnique({
        where: { slug },
        select: OVERLAY_SELECT,
      });
      return row === null
        ? null
        : toRecord(row, (await countsOf(db, [row.id])).get(row.id) ?? NO_COUNTS);
    },

    async createTajweedOverlay({ actorId, value }) {
      try {
        return await db.$transaction(async (tx) => {
          const id = randomUUID();
          await tx.quranTajweedOverlay.create({
            data: {
              id,
              slug: value.slug,
              name: value.name,
              description: value.description,
              attribution: value.attribution,
              sourceId: value.sourceId,
              state: 'draft',
              version: 1,
              updatedAt: new Date(),
            },
          });
          await audit(tx, {
            actorId,
            action: 'quran.tajweed-overlay.created',
            targetType: 'quran-tajweed-overlay',
            targetId: id,
            after: { version: '1', state: 'draft', source: value.sourceId ?? 'none' },
          });
          return recordOf(tx, id);
        });
      } catch (error) {
        refuse(error);
      }
    },

    async setTajweedOverlayState(input) {
      try {
        return await db.$transaction(async (tx) => {
          const previous = await claim(
            tx,
            'tajweed-overlay',
            input.id,
            input.expectedVersion,
            (head) =>
              publication(
                head,
                input.state,
                () =>
                  tx.quranTajweedOverlayAyah.count({ where: { overlayId: input.id } }),
                'text-required',
              ),
          );
          await audit(tx, {
            actorId: input.actorId,
            action: 'quran.tajweed-overlay.state-changed',
            targetType: 'quran-tajweed-overlay',
            targetId: input.id,
            before: { version: String(previous.version), state: previous.state },
            after: { version: String(previous.version + 1), state: input.state },
          });
          return recordOf(tx, input.id);
        });
      } catch (error) {
        refuse(error);
      }
    },

    async tajweedAyat(id, surah) {
      const rows = await db.quranTajweedOverlayAyah.findMany({
        where: { overlayId: id, surahNumber: surah },
        select: { ayahNumber: true, textSha256: true, spanCount: true },
        orderBy: [{ ayahNumber: 'asc' }],
        take: QURAN_AYAH_NUMBER_MAX,
      });
      return rows.map((row) => ({
        ayah: row.ayahNumber,
        textSha256: Buffer.from(row.textSha256).toString('hex'),
        spans: row.spanCount,
      }));
    },

    async saveTajweedAyat(input) {
      try {
        return await db.$transaction(async (tx) => {
          const previous = await claim(
            tx,
            'tajweed-overlay',
            input.id,
            input.expectedVersion,
          );
          const recorded = await insertAyat(tx, input.id, input.surah, input.ayat);
          // Which Surah and how many — never a letter of the text.
          await audit(tx, {
            actorId: input.actorId,
            action: 'quran.tajweed-overlay.ayat-recorded',
            targetType: 'quran-tajweed-overlay',
            targetId: input.id,
            before: { version: String(previous.version) },
            after: {
              version: String(previous.version + 1),
              surah: String(input.surah),
              recorded: String(recorded),
              kept: String(input.ayat.length - recorded),
            },
          });
          return {
            recorded,
            kept: input.ayat.length - recorded,
            overlay: await recordOf(tx, input.id),
          };
        });
      } catch (error) {
        refuse(error);
      }
    },
  };
}

/* ===========================================================================
 * Public reads
 * ========================================================================= */

/** A recorded rule name, or a refusal: the database CHECKs the same list. */
function ruleOf(value: string): TajweedRule {
  if (!isTajweedRule(value)) throw new QuranDataError('invalid');
  return value;
}

type TajweedReader = Pick<
  QuranPublicReaderPort,
  'tajweedOverlays' | 'tajweedSpans' | 'tajweedRuleUses'
>;

export function tajweedOverlayReader(admission: QuranAdmission): TajweedReader {
  const db = getDatabaseClient();

  /** The overlay, if it is public now; nothing at all otherwise. */
  async function publicOverlay(id: string): Promise<boolean> {
    const mode = await activeMode(db, admission);
    if (mode === null) return false;
    const row = await db.quranTajweedOverlay.findFirst({
      where: { id, ...publicWork(mode) },
      select: { id: true },
    });
    return row !== null;
  }

  return {
    async tajweedOverlays() {
      const mode = await activeMode(db, admission);
      if (mode === null) return [];
      const rows = await db.quranTajweedOverlay.findMany({
        where: publicWork(mode),
        select: {
          id: true,
          slug: true,
          name: true,
          description: true,
          attribution: true,
          publishedAt: true,
        },
        orderBy: [...BY_SLUG],
        take: WORK_LIST,
      });
      return rows.flatMap((row) =>
        row.publishedAt === null ? [] : [{ ...row, publishedAt: row.publishedAt }],
      );
    },

    /**
     * ONE bounded read of a range's spans, joined to the canonical Ayah: an
     * Ayah whose text no longer hashes to the recorded digest yields nothing.
     */
    async tajweedSpans(overlayId, surah, from, to) {
      if (!(await publicOverlay(overlayId))) return [];
      const range = ayahRange(from, to);
      const rows = await db.$queryRaw<
        { ayah: number; rule: string; start: number; end: number }[]
      >`SELECT TOP (${QURAN_AYAH_NUMBER_MAX * QURAN_TAJWEED_SPANS_MAX})
               s.[ayahNumber] AS [ayah], s.[rule] AS [rule],
               s.[startCodepoint] AS [start], s.[endCodepoint] AS [end]
        FROM [dbo].[QuranTajweedSpan] s
        JOIN [dbo].[QuranTajweedOverlayAyah] o ON o.[overlayId] = s.[overlayId]
          AND o.[surahNumber] = s.[surahNumber] AND o.[ayahNumber] = s.[ayahNumber]
        JOIN [dbo].[Ayah] a ON a.[surahNumber] = o.[surahNumber] AND a.[ayahNumber] = o.[ayahNumber]
        WHERE s.[overlayId] = ${overlayId} AND s.[surahNumber] = ${surah}
          AND s.[ayahNumber] BETWEEN ${range.gte} AND ${range.lte}
          AND o.[textSha256] = HASHBYTES('SHA2_256', a.[text])
        ORDER BY s.[ayahNumber], s.[ordinal]`;
      const grouped: { ayah: number; spans: TajweedSpan[] }[] = [];
      for (const row of rows) {
        const span = { rule: ruleOf(row.rule), start: row.start, end: row.end };
        const last = grouped.at(-1);
        if (last?.ayah === row.ayah) last.spans.push(span);
        else grouped.push({ ayah: row.ayah, spans: [span] });
      }
      return grouped satisfies readonly PublicAyahTajweed[];
    },

    /**
     * Three bounded reads over the CURRENT ayat (their text still hashing to
     * the recorded digest): how many there are; each rule's ayat and spans with
     * its shortest examples, one per distinct text; and those examples' text
     * and that rule's spans.
     */
    async tajweedRuleUses(overlayId, perRule, rule) {
      if (!(await publicOverlay(overlayId))) return { ayat: 0, rules: [] };
      const take = Math.min(
        QURAN_TAJWEED_EXAMPLES_MAX,
        Math.max(0, Math.trunc(perRule) || 0),
      );
      const only = rule === null ? Prisma.empty : Prisma.sql`AND s.[rule] = ${rule}`;
      const current = Prisma.sql`
        SELECT o.[surahNumber], o.[ayahNumber], o.[textSha256], DATALENGTH(a.[text]) AS [size]
        FROM [dbo].[QuranTajweedOverlayAyah] o
        JOIN [dbo].[Ayah] a ON a.[surahNumber] = o.[surahNumber] AND a.[ayahNumber] = o.[ayahNumber]
        WHERE o.[overlayId] = ${overlayId} AND o.[textSha256] = HASHBYTES('SHA2_256', a.[text])`;
      const [[total], uses] = await Promise.all([
        db.$queryRaw<
          { ayat: number }[]
        >`SELECT COUNT_BIG(*) AS [ayat] FROM (${current}) c`,
        db.$queryRaw<
          {
            rule: string;
            surah: number;
            ayah: number;
            ayat: number;
            spans: number;
            place: number;
          }[]
        >`WITH [current] AS (${current}),
          [used] AS (
            SELECT s.[rule], c.[surahNumber], c.[ayahNumber], c.[size], c.[textSha256],
                   COUNT_BIG(*) AS [spans]
            FROM [dbo].[QuranTajweedSpan] s
            JOIN [current] c ON c.[surahNumber] = s.[surahNumber] AND c.[ayahNumber] = s.[ayahNumber]
            WHERE s.[overlayId] = ${overlayId} ${only}
            GROUP BY s.[rule], c.[surahNumber], c.[ayahNumber], c.[size], c.[textSha256]),
          [ranked] AS (
            SELECT u.*,
                   COUNT_BIG(*) OVER (PARTITION BY u.[rule]) AS [ayat],
                   SUM(u.[spans]) OVER (PARTITION BY u.[rule]) AS [total],
                   ROW_NUMBER() OVER (PARTITION BY u.[rule], u.[textSha256]
                     ORDER BY u.[surahNumber], u.[ayahNumber]) AS [copy]
            FROM [used] u),
          [examples] AS (
            SELECT r.*, ROW_NUMBER() OVER (PARTITION BY r.[rule], r.[copy]
                     ORDER BY r.[size], r.[surahNumber], r.[ayahNumber]) AS [place]
            FROM [ranked] r)
          SELECT e.[rule], e.[surahNumber] AS [surah], e.[ayahNumber] AS [ayah],
                 e.[ayat], e.[total] AS [spans], e.[place]
          FROM [examples] e
          WHERE e.[copy] = 1 AND e.[place] <= ${Math.max(1, take)}
          ORDER BY e.[rule], e.[place]`,
      ]);
      const picked = take === 0 ? [] : uses;
      const cited = [
        ...new Set(picked.map((row) => `${String(row.surah)}:${String(row.ayah)}`)),
      ];
      const details =
        cited.length === 0
          ? []
          : await db.$queryRaw<
              {
                surah: number;
                ayah: number;
                text: string;
                rule: string;
                start: number;
                end: number;
              }[]
            >`SELECT a.[surahNumber] AS [surah], a.[ayahNumber] AS [ayah], a.[text] AS [text],
                     s.[rule] AS [rule], s.[startCodepoint] AS [start], s.[endCodepoint] AS [end]
              FROM [dbo].[QuranTajweedSpan] s
              JOIN [dbo].[Ayah] a ON a.[surahNumber] = s.[surahNumber] AND a.[ayahNumber] = s.[ayahNumber]
              WHERE s.[overlayId] = ${overlayId}
                AND CONCAT(s.[surahNumber], N':', s.[ayahNumber]) IN (${Prisma.join(cited)})
              ORDER BY s.[surahNumber], s.[ayahNumber], s.[ordinal]`;
      const rules: PublicTajweedRuleUse[] = QURAN_TAJWEED_RULES.flatMap((name) => {
        const mine = uses.filter((row) => row.rule === name);
        const first = mine[0];
        if (first === undefined) return [];
        return [
          {
            rule: name,
            ayat: Number(first.ayat),
            spans: Number(first.spans),
            examples: (take === 0 ? [] : mine).map((row) => {
              const spans = details.filter(
                (detail) =>
                  detail.surah === row.surah &&
                  detail.ayah === row.ayah &&
                  detail.rule === name,
              );
              return {
                surah: row.surah,
                ayah: row.ayah,
                text: spans[0]?.text ?? '',
                spans: spans.map((detail) => ({
                  rule: name,
                  start: detail.start,
                  end: detail.end,
                })),
              };
            }),
          },
        ];
      });
      return { ayat: Number(total?.ayat ?? 0), rules };
    },
  };
}
