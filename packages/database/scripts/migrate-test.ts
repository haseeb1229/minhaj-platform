import 'server-only';

import { createHash, randomUUID } from 'node:crypto';

import {
  EXTERNALLY_GATED_PERMISSIONS,
  PERMISSION_CATALOGUE,
  PLATFORM_ADMINISTRATOR_PERMISSIONS,
} from '@minhaj/contracts/identity';

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
  '20260922000000_phase8_library': [
    'Work',
    'SalePoint',
    'WorkLabel',
    'WorkSlugHistory',
    'WorkContributor',
    'WorkTopic',
    'Edition',
    'BookTranslation',
    'BookTranslator',
    'WorkSalePoint',
  ],
  // DERIVED STATE: the projection and its operational state, nothing a business
  // context owns (ARCHITECTURE.md §8.5). `assertSearchFoundation` proves the
  // full-text objects Prisma's schema language cannot describe.
  '20260923000000_phase17_search_foundation': [
    'SearchIndexRequest',
    'SearchIndexScope',
    'SearchDocument',
    'SearchDocumentTopic',
  ],
  // SIX DISTINCT AGGREGATES and their typed relation sets — never one content
  // table with a type column (DOMAIN_MODEL.md §10.2). Research and ResearchPaper
  // alone carry citations; an issue's slug history is keyed within its Magazine.
  // THREE MEDIA AGGREGATES — Video, Series, Playlist — and their typed relation
  // sets: no generic media table, no Program table, no audio or gallery table
  // (DOMAIN_MODEL.md §11). A Video's Series is a nullable foreign key on the
  // Video; a Playlist's membership is its own typed, ordered table.
  // TWO AUDIO AGGREGATES — AudioTrack and AudioSeries — and their typed relation
  // sets. The file is ONE nullable foreign key from a track to a Storage Asset,
  // never a generic asset-link table; an AudioSeries is its own table, never the
  // Video `Series` (DOMAIN_MODEL.md §8.1, §11).
  // THREE PHOTOGRAPH SHAPES — Photo, Gallery, GalleryItem — and their labels and
  // the Gallery's slug history. A Photo's image is ONE nullable foreign key to a
  // Storage Asset; a Gallery's membership is its own typed, ordered table; no
  // Album, image, asset-link or Event-owned join exists (DOMAIN_MODEL.md §11).
  // FOUR EDITORIAL AGGREGATES — NewsArticle, PressRelease, Statement and
  // MediaCoverage — each with the Article's own shape of tables: record,
  // immutable revisions, translations, typed Topic and Person references and a
  // permanent slug reservation. Never one News table with a type column, and no
  // image, Event, Centre or newsletter table (DOMAIN_MODEL.md §7.1).
  // THE GLOBAL NETWORK — Country, Region, City, Centre and CentreContact, their
  // labels and permanent slug reservations, and the typed same-Country
  // relation of a Centre to the further Cities it serves. No Event, map,
  // geocoder, import or search table; centre-scoped News is a column on the
  // existing NewsArticle revision, asserted by `assertGlobalFoundation`.
  // ONE EDITORIAL EVENT AGGREGATE with the Article's own shape of tables, and two
  // typed revision-owned sets: its occurrences and its ordered Media Galleries.
  // Its Centre is ONE nullable column on the revision, never a join table; no
  // registration, ticket, venue, recurrence, image or generic attachment table
  // exists (DOMAIN_MODEL.md §7.1), asserted by `assertEventFoundation`.
  // ONE EDITORIAL COLLECTION AGGREGATE with the Article's own shape of tables,
  // and ONE revision-owned ordered membership: a single mixed order whose every
  // place holds exactly one of seven typed, non-cascading member references.
  // Never a `targetType + targetId` pair, never a join table per member type,
  // and never a user's private collection (DOMAIN_MODEL.md §7.1, §6.2),
  // asserted by `assertCollectionFoundation` and proved as behaviour by
  // `assertCollectionMembership`.
  // THE QURAN CONTEXT in four postures: the operator-registered SOURCE and its
  // activation; the CANONICAL structure, text, history and verification
  // evidence, written only by three procedures; the LAYERED works over it; and
  // typed topic assignment. The canonical citation `(surah, ayah)` IS the Ayah's
  // identity, and NOT ONE ROW of content is seeded (DOMAIN_MODEL.md §8),
  // asserted by `assertQuranFoundation` and proved as behaviour by
  // `assertQuranCanonicalRules`.
  // THE HADITH CONTEXT in the same four postures: operator-registered SOURCE
  // systems, editions and activations; the CANONICAL structure, source-qualified
  // records, history, gradings, verification, citation mapping and conflict
  // evidence, written only by six procedures; the LAYERED works; typed topic
  // assignment. A record's identity is its source — collection, source system,
  // edition and the source's own reference — and a public citation is a
  // SEPARATE reviewed mapping; NOT ONE ROW of content is seeded (DOMAIN_MODEL.md
  // §9), asserted by `assertHadithFoundation` and proved as behaviour by
  // `assertHadithCanonicalRules`.
  // THE PERSONALISATION & NOTIFICATIONS CONTEXT: a person's OWN profile and
  // onboarding answers, saved items with their bookmarks and notes, private
  // collections, reading and watch history, one Quran position, notification
  // preferences and in-app notifications; and the newsletter subscription —
  // consent from an address, never an account — with append-only consent
  // evidence. Every target is a typed, non-cascading key to its owner's row,
  // never a `targetType + targetId` pair; NOT ONE ROW is seeded, and the two
  // newsletter keys join the protected bundle (DOMAIN_MODEL.md §14), asserted
  // by `assertPersonalisationFoundation` and proved as behaviour by
  // `assertPersonalisationRules`.
  // THE MESSAGING CONTEXT: the owner's per-kind activation (fail closed until a
  // kind's row exists), conversations that name their Course and their two
  // accounts — or, for support, their person — by typed keys, historical
  // participants, ordered immutable messages, attachments naming a Storage
  // Asset and their own Message by a composite key that carries the
  // conversation, forward-only read positions, blocks, reports and permanent
  // moderation decisions; and Storage's one new column, the release digest.
  // Every key is NO ACTION; NOT ONE ROW is seeded — no activation, so messaging
  // is OFF — and `messaging.support` and `messaging.moderate` are catalogued,
  // externally gated and bundled into no role (DOMAIN_MODEL.md §15), asserted
  // by `assertMessagingFoundation` and proved as behaviour by
  // `assertMessagingRules`.
  // THE MEMBERSHIP CONTEXT: a type with its words per locale, an account's
  // application along its lifecycle, the Membership an approval creates —
  // naming its OWN approved application by a composite key that carries the
  // applicant and the type — and the durable applicant service-mail intent,
  // naming exactly one application or Membership by a composite key that
  // carries its recipient. One OPEN application and one ACTIVE Membership per
  // account and type (filtered keys). Every key is NO ACTION; NOT ONE ROW is
  // seeded; no payment, fee or donation column exists; and `membership.read`
  // and `membership.administer` join the protected bundle (DOMAIN_MODEL.md
  // §17.2), asserted by `assertMembershipFoundation` and proved as behaviour
  // by `assertMembershipRules`.
  // THE MIGRATION & PROVENANCE CONTEXT: a legacy source with its fixed hosts,
  // an import run with its per-record items, the stable legacy record, the raw
  // snapshot (evidence bound to its SHA-256, disposed of but never deleted),
  // the staged revision with its categories and extracted links, the topic
  // mapping, the import error, the duplicate candidate, the asset provenance,
  // the legacy URL mapping, the publish manifest with its entries and the
  // reviewed promotion. Composite keys keep every child inside its own record
  // and source; one OPEN run per source, one ACTIVE mapping per legacy URL and
  // one LIVE manifest entry per staged revision (filtered keys). Every key is
  // NO ACTION; NOT ONE ROW is seeded — no source exists, so nothing can run —
  // `migration.read` and `migration.administer` join the protected bundle and
  // `migration.publish` is catalogued, externally gated and bundled into no
  // role (DOMAIN_MODEL.md §16), asserted by `assertMigrationFoundation` and
  // proved as behaviour by `assertMigrationRules`.
  '20261011000000_phase29_migration_provenance': [
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
  ],
  // THE DONATIONS CONTEXT: a campaign with its words per locale and its
  // per-currency policy, the owner's fail-closed provider activation (one
  // immutable row the runtime can only read), the donation — one payment
  // attempt in exact minor units with its derived state — the provider-event
  // dedup record (no payload), the refund and the linked donor's durable
  // acknowledgement intent, naming its donation and refund by composite keys
  // that carry the donor and the donation. Provider references are unique
  // within their provider scope (filtered keys). Every key is NO ACTION; NOT
  // ONE ROW is seeded — no activation, so payments are OFF — `donations.read`
  // and `donations.administer` join the protected bundle and `donations.refund`
  // is catalogued, externally gated and bundled into no role (DOMAIN_MODEL.md
  // §17.3), asserted by `assertDonationsFoundation` and proved as behaviour by
  // `assertDonationsRules`.
  '20261010000000_phase27_donations': [
    'DonationCampaign',
    'DonationCampaignTranslation',
    'DonationCampaignCurrency',
    'DonationActivation',
    'Donation',
    'DonationProviderEvent',
    'DonationRefund',
    'DonationCommunicationIntent',
  ],
  '20261009000000_phase26_membership': [
    'MembershipType',
    'MembershipTypeTranslation',
    'MembershipApplication',
    'Membership',
    'MembershipCommunicationIntent',
  ],
  '20261008000000_phase24_messaging': [
    'MessagingActivation',
    'Conversation',
    'ConversationParticipant',
    'Message',
    'MessageAttachment',
    'MessageReadState',
    'MessagingBlock',
    'MessagingReport',
    'MessagingModerationDecision',
  ],
  // THE LEARNING CONTEXT'S SECOND SLICE: the owner's live-learning activation
  // (fail closed until a row exists), the TYPED Course teaching scope naming
  // the exact Identity RoleAssignment that carries `teaching.perform`, a
  // teacher's bookable windows, class sessions on a published live Course under
  // a current scope OF THAT COURSE (a composite key), the conflict-safe trial
  // Booking with one live claim per window (a filtered key), attendance marks
  // and the durable service-mail intent. Every key is NO ACTION; NOT ONE ROW is
  // seeded — no activation, so live learning is OFF — `teaching.perform` is
  // catalogued, externally gated and bundled into no role, and the two class
  // keys join the protected bundle (DOMAIN_MODEL.md §13.1–13.3), asserted by
  // `assertClassesFoundation` and proved as behaviour by `assertClassesRules`.
  '20261007000000_phase23_teacher_live_classes': [
    'LiveLearningActivation',
    'CourseTeachingAssignment',
    'Availability',
    'ClassSession',
    'Booking',
    'Attendance',
    'ClassCommunicationIntent',
  ],
  // THE LEARNING CONTEXT'S FIRST SLICE: the public catalogue of Courses — their
  // labels, typed topics, attributed teachers, modules and lessons — and
  // LearningPaths with their ordered Courses and permanent slug reservations; a
  // person's own Enrolments and lesson Progress; and the REQUEST side of a trial
  // class. Nothing schedules — the session, availability, attendance and
  // booking tables are Phase 23's — and every key is NO ACTION; NOT ONE ROW is
  // seeded, and the two Learning keys join the protected bundle
  // (DOMAIN_MODEL.md §13), asserted by `assertLearningFoundation` and proved as
  // behaviour by `assertLearningRules`.
  '20261006000000_phase22_learning': [
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
  ],
  '20261005000000_phase21_personalisation_notifications': [
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
  ],
  // THE FATWA CONTEXT: the operator's activation, a category that maps onto one
  // canonical Topic, the PRIVATE question, the public ruling as a sequence of
  // immutable revisions with their typed topics, publications and review
  // decisions, and an anonymous per-day read tally. Workflow tables are written
  // only by procedures re-checking a live permission; NOT ONE ROW is seeded,
  // and the three keys are catalogued but bundled into NO role (DOMAIN_MODEL.md
  // §12, OPEN_DECISIONS.md §1.4, §6.3), asserted by `assertFatwaFoundation` and
  // proved as behaviour by `assertFatwaRules`.
  '20261004000000_phase20_fatwa': [
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
  ],
  '20261003000000_phase19_hadith': [
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
  ],
  '20261002000000_phase18_quran': [
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
  ],
  '20261001000000_phase15_collections': [
    'Collection',
    'CollectionRevision',
    'CollectionRevisionTranslation',
    'CollectionTopic',
    'CollectionContributor',
    'CollectionItem',
    'CollectionSlugHistory',
  ],
  '20260930000000_phase14_events': [
    'Event',
    'EventRevision',
    'EventRevisionTranslation',
    'EventTopic',
    'EventContributor',
    'EventSchedule',
    'EventGallery',
    'EventSlugHistory',
  ],
  '20260929000000_phase16_global_network': [
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
  ],
  '20260928000000_phase13_news': [
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
  ],
  '20260927000000_phase12_media_galleries': [
    'Photo',
    'PhotoLabel',
    'Gallery',
    'GalleryLabel',
    'GallerySlugHistory',
    'GalleryItem',
  ],
  '20260926000000_phase11_media_audio': [
    'AudioTrack',
    'AudioTrackLabel',
    'AudioTrackSlugHistory',
    'AudioTrackSpeaker',
    'AudioTrackTopic',
    'AudioSeries',
    'AudioSeriesLabel',
    'AudioSeriesSlugHistory',
  ],
  '20260925000000_phase10_media_video': [
    'VideoLabel',
    'VideoSlugHistory',
    'VideoSpeaker',
    'VideoTopic',
    'Series',
    'SeriesLabel',
    'SeriesSlugHistory',
    'Playlist',
    'PlaylistLabel',
    'PlaylistSlugHistory',
    'PlaylistVideo',
  ],
  '20260924000000_phase9_research_publications': [
    'Research',
    'ResearchLabel',
    'ResearchSlugHistory',
    'ResearchContributor',
    'ResearchTopic',
    'ResearchCitation',
    'ResearchPaper',
    'ResearchPaperLabel',
    'ResearchPaperSlugHistory',
    'ResearchPaperContributor',
    'ResearchPaperTopic',
    'ResearchPaperCitation',
    'Publication',
    'PublicationLabel',
    'PublicationSlugHistory',
    'PublicationContributor',
    'PublicationTopic',
    'Magazine',
    'MagazineLabel',
    'MagazineSlugHistory',
    'MagazineContributor',
    'MagazineTopic',
    'MagazineIssue',
    'MagazineIssueLabel',
    'MagazineIssueSlugHistory',
    'MagazineIssueContributor',
    'MagazineIssueTopic',
    'Encyclopedia',
    'EncyclopediaLabel',
    'EncyclopediaSlugHistory',
    'EncyclopediaContributor',
    'EncyclopediaTopic',
  ],
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
  // `Event` left this list when Phase 14 delivered it, and `Collection` when
  // Phase 15 delivered it as Editorial's public, curated aggregate. A user's
  // private saved list left it when Phase 21 delivered `PrivateCollection` as
  // Personalisation's own; it shares no table with the editorial Collection.
  'Quran',
  // `Hadith` left this list when Phase 19 delivered it as the source-qualified
  // record of its own context. `Fatwa` left it when Phase 20 delivered the
  // ruling with its revisions; the private question is `FatwaQuestion`, never a
  // context-less `Question`.
  'Book',
  'Question',
  // `Scholar` and `Teacher` stay here after Phase 5, and the near-miss is
  // deliberate. Phase 5 delivers `ScholarProfile` and `TeacherProfile` —
  // FACETS of a Person. A bare `Scholar` or `Teacher` table would be a second,
  // standalone notion of the same human being, which is the duplication
  // DOMAIN_MODEL.md §5 exists to remove. Phase 22 delivers no `Teacher` either:
  // a Course names its teachers as People's `Person` through `CourseTeacher`.
  'Scholar',
  'Teacher',
  // `Notification` left this list when Phase 21 delivered the in-app record.
  // `Course` and `LessonProgress` left it when Phase 22 delivered them as
  // Learning's own; a course-level `CourseProgress` is still no phase's —
  // progress is recorded per lesson and summarised, never stored twice.
  'CourseProgress',
  // `ClassSession`, `Availability`, `Attendance` and `Booking` left this list
  // when Phase 23 delivered them as Learning's own live slice, each its own
  // aggregate; a teacher's window is `Availability` of an ACCOUNT, never a
  // `TeacherAvailability` of a profile. Nor does any phase relate a Course to a
  // Video or a Centre — a later phase that needs one adds the prerequisite
  // first.
  'TeacherAvailability',
  'CourseVideo',
  'LessonVideo',
  'CourseCentre',
  // `Message` left this list when Phase 24 delivered it as Messaging's own,
  // ordered and immutable within its Conversation, `Membership` when Phase 26
  // delivered it as the organisational relationship an approval creates, and
  // `Donation` when Phase 27 delivered it as one payment attempt. Phase 29
  // delivers Migration & Provenance as the eighteen `Migration*` tables; a
  // single generic `MigrationProvenance` table is still no phase's.
  'MigrationProvenance',
  // Phase 9 delivers the six scholarly and periodical aggregates and invents no
  // sub-aggregate beside them: an issue is not a set of articles, a publication
  // has no issues, and an encyclopedia's structure is its readable document.
  'MagazineArticle',
  'PublicationIssue',
  'PeriodicalIssue',
  'EncyclopediaEntry',
  // Phase 10 delivers Video, Series and Playlist and nothing else of Media's
  // that is not its own: a programme is a Series kind. Watch history left this
  // list when Phase 21 delivered it as Personalisation's per-user state.
  'Program',
  // Phase 11 delivers non-Quran audio and nothing of Quran's: a Recitation and
  // its verse mapping belong to Phase 18, which delivers them as Quran's own
  // `QuranRecitation` and `QuranRecitationSegment` — so a bare, context-less
  // `Recitation` stays absent. No listening history is authorised by any phase.
  'Recitation',
  'RecitationSegment',
  'ListeningHistory',
  // Phase 18 delivers the Quran with NO per-user reading state, and with slugs
  // that never change, so no layered work owes a slug history. Phase 21
  // delivers the reading position as Personalisation's `QuranReadingProgress`
  // and a saved Ayah as a typed `SavedItem` — so a Quran-owned bookmark table
  // stays absent.
  'QuranBookmark',
  'QuranListeningHistory',
  'QuranTranslationSlugHistory',
  'QuranTafsirSlugHistory',
  'QuranRecitationSlugHistory',
  // Phase 19 delivers Hadith with NO per-user state — bookmarks and progress are
  // Phase 21's — and with slugs that never change, so no layered work or
  // structure owes a slug history.
  'HadithBookmark',
  'HadithReadingProgress',
  'HadithCollectionSlugHistory',
  'HadithCommentarySlugHistory',
  'HadithScienceSlugHistory',
  // Phase 20 delivers Fatwa with NO per-user state — saved rulings are Phase
  // 21's — and with a slug that freezes at first publication, so no ruling or
  // category owes a slug history.
  'FatwaBookmark',
  'FatwaSlugHistory',
  'FatwaCategorySlugHistory',
  // Phase 12 delivers galleries with NO Event relationship: the typed
  // Event↔Gallery association is Phase 14's `EventGallery`, which left this list
  // when Phase 14 delivered it on the Event revision. A Media-owned reverse join
  // or a per-photograph Event link is still no phase's.
  'GalleryEvent',
  'EventPhoto',
  'PhotoPerson',
  'PhotoTopic',
  // Phase 13 delivers News with NO Event or newsletter relationship: the
  // newsletter is Phase 21's consent record (`NewsletterSubscriber` left this
  // list when Phase 21 delivered it), and a News lead image would need a
  // Storage or Media dependency no phase has decided. `Centre` left this list
  // when Phase 16 delivered it. Phase 21 delivers NO sending capability, so no
  // campaign, issue or delivery table exists for the newsletter.
  'NewsletterCampaign',
  'NewsletterIssue',
  'NewsletterDelivery',
  'NewsArticleImage',
  'NewsArticleAsset',
  'NewsArticlePhoto',
  // Phase 16 delivers the Global Network with NO Event relationship: the typed
  // Event→Centre reference is Phase 14's, and Phase 14 delivers it as the
  // revision's own `centreId` column — so a Global-owned or join-table shape of
  // it stays absent. `EventSchedule` left this list when Phase 14 delivered it.
  'CentreEvent',
  'EventCentre',
  // Phase 26 delivers Membership with NO payment concept: no fee, dues,
  // invoice, receipt or payment table beside it, and no application form,
  // profile or document table — an application holds an account, a type, its
  // status and its instants, nothing more.
  'MembershipPayment',
  'MembershipFee',
  'MembershipDues',
  'MembershipInvoice',
  'MembershipReceipt',
  'MembershipApplicationForm',
  'MembershipDocument',
  // Phase 27 delivers Donations as hosted-checkout payment attempts and NOT as
  // ecommerce or a card vault: no card, payment method, wallet or billing
  // table, no order, cart, invoice or receipt, no subscription or recurring
  // plan, and no raw provider payload or webhook body is kept anywhere — an
  // event keeps its digest only.
  'DonationCard',
  'DonationPaymentMethod',
  'DonationBilling',
  'DonationOrder',
  'DonationCart',
  'DonationInvoice',
  'DonationReceipt',
  'DonationSubscription',
  'DonationRecurring',
  'DonationPayload',
  'DonationWebhook',
  'PaymentMethod',
  'Card',
  'Cart',
  'Order',
  'Invoice',
  'Subscription',
  // Phase 29 contacts no live source and so keeps no credential, cookie or
  // session for one, no crawl queue that would let a runtime scrape, and no
  // generic target table: a published record names its target by a typed key.
  // Written authorisation per source is Phase 30's (OPEN_DECISIONS.md §3.1).
  'MigrationCredential',
  'MigrationCookie',
  'MigrationSession',
  'MigrationCrawlQueue',
  'MigrationTarget',
  'MigrationAuthorisation',
  'ScrapeQueue',
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

  // PHASE 9 — one generic content table with a type column would collapse six
  // aggregates into one lifecycle and one slug namespace (DOMAIN_MODEL.md §10.2).
  'Content',
  'ContentItem',
  'LibraryResource',
  'ScholarlyRecord',

  // PHASE 10 — ONE Video entity. A generic media table with a type column, or a
  // table per provider or per kind of video, would split one resource into
  // several (DOMAIN_MODEL.md §11); a Video asset table would mean hosting bytes.
  'MediaItem',
  'YouTubeVideo',
  'VimeoVideo',
  'LectureVideo',
  'VideoAsset',

  // PHASE 11 — TWO audio aggregates. A playlist, podcast, album or episode of
  // audio would be a second grouping invented without a need, and a generic
  // asset-link or asset-owner table would be the polymorphic reference §6.2
  // refuses: a track's file is its own typed foreign key.
  'AudioPlaylist',
  'Podcast',
  'Album',
  'Episode',
  'AudioTrackAsset',
  'AssetLink',
  'AssetOwner',
  'MediaAsset',

  // PHASE 12 — THREE photograph shapes. An Album, a generic Image or a second
  // cover relation would be groupings invented without a need, and a
  // gallery-target table would be the polymorphic reference §6.2 refuses.
  'Album',
  'AlbumPhoto',
  'Image',
  'PhotoAsset',
  'GalleryTarget',
  'GalleryCover',

  // PHASE 13 — FOUR News aggregates. One generic editorial or News table with a
  // type column would collapse four lifecycles and four slug namespaces into
  // one, and a generic revision table would do the same to their histories.
  'EditorialContent',
  'NewsItem',
  'NewsContent',
  'ContentRevision',
  'EditorialRevision',

  // PHASE 16 — ONE News model with a Centre reference (DOMAIN_MODEL.md §18).
  // A per-centre content system, a News-to-Centre join beside the revision's
  // own reference, or a generic location target would each be the parallel or
  // polymorphic shape the domain model refuses; a second Pakistan hierarchy or
  // a separate geography context would duplicate the Global Network's own.
  'CentreNews',
  'LocalNews',
  'CentreArticle',
  'GlobalNews',
  'NewsArticleCentre',
  'LocationTarget',
  'GeoTarget',
  'Location',
  'Geography',
  'PakistanCity',
  'PakistanRegion',

  // PHASE 14 — ONE Event aggregate whose occurrences are explicit rows, whose
  // place is a Global Centre and whose photographs are Media Galleries
  // (DOMAIN_MODEL.md §7.1). A generic event-target or attachment table would be
  // the polymorphic reference §6.2 refuses; a venue or location table would be
  // a second directory beside the Global Network's own; a recurrence rule would
  // replace the stored occurrence facts with a derivation; registration,
  // attendance, booking and ticketing are no V1 phase's; and an Event image or
  // asset table would duplicate Media and Storage.
  'EventTarget',
  'EventAttendee',
  'EventRegistration',
  'EventBooking',
  'EventTicket',
  'EventVenue',
  'Venue',
  'EventLocation',
  'EventRecurrence',
  'EventImage',
  'EventAsset',
  'CentreEventLink',
  'Attachment',

  // PHASE 15 — ONE ordered membership table with seven typed member columns
  // (DOMAIN_MODEL.md §7.1, §6.2). A generic member or target table would be the
  // polymorphic reference §6.2 refuses; a join table PER member type would
  // split the Collection's single mixed order into seven orders no constraint
  // could keep consistent; and a generic content-collection table would merge
  // Editorial's curated sets with Personalisation's private lists.
  'CollectionTarget',
  'CollectionMember',
  'CollectionEntry',
  'CollectionContent',
  'ContentCollection',
  'CollectionArticle',
  'CollectionWork',
  'CollectionVideo',
  'CollectionNews',

  // PHASE 18 — ONE canonical identity and SEPARATE layered works (DOMAIN_MODEL.md
  // §8). A second verse or chapter table beside `Ayah` and `Surah` would be a
  // second notion of the canonical citation that could drift from it; a generic
  // layer or work table with a type column would merge translations, tafsir and
  // recitations into one lifecycle; and an Ayah target or assignment table
  // would be the polymorphic reference §6.2 refuses.
  'Verse',
  'Chapter',
  'QuranVerse',
  'QuranChapter',
  'QuranWork',
  'QuranLayer',
  'QuranLayerText',
  'QuranContent',
  'QuranTarget',
  'AyahTarget',
  'QuranAssignment',

  // PHASE 19 — the chain is the source's EXACT TEXT and a grading is what a
  // named grader said (DOMAIN_MODEL.md §9). A narrator aggregate or chain-link
  // table would turn sourced text into platform-asserted biography; a grade
  // vocabulary would make the platform a grading authority; a bare number or
  // second record table would lose the source-qualified identity; and a Hadith
  // target or assignment table would be the polymorphic reference §6.2 refuses.
  'Narrator',
  'NarratorProfile',
  'HadithNarrator',
  'HadithChainLink',
  'HadithGrade',
  'HadithGradeScale',
  'HadithNumber',
  'HadithRecord',
  'HadithContent',
  'HadithLayer',
  'HadithTarget',
  'HadithAssignment',

  // PHASE 20 — a read is COUNTED, never recorded: a per-reader or per-request
  // read table would store the account, address or cookie the tally refuses to
  // hold. A ruling's topics are typed per revision (`FatwaRevisionTopic`), so a
  // second, unversioned topic table would let history and the published topics
  // disagree.
  'FatwaRead',
  'FatwaReadEvent',
  'FatwaReader',
  'FatwaTopic',

  // PHASE 21 — every saved or read target is a typed key to its owner's row
  // (DOMAIN_MODEL.md §14, §6.2). A generic target, content-reference or
  // activity table would be the polymorphic reference §6.2 refuses, and a
  // stored copy of a target's title would drift from its owner; a raw
  // newsletter token table would store what only a hash may hold.
  'PersonalTarget',
  'UserContentReference',
  'ContentReference',
  'SavedTarget',
  'SavedContent',
  'HistoryTarget',
  'UserHistory',
  'ActivityHistory',
  'UserActivity',
  'NotificationTarget',
  'NewsletterToken',

  // PHASE 22 — a Course's topics, teachers and lessons are typed keys, and a
  // person's learning is per Course and per lesson (DOMAIN_MODEL.md §13, §6.2).
  // A generic learning target, course reference or course item table would be
  // the polymorphic reference §6.2 refuses; a generic content or progress table
  // would merge the syllabus or a learner's progress into one untyped row; and
  // enrolment on a PATH is an explicit non-goal — a path is a public ordering
  // of Courses, and a person enrols on each Course.
  'LearningTarget',
  'LearningItem',
  'LearningContent',
  'LearningProgress',
  'CourseReference',
  'CourseTarget',
  'CourseItem',
  'CourseContent',
  'LessonContent',
  'LessonTarget',
  'PathEnrolment',
  'LearningPathEnrolment',

  // PHASE 24 — a conversation names its Course and its people, a report its
  // Conversation and, when a message is the target, that Message, all by typed
  // keys (DOMAIN_MODEL.md §15, §6.2). A generic conversation, message, report or
  // moderation target would be the polymorphic reference §6.2 refuses; a
  // thread, chat or member table beside `Conversation` and
  // `ConversationParticipant` would be a second notion of the same aggregate;
  // a ticket table would be a support desk outside the conversation it is; an
  // edit or revision table would make an immutable message rewritable;
  // presence, typing and socket state are Phase 25 transport and never a
  // table; and a strike or ban table would invent a policy nobody approved.
  'ConversationTarget',
  'MessageTarget',
  'MessagingTarget',
  'ReportTarget',
  'ModerationTarget',
  'Thread',
  'MessageThread',
  'ChatMessage',
  'ChatRoom',
  'ConversationMember',
  'SupportTicket',
  'Ticket',
  'MessageEdit',
  'MessageRevision',
  'Presence',
  'UserPresence',
  'TypingState',
  'TypingIndicator',
  'SocketSession',
  'RealtimeSession',
  'MessagingStrike',
  'MessagingBan',
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
  // Phase 9. Each slug is a UNIQUE key and a slug-history primary key; each
  // content language is a foreign key into `Language.code`.
  { table: 'Research', column: 'slug', characters: 120 },
  { table: 'ResearchSlugHistory', column: 'slug', characters: 120 },
  { table: 'ResearchPaper', column: 'slug', characters: 120 },
  { table: 'ResearchPaperSlugHistory', column: 'slug', characters: 120 },
  { table: 'Publication', column: 'slug', characters: 120 },
  { table: 'PublicationSlugHistory', column: 'slug', characters: 120 },
  { table: 'Magazine', column: 'slug', characters: 120 },
  { table: 'MagazineSlugHistory', column: 'slug', characters: 120 },
  { table: 'MagazineIssue', column: 'slug', characters: 120 },
  { table: 'MagazineIssueSlugHistory', column: 'slug', characters: 120 },
  { table: 'Encyclopedia', column: 'slug', characters: 120 },
  { table: 'EncyclopediaSlugHistory', column: 'slug', characters: 120 },
  { table: 'Research', column: 'languageCode', characters: 16 },
  { table: 'ResearchPaper', column: 'languageCode', characters: 16 },
  { table: 'Publication', column: 'languageCode', characters: 16 },
  { table: 'MagazineIssue', column: 'languageCode', characters: 16 },
  { table: 'Encyclopedia', column: 'languageCode', characters: 16 },
  // Phase 10. Slugs are unique keys and slug-history primary keys; the content
  // language is a foreign key into `Language.code`. The provider identifier is
  // VARCHAR under a binary collation and is asserted by `assertMediaFoundation`.
  { table: 'Video', column: 'slug', characters: 120 },
  { table: 'VideoSlugHistory', column: 'slug', characters: 120 },
  { table: 'Series', column: 'slug', characters: 120 },
  { table: 'SeriesSlugHistory', column: 'slug', characters: 120 },
  { table: 'Playlist', column: 'slug', characters: 120 },
  { table: 'PlaylistSlugHistory', column: 'slug', characters: 120 },
  { table: 'Video', column: 'languageCode', characters: 16 },
  // Phase 11, by the same rules.
  { table: 'AudioTrack', column: 'slug', characters: 120 },
  { table: 'AudioTrackSlugHistory', column: 'slug', characters: 120 },
  { table: 'AudioSeries', column: 'slug', characters: 120 },
  { table: 'AudioSeriesSlugHistory', column: 'slug', characters: 120 },
  { table: 'AudioTrack', column: 'languageCode', characters: 16 },
  // Phase 12, by the same rules.
  { table: 'Gallery', column: 'slug', characters: 120 },
  { table: 'GallerySlugHistory', column: 'slug', characters: 120 },
  // Phase 13, by the Article's rules: each slug is a unique key and a slug-history
  // primary key; each translation language is a foreign key into `Language.code`.
  { table: 'NewsArticle', column: 'slug', characters: 120 },
  { table: 'NewsArticleSlugHistory', column: 'slug', characters: 120 },
  { table: 'PressRelease', column: 'slug', characters: 120 },
  { table: 'PressReleaseSlugHistory', column: 'slug', characters: 120 },
  { table: 'Statement', column: 'slug', characters: 120 },
  { table: 'StatementSlugHistory', column: 'slug', characters: 120 },
  { table: 'MediaCoverage', column: 'slug', characters: 120 },
  { table: 'MediaCoverageSlugHistory', column: 'slug', characters: 120 },
  { table: 'NewsArticleRevisionTranslation', column: 'languageCode', characters: 16 },
  { table: 'PressReleaseRevisionTranslation', column: 'languageCode', characters: 16 },
  { table: 'StatementRevisionTranslation', column: 'languageCode', characters: 16 },
  { table: 'MediaCoverageRevisionTranslation', column: 'languageCode', characters: 16 },
  { table: 'StatementRevisionTranslation', column: 'issuer', characters: 200 },
  { table: 'MediaCoverageRevision', column: 'outletName', characters: 200 },
  { table: 'MediaCoverageRevision', column: 'sourceUrl', characters: 2048 },
  // Phase 16. Slugs are unique keys and slug-history primary keys; names, words
  // and contacts are bounded exactly as the Global contract bounds them.
  { table: 'Country', column: 'code', characters: 2 },
  { table: 'Country', column: 'slug', characters: 120 },
  { table: 'CountrySlugHistory', column: 'slug', characters: 120 },
  { table: 'Region', column: 'slug', characters: 120 },
  { table: 'RegionSlugHistory', column: 'slug', characters: 120 },
  { table: 'City', column: 'slug', characters: 120 },
  { table: 'CitySlugHistory', column: 'slug', characters: 120 },
  { table: 'Centre', column: 'slug', characters: 120 },
  { table: 'CentreSlugHistory', column: 'slug', characters: 120 },
  { table: 'CountryLabel', column: 'name', characters: 160 },
  { table: 'RegionLabel', column: 'name', characters: 160 },
  { table: 'CityLabel', column: 'name', characters: 160 },
  { table: 'CentreLabel', column: 'name', characters: 200 },
  { table: 'CentreLabel', column: 'description', characters: 2000 },
  { table: 'CentreLabel', column: 'address', characters: 500 },
  { table: 'CentreContact', column: 'value', characters: 320 },
  // Phase 14, by the Article's rules; the zone is an IANA name, sized as the
  // editorial schedule's own zone column is.
  { table: 'Event', column: 'slug', characters: 120 },
  { table: 'EventSlugHistory', column: 'slug', characters: 120 },
  { table: 'EventRevision', column: 'slug', characters: 120 },
  { table: 'EventRevision', column: 'timezone', characters: 64 },
  { table: 'Event', column: 'scheduledTimezone', characters: 64 },
  { table: 'EventRevisionTranslation', column: 'languageCode', characters: 16 },
  // Phase 15, by the Article's rules; every member column holds an owner's
  // 36-character identifier.
  { table: 'Collection', column: 'slug', characters: 120 },
  { table: 'CollectionSlugHistory', column: 'slug', characters: 120 },
  { table: 'CollectionRevision', column: 'slug', characters: 120 },
  { table: 'Collection', column: 'scheduledTimezone', characters: 64 },
  { table: 'CollectionRevisionTranslation', column: 'languageCode', characters: 16 },
  ...[
    'articleId',
    'newsArticleId',
    'pressReleaseId',
    'statementId',
    'mediaCoverageId',
    'workId',
    'videoId',
  ].map((column) => ({ table: 'CollectionItem', column, characters: 36 })),
  // Phase 18. Each layered work's slug is a unique key; each content language a
  // foreign key into `Language.code`; a source code a unique key. Canonical text
  // is NVARCHAR(4000) in all three places it lives, because exact comparison
  // casts it to VARBINARY(8000): a wider column could hold text the comparison
  // would silently truncate.
  ...[
    'QuranTranslation',
    'QuranTransliteration',
    'QuranTafsir',
    'QuranRecitation',
    'QuranTajweedRule',
  ].map((table) => ({ table, column: 'slug', characters: 120 })),
  ...[
    'QuranTranslation',
    'QuranTransliteration',
    'QuranTafsir',
    'QuranTajweedRuleText',
  ].map((table) => ({ table, column: 'languageCode', characters: 16 })),
  { table: 'QuranSource', column: 'code', characters: 64 },
  { table: 'SurahName', column: 'locale', characters: 8 },
  ...['QuranSourceAyah', 'Ayah', 'QuranAyahRevision'].map((table) => ({
    table,
    column: 'text',
    characters: 4000,
  })),
  // Phase 19. Each public address is a unique key; a source's own reference is
  // a byte-compared key no longer than the comparison's VARBINARY(128); every
  // content language a foreign key into `Language.code`; a grader the key its
  // gradings are unique by; a display-name locale one of three.
  ...[
    'HadithCollection',
    'HadithBook',
    'HadithChapter',
    'HadithCommentary',
    'HadithScience',
  ].map((table) => ({ table, column: 'slug', characters: 120 })),
  ...[
    ['Hadith', 'sourceReference'],
    ['HadithRevision', 'sourceReference'],
    ['HadithBook', 'reference'],
    ['HadithChapter', 'reference'],
    ['HadithSourceSystem', 'code'],
    ['HadithEdition', 'code'],
    ['HadithConflict', 'facets'],
  ].map(([table, column]) => ({
    table: table ?? '',
    column: column ?? '',
    characters: 64,
  })),
  ...[
    ['Hadith', 'textLanguage'],
    ['Hadith', 'chainLanguage'],
    ['HadithGrading', 'labelLanguage'],
    ['HadithTranslation', 'languageCode'],
    ['HadithCommentary', 'languageCode'],
    ['HadithScienceText', 'languageCode'],
  ].map(([table, column]) => ({
    table: table ?? '',
    column: column ?? '',
    characters: 16,
  })),
  { table: 'HadithGrading', column: 'grader', characters: 200 },
  ...['HadithCollectionName', 'HadithBookName', 'HadithChapterName'].map((table) => ({
    table,
    column: 'locale',
    characters: 8,
  })),
  // Phase 20. Each public address a unique key no longer than its trigger's
  // VARBINARY(240) comparison; the private question bounded; a revision's
  // language a foreign key into `Language.code`; a display-name locale one of
  // three.
  ...['Fatwa', 'FatwaCategory'].map((table) => ({
    table,
    column: 'slug',
    characters: 120,
  })),
  { table: 'FatwaQuestion', column: 'body', characters: 4000 },
  { table: 'FatwaRevision', column: 'publicQuestion', characters: 4000 },
  { table: 'FatwaRevision', column: 'language', characters: 16 },
  { table: 'FatwaCategoryName', column: 'locale', characters: 8 },
  // Phase 21. Every owner and every target a 36-character key matching the row
  // it names; a note and a collection bounded; a destination short enough to be
  // a path and never a document; a newsletter digest and each token hash exactly
  // a SHA-256 hex string, and an address no longer than User.email.
  ...[
    'PersonalisationProfile',
    'SavedItem',
    'PrivateCollection',
    'ReadingHistory',
    'WatchHistory',
    'QuranReadingProgress',
    'NotificationPreference',
    'Notification',
  ].map((table) => ({ table, column: 'userId', characters: 36 })),
  ...['articleId', 'workId', 'videoId', 'hadithCitationId'].map((column) => ({
    table: 'SavedItem',
    column,
    characters: 36,
  })),
  { table: 'Note', column: 'body', characters: 2000 },
  { table: 'PrivateCollection', column: 'title', characters: 120 },
  { table: 'PrivateCollection', column: 'description', characters: 500 },
  { table: 'Notification', column: 'destination', characters: 300 },
  { table: 'Notification', column: 'idempotencyKey', characters: 200 },
  { table: 'NewsletterSubscriber', column: 'email', characters: 320 },
  ...['emailDigest', 'confirmTokenHash', 'unsubscribeTokenHash'].map((column) => ({
    table: 'NewsletterSubscriber',
    column,
    characters: 64,
  })),
  { table: 'NewsletterSubscriber', column: 'locale', characters: 8 },
  { table: 'NewsletterConsentEvent', column: 'noticeVersion', characters: 64 },
  // Phase 22. Each slug a unique key and a slug-history primary key, as every
  // earlier catalogue's; a Course's content language a foreign key into
  // `Language.code`; every owner, Course, lesson, topic and teacher a
  // 36-character key matching the row it names; words bounded as the Learning
  // contract bounds them.
  ...['Course', 'CourseSlugHistory', 'LearningPath', 'LearningPathSlugHistory'].map(
    (table) => ({ table, column: 'slug', characters: 120 }),
  ),
  { table: 'Course', column: 'languageCode', characters: 16 },
  ...['CourseLabel', 'CourseModuleLabel', 'LessonLabel', 'LearningPathLabel'].flatMap(
    (table) => [
      { table, column: 'locale', characters: 8 },
      { table, column: 'title', characters: 240 },
      { table, column: 'summary', characters: 1000 },
    ],
  ),
  ...['Enrolment', 'LessonProgress', 'TrialClassRequest'].flatMap((table) => [
    { table, column: 'userId', characters: 36 },
    { table, column: 'courseId', characters: 36 },
  ]),
  { table: 'Lesson', column: 'courseId', characters: 36 },
  { table: 'Lesson', column: 'moduleId', characters: 36 },
  { table: 'LessonProgress', column: 'lessonId', characters: 36 },
  { table: 'CourseTopic', column: 'topicId', characters: 36 },
  { table: 'CourseTeacher', column: 'personId', characters: 36 },
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
  // Phase 10. Filtered because a Video in no Series has no episode position,
  // and two standalone Videos are not duplicates of each other.
  {
    table: 'Video',
    index: 'Video_seriesId_seriesPosition_key',
    why: 'two episodes of one Series could claim the same position',
  },
  // Phase 11. Filtered because a standalone track has no position and a track
  // with no file yet names no Asset — neither is a duplicate of another.
  {
    table: 'AudioTrack',
    index: 'AudioTrack_seriesId_seriesPosition_key',
    why: 'two tracks of one AudioSeries could claim the same place',
  },
  {
    table: 'AudioTrack',
    index: 'AudioTrack_assetId_key',
    why: 'one audio file could be served as two different tracks',
  },
  // Phase 12. Filtered because a Photo with no image yet names no Asset.
  {
    table: 'Photo',
    index: 'Photo_assetId_key',
    why: 'one image could be served as two different photographs',
  },
  // Phase 9. Filtered because an issue without a printed volume and number is
  // ordinary, and two such issues are not duplicates of each other.
  {
    table: 'MagazineIssue',
    index: 'MagazineIssue_magazineId_volume_issueNumber_key',
    why: 'two issues of one Magazine could claim the same volume and number',
  },
  // Phase 15. Filtered because each place names ONE of seven member types, so
  // every other type's column is NULL there — and an unfiltered index would
  // treat those NULLs as one repeated value and refuse a second member.
  ...[
    'article',
    'newsArticle',
    'pressRelease',
    'statement',
    'mediaCoverage',
    'work',
    'video',
  ].map((member) => ({
    table: 'CollectionItem',
    index: `CollectionItem_${member}_key`,
    why: `one ${member} could be a member of one Collection revision twice`,
  })),
  // Phase 18. Filtered because a segment with no audio yet names no Asset.
  {
    table: 'QuranRecitationSegment',
    index: 'QuranRecitationSegment_assetId_key',
    why: 'one audio file could be served as two different recitation segments',
  },
  // Phase 21. Filtered because each saved item and each history row names ONE
  // of its typed targets, so every other target column is NULL there — and an
  // unfiltered index would treat those NULLs as one repeated value and refuse
  // a person's second saved item. A token hash is filtered because every ended
  // subscription holds none.
  ...['article', 'work', 'video', 'ayah', 'hadith'].map((target) => ({
    table: 'SavedItem',
    index: `SavedItem_${target}_key`,
    why: `one account could save the same ${target} twice`,
  })),
  ...['article', 'work', 'ayah', 'hadith'].map((target) => ({
    table: 'ReadingHistory',
    index: `ReadingHistory_${target}_key`,
    why: `one account could hold two history rows for the same ${target}`,
  })),
  {
    table: 'NewsletterSubscriber',
    index: 'NewsletterSubscriber_confirm_key',
    why: 'one confirmation link could resolve to two subscriptions',
  },
  {
    table: 'NewsletterSubscriber',
    index: 'NewsletterSubscriber_unsubscribe_key',
    why: 'one unsubscribe link could resolve to two subscriptions',
  },
  // Phase 22 adds NO filtered index: every Learning key is total — a lesson
  // always has its module, a progress row its enrolment, a request its Course —
  // so no NULL needs setting aside, and `assertLearningFoundation` proves every
  // Learning unique index is unfiltered.
  // Phase 23 adds two, and each is the race itself: the filter is what lets an
  // ended scope and a cancelled Booking stay as history beside the live one.
  {
    table: 'CourseTeachingAssignment',
    index: 'CourseTeachingAssignment_current_key',
    why: 'two operators scoping one teacher to one Course at once both succeed',
  },
  {
    table: 'Booking',
    index: 'Booking_slot_key',
    why: 'two confirmations of one window both commit',
  },
  // Phase 24 adds eight. Storage's release digest is filtered because an Asset
  // stored without a token names no digest; the rest are the races themselves,
  // and each filter is what lets history — a support conversation that was
  // resolved, a claim that was released, an unattached upload, a resolved
  // report — stay beside the live row.
  {
    table: 'Asset',
    index: 'Asset_releaseDigest_key',
    why: 'one release token could release two assets',
  },
  {
    table: 'Conversation',
    index: 'Conversation_direct_key',
    why: 'two concurrent openings between two people on one Course both create a conversation',
  },
  {
    table: 'Conversation',
    index: 'Conversation_support_key',
    why: 'one person could hold two open support conversations at once',
  },
  {
    table: 'ConversationParticipant',
    index: 'ConversationParticipant_claim_key',
    why: 'two support staff could claim one conversation at once',
  },
  {
    table: 'ConversationParticipant',
    index: 'ConversationParticipant_role_key',
    why: 'a conversation could hold two teachers, two learners or two requesters',
  },
  {
    table: 'MessageAttachment',
    index: 'MessageAttachment_assetId_key',
    why: 'one stored asset could be attached twice',
  },
  {
    table: 'MessageAttachment',
    index: 'MessageAttachment_position_key',
    why: 'two attachments could take one place in a message',
  },
  {
    table: 'MessagingReport',
    index: 'MessagingReport_open_key',
    why: 'one person could hold two open reports of the same target',
  },
  // Phase 26 adds two, and each is the race itself: the filter is what lets a
  // decided or withdrawn application and a closed Membership stay as history
  // beside the open or active one.
  {
    table: 'MembershipApplication',
    index: 'MembershipApplication_open_key',
    why: 'two concurrent submissions by one account for one type both commit',
  },
  {
    table: 'Membership',
    index: 'Membership_active_key',
    why: 'two concurrent approvals for one account and type both create an active Membership',
  },
  // Phase 27 adds three, each scoping one provider reference by provider,
  // environment and account: the filter is what lets every donation without a
  // checkout or payment yet, and every refund without a provider answer yet,
  // coexist on NULL.
  {
    table: 'Donation',
    index: 'Donation_checkout_key',
    why: 'two donations could record the same provider checkout and both apply its payment',
  },
  {
    table: 'Donation',
    index: 'Donation_payment_key',
    why: 'two donations could claim the same provider payment and both count it as captured',
  },
  {
    table: 'DonationRefund',
    index: 'DonationRefund_reference_key',
    why: 'two refunds could settle against the same provider refund and both release money',
  },
  // Phase 29 adds three: the filter is what lets finished runs, disabled
  // mappings and refused or rolled-back entries stay as history beside the one
  // that is live.
  {
    table: 'MigrationRun',
    index: 'MigrationRun_open_key',
    why: 'two runners could open two runs of one source and fork its accounting',
  },
  {
    table: 'MigrationLegacyMapping',
    index: 'MigrationLegacyMapping_active_key',
    why: 'one legacy URL could redirect to two canonical addresses at once',
  },
  {
    table: 'MigrationManifestEntry',
    index: 'MigrationManifestEntry_live_key',
    why: 'one staged revision could be published twice through two manifests and create two targets',
  },
];

/** The sixteen Phase-22 tables, in the migration's order. */
const LEARNING_TABLES = MIGRATION_EXPECTATIONS['20261006000000_phase22_learning'] ?? [];

/**
 * Each Learning trigger, the table it guards and the refusal numbers its body
 * raises: none for the two slug reservations, which refuse nothing of their
 * own; 51270 a published Course with an incomplete syllabus and 51273 one
 * leaving publication while a published path holds it; 51271 a frozen
 * syllabus; 51272 a published path holding an unpublished Course and 51274 one
 * with no Course; 51275 an enrolment, 51277 progress and 51276 a trial request
 * on a Course that does not take one.
 */
const LEARNING_TRIGGER_NUMBERS: Readonly<Record<string, readonly [string, string]>> = {
  LearningReserveCourseSlug: ['Course', ''],
  LearningReservePathSlug: ['LearningPath', ''],
  LearningCourseIntegrity: ['Course', '51270+51273'],
  LearningModuleFrozen: ['CourseModule', '51271'],
  LearningModuleLabelFrozen: ['CourseModuleLabel', '51271'],
  LearningLessonFrozen: ['Lesson', '51271'],
  LearningLessonLabelFrozen: ['LessonLabel', '51271'],
  LearningPathIntegrity: ['LearningPath', '51272+51274'],
  LearningPathPlaces: ['LearningPathCourse', '51272+51274'],
  LearningEnrolmentOpen: ['Enrolment', '51275'],
  LearningProgressOpen: ['LessonProgress', '51277'],
  LearningTrialOpen: ['TrialClassRequest', '51276'],
};

/** The seven Phase-23 tables, in the migration's order. */
const CLASSES_TABLES =
  MIGRATION_EXPECTATIONS['20261007000000_phase23_teacher_live_classes'] ?? [];

/**
 * Each live-class trigger, the table it guards and the refusal numbers its
 * body raises: 51280 the immutable activation; 51281 a window, a scheduled
 * session or a Booking while not activated; 51282 a scope that is not typed and
 * live, or rewritten; 51283 overlapping or rewritten windows and 51284 one
 * offered without live `teaching.perform`; 51285 a session off a published live
 * Course or a current scope, 51286 a terminal session changed and 51287
 * overlapping sessions of one teacher; 51288 a Booking that does not fit, or
 * rewritten; 51289 attendance that is not eligible, or re-keyed; 51292 an
 * intent reopened, or re-keyed.
 */
const CLASSES_TRIGGER_NUMBERS: Readonly<Record<string, readonly [string, string]>> = {
  LearningLiveActivationImmutable: ['LiveLearningActivation', '51280'],
  LearningScopeIntegrity: ['CourseTeachingAssignment', '51282'],
  LearningAvailabilityIntegrity: ['Availability', '51281+51283+51284'],
  LearningSessionIntegrity: ['ClassSession', '51281+51285+51286+51287'],
  LearningBookingIntegrity: ['Booking', '51281+51288'],
  LearningAttendanceIntegrity: ['Attendance', '51289'],
  LearningIntentIntegrity: ['ClassCommunicationIntent', '51292'],
};

/** The nine Phase-24 tables, in the migration's order. */
const MESSAGING_TABLES = MIGRATION_EXPECTATIONS['20261008000000_phase24_messaging'] ?? [];

/**
 * Each Messaging trigger, the table it guards and the refusal numbers its body
 * raises: 51300 the immutable activation; 51301 a participant that does not
 * fit, rejoins, is re-keyed or leaves outside disposal; 51302 a conversation
 * not activated, rewritten, reopened, gone backwards or removed outside
 * disposal; 51303 a message to a conversation that is not open or not
 * activated, from someone who is not a current participant or off its
 * allocated sequence, 51304 one rewritten or returned to view and 51305 one
 * removed outside disposal; 51306 an attachment off its lifecycle or its
 * uploader; 51307 a read position backwards or past the last message; 51308 a
 * report by a non-participant, beyond its conversation, rewritten or reopened;
 * 51309 a decision rewritten, removed, on a closed report or withholding
 * nothing.
 */
const MESSAGING_TRIGGER_NUMBERS: Readonly<Record<string, readonly [string, string]>> = {
  MessagingActivationImmutable: ['MessagingActivation', '51300'],
  MessagingConversationIntegrity: ['Conversation', '51302'],
  MessagingParticipantIntegrity: ['ConversationParticipant', '51301'],
  MessagingMessageIntegrity: ['Message', '51303+51304+51305'],
  MessagingAttachmentIntegrity: ['MessageAttachment', '51306'],
  MessagingReadStateIntegrity: ['MessageReadState', '51307'],
  MessagingReportIntegrity: ['MessagingReport', '51308'],
  MessagingDecisionIntegrity: ['MessagingModerationDecision', '51309'],
};

/** The five Phase-26 tables, in the migration's order. */
const MEMBERSHIP_TABLES =
  MIGRATION_EXPECTATIONS['20261009000000_phase26_membership'] ?? [];

/**
 * Each Membership trigger, the table it guards and the refusal numbers its body
 * raises: 51320 a type created other than as a draft, re-keyed or returned to
 * draft, and 51321 one published without its primary locale's words; 51320 a
 * translation re-keyed; 51322 an application off its lifecycle or changed once
 * final, and 51323 one on a type that is not published or while its account
 * holds an active Membership of it; 51324 a Membership not made active from its
 * own approved application on a published type, re-keyed or reopened; 51325 an
 * intent reopened or re-keyed.
 */
const MEMBERSHIP_TRIGGER_NUMBERS: Readonly<Record<string, readonly [string, string]>> = {
  MembershipTypeIntegrity: ['MembershipType', '51320+51321'],
  MembershipTypeTranslationIntegrity: ['MembershipTypeTranslation', '51320'],
  MembershipApplicationIntegrity: ['MembershipApplication', '51322+51323'],
  MembershipIntegrity: ['Membership', '51324'],
  MembershipIntentIntegrity: ['MembershipCommunicationIntent', '51325'],
};

/** The eight Phase-27 tables, in the migration's order. */
const DONATIONS_TABLES = MIGRATION_EXPECTATIONS['20261010000000_phase27_donations'] ?? [];

/**
 * Each Donations trigger, the table it guards and the refusal numbers its body
 * raises: 51340 a campaign created other than as a draft, re-keyed, returned to
 * draft or moved off one version at a time, its words or policy re-keyed, and
 * 51341 a campaign published — or left published — without its primary
 * locale's words or a currency; 51342 the immutable activation; 51347 a
 * donation created other than pending and uncaptured, 51343 one for a campaign
 * that is not published, 51344 one the current policy refuses, 51345 one
 * outside the activated scope and 51346 a linked one for an account that is not
 * active; 51348 a donation's identity, request or expected money rewritten,
 * 51349 its facts regressed, moved without a version or its reservation not
 * the sum of its live refunds, and 51350 a donor link changed other than
 * released for a closed account; 51351 an event re-keyed or completed twice;
 * 51358 a refund created other than requested, 51352 one of an uncaptured or
 * charged-back donation, 51353 one in another currency or scope, 51354 one
 * without live refund authority and 51355 refunds beyond the captured amount;
 * 51356 a refund moved backwards or re-keyed; 51357 an intent reopened or
 * re-keyed.
 */
const DONATIONS_TRIGGER_NUMBERS: Readonly<Record<string, readonly [string, string]>> = {
  DonationCampaignIntegrity: ['DonationCampaign', '51340+51341'],
  DonationCampaignTranslationIntegrity: ['DonationCampaignTranslation', '51340+51341'],
  DonationCampaignCurrencyIntegrity: ['DonationCampaignCurrency', '51340+51341'],
  DonationActivationImmutable: ['DonationActivation', '51342'],
  DonationAdmission: ['Donation', '51343+51344+51345+51346+51347'],
  DonationIntegrity: ['Donation', '51348+51349+51350'],
  DonationProviderEventIntegrity: ['DonationProviderEvent', '51351'],
  DonationRefundAdmission: ['DonationRefund', '51352+51353+51354+51355+51358'],
  DonationRefundIntegrity: ['DonationRefund', '51356'],
  DonationIntentIntegrity: ['DonationCommunicationIntent', '51357'],
};

/** The eighteen Phase-29 tables, in the migration's order. */
const MIGRATION_TABLES =
  MIGRATION_EXPECTATIONS['20261011000000_phase29_migration_provenance'] ?? [];

/**
 * Each Migration & Provenance trigger, the table it guards and the refusal
 * numbers its body raises: 51370 a source re-keyed, re-kinded or moved off one
 * version at a time; 51371 a host changed or removed, or a fixture host outside
 * `*.fixture.invalid`; 51372 a raw snapshot rewritten or deleted and 51373 one
 * created without its body; 51374 a staged revision created other than pending
 * at version one from its snapshot's checksum, rewritten, or reviewed out of
 * order; 51375 a run re-identified or a finished run changed; 51376 a record
 * re-identified; 51377 a run item re-identified, for another source's record,
 * or moved out of a terminal outcome other than an error's retry; 51378 a
 * manifest published or rolled back without live publication authority, or
 * moved out of order; 51379 an entry for an unapproved revision, outside a
 * draft or outside its manifest's phase; 51380 a legacy mapping re-targeted,
 * or naming an entry of an unrelated record; 51374 and 51380 a revision's
 * category or link changed, removed, or naming another source's mapping;
 * 51381 a promotion approved without live publication authority, moved out of
 * order or carrying an unpublished entry; 51382 an acquisition re-identified;
 * 51383 an error reopened or a duplicate pair re-identified; 51384 a topic
 * mapping re-keyed.
 */
const MIGRATION_TRIGGER_NUMBERS: Readonly<Record<string, readonly [string, string]>> = {
  MigrationSourceIntegrity: ['MigrationSource', '51370'],
  MigrationSourceHostIntegrity: ['MigrationSourceHost', '51371'],
  MigrationRunIntegrity: ['MigrationRun', '51375'],
  MigrationRecordIntegrity: ['MigrationRecord', '51376'],
  MigrationRunItemIntegrity: ['MigrationRunItem', '51377'],
  MigrationRawSnapshotIntegrity: ['MigrationRawSnapshot', '51372+51373'],
  MigrationStagedRecordIntegrity: ['MigrationStagedRecord', '51374'],
  MigrationTopicMappingIntegrity: ['MigrationTopicMapping', '51384'],
  MigrationErrorIntegrity: ['MigrationError', '51383'],
  MigrationDuplicateCandidateIntegrity: ['MigrationDuplicateCandidate', '51383'],
  MigrationAssetProvenanceIntegrity: ['MigrationAssetProvenance', '51382'],
  MigrationLegacyMappingIntegrity: ['MigrationLegacyMapping', '51380'],
  MigrationStagedCategoryIntegrity: ['MigrationStagedCategory', '51374'],
  MigrationStagedLinkIntegrity: ['MigrationStagedLink', '51380'],
  MigrationPublishManifestIntegrity: ['MigrationPublishManifest', '51378'],
  MigrationManifestEntryIntegrity: ['MigrationManifestEntry', '51379'],
  MigrationPromotionIntegrity: ['MigrationPromotion', '51381'],
  MigrationPromotionEntryIntegrity: ['MigrationPromotionEntry', '51381'],
};

/** The fifteen Phase-21 tables, in the migration's order. */
const PERSONALISATION_TABLES =
  MIGRATION_EXPECTATIONS['20261005000000_phase21_personalisation_notifications'] ?? [];

/** The ten Phase-20 tables, in the migration's order. */
const FATWA_TABLES = MIGRATION_EXPECTATIONS['20261004000000_phase20_fatwa'] ?? [];

/**
 * Each Fatwa trigger, the table it guards and the refusal numbers its body
 * raises: 51230 an immutable activation, 51240 a category that keeps its slug,
 * moves one version at a time and is never deleted, 51241 a published ruling
 * that keeps its address, 51242 immutable history, 51248 a ruling that changes
 * only through its workflow.
 */
const FATWA_TRIGGER_NUMBERS: Readonly<Record<string, readonly [string, string]>> = {
  FatwaActivationImmutable: ['FatwaActivation', '51230'],
  FatwaCategoryIdentity: ['FatwaCategory', '51240'],
  FatwaRevisionImmutable: ['FatwaRevision', '51242'],
  FatwaRevisionTopicImmutable: ['FatwaRevisionTopic', '51242'],
  FatwaPublicationImmutable: ['FatwaPublication', '51242'],
  FatwaReviewDecisionImmutable: ['FatwaReviewDecision', '51242'],
  FatwaRevisionTopicAppend: ['FatwaRevisionTopic', '51242'],
  FatwaIntegrity: ['Fatwa', '51241+51242+51248'],
};

/**
 * THE workflow write path, and the refusals each procedure raises: 51231 an
 * inactive service, 51232 an inactive asker, 51233 a permission not held now,
 * 51234 a question not assigned to the actor, 51235 publication authority
 * (permission and `fatwa-publication` step-up) not held now, 51236 not found,
 * 51237 stale, 51238 an illegal transition, 51239 a bad assignee, 51240 an
 * unavailable category, 51241 a frozen slug, 51243 self-publication, 51244 the
 * wrong revision, 51245 the correction-reason rule, 51246 an account not
 * closed, 51247 invalid content. Recording a read raises nothing of its own: it
 * counts only a ruling public now, and silently counts nothing otherwise.
 */
const FATWA_PROCEDURE_NUMBERS: Readonly<Record<string, string>> = {
  FatwaAssertPermission: '51233',
  FatwaAssertPublicationAuthority: '51235',
  FatwaSubmitQuestion: '51231+51232+51247',
  FatwaTriageQuestion: '51236+51237+51238+51240',
  FatwaAssignQuestion: '51236+51237+51238+51239',
  FatwaDeclineQuestion: '51236+51237+51238',
  FatwaSaveDraft: '51234+51236+51237+51238+51240+51241+51245+51247',
  FatwaSubmitForReview: '51234+51236+51237+51238+51244',
  FatwaReturnForRevision: '51236+51237+51238+51244+51247',
  FatwaPublishRevision: '51231+51236+51237+51238+51240+51243+51244',
  FatwaWithdraw: '51236+51237+51238+51247',
  FatwaDisposeQuestions: '51246+51247',
  FatwaRecordRead: '',
};

/** The twenty-four Phase-19 tables, in the migration's order. */
const HADITH_TABLES = MIGRATION_EXPECTATIONS['20261003000000_phase19_hadith'] ?? [];

/**
 * Each Hadith trigger, the table it guards and the refusal numbers its body
 * raises: 51200 an immutable registered source, 51201 immutable canonical
 * structure, 51202 a canonical change that is a recorded, one-step version,
 * 51203 immutable history and evidence, 51204 no mapped citation under
 * conflict evidence, 51205 no fixture record in an approved collection, 51206
 * activation integrity, 51207 a published work keeps its text, 51208 no
 * approved record in a collection activated as fixture.
 */
const HADITH_TRIGGER_NUMBERS: Readonly<Record<string, readonly [string, string]>> = {
  HadithSourceSystemImmutable: ['HadithSourceSystem', '51200'],
  HadithEditionImmutable: ['HadithEdition', '51200'],
  HadithCollectionImmutable: ['HadithCollection', '51201'],
  HadithBookImmutable: ['HadithBook', '51201'],
  HadithChapterImmutable: ['HadithChapter', '51201'],
  HadithCanonicalChange: ['Hadith', '51201+51202'],
  HadithCitationChange: ['HadithCitation', '51201+51202'],
  HadithRevisionImmutable: ['HadithRevision', '51203'],
  HadithGradingImmutable: ['HadithGrading', '51203'],
  HadithVerificationImmutable: ['HadithVerification', '51203'],
  HadithCitationRevisionImmutable: ['HadithCitationRevision', '51203'],
  HadithConflictImmutable: ['HadithConflict', '51203'],
  HadithCitationIntegrity: ['HadithCitation', '51204+51205+51208'],
  HadithActivationIntegrity: ['HadithActivation', '51205+51206+51208'],
  HadithCommentaryPublishedText: ['HadithCommentary', '51207'],
  HadithSciencePublishedText: ['HadithScience', '51207'],
  HadithCommentaryEntryKept: ['HadithCommentaryEntry', '51207'],
  HadithScienceTextKept: ['HadithScienceText', '51207'],
};

/**
 * THE canonical write path, and the refusals each procedure raises: 51210 the
 * live authority, 51211 a registered edition, 51212 an existing record or
 * book, 51213 the expected version, 51214 a mapped record keeps its citation,
 * 51215 structure of the record's own edition, 51216 evidence and reason,
 * 51217 well-formed gradings, 51218 a change that changes something, 51219 a
 * verified candidate, 51220 a declared candidate, 51204 no conflict evidence.
 * Collection creation and conflict detection raise nothing of their own: the
 * one relies on the authority check and its CHECKs, the other only records.
 */
const HADITH_PROCEDURE_NUMBERS: Readonly<Record<string, string>> = {
  HadithAssertCanonicalAuthority: '51210',
  HadithDetectConflicts: '',
  HadithCreateCollection: '',
  HadithCreateBook: '51211',
  HadithCreateChapter: '51212',
  HadithWriteRecord: '51211+51212+51213+51214+51215+51216+51217+51218',
  HadithVerifyRecord: '51212+51213+51216+51218',
  HadithSetCitation: '51204+51213+51216+51218+51219+51220',
};

/** The twenty-three Phase-18 tables, in the migration's order. */
const QURAN_TABLES = MIGRATION_EXPECTATIONS['20261002000000_phase18_quran'] ?? [];

/**
 * Each Quran trigger, the table it guards and the refusal numbers its body
 * raises: 51180 an immutable registered source, 51181 immutable canonical
 * structure, 51182 a canonical change that is a recorded, one-step correction,
 * 51183 immutable history and evidence, 51184 a frozen active corpus, 51185
 * activation integrity, 51186 and 51187 no overlapping tafsir entry or audio
 * segment, 51188 a published recitation keeps audio, 51189 a published work
 * keeps text.
 */
const QURAN_TRIGGER_NUMBERS: Readonly<Record<string, readonly [string, string]>> = {
  QuranSourceImmutable: ['QuranSource', '51180'],
  QuranSourceSurahImmutable: ['QuranSourceSurah', '51180'],
  QuranSourceAyahImmutable: ['QuranSourceAyah', '51180'],
  QuranSourceAyahWithinSurah: ['QuranSourceAyah', '51180'],
  JuzImmutable: ['Juz', '51181'],
  SurahImmutable: ['Surah', '51181'],
  AyahCanonicalChange: ['Ayah', '51181+51182'],
  QuranAyahRevisionImmutable: ['QuranAyahRevision', '51183'],
  QuranVerificationRunImmutable: ['QuranVerificationRun', '51183'],
  QuranCorpusFrozen: ['Ayah', '51184'],
  QuranSurahFrozen: ['Surah', '51184'],
  QuranJuzFrozen: ['Juz', '51184'],
  QuranActivationIntegrity: ['QuranActivation', '51185'],
  QuranTafsirTextNoOverlap: ['QuranTafsirText', '51186'],
  QuranRecitationSegmentNoOverlap: ['QuranRecitationSegment', '51187'],
  QuranRecitationPublishedAudio: ['QuranRecitation', '51188'],
  QuranRecitationSegmentKeepsAudio: ['QuranRecitationSegment', '51188'],
  QuranTranslationPublishedText: ['QuranTranslation', '51189'],
  QuranTransliterationPublishedText: ['QuranTransliteration', '51189'],
  QuranTafsirPublishedText: ['QuranTafsir', '51189'],
  QuranTajweedPublishedText: ['QuranTajweedRule', '51189'],
  QuranTranslationTextKept: ['QuranTranslationText', '51189'],
  QuranTransliterationTextKept: ['QuranTransliterationText', '51189'],
  QuranTafsirTextKept: ['QuranTafsirText', '51189'],
  QuranTajweedTextKept: ['QuranTajweedRuleText', '51189'],
};

/**
 * THE canonical write path, and the refusals each procedure raises: 51190 the
 * live authority, 51191 one corpus, 51192 a registered source, 51193 an exact
 * match, 51194 a complete source, 51195–51199 a correction's existence,
 * version, source, authority class and substance. A failure record raises
 * nothing of its own: it can record a failure and never a pass.
 */
const QURAN_PROCEDURE_NUMBERS: Readonly<Record<string, string>> = {
  QuranAssertCanonicalAuthority: '51190',
  QuranAcceptCorpus: '51191+51192+51193+51194',
  QuranCorrectAyah: '51193+51195+51196+51197+51198+51199',
  QuranRecordVerificationFailure: '',
};

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
  ...[
    'Article',
    'Page',
    // Phase 13: the same eleven editorial invariants for each News family.
    'NewsArticle',
    'PressRelease',
    'Statement',
    'MediaCoverage',
    // Phase 14: the same eleven for an Event, and four more below.
    'Event',
    // Phase 15: the same eleven for a Collection, and two more below.
    'Collection',
  ].flatMap((kind) => [
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
  // Phases 8 and 9: the permanent slug reservations, made by the database so no
  // writer can skip them — and, for an issue, the refusal to leave its Magazine.
  'LibraryReserveWorkSlug',
  'LibraryReserveResearchSlug',
  'LibraryReserveResearchPaperSlug',
  'LibraryReservePublicationSlug',
  'LibraryReserveMagazineSlug',
  'LibraryReserveMagazineIssueSlug',
  'LibraryReserveEncyclopediaSlug',
  // Phase 10: the same permanent reservation for each Media aggregate.
  'MediaReserveVideoSlug',
  'MediaReserveSeriesSlug',
  'MediaReservePlaylistSlug',
  // Phase 11: the same for each audio aggregate.
  'MediaReserveAudioTrackSlug',
  'MediaReserveAudioSeriesSlug',
  // Phase 12: the same for a Gallery. A Photo has no slug.
  'MediaReserveGallerySlug',
  // Phase 16: the same for each Global Network level — Region and City slugs
  // reserved within their Country.
  'GlobalReserveCountrySlug',
  'GlobalReserveRegionSlug',
  'GlobalReserveCitySlug',
  'GlobalReserveCentreSlug',
  // Phase 14: an Event's occurrences and Gallery associations are revision
  // state — immutable, and never added to a revision once it is current.
  'EventScheduleImmutable',
  'EventGalleryImmutable',
  'EventScheduleAppend',
  'EventGalleryAppend',
  // Phase 15: a Collection's ordered members are revision state — immutable,
  // and never added to a revision once it is current.
  'CollectionItemImmutable',
  'CollectionItemAppend',
  // Phase 18: every Quran invariant no constraint can express — each listed,
  // with the refusal it raises, in `QURAN_TRIGGER_NUMBERS`.
  ...Object.keys(QURAN_TRIGGER_NUMBERS),
  // Phase 19: every Hadith invariant no constraint can express — each listed,
  // with the refusal it raises, in `HADITH_TRIGGER_NUMBERS`.
  ...Object.keys(HADITH_TRIGGER_NUMBERS),
  // Phase 20: every Fatwa invariant no constraint can express — each listed,
  // with the refusal it raises, in `FATWA_TRIGGER_NUMBERS`.
  ...Object.keys(FATWA_TRIGGER_NUMBERS),
  // Phase 21: consent evidence is append-only, even to a privileged session.
  'NewsletterConsentEventImmutable',
  // Phase 22: the two permanent slug reservations and every rule that keeps the
  // public catalogue whole — each listed, with the refusal it raises, in
  // `LEARNING_TRIGGER_NUMBERS`.
  ...Object.keys(LEARNING_TRIGGER_NUMBERS),
  // Phase 23: the immutable activation and every rule that keeps live classes
  // typed, activated, conflict-free and final — each listed, with the refusal
  // it raises, in `CLASSES_TRIGGER_NUMBERS`.
  ...Object.keys(CLASSES_TRIGGER_NUMBERS),
  // Phase 24: the immutable activation and every rule that keeps a
  // conversation typed, activated, ordered and immutable — each listed, with
  // the refusal it raises, in `MESSAGING_TRIGGER_NUMBERS`.
  ...Object.keys(MESSAGING_TRIGGER_NUMBERS),
  // Phase 26: every rule that keeps a type, an application, a Membership and
  // its owed mail on their lifecycles — each listed, with the refusal it
  // raises, in `MEMBERSHIP_TRIGGER_NUMBERS`.
  ...Object.keys(MEMBERSHIP_TRIGGER_NUMBERS),
  // Phase 27: the immutable activation and every rule that keeps a campaign,
  // a donation's money and facts, a provider event, a refund and owed mail
  // forward-only and within their authority — each listed, with the refusal
  // it raises, in `DONATIONS_TRIGGER_NUMBERS`.
  ...Object.keys(DONATIONS_TRIGGER_NUMBERS),
  // Phase 29: every rule that keeps a source's authority fixed, raw evidence
  // append-only, a staged revision's payload immutable, runs and records
  // re-identifiable never, and publication and promotion gated on live
  // authority — each listed, with the refusal it raises, in
  // `MIGRATION_TRIGGER_NUMBERS`.
  ...Object.keys(MIGRATION_TRIGGER_NUMBERS),
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
  // Phase 17. The closed inventory, the lease pair, the exhausted-scope reason
  // and the one-word-breaker-per-document rule are all refused by the database.
  { table: 'SearchIndexRequest', constraint: 'SearchIndexRequest_scopeKind_ck' },
  ...['scopeKind', 'status', 'generation', 'attempts', 'lease', 'failure', 'failed'].map(
    (rule) => ({
      table: 'SearchIndexScope',
      constraint: 'SearchIndexScope_' + rule + '_ck',
    }),
  ),
  ...['kind', 'scope', 'title', 'year', 'match', 'checksum'].map((rule) => ({
    table: 'SearchDocument',
    constraint: 'SearchDocument_' + rule + '_ck',
  })),
  // Phase 9. Lifecycle, locale, bounds and date-only facts for each aggregate;
  // citations HTTPS- and DOI-shaped; issue numbers positive and bounded.
  ...(
    [
      ['Research', true],
      ['ResearchPaper', true],
      ['Publication', true],
      ['Magazine', false],
      ['MagazineIssue', true],
      ['Encyclopedia', true],
    ] as const
  ).flatMap(([table, dated]) => [
    ...[
      'state',
      'version',
      'locale',
      'slug',
      ...(dated ? ['year', 'date', 'document'] : []),
    ].map((rule) => ({ table, constraint: table + '_' + rule + '_ck' })),
    { table: table + 'Label', constraint: table + 'Label_locale_ck' },
    { table: table + 'Label', constraint: table + 'Label_title_ck' },
    { table: table + 'Contributor', constraint: table + 'Contributor_role_ck' },
    { table: table + 'Contributor', constraint: table + 'Contributor_position_ck' },
  ]),
  ...['Research', 'ResearchPaper'].flatMap((table) => [
    { table, constraint: table + '_text_ck' },
    ...['position', 'text', 'url', 'doi'].map((rule) => ({
      table: table + 'Citation',
      constraint: table + 'Citation_' + rule + '_ck',
    })),
  ]),
  { table: 'ResearchPaper', constraint: 'ResearchPaper_venue_ck' },
  { table: 'Publication', constraint: 'Publication_publisher_ck' },
  { table: 'Encyclopedia', constraint: 'Encyclopedia_publisher_ck' },
  { table: 'MagazineIssue', constraint: 'MagazineIssue_numbers_ck' },
  // Phase 10. Lifecycle, locale and slug for each Media aggregate; the provider
  // and its identifier grammar; availability, format, duration and the
  // provider-hosted thumbnail; an episode position exactly when there is a
  // Series; a bounded speaker order and a bounded, dense playlist order.
  ...['Video', 'Series', 'Playlist'].flatMap((table) => [
    ...['state', 'version', 'locale', 'slug'].map((rule) => ({
      table,
      constraint: table + '_' + rule + '_ck',
    })),
    { table: table + 'Label', constraint: table + 'Label_locale_ck' },
    { table: table + 'Label', constraint: table + 'Label_title_ck' },
  ]),
  ...[
    'provider',
    'availability',
    'format',
    'duration',
    'thumbnail',
    'series',
    'transcript',
  ].map((rule) => ({ table: 'Video', constraint: 'Video_' + rule + '_ck' })),
  { table: 'Series', constraint: 'Series_kind_ck' },
  { table: 'VideoSpeaker', constraint: 'VideoSpeaker_position_ck' },
  { table: 'PlaylistVideo', constraint: 'PlaylistVideo_position_ck' },
  // Phase 11. Lifecycle, locale and slug for each audio aggregate; duration,
  // series place and transcript bounds; a published track always has a file;
  // a bounded speaker order.
  ...['AudioTrack', 'AudioSeries'].flatMap((table) => [
    ...['state', 'version', 'locale', 'slug'].map((rule) => ({
      table,
      constraint: table + '_' + rule + '_ck',
    })),
    { table: table + 'Label', constraint: table + 'Label_locale_ck' },
    { table: table + 'Label', constraint: table + 'Label_title_ck' },
  ]),
  ...['duration', 'series', 'transcript', 'published'].map((rule) => ({
    table: 'AudioTrack',
    constraint: 'AudioTrack_' + rule + '_ck',
  })),
  { table: 'AudioTrackSpeaker', constraint: 'AudioTrackSpeaker_position_ck' },
  // Phase 12. Lifecycle, version and locale for both aggregates; a published
  // Photo has an image; dimensions exactly with an image and within bounds; a
  // real partial date; a label that says something; a Gallery slug; 240 places.
  ...['state', 'version', 'locale', 'credit', 'published', 'image', 'taken'].map(
    (rule) => ({ table: 'Photo', constraint: 'Photo_' + rule + '_ck' }),
  ),
  { table: 'PhotoLabel', constraint: 'PhotoLabel_locale_ck' },
  { table: 'PhotoLabel', constraint: 'PhotoLabel_text_ck' },
  ...['state', 'version', 'locale', 'slug'].map((rule) => ({
    table: 'Gallery',
    constraint: 'Gallery_' + rule + '_ck',
  })),
  { table: 'GalleryLabel', constraint: 'GalleryLabel_locale_ck' },
  { table: 'GalleryLabel', constraint: 'GalleryLabel_title_ck' },
  { table: 'GalleryItem', constraint: 'GalleryItem_position_ck' },
  // Phase 13. The Article's six workflow rules, a revision's schema, a bounded
  // translation and a closed contributor vocabulary for each News family; the
  // reserved NewsArticle slugs, a Statement's issuer and a coverage source.
  ...['NewsArticle', 'PressRelease', 'Statement', 'MediaCoverage'].flatMap((table) => [
    ...['state', 'version', 'approval', 'publication', 'published_date', 'schedule'].map(
      (rule) => ({ table, constraint: table + '_' + rule + '_ck' }),
    ),
    { table: table + 'Revision', constraint: table + 'Revision_schema_ck' },
    { table: table + 'RevisionTranslation', constraint: table + 'Translation_size_ck' },
    { table: table + 'Contributor', constraint: table + 'Contributor_role_ck' },
    { table: table + 'Contributor', constraint: table + 'Contributor_position_ck' },
  ]),
  { table: 'NewsArticle', constraint: 'NewsArticle_slug_ck' },
  { table: 'NewsArticleSlugHistory', constraint: 'NewsArticleSlugHistory_slug_ck' },
  {
    table: 'StatementRevisionTranslation',
    constraint: 'StatementRevisionTranslation_issuer_ck',
  },
  { table: 'MediaCoverageRevision', constraint: 'MediaCoverageRevision_outlet_ck' },
  { table: 'MediaCoverageRevision', constraint: 'MediaCoverageRevision_source_ck' },
  // Phase 16. Lifecycle, version, locale and slug grammar for every level; an
  // ISO country code; ONE locality fact per Centre and none for a virtual one;
  // coordinates both-or-neither and in range; real words; a closed, validated
  // contact vocabulary in twelve places.
  ...['Country', 'Region', 'City', 'Centre'].flatMap((table) =>
    ['state', 'version', 'locale', 'slug'].map((rule) => ({
      table,
      constraint: table + '_' + rule + '_ck',
    })),
  ),
  { table: 'Country', constraint: 'Country_code_ck' },
  { table: 'Centre', constraint: 'Centre_locality_ck' },
  { table: 'Centre', constraint: 'Centre_virtual_ck' },
  { table: 'Centre', constraint: 'Centre_coordinates_ck' },
  ...['CountryLabel', 'RegionLabel', 'CityLabel'].flatMap((table) => [
    { table, constraint: table + '_locale_ck' },
    { table, constraint: table + '_name_ck' },
  ]),
  { table: 'CentreLabel', constraint: 'CentreLabel_locale_ck' },
  { table: 'CentreLabel', constraint: 'CentreLabel_text_ck' },
  { table: 'CentreContact', constraint: 'CentreContact_position_ck' },
  { table: 'CentreContact', constraint: 'CentreContact_value_ck' },
  { table: 'CentreContact', constraint: 'CentreContact_channel_ck' },
  // Phase 14. The Article's six workflow rules, a revision's schema, a bounded
  // translation and a closed contributor vocabulary; an IANA zone NAME, never an
  // offset; occurrences in twelve places, whole minutes, an end strictly after
  // its start and an offset no zone exceeds; Galleries in twelve places.
  ...['state', 'version', 'approval', 'publication', 'published_date', 'schedule'].map(
    (rule) => ({ table: 'Event', constraint: 'Event_' + rule + '_ck' }),
  ),
  { table: 'EventRevision', constraint: 'EventRevision_schema_ck' },
  { table: 'EventRevision', constraint: 'EventRevision_timezone_ck' },
  { table: 'EventRevisionTranslation', constraint: 'EventTranslation_size_ck' },
  { table: 'EventContributor', constraint: 'EventContributor_role_ck' },
  { table: 'EventContributor', constraint: 'EventContributor_position_ck' },
  ...['position', 'minute', 'end', 'offset'].map((rule) => ({
    table: 'EventSchedule',
    constraint: 'EventSchedule_' + rule + '_ck',
  })),
  { table: 'EventGallery', constraint: 'EventGallery_position_ck' },
  // Phase 15. The Article's six workflow rules, a revision's schema, a bounded
  // translation and a closed contributor vocabulary; members in one hundred
  // places, and exactly one typed member in each.
  ...['state', 'version', 'approval', 'publication', 'published_date', 'schedule'].map(
    (rule) => ({ table: 'Collection', constraint: 'Collection_' + rule + '_ck' }),
  ),
  { table: 'CollectionRevision', constraint: 'CollectionRevision_schema_ck' },
  { table: 'CollectionRevisionTranslation', constraint: 'CollectionTranslation_size_ck' },
  { table: 'CollectionContributor', constraint: 'CollectionContributor_role_ck' },
  { table: 'CollectionContributor', constraint: 'CollectionContributor_position_ck' },
  { table: 'CollectionItem', constraint: 'CollectionItem_position_ck' },
  { table: 'CollectionItem', constraint: 'CollectionItem_one_member_ck' },
  // Phase 18. A source's authority, evidence and transport encoding; bounded
  // structure everywhere a Surah, Ayah or Juz number is stored; non-empty text;
  // ONE activation; a correction carries its actor, step-up grant and reason;
  // verification evidence that is a pass or a classified failure; a layered work
  // published only with a registered source; closed contributor roles; bounded
  // texts; a range that starts before it ends.
  ...['authority', 'evidence', 'encoding', 'code'].map((rule) => ({
    table: 'QuranSource',
    constraint: 'QuranSource_' + rule + '_ck',
  })),
  { table: 'QuranSourceSurah', constraint: 'QuranSourceSurah_number_ck' },
  { table: 'QuranSourceSurah', constraint: 'QuranSourceSurah_revelation_ck' },
  ...['structure', 'sajdah', 'text'].map((rule) => ({
    table: 'QuranSourceAyah',
    constraint: 'QuranSourceAyah_' + rule + '_ck',
  })),
  { table: 'QuranActivation', constraint: 'QuranActivation_singleton_ck' },
  { table: 'Juz', constraint: 'Juz_number_ck' },
  { table: 'Surah', constraint: 'Surah_number_ck' },
  { table: 'Surah', constraint: 'Surah_revelation_ck' },
  ...['structure', 'sajdah', 'text'].map((rule) => ({
    table: 'Ayah',
    constraint: 'Ayah_' + rule + '_ck',
  })),
  { table: 'QuranAyahRevision', constraint: 'QuranAyahRevision_ck' },
  ...['kind', 'outcome', 'counts', 'reason'].map((rule) => ({
    table: 'QuranVerificationRun',
    constraint: 'QuranVerificationRun_' + rule + '_ck',
  })),
  { table: 'SurahName', constraint: 'SurahName_ck' },
  ...[
    'QuranTranslation',
    'QuranTransliteration',
    'QuranTafsir',
    'QuranRecitation',
    'QuranTajweedRule',
  ].flatMap((table) => [
    { table, constraint: table + '_state_ck' },
    // A public address chosen once, so its grammar is the database's to keep.
    { table, constraint: table + '_slug_ck' },
  ]),
  ...[
    'QuranTranslationContributor',
    'QuranTafsirContributor',
    'QuranTranslationText',
    'QuranTransliterationText',
    'QuranTafsirText',
    'QuranRecitationSegment',
    'QuranTajweedRuleText',
  ].map((table) => ({ table, constraint: table + '_ck' })),
  // Phase 19. A source system's authority, evidence, encoding and naming; an
  // edition's naming; ONE authority per activation; slug grammar on every
  // public address and the reserved section words on a collection's; source
  // references present, unpadded and free of control characters; bounded
  // citation numbers and texts; a correction that states its reason; a grading
  // with its grader, label and reference; verification evidence; a citation
  // that is mapped or withdrawn; conflict facets from a closed alphabet; a
  // layered work published only with a registered source system; closed
  // contributor roles; bounded entries and texts.
  ...['authority', 'evidence', 'encoding', 'code'].map((rule) => ({
    table: 'HadithSourceSystem',
    constraint: 'HadithSourceSystem_' + rule + '_ck',
  })),
  { table: 'HadithEdition', constraint: 'HadithEdition_code_ck' },
  ...[
    'HadithCollection',
    'HadithBook',
    'HadithChapter',
    'HadithCommentary',
    'HadithScience',
  ].map((table) => ({ table, constraint: table + '_slug_ck' })),
  ...['HadithTranslation', 'HadithCommentary', 'HadithScience'].map((table) => ({
    table,
    constraint: table + '_state_ck',
  })),
  ...[
    'HadithActivation',
    'HadithCollection',
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
    'HadithTranslationContributor',
    'HadithCommentaryContributor',
    'HadithCommentaryEntry',
    'HadithScienceText',
  ].map((table) => ({ table, constraint: table + '_ck' })),
  // Phase 20. One activation, and an approved one with its evidence; slug
  // grammar on both public addresses and the reserved section and view words
  // on a ruling's; a question's closed status set, its text present exactly
  // until disposal and the facts each status needs; a ruling's review and
  // publication facts; a revision's bounded text; a publication's sequence and
  // grant; a decision's closed vocabulary; a positive read count.
  { table: 'FatwaActivation', constraint: 'FatwaActivation_evidence_ck' },
  ...['FatwaCategory', 'Fatwa'].map((table) => ({
    table,
    constraint: table + '_slug_ck',
  })),
  ...['status', 'body', 'facts'].map((rule) => ({
    table: 'FatwaQuestion',
    constraint: 'FatwaQuestion_' + rule + '_ck',
  })),
  ...[
    'FatwaActivation',
    'FatwaCategory',
    'FatwaCategoryName',
    'Fatwa',
    'FatwaRevision',
    'FatwaPublication',
    'FatwaReviewDecision',
    'FatwaReadTally',
  ].map((table) => ({ table, constraint: table + '_ck' })),
  // Phase 21. Exactly one typed target per saved item and history row, with an
  // Ayah's two columns set together; instants in order; the closed onboarding,
  // interest, goal, category, channel and kind vocabularies; bounded notes,
  // collections and positions; a notification destination that can only be a
  // path on this site; which columns each newsletter state may hold; and the
  // consent event's closed vocabulary.
  ...['SavedItem', 'ReadingHistory'].map((table) => ({
    table,
    constraint: table + '_one_target_ck',
  })),
  { table: 'NewsletterSubscriber', constraint: 'NewsletterSubscriber_facts_ck' },
  ...[
    'ReadingHistory',
    'WatchHistory',
    'PersonalisationProfile',
    'PersonalisationInterest',
    'PersonalisationGoal',
    'Note',
    'PrivateCollection',
    'PrivateCollectionItem',
    'QuranReadingProgress',
    'NotificationPreference',
    'Notification',
    'NewsletterSubscriber',
    'NewsletterConsentEvent',
  ].map((table) => ({ table, constraint: table + '_ck' })),
  // Phase 22. A Course's and a path's closed state, locale, level and format
  // vocabularies, a positive version and a publication instant whenever
  // published; slug grammar and Learn's own route words refused on both
  // catalogues and both histories; labels in a served locale with a title and
  // bounded text; bounded teacher, module, lesson and path places.
  ...['Course', 'CourseSlugHistory', 'LearningPath', 'LearningPathSlugHistory'].map(
    (table) => ({ table, constraint: table + '_slug_ck' }),
  ),
  ...[
    'Course',
    'CourseLabel',
    'CourseTeacher',
    'CourseModule',
    'CourseModuleLabel',
    'Lesson',
    'LessonLabel',
    'LearningPath',
    'LearningPathLabel',
    'LearningPathCourse',
  ].map((table) => ({ table, constraint: table + '_ck' })),
  // Phase 23. The activation's single row and its evidence when approved; a
  // scope's ending after its grant; a window's and a session's closed
  // vocabularies, real local pairs and bounded length; a meeting address only
  // with its provider, only on `meet.google.com` over HTTPS and NEVER once a
  // session is terminal; a reminder before the start; a Booking's cancellation
  // instant exactly when cancelled; the attendance mark; and an intent's
  // purpose, state and relay instant.
  { table: 'LiveLearningActivation', constraint: 'LiveLearningActivation_evidence_ck' },
  { table: 'ClassSession', constraint: 'ClassSession_meeting_ck' },
  ...[
    'LiveLearningActivation',
    'CourseTeachingAssignment',
    'Availability',
    'ClassSession',
    'Booking',
    'Attendance',
    'ClassCommunicationIntent',
  ].map((table) => ({ table, constraint: table + '_ck' })),
  // Phase 24. Storage's release digest is lower-case SHA-256 hex or absent; the
  // activation's closed kinds and its evidence when approved; a conversation's
  // shape by kind (two accounts in binary order on a Course, or one person
  // asking) and its open/closed consistency; a participant's role; a message's
  // positive sequence, bounded body, digest and moderation instant; an
  // attachment's token, formats, 5 MiB bound, four places and per-state shape;
  // a read position, a block of someone else, a report's reasons and lifecycle
  // and a decision's three actions.
  { table: 'Asset', constraint: 'Asset_releaseDigest_ck' },
  { table: 'MessagingActivation', constraint: 'MessagingActivation_evidence_ck' },
  { table: 'Conversation', constraint: 'Conversation_shape_ck' },
  ...[
    'MessagingActivation',
    'Conversation',
    'ConversationParticipant',
    'Message',
    'MessageAttachment',
    'MessageReadState',
    'MessagingBlock',
    'MessagingReport',
    'MessagingModerationDecision',
  ].map((table) => ({ table, constraint: table + '_ck' })),
  // Phase 26. A type's closed states with exactly the instants each implies, a
  // served primary locale and a bounded position; words in a served locale and
  // never blank; an application's closed statuses with exactly their ordered
  // instants and a withdrawal source exactly when withdrawn; a Membership's
  // active or closed shape with who closed it; and an intent's six purposes,
  // naming exactly the one record its purpose describes.
  ...[
    'MembershipType',
    'MembershipTypeTranslation',
    'MembershipApplication',
    'Membership',
    'MembershipCommunicationIntent',
  ].map((table) => ({ table, constraint: table + '_ck' })),
  // Phase 27. A campaign's states with exactly their instants; words never
  // blank; a currency policy at its own exponent with dense, distinct
  // suggestions inside its bounds; the only two lawful activations; a
  // donation's vocabulary, its exact money, its mutually consistent facts and
  // its state as the derivation of those facts; an event's result exactly when
  // processed; a refund's exact money and completion; and an intent naming a
  // refund exactly when it announces one.
  ...[
    'DonationCampaign',
    'DonationCampaignTranslation',
    'DonationCampaignCurrency',
    'DonationActivation',
    'DonationProviderEvent',
    'DonationRefund',
    'DonationCommunicationIntent',
  ].map((table) => ({ table, constraint: table + '_ck' })),
  ...['vocabulary', 'money', 'facts', 'state'].map((rule) => ({
    table: 'Donation',
    constraint: `Donation_${rule}_ck`,
  })),
  // Phase 29. A fixture source carries no authorisation evidence and only a
  // `*.fixture.invalid` address, bounded politeness; a host is a bare DNS name;
  // a run reconciles only once completed; a missing record's classification
  // comes with who decided; an item's terminal outcome carries its evidence; a
  // held snapshot body IS the bytes its checksum names; only a valid revision
  // free of flagged personal data is approved; a rewritten link names its
  // mapping; an access-denied error is never retry-eligible; a cross-language
  // pair is never merged; only owned or licensed material is public-eligible;
  // a legacy mapping names exactly one typed target; and every manifest,
  // entry and promotion phase carries exactly the instants and people it
  // implies.
  ...MIGRATION_TABLES.filter((table) => table !== 'MigrationStagedCategory').map(
    (table) => ({ table, constraint: table + '_ck' }),
  ),
];

/**
 * The full-text objects, exactly as Phase 17 defines them.
 *
 * Prisma's schema language cannot describe a full-text catalogue or index, so
 * nothing else would notice one missing — or one built with the wrong word
 * breaker, which would leave search working for English and silently worse for
 * Arabic and Urdu. The breaker per column is the measured tokenisation decision
 * (TECH_STACK.md §10), and it is asserted, not assumed.
 */
const EXPECTED_FULLTEXT_COLUMNS = [
  { column: 'matchArabic', lcid: 1025 },
  { column: 'matchEnglish', lcid: 1033 },
  { column: 'matchOther', lcid: 0 },
  { column: 'matchUrdu', lcid: 1056 },
];

/** The two permissions Phase 17 appends, and only these. */
const SEARCH_PERMISSIONS = ['search.operate', 'search.read'];

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
 * The capability-projection source that arrives LAST, and only with its owner.
 *
 * DOMAIN_MODEL.md §4.5 derives `canTeach`, `canReceiveQuestions`,
 * `canReviewContent` and `canIssueFatwa` from four codes. Phase 5 consumes the
 * projection and it would have been trivially convenient to seed them so a test
 * could grant one — which is exactly why this is asserted as a NEGATIVE for as
 * long as the owner has not shipped.
 *
 * Each arrives with its owner. `content.review` arrived with Editorial (Phase
 * 6); `question.receive` and `fatwa.publish`, with `fatwa.answer` beside them,
 * arrived with Fatwa (Phase 20) — catalogued but bundled into no role, which
 * `assertFatwaFoundation` proves. `teaching.perform` arrives with Phase 23's
 * teacher area, where it is catalogued, externally gated and bundled into NO
 * role, which `assertClassesFoundation` proves; Phase 22 delivers the catalogue
 * and names a Course's teachers as public attribution only. So
 * `assertPeopleFoundation` requires it ABSENT until Phase 23 is applied (and
 * again once Phase 23 is rolled back), and present but HELD BY NOBODY after.
 * OPEN_DECISIONS.md §6.3 separately reserves WHO receives any of them to the
 * organisation.
 */
const TEACHING_CAPABILITY_PERMISSIONS = ['teaching.perform'];

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

  // A DOMAIN CLASSIFICATION THAT MAPS ONTO ONE TOPIC is not an assignment
  // either. A Fatwa category's own row is what is classified, by ONE NOT NULL
  // `topicId` column (DOMAIN_MODEL.md §12: "FatwaCategory is a domain
  // classification that maps onto canonical Topics"), so there is no target
  // identifier to leave dangling. Named exactly, and its shape proved below, so
  // a junction cannot hide here by name.
  const CLASSIFICATION_TABLES = ['FatwaCategory'];
  const classifications = topicReferences.filter((row) =>
    CLASSIFICATION_TABLES.includes(row.junctionTable),
  );
  for (const classification of classifications) {
    const [shape] = await session.query<{ keys: number; columns: string | null }>(`
      SELECT
        (SELECT COUNT(*) FROM sys.foreign_keys
          WHERE parent_object_id = OBJECT_ID(N'[dbo].[${classification.junctionTable}]')
            AND referenced_object_id = OBJECT_ID(N'[dbo].[Topic]')) AS keys,
        (SELECT STRING_AGG(c.name + N':' + CAST(c.is_nullable AS NVARCHAR(1)), N',')
           FROM sys.foreign_key_columns fc
           JOIN sys.foreign_keys fk ON fk.object_id = fc.constraint_object_id
           JOIN sys.columns c ON c.object_id = fc.parent_object_id AND c.column_id = fc.parent_column_id
          WHERE fk.parent_object_id = OBJECT_ID(N'[dbo].[${classification.junctionTable}]')
            AND fk.referenced_object_id = OBJECT_ID(N'[dbo].[Topic]')) AS columns;
    `);
    if (Number(shape?.keys) !== 1 || shape?.columns !== 'topicId:0') {
      fail(
        `${classification.junctionTable} must map onto exactly one Topic by one NOT NULL ` +
          `topicId column; found ${JSON.stringify(shape ?? null)}.`,
      );
    }
  }

  const junctions = topicReferences.filter(
    (row) =>
      !AGGREGATE_TABLES.includes(row.junctionTable) &&
      !CLASSIFICATION_TABLES.includes(row.junctionTable),
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
      `${classifications.length} single-topic classification(s), ` +
      `aggregate edges: ${aggregateEdges.join(', ')}`,
  );
}

/**
 * The Phase-17 search foundation: the full-text objects, their word breakers,
 * the absence of any relational edge into an owner, and the two permissions.
 *
 * DERIVED MEANS UNRELATED. The only foreign keys a Search table may carry are
 * its own internal ones; an edge from the projection into `Topic`, `Work` or any
 * other owner table would make the derived index a relational dependant of the
 * contexts it merely reflects (DOMAIN_MODEL.md §6.2, ARCHITECTURE.md §8.5).
 */
async function assertSearchFoundation(session: SqlSession): Promise<void> {
  const catalogs = await session.query<{ name: string; accentSensitive: boolean }>(`
    SELECT [name], CAST([is_accent_sensitivity_on] AS BIT) AS accentSensitive
    FROM sys.fulltext_catalogs;
  `);
  if (catalogs.length !== 1 || catalogs[0]?.name !== 'SearchCatalog') {
    fail(
      `Expected exactly the SearchCatalog full-text catalogue; found ` +
        `${catalogs.map((row) => row.name).join(', ') || '(none)'}.`,
    );
  }
  if (catalogs[0]?.accentSensitive) fail('SearchCatalog must be accent insensitive.');

  const indexes = await session.query<{
    tableName: string;
    keyIndex: string;
    changeTracking: string;
    stoplist: number | null;
  }>(`
    SELECT OBJECT_NAME(fi.[object_id]) AS tableName,
           i.[name] AS keyIndex,
           fi.[change_tracking_state_desc] AS changeTracking,
           fi.[stoplist_id] AS stoplist
    FROM sys.fulltext_indexes fi
    JOIN sys.indexes i ON i.[object_id] = fi.[object_id] AND i.[index_id] = fi.[unique_index_id];
  `);
  const index = indexes[0];
  if (indexes.length !== 1 || index?.tableName !== 'SearchDocument') {
    fail(
      `Expected exactly one full-text index, on SearchDocument; found ` +
        `${indexes.map((row) => row.tableName).join(', ') || '(none)'}.`,
    );
  }
  if (index.keyIndex !== 'SearchDocument_pkey') {
    fail(`The full-text key index is ${index.keyIndex}, not SearchDocument_pkey.`);
  }
  if (index.changeTracking !== 'AUTO') {
    fail(`Full-text change tracking is ${index.changeTracking}, not AUTO.`);
  }
  if (index.stoplist !== null)
    fail('The full-text index must be built with STOPLIST OFF.');

  const columns = await session.query<{ column: string; lcid: number }>(`
    SELECT c.[name] AS [column], fic.[language_id] AS lcid
    FROM sys.fulltext_index_columns fic
    JOIN sys.columns c ON c.[object_id] = fic.[object_id] AND c.[column_id] = fic.[column_id]
    WHERE fic.[object_id] = OBJECT_ID(N'[dbo].[SearchDocument]')
    ORDER BY c.[name];
  `);
  const actual = columns.map((row) => `${row.column}:${String(row.lcid)}`).join(', ');
  const expected = EXPECTED_FULLTEXT_COLUMNS.map(
    (entry) => `${entry.column}:${String(entry.lcid)}`,
  ).join(', ');
  if (actual !== expected) {
    fail(
      `Full-text columns and word breakers differ.\n  expected: ${expected}\n  actual:   ${actual}`,
    );
  }

  const edges = await session.query<{ parent: string; referenced: string }>(`
    SELECT OBJECT_NAME(fk.[parent_object_id]) AS parent,
           OBJECT_NAME(fk.[referenced_object_id]) AS referenced
    FROM sys.foreign_keys fk
    WHERE OBJECT_NAME(fk.[parent_object_id]) LIKE N'Search%'
       OR OBJECT_NAME(fk.[referenced_object_id]) LIKE N'Search%'
    ORDER BY parent, referenced;
  `);
  const edgeList = edges.map((row) => `${row.parent}->${row.referenced}`).join(', ');
  if (
    edgeList !== 'SearchDocument->SearchIndexScope, SearchDocumentTopic->SearchDocument'
  ) {
    fail(`Search tables must carry only their internal foreign keys; found ${edgeList}.`);
  }

  const permissions = await session.query<{ key: string }>(`
    SELECT p.[key] FROM [Permission] p
    JOIN [RolePermission] rp ON rp.[permissionKey] = p.[key]
    JOIN [Role] r ON r.[id] = rp.[roleId]
    WHERE r.[key] = N'platform-administrator' AND p.[key] LIKE N'search.%'
    ORDER BY p.[key];
  `);
  if (permissions.map((row) => row.key).join(',') !== SEARCH_PERMISSIONS.join(',')) {
    fail(
      `Search permissions differ; found: ` +
        (permissions.map((row) => row.key).join(', ') || '(none)'),
    );
  }

  report(
    'search foundation',
    `SearchCatalog (accent insensitive), ${columns.length} word-breaker columns, ` +
      `internal edges only, ${SEARCH_PERMISSIONS.length} permissions bundled`,
  );
}

/**
 * The vocabulary a CHECK constraint holds, sorted.
 *
 * Read from the catalogue's own definition, so what is proved is what the
 * database will enforce rather than what a migration file says.
 */
async function searchVocabulary(
  session: SqlSession,
  constraint: string,
): Promise<string> {
  const [row] = await session.query<{ definition: string }>(
    `SELECT [definition] FROM sys.check_constraints WHERE [name] = N'${constraint}';`,
  );
  if (row === undefined) fail(`The CHECK constraint ${constraint} is missing.`);
  return [...row.definition.matchAll(/N'([a-z-]+)'/gu)]
    .map((match) => match[1])
    .sort()
    .join(',');
}

const PHASE17_SCOPES = ['article', 'page', 'person', 'topic', 'work'];
const PHASE17_KINDS = [...PHASE17_SCOPES, 'book-translation', 'edition'];
const PHASE9_KINDS = [
  'encyclopedia',
  'magazine',
  'magazine-issue',
  'publication',
  'research',
  'research-paper',
];

const PHASE10_KINDS = ['video'];

const PHASE11_KINDS = ['audio'];

const PHASE13_KINDS = ['media-coverage', 'news-article', 'press-release', 'statement'];

/** The canonical citation is the result unit; its scope is one Ayah. */
const PHASE18_KINDS = ['quran-ayah'];

/** The public citation is the result unit; its scope is one HadithCitation. */
const PHASE19_KINDS = ['hadith'];

/** The current published revision is the result unit; its scope is one Fatwa. */
const PHASE20_KINDS = ['fatwa'];

/**
 * A published Course and a published path are each their own kind and their
 * own scope. A module and a lesson have no public address and are not kinds.
 */
const PHASE22_KINDS = ['course', 'learning-path'];

/**
 * Phase 9 WIDENS the search vocabularies by exactly its six kinds, each its own
 * scope, Phase 10 by exactly `video`, Phase 11 by exactly `audio`, Phase 18
 * by exactly `quran-ayah`, Phase 19 by exactly `hadith`, Phase 20 by exactly
 * `fatwa` and Phase 22 by exactly `course` and `learning-path` (Phase 21 widens
 * nothing); each rollback narrows them back to exactly the
 * previous phase's. Asserted against the catalogue in every
 * direction, so a migration that pre-created a later domain's kind, or a
 * rollback that left one behind, fails here.
 */
async function assertSearchVocabulary(
  session: SqlSession,
  stage:
    | 'phase17'
    | 'phase9'
    | 'phase10'
    | 'phase11'
    | 'phase13'
    | 'phase18'
    | 'phase19'
    | 'phase20'
    | 'phase22',
): Promise<void> {
  const sorted = (values: readonly string[]) => [...values].sort().join(',');
  const phase13 = [...PHASE9_KINDS, ...PHASE10_KINDS, ...PHASE11_KINDS, ...PHASE13_KINDS];
  const added = {
    phase17: [],
    phase9: PHASE9_KINDS,
    phase10: [...PHASE9_KINDS, ...PHASE10_KINDS],
    phase11: [...PHASE9_KINDS, ...PHASE10_KINDS, ...PHASE11_KINDS],
    phase13,
    phase18: [...phase13, ...PHASE18_KINDS],
    phase19: [...phase13, ...PHASE18_KINDS, ...PHASE19_KINDS],
    phase20: [...phase13, ...PHASE18_KINDS, ...PHASE19_KINDS, ...PHASE20_KINDS],
    phase22: [
      ...phase13,
      ...PHASE18_KINDS,
      ...PHASE19_KINDS,
      ...PHASE20_KINDS,
      ...PHASE22_KINDS,
    ],
  }[stage];
  const scopes = sorted([...PHASE17_SCOPES, ...added]);
  const kinds = sorted([...PHASE17_KINDS, ...added]);

  for (const constraint of [
    'SearchIndexRequest_scopeKind_ck',
    'SearchIndexScope_scopeKind_ck',
  ]) {
    const actual = await searchVocabulary(session, constraint);
    if (actual !== scopes) fail(`${constraint} holds ${actual}; expected ${scopes}.`);
  }
  const actual = await searchVocabulary(session, 'SearchDocument_kind_ck');
  if (actual !== kinds)
    fail(`SearchDocument_kind_ck holds ${actual}; expected ${kinds}.`);

  report(
    'search vocabulary',
    {
      phase17: 'exactly Phase 17 after rollback',
      phase9: 'exactly Phase 17 and Phase 9 after the Phase-10 rollback',
      phase10: 'exactly Phase 17, Phase 9 and video after the Phase-11 rollback',
      phase11: 'exactly Phase 17, Phase 9, video and audio',
      phase13: 'Phase 17, the six Phase-9 kinds, video, audio and the four News kinds',
      phase18:
        'Phase 17, the six Phase-9 kinds, video, audio, the four News kinds and quran-ayah',
      phase19:
        'Phase 17, the six Phase-9 kinds, video, audio, the four News kinds, quran-ayah and hadith',
      phase20:
        'Phase 17, the six Phase-9 kinds, video, audio, the four News kinds, quran-ayah, hadith and fatwa',
      phase22:
        'Phase 17, the six Phase-9 kinds, video, audio, the four News kinds, quran-ayah, hadith, ' +
        'fatwa, course and learning-path',
    }[stage],
  );
}

const MEDIA_PERMISSIONS = ['media.administer', 'media.read'];

/**
 * Phase 11 — what only the catalogue can prove about audio:
 *
 *   1. a track's file is ONE nullable foreign key to Storage's `Asset`, which
 *      never cascades — changing a track can never delete an Asset;
 *   2. NO column of AudioTrack or AudioSeries can describe a Quran recitation —
 *      no reciter, Surah, Ayah, Juz or recitation marker — so the schema itself
 *      refuses to become a second authoring path for one (DOMAIN_MODEL.md §8.1);
 *   3. the Media vocabulary is STILL exactly the two keys, now describing audio,
 *      and no audio-specific key exists.
 */
async function assertAudioFoundation(session: SqlSession): Promise<void> {
  const [asset] = await session.query<{
    columns: number;
    nullable: number;
    deletes: string | null;
    target: string | null;
  }>(`
    SELECT
      (SELECT COUNT(*) FROM sys.columns
        WHERE object_id = OBJECT_ID(N'[dbo].[AudioTrack]') AND name = N'assetId') AS columns,
      (SELECT SUM(CAST(is_nullable AS INT)) FROM sys.columns
        WHERE object_id = OBJECT_ID(N'[dbo].[AudioTrack]') AND name = N'assetId') AS nullable,
      (SELECT delete_referential_action_desc FROM sys.foreign_keys
        WHERE name = N'AudioTrack_assetId_fkey') AS deletes,
      (SELECT OBJECT_NAME(referenced_object_id) FROM sys.foreign_keys
        WHERE name = N'AudioTrack_assetId_fkey') AS target;
  `);
  if (
    Number(asset?.columns) !== 1 ||
    Number(asset?.nullable) !== 1 ||
    asset?.deletes !== 'NO_ACTION' ||
    asset.target !== 'Asset'
  ) {
    fail(
      `AudioTrack must carry exactly one nullable, non-cascading Asset reference; ` +
        `found ${JSON.stringify(asset ?? null)}.`,
    );
  }

  const quranShaped = await session.query<{ name: string }>(`
    SELECT c.name FROM sys.columns c
    WHERE c.object_id IN (OBJECT_ID(N'[dbo].[AudioTrack]'), OBJECT_ID(N'[dbo].[AudioSeries]'))
      AND (c.name LIKE N'%surah%' OR c.name LIKE N'%ayah%' OR c.name LIKE N'%juz%'
           OR c.name LIKE N'%recit%' OR c.name LIKE N'%quran%' OR c.name LIKE N'%kind%'
           OR c.name LIKE N'%format%');
  `);
  if (quranShaped.length > 0) {
    fail(
      `Audio must not be able to describe a recitation or carry a type column; found ` +
        `${quranShaped.map((row) => row.name).join(', ')}.`,
    );
  }

  const permissions = await session.query<{ key: string; description: string }>(`
    SELECT [key], [description] FROM [dbo].[Permission]
    WHERE [key] LIKE N'media.%' OR [key] LIKE N'audio.%' ORDER BY [key];
  `);
  if (
    permissions.map((row) => row.key).join(',') !== MEDIA_PERMISSIONS.join(',') ||
    !permissions.every((row) => row.description.includes('audio'))
  ) {
    fail(
      `The Media vocabulary must remain two keys that now name audio; found ` +
        `${JSON.stringify(permissions)}.`,
    );
  }

  report(
    'audio foundation',
    'one non-cascading Asset reference, no recitation shape, the same two keys',
  );
}

/**
 * Phase 12 — what only the catalogue can prove about photographs:
 *
 *   1. a Photo's image is ONE nullable foreign key to Storage's `Asset`, which
 *      never cascades, and every Phase-12 foreign key is NO ACTION — removing a
 *      Gallery's membership can never remove a Photo, nor a Photo an Asset;
 *   2. NO column of Photo, Gallery or GalleryItem references an Event, a Centre,
 *      a Collection, a person or a topic, and no Gallery has a kind — the
 *      Event↔Gallery association is Phase 14's (DELIVERY_PLAN.md Phases 13–15);
 *   3. the Media vocabulary is STILL exactly the two keys, now describing
 *      photographs and galleries too, and no photograph-specific key exists.
 */
async function assertPhotoFoundation(session: SqlSession): Promise<void> {
  const [asset] = await session.query<{
    columns: number;
    nullable: number;
    deletes: string | null;
    target: string | null;
  }>(`
    SELECT
      (SELECT COUNT(*) FROM sys.columns
        WHERE object_id = OBJECT_ID(N'[dbo].[Photo]') AND name = N'assetId') AS columns,
      (SELECT SUM(CAST(is_nullable AS INT)) FROM sys.columns
        WHERE object_id = OBJECT_ID(N'[dbo].[Photo]') AND name = N'assetId') AS nullable,
      (SELECT delete_referential_action_desc FROM sys.foreign_keys
        WHERE name = N'Photo_assetId_fkey') AS deletes,
      (SELECT OBJECT_NAME(referenced_object_id) FROM sys.foreign_keys
        WHERE name = N'Photo_assetId_fkey') AS target;
  `);
  if (
    Number(asset?.columns) !== 1 ||
    Number(asset?.nullable) !== 1 ||
    asset?.deletes !== 'NO_ACTION' ||
    asset.target !== 'Asset'
  ) {
    fail(
      `Photo must carry exactly one nullable, non-cascading Asset reference; ` +
        `found ${JSON.stringify(asset ?? null)}.`,
    );
  }

  const cascading = await session.query<{ name: string }>(`
    SELECT name FROM sys.foreign_keys
    WHERE parent_object_id IN (OBJECT_ID(N'[dbo].[Photo]'), OBJECT_ID(N'[dbo].[PhotoLabel]'),
                               OBJECT_ID(N'[dbo].[Gallery]'), OBJECT_ID(N'[dbo].[GalleryLabel]'),
                               OBJECT_ID(N'[dbo].[GallerySlugHistory]'), OBJECT_ID(N'[dbo].[GalleryItem]'))
      AND (delete_referential_action <> 0 OR update_referential_action <> 0);
  `);
  if (cascading.length > 0) {
    fail(
      `Phase-12 foreign keys must not cascade; found ${cascading.map((row) => row.name).join(', ')}.`,
    );
  }

  const forward = await session.query<{ name: string }>(`
    SELECT c.name FROM sys.columns c
    WHERE c.object_id IN (OBJECT_ID(N'[dbo].[Photo]'), OBJECT_ID(N'[dbo].[Gallery]'),
                          OBJECT_ID(N'[dbo].[GalleryItem]'))
      AND (c.name LIKE N'%event%' OR c.name LIKE N'%centre%' OR c.name LIKE N'%center%'
           OR c.name LIKE N'%collection%' OR c.name LIKE N'%person%' OR c.name LIKE N'%topic%'
           OR c.name LIKE N'%kind%' OR c.name LIKE N'%type%' OR c.name LIKE N'%target%'
           OR c.name LIKE N'%slug%' AND c.object_id <> OBJECT_ID(N'[dbo].[Gallery]'));
  `);
  if (forward.length > 0) {
    fail(
      `Photographs must reference no Event, Centre, Collection, person or topic, ` +
        `carry no type, and a Photo no slug; found ${forward.map((row) => row.name).join(', ')}.`,
    );
  }

  const permissions = await session.query<{ key: string; description: string }>(`
    SELECT [key], [description] FROM [dbo].[Permission]
    WHERE [key] LIKE N'media.%' OR [key] LIKE N'photo%' OR [key] LIKE N'gallery%' ORDER BY [key];
  `);
  if (
    permissions.map((row) => row.key).join(',') !== MEDIA_PERMISSIONS.join(',') ||
    !permissions.every(
      (row) =>
        row.description.includes('photographs') && row.description.includes('galleries'),
    )
  ) {
    fail(
      `The Media vocabulary must remain two keys that now name photographs and galleries; ` +
        `found ${JSON.stringify(permissions)}.`,
    );
  }

  report(
    'photo foundation',
    'one non-cascading Asset reference, no cascade, no forward Event reference, the same two keys',
  );
}

const EDITORIAL_PERMISSIONS = [
  'content.author',
  'content.publish',
  'content.read',
  'content.review',
];

/**
 * Phase 13 — what only the catalogue can prove about News:
 *
 *   1. no Phase-13 foreign key cascades, so no removal of a Topic, a Person, a
 *      User or a revision can take News history with it;
 *   2. NO column of a News table references an image, an Asset, a Photo, a
 *      Gallery, an Event, a Collection or a newsletter, and none holds a view
 *      count, a popularity score or a featured flag. The ONE Centre column is
 *      Phase 16's `NewsArticleRevision.centreId`, exempted here by exact name
 *      and asserted by `assertGlobalFoundation`; no other family has one;
 *   3. the editorial vocabulary is still exactly the four `content.*` keys — no
 *      `news.*`, `press.*` or `statement.*` key exists — and the two that named
 *      Article and Page now name the News families.
 */
async function assertNewsFoundation(session: SqlSession): Promise<void> {
  const tables = ['NewsArticle', 'PressRelease', 'Statement', 'MediaCoverage']
    .flatMap((family) =>
      ['', 'Revision', 'RevisionTranslation', 'Topic', 'Contributor', 'SlugHistory'].map(
        (suffix) => `OBJECT_ID(N'[dbo].[${family}${suffix}]')`,
      ),
    )
    .join(',');
  const cascading = await session.query<{ name: string }>(`
    SELECT name FROM sys.foreign_keys
    WHERE parent_object_id IN (${tables})
      AND (delete_referential_action <> 0 OR update_referential_action <> 0);
  `);
  if (cascading.length > 0)
    fail(
      `Phase-13 foreign keys must not cascade; found ${cascading.map((row) => row.name).join(', ')}.`,
    );

  const forward = await session.query<{ name: string }>(`
    SELECT c.name FROM sys.columns c
    WHERE c.object_id IN (${tables})
      AND (c.name LIKE N'%image%' OR c.name LIKE N'%asset%' OR c.name LIKE N'%photo%'
           OR c.name LIKE N'%gallery%' OR c.name LIKE N'%event%' OR c.name LIKE N'%centre%'
           OR c.name LIKE N'%center%' OR c.name LIKE N'%collection%' OR c.name LIKE N'%newsletter%'
           OR c.name LIKE N'%view%' OR c.name LIKE N'%popular%' OR c.name LIKE N'%featured%'
           OR c.name LIKE N'%type%' OR c.name LIKE N'%kind%' OR c.name LIKE N'%target%')
      AND NOT (c.object_id = OBJECT_ID(N'[dbo].[NewsArticleRevision]') AND c.name = N'centreId');
  `);
  if (forward.length > 0)
    fail(
      `News must reference no image, Event, Centre, Collection or newsletter and carry ` +
        `no type or engagement column; found ${forward.map((row) => row.name).join(', ')}.`,
    );

  // `newsletter.*` is Personalisation's (Phase 21), a subscription and never a
  // News family, and is proved by `assertPersonalisationFoundation`.
  const permissions = await session.query<{ key: string; description: string }>(`
    SELECT [key], [description] FROM [dbo].[Permission]
    WHERE [key] LIKE N'content.%' OR ([key] LIKE N'news%' AND [key] NOT LIKE N'newsletter.%') OR [key] LIKE N'press%'
       OR [key] LIKE N'statement%' OR [key] LIKE N'mediaCoverage%' ORDER BY [key];
  `);
  const described = permissions.filter((row) =>
    ['content.read', 'content.author'].includes(row.key),
  );
  if (
    permissions.map((row) => row.key).join(',') !== EDITORIAL_PERMISSIONS.join(',') ||
    described.length !== 2 ||
    !described.every(
      (row) => row.description.includes('news') && row.description.includes('statement'),
    )
  )
    fail(
      `The editorial vocabulary must remain the four content keys, naming the News ` +
        `families; found ${JSON.stringify(permissions)}.`,
    );

  report(
    'news foundation',
    'no cascade, no image, Event or newsletter reference, the same four keys',
  );
}

const GLOBAL_PERMISSIONS = ['global.administer', 'global.read'];

/** The editorial revisions that may name a Centre, by name order. */
const CENTRE_REFERENCING_REVISIONS = ['EventRevision', 'NewsArticleRevision'];

const GLOBAL_TABLES = [
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
];

/**
 * The parent references the SAME-COUNTRY rule rests on: each is a composite
 * foreign key on (id, countryId), so a child cannot name another Country's
 * parent whoever writes. A plain single-column key here would let a City point
 * at another Country's Region — exactly the drift this gate exists to catch.
 */
const GLOBAL_COMPOSITE_KEYS = [
  { name: 'City_regionId_countryId_fkey', target: 'Region' },
  { name: 'Centre_regionId_countryId_fkey', target: 'Region' },
  { name: 'Centre_cityId_countryId_fkey', target: 'City' },
  { name: 'CentreServiceCity_centreId_countryId_fkey', target: 'Centre' },
  { name: 'CentreServiceCity_cityId_countryId_fkey', target: 'City' },
  { name: 'RegionSlugHistory_regionId_countryId_fkey', target: 'Region' },
  { name: 'CitySlugHistory_cityId_countryId_fkey', target: 'City' },
];

/**
 * Phase 16 — what only the catalogue can prove about the Global Network:
 *
 *   1. no Global foreign key cascades, and the News revision's Centre key does
 *      not either — nothing done to a Centre can take News with it;
 *   2. every same-Country relation is a COMPOSITE key on two columns;
 *   3. coordinates are exact `decimal(9,6)`, never binary floating point;
 *   4. ONE nullable Centre column exists outside Global — on
 *      `NewsArticleRevision` — and none on any other News family or table;
 *      Phase 14 adds exactly one more, `EventRevision.centreId` (`stage`);
 *   5. no Global table names an Event, News, a search kind or a target type;
 *   6. the Global vocabulary is exactly two keys, both in the protected bundle.
 */
async function assertGlobalFoundation(
  session: SqlSession,
  stage: 'with-events' | 'before-events' = 'with-events',
): Promise<void> {
  const tables = GLOBAL_TABLES.map((table) => `OBJECT_ID(N'[dbo].[${table}]')`).join(',');
  const cascading = await session.query<{ name: string }>(`
    SELECT name FROM sys.foreign_keys
    WHERE (parent_object_id IN (${tables})
           OR name IN (N'NewsArticleRevision_centreId_fkey', N'EventRevision_centreId_fkey'))
      AND (delete_referential_action <> 0 OR update_referential_action <> 0);
  `);
  if (cascading.length > 0)
    fail(
      `Phase-16 foreign keys must not cascade; found ${cascading.map((row) => row.name).join(', ')}.`,
    );

  for (const key of GLOBAL_COMPOSITE_KEYS) {
    const [row] = await session.query<{ columns: number; target: string | null }>(`
      SELECT COUNT(*) AS columns, MAX(OBJECT_NAME(fk.referenced_object_id)) AS target
      FROM sys.foreign_keys fk
      JOIN sys.foreign_key_columns c ON c.constraint_object_id = fk.object_id
      WHERE fk.name = N'${key.name}';
    `);
    if (Number(row?.columns) !== 2 || row?.target !== key.target)
      fail(
        `${key.name} must be a two-column same-Country key to ${key.target}; ` +
          `found ${JSON.stringify(row ?? null)}.`,
      );
  }

  const coordinates = await session.query<{
    name: string;
    type: string;
    precision: number;
    scale: number;
  }>(`
    SELECT c.name, TYPE_NAME(c.user_type_id) AS type, c.precision, c.scale FROM sys.columns c
    WHERE c.object_id = OBJECT_ID(N'[dbo].[Centre]') AND c.name IN (N'latitude', N'longitude')
    ORDER BY c.name;
  `);
  if (
    coordinates.length !== 2 ||
    !coordinates.every(
      (row) =>
        row.type === 'decimal' && Number(row.precision) === 9 && Number(row.scale) === 6,
    )
  )
    fail(
      `Centre coordinates must be exact decimal(9,6); found ${JSON.stringify(coordinates)}.`,
    );

  const centreColumns = await session.query<{
    tableName: string;
    name: string;
    nullable: boolean;
  }>(`
    SELECT OBJECT_NAME(c.object_id) AS tableName, c.name, c.is_nullable AS nullable
    FROM sys.columns c
    WHERE (c.name LIKE N'%centre%' OR c.name LIKE N'%center%')
      AND OBJECT_NAME(c.object_id) NOT IN (${GLOBAL_TABLES.map((table) => `N'${table}'`).join(',')})
      AND OBJECTPROPERTY(c.object_id, 'IsUserTable') = 1;
  `);
  // Phase 14 adds the SECOND and last: `EventRevision.centreId`. Before Phase 14
  // is applied — and after its rollback — only the News one may exist.
  const owners =
    stage === 'with-events' ? CENTRE_REFERENCING_REVISIONS : ['NewsArticleRevision'];
  const keys = await session.query<{
    name: string;
    target: string | null;
    columns: number;
  }>(`
    SELECT fk.name, OBJECT_NAME(fk.referenced_object_id) AS target,
      (SELECT COUNT(*) FROM sys.foreign_key_columns c WHERE c.constraint_object_id = fk.object_id) AS columns
    FROM sys.foreign_keys fk
    WHERE fk.referenced_object_id = OBJECT_ID(N'[dbo].[Centre]')
      AND OBJECT_NAME(fk.parent_object_id) NOT IN (${GLOBAL_TABLES.map((table) => `N'${table}'`).join(',')})
      AND (fk.delete_referential_action = 0 AND fk.update_referential_action = 0)
    ORDER BY fk.name;
  `);
  if (
    centreColumns
      .map((row) => `${row.tableName}.${row.name}:${String(Boolean(row.nullable))}`)
      .sort()
      .join(',') !== owners.map((table) => `${table}.centreId:true`).join(',') ||
    keys
      .map((row) => `${row.name}>${row.target ?? ''}/${String(row.columns)}`)
      .join(',') !== owners.map((table) => `${table}_centreId_fkey>Centre/1`).join(',')
  )
    fail(
      `Exactly ${owners.join(' and ')} may hold a nullable, non-cascading Centre ` +
        `reference outside Global; found ${JSON.stringify(centreColumns)} and ${JSON.stringify(keys)}.`,
    );

  const forward = await session.query<{ name: string }>(`
    SELECT c.name FROM sys.columns c
    WHERE c.object_id IN (${tables})
      AND (c.name LIKE N'%event%' OR c.name LIKE N'%search%' OR c.name LIKE N'%kind%'
           OR c.name LIKE N'%type%' OR c.name LIKE N'%target%' OR c.name LIKE N'%news%'
           OR c.name LIKE N'%geocod%' OR c.name LIKE N'%map%');
  `);
  if (forward.length > 0)
    fail(
      `Global must reference no Event, News, search or map and carry no type column; ` +
        `found ${forward.map((row) => row.name).join(', ')}.`,
    );

  const permissions = await session.query<{ key: string; bundled: number }>(`
    SELECT p.[key],
      (SELECT COUNT(*) FROM [dbo].[RolePermission] rp JOIN [dbo].[Role] r ON r.[id] = rp.[roleId]
       WHERE r.[key] = N'platform-administrator' AND rp.[permissionKey] = p.[key]) AS bundled
    FROM [dbo].[Permission] p
    WHERE p.[key] LIKE N'global.%' OR p.[key] LIKE N'country%' OR p.[key] LIKE N'region%'
       OR p.[key] LIKE N'city%' OR p.[key] LIKE N'centre%' ORDER BY p.[key];
  `);
  if (
    permissions.map((row) => row.key).join(',') !== GLOBAL_PERMISSIONS.join(',') ||
    !permissions.every((row) => Number(row.bundled) === 1)
  )
    fail(
      `The Global vocabulary must be exactly global.read and global.administer, both in ` +
        `the protected bundle; found ${JSON.stringify(permissions)}.`,
    );

  report(
    'global foundation',
    `no cascade, composite same-Country keys, exact coordinates, ${owners.length === 1 ? 'one News' : 'News and Event'} Centre column(s), two bundled keys`,
  );
}

/** After the Phase-16 rollback, News carries no Centre and no Global key survives. */
async function assertGlobalRemoved(session: SqlSession): Promise<void> {
  const [row] = await session.query<{ columns: number; permissions: number }>(`
    SELECT
      (SELECT COUNT(*) FROM sys.columns
        WHERE object_id = OBJECT_ID(N'[dbo].[NewsArticleRevision]') AND name = N'centreId') AS columns,
      (SELECT COUNT(*) FROM [dbo].[Permission] WHERE [key] LIKE N'global.%') AS permissions;
  `);
  if (Number(row?.columns) !== 0 || Number(row?.permissions) !== 0)
    fail(
      `The Phase-16 rollback left a Centre column or a Global key: ${JSON.stringify(row)}.`,
    );
  report('global rollback', 'News Centre column and both Global keys removed');
}

const EVENT_TABLES = [
  'Event',
  'EventRevision',
  'EventRevisionTranslation',
  'EventTopic',
  'EventContributor',
  'EventSchedule',
  'EventGallery',
  'EventSlugHistory',
];

/**
 * EVERY foreign key from an Event table to another owner's table, exactly. Each
 * is a typed reference to one named table — never a type string beside an
 * identifier — and the list is the whole of it, so a ninth edge (an image, a
 * venue, a second Centre) fails here.
 */
const EVENT_EXTERNAL_KEYS = [
  'EventContributor_personId_fkey>Person',
  'EventGallery_galleryId_fkey>Gallery',
  'EventRevisionTranslation_languageCode_fkey>Language',
  'EventRevision_centreId_fkey>Centre',
  'EventRevision_editorId_fkey>User',
  'EventTopic_topicId_fkey>Topic',
  'Event_approvedById_fkey>User',
  'Event_creatorId_fkey>User',
  'Event_scheduledById_fkey>User',
];

/**
 * The two editorial descriptions as Phase 13 left them, as Phase 14 restated
 * them, and as Phase 15 restates them again.
 */
const EDITORIAL_DESCRIPTIONS = {
  phase13: {
    'content.author':
      'Create and revise Article, Page, news, press release, statement and media coverage drafts and submit them for review.',
    'content.read':
      'Read private Article, Page, news, press release, statement and media coverage drafts and revisions.',
  },
  phase14: {
    'content.author':
      'Create and revise Article, Page, news, press release, statement, media coverage and event drafts and submit them for review.',
    'content.read':
      'Read private Article, Page, news, press release, statement, media coverage and event drafts and revisions.',
  },
  phase15: {
    'content.author':
      'Create and revise Article, Page, news, press release, statement, media coverage, event and collection drafts and submit them for review.',
    'content.read':
      'Read private Article, Page, news, press release, statement, media coverage, event and collection drafts and revisions.',
  },
} as const;

/**
 * The two editorial descriptions are EXACTLY a phase's wording, and no
 * `event.*`, `collection.*` or Collection-member key exists. Phase 26's
 * `membership.*` keys are the Membership context's, not a Collection's
 * members, so they are set aside by name rather than read as the very key
 * this check exists to forbid.
 */
async function assertEditorialDescriptions(
  session: SqlSession,
  stage: keyof typeof EDITORIAL_DESCRIPTIONS,
): Promise<void> {
  const rows = await session.query<{ key: string; description: string }>(`
    SELECT [key], [description] FROM [dbo].[Permission]
    WHERE [key] IN (N'content.read', N'content.author') OR [key] LIKE N'event%'
       OR [key] LIKE N'schedule%' OR [key] LIKE N'occurrence%'
       OR [key] LIKE N'collection%'
       OR ([key] LIKE N'member%' AND [key] NOT LIKE N'membership.%')
    ORDER BY [key];
  `);
  const expected = EDITORIAL_DESCRIPTIONS[stage];
  if (
    JSON.stringify(rows.map((row) => [row.key, row.description])) !==
    JSON.stringify(Object.entries(expected))
  )
    fail(
      `The editorial descriptions must be exactly the ${stage} wording, with no Event ` +
        `or Collection key; found ${JSON.stringify(rows)}.`,
    );
  report(
    'editorial descriptions',
    `exactly the ${stage} wording, no event.* or collection.* key`,
  );
}

/**
 * Phase 14 — what only the catalogue can prove about Events:
 *
 *   1. EIGHT DISTINCT TABLES, none a generic content, target or attachment
 *      table: no Event column names a type, kind, target, image, asset, photo,
 *      venue, location, address, registration, ticket, attendance, capacity,
 *      price, recurrence rule or offset, and the ONE Gallery and ONE Centre
 *      column are the typed `EventGallery.galleryId` (required) and
 *      `EventRevision.centreId` (optional);
 *   2. no Phase-14 foreign key cascades, and the external edges are EXACTLY the
 *      nine typed references above — to User, Language, Topic, Person, Centre
 *      and Gallery — so no Event write can delete a Centre, a Gallery or
 *      anything else of another owner's;
 *   3. Global and Media own NO Event schema: no foreign key from outside the
 *      Event tables references one, and no column outside them names an event
 *      (bar Identity's unrelated provider-webhook `ProviderEvent.eventId`);
 *   4. an occurrence's start is a required `datetime2` pair and its end an
 *      optional one; the zone is a required name; one start and one Gallery
 *      per revision are UNIQUE constraints;
 *   5. the 51146 rule — a current revision has an occurrence — is in the
 *      integrity trigger, beside 51142 and 51143;
 *   6. no search vocabulary names an event: Events are not searchable yet;
 *   7. the two editorial descriptions name events, exactly — in Phase 14's
 *      wording or, once Phase 15 is applied, its own — and no `event.*`
 *      permission exists.
 *
 * The refusals themselves are proved as BEHAVIOUR, through the runtime login,
 * by `db:test:permissions`; this gate proves they are present in the catalogue.
 */
async function assertEventFoundation(
  session: SqlSession,
  descriptions: 'phase14' | 'phase15' = 'phase15',
): Promise<void> {
  const tables = EVENT_TABLES.map((table) => `OBJECT_ID(N'[dbo].[${table}]')`).join(',');

  const shapes = await session.query<{ tableName: string; name: string }>(`
    SELECT OBJECT_NAME(c.object_id) AS tableName, c.name FROM sys.columns c
    WHERE c.object_id IN (${tables})
      AND (c.name LIKE N'%type%' OR c.name LIKE N'%kind%' OR c.name LIKE N'%target%'
           OR c.name LIKE N'%image%' OR c.name LIKE N'%asset%' OR c.name LIKE N'%photo%'
           OR c.name LIKE N'%venue%' OR c.name LIKE N'%location%' OR c.name LIKE N'%address%'
           OR c.name LIKE N'%regist%' OR c.name LIKE N'%ticket%' OR c.name LIKE N'%attend%'
           OR c.name LIKE N'%capacity%' OR c.name LIKE N'%price%' OR c.name LIKE N'%recur%'
           OR c.name LIKE N'%rrule%' OR c.name LIKE N'%offset%' OR c.name LIKE N'%gallery%'
           OR c.name LIKE N'%centre%' OR c.name LIKE N'%center%' OR c.name LIKE N'%featured%'
           OR c.name LIKE N'%popular%')
    ORDER BY tableName, c.name;
  `);
  if (
    shapes
      .map((row) => `${row.tableName}.${row.name}`)
      .sort()
      .join(',') !== 'EventGallery.galleryId,EventRevision.centreId'
  )
    fail(
      `Event tables may hold exactly one Gallery and one Centre column and no generic, ` +
        `venue, registration, recurrence or image column; found ${JSON.stringify(shapes)}.`,
    );

  const cascading = await session.query<{ name: string }>(`
    SELECT name FROM sys.foreign_keys
    WHERE parent_object_id IN (${tables})
      AND (delete_referential_action <> 0 OR update_referential_action <> 0);
  `);
  if (cascading.length > 0)
    fail(
      `Phase-14 foreign keys must not cascade; found ${cascading.map((row) => row.name).join(', ')}.`,
    );

  const external = await session.query<{ edge: string }>(`
    SELECT fk.name + N'>' + OBJECT_NAME(fk.referenced_object_id) AS edge
    FROM sys.foreign_keys fk
    WHERE fk.parent_object_id IN (${tables}) AND fk.referenced_object_id NOT IN (${tables})
    ORDER BY edge;
  `);
  if (
    external
      .map((row) => row.edge)
      .sort()
      .join(',') !== EVENT_EXTERNAL_KEYS.join(',')
  )
    fail(
      `Event's references into other owners must be exactly ${EVENT_EXTERNAL_KEYS.join(', ')}; ` +
        `found ${external.map((row) => row.edge).join(', ')}.`,
    );

  const [ownership] = await session.query<{ inbound: number; columns: string | null }>(`
    SELECT
      (SELECT COUNT(*) FROM sys.foreign_keys
        WHERE referenced_object_id IN (${tables}) AND parent_object_id NOT IN (${tables})) AS inbound,
      (SELECT STRING_AGG(OBJECT_NAME(c.object_id) + N'.' + c.name, N',') FROM sys.columns c
        WHERE c.name LIKE N'%event%' AND c.object_id NOT IN (${tables})
          AND OBJECTPROPERTY(c.object_id, 'IsUserTable') = 1
          AND NOT (c.object_id = OBJECT_ID(N'[dbo].[ProviderEvent]') AND c.name = N'eventId')
          -- Phase 21: a newsletter consent event's own vocabulary column names
          -- what happened to a subscription, never an Editorial Event.
          AND NOT (OBJECT_NAME(c.object_id) = N'NewsletterConsentEvent' AND c.name = N'event')
          -- Phase 27: a payment provider's webhook event id and type, named by
          -- the provider, never an Editorial Event.
          AND NOT (OBJECT_NAME(c.object_id) = N'DonationProviderEvent'
                   AND c.name IN (N'eventId', N'eventType'))) AS columns;
  `);
  if (Number(ownership?.inbound) !== 0 || (ownership?.columns ?? null) !== null)
    fail(
      `No other owner may hold Event schema; found ${JSON.stringify(ownership ?? null)}.`,
    );

  const columns = await session.query<{
    name: string;
    type: string;
    nullable: boolean;
  }>(`
    SELECT OBJECT_NAME(c.object_id) + N'.' + c.name AS name, TYPE_NAME(c.user_type_id) AS type,
      c.is_nullable AS nullable
    FROM sys.columns c
    WHERE (c.object_id = OBJECT_ID(N'[dbo].[EventSchedule]')
           AND c.name IN (N'startsLocal', N'startsAt', N'endsLocal', N'endsAt'))
       OR (c.object_id = OBJECT_ID(N'[dbo].[EventRevision]') AND c.name IN (N'timezone', N'centreId'))
       OR (c.object_id = OBJECT_ID(N'[dbo].[EventGallery]') AND c.name = N'galleryId')
    ORDER BY name;
  `);
  const described = columns
    .map((row) => `${row.name}:${row.type}:${row.nullable ? 'null' : 'required'}`)
    .sort()
    .join(',');
  const expectedColumns = [
    'EventGallery.galleryId:nvarchar:required',
    'EventRevision.centreId:nvarchar:null',
    'EventRevision.timezone:nvarchar:required',
    'EventSchedule.endsAt:datetime2:null',
    'EventSchedule.endsLocal:datetime2:null',
    'EventSchedule.startsAt:datetime2:required',
    'EventSchedule.startsLocal:datetime2:required',
  ].join(',');
  if (described !== expectedColumns)
    fail(`Event time, zone and reference columns differ: ${described}.`);

  const unique = await session.query<{ name: string }>(`
    SELECT name FROM sys.key_constraints
    WHERE type = 'UQ' AND name IN (N'EventSchedule_ownerId_revisionNumber_startsAt_key',
                                   N'EventGallery_ownerId_revisionNumber_galleryId_key')
    ORDER BY name;
  `);
  if (unique.length !== 2)
    fail(
      `One start and one Gallery per revision must be UNIQUE constraints; found ${JSON.stringify(unique)}.`,
    );

  const [integrity] = await session.query<{ definition: string | null }>(`
    SELECT OBJECT_DEFINITION(OBJECT_ID(N'[dbo].[EventCurrentIntegrity]')) AS definition;
  `);
  const body = integrity?.definition ?? '';
  if (
    !['51142', '51143', '51146', '[dbo].[EventSchedule]'].every((word) =>
      body.includes(word),
    )
  )
    fail(
      'EventCurrentIntegrity does not refuse a current revision without an occurrence.',
    );

  const vocabularies = await session.query<{ name: string }>(`
    SELECT name FROM sys.check_constraints
    WHERE name IN (N'SearchIndexRequest_scopeKind_ck', N'SearchIndexScope_scopeKind_ck',
                   N'SearchDocument_kind_ck')
      AND [definition] LIKE N'%event%';
  `);
  if (vocabularies.length > 0)
    fail(
      `Events are not searchable in Phase 14; ${vocabularies.map((row) => row.name).join(', ')} names one.`,
    );

  // Phase 15 restates the same two descriptions once more; before it is
  // applied, and after its rollback, they are exactly Phase 14's.
  await assertEditorialDescriptions(session, descriptions);

  report(
    'event foundation',
    'eight typed tables, nine non-cascading external keys, no foreign Event schema, ' +
      'local and UTC times, 51146, no search kind',
  );
}

/**
 * After the Phase-14 rollback: no Event object, no Event reference into a
 * Centre or a Gallery, and the editorial descriptions exactly as Phase 13 left
 * them. The caller then proves the whole Phase-16 state is back.
 */
async function assertEventRemoved(session: SqlSession): Promise<void> {
  const [row] = await session.query<{
    tables: number;
    triggers: number;
    galleryKeys: number;
  }>(`
    SELECT
      (SELECT COUNT(*) FROM sys.tables WHERE name LIKE N'Event%') AS tables,
      (SELECT COUNT(*) FROM sys.triggers WHERE name LIKE N'Event%') AS triggers,
      (SELECT COUNT(*) FROM sys.foreign_keys
        WHERE referenced_object_id = OBJECT_ID(N'[dbo].[Gallery]')
          AND OBJECT_NAME(parent_object_id) NOT IN (N'GalleryLabel', N'GallerySlugHistory', N'GalleryItem')) AS galleryKeys;
  `);
  if (
    Number(row?.tables) !== 0 ||
    Number(row?.triggers) !== 0 ||
    Number(row?.galleryKeys) !== 0
  )
    fail(`The Phase-14 rollback left an Event object: ${JSON.stringify(row)}.`);
  await assertEditorialDescriptions(session, 'phase13');
  report('event rollback', 'every Event table, trigger and Gallery reference removed');
}

const COLLECTION_TABLES = [
  'Collection',
  'CollectionRevision',
  'CollectionRevisionTranslation',
  'CollectionTopic',
  'CollectionContributor',
  'CollectionItem',
  'CollectionSlugHistory',
];

/**
 * The seven member types of a Collection place: each its OWN nullable column,
 * its own non-cascading foreign key to its owner's table and its own filtered
 * unique index. The list is the whole of it — a type with no column here cannot
 * be a member at all.
 */
const COLLECTION_MEMBERS = [
  { column: 'articleId', table: 'Article', key: 'article' },
  { column: 'newsArticleId', table: 'NewsArticle', key: 'newsArticle' },
  { column: 'pressReleaseId', table: 'PressRelease', key: 'pressRelease' },
  { column: 'statementId', table: 'Statement', key: 'statement' },
  { column: 'mediaCoverageId', table: 'MediaCoverage', key: 'mediaCoverage' },
  { column: 'workId', table: 'Work', key: 'work' },
  { column: 'videoId', table: 'Video', key: 'video' },
] as const;

type CollectionMember = (typeof COLLECTION_MEMBERS)[number];

/**
 * EVERY foreign key from a Collection table to another owner's table, exactly:
 * the Article's seven editorial edges and the seven typed members. A fifteenth
 * edge — an image, a Page, an Event, a second reference to anything — fails.
 */
const COLLECTION_EXTERNAL_KEYS = [
  'CollectionContributor_personId_fkey>Person',
  'CollectionRevisionTranslation_languageCode_fkey>Language',
  'CollectionRevision_editorId_fkey>User',
  'CollectionTopic_topicId_fkey>Topic',
  'Collection_approvedById_fkey>User',
  'Collection_creatorId_fkey>User',
  'Collection_scheduledById_fkey>User',
  ...COLLECTION_MEMBERS.map(
    (member) => `CollectionItem_${member.column}_fkey>${member.table}`,
  ),
].sort();

/**
 * Each Collection trigger, the table it guards and the refusal numbers its body
 * raises: 51150 immutable history, 51151 no extension of a current or
 * historical revision, 51152 a valid current revision without self-approval,
 * 51153 a reserved canonical slug, 51154 revision sequence, 51155 no rewind and
 * 51156 a current revision with at least one member.
 */
const COLLECTION_TRIGGER_NUMBERS: Readonly<Record<string, readonly [string, string]>> = {
  CollectionRevisionImmutable: ['CollectionRevision', '51150'],
  CollectionRevisionTranslationImmutable: ['CollectionRevisionTranslation', '51150'],
  CollectionTopicImmutable: ['CollectionTopic', '51150'],
  CollectionContributorImmutable: ['CollectionContributor', '51150'],
  CollectionItemImmutable: ['CollectionItem', '51150'],
  CollectionSlugHistoryImmutable: ['CollectionSlugHistory', '51150'],
  CollectionRevisionTranslationAppend: ['CollectionRevisionTranslation', '51151'],
  CollectionTopicAppend: ['CollectionTopic', '51151'],
  CollectionContributorAppend: ['CollectionContributor', '51151'],
  CollectionItemAppend: ['CollectionItem', '51151'],
  CollectionCurrentIntegrity: ['Collection', '51152+51153+51156'],
  CollectionRevisionSequence: ['CollectionRevision', '51154'],
  CollectionRevisionForward: ['Collection', '51155'],
};

/**
 * Phase 15 — what only the catalogue can prove about Collections:
 *
 *   1. SEVEN DISTINCT TABLES, none generic: a place is exactly `ownerId`,
 *      `revisionNumber`, `position` and the seven typed, nullable member
 *      columns — no type, kind or target column, and no column for any type
 *      that is not a member (Page, Event, Gallery, Photo, Edition, Series,
 *      Playlist, audio, research, Quran, Hadith, Fatwa, Course, Centre) nor for
 *      a private list;
 *   2. no Phase-15 foreign key cascades, and the external edges are EXACTLY the
 *      fourteen above, each member key a single typed column — so no Collection
 *      write can delete, archive or change another owner's record;
 *   3. Library, Media and the News families own NO Collection schema: no
 *      foreign key from outside the Collection tables references one, and no
 *      column outside them names a collection;
 *   4. each member's filtered unique index keys (ownerId, revisionNumber,
 *      member) and filters on exactly that member being present;
 *   5. the position CHECK bounds one hundred places and the member CHECK
 *      counts all seven columns to exactly one;
 *   6. the 51156 rule — a current revision has a member — is in the integrity
 *      trigger, beside 51152 and 51153, and each of the thirteen triggers
 *      raises exactly its own numbers from 51150–51156;
 *   7. no search vocabulary names a collection: Collections are not searchable;
 *   8. the two editorial descriptions name collections, exactly, and no
 *      `collection.*` permission exists.
 *
 * The refusals themselves are proved as BEHAVIOUR by
 * `assertCollectionMembership`, and through the runtime login by
 * `db:test:permissions`.
 */
async function assertCollectionFoundation(session: SqlSession): Promise<void> {
  const tables = COLLECTION_TABLES.map((table) => `OBJECT_ID(N'[dbo].[${table}]')`).join(
    ',',
  );

  const shapes = await session.query<{ tableName: string; name: string }>(`
    SELECT OBJECT_NAME(c.object_id) AS tableName, c.name FROM sys.columns c
    WHERE c.object_id IN (${tables})
      AND (c.name LIKE N'%type%' OR c.name LIKE N'%kind%' OR c.name LIKE N'%target%'
           OR c.name LIKE N'%page%' OR c.name LIKE N'%event%' OR c.name LIKE N'%gallery%'
           OR c.name LIKE N'%photo%' OR c.name LIKE N'%image%' OR c.name LIKE N'%asset%'
           OR c.name LIKE N'%edition%' OR c.name LIKE N'%booktranslation%'
           OR c.name LIKE N'%series%' OR c.name LIKE N'%playlist%' OR c.name LIKE N'%audio%'
           OR c.name LIKE N'%research%' OR c.name LIKE N'%publication%' OR c.name LIKE N'%magazine%'
           OR c.name LIKE N'%encyclopedia%' OR c.name LIKE N'%quran%' OR c.name LIKE N'%hadith%'
           OR c.name LIKE N'%fatwa%' OR c.name LIKE N'%course%' OR c.name LIKE N'%centre%'
           OR c.name LIKE N'%center%' OR c.name LIKE N'%private%' OR c.name LIKE N'%featured%'
           OR c.name LIKE N'%popular%' OR c.name LIKE N'%count%')
    ORDER BY tableName, c.name;
  `);
  if (shapes.length > 0)
    fail(
      `Collection tables may hold no generic, untyped or non-member reference column; ` +
        `found ${JSON.stringify(shapes)}.`,
    );

  const placeColumns = await session.query<{
    name: string;
    type: string;
    nullable: boolean;
  }>(`
    SELECT c.name, TYPE_NAME(c.user_type_id) AS type, c.is_nullable AS nullable
    FROM sys.columns c WHERE c.object_id = OBJECT_ID(N'[dbo].[CollectionItem]')
    ORDER BY c.column_id;
  `);
  const describedPlace = placeColumns
    .map((row) => `${row.name}:${row.type}:${row.nullable ? 'null' : 'required'}`)
    .join(',');
  const expectedPlace = [
    'ownerId:nvarchar:required',
    'revisionNumber:int:required',
    'position:int:required',
    ...COLLECTION_MEMBERS.map((member) => `${member.column}:nvarchar:null`),
  ].join(',');
  if (describedPlace !== expectedPlace)
    fail(
      `A Collection place must be exactly its key and seven typed members; found ${describedPlace}.`,
    );

  const cascading = await session.query<{ name: string }>(`
    SELECT name FROM sys.foreign_keys
    WHERE parent_object_id IN (${tables})
      AND (delete_referential_action <> 0 OR update_referential_action <> 0);
  `);
  if (cascading.length > 0)
    fail(
      `Phase-15 foreign keys must not cascade; found ${cascading.map((row) => row.name).join(', ')}.`,
    );

  const external = await session.query<{ edge: string; columns: number }>(`
    SELECT fk.name + N'>' + OBJECT_NAME(fk.referenced_object_id) AS edge,
      (SELECT COUNT(*) FROM sys.foreign_key_columns c WHERE c.constraint_object_id = fk.object_id) AS columns
    FROM sys.foreign_keys fk
    WHERE fk.parent_object_id IN (${tables}) AND fk.referenced_object_id NOT IN (${tables});
  `);
  const edges = external.map((row) => row.edge).sort();
  if (edges.join(',') !== COLLECTION_EXTERNAL_KEYS.join(','))
    fail(
      `Collection's references into other owners must be exactly ${COLLECTION_EXTERNAL_KEYS.join(', ')}; ` +
        `found ${edges.join(', ')}.`,
    );
  if (external.some((row) => Number(row.columns) !== 1))
    fail(
      `Every Collection reference into another owner must be ONE typed column; found ${JSON.stringify(external)}.`,
    );

  // Phase 19's `HadithCollection` is a DIFFERENT aggregate that shares the
  // word: the Hadith context's own namespace of collections, named by its own
  // tables' `collectionId` columns and keyed only to its own tables (the
  // inbound count above stays zero, and `assertHadithFoundation` proves those
  // tables reach no Editorial table). Only those tables are set aside here.
  // By NAME, never OBJECT_ID: once Phase 19 is rolled back an OBJECT_ID is
  // NULL, and NOT IN over a NULL would silently excuse every column.
  //
  // Phase 21's `PrivateCollection` is likewise a DIFFERENT aggregate: a
  // person's own list, keyed only to Personalisation's tables and to User,
  // never to an Editorial Collection (`assertPersonalisationFoundation` proves
  // its exact keys). Its two tables are set aside by name for the same reason.
  const setAside = [...HADITH_TABLES, 'PrivateCollection', 'PrivateCollectionItem']
    .map((table) => `N'${table}'`)
    .join(',');
  const [ownership] = await session.query<{ inbound: number; columns: string | null }>(`
    SELECT
      (SELECT COUNT(*) FROM sys.foreign_keys
        WHERE referenced_object_id IN (${tables}) AND parent_object_id NOT IN (${tables})) AS inbound,
      (SELECT STRING_AGG(OBJECT_NAME(c.object_id) + N'.' + c.name, N',') FROM sys.columns c
        WHERE c.name LIKE N'%collection%' AND c.object_id NOT IN (${tables})
          AND OBJECT_NAME(c.object_id) NOT IN (${setAside})
          AND OBJECTPROPERTY(c.object_id, 'IsUserTable') = 1) AS columns;
  `);
  if (Number(ownership?.inbound) !== 0 || (ownership?.columns ?? null) !== null)
    fail(
      `No other owner may hold Collection schema; found ${JSON.stringify(ownership ?? null)}.`,
    );

  const indexes = await session.query<{
    name: string;
    filter: string | null;
    keys: string | null;
  }>(`
    SELECT i.name, i.filter_definition AS filter,
      (SELECT STRING_AGG(COL_NAME(ic.object_id, ic.column_id), N',') WITHIN GROUP (ORDER BY ic.key_ordinal)
        FROM sys.index_columns ic
        WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id AND ic.key_ordinal > 0) AS keys
    FROM sys.indexes i
    WHERE i.object_id = OBJECT_ID(N'[dbo].[CollectionItem]') AND i.is_unique = 1
      AND i.has_filter = 1
    ORDER BY i.name;
  `);
  const describedIndexes = indexes
    .map((row) => `${row.name}(${row.keys ?? ''})${row.filter ?? ''}`)
    .sort()
    .join(',');
  const expectedIndexes = COLLECTION_MEMBERS.map(
    (member) =>
      `CollectionItem_${member.key}_key(ownerId,revisionNumber,${member.column})` +
      `([${member.column}] IS NOT NULL)`,
  )
    .sort()
    .join(',');
  if (describedIndexes !== expectedIndexes)
    fail(
      `Each member must be unique per revision through its own filtered index; ` +
        `found ${describedIndexes}.`,
    );

  const checks = await session.query<{ name: string; definition: string }>(`
    SELECT name, definition FROM sys.check_constraints
    WHERE parent_object_id = OBJECT_ID(N'[dbo].[CollectionItem]') ORDER BY name;
  `);
  const position = checks.find((row) => row.name === 'CollectionItem_position_ck');
  const member = checks.find((row) => row.name === 'CollectionItem_one_member_ck');
  if (
    checks.length !== 2 ||
    !position?.definition.includes('>=(0)') ||
    !position.definition.includes('<=(99)') ||
    !member?.definition.endsWith('=(1))') ||
    !COLLECTION_MEMBERS.every((entry) => member.definition.includes(`[${entry.column}]`))
  )
    fail(
      `A place must be bounded to 0..99 and hold exactly one of the seven members; ` +
        `found ${JSON.stringify(checks)}.`,
    );

  const [integrity] = await session.query<{ definition: string | null }>(`
    SELECT OBJECT_DEFINITION(OBJECT_ID(N'[dbo].[CollectionCurrentIntegrity]')) AS definition;
  `);
  const body = integrity?.definition ?? '';
  if (
    !['51152', '51153', '51156', '[dbo].[CollectionItem]'].every((word) =>
      body.includes(word),
    )
  )
    fail(
      'CollectionCurrentIntegrity does not refuse a current revision without a member.',
    );

  // Every Collection trigger raises exactly ITS OWN numbers from 51150–51156 —
  // never another aggregate's — and the thirteen are the whole set, each on the
  // table it guards.
  const triggers = await session.query<{
    name: string;
    tableName: string;
    definition: string | null;
  }>(`
    SELECT t.name, OBJECT_NAME(t.parent_id) AS tableName,
      OBJECT_DEFINITION(t.object_id) AS definition
    FROM sys.triggers t WHERE t.parent_id IN (${tables}) ORDER BY t.name;
  `);
  const describedTriggers = triggers
    .map((row) => {
      const numbers = [...new Set((row.definition ?? '').match(/\b5\d{4}\b/gu) ?? [])]
        .sort()
        .join('+');
      return `${row.name}@${row.tableName}:${numbers}`;
    })
    .join(',');
  const expectedTriggers = Object.entries(COLLECTION_TRIGGER_NUMBERS)
    .map(([name, [table, numbers]]) => `${name}@${table}:${numbers}`)
    .sort()
    .join(',');
  if (describedTriggers !== expectedTriggers)
    fail(
      `Collection triggers must raise exactly their own 5115x numbers; found ${describedTriggers}.`,
    );

  const vocabularies = await session.query<{ name: string }>(`
    SELECT name FROM sys.check_constraints
    WHERE name IN (N'SearchIndexRequest_scopeKind_ck', N'SearchIndexScope_scopeKind_ck',
                   N'SearchDocument_kind_ck')
      AND [definition] LIKE N'%collection%';
  `);
  if (vocabularies.length > 0)
    fail(
      `Collections are not searchable in Phase 15; ${vocabularies.map((row) => row.name).join(', ')} names one.`,
    );

  await assertEditorialDescriptions(session, 'phase15');

  report(
    'collection foundation',
    'seven typed tables, one place of seven typed members, fourteen non-cascading ' +
      'external keys, seven filtered member keys, 51156, no search kind',
  );
}

/**
 * After the Phase-15 rollback: no Collection object and no member reference
 * into an Article, a News record, a Work or a Video, and the editorial
 * descriptions exactly as Phase 14 left them. The caller then proves the whole
 * Phase-14 state is back.
 */
async function assertCollectionRemoved(session: SqlSession): Promise<void> {
  const [row] = await session.query<{
    tables: number;
    triggers: number;
    memberKeys: number;
    memberIndexes: number;
  }>(`
    SELECT
      (SELECT COUNT(*) FROM sys.tables WHERE name LIKE N'Collection%') AS tables,
      (SELECT COUNT(*) FROM sys.triggers WHERE name LIKE N'Collection%') AS triggers,
      (SELECT COUNT(*) FROM sys.foreign_keys WHERE name LIKE N'Collection%') AS memberKeys,
      (SELECT COUNT(*) FROM sys.indexes WHERE name LIKE N'Collection%') AS memberIndexes;
  `);
  if (
    Number(row?.tables) !== 0 ||
    Number(row?.triggers) !== 0 ||
    Number(row?.memberKeys) !== 0 ||
    Number(row?.memberIndexes) !== 0
  )
    fail(`The Phase-15 rollback left a Collection object: ${JSON.stringify(row)}.`);
  await assertEditorialDescriptions(session, 'phase14');
  report(
    'collection rollback',
    'every Collection table, trigger, index and member key removed',
  );
}

interface SqlFailure {
  readonly number: number | undefined;
  readonly message: string;
}

/** Runs a statement; returns how SQL Server refused it, or null if it succeeded. */
async function attempt(
  session: SqlSession,
  statement: string,
): Promise<SqlFailure | null> {
  try {
    await session.query(statement);
    return null;
  } catch (error) {
    return {
      number: (error as { number?: number }).number,
      message: (error as Error).message,
    };
  }
}

/**
 * Asserts a statement is refused by ONE named rule: an expected error number
 * AND the rule's own name (a constraint, an index, a column, or a trigger's
 * message) in the engine's text. Every foreign key and CHECK raises 547, so the
 * number alone could not tell the member key from the position bound.
 */
async function expectRefusal(
  session: SqlSession,
  label: string,
  statement: string,
  numbers: readonly number[],
  rule: string,
): Promise<void> {
  const failure = await attempt(session, statement);
  if (failure === null)
    fail(`${label}: the statement SUCCEEDED but ${rule} must refuse it.`);
  if (
    failure.number === undefined ||
    !numbers.includes(failure.number) ||
    !failure.message.includes(rule)
  )
    fail(
      `${label}: refused for the WRONG reason (error ${String(failure.number ?? 'unknown')}): ` +
        `${failure.message.split('\n')[0] ?? ''}`,
    );
}

async function expectAccepted(
  session: SqlSession,
  label: string,
  statement: string,
): Promise<void> {
  const failure = await attempt(session, statement);
  if (failure !== null)
    fail(
      `${label}: must be accepted but failed: ${failure.message.split('\n')[0] ?? ''}`,
    );
}

/**
 * Phase 15 — MIXED, ORDERED, TYPED MEMBERSHIP, proved as behaviour against the
 * re-deployed schema, with synthetic rows only.
 *
 *   - one Collection gathers all seven member types in ONE mixed order, which
 *     reads back exactly, and a later revision reorders them while the earlier
 *     revision's order stays as it was;
 *   - two members of ANY types never share a place; one record is never a
 *     member of one revision twice, for every type; a place with no member or
 *     with two is refused; an identifier that exists only in ANOTHER owner's
 *     table is refused by the column's own foreign key; place 100 and place -1
 *     are refused and place 99 is accepted; a type with no column — Page,
 *     Event, Gallery, Photo, Edition, Series, Playlist, audio, research, Fatwa,
 *     or a `targetType`/`targetId` pair — cannot even be named;
 *   - 51150: a place is never updated or deleted, 51151: a current or
 *     historical revision gains no member, 51156: a revision with no member
 *     never becomes current;
 *   - removing a member (a new revision without it) and archiving the
 *     Collection change no target row; deleting a target that is or was a
 *     member is refused by its member key; and withdrawing targets changes no
 *     Collection row.
 */
async function assertCollectionMembership(session: SqlSession): Promise<void> {
  const run = randomUUID().replaceAll('-', '').slice(0, 16);
  const creator = randomUUID();
  const reviewer = randomUUID();
  for (const user of [creator, reviewer])
    await session.query(
      `INSERT INTO [dbo].[User] ([id],[name],[email],[emailVerified],[createdAt],[updatedAt],[locale],[status],[twoFactorEnabled]) VALUES (N'${user}',N'Synthetic collection proof user',N'${user}@proof.invalid',0,SYSUTCDATETIME(),SYSUTCDATETIME(),N'en',N'active',0);`,
    );

  // TWO synthetic targets of each member type, written as their owners write
  // them: editorial records as drafts with no revision, a Work and a Video
  // published (their slugs reserved by their owners' own triggers).
  const targets = Object.fromEntries(
    COLLECTION_MEMBERS.map((member) => [member.key, [randomUUID(), randomUUID()]]),
  ) as Record<CollectionMember['key'], [string, string]>;
  for (const member of COLLECTION_MEMBERS)
    for (const [index, id] of targets[member.key].entries()) {
      const slug = `proof-collection-${member.key.toLowerCase()}-${String(index)}-${run}`;
      const statement =
        member.table === 'Work'
          ? `INSERT INTO [dbo].[Work] ([id],[slug],[primaryLocale],[state]) VALUES (N'${id}',N'${slug}',N'en',N'published');`
          : member.table === 'Video'
            ? `INSERT INTO [dbo].[Video] ([id],[slug],[primaryLocale],[state],[provider],[providerVideoId],[availability],[languageCode]) VALUES (N'${id}',N'${slug}',N'en',N'published',N'youtube','proofVideo${index === 0 ? 'A' : 'B'}',N'available',N'en');`
            : `INSERT INTO [dbo].[${member.table}] ([id],[slug],[state],[version],[creatorId],[updatedAt]) VALUES (N'${id}',N'${slug}',N'draft',1,N'${creator}',SYSUTCDATETIME());`;
      await expectAccepted(session, `${member.table} synthetic target`, statement);
    }
  const first = (member: CollectionMember): string => targets[member.key][0];
  const second = (member: CollectionMember): string => targets[member.key][1];

  const targetRows = async (): Promise<string> => {
    const rows: unknown[] = [];
    for (const member of COLLECTION_MEMBERS)
      rows.push(
        await session.query(
          `SELECT * FROM [dbo].[${member.table}] WHERE [id] IN (N'${first(member)}',N'${second(member)}') ORDER BY [id];`,
        ),
      );
    return JSON.stringify(rows);
  };

  const collection = randomUUID();
  const slug = `proof-collection-${run}`;
  const revision = (number: number, editor: string): string =>
    `INSERT INTO [dbo].[CollectionRevision] ([ownerId],[number],[editorId],[slug],[primaryLanguage]) VALUES (N'${collection}',${number},N'${editor}',N'${slug}',N'en');
     INSERT INTO [dbo].[CollectionRevisionTranslation] ([ownerId],[revisionNumber],[languageCode],[title],[excerpt],[seoTitle],[seoDescription],[document],[html]) VALUES (N'${collection}',${number},N'en',N'Synthetic collection proof',N'',N'',N'',N'{"type":"doc","content":[]}',N'<p></p>');`;
  const place = (
    number: number,
    position: number,
    members: Partial<Record<string, string>>,
    owner = collection,
  ): string => {
    const columns = Object.keys(members);
    const values = Object.values(members).map((value) => `N'${value ?? ''}'`);
    return `INSERT INTO [dbo].[CollectionItem] ([ownerId],[revisionNumber],[position]${columns.map((column) => `,[${column}]`).join('')}) VALUES (N'${owner}',${number},${position}${values.map((value) => `,${value}`).join('')});`;
  };
  const moveTo = (number: number, extra = ''): string =>
    `UPDATE [dbo].[Collection] SET [currentRevision]=${number},[version]=[version]+1,[updatedAt]=SYSUTCDATETIME()${extra} WHERE [id]=N'${collection}';`;
  const order = async (number: number): Promise<string> => {
    const rows = await session.query<{ position: number; member: string }>(`
      SELECT [position], ${COLLECTION_MEMBERS.map(
        (member) =>
          `CASE WHEN [${member.column}] IS NOT NULL THEN N'${member.key}:' + [${member.column}] ELSE N'' END`,
      ).join(' + ')} AS [member]
      FROM [dbo].[CollectionItem] WHERE [ownerId]=N'${collection}' AND [revisionNumber]=${number}
      ORDER BY [position];
    `);
    return rows.map((row) => `${String(row.position)}=${row.member}`).join(',');
  };
  const expectedOrder = (
    members: readonly (readonly [number, CollectionMember, string])[],
  ) =>
    members
      .map(([position, member, id]) => `${String(position)}=${member.key}:${id}`)
      .join(',');

  // ---- ONE mixed order across all seven types --------------------------------
  const [
    article,
    newsArticle,
    pressRelease,
    statementFamily,
    mediaCoverage,
    work,
    video,
  ] = COLLECTION_MEMBERS;
  const firstOrder = [
    [0, video, first(video)],
    [1, article, first(article)],
    [2, work, first(work)],
    [3, statementFamily, first(statementFamily)],
    [4, newsArticle, first(newsArticle)],
    [5, mediaCoverage, first(mediaCoverage)],
    [6, pressRelease, first(pressRelease)],
  ] as const;
  await expectAccepted(
    session,
    'A Collection with seven member types in one order',
    `INSERT INTO [dbo].[Collection] ([id],[slug],[state],[version],[creatorId],[updatedAt]) VALUES (N'${collection}',N'${slug}',N'draft',1,N'${creator}',SYSUTCDATETIME());
     INSERT INTO [dbo].[CollectionSlugHistory] ([ownerId],[slug]) VALUES (N'${collection}',N'${slug}');
     ${revision(1, creator)}
     ${firstOrder.map(([position, member, id]) => place(1, position, { [member.column]: id })).join('\n')}
     ${moveTo(1)}`,
  );
  if ((await order(1)) !== expectedOrder(firstOrder))
    fail(`The mixed order did not read back exactly: ${await order(1)}.`);

  // ---- a current revision is history -----------------------------------------
  let refusals = 0;
  const refuse = async (
    label: string,
    statement: string,
    numbers: readonly number[],
    rule: string,
  ): Promise<void> => {
    await expectRefusal(session, label, statement, numbers, rule);
    refusals += 1;
  };
  const IMMUTABLE = 'Editorial history is immutable.';
  const HISTORICAL = 'A historical revision cannot be extended.';
  await refuse(
    'A current revision gains no member',
    place(1, 7, { articleId: second(article) }),
    [51151],
    HISTORICAL,
  );
  await refuse(
    'A place is never reordered in place',
    `UPDATE [dbo].[CollectionItem] SET [position]=[position]+10 WHERE [ownerId]=N'${collection}';`,
    [51150],
    IMMUTABLE,
  );
  await refuse(
    'A place never changes its member',
    `UPDATE [dbo].[CollectionItem] SET [articleId]=N'${second(article)}' WHERE [ownerId]=N'${collection}' AND [position]=1;`,
    [51150],
    IMMUTABLE,
  );
  await refuse(
    'A member is never deleted from a revision',
    `DELETE FROM [dbo].[CollectionItem] WHERE [ownerId]=N'${collection}' AND [position]=2;`,
    [51150],
    IMMUTABLE,
  );

  // ---- the next revision: every rule of a place ------------------------------
  await expectAccepted(session, 'The next Collection revision', revision(2, creator));
  const secondOrder = [...firstOrder]
    .reverse()
    .map(([, member, id], position) => [position, member, id] as const);
  await expectAccepted(
    session,
    'The same seven members, reordered',
    secondOrder
      .map(([position, member, id]) => place(2, position, { [member.column]: id }))
      .join('\n'),
  );
  await refuse(
    'Two members never share a place',
    place(2, 0, { articleId: second(article) }),
    [2627],
    'CollectionItem_pkey',
  );
  for (const [index, member] of COLLECTION_MEMBERS.entries()) {
    await refuse(
      `One ${member.table} is a member once`,
      place(2, 10 + index, { [member.column]: first(member) }),
      [2601],
      `CollectionItem_${member.key}_key`,
    );
    // An identifier that exists — in ANOTHER owner's table. The column's own
    // key refuses it, so a member is always a row of its own type.
    const other = COLLECTION_MEMBERS[(index + 1) % COLLECTION_MEMBERS.length];
    if (other === undefined) fail('The member inventory is empty.');
    await refuse(
      `A ${member.table} member is a ${member.table}`,
      place(2, 30 + index, { [member.column]: second(other) }),
      [547],
      `CollectionItem_${member.column}_fkey`,
    );
  }
  await refuse(
    'A place holds a member',
    place(2, 20, {}),
    [547],
    'CollectionItem_one_member_ck',
  );
  await refuse(
    'A place holds one member',
    place(2, 21, { articleId: second(article), workId: second(work) }),
    [547],
    'CollectionItem_one_member_ck',
  );
  await refuse(
    'A Collection holds at most one hundred places',
    place(2, 100, { articleId: second(article) }),
    [547],
    'CollectionItem_position_ck',
  );
  await refuse(
    'A place is never negative',
    place(2, -1, { articleId: second(article) }),
    [547],
    'CollectionItem_position_ck',
  );
  await refuse(
    'A place belongs to a real revision',
    place(9, 0, { articleId: second(article) }),
    [547],
    'CollectionItem_ownerId_revisionNumber_fkey',
  );
  for (const column of [
    'pageId',
    'eventId',
    'galleryId',
    'photoId',
    'editionId',
    'bookTranslationId',
    'seriesId',
    'playlistId',
    'audioTrackId',
    'audioSeriesId',
    'researchId',
    'fatwaId',
    'targetType',
    'targetId',
  ])
    await refuse(
      `No ${column} member exists`,
      `INSERT INTO [dbo].[CollectionItem] ([ownerId],[revisionNumber],[position],[${column}]) VALUES (N'${collection}',2,40,N'${randomUUID()}');`,
      [207],
      column,
    );
  await expectAccepted(
    session,
    'The hundredth place',
    place(2, 99, { articleId: second(article) }),
  );
  await expectAccepted(session, 'The reordered revision becomes current', moveTo(2));
  const expectedSecond = expectedOrder([
    ...secondOrder,
    [99, article, second(article)] as const,
  ]);
  if ((await order(2)) !== expectedSecond)
    fail(`The reordered revision did not read back exactly: ${await order(2)}.`);
  if ((await order(1)) !== expectedOrder(firstOrder))
    fail('Reordering in a new revision changed the earlier revision.');
  await refuse(
    'A historical revision gains no member',
    place(1, 8, { articleId: second(article) }),
    [51151],
    HISTORICAL,
  );
  await expectAccepted(
    session,
    'Independent approval and publication',
    `UPDATE [dbo].[Collection] SET [approvedRevision]=2,[approvedById]=N'${reviewer}',[state]=N'published',[publishedAt]=SYSUTCDATETIME(),[version]=[version]+1 WHERE [id]=N'${collection}';`,
  );

  // ---- 51156: an empty set never becomes current -----------------------------
  const empty = randomUUID();
  const emptySlug = `proof-collection-empty-${run}`;
  await expectAccepted(
    session,
    'A Collection revision with no member yet',
    `INSERT INTO [dbo].[Collection] ([id],[slug],[state],[version],[creatorId],[updatedAt]) VALUES (N'${empty}',N'${emptySlug}',N'draft',1,N'${creator}',SYSUTCDATETIME());
     INSERT INTO [dbo].[CollectionSlugHistory] ([ownerId],[slug]) VALUES (N'${empty}',N'${emptySlug}');
     INSERT INTO [dbo].[CollectionRevision] ([ownerId],[number],[editorId],[slug],[primaryLanguage]) VALUES (N'${empty}',1,N'${creator}',N'${emptySlug}',N'en');
     INSERT INTO [dbo].[CollectionRevisionTranslation] ([ownerId],[revisionNumber],[languageCode],[title],[excerpt],[seoTitle],[seoDescription],[document],[html]) VALUES (N'${empty}',1,N'en',N'Synthetic empty collection proof',N'',N'',N'',N'{"type":"doc","content":[]}',N'<p></p>');`,
  );
  const moveEmpty = `UPDATE [dbo].[Collection] SET [currentRevision]=1,[version]=2 WHERE [id]=N'${empty}';`;
  await refuse(
    'A current Collection revision has a member',
    moveEmpty,
    [51156],
    'A Collection revision must have a member.',
  );
  await expectAccepted(
    session,
    'One member, then current',
    `${place(1, 0, { workId: first(work) }, empty)}
     ${moveEmpty}`,
  );

  // ---- membership and archive never reach a target ---------------------------
  const targetsBefore = await targetRows();
  await expectAccepted(
    session,
    'A member removed by a new revision',
    `${revision(3, creator)}
     ${place(3, 0, { articleId: first(article) })}
     ${place(3, 1, { videoId: first(video) })}
     ${moveTo(3, ",[approvedRevision]=NULL,[approvedById]=NULL,[state]=N'draft'")}`,
  );
  await expectAccepted(
    session,
    'The Collection archived',
    `UPDATE [dbo].[Collection] SET [state]=N'archived',[version]=[version]+1 WHERE [id]=N'${collection}';`,
  );
  if ((await targetRows()) !== targetsBefore)
    fail('Removing a member or archiving a Collection changed a target row.');
  // A Work and a Video also hold their owner's permanent slug reservation, so
  // deleting one conflicts with TWO keys, and SQL Server names whichever its
  // plan checks first — an order that follows object identifiers, which shift
  // whenever a later migration creates objects, never the schema itself. Every
  // OTHER key into the target's table is therefore set aside for that one
  // statement, so the refusal can only be the member key's, and is restored
  // WITH CHECK — re-validated and trusted — whatever the statement did.
  for (const member of COLLECTION_MEMBERS) {
    const competitors = await session.query<{ name: string; parent: string }>(`
      SELECT fk.[name], OBJECT_NAME(fk.[parent_object_id]) AS [parent] FROM sys.foreign_keys fk
      WHERE fk.[referenced_object_id] = OBJECT_ID(N'[dbo].[${member.table}]')
        AND fk.[name] <> N'CollectionItem_${member.column}_fkey';
    `);
    const toggle = (mode: 'NOCHECK' | 'WITH CHECK CHECK'): string =>
      competitors
        .map(
          (key) => `ALTER TABLE [dbo].[${key.parent}] ${mode} CONSTRAINT [${key.name}];`,
        )
        .join('\n');
    try {
      if (competitors.length > 0) await session.query(toggle('NOCHECK'));
      await refuse(
        `A ${member.table} that is a member is never deleted`,
        `DELETE FROM [dbo].[${member.table}] WHERE [id]=N'${first(member)}';`,
        [547],
        `CollectionItem_${member.column}_fkey`,
      );
    } finally {
      if (competitors.length > 0) await session.query(toggle('WITH CHECK CHECK'));
    }
  }
  const untrusted = await session.query<{ name: string }>(`
    SELECT [name] FROM sys.foreign_keys
    WHERE [referenced_object_id] IN (${COLLECTION_MEMBERS.map((member) => `OBJECT_ID(N'[dbo].[${member.table}]')`).join(',')})
      AND ([is_disabled] = 1 OR [is_not_trusted] = 1);
  `);
  if (untrusted.length > 0)
    fail(
      `A key set aside for a member proof was not restored: ${untrusted.map((row) => row.name).join(', ')}.`,
    );
  if ((await targetRows()) !== targetsBefore)
    fail('A refused target deletion changed a target row.');

  const collectionRows = async (): Promise<string> =>
    JSON.stringify([
      await session.query(
        `SELECT * FROM [dbo].[Collection] WHERE [id] IN (N'${collection}',N'${empty}') ORDER BY [id];`,
      ),
      await session.query(
        `SELECT * FROM [dbo].[CollectionItem] WHERE [ownerId] IN (N'${collection}',N'${empty}') ORDER BY [ownerId],[revisionNumber],[position];`,
      ),
    ]);
  const collectionsBefore = await collectionRows();
  await expectAccepted(
    session,
    'Targets withdrawn by their owners',
    `UPDATE [dbo].[Work] SET [state]=N'archived',[version]=[version]+1 WHERE [id]=N'${first(work)}';
     UPDATE [dbo].[Video] SET [state]=N'archived',[version]=[version]+1 WHERE [id]=N'${first(video)}';
     UPDATE [dbo].[Article] SET [state]=N'archived',[version]=[version]+1 WHERE [id]=N'${first(article)}';`,
  );
  if ((await collectionRows()) !== collectionsBefore)
    fail('Withdrawing a target changed a Collection row.');

  report(
    'collection membership',
    `seven types in one mixed order, reordered by revision; ${String(refusals)} refusals ` +
      'by name; no cascade either way',
  );
}

const QURAN_PERMISSIONS = ['quran.administer', 'quran.editCanonical', 'quran.read'];

/**
 * EVERY foreign key from a Quran table to another owner's table, exactly: the
 * content languages, the contributors and the reciter, the Topic and the audio
 * file. None names a User — a canonical revision's actor and step-up grant are
 * HISTORICAL identifiers that must outlive the rows they name (DOMAIN_MODEL.md
 * §6.2.1) — and none names Media, Library, Editorial or Hadith.
 */
const QURAN_EXTERNAL_KEYS = [
  'QuranRecitationSegment_assetId_fkey>Asset',
  'QuranRecitation_personId_fkey>Person',
  'QuranTafsirContributor_personId_fkey>Person',
  'QuranTafsir_languageCode_fkey>Language',
  'QuranTajweedRuleText_languageCode_fkey>Language',
  'QuranTopic_topicId_fkey>Topic',
  'QuranTranslationContributor_personId_fkey>Person',
  'QuranTranslation_languageCode_fkey>Language',
  'QuranTransliteration_languageCode_fkey>Language',
].sort();

/**
 * Every reference to an Ayah, and the only ones: each the canonical citation
 * itself, `(surahNumber, ayahNumber)`, never a surrogate that could drift.
 */
const QURAN_AYAH_KEYS = [
  'QuranAyahRevision_ayah_fkey',
  'QuranRecitationSegment_end_fkey',
  'QuranRecitationSegment_start_fkey',
  'QuranTafsirText_end_fkey',
  'QuranTafsirText_start_fkey',
  'QuranTopic_ayah_fkey',
  'QuranTranslationText_ayah_fkey',
  'QuranTransliterationText_ayah_fkey',
].sort();

/** The numbers a trigger or procedure body raises, sorted and joined. */
function raisedNumbers(definition: string | null): string {
  return [...new Set((definition ?? '').match(/\b5\d{4}\b/gu) ?? [])].sort().join('+');
}

/**
 * Phase 18 — what only the catalogue can prove about the Quran:
 *
 *   1. NOTHING IS SEEDED: all twenty-three tables are empty after deploy. The
 *      authoritative source is an open external decision (OPEN_DECISIONS.md
 *      §1.1, §1.2), so a migrated database holds an EMPTY corpus;
 *   2. the canonical citation IS the identity: Ayah's key is exactly
 *      `(surahNumber, ayahNumber)`, its history's key adds only the version, no
 *      canonical table has a surrogate `id`, and every reference to an Ayah —
 *      exactly eight — is that two-column citation;
 *   3. no Quran foreign key cascades, its references into other owners are
 *      EXACTLY the nine above, no other owner references a Quran table or
 *      holds a Surah, Ayah, Juz, tafsir or tajweed column, and no Quran table
 *      carries a type or target column (the evidence's own `kind` aside);
 *   4. canonical text is NVARCHAR in all three places it lives, and every
 *      layered text is NVARCHAR(MAX);
 *   5. each of the twenty-five triggers and four procedures raises exactly its
 *      own numbers from 51180–51199, on the table it guards;
 *   6. the Quran vocabulary is exactly three keys, all in the protected bundle.
 *
 * The rules themselves are proved as BEHAVIOUR by `assertQuranCanonicalRules`,
 * and through the runtime login by `db:test:permissions`.
 */
async function assertQuranFoundation(session: SqlSession): Promise<void> {
  const tables = QURAN_TABLES.map((table) => `OBJECT_ID(N'[dbo].[${table}]')`).join(',');
  const names = QURAN_TABLES.map((table) => `N'${table}'`).join(',');

  // ---- 1. an EMPTY corpus ---------------------------------------------------
  const counts = await session.query<{ name: string; total: number }>(
    QURAN_TABLES.map(
      (table) =>
        `SELECT N'${table}' AS [name], COUNT_BIG(*) AS [total] FROM [dbo].[${table}]`,
    ).join(' UNION ALL ') + ';',
  );
  const seeded = counts.filter((row) => Number(row.total) !== 0);
  if (QURAN_TABLES.length !== 23 || counts.length !== 23 || seeded.length > 0)
    fail(
      `The Quran migration must create twenty-three empty tables and seed no content; ` +
        `found ${String(counts.length)} tables, seeded: ${JSON.stringify(seeded)}.`,
    );

  // ---- 2. the canonical citation is the identity -----------------------------
  const keys = await session.query<{ name: string; columns: string }>(`
    SELECT kc.[name], STRING_AGG(COL_NAME(ic.[object_id], ic.[column_id]), N',')
      WITHIN GROUP (ORDER BY ic.[key_ordinal]) AS [columns]
    FROM sys.key_constraints kc
    JOIN sys.index_columns ic ON ic.[object_id] = kc.[parent_object_id] AND ic.[index_id] = kc.[unique_index_id]
    WHERE kc.[type] = 'PK' AND ic.[key_ordinal] > 0
      AND kc.[name] IN (N'Juz_pkey', N'Surah_pkey', N'Ayah_pkey', N'QuranAyahRevision_pkey',
                        N'QuranSourceAyah_pkey', N'QuranTopic_pkey')
    GROUP BY kc.[name];
  `);
  const describedKeys = keys
    .map((row) => `${row.name}(${row.columns})`)
    .sort()
    .join(',');
  const expectedKeys = [
    'Ayah_pkey(surahNumber,ayahNumber)',
    'Juz_pkey(number)',
    'QuranAyahRevision_pkey(surahNumber,ayahNumber,version)',
    'QuranSourceAyah_pkey(sourceId,surahNumber,ayahNumber)',
    'QuranTopic_pkey(surahNumber,ayahNumber,topicId)',
    'Surah_pkey(number)',
  ].join(',');
  if (describedKeys !== expectedKeys)
    fail(`The canonical citation must be the identity; found ${describedKeys}.`);

  const surrogates = await session.query<{ name: string }>(`
    SELECT OBJECT_NAME(c.[object_id]) + N'.' + c.[name] AS [name] FROM sys.columns c
    WHERE c.[name] = N'id' AND c.[object_id] IN (OBJECT_ID(N'[dbo].[Juz]'), OBJECT_ID(N'[dbo].[Surah]'),
      OBJECT_ID(N'[dbo].[Ayah]'), OBJECT_ID(N'[dbo].[QuranAyahRevision]'), OBJECT_ID(N'[dbo].[QuranTopic]'));
  `);
  if (surrogates.length > 0)
    fail(
      `No canonical table may carry a surrogate identity; found ${JSON.stringify(surrogates)}.`,
    );

  const ayahKeys = await session.query<{ name: string; columns: number }>(`
    SELECT fk.[name], COUNT_BIG(*) AS [columns]
    FROM sys.foreign_keys fk
    JOIN sys.foreign_key_columns c ON c.[constraint_object_id] = fk.[object_id]
    WHERE fk.[referenced_object_id] = OBJECT_ID(N'[dbo].[Ayah]')
    GROUP BY fk.[name];
  `);
  const personalAyah = await personalisationAyahKeys(session);
  if (
    ayahKeys
      .map((row) => row.name)
      .sort()
      .join(',') !== [...QURAN_AYAH_KEYS, ...personalAyah].sort().join(',') ||
    ayahKeys.some((row) => Number(row.columns) !== 2)
  )
    fail(
      `Every Ayah reference must be the two-column citation, exactly ${QURAN_AYAH_KEYS.join(', ')}; ` +
        `found ${JSON.stringify(ayahKeys)}.`,
    );

  // ---- 3. no cascade, exact external edges, no foreign Quran schema ----------
  const cascading = await session.query<{ name: string }>(`
    SELECT [name] FROM sys.foreign_keys
    WHERE [parent_object_id] IN (${tables})
      AND ([delete_referential_action] <> 0 OR [update_referential_action] <> 0);
  `);
  if (cascading.length > 0)
    fail(
      `Phase-18 foreign keys must not cascade; found ${cascading.map((row) => row.name).join(', ')}.`,
    );

  const external = await session.query<{ edge: string }>(`
    SELECT fk.[name] + N'>' + OBJECT_NAME(fk.[referenced_object_id]) AS [edge]
    FROM sys.foreign_keys fk
    WHERE fk.[parent_object_id] IN (${tables}) AND fk.[referenced_object_id] NOT IN (${tables});
  `);
  const edges = external.map((row) => row.edge).sort();
  if (edges.join(',') !== QURAN_EXTERNAL_KEYS.join(','))
    fail(
      `Quran's references into other owners must be exactly ${QURAN_EXTERNAL_KEYS.join(', ')}; ` +
        `found ${edges.join(', ')}.`,
    );

  // Phase 21's typed references are the ONE admitted exception, by exact key
  // name and by table name (never OBJECT_ID, which is NULL once Phase 21 is
  // rolled back): a saved Ayah, an Ayah read and a reading position, each the
  // two-column citation proved above, each refusing deletion of the Ayah it
  // names. `assertPersonalisationFoundation` proves their exact columns.
  const personalOwn = PERSONALISATION_TABLES.map((table) => `N'${table}'`).join(',');
  const [ownership] = await session.query<{
    inbound: string | null;
    columns: string | null;
  }>(`
    SELECT
      (SELECT STRING_AGG([name], N',') WITHIN GROUP (ORDER BY [name]) FROM sys.foreign_keys
        WHERE [referenced_object_id] IN (${tables}) AND [parent_object_id] NOT IN (${tables})) AS [inbound],
      (SELECT STRING_AGG(OBJECT_NAME(c.[object_id]) + N'.' + c.[name], N',') FROM sys.columns c
        WHERE (c.[name] LIKE N'%surah%' OR c.[name] LIKE N'%ayah%' OR c.[name] LIKE N'%juz%'
               OR c.[name] LIKE N'%quran%' OR c.[name] LIKE N'%tafsir%' OR c.[name] LIKE N'%tajweed%')
          AND OBJECT_NAME(c.[object_id]) NOT IN (${names})
          AND OBJECT_NAME(c.[object_id]) NOT IN (${personalOwn})
          AND OBJECTPROPERTY(c.[object_id], 'IsUserTable') = 1) AS [columns];
  `);
  if (
    (ownership?.inbound ?? '') !== [...personalAyah].sort().join(',') ||
    (ownership?.columns ?? null) !== null
  )
    fail(
      `No other owner may hold Quran schema beyond Personalisation's typed Ayah keys; ` +
        `found ${JSON.stringify(ownership ?? null)}.`,
    );

  const generic = await session.query<{ name: string }>(`
    SELECT OBJECT_NAME(c.[object_id]) + N'.' + c.[name] AS [name] FROM sys.columns c
    WHERE c.[object_id] IN (${tables})
      AND (c.[name] LIKE N'%type%' OR c.[name] LIKE N'%target%' OR c.[name] LIKE N'%kind%'
           OR c.[name] LIKE N'%media%' OR c.[name] LIKE N'%hadith%' OR c.[name] LIKE N'%work%');
  `);
  if (generic.map((row) => row.name).join(',') !== 'QuranVerificationRun.kind')
    fail(
      `Quran tables may carry no type, target or foreign-context column beside the ` +
        `evidence's own kind; found ${JSON.stringify(generic)}.`,
    );

  // ---- 4. Unicode text everywhere it lives -----------------------------------
  const texts = await session.query<{ name: string; type: string; size: number }>(`
    SELECT OBJECT_NAME(c.[object_id]) + N'.' + c.[name] AS [name], TYPE_NAME(c.[user_type_id]) AS [type],
      c.[max_length] AS [size]
    FROM sys.columns c
    WHERE (c.[name] = N'text' AND c.[object_id] IN (${tables})) OR (c.[name] = N'body'
      AND c.[object_id] = OBJECT_ID(N'[dbo].[QuranTajweedRuleText]'));
  `);
  const describedTexts = texts
    .map((row) => `${row.name}:${row.type}(${String(row.size)})`)
    .sort()
    .join(',');
  const expectedTexts = [
    'Ayah.text:nvarchar(8000)',
    'QuranAyahRevision.text:nvarchar(8000)',
    'QuranSourceAyah.text:nvarchar(8000)',
    'QuranTafsirText.text:nvarchar(-1)',
    'QuranTajweedRuleText.body:nvarchar(-1)',
    'QuranTranslationText.text:nvarchar(-1)',
    'QuranTransliterationText.text:nvarchar(-1)',
  ].join(',');
  if (describedTexts !== expectedTexts)
    fail(`Quran text columns differ: ${describedTexts}.`);

  // ---- 5. every refusal in its own place -------------------------------------
  const triggers = await session.query<{
    name: string;
    tableName: string;
    definition: string | null;
  }>(`
    SELECT t.[name], OBJECT_NAME(t.[parent_id]) AS [tableName], OBJECT_DEFINITION(t.[object_id]) AS [definition]
    FROM sys.triggers t WHERE t.[parent_id] IN (${tables});
  `);
  const describedTriggers = triggers
    .map((row) => `${row.name}@${row.tableName}:${raisedNumbers(row.definition)}`)
    .sort()
    .join(',');
  const expectedTriggers = Object.entries(QURAN_TRIGGER_NUMBERS)
    .map(([name, [table, numbers]]) => `${name}@${table}:${numbers}`)
    .sort()
    .join(',');
  if (describedTriggers !== expectedTriggers)
    fail(
      `Quran triggers must raise exactly their own 5118x numbers; found ${describedTriggers}.`,
    );

  const procedures = await session.query<{ name: string; definition: string | null }>(`
    SELECT p.[name], OBJECT_DEFINITION(p.[object_id]) AS [definition]
    FROM sys.procedures p WHERE p.[name] LIKE N'Quran%';
  `);
  const describedProcedures = procedures
    .map((row) => `${row.name}:${raisedNumbers(row.definition)}`)
    .sort()
    .join(',');
  const expectedProcedures = Object.entries(QURAN_PROCEDURE_NUMBERS)
    .map(([name, numbers]) => `${name}:${numbers}`)
    .sort()
    .join(',');
  if (describedProcedures !== expectedProcedures)
    fail(
      `The canonical write path must be exactly four procedures raising their own ` +
        `5119x numbers; found ${describedProcedures}.`,
    );

  // ---- 6. three keys, all bundled -------------------------------------------
  const permissions = await session.query<{ key: string; bundled: number }>(`
    SELECT p.[key],
      (SELECT COUNT(*) FROM [dbo].[RolePermission] rp JOIN [dbo].[Role] r ON r.[id] = rp.[roleId]
       WHERE r.[key] = N'platform-administrator' AND rp.[permissionKey] = p.[key]) AS [bundled]
    FROM [dbo].[Permission] p
    WHERE p.[key] LIKE N'quran%' OR p.[key] LIKE N'surah%' OR p.[key] LIKE N'ayah%'
       OR p.[key] LIKE N'tafsir%' OR p.[key] LIKE N'recitation%';
  `);
  if (
    permissions
      .map((row) => row.key)
      .sort()
      .join(',') !== QURAN_PERMISSIONS.join(',') ||
    !permissions.every((row) => Number(row.bundled) === 1)
  )
    fail(
      `The Quran vocabulary must be exactly ${QURAN_PERMISSIONS.join(', ')}, all in the ` +
        `protected bundle; found ${JSON.stringify(permissions)}.`,
    );

  report(
    'quran foundation',
    'twenty-three empty tables, citation identity, eight Ayah keys, nine ' +
      'non-cascading external keys, 25 triggers and 4 procedures by number, three bundled keys',
  );
}

/**
 * After the Phase-18 rollback: no Quran table, trigger, procedure or key, no
 * `quran.*` permission or bundle entry, and no provisioning record. The caller
 * then proves the vocabulary and the earlier owners it referenced are back.
 */
async function assertQuranRemoved(session: SqlSession): Promise<void> {
  const [row] = await session.query<{
    tables: number;
    triggers: number;
    procedures: number;
    keys: number;
    permissions: number;
    bundled: number;
    audit: number;
  }>(`
    SELECT
      (SELECT COUNT(*) FROM sys.tables
        WHERE [name] LIKE N'Quran%' OR [name] IN (N'Juz', N'Surah', N'Ayah', N'SurahName')) AS [tables],
      (SELECT COUNT(*) FROM sys.triggers
        WHERE [name] LIKE N'Quran%' OR [name] IN (N'JuzImmutable', N'SurahImmutable', N'AyahCanonicalChange')) AS [triggers],
      (SELECT COUNT(*) FROM sys.procedures WHERE [name] LIKE N'Quran%') AS [procedures],
      (SELECT COUNT(*) FROM sys.foreign_keys
        WHERE [name] LIKE N'Quran%' OR [name] LIKE N'Ayah%' OR [name] LIKE N'Surah%' OR [name] LIKE N'Juz%') AS [keys],
      (SELECT COUNT(*) FROM [dbo].[Permission] WHERE [key] LIKE N'quran.%') AS [permissions],
      (SELECT COUNT(*) FROM [dbo].[RolePermission] WHERE [permissionKey] LIKE N'quran.%') AS [bundled],
      (SELECT COUNT(*) FROM [dbo].[AuditLog] WHERE [action] = N'quran.permissions.provisioned') AS [audit];
  `);
  if (Object.values(row ?? { missing: 1 }).some((value) => Number(value) !== 0))
    fail(`The Phase-18 rollback left a Quran object: ${JSON.stringify(row ?? null)}.`);
  report(
    'quran rollback',
    'every Quran table, trigger, procedure, key, permission and provisioning record removed',
  );
}

/**
 * Sentinel suffix for every Quran proof text. The Arabic reads "non-Quranic
 * test text": no proof here, or anywhere, carries scripture.
 */
const NON_QURAN_SUFFIX = ' نص اختبار غير قرآني';

/**
 * The FICTIONAL structure the Quran proofs verify: two Surahs of three and two
 * ayat across two Juz. Not a real count and not a real boundary — a shape that
 * exists only so the database has something to compare.
 */
const QURAN_PROOF_AYAT = [
  [1, 1, 1],
  [1, 2, 1],
  [1, 3, 1],
  [2, 1, 1],
  [2, 2, 2],
] as const;

interface ProofAyah {
  readonly surah: number;
  readonly ayah: number;
  readonly juz: number;
  readonly text: string;
}

function proofText(label: string, surah: number, ayah: number): string {
  return `NON_QURAN_FIXTURE_${label}_${String(surah)}_${String(ayah)}${NON_QURAN_SUFFIX}`;
}

/** The body of a SQL string literal. */
function literal(text: string): string {
  return text.replaceAll("'", "''");
}

/**
 * Phase 18 — THE CANONICAL RULES, proved as behaviour against the re-deployed
 * schema with sentinel, NON-QURAN text only, through the migration login (the
 * runtime's own posture is `db:test:permissions`'s):
 *
 *   - a registered source is immutable and keeps every Ayah inside its Surah
 *     (51180); an approved source carries its evidence; one encoding;
 *   - the procedures refuse a caller without the live authority (51190) — no
 *     role, the wrong purpose, an expired grant, another session's grant;
 *   - acceptance refuses an unregistered source (51192), any candidate that is
 *     not EXACTLY the source — a missing, duplicated or re-Juz'd Ayah, a
 *     different vowel mark, a different yeh, one trailing space (51193) — and
 *     an incomplete or non-contiguous source (51194), writing nothing; then
 *     materialises the source's own text byte for byte with version-1 history,
 *     passed evidence and a content-free audit, and refuses a second corpus
 *     (51191);
 *   - the citation is the key, and Surah, Juz, range, source and Topic are
 *     real constraints; structure is immutable (51181) and a canonical change
 *     is a one-step, recorded correction or nothing (51182); history and
 *     evidence are immutable (51183), and a failure record cannot pass;
 *   - activation refuses an empty corpus, a corpus that is not the activating
 *     source's, fixture text under an approved activation and an edit (51185);
 *     an active corpus is frozen (51184);
 *   - a correction refuses an absent Ayah (51195), a stale version (51196), a
 *     source that does not carry the Ayah in its Juz (51197), text that is not
 *     the source's (51193), no change or no reason (51199), and a fixture
 *     displacing approved text (51198); a valid one appends version 2;
 *   - tafsir entries and audio segments never overlap (51186, 51187), a
 *     segment's range is fixed, one Asset serves one segment; a published
 *     recitation keeps audio (51188) and a published work keeps text (51189);
 *   - `quran-ayah` intent is admitted and an invented Quran kind is not.
 */
async function assertQuranCanonicalRules(session: SqlSession): Promise<void> {
  const run = randomUUID().replaceAll('-', '').slice(0, 16);
  const at = '2026-10-02T00:00:00';
  let refusals = 0;
  const refuse = async (
    label: string,
    statement: string,
    numbers: readonly number[],
    rule: string,
  ): Promise<void> => {
    await expectRefusal(session, label, statement, numbers, rule);
    refusals += 1;
  };
  const count = async (statement: string): Promise<number> => {
    const [row] = await session.query<{ total: number }>(statement);
    return Number(row?.total ?? -1);
  };

  // ---- the identities the procedures check, as authoritative rows ------------
  const holder = randomUUID();
  const outsider = randomUUID();
  const role = randomUUID();
  const holderSession = randomUUID();
  const otherSession = randomUUID();
  const outsiderSession = randomUUID();
  const grant = randomUUID();
  const wrongPurpose = randomUUID();
  const expired = randomUUID();
  const otherSessionGrant = randomUUID();
  const outsiderGrant = randomUUID();
  const user = (id: string): string =>
    `INSERT INTO [dbo].[User] ([id],[name],[email],[emailVerified],[createdAt],[updatedAt],[locale],[status],[twoFactorEnabled]) VALUES (N'${id}',N'Synthetic Quran proof user',N'${id}@proof.invalid',0,SYSUTCDATETIME(),SYSUTCDATETIME(),N'en',N'active',0);`;
  const sessionRow = (id: string, userId: string): string =>
    `INSERT INTO [dbo].[Session] ([id],[token],[userId],[expiresAt],[createdAt],[updatedAt]) VALUES (N'${id}',N'proof-quran-${id}',N'${userId}',DATEADD(hour,1,SYSUTCDATETIME()),SYSUTCDATETIME(),SYSUTCDATETIME());`;
  const grantRow = (
    id: string,
    userId: string,
    sessionId: string,
    purpose: string,
    minutes: number,
  ): string =>
    `INSERT INTO [dbo].[StepUpGrant] ([id],[userId],[sessionId],[purpose],[expiresAt]) VALUES (N'${id}',N'${userId}',N'${sessionId}',N'${purpose}',DATEADD(minute,${String(minutes)},SYSUTCDATETIME()));`;
  await expectAccepted(
    session,
    'A synthetic canonical authority',
    `${user(holder)}
     ${user(outsider)}
     INSERT INTO [dbo].[Role] ([id],[key],[name],[description],[system]) VALUES (N'${role}',N'proof-quran-canonical-${run}',N'Synthetic Quran canonical proof role',N'Holds quran.editCanonical for the migration proof only.',0);
     INSERT INTO [dbo].[RolePermission] ([roleId],[permissionKey]) VALUES (N'${role}',N'quran.editCanonical');
     INSERT INTO [dbo].[RoleAssignment] ([userId],[roleId]) VALUES (N'${holder}',N'${role}');
     ${sessionRow(holderSession, holder)}
     ${sessionRow(otherSession, holder)}
     ${sessionRow(outsiderSession, outsider)}
     ${grantRow(grant, holder, holderSession, 'quran-canonical-edit', 30)}
     ${grantRow(wrongPurpose, holder, holderSession, 'privilege-administration', 30)}
     ${grantRow(expired, holder, holderSession, 'quran-canonical-edit', -1)}
     ${grantRow(otherSessionGrant, holder, otherSession, 'quran-canonical-edit', 30)}
     ${grantRow(outsiderGrant, outsider, outsiderSession, 'quran-canonical-edit', 30)}`,
  );

  interface Authority {
    readonly actor: string;
    readonly session: string;
    readonly grant: string;
  }
  const authorised: Authority = { actor: holder, session: holderSession, grant };
  const unauthorised: readonly (readonly [string, Authority])[] = [
    ['no role', { actor: outsider, session: outsiderSession, grant: outsiderGrant }],
    ['the wrong purpose', { actor: holder, session: holderSession, grant: wrongPurpose }],
    ['an expired grant', { actor: holder, session: holderSession, grant: expired }],
    [
      "another session's grant",
      { actor: holder, session: holderSession, grant: otherSessionGrant },
    ],
    ['an unknown grant', { actor: holder, session: holderSession, grant: randomUUID() }],
  ];
  const NO_AUTHORITY = 'Canonical Quran authority is not held now.';

  const optional = (text: string | null): string =>
    text === null ? 'NULL' : `N'${literal(text)}'`;
  const candidate = (ayat: readonly ProofAyah[]): string =>
    JSON.stringify(
      ayat.map(({ surah, ayah, juz, text }) => ({ surah, ayah, juz, text })),
    );
  const accept = (authority: Authority, sourceId: string, json: string): string =>
    `EXEC [dbo].[QuranAcceptCorpus] @runId=N'${randomUUID()}', @sourceId=N'${sourceId}', @candidate=N'${literal(json)}', @actorId=N'${authority.actor}', @sessionId=N'${authority.session}', @stepUpGrantId=N'${authority.grant}', @at='${at}';`;
  const correct = (
    authority: Authority,
    [surah, ayah]: readonly [number, number],
    expectedVersion: number,
    sourceId: string,
    reviewed: string | null,
    reason: string | null,
  ): string =>
    `EXEC [dbo].[QuranCorrectAyah] @runId=N'${randomUUID()}', @surah=${String(surah)}, @ayah=${String(ayah)}, @expectedVersion=${String(expectedVersion)}, @sourceId=N'${sourceId}', @reviewedText=${optional(reviewed)}, @reason=${optional(reason)}, @actorId=N'${authority.actor}', @sessionId=N'${authority.session}', @stepUpGrantId=N'${authority.grant}', @at='${at}';`;
  const register = (
    id: string,
    code: string,
    authority: 'fixture' | 'approved',
    surahs: readonly (readonly [number, number])[],
    ayat: readonly ProofAyah[],
  ): string =>
    `INSERT INTO [dbo].[QuranSource] ([id],[code],[authority],[title],[version],[encoding],[reference]) VALUES (N'${id}',N'${code}',N'${authority}',N'NON_QURAN_FIXTURE source ${code}',N'proof-1',N'utf-8',${authority === 'approved' ? "N'urn:example:non-quran-fixture-evidence'" : 'NULL'});
     INSERT INTO [dbo].[QuranSourceSurah] ([sourceId],[number],[ayahCount]) VALUES ${surahs.map(([number, ayat]) => `(N'${id}',${String(number)},${String(ayat)})`).join(',')};
     ${ayat.length === 0 ? '' : `INSERT INTO [dbo].[QuranSourceAyah] ([sourceId],[surahNumber],[ayahNumber],[juzNumber],[text]) VALUES ${ayat.map((a) => `(N'${id}',${String(a.surah)},${String(a.ayah)},${String(a.juz)},N'${literal(a.text)}')`).join(',')};`}`;

  // ---- the sources, registered by the owner -----------------------------------
  //
  // Ayah 1:3 carries a letter with a FATHA and an Arabic YEH, so the code-point
  // refusals below differ from it by one mark or one letter, never by meaning.
  const marked = `${proofText('CANONICAL', 1, 3)} بَ ي`;
  const fixtureAyat: ProofAyah[] = QURAN_PROOF_AYAT.map(([surah, ayah, juz]) => ({
    surah,
    ayah,
    juz,
    text: surah === 1 && ayah === 3 ? marked : proofText('CANONICAL', surah, ayah),
  }));
  const structure = [
    [1, 3],
    [2, 2],
  ] as const;
  const fixture = randomUUID();
  const correction = randomUUID();
  const elsewhere = randomUUID();
  const incomplete = randomUUID();
  const decreasing = randomUUID();
  const approved = randomUUID();
  const bare = randomUUID();
  const corrected = proofText('CORRECTED', 1, 2);
  const approvedAyat = fixtureAyat.map((a) => ({
    ...a,
    text: proofText('APPROVED_PROBE', a.surah, a.ayah),
  }));
  await expectAccepted(
    session,
    'Sources registered by the owner',
    `${register(fixture, `NON_QURAN_FIXTURE_${run}`, 'fixture', structure, fixtureAyat)}
     ${register(correction, `NON_QURAN_FIXTURE_CORRECTION_${run}`, 'fixture', [[1, 3]], [{ surah: 1, ayah: 2, juz: 1, text: corrected }])}
     ${register(elsewhere, `NON_QURAN_FIXTURE_JUZ_${run}`, 'fixture', [[1, 3]], [{ surah: 1, ayah: 2, juz: 2, text: corrected }])}
     ${register(
       incomplete,
       `NON_QURAN_FIXTURE_INCOMPLETE_${run}`,
       'fixture',
       [[1, 3]],
       fixtureAyat.filter((a) => a.surah === 1 && a.ayah < 3),
     )}
     ${register(
       decreasing,
       `NON_QURAN_FIXTURE_DECREASING_${run}`,
       'fixture',
       [[1, 2]],
       [
         { surah: 1, ayah: 1, juz: 2, text: proofText('DECREASING', 1, 1) },
         { surah: 1, ayah: 2, juz: 1, text: proofText('DECREASING', 1, 2) },
       ],
     )}
     ${register(approved, `NON_QURAN_FIXTURE_APPROVED_PROBE_${run}`, 'approved', structure, approvedAyat)}
     INSERT INTO [dbo].[QuranSource] ([id],[code],[authority],[title],[version],[encoding]) VALUES (N'${bare}',N'NON_QURAN_FIXTURE_BARE_${run}',N'fixture',N'NON_QURAN_FIXTURE bare source',N'proof-1',N'utf-8');`,
  );

  // ---- 51180: a registered source is a fact, never edited ---------------------
  const IMMUTABLE_SOURCE = 'A registered Quran source is immutable.';
  await refuse(
    'A source is never edited',
    `UPDATE [dbo].[QuranSource] SET [title]=[title] WHERE [id]=N'${fixture}';`,
    [51180],
    IMMUTABLE_SOURCE,
  );
  await refuse(
    'A source is never removed',
    `DELETE FROM [dbo].[QuranSource] WHERE [id]=N'${bare}';`,
    [51180],
    IMMUTABLE_SOURCE,
  );
  await refuse(
    "A source Surah's count never changes",
    `UPDATE [dbo].[QuranSourceSurah] SET [ayahCount]=[ayahCount]+1 WHERE [sourceId]=N'${fixture}';`,
    [51180],
    IMMUTABLE_SOURCE,
  );
  await refuse(
    "A source's text never changes",
    `UPDATE [dbo].[QuranSourceAyah] SET [text]=N'${literal(proofText('TAMPERED', 1, 1))}' WHERE [sourceId]=N'${fixture}' AND [surahNumber]=1 AND [ayahNumber]=1;`,
    [51180],
    IMMUTABLE_SOURCE,
  );
  await refuse(
    'A source Ayah is never removed',
    `DELETE FROM [dbo].[QuranSourceAyah] WHERE [sourceId]=N'${fixture}';`,
    [51180],
    IMMUTABLE_SOURCE,
  );
  await refuse(
    'A source Ayah lies inside its Surah',
    `INSERT INTO [dbo].[QuranSourceAyah] ([sourceId],[surahNumber],[ayahNumber],[juzNumber],[text]) VALUES (N'${correction}',1,4,1,N'${literal(proofText('OUTSIDE', 1, 4))}');`,
    [51180],
    'A source Ayah lies outside its Surah.',
  );
  await refuse(
    'An approved source carries its evidence',
    `INSERT INTO [dbo].[QuranSource] ([id],[code],[authority],[title],[version],[encoding]) VALUES (N'${randomUUID()}',N'NON_QURAN_FIXTURE_NO_EVIDENCE_${run}',N'approved',N'NON_QURAN_FIXTURE',N'proof-1',N'utf-8');`,
    [547],
    'QuranSource_evidence_ck',
  );
  await refuse(
    'A source is UTF-8',
    `INSERT INTO [dbo].[QuranSource] ([id],[code],[authority],[title],[version],[encoding]) VALUES (N'${randomUUID()}',N'NON_QURAN_FIXTURE_UTF16_${run}',N'fixture',N'NON_QURAN_FIXTURE',N'proof-1',N'utf-16');`,
    [547],
    'QuranSource_encoding_ck',
  );

  // ---- 51185: an EMPTY corpus is never activated -------------------------------
  const activate = (sourceId: string): string =>
    `INSERT INTO [dbo].[QuranActivation] ([id],[sourceId],[authorisedBy]) VALUES (1,N'${sourceId}',N'Synthetic migration proof operator');`;
  await refuse(
    'An empty corpus is never activated',
    activate(fixture),
    [51185],
    'An empty Quran corpus cannot be activated.',
  );

  // ---- acceptance: the live authority, then the exact source, or nothing -------
  const fullCandidate = candidate(fixtureAyat);
  for (const [why, authority] of unauthorised)
    await refuse(
      `Acceptance refused with ${why}`,
      accept(authority, fixture, fullCandidate),
      [51190],
      NO_AUTHORITY,
    );
  await expectAccepted(
    session,
    'The authority check itself, held',
    `EXEC [dbo].[QuranAssertCanonicalAuthority] @actorId=N'${holder}', @sessionId=N'${holderSession}', @stepUpGrantId=N'${grant}';`,
  );
  await refuse(
    'The authority check itself, not held',
    `EXEC [dbo].[QuranAssertCanonicalAuthority] @actorId=N'${outsider}', @sessionId=N'${outsiderSession}', @stepUpGrantId=N'${outsiderGrant}';`,
    [51190],
    NO_AUTHORITY,
  );
  await refuse(
    'Acceptance names a registered source',
    accept(authorised, randomUUID(), fullCandidate),
    [51192],
    'The Quran source is not registered.',
  );
  const MISMATCH = 'The candidate does not match the source.';
  const variant = (ayah: ProofAyah): ProofAyah[] =>
    fixtureAyat.map((a) => (a.surah === ayah.surah && a.ayah === ayah.ayah ? ayah : a));
  const ayahOneThree = fixtureAyat[2];
  if (ayahOneThree === undefined) fail('The proof structure is empty.');
  for (const [why, json] of [
    ['not JSON', 'NON_QURAN_FIXTURE not json'],
    ['missing an Ayah', candidate(fixtureAyat.slice(1))],
    ['repeating an Ayah', candidate([...fixtureAyat, ayahOneThree])],
    ['an Ayah in another Juz', candidate(variant({ ...ayahOneThree, juz: 2 }))],
    [
      'a different vowel mark',
      candidate(variant({ ...ayahOneThree, text: marked.replace('َ', 'ِ') })),
    ],
    [
      'a different yeh',
      candidate(variant({ ...ayahOneThree, text: marked.replace('ي', 'ی') })),
    ],
    ['one trailing space', candidate(variant({ ...ayahOneThree, text: `${marked} ` }))],
  ] as const)
    await refuse(
      `A candidate with ${why} is refused`,
      accept(authorised, fixture, json),
      [51193],
      MISMATCH,
    );
  const INCOMPLETE = 'The Quran source is not a complete structure.';
  await refuse(
    'An incomplete source is never accepted',
    accept(
      authorised,
      incomplete,
      candidate(fixtureAyat.filter((a) => a.surah === 1 && a.ayah < 3)),
    ),
    [51194],
    INCOMPLETE,
  );
  await refuse(
    'A source whose Juz run backwards is never accepted',
    accept(
      authorised,
      decreasing,
      candidate([
        { surah: 1, ayah: 1, juz: 2, text: proofText('DECREASING', 1, 1) },
        { surah: 1, ayah: 2, juz: 1, text: proofText('DECREASING', 1, 2) },
      ]),
    ),
    [51194],
    INCOMPLETE,
  );
  const written = await count(`
    SELECT (SELECT COUNT_BIG(*) FROM [dbo].[Juz]) + (SELECT COUNT_BIG(*) FROM [dbo].[Surah])
      + (SELECT COUNT_BIG(*) FROM [dbo].[Ayah]) + (SELECT COUNT_BIG(*) FROM [dbo].[QuranAyahRevision])
      + (SELECT COUNT_BIG(*) FROM [dbo].[QuranVerificationRun])
      + (SELECT COUNT_BIG(*) FROM [dbo].[AuditLog] WHERE [action] LIKE N'quran.corpus.%') AS [total];
  `);
  if (written !== 0) fail(`A refused acceptance wrote ${String(written)} row(s).`);

  // ---- the corpus, materialised from the SOURCE's own text -----------------------
  await expectAccepted(
    session,
    'The exact candidate is accepted',
    accept(authorised, fixture, fullCandidate),
  );
  const [materialised] = await session.query<Record<string, number>>(`
    SELECT
      (SELECT COUNT(*) FROM [dbo].[Juz] WHERE [sourceId]=N'${fixture}') AS [juz],
      (SELECT COUNT(*) FROM [dbo].[Surah] WHERE [sourceId]=N'${fixture}' AND [namesVersion]=1) AS [surahs],
      (SELECT COUNT(*) FROM [dbo].[Ayah] a
         JOIN [dbo].[QuranSourceAyah] s ON s.[sourceId]=N'${fixture}' AND s.[surahNumber]=a.[surahNumber]
           AND s.[ayahNumber]=a.[ayahNumber] AND s.[juzNumber]=a.[juzNumber]
         JOIN [dbo].[QuranAyahRevision] r ON r.[surahNumber]=a.[surahNumber] AND r.[ayahNumber]=a.[ayahNumber]
           AND r.[version]=1 AND r.[sourceId]=N'${fixture}' AND r.[actorId]=N'${holder}'
           AND r.[stepUpGrantId]=N'${grant}' AND r.[reason] IS NULL
         WHERE a.[version]=1 AND a.[sourceId]=N'${fixture}'
           AND CAST(a.[text] AS VARBINARY(8000))=CAST(s.[text] AS VARBINARY(8000))
           AND CAST(r.[text] AS VARBINARY(8000))=CAST(s.[text] AS VARBINARY(8000))) AS [exact],
      (SELECT COUNT(*) FROM [dbo].[Ayah]) AS [ayat],
      (SELECT COUNT(*) FROM [dbo].[QuranVerificationRun] WHERE [kind]=N'corpus-acceptance'
         AND [outcome]=N'passed' AND [checked]=5 AND [mismatches]=0 AND [sourceId]=N'${fixture}'
         AND [actorId]=N'${holder}') AS [runs],
      (SELECT COUNT(*) FROM [dbo].[AuditLog] WHERE [action]=N'quran.corpus.accepted'
         AND [actorId]=N'${holder}' AND [targetId]=N'${fixture}'
         AND [authorisingSource]=N'step-up:${grant}') AS [audit];
  `);
  if (
    JSON.stringify(materialised) !==
    '{"juz":2,"surahs":2,"exact":5,"ayat":5,"runs":1,"audit":1}'
  )
    fail(
      `The accepted corpus is not the source's exact text: ${JSON.stringify(materialised)}.`,
    );
  await refuse(
    'A second corpus is never accepted',
    accept(authorised, fixture, fullCandidate),
    [51191],
    'A canonical Quran corpus already exists.',
  );

  // ---- the citation is the key; structure and ranges are constraints -------------
  const ayahRow = (
    surah: number,
    ayah: number,
    juz: number,
    sourceId = fixture,
  ): string =>
    `INSERT INTO [dbo].[Ayah] ([surahNumber],[ayahNumber],[juzNumber],[text],[sourceId],[version]) VALUES (${String(surah)},${String(ayah)},${String(juz)},N'${literal(proofText('DIRECT', surah, ayah))}',N'${sourceId}',1);`;
  for (const [label, statement, numbers, rule] of [
    ['One Ayah per citation', ayahRow(1, 1, 1), [2627], 'Ayah_pkey'],
    ['An Ayah is in a real Surah', ayahRow(3, 1, 1), [547], 'Ayah_surahNumber_fkey'],
    ['An Ayah is in a real Juz', ayahRow(1, 9, 3), [547], 'Ayah_juzNumber_fkey'],
    [
      'An Ayah names a registered source',
      ayahRow(1, 9, 1, randomUUID()),
      [547],
      'Ayah_sourceId_fkey',
    ],
    ['An Ayah number starts at one', ayahRow(1, 0, 1), [547], 'Ayah_structure_ck'],
    [
      'A Juz is one of thirty',
      `INSERT INTO [dbo].[Juz] ([number],[sourceId]) VALUES (31,N'${fixture}');`,
      [547],
      'Juz_number_ck',
    ],
    [
      'A Surah is one of one hundred and fourteen',
      `INSERT INTO [dbo].[Surah] ([number],[ayahCount],[sourceId]) VALUES (115,1,N'${fixture}');`,
      [547],
      'Surah_number_ck',
    ],
    [
      'A correction revision carries actor, grant and reason',
      `INSERT INTO [dbo].[QuranAyahRevision] ([surahNumber],[ayahNumber],[version],[text],[sourceId],[verificationRunId]) SELECT 1,1,2,N'${literal(proofText('DIRECT', 1, 1))}',N'${fixture}',[id] FROM [dbo].[QuranVerificationRun];`,
      [547],
      'QuranAyahRevision_ck',
    ],
  ] as const)
    await refuse(label, statement, numbers, rule);

  // ---- 51181 and 51182: structure is fixed; a change is a recorded correction ----
  const STRUCTURE = 'Canonical Quran structure is immutable.';
  const ADVANCE = 'A canonical change must advance the version by one.';
  const RECORDED = 'A canonical change must be recorded in its history.';
  for (const [label, statement, numbers, rule] of [
    [
      "An Ayah's Juz never changes",
      'UPDATE [dbo].[Ayah] SET [juzNumber]=2 WHERE [surahNumber]=1 AND [ayahNumber]=1;',
      [51181],
      STRUCTURE,
    ],
    [
      "An Ayah's markers never change",
      'UPDATE [dbo].[Ayah] SET [hizb]=1 WHERE [surahNumber]=1 AND [ayahNumber]=1;',
      [51181],
      STRUCTURE,
    ],
    [
      'An Ayah with history is never removed',
      'DELETE FROM [dbo].[Ayah] WHERE [surahNumber]=1 AND [ayahNumber]=1;',
      [547],
      'QuranAyahRevision_ayah_fkey',
    ],
    [
      'Text never changes without a version',
      `UPDATE [dbo].[Ayah] SET [text]=N'${literal(proofText('TAMPERED', 1, 1))}' WHERE [surahNumber]=1 AND [ayahNumber]=1;`,
      [51182],
      ADVANCE,
    ],
    [
      'A version never skips',
      `UPDATE [dbo].[Ayah] SET [text]=N'${literal(proofText('TAMPERED', 1, 1))}',[version]=[version]+2 WHERE [surahNumber]=1 AND [ayahNumber]=1;`,
      [51182],
      ADVANCE,
    ],
    [
      'A change is recorded before it is made',
      `UPDATE [dbo].[Ayah] SET [text]=N'${literal(proofText('TAMPERED', 1, 1))}',[version]=[version]+1 WHERE [surahNumber]=1 AND [ayahNumber]=1;`,
      [51182],
      RECORDED,
    ],
    [
      "A Surah's count never changes",
      'UPDATE [dbo].[Surah] SET [ayahCount]=[ayahCount]+1,[namesVersion]=[namesVersion]+1 WHERE [number]=1;',
      [51181],
      STRUCTURE,
    ],
    [
      "A Surah's Arabic name never changes",
      `UPDATE [dbo].[Surah] SET [nameArabic]=N'${literal(proofText('NAME', 1, 0))}',[namesVersion]=[namesVersion]+1 WHERE [number]=1;`,
      [51181],
      STRUCTURE,
    ],
    [
      "A Surah's names version advances by one",
      'UPDATE [dbo].[Surah] SET [namesVersion]=[namesVersion]+2 WHERE [number]=1;',
      [51181],
      STRUCTURE,
    ],
    [
      'A Surah with ayat is never removed',
      'DELETE FROM [dbo].[Surah] WHERE [number]=2;',
      [547],
      'Ayah_surahNumber_fkey',
    ],
  ] as const)
    await refuse(label, statement, numbers, rule);
  await expectAccepted(
    session,
    "A Surah's display names advance",
    'UPDATE [dbo].[Surah] SET [namesVersion]=[namesVersion]+1,[updatedAt]=SYSUTCDATETIME() WHERE [number]=1;',
  );
  // A Juz no Ayah references, so its own trigger — not a foreign key — answers.
  await expectAccepted(
    session,
    'A Juz with no ayat',
    `INSERT INTO [dbo].[Juz] ([number],[sourceId]) VALUES (30,N'${fixture}');`,
  );
  await refuse(
    'A Juz never changes',
    `UPDATE [dbo].[Juz] SET [sourceId]=N'${correction}' WHERE [number]=30;`,
    [51181],
    STRUCTURE,
  );
  await refuse(
    'A Juz is never removed',
    'DELETE FROM [dbo].[Juz] WHERE [number]=30;',
    [51181],
    STRUCTURE,
  );

  // ---- 51183: history and evidence are immutable; a failure cannot pass ----------
  const HISTORY = 'Canonical Quran history is immutable.';
  const failedRun = randomUUID();
  const failure = (id: string, mismatches: number, reason: string | null): string =>
    `EXEC [dbo].[QuranRecordVerificationFailure] @runId=N'${id}', @kind=N'corpus-acceptance', @sourceId=N'${fixture}', @checked=5, @mismatches=${String(mismatches)}, @firstSurah=1, @firstAyah=3, @firstOffset=33, @firstReason=${optional(reason)}, @actorId=N'${holder}', @at='${at}';`;
  await expectAccepted(
    session,
    'A failed verification is recorded',
    failure(failedRun, 1, 'text-mismatch'),
  );
  for (const [label, statement, numbers, rule] of [
    [
      'A failure record cannot claim a pass',
      failure(randomUUID(), 0, null),
      [547],
      'QuranVerificationRun_outcome_ck',
    ],
    [
      'A failure names a known reason',
      failure(randomUUID(), 1, 'invented-reason'),
      [547],
      'QuranVerificationRun_reason_ck',
    ],
    [
      'A revision is never rewritten',
      `UPDATE [dbo].[QuranAyahRevision] SET [text]=N'${literal(proofText('TAMPERED', 1, 1))}' WHERE [surahNumber]=1 AND [ayahNumber]=1;`,
      [51183],
      HISTORY,
    ],
    [
      'A revision is never removed',
      'DELETE FROM [dbo].[QuranAyahRevision] WHERE [surahNumber]=1 AND [ayahNumber]=1;',
      [51183],
      HISTORY,
    ],
    [
      'Evidence is never rewritten',
      `UPDATE [dbo].[QuranVerificationRun] SET [checked]=[checked]+1 WHERE [outcome]=N'passed';`,
      [51183],
      HISTORY,
    ],
    [
      'Evidence is never removed',
      `DELETE FROM [dbo].[QuranVerificationRun] WHERE [id]=N'${failedRun}';`,
      [51183],
      HISTORY,
    ],
  ] as const)
    await refuse(label, statement, numbers, rule);

  // ---- 51185 and 51184: activation integrity; an active corpus is frozen ---------
  const NOT_THE_SOURCE = 'The canonical corpus does not match the activating source.';
  await refuse(
    "A corpus is activated only as its own source's",
    activate(correction),
    [51185],
    NOT_THE_SOURCE,
  );
  await refuse(
    'An approved activation carries no fixture text',
    activate(approved),
    [51185],
    'An approved corpus cannot carry fixture text.',
  );
  await expectAccepted(session, 'Fixture-mode activation', activate(fixture));
  for (const [label, statement, numbers, rule] of [
    [
      'An activation is replaced, never edited',
      `UPDATE [dbo].[QuranActivation] SET [sourceId]=N'${approved}';`,
      [51185],
      'Activation is replaced, never edited.',
    ],
    [
      'There is one activation',
      `INSERT INTO [dbo].[QuranActivation] ([id],[sourceId],[authorisedBy]) VALUES (2,N'${fixture}',N'Synthetic');`,
      [547],
      'QuranActivation_singleton_ck',
    ],
    [
      'An active corpus gains no Ayah',
      ayahRow(2, 3, 2),
      [51184],
      'An active Quran corpus cannot be extended.',
    ],
    [
      'An active corpus gains no Surah',
      `INSERT INTO [dbo].[Surah] ([number],[ayahCount],[sourceId]) VALUES (3,1,N'${fixture}');`,
      [51184],
      'An active Quran corpus cannot be extended.',
    ],
    [
      'An active corpus gains no Juz',
      `INSERT INTO [dbo].[Juz] ([number],[sourceId]) VALUES (3,N'${fixture}');`,
      [51184],
      'An active Quran corpus cannot be extended.',
    ],
  ] as const)
    await refuse(label, statement, numbers, rule);

  // ---- corrections: authority, existence, version, source, text, substance -------
  const reason = 'Synthetic correction proof against a registered fixture source.';
  for (const [label, statement, numbers, rule] of [
    [
      'A correction needs the live authority',
      correct(
        unauthorised[0]?.[1] ?? authorised,
        [1, 2],
        1,
        correction,
        corrected,
        reason,
      ),
      [51190],
      NO_AUTHORITY,
    ],
    [
      'A correction names an existing Ayah',
      correct(authorised, [2, 9], 1, correction, corrected, reason),
      [51195],
      'The Ayah does not exist.',
    ],
    [
      'A correction names the current version',
      correct(authorised, [1, 2], 2, correction, corrected, reason),
      [51196],
      'The Ayah changed since it was reviewed.',
    ],
    [
      'A correction source carries the Ayah',
      correct(authorised, [1, 1], 1, correction, corrected, reason),
      [51197],
      'The source does not carry this Ayah.',
    ],
    [
      'A correction source keeps the Juz',
      correct(authorised, [1, 2], 1, elsewhere, corrected, reason),
      [51197],
      'The source does not carry this Ayah.',
    ],
    [
      "The reviewed text is the source's, exactly",
      correct(authorised, [1, 2], 1, correction, `${corrected} `, reason),
      [51193],
      MISMATCH,
    ],
    [
      'A correction carries reviewed text',
      correct(authorised, [1, 2], 1, correction, null, reason),
      [51193],
      MISMATCH,
    ],
    [
      'A correction changes something',
      correct(authorised, [1, 1], 1, fixture, proofText('CANONICAL', 1, 1), reason),
      [51199],
      'The correction changes nothing.',
    ],
    [
      'A correction states its reason',
      correct(authorised, [1, 2], 1, correction, corrected, ''),
      [51199],
      'A correction states its reason.',
    ],
  ] as const)
    await refuse(label, statement, numbers, rule);
  await expectAccepted(
    session,
    'A valid correction',
    correct(authorised, [1, 2], 1, correction, corrected, reason),
  );
  const [history] = await session.query<Record<string, number | string>>(`
    SELECT a.[version], a.[sourceId],
      CASE WHEN CAST(a.[text] AS VARBINARY(8000))=CAST(s.[text] AS VARBINARY(8000)) THEN 1 ELSE 0 END AS [exact],
      (SELECT COUNT(*) FROM [dbo].[QuranAyahRevision] r JOIN [dbo].[QuranSourceAyah] f
         ON f.[sourceId]=N'${fixture}' AND f.[surahNumber]=1 AND f.[ayahNumber]=2
         WHERE r.[surahNumber]=1 AND r.[ayahNumber]=2 AND r.[version]=1
           AND CAST(r.[text] AS VARBINARY(8000))=CAST(f.[text] AS VARBINARY(8000))) AS [original],
      (SELECT COUNT(*) FROM [dbo].[QuranAyahRevision] r WHERE r.[surahNumber]=1 AND r.[ayahNumber]=2
         AND r.[version]=2 AND r.[sourceId]=N'${correction}' AND r.[actorId]=N'${holder}'
         AND r.[stepUpGrantId]=N'${grant}' AND r.[reason]=N'${literal(reason)}'
         AND CAST(r.[text] AS VARBINARY(8000))=CAST(s.[text] AS VARBINARY(8000))) AS [revision],
      (SELECT COUNT(*) FROM [dbo].[QuranVerificationRun] WHERE [kind]=N'ayah-correction'
         AND [outcome]=N'passed' AND [checked]=1 AND [sourceId]=N'${correction}') AS [runs],
      (SELECT COUNT(*) FROM [dbo].[AuditLog] WHERE [action]=N'quran.ayah.corrected'
         AND [targetId]=N'1:2' AND [actorId]=N'${holder}') AS [audit]
    FROM [dbo].[Ayah] a
    JOIN [dbo].[QuranSourceAyah] s ON s.[sourceId]=N'${correction}' AND s.[surahNumber]=1 AND s.[ayahNumber]=2
    WHERE a.[surahNumber]=1 AND a.[ayahNumber]=2;
  `);
  if (
    JSON.stringify(history) !==
    JSON.stringify({
      version: 2,
      sourceId: correction,
      exact: 1,
      original: 1,
      revision: 1,
      runs: 1,
      audit: 1,
    })
  )
    fail(`The correction is not a recorded version 2: ${JSON.stringify(history)}.`);
  await refuse(
    'A correction against a superseded version is refused',
    correct(authorised, [1, 2], 1, correction, corrected, reason),
    [51196],
    'The Ayah changed since it was reviewed.',
  );
  const approvedOneThree = approvedAyat[2]?.text ?? '';
  await expectAccepted(
    session,
    'Approved text displaces fixture text',
    correct(authorised, [1, 3], 1, approved, approvedOneThree, reason),
  );
  await refuse(
    'Fixture text never displaces approved text',
    correct(authorised, [1, 3], 2, fixture, marked, reason),
    [51198],
    'A fixture source cannot change approved canonical text.',
  );
  const leaked = await count(`
    SELECT COUNT_BIG(*) AS [total] FROM [dbo].[AuditLog]
    WHERE [action] LIKE N'quran.%'
      AND (ISNULL([beforeState], N'') + ISNULL([afterState], N'')) LIKE N'%NON[_]QURAN%';
  `);
  if (leaked !== 0) fail('A Quran audit record carries canonical text.');

  // ---- layered works: overlap, fixed ranges, audio and text kept ------------------
  const [topic] = await session.query<{ id: string }>(
    `SELECT [id] FROM [dbo].[Topic] WHERE [slug]=N'quran';`,
  );
  if (topic === undefined) fail('The canonical quran Topic is missing.');
  const reciter = randomUUID();
  const translation = randomUUID();
  const transliteration = randomUUID();
  const tafsir = randomUUID();
  const emptyTafsir = randomUUID();
  const recitation = randomUUID();
  const rule = randomUUID();
  const firstAsset = randomUUID();
  const secondAsset = randomUUID();
  const entry = (id: string, owner: string, start: number, end: number): string =>
    `INSERT INTO [dbo].[QuranTafsirText] ([id],[tafsirId],[surahNumber],[startAyah],[endAyah],[text]) VALUES (N'${id}',N'${owner}',1,${String(start)},${String(end)},N'${literal(proofText('TAFSIR', 1, start))}');`;
  const segment = (
    id: string,
    surah: number,
    start: number,
    end: number,
    asset: string | null,
  ): string =>
    `INSERT INTO [dbo].[QuranRecitationSegment] ([id],[recitationId],[surahNumber],[startAyah],[endAyah],[assetId]) VALUES (N'${id}',N'${recitation}',${String(surah)},${String(start)},${String(end)},${asset === null ? 'NULL' : `N'${asset}'`});`;
  const publish = (table: string, id: string): string =>
    `UPDATE [dbo].[${table}] SET [state]=N'published',[sourceId]=N'${fixture}',[publishedAt]=SYSUTCDATETIME(),[version]=[version]+1,[updatedAt]=SYSUTCDATETIME() WHERE [id]=N'${id}';`;
  await expectAccepted(
    session,
    'Draft layered works, a reciter and two files',
    `INSERT INTO [dbo].[Person] ([id],[slug],[primaryLocale],[status]) VALUES (N'${reciter}',N'proof-quran-reciter-${run}',N'en',N'published');
     INSERT INTO [dbo].[PersonTranslation] ([personId],[locale],[name]) VALUES (N'${reciter}',N'en',N'Fixture Reciter One');
     INSERT INTO [dbo].[Asset] ([id],[storageKey],[state],[updatedAt]) VALUES (N'${firstAsset}',N'proof/quran/${run}/1',N'uploading',SYSUTCDATETIME()),(N'${secondAsset}',N'proof/quran/${run}/2',N'uploading',SYSUTCDATETIME());
     INSERT INTO [dbo].[QuranTranslation] ([id],[slug],[languageCode],[name],[state],[version],[updatedAt]) VALUES (N'${translation}',N'proof-quran-translation-${run}',N'en',N'NON_QURAN_FIXTURE translation',N'draft',1,SYSUTCDATETIME());
     INSERT INTO [dbo].[QuranTransliteration] ([id],[slug],[languageCode],[name],[state],[version],[updatedAt]) VALUES (N'${transliteration}',N'proof-quran-transliteration-${run}',N'en',N'NON_QURAN_FIXTURE transliteration',N'draft',1,SYSUTCDATETIME());
     INSERT INTO [dbo].[QuranTafsir] ([id],[slug],[languageCode],[name],[state],[version],[updatedAt]) VALUES (N'${tafsir}',N'proof-quran-tafsir-${run}',N'en',N'NON_QURAN_FIXTURE tafsir',N'draft',1,SYSUTCDATETIME()),(N'${emptyTafsir}',N'proof-quran-tafsir-empty-${run}',N'en',N'NON_QURAN_FIXTURE empty tafsir',N'draft',1,SYSUTCDATETIME());
     INSERT INTO [dbo].[QuranRecitation] ([id],[slug],[personId],[name],[state],[version],[updatedAt]) VALUES (N'${recitation}',N'proof-quran-recitation-${run}',N'${reciter}',N'NON_QURAN_FIXTURE recitation',N'draft',1,SYSUTCDATETIME());
     INSERT INTO [dbo].[QuranTajweedRule] ([id],[slug],[position],[state],[version],[updatedAt]) VALUES (N'${rule}',N'proof-quran-tajweed-${run}',0,N'draft',1,SYSUTCDATETIME());`,
  );
  const firstEntry = randomUUID();
  const thirdEntry = randomUUID();
  const firstSegment = randomUUID();
  const secondSegment = randomUUID();
  await expectAccepted(
    session,
    'Non-overlapping entries and segments',
    `${entry(firstEntry, tafsir, 1, 2)}
     ${entry(thirdEntry, tafsir, 3, 3)}
     ${segment(firstSegment, 1, 1, 2, null)}
     ${segment(secondSegment, 2, 1, 2, null)}`,
  );
  const OVERLAP_SEGMENT = 'Segments of one recitation may not overlap.';
  const NEEDS_AUDIO = 'A published recitation needs audio.';
  const NEEDS_TEXT = 'A published work needs text.';
  for (const [label, statement, numbers, ruleName] of [
    [
      'Tafsir entries never overlap',
      entry(randomUUID(), tafsir, 2, 3),
      [51186],
      'Tafsir entries of one work may not overlap.',
    ],
    [
      'A tafsir entry is never moved over another',
      `UPDATE [dbo].[QuranTafsirText] SET [startAyah]=2 WHERE [id]=N'${thirdEntry}';`,
      [51186],
      'Tafsir entries of one work may not overlap.',
    ],
    [
      'A tafsir entry starts before it ends',
      entry(randomUUID(), tafsir, 2, 1),
      [547],
      'QuranTafsirText_ck',
    ],
    [
      'A tafsir entry ends at a real Ayah',
      entry(randomUUID(), emptyTafsir, 3, 9),
      [547],
      'QuranTafsirText_end_fkey',
    ],
    [
      'Segments never overlap',
      segment(randomUUID(), 1, 2, 3, null),
      [51187],
      OVERLAP_SEGMENT,
    ],
    [
      "A segment's range is fixed",
      `UPDATE [dbo].[QuranRecitationSegment] SET [endAyah]=3 WHERE [id]=N'${firstSegment}';`,
      [51187],
      'A segment range is fixed once created.',
    ],
    [
      'A recitation without audio is never published',
      publish('QuranRecitation', recitation),
      [51188],
      NEEDS_AUDIO,
    ],
    [
      'A translation without text is never published',
      publish('QuranTranslation', translation),
      [51189],
      NEEDS_TEXT,
    ],
    [
      'A transliteration without text is never published',
      publish('QuranTransliteration', transliteration),
      [51189],
      NEEDS_TEXT,
    ],
    [
      'A tafsir without entries is never published',
      publish('QuranTafsir', emptyTafsir),
      [51189],
      NEEDS_TEXT,
    ],
    [
      'A tajweed rule without text is never published',
      publish('QuranTajweedRule', rule),
      [51189],
      NEEDS_TEXT,
    ],
    [
      'A published work names a registered source',
      `UPDATE [dbo].[QuranTafsir] SET [state]=N'published',[publishedAt]=SYSUTCDATETIME() WHERE [id]=N'${tafsir}';`,
      [547],
      'QuranTafsir_state_ck',
    ],
    [
      'A translation text belongs to a real Ayah',
      `INSERT INTO [dbo].[QuranTranslationText] ([translationId],[surahNumber],[ayahNumber],[text]) VALUES (N'${translation}',1,9,N'${literal(proofText('TRANSLATION', 1, 9))}');`,
      [547],
      'QuranTranslationText_ayah_fkey',
    ],
    [
      'A topic assignment names a real Topic',
      `INSERT INTO [dbo].[QuranTopic] ([surahNumber],[ayahNumber],[topicId]) VALUES (1,1,N'${randomUUID()}');`,
      [547],
      'QuranTopic_topicId_fkey',
    ],
    [
      'A topic assignment names a real Ayah',
      `INSERT INTO [dbo].[QuranTopic] ([surahNumber],[ayahNumber],[topicId]) VALUES (1,9,N'${topic.id}');`,
      [547],
      'QuranTopic_ayah_fkey',
    ],
  ] as const)
    await refuse(label, statement, numbers, ruleName);
  await expectAccepted(
    session,
    'Audio, texts and a topic, then publication',
    `UPDATE [dbo].[QuranRecitationSegment] SET [assetId]=N'${firstAsset}' WHERE [id]=N'${secondSegment}';
     ${publish('QuranRecitation', recitation)}
     INSERT INTO [dbo].[QuranTranslationText] ([translationId],[surahNumber],[ayahNumber],[text]) VALUES (N'${translation}',1,1,N'${literal(proofText('TRANSLATION', 1, 1))}');
     ${publish('QuranTranslation', translation)}
     ${publish('QuranTafsir', tafsir)}
     INSERT INTO [dbo].[QuranTransliterationText] ([transliterationId],[surahNumber],[ayahNumber],[text]) VALUES (N'${transliteration}',1,1,N'NON_QURAN_FIXTURE_TRANSLITERATION_1_1');
     ${publish('QuranTransliteration', transliteration)}
     INSERT INTO [dbo].[QuranTajweedRuleText] ([ruleId],[languageCode],[title],[body]) VALUES (N'${rule}',N'en',N'NON_QURAN_FIXTURE rule',N'NON_QURAN_FIXTURE rule body');
     ${publish('QuranTajweedRule', rule)}
     INSERT INTO [dbo].[QuranTopic] ([surahNumber],[ayahNumber],[topicId]) VALUES (1,1,N'${topic.id}');`,
  );

  // ---- a published work keeps its text against a MOVE as well as a delete -------
  //
  // Re-parenting a work's last text to another work empties the published one
  // exactly as deleting it would, so the keep-text rule answers an UPDATE of
  // the parent key too — for each of the four text tables, through the owner.
  const draftTranslation = randomUUID();
  const draftTransliteration = randomUUID();
  const draftRule = randomUUID();
  await expectAccepted(
    session,
    'Draft works to move texts into',
    `INSERT INTO [dbo].[QuranTranslation] ([id],[slug],[languageCode],[name],[state],[version],[updatedAt]) VALUES (N'${draftTranslation}',N'proof-quran-translation-draft-${run}',N'en',N'NON_QURAN_FIXTURE draft translation',N'draft',1,SYSUTCDATETIME());
     INSERT INTO [dbo].[QuranTransliteration] ([id],[slug],[languageCode],[name],[state],[version],[updatedAt]) VALUES (N'${draftTransliteration}',N'proof-quran-transliteration-draft-${run}',N'en',N'NON_QURAN_FIXTURE draft transliteration',N'draft',1,SYSUTCDATETIME());
     INSERT INTO [dbo].[QuranTajweedRule] ([id],[slug],[position],[state],[version],[updatedAt]) VALUES (N'${draftRule}',N'proof-quran-tajweed-draft-${run}',1,N'draft',1,SYSUTCDATETIME());`,
  );
  for (const [label, statement] of [
    [
      "A published translation's last text is never moved away",
      `UPDATE [dbo].[QuranTranslationText] SET [translationId]=N'${draftTranslation}' WHERE [translationId]=N'${translation}';`,
    ],
    [
      "A published transliteration's last text is never moved away",
      `UPDATE [dbo].[QuranTransliterationText] SET [transliterationId]=N'${draftTransliteration}' WHERE [transliterationId]=N'${transliteration}';`,
    ],
    [
      "A published tafsir's entries are never moved away",
      `UPDATE [dbo].[QuranTafsirText] SET [tafsirId]=N'${emptyTafsir}' WHERE [tafsirId]=N'${tafsir}';`,
    ],
    [
      "A published tajweed rule's last text is never moved away",
      `UPDATE [dbo].[QuranTajweedRuleText] SET [ruleId]=N'${draftRule}' WHERE [ruleId]=N'${rule}';`,
    ],
  ] as const)
    await refuse(label, statement, [51189], NEEDS_TEXT);

  // ---- a slug is a public address in one grammar ---------------------------------
  const work = (table: string, slug: string): string => {
    const id = randomUUID();
    if (table === 'QuranRecitation')
      return `INSERT INTO [dbo].[QuranRecitation] ([id],[slug],[personId],[name],[state],[version],[updatedAt]) VALUES (N'${id}',N'${slug}',N'${reciter}',N'NON_QURAN_FIXTURE',N'draft',1,SYSUTCDATETIME());`;
    if (table === 'QuranTajweedRule')
      return `INSERT INTO [dbo].[QuranTajweedRule] ([id],[slug],[position],[state],[version],[updatedAt]) VALUES (N'${id}',N'${slug}',2,N'draft',1,SYSUTCDATETIME());`;
    return `INSERT INTO [dbo].[${table}] ([id],[slug],[languageCode],[name],[state],[version],[updatedAt]) VALUES (N'${id}',N'${slug}',N'en',N'NON_QURAN_FIXTURE',N'draft',1,SYSUTCDATETIME());`;
  };
  for (const table of [
    'QuranTranslation',
    'QuranTransliteration',
    'QuranTafsir',
    'QuranRecitation',
    'QuranTajweedRule',
  ])
    for (const [why, slug] of [
      ['an uppercase letter', `Proof-upper-${run}`],
      ['a leading hyphen', `-proof-leading-${run}`],
      ['a double hyphen', `proof--double-${run}`],
    ] as const)
      await refuse(
        `A ${table} slug with ${why} is refused`,
        work(table, slug),
        [547],
        `${table}_slug_ck`,
      );
  for (const [label, statement, numbers, ruleName] of [
    [
      'One file serves one segment',
      `UPDATE [dbo].[QuranRecitationSegment] SET [assetId]=N'${firstAsset}' WHERE [id]=N'${firstSegment}';`,
      [2601],
      'QuranRecitationSegment_assetId_key',
    ],
    [
      'A published recitation keeps its audio',
      `UPDATE [dbo].[QuranRecitationSegment] SET [assetId]=NULL WHERE [id]=N'${secondSegment}';`,
      [51188],
      NEEDS_AUDIO,
    ],
    [
      'A published recitation keeps its audible segment',
      `DELETE FROM [dbo].[QuranRecitationSegment] WHERE [id]=N'${secondSegment}';`,
      [51188],
      NEEDS_AUDIO,
    ],
    [
      'A published translation keeps its text',
      `DELETE FROM [dbo].[QuranTranslationText] WHERE [translationId]=N'${translation}';`,
      [51189],
      NEEDS_TEXT,
    ],
    [
      'A published tafsir keeps its entries',
      `DELETE FROM [dbo].[QuranTafsirText] WHERE [tafsirId]=N'${tafsir}';`,
      [51189],
      NEEDS_TEXT,
    ],
    [
      'An Ayah is assigned a Topic once',
      `INSERT INTO [dbo].[QuranTopic] ([surahNumber],[ayahNumber],[topicId]) VALUES (1,1,N'${topic.id}');`,
      [2627],
      'QuranTopic_pkey',
    ],
    [
      'An invented Quran search kind is refused',
      `INSERT INTO [dbo].[SearchIndexRequest] ([scopeKind],[scopeId]) VALUES (N'quran-surah',N'1');`,
      [547],
      'SearchIndexRequest_scopeKind_ck',
    ],
  ] as const)
    await refuse(label, statement, numbers, ruleName);
  await expectAccepted(
    session,
    'A second file replaces the first',
    `UPDATE [dbo].[QuranRecitationSegment] SET [assetId]=N'${secondAsset}' WHERE [id]=N'${secondSegment}';`,
  );
  await expectAccepted(
    session,
    'Ayah search intent',
    `INSERT INTO [dbo].[SearchIndexRequest] ([scopeKind],[scopeId]) VALUES (N'quran-ayah',N'1:2');`,
  );

  // ---- deactivation: an Ayah without history is still never removed -------------
  //
  // The structure trigger, not a foreign key, answers here: this Ayah has no
  // revision. Its presence then keeps the corpus from ever matching its source
  // again, which is the activation rule refusing a corpus nobody verified.
  await expectAccepted(
    session,
    'The operator withdraws the corpus, then a direct Ayah',
    `DELETE FROM [dbo].[QuranActivation];
     ${ayahRow(2, 3, 2)}`,
  );
  for (const [label, statement, numbers, ruleName] of [
    [
      'An Ayah is never removed',
      'DELETE FROM [dbo].[Ayah] WHERE [surahNumber]=2 AND [ayahNumber]=3;',
      [51181],
      STRUCTURE,
    ],
    [
      "An Ayah's citation never changes",
      'UPDATE [dbo].[Ayah] SET [ayahNumber]=4 WHERE [surahNumber]=2 AND [ayahNumber]=3;',
      [51181],
      STRUCTURE,
    ],
    [
      'An unverified Ayah keeps the corpus inactive',
      activate(fixture),
      [51185],
      NOT_THE_SOURCE,
    ],
  ] as const)
    await refuse(label, statement, numbers, ruleName);

  report(
    'quran canonical rules',
    `exact acceptance and correction, frozen active corpus, layered works; ` +
      `${String(refusals)} refusals by name, every text a NON_QURAN_FIXTURE sentinel`,
  );
}

const HADITH_PERMISSIONS = ['hadith.administer', 'hadith.editCanonical', 'hadith.read'];

/**
 * EVERY foreign key from a Hadith table to another owner's table, exactly: the
 * content languages, the contributors and the Topic. None names a User — a
 * canonical revision's, verification's or citation's actor and step-up grant
 * are HISTORICAL identifiers that must outlive the rows they name
 * (DOMAIN_MODEL.md §6.2.1) — and none names Quran, Library, Media, Editorial
 * or People beyond a contributor.
 */
const HADITH_EXTERNAL_KEYS = [
  'HadithBook_titleLanguage_fkey>Language',
  'HadithChapter_titleLanguage_fkey>Language',
  'HadithCommentaryContributor_personId_fkey>Person',
  'HadithCommentary_languageCode_fkey>Language',
  'HadithGrading_labelLanguage_fkey>Language',
  'HadithScienceText_languageCode_fkey>Language',
  'HadithTopic_topicId_fkey>Topic',
  'HadithTranslationContributor_personId_fkey>Person',
  'HadithTranslation_languageCode_fkey>Language',
  'Hadith_chainLanguage_fkey>Language',
  'Hadith_textLanguage_fkey>Language',
].sort();

/**
 * Phase 19 — what only the catalogue can prove about Hadith:
 *
 *   1. NOTHING IS SEEDED: all twenty-four tables are empty after deploy. The
 *      collections, editions, numbering and grading authority are open
 *      external decisions (OPEN_DECISIONS.md §1.3, §1.5, §1.6), so a migrated
 *      database holds NO corpus;
 *   2. the record's identity is its SOURCE: the only uniqueness on a record is
 *      `(editionId, sourceReference)` — no bare number is a key — and the
 *      public citation `(collectionId, number)` is a separate table whose
 *      composite key reaches only a record that DECLARED that number; every
 *      structural key carries the edition, and every source reference and
 *      grader is held under a binary collation;
 *   3. no Hadith foreign key cascades, its references into other owners are
 *      EXACTLY the eleven above, no other owner references a Hadith table or
 *      holds a Hadith or narrator column, and no Hadith table carries a type,
 *      target, narrator or foreign-context column;
 *   4. every canonical and layered text is NVARCHAR(MAX);
 *   5. each of the eighteen triggers and eight procedures raises exactly its
 *      own numbers from 51200–51220, on the table it guards;
 *   6. the Hadith vocabulary is exactly three keys, all in the protected bundle.
 *
 * The rules themselves are proved as BEHAVIOUR by `assertHadithCanonicalRules`,
 * and through the runtime login by `db:test:permissions`.
 */
async function assertHadithFoundation(session: SqlSession): Promise<void> {
  const tables = HADITH_TABLES.map((table) => `OBJECT_ID(N'[dbo].[${table}]')`).join(',');
  const names = HADITH_TABLES.map((table) => `N'${table}'`).join(',');

  // ---- 1. NO corpus ----------------------------------------------------------
  const counts = await session.query<{ name: string; total: number }>(
    HADITH_TABLES.map(
      (table) =>
        `SELECT N'${table}' AS [name], COUNT_BIG(*) AS [total] FROM [dbo].[${table}]`,
    ).join(' UNION ALL ') + ';',
  );
  const seeded = counts.filter((row) => Number(row.total) !== 0);
  if (HADITH_TABLES.length !== 24 || counts.length !== 24 || seeded.length > 0)
    fail(
      `The Hadith migration must create twenty-four empty tables and seed no content; ` +
        `found ${String(counts.length)} tables, seeded: ${JSON.stringify(seeded)}.`,
    );

  // ---- 2. source-qualified identity, a separate citation ---------------------
  const unique = await session.query<{ name: string; columns: string }>(`
    SELECT i.[name], STRING_AGG(COL_NAME(ic.[object_id], ic.[column_id]), N',')
      WITHIN GROUP (ORDER BY ic.[key_ordinal]) AS [columns]
    FROM sys.indexes i
    JOIN sys.index_columns ic ON ic.[object_id] = i.[object_id] AND ic.[index_id] = i.[index_id]
    WHERE i.[is_unique] = 1 AND ic.[key_ordinal] > 0
      AND i.[object_id] IN (OBJECT_ID(N'[dbo].[Hadith]'), OBJECT_ID(N'[dbo].[HadithCitation]'),
                            OBJECT_ID(N'[dbo].[HadithEdition]'))
    GROUP BY i.[name];
  `);
  const describedUnique = unique
    .map((row) => `${row.name}(${row.columns})`)
    .sort()
    .join(',');
  const expectedUnique = [
    'HadithCitation_id_key(id)',
    'HadithCitation_pkey(collectionId,number)',
    'HadithEdition_code_key(collectionId,sourceSystemId,code)',
    'HadithEdition_collection_key(id,collectionId)',
    'HadithEdition_identity_key(id,collectionId,sourceSystemId)',
    'HadithEdition_pkey(id)',
    'Hadith_citation_key(id,collectionId,citationNumber)',
    'Hadith_identity_key(editionId,sourceReference)',
    'Hadith_pkey(id)',
  ]
    .sort()
    .join(',');
  if (describedUnique !== expectedUnique)
    fail(
      `A Hadith record must be unique by its edition and source reference alone, and a ` +
        `citation by its collection and number; found ${describedUnique}.`,
    );

  const composite = await session.query<{ name: string; columns: string }>(`
    SELECT fk.[name], STRING_AGG(COL_NAME(c.[parent_object_id], c.[parent_column_id]) + N'>'
        + COL_NAME(c.[referenced_object_id], c.[referenced_column_id]), N',')
      WITHIN GROUP (ORDER BY c.[constraint_column_id]) AS [columns]
    FROM sys.foreign_keys fk
    JOIN sys.foreign_key_columns c ON c.[constraint_object_id] = fk.[object_id]
    WHERE fk.[name] IN (N'HadithCitation_candidate_fkey', N'Hadith_edition_fkey', N'Hadith_book_fkey',
                        N'Hadith_chapter_fkey', N'HadithBook_edition_fkey')
    GROUP BY fk.[name];
  `);
  const describedComposite = composite
    .map((row) => `${row.name}(${row.columns})`)
    .sort()
    .join(',');
  const expectedComposite = [
    'HadithBook_edition_fkey(editionId>id,collectionId>collectionId)',
    'HadithCitation_candidate_fkey(hadithId>id,collectionId>collectionId,number>citationNumber)',
    'Hadith_book_fkey(bookId>id,editionId>editionId)',
    'Hadith_chapter_fkey(chapterId>id,bookId>bookId)',
    'Hadith_edition_fkey(editionId>id,collectionId>collectionId,sourceSystemId>sourceSystemId)',
  ]
    .sort()
    .join(',');
  if (describedComposite !== expectedComposite)
    fail(
      `A record must sit in its own edition's structure and a citation reach only a declared ` +
        `candidate; found ${describedComposite}.`,
    );

  const collations = await session.query<{ name: string; collation: string | null }>(`
    SELECT OBJECT_NAME(c.[object_id]) + N'.' + c.[name] AS [name], c.[collation_name] AS [collation]
    FROM sys.columns c
    WHERE (c.[object_id] IN (OBJECT_ID(N'[dbo].[Hadith]'), OBJECT_ID(N'[dbo].[HadithRevision]')) AND c.[name] = N'sourceReference')
       OR (c.[object_id] IN (OBJECT_ID(N'[dbo].[HadithBook]'), OBJECT_ID(N'[dbo].[HadithChapter]')) AND c.[name] = N'reference')
       OR (c.[object_id] = OBJECT_ID(N'[dbo].[HadithGrading]') AND c.[name] = N'grader');
  `);
  if (
    collations.length !== 5 ||
    collations.some((row) => row.collation !== 'Latin1_General_100_BIN2')
  )
    fail(
      `Every source reference and grader must compare by its exact bytes; found ` +
        `${JSON.stringify(collations)}.`,
    );

  // ---- 3. no cascade, exact external edges, no foreign Hadith schema ---------
  const cascading = await session.query<{ name: string }>(`
    SELECT [name] FROM sys.foreign_keys
    WHERE [parent_object_id] IN (${tables})
      AND ([delete_referential_action] <> 0 OR [update_referential_action] <> 0);
  `);
  if (cascading.length > 0)
    fail(
      `Phase-19 foreign keys must not cascade; found ${cascading.map((row) => row.name).join(', ')}.`,
    );

  const external = await session.query<{ edge: string }>(`
    SELECT fk.[name] + N'>' + OBJECT_NAME(fk.[referenced_object_id]) AS [edge]
    FROM sys.foreign_keys fk
    WHERE fk.[parent_object_id] IN (${tables}) AND fk.[referenced_object_id] NOT IN (${tables});
  `);
  const edges = external.map((row) => row.edge).sort();
  if (edges.join(',') !== HADITH_EXTERNAL_KEYS.join(','))
    fail(
      `Hadith's references into other owners must be exactly ${HADITH_EXTERNAL_KEYS.join(', ')}; ` +
        `found ${edges.join(', ')}.`,
    );

  // Phase 21's typed references are the ONE admitted exception: a saved and a
  // read public CITATION, each one column naming `HadithCitation.id` — never a
  // source-qualified record — and each refusing deletion of the citation it
  // names. Excepted by exact key and column name, never by OBJECT_ID.
  const personal = await personalisationPresent(session);
  const [ownership] = await session.query<{
    inbound: string | null;
    columns: string | null;
  }>(`
    SELECT
      (SELECT STRING_AGG(fk.[name] + N'>' + OBJECT_NAME(fk.[referenced_object_id]), N',')
          WITHIN GROUP (ORDER BY fk.[name]) FROM sys.foreign_keys fk
        WHERE fk.[referenced_object_id] IN (${tables}) AND fk.[parent_object_id] NOT IN (${tables})) AS [inbound],
      (SELECT STRING_AGG(OBJECT_NAME(c.[object_id]) + N'.' + c.[name], N',') FROM sys.columns c
        WHERE (c.[name] LIKE N'%hadith%' OR c.[name] LIKE N'%narrator%' OR c.[name] LIKE N'%isnad%'
               OR c.[name] LIKE N'%grading%')
          AND OBJECT_NAME(c.[object_id]) NOT IN (${names})
          AND NOT (OBJECT_NAME(c.[object_id]) IN (N'SavedItem', N'ReadingHistory') AND c.[name] = N'hadithCitationId')
          AND OBJECTPROPERTY(c.[object_id], 'IsUserTable') = 1) AS [columns];
  `);
  const admittedInbound = personal
    ? 'ReadingHistory_hadithCitationId_fkey>HadithCitation,SavedItem_hadithCitationId_fkey>HadithCitation'
    : '';
  if (
    (ownership?.inbound ?? '') !== admittedInbound ||
    (ownership?.columns ?? null) !== null
  )
    fail(
      `No other owner may hold Hadith schema beyond Personalisation's typed citation keys; ` +
        `found ${JSON.stringify(ownership ?? null)}.`,
    );

  const generic = await session.query<{ name: string }>(`
    SELECT OBJECT_NAME(c.[object_id]) + N'.' + c.[name] AS [name] FROM sys.columns c
    WHERE c.[object_id] IN (${tables})
      AND (c.[name] LIKE N'%type%' OR c.[name] LIKE N'%target%' OR c.[name] LIKE N'%kind%'
           OR c.[name] LIKE N'%narrator%' OR (c.[name] LIKE N'%grade%' AND c.[name] <> N'grader') OR c.[name] LIKE N'%rank%'
           OR c.[name] LIKE N'%quran%' OR c.[name] LIKE N'%surah%' OR c.[name] LIKE N'%ayah%'
           OR c.[name] LIKE N'%media%' OR c.[name] LIKE N'%work%');
  `);
  if (generic.length > 0)
    fail(
      `Hadith tables may carry no type, target, narrator, grade or foreign-context column; ` +
        `found ${JSON.stringify(generic)}.`,
    );

  // ---- 4. Unicode text everywhere it lives -----------------------------------
  const texts = await session.query<{ name: string; type: string; size: number }>(`
    SELECT OBJECT_NAME(c.[object_id]) + N'.' + c.[name] AS [name], TYPE_NAME(c.[user_type_id]) AS [type],
      c.[max_length] AS [size]
    FROM sys.columns c
    WHERE c.[name] IN (N'text', N'chain', N'body') AND c.[object_id] IN (${tables});
  `);
  const describedTexts = texts
    .map((row) => `${row.name}:${row.type}(${String(row.size)})`)
    .sort()
    .join(',');
  const expectedTexts = [
    'Hadith.chain:nvarchar(-1)',
    'Hadith.text:nvarchar(-1)',
    'HadithCommentaryEntry.text:nvarchar(-1)',
    'HadithRevision.chain:nvarchar(-1)',
    'HadithRevision.text:nvarchar(-1)',
    'HadithScienceText.body:nvarchar(-1)',
    'HadithTranslation.text:nvarchar(-1)',
  ].join(',');
  if (describedTexts !== expectedTexts)
    fail(`Hadith text columns differ: ${describedTexts}.`);

  // ---- 5. every refusal in its own place -------------------------------------
  const triggers = await session.query<{
    name: string;
    tableName: string;
    definition: string | null;
  }>(`
    SELECT t.[name], OBJECT_NAME(t.[parent_id]) AS [tableName], OBJECT_DEFINITION(t.[object_id]) AS [definition]
    FROM sys.triggers t WHERE t.[parent_id] IN (${tables});
  `);
  const describedTriggers = triggers
    .map((row) => `${row.name}@${row.tableName}:${raisedNumbers(row.definition)}`)
    .sort()
    .join(',');
  const expectedTriggers = Object.entries(HADITH_TRIGGER_NUMBERS)
    .map(([name, [table, numbers]]) => `${name}@${table}:${numbers}`)
    .sort()
    .join(',');
  if (describedTriggers !== expectedTriggers)
    fail(
      `Hadith triggers must raise exactly their own 5120x numbers; found ${describedTriggers}.`,
    );

  const procedures = await session.query<{ name: string; definition: string | null }>(`
    SELECT p.[name], OBJECT_DEFINITION(p.[object_id]) AS [definition]
    FROM sys.procedures p WHERE p.[name] LIKE N'Hadith%';
  `);
  const describedProcedures = procedures
    .map((row) => `${row.name}:${raisedNumbers(row.definition)}`)
    .sort()
    .join(',');
  const expectedProcedures = Object.entries(HADITH_PROCEDURE_NUMBERS)
    .map(([name, numbers]) => `${name}:${numbers}`)
    .sort()
    .join(',');
  if (describedProcedures !== expectedProcedures)
    fail(
      `The canonical write path must be exactly eight procedures raising their own ` +
        `5120x–5122x numbers; found ${describedProcedures}.`,
    );

  // ---- 6. three keys, all bundled -------------------------------------------
  const permissions = await session.query<{ key: string; bundled: number }>(`
    SELECT p.[key],
      (SELECT COUNT(*) FROM [dbo].[RolePermission] rp JOIN [dbo].[Role] r ON r.[id] = rp.[roleId]
       WHERE r.[key] = N'platform-administrator' AND rp.[permissionKey] = p.[key]) AS [bundled]
    FROM [dbo].[Permission] p
    WHERE p.[key] LIKE N'hadith%' OR p.[key] LIKE N'narrator%' OR p.[key] LIKE N'grading%';
  `);
  if (
    permissions
      .map((row) => row.key)
      .sort()
      .join(',') !== HADITH_PERMISSIONS.join(',') ||
    !permissions.every((row) => Number(row.bundled) === 1)
  )
    fail(
      `The Hadith vocabulary must be exactly ${HADITH_PERMISSIONS.join(', ')}, all in the ` +
        `protected bundle; found ${JSON.stringify(permissions)}.`,
    );

  report(
    'hadith foundation',
    'twenty-four empty tables, source-qualified identity and a separate citation, ' +
      'eleven non-cascading external keys, 18 triggers and 8 procedures by number, three bundled keys',
  );
}

/**
 * After the Phase-19 rollback: no Hadith table, trigger, procedure or key, no
 * `hadith.*` permission, bundle entry or purpose-bound grant, and no
 * provisioning record. The caller then proves the vocabulary and the earlier
 * owners it referenced are back.
 */
async function assertHadithRemoved(session: SqlSession): Promise<void> {
  const [row] = await session.query<{
    tables: number;
    triggers: number;
    procedures: number;
    keys: number;
    permissions: number;
    bundled: number;
    grants: number;
    audit: number;
  }>(`
    SELECT
      (SELECT COUNT(*) FROM sys.tables WHERE [name] LIKE N'Hadith%') AS [tables],
      (SELECT COUNT(*) FROM sys.triggers WHERE [name] LIKE N'Hadith%') AS [triggers],
      (SELECT COUNT(*) FROM sys.procedures WHERE [name] LIKE N'Hadith%') AS [procedures],
      (SELECT COUNT(*) FROM sys.foreign_keys WHERE [name] LIKE N'Hadith%') AS [keys],
      (SELECT COUNT(*) FROM [dbo].[Permission] WHERE [key] LIKE N'hadith.%') AS [permissions],
      (SELECT COUNT(*) FROM [dbo].[RolePermission] WHERE [permissionKey] LIKE N'hadith.%') AS [bundled],
      (SELECT COUNT(*) FROM [dbo].[StepUpGrant] WHERE [purpose] = N'hadith-canonical-edit') AS [grants],
      (SELECT COUNT(*) FROM [dbo].[AuditLog] WHERE [action] = N'hadith.permissions.provisioned') AS [audit];
  `);
  if (Object.values(row ?? { missing: 1 }).some((value) => Number(value) !== 0))
    fail(`The Phase-19 rollback left a Hadith object: ${JSON.stringify(row ?? null)}.`);
  report(
    'hadith rollback',
    'every Hadith table, trigger, procedure, key, permission, grant and provisioning record removed',
  );
}

/** Neutral Arabic "test text", and two letters differing only by their mark. */
const NON_HADITH_ARABIC = 'نص اختبار بَ بِ';

/** The UTF-16LE bytes SQL Server stores for an NVARCHAR value, as upper hex. */
function utf16Hex(text: string): string {
  return Buffer.from(text, 'utf16le').toString('hex').toUpperCase();
}

/**
 * Phase 19 — THE CANONICAL RULES, proved as behaviour against the re-deployed
 * schema with sentinel NON_HADITH_FIXTURE text only, through the migration
 * login (the runtime's own posture is `db:test:permissions`'s):
 *
 *   - every procedure refuses a caller without the live authority (51210): no
 *     permission, a Quran-purpose grant, an expired grant, another session's
 *     grant, an unknown grant, a deactivated role, a revoked assignment and an
 *     inactive account — and writes nothing;
 *   - a registered source system or edition is immutable (51200), an approved
 *     one carries its evidence, one encoding; a collection's slug is public
 *     grammar and never a reserved section word;
 *   - structure is its edition's, its references exact and unpadded, and
 *     immutable but for display-name versions (51201); a missing edition or
 *     book is refused (51211, 51212);
 *   - the SAME apparent source reference coexists across editions and
 *     collections but never twice within one edition; a bare number is no key;
 *     a record sits only in its own edition's structure (51215); evidence and
 *     reasons are required (51216); gradings are present and well formed (51217), sourced
 *     (the CHECK) and one per grader per version;
 *   - conflict detection records exactly the facets that differ — text, chain,
 *     grading, and structure only within one edition — compares bytes (a
 *     trailing space, NFC against NFD), and records nothing for identical
 *     candidates across editions; Arabic marks round-trip byte for byte;
 *   - verification binds one version (51212, 51213, 51218); a citation maps only
 *     a declared (51220), verified (51219), conflict-free (51204) candidate, by
 *     procedure and by direct insert; versions are expected (51213), changes
 *     real (51218), a new citation mapped (51216); its key is unique;
 *   - a correction refuses a stale version (51213), a record outside its
 *     edition (51212), a mapped record's new number (51214), structure outside
 *     the edition (51215), no reason (51216) and no change (51218); a valid one
 *     appends version 2 with versioned gradings, leaves the version-1
 *     verification stale and records the conflict it creates;
 *   - a record, citation and their history change only through those rules:
 *     direct changes without a revision (51202), structure (51201) and history,
 *     gradings, verification, citation history and conflict evidence (51203);
 *   - activation refuses an empty collection and an edit (51206), a second
 *     authority (51206), fixture records under approved authority (51205) and
 *     approved records under fixture authority (51208); a fixture record
 *     cannot be mapped into an approved collection, nor an approved record
 *     into a fixture one (51208), by procedure or direct insert;
 *   - a published commentary or science keeps its text (51207), a published
 *     translation names a source system; `hadith` intent is admitted and an
 *     invented Hadith kind is not; audit rows carry no text, and every one is
 *     well-formed JSON whose quoted identifiers read back exactly (escaped).
 */
async function assertHadithCanonicalRules(session: SqlSession): Promise<void> {
  const run = randomUUID().replaceAll('-', '').slice(0, 16);
  const at = '2026-10-03T00:00:00';
  let refusals = 0;
  const refuse = async (
    label: string,
    statement: string,
    numbers: readonly number[],
    rule: string,
  ): Promise<void> => {
    await expectRefusal(session, label, statement, numbers, rule);
    refusals += 1;
  };
  const count = async (statement: string): Promise<number> => {
    const [row] = await session.query<{ total: number }>(statement);
    return Number(row?.total ?? -1);
  };
  const optional = (text: string | null | undefined): string =>
    text === null || text === undefined ? 'NULL' : `N'${literal(text)}'`;

  // ---- the identities the procedures check, as authoritative rows ------------
  const holder = randomUUID();
  const outsider = randomUUID();
  const deactivated = randomUUID();
  const revoked = randomUUID();
  const inactive = randomUUID();
  const role = randomUUID();
  const deadRole = randomUUID();
  const holderSession = randomUUID();
  const otherSession = randomUUID();
  const outsiderSession = randomUUID();
  const deactivatedSession = randomUUID();
  const revokedSession = randomUUID();
  const inactiveSession = randomUUID();
  const grant = randomUUID();
  const quranPurpose = randomUUID();
  const expired = randomUUID();
  const otherSessionGrant = randomUUID();
  const outsiderGrant = randomUUID();
  const deactivatedGrant = randomUUID();
  const revokedGrant = randomUUID();
  const inactiveGrant = randomUUID();
  const user = (id: string, status: string): string =>
    `INSERT INTO [dbo].[User] ([id],[name],[email],[emailVerified],[createdAt],[updatedAt],[locale],[status],[twoFactorEnabled]) VALUES (N'${id}',N'Synthetic Hadith proof user',N'${id}@proof.invalid',0,SYSUTCDATETIME(),SYSUTCDATETIME(),N'en',N'${status}',0);`;
  const sessionRow = (id: string, userId: string): string =>
    `INSERT INTO [dbo].[Session] ([id],[token],[userId],[expiresAt],[createdAt],[updatedAt]) VALUES (N'${id}',N'proof-hadith-${id}',N'${userId}',DATEADD(hour,1,SYSUTCDATETIME()),SYSUTCDATETIME(),SYSUTCDATETIME());`;
  const grantRow = (
    id: string,
    userId: string,
    sessionId: string,
    purpose: string,
    minutes: number,
  ): string =>
    `INSERT INTO [dbo].[StepUpGrant] ([id],[userId],[sessionId],[purpose],[expiresAt]) VALUES (N'${id}',N'${userId}',N'${sessionId}',N'${purpose}',DATEADD(minute,${String(minutes)},SYSUTCDATETIME()));`;
  await expectAccepted(
    session,
    'A synthetic canonical Hadith authority',
    `${user(holder, 'active')}
     ${user(outsider, 'active')}
     ${user(deactivated, 'active')}
     ${user(revoked, 'active')}
     ${user(inactive, 'suspended')}
     INSERT INTO [dbo].[Role] ([id],[key],[name],[description],[system]) VALUES
       (N'${role}',N'proof-hadith-canonical-${run}',N'Synthetic Hadith canonical proof role',N'Holds hadith.editCanonical for the migration proof only.',0),
       (N'${deadRole}',N'proof-hadith-retired-${run}',N'Synthetic retired Hadith proof role',N'Deactivated; holds hadith.editCanonical for the migration proof only.',0);
     UPDATE [dbo].[Role] SET [deactivatedAt]=SYSUTCDATETIME() WHERE [id]=N'${deadRole}';
     INSERT INTO [dbo].[RolePermission] ([roleId],[permissionKey]) VALUES (N'${role}',N'hadith.editCanonical'),(N'${deadRole}',N'hadith.editCanonical');
     INSERT INTO [dbo].[RoleAssignment] ([userId],[roleId]) VALUES (N'${holder}',N'${role}'),(N'${deactivated}',N'${deadRole}'),(N'${inactive}',N'${role}');
     INSERT INTO [dbo].[RoleAssignment] ([userId],[roleId],[revokedAt],[revokedReason]) VALUES (N'${revoked}',N'${role}',SYSUTCDATETIME(),N'Synthetic revocation for the migration proof.');
     ${sessionRow(holderSession, holder)}
     ${sessionRow(otherSession, holder)}
     ${sessionRow(outsiderSession, outsider)}
     ${sessionRow(deactivatedSession, deactivated)}
     ${sessionRow(revokedSession, revoked)}
     ${sessionRow(inactiveSession, inactive)}
     ${grantRow(grant, holder, holderSession, 'hadith-canonical-edit', 30)}
     ${grantRow(quranPurpose, holder, holderSession, 'quran-canonical-edit', 30)}
     ${grantRow(expired, holder, holderSession, 'hadith-canonical-edit', -1)}
     ${grantRow(otherSessionGrant, holder, otherSession, 'hadith-canonical-edit', 30)}
     ${grantRow(outsiderGrant, outsider, outsiderSession, 'hadith-canonical-edit', 30)}
     ${grantRow(deactivatedGrant, deactivated, deactivatedSession, 'hadith-canonical-edit', 30)}
     ${grantRow(revokedGrant, revoked, revokedSession, 'hadith-canonical-edit', 30)}
     ${grantRow(inactiveGrant, inactive, inactiveSession, 'hadith-canonical-edit', 30)}`,
  );

  interface Authority {
    readonly actor: string;
    readonly session: string;
    readonly grant: string;
  }
  const authorised: Authority = { actor: holder, session: holderSession, grant };
  const outsiderAuthority: Authority = {
    actor: outsider,
    session: outsiderSession,
    grant: outsiderGrant,
  };
  const unauthorised: readonly (readonly [string, Authority])[] = [
    ['no permission', outsiderAuthority],
    [
      'a Quran-purpose grant',
      { actor: holder, session: holderSession, grant: quranPurpose },
    ],
    ['an expired grant', { actor: holder, session: holderSession, grant: expired }],
    [
      "another session's grant",
      { actor: holder, session: holderSession, grant: otherSessionGrant },
    ],
    ['an unknown grant', { actor: holder, session: holderSession, grant: randomUUID() }],
    [
      'a deactivated role',
      { actor: deactivated, session: deactivatedSession, grant: deactivatedGrant },
    ],
    [
      'a revoked assignment',
      { actor: revoked, session: revokedSession, grant: revokedGrant },
    ],
    [
      'an inactive account',
      { actor: inactive, session: inactiveSession, grant: inactiveGrant },
    ],
  ];
  const NO_AUTHORITY = 'Canonical Hadith authority is not held now.';

  const authority = (a: Authority): string =>
    `@actorId=N'${a.actor}', @sessionId=N'${a.session}', @stepUpGrantId=N'${a.grant}', @at='${at}'`;
  const createCollection = (
    a: Authority,
    id: string,
    slug: string,
    position: number,
  ): string =>
    `EXEC [dbo].[HadithCreateCollection] @id=N'${id}', @slug=N'${literal(slug)}', @position=${String(position)}, ${authority(a)};`;
  const createBook = (
    a: Authority,
    id: string,
    editionId: string,
    slug: string,
    reference: string,
    position: number,
    title: string | null = null,
  ): string =>
    `EXEC [dbo].[HadithCreateBook] @id=N'${id}', @editionId=N'${editionId}', @slug=N'${slug}', @reference=N'${literal(reference)}', @position=${String(position)}, @title=${optional(title)}, @titleLanguage=${title === null ? 'NULL' : "N'ar'"}, ${authority(a)};`;
  const createChapter = (
    a: Authority,
    id: string,
    bookId: string,
    slug: string,
    reference: string,
    position: number,
  ): string =>
    `EXEC [dbo].[HadithCreateChapter] @id=N'${id}', @bookId=N'${bookId}', @slug=N'${slug}', @reference=N'${literal(reference)}', @position=${String(position)}, @title=NULL, @titleLanguage=NULL, ${authority(a)};`;
  interface RecordFacts {
    readonly id: string;
    readonly edition: string;
    readonly expected: number;
    readonly reference: string;
    readonly citation: number | null;
    readonly book: string;
    readonly chapter: string | null;
    readonly text: string;
    readonly chain: string | null;
    readonly gradings: string | null;
    readonly evidence?: string | null;
    readonly reason?: string | null;
  }
  const write = (a: Authority, r: RecordFacts): string =>
    `EXEC [dbo].[HadithWriteRecord] @hadithId=N'${r.id}', @editionId=N'${r.edition}', @expectedVersion=${String(r.expected)}, @sourceReference=N'${literal(r.reference)}', @citationNumber=${r.citation === null ? 'NULL' : String(r.citation)}, @bookId=N'${r.book}', @chapterId=${r.chapter === null ? 'NULL' : `N'${r.chapter}'`}, @text=N'${literal(r.text)}', @textLanguage=N'ar', @chain=${optional(r.chain)}, @chainLanguage=${r.chain === null ? 'NULL' : "N'ar'"}, @gradings=${optional(r.gradings)}, @evidence=${r.evidence === undefined ? "N'NON_HADITH_FIXTURE_EVIDENCE_1'" : optional(r.evidence)}, @reason=${optional(r.reason)}, ${authority(a)};`;
  const verify = (a: Authority, id: string, hadithId: string, expected: number): string =>
    `EXEC [dbo].[HadithVerifyRecord] @id=N'${id}', @hadithId=N'${hadithId}', @expectedVersion=${String(expected)}, @evidence=N'NON_HADITH_FIXTURE_EVIDENCE_2', ${authority(a)};`;
  const cite = (
    a: Authority,
    collectionId: string,
    number: number,
    hadithId: string,
    state: 'mapped' | 'withdrawn',
    expected: number,
    reason: string | null,
    id: string = randomUUID(),
  ): string =>
    `EXEC [dbo].[HadithSetCitation] @id=N'${id}', @collectionId=N'${collectionId}', @number=${String(number)}, @hadithId=N'${hadithId}', @state=N'${state}', @expectedVersion=${String(expected)}, @evidence=N'NON_HADITH_FIXTURE_EVIDENCE_3', @reason=${optional(reason)}, ${authority(a)};`;
  const grading = (position: number, grader: number, label: number) => ({
    position,
    grader: `NON_HADITH_FIXTURE_GRADER_${String(grader)}`,
    label: `NON_HADITH_FIXTURE_GRADING_${String(label)}`,
    labelLanguage: 'ar',
    reference: 'NON_HADITH_FIXTURE_REFERENCE_3',
  });
  const standard = JSON.stringify([grading(0, 1, 1)]);
  const reason = 'NON_HADITH_FIXTURE correction against a registered fixture source.';

  // ---- 51210: no authority, no collection --------------------------------------
  for (const [why, held] of unauthorised)
    await refuse(
      `Collection creation refused with ${why}`,
      createCollection(held, randomUUID(), `fixture-collection-denied-${run}`, 9),
      [51210],
      NO_AUTHORITY,
    );
  await expectAccepted(
    session,
    'The Hadith authority check itself, held',
    `EXEC [dbo].[HadithAssertCanonicalAuthority] @actorId=N'${holder}', @sessionId=N'${holderSession}', @stepUpGrantId=N'${grant}';`,
  );
  await refuse(
    'The Hadith authority check itself, not held',
    `EXEC [dbo].[HadithAssertCanonicalAuthority] @actorId=N'${outsider}', @sessionId=N'${outsiderSession}', @stepUpGrantId=N'${outsiderGrant}';`,
    [51210],
    NO_AUTHORITY,
  );
  if (
    (await count(
      `SELECT COUNT(*) AS [total] FROM [dbo].[HadithCollection] WHERE [slug]=N'fixture-collection-denied-${run}';`,
    )) !== 0
  )
    fail('A refused collection creation wrote a collection.');

  // ---- the collections, through the procedure -----------------------------------
  const collectionA = randomUUID();
  const collectionB = randomUUID();
  const collectionC = randomUUID();
  const collectionD = randomUUID();
  await expectAccepted(
    session,
    'Collections created under the live authority',
    [
      createCollection(authorised, collectionA, `fixture-collection-a-${run}`, 0),
      createCollection(authorised, collectionB, `fixture-collection-b-${run}`, 1),
      createCollection(authorised, collectionC, `fixture-collection-c-${run}`, 2),
      createCollection(authorised, collectionD, `fixture-collection-d-${run}`, 3),
    ].join('\n'),
  );
  for (const [why, slug] of [
    ['a reserved section word', 'browse'],
    ['another reserved section word', 'sciences'],
    ['an uppercase letter', `Fixture-collection-${run}`],
    ['a double hyphen', `fixture--collection-${run}`],
  ] as const)
    await refuse(
      `A collection slug with ${why} is refused`,
      createCollection(authorised, randomUUID(), slug, 4),
      [547],
      'HadithCollection_slug_ck',
    );
  await refuse(
    'A reserved collection slug is refused on a direct insert too',
    `INSERT INTO [dbo].[HadithCollection] ([id],[slug],[position]) VALUES (N'${randomUUID()}',N'topics',5);`,
    [547],
    'HadithCollection_slug_ck',
  );
  await refuse(
    'A collection slug is unique',
    createCollection(authorised, randomUUID(), `fixture-collection-a-${run}`, 6),
    [2627],
    'HadithCollection_slug_key',
  );

  // ---- the sources, registered by the owner -------------------------------------
  const sourceA = randomUUID();
  const sourceB = randomUUID();
  const approved = randomUUID();
  const bare = randomUUID();
  const editionA1 = randomUUID();
  const editionA2 = randomUUID();
  const editionB1 = randomUUID();
  const editionC1 = randomUUID();
  const editionC2 = randomUUID();
  const source = (id: string, code: string, kind: 'fixture' | 'approved'): string =>
    `INSERT INTO [dbo].[HadithSourceSystem] ([id],[code],[authority],[title],[version],[encoding],[reference]) VALUES (N'${id}',N'${code}_${run}',N'${kind}',N'NON_HADITH_FIXTURE source ${code}',N'proof-1',N'utf-8',${kind === 'approved' ? "N'urn:example:non-hadith-fixture-evidence'" : 'NULL'});`;
  const edition = (
    id: string,
    collectionId: string,
    sourceId: string,
    code: string,
  ): string =>
    `INSERT INTO [dbo].[HadithEdition] ([id],[collectionId],[sourceSystemId],[code],[title]) VALUES (N'${id}',N'${collectionId}',N'${sourceId}',N'${code}',N'NON_HADITH_FIXTURE edition ${code}');`;
  await expectAccepted(
    session,
    'Source systems and editions registered by the owner',
    `${source(sourceA, 'NON_HADITH_FIXTURE_A', 'fixture')}
     ${source(sourceB, 'NON_HADITH_FIXTURE_B', 'fixture')}
     ${source(approved, 'NON_HADITH_FIXTURE_APPROVED_PROBE', 'approved')}
     ${source(bare, 'NON_HADITH_FIXTURE_BARE', 'fixture')}
     ${edition(editionA1, collectionA, sourceA, 'NON_HADITH_FIXTURE_EDITION_A1')}
     ${edition(editionA2, collectionA, sourceB, 'NON_HADITH_FIXTURE_EDITION_A2')}
     ${edition(editionB1, collectionB, sourceA, 'NON_HADITH_FIXTURE_EDITION_B1')}
     ${edition(editionC1, collectionC, approved, 'NON_HADITH_FIXTURE_EDITION_C1')}
     ${edition(editionC2, collectionC, sourceA, 'NON_HADITH_FIXTURE_EDITION_C2')}`,
  );
  const IMMUTABLE_SOURCE = 'A registered Hadith source is immutable.';
  await refuse(
    'A source system is never edited',
    `UPDATE [dbo].[HadithSourceSystem] SET [authority]=N'approved',[reference]=N'urn:example:forged' WHERE [id]=N'${sourceA}';`,
    [51200],
    IMMUTABLE_SOURCE,
  );
  await refuse(
    'A source system is never removed',
    `DELETE FROM [dbo].[HadithSourceSystem] WHERE [id]=N'${bare}';`,
    [51200],
    IMMUTABLE_SOURCE,
  );
  await refuse(
    'An edition is never edited',
    `UPDATE [dbo].[HadithEdition] SET [code]=[code] WHERE [id]=N'${editionA1}';`,
    [51200],
    IMMUTABLE_SOURCE,
  );
  await refuse(
    'An edition is never removed',
    `DELETE FROM [dbo].[HadithEdition] WHERE [id]=N'${editionC2}';`,
    [51200],
    IMMUTABLE_SOURCE,
  );
  await refuse(
    'An approved source system carries its evidence',
    `INSERT INTO [dbo].[HadithSourceSystem] ([id],[code],[authority],[title],[version],[encoding]) VALUES (N'${randomUUID()}',N'NON_HADITH_FIXTURE_NO_EVIDENCE_${run}',N'approved',N'NON_HADITH_FIXTURE',N'proof-1',N'utf-8');`,
    [547],
    'HadithSourceSystem_evidence_ck',
  );
  await refuse(
    'A source system is UTF-8',
    `INSERT INTO [dbo].[HadithSourceSystem] ([id],[code],[authority],[title],[version],[encoding]) VALUES (N'${randomUUID()}',N'NON_HADITH_FIXTURE_UTF16_${run}',N'fixture',N'NON_HADITH_FIXTURE',N'proof-1',N'utf-16');`,
    [547],
    'HadithSourceSystem_encoding_ck',
  );

  // ---- structure: each edition's own, created through the procedures ----------
  const bookA1 = randomUUID();
  const bookA2 = randomUUID();
  const bookB1 = randomUUID();
  const bookC1 = randomUUID();
  const bookC2 = randomUUID();
  const chapterA1 = randomUUID();
  const emptyChapter = randomUUID();
  const sharedBookReference = 'NON_HADITH_FIXTURE_REFERENCE_1';
  await expectAccepted(
    session,
    'Books and chapters created under the live authority',
    [
      createBook(
        authorised,
        bookA1,
        editionA1,
        `fixture-book-a1-${run}`,
        sharedBookReference,
        1,
        `NON_HADITH_FIXTURE book title ${NON_HADITH_ARABIC}`,
      ),
      createBook(
        authorised,
        bookA2,
        editionA2,
        `fixture-book-a2-${run}`,
        sharedBookReference,
        1,
      ),
      createBook(
        authorised,
        bookB1,
        editionB1,
        `fixture-book-b1-${run}`,
        sharedBookReference,
        1,
      ),
      createBook(
        authorised,
        bookC1,
        editionC1,
        `fixture-book-c1-${run}`,
        sharedBookReference,
        1,
      ),
      createBook(
        authorised,
        bookC2,
        editionC2,
        `fixture-book-c2-${run}`,
        sharedBookReference,
        1,
      ),
      createChapter(
        authorised,
        chapterA1,
        bookA1,
        `fixture-chapter-a1-${run}`,
        'NON_HADITH_FIXTURE_REFERENCE_2',
        1,
      ),
      createChapter(
        authorised,
        emptyChapter,
        bookA1,
        `fixture-chapter-a2-${run}`,
        'NON_HADITH_FIXTURE_REFERENCE_5',
        2,
      ),
    ].join('\n'),
  );
  for (const [label, statement, numbers, rule] of [
    [
      'A book needs the live authority',
      createBook(
        outsiderAuthority,
        randomUUID(),
        editionA1,
        `fixture-book-x-${run}`,
        'NON_HADITH_FIXTURE_REFERENCE_9',
        9,
      ),
      [51210],
      NO_AUTHORITY,
    ],
    [
      'A chapter needs the live authority',
      createChapter(
        outsiderAuthority,
        randomUUID(),
        bookA1,
        `fixture-chapter-x-${run}`,
        'NON_HADITH_FIXTURE_REFERENCE_9',
        9,
      ),
      [51210],
      NO_AUTHORITY,
    ],
    [
      'A book names a registered edition',
      createBook(
        authorised,
        randomUUID(),
        randomUUID(),
        `fixture-book-x-${run}`,
        'NON_HADITH_FIXTURE_REFERENCE_9',
        9,
      ),
      [51211],
      'The Hadith edition is not registered.',
    ],
    [
      'A chapter names an existing book',
      createChapter(
        authorised,
        randomUUID(),
        randomUUID(),
        `fixture-chapter-x-${run}`,
        'NON_HADITH_FIXTURE_REFERENCE_9',
        9,
      ),
      [51212],
      'The Hadith record does not exist.',
    ],
    [
      "A book's slug is unique within its collection, across editions",
      createBook(
        authorised,
        randomUUID(),
        editionA2,
        `fixture-book-a1-${run}`,
        'NON_HADITH_FIXTURE_REFERENCE_9',
        9,
      ),
      [2627],
      'HadithBook_slug_key',
    ],
    [
      "A book's source reference is unique within its edition",
      createBook(
        authorised,
        randomUUID(),
        editionA1,
        `fixture-book-x-${run}`,
        sharedBookReference,
        9,
      ),
      [2627],
      'HadithBook_reference_key',
    ],
    [
      "A book's source reference is never padded",
      createBook(
        authorised,
        randomUUID(),
        editionA1,
        `fixture-book-x-${run}`,
        'NON_HADITH_FIXTURE_REFERENCE_9 ',
        9,
      ),
      [547],
      'HadithBook_ck',
    ],
    [
      "A chapter's position is unique within its book",
      createChapter(
        authorised,
        randomUUID(),
        bookA1,
        `fixture-chapter-x-${run}`,
        'NON_HADITH_FIXTURE_REFERENCE_9',
        1,
      ),
      [2627],
      'HadithChapter_position_key',
    ],
  ] as const)
    await refuse(label, statement, numbers, rule);

  const STRUCTURE = 'Canonical Hadith structure is immutable.';
  for (const [label, statement] of [
    [
      "A collection's slug never changes",
      `UPDATE [dbo].[HadithCollection] SET [slug]=N'fixture-collection-moved-${run}' WHERE [id]=N'${collectionA}';`,
    ],
    [
      "A collection's names version moves by exactly one",
      `UPDATE [dbo].[HadithCollection] SET [namesVersion]=[namesVersion]+2 WHERE [id]=N'${collectionA}';`,
    ],
    [
      'A collection is never removed',
      `DELETE FROM [dbo].[HadithCollection] WHERE [id]=N'${collectionD}';`,
    ],
    [
      "A book's source reference never changes",
      `UPDATE [dbo].[HadithBook] SET [reference]=[reference] WHERE [id]=N'${bookA1}';`,
    ],
    [
      "A book's edition never changes",
      `UPDATE [dbo].[HadithBook] SET [editionId]=[editionId] WHERE [id]=N'${bookA1}';`,
    ],
    [
      "A book's title never changes",
      `UPDATE [dbo].[HadithBook] SET [title]=NULL,[titleLanguage]=NULL WHERE [id]=N'${bookA1}';`,
    ],
    [
      "A chapter's slug never changes",
      `UPDATE [dbo].[HadithChapter] SET [slug]=[slug] WHERE [id]=N'${chapterA1}';`,
    ],
    [
      'A chapter is never removed',
      `DELETE FROM [dbo].[HadithChapter] WHERE [id]=N'${emptyChapter}';`,
    ],
  ] as const)
    await refuse(label, statement, [51201], STRUCTURE);
  await expectAccepted(
    session,
    'Display-name versions advance by one',
    `UPDATE [dbo].[HadithCollection] SET [namesVersion]=[namesVersion]+1,[updatedAt]=SYSUTCDATETIME() WHERE [id]=N'${collectionA}';
     UPDATE [dbo].[HadithBook] SET [namesVersion]=[namesVersion]+1,[updatedAt]=SYSUTCDATETIME() WHERE [id]=N'${bookA1}';
     UPDATE [dbo].[HadithChapter] SET [namesVersion]=[namesVersion]+1,[updatedAt]=SYSUTCDATETIME() WHERE [id]=N'${chapterA1}';`,
  );

  // ---- source-qualified records ----------------------------------------------------
  //
  // One apparent reference, `NON_HADITH_FIXTURE_REFERENCE_7`, in two editions of
  // collection A and in collection B: three records, no collision, because the
  // identity is the edition's and a number is nobody's key.
  const sharedReference = 'NON_HADITH_FIXTURE_REFERENCE_7';
  const sevenText = `NON_HADITH_FIXTURE_TEXT_7 ${NON_HADITH_ARABIC}`;
  const chain = 'NON_HADITH_FIXTURE_CHAIN_1';
  const recordA = randomUUID();
  const recordA2 = randomUUID();
  const recordB = randomUUID();
  const base = (
    id: string,
    editionId: string,
    reference: string,
    citation: number | null,
    book: string,
    text: string,
  ): RecordFacts => ({
    id,
    edition: editionId,
    expected: 0,
    reference,
    citation,
    book,
    chapter: null,
    text,
    chain,
    gradings: standard,
  });
  for (const [why, held] of unauthorised.slice(0, 2))
    await refuse(
      `Record creation refused with ${why}`,
      write(held, base(randomUUID(), editionA1, sharedReference, 7, bookA1, sevenText)),
      [51210],
      NO_AUTHORITY,
    );
  await expectAccepted(
    session,
    'One apparent reference in two editions and two collections',
    [
      write(authorised, {
        ...base(recordA, editionA1, sharedReference, 7, bookA1, sevenText),
        chapter: chapterA1,
      }),
      write(authorised, base(recordA2, editionA2, sharedReference, 7, bookA2, sevenText)),
      write(authorised, base(recordB, editionB1, sharedReference, 7, bookB1, sevenText)),
    ].join('\n'),
  );
  if (
    (await count(
      `SELECT COUNT(DISTINCT [editionId]) AS [total] FROM [dbo].[Hadith] WHERE CAST([sourceReference] AS VARBINARY(128))=CAST(N'${sharedReference}' AS VARBINARY(128));`,
    )) !== 3 ||
    (await count(
      `SELECT COUNT(*) AS [total] FROM [dbo].[Hadith] WHERE [citationNumber]=7;`,
    )) !== 3
  )
    fail('One apparent reference and one bare number must coexist in three editions.');

  const UNWELL = 'The gradings are not well formed.';
  const longLabel = `NON_HADITH_FIXTURE_GRADING_${'x'.repeat(380)}`;
  for (const [label, statement, numbers, rule] of [
    [
      'The same reference is never repeated within one edition',
      write(
        authorised,
        base(randomUUID(), editionA1, sharedReference, 7, bookA1, sevenText),
      ),
      [2627],
      'Hadith_identity_key',
    ],
    [
      'A source reference is never padded',
      write(
        authorised,
        base(
          randomUUID(),
          editionA1,
          'NON_HADITH_FIXTURE_REFERENCE_99 ',
          99,
          bookA1,
          sevenText,
        ),
      ),
      [547],
      'Hadith_ck',
    ],
    [
      'A source reference carries no control character',
      write(
        authorised,
        base(
          randomUUID(),
          editionA1,
          'NON_HADITH_FIXTURE_REFERENCE\t99',
          99,
          bookA1,
          sevenText,
        ),
      ),
      [547],
      'Hadith_ck',
    ],
    [
      'A citation number is bounded',
      write(
        authorised,
        base(
          randomUUID(),
          editionA1,
          'NON_HADITH_FIXTURE_REFERENCE_98',
          1000000,
          bookA1,
          sevenText,
        ),
      ),
      [547],
      'Hadith_ck',
    ],
    [
      'A record names a registered edition',
      write(
        authorised,
        base(
          randomUUID(),
          randomUUID(),
          'NON_HADITH_FIXTURE_REFERENCE_98',
          98,
          bookA1,
          sevenText,
        ),
      ),
      [51211],
      'The Hadith edition is not registered.',
    ],
    [
      "A record sits in its own edition's book",
      write(
        authorised,
        base(
          randomUUID(),
          editionA1,
          'NON_HADITH_FIXTURE_REFERENCE_98',
          98,
          bookA2,
          sevenText,
        ),
      ),
      [51215],
      'The structure does not belong to the edition.',
    ],
    [
      "A record's chapter belongs to its book",
      write(authorised, {
        ...base(
          randomUUID(),
          editionA2,
          'NON_HADITH_FIXTURE_REFERENCE_98',
          98,
          bookA2,
          sevenText,
        ),
        chapter: chapterA1,
      }),
      [51215],
      'The structure does not belong to the edition.',
    ],
    [
      'A record states its evidence',
      write(authorised, {
        ...base(
          randomUUID(),
          editionA1,
          'NON_HADITH_FIXTURE_REFERENCE_98',
          98,
          bookA1,
          sevenText,
        ),
        evidence: null,
      }),
      [51216],
      'A canonical change states its evidence.',
    ],
    [
      'Gradings that are not JSON are refused',
      write(authorised, {
        ...base(
          randomUUID(),
          editionA1,
          'NON_HADITH_FIXTURE_REFERENCE_98',
          98,
          bookA1,
          sevenText,
        ),
        gradings: 'NON_HADITH_FIXTURE not json',
      }),
      [51217],
      UNWELL,
    ],
    [
      // ISJSON(NULL) is NULL, not 0: a missing list is refused, never read as
      // "no gradings".
      'Missing gradings are refused, never read as none',
      write(authorised, {
        ...base(
          randomUUID(),
          editionA1,
          'NON_HADITH_FIXTURE_REFERENCE_98',
          98,
          bookA1,
          sevenText,
        ),
        gradings: null,
      }),
      [51217],
      UNWELL,
    ],
    [
      'A grading without its reference is refused',
      write(authorised, {
        ...base(
          randomUUID(),
          editionA1,
          'NON_HADITH_FIXTURE_REFERENCE_98',
          98,
          bookA1,
          sevenText,
        ),
        gradings: JSON.stringify([{ ...grading(0, 1, 1), reference: undefined }]),
      }),
      [51217],
      UNWELL,
    ],
    [
      'Two gradings in one position are refused',
      write(authorised, {
        ...base(
          randomUUID(),
          editionA1,
          'NON_HADITH_FIXTURE_REFERENCE_98',
          98,
          bookA1,
          sevenText,
        ),
        gradings: JSON.stringify([grading(0, 1, 1), grading(0, 2, 1)]),
      }),
      [51217],
      UNWELL,
    ],
    [
      'A grading label too long for its column is refused, never truncated',
      write(authorised, {
        ...base(
          randomUUID(),
          editionA1,
          'NON_HADITH_FIXTURE_REFERENCE_98',
          98,
          bookA1,
          sevenText,
        ),
        gradings: JSON.stringify([{ ...grading(0, 1, 1), label: longLabel }]),
      }),
      [51217],
      UNWELL,
    ],
    [
      'A grading names its published reference',
      write(authorised, {
        ...base(
          randomUUID(),
          editionA1,
          'NON_HADITH_FIXTURE_REFERENCE_98',
          98,
          bookA1,
          sevenText,
        ),
        gradings: JSON.stringify([{ ...grading(0, 1, 1), reference: '' }]),
      }),
      [547],
      'HadithGrading_ck',
    ],
    [
      'One grader grades one version once',
      write(authorised, {
        ...base(
          randomUUID(),
          editionA1,
          'NON_HADITH_FIXTURE_REFERENCE_98',
          98,
          bookA1,
          sevenText,
        ),
        gradings: JSON.stringify([grading(0, 1, 1), grading(1, 1, 2)]),
      }),
      [2627],
      'HadithGrading_grader_key',
    ],
    [
      'A source-less grading is refused on a direct insert too',
      `INSERT INTO [dbo].[HadithGrading] ([hadithId],[version],[position],[grader],[label],[labelLanguage],[reference]) VALUES (N'${recordA}',1,5,N'NON_HADITH_FIXTURE_GRADER_5',N'NON_HADITH_FIXTURE_GRADING_5',N'ar',N'');`,
      [547],
      'HadithGrading_ck',
    ],
  ] as const)
    await refuse(label, statement, numbers, rule);
  if (
    (await count(
      `SELECT COUNT(*) AS [total] FROM [dbo].[Hadith] WHERE [sourceReference] LIKE N'NON[_]HADITH[_]FIXTURE[_]REFERENCE[_]9%';`,
    )) !== 0
  )
    fail('A refused record write left a record behind.');

  // ---- conflict evidence: exactly the facets that differ ---------------------------
  //
  // Citation 8 differs by ONE TRAILING SPACE, citation 9 by NFC against NFD of
  // the same letter, citation 10 by chain, citation 11 by one shared grader's
  // label, and citation 12 by placement WITHIN edition A1 — while a third
  // candidate for 12 in edition A2, placed differently but otherwise identical,
  // and the identical candidates for 7 in two editions conflict with nothing.
  const composed = 'NON_HADITH_FIXTURE_TEXT_9 é';
  const decomposed = 'NON_HADITH_FIXTURE_TEXT_9 é';
  const candidates = {
    eightA: randomUUID(),
    eightB: randomUUID(),
    nineA: randomUUID(),
    nineB: randomUUID(),
    tenA: randomUUID(),
    tenB: randomUUID(),
    elevenA: randomUUID(),
    elevenB: randomUUID(),
    twelveA: randomUUID(),
    twelveB: randomUUID(),
    twelveC: randomUUID(),
    fourteen: randomUUID(),
    plain: randomUUID(),
  };
  const twelveText = 'NON_HADITH_FIXTURE_TEXT_12';
  const reference = (n: string): string => `NON_HADITH_FIXTURE_REFERENCE_${n}`;
  await expectAccepted(
    session,
    'Candidates that differ by one facet each',
    [
      write(
        authorised,
        base(
          candidates.eightA,
          editionA1,
          reference('8'),
          8,
          bookA1,
          'NON_HADITH_FIXTURE_TEXT_8',
        ),
      ),
      write(
        authorised,
        base(
          candidates.eightB,
          editionA2,
          reference('8'),
          8,
          bookA2,
          'NON_HADITH_FIXTURE_TEXT_8 ',
        ),
      ),
      write(
        authorised,
        base(candidates.nineA, editionA1, reference('9'), 9, bookA1, composed),
      ),
      write(
        authorised,
        base(candidates.nineB, editionA2, reference('9'), 9, bookA2, decomposed),
      ),
      write(
        authorised,
        base(
          candidates.tenA,
          editionA1,
          reference('10'),
          10,
          bookA1,
          'NON_HADITH_FIXTURE_TEXT_10',
        ),
      ),
      write(authorised, {
        ...base(
          candidates.tenB,
          editionA2,
          reference('10'),
          10,
          bookA2,
          'NON_HADITH_FIXTURE_TEXT_10',
        ),
        chain: 'NON_HADITH_FIXTURE_CHAIN_2',
      }),
      write(
        authorised,
        base(
          candidates.elevenA,
          editionA1,
          reference('11'),
          11,
          bookA1,
          'NON_HADITH_FIXTURE_TEXT_11',
        ),
      ),
      write(authorised, {
        ...base(
          candidates.elevenB,
          editionA2,
          reference('11'),
          11,
          bookA2,
          'NON_HADITH_FIXTURE_TEXT_11',
        ),
        gradings: JSON.stringify([grading(0, 1, 2)]),
      }),
      write(authorised, {
        ...base(candidates.twelveA, editionA1, reference('12A'), 12, bookA1, twelveText),
        chapter: chapterA1,
      }),
      write(
        authorised,
        base(candidates.twelveB, editionA1, reference('12B'), 12, bookA1, twelveText),
      ),
      write(
        authorised,
        base(candidates.twelveC, editionA2, reference('12'), 12, bookA2, twelveText),
      ),
      write(
        authorised,
        base(
          candidates.fourteen,
          editionA1,
          reference('14'),
          14,
          bookA1,
          'NON_HADITH_FIXTURE_TEXT_14',
        ),
      ),
      write(authorised, {
        ...base(
          candidates.plain,
          editionB1,
          reference('20'),
          null,
          bookB1,
          'NON_HADITH_FIXTURE_TEXT_20',
        ),
        chain: null,
        gradings: '[]',
      }),
    ].join('\n'),
  );
  const conflicts = await session.query<{
    number: number;
    facets: string;
    versions: string;
  }>(`
    SELECT [citationNumber] AS [number], [facets],
      CONVERT(NVARCHAR(8), [hadithVersion]) + N'/' + CONVERT(NVARCHAR(8), [otherVersion]) AS [versions]
    FROM [dbo].[HadithConflict] WHERE [collectionId]=N'${collectionA}'
    ORDER BY [citationNumber], [facets];
  `);
  const expectedConflicts = JSON.stringify([
    { number: 8, facets: 'text', versions: '1/1' },
    { number: 9, facets: 'text', versions: '1/1' },
    { number: 10, facets: 'chain', versions: '1/1' },
    { number: 11, facets: 'grading', versions: '1/1' },
    { number: 12, facets: 'structure', versions: '1/1' },
  ]);
  if (JSON.stringify(conflicts) !== expectedConflicts)
    fail(
      `Conflict detection must record exactly the differing facets; found ${JSON.stringify(conflicts)}.`,
    );
  const [pairs] = await session.query<Record<string, number>>(`
    SELECT
      (SELECT COUNT(*) FROM [dbo].[HadithConflict] WHERE [hadithId]=N'${candidates.eightB}' AND [otherHadithId]=N'${candidates.eightA}') AS [eight],
      (SELECT COUNT(*) FROM [dbo].[HadithConflict] WHERE [hadithId]=N'${candidates.twelveB}' AND [otherHadithId]=N'${candidates.twelveA}') AS [twelve],
      (SELECT COUNT(*) FROM [dbo].[HadithConflict] WHERE N'${candidates.twelveC}' IN ([hadithId],[otherHadithId])) AS [crossEdition],
      (SELECT COUNT(*) FROM [dbo].[HadithConflict] WHERE [collectionId]<>N'${collectionA}') AS [elsewhere];
  `);
  if (JSON.stringify(pairs) !== '{"eight":1,"twelve":1,"crossEdition":0,"elsewhere":0}')
    fail(`Conflict evidence names the wrong candidates: ${JSON.stringify(pairs)}.`);

  // ---- exact bytes, kept ------------------------------------------------------------
  const kept = await session.query<{ id: string; bytes: string; revision: number }>(`
    SELECT h.[id], CONVERT(VARCHAR(MAX), CAST(h.[text] AS VARBINARY(MAX)), 2) AS [bytes],
      (SELECT COUNT(*) FROM [dbo].[HadithRevision] r WHERE r.[hadithId]=h.[id] AND r.[version]=h.[version]
         AND CAST(r.[text] AS VARBINARY(MAX))=CAST(h.[text] AS VARBINARY(MAX))) AS [revision]
    FROM [dbo].[Hadith] h WHERE h.[id] IN (N'${recordA}',N'${candidates.eightB}',N'${candidates.nineA}',N'${candidates.nineB}');
  `);
  const bytes = new Map(kept.map((row) => [row.id, row]));
  for (const [id, text] of [
    [recordA, sevenText],
    [candidates.eightB, 'NON_HADITH_FIXTURE_TEXT_8 '],
    [candidates.nineA, composed],
    [candidates.nineB, decomposed],
  ] as const) {
    const row = bytes.get(id);
    if (row?.bytes !== utf16Hex(text) || Number(row.revision) !== 1)
      fail(
        `A record's text must be kept and recorded byte for byte, marks and spaces included; ` +
          `found ${JSON.stringify(row ?? null)}.`,
      );
  }

  // ---- verification binds one version ------------------------------------------------
  const verificationA = randomUUID();
  const CHANGED = 'The Hadith record changed since it was reviewed.';
  const UNCHANGED = 'The correction changes nothing.';
  for (const [label, statement, numbers, rule] of [
    [
      'Verification needs the live authority',
      verify(outsiderAuthority, randomUUID(), recordA, 1),
      [51210],
      NO_AUTHORITY,
    ],
    [
      'Verification names an existing record',
      verify(authorised, randomUUID(), randomUUID(), 1),
      [51212],
      'The Hadith record does not exist.',
    ],
    [
      'Verification of another version is refused',
      verify(authorised, randomUUID(), recordA, 2),
      [51213],
      CHANGED,
    ],
  ] as const)
    await refuse(label, statement, numbers, rule);
  await expectAccepted(
    session,
    'A record verified at its version',
    `${verify(authorised, verificationA, recordA, 1)}
     ${verify(authorised, randomUUID(), candidates.eightA, 1)}
     ${verify(authorised, randomUUID(), candidates.fourteen, 1)}`,
  );
  await refuse(
    'A version is verified once',
    verify(authorised, randomUUID(), recordA, 1),
    [51218],
    UNCHANGED,
  );

  // ---- the citation: a declared, verified, conflict-free candidate ------------------
  const citationA = randomUUID();
  const NOT_VERIFIED = 'The record is not verified at its current version.';
  const NOT_CANDIDATE = 'The record is not a candidate for this citation.';
  const CONFLICTED = 'A conflicted citation cannot be mapped.';
  for (const [label, statement, numbers, rule] of [
    [
      'A citation needs the live authority',
      cite(outsiderAuthority, collectionA, 7, recordA, 'mapped', 0, null),
      [51210],
      NO_AUTHORITY,
    ],
    [
      'An unverified candidate is never mapped',
      cite(authorised, collectionA, 7, recordA2, 'mapped', 0, null),
      [51219],
      NOT_VERIFIED,
    ],
    [
      'A record maps only the number it declared',
      cite(authorised, collectionA, 13, recordA, 'mapped', 0, null),
      [51220],
      NOT_CANDIDATE,
    ],
    [
      'A record maps only in its own collection',
      cite(authorised, collectionB, 7, recordA, 'mapped', 0, null),
      [51220],
      NOT_CANDIDATE,
    ],
    [
      'A new citation is mapped, never withdrawn',
      cite(authorised, collectionA, 7, recordA, 'withdrawn', 0, null),
      [51216],
      'A new citation is mapped.',
    ],
    [
      'A conflicted citation is never mapped',
      cite(authorised, collectionA, 8, candidates.eightA, 'mapped', 0, null),
      [51204],
      CONFLICTED,
    ],
    [
      'A conflicted citation is never mapped by a direct insert either',
      `INSERT INTO [dbo].[HadithCitation] ([collectionId],[number],[id],[hadithId],[state],[version]) VALUES (N'${collectionA}',8,N'${randomUUID()}',N'${candidates.eightA}',N'mapped',1);`,
      [51204],
      CONFLICTED,
    ],
    [
      'A citation reaches only a declared candidate on a direct insert',
      `INSERT INTO [dbo].[HadithCitation] ([collectionId],[number],[id],[hadithId],[state],[version]) VALUES (N'${collectionA}',13,N'${randomUUID()}',N'${recordA}',N'mapped',1);`,
      [547],
      'HadithCitation_candidate_fkey',
    ],
  ] as const)
    await refuse(label, statement, numbers, rule);
  await expectAccepted(
    session,
    'A verified candidate is mapped',
    cite(authorised, collectionA, 7, recordA, 'mapped', 0, null, citationA),
  );
  const [mapped] = await session.query<Record<string, number>>(`
    SELECT
      (SELECT COUNT(*) FROM [dbo].[HadithCitation] WHERE [id]=N'${citationA}' AND [collectionId]=N'${collectionA}'
         AND [number]=7 AND [hadithId]=N'${recordA}' AND [state]=N'mapped' AND [version]=1) AS [citation],
      (SELECT COUNT(*) FROM [dbo].[HadithCitationRevision] WHERE [collectionId]=N'${collectionA}' AND [number]=7
         AND [version]=1 AND [actorId]=N'${holder}' AND [stepUpGrantId]=N'${grant}' AND [reason] IS NULL) AS [revision],
      (SELECT COUNT(*) FROM [dbo].[SearchIndexRequest] WHERE [scopeKind]=N'hadith' AND [scopeId]=N'${citationA}') AS [intent],
      (SELECT COUNT(*) FROM [dbo].[AuditLog] WHERE [action]=N'hadith.citation.set' AND [targetId]=N'${citationA}'
         AND [actorId]=N'${holder}' AND [authorisingSource]=N'step-up:${grant}') AS [audit];
  `);
  if (JSON.stringify(mapped) !== '{"citation":1,"revision":1,"intent":1,"audit":1}')
    fail(
      `A mapping must be recorded with its history, intent and audit: ${JSON.stringify(mapped)}.`,
    );
  for (const [label, statement, numbers, rule] of [
    [
      'A citation is created once',
      cite(authorised, collectionA, 7, recordA, 'mapped', 0, null),
      [51213],
      CHANGED,
    ],
    [
      'A citation change states its reason',
      cite(authorised, collectionA, 7, recordA, 'withdrawn', 1, null),
      [51216],
      'A correction states its reason.',
    ],
    [
      'A citation change changes something',
      cite(authorised, collectionA, 7, recordA, 'mapped', 1, reason),
      [51218],
      UNCHANGED,
    ],
    [
      "A citation's key is unique",
      `INSERT INTO [dbo].[HadithCitation] ([collectionId],[number],[id],[hadithId],[state],[version]) VALUES (N'${collectionA}',7,N'${randomUUID()}',N'${recordA}',N'mapped',1);`,
      [2627],
      'HadithCitation_pkey',
    ],
  ] as const)
    await refuse(label, statement, numbers, rule);
  await expectAccepted(
    session,
    'A citation is withdrawn and mapped again, by version',
    `${cite(authorised, collectionA, 7, recordA, 'withdrawn', 1, reason)}
     ${cite(authorised, collectionA, 7, recordA, 'mapped', 2, reason)}`,
  );

  // ---- corrections -----------------------------------------------------------------
  const correction = (overrides: Partial<RecordFacts>): string =>
    write(authorised, {
      ...base(recordA, editionA1, sharedReference, 7, bookA1, sevenText),
      chapter: chapterA1,
      expected: 1,
      reason,
      ...overrides,
    });
  const correctedText = `NON_HADITH_FIXTURE_TEXT_7 corrected ${NON_HADITH_ARABIC}`;
  for (const [label, statement, numbers, rule] of [
    [
      'A correction needs the live authority',
      write(outsiderAuthority, {
        ...base(recordA, editionA1, sharedReference, 7, bookA1, correctedText),
        chapter: chapterA1,
        expected: 1,
        reason,
      }),
      [51210],
      NO_AUTHORITY,
    ],
    [
      'A stale correction is refused',
      correction({ expected: 5, text: correctedText }),
      [51213],
      CHANGED,
    ],
    [
      "A correction names the record's own edition",
      correction({
        edition: editionA2,
        book: bookA2,
        chapter: null,
        text: correctedText,
      }),
      [51212],
      'The Hadith record does not exist.',
    ],
    [
      'A mapped record keeps its citation number',
      correction({ citation: 70, text: correctedText }),
      [51214],
      'A mapped record keeps its citation.',
    ],
    [
      "A correction stays in the record's edition",
      correction({ book: bookA2, chapter: null, text: correctedText }),
      [51215],
      'The structure does not belong to the edition.',
    ],
    [
      'A correction states its reason',
      correction({ reason: null, text: correctedText }),
      [51216],
      'A correction states its reason.',
    ],
    ['A correction that changes nothing is refused', correction({}), [51218], UNCHANGED],
  ] as const)
    await refuse(label, statement, numbers, rule);
  await expectAccepted(
    session,
    'A correction with a new grading version',
    correction({ text: correctedText, gradings: JSON.stringify([grading(0, 1, 2)]) }),
  );
  const [corrected] = await session.query<Record<string, number | string>>(`
    SELECT h.[version],
      CONVERT(VARCHAR(MAX), CAST(h.[text] AS VARBINARY(MAX)), 2) AS [bytes],
      (SELECT COUNT(*) FROM [dbo].[HadithRevision] r WHERE r.[hadithId]=h.[id] AND r.[version]=2
         AND r.[operation]=N'corrected' AND r.[reason]=N'${literal(reason)}' AND r.[actorId]=N'${holder}'
         AND CAST(r.[text] AS VARBINARY(MAX))=CAST(h.[text] AS VARBINARY(MAX))) AS [revision],
      (SELECT COUNT(*) FROM [dbo].[HadithRevision] r WHERE r.[hadithId]=h.[id] AND r.[version]=1
         AND CONVERT(VARCHAR(MAX), CAST(r.[text] AS VARBINARY(MAX)), 2)='${utf16Hex(sevenText)}') AS [original],
      (SELECT STRING_AGG(CONVERT(NVARCHAR(8), g.[version]) + N':' + g.[label], N',') WITHIN GROUP (ORDER BY g.[version])
         FROM [dbo].[HadithGrading] g WHERE g.[hadithId]=h.[id]) AS [gradings],
      (SELECT COUNT(*) FROM [dbo].[HadithVerification] v WHERE v.[hadithId]=h.[id] AND v.[version]=h.[version]) AS [verifiedNow],
      (SELECT [facets] FROM [dbo].[HadithConflict] c WHERE c.[hadithId]=h.[id] AND c.[hadithVersion]=2
         AND c.[otherHadithId]=N'${recordA2}' AND c.[otherVersion]=1) AS [conflict],
      (SELECT COUNT(*) FROM [dbo].[HadithConflict] c WHERE c.[hadithId]=h.[id] AND c.[otherHadithId]=N'${recordB}') AS [otherCollection]
    FROM [dbo].[Hadith] h WHERE h.[id]=N'${recordA}';
  `);
  if (
    JSON.stringify(corrected) !==
    JSON.stringify({
      version: 2,
      bytes: utf16Hex(correctedText),
      revision: 1,
      original: 1,
      gradings: '1:NON_HADITH_FIXTURE_GRADING_1,2:NON_HADITH_FIXTURE_GRADING_2',
      verifiedNow: 0,
      conflict: 'text,grading',
      otherCollection: 0,
    })
  )
    fail(
      `A correction must append version 2 and nothing else: ${JSON.stringify(corrected)}.`,
    );
  await refuse(
    'A stale verification cannot be replayed on the new version',
    verify(authorised, randomUUID(), recordA, 1),
    [51213],
    CHANGED,
  );
  await expectAccepted(
    session,
    'A conflicted citation can always be withdrawn',
    cite(authorised, collectionA, 7, recordA, 'withdrawn', 3, reason),
  );
  await refuse(
    'A citation the correction conflicted is never mapped again',
    cite(authorised, collectionA, 7, recordA, 'mapped', 4, reason),
    [51204],
    CONFLICTED,
  );

  // ---- direct changes: history first, or nothing --------------------------------
  //
  // A record and a citation the procedures wrote are held by their history's
  // keys, so a DELETE of one would be refused by a foreign key before any
  // trigger ran. The owner writes one of each WITHOUT history, so removal is
  // refused by the immutability rule itself.
  const bareRecord = randomUUID();
  const bareCitation = randomUUID();
  await expectAccepted(
    session,
    'The owner inserts a record and a citation with no history, to prove removal',
    `INSERT INTO [dbo].[Hadith] ([id],[collectionId],[sourceSystemId],[editionId],[sourceReference],[citationNumber],[bookId],[chapterId],[text],[textLanguage],[chain],[chainLanguage],[version]) VALUES (N'${bareRecord}',N'${collectionB}',N'${sourceA}',N'${editionB1}',N'${reference('21')}',NULL,N'${bookB1}',NULL,N'NON_HADITH_FIXTURE_TEXT_21',N'ar',NULL,NULL,1);
     INSERT INTO [dbo].[HadithCitation] ([collectionId],[number],[id],[hadithId],[state],[version]) VALUES (N'${collectionB}',7,N'${bareCitation}',N'${recordB}',N'withdrawn',1);`,
  );
  const HISTORY = 'Canonical Hadith history is immutable.';
  for (const [label, statement, numbers, rule] of [
    [
      'A record is never removed',
      `DELETE FROM [dbo].[Hadith] WHERE [id]=N'${bareRecord}';`,
      [51201],
      STRUCTURE,
    ],
    [
      "A record's edition never changes",
      `UPDATE [dbo].[Hadith] SET [editionId]=[editionId] WHERE [id]=N'${recordA}';`,
      [51201],
      STRUCTURE,
    ],
    [
      "A record's text never changes in place",
      `UPDATE [dbo].[Hadith] SET [text]=N'NON_HADITH_FIXTURE_TEXT_TAMPERED' WHERE [id]=N'${recordA}';`,
      [51202],
      'A canonical change must advance the version by one.',
    ],
    [
      'A new version without its revision is refused',
      `UPDATE [dbo].[Hadith] SET [text]=N'NON_HADITH_FIXTURE_TEXT_TAMPERED',[version]=[version]+1 WHERE [id]=N'${recordA}';`,
      [51202],
      'A canonical change must be recorded in its history.',
    ],
    [
      'A citation never changes without its revision',
      `UPDATE [dbo].[HadithCitation] SET [state]=N'withdrawn',[version]=[version]+1 WHERE [id]=N'${citationA}';`,
      [51202],
      'A canonical change must be recorded in its history.',
    ],
    [
      "A citation's state never changes in place",
      `UPDATE [dbo].[HadithCitation] SET [state]=N'withdrawn' WHERE [id]=N'${citationA}';`,
      [51202],
      'A canonical change must advance the version by one.',
    ],
    [
      "A citation's number never changes",
      `UPDATE [dbo].[HadithCitation] SET [number]=[number] WHERE [id]=N'${citationA}';`,
      [51201],
      STRUCTURE,
    ],
    [
      'A citation is never removed',
      `DELETE FROM [dbo].[HadithCitation] WHERE [id]=N'${bareCitation}';`,
      [51201],
      STRUCTURE,
    ],
    [
      'A revision is never edited',
      `UPDATE [dbo].[HadithRevision] SET [evidence]=[evidence] WHERE [hadithId]=N'${recordA}';`,
      [51203],
      HISTORY,
    ],
    [
      'A revision is never removed',
      `DELETE FROM [dbo].[HadithRevision] WHERE [hadithId]=N'${candidates.plain}';`,
      [51203],
      HISTORY,
    ],
    [
      'A grading is never edited',
      `UPDATE [dbo].[HadithGrading] SET [label]=N'NON_HADITH_FIXTURE_GRADING_9' WHERE [hadithId]=N'${recordA}';`,
      [51203],
      HISTORY,
    ],
    [
      'A grading is never removed',
      `DELETE FROM [dbo].[HadithGrading] WHERE [hadithId]=N'${recordA}';`,
      [51203],
      HISTORY,
    ],
    [
      'A verification is never edited',
      `UPDATE [dbo].[HadithVerification] SET [version]=2 WHERE [id]=N'${verificationA}';`,
      [51203],
      HISTORY,
    ],
    [
      'A verification is never removed',
      `DELETE FROM [dbo].[HadithVerification] WHERE [id]=N'${verificationA}';`,
      [51203],
      HISTORY,
    ],
    [
      'Conflict evidence is never edited',
      `UPDATE [dbo].[HadithConflict] SET [facets]=N'chain' WHERE [collectionId]=N'${collectionA}';`,
      [51203],
      HISTORY,
    ],
    [
      'Conflict evidence is never resolved away',
      `DELETE FROM [dbo].[HadithConflict] WHERE [collectionId]=N'${collectionA}';`,
      [51203],
      HISTORY,
    ],
    [
      "A citation's history is never edited",
      `UPDATE [dbo].[HadithCitationRevision] SET [reason]=[reason] WHERE [collectionId]=N'${collectionA}';`,
      [51203],
      HISTORY,
    ],
    [
      "A citation's history is never removed",
      `DELETE FROM [dbo].[HadithCitationRevision] WHERE [collectionId]=N'${collectionA}';`,
      [51203],
      HISTORY,
    ],
  ] as const)
    await refuse(label, statement, numbers, rule);

  // ---- activation: an operator act with one authority ------------------------------
  const recordC = randomUUID();
  const fixtureInC = randomUUID();
  await expectAccepted(
    session,
    'Mapped citations in a fixture collection and an approved one',
    `${cite(authorised, collectionA, 14, candidates.fourteen, 'mapped', 0, null)}
     ${write(authorised, base(recordC, editionC1, reference('30'), 30, bookC1, 'NON_HADITH_FIXTURE_TEXT_30'))}
     ${write(authorised, base(fixtureInC, editionC2, reference('31'), 31, bookC2, 'NON_HADITH_FIXTURE_TEXT_31'))}
     ${verify(authorised, randomUUID(), recordC, 1)}
     ${verify(authorised, randomUUID(), fixtureInC, 1)}
     ${cite(authorised, collectionC, 30, recordC, 'mapped', 0, null)}`,
  );
  // Collection A also gains an edition from the APPROVED source system and a
  // verified record of it, left unmapped. Its edition, book, record and
  // verification identifiers carry a JSON quote and backslash, so the audit
  // rows naming them prove every audited value is escaped, never spliced.
  const quoted = (kind: string): string => `NON_HADITH_"\\_${kind}_${run.slice(0, 8)}`;
  const editionA3 = quoted('e');
  const bookA3 = quoted('b');
  const approvedInA = quoted('h');
  const quotedVerification = quoted('v');
  await expectAccepted(
    session,
    'An approved-source record, verified but unmapped, in collection A',
    `${edition(editionA3, collectionA, approved, 'NON_HADITH_FIXTURE_EDITION_A3')}
     ${createBook(authorised, bookA3, editionA3, `fixture-book-a3-${run}`, sharedBookReference, 1)}
     ${createChapter(authorised, randomUUID(), bookA3, `fixture-chapter-a3-${run}`, 'NON_HADITH_FIXTURE_REFERENCE_6', 1)}
     ${write(authorised, base(approvedInA, editionA3, reference('32'), 32, bookA3, 'NON_HADITH_FIXTURE_TEXT_32'))}
     ${verify(authorised, quotedVerification, approvedInA, 1)}`,
  );
  const activate = (collectionId: string, kind: 'fixture' | 'approved'): string =>
    `INSERT INTO [dbo].[HadithActivation] ([collectionId],[authority],[authorisedBy]) VALUES (N'${collectionId}',N'${kind}',N'Synthetic migration proof operator');`;
  const FIXTURE_OVER_APPROVED = 'A fixture source cannot enter an approved collection.';
  const APPROVED_AS_FIXTURE = 'An approved source cannot be shown as fixture text.';
  await refuse(
    'A collection with no mapped citation is never activated',
    activate(collectionB, 'fixture'),
    [51206],
    'An empty Hadith collection cannot be activated.',
  );
  await refuse(
    'An approved activation refuses a mapped fixture record',
    activate(collectionA, 'approved'),
    [51205],
    FIXTURE_OVER_APPROVED,
  );
  // 51208, the activation path: a fixture activation's banner would call the
  // approved record it shows non-authoritative proof text.
  await refuse(
    'A fixture activation refuses a mapped approved record',
    activate(collectionC, 'fixture'),
    [51208],
    APPROVED_AS_FIXTURE,
  );
  await expectAccepted(
    session,
    'A fixture-mode activation',
    activate(collectionA, 'fixture'),
  );
  // 51208, the citation path: once collection A is fixture proof, its approved
  // record is never mapped into it — by procedure or by a direct insert.
  await refuse(
    'An approved record is never mapped into a fixture collection',
    cite(authorised, collectionA, 32, approvedInA, 'mapped', 0, null),
    [51208],
    APPROVED_AS_FIXTURE,
  );
  await refuse(
    'An approved record is never mapped into a fixture collection by a direct insert either',
    `INSERT INTO [dbo].[HadithCitation] ([collectionId],[number],[id],[hadithId],[state],[version]) VALUES (N'${collectionA}',32,N'${randomUUID()}',N'${literal(approvedInA)}',N'mapped',1);`,
    [51208],
    APPROVED_AS_FIXTURE,
  );
  if (
    (await count(
      `SELECT COUNT(*) AS [total] FROM [dbo].[HadithCitation] WHERE [collectionId]=N'${collectionA}' AND [number]=32;`,
    )) !== 0
  )
    fail('A refused approved-under-fixture mapping left a citation behind.');
  await refuse(
    'An activation is never edited',
    `UPDATE [dbo].[HadithActivation] SET [authorisedBy]=N'Synthetic' WHERE [collectionId]=N'${collectionA}';`,
    [51206],
    'Activation is replaced, never edited.',
  );
  await refuse(
    'Every activation shares one authority',
    activate(collectionC, 'approved'),
    [51206],
    'Every Hadith activation shares one authority.',
  );
  await expectAccepted(
    session,
    'The operator replaces fixture mode with an approved collection',
    `DELETE FROM [dbo].[HadithActivation] WHERE [collectionId]=N'${collectionA}';
     ${activate(collectionC, 'approved')}`,
  );
  await refuse(
    'A fixture record never enters an approved collection',
    cite(authorised, collectionC, 31, fixtureInC, 'mapped', 0, null),
    [51205],
    FIXTURE_OVER_APPROVED,
  );
  await expectAccepted(
    session,
    'With fixture mode replaced, the approved record maps into its unactivated collection',
    cite(authorised, collectionA, 32, approvedInA, 'mapped', 0, null),
  );

  // ---- layered works, search intent and content-free audit --------------------------
  const [topic] = await session.query<{ id: string }>(
    'SELECT TOP (1) [id] FROM [dbo].[Topic] ORDER BY [slug];',
  );
  if (topic === undefined) fail('The Hadith proofs need a seeded Topic.');
  const commentary = randomUUID();
  const science = randomUUID();
  const NEEDS_TEXT = 'A published work needs text.';
  await expectAccepted(
    session,
    'A published commentary with its entry, a topic and a display name',
    `INSERT INTO [dbo].[HadithCommentary] ([id],[slug],[languageCode],[name],[state],[version],[updatedAt]) VALUES (N'${commentary}',N'fixture-commentary-${run}',N'ur',N'NON_HADITH_FIXTURE commentary',N'draft',1,SYSUTCDATETIME());
     INSERT INTO [dbo].[HadithCommentaryEntry] ([commentaryId],[hadithId],[text]) VALUES (N'${commentary}',N'${recordA}',N'NON_HADITH_FIXTURE_COMMENTARY_1');
     UPDATE [dbo].[HadithCommentary] SET [state]=N'published',[sourceSystemId]=N'${sourceA}',[publishedAt]=SYSUTCDATETIME(),[version]=2 WHERE [id]=N'${commentary}';
     INSERT INTO [dbo].[HadithTopic] ([hadithId],[topicId]) VALUES (N'${recordA}',N'${topic.id}');
     INSERT INTO [dbo].[HadithCollectionName] ([collectionId],[locale],[name]) VALUES (N'${collectionA}',N'en',N'NON_HADITH_FIXTURE collection');`,
  );
  for (const [label, statement, numbers, rule] of [
    [
      'A published commentary keeps its last entry',
      `DELETE FROM [dbo].[HadithCommentaryEntry] WHERE [commentaryId]=N'${commentary}';`,
      [51207],
      NEEDS_TEXT,
    ],
    [
      'A science is never published without its text',
      `INSERT INTO [dbo].[HadithScience] ([id],[slug],[position],[sourceSystemId],[state],[version],[updatedAt],[publishedAt]) VALUES (N'${science}',N'fixture-science-${run}',0,N'${sourceA}',N'published',1,SYSUTCDATETIME(),SYSUTCDATETIME());`,
      [51207],
      NEEDS_TEXT,
    ],
    [
      'A translation is never published without a registered source system',
      `INSERT INTO [dbo].[HadithTranslation] ([id],[hadithId],[languageCode],[text],[state],[version],[updatedAt],[publishedAt]) VALUES (N'${randomUUID()}',N'${recordA}',N'en',N'NON_HADITH_FIXTURE_TRANSLATION_1',N'published',1,SYSUTCDATETIME(),SYSUTCDATETIME());`,
      [547],
      'HadithTranslation_state_ck',
    ],
    [
      'A display name is in an interface locale',
      `INSERT INTO [dbo].[HadithCollectionName] ([collectionId],[locale],[name]) VALUES (N'${collectionA}',N'fr',N'NON_HADITH_FIXTURE collection');`,
      [547],
      'HadithCollectionName_ck',
    ],
    [
      'A record is assigned a Topic once',
      `INSERT INTO [dbo].[HadithTopic] ([hadithId],[topicId]) VALUES (N'${recordA}',N'${topic.id}');`,
      [2627],
      'HadithTopic_pkey',
    ],
    [
      'An invented Hadith search kind is refused',
      `INSERT INTO [dbo].[SearchIndexRequest] ([scopeKind],[scopeId]) VALUES (N'hadith-record',N'${recordA}');`,
      [547],
      'SearchIndexRequest_scopeKind_ck',
    ],
  ] as const)
    await refuse(label, statement, numbers, rule);
  const [audit] = await session.query<Record<string, number>>(`
    SELECT
      (SELECT COUNT(*) FROM [dbo].[AuditLog] WHERE [action]=N'hadith.record.created' AND [actorId]=N'${holder}') AS [created],
      (SELECT COUNT(*) FROM [dbo].[AuditLog] WHERE [action]=N'hadith.record.corrected' AND [targetId]=N'${recordA}') AS [corrected],
      (SELECT COUNT(*) FROM [dbo].[AuditLog] WHERE [action] LIKE N'hadith.%'
         AND (ISNULL([afterState],N'') LIKE N'%NON[_]HADITH[_]FIXTURE[_]%' OR ISNULL([beforeState],N'') LIKE N'%NON[_]HADITH[_]FIXTURE[_]%')) AS [content];
  `);
  if (JSON.stringify(audit) !== '{"created":19,"corrected":1,"content":0}')
    fail(`Hadith audit must name records, never their text: ${JSON.stringify(audit)}.`);
  // Every hadith.* audit row written above is well-formed JSON, and the quoted
  // identifiers read back from it exactly: STRING_ESCAPE, never a splice.
  const [shape] = await session.query<Record<string, number>>(`
    SELECT
      (SELECT COUNT(*) FROM [dbo].[AuditLog] WHERE [action] LIKE N'hadith.%') AS [rows],
      (SELECT COUNT(*) FROM [dbo].[AuditLog] WHERE [action] LIKE N'hadith.%'
         AND (ISNULL(ISJSON([afterState]), 0) <> 1 OR ([beforeState] IS NOT NULL AND ISJSON([beforeState]) <> 1))) AS [malformed],
      (SELECT COUNT(*) FROM [dbo].[AuditLog] WHERE [action] IN (N'hadith.book.created', N'hadith.record.created')
         AND JSON_VALUE([afterState], '$.edition') = N'${literal(editionA3)}') AS [edition],
      (SELECT COUNT(*) FROM [dbo].[AuditLog] WHERE [action] = N'hadith.chapter.created'
         AND JSON_VALUE([afterState], '$.book') = N'${literal(bookA3)}') AS [book],
      (SELECT COUNT(*) FROM [dbo].[AuditLog] WHERE [action] = N'hadith.record.verified'
         AND JSON_VALUE([afterState], '$.verification') = N'${literal(quotedVerification)}') AS [verification],
      (SELECT COUNT(*) FROM [dbo].[AuditLog] WHERE [action] = N'hadith.citation.set'
         AND JSON_VALUE([afterState], '$.record') = N'${literal(approvedInA)}') AS [record];
  `);
  if (
    shape === undefined ||
    Number(shape['rows']) < 40 ||
    JSON.stringify({ ...shape, rows: 0 }) !==
      '{"rows":0,"malformed":0,"edition":2,"book":1,"verification":1,"record":1}'
  )
    fail(
      `Every Hadith audit row must be escaped, well-formed JSON: ${JSON.stringify(shape)}.`,
    );

  report(
    'hadith canonical rules',
    `source-qualified identity, byte-exact conflict facets, versioned verification, ` +
      `reviewed citations and one-authority activation; ${String(refusals)} refusals by name, ` +
      `every text a NON_HADITH_FIXTURE sentinel`,
  );
}

const FATWA_PERMISSIONS = ['fatwa.answer', 'fatwa.publish', 'question.receive'];

/**
 * EVERY foreign key from a Fatwa table to another owner's table, exactly: the
 * accounts the workflow names, the canonical Topic a category maps onto and a
 * revision lists, the revision's content language, and the published
 * contributor records a publication attributes. None names Editorial, Quran,
 * Hadith, Library or Media, and none is a `targetType + targetId` pair.
 */
const FATWA_EXTERNAL_KEYS = [
  'FatwaCategory_topicId_fkey>Topic',
  'FatwaPublication_authorPersonId_fkey>Person',
  'FatwaPublication_publisherId_fkey>User',
  'FatwaPublication_publisherPersonId_fkey>Person',
  'FatwaQuestion_askerId_fkey>User',
  'FatwaQuestion_assignedById_fkey>User',
  'FatwaQuestion_assigneeId_fkey>User',
  'FatwaQuestion_declinedById_fkey>User',
  'FatwaQuestion_triagedById_fkey>User',
  'FatwaReviewDecision_actorId_fkey>User',
  'FatwaRevisionTopic_topicId_fkey>Topic',
  'FatwaRevision_authorId_fkey>User',
  'FatwaRevision_language_fkey>Language',
].sort();

/**
 * THE PROTECTED BUNDLE IS THE CATALOGUE LESS THE EXTERNALLY GATED KEYS, in
 * whatever state the catalogue is: every catalogued key that is not gated is
 * bundled, no gated key is bundled, and no role at all holds a gated key — a
 * migrated database has no triage officer, answerer or Fatwa publisher until
 * the organisation names one (OPEN_DECISIONS.md §1.4, §6.3). Read from the
 * database on both sides, so it holds before Phase 20, after it and after its
 * rollback alike. Returns the bundle's size.
 */
async function assertProtectedBundleExcludesGated(session: SqlSession): Promise<number> {
  const gated = EXTERNALLY_GATED_PERMISSIONS.map((key) => `N'${key}'`).join(',');
  const [row] = await session.query<{
    expected: string | null;
    bundled: string | null;
    gatedHeld: number;
  }>(`
    SELECT
      (SELECT STRING_AGG(p.[key], N',') WITHIN GROUP (ORDER BY p.[key])
         FROM [dbo].[Permission] p WHERE p.[key] NOT IN (${gated})) AS [expected],
      (SELECT STRING_AGG(rp.[permissionKey], N',') WITHIN GROUP (ORDER BY rp.[permissionKey])
         FROM [dbo].[RolePermission] rp JOIN [dbo].[Role] r ON r.[id] = rp.[roleId]
        WHERE r.[key] = N'platform-administrator') AS [bundled],
      (SELECT COUNT(*) FROM [dbo].[RolePermission] WHERE [permissionKey] IN (${gated})) AS [gatedHeld];
  `);
  if (
    row === undefined ||
    row.expected === null ||
    row.bundled !== row.expected ||
    Number(row.gatedHeld) !== 0
  )
    fail(
      `The protected bundle must be exactly the catalogue less the externally gated keys, ` +
        `and no role may hold a gated key; found ${JSON.stringify(row ?? null)}.`,
    );
  return row.expected.split(',').length;
}

/**
 * How far the rollback loop has gone when an earlier owner's foundation is
 * re-proved: every phase applied, Phase 29 rolled back, Phases 29 and 27,
 * Phases 29, 27 and 26, Phases 29, 27, 26 and 24, Phases 29, 27, 26, 24 and 23,
 * Phases 29, 27, 26, 24, 23 and 22, or Phases 29, 27, 26, 24, 23, 22 and 21.
 * (Phase 25 is transport only and Phase 28 is deployment only; neither has a
 * migration.)
 */
type BundleStage =
  | 'current'
  | 'before-migration'
  | 'before-donations'
  | 'before-membership'
  | 'before-messaging'
  | 'before-classes'
  | 'before-learning'
  | 'before-personalisation';

/**
 * The compiled bundle less exactly the keys the rollbacks have removed by
 * `stage`: the two bundled Migration keys once Phase 29 is rolled back (the
 * gated `migration.publish` was never bundled); the two bundled Donations keys
 * as well once Phase 27 is (the gated `donations.refund` was never bundled);
 * the two Membership keys as well
 * once Phase 26 is; nothing more once Phase 24 is (its two keys are externally
 * gated and were never bundled);
 * the two class keys as well once Phase 23 is, the two Learning keys as well
 * once Phase 22 is, and the two newsletter keys as well once Phase 21 is.
 */
function compiledBundleAt(stage: BundleStage): readonly string[] {
  // Each rollback removes its own keys on top of every later phase's.
  const removedByStage: Readonly<Record<BundleStage, readonly string[]>> = {
    current: [],
    'before-migration': MIGRATION_BUNDLED,
    'before-donations': [...MIGRATION_BUNDLED, ...DONATIONS_BUNDLED],
    'before-membership': [
      ...MIGRATION_BUNDLED,
      ...DONATIONS_BUNDLED,
      ...MEMBERSHIP_PERMISSIONS,
    ],
    'before-messaging': [
      ...MIGRATION_BUNDLED,
      ...DONATIONS_BUNDLED,
      ...MEMBERSHIP_PERMISSIONS,
    ],
    'before-classes': [
      ...MIGRATION_BUNDLED,
      ...DONATIONS_BUNDLED,
      ...MEMBERSHIP_PERMISSIONS,
      ...CLASSES_PERMISSIONS,
    ],
    'before-learning': [
      ...MIGRATION_BUNDLED,
      ...DONATIONS_BUNDLED,
      ...MEMBERSHIP_PERMISSIONS,
      ...CLASSES_PERMISSIONS,
      ...LEARNING_PERMISSIONS,
    ],
    'before-personalisation': [
      ...MIGRATION_BUNDLED,
      ...DONATIONS_BUNDLED,
      ...MEMBERSHIP_PERMISSIONS,
      ...CLASSES_PERMISSIONS,
      ...LEARNING_PERMISSIONS,
      ...NEWSLETTER_PERMISSIONS,
    ],
  };
  const removed = removedByStage[stage];
  return PLATFORM_ADMINISTRATOR_PERMISSIONS.filter((key) => !removed.includes(key));
}

/**
 * Phase 20 — what only the catalogue can prove about Fatwa:
 *
 *   1. NOTHING IS SEEDED: all ten tables are empty after deploy — no category,
 *      question, ruling, tally or activation, so the service is inactive;
 *   2. a ruling's address and question are unique, its revisions numbered per
 *      ruling, each revision published at most once, and every pointer from a
 *      ruling, publication or decision to a revision reaches a revision OF THAT
 *      ruling by a composite key;
 *   3. no Fatwa foreign key cascades, its references into other owners are
 *      EXACTLY the thirteen above, no other owner references a Fatwa table or
 *      holds a Fatwa column, no Fatwa table carries a type, target or kind
 *      column, the private question holds no contact detail and the tally no
 *      reader;
 *   4. the ruling is NVARCHAR(MAX);
 *   5. each of the eight triggers and thirteen procedures raises exactly its
 *      own numbers from 51230–51248, on the table it guards;
 *   6. the vocabulary is exactly the three externally gated keys, described as
 *      the compiled catalogue describes them, bundled into NO role and granted
 *      to nobody; no `fatwa-publication` grant exists; and the protected bundle
 *      is the catalogue less exactly those keys — the compiled bundle.
 *
 * The rules themselves are proved as BEHAVIOUR by `assertFatwaRules`, and
 * through the runtime login by `db:test:permissions`.
 */
async function assertFatwaFoundation(
  session: SqlSession,
  stage: BundleStage = 'current',
): Promise<void> {
  const tables = FATWA_TABLES.map((table) => `OBJECT_ID(N'[dbo].[${table}]')`).join(',');
  const names = FATWA_TABLES.map((table) => `N'${table}'`).join(',');

  // ---- 1. nothing seeded -------------------------------------------------------
  const counts = await session.query<{ name: string; total: number }>(
    FATWA_TABLES.map(
      (table) =>
        `SELECT N'${table}' AS [name], COUNT_BIG(*) AS [total] FROM [dbo].[${table}]`,
    ).join(' UNION ALL ') + ';',
  );
  const seeded = counts.filter((row) => Number(row.total) !== 0);
  if (FATWA_TABLES.length !== 10 || counts.length !== 10 || seeded.length > 0)
    fail(
      `The Fatwa migration must create ten empty tables and seed nothing; ` +
        `found ${String(counts.length)} tables, seeded: ${JSON.stringify(seeded)}.`,
    );

  // ---- 2. identity, and every revision pointer kept to its own ruling ----------
  const unique = await session.query<{ name: string; columns: string }>(`
    SELECT i.[name], STRING_AGG(COL_NAME(ic.[object_id], ic.[column_id]), N',')
      WITHIN GROUP (ORDER BY ic.[key_ordinal]) AS [columns]
    FROM sys.indexes i
    JOIN sys.index_columns ic ON ic.[object_id] = i.[object_id] AND ic.[index_id] = i.[index_id]
    WHERE i.[is_unique] = 1 AND ic.[key_ordinal] > 0
      AND i.[object_id] IN (OBJECT_ID(N'[dbo].[Fatwa]'), OBJECT_ID(N'[dbo].[FatwaRevision]'),
                            OBJECT_ID(N'[dbo].[FatwaPublication]'), OBJECT_ID(N'[dbo].[FatwaCategory]'))
    GROUP BY i.[name];
  `);
  const describedUnique = unique
    .map((row) => `${row.name}(${row.columns})`)
    .sort()
    .join(',');
  const expectedUnique = [
    'FatwaCategory_pkey(id)',
    'FatwaCategory_slug_key(slug)',
    'FatwaPublication_pkey(id)',
    'FatwaPublication_revisionId_key(revisionId)',
    'FatwaPublication_sequence_key(fatwaId,sequence)',
    'FatwaRevision_number_key(fatwaId,number)',
    'FatwaRevision_owner_key(id,fatwaId)',
    'FatwaRevision_pkey(id)',
    'Fatwa_pkey(id)',
    'Fatwa_questionId_key(questionId)',
    'Fatwa_slug_key(slug)',
  ]
    .sort()
    .join(',');
  if (describedUnique !== expectedUnique)
    fail(
      `A ruling must be unique by its address and its question, a revision numbered per ` +
        `ruling and published at most once; found ${describedUnique}.`,
    );

  const composite = await session.query<{ name: string; columns: string }>(`
    SELECT fk.[name], STRING_AGG(COL_NAME(c.[parent_object_id], c.[parent_column_id]) + N'>'
        + COL_NAME(c.[referenced_object_id], c.[referenced_column_id]), N',')
      WITHIN GROUP (ORDER BY c.[constraint_column_id]) AS [columns]
    FROM sys.foreign_keys fk
    JOIN sys.foreign_key_columns c ON c.[constraint_object_id] = fk.[object_id]
    WHERE fk.[referenced_object_id] = OBJECT_ID(N'[dbo].[FatwaRevision]')
      AND fk.[parent_object_id] <> OBJECT_ID(N'[dbo].[FatwaRevisionTopic]')
    GROUP BY fk.[name];
  `);
  const describedComposite = composite
    .map((row) => `${row.name}(${row.columns})`)
    .sort()
    .join(',');
  const expectedComposite = [
    'FatwaPublication_revision_fkey(revisionId>id,fatwaId>fatwaId)',
    'FatwaReviewDecision_revision_fkey(revisionId>id,fatwaId>fatwaId)',
    'Fatwa_pendingRevision_fkey(pendingRevisionId>id,id>fatwaId)',
    'Fatwa_publishedRevision_fkey(publishedRevisionId>id,id>fatwaId)',
  ].join(',');
  if (describedComposite !== expectedComposite)
    fail(
      `Every pointer to a revision must reach a revision of the same ruling; found ` +
        `${describedComposite}.`,
    );

  // ---- 3. no cascade, exact external edges, no foreign Fatwa schema ------------
  const cascading = await session.query<{ name: string }>(`
    SELECT [name] FROM sys.foreign_keys
    WHERE [parent_object_id] IN (${tables})
      AND ([delete_referential_action] <> 0 OR [update_referential_action] <> 0);
  `);
  if (cascading.length > 0)
    fail(
      `Phase-20 foreign keys must not cascade; found ${cascading.map((row) => row.name).join(', ')}.`,
    );

  const external = await session.query<{ edge: string }>(`
    SELECT fk.[name] + N'>' + OBJECT_NAME(fk.[referenced_object_id]) AS [edge]
    FROM sys.foreign_keys fk
    WHERE fk.[parent_object_id] IN (${tables}) AND fk.[referenced_object_id] NOT IN (${tables});
  `);
  const edges = external.map((row) => row.edge).sort();
  if (edges.join(',') !== FATWA_EXTERNAL_KEYS.join(','))
    fail(
      `Fatwa's references into other owners must be exactly ${FATWA_EXTERNAL_KEYS.join(', ')}; ` +
        `found ${edges.join(', ')}.`,
    );

  const [ownership] = await session.query<{ inbound: number; columns: string | null }>(`
    SELECT
      (SELECT COUNT(*) FROM sys.foreign_keys
        WHERE [referenced_object_id] IN (${tables}) AND [parent_object_id] NOT IN (${tables})) AS [inbound],
      (SELECT STRING_AGG(OBJECT_NAME(c.[object_id]) + N'.' + c.[name], N',') FROM sys.columns c
        WHERE (c.[name] LIKE N'%fatwa%' OR c.[name] LIKE N'%ruling%')
          AND OBJECT_NAME(c.[object_id]) NOT IN (${names})
          AND OBJECTPROPERTY(c.[object_id], 'IsUserTable') = 1) AS [columns];
  `);
  if (Number(ownership?.inbound) !== 0 || (ownership?.columns ?? null) !== null)
    fail(
      `No other owner may hold Fatwa schema; found ${JSON.stringify(ownership ?? null)}.`,
    );

  const shapes = await session.query<{ name: string; columns: string }>(`
    SELECT OBJECT_NAME(c.[object_id]) AS [name],
      STRING_AGG(c.[name], N',') WITHIN GROUP (ORDER BY c.[column_id]) AS [columns]
    FROM sys.columns c
    WHERE c.[object_id] IN (OBJECT_ID(N'[dbo].[FatwaQuestion]'), OBJECT_ID(N'[dbo].[FatwaReadTally]'))
    GROUP BY c.[object_id];
  `);
  const describedShapes = shapes
    .map((row) => `${row.name}(${row.columns})`)
    .sort()
    .join(' ');
  const expectedShapes = [
    'FatwaQuestion(id,askerId,body,status,categoryId,assigneeId,triagedById,triagedAt,' +
      'assignedById,assignedAt,declinedById,declinedAt,answeredAt,disposedAt,version,' +
      'submittedAt,updatedAt)',
    'FatwaReadTally(fatwaId,day,reads)',
  ].join(' ');
  if (describedShapes !== expectedShapes)
    fail(
      `The private question holds the asker's words and workflow facts only, and the tally ` +
        `a count only; found ${describedShapes}.`,
    );

  const generic = await session.query<{ name: string }>(`
    SELECT OBJECT_NAME(c.[object_id]) + N'.' + c.[name] AS [name] FROM sys.columns c
    WHERE c.[object_id] IN (${tables})
      AND (c.[name] LIKE N'%type%' OR c.[name] LIKE N'%target%' OR c.[name] LIKE N'%kind%'
           OR c.[name] LIKE N'%email%' OR c.[name] LIKE N'%phone%' OR c.[name] LIKE N'%address%'
           OR c.[name] LIKE N'%ip%' OR c.[name] LIKE N'%cookie%' OR c.[name] LIKE N'%agent%'
           OR c.[name] LIKE N'%article%' OR c.[name] LIKE N'%hadith%' OR c.[name] LIKE N'%quran%');
  `);
  if (generic.length > 0)
    fail(
      `Fatwa tables may carry no type, target, contact, reader or foreign-context column; ` +
        `found ${JSON.stringify(generic)}.`,
    );

  // ---- 4. the ruling is unbounded Unicode text --------------------------------
  const [ruling] = await session.query<{ type: string; size: number }>(`
    SELECT TYPE_NAME(c.[user_type_id]) AS [type], c.[max_length] AS [size] FROM sys.columns c
    WHERE c.[object_id] = OBJECT_ID(N'[dbo].[FatwaRevision]') AND c.[name] = N'ruling';
  `);
  if (ruling?.type !== 'nvarchar' || Number(ruling.size) !== -1)
    fail(
      `FatwaRevision.ruling must be NVARCHAR(MAX); found ${JSON.stringify(ruling ?? null)}.`,
    );

  // ---- 5. every refusal in its own place --------------------------------------
  const triggers = await session.query<{
    name: string;
    tableName: string;
    definition: string | null;
  }>(`
    SELECT t.[name], OBJECT_NAME(t.[parent_id]) AS [tableName], OBJECT_DEFINITION(t.[object_id]) AS [definition]
    FROM sys.triggers t WHERE t.[parent_id] IN (${tables});
  `);
  const describedTriggers = triggers
    .map((row) => `${row.name}@${row.tableName}:${raisedNumbers(row.definition)}`)
    .sort()
    .join(',');
  const expectedTriggers = Object.entries(FATWA_TRIGGER_NUMBERS)
    .map(([name, [table, numbers]]) => `${name}@${table}:${numbers}`)
    .sort()
    .join(',');
  if (describedTriggers !== expectedTriggers)
    fail(
      `Fatwa triggers must raise exactly their own 5123x–5124x numbers; found ${describedTriggers}.`,
    );

  const procedures = await session.query<{ name: string; definition: string | null }>(`
    SELECT p.[name], OBJECT_DEFINITION(p.[object_id]) AS [definition]
    FROM sys.procedures p WHERE p.[name] LIKE N'Fatwa%';
  `);
  const describedProcedures = procedures
    .map((row) => `${row.name}:${raisedNumbers(row.definition)}`)
    .sort()
    .join(',');
  const expectedProcedures = Object.entries(FATWA_PROCEDURE_NUMBERS)
    .map(([name, numbers]) => `${name}:${numbers}`)
    .sort()
    .join(',');
  if (describedProcedures !== expectedProcedures)
    fail(
      `The Fatwa write path must be exactly thirteen procedures raising their own ` +
        `5123x–5124x numbers; found ${describedProcedures}.`,
    );

  // ---- 6. three gated keys, bundled into no role, granted to nobody ------------
  const permissions = await session.query<{
    key: string;
    description: string;
    held: number;
  }>(`
    SELECT p.[key], p.[description],
      (SELECT COUNT(*) FROM [dbo].[RolePermission] rp WHERE rp.[permissionKey] = p.[key]) AS [held]
    FROM [dbo].[Permission] p
    WHERE p.[key] LIKE N'fatwa%' OR p.[key] LIKE N'question%' OR p.[key] LIKE N'ruling%'
    ORDER BY p.[key];
  `);
  const described = new Map(
    PERMISSION_CATALOGUE.map((entry) => [entry.key as string, entry.description]),
  );
  // The externally gated set is the three Fatwa keys, `teaching.perform` since
  // Phase 23, the two Messaging keys since Phase 24, `donations.refund` since
  // Phase 27 and `migration.publish` since Phase 29 — and nothing else.
  if (
    permissions.map((row) => row.key).join(',') !== FATWA_PERMISSIONS.join(',') ||
    [...EXTERNALLY_GATED_PERMISSIONS].sort().join(',') !==
      [
        ...FATWA_PERMISSIONS,
        TEACHING_PERMISSION,
        ...MESSAGING_PERMISSIONS,
        DONATIONS_REFUND_PERMISSION,
        MIGRATION_PUBLISH_PERMISSION,
      ]
        .sort()
        .join(',') ||
    permissions.some(
      (row) => row.description !== described.get(row.key) || Number(row.held) !== 0,
    )
  )
    fail(
      `The Fatwa vocabulary must be exactly ${FATWA_PERMISSIONS.join(', ')}, described as the ` +
        `compiled catalogue describes them and held by no role, and the gated set exactly ` +
        `those three, ${TEACHING_PERMISSION}, ${MESSAGING_PERMISSIONS.join(', ')}, ` +
        `${DONATIONS_REFUND_PERMISSION} and ${MIGRATION_PUBLISH_PERMISSION}; found ` +
        `${JSON.stringify(permissions)}.`,
    );

  const [quiet] = await session.query<{
    grants: number;
    holders: number;
    audit: number;
  }>(`
    SELECT
      (SELECT COUNT(*) FROM [dbo].[StepUpGrant] WHERE [purpose] = N'fatwa-publication') AS [grants],
      (SELECT COUNT(*) FROM [dbo].[RoleAssignment] ra JOIN [dbo].[RolePermission] rp ON rp.[roleId] = ra.[roleId]
        WHERE rp.[permissionKey] IN (${FATWA_PERMISSIONS.map((key) => `N'${key}'`).join(',')})) AS [holders],
      (SELECT COUNT(*) FROM [dbo].[AuditLog] WHERE [action] LIKE N'fatwa.%') AS [audit];
  `);
  if (JSON.stringify(quiet) !== '{"grants":0,"holders":0,"audit":0}')
    fail(
      `A migrated database must hold no Fatwa grant, holder or audit row; found ${JSON.stringify(quiet)}.`,
    );

  // Once Phase 22 is rolled back the database's bundle lacks the two Learning
  // keys the compiled bundle now carries, and once Phase 21 is too it lacks the
  // two newsletter keys as well, so each stage compares against the compiled
  // bundle less exactly the keys rolled back by then.
  const bundled = await assertProtectedBundleExcludesGated(session);
  const compiledBundle = compiledBundleAt(stage).length;
  if (bundled !== compiledBundle)
    fail(
      `The protected bundle holds ${String(bundled)} keys; the compiled bundle holds ` +
        `${String(compiledBundle)} at stage ${stage}.`,
    );

  report(
    'fatwa foundation',
    'ten empty tables, composite revision pointers, thirteen non-cascading external keys, ' +
      `8 triggers and 13 procedures by number, three gated keys held by no role, ` +
      `${String(bundled)} bundled`,
  );
}

/**
 * After the Phase-20 rollback: no Fatwa table, trigger, procedure, key or
 * permission, no grant of one and no `fatwa-publication` step-up grant — and
 * the protected bundle is still the whole (now ungated) catalogue. The caller
 * then proves the vocabulary and the earlier owners Fatwa referenced are back.
 */
async function assertFatwaRemoved(session: SqlSession): Promise<void> {
  const keys = FATWA_PERMISSIONS.map((key) => `N'${key}'`).join(',');
  const [row] = await session.query<Record<string, number>>(`
    SELECT
      (SELECT COUNT(*) FROM sys.tables WHERE [name] LIKE N'Fatwa%') AS [tables],
      (SELECT COUNT(*) FROM sys.triggers WHERE [name] LIKE N'Fatwa%') AS [triggers],
      (SELECT COUNT(*) FROM sys.procedures WHERE [name] LIKE N'Fatwa%') AS [procedures],
      (SELECT COUNT(*) FROM sys.foreign_keys WHERE [name] LIKE N'Fatwa%') AS [keys],
      (SELECT COUNT(*) FROM [dbo].[Permission] WHERE [key] IN (${keys})) AS [permissions],
      (SELECT COUNT(*) FROM [dbo].[RolePermission] WHERE [permissionKey] IN (${keys})) AS [held],
      (SELECT COUNT(*) FROM [dbo].[StepUpGrant] WHERE [purpose] = N'fatwa-publication') AS [grants];
  `);
  if (Object.values(row ?? { missing: 1 }).some((value) => Number(value) !== 0))
    fail(`The Phase-20 rollback left a Fatwa object: ${JSON.stringify(row ?? null)}.`);
  const bundled = await assertProtectedBundleExcludesGated(session);
  report(
    'fatwa rollback',
    `every Fatwa table, trigger, procedure, key, permission and grant removed; ` +
      `${String(bundled)} keys still bundled`,
  );
}

/**
 * Phase 20 — THE WORKFLOW RULES, proved as behaviour against the re-deployed
 * schema with NON_FATWA_FIXTURE sentinels only, through the migration login
 * (the runtime's own posture is `db:test:permissions`'s):
 *
 *   - with no activation nothing is asked (51231); an activation is one row,
 *     an approved one carries its evidence, and it is immutable (51230);
 *   - an inactive account asks nothing (51232) and a question has substance
 *     (51247); each stage is its own key — a holder of another stage's key or
 *     of none is refused (51233), a stale version (51237), an unavailable
 *     category (51240), the asker or a non-answerer as assignee (51239), a
 *     drafter the question is not assigned to (51234), a first draft with a
 *     correction reason or a correction without one (51245), a revision that is
 *     not the pending one (51244), a draft under review (51238);
 *   - an address is public grammar and never a section or view word —
 *     `latest`, `popular`, `ask`, … (Fatwa_slug_ck) — and freezes at first
 *     publication, by procedure and by direct update (51241);
 *   - publication needs `fatwa.publish` AND a live `fatwa-publication` grant of
 *     the same session: a wrong-purpose grant, an expired grant and a borrowed
 *     grant are refused (51235); the author of a revision cannot publish it
 *     (51243); a correction is a NEW revision, its return a private decision,
 *     and the second publication advances the current revision while the first
 *     stays in history;
 *   - revisions, their topics, publications and decisions refuse every change
 *     (51242), a topic joins only the pending revision, a ruling changes only
 *     through its workflow (51248) and never un-withdraws;
 *   - a category keeps its slug, moves one version at a time and is never
 *     deleted (51240); the question's status, text and facts CHECKs hold;
 *   - disposal refuses an account not closed (51246) and an unbounded batch
 *     (51247), and erases a closed account's text; a read is counted only for
 *     a ruling public now; publication and withdrawal owe Search a pass; and no
 *     audit row carries a question, ruling, note or reason.
 */
async function assertFatwaRules(session: SqlSession): Promise<void> {
  const run = randomUUID().replaceAll('-', '').slice(0, 16);
  const at = '2026-10-04T00:00:00';
  let refusals = 0;
  const refuse = async (
    label: string,
    statement: string,
    numbers: readonly number[],
    rule: string,
  ): Promise<void> => {
    await expectRefusal(session, label, statement, numbers, rule);
    refusals += 1;
  };
  const count = async (statement: string): Promise<number> => {
    const [row] = await session.query<{ total: number }>(statement);
    return Number(row?.total ?? -1);
  };

  // ---- the identities the procedures check, as authoritative rows ------------
  const asker = randomUUID();
  const closingAsker = randomUUID();
  const suspended = randomUUID();
  const triager = randomUUID();
  const answerer = randomUUID();
  const publisher = randomUUID();
  const dual = randomUUID();
  const outsider = randomUUID();
  const receiveRole = randomUUID();
  const answerRole = randomUUID();
  const publishRole = randomUUID();
  const publisherSession = randomUUID();
  const dualSession = randomUUID();
  const grant = randomUUID();
  const wrongPurpose = randomUUID();
  const expired = randomUUID();
  const dualGrant = randomUUID();
  const user = (id: string, status: string): string =>
    `INSERT INTO [dbo].[User] ([id],[name],[email],[emailVerified],[createdAt],[updatedAt],[locale],[status],[twoFactorEnabled]) VALUES (N'${id}',N'Synthetic Fatwa proof user',N'${id}@proof.invalid',0,SYSUTCDATETIME(),SYSUTCDATETIME(),N'en',N'${status}',0);`;
  const role = (id: string, key: string, permission: string): string =>
    `INSERT INTO [dbo].[Role] ([id],[key],[name],[description],[system]) VALUES (N'${id}',N'proof-fatwa-${key}-${run}',N'Synthetic Fatwa ${key} proof role',N'Holds ${permission} for the migration proof only.',0);
     INSERT INTO [dbo].[RolePermission] ([roleId],[permissionKey]) VALUES (N'${id}',N'${permission}');`;
  const sessionRow = (id: string, userId: string): string =>
    `INSERT INTO [dbo].[Session] ([id],[token],[userId],[expiresAt],[createdAt],[updatedAt]) VALUES (N'${id}',N'proof-fatwa-${id}',N'${userId}',DATEADD(hour,1,SYSUTCDATETIME()),SYSUTCDATETIME(),SYSUTCDATETIME());`;
  const grantRow = (
    id: string,
    userId: string,
    sessionId: string,
    purpose: string,
    minutes: number,
  ): string =>
    `INSERT INTO [dbo].[StepUpGrant] ([id],[userId],[sessionId],[purpose],[expiresAt]) VALUES (N'${id}',N'${userId}',N'${sessionId}',N'${purpose}',DATEADD(minute,${String(minutes)},SYSUTCDATETIME()));`;
  await expectAccepted(
    session,
    'A synthetic Fatwa workflow authority',
    `${user(asker, 'active')}
     ${user(closingAsker, 'active')}
     ${user(suspended, 'suspended')}
     ${user(triager, 'active')}
     ${user(answerer, 'active')}
     ${user(publisher, 'active')}
     ${user(dual, 'active')}
     ${user(outsider, 'active')}
     ${role(receiveRole, 'receive', 'question.receive')}
     ${role(answerRole, 'answer', 'fatwa.answer')}
     ${role(publishRole, 'publish', 'fatwa.publish')}
     INSERT INTO [dbo].[RoleAssignment] ([userId],[roleId]) VALUES
       (N'${triager}',N'${receiveRole}'),(N'${answerer}',N'${answerRole}'),(N'${publisher}',N'${publishRole}'),
       (N'${dual}',N'${answerRole}'),(N'${dual}',N'${publishRole}');
     ${sessionRow(publisherSession, publisher)}
     ${sessionRow(dualSession, dual)}
     ${grantRow(grant, publisher, publisherSession, 'fatwa-publication', 30)}
     ${grantRow(wrongPurpose, publisher, publisherSession, 'hadith-canonical-edit', 30)}
     ${grantRow(expired, publisher, publisherSession, 'fatwa-publication', -1)}
     ${grantRow(dualGrant, dual, dualSession, 'fatwa-publication', 30)}`,
  );

  const topics = await session.query<{ id: string }>(
    `SELECT TOP 2 [id] FROM [dbo].[Topic] WHERE [status] = N'active' ORDER BY [slug];`,
  );
  const [topicA, topicB] = topics.map((row) => row.id);
  if (topicA === undefined || topicB === undefined)
    fail('No canonical Topic to classify by.');
  const category = randomUUID();
  const archived = randomUUID();
  const unused = randomUUID();
  await expectAccepted(
    session,
    'Synthetic Fatwa categories',
    `INSERT INTO [dbo].[FatwaCategory] ([id],[slug],[topicId],[position],[status]) VALUES
       (N'${category}',N'fx-category-${run}',N'${topicA}',0,N'active'),
       (N'${archived}',N'fx-archived-${run}',N'${topicB}',1,N'archived'),
       (N'${unused}',N'fx-unused-${run}',N'${topicB}',2,N'active');
     INSERT INTO [dbo].[FatwaCategoryName] ([categoryId],[locale],[name]) VALUES
       (N'${category}',N'en',N'NON_FATWA_FIXTURE category');`,
  );

  const body = (n: number): string =>
    `NON_FATWA_FIXTURE_QUESTION_${String(n)} synthetic private question text`;
  const submit = (id: string, askerId: string, text: string): string =>
    `EXEC [dbo].[FatwaSubmitQuestion] @id=N'${id}', @askerId=N'${askerId}', @body=N'${literal(text)}', @at='${at}';`;
  const triage = (
    id: string,
    expected: number,
    categoryId: string,
    actor: string,
  ): string =>
    `EXEC [dbo].[FatwaTriageQuestion] @id=N'${id}', @expectedVersion=${String(expected)}, @categoryId=N'${categoryId}', @actorId=N'${actor}', @at='${at}';`;
  const assign = (
    id: string,
    expected: number,
    assignee: string,
    actor: string,
  ): string =>
    `EXEC [dbo].[FatwaAssignQuestion] @id=N'${id}', @expectedVersion=${String(expected)}, @assigneeId=N'${assignee}', @actorId=N'${actor}', @at='${at}';`;
  interface Draft {
    readonly fatwa: string;
    readonly question: string;
    readonly expected: number;
    readonly revision: string;
    readonly slug: string;
    readonly reason: string | null;
    readonly actor: string;
    readonly topics?: readonly string[];
  }
  const save = (d: Draft): string =>
    `EXEC [dbo].[FatwaSaveDraft] @fatwaId=N'${d.fatwa}', @questionId=N'${d.question}', @expectedVersion=${String(d.expected)}, @revisionId=N'${d.revision}', @slug=N'${literal(d.slug)}', @title=N'NON_FATWA_FIXTURE title ${d.revision.slice(0, 8)}', @publicQuestion=N'NON_FATWA_FIXTURE_PUBLIC_QUESTION anonymised statement', @ruling=N'NON_FATWA_FIXTURE_RULING synthetic ruling text ${d.revision.slice(0, 8)}', @language=N'en', @categoryId=N'${category}', @topicIds=N'${JSON.stringify(d.topics ?? [topicB])}', @correctionReason=${d.reason === null ? 'NULL' : `N'${literal(d.reason)}'`}, @actorId=N'${d.actor}', @at='${at}';`;
  const submitForReview = (
    fatwa: string,
    expected: number,
    revision: string,
    actor: string,
  ): string =>
    `EXEC [dbo].[FatwaSubmitForReview] @fatwaId=N'${fatwa}', @expectedVersion=${String(expected)}, @revisionId=N'${revision}', @actorId=N'${actor}', @at='${at}';`;
  const publish = (
    fatwa: string,
    expected: number,
    revision: string,
    actor: string,
    sessionId: string,
    grantId: string,
  ): string =>
    `EXEC [dbo].[FatwaPublishRevision] @fatwaId=N'${fatwa}', @expectedVersion=${String(expected)}, @revisionId=N'${revision}', @publicationId=N'${randomUUID()}', @actorId=N'${actor}', @sessionId=N'${sessionId}', @stepUpGrantId=N'${grantId}', @at='${at}';`;
  const NO_PERMISSION = 'Fatwa authority is not held now.';
  const NO_PUBLICATION = 'Fatwa publication authority is not held now.';
  const HISTORY = 'Fatwa history is immutable.';
  const STALE_QUESTION = 'The question changed since it was read.';
  const CLOSED_STEP = 'That step is not open for this';

  // ---- activation --------------------------------------------------------------
  const question = randomUUID();
  await refuse(
    'A question while the service is not activated',
    submit(question, asker, body(1)),
    [51231],
    'The Fatwa service is not accepting questions.',
  );
  await refuse(
    'An approved activation without its evidence',
    `INSERT INTO [dbo].[FatwaActivation] ([id],[authority],[authorisedBy]) VALUES (1,N'approved',N'NON_FATWA_FIXTURE operator');`,
    [547],
    'FatwaActivation_evidence_ck',
  );
  await refuse(
    'A second activation row',
    `INSERT INTO [dbo].[FatwaActivation] ([id],[authority],[authorisedBy]) VALUES (2,N'fixture',N'NON_FATWA_FIXTURE operator');`,
    [547],
    'FatwaActivation_ck',
  );
  await expectAccepted(
    session,
    'A fixture activation',
    `INSERT INTO [dbo].[FatwaActivation] ([id],[authority],[authorisedBy]) VALUES (1,N'fixture',N'NON_FATWA_FIXTURE operator');`,
  );
  for (const [label, statement] of [
    [
      'An activation turned approved',
      `UPDATE [dbo].[FatwaActivation] SET [authority]=N'approved',[reference]=N'urn:example:forged';`,
    ],
    ['An activation withdrawn by deletion', 'DELETE FROM [dbo].[FatwaActivation];'],
  ] as const)
    await refuse(label, statement, [51230], 'Fatwa activation is immutable.');

  // ---- intake, triage and assignment -------------------------------------------
  await refuse(
    'A question from an inactive account',
    submit(randomUUID(), suspended, body(2)),
    [51232],
    'The asking account is not active.',
  );
  await refuse(
    'A question with no substance',
    submit(randomUUID(), asker, 'NON_FATWA_FIXTURE'),
    [51247],
    'The question is not acceptable.',
  );
  await expectAccepted(session, 'A question submitted', submit(question, asker, body(1)));
  await refuse(
    'Triage by an account holding nothing',
    triage(question, 1, category, outsider),
    [51233],
    NO_PERMISSION,
  );
  await refuse(
    'Triage by an answerer',
    triage(question, 1, category, answerer),
    [51233],
    NO_PERMISSION,
  );
  await refuse(
    'Triage against a stale version',
    triage(question, 5, category, triager),
    [51237],
    STALE_QUESTION,
  );
  await refuse(
    'Triage into an archived category',
    triage(question, 1, archived, triager),
    [51240],
    'The category is not available.',
  );
  await expectAccepted(
    session,
    'A question triaged',
    triage(question, 1, category, triager),
  );
  const BAD_ASSIGNEE = 'That account cannot be assigned this question.';
  await refuse(
    'Assignment to the asker',
    assign(question, 2, asker, triager),
    [51239],
    BAD_ASSIGNEE,
  );
  await refuse(
    'Assignment to a non-answerer',
    assign(question, 2, outsider, triager),
    [51239],
    BAD_ASSIGNEE,
  );
  await expectAccepted(
    session,
    'A question assigned',
    assign(question, 2, answerer, triager),
  );

  // ---- the first draft, its address and its review ------------------------------
  const fatwa = randomUUID();
  const first = randomUUID();
  const slug = `fx-ruling-${run}`;
  const draft = (overrides: Partial<Draft>): string =>
    save({
      fatwa,
      question,
      expected: 0,
      revision: randomUUID(),
      slug,
      reason: null,
      actor: answerer,
      ...overrides,
    });
  await refuse(
    'A draft by an account the question is not assigned to',
    draft({ actor: dual }),
    [51234],
    'The question is not assigned to this account.',
  );
  for (const word of ['latest', 'popular'])
    await refuse(
      `A ruling addressed as '${word}'`,
      draft({ slug: word }),
      [547],
      'Fatwa_slug_ck',
    );
  await refuse(
    'A first draft stating a correction reason',
    draft({ reason: 'NON_FATWA_FIXTURE reason' }),
    [51245],
    'A correction states its reason, and only a correction does.',
  );
  await expectAccepted(
    session,
    'A first draft',
    draft({ revision: first, topics: [topicA, topicB] }),
  );
  for (const bad of [
    'ask',
    'search',
    'Upper-case',
    '-lead',
    'trail-',
    'two--hyphens',
    'x',
  ])
    await refuse(
      `A ruling readdressed as '${bad}'`,
      `UPDATE [dbo].[Fatwa] SET [slug]=N'${bad}', [version]=[version]+1 WHERE [id]=N'${fatwa}';`,
      [547],
      'Fatwa_slug_ck',
    );
  await refuse(
    'Submission of a revision that is not pending',
    submitForReview(fatwa, 2, randomUUID(), answerer),
    [51244],
    'That is not the revision awaiting this step.',
  );
  await expectAccepted(
    session,
    'A draft submitted for review',
    submitForReview(fatwa, 2, first, answerer),
  );
  await refuse(
    'A draft saved while under review',
    draft({ expected: 3, reason: null }),
    [51238],
    CLOSED_STEP,
  );

  // ---- publication authority ---------------------------------------------------
  for (const [label, actor, sessionId, grantId] of [
    ['a wrong-purpose grant', publisher, publisherSession, wrongPurpose],
    ['an expired grant', publisher, publisherSession, expired],
    ['a borrowed grant', answerer, publisherSession, grant],
    ['a forged grant', publisher, publisherSession, randomUUID()],
  ] as const)
    await refuse(
      `Publication with ${label}`,
      publish(fatwa, 3, first, actor, sessionId, grantId),
      [51235],
      NO_PUBLICATION,
    );
  await expectAccepted(
    session,
    'A first publication',
    publish(fatwa, 3, first, publisher, publisherSession, grant),
  );

  // ---- history, address and workflow integrity ----------------------------------
  for (const [label, statement] of [
    [
      'A published revision rewritten',
      `UPDATE [dbo].[FatwaRevision] SET [title]=N'NON_FATWA_FIXTURE tampered' WHERE [id]=N'${first}';`,
    ],
    [
      'A revision topic removed',
      `DELETE FROM [dbo].[FatwaRevisionTopic] WHERE [revisionId]=N'${first}';`,
    ],
    [
      'A revision topic added to a published revision',
      `INSERT INTO [dbo].[FatwaRevisionTopic] ([revisionId],[topicId]) SELECT N'${first}', [id] FROM [dbo].[Topic] WHERE [id] NOT IN (N'${topicA}',N'${topicB}') AND [status]=N'active' ORDER BY [slug] OFFSET 0 ROWS FETCH NEXT 1 ROWS ONLY;`,
    ],
    [
      'A publication rewritten',
      `UPDATE [dbo].[FatwaPublication] SET [publishedAt]=SYSUTCDATETIME() WHERE [fatwaId]=N'${fatwa}';`,
    ],
    [
      'A publication erased',
      `DELETE FROM [dbo].[FatwaPublication] WHERE [fatwaId]=N'${fatwa}';`,
    ],
  ] as const)
    await refuse(label, statement, [51242], HISTORY);
  await refuse(
    'A published ruling readdressed directly',
    `UPDATE [dbo].[Fatwa] SET [slug]=N'fx-moved-${run}', [version]=[version]+1 WHERE [id]=N'${fatwa}';`,
    [51241],
    'A published Fatwa keeps its address.',
  );
  await refuse(
    'A ruling changed outside its workflow',
    `UPDATE [dbo].[Fatwa] SET [updatedAt]=SYSUTCDATETIME() WHERE [id]=N'${fatwa}';`,
    [51248],
    'A Fatwa changes only through its workflow.',
  );

  // ---- a correction: a NEW revision, returned once, then published --------------
  await refuse(
    'A correction with no reason',
    draft({ expected: 4, reason: null }),
    [51245],
    'A correction states its reason, and only a correction does.',
  );
  await refuse(
    'A correction that moves the address',
    draft({ expected: 4, slug: `fx-moved-${run}`, reason: 'NON_FATWA_FIXTURE reason' }),
    [51241],
    'A published Fatwa keeps its address.',
  );
  const second = randomUUID();
  const third = randomUUID();
  const decision = randomUUID();
  const reason = 'NON_FATWA_FIXTURE_CORRECTION_REASON public statement';
  await expectAccepted(
    session,
    'A correction drafted, submitted and returned',
    `${draft({ expected: 4, revision: second, reason })}
     ${submitForReview(fatwa, 5, second, answerer)}
     EXEC [dbo].[FatwaReturnForRevision] @fatwaId=N'${fatwa}', @expectedVersion=6, @revisionId=N'${second}', @decisionId=N'${decision}', @note=N'NON_FATWA_FIXTURE_NOTE private review note', @actorId=N'${publisher}', @at='${at}';`,
  );
  for (const [label, statement] of [
    [
      'A review decision rewritten',
      `UPDATE [dbo].[FatwaReviewDecision] SET [note]=N'NON_FATWA_FIXTURE tampered' WHERE [id]=N'${decision}';`,
    ],
    [
      'A review decision erased',
      `DELETE FROM [dbo].[FatwaReviewDecision] WHERE [id]=N'${decision}';`,
    ],
  ] as const)
    await refuse(label, statement, [51242], HISTORY);
  await expectAccepted(
    session,
    'The returned correction revised and published',
    `${draft({ expected: 7, revision: third, reason })}
     ${submitForReview(fatwa, 8, third, answerer)}
     ${publish(fatwa, 9, third, publisher, publisherSession, grant)}`,
  );
  const [history] = await session.query<Record<string, number | string | null>>(`
    SELECT f.[version], f.[slug],
      CASE WHEN f.[publishedRevisionId]=N'${third}' THEN 1 ELSE 0 END AS [current],
      (SELECT STRING_AGG(r.[id], N',') WITHIN GROUP (ORDER BY p.[sequence])
         FROM [dbo].[FatwaPublication] p JOIN [dbo].[FatwaRevision] r ON r.[id]=p.[revisionId]
        WHERE p.[fatwaId]=f.[id]) AS [published],
      (SELECT COUNT(*) FROM [dbo].[FatwaRevision] WHERE [fatwaId]=f.[id]) AS [revisions],
      (SELECT COUNT(*) FROM [dbo].[FatwaReviewDecision] WHERE [fatwaId]=f.[id] AND [decision]=N'returned') AS [returned],
      (SELECT [status] FROM [dbo].[FatwaQuestion] WHERE [id]=f.[questionId]) AS [question],
      (SELECT COUNT(*) FROM [dbo].[SearchIndexRequest] WHERE [scopeKind]=N'fatwa' AND [scopeId]=f.[id]) AS [intent]
    FROM [dbo].[Fatwa] f WHERE f.[id]=N'${fatwa}';
  `);
  if (
    JSON.stringify(history) !==
    JSON.stringify({
      version: 10,
      slug,
      current: 1,
      published: `${first},${third}`,
      revisions: 3,
      returned: 1,
      question: 'answered',
      intent: 2,
    })
  )
    fail(
      `A correction must append history and advance the current revision: ${JSON.stringify(history)}.`,
    );

  // ---- self-publication ----------------------------------------------------------
  const ownQuestion = randomUUID();
  const ownFatwa = randomUUID();
  const ownRevision = randomUUID();
  await expectAccepted(
    session,
    'A ruling drafted and submitted by a holder of both keys',
    `${submit(ownQuestion, closingAsker, body(3))}
     ${triage(ownQuestion, 1, category, triager)}
     ${assign(ownQuestion, 2, dual, triager)}
     ${save({ fatwa: ownFatwa, question: ownQuestion, expected: 0, revision: ownRevision, slug: `fx-own-${run}`, reason: null, actor: dual })}
     ${submitForReview(ownFatwa, 2, ownRevision, dual)}`,
  );
  await refuse(
    'Publication by the revision author',
    publish(ownFatwa, 3, ownRevision, dual, dualSession, dualGrant),
    [51243],
    'The author of a revision cannot publish it.',
  );

  // ---- reads, withdrawal and un-withdrawal ---------------------------------------
  await expectAccepted(
    session,
    'Reads recorded',
    `EXEC [dbo].[FatwaRecordRead] @fatwaId=N'${fatwa}', @day='2026-10-04';
     EXEC [dbo].[FatwaRecordRead] @fatwaId=N'${fatwa}', @day='2026-10-04';
     EXEC [dbo].[FatwaRecordRead] @fatwaId=N'${ownFatwa}', @day='2026-10-04';`,
  );
  await expectAccepted(
    session,
    'A ruling withdrawn',
    `EXEC [dbo].[FatwaWithdraw] @fatwaId=N'${fatwa}', @expectedVersion=10, @decisionId=N'${randomUUID()}', @reason=N'NON_FATWA_FIXTURE withdrawal reason', @actorId=N'${publisher}', @sessionId=N'${publisherSession}', @stepUpGrantId=N'${grant}', @at='${at}';
     EXEC [dbo].[FatwaRecordRead] @fatwaId=N'${fatwa}', @day='2026-10-04';`,
  );
  await refuse(
    'A withdrawn ruling restored directly',
    `UPDATE [dbo].[Fatwa] SET [withdrawnAt]=NULL, [version]=[version]+1 WHERE [id]=N'${fatwa}';`,
    [51248],
    'A Fatwa changes only through its workflow.',
  );
  const tallies = await session.query<{ fatwaId: string; reads: number }>(
    `SELECT [fatwaId], [reads] FROM [dbo].[FatwaReadTally] WHERE [fatwaId] IN (N'${fatwa}',N'${ownFatwa}');`,
  );
  if (JSON.stringify(tallies) !== JSON.stringify([{ fatwaId: fatwa, reads: 2 }]))
    fail(
      `Reads must be counted for a ruling public now and only then: ${JSON.stringify(tallies)}.`,
    );

  // ---- categories ----------------------------------------------------------------
  await refuse(
    'A category readdressed',
    `UPDATE [dbo].[FatwaCategory] SET [slug]=N'fx-moved-${run}', [version]=[version]+1 WHERE [id]=N'${category}';`,
    [51240],
    'A Fatwa category keeps its slug and moves one version at a time.',
  );
  await refuse(
    'A category changed without a version',
    `UPDATE [dbo].[FatwaCategory] SET [position]=5 WHERE [id]=N'${unused}';`,
    [51240],
    'A Fatwa category keeps its slug and moves one version at a time.',
  );
  await refuse(
    'A category deleted',
    `DELETE FROM [dbo].[FatwaCategory] WHERE [id]=N'${unused}';`,
    [51240],
    'A Fatwa category is never deleted.',
  );
  await refuse(
    'A category addressed as invalid grammar',
    `INSERT INTO [dbo].[FatwaCategory] ([id],[slug],[topicId],[position],[status]) VALUES (N'${randomUUID()}',N'Bad Slug',N'${topicA}',3,N'active');`,
    [547],
    'FatwaCategory_slug_ck',
  );

  // ---- the private question's own CHECKs -----------------------------------------
  const row = (status: string, text: string, extra = ''): string =>
    `INSERT INTO [dbo].[FatwaQuestion] ([id],[askerId],[body],[status],[categoryId],[assigneeId],[version],[submittedAt],[updatedAt]) VALUES (N'${randomUUID()}',N'${asker}',${text},N'${status}',${extra === '' ? 'NULL,NULL' : extra},1,SYSUTCDATETIME(),SYSUTCDATETIME());`;
  await refuse(
    'A question with no text before disposal',
    row('submitted', 'NULL'),
    [547],
    'FatwaQuestion_body_ck',
  );
  await refuse(
    'A question with empty text',
    row('submitted', "N''"),
    [547],
    'FatwaQuestion_body_ck',
  );
  await refuse(
    'A question in an invented status',
    row('pending', `N'${body(4)}'`, `N'${category}',NULL`),
    [547],
    'FatwaQuestion_status_ck',
  );
  await refuse(
    'A triaged question with no category',
    row('triaged', `N'${body(5)}'`),
    [547],
    'FatwaQuestion_facts_ck',
  );
  await refuse(
    'A question assigned to its asker',
    row('assigned', `N'${body(6)}'`, `N'${category}',N'${asker}'`),
    [547],
    'FatwaQuestion_facts_ck',
  );

  // ---- disposal --------------------------------------------------------------------
  await refuse(
    'Disposal for an account that is not closed',
    `EXEC [dbo].[FatwaDisposeQuestions] @askerId=N'${asker}', @limit=10, @at='${at}';`,
    [51246],
    "Only a closed account's questions are disposed of.",
  );
  await refuse(
    'Disposal with an unbounded batch',
    `EXEC [dbo].[FatwaDisposeQuestions] @askerId=NULL, @limit=0, @at='${at}';`,
    [51247],
    'The disposal batch is out of bounds.',
  );
  await session.query(
    `UPDATE [dbo].[User] SET [status]=N'closed' WHERE [id]=N'${closingAsker}';`,
  );
  const [disposed] = await session.query<{ disposed: number }>(
    `EXEC [dbo].[FatwaDisposeQuestions] @askerId=N'${closingAsker}', @limit=10, @at='${at}';`,
  );
  const remaining = await count(
    `SELECT COUNT(*) AS [total] FROM [dbo].[FatwaQuestion] WHERE [askerId]=N'${closingAsker}' AND ([body] IS NOT NULL OR [disposedAt] IS NULL OR [status]<>N'closed');`,
  );
  if (Number(disposed?.disposed) !== 1 || remaining !== 0)
    fail(
      `A closed account's question text must be erased: ${JSON.stringify({ disposed, remaining })}.`,
    );

  // ---- no audit row carries private or published text -----------------------------
  const [audit] = await session.query<{
    rows: number;
    leaked: number;
    malformed: number;
  }>(`
    SELECT COUNT(*) AS [rows],
      SUM(CASE WHEN ISNULL([afterState],N'') LIKE N'%NON[_]FATWA[_]FIXTURE%' OR ISNULL([beforeState],N'') LIKE N'%NON[_]FATWA[_]FIXTURE%' THEN 1 ELSE 0 END) AS [leaked],
      SUM(CASE WHEN ISJSON([afterState]) <> 1 THEN 1 ELSE 0 END) AS [malformed]
    FROM [dbo].[AuditLog] WHERE [action] LIKE N'fatwa.%';
  `);
  if (
    Number(audit?.rows) < 15 ||
    Number(audit?.leaked) !== 0 ||
    Number(audit?.malformed) !== 0
  )
    fail(
      `Fatwa audit rows must be well formed and hold no text: ${JSON.stringify(audit)}.`,
    );

  report(
    'fatwa rules',
    `activation, stage-separated authority, frozen addresses, step-up publication, ` +
      `immutable correction history, disposal and read tally; ${String(refusals)} refusals by ` +
      `name, every text a NON_FATWA_FIXTURE sentinel`,
  );
}

const PERSONALISATION_MIGRATION = '20261005000000_phase21_personalisation_notifications';

/** The two keys Phase 21 appends and bundles, and only these. */
const NEWSLETTER_PERMISSIONS = ['newsletter.operate', 'newsletter.read'];

/**
 * Every Ayah reference Phase 21 adds: a saved Ayah, an Ayah read and a reading
 * position, each the two-column canonical citation. `assertQuranFoundation`
 * admits exactly these beside its own, and only while Phase 21 is applied.
 */
const PERSONALISATION_AYAH_KEYS = [
  'QuranReadingProgress_surahNumber_ayahNumber_fkey',
  'ReadingHistory_surahNumber_ayahNumber_fkey',
  'SavedItem_surahNumber_ayahNumber_fkey',
];

/**
 * EVERY foreign key from a Phase-21 table, exactly, with its column mapping and
 * its delete action. Each owner and each typed target is NO ACTION: neither an
 * account nor any content takes a person's data with it, and a hard delete of a
 * referenced row is refused until Personalisation has released its own
 * references. The ONLY cascades are internal — a saved item its bookmark and
 * note, a private collection its members, a profile its interests and goals —
 * and a collection member carries the owner on both keys. A subscriber has no
 * key at all, to User or to anything.
 */
const PERSONALISATION_KEYS = [
  'Bookmark_savedItemId_fkey(savedItemId>id)>SavedItem:CASCADE',
  'NewsletterConsentEvent_subscriberId_fkey(subscriberId>id)>NewsletterSubscriber:NO_ACTION',
  'NotificationPreference_userId_fkey(userId>id)>User:NO_ACTION',
  'Notification_userId_fkey(userId>id)>User:NO_ACTION',
  'Note_savedItemId_fkey(savedItemId>id)>SavedItem:CASCADE',
  'PersonalisationGoal_userId_fkey(userId>userId)>PersonalisationProfile:CASCADE',
  'PersonalisationInterest_userId_fkey(userId>userId)>PersonalisationProfile:CASCADE',
  'PersonalisationProfile_userId_fkey(userId>id)>User:NO_ACTION',
  'PrivateCollectionItem_collection_fkey(collectionId>id,userId>userId)>PrivateCollection:CASCADE',
  'PrivateCollectionItem_savedItem_fkey(savedItemId>id,userId>userId)>SavedItem:NO_ACTION',
  'PrivateCollection_userId_fkey(userId>id)>User:NO_ACTION',
  'QuranReadingProgress_surahNumber_ayahNumber_fkey(surahNumber>surahNumber,ayahNumber>ayahNumber)>Ayah:NO_ACTION',
  'QuranReadingProgress_userId_fkey(userId>id)>User:NO_ACTION',
  'ReadingHistory_articleId_fkey(articleId>id)>Article:NO_ACTION',
  'ReadingHistory_hadithCitationId_fkey(hadithCitationId>id)>HadithCitation:NO_ACTION',
  'ReadingHistory_surahNumber_ayahNumber_fkey(surahNumber>surahNumber,ayahNumber>ayahNumber)>Ayah:NO_ACTION',
  'ReadingHistory_userId_fkey(userId>id)>User:NO_ACTION',
  'ReadingHistory_workId_fkey(workId>id)>Work:NO_ACTION',
  'SavedItem_articleId_fkey(articleId>id)>Article:NO_ACTION',
  'SavedItem_hadithCitationId_fkey(hadithCitationId>id)>HadithCitation:NO_ACTION',
  'SavedItem_surahNumber_ayahNumber_fkey(surahNumber>surahNumber,ayahNumber>ayahNumber)>Ayah:NO_ACTION',
  'SavedItem_userId_fkey(userId>id)>User:NO_ACTION',
  'SavedItem_videoId_fkey(videoId>id)>Video:NO_ACTION',
  'SavedItem_workId_fkey(workId>id)>Work:NO_ACTION',
  'WatchHistory_userId_fkey(userId>id)>User:NO_ACTION',
  'WatchHistory_videoId_fkey(videoId>id)>Video:NO_ACTION',
].sort();

/**
 * Every unique index on a Phase-21 table, exactly, with its filter. The typed
 * target keys are FILTERED so each holds only where its column is set, and a
 * token-hash key only while a link is live.
 */
const PERSONALISATION_UNIQUE = [
  'Bookmark_pkey(savedItemId)',
  'NewsletterConsentEvent_pkey(id)',
  'NewsletterSubscriber_confirm_key(confirmTokenHash) WHERE ([confirmTokenHash] IS NOT NULL)',
  'NewsletterSubscriber_emailDigest_key(emailDigest)',
  'NewsletterSubscriber_pkey(id)',
  'NewsletterSubscriber_unsubscribe_key(unsubscribeTokenHash) WHERE ([unsubscribeTokenHash] IS NOT NULL)',
  'Note_pkey(savedItemId)',
  'NotificationPreference_pkey(userId,category,channel)',
  'Notification_idempotency_key(userId,idempotencyKey)',
  'Notification_pkey(id)',
  'PersonalisationGoal_pkey(userId,goal)',
  'PersonalisationInterest_pkey(userId,interest)',
  'PersonalisationProfile_pkey(userId)',
  'PrivateCollectionItem_pkey(collectionId,savedItemId)',
  'PrivateCollectionItem_position_key(collectionId,position)',
  'PrivateCollection_owner_key(id,userId)',
  'PrivateCollection_pkey(id)',
  'QuranReadingProgress_pkey(userId)',
  'ReadingHistory_article_key(articleId,userId) WHERE ([articleId] IS NOT NULL)',
  'ReadingHistory_ayah_key(surahNumber,ayahNumber,userId) WHERE ([surahNumber] IS NOT NULL)',
  'ReadingHistory_hadith_key(hadithCitationId,userId) WHERE ([hadithCitationId] IS NOT NULL)',
  'ReadingHistory_pkey(id)',
  'ReadingHistory_work_key(workId,userId) WHERE ([workId] IS NOT NULL)',
  'SavedItem_article_key(articleId,userId) WHERE ([articleId] IS NOT NULL)',
  'SavedItem_ayah_key(surahNumber,ayahNumber,userId) WHERE ([surahNumber] IS NOT NULL)',
  'SavedItem_hadith_key(hadithCitationId,userId) WHERE ([hadithCitationId] IS NOT NULL)',
  'SavedItem_owner_key(id,userId)',
  'SavedItem_pkey(id)',
  'SavedItem_video_key(videoId,userId) WHERE ([videoId] IS NOT NULL)',
  'SavedItem_work_key(workId,userId) WHERE ([workId] IS NOT NULL)',
  'WatchHistory_pkey(userId,videoId)',
].sort();

/**
 * Every column of every Phase-21 table, in order. Stated whole so a stored
 * title, status or text of a target, a `targetType`/`targetId` or `contentType`
 * pair, a raw token, a course or lesson column or a subscriber's account link
 * cannot arrive unnoticed.
 */
const PERSONALISATION_COLUMNS: Readonly<Record<string, string>> = {
  PersonalisationProfile: 'userId,onboarding,historyEnabled,version,createdAt,updatedAt',
  PersonalisationInterest: 'userId,interest',
  PersonalisationGoal: 'userId,goal',
  SavedItem:
    'id,userId,articleId,workId,videoId,surahNumber,ayahNumber,hadithCitationId,createdAt',
  Bookmark: 'savedItemId,createdAt',
  Note: 'savedItemId,body,version,createdAt,updatedAt',
  PrivateCollection: 'id,userId,title,description,version,createdAt,updatedAt',
  PrivateCollectionItem: 'collectionId,savedItemId,userId,position,addedAt',
  ReadingHistory:
    'id,userId,articleId,workId,surahNumber,ayahNumber,hadithCitationId,firstReadAt,lastReadAt',
  WatchHistory: 'userId,videoId,firstWatchedAt,lastWatchedAt',
  QuranReadingProgress: 'userId,surahNumber,ayahNumber,version,updatedAt',
  NotificationPreference: 'userId,category,channel,enabled,updatedAt',
  Notification: 'id,userId,kind,category,destination,idempotencyKey,createdAt,readAt',
  NewsletterSubscriber:
    'id,emailDigest,digestKeyVersion,email,state,locale,generation,confirmTokenHash,' +
    'confirmSalt,confirmExpiresAt,unsubscribeTokenHash,unsubscribeSalt,tokenKeyVersion,' +
    'submittedAt,confirmedAt,endedAt,version,updatedAt',
  NewsletterConsentEvent:
    'id,subscriberId,event,purpose,noticeVersion,source,locale,occurredAt',
};

/**
 * Whether Phase 21 is applied, ALL OR NOTHING: either every one of its fifteen
 * tables exists or none does. Half a schema fails here rather than letting an
 * earlier owner's foundation check admit or refuse its references by accident.
 */
async function personalisationPresent(session: SqlSession): Promise<boolean> {
  const names = PERSONALISATION_TABLES.map((table) => `N'${table}'`).join(',');
  const [row] = await session.query<{ present: number }>(
    `SELECT COUNT(*) AS [present] FROM sys.tables WHERE [name] IN (${names});`,
  );
  const present = Number(row?.present ?? -1);
  if (present !== 0 && present !== PERSONALISATION_TABLES.length)
    fail(
      `Phase 21 is half applied: ${String(present)} of ${String(PERSONALISATION_TABLES.length)} ` +
        `Personalisation tables exist.`,
    );
  return present === PERSONALISATION_TABLES.length;
}

/** The Ayah keys Personalisation holds now: all three, or none. */
async function personalisationAyahKeys(session: SqlSession): Promise<readonly string[]> {
  return (await personalisationPresent(session)) ? PERSONALISATION_AYAH_KEYS : [];
}

/**
 * Phase 21 — what only the catalogue can prove about Personalisation:
 *
 *   1. NOTHING IS SEEDED: all fifteen tables are empty after deploy — no saved
 *      item, note, history, notification or subscriber of anybody;
 *   2. every column of every table is exactly as stated — no `targetType`,
 *      `targetId` or `contentType`, no stored title or status of a target, no
 *      raw token, no course or lesson column — and the unique and FILTERED
 *      indexes are exactly the per-account typed-target keys, the owner keys a
 *      collection member reaches through and the two live-link keys;
 *   3. every foreign key is exactly one of the twenty-six above: owners and
 *      typed targets NO ACTION, the five internal cascades the only cascades, a
 *      collection member's owner on both of its keys, and no key from the
 *      newsletter to User; no other owner references a Phase-21 table;
 *   4. the CHECKs are exactly the sixteen named rules, and the one trigger
 *      raises exactly 51260 on any UPDATE or DELETE of consent evidence;
 *   5. the vocabulary is exactly the two newsletter keys, described as the
 *      compiled catalogue describes them, BOTH in the protected bundle and held
 *      by no other role, with exactly one `newsletter.permissions.provisioned`
 *      record naming this migration; no permission names saved items, notes,
 *      history or notifications; and the protected bundle is the compiled
 *      bundle — less the two Learning keys once Phase 22 is rolled back.
 *
 * The rules themselves are proved as BEHAVIOUR by `assertPersonalisationRules`,
 * and through the runtime login by `db:test:permissions`.
 */
async function assertPersonalisationFoundation(
  session: SqlSession,
  stage: Exclude<BundleStage, 'before-personalisation'> = 'current',
): Promise<void> {
  const tables = PERSONALISATION_TABLES.map(
    (table) => `OBJECT_ID(N'[dbo].[${table}]')`,
  ).join(',');
  if (!(await personalisationPresent(session)))
    fail('The Phase-21 Personalisation tables are missing after deploy.');

  // ---- 1. nothing seeded -------------------------------------------------------
  const counts = await session.query<{ name: string; total: number }>(
    PERSONALISATION_TABLES.map(
      (table) =>
        `SELECT N'${table}' AS [name], COUNT_BIG(*) AS [total] FROM [dbo].[${table}]`,
    ).join(' UNION ALL ') + ';',
  );
  const seeded = counts.filter((row) => Number(row.total) !== 0);
  if (PERSONALISATION_TABLES.length !== 15 || counts.length !== 15 || seeded.length > 0)
    fail(
      `The Personalisation migration must create fifteen empty tables and seed nothing; ` +
        `found ${String(counts.length)} tables, seeded: ${JSON.stringify(seeded)}.`,
    );

  // ---- 2. exact columns, exact unique and filtered indexes ----------------------
  const shapes = await session.query<{ name: string; columns: string }>(`
    SELECT OBJECT_NAME(c.[object_id]) AS [name],
      STRING_AGG(c.[name], N',') WITHIN GROUP (ORDER BY c.[column_id]) AS [columns]
    FROM sys.columns c WHERE c.[object_id] IN (${tables})
    GROUP BY c.[object_id];
  `);
  const shapeFindings = PERSONALISATION_TABLES.filter(
    (table) =>
      shapes.find((row) => row.name === table)?.columns !==
      PERSONALISATION_COLUMNS[table],
  );
  if (shapes.length !== 15 || shapeFindings.length > 0)
    fail(
      `Personalisation columns differ from the reviewed shape in ${shapeFindings.join(', ')}: ` +
        `${JSON.stringify(shapes.filter((row) => shapeFindings.includes(row.name)))}.`,
    );

  const generic = await session.query<{ name: string }>(`
    SELECT OBJECT_NAME(c.[object_id]) + N'.' + c.[name] AS [name] FROM sys.columns c
    WHERE c.[object_id] IN (${tables})
      AND (c.[name] LIKE N'%type%' OR c.[name] LIKE N'%target%' OR c.[name] LIKE N'%entity%'
           OR c.[name] LIKE N'%course%' OR c.[name] LIKE N'%lesson%' OR c.[name] LIKE N'%class%'
           OR c.[name] LIKE N'%teacher%' OR c.[name] LIKE N'%slug%' OR c.[name] LIKE N'%status%'
           OR c.[name] LIKE N'%token' OR c.[name] LIKE N'%password%' OR c.[name] LIKE N'%account%'
           OR (c.[name] LIKE N'%title%' AND OBJECT_NAME(c.[object_id]) <> N'PrivateCollection'));
  `);
  if (generic.length > 0)
    fail(
      `Personalisation may carry no type, target, course, copied-content, raw-token or account ` +
        `column; found ${JSON.stringify(generic)}.`,
    );

  const unique = await session.query<{
    name: string;
    columns: string;
    filter: string | null;
  }>(`
    SELECT i.[name], i.[filter_definition] AS [filter],
      STRING_AGG(COL_NAME(ic.[object_id], ic.[column_id]), N',')
        WITHIN GROUP (ORDER BY ic.[key_ordinal]) AS [columns]
    FROM sys.indexes i
    JOIN sys.index_columns ic ON ic.[object_id] = i.[object_id] AND ic.[index_id] = i.[index_id]
    WHERE i.[is_unique] = 1 AND ic.[key_ordinal] > 0 AND i.[object_id] IN (${tables})
    GROUP BY i.[object_id], i.[name], i.[filter_definition];
  `);
  const describedUnique = unique
    .map(
      (row) =>
        `${row.name}(${row.columns})` +
        (row.filter === null ? '' : ` WHERE ${row.filter}`),
    )
    .sort();
  if (describedUnique.join(' | ') !== PERSONALISATION_UNIQUE.join(' | '))
    fail(
      `Personalisation must hold each typed target at most once per account, and a live link ` +
        `in one subscription; found ${describedUnique.join(' | ')}.`,
    );

  // ---- 3. exact keys: internal cascades only, nothing to the newsletter's User ---
  const keys = await session.query<{
    name: string;
    columns: string;
    target: string;
    deletes: string;
    updates: string;
  }>(`
    SELECT fk.[name], OBJECT_NAME(fk.[referenced_object_id]) AS [target],
      fk.[delete_referential_action_desc] AS [deletes], fk.[update_referential_action_desc] AS [updates],
      STRING_AGG(COL_NAME(c.[parent_object_id], c.[parent_column_id]) + N'>'
        + COL_NAME(c.[referenced_object_id], c.[referenced_column_id]), N',')
        WITHIN GROUP (ORDER BY c.[constraint_column_id]) AS [columns]
    FROM sys.foreign_keys fk
    JOIN sys.foreign_key_columns c ON c.[constraint_object_id] = fk.[object_id]
    WHERE fk.[parent_object_id] IN (${tables})
    GROUP BY fk.[name], fk.[referenced_object_id], fk.[delete_referential_action_desc],
      fk.[update_referential_action_desc];
  `);
  const describedKeys = keys
    .map((row) => `${row.name}(${row.columns})>${row.target}:${row.deletes}`)
    .sort();
  if (
    describedKeys.join(',') !== PERSONALISATION_KEYS.join(',') ||
    keys.some((row) => row.updates !== 'NO_ACTION')
  )
    fail(
      `Personalisation's keys must be exactly the reviewed twenty-six, cascading only ` +
        `inside the context; found ${describedKeys.join(', ')}.`,
    );

  const [isolation] = await session.query<{
    inbound: number;
    newsletterKeys: string | null;
    foreign: string | null;
  }>(`
    SELECT
      (SELECT COUNT(*) FROM sys.foreign_keys
        WHERE [referenced_object_id] IN (${tables}) AND [parent_object_id] NOT IN (${tables})) AS [inbound],
      (SELECT STRING_AGG([name], N',') FROM sys.foreign_keys
        WHERE [parent_object_id] = OBJECT_ID(N'[dbo].[NewsletterSubscriber]')
           OR ([parent_object_id] = OBJECT_ID(N'[dbo].[NewsletterConsentEvent]')
               AND [referenced_object_id] <> OBJECT_ID(N'[dbo].[NewsletterSubscriber]'))) AS [newsletterKeys],
      (SELECT STRING_AGG(OBJECT_NAME(c.[object_id]) + N'.' + c.[name], N',') FROM sys.columns c
        WHERE (c.[name] LIKE N'%saveditem%' OR c.[name] LIKE N'%bookmark%' OR c.[name] LIKE N'%newsletter%'
               OR c.[name] LIKE N'%subscriber%' OR c.[name] LIKE N'%notification%')
          AND c.[object_id] NOT IN (${tables})
          AND OBJECTPROPERTY(c.[object_id], 'IsUserTable') = 1) AS [foreign];
  `);
  if (
    Number(isolation?.inbound) !== 0 ||
    (isolation?.newsletterKeys ?? null) !== null ||
    (isolation?.foreign ?? null) !== null
  )
    fail(
      `No other owner may reference or hold Personalisation schema, and a newsletter ` +
        `subscription relates to nothing; found ${JSON.stringify(isolation ?? null)}.`,
    );

  // ---- 4. exactly sixteen CHECKs and one immutable-evidence trigger -----------
  const checks = await session.query<{ name: string; trusted: number }>(`
    SELECT [name], CASE WHEN [is_disabled] = 0 AND [is_not_trusted] = 0 THEN 1 ELSE 0 END AS [trusted]
    FROM sys.check_constraints WHERE [parent_object_id] IN (${tables});
  `);
  const expectedChecks = EXPECTED_CHECK_CONSTRAINTS.filter((entry) =>
    PERSONALISATION_TABLES.includes(entry.table),
  )
    .map((entry) => entry.constraint)
    .sort();
  if (
    expectedChecks.length !== 16 ||
    checks
      .map((row) => row.name)
      .sort()
      .join(',') !== expectedChecks.join(',') ||
    checks.some((row) => Number(row.trusted) !== 1)
  )
    fail(
      `Personalisation must carry exactly its sixteen trusted CHECKs; found ${JSON.stringify(checks)}.`,
    );

  const triggers = await session.query<{
    name: string;
    tableName: string;
    events: string;
    definition: string | null;
  }>(`
    SELECT t.[name], OBJECT_NAME(t.[parent_id]) AS [tableName], OBJECT_DEFINITION(t.[object_id]) AS [definition],
      (SELECT STRING_AGG(e.[type_desc], N',') WITHIN GROUP (ORDER BY e.[type_desc])
         FROM sys.trigger_events e WHERE e.[object_id] = t.[object_id]) AS [events]
    FROM sys.triggers t WHERE t.[parent_id] IN (${tables});
  `);
  const describedTriggers = triggers
    .map(
      (row) =>
        `${row.name}@${row.tableName}[${row.events}]:${raisedNumbers(row.definition)}`,
    )
    .join(',');
  if (
    describedTriggers !==
    'NewsletterConsentEventImmutable@NewsletterConsentEvent[DELETE,UPDATE]:51260'
  )
    fail(
      `Consent evidence must be guarded by exactly one trigger refusing UPDATE and DELETE ` +
        `with 51260; found ${describedTriggers || '(none)'}.`,
    );

  const [procedures] = await session.query<{ total: number }>(`
    SELECT COUNT(*) AS [total] FROM sys.procedures
    WHERE [name] LIKE N'Personal%' OR [name] LIKE N'Newsletter%' OR [name] LIKE N'Notification%'
       OR [name] LIKE N'Saved%';
  `);
  if (Number(procedures?.total) !== 0)
    fail('Phase 21 writes through its owner adapters; it must create no procedure.');

  // ---- 5. two keys, both bundled, provisioned once ----------------------------
  const permissions = await session.query<{
    key: string;
    description: string;
    bundled: number;
    held: number;
  }>(`
    SELECT p.[key], p.[description],
      (SELECT COUNT(*) FROM [dbo].[RolePermission] rp JOIN [dbo].[Role] r ON r.[id] = rp.[roleId]
        WHERE r.[key] = N'platform-administrator' AND rp.[permissionKey] = p.[key]) AS [bundled],
      (SELECT COUNT(*) FROM [dbo].[RolePermission] rp WHERE rp.[permissionKey] = p.[key]) AS [held]
    FROM [dbo].[Permission] p
    WHERE p.[key] LIKE N'newsletter%' OR p.[key] LIKE N'notification%' OR p.[key] LIKE N'personal%'
       OR p.[key] LIKE N'saved%' OR p.[key] LIKE N'bookmark%' OR p.[key] LIKE N'note%'
       OR p.[key] LIKE N'history%' OR p.[key] LIKE N'subscriber%'
    ORDER BY p.[key];
  `);
  const described = new Map(
    PERMISSION_CATALOGUE.map((entry) => [entry.key as string, entry.description]),
  );
  const compiled = new Set<string>(PLATFORM_ADMINISTRATOR_PERMISSIONS);
  if (
    permissions.map((row) => row.key).join(',') !== NEWSLETTER_PERMISSIONS.join(',') ||
    !NEWSLETTER_PERMISSIONS.every((key) => compiled.has(key)) ||
    permissions.some(
      (row) =>
        row.description !== described.get(row.key) ||
        Number(row.bundled) !== 1 ||
        Number(row.held) !== 1,
    )
  )
    fail(
      `The Personalisation vocabulary must be exactly ${NEWSLETTER_PERMISSIONS.join(', ')}, ` +
        `described as the compiled catalogue describes them, in the protected bundle and held ` +
        `by no other role; found ${JSON.stringify(permissions)}.`,
    );

  const provisioning = await session.query<{
    actorType: string;
    actorId: string | null;
    targetType: string;
    roleKey: string | null;
    afterState: string | null;
    authorisingSource: string | null;
  }>(`
    SELECT a.[actorType], a.[actorId], a.[targetType], r.[key] AS [roleKey], a.[afterState], a.[authorisingSource]
    FROM [dbo].[AuditLog] a LEFT JOIN [dbo].[Role] r ON r.[id] = a.[targetId]
    WHERE a.[action] = N'newsletter.permissions.provisioned';
  `);
  if (
    JSON.stringify(provisioning) !==
    JSON.stringify([
      {
        actorType: 'migration',
        actorId: null,
        targetType: 'role',
        roleKey: 'platform-administrator',
        afterState: '{"added":"newsletter.operate newsletter.read"}',
        authorisingSource: PERSONALISATION_MIGRATION,
      },
    ])
  )
    fail(
      `Extending the protected bundle must leave exactly one provisioning record naming the ` +
        `added keys and this migration; found ${JSON.stringify(provisioning)}.`,
    );

  // Once Phase 22 is rolled back the database's bundle lacks the two Learning
  // keys the compiled bundle now carries; the Phase-21 state is otherwise whole.
  const bundled = await assertProtectedBundleExcludesGated(session);
  const compiledBundle = compiledBundleAt(stage).length;
  if (bundled !== compiledBundle)
    fail(
      `The protected bundle holds ${String(bundled)} keys; the compiled bundle holds ` +
        `${String(compiledBundle)} at stage ${stage}.`,
    );

  report(
    'personalisation schema',
    'fifteen empty tables of the reviewed shape, filtered per-account target keys, ' +
      'twenty-six keys cascading only inside the context, 16 CHECKs, one 51260 trigger, ' +
      `two bundled newsletter keys provisioned once, ${String(bundled)} bundled`,
  );
}

/**
 * After the Phase-21 rollback: no Personalisation table, key, index or trigger,
 * no newsletter permission, bundle entry or provisioning record — and the
 * protected bundle is the catalogue less the gated keys and exactly the
 * compiled bundle less the two newsletter keys and the two Learning keys Phase
 * 22's rollback removed before it. The caller then proves the owners
 * Personalisation referenced are intact.
 */
async function assertPersonalisationRemoved(session: SqlSession): Promise<void> {
  const names = PERSONALISATION_TABLES.map((table) => `N'${table}'`).join(',');
  const [row] = await session.query<Record<string, number>>(`
    SELECT
      (SELECT COUNT(*) FROM sys.tables WHERE [name] IN (${names})) AS [tables],
      (SELECT COUNT(*) FROM sys.triggers WHERE [name] = N'NewsletterConsentEventImmutable') AS [triggers],
      (SELECT COUNT(*) FROM sys.foreign_keys
        WHERE LEFT([name], CHARINDEX(N'_', [name] + N'_') - 1) IN (${names})) AS [keys],
      (SELECT COUNT(*) FROM sys.check_constraints
        WHERE LEFT([name], CHARINDEX(N'_', [name] + N'_') - 1) IN (${names})) AS [checks],
      (SELECT COUNT(*) FROM sys.indexes
        WHERE LEFT([name], CHARINDEX(N'_', [name] + N'_') - 1) IN (${names})) AS [indexes],
      (SELECT COUNT(*) FROM [dbo].[Permission] WHERE [key] LIKE N'newsletter.%') AS [permissions],
      (SELECT COUNT(*) FROM [dbo].[RolePermission] WHERE [permissionKey] LIKE N'newsletter.%') AS [bundled],
      (SELECT COUNT(*) FROM [dbo].[AuditLog] WHERE [action] = N'newsletter.permissions.provisioned') AS [audit];
  `);
  if (Object.values(row ?? { missing: 1 }).some((value) => Number(value) !== 0))
    fail(
      `The Phase-21 rollback left a Personalisation object: ${JSON.stringify(row ?? null)}.`,
    );
  if (await personalisationPresent(session))
    fail('The Phase-21 rollback left the Personalisation schema in place.');
  const bundled = await assertProtectedBundleExcludesGated(session);
  const expected = compiledBundleAt('before-personalisation').length;
  if (
    bundled !== expected ||
    expected !==
      PLATFORM_ADMINISTRATOR_PERMISSIONS.length -
        NEWSLETTER_PERMISSIONS.length -
        LEARNING_PERMISSIONS.length -
        CLASSES_PERMISSIONS.length -
        MEMBERSHIP_PERMISSIONS.length -
        DONATIONS_BUNDLED.length -
        MIGRATION_BUNDLED.length
  )
    fail(
      `After the Phase-21 rollback the protected bundle holds ${String(bundled)} keys; the ` +
        `compiled bundle less the two newsletter, two Learning, two class, two ` +
        `Membership, two bundled Donations and two bundled Migration keys holds ` +
        `${String(expected)}.`,
    );
  report(
    'personalisation rollback',
    `every Personalisation table, key, index, CHECK, trigger, newsletter permission and ` +
      `provisioning record removed; ${String(bundled)} keys still bundled`,
  );
}

/**
 * Phase 21 — THE RULES, proved as behaviour against the re-deployed schema
 * with NON_PERSONALISATION_FIXTURE sentinels only, through the migration login
 * (the runtime's own posture is `db:test:permissions`'s):
 *
 *   - a saved item and a history row name EXACTLY ONE typed target: none, two,
 *     or half an Ayah citation is refused (…_one_target_ck); a video cannot be
 *     a reading-history row at all; each account holds each target at most once
 *     (the filtered keys) while two accounts may each hold it; a target that
 *     does not exist — an Ayah or a public Hadith citation included — is
 *     refused by its own typed key;
 *   - nothing cascades from content or an account: a referenced Article, Work
 *     or Video cannot be deleted while a saved item or history row names it,
 *     and can once Personalisation has released it; an account with saved
 *     items cannot be deleted;
 *   - inside the context only: a saved item takes its bookmark and note, a
 *     private collection its members, a profile its interests and goals; a
 *     saved item that is still a collection member is not deleted; a member
 *     joins only its owner's collection to its owner's saved item, at a unique
 *     place from 0 to 199;
 *   - a notification destination is a path on this site and nothing else —
 *     no scheme, host, protocol-relative URL, backslash, dot segment or
 *     percent-encoding — its idempotency key is unique per account, and the
 *     kind, category and channel vocabularies are closed;
 *   - a newsletter state holds exactly the columns it may: a pending
 *     subscription has its live link hashes, an ended one keeps no address;
 *     one digest per address and one subscription per live link hash; a
 *     subscriber with consent evidence is never deleted, and that evidence
 *     refuses UPDATE and DELETE even to this privileged session (51260).
 */
async function assertPersonalisationRules(session: SqlSession): Promise<void> {
  const run = randomUUID().replaceAll('-', '').slice(0, 16);
  const at = '2026-10-05T00:00:00';
  const later = '2026-10-05T01:00:00';
  let refusals = 0;
  const refuse = async (
    label: string,
    statement: string,
    numbers: readonly number[],
    rule: string,
  ): Promise<void> => {
    await expectRefusal(session, label, statement, numbers, rule);
    refusals += 1;
  };
  const count = async (statement: string): Promise<number> => {
    const [row] = await session.query<{ total: number }>(statement);
    return Number(row?.total ?? -1);
  };
  const hash = (label: string): string =>
    createHash('sha256')
      .update(`NON_PERSONALISATION_FIXTURE ${run} ${label}`)
      .digest('hex');

  // ---- the accounts and the content the proofs name -----------------------------
  const owner = randomUUID();
  const other = randomUUID();
  const closing = randomUUID();
  for (const [user, label] of [
    [owner, 'owner'],
    [other, 'other'],
    [closing, 'closing'],
  ] as const)
    await session.query(
      `INSERT INTO [dbo].[User] ([id],[name],[email],[emailVerified],[createdAt],[updatedAt],[locale],[status],[twoFactorEnabled]) VALUES (N'${user}',N'NON_PERSONALISATION_FIXTURE ${label}',N'${label}-${run}@personalisation-proof.invalid',0,SYSUTCDATETIME(),SYSUTCDATETIME(),N'en',N'active',0);`,
    );

  // Two of each releasable target, written as their owners write them: an
  // Article as a draft with no revision, a Work and a Video published (their
  // slugs reserved by their owners' own triggers). Every slug is a sentinel.
  const articles = [randomUUID(), randomUUID()] as const;
  const works = [randomUUID(), randomUUID()] as const;
  const videos = [randomUUID(), randomUUID()] as const;
  for (const [index, id] of articles.entries())
    await expectAccepted(
      session,
      'Article synthetic target',
      `INSERT INTO [dbo].[Article] ([id],[slug],[state],[version],[creatorId],[updatedAt]) VALUES (N'${id}',N'non-personalisation-fixture-article-${String(index)}-${run}',N'draft',1,N'${owner}',SYSUTCDATETIME());`,
    );
  for (const [index, id] of works.entries())
    await expectAccepted(
      session,
      'Work synthetic target',
      `INSERT INTO [dbo].[Work] ([id],[slug],[primaryLocale],[state]) VALUES (N'${id}',N'non-personalisation-fixture-work-${String(index)}-${run}',N'en',N'published');`,
    );
  for (const [index, id] of videos.entries())
    await expectAccepted(
      session,
      'Video synthetic target',
      `INSERT INTO [dbo].[Video] ([id],[slug],[primaryLocale],[state],[provider],[providerVideoId],[availability],[languageCode]) VALUES (N'${id}',N'non-personalisation-fixture-video-${String(index)}-${run}',N'en',N'published',N'youtube','p21${String(index)}${run.slice(0, 7)}',N'available',N'en');`,
    );

  // An Ayah and a public Hadith citation are written only through their owners'
  // guarded canonical paths, so the proofs name rows the Quran and Hadith rule
  // proofs above already wrote — and fail rather than pass vacuously without.
  const [ayah] = await session.query<{ surahNumber: number; ayahNumber: number }>(
    'SELECT TOP 1 [surahNumber], [ayahNumber] FROM [dbo].[Ayah] ORDER BY [surahNumber], [ayahNumber];',
  );
  const [citation] = await session.query<{ id: string }>(
    'SELECT TOP 1 [id] FROM [dbo].[HadithCitation] ORDER BY [id];',
  );
  if (ayah === undefined || citation === undefined)
    fail(
      'The Personalisation rules need an Ayah and a Hadith citation from the canonical rule ' +
        'proofs, which must run first.',
    );
  const ayahColumns = {
    surahNumber: String(ayah.surahNumber),
    ayahNumber: String(ayah.ayahNumber),
  };

  const saved = (
    id: string,
    user: string,
    target: Readonly<Record<string, string>>,
  ): string => {
    const columns = Object.keys(target);
    const values = Object.entries(target).map(([column, value]) =>
      column === 'surahNumber' || column === 'ayahNumber' ? value : `N'${value}'`,
    );
    return `INSERT INTO [dbo].[SavedItem] ([id],[userId]${columns.map((column) => `,[${column}]`).join('')},[createdAt]) VALUES (N'${id}',N'${user}'${values.map((value) => `,${value}`).join('')},'${at}');`;
  };
  const read = (
    user: string,
    target: Readonly<Record<string, string>>,
    last = at,
  ): string => {
    const columns = Object.keys(target);
    const values = Object.entries(target).map(([column, value]) =>
      column === 'surahNumber' || column === 'ayahNumber' ? value : `N'${value}'`,
    );
    return `INSERT INTO [dbo].[ReadingHistory] ([id],[userId]${columns.map((column) => `,[${column}]`).join('')},[firstReadAt],[lastReadAt]) VALUES (N'${randomUUID()}',N'${user}'${values.map((value) => `,${value}`).join('')},'${at}','${last}');`;
  };

  // ---- exactly one typed target, at most once per account ----------------------
  const savedIds = {
    article: randomUUID(),
    work: randomUUID(),
    video: randomUUID(),
    ayah: randomUUID(),
    hadith: randomUUID(),
  };
  const targets: Readonly<
    Record<keyof typeof savedIds, Readonly<Record<string, string>>>
  > = {
    article: { articleId: articles[0] },
    work: { workId: works[0] },
    video: { videoId: videos[0] },
    ayah: ayahColumns,
    hadith: { hadithCitationId: citation.id },
  };
  for (const kind of Object.keys(savedIds) as (keyof typeof savedIds)[])
    await expectAccepted(
      session,
      `A ${kind} saved by its owner`,
      saved(savedIds[kind], owner, targets[kind]),
    );
  for (const kind of Object.keys(savedIds) as (keyof typeof savedIds)[]) {
    await refuse(
      `The same ${kind} saved twice by one account`,
      saved(randomUUID(), owner, targets[kind]),
      [2601],
      `SavedItem_${kind}_key`,
    );
    await expectAccepted(
      session,
      `The same ${kind} saved by a second account`,
      saved(randomUUID(), other, targets[kind]),
    );
  }
  await refuse(
    'A saved item with no target',
    saved(randomUUID(), owner, {}),
    [547],
    'SavedItem_one_target_ck',
  );
  await refuse(
    'A saved item with two targets',
    saved(randomUUID(), closing, { articleId: articles[1], workId: works[1] }),
    [547],
    'SavedItem_one_target_ck',
  );
  await refuse(
    'A saved Ayah with only its Surah',
    saved(randomUUID(), closing, { surahNumber: ayahColumns.surahNumber }),
    [547],
    'SavedItem_one_target_ck',
  );
  await refuse(
    'A saved Ayah with only its verse number',
    saved(randomUUID(), closing, { ayahNumber: ayahColumns.ayahNumber }),
    [547],
    'SavedItem_one_target_ck',
  );
  await refuse(
    'A saved Ayah that does not exist',
    saved(randomUUID(), closing, { surahNumber: '9999', ayahNumber: '9999' }),
    [547],
    'SavedItem_surahNumber_ayahNumber_fkey',
  );
  await refuse(
    'A saved Hadith citation that does not exist',
    saved(randomUUID(), closing, { hadithCitationId: randomUUID() }),
    [547],
    'SavedItem_hadithCitationId_fkey',
  );
  await refuse(
    'A saved Article that does not exist',
    saved(randomUUID(), closing, { articleId: randomUUID() }),
    [547],
    'SavedItem_articleId_fkey',
  );

  for (const [kind, target] of [
    ['article', { articleId: articles[0] }],
    ['work', { workId: works[0] }],
    ['ayah', ayahColumns],
    ['hadith', { hadithCitationId: citation.id }],
  ] as const) {
    await expectAccepted(session, `A ${kind} read by its owner`, read(owner, target));
    await refuse(
      `A second history row for the same ${kind}`,
      read(owner, target),
      [2601],
      `ReadingHistory_${kind}_key`,
    );
  }
  await refuse(
    'A history row with no target',
    read(closing, {}),
    [547],
    'ReadingHistory_one_target_ck',
  );
  await refuse(
    'A history row with two targets',
    read(closing, { articleId: articles[1], workId: works[1] }),
    [547],
    'ReadingHistory_one_target_ck',
  );
  await refuse(
    'A history row last read before it was first read',
    read(closing, { articleId: articles[1] }, '2026-10-04T00:00:00'),
    [547],
    'ReadingHistory_ck',
  );
  await refuse(
    'A video named as reading history',
    `INSERT INTO [dbo].[ReadingHistory] ([id],[userId],[videoId],[firstReadAt],[lastReadAt]) VALUES (N'${randomUUID()}',N'${closing}',N'${videos[1]}','${at}','${at}');`,
    [207],
    'videoId',
  );
  await expectAccepted(
    session,
    'A video watched by its owner',
    `INSERT INTO [dbo].[WatchHistory] ([userId],[videoId],[firstWatchedAt],[lastWatchedAt]) VALUES (N'${owner}',N'${videos[1]}','${at}','${later}');`,
  );
  await refuse(
    'A watch row last watched before it was first watched',
    `INSERT INTO [dbo].[WatchHistory] ([userId],[videoId],[firstWatchedAt],[lastWatchedAt]) VALUES (N'${other}',N'${videos[1]}','${later}','${at}');`,
    [547],
    'WatchHistory_ck',
  );

  // ---- nothing cascades from content or an account -------------------------------
  //
  // Each target's owner first releases the slug reservation its own trigger
  // wrote, so the Personalisation key is the ONLY reference left and the
  // refusal can only be that key's. The disposable database is the owner's.
  await session.query(`
    DELETE FROM [dbo].[WorkSlugHistory] WHERE [workId] IN (N'${works[0]}', N'${works[1]}');
    DELETE FROM [dbo].[VideoSlugHistory] WHERE [videoId] IN (N'${videos[0]}', N'${videos[1]}');
  `);
  // A target named by BOTH a saved item and a history row conflicts with two
  // keys, and SQL Server names whichever its plan checks first — so the first
  // Article's and Work's history rows are released before the proof.
  await session.query(
    `DELETE FROM [dbo].[ReadingHistory] WHERE [userId]=N'${owner}' AND ([articleId]=N'${articles[0]}' OR [workId]=N'${works[0]}');`,
  );
  const personalRows = async (): Promise<number> =>
    count(`
      SELECT (SELECT COUNT_BIG(*) FROM [dbo].[SavedItem]) + (SELECT COUNT_BIG(*) FROM [dbo].[ReadingHistory])
        + (SELECT COUNT_BIG(*) FROM [dbo].[WatchHistory]) AS [total];
    `);
  const before = await personalRows();
  for (const [table, id, key] of [
    ['Article', articles[0], 'SavedItem_articleId_fkey'],
    ['Work', works[0], 'SavedItem_workId_fkey'],
    ['Video', videos[0], 'SavedItem_videoId_fkey'],
    ['Video', videos[1], 'WatchHistory_videoId_fkey'],
  ] as const)
    await refuse(
      `A ${table} a person still holds is never deleted`,
      `DELETE FROM [dbo].[${table}] WHERE [id]=N'${id}';`,
      [547],
      key,
    );
  await expectAccepted(
    session,
    'An Article read by a person',
    read(owner, { articleId: articles[1] }),
  );
  await refuse(
    'An Article a person has read is never deleted',
    `DELETE FROM [dbo].[Article] WHERE [id]=N'${articles[1]}';`,
    [547],
    'ReadingHistory_articleId_fkey',
  );
  if ((await personalRows()) !== before + 1)
    fail('A refused content deletion changed a Personalisation row.');

  // Personalisation releases its own references; the owners may then delete.
  await expectAccepted(
    session,
    'Personalisation releases its typed references',
    `DELETE FROM [dbo].[SavedItem] WHERE [articleId]=N'${articles[0]}' OR [workId]=N'${works[0]}' OR [videoId]=N'${videos[0]}';
     DELETE FROM [dbo].[WatchHistory] WHERE [videoId]=N'${videos[1]}';
     DELETE FROM [dbo].[ReadingHistory] WHERE [articleId]=N'${articles[1]}';`,
  );
  await expectAccepted(
    session,
    'Released content is deleted by its owner',
    `DELETE FROM [dbo].[Article] WHERE [id] IN (N'${articles[0]}', N'${articles[1]}');
     DELETE FROM [dbo].[Work] WHERE [id]=N'${works[0]}';
     DELETE FROM [dbo].[Video] WHERE [id] IN (N'${videos[0]}', N'${videos[1]}');`,
  );

  await expectAccepted(
    session,
    'An account holding one saved item',
    saved(randomUUID(), closing, { workId: works[1] }),
  );
  await refuse(
    'An account with saved items is never deleted under them',
    `DELETE FROM [dbo].[User] WHERE [id]=N'${closing}';`,
    [547],
    'SavedItem_userId_fkey',
  );

  // ---- inside the context: bookmarks, notes, collections, profiles ---------------
  const collection = randomUUID();
  const otherCollection = randomUUID();
  const loose = randomUUID();
  await expectAccepted(
    session,
    'A saved item in no collection',
    saved(loose, owner, { workId: works[1] }),
  );
  await expectAccepted(
    session,
    'A bookmark, a note and a private collection of two members',
    `INSERT INTO [dbo].[Bookmark] ([savedItemId],[createdAt]) VALUES (N'${savedIds.ayah}','${at}');
     INSERT INTO [dbo].[Note] ([savedItemId],[body],[version],[createdAt],[updatedAt]) VALUES (N'${savedIds.ayah}',N'NON_PERSONALISATION_FIXTURE_NOTE synthetic note',1,'${at}','${at}');
     INSERT INTO [dbo].[PrivateCollection] ([id],[userId],[title],[description],[version],[createdAt],[updatedAt]) VALUES
       (N'${collection}',N'${owner}',N'NON_PERSONALISATION_FIXTURE_COLLECTION',NULL,1,'${at}','${at}'),
       (N'${otherCollection}',N'${other}',N'NON_PERSONALISATION_FIXTURE_COLLECTION other',NULL,1,'${at}','${at}');
     INSERT INTO [dbo].[PrivateCollectionItem] ([collectionId],[savedItemId],[userId],[position],[addedAt]) VALUES
       (N'${collection}',N'${savedIds.ayah}',N'${owner}',0,'${at}'),
       (N'${collection}',N'${savedIds.hadith}',N'${owner}',1,'${at}');`,
  );
  const [otherSaved] = await session.query<{ id: string }>(
    `SELECT TOP 1 [id] FROM [dbo].[SavedItem] WHERE [userId]=N'${other}' ORDER BY [id];`,
  );
  if (otherSaved === undefined) fail('The second account holds no saved item.');
  await refuse(
    "A member joining one account's collection to another's saved item",
    `INSERT INTO [dbo].[PrivateCollectionItem] ([collectionId],[savedItemId],[userId],[position],[addedAt]) VALUES (N'${collection}',N'${otherSaved.id}',N'${owner}',2,'${at}');`,
    [547],
    'PrivateCollectionItem_savedItem_fkey',
  );
  await refuse(
    "A member joining another account's collection",
    `INSERT INTO [dbo].[PrivateCollectionItem] ([collectionId],[savedItemId],[userId],[position],[addedAt]) VALUES (N'${collection}',N'${otherSaved.id}',N'${other}',2,'${at}');`,
    [547],
    'PrivateCollectionItem_collection_fkey',
  );
  await refuse(
    'Two members at one place',
    `INSERT INTO [dbo].[PrivateCollectionItem] ([collectionId],[savedItemId],[userId],[position],[addedAt]) VALUES (N'${collection}',N'${loose}',N'${owner}',1,'${at}');`,
    [2627],
    'PrivateCollectionItem_position_key',
  );
  await refuse(
    'A member beyond the last place',
    `INSERT INTO [dbo].[PrivateCollectionItem] ([collectionId],[savedItemId],[userId],[position],[addedAt]) VALUES (N'${collection}',N'${loose}',N'${owner}',200,'${at}');`,
    [547],
    'PrivateCollectionItem_ck',
  );
  await refuse(
    'An empty note',
    `INSERT INTO [dbo].[Note] ([savedItemId],[body],[version],[createdAt],[updatedAt]) VALUES (N'${savedIds.hadith}',N'',1,'${at}','${at}');`,
    [547],
    'Note_ck',
  );
  await refuse(
    'A private collection with no title',
    `INSERT INTO [dbo].[PrivateCollection] ([id],[userId],[title],[version],[createdAt],[updatedAt]) VALUES (N'${randomUUID()}',N'${owner}',N'',1,'${at}','${at}');`,
    [547],
    'PrivateCollection_ck',
  );
  await refuse(
    'A saved item that is still a collection member is not deleted',
    `DELETE FROM [dbo].[SavedItem] WHERE [id]=N'${savedIds.ayah}';`,
    [547],
    'PrivateCollectionItem_savedItem_fkey',
  );
  await expectAccepted(
    session,
    'A private collection deleted with its members',
    `DELETE FROM [dbo].[PrivateCollection] WHERE [id]=N'${collection}';`,
  );
  await expectAccepted(
    session,
    'A saved item deleted with its bookmark and note',
    `DELETE FROM [dbo].[SavedItem] WHERE [id]=N'${savedIds.ayah}';`,
  );
  const [internal] = await session.query<Record<string, number>>(`
    SELECT
      (SELECT COUNT(*) FROM [dbo].[PrivateCollectionItem] WHERE [collectionId]=N'${collection}') AS [members],
      (SELECT COUNT(*) FROM [dbo].[SavedItem] WHERE [id]=N'${savedIds.hadith}') AS [memberKept],
      (SELECT COUNT(*) FROM [dbo].[Bookmark] WHERE [savedItemId]=N'${savedIds.ayah}') AS [bookmarks],
      (SELECT COUNT(*) FROM [dbo].[Note] WHERE [savedItemId]=N'${savedIds.ayah}') AS [notes],
      (SELECT COUNT(*) FROM [dbo].[PrivateCollection] WHERE [id]=N'${otherCollection}') AS [untouched];
  `);
  if (
    JSON.stringify(internal) !==
    '{"members":0,"memberKept":1,"bookmarks":0,"notes":0,"untouched":1}'
  )
    fail(
      `The internal cascades did not take exactly their own children: ${JSON.stringify(internal)}.`,
    );

  await expectAccepted(
    session,
    'A profile with explicit onboarding answers',
    `INSERT INTO [dbo].[PersonalisationProfile] ([userId],[onboarding],[historyEnabled],[version],[createdAt],[updatedAt]) VALUES (N'${owner}',N'completed',1,1,'${at}','${at}');
     INSERT INTO [dbo].[PersonalisationInterest] ([userId],[interest]) VALUES (N'${owner}',N'quran'),(N'${owner}',N'hadith');
     INSERT INTO [dbo].[PersonalisationGoal] ([userId],[goal]) VALUES (N'${owner}',N'study-hadith');`,
  );
  await refuse(
    'An onboarding answer outside its vocabulary',
    `INSERT INTO [dbo].[PersonalisationProfile] ([userId],[onboarding],[historyEnabled],[version],[createdAt],[updatedAt]) VALUES (N'${other}',N'inferred',1,1,'${at}','${at}');`,
    [547],
    'PersonalisationProfile_ck',
  );
  await refuse(
    'An interest outside its vocabulary',
    `INSERT INTO [dbo].[PersonalisationInterest] ([userId],[interest]) VALUES (N'${owner}',N'courses');`,
    [547],
    'PersonalisationInterest_ck',
  );
  await refuse(
    'A goal outside its vocabulary',
    `INSERT INTO [dbo].[PersonalisationGoal] ([userId],[goal]) VALUES (N'${owner}',N'finish-a-course');`,
    [547],
    'PersonalisationGoal_ck',
  );
  await refuse(
    'An interest with no profile',
    `INSERT INTO [dbo].[PersonalisationInterest] ([userId],[interest]) VALUES (N'${other}',N'quran');`,
    [547],
    'PersonalisationInterest_userId_fkey',
  );
  await expectAccepted(
    session,
    'A profile deleted with its interests and goals',
    `DELETE FROM [dbo].[PersonalisationProfile] WHERE [userId]=N'${owner}';`,
  );
  if (
    (await count(
      `SELECT (SELECT COUNT_BIG(*) FROM [dbo].[PersonalisationInterest] WHERE [userId]=N'${owner}') + (SELECT COUNT_BIG(*) FROM [dbo].[PersonalisationGoal] WHERE [userId]=N'${owner}') AS [total];`,
    )) !== 0
  )
    fail('Deleting a profile did not take its own interests and goals.');

  // ---- one Quran position --------------------------------------------------------
  await expectAccepted(
    session,
    'A Quran reading position',
    `INSERT INTO [dbo].[QuranReadingProgress] ([userId],[surahNumber],[ayahNumber],[version],[updatedAt]) VALUES (N'${owner}',${ayahColumns.surahNumber},${ayahColumns.ayahNumber},1,'${at}');`,
  );
  await refuse(
    'A Quran reading position at an Ayah that does not exist',
    `INSERT INTO [dbo].[QuranReadingProgress] ([userId],[surahNumber],[ayahNumber],[version],[updatedAt]) VALUES (N'${other}',9999,9999,1,'${at}');`,
    [547],
    'QuranReadingProgress_surahNumber_ayahNumber_fkey',
  );
  await refuse(
    'A second Quran reading position for one account',
    `INSERT INTO [dbo].[QuranReadingProgress] ([userId],[surahNumber],[ayahNumber],[version],[updatedAt]) VALUES (N'${owner}',${ayahColumns.surahNumber},${ayahColumns.ayahNumber},1,'${at}');`,
    [2627],
    'QuranReadingProgress_pkey',
  );

  // ---- notifications: an internal path or nothing ---------------------------------
  const notification = (
    destination: string | null,
    key: string,
    kind = 'question-answered',
  ): string =>
    `INSERT INTO [dbo].[Notification] ([id],[userId],[kind],[category],[destination],[idempotencyKey],[createdAt]) VALUES (N'${randomUUID()}',N'${owner}',N'${kind}',N'questions',${destination === null ? 'NULL' : `N'${destination}'`},N'${key}','${at}');`;
  await expectAccepted(
    session,
    'A notification with an internal destination',
    notification(`/en/my/questions/${randomUUID()}`, `fixture-${run}-1`),
  );
  await expectAccepted(
    session,
    'A notification with no destination',
    notification(null, `fixture-${run}-2`, 'question-declined'),
  );
  for (const [label, destination] of [
    ['an absolute URL', 'https://x'],
    ['a protocol-relative URL', '//x'],
    ['a backslash', '/\\x'],
    // Assembled, so the script-URL rule does not read this refused value as
    // a link this code would follow.
    ['a script scheme', ['javascript', 'x'].join(':')],
    ['a dot segment', '/a/../b'],
    ['percent-encoding', '/a%2f'],
  ] as const)
    await refuse(
      `A notification destination with ${label}`,
      notification(destination, `fixture-${run}-${label}`),
      [547],
      'Notification_ck',
    );
  await refuse(
    'A notification kind outside its vocabulary',
    notification(null, `fixture-${run}-kind`, 'marketing'),
    [547],
    'Notification_ck',
  );
  await refuse(
    'One idempotency key used twice for one account',
    notification(null, `fixture-${run}-1`),
    [2627],
    'Notification_idempotency_key',
  );
  await refuse(
    'A notification read before it was created',
    `INSERT INTO [dbo].[Notification] ([id],[userId],[kind],[category],[destination],[idempotencyKey],[createdAt],[readAt]) VALUES (N'${randomUUID()}',N'${owner}',N'question-answered',N'questions',NULL,N'fixture-${run}-early','${later}','${at}');`,
    [547],
    'Notification_ck',
  );
  await refuse(
    'A notification preference on a channel that does not exist',
    `INSERT INTO [dbo].[NotificationPreference] ([userId],[category],[channel],[enabled],[updatedAt]) VALUES (N'${owner}',N'questions',N'email',1,'${at}');`,
    [547],
    'NotificationPreference_ck',
  );

  // ---- the newsletter: consent from an address, never an account -------------------
  const subscriber = randomUUID();
  const pending = (
    id: string,
    digest: string,
    confirm: string,
    unsubscribe: string,
  ): string =>
    `INSERT INTO [dbo].[NewsletterSubscriber] ([id],[emailDigest],[digestKeyVersion],[email],[state],[locale],[generation],[confirmTokenHash],[confirmSalt],[confirmExpiresAt],[unsubscribeTokenHash],[unsubscribeSalt],[tokenKeyVersion],[submittedAt],[version],[updatedAt]) VALUES (N'${id}',N'${digest}',1,N'subscriber-${run}@personalisation-proof.invalid',N'pending',N'en',1,N'${confirm}',N'${hash('confirm-salt')}','${later}',N'${unsubscribe}',N'${hash('unsubscribe-salt')}',1,'${at}',1,'${at}');`;
  const ended = (state: string, digest: string): string =>
    `INSERT INTO [dbo].[NewsletterSubscriber] ([id],[emailDigest],[digestKeyVersion],[email],[state],[locale],[generation],[submittedAt],[endedAt],[version],[updatedAt]) VALUES (N'${randomUUID()}',N'${digest}',1,NULL,N'${state}',N'en',1,'${at}','${later}',1,'${later}');`;
  await expectAccepted(
    session,
    'A pending subscription holding only its link hashes',
    pending(subscriber, hash('digest'), hash('confirm'), hash('unsubscribe')),
  );
  await expectAccepted(
    session,
    'Two ended subscriptions holding no link',
    `${ended('expired', hash('digest-expired'))}
     ${ended('suppressed', hash('digest-suppressed'))}`,
  );
  await refuse(
    'A second subscription for one address',
    pending(randomUUID(), hash('digest'), hash('confirm-2'), hash('unsubscribe-2')),
    [2627],
    'NewsletterSubscriber_emailDigest_key',
  );
  await refuse(
    'One confirmation link for two subscriptions',
    pending(randomUUID(), hash('digest-3'), hash('confirm'), hash('unsubscribe-3')),
    [2601],
    'NewsletterSubscriber_confirm_key',
  );
  await refuse(
    'One unsubscribe link for two subscriptions',
    pending(randomUUID(), hash('digest-4'), hash('confirm-4'), hash('unsubscribe')),
    [2601],
    'NewsletterSubscriber_unsubscribe_key',
  );
  await refuse(
    'A pending subscription without its link hashes',
    `INSERT INTO [dbo].[NewsletterSubscriber] ([id],[emailDigest],[digestKeyVersion],[email],[state],[locale],[generation],[submittedAt],[version],[updatedAt]) VALUES (N'${randomUUID()}',N'${hash('digest-5')}',1,N'pending-${run}@personalisation-proof.invalid',N'pending',N'en',1,'${at}',1,'${at}');`,
    [547],
    'NewsletterSubscriber_facts_ck',
  );
  await refuse(
    'An unsubscribed subscription that keeps its address',
    `INSERT INTO [dbo].[NewsletterSubscriber] ([id],[emailDigest],[digestKeyVersion],[email],[state],[locale],[generation],[submittedAt],[endedAt],[version],[updatedAt]) VALUES (N'${randomUUID()}',N'${hash('digest-6')}',1,N'kept-${run}@personalisation-proof.invalid',N'unsubscribed',N'en',1,'${at}','${later}',1,'${later}');`,
    [547],
    'NewsletterSubscriber_facts_ck',
  );
  await refuse(
    'A confirmed subscription that keeps a live confirmation link',
    `UPDATE [dbo].[NewsletterSubscriber] SET [state]=N'confirmed',[confirmedAt]='${later}',[version]=[version]+1 WHERE [id]=N'${subscriber}';`,
    [547],
    'NewsletterSubscriber_facts_ck',
  );
  await refuse(
    'A subscription in a locale the site does not serve',
    pending(
      randomUUID(),
      hash('digest-7'),
      hash('confirm-7'),
      hash('unsubscribe-7'),
    ).replace(`N'pending',N'en'`, `N'pending',N'fr'`),
    [547],
    'NewsletterSubscriber_ck',
  );

  const consent = randomUUID();
  await expectAccepted(
    session,
    'Consent evidence appended',
    `INSERT INTO [dbo].[NewsletterConsentEvent] ([id],[subscriberId],[event],[purpose],[noticeVersion],[source],[locale],[occurredAt]) VALUES (N'${consent}',N'${subscriber}',N'submitted',N'newsletter',N'NON_PERSONALISATION_FIXTURE_NOTICE',N'newsletter-page',N'en','${at}');`,
  );
  const evidence = async (): Promise<string> =>
    JSON.stringify(
      await session.query(
        `SELECT * FROM [dbo].[NewsletterConsentEvent] WHERE [subscriberId]=N'${subscriber}' ORDER BY [id];`,
      ),
    );
  const evidenceBefore = await evidence();
  await refuse(
    'A consent event outside its vocabulary',
    `INSERT INTO [dbo].[NewsletterConsentEvent] ([id],[subscriberId],[event],[purpose],[noticeVersion],[source],[locale],[occurredAt]) VALUES (N'${randomUUID()}',N'${subscriber}',N'imported',N'newsletter',N'NON_PERSONALISATION_FIXTURE_NOTICE',N'newsletter-page',N'en','${at}');`,
    [547],
    'NewsletterConsentEvent_ck',
  );
  await refuse(
    'Consent evidence rewritten, even by a privileged session',
    `UPDATE [dbo].[NewsletterConsentEvent] SET [event]=N'confirmed' WHERE [id]=N'${consent}';`,
    [51260],
    'Newsletter consent evidence is immutable',
  );
  await refuse(
    'Consent evidence erased, even by a privileged session',
    `DELETE FROM [dbo].[NewsletterConsentEvent] WHERE [id]=N'${consent}';`,
    [51260],
    'Newsletter consent evidence is immutable',
  );
  await refuse(
    'A subscriber with consent evidence is never deleted',
    `DELETE FROM [dbo].[NewsletterSubscriber] WHERE [id]=N'${subscriber}';`,
    [547],
    'NewsletterConsentEvent_subscriberId_fkey',
  );
  if ((await evidence()) !== evidenceBefore)
    fail('A refused change altered consent evidence.');
  await expectAccepted(
    session,
    'An unsubscribe ends the subscription and forgets the address',
    `UPDATE [dbo].[NewsletterSubscriber] SET [state]=N'unsubscribed',[email]=NULL,[confirmTokenHash]=NULL,[confirmSalt]=NULL,[confirmExpiresAt]=NULL,[unsubscribeSalt]=NULL,[endedAt]='${later}',[version]=[version]+1,[updatedAt]='${later}' WHERE [id]=N'${subscriber}';`,
  );

  report(
    'personalisation rules',
    `one typed target per row, per-account keys, no cascade from content or an account, ` +
      `owner-bound collections, internal paths only, newsletter facts and immutable consent; ` +
      `${String(refusals)} refusals by name, every text a NON_PERSONALISATION_FIXTURE sentinel`,
  );
}

const LEARNING_MIGRATION = '20261006000000_phase22_learning';
const CLASSES_MIGRATION = '20261007000000_phase23_teacher_live_classes';

/** The two keys Phase 22 appends and bundles, and only these. */
const LEARNING_PERMISSIONS = ['learning.administer', 'learning.read'];

/** The two ordinary keys Phase 23 appends and bundles, and only these. */
const CLASSES_PERMISSIONS = ['learning.classes.administer', 'learning.classes.read'];

/**
 * The teaching authority Phase 23 catalogues: EXTERNALLY GATED, bundled into
 * no role and held by nobody until the organisation names a teacher
 * (OPEN_DECISIONS.md §6.3).
 */
const TEACHING_PERMISSION = 'teaching.perform';

/**
 * Keys Learning must NOT catalogue: the catalogue is administered by ONE key
 * rather than an editorial workflow of authors, reviewers and publishers it
 * does not have. (`teaching.perform` left this list when Phase 23 delivered
 * it; `assertLearningFoundation` now requires it absent only until then.)
 */
const LEARNING_ABSENT_PERMISSIONS = [
  'learning.author',
  'learning.publish',
  'learning.review',
];

/**
 * EVERY foreign key from a Phase-22 table, exactly, with its column mapping and
 * its delete action. ALL are NO ACTION: nothing cascades, inside the context or
 * out of it. The external edges are Taxonomy's Language and Topic, People's
 * Person and Identity's User — no Video, Work, Asset or Centre — and a lesson's
 * key to its module, and a progress row's keys to its enrolment and its lesson,
 * each carry the Course.
 */
const LEARNING_KEYS = [
  'CourseLabel_courseId_fkey(courseId>id)>Course:NO_ACTION',
  'CourseModuleLabel_moduleId_fkey(moduleId>id)>CourseModule:NO_ACTION',
  'CourseModule_courseId_fkey(courseId>id)>Course:NO_ACTION',
  'CourseSlugHistory_courseId_fkey(courseId>id)>Course:NO_ACTION',
  'CourseTeacher_courseId_fkey(courseId>id)>Course:NO_ACTION',
  'CourseTeacher_personId_fkey(personId>id)>Person:NO_ACTION',
  'CourseTopic_courseId_fkey(courseId>id)>Course:NO_ACTION',
  'CourseTopic_topicId_fkey(topicId>id)>Topic:NO_ACTION',
  'Course_languageCode_fkey(languageCode>code)>Language:NO_ACTION',
  'Enrolment_courseId_fkey(courseId>id)>Course:NO_ACTION',
  'Enrolment_userId_fkey(userId>id)>User:NO_ACTION',
  'LearningPathCourse_courseId_fkey(courseId>id)>Course:NO_ACTION',
  'LearningPathCourse_pathId_fkey(pathId>id)>LearningPath:NO_ACTION',
  'LearningPathLabel_pathId_fkey(pathId>id)>LearningPath:NO_ACTION',
  'LearningPathSlugHistory_pathId_fkey(pathId>id)>LearningPath:NO_ACTION',
  'LessonLabel_lessonId_fkey(lessonId>id)>Lesson:NO_ACTION',
  'LessonProgress_enrolment_fkey(userId>userId,courseId>courseId)>Enrolment:NO_ACTION',
  'LessonProgress_lesson_fkey(lessonId>id,courseId>courseId)>Lesson:NO_ACTION',
  'Lesson_module_fkey(moduleId>id,courseId>courseId)>CourseModule:NO_ACTION',
  'TrialClassRequest_courseId_fkey(courseId>id)>Course:NO_ACTION',
  'TrialClassRequest_userId_fkey(userId>id)>User:NO_ACTION',
].sort();

/**
 * Every unique index on a Phase-22 table, exactly, and none filtered: a slug
 * once per catalogue and once per history, one label per locale, a Course's
 * topic and teacher once each, a place held once per Course, module or path,
 * the two owner keys a lesson and a progress row reach through, one enrolment
 * per person and Course, one progress row per person and lesson, and one trial
 * request per person and Course.
 */
const LEARNING_UNIQUE = [
  'CourseLabel_pkey(courseId,locale)',
  'CourseModuleLabel_pkey(moduleId,locale)',
  'CourseModule_courseId_position_key(courseId,position)',
  'CourseModule_owner_key(id,courseId)',
  'CourseModule_pkey(id)',
  'CourseSlugHistory_pkey(slug)',
  'CourseTeacher_courseId_position_key(courseId,position)',
  'CourseTeacher_pkey(courseId,personId)',
  'CourseTopic_pkey(courseId,topicId)',
  'Course_pkey(id)',
  'Course_slug_key(slug)',
  'Enrolment_pkey(userId,courseId)',
  'LearningPathCourse_pathId_position_key(pathId,position)',
  'LearningPathCourse_pkey(pathId,courseId)',
  'LearningPathLabel_pkey(pathId,locale)',
  'LearningPathSlugHistory_pkey(slug)',
  'LearningPath_pkey(id)',
  'LearningPath_slug_key(slug)',
  'LessonLabel_pkey(lessonId,locale)',
  'LessonProgress_pkey(userId,lessonId)',
  'Lesson_moduleId_position_key(moduleId,position)',
  'Lesson_owner_key(id,courseId)',
  'Lesson_pkey(id)',
  'TrialClassRequest_pkey(id)',
  'TrialClassRequest_userId_courseId_key(userId,courseId)',
].sort();

/**
 * Every column of every Phase-22 table, in order. Stated whole so a
 * `targetType`/`targetId` pair, a copied topic, language or teacher name, a
 * meeting provider or address, a session, slot or booking column, a Video or
 * Centre reference or a stored course-level percentage cannot arrive
 * unnoticed.
 */
const LEARNING_COLUMNS: Readonly<Record<string, string>> = {
  Course:
    'id,slug,primaryLocale,state,level,format,languageCode,publishedAt,version,updatedAt',
  CourseLabel: 'courseId,locale,title,summary,description',
  CourseSlugHistory: 'slug,courseId',
  CourseTopic: 'courseId,topicId',
  CourseTeacher: 'courseId,personId,position',
  CourseModule: 'id,courseId,position',
  CourseModuleLabel: 'moduleId,locale,title,summary',
  Lesson: 'id,courseId,moduleId,position',
  LessonLabel: 'lessonId,locale,title,summary,body',
  LearningPath: 'id,slug,primaryLocale,state,publishedAt,version,updatedAt',
  LearningPathLabel: 'pathId,locale,title,summary,description',
  LearningPathSlugHistory: 'slug,pathId',
  LearningPathCourse: 'pathId,courseId,position',
  Enrolment: 'userId,courseId,enrolledAt',
  LessonProgress: 'userId,courseId,lessonId,completedAt',
  TrialClassRequest: 'id,userId,courseId,requestedAt',
};

/**
 * Whether Phase 22 is applied, ALL OR NOTHING: either every one of its sixteen
 * tables exists or none does. Half a schema fails here rather than letting an
 * earlier owner's check admit or refuse its references by accident.
 */
async function learningPresent(session: SqlSession): Promise<boolean> {
  const names = LEARNING_TABLES.map((table) => `N'${table}'`).join(',');
  const [row] = await session.query<{ present: number }>(
    `SELECT COUNT(*) AS [present] FROM sys.tables WHERE [name] IN (${names});`,
  );
  const present = Number(row?.present ?? -1);
  if (present !== 0 && present !== LEARNING_TABLES.length)
    fail(
      `Phase 22 is half applied: ${String(present)} of ${String(LEARNING_TABLES.length)} ` +
        `Learning tables exist.`,
    );
  return present === LEARNING_TABLES.length;
}

/**
 * Phase 22 — what only the catalogue can prove about Learning:
 *
 *   1. NOTHING IS SEEDED: all sixteen tables are empty after deploy — no
 *      Course, path, enrolment, progress or trial request of anybody;
 *   2. every column of every table is exactly as stated — no type, target or
 *      kind column, no meeting provider or address, no session, slot, booking,
 *      attendance or availability column, no Video, Centre or Asset column and
 *      no stored count or percentage — and the unique indexes are exactly the
 *      twenty-five above, none filtered;
 *   3. every foreign key is exactly one of the twenty-one above, ALL NO ACTION
 *      and trusted: Language, Topic, Person and User the only external edges,
 *      a lesson's module and a progress row's enrolment and lesson each reached
 *      through the Course; no other owner references a Learning table or holds
 *      a course, lesson, enrolment or path column;
 *   4. the CHECKs are exactly the fourteen named rules, all trusted; the
 *      triggers are exactly the twelve in `LEARNING_TRIGGER_NUMBERS`, enabled,
 *      each raising exactly its own numbers from 51270–51277 on the table it
 *      guards; and Learning has no procedure;
 *   5. the vocabulary is exactly `learning.administer` and `learning.read`,
 *      described as the compiled catalogue describes them, each bundled exactly
 *      once into the protected role and held by no other, with exactly one
 *      `learning.permissions.provisioned` record naming this migration; no
 *      `learning.author`, `learning.publish` or `learning.review` exists; and
 *      `teaching.perform` and the two class keys exist exactly when Phase 23 is
 *      applied — the class keys bundled once, the teaching key held by nobody —
 *      and not at all once it is rolled back (`before-classes`).
 *
 * At `before-classes` the Phase-23 tables are gone too, so nothing may
 * reference a Learning table; while they are present, the only inbound keys
 * and the only foreign Course columns are theirs — and, while Phase 24 is
 * applied (not at `before-messaging`), Messaging's: a direct conversation
 * names its Course by a typed key. At `before-membership` everything of Phase
 * 24 and earlier is present and only the protected bundle has lost the two
 * Membership keys.
 *
 * The rules themselves are proved as BEHAVIOUR by `assertLearningRules`, and
 * through the runtime login by `db:test:permissions`.
 */
async function assertLearningFoundation(
  session: SqlSession,
  stage:
    | 'deploy'
    | 're-deploy'
    | 'before-migration'
    | 'before-donations'
    | 'before-membership'
    | 'before-messaging'
    | 'before-classes' = 'deploy',
): Promise<void> {
  const tables = LEARNING_TABLES.map((table) => `OBJECT_ID(N'[dbo].[${table}]')`).join(
    ',',
  );
  const names = LEARNING_TABLES.map((table) => `N'${table}'`).join(',');
  const withClasses = stage !== 'before-classes';
  const withMessaging =
    stage === 'deploy' ||
    stage === 're-deploy' ||
    stage === 'before-migration' ||
    stage === 'before-donations' ||
    stage === 'before-membership';
  const referencing = [
    ...(withClasses ? CLASSES_TABLES : []),
    ...(withMessaging ? MESSAGING_TABLES : []),
  ];
  const classTables = referencing
    .map((table) => `,OBJECT_ID(N'[dbo].[${table}]')`)
    .join('');
  const classNames = referencing.map((table) => `,N'${table}'`).join('');
  if (!(await learningPresent(session)))
    fail(`The Phase-22 Learning tables are missing after ${stage}.`);

  // ---- 1. nothing seeded -------------------------------------------------------
  const counts = await session.query<{ name: string; total: number }>(
    LEARNING_TABLES.map(
      (table) =>
        `SELECT N'${table}' AS [name], COUNT_BIG(*) AS [total] FROM [dbo].[${table}]`,
    ).join(' UNION ALL ') + ';',
  );
  const seeded = counts.filter((row) => Number(row.total) !== 0);
  if (LEARNING_TABLES.length !== 16 || counts.length !== 16 || seeded.length > 0)
    fail(
      `The Learning migration must create sixteen empty tables and seed nothing; found ` +
        `${String(counts.length)} tables after ${stage}, seeded: ${JSON.stringify(seeded)}.`,
    );

  // ---- 2. exact columns, exact unfiltered unique indexes --------------------------
  const shapes = await session.query<{ name: string; columns: string }>(`
    SELECT OBJECT_NAME(c.[object_id]) AS [name],
      STRING_AGG(c.[name], N',') WITHIN GROUP (ORDER BY c.[column_id]) AS [columns]
    FROM sys.columns c WHERE c.[object_id] IN (${tables})
    GROUP BY c.[object_id];
  `);
  const shapeFindings = LEARNING_TABLES.filter(
    (table) =>
      shapes.find((row) => row.name === table)?.columns !== LEARNING_COLUMNS[table],
  );
  if (shapes.length !== 16 || shapeFindings.length > 0)
    fail(
      `Learning columns differ from the reviewed shape in ${shapeFindings.join(', ')}: ` +
        `${JSON.stringify(shapes.filter((row) => shapeFindings.includes(row.name)))}.`,
    );

  const generic = await session.query<{ name: string }>(`
    SELECT OBJECT_NAME(c.[object_id]) + N'.' + c.[name] AS [name] FROM sys.columns c
    WHERE c.[object_id] IN (${tables})
      AND (c.[name] LIKE N'%type%' OR c.[name] LIKE N'%target%' OR c.[name] LIKE N'%entity%'
           OR c.[name] LIKE N'%kind%' OR c.[name] LIKE N'%meeting%' OR c.[name] LIKE N'%url%'
           OR c.[name] LIKE N'%provider%' OR c.[name] LIKE N'%booking%' OR c.[name] LIKE N'%session%'
           OR c.[name] LIKE N'%slot%' OR c.[name] LIKE N'%schedul%' OR c.[name] LIKE N'%availab%'
           OR c.[name] LIKE N'%attend%' OR c.[name] LIKE N'%class%' OR c.[name] LIKE N'%video%'
           OR c.[name] LIKE N'%centre%' OR c.[name] LIKE N'%center%' OR c.[name] LIKE N'%asset%'
           OR c.[name] LIKE N'%teacherId%' OR c.[name] LIKE N'%count%' OR c.[name] LIKE N'%percent%'
           OR c.[name] LIKE N'%status%');
  `);
  if (generic.length > 0)
    fail(
      `Learning may carry no type, target, meeting, scheduling, Video, Centre or stored-count ` +
        `column; found ${JSON.stringify(generic)}.`,
    );

  const unique = await session.query<{
    name: string;
    columns: string;
    filter: string | null;
  }>(`
    SELECT i.[name], i.[filter_definition] AS [filter],
      STRING_AGG(COL_NAME(ic.[object_id], ic.[column_id]), N',')
        WITHIN GROUP (ORDER BY ic.[key_ordinal]) AS [columns]
    FROM sys.indexes i
    JOIN sys.index_columns ic ON ic.[object_id] = i.[object_id] AND ic.[index_id] = i.[index_id]
    WHERE i.[is_unique] = 1 AND ic.[key_ordinal] > 0 AND i.[object_id] IN (${tables})
    GROUP BY i.[object_id], i.[name], i.[filter_definition];
  `);
  const describedUnique = unique
    .map(
      (row) =>
        `${row.name}(${row.columns})` +
        (row.filter === null ? '' : ` WHERE ${row.filter}`),
    )
    .sort();
  if (describedUnique.join(' | ') !== LEARNING_UNIQUE.join(' | '))
    fail(
      `Learning's unique indexes must be exactly the reviewed twenty-five, none filtered; ` +
        `found ${describedUnique.join(' | ')}.`,
    );

  // ---- 3. exact keys, all NO ACTION and trusted; nothing foreign holds Learning ----
  const keys = await session.query<{
    name: string;
    columns: string;
    target: string;
    deletes: string;
    updates: string;
    trusted: number;
  }>(`
    SELECT fk.[name], OBJECT_NAME(fk.[referenced_object_id]) AS [target],
      fk.[delete_referential_action_desc] AS [deletes], fk.[update_referential_action_desc] AS [updates],
      CASE WHEN fk.[is_disabled] = 0 AND fk.[is_not_trusted] = 0 THEN 1 ELSE 0 END AS [trusted],
      STRING_AGG(COL_NAME(c.[parent_object_id], c.[parent_column_id]) + N'>'
        + COL_NAME(c.[referenced_object_id], c.[referenced_column_id]), N',')
        WITHIN GROUP (ORDER BY c.[constraint_column_id]) AS [columns]
    FROM sys.foreign_keys fk
    JOIN sys.foreign_key_columns c ON c.[constraint_object_id] = fk.[object_id]
    WHERE fk.[parent_object_id] IN (${tables})
    GROUP BY fk.[name], fk.[referenced_object_id], fk.[delete_referential_action_desc],
      fk.[update_referential_action_desc], fk.[is_disabled], fk.[is_not_trusted];
  `);
  const describedKeys = keys
    .map((row) => `${row.name}(${row.columns})>${row.target}:${row.deletes}`)
    .sort();
  if (
    describedKeys.join(',') !== LEARNING_KEYS.join(',') ||
    keys.some((row) => row.updates !== 'NO_ACTION' || Number(row.trusted) !== 1)
  )
    fail(
      `Learning's keys must be exactly the reviewed twenty-one, none cascading and all ` +
        `trusted; found ${describedKeys.join(', ')}.`,
    );

  const [isolation] = await session.query<{
    inbound: number;
    foreign: string | null;
  }>(`
    SELECT
      (SELECT COUNT(*) FROM sys.foreign_keys
        WHERE [referenced_object_id] IN (${tables})
          AND [parent_object_id] NOT IN (${tables}${classTables})) AS [inbound],
      (SELECT STRING_AGG(OBJECT_NAME(c.[object_id]) + N'.' + c.[name], N',') FROM sys.columns c
        WHERE (c.[name] LIKE N'%course%' OR c.[name] LIKE N'%lesson%' OR c.[name] LIKE N'%enrol%'
               OR c.[name] LIKE N'%learningpath%' OR c.[name] LIKE N'%trialclass%')
          AND OBJECT_NAME(c.[object_id]) NOT IN (${names}${classNames})
          -- Identity's second-factor re-enrolment instant names a TOTP
          -- enrolment, never a Course's.
          AND NOT (OBJECT_NAME(c.[object_id]) = N'PrivilegedSecurityPosture'
                   AND c.[name] = N'reenrolmentRequiredAt')
          AND OBJECTPROPERTY(c.[object_id], 'IsUserTable') = 1) AS [foreign];
  `);
  if (Number(isolation?.inbound) !== 0 || (isolation?.foreign ?? null) !== null)
    fail(
      `No other owner may reference or hold Learning schema; found ` +
        `${JSON.stringify(isolation ?? null)}.`,
    );

  // ---- 4. fourteen trusted CHECKs, twelve triggers by number, no procedure --------
  const checks = await session.query<{ name: string; trusted: number }>(`
    SELECT [name], CASE WHEN [is_disabled] = 0 AND [is_not_trusted] = 0 THEN 1 ELSE 0 END AS [trusted]
    FROM sys.check_constraints WHERE [parent_object_id] IN (${tables});
  `);
  const expectedChecks = EXPECTED_CHECK_CONSTRAINTS.filter((entry) =>
    LEARNING_TABLES.includes(entry.table),
  )
    .map((entry) => entry.constraint)
    .sort();
  if (
    expectedChecks.length !== 14 ||
    checks
      .map((row) => row.name)
      .sort()
      .join(',') !== expectedChecks.join(',') ||
    checks.some((row) => Number(row.trusted) !== 1)
  )
    fail(
      `Learning must carry exactly its fourteen trusted CHECKs; found ${JSON.stringify(checks)}.`,
    );

  const triggers = await session.query<{
    name: string;
    tableName: string;
    disabled: number;
    definition: string | null;
  }>(`
    SELECT t.[name], OBJECT_NAME(t.[parent_id]) AS [tableName], CAST(t.[is_disabled] AS INT) AS [disabled],
      OBJECT_DEFINITION(t.[object_id]) AS [definition]
    FROM sys.triggers t WHERE t.[parent_id] IN (${tables});
  `);
  const describedTriggers = triggers
    .map((row) => `${row.name}@${row.tableName}:${raisedNumbers(row.definition)}`)
    .sort()
    .join(',');
  const expectedTriggers = Object.entries(LEARNING_TRIGGER_NUMBERS)
    .map(([name, [table, numbers]]) => `${name}@${table}:${numbers}`)
    .sort()
    .join(',');
  if (
    describedTriggers !== expectedTriggers ||
    triggers.length !== 12 ||
    triggers.some((row) => Number(row.disabled) !== 0)
  )
    fail(
      `Learning triggers must be exactly twelve, enabled, raising exactly their own ` +
        `51270–51277 numbers; found ${describedTriggers}.`,
    );

  const [procedures] = await session.query<{ total: number }>(`
    SELECT COUNT(*) AS [total] FROM sys.procedures
    WHERE [name] LIKE N'Learning%' OR [name] LIKE N'Course%' OR [name] LIKE N'Lesson%'
       OR [name] LIKE N'Enrol%' OR [name] LIKE N'Trial%';
  `);
  if (Number(procedures?.total) !== 0)
    fail('Phase 22 writes through its owner adapters; it must create no procedure.');

  // ---- 5. two keys, both bundled once, provisioned once; Phase 23's by stage ------
  const permissions = await session.query<{
    key: string;
    description: string;
    bundled: number;
    held: number;
  }>(`
    SELECT p.[key], p.[description],
      (SELECT COUNT(*) FROM [dbo].[RolePermission] rp JOIN [dbo].[Role] r ON r.[id] = rp.[roleId]
        WHERE r.[key] = N'platform-administrator' AND rp.[permissionKey] = p.[key]) AS [bundled],
      (SELECT COUNT(*) FROM [dbo].[RolePermission] rp WHERE rp.[permissionKey] = p.[key]) AS [held]
    FROM [dbo].[Permission] p
    WHERE p.[key] LIKE N'learning%' OR p.[key] LIKE N'course%' OR p.[key] LIKE N'lesson%'
       OR p.[key] LIKE N'teaching%' OR p.[key] LIKE N'enrol%' OR p.[key] LIKE N'trial%'
       OR p.[key] LIKE N'class%'
    ORDER BY p.[key];
  `);
  const described = new Map(
    PERMISSION_CATALOGUE.map((entry) => [entry.key as string, entry.description]),
  );
  const compiled = new Set<string>(PLATFORM_ADMINISTRATOR_PERMISSIONS);
  // Once Phase 23 is applied the same query also returns its two bundled class
  // keys and the gated teaching key; once it is rolled back, exactly Phase 22's.
  const expectedKeys = withClasses
    ? [...LEARNING_PERMISSIONS, ...CLASSES_PERMISSIONS, TEACHING_PERMISSION].sort()
    : LEARNING_PERMISSIONS;
  const bundledOnce = withClasses
    ? [...LEARNING_PERMISSIONS, ...CLASSES_PERMISSIONS]
    : LEARNING_PERMISSIONS;
  if (
    permissions.map((row) => row.key).join(',') !== expectedKeys.join(',') ||
    !bundledOnce.every((key) => compiled.has(key)) ||
    compiled.has(TEACHING_PERMISSION) ||
    permissions.some(
      (row) =>
        row.description !== described.get(row.key) ||
        Number(row.bundled) !== (row.key === TEACHING_PERMISSION ? 0 : 1) ||
        Number(row.held) !== (row.key === TEACHING_PERMISSION ? 0 : 1),
    )
  )
    fail(
      `The Learning vocabulary must be exactly ${expectedKeys.join(', ')} at ${stage}, ` +
        `described as the compiled catalogue describes them, each ordinary key bundled once ` +
        `into the protected role and held by no other, and ${TEACHING_PERMISSION} held by ` +
        `nobody; found ${JSON.stringify(permissions)}.`,
    );

  const absentKeys = withClasses
    ? LEARNING_ABSENT_PERMISSIONS
    : [...LEARNING_ABSENT_PERMISSIONS, TEACHING_PERMISSION, ...CLASSES_PERMISSIONS];
  const absent = await session.query<{ key: string }>(`
    SELECT [key] FROM [dbo].[Permission]
    WHERE [key] IN (${absentKeys.map((key) => `N'${key}'`).join(',')});
  `);
  if (
    absent.length > 0 ||
    LEARNING_ABSENT_PERMISSIONS.some((key) => described.has(key) || compiled.has(key))
  )
    fail(
      `Phase 22 catalogues no editorial-workflow key, and no Phase-23 key exists at ${stage}; ` +
        `found ${absent.map((row) => row.key).join(', ') || 'one in the compiled catalogue'}.`,
    );

  const provisioning = await session.query<{
    actorType: string;
    actorId: string | null;
    targetType: string;
    roleKey: string | null;
    afterState: string | null;
    authorisingSource: string | null;
  }>(`
    SELECT a.[actorType], a.[actorId], a.[targetType], r.[key] AS [roleKey], a.[afterState], a.[authorisingSource]
    FROM [dbo].[AuditLog] a LEFT JOIN [dbo].[Role] r ON r.[id] = a.[targetId]
    WHERE a.[action] = N'learning.permissions.provisioned';
  `);
  if (
    JSON.stringify(provisioning) !==
    JSON.stringify([
      {
        actorType: 'migration',
        actorId: null,
        targetType: 'role',
        roleKey: 'platform-administrator',
        afterState: '{"added":"learning.administer learning.read"}',
        authorisingSource: LEARNING_MIGRATION,
      },
    ])
  )
    fail(
      `Extending the protected bundle must leave exactly one provisioning record naming the ` +
        `added keys and this migration; found ${JSON.stringify(provisioning)}.`,
    );

  // Once Phase 26 is rolled back the database's bundle lacks the two Membership
  // keys the compiled bundle now carries, and once Phase 23 is too it lacks the
  // two class keys as well.
  const bundled = await assertProtectedBundleExcludesGated(session);
  const compiledBundle = compiledBundleAt(
    stage === 'deploy' || stage === 're-deploy' ? 'current' : stage,
  ).length;
  if (bundled !== compiledBundle)
    fail(
      `The protected bundle holds ${String(bundled)} keys; the compiled bundle holds ` +
        `${String(compiledBundle)} at ${stage}.`,
    );

  report(
    'learning schema',
    'sixteen empty tables of the reviewed shape, twenty-five unfiltered unique keys, ' +
      'twenty-one trusted NO ACTION keys, 14 CHECKs, twelve triggers raising 51270–51277, ' +
      `no procedure, two bundled Learning keys provisioned once, ` +
      `${withClasses ? 'Phase-23 keys present as reviewed' : 'no Phase-23 key'}, ` +
      `${String(bundled)} bundled`,
  );
}

/**
 * After the Phase-22 rollback: no Learning table, trigger, key, CHECK or index,
 * no Learning permission, bundle entry or provisioning record, no `course` or
 * `learning-path` search row — and the protected bundle is the catalogue less
 * the gated keys and exactly the compiled bundle less the two Learning keys.
 * The caller then proves the owners Learning referenced are intact.
 */
async function assertLearningRemoved(session: SqlSession): Promise<void> {
  const names = LEARNING_TABLES.map((table) => `N'${table}'`).join(',');
  const triggerNames = Object.keys(LEARNING_TRIGGER_NUMBERS)
    .map((name) => `N'${name}'`)
    .join(',');
  const [row] = await session.query<Record<string, number>>(`
    SELECT
      (SELECT COUNT(*) FROM sys.tables WHERE [name] IN (${names})) AS [tables],
      (SELECT COUNT(*) FROM sys.triggers WHERE [name] IN (${triggerNames}) OR [name] LIKE N'Learning%') AS [triggers],
      (SELECT COUNT(*) FROM sys.foreign_keys
        WHERE LEFT([name], CHARINDEX(N'_', [name] + N'_') - 1) IN (${names})) AS [keys],
      (SELECT COUNT(*) FROM sys.check_constraints
        WHERE LEFT([name], CHARINDEX(N'_', [name] + N'_') - 1) IN (${names})) AS [checks],
      (SELECT COUNT(*) FROM sys.indexes
        WHERE LEFT([name], CHARINDEX(N'_', [name] + N'_') - 1) IN (${names})) AS [indexes],
      (SELECT COUNT(*) FROM [dbo].[Permission] WHERE [key] LIKE N'learning.%') AS [permissions],
      (SELECT COUNT(*) FROM [dbo].[RolePermission] WHERE [permissionKey] LIKE N'learning.%') AS [bundled],
      (SELECT COUNT(*) FROM [dbo].[AuditLog] WHERE [action] = N'learning.permissions.provisioned') AS [audit],
      (SELECT COUNT(*) FROM [dbo].[SearchDocument] WHERE [kind] IN (N'course', N'learning-path'))
        + (SELECT COUNT(*) FROM [dbo].[SearchIndexScope] WHERE [scopeKind] IN (N'course', N'learning-path'))
        + (SELECT COUNT(*) FROM [dbo].[SearchIndexRequest] WHERE [scopeKind] IN (N'course', N'learning-path')) AS [search];
  `);
  if (Object.values(row ?? { missing: 1 }).some((value) => Number(value) !== 0))
    fail(`The Phase-22 rollback left a Learning object: ${JSON.stringify(row ?? null)}.`);
  if (await learningPresent(session))
    fail('The Phase-22 rollback left the Learning schema in place.');
  const bundled = await assertProtectedBundleExcludesGated(session);
  const expected = compiledBundleAt('before-learning').length;
  if (
    bundled !== expected ||
    expected !==
      PLATFORM_ADMINISTRATOR_PERMISSIONS.length -
        LEARNING_PERMISSIONS.length -
        CLASSES_PERMISSIONS.length -
        MEMBERSHIP_PERMISSIONS.length -
        DONATIONS_BUNDLED.length -
        MIGRATION_BUNDLED.length
  )
    fail(
      `After the Phase-22 rollback the protected bundle holds ${String(bundled)} keys; the ` +
        `compiled bundle less the two Learning, two class, two Membership, two bundled ` +
        `Donations and two bundled Migration keys holds ${String(expected)}.`,
    );
  report(
    'learning rollback',
    `every Learning table, key, index, CHECK, trigger, permission, search row and ` +
      `provisioning record removed; ${String(bundled)} keys still bundled`,
  );
}

/**
 * Phase 22 — THE RULES, proved as behaviour against the re-deployed schema
 * with NON_LEARNING_FIXTURE sentinels only, through the migration login (the
 * runtime's own posture is `db:test:permissions`'s):
 *
 *   - a Course is published only with a complete syllabus in its primary
 *     locale — a label, at least one module, a lesson in every module and the
 *     words of each — whether it is inserted or updated into publication
 *     (51270); while published, its modules, lessons and their words refuse
 *     every insert, update and delete (51271);
 *   - a published path holds at least one Course (51274) and only published
 *     ones (51272), checked when the path changes and when its places do; a
 *     Course a published path holds cannot leave publication (51273);
 *   - an enrolment (51275) and progress (51277) only on a published Course, a
 *     trial request only on a published LIVE Course (51276) — and leaving,
 *     withdrawing and disposition are never refused by a Course's state;
 *   - the composite keys: a lesson cannot sit in another Course's module, and
 *     progress can name neither a lesson of another Course nor a Course the
 *     person is not enrolled on; one enrolment, one progress row per lesson and
 *     one trial request per person and Course;
 *   - Learn's own route words are never a slug, on either catalogue or either
 *     history (…_slug_ck); every slug a record has held is reserved for it by
 *     the database, a return to its own former slug is not reuse, and another
 *     record taking it is refused by the history's key;
 *   - nothing cascades: a Course with its slug reservation, an account with an
 *     enrolment, an enrolment with progress and a teacher's Person are never
 *     deleted under their dependants.
 *
 * Every Learning row the proofs write is removed at the end, children first,
 * which shows the schema can be emptied without a cascade; the synthetic
 * accounts and Person go with them.
 */
async function assertLearningRules(session: SqlSession): Promise<void> {
  const run = randomUUID().replaceAll('-', '').slice(0, 16);
  const at = '2026-10-06T00:00:00';
  const later = '2026-10-06T01:00:00';
  let refusals = 0;
  const refuse = async (
    label: string,
    statement: string,
    numbers: readonly number[],
    rule: string,
  ): Promise<void> => {
    await expectRefusal(session, label, statement, numbers, rule);
    refusals += 1;
  };
  const count = async (statement: string): Promise<number> => {
    const [row] = await session.query<{ total: number }>(statement);
    return Number(row?.total ?? -1);
  };
  const slug = (label: string): string => `non-learning-fixture-${label}-${run}`;
  const SYLLABUS = 'syllabus cannot change';

  // ---- the accounts, the teacher and the topic the proofs name -------------------
  const learner = randomUUID();
  const other = randomUUID();
  for (const [user, label] of [
    [learner, 'learner'],
    [other, 'other'],
  ] as const)
    await session.query(
      `INSERT INTO [dbo].[User] ([id],[name],[email],[emailVerified],[createdAt],[updatedAt],[locale],[status],[twoFactorEnabled]) VALUES (N'${user}',N'NON_LEARNING_FIXTURE ${label}',N'${label}-${run}@learning-proof.invalid',0,SYSUTCDATETIME(),SYSUTCDATETIME(),N'en',N'active',0);`,
    );
  const teacher = randomUUID();
  await session.query(
    `INSERT INTO [dbo].[Person] ([id],[slug],[primaryLocale],[status]) VALUES (N'${teacher}',N'${slug('teacher')}',N'en',N'published');
     INSERT INTO [dbo].[PersonTranslation] ([personId],[locale],[name]) VALUES (N'${teacher}',N'en',N'NON_LEARNING_FIXTURE teacher');`,
  );
  const [topic] = await session.query<{ id: string }>(
    'SELECT TOP 1 [id] FROM [dbo].[Topic] ORDER BY [slug];',
  );
  if (topic === undefined) fail('The Learning rules need a canonical Topic.');

  const course = (
    id: string,
    label: string,
    format: 'live' | 'self-paced',
    state: 'draft' | 'published' = 'draft',
  ): string =>
    `INSERT INTO [dbo].[Course] ([id],[slug],[primaryLocale],[state],[level],[format],[languageCode],[publishedAt],[version],[updatedAt]) VALUES (N'${id}',N'${slug(label)}',N'en',N'${state}',NULL,N'${format}',N'en',${state === 'published' ? `'${at}'` : 'NULL'},1,'${at}');`;
  const courseLabel = (id: string, locale = 'en'): string =>
    `INSERT INTO [dbo].[CourseLabel] ([courseId],[locale],[title],[summary],[description]) VALUES (N'${id}',N'${locale}',N'NON_LEARNING_FIXTURE course',N'NON_LEARNING_FIXTURE summary',N'NON_LEARNING_FIXTURE description');`;
  const courseModule = (id: string, courseId: string, position: number): string =>
    `INSERT INTO [dbo].[CourseModule] ([id],[courseId],[position]) VALUES (N'${id}',N'${courseId}',${String(position)});
     INSERT INTO [dbo].[CourseModuleLabel] ([moduleId],[locale],[title],[summary]) VALUES (N'${id}',N'en',N'NON_LEARNING_FIXTURE module',N'NON_LEARNING_FIXTURE summary');`;
  const lesson = (
    id: string,
    courseId: string,
    moduleId: string,
    position: number,
  ): string =>
    `INSERT INTO [dbo].[Lesson] ([id],[courseId],[moduleId],[position]) VALUES (N'${id}',N'${courseId}',N'${moduleId}',${String(position)});
     INSERT INTO [dbo].[LessonLabel] ([lessonId],[locale],[title],[summary],[body]) VALUES (N'${id}',N'en',N'NON_LEARNING_FIXTURE lesson',N'NON_LEARNING_FIXTURE summary',N'NON_LEARNING_FIXTURE body');`;
  const publish = (table: 'Course' | 'LearningPath', id: string): string =>
    `UPDATE [dbo].[${table}] SET [state]=N'published',[publishedAt]='${at}',[version]=[version]+1,[updatedAt]='${at}' WHERE [id]=N'${id}';`;
  const archive = (table: 'Course' | 'LearningPath', id: string): string =>
    `UPDATE [dbo].[${table}] SET [state]=N'archived',[version]=[version]+1,[updatedAt]='${later}' WHERE [id]=N'${id}';`;
  const enrol = (user: string, courseId: string): string =>
    `INSERT INTO [dbo].[Enrolment] ([userId],[courseId],[enrolledAt]) VALUES (N'${user}',N'${courseId}','${at}');`;
  const progress = (user: string, courseId: string, lessonId: string): string =>
    `INSERT INTO [dbo].[LessonProgress] ([userId],[courseId],[lessonId],[completedAt]) VALUES (N'${user}',N'${courseId}',N'${lessonId}','${later}');`;
  const trial = (user: string, courseId: string): string =>
    `INSERT INTO [dbo].[TrialClassRequest] ([id],[userId],[courseId],[requestedAt]) VALUES (N'${randomUUID()}',N'${user}',N'${courseId}','${at}');`;
  const path = (
    id: string,
    label: string,
    state: 'draft' | 'published' = 'draft',
  ): string =>
    `INSERT INTO [dbo].[LearningPath] ([id],[slug],[primaryLocale],[state],[publishedAt],[version],[updatedAt]) VALUES (N'${id}',N'${slug(label)}',N'en',N'${state}',${state === 'published' ? `'${at}'` : 'NULL'},1,'${at}');`;
  const place = (pathId: string, courseId: string, position: number): string =>
    `INSERT INTO [dbo].[LearningPathCourse] ([pathId],[courseId],[position]) VALUES (N'${pathId}',N'${courseId}',${String(position)});`;

  // ---- a Course is published only with a complete syllabus (51270) ---------------
  const live = randomUUID();
  const liveModule = randomUUID();
  const liveLessons = [randomUUID(), randomUUID()] as const;
  await expectAccepted(
    session,
    'A draft live Course with its words, topic and teacher',
    `${course(live, 'live', 'live')}
     ${courseLabel(live)}
     INSERT INTO [dbo].[CourseTopic] ([courseId],[topicId]) VALUES (N'${live}',N'${topic.id}');
     INSERT INTO [dbo].[CourseTeacher] ([courseId],[personId],[position]) VALUES (N'${live}',N'${teacher}',0);`,
  );
  await refuse(
    'A Course published with no module',
    publish('Course', live),
    [51270],
    'A published Course needs a complete syllabus',
  );
  await refuse(
    'A Course inserted already published with no syllabus',
    course(randomUUID(), 'born-published', 'self-paced', 'published'),
    [51270],
    'A published Course needs a complete syllabus',
  );
  await expectAccepted(
    session,
    'A module with its words',
    courseModule(liveModule, live, 0),
  );
  await refuse(
    'A Course published with a module that has no lesson',
    publish('Course', live),
    [51270],
    'A published Course needs a complete syllabus',
  );
  await expectAccepted(
    session,
    'Two lessons with their words',
    `${lesson(liveLessons[0], live, liveModule, 0)}
     ${lesson(liveLessons[1], live, liveModule, 1)}`,
  );

  // A self-paced Course of its own, so a lesson can be offered another Course's
  // module and progress another Course's lesson.
  const paced = randomUUID();
  const pacedModule = randomUUID();
  const pacedLesson = randomUUID();
  await expectAccepted(
    session,
    'A complete self-paced Course',
    `${course(paced, 'paced', 'self-paced')}
     ${courseLabel(paced)}
     ${courseModule(pacedModule, paced, 0)}
     ${lesson(pacedLesson, paced, pacedModule, 0)}`,
  );
  await refuse(
    "A lesson of one Course in another Course's module",
    `INSERT INTO [dbo].[Lesson] ([id],[courseId],[moduleId],[position]) VALUES (N'${randomUUID()}',N'${live}',N'${pacedModule}',5);`,
    [547],
    'Lesson_module_fkey',
  );
  await refuse(
    'Two modules at one place',
    `INSERT INTO [dbo].[CourseModule] ([id],[courseId],[position]) VALUES (N'${randomUUID()}',N'${paced}',0);`,
    [2627],
    'CourseModule_courseId_position_key',
  );
  await refuse(
    'A module beyond the last place',
    `INSERT INTO [dbo].[CourseModule] ([id],[courseId],[position]) VALUES (N'${randomUUID()}',N'${paced}',20);`,
    [547],
    'CourseModule_ck',
  );
  await expectAccepted(
    session,
    'A complete live Course published',
    publish('Course', live),
  );
  await expectAccepted(
    session,
    'A complete self-paced Course published',
    publish('Course', paced),
  );

  // ---- a published Course's syllabus is frozen (51271) ----------------------------
  await refuse(
    'A module added to a published Course',
    `INSERT INTO [dbo].[CourseModule] ([id],[courseId],[position]) VALUES (N'${randomUUID()}',N'${live}',1);`,
    [51271],
    SYLLABUS,
  );
  await refuse(
    "A published Course's module words rewritten",
    `UPDATE [dbo].[CourseModuleLabel] SET [title]=N'NON_LEARNING_FIXTURE rewritten' WHERE [moduleId]=N'${liveModule}';`,
    [51271],
    SYLLABUS,
  );
  await refuse(
    "A published Course's lessons reordered",
    `UPDATE [dbo].[Lesson] SET [position]=[position]+10 WHERE [courseId]=N'${live}';`,
    [51271],
    SYLLABUS,
  );
  await refuse(
    "A published Course's lesson words removed",
    `DELETE FROM [dbo].[LessonLabel] WHERE [lessonId]=N'${liveLessons[0]}';`,
    [51271],
    SYLLABUS,
  );
  await expectAccepted(
    session,
    "A published Course's own record and words still change",
    `UPDATE [dbo].[Course] SET [level]=N'beginner',[version]=[version]+1,[updatedAt]='${later}' WHERE [id]=N'${live}';
     UPDATE [dbo].[CourseLabel] SET [summary]=N'NON_LEARNING_FIXTURE revised' WHERE [courseId]=N'${live}';`,
  );

  // ---- study begins only on a published Course (51275–51277) -----------------------
  const draft = randomUUID();
  await expectAccepted(
    session,
    'A draft live Course with words only',
    `${course(draft, 'draft', 'live')}
     ${courseLabel(draft)}`,
  );
  await refuse(
    'An enrolment on a draft Course',
    enrol(learner, draft),
    [51275],
    'Only a published Course takes an enrolment',
  );
  await expectAccepted(
    session,
    'An enrolment on a published Course',
    enrol(learner, live),
  );
  await expectAccepted(
    session,
    'A second account enrolled on another Course',
    enrol(other, paced),
  );
  await refuse(
    'One person enrolled twice on one Course',
    enrol(learner, live),
    [2627],
    'Enrolment_pkey',
  );
  await refuse(
    'A trial request on a draft Course',
    trial(learner, draft),
    [51276],
    'Only a published live Course takes a trial-class request',
  );
  await refuse(
    'A trial request on a published self-paced Course',
    trial(learner, paced),
    [51276],
    'Only a published live Course takes a trial-class request',
  );
  await expectAccepted(
    session,
    'A trial request on a published live Course',
    trial(learner, live),
  );
  await refuse(
    'A second trial request for one Course',
    trial(learner, live),
    [2627],
    'TrialClassRequest_userId_courseId_key',
  );
  await expectAccepted(
    session,
    'Progress on a lesson of the enrolled Course',
    progress(learner, live, liveLessons[0]),
  );
  await refuse(
    'Progress naming a lesson of another Course',
    progress(learner, live, pacedLesson),
    [547],
    'LessonProgress_lesson_fkey',
  );
  await refuse(
    'Progress on a Course the person is not enrolled on',
    progress(learner, paced, pacedLesson),
    [547],
    'LessonProgress_enrolment_fkey',
  );
  await refuse(
    'One lesson completed twice',
    progress(learner, live, liveLessons[0]),
    [2627],
    'LessonProgress_pkey',
  );

  // ---- a published path is whole (51272–51274) -------------------------------------
  const published = randomUUID();
  await refuse(
    'A path inserted already published with no Course',
    path(randomUUID(), 'born-published-path', 'published'),
    [51274],
    'A published LearningPath needs at least one Course',
  );
  await expectAccepted(
    session,
    'A draft path holding a draft Course',
    `${path(published, 'path')}
     INSERT INTO [dbo].[LearningPathLabel] ([pathId],[locale],[title],[summary],[description]) VALUES (N'${published}',N'en',N'NON_LEARNING_FIXTURE path',N'NON_LEARNING_FIXTURE summary',N'NON_LEARNING_FIXTURE description');
     ${place(published, draft, 0)}`,
  );
  await refuse(
    'A path published while it holds a draft Course',
    publish('LearningPath', published),
    [51272],
    'A published LearningPath holds only published Courses',
  );
  await expectAccepted(
    session,
    'A path of two published Courses, in order',
    `DELETE FROM [dbo].[LearningPathCourse] WHERE [pathId]=N'${published}';
     ${place(published, live, 0)}
     ${place(published, paced, 1)}`,
  );
  await expectAccepted(
    session,
    'A whole path published',
    publish('LearningPath', published),
  );
  await refuse(
    'A draft Course placed in a published path',
    place(published, draft, 2),
    [51272],
    'A published LearningPath holds only published Courses',
  );
  await refuse(
    'A published path emptied',
    `DELETE FROM [dbo].[LearningPathCourse] WHERE [pathId]=N'${published}';`,
    [51274],
    'A published LearningPath needs at least one Course',
  );
  await refuse(
    'A Course a published path holds leaving publication',
    archive('Course', live),
    [51273],
    'A Course in a published LearningPath cannot leave publication',
  );

  // ---- route words are never slugs; a slug once held stays reserved ----------------
  const drafted = randomUUID();
  await refuse(
    "A Course named after one of Learn's routes",
    course(randomUUID(), 'x', 'live').replace(`N'${slug('x')}'`, `N'courses'`),
    [547],
    'Course_slug_ck',
  );
  await refuse(
    "A Course history reserving one of Learn's routes",
    `INSERT INTO [dbo].[CourseSlugHistory] ([slug],[courseId]) VALUES (N'teachers',N'${draft}');`,
    [547],
    'CourseSlugHistory_slug_ck',
  );
  await refuse(
    "A path named after one of Learn's routes",
    path(randomUUID(), 'x').replace(`N'${slug('x')}'`, `N'paths'`),
    [547],
    'LearningPath_slug_ck',
  );
  await refuse(
    "A path history reserving one of Learn's routes",
    `INSERT INTO [dbo].[LearningPathSlugHistory] ([slug],[pathId]) VALUES (N'live',N'${published}');`,
    [547],
    'LearningPathSlugHistory_slug_ck',
  );
  await expectAccepted(
    session,
    'A draft Course renamed, and renamed back to its own former slug',
    `UPDATE [dbo].[Course] SET [slug]=N'${slug('draft-renamed')}' WHERE [id]=N'${draft}';
     UPDATE [dbo].[Course] SET [slug]=N'${slug('draft')}' WHERE [id]=N'${draft}';`,
  );
  const history = async (table: string, column: string, id: string): Promise<string> =>
    (
      await session.query<{ slug: string }>(
        `SELECT [slug] FROM [dbo].[${table}] WHERE [${column}]=N'${id}' ORDER BY [slug];`,
      )
    )
      .map((row) => row.slug)
      .join(',');
  if (
    (await history('CourseSlugHistory', 'courseId', draft)) !==
    [slug('draft'), slug('draft-renamed')].sort().join(',')
  )
    fail('A Course rename did not reserve exactly its two slugs, once each.');
  await refuse(
    "Another Course taking a Course's former slug",
    `UPDATE [dbo].[Course] SET [slug]=N'${slug('draft-renamed')}' WHERE [id]=N'${paced}';`,
    [2627],
    'CourseSlugHistory_pkey',
  );
  await expectAccepted(
    session,
    'A draft path renamed',
    `${path(drafted, 'drafted')}
     UPDATE [dbo].[LearningPath] SET [slug]=N'${slug('drafted-renamed')}' WHERE [id]=N'${drafted}';`,
  );
  await refuse(
    "Another path taking a path's former slug",
    `UPDATE [dbo].[LearningPath] SET [slug]=N'${slug('drafted')}' WHERE [id]=N'${published}';`,
    [2627],
    'LearningPathSlugHistory_pkey',
  );

  // ---- closed vocabularies and bounds -----------------------------------------------
  await refuse(
    'A Course level outside its vocabulary',
    `UPDATE [dbo].[Course] SET [level]=N'expert' WHERE [id]=N'${draft}';`,
    [547],
    'Course_ck',
  );
  await refuse(
    'A Course published without its instant',
    `UPDATE [dbo].[Course] SET [state]=N'published',[publishedAt]=NULL WHERE [id]=N'${draft}';`,
    [547],
    'Course_ck',
  );
  await refuse(
    'Course words in a locale the site does not serve',
    courseLabel(draft, 'fr'),
    [547],
    'CourseLabel_ck',
  );
  await refuse(
    'A teacher beyond the last place',
    `INSERT INTO [dbo].[CourseTeacher] ([courseId],[personId],[position]) VALUES (N'${draft}',N'${teacher}',6);`,
    [547],
    'CourseTeacher_ck',
  );
  await refuse(
    'A path place beyond the last',
    place(drafted, draft, 30),
    [547],
    'LearningPathCourse_ck',
  );

  // ---- nothing cascades ---------------------------------------------------------------
  const reserved = randomUUID();
  await expectAccepted(
    session,
    'A draft Course holding only its slug reservation',
    course(reserved, 'reserved', 'self-paced'),
  );
  const learningRows = async (): Promise<number> =>
    count(
      `SELECT ${LEARNING_TABLES.map((table) => `(SELECT COUNT_BIG(*) FROM [dbo].[${table}])`).join(' + ')} AS [total];`,
    );
  const before = await learningRows();
  await refuse(
    'A Course deleted under its slug reservation',
    `DELETE FROM [dbo].[Course] WHERE [id]=N'${reserved}';`,
    [547],
    'CourseSlugHistory_courseId_fkey',
  );
  await refuse(
    'An account deleted under its enrolment',
    `DELETE FROM [dbo].[User] WHERE [id]=N'${other}';`,
    [547],
    'Enrolment_userId_fkey',
  );
  await refuse(
    'An enrolment deleted under its progress',
    `DELETE FROM [dbo].[Enrolment] WHERE [userId]=N'${learner}' AND [courseId]=N'${live}';`,
    [547],
    'LessonProgress_enrolment_fkey',
  );
  await refuse(
    "A teacher's Person deleted under a Course",
    `DELETE FROM [dbo].[Person] WHERE [id]=N'${teacher}';`,
    [547],
    'CourseTeacher_personId_fkey',
  );
  if ((await learningRows()) !== before)
    fail('A refused deletion changed a Learning row.');

  // ---- leaving publication closes study, and never refuses leaving -----------------
  await expectAccepted(
    session,
    'A path archived, then its Course',
    `${archive('LearningPath', published)}
     ${archive('Course', live)}`,
  );
  await refuse(
    'Progress on an archived Course',
    progress(learner, live, liveLessons[1]),
    [51277],
    'Progress is recorded only on a published Course',
  );
  await refuse(
    'An enrolment on an archived Course',
    enrol(other, live),
    [51275],
    'Only a published Course takes an enrolment',
  );
  await refuse(
    'A trial request on an archived Course',
    trial(other, live),
    [51276],
    'Only a published live Course takes a trial-class request',
  );
  await expectAccepted(
    session,
    'A learner leaves an archived Course and withdraws a request',
    `DELETE FROM [dbo].[LessonProgress] WHERE [userId]=N'${learner}';
     DELETE FROM [dbo].[Enrolment] WHERE [userId]=N'${learner}';
     DELETE FROM [dbo].[TrialClassRequest] WHERE [userId]=N'${learner}';`,
  );
  await expectAccepted(
    session,
    'A learner leaves a published Course',
    `DELETE FROM [dbo].[Enrolment] WHERE [userId]=N'${other}';`,
  );

  // ---- every fixture row removed, children first, without a cascade ---------------
  const courses = [live, paced, draft, reserved].map((id) => `N'${id}'`).join(',');
  const paths = [published, drafted].map((id) => `N'${id}'`).join(',');
  await expectAccepted(
    session,
    'Every Learning fixture row removed, children first',
    `${archive('Course', paced)}
     DELETE FROM [dbo].[LearningPathCourse] WHERE [pathId] IN (${paths});
     DELETE FROM [dbo].[LearningPathLabel] WHERE [pathId] IN (${paths});
     DELETE FROM [dbo].[LearningPathSlugHistory] WHERE [pathId] IN (${paths});
     DELETE FROM [dbo].[LearningPath] WHERE [id] IN (${paths});
     DELETE FROM [dbo].[LessonLabel] WHERE [lessonId] IN (SELECT [id] FROM [dbo].[Lesson] WHERE [courseId] IN (${courses}));
     DELETE FROM [dbo].[Lesson] WHERE [courseId] IN (${courses});
     DELETE FROM [dbo].[CourseModuleLabel] WHERE [moduleId] IN (SELECT [id] FROM [dbo].[CourseModule] WHERE [courseId] IN (${courses}));
     DELETE FROM [dbo].[CourseModule] WHERE [courseId] IN (${courses});
     DELETE FROM [dbo].[CourseTeacher] WHERE [courseId] IN (${courses});
     DELETE FROM [dbo].[CourseTopic] WHERE [courseId] IN (${courses});
     DELETE FROM [dbo].[CourseLabel] WHERE [courseId] IN (${courses});
     DELETE FROM [dbo].[CourseSlugHistory] WHERE [courseId] IN (${courses});
     DELETE FROM [dbo].[Course] WHERE [id] IN (${courses});
     DELETE FROM [dbo].[Person] WHERE [id]=N'${teacher}';
     DELETE FROM [dbo].[User] WHERE [id] IN (N'${learner}', N'${other}');`,
  );
  if ((await learningRows()) !== 0)
    fail('The Learning rule proofs left a fixture row behind.');

  report(
    'learning rules',
    `complete syllabus, frozen while public, whole paths, study only on published Courses, ` +
      `composite ownership, reserved slugs, no cascade; ${String(refusals)} refusals by name, ` +
      `every text a NON_LEARNING_FIXTURE sentinel, every row removed`,
  );
}

/**
 * EVERY foreign key from a Phase-23 table, exactly, with its column mapping and
 * its delete action. ALL are NO ACTION: nothing cascades, inside the context or
 * out of it. The external edges are Identity's User and RoleAssignment and
 * Learning's own Course and trial request; a session reaches its scope by a
 * composite key that carries the Course, so it can never sit on a scope of
 * another Course.
 */
const CLASSES_KEYS = [
  'Attendance_sessionId_fkey(sessionId>id)>ClassSession:NO_ACTION',
  'Attendance_userId_fkey(userId>id)>User:NO_ACTION',
  'Availability_userId_fkey(userId>id)>User:NO_ACTION',
  'Booking_availabilityId_fkey(availabilityId>id)>Availability:NO_ACTION',
  'Booking_courseId_fkey(courseId>id)>Course:NO_ACTION',
  'Booking_requestId_fkey(requestId>id)>TrialClassRequest:NO_ACTION',
  'Booking_sessionId_fkey(sessionId>id)>ClassSession:NO_ACTION',
  'Booking_userId_fkey(userId>id)>User:NO_ACTION',
  'ClassCommunicationIntent_sessionId_fkey(sessionId>id)>ClassSession:NO_ACTION',
  'ClassCommunicationIntent_userId_fkey(userId>id)>User:NO_ACTION',
  'ClassSession_courseId_fkey(courseId>id)>Course:NO_ACTION',
  'ClassSession_scope_fkey(scopeId>id,courseId>courseId)>CourseTeachingAssignment:NO_ACTION',
  'CourseTeachingAssignment_courseId_fkey(courseId>id)>Course:NO_ACTION',
  'CourseTeachingAssignment_roleAssignmentId_fkey(roleAssignmentId>id)>RoleAssignment:NO_ACTION',
  'CourseTeachingAssignment_userId_fkey(userId>id)>User:NO_ACTION',
].sort();

/**
 * Every unique index on a Phase-23 table, exactly: the keys, the scope's owner
 * key a session reaches through, one Booking per request and per session, one
 * intent per idempotency key, and the TWO FILTERED claims — one current scope
 * per account and Course, one live Booking per window.
 */
const CLASSES_UNIQUE = [
  'Attendance_pkey(sessionId,userId)',
  'Availability_pkey(id)',
  'Booking_pkey(id)',
  'Booking_requestId_key(requestId)',
  'Booking_sessionId_key(sessionId)',
  "Booking_slot_key(availabilityId) WHERE ([state]<>N'cancelled')",
  'ClassCommunicationIntent_idempotencyKey_key(idempotencyKey)',
  'ClassCommunicationIntent_pkey(id)',
  'ClassSession_pkey(id)',
  'CourseTeachingAssignment_current_key(courseId,userId) WHERE ([endedAt] IS NULL)',
  'CourseTeachingAssignment_owner_key(id,courseId)',
  'CourseTeachingAssignment_pkey(id)',
  'LiveLearningActivation_pkey(id)',
].sort();

/**
 * Every column of every Phase-23 table, in order. Stated whole so a
 * `scopeType`/`targetType`/`sourceType` pair, a copied name or address, a
 * grade, note, age, guardian, consent, recording, calendar or OAuth column, or
 * a second home for the meeting address cannot arrive unnoticed.
 */
const CLASSES_COLUMNS: Readonly<Record<string, string>> = {
  LiveLearningActivation: 'id,authority,authorisedBy,reference,activatedAt',
  CourseTeachingAssignment:
    'id,courseId,userId,roleAssignmentId,grantedAt,grantedById,endedAt,endedById,version,updatedAt',
  Availability:
    'id,userId,startsAt,endsAt,timeZone,startsLocal,endsLocal,state,version,createdAt,updatedAt',
  ClassSession:
    'id,courseId,kind,scopeId,startsAt,endsAt,timeZone,startsLocal,endsLocal,state,meetingProvider,meetingUrl,reminderAt,version,createdAt,updatedAt,closedAt',
  Booking:
    'id,requestId,userId,courseId,sessionId,availabilityId,state,confirmedAt,confirmedById,cancelledAt,cancelledById,version,updatedAt',
  Attendance: 'sessionId,userId,status,markedAt,markedById',
  ClassCommunicationIntent:
    'id,purpose,sessionId,userId,dueAt,state,idempotencyKey,claimedUntil,relayedAt,createdAt',
};

/**
 * Whether Phase 23 is applied, ALL OR NOTHING: either every one of its seven
 * tables exists or none does.
 */
async function classesPresent(session: SqlSession): Promise<boolean> {
  const names = CLASSES_TABLES.map((table) => `N'${table}'`).join(',');
  const [row] = await session.query<{ present: number }>(
    `SELECT COUNT(*) AS [present] FROM sys.tables WHERE [name] IN (${names});`,
  );
  const present = Number(row?.present ?? -1);
  if (present !== 0 && present !== CLASSES_TABLES.length)
    fail(
      `Phase 23 is half applied: ${String(present)} of ${String(CLASSES_TABLES.length)} ` +
        `live-class tables exist.`,
    );
  return present === CLASSES_TABLES.length;
}

/**
 * Phase 23 — what only the catalogue can prove about live classes:
 *
 *   1. NOTHING IS SEEDED: all seven tables are empty after deploy — and above
 *      all NO activation row, so a migrated database has live learning OFF;
 *   2. every column of every table is exactly as stated — no `scopeType`,
 *      `targetType`, `sourceType` or `entity` column, no grade, note, age,
 *      guardian, consent, vetting, recording, calendar, OAuth or token column —
 *      and the unique indexes are exactly the thirteen above, the two claims
 *      FILTERED;
 *   3. every foreign key is exactly one of the fifteen above, ALL NO ACTION
 *      and trusted: User and RoleAssignment the only Identity edges, Course and
 *      the trial request the only Learning ones, a session's scope reached by
 *      the composite key that carries the Course; no other owner references a
 *      live-class table or holds a booking, window, attendance or meeting
 *      column, and the meeting address lives in ClassSession alone;
 *   4. the CHECKs are exactly the nine named rules, all trusted; the triggers
 *      are exactly the seven in `CLASSES_TRIGGER_NUMBERS`, enabled, each
 *      raising exactly its own numbers from 51280–51292 on the table it
 *      guards; and the slice has no procedure;
 *   5. the vocabulary is exactly `learning.classes.administer`,
 *      `learning.classes.read` and `teaching.perform`, described as the
 *      compiled catalogue describes them; the two class keys each bundled
 *      exactly once into the protected role and held by no other, with exactly
 *      one `learning.classes.permissions.provisioned` record naming this
 *      migration; `teaching.perform` externally gated in the compiled
 *      catalogue, bundled into NO role and held by NOBODY; and the protected
 *      bundle exactly the compiled bundle.
 *
 * The rules themselves are proved as BEHAVIOUR by `assertClassesRules`, and
 * through the runtime login by `db:test:permissions`.
 */
async function assertClassesFoundation(
  session: SqlSession,
  stage:
    | 'deploy'
    | 're-deploy'
    | 'before-migration'
    | 'before-donations'
    | 'before-membership'
    | 'before-messaging' = 'deploy',
): Promise<void> {
  const tables = CLASSES_TABLES.map((table) => `OBJECT_ID(N'[dbo].[${table}]')`).join(
    ',',
  );
  const names = CLASSES_TABLES.map((table) => `N'${table}'`).join(',');
  if (!(await classesPresent(session)))
    fail(`The Phase-23 live-class tables are missing after ${stage}.`);

  // ---- 1. nothing seeded, and no activation above all ----------------------------
  const counts = await session.query<{ name: string; total: number }>(
    CLASSES_TABLES.map(
      (table) =>
        `SELECT N'${table}' AS [name], COUNT_BIG(*) AS [total] FROM [dbo].[${table}]`,
    ).join(' UNION ALL ') + ';',
  );
  const seeded = counts.filter((row) => Number(row.total) !== 0);
  if (CLASSES_TABLES.length !== 7 || counts.length !== 7 || seeded.length > 0)
    fail(
      `The live-class migration must create seven empty tables and seed nothing — above ` +
        `all no activation, so live learning is OFF; found ${String(counts.length)} tables ` +
        `after ${stage}, seeded: ${JSON.stringify(seeded)}.`,
    );

  // ---- 2. exact columns, exact unique indexes with exactly two filtered ------------
  const shapes = await session.query<{ name: string; columns: string }>(`
    SELECT OBJECT_NAME(c.[object_id]) AS [name],
      STRING_AGG(c.[name], N',') WITHIN GROUP (ORDER BY c.[column_id]) AS [columns]
    FROM sys.columns c WHERE c.[object_id] IN (${tables})
    GROUP BY c.[object_id];
  `);
  const shapeFindings = CLASSES_TABLES.filter(
    (table) =>
      shapes.find((row) => row.name === table)?.columns !== CLASSES_COLUMNS[table],
  );
  if (shapes.length !== 7 || shapeFindings.length > 0)
    fail(
      `Live-class columns differ from the reviewed shape in ${shapeFindings.join(', ')}: ` +
        `${JSON.stringify(shapes.filter((row) => shapeFindings.includes(row.name)))}.`,
    );

  const generic = await session.query<{ name: string }>(`
    SELECT OBJECT_NAME(c.[object_id]) + N'.' + c.[name] AS [name] FROM sys.columns c
    WHERE c.[object_id] IN (${tables})
      AND (c.[name] LIKE N'%Type' OR c.[name] LIKE N'%target%' OR c.[name] LIKE N'%entity%'
           OR c.[name] LIKE N'%source%' OR c.[name] LIKE N'%grade%' OR c.[name] LIKE N'%note%'
           OR c.[name] LIKE N'%age%' OR c.[name] LIKE N'%guardian%' OR c.[name] LIKE N'%consent%'
           OR c.[name] LIKE N'%vetting%' OR c.[name] LIKE N'%record%' OR c.[name] LIKE N'%calendar%'
           OR c.[name] LIKE N'%oauth%' OR c.[name] LIKE N'%token%' OR c.[name] LIKE N'%credential%'
           OR c.[name] LIKE N'%email%' OR c.[name] LIKE N'%phone%' OR c.[name] LIKE N'%name%'
           OR c.[name] LIKE N'%retention%' OR c.[name] LIKE N'%adult%');
  `);
  if (generic.length > 0)
    fail(
      `A live-class table may carry no type, target, source, grade, note, age, guardian, ` +
        `consent, vetting, recording, calendar, OAuth, token or contact column; found ` +
        `${JSON.stringify(generic)}.`,
    );

  const unique = await session.query<{
    name: string;
    columns: string;
    filter: string | null;
  }>(`
    SELECT i.[name], i.[filter_definition] AS [filter],
      STRING_AGG(COL_NAME(ic.[object_id], ic.[column_id]), N',')
        WITHIN GROUP (ORDER BY ic.[key_ordinal]) AS [columns]
    FROM sys.indexes i
    JOIN sys.index_columns ic ON ic.[object_id] = i.[object_id] AND ic.[index_id] = i.[index_id]
    WHERE i.[is_unique] = 1 AND ic.[key_ordinal] > 0 AND i.[object_id] IN (${tables})
    GROUP BY i.[object_id], i.[name], i.[filter_definition];
  `);
  const describedUnique = unique
    .map(
      (row) =>
        `${row.name}(${row.columns})` +
        (row.filter === null ? '' : ` WHERE ${row.filter}`),
    )
    .sort();
  if (
    describedUnique.join(' | ') !== CLASSES_UNIQUE.join(' | ') ||
    unique.filter((row) => row.filter !== null).length !== 2
  )
    fail(
      `Live-class unique indexes must be exactly the reviewed thirteen, the two claims ` +
        `filtered; found ${describedUnique.join(' | ')}.`,
    );

  // ---- 3. exact keys, all NO ACTION and trusted; nothing foreign holds the slice ---
  const keys = await session.query<{
    name: string;
    columns: string;
    target: string;
    deletes: string;
    updates: string;
    trusted: number;
  }>(`
    SELECT fk.[name], OBJECT_NAME(fk.[referenced_object_id]) AS [target],
      fk.[delete_referential_action_desc] AS [deletes], fk.[update_referential_action_desc] AS [updates],
      CASE WHEN fk.[is_disabled] = 0 AND fk.[is_not_trusted] = 0 THEN 1 ELSE 0 END AS [trusted],
      STRING_AGG(COL_NAME(c.[parent_object_id], c.[parent_column_id]) + N'>'
        + COL_NAME(c.[referenced_object_id], c.[referenced_column_id]), N',')
        WITHIN GROUP (ORDER BY c.[constraint_column_id]) AS [columns]
    FROM sys.foreign_keys fk
    JOIN sys.foreign_key_columns c ON c.[constraint_object_id] = fk.[object_id]
    WHERE fk.[parent_object_id] IN (${tables})
    GROUP BY fk.[name], fk.[referenced_object_id], fk.[delete_referential_action_desc],
      fk.[update_referential_action_desc], fk.[is_disabled], fk.[is_not_trusted];
  `);
  const describedKeys = keys
    .map((row) => `${row.name}(${row.columns})>${row.target}:${row.deletes}`)
    .sort();
  if (
    describedKeys.join(',') !== CLASSES_KEYS.join(',') ||
    keys.some((row) => row.updates !== 'NO_ACTION' || Number(row.trusted) !== 1)
  )
    fail(
      `Live-class keys must be exactly the reviewed fifteen, none cascading and all ` +
        `trusted; found ${describedKeys.join(', ')}.`,
    );

  const [isolation] = await session.query<{
    inbound: number;
    foreign: string | null;
    meeting: string | null;
  }>(`
    SELECT
      (SELECT COUNT(*) FROM sys.foreign_keys
        WHERE [referenced_object_id] IN (${tables}) AND [parent_object_id] NOT IN (${tables})) AS [inbound],
      (SELECT STRING_AGG(OBJECT_NAME(c.[object_id]) + N'.' + c.[name], N',') FROM sys.columns c
        WHERE (c.[name] LIKE N'%booking%' OR c.[name] LIKE N'%availabilityId%' OR c.[name] LIKE N'%attendance%'
               OR c.[name] LIKE N'%meeting%' OR c.[name] LIKE N'%classSession%'
               OR c.[name] LIKE N'%teachingAssignment%' OR c.[name] LIKE N'%teachingScope%')
          AND OBJECT_NAME(c.[object_id]) NOT IN (${names})
          AND OBJECTPROPERTY(c.[object_id], 'IsUserTable') = 1) AS [foreign],
      (SELECT STRING_AGG(OBJECT_NAME(c.[object_id]) + N'.' + c.[name], N',') WITHIN GROUP (ORDER BY c.[name])
         FROM sys.columns c
        WHERE c.[name] LIKE N'%meeting%' AND OBJECTPROPERTY(c.[object_id], 'IsUserTable') = 1) AS [meeting];
  `);
  if (
    Number(isolation?.inbound) !== 0 ||
    (isolation?.foreign ?? null) !== null ||
    isolation?.meeting !== 'ClassSession.meetingProvider,ClassSession.meetingUrl'
  )
    fail(
      `No other owner may reference or hold live-class schema, and the meeting address ` +
        `lives in ClassSession alone; found ${JSON.stringify(isolation ?? null)}.`,
    );

  // ---- 4. nine trusted CHECKs, seven triggers by number, no procedure -------------
  const checks = await session.query<{ name: string; trusted: number }>(`
    SELECT [name], CASE WHEN [is_disabled] = 0 AND [is_not_trusted] = 0 THEN 1 ELSE 0 END AS [trusted]
    FROM sys.check_constraints WHERE [parent_object_id] IN (${tables});
  `);
  const expectedChecks = EXPECTED_CHECK_CONSTRAINTS.filter((entry) =>
    CLASSES_TABLES.includes(entry.table),
  )
    .map((entry) => entry.constraint)
    .sort();
  if (
    expectedChecks.length !== 9 ||
    checks
      .map((row) => row.name)
      .sort()
      .join(',') !== expectedChecks.join(',') ||
    checks.some((row) => Number(row.trusted) !== 1)
  )
    fail(
      `Live classes must carry exactly their nine trusted CHECKs; found ${JSON.stringify(checks)}.`,
    );

  const triggers = await session.query<{
    name: string;
    tableName: string;
    disabled: number;
    definition: string | null;
  }>(`
    SELECT t.[name], OBJECT_NAME(t.[parent_id]) AS [tableName], CAST(t.[is_disabled] AS INT) AS [disabled],
      OBJECT_DEFINITION(t.[object_id]) AS [definition]
    FROM sys.triggers t WHERE t.[parent_id] IN (${tables});
  `);
  const describedTriggers = triggers
    .map((row) => `${row.name}@${row.tableName}:${raisedNumbers(row.definition)}`)
    .sort()
    .join(',');
  const expectedTriggers = Object.entries(CLASSES_TRIGGER_NUMBERS)
    .map(([name, [table, numbers]]) => `${name}@${table}:${numbers}`)
    .sort()
    .join(',');
  if (
    describedTriggers !== expectedTriggers ||
    triggers.length !== 7 ||
    triggers.some((row) => Number(row.disabled) !== 0)
  )
    fail(
      `Live-class triggers must be exactly seven, enabled, raising exactly their own ` +
        `51280–51292 numbers; found ${describedTriggers}.`,
    );

  const [procedures] = await session.query<{ total: number }>(`
    SELECT COUNT(*) AS [total] FROM sys.procedures
    WHERE [name] LIKE N'Learning%' OR [name] LIKE N'Class%' OR [name] LIKE N'Booking%'
       OR [name] LIKE N'Attendance%' OR [name] LIKE N'Availability%' OR [name] LIKE N'Teaching%';
  `);
  if (Number(procedures?.total) !== 0)
    fail('Phase 23 writes through its owner adapters; it must create no procedure.');

  // ---- 5. two keys bundled once and provisioned once; the teaching key gated ------
  const permissions = await session.query<{
    key: string;
    description: string;
    bundled: number;
    held: number;
    holders: number;
  }>(`
    SELECT p.[key], p.[description],
      (SELECT COUNT(*) FROM [dbo].[RolePermission] rp JOIN [dbo].[Role] r ON r.[id] = rp.[roleId]
        WHERE r.[key] = N'platform-administrator' AND rp.[permissionKey] = p.[key]) AS [bundled],
      (SELECT COUNT(*) FROM [dbo].[RolePermission] rp WHERE rp.[permissionKey] = p.[key]) AS [held],
      (SELECT COUNT(*) FROM [dbo].[RoleAssignment] ra JOIN [dbo].[RolePermission] rp ON rp.[roleId] = ra.[roleId]
        WHERE rp.[permissionKey] = p.[key]) AS [holders]
    FROM [dbo].[Permission] p
    WHERE p.[key] LIKE N'learning.classes%' OR p.[key] LIKE N'teaching%' OR p.[key] LIKE N'class%'
       OR p.[key] LIKE N'booking%' OR p.[key] LIKE N'attendance%' OR p.[key] LIKE N'meeting%'
       OR p.[key] LIKE N'availability%'
    ORDER BY p.[key];
  `);
  const described = new Map(
    PERMISSION_CATALOGUE.map((entry) => [entry.key as string, entry.description]),
  );
  const compiled = new Set<string>(PLATFORM_ADMINISTRATOR_PERMISSIONS);
  const gated = new Set<string>(EXTERNALLY_GATED_PERMISSIONS);
  const expectedKeys = [...CLASSES_PERMISSIONS, TEACHING_PERMISSION].sort();
  if (
    permissions.map((row) => row.key).join(',') !== expectedKeys.join(',') ||
    !CLASSES_PERMISSIONS.every((key) => compiled.has(key) && !gated.has(key)) ||
    compiled.has(TEACHING_PERMISSION) ||
    !gated.has(TEACHING_PERMISSION) ||
    permissions.some(
      (row) =>
        row.description !== described.get(row.key) ||
        Number(row.bundled) !== (row.key === TEACHING_PERMISSION ? 0 : 1) ||
        Number(row.held) !== (row.key === TEACHING_PERMISSION ? 0 : 1) ||
        Number(row.holders) !== 0,
    )
  )
    fail(
      `The live-class vocabulary must be exactly ${expectedKeys.join(', ')}, described as ` +
        `the compiled catalogue describes them, the two class keys each bundled once into the ` +
        `protected role and held by no other, and ${TEACHING_PERMISSION} externally gated, ` +
        `bundled into no role and held by nobody; found ${JSON.stringify(permissions)}.`,
    );

  const provisioning = await session.query<{
    actorType: string;
    actorId: string | null;
    targetType: string;
    roleKey: string | null;
    afterState: string | null;
    authorisingSource: string | null;
  }>(`
    SELECT a.[actorType], a.[actorId], a.[targetType], r.[key] AS [roleKey], a.[afterState], a.[authorisingSource]
    FROM [dbo].[AuditLog] a LEFT JOIN [dbo].[Role] r ON r.[id] = a.[targetId]
    WHERE a.[action] = N'learning.classes.permissions.provisioned';
  `);
  if (
    JSON.stringify(provisioning) !==
    JSON.stringify([
      {
        actorType: 'migration',
        actorId: null,
        targetType: 'role',
        roleKey: 'platform-administrator',
        afterState: '{"added":"learning.classes.administer learning.classes.read"}',
        authorisingSource: CLASSES_MIGRATION,
      },
    ])
  )
    fail(
      `Extending the protected bundle must leave exactly one provisioning record naming the ` +
        `two class keys and this migration; found ${JSON.stringify(provisioning)}.`,
    );

  // Once Phase 26 is rolled back the database's bundle lacks the two Membership
  // keys the compiled bundle now carries.
  const bundled = await assertProtectedBundleExcludesGated(session);
  const compiledBundle = compiledBundleAt(
    stage === 'deploy' || stage === 're-deploy' ? 'current' : stage,
  ).length;
  if (bundled !== compiledBundle)
    fail(
      `The protected bundle holds ${String(bundled)} keys; the compiled bundle holds ` +
        `${String(compiledBundle)} at ${stage}.`,
    );

  report(
    'classes schema',
    'seven empty tables of the reviewed shape and NO activation, thirteen unique keys with ' +
      'two filtered claims, fifteen trusted NO ACTION keys, 9 CHECKs, seven triggers raising ' +
      `51280–51292, no procedure, two bundled class keys provisioned once, ` +
      `${TEACHING_PERMISSION} gated and held by nobody, ${String(bundled)} bundled`,
  );
}

/**
 * After the Phase-23 rollback: no live-class table, trigger, key, CHECK or
 * index, no class or teaching permission, bundle entry or provisioning record,
 * nothing referencing Identity's RoleAssignment or Learning's trial request —
 * and the protected bundle the compiled bundle less the two class keys.
 * Identity's RoleAssignment itself is whole, its live-assignment claim still
 * filtered. The caller then proves the owners the slice referenced are intact.
 */
async function assertClassesRemoved(session: SqlSession): Promise<void> {
  const names = CLASSES_TABLES.map((table) => `N'${table}'`).join(',');
  const triggerNames = Object.keys(CLASSES_TRIGGER_NUMBERS)
    .map((name) => `N'${name}'`)
    .join(',');
  const keys = [...CLASSES_PERMISSIONS, TEACHING_PERMISSION]
    .map((key) => `N'${key}'`)
    .join(',');
  const [row] = await session.query<Record<string, number>>(`
    SELECT
      (SELECT COUNT(*) FROM sys.tables WHERE [name] IN (${names})) AS [tables],
      (SELECT COUNT(*) FROM sys.triggers WHERE [name] IN (${triggerNames})) AS [triggers],
      (SELECT COUNT(*) FROM sys.foreign_keys
        WHERE LEFT([name], CHARINDEX(N'_', [name] + N'_') - 1) IN (${names})) AS [keys],
      (SELECT COUNT(*) FROM sys.check_constraints
        WHERE LEFT([name], CHARINDEX(N'_', [name] + N'_') - 1) IN (${names})) AS [checks],
      (SELECT COUNT(*) FROM sys.indexes
        WHERE LEFT([name], CHARINDEX(N'_', [name] + N'_') - 1) IN (${names})) AS [indexes],
      (SELECT COUNT(*) FROM sys.foreign_keys
        WHERE [referenced_object_id] IN (OBJECT_ID(N'[dbo].[RoleAssignment]'), OBJECT_ID(N'[dbo].[TrialClassRequest]'))) AS [references],
      (SELECT COUNT(*) FROM [dbo].[Permission] WHERE [key] IN (${keys})) AS [permissions],
      (SELECT COUNT(*) FROM [dbo].[RolePermission] WHERE [permissionKey] IN (${keys})) AS [bundled],
      (SELECT COUNT(*) FROM [dbo].[AuditLog] WHERE [action] = N'learning.classes.permissions.provisioned') AS [audit],
      (SELECT 1 - COUNT(*) FROM sys.indexes
        WHERE [object_id] = OBJECT_ID(N'[dbo].[RoleAssignment]')
          AND [name] = N'RoleAssignment_userId_roleId_live_key' AND [is_unique] = 1 AND [has_filter] = 1) AS [identityBroken];
  `);
  if (Object.values(row ?? { missing: 1 }).some((value) => Number(value) !== 0))
    fail(
      `The Phase-23 rollback left a live-class object: ${JSON.stringify(row ?? null)}.`,
    );
  if (await classesPresent(session))
    fail('The Phase-23 rollback left the live-class schema in place.');
  const bundled = await assertProtectedBundleExcludesGated(session);
  const expected = compiledBundleAt('before-classes').length;
  if (
    bundled !== expected ||
    expected !==
      PLATFORM_ADMINISTRATOR_PERMISSIONS.length -
        CLASSES_PERMISSIONS.length -
        MEMBERSHIP_PERMISSIONS.length -
        DONATIONS_BUNDLED.length -
        MIGRATION_BUNDLED.length
  )
    fail(
      `After the Phase-23 rollback the protected bundle holds ${String(bundled)} keys; the ` +
        `compiled bundle less the two class, two Membership, two bundled Donations and two ` +
        `bundled Migration keys ` +
        `holds ${String(expected)}.`,
    );
  report(
    'classes rollback',
    `every live-class table, key, index, CHECK, trigger, permission and provisioning record ` +
      `removed, RoleAssignment whole; ${String(bundled)} keys still bundled`,
  );
}

/**
 * Phase 23 — THE RULES, proved as behaviour against the re-deployed schema
 * with NON_LEARNING_FIXTURE sentinels only, through the migration login (the
 * runtime's own posture is `db:test:permissions`'s):
 *
 *   - FAIL CLOSED: before any activation row exists, a window and a scheduled
 *     session are refused (51281) while a session may still be inserted
 *     closed; the fixture activation then written is immutable (51280), single
 *     and, when approved, evidenced (…_ck). A Booking's own 51281 and the
 *     cancellation of a scheduled session while not activated cannot be
 *     reached as behaviour — each needs a window or a scheduled session, which
 *     cannot exist before the activation that cannot be removed — so they are
 *     proved by the trigger bodies' numbers in `assertClassesFoundation`;
 *   - a scope is typed and live when made (51282): never on a self-paced
 *     Course, under a revoked assignment, under another account's assignment
 *     or under a role without `teaching.perform`; its identity never changes
 *     and an ended scope stays ended; one current scope per account and Course
 *     (the filtered key), an ended one beside it;
 *   - a window needs live `teaching.perform` (51284), never overlaps another
 *     open window of the same teacher (51283) while adjacent ones may touch,
 *     and its times, owner and withdrawal never change (51283);
 *   - a session needs a published live Course and a current scope of THAT
 *     Course (51285, and the composite key for a scope of another Course);
 *     a terminal session never changes or returns (51286); one teacher's
 *     scheduled sessions never overlap (51287) while a cancelled one blocks
 *     nothing; a meeting address only with its provider, only on
 *     `meet.google.com` in lower case, never once terminal, and a reminder
 *     only before the start (…_ck);
 *   - a Booking fits exactly (51288): the request's learner, a TRIAL session
 *     of its Course, the session teacher's open window at the session's own
 *     times; its identity never changes and cancelled is final; one live claim
 *     per window (the filtered key) and a cancelled claim frees it;
 *   - attendance only on an open session for the Booking's learner or an
 *     enrolled learner (51289), re-marked but never re-keyed;
 *   - an intent is relayed or abandoned once and never reopened or re-keyed
 *     (51292);
 *   - nothing cascades: a request under its Booking, a scope under its
 *     session, an assignment under its scope and a window under its Booking
 *     are never deleted.
 *
 * Every row the proofs write except the immutable activation is removed at the
 * end, children first, which shows the slice can be emptied without a cascade;
 * the synthetic Courses, roles and accounts go with them.
 */
async function assertClassesRules(session: SqlSession): Promise<void> {
  const run = randomUUID().replaceAll('-', '').slice(0, 16);
  const day = '2026-10-07';
  const at = `${day}T00:00:00`;
  let refusals = 0;
  const refuse = async (
    label: string,
    statement: string,
    numbers: readonly number[],
    rule: string,
  ): Promise<void> => {
    await expectRefusal(session, label, statement, numbers, rule);
    refusals += 1;
  };
  const count = async (statement: string): Promise<number> => {
    const [row] = await session.query<{ total: number }>(statement);
    return Number(row?.total ?? -1);
  };
  const slug = (label: string): string => `non-learning-fixture-classes-${label}-${run}`;
  const instant = (hour: string): string => `'${day}T${hour}:00'`;
  const local = (hour: string): string => `N'${day}T${hour}'`;

  // ---- the accounts, the roles and the assignments the proofs name ---------------
  const teacher = randomUUID();
  const otherTeacher = randomUUID();
  const revokedTeacher = randomUUID();
  const learner = randomUUID();
  const outsider = randomUUID();
  const second = randomUUID();
  const users = [
    [teacher, 'teacher'],
    [otherTeacher, 'other-teacher'],
    [revokedTeacher, 'revoked-teacher'],
    [learner, 'learner'],
    [outsider, 'outsider'],
    [second, 'second'],
  ] as const;
  for (const [user, label] of users)
    await session.query(
      `INSERT INTO [dbo].[User] ([id],[name],[email],[emailVerified],[createdAt],[updatedAt],[locale],[status],[twoFactorEnabled]) VALUES (N'${user}',N'NON_LEARNING_FIXTURE ${label}',N'${label}-${run}@classes-proof.invalid',0,SYSUTCDATETIME(),SYSUTCDATETIME(),N'en',N'active',0);`,
    );
  const teachingRole = randomUUID();
  const plainRole = randomUUID();
  const raTeacher = randomUUID();
  const raOther = randomUUID();
  const raRevoked = randomUUID();
  const raPlain = randomUUID();
  await expectAccepted(
    session,
    'A synthetic teaching role, a plain role and their assignments',
    `INSERT INTO [dbo].[Role] ([id],[key],[name],[description],[system]) VALUES
       (N'${teachingRole}',N'non-learning-fixture-teaching-${run}',N'NON_LEARNING_FIXTURE teaching role',N'Synthetic proof role.',0),
       (N'${plainRole}',N'non-learning-fixture-plain-${run}',N'NON_LEARNING_FIXTURE plain role',N'Synthetic proof role.',0);
     INSERT INTO [dbo].[RolePermission] ([roleId],[permissionKey]) VALUES (N'${teachingRole}',N'${TEACHING_PERMISSION}');
     INSERT INTO [dbo].[RoleAssignment] ([id],[userId],[roleId],[grantedAt],[revokedAt]) VALUES
       (N'${raTeacher}',N'${teacher}',N'${teachingRole}','${at}',NULL),
       (N'${raOther}',N'${otherTeacher}',N'${teachingRole}','${at}',NULL),
       (N'${raRevoked}',N'${revokedTeacher}',N'${teachingRole}','${at}','${at}'),
       (N'${raPlain}',N'${teacher}',N'${plainRole}','${at}',NULL);`,
  );

  // ---- three Courses: a published live one, a published self-paced one, a draft --
  const live = randomUUID();
  const paced = randomUUID();
  const draft = randomUUID();
  const course = (id: string, label: string, format: 'live' | 'self-paced'): string => {
    const moduleId = randomUUID();
    const lessonId = randomUUID();
    return `INSERT INTO [dbo].[Course] ([id],[slug],[primaryLocale],[state],[level],[format],[languageCode],[publishedAt],[version],[updatedAt]) VALUES (N'${id}',N'${slug(label)}',N'en',N'draft',NULL,N'${format}',N'en',NULL,1,'${at}');
     INSERT INTO [dbo].[CourseLabel] ([courseId],[locale],[title],[summary],[description]) VALUES (N'${id}',N'en',N'NON_LEARNING_FIXTURE course',N'NON_LEARNING_FIXTURE summary',N'NON_LEARNING_FIXTURE description');
     INSERT INTO [dbo].[CourseModule] ([id],[courseId],[position]) VALUES (N'${moduleId}',N'${id}',0);
     INSERT INTO [dbo].[CourseModuleLabel] ([moduleId],[locale],[title],[summary]) VALUES (N'${moduleId}',N'en',N'NON_LEARNING_FIXTURE module',N'NON_LEARNING_FIXTURE summary');
     INSERT INTO [dbo].[Lesson] ([id],[courseId],[moduleId],[position]) VALUES (N'${lessonId}',N'${id}',N'${moduleId}',0);
     INSERT INTO [dbo].[LessonLabel] ([lessonId],[locale],[title],[summary],[body]) VALUES (N'${lessonId}',N'en',N'NON_LEARNING_FIXTURE lesson',N'NON_LEARNING_FIXTURE summary',N'NON_LEARNING_FIXTURE body');`;
  };
  await expectAccepted(
    session,
    'Three complete Courses, two of them published',
    `${course(live, 'live', 'live')}
     ${course(paced, 'paced', 'self-paced')}
     ${course(draft, 'draft', 'live')}
     UPDATE [dbo].[Course] SET [state]=N'published',[publishedAt]='${at}',[version]=2,[updatedAt]='${at}' WHERE [id] IN (N'${live}',N'${paced}');`,
  );

  // ---- a scope is typed and live when made (51282) ---------------------------------
  const scope = (
    id: string,
    courseId: string,
    userId: string,
    assignment: string,
    ended = false,
  ): string =>
    `INSERT INTO [dbo].[CourseTeachingAssignment] ([id],[courseId],[userId],[roleAssignmentId],[grantedAt],[grantedById],[endedAt],[endedById]) VALUES (N'${id}',N'${courseId}',N'${userId}',N'${assignment}','${at}',NULL,${ended ? `'${at}'` : 'NULL'},NULL);`;
  const TYPED = 'live Course and the account';
  await refuse(
    'A scope on a self-paced Course',
    scope(randomUUID(), paced, teacher, raTeacher),
    [51282],
    TYPED,
  );
  await refuse(
    'A scope under a revoked assignment',
    scope(randomUUID(), live, revokedTeacher, raRevoked),
    [51282],
    TYPED,
  );
  await refuse(
    "A scope under another account's assignment",
    scope(randomUUID(), live, otherTeacher, raTeacher),
    [51282],
    TYPED,
  );
  await refuse(
    'A scope under a role without teaching.perform',
    scope(randomUUID(), live, teacher, raPlain),
    [51282],
    TYPED,
  );
  const scopeTeacher = randomUUID();
  const scopeOther = randomUUID();
  const scopeDraft = randomUUID();
  const scopeEnded = randomUUID();
  // An ended scope on a Course where its account holds NO current one, so
  // un-ending it reaches the trigger rather than the filtered claim.
  const scopeEndedAlone = randomUUID();
  await expectAccepted(
    session,
    'Current scopes for two teachers on the live Course, one on the draft, two already ended',
    `${scope(scopeTeacher, live, teacher, raTeacher)}
     ${scope(scopeOther, live, otherTeacher, raOther)}
     ${scope(scopeDraft, draft, teacher, raTeacher)}
     ${scope(scopeEnded, live, teacher, raTeacher, true)}
     ${scope(scopeEndedAlone, draft, otherTeacher, raOther, true)}`,
  );
  await refuse(
    'A second current scope for one account and Course',
    scope(randomUUID(), live, teacher, raTeacher),
    [2601],
    'CourseTeachingAssignment_current_key',
  );
  // A one-current-scope collision is the filtered key's refusal above; these
  // two rewrite nothing that key covers, so each reaches the trigger itself.
  await refuse(
    "A scope's assignment rewritten",
    `UPDATE [dbo].[CourseTeachingAssignment] SET [roleAssignmentId]=N'${raPlain}' WHERE [id]=N'${scopeTeacher}';`,
    [51282],
    'identity cannot change',
  );
  await refuse(
    "A scope's grant instant rewritten",
    `UPDATE [dbo].[CourseTeachingAssignment] SET [grantedAt]=DATEADD(minute,-1,[grantedAt]) WHERE [id]=N'${scopeTeacher}';`,
    [51282],
    'identity cannot change',
  );
  await refuse(
    'An ended scope un-ended',
    `UPDATE [dbo].[CourseTeachingAssignment] SET [endedAt]=NULL WHERE [id]=N'${scopeEndedAlone}';`,
    [51282],
    'ended scope stays ended',
  );

  // ---- fail closed: nothing is offered or scheduled before activation (51281) ------
  const window = (
    id: string,
    userId: string,
    from: string,
    to: string,
    state: 'open' | 'withdrawn' = 'open',
  ): string =>
    `INSERT INTO [dbo].[Availability] ([id],[userId],[startsAt],[endsAt],[timeZone],[startsLocal],[endsLocal],[state]) VALUES (N'${id}',N'${userId}',${instant(from)},${instant(to)},N'Europe/London',${local(from)},${local(to)},N'${state}');`;
  const classSession = (
    id: string,
    courseId: string,
    kind: 'course' | 'trial',
    scopeId: string,
    from: string,
    to: string,
    options: {
      state?: 'scheduled' | 'completed' | 'cancelled';
      meeting?: string | null;
      provider?: string | null;
      reminder?: string | null;
    } = {},
  ): string => {
    const state = options.state ?? 'scheduled';
    const meeting =
      options.meeting === undefined || options.meeting === null
        ? 'NULL'
        : `N'${options.meeting}'`;
    const provider =
      options.provider === undefined
        ? options.meeting === undefined || options.meeting === null
          ? 'NULL'
          : "N'google-meet'"
        : options.provider === null
          ? 'NULL'
          : `N'${options.provider}'`;
    const reminder =
      options.reminder === undefined || options.reminder === null
        ? 'NULL'
        : instant(options.reminder);
    const closed = state === 'scheduled' ? 'NULL' : instant(to);
    return `INSERT INTO [dbo].[ClassSession] ([id],[courseId],[kind],[scopeId],[startsAt],[endsAt],[timeZone],[startsLocal],[endsLocal],[state],[meetingProvider],[meetingUrl],[reminderAt],[closedAt]) VALUES (N'${id}',N'${courseId}',N'${kind}',N'${scopeId}',${instant(from)},${instant(to)},N'Europe/London',${local(from)},${local(to)},N'${state}',${provider},${meeting},${reminder},${closed});`;
  };
  const OFF = 'not activated';
  const windowOne = randomUUID();
  await refuse(
    'A window before activation',
    window(windowOne, teacher, '09:00', '10:00'),
    [51281],
    OFF,
  );
  await refuse(
    'A scheduled session before activation',
    classSession(randomUUID(), live, 'trial', scopeTeacher, '09:00', '10:00'),
    [51281],
    OFF,
  );
  const cancelledEarly = randomUUID();
  await expectAccepted(
    session,
    'A session inserted already cancelled before activation — closing is never gated',
    classSession(cancelledEarly, live, 'course', scopeTeacher, '15:00', '16:00', {
      state: 'cancelled',
    }),
  );
  if (
    (await count('SELECT COUNT(*) AS [total] FROM [dbo].[LiveLearningActivation];')) !== 0
  )
    fail('The live-class rules must start with no activation row.');

  // ---- the fixture activation: single, evidenced when approved, immutable (51280) --
  await refuse(
    'A second activation row',
    "INSERT INTO [dbo].[LiveLearningActivation] ([id],[authority],[authorisedBy],[reference]) VALUES (2,N'fixture',N'NON_LEARNING_FIXTURE operator',NULL);",
    [547],
    'LiveLearningActivation_ck',
  );
  await refuse(
    'An approved activation without evidence',
    "INSERT INTO [dbo].[LiveLearningActivation] ([id],[authority],[authorisedBy],[reference]) VALUES (1,N'approved',N'NON_LEARNING_FIXTURE operator',NULL);",
    [547],
    'LiveLearningActivation_evidence_ck',
  );
  await expectAccepted(
    session,
    'The fixture activation',
    "INSERT INTO [dbo].[LiveLearningActivation] ([id],[authority],[authorisedBy],[reference]) VALUES (1,N'fixture',N'NON_LEARNING_FIXTURE operator',NULL);",
  );
  await refuse(
    'The activation re-labelled',
    "UPDATE [dbo].[LiveLearningActivation] SET [authority]=N'approved',[reference]=N'urn:example:forged' WHERE [id]=1;",
    [51280],
    'immutable',
  );
  await refuse(
    'The activation removed',
    'DELETE FROM [dbo].[LiveLearningActivation] WHERE [id]=1;',
    [51280],
    'immutable',
  );

  // ---- windows: live teaching.perform (51284), no overlap, nothing rewritten (51283)
  const windowTwo = randomUUID();
  const windowFive = randomUUID();
  const windowWithdrawn = randomUUID();
  const otherWindowOne = randomUUID();
  const otherWindowTwo = randomUUID();
  await expectAccepted(
    session,
    'Adjacent open windows for two teachers, and one withdrawn',
    `${window(windowOne, teacher, '09:00', '10:00')}
     ${window(windowTwo, teacher, '10:00', '11:00')}
     ${window(windowFive, teacher, '11:00', '12:00')}
     ${window(windowWithdrawn, teacher, '13:00', '14:00', 'withdrawn')}
     ${window(otherWindowOne, otherTeacher, '09:00', '10:00')}
     ${window(otherWindowTwo, otherTeacher, '10:00', '11:00')}`,
  );
  await refuse(
    "A window overlapping the teacher's open one",
    window(randomUUID(), teacher, '09:30', '10:30'),
    [51283],
    'cannot overlap',
  );
  await refuse(
    'A window by an account without teaching.perform',
    window(randomUUID(), learner, '09:00', '10:00'),
    [51284],
    'live teaching.perform',
  );
  await refuse(
    'A window by a revoked teacher',
    window(randomUUID(), revokedTeacher, '09:00', '10:00'),
    [51284],
    'live teaching.perform',
  );
  await refuse(
    'A window of fourteen minutes',
    window(randomUUID(), teacher, '16:00', '16:14'),
    [547],
    'Availability_ck',
  );
  await refuse(
    'A withdrawn window reopened',
    `UPDATE [dbo].[Availability] SET [state]=N'open' WHERE [id]=N'${windowWithdrawn}';`,
    [51283],
    'withdrawn window stays withdrawn',
  );
  await refuse(
    "A window's times rewritten",
    `UPDATE [dbo].[Availability] SET [startsAt]=${instant('08:00')},[startsLocal]=${local('08:00')} WHERE [id]=N'${windowOne}';`,
    [51283],
    'cannot change',
  );

  // ---- sessions: a published live Course under a current scope OF THAT COURSE -----
  const trialOne = randomUUID();
  const trialOther = randomUUID();
  const courseOne = randomUUID();
  const courseDone = randomUUID();
  const courseLate = randomUUID();
  const MEET = 'https://meet.google.com/abc-defg-hij';
  const SCOPED = 'current teaching scope';
  await refuse(
    'A session on a draft Course',
    classSession(randomUUID(), draft, 'course', scopeDraft, '09:00', '10:00'),
    [51285],
    SCOPED,
  );
  await refuse(
    'A session under an ended scope',
    classSession(randomUUID(), live, 'course', scopeEnded, '09:00', '10:00'),
    [51285],
    SCOPED,
  );
  await refuse(
    "A session of one Course under another Course's scope",
    classSession(randomUUID(), paced, 'course', scopeTeacher, '09:00', '10:00'),
    [547],
    'ClassSession_scope_fkey',
  );
  await refuse(
    'A meeting address without its provider',
    classSession(randomUUID(), live, 'trial', scopeTeacher, '09:00', '10:00', {
      meeting: MEET,
      provider: null,
    }),
    [547],
    'ClassSession_ck',
  );
  await refuse(
    'A meeting address off meet.google.com',
    classSession(randomUUID(), live, 'trial', scopeTeacher, '09:00', '10:00', {
      meeting: 'https://meet.example.com/abc-defg-hij',
    }),
    [547],
    'ClassSession_meeting_ck',
  );
  await refuse(
    'A meeting address in upper case',
    classSession(randomUUID(), live, 'trial', scopeTeacher, '09:00', '10:00', {
      meeting: 'https://meet.google.com/ABC-DEFG-HIJ',
    }),
    [547],
    'ClassSession_meeting_ck',
  );
  await refuse(
    'A reminder after the start',
    classSession(randomUUID(), live, 'course', scopeTeacher, '11:00', '12:00', {
      reminder: '11:30',
    }),
    [547],
    'ClassSession_ck',
  );
  await expectAccepted(
    session,
    "A trial session with its meeting address, the other teacher's trial, and two Course sessions",
    `${classSession(trialOne, live, 'trial', scopeTeacher, '09:00', '10:00', { meeting: MEET })}
     ${classSession(trialOther, live, 'trial', scopeOther, '09:00', '10:00')}
     ${classSession(courseOne, live, 'course', scopeTeacher, '11:00', '12:00', { reminder: '10:30' })}
     ${classSession(courseDone, live, 'course', scopeTeacher, '12:00', '13:00')}`,
  );
  await refuse(
    "A session overlapping the teacher's scheduled one",
    classSession(randomUUID(), live, 'trial', scopeTeacher, '09:30', '10:30'),
    [51287],
    'cannot overlap',
  );
  await expectAccepted(
    session,
    'A session over the hour of a cancelled one — a cancelled session blocks nothing',
    classSession(courseLate, live, 'course', scopeTeacher, '15:00', '16:00'),
  );
  await expectAccepted(
    session,
    'A scheduled session moved, re-addressed and completed',
    `UPDATE [dbo].[ClassSession] SET [startsAt]=${instant('15:30')},[startsLocal]=${local('15:30')},[version]=2 WHERE [id]=N'${courseLate}';
     UPDATE [dbo].[ClassSession] SET [meetingProvider]=N'google-meet',[meetingUrl]=N'${MEET}',[version]=3 WHERE [id]=N'${courseLate}';
     UPDATE [dbo].[ClassSession] SET [state]=N'completed',[closedAt]=${instant('13:00')},[version]=2 WHERE [id]=N'${courseDone}';`,
  );
  await refuse(
    'A completed session with a meeting address',
    `UPDATE [dbo].[ClassSession] SET [state]=N'completed',[closedAt]=${instant('16:00')} WHERE [id]=N'${courseLate}';`,
    [547],
    'ClassSession_ck',
  );
  const FINAL = 'cannot change or return';
  await refuse(
    'A completed session moved',
    `UPDATE [dbo].[ClassSession] SET [startsAt]=${instant('12:30')},[startsLocal]=${local('12:30')} WHERE [id]=N'${courseDone}';`,
    [51286],
    FINAL,
  );
  await refuse(
    'A cancelled session returned to scheduled',
    `UPDATE [dbo].[ClassSession] SET [state]=N'scheduled',[closedAt]=NULL WHERE [id]=N'${cancelledEarly}';`,
    [51286],
    FINAL,
  );
  await refuse(
    "A session's kind rewritten",
    `UPDATE [dbo].[ClassSession] SET [kind]=N'course' WHERE [id]=N'${trialOne}';`,
    [51286],
    'never change',
  );

  // ---- a Booking fits exactly (51288), claims one window (filtered key) ------------
  const requestLearner = randomUUID();
  const requestOutsider = randomUUID();
  const requestSecond = randomUUID();
  await expectAccepted(
    session,
    'Three trial requests on the live Course, and one enrolment',
    `INSERT INTO [dbo].[TrialClassRequest] ([id],[userId],[courseId],[requestedAt]) VALUES
       (N'${requestLearner}',N'${learner}',N'${live}','${at}'),
       (N'${requestOutsider}',N'${outsider}',N'${live}','${at}'),
       (N'${requestSecond}',N'${second}',N'${live}','${at}');
     INSERT INTO [dbo].[Enrolment] ([userId],[courseId],[enrolledAt]) VALUES (N'${learner}',N'${live}','${at}');`,
  );
  const booking = (
    id: string,
    requestId: string,
    userId: string,
    sessionId: string,
    windowId: string,
  ): string =>
    `INSERT INTO [dbo].[Booking] ([id],[requestId],[userId],[courseId],[sessionId],[availabilityId],[state],[confirmedAt],[confirmedById]) VALUES (N'${id}',N'${requestId}',N'${userId}',N'${live}',N'${sessionId}',N'${windowId}',N'confirmed','${at}',NULL);`;
  const FIT = 'must fit';
  await refuse(
    "A Booking for someone other than the request's learner",
    booking(randomUUID(), requestLearner, outsider, trialOne, windowOne),
    [51288],
    FIT,
  );
  await refuse(
    'A Booking on a Course session',
    booking(randomUUID(), requestOutsider, outsider, courseOne, windowFive),
    [51288],
    FIT,
  );
  await refuse(
    "A Booking on another teacher's window",
    booking(randomUUID(), requestOutsider, outsider, trialOther, windowOne),
    [51288],
    FIT,
  );
  await refuse(
    'A Booking on a window at other times',
    booking(randomUUID(), requestOutsider, outsider, trialOther, otherWindowTwo),
    [51288],
    FIT,
  );
  const bookingLearner = randomUUID();
  const bookingOutsider = randomUUID();
  await expectAccepted(
    session,
    'Two Bookings, each on its own trial session and window',
    `${booking(bookingLearner, requestLearner, learner, trialOne, windowOne)}
     ${booking(bookingOutsider, requestOutsider, outsider, trialOther, otherWindowOne)}`,
  );
  const trialThird = randomUUID();
  await expectAccepted(
    session,
    "A second trial session at the first window's hour, inserted cancelled",
    classSession(trialThird, live, 'trial', scopeTeacher, '09:00', '10:00', {
      state: 'cancelled',
    }),
  );
  await refuse(
    'A second live claim on one window',
    booking(randomUUID(), requestSecond, second, trialThird, windowOne),
    [2601],
    'Booking_slot_key',
  );
  await refuse(
    'A Booking cancelled without its instant',
    `UPDATE [dbo].[Booking] SET [state]=N'cancelled' WHERE [id]=N'${bookingOutsider}';`,
    [547],
    'Booking_ck',
  );
  await expectAccepted(
    session,
    'A Booking cancelled',
    `UPDATE [dbo].[Booking] SET [state]=N'cancelled',[cancelledAt]='${at}',[version]=2 WHERE [id]=N'${bookingOutsider}';`,
  );
  await refuse(
    'A cancelled Booking confirmed again',
    `UPDATE [dbo].[Booking] SET [state]=N'confirmed',[cancelledAt]=NULL WHERE [id]=N'${bookingOutsider}';`,
    [51288],
    'final',
  );
  await refuse(
    "A Booking's window rewritten",
    `UPDATE [dbo].[Booking] SET [availabilityId]=N'${windowTwo}' WHERE [id]=N'${bookingLearner}';`,
    [51288],
    'never changes',
  );
  const trialFreed = randomUUID();
  const bookingSecond = randomUUID();
  await expectAccepted(
    session,
    'A cancelled claim frees its window for another request',
    `${classSession(trialFreed, live, 'trial', scopeOther, '09:00', '10:00', { state: 'cancelled' })}
     ${booking(bookingSecond, requestSecond, second, trialFreed, otherWindowOne)}`,
  );

  // ---- attendance (51289): an open session, an eligible participant, never re-keyed
  const mark = (sessionId: string, userId: string): string =>
    `INSERT INTO [dbo].[Attendance] ([sessionId],[userId],[status],[markedAt],[markedById]) VALUES (N'${sessionId}',N'${userId}',N'present','${at}',N'${teacher}');`;
  const ELIGIBLE = 'eligible participant';
  await refuse(
    "Attendance for someone other than the trial's learner",
    mark(trialOne, outsider),
    [51289],
    ELIGIBLE,
  );
  await refuse(
    'Attendance for a learner not enrolled on the Course',
    mark(courseOne, outsider),
    [51289],
    ELIGIBLE,
  );
  await refuse(
    'Attendance on a cancelled session',
    mark(cancelledEarly, learner),
    [51289],
    ELIGIBLE,
  );
  await refuse(
    'An attendance mark outside the vocabulary',
    `INSERT INTO [dbo].[Attendance] ([sessionId],[userId],[status],[markedAt],[markedById]) VALUES (N'${trialOne}',N'${learner}',N'late','${at}',NULL);`,
    [547],
    'Attendance_ck',
  );
  await expectAccepted(
    session,
    'Attendance for the trial learner and for an enrolled learner, then re-marked',
    `${mark(trialOne, learner)}
     ${mark(courseOne, learner)}
     UPDATE [dbo].[Attendance] SET [status]=N'absent',[markedAt]='${at}' WHERE [sessionId]=N'${courseOne}' AND [userId]=N'${learner}';`,
  );
  // Any UPDATE touching a key column is a re-key, refused before eligibility
  // is even asked — a lone re-key as well as one beside a kept mark, and a
  // move to another session as well as to another person. (The runtime cannot
  // attempt any of them: its UPDATE on `sessionId` and `userId` is denied by
  // column.)
  await refuse(
    'A lone attendance mark re-keyed to another account',
    `UPDATE [dbo].[Attendance] SET [userId]=N'${outsider}' WHERE [sessionId]=N'${trialOne}' AND [userId]=N'${learner}';`,
    [51289],
    'never re-keyed',
  );
  await refuse(
    'A lone attendance mark moved to another session',
    `UPDATE [dbo].[Attendance] SET [sessionId]=N'${cancelledEarly}' WHERE [sessionId]=N'${trialOne}' AND [userId]=N'${learner}';`,
    [51289],
    'never re-keyed',
  );
  await refuse(
    'An attendance mark re-keyed beside a kept one',
    `UPDATE [dbo].[Attendance] SET [userId]=CASE WHEN [sessionId]=N'${trialOne}' THEN N'${outsider}' ELSE [userId] END WHERE [userId]=N'${learner}';`,
    [51289],
    'never re-keyed',
  );

  // ---- an intent is relayed or abandoned once, never reopened or re-keyed (51292) --
  const intentConfirmed = randomUUID();
  const intentReminder = randomUUID();
  await expectAccepted(
    session,
    'Two pending intents, one relayed and one abandoned',
    `INSERT INTO [dbo].[ClassCommunicationIntent] ([id],[purpose],[sessionId],[userId],[dueAt],[state],[idempotencyKey]) VALUES
       (N'${intentConfirmed}',N'learning.booking-confirmed',N'${trialOne}',N'${learner}','${at}',N'pending',N'non-learning-fixture-${run}-confirmed'),
       (N'${intentReminder}',N'learning.class-reminder',N'${trialOne}',N'${learner}','${at}',N'pending',N'non-learning-fixture-${run}-reminder');
     UPDATE [dbo].[ClassCommunicationIntent] SET [state]=N'relayed',[relayedAt]='${at}' WHERE [id]=N'${intentConfirmed}';
     UPDATE [dbo].[ClassCommunicationIntent] SET [state]=N'abandoned' WHERE [id]=N'${intentReminder}';`,
  );
  await refuse(
    'An intent relayed without its instant',
    `UPDATE [dbo].[ClassCommunicationIntent] SET [state]=N'relayed',[relayedAt]=NULL WHERE [id]=N'${intentReminder}';`,
    [547],
    'ClassCommunicationIntent_ck',
  );
  const ONCE = 'relayed or abandoned once';
  await refuse(
    'A relayed intent reopened',
    `UPDATE [dbo].[ClassCommunicationIntent] SET [state]=N'pending' WHERE [id]=N'${intentConfirmed}';`,
    [51292],
    ONCE,
  );
  await refuse(
    'An abandoned intent relayed',
    `UPDATE [dbo].[ClassCommunicationIntent] SET [state]=N'relayed',[relayedAt]='${at}' WHERE [id]=N'${intentReminder}';`,
    [51292],
    ONCE,
  );
  await refuse(
    'An intent re-keyed',
    `UPDATE [dbo].[ClassCommunicationIntent] SET [purpose]=N'learning.session-cancelled' WHERE [id]=N'${intentConfirmed}';`,
    [51292],
    ONCE,
  );

  // ---- nothing cascades --------------------------------------------------------------
  const mutableTables = CLASSES_TABLES.filter(
    (table) => table !== 'LiveLearningActivation',
  );
  const classesRows = async (): Promise<number> =>
    count(
      `SELECT (${mutableTables
        .map((table) => `SELECT COUNT_BIG(*) FROM [dbo].[${table}]`)
        .join(') + (')}) AS [total];`,
    );
  const before = await classesRows();
  await refuse(
    'A trial request deleted under its Booking',
    `DELETE FROM [dbo].[TrialClassRequest] WHERE [id]=N'${requestLearner}';`,
    [547],
    'Booking_requestId_fkey',
  );
  await refuse(
    'A scope deleted under its sessions',
    `DELETE FROM [dbo].[CourseTeachingAssignment] WHERE [id]=N'${scopeTeacher}';`,
    [547],
    'ClassSession_scope_fkey',
  );
  await refuse(
    'An assignment deleted under its scope',
    `DELETE FROM [dbo].[RoleAssignment] WHERE [id]=N'${raTeacher}';`,
    [547],
    'CourseTeachingAssignment_roleAssignmentId_fkey',
  );
  await refuse(
    'A window deleted under its Booking',
    `DELETE FROM [dbo].[Availability] WHERE [id]=N'${windowOne}';`,
    [547],
    'Booking_availabilityId_fkey',
  );
  if ((await classesRows()) !== before)
    fail('A refused deletion changed a live-class row.');

  // ---- every fixture row removed, children first, without a cascade -----------------
  const courses = [live, paced, draft].map((id) => `N'${id}'`).join(',');
  const accounts = users.map(([user]) => `N'${user}'`).join(',');
  await expectAccepted(
    session,
    'Every live-class fixture row removed, children first, then its Courses, roles and accounts',
    `DELETE FROM [dbo].[ClassCommunicationIntent] WHERE [userId] IN (${accounts});
     DELETE FROM [dbo].[Attendance] WHERE [userId] IN (${accounts});
     DELETE FROM [dbo].[Booking] WHERE [userId] IN (${accounts});
     DELETE FROM [dbo].[ClassSession] WHERE [courseId] IN (${courses});
     DELETE FROM [dbo].[Availability] WHERE [userId] IN (${accounts});
     DELETE FROM [dbo].[CourseTeachingAssignment] WHERE [courseId] IN (${courses});
     DELETE FROM [dbo].[TrialClassRequest] WHERE [userId] IN (${accounts});
     DELETE FROM [dbo].[Enrolment] WHERE [userId] IN (${accounts});
     UPDATE [dbo].[Course] SET [state]=N'archived',[version]=[version]+1,[updatedAt]='${at}' WHERE [id] IN (N'${live}',N'${paced}');
     DELETE FROM [dbo].[LessonLabel] WHERE [lessonId] IN (SELECT [id] FROM [dbo].[Lesson] WHERE [courseId] IN (${courses}));
     DELETE FROM [dbo].[Lesson] WHERE [courseId] IN (${courses});
     DELETE FROM [dbo].[CourseModuleLabel] WHERE [moduleId] IN (SELECT [id] FROM [dbo].[CourseModule] WHERE [courseId] IN (${courses}));
     DELETE FROM [dbo].[CourseModule] WHERE [courseId] IN (${courses});
     DELETE FROM [dbo].[CourseLabel] WHERE [courseId] IN (${courses});
     DELETE FROM [dbo].[CourseSlugHistory] WHERE [courseId] IN (${courses});
     DELETE FROM [dbo].[Course] WHERE [id] IN (${courses});
     DELETE FROM [dbo].[RoleAssignment] WHERE [roleId] IN (N'${teachingRole}',N'${plainRole}');
     DELETE FROM [dbo].[RolePermission] WHERE [roleId] IN (N'${teachingRole}',N'${plainRole}');
     DELETE FROM [dbo].[Role] WHERE [id] IN (N'${teachingRole}',N'${plainRole}');
     DELETE FROM [dbo].[User] WHERE [id] IN (${accounts});`,
  );
  const [left] = await session.query<{
    classes: number;
    learning: number;
    holders: number;
  }>(`
    SELECT
      (${mutableTables.map((table) => `SELECT COUNT_BIG(*) FROM [dbo].[${table}]`).join(') + (')}) AS [classes],
      (${LEARNING_TABLES.map((table) => `SELECT COUNT_BIG(*) FROM [dbo].[${table}]`).join(') + (')}) AS [learning],
      (SELECT COUNT(*) FROM [dbo].[RolePermission] WHERE [permissionKey] = N'${TEACHING_PERMISSION}') AS [holders];
  `);
  if (
    Number(left?.classes ?? -1) !== 0 ||
    Number(left?.learning ?? -1) !== 0 ||
    Number(left?.holders ?? -1) !== 0
  )
    fail(
      `The live-class rule proofs left a fixture row behind: ${JSON.stringify(left ?? null)}.`,
    );

  report(
    'classes rules',
    `fail closed before activation, immutable activation, typed live scopes, exclusive windows, ` +
      `sessions on current scopes of their own Course, final sessions, fitting Bookings with one ` +
      `live claim per window, eligible attendance, once-only intents, no cascade; ` +
      `${String(refusals)} refusals by name, every text a NON_LEARNING_FIXTURE sentinel, ` +
      `every row but the activation removed`,
  );
}

const MESSAGING_MIGRATION = '20261008000000_phase24_messaging';

/**
 * The two keys Phase 24 catalogues, and only these: both EXTERNALLY GATED,
 * bundled into no role and held by nobody until the organisation names who
 * staffs support and who moderates (OPEN_DECISIONS.md §6.6).
 */
const MESSAGING_PERMISSIONS = ['messaging.moderate', 'messaging.support'];

/**
 * EVERY foreign key from a Phase-24 table, exactly, with its column mapping and
 * its delete action. ALL are NO ACTION: nothing cascades, inside the context or
 * out of it. The external edges are Identity's User, Learning's Course and
 * Storage's Asset; an attachment and a report reach their Message by a
 * composite key that carries the conversation, and a read position its
 * participant by the conversation and the account, so none of them can name a
 * message or a member of another conversation.
 */
const MESSAGING_KEYS = [
  'ConversationParticipant_conversationId_fkey(conversationId>id)>Conversation:NO_ACTION',
  'ConversationParticipant_userId_fkey(userId>id)>User:NO_ACTION',
  'Conversation_courseId_fkey(courseId>id)>Course:NO_ACTION',
  'Conversation_highUserId_fkey(highUserId>id)>User:NO_ACTION',
  'Conversation_lowUserId_fkey(lowUserId>id)>User:NO_ACTION',
  'Conversation_requesterUserId_fkey(requesterUserId>id)>User:NO_ACTION',
  'MessageAttachment_assetId_fkey(assetId>id)>Asset:NO_ACTION',
  'MessageAttachment_conversationId_fkey(conversationId>id)>Conversation:NO_ACTION',
  'MessageAttachment_message_fkey(messageId>id,conversationId>conversationId)>Message:NO_ACTION',
  'MessageAttachment_uploaderUserId_fkey(uploaderUserId>id)>User:NO_ACTION',
  'MessageReadState_participant_fkey(conversationId>conversationId,userId>userId)>ConversationParticipant:NO_ACTION',
  'Message_conversationId_fkey(conversationId>id)>Conversation:NO_ACTION',
  'Message_senderUserId_fkey(senderUserId>id)>User:NO_ACTION',
  'MessagingBlock_blockedUserId_fkey(blockedUserId>id)>User:NO_ACTION',
  'MessagingBlock_blockerUserId_fkey(blockerUserId>id)>User:NO_ACTION',
  'MessagingModerationDecision_moderatorUserId_fkey(moderatorUserId>id)>User:NO_ACTION',
  'MessagingModerationDecision_reportId_fkey(reportId>id)>MessagingReport:NO_ACTION',
  'MessagingReport_conversationId_fkey(conversationId>id)>Conversation:NO_ACTION',
  'MessagingReport_message_fkey(messageId>id,conversationId>conversationId)>Message:NO_ACTION',
  'MessagingReport_reporterUserId_fkey(reporterUserId>id)>User:NO_ACTION',
].sort();

/**
 * Every unique index on a Phase-24 table, exactly: the keys; one membership
 * per account; the order, the operation and the conversation-carrying key of a
 * message; one release token per attachment; one decision per report — and the
 * SEVEN FILTERED claims: one direct conversation per kind, Course and pair, one
 * OPEN support conversation per person, one ACTIVE support claim, one teacher,
 * learner and requester per conversation, an asset attached once, one
 * attachment per place, and one OPEN report per reporter and target.
 */
const MESSAGING_UNIQUE = [
  "ConversationParticipant_claim_key(conversationId) WHERE ([role]=N'support' AND [leftAt] IS NULL)",
  'ConversationParticipant_member_key(conversationId,userId)',
  'ConversationParticipant_pkey(id)',
  "ConversationParticipant_role_key(conversationId,role) WHERE ([role] IN (N'teacher', N'learner', N'requester'))",
  "Conversation_direct_key(kind,courseId,lowUserId,highUserId) WHERE ([kind]<>N'support')",
  'Conversation_pkey(id)',
  "Conversation_support_key(requesterUserId) WHERE ([kind]=N'support' AND [state]=N'open')",
  'MessageAttachment_assetId_key(assetId) WHERE ([assetId] IS NOT NULL)',
  'MessageAttachment_pkey(id)',
  'MessageAttachment_position_key(messageId,position) WHERE ([messageId] IS NOT NULL)',
  'MessageAttachment_releaseToken_key(releaseToken)',
  'MessageReadState_pkey(conversationId,userId)',
  'Message_conversation_key(id,conversationId)',
  'Message_operation_key(conversationId,senderUserId,operationId)',
  'Message_order_key(conversationId,sequence)',
  'Message_pkey(id)',
  'MessagingActivation_pkey(capability)',
  'MessagingBlock_pkey(blockerUserId,blockedUserId)',
  'MessagingModerationDecision_pkey(id)',
  'MessagingModerationDecision_reportId_key(reportId)',
  "MessagingReport_open_key(reporterUserId,conversationId,messageId) WHERE ([state]=N'open')",
  'MessagingReport_pkey(id)',
].sort();

/**
 * Every column of every Phase-24 table, in order. Stated whole so a
 * `targetType`/`relationshipType`/`scopeType` pair, a copied email, name,
 * phone, Course title or address, an age, guardian, retention, strike or ban
 * column, or a presence or typing state cannot arrive unnoticed.
 */
const MESSAGING_COLUMNS: Readonly<Record<string, string>> = {
  MessagingActivation: 'capability,authority,authorisedBy,reference,activatedAt',
  Conversation:
    'id,kind,courseId,lowUserId,highUserId,requesterUserId,state,closedReason,closedAt,disposingAt,lastSequence,activityAt,createdAt,version',
  ConversationParticipant: 'id,conversationId,userId,role,joinedAt,leftAt',
  Message:
    'id,conversationId,sequence,senderUserId,operationId,body,payloadDigest,moderation,withheldAt,sentAt',
  MessageAttachment:
    'id,conversationId,uploaderUserId,releaseToken,state,assetId,messageId,position,mediaType,byteSize,displayName,createdAt,attachedAt',
  MessageReadState: 'conversationId,userId,lastReadSequence,updatedAt',
  MessagingBlock: 'blockerUserId,blockedUserId,createdAt',
  MessagingReport:
    'id,conversationId,messageId,reporterUserId,reason,atSequence,state,createdAt,resolvedAt,version',
  MessagingModerationDecision: 'id,reportId,moderatorUserId,action,decidedAt',
};

/**
 * Storage's Asset as Phase 7 left it, and the ONE column Phase 24 adds: the
 * release digest. No owner, user, conversation or target column arrives.
 */
const ASSET_COLUMNS_BEFORE_MESSAGING =
  'id,storageKey,mediaType,byteSize,checksum,state,rejection,displayName,scanAttempts,createdAt,updatedAt';
const ASSET_COLUMNS_WITH_MESSAGING = `${ASSET_COLUMNS_BEFORE_MESSAGING},releaseDigest`;

/**
 * Whether Phase 24 is applied, ALL OR NOTHING: either every one of its nine
 * tables exists or none does.
 */
async function messagingPresent(session: SqlSession): Promise<boolean> {
  const names = MESSAGING_TABLES.map((table) => `N'${table}'`).join(',');
  const [row] = await session.query<{ present: number }>(
    `SELECT COUNT(*) AS [present] FROM sys.tables WHERE [name] IN (${names});`,
  );
  const present = Number(row?.present ?? -1);
  if (present !== 0 && present !== MESSAGING_TABLES.length)
    fail(
      `Phase 24 is half applied: ${String(present)} of ${String(MESSAGING_TABLES.length)} ` +
        `Messaging tables exist.`,
    );
  return present === MESSAGING_TABLES.length;
}

/**
 * Storage's Asset, described: its columns in order, its unique indexes (with
 * any filter) and its trusted CHECKs. Phase 24 adds exactly the release digest,
 * its filtered unique key and its CHECK, and its rollback removes exactly them.
 */
async function assetShape(session: SqlSession): Promise<{
  columns: string;
  digest: string;
  unique: string;
  checks: string;
}> {
  const [row] = await session.query<{
    columns: string | null;
    digest: string | null;
    unique: string | null;
    checks: string | null;
  }>(`
    SELECT
      (SELECT STRING_AGG(c.[name], N',') WITHIN GROUP (ORDER BY c.[column_id]) FROM sys.columns c
        WHERE c.[object_id] = OBJECT_ID(N'[dbo].[Asset]')) AS [columns],
      (SELECT t.[name] + N'(' + CAST(c.[max_length] / 2 AS NVARCHAR(8)) + N'):' + CAST(c.[is_nullable] AS NVARCHAR(1))
         FROM sys.columns c JOIN sys.types t ON t.[user_type_id] = c.[user_type_id]
        WHERE c.[object_id] = OBJECT_ID(N'[dbo].[Asset]') AND c.[name] = N'releaseDigest') AS [digest],
      (SELECT STRING_AGG(i.[name] + ISNULL(N' WHERE ' + i.[filter_definition], N''), N' | ')
          WITHIN GROUP (ORDER BY i.[name])
         FROM sys.indexes i WHERE i.[object_id] = OBJECT_ID(N'[dbo].[Asset]') AND i.[is_unique] = 1) AS [unique],
      (SELECT STRING_AGG([name] + CASE WHEN [is_disabled] = 0 AND [is_not_trusted] = 0 THEN N'' ELSE N'!' END, N',')
          WITHIN GROUP (ORDER BY [name])
         FROM sys.check_constraints WHERE [parent_object_id] = OBJECT_ID(N'[dbo].[Asset]')) AS [checks];
  `);
  return {
    columns: row?.columns ?? '',
    digest: row?.digest ?? '',
    unique: row?.unique ?? '',
    checks: row?.checks ?? '',
  };
}

/**
 * Phase 24 — what only the catalogue can prove about Messaging:
 *
 *   1. NOTHING IS SEEDED: all nine tables are empty after deploy — and above
 *      all NO activation row, so a migrated database has every kind of
 *      messaging OFF;
 *   2. every column of every table is exactly as stated — no type, target,
 *      scope or relationship column, no copied email, name, phone, address or
 *      Course title, no age, guardian, retention, strike, ban, presence or
 *      typing column (an attachment's own file `displayName` and `mediaType`
 *      aside) — and the unique indexes are exactly the twenty-two above, the
 *      seven claims FILTERED;
 *   3. every foreign key is exactly one of the twenty above, ALL NO ACTION and
 *      trusted: User, Course and Asset the only external edges, a message
 *      reached by attachments and reports through the composite key that
 *      carries its conversation; no other owner references a Messaging table or
 *      holds a conversation, participant, message, moderation or attachment
 *      column;
 *   4. the CHECKs are exactly the eleven named rules, all trusted; the triggers
 *      are exactly the eight in `MESSAGING_TRIGGER_NUMBERS`, enabled, each
 *      raising exactly its own numbers from 51300–51309 on the table it guards;
 *      and Messaging has no procedure;
 *   5. Storage's Asset gained ONLY `releaseDigest` — NVARCHAR(64), nullable —
 *      with its filtered unique key and its trusted CHECK, and nothing that
 *      names an owner;
 *   6. the vocabulary is exactly `messaging.moderate` and `messaging.support`,
 *      described as the compiled catalogue describes them, externally gated,
 *      bundled into NO role and held by NOBODY; no provisioning record exists
 *      (no bundle changed — the Phase-20 precedent); and the protected bundle
 *      is exactly the compiled bundle.
 *
 * The rules themselves are proved as BEHAVIOUR by `assertMessagingRules`, and
 * through the runtime login by `db:test:permissions`.
 */
async function assertMessagingFoundation(
  session: SqlSession,
  stage:
    | 'deploy'
    | 're-deploy'
    | 'before-migration'
    | 'before-donations'
    | 'before-membership' = 'deploy',
): Promise<void> {
  const tables = MESSAGING_TABLES.map((table) => `OBJECT_ID(N'[dbo].[${table}]')`).join(
    ',',
  );
  const names = MESSAGING_TABLES.map((table) => `N'${table}'`).join(',');
  if (!(await messagingPresent(session)))
    fail(`The Phase-24 Messaging tables are missing after ${stage}.`);

  // ---- 1. nothing seeded, and no activation above all ----------------------------
  const counts = await session.query<{ name: string; total: number }>(
    MESSAGING_TABLES.map(
      (table) =>
        `SELECT N'${table}' AS [name], COUNT_BIG(*) AS [total] FROM [dbo].[${table}]`,
    ).join(' UNION ALL ') + ';',
  );
  const seeded = counts.filter((row) => Number(row.total) !== 0);
  if (MESSAGING_TABLES.length !== 9 || counts.length !== 9 || seeded.length > 0)
    fail(
      `The Messaging migration must create nine empty tables and seed nothing — above all ` +
        `no activation, so messaging is OFF; found ${String(counts.length)} tables after ` +
        `${stage}, seeded: ${JSON.stringify(seeded)}.`,
    );

  // ---- 2. exact columns, exact unique indexes with exactly seven filtered ----------
  const shapes = await session.query<{ name: string; columns: string }>(`
    SELECT OBJECT_NAME(c.[object_id]) AS [name],
      STRING_AGG(c.[name], N',') WITHIN GROUP (ORDER BY c.[column_id]) AS [columns]
    FROM sys.columns c WHERE c.[object_id] IN (${tables})
    GROUP BY c.[object_id];
  `);
  const shapeFindings = MESSAGING_TABLES.filter(
    (table) =>
      shapes.find((row) => row.name === table)?.columns !== MESSAGING_COLUMNS[table],
  );
  if (shapes.length !== 9 || shapeFindings.length > 0)
    fail(
      `Messaging columns differ from the reviewed shape in ${shapeFindings.join(', ')}: ` +
        `${JSON.stringify(shapes.filter((row) => shapeFindings.includes(row.name)))}.`,
    );

  const generic = await session.query<{ name: string }>(`
    SELECT OBJECT_NAME(c.[object_id]) + N'.' + c.[name] AS [name] FROM sys.columns c
    WHERE c.[object_id] IN (${tables})
      AND (c.[name] LIKE N'%Type' OR c.[name] LIKE N'%target%' OR c.[name] LIKE N'%entity%'
           OR c.[name] LIKE N'%scope%' OR c.[name] LIKE N'%relationship%' OR c.[name] LIKE N'%email%'
           OR c.[name] LIKE N'%phone%' OR c.[name] LIKE N'%name%' OR c.[name] LIKE N'%title%'
           OR c.[name] LIKE N'%address%' OR c.[name] LIKE N'%guardian%' OR c.[name] LIKE N'%birth%'
           OR c.[name] LIKE N'%adult%' OR c.[name] LIKE N'%retention%' OR c.[name] LIKE N'%strike%'
           OR c.[name] LIKE N'%banned%' OR c.[name] LIKE N'%escalat%' OR c.[name] LIKE N'%vetting%'
           OR c.[name] LIKE N'%presence%' OR c.[name] LIKE N'%typing%' OR c.[name] LIKE N'%socket%'
           OR c.[name] LIKE N'%online%' OR c.[name] LIKE N'%storageKey%')
      -- An attachment's own file facts, which Storage measured: the format it
      -- was verified as and the file name the uploader gave. Neither names a
      -- person or a target.
      AND NOT (OBJECT_NAME(c.[object_id]) = N'MessageAttachment'
               AND c.[name] IN (N'mediaType', N'displayName'));
  `);
  if (generic.length > 0)
    fail(
      `A Messaging table may carry no type, target, scope, relationship, contact, name, ` +
        `title, age, guardian, retention, strike, ban, presence, typing or storage-key ` +
        `column; found ${JSON.stringify(generic)}.`,
    );

  const unique = await session.query<{
    name: string;
    columns: string;
    filter: string | null;
  }>(`
    SELECT i.[name], i.[filter_definition] AS [filter],
      STRING_AGG(COL_NAME(ic.[object_id], ic.[column_id]), N',')
        WITHIN GROUP (ORDER BY ic.[key_ordinal]) AS [columns]
    FROM sys.indexes i
    JOIN sys.index_columns ic ON ic.[object_id] = i.[object_id] AND ic.[index_id] = i.[index_id]
    WHERE i.[is_unique] = 1 AND ic.[key_ordinal] > 0 AND i.[object_id] IN (${tables})
    GROUP BY i.[object_id], i.[name], i.[filter_definition];
  `);
  const describedUnique = unique
    .map(
      (row) =>
        `${row.name}(${row.columns})` +
        (row.filter === null ? '' : ` WHERE ${row.filter}`),
    )
    .sort();
  if (
    describedUnique.join(' | ') !== MESSAGING_UNIQUE.join(' | ') ||
    unique.filter((row) => row.filter !== null).length !== 7
  )
    fail(
      `Messaging unique indexes must be exactly the reviewed twenty-two, the seven claims ` +
        `filtered; found ${describedUnique.join(' | ')}.`,
    );

  // ---- 3. exact keys, all NO ACTION and trusted; nothing foreign holds the context -
  const keys = await session.query<{
    name: string;
    columns: string;
    target: string;
    deletes: string;
    updates: string;
    trusted: number;
  }>(`
    SELECT fk.[name], OBJECT_NAME(fk.[referenced_object_id]) AS [target],
      fk.[delete_referential_action_desc] AS [deletes], fk.[update_referential_action_desc] AS [updates],
      CASE WHEN fk.[is_disabled] = 0 AND fk.[is_not_trusted] = 0 THEN 1 ELSE 0 END AS [trusted],
      STRING_AGG(COL_NAME(c.[parent_object_id], c.[parent_column_id]) + N'>'
        + COL_NAME(c.[referenced_object_id], c.[referenced_column_id]), N',')
        WITHIN GROUP (ORDER BY c.[constraint_column_id]) AS [columns]
    FROM sys.foreign_keys fk
    JOIN sys.foreign_key_columns c ON c.[constraint_object_id] = fk.[object_id]
    WHERE fk.[parent_object_id] IN (${tables})
    GROUP BY fk.[name], fk.[referenced_object_id], fk.[delete_referential_action_desc],
      fk.[update_referential_action_desc], fk.[is_disabled], fk.[is_not_trusted];
  `);
  const describedKeys = keys
    .map((row) => `${row.name}(${row.columns})>${row.target}:${row.deletes}`)
    .sort();
  if (
    describedKeys.join(',') !== MESSAGING_KEYS.join(',') ||
    keys.some((row) => row.updates !== 'NO_ACTION' || Number(row.trusted) !== 1)
  )
    fail(
      `Messaging keys must be exactly the reviewed twenty, none cascading and all ` +
        `trusted; found ${describedKeys.join(', ')}.`,
    );

  const [isolation] = await session.query<{ inbound: number; foreign: string | null }>(`
    SELECT
      (SELECT COUNT(*) FROM sys.foreign_keys
        WHERE [referenced_object_id] IN (${tables}) AND [parent_object_id] NOT IN (${tables})) AS [inbound],
      (SELECT STRING_AGG(OBJECT_NAME(c.[object_id]) + N'.' + c.[name], N',') FROM sys.columns c
        WHERE (c.[name] LIKE N'%conversation%' OR c.[name] LIKE N'%participant%' OR c.[name] LIKE N'%message%'
               OR c.[name] LIKE N'%moderat%' OR c.[name] LIKE N'%attachment%' OR c.[name] LIKE N'%releaseToken%'
               OR c.[name] LIKE N'%blocked%' OR c.[name] LIKE N'%blocker%')
          AND OBJECT_NAME(c.[object_id]) NOT IN (${names})
          -- An email provider's own message identifier names a delivery attempt,
          -- never a Messaging Message.
          AND NOT (OBJECT_NAME(c.[object_id]) = N'EmailDelivery' AND c.[name] = N'providerMessageId')
          AND OBJECTPROPERTY(c.[object_id], 'IsUserTable') = 1) AS [foreign];
  `);
  if (Number(isolation?.inbound) !== 0 || (isolation?.foreign ?? null) !== null)
    fail(
      `No other owner may reference or hold Messaging schema; found ` +
        `${JSON.stringify(isolation ?? null)}.`,
    );

  // ---- 4. eleven trusted CHECKs, eight triggers by number, no procedure -------------
  const checks = await session.query<{ name: string; trusted: number }>(`
    SELECT [name], CASE WHEN [is_disabled] = 0 AND [is_not_trusted] = 0 THEN 1 ELSE 0 END AS [trusted]
    FROM sys.check_constraints WHERE [parent_object_id] IN (${tables});
  `);
  const expectedChecks = EXPECTED_CHECK_CONSTRAINTS.filter((entry) =>
    MESSAGING_TABLES.includes(entry.table),
  )
    .map((entry) => entry.constraint)
    .sort();
  if (
    expectedChecks.length !== 11 ||
    checks
      .map((row) => row.name)
      .sort()
      .join(',') !== expectedChecks.join(',') ||
    checks.some((row) => Number(row.trusted) !== 1)
  )
    fail(
      `Messaging must carry exactly its eleven trusted CHECKs; found ${JSON.stringify(checks)}.`,
    );

  const triggers = await session.query<{
    name: string;
    tableName: string;
    disabled: number;
    definition: string | null;
  }>(`
    SELECT t.[name], OBJECT_NAME(t.[parent_id]) AS [tableName], CAST(t.[is_disabled] AS INT) AS [disabled],
      OBJECT_DEFINITION(t.[object_id]) AS [definition]
    FROM sys.triggers t WHERE t.[parent_id] IN (${tables});
  `);
  const describedTriggers = triggers
    .map((row) => `${row.name}@${row.tableName}:${raisedNumbers(row.definition)}`)
    .sort()
    .join(',');
  const expectedTriggers = Object.entries(MESSAGING_TRIGGER_NUMBERS)
    .map(([name, [table, numbers]]) => `${name}@${table}:${numbers}`)
    .sort()
    .join(',');
  if (
    describedTriggers !== expectedTriggers ||
    triggers.length !== 8 ||
    triggers.some((row) => Number(row.disabled) !== 0)
  )
    fail(
      `Messaging triggers must be exactly eight, enabled, raising exactly their own ` +
        `51300–51309 numbers; found ${describedTriggers}.`,
    );

  const [procedures] = await session.query<{ total: number }>(`
    SELECT COUNT(*) AS [total] FROM sys.procedures
    WHERE [name] LIKE N'Messag%' OR [name] LIKE N'Conversation%' OR [name] LIKE N'Support%'
       OR [name] LIKE N'Moderat%';
  `);
  if (Number(procedures?.total) !== 0)
    fail('Phase 24 writes through its owner adapter; it must create no procedure.');

  // ---- 5. Storage gained the release digest and nothing else ------------------------
  const asset = await assetShape(session);
  if (
    asset.columns !== ASSET_COLUMNS_WITH_MESSAGING ||
    asset.digest !== 'nvarchar(64):1' ||
    asset.unique !==
      'Asset_pkey | Asset_releaseDigest_key WHERE ([releaseDigest] IS NOT NULL) | Asset_storageKey_key' ||
    asset.checks !== 'Asset_clean_measured_ck,Asset_releaseDigest_ck,Asset_state_ck'
  )
    fail(
      `Storage's Asset must gain exactly a nullable NVARCHAR(64) releaseDigest with its ` +
        `filtered unique key and trusted CHECK; found ${JSON.stringify(asset)}.`,
    );

  // ---- 6. two gated keys, bundled into no role, held by nobody, no audit row --------
  const permissions = await session.query<{
    key: string;
    description: string;
    bundled: number;
    held: number;
    holders: number;
  }>(`
    SELECT p.[key], p.[description],
      (SELECT COUNT(*) FROM [dbo].[RolePermission] rp JOIN [dbo].[Role] r ON r.[id] = rp.[roleId]
        WHERE r.[key] = N'platform-administrator' AND rp.[permissionKey] = p.[key]) AS [bundled],
      (SELECT COUNT(*) FROM [dbo].[RolePermission] rp WHERE rp.[permissionKey] = p.[key]) AS [held],
      (SELECT COUNT(*) FROM [dbo].[RoleAssignment] ra JOIN [dbo].[RolePermission] rp ON rp.[roleId] = ra.[roleId]
        WHERE rp.[permissionKey] = p.[key]) AS [holders]
    FROM [dbo].[Permission] p
    WHERE p.[key] LIKE N'messag%' OR p.[key] LIKE N'conversation%' OR p.[key] LIKE N'support%'
       OR p.[key] LIKE N'moderat%' OR p.[key] LIKE N'chat%'
    ORDER BY p.[key];
  `);
  const described = new Map(
    PERMISSION_CATALOGUE.map((entry) => [entry.key as string, entry.description]),
  );
  const compiled = new Set<string>(PLATFORM_ADMINISTRATOR_PERMISSIONS);
  const gated = new Set<string>(EXTERNALLY_GATED_PERMISSIONS);
  if (
    permissions.map((row) => row.key).join(',') !== MESSAGING_PERMISSIONS.join(',') ||
    !MESSAGING_PERMISSIONS.every((key) => gated.has(key) && !compiled.has(key)) ||
    permissions.some(
      (row) =>
        row.description !== described.get(row.key) ||
        Number(row.bundled) !== 0 ||
        Number(row.held) !== 0 ||
        Number(row.holders) !== 0,
    )
  )
    fail(
      `The Messaging vocabulary must be exactly ${MESSAGING_PERMISSIONS.join(', ')}, described ` +
        `as the compiled catalogue describes them, externally gated, bundled into no role and ` +
        `held by nobody; found ${JSON.stringify(permissions)}.`,
    );

  const [audit] = await session.query<{ total: number }>(`
    SELECT COUNT(*) AS [total] FROM [dbo].[AuditLog]
    WHERE [action] LIKE N'messaging.%' OR [authorisingSource] = N'${MESSAGING_MIGRATION}';
  `);
  if (Number(audit?.total ?? -1) !== 0)
    fail(
      'Phase 24 changes no bundle, so it must write no provisioning record (the Phase-20 ' +
        `precedent); found ${String(audit?.total)}.`,
    );

  // Once Phase 27 is rolled back the database's bundle lacks the two bundled
  // Donations keys the compiled bundle now carries, and once Phase 26 is too it
  // lacks the two Membership keys as well.
  const bundled = await assertProtectedBundleExcludesGated(session);
  const compiledBundle = compiledBundleAt(
    stage === 'deploy' || stage === 're-deploy' ? 'current' : stage,
  ).length;
  if (bundled !== compiledBundle)
    fail(
      `The protected bundle holds ${String(bundled)} keys; the compiled bundle holds ` +
        `${String(compiledBundle)} at ${stage}.`,
    );

  report(
    'messaging schema',
    'nine empty tables of the reviewed shape and NO activation, twenty-two unique keys ' +
      'with seven filtered claims, twenty trusted NO ACTION keys, 11 CHECKs, eight triggers ' +
      'raising 51300–51309, no procedure, Asset gained only its release digest, two gated ' +
      `keys held by nobody and no provisioning record, ${String(bundled)} bundled`,
  );
}

/**
 * After the Phase-24 rollback: no Messaging table, trigger, key, CHECK or
 * index, no Messaging permission or grant of one, no audit row — and Storage's
 * Asset exactly as Phase 7 left it, its digest column, key and CHECK gone. The
 * protected bundle is still the compiled bundle (the two gated keys were never
 * in it). The caller then proves the owners Messaging referenced are intact.
 */
async function assertMessagingRemoved(session: SqlSession): Promise<void> {
  const names = MESSAGING_TABLES.map((table) => `N'${table}'`).join(',');
  const triggerNames = Object.keys(MESSAGING_TRIGGER_NUMBERS)
    .map((name) => `N'${name}'`)
    .join(',');
  const keys = MESSAGING_PERMISSIONS.map((key) => `N'${key}'`).join(',');
  const [row] = await session.query<Record<string, number>>(`
    SELECT
      (SELECT COUNT(*) FROM sys.tables WHERE [name] IN (${names})) AS [tables],
      (SELECT COUNT(*) FROM sys.triggers WHERE [name] IN (${triggerNames})) AS [triggers],
      (SELECT COUNT(*) FROM sys.foreign_keys
        WHERE LEFT([name], CHARINDEX(N'_', [name] + N'_') - 1) IN (${names})) AS [keys],
      (SELECT COUNT(*) FROM sys.check_constraints
        WHERE LEFT([name], CHARINDEX(N'_', [name] + N'_') - 1) IN (${names})) AS [checks],
      (SELECT COUNT(*) FROM sys.indexes
        WHERE LEFT([name], CHARINDEX(N'_', [name] + N'_') - 1) IN (${names})) AS [indexes],
      (SELECT COUNT(*) FROM [dbo].[Permission] WHERE [key] IN (${keys})) AS [permissions],
      (SELECT COUNT(*) FROM [dbo].[RolePermission] WHERE [permissionKey] IN (${keys})) AS [granted],
      (SELECT COUNT(*) FROM [dbo].[AuditLog] WHERE [action] LIKE N'messaging.%') AS [audit];
  `);
  if (Object.values(row ?? { missing: 1 }).some((value) => Number(value) !== 0))
    fail(
      `The Phase-24 rollback left a Messaging object: ${JSON.stringify(row ?? null)}.`,
    );
  if (await messagingPresent(session))
    fail('The Phase-24 rollback left the Messaging schema in place.');

  const asset = await assetShape(session);
  if (
    asset.columns !== ASSET_COLUMNS_BEFORE_MESSAGING ||
    asset.digest !== '' ||
    asset.unique !== 'Asset_pkey | Asset_storageKey_key' ||
    asset.checks !== 'Asset_clean_measured_ck,Asset_state_ck'
  )
    fail(
      `The Phase-24 rollback must leave Storage's Asset exactly as Phase 7 made it; found ` +
        `${JSON.stringify(asset)}.`,
    );

  const bundled = await assertProtectedBundleExcludesGated(session);
  const expected = compiledBundleAt('before-messaging').length;
  if (
    bundled !== expected ||
    expected !==
      PLATFORM_ADMINISTRATOR_PERMISSIONS.length -
        MEMBERSHIP_PERMISSIONS.length -
        DONATIONS_BUNDLED.length -
        MIGRATION_BUNDLED.length
  )
    fail(
      `After the Phase-24 rollback the protected bundle holds ${String(bundled)} keys; the ` +
        `compiled bundle less the two Membership, two bundled Donations and two bundled ` +
        `Migration keys the Phase-26, Phase-27 and Phase-29 rollbacks removed first — it ` +
        `never held a Messaging key — holds ` +
        `${String(expected)}.`,
    );
  report(
    'messaging rollback',
    `every Messaging table, key, index, CHECK, trigger and permission removed, Asset as ` +
      `Phase 7 made it; ${String(bundled)} keys still bundled`,
  );
}

/**
 * Phase 24 — THE RULES, proved as behaviour against the re-deployed schema
 * with NON_MESSAGING_FIXTURE sentinels only, through the migration login (the
 * runtime's own posture is `db:test:permissions`'s):
 *
 *   - FAIL CLOSED: before its kind's activation row exists, no conversation of
 *     that kind can be created (51302); the fixture activations then written
 *     are of the closed kinds, evidenced when approved (…_ck), one per kind
 *     (the key) and immutable (51300). A message to a conversation whose kind
 *     is not activated cannot be reached as behaviour — it needs a
 *     conversation, which cannot exist before the activation that cannot be
 *     removed — so that half of 51303 is proved by the trigger body's numbers
 *     in `assertMessagingFoundation`;
 *   - a conversation has its kind's shape (…_shape_ck), starts open, empty and
 *     unmarked (51302), is one per kind, Course and pair and one OPEN support
 *     conversation per person (the filtered keys); its identity never changes,
 *     its order never goes backwards, a closed one never reopens, a disposal
 *     mark is never cleared and it is removed only once marked (51302);
 *     `resolved` is support's alone (…_ck);
 *   - a participant fits its conversation's kind and people (51301), once per
 *     account, one requester and one ACTIVE support claim (the keys); it is
 *     never re-keyed, never rejoins — a support claim aside — and leaves only
 *     through disposal (51301);
 *   - a message is written one at a time, visible, by a CURRENT participant of
 *     an OPEN conversation at the sequence just allocated (51303), once per
 *     place and per operation (the keys), within its bounds (…_ck); it is
 *     never rewritten nor returned to view once withheld (51304), and leaves
 *     only through disposal (51305);
 *   - an attachment starts pending, becomes ready with Storage's facts, is
 *     attached once to one of its own uploader's messages in its own
 *     conversation (the composite key), one per place and an asset once (the
 *     filtered keys), and is otherwise only released (51306); Storage's
 *     release digest is lower-case hex and names one asset (…_ck, the key);
 *   - a read position moves forward only and never past the last message
 *     (51307), once per participant (the key and the composite key);
 *   - a block is of someone else, once (…_ck, the key);
 *   - a report is filed open by a current participant within what the
 *     conversation held (51308), on a message of THAT conversation (the
 *     composite key), one OPEN report per reporter and target — two
 *     conversation-level reports collide too, because their NULLs are equal —
 *     and its target never changes nor does a resolved report reopen (51308);
 *   - a decision is made once, on an open report, withholding only a reported
 *     message, and is permanent (51309);
 *   - every one of the twenty foreign keys refuses a reference to nothing, and
 *     nothing cascades: a Course, an Asset, an account, a report, a
 *     participant and a message are never deleted from under what names them.
 *
 * Every row the proofs write is then removed through the disposal path itself
 * — close and mark, release the attachments, then children first — EXCEPT the
 * three immutable activations and the one support conversation that carries
 * the permanent moderation decisions (51309): like canonical history, those
 * die only with this disposable database, and exactly they remain.
 */
async function assertMessagingRules(session: SqlSession): Promise<void> {
  const run = randomUUID().replaceAll('-', '').slice(0, 16);
  const at = '2026-10-08T00:00:00';
  const later = '2026-10-08T01:00:00';
  let refusals = 0;
  const refuse = async (
    label: string,
    statement: string,
    numbers: readonly number[],
    rule: string,
  ): Promise<void> => {
    await expectRefusal(session, label, statement, numbers, rule);
    refusals += 1;
  };
  const count = async (statement: string): Promise<number> => {
    const [row] = await session.query<{ total: number }>(statement);
    return Number(row?.total ?? -1);
  };
  const sha256 = (text: string): string =>
    createHash('sha256').update(text).digest('hex');
  const digest = (label: string): string =>
    sha256(`NON_MESSAGING_FIXTURE ${label} ${run}`);
  // Identifiers that sort before and after every real one, so a reference to
  // nothing can be placed in the low or the high slot of a direct conversation
  // deliberately.
  const FIRST = '00000000-0000-4000-8000-000000000000';
  const LAST = 'ffffffff-ffff-4fff-bfff-ffffffffffff';

  // ---- the accounts and the Course the proofs name ---------------------------------
  const teacher = randomUUID();
  const learner = randomUUID();
  const peerA = randomUUID();
  const peerB = randomUUID();
  const requester = randomUUID();
  const staffOne = randomUUID();
  const staffTwo = randomUUID();
  const moderator = randomUUID();
  const outsider = randomUUID();
  const blockedOnly = randomUUID();
  const users = [
    [teacher, 'teacher'],
    [learner, 'learner'],
    [peerA, 'peer-a'],
    [peerB, 'peer-b'],
    [requester, 'requester'],
    [staffOne, 'staff-one'],
    [staffTwo, 'staff-two'],
    [moderator, 'moderator'],
    [outsider, 'outsider'],
    [blockedOnly, 'blocked-only'],
  ] as const;
  for (const [user, label] of users)
    await session.query(
      `INSERT INTO [dbo].[User] ([id],[name],[email],[emailVerified],[createdAt],[updatedAt],[locale],[status],[twoFactorEnabled]) VALUES (N'${user}',N'NON_MESSAGING_FIXTURE ${label}',N'${label}-${run}@messaging-proof.invalid',0,SYSUTCDATETIME(),SYSUTCDATETIME(),N'en',N'active',0);`,
    );
  // A direct conversation names its two accounts in BINARY order.
  const pair = (one: string, two: string): readonly [string, string] =>
    one < two ? [one, two] : [two, one];
  const course = randomUUID();
  await expectAccepted(
    session,
    'A draft Course for the direct conversations to name',
    `INSERT INTO [dbo].[Course] ([id],[slug],[primaryLocale],[state],[level],[format],[languageCode],[publishedAt],[version],[updatedAt]) VALUES (N'${course}',N'non-messaging-fixture-${run}',N'en',N'draft',NULL,N'live',N'en',NULL,1,'${at}');`,
  );

  // ---- conversations ------------------------------------------------------------------
  const conversation = (
    id: string,
    kind: string,
    courseId: string | null,
    lowId: string | null,
    highId: string | null,
    person: string | null,
  ): string => {
    const value = (text: string | null): string =>
      text === null ? 'NULL' : `N'${text}'`;
    return `INSERT INTO [dbo].[Conversation] ([id],[kind],[courseId],[lowUserId],[highUserId],[requesterUserId]) VALUES (N'${id}',N'${kind}',${value(courseId)},${value(lowId)},${value(highId)},${value(person)});`;
  };
  const direct = (
    id: string,
    kind: 'teacher-student' | 'student-student',
    one: string,
    two: string,
    courseId = course,
  ): string => {
    const [low, high] = pair(one, two);
    return conversation(id, kind, courseId, low, high, null);
  };
  const support = (id: string, person: string): string =>
    conversation(id, 'support', null, null, null, person);
  const taught = randomUUID();
  const peers = randomUUID();
  const asked = randomUUID();
  const emptySupport = randomUUID();
  const askedAgain = randomUUID();

  // ---- fail closed: no conversation of a kind before its activation (51302) --------
  const OFF = 'is not activated';
  if ((await count('SELECT COUNT(*) AS [total] FROM [dbo].[MessagingActivation];')) !== 0)
    fail('The Messaging rules must start with no activation row.');
  await refuse(
    'A teacher-student conversation before activation',
    direct(taught, 'teacher-student', teacher, learner),
    [51302],
    OFF,
  );
  await refuse(
    'A support conversation before activation',
    support(asked, requester),
    [51302],
    OFF,
  );
  const activation = (
    capability: string,
    authority: string,
    reference: string | null,
  ): string =>
    `INSERT INTO [dbo].[MessagingActivation] ([capability],[authority],[authorisedBy],[reference]) VALUES (N'${capability}',N'${authority}',N'NON_MESSAGING_FIXTURE operator',${reference === null ? 'NULL' : `N'${reference}'`});`;
  await refuse(
    'An activation of a kind that does not exist',
    activation('group', 'fixture', null),
    [547],
    'MessagingActivation_ck',
  );
  await refuse(
    'An approved activation without evidence',
    activation('support', 'approved', null),
    [547],
    'MessagingActivation_evidence_ck',
  );
  await expectAccepted(
    session,
    'The fixture activations of support and teacher-student messaging',
    `${activation('support', 'fixture', null)}
     ${activation('teacher-student', 'fixture', null)}`,
  );
  await refuse(
    'A student-student conversation while only its kind is not activated',
    direct(peers, 'student-student', peerA, peerB),
    [51302],
    OFF,
  );
  await expectAccepted(
    session,
    'The fixture activation of student-student messaging',
    activation('student-student', 'fixture', null),
  );
  await refuse(
    'A second activation of one kind',
    activation('support', 'fixture', null),
    [2627],
    'MessagingActivation_pkey',
  );
  await refuse(
    'An activation re-labelled',
    "UPDATE [dbo].[MessagingActivation] SET [authority]=N'approved',[reference]=N'urn:example:forged' WHERE [capability]=N'support';",
    [51300],
    'immutable',
  );
  await refuse(
    'An activation removed',
    "DELETE FROM [dbo].[MessagingActivation] WHERE [capability]=N'teacher-student';",
    [51300],
    'immutable',
  );

  // ---- a conversation's shape, start, keys and identity (51302) ---------------------
  const [low, high] = pair(teacher, learner);
  await refuse(
    'A support conversation naming a Course',
    conversation(randomUUID(), 'support', course, null, null, requester),
    [547],
    'Conversation_shape_ck',
  );
  await refuse(
    'A direct conversation naming its accounts out of order',
    conversation(randomUUID(), 'teacher-student', course, high, low, null),
    [547],
    'Conversation_shape_ck',
  );
  await refuse(
    'A direct conversation that also names a requester',
    conversation(randomUUID(), 'teacher-student', course, low, high, requester),
    [547],
    'Conversation_shape_ck',
  );
  await refuse(
    'A conversation closed without its instant',
    `INSERT INTO [dbo].[Conversation] ([id],[kind],[requesterUserId],[state]) VALUES (N'${randomUUID()}',N'support',N'${outsider}',N'closed');`,
    [547],
    'Conversation_ck',
  );
  const START = 'starts open, empty and unmarked';
  await refuse(
    'A conversation created closed',
    `INSERT INTO [dbo].[Conversation] ([id],[kind],[requesterUserId],[state],[closedReason],[closedAt]) VALUES (N'${randomUUID()}',N'support',N'${outsider}',N'closed',N'resolved','${at}');`,
    [51302],
    START,
  );
  await refuse(
    'A conversation created with messages already counted',
    `INSERT INTO [dbo].[Conversation] ([id],[kind],[requesterUserId],[lastSequence]) VALUES (N'${randomUUID()}',N'support',N'${outsider}',3);`,
    [51302],
    START,
  );
  await refuse(
    'A direct conversation on a Course that does not exist',
    direct(randomUUID(), 'teacher-student', teacher, learner, randomUUID()),
    [547],
    'Conversation_courseId_fkey',
  );
  await refuse(
    'A direct conversation whose lower account does not exist',
    conversation(randomUUID(), 'teacher-student', course, FIRST, teacher, null),
    [547],
    'Conversation_lowUserId_fkey',
  );
  await refuse(
    'A direct conversation whose higher account does not exist',
    conversation(randomUUID(), 'teacher-student', course, teacher, LAST, null),
    [547],
    'Conversation_highUserId_fkey',
  );
  await refuse(
    'A support conversation for an account that does not exist',
    support(randomUUID(), randomUUID()),
    [547],
    'Conversation_requesterUserId_fkey',
  );
  await expectAccepted(
    session,
    'A teacher-student, a student-student and two support conversations',
    `${direct(taught, 'teacher-student', teacher, learner)}
     ${direct(peers, 'student-student', peerA, peerB)}
     ${support(asked, requester)}
     ${support(emptySupport, outsider)}`,
  );
  await refuse(
    'A second teacher-student conversation between the same two on the same Course',
    direct(randomUUID(), 'teacher-student', learner, teacher),
    [2601],
    'Conversation_direct_key',
  );
  await refuse(
    'A second open support conversation for one person',
    support(randomUUID(), requester),
    [2601],
    'Conversation_support_key',
  );
  const IDENTITY = 'identity cannot change';
  await refuse(
    "A conversation's kind rewritten",
    `UPDATE [dbo].[Conversation] SET [kind]=N'student-student' WHERE [id]=N'${taught}';`,
    [51302],
    IDENTITY,
  );
  await refuse(
    "A conversation's creation instant rewritten",
    `UPDATE [dbo].[Conversation] SET [createdAt]=DATEADD(minute,-1,[createdAt]) WHERE [id]=N'${taught}';`,
    [51302],
    IDENTITY,
  );
  await refuse(
    'A direct conversation resolved as if it were support',
    `UPDATE [dbo].[Conversation] SET [state]=N'closed',[closedReason]=N'resolved',[closedAt]='${at}' WHERE [id]=N'${peers}';`,
    [547],
    'Conversation_ck',
  );
  await refuse(
    'A conversation removed without its disposal',
    `DELETE FROM [dbo].[Conversation] WHERE [id]=N'${emptySupport}';`,
    [51302],
    'removed only through its disposal',
  );

  // ---- participants (51301) -------------------------------------------------------------
  const member = (
    id: string,
    conversationId: string,
    userId: string,
    role: string,
    leftAt: string | null = null,
  ): string =>
    `INSERT INTO [dbo].[ConversationParticipant] ([id],[conversationId],[userId],[role],[joinedAt],[leftAt]) VALUES (N'${id}',N'${conversationId}',N'${userId}',N'${role}','${at}',${leftAt === null ? 'NULL' : `'${leftAt}'`});`;
  const FIT = 'does not fit its conversation';
  await refuse(
    'A peer in a teacher-student conversation',
    member(randomUUID(), taught, learner, 'peer'),
    [51301],
    FIT,
  );
  await refuse(
    'A learner the conversation does not name',
    member(randomUUID(), taught, outsider, 'learner'),
    [51301],
    FIT,
  );
  await refuse(
    'A teacher in a student-student conversation',
    member(randomUUID(), peers, peerA, 'teacher'),
    [51301],
    FIT,
  );
  await refuse(
    'A requester who is not the person asking',
    member(randomUUID(), asked, outsider, 'requester'),
    [51301],
    FIT,
  );
  await refuse(
    'The person asking as their own support staff',
    member(randomUUID(), asked, requester, 'support'),
    [51301],
    FIT,
  );
  await refuse(
    'A participant role outside the vocabulary',
    member(randomUUID(), asked, staffOne, 'admin'),
    [547],
    'ConversationParticipant_ck',
  );
  await refuse(
    'A participant who left before joining',
    `INSERT INTO [dbo].[ConversationParticipant] ([id],[conversationId],[userId],[role],[joinedAt],[leftAt]) VALUES (N'${randomUUID()}',N'${asked}',N'${staffOne}',N'support','${later}','${at}');`,
    [547],
    'ConversationParticipant_ck',
  );
  await refuse(
    'A participant account that does not exist',
    member(randomUUID(), asked, randomUUID(), 'support'),
    [547],
    'ConversationParticipant_userId_fkey',
  );
  await refuse(
    'A participant of a conversation that does not exist',
    member(randomUUID(), randomUUID(), staffOne, 'support'),
    [547],
    'ConversationParticipant_conversationId_fkey',
  );
  const pTeacher = randomUUID();
  const pLearner = randomUUID();
  const pPeerA = randomUUID();
  const pPeerB = randomUUID();
  const pRequester = randomUUID();
  const pStaffOne = randomUUID();
  const pStaffTwo = randomUUID();
  const pEmpty = randomUUID();
  await expectAccepted(
    session,
    'The teacher and learner, the two peers, the requesters, one active claim and one released claim',
    `${member(pTeacher, taught, teacher, 'teacher')}
     ${member(pLearner, taught, learner, 'learner')}
     ${member(pPeerA, peers, peerA, 'peer')}
     ${member(pPeerB, peers, peerB, 'peer')}
     ${member(pRequester, asked, requester, 'requester')}
     ${member(pStaffOne, asked, staffOne, 'support')}
     ${member(pStaffTwo, asked, staffTwo, 'support', at)}
     ${member(pEmpty, emptySupport, outsider, 'requester')}`,
  );
  await refuse(
    'One account a participant twice',
    member(randomUUID(), peers, peerA, 'peer'),
    [2627],
    'ConversationParticipant_member_key',
  );
  await refuse(
    'A second requester',
    member(randomUUID(), asked, outsider, 'requester'),
    [2601],
    'ConversationParticipant_role_key',
  );
  await refuse(
    'A second active support claim',
    `UPDATE [dbo].[ConversationParticipant] SET [leftAt]=NULL WHERE [id]=N'${pStaffTwo}';`,
    [2601],
    'ConversationParticipant_claim_key',
  );
  const REKEY = 'cannot be re-keyed';
  await refuse(
    "A participant's role rewritten",
    `UPDATE [dbo].[ConversationParticipant] SET [role]=N'teacher' WHERE [id]=N'${pPeerA}';`,
    [51301],
    REKEY,
  );
  await refuse(
    'A participant moved to another conversation',
    `UPDATE [dbo].[ConversationParticipant] SET [conversationId]=N'${emptySupport}' WHERE [id]=N'${pStaffOne}';`,
    [51301],
    REKEY,
  );
  await expectAccepted(
    session,
    'A peer leaves, and the support claim passes from one member of staff to the other',
    `UPDATE [dbo].[ConversationParticipant] SET [leftAt]='${later}' WHERE [id]=N'${pPeerB}';
     UPDATE [dbo].[ConversationParticipant] SET [leftAt]='${later}' WHERE [id]=N'${pStaffOne}';
     UPDATE [dbo].[ConversationParticipant] SET [leftAt]=NULL WHERE [id]=N'${pStaffTwo}';`,
  );
  await refuse(
    'A peer who left rejoins',
    `UPDATE [dbo].[ConversationParticipant] SET [leftAt]=NULL WHERE [id]=N'${pPeerB}';`,
    [51301],
    'only a support claim may return',
  );
  await refuse(
    'A participant removed without disposal',
    `DELETE FROM [dbo].[ConversationParticipant] WHERE [id]=N'${pPeerB}';`,
    [51301],
    'removed only through its conversation',
  );

  // ---- messages (51303, 51304, 51305) ------------------------------------------------
  // The allocator bumps the conversation's own `lastSequence` first and the
  // message takes exactly that place.
  const message = (
    id: string,
    conversationId: string,
    sequence: number,
    sender: string,
    label: string,
    body = `N'NON_MESSAGING_FIXTURE ${label}'`,
    payloadDigest = digest(label),
  ): string =>
    `INSERT INTO [dbo].[Message] ([id],[conversationId],[sequence],[senderUserId],[operationId],[body],[payloadDigest]) VALUES (N'${id}',N'${conversationId}',${String(sequence)},N'${sender}',N'${randomUUID()}',${body},N'${payloadDigest}');`;
  const send = (
    id: string,
    conversationId: string,
    sender: string,
    label: string,
    operation = randomUUID(),
  ): string =>
    `UPDATE [dbo].[Conversation] SET [lastSequence]=[lastSequence]+1,[activityAt]=SYSUTCDATETIME(),[version]=[version]+1 WHERE [id]=N'${conversationId}';
     INSERT INTO [dbo].[Message] ([id],[conversationId],[sequence],[senderUserId],[operationId],[body],[payloadDigest])
       SELECT N'${id}',N'${conversationId}',c.[lastSequence],N'${sender}',N'${operation}',N'NON_MESSAGING_FIXTURE ${label}',N'${digest(label)}'
       FROM [dbo].[Conversation] c WHERE c.[id]=N'${conversationId}';`;
  const NEEDS = 'needs an open, activated conversation';
  const opTeacher = randomUUID();
  const mTeacher = randomUUID();
  const mLearner = randomUUID();
  const mPlain = randomUUID();
  const mRequester = randomUUID();
  const mStaff = randomUUID();
  const mPeer = randomUUID();
  await expectAccepted(
    session,
    'Messages in order in the teacher-student, support and student-student conversations',
    `${send(mTeacher, taught, teacher, 'teacher message', opTeacher)}
     ${send(mLearner, taught, learner, 'learner message')}
     ${send(mPlain, taught, teacher, 'plain message')}
     ${send(mRequester, asked, requester, 'requester message')}
     ${send(mStaff, asked, staffTwo, 'staff message')}
     ${send(mPeer, peers, peerA, 'peer message')}`,
  );
  const [order] = await session.query<{ sequences: string | null; last: number }>(`
    SELECT (SELECT STRING_AGG(CAST([sequence] AS NVARCHAR(8)), N',') WITHIN GROUP (ORDER BY [sequence])
              FROM [dbo].[Message] WHERE [conversationId]=N'${taught}') AS [sequences],
           (SELECT [lastSequence] FROM [dbo].[Conversation] WHERE [id]=N'${taught}') AS [last];
  `);
  if (order?.sequences !== '1,2,3' || Number(order.last) !== 3)
    fail(
      `Messages must take the allocated places 1, 2, 3; found ${JSON.stringify(order)}.`,
    );
  await refuse(
    'A message at a place that was not allocated',
    message(randomUUID(), taught, 7, teacher, 'gap'),
    [51303],
    NEEDS,
  );
  await refuse(
    'A message at a place already taken',
    message(randomUUID(), taught, 3, learner, 'taken'),
    [2627],
    'Message_order_key',
  );
  await refuse(
    'A second message of one operation',
    send(randomUUID(), taught, teacher, 'replayed', opTeacher),
    [2627],
    'Message_operation_key',
  );
  await refuse(
    'Two messages written at once',
    `UPDATE [dbo].[Conversation] SET [lastSequence]=[lastSequence]+1 WHERE [id]=N'${taught}';
     INSERT INTO [dbo].[Message] ([id],[conversationId],[sequence],[senderUserId],[operationId],[body],[payloadDigest])
       SELECT v.[id],N'${taught}',c.[lastSequence] + v.[offset],N'${teacher}',v.[op],N'NON_MESSAGING_FIXTURE pair',N'${digest('pair')}'
       FROM [dbo].[Conversation] c
       CROSS JOIN (VALUES (N'${randomUUID()}',0,N'${randomUUID()}'),(N'${randomUUID()}',1,N'${randomUUID()}')) AS v([id],[offset],[op])
       WHERE c.[id]=N'${taught}';`,
    [51303],
    'one at a time',
  );
  await refuse(
    'A message from someone who is not a participant',
    send(randomUUID(), taught, outsider, 'outsider'),
    [51303],
    NEEDS,
  );
  await refuse(
    'A message from a peer who has left',
    send(randomUUID(), peers, peerB, 'departed'),
    [51303],
    NEEDS,
  );
  await refuse(
    'A message from staff whose claim was released',
    send(randomUUID(), asked, staffOne, 'released claim'),
    [51303],
    NEEDS,
  );
  await refuse(
    'A message written already withheld',
    `UPDATE [dbo].[Conversation] SET [lastSequence]=[lastSequence]+1 WHERE [id]=N'${taught}';
     INSERT INTO [dbo].[Message] ([id],[conversationId],[sequence],[senderUserId],[operationId],[body],[payloadDigest],[moderation],[withheldAt])
       SELECT N'${randomUUID()}',N'${taught}',c.[lastSequence],N'${teacher}',N'${randomUUID()}',N'NON_MESSAGING_FIXTURE hidden',N'${digest('hidden')}',N'withheld','${at}'
       FROM [dbo].[Conversation] c WHERE c.[id]=N'${taught}';`,
    [51303],
    NEEDS,
  );
  await refuse(
    'A message at place zero',
    message(randomUUID(), taught, 0, teacher, 'zero'),
    [547],
    'Message_ck',
  );
  await refuse(
    'A message body beyond its bound',
    message(
      randomUUID(),
      taught,
      99,
      teacher,
      'long',
      "REPLICATE(CAST(N'a' AS NVARCHAR(MAX)),8001)",
    ),
    [547],
    'Message_ck',
  );
  await refuse(
    'A message digest that is not lower-case SHA-256 hex',
    message(
      randomUUID(),
      taught,
      99,
      teacher,
      'upper',
      undefined,
      digest('upper').toUpperCase(),
    ),
    [547],
    'Message_ck',
  );
  await refuse(
    'A message withheld without its instant',
    `UPDATE [dbo].[Message] SET [moderation]=N'withheld' WHERE [id]=N'${mPlain}';`,
    [547],
    'Message_ck',
  );
  await refuse(
    'A message to a conversation that does not exist',
    message(randomUUID(), randomUUID(), 1, teacher, 'nowhere'),
    [547],
    'Message_conversationId_fkey',
  );
  await refuse(
    'A message from an account that does not exist',
    message(randomUUID(), taught, 99, randomUUID(), 'nobody'),
    [547],
    'Message_senderUserId_fkey',
  );
  const SENT = 'never changes once sent';
  await refuse(
    "A message's body rewritten",
    `UPDATE [dbo].[Message] SET [body]=N'NON_MESSAGING_FIXTURE rewritten' WHERE [id]=N'${mPlain}';`,
    [51304],
    SENT,
  );
  await refuse(
    "A message's sender rewritten",
    `UPDATE [dbo].[Message] SET [senderUserId]=N'${learner}' WHERE [id]=N'${mPlain}';`,
    [51304],
    SENT,
  );
  await refuse(
    "A message's sending instant rewritten",
    `UPDATE [dbo].[Message] SET [sentAt]=DATEADD(minute,-1,[sentAt]) WHERE [id]=N'${mPlain}';`,
    [51304],
    SENT,
  );
  await expectAccepted(
    session,
    'A message withheld',
    `UPDATE [dbo].[Message] SET [moderation]=N'withheld',[withheldAt]='${at}' WHERE [id]=N'${mPlain}';`,
  );
  await refuse(
    'A withheld message returned to view',
    `UPDATE [dbo].[Message] SET [moderation]=N'visible',[withheldAt]=NULL WHERE [id]=N'${mPlain}';`,
    [51304],
    SENT,
  );
  await refuse(
    'A message removed without disposal',
    `DELETE FROM [dbo].[Message] WHERE [id]=N'${mPeer}';`,
    [51305],
    'removed only through its conversation',
  );
  await refuse(
    "A conversation's order moved backwards",
    `UPDATE [dbo].[Conversation] SET [lastSequence]=1 WHERE [id]=N'${taught}';`,
    [51302],
    IDENTITY,
  );

  // ---- attachments and Storage's release digest (51306) ------------------------------
  // The consumer generates the token and keeps it; Storage keeps only its digest.
  const tokenPng = digest('token-png');
  const tokenPdf = digest('token-pdf');
  const assetPng = randomUUID();
  const assetPdf = randomUUID();
  const assetJpeg = randomUUID();
  const assetLoose = randomUUID();
  const assets = [assetPng, assetPdf, assetJpeg, assetLoose];
  const asset = (id: string, label: string, releaseDigest: string | null): string =>
    `INSERT INTO [dbo].[Asset] ([id],[storageKey],[state],[updatedAt],[releaseDigest]) VALUES (N'${id}',N'proof/messaging/${run}/${label}',N'uploading',SYSUTCDATETIME(),${releaseDigest === null ? 'NULL' : `N'${releaseDigest}'`});`;
  await refuse(
    'A release digest that is not lower-case SHA-256 hex',
    asset(randomUUID(), 'upper', sha256(tokenPng).toUpperCase()),
    [547],
    'Asset_releaseDigest_ck',
  );
  await expectAccepted(
    session,
    'Four assets: two releasable by their tokens, two stored without a token',
    `${asset(assetPng, 'png', sha256(tokenPng))}
     ${asset(assetPdf, 'pdf', sha256(tokenPdf))}
     ${asset(assetJpeg, 'jpeg', null)}
     ${asset(assetLoose, 'loose', null)}`,
  );
  await refuse(
    'One release digest on two assets',
    asset(randomUUID(), 'again', sha256(tokenPng)),
    [2601],
    'Asset_releaseDigest_key',
  );
  const pending = (
    id: string,
    conversationId: string,
    uploader: string,
    token: string,
  ): string =>
    `INSERT INTO [dbo].[MessageAttachment] ([id],[conversationId],[uploaderUserId],[releaseToken],[state]) VALUES (N'${id}',N'${conversationId}',N'${uploader}',N'${token}',N'pending');`;
  const ready = (id: string, assetId: string, mediaType: string): string =>
    `UPDATE [dbo].[MessageAttachment] SET [state]=N'ready',[assetId]=N'${assetId}',[mediaType]=N'${mediaType}',[byteSize]=2048,[displayName]=N'NON_MESSAGING_FIXTURE file' WHERE [id]=N'${id}';`;
  const attach = (id: string, messageId: string, position: number): string =>
    `UPDATE [dbo].[MessageAttachment] SET [state]=N'attached',[messageId]=N'${messageId}',[position]=${String(position)},[attachedAt]='${at}' WHERE [id]=N'${id}';`;
  await refuse(
    'An attachment created ready',
    `INSERT INTO [dbo].[MessageAttachment] ([id],[conversationId],[uploaderUserId],[releaseToken],[state],[assetId],[mediaType],[byteSize]) VALUES (N'${randomUUID()}',N'${taught}',N'${teacher}',N'${digest('created-ready')}',N'ready',N'${assetLoose}',N'image/png',10);`,
    [51306],
    'starts pending',
  );
  await refuse(
    'A pending attachment that already names an asset',
    `INSERT INTO [dbo].[MessageAttachment] ([id],[conversationId],[uploaderUserId],[releaseToken],[state],[assetId]) VALUES (N'${randomUUID()}',N'${taught}',N'${teacher}',N'${digest('pending-asset')}',N'pending',N'${assetLoose}');`,
    [547],
    'MessageAttachment_ck',
  );
  await refuse(
    'An attachment token that is not lower-case hex',
    pending(randomUUID(), taught, teacher, digest('bad-token').toUpperCase()),
    [547],
    'MessageAttachment_ck',
  );
  await refuse(
    'An upload to a conversation that does not exist',
    pending(randomUUID(), randomUUID(), teacher, digest('no-conversation')),
    [547],
    'MessageAttachment_conversationId_fkey',
  );
  await refuse(
    'An upload by an account that does not exist',
    pending(randomUUID(), taught, randomUUID(), digest('no-uploader')),
    [547],
    'MessageAttachment_uploaderUserId_fkey',
  );
  const attPng = randomUUID();
  const attPdf = randomUUID();
  const attOther = randomUUID();
  const attLoose = randomUUID();
  await expectAccepted(
    session,
    "Four pending uploads: three of the teacher's and one of the learner's",
    `${pending(attPng, taught, teacher, tokenPng)}
     ${pending(attPdf, taught, teacher, tokenPdf)}
     ${pending(attOther, taught, teacher, digest('token-other'))}
     ${pending(attLoose, taught, learner, digest('token-loose'))}`,
  );
  await refuse(
    'One release token on two attachments',
    pending(randomUUID(), taught, learner, tokenPng),
    [2627],
    'MessageAttachment_releaseToken_key',
  );
  await refuse(
    'An attachment in a format outside the three',
    `UPDATE [dbo].[MessageAttachment] SET [state]=N'ready',[assetId]=N'${assetPng}',[mediaType]=N'image/gif',[byteSize]=2048 WHERE [id]=N'${attPng}';`,
    [547],
    'MessageAttachment_ck',
  );
  await refuse(
    'An attachment beyond five mebibytes',
    `UPDATE [dbo].[MessageAttachment] SET [state]=N'ready',[assetId]=N'${assetPng}',[mediaType]=N'image/png',[byteSize]=5242881 WHERE [id]=N'${attPng}';`,
    [547],
    'MessageAttachment_ck',
  );
  await refuse(
    'An attachment naming an asset that does not exist',
    ready(attPng, randomUUID(), 'image/png'),
    [547],
    'MessageAttachment_assetId_fkey',
  );
  await expectAccepted(
    session,
    'Three uploads made ready with their verified assets',
    `${ready(attPng, assetPng, 'image/png')}
     ${ready(attPdf, assetPdf, 'application/pdf')}
     ${ready(attLoose, assetLoose, 'image/jpeg')}`,
  );
  await refuse(
    'One asset made ready for two attachments',
    ready(attOther, assetPng, 'image/png'),
    [2601],
    'MessageAttachment_assetId_key',
  );
  const LIFECYCLE = 'does not fit its lifecycle';
  await refuse(
    'A ready attachment re-pointed at another asset',
    `UPDATE [dbo].[MessageAttachment] SET [assetId]=N'${assetJpeg}' WHERE [id]=N'${attPdf}';`,
    [51306],
    LIFECYCLE,
  );
  await refuse(
    'A ready attachment returned to pending',
    `UPDATE [dbo].[MessageAttachment] SET [state]=N'pending',[assetId]=NULL,[mediaType]=NULL,[byteSize]=NULL WHERE [id]=N'${attPdf}';`,
    [51306],
    LIFECYCLE,
  );
  await refuse(
    "An attachment's uploader rewritten",
    `UPDATE [dbo].[MessageAttachment] SET [uploaderUserId]=N'${learner}' WHERE [id]=N'${attOther}';`,
    [51306],
    LIFECYCLE,
  );
  await refuse(
    "An upload attached to someone else's message",
    attach(attLoose, mTeacher, 0),
    [51306],
    'belongs to a message of the person who uploaded it',
  );
  await refuse(
    'An upload attached to a message of another conversation',
    attach(attPng, mRequester, 0),
    [547],
    'MessageAttachment_message_fkey',
  );
  await refuse(
    'An attachment at a fifth place',
    attach(attPng, mTeacher, 4),
    [547],
    'MessageAttachment_ck',
  );
  await expectAccepted(
    session,
    "Two uploads attached to the teacher's message at places 0 and 1, a third made ready",
    `${attach(attPng, mTeacher, 0)}
     ${attach(attPdf, mTeacher, 1)}
     ${ready(attOther, assetJpeg, 'image/jpeg')}`,
  );
  await refuse(
    'Two attachments at one place of a message',
    attach(attOther, mTeacher, 0),
    [2601],
    'MessageAttachment_position_key',
  );
  await refuse(
    'An attached upload re-pointed at another message',
    `UPDATE [dbo].[MessageAttachment] SET [messageId]=N'${mPlain}' WHERE [id]=N'${attPng}';`,
    [51306],
    LIFECYCLE,
  );
  await refuse(
    'A sent attachment released outside disposal',
    `UPDATE [dbo].[MessageAttachment] SET [state]=N'releasing',[assetId]=NULL,[messageId]=NULL,[position]=NULL WHERE [id]=N'${attPdf}';`,
    [51306],
    'released only through',
  );
  await refuse(
    'An attachment removed before it is released',
    `DELETE FROM [dbo].[MessageAttachment] WHERE [id]=N'${attOther}';`,
    [51306],
    'removed only once released',
  );
  await expectAccepted(
    session,
    'An unsent upload released and removed',
    `UPDATE [dbo].[MessageAttachment] SET [state]=N'releasing',[assetId]=NULL WHERE [id]=N'${attOther}';
     DELETE FROM [dbo].[MessageAttachment] WHERE [id]=N'${attOther}';`,
  );

  // ---- read positions (51307) ----------------------------------------------------------
  const readAt = (conversationId: string, userId: string, sequence: number): string =>
    `INSERT INTO [dbo].[MessageReadState] ([conversationId],[userId],[lastReadSequence]) VALUES (N'${conversationId}',N'${userId}',${String(sequence)});`;
  await refuse(
    'A read position for someone who is not a participant',
    readAt(taught, outsider, 0),
    [547],
    'MessageReadState_participant_fkey',
  );
  await refuse(
    'A read position below zero',
    readAt(taught, learner, -1),
    [547],
    'MessageReadState_ck',
  );
  await refuse(
    'A read position past the last message',
    readAt(taught, learner, 99),
    [51307],
    'cannot pass the last message',
  );
  await expectAccepted(
    session,
    'Read positions recorded, then moved forward',
    `${readAt(taught, learner, 1)}
     ${readAt(taught, teacher, 0)}
     UPDATE [dbo].[MessageReadState] SET [lastReadSequence]=3,[updatedAt]=SYSUTCDATETIME() WHERE [conversationId]=N'${taught}' AND [userId]=N'${learner}';`,
  );
  await refuse(
    'A second read position for one participant',
    readAt(taught, learner, 3),
    [2627],
    'MessageReadState_pkey',
  );
  await refuse(
    'A read position moved backwards',
    `UPDATE [dbo].[MessageReadState] SET [lastReadSequence]=2 WHERE [conversationId]=N'${taught}' AND [userId]=N'${learner}';`,
    [51307],
    'never moves backwards',
  );

  // ---- blocks ---------------------------------------------------------------------------
  const block = (blocker: string, blocked: string): string =>
    `INSERT INTO [dbo].[MessagingBlock] ([blockerUserId],[blockedUserId]) VALUES (N'${blocker}',N'${blocked}');`;
  await refuse('A block of oneself', block(teacher, teacher), [547], 'MessagingBlock_ck');
  await refuse(
    'A block of an account that does not exist',
    block(teacher, randomUUID()),
    [547],
    'MessagingBlock_blockedUserId_fkey',
  );
  await refuse(
    'A block by an account that does not exist',
    block(randomUUID(), teacher),
    [547],
    'MessagingBlock_blockerUserId_fkey',
  );
  await expectAccepted(
    session,
    'Two blocks, one of an account Messaging names nowhere else',
    `${block(learner, teacher)}
     ${block(peerA, blockedOnly)}`,
  );
  await refuse(
    'A block made twice',
    block(learner, teacher),
    [2627],
    'MessagingBlock_pkey',
  );

  // ---- reports (51308) and decisions (51309) --------------------------------------------
  const filed = (
    id: string,
    conversationId: string,
    messageId: string | null,
    reporter: string,
    atSequence: number,
    reason = 'harassment',
  ): string =>
    `INSERT INTO [dbo].[MessagingReport] ([id],[conversationId],[messageId],[reporterUserId],[reason],[atSequence]) VALUES (N'${id}',N'${conversationId}',${messageId === null ? 'NULL' : `N'${messageId}'`},N'${reporter}',N'${reason}',${String(atSequence)});`;
  const FILED = 'filed open, by a current participant';
  await refuse(
    'A report by someone who is not a participant',
    filed(randomUUID(), asked, mStaff, outsider, 0),
    [51308],
    FILED,
  );
  await refuse(
    'A report by staff whose claim was released',
    filed(randomUUID(), asked, mStaff, staffOne, 0),
    [51308],
    FILED,
  );
  await refuse(
    'A report beyond what the conversation held',
    filed(randomUUID(), asked, mStaff, requester, 99),
    [51308],
    FILED,
  );
  await refuse(
    'A report filed already resolved',
    `INSERT INTO [dbo].[MessagingReport] ([id],[conversationId],[messageId],[reporterUserId],[reason],[atSequence],[state],[resolvedAt]) VALUES (N'${randomUUID()}',N'${asked}',N'${mStaff}',N'${requester}',N'spam',0,N'resolved','${at}');`,
    [51308],
    FILED,
  );
  await refuse(
    'A report for a reason outside the vocabulary',
    filed(randomUUID(), asked, mStaff, requester, 0, 'rude'),
    [547],
    'MessagingReport_ck',
  );
  await refuse(
    'A report of a message in another conversation',
    filed(randomUUID(), asked, mTeacher, requester, 0),
    [547],
    'MessagingReport_message_fkey',
  );
  await refuse(
    'A report of a conversation that does not exist',
    filed(randomUUID(), randomUUID(), null, requester, 0),
    [547],
    'MessagingReport_conversationId_fkey',
  );
  await refuse(
    'A report by an account that does not exist',
    filed(randomUUID(), asked, null, randomUUID(), 0),
    [547],
    'MessagingReport_reporterUserId_fkey',
  );
  const rWithhold = randomUUID();
  const rConversation = randomUUID();
  const rDismiss = randomUUID();
  const rResolved = randomUUID();
  await expectAccepted(
    session,
    'Four reports in the support conversation: of both messages, of the conversation, and a second of one message by staff',
    `${filed(rWithhold, asked, mStaff, requester, 2)}
     ${filed(rConversation, asked, null, requester, 2)}
     ${filed(rDismiss, asked, mRequester, staffTwo, 2, 'spam')}
     ${filed(rResolved, asked, mRequester, requester, 2, 'other')}`,
  );
  await refuse(
    'A second open report of one message by one person',
    filed(randomUUID(), asked, mStaff, requester, 2),
    [2601],
    'MessagingReport_open_key',
  );
  await refuse(
    'A second open report of one conversation by one person',
    filed(randomUUID(), asked, null, requester, 2),
    [2601],
    'MessagingReport_open_key',
  );
  const TARGET = 'target cannot change';
  await refuse(
    "A report's reason rewritten",
    `UPDATE [dbo].[MessagingReport] SET [reason]=N'safety' WHERE [id]=N'${rWithhold}';`,
    [51308],
    TARGET,
  );
  await refuse(
    "A report's target rewritten",
    `UPDATE [dbo].[MessagingReport] SET [messageId]=N'${mStaff}' WHERE [id]=N'${rDismiss}';`,
    [51308],
    TARGET,
  );
  await refuse(
    'A report resolved without its instant',
    `UPDATE [dbo].[MessagingReport] SET [state]=N'resolved' WHERE [id]=N'${rResolved}';`,
    [547],
    'MessagingReport_ck',
  );
  await expectAccepted(
    session,
    'A report resolved',
    `UPDATE [dbo].[MessagingReport] SET [state]=N'resolved',[resolvedAt]='${at}',[version]=2 WHERE [id]=N'${rResolved}';`,
  );
  await refuse(
    'A resolved report reopened',
    `UPDATE [dbo].[MessagingReport] SET [state]=N'open',[resolvedAt]=NULL WHERE [id]=N'${rResolved}';`,
    [51308],
    TARGET,
  );
  const decide = (id: string, reportId: string, action: string, by = moderator): string =>
    `INSERT INTO [dbo].[MessagingModerationDecision] ([id],[reportId],[moderatorUserId],[action]) VALUES (N'${id}',N'${reportId}',N'${by}',N'${action}');`;
  const DECISION = 'needs an open report';
  await refuse(
    'A decision outside the three actions',
    decide(randomUUID(), rWithhold, 'ban'),
    [547],
    'MessagingModerationDecision_ck',
  );
  await refuse(
    'A decision on a report that does not exist',
    decide(randomUUID(), randomUUID(), 'dismiss'),
    [547],
    'MessagingModerationDecision_reportId_fkey',
  );
  await refuse(
    'A decision by an account that does not exist',
    decide(randomUUID(), rWithhold, 'dismiss', randomUUID()),
    [547],
    'MessagingModerationDecision_moderatorUserId_fkey',
  );
  await refuse(
    'Withholding on a report that names no message',
    decide(randomUUID(), rConversation, 'withhold-message'),
    [51309],
    DECISION,
  );
  await refuse(
    'A decision on a resolved report',
    decide(randomUUID(), rResolved, 'dismiss'),
    [51309],
    DECISION,
  );
  const dWithhold = randomUUID();
  const dClose = randomUUID();
  const dDismiss = randomUUID();
  await expectAccepted(
    session,
    'Three decisions — withhold, close and dismiss — each carried out and its report resolved',
    `${decide(dWithhold, rWithhold, 'withhold-message')}
     UPDATE [dbo].[Message] SET [moderation]=N'withheld',[withheldAt]='${at}' WHERE [id]=N'${mStaff}';
     ${decide(dClose, rConversation, 'close-conversation')}
     UPDATE [dbo].[Conversation] SET [state]=N'closed',[closedReason]=N'moderation',[closedAt]='${at}',[version]=[version]+1 WHERE [id]=N'${asked}';
     ${decide(dDismiss, rDismiss, 'dismiss')}
     UPDATE [dbo].[MessagingReport] SET [state]=N'resolved',[resolvedAt]='${at}',[version]=2 WHERE [id] IN (N'${rWithhold}',N'${rConversation}',N'${rDismiss}');`,
  );
  await refuse(
    'A second decision on one report',
    decide(randomUUID(), rWithhold, 'dismiss'),
    [2627],
    'MessagingModerationDecision_reportId_key',
  );
  await refuse(
    'A decision rewritten',
    `UPDATE [dbo].[MessagingModerationDecision] SET [action]=N'dismiss' WHERE [id]=N'${dWithhold}';`,
    [51309],
    'permanent',
  );
  await refuse(
    'A decision removed',
    `DELETE FROM [dbo].[MessagingModerationDecision] WHERE [id]=N'${dDismiss}';`,
    [51309],
    'permanent',
  );
  const rAgain = randomUUID();
  await expectAccepted(
    session,
    'Once its report is resolved, the same message may be reported again',
    filed(rAgain, asked, mStaff, requester, 2),
  );
  await refuse(
    'A message to a conversation moderation closed',
    send(randomUUID(), asked, requester, 'after close'),
    [51303],
    NEEDS,
  );
  await refuse(
    'A closed conversation reopened',
    `UPDATE [dbo].[Conversation] SET [state]=N'open',[closedReason]=NULL,[closedAt]=NULL WHERE [id]=N'${asked}';`,
    [51302],
    IDENTITY,
  );
  await expectAccepted(
    session,
    'With the support conversation closed, the person asking may open a new one',
    support(askedAgain, requester),
  );

  // ---- nothing cascades ------------------------------------------------------------------
  const messagingRows = async (): Promise<number> =>
    count(
      `SELECT (${MESSAGING_TABLES.map((table) => `SELECT COUNT_BIG(*) FROM [dbo].[${table}]`).join(') + (')}) AS [total];`,
    );
  const before = await messagingRows();
  // The Course's own slug reservation names it too, so it is set aside inside a
  // transaction the refusal rolls back: only Messaging's key can refuse.
  await refuse(
    'A Course deleted under its conversations',
    `BEGIN TRAN;
     BEGIN TRY
       DELETE FROM [dbo].[CourseSlugHistory] WHERE [courseId]=N'${course}';
       DELETE FROM [dbo].[Course] WHERE [id]=N'${course}';
       COMMIT TRAN;
     END TRY
     BEGIN CATCH
       IF @@TRANCOUNT > 0 ROLLBACK TRAN;
       THROW;
     END CATCH`,
    [547],
    'Conversation_courseId_fkey',
  );
  await refuse(
    'An asset deleted under its attachment',
    `DELETE FROM [dbo].[Asset] WHERE [id]=N'${assetPng}';`,
    [547],
    'MessageAttachment_assetId_fkey',
  );
  await refuse(
    'An account deleted under its block',
    `DELETE FROM [dbo].[User] WHERE [id]=N'${blockedOnly}';`,
    [547],
    'MessagingBlock_blockedUserId_fkey',
  );
  await refuse(
    'A report deleted under its decision',
    `DELETE FROM [dbo].[MessagingReport] WHERE [id]=N'${rDismiss}';`,
    [547],
    'MessagingModerationDecision_reportId_fkey',
  );
  await refuse(
    'A participant deleted under its read position',
    `DELETE FROM [dbo].[ConversationParticipant] WHERE [id]=N'${pLearner}';`,
    [547],
    'MessageReadState_participant_fkey',
  );
  await refuse(
    'A message deleted under its attachments',
    `DELETE FROM [dbo].[Message] WHERE [id]=N'${mTeacher}';`,
    [547],
    'MessageAttachment_message_fkey',
  );
  if ((await messagingRows()) !== before)
    fail('A refused deletion changed a Messaging row.');
  if (
    (await count(
      `SELECT (SELECT COUNT(*) FROM [dbo].[Course] WHERE [id]=N'${course}') + (SELECT COUNT(*) FROM [dbo].[CourseSlugHistory] WHERE [courseId]=N'${course}') AS [total];`,
    )) !== 2
  )
    fail('A refused Course deletion changed the Course or its slug reservation.');

  // ---- disposal: close and mark, release, children first ---------------------------------
  await refuse(
    'A disposal mark cleared',
    `UPDATE [dbo].[Conversation] SET [state]=N'closed',[closedReason]=N'account-closed',[closedAt]='${later}',[disposingAt]='${later}' WHERE [id]=N'${emptySupport}';
     UPDATE [dbo].[Conversation] SET [disposingAt]=NULL WHERE [id]=N'${emptySupport}';`,
    [51302],
    IDENTITY,
  );
  const marked = [taught, peers, emptySupport, askedAgain]
    .map((id) => `N'${id}'`)
    .join(',');
  const accounts = [teacher, learner, peerA, peerB, outsider, blockedOnly]
    .map((id) => `N'${id}'`)
    .join(',');
  await expectAccepted(
    session,
    'Every conversation but the moderated one disposed of through its own path, children first',
    `UPDATE [dbo].[Conversation] SET [state]=N'closed',[closedReason]=COALESCE([closedReason],N'account-closed'),[closedAt]=COALESCE([closedAt],'${later}'),[disposingAt]=COALESCE([disposingAt],'${later}') WHERE [id] IN (${marked});
     UPDATE [dbo].[MessageAttachment] SET [state]=N'releasing',[assetId]=NULL,[messageId]=NULL,[position]=NULL WHERE [conversationId] IN (${marked});
     DELETE FROM [dbo].[MessageAttachment] WHERE [conversationId] IN (${marked});
     DELETE FROM [dbo].[MessageReadState] WHERE [conversationId] IN (${marked});
     DELETE FROM [dbo].[Message] WHERE [conversationId] IN (${marked});
     DELETE FROM [dbo].[ConversationParticipant] WHERE [conversationId] IN (${marked});
     DELETE FROM [dbo].[Conversation] WHERE [id] IN (${marked});
     DELETE FROM [dbo].[MessagingBlock] WHERE [blockerUserId] IN (${accounts});
     DELETE FROM [dbo].[Asset] WHERE [id] IN (${assets.map((id) => `N'${id}'`).join(',')});
     DELETE FROM [dbo].[CourseSlugHistory] WHERE [courseId]=N'${course}';
     DELETE FROM [dbo].[Course] WHERE [id]=N'${course}';
     DELETE FROM [dbo].[User] WHERE [id] IN (${accounts});`,
  );

  // ---- exactly the permanent residue remains ----------------------------------------------
  const residue = await session.query<{ name: string; total: number; outside: number }>(
    MESSAGING_TABLES.map((table) => {
      const scoped =
        table === 'MessagingActivation'
          ? '0'
          : table === 'MessagingModerationDecision'
            ? `(SELECT COUNT_BIG(*) FROM [dbo].[${table}] d JOIN [dbo].[MessagingReport] r ON r.[id]=d.[reportId] WHERE r.[conversationId]<>N'${asked}')`
            : table === 'MessagingBlock'
              ? `(SELECT COUNT_BIG(*) FROM [dbo].[${table}])`
              : table === 'Conversation'
                ? `(SELECT COUNT_BIG(*) FROM [dbo].[${table}] WHERE [id]<>N'${asked}')`
                : `(SELECT COUNT_BIG(*) FROM [dbo].[${table}] WHERE [conversationId]<>N'${asked}')`;
      return `SELECT N'${table}' AS [name], (SELECT COUNT_BIG(*) FROM [dbo].[${table}]) AS [total], ${scoped} AS [outside]`;
    }).join(' UNION ALL ') + ';',
  );
  const expectedResidue: Readonly<Record<string, number>> = {
    MessagingActivation: 3,
    Conversation: 1,
    ConversationParticipant: 3,
    Message: 2,
    MessageAttachment: 0,
    MessageReadState: 0,
    MessagingBlock: 0,
    MessagingReport: 5,
    MessagingModerationDecision: 3,
  };
  const [left] = await session.query<{
    assets: number;
    courses: number;
    accounts: number;
  }>(`
    SELECT
      (SELECT COUNT(*) FROM [dbo].[Asset] WHERE [storageKey] LIKE N'proof/messaging/${run}/%') AS [assets],
      (SELECT COUNT(*) FROM [dbo].[Course] WHERE [id]=N'${course}') AS [courses],
      (SELECT COUNT(*) FROM [dbo].[User] WHERE [email] LIKE N'%-${run}@messaging-proof.invalid') AS [accounts];
  `);
  if (
    residue.length !== 9 ||
    residue.some(
      (row) =>
        Number(row.total) !== expectedResidue[row.name] || Number(row.outside) !== 0,
    ) ||
    Number(left?.assets ?? -1) !== 0 ||
    Number(left?.courses ?? -1) !== 0 ||
    Number(left?.accounts ?? -1) !== 4
  )
    fail(
      `The Messaging rule proofs must leave exactly the activations and the moderated support ` +
        `conversation; found ${JSON.stringify(residue)} and ${JSON.stringify(left ?? null)}.`,
    );

  report(
    'messaging rules',
    `fail closed per kind, immutable activations, typed conversation shapes, one direct ` +
      `conversation per pair and one open support conversation per person, fitting and ` +
      `never re-keyed participants with one active claim, allocated and immutable messages, ` +
      `withholding never reversed, attachments through their lifecycle to their own ` +
      `uploader's message, forward read positions, blocks, one open report per target, ` +
      `permanent decisions, every key refusing nothing, no cascade, disposal children ` +
      `first; ${String(refusals)} refusals by name, every text a NON_MESSAGING_FIXTURE ` +
      `sentinel, every row but the activations and the moderated conversation removed`,
  );
}

const MEMBERSHIP_MIGRATION = '20261009000000_phase26_membership';

/**
 * The two keys Phase 26 catalogues, and only these: both ORDINARY, bundled
 * into the protected role by the convention every earlier phase used. No
 * review, publish, finance or payment key exists, and an applicant needs
 * neither key for their own application or Membership.
 */
const MEMBERSHIP_PERMISSIONS = ['membership.administer', 'membership.read'];

/**
 * EVERY foreign key from a Phase-26 table, exactly, with its column mapping and
 * its delete action. ALL are NO ACTION: nothing cascades, inside the context or
 * out of it. Identity's User is the only external edge. A Membership reaches
 * its source application by a composite key that carries the applicant and
 * the type, and an intent its application or Membership by a composite key
 * that carries the recipient — so neither can name another account's record.
 */
const MEMBERSHIP_KEYS = [
  'MembershipApplication_applicantUserId_fkey(applicantUserId>id)>User:NO_ACTION',
  'MembershipApplication_membershipTypeId_fkey(membershipTypeId>id)>MembershipType:NO_ACTION',
  'MembershipCommunicationIntent_applicationId_fkey(applicationId>id)>MembershipApplication:NO_ACTION',
  'MembershipCommunicationIntent_application_fkey(applicationId>id,recipientUserId>applicantUserId)>MembershipApplication:NO_ACTION',
  'MembershipCommunicationIntent_membershipId_fkey(membershipId>id)>Membership:NO_ACTION',
  'MembershipCommunicationIntent_membership_fkey(membershipId>id,recipientUserId>memberUserId)>Membership:NO_ACTION',
  'MembershipCommunicationIntent_recipientUserId_fkey(recipientUserId>id)>User:NO_ACTION',
  'MembershipTypeTranslation_membershipTypeId_fkey(membershipTypeId>id)>MembershipType:NO_ACTION',
  'Membership_memberUserId_fkey(memberUserId>id)>User:NO_ACTION',
  'Membership_membershipTypeId_fkey(membershipTypeId>id)>MembershipType:NO_ACTION',
  'Membership_sourceApplicationId_fkey(sourceApplicationId>id)>MembershipApplication:NO_ACTION',
  'Membership_sourceApplication_fkey(sourceApplicationId>id,memberUserId>applicantUserId,membershipTypeId>membershipTypeId)>MembershipApplication:NO_ACTION',
].sort();

/**
 * Every unique index on a Phase-26 table, exactly: the keys; the application's
 * applicant-carrying keys the composite references reach through; one
 * Membership per approved application and the member-carrying key an intent
 * reaches through; one intent per idempotency key — and the TWO FILTERED
 * claims: one OPEN application and one ACTIVE Membership per account and type.
 */
const MEMBERSHIP_UNIQUE = [
  'MembershipApplication_applicant_key(id,applicantUserId)',
  'MembershipApplication_applicant_type_key(id,applicantUserId,membershipTypeId)',
  "MembershipApplication_open_key(applicantUserId,membershipTypeId) WHERE ([status] IN (N'submitted', N'under_review'))",
  'MembershipApplication_pkey(id)',
  'MembershipCommunicationIntent_idempotencyKey_key(idempotencyKey)',
  'MembershipCommunicationIntent_pkey(id)',
  'MembershipTypeTranslation_pkey(membershipTypeId,locale)',
  'MembershipType_pkey(id)',
  "Membership_active_key(memberUserId,membershipTypeId) WHERE ([status]=N'active')",
  'Membership_member_key(id,memberUserId)',
  'Membership_pkey(id)',
  'Membership_sourceApplicationId_key(sourceApplicationId)',
].sort();

/**
 * Every column of every Phase-26 table, in order. Stated whole so an amount,
 * currency, fee, dues, price, invoice, receipt, provider, transaction or
 * payment-state column, a `targetType`/`targetId` pair, or a copied name,
 * address, phone, age, guardian, document, note or free-text answer cannot
 * arrive unnoticed.
 */
const MEMBERSHIP_COLUMNS: Readonly<Record<string, string>> = {
  MembershipType:
    'id,state,primaryLocale,displayOrder,version,createdAt,updatedAt,publishedAt,archivedAt',
  MembershipTypeTranslation:
    'membershipTypeId,locale,title,summary,description,guidance,updatedAt',
  MembershipApplication:
    'id,applicantUserId,membershipTypeId,status,withdrawalSource,version,submittedAt,reviewStartedAt,decidedAt,withdrawnAt,updatedAt',
  Membership:
    'id,memberUserId,membershipTypeId,sourceApplicationId,status,closureSource,version,activatedAt,closedAt,updatedAt',
  MembershipCommunicationIntent:
    'id,purpose,recipientUserId,applicationId,membershipId,dueAt,state,idempotencyKey,claimedUntil,relayedAt,createdAt',
};

/**
 * Whether Phase 26 is applied, ALL OR NOTHING: either every one of its five
 * tables exists or none does.
 */
async function membershipPresent(session: SqlSession): Promise<boolean> {
  const names = MEMBERSHIP_TABLES.map((table) => `N'${table}'`).join(',');
  const [row] = await session.query<{ present: number }>(
    `SELECT COUNT(*) AS [present] FROM sys.tables WHERE [name] IN (${names});`,
  );
  const present = Number(row?.present ?? -1);
  if (present !== 0 && present !== MEMBERSHIP_TABLES.length)
    fail(
      `Phase 26 is half applied: ${String(present)} of ${String(MEMBERSHIP_TABLES.length)} ` +
        `Membership tables exist.`,
    );
  return present === MEMBERSHIP_TABLES.length;
}

/**
 * Phase 26 — what only the catalogue can prove about Membership:
 *
 *   1. NOTHING IS SEEDED: all five tables are empty after deploy — no type,
 *      application, Membership or owed mail;
 *   2. every column of every table is exactly as stated — and above all NO
 *      payment concept: no amount, currency, fee, dues, price, invoice,
 *      receipt, provider, transaction or donation column, no `targetType` or
 *      `targetId`, and nothing copied of the applicant (no name, contact,
 *      address, age, guardian, document, note or free text) — and the unique
 *      indexes are exactly the twelve above, the two claims FILTERED;
 *   3. every foreign key is exactly one of the twelve above, ALL NO ACTION and
 *      trusted: Identity's User the only external edge, a Membership's source
 *      application and an intent's record each reached by the composite key
 *      that carries the account; no other owner references a Membership table
 *      or holds a membership or applicant column;
 *   4. the CHECKs are exactly the five named rules, all trusted; the triggers
 *      are exactly the five in `MEMBERSHIP_TRIGGER_NUMBERS`, enabled, each
 *      raising exactly its own numbers from 51320–51325 on the table it
 *      guards; and Membership has no procedure;
 *   5. the vocabulary is exactly `membership.administer` and `membership.read`,
 *      described as the compiled catalogue describes them, ordinary, each
 *      bundled exactly once into the protected role and held by no other, with
 *      exactly one `membership.permissions.provisioned` record naming the two
 *      keys and this migration; and the protected bundle is exactly the
 *      compiled bundle.
 *
 * The rules themselves are proved as BEHAVIOUR by `assertMembershipRules`, and
 * through the runtime login by `db:test:permissions`.
 */
async function assertMembershipFoundation(
  session: SqlSession,
  stage: 'deploy' | 're-deploy' | 'before-migration' | 'before-donations' = 'deploy',
): Promise<void> {
  const tables = MEMBERSHIP_TABLES.map((table) => `OBJECT_ID(N'[dbo].[${table}]')`).join(
    ',',
  );
  const names = MEMBERSHIP_TABLES.map((table) => `N'${table}'`).join(',');
  if (!(await membershipPresent(session)))
    fail(`The Phase-26 Membership tables are missing after ${stage}.`);

  // ---- 1. nothing seeded --------------------------------------------------------
  const counts = await session.query<{ name: string; total: number }>(
    MEMBERSHIP_TABLES.map(
      (table) =>
        `SELECT N'${table}' AS [name], COUNT_BIG(*) AS [total] FROM [dbo].[${table}]`,
    ).join(' UNION ALL ') + ';',
  );
  const seeded = counts.filter((row) => Number(row.total) !== 0);
  if (MEMBERSHIP_TABLES.length !== 5 || counts.length !== 5 || seeded.length > 0)
    fail(
      `The Membership migration must create five empty tables and seed nothing; found ` +
        `${String(counts.length)} tables after ${stage}, seeded: ${JSON.stringify(seeded)}.`,
    );

  // ---- 2. exact columns, no payment or copied applicant data, two filtered keys ----
  const shapes = await session.query<{ name: string; columns: string }>(`
    SELECT OBJECT_NAME(c.[object_id]) AS [name],
      STRING_AGG(c.[name], N',') WITHIN GROUP (ORDER BY c.[column_id]) AS [columns]
    FROM sys.columns c WHERE c.[object_id] IN (${tables})
    GROUP BY c.[object_id];
  `);
  const shapeFindings = MEMBERSHIP_TABLES.filter(
    (table) =>
      shapes.find((row) => row.name === table)?.columns !== MEMBERSHIP_COLUMNS[table],
  );
  if (shapes.length !== 5 || shapeFindings.length > 0)
    fail(
      `Membership columns differ from the reviewed shape in ${shapeFindings.join(', ')}: ` +
        `${JSON.stringify(shapes.filter((row) => shapeFindings.includes(row.name)))}.`,
    );

  const generic = await session.query<{ name: string }>(`
    SELECT OBJECT_NAME(c.[object_id]) + N'.' + c.[name] AS [name] FROM sys.columns c
    WHERE c.[object_id] IN (${tables})
      AND (c.[name] LIKE N'%amount%' OR c.[name] LIKE N'%currency%' OR c.[name] LIKE N'%fee%'
           OR c.[name] LIKE N'%dues%' OR c.[name] LIKE N'%price%' OR c.[name] LIKE N'%payment%'
           OR c.[name] LIKE N'%invoice%' OR c.[name] LIKE N'%receipt%' OR c.[name] LIKE N'%provider%'
           OR c.[name] LIKE N'%transaction%' OR c.[name] LIKE N'%donat%' OR c.[name] LIKE N'%checkout%'
           OR c.[name] LIKE N'%target%' OR c.[name] LIKE N'%entity%' OR c.[name] LIKE N'%kind%'
           OR c.[name] LIKE N'%Type' OR c.[name] IN (N'targetType', N'targetId'));
  `);
  if (generic.length > 0)
    fail(
      `A Membership table may carry no amount, currency, fee, dues, price, payment, ` +
        `invoice, receipt, provider, transaction, donation, type or target column; found ` +
        `${JSON.stringify(generic)}.`,
    );

  // DATA-MINIMISED: the applicant's application, Membership and owed mail copy
  // nothing of the account. (A type's own words — its title, summary,
  // description and guidance — are the organisation's, not an applicant's.)
  const personal = await session.query<{ name: string }>(`
    SELECT OBJECT_NAME(c.[object_id]) + N'.' + c.[name] AS [name] FROM sys.columns c
    WHERE c.[object_id] IN (OBJECT_ID(N'[dbo].[MembershipApplication]'), OBJECT_ID(N'[dbo].[Membership]'),
                            OBJECT_ID(N'[dbo].[MembershipCommunicationIntent]'))
      AND (c.[name] LIKE N'%name%' OR c.[name] LIKE N'%email%' OR c.[name] LIKE N'%phone%'
           OR c.[name] LIKE N'%address%' OR c.[name] LIKE N'%birth%' OR c.[name] LIKE N'%guardian%'
           OR c.[name] LIKE N'%document%' OR c.[name] LIKE N'%note%' OR c.[name] LIKE N'%comment%'
           OR c.[name] LIKE N'%answer%' OR c.[name] LIKE N'%text%' OR c.[name] LIKE N'%body%'
           OR c.[name] LIKE N'%upload%' OR c.[name] LIKE N'%asset%' OR c.[name] LIKE N'%profile%'
           OR c.[name] LIKE N'%reason%' OR c.[name] LIKE N'%title%');
  `);
  if (personal.length > 0)
    fail(
      `An application, a Membership and its owed mail hold no name, contact, address, age, ` +
        `guardian, document, note, free text, upload or reason; found ${JSON.stringify(personal)}.`,
    );

  const unique = await session.query<{
    name: string;
    columns: string;
    filter: string | null;
  }>(`
    SELECT i.[name], i.[filter_definition] AS [filter],
      STRING_AGG(COL_NAME(ic.[object_id], ic.[column_id]), N',')
        WITHIN GROUP (ORDER BY ic.[key_ordinal]) AS [columns]
    FROM sys.indexes i
    JOIN sys.index_columns ic ON ic.[object_id] = i.[object_id] AND ic.[index_id] = i.[index_id]
    WHERE i.[is_unique] = 1 AND ic.[key_ordinal] > 0 AND i.[object_id] IN (${tables})
    GROUP BY i.[object_id], i.[name], i.[filter_definition];
  `);
  const describedUnique = unique
    .map(
      (row) =>
        `${row.name}(${row.columns})` +
        (row.filter === null ? '' : ` WHERE ${row.filter}`),
    )
    .sort();
  if (
    describedUnique.join(' | ') !== MEMBERSHIP_UNIQUE.join(' | ') ||
    unique.filter((row) => row.filter !== null).length !== 2
  )
    fail(
      `Membership unique indexes must be exactly the reviewed twelve, the two claims ` +
        `filtered; found ${describedUnique.join(' | ')}.`,
    );

  // ---- 3. exact keys, all NO ACTION and trusted; nothing foreign holds the context -
  const keys = await session.query<{
    name: string;
    columns: string;
    target: string;
    deletes: string;
    updates: string;
    trusted: number;
  }>(`
    SELECT fk.[name], OBJECT_NAME(fk.[referenced_object_id]) AS [target],
      fk.[delete_referential_action_desc] AS [deletes], fk.[update_referential_action_desc] AS [updates],
      CASE WHEN fk.[is_disabled] = 0 AND fk.[is_not_trusted] = 0 THEN 1 ELSE 0 END AS [trusted],
      STRING_AGG(COL_NAME(c.[parent_object_id], c.[parent_column_id]) + N'>'
        + COL_NAME(c.[referenced_object_id], c.[referenced_column_id]), N',')
        WITHIN GROUP (ORDER BY c.[constraint_column_id]) AS [columns]
    FROM sys.foreign_keys fk
    JOIN sys.foreign_key_columns c ON c.[constraint_object_id] = fk.[object_id]
    WHERE fk.[parent_object_id] IN (${tables})
    GROUP BY fk.[name], fk.[referenced_object_id], fk.[delete_referential_action_desc],
      fk.[update_referential_action_desc], fk.[is_disabled], fk.[is_not_trusted];
  `);
  const describedKeys = keys
    .map((row) => `${row.name}(${row.columns})>${row.target}:${row.deletes}`)
    .sort();
  if (
    describedKeys.join(',') !== MEMBERSHIP_KEYS.join(',') ||
    keys.some((row) => row.updates !== 'NO_ACTION' || Number(row.trusted) !== 1)
  )
    fail(
      `Membership keys must be exactly the reviewed twelve, none cascading and all ` +
        `trusted; found ${describedKeys.join(', ')}.`,
    );

  const [isolation] = await session.query<{ inbound: number; foreign: string | null }>(`
    SELECT
      (SELECT COUNT(*) FROM sys.foreign_keys
        WHERE [referenced_object_id] IN (${tables}) AND [parent_object_id] NOT IN (${tables})) AS [inbound],
      (SELECT STRING_AGG(OBJECT_NAME(c.[object_id]) + N'.' + c.[name], N',') FROM sys.columns c
        WHERE (c.[name] LIKE N'%membership%' OR c.[name] LIKE N'%applicant%'
               OR c.[name] LIKE N'%memberUser%' OR c.[name] LIKE N'%sourceApplication%')
          AND OBJECT_NAME(c.[object_id]) NOT IN (${names})
          AND OBJECTPROPERTY(c.[object_id], 'IsUserTable') = 1) AS [foreign];
  `);
  if (Number(isolation?.inbound) !== 0 || (isolation?.foreign ?? null) !== null)
    fail(
      `No other owner may reference or hold Membership schema; found ` +
        `${JSON.stringify(isolation ?? null)}.`,
    );

  // ---- 4. five trusted CHECKs, five triggers by number, no procedure ----------------
  const checks = await session.query<{ name: string; trusted: number }>(`
    SELECT [name], CASE WHEN [is_disabled] = 0 AND [is_not_trusted] = 0 THEN 1 ELSE 0 END AS [trusted]
    FROM sys.check_constraints WHERE [parent_object_id] IN (${tables});
  `);
  const expectedChecks = EXPECTED_CHECK_CONSTRAINTS.filter((entry) =>
    MEMBERSHIP_TABLES.includes(entry.table),
  )
    .map((entry) => entry.constraint)
    .sort();
  if (
    expectedChecks.length !== 5 ||
    checks
      .map((row) => row.name)
      .sort()
      .join(',') !== expectedChecks.join(',') ||
    checks.some((row) => Number(row.trusted) !== 1)
  )
    fail(
      `Membership must carry exactly its five trusted CHECKs; found ${JSON.stringify(checks)}.`,
    );

  const triggers = await session.query<{
    name: string;
    tableName: string;
    disabled: number;
    definition: string | null;
  }>(`
    SELECT t.[name], OBJECT_NAME(t.[parent_id]) AS [tableName], CAST(t.[is_disabled] AS INT) AS [disabled],
      OBJECT_DEFINITION(t.[object_id]) AS [definition]
    FROM sys.triggers t WHERE t.[parent_id] IN (${tables});
  `);
  const describedTriggers = triggers
    .map((row) => `${row.name}@${row.tableName}:${raisedNumbers(row.definition)}`)
    .sort()
    .join(',');
  const expectedTriggers = Object.entries(MEMBERSHIP_TRIGGER_NUMBERS)
    .map(([name, [table, numbers]]) => `${name}@${table}:${numbers}`)
    .sort()
    .join(',');
  if (
    describedTriggers !== expectedTriggers ||
    triggers.length !== 5 ||
    triggers.some((row) => Number(row.disabled) !== 0)
  )
    fail(
      `Membership triggers must be exactly five, enabled, raising exactly their own ` +
        `51320–51325 numbers; found ${describedTriggers}.`,
    );

  const [procedures] = await session.query<{ total: number }>(`
    SELECT COUNT(*) AS [total] FROM sys.procedures
    WHERE [name] LIKE N'Membership%' OR [name] LIKE N'Member%' OR [name] LIKE N'Application%';
  `);
  if (Number(procedures?.total) !== 0)
    fail('Phase 26 writes through its owner adapter; it must create no procedure.');

  // ---- 5. two ordinary keys, bundled once and provisioned once ---------------------
  // Membership seeded NO payment, fee, dues, donation or finance key. Phase 27's
  // three `donations.*` keys are the Donations context's own — proved exactly by
  // `assertDonationsFoundation` — so they are set aside by EXACT name rather than
  // read as the very key this check exists to forbid; any other such key, or a
  // fourth `donations.*` key, still fails here.
  const donationKeys = DONATIONS_PERMISSIONS.map((key) => `N'${key}'`).join(',');
  const permissions = await session.query<{
    key: string;
    description: string;
    bundled: number;
    held: number;
    holders: number;
  }>(`
    SELECT p.[key], p.[description],
      (SELECT COUNT(*) FROM [dbo].[RolePermission] rp JOIN [dbo].[Role] r ON r.[id] = rp.[roleId]
        WHERE r.[key] = N'platform-administrator' AND rp.[permissionKey] = p.[key]) AS [bundled],
      (SELECT COUNT(*) FROM [dbo].[RolePermission] rp WHERE rp.[permissionKey] = p.[key]) AS [held],
      (SELECT COUNT(*) FROM [dbo].[RoleAssignment] ra JOIN [dbo].[RolePermission] rp ON rp.[roleId] = ra.[roleId]
        WHERE rp.[permissionKey] = p.[key]) AS [holders]
    FROM [dbo].[Permission] p
    WHERE (p.[key] LIKE N'member%' OR p.[key] LIKE N'application%' OR p.[key] LIKE N'payment%'
       OR p.[key] LIKE N'fee%' OR p.[key] LIKE N'dues%' OR p.[key] LIKE N'donat%'
       OR p.[key] LIKE N'finance%' OR p.[key] LIKE N'refund%')
      AND p.[key] NOT IN (${donationKeys})
    ORDER BY p.[key];
  `);
  const described = new Map(
    PERMISSION_CATALOGUE.map((entry) => [entry.key as string, entry.description]),
  );
  const compiled = new Set<string>(PLATFORM_ADMINISTRATOR_PERMISSIONS);
  const gated = new Set<string>(EXTERNALLY_GATED_PERMISSIONS);
  if (
    permissions.map((row) => row.key).join(',') !== MEMBERSHIP_PERMISSIONS.join(',') ||
    !MEMBERSHIP_PERMISSIONS.every((key) => compiled.has(key) && !gated.has(key)) ||
    permissions.some(
      (row) =>
        row.description !== described.get(row.key) ||
        Number(row.bundled) !== 1 ||
        Number(row.held) !== 1 ||
        Number(row.holders) !== 0,
    )
  )
    fail(
      `The Membership vocabulary must be exactly ${MEMBERSHIP_PERMISSIONS.join(', ')}, ` +
        `described as the compiled catalogue describes them, ordinary, each bundled once into ` +
        `the protected role and held by no other; found ${JSON.stringify(permissions)}.`,
    );

  const provisioning = await session.query<{
    actorType: string;
    actorId: string | null;
    targetType: string;
    roleKey: string | null;
    afterState: string | null;
    authorisingSource: string | null;
  }>(`
    SELECT a.[actorType], a.[actorId], a.[targetType], r.[key] AS [roleKey], a.[afterState], a.[authorisingSource]
    FROM [dbo].[AuditLog] a LEFT JOIN [dbo].[Role] r ON r.[id] = a.[targetId]
    WHERE a.[action] LIKE N'membership.%' OR a.[authorisingSource] = N'${MEMBERSHIP_MIGRATION}';
  `);
  if (
    JSON.stringify(provisioning) !==
    JSON.stringify([
      {
        actorType: 'migration',
        actorId: null,
        targetType: 'role',
        roleKey: 'platform-administrator',
        afterState: '{"added":"membership.administer membership.read"}',
        authorisingSource: MEMBERSHIP_MIGRATION,
      },
    ])
  )
    fail(
      `Extending the protected bundle must leave exactly one provisioning record naming the ` +
        `two Membership keys and this migration, and nothing else of Membership; found ` +
        `${JSON.stringify(provisioning)}.`,
    );
  const [action] = await session.query<{ total: number }>(`
    SELECT COUNT(*) AS [total] FROM [dbo].[AuditLog]
    WHERE [action] = N'membership.permissions.provisioned' AND [targetType] = N'role';
  `);
  if (Number(action?.total ?? -1) !== 1)
    fail(
      'The provisioning record must carry the action membership.permissions.provisioned.',
    );

  // Once Phase 29 is rolled back the database's bundle lacks the two bundled
  // Migration keys the compiled bundle now carries, and once Phase 27 is too it
  // lacks the two bundled Donations keys as well.
  const bundled = await assertProtectedBundleExcludesGated(session);
  const compiledBundle = compiledBundleAt(
    stage === 'deploy' || stage === 're-deploy' ? 'current' : stage,
  ).length;
  if (bundled !== compiledBundle)
    fail(
      `The protected bundle holds ${String(bundled)} keys; the compiled bundle holds ` +
        `${String(compiledBundle)} at ${stage}.`,
    );

  report(
    'membership schema',
    'five empty tables of the reviewed shape with no payment, target or applicant-copy ' +
      'column, twelve unique keys with two filtered claims, twelve trusted NO ACTION keys, ' +
      '5 CHECKs, five triggers raising 51320–51325, no procedure, two bundled ordinary keys ' +
      `provisioned once, ${String(bundled)} bundled`,
  );
}

/**
 * After the Phase-26 rollback: no Membership table, trigger, key, CHECK or
 * index, no Membership permission, bundle entry or provisioning record — and
 * the protected bundle exactly the compiled bundle less the two Membership
 * keys. Identity's User is untouched by the drop. The caller then proves the
 * earlier owners are whole at `before-membership`.
 */
async function assertMembershipRemoved(session: SqlSession): Promise<void> {
  const names = MEMBERSHIP_TABLES.map((table) => `N'${table}'`).join(',');
  const triggerNames = Object.keys(MEMBERSHIP_TRIGGER_NUMBERS)
    .map((name) => `N'${name}'`)
    .join(',');
  const keys = MEMBERSHIP_PERMISSIONS.map((key) => `N'${key}'`).join(',');
  const [row] = await session.query<Record<string, number>>(`
    SELECT
      (SELECT COUNT(*) FROM sys.tables WHERE [name] IN (${names}) OR [name] LIKE N'Membership%') AS [tables],
      (SELECT COUNT(*) FROM sys.triggers WHERE [name] IN (${triggerNames}) OR [name] LIKE N'Membership%') AS [triggers],
      (SELECT COUNT(*) FROM sys.foreign_keys
        WHERE LEFT([name], CHARINDEX(N'_', [name] + N'_') - 1) IN (${names})) AS [keys],
      (SELECT COUNT(*) FROM sys.check_constraints
        WHERE LEFT([name], CHARINDEX(N'_', [name] + N'_') - 1) IN (${names})) AS [checks],
      (SELECT COUNT(*) FROM sys.indexes
        WHERE LEFT([name], CHARINDEX(N'_', [name] + N'_') - 1) IN (${names})) AS [indexes],
      (SELECT COUNT(*) FROM sys.default_constraints
        WHERE LEFT([name], CHARINDEX(N'_', [name] + N'_') - 1) IN (${names})) AS [defaults],
      (SELECT COUNT(*) FROM [dbo].[Permission] WHERE [key] IN (${keys}) OR [key] LIKE N'membership.%') AS [permissions],
      (SELECT COUNT(*) FROM [dbo].[RolePermission] WHERE [permissionKey] IN (${keys}) OR [permissionKey] LIKE N'membership.%') AS [bundled],
      (SELECT COUNT(*) FROM [dbo].[AuditLog]
        WHERE [action] LIKE N'membership.%' OR [authorisingSource] = N'${MEMBERSHIP_MIGRATION}') AS [audit],
      (SELECT 1 - COUNT(*) FROM sys.tables WHERE [object_id] = OBJECT_ID(N'[dbo].[User]')) AS [identityBroken];
  `);
  if (Object.values(row ?? { missing: 1 }).some((value) => Number(value) !== 0))
    fail(
      `The Phase-26 rollback left a Membership object: ${JSON.stringify(row ?? null)}.`,
    );
  if (await membershipPresent(session))
    fail('The Phase-26 rollback left the Membership schema in place.');
  const bundled = await assertProtectedBundleExcludesGated(session);
  const expected = compiledBundleAt('before-membership').length;
  if (
    bundled !== expected ||
    expected !==
      PLATFORM_ADMINISTRATOR_PERMISSIONS.length -
        MEMBERSHIP_PERMISSIONS.length -
        DONATIONS_BUNDLED.length -
        MIGRATION_BUNDLED.length
  )
    fail(
      `After the Phase-26 rollback the protected bundle holds ${String(bundled)} keys; the ` +
        `compiled bundle less the two Membership, two bundled Donations and two bundled ` +
        `Migration keys holds ` +
        `${String(expected)}.`,
    );
  report(
    'membership rollback',
    `every Membership table, key, index, CHECK, trigger, permission and provisioning ` +
      `record removed, User whole; ${String(bundled)} keys still bundled`,
  );
}

/**
 * Phase 26 — THE RULES, proved as behaviour against the re-deployed schema
 * with NON_MEMBERSHIP_FIXTURE sentinels only, through the migration login (the
 * runtime's own posture is `db:test:permissions`'s, where the identifying
 * columns are DENY besides):
 *
 *   - a type begins as a draft at version one (51320); its states carry
 *     exactly their instants, its locale is served and its position bounded
 *     (…_ck); it is published only with its primary locale's words (51321);
 *     it never returns to draft, never goes straight from draft to archived,
 *     keeps its primary locale and creation instant and moves one version at
 *     a time (51320) — while an archived type may be republished;
 *   - words are in a served locale and never blank (…_ck), and never change
 *     their type or locale (51320);
 *   - an application is made only as `submitted` at version one (51322), only
 *     on a PUBLISHED type and only while its account holds no ACTIVE
 *     Membership of it (51323); one OPEN application per account and type (the
 *     filtered key); it moves only submitted → under review | withdrawn and
 *     under review → approved | rejected | withdrawn, one version at a time,
 *     keeps its applicant, type and submission instant, and never changes once
 *     decided or withdrawn (51322); its instants and withdrawal source fit its
 *     status (…_ck); re-application after a withdrawal or a closed Membership
 *     is allowed;
 *   - a Membership is made only ACTIVE at version one, from an APPROVED
 *     application, on a PUBLISHED type (51324), only from its OWN application
 *     — the same applicant and the same type (the composite key) — once per
 *     application (the key) and once ACTIVE per account and type (the
 *     filtered key); it keeps its member, type, source and activation instant,
 *     moves only active → closed one version at a time and never reopens
 *     (51324); its closure carries who closed it (…_ck);
 *   - an intent is one of six purposes naming exactly the one record its
 *     purpose describes (…_ck), owed only to that record's own applicant or
 *     member (the composite keys), once per idempotency key (the key); it is
 *     relayed or abandoned once and never reopened or re-keyed (51325);
 *   - nothing cascades: an account, a type, an application and a Membership
 *     are never deleted from under what names them.
 *
 * Every row the proofs write is then removed, children first, which shows the
 * context can be emptied without a cascade; the synthetic accounts go with it.
 */
async function assertMembershipRules(session: SqlSession): Promise<void> {
  const run = randomUUID().replaceAll('-', '').slice(0, 16);
  const at = '2026-10-09T00:00:00';
  const later = '2026-10-09T01:00:00';
  const decided = '2026-10-09T02:00:00';
  const closedAt = '2026-10-09T03:00:00';
  let refusals = 0;
  const refuse = async (
    label: string,
    statement: string,
    numbers: readonly number[],
    rule: string,
  ): Promise<void> => {
    await expectRefusal(session, label, statement, numbers, rule);
    refusals += 1;
  };
  const count = async (statement: string): Promise<number> => {
    const [row] = await session.query<{ total: number }>(statement);
    return Number(row?.total ?? -1);
  };
  const DRAFT = 'begins as a draft';
  const KEEPS = 'keeps its identity and never returns to draft';
  const WORDS = 'only with its primary locale';
  const LOCALE = 'never changes its type or locale';
  const LIFECYCLE = 'moves only along its lifecycle';
  const SUBMITTED = 'begins as submitted';
  const OPEN = 'needs a published type and no active Membership';
  const ACTIVE = 'begins active, from its own approved application';
  const REOPEN = 'closed Membership never reopens';
  const ONCE = 'relayed or abandoned once and never re-keyed';

  // ---- the accounts the proofs name -----------------------------------------------
  const applicant = randomUUID();
  const other = randomUUID();
  const third = randomUUID();
  const users = [
    [applicant, 'applicant'],
    [other, 'other'],
    [third, 'third'],
  ] as const;
  for (const [user, label] of users)
    await session.query(
      `INSERT INTO [dbo].[User] ([id],[name],[email],[emailVerified],[createdAt],[updatedAt],[locale],[status],[twoFactorEnabled]) VALUES (N'${user}',N'NON_MEMBERSHIP_FIXTURE ${label}',N'${label}-${run}@membership-proof.invalid',0,SYSUTCDATETIME(),SYSUTCDATETIME(),N'en',N'active',0);`,
    );

  const type = (id: string, locale: string, order: number): string =>
    `INSERT INTO [dbo].[MembershipType] ([id],[primaryLocale],[displayOrder]) VALUES (N'${id}',N'${locale}',${String(order)});`;
  const words = (typeId: string, locale: string, title = 'title'): string =>
    `INSERT INTO [dbo].[MembershipTypeTranslation] ([membershipTypeId],[locale],[title],[summary],[description],[guidance]) VALUES (N'${typeId}',N'${locale}',N'NON_MEMBERSHIP_FIXTURE ${title}',N'NON_MEMBERSHIP_FIXTURE summary',N'NON_MEMBERSHIP_FIXTURE description',NULL);`;
  const publish = (id: string): string =>
    `UPDATE [dbo].[MembershipType] SET [state]=N'published',[publishedAt]='${at}',[archivedAt]=NULL,[version]=[version]+1,[updatedAt]='${at}' WHERE [id]=N'${id}';`;
  const archive = (id: string): string =>
    `UPDATE [dbo].[MembershipType] SET [state]=N'archived',[archivedAt]='${later}',[version]=[version]+1,[updatedAt]='${later}' WHERE [id]=N'${id}';`;
  const apply = (id: string, user: string, typeId: string): string =>
    `INSERT INTO [dbo].[MembershipApplication] ([id],[applicantUserId],[membershipTypeId],[submittedAt]) VALUES (N'${id}',N'${user}',N'${typeId}','${at}');`;
  const review = (id: string): string =>
    `UPDATE [dbo].[MembershipApplication] SET [status]=N'under_review',[reviewStartedAt]='${later}',[version]=[version]+1 WHERE [id]=N'${id}';`;
  const decide = (id: string, outcome: 'approved' | 'rejected'): string =>
    `UPDATE [dbo].[MembershipApplication] SET [status]=N'${outcome}',[decidedAt]='${decided}',[version]=[version]+1 WHERE [id]=N'${id}';`;
  const withdraw = (id: string, source: 'applicant' | 'account-closure'): string =>
    `UPDATE [dbo].[MembershipApplication] SET [status]=N'withdrawn',[withdrawalSource]=N'${source}',[withdrawnAt]='${later}',[version]=[version]+1 WHERE [id]=N'${id}';`;
  const member = (
    id: string,
    user: string,
    typeId: string,
    applicationId: string,
  ): string =>
    `INSERT INTO [dbo].[Membership] ([id],[memberUserId],[membershipTypeId],[sourceApplicationId],[activatedAt]) VALUES (N'${id}',N'${user}',N'${typeId}',N'${applicationId}','${decided}');`;
  const close = (id: string, source: 'member' | 'operator'): string =>
    `UPDATE [dbo].[Membership] SET [status]=N'closed',[closureSource]=N'${source}',[closedAt]='${closedAt}',[version]=[version]+1 WHERE [id]=N'${id}';`;
  const intent = (
    id: string,
    purpose: string,
    recipient: string,
    record: { readonly application?: string; readonly membership?: string },
    key: string,
  ): string =>
    `INSERT INTO [dbo].[MembershipCommunicationIntent] ([id],[purpose],[recipientUserId],[applicationId],[membershipId],[dueAt],[idempotencyKey]) VALUES (N'${id}',N'${purpose}',N'${recipient}',${record.application === undefined ? 'NULL' : `N'${record.application}'`},${record.membership === undefined ? 'NULL' : `N'${record.membership}'`},'${at}',N'non-membership-fixture-${run}-${key}');`;

  // ---- a type begins as a draft and is published only with its words ---------------
  await refuse(
    'A type inserted published',
    `INSERT INTO [dbo].[MembershipType] ([id],[state],[primaryLocale],[displayOrder],[publishedAt]) VALUES (N'${randomUUID()}',N'published',N'en',0,'${at}');`,
    [51320],
    DRAFT,
  );
  await refuse(
    'A type inserted at version two',
    `INSERT INTO [dbo].[MembershipType] ([id],[primaryLocale],[displayOrder],[version]) VALUES (N'${randomUUID()}',N'en',0,2);`,
    [51320],
    DRAFT,
  );
  for (const [label, statement] of [
    [
      'A type beyond the display bound',
      `INSERT INTO [dbo].[MembershipType] ([id],[primaryLocale],[displayOrder]) VALUES (N'${randomUUID()}',N'en',10000);`,
    ],
    [
      'A type in an unserved primary locale',
      `INSERT INTO [dbo].[MembershipType] ([id],[primaryLocale],[displayOrder]) VALUES (N'${randomUUID()}',N'fr',0);`,
    ],
    [
      'A draft type carrying a publication instant',
      `INSERT INTO [dbo].[MembershipType] ([id],[primaryLocale],[displayOrder],[publishedAt]) VALUES (N'${randomUUID()}',N'en',0,'${at}');`,
    ],
  ] as const)
    await refuse(label, statement, [547], 'MembershipType_ck');

  const typeOpen = randomUUID();
  const typeUrdu = randomUUID();
  const typeDraft = randomUUID();
  const typeLate = randomUUID();
  await expectAccepted(
    session,
    'Four draft types with their words, one of them in Urdu',
    `${type(typeOpen, 'en', 0)}
     ${type(typeUrdu, 'ur', 1)}
     ${type(typeDraft, 'ar', 2)}
     ${type(typeLate, 'en', 3)}
     ${words(typeOpen, 'en')}
     ${words(typeOpen, 'ur', 'عنوان')}
     ${words(typeUrdu, 'ur', 'عنوان')}
     ${words(typeDraft, 'en')}
     ${words(typeLate, 'en')}`,
  );
  for (const [label, statement] of [
    ['Words in an unserved locale', words(typeOpen, 'fr')],
    [
      'Words with a blank title',
      `INSERT INTO [dbo].[MembershipTypeTranslation] ([membershipTypeId],[locale],[title],[summary],[description],[guidance]) VALUES (N'${typeDraft}',N'ar',N'',N'NON_MEMBERSHIP_FIXTURE summary',N'NON_MEMBERSHIP_FIXTURE description',NULL);`,
    ],
    [
      'Words with blank guidance',
      `INSERT INTO [dbo].[MembershipTypeTranslation] ([membershipTypeId],[locale],[title],[summary],[description],[guidance]) VALUES (N'${typeDraft}',N'ar',N'NON_MEMBERSHIP_FIXTURE title',N'NON_MEMBERSHIP_FIXTURE summary',N'NON_MEMBERSHIP_FIXTURE description',N'');`,
    ],
  ] as const)
    await refuse(label, statement, [547], 'MembershipTypeTranslation_ck');
  await refuse(
    'A type published without its primary locale words',
    publish(typeDraft),
    [51321],
    WORDS,
  );
  await expectAccepted(
    session,
    'Three types published with their primary locale words',
    `${publish(typeOpen)} ${publish(typeUrdu)} ${publish(typeLate)}`,
  );
  await refuse(
    'A published type returned to draft',
    `UPDATE [dbo].[MembershipType] SET [state]=N'draft',[publishedAt]=NULL,[version]=[version]+1 WHERE [id]=N'${typeOpen}';`,
    [51320],
    KEEPS,
  );
  await refuse(
    'A draft type archived without publication',
    `UPDATE [dbo].[MembershipType] SET [state]=N'archived',[publishedAt]='${at}',[archivedAt]='${later}',[version]=[version]+1 WHERE [id]=N'${typeDraft}';`,
    [51320],
    KEEPS,
  );
  await refuse(
    'A type change that skips a version',
    `UPDATE [dbo].[MembershipType] SET [displayOrder]=5,[version]=[version]+2 WHERE [id]=N'${typeOpen}';`,
    [51320],
    KEEPS,
  );
  await refuse(
    "A type's primary locale rewritten",
    `UPDATE [dbo].[MembershipType] SET [primaryLocale]=N'ar',[version]=[version]+1 WHERE [id]=N'${typeOpen}';`,
    [51320],
    KEEPS,
  );
  await refuse(
    "A type's creation instant rewritten",
    `UPDATE [dbo].[MembershipType] SET [createdAt]=DATEADD(minute,-1,[createdAt]),[version]=[version]+1 WHERE [id]=N'${typeOpen}';`,
    [51320],
    KEEPS,
  );
  await refuse(
    'Words moved to another locale',
    `UPDATE [dbo].[MembershipTypeTranslation] SET [locale]=N'ar' WHERE [membershipTypeId]=N'${typeOpen}' AND [locale]=N'ur';`,
    [51320],
    LOCALE,
  );
  await refuse(
    'Words moved to another type',
    `UPDATE [dbo].[MembershipTypeTranslation] SET [membershipTypeId]=N'${typeLate}' WHERE [membershipTypeId]=N'${typeOpen}' AND [locale]=N'ur';`,
    [51320],
    LOCALE,
  );
  await expectAccepted(
    session,
    'Words replaced, a type reordered, and an archived type republished and archived again',
    `UPDATE [dbo].[MembershipTypeTranslation] SET [title]=N'NON_MEMBERSHIP_FIXTURE retitled',[updatedAt]='${later}' WHERE [membershipTypeId]=N'${typeOpen}' AND [locale]=N'en';
     UPDATE [dbo].[MembershipType] SET [displayOrder]=4,[version]=[version]+1 WHERE [id]=N'${typeOpen}';
     ${archive(typeLate)} ${publish(typeLate)}`,
  );

  // ---- an application is made submitted, on a published type ----------------------
  await refuse(
    'An application on a draft type',
    apply(randomUUID(), applicant, typeDraft),
    [51323],
    OPEN,
  );
  await refuse(
    'An application inserted under review',
    `INSERT INTO [dbo].[MembershipApplication] ([id],[applicantUserId],[membershipTypeId],[status],[submittedAt],[reviewStartedAt]) VALUES (N'${randomUUID()}',N'${applicant}',N'${typeOpen}',N'under_review','${at}','${later}');`,
    [51322],
    SUBMITTED,
  );
  for (const [label, statement] of [
    [
      'An application in a payment status',
      `INSERT INTO [dbo].[MembershipApplication] ([id],[applicantUserId],[membershipTypeId],[status],[submittedAt]) VALUES (N'${randomUUID()}',N'${applicant}',N'${typeOpen}',N'paid','${at}');`,
    ],
    [
      'A submitted application carrying a withdrawal source',
      `INSERT INTO [dbo].[MembershipApplication] ([id],[applicantUserId],[membershipTypeId],[withdrawalSource],[submittedAt]) VALUES (N'${randomUUID()}',N'${applicant}',N'${typeOpen}',N'applicant','${at}');`,
    ],
    [
      'A review that began before its submission',
      `INSERT INTO [dbo].[MembershipApplication] ([id],[applicantUserId],[membershipTypeId],[status],[submittedAt],[reviewStartedAt]) VALUES (N'${randomUUID()}',N'${applicant}',N'${typeOpen}',N'under_review','${later}','${at}');`,
    ],
  ] as const)
    await refuse(label, statement, [547], 'MembershipApplication_ck');

  // Two approvals of one account and type BEFORE either Membership exists, so
  // the second Membership reaches the filtered claim rather than 51323.
  const appA = randomUUID();
  const appB = randomUUID();
  const appC = randomUUID();
  await expectAccepted(
    session,
    'Two applications of one account and type approved in turn, and another account applying',
    `${apply(appA, applicant, typeOpen)} ${review(appA)} ${decide(appA, 'approved')}
     ${apply(appB, applicant, typeOpen)} ${review(appB)} ${decide(appB, 'approved')}
     ${apply(appC, other, typeOpen)}`,
  );
  await refuse(
    'A second open application of one account and type',
    apply(randomUUID(), other, typeOpen),
    [2601, 2627],
    'MembershipApplication_open_key',
  );
  await refuse(
    'A decision without a review',
    `UPDATE [dbo].[MembershipApplication] SET [status]=N'approved',[reviewStartedAt]='${later}',[decidedAt]='${decided}',[version]=[version]+1 WHERE [id]=N'${appC}';`,
    [51322],
    LIFECYCLE,
  );
  await refuse(
    'A transition that keeps its version',
    `UPDATE [dbo].[MembershipApplication] SET [status]=N'under_review',[reviewStartedAt]='${later}' WHERE [id]=N'${appC}';`,
    [51322],
    LIFECYCLE,
  );
  await refuse(
    'A decided application decided again',
    `UPDATE [dbo].[MembershipApplication] SET [status]=N'rejected',[version]=[version]+1 WHERE [id]=N'${appA}';`,
    [51322],
    LIFECYCLE,
  );
  await refuse(
    'An approved application withdrawn',
    `UPDATE [dbo].[MembershipApplication] SET [status]=N'withdrawn',[decidedAt]=NULL,[withdrawalSource]=N'applicant',[withdrawnAt]='${closedAt}',[version]=[version]+1 WHERE [id]=N'${appA}';`,
    [51322],
    LIFECYCLE,
  );
  await refuse(
    "An application's applicant rewritten",
    `UPDATE [dbo].[MembershipApplication] SET [applicantUserId]=N'${third}',[status]=N'under_review',[reviewStartedAt]='${later}',[version]=[version]+1 WHERE [id]=N'${appC}';`,
    [51322],
    LIFECYCLE,
  );
  await refuse(
    "An application's submission instant rewritten",
    `UPDATE [dbo].[MembershipApplication] SET [submittedAt]=DATEADD(minute,-1,[submittedAt]),[status]=N'under_review',[reviewStartedAt]='${later}',[version]=[version]+1 WHERE [id]=N'${appC}';`,
    [51322],
    LIFECYCLE,
  );

  // ---- a Membership is made active from its own approved application ---------------
  const m1 = randomUUID();
  const m2 = randomUUID();
  await expectAccepted(
    session,
    'A Membership from its approved application',
    member(m1, applicant, typeOpen, appA),
  );
  await refuse(
    'A second active Membership of one account and type',
    member(randomUUID(), applicant, typeOpen, appB),
    [2601, 2627],
    'Membership_active_key',
  );
  await refuse(
    'An application while its account holds an active Membership of the type',
    apply(randomUUID(), applicant, typeOpen),
    [51323],
    OPEN,
  );
  await refuse(
    'A Membership from a submitted application',
    member(randomUUID(), other, typeOpen, appC),
    [51324],
    ACTIVE,
  );
  await refuse(
    "A Membership naming another account's application",
    member(randomUUID(), other, typeOpen, appB),
    [547],
    'Membership_sourceApplication_fkey',
  );
  await refuse(
    'A Membership naming its application under another type',
    member(randomUUID(), applicant, typeUrdu, appB),
    [547],
    'Membership_sourceApplication_fkey',
  );
  await refuse(
    'A Membership inserted closed',
    `INSERT INTO [dbo].[Membership] ([id],[memberUserId],[membershipTypeId],[sourceApplicationId],[status],[closureSource],[activatedAt],[closedAt]) VALUES (N'${randomUUID()}',N'${applicant}',N'${typeOpen}',N'${appB}',N'closed',N'operator','${decided}','${closedAt}');`,
    [51324],
    ACTIVE,
  );
  await refuse(
    'A second Membership from one application',
    `INSERT INTO [dbo].[Membership] ([id],[memberUserId],[membershipTypeId],[sourceApplicationId],[status],[closureSource],[activatedAt],[closedAt]) VALUES (N'${randomUUID()}',N'${applicant}',N'${typeOpen}',N'${appA}',N'closed',N'operator','${decided}','${closedAt}');`,
    [2601, 2627],
    'Membership_sourceApplicationId_key',
  );
  await refuse(
    'A Membership closed by a payment',
    `UPDATE [dbo].[Membership] SET [status]=N'closed',[closureSource]=N'payment',[closedAt]='${closedAt}',[version]=[version]+1 WHERE [id]=N'${m1}';`,
    [547],
    'Membership_ck',
  );
  await refuse(
    "A Membership's activation instant rewritten",
    `UPDATE [dbo].[Membership] SET [activatedAt]=DATEADD(minute,-1,[activatedAt]),[status]=N'closed',[closureSource]=N'member',[closedAt]='${closedAt}',[version]=[version]+1 WHERE [id]=N'${m1}';`,
    [51324],
    REOPEN,
  );
  await refuse(
    'A Membership closed without a new version',
    `UPDATE [dbo].[Membership] SET [status]=N'closed',[closureSource]=N'member',[closedAt]='${closedAt}' WHERE [id]=N'${m1}';`,
    [51324],
    REOPEN,
  );
  await expectAccepted(session, 'A Membership closed by its member', close(m1, 'member'));
  await refuse(
    'A closed Membership reopened',
    `UPDATE [dbo].[Membership] SET [status]=N'active',[closureSource]=NULL,[closedAt]=NULL,[version]=[version]+1 WHERE [id]=N'${m1}';`,
    [51324],
    REOPEN,
  );
  await refuse(
    'A closed Membership closed again',
    `UPDATE [dbo].[Membership] SET [closureSource]=N'operator',[version]=[version]+1 WHERE [id]=N'${m1}';`,
    [51324],
    REOPEN,
  );

  // A type archived after an approval: the approval cannot become a Membership.
  const appE = randomUUID();
  await expectAccepted(
    session,
    'An approval on a type that is then archived',
    `${apply(appE, third, typeLate)} ${review(appE)} ${decide(appE, 'approved')} ${archive(typeLate)}`,
  );
  await refuse(
    'A Membership on an archived type',
    member(randomUUID(), third, typeLate, appE),
    [51324],
    ACTIVE,
  );
  await refuse(
    'An application on an archived type',
    apply(randomUUID(), other, typeLate),
    [51323],
    OPEN,
  );

  const appF = randomUUID();
  const appG = randomUUID();
  await expectAccepted(
    session,
    'A second Membership after the first closed, an operator closure, re-application, a rejection and two withdrawals',
    `${member(m2, applicant, typeOpen, appB)} ${close(m2, 'operator')}
     ${apply(appF, applicant, typeOpen)} ${withdraw(appF, 'applicant')}
     ${apply(appG, other, typeUrdu)} ${review(appG)} ${decide(appG, 'rejected')}
     ${withdraw(appC, 'account-closure')}`,
  );
  await refuse(
    'A withdrawn application withdrawn again',
    `UPDATE [dbo].[MembershipApplication] SET [version]=[version]+1 WHERE [id]=N'${appF}';`,
    [51322],
    LIFECYCLE,
  );

  // ---- an intent names exactly its record, owed to its own applicant or member -------
  const i1 = randomUUID();
  const i2 = randomUUID();
  const i3 = randomUUID();
  await expectAccepted(
    session,
    'Three intents, each naming its record and owed to its own applicant or member',
    `${intent(i1, 'membership.application.approved', applicant, { application: appA }, 'approved')}
     ${intent(i2, 'membership.closed', applicant, { membership: m1 }, 'closed')}
     ${intent(i3, 'membership.application.submitted', applicant, { application: appF }, 'submitted')}`,
  );
  for (const [label, statement] of [
    [
      'A closure intent naming an application',
      intent(
        randomUUID(),
        'membership.closed',
        applicant,
        { application: appA },
        'shape-1',
      ),
    ],
    [
      'An application intent naming a Membership',
      intent(
        randomUUID(),
        'membership.application.approved',
        applicant,
        { membership: m1 },
        'shape-2',
      ),
    ],
    [
      'An intent naming no record',
      intent(randomUUID(), 'membership.application.submitted', applicant, {}, 'shape-3'),
    ],
    [
      'An intent for a payment purpose',
      intent(
        randomUUID(),
        'membership.payment.due',
        applicant,
        { application: appA },
        'shape-4',
      ),
    ],
  ] as const)
    await refuse(label, statement, [547], 'MembershipCommunicationIntent_ck');
  await refuse(
    'A relayed intent without its instant',
    `UPDATE [dbo].[MembershipCommunicationIntent] SET [state]=N'relayed' WHERE [id]=N'${i3}';`,
    [547],
    'MembershipCommunicationIntent_ck',
  );
  await refuse(
    'An application intent owed to another account',
    intent(
      randomUUID(),
      'membership.application.approved',
      other,
      { application: appA },
      'foreign-1',
    ),
    [547],
    'MembershipCommunicationIntent_application_fkey',
  );
  await refuse(
    'A closure intent owed to another account',
    intent(randomUUID(), 'membership.closed', other, { membership: m1 }, 'foreign-2'),
    [547],
    'MembershipCommunicationIntent_membership_fkey',
  );
  await refuse(
    'A second intent under one idempotency key',
    intent(
      randomUUID(),
      'membership.application.approved',
      applicant,
      { application: appA },
      'approved',
    ),
    [2601, 2627],
    'MembershipCommunicationIntent_idempotencyKey_key',
  );
  await expectAccepted(
    session,
    'An intent claimed and relayed, another abandoned',
    `UPDATE [dbo].[MembershipCommunicationIntent] SET [claimedUntil]='${later}' WHERE [id]=N'${i1}';
     UPDATE [dbo].[MembershipCommunicationIntent] SET [state]=N'relayed',[relayedAt]='${later}',[claimedUntil]=NULL WHERE [id]=N'${i1}';
     UPDATE [dbo].[MembershipCommunicationIntent] SET [state]=N'abandoned' WHERE [id]=N'${i2}';`,
  );
  await refuse(
    'A relayed intent reopened',
    `UPDATE [dbo].[MembershipCommunicationIntent] SET [state]=N'pending',[relayedAt]=NULL WHERE [id]=N'${i1}';`,
    [51325],
    ONCE,
  );
  await refuse(
    'An abandoned intent relayed',
    `UPDATE [dbo].[MembershipCommunicationIntent] SET [state]=N'relayed',[relayedAt]='${later}' WHERE [id]=N'${i2}';`,
    [51325],
    ONCE,
  );
  await refuse(
    'An intent re-purposed',
    `UPDATE [dbo].[MembershipCommunicationIntent] SET [purpose]=N'membership.application.withdrawn' WHERE [id]=N'${i3}';`,
    [51325],
    ONCE,
  );
  await refuse(
    "An intent's due instant rewritten",
    `UPDATE [dbo].[MembershipCommunicationIntent] SET [dueAt]='${later}' WHERE [id]=N'${i3}';`,
    [51325],
    ONCE,
  );
  await refuse(
    "An intent's key rewritten",
    `UPDATE [dbo].[MembershipCommunicationIntent] SET [idempotencyKey]=N'non-membership-fixture-${run}-rekeyed' WHERE [id]=N'${i3}';`,
    [51325],
    ONCE,
  );

  // ---- nothing cascades ------------------------------------------------------------
  const membershipRows = async (): Promise<number> =>
    count(
      `SELECT (${MEMBERSHIP_TABLES.map(
        (table) => `SELECT COUNT_BIG(*) FROM [dbo].[${table}]`,
      ).join(') + (')}) AS [total];`,
    );
  const before = await membershipRows();
  await refuse(
    'An account deleted under its application',
    `DELETE FROM [dbo].[User] WHERE [id]=N'${third}';`,
    [547],
    'MembershipApplication_applicantUserId_fkey',
  );
  await refuse(
    'A type deleted under its words and applications',
    `DELETE FROM [dbo].[MembershipType] WHERE [id]=N'${typeUrdu}';`,
    [547],
    '_membershipTypeId_fkey',
  );
  await refuse(
    'An application deleted under its Membership',
    `DELETE FROM [dbo].[MembershipApplication] WHERE [id]=N'${appB}';`,
    [547],
    'Membership_sourceApplication',
  );
  await refuse(
    'A Membership deleted under its owed mail',
    `DELETE FROM [dbo].[Membership] WHERE [id]=N'${m1}';`,
    [547],
    'MembershipCommunicationIntent_membership',
  );
  if ((await membershipRows()) !== before)
    fail('A refused deletion changed a Membership row.');

  // ---- every fixture row removed, children first, without a cascade -----------------
  const accounts = users.map(([user]) => `N'${user}'`).join(',');
  const types = [typeOpen, typeUrdu, typeDraft, typeLate]
    .map((id) => `N'${id}'`)
    .join(',');
  await expectAccepted(
    session,
    'Every Membership fixture row removed, children first, then its accounts',
    `DELETE FROM [dbo].[MembershipCommunicationIntent] WHERE [recipientUserId] IN (${accounts});
     DELETE FROM [dbo].[Membership] WHERE [memberUserId] IN (${accounts});
     DELETE FROM [dbo].[MembershipApplication] WHERE [applicantUserId] IN (${accounts});
     DELETE FROM [dbo].[MembershipTypeTranslation] WHERE [membershipTypeId] IN (${types});
     DELETE FROM [dbo].[MembershipType] WHERE [id] IN (${types});
     DELETE FROM [dbo].[User] WHERE [id] IN (${accounts});`,
  );
  const [left] = await session.query<{ membership: number; accounts: number }>(`
    SELECT
      (${MEMBERSHIP_TABLES.map((table) => `SELECT COUNT_BIG(*) FROM [dbo].[${table}]`).join(') + (')}) AS [membership],
      (SELECT COUNT(*) FROM [dbo].[User] WHERE [email] LIKE N'%-${run}@membership-proof.invalid') AS [accounts];
  `);
  if (Number(left?.membership ?? -1) !== 0 || Number(left?.accounts ?? -1) !== 0)
    fail(
      `The Membership rule proofs left a fixture row behind: ${JSON.stringify(left ?? null)}.`,
    );

  report(
    'membership rules',
    `draft-first types published only with their words and never back to draft, fixed ` +
      `words, submitted-first applications on published types along their lifecycle with ` +
      `one open per account and type, Memberships only from their own approval on a ` +
      `published type with one active per account and type and no reopening, intents ` +
      `naming exactly their record and owed only to its own account, once-only relay, no ` +
      `cascade; ${String(refusals)} refusals by name, every text a NON_MEMBERSHIP_FIXTURE ` +
      `sentinel, every row removed`,
  );
}

const DONATIONS_MIGRATION = '20261010000000_phase27_donations';

/**
 * The three keys Phase 27 catalogues, and only these. `donations.read` and
 * `donations.administer` are ORDINARY and join the protected bundle by the
 * convention every earlier phase used; `donations.refund` is EXTERNALLY GATED —
 * who may return a donor's money is the organisation's finance decision — so it
 * is catalogued, bundled into no role and held by nobody. A donor needs no key
 * for their own donations.
 */
const DONATIONS_PERMISSIONS = [
  'donations.administer',
  'donations.read',
  'donations.refund',
];

/** The two of them the protected bundle carries. */
const DONATIONS_BUNDLED = ['donations.administer', 'donations.read'];

/** The one refund authority, gated and bundled nowhere. */
const DONATIONS_REFUND_PERMISSION = 'donations.refund';

/**
 * EVERY foreign key from a Phase-27 table, exactly, with its column mapping and
 * its delete action. ALL are NO ACTION: nothing cascades, inside the context or
 * out of it, and nothing financial is ever deleted from under what names it.
 * Identity's User is the only external edge. An intent names its donation by a
 * composite key that carries the donor, and a refund intent its refund by a
 * composite key that carries the donation — so owed mail can only ever go to
 * that donation's own linked donor, about that donation's own refund.
 */
const DONATIONS_KEYS = [
  'DonationCampaignCurrency_campaignId_fkey(campaignId>id)>DonationCampaign:NO_ACTION',
  'DonationCampaignTranslation_campaignId_fkey(campaignId>id)>DonationCampaign:NO_ACTION',
  'DonationCommunicationIntent_donationId_fkey(donationId>id)>Donation:NO_ACTION',
  'DonationCommunicationIntent_donor_fkey(donationId>id,recipientUserId>donorUserId)>Donation:NO_ACTION',
  'DonationCommunicationIntent_recipientUserId_fkey(recipientUserId>id)>User:NO_ACTION',
  'DonationCommunicationIntent_refundId_fkey(refundId>id)>DonationRefund:NO_ACTION',
  'DonationCommunicationIntent_refund_fkey(refundId>id,donationId>donationId)>DonationRefund:NO_ACTION',
  'DonationProviderEvent_donationId_fkey(donationId>id)>Donation:NO_ACTION',
  'DonationRefund_donationId_fkey(donationId>id)>Donation:NO_ACTION',
  'DonationRefund_requestedByUserId_fkey(requestedByUserId>id)>User:NO_ACTION',
  'Donation_campaignId_fkey(campaignId>id)>DonationCampaign:NO_ACTION',
  'Donation_donorUserId_fkey(donorUserId>id)>User:NO_ACTION',
].sort();

/**
 * Every unique index on a Phase-27 table, exactly: the keys; one donation and
 * one refund per operation (the idempotency floor beneath a duplicate submit);
 * one donation per status-token digest; the donor- and donation-carrying keys
 * the composite references reach through; one dedup record per scoped provider
 * event; one intent per idempotency key — and the THREE FILTERED scoped
 * provider references: a checkout, a payment and a refund reference each
 * unique within its provider, environment and account.
 */
const DONATIONS_UNIQUE = [
  'DonationActivation_pkey(id)',
  'DonationCampaignCurrency_pkey(campaignId,currency)',
  'DonationCampaignTranslation_pkey(campaignId,locale)',
  'DonationCampaign_pkey(id)',
  'DonationCommunicationIntent_idempotencyKey_key(idempotencyKey)',
  'DonationCommunicationIntent_pkey(id)',
  'DonationProviderEvent_event_key(provider,environment,accountKey,eventId)',
  'DonationProviderEvent_pkey(id)',
  'DonationRefund_donation_key(id,donationId)',
  'DonationRefund_operationId_key(operationId)',
  'DonationRefund_pkey(id)',
  'DonationRefund_reference_key(provider,environment,accountKey,refundReference) WHERE ([refundReference] IS NOT NULL)',
  'Donation_checkout_key(provider,environment,accountKey,checkoutReference) WHERE ([checkoutReference] IS NOT NULL)',
  'Donation_donor_key(id,donorUserId)',
  'Donation_operationId_key(operationId)',
  'Donation_payment_key(provider,environment,accountKey,paymentReference) WHERE ([paymentReference] IS NOT NULL)',
  'Donation_pkey(id)',
  'Donation_statusTokenDigest_key(statusTokenDigest)',
].sort();

/**
 * Every column of every Phase-27 table, in order. Stated whole so a card,
 * security code, expiry, wallet, bank or billing column, a payer email or name,
 * a raw provider payload, a stored status token or checkout URL, a float
 * amount, or a `targetType`/`targetId` pair cannot arrive unnoticed.
 */
const DONATIONS_COLUMNS: Readonly<Record<string, string>> = {
  DonationCampaign:
    'id,state,primaryLocale,displayOrder,version,createdAt,updatedAt,publishedAt,archivedAt',
  DonationCampaignTranslation: 'campaignId,locale,title,summary,description,updatedAt',
  DonationCampaignCurrency:
    'campaignId,currency,currencyExponent,minimumMinor,maximumMinor,suggested1Minor,suggested2Minor,suggested3Minor,updatedAt',
  DonationActivation:
    'id,provider,environment,accountKey,authority,authorisedBy,reference,activatedAt',
  Donation:
    'id,campaignId,donorUserId,donorReleasedAt,operationId,requestDigest,statusTokenDigest,locale,checkoutLabel,currency,currencyExponent,expectedMinor,provider,environment,accountKey,createState,checkoutReference,checkoutExpiresAt,paymentReference,state,capturedMinor,refundedMinor,refundReservedMinor,dispute,closure,cancelRequestedAt,attention,reconcileDueAt,reconcileAttempts,reconcileLeaseUntil,version,createdAt,updatedAt,succeededAt',
  DonationProviderEvent:
    'id,provider,environment,accountKey,eventId,eventType,occurredAt,receivedAt,payloadDigest,donationId,result,processedAt',
  DonationRefund:
    'id,donationId,operationId,requestDigest,currency,currencyExponent,amountMinor,state,provider,environment,accountKey,refundReference,requestedByUserId,requestedAt,completedAt,reconcileDueAt,reconcileAttempts,reconcileLeaseUntil,version',
  DonationCommunicationIntent:
    'id,purpose,donationId,refundId,recipientUserId,dueAt,state,idempotencyKey,claimedUntil,relayedAt,abandonedAt,createdAt',
};

/**
 * Whether Phase 27 is applied, ALL OR NOTHING: either every one of its eight
 * tables exists or none does.
 */
async function donationsPresent(session: SqlSession): Promise<boolean> {
  const names = DONATIONS_TABLES.map((table) => `N'${table}'`).join(',');
  const [row] = await session.query<{ present: number }>(
    `SELECT COUNT(*) AS [present] FROM sys.tables WHERE [name] IN (${names});`,
  );
  const present = Number(row?.present ?? -1);
  if (present !== 0 && present !== DONATIONS_TABLES.length)
    fail(
      `Phase 27 is half applied: ${String(present)} of ${String(DONATIONS_TABLES.length)} ` +
        `Donations tables exist.`,
    );
  return present === DONATIONS_TABLES.length;
}

/**
 * Phase 27 — what only the catalogue can prove about Donations:
 *
 *   1. NOTHING IS SEEDED: all eight tables are empty after deploy — no
 *      campaign, no donation and, above all, NO ACTIVATION, so payment
 *      initiation is off until the owner writes one;
 *   2. every column of every table is exactly as stated; EXACT MONEY — every
 *      amount a BIGINT of minor units, every currency CHAR(3) beside a TINYINT
 *      exponent, and no FLOAT, REAL, MONEY, DECIMAL or NUMERIC column anywhere;
 *      NO PAYMENT CREDENTIAL — no card, security code, expiry, wallet, bank,
 *      billing, email, phone, name, address, payload, body, secret, URL or
 *      stored token column, and no `targetType` / `targetId`; the unique
 *      indexes are exactly the eighteen above, the three provider references
 *      FILTERED;
 *   3. every foreign key is exactly one of the twelve above, ALL NO ACTION and
 *      trusted: Identity's User the only external edge, an intent's donation
 *      and refund each reached by the composite key that carries the donor or
 *      the donation; no other owner references a Donations table or holds a
 *      donation, donor or campaign column;
 *   4. the CHECKs are exactly the eleven named rules, all trusted; the
 *      triggers are exactly the ten in `DONATIONS_TRIGGER_NUMBERS`, enabled,
 *      each raising exactly its own numbers from 51340–51358 on the table it
 *      guards; and Donations has no procedure;
 *   5. the vocabulary is exactly `donations.administer`, `donations.read` and
 *      `donations.refund`, described as the compiled catalogue describes them;
 *      the first two ORDINARY, each bundled exactly once into the protected
 *      role and held by no other; `donations.refund` EXTERNALLY GATED, held by
 *      no role and no account; no `donation-refund` step-up grant exists;
 *      exactly one `donations.permissions.provisioned` record names the two
 *      bundled keys and this migration; and the protected bundle is exactly
 *      the compiled bundle.
 *
 * The rules themselves are proved as BEHAVIOUR by `assertDonationsRules`, and
 * through the runtime login by `db:test:permissions`.
 */
async function assertDonationsFoundation(
  session: SqlSession,
  stage: 'deploy' | 're-deploy' | 'before-migration' = 'deploy',
): Promise<void> {
  const tables = DONATIONS_TABLES.map((table) => `OBJECT_ID(N'[dbo].[${table}]')`).join(
    ',',
  );
  const names = DONATIONS_TABLES.map((table) => `N'${table}'`).join(',');
  if (!(await donationsPresent(session)))
    fail(`The Phase-27 Donations tables are missing after ${stage}.`);

  // ---- 0. provider identifiers compare by their exact bytes ----------------------
  // A provider's identifiers are case-sensitive; under the default collation two
  // genuine ids differing only in case would collide in a scoped unique key or
  // match each other in a lookup.
  const referenceCollations = await session.query<{
    name: string;
    collation: string | null;
  }>(`
    SELECT OBJECT_NAME(c.[object_id]) + N'.' + c.[name] AS [name], c.[collation_name] AS [collation]
    FROM sys.columns c
    WHERE (c.[object_id] = OBJECT_ID(N'[dbo].[Donation]') AND c.[name] IN (N'checkoutReference', N'paymentReference'))
       OR (c.[object_id] = OBJECT_ID(N'[dbo].[DonationRefund]') AND c.[name] = N'refundReference')
       OR (c.[object_id] = OBJECT_ID(N'[dbo].[DonationProviderEvent]') AND c.[name] = N'eventId');
  `);
  if (
    referenceCollations.length !== 4 ||
    referenceCollations.some((row) => row.collation !== 'Latin1_General_100_BIN2')
  )
    fail(
      `Every provider identifier must compare by its exact bytes after ${stage}; found ` +
        `${JSON.stringify(referenceCollations)}.`,
    );

  // ---- 1. nothing seeded, no activation ------------------------------------------
  const counts = await session.query<{ name: string; total: number }>(
    DONATIONS_TABLES.map(
      (table) =>
        `SELECT N'${table}' AS [name], COUNT_BIG(*) AS [total] FROM [dbo].[${table}]`,
    ).join(' UNION ALL ') + ';',
  );
  const seeded = counts.filter((row) => Number(row.total) !== 0);
  if (DONATIONS_TABLES.length !== 8 || counts.length !== 8 || seeded.length > 0)
    fail(
      `The Donations migration must create eight empty tables — no activation — and seed ` +
        `nothing; found ${String(counts.length)} tables after ${stage}, seeded: ` +
        `${JSON.stringify(seeded)}.`,
    );

  // ---- 2. exact columns, exact money, no credential, three filtered references ----
  const shapes = await session.query<{ name: string; columns: string }>(`
    SELECT OBJECT_NAME(c.[object_id]) AS [name],
      STRING_AGG(c.[name], N',') WITHIN GROUP (ORDER BY c.[column_id]) AS [columns]
    FROM sys.columns c WHERE c.[object_id] IN (${tables})
    GROUP BY c.[object_id];
  `);
  const shapeFindings = DONATIONS_TABLES.filter(
    (table) =>
      shapes.find((row) => row.name === table)?.columns !== DONATIONS_COLUMNS[table],
  );
  if (shapes.length !== 8 || shapeFindings.length > 0)
    fail(
      `Donations columns differ from the reviewed shape in ${shapeFindings.join(', ')}: ` +
        `${JSON.stringify(shapes.filter((row) => shapeFindings.includes(row.name)))}.`,
    );

  const money = await session.query<{ name: string }>(`
    SELECT OBJECT_NAME(c.[object_id]) + N'.' + c.[name] + N':' + t.[name]
      + N'(' + CONVERT(NVARCHAR(8), c.[max_length]) + N')' AS [name]
    FROM sys.columns c JOIN sys.types t ON t.[user_type_id] = c.[user_type_id]
    WHERE c.[object_id] IN (${tables})
      AND (t.[name] IN (N'float', N'real', N'money', N'smallmoney', N'decimal', N'numeric')
           OR (c.[name] LIKE N'%Minor' AND t.[name] <> N'bigint')
           OR (c.[name] = N'currency' AND NOT (t.[name] = N'char' AND c.[max_length] = 3))
           OR (c.[name] = N'currencyExponent' AND t.[name] <> N'tinyint'));
  `);
  const [minorColumns] = await session.query<{ total: number }>(`
    SELECT COUNT(*) AS [total] FROM sys.columns c JOIN sys.types t ON t.[user_type_id] = c.[user_type_id]
    WHERE c.[object_id] IN (${tables}) AND c.[name] LIKE N'%Minor' AND t.[name] = N'bigint';
  `);
  // Five policy amounts, four donation amounts, one refund amount.
  if (money.length > 0 || Number(minorColumns?.total) !== 10)
    fail(
      `Every Donations amount must be a BIGINT of minor units beside a CHAR(3) currency and a ` +
        `TINYINT exponent, and no FLOAT, REAL, MONEY, DECIMAL or NUMERIC column may exist; ` +
        `found ${JSON.stringify(money)} with ${String(minorColumns?.total)} BIGINT amounts.`,
    );

  const credential = await session.query<{ name: string }>(`
    SELECT OBJECT_NAME(c.[object_id]) + N'.' + c.[name] AS [name] FROM sys.columns c
    WHERE c.[object_id] IN (${tables})
      AND (c.[name] LIKE N'%card%' OR c.[name] LIKE N'%cvc%' OR c.[name] LIKE N'%cvv%'
           OR c.[name] LIKE N'%expiry%' OR c.[name] LIKE N'%iban%' OR c.[name] LIKE N'%bank%'
           OR c.[name] LIKE N'%wallet%' OR c.[name] LIKE N'%billing%' OR c.[name] LIKE N'%email%'
           OR c.[name] LIKE N'%phone%' OR c.[name] LIKE N'%address%' OR c.[name] LIKE N'%name%'
           OR c.[name] LIKE N'%password%' OR c.[name] LIKE N'%secret%' OR c.[name] LIKE N'%body%'
           OR c.[name] LIKE N'%raw%' OR c.[name] LIKE N'%url%' OR c.[name] LIKE N'%shopper%'
           OR c.[name] LIKE N'%customer%' OR c.[name] LIKE N'%payer%'
           OR (c.[name] LIKE N'%payload%' AND c.[name] <> N'payloadDigest')
           OR (c.[name] LIKE N'%token%' AND c.[name] <> N'statusTokenDigest')
           OR c.[name] LIKE N'%target%' OR c.[name] LIKE N'%entity%'
           OR c.[name] IN (N'targetType', N'targetId'));
  `);
  if (credential.length > 0)
    fail(
      `A Donations table may hold no card, security code, expiry, wallet, bank, billing, ` +
        `contact, name, address, secret, payload, body, URL, token or target column; found ` +
        `${JSON.stringify(credential)}.`,
    );

  const unique = await session.query<{
    name: string;
    columns: string;
    filter: string | null;
  }>(`
    SELECT i.[name], i.[filter_definition] AS [filter],
      STRING_AGG(COL_NAME(ic.[object_id], ic.[column_id]), N',')
        WITHIN GROUP (ORDER BY ic.[key_ordinal]) AS [columns]
    FROM sys.indexes i
    JOIN sys.index_columns ic ON ic.[object_id] = i.[object_id] AND ic.[index_id] = i.[index_id]
    WHERE i.[is_unique] = 1 AND ic.[key_ordinal] > 0 AND i.[object_id] IN (${tables})
    GROUP BY i.[object_id], i.[name], i.[filter_definition];
  `);
  const describedUnique = unique
    .map(
      (row) =>
        `${row.name}(${row.columns})` +
        (row.filter === null ? '' : ` WHERE ${row.filter}`),
    )
    .sort();
  if (
    describedUnique.join(' | ') !== DONATIONS_UNIQUE.join(' | ') ||
    unique.filter((row) => row.filter !== null).length !== 3
  )
    fail(
      `Donations unique indexes must be exactly the reviewed eighteen, the three provider ` +
        `references filtered; found ${describedUnique.join(' | ')}.`,
    );

  // ---- 3. exact keys, all NO ACTION and trusted; nothing foreign holds the context -
  const keys = await session.query<{
    name: string;
    columns: string;
    target: string;
    deletes: string;
    updates: string;
    trusted: number;
  }>(`
    SELECT fk.[name], OBJECT_NAME(fk.[referenced_object_id]) AS [target],
      fk.[delete_referential_action_desc] AS [deletes], fk.[update_referential_action_desc] AS [updates],
      CASE WHEN fk.[is_disabled] = 0 AND fk.[is_not_trusted] = 0 THEN 1 ELSE 0 END AS [trusted],
      STRING_AGG(COL_NAME(c.[parent_object_id], c.[parent_column_id]) + N'>'
        + COL_NAME(c.[referenced_object_id], c.[referenced_column_id]), N',')
        WITHIN GROUP (ORDER BY c.[constraint_column_id]) AS [columns]
    FROM sys.foreign_keys fk
    JOIN sys.foreign_key_columns c ON c.[constraint_object_id] = fk.[object_id]
    WHERE fk.[parent_object_id] IN (${tables})
    GROUP BY fk.[name], fk.[referenced_object_id], fk.[delete_referential_action_desc],
      fk.[update_referential_action_desc], fk.[is_disabled], fk.[is_not_trusted];
  `);
  const describedKeys = keys
    .map((row) => `${row.name}(${row.columns})>${row.target}:${row.deletes}`)
    .sort();
  if (
    describedKeys.join(',') !== DONATIONS_KEYS.join(',') ||
    keys.some((row) => row.updates !== 'NO_ACTION' || Number(row.trusted) !== 1)
  )
    fail(
      `Donations keys must be exactly the reviewed twelve, none cascading and all ` +
        `trusted; found ${describedKeys.join(', ')}.`,
    );

  const [isolation] = await session.query<{ inbound: number; foreign: string | null }>(`
    SELECT
      (SELECT COUNT(*) FROM sys.foreign_keys
        WHERE [referenced_object_id] IN (${tables}) AND [parent_object_id] NOT IN (${tables})) AS [inbound],
      (SELECT STRING_AGG(OBJECT_NAME(c.[object_id]) + N'.' + c.[name], N',') FROM sys.columns c
        WHERE (c.[name] LIKE N'%donation%' OR c.[name] LIKE N'%donor%' OR c.[name] LIKE N'%refund%'
               OR c.[name] LIKE N'%checkoutReference%' OR c.[name] LIKE N'%paymentReference%')
          AND OBJECT_NAME(c.[object_id]) NOT IN (${names})
          AND OBJECTPROPERTY(c.[object_id], 'IsUserTable') = 1) AS [foreign];
  `);
  if (Number(isolation?.inbound) !== 0 || (isolation?.foreign ?? null) !== null)
    fail(
      `No other owner may reference or hold Donations schema; found ` +
        `${JSON.stringify(isolation ?? null)}.`,
    );

  // ---- 4. eleven trusted CHECKs, ten triggers by number, no procedure ----------------
  const checks = await session.query<{ name: string; trusted: number }>(`
    SELECT [name], CASE WHEN [is_disabled] = 0 AND [is_not_trusted] = 0 THEN 1 ELSE 0 END AS [trusted]
    FROM sys.check_constraints WHERE [parent_object_id] IN (${tables});
  `);
  const expectedChecks = EXPECTED_CHECK_CONSTRAINTS.filter((entry) =>
    DONATIONS_TABLES.includes(entry.table),
  )
    .map((entry) => entry.constraint)
    .sort();
  if (
    expectedChecks.length !== 11 ||
    checks
      .map((row) => row.name)
      .sort()
      .join(',') !== expectedChecks.join(',') ||
    checks.some((row) => Number(row.trusted) !== 1)
  )
    fail(
      `Donations must carry exactly its eleven trusted CHECKs; found ${JSON.stringify(checks)}.`,
    );

  const triggers = await session.query<{
    name: string;
    tableName: string;
    disabled: number;
    definition: string | null;
  }>(`
    SELECT t.[name], OBJECT_NAME(t.[parent_id]) AS [tableName], CAST(t.[is_disabled] AS INT) AS [disabled],
      OBJECT_DEFINITION(t.[object_id]) AS [definition]
    FROM sys.triggers t WHERE t.[parent_id] IN (${tables});
  `);
  const describedTriggers = triggers
    .map((row) => `${row.name}@${row.tableName}:${raisedNumbers(row.definition)}`)
    .sort()
    .join(',');
  const expectedTriggers = Object.entries(DONATIONS_TRIGGER_NUMBERS)
    .map(([name, [table, numbers]]) => `${name}@${table}:${numbers}`)
    .sort()
    .join(',');
  if (
    describedTriggers !== expectedTriggers ||
    triggers.length !== 10 ||
    triggers.some((row) => Number(row.disabled) !== 0)
  )
    fail(
      `Donations triggers must be exactly ten, enabled, raising exactly their own ` +
        `51340–51358 numbers; found ${describedTriggers}.`,
    );

  const [procedures] = await session.query<{ total: number }>(`
    SELECT COUNT(*) AS [total] FROM sys.procedures
    WHERE [name] LIKE N'Donation%' OR [name] LIKE N'Donor%' OR [name] LIKE N'Payment%'
       OR [name] LIKE N'Refund%';
  `);
  if (Number(procedures?.total) !== 0)
    fail('Phase 27 writes through its owner adapter; it must create no procedure.');

  // ---- 5. two ordinary keys bundled once, one gated key held by nobody --------------
  const permissions = await session.query<{
    key: string;
    description: string;
    bundled: number;
    held: number;
    holders: number;
  }>(`
    SELECT p.[key], p.[description],
      (SELECT COUNT(*) FROM [dbo].[RolePermission] rp JOIN [dbo].[Role] r ON r.[id] = rp.[roleId]
        WHERE r.[key] = N'platform-administrator' AND rp.[permissionKey] = p.[key]) AS [bundled],
      (SELECT COUNT(*) FROM [dbo].[RolePermission] rp WHERE rp.[permissionKey] = p.[key]) AS [held],
      (SELECT COUNT(*) FROM [dbo].[RoleAssignment] ra JOIN [dbo].[RolePermission] rp ON rp.[roleId] = ra.[roleId]
        WHERE rp.[permissionKey] = p.[key]) AS [holders]
    FROM [dbo].[Permission] p
    WHERE p.[key] LIKE N'donat%' OR p.[key] LIKE N'payment%' OR p.[key] LIKE N'refund%'
       OR p.[key] LIKE N'finance%' OR p.[key] LIKE N'checkout%' OR p.[key] LIKE N'giving%'
    ORDER BY p.[key];
  `);
  const described = new Map(
    PERMISSION_CATALOGUE.map((entry) => [entry.key as string, entry.description]),
  );
  const compiled = new Set<string>(PLATFORM_ADMINISTRATOR_PERMISSIONS);
  const gated = new Set<string>(EXTERNALLY_GATED_PERMISSIONS);
  const refundGated =
    gated.has(DONATIONS_REFUND_PERMISSION) && !compiled.has(DONATIONS_REFUND_PERMISSION);
  if (
    permissions.map((row) => row.key).join(',') !== DONATIONS_PERMISSIONS.join(',') ||
    !DONATIONS_BUNDLED.every((key) => compiled.has(key) && !gated.has(key)) ||
    !refundGated ||
    permissions.some((row) => {
      const ordinary = DONATIONS_BUNDLED.includes(row.key);
      return (
        row.description !== described.get(row.key) ||
        Number(row.bundled) !== (ordinary ? 1 : 0) ||
        Number(row.held) !== (ordinary ? 1 : 0) ||
        Number(row.holders) !== 0
      );
    })
  )
    fail(
      `The Donations vocabulary must be exactly ${DONATIONS_PERMISSIONS.join(', ')}, described ` +
        `as the compiled catalogue describes them; the two ordinary keys each bundled once into ` +
        `the protected role and held by no other, and ${DONATIONS_REFUND_PERMISSION} gated and ` +
        `held by no role; found ${JSON.stringify(permissions)}.`,
    );

  const [refundGrants] = await session.query<{ total: number }>(`
    SELECT COUNT(*) AS [total] FROM [dbo].[StepUpGrant] WHERE [purpose] = N'donation-refund';
  `);
  if (Number(refundGrants?.total ?? -1) !== 0)
    fail(
      `A migrated database must hold no donation-refund step-up grant; found ` +
        `${String(refundGrants?.total)}.`,
    );

  const provisioning = await session.query<{
    actorType: string;
    actorId: string | null;
    targetType: string;
    roleKey: string | null;
    afterState: string | null;
    authorisingSource: string | null;
  }>(`
    SELECT a.[actorType], a.[actorId], a.[targetType], r.[key] AS [roleKey], a.[afterState], a.[authorisingSource]
    FROM [dbo].[AuditLog] a LEFT JOIN [dbo].[Role] r ON r.[id] = a.[targetId]
    WHERE a.[action] LIKE N'donations.%' OR a.[authorisingSource] = N'${DONATIONS_MIGRATION}';
  `);
  if (
    JSON.stringify(provisioning) !==
    JSON.stringify([
      {
        actorType: 'migration',
        actorId: null,
        targetType: 'role',
        roleKey: 'platform-administrator',
        afterState: '{"added":"donations.administer donations.read"}',
        authorisingSource: DONATIONS_MIGRATION,
      },
    ])
  )
    fail(
      `Extending the protected bundle must leave exactly one provisioning record naming the ` +
        `two ordinary Donations keys — never the gated refund key — and this migration, and ` +
        `nothing else of Donations; found ${JSON.stringify(provisioning)}.`,
    );
  const [action] = await session.query<{ total: number }>(`
    SELECT COUNT(*) AS [total] FROM [dbo].[AuditLog]
    WHERE [action] = N'donations.permissions.provisioned' AND [targetType] = N'role';
  `);
  if (Number(action?.total ?? -1) !== 1)
    fail(
      'The provisioning record must carry the action donations.permissions.provisioned.',
    );

  // Once Phase 29 is rolled back the database's bundle lacks the two bundled
  // Migration keys the compiled bundle now carries.
  const bundled = await assertProtectedBundleExcludesGated(session);
  const compiledBundle = compiledBundleAt(
    stage === 'before-migration' ? 'before-migration' : 'current',
  ).length;
  if (bundled !== compiledBundle)
    fail(
      `The protected bundle holds ${String(bundled)} keys; the compiled bundle holds ` +
        `${String(compiledBundle)} at ${stage}.`,
    );

  report(
    'donations schema',
    'eight empty tables — no activation — of the reviewed shape, BIGINT minor-unit money ' +
      'with no float or decimal and no credential, payload, URL or target column, eighteen ' +
      'unique keys with three filtered provider references, twelve trusted NO ACTION keys, ' +
      '11 CHECKs, ten triggers raising 51340–51358, no procedure, two bundled ordinary keys ' +
      `provisioned once and one gated refund key held by nobody, ${String(bundled)} bundled`,
  );
}

/**
 * After the Phase-27 rollback: no Donations table, trigger, key, CHECK, index
 * or default, no Donations permission, bundle entry, provisioning record or
 * `donation-refund` step-up grant — and the protected bundle exactly the
 * compiled bundle less the two bundled Donations keys (and the two bundled
 * Migration keys Phase 29's rollback removed first). Identity's User is
 * untouched by the drop. The caller then proves the earlier owners are whole at
 * `before-donations`.
 */
async function assertDonationsRemoved(session: SqlSession): Promise<void> {
  const names = DONATIONS_TABLES.map((table) => `N'${table}'`).join(',');
  const triggerNames = Object.keys(DONATIONS_TRIGGER_NUMBERS)
    .map((name) => `N'${name}'`)
    .join(',');
  const keys = DONATIONS_PERMISSIONS.map((key) => `N'${key}'`).join(',');
  const [row] = await session.query<Record<string, number>>(`
    SELECT
      (SELECT COUNT(*) FROM sys.tables WHERE [name] IN (${names}) OR [name] LIKE N'Donation%') AS [tables],
      (SELECT COUNT(*) FROM sys.triggers WHERE [name] IN (${triggerNames}) OR [name] LIKE N'Donation%') AS [triggers],
      (SELECT COUNT(*) FROM sys.foreign_keys
        WHERE LEFT([name], CHARINDEX(N'_', [name] + N'_') - 1) IN (${names})) AS [keys],
      (SELECT COUNT(*) FROM sys.check_constraints
        WHERE LEFT([name], CHARINDEX(N'_', [name] + N'_') - 1) IN (${names})) AS [checks],
      (SELECT COUNT(*) FROM sys.indexes
        WHERE LEFT([name], CHARINDEX(N'_', [name] + N'_') - 1) IN (${names})) AS [indexes],
      (SELECT COUNT(*) FROM sys.default_constraints
        WHERE LEFT([name], CHARINDEX(N'_', [name] + N'_') - 1) IN (${names})) AS [defaults],
      (SELECT COUNT(*) FROM [dbo].[Permission] WHERE [key] IN (${keys}) OR [key] LIKE N'donations.%') AS [permissions],
      (SELECT COUNT(*) FROM [dbo].[RolePermission] WHERE [permissionKey] IN (${keys}) OR [permissionKey] LIKE N'donations.%') AS [bundled],
      (SELECT COUNT(*) FROM [dbo].[StepUpGrant] WHERE [purpose] = N'donation-refund') AS [grants],
      (SELECT COUNT(*) FROM [dbo].[AuditLog]
        WHERE [action] LIKE N'donations.%' OR [authorisingSource] = N'${DONATIONS_MIGRATION}') AS [audit],
      (SELECT 1 - COUNT(*) FROM sys.tables WHERE [object_id] = OBJECT_ID(N'[dbo].[User]')) AS [identityBroken];
  `);
  if (Object.values(row ?? { missing: 1 }).some((value) => Number(value) !== 0))
    fail(
      `The Phase-27 rollback left a Donations object: ${JSON.stringify(row ?? null)}.`,
    );
  if (await donationsPresent(session))
    fail('The Phase-27 rollback left the Donations schema in place.');
  const bundled = await assertProtectedBundleExcludesGated(session);
  const expected = compiledBundleAt('before-donations').length;
  if (
    bundled !== expected ||
    expected !==
      PLATFORM_ADMINISTRATOR_PERMISSIONS.length -
        DONATIONS_BUNDLED.length -
        MIGRATION_BUNDLED.length
  )
    fail(
      `After the Phase-27 rollback the protected bundle holds ${String(bundled)} keys; the ` +
        `compiled bundle less the two bundled Donations and two bundled Migration keys ` +
        `holds ${String(expected)}.`,
    );
  report(
    'donations rollback',
    `every Donations table, key, index, CHECK, trigger, permission, refund grant and ` +
      `provisioning record removed, User whole; ${String(bundled)} keys still bundled`,
  );
}

/**
 * Phase 27 — THE RULES, proved as behaviour against the re-deployed schema with
 * NON_DONATION_FIXTURE sentinels and synthetic provider references only,
 * through the migration login (the runtime's own posture is
 * `db:test:permissions`'s, where identifying columns, the activation and every
 * DELETE of financial history are DENY besides):
 *
 *   - a campaign begins as a draft at version one (51340); its states carry
 *     exactly their instants, its locale is served and its position bounded
 *     (…_ck); it is published only with its primary locale's words AND a
 *     currency (51341); it never returns to draft, never goes straight from
 *     draft to archived, keeps its primary locale and creation instant and
 *     moves one version at a time (51340) — while an archived campaign may be
 *     republished; a published campaign keeps its primary words and at least
 *     one currency (51341);
 *   - words are in a served locale and never blank (…_ck), and never change
 *     campaign or locale (51340);
 *   - a currency policy is an allowlisted currency AT ITS OWN exponent (JPY 0,
 *     USD 2, KWD 3; a lower-case code or a wrong exponent refused), with
 *     positive bounds within the engineering maximum and up to three dense,
 *     distinct suggestions inside them (…_ck), never re-keyed (51340);
 *   - the activation is the one row, with only the two lawful pairings —
 *     production only `approved` with a reference, every other environment
 *     only `fixture` (…_ck) — and is immutable (51342); with no row no donation
 *     is admitted (51345);
 *   - a donation begins pending, uncaptured, at version one (51347), only for a
 *     PUBLISHED campaign (51343), only for an amount the CURRENT policy admits
 *     at the currency's own exponent (51344), only inside the activated scope —
 *     the account key compared exactly (51345) — and, linked, only for an ACTIVE
 *     account (51346); its vocabulary, digests and exact money are checked
 *     (…_vocabulary_ck, …_money_ck), one per operation and per token digest;
 *   - its facts agree (…_facts_ck), its state is EXACTLY their derivation
 *     (…_state_ck, every branch reached), its identity, request and expected
 *     money never change (51348), its facts only move forward one version at a
 *     time while a scheduling-only change keeps the version, and its
 *     reservation is always the sum of its live refunds (51349); a capture
 *     after a recorded expiry is accepted (provider truth wins); its donor link
 *     is only released, only for a CLOSED account, and never while owed mail
 *     still names it (51350, the composite key);
 *   - provider references are unique within their scope and coexist across
 *     scopes (the filtered keys);
 *   - a provider event is deduplicated within its scope, carries a result
 *     exactly when processed (…_ck), and is completed once, never re-keyed
 *     (51351);
 *   - a refund begins requested at version one (51358), only of a captured
 *     donation that is not charged back (51352), in its donation's currency and
 *     scope (51353), only by an account holding `donations.refund` NOW through
 *     a live assignment of an active role AND a live `donation-refund` step-up
 *     on a live session (51354 — every missing piece refused), and never beyond
 *     the captured amount across its live refunds, a failed one released
 *     (51355); it moves only forward, keeps its identity, sets its reference and
 *     completion once (51356) and its reference is scoped-unique;
 *   - an intent is one of three purposes naming a refund exactly when it
 *     announces one (…_ck), owed only to the donation's own linked donor and
 *     about that donation's own refund (the composite keys), once per key; it
 *     is relayed or abandoned once and never reopened or re-keyed (51357);
 *   - nothing cascades: an account, a campaign, a donation and a refund are
 *     never deleted from under what names them.
 *
 * Every row the proofs write is then removed, children first — except the
 * immutable activation, which (like every earlier phase's activation) dies
 * only with this disposable database — and the synthetic accounts, role,
 * sessions and grants go with them.
 */
async function assertDonationsRules(session: SqlSession): Promise<void> {
  const run = randomUUID().replaceAll('-', '').slice(0, 16);
  const at = '2026-10-10T00:00:00';
  const later = '2026-10-10T01:00:00';
  const settled = '2026-10-10T02:00:00';
  const closedAt = '2026-10-10T03:00:00';
  let refusals = 0;
  const refuse = async (
    label: string,
    statement: string,
    numbers: readonly number[],
    rule: string,
  ): Promise<void> => {
    await expectRefusal(session, label, statement, numbers, rule);
    refusals += 1;
  };
  const accept = (label: string, statement: string): Promise<void> =>
    expectAccepted(session, label, statement);
  const digest = (seed: string): string =>
    createHash('sha256').update(`${run}:${seed}`).digest('hex');
  const DRAFT = 'begins as a draft and keeps its identity';
  const KEEPS = 'keeps its identity and never returns to draft';
  const COMPLETE = 'published only with its primary locale';
  const WORDS = 'never changes its campaign or locale';
  const PRIMARY = 'keeps its primary locale';
  const POLICY = 'never changes its campaign, currency or exponent';
  const LAST = 'keeps at least one currency';
  const IMMUTABLE = 'activation is immutable';
  const FRESH = 'begins pending, uncaptured, at version 1';
  const PUBLISHED = 'needs a published campaign';
  const ADMITS = 'does not admit this amount';
  const ACTIVATED = 'not activated for this provider scope';
  const ACTIVE = 'needs an active account';
  const IDENTITY = 'keeps its identity';
  const FORWARD = 'facts only move forward';
  const LINK = 'only released, and only for a closed account';
  const ONCE_EVENT = 'completed once and never re-keyed';
  const REQUESTED = 'begins requested, at version 1';
  const CAPTURED = 'captured donation that is not charged back';
  const SCOPE = 'own currency and provider scope';
  const AUTHORITY = 'Refund authority is not held now';
  const OVER = 'may not exceed the captured amount';
  const BACKWARDS = 'only moves forward and keeps its identity';
  const ONCE = 'relayed or abandoned once and never re-keyed';
  const account = 'acct_rules_fixture';

  // ---- accounts, and the refund authority they may or may not hold -----------------
  const donor = randomUUID();
  const other = randomUUID();
  const lonely = randomUUID();
  const departing = randomUUID();
  const suspended = randomUUID();
  const refunder = randomUUID();
  const keyOnly = randomUUID();
  const grantOnly = randomUUID();
  const wrongPurpose = randomUUID();
  const expiredGrant = randomUUID();
  const expiredSession = randomUUID();
  const revoked = randomUUID();
  const deactivated = randomUUID();
  const inactiveHolder = randomUUID();
  const users = [
    [donor, 'donor', 'active'],
    [other, 'other', 'active'],
    [lonely, 'lonely', 'active'],
    [departing, 'departing', 'active'],
    [suspended, 'suspended', 'suspended'],
    [refunder, 'refunder', 'active'],
    [keyOnly, 'key-only', 'active'],
    [grantOnly, 'grant-only', 'active'],
    [wrongPurpose, 'wrong-purpose', 'active'],
    [expiredGrant, 'expired-grant', 'active'],
    [expiredSession, 'expired-session', 'active'],
    [revoked, 'revoked', 'active'],
    [deactivated, 'deactivated', 'active'],
    [inactiveHolder, 'inactive-holder', 'active'],
  ] as const;
  for (const [user, label, status] of users)
    await session.query(
      `INSERT INTO [dbo].[User] ([id],[name],[email],[emailVerified],[createdAt],[updatedAt],[locale],[status],[twoFactorEnabled]) VALUES (N'${user}',N'NON_DONATION_FIXTURE ${label}',N'${label}-${run}@donations-proof.invalid',0,SYSUTCDATETIME(),SYSUTCDATETIME(),N'en',N'${status}',0);`,
    );
  const refundRole = randomUUID();
  const deadRole = randomUUID();
  const sessionOf = (user: string, hours: number): string =>
    `INSERT INTO [dbo].[Session] ([id],[token],[userId],[expiresAt],[createdAt],[updatedAt]) VALUES (N'${user}',N'proof-donations-${user}',N'${user}',DATEADD(hour,${String(hours)},SYSUTCDATETIME()),SYSUTCDATETIME(),SYSUTCDATETIME());`;
  const grantOf = (user: string, purpose: string, minutes: number): string =>
    `INSERT INTO [dbo].[StepUpGrant] ([id],[userId],[sessionId],[purpose],[expiresAt]) VALUES (N'${randomUUID()}',N'${user}',N'${user}',N'${purpose}',DATEADD(minute,${String(minutes)},SYSUTCDATETIME()));`;
  await accept(
    'A synthetic refund authority, and every way of lacking it',
    `INSERT INTO [dbo].[Role] ([id],[key],[name],[description],[system]) VALUES
       (N'${refundRole}',N'proof-donations-refund-${run}',N'Synthetic donation refund proof role',N'Holds donations.refund for the migration proof only.',0),
       (N'${deadRole}',N'proof-donations-dead-${run}',N'Synthetic deactivated refund proof role',N'Holds donations.refund for the migration proof only.',0);
     INSERT INTO [dbo].[RolePermission] ([roleId],[permissionKey]) VALUES
       (N'${refundRole}',N'${DONATIONS_REFUND_PERMISSION}'),(N'${deadRole}',N'${DONATIONS_REFUND_PERMISSION}');
     INSERT INTO [dbo].[RoleAssignment] ([userId],[roleId]) VALUES
       (N'${refunder}',N'${refundRole}'),(N'${keyOnly}',N'${refundRole}'),(N'${wrongPurpose}',N'${refundRole}'),
       (N'${expiredGrant}',N'${refundRole}'),(N'${expiredSession}',N'${refundRole}'),
       (N'${deactivated}',N'${deadRole}'),(N'${inactiveHolder}',N'${refundRole}');
     INSERT INTO [dbo].[RoleAssignment] ([userId],[roleId],[revokedAt],[revokedReason]) VALUES
       (N'${revoked}',N'${refundRole}',SYSUTCDATETIME(),N'Synthetic revocation for the migration proof.');
     UPDATE [dbo].[Role] SET [deactivatedAt]=SYSUTCDATETIME() WHERE [id]=N'${deadRole}';
     ${sessionOf(refunder, 1)}
     ${sessionOf(keyOnly, 1)}
     ${sessionOf(grantOnly, 1)}
     ${sessionOf(wrongPurpose, 1)}
     ${sessionOf(expiredGrant, 1)}
     ${sessionOf(expiredSession, -1)}
     ${sessionOf(revoked, 1)}
     ${sessionOf(deactivated, 1)}
     ${sessionOf(inactiveHolder, 1)}
     ${grantOf(refunder, 'donation-refund', 30)}
     ${grantOf(grantOnly, 'donation-refund', 30)}
     ${grantOf(wrongPurpose, 'fatwa-publication', 30)}
     ${grantOf(expiredGrant, 'donation-refund', -1)}
     ${grantOf(expiredSession, 'donation-refund', 30)}
     ${grantOf(revoked, 'donation-refund', 30)}
     ${grantOf(deactivated, 'donation-refund', 30)}
     ${grantOf(inactiveHolder, 'donation-refund', 30)}`,
  );

  // ---- statements ------------------------------------------------------------------
  const campaign = (id: string, locale: string, order: number): string =>
    `INSERT INTO [dbo].[DonationCampaign] ([id],[primaryLocale],[displayOrder]) VALUES (N'${id}',N'${locale}',${String(order)});`;
  const words = (campaignId: string, locale: string, title = 'title'): string =>
    `INSERT INTO [dbo].[DonationCampaignTranslation] ([campaignId],[locale],[title],[summary],[description]) VALUES (N'${campaignId}',N'${locale}',N'NON_DONATION_FIXTURE ${title}',N'NON_DONATION_FIXTURE summary',N'NON_DONATION_FIXTURE description');`;
  const policy = (
    campaignId: string,
    currency: string,
    exponent: number,
    bounds: string,
  ): string =>
    `INSERT INTO [dbo].[DonationCampaignCurrency] ([campaignId],[currency],[currencyExponent],[minimumMinor],[maximumMinor],[suggested1Minor],[suggested2Minor],[suggested3Minor]) VALUES (N'${campaignId}',N'${currency}',${String(exponent)},${bounds});`;
  const publish = (id: string): string =>
    `UPDATE [dbo].[DonationCampaign] SET [state]=N'published',[publishedAt]='${at}',[archivedAt]=NULL,[version]=[version]+1,[updatedAt]='${at}' WHERE [id]=N'${id}';`;
  const archive = (id: string): string =>
    `UPDATE [dbo].[DonationCampaign] SET [state]=N'archived',[archivedAt]='${later}',[version]=[version]+1,[updatedAt]='${later}' WHERE [id]=N'${id}';`;
  const exponentOf: Readonly<Record<string, number>> = { USD: 2, EUR: 2, JPY: 0, KWD: 3 };
  const donation = (
    id: string,
    input: {
      readonly campaignId: string;
      readonly currency?: string;
      readonly exponent?: number;
      readonly minor?: string;
      readonly donor?: string | null;
      readonly environment?: string;
      readonly accountKey?: string;
      readonly extra?: Readonly<Record<string, string>>;
    },
  ): string => {
    const currency = input.currency ?? 'USD';
    const columns: Record<string, string> = {
      id: `N'${id}'`,
      campaignId: `N'${input.campaignId}'`,
      donorUserId:
        input.donor === undefined || input.donor === null ? 'NULL' : `N'${input.donor}'`,
      operationId: `N'${randomUUID()}'`,
      requestDigest: `'${digest(`request-${id}`)}'`,
      statusTokenDigest: `'${digest(`token-${id}-${randomUUID()}`)}'`,
      locale: `N'en'`,
      checkoutLabel: `N'NON_DONATION_FIXTURE label'`,
      currency: `'${currency}'`,
      currencyExponent: String(input.exponent ?? exponentOf[currency] ?? 2),
      expectedMinor: input.minor ?? '2500',
      provider: `N'stripe'`,
      environment: `N'${input.environment ?? 'fixture'}'`,
      accountKey: `N'${input.accountKey ?? account}'`,
      createdAt: `'${at}'`,
      updatedAt: `'${at}'`,
      ...input.extra,
    };
    return `INSERT INTO [dbo].[Donation] (${Object.keys(columns)
      .map((name) => `[${name}]`)
      .join(',')}) VALUES (${Object.values(columns).join(',')});`;
  };
  const set = (table: string, id: string, assignments: string): string =>
    `UPDATE [dbo].[${table}] SET ${assignments} WHERE [id]=N'${id}';`;
  const created = (reference: string): string =>
    `[createState]=N'created',[checkoutReference]=N'${reference}',[checkoutExpiresAt]='${later}',[version]=[version]+1`;
  const capture = (minor: string, payment: string): string =>
    `[capturedMinor]=${minor},[paymentReference]=N'${payment}',[succeededAt]='${settled}',[state]=N'succeeded',[version]=[version]+1`;
  const refund = (
    id: string,
    donationId: string,
    minor: string,
    requester: string,
    extra: Readonly<Record<string, string>> = {},
  ): string => {
    const columns: Record<string, string> = {
      id: `N'${id}'`,
      donationId: `N'${donationId}'`,
      operationId: `N'${randomUUID()}'`,
      requestDigest: `'${digest(`refund-${id}`)}'`,
      currency: `'USD'`,
      currencyExponent: '2',
      amountMinor: minor,
      provider: `N'stripe'`,
      environment: `N'fixture'`,
      accountKey: `N'${account}'`,
      requestedByUserId: `N'${requester}'`,
      requestedAt: `'${later}'`,
      ...extra,
    };
    return `INSERT INTO [dbo].[DonationRefund] (${Object.keys(columns)
      .map((name) => `[${name}]`)
      .join(',')}) VALUES (${Object.values(columns).join(',')});`;
  };
  const intent = (
    id: string,
    purpose: string,
    donationId: string,
    refundId: string | null,
    recipient: string,
    key: string,
  ): string =>
    `INSERT INTO [dbo].[DonationCommunicationIntent] ([id],[purpose],[donationId],[refundId],[recipientUserId],[dueAt],[idempotencyKey]) VALUES (N'${id}',N'${purpose}',N'${donationId}',${refundId === null ? 'NULL' : `N'${refundId}'`},N'${recipient}','${at}',N'non-donation-fixture-${run}-${key}');`;

  // ---- a campaign begins as a draft and is published only when complete ------------
  await refuse(
    'A campaign inserted published',
    `INSERT INTO [dbo].[DonationCampaign] ([id],[state],[primaryLocale],[displayOrder],[publishedAt]) VALUES (N'${randomUUID()}',N'published',N'en',0,'${at}');`,
    [51340],
    DRAFT,
  );
  await refuse(
    'A campaign inserted at version two',
    `INSERT INTO [dbo].[DonationCampaign] ([id],[primaryLocale],[displayOrder],[version]) VALUES (N'${randomUUID()}',N'en',0,2);`,
    [51340],
    DRAFT,
  );
  for (const [label, statement] of [
    ['A campaign beyond the display bound', campaign(randomUUID(), 'en', 10000)],
    ['A campaign in an unserved primary locale', campaign(randomUUID(), 'fr', 0)],
    [
      'A draft campaign carrying a publication instant',
      `INSERT INTO [dbo].[DonationCampaign] ([id],[primaryLocale],[displayOrder],[publishedAt]) VALUES (N'${randomUUID()}',N'en',0,'${at}');`,
    ],
    [
      'A campaign at version zero',
      `INSERT INTO [dbo].[DonationCampaign] ([id],[primaryLocale],[displayOrder],[version]) VALUES (N'${randomUUID()}',N'en',0,0);`,
    ],
  ] as const)
    await refuse(label, statement, [547], 'DonationCampaign_ck');

  const open = randomUUID();
  const urdu = randomUUID();
  const draft = randomUUID();
  const closing = randomUUID();
  await accept(
    'Four draft campaigns, words in three locales',
    `${campaign(open, 'en', 0)}
     ${campaign(urdu, 'ur', 1)}
     ${campaign(draft, 'ar', 2)}
     ${campaign(closing, 'en', 3)}
     ${words(open, 'en')}
     ${words(open, 'ar', 'عنوان')}
     ${words(urdu, 'ur', 'عنوان')}
     ${words(draft, 'en')}
     ${words(closing, 'en')}`,
  );
  await refuse(
    'A campaign published without its primary words',
    publish(draft),
    [51341],
    COMPLETE,
  );
  await refuse(
    'A campaign published with its words but no currency',
    publish(open),
    [51341],
    COMPLETE,
  );

  // ---- words ------------------------------------------------------------------------
  for (const [label, statement] of [
    ['Words in an unserved locale', words(open, 'fr')],
    [
      'Words with a blank title',
      `INSERT INTO [dbo].[DonationCampaignTranslation] ([campaignId],[locale],[title],[summary],[description]) VALUES (N'${draft}',N'ur',N'',N'NON_DONATION_FIXTURE summary',N'NON_DONATION_FIXTURE description');`,
    ],
    [
      'Words with a blank description',
      `INSERT INTO [dbo].[DonationCampaignTranslation] ([campaignId],[locale],[title],[summary],[description]) VALUES (N'${draft}',N'ur',N'NON_DONATION_FIXTURE title',N'NON_DONATION_FIXTURE summary',N'');`,
    ],
  ] as const)
    await refuse(label, statement, [547], 'DonationCampaignTranslation_ck');
  await refuse(
    'Words moved to another locale',
    `UPDATE [dbo].[DonationCampaignTranslation] SET [locale]=N'ur' WHERE [campaignId]=N'${open}' AND [locale]=N'ar';`,
    [51340],
    WORDS,
  );
  await refuse(
    'Words moved to another campaign',
    `UPDATE [dbo].[DonationCampaignTranslation] SET [campaignId]=N'${closing}' WHERE [campaignId]=N'${open}' AND [locale]=N'ar';`,
    [51340],
    WORDS,
  );

  // ---- currency policy: an allowlisted currency at ITS OWN exponent ------------------
  for (const [label, statement] of [
    ['JPY at two decimals', policy(draft, 'JPY', 2, '100,1000,NULL,NULL,NULL')],
    ['USD at three decimals', policy(draft, 'USD', 3, '100,1000,NULL,NULL,NULL')],
    ['KWD at two decimals', policy(draft, 'KWD', 2, '100,1000,NULL,NULL,NULL')],
    ['A lower-case currency code', policy(draft, 'usd', 2, '100,1000,NULL,NULL,NULL')],
    ['A currency off the allowlist', policy(draft, 'XAU', 2, '100,1000,NULL,NULL,NULL')],
    ['A zero minimum', policy(draft, 'USD', 2, '0,1000,NULL,NULL,NULL')],
    [
      'A maximum beyond twelve digits',
      policy(draft, 'USD', 2, '100,1000000000000,NULL,NULL,NULL'),
    ],
    ['A minimum above the maximum', policy(draft, 'USD', 2, '1001,1000,NULL,NULL,NULL')],
    [
      'A second suggestion without a first',
      policy(draft, 'USD', 2, '100,1000,NULL,500,NULL'),
    ],
    [
      'A third suggestion without a second',
      policy(draft, 'USD', 2, '100,1000,200,NULL,500'),
    ],
    ['A suggestion below the minimum', policy(draft, 'USD', 2, '100,1000,99,NULL,NULL')],
    [
      'A suggestion above the maximum',
      policy(draft, 'USD', 2, '100,1000,1001,NULL,NULL'),
    ],
    ['Two equal suggestions', policy(draft, 'USD', 2, '100,1000,500,500,NULL')],
    [
      'A third suggestion repeating the first',
      policy(draft, 'USD', 2, '100,1000,500,600,500'),
    ],
  ] as const)
    await refuse(label, statement, [547], 'DonationCampaignCurrency_ck');
  await accept(
    'JPY, USD and KWD policies, each at its own exponent, with dense suggestions',
    `${policy(open, 'USD', 2, '100,100000,500,2500,10000')}
     ${policy(open, 'JPY', 0, '100,1000000,1000,5000,NULL')}
     ${policy(open, 'KWD', 3, '1000,500000,1250,NULL,NULL')}
     ${policy(urdu, 'USD', 2, '100,100000,NULL,NULL,NULL')}
     ${policy(closing, 'USD', 2, '100,100000,NULL,NULL,NULL')}
     ${policy(closing, 'EUR', 2, '100,100000,NULL,NULL,NULL')}`,
  );
  await refuse(
    'A policy moved to another currency',
    `UPDATE [dbo].[DonationCampaignCurrency] SET [currency]='EUR' WHERE [campaignId]=N'${urdu}' AND [currency]='USD';`,
    [51340],
    POLICY,
  );
  await refuse(
    'A policy moved to another campaign',
    `UPDATE [dbo].[DonationCampaignCurrency] SET [campaignId]=N'${draft}' WHERE [campaignId]=N'${urdu}' AND [currency]='USD';`,
    [51340],
    POLICY,
  );

  // ---- the campaign lifecycle -----------------------------------------------------------
  await accept(
    'Campaigns published once complete',
    `${publish(open)} ${publish(urdu)} ${publish(closing)}`,
  );
  await refuse(
    'A published campaign returned to draft',
    set(
      'DonationCampaign',
      open,
      `[state]=N'draft',[publishedAt]=NULL,[version]=[version]+1`,
    ),
    [51340],
    KEEPS,
  );
  await refuse(
    'A draft archived without publication',
    set(
      'DonationCampaign',
      draft,
      `[state]=N'archived',[publishedAt]='${at}',[archivedAt]='${later}',[version]=[version]+1`,
    ),
    [51340],
    KEEPS,
  );
  await refuse(
    'A campaign moved two versions at once',
    set('DonationCampaign', open, `[displayOrder]=5,[version]=[version]+2`),
    [51340],
    KEEPS,
  );
  await refuse(
    'A campaign changed without a new version',
    set('DonationCampaign', open, `[displayOrder]=5`),
    [51340],
    KEEPS,
  );
  await refuse(
    "A campaign's primary locale changed",
    set('DonationCampaign', open, `[primaryLocale]=N'ar',[version]=[version]+1`),
    [51340],
    KEEPS,
  );
  await refuse(
    "A campaign's creation instant rewritten",
    set(
      'DonationCampaign',
      open,
      `[createdAt]=DATEADD(minute,-1,[createdAt]),[version]=[version]+1`,
    ),
    [51340],
    KEEPS,
  );
  await refuse(
    'An archived campaign without its archive instant',
    set('DonationCampaign', closing, `[state]=N'archived',[version]=[version]+1`),
    [547],
    'DonationCampaign_ck',
  );
  await refuse(
    "A published campaign's primary words removed",
    `DELETE FROM [dbo].[DonationCampaignTranslation] WHERE [campaignId]=N'${open}' AND [locale]=N'en';`,
    [51341],
    PRIMARY,
  );
  await accept(
    "A published campaign's other words removed",
    `DELETE FROM [dbo].[DonationCampaignTranslation] WHERE [campaignId]=N'${open}' AND [locale]=N'ar';`,
  );
  await refuse(
    "A published campaign's last currency removed",
    `DELETE FROM [dbo].[DonationCampaignCurrency] WHERE [campaignId]=N'${urdu}';`,
    [51341],
    LAST,
  );
  await accept(
    "One of a published campaign's two currencies removed",
    `DELETE FROM [dbo].[DonationCampaignCurrency] WHERE [campaignId]=N'${closing}' AND [currency]='EUR';`,
  );
  await accept(
    'A campaign archived and republished',
    `${archive(closing)} ${publish(closing)}`,
  );

  // ---- the activation: two lawful pairings, then immutable ----------------------------
  const activation = (values: string): string =>
    `INSERT INTO [dbo].[DonationActivation] ([id],[provider],[environment],[accountKey],[authority],[authorisedBy],[reference]) VALUES (${values});`;
  for (const [label, statement] of [
    [
      'A second activation row',
      activation(
        `2,N'stripe',N'fixture',N'${account}',N'fixture',N'NON_DONATION_FIXTURE owner',NULL`,
      ),
    ],
    [
      'Production under fixture authority',
      activation(
        `1,N'stripe',N'production',N'${account}',N'fixture',N'NON_DONATION_FIXTURE owner',N'evidence'`,
      ),
    ],
    [
      'Production approved without its evidence',
      activation(
        `1,N'stripe',N'production',N'${account}',N'approved',N'NON_DONATION_FIXTURE owner',NULL`,
      ),
    ],
    [
      'A sandbox approved as if production',
      activation(
        `1,N'stripe',N'sandbox',N'${account}',N'approved',N'NON_DONATION_FIXTURE owner',N'evidence'`,
      ),
    ],
    [
      'An unknown provider',
      activation(
        `1,N'paypal',N'fixture',N'${account}',N'fixture',N'NON_DONATION_FIXTURE owner',NULL`,
      ),
    ],
    [
      'An unknown environment',
      activation(
        `1,N'stripe',N'live',N'${account}',N'fixture',N'NON_DONATION_FIXTURE owner',NULL`,
      ),
    ],
    [
      'An account key with a space',
      activation(
        `1,N'stripe',N'fixture',N'acct rules',N'fixture',N'NON_DONATION_FIXTURE owner',NULL`,
      ),
    ],
    [
      'An anonymous authorisation',
      activation(`1,N'stripe',N'fixture',N'${account}',N'fixture',N'',NULL`),
    ],
  ] as const)
    await refuse(label, statement, [547], 'DonationActivation_ck');
  await accept(
    'Production approved with evidence is a lawful pairing (rolled back)',
    `BEGIN TRAN;
     ${activation(`1,N'stripe',N'production',N'${account}',N'approved',N'NON_DONATION_FIXTURE owner',N'NON_DONATION_FIXTURE evidence'`)}
     ROLLBACK TRAN;`,
  );
  await refuse(
    'A donation before any activation',
    donation(randomUUID(), { campaignId: open }),
    [51345],
    ACTIVATED,
  );
  await accept(
    'The fixture activation',
    activation(
      `1,N'stripe',N'fixture',N'${account}',N'fixture',N'NON_DONATION_FIXTURE owner',NULL`,
    ),
  );
  await refuse(
    'A second activation',
    activation(
      `1,N'stripe',N'sandbox',N'${account}',N'fixture',N'NON_DONATION_FIXTURE owner',NULL`,
    ),
    [2627],
    'DonationActivation_pkey',
  );
  await refuse(
    'The activation re-scoped',
    `UPDATE [dbo].[DonationActivation] SET [environment]=N'sandbox';`,
    [51342],
    IMMUTABLE,
  );
  await refuse(
    'The activation removed',
    'DELETE FROM [dbo].[DonationActivation];',
    [51342],
    IMMUTABLE,
  );

  // ---- a donation is admitted only as a fresh, permitted attempt ----------------------
  const extraFresh: readonly (readonly [string, Readonly<Record<string, string>>])[] = [
    ['A donation inserted ambiguous', { createState: `N'ambiguous'` }],
    ['A donation inserted at version two', { version: '2' }],
    ['A donation inserted with attention', { attention: `N'unresolved'` }],
    ['A donation inserted with a cancellation', { cancelRequestedAt: `'${at}'` }],
    [
      'A donation inserted with a payment reference',
      { paymentReference: `N'pi_rules_inserted'` },
    ],
  ];
  for (const [label, extra] of extraFresh)
    await refuse(
      label,
      donation(randomUUID(), { campaignId: open, extra }),
      [51347],
      FRESH,
    );
  await refuse(
    'A donation inserted already captured',
    donation(randomUUID(), {
      campaignId: open,
      extra: {
        createState: `N'created'`,
        checkoutReference: `N'cs_rules_${run}_inserted'`,
        checkoutExpiresAt: `'${later}'`,
        capturedMinor: '2500',
        succeededAt: `'${later}'`,
        state: `N'succeeded'`,
      },
    }),
    [51347],
    FRESH,
  );
  await refuse(
    'A donation for a draft campaign',
    donation(randomUUID(), { campaignId: draft }),
    [51343],
    PUBLISHED,
  );
  for (const [label, input] of [
    ['A donation below the minimum', { minor: '99' }],
    ['A donation above the maximum', { minor: '100001' }],
    ['A donation in a currency the campaign does not offer', { currency: 'EUR' }],
    ['A KWD donation outside its policy', { currency: 'KWD', minor: '999' }],
  ] as const)
    await refuse(
      label,
      donation(randomUUID(), { campaignId: open, ...input }),
      [51344],
      ADMITS,
    );
  for (const [label, input] of [
    ['A donation in another environment', { environment: 'sandbox' }],
    ['A donation under another account', { accountKey: 'acct_rules_other' }],
    [
      'A donation under an account key differing only in case',
      { accountKey: account.toUpperCase() },
    ],
  ] as const)
    await refuse(
      label,
      donation(randomUUID(), { campaignId: open, ...input }),
      [51345],
      ACTIVATED,
    );
  await refuse(
    'A linked donation for a suspended account',
    donation(randomUUID(), { campaignId: open, donor: suspended }),
    [51346],
    ACTIVE,
  );
  for (const [label, extra] of [
    ['A donation in an unserved locale', { locale: `N'fr'` }],
    [
      'A donation with an upper-case request digest',
      { requestDigest: `'${digest('upper').toUpperCase()}'` },
    ],
    [
      'A donation with a short token digest',
      { statusTokenDigest: `'${digest('short').slice(0, 63)}'` },
    ],
    ['A donation with a blank label', { checkoutLabel: `N''` }],
    ['A donation from an unknown provider', { provider: `N'paypal'` }],
    ['A donation flagged in an unknown vocabulary', { attention: `N'paid'` }],
  ] as const)
    await refuse(
      label,
      donation(randomUUID(), { campaignId: open, extra }),
      [547],
      'Donation_vocabulary_ck',
    );
  for (const [label, input] of [
    ['A donation of nothing', { minor: '0' }],
    ['A donation beyond twelve digits', { minor: '1000000000000' }],
    ['A JPY donation at two decimals', { currency: 'JPY', exponent: 2, minor: '5000' }],
    ['A lower-case currency', { currency: 'usd' }],
  ] as const)
    await refuse(
      label,
      donation(randomUUID(), { campaignId: open, ...input }),
      [547],
      'Donation_money_ck',
    );
  await refuse(
    'A donation for no campaign',
    donation(randomUUID(), { campaignId: randomUUID() }),
    [547],
    'Donation_campaignId_fkey',
  );

  const linked = randomUUID();
  const anonymous = randomUUID();
  const yen = randomUUID();
  const dinar = randomUUID();
  const refundable = randomUUID();
  const lost = randomUUID();
  const departed = randomUUID();
  const solitary = randomUUID();
  const twin = randomUUID();
  const operation = randomUUID();
  const token = digest('shared-token');
  await accept(
    'Donations admitted: linked, anonymous, JPY at 0, KWD at 3, and three more',
    `${donation(linked, { campaignId: open, donor, extra: { operationId: `N'${operation}'`, statusTokenDigest: `'${token}'` } })}
     ${donation(anonymous, { campaignId: urdu })}
     ${donation(yen, { campaignId: open, currency: 'JPY', minor: '5000' })}
     ${donation(dinar, { campaignId: open, currency: 'KWD', minor: '1250' })}
     ${donation(refundable, { campaignId: open })}
     ${donation(lost, { campaignId: open })}
     ${donation(departed, { campaignId: open, donor: departing })}
     ${donation(solitary, { campaignId: open, donor: lonely })}
     ${donation(twin, { campaignId: open })}`,
  );
  await refuse(
    'A second donation under one operation',
    donation(randomUUID(), {
      campaignId: open,
      extra: { operationId: `N'${operation}'` },
    }),
    [2627],
    'Donation_operationId_key',
  );
  await refuse(
    'A second donation under one status-token digest',
    donation(randomUUID(), {
      campaignId: open,
      extra: { statusTokenDigest: `'${token}'` },
    }),
    [2627],
    'Donation_statusTokenDigest_key',
  );
  await accept('A campaign archived', archive(closing));
  await refuse(
    'A donation for an archived campaign',
    donation(randomUUID(), { campaignId: closing }),
    [51343],
    PUBLISHED,
  );

  // ---- a donation's identity, request and expected money never change ---------------
  for (const [label, assignments] of [
    ['Expected money rewritten', `[expectedMinor]=2600,[version]=[version]+1`],
    ['Currency rewritten', `[currency]='EUR',[version]=[version]+1`],
    [
      'Request digest rewritten',
      `[requestDigest]='${digest('other-request')}',[version]=[version]+1`,
    ],
    [
      'Token digest rewritten',
      `[statusTokenDigest]='${digest('other-token')}',[version]=[version]+1`,
    ],
    ['Locale rewritten', `[locale]=N'ar',[version]=[version]+1`],
    [
      'Label rewritten in case only',
      `[checkoutLabel]=N'non_donation_fixture label',[version]=[version]+1`,
    ],
    ['Operation rewritten', `[operationId]=N'${randomUUID()}',[version]=[version]+1`],
    ['Campaign rewritten', `[campaignId]=N'${open}',[version]=[version]+1`],
    [
      'Account key rewritten in case only',
      `[accountKey]=N'${account.toUpperCase()}',[version]=[version]+1`,
    ],
    ['Creation instant rewritten', `[createdAt]='${later}',[version]=[version]+1`],
    ['Identifier rewritten', `[id]=N'${randomUUID()}'`],
  ] as const)
    await refuse(label, set('Donation', anonymous, assignments), [51348], IDENTITY);

  // ---- facts agree, and the state is exactly their derivation -------------------------
  for (const [label, assignments] of [
    [
      'Created without a checkout reference',
      `[createState]=N'created',[version]=[version]+1`,
    ],
    [
      'A checkout reference without its expiry',
      `[createState]=N'created',[checkoutReference]=N'cs_rules_${run}_noexpiry',[version]=[version]+1`,
    ],
    [
      'A rejected create not closed as failed',
      `[createState]=N'rejected',[version]=[version]+1`,
    ],
    ['A dispute on an uncaptured donation', `[dispute]=N'open',[version]=[version]+1`],
    [
      'A capture of a checkout never created',
      `[capturedMinor]=2500,[succeededAt]='${settled}',[state]=N'succeeded',[version]=[version]+1`,
    ],
    [
      'A released link still naming its donor',
      `[donorReleasedAt]='${later}',[version]=[version]+1`,
    ],
  ] as const)
    await refuse(label, set('Donation', linked, assignments), [547], 'Donation_facts_ck');
  await refuse(
    'Succeeded without a capture',
    set('Donation', anonymous, `[state]=N'succeeded',[version]=[version]+1`),
    [547],
    'Donation_state_ck',
  );
  await refuse(
    'Expired without a closure',
    set('Donation', anonymous, `[state]=N'expired',[version]=[version]+1`),
    [547],
    'Donation_state_ck',
  );

  await accept(
    'Checkouts recorded, each reference scoped',
    `${set('Donation', linked, created(`cs_rules_${run}_linked`))}
     ${set('Donation', anonymous, created(`cs_rules_${run}_anonymous`))}
     ${set('Donation', yen, created(`cs_rules_${run}_yen`))}
     ${set('Donation', dinar, created(`cs_rules_${run}_dinar`))}
     ${set('Donation', refundable, created(`cs_rules_${run}_refundable`))}
     ${set('Donation', lost, created(`cs_rules_${run}_lost`))}
     ${set('Donation', departed, created(`cs_rules_${run}_departed`))}
     ${set('Donation', solitary, created(`cs_rules_${run}_solitary`))}`,
  );
  await refuse(
    'Two donations recording one checkout in one scope',
    set('Donation', twin, created(`cs_rules_${run}_linked`)),
    [2601, 2627],
    'Donation_checkout_key',
  );
  await refuse(
    'A captured amount other than the expected amount',
    set('Donation', linked, capture('2499', `pi_rules_${run}_short`)),
    [547],
    'Donation_money_ck',
  );
  await refuse(
    'A captured donation in a state other than its derivation',
    set(
      'Donation',
      linked,
      capture('2500', `pi_rules_${run}_linked`).replace(`N'succeeded'`, `N'refunded'`),
    ),
    [547],
    'Donation_state_ck',
  );
  await accept(
    'Captures: USD, JPY at its own exponent and the refundable one',
    `${set('Donation', linked, capture('2500', `pi_rules_${run}_linked`))}
     ${set('Donation', yen, capture('5000', `pi_rules_${run}_yen`))}
     ${set('Donation', refundable, capture('2500', `pi_rules_${run}_refundable`))}
     ${set('Donation', lost, capture('2500', `pi_rules_${run}_lost`))}
     ${set('Donation', departed, capture('2500', `pi_rules_${run}_departed`))}`,
  );
  await refuse(
    'Two donations claiming one payment in one scope',
    set('Donation', solitary, capture('2500', `pi_rules_${run}_linked`)),
    [2601, 2627],
    'Donation_payment_key',
  );
  await refuse(
    'Refunded beyond the capture',
    set(
      'Donation',
      linked,
      `[refundedMinor]=2501,[state]=N'refunded',[version]=[version]+1`,
    ),
    [547],
    'Donation_money_ck',
  );
  await refuse(
    'A closure on a captured donation',
    set('Donation', linked, `[closure]=N'failed',[version]=[version]+1`),
    [547],
    'Donation_facts_ck',
  );
  await refuse(
    'Partly refunded called refunded',
    set(
      'Donation',
      linked,
      `[refundedMinor]=1000,[state]=N'refunded',[version]=[version]+1`,
    ),
    [547],
    'Donation_state_ck',
  );

  // Every branch of the derivation, reached through lawful forward steps.
  await accept(
    'Partly refunded, then disputed, then won, then fully refunded',
    `${set('Donation', linked, `[refundedMinor]=1000,[state]=N'partially_refunded',[version]=[version]+1`)}
     ${set('Donation', linked, `[dispute]=N'open',[state]=N'disputed',[version]=[version]+1`)}
     ${set('Donation', linked, `[dispute]=N'won',[state]=N'partially_refunded',[version]=[version]+1`)}
     ${set('Donation', linked, `[refundedMinor]=2500,[state]=N'refunded',[version]=[version]+1`)}`,
  );
  await accept(
    'A dispute lost: charged back',
    set(
      'Donation',
      lost,
      `[dispute]=N'lost',[state]=N'charged_back',[version]=[version]+1`,
    ),
  );
  await accept(
    'A cancellation asked, then the checkout expired: cancelled',
    `${set('Donation', anonymous, `[cancelRequestedAt]='${later}',[version]=[version]+1`)}
     ${set('Donation', anonymous, `[closure]=N'expired',[state]=N'cancelled',[version]=[version]+1`)}`,
  );
  await accept(
    'An expiry without a cancellation, then a late capture: provider truth wins',
    `${set('Donation', dinar, `[closure]=N'expired',[state]=N'expired',[version]=[version]+1`)}
     ${set('Donation', dinar, `[closure]=NULL,${capture('1250', `pi_rules_${run}_dinar`)}`)}`,
  );
  const rejected = randomUUID();
  await accept(
    'A rejected create closed as failed',
    `${donation(rejected, { campaignId: open })}
     ${set('Donation', rejected, `[createState]=N'rejected',[closure]=N'failed',[state]=N'failed',[version]=[version]+1`)}`,
  );

  // ---- facts only move forward, one version at a time ---------------------------------
  for (const [label, id, assignments] of [
    [
      'A capture undone',
      linked,
      `[capturedMinor]=NULL,[succeededAt]=NULL,[refundedMinor]=0,[dispute]=N'none',[state]=N'pending',[version]=[version]+1`,
    ],
    [
      'A payment reference rewritten',
      yen,
      `[paymentReference]=N'pi_rules_${run}_other',[version]=[version]+1`,
    ],
    [
      'A checkout reference rewritten',
      yen,
      `[checkoutReference]=N'cs_rules_${run}_other',[version]=[version]+1`,
    ],
    [
      'A checkout expiry rewritten',
      yen,
      `[checkoutExpiresAt]='${settled}',[version]=[version]+1`,
    ],
    [
      'A success instant rewritten',
      yen,
      `[succeededAt]='${closedAt}',[version]=[version]+1`,
    ],
    [
      'A refund total lowered',
      linked,
      `[refundedMinor]=1000,[state]=N'partially_refunded',[version]=[version]+1`,
    ],
    [
      'A won dispute lost',
      linked,
      `[dispute]=N'lost',[state]=N'charged_back',[version]=[version]+1`,
    ],
    [
      'A lost dispute reopened',
      lost,
      `[dispute]=N'open',[state]=N'disputed',[version]=[version]+1`,
    ],
    [
      'A closure cleared without a capture',
      anonymous,
      `[closure]=NULL,[state]=N'pending',[version]=[version]+1`,
    ],
    [
      'A closure changed',
      anonymous,
      `[closure]=N'failed',[state]=N'failed',[version]=[version]+1`,
    ],
    [
      'A cancellation instant rewritten',
      anonymous,
      `[cancelRequestedAt]='${settled}',[version]=[version]+1`,
    ],
    [
      'A finished create reopened',
      rejected,
      `[createState]=N'pending',[version]=[version]+1`,
    ],
    ['A fact changed without a new version', yen, `[attention]=N'amount-mismatch'`],
    [
      'A fact moved two versions at once',
      yen,
      `[attention]=N'amount-mismatch',[version]=[version]+2`,
    ],
    [
      'A reservation unbacked by any refund',
      refundable,
      `[refundReservedMinor]=100,[version]=[version]+1`,
    ],
  ] as const)
    await refuse(label, set('Donation', id, assignments), [51349], FORWARD);
  await accept(
    'A scheduling-only change keeps the version, a flagged one moves it',
    `${set('Donation', yen, `[reconcileDueAt]='${later}',[reconcileAttempts]=[reconcileAttempts]+1,[reconcileLeaseUntil]='${later}'`)}
     ${set('Donation', yen, `[attention]=N'amount-mismatch',[reconcileDueAt]=NULL,[version]=[version]+1`)}`,
  );

  // ---- provider events: deduplicated within scope, completed once --------------------
  const event = (
    id: string,
    eventId: string,
    input: {
      readonly environment?: string;
      readonly result?: string;
      readonly processedAt?: string;
    } = {},
  ): string =>
    `INSERT INTO [dbo].[DonationProviderEvent] ([id],[provider],[environment],[accountKey],[eventId],[eventType],[occurredAt],[receivedAt],[payloadDigest],[result],[processedAt]) VALUES (N'${id}',N'stripe',N'${input.environment ?? 'fixture'}',N'${account}',N'${eventId}',N'checkout.session.completed','${at}','${later}','${digest(`event-${id}`)}',${input.result === undefined ? 'NULL' : `N'${input.result}'`},${input.processedAt === undefined ? 'NULL' : `'${input.processedAt}'`});`;
  for (const [label, statement] of [
    [
      'An event processed without a result',
      event(randomUUID(), `evt_rules_${run}_a`, { processedAt: settled }),
    ],
    [
      'An event with a result but never processed',
      event(randomUUID(), `evt_rules_${run}_b`, { result: 'applied' }),
    ],
    [
      'An event with an unknown result',
      event(randomUUID(), `evt_rules_${run}_c`, { result: 'paid', processedAt: settled }),
    ],
    [
      'An event in an unknown environment',
      event(randomUUID(), `evt_rules_${run}_d`, { environment: 'live' }),
    ],
    [
      'An event whose digest is not hex',
      `INSERT INTO [dbo].[DonationProviderEvent] ([id],[provider],[environment],[accountKey],[eventId],[eventType],[occurredAt],[receivedAt],[payloadDigest]) VALUES (N'${randomUUID()}',N'stripe',N'fixture',N'${account}',N'evt_rules_${run}_e',N'checkout.session.completed','${at}','${later}','${'z'.repeat(64)}');`,
    ],
  ] as const)
    await refuse(label, statement, [547], 'DonationProviderEvent_ck');
  const applied = randomUUID();
  await accept(
    'One event per scope, the same id coexisting in another environment',
    `${event(applied, `evt_rules_${run}_1`)}
     ${event(randomUUID(), `evt_rules_${run}_1`, { environment: 'sandbox' })}`,
  );
  await refuse(
    'A duplicate delivery of one event in one scope',
    event(randomUUID(), `evt_rules_${run}_1`),
    [2627],
    'DonationProviderEvent_event_key',
  );
  await accept(
    'An event completed against its donation',
    set(
      'DonationProviderEvent',
      applied,
      `[result]=N'applied',[processedAt]='${settled}',[donationId]=N'${linked}'`,
    ),
  );
  for (const [label, assignments] of [
    ['An event completed twice', `[result]=N'unchanged'`],
    ['A completion instant rewritten', `[processedAt]='${closedAt}'`],
    ['An event moved to another donation', `[donationId]=N'${yen}'`],
    ['An event id rewritten', `[eventId]=N'evt_rules_${run}_9'`],
    ['An event digest rewritten', `[payloadDigest]='${digest('other-event')}'`],
    ['An event re-scoped to another account', `[accountKey]=N'acct_rules_other'`],
  ] as const)
    await refuse(
      label,
      set('DonationProviderEvent', applied, assignments),
      [51351],
      ONCE_EVENT,
    );

  // ---- refunds: admitted only as fresh, authorised, within the capture --------------
  for (const [label, extra] of [
    ['A refund inserted pending', { state: `N'pending'` }],
    ['A refund inserted at version two', { version: '2' }],
    [
      'A refund inserted with its provider reference',
      { refundReference: `N're_rules_${run}_x'` },
    ],
    [
      'A refund inserted already settled',
      { state: `N'succeeded'`, completedAt: `'${settled}'` },
    ],
  ] as const)
    await refuse(
      label,
      refund(randomUUID(), refundable, '100', refunder, extra),
      [51358],
      REQUESTED,
    );
  await refuse(
    'A refund of an uncaptured donation',
    refund(randomUUID(), rejected, '100', refunder),
    [51352],
    CAPTURED,
  );
  await refuse(
    'A refund of a charged-back donation',
    refund(randomUUID(), lost, '100', refunder),
    [51352],
    CAPTURED,
  );
  for (const [label, extra] of [
    ['A refund in another currency', { currency: `'EUR'` }],
    ['A refund in another environment', { environment: `N'sandbox'` }],
    ['A refund under another account', { accountKey: `N'acct_rules_other'` }],
  ] as const)
    await refuse(
      label,
      refund(randomUUID(), refundable, '100', refunder, extra),
      [51353],
      SCOPE,
    );
  for (const [label, requester] of [
    ['A refund by an account with no refund key', donor],
    ['A refund by a key holder without a step-up', keyOnly],
    ['A refund by a step-up holder without the key', grantOnly],
    ['A refund under a step-up for another purpose', wrongPurpose],
    ['A refund under an expired step-up', expiredGrant],
    ['A refund under a step-up whose session expired', expiredSession],
    ['A refund under a revoked assignment', revoked],
    ['A refund under a deactivated role', deactivated],
  ] as const)
    await refuse(
      label,
      refund(randomUUID(), refundable, '100', requester),
      [51354],
      AUTHORITY,
    );
  await accept(
    'A key holder becomes inactive',
    `UPDATE [dbo].[User] SET [status]=N'suspended' WHERE [id]=N'${inactiveHolder}';`,
  );
  await refuse(
    'A refund by a suspended key holder with a live step-up',
    refund(randomUUID(), refundable, '100', inactiveHolder),
    [51354],
    AUTHORITY,
  );
  for (const [label, statement] of [
    ['A refund of nothing', refund(randomUUID(), refundable, '0', refunder)],
    [
      'A refund with a malformed request digest',
      refund(randomUUID(), refundable, '100', refunder, {
        requestDigest: `'${'G'.repeat(64)}'`,
      }),
    ],
    [
      'A refund in a lower-case currency',
      refund(randomUUID(), refundable, '100', refunder, { currency: `'usd'` }),
    ],
  ] as const)
    await refuse(label, statement, [547], 'DonationRefund_ck');
  await refuse(
    'A refund requested by nobody',
    refund(randomUUID(), refundable, '100', randomUUID()),
    [547],
    'DonationRefund_requestedByUserId_fkey',
  );
  await refuse(
    'A refund beyond the capture',
    refund(randomUUID(), refundable, '2501', refunder),
    [51355],
    OVER,
  );
  const first = randomUUID();
  const second = randomUUID();
  const third = randomUUID();
  await accept(
    'A partial refund reserved, the reservation the sum of live refunds',
    `${refund(first, refundable, '1000', refunder)}
     ${set('Donation', refundable, `[refundReservedMinor]=1000,[version]=[version]+1`)}`,
  );
  await refuse(
    'A reservation other than the sum of live refunds',
    set('Donation', refundable, `[refundReservedMinor]=999,[version]=[version]+1`),
    [51349],
    FORWARD,
  );
  await refuse(
    'A second refund beyond what remains',
    refund(randomUUID(), refundable, '1501', refunder),
    [51355],
    OVER,
  );
  await accept(
    'The rest refunded exactly',
    `${refund(second, refundable, '1500', refunder)}
     ${set('Donation', refundable, `[refundReservedMinor]=2500,[version]=[version]+1`)}`,
  );
  await accept(
    'A refund the provider refused, its reservation released',
    `${set('DonationRefund', first, `[state]=N'failed',[completedAt]='${settled}',[version]=[version]+1`)}
     ${set('Donation', refundable, `[refundReservedMinor]=1500,[version]=[version]+1`)}`,
  );
  await accept(
    'A failed refund no longer counts against the capture',
    `${refund(third, refundable, '1000', refunder)}
     ${set('Donation', refundable, `[refundReservedMinor]=2500,[version]=[version]+1`)}`,
  );
  await accept(
    'Refunds move forward: accepted with a reference, then settled; scheduling keeps the version',
    `${set('DonationRefund', second, `[state]=N'pending',[refundReference]=N're_rules_${run}_second',[version]=[version]+1`)}
     ${set('DonationRefund', second, `[reconcileDueAt]='${later}',[reconcileAttempts]=1`)}
     ${set('DonationRefund', second, `[state]=N'succeeded',[completedAt]='${settled}',[reconcileDueAt]=NULL,[version]=[version]+1`)}`,
  );
  await refuse(
    'Two refunds settling against one provider refund in one scope',
    set(
      'DonationRefund',
      third,
      `[refundReference]=N're_rules_${run}_second',[version]=[version]+1`,
    ),
    [2601, 2627],
    'DonationRefund_reference_key',
  );
  for (const [label, id, assignments] of [
    [
      'A settled refund reopened',
      second,
      `[state]=N'pending',[completedAt]=NULL,[version]=[version]+1`,
    ],
    ['A succeeded refund failed', second, `[state]=N'failed',[version]=[version]+1`],
    [
      'A refund reference rewritten',
      second,
      `[refundReference]=N're_rules_${run}_other',[version]=[version]+1`,
    ],
    [
      'A completion instant rewritten',
      second,
      `[completedAt]='${closedAt}',[version]=[version]+1`,
    ],
    ['A refund amount rewritten', third, `[amountMinor]=900,[version]=[version]+1`],
    [
      'A refund requester rewritten',
      third,
      `[requestedByUserId]=N'${keyOnly}',[version]=[version]+1`,
    ],
    [
      'A refund moved to another donation',
      third,
      `[donationId]=N'${yen}',[version]=[version]+1`,
    ],
    ['A refund state moved without a version', third, `[state]=N'pending'`],
  ] as const)
    await refuse(label, set('DonationRefund', id, assignments), [51356], BACKWARDS);
  for (const [label, assignments] of [
    [
      'A settled refund without its instant',
      `[state]=N'succeeded',[version]=[version]+1`,
    ],
    ['An unknown refund state', `[state]=N'refunded',[version]=[version]+1`],
    ['A blank refund reference', `[refundReference]=N'',[version]=[version]+1`],
  ] as const)
    await refuse(
      label,
      set('DonationRefund', third, assignments),
      [547],
      'DonationRefund_ck',
    );
  await accept(
    'The refunds settled: the donation refunded exactly its capture',
    `${set('DonationRefund', third, `[state]=N'succeeded',[refundReference]=N're_rules_${run}_third',[completedAt]='${settled}',[version]=[version]+1`)}
     ${set('Donation', refundable, `[refundedMinor]=2500,[state]=N'refunded',[version]=[version]+1`)}`,
  );

  // ---- intents: owed to the linked donor, about the donation's own refund -------------
  const succeededIntent = randomUUID();
  const refundIntent = randomUUID();
  const ownRefund = randomUUID();
  await accept(
    "A refund of the linked donation, and the donor's two intents",
    `${refund(ownRefund, linked, '100', refunder)}
     ${set('Donation', linked, `[refundReservedMinor]=100,[version]=[version]+1`)}
     ${intent(succeededIntent, 'donation.succeeded', linked, null, donor, 'succeeded')}
     ${intent(refundIntent, 'donation.partially-refunded', linked, ownRefund, donor, 'refunded')}`,
  );
  for (const [label, statement] of [
    [
      'A success intent naming a refund',
      intent(randomUUID(), 'donation.succeeded', linked, ownRefund, donor, 'shape-1'),
    ],
    [
      'A refund intent naming no refund',
      intent(randomUUID(), 'donation.refunded', linked, null, donor, 'shape-2'),
    ],
    [
      'A tax-receipt purpose',
      intent(randomUUID(), 'donation.tax-receipt', linked, null, donor, 'shape-3'),
    ],
  ] as const)
    await refuse(label, statement, [547], 'DonationCommunicationIntent_ck');
  await refuse(
    'A relayed intent without its instant',
    set('DonationCommunicationIntent', succeededIntent, `[state]=N'relayed'`),
    [547],
    'DonationCommunicationIntent_ck',
  );
  await refuse(
    'An intent owed to another account',
    intent(randomUUID(), 'donation.succeeded', linked, null, other, 'foreign-1'),
    [547],
    'DonationCommunicationIntent_donor_fkey',
  );
  await refuse(
    'An intent for an anonymous donation',
    intent(randomUUID(), 'donation.succeeded', anonymous, null, donor, 'foreign-2'),
    [547],
    'DonationCommunicationIntent_donor_fkey',
  );
  await refuse(
    "A refund intent naming another donation's refund",
    intent(randomUUID(), 'donation.refunded', linked, second, donor, 'foreign-3'),
    [547],
    'DonationCommunicationIntent_refund_fkey',
  );
  await refuse(
    'A second intent under one idempotency key',
    intent(randomUUID(), 'donation.succeeded', linked, null, donor, 'succeeded'),
    [2627],
    'DonationCommunicationIntent_idempotencyKey_key',
  );
  await accept(
    'An intent claimed and relayed, another abandoned',
    `${set('DonationCommunicationIntent', succeededIntent, `[claimedUntil]='${later}'`)}
     ${set('DonationCommunicationIntent', succeededIntent, `[state]=N'relayed',[relayedAt]='${later}',[claimedUntil]=NULL`)}
     ${set('DonationCommunicationIntent', refundIntent, `[state]=N'abandoned',[abandonedAt]='${later}'`)}`,
  );
  for (const [label, id, assignments] of [
    ['A relayed intent reopened', succeededIntent, `[state]=N'pending',[relayedAt]=NULL`],
    [
      'An abandoned intent relayed',
      refundIntent,
      `[state]=N'relayed',[relayedAt]='${later}'`,
    ],
    [
      'An intent re-purposed',
      succeededIntent,
      `[purpose]=N'donation.refunded',[refundId]=N'${ownRefund}'`,
    ],
    ["An intent's due instant rewritten", succeededIntent, `[dueAt]='${later}'`],
    [
      "An intent's key rewritten",
      succeededIntent,
      `[idempotencyKey]=N'non-donation-fixture-${run}-rekeyed'`,
    ],
  ] as const)
    await refuse(
      label,
      set('DonationCommunicationIntent', id, assignments),
      [51357],
      ONCE,
    );

  // ---- a donor link is only released, only for a CLOSED account -----------------------
  await refuse(
    'A donor link moved to another account',
    set('Donation', departed, `[donorUserId]=N'${other}',[version]=[version]+1`),
    [51350],
    LINK,
  );
  await refuse(
    'An anonymous donation given a donor',
    set('Donation', yen, `[donorUserId]=N'${other}',[version]=[version]+1`),
    [51350],
    LINK,
  );
  await refuse(
    'A donor link dropped without its release instant',
    set('Donation', departed, `[donorUserId]=NULL,[version]=[version]+1`),
    [51350],
    LINK,
  );
  await refuse(
    'A donor link released for an account still active',
    set(
      'Donation',
      departed,
      `[donorUserId]=NULL,[donorReleasedAt]='${closedAt}',[version]=[version]+1`,
    ),
    [51350],
    LINK,
  );
  await refuse(
    'A release instant on a donation that was never linked',
    set('Donation', yen, `[donorReleasedAt]='${closedAt}',[version]=[version]+1`),
    [51350],
    LINK,
  );
  await accept(
    'Two accounts closed',
    `UPDATE [dbo].[User] SET [status]=N'closed',[closedAt]='${closedAt}' WHERE [id] IN (N'${departing}',N'${donor}');`,
  );
  await refuse(
    'A linked donation begun for a closed account',
    donation(randomUUID(), { campaignId: open, donor: departing }),
    [51346],
    ACTIVE,
  );
  await refuse(
    'A donor link released while owed mail still names it',
    set(
      'Donation',
      linked,
      `[donorUserId]=NULL,[donorReleasedAt]='${closedAt}',[version]=[version]+1`,
    ),
    [547],
    'DonationCommunicationIntent_donor_fkey',
  );
  await accept(
    "A closed account's link released; the donation's money and history untouched",
    set(
      'Donation',
      departed,
      `[donorUserId]=NULL,[donorReleasedAt]='${closedAt}',[version]=[version]+1`,
    ),
  );
  await refuse(
    'A release instant rewritten',
    set('Donation', departed, `[donorReleasedAt]='${settled}',[version]=[version]+1`),
    [51350],
    LINK,
  );
  const [kept] = await session.query<{
    state: string;
    captured: string;
    payment: string | null;
  }>(
    `SELECT [state], CONVERT(NVARCHAR(20), [capturedMinor]) AS [captured], [paymentReference] AS [payment] FROM [dbo].[Donation] WHERE [id]=N'${departed}';`,
  );
  if (
    kept?.state !== 'succeeded' ||
    kept.captured !== '2500' ||
    kept.payment !== `pi_rules_${run}_departed`
  )
    fail(
      `A released donation must keep its money and history; found ${JSON.stringify(kept ?? null)}.`,
    );

  // ---- nothing cascades --------------------------------------------------------------
  const count = async (statement: string): Promise<number> => {
    const [row] = await session.query<{ total: number }>(statement);
    return Number(row?.total ?? -1);
  };
  const donationRows = (): Promise<number> =>
    count(
      `SELECT (${DONATIONS_TABLES.map(
        (table) => `SELECT COUNT_BIG(*) FROM [dbo].[${table}]`,
      ).join(') + (')}) AS [total];`,
    );
  const before = await donationRows();
  await refuse(
    'An account deleted under its donation',
    `DELETE FROM [dbo].[User] WHERE [id]=N'${lonely}';`,
    [547],
    'Donation_donorUserId_fkey',
  );
  await refuse(
    'A campaign deleted under its donations',
    `DELETE FROM [dbo].[DonationCampaign] WHERE [id]=N'${urdu}';`,
    [547],
    '_campaignId_fkey',
  );
  await refuse(
    'A donation deleted under its refunds',
    `DELETE FROM [dbo].[Donation] WHERE [id]=N'${refundable}';`,
    [547],
    'DonationRefund_donationId_fkey',
  );
  await refuse(
    'A refund deleted under its owed mail',
    `DELETE FROM [dbo].[DonationRefund] WHERE [id]=N'${ownRefund}';`,
    [547],
    'DonationCommunicationIntent_refund',
  );
  if ((await donationRows()) !== before)
    fail('A refused deletion changed a Donations row.');

  // ---- every fixture row removed, children first, without a cascade -----------------
  const accounts = users.map(([user]) => `N'${user}'`).join(',');
  const campaigns = [open, urdu, draft, closing].map((id) => `N'${id}'`).join(',');
  await accept(
    'Every Donations fixture row removed, children first, then its authority and accounts',
    `DELETE FROM [dbo].[DonationCommunicationIntent] WHERE [donationId] IN (SELECT [id] FROM [dbo].[Donation] WHERE [campaignId] IN (${campaigns}));
     DELETE FROM [dbo].[DonationProviderEvent] WHERE [accountKey]=N'${account}';
     DELETE FROM [dbo].[DonationRefund] WHERE [donationId] IN (SELECT [id] FROM [dbo].[Donation] WHERE [campaignId] IN (${campaigns}));
     DELETE FROM [dbo].[Donation] WHERE [campaignId] IN (${campaigns});
     UPDATE [dbo].[DonationCampaign] SET [state]=N'archived',[archivedAt]='${closedAt}',[version]=[version]+1 WHERE [id] IN (${campaigns}) AND [state]=N'published';
     DELETE FROM [dbo].[DonationCampaignCurrency] WHERE [campaignId] IN (${campaigns});
     DELETE FROM [dbo].[DonationCampaignTranslation] WHERE [campaignId] IN (${campaigns});
     DELETE FROM [dbo].[DonationCampaign] WHERE [id] IN (${campaigns});
     DELETE FROM [dbo].[StepUpGrant] WHERE [userId] IN (${accounts});
     DELETE FROM [dbo].[Session] WHERE [userId] IN (${accounts});
     DELETE FROM [dbo].[RoleAssignment] WHERE [roleId] IN (N'${refundRole}',N'${deadRole}');
     DELETE FROM [dbo].[RolePermission] WHERE [roleId] IN (N'${refundRole}',N'${deadRole}');
     DELETE FROM [dbo].[Role] WHERE [id] IN (N'${refundRole}',N'${deadRole}');
     DELETE FROM [dbo].[User] WHERE [id] IN (${accounts});`,
  );
  const [left] = await session.query<{
    donations: number;
    activation: number;
    accounts: number;
    holders: number;
    grants: number;
  }>(`
    SELECT
      (${DONATIONS_TABLES.filter((table) => table !== 'DonationActivation')
        .map((table) => `SELECT COUNT_BIG(*) FROM [dbo].[${table}]`)
        .join(') + (')}) AS [donations],
      (SELECT COUNT(*) FROM [dbo].[DonationActivation]) AS [activation],
      (SELECT COUNT(*) FROM [dbo].[User] WHERE [email] LIKE N'%-${run}@donations-proof.invalid') AS [accounts],
      (SELECT COUNT(*) FROM [dbo].[RolePermission] WHERE [permissionKey] = N'${DONATIONS_REFUND_PERMISSION}') AS [holders],
      (SELECT COUNT(*) FROM [dbo].[StepUpGrant] WHERE [purpose] = N'donation-refund') AS [grants];
  `);
  if (
    Number(left?.donations ?? -1) !== 0 ||
    Number(left?.activation ?? -1) !== 1 ||
    Number(left?.accounts ?? -1) !== 0 ||
    Number(left?.holders ?? -1) !== 0 ||
    Number(left?.grants ?? -1) !== 0
  )
    fail(
      `The Donations rule proofs left a fixture row behind (the immutable activation alone ` +
        `may stay): ${JSON.stringify(left ?? null)}.`,
    );

  report(
    'donations rules',
    `draft-first campaigns published only complete and never back to draft, fixed words, ` +
      `currency policy at each currency's own exponent (JPY 0, USD 2, KWD 3), the two lawful ` +
      `activations and their immutability, donations admitted only fresh, published, ` +
      `policy-admitted, activated and active, the state exactly the derivation of forward-only ` +
      `facts, scoped provider references, events completed once, refunds only by live ` +
      `donations.refund with a live donation-refund step-up and never beyond the capture, ` +
      `intents owed only to the linked donor, links released only for closed accounts, no ` +
      `cascade; ${String(refusals)} refusals by name, every text a NON_DONATION_FIXTURE ` +
      `sentinel, every row but the immutable activation removed`,
  );
}

const MIGRATION_PROVENANCE_MIGRATION = '20261011000000_phase29_migration_provenance';

/**
 * The three keys Phase 29 catalogues, and only these. `migration.read` and
 * `migration.administer` are ORDINARY and join the protected bundle by the
 * convention every earlier phase used; `migration.publish` is EXTERNALLY
 * GATED — who may publish migrated content into the live platform is the
 * organisation's decision (OPEN_DECISIONS.md §3.5) — so it is catalogued,
 * bundled into no role and held by nobody.
 */
const MIGRATION_PERMISSIONS = [
  'migration.administer',
  'migration.publish',
  'migration.read',
];

/** The two of them the protected bundle carries. */
const MIGRATION_BUNDLED = ['migration.administer', 'migration.read'];

/** The one publication authority, gated and bundled nowhere. */
const MIGRATION_PUBLISH_PERMISSION = 'migration.publish';

/**
 * EVERY foreign key from a Phase-29 table, exactly, with its column mapping and
 * its delete action. ALL are NO ACTION: nothing cascades, inside the context or
 * out of it, and no evidence is ever deleted from under what names it. The
 * external edges are Identity's User, Taxonomy's Topic, Media's Video and
 * Storage's Asset — each a typed key, never a target pair. The COMPOSITE keys
 * are the same-source rule: a snapshot, an error, an acquisition and a legacy
 * mapping reach their record and run THROUGH their source; a record is first
 * and last seen by its own source's runs; a record's latest snapshot and
 * current revision, an item's evidence, and an entry's revision are their own
 * record's.
 */
const MIGRATION_KEYS = [
  'MigrationAssetProvenance_assetId_fkey(assetId>id)>Asset:NO_ACTION',
  'MigrationAssetProvenance_decidedByUserId_fkey(decidedByUserId>id)>User:NO_ACTION',
  'MigrationAssetProvenance_recordId_fkey(recordId>id,sourceId>sourceId)>MigrationRecord:NO_ACTION',
  'MigrationAssetProvenance_runId_fkey(runId>id,sourceId>sourceId)>MigrationRun:NO_ACTION',
  'MigrationAssetProvenance_sourceId_fkey(sourceId>id)>MigrationSource:NO_ACTION',
  'MigrationDuplicateCandidate_decidedByUserId_fkey(decidedByUserId>id)>User:NO_ACTION',
  'MigrationDuplicateCandidate_otherRecordId_fkey(otherRecordId>id)>MigrationRecord:NO_ACTION',
  'MigrationDuplicateCandidate_recordId_fkey(recordId>id)>MigrationRecord:NO_ACTION',
  'MigrationError_recordId_fkey(recordId>id,sourceId>sourceId)>MigrationRecord:NO_ACTION',
  'MigrationError_resolvedByUserId_fkey(resolvedByUserId>id)>User:NO_ACTION',
  'MigrationError_runId_fkey(runId>id,sourceId>sourceId)>MigrationRun:NO_ACTION',
  'MigrationError_sourceId_fkey(sourceId>id)>MigrationSource:NO_ACTION',
  'MigrationLegacyMapping_changedByUserId_fkey(changedByUserId>id)>User:NO_ACTION',
  'MigrationLegacyMapping_createdByUserId_fkey(createdByUserId>id)>User:NO_ACTION',
  'MigrationLegacyMapping_manifestEntryId_fkey(manifestEntryId>id)>MigrationManifestEntry:NO_ACTION',
  'MigrationLegacyMapping_recordId_fkey(recordId>id,sourceId>sourceId)>MigrationRecord:NO_ACTION',
  'MigrationLegacyMapping_sourceId_fkey(sourceId>id)>MigrationSource:NO_ACTION',
  'MigrationLegacyMapping_videoId_fkey(videoId>id)>Video:NO_ACTION',
  'MigrationManifestEntry_manifestId_fkey(manifestId>id)>MigrationPublishManifest:NO_ACTION',
  'MigrationManifestEntry_recordId_fkey(recordId>id)>MigrationRecord:NO_ACTION',
  'MigrationManifestEntry_stagedRecordId_fkey(stagedRecordId>id,recordId>recordId)>MigrationStagedRecord:NO_ACTION',
  'MigrationManifestEntry_videoId_fkey(videoId>id)>Video:NO_ACTION',
  'MigrationPromotionEntry_manifestEntryId_fkey(manifestEntryId>id)>MigrationManifestEntry:NO_ACTION',
  'MigrationPromotionEntry_promotionId_fkey(promotionId>id)>MigrationPromotion:NO_ACTION',
  'MigrationPromotion_approvedByUserId_fkey(approvedByUserId>id)>User:NO_ACTION',
  'MigrationPromotion_createdByUserId_fkey(createdByUserId>id)>User:NO_ACTION',
  'MigrationPromotion_withdrawnByUserId_fkey(withdrawnByUserId>id)>User:NO_ACTION',
  'MigrationPublishManifest_createdByUserId_fkey(createdByUserId>id)>User:NO_ACTION',
  'MigrationPublishManifest_publishedByUserId_fkey(publishedByUserId>id)>User:NO_ACTION',
  'MigrationPublishManifest_rollbackByUserId_fkey(rollbackByUserId>id)>User:NO_ACTION',
  'MigrationPublishManifest_runId_fkey(runId>id,sourceId>sourceId)>MigrationRun:NO_ACTION',
  'MigrationPublishManifest_sourceId_fkey(sourceId>id)>MigrationSource:NO_ACTION',
  'MigrationRawSnapshot_disposedByUserId_fkey(disposedByUserId>id)>User:NO_ACTION',
  'MigrationRawSnapshot_recordId_fkey(recordId>id,sourceId>sourceId)>MigrationRecord:NO_ACTION',
  'MigrationRawSnapshot_runId_fkey(runId>id,sourceId>sourceId)>MigrationRun:NO_ACTION',
  'MigrationRawSnapshot_sourceId_fkey(sourceId>id)>MigrationSource:NO_ACTION',
  'MigrationRecord_classifiedByUserId_fkey(classifiedByUserId>id)>User:NO_ACTION',
  'MigrationRecord_currentStagedRecordId_fkey(currentStagedRecordId>id,id>recordId)>MigrationStagedRecord:NO_ACTION',
  'MigrationRecord_firstObservedRunId_fkey(firstObservedRunId>id,sourceId>sourceId)>MigrationRun:NO_ACTION',
  'MigrationRecord_lastObservedRunId_fkey(lastObservedRunId>id,sourceId>sourceId)>MigrationRun:NO_ACTION',
  'MigrationRecord_latestSnapshotId_fkey(latestSnapshotId>id,id>recordId)>MigrationRawSnapshot:NO_ACTION',
  'MigrationRecord_mergedIntoRecordId_fkey(mergedIntoRecordId>id)>MigrationRecord:NO_ACTION',
  'MigrationRecord_sourceId_fkey(sourceId>id)>MigrationSource:NO_ACTION',
  'MigrationRunItem_errorId_fkey(errorId>id)>MigrationError:NO_ACTION',
  'MigrationRunItem_recordId_fkey(recordId>id)>MigrationRecord:NO_ACTION',
  'MigrationRunItem_runId_fkey(runId>id)>MigrationRun:NO_ACTION',
  'MigrationRunItem_snapshotId_fkey(snapshotId>id,recordId>recordId)>MigrationRawSnapshot:NO_ACTION',
  'MigrationRunItem_stagedRecordId_fkey(stagedRecordId>id,recordId>recordId)>MigrationStagedRecord:NO_ACTION',
  'MigrationRun_operatorUserId_fkey(operatorUserId>id)>User:NO_ACTION',
  'MigrationRun_sourceId_fkey(sourceId>id)>MigrationSource:NO_ACTION',
  'MigrationSourceHost_sourceId_fkey(sourceId>id)>MigrationSource:NO_ACTION',
  'MigrationSource_createdByUserId_fkey(createdByUserId>id)>User:NO_ACTION',
  'MigrationSource_updatedByUserId_fkey(updatedByUserId>id)>User:NO_ACTION',
  'MigrationStagedCategory_stagedRecordId_fkey(stagedRecordId>id)>MigrationStagedRecord:NO_ACTION',
  'MigrationStagedCategory_topicMappingId_fkey(topicMappingId>id)>MigrationTopicMapping:NO_ACTION',
  'MigrationStagedLink_legacyMappingId_fkey(legacyMappingId>id)>MigrationLegacyMapping:NO_ACTION',
  'MigrationStagedLink_stagedRecordId_fkey(stagedRecordId>id)>MigrationStagedRecord:NO_ACTION',
  'MigrationStagedRecord_recordId_fkey(recordId>id)>MigrationRecord:NO_ACTION',
  'MigrationStagedRecord_reviewedByUserId_fkey(reviewedByUserId>id)>User:NO_ACTION',
  'MigrationStagedRecord_runId_fkey(runId>id)>MigrationRun:NO_ACTION',
  'MigrationStagedRecord_snapshotId_fkey(snapshotId>id,recordId>recordId)>MigrationRawSnapshot:NO_ACTION',
  'MigrationTopicMapping_decidedByUserId_fkey(decidedByUserId>id)>User:NO_ACTION',
  'MigrationTopicMapping_sourceId_fkey(sourceId>id)>MigrationSource:NO_ACTION',
  'MigrationTopicMapping_suggestedTopicId_fkey(suggestedTopicId>id)>Topic:NO_ACTION',
  'MigrationTopicMapping_topicId_fkey(topicId>id)>Topic:NO_ACTION',
].sort();

/**
 * Every unique index on a Phase-29 table, exactly: the keys; one source per
 * key; one record per source and external key; the record-, run- and
 * source-carrying keys the composite references reach through; one item per
 * run and record and per run and position; one revision number per record;
 * one acquisition per source, original address and bytes; one pair per signal;
 * one entry per manifest position and per manifest revision; one promotion
 * entry per position and per manifest entry — and the THREE FILTERED keys:
 * one OPEN run per source, one ACTIVE mapping per legacy address, and one LIVE
 * manifest entry per staged revision.
 */
const MIGRATION_UNIQUE = [
  'MigrationAssetProvenance_acquisition_key(sourceId,originalUrlDigest,checksum)',
  'MigrationAssetProvenance_pkey(id)',
  'MigrationDuplicateCandidate_pair_key(recordId,otherRecordId,signal)',
  'MigrationDuplicateCandidate_pkey(id)',
  'MigrationError_pkey(id)',
  "MigrationLegacyMapping_active_key(sourceId,legacyUrlDigest) WHERE ([state]=N'active')",
  'MigrationLegacyMapping_pkey(id)',
  "MigrationManifestEntry_live_key(stagedRecordId) WHERE ([state] IN (N'publishing', N'published', N'rollback-refused'))",
  'MigrationManifestEntry_manifest_position_key(manifestId,position)',
  'MigrationManifestEntry_manifest_staged_key(manifestId,stagedRecordId)',
  'MigrationManifestEntry_pkey(id)',
  'MigrationPromotionEntry_pkey(id)',
  'MigrationPromotionEntry_promotion_entry_key(promotionId,manifestEntryId)',
  'MigrationPromotionEntry_promotion_position_key(promotionId,position)',
  'MigrationPromotion_pkey(id)',
  'MigrationPublishManifest_pkey(id)',
  'MigrationRawSnapshot_pkey(id)',
  'MigrationRawSnapshot_record_key(id,recordId)',
  'MigrationRecord_id_source_key(id,sourceId)',
  'MigrationRecord_pkey(id)',
  'MigrationRecord_source_key(sourceId,externalKey)',
  'MigrationRunItem_pkey(id)',
  'MigrationRunItem_run_position_key(runId,position)',
  'MigrationRunItem_run_record_key(runId,recordId)',
  "MigrationRun_open_key(sourceId) WHERE ([state]=N'open')",
  'MigrationRun_pkey(id)',
  'MigrationRun_source_key(id,sourceId)',
  'MigrationSourceHost_pkey(sourceId,host)',
  'MigrationSource_key_key(key)',
  'MigrationSource_pkey(id)',
  'MigrationStagedCategory_pkey(stagedRecordId,topicMappingId)',
  'MigrationStagedLink_pkey(stagedRecordId,position)',
  'MigrationStagedRecord_pkey(id)',
  'MigrationStagedRecord_record_key(id,recordId)',
  'MigrationStagedRecord_record_revision_key(recordId,revision)',
  'MigrationTopicMapping_pkey(id)',
  'MigrationTopicMapping_source_category_key(sourceId,categoryKey)',
].sort();

/**
 * Every column of every Phase-29 table, in order. Stated whole so a stored
 * credential, cookie or session for a legacy host, a crawl queue, a
 * `targetType`/`targetId` pair or a second copy of the raw body cannot arrive
 * unnoticed.
 */
const MIGRATION_COLUMNS: Readonly<Record<string, string>> = {
  MigrationSource:
    'id,key,name,authorityKind,accessMethod,contentKind,baseUrl,authorisationReference,authorisedOn,licensingEvidence,policyNotes,defaultLanguageCode,minIntervalMs,maxConcurrency,maxAttempts,timeoutMs,maxBodyBytes,maxRedirects,state,version,createdAt,createdByUserId,updatedAt,updatedByUserId',
  MigrationSourceHost: 'sourceId,host',
  MigrationRun:
    'id,sourceId,operatorUserId,state,adapterKey,adapterVersion,parserKey,parserVersion,normalizerVersion,codeRevision,discoveryCursor,discoveryComplete,leaseToken,leaseExpiresAt,startedAt,endedAt,reconciliation,reconciledAt,reconciliationDetail,version',
  MigrationRecord:
    'id,sourceId,externalKey,originalUrl,legacyIdentifier,contentKind,status,observed,disappearance,disappearanceNote,classifiedByUserId,classifiedAt,mergedIntoRecordId,latestSnapshotId,currentStagedRecordId,firstObservedRunId,lastObservedRunId,version,createdAt,updatedAt',
  MigrationRunItem:
    'id,runId,recordId,position,outcome,fetched,parsed,attempts,nextAttemptAt,snapshotId,stagedRecordId,errorId,updatedAt',
  MigrationRawSnapshot:
    'id,sourceId,recordId,runId,requestedUrl,finalUrl,httpStatus,contentType,headers,body,byteSize,checksum,fetchedAt,fetcherKey,fetcherVersion,personalData,disposedAt,disposedByUserId,disposalReason',
  MigrationStagedRecord:
    'id,recordId,snapshotId,runId,revision,contentKind,title,titleKey,dedupeKey,languageCode,payload,payloadChecksum,adapterKey,adapterVersion,parserKey,parserVersion,normalizerVersion,codeRevision,inputChecksum,producedAt,validation,issues,personalData,review,reviewedByUserId,reviewedAt,reviewNote,version',
  MigrationStagedCategory: 'stagedRecordId,topicMappingId',
  MigrationStagedLink:
    'stagedRecordId,position,href,disposition,rewrittenTo,legacyMappingId',
  MigrationTopicMapping:
    'id,sourceId,categoryKey,label,state,topicId,suggestedTopicId,decidedByUserId,decidedAt,version',
  MigrationError:
    'id,sourceId,runId,recordId,stage,classification,retryEligible,httpStatus,attempt,detail,occurredAt,resolution,resolvedByUserId,resolvedAt,version',
  MigrationDuplicateCandidate:
    'id,recordId,otherRecordId,signal,score,crossLanguage,state,decidedByUserId,decidedAt,note,version,createdAt',
  MigrationAssetProvenance:
    'id,sourceId,recordId,runId,originalUrl,originalUrlDigest,assetId,checksum,byteSize,mediaType,licence,licenceEvidence,rightsHolder,visibility,acquiredAt,decidedByUserId,decidedAt,version',
  MigrationLegacyMapping:
    'id,sourceId,recordId,legacyUrl,legacyUrlDigest,videoId,canonicalPath,state,manifestEntryId,createdAt,createdByUserId,changedAt,changedByUserId,version',
  MigrationPublishManifest:
    'id,sourceId,runId,state,createdByUserId,createdAt,publishedByUserId,publishStartedAt,publishedAt,rollbackByUserId,rollbackReason,rollbackStartedAt,rolledBackAt,version',
  MigrationManifestEntry:
    'id,manifestId,position,stagedRecordId,recordId,state,videoId,targetVersion,canonicalPath,refusal,publishedAt,rolledBackAt,version',
  MigrationPromotion:
    'id,state,destination,createdByUserId,createdAt,approvedByUserId,approvedAt,withdrawnByUserId,withdrawnAt,completedAt,version',
  MigrationPromotionEntry:
    'id,promotionId,position,manifestEntryId,state,promotedAt,destinationRef',
};

/**
 * Whether Phase 29 is applied, ALL OR NOTHING: either every one of its
 * eighteen tables exists or none does.
 */
async function migrationPresent(session: SqlSession): Promise<boolean> {
  const names = MIGRATION_TABLES.map((table) => `N'${table}'`).join(',');
  const [row] = await session.query<{ present: number }>(
    `SELECT COUNT(*) AS [present] FROM sys.tables WHERE [name] IN (${names});`,
  );
  const present = Number(row?.present ?? -1);
  if (present !== 0 && present !== MIGRATION_TABLES.length)
    fail(
      `Phase 29 is half applied: ${String(present)} of ${String(MIGRATION_TABLES.length)} ` +
        `Migration & Provenance tables exist.`,
    );
  return present === MIGRATION_TABLES.length;
}

/**
 * Phase 29 — what only the catalogue can prove about Migration & Provenance:
 *
 *   1. NOTHING IS SEEDED: all eighteen tables are empty after deploy — no
 *      source, so no run can start and nothing can be fetched;
 *   2. every column of every table is exactly as stated; the raw body is ONE
 *      VARBINARY(MAX) column on the snapshot and the staged payload ONE
 *      NVARCHAR(MAX) column on the revision; no credential, cookie, session,
 *      password, secret, bearer or stored token column (a run's lease token
 *      aside), and no `targetType` / `targetId`; the unique indexes are exactly
 *      the thirty-seven above, three of them FILTERED;
 *   3. every foreign key is exactly one of the sixty-five above, ALL NO ACTION
 *      and trusted: Identity's User, Taxonomy's Topic, Media's Video and
 *      Storage's Asset the only external edges; no other owner references a
 *      Migration table or holds a migration-record, snapshot, staged-revision or
 *      legacy-mapping column;
 *   4. the CHECKs are exactly the seventeen named rules, all trusted; the
 *      triggers are exactly the eighteen in `MIGRATION_TRIGGER_NUMBERS`,
 *      enabled, each raising exactly its own numbers from 51370–51384 on the
 *      table it guards; and Migration & Provenance has no procedure;
 *   5. the vocabulary is exactly `migration.administer`, `migration.publish`
 *      and `migration.read`, described as the compiled catalogue describes
 *      them; the first and last ORDINARY, each bundled exactly once into the
 *      protected role and held by no other; `migration.publish` EXTERNALLY
 *      GATED, held by no role and no account; no `migration-publication`
 *      step-up grant exists; exactly one `migration.permissions.provisioned`
 *      record names the two bundled keys and this migration; and the protected
 *      bundle is exactly the compiled bundle.
 *
 * The rules themselves are proved as BEHAVIOUR by `assertMigrationRules`, the
 * bundle extension's invalidation by `assertMigrationBundleExtension`, and the
 * runtime's own posture by `db:test:permissions`.
 */
async function assertMigrationFoundation(
  session: SqlSession,
  stage: 'deploy' | 're-deploy' = 'deploy',
): Promise<void> {
  const tables = MIGRATION_TABLES.map((table) => `OBJECT_ID(N'[dbo].[${table}]')`).join(
    ',',
  );
  const names = MIGRATION_TABLES.map((table) => `N'${table}'`).join(',');
  if (!(await migrationPresent(session)))
    fail(`The Phase-29 Migration & Provenance tables are missing after ${stage}.`);

  // ---- 1. nothing seeded -----------------------------------------------------------
  const counts = await session.query<{ name: string; total: number }>(
    MIGRATION_TABLES.map(
      (table) =>
        `SELECT N'${table}' AS [name], COUNT_BIG(*) AS [total] FROM [dbo].[${table}]`,
    ).join(' UNION ALL ') + ';',
  );
  const seeded = counts.filter((row) => Number(row.total) !== 0);
  if (MIGRATION_TABLES.length !== 18 || counts.length !== 18 || seeded.length > 0)
    fail(
      `The Migration & Provenance migration must create eighteen empty tables — no source — ` +
        `and seed nothing; found ${String(counts.length)} tables after ${stage}, seeded: ` +
        `${JSON.stringify(seeded)}.`,
    );

  // ---- 2. exact columns, one raw body, no credential, three filtered keys ------------
  const shapes = await session.query<{ name: string; columns: string }>(`
    SELECT OBJECT_NAME(c.[object_id]) AS [name],
      STRING_AGG(c.[name], N',') WITHIN GROUP (ORDER BY c.[column_id]) AS [columns]
    FROM sys.columns c WHERE c.[object_id] IN (${tables})
    GROUP BY c.[object_id];
  `);
  const shapeFindings = MIGRATION_TABLES.filter(
    (table) =>
      shapes.find((row) => row.name === table)?.columns !== MIGRATION_COLUMNS[table],
  );
  if (shapes.length !== 18 || shapeFindings.length > 0)
    fail(
      `Migration & Provenance columns differ from the reviewed shape in ` +
        `${shapeFindings.join(', ')}: ` +
        `${JSON.stringify(shapes.filter((row) => shapeFindings.includes(row.name)))}.`,
    );

  const [bodies] = await session.query<{
    binary: string | null;
    maximal: string | null;
  }>(`
    SELECT
      (SELECT STRING_AGG(OBJECT_NAME(c.[object_id]) + N'.' + c.[name] + N':' + t.[name]
                + N'(' + CONVERT(NVARCHAR(8), c.[max_length]) + N')', N',')
         FROM sys.columns c JOIN sys.types t ON t.[user_type_id] = c.[user_type_id]
        WHERE c.[object_id] IN (${tables}) AND t.[name] IN (N'varbinary', N'binary', N'image')) AS [binary],
      (SELECT STRING_AGG(OBJECT_NAME(c.[object_id]) + N'.' + c.[name], N',')
                WITHIN GROUP (ORDER BY OBJECT_NAME(c.[object_id]), c.[name])
         FROM sys.columns c
        WHERE c.[object_id] IN (${tables}) AND c.[max_length] = -1) AS [maximal];
  `);
  if (
    bodies?.binary !== 'MigrationRawSnapshot.body:varbinary(-1)' ||
    bodies.maximal !== 'MigrationRawSnapshot.body,MigrationStagedRecord.payload'
  )
    fail(
      `The raw body must be the one VARBINARY(MAX) column on the snapshot and the staged ` +
        `payload the one other MAX column; found ${JSON.stringify(bodies ?? null)}.`,
    );

  const credential = await session.query<{ name: string }>(`
    SELECT OBJECT_NAME(c.[object_id]) + N'.' + c.[name] AS [name] FROM sys.columns c
    WHERE c.[object_id] IN (${tables})
      AND (c.[name] LIKE N'%password%' OR c.[name] LIKE N'%secret%' OR c.[name] LIKE N'%cookie%'
           OR c.[name] LIKE N'%credential%' OR c.[name] LIKE N'%session%' OR c.[name] LIKE N'%bearer%'
           OR c.[name] LIKE N'%apiKey%' OR c.[name] LIKE N'%login%'
           OR (c.[name] LIKE N'%token%' AND c.[name] <> N'leaseToken')
           OR c.[name] IN (N'targetType', N'targetId', N'entityType', N'entityId'));
  `);
  if (credential.length > 0)
    fail(
      `A Migration & Provenance table may hold no credential, cookie, session, password, ` +
        `secret, token or target-pair column; found ${JSON.stringify(credential)}.`,
    );

  const unique = await session.query<{
    name: string;
    columns: string;
    filter: string | null;
  }>(`
    SELECT i.[name], i.[filter_definition] AS [filter],
      STRING_AGG(COL_NAME(ic.[object_id], ic.[column_id]), N',')
        WITHIN GROUP (ORDER BY ic.[key_ordinal]) AS [columns]
    FROM sys.indexes i
    JOIN sys.index_columns ic ON ic.[object_id] = i.[object_id] AND ic.[index_id] = i.[index_id]
    WHERE i.[is_unique] = 1 AND ic.[key_ordinal] > 0 AND i.[object_id] IN (${tables})
    GROUP BY i.[object_id], i.[name], i.[filter_definition];
  `);
  const describedUnique = unique
    .map(
      (row) =>
        `${row.name}(${row.columns})` +
        (row.filter === null ? '' : ` WHERE ${row.filter}`),
    )
    .sort();
  if (
    describedUnique.join(' | ') !== MIGRATION_UNIQUE.join(' | ') ||
    unique.filter((row) => row.filter !== null).length !== 3
  )
    fail(
      `Migration & Provenance unique indexes must be exactly the reviewed thirty-seven, three ` +
        `of them filtered; found ${describedUnique.join(' | ')}.`,
    );

  // ---- 3. exact keys, all NO ACTION and trusted; nothing foreign holds the context ----
  const keys = await session.query<{
    name: string;
    columns: string;
    target: string;
    deletes: string;
    updates: string;
    trusted: number;
  }>(`
    SELECT fk.[name], OBJECT_NAME(fk.[referenced_object_id]) AS [target],
      fk.[delete_referential_action_desc] AS [deletes], fk.[update_referential_action_desc] AS [updates],
      CASE WHEN fk.[is_disabled] = 0 AND fk.[is_not_trusted] = 0 THEN 1 ELSE 0 END AS [trusted],
      STRING_AGG(COL_NAME(c.[parent_object_id], c.[parent_column_id]) + N'>'
        + COL_NAME(c.[referenced_object_id], c.[referenced_column_id]), N',')
        WITHIN GROUP (ORDER BY c.[constraint_column_id]) AS [columns]
    FROM sys.foreign_keys fk
    JOIN sys.foreign_key_columns c ON c.[constraint_object_id] = fk.[object_id]
    WHERE fk.[parent_object_id] IN (${tables})
    GROUP BY fk.[name], fk.[referenced_object_id], fk.[delete_referential_action_desc],
      fk.[update_referential_action_desc], fk.[is_disabled], fk.[is_not_trusted];
  `);
  const describedKeys = keys
    .map((row) => `${row.name}(${row.columns})>${row.target}:${row.deletes}`)
    .sort();
  if (
    MIGRATION_KEYS.length !== 65 ||
    describedKeys.join(',') !== MIGRATION_KEYS.join(',') ||
    keys.some((row) => row.updates !== 'NO_ACTION' || Number(row.trusted) !== 1)
  )
    fail(
      `Migration & Provenance keys must be exactly the reviewed sixty-five, none cascading ` +
        `and all trusted; found ${describedKeys.join(', ')}.`,
    );

  const [isolation] = await session.query<{ inbound: number; foreign: string | null }>(`
    SELECT
      (SELECT COUNT(*) FROM sys.foreign_keys
        WHERE [referenced_object_id] IN (${tables}) AND [parent_object_id] NOT IN (${tables})) AS [inbound],
      (SELECT STRING_AGG(OBJECT_NAME(c.[object_id]) + N'.' + c.[name], N',') FROM sys.columns c
        WHERE (c.[name] LIKE N'%migrationRecord%' OR c.[name] LIKE N'%rawSnapshot%'
               OR c.[name] LIKE N'%stagedRecord%' OR c.[name] LIKE N'%legacyMapping%'
               OR c.[name] LIKE N'%manifestEntry%' OR c.[name] LIKE N'%migrationSource%')
          AND OBJECT_NAME(c.[object_id]) NOT IN (${names})
          AND OBJECTPROPERTY(c.[object_id], 'IsUserTable') = 1) AS [foreign];
  `);
  if (Number(isolation?.inbound) !== 0 || (isolation?.foreign ?? null) !== null)
    fail(
      `No other owner may reference or hold Migration & Provenance schema; found ` +
        `${JSON.stringify(isolation ?? null)}.`,
    );

  // ---- 4. seventeen trusted CHECKs, eighteen triggers by number, no procedure --------
  const checks = await session.query<{ name: string; trusted: number }>(`
    SELECT [name], CASE WHEN [is_disabled] = 0 AND [is_not_trusted] = 0 THEN 1 ELSE 0 END AS [trusted]
    FROM sys.check_constraints WHERE [parent_object_id] IN (${tables});
  `);
  const expectedChecks = EXPECTED_CHECK_CONSTRAINTS.filter((entry) =>
    MIGRATION_TABLES.includes(entry.table),
  )
    .map((entry) => entry.constraint)
    .sort();
  if (
    expectedChecks.length !== 17 ||
    checks
      .map((row) => row.name)
      .sort()
      .join(',') !== expectedChecks.join(',') ||
    checks.some((row) => Number(row.trusted) !== 1)
  )
    fail(
      `Migration & Provenance must carry exactly its seventeen trusted CHECKs; found ` +
        `${JSON.stringify(checks)}.`,
    );

  const triggers = await session.query<{
    name: string;
    tableName: string;
    disabled: number;
    definition: string | null;
  }>(`
    SELECT t.[name], OBJECT_NAME(t.[parent_id]) AS [tableName], CAST(t.[is_disabled] AS INT) AS [disabled],
      OBJECT_DEFINITION(t.[object_id]) AS [definition]
    FROM sys.triggers t WHERE t.[parent_id] IN (${tables});
  `);
  const describedTriggers = triggers
    .map((row) => `${row.name}@${row.tableName}:${raisedNumbers(row.definition)}`)
    .sort()
    .join(',');
  const expectedTriggers = Object.entries(MIGRATION_TRIGGER_NUMBERS)
    .map(([name, [table, numbers]]) => `${name}@${table}:${numbers}`)
    .sort()
    .join(',');
  if (
    describedTriggers !== expectedTriggers ||
    triggers.length !== 18 ||
    triggers.some((row) => Number(row.disabled) !== 0)
  )
    fail(
      `Migration & Provenance triggers must be exactly eighteen, enabled, raising exactly ` +
        `their own 51370–51384 numbers; found ${describedTriggers}.`,
    );

  const [procedures] = await session.query<{ total: number }>(`
    SELECT COUNT(*) AS [total] FROM sys.procedures
    WHERE [name] LIKE N'Migration%' OR [name] LIKE N'Legacy%' OR [name] LIKE N'Provenance%';
  `);
  if (Number(procedures?.total) !== 0)
    fail('Phase 29 writes through its owner adapter; it must create no procedure.');

  // ---- 5. two ordinary keys bundled once, one gated key held by nobody ----------------
  const permissions = await session.query<{
    key: string;
    description: string;
    bundled: number;
    held: number;
    holders: number;
  }>(`
    SELECT p.[key], p.[description],
      (SELECT COUNT(*) FROM [dbo].[RolePermission] rp JOIN [dbo].[Role] r ON r.[id] = rp.[roleId]
        WHERE r.[key] = N'platform-administrator' AND rp.[permissionKey] = p.[key]) AS [bundled],
      (SELECT COUNT(*) FROM [dbo].[RolePermission] rp WHERE rp.[permissionKey] = p.[key]) AS [held],
      (SELECT COUNT(*) FROM [dbo].[RoleAssignment] ra JOIN [dbo].[RolePermission] rp ON rp.[roleId] = ra.[roleId]
        WHERE rp.[permissionKey] = p.[key]) AS [holders]
    FROM [dbo].[Permission] p
    WHERE p.[key] LIKE N'migrat%' OR p.[key] LIKE N'legacy%' OR p.[key] LIKE N'provenance%'
       OR p.[key] LIKE N'import%' OR p.[key] LIKE N'crawl%' OR p.[key] LIKE N'scrape%'
       OR p.[key] LIKE N'promotion%' OR p.[key] LIKE N'manifest%'
    ORDER BY p.[key];
  `);
  const described = new Map(
    PERMISSION_CATALOGUE.map((entry) => [entry.key as string, entry.description]),
  );
  const compiled = new Set<string>(PLATFORM_ADMINISTRATOR_PERMISSIONS);
  const gated = new Set<string>(EXTERNALLY_GATED_PERMISSIONS);
  const publishGated =
    gated.has(MIGRATION_PUBLISH_PERMISSION) &&
    !compiled.has(MIGRATION_PUBLISH_PERMISSION);
  if (
    permissions.map((row) => row.key).join(',') !== MIGRATION_PERMISSIONS.join(',') ||
    !MIGRATION_BUNDLED.every((key) => compiled.has(key) && !gated.has(key)) ||
    !publishGated ||
    permissions.some((row) => {
      const ordinary = MIGRATION_BUNDLED.includes(row.key);
      return (
        row.description !== described.get(row.key) ||
        Number(row.bundled) !== (ordinary ? 1 : 0) ||
        Number(row.held) !== (ordinary ? 1 : 0) ||
        Number(row.holders) !== 0
      );
    })
  )
    fail(
      `The Migration vocabulary must be exactly ${MIGRATION_PERMISSIONS.join(', ')}, described ` +
        `as the compiled catalogue describes them; the two ordinary keys each bundled once into ` +
        `the protected role and held by no other, and ${MIGRATION_PUBLISH_PERMISSION} gated and ` +
        `held by no role; found ${JSON.stringify(permissions)}.`,
    );

  const [publicationGrants] = await session.query<{ total: number }>(`
    SELECT COUNT(*) AS [total] FROM [dbo].[StepUpGrant] WHERE [purpose] = N'migration-publication';
  `);
  if (Number(publicationGrants?.total ?? -1) !== 0)
    fail(
      `A migrated database must hold no migration-publication step-up grant; found ` +
        `${String(publicationGrants?.total)}.`,
    );

  const provisioning = await session.query<{
    action: string;
    actorType: string;
    actorId: string | null;
    targetType: string;
    roleKey: string | null;
    afterState: string | null;
    authorisingSource: string | null;
  }>(`
    SELECT a.[action], a.[actorType], a.[actorId], a.[targetType], r.[key] AS [roleKey], a.[afterState], a.[authorisingSource]
    FROM [dbo].[AuditLog] a LEFT JOIN [dbo].[Role] r ON r.[id] = a.[targetId]
    WHERE a.[action] LIKE N'migration.%' OR a.[authorisingSource] = N'${MIGRATION_PROVENANCE_MIGRATION}';
  `);
  if (
    JSON.stringify(provisioning) !==
    JSON.stringify([
      {
        action: 'migration.permissions.provisioned',
        actorType: 'migration',
        actorId: null,
        targetType: 'role',
        roleKey: 'platform-administrator',
        afterState: '{"added":"migration.administer migration.read"}',
        authorisingSource: MIGRATION_PROVENANCE_MIGRATION,
      },
    ])
  )
    fail(
      `Extending the protected bundle must leave exactly one provisioning record naming the ` +
        `two ordinary Migration keys — never the gated publish key — and this migration, and ` +
        `nothing else of Migration & Provenance; found ${JSON.stringify(provisioning)}.`,
    );

  const bundled = await assertProtectedBundleExcludesGated(session);
  if (bundled !== PLATFORM_ADMINISTRATOR_PERMISSIONS.length)
    fail(
      `The protected bundle holds ${String(bundled)} keys; the compiled bundle holds ` +
        `${String(PLATFORM_ADMINISTRATOR_PERMISSIONS.length)}.`,
    );

  report(
    'migration schema',
    'eighteen empty tables — no source — of the reviewed shape, one raw VARBINARY(MAX) body ' +
      'and no credential, cookie, session or target column, thirty-seven unique keys with ' +
      'three filtered, sixty-five trusted NO ACTION keys, 17 CHECKs, eighteen triggers raising ' +
      '51370–51384, no procedure, two bundled ordinary keys provisioned once and one gated ' +
      `publish key held by nobody, ${String(bundled)} bundled`,
  );
}

/**
 * After the Phase-29 rollback: no Migration & Provenance table, trigger, key,
 * CHECK, index or default, no Migration permission, bundle entry, provisioning
 * record or `migration-publication` step-up grant — and the protected bundle
 * exactly the compiled bundle less the two bundled Migration keys. Identity's
 * User, Taxonomy's Topic, Media's Video and Storage's Asset are untouched by
 * the drop. The caller then proves the earlier owners are whole at
 * `before-migration`.
 */
async function assertMigrationRemoved(session: SqlSession): Promise<void> {
  const names = MIGRATION_TABLES.map((table) => `N'${table}'`).join(',');
  const triggerNames = Object.keys(MIGRATION_TRIGGER_NUMBERS)
    .map((name) => `N'${name}'`)
    .join(',');
  const keys = MIGRATION_PERMISSIONS.map((key) => `N'${key}'`).join(',');
  const [row] = await session.query<Record<string, number>>(`
    SELECT
      (SELECT COUNT(*) FROM sys.tables WHERE [name] IN (${names}) OR [name] LIKE N'Migration%') AS [tables],
      (SELECT COUNT(*) FROM sys.triggers WHERE [name] IN (${triggerNames}) OR [name] LIKE N'Migration%') AS [triggers],
      (SELECT COUNT(*) FROM sys.foreign_keys
        WHERE LEFT([name], CHARINDEX(N'_', [name] + N'_') - 1) IN (${names})) AS [keys],
      (SELECT COUNT(*) FROM sys.check_constraints
        WHERE LEFT([name], CHARINDEX(N'_', [name] + N'_') - 1) IN (${names})) AS [checks],
      (SELECT COUNT(*) FROM sys.indexes
        WHERE LEFT([name], CHARINDEX(N'_', [name] + N'_') - 1) IN (${names})) AS [indexes],
      (SELECT COUNT(*) FROM sys.default_constraints
        WHERE LEFT([name], CHARINDEX(N'_', [name] + N'_') - 1) IN (${names})) AS [defaults],
      (SELECT COUNT(*) FROM [dbo].[Permission] WHERE [key] IN (${keys}) OR [key] LIKE N'migration.%') AS [permissions],
      (SELECT COUNT(*) FROM [dbo].[RolePermission] WHERE [permissionKey] IN (${keys}) OR [permissionKey] LIKE N'migration.%') AS [bundled],
      (SELECT COUNT(*) FROM [dbo].[StepUpGrant] WHERE [purpose] = N'migration-publication') AS [grants],
      (SELECT COUNT(*) FROM [dbo].[AuditLog]
        WHERE [action] LIKE N'migration.%' OR [authorisingSource] = N'${MIGRATION_PROVENANCE_MIGRATION}') AS [audit],
      (SELECT 4 - COUNT(*) FROM sys.tables
        WHERE [object_id] IN (OBJECT_ID(N'[dbo].[User]'), OBJECT_ID(N'[dbo].[Topic]'),
                              OBJECT_ID(N'[dbo].[Video]'), OBJECT_ID(N'[dbo].[Asset]'))) AS [ownersBroken];
  `);
  if (Object.values(row ?? { missing: 1 }).some((value) => Number(value) !== 0))
    fail(
      `The Phase-29 rollback left a Migration & Provenance object: ` +
        `${JSON.stringify(row ?? null)}.`,
    );
  if (await migrationPresent(session))
    fail('The Phase-29 rollback left the Migration & Provenance schema in place.');
  const bundled = await assertProtectedBundleExcludesGated(session);
  const expected = compiledBundleAt('before-migration').length;
  if (
    bundled !== expected ||
    expected !== PLATFORM_ADMINISTRATOR_PERMISSIONS.length - MIGRATION_BUNDLED.length
  )
    fail(
      `After the Phase-29 rollback the protected bundle holds ${String(bundled)} keys; the ` +
        `compiled bundle less the two bundled Migration keys holds ${String(expected)}.`,
    );
  report(
    'migration rollback',
    `every Migration & Provenance table, key, index, CHECK, trigger, permission, publication ` +
      `grant and provisioning record removed, User, Topic, Video and Asset whole; ` +
      `${String(bundled)} keys still bundled`,
  );
}

/**
 * Phase 29 — THE BUNDLE EXTENSION AS BEHAVIOUR. Extending the protected
 * Platform Administrator bundle is a privilege change, so the migration must
 * revoke every live holder's sessions and step-up grants in the same
 * transaction and record exactly which keys it added (SECURITY_BASELINE.md
 * §8.1). A first deploy cannot show that — nobody holds the role yet — so this
 * rolls Phase 29 alone back on the re-deployed database, seeds a synthetic
 * holder of the protected role and a synthetic non-holder, each with a live
 * session and step-up grant, and re-applies Phase 29 through the REAL Prisma
 * CLI:
 *
 *   - the holder's sessions and grants are gone; the non-holder's survive;
 *   - exactly one `migration.permissions.provisioned` record names the two
 *     ordinary keys, and the protected bundle is the compiled bundle again;
 *   - the migration is in the history again and nothing else was re-applied.
 *
 * Both synthetic accounts are removed again afterwards: this disposable
 * database was never bootstrapped, so the final-administrator rule does not
 * hold the synthetic holder in place.
 */
async function assertMigrationBundleExtension(
  session: SqlSession,
  migration: Migration,
): Promise<void> {
  if (!(await migrationPresent(session)))
    fail('The bundle-extension proof needs Phase 29 applied first.');
  const run = randomUUID().replaceAll('-', '').slice(0, 16);
  const holder = randomUUID();
  const bystander = randomUUID();
  const historyBefore = await appliedMigrationNames(session);

  // The earlier owners' rule proofs have left synthetic roles holding their
  // gated keys by now, so the protected role's own bundle is compared directly
  // rather than through the whole-catalogue gate the deploy stages use.
  const protectedBundle = async (): Promise<string> => {
    const rows = await session.query<{ permissionKey: string }>(`
      SELECT rp.[permissionKey] FROM [dbo].[RolePermission] rp
      JOIN [dbo].[Role] r ON r.[id] = rp.[roleId]
      WHERE r.[key] = N'platform-administrator' ORDER BY rp.[permissionKey];
    `);
    return rows.map((row) => row.permissionKey).join(',');
  };
  const bundleAt = (stage: BundleStage): string =>
    [...compiledBundleAt(stage)].sort().join(',');

  await rollbackMigration(session, migration);
  if (await migrationPresent(session))
    fail('Rolling Phase 29 back alone left its schema in place.');
  if ((await protectedBundle()) !== bundleAt('before-migration'))
    fail(
      'Rolling Phase 29 back alone must leave the protected bundle exactly the compiled ' +
        'bundle less the two bundled Migration keys.',
    );

  await expectAccepted(
    session,
    'A synthetic protected-role holder and a bystander, each with a live session and grant',
    `INSERT INTO [dbo].[User] ([id],[name],[email],[emailVerified],[createdAt],[updatedAt],[locale],[status],[twoFactorEnabled]) VALUES
       (N'${holder}',N'NON_MIGRATION_FIXTURE holder',N'holder-${run}@migration-proof.invalid',0,SYSUTCDATETIME(),SYSUTCDATETIME(),N'en',N'active',0),
       (N'${bystander}',N'NON_MIGRATION_FIXTURE bystander',N'bystander-${run}@migration-proof.invalid',0,SYSUTCDATETIME(),SYSUTCDATETIME(),N'en',N'active',0);
     INSERT INTO [dbo].[RoleAssignment] ([userId],[roleId])
       SELECT N'${holder}', [id] FROM [dbo].[Role] WHERE [key] = N'platform-administrator';
     INSERT INTO [dbo].[Session] ([id],[token],[userId],[expiresAt],[createdAt],[updatedAt]) VALUES
       (N'${holder}',N'proof-migration-bundle-${holder}',N'${holder}',DATEADD(hour,1,SYSUTCDATETIME()),SYSUTCDATETIME(),SYSUTCDATETIME()),
       (N'${bystander}',N'proof-migration-bundle-${bystander}',N'${bystander}',DATEADD(hour,1,SYSUTCDATETIME()),SYSUTCDATETIME(),SYSUTCDATETIME());
     INSERT INTO [dbo].[StepUpGrant] ([id],[userId],[sessionId],[purpose],[expiresAt]) VALUES
       (N'${randomUUID()}',N'${holder}',N'${holder}',N'privilege-administration',DATEADD(minute,30,SYSUTCDATETIME())),
       (N'${randomUUID()}',N'${bystander}',N'${bystander}',N'account-administration',DATEADD(minute,30,SYSUTCDATETIME()));`,
  );

  const redeploy = await deployMigrations(disposableUrl, environment.values);
  if (!redeploy.output.includes(migration.id))
    fail(`Re-applying ${migration.id} alone did not report it.\n${redeploy.output}`);
  const historyAfter = await appliedMigrationNames(session);
  if (historyAfter.slice().sort().join(',') !== historyBefore.slice().sort().join(','))
    fail(
      `Re-applying Phase 29 alone changed the history: ${historyBefore.join(', ')} -> ` +
        `${historyAfter.join(', ')}.`,
    );

  const [after] = await session.query<Record<string, number | string | null>>(`
    SELECT
      (SELECT COUNT(*) FROM [dbo].[Session] WHERE [userId] = N'${holder}') AS [holderSessions],
      (SELECT COUNT(*) FROM [dbo].[StepUpGrant] WHERE [userId] = N'${holder}') AS [holderGrants],
      (SELECT COUNT(*) FROM [dbo].[Session] WHERE [userId] = N'${bystander}') AS [bystanderSessions],
      (SELECT COUNT(*) FROM [dbo].[StepUpGrant] WHERE [userId] = N'${bystander}') AS [bystanderGrants],
      (SELECT COUNT(*) FROM [dbo].[RoleAssignment] ra JOIN [dbo].[Role] r ON r.[id] = ra.[roleId]
        WHERE ra.[userId] = N'${holder}' AND r.[key] = N'platform-administrator' AND ra.[revokedAt] IS NULL) AS [stillHolder],
      (SELECT COUNT(*) FROM [dbo].[AuditLog]
        WHERE [action] = N'migration.permissions.provisioned'
          AND [authorisingSource] = N'${MIGRATION_PROVENANCE_MIGRATION}') AS [provisioned],
      (SELECT MAX([afterState]) FROM [dbo].[AuditLog]
        WHERE [action] = N'migration.permissions.provisioned') AS [added];
  `);
  const expected = {
    holderSessions: 0,
    holderGrants: 0,
    bystanderSessions: 1,
    bystanderGrants: 1,
    stillHolder: 1,
    provisioned: 1,
    added: '{"added":"migration.administer migration.read"}',
  };
  if (JSON.stringify(after) !== JSON.stringify(expected))
    fail(
      `Extending the protected bundle must revoke exactly its holders' sessions and step-up ` +
        `grants and record the two keys once; found ${JSON.stringify(after ?? null)}.`,
    );
  const bundle = await protectedBundle();
  if (bundle !== bundleAt('current'))
    fail(
      `After re-applying Phase 29 the protected bundle must be exactly the compiled bundle; ` +
        `found ${bundle}.`,
    );
  const bundled = bundle.split(',').length;

  await expectAccepted(
    session,
    'The synthetic holder and bystander removed again',
    `DELETE FROM [dbo].[StepUpGrant] WHERE [userId] IN (N'${holder}', N'${bystander}');
     DELETE FROM [dbo].[Session] WHERE [userId] IN (N'${holder}', N'${bystander}');
     DELETE FROM [dbo].[RoleAssignment] WHERE [userId] = N'${holder}';
     DELETE FROM [dbo].[User] WHERE [id] IN (N'${holder}', N'${bystander}');`,
  );
  report(
    'migration bundle',
    "re-applied alone through the real Prisma CLI: the protected role's live holder lost " +
      'its session and step-up grant, a non-holder kept both, and one provisioning record ' +
      `named migration.administer and migration.read; ${String(bundled)} bundled`,
  );
}

/**
 * Phase 29 — THE RULES, proved as behaviour against the re-deployed schema
 * with NON_MIGRATION_FIXTURE sentinels and `*.fixture.invalid` addresses only,
 * through the migration login (the runtime's own posture is
 * `db:test:permissions`'s, where identity, provenance and evidence columns and
 * every DELETE are DENY besides):
 *
 *   - a FIXTURE source carries no authorisation evidence and only a
 *     `*.fixture.invalid` base address; an http source has an address and an
 *     export source none; key, politeness and kind are bounded (…_ck); a source
 *     begins at version one and never changes its key, authority kind, access
 *     method, kind or creation, moving one version at a time (51370);
 *   - a host is a bare lower-case DNS name (…_ck); a fixture source names only
 *     `*.fixture.invalid` hosts, and a host is never changed or removed
 *     (51371);
 *   - a run begins open, unreconciled, at version one; keeps its source,
 *     operator, transform provenance and start; and once finished is never
 *     changed (51375); it reconciles only once completed (…_ck); ONE OPEN RUN
 *     PER SOURCE (the filtered key);
 *   - a record is first and last seen by its own source's runs (the composite
 *     keys); is classified only while missing, with who decided (…_ck); and
 *     keeps its source, key, kind and first sighting (51376);
 *   - a raw snapshot's body IS the bytes its SHA-256 names (…_ck); it is
 *     created with its body (51373), of a record and run of its own source (the
 *     composite keys); it is never rewritten — not even with its own bytes —
 *     and never deleted; the only change it accepts is a disposal of its body,
 *     once, with who, when and why (51372);
 *   - a staged revision begins pending at version one from a snapshot of its
 *     own record whose checksum it carries (51374, the composite key); its
 *     payload and provenance never change, and its review moves only forward
 *     (51374); only a valid revision free of flagged personal data is approved
 *     (…_ck);
 *   - a run item names a record of its own run's source; keeps its run,
 *     record and position; and leaves a terminal outcome only to retry an
 *     error (51377); its terminal outcome carries its evidence (…_ck);
 *   - a topic mapping is confirmed exactly when it names a Topic and who
 *     decided (…_ck) and never changes its source or category (51384); a
 *     rewritten link names its legacy mapping and a site-relative address
 *     (…_ck);
 *   - an ACCESS-DENIED error is never retry-eligible, and a retry is requested
 *     only of a retry-eligible error (…_ck); an error keeps what happened and
 *     its resolution only moves forward (51383);
 *   - a duplicate pair is two records; only the same provider video collapses
 *     automatically, and a CROSS-LANGUAGE pair is never merged (…_ck); a pair
 *     keeps its evidence (51383);
 *   - two acquisitions of ONE stored Asset keep their own licences; only owned
 *     or licensed material decided by a person is public-eligible (…_ck); an
 *     acquisition keeps what it acquired (51382);
 *   - a manifest begins a draft (51378); it is published and rolled back ONLY
 *     by an account holding `migration.publish` NOW through a live assignment
 *     of an active role, as an active account, AND a live
 *     `migration-publication` step-up on a live session (51378 — every missing
 *     piece refused, and accepted with all of them); its phases move only
 *     forward (51378);
 *   - an entry names an APPROVED, valid revision of its manifest's source and
 *     joins only a draft; it moves only in its manifest's own phase, and what
 *     it made is recorded once (51379); ONE LIVE ENTRY PER STAGED REVISION
 *     (the filtered key);
 *   - a legacy mapping names exactly one Video and a site-relative path
 *     (…_ck); ONE ACTIVE MAPPING PER LEGACY URL (the filtered key); it keeps
 *     its address and target (51380);
 *   - a promotion begins a draft; is approved only under the same live
 *     authority; carries only PUBLISHED entries, added while it is a draft;
 *     promotes each entry once while it is promoting; and moves only forward
 *     (51381);
 *   - nothing cascades: an Asset an acquisition names is never deleted from
 *     under it.
 *
 * The rows are evidence and history — a raw snapshot cannot be deleted at all
 * — so, like the canonical proofs above, they die with this disposable
 * database.
 */
async function assertMigrationRules(session: SqlSession): Promise<void> {
  const run = randomUUID().replaceAll('-', '').slice(0, 16);
  const at = '2026-10-11T00:00:00';
  const later = '2026-10-11T01:00:00';
  const settled = '2026-10-11T02:00:00';
  let refusals = 0;
  const refuse = async (
    label: string,
    statement: string,
    numbers: readonly number[],
    rule: string,
  ): Promise<void> => {
    await expectRefusal(session, label, statement, numbers, rule);
    refusals += 1;
  };
  const accept = (label: string, statement: string): Promise<void> =>
    expectAccepted(session, label, statement);
  const sha = (value: string | Buffer): string =>
    createHash('sha256').update(value).digest('hex');
  const SOURCE_FRESH = 'A source begins at version 1';
  const SOURCE_KEEPS = 'A source keeps its identity and authority';
  const HOST_FIXED = 'A source host is never changed or removed';
  const HOST_FIXTURE = 'A fixture source names only *.fixture.invalid hosts';
  const RUN_FRESH = 'A run begins open, unreconciled, at version 1';
  const RUN_KEEPS = 'a finished run is never changed';
  const RECORD_KEEPS = 'A record keeps its source, key, kind and first sighting';
  const ITEM_SOURCE = "A run item is a record of its own run's source";
  const ITEM_KEEPS = 'A run item keeps its place';
  const SNAPSHOT_DELETED = 'A raw snapshot is never deleted';
  const SNAPSHOT_KEEPS = 'A raw snapshot is never rewritten';
  const SNAPSHOT_BODY = 'A snapshot is created with its body';
  const STAGED_FRESH = 'A staged revision begins pending at version 1';
  const STAGED_KEEPS = 'A staged revision keeps its payload and provenance';
  const TOPIC_KEEPS = 'A topic mapping keeps its source and category';
  const ERROR_KEEPS = 'An error keeps what happened';
  const PAIR_KEEPS = 'A duplicate candidate keeps its pair and evidence';
  const ACQUISITION_KEEPS = 'An acquisition keeps what it acquired';
  const LEGACY_KEEPS = 'A legacy mapping keeps its address and target';
  const MANIFEST_FRESH = 'A manifest begins a draft';
  const MANIFEST_KEEPS = 'A manifest keeps its identity and moves only forward';
  const PUBLICATION = 'Migration publication authority is not held now';
  const ENTRY_JOINS = 'An entry names an approved revision';
  const ENTRY_MOVES = "An entry moves only in its manifest's own phase";
  const PROMOTION_FRESH = 'A promotion begins a draft';
  const PROMOTION_KEEPS = 'A promotion keeps its identity and moves only forward';
  const APPROVAL = 'Promotion approval authority is not held now';
  const PROMOTION_CARRIES = 'A promotion carries only published entries';
  const PROMOTED_ONCE = 'A promotion entry is promoted once';

  // ---- accounts, and the publication authority they may or may not hold ---------------
  const operator = randomUUID();
  const publisher = randomUUID();
  const keyOnly = randomUUID();
  const grantOnly = randomUUID();
  const wrongPurpose = randomUUID();
  const expiredGrant = randomUUID();
  const expiredSession = randomUUID();
  const revoked = randomUUID();
  const deactivated = randomUUID();
  const suspended = randomUUID();
  for (const [user, label] of [
    [operator, 'operator'],
    [publisher, 'publisher'],
    [keyOnly, 'key-only'],
    [grantOnly, 'grant-only'],
    [wrongPurpose, 'wrong-purpose'],
    [expiredGrant, 'expired-grant'],
    [expiredSession, 'expired-session'],
    [revoked, 'revoked'],
    [deactivated, 'deactivated'],
    [suspended, 'suspended'],
  ] as const)
    await session.query(
      `INSERT INTO [dbo].[User] ([id],[name],[email],[emailVerified],[createdAt],[updatedAt],[locale],[status],[twoFactorEnabled]) VALUES (N'${user}',N'NON_MIGRATION_FIXTURE ${label}',N'${label}-${run}@migration-proof.invalid',0,SYSUTCDATETIME(),SYSUTCDATETIME(),N'en',N'active',0);`,
    );
  const publishRole = randomUUID();
  const deadRole = randomUUID();
  const sessionOf = (user: string, hours: number): string =>
    `INSERT INTO [dbo].[Session] ([id],[token],[userId],[expiresAt],[createdAt],[updatedAt]) VALUES (N'${user}',N'proof-migration-${user}',N'${user}',DATEADD(hour,${String(hours)},SYSUTCDATETIME()),SYSUTCDATETIME(),SYSUTCDATETIME());`;
  const grantOf = (user: string, purpose: string, minutes: number): string =>
    `INSERT INTO [dbo].[StepUpGrant] ([id],[userId],[sessionId],[purpose],[expiresAt]) VALUES (N'${randomUUID()}',N'${user}',N'${user}',N'${purpose}',DATEADD(minute,${String(minutes)},SYSUTCDATETIME()));`;
  await accept(
    'A synthetic publication authority, and every way of lacking it',
    `INSERT INTO [dbo].[Role] ([id],[key],[name],[description],[system]) VALUES
       (N'${publishRole}',N'proof-migration-publish-${run}',N'Synthetic migration publication proof role',N'Holds migration.publish for the migration proof only.',0),
       (N'${deadRole}',N'proof-migration-dead-${run}',N'Synthetic deactivated publication proof role',N'Holds migration.publish for the migration proof only.',0);
     INSERT INTO [dbo].[RolePermission] ([roleId],[permissionKey]) VALUES
       (N'${publishRole}',N'${MIGRATION_PUBLISH_PERMISSION}'),(N'${deadRole}',N'${MIGRATION_PUBLISH_PERMISSION}');
     INSERT INTO [dbo].[RoleAssignment] ([userId],[roleId]) VALUES
       (N'${publisher}',N'${publishRole}'),(N'${keyOnly}',N'${publishRole}'),(N'${wrongPurpose}',N'${publishRole}'),
       (N'${expiredGrant}',N'${publishRole}'),(N'${expiredSession}',N'${publishRole}'),
       (N'${deactivated}',N'${deadRole}'),(N'${suspended}',N'${publishRole}');
     INSERT INTO [dbo].[RoleAssignment] ([userId],[roleId],[revokedAt],[revokedReason]) VALUES
       (N'${revoked}',N'${publishRole}',SYSUTCDATETIME(),N'Synthetic revocation for the migration proof.');
     UPDATE [dbo].[Role] SET [deactivatedAt]=SYSUTCDATETIME() WHERE [id]=N'${deadRole}';
     ${sessionOf(publisher, 1)}
     ${sessionOf(keyOnly, 1)}
     ${sessionOf(grantOnly, 1)}
     ${sessionOf(wrongPurpose, 1)}
     ${sessionOf(expiredGrant, 1)}
     ${sessionOf(expiredSession, -1)}
     ${sessionOf(revoked, 1)}
     ${sessionOf(deactivated, 1)}
     ${sessionOf(suspended, 1)}
     ${grantOf(publisher, 'migration-publication', 30)}
     ${grantOf(grantOnly, 'migration-publication', 30)}
     ${grantOf(wrongPurpose, 'donation-refund', 30)}
     ${grantOf(expiredGrant, 'migration-publication', -1)}
     ${grantOf(expiredSession, 'migration-publication', 30)}
     ${grantOf(revoked, 'migration-publication', 30)}
     ${grantOf(deactivated, 'migration-publication', 30)}
     ${grantOf(suspended, 'migration-publication', 30)}
     UPDATE [dbo].[User] SET [status]=N'suspended' WHERE [id]=N'${suspended}';`,
  );

  // ---- Media's Videos, Storage's Asset and Taxonomy's Topic, as their owners write them --
  const video = randomUUID();
  const otherVideo = randomUUID();
  const asset = randomUUID();
  const assetBytes = Buffer.from(`NON_MIGRATION_FIXTURE asset ${run}`, 'utf8');
  await accept(
    "Media's Videos and Storage's Asset for the targets",
    `INSERT INTO [dbo].[Video] ([id],[slug],[primaryLocale],[state],[provider],[providerVideoId],[availability],[languageCode],[version],[updatedAt]) VALUES
       (N'${video}',N'proof-migration-${run}',N'en',N'published',N'youtube','m${run.slice(0, 10)}',N'available',N'en',1,SYSUTCDATETIME()),
       (N'${otherVideo}',N'proof-migration-other-${run}',N'ur',N'published',N'youtube','n${run.slice(0, 10)}',N'available',N'ur',1,SYSUTCDATETIME());
     INSERT INTO [dbo].[Asset] ([id],[storageKey],[mediaType],[byteSize],[checksum],[state],[displayName],[updatedAt])
       VALUES (N'${asset}',N'${run.slice(0, 2)}/${run.slice(2, 4)}/${run}${run}',N'image/png',${String(assetBytes.byteLength)},N'${sha(assetBytes)}',N'clean',NULL,SYSUTCDATETIME());`,
  );
  const [topicRow] = await session.query<{ id: string }>(
    `SELECT TOP 1 [id] FROM [dbo].[Topic] ORDER BY [slug];`,
  );
  if (topicRow === undefined) fail('The Migration rules need a canonical Topic.');
  const topic = topicRow.id;

  // ---- statements ----------------------------------------------------------------------
  const host = `legacy-${run}.fixture.invalid`;
  const source = (
    id: string,
    key: string,
    extra: Readonly<Record<string, string>> = {},
  ): string => {
    const columns: Record<string, string> = {
      id: `N'${id}'`,
      key: `N'${key}'`,
      name: `N'NON_MIGRATION_FIXTURE source'`,
      authorityKind: `N'fixture'`,
      accessMethod: `N'http'`,
      contentKind: `N'media.video'`,
      baseUrl: `N'https://${host}/'`,
      minIntervalMs: '1000',
      maxConcurrency: '1',
      maxAttempts: '3',
      timeoutMs: '10000',
      maxBodyBytes: '1048576',
      maxRedirects: '2',
      state: `N'active'`,
      createdAt: `'${at}'`,
      createdByUserId: `N'${operator}'`,
      updatedAt: `'${at}'`,
      updatedByUserId: `N'${operator}'`,
      ...extra,
    };
    return `INSERT INTO [dbo].[MigrationSource] (${Object.keys(columns)
      .map((name) => `[${name}]`)
      .join(',')}) VALUES (${Object.values(columns).join(',')});`;
  };
  const set = (table: string, id: string, assignments: string): string =>
    `UPDATE [dbo].[${table}] SET ${assignments} WHERE [id]=N'${id}';`;
  const runRow = (
    id: string,
    sourceId: string,
    extra: Readonly<Record<string, string>> = {},
  ): string => {
    const columns: Record<string, string> = {
      id: `N'${id}'`,
      sourceId: `N'${sourceId}'`,
      operatorUserId: `N'${operator}'`,
      state: `N'open'`,
      adapterKey: `N'fixture-video'`,
      adapterVersion: `N'1'`,
      parserKey: `N'fixture-video'`,
      parserVersion: `N'1'`,
      normalizerVersion: `N'1'`,
      codeRevision: `N'proof'`,
      startedAt: `'${at}'`,
      ...extra,
    };
    return `INSERT INTO [dbo].[MigrationRun] (${Object.keys(columns)
      .map((name) => `[${name}]`)
      .join(',')}) VALUES (${Object.values(columns).join(',')});`;
  };
  const recordRow = (
    id: string,
    sourceId: string,
    firstRun: string,
    key: string,
    extra: Readonly<Record<string, string>> = {},
  ): string => {
    const columns: Record<string, string> = {
      id: `N'${id}'`,
      sourceId: `N'${sourceId}'`,
      externalKey: `N'${key}'`,
      originalUrl: `N'https://${host}/videos/${key}'`,
      contentKind: `N'media.video'`,
      status: `N'discovered'`,
      firstObservedRunId: `N'${firstRun}'`,
      lastObservedRunId: `N'${firstRun}'`,
      createdAt: `'${at}'`,
      updatedAt: `'${at}'`,
      ...extra,
    };
    return `INSERT INTO [dbo].[MigrationRecord] (${Object.keys(columns)
      .map((name) => `[${name}]`)
      .join(',')}) VALUES (${Object.values(columns).join(',')});`;
  };
  const body = Buffer.from(`<p>NON_MIGRATION_FIXTURE raw body ${run}</p>`, 'utf8');
  const snapshot = (
    id: string,
    recordId: string,
    sourceId: string,
    runId: string,
    extra: Readonly<Record<string, string>> = {},
  ): string => {
    const columns: Record<string, string> = {
      id: `N'${id}'`,
      sourceId: `N'${sourceId}'`,
      recordId: `N'${recordId}'`,
      runId: `N'${runId}'`,
      requestedUrl: `N'https://${host}/videos/${id}'`,
      finalUrl: `N'https://${host}/videos/${id}'`,
      httpStatus: '200',
      contentType: `N'text/html'`,
      headers: `N'{"content-type":"text/html"}'`,
      body: `0x${body.toString('hex')}`,
      byteSize: String(body.byteLength),
      checksum: `'${sha(body)}'`,
      fetchedAt: `'${at}'`,
      fetcherKey: `N'fixture-fetch'`,
      fetcherVersion: `N'1'`,
      personalData: `N'none'`,
      ...extra,
    };
    return `INSERT INTO [dbo].[MigrationRawSnapshot] (${Object.keys(columns)
      .map((name) => `[${name}]`)
      .join(',')}) VALUES (${Object.values(columns).join(',')});`;
  };
  const payload = (title: string): string =>
    JSON.stringify({
      title,
      provider: 'youtube',
      providerVideoId: `m${run.slice(0, 10)}`,
    });
  const staged = (
    id: string,
    recordId: string,
    snapshotId: string,
    runId: string,
    revision: number,
    extra: Readonly<Record<string, string>> = {},
  ): string => {
    const content = payload(`NON_MIGRATION_FIXTURE title ${String(revision)}`);
    const columns: Record<string, string> = {
      id: `N'${id}'`,
      recordId: `N'${recordId}'`,
      snapshotId: `N'${snapshotId}'`,
      runId: `N'${runId}'`,
      revision: String(revision),
      contentKind: `N'media.video'`,
      title: `N'NON_MIGRATION_FIXTURE title'`,
      titleKey: `N'non migration fixture title'`,
      dedupeKey: `N'youtube:m${run.slice(0, 10)}'`,
      languageCode: `N'en'`,
      payload: `N'${content}'`,
      payloadChecksum: `'${sha(content)}'`,
      adapterKey: `N'fixture-video'`,
      adapterVersion: `N'1'`,
      parserKey: `N'fixture-video'`,
      parserVersion: `N'1'`,
      normalizerVersion: `N'1'`,
      codeRevision: `N'proof'`,
      inputChecksum: `'${sha(body)}'`,
      producedAt: `'${at}'`,
      validation: `N'valid'`,
      personalData: `N'none'`,
      ...extra,
    };
    return `INSERT INTO [dbo].[MigrationStagedRecord] (${Object.keys(columns)
      .map((name) => `[${name}]`)
      .join(',')}) VALUES (${Object.values(columns).join(',')});`;
  };
  const approve = (id: string): string =>
    set(
      'MigrationStagedRecord',
      id,
      `[review]=N'approved',[reviewedByUserId]=N'${operator}',[reviewedAt]='${later}',[version]=[version]+1`,
    );
  const item = (id: string, runId: string, recordId: string, position: number): string =>
    `INSERT INTO [dbo].[MigrationRunItem] ([id],[runId],[recordId],[position],[updatedAt]) VALUES (N'${id}',N'${runId}',N'${recordId}',${String(position)},'${at}');`;

  // ---- a FIXTURE source: no evidence, only a *.fixture.invalid address -----------------
  const fixture = randomUUID();
  const other = randomUUID();
  const exported = randomUUID();
  for (const [label, statement] of [
    [
      'A fixture source carrying an authorisation reference',
      source(randomUUID(), `proof-a-${run}`, {
        authorisationReference: `N'NON_MIGRATION_FIXTURE forged'`,
        authorisedOn: `'2026-10-11'`,
      }),
    ],
    [
      'A fixture source at a real address',
      source(randomUUID(), `proof-b-${run}`, { baseUrl: `N'https://example.org/'` }),
    ],
    [
      'A fixture source under a look-alike suffix',
      source(randomUUID(), `proof-c-${run}`, {
        baseUrl: `N'https://legacy.fixture.invalid.example.org/'`,
      }),
    ],
    [
      'An http source with no address',
      source(randomUUID(), `proof-d-${run}`, { baseUrl: 'NULL' }),
    ],
    [
      'An export source with an address',
      source(randomUUID(), `proof-e-${run}`, { accessMethod: `N'export'` }),
    ],
    [
      'An authorised source without its written authorisation',
      source(randomUUID(), `proof-f-${run}`, { authorityKind: `N'authorised'` }),
    ],
    ['An upper-case source key', source(randomUUID(), `Proof-G-${run}`)],
    [
      'A source retrying seven times',
      source(randomUUID(), `proof-h-${run}`, { maxAttempts: '7' }),
    ],
    [
      'A source fetching five at once',
      source(randomUUID(), `proof-i-${run}`, { maxConcurrency: '5' }),
    ],
    [
      'A source of another content kind',
      source(randomUUID(), `proof-j-${run}`, { contentKind: `N'editorial.article'` }),
    ],
  ] as const)
    await refuse(label, statement, [547], 'MigrationSource_ck');
  // The address's AUTHORITY — between the scheme and the next slash — is what
  // must be a lower-case *.fixture.invalid name; a suffix later in the path, a
  // port, an upper-case name or no path at all is refused.
  for (const [label, url] of [
    [
      'A real host behind a fixture-looking path',
      'https://example.org/x.fixture.invalid/',
    ],
    [
      'A plain-http real host behind a fixture-looking path',
      'http://evil.test/a.fixture.invalid/',
    ],
    ['An upper-case fixture host', `https://Legacy-${run}.fixture.invalid/`],
    ['A fixture host with a port', `https://legacy-${run}.fixture.invalid:443/`],
    ['A fixture address with no path', `http://legacy-${run}.fixture.invalid`],
  ] as const)
    await refuse(
      label,
      source(randomUUID(), `proof-url-${randomUUID().slice(0, 8)}`, {
        baseUrl: `N'${url}'`,
      }),
      [547],
      'MigrationSource_ck',
    );
  await accept(
    'A hyphenated plain-http fixture address',
    source(randomUUID(), `proof-hyphen-${run}`, {
      baseUrl: `N'http://legacy-${run}.fixture.invalid/'`,
    }),
  );
  await refuse(
    'A source inserted at version two',
    source(randomUUID(), `proof-k-${run}`, { version: '2' }),
    [51370],
    SOURCE_FRESH,
  );
  await accept(
    'Fixture sources: two by http, one by export',
    `${source(fixture, `proof-${run}`)}
     ${source(other, `proof-other-${run}`, { baseUrl: `N'https://other-${run}.fixture.invalid/'` })}
     ${source(exported, `proof-export-${run}`, { accessMethod: `N'export'`, baseUrl: 'NULL' })}`,
  );
  await refuse(
    'A second source under one key',
    source(randomUUID(), `proof-${run}`),
    [2627, 2601],
    'MigrationSource_key_key',
  );
  for (const [label, assignments] of [
    [
      'A fixture source re-kinded as authorised',
      `[authorityKind]=N'authorised',[authorisationReference]=N'NON_MIGRATION_FIXTURE forged',[authorisedOn]='2026-10-11',[version]=[version]+1`,
    ],
    ['A source re-keyed', `[key]=N'proof-rekeyed-${run}',[version]=[version]+1`],
    [
      'A source re-accessed by export',
      `[accessMethod]=N'export',[baseUrl]=NULL,[version]=[version]+1`,
    ],
    ['A source re-created', `[createdAt]='${later}',[version]=[version]+1`],
    ['A source re-attributed', `[createdByUserId]=N'${publisher}',[version]=[version]+1`],
    ['A source edited without a version', `[name]=N'NON_MIGRATION_FIXTURE renamed'`],
    [
      'A source moved two versions',
      `[name]=N'NON_MIGRATION_FIXTURE renamed',[version]=[version]+2`,
    ],
  ] as const)
    await refuse(
      label,
      set('MigrationSource', fixture, assignments),
      [51370],
      SOURCE_KEEPS,
    );
  await accept(
    'A source renamed, slowed and deactivated one version at a time',
    `${set('MigrationSource', fixture, `[name]=N'NON_MIGRATION_FIXTURE renamed',[minIntervalMs]=2000,[state]=N'inactive',[version]=[version]+1,[updatedAt]='${later}'`)}
     ${set('MigrationSource', fixture, `[state]=N'active',[version]=[version]+1,[updatedAt]='${later}'`)}`,
  );

  // ---- hosts: bare DNS names, fixed, and only *.fixture.invalid for a fixture -----------
  const hostRow = (sourceId: string, name: string): string =>
    `INSERT INTO [dbo].[MigrationSourceHost] ([sourceId],[host]) VALUES (N'${sourceId}',N'${name}');`;
  await accept(
    'Fixture hosts under *.fixture.invalid',
    `${hostRow(fixture, host)}
     ${hostRow(fixture, `media-${run}.fixture.invalid`)}
     ${hostRow(other, `other-${run}.fixture.invalid`)}`,
  );
  // A DNS label may carry a hyphen; refusing one would refuse ordinary host names.
  await accept(
    'A fixture host with hyphens in several labels',
    hostRow(fixture, `cdn-${run}.mirror-a.fixture.invalid`),
  );
  for (const [label, name] of [
    ['A fixture host under .example.invalid', `legacy-${run}.example.invalid`],
    ['The bare fixture.invalid name', 'fixture.invalid'],
    ['A host merely ending in fixture.invalid', `evil${run}fixture.invalid`],
    ['A host under a look-alike suffix', 'legacy.fixture.invalid.example.org'],
  ] as const)
    await refuse(label, hostRow(fixture, name), [51371], HOST_FIXTURE);
  for (const [label, name] of [
    ['An upper-case host', `Upper${run}.fixture.invalid`],
    ['A host with a port', `legacy-${run}.fixture.invalid:443`],
    ['A host with a leading dot', `.legacy-${run}.fixture.invalid`],
    ['A host with a trailing dot', `legacy-${run}.fixture.invalid.`],
    ['A host with a path', `legacy-${run}.fixture.invalid/videos`],
  ] as const)
    await refuse(label, hostRow(fixture, name), [547], 'MigrationSourceHost_ck');
  await refuse(
    'A host named twice',
    hostRow(fixture, host),
    [2627, 2601],
    'MigrationSourceHost_pkey',
  );
  await refuse(
    'A host re-pointed',
    `UPDATE [dbo].[MigrationSourceHost] SET [host]=N'moved-${run}.fixture.invalid' WHERE [sourceId]=N'${fixture}' AND [host]=N'${host}';`,
    [51371],
    HOST_FIXED,
  );
  await refuse(
    'A host removed',
    `DELETE FROM [dbo].[MigrationSourceHost] WHERE [sourceId]=N'${fixture}' AND [host]=N'${host}';`,
    [51371],
    HOST_FIXED,
  );

  // ---- runs: one open per source, provenance fixed, a finished run frozen ---------------
  const firstRun = randomUUID();
  const otherRun = randomUUID();
  await refuse(
    'A run inserted completed',
    runRow(randomUUID(), exported, {
      state: `N'completed'`,
      endedAt: `'${later}'`,
      discoveryComplete: '1',
    }),
    [51375],
    RUN_FRESH,
  );
  await refuse(
    'A run inserted at version two',
    runRow(randomUUID(), exported, { version: '2' }),
    [51375],
    RUN_FRESH,
  );
  for (const [label, extra] of [
    ['An open run already ended', { endedAt: `'${later}'` }],
    [
      'An open run reconciled',
      { reconciliation: `N'balanced'`, reconciledAt: `'${later}'` },
    ],
    ['A lease with no expiry', { leaseToken: `N'${randomUUID()}'` }],
    ['A run in an unknown state', { state: `N'paused'` }],
  ] as const)
    await refuse(label, runRow(randomUUID(), exported, extra), [547], 'MigrationRun_ck');
  await accept(
    'One open run for each of two sources',
    `${runRow(firstRun, fixture)} ${runRow(otherRun, other)}`,
  );
  await refuse(
    'A second open run of one source',
    runRow(randomUUID(), fixture),
    [2601, 2627],
    'MigrationRun_open_key',
  );
  for (const [label, assignments] of [
    ['A run re-versioned by its adapter', `[adapterVersion]=N'2'`],
    ['A run given another operator', `[operatorUserId]=N'${publisher}'`],
    ['A run re-started', `[startedAt]='${later}'`],
    ['A run given another code revision', `[codeRevision]=N'forged'`],
  ] as const)
    await refuse(label, set('MigrationRun', firstRun, assignments), [51375], RUN_KEEPS);
  await accept(
    'A run leased and its discovery completed',
    set(
      'MigrationRun',
      firstRun,
      `[leaseToken]=N'${randomUUID()}',[leaseExpiresAt]='${later}',[discoveryCursor]=N'page-2',[discoveryComplete]=1,[version]=[version]+1`,
    ),
  );
  await refuse(
    'A complete discovery reopened',
    set('MigrationRun', firstRun, `[discoveryComplete]=0,[version]=[version]+1`),
    [51375],
    RUN_KEEPS,
  );

  // ---- records: each seen by its own source's runs ----------------------------------------
  const record = randomUUID();
  const vanished = randomUUID();
  const twin = randomUUID();
  const urdu = randomUUID();
  const foreign = randomUUID();
  const spare = randomUUID();
  await accept(
    'Records of each source, first seen by their own runs',
    `${recordRow(record, fixture, firstRun, `video-${run}`)}
     ${recordRow(vanished, fixture, firstRun, `gone-${run}`)}
     ${recordRow(twin, fixture, firstRun, `twin-${run}`)}
     ${recordRow(urdu, fixture, firstRun, `urdu-${run}`)}
     ${recordRow(spare, fixture, firstRun, `spare-${run}`)}
     ${recordRow(foreign, other, otherRun, `other-${run}`)}`,
  );
  await refuse(
    "A record first seen by another source's run",
    recordRow(randomUUID(), fixture, otherRun, `stray-${run}`, {
      lastObservedRunId: `N'${firstRun}'`,
    }),
    [547],
    'MigrationRecord_firstObservedRunId_fkey',
  );
  await refuse(
    'A second record under one external key',
    recordRow(randomUUID(), fixture, firstRun, `video-${run}`),
    [2627, 2601],
    'MigrationRecord_source_key',
  );
  for (const [label, extra] of [
    ['A present record with a disappearance', { disappearance: `N'withdrawn'` }],
    ['A merged record naming nothing', { status: `N'merged'` }],
    ['A record of another content kind', { contentKind: `N'editorial.article'` }],
    [
      'A missing record classified by nobody',
      {
        observed: `N'missing'`,
        disappearance: `N'withdrawn'`,
        classifiedAt: `'${later}'`,
      },
    ],
  ] as const)
    await refuse(
      label,
      recordRow(randomUUID(), fixture, firstRun, `bad-${randomUUID()}`, extra),
      [547],
      'MigrationRecord_ck',
    );
  await refuse(
    'A record merged into itself',
    set(
      'MigrationRecord',
      spare,
      `[status]=N'merged',[mergedIntoRecordId]=[id],[version]=[version]+1`,
    ),
    [547],
    'MigrationRecord_ck',
  );
  for (const [label, assignments] of [
    ['A record re-keyed', `[externalKey]=N'rekeyed-${run}'`],
    ['A record re-created', `[createdAt]='${later}'`],
  ] as const)
    await refuse(
      label,
      set('MigrationRecord', record, `${assignments},[version]=[version]+1`),
      [51376],
      RECORD_KEEPS,
    );

  // ---- raw snapshots: the bytes their checksum names, never rewritten or deleted -------
  const held = randomUUID();
  const doomed = randomUUID();
  const twinSnapshot = randomUUID();
  const urduSnapshot = randomUUID();
  const foreignSnapshot = randomUUID();
  const loose = randomUUID();
  for (const [label, extra] of [
    [
      'A body that is not its checksum',
      { checksum: `'${sha('NON_MIGRATION_FIXTURE other')}'` },
    ],
    ['A body that is not its size', { byteSize: String(body.byteLength + 1) }],
    ['An upper-case checksum', { checksum: `'${sha(body).toUpperCase()}'` }],
    ['Headers that are not JSON', { headers: `N'content-type: text/html'` }],
    ['An impossible status', { httpStatus: '700' }],
    ['An unknown personal-data flag', { personalData: `N'unknown'` }],
  ] as const)
    await refuse(
      label,
      snapshot(randomUUID(), record, fixture, firstRun, extra),
      [547],
      'MigrationRawSnapshot_ck',
    );
  await refuse(
    'A snapshot created without its body',
    snapshot(randomUUID(), record, fixture, firstRun, {
      body: 'NULL',
      disposedAt: `'${at}'`,
      disposedByUserId: `N'${operator}'`,
      disposalReason: `N'NON_MIGRATION_FIXTURE never held'`,
    }),
    [51373],
    SNAPSHOT_BODY,
  );
  await refuse(
    "A snapshot from another source's run",
    snapshot(randomUUID(), record, fixture, otherRun),
    [547],
    'MigrationRawSnapshot_runId_fkey',
  );
  await refuse(
    "A snapshot of another source's record",
    snapshot(randomUUID(), record, other, otherRun),
    [547],
    'MigrationRawSnapshot_recordId_fkey',
  );
  await accept(
    'Snapshots holding exactly the bytes their checksums name',
    `${snapshot(held, record, fixture, firstRun)}
     ${snapshot(doomed, vanished, fixture, firstRun)}
     ${snapshot(twinSnapshot, twin, fixture, firstRun)}
     ${snapshot(urduSnapshot, urdu, fixture, firstRun)}
     ${snapshot(foreignSnapshot, foreign, other, otherRun)}
     ${snapshot(loose, spare, fixture, firstRun)}`,
  );
  for (const [label, assignments] of [
    ['A snapshot status rewritten', `[httpStatus]=201`],
    ['A snapshot body rewritten with its own bytes', `[body]=[body]`],
    ['A snapshot re-dated', `[fetchedAt]='${later}'`],
    [
      'A disposal that also rewrites the checksum',
      `[body]=NULL,[checksum]=REPLICATE('0',64),[disposedAt]='${later}',[disposedByUserId]=N'${operator}',[disposalReason]=N'NON_MIGRATION_FIXTURE disposal'`,
    ],
    [
      'A disposal that also moves the address',
      `[body]=NULL,[finalUrl]=N'https://${host}/moved',[disposedAt]='${later}',[disposedByUserId]=N'${operator}',[disposalReason]=N'NON_MIGRATION_FIXTURE disposal'`,
    ],
  ] as const)
    await refuse(
      label,
      set('MigrationRawSnapshot', held, assignments),
      [51372],
      SNAPSHOT_KEEPS,
    );
  await refuse(
    'A body replaced by other bytes',
    set('MigrationRawSnapshot', held, `[body]=0x00`),
    [547],
    'MigrationRawSnapshot_ck',
  );
  await refuse(
    'A disposal without a reason',
    set(
      'MigrationRawSnapshot',
      doomed,
      `[body]=NULL,[disposedAt]='${later}',[disposedByUserId]=N'${operator}'`,
    ),
    [547],
    'MigrationRawSnapshot_ck',
  );
  await accept(
    'A body disposed of, its checksum and row kept',
    set(
      'MigrationRawSnapshot',
      doomed,
      `[body]=NULL,[disposedAt]='${later}',[disposedByUserId]=N'${operator}',[disposalReason]=N'NON_MIGRATION_FIXTURE disposal'`,
    ),
  );
  await refuse(
    'A disposed snapshot disposed of again',
    set(
      'MigrationRawSnapshot',
      doomed,
      `[disposalReason]=N'NON_MIGRATION_FIXTURE again'`,
    ),
    [51372],
    SNAPSHOT_KEEPS,
  );
  await refuse(
    'A snapshot deleted',
    `DELETE FROM [dbo].[MigrationRawSnapshot] WHERE [id]=N'${loose}';`,
    [51372],
    SNAPSHOT_DELETED,
  );

  // ---- staged revisions: from their own record's snapshot, payload fixed -----------------
  const revision = randomUUID();
  const vanishedRevision = randomUUID();
  const twinRevision = randomUUID();
  const urduRevision = randomUUID();
  const foreignRevision = randomUUID();
  const invalid = randomUUID();
  await refuse(
    'A revision of bytes its snapshot does not hold',
    staged(randomUUID(), record, held, firstRun, 9, {
      inputChecksum: `'${sha('NON_MIGRATION_FIXTURE other')}'`,
    }),
    [51374],
    STAGED_FRESH,
  );
  await refuse(
    'A revision inserted approved',
    staged(randomUUID(), record, held, firstRun, 9, {
      review: `N'approved'`,
      reviewedByUserId: `N'${operator}'`,
      reviewedAt: `'${later}'`,
    }),
    [51374],
    STAGED_FRESH,
  );
  await refuse(
    'A revision inserted at version two',
    staged(randomUUID(), record, held, firstRun, 9, { version: '2' }),
    [51374],
    STAGED_FRESH,
  );
  await refuse(
    'A pending revision carrying a reviewer',
    staged(randomUUID(), record, held, firstRun, 9, {
      reviewedByUserId: `N'${operator}'`,
    }),
    [51374],
    STAGED_FRESH,
  );
  await refuse(
    "A revision produced in another source's run",
    staged(randomUUID(), record, held, otherRun, 9),
    [51374],
    STAGED_FRESH,
  );
  await refuse(
    "A revision of another record's snapshot",
    staged(randomUUID(), record, twinSnapshot, firstRun, 9),
    [547],
    'MigrationStagedRecord_snapshotId_fkey',
  );
  for (const [label, extra] of [
    ['A payload that is not JSON', { payload: `N'not json'` }],
    ['A payload checksum that is not hex', { payloadChecksum: `'${'z'.repeat(64)}'` }],
    ['An unknown validation', { validation: `N'unknown'` }],
  ] as const)
    await refuse(
      label,
      staged(randomUUID(), record, held, firstRun, 9, extra),
      [547],
      'MigrationStagedRecord_ck',
    );
  await accept(
    'Pending revisions, one invalid',
    `${staged(revision, record, held, firstRun, 1)}
     ${staged(vanishedRevision, vanished, doomed, firstRun, 1)}
     ${staged(twinRevision, twin, twinSnapshot, firstRun, 1)}
     ${staged(urduRevision, urdu, urduSnapshot, firstRun, 1, { languageCode: `N'ur'`, dedupeKey: `N'youtube:n${run.slice(0, 10)}'` })}
     ${staged(foreignRevision, foreign, foreignSnapshot, otherRun, 1)}
     ${staged(invalid, record, held, firstRun, 2, { validation: `N'invalid'`, issues: `N'["title-missing"]'` })}`,
  );
  await refuse(
    'A second revision under one number',
    staged(randomUUID(), record, held, firstRun, 1),
    [2627, 2601],
    'MigrationStagedRecord_record_revision_key',
  );
  for (const [label, assignments] of [
    ['A payload rewritten', `[payload]=N'{"title":"forged"}'`],
    ['A title rewritten', `[title]=N'NON_MIGRATION_FIXTURE forged'`],
    ['An input checksum rewritten', `[inputChecksum]=REPLICATE('0',64)`],
    ['A personal-data flag cleared', `[personalData]=N'flagged'`],
    ['A revision re-parsed by another parser', `[parserVersion]=N'2'`],
  ] as const)
    await refuse(
      label,
      set('MigrationStagedRecord', revision, `${assignments},[version]=[version]+1`),
      [51374],
      STAGED_KEEPS,
    );
  await refuse(
    'A review moved without a version',
    set(
      'MigrationStagedRecord',
      revision,
      `[review]=N'approved',[reviewedByUserId]=N'${operator}',[reviewedAt]='${later}'`,
    ),
    [51374],
    STAGED_KEEPS,
  );
  await refuse(
    'An invalid revision approved',
    approve(invalid),
    [547],
    'MigrationStagedRecord_ck',
  );
  await accept(
    'A revision approved, the approval withdrawn, and approved again',
    `${approve(revision)}
     ${set('MigrationStagedRecord', revision, `[review]=N'pending',[version]=[version]+1`)}
     ${approve(revision)}
     ${approve(twinRevision)}
     ${approve(urduRevision)}
     ${approve(foreignRevision)}
     ${set('MigrationStagedRecord', invalid, `[review]=N'rejected',[reviewedByUserId]=N'${operator}',[reviewedAt]='${later}',[version]=[version]+1`)}`,
  );
  await refuse(
    'An approval moved to rejected',
    set('MigrationStagedRecord', revision, `[review]=N'rejected',[version]=[version]+1`),
    [51374],
    STAGED_KEEPS,
  );
  await refuse(
    'A rejection moved back to pending',
    set('MigrationStagedRecord', invalid, `[review]=N'pending',[version]=[version]+1`),
    [51374],
    STAGED_KEEPS,
  );

  // ---- run items: their own source, their own place, forward-only -------------------------
  const recordItem = randomUUID();
  const vanishedItem = randomUUID();
  const twinItem = randomUUID();
  await refuse(
    "An item for another source's record",
    item(randomUUID(), firstRun, foreign, 9),
    [51377],
    ITEM_SOURCE,
  );
  await accept(
    'Items in discovery order',
    `${item(recordItem, firstRun, record, 0)}
     ${item(vanishedItem, firstRun, vanished, 1)}
     ${item(twinItem, firstRun, twin, 2)}
     ${item(randomUUID(), firstRun, urdu, 3)}`,
  );
  await refuse(
    'Two items at one position',
    item(randomUUID(), firstRun, spare, 0),
    [2627, 2601],
    'MigrationRunItem_run_position_key',
  );
  await refuse(
    'A record twice in one run',
    item(randomUUID(), firstRun, record, 9),
    [2627, 2601],
    'MigrationRunItem_run_record_key',
  );
  for (const [label, assignments] of [
    [
      'A staged item with no revision',
      `[outcome]=N'staged',[fetched]=1,[parsed]=1,[snapshotId]=N'${twinSnapshot}'`,
    ],
    ['A parsed item never fetched', `[parsed]=1`],
    ['An errored item with no error', `[outcome]=N'errored'`],
  ] as const)
    await refuse(
      label,
      set('MigrationRunItem', twinItem, assignments),
      [547],
      'MigrationRunItem_ck',
    );
  await refuse(
    "An item holding another record's snapshot",
    set('MigrationRunItem', twinItem, `[fetched]=1,[snapshotId]=N'${held}'`),
    [547],
    'MigrationRunItem_snapshotId_fkey',
  );
  await accept(
    'Items fetched, parsed and staged',
    `${set('MigrationRunItem', recordItem, `[outcome]=N'staged',[fetched]=1,[parsed]=1,[attempts]=1,[snapshotId]=N'${held}',[stagedRecordId]=N'${revision}',[updatedAt]='${later}'`)}
     ${set('MigrationRunItem', twinItem, `[outcome]=N'staged',[fetched]=1,[parsed]=1,[attempts]=1,[snapshotId]=N'${twinSnapshot}',[stagedRecordId]=N'${twinRevision}',[updatedAt]='${later}'`)}
     ${set('MigrationRecord', record, `[status]=N'staged',[latestSnapshotId]=N'${held}',[currentStagedRecordId]=N'${revision}',[version]=[version]+1,[updatedAt]='${later}'`)}`,
  );
  await refuse(
    'A staged item reopened',
    set('MigrationRunItem', recordItem, `[outcome]=N'pending'`),
    [51377],
    ITEM_KEEPS,
  );
  await refuse(
    'An item moved to another position',
    set('MigrationRunItem', recordItem, `[position]=99`),
    [51377],
    ITEM_KEEPS,
  );
  await refuse(
    "A record's current revision from another record",
    set(
      'MigrationRecord',
      twin,
      `[currentStagedRecordId]=N'${revision}',[version]=[version]+1`,
    ),
    [547],
    'MigrationRecord_currentStagedRecordId_fkey',
  );

  // ---- errors: access is never retried, resolutions move forward ---------------------------
  const failure = randomUUID();
  const denied = randomUUID();
  const errorRow = (
    id: string,
    classification: string,
    eligible: number,
    extra: Readonly<Record<string, string>> = {},
  ): string => {
    const columns: Record<string, string> = {
      id: `N'${id}'`,
      sourceId: `N'${fixture}'`,
      runId: `N'${firstRun}'`,
      recordId: `N'${vanished}'`,
      stage: `N'fetch'`,
      classification: `N'${classification}'`,
      retryEligible: String(eligible),
      httpStatus: classification === 'access-denied' ? '403' : '503',
      attempt: '1',
      occurredAt: `'${at}'`,
      ...extra,
    };
    return `INSERT INTO [dbo].[MigrationError] (${Object.keys(columns)
      .map((name) => `[${name}]`)
      .join(',')}) VALUES (${Object.values(columns).join(',')});`;
  };
  for (const [label, statement] of [
    [
      'An access-denied error marked retry-eligible',
      errorRow(randomUUID(), 'access-denied', 1),
    ],
    [
      'A retry requested of an error that is not retry-eligible',
      errorRow(randomUUID(), 'not-found', 0, {
        resolution: `N'retry-requested'`,
        resolvedByUserId: `N'${operator}'`,
        resolvedAt: `'${later}'`,
      }),
    ],
    ['An error at attempt zero', errorRow(randomUUID(), 'network', 1, { attempt: '0' })],
    ['An error of an unknown class', errorRow(randomUUID(), 'teapot', 0)],
  ] as const)
    await refuse(label, statement, [547], 'MigrationError_ck');
  await refuse(
    "An error in another source's run",
    errorRow(randomUUID(), 'network', 1, { runId: `N'${otherRun}'` }),
    [547],
    'MigrationError_runId_fkey',
  );
  await accept(
    'A retryable server error and a final access refusal',
    `${errorRow(failure, 'server-error', 1)} ${errorRow(denied, 'access-denied', 0)}`,
  );
  await refuse(
    'An access refusal retried',
    set(
      'MigrationError',
      denied,
      `[resolution]=N'retry-requested',[resolvedByUserId]=N'${operator}',[resolvedAt]='${later}',[version]=[version]+1`,
    ),
    [547],
    'MigrationError_ck',
  );
  for (const [label, assignments] of [
    ['An error re-classified', `[classification]=N'network'`],
    ['An error re-described', `[detail]=N'NON_MIGRATION_FIXTURE forged'`],
  ] as const)
    await refuse(
      label,
      set('MigrationError', failure, `${assignments},[version]=[version]+1`),
      [51383],
      ERROR_KEEPS,
    );
  await accept(
    'A retry requested and resolved; an access refusal dismissed; an item errored and retried',
    `${set('MigrationError', failure, `[resolution]=N'retry-requested',[resolvedByUserId]=N'${operator}',[resolvedAt]='${later}',[version]=[version]+1`)}
     ${set('MigrationError', failure, `[resolution]=N'resolved',[resolvedAt]='${settled}',[version]=[version]+1`)}
     ${set('MigrationError', denied, `[resolution]=N'dismissed',[resolvedByUserId]=N'${operator}',[resolvedAt]='${later}',[version]=[version]+1`)}
     ${set('MigrationRunItem', vanishedItem, `[outcome]=N'errored',[attempts]=1,[errorId]=N'${failure}'`)}
     ${set('MigrationRunItem', vanishedItem, `[outcome]=N'pending',[nextAttemptAt]='${later}'`)}
     ${set('MigrationRunItem', vanishedItem, `[outcome]=N'excluded',[nextAttemptAt]=NULL`)}`,
  );
  await refuse(
    'A resolved error reopened',
    set(
      'MigrationError',
      failure,
      `[resolution]=N'open',[resolvedByUserId]=NULL,[resolvedAt]=NULL,[version]=[version]+1`,
    ),
    [51383],
    ERROR_KEEPS,
  );

  // ---- absence is an observation: a vanished record is classified, never deleted ----------
  await accept(
    'A vanished record marked missing and classified',
    set(
      'MigrationRecord',
      vanished,
      `[observed]=N'missing',[disappearance]=N'withdrawn',[disappearanceNote]=N'NON_MIGRATION_FIXTURE note',[classifiedByUserId]=N'${operator}',[classifiedAt]='${later}',[version]=[version]+1`,
    ),
  );

  // ---- duplicates: only a provider identity collapses; a cross-language pair never merges --
  const collapsed = randomUUID();
  const titled = randomUUID();
  const pair = (
    id: string,
    left: string,
    right: string,
    signal: string,
    crossLanguage: number,
    state: string,
    decided = false,
  ): string =>
    `INSERT INTO [dbo].[MigrationDuplicateCandidate] ([id],[recordId],[otherRecordId],[signal],[score],[crossLanguage],[state],[decidedByUserId],[decidedAt],[createdAt]) VALUES (N'${id}',N'${left}',N'${right}',N'${signal}',90,${String(crossLanguage)},N'${state}',${decided ? `N'${operator}','${later}'` : 'NULL,NULL'},'${at}');`;
  for (const [label, statement] of [
    [
      'A record paired with itself',
      pair(randomUUID(), record, record, 'identifier', 0, 'open'),
    ],
    [
      'A title-similarity pair collapsed automatically',
      pair(randomUUID(), twin, record, 'title-similarity', 0, 'collapsed'),
    ],
    [
      'A cross-language pair merged',
      pair(randomUUID(), urdu, record, 'identifier', 1, 'merged', true),
    ],
    [
      'A merge decided by nobody',
      pair(randomUUID(), urdu, twin, 'identifier', 0, 'merged'),
    ],
    [
      'A score above one hundred',
      `INSERT INTO [dbo].[MigrationDuplicateCandidate] ([id],[recordId],[otherRecordId],[signal],[score],[crossLanguage],[state],[createdAt]) VALUES (N'${randomUUID()}',N'${twin}',N'${urdu}',N'title-similarity',101,0,N'open','${at}');`,
    ],
  ] as const)
    await refuse(label, statement, [547], 'MigrationDuplicateCandidate_ck');
  await accept(
    'The same provider video collapsed; a cross-language title match left open',
    `${pair(collapsed, twin, record, 'provider-id', 0, 'collapsed')}
     ${pair(titled, urdu, record, 'title-similarity', 1, 'open')}`,
  );
  await refuse(
    'One pair recorded twice',
    pair(randomUUID(), twin, record, 'provider-id', 0, 'collapsed'),
    [2627, 2601],
    'MigrationDuplicateCandidate_pair_key',
  );
  await refuse(
    'A cross-language pair merged by decision',
    set(
      'MigrationDuplicateCandidate',
      titled,
      `[state]=N'merged',[decidedByUserId]=N'${operator}',[decidedAt]='${later}',[version]=[version]+1`,
    ),
    [547],
    'MigrationDuplicateCandidate_ck',
  );
  for (const [label, assignments] of [
    ['A pair re-labelled single-language', `[crossLanguage]=0`],
    ['A pair re-signalled', `[signal]=N'identifier'`],
    ['A pair re-scored', `[score]=10`],
  ] as const)
    await refuse(
      label,
      set('MigrationDuplicateCandidate', titled, `${assignments},[version]=[version]+1`),
      [51383],
      PAIR_KEEPS,
    );
  await accept(
    'A cross-language pair decided distinct',
    set(
      'MigrationDuplicateCandidate',
      titled,
      `[state]=N'distinct',[decidedByUserId]=N'${operator}',[decidedAt]='${later}',[note]=N'NON_MIGRATION_FIXTURE note',[version]=[version]+1`,
    ),
  );

  // ---- asset provenance: one stored Asset, two acquisitions, two licences --------------------
  const owned = randomUUID();
  const borrowed = randomUUID();
  const acquisition = (
    id: string,
    recordId: string,
    url: string,
    licence: string,
    extra: Readonly<Record<string, string>> = {},
  ): string => {
    const columns: Record<string, string> = {
      id: `N'${id}'`,
      sourceId: `N'${fixture}'`,
      recordId: `N'${recordId}'`,
      runId: `N'${firstRun}'`,
      originalUrl: `N'${url}'`,
      originalUrlDigest: `'${sha(url)}'`,
      assetId: `N'${asset}'`,
      checksum: `'${sha(assetBytes)}'`,
      byteSize: String(assetBytes.byteLength),
      mediaType: `N'image/png'`,
      licence: `N'${licence}'`,
      acquiredAt: `'${at}'`,
      ...extra,
    };
    return `INSERT INTO [dbo].[MigrationAssetProvenance] (${Object.keys(columns)
      .map((name) => `[${name}]`)
      .join(',')}) VALUES (${Object.values(columns).join(',')});`;
  };
  const firstUrl = `https://media-${run}.fixture.invalid/a.png`;
  const secondUrl = `https://media-${run}.fixture.invalid/copy/a.png`;
  for (const [label, licence, extra] of [
    [
      'Unknown rights made public-eligible',
      'unknown',
      {
        visibility: `N'public-eligible'`,
        decidedByUserId: `N'${operator}'`,
        decidedAt: `'${later}'`,
      },
    ],
    [
      'Owned material made public-eligible by nobody',
      'organisation-owned',
      { visibility: `N'public-eligible'` },
    ],
    [
      'A decision with no instant',
      'organisation-owned',
      { decidedByUserId: `N'${operator}'` },
    ],
  ] as const)
    await refuse(
      label,
      acquisition(
        randomUUID(),
        record,
        `https://media-${run}.fixture.invalid/${randomUUID()}`,
        licence,
        extra,
      ),
      [547],
      'MigrationAssetProvenance_ck',
    );
  await refuse(
    'An unknown licence vocabulary',
    acquisition(
      randomUUID(),
      record,
      `https://media-${run}.fixture.invalid/${randomUUID()}`,
      'stolen',
    ),
    [547],
    'MigrationAssetProvenance_ck',
  );
  await refuse(
    "An acquisition for another source's record",
    acquisition(
      randomUUID(),
      foreign,
      `https://media-${run}.fixture.invalid/${randomUUID()}`,
      'unknown',
    ),
    [547],
    'MigrationAssetProvenance_recordId_fkey',
  );
  await accept(
    'One stored Asset acquired twice under two licences',
    `${acquisition(owned, record, firstUrl, 'organisation-owned')}
     ${acquisition(borrowed, twin, secondUrl, 'third-party', { rightsHolder: `N'NON_MIGRATION_FIXTURE rights holder'` })}`,
  );
  await refuse(
    'One acquisition recorded twice',
    acquisition(randomUUID(), record, firstUrl, 'organisation-owned'),
    [2627, 2601],
    'MigrationAssetProvenance_acquisition_key',
  );
  await refuse(
    'Third-party material made public-eligible',
    set(
      'MigrationAssetProvenance',
      borrowed,
      `[visibility]=N'public-eligible',[decidedByUserId]=N'${operator}',[decidedAt]='${later}',[version]=[version]+1`,
    ),
    [547],
    'MigrationAssetProvenance_ck',
  );
  for (const [label, assignments] of [
    ['An acquisition re-checksummed', `[checksum]=REPLICATE('0',64)`],
    ['An acquisition re-addressed', `[originalUrl]=N'${secondUrl}'`],
    ['An acquisition re-dated', `[acquiredAt]='${later}'`],
  ] as const)
    await refuse(
      label,
      set('MigrationAssetProvenance', owned, `${assignments},[version]=[version]+1`),
      [51382],
      ACQUISITION_KEEPS,
    );
  await accept(
    'Owned material cleared for release by a person',
    set(
      'MigrationAssetProvenance',
      owned,
      `[visibility]=N'public-eligible',[decidedByUserId]=N'${operator}',[decidedAt]='${later}',[version]=[version]+1`,
    ),
  );
  await refuse(
    'An Asset deleted from under its acquisitions',
    `DELETE FROM [dbo].[Asset] WHERE [id]=N'${asset}';`,
    [547],
    'MigrationAssetProvenance_assetId_fkey',
  );

  // ---- topic mappings and categories ------------------------------------------------------------
  const lectures = randomUUID();
  const misc = randomUUID();
  const mapping = (
    id: string,
    key: string,
    extra: Readonly<Record<string, string>> = {},
  ): string => {
    const columns: Record<string, string> = {
      id: `N'${id}'`,
      sourceId: `N'${fixture}'`,
      categoryKey: `N'${key}'`,
      label: `N'NON_MIGRATION_FIXTURE ${key}'`,
      ...extra,
    };
    return `INSERT INTO [dbo].[MigrationTopicMapping] (${Object.keys(columns)
      .map((name) => `[${name}]`)
      .join(',')}) VALUES (${Object.values(columns).join(',')});`;
  };
  for (const [label, extra] of [
    [
      'A confirmed mapping naming no Topic',
      {
        state: `N'confirmed'`,
        decidedByUserId: `N'${operator}'`,
        decidedAt: `'${later}'`,
      },
    ],
    [
      'A confirmed mapping decided by nobody',
      { state: `N'confirmed'`, topicId: `N'${topic}'` },
    ],
    ['A mapping in an unknown state', { state: `N'maybe'` }],
  ] as const)
    await refuse(
      label,
      mapping(randomUUID(), `bad-${randomUUID()}`, extra),
      [547],
      'MigrationTopicMapping_ck',
    );
  await accept(
    'Two legacy categories, unmapped',
    `${mapping(lectures, `lectures-${run}`)} ${mapping(misc, `misc-${run}`)}`,
  );
  await refuse(
    'One category mapped twice',
    mapping(randomUUID(), `lectures-${run}`),
    [2627, 2601],
    'MigrationTopicMapping_source_category_key',
  );
  await refuse(
    'A mapping re-keyed',
    set(
      'MigrationTopicMapping',
      lectures,
      `[categoryKey]=N'rekeyed-${run}',[version]=[version]+1`,
    ),
    [51384],
    TOPIC_KEEPS,
  );
  await refuse(
    'A mapping relabelled without a version',
    set('MigrationTopicMapping', lectures, `[label]=N'NON_MIGRATION_FIXTURE relabelled'`),
    [51384],
    TOPIC_KEEPS,
  );
  await accept(
    "One category confirmed onto Taxonomy's Topic, one excluded; a revision categorised",
    `${set('MigrationTopicMapping', lectures, `[state]=N'confirmed',[topicId]=N'${topic}',[decidedByUserId]=N'${operator}',[decidedAt]='${later}',[version]=[version]+1`)}
     ${set('MigrationTopicMapping', misc, `[state]=N'excluded',[decidedByUserId]=N'${operator}',[decidedAt]='${later}',[version]=[version]+1`)}
     INSERT INTO [dbo].[MigrationStagedCategory] ([stagedRecordId],[topicMappingId]) VALUES (N'${revision}',N'${lectures}');`,
  );
  await refuse(
    'A revision categorised twice',
    `INSERT INTO [dbo].[MigrationStagedCategory] ([stagedRecordId],[topicMappingId]) VALUES (N'${revision}',N'${lectures}');`,
    [2627, 2601],
    'MigrationStagedCategory_pkey',
  );
  const foreignMapping = randomUUID();
  await accept(
    "The other source's own category",
    `INSERT INTO [dbo].[MigrationTopicMapping] ([id],[sourceId],[categoryKey],[label]) VALUES (N'${foreignMapping}',N'${other}',N'lectures-${run}',N'NON_MIGRATION_FIXTURE other lectures');`,
  );
  await refuse(
    "A revision categorised by another source's mapping",
    `INSERT INTO [dbo].[MigrationStagedCategory] ([stagedRecordId],[topicMappingId]) VALUES (N'${revision}',N'${foreignMapping}');`,
    [51374],
    'A staged category names a topic mapping of its own source',
  );
  await refuse(
    'A category re-pointed',
    `UPDATE [dbo].[MigrationStagedCategory] SET [topicMappingId]=N'${misc}' WHERE [stagedRecordId]=N'${revision}';`,
    [51374],
    'A staged category is never changed or removed',
  );
  await refuse(
    'A category removed',
    `DELETE FROM [dbo].[MigrationStagedCategory] WHERE [stagedRecordId]=N'${revision}';`,
    [51374],
    'A staged category is never changed or removed',
  );

  // ---- manifests: draft first, published only under live authority ----------------------------
  const manifest = randomUUID();
  const contested = randomUUID();
  const reversible = randomUUID();
  const fourth = randomUUID();
  const manifestRow = (
    id: string,
    extra: Readonly<Record<string, string>> = {},
  ): string => {
    const columns: Record<string, string> = {
      id: `N'${id}'`,
      sourceId: `N'${fixture}'`,
      runId: `N'${firstRun}'`,
      state: `N'draft'`,
      createdByUserId: `N'${operator}'`,
      createdAt: `'${at}'`,
      ...extra,
    };
    return `INSERT INTO [dbo].[MigrationPublishManifest] (${Object.keys(columns)
      .map((name) => `[${name}]`)
      .join(',')}) VALUES (${Object.values(columns).join(',')});`;
  };
  const entryRow = (
    id: string,
    manifestId: string,
    position: number,
    stagedId: string,
    recordId: string,
    extra: Readonly<Record<string, string>> = {},
  ): string => {
    const columns: Record<string, string> = {
      id: `N'${id}'`,
      manifestId: `N'${manifestId}'`,
      position: String(position),
      stagedRecordId: `N'${stagedId}'`,
      recordId: `N'${recordId}'`,
      ...extra,
    };
    return `INSERT INTO [dbo].[MigrationManifestEntry] (${Object.keys(columns)
      .map((name) => `[${name}]`)
      .join(',')}) VALUES (${Object.values(columns).join(',')});`;
  };
  const publishBy = (id: string, actor: string): string =>
    set(
      'MigrationPublishManifest',
      id,
      `[state]=N'publishing',[publishedByUserId]=N'${actor}',[publishStartedAt]='${later}',[version]=[version]+1`,
    );
  await refuse(
    'A manifest inserted publishing',
    manifestRow(randomUUID(), {
      state: `N'publishing'`,
      publishedByUserId: `N'${publisher}'`,
      publishStartedAt: `'${later}'`,
    }),
    [51378],
    MANIFEST_FRESH,
  );
  await refuse(
    'A manifest inserted at version two',
    manifestRow(randomUUID(), { version: '2' }),
    [51378],
    MANIFEST_FRESH,
  );
  for (const [label, extra] of [
    ['A draft naming its publisher', { publishedByUserId: `N'${publisher}'` }],
    ['A manifest in an unknown state', { state: `N'live'` }],
  ] as const)
    await refuse(
      label,
      manifestRow(randomUUID(), extra),
      [547],
      'MigrationPublishManifest_ck',
    );
  await refuse(
    "A manifest of another source's run",
    manifestRow(randomUUID(), { runId: `N'${otherRun}'` }),
    [547],
    'MigrationPublishManifest_runId_fkey',
  );
  await accept(
    'Four draft manifests',
    `${manifestRow(manifest)} ${manifestRow(contested)} ${manifestRow(reversible)} ${manifestRow(fourth)}`,
  );

  // ---- entries: approved revisions of the manifest's own source, added to a draft ----------
  const published = randomUUID();
  const republished = randomUUID();
  const refused = randomUUID();
  const rival = randomUUID();
  const reversed = randomUUID();
  await refuse(
    'An entry for a pending revision',
    entryRow(randomUUID(), manifest, 9, vanishedRevision, vanished),
    [51379],
    ENTRY_JOINS,
  );
  await refuse(
    "An entry for another source's approved revision",
    entryRow(randomUUID(), manifest, 9, foreignRevision, foreign),
    [51379],
    ENTRY_JOINS,
  );
  await refuse(
    'An entry inserted publishing',
    entryRow(randomUUID(), manifest, 9, revision, record, { state: `N'publishing'` }),
    [51379],
    ENTRY_JOINS,
  );
  await refuse(
    'An entry pairing a revision with another record',
    entryRow(randomUUID(), manifest, 9, revision, twin),
    [547],
    'MigrationManifestEntry_stagedRecordId_fkey',
  );
  await refuse(
    'A pending entry carrying a refusal',
    entryRow(randomUUID(), manifest, 9, revision, record, {
      refusal: `N'target-refused'`,
    }),
    [547],
    'MigrationManifestEntry_ck',
  );
  await accept(
    'Approved revisions entered in drafts',
    `${entryRow(published, manifest, 0, revision, record)}
     ${entryRow(refused, manifest, 1, twinRevision, twin)}
     ${entryRow(rival, contested, 0, revision, record)}
     ${entryRow(reversed, reversible, 0, urduRevision, urdu)}
     ${entryRow(republished, fourth, 0, twinRevision, twin)}`,
  );
  await refuse(
    'One revision entered twice in one manifest',
    entryRow(randomUUID(), manifest, 9, revision, record),
    [2627, 2601],
    'MigrationManifestEntry_manifest_staged_key',
  );
  await refuse(
    'Two entries at one position',
    entryRow(randomUUID(), manifest, 0, urduRevision, urdu),
    [2627, 2601],
    'MigrationManifestEntry_manifest_position_key',
  );
  await refuse(
    'An entry published while its manifest is a draft',
    set(
      'MigrationManifestEntry',
      published,
      `[state]=N'publishing',[version]=[version]+1`,
    ),
    [51379],
    ENTRY_MOVES,
  );

  // ---- publication authority: every missing piece refused ------------------------------------
  for (const [label, actor] of [
    ['Published by an operator holding no key', operator],
    ['Published by a holder with no step-up', keyOnly],
    ['Published with a step-up but no key', grantOnly],
    ['Published with another purpose step-up', wrongPurpose],
    ['Published with an expired step-up', expiredGrant],
    ['Published on an expired session', expiredSession],
    ['Published by a revoked holder', revoked],
    ['Published through a deactivated role', deactivated],
    ['Published by a suspended holder', suspended],
  ] as const)
    await refuse(label, publishBy(manifest, actor), [51378], PUBLICATION);
  await refuse(
    'A draft published without passing through publishing',
    set(
      'MigrationPublishManifest',
      manifest,
      `[state]=N'published',[publishedByUserId]=N'${publisher}',[publishStartedAt]='${later}',[publishedAt]='${later}',[version]=[version]+1`,
    ),
    [51378],
    MANIFEST_KEEPS,
  );
  await accept(
    'Published by a live migration.publish holder with a live migration-publication step-up',
    `${publishBy(manifest, publisher)} ${publishBy(contested, publisher)} ${publishBy(reversible, publisher)} ${publishBy(fourth, publisher)}`,
  );
  await refuse(
    'An entry added once publishing began',
    entryRow(randomUUID(), manifest, 9, urduRevision, urdu),
    [51379],
    ENTRY_JOINS,
  );
  await accept(
    'One entry published to its Video, one refused by its target',
    `${set('MigrationManifestEntry', published, `[state]=N'publishing',[version]=[version]+1`)}
     ${set('MigrationManifestEntry', published, `[state]=N'published',[videoId]=N'${video}',[targetVersion]=1,[canonicalPath]=N'/watch/videos/proof-migration-${run}',[publishedAt]='${settled}',[version]=[version]+1`)}
     ${set('MigrationManifestEntry', refused, `[state]=N'refused',[refusal]=N'target-refused',[version]=[version]+1`)}
     ${set('MigrationManifestEntry', republished, `[state]=N'published',[videoId]=N'${video}',[targetVersion]=2,[canonicalPath]=N'/watch/videos/proof-migration-${run}',[publishedAt]='${settled}',[version]=[version]+1`)}
     ${set('MigrationPublishManifest', fourth, `[state]=N'published',[publishedAt]='${settled}',[version]=[version]+1`)}`,
  );
  await refuse(
    'A published entry re-targeted',
    set(
      'MigrationManifestEntry',
      published,
      `[videoId]=N'${otherVideo}',[version]=[version]+1`,
    ),
    [51379],
    ENTRY_MOVES,
  );
  await refuse(
    'A published entry carrying no target',
    set('MigrationManifestEntry', reversed, `[state]=N'published',[version]=[version]+1`),
    [547],
    'MigrationManifestEntry_ck',
  );
  await refuse(
    'One revision live through a second manifest',
    set('MigrationManifestEntry', rival, `[state]=N'publishing',[version]=[version]+1`),
    [2601, 2627],
    'MigrationManifestEntry_live_key',
  );
  await accept(
    'A manifest published',
    set(
      'MigrationPublishManifest',
      manifest,
      `[state]=N'published',[publishedAt]='${settled}',[version]=[version]+1`,
    ),
  );
  await refuse(
    'A published manifest back to publishing',
    set(
      'MigrationPublishManifest',
      manifest,
      `[state]=N'publishing',[publishedAt]=NULL,[version]=[version]+1`,
    ),
    [51378],
    MANIFEST_KEEPS,
  );
  await refuse(
    'A manifest re-attributed',
    set(
      'MigrationPublishManifest',
      manifest,
      `[createdByUserId]=N'${publisher}',[version]=[version]+1`,
    ),
    [51378],
    MANIFEST_KEEPS,
  );

  // ---- rollback: the same live authority, phase by phase --------------------------------------
  await accept(
    'A second manifest published to the other Video',
    `${set('MigrationManifestEntry', reversed, `[state]=N'published',[videoId]=N'${otherVideo}',[targetVersion]=1,[canonicalPath]=N'/watch/videos/proof-migration-other-${run}',[publishedAt]='${settled}',[version]=[version]+1`)}
     ${set('MigrationPublishManifest', reversible, `[state]=N'published',[publishedAt]='${settled}',[version]=[version]+1`)}`,
  );
  const rollbackBy = (actor: string): string =>
    set(
      'MigrationPublishManifest',
      reversible,
      `[state]=N'rolling-back',[rollbackByUserId]=N'${actor}',[rollbackReason]=N'NON_MIGRATION_FIXTURE reason',[rollbackStartedAt]='${settled}',[version]=[version]+1`,
    );
  await refuse(
    'Rolled back by a holder with no step-up',
    rollbackBy(keyOnly),
    [51378],
    PUBLICATION,
  );
  await refuse(
    'Rolled back with a step-up but no key',
    rollbackBy(grantOnly),
    [51378],
    PUBLICATION,
  );
  await refuse(
    'An entry rolled back before its manifest',
    set(
      'MigrationManifestEntry',
      reversed,
      `[state]=N'rolled-back',[rolledBackAt]='${settled}',[version]=[version]+1`,
    ),
    [51379],
    ENTRY_MOVES,
  );
  await accept(
    'Rolled back by a live holder, entry by entry',
    `${rollbackBy(publisher)}
     ${set('MigrationManifestEntry', reversed, `[state]=N'rolled-back',[rolledBackAt]='${settled}',[version]=[version]+1`)}
     ${set('MigrationPublishManifest', reversible, `[state]=N'rolled-back',[rolledBackAt]='${settled}',[version]=[version]+1`)}`,
  );
  await refuse(
    'A rolled-back manifest published again',
    set(
      'MigrationPublishManifest',
      reversible,
      `[state]=N'published',[rollbackByUserId]=NULL,[rollbackReason]=NULL,[rollbackStartedAt]=NULL,[rolledBackAt]=NULL,[version]=[version]+1`,
    ),
    [51378],
    MANIFEST_KEEPS,
  );

  // ---- legacy mappings: one active per legacy URL, address and target fixed ------------------
  const active = randomUUID();
  const retired = randomUUID();
  const legacyUrl = `https://${host}/videos/video-${run}`;
  const legacy = (
    id: string,
    url: string,
    extra: Readonly<Record<string, string>> = {},
  ): string => {
    const columns: Record<string, string> = {
      id: `N'${id}'`,
      sourceId: `N'${fixture}'`,
      recordId: `N'${record}'`,
      legacyUrl: `N'${url}'`,
      legacyUrlDigest: `'${sha(url)}'`,
      videoId: `N'${video}'`,
      canonicalPath: `N'/watch/videos/proof-migration-${run}'`,
      state: `N'active'`,
      manifestEntryId: `N'${published}'`,
      createdAt: `'${settled}'`,
      createdByUserId: `N'${operator}'`,
      ...extra,
    };
    return `INSERT INTO [dbo].[MigrationLegacyMapping] (${Object.keys(columns)
      .map((name) => `[${name}]`)
      .join(',')}) VALUES (${Object.values(columns).join(',')});`;
  };
  for (const [label, extra] of [
    ['A mapping naming no target', { videoId: 'NULL' }],
    ['A mapping to another site', { canonicalPath: `N'//evil.example/watch'` }],
    [
      'A mapping to an absolute address',
      { canonicalPath: `N'https://example.org/watch'` },
    ],
    ['A disabled mapping with no change trail', { state: `N'disabled'` }],
  ] as const)
    await refuse(
      label,
      legacy(randomUUID(), `${legacyUrl}/${randomUUID()}`, extra),
      [547],
      'MigrationLegacyMapping_ck',
    );
  await refuse(
    "A mapping for another source's record",
    legacy(randomUUID(), `${legacyUrl}/${randomUUID()}`, { recordId: `N'${foreign}'` }),
    [547],
    'MigrationLegacyMapping_recordId_fkey',
  );
  await accept(
    'An active mapping, and a second address retired',
    `${legacy(active, legacyUrl)}
     ${legacy(retired, `https://${host}/old/${run}`)}
     ${set('MigrationLegacyMapping', retired, `[state]=N'disabled',[changedAt]='${settled}',[changedByUserId]=N'${operator}',[version]=[version]+1`)}`,
  );
  await refuse(
    'A second active mapping for one legacy URL',
    legacy(randomUUID(), legacyUrl),
    [2601, 2627],
    'MigrationLegacyMapping_active_key',
  );
  await accept(
    'A disabled mapping kept beside the active one as history',
    legacy(randomUUID(), legacyUrl, {
      state: `N'disabled'`,
      changedAt: `'${settled}'`,
      changedByUserId: `N'${operator}'`,
    }),
  );
  for (const [label, assignments] of [
    ['A mapping re-targeted', `[videoId]=N'${otherVideo}'`],
    ['A mapping re-addressed', `[legacyUrl]=N'https://${host}/forged'`],
    ['A mapping re-pathed', `[canonicalPath]=N'/watch/videos/forged'`],
    ['A mapping re-attributed', `[createdByUserId]=N'${publisher}'`],
  ] as const)
    await refuse(
      label,
      set('MigrationLegacyMapping', active, `${assignments},[version]=[version]+1`),
      [51380],
      LEGACY_KEEPS,
    );
  await refuse(
    'A mapping naming an entry of an unrelated record',
    legacy(randomUUID(), `https://${host}/videos/twin-${run}`, {
      recordId: `N'${twin}'`,
    }),
    [51380],
    "A legacy mapping names its entry's record",
  );
  await accept(
    'A record merged into the published one, mapped through its entry',
    `${set('MigrationRecord', spare, `[status]=N'merged',[mergedIntoRecordId]=N'${record}',[version]=[version]+1`)}
     ${legacy(randomUUID(), `https://${host}/videos/spare-${run}`, { recordId: `N'${spare}'` })}`,
  );
  await refuse(
    'A mapping disabled without a version',
    set(
      'MigrationLegacyMapping',
      active,
      `[state]=N'disabled',[changedAt]='${settled}',[changedByUserId]=N'${operator}'`,
    ),
    [51380],
    LEGACY_KEEPS,
  );

  // ---- links: rewritten only through a mapping, to a site-relative address ------------------
  const link = (position: number, extra: Readonly<Record<string, string>>): string => {
    const columns: Record<string, string> = {
      stagedRecordId: `N'${revision}'`,
      position: String(position),
      href: `N'https://${host}/videos/video-${run}'`,
      ...extra,
    };
    return `INSERT INTO [dbo].[MigrationStagedLink] (${Object.keys(columns)
      .map((name) => `[${name}]`)
      .join(',')}) VALUES (${Object.values(columns).join(',')});`;
  };
  for (const [label, extra] of [
    [
      'A rewritten link naming no mapping',
      { disposition: `N'rewritten'`, rewrittenTo: `N'/watch/videos/proof'` },
    ],
    [
      'An unresolved link with a rewrite',
      { disposition: `N'unresolved'`, rewrittenTo: `N'/watch/videos/proof'` },
    ],
    [
      'A link rewritten to an absolute address',
      {
        disposition: `N'rewritten'`,
        rewrittenTo: `N'https://example.org/'`,
        legacyMappingId: `N'${active}'`,
      },
    ],
    ['A link kept verbatim', { disposition: `N'kept'` }],
  ] as const)
    await refuse(label, link(9, extra), [547], 'MigrationStagedLink_ck');
  await accept(
    'Links rewritten through a mapping, external, unresolved and dropped',
    `${link(0, { disposition: `N'rewritten'`, rewrittenTo: `N'/watch/videos/proof-migration-${run}'`, legacyMappingId: `N'${active}'` })}
     ${link(1, { disposition: `N'external'`, href: `N'https://elsewhere.fixture.invalid/x'` })}
     ${link(2, { disposition: `N'unresolved'`, href: `N'/legacy/unknown'` })}
     ${link(3, { disposition: `N'dropped'`, href: `N'javascript:void(0)'` })}`,
  );
  const foreignLegacy = randomUUID();
  await accept(
    "The other source's own legacy mapping",
    legacy(foreignLegacy, `https://other-${run}.fixture.invalid/videos/${run}`, {
      sourceId: `N'${other}'`,
      recordId: `N'${foreign}'`,
      manifestEntryId: 'NULL',
    }),
  );
  await refuse(
    "A link rewritten through another source's mapping",
    link(9, {
      disposition: `N'rewritten'`,
      rewrittenTo: `N'/watch/videos/proof-migration-${run}'`,
      legacyMappingId: `N'${foreignLegacy}'`,
    }),
    [51380],
    'A staged link is rewritten only by a legacy mapping of its own source',
  );
  await refuse(
    'A link re-pointed',
    `UPDATE [dbo].[MigrationStagedLink] SET [href]=N'/legacy/forged' WHERE [stagedRecordId]=N'${revision}' AND [position]=2;`,
    [51380],
    'A staged link is never changed or removed',
  );
  await refuse(
    'A link removed',
    `DELETE FROM [dbo].[MigrationStagedLink] WHERE [stagedRecordId]=N'${revision}' AND [position]=3;`,
    [51380],
    'A staged link is never changed or removed',
  );

  // ---- promotions: draft first, approved only under live authority, published entries only --
  const promotion = randomUUID();
  const abandoned = randomUUID();
  const promoted = randomUUID();
  const promotionRow = (
    id: string,
    extra: Readonly<Record<string, string>> = {},
  ): string => {
    const columns: Record<string, string> = {
      id: `N'${id}'`,
      state: `N'draft'`,
      destination: `N'bundle'`,
      createdByUserId: `N'${operator}'`,
      createdAt: `'${at}'`,
      ...extra,
    };
    return `INSERT INTO [dbo].[MigrationPromotion] (${Object.keys(columns)
      .map((name) => `[${name}]`)
      .join(',')}) VALUES (${Object.values(columns).join(',')});`;
  };
  const promotionEntry = (
    id: string,
    promotionId: string,
    position: number,
    entryId: string,
  ): string =>
    `INSERT INTO [dbo].[MigrationPromotionEntry] ([id],[promotionId],[position],[manifestEntryId]) VALUES (N'${id}',N'${promotionId}',${String(position)},N'${entryId}');`;
  const approveBy = (actor: string): string =>
    set(
      'MigrationPromotion',
      promotion,
      `[state]=N'approved',[approvedByUserId]=N'${actor}',[approvedAt]='${settled}',[version]=[version]+1`,
    );
  await refuse(
    'A promotion inserted approved',
    promotionRow(randomUUID(), {
      state: `N'approved'`,
      approvedByUserId: `N'${publisher}'`,
      approvedAt: `'${settled}'`,
    }),
    [51381],
    PROMOTION_FRESH,
  );
  await refuse(
    'A promotion to a remote destination',
    promotionRow(randomUUID(), { destination: `N'remote'` }),
    [547],
    'MigrationPromotion_ck',
  );
  await accept(
    'Two draft promotions',
    `${promotionRow(promotion)} ${promotionRow(abandoned)}`,
  );
  await refuse(
    'A promotion carrying a refused entry',
    promotionEntry(randomUUID(), promotion, 9, refused),
    [51381],
    PROMOTION_CARRIES,
  );
  await refuse(
    'A promotion carrying a rolled-back entry',
    promotionEntry(randomUUID(), promotion, 9, reversed),
    [51381],
    PROMOTION_CARRIES,
  );
  await accept(
    'A promotion carrying a published entry',
    promotionEntry(promoted, promotion, 0, published),
  );
  for (const [label, actor] of [
    ['Approved by an operator holding no key', operator],
    ['Approved by a holder with no step-up', keyOnly],
    ['Approved with a step-up but no key', grantOnly],
    ['Approved with an expired step-up', expiredGrant],
    ['Approved through a deactivated role', deactivated],
  ] as const)
    await refuse(label, approveBy(actor), [51381], APPROVAL);
  await refuse(
    'A draft promoted without approval',
    set(
      'MigrationPromotion',
      promotion,
      `[state]=N'promoting',[approvedByUserId]=N'${publisher}',[approvedAt]='${settled}',[version]=[version]+1`,
    ),
    [51381],
    PROMOTION_KEEPS,
  );
  await accept('Approved by a live holder', approveBy(publisher));
  await refuse(
    'An entry added after approval',
    promotionEntry(randomUUID(), promotion, 1, republished),
    [51381],
    PROMOTION_CARRIES,
  );
  const promote = set(
    'MigrationPromotionEntry',
    promoted,
    `[state]=N'promoted',[promotedAt]='${settled}',[destinationRef]=N'bundle/${promoted}.json'`,
  );
  await refuse(
    'An entry promoted before promoting began',
    promote,
    [51381],
    PROMOTED_ONCE,
  );
  await accept(
    'Promoted entry by entry and completed',
    `${set('MigrationPromotion', promotion, `[state]=N'promoting',[version]=[version]+1`)}
     ${promote}
     ${set('MigrationPromotion', promotion, `[state]=N'promoted',[completedAt]='${settled}',[version]=[version]+1`)}`,
  );
  await refuse(
    'A promoted entry promoted again',
    set('MigrationPromotionEntry', promoted, `[destinationRef]=N'bundle/forged.json'`),
    [51381],
    PROMOTED_ONCE,
  );
  await refuse(
    'A completed promotion withdrawn',
    set(
      'MigrationPromotion',
      promotion,
      `[state]=N'withdrawn',[withdrawnByUserId]=N'${operator}',[withdrawnAt]='${settled}',[completedAt]=NULL,[version]=[version]+1`,
    ),
    [51381],
    PROMOTION_KEEPS,
  );
  await accept(
    'A draft promotion withdrawn',
    set(
      'MigrationPromotion',
      abandoned,
      `[state]=N'withdrawn',[withdrawnByUserId]=N'${operator}',[withdrawnAt]='${settled}',[version]=[version]+1`,
    ),
  );
  await refuse(
    'A withdrawn promotion approved',
    set(
      'MigrationPromotion',
      abandoned,
      `[state]=N'approved',[approvedByUserId]=N'${publisher}',[approvedAt]='${settled}',[withdrawnByUserId]=NULL,[withdrawnAt]=NULL,[version]=[version]+1`,
    ),
    [51381],
    PROMOTION_KEEPS,
  );

  // ---- the run completes, balanced, and is then frozen; the source may run again ------------
  await accept(
    'The run completed and reconciled in one step',
    set(
      'MigrationRun',
      firstRun,
      `[state]=N'completed',[endedAt]='${settled}',[leaseToken]=NULL,[leaseExpiresAt]=NULL,[reconciliation]=N'balanced',[reconciledAt]='${settled}',[reconciliationDetail]=N'{"balanced":true}',[version]=[version]+1`,
    ),
  );
  await refuse(
    'A finished run re-cursored',
    set('MigrationRun', firstRun, `[discoveryCursor]=N'page-3',[version]=[version]+1`),
    [51375],
    RUN_KEEPS,
  );
  await refuse(
    'A finished run reopened',
    set(
      'MigrationRun',
      firstRun,
      `[state]=N'open',[endedAt]=NULL,[reconciliation]=N'pending',[reconciledAt]=NULL,[version]=[version]+1`,
    ),
    [51375],
    RUN_KEEPS,
  );
  await accept(
    'A second run of the source once the first has ended',
    runRow(randomUUID(), fixture),
  );

  // ---- every row is still a sentinel, every address .invalid --------------------------------
  const [labelled] = await session.query<Record<string, number>>(`
    SELECT
      (SELECT COUNT(*) FROM [dbo].[MigrationSource] WHERE [id] IN (N'${fixture}',N'${other}',N'${exported}')
         AND ([name] NOT LIKE N'NON[_]MIGRATION[_]FIXTURE%' OR [authorityKind] <> N'fixture'
              OR ([baseUrl] IS NOT NULL AND [baseUrl] NOT LIKE N'https://%.fixture.invalid/'))) AS [sources],
      (SELECT COUNT(*) FROM [dbo].[MigrationSourceHost] WHERE [sourceId] IN (N'${fixture}',N'${other}')
         AND [host] NOT LIKE N'%.fixture.invalid') AS [hosts],
      (SELECT COUNT(*) FROM [dbo].[MigrationRawSnapshot] WHERE [sourceId] IN (N'${fixture}',N'${other}')
         AND [requestedUrl] NOT LIKE N'https://%.fixture.invalid/%') AS [snapshots];
  `);
  if (JSON.stringify(labelled) !== '{"sources":0,"hosts":0,"snapshots":0}')
    fail(
      `The Migration rule proofs wrote a row that is not an unmistakable fixture: ` +
        `${JSON.stringify(labelled ?? null)}.`,
    );

  report(
    'migration rules',
    `fixture sources fixed as fixtures with *.fixture.invalid hosts, one open run per source ` +
      `frozen once finished, records of their own source, raw bodies bound to their checksums ` +
      `and never rewritten or deleted, revisions from their own snapshot with immutable ` +
      `payloads and forward-only review, items forward-only, access refusals never retried, ` +
      `cross-language pairs never merged, two licences over one Asset, manifests published ` +
      `and rolled back only under live migration.publish with a live migration-publication ` +
      `step-up, one live entry per revision, one active mapping per legacy URL, promotions of ` +
      `published entries only, no cascade; ${String(refusals)} refusals by name, every text a ` +
      `NON_MIGRATION_FIXTURE sentinel, rows kept as evidence until this database is dropped`,
  );
}

/**
 * The Phase-13 rollback restores the two editorial keys' Phase-6 descriptions
 * exactly — Article and Page, and no News family.
 */
async function assertEditorialPermissionsDescribeArticleAndPageOnly(
  session: SqlSession,
): Promise<void> {
  const permissions = await session.query<{ key: string; description: string }>(`
    SELECT [key], [description] FROM [dbo].[Permission]
    WHERE [key] IN (N'content.read', N'content.author') ORDER BY [key];
  `);
  if (
    permissions.length !== 2 ||
    permissions.some((row) => row.description.includes('news')) ||
    !permissions.every((row) => row.description.includes('Article and Page'))
  )
    fail(
      `The Phase-13 rollback did not restore the Phase-6 editorial descriptions: ` +
        `${JSON.stringify(permissions)}.`,
    );
  report(
    'editorial descriptions',
    'Phase-6 wording restored after the Phase-13 rollback',
  );
}

/**
 * The Phase-12 rollback restores the two Media keys' Phase-11 descriptions
 * exactly — audio, and no photographs.
 */
async function assertMediaPermissionsDescribeAudioOnly(
  session: SqlSession,
): Promise<void> {
  const permissions = await session.query<{ key: string; description: string }>(`
    SELECT [key], [description] FROM [dbo].[Permission]
    WHERE [key] LIKE N'media.%' ORDER BY [key];
  `);
  if (
    permissions.map((row) => row.key).join(',') !== MEDIA_PERMISSIONS.join(',') ||
    permissions.some((row) => row.description.includes('photograph')) ||
    !permissions.every((row) => row.description.includes('audio'))
  ) {
    fail(
      `The Phase-12 rollback did not restore the Phase-11 Media descriptions: ` +
        `${JSON.stringify(permissions)}.`,
    );
  }
  report('media descriptions', 'Phase-11 wording restored after the Phase-12 rollback');
}

/**
 * The Phase-11 rollback restores the two Media keys' Phase-10 descriptions
 * exactly, so a rolled-back catalogue never tells an administrator a key covers
 * audio that no longer exists.
 */
async function assertMediaPermissionsDescribeVideoOnly(
  session: SqlSession,
): Promise<void> {
  const permissions = await session.query<{ key: string; description: string }>(`
    SELECT [key], [description] FROM [dbo].[Permission]
    WHERE [key] LIKE N'media.%' ORDER BY [key];
  `);
  if (
    permissions.map((row) => row.key).join(',') !== MEDIA_PERMISSIONS.join(',') ||
    permissions.some((row) => row.description.includes('audio'))
  ) {
    fail(
      `The Phase-11 rollback left Media descriptions naming audio: ` +
        `${JSON.stringify(permissions)}.`,
    );
  }
  report('media descriptions', 'Phase-10 wording restored after the Phase-11 rollback');
}

/**
 * Phase 10 — what only the catalogue can prove about Media:
 *
 *   1. the provider identifier is CASE-SENSITIVE, because YouTube identifiers
 *      are: a binary collation, so two videos whose identifiers differ only in
 *      case are not refused as duplicates of each other;
 *   2. the Media vocabulary is exactly two keys, bundled into the protected
 *      Platform Administrator role by the migration and by nothing else;
 *   3. a Video's Series is ONE nullable column — "at most one Series" is a
 *      property of the schema, not of a check somebody remembered to write.
 */
async function assertMediaFoundation(session: SqlSession): Promise<void> {
  const [column] = await session.query<{
    type: string;
    max_length: number;
    collation: string | null;
  }>(`
    SELECT t.name AS type, c.max_length, c.collation_name AS collation
    FROM sys.columns c JOIN sys.types t ON t.user_type_id = c.user_type_id
    WHERE c.object_id = OBJECT_ID(N'[dbo].[Video]') AND c.name = N'providerVideoId';
  `);
  if (
    column === undefined ||
    column.type !== 'varchar' ||
    column.max_length !== 16 ||
    column.collation !== 'Latin1_General_100_BIN2'
  ) {
    fail(
      `Video.providerVideoId must be VARCHAR(16) under Latin1_General_100_BIN2; ` +
        `found ${JSON.stringify(column ?? null)}.`,
    );
  }

  const permissions = await session.query<{ key: string }>(`
    SELECT [key] FROM [dbo].[Permission] WHERE [key] LIKE N'media.%' ORDER BY [key];
  `);
  const bundled = await session.query<{ permissionKey: string }>(`
    SELECT rp.[permissionKey]
    FROM [dbo].[RolePermission] rp
    INNER JOIN [dbo].[Role] r ON r.[id] = rp.[roleId]
    WHERE r.[key] = N'platform-administrator' AND rp.[permissionKey] LIKE N'media.%'
    ORDER BY rp.[permissionKey];
  `);
  if (
    permissions.map((row) => row.key).join(',') !== MEDIA_PERMISSIONS.join(',') ||
    bundled.map((row) => row.permissionKey).join(',') !== MEDIA_PERMISSIONS.join(',')
  ) {
    fail(
      `Media permissions or their bundling differ; catalogue: ` +
        `${permissions.map((row) => row.key).join(', ') || '(none)'}; bundle: ` +
        `${bundled.map((row) => row.permissionKey).join(', ') || '(none)'}.`,
    );
  }

  const [series] = await session.query<{ columns: number; nullable: number }>(`
    SELECT COUNT(*) AS columns, SUM(CAST(c.is_nullable AS INT)) AS nullable
    FROM sys.columns c
    WHERE c.object_id = OBJECT_ID(N'[dbo].[Video]') AND c.name = N'seriesId';
  `);
  if (Number(series?.columns) !== 1 || Number(series?.nullable) !== 1) {
    fail('A Video must carry exactly one nullable Series reference.');
  }

  report(
    'media foundation',
    'binary provider identifier, two bundled keys, at most one Series per Video',
  );
}

/** After the Phase-17 rollback, no full-text object survives. */
async function assertSearchRemoved(session: SqlSession): Promise<void> {
  const [row] = await session.query<{ catalogs: number; indexes: number }>(`
    SELECT (SELECT COUNT(*) FROM sys.fulltext_catalogs) AS catalogs,
           (SELECT COUNT(*) FROM sys.fulltext_indexes) AS indexes;
  `);
  if (Number(row?.catalogs) !== 0 || Number(row?.indexes) !== 0) {
    fail('A full-text catalogue or index survived the Phase-17 rollback.');
  }
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
async function assertPeopleFoundation(
  session: SqlSession,
  stage: 'current' | 'before-classes' = 'current',
): Promise<void> {
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

  // ---- the teaching capability source: absent until its owner, then ungranted ---
  const teaching = await session.query<{ key: string; held: number }>(`
    SELECT p.[key],
      (SELECT COUNT(*) FROM [dbo].[RolePermission] rp WHERE rp.[permissionKey] = p.[key]) AS [held]
    FROM [dbo].[Permission] p
    WHERE p.[key] IN (${TEACHING_CAPABILITY_PERMISSIONS.map((key) => `N'${key}'`).join(', ')})
    ORDER BY p.[key];
  `);
  if (stage === 'before-classes' && teaching.length > 0) {
    fail(
      `Capability-source permissions were seeded before their owning phase: ` +
        `${teaching.map((row) => row.key).join(', ')}. DOMAIN_MODEL.md §4.5 ` +
        `derives a contributor capability from it, but it belongs to Learning's ` +
        `teaching slice (Phase 23), which is not applied at this stage — and ` +
        `OPEN_DECISIONS.md §6.3 reserves who receives it to the organisation.`,
    );
  }
  if (
    stage === 'current' &&
    (teaching.map((row) => row.key).join(',') !==
      TEACHING_CAPABILITY_PERMISSIONS.join(',') ||
      teaching.some((row) => Number(row.held) !== 0))
  ) {
    fail(
      `With Phase 23 applied, ${TEACHING_CAPABILITY_PERMISSIONS.join(', ')} must be catalogued ` +
        `and held by NO role — a profile alone grants nothing, and OPEN_DECISIONS.md §6.3 ` +
        `reserves who receives it to the organisation; found ${JSON.stringify(teaching)}.`,
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
  await assertSearchFoundation(session);
  await assertSearchVocabulary(session, 'phase22');
  await assertMediaFoundation(session);
  await assertAudioFoundation(session);
  await assertPhotoFoundation(session);
  await assertNewsFoundation(session);
  await assertGlobalFoundation(session);
  await assertEventFoundation(session);
  await assertCollectionFoundation(session);
  await assertQuranFoundation(session);
  await assertHadithFoundation(session);
  await assertFatwaFoundation(session);
  await assertPersonalisationFoundation(session);
  await assertLearningFoundation(session);
  await assertClassesFoundation(session);
  await assertMessagingFoundation(session);
  await assertMembershipFoundation(session);
  await assertDonationsFoundation(session);
  await assertMigrationFoundation(session);
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
    if (migration.id === MIGRATION_PROVENANCE_MIGRATION) {
      // Phase 29 widened no search vocabulary, so none narrows here — and the
      // whole Phase-27 state it was applied on is back: the protected bundle the
      // compiled bundle less the two bundled Migration keys, no Migration &
      // Provenance object and no `migration-publication` grant, and Donations,
      // Membership, Messaging, Learning's two slices, Personalisation and Fatwa
      // whole at `before-migration`, with every owner a Migration row named —
      // Identity's accounts, Taxonomy's Topic, Media's Video and Storage's
      // Asset — untouched by the drop.
      await assertSearchVocabulary(session, 'phase22');
      await assertMigrationRemoved(session);
      await assertDonationsFoundation(session, 'before-migration');
      await assertMembershipFoundation(session, 'before-migration');
      await assertMessagingFoundation(session, 'before-migration');
      await assertClassesFoundation(session, 'before-migration');
      await assertLearningFoundation(session, 'before-migration');
      await assertPersonalisationFoundation(session, 'before-migration');
      await assertFatwaFoundation(session, 'before-migration');
      await assertTaxonomyFoundation(session);
      await assertPeopleFoundation(session);
      await assertMediaFoundation(session);
      await assertAudioFoundation(session);
      await assertPhotoFoundation(session);
    }
    if (migration.id === DONATIONS_MIGRATION) {
      // Phase 27 widened no search vocabulary, so none narrows here — and the
      // whole Phase-26 state it was applied on is back: the protected bundle the
      // compiled bundle less the two bundled Donations keys (and the two bundled
      // Migration keys Phase 29's rollback removed first), no Donations object
      // and no `donation-refund` grant, and Membership, Messaging, Learning's two
      // slices, Personalisation and Fatwa whole at `before-donations`, with
      // Identity's accounts — the only owner a Donations key named — untouched
      // by the drop.
      await assertSearchVocabulary(session, 'phase22');
      await assertDonationsRemoved(session);
      await assertMembershipFoundation(session, 'before-donations');
      await assertMessagingFoundation(session, 'before-donations');
      await assertClassesFoundation(session, 'before-donations');
      await assertLearningFoundation(session, 'before-donations');
      await assertPersonalisationFoundation(session, 'before-donations');
      await assertFatwaFoundation(session, 'before-donations');
      await assertTaxonomyFoundation(session);
      await assertPeopleFoundation(session);
    }
    if (migration.id === MEMBERSHIP_MIGRATION) {
      // Phase 26 widened no search vocabulary, so none narrows here — and the
      // whole Phase-24 state it was applied on is back: the protected bundle the
      // compiled bundle less the two Membership keys, no Membership object, and
      // Messaging, Learning's two slices, Personalisation and Fatwa whole at
      // `before-membership`, with Identity's accounts — the only owner a
      // Membership key named — untouched by the drop.
      await assertSearchVocabulary(session, 'phase22');
      await assertMembershipRemoved(session);
      await assertMessagingFoundation(session, 'before-membership');
      await assertClassesFoundation(session, 'before-membership');
      await assertLearningFoundation(session, 'before-membership');
      await assertPersonalisationFoundation(session, 'before-membership');
      await assertFatwaFoundation(session, 'before-membership');
      await assertTaxonomyFoundation(session);
      await assertPeopleFoundation(session);
    }
    if (migration.id === MESSAGING_MIGRATION) {
      // Phase 24 widened no search vocabulary and changed no bundle, so neither
      // narrows here — and the whole Phase-23 state it was applied on is back:
      // no Messaging object and no Messaging key, Storage's Asset exactly as
      // Phase 7 made it, Learning's two slices whole with nothing of Messaging
      // naming a Course, Personalisation and Fatwa whole, and every owner a
      // Messaging key once named — Identity's accounts, Learning's Course and
      // Storage's Asset with the Media and Quran references into it —
      // untouched by the drop.
      await assertSearchVocabulary(session, 'phase22');
      await assertMessagingRemoved(session);
      await assertClassesFoundation(session, 'before-messaging');
      await assertLearningFoundation(session, 'before-messaging');
      await assertPersonalisationFoundation(session, 'before-messaging');
      await assertFatwaFoundation(session, 'before-messaging');
      await assertTaxonomyFoundation(session);
      await assertPeopleFoundation(session);
      await assertAudioFoundation(session);
      await assertPhotoFoundation(session);
      await assertQuranFoundation(session);
    }
    if (migration.id === CLASSES_MIGRATION) {
      // Phase 23 widened no search vocabulary, so none narrows here — and the
      // whole Phase-22 state it was applied on is back: the protected bundle the
      // compiled bundle less the two class keys, no teaching key, Learning's
      // first slice whole with nothing referencing it, Personalisation and
      // Fatwa whole, and every owner a live-class key once named — Identity's
      // accounts and RoleAssignment, Learning's own Course and trial request —
      // untouched by the drop.
      await assertSearchVocabulary(session, 'phase22');
      await assertClassesRemoved(session);
      await assertLearningFoundation(session, 'before-classes');
      await assertPersonalisationFoundation(session, 'before-classes');
      await assertFatwaFoundation(session, 'before-classes');
      await assertTaxonomyFoundation(session);
      await assertPeopleFoundation(session, 'before-classes');
    }
    if (migration.id === LEARNING_MIGRATION) {
      // Phase 22 widened the vocabulary by `course` and `learning-path`, so it
      // narrows back to exactly Phase 20's (Phase 21 widened nothing) — and the
      // whole Phase-21 state it was applied on is back: the protected bundle the
      // compiled bundle less the two Learning keys (and the two class keys
      // Phase 23's rollback removed first), Personalisation whole, and every
      // owner a Learning key once named — Taxonomy's Topic and Language,
      // People's Person and Identity's accounts — untouched by the drop.
      await assertSearchVocabulary(session, 'phase20');
      await assertLearningRemoved(session);
      await assertPersonalisationFoundation(session, 'before-learning');
      await assertFatwaFoundation(session, 'before-learning');
      await assertTaxonomyFoundation(session);
      await assertPeopleFoundation(session, 'before-classes');
    }
    if (migration.id === PERSONALISATION_MIGRATION) {
      // Phase 21 widened no search vocabulary, so none narrows here — and the
      // whole Phase-20 state it was applied on is back: the protected bundle the
      // compiled bundle less the two newsletter keys (and the two Learning keys
      // Phase 22's rollback removed first), and every owner a
      // Personalisation key once named — Fatwa and Identity's accounts, the
      // Quran's Ayah, Hadith's citation, Editorial's Article, Library's Work,
      // Media's Video and the editorial Collection — untouched by the drop and
      // holding no foreign reference again.
      await assertSearchVocabulary(session, 'phase20');
      await assertPersonalisationRemoved(session);
      await assertFatwaFoundation(session, 'before-personalisation');
      await assertHadithFoundation(session);
      await assertQuranFoundation(session);
      await assertCollectionFoundation(session);
      await assertEventFoundation(session);
      await assertMediaFoundation(session);
    }
    if (migration.id === '20261004000000_phase20_fatwa') {
      // Phase 20 widened the vocabulary by `fatwa` alone, so it narrows back to
      // exactly Phase 19's — and the whole Phase-19 state it was applied on is
      // back: the owners a Fatwa key once named (Identity's accounts, Language,
      // Topic and Person) untouched by the drop, the protected bundle the whole
      // ungated catalogue, and Hadith and the Quran intact.
      await assertSearchVocabulary(session, 'phase19');
      await assertFatwaRemoved(session);
      await assertTaxonomyFoundation(session);
      await assertPeopleFoundation(session, 'before-classes');
      await assertHadithFoundation(session);
      await assertQuranFoundation(session);
    }
    if (migration.id === '20261003000000_phase19_hadith') {
      // Phase 19 widened the vocabulary by `hadith` alone, so it narrows back
      // to exactly Phase 18's — and the whole Phase-18 state it was applied on
      // is back: the owners a Hadith key once named (Language, Topic and
      // Person) untouched by the drop, and the Quran intact.
      await assertSearchVocabulary(session, 'phase18');
      await assertHadithRemoved(session);
      await assertTaxonomyFoundation(session);
      await assertPeopleFoundation(session, 'before-classes');
      await assertQuranFoundation(session);
      await assertCollectionFoundation(session);
    }
    if (migration.id === '20261002000000_phase18_quran') {
      // Phase 18 widened the vocabulary by `quran-ayah` alone, so it narrows
      // back to exactly Phase 13's — and the whole Phase-15 state it was applied
      // on is back: the owners a Quran key once named (Language, Topic, Person
      // and Storage's Asset) untouched by the drop, and Collections intact.
      await assertSearchVocabulary(session, 'phase13');
      await assertQuranRemoved(session);
      await assertTaxonomyFoundation(session);
      await assertPeopleFoundation(session, 'before-classes');
      await assertAudioFoundation(session);
      await assertPhotoFoundation(session);
      await assertCollectionFoundation(session);
    }
    if (migration.id === '20261001000000_phase15_collections') {
      // Phase 15 widened no search vocabulary, so none narrows here — and the
      // whole Phase-14 state it was applied on is back exactly: the Event
      // foundation with Phase 14's own descriptions, and the News, Library and
      // Media records a member key once named, untouched by the drop.
      await assertSearchVocabulary(session, 'phase13');
      await assertCollectionRemoved(session);
      await assertEventFoundation(session, 'phase14');
      await assertGlobalFoundation(session);
      await assertNewsFoundation(session);
      await assertMediaFoundation(session);
    }
    if (migration.id === '20260930000000_phase14_events') {
      // Phase 14 widened no search vocabulary, so none narrows here — and the
      // whole Phase-16 state it was applied on is back exactly: one Centre
      // reference outside Global, the Gallery and News foundations intact.
      await assertSearchVocabulary(session, 'phase13');
      await assertEventRemoved(session);
      await assertGlobalFoundation(session, 'before-events');
      await assertPhotoFoundation(session);
      await assertNewsFoundation(session);
    }
    if (migration.id === '20260929000000_phase16_global_network') {
      // Phase 16 widened no search vocabulary, so none narrows here.
      await assertSearchVocabulary(session, 'phase13');
      await assertGlobalRemoved(session);
    }
    if (migration.id === '20260928000000_phase13_news') {
      await assertSearchVocabulary(session, 'phase11');
      await assertEditorialPermissionsDescribeArticleAndPageOnly(session);
    }
    if (migration.id === '20260927000000_phase12_media_galleries') {
      // Phase 12 widened no search vocabulary, so none narrows here.
      await assertSearchVocabulary(session, 'phase11');
      await assertMediaPermissionsDescribeAudioOnly(session);
    }
    if (migration.id === '20260926000000_phase11_media_audio') {
      await assertSearchVocabulary(session, 'phase10');
      await assertMediaPermissionsDescribeVideoOnly(session);
    }
    if (migration.id === '20260925000000_phase10_media_video') {
      await assertSearchVocabulary(session, 'phase9');
    }
    if (migration.id === '20260924000000_phase9_research_publications') {
      await assertSearchVocabulary(session, 'phase17');
    }
    if (migration.id === '20260923000000_phase17_search_foundation') {
      await assertSearchRemoved(session);
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
  await assertSearchFoundation(session);
  await assertSearchVocabulary(session, 'phase22');
  await assertMediaFoundation(session);
  await assertAudioFoundation(session);
  await assertPhotoFoundation(session);
  await assertNewsFoundation(session);
  await assertGlobalFoundation(session);
  await assertEventFoundation(session);
  await assertCollectionFoundation(session);
  await assertQuranFoundation(session);
  await assertHadithFoundation(session);
  await assertFatwaFoundation(session);
  await assertPersonalisationFoundation(session);
  await assertLearningFoundation(session, 're-deploy');
  await assertClassesFoundation(session, 're-deploy');
  await assertMessagingFoundation(session, 're-deploy');
  await assertMembershipFoundation(session, 're-deploy');
  await assertDonationsFoundation(session, 're-deploy');
  await assertMigrationFoundation(session, 're-deploy');
  // The membership rules as BEHAVIOUR, on the re-deployed schema: what was
  // rolled back and re-applied enforces exactly what the first deploy did.
  await assertCollectionMembership(session);
  // And the canonical Quran rules, with sentinel text only. The rows they write
  // are never removed — canonical history cannot be — and die with this
  // disposable database.
  await assertQuranCanonicalRules(session);
  // And the canonical Hadith rules, last, with sentinel text only. Their rows
  // are never removed either — canonical history cannot be — and die with
  // this disposable database.
  await assertHadithCanonicalRules(session);
  // And the Fatwa workflow rules, last, with sentinel text only. Revisions,
  // publications and decisions are never removed — history cannot be — and die
  // with this disposable database.
  await assertFatwaRules(session);
  // And the Personalisation rules: they name an Ayah and a Hadith citation the
  // canonical proofs above wrote, and their synthetic accounts, content and
  // subscribers die with this disposable database.
  await assertPersonalisationRules(session);
  // And the Learning rules: their synthetic accounts, teacher, Courses and
  // paths are written and then removed again, children first, so the
  // re-deployed Learning schema ends as empty as the migration left it.
  await assertLearningRules(session);
  // And the live-class rules: 51281 is proved BEFORE the fixture activation is
  // written, because that row is immutable (51280) and so, like canonical
  // history, dies only with this disposable database; every other synthetic
  // row — accounts, roles, Courses, scopes, windows, sessions, bookings, marks
  // and intents — is removed again, children first.
  await assertClassesRules(session);
  // And the Messaging rules: each kind's 51302 is proved BEFORE its
  // fixture activation is written, because those rows are immutable (51300);
  // they and the one moderated support conversation — whose decisions are
  // permanent (51309) — die only with this disposable database, and every
  // other synthetic row is removed through the disposal path, children first.
  await assertMessagingRules(session);
  // And the Membership rules: their synthetic accounts, types, applications,
  // Memberships and intents are written and then removed again, children
  // first, so the re-deployed Membership schema ends as empty as the migration
  // left it.
  await assertMembershipRules(session);
  // And the Donations rules, last: 51345 is proved BEFORE the fixture
  // activation is written, because that row is immutable (51342) and so dies
  // only with this disposable database; every other synthetic row — accounts,
  // the refund role, sessions and step-up grants, campaigns, donations, events,
  // refunds and intents — is removed again, children first.
  await assertDonationsRules(session);
  // And Phase 29's bundle extension as behaviour: rolled back alone and
  // re-applied through the real Prisma CLI over a live holder of the protected
  // role, whose sessions and step-up grants it must revoke.
  const migrationProvenance = migrations.find(
    (entry) => entry.id === MIGRATION_PROVENANCE_MIGRATION,
  );
  if (migrationProvenance === undefined)
    fail(`${MIGRATION_PROVENANCE_MIGRATION} is not among the migrations on disk.`);
  await assertMigrationBundleExtension(session, migrationProvenance);
  // And the Migration & Provenance rules, last: raw snapshots can never be
  // deleted and every decision is history, so — like the canonical proofs —
  // their synthetic rows die with this disposable database.
  await assertMigrationRules(session);

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
