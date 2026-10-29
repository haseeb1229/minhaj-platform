import 'server-only';

import { deepStrictEqual } from 'node:assert';
import { randomUUID } from 'node:crypto';

import type { SqlSession } from './sql-connection.ts';

/**
 * POPULATED PHASE-16 STATE for the recovery rehearsals.
 *
 * WHAT THE RECOVERY FIXTURE PROVES THAT A SCHEMA CHECK DOES NOT. That the Global
 * Network directory came back with its FLEXIBLE PARENTAGE, its SAME-COUNTRY
 * relations and its centre-scoped News:
 *
 *   - a Country with NO Region, holding a City directly;
 *   - a Country WITH a Region (renamed once, so two Country-scoped slug
 *     reservations), a City under that Region and two further Cities;
 *   - a PHYSICAL Centre in a City, renamed once, with an Urdu and an English
 *     label, an address, exact coordinates, an ordered phone, email and HTTPS
 *     website, and TWO served Cities of its own Country;
 *   - a VIRTUAL Centre with no City, Region or coordinates, serving one City;
 *   - an ARCHIVED Centre placed directly in a Region, and a DRAFT City;
 *   - a published NewsArticle whose current revision names the physical Centre.
 *
 * EVERYTHING IS SYNTHETIC: no real centre, address, telephone number or person
 * is named; every address is `.invalid`; and both Country codes are drawn from
 * the ISO 3166-1 USER-ASSIGNED ranges (`XA`–`XP` and `QM`–`QZ`), which no real
 * country holds. The codes are derived from the run identifier. `Country.code`
 * is unique, so this fixture is written ONCE per database: the recovery
 * databases are disposable and created by the run that writes it, and within
 * one run the two Countries take codes from different ranges and cannot
 * collide with each other.
 */

export interface Phase16Fixture {
  readonly runId: string;
  /** A Country with no Region at all. */
  readonly plainCountryId: string;
  readonly plainCountryCode: string;
  /** A Country with a Region. */
  readonly regionalCountryId: string;
  readonly regionalCountryCode: string;
  readonly regionId: string;
  readonly regionOriginalSlug: string;
  readonly regionSlug: string;
  /** A City directly under the Region-less Country. */
  readonly plainCityId: string;
  /** A City under the Region, holding the physical Centre. */
  readonly regionalCityId: string;
  /** Two further Cities of the regional Country, served by the physical Centre. */
  readonly servedCityId: string;
  readonly draftCityId: string;
  readonly physicalCentreId: string;
  readonly physicalCentreOriginalSlug: string;
  readonly physicalCentreSlug: string;
  readonly virtualCentreId: string;
  readonly archivedCentreId: string;
  readonly newsId: string;
}

export function newPhase16Fixture(): Phase16Fixture {
  const runId = randomUUID().replaceAll('-', '');
  const stem = runId.slice(0, 16);
  // [0-9a-f] -> A..P after X, and -> M..Z (mod 14) after Q: user-assigned only.
  const first = Number.parseInt(runId.charAt(0), 16);
  const second = Number.parseInt(runId.charAt(1), 16);
  return {
    runId,
    plainCountryId: randomUUID(),
    plainCountryCode: `X${String.fromCharCode(65 + first)}`,
    regionalCountryId: randomUUID(),
    regionalCountryCode: `Q${String.fromCharCode(77 + (second % 14))}`,
    regionId: randomUUID(),
    regionOriginalSlug: `phase16-region-original-${stem}`,
    regionSlug: `phase16-region-current-${stem}`,
    plainCityId: randomUUID(),
    regionalCityId: randomUUID(),
    servedCityId: randomUUID(),
    draftCityId: randomUUID(),
    physicalCentreId: randomUUID(),
    physicalCentreOriginalSlug: `phase16-centre-original-${stem}`,
    physicalCentreSlug: `phase16-centre-current-${stem}`,
    virtualCentreId: randomUUID(),
    archivedCentreId: randomUUID(),
    newsId: randomUUID(),
  };
}

/** Rejects anything that is not this module's own generated shape. */
function assertSafe(fixture: Phase16Fixture): void {
  if (!/^[0-9a-f]{32}$/.test(fixture.runId)) {
    throw new Error('Phase-16 fixture runId does not match the expected pattern.');
  }
  if (
    !/^X[A-P]$/.test(fixture.plainCountryCode) ||
    !/^Q[M-Z]$/.test(fixture.regionalCountryCode)
  ) {
    throw new Error('Phase-16 fixture Country codes are not user-assigned codes.');
  }
  for (const [name, value] of Object.entries(fixture)) {
    if (name === 'runId' || name.endsWith('Code')) continue;
    if (!/^[0-9a-z-]{1,120}$/.test(value)) {
      throw new Error(`Phase-16 fixture field '${name}' is not a safe generated value.`);
    }
  }
}

const TEXT = {
  centreNameUr: 'بحالی کے ثبوت کا آزمائشی مرکز',
  centreNameEn: 'Synthetic Recovery Centre',
  addressEn: '1 Synthetic Recovery Road, Nowhere',
  phone: '+00 000 0000',
  email: 'recovery-centre@example.invalid',
  website: 'https://recovery-centre.example.invalid/',
  latitude: '24.860700',
  longitude: '67.001100',
  newsTitleUr: 'بحالی کے ثبوت کی مرکز کی آزمائشی خبر',
} as const;

const document = (text: string) =>
  JSON.stringify({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  });

/** Every Phase-16 identifier of one kind, as a SQL `IN` list. */
function list(...ids: readonly string[]): string {
  return ids.map((id) => `N'${id}'`).join(',');
}

/**
 * Writes the populated Phase-16 state into the SOURCE database, before backup,
 * with the MIGRATION principal, so the real composite foreign keys, CHECKs and
 * slug triggers are exercised — every rename is a real UPDATE.
 *
 * The NewsArticle is written in the Phase-13 shape, in the order its append,
 * sequence and integrity triggers require, with an author and an independent
 * reviewer exactly as `writePhase13Fixture` takes them.
 */
export async function writePhase16Fixture(
  sql: SqlSession,
  fixture: Phase16Fixture,
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
      throw new Error('Invalid synthetic Phase-16 fixture reference.');
  const f = fixture;
  const stem = f.runId.slice(0, 16);

  // ---- the directory: two Countries, one Region, four Cities ---------------
  await sql.query(`
    INSERT INTO [dbo].[Country] ([id],[code],[slug],[primaryLocale],[state]) VALUES
      (N'${f.plainCountryId}', N'${f.plainCountryCode}', N'phase16-plain-${stem}', N'en', N'published'),
      (N'${f.regionalCountryId}', N'${f.regionalCountryCode}', N'phase16-regional-${stem}', N'ur', N'published');
    INSERT INTO [dbo].[CountryLabel] ([countryId],[locale],[name]) VALUES
      (N'${f.plainCountryId}', N'en', N'Synthetic Recovery Plainland'),
      (N'${f.regionalCountryId}', N'en', N'Synthetic Recovery Regionland'),
      (N'${f.regionalCountryId}', N'ur', N'آزمائشی بحالی ملک');

    INSERT INTO [dbo].[Region] ([id],[countryId],[slug],[primaryLocale],[state]) VALUES
      (N'${f.regionId}', N'${f.regionalCountryId}', N'${f.regionOriginalSlug}', N'en', N'published');
    UPDATE [dbo].[Region] SET [slug]=N'${f.regionSlug}', [version]=2 WHERE [id]=N'${f.regionId}';
    INSERT INTO [dbo].[RegionLabel] ([regionId],[locale],[name]) VALUES
      (N'${f.regionId}', N'en', N'Synthetic Recovery Province'),
      (N'${f.regionId}', N'ur', N'آزمائشی بحالی صوبہ');

    INSERT INTO [dbo].[City] ([id],[countryId],[regionId],[slug],[primaryLocale],[state]) VALUES
      (N'${f.plainCityId}', N'${f.plainCountryId}', NULL, N'phase16-plain-city-${stem}', N'en', N'published'),
      (N'${f.regionalCityId}', N'${f.regionalCountryId}', N'${f.regionId}', N'phase16-regional-city-${stem}', N'en', N'published'),
      (N'${f.servedCityId}', N'${f.regionalCountryId}', NULL, N'phase16-served-city-${stem}', N'en', N'published'),
      (N'${f.draftCityId}', N'${f.regionalCountryId}', N'${f.regionId}', N'phase16-draft-city-${stem}', N'en', N'draft');
    INSERT INTO [dbo].[CityLabel] ([cityId],[locale],[name]) VALUES
      (N'${f.plainCityId}', N'en', N'Synthetic Plain City'),
      (N'${f.regionalCityId}', N'en', N'Synthetic Regional City'),
      (N'${f.regionalCityId}', N'ur', N'آزمائشی شہر'),
      (N'${f.servedCityId}', N'en', N'Synthetic Served City'),
      (N'${f.draftCityId}', N'en', N'Synthetic Draft City');
  `);

  // ---- the Centres: physical (renamed), virtual, archived-in-a-Region -------
  await sql.query(`
    INSERT INTO [dbo].[Centre] ([id],[slug],[countryId],[regionId],[cityId],[isVirtual],[latitude],[longitude],[primaryLocale],[state]) VALUES
      (N'${f.physicalCentreId}', N'${f.physicalCentreOriginalSlug}', N'${f.regionalCountryId}', NULL, N'${f.regionalCityId}', 0, ${TEXT.latitude}, ${TEXT.longitude}, N'ur', N'published'),
      (N'${f.virtualCentreId}', N'phase16-virtual-centre-${stem}', N'${f.plainCountryId}', NULL, NULL, 1, NULL, NULL, N'en', N'published'),
      (N'${f.archivedCentreId}', N'phase16-archived-centre-${stem}', N'${f.regionalCountryId}', N'${f.regionId}', NULL, 0, NULL, NULL, N'en', N'archived');
    UPDATE [dbo].[Centre] SET [slug]=N'${f.physicalCentreSlug}', [version]=2 WHERE [id]=N'${f.physicalCentreId}';
    INSERT INTO [dbo].[CentreLabel] ([centreId],[locale],[name],[description],[address]) VALUES
      (N'${f.physicalCentreId}', N'en', N'${TEXT.centreNameEn}', N'A synthetic centre used only as a recovery proof.', N'${TEXT.addressEn}'),
      (N'${f.physicalCentreId}', N'ur', N'${TEXT.centreNameUr}', NULL, NULL),
      (N'${f.virtualCentreId}', N'en', N'Synthetic Recovery Online Centre', NULL, NULL),
      (N'${f.archivedCentreId}', N'en', N'Synthetic Recovery Former Centre', NULL, NULL);
    INSERT INTO [dbo].[CentreContact] ([centreId],[position],[channel],[value]) VALUES
      (N'${f.physicalCentreId}', 0, N'phone', N'${TEXT.phone}'),
      (N'${f.physicalCentreId}', 1, N'email', N'${TEXT.email}'),
      (N'${f.physicalCentreId}', 2, N'website', N'${TEXT.website}');
    INSERT INTO [dbo].[CentreServiceCity] ([centreId],[cityId],[countryId]) VALUES
      (N'${f.physicalCentreId}', N'${f.servedCityId}', N'${f.regionalCountryId}'),
      (N'${f.physicalCentreId}', N'${f.draftCityId}', N'${f.regionalCountryId}'),
      (N'${f.virtualCentreId}', N'${f.plainCityId}', N'${f.plainCountryId}');
  `);

  // ---- centre-scoped News, in the Phase-13 shape ---------------------------
  const slug = `phase16-centre-news-${stem}`;
  const { authorId, reviewerId, personId, topicId } = references;
  await sql.query(`
    INSERT INTO [dbo].[NewsArticle] ([id],[slug],[state],[version],[creatorId],[updatedAt])
      VALUES (N'${f.newsId}', N'${slug}', N'draft', 1, N'${authorId}', SYSUTCDATETIME());
    INSERT INTO [dbo].[NewsArticleSlugHistory] ([ownerId],[slug]) VALUES (N'${f.newsId}', N'${slug}');
    INSERT INTO [dbo].[NewsArticleRevision] ([ownerId],[number],[editorId],[slug],[primaryLanguage],[centreId])
      VALUES (N'${f.newsId}', 1, N'${authorId}', N'${slug}', N'en', N'${f.physicalCentreId}');
  `);
  for (const [language, title] of [
    ['en', 'Synthetic centre recovery news'],
    ['ur', TEXT.newsTitleUr],
  ] as const) {
    await sql.query(
      `INSERT INTO [dbo].[NewsArticleRevisionTranslation] ([ownerId],[revisionNumber],[languageCode],[title],[excerpt],[seoTitle],[seoDescription],[document],[html])
       VALUES (N'${f.newsId}', 1, N'${language}', N'${title}', N'Synthetic fixture', N'', N'', N'${document(`${title} — synthetic recovery body.`)}', N'<p>${title}</p>');`,
    );
  }
  await sql.query(`
    INSERT INTO [dbo].[NewsArticleTopic] ([ownerId],[revisionNumber],[topicId]) VALUES (N'${f.newsId}', 1, N'${topicId}');
    INSERT INTO [dbo].[NewsArticleContributor] ([ownerId],[revisionNumber],[personId],[role],[position]) VALUES (N'${f.newsId}', 1, N'${personId}', N'author', 0);
    UPDATE [dbo].[NewsArticle] SET [currentRevision]=1, [version]=1 WHERE [id]=N'${f.newsId}';
    UPDATE [dbo].[NewsArticle] SET [approvedRevision]=1, [approvedById]=N'${reviewerId}', [state]=N'published', [publishedAt]='2033-07-01T08:00:00', [chronologyAt]='2033-07-01T08:00:00', [version]=2 WHERE [id]=N'${f.newsId}';
    INSERT INTO [dbo].[SearchIndexRequest] ([scopeKind],[scopeId]) VALUES (N'news-article', N'${f.newsId}');
  `);
}

/** Every authoritative Phase-16 row this fixture wrote, in a stable order. */
export async function capturePhase16Fixture(
  sql: SqlSession,
  fixture: Phase16Fixture,
): Promise<Readonly<Record<string, string>>> {
  assertSafe(fixture);
  const f = fixture;
  const countries = list(f.plainCountryId, f.regionalCountryId);
  const cities = list(f.plainCityId, f.regionalCityId, f.servedCityId, f.draftCityId);
  const centres = list(f.physicalCentreId, f.virtualCentreId, f.archivedCentreId);
  const news = `N'${f.newsId}'`;
  const rows: Record<string, string> = {};

  for (const [name, statement, expected] of [
    [
      'Country',
      `SELECT * FROM [dbo].[Country] WHERE [id] IN (${countries}) ORDER BY [id]`,
      2,
    ],
    [
      'CountryLabel',
      `SELECT * FROM [dbo].[CountryLabel] WHERE [countryId] IN (${countries}) ORDER BY [countryId],[locale]`,
      3,
    ],
    [
      'CountrySlugHistory',
      `SELECT * FROM [dbo].[CountrySlugHistory] WHERE [countryId] IN (${countries}) ORDER BY [slug]`,
      2,
    ],
    ['Region', `SELECT * FROM [dbo].[Region] WHERE [id]=N'${f.regionId}'`, 1],
    [
      'RegionLabel',
      `SELECT * FROM [dbo].[RegionLabel] WHERE [regionId]=N'${f.regionId}' ORDER BY [locale]`,
      2,
    ],
    [
      'RegionSlugHistory',
      `SELECT * FROM [dbo].[RegionSlugHistory] WHERE [regionId]=N'${f.regionId}' ORDER BY [slug]`,
      2,
    ],
    ['City', `SELECT * FROM [dbo].[City] WHERE [id] IN (${cities}) ORDER BY [id]`, 4],
    [
      'CityLabel',
      `SELECT * FROM [dbo].[CityLabel] WHERE [cityId] IN (${cities}) ORDER BY [cityId],[locale]`,
      5,
    ],
    [
      'CitySlugHistory',
      `SELECT * FROM [dbo].[CitySlugHistory] WHERE [cityId] IN (${cities}) ORDER BY [cityId],[slug]`,
      4,
    ],
    [
      'Centre',
      `SELECT * FROM [dbo].[Centre] WHERE [id] IN (${centres}) ORDER BY [id]`,
      3,
    ],
    [
      'CentreLabel',
      `SELECT * FROM [dbo].[CentreLabel] WHERE [centreId] IN (${centres}) ORDER BY [centreId],[locale]`,
      4,
    ],
    [
      'CentreSlugHistory',
      `SELECT * FROM [dbo].[CentreSlugHistory] WHERE [centreId] IN (${centres}) ORDER BY [slug]`,
      4,
    ],
    [
      'CentreServiceCity',
      `SELECT * FROM [dbo].[CentreServiceCity] WHERE [centreId] IN (${centres}) ORDER BY [centreId],[cityId]`,
      3,
    ],
    [
      'CentreContact',
      `SELECT * FROM [dbo].[CentreContact] WHERE [centreId] IN (${centres}) ORDER BY [centreId],[position]`,
      3,
    ],
    ['NewsArticle', `SELECT * FROM [dbo].[NewsArticle] WHERE [id]=${news}`, 1],
    [
      'NewsArticleRevision',
      `SELECT * FROM [dbo].[NewsArticleRevision] WHERE [ownerId]=${news} ORDER BY [number]`,
      1,
    ],
    [
      'NewsArticleRevisionTranslation',
      `SELECT * FROM [dbo].[NewsArticleRevisionTranslation] WHERE [ownerId]=${news} ORDER BY [revisionNumber],[languageCode]`,
      2,
    ],
    [
      'NewsArticleTopic',
      `SELECT * FROM [dbo].[NewsArticleTopic] WHERE [ownerId]=${news} ORDER BY [topicId]`,
      1,
    ],
    [
      'NewsArticleContributor',
      `SELECT * FROM [dbo].[NewsArticleContributor] WHERE [ownerId]=${news} ORDER BY [personId]`,
      1,
    ],
    [
      'NewsArticleSlugHistory',
      `SELECT * FROM [dbo].[NewsArticleSlugHistory] WHERE [ownerId]=${news} ORDER BY [slug]`,
      1,
    ],
    [
      'NewsArticleSearchIntent',
      `SELECT [scopeKind],[scopeId] FROM [dbo].[SearchIndexRequest] WHERE [scopeKind]=N'news-article' AND [scopeId]=${news}`,
      1,
    ],
  ] as const) {
    const data = await sql.query(`${statement};`);
    if (data.length !== expected) {
      throw new Error(
        `Phase-16 recovery expected ${expected} ${name} row(s), found ${data.length}.`,
      );
    }
    rows[name] = JSON.stringify(data);
  }

  return rows;
}

/** The Phase-16 tables whose constraints and triggers must return intact. */
const PHASE16_TABLES = [
  'Country',
  'CountryLabel',
  'CountrySlugHistory',
  'Region',
  'RegionLabel',
  'RegionSlugHistory',
  'City',
  'CityLabel',
  'CitySlugHistory',
  'Centre',
  'CentreLabel',
  'CentreSlugHistory',
  'CentreServiceCity',
  'CentreContact',
] as const;

/** The composite (id, countryId) foreign keys that make "same Country" relational. */
const SAME_COUNTRY_FOREIGN_KEYS = [
  'RegionSlugHistory_regionId_countryId_fkey',
  'City_regionId_countryId_fkey',
  'CitySlugHistory_cityId_countryId_fkey',
  'Centre_regionId_countryId_fkey',
  'Centre_cityId_countryId_fkey',
  'CentreServiceCity_centreId_countryId_fkey',
  'CentreServiceCity_cityId_countryId_fkey',
] as const;

const SLUG_TRIGGERS = [
  'GlobalReserveCountrySlug',
  'GlobalReserveRegionSlug',
  'GlobalReserveCitySlug',
  'GlobalReserveCentreSlug',
] as const;

/**
 * Verifies the restored Global state and returns one line of what was proved.
 *
 * BEYOND ROW EQUALITY: the Urdu Centre name character for character; the
 * coordinates as exact decimals; the four slug triggers enabled; every Phase-16
 * CHECK and foreign key — and the News revision's Centre reference — enabled,
 * trusted and non-cascading; each same-Country foreign key still COMPOSITE; and
 * the News revision still naming its Centre.
 */
export async function verifyRestoredPhase16(
  sql: SqlSession,
  fixture: Phase16Fixture,
  expected: Readonly<Record<string, string>>,
): Promise<string> {
  deepStrictEqual(
    await capturePhase16Fixture(sql, fixture),
    expected,
    'Phase-16 Global Network authoritative values changed during recovery.',
  );
  const f = fixture;

  const [label] = await sql.query<{ name: string }>(
    `SELECT [name] FROM [dbo].[CentreLabel]
     WHERE [centreId]=N'${f.physicalCentreId}' AND [locale]=N'ur';`,
  );
  if (label?.name !== TEXT.centreNameUr) {
    throw new Error('Restored Urdu Phase-16 Centre name does not match.');
  }

  const [coordinates] = await sql.query<{ latitude: string; longitude: string }>(
    `SELECT CONVERT(NVARCHAR(20),[latitude]) AS [latitude], CONVERT(NVARCHAR(20),[longitude]) AS [longitude]
     FROM [dbo].[Centre] WHERE [id]=N'${f.physicalCentreId}';`,
  );
  if (
    coordinates?.latitude !== TEXT.latitude ||
    coordinates.longitude !== TEXT.longitude
  ) {
    throw new Error(
      `Restored Phase-16 coordinates are not exact: ${coordinates?.latitude ?? '(none)'}, ${coordinates?.longitude ?? '(none)'}.`,
    );
  }

  const [contact] = await sql.query<{ value: string }>(
    `SELECT [value] FROM [dbo].[CentreContact]
     WHERE [centreId]=N'${f.physicalCentreId}' AND [position]=2 AND [channel]=N'website';`,
  );
  if (contact?.value !== TEXT.website) {
    throw new Error('Restored Phase-16 Centre website does not match.');
  }

  const [triggers] = await sql.query<{ total: number }>(
    `SELECT COUNT_BIG(*) AS [total] FROM sys.triggers
     WHERE [name] IN (${list(...SLUG_TRIGGERS)}) AND [is_disabled]=0;`,
  );
  if (Number(triggers?.total ?? 0) !== SLUG_TRIGGERS.length) {
    throw new Error('Restored database lost a Phase-16 slug-reservation trigger.');
  }

  const tables = PHASE16_TABLES.map((table) => `OBJECT_ID(N'${table}')`).join(',');
  const broken = await sql.query<{ name: string }>(
    `SELECT [name] FROM sys.check_constraints
     WHERE parent_object_id IN (${tables}) AND (is_disabled=1 OR is_not_trusted=1)
     UNION ALL
     SELECT [name] FROM sys.foreign_keys
     WHERE (parent_object_id IN (${tables}) OR [name]=N'NewsArticleRevision_centreId_fkey')
       AND (is_disabled=1 OR is_not_trusted=1
            OR delete_referential_action<>0 OR update_referential_action<>0);`,
  );
  if (broken.length > 0) {
    throw new Error(
      `Restored Phase-16 constraints are not trusted: ${broken.map((row) => row.name).join(', ')}`,
    );
  }

  const [counts] = await sql.query<{ checks: number; keys: number; centreKey: number }>(
    `SELECT
       (SELECT COUNT_BIG(*) FROM sys.check_constraints WHERE parent_object_id IN (${tables})) AS [checks],
       (SELECT COUNT_BIG(*) FROM sys.foreign_keys WHERE parent_object_id IN (${tables})) AS [keys],
       (SELECT COUNT_BIG(*) FROM sys.foreign_keys WHERE [name]=N'NewsArticleRevision_centreId_fkey'
          AND parent_object_id=OBJECT_ID(N'NewsArticleRevision')
          AND referenced_object_id=OBJECT_ID(N'Centre')) AS [centreKey];`,
  );
  // 31 CHECKs and 17 foreign keys, exactly as the migration creates them: a
  // restore that silently lost one would otherwise read as "none untrusted".
  if (
    Number(counts?.checks ?? 0) !== 31 ||
    Number(counts?.keys ?? 0) !== 17 ||
    Number(counts?.centreKey ?? 0) !== 1
  ) {
    throw new Error(
      `Restored Phase-16 constraint set is incomplete: ${String(counts?.checks ?? 0)} CHECKs, ` +
        `${String(counts?.keys ?? 0)} foreign keys, ${String(counts?.centreKey ?? 0)} News Centre key.`,
    );
  }

  const composite = await sql.query<{ name: string; columns: number }>(
    `SELECT fk.[name] AS [name], COUNT_BIG(*) AS [columns]
     FROM sys.foreign_keys fk
     JOIN sys.foreign_key_columns c ON c.constraint_object_id = fk.object_id
     WHERE fk.[name] IN (${list(...SAME_COUNTRY_FOREIGN_KEYS)})
     GROUP BY fk.[name];`,
  );
  if (
    composite.length !== SAME_COUNTRY_FOREIGN_KEYS.length ||
    composite.some((row) => Number(row.columns) !== 2)
  ) {
    throw new Error(
      `Restored same-Country foreign keys are not all composite: ${composite
        .map((row) => `${row.name}(${String(row.columns)})`)
        .join(', ')}`,
    );
  }

  const [revision] = await sql.query<{ centreId: string | null }>(
    `SELECT [centreId] FROM [dbo].[NewsArticleRevision]
     WHERE [ownerId]=N'${f.newsId}' AND [number]=1;`,
  );
  if (revision?.centreId !== f.physicalCentreId) {
    throw new Error('Restored Phase-16 News revision no longer names its Centre.');
  }

  return 'countries with and without regions, renamed region and centre slugs, served cities, contacts, exact coordinates, virtual centre and centre-scoped News intact';
}
