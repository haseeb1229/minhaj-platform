import 'server-only';

import { deepStrictEqual } from 'node:assert';
import { randomUUID } from 'node:crypto';

import type { SqlSession } from './sql-connection.ts';

/**
 * POPULATED PHASE-8 STATE for the recovery rehearsal (§50).
 *
 * WHAT IT PROVES THAT A SCHEMA CHECK DOES NOT. `verifyRestoredSchema` proves the
 * Library TABLES came back. This proves the Library did — and that its
 * RELATIONSHIPS survived:
 *
 *   - one Work with localized descriptive metadata in all three interface
 *     locales, read back character by character, so Urdu and Arabic returning as
 *     replacement characters is a failure rather than a corrupted row nobody reads;
 *   - a RENAMED slug, so both the current slug and the retired one must come back
 *     reserved to the same Work — a restore that lost the history would silently
 *     turn every old link into a 404;
 *   - two Editions in two content languages, one a genuine BookTranslation of the
 *     other with a translator, so the composite same-Work foreign key is exercised
 *     rather than assumed;
 *   - an Edition whose readable file is a Storage ASSET, so the restored relation
 *     must still resolve to the restored asset with the same checksum (§50: "restored
 *     Library relations still resolve consistently to restored Storage Assets");
 *   - an availability decision and a sale point linked to the Work.
 *
 * STORAGE BYTES ARE NOT HERE. The file on disk is Phase 7's recovery concern and
 * its own rehearsal owns it; this proves the METADATA relation, which is what
 * Library owns (§50: "Do NOT duplicate Storage backup subsystem").
 *
 * NOTHING HERE IS REAL. Every title and paragraph says it is a recovery proof, the
 * sale point is on no street, and no book is represented.
 */

export interface Phase8Fixture {
  readonly runId: string;
  readonly workId: string;
  readonly originalSlug: string;
  readonly currentSlug: string;
  readonly sourceEditionId: string;
  readonly translationEditionId: string;
  readonly assetId: string;
  readonly salePointId: string;
}

export function newPhase8Fixture(): Phase8Fixture {
  const runId = randomUUID().replaceAll('-', '');
  return {
    runId,
    workId: randomUUID(),
    originalSlug: `phase8-recovery-original-${runId}`,
    currentSlug: `phase8-recovery-current-${runId}`,
    sourceEditionId: randomUUID(),
    translationEditionId: randomUUID(),
    assetId: randomUUID(),
    salePointId: randomUUID(),
  };
}

/** Rejects anything that is not this module's own generated shape. */
function assertSafe(fixture: Phase8Fixture): void {
  if (!/^[0-9a-f]{32}$/.test(fixture.runId)) {
    throw new Error('Phase-8 fixture runId does not match the expected pattern.');
  }
  for (const [name, value] of Object.entries(fixture)) {
    if (name === 'runId') continue;
    if (!/^[0-9a-z-]{1,120}$/.test(value)) {
      throw new Error(`Phase-8 fixture field '${name}' is not a safe generated value.`);
    }
  }
}

const LABELS = {
  en: 'Synthetic recovery proof work',
  ur: 'بحالی کے ثبوت کی آزمائشی تصنیف',
  ar: 'عمل تجريبي لإثبات الاستعادة',
} as const;

/**
 * Writes the populated Phase-8 state into the SOURCE database, before backup.
 *
 * Written with the MIGRATION principal, like the rest of the administrative
 * tooling, and in dependency order so the real foreign keys, CHECK constraints and
 * the slug-reservation trigger are exercised rather than worked around.
 */
export async function writePhase8Fixture(
  sql: SqlSession,
  fixture: Phase8Fixture,
  references: {
    readonly personId: string;
    readonly translatorId: string;
    readonly topicId: string;
  },
): Promise<void> {
  assertSafe(fixture);
  for (const value of Object.values(references)) {
    if (!/^[a-z0-9-]{1,36}$/i.test(value)) {
      throw new Error('Invalid synthetic Phase-8 fixture reference.');
    }
  }
  const f = fixture;
  const document = JSON.stringify({
    sections: [
      {
        key: 'recovery-proof',
        title: 'Recovery proof',
        paragraphs: ['Synthetic non-authoritative recovery text.'],
      },
    ],
  });

  await sql.query(`
    INSERT INTO [dbo].[Asset] ([id],[storageKey],[mediaType],[byteSize],[checksum],[state],[updatedAt])
    VALUES (N'${f.assetId}', N'ab/cd/${f.runId}', N'application/pdf', 64, REPLICATE(N'ab', 32), N'clean', SYSUTCDATETIME());

    INSERT INTO [dbo].[Work] ([id],[slug],[primaryLocale],[state],[isFeatured],[version],[updatedAt])
    VALUES (N'${f.workId}', N'${f.originalSlug}', N'ar', N'published', 0, 1, SYSUTCDATETIME());

    UPDATE [dbo].[Work] SET [slug]=N'${f.currentSlug}', [version]=2 WHERE [id]=N'${f.workId}';

    INSERT INTO [dbo].[WorkLabel] ([workId],[locale],[title],[description]) VALUES
      (N'${f.workId}', N'en', N'${LABELS.en}', N''),
      (N'${f.workId}', N'ur', N'${LABELS.ur}', N''),
      (N'${f.workId}', N'ar', N'${LABELS.ar}', N'');

    INSERT INTO [dbo].[WorkContributor] ([workId],[personId],[role],[position])
    VALUES (N'${f.workId}', N'${references.personId}', N'author', 0);

    INSERT INTO [dbo].[WorkTopic] ([workId],[topicId])
    VALUES (N'${f.workId}', N'${references.topicId}');

    INSERT INTO [dbo].[Edition]
      ([id],[workId],[languageCode],[label],[state],[reading],[download],[readableAssetId],[document],[contentVersion],[version],[updatedAt])
    VALUES
      (N'${f.sourceEditionId}', N'${f.workId}', N'ar', N'Synthetic source edition', N'published',
       N'allowed', N'denied', N'${f.assetId}', N'${document}', REPLICATE(N'c', 64), 1, SYSUTCDATETIME()),
      (N'${f.translationEditionId}', N'${f.workId}', N'ur', N'Synthetic translated edition', N'published',
       N'unavailable', N'denied', NULL, NULL, NULL, 1, SYSUTCDATETIME());

    INSERT INTO [dbo].[BookTranslation] ([editionId],[workId],[sourceEditionId])
    VALUES (N'${f.translationEditionId}', N'${f.workId}', N'${f.sourceEditionId}');

    INSERT INTO [dbo].[BookTranslator] ([editionId],[personId])
    VALUES (N'${f.translationEditionId}', N'${references.translatorId}');

    INSERT INTO [dbo].[SalePoint] ([id],[name],[address],[contact],[url],[state],[version])
    VALUES (N'${f.salePointId}', N'Synthetic recovery sale point', N'', N'', NULL, N'published', 1);

    INSERT INTO [dbo].[WorkSalePoint] ([workId],[salePointId])
    VALUES (N'${f.workId}', N'${f.salePointId}');
  `);
}

/** Every authoritative Library row this fixture wrote, in a stable order. */
export async function capturePhase8Fixture(
  sql: SqlSession,
  fixture: Phase8Fixture,
): Promise<Readonly<Record<string, string>>> {
  assertSafe(fixture);
  const f = fixture;
  const editions = `N'${f.sourceEditionId}',N'${f.translationEditionId}'`;
  const rows: Record<string, string> = {};

  for (const [name, statement, expected] of [
    ['Work', `SELECT * FROM [dbo].[Work] WHERE [id]=N'${f.workId}'`, 1],
    [
      'WorkLabel',
      `SELECT * FROM [dbo].[WorkLabel] WHERE [workId]=N'${f.workId}' ORDER BY [locale]`,
      3,
    ],
    [
      'WorkSlugHistory',
      `SELECT * FROM [dbo].[WorkSlugHistory] WHERE [workId]=N'${f.workId}' ORDER BY [slug]`,
      2,
    ],
    [
      'WorkContributor',
      `SELECT * FROM [dbo].[WorkContributor] WHERE [workId]=N'${f.workId}'`,
      1,
    ],
    ['WorkTopic', `SELECT * FROM [dbo].[WorkTopic] WHERE [workId]=N'${f.workId}'`, 1],
    [
      'Edition',
      `SELECT * FROM [dbo].[Edition] WHERE [id] IN (${editions}) ORDER BY [id]`,
      2,
    ],
    [
      'BookTranslation',
      `SELECT * FROM [dbo].[BookTranslation] WHERE [editionId]=N'${f.translationEditionId}'`,
      1,
    ],
    [
      'BookTranslator',
      `SELECT * FROM [dbo].[BookTranslator] WHERE [editionId]=N'${f.translationEditionId}'`,
      1,
    ],
    ['SalePoint', `SELECT * FROM [dbo].[SalePoint] WHERE [id]=N'${f.salePointId}'`, 1],
    [
      'WorkSalePoint',
      `SELECT * FROM [dbo].[WorkSalePoint] WHERE [workId]=N'${f.workId}'`,
      1,
    ],
  ] as const) {
    const data = await sql.query(`${statement};`);
    if (data.length !== expected) {
      throw new Error(
        `Phase-8 recovery expected ${expected} ${name} row(s), found ${data.length}.`,
      );
    }
    rows[name] = JSON.stringify(data);
  }

  return rows;
}

/**
 * Verifies the restored Library, and returns a one-line account of what was proved.
 *
 * THREE THINGS BEYOND ROW EQUALITY:
 *
 *   - the Edition's readable asset still RESOLVES, through the restored foreign
 *     key, to the restored Asset with the same checksum and a servable state;
 *   - the slug-reservation trigger came back, so a restored database still
 *     reserves every future rename rather than silently permitting slug reuse;
 *   - no Library CHECK constraint came back disabled or untrusted, so "reading
 *     allowed implies a readable source" is still true against any writer.
 */
export async function verifyRestoredPhase8(
  sql: SqlSession,
  fixture: Phase8Fixture,
  expected: Readonly<Record<string, string>>,
): Promise<string> {
  deepStrictEqual(
    await capturePhase8Fixture(sql, fixture),
    expected,
    'Library authoritative values changed during recovery.',
  );

  const [resolved] = await sql.query<{ checksum: string; state: string }>(
    `SELECT a.[checksum], a.[state] FROM [dbo].[Edition] e JOIN [dbo].[Asset] a ON a.[id]=e.[readableAssetId] WHERE e.[id]=N'${fixture.sourceEditionId}';`,
  );
  if (resolved?.checksum !== 'ab'.repeat(32) || resolved.state !== 'clean') {
    throw new Error('Restored Edition no longer resolves to its restored clean Asset.');
  }

  const [labels] = await sql.query<{ ur: string; ar: string }>(
    `SELECT
       MAX(CASE WHEN [locale]=N'ur' THEN [title] END) AS [ur],
       MAX(CASE WHEN [locale]=N'ar' THEN [title] END) AS [ar]
     FROM [dbo].[WorkLabel] WHERE [workId]=N'${fixture.workId}';`,
  );
  if (labels?.ur !== LABELS.ur || labels.ar !== LABELS.ar) {
    throw new Error('Restored Urdu or Arabic Library metadata does not match.');
  }

  const [trigger] = await sql.query<{ total: number }>(
    `SELECT COUNT_BIG(*) AS [total] FROM sys.triggers WHERE [name]=N'LibraryReserveWorkSlug' AND [is_disabled]=0;`,
  );
  if (Number(trigger?.total ?? 0) !== 1) {
    throw new Error('Restored database lost the Library slug-reservation trigger.');
  }

  const broken = await sql.query<{ name: string }>(
    `SELECT [name] FROM sys.check_constraints
     WHERE parent_object_id IN (OBJECT_ID(N'Work'),OBJECT_ID(N'Edition'),OBJECT_ID(N'SalePoint'),OBJECT_ID(N'BookTranslation'))
       AND (is_disabled=1 OR is_not_trusted=1);`,
  );
  if (broken.length > 0) {
    throw new Error(
      `Restored Library constraints are not trusted: ${broken.map((row) => row.name).join(', ')}`,
    );
  }

  return '10 Library tables, slug history, translation and Asset relation intact';
}
