import {
  newPhase6Fixture,
  writePhase6Fixture,
  capturePhase6Fixture,
  verifyRestoredPhase6,
} from '../src/lifecycle/phase6-fixture.ts';
import {
  capturePhase8Fixture,
  newPhase8Fixture,
  verifyRestoredPhase8,
  writePhase8Fixture,
} from '../src/lifecycle/phase8-fixture.ts';
import {
  capturePhase9Fixture,
  newPhase9Fixture,
  verifyRestoredPhase9,
  writePhase9Fixture,
} from '../src/lifecycle/phase9-fixture.ts';
import {
  capturePhase10Fixture,
  newPhase10Fixture,
  verifyRestoredPhase10,
  writePhase10Fixture,
} from '../src/lifecycle/phase10-fixture.ts';
import {
  capturePhase11Fixture,
  newPhase11Fixture,
  verifyRestoredPhase11,
  writePhase11Fixture,
} from '../src/lifecycle/phase11-fixture.ts';
import {
  capturePhase12Fixture,
  newPhase12Fixture,
  verifyRestoredPhase12,
  writePhase12Fixture,
} from '../src/lifecycle/phase12-fixture.ts';
import {
  capturePhase13Fixture,
  newPhase13Fixture,
  verifyRestoredPhase13,
  writePhase13Fixture,
} from '../src/lifecycle/phase13-fixture.ts';
import {
  capturePhase14Fixture,
  newPhase14Fixture,
  verifyRestoredPhase14,
  writePhase14Fixture,
} from '../src/lifecycle/phase14-fixture.ts';
import {
  capturePhase15Fixture,
  newPhase15Fixture,
  verifyRestoredPhase15,
  writePhase15Fixture,
} from '../src/lifecycle/phase15-fixture.ts';
import {
  capturePhase16Fixture,
  newPhase16Fixture,
  verifyRestoredPhase16,
  writePhase16Fixture,
} from '../src/lifecycle/phase16-fixture.ts';
import {
  capturePhase18Fixture,
  newPhase18Fixture,
  verifyRestoredPhase18,
  writePhase18Fixture,
} from '../src/lifecycle/phase18-fixture.ts';
import {
  capturePhase19Fixture,
  newPhase19Fixture,
  verifyRestoredPhase19,
  writePhase19Fixture,
} from '../src/lifecycle/phase19-fixture.ts';
import {
  capturePhase20Fixture,
  newPhase20Fixture,
  verifyRestoredPhase20,
  writePhase20Fixture,
} from '../src/lifecycle/phase20-fixture.ts';
import {
  capturePhase21Fixture,
  newPhase21Fixture,
  verifyRestoredPhase21,
  writePhase21Fixture,
} from '../src/lifecycle/phase21-fixture.ts';
import {
  capturePhase22Fixture,
  newPhase22Fixture,
  verifyRestoredPhase22,
  writePhase22Fixture,
} from '../src/lifecycle/phase22-fixture.ts';
import {
  capturePhase23Fixture,
  newPhase23Fixture,
  verifyRestoredPhase23,
  writePhase23Fixture,
} from '../src/lifecycle/phase23-fixture.ts';
import {
  capturePhase24Fixture,
  newPhase24Fixture,
  verifyRestoredPhase24,
  writePhase24Fixture,
} from '../src/lifecycle/phase24-fixture.ts';
import {
  capturePhase26Fixture,
  newPhase26Fixture,
  verifyRestoredPhase26,
  writePhase26Fixture,
} from '../src/lifecycle/phase26-fixture.ts';
import 'server-only';

import { getApplicationPrincipalCredentials } from '../src/config.ts';
import { provisionApplicationPrincipal } from '../src/lifecycle/application-principal.ts';
import {
  backupArtifactExists,
  backupDatabase,
  newBackupTarget,
  newRestoreDatabaseName,
  restoreDatabaseFromBackup,
} from '../src/lifecycle/backup.ts';
import {
  createDisposableDatabase,
  dropDisposableDatabase,
  newDisposableDatabaseName,
  openMasterSession,
} from '../src/lifecycle/disposable-database.ts';
import { deployMigrations, loadMigrations } from '../src/lifecycle/migrations.ts';
import {
  newPhase2Fixture,
  verifyRestoredIntegrity,
  verifyRestoredPhase2,
  writePhase2Fixture,
} from '../src/lifecycle/phase2-fixture.ts';
import {
  newPhase3bFixture,
  verifyRestoredPhase3b,
  verifyRestoredTaxonomyIntegrity,
  writePhase3bFixture,
} from '../src/lifecycle/phase3b-fixture.ts';
import {
  newPhase5Fixture,
  verifyRestoredPeopleIntegrity,
  verifyRestoredPhase5,
  writePhase5Fixture,
} from '../src/lifecycle/phase5-fixture.ts';
import { inspectPrincipalAuthority } from '../src/lifecycle/principal-authority.ts';
import {
  cleanUpRecoveryResources,
  RecoveryCleanupError,
  type CleanupFailure,
  type CleanupOutcome,
} from '../src/lifecycle/recovery-cleanup.ts';
import {
  inspectRestoredSecurity,
  verifyRestoredSchema,
} from '../src/lifecycle/restored-state.ts';
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
 * `npm run db:recovery:populated` — THE POPULATED recovery gate.
 *
 *   create a DISPOSABLE source
 *     -> deploy EVERY migration with the real Prisma CLI
 *     -> provision the least-privilege runtime principal
 *     -> write representative synthetic rows into EVERY Phase-2, Phase-3B
 *        and Phase-5 table
 *     -> REAL BACKUP DATABASE ... WITH CHECKSUM
 *     -> RESTORE into a separate disposable database
 *     -> verify the rows, their relationships and the whole migration history
 *     -> verify the restored permission posture, as the runtime principal
 *     -> drop both databases, delete the artifact, prove all three are gone
 *
 * WHY THIS EXISTS ALONGSIDE `db:recovery:test`.
 *
 * That command rehearses the OPERATIONAL artifact: it backs up the real
 * engineering database and restores it. This one rehearses the CONTENT: it
 * proves that populated Phase-2 state — accounts, credentials, sessions,
 * communication intents, deliveries, suppressions, provider events, limiter
 * windows and audit rows — and populated Phase-3B state — the canonical topic
 * seed, a topic hierarchy, localisations in three scripts, a content language
 * and a tag — and populated Phase-5 People/profile state survive a backup and
 * restore with their values, relationships and enforcing constraints intact.
 *
 * Neither is sufficient alone. The first proved only that an AuditLog marker
 * came back, which a database holding one table would also prove; the second
 * cannot prove anything about the real database's artifact.
 *
 * NOTHING REAL IS TOUCHED. The source is created by this run, and the fixture
 * rows are synthetic and self-identifying. `MinhajPlatform` is never opened.
 */

function report(step: string, detail: string): void {
  process.stdout.write(`  ${step.padEnd(30)} ${detail}\n`);
}

function fail(message: string): never {
  throw new Error(message);
}

// Resolves docker/.env as the sole authority and proves the approved local
// target before anything is created.
//
// The CONFIGURED database is validated under the `source` policy, exactly as
// the live test harness does, and is then retargeted at a disposable name that
// is validated again under the `disposable` policy. Nothing in this run ever
// opens the configured database: it supplies the host, port, port-scoped local
// identity and TLS posture, and the disposable target is what is touched.
const command = startLocalCommand('source');

const sourceDatabase = newDisposableDatabaseName();
const restoreDatabase = newRestoreDatabaseName();
const target = newBackupTarget();
const fixture = newPhase2Fixture();
const taxonomyFixture = newPhase3bFixture();
const peopleFixture = newPhase5Fixture();
const editorialFixture = newPhase6Fixture();
const libraryFixture = newPhase8Fixture();
const scholarlyFixture = newPhase9Fixture();
const mediaFixture = newPhase10Fixture();
const audioFixture = newPhase11Fixture();
const photoFixture = newPhase12Fixture();
const newsFixture = newPhase13Fixture();
const globalFixture = newPhase16Fixture();
const eventFixture = newPhase14Fixture();
const collectionFixture = newPhase15Fixture();
const quranFixture = newPhase18Fixture();
const hadithFixture = newPhase19Fixture();
const fatwaFixture = newPhase20Fixture();
const personalFixture = newPhase21Fixture();
const learningFixture = newPhase22Fixture();
const classesFixture = newPhase23Fixture();
const messagingFixture = newPhase24Fixture();
const membershipFixture = newPhase26Fixture();

// Re-validated rather than assumed: a retarget that silently did nothing must
// fail here, not at the point where CREATE DATABASE runs.
const source = retargetAtDisposable(command, sourceDatabase);
const principal = getApplicationPrincipalCredentials(command.environment.values);

const migrations = await loadMigrations();
if (migrations.length === 0) fail('No migrations found; nothing to prove recoverable.');
const migrationIds = migrations.map((migration) => migration.id);

const master = await openMasterSession(command.connection);
let admin: SqlSession | undefined;
let restored: SqlSession | undefined;

let recoveryError: unknown;
let cleanupOutcome!: CleanupOutcome;
const sourceFailures: CleanupFailure[] = [];

process.stdout.write(`Populated Phase-2, Phase-3B and Phase-5 recovery rehearsal\n`);
reportConfiguration(command, 30);
report('disposable source', sourceDatabase);
report('restore target', restoreDatabase);

try {
  // ---- a source that actually holds the current foundation -----------------
  await createDisposableDatabase(master, sourceDatabase);
  admin = await openSession(source.connection);

  // The REAL Prisma CLI over the normal encrypted configuration, so what is
  // proved recoverable is what a deployment produces.
  await deployMigrations(source.url);
  report('migrations deployed', migrationIds.join(', '));

  // The least-privilege principal, from the SAME script a deployment runs. Its
  // survival through the restore is one of the things under test.
  await provisionApplicationPrincipal(
    admin,
    principal.DATABASE_APP_LOGIN,
    principal.DATABASE_APP_PASSWORD,
  );
  report('runtime principal', `${principal.DATABASE_APP_LOGIN} provisioned`);

  // ---- populate ------------------------------------------------------------
  await writePhase2Fixture(admin, fixture);
  report('fixture written', `run ${fixture.runId}`);
  report('fixture account', fixture.email);

  // Phase-3B taxonomy, written into a database that ALREADY holds the nineteen
  // canonical topics the migration seeded — so the restore has both foundation
  // data and administered data to bring back, and the assertions can tell the
  // two apart.
  await writePhase3bFixture(admin, taxonomyFixture);
  report('taxonomy fixture', `run ${taxonomyFixture.runId}`);

  // Phase-5 contributors: one holding all four facets and an account link, and
  // one historical contributor with no account at all. Both halves are written
  // BEFORE the backup, so the restore has to reproduce the relationships
  // between them rather than merely the rows.
  await writePhase5Fixture(admin, peopleFixture);
  report('people fixture', `run ${peopleFixture.runId}`);
  await writePhase6Fixture(admin, editorialFixture, {
    authorId: fixture.accountId,
    reviewerId: peopleFixture.accountId,
    personId: peopleFixture.linkedPersonId,
    topicId: taxonomyFixture.childTopicId,
  });
  const editorialSnapshot = await capturePhase6Fixture(admin, editorialFixture);
  report('editorial fixture', '14 populated authoritative tables');

  // Phase-8 Library: a renamed Work, two Editions in two content languages, a
  // genuine translation relation and an Edition whose readable file is a Storage
  // Asset — so the restore must bring back the RELATION as well as the rows.
  await writePhase8Fixture(admin, libraryFixture, {
    personId: peopleFixture.linkedPersonId,
    translatorId: peopleFixture.historicalPersonId,
    topicId: taxonomyFixture.childTopicId,
  });
  const librarySnapshot = await capturePhase8Fixture(admin, libraryFixture);
  report('library fixture', `run ${libraryFixture.runId}`);

  // Phase-9 scholarly and periodical records: renamed slugs in both namespaces
  // of a Magazine and its issue, an archived paper, a draft issue, a citation and
  // a pending search intent — so the restore must bring back relations,
  // invariants and owed derived work, not merely rows.
  await writePhase9Fixture(admin, scholarlyFixture, {
    personId: peopleFixture.linkedPersonId,
    topicId: taxonomyFixture.childTopicId,
  });
  const scholarlySnapshot = await capturePhase9Fixture(admin, scholarlyFixture);
  report('scholarly fixture', `run ${scholarlyFixture.runId}`);

  // Phase-10 Media: a renamed Video, a series renamed into a programme, an
  // ordered playlist, an archived Video, case-distinct provider identifiers and
  // a pending search intent. No video bytes exist to back up.
  await writePhase10Fixture(admin, mediaFixture, {
    personId: peopleFixture.linkedPersonId,
    topicId: taxonomyFixture.childTopicId,
  });
  const mediaSnapshot = await capturePhase10Fixture(admin, mediaFixture);
  report('media fixture', `run ${mediaFixture.runId}`);

  // Phase-11 audio: a renamed published track at its place in a renamed audio
  // series, its typed Storage asset, a draft track with an asset of its own, an
  // archived track and a pending search intent. The audio BYTES are the other
  // half of this recovery and are rehearsed with the storage root by
  // tests/storage/audio-recovery.integration.test.ts.
  await writePhase11Fixture(admin, audioFixture, {
    personId: peopleFixture.linkedPersonId,
    topicId: taxonomyFixture.childTopicId,
  });
  const audioSnapshot = await capturePhase11Fixture(admin, audioFixture);
  report('audio fixture', `run ${audioFixture.runId}`);

  // Phase-12 photographs: a published Photo with its typed asset, dimensions, a
  // partial date and an Urdu caption; a draft Photo with an asset of its own;
  // an archived Photo; and a renamed Gallery holding all three in a deliberate
  // order. The image BYTES are rehearsed with the storage root by
  // tests/storage/photo-recovery.integration.test.ts.
  await writePhase12Fixture(admin, photoFixture);
  const photoSnapshot = await capturePhase12Fixture(admin, photoFixture);
  report('photo fixture', `run ${photoFixture.runId}`);

  // Phase-13 News: one published record of each of the four families, renamed
  // once and approved independently, in Urdu and English with typed topics and
  // contributors, a Statement issuer and a coverage source; an archived
  // NewsArticle; a scheduled press release; and the search intent still owed.
  await writePhase13Fixture(admin, newsFixture, {
    authorId: fixture.accountId,
    reviewerId: peopleFixture.accountId,
    personId: peopleFixture.linkedPersonId,
    topicId: taxonomyFixture.childTopicId,
  });
  const newsSnapshot = await capturePhase13Fixture(admin, newsFixture);
  report('news fixture', `run ${newsFixture.runId}`);

  // Phase-16 Global Network: a Country with no Region and one with a renamed
  // Region, Cities under each, a renamed physical Centre with exact
  // coordinates, ordered contacts and two served Cities, a virtual Centre, an
  // archived Centre placed in a Region, and a published NewsArticle whose
  // current revision names the physical Centre.
  await writePhase16Fixture(admin, globalFixture, {
    authorId: fixture.accountId,
    reviewerId: peopleFixture.accountId,
    personId: peopleFixture.linkedPersonId,
    topicId: taxonomyFixture.childTopicId,
  });
  const globalSnapshot = await capturePhase16Fixture(admin, globalFixture);
  report('global fixture', `run ${globalFixture.runId}`);

  // Phase-14 Events: a published Event renamed once and approved independently,
  // in English and Urdu with a typed Topic and speaker, whose occurrences in a
  // daylight-saving zone store both the local wall-clock time and the derived
  // UTC instant — one in the repeated fall-back hour, at its LATER instant —
  // held at the Phase-16 physical Centre and associated with the Phase-12
  // Gallery, with its workflow audit trail.
  const eventReferences = {
    centreId: globalFixture.physicalCentreId,
    galleryId: photoFixture.galleryId,
  };
  await writePhase14Fixture(admin, eventFixture, {
    authorId: fixture.accountId,
    reviewerId: peopleFixture.accountId,
    personId: peopleFixture.linkedPersonId,
    topicId: taxonomyFixture.childTopicId,
    ...eventReferences,
  });
  const eventSnapshot = await capturePhase14Fixture(admin, eventFixture);
  report('event fixture', `run ${eventFixture.runId}`);

  // Phase-15 Collections: a published Collection renamed once and approved
  // independently, in English, Urdu and Arabic with a typed Topic and compiler,
  // whose current revision gathers ALL SEVEN member types — the Phase-6
  // Article, the four Phase-13 News records, the Phase-8 Work and the Phase-10
  // Video — in one deliberate mixed order beside its smaller first revision; a
  // second Collection scheduled for later; and both workflows' audit trails.
  const collectionReferences = {
    authorId: fixture.accountId,
    reviewerId: peopleFixture.accountId,
    personId: peopleFixture.linkedPersonId,
    topicId: taxonomyFixture.childTopicId,
    members: {
      article: editorialFixture.articleId,
      'news-article': newsFixture.ids.NewsArticle,
      'press-release': newsFixture.ids.PressRelease,
      statement: newsFixture.ids.Statement,
      'media-coverage': newsFixture.ids.MediaCoverage,
      work: libraryFixture.workId,
      video: mediaFixture.videoId,
    },
  };
  await writePhase15Fixture(admin, collectionFixture, collectionReferences);
  const collectionSnapshot = await capturePhase15Fixture(admin, collectionFixture);
  report('collection fixture', `run ${collectionFixture.runId}`);

  // Phase-18 Quran, with sentinel NON-QURAN text only: two registered fixture
  // sources, a fictional two-Surah corpus materialised with version-1 history
  // under a passed acceptance run, a failed run, a recorded version-2
  // correction, fixture-mode activation, Surah display names, published
  // translation, tafsir, recitation (a fictional reciter, a Storage Asset) and
  // tajweed rule, a draft transliteration, an Ayah topic and Ayah search intent.
  const quranReferences = {
    actorId: fixture.accountId,
    personId: peopleFixture.linkedPersonId,
    topicId: taxonomyFixture.childTopicId,
  };
  await writePhase18Fixture(admin, quranFixture, quranReferences);
  const quranSnapshot = await capturePhase18Fixture(admin, quranFixture);
  report('quran fixture', `run ${quranFixture.runId}`);

  // Phase-19 Hadith, with sentinel NON_HADITH_FIXTURE text only: two registered
  // fixture source systems with one edition each of one collection, display
  // names, a book per edition and a chapter, two records sharing one apparent
  // source reference across the editions, version-1 history and a recorded
  // version-2 correction with versioned gradings, verification at both
  // versions, a mapped citation and the conflict evidence the correction
  // produced, fixture-mode activation, a published translation, commentary and
  // science, a record topic and the `hadith` search intent.
  const hadithReferences = {
    actorId: fixture.accountId,
    personId: peopleFixture.linkedPersonId,
    topicId: taxonomyFixture.childTopicId,
  };
  await writePhase19Fixture(admin, hadithFixture, hadithReferences);
  const hadithSnapshot = await capturePhase19Fixture(admin, hadithFixture);
  report('hadith fixture', `run ${hadithFixture.runId}`);

  // Phase-20 Fatwa, with NON_FATWA_FIXTURE sentinels only: fixture-mode
  // activation, a category mapped onto a Topic with display names, two askers'
  // private questions (one answered, one submitted), a ruling with a first
  // publication, a correction returned with a private note and the revised
  // correction published, revision topics, a two-day read tally, the `fatwa`
  // search intent, and synthetic triage, answer and publish roles with the
  // publisher's session and step-up grant.
  const fatwaReferences = { topicId: taxonomyFixture.childTopicId };
  await writePhase20Fixture(admin, fatwaFixture, fatwaReferences);
  const fatwaSnapshot = await capturePhase20Fixture(admin, fatwaFixture);
  report('fatwa fixture', `run ${fatwaFixture.runId}`);

  // Phase-21 Personalisation, with NON_PERSONALISATION_FIXTURE sentinels and
  // `.invalid` addresses only: two accounts' onboarding answers, a saved item of
  // each typed kind — the Phase-6 Article, the Phase-8 Work, the Phase-10
  // Video, a Phase-18 Ayah and the Phase-19 public citation — with a bookmark
  // and a note, an ordered private collection, reading, watch and Quran
  // progress, a preference and two notifications, and five newsletter
  // subscriptions, one per state, holding only link hashes, with their consent
  // evidence.
  const personalReferences = {
    articleId: editorialFixture.articleId,
    workId: libraryFixture.workId,
    videoId: mediaFixture.videoId,
    surahNumber: 1,
    ayahNumber: 1,
    hadithCitationId: hadithFixture.citationId,
  };
  await writePhase21Fixture(admin, personalFixture, personalReferences);
  const personalSnapshot = await capturePhase21Fixture(admin, personalFixture);
  report('personal fixture', `run ${personalFixture.runId}`);

  // Phase-22 Learning, with NON_LEARNING_FIXTURE sentinels and `.invalid`
  // addresses only: a published live Course classified under the Phase-3B Topic
  // with the Phase-5 Person as its teacher, two ordered modules of three
  // ordered lessons and a former slug; a published self-paced Course; a draft
  // Course; a published path holding both published Courses in order with a
  // former slug of its own; two accounts' enrolments, lesson progress and a
  // trial request; and the search passes owed for the Course and the path.
  const learningReferences = {
    topicId: taxonomyFixture.childTopicId,
    personId: peopleFixture.linkedPersonId,
  };
  await writePhase22Fixture(admin, learningFixture, learningReferences);
  const learningSnapshot = await capturePhase22Fixture(admin, learningFixture);
  report('learning fixture', `run ${learningFixture.runId}`);

  // Phase-23 live classes, with NON_LEARNING_FIXTURE sentinels and `.invalid`
  // addresses only: the fixture activation; two synthetic teachers holding
  // synthetic roles carrying `teaching.perform` — one live and currently
  // scoped to the Phase-22 published live Course, one revoked with an ended
  // scope; the live teacher's windows; the Phase-22 learner's trial request
  // confirmed into a Booking of a trial session with a synthetic-but-valid
  // meeting address; a Course session with a reminder and the learner's mark;
  // two pending intents; and a cancelled past session.
  const classesReferences = {
    liveCourseId: learningFixture.liveCourseId,
    learnerId: learningFixture.learnerId,
    trialId: learningFixture.trialId,
  };
  await writePhase23Fixture(admin, classesFixture, classesReferences);
  const classesSnapshot = await capturePhase23Fixture(admin, classesFixture);
  report('classes fixture', `run ${classesFixture.runId}`);

  // Phase-24 Messaging, with NON_MESSAGING_FIXTURE sentinels and `.invalid`
  // addresses only: the three fixture activations; a teacher-student
  // conversation between the Phase-23 live teacher and the Phase-22 learner on
  // the Phase-22 live Course with ordered messages, read positions, a withheld
  // message, an open conversation report and three attachments naming clean
  // assets by their release digests (metadata only — bytes are Storage's); a
  // released upload; a block; a support conversation with a live claim and a
  // revoked one; a moderator; and a closed-account terminal conversation.
  const messagingReferences = {
    liveCourseId: learningFixture.liveCourseId,
    learnerId: learningFixture.learnerId,
    teacherId: classesFixture.teacherId,
  };
  await writePhase24Fixture(admin, messagingFixture, messagingReferences);
  const messagingSnapshot = await capturePhase24Fixture(admin, messagingFixture);
  report('messaging fixture', `run ${messagingFixture.runId}`);

  // Phase-26 Membership, with NON_MEMBERSHIP_FIXTURE sentinels and `.invalid`
  // addresses only: published, archived and draft types with their words in
  // all three locales; submitted, under-review, approved, rejected and
  // withdrawn applications of three synthetic accounts; an active and a
  // member-closed Membership, each made from its own approval; a pending and
  // a relayed intent. No payment concept of any kind.
  await writePhase26Fixture(admin, membershipFixture);
  const membershipSnapshot = await capturePhase26Fixture(admin, membershipFixture);
  report('membership fixture', `run ${membershipFixture.runId}`);

  // ---- REAL backup ---------------------------------------------------------
  const backup = await backupDatabase(admin, sourceDatabase, target);
  report('BACKUP DATABASE', backup.target.path);
  report(
    'header verified',
    `database=${backup.header.databaseName} size=${backup.header.backupSize} bytes ` +
      `checksums=${backup.header.hasBackupChecksums}`,
  );

  if (!(await backupArtifactExists(admin, target.path))) {
    fail('BACKUP reported success but the artifact does not exist on the server.');
  }
  report('artifact exists', 'confirmed via xp_fileexist');

  // ---- REAL restore --------------------------------------------------------
  await restoreDatabaseFromBackup(master, target.path, restoreDatabase);
  report('RESTORE DATABASE', `restored into ${restoreDatabase}`);

  restored = await openSession(withDatabase(command.connection, restoreDatabase));

  // ---- schema and the WHOLE migration history ------------------------------
  const restoredState = await verifyRestoredSchema(restored, migrationIds);
  report('restored tables', `${restoredState.tables.length} tables`);
  report('restored history', restoredState.migrations.join(', '));

  // EVERY migration, not the first. `verifyRestoredSchema` throws on an
  // absent one; this states what was actually proved.
  for (const id of migrationIds) {
    if (!restoredState.migrations.includes(id)) {
      fail(`Restored history is missing ${id}.`);
    }
  }
  report('history complete', `all ${migrationIds.length} migrations present`);

  // ---- the POPULATED data --------------------------------------------------
  const rows = await verifyRestoredPhase2(restored, fixture);
  for (const row of rows) report(`restored ${row.table}`, row.detail);

  const integrity = await verifyRestoredIntegrity(restored, fixture);
  report('referential integrity', integrity);

  const taxonomyRows = await verifyRestoredPhase3b(restored, taxonomyFixture);
  for (const row of taxonomyRows) report(`restored ${row.table}`, row.detail);

  const taxonomyIntegrity = await verifyRestoredTaxonomyIntegrity(
    restored,
    taxonomyFixture,
  );
  report('taxonomy integrity', taxonomyIntegrity);

  const peopleRows = await verifyRestoredPhase5(restored, peopleFixture);
  for (const row of peopleRows) report(`restored ${row.table}`, row.detail);

  const peopleIntegrity = await verifyRestoredPeopleIntegrity(restored, peopleFixture);
  report('people integrity', peopleIntegrity);
  report(
    'editorial recovery',
    await verifyRestoredPhase6(restored, editorialFixture, editorialSnapshot),
  );
  report(
    'library recovery',
    await verifyRestoredPhase8(restored, libraryFixture, librarySnapshot),
  );
  report(
    'scholarly recovery',
    await verifyRestoredPhase9(restored, scholarlyFixture, scholarlySnapshot),
  );
  report(
    'media recovery',
    await verifyRestoredPhase10(restored, mediaFixture, mediaSnapshot),
  );
  report(
    'audio recovery',
    await verifyRestoredPhase11(restored, audioFixture, audioSnapshot),
  );
  report(
    'photo recovery',
    await verifyRestoredPhase12(restored, photoFixture, photoSnapshot),
  );
  report(
    'news recovery',
    await verifyRestoredPhase13(restored, newsFixture, newsSnapshot),
  );
  report(
    'global recovery',
    await verifyRestoredPhase16(restored, globalFixture, globalSnapshot),
  );
  report(
    'event recovery',
    await verifyRestoredPhase14(restored, eventFixture, eventSnapshot, eventReferences),
  );
  report(
    'collection recovery',
    await verifyRestoredPhase15(
      restored,
      collectionFixture,
      collectionSnapshot,
      collectionReferences,
    ),
  );
  report(
    'quran recovery',
    await verifyRestoredPhase18(restored, quranFixture, quranSnapshot, quranReferences),
  );
  report(
    'hadith recovery',
    await verifyRestoredPhase19(
      restored,
      hadithFixture,
      hadithSnapshot,
      hadithReferences,
    ),
  );
  report(
    'fatwa recovery',
    await verifyRestoredPhase20(restored, fatwaFixture, fatwaSnapshot, fatwaReferences),
  );
  report(
    'personal recovery',
    await verifyRestoredPhase21(
      restored,
      personalFixture,
      personalSnapshot,
      personalReferences,
    ),
  );
  report(
    'learning recovery',
    await verifyRestoredPhase22(
      restored,
      learningFixture,
      learningSnapshot,
      learningReferences,
    ),
  );
  report(
    'classes recovery',
    await verifyRestoredPhase23(
      restored,
      classesFixture,
      classesSnapshot,
      classesReferences,
    ),
  );
  report(
    'messaging recovery',
    await verifyRestoredPhase24(
      restored,
      messagingFixture,
      messagingSnapshot,
      messagingReferences,
    ),
  );
  report(
    'membership recovery',
    await verifyRestoredPhase26(restored, membershipFixture, membershipSnapshot),
  );

  // ---- restored security posture -------------------------------------------
  const security = await inspectRestoredSecurity(restored, principal.DATABASE_APP_LOGIN);

  if (!security.userPresent) {
    fail(
      `Restored database has no '${principal.DATABASE_APP_LOGIN}' user; the ` +
        `least-privilege principal did not survive the restore.`,
    );
  }
  if (security.ownsDatabase) {
    fail(`'${principal.DATABASE_APP_LOGIN}' owns the restored database.`);
  }
  if (security.broadRoles.length > 0) {
    fail(`Broad roles in the restored database: ${security.broadRoles.join(', ')}`);
  }

  const denied = security.auditPermissions
    .filter((entry) => entry.state === 'DENY')
    .map((entry) => entry.permission);
  const granted = security.auditPermissions
    .filter((entry) => entry.state === 'GRANT')
    .map((entry) => entry.permission);

  for (const permission of ['UPDATE', 'DELETE']) {
    if (!denied.includes(permission)) {
      fail(`Restored database does not DENY ${permission} on dbo.AuditLog.`);
    }
  }
  for (const permission of ['INSERT', 'SELECT']) {
    if (!granted.includes(permission)) {
      fail(`Restored database does not GRANT ${permission} on dbo.AuditLog.`);
    }
  }
  report(
    'restored AuditLog rights',
    `GRANT ${granted.join('/')} · DENY ${denied.join('/')}`,
  );

  // SERVER-LEVEL logins live in `master` and are NOT inside the artifact. On
  // this instance the login already exists with the same SID, so the restored
  // user maps straight back. On another instance it would be orphaned until
  // re-mapped — a re-provisioning step, not a property of the artifact. Said
  // plainly rather than claimed as something the backup contains.
  report(
    'server-level mapping',
    security.loginMapped
      ? `login resolves by SID — DATABASE STATE RESTORED and LOGIN MAPPING INTACT`
      : `login does NOT resolve — DATABASE STATE RESTORED, LOGIN NEEDS REBINDING`,
  );

  // ---- live behaviour, AS the restored runtime principal --------------------
  if (security.loginMapped) {
    let app: SqlSession | undefined;
    try {
      app = await openSession({
        ...withDatabase(command.connection, restoreDatabase),
        user: principal.DATABASE_APP_LOGIN,
        password: principal.DATABASE_APP_PASSWORD,
      });

      const authority = await inspectPrincipalAuthority(app);
      const broadEffective = [
        ...authority.broadRoles,
        ...authority.databasePermissions
          .filter((entry) => entry.held)
          .map((entry) => `DATABASE ${entry.permission}`),
        ...authority.schemaPermissions
          .filter((entry) => entry.held)
          .map((entry) => `SCHEMA dbo ${entry.permission}`),
      ];
      if (broadEffective.length > 0) {
        fail(
          `The restored runtime principal holds broad effective authority: ` +
            broadEffective.join(', '),
        );
      }
      report('restored effective rights', 'no broad database/schema authority');

      // It can READ its own Phase-2 tables.
      const [visible] = await app.query<{ total: number }>(
        `SELECT COUNT_BIG(*) AS total FROM [dbo].[User] WHERE [id] = N'${fixture.accountId}';`,
      );
      if (Number(visible?.total ?? 0) !== 1) {
        fail('The restored runtime principal cannot read the restored account row.');
      }
      report('restored runtime SELECT', 'permitted on Phase-2 data');

      // It can NOT alter audit history, and it holds NO DDL.
      const forbidden: readonly [string, string][] = [
        ['AuditLog UPDATE', `UPDATE [dbo].[AuditLog] SET [action] = N'tampered';`],
        ['AuditLog DELETE', 'DELETE FROM [dbo].[AuditLog];'],
        [
          'IdentitySecurityOperation DELETE',
          'DELETE FROM [dbo].[IdentitySecurityOperation];',
        ],
        [
          'EmailSuppression UPDATE',
          `UPDATE [dbo].[EmailSuppression] SET [reason] = N'x';`,
        ],
        // Phase 3B. The whole integrity claim of the taxonomy rests on the
        // runtime being unable to DELETE a topic: a later context's typed
        // assignment will hold a real foreign key to one, and a runtime that
        // could remove the row could orphan it or be blocked by it. The denial
        // has to survive a RESTORE, not merely exist in the source.
        ['Topic DELETE', 'DELETE FROM [dbo].[Topic];'],
        ['Language DELETE', 'DELETE FROM [dbo].[Language];'],
        ['Tag DELETE', 'DELETE FROM [dbo].[Tag];'],
        // Phase 5. The same claim for contributors: a later content context's
        // attribution will hold a real foreign key to one of these, so the
        // absence of DELETE has to survive a restore as well as a deploy.
        ['Person DELETE', 'DELETE FROM [dbo].[Person];'],
        ['Article DELETE', 'DELETE FROM [dbo].[Article];'],
        ['Page DELETE', 'DELETE FROM [dbo].[Page];'],
        ['Article revision UPDATE', 'UPDATE [dbo].[ArticleRevision] SET [slug]=[slug];'],
        ['Page revision DELETE', 'DELETE FROM [dbo].[PageRevision];'],
        ['AuthorProfile DELETE', 'DELETE FROM [dbo].[AuthorProfile];'],
        ['TeacherProfile DELETE', 'DELETE FROM [dbo].[TeacherProfile];'],
        [
          'Person slug UPDATE',
          "UPDATE [dbo].[Person] SET [slug] = N'restored-rename-attempt';",
        ],
        // Phase 9. A restored runtime can neither erase a record nor release a
        // reserved slug in either of a periodical's two namespaces.
        ['Research DELETE', 'DELETE FROM [dbo].[Research];'],
        ['MagazineIssue DELETE', 'DELETE FROM [dbo].[MagazineIssue];'],
        [
          'MagazineIssueSlugHistory DELETE',
          'DELETE FROM [dbo].[MagazineIssueSlugHistory];',
        ],
        // Phase 10. A restored runtime can neither erase a Video nor release a
        // reserved Video slug, nor rewrite a Playlist's order in place.
        ['Video DELETE', 'DELETE FROM [dbo].[Video];'],
        ['VideoSlugHistory DELETE', 'DELETE FROM [dbo].[VideoSlugHistory];'],
        [
          'PlaylistVideo UPDATE',
          'UPDATE [dbo].[PlaylistVideo] SET [position]=[position];',
        ],
        // Phase 11. A restored runtime can neither erase a track nor release a
        // reserved track slug.
        ['AudioTrack DELETE', 'DELETE FROM [dbo].[AudioTrack];'],
        ['AudioTrackSlugHistory DELETE', 'DELETE FROM [dbo].[AudioTrackSlugHistory];'],
        // Phase 12. A restored runtime can neither erase a Photo or a Gallery,
        // release a reserved Gallery slug, nor rewrite a Gallery's order.
        ['Photo DELETE', 'DELETE FROM [dbo].[Photo];'],
        ['Gallery DELETE', 'DELETE FROM [dbo].[Gallery];'],
        ['GallerySlugHistory DELETE', 'DELETE FROM [dbo].[GallerySlugHistory];'],
        ['GalleryItem UPDATE', 'UPDATE [dbo].[GalleryItem] SET [position]=[position];'],
        // Phase 13. A restored runtime can neither erase a News record, rewrite
        // an immutable revision, nor release a reserved slug of any family.
        ['NewsArticle DELETE', 'DELETE FROM [dbo].[NewsArticle];'],
        ['Statement DELETE', 'DELETE FROM [dbo].[Statement];'],
        [
          'StatementRevisionTranslation UPDATE',
          'UPDATE [dbo].[StatementRevisionTranslation] SET [issuer]=[issuer];',
        ],
        [
          'MediaCoverageRevision UPDATE',
          'UPDATE [dbo].[MediaCoverageRevision] SET [sourceUrl]=[sourceUrl];',
        ],
        [
          'PressReleaseSlugHistory DELETE',
          'DELETE FROM [dbo].[PressReleaseSlugHistory];',
        ],
        // Phase 16. A restored runtime can neither erase a directory record,
        // release a reserved Country-scoped or Centre slug, nor rewrite a
        // Centre's contacts or served Cities in place.
        ['Country DELETE', 'DELETE FROM [dbo].[Country];'],
        ['Centre DELETE', 'DELETE FROM [dbo].[Centre];'],
        ['RegionSlugHistory DELETE', 'DELETE FROM [dbo].[RegionSlugHistory];'],
        [
          'CentreSlugHistory UPDATE',
          'UPDATE [dbo].[CentreSlugHistory] SET [slug]=[slug];',
        ],
        ['CentreContact UPDATE', 'UPDATE [dbo].[CentreContact] SET [value]=[value];'],
        [
          'CentreServiceCity UPDATE',
          'UPDATE [dbo].[CentreServiceCity] SET [cityId]=[cityId];',
        ],
        // Phase 14. A restored runtime can neither erase an Event, move an
        // occurrence or a revision's zone in place, remove a Gallery
        // association, nor release a reserved slug.
        ['Event DELETE', 'DELETE FROM [dbo].[Event];'],
        [
          'EventRevision UPDATE',
          'UPDATE [dbo].[EventRevision] SET [timezone]=[timezone];',
        ],
        [
          'EventSchedule UPDATE',
          'UPDATE [dbo].[EventSchedule] SET [startsAt]=[startsAt];',
        ],
        ['EventGallery DELETE', 'DELETE FROM [dbo].[EventGallery];'],
        ['EventSlugHistory DELETE', 'DELETE FROM [dbo].[EventSlugHistory];'],
        // Phase 15. A restored runtime can neither erase a Collection, remove,
        // move or retarget a member in place, rewrite a revision, nor release a
        // reserved slug.
        ['Collection DELETE', 'DELETE FROM [dbo].[Collection];'],
        ['CollectionItem DELETE', 'DELETE FROM [dbo].[CollectionItem];'],
        [
          'CollectionItem UPDATE',
          'UPDATE [dbo].[CollectionItem] SET [position]=[position];',
        ],
        [
          'CollectionRevision UPDATE',
          'UPDATE [dbo].[CollectionRevision] SET [slug]=[slug];',
        ],
        ['CollectionSlugHistory DELETE', 'DELETE FROM [dbo].[CollectionSlugHistory];'],
        // Phase 18. A restored runtime can neither register, edit or remove a
        // source, switch the corpus on or off, write canonical text or history
        // directly, call the authority check, rename a work's public address,
        // erase a work, move a segment's range, nor re-parent a text.
        [
          'QuranSource UPDATE',
          "UPDATE [dbo].[QuranSource] SET [authority]=N'approved',[reference]=N'urn:example:forged';",
        ],
        ['QuranSourceAyah DELETE', 'DELETE FROM [dbo].[QuranSourceAyah];'],
        ['QuranActivation DELETE', 'DELETE FROM [dbo].[QuranActivation];'],
        ['Ayah text UPDATE', 'UPDATE [dbo].[Ayah] SET [text]=[text];'],
        ['Surah ayahCount UPDATE', 'UPDATE [dbo].[Surah] SET [ayahCount]=[ayahCount];'],
        ['QuranAyahRevision DELETE', 'DELETE FROM [dbo].[QuranAyahRevision];'],
        [
          'QuranVerificationRun UPDATE',
          'UPDATE [dbo].[QuranVerificationRun] SET [outcome]=[outcome];',
        ],
        [
          'QuranAssertCanonicalAuthority EXECUTE',
          `EXEC [dbo].[QuranAssertCanonicalAuthority] @actorId=N'${fixture.accountId}', @sessionId=N'none', @stepUpGrantId=N'none';`,
        ],
        [
          'QuranTranslation slug UPDATE',
          'UPDATE [dbo].[QuranTranslation] SET [slug]=[slug];',
        ],
        ['QuranRecitation DELETE', 'DELETE FROM [dbo].[QuranRecitation];'],
        [
          'QuranRecitationSegment UPDATE',
          'UPDATE [dbo].[QuranRecitationSegment] SET [startAyah]=[startAyah];',
        ],
        ['QuranTopic UPDATE', 'UPDATE [dbo].[QuranTopic] SET [topicId]=[topicId];'],
        [
          'QuranTranslationText re-parent UPDATE',
          'UPDATE [dbo].[QuranTranslationText] SET [translationId]=[translationId];',
        ],
        // Phase 19. A restored runtime can neither edit a registered source,
        // make a collection public, write canonical text, history, gradings,
        // verification or citations directly, run conflict detection or the
        // authority check itself, rename a work's public address, erase a work,
        // re-parent a translation, nor alter a Hadith table.
        [
          'HadithSourceSystem UPDATE',
          "UPDATE [dbo].[HadithSourceSystem] SET [authority]=N'approved',[reference]=N'urn:example:forged';",
        ],
        [
          'HadithActivation INSERT',
          "INSERT INTO [dbo].[HadithActivation] ([collectionId],[authority],[authorisedBy]) SELECT [id],N'approved',N'forged' FROM [dbo].[HadithCollection];",
        ],
        ['HadithActivation DELETE', 'DELETE FROM [dbo].[HadithActivation];'],
        ['Hadith text UPDATE', 'UPDATE [dbo].[Hadith] SET [text]=[text];'],
        ['Hadith DELETE', 'DELETE FROM [dbo].[Hadith];'],
        ['HadithRevision DELETE', 'DELETE FROM [dbo].[HadithRevision];'],
        ['HadithGrading UPDATE', 'UPDATE [dbo].[HadithGrading] SET [label]=[label];'],
        ['HadithVerification DELETE', 'DELETE FROM [dbo].[HadithVerification];'],
        [
          'HadithCitation UPDATE',
          "UPDATE [dbo].[HadithCitation] SET [state]=N'withdrawn';",
        ],
        ['HadithConflict DELETE', 'DELETE FROM [dbo].[HadithConflict];'],
        [
          'HadithBook reference UPDATE',
          'UPDATE [dbo].[HadithBook] SET [reference]=[reference];',
        ],
        [
          'HadithDetectConflicts EXECUTE',
          "EXEC [dbo].[HadithDetectConflicts] @hadithId=N'none', @at='2026-10-03T00:00:00';",
        ],
        [
          'HadithAssertCanonicalAuthority EXECUTE',
          `EXEC [dbo].[HadithAssertCanonicalAuthority] @actorId=N'${fixture.accountId}', @sessionId=N'none', @stepUpGrantId=N'none';`,
        ],
        [
          'HadithCommentary slug UPDATE',
          'UPDATE [dbo].[HadithCommentary] SET [slug]=[slug];',
        ],
        ['HadithTranslation DELETE', 'DELETE FROM [dbo].[HadithTranslation];'],
        [
          'HadithTranslation re-parent UPDATE',
          'UPDATE [dbo].[HadithTranslation] SET [hadithId]=[hadithId];',
        ],
        ['HadithTopic UPDATE', 'UPDATE [dbo].[HadithTopic] SET [topicId]=[topicId];'],
        ['Hadith ALTER', 'ALTER TABLE [dbo].[Hadith] ADD [probe] INT NULL;'],
        // Phase 20. A restored runtime can neither open the service, write a
        // ruling, its history, a question or a read count directly, probe who
        // holds a Fatwa key through the internal authority check, re-slug or
        // erase a category, nor alter a Fatwa table.
        [
          'FatwaActivation INSERT',
          "INSERT INTO [dbo].[FatwaActivation] ([id],[authority],[authorisedBy],[reference]) VALUES (2,N'approved',N'forged',N'urn:example:forged');",
        ],
        ['FatwaActivation DELETE', 'DELETE FROM [dbo].[FatwaActivation];'],
        ['Fatwa UPDATE', 'UPDATE [dbo].[Fatwa] SET [withdrawnAt]=SYSUTCDATETIME();'],
        ['Fatwa DELETE', 'DELETE FROM [dbo].[Fatwa];'],
        ['FatwaRevision UPDATE', 'UPDATE [dbo].[FatwaRevision] SET [ruling]=[ruling];'],
        ['FatwaPublication DELETE', 'DELETE FROM [dbo].[FatwaPublication];'],
        ['FatwaQuestion UPDATE', 'UPDATE [dbo].[FatwaQuestion] SET [assigneeId]=NULL;'],
        ['FatwaReadTally UPDATE', 'UPDATE [dbo].[FatwaReadTally] SET [reads]=[reads]+1;'],
        [
          'FatwaAssertPermission EXECUTE',
          `EXEC [dbo].[FatwaAssertPermission] @actorId=N'${fatwaFixture.publisherId}', @permission=N'fatwa.publish';`,
        ],
        ['FatwaCategory slug UPDATE', 'UPDATE [dbo].[FatwaCategory] SET [slug]=[slug];'],
        ['FatwaCategory DELETE', 'DELETE FROM [dbo].[FatwaCategory];'],
        ['Fatwa ALTER', 'ALTER TABLE [dbo].[Fatwa] ADD [probe] INT NULL;'],
        // Phase 21. A restored runtime can neither rewrite or erase consent
        // evidence, delete a subscription or rewrite its digest, repoint a saved
        // item or a history row at another target or account, rewrite a
        // notification's destination, delete the content a person saved, nor
        // alter a Personalisation table.
        [
          'NewsletterConsentEvent UPDATE',
          "UPDATE [dbo].[NewsletterConsentEvent] SET [event]=N'confirmed';",
        ],
        ['NewsletterConsentEvent DELETE', 'DELETE FROM [dbo].[NewsletterConsentEvent];'],
        ['NewsletterSubscriber DELETE', 'DELETE FROM [dbo].[NewsletterSubscriber];'],
        [
          'NewsletterSubscriber digest UPDATE',
          'UPDATE [dbo].[NewsletterSubscriber] SET [emailDigest]=[emailDigest];',
        ],
        ['SavedItem UPDATE', 'UPDATE [dbo].[SavedItem] SET [userId]=[userId];'],
        [
          'ReadingHistory target UPDATE',
          'UPDATE [dbo].[ReadingHistory] SET [articleId]=[articleId];',
        ],
        [
          'Notification destination UPDATE',
          'UPDATE [dbo].[Notification] SET [destination]=[destination];',
        ],
        [
          'Saved Work DELETE',
          `DELETE FROM [dbo].[Work] WHERE [id]=N'${libraryFixture.workId}';`,
        ],
        ['SavedItem ALTER', 'ALTER TABLE [dbo].[SavedItem] ADD [probe] INT NULL;'],
        [
          'NewsletterConsentEvent ALTER',
          'ALTER TABLE [dbo].[NewsletterConsentEvent] ADD [probe] INT NULL;',
        ],
        // Phase 22. A restored runtime can neither delete a Course or a path,
        // rewrite a Course's identifier, free a reserved slug, move a lesson to
        // another Course or module, edit a person's enrolment, progress or trial
        // request, delete the teacher a Course names, nor alter a Learning table.
        ['Course DELETE', 'DELETE FROM [dbo].[Course];'],
        ['Course id UPDATE', 'UPDATE [dbo].[Course] SET [id]=[id];'],
        ['LearningPath DELETE', 'DELETE FROM [dbo].[LearningPath];'],
        ['CourseSlugHistory DELETE', 'DELETE FROM [dbo].[CourseSlugHistory];'],
        [
          'LearningPathSlugHistory UPDATE',
          'UPDATE [dbo].[LearningPathSlugHistory] SET [pathId]=[pathId];',
        ],
        ['Lesson module UPDATE', 'UPDATE [dbo].[Lesson] SET [moduleId]=[moduleId];'],
        ['Enrolment UPDATE', 'UPDATE [dbo].[Enrolment] SET [courseId]=[courseId];'],
        [
          'LessonProgress UPDATE',
          'UPDATE [dbo].[LessonProgress] SET [completedAt]=[completedAt];',
        ],
        [
          'TrialClassRequest UPDATE',
          'UPDATE [dbo].[TrialClassRequest] SET [courseId]=[courseId];',
        ],
        [
          'Teacher Person DELETE',
          `DELETE FROM [dbo].[Person] WHERE [id]=N'${peopleFixture.linkedPersonId}';`,
        ],
        ['Course ALTER', 'ALTER TABLE [dbo].[Course] ADD [probe] INT NULL;'],
        [
          'LessonProgress ALTER',
          'ALTER TABLE [dbo].[LessonProgress] ADD [probe] INT NULL;',
        ],
        // Phase 23. A restored runtime can neither switch live learning on or
        // off, erase a teaching scope or a session, re-point a Booking at
        // another learner, session or window, nor alter a live-class table.
        [
          'LiveLearningActivation INSERT',
          "INSERT INTO [dbo].[LiveLearningActivation] ([id],[authority],[authorisedBy],[reference]) VALUES (2,N'approved',N'forged',N'urn:example:forged');",
        ],
        ['LiveLearningActivation DELETE', 'DELETE FROM [dbo].[LiveLearningActivation];'],
        [
          'CourseTeachingAssignment DELETE',
          'DELETE FROM [dbo].[CourseTeachingAssignment];',
        ],
        ['ClassSession DELETE', 'DELETE FROM [dbo].[ClassSession];'],
        ['Booking learner UPDATE', 'UPDATE [dbo].[Booking] SET [userId]=[userId];'],
        ['Booking session UPDATE', 'UPDATE [dbo].[Booking] SET [sessionId]=[sessionId];'],
        [
          'Booking window UPDATE',
          'UPDATE [dbo].[Booking] SET [availabilityId]=[availabilityId];',
        ],
        [
          'LiveLearningActivation ALTER',
          'ALTER TABLE [dbo].[LiveLearningActivation] ADD [probe] INT NULL;',
        ],
        [
          'CourseTeachingAssignment ALTER',
          'ALTER TABLE [dbo].[CourseTeachingAssignment] ADD [probe] INT NULL;',
        ],
        ['Availability ALTER', 'ALTER TABLE [dbo].[Availability] ADD [probe] INT NULL;'],
        ['ClassSession ALTER', 'ALTER TABLE [dbo].[ClassSession] ADD [probe] INT NULL;'],
        ['Booking ALTER', 'ALTER TABLE [dbo].[Booking] ADD [probe] INT NULL;'],
        ['Attendance ALTER', 'ALTER TABLE [dbo].[Attendance] ADD [probe] INT NULL;'],
        [
          'ClassCommunicationIntent ALTER',
          'ALTER TABLE [dbo].[ClassCommunicationIntent] ADD [probe] INT NULL;',
        ],
        // Phase 24. A restored runtime can neither switch a kind of messaging
        // on or off, rewrite a message, re-point a report, re-bind an asset's
        // release digest, erase a report or a decision, nor alter a Messaging
        // table.
        [
          'MessagingActivation INSERT',
          "INSERT INTO [dbo].[MessagingActivation] ([capability],[authority],[authorisedBy],[reference]) VALUES (N'group',N'approved',N'forged',N'urn:example:forged');",
        ],
        ['MessagingActivation DELETE', 'DELETE FROM [dbo].[MessagingActivation];'],
        ['Message body UPDATE', 'UPDATE [dbo].[Message] SET [body]=[body];'],
        [
          'Message sender UPDATE',
          'UPDATE [dbo].[Message] SET [senderUserId]=[senderUserId];',
        ],
        [
          'MessagingReport target UPDATE',
          'UPDATE [dbo].[MessagingReport] SET [messageId]=[messageId];',
        ],
        ['MessagingReport DELETE', 'DELETE FROM [dbo].[MessagingReport];'],
        [
          'runtime UPDATE of Asset.releaseDigest',
          'UPDATE [dbo].[Asset] SET [releaseDigest]=[releaseDigest];',
        ],
        [
          'MessagingModerationDecision DELETE',
          'DELETE FROM [dbo].[MessagingModerationDecision];',
        ],
        [
          'MessagingModerationDecision UPDATE',
          'UPDATE [dbo].[MessagingModerationDecision] SET [action]=[action];',
        ],
        ...(
          [
            'MessagingActivation',
            'Conversation',
            'ConversationParticipant',
            'Message',
            'MessageAttachment',
            'MessageReadState',
            'MessagingBlock',
            'MessagingReport',
            'MessagingModerationDecision',
          ] as const
        ).map((table): [string, string] => [
          `${table} ALTER`,
          `ALTER TABLE [dbo].[${table}] ADD [probe] INT NULL;`,
        ]),
        // Phase 26. A restored runtime can neither erase a type, its words, an
        // application or a Membership, re-point an application or a Membership
        // at another account, type or approval, re-key a type's words or owed
        // mail, catalogue a Membership key, nor alter a Membership table.
        ['MembershipType DELETE', 'DELETE FROM [dbo].[MembershipType];'],
        [
          'MembershipType primary locale UPDATE',
          'UPDATE [dbo].[MembershipType] SET [primaryLocale]=[primaryLocale];',
        ],
        [
          'MembershipTypeTranslation DELETE',
          'DELETE FROM [dbo].[MembershipTypeTranslation];',
        ],
        [
          'MembershipTypeTranslation locale UPDATE',
          'UPDATE [dbo].[MembershipTypeTranslation] SET [locale]=[locale];',
        ],
        ['MembershipApplication DELETE', 'DELETE FROM [dbo].[MembershipApplication];'],
        [
          'MembershipApplication applicant UPDATE',
          'UPDATE [dbo].[MembershipApplication] SET [applicantUserId]=[applicantUserId];',
        ],
        ['Membership DELETE', 'DELETE FROM [dbo].[Membership];'],
        [
          'Membership member UPDATE',
          'UPDATE [dbo].[Membership] SET [memberUserId]=[memberUserId];',
        ],
        [
          'Membership source application UPDATE',
          'UPDATE [dbo].[Membership] SET [sourceApplicationId]=[sourceApplicationId];',
        ],
        [
          'MembershipCommunicationIntent recipient UPDATE',
          'UPDATE [dbo].[MembershipCommunicationIntent] SET [recipientUserId]=[recipientUserId];',
        ],
        [
          'membership.* Permission INSERT',
          "INSERT INTO [dbo].[Permission] ([key],[description]) VALUES (N'membership.finance',N'forged');",
        ],
        ...(
          [
            'MembershipType',
            'MembershipTypeTranslation',
            'MembershipApplication',
            'Membership',
            'MembershipCommunicationIntent',
          ] as const
        ).map((table): [string, string] => [
          `${table} ALTER`,
          `ALTER TABLE [dbo].[${table}] ADD [probe] INT NULL;`,
        ]),
        ['DDL', 'CREATE TABLE [dbo].[ShouldNotExist] ([id] INT NOT NULL);'],
      ];

      for (const [label, statement] of forbidden) {
        try {
          await app.query(statement);
          fail(`Restored database PERMITTED ${label} to the runtime principal.`);
        } catch (error) {
          const number = (error as { number?: number }).number;
          // 229/230 = denied on object; 262 = denied in database. An ALTER on a
          // table the runtime can SELECT answers 1088 — the object is visible,
          // so "cannot find" can only mean the ALTER permission is missing.
          const denials = label.endsWith(' ALTER')
            ? [229, 230, 262, 1088]
            : [229, 230, 262];
          if (number === undefined || !denials.includes(number)) {
            fail(
              `Restored ${label} was rejected for the WRONG reason ` +
                `(error ${number ?? 'unknown'}): ${(error as Error).message.split('\n')[0]}`,
            );
          }
          report(`restored ${label}`, `denied, SQL Server error ${number}`);
        }
      }

      // The populated state is exactly as restored after those attempts.
      await verifyRestoredPhase2(restored, fixture);
      await verifyRestoredPhase3b(restored, taxonomyFixture);
      await verifyRestoredPhase5(restored, peopleFixture);
      await verifyRestoredPhase6(restored, editorialFixture, editorialSnapshot);
      await verifyRestoredPhase8(restored, libraryFixture, librarySnapshot);
      await verifyRestoredPhase9(restored, scholarlyFixture, scholarlySnapshot);
      await verifyRestoredPhase10(restored, mediaFixture, mediaSnapshot);
      await verifyRestoredPhase11(restored, audioFixture, audioSnapshot);
      await verifyRestoredPhase12(restored, photoFixture, photoSnapshot);
      await verifyRestoredPhase13(restored, newsFixture, newsSnapshot);
      await verifyRestoredPhase16(restored, globalFixture, globalSnapshot);
      await verifyRestoredPhase14(restored, eventFixture, eventSnapshot, eventReferences);
      await verifyRestoredPhase15(
        restored,
        collectionFixture,
        collectionSnapshot,
        collectionReferences,
      );
      await verifyRestoredPhase18(restored, quranFixture, quranSnapshot, quranReferences);
      await verifyRestoredPhase19(
        restored,
        hadithFixture,
        hadithSnapshot,
        hadithReferences,
      );
      await verifyRestoredPhase20(restored, fatwaFixture, fatwaSnapshot, fatwaReferences);
      await verifyRestoredPhase21(
        restored,
        personalFixture,
        personalSnapshot,
        personalReferences,
      );
      await verifyRestoredPhase22(
        restored,
        learningFixture,
        learningSnapshot,
        learningReferences,
      );

      // Phase 23. The meeting address is readable by the restored runtime —
      // SELECT is the one verb it holds for the disclosure operation — while a
      // terminal session can never carry one: the UPDATE is refused by the
      // session CHECK, not by a grant, so the proof names the constraint.
      const [disclosed] = await app.query<{ meetingUrl: string | null }>(
        `SELECT [meetingUrl] FROM [dbo].[ClassSession] WHERE [id]=N'${classesFixture.trialSessionId}';`,
      );
      if (disclosed?.meetingUrl !== 'https://meet.google.com/abc-defg-hij') {
        fail(
          'The restored runtime could not read the scheduled session meeting address.',
        );
      }
      try {
        await app.query(
          `UPDATE [dbo].[ClassSession] SET [meetingProvider]=N'google-meet',[meetingUrl]=N'https://meet.google.com/abc-defg-hij' WHERE [id]=N'${classesFixture.cancelledSessionId}';`,
        );
        fail('Restored database PERMITTED a meeting address on a cancelled session.');
      } catch (error) {
        const number = (error as { number?: number }).number;
        const message = (error as Error).message;
        if (number !== 547 || !message.includes('ClassSession_ck')) {
          fail(
            `Restored ClassSession meetingUrl on terminal session UPDATE was rejected for the ` +
              `WRONG reason (error ${number ?? 'unknown'}): ${message.split('\n')[0]}`,
          );
        }
        report(
          'restored ClassSession meetingUrl on terminal session UPDATE',
          'refused by ClassSession_ck, SQL Server error 547',
        );
      }
      await verifyRestoredPhase23(
        restored,
        classesFixture,
        classesSnapshot,
        classesReferences,
      );
      await verifyRestoredPhase24(
        restored,
        messagingFixture,
        messagingSnapshot,
        messagingReferences,
      );

      // Phase 26. The restored runtime holds UPDATE on a Membership's closure,
      // so reopening the closed Membership is refused by the restored trigger
      // itself (51324), not by a grant — proof the lifecycle came back armed.
      try {
        await app.query(
          `UPDATE [dbo].[Membership] SET [status]=N'active',[closureSource]=NULL,[closedAt]=NULL,[version]=[version]+1 WHERE [id]=N'${membershipFixture.closedId}';`,
        );
        fail('Restored database PERMITTED a closed Membership to reopen.');
      } catch (error) {
        const number = (error as { number?: number }).number;
        if (number !== 51324) {
          fail(
            `Restored closed Membership reopen was rejected for the WRONG reason ` +
              `(error ${number ?? 'unknown'}): ${(error as Error).message.split('\n')[0]}`,
          );
        }
        report(
          'restored Membership reopen',
          'refused by MembershipIntegrity, error 51324',
        );
      }
      await verifyRestoredPhase26(restored, membershipFixture, membershipSnapshot);
      report('fixture intact', 'unchanged after UPDATE/DELETE/DDL attempts');

      // Phase 17. The full-text catalogue and index live INSIDE the database,
      // so a restore must bring them back queryable — the projection itself is
      // derived and is rebuilt from the restored owners, but the engine objects
      // it is rebuilt into are schema. And the restored runtime must still be
      // unable to switch the index off.
      const [fullText] = await restored.query<{ catalogs: number; indexes: number }>(`
        SELECT (SELECT COUNT(*) FROM sys.fulltext_catalogs WHERE [name] = N'SearchCatalog') AS catalogs,
               (SELECT COUNT(*) FROM sys.fulltext_indexes
                 WHERE [object_id] = OBJECT_ID(N'[dbo].[SearchDocument]')) AS indexes;
      `);
      if (Number(fullText?.catalogs) !== 1 || Number(fullText?.indexes) !== 1) {
        fail('The full-text catalogue or index did not survive the restore.');
      }
      await app.query(
        `SELECT COUNT_BIG(*) AS total FROM CONTAINSTABLE([dbo].[SearchDocument], [matchEnglish], N'"restored"', LANGUAGE 1033, 10);`,
      );
      try {
        await app.query('DROP FULLTEXT INDEX ON [dbo].[SearchDocument];');
        fail(
          'Restored database PERMITTED the runtime principal to drop the full-text index.',
        );
      } catch (error) {
        const number = (error as { number?: number }).number;
        // 7658 is the engine's own refusal for full-text DDL; the successful
        // query above proves the index exists, so it can only mean permission.
        if (number !== 7658) {
          fail(
            `Restored full-text DROP was rejected for the WRONG reason (error ${number ?? 'unknown'}).`,
          );
        }
      }
      report(
        'restored full-text search',
        'catalogue and index restored, queryable, not droppable',
      );
    } finally {
      await app?.close();
    }
  } else {
    report(
      'restored runtime checks',
      'not exercised: server-level login mapping absent (reported, not hidden)',
    );
  }

  process.stdout.write(
    '\nPopulated recovery verified: representative rows in every Phase-2,\n' +
      'Phase-3B, Phase-5, Phase-6, Phase-8, Phase-9 and Phase-10 tables were backed up, restored into a separate\n' +
      'database, and checked value by value — together with referential\n' +
      'integrity, the topic hierarchy, the four distinct contributor profile\n' +
      'aggregates and their independent lifecycles, the optional account link,\n' +
      'non-Latin script, the trusted constraints and their invariant triggers,\n' +
      'the complete migration history and the least-privilege posture of the\n' +
      'restored runtime principal.\n' +
      'Cleanup is verified below; this run passes only if it also succeeds.\n\n',
  );
} catch (error) {
  // Held rather than rethrown, so cleanup still runs and a cleanup problem
  // cannot replace the reason the rehearsal actually failed.
  recoveryError = error;
} finally {
  // ---- cleanup, in dependency order ----------------------------------------
  //
  // The SHARED helper runs first and owns the restore database, the artifact
  // and both sessions. The artifact can only be deleted through a session on
  // the source, so the source session has to still be open when it runs —
  // which is why the source database is not dropped before it.
  cleanupOutcome = await cleanUpRecoveryResources({
    master,
    source: admin,
    restored,
    restoreDatabase,
    backupPath: target.path,
  });

  // The disposable SOURCE is this command's own, and only this command removes
  // it. It needs a session of its own because the helper above closed both of
  // the ones this run had — and a drop attempted on a closed connection would
  // report a failure that says nothing about whether the database is still
  // there. `dropDisposableDatabase` re-validates the name and rolls back stray
  // sessions, so it cannot hang and cannot touch anything else.
  let finalMaster: SqlSession | undefined;

  try {
    finalMaster = await openMasterSession(command.connection);
    await dropDisposableDatabase(finalMaster, sourceDatabase);
    cleanupOutcome.succeeded.push(`source database: dropped ${sourceDatabase}`);

    // Verified INDEPENDENTLY of the drop: a DROP that reported success and
    // left the database in place is exactly what this catches. An inspection
    // that cannot answer is a failure, never a clean result.
    const rows = await finalMaster.query<{ present: number | null }>(
      `SELECT CASE WHEN DB_ID(N'${sourceDatabase}') IS NULL THEN 0 ELSE 1 END AS present;`,
    );
    const present = rows.length === 1 ? rows[0]?.present : undefined;

    if (present === null || present === undefined) {
      sourceFailures.push({
        step: 'source database residue',
        detail: `the residue inspection did not answer; ${sourceDatabase} is in an unknown state`,
      });
    } else if (present !== 0) {
      sourceFailures.push({
        step: 'source database residue',
        detail: `${sourceDatabase} still exists after the drop attempt`,
      });
    } else {
      cleanupOutcome.succeeded.push(
        `source residue: ${sourceDatabase} absent, DB_ID is NULL`,
      );
    }
  } catch (error) {
    sourceFailures.push({
      step: 'source database',
      detail: (error as Error).message.split('\n')[0] ?? 'unknown',
    });
  } finally {
    try {
      await finalMaster?.close();
      cleanupOutcome.succeeded.push('source cleanup session close: closed');
    } catch (error) {
      sourceFailures.push({
        step: 'source cleanup session close',
        detail: (error as Error).message.split('\n')[0] ?? 'unknown',
      });
    }
  }

  cleanupOutcome.failures.push(...sourceFailures);
}

for (const step of cleanupOutcome.succeeded) {
  const [name, detail] = step.split(': ');
  report(`cleanup: ${name}`, detail ?? '');
}
for (const failure of cleanupOutcome.failures) {
  report(`CLEANUP FAILED: ${failure.step}`, failure.detail);
}

const cleanupError =
  cleanupOutcome.failures.length > 0
    ? new RecoveryCleanupError(cleanupOutcome.failures)
    : undefined;

if (recoveryError !== undefined && cleanupError !== undefined) {
  throw new AggregateError(
    [recoveryError, cleanupError],
    `The populated recovery rehearsal failed AND cleanup did not complete.\n` +
      `Primary failure: ${(recoveryError as Error).message}\n` +
      `${cleanupError.message}`,
  );
}
if (recoveryError !== undefined) throw recoveryError;
if (cleanupError !== undefined) throw cleanupError;

process.stdout.write(
  '\nCleanup verified: no source database, no restore database, no backup artifact.\n',
);
