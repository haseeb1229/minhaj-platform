import 'server-only';

import { getApplicationPrincipalCredentials } from '../src/config.ts';
import { provisionApplicationPrincipal } from '../src/lifecycle/application-principal.ts';
import {
  createDisposableDatabase,
  dropDisposableDatabase,
  newDisposableDatabaseName,
  openMasterSession,
} from '../src/lifecycle/disposable-database.ts';
import {
  appliedMigrationNames,
  deployMigrations,
  loadMigrations,
  migrationStatus,
  rollbackMigration,
  type Migration,
} from '../src/lifecycle/migrations.ts';
import { runSeed } from '../src/lifecycle/seed.ts';
import {
  openSession,
  withDatabase,
  type SqlSession,
} from '../src/lifecycle/sql-connection.ts';
import {
  reportConfiguration,
  retargetAtDisposable,
  startLocalCommand,
} from './local-bootstrap.ts';

/**
 * `npm run db:migrate:test` — the full migration lifecycle against a
 * disposable database this run creates and drops.
 *
 *   clean database -> prisma migrate deploy -> prisma migrate status
 *                  -> verify schema -> seed x2 -> reviewed rollbacks, newest
 *                  first -> verify absence -> prisma migrate deploy -> status
 *
 * The forward direction is the REAL Prisma CLI, over the normal encrypted
 * migration URL. Direct SQL is used only for database creation, state
 * inspection, and the reviewed rollback artifacts — never as a substitute for
 * `migrate deploy`, and the migration-history row is written by Prisma alone.
 *
 * Every stage inspects actual database state. An exit code of 0 from a
 * migration command is not evidence that the objects it claims to create exist.
 *
 * MIGRATION COUNT. This script previously asserted "exactly one migration",
 * which was true of Phase 1 and became a false gate the moment Phase 2 added
 * its own. The count is not the property worth asserting; what each migration
 * actually creates is. `MIGRATION_EXPECTATIONS` below states that per
 * migration, and a migration nobody has described fails the run rather than
 * passing unverified — so the gate still cannot be satisfied by adding a
 * directory.
 */

/**
 * What each reviewed migration must create, and what must therefore be gone
 * once its rollback has run.
 *
 * Keyed by migration id. Every migration on disk must appear here.
 */
const MIGRATION_EXPECTATIONS: Record<string, readonly string[]> = {
  '20260908000000_phase1_database_foundation': ['AuditLog'],
  '20260912000000_phase2_identity_foundation': [
    'User',
    'Session',
    'Account',
    'Verification',
    'IdentityCommunicationIntent',
    'IdentitySecurityOperation',
    'EmailDelivery',
    'EmailSuppression',
    'ProviderEvent',
    'RateLimitCounter',
  ],
  '20260916000000_phase2_authorization_privileged_security': [
    'Permission',
    'Role',
    'RolePermission',
    'RoleAssignment',
    'StepUpGrant',
    'TwoFactor',
    'PrivilegedSecurityPosture',
    'IdentityBootstrap',
  ],
  '20260917000000_phase3b_taxonomy': ['Topic', 'TopicTranslation', 'Language', 'Tag'],

  // PHASE 4 CREATES NO TABLE, and the empty list says so deliberately rather
  // than by omission. The public shell has no business schema: its route
  // registry is code, and the migration exists only to seed one permission key
  // and extend the protected bundle. An absent entry would fail this gate; an
  // empty one asserts that nothing is expected to appear or to disappear.
  '20260918000000_phase4_navigation_permission': [],

  // ELEVEN TABLES, AND THE COUNT IS ITSELF PART OF THE PROOF. Four of them are
  // the four profile aggregates DOMAIN_MODEL.md §5.2 requires to stay distinct;
  // a migration that delivered one `Profile` table with a `type` column would
  // satisfy "People shipped" and fail this list.
  '20260920000000_phase6_editorial_core': [
    'Article',
    'ArticleRevision',
    'ArticleRevisionTranslation',
    'ArticleTopic',
    'ArticleContributor',
    'ArticleSlugHistory',
    'Page',
    'PageRevision',
    'PageRevisionTranslation',
    'PageTopic',
    'PageContributor',
    'PageSlugHistory',
    'ContactInquiry',
    'Feedback',
  ],
  '20260921000000_phase7_storage_foundation': ['Asset'],
  '20260919000000_phase5_people_contributors': [
    'Person',
    'PersonTranslation',
    'PersonNameVariant',
    'AuthorProfile',
    'SpeakerProfile',
    'ScholarProfile',
    'ScholarProfileTranslation',
    'ScholarProfileLanguage',
    'TeacherProfile',
    'TeacherProfileTranslation',
    'TeacherProfileLanguage',
  ],
};

/**
 * Tables no delivered phase owns yet.
 *
 * Their presence would mean schema had been created ahead of the phase that
 * owns it: domain schema arrives with its owning phase (DELIVERY_PLAN.md).
 * `User`, `Session` and `Account` left this list when Phase 2 Chunk 1
 * genuinely delivered them; `Role`, `Permission`, `RolePermission`,
 * `RoleAssignment`, `StepUpGrant`, `TwoFactor` and `IdentityBootstrap` left it
 * when Chunk 2 delivered authorisation and the privileged second factor.
 */
const PREMATURE_TABLES = [
  'NewsArticle',
  'Event',
  'Collection',
  'Quran',
  'Hadith',
  'Book',
  'Fatwa',
  // `Scholar` and `Teacher` stay here after Phase 5, and the near-miss is
  // deliberate. Phase 5 delivers `ScholarProfile` and `TeacherProfile` —
  // FACETS of a Person. A bare `Scholar` or `Teacher` table would be a second,
  // standalone notion of the same human being, which is the duplication
  // DOMAIN_MODEL.md §5 exists to remove.
  'Scholar',
  'Teacher',
  'Course',
  'Message',
  'Notification',
  'Membership',
  'Donation',
  'MigrationProvenance',
];

/**
 * Tables that must never exist, at any phase.
 *
 * DIFFERENT FROM `PREMATURE_TABLES`, which names schema that is merely EARLY.
 * These are shapes DOMAIN_MODEL.md §6.2 prohibits outright: one shared
 * assignment table carrying a target TYPE and a target IDENTIFIER. SQL Server
 * cannot foreign-key such a pair to many tables, so the design guarantees
 * dangling references whenever a target is deleted — and no later phase makes
 * it acceptable.
 *
 * Checked by NAME here and by SHAPE in `assertNoPolymorphicAssignment`, because
 * a prohibited design renamed is still the prohibited design.
 */
const PROHIBITED_TABLES = [
  'TopicAssignment',
  'TaxonomyAssignment',
  'EntityTopic',
  'ContentTopic',
  'TopicTarget',

  // PHASE 5 ADDS TWO PROHIBITED SHAPES OF ITS OWN, and they fail for the two
  // different reasons DOMAIN_MODEL.md gives.
  //
  // A single `Profile` or `ContributorProfile` table would be §5.2's merge: the
  // four aggregates collapsed into one row with a `type` column, so a person's
  // author facet and teacher facet would share a lifecycle and could not be
  // archived independently.
  'Profile',
  'ContributorProfile',
  'PersonProfile',
  //
  // A generic `Contribution` or `ContributorTarget` table would be §6.2's
  // polymorphic pair again, one boundary along: the contributor edge would be a
  // real foreign key and the WORK edge would be a type string beside an
  // identifier. The relationship row belongs to the context that owns the
  // target (§5.3), and no such context has shipped.
  'Contribution',
  'ContributorTarget',
  'ContributionTarget',
  'PersonContribution',
];

const EXPECTED_AUDIT_COLUMNS = [
  'action',
  'actorId',
  'actorType',
  'afterState',
  'authorisingSource',
  'beforeState',
  'id',
  'ipAddress',
  'occurredAt',
  'targetId',
  'targetType',
];

const EXPECTED_AUDIT_INDEXES = [
  'AuditLog_actorId_idx',
  'AuditLog_occurredAt_idx',
  'AuditLog_targetType_targetId_idx',
  // Chunk 2: the read-only admin audit view filters by action and orders by
  // time, and only indexed filters are offered (SECURITY_BASELINE.md §28).
  'AuditLog_action_occurredAt_idx',
];

/**
 * Columns whose SIZE is a correctness property rather than a preference.
 *
 * Prisma's default `String` on SQL Server is NVARCHAR(1000) = 2000 bytes,
 * above the 1700-byte nonclustered index key limit, so a uniquely indexed
 * column left at the default is a latent failure. `account.password` is here
 * for a different reason: Better Auth's scrypt hash is 161 characters, and a
 * column too small to hold it would truncate a credential.
 */
const EXPECTED_COLUMN_SIZES: readonly {
  table: string;
  column: string;
  characters: number;
}[] = [
  { table: 'Article', column: 'slug', characters: 120 },
  { table: 'Page', column: 'routeBinding', characters: 100 },
  { table: 'Page', column: 'slug', characters: 120 },
  { table: 'ArticleRevisionTranslation', column: 'languageCode', characters: 16 },
  { table: 'User', column: 'email', characters: 320 },
  { table: 'Session', column: 'token', characters: 255 },
  { table: 'Account', column: 'password', characters: 255 },
  { table: 'Verification', column: 'identifier', characters: 400 },
  { table: 'EmailDelivery', column: 'idempotencyKey', characters: 200 },
  // Chunk 2. `Permission.key` is a PRIMARY KEY and `Role.key` a UNIQUE
  // constraint, so both are index keys and both would exceed the 1700-byte
  // limit at Prisma's NVARCHAR(1000) default.
  { table: 'Permission', column: 'key', characters: 64 },
  { table: 'Role', column: 'key', characters: 64 },
  { table: 'RolePermission', column: 'permissionKey', characters: 64 },
  // Phase 3B. `Topic.slug` and `Tag.slug` are UNIQUE constraints and
  // `Language.code` is a PRIMARY KEY, so all three are index keys that would
  // exceed the 1700-byte limit at Prisma's NVARCHAR(1000) default.
  // `TopicTranslation.locale` is half of a composite primary key and is sized
  // to match `User.locale`, because the two hold the same kind of value.
  { table: 'Topic', column: 'slug', characters: 160 },
  { table: 'TopicTranslation', column: 'locale', characters: 8 },
  { table: 'Language', column: 'code', characters: 16 },
  { table: 'Tag', column: 'slug', characters: 120 },
  // Phase 5. `Person.slug` is a UNIQUE constraint and `Person.userId` carries a
  // unique FILTERED index, so both are index keys that would exceed the
  // 1700-byte limit at Prisma's NVARCHAR(1000) default.
  // `PersonNameVariant.normalised` is the third column of a composite UNIQUE
  // constraint alongside `personId` and `locale`; at the default the three
  // together would be far past the limit.
  // `PersonTranslation.locale` is half of a composite primary key and is sized
  // to match `User.locale`, because the two hold the same kind of value.
  { table: 'Person', column: 'slug', characters: 160 },
  { table: 'Person', column: 'userId', characters: 36 },
  { table: 'PersonTranslation', column: 'locale', characters: 8 },
  { table: 'PersonNameVariant', column: 'normalised', characters: 200 },
  { table: 'ScholarProfileLanguage', column: 'languageCode', characters: 16 },
  { table: 'TeacherProfileLanguage', column: 'languageCode', characters: 16 },
];

/**
 * Database objects this repository creates that Prisma's schema language
 * cannot express, so nothing else would notice their absence.
 *
 * The FILTERED unique index is the race-safety property behind "at most one
 * live assignment per account and role"; the two PROCEDURES are the whole of
 * the host-only privileged surface. A migration that created the tables and
 * silently dropped either would leave a gate that looks present and is not.
 */
const EXPECTED_FILTERED_INDEXES: readonly {
  table: string;
  index: string;
  why: string;
}[] = [
  {
    table: 'RoleAssignment',
    index: 'RoleAssignment_userId_roleId_live_key',
    why: 'two concurrent grants of the same role to the same account both succeed',
  },
  // Phase 5. Filtered for the opposite reason to RoleAssignment's: SQL Server's
  // UNIQUE treats two NULLs as equal, so an unfiltered index here would let the
  // platform hold exactly ONE Person without an account — and a Person with no
  // User is the ordinary case (DOMAIN_MODEL.md §5.1).
  {
    table: 'Person',
    index: 'Person_userId_key',
    why: 'one account could be linked to two different contributor records at once',
  },
];

const EXPECTED_PROCEDURES = [
  'IdentityBootstrapPlatformAdministrator',
  'IdentityRecoverPrivilegedSecondFactor',
  'PeopleAddNameVariant',
  'PeopleCreatePerson',
];

/**
 * Every invariant trigger this repository creates.
 *
 * Each one enforces something no constraint can express and no application
 * check can guarantee under concurrency. A migration that created the tables
 * and silently dropped one would leave a gate that looks present and is not.
 */
const EXPECTED_TRIGGERS = [
  ...['Article', 'Page'].flatMap((kind) => [
    kind + 'RevisionImmutable',
    kind + 'RevisionTranslationImmutable',
    kind + 'TopicImmutable',
    kind + 'ContributorImmutable',
    kind + 'SlugHistoryImmutable',
    kind + 'RevisionTranslationAppend',
    kind + 'TopicAppend',
    kind + 'ContributorAppend',
    kind + 'CurrentIntegrity',
    kind + 'RevisionSequence',
    kind + 'RevisionForward',
  ]),
  'IdentityFinalAdministrator_Bootstrap',
  'IdentityFinalAdministrator_Role',
  'IdentityFinalAdministrator_RoleAssignment',
  'IdentityFinalAdministrator_User',
  // Phase 3B: cycle and depth safety for the topic hierarchy, and the
  // fallback translation every topic must keep.
  'TaxonomyTopicHierarchy',
  'TaxonomyTopicFallback',
  // Phase 5: the translation a Person must keep in its own primary locale, and
  // the per-locale bound on name variants.
  'PeoplePersonPrimaryName',
  'PeoplePersonPrimaryLocale',
  'PeopleNameVariantBound',
];

/** CHECK constraints that carry a correctness rule rather than a preference. */
const EXPECTED_CHECK_CONSTRAINTS = [
  ...['Article', 'Page'].flatMap((table) =>
    ['state', 'version', 'approval', 'publication', 'published_date', 'schedule'].map(
      (rule) => ({ table, constraint: table + '_' + rule + '_ck' }),
    ),
  ),
  { table: 'Page', constraint: 'Page_binding_ck' },
  { table: 'Feedback', constraint: 'Feedback_category_ck' },
  ...['ContactInquiry', 'Feedback'].flatMap((table) =>
    ['state', 'retention'].map((rule) => ({
      table,
      constraint: table + '_' + rule + '_ck',
    })),
  ),
  { table: 'IdentityBootstrap', constraint: 'IdentityBootstrap_singleton_ck' },
  { table: 'Topic', constraint: 'Topic_not_self_parent_ck' },
  // Phase 5 lifecycles, refused by the database rather than by a validator, so
  // a status nobody defined cannot enter by a route the application does not
  // own. Four profile constraints and not one shared constraint, because there
  // are four tables.
  { table: 'Person', constraint: 'Person_status_ck' },
  { table: 'AuthorProfile', constraint: 'AuthorProfile_status_ck' },
  { table: 'SpeakerProfile', constraint: 'SpeakerProfile_status_ck' },
  { table: 'ScholarProfile', constraint: 'ScholarProfile_status_ck' },
  { table: 'TeacherProfile', constraint: 'TeacherProfile_status_ck' },
];

/**
 * The canonical top-level topics, exactly as DOMAIN_MODEL.md §6.1 names them.
 *
 * Stated here as well as in the migration ON PURPOSE: this list is what the
 * gate compares the database against, so a migration that seeded eighteen, or
 * twenty, or the same one twice, fails rather than passing quietly.
 */
const CANONICAL_TOPIC_SLUGS = [
  'ahl-al-bayt',
  'aqeedah',
  'contemporary-issues',
  'economics-and-finance',
  'education',
  'ethics',
  'family-and-society',
  'fiqh',
  'hadith',
  'human-rights',
  'interfaith',
  'islam-and-science',
  'islamic-history',
  'peace',
  'quran',
  'sahabah',
  'seerah',
  'spirituality',
  'worship',
];

/** The Taxonomy permissions Phase 3B appends to the immutable catalogue. */
const TAXONOMY_PERMISSIONS = ['taxonomy.administer', 'taxonomy.read'];

/**
 * The permission Phase 4 appends, and the only one.
 *
 * READ ONLY. The absence of a `navigation.administer` key is itself part of
 * what this gate proves: the navigation status surface has no mutation, so a
 * write key would be authority over nothing.
 */
const NAVIGATION_PERMISSIONS = ['navigation.read'];

/** The People permissions Phase 5 appends to the immutable catalogue. */
const PEOPLE_PERMISSIONS = ['people.administer', 'people.read'];

/**
 * The four capability-projection sources, which MUST NOT be seeded yet.
 *
 * DOMAIN_MODEL.md §4.5 derives `canTeach`, `canReceiveQuestions`,
 * `canReviewContent` and `canIssueFatwa` from these codes. Phase 5 consumes the
 * projection and it would have been trivially convenient to seed them so a test
 * could grant one — which is exactly why this is asserted as a NEGATIVE.
 *
 * They belong to Learning, Fatwa and Editorial, none of which has shipped.
 * Seeding one now would fix another owner's vocabulary before that owner can
 * have an opinion about it, and would leave grantable authority over nothing.
 * OPEN_DECISIONS.md §6.3 separately reserves WHO receives them to the
 * organisation.
 *
 * `fatwa.answer` is listed alongside `fatwa.publish` because §6.3 names both.
 */
const UNSEEDED_CAPABILITY_PERMISSIONS = [
  'teaching.perform',
  'question.receive',
  'fatwa.answer',
  'fatwa.publish',
];

function report(step: string, detail: string): void {
  process.stdout.write(`  ${step.padEnd(24)} ${detail}\n`);
}

function fail(message: string): never {
  throw new Error(message);
}

async function userTables(session: SqlSession): Promise<string[]> {
  const rows = await session.query<{ name: string }>(`
    SELECT t.name FROM sys.tables t
    JOIN sys.schemas s ON s.schema_id = t.schema_id
    WHERE s.name = 'dbo' ORDER BY t.name;
  `);
  return rows.map((row) => row.name);
}

async function auditColumns(session: SqlSession): Promise<string[]> {
  const rows = await session.query<{ name: string }>(`
    SELECT c.name FROM sys.columns c
    WHERE c.object_id = OBJECT_ID(N'[dbo].[AuditLog]') ORDER BY c.name;
  `);
  return rows.map((row) => row.name);
}

function assertNoPrematureTables(tables: string[], stage: string): void {
  const premature = tables.filter((table) => PREMATURE_TABLES.includes(table));
  if (premature.length > 0) {
    fail(`Premature business-domain tables after ${stage}: ${premature.join(', ')}`);
  }

  const prohibited = tables.filter((table) => PROHIBITED_TABLES.includes(table));
  if (prohibited.length > 0) {
    fail(
      `Prohibited polymorphic assignment tables after ${stage}: ` +
        `${prohibited.join(', ')}. DOMAIN_MODEL.md 6.2 requires a typed junction ` +
        `owned by the context that owns the target.`,
    );
  }
}

function expectationsFor(migration: Migration): readonly string[] {
  const expected = MIGRATION_EXPECTATIONS[migration.id];
  if (expected === undefined) {
    fail(
      `Migration '${migration.id}' has no declared expectation in ` +
        `MIGRATION_EXPECTATIONS. A migration this gate cannot describe is a ` +
        `migration it cannot verify; describe what it creates rather than ` +
        `letting it apply unchecked.`,
    );
  }
  return expected;
}

/** Asserts `migrate status` reports a healthy, fully-applied database. */
function assertHealthyStatus(output: string, stage: string): void {
  if (!output.includes('Database schema is up to date!')) {
    fail(`prisma migrate status is not healthy after ${stage}.\n${output.trim()}`);
  }
  if (/not yet been applied|pending|failed/i.test(output)) {
    fail(
      `prisma migrate status reports outstanding work after ${stage}.\n${output.trim()}`,
    );
  }
}

/**
 * Verifies the declared character length of a column.
 *
 * `sys.columns.max_length` is BYTES, and NVARCHAR is two bytes per character,
 * so an NVARCHAR(320) column reports 640. `-1` is the MAX types.
 */
async function assertColumnSizes(session: SqlSession): Promise<void> {
  for (const expected of EXPECTED_COLUMN_SIZES) {
    const rows = await session.query<{ max_length: number }>(`
      SELECT c.max_length FROM sys.columns c
      WHERE c.object_id = OBJECT_ID(N'[dbo].[${expected.table}]')
        AND c.name = N'${expected.column}';
    `);

    const actual = rows[0]?.max_length;
    if (actual === undefined) {
      fail(`Column ${expected.table}.${expected.column} does not exist.`);
    }
    if (actual !== expected.characters * 2) {
      fail(
        `Column ${expected.table}.${expected.column} is NVARCHAR(${actual / 2}), ` +
          `expected NVARCHAR(${expected.characters}). Index key size and ` +
          `credential storage both depend on this being deliberate.`,
      );
    }
  }
  report('column sizes', `${EXPECTED_COLUMN_SIZES.length} explicit sizes verified`);
}

/** Asserts the objects Prisma's schema language cannot describe. */
async function assertNonPrismaObjects(session: SqlSession): Promise<void> {
  for (const expected of EXPECTED_FILTERED_INDEXES) {
    const [filtered] = await session.query<{ has_filter: number }>(`
      SELECT i.has_filter FROM sys.indexes i
      WHERE i.object_id = OBJECT_ID(N'[dbo].[${expected.table}]')
        AND i.name = N'${expected.index}'
        AND i.is_unique = 1;
    `);

    if (filtered === undefined) {
      fail(`The unique index ${expected.index} is missing. Without it, ${expected.why}.`);
    }
    if (Number(filtered.has_filter) !== 1) {
      fail(
        `${expected.index} exists but is not FILTERED. The filter is what makes ` +
          `the index hold only where it should: without it, rows the design ` +
          `requires to coexist collide on NULL or on a superseded value.`,
      );
    }
  }

  for (const procedure of EXPECTED_PROCEDURES) {
    const rows = await session.query<{ name: string }>(`
      SELECT name FROM sys.procedures WHERE name = N'${procedure}';
    `);
    if (rows.length !== 1) {
      fail(`The host-only procedure ${procedure} is missing after deploy.`);
    }
  }

  for (const trigger of EXPECTED_TRIGGERS) {
    const rows = await session.query<{ name: string }>(
      `SELECT name FROM sys.triggers WHERE name = N'${trigger}';`,
    );
    if (rows.length !== 1) {
      fail('The final-administrator trigger ' + trigger + ' is missing after deploy.');
    }
  }

  const roleRows = await session.query<{ name: string }>(`
    SELECT name FROM sys.database_principals
    WHERE name = N'minhaj_operator' AND type = 'R';
  `);
  if (roleRows.length !== 1) {
    fail('The minhaj_operator database role is missing after deploy.');
  }

  report(
    'privileged objects',
    `${EXPECTED_FILTERED_INDEXES.length} filtered unique indexes, ` +
      `${EXPECTED_PROCEDURES.length} procedures, ` +
      `${EXPECTED_TRIGGERS.length} invariant triggers, 1 operator role`,
  );
}

/**
 * NO POLYMORPHIC TOPIC ASSIGNMENT EXISTS - checked by SHAPE, not only by name.
 *
 * A prohibited design renamed is still the prohibited design, so this looks for
 * the SHAPE DOMAIN_MODEL.md 6.2 forbids: a table that references `Topic` and
 * also carries a column pair naming a target by TYPE and IDENTIFIER rather than
 * by foreign key.
 *
 * It also proves the positive half of the rule: every foreign key into `Topic`
 * from another table belongs to a junction that ALSO has a real foreign key to
 * something else. A junction with a topic edge and no target edge is a
 * half-typed assignment - real integrity on one side, a dangling identifier on
 * the other.
 *
 * NON-VACUOUS BY CONSTRUCTION. It asserts a count it knows: exactly one foreign
 * key references `Topic` today, and it is Topic's own self-referencing parent
 * edge. If that stops being true without a junction arriving, the inventory has
 * changed for a reason nobody declared.
 */
async function assertNoPolymorphicAssignment(session: SqlSession): Promise<void> {
  const suspects = await session.query<{ tableName: string }>(`
    SELECT t.name AS tableName
    FROM sys.tables t
    WHERE EXISTS (
        SELECT 1 FROM sys.columns c
        WHERE c.object_id = t.object_id AND c.name IN (N'targetType', N'targetId')
    )
      AND EXISTS (
        SELECT 1 FROM sys.foreign_keys fk
        WHERE fk.parent_object_id = t.object_id
          AND fk.referenced_object_id = OBJECT_ID(N'[dbo].[Topic]')
    );
  `);

  if (suspects.length > 0) {
    fail(
      `A table references Topic AND carries a targetType/targetId pair: ` +
        suspects.map((row) => row.tableName).join(', '),
    );
  }

  const topicReferences = await session.query<{
    junctionTable: string;
    otherForeignKeys: number;
  }>(`
    SELECT OBJECT_NAME(fk.parent_object_id) AS junctionTable,
           (
               SELECT COUNT_BIG(*) FROM sys.foreign_keys other
               WHERE other.parent_object_id = fk.parent_object_id
                 AND other.referenced_object_id <> OBJECT_ID(N'[dbo].[Topic]')
           ) AS otherForeignKeys
    FROM sys.foreign_keys fk
    WHERE fk.referenced_object_id = OBJECT_ID(N'[dbo].[Topic]');
  `);

  // TAXONOMY'S OWN TABLES ARE NOT ASSIGNMENTS, and the distinction is the whole
  // point of the check. `Topic.parentId` is the HIERARCHY and
  // `TopicTranslation.topicId` is part of the Topic AGGREGATE — its name in one
  // interface locale. An assignment is a foreign key into `Topic` from a table
  // belonging to a context that owns the thing being classified.
  const AGGREGATE_TABLES = ['Topic', 'TopicTranslation'];

  const junctions = topicReferences.filter(
    (row) => !AGGREGATE_TABLES.includes(row.junctionTable),
  );
  for (const junction of junctions) {
    if (Number(junction.otherForeignKeys) === 0) {
      fail(
        `${junction.junctionTable} references Topic but has no foreign key to any ` +
          `target. A topic assignment must be typed at BOTH ends.`,
      );
    }
  }

  // The aggregate's OWN edges are stated exactly, so this proof cannot pass
  // because a query happened to return nothing — and so a later phase that
  // added a third edge into `Topic` from inside the aggregate would have to say
  // so here rather than have it quietly counted as neither.
  const aggregateEdges = topicReferences
    .filter((row) => AGGREGATE_TABLES.includes(row.junctionTable))
    .map((row) => row.junctionTable)
    .sort();

  if (aggregateEdges.join(',') !== 'Topic,TopicTranslation') {
    fail(
      `Expected exactly the hierarchy and translation edges into Topic; found ` +
        `${aggregateEdges.join(', ') || '(none)'}.`,
    );
  }

  report(
    'assignment strategy',
    `no polymorphic pair, ${junctions.length} typed junction(s), ` +
      `aggregate edges: ${aggregateEdges.join(', ')}`,
  );
}

/**
 * The Phase-3B foundation data, checked against the accepted list.
 *
 * COUNT, IDENTITY AND SHAPE. Nineteen canonical topics, each at the root, each
 * `system`, each active, each with exactly one English name and none in any
 * other locale - which is the deliberate state the migration describes, not an
 * omission nobody noticed.
 */
async function assertTaxonomyFoundation(session: SqlSession): Promise<void> {
  const topics = await session.query<{
    slug: string;
    parentId: string | null;
    status: string;
    system: boolean;
    position: number;
  }>(`
    SELECT [slug], [parentId], [status], [system], [position]
    FROM [dbo].[Topic] ORDER BY [slug];
  `);

  const slugs = topics.map((row) => row.slug);
  if (slugs.join(',') !== CANONICAL_TOPIC_SLUGS.join(',')) {
    fail(
      `Canonical topic seed differs.\n  expected: ${CANONICAL_TOPIC_SLUGS.join(', ')}\n` +
        `  actual:   ${slugs.join(', ') || '(none)'}`,
    );
  }

  for (const topic of topics) {
    if (topic.parentId !== null)
      fail(`Canonical topic ${topic.slug} is not at the root.`);
    if (topic.status !== 'active') fail(`Canonical topic ${topic.slug} is not active.`);
    if (!topic.system) fail(`Canonical topic ${topic.slug} is not marked system.`);
  }

  const positions = topics.map((row) => Number(row.position)).sort((a, b) => a - b);
  if (positions.join(',') !== positions.map((_, index) => index).join(',')) {
    fail(
      `Canonical topic positions are not 0..${topics.length - 1}: ${positions.join(', ')}`,
    );
  }

  const translations = await session.query<{ locale: string; total: number }>(`
    SELECT [locale], COUNT_BIG(*) AS total
    FROM [dbo].[TopicTranslation] GROUP BY [locale];
  `);

  if (translations.length !== 1 || translations[0]?.locale !== 'en') {
    fail(
      `The canonical seed must carry the fallback locale and nothing else; found: ` +
        `${translations.map((row) => `${row.locale}=${row.total}`).join(', ') || '(none)'}`,
    );
  }
  if (Number(translations[0]?.total) !== CANONICAL_TOPIC_SLUGS.length) {
    fail(
      `Expected ${CANONICAL_TOPIC_SLUGS.length} English topic names, found ` +
        `${translations[0]?.total}.`,
    );
  }

  // ---- content languages, and the script they are written in ---------------
  const languages = await session.query<{
    code: string;
    nativeName: string;
    direction: string;
    status: string;
  }>(
    `SELECT [code], [nativeName], [direction], [status] FROM [dbo].[Language] ORDER BY [code];`,
  );

  if (languages.map((row) => row.code).join(',') !== 'ar,en,ur') {
    fail(
      `Content-language seed differs; found: ` +
        `${languages.map((row) => row.code).join(', ') || '(none)'}`,
    );
  }

  // ENCODING ROUND TRIP. The endonyms are written in Arabic script in the
  // migration file. A file read under the wrong encoding would seed rows of
  // replacement characters, which nothing else in the pipeline would notice.
  for (const language of languages) {
    if (language.code === 'en') continue;
    if (!/\p{Script=Arabic}/u.test(language.nativeName)) {
      fail(
        `Content language '${language.code}' did not keep its own script: ` +
          `nativeName is '${language.nativeName}'. The migration file's encoding ` +
          `did not survive.`,
      );
    }
    if (language.direction !== 'rtl') {
      fail(
        `Content language '${language.code}' should be rtl, is '${language.direction}'.`,
      );
    }
  }

  // ---- the catalogue extension and the protected bundle --------------------
  const permissions = await session.query<{ key: string }>(`
    SELECT [key] FROM [dbo].[Permission]
    WHERE [key] LIKE N'taxonomy.%' ORDER BY [key];
  `);
  if (permissions.map((row) => row.key).join(',') !== TAXONOMY_PERMISSIONS.join(',')) {
    fail(
      `Taxonomy permissions differ; found: ` +
        `${permissions.map((row) => row.key).join(', ') || '(none)'}`,
    );
  }

  const bundled = await session.query<{ permissionKey: string }>(`
    SELECT rp.[permissionKey]
    FROM [dbo].[RolePermission] rp
    INNER JOIN [dbo].[Role] r ON r.[id] = rp.[roleId]
    WHERE r.[key] = N'platform-administrator' AND rp.[permissionKey] LIKE N'taxonomy.%'
    ORDER BY rp.[permissionKey];
  `);
  if (
    bundled.map((row) => row.permissionKey).join(',') !== TAXONOMY_PERMISSIONS.join(',')
  ) {
    fail(
      `The protected Platform Administrator bundle did not gain the Taxonomy ` +
        `permissions through the migration; found: ` +
        `${bundled.map((row) => row.permissionKey).join(', ') || '(none)'}`,
    );
  }

  report(
    'taxonomy foundation',
    `${topics.length} canonical topics, ${languages.length} content languages, ` +
      `${permissions.length} permissions bundled`,
  );
}

/**
 * The seed guards are IDEMPOTENT, proved by re-running them.
 *
 * `prisma migrate deploy` will not re-apply a migration it has already
 * recorded, so "what happens on a second provisioning" is not something the
 * deploy path can demonstrate. The guards themselves are re-executed here
 * instead - the same `INSERT ... WHERE NOT EXISTS` shape the migration uses -
 * and the row counts must not move.
 */
/**
 * The Phase-4 catalogue extension, and the privilege change that paid for it.
 *
 * Scoped to `navigation.%` so it proves exactly what Phase 4 seeded, the same
 * way the taxonomy check above proves exactly what Phase 3B seeded. It also
 * asserts the NEGATIVE: no `navigation.administer` exists, because a write key
 * with no mutation behind it is grantable authority over nothing.
 */
async function assertNavigationPermission(session: SqlSession): Promise<void> {
  const permissions = await session.query<{ key: string }>(`
    SELECT [key] FROM [dbo].[Permission]
    WHERE [key] LIKE N'navigation.%' ORDER BY [key];
  `);
  if (permissions.map((row) => row.key).join(',') !== NAVIGATION_PERMISSIONS.join(',')) {
    fail(
      `Navigation permissions differ; found: ` +
        `${permissions.map((row) => row.key).join(', ') || '(none)'}`,
    );
  }

  const bundled = await session.query<{ permissionKey: string }>(`
    SELECT rp.[permissionKey]
    FROM [dbo].[RolePermission] rp
    INNER JOIN [dbo].[Role] r ON r.[id] = rp.[roleId]
    WHERE r.[key] = N'platform-administrator' AND rp.[permissionKey] LIKE N'navigation.%'
    ORDER BY rp.[permissionKey];
  `);
  if (
    bundled.map((row) => row.permissionKey).join(',') !== NAVIGATION_PERMISSIONS.join(',')
  ) {
    fail(
      `The protected Platform Administrator bundle did not gain the navigation ` +
        `permission through the migration; found: ` +
        `${bundled.map((row) => row.permissionKey).join(', ') || '(none)'}`,
    );
  }

  report('navigation permission', `${permissions.length} key seeded and bundled`);
}

/**
 * The Phase-5 People foundation — what it seeds, and what it deliberately does
 * not.
 *
 * FOUR CLAIMS, and three of them are negatives, because the interesting
 * failures of this phase are all things that should NOT be in the database:
 *
 *   1. `people.read` and `people.administer` exist and are bundled into the
 *      protected role, through the migration rather than through a screen;
 *   2. NO capability-source permission has been seeded early — the shortcut
 *      that would have made a projection test easy and the vocabulary wrong;
 *   3. the four profile aggregates are four real tables, each with its own
 *      unique index on `personId`, so "a Person may hold all four" and "at most
 *      one of each" are both properties of the schema;
 *   4. no People table carries a stored capability, which is what makes "a
 *      profile alone grants nothing" unable to be contradicted by data.
 */
async function assertPeopleFoundation(session: SqlSession): Promise<void> {
  // ---- the catalogue extension and the protected bundle --------------------
  const permissions = await session.query<{ key: string }>(`
    SELECT [key] FROM [dbo].[Permission]
    WHERE [key] LIKE N'people.%' ORDER BY [key];
  `);
  if (permissions.map((row) => row.key).join(',') !== PEOPLE_PERMISSIONS.join(',')) {
    fail(
      `People permissions differ; found: ` +
        `${permissions.map((row) => row.key).join(', ') || '(none)'}`,
    );
  }

  const bundled = await session.query<{ permissionKey: string }>(`
    SELECT rp.[permissionKey]
    FROM [dbo].[RolePermission] rp
    INNER JOIN [dbo].[Role] r ON r.[id] = rp.[roleId]
    WHERE r.[key] = N'platform-administrator' AND rp.[permissionKey] LIKE N'people.%'
    ORDER BY rp.[permissionKey];
  `);
  if (
    bundled.map((row) => row.permissionKey).join(',') !== PEOPLE_PERMISSIONS.join(',')
  ) {
    fail(
      `The protected Platform Administrator bundle did not gain the People ` +
        `permissions through the migration; found: ` +
        `${bundled.map((row) => row.permissionKey).join(', ') || '(none)'}`,
    );
  }

  // ---- the four capability sources are NOT grantable yet -------------------
  const premature = await session.query<{ key: string }>(`
    SELECT [key] FROM [dbo].[Permission]
    WHERE [key] IN (${UNSEEDED_CAPABILITY_PERMISSIONS.map((key) => `N'${key}'`).join(', ')})
    ORDER BY [key];
  `);
  if (premature.length > 0) {
    fail(
      `Capability-source permissions were seeded before their owning phase: ` +
        `${premature.map((row) => row.key).join(', ')}. DOMAIN_MODEL.md §4.5 ` +
        `derives the four contributor capabilities from these codes, but they ` +
        `belong to Learning, Fatwa and Editorial — and OPEN_DECISIONS.md §6.3 ` +
        `reserves who receives them to the organisation.`,
    );
  }

  // ---- four aggregates, four unique indexes --------------------------------
  const PROFILE_TABLES = [
    'AuthorProfile',
    'SpeakerProfile',
    'ScholarProfile',
    'TeacherProfile',
  ];

  for (const table of PROFILE_TABLES) {
    const unique = await session.query<{ name: string }>(`
      SELECT i.name FROM sys.indexes i
      JOIN sys.index_columns ic
        ON ic.object_id = i.object_id AND ic.index_id = i.index_id
      JOIN sys.columns c
        ON c.object_id = ic.object_id AND c.column_id = ic.column_id
      WHERE i.object_id = OBJECT_ID(N'[dbo].[${table}]')
        AND i.is_unique = 1 AND c.name = N'personId';
    `);
    if (unique.length !== 1) {
      fail(
        `${table} has no unique index on personId, so one Person could hold two ` +
          `of the same facet. DOMAIN_MODEL.md §5.2 gives each Person at most one ` +
          `profile of each kind.`,
      );
    }
  }

  // ---- no stored capability anywhere in People -----------------------------
  //
  // BY SHAPE, not by table name. A `canTeach` column added to `Person`,
  // `TeacherProfile` or any child of them would be the stored boolean §4.5
  // prohibits, and it would look entirely reasonable in a diff.
  const capabilityColumns = await session.query<{ tableName: string; name: string }>(`
    SELECT t.name AS tableName, c.name
    FROM sys.columns c
    JOIN sys.tables t ON t.object_id = c.object_id
    WHERE t.name IN (
        N'Person', N'PersonTranslation', N'PersonNameVariant',
        N'AuthorProfile', N'SpeakerProfile', N'ScholarProfile', N'TeacherProfile',
        N'ScholarProfileTranslation', N'ScholarProfileLanguage',
        N'TeacherProfileTranslation', N'TeacherProfileLanguage'
      )
      AND (
        c.name LIKE N'can[A-Z]%'
        OR c.name LIKE N'is[A-Z]%'
        OR c.name LIKE N'%permission%'
        OR c.name LIKE N'%role%'
      );
  `);
  if (capabilityColumns.length > 0) {
    fail(
      `People schema carries a capability or privilege column: ` +
        `${capabilityColumns.map((row) => `${row.tableName}.${row.name}`).join(', ')}. ` +
        `Capability projections are derived from RoleAssignments and are never ` +
        `stored (DOMAIN_MODEL.md §4.5).`,
    );
  }

  report(
    'people foundation',
    `${permissions.length} permissions bundled, 4 distinct profile aggregates, ` +
      `0 capability columns, 0 early capability permissions`,
  );
}

async function assertSeedGuardsIdempotent(session: SqlSession): Promise<void> {
  const countOf = async (table: string): Promise<number> => {
    const [row] = await session.query<{ total: number }>(
      `SELECT COUNT_BIG(*) AS total FROM [dbo].[${table}];`,
    );
    return Number(row?.total ?? -1);
  };

  const before = {
    topics: await countOf('Topic'),
    translations: await countOf('TopicTranslation'),
    languages: await countOf('Language'),
    permissions: await countOf('Permission'),
  };

  await session.query(`
    INSERT INTO [dbo].[Topic] ([id], [slug], [parentId], [position], [status], [system])
    SELECT CONVERT(nvarchar(36), NEWID()), v.[slug], NULL, 0, N'active', 1
    FROM (VALUES (N'quran'), (N'hadith'), (N'peace')) AS v([slug])
    WHERE NOT EXISTS (SELECT 1 FROM [dbo].[Topic] t WHERE t.[slug] = v.[slug]);
  `);

  await session.query(`
    INSERT INTO [dbo].[TopicTranslation] ([topicId], [locale], [name])
    SELECT t.[id], N'en', N'Quran'
    FROM [dbo].[Topic] t
    WHERE t.[slug] = N'quran'
      AND NOT EXISTS (
          SELECT 1 FROM [dbo].[TopicTranslation] tr
          WHERE tr.[topicId] = t.[id] AND tr.[locale] = N'en'
      );
  `);

  await session.query(`
    INSERT INTO [dbo].[Language] ([code], [englishName], [nativeName], [direction], [status])
    SELECT v.[code], N'English', N'English', N'ltr', N'active'
    FROM (VALUES (N'en'), (N'ur'), (N'ar')) AS v([code])
    WHERE NOT EXISTS (SELECT 1 FROM [dbo].[Language] l WHERE l.[code] = v.[code]);
  `);

  const after = {
    topics: await countOf('Topic'),
    translations: await countOf('TopicTranslation'),
    languages: await countOf('Language'),
    permissions: await countOf('Permission'),
  };

  if (JSON.stringify(before) !== JSON.stringify(after)) {
    fail(
      `Re-applying the seed guards changed row counts.\n` +
        `  before: ${JSON.stringify(before)}\n  after:  ${JSON.stringify(after)}`,
    );
  }

  report('seed guards', `re-applied, counts unchanged (${before.topics} topics)`);
}

/** Asserts the CHECK constraints that carry a correctness rule. */
async function assertCheckConstraints(session: SqlSession): Promise<void> {
  for (const expected of EXPECTED_CHECK_CONSTRAINTS) {
    const rows = await session.query<{ name: string }>(`
      SELECT name FROM sys.check_constraints
      WHERE name = N'${expected.constraint}'
        AND parent_object_id = OBJECT_ID(N'[dbo].[${expected.table}]');
    `);
    if (rows.length !== 1) {
      fail(`The CHECK constraint ${expected.constraint} is missing after deploy.`);
    }
  }
  report('check constraints', `${EXPECTED_CHECK_CONSTRAINTS.length} verified`);
}

// Resolves docker/.env as the sole authority and proves the target is the
// approved local SQL Server before a database is created or the CLI is run.
const command = startLocalCommand('migration-target');
const { connection, environment } = command;
const principal = getApplicationPrincipalCredentials(environment.values);
const databaseName = newDisposableDatabaseName();

// The CLI must target the disposable database, over the SAME encrypted
// configuration the normal migration path uses. Only the database name
// differs, and the retargeted URL is re-proven as an approved local target.
const { url: disposableUrl } = retargetAtDisposable(command, databaseName);

const master = await openMasterSession(connection);
let session: SqlSession | undefined;

process.stdout.write(`Migration lifecycle on ${databaseName}\n`);

// Safe metadata only: never the password, never the whole URL.
reportConfiguration(command, 24);

try {
  const migrations = await loadMigrations();
  if (migrations.length === 0) fail('No migrations to test.');

  // Every migration must be described before any of it runs, so an
  // undescribed migration fails the gate rather than applying unverified.
  const expectedTables = migrations.flatMap((entry) => expectationsFor(entry));
  report('migrations', migrations.map((entry) => entry.id).join(', '));

  // ---- clean database ------------------------------------------------------
  await createDisposableDatabase(master, databaseName);
  session = await openSession(withDatabase(connection, databaseName));

  const initialTables = await userTables(session);
  if (initialTables.length > 0) {
    fail(`Expected an empty database; found: ${initialTables.join(', ')}`);
  }
  report('clean database', 'no user tables');

  // ---- REAL prisma migrate deploy ------------------------------------------
  const firstDeploy = await deployMigrations(disposableUrl, environment.values);
  for (const migration of migrations) {
    if (!firstDeploy.output.includes(migration.id)) {
      fail(
        `migrate deploy did not report applying ${migration.id}.\n${firstDeploy.output}`,
      );
    }
  }
  report('migrate deploy', `${migrations.length} migration(s) by the real Prisma CLI`);

  const firstStatus = await migrationStatus(disposableUrl, environment.values);
  assertHealthyStatus(firstStatus.output, 'the first deploy');
  report('migrate status', 'database schema is up to date');

  const editorialKeys = [
    'content.author',
    'content.publish',
    'content.read',
    'content.review',
    'correspondence.administer',
    'correspondence.read',
  ];
  const editorialRows = await session.query<{ key: string }>(
    "SELECT p.[key] FROM [Permission] p JOIN [RolePermission] rp ON rp.[permissionKey]=p.[key] JOIN [Role] r ON r.[id]=rp.[roleId] WHERE r.[key]=N'platform-administrator' AND (p.[key] LIKE N'content.%' OR p.[key] LIKE N'correspondence.%') ORDER BY p.[key];",
  );
  if (editorialRows.map((row) => row.key).join(',') !== editorialKeys.join(','))
    fail(
      'Editorial catalogue/protected bundle differs from its six accepted permissions.',
    );
  report('editorial permissions', 'six keys seeded and bundled');

  // ---- verify actual schema and history ------------------------------------
  const afterApply = await userTables(session);
  for (const table of expectedTables) {
    if (!afterApply.includes(table)) {
      fail(`${table} missing after deploy. Tables: ${afterApply.join(', ') || '(none)'}`);
    }
  }
  if (!afterApply.includes('_prisma_migrations')) {
    fail('Prisma did not create its own migration-history table.');
  }
  assertNoPrematureTables(afterApply, 'deploy');
  report('tables', `${expectedTables.length} expected table(s) present`);

  const columns = await auditColumns(session);
  if (columns.join(',') !== EXPECTED_AUDIT_COLUMNS.join(',')) {
    fail(
      `AuditLog columns unexpected.\n  expected: ${EXPECTED_AUDIT_COLUMNS.join(', ')}\n` +
        `  actual:   ${columns.join(', ')}`,
    );
  }

  const indexRows = await session.query<{ name: string }>(`
    SELECT name FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'[dbo].[AuditLog]') AND name IS NOT NULL
    ORDER BY name;
  `);
  const indexNames = indexRows.map((index) => index.name);
  for (const expected of EXPECTED_AUDIT_INDEXES) {
    if (!indexNames.includes(expected)) {
      fail(`Missing index ${expected}. Present: ${indexNames.join(', ')}`);
    }
  }
  report('audit schema', `${columns.length} columns, ${indexNames.length} indexes`);

  await assertColumnSizes(session);
  await assertNonPrismaObjects(session);
  await assertCheckConstraints(session);
  await assertNoPolymorphicAssignment(session);
  await assertTaxonomyFoundation(session);
  await assertNavigationPermission(session);
  await assertPeopleFoundation(session);
  await assertSeedGuardsIdempotent(session);

  const historyAfterApply = await appliedMigrationNames(session);
  for (const migration of migrations) {
    if (!historyAfterApply.includes(migration.id)) {
      fail(`Prisma history does not list ${migration.id} after deploy.`);
    }
  }

  // ---- least-privilege principal -------------------------------------------
  await provisionApplicationPrincipal(
    session,
    principal.DATABASE_APP_LOGIN,
    principal.DATABASE_APP_PASSWORD,
  );
  report('principal', `${principal.DATABASE_APP_LOGIN} provisioned`);

  // ---- seed, twice ---------------------------------------------------------
  const firstSeed = await runSeed(session);
  const secondSeed = await runSeed(session);
  if (JSON.stringify(firstSeed) !== JSON.stringify(secondSeed)) {
    fail(
      `Seed is not idempotent.\n  run 1: ${JSON.stringify(firstSeed)}\n` +
        `  run 2: ${JSON.stringify(secondSeed)}`,
    );
  }
  report('seed x2', `identical result, ${firstSeed.seededRecords} records seeded`);

  // ---- reviewed rollback artifacts, newest first ---------------------------
  //
  // Reverse order is the only safe one: a later migration's foreign keys
  // reference an earlier migration's tables, so rolling back oldest-first
  // would fail on a constraint that still exists.
  for (const migration of [...migrations].reverse()) {
    await rollbackMigration(session, migration);

    const afterThisRollback = await userTables(session);
    for (const table of expectationsFor(migration)) {
      if (afterThisRollback.includes(table)) {
        fail(`${table} still present after rolling back ${migration.id}.`);
      }
    }
    if (!afterThisRollback.includes('_prisma_migrations')) {
      fail('Rollback must not remove the Prisma history table itself.');
    }
    if ((await appliedMigrationNames(session)).includes(migration.id)) {
      fail(`Migration history still lists ${migration.id} after rollback.`);
    }
  }
  report('rollback', `${migrations.length} reversed, history rows removed`);

  // ---- REAL prisma migrate deploy, again -----------------------------------
  const secondDeploy = await deployMigrations(disposableUrl, environment.values);
  for (const migration of migrations) {
    if (!secondDeploy.output.includes(migration.id)) {
      fail(
        `Re-deploy did not re-apply ${migration.id} — the rollback left history ` +
          `claiming it was still applied.\n${secondDeploy.output}`,
      );
    }
  }
  report('migrate deploy', 're-applied by the real Prisma CLI');

  const finalStatus = await migrationStatus(disposableUrl, environment.values);
  assertHealthyStatus(finalStatus.output, 'the re-deploy');
  report('migrate status', 'database schema is up to date');

  // ---- verify final schema and history -------------------------------------
  const afterReapply = await userTables(session);
  for (const table of expectedTables) {
    if (!afterReapply.includes(table)) fail(`${table} missing after re-deploy.`);
  }
  assertNoPrematureTables(afterReapply, 're-deploy');

  if ((await auditColumns(session)).join(',') !== EXPECTED_AUDIT_COLUMNS.join(',')) {
    fail('Schema after re-deploy differs from the first deploy.');
  }
  await assertColumnSizes(session);
  await assertNonPrismaObjects(session);
  await assertCheckConstraints(session);
  await assertNoPolymorphicAssignment(session);
  await assertTaxonomyFoundation(session);
  await assertNavigationPermission(session);
  await assertPeopleFoundation(session);

  const finalHistory = await appliedMigrationNames(session);
  for (const migration of migrations) {
    if (!finalHistory.includes(migration.id)) {
      fail(`Migration history does not list ${migration.id} after re-deploy.`);
    }
  }
  report('final state', `history: ${finalHistory.join(', ')}`);

  process.stdout.write(
    'Migration lifecycle verified through the real Prisma CLI: ' +
      'deploy, status, rollback, deploy, status.\n',
  );
} finally {
  await session?.close();
  // Drops only the name this run generated; the guard re-verifies it.
  await dropDisposableDatabase(master, databaseName);
  await master.close();
}
