import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { repoRoot } from '../architecture/architecture-harness.ts';

const databaseRoot = path.join(repoRoot, 'packages', 'database');

describe('Phase 1 Chunk 1 database foundation', () => {
  it('locks the exact stable Prisma 7.10.0 stack', async () => {
    const manifest = JSON.parse(
      await readFile(path.join(databaseRoot, 'package.json'), 'utf8'),
    ) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };

    expect(manifest.devDependencies.prisma).toBe('7.10.0');
    expect(manifest.dependencies['@prisma/client']).toBe('7.10.0');
    expect(manifest.dependencies['@prisma/adapter-mssql']).toBe('7.10.0');
  });

  it('marks every reachable database implementation entry as server-only', async () => {
    for (const entry of ['src/index.ts', 'src/client.ts', 'src/config.ts']) {
      const source = await readFile(path.join(databaseRoot, entry), 'utf8');
      expect(source, `${entry} must carry the server-only marker`).toMatch(
        /import\s+['"]server-only['"]/,
      );
    }
  });

  it('routes the package browser condition only to the failing target', async () => {
    const manifest = JSON.parse(
      await readFile(path.join(databaseRoot, 'package.json'), 'utf8'),
    ) as { exports: Record<string, Record<string, string>> };

    expect(manifest.exports['.']?.browser).toBe('./src/client-import-error.ts');
    await expect(
      import('../../packages/database/src/client-import-error.ts'),
    ).rejects.toThrow(/server-only/);
  });

  it('declares exactly the delivered models, and no later-phase domain', async () => {
    const schema = await readFile(
      path.join(databaseRoot, 'prisma', 'schema.prisma'),
      'utf8',
    );
    const prismaEntries = await readdir(path.join(databaseRoot, 'prisma'));

    // The schema is EXHAUSTIVE, so a model arriving without its owning phase
    // fails here rather than being noticed later. `AuditLog` is the Phase 1
    // audit foundation (SECURITY_BASELINE.md §13); then Phase 2 Chunk 1 —
    // Identity & Access, plus the Layer-0 concerns that phase first genuinely
    // needs (ARCHITECTURE.md §4.5, §4.6.1); then Phase 2 Chunk 2 —
    // authorisation, step-up and the privileged second factor; then Phase 3B —
    // the canonical taxonomy and the content-language reference data.
    const models = [...schema.matchAll(/^\s*model\s+(\w+)/gm)].map((match) => match[1]);
    expect(models).toEqual([
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
      // Phase 2 Chunk 2.
      'Permission',
      'Role',
      'RolePermission',
      'RoleAssignment',
      'StepUpGrant',
      'TwoFactor',
      'PrivilegedSecurityPosture',
      'IdentityBootstrap',
      // Phase 3B — Taxonomy.
      'Topic',
      'TopicTranslation',
      'Language',
      'Tag',
      // Phase 5 — People & Contributors. FOUR PROFILE AGGREGATES, and the count
      // is part of the claim: DOMAIN_MODEL.md §5.2 requires Person, User and
      // the four profiles to stay six distinct models, so a migration that
      // delivered one `Profile` table with a `type` column would satisfy
      // "People shipped" and fail here.
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
      // Phase 13 — Editorial: NewsArticle, PressRelease, Statement and
      // MediaCoverage, each with the Article's own tables — never one News table.
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
      'ContactInquiry',
      'Feedback',
      'Asset',
      // Phase 8 — Library. Work, its Editions, genuine BookTranslation relations
      // and SalePoint, with typed relation sets and the permanent slug namespace.
      'Work',
      'WorkLabel',
      'WorkSlugHistory',
      'WorkContributor',
      'WorkTopic',
      'Edition',
      'BookTranslation',
      'BookTranslator',
      'SalePoint',
      'WorkSalePoint',
      // Phase 9 — six distinct scholarly and periodical Library aggregates, each
      // with its own typed relation sets and permanent slug namespace.
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
      'MagazineIssueContributor',
      'MagazineIssueTopic',
      'MagazineIssueSlugHistory',
      'Encyclopedia',
      'EncyclopediaLabel',
      'EncyclopediaSlugHistory',
      'EncyclopediaContributor',
      'EncyclopediaTopic',
      // Phase 10 — Media: Video, Series and Playlist, each its own table with
      // its own typed relation sets and permanent slug namespace.
      'Video',
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
      // Phase 11 — Media: AudioTrack and AudioSeries, their labels, slug
      // histories and typed speaker and topic relations. No generic media or
      // asset-link table: a track's file is its own foreign key to `Asset`.
      'AudioTrack',
      'AudioTrackLabel',
      'AudioTrackSlugHistory',
      'AudioTrackSpeaker',
      'AudioTrackTopic',
      'AudioSeries',
      'AudioSeriesLabel',
      'AudioSeriesSlugHistory',
      // Phase 12 — Media: Photo, Gallery and GalleryItem. A Photo's image is its
      // own foreign key to `Asset`; a Gallery's membership is its own typed,
      // ordered table; no Event, Album or generic media table.
      'Photo',
      'PhotoLabel',
      'Gallery',
      'GalleryLabel',
      'GallerySlugHistory',
      'GalleryItem',
      // Phase 17 — the Layer-0 search concern's DERIVED state: indexing intent,
      // per-scope indexing state, and the rebuildable projection.
      'SearchIndexRequest',
      'SearchIndexScope',
      'SearchDocument',
      'SearchDocumentTopic',
      // Phase 16 — Global Network: Country, Region, City and Centre, their
      // labels and Country-scoped slug histories, the Cities a Centre serves
      // and its ordered contacts. No Event, schedule, map or import table.
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
      // Phase 14 — Editorial: Event with the Article's own shape of tables, and
      // two revision-owned typed sets — its occurrences and its ordered Media
      // Galleries. Its Centre is a column on the revision, never a join table.
      'Event',
      'EventRevision',
      'EventRevisionTranslation',
      'EventTopic',
      'EventContributor',
      'EventSchedule',
      'EventGallery',
      'EventSlugHistory',
      // Phase 15 — Editorial: Collection with the Article's own shape of tables,
      // and ONE revision-owned ordered list of typed members (`CollectionItem`,
      // one nullable foreign-keyed column per member type).
      'Collection',
      'CollectionRevision',
      'CollectionRevisionTranslation',
      'CollectionTopic',
      'CollectionContributor',
      'CollectionItem',
      'CollectionSlugHistory',
      // Phase 18 — Quran: the operator-registered sources and the activation,
      // the canonical store keyed by its citation with its immutable history and
      // verification evidence, the layered works, and typed topic assignment.
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
      // Phase 19 — Hadith: the operator-registered source systems, editions
      // and activations, the canonical structure and source-qualified records
      // with their immutable history, gradings, verification, citation mapping
      // and conflict evidence, the layered works, and typed topic assignment.
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
      // Phase 20 — Fatwa's activation, categories, the private question, the
      // ruling with its immutable revisions, topics, publications and review
      // decisions, and the anonymous read tally.
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
      // Phase 21 — a person's own profile, saved items, bookmarks, notes,
      // private collections, history, Quran position, notification preferences
      // and notifications, and the newsletter subscription with its consent
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
      // Phase 22 — Learning's public catalogue of Courses, their words, slug
      // history, typed topics and teachers, modules and lessons; LearningPaths
      // with their words, slug history and ordered Courses; and a person's own
      // enrolments, lesson progress and trial-class requests.
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
      // Course teaching scope, a teacher's bookable windows, class sessions, the
      // confirmed trial Booking, attendance marks and the durable service-mail
      // intent.
      'LiveLearningActivation',
      'CourseTeachingAssignment',
      'Availability',
      'ClassSession',
      'Booking',
      'Attendance',
      'ClassCommunicationIntent',
      // Phase 24 — Messaging: the owner's per-kind activation, conversations
      // with their participants, ordered immutable messages, attachments that
      // name a Storage asset, read positions, blocks, reports and permanent
      // moderation decisions.
      'MessagingActivation',
      'Conversation',
      'ConversationParticipant',
      'Message',
      'MessageAttachment',
      'MessageReadState',
      'MessagingBlock',
      'MessagingReport',
      'MessagingModerationDecision',
      // Phase 26 — Membership: a type with its words per locale, an account's
      // application, the Membership an approval creates, and the durable
      // applicant service-mail intent. No payment model of any kind.
      'MembershipType',
      'MembershipTypeTranslation',
      'MembershipApplication',
      'Membership',
      'MembershipCommunicationIntent',
      // Phase 27 — Donations: a campaign with its words and per-currency
      // policy, the owner's fail-closed activation, the donation (one payment
      // attempt in exact minor units), the provider-event dedup record, the
      // refund and the linked donor's acknowledgement intent. No card,
      // payment method, order, cart, invoice or subscription model.
      'DonationCampaign',
      'DonationCampaignTranslation',
      'DonationCampaignCurrency',
      'DonationActivation',
      'Donation',
      'DonationProviderEvent',
      'DonationRefund',
      'DonationCommunicationIntent',
      // Phase 29 — Migration & Provenance: fixture legacy sources and their
      // hosts, runs with their per-record items, the stable legacy record, raw
      // snapshots, staged revisions with their categories and links, topic
      // mappings, import errors, duplicate candidates, asset provenance,
      // legacy URL mappings, publish manifests with their entries and reviewed
      // promotions. No credential, cookie, crawl-queue or generic target model.
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
    ]);

    // Asserted against declared MODELS, not raw text: the schema comments name
    // the deferred domains in order to explain why they are absent, and a
    // substring match would read that explanation as the very violation it
    // documents.
    //
    // The authorisation models left this list when Chunk 2 delivered the
    // enforcement that gives them meaning. Everything remaining belongs to a
    // later phase entirely.
    for (const domain of [
      // `Event` left this list when Phase 14 delivered it, and `Collection`
      // when Phase 15 did. Phase 18 delivers the Quran as its own tables, so a
      // single generic `Quran` model stays absent. `Hadith` left it when
      // Phase 19 delivered the source-qualified record.
      'Quran',
      // `Book` stays absent: Phase 8 models the Work/Edition split rather than a
      // single Book row, which is the conflation DOMAIN_MODEL.md §10.1 corrects.
      'Book',
      // Sub-aggregates Phase 9 deliberately does not invent. Phase 21 delivered
      // per-user reading state as Personalisation's `ReadingHistory` and
      // `Bookmark`; a generic `ReadingProgress` is still no phase's.
      'MagazineArticle',
      'PublicationIssue',
      'EncyclopediaEntry',
      'ReadingProgress',
      // Shapes Media never delivers or has not yet: a Program aggregate (a
      // programme is a Series kind), per-kind or per-provider Video tables
      // (watch history is Personalisation's, Phase 21) — and, for Phase 12, an Album, an image or
      // asset-link table, or a Media-owned Event join. (Phase 14's
      // `EventGallery` is Editorial's, on the Event revision.)
      'Program',
      'Album',
      'Image',
      'AssetLink',
      'GalleryEvent',
      'MediaItem',
      'YouTubeVideo',
      'LectureVideo',
      // Phase 13 invents no generic News or editorial table, and the newsletter
      // arrived as Phase 21's consent record. Phase 30-R's lead image is ONE
      // typed Asset key on the revision — never an image table or a gallery
      // in News. (Phase 16's Centre is a column on the News revision, never a
      // per-centre content table.)
      'NewsItem',
      'EditorialContent',
      'NewsArticleImage',
      'CentreNews',
      'CentreContent',
      // Phase 16 has no generic location table, no Event or schedule, and no
      // map, geocoder or import state.
      'Location',
      'Place',
      'CentreEvent',
      'CentreSchedule',
      'GeocodeCache',
      'CentreImport',
      // Phase 14 has no registration, ticketing, attendance or venue model, no
      // recurrence rule, no Event image and no generic attachment or target:
      // an occurrence is an explicit row, a place is a Global Centre, and its
      // photographs are Media Galleries.
      'EventRegistration',
      'EventAttendee',
      'EventTicket',
      'EventBooking',
      'EventVenue',
      'Venue',
      'EventLocation',
      'EventRecurrence',
      'EventImage',
      'EventAsset',
      'EventTarget',
      'EventCentre',
      'EventPhoto',
      'Attachment',
      // Phase 15 has one EDITORIAL Collection: no join per member type, no
      // member type a prerequisite did not deliver, and no generic target table.
      // (A person's private list arrived as Personalisation's
      // `PrivateCollection` in Phase 21, sharing no table with it.)
      'CollectionMember',
      'CollectionTarget',
      'CollectionArticle',
      'CollectionWork',
      'CollectionVideo',
      'CollectionEvent',
      'CollectionGallery',
      'CollectionPage',
      'CollectionImage',
      // Phase 18 has ONE canonical identity and separate layered works: no
      // second verse or chapter model, no generic layer, work or target model,
      // no Quran-owned per-user state (the reading position is Personalisation's
      // `QuranReadingProgress`), and no slug history for a slug that never
      // changes.
      'Verse',
      'Chapter',
      'QuranVerse',
      'QuranWork',
      'QuranLayer',
      'QuranTarget',
      'AyahTarget',
      'QuranBookmark',
      'QuranTranslationSlugHistory',
      // Phase 19 keeps the chain as the source's exact text: no narrator
      // aggregate or chain link, no platform grade vocabulary, no generic
      // target or assignment, no per-user reading state (Phase 21's), and no
      // slug history for a slug that never changes.
      'Narrator',
      'NarratorProfile',
      'HadithNarrator',
      'HadithChainLink',
      'HadithGrade',
      'HadithTarget',
      'HadithAssignment',
      'HadithLayer',
      'HadithBookmark',
      'HadithReadingProgress',
      'HadithSlugHistory',
      // Phase 20 counts reads and records no reader, keeps topics per revision,
      // freezes an address at first publication and holds no per-user state:
      // no read log, no unversioned topic table, no slug history, no
      // context-less question and no saved rulings (Phase 21's).
      'FatwaRead',
      'FatwaReadEvent',
      'FatwaTopic',
      'FatwaSlugHistory',
      'FatwaBookmark',
      'Question',
      // Phase 21 holds every target as a typed key and sends nothing: no
      // polymorphic target or content reference, no generic activity log, no
      // raw newsletter token and no campaign, issue or delivery record.
      // (Learning's progress arrived as Phase 22's per-lesson
      // `LessonProgress`.)
      'PersonalTarget',
      'UserContentReference',
      'ContentReference',
      'SavedTarget',
      'UserHistory',
      'UserActivity',
      'NewsletterToken',
      'NewsletterCampaign',
      'NewsletterIssue',
      'NewsletterDelivery',
      // Phase 22 keeps progress per lesson, names teachers as People's Person
      // and holds every reference by a typed key; Phase 23 delivered the
      // session, availability, attendance and booking models as Learning's own
      // live slice. Still no phase's: Course-level progress, a standalone
      // Teacher, a Video or Centre relation, a generic learning target or
      // content table, and an enrolment on a path.
      'CourseProgress',
      'Teacher',
      'CourseVideo',
      'CourseCentre',
      'LearningTarget',
      'LearningContent',
      'CourseItem',
      'PathEnrolment',
      // Phase 27 is hosted checkout, not ecommerce or a card vault: no card,
      // payment method, wallet or billing model, no order, cart, invoice or
      // receipt, no subscription or recurring plan, and no raw provider payload.
      'DonationCard',
      'DonationPaymentMethod',
      'PaymentMethod',
      'Card',
      'Order',
      'Cart',
      'Invoice',
      'DonationReceipt',
      'Subscription',
      'DonationSubscription',
      'DonationPayload',
      // Phase 29 contacts no live source: no credential, cookie or session for
      // a legacy host, no crawl or scrape queue, a published record names its
      // target by a typed key rather than a generic target model, and written
      // authorisation per source is Phase 30's.
      'MigrationProvenance',
      'MigrationCredential',
      'MigrationCookie',
      'MigrationSession',
      'MigrationCrawlQueue',
      'MigrationTarget',
      'MigrationAuthorisation',
      'ScrapeQueue',
    ]) {
      expect(models, `${domain} arrives with its owning slice`).not.toContain(domain);
    }

    // The two shapes Phase 5 must NOT have produced, asserted by name beside
    // the deferred domains above. A single `Profile` table would be §5.2's
    // merge; a generic `Contribution` would be §6.2's polymorphic pair one
    // boundary along, with a real foreign key to the contributor and a type
    // string for the work.
    for (const merged of [
      'Profile',
      'ContributorProfile',
      'Contribution',
      // Phase 9: one generic content table would collapse six aggregates.
      'Content',
      'LibraryResource',
    ]) {
      expect(models, `${merged} is a shape the model prohibits`).not.toContain(merged);
    }

    expect(prismaEntries).toContain('migrations');
  });

  it('keeps database secrets out of the public contracts root', async () => {
    const publicContracts = await readFile(
      path.join(repoRoot, 'packages', 'contracts', 'src', 'index.ts'),
      'utf8',
    );

    expect(publicContracts).not.toContain('DATABASE_URL');
    expect(publicContracts).not.toContain('DATABASE_MIGRATION_URL');
  });

  it('defines the SQL Server 2022 Developer service without a password', async () => {
    const compose = await readFile(path.join(repoRoot, 'docker', 'compose.yaml'), 'utf8');

    // Phase 17: the official image WITH Full-Text Search, built from the
    // repository's own Dockerfile — never a floating tag.
    expect(compose).toMatch(/build:\s*\n\s*context:\s*\.\/sqlserver/u);
    expect(compose).toContain('image: minhaj-platform-sqlserver-fts:16.0.4265.3');
    expect(compose).not.toContain('2022-latest');
    expect(compose).toMatch(/MSSQL_PID:\s*Developer/);
    expect(compose).toContain('14330}:1433');
    expect(compose).toContain('${MSSQL_SA_PASSWORD:');
    const passwordLine = compose
      .split('\n')
      .find((line) => line.trim().startsWith('MSSQL_SA_PASSWORD:'));
    expect(passwordLine?.trim()).toMatch(/^MSSQL_SA_PASSWORD:\s*\$\{/);
  });

  it('pins the SQL Server image and its Full-Text Search to ONE engine build', async () => {
    // An FTS package from a different build than the engine would move the
    // engine forward underneath the persistent volume — a one-way upgrade — so
    // the base digest, the engine package and the FTS package must agree.
    const dockerfile = await readFile(
      path.join(repoRoot, 'docker', 'sqlserver', 'Dockerfile'),
      'utf8',
    );

    expect(dockerfile).toMatch(
      /^FROM mcr\.microsoft\.com\/mssql\/server:2022-CU26-ubuntu-22\.04@sha256:[0-9a-f]{64}$/mu,
    );
    expect(dockerfile).toContain('mssql-server=16.0.4265.3-1');
    expect(dockerfile).toContain('mssql-server-fts=16.0.4265.3-1');
    // Executable lines only: the file's own comments explain why the floating
    // tag was retired, and a comment naming it is not a use of it.
    const instructions = dockerfile
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('#'))
      .join('\n');
    expect(instructions).not.toMatch(/2022-latest/u);

    // The build context is that directory alone, so nothing else — least of
    // all the ignored `docker/.env` beside it — can enter the image.
    const context = await readdir(path.join(repoRoot, 'docker', 'sqlserver'));
    expect(context).toEqual(['Dockerfile']);
  });
});
