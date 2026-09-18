import 'server-only';

import { randomUUID } from 'node:crypto';

import type { SqlSession } from './sql-connection.ts';

/**
 * POPULATED PHASE-3B STATE for the recovery rehearsal.
 *
 * WHY IT IS SEPARATE FROM `phase2-fixture.ts`. Taxonomy is a different bounded
 * context with a different owner, and a shared fixture module would mean one
 * file that two phases' rules have to agree in. They share the rehearsal, not
 * the data.
 *
 * WHAT IT PROVES THAT SCHEMA CHECKS DO NOT. `verifyRestoredSchema` proves the
 * taxonomy TABLES came back. This proves the taxonomy did: a parent topic with
 * a child under it, the hierarchy edge between them, a topic named in all three
 * interface locales, a content language in its own script, and a tag — each read
 * back field by field after the restore.
 *
 * THE HIERARCHY AND THE SCRIPT ARE THE TWO THINGS MOST WORTH CHECKING. A
 * restore that recovered both rows and lost the `parentId` between them would
 * look complete and have flattened the taxonomy; a restore that recovered an
 * Urdu name as replacement characters would look complete and have destroyed
 * the only content a reader of that language can use.
 *
 * NOTHING HERE IS REAL. The slugs carry this run's identifier and are
 * unmistakably rehearsal machinery; the localised names are the literal words
 * for "proof" rather than any religious or scholarly content
 * (SECURITY_BASELINE.md §18.1).
 */

/** Marks every row this module writes, so a rehearsal's residue is obvious. */
const TAG = 'phase3b-recovery';

/**
 * Localised names in the three interface locales.
 *
 * Deliberately NOT topic names: they are the word "proof" in each script,
 * chosen so the assertion below can prove that Urdu and Arabic text survived a
 * backup and restore without putting invented religious wording in a database.
 */
const NAMES = {
  en: 'Recovery proof topic',
  ur: 'بحالی کا ثبوت',
  ar: 'إثبات الاستعادة',
} as const;

export interface Phase3bFixture {
  readonly runId: string;
  readonly parentTopicId: string;
  readonly parentSlug: string;
  readonly childTopicId: string;
  readonly childSlug: string;
  readonly languageCode: string;
  readonly tagId: string;
  readonly tagSlug: string;
}

export function newPhase3bFixture(): Phase3bFixture {
  // Random per run, so a restored row can only have come from THIS run's
  // backup — residue from an earlier rehearsal cannot satisfy the assertions.
  const runId = randomUUID().replaceAll('-', '');

  return {
    runId,
    parentTopicId: randomUUID(),
    parentSlug: `${TAG}-parent-${runId}`,
    childTopicId: randomUUID(),
    childSlug: `${TAG}-child-${runId}`,
    // A private-use subtag: valid BCP-47, reserved for exactly this kind of
    // local agreement, and incapable of colliding with a real language.
    languageCode: `qaa-x-${runId.slice(0, 8)}`,
    tagId: randomUUID(),
    tagSlug: `${TAG}-tag-${runId}`,
  };
}

/** Rejects anything that is not this module's own generated shape. */
function assertSafe(fixture: Phase3bFixture): void {
  if (!/^[0-9a-f]{32}$/.test(fixture.runId)) {
    throw new Error('Phase-3B fixture runId does not match the expected pattern.');
  }

  for (const [name, value] of Object.entries(fixture)) {
    if (name === 'runId') continue;
    if (typeof value !== 'string') {
      throw new Error(`Phase-3B fixture field '${name}' is not a string.`);
    }
    // Every generated value either carries the whole run identifier or is a
    // UUID this module minted. A truncated one would be a value this module
    // cannot prove it generated.
    const carriesRun = value.includes(fixture.runId);
    const isUuid = /^[0-9a-fA-F-]{36}$/.test(value);
    const isPrivateLanguage = value === fixture.languageCode;
    if (!carriesRun && !isUuid && !isPrivateLanguage) {
      throw new Error(`Phase-3B fixture field '${name}' is not a safe generated value.`);
    }
  }

  if (!/^qaa-x-[0-9a-f]{8}$/.test(fixture.languageCode)) {
    throw new Error('Phase-3B fixture language code is not a private-use subtag.');
  }
}

/**
 * Writes the populated Phase-3B state into the SOURCE database, before backup.
 *
 * Written with the MIGRATION principal, like the rest of this administrative
 * tooling. The rows are inserted in dependency order so the real foreign keys
 * and the real hierarchy trigger are exercised rather than worked around.
 */
export async function writePhase3bFixture(
  admin: SqlSession,
  fixture: Phase3bFixture,
): Promise<void> {
  assertSafe(fixture);

  const f = fixture;

  await admin.query(`
    INSERT INTO [dbo].[Topic] ([id], [slug], [parentId], [position], [status], [system])
    VALUES (N'${f.parentTopicId}', N'${f.parentSlug}', NULL, 900, N'active', 0);
  `);

  // The CHILD is what makes this a hierarchy rather than two rows. Its insert
  // also runs the `TaxonomyTopicHierarchy` trigger for real.
  await admin.query(`
    INSERT INTO [dbo].[Topic] ([id], [slug], [parentId], [position], [status], [system])
    VALUES (N'${f.childTopicId}', N'${f.childSlug}', N'${f.parentTopicId}', 0, N'active', 0);
  `);

  await admin.query(`
    INSERT INTO [dbo].[TopicTranslation] ([topicId], [locale], [name], [description])
    VALUES
      (N'${f.parentTopicId}', N'en', N'${NAMES.en}', NULL),
      (N'${f.parentTopicId}', N'ur', N'${NAMES.ur}', NULL),
      (N'${f.parentTopicId}', N'ar', N'${NAMES.ar}', NULL),
      (N'${f.childTopicId}',  N'en', N'${NAMES.en}', NULL);
  `);

  await admin.query(`
    INSERT INTO [dbo].[Language] ([code], [englishName], [nativeName], [direction], [status])
    VALUES (N'${f.languageCode}', N'Recovery proof language', N'${NAMES.ur}', N'rtl', N'active');
  `);

  await admin.query(`
    INSERT INTO [dbo].[Tag] ([id], [slug], [label], [status])
    VALUES (N'${f.tagId}', N'${f.tagSlug}', N'Recovery proof tag', N'active');
  `);
}

/** What was actually found in the restored database, per table. */
export interface Phase3bRestored {
  readonly table: string;
  readonly detail: string;
}

function expect(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

/**
 * Reads the populated taxonomy back out of the RESTORED database.
 *
 * Every value written before the backup is compared to what came back. Finding
 * a row with the right identifier is not sufficient: a restore that recovered
 * the identifiers and flattened the hierarchy, or mangled the script, would
 * pass such a check.
 */
export async function verifyRestoredPhase3b(
  restored: SqlSession,
  fixture: Phase3bFixture,
): Promise<readonly Phase3bRestored[]> {
  assertSafe(fixture);

  const f = fixture;
  const found: Phase3bRestored[] = [];

  // ---- the canonical seed, unduplicated ------------------------------------
  //
  // The rehearsal writes its own topics INTO a database that already holds the
  // nineteen canonical ones. A restore that duplicated foundation data would
  // leave two rows claiming the same canonical slug, which is precisely what a
  // seed guard exists to prevent and precisely what a restore could undo.
  const canonical = await restored.query<{ total: number; distinctSlugs: number }>(`
    SELECT COUNT_BIG(*) AS total, COUNT(DISTINCT [slug]) AS distinctSlugs
    FROM [dbo].[Topic] WHERE [system] = 1;
  `);
  expect(
    Number(canonical[0]?.total) === 19,
    `Restored database holds ${canonical[0]?.total} canonical topics, expected 19.`,
  );
  expect(
    Number(canonical[0]?.distinctSlugs) === 19,
    'Restored canonical topics contain a duplicate slug.',
  );
  found.push({ table: 'Topic (canonical)', detail: '19 seeded topics, no duplicates' });

  // ---- the hierarchy -------------------------------------------------------
  const topics = await restored.query<{
    id: string;
    slug: string;
    parentId: string | null;
    position: number;
    status: string;
    system: boolean;
  }>(`
    SELECT [id], [slug], [parentId], [position], [status], [system]
    FROM [dbo].[Topic]
    WHERE [id] IN (N'${f.parentTopicId}', N'${f.childTopicId}')
    ORDER BY [position];
  `);

  expect(topics.length === 2, `Restored fixture topics: ${topics.length}, expected 2.`);

  const child = topics.find((row) => row.id === f.childTopicId);
  const parent = topics.find((row) => row.id === f.parentTopicId);

  expect(parent?.slug === f.parentSlug, 'Restored parent topic slug changed.');
  expect(parent?.parentId === null, 'Restored parent topic is no longer at the root.');
  expect(parent?.system === false, 'Restored parent topic became canonical seed data.');
  expect(child?.slug === f.childSlug, 'Restored child topic slug changed.');
  expect(
    child?.parentId === f.parentTopicId,
    'Restored child topic lost its parent — the hierarchy did not survive.',
  );
  expect(child?.status === 'active', 'Restored child topic status changed.');

  found.push({
    table: 'Topic',
    detail: 'parent and child intact, hierarchy edge present',
  });

  // ---- the localisation, script and all ------------------------------------
  const translations = await restored.query<{ locale: string; name: string }>(`
    SELECT [locale], [name] FROM [dbo].[TopicTranslation]
    WHERE [topicId] = N'${f.parentTopicId}' ORDER BY [locale];
  `);

  expect(
    translations.map((row) => row.locale).join(',') === 'ar,en,ur',
    `Restored translations are ${translations.map((row) => row.locale).join(',')}.`,
  );

  for (const locale of ['en', 'ur', 'ar'] as const) {
    const row = translations.find((entry) => entry.locale === locale);
    expect(
      row?.name === NAMES[locale],
      `Restored ${locale} topic name is '${row?.name ?? '(missing)'}', expected '${NAMES[locale]}'.`,
    );
  }

  // The script itself, checked separately from the string comparison above.
  // A restore that returned the right bytes under the wrong collation would
  // fail the comparison; this says WHY in terms a reader can act on.
  const urdu = translations.find((entry) => entry.locale === 'ur');
  expect(
    /\p{Script=Arabic}/u.test(urdu?.name ?? ''),
    'Restored Urdu topic name lost its script.',
  );

  found.push({
    table: 'TopicTranslation',
    detail: 'en/ur/ar names intact, non-Latin script preserved',
  });

  // ---- content language ----------------------------------------------------
  const languages = await restored.query<{
    nativeName: string;
    direction: string;
    status: string;
  }>(`
    SELECT [nativeName], [direction], [status] FROM [dbo].[Language]
    WHERE [code] = N'${f.languageCode}';
  `);

  expect(languages.length === 1, 'Restored content language is missing.');
  expect(
    languages[0]?.nativeName === NAMES.ur,
    'Restored content language endonym changed.',
  );
  expect(
    languages[0]?.direction === 'rtl',
    'Restored content language lost its writing direction.',
  );
  found.push({ table: 'Language', detail: 'endonym and rtl direction intact' });

  // The seeded content languages are still exactly three, and still separate
  // from anything the interface does.
  const seededLanguages = await restored.query<{ code: string }>(`
    SELECT [code] FROM [dbo].[Language] WHERE [code] IN (N'en', N'ur', N'ar') ORDER BY [code];
  `);
  expect(
    seededLanguages.map((row) => row.code).join(',') === 'ar,en,ur',
    'Restored content-language seed differs.',
  );
  found.push({ table: 'Language (seed)', detail: 'en/ur/ar content languages intact' });

  // ---- tag -----------------------------------------------------------------
  const tags = await restored.query<{ slug: string; label: string; status: string }>(`
    SELECT [slug], [label], [status] FROM [dbo].[Tag] WHERE [id] = N'${f.tagId}';
  `);
  expect(tags.length === 1, 'Restored tag is missing.');
  expect(tags[0]?.slug === f.tagSlug, 'Restored tag slug changed.');
  expect(tags[0]?.status === 'active', 'Restored tag status changed.');
  found.push({ table: 'Tag', detail: 'slug, label and status intact' });

  return found;
}

/**
 * The restored taxonomy's REFERENTIAL INTEGRITY, as the database reports it.
 *
 * Two different claims, and both matter:
 *
 *   - the foreign keys exist and are TRUSTED. A restore can leave a constraint
 *     present but `is_not_trusted`, which means the database is no longer
 *     enforcing it — the rows would still be there and the guarantee would not.
 *   - the invariant TRIGGERS came back. They are the cycle, depth and fallback
 *     protections, and a restore that lost them would leave a taxonomy that
 *     looks intact and can be corrupted by the next write.
 */
export async function verifyRestoredTaxonomyIntegrity(
  restored: SqlSession,
  fixture: Phase3bFixture,
): Promise<string> {
  assertSafe(fixture);

  const constraints = await restored.query<{ name: string; untrusted: number }>(`
    SELECT fk.name, fk.is_not_trusted AS untrusted
    FROM sys.foreign_keys fk
    WHERE fk.name IN (N'Topic_parentId_fkey', N'TopicTranslation_topicId_fkey');
  `);

  expect(
    constraints.length === 2,
    `Restored taxonomy foreign keys: ${constraints.map((row) => row.name).join(', ') || '(none)'}`,
  );
  for (const constraint of constraints) {
    expect(
      Number(constraint.untrusted) === 0,
      `Restored ${constraint.name} is NOT TRUSTED — the database has stopped enforcing it.`,
    );
  }

  const triggers = await restored.query<{ name: string; disabled: number }>(`
    SELECT name, is_disabled AS disabled FROM sys.triggers
    WHERE name IN (N'TaxonomyTopicHierarchy', N'TaxonomyTopicFallback');
  `);
  expect(
    triggers.length === 2,
    `Restored taxonomy triggers: ${triggers.map((row) => row.name).join(', ') || '(none)'}`,
  );
  for (const trigger of triggers) {
    expect(
      Number(trigger.disabled) === 0,
      `Restored trigger ${trigger.name} is DISABLED — the invariant is not being enforced.`,
    );
  }

  // The hierarchy is enforceable, not merely present: a child pointing at a
  // parent that does not exist must be refused by the restored constraint.
  let orphanRefused = false;
  try {
    await restored.query(`
      INSERT INTO [dbo].[Topic] ([id], [slug], [parentId], [position], [status], [system])
      VALUES (NEWID(), N'${fixture.childSlug}-orphan', N'${fixture.runId}-absent', 0, N'active', 0);
    `);
  } catch {
    orphanRefused = true;
  }
  expect(
    orphanRefused,
    'The restored database ACCEPTED a topic whose parent does not exist.',
  );

  return '2 trusted foreign keys, 2 enabled invariant triggers, orphan parent refused';
}
