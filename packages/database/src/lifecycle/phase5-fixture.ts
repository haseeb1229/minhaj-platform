import 'server-only';

import { randomUUID } from 'node:crypto';

import type { SqlSession } from './sql-connection.ts';

/**
 * POPULATED PHASE-5 STATE for the recovery rehearsal.
 *
 * WHY IT IS SEPARATE FROM `phase2-fixture.ts` AND `phase3b-fixture.ts`. People &
 * Contributors is a different bounded context with a different owner, and a
 * shared fixture module would mean one file that three phases' rules have to
 * agree in. They share the rehearsal, not the data.
 *
 * WHAT IT PROVES THAT SCHEMA CHECKS DO NOT. `verifyRestoredSchema` proves the
 * contributor TABLES came back. This proves the contributors did — and, more
 * importantly, that the RELATIONSHIPS between them survived:
 *
 *   - a contributor with ALL FOUR profile facets, each with its own status, so
 *     a restore that recovered the rows and flattened the four aggregates into
 *     one would be caught;
 *   - a HISTORICAL contributor with no account at all, which is the ordinary
 *     case DOMAIN_MODEL.md §5.1 names first;
 *   - a contributor LINKED to an account, so the optional one-to-one edge is
 *     exercised rather than assumed;
 *   - translations in all three interface locales, read back character by
 *     character, so a restore that returned Urdu as replacement characters is a
 *     failure rather than three corrupted rows nobody looks at;
 *   - an independent facet lifecycle: one facet archived while another stays
 *     active on the same contributor.
 *
 * NOTHING HERE IS REAL. The slugs carry this run's identifier and are
 * unmistakably rehearsal machinery; the localised names are the literal words
 * for "proof" rather than any real person's name, and no qualification, no
 * expertise and no religious standing is invented for anybody
 * (OPEN_DECISIONS.md §6.3, SECURITY_BASELINE.md §18.1).
 */

/** Marks every row this module writes, so a rehearsal's residue is obvious. */
const TAG = 'phase5-recovery';

/**
 * Localised names in the three interface locales.
 *
 * Deliberately NOT a person's name: they are the words "recovery proof
 * contributor" in each script, chosen so the assertions below can prove that
 * Urdu and Arabic text survived a backup and restore without putting an
 * invented human being into a database.
 */
const NAMES = {
  en: 'Recovery proof contributor',
  ur: 'بحالی کے ثبوت کا معاون',
  ar: 'مساهم إثبات الاستعادة',
} as const;

/** An alternative spelling, to prove the name-variant relation came back. */
const VARIANT = 'بحالی کا متبادل نام';

export interface Phase5Fixture {
  readonly runId: string;
  /** The contributor holding all four facets and an account link. */
  readonly linkedPersonId: string;
  readonly linkedSlug: string;
  /** The account it is linked to. */
  readonly accountId: string;
  readonly accountEmail: string;
  /** A historical contributor with no account, as §5.1 requires to be possible. */
  readonly historicalPersonId: string;
  readonly historicalSlug: string;
  readonly variantId: string;
}

export function newPhase5Fixture(): Phase5Fixture {
  // Random per run, so a restored row can only have come from THIS run's
  // backup — residue from an earlier rehearsal cannot satisfy the assertions.
  const runId = randomUUID().replaceAll('-', '');

  return {
    runId,
    linkedPersonId: randomUUID(),
    linkedSlug: `${TAG}-linked-${runId}`,
    // SHORT ON PURPOSE. `User.id` is NVARCHAR(36) — Better Auth's identifiers
    // are that size — so a readable `phase5-recovery-account-…` prefix would be
    // truncated by the column rather than stored. `p5-` plus the run identifier
    // is 35 characters and still carries the run, which is what makes a
    // restored row provably this run's.
    accountId: `p5-${runId}`,
    // The reserved `.invalid` TLD, which can never resolve.
    accountEmail: `${TAG}-${runId}@people-recovery.invalid`,
    historicalPersonId: randomUUID(),
    historicalSlug: `${TAG}-historical-${runId}`,
    variantId: randomUUID(),
  };
}

/** Rejects anything that is not this module's own generated shape. */
function assertSafe(fixture: Phase5Fixture): void {
  if (!/^[0-9a-f]{32}$/.test(fixture.runId)) {
    throw new Error('Phase-5 fixture runId does not match the expected pattern.');
  }

  for (const [name, value] of Object.entries(fixture)) {
    if (name === 'runId') continue;
    if (typeof value !== 'string') {
      throw new Error(`Phase-5 fixture field '${name}' is not a string.`);
    }
    // Every generated value either carries the whole run identifier or is a
    // UUID this module minted. A truncated one would be a value this module
    // cannot prove it generated.
    const carriesRun = value.includes(fixture.runId);
    const isUuid = /^[0-9a-fA-F-]{36}$/.test(value);
    if (!carriesRun && !isUuid) {
      throw new Error(`Phase-5 fixture field '${name}' is not a safe generated value.`);
    }
  }

  if (!fixture.accountEmail.endsWith('.invalid')) {
    throw new Error('Phase-5 fixture address is not on the reserved .invalid TLD.');
  }
}

/**
 * Writes the populated Phase-5 state into the SOURCE database, before backup.
 *
 * Written with the MIGRATION principal, like the rest of this administrative
 * tooling. The rows are inserted in dependency order so the real foreign keys
 * and the real invariant triggers are exercised rather than worked around.
 */
export async function writePhase5Fixture(
  admin: SqlSession,
  fixture: Phase5Fixture,
): Promise<void> {
  assertSafe(fixture);

  const f = fixture;

  // The account first: `Person.userId` has a real foreign key to it, so an
  // out-of-order insert would be refused — which is itself part of what makes
  // this fixture exercise the schema rather than describe it.
  await admin.query(`
    INSERT INTO [dbo].[User]
      ([id], [name], [email], [emailVerified], [createdAt], [updatedAt],
       [locale], [status], [twoFactorEnabled])
    VALUES
      (N'${f.accountId}', N'Recovery proof account', N'${f.accountEmail}', 0,
       SYSUTCDATETIME(), SYSUTCDATETIME(), N'en', N'active', 0);
  `);

  await admin.query(`
    INSERT INTO [dbo].[Person] ([id], [slug], [userId], [primaryLocale], [status])
    VALUES (N'${f.linkedPersonId}', N'${f.linkedSlug}', N'${f.accountId}', N'en', N'published');
  `);

  // THE HISTORICAL CONTRIBUTOR: no account, and an Urdu original. Both halves
  // matter — §5.1 names historical figures with no account first, and a corpus
  // that is substantially Urdu-original is why `primaryLocale` is stored.
  await admin.query(`
    INSERT INTO [dbo].[Person] ([id], [slug], [userId], [primaryLocale], [status])
    VALUES (N'${f.historicalPersonId}', N'${f.historicalSlug}', NULL, N'ur', N'published');
  `);

  await admin.query(`
    INSERT INTO [dbo].[PersonTranslation] ([personId], [locale], [name], [biography])
    VALUES
      (N'${f.linkedPersonId}', N'en', N'${NAMES.en}', NULL),
      (N'${f.linkedPersonId}', N'ur', N'${NAMES.ur}', NULL),
      (N'${f.linkedPersonId}', N'ar', N'${NAMES.ar}', NULL),
      (N'${f.historicalPersonId}', N'ur', N'${NAMES.ur}', NULL);
  `);

  await admin.query(`
    INSERT INTO [dbo].[PersonNameVariant] ([id], [personId], [locale], [value], [normalised])
    VALUES (N'${f.variantId}', N'${f.historicalPersonId}', N'ur', N'${VARIANT}', N'${VARIANT}');
  `);

  // ALL FOUR FACETS ON ONE CONTRIBUTOR, with two different statuses — which is
  // what makes "four distinct aggregates with independent lifecycles" something
  // the restore has to reproduce rather than something the schema merely allows.
  await admin.query(`
    INSERT INTO [dbo].[AuthorProfile] ([id], [personId], [status])
    VALUES (NEWID(), N'${f.linkedPersonId}', N'active');
  `);
  await admin.query(`
    INSERT INTO [dbo].[SpeakerProfile] ([id], [personId], [status])
    VALUES (NEWID(), N'${f.linkedPersonId}', N'active');
  `);
  await admin.query(`
    INSERT INTO [dbo].[ScholarProfile] ([id], [personId], [status])
    VALUES (NEWID(), N'${f.linkedPersonId}', N'archived');
  `);
  await admin.query(`
    INSERT INTO [dbo].[TeacherProfile] ([id], [personId], [status])
    VALUES (NEWID(), N'${f.linkedPersonId}', N'active');
  `);

  // The historical contributor holds the author facet only, so a restore that
  // copied one contributor's facets onto another would be visible.
  await admin.query(`
    INSERT INTO [dbo].[AuthorProfile] ([id], [personId], [status])
    VALUES (NEWID(), N'${f.historicalPersonId}', N'active');
  `);

  await admin.query(`
    INSERT INTO [dbo].[TeacherProfileTranslation] ([teacherProfileId], [locale], [biography], [subjects])
    SELECT [id], N'ur', N'${NAMES.ur}', NULL FROM [dbo].[TeacherProfile]
    WHERE [personId] = N'${f.linkedPersonId}';
  `);

  await admin.query(`
    INSERT INTO [dbo].[TeacherProfileLanguage] ([teacherProfileId], [languageCode])
    SELECT [id], N'ur' FROM [dbo].[TeacherProfile]
    WHERE [personId] = N'${f.linkedPersonId}';
  `);
}

/** What was actually found in the restored database, per table. */
export interface Phase5Restored {
  readonly table: string;
  readonly detail: string;
}

function expect(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

/**
 * Reads the populated contributors back out of the RESTORED database.
 *
 * Every value written before the backup is compared to what came back. Finding
 * a row with the right identifier is not sufficient: a restore that recovered
 * the identifiers and lost the account link, flattened the four facets, or
 * mangled the script would pass such a check.
 */
export async function verifyRestoredPhase5(
  restored: SqlSession,
  fixture: Phase5Fixture,
): Promise<readonly Phase5Restored[]> {
  assertSafe(fixture);

  const f = fixture;
  const found: Phase5Restored[] = [];

  // ---- the contributors themselves -----------------------------------------
  const people = await restored.query<{
    id: string;
    slug: string;
    userId: string | null;
    primaryLocale: string;
    status: string;
  }>(`
    SELECT [id], [slug], [userId], [primaryLocale], [status]
    FROM [dbo].[Person]
    WHERE [id] IN (N'${f.linkedPersonId}', N'${f.historicalPersonId}')
    ORDER BY [slug];
  `);

  expect(
    people.length === 2,
    `Restored fixture contributors: ${people.length}, expected 2.`,
  );

  const linked = people.find((row) => row.id === f.linkedPersonId);
  const historical = people.find((row) => row.id === f.historicalPersonId);

  expect(linked?.slug === f.linkedSlug, 'Restored linked contributor slug changed.');
  expect(linked?.status === 'published', 'Restored linked contributor status changed.');
  expect(
    linked?.userId === f.accountId,
    'Restored contributor LOST its account link — the optional one-to-one edge did not survive.',
  );

  expect(
    historical?.userId === null,
    'Restored historical contributor acquired an account link it never had.',
  );
  expect(
    historical?.primaryLocale === 'ur',
    `Restored historical contributor original language is '${historical?.primaryLocale}', expected 'ur'.`,
  );

  found.push({
    table: 'Person',
    detail: 'linked and historical contributors intact, account edge present',
  });

  // ---- the localisation, script and all ------------------------------------
  const translations = await restored.query<{ locale: string; name: string }>(`
    SELECT [locale], [name] FROM [dbo].[PersonTranslation]
    WHERE [personId] = N'${f.linkedPersonId}' ORDER BY [locale];
  `);

  expect(
    translations.map((row) => row.locale).join(',') === 'ar,en,ur',
    `Restored contributor translations are ${translations.map((row) => row.locale).join(',')}.`,
  );

  for (const locale of ['en', 'ur', 'ar'] as const) {
    const row = translations.find((entry) => entry.locale === locale);
    expect(
      row?.name === NAMES[locale],
      `Restored ${locale} contributor name is '${row?.name ?? '(missing)'}', expected '${NAMES[locale]}'.`,
    );
  }

  // The script itself, checked separately from the string comparison above. A
  // restore that returned the right bytes under the wrong collation would fail
  // the comparison; this says WHY in terms a reader can act on.
  const urdu = translations.find((entry) => entry.locale === 'ur');
  expect(
    /\p{Script=Arabic}/u.test(urdu?.name ?? ''),
    'Restored Urdu contributor name lost its script.',
  );

  found.push({
    table: 'PersonTranslation',
    detail: 'en/ur/ar names intact, non-Latin script preserved',
  });

  // ---- the name variant ----------------------------------------------------
  const variants = await restored.query<{ value: string; normalised: string }>(`
    SELECT [value], [normalised] FROM [dbo].[PersonNameVariant]
    WHERE [id] = N'${f.variantId}';
  `);
  expect(variants.length === 1, 'Restored name variant is missing.');
  expect(variants[0]?.value === VARIANT, 'Restored name variant value changed.');
  expect(
    /\p{Script=Arabic}/u.test(variants[0]?.normalised ?? ''),
    'Restored name variant lost its script in the comparison column.',
  );
  found.push({ table: 'PersonNameVariant', detail: 'value and comparison form intact' });

  // ---- FOUR DISTINCT AGGREGATES, with independent lifecycles ---------------
  //
  // Read from four separate tables, which is the point: a restore that had
  // somehow merged them would have nowhere to put these four answers.
  const facets: { table: string; status: string | undefined }[] = [];
  for (const table of [
    'AuthorProfile',
    'SpeakerProfile',
    'ScholarProfile',
    'TeacherProfile',
  ]) {
    const rows = await restored.query<{ status: string }>(`
      SELECT [status] FROM [dbo].[${table}] WHERE [personId] = N'${f.linkedPersonId}';
    `);
    expect(rows.length === 1, `Restored ${table} for the linked contributor is missing.`);
    facets.push({ table, status: rows[0]?.status });
  }

  expect(
    facets.find((facet) => facet.table === 'ScholarProfile')?.status === 'archived',
    'Restored scholar facet lost its archived status — the facets no longer have independent lifecycles.',
  );
  for (const table of ['AuthorProfile', 'SpeakerProfile', 'TeacherProfile']) {
    expect(
      facets.find((facet) => facet.table === table)?.status === 'active',
      `Restored ${table} status changed.`,
    );
  }

  found.push({
    table: 'profiles',
    detail: 'all four facets present, one archived and three active',
  });

  // The historical contributor holds exactly ONE facet, so a restore that
  // copied one contributor's facets onto another is visible.
  const historicalFacets = await restored.query<{ total: number }>(`
    SELECT
      (SELECT COUNT_BIG(*) FROM [dbo].[AuthorProfile] WHERE [personId] = N'${f.historicalPersonId}')
      + (SELECT COUNT_BIG(*) FROM [dbo].[SpeakerProfile] WHERE [personId] = N'${f.historicalPersonId}')
      + (SELECT COUNT_BIG(*) FROM [dbo].[ScholarProfile] WHERE [personId] = N'${f.historicalPersonId}')
      + (SELECT COUNT_BIG(*) FROM [dbo].[TeacherProfile] WHERE [personId] = N'${f.historicalPersonId}')
      AS total;
  `);
  expect(
    Number(historicalFacets[0]?.total ?? -1) === 1,
    `Restored historical contributor holds ${historicalFacets[0]?.total} facets, expected exactly 1.`,
  );
  found.push({
    table: 'profiles (historical)',
    detail: 'exactly one facet, no cross-contamination',
  });

  // ---- profile child rows --------------------------------------------------
  const teacherDetail = await restored.query<{
    locale: string;
    biography: string | null;
  }>(`
    SELECT t.[locale], t.[biography]
    FROM [dbo].[TeacherProfileTranslation] t
    JOIN [dbo].[TeacherProfile] p ON p.[id] = t.[teacherProfileId]
    WHERE p.[personId] = N'${f.linkedPersonId}';
  `);
  expect(teacherDetail.length === 1, 'Restored teacher facet detail is missing.');
  expect(
    teacherDetail[0]?.biography === NAMES.ur,
    'Restored teacher facet biography changed.',
  );

  const teacherLanguages = await restored.query<{ languageCode: string }>(`
    SELECT l.[languageCode]
    FROM [dbo].[TeacherProfileLanguage] l
    JOIN [dbo].[TeacherProfile] p ON p.[id] = l.[teacherProfileId]
    WHERE p.[personId] = N'${f.linkedPersonId}';
  `);
  expect(
    teacherLanguages.map((row) => row.languageCode).join(',') === 'ur',
    'Restored teacher facet languages changed.',
  );

  found.push({
    table: 'profile detail',
    detail: 'localised teacher facet and its language set intact',
  });

  // ---- NO CAPABILITY WAS RESTORED INTO EXISTENCE ---------------------------
  //
  // The fixture creates four facets including a teacher one, and grants
  // nothing. A restore that somehow produced an assignment for this
  // contributor's account would mean a profile had become an authorisation
  // somewhere in the round trip (DOMAIN_MODEL.md §4.5).
  const assignments = await restored.query<{ total: number }>(`
    SELECT COUNT_BIG(*) AS total FROM [dbo].[RoleAssignment]
    WHERE [userId] = N'${f.accountId}';
  `);
  expect(
    Number(assignments[0]?.total ?? -1) === 0,
    `Restored contributor account holds ${assignments[0]?.total} role assignments; the fixture granted none.`,
  );
  found.push({
    table: 'RoleAssignment (contributor)',
    detail: 'four facets, zero grants — a profile is not an authorisation',
  });

  return found;
}

/**
 * The restored contributors' REFERENTIAL INTEGRITY, as the database reports it.
 *
 * Three claims, and each is a different way a restore can look complete and not
 * be:
 *
 *   - the foreign keys exist and are TRUSTED. A restore can leave a constraint
 *     present but `is_not_trusted`, which means the database is no longer
 *     enforcing it — the rows would still be there and the guarantee would not.
 *   - the invariant TRIGGERS came back and are ENABLED. They are the
 *     primary-translation and name-variant-bound protections, and a restore
 *     that lost them would leave contributors that look intact and can be
 *     corrupted by the next write.
 *   - the unique account link is still UNIQUE and still FILTERED. Without the
 *     filter it would permit exactly one contributor without an account, which
 *     is the opposite of what §5.1 requires.
 */
export async function verifyRestoredPeopleIntegrity(
  restored: SqlSession,
  fixture: Phase5Fixture,
): Promise<string> {
  assertSafe(fixture);

  const constraints = await restored.query<{ name: string; untrusted: number }>(`
    SELECT fk.name, fk.is_not_trusted AS untrusted
    FROM sys.foreign_keys fk
    WHERE fk.name IN (
      N'Person_userId_fkey', N'PersonTranslation_personId_fkey',
      N'PersonNameVariant_personId_fkey', N'AuthorProfile_personId_fkey',
      N'SpeakerProfile_personId_fkey', N'ScholarProfile_personId_fkey',
      N'TeacherProfile_personId_fkey'
    );
  `);

  expect(
    constraints.length === 7,
    `Restored People foreign keys: ${constraints.map((row) => row.name).join(', ') || '(none)'}`,
  );
  for (const constraint of constraints) {
    expect(
      Number(constraint.untrusted) === 0,
      `Restored ${constraint.name} is NOT TRUSTED — the database has stopped enforcing it.`,
    );
  }

  const triggers = await restored.query<{ name: string; disabled: number }>(`
    SELECT name, is_disabled AS disabled FROM sys.triggers
    WHERE name IN (
      N'PeoplePersonPrimaryName', N'PeoplePersonPrimaryLocale',
      N'PeopleNameVariantBound'
    );
  `);
  expect(
    triggers.length === 3,
    `Restored People triggers: ${triggers.map((row) => row.name).join(', ') || '(none)'}`,
  );
  for (const trigger of triggers) {
    expect(
      Number(trigger.disabled) === 0,
      `Restored trigger ${trigger.name} is DISABLED — the invariant is not being enforced.`,
    );
  }

  const [peopleProcedures] = await restored.query<{ total: number }>(`
    SELECT COUNT_BIG(*) AS total FROM sys.procedures
    WHERE [name] IN (N'PeopleCreatePerson', N'PeopleAddNameVariant');
  `);
  expect(
    Number(peopleProcedures?.total ?? 0) === 2,
    'A restored People write-boundary procedure is missing.',
  );

  const [accountIndex] = await restored.query<{
    isUnique: number;
    hasFilter: number;
  }>(`
    SELECT i.is_unique AS isUnique, i.has_filter AS hasFilter
    FROM sys.indexes i
    WHERE i.object_id = OBJECT_ID(N'[dbo].[Person]') AND i.name = N'Person_userId_key';
  `);
  expect(accountIndex !== undefined, 'Restored Person_userId_key is missing.');
  expect(
    Number(accountIndex?.isUnique) === 1,
    'Restored Person_userId_key is no longer UNIQUE — one account could link to two contributors.',
  );
  expect(
    Number(accountIndex?.hasFilter) === 1,
    'Restored Person_userId_key is no longer FILTERED — only one contributor could exist without an account.',
  );

  // The link is ENFORCEABLE, not merely present: a second contributor pointing
  // at the same account must be refused by the restored index.
  let duplicateRefused = false;
  try {
    await restored.query(`
      INSERT INTO [dbo].[Person] ([id], [slug], [userId], [primaryLocale], [status])
      VALUES (NEWID(), N'${fixture.linkedSlug}-duplicate', N'${fixture.accountId}', N'en', N'draft');
    `);
  } catch {
    duplicateRefused = true;
  }
  expect(
    duplicateRefused,
    'The restored database ACCEPTED a second contributor linked to the same account.',
  );

  // And a contributor with NO account is still accepted, which is the half a
  // too-strict index would break.
  await restored.query(`
    INSERT INTO [dbo].[Person] ([id], [slug], [userId], [primaryLocale], [status])
    VALUES (NEWID(), N'${fixture.historicalSlug}-second', NULL, N'en', N'draft');
  `);

  return (
    '7 trusted foreign keys, 3 enabled invariant triggers, ' +
    'filtered unique account link enforced, unlinked contributors still permitted'
  );
}
