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
  // Phase 9 delivers the six scholarly and periodical aggregates and invents no
  // sub-aggregate beside them: an issue is not a set of articles, a publication
  // has no issues, and an encyclopedia's structure is its readable document.
  'MagazineArticle',
  'PublicationIssue',
  'PeriodicalIssue',
  'EncyclopediaEntry',
  // Phase 10 delivers Video, Series and Playlist and nothing else of Media's:
  // galleries are Phase 12, a programme is a Series kind, and watch history is
  // Phase 21's per-user state.
  'Photo',
  'Gallery',
  'GalleryItem',
  'Program',
  'WatchHistory',
  // Phase 11 delivers non-Quran audio and nothing of Quran's: a Recitation and
  // its verse mapping belong to Phase 18, and no listening history is authorised
  // by any phase.
  'Recitation',
  'RecitationSegment',
  'ListeningHistory',
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
  // Phase 9. Filtered because an issue without a printed volume and number is
  // ordinary, and two such issues are not duplicates of each other.
  {
    table: 'MagazineIssue',
    index: 'MagazineIssue_magazineId_volume_issueNumber_key',
    why: 'two issues of one Magazine could claim the same volume and number',
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

/**
 * Phase 9 WIDENS the search vocabularies by exactly its six kinds, each its own
 * scope, Phase 10 by exactly `video` and Phase 11 by exactly `audio`; each
 * rollback narrows them back to exactly the previous phase's. Asserted against the catalogue in every
 * direction, so a migration that pre-created a later domain's kind, or a
 * rollback that left one behind, fails here.
 */
async function assertSearchVocabulary(
  session: SqlSession,
  stage: 'phase17' | 'phase9' | 'phase10' | 'phase11',
): Promise<void> {
  const sorted = (values: readonly string[]) => [...values].sort().join(',');
  const added = {
    phase17: [],
    phase9: PHASE9_KINDS,
    phase10: [...PHASE9_KINDS, ...PHASE10_KINDS],
    phase11: [...PHASE9_KINDS, ...PHASE10_KINDS, ...PHASE11_KINDS],
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
      phase11: 'Phase 17, the six Phase-9 kinds, video and audio',
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
  await assertSearchVocabulary(session, 'phase11');
  await assertMediaFoundation(session);
  await assertAudioFoundation(session);
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
  await assertSearchVocabulary(session, 'phase11');
  await assertMediaFoundation(session);
  await assertAudioFoundation(session);

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
