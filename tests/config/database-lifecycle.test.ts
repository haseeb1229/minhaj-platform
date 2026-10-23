import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  DISPOSABLE_PREFIX,
  assertDisposableDatabaseName,
  isDisposableDatabaseName,
  newDisposableDatabaseName,
} from '../../packages/database/src/lifecycle/disposable-database.ts';
import { loadMigrations } from '../../packages/database/src/lifecycle/migrations.ts';
import {
  SqlConnectionUrlError,
  openSession,
  parseSqlServerUrl,
} from '../../packages/database/src/lifecycle/sql-connection.ts';
import { repoRoot } from '../architecture/architecture-harness.ts';

const databaseRoot = path.join(repoRoot, 'packages', 'database');

/**
 * Phase 1 Chunk 2 — the parts of the lifecycle that can be proven without a
 * server. The live proofs (apply/rollback/re-apply, and the permission
 * boundary) run against real SQL Server in `npm run db:migrate:test` and
 * `npm run db:test:permissions`, and are asserted there against actual
 * database state rather than exit codes.
 */
describe('Phase 1 Chunk 2 migration convention', () => {
  it('pairs every forward migration with a reviewed rollback artifact', async () => {
    const migrations = await loadMigrations();

    expect(migrations.length).toBeGreaterThan(0);
    for (const migration of migrations) {
      expect(migration.forwardSql.length).toBeGreaterThan(0);
      expect(migration.rollbackSql.length).toBeGreaterThan(0);
    }
  });

  it('fails loudly when a forward migration has no rollback', async () => {
    // The pairing is enforced by loadMigrations, so a migration added without
    // its rollback breaks the build rather than being discovered during an
    // incident. Proven by pointing the same rule at the real directory listing.
    const migrationIds = (
      await readdir(path.join(databaseRoot, 'prisma', 'migrations'), {
        withFileTypes: true,
      })
    )
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);

    const rollbackFiles = await readdir(path.join(databaseRoot, 'sql', 'rollback'));

    for (const id of migrationIds) {
      expect(
        rollbackFiles,
        `migration ${id} must ship sql/rollback/${id}.rollback.sql`,
      ).toContain(`${id}.rollback.sql`);
    }
  });

  it('creates the delivered tables and no later-phase table', async () => {
    const migrations = await loadMigrations();
    const forward = migrations.map((migration) => migration.forwardSql).join('\n');

    // Every table a delivered phase owns is genuinely created by a migration.
    // A model in the schema that no migration creates is a table that will not
    // exist in a deployed database — a gap only the database would reveal, and
    // only at runtime.
    for (const table of [
      'AuditLog',
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
      // Phase 2 Chunk 2 — authorisation, step-up and the privileged second
      // factor, each created by the migration that delivers its enforcement.
      'Permission',
      'Role',
      'RolePermission',
      'RoleAssignment',
      'StepUpGrant',
      'TwoFactor',
      'PrivilegedSecurityPosture',
      'IdentityBootstrap',
      // Phase 3B — the canonical taxonomy, its per-interface-locale names, the
      // content-language reference data and editorial tags.
      'Topic',
      'TopicTranslation',
      'Language',
      'Tag',
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
      'Asset',
      // Phase 13 — Editorial's four News families, each with its own tables.
      'NewsArticle',
      'NewsArticleRevision',
      'NewsArticleRevisionTranslation',
      'NewsArticleTopic',
      'NewsArticleContributor',
      'NewsArticleSlugHistory',
      'PressRelease',
      'PressReleaseRevision',
      'PressReleaseRevisionTranslation',
      'PressReleaseTopic',
      'PressReleaseContributor',
      'PressReleaseSlugHistory',
      'Statement',
      'StatementRevision',
      'StatementRevisionTranslation',
      'StatementTopic',
      'StatementContributor',
      'StatementSlugHistory',
      'MediaCoverage',
      'MediaCoverageRevision',
      'MediaCoverageRevisionTranslation',
      'MediaCoverageTopic',
      'MediaCoverageContributor',
      'MediaCoverageSlugHistory',
      // Phase 16 — the Global Network directory and its Country-scoped slugs.
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
      // Phase 14 — Editorial's Event, its revision-owned occurrences and its
      // ordered Gallery associations.
      'Event',
      'EventRevision',
      'EventRevisionTranslation',
      'EventTopic',
      'EventContributor',
      'EventSchedule',
      'EventGallery',
      'EventSlugHistory',
      // Phase 15 — Editorial's Collection and its revision-owned, ordered,
      // typed members.
      'Collection',
      'CollectionRevision',
      'CollectionRevisionTranslation',
      'CollectionTopic',
      'CollectionContributor',
      'CollectionItem',
      'CollectionSlugHistory',
      // Phase 18 — Quran's sources, canonical store and evidence, layered works
      // and typed topic assignment.
      'QuranSource',
      'QuranSourceSurah',
      'QuranSourceAyah',
      'QuranActivation',
      'Juz',
      'Surah',
      'Ayah',
      'QuranVerificationRun',
      'QuranAyahRevision',
      'SurahName',
      'QuranTranslation',
      'QuranTranslationContributor',
      'QuranTranslationText',
      'QuranTransliteration',
      'QuranTransliterationText',
      'QuranTafsir',
      'QuranTafsirContributor',
      'QuranTafsirText',
      'QuranRecitation',
      'QuranRecitationSegment',
      'QuranTajweedRule',
      'QuranTajweedRuleText',
      'QuranTopic',
      // Phase 19 — Hadith's source systems, editions and activations, canonical
      // structure, records and evidence, layered works and typed topic
      // assignment.
      'HadithSourceSystem',
      'HadithCollection',
      'HadithEdition',
      'HadithActivation',
      'HadithBook',
      'HadithChapter',
      'Hadith',
      'HadithRevision',
      'HadithGrading',
      'HadithVerification',
      'HadithCitation',
      'HadithCitationRevision',
      'HadithConflict',
      'HadithCollectionName',
      'HadithBookName',
      'HadithChapterName',
      'HadithTranslation',
      'HadithTranslationContributor',
      'HadithCommentary',
      'HadithCommentaryContributor',
      'HadithCommentaryEntry',
      'HadithScience',
      'HadithScienceText',
      'HadithTopic',
      // Phase 20 — Fatwa's activation, categories, private questions, rulings
      // with their immutable revisions, topics, publications and decisions, and
      // the read tally.
      'FatwaActivation',
      'FatwaCategory',
      'FatwaCategoryName',
      'FatwaQuestion',
      'Fatwa',
      'FatwaRevision',
      'FatwaRevisionTopic',
      'FatwaPublication',
      'FatwaReviewDecision',
      'FatwaReadTally',
      // Phase 21 — Personalisation's own profile, saved items, bookmarks,
      // notes, private collections, history, Quran position, notification
      // preferences and notifications, and the newsletter with its consent
      // evidence.
      'PersonalisationProfile',
      'PersonalisationInterest',
      'PersonalisationGoal',
      'SavedItem',
      'Bookmark',
      'Note',
      'PrivateCollection',
      'PrivateCollectionItem',
      'ReadingHistory',
      'WatchHistory',
      'QuranReadingProgress',
      'NotificationPreference',
      'Notification',
      'NewsletterSubscriber',
      'NewsletterConsentEvent',
      // Phase 22 — Learning's Courses with their words, slug history, topics,
      // teachers, modules and lessons; LearningPaths with their words, slug
      // history and ordered Courses; and a person's enrolments, lesson progress
      // and trial-class requests.
      'Course',
      'CourseLabel',
      'CourseSlugHistory',
      'CourseTopic',
      'CourseTeacher',
      'CourseModule',
      'CourseModuleLabel',
      'Lesson',
      'LessonLabel',
      'LearningPath',
      'LearningPathLabel',
      'LearningPathSlugHistory',
      'LearningPathCourse',
      'Enrolment',
      'LessonProgress',
      'TrialClassRequest',
      // Phase 23 — Learning's live slice: the owner's activation, the typed
      // teaching scope, a teacher's windows, class sessions, the confirmed
      // trial Booking, attendance and the service-mail intent.
      'LiveLearningActivation',
      'CourseTeachingAssignment',
      'Availability',
      'ClassSession',
      'Booking',
      'Attendance',
      'ClassCommunicationIntent',
      // Phase 24 — Messaging: the owner's per-kind activation, conversations,
      // participants, messages, attachments, read positions, blocks, reports
      // and moderation decisions.
      'MessagingActivation',
      'Conversation',
      'ConversationParticipant',
      'Message',
      'MessageAttachment',
      'MessageReadState',
      'MessagingBlock',
      'MessagingReport',
      'MessagingModerationDecision',
      // Phase 26 — Membership: types and their words, applications, the
      // Membership an approval creates and the applicant service-mail intent.
      'MembershipType',
      'MembershipTypeTranslation',
      'MembershipApplication',
      'Membership',
      'MembershipCommunicationIntent',
      // Phase 27 — Donations: campaigns with their words and per-currency
      // policy, the owner's activation, donations, the provider-event dedup
      // record, refunds and the linked donor's acknowledgement intent.
      'DonationCampaign',
      'DonationCampaignTranslation',
      'DonationCampaignCurrency',
      'DonationActivation',
      'Donation',
      'DonationProviderEvent',
      'DonationRefund',
      'DonationCommunicationIntent',
      // Phase 29 — Migration & Provenance: fixture sources and their hosts,
      // runs and their items, legacy records, raw snapshots, staged revisions
      // with their categories and links, topic mappings, errors, duplicate
      // candidates, asset provenance, legacy mappings, manifests with their
      // entries, and promotions.
      'MigrationSource',
      'MigrationSourceHost',
      'MigrationRun',
      'MigrationRecord',
      'MigrationRunItem',
      'MigrationRawSnapshot',
      'MigrationStagedRecord',
      'MigrationStagedCategory',
      'MigrationStagedLink',
      'MigrationTopicMapping',
      'MigrationError',
      'MigrationDuplicateCandidate',
      'MigrationAssetProvenance',
      'MigrationLegacyMapping',
      'MigrationPublishManifest',
      'MigrationManifestEntry',
      'MigrationPromotion',
      'MigrationPromotionEntry',
    ]) {
      expect(forward).toMatch(new RegExp(`CREATE TABLE \\[dbo\\]\\.\\[${table}\\]`));
    }

    // Every LATER phase still arrives with the slice that owns it. (`Event`
    // left this list when Phase 14 delivered it, and `Collection` when Phase 15
    // did; Phase 18 delivers the Quran as its own tables, never one generic
    // `Quran` table; `Hadith` left it when Phase 19 delivered the record and
    // `Fatwa` when Phase 20 delivered the ruling; a context-less `Question`
    // is still no phase's. `PrivateCollection` and `Notification` left it when
    // Phase 21 delivered them, `Course` when Phase 22 did, and `ClassSession`,
    // `Availability`, `Attendance` and `Booking` when Phase 23 did, `Message`
    // when Phase 24 delivered Messaging, `Membership` when Phase 26 delivered
    // it, and `Donation` when Phase 27 delivered Donations; a bare `Teacher`
    // and a Course-level `CourseProgress` are still no delivered phase's, and
    // no phase creates a card, order, cart, invoice or subscription table.
    // Phase 29 delivers Migration & Provenance as its own `Migration*` tables,
    // never one generic `MigrationProvenance` table, and keeps no credential,
    // cookie or crawl queue for a legacy host.)
    for (const table of [
      'Quran',
      'Book',
      'Question',
      'Scholar',
      'Teacher',
      'CourseProgress',
      'MigrationProvenance',
      'DonationCard',
      'DonationPaymentMethod',
      'DonationOrder',
      'DonationCart',
      'DonationInvoice',
      'DonationSubscription',
      'DonationPayload',
      'PaymentMethod',
      'MigrationCredential',
      'MigrationCookie',
      'MigrationCrawlQueue',
      'MigrationTarget',
    ]) {
      expect(forward).not.toMatch(new RegExp(`CREATE TABLE \\[dbo\\]\\.\\[${table}\\]`));
    }

    // And a shape no phase may ever create. These are not EARLY tables — they
    // are the polymorphic topic assignment DOMAIN_MODEL.md §6.2 prohibits
    // outright, because SQL Server cannot foreign-key a target type and
    // identifier pair to many tables. A later phase does not make one lawful.
    for (const table of [
      'TopicAssignment',
      'TaxonomyAssignment',
      'EntityTopic',
      'ContentTopic',
      'TopicTarget',
    ]) {
      expect(forward).not.toMatch(new RegExp(`CREATE TABLE \\[dbo\\]\\.\\[${table}\\]`));
    }
  });

  it('records audit timestamps in UTC rather than local server time', async () => {
    const migrations = await loadMigrations();
    const forward = migrations.map((migration) => migration.forwardSql).join('\n');

    // CURRENT_TIMESTAMP is local server time; the meaning of an audit record
    // must not shift with the host timezone.
    expect(forward).toContain('SYSUTCDATETIME()');
    expect(forward).not.toContain('CURRENT_TIMESTAMP');
  });

  it('reverses exactly what the forward migration created', async () => {
    const [migration] = await loadMigrations();
    expect(migration).toBeDefined();

    const rollback = migration?.rollbackSql ?? '';
    expect(rollback).toMatch(/DROP TABLE \[dbo\]\.\[AuditLog\]/);

    // History must move with the schema; a stale row would make the re-apply
    // a silent no-op.
    expect(rollback).toMatch(/DELETE FROM \[dbo\]\.\[_prisma_migrations\]/);
    expect(rollback).toContain(migration?.id ?? '');
  });
});

describe('Phase 1 Chunk 2 disposable test databases', () => {
  it('accepts only the exact disposable naming convention', () => {
    const generated = newDisposableDatabaseName();

    expect(generated.startsWith(DISPOSABLE_PREFIX)).toBe(true);
    expect(isDisposableDatabaseName(generated)).toBe(true);
    expect(() => assertDisposableDatabaseName(generated)).not.toThrow();
  });

  it('refuses to operate destructively on anything else', () => {
    for (const name of [
      'master',
      'tempdb',
      'model',
      'msdb',
      'MinhajPlatform',
      'SQLEXPRESS',
      '',
      'MinhajPhase1Test_',
      'MinhajPhase1Test_short',
      'MinhajPhase1Test_00000000000000000000000000000000extra',
      'XMinhajPhase1Test_0123456789abcdef0123456789abcdef',
      'MinhajPhase1Test_0123456789abcdef0123456789abcdef]; DROP DATABASE [master',
    ]) {
      expect(isDisposableDatabaseName(name), `${name} must not be disposable`).toBe(
        false,
      );
      expect(() => assertDisposableDatabaseName(name)).toThrow(/Refusing to operate/);
    }
  });
});

describe('Phase 1 Chunk 2 connection handling', () => {
  it('parses a SQL Server URL into its components', () => {
    const parsed = parseSqlServerUrl(
      'sqlserver://localhost:14330;database=MinhajPlatform;user=minhaj_app;' +
        'password=parse-test-value;encrypt=true;trustServerCertificate=true',
    );

    expect(parsed.server).toBe('localhost');
    expect(parsed.port).toBe(14330);
    expect(parsed.database).toBe('MinhajPlatform');
    expect(parsed.user).toBe('minhaj_app');
    expect(parsed.encrypt).toBe(true);
    expect(parsed.trustServerCertificate).toBe(true);
  });

  it('reads a brace-quoted password containing semicolons', () => {
    // Braces exist so a value may contain the `;` separator. Splitting naively
    // truncated such a password mid-value, which is how its suffix escaped
    // redaction.
    const parsed = parseSqlServerUrl(
      'sqlserver://localhost:14330;database=MinhajPlatform;user=minhaj_app;' +
        'password={prefix;middle;suffix};encrypt=true;trustServerCertificate=true',
    );

    expect(parsed.password).toBe('prefix;middle;suffix');
    expect(parsed.encrypt).toBe(true);
    expect(parsed.trustServerCertificate).toBe(true);
  });

  it('recognises the pwd alias rather than parsing an empty password', () => {
    const parsed = parseSqlServerUrl(
      'sqlserver://localhost:14330;database=MinhajPlatform;user=minhaj_app;' +
        'pwd=alias-test-value;encrypt=true',
    );

    expect(parsed.password).toBe('alias-test-value');
  });

  /**
   * Every leak vector the review reported, asserted on the WHOLE synthetic
   * marker and on the supplied URL itself. The markers are deliberately
   * distinctive so a partial leak cannot pass as a coincidental substring.
   */
  describe('never places connection-string secrets in a thrown error', () => {
    const cases: { name: string; credential: string; marker: string }[] = [
      {
        name: 'plain password',
        credential: 'password=REVIEW_SIMPLE_SECRET',
        marker: 'REVIEW_SIMPLE_SECRET',
      },
      {
        name: 'braced password containing a semicolon',
        credential: 'password={prefix;REVIEW_SUFFIX_SECRET}',
        marker: 'REVIEW_SUFFIX_SECRET',
      },
      {
        name: 'pwd alias',
        credential: 'pwd=REVIEW_PWD_SECRET',
        marker: 'REVIEW_PWD_SECRET',
      },
    ];

    for (const { name, credential, marker } of cases) {
      it(`omits the ${name} from a validation failure`, () => {
        // No `database=` component, so parsing must fail and report.
        const url = `sqlserver://localhost:14330;${credential};encrypt=true`;

        let thrown: unknown;
        expect(() => {
          try {
            parseSqlServerUrl(url);
          } catch (error) {
            thrown = error;
            throw error;
          }
        }).toThrow(SqlConnectionUrlError);

        const rendered = `${String(thrown)}\n${(thrown as Error).stack ?? ''}\n${JSON.stringify(thrown)}`;

        expect(rendered, 'the secret marker must not appear').not.toContain(marker);
        expect(rendered, 'the supplied URL must not appear').not.toContain(url);
        expect(rendered).not.toContain(credential);

        // Still actionable: it names the component at fault.
        expect((thrown as SqlConnectionUrlError).component).toBe('database');
      });

      it(`omits the ${name} from a scheme failure`, () => {
        const url = `postgres://localhost:14330;database=D;${credential}`;

        let thrown: unknown;
        try {
          parseSqlServerUrl(url);
        } catch (error) {
          thrown = error;
        }

        const rendered = `${String(thrown)}\n${(thrown as Error).stack ?? ''}`;
        expect(rendered).not.toContain(marker);
        expect(rendered).not.toContain(url);
      });
    }

    it('omits secrets from a real connection failure', async () => {
      // A port nothing listens on: a genuine driver-level failure, not a
      // parse error, so the driver's own message is covered too.
      const url =
        'sqlserver://127.0.0.1:14399;database=MinhajPlatform;user=minhaj_app;' +
        'password={prefix;REVIEW_SUFFIX_SECRET};encrypt=true;trustServerCertificate=true';

      let thrown: unknown;
      try {
        await openSession(parseSqlServerUrl(url));
      } catch (error) {
        thrown = error;
      }

      expect(thrown, 'connecting to a closed port must fail').toBeDefined();

      const rendered = `${String(thrown)}\n${(thrown as Error).stack ?? ''}`;
      expect(rendered).not.toContain('REVIEW_SUFFIX_SECRET');
      expect(rendered).not.toContain('prefix;REVIEW_SUFFIX_SECRET');
      expect(rendered).not.toContain(url);
    }, 60_000);
  });
});

describe('Phase 1 Chunk 2 permission artifact', () => {
  it('grants only audit INSERT/SELECT and denies mutation and DDL', async () => {
    const script = await readFile(
      path.join(databaseRoot, 'sql', 'permissions', 'grant-application-principal.sql'),
      'utf8',
    );

    expect(script).toMatch(/GRANT INSERT, SELECT ON OBJECT::\[dbo\]\.\[AuditLog\]/);
    expect(script).toMatch(/DENY UPDATE, DELETE, ALTER ON OBJECT::\[dbo\]\.\[AuditLog\]/);
    expect(script).toMatch(/DENY ALTER, CREATE TABLE/);
  });

  it('never grants a broad role or a schema-wide privilege', async () => {
    const script = await readFile(
      path.join(databaseRoot, 'sql', 'permissions', 'grant-application-principal.sql'),
      'utf8',
    );

    // A schema-level grant silently extends to every table a later phase adds.
    expect(script).not.toMatch(/GRANT[^;]*ON SCHEMA::/i);
    expect(script).not.toMatch(/ALTER ROLE\s+\[?db_owner/i);
    expect(script).not.toMatch(/ALTER ROLE\s+\[?db_ddladmin/i);
    expect(script).not.toMatch(/sp_addsrvrolemember|ALTER SERVER ROLE/i);
    expect(script).not.toMatch(/GRANT CONTROL/i);
  });

  it('carries no password literal', async () => {
    const script = await readFile(
      path.join(databaseRoot, 'sql', 'permissions', 'grant-application-principal.sql'),
      'utf8',
    );

    // The password arrives as a substituted variable, never as source. Every
    // PASSWORD clause must therefore be built by concatenating the QUOTENAME'd
    // variable, never by embedding a literal.
    expect(script).toContain('$(app_password)');

    for (const clause of script.match(/PASSWORD\s*=\s*[^\n]*/gi) ?? []) {
      expect(clause, `password clause must not embed a literal: ${clause}`).toMatch(
        /PASSWORD\s*=\s*'\s*\+\s*$/,
      );
    }

    expect(script).toMatch(/QUOTENAME\(N'\$\(app_password\)'/);
  });
});
