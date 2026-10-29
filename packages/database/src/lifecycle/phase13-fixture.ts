import 'server-only';

import { deepStrictEqual } from 'node:assert';
import { randomUUID } from 'node:crypto';

import type { SqlSession } from './sql-connection.ts';

/**
 * The News families that carry a reader-facing chronology (Phase 30-R): a
 * published one records it with its first publication, as the workflow does.
 */
const CHRONOLOGICAL: ReadonlySet<string> = new Set(['NewsArticle', 'PressRelease']);

/**
 * POPULATED PHASE-13 STATE for the recovery rehearsals.
 *
 * WHAT THE RECOVERY FIXTURE PROVES THAT A SCHEMA CHECK DOES NOT. That Editorial's
 * four News families came back with their WORKFLOW, HISTORY and RELATIONSHIPS:
 *
 *   - one published record of EACH family, renamed once, so two immutable
 *     revisions and two permanent slug reservations must return, with the
 *     approval of the exact current revision by someone other than its author;
 *   - Urdu and English translations, a typed Topic and a typed Person on the
 *     current revision;
 *   - a Statement's issuer in each translation, and a MediaCoverage record's
 *     outlet, HTTPS source and date;
 *   - an ARCHIVED NewsArticle, which a rebuilt index must never answer with;
 *   - a SCHEDULED press release with its pending schedule bound to its revision;
 *   - the durable search intent still owed for every published record.
 *
 * EVERYTHING IS SYNTHETIC: no real organisation, authority, outlet or event is
 * named, and every address is `.invalid`.
 */

export type Phase13Family =
  'NewsArticle' | 'PressRelease' | 'Statement' | 'MediaCoverage';

export const PHASE13_FAMILIES: readonly Phase13Family[] = [
  'NewsArticle',
  'PressRelease',
  'Statement',
  'MediaCoverage',
];

/** The Search scope kind of each family's table. */
export const PHASE13_KIND: Readonly<Record<Phase13Family, string>> = {
  NewsArticle: 'news-article',
  PressRelease: 'press-release',
  Statement: 'statement',
  MediaCoverage: 'media-coverage',
};

export interface Phase13Fixture {
  readonly runId: string;
  readonly ids: Readonly<Record<Phase13Family, string>>;
  readonly archivedId: string;
  readonly scheduledId: string;
}

export function newPhase13Fixture(): Phase13Fixture {
  return {
    runId: randomUUID().replaceAll('-', ''),
    ids: {
      NewsArticle: randomUUID(),
      PressRelease: randomUUID(),
      Statement: randomUUID(),
      MediaCoverage: randomUUID(),
    },
    archivedId: randomUUID(),
    scheduledId: randomUUID(),
  };
}

/** The former and current slug of a family's published record. */
export function phase13Slugs(
  fixture: Phase13Fixture,
  family: Phase13Family,
): { readonly original: string; readonly current: string } {
  const stem = `${PHASE13_KIND[family]}-${fixture.runId.slice(0, 12)}`;
  return { original: `${stem}-original`, current: `${stem}-current` };
}

/** The words a rebuilt index must — and must not — answer to. */
export const PHASE13_RECOVERY_WORDS = Object.freeze({
  published: 'marlowgatefixture',
  archived: 'sedgecombefixture',
});

const TEXT = {
  titleUr: 'بحالی کے ثبوت کی آزمائشی خبر',
  issuerEn: 'Synthetic Recovery Office',
  issuerUr: 'آزمائشی بحالی دفتر',
  outlet: 'Synthetic Recovery Outlet',
  source: 'https://recovery-outlet.example.invalid/coverage',
} as const;

function assertSafe(fixture: Phase13Fixture): void {
  if (!/^[0-9a-f]{32}$/.test(fixture.runId))
    throw new Error('Phase-13 fixture runId does not match the expected pattern.');
  for (const id of [
    ...Object.values(fixture.ids),
    fixture.archivedId,
    fixture.scheduledId,
  ])
    if (!/^[0-9a-f-]{36}$/.test(id))
      throw new Error('Invalid synthetic Phase-13 fixture identifier.');
}

const document = (text: string) =>
  JSON.stringify({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  });

/**
 * One revision of one record: its row, its translations and — on the current
 * revision — its typed Topic and Person. Written in the order the append and
 * sequence triggers require, so the database's own invariants are exercised.
 */
async function writeRevision(
  sql: SqlSession,
  family: Phase13Family,
  id: string,
  number: number,
  slug: string,
  authorId: string,
  translations: readonly {
    readonly language: 'en' | 'ur';
    readonly title: string;
    readonly issuer?: string;
  }[],
  references: { readonly personId: string; readonly topicId: string } | null,
): Promise<void> {
  const coverage =
    family === 'MediaCoverage'
      ? {
          columns: ',[outletName],[sourceUrl],[sourcePublishedOn]',
          values: `,N'${TEXT.outlet}',N'${TEXT.source}','2032-07-08'`,
        }
      : { columns: '', values: '' };
  await sql.query(
    `INSERT INTO [dbo].[${family}SlugHistory] ([ownerId],[slug]) VALUES (N'${id}',N'${slug}');
     INSERT INTO [dbo].[${family}Revision] ([ownerId],[number],[editorId],[slug],[primaryLanguage]${coverage.columns})
       VALUES (N'${id}',${number},N'${authorId}',N'${slug}',N'en'${coverage.values});`,
  );
  for (const translation of translations) {
    const body = document(`${translation.title} — synthetic recovery body.`);
    const issuer = family === 'Statement' ? ',[issuer]' : '';
    const issuerValue = family === 'Statement' ? `,N'${translation.issuer ?? ''}'` : '';
    await sql.query(
      `INSERT INTO [dbo].[${family}RevisionTranslation] ([ownerId],[revisionNumber],[languageCode],[title],[excerpt],[seoTitle],[seoDescription],[document],[html]${issuer})
       VALUES (N'${id}',${number},N'${translation.language}',N'${translation.title}',N'Synthetic fixture',N'',N'',N'${body}',N'<p>${translation.title}</p>'${issuerValue});`,
    );
  }
  if (references !== null)
    await sql.query(
      `INSERT INTO [dbo].[${family}Topic] ([ownerId],[revisionNumber],[topicId]) VALUES (N'${id}',${number},N'${references.topicId}');
       INSERT INTO [dbo].[${family}Contributor] ([ownerId],[revisionNumber],[personId],[role],[position]) VALUES (N'${id}',${number},N'${references.personId}',N'author',0);`,
    );
  await sql.query(
    `UPDATE [dbo].[${family}] SET [slug]=N'${slug}',[currentRevision]=${number},[version]=${number} WHERE [id]=N'${id}';`,
  );
}

/**
 * Writes the populated Phase-13 state into the SOURCE database, before backup,
 * with the migration principal, so every constraint and trigger is exercised.
 */
export async function writePhase13Fixture(
  sql: SqlSession,
  fixture: Phase13Fixture,
  references: {
    readonly authorId: string;
    readonly reviewerId: string;
    readonly personId: string;
    readonly topicId: string;
  },
): Promise<void> {
  assertSafe(fixture);
  for (const value of Object.values(references))
    if (!/^[a-z0-9-]{1,36}$/i.test(value))
      throw new Error('Invalid synthetic Phase-13 fixture reference.');
  const { authorId, reviewerId } = references;
  const w = PHASE13_RECOVERY_WORDS;

  for (const family of PHASE13_FAMILIES) {
    const id = fixture.ids[family];
    const slugs = phase13Slugs(fixture, family);
    await sql.query(
      `INSERT INTO [dbo].[${family}] ([id],[slug],[state],[version],[creatorId],[updatedAt]) VALUES (N'${id}',N'${slugs.original}',N'draft',1,N'${authorId}',SYSUTCDATETIME());`,
    );
    const issuer = { issuer: TEXT.issuerEn };
    await writeRevision(
      sql,
      family,
      id,
      1,
      slugs.original,
      authorId,
      [{ language: 'en', title: `Synthetic first draft ${w.published}`, ...issuer }],
      null,
    );
    await writeRevision(
      sql,
      family,
      id,
      2,
      slugs.current,
      authorId,
      [
        {
          language: 'en',
          title: `Synthetic recovery ${family} ${w.published}`,
          ...issuer,
        },
        { language: 'ur', title: TEXT.titleUr, issuer: TEXT.issuerUr },
      ],
      references,
    );
    await sql.query(
      `UPDATE [dbo].[${family}] SET [approvedRevision]=2,[approvedById]=N'${reviewerId}',[state]=N'published',[publishedAt]='2033-06-15T08:00:00'${CHRONOLOGICAL.has(family) ? `,[chronologyAt]='2033-06-15T08:00:00'` : ''},[version]=3 WHERE [id]=N'${id}';
       INSERT INTO [dbo].[SearchIndexRequest] ([scopeKind],[scopeId]) VALUES (N'${PHASE13_KIND[family]}',N'${id}');`,
    );
  }

  // An archived NewsArticle: once public, now withdrawn.
  await sql.query(
    `INSERT INTO [dbo].[NewsArticle] ([id],[slug],[state],[version],[creatorId],[updatedAt]) VALUES (N'${fixture.archivedId}',N'archived-${fixture.runId}',N'draft',1,N'${authorId}',SYSUTCDATETIME());`,
  );
  await writeRevision(
    sql,
    'NewsArticle',
    fixture.archivedId,
    1,
    `archived-${fixture.runId}`,
    authorId,
    [{ language: 'en', title: `Synthetic withdrawn news ${w.archived}` }],
    null,
  );
  await sql.query(
    `UPDATE [dbo].[NewsArticle] SET [approvedRevision]=1,[approvedById]=N'${reviewerId}',[state]=N'archived',[publishedAt]='2033-06-16T08:00:00',[chronologyAt]='2033-06-16T08:00:00',[version]=2 WHERE [id]=N'${fixture.archivedId}';`,
  );

  // A press release scheduled for later, the schedule bound to its revision.
  await sql.query(
    `INSERT INTO [dbo].[PressRelease] ([id],[slug],[state],[version],[creatorId],[updatedAt]) VALUES (N'${fixture.scheduledId}',N'scheduled-${fixture.runId}',N'draft',1,N'${authorId}',SYSUTCDATETIME());`,
  );
  await writeRevision(
    sql,
    'PressRelease',
    fixture.scheduledId,
    1,
    `scheduled-${fixture.runId}`,
    authorId,
    [{ language: 'en', title: 'Synthetic scheduled press release' }],
    null,
  );
  await sql.query(
    `UPDATE [dbo].[PressRelease] SET [approvedRevision]=1,[approvedById]=N'${reviewerId}',[state]=N'scheduled',[scheduledRevision]=1,[scheduledAt]='2099-01-01T00:00:00',[scheduledTimezone]=N'Asia/Karachi',[scheduledById]=N'${reviewerId}',[scheduleStatus]=N'pending',[version]=2 WHERE [id]=N'${fixture.scheduledId}';`,
  );
}

/** Every authoritative Phase-13 row this fixture wrote, in a stable order. */
export async function capturePhase13Fixture(
  sql: SqlSession,
  fixture: Phase13Fixture,
): Promise<Readonly<Record<string, string>>> {
  assertSafe(fixture);
  const rows: Record<string, string> = {};
  const extra: Readonly<Record<Phase13Family, readonly string[]>> = {
    NewsArticle: [fixture.archivedId],
    PressRelease: [fixture.scheduledId],
    Statement: [],
    MediaCoverage: [],
  };
  for (const family of PHASE13_FAMILIES) {
    const ids = [fixture.ids[family], ...extra[family]];
    const list = ids.map((id) => `N'${id}'`).join(',');
    const count = ids.length;
    for (const [suffix, key, order, expected] of [
      ['', 'id', '[id]', count],
      ['Revision', 'ownerId', '[ownerId],[number]', count + 1],
      [
        'RevisionTranslation',
        'ownerId',
        '[ownerId],[revisionNumber],[languageCode]',
        count + 2,
      ],
      ['Topic', 'ownerId', '[ownerId],[revisionNumber],[topicId]', 1],
      ['Contributor', 'ownerId', '[ownerId],[revisionNumber],[personId],[role]', 1],
      ['SlugHistory', 'ownerId', '[slug]', count + 1],
    ] as const) {
      const data = await sql.query(
        `SELECT * FROM [dbo].[${family}${suffix}] WHERE [${key}] IN (${list}) ORDER BY ${order};`,
      );
      if (data.length !== expected)
        throw new Error(
          `Phase-13 recovery expected ${expected} ${family}${suffix} row(s), found ${data.length}.`,
        );
      rows[family + suffix] = JSON.stringify(data);
    }
    const intent = await sql.query(
      `SELECT [scopeKind],[scopeId] FROM [dbo].[SearchIndexRequest] WHERE [scopeKind]=N'${PHASE13_KIND[family]}' AND [scopeId]=N'${fixture.ids[family]}';`,
    );
    if (intent.length !== 1)
      throw new Error(`Phase-13 recovery lost the ${family} search intent.`);
    rows[`${family}SearchIntent`] = JSON.stringify(intent);
  }
  return rows;
}

/**
 * Verifies the restored News state and returns one line of what was proved.
 *
 * BEYOND ROW EQUALITY: every immutability, append, sequence and integrity
 * trigger came back enabled; no workflow CHECK constraint came back disabled or
 * untrusted; the Urdu title and issuer, the outlet and the source address are
 * exactly what was written.
 */
export async function verifyRestoredPhase13(
  sql: SqlSession,
  fixture: Phase13Fixture,
  expected: Readonly<Record<string, string>>,
): Promise<string> {
  deepStrictEqual(
    await capturePhase13Fixture(sql, fixture),
    expected,
    'Phase-13 News authoritative values changed during recovery.',
  );

  const [text] = await sql.query<{ title: string; issuer: string }>(
    `SELECT [title],[issuer] FROM [dbo].[StatementRevisionTranslation]
     WHERE [ownerId]=N'${fixture.ids.Statement}' AND [revisionNumber]=2 AND [languageCode]=N'ur';`,
  );
  if (text?.title !== TEXT.titleUr || text.issuer !== TEXT.issuerUr)
    throw new Error('Restored Urdu Phase-13 statement text does not match.');
  const [source] = await sql.query<{ outletName: string; sourceUrl: string }>(
    `SELECT [outletName],[sourceUrl] FROM [dbo].[MediaCoverageRevision]
     WHERE [ownerId]=N'${fixture.ids.MediaCoverage}' AND [number]=2;`,
  );
  if (source?.outletName !== TEXT.outlet || source.sourceUrl !== TEXT.source)
    throw new Error('Restored Phase-13 coverage source does not match.');

  const tables = PHASE13_FAMILIES.flatMap((family) =>
    ['', 'Revision', 'RevisionTranslation', 'Topic', 'Contributor', 'SlugHistory'].map(
      (suffix) => `OBJECT_ID(N'${family}${suffix}')`,
    ),
  ).join(',');
  const [triggers] = await sql.query<{ total: number }>(
    `SELECT COUNT_BIG(*) AS [total] FROM sys.triggers WHERE [parent_id] IN (${tables}) AND [is_disabled]=0;`,
  );
  if (Number(triggers?.total ?? 0) !== 44)
    throw new Error('Restored database lost a Phase-13 editorial invariant trigger.');
  const broken = await sql.query<{ name: string }>(
    `SELECT [name] FROM sys.check_constraints WHERE parent_object_id IN (${tables}) AND (is_disabled=1 OR is_not_trusted=1);`,
  );
  if (broken.length > 0)
    throw new Error(
      `Restored Phase-13 constraints are not trusted: ${broken.map((row) => row.name).join(', ')}`,
    );

  return 'four families: renamed slugs, immutable revisions, approval, schedule, issuer, coverage source, typed references and search intent intact';
}
