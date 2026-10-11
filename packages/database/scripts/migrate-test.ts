import 'server-only';

import { randomUUID } from 'node:crypto';

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
  // private saved list is Personalisation's and arrives with its own phase; it
  // shares no table with the editorial Collection.
  'PrivateCollection',
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
  // Phase 9 delivers the six scholarly and periodical aggregates and invents no
  // sub-aggregate beside them: an issue is not a set of articles, a publication
  // has no issues, and an encyclopedia's structure is its readable document.
  'MagazineArticle',
  'PublicationIssue',
  'PeriodicalIssue',
  'EncyclopediaEntry',
  // Phase 10 delivers Video, Series and Playlist and nothing else of Media's
  // that is not its own: a programme is a Series kind, and watch history is
  // Phase 21's per-user state.
  'Program',
  'WatchHistory',
  // Phase 11 delivers non-Quran audio and nothing of Quran's: a Recitation and
  // its verse mapping belong to Phase 18, and no listening history is authorised
  // by any phase.
  'Recitation',
  'RecitationSegment',
  'ListeningHistory',
  // Phase 12 delivers galleries with NO Event relationship: the typed
  // Event↔Gallery association is Phase 14's `EventGallery`, which left this list
  // when Phase 14 delivered it on the Event revision. A Media-owned reverse join
  // or a per-photograph Event link is still no phase's.
  'GalleryEvent',
  'EventPhoto',
  'PhotoPerson',
  'PhotoTopic',
  // Phase 13 delivers News with NO Event or newsletter relationship: the
  // newsletter is Phase 21's consent record, and a News lead image would need a
  // Storage or Media dependency no phase has decided. `Centre` left this list
  // when Phase 16 delivered it.
  'NewsletterSubscriber',
  'NewsArticleImage',
  'NewsArticleAsset',
  'NewsArticlePhoto',
  // Phase 16 delivers the Global Network with NO Event relationship: the typed
  // Event→Centre reference is Phase 14's, and Phase 14 delivers it as the
  // revision's own `centreId` column — so a Global-owned or join-table shape of
  // it stays absent. `EventSchedule` left this list when Phase 14 delivered it.
  'CentreEvent',
  'EventCentre',
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

/**
 * Phase 9 WIDENS the search vocabularies by exactly its six kinds, each its own
 * scope, Phase 10 by exactly `video` and Phase 11 by exactly `audio`; each
 * rollback narrows them back to exactly the previous phase's. Asserted against the catalogue in every
 * direction, so a migration that pre-created a later domain's kind, or a
 * rollback that left one behind, fails here.
 */
async function assertSearchVocabulary(
  session: SqlSession,
  stage: 'phase17' | 'phase9' | 'phase10' | 'phase11' | 'phase13',
): Promise<void> {
  const sorted = (values: readonly string[]) => [...values].sort().join(',');
  const added = {
    phase17: [],
    phase9: PHASE9_KINDS,
    phase10: [...PHASE9_KINDS, ...PHASE10_KINDS],
    phase11: [...PHASE9_KINDS, ...PHASE10_KINDS, ...PHASE11_KINDS],
    phase13: [...PHASE9_KINDS, ...PHASE10_KINDS, ...PHASE11_KINDS, ...PHASE13_KINDS],
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

  const permissions = await session.query<{ key: string; description: string }>(`
    SELECT [key], [description] FROM [dbo].[Permission]
    WHERE [key] LIKE N'content.%' OR [key] LIKE N'news%' OR [key] LIKE N'press%'
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
 * `event.*`, `collection.*` or membership key exists.
 */
async function assertEditorialDescriptions(
  session: SqlSession,
  stage: keyof typeof EDITORIAL_DESCRIPTIONS,
): Promise<void> {
  const rows = await session.query<{ key: string; description: string }>(`
    SELECT [key], [description] FROM [dbo].[Permission]
    WHERE [key] IN (N'content.read', N'content.author') OR [key] LIKE N'event%'
       OR [key] LIKE N'schedule%' OR [key] LIKE N'occurrence%'
       OR [key] LIKE N'collection%' OR [key] LIKE N'member%'
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
          AND NOT (c.object_id = OBJECT_ID(N'[dbo].[ProviderEvent]') AND c.name = N'eventId')) AS columns;
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

  const [ownership] = await session.query<{ inbound: number; columns: string | null }>(`
    SELECT
      (SELECT COUNT(*) FROM sys.foreign_keys
        WHERE referenced_object_id IN (${tables}) AND parent_object_id NOT IN (${tables})) AS inbound,
      (SELECT STRING_AGG(OBJECT_NAME(c.object_id) + N'.' + c.name, N',') FROM sys.columns c
        WHERE c.name LIKE N'%collection%' AND c.object_id NOT IN (${tables})
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
  for (const member of COLLECTION_MEMBERS)
    await refuse(
      `A ${member.table} that is a member is never deleted`,
      `DELETE FROM [dbo].[${member.table}] WHERE [id]=N'${first(member)}';`,
      [547],
      `CollectionItem_${member.column}_fkey`,
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
  await assertSearchFoundation(session);
  await assertSearchVocabulary(session, 'phase13');
  await assertMediaFoundation(session);
  await assertAudioFoundation(session);
  await assertPhotoFoundation(session);
  await assertNewsFoundation(session);
  await assertGlobalFoundation(session);
  await assertEventFoundation(session);
  await assertCollectionFoundation(session);
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
  await assertSearchVocabulary(session, 'phase13');
  await assertMediaFoundation(session);
  await assertAudioFoundation(session);
  await assertPhotoFoundation(session);
  await assertNewsFoundation(session);
  await assertGlobalFoundation(session);
  await assertEventFoundation(session);
  await assertCollectionFoundation(session);
  // The membership rules as BEHAVIOUR, on the re-deployed schema: what was
  // rolled back and re-applied enforces exactly what the first deploy did.
  await assertCollectionMembership(session);

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
