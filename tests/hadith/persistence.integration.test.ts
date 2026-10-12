import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  getApplicationPrincipalCredentials,
  getDatabaseRuntimeUrl,
} from '../../packages/database/src/config.ts';
import { provisionApplicationPrincipal } from '../../packages/database/src/lifecycle/application-principal.ts';
import {
  assertApprovedLocalTarget,
  localTargetPolicy,
} from '../../packages/database/src/lifecycle/local-target.ts';
import {
  openSession,
  parseSqlServerUrl,
  type SqlSession,
} from '../../packages/database/src/lifecycle/sql-connection.ts';
import {
  HADITH_LIMITS,
  type GradingValue,
  type HadithCanonicalAuthority,
  type HadithCanonicalPort,
  type HadithPersistencePort,
  type HadithPublicReaderPort,
  type RecordCorrectionValue,
  type RecordCreateValue,
} from '../../packages/contracts/src/hadith/index.ts';
import type { PrivilegedActor } from '../../packages/contracts/src/identity/index.ts';
import {
  createHadithCanonicalService,
  createHadithService,
  type HadithCanonicalLogDetail,
  type HadithService,
} from '../../apps/web/src/contexts/hadith/index.ts';
import {
  createProofDatabase,
  databaseConfigured,
  type DisposableDatabase,
} from '../identity/harness.ts';
import {
  accountWith,
  accountWithRole,
  activate,
  citationIdOf,
  count,
  deactivateAll,
  grantFor,
  intents,
  n,
  NEUTRAL,
  person,
  registerEdition,
  registerSourceSystem,
  sentinel,
  sessionFor,
  topic,
  utf16,
} from './fixture-sql.ts';

/**
 * Phase 19 — the Hadith adapter and services over a REAL SQL Server, running
 * as the REAL least-privilege RUNTIME principal.
 *
 * WHAT ONLY THE DATABASE CAN PROVE: that the runtime principal can write no
 * source, edition, activation or canonical row except through the procedures;
 * that every procedure re-verifies the live `hadith.editCanonical` assignment
 * and an unexpired `hadith-canonical-edit` grant bound to THIS session, even
 * when the application layer has already said yes; that a record's identity is
 * its collection, source system, edition and source reference — so one
 * apparent number coexists across editions and collections; that text, chain
 * and gradings are kept byte for byte and conflicts are detected byte for byte;
 * that verification binds one version; that the citation mapping obeys its
 * rules under concurrency; that THE PUBLIC RULE holds for every public read in
 * every mode; and that audit and search intent commit with the change.
 *
 * TWO CONNECTIONS, TWO ROLES. The owner/migration session registers what only
 * an operator may register — source systems, editions, activation, accounts,
 * grants, People and Topics. EVERYTHING the application does goes through the
 * adapter (directly or through the Hadith services), whose Prisma client is
 * bound to the provisioned RUNTIME principal.
 *
 * NOTHING HERE IS A HADITH (see `./fixture-sql.ts`).
 */

const live = databaseConfigured ? describe : describe.skip;

const reasonOf = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise;
  } catch (error) {
    const reason = (error as { reason?: unknown } | null)?.reason;
    return typeof reason === 'string' ? reason : 'unclassified';
  }
  return 'accepted';
};

/** Recovers an SQL Server error number from a driver error, or null. */
const sqlNumber = async (promise: Promise<unknown>): Promise<number | null> => {
  try {
    await promise;
  } catch (error) {
    const number = (error as { number?: unknown } | null)?.number;
    return typeof number === 'number' ? number : null;
  }
  return null;
};

/* ===========================================================================
 * Exact-text sentinels
 * ========================================================================= */

const ZWJ = '\u200D';
const ZWNJ = '\u200C';
const BEH_FATHA = 'بَ';
const BEH_KASRA = 'بِ';

/** Combining marks, joiners and doubled inner spaces: every byte must survive. */
const TEXT_1 = `${sentinel('TEXT', 1)}  ${NEUTRAL} ${BEH_FATHA}${ZWJ}ب${ZWNJ}${BEH_KASRA}  ${sentinel('TEXT', 1)}`;
const CHAIN_1 = `${sentinel('CHAIN', 1)} ${BEH_FATHA}${ZWNJ}ب   ${sentinel('CHAIN', 1)}`;
const GRADINGS_1: GradingValue[] = [
  {
    grader: `${sentinel('GRADER', 1)}${ZWNJ}${BEH_FATHA}`,
    label: `${sentinel('GRADING', 1)}  ${BEH_KASRA}`,
    labelLanguage: 'ar',
    reference: sentinel('REFERENCE', 31),
  },
  {
    grader: sentinel('GRADER', 2),
    label: sentinel('GRADING', 2),
    labelLanguage: 'en',
    reference: sentinel('REFERENCE', 32),
  },
];

/** Canonically equivalent, byte-different: precomposed \u00E9, and e + combining acute. */
const TEXT_NFC = `${sentinel('TEXT', 2)} caf\u00E9`;
const TEXT_NFD = `${sentinel('TEXT', 2)} cafe\u0301`;

/** The same apparent source reference, carried by several editions. */
const SHARED_REFERENCE = sentinel('REFERENCE', 7);

const TRANSLATION_1 = `${sentinel('TRANSLATION', 1)}  inner  spacing kept`;

/** The public attribution of an edition registered by `registerEdition`. */
const attributionOf = (source: string, edition: string) => ({
  sourceSystemTitle: `NON_HADITH_FIXTURE source ${source}`,
  editionTitle: `NON_HADITH_FIXTURE edition ${edition}`,
  editionCode: edition,
});
const EDITION_A1 = attributionOf(
  'NON_HADITH_FIXTURE_SOURCE_A',
  'NON_HADITH_FIXTURE_EDITION_A1',
);
const EDITION_A2 = attributionOf(
  'NON_HADITH_FIXTURE_SOURCE_B',
  'NON_HADITH_FIXTURE_EDITION_A2',
);

live('Phase 19 Hadith against real SQL Server, as the runtime principal', () => {
  let db: DisposableDatabase;
  /** The runtime principal on the disposable database, for direct denial proofs. */
  let app: SqlSession;
  let persistence: HadithPersistencePort;
  let reader: HadithPublicReaderPort;
  let canonical: HadithCanonicalPort;
  let hadith: HadithService;
  let canonicalService: ReturnType<typeof createHadithCanonicalService>;
  const logged: HadithCanonicalLogDetail[] = [];

  let fixtureA: string;
  let fixtureB: string;
  let approvedSource: string;

  let editor: HadithCanonicalAuthority;
  let wrongPurposeQuran: HadithCanonicalAuthority;
  let wrongPurposePrivilege: HadithCanonicalAuthority;
  let expired: HadithCanonicalAuthority;
  let otherSession: HadithCanonicalAuthority;
  let ungranted: HadithCanonicalAuthority;
  let unheld: HadithCanonicalAuthority;
  let revoked: HadithCanonicalAuthority;

  /** An administrator: `hadith.read` and `hadith.administer`, nothing canonical. */
  let administrator: { accountId: string };
  let translator: string;
  let topicId: string;

  /** Identity's verdict, as the canonical service receives it — "yes". */
  const privileged = (authority: HadithCanonicalAuthority): PrivilegedActor => ({
    authorisation: 'verified',
    accountId: authority.actorId,
    sessionId: authority.sessionId,
    permission: 'hadith.editCanonical',
    stepUp: 'hadith-canonical-edit',
    stepUpGrantId: authority.stepUpGrantId,
  });

  /* ---- what the proofs build -------------------------------------------- */

  const ids = {
    collectionA: '',
    collectionB: '',
    collectionC: '',
    editionA1: '',
    editionA2: '',
    editionB1: '',
    editionC: '',
    editionCFixture: '',
    bookA1: '',
    bookA1Second: '',
    bookA2: '',
    bookB1: '',
    bookC: '',
    bookCFixture: '',
    chapterA1: '',
    r1: '',
    r2: '',
    rB: '',
    rNfc: '',
    rNfd: '',
    rC: '',
    rCFixture: '',
    citationA1: '',
    citationB1: '',
    translation: '',
    conflictedTranslation: '',
    commentary: '',
    science: '',
  };

  const SLUG = {
    a: 'fixture-collection-a',
    b: 'fixture-collection-b',
    c: 'fixture-collection-c',
    bookA1: 'fixture-book-a',
    bookA1Second: 'fixture-book-a-two',
    bookA2: 'fixture-book-b',
    chapterA1: 'fixture-chapter-a',
    commentary: 'fixture-commentary-a',
    commentaryApproved: 'fixture-commentary-c',
    science: 'fixture-science-a',
    scienceApproved: 'fixture-science-c',
  };

  const record = (
    over: Pick<
      RecordCreateValue,
      'editionId' | 'sourceReference' | 'citationNumber' | 'bookId'
    > &
      Partial<RecordCreateValue>,
  ): RecordCreateValue => ({
    chapterId: null,
    text: `${sentinel('TEXT', 9)} ${NEUTRAL}`,
    textLanguage: 'ar',
    chain: null,
    chainLanguage: null,
    gradings: [],
    evidence: sentinel('EVIDENCE', 1),
    ...over,
  });

  /** The record's current facts, as a correction under its current version. */
  async function correctionOf(
    id: string,
    change: Partial<RecordCorrectionValue>,
  ): Promise<RecordCorrectionValue> {
    const current = await persistence.record(id);
    if (current === null) throw new Error('fixture record missing');
    return {
      id,
      expectedVersion: current.version,
      sourceReference: current.sourceReference,
      citationNumber: current.citationNumber,
      bookId: current.bookId,
      chapterId: current.chapterId,
      text: current.text,
      textLanguage: current.textLanguage,
      chain: current.chain,
      chainLanguage: current.chainLanguage,
      gradings: current.gradings.map((grading) => ({
        grader: grading.grader,
        label: grading.label,
        labelLanguage: grading.labelLanguage,
        reference: grading.reference,
      })),
      evidence: sentinel('EVIDENCE', 2),
      reason: 'NON_HADITH_FIXTURE correction against a registered fixture source',
      ...change,
    };
  }

  async function verify(id: string): Promise<void> {
    const current = await persistence.record(id);
    if (current === null) throw new Error('fixture record missing');
    await canonical.verifyRecord({
      authority: editor,
      value: { id, expectedVersion: current.version, evidence: sentinel('EVIDENCE', 3) },
    });
  }

  async function facetsOf(collectionId: string, number: number): Promise<string[]> {
    const rows = await db.admin.query<{ facets: string }>(
      `SELECT [facets] FROM [dbo].[HadithConflict] WHERE [collectionId] = ${n(collectionId)} AND [citationNumber] = ${number} ORDER BY [detectedAt],[id];`,
    );
    return rows.map((row) => row.facets);
  }

  beforeAll(async () => {
    // The runtime URL is read BEFORE the harness repoints `DATABASE_URL` at the
    // migration principal, then repointed at the disposable database — and
    // POSITIVELY proved to be the runtime principal on a disposable target.
    const runtimeSource = getDatabaseRuntimeUrl();
    db = await createProofDatabase();
    const runtimeTarget = parseSqlServerUrl(runtimeSource);
    const runtimeUrl = runtimeSource.replace(
      `database=${runtimeTarget.database}`,
      `database=${db.name}`,
    );
    if (runtimeUrl === runtimeSource)
      throw new Error(
        'The runtime URL could not be repointed at the disposable database.',
      );
    const connection = assertApprovedLocalTarget(
      runtimeUrl,
      localTargetPolicy(process.env, 'disposable', 'runtime'),
    );

    const principal = getApplicationPrincipalCredentials();
    await provisionApplicationPrincipal(
      db.admin,
      principal.DATABASE_APP_LOGIN,
      principal.DATABASE_APP_PASSWORD,
    );
    app = await openSession(connection);
    process.env['DATABASE_URL'] = runtimeUrl;

    const database = await import('../../packages/database/src/index.ts');
    const { createAuthorizationReader } =
      await import('../../packages/database/src/adapters/identity-access/index.ts');
    const { createAuthorizationService } =
      await import('../../packages/server-core/src/authorization/index.ts');
    persistence = database.createHadithPersistence();
    reader = database.createHadithPublicReader();
    canonical = database.createHadithCanonical();
    const authorization = createAuthorizationService({
      reader: createAuthorizationReader(),
    });
    hadith = createHadithService({
      persistence,
      authority: {
        permits: (accountId, key) => authorization.hasPermission(accountId, key),
        // The administrative service never asks.
        verifyCanonical: async () => false,
      },
    });
    // Identity's live re-verification is the unit-proved first gate; here it
    // answers YES for every actor, so whatever is refused below is refused by
    // the DATABASE's own re-check of the same facts.
    canonicalService = createHadithCanonicalService({
      canonical,
      authority: { permits: async () => false, verifyCanonical: async () => true },
      log: {
        info: (detail) => logged.push(detail),
        warn: (detail) => logged.push(detail),
      },
    });

    fixtureA = await registerSourceSystem(db.admin, {
      code: 'NON_HADITH_FIXTURE_SOURCE_A',
      authority: 'fixture',
    });
    fixtureB = await registerSourceSystem(db.admin, {
      code: 'NON_HADITH_FIXTURE_SOURCE_B',
      authority: 'fixture',
    });
    approvedSource = await registerSourceSystem(db.admin, {
      code: 'NON_HADITH_FIXTURE_SOURCE_APPROVED',
      authority: 'approved',
    });

    const holder = await accountWith(db.admin, ['hadith.editCanonical']);
    const session = await sessionFor(db.admin, holder);
    const secondSession = await sessionFor(db.admin, holder);
    editor = {
      actorId: holder,
      sessionId: session,
      stepUpGrantId: await grantFor(db.admin, holder, session, 'hadith-canonical-edit'),
    };
    wrongPurposeQuran = {
      ...editor,
      stepUpGrantId: await grantFor(db.admin, holder, session, 'quran-canonical-edit'),
    };
    wrongPurposePrivilege = {
      ...editor,
      stepUpGrantId: await grantFor(
        db.admin,
        holder,
        session,
        'privilege-administration',
      ),
    };
    expired = {
      ...editor,
      stepUpGrantId: await grantFor(
        db.admin,
        holder,
        session,
        'hadith-canonical-edit',
        -5,
      ),
    };
    // A live grant, but presented with ANOTHER live session of the same account.
    otherSession = { ...editor, sessionId: secondSession };
    ungranted = { ...editor, stepUpGrantId: randomUUID() };

    // A live, correctly purposed grant — but no `hadith.editCanonical`.
    const administratorId = await accountWith(db.admin, [
      'hadith.read',
      'hadith.administer',
    ]);
    const administratorSession = await sessionFor(db.admin, administratorId);
    unheld = {
      actorId: administratorId,
      sessionId: administratorSession,
      stepUpGrantId: await grantFor(
        db.admin,
        administratorId,
        administratorSession,
        'hadith-canonical-edit',
      ),
    };
    administrator = { accountId: administratorId };

    // Held once, then revoked: the grant is live, the assignment is not.
    const former = await accountWithRole(db.admin, ['hadith.editCanonical']);
    const formerSession = await sessionFor(db.admin, former.accountId);
    revoked = {
      actorId: former.accountId,
      sessionId: formerSession,
      stepUpGrantId: await grantFor(
        db.admin,
        former.accountId,
        formerSession,
        'hadith-canonical-edit',
      ),
    };
    await db.admin.query(
      `UPDATE [dbo].[RoleAssignment] SET [revokedAt] = SYSUTCDATETIME() WHERE [userId] = ${n(former.accountId)} AND [roleId] = ${n(former.roleId)};`,
    );

    translator = await person(db.admin, `fixture-translator-${randomUUID().slice(0, 8)}`);
    topicId = await topic(
      db.admin,
      `non-hadith-fixture-topic-${randomUUID().slice(0, 8)}`,
    );
  }, 240_000);

  afterAll(async () => {
    await app?.close();
    await db?.close();
  });

  /* ======================================================================
   * The runtime principal's posture
   * ==================================================================== */

  describe('the runtime principal writes no source, activation or canonical row directly', () => {
    const OPERATOR_AND_CANONICAL = [
      'HadithSourceSystem',
      'HadithEdition',
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
    ];

    it.each(OPERATOR_AND_CANONICAL)('refuses INSERT into %s', async (table) => {
      expect(
        await sqlNumber(
          app.query(
            `INSERT INTO [dbo].[${table}] SELECT * FROM [dbo].[${table}] WHERE 1 = 0`,
          ),
        ),
      ).toBe(229);
    });

    it.each(OPERATOR_AND_CANONICAL)('refuses DELETE from %s', async (table) => {
      expect(await sqlNumber(app.query(`DELETE FROM [dbo].[${table}] WHERE 1 = 0`))).toBe(
        229,
      );
    });

    it.each([
      ['HadithSourceSystem', '[title] = [title]'],
      ['HadithEdition', '[title] = [title]'],
      ['HadithActivation', '[authority] = [authority]'],
      ['Hadith', '[text] = [text]'],
      ['Hadith', '[chain] = [chain]'],
      ['HadithRevision', '[text] = [text]'],
      ['HadithGrading', '[label] = [label]'],
      ['HadithVerification', '[version] = [version]'],
      ['HadithCitation', '[hadithId] = [hadithId]'],
      ['HadithConflict', '[facets] = [facets]'],
    ])('refuses UPDATE of %s (%s)', async (table, assignment) => {
      expect(
        await sqlNumber(
          app.query(`UPDATE [dbo].[${table}] SET ${assignment} WHERE 1 = 0`),
        ),
      ).toBe(229);
    });

    it('lets a structure advance only its display-names version, never a canonical fact', async () => {
      for (const [table, columns] of [
        ['HadithCollection', ['slug', 'position']],
        ['HadithBook', ['slug', 'reference', 'position', 'title', 'editionId']],
        ['HadithChapter', ['slug', 'reference', 'position', 'title', 'bookId']],
      ] as const)
        for (const column of columns)
          expect(
            await sqlNumber(
              app.query(
                `UPDATE [dbo].[${table}] SET [${column}] = [${column}] WHERE 1 = 0`,
              ),
            ),
            `${table}.${column}`,
          ).toBe(230);
      for (const table of ['HadithCollection', 'HadithBook', 'HadithChapter'])
        expect(
          await sqlNumber(
            app.query(
              `UPDATE [dbo].[${table}] SET [namesVersion] = [namesVersion] WHERE 1 = 0`,
            ),
          ),
        ).toBeNull();
      for (const table of ['HadithCommentary', 'HadithScience'])
        expect(
          await sqlNumber(
            app.query(`UPDATE [dbo].[${table}] SET [slug] = [slug] WHERE 1 = 0`),
          ),
        ).toBe(230);
    });

    it('cannot reach the authority check or conflict detection, which only the writing procedures call', async () => {
      expect(
        await sqlNumber(
          app.query(
            `EXEC [dbo].[HadithDetectConflicts] @hadithId = N'${randomUUID()}', @at = '2026-10-03T00:00:00'`,
          ),
        ),
      ).toBe(229);
      expect(
        await sqlNumber(
          app.query(
            `EXEC [dbo].[HadithAssertCanonicalAuthority] @actorId = ${n(editor.actorId)}, @sessionId = ${n(editor.sessionId)}, @stepUpGrantId = ${n(editor.stepUpGrantId)}`,
          ),
        ),
      ).toBe(229);
    });
  });

  /* ======================================================================
   * Canonical authority
   * ==================================================================== */

  describe('canonical authority, re-checked by the database', () => {
    it('refuses without a live hadith.editCanonical assignment and a purpose-bound, session-bound, unexpired grant', async () => {
      const refused = {
        'no permission': unheld,
        'a Quran step-up purpose': wrongPurposeQuran,
        'the privilege-administration purpose': wrongPurposePrivilege,
        'an expired grant': expired,
        'another session': otherSession,
        'no grant': ungranted,
        'a revoked assignment': revoked,
      };
      for (const [label, authority] of Object.entries(refused)) {
        expect(
          await reasonOf(
            canonical.createCollection({
              authority,
              value: { slug: SLUG.a, position: 0 },
            }),
          ),
          label,
        ).toBe('denied');
        // The application layer saying yes changes nothing.
        expect(
          await reasonOf(
            canonicalService.createCollection(privileged(authority), {
              slug: SLUG.a,
              position: 0,
            }),
          ),
          label,
        ).toBe('denied');
      }
      expect(await count(db.admin, 'HadithCollection')).toBe(0);
      expect(
        await count(db.admin, 'AuditLog', "[action] LIKE N'hadith.collection.%'"),
      ).toBe(0);
    });

    it('creates a collection through the canonical service, and audits it', async () => {
      const created = await canonicalService.createCollection(privileged(editor), {
        slug: SLUG.a,
        position: 0,
      });
      ids.collectionA = created.id;
      ids.collectionB = (
        await canonical.createCollection({
          authority: editor,
          value: { slug: SLUG.b, position: 1 },
        })
      ).id;
      ids.collectionC = (
        await canonical.createCollection({
          authority: editor,
          value: { slug: SLUG.c, position: 2 },
        })
      ).id;
      expect(
        await reasonOf(
          canonical.createCollection({
            authority: editor,
            value: { slug: SLUG.a, position: 5 },
          }),
        ),
      ).toBe('duplicate-slug');
      // A section path is refused by the schema, and by the database's CHECK.
      expect(
        await reasonOf(
          canonicalService.createCollection(privileged(editor), {
            slug: 'browse',
            position: 3,
          }),
        ),
      ).toBe('invalid');
      expect(
        await reasonOf(
          canonical.createCollection({
            authority: editor,
            value: { slug: 'browse', position: 3 },
          }),
        ),
      ).toBe('invalid');
      expect(await count(db.admin, 'HadithCollection')).toBe(3);
      expect(
        await count(
          db.admin,
          'AuditLog',
          `[action] = N'hadith.collection.created' AND [actorId] = ${n(editor.actorId)} AND [authorisingSource] = ${n(`step-up:${editor.stepUpGrantId}`)}`,
        ),
      ).toBe(3);
      // The service logs identifiers and outcomes only.
      expect(logged.some((detail) => detail.outcome === 'passed')).toBe(true);
      expect(JSON.stringify(logged)).not.toContain('NON_HADITH_FIXTURE');
    });
  });

  /* ======================================================================
   * Structure, in its own edition
   * ==================================================================== */

  describe('structure', () => {
    it('places every book in one registered edition and every chapter in one book', async () => {
      ids.editionA1 = await registerEdition(db.admin, {
        collectionId: ids.collectionA,
        sourceSystemId: fixtureA,
        code: 'NON_HADITH_FIXTURE_EDITION_A1',
      });
      ids.editionA2 = await registerEdition(db.admin, {
        collectionId: ids.collectionA,
        sourceSystemId: fixtureB,
        code: 'NON_HADITH_FIXTURE_EDITION_A2',
      });
      ids.editionB1 = await registerEdition(db.admin, {
        collectionId: ids.collectionB,
        sourceSystemId: fixtureA,
        code: 'NON_HADITH_FIXTURE_EDITION_B1',
      });
      ids.editionC = await registerEdition(db.admin, {
        collectionId: ids.collectionC,
        sourceSystemId: approvedSource,
        code: 'NON_HADITH_FIXTURE_EDITION_C',
      });
      ids.editionCFixture = await registerEdition(db.admin, {
        collectionId: ids.collectionC,
        sourceSystemId: fixtureA,
        code: 'NON_HADITH_FIXTURE_EDITION_C_FIXTURE',
      });

      const book = (
        editionId: string,
        slug: string,
        reference: string,
        position: number,
      ) =>
        canonical.createBook({
          authority: editor,
          value: {
            editionId,
            slug,
            reference,
            position,
            title: `NON_HADITH_FIXTURE book ${BEH_FATHA}`,
            titleLanguage: 'ar',
          },
        });
      ids.bookA1 = (
        await book(ids.editionA1, SLUG.bookA1, sentinel('REFERENCE', 1), 1)
      ).id;
      ids.bookA1Second = (
        await book(ids.editionA1, SLUG.bookA1Second, sentinel('REFERENCE', 2), 2)
      ).id;
      // The SAME source reference in another edition is another edition's book.
      ids.bookA2 = (
        await book(ids.editionA2, SLUG.bookA2, sentinel('REFERENCE', 1), 1)
      ).id;
      ids.bookB1 = (
        await book(ids.editionB1, SLUG.bookA1, sentinel('REFERENCE', 1), 1)
      ).id;
      ids.bookC = (await book(ids.editionC, SLUG.bookA1, sentinel('REFERENCE', 1), 1)).id;
      ids.bookCFixture = (
        await book(ids.editionCFixture, SLUG.bookA2, sentinel('REFERENCE', 1), 1)
      ).id;

      expect(
        await reasonOf(book(ids.editionA1, SLUG.bookA1, sentinel('REFERENCE', 9), 9)),
      ).toBe('duplicate-slug');
      expect(
        await reasonOf(
          book(ids.editionA1, 'fixture-book-x', sentinel('REFERENCE', 1), 9),
        ),
      ).toBe('duplicate-reference');
      expect(
        await reasonOf(
          book(ids.editionA1, 'fixture-book-y', sentinel('REFERENCE', 8), 1),
        ),
      ).toBe('duplicate-reference');
      expect(
        await reasonOf(book(randomUUID(), 'fixture-book-z', sentinel('REFERENCE', 8), 8)),
      ).toBe('not-found');
      // The book's collection is its edition's — never a caller's choice.
      const [placed] = await db.admin.query<{ collectionId: string }>(
        `SELECT [collectionId] FROM [dbo].[HadithBook] WHERE [id] = ${n(ids.bookA2)};`,
      );
      expect(placed?.collectionId).toBe(ids.collectionA);

      ids.chapterA1 = (
        await canonical.createChapter({
          authority: editor,
          value: {
            bookId: ids.bookA1,
            slug: SLUG.chapterA1,
            reference: sentinel('REFERENCE', 3),
            position: 1,
            title: null,
            titleLanguage: null,
          },
        })
      ).id;
      expect(
        await reasonOf(
          canonical.createChapter({
            authority: editor,
            value: {
              bookId: randomUUID(),
              slug: 'fixture-chapter-z',
              reference: sentinel('REFERENCE', 3),
              position: 1,
              title: null,
              titleLanguage: null,
            },
          }),
        ),
      ).toBe('not-found');
      expect(
        await reasonOf(
          canonical.createChapter({
            authority: unheld,
            value: {
              bookId: ids.bookA1,
              slug: 'fixture-chapter-y',
              reference: sentinel('REFERENCE', 4),
              position: 2,
              title: null,
              titleLanguage: null,
            },
          }),
        ),
      ).toBe('denied');
      expect(await count(db.admin, 'HadithBook')).toBe(6);
      expect(await count(db.admin, 'HadithChapter')).toBe(1);
      expect(await count(db.admin, 'AuditLog', "[action] = N'hadith.book.created'")).toBe(
        6,
      );
      expect(
        await count(db.admin, 'AuditLog', "[action] = N'hadith.chapter.created'"),
      ).toBe(1);
    });
  });

  /* ======================================================================
   * Source-qualified records
   * ==================================================================== */

  describe('source-qualified records', () => {
    it('lets one apparent reference coexist across editions and collections, never twice in one edition', async () => {
      const first = await canonical.createRecord({
        authority: editor,
        value: record({
          editionId: ids.editionA1,
          sourceReference: SHARED_REFERENCE,
          citationNumber: 1,
          bookId: ids.bookA1,
          chapterId: ids.chapterA1,
          text: TEXT_1,
          chain: CHAIN_1,
          chainLanguage: 'ar',
          gradings: GRADINGS_1,
        }),
      });
      expect(first).toMatchObject({ version: 1, conflicts: 0 });
      ids.r1 = first.id;

      // Another edition, the same reference and the same facts, in its OWN
      // structure: no collision, and — structure being compared only within one
      // edition — no conflict either.
      const second = await canonical.createRecord({
        authority: editor,
        value: record({
          editionId: ids.editionA2,
          sourceReference: SHARED_REFERENCE,
          citationNumber: 1,
          bookId: ids.bookA2,
          text: TEXT_1,
          chain: CHAIN_1,
          chainLanguage: 'ar',
          gradings: GRADINGS_1,
        }),
      });
      expect(second).toMatchObject({ version: 1, conflicts: 0 });
      ids.r2 = second.id;

      // Another collection: the same reference AND the same citation number.
      ids.rB = (
        await canonical.createRecord({
          authority: editor,
          value: record({
            editionId: ids.editionB1,
            sourceReference: SHARED_REFERENCE,
            citationNumber: 1,
            bookId: ids.bookB1,
            text: `${sentinel('TEXT', 3)} ${NEUTRAL}`,
          }),
        })
      ).id;

      expect(
        await reasonOf(
          canonical.createRecord({
            authority: editor,
            value: record({
              editionId: ids.editionA1,
              sourceReference: SHARED_REFERENCE,
              citationNumber: 9,
              bookId: ids.bookA1,
            }),
          }),
        ),
      ).toBe('duplicate-reference');
      expect(
        await count(
          db.admin,
          'Hadith',
          `CAST([sourceReference] AS VARBINARY(128)) = CAST(${n(SHARED_REFERENCE)} AS VARBINARY(128))`,
        ),
      ).toBe(3);
      expect(await facetsOf(ids.collectionA, 1)).toEqual([]);
    });

    it('refuses a record outside its own edition’s structure, or in an unregistered edition', async () => {
      const outside = {
        'another edition’s book': record({
          editionId: ids.editionA2,
          sourceReference: sentinel('REFERENCE', 8),
          citationNumber: 1,
          bookId: ids.bookA1,
        }),
        'a chapter of another book': record({
          editionId: ids.editionA1,
          sourceReference: sentinel('REFERENCE', 8),
          citationNumber: 1,
          bookId: ids.bookA1Second,
          chapterId: ids.chapterA1,
        }),
      };
      for (const [label, value] of Object.entries(outside))
        expect(
          await reasonOf(canonical.createRecord({ authority: editor, value })),
          label,
        ).toBe('structure-mismatch');
      expect(
        await reasonOf(
          canonical.createRecord({
            authority: editor,
            value: record({
              editionId: randomUUID(),
              sourceReference: sentinel('REFERENCE', 8),
              citationNumber: 1,
              bookId: ids.bookA1,
            }),
          }),
        ),
      ).toBe('not-found');
      for (const authority of [unheld, wrongPurposeQuran, expired, otherSession, revoked])
        expect(
          await reasonOf(
            canonical.createRecord({
              authority,
              value: record({
                editionId: ids.editionA1,
                sourceReference: sentinel('REFERENCE', 8),
                citationNumber: 1,
                bookId: ids.bookA1,
              }),
            }),
          ),
        ).toBe('denied');
      expect(await count(db.admin, 'Hadith')).toBe(3);
      expect(await count(db.admin, 'HadithRevision')).toBe(3);
    });

    it('stores text, chain and gradings byte for byte and never alters them on read', async () => {
      const detail = await persistence.record(ids.r1);
      expect(detail?.text).toBe(TEXT_1);
      expect(detail?.chain).toBe(CHAIN_1);
      expect(detail?.sourceReference).toBe(SHARED_REFERENCE);
      expect(detail?.gradings).toEqual(
        GRADINGS_1.map((grading, position) => ({ position, ...grading })),
      );
      expect(detail?.revisions.map((revision) => revision.operation)).toEqual([
        'created',
      ]);
      expect(detail?.candidates.map((candidate) => candidate.id)).toEqual([ids.r2]);

      const [bytes] = await db.admin.query<{
        text: string;
        chain: string;
        grader: string;
      }>(
        `SELECT CONVERT(VARCHAR(MAX), CAST(h.[text] AS VARBINARY(MAX)), 2) AS [text],
                CONVERT(VARCHAR(MAX), CAST(h.[chain] AS VARBINARY(MAX)), 2) AS [chain],
                (SELECT CONVERT(VARCHAR(MAX), CAST(g.[grader] AS VARBINARY(MAX)), 2)
                   FROM [dbo].[HadithGrading] g WHERE g.[hadithId] = h.[id] AND g.[position] = 0) AS [grader]
           FROM [dbo].[Hadith] h WHERE h.[id] = ${n(ids.r1)};`,
      );
      expect(bytes).toEqual({
        text: utf16(TEXT_1),
        chain: utf16(CHAIN_1),
        grader: utf16(GRADINGS_1[0]!.grader),
      });

      // NFC and NFD are canonically equivalent and remain two texts.
      expect(TEXT_NFC.normalize('NFC')).toBe(TEXT_NFD.normalize('NFC'));
      ids.rNfc = (
        await canonical.createRecord({
          authority: editor,
          value: record({
            editionId: ids.editionA1,
            sourceReference: sentinel('REFERENCE', 11),
            citationNumber: 2,
            bookId: ids.bookA1,
            text: TEXT_NFC,
            textLanguage: 'en',
          }),
        })
      ).id;
      const nfd = await canonical.createRecord({
        authority: editor,
        value: record({
          editionId: ids.editionA1,
          sourceReference: sentinel('REFERENCE', 12),
          citationNumber: 2,
          bookId: ids.bookA1,
          text: TEXT_NFD,
          textLanguage: 'en',
        }),
      });
      ids.rNfd = nfd.id;
      expect((await persistence.record(ids.rNfc))?.text).toBe(TEXT_NFC);
      expect((await persistence.record(ids.rNfd))?.text).toBe(TEXT_NFD);
      expect((await persistence.record(ids.rNfd))?.text).not.toBe(TEXT_NFC);
      // ...so the database calls them a TEXT conflict, never the same text.
      expect(nfd.conflicts).toBe(1);
      expect(await facetsOf(ids.collectionA, 2)).toEqual(['text']);
    });

    it('detects each conflict facet byte for byte, structure only within one edition', async () => {
      const pair = async (
        number: number,
        first: Partial<RecordCreateValue> &
          Pick<RecordCreateValue, 'editionId' | 'bookId'>,
        second: Partial<RecordCreateValue> &
          Pick<RecordCreateValue, 'editionId' | 'bookId'>,
      ) => {
        await canonical.createRecord({
          authority: editor,
          value: record({
            sourceReference: sentinel('REFERENCE', 100 + number),
            citationNumber: number,
            ...first,
          }),
        });
        return canonical.createRecord({
          authority: editor,
          value: record({
            sourceReference: sentinel('REFERENCE', 200 + number),
            citationNumber: number,
            ...second,
          }),
        });
      };
      const chained = { chain: CHAIN_1, chainLanguage: 'ar' };

      // A chain differing only by one zero-width non-joiner, across editions.
      await pair(
        3,
        { editionId: ids.editionA1, bookId: ids.bookA1, ...chained },
        {
          editionId: ids.editionA2,
          bookId: ids.bookA2,
          chain: CHAIN_1.replace(ZWNJ, ''),
          chainLanguage: 'ar',
        },
      );
      expect(await facetsOf(ids.collectionA, 3)).toEqual(['chain']);

      // The same edition, a chapter against no chapter.
      await pair(
        4,
        { editionId: ids.editionA1, bookId: ids.bookA1, chapterId: ids.chapterA1 },
        { editionId: ids.editionA1, bookId: ids.bookA1Second },
      );
      expect(await facetsOf(ids.collectionA, 4)).toEqual(['structure']);

      // A shared grader disagreeing; an unshared grader is never compared.
      await pair(
        5,
        { editionId: ids.editionA1, bookId: ids.bookA1, gradings: [GRADINGS_1[0]!] },
        {
          editionId: ids.editionA2,
          bookId: ids.bookA2,
          gradings: [
            {
              ...GRADINGS_1[0]!,
              label: GRADINGS_1[0]!.label.replace(BEH_KASRA, BEH_FATHA),
            },
            GRADINGS_1[1]!,
          ],
        },
      );
      expect(await facetsOf(ids.collectionA, 5)).toEqual(['grading']);

      // Several facets at once, in the database's own order.
      await pair(
        6,
        { editionId: ids.editionA1, bookId: ids.bookA1 },
        {
          editionId: ids.editionA1,
          bookId: ids.bookA1Second,
          text: `${sentinel('TEXT', 6)} ${NEUTRAL}`,
          ...chained,
        },
      );
      expect(await facetsOf(ids.collectionA, 6)).toEqual(['text,chain,structure']);

      // Identical candidates in two editions, each in its own structure: none.
      await pair(
        7,
        { editionId: ids.editionA1, bookId: ids.bookA1, chapterId: ids.chapterA1 },
        { editionId: ids.editionA2, bookId: ids.bookA2 },
      );
      expect(await facetsOf(ids.collectionA, 7)).toEqual([]);

      const conflicted = await persistence.records(
        { collectionId: ids.collectionA, view: 'conflicted' },
        0,
      );
      expect(conflicted.items.every((item) => item.conflicts > 0)).toBe(true);
      expect(conflicted.items.map((item) => item.citationNumber).sort()).toEqual([
        2, 2, 3, 3, 4, 4, 5, 5, 6, 6,
      ]);
      // Conflict evidence is append-only, even to the owner.
      expect(
        await sqlNumber(db.admin.query(`DELETE FROM [dbo].[HadithConflict] WHERE 1 = 1`)),
      ).toBe(51203);
    });
  });

  /* ======================================================================
   * Verification and the citation mapping
   * ==================================================================== */

  describe('verification and the citation mapping', () => {
    const map = (
      collectionId: string,
      number: number,
      hadithId: string,
      expectedVersion = 0,
      state: 'mapped' | 'withdrawn' = 'mapped',
    ) =>
      canonical.setCitation({
        authority: editor,
        value: {
          collectionId,
          number,
          hadithId,
          state,
          expectedVersion,
          evidence: sentinel('EVIDENCE', 4),
          reason: expectedVersion === 0 ? null : 'NON_HADITH_FIXTURE citation review',
        },
      });

    it('binds verification to the reviewed version', async () => {
      expect(
        await reasonOf(
          canonical.verifyRecord({
            authority: editor,
            value: { id: ids.r1, expectedVersion: 2, evidence: sentinel('EVIDENCE', 3) },
          }),
        ),
      ).toBe('conflict');
      expect(
        await reasonOf(
          canonical.verifyRecord({
            authority: wrongPurposeQuran,
            value: { id: ids.r1, expectedVersion: 1, evidence: sentinel('EVIDENCE', 3) },
          }),
        ),
      ).toBe('denied');
      expect(
        await reasonOf(
          canonical.verifyRecord({
            authority: editor,
            value: {
              id: randomUUID(),
              expectedVersion: 1,
              evidence: sentinel('EVIDENCE', 3),
            },
          }),
        ),
      ).toBe('not-found');
      expect((await persistence.record(ids.r1))?.verified).toBe(false);
      await verify(ids.r1);
      expect((await persistence.record(ids.r1))?.verified).toBe(true);
      expect(await reasonOf(verify(ids.r1))).toBe('unchanged');
      // Verification evidence is immutable, even to the owner.
      expect(
        await sqlNumber(
          db.admin.query(
            `UPDATE [dbo].[HadithVerification] SET [evidence] = N'x' WHERE [hadithId] = ${n(ids.r1)}`,
          ),
        ),
      ).toBe(51203);
    });

    it('maps a citation only to a verified, unconflicted candidate that declared its number', async () => {
      expect(await reasonOf(map(ids.collectionA, 1, ids.r2))).toBe('not-verified');
      expect(await reasonOf(map(ids.collectionA, 1, ids.rNfc))).toBe('not-candidate');
      expect(await reasonOf(map(ids.collectionA, 1, ids.rB))).toBe('not-candidate');
      await verify(ids.rNfc);
      expect(await reasonOf(map(ids.collectionA, 2, ids.rNfc))).toBe(
        'citation-conflicted',
      );
      // A new citation is mapped, never born withdrawn.
      expect(await reasonOf(map(ids.collectionA, 1, ids.r1, 0, 'withdrawn'))).toBe(
        'invalid',
      );
      expect(
        await reasonOf(
          canonical.setCitation({
            authority: unheld,
            value: {
              collectionId: ids.collectionA,
              number: 1,
              hadithId: ids.r1,
              state: 'mapped',
              expectedVersion: 0,
              evidence: sentinel('EVIDENCE', 4),
              reason: null,
            },
          }),
        ),
      ).toBe('denied');
      expect(await count(db.admin, 'HadithCitation')).toBe(0);

      const mapped = await map(ids.collectionA, 1, ids.r1);
      expect(mapped.version).toBe(1);
      ids.citationA1 = mapped.id;
      expect(await citationIdOf(db.admin, ids.collectionA, 1)).toBe(mapped.id);
      expect(await intents(db.admin, mapped.id)).toBe(1);

      expect(await reasonOf(map(ids.collectionA, 1, ids.r1))).toBe('conflict');
      expect(await reasonOf(map(ids.collectionA, 1, ids.r1, 1))).toBe('unchanged');

      // The bare number is not global: collection B's citation 1 is its own.
      await verify(ids.rB);
      const other = await map(ids.collectionB, 1, ids.rB);
      ids.citationB1 = other.id;
      expect(other.id).not.toBe(ids.citationA1);

      const detail = await persistence.record(ids.r1);
      expect(detail?.citationRecord).toMatchObject({
        id: ids.citationA1,
        hadithId: ids.r1,
        state: 'mapped',
        version: 1,
      });
      expect(await count(db.admin, 'AuditLog', "[action] = N'hadith.citation.set'")).toBe(
        2,
      );
    });

    it('refuses a stale, an unchanged or a citation-moving correction, and one outside its edition', async () => {
      expect(
        await reasonOf(
          canonical.correctRecord({
            authority: editor,
            value: await correctionOf(ids.r1, {
              expectedVersion: 2,
              text: `${TEXT_1} x`,
            }),
          }),
        ),
      ).toBe('conflict');
      expect(
        await reasonOf(
          canonical.correctRecord({
            authority: editor,
            value: await correctionOf(ids.r1, {}),
          }),
        ),
      ).toBe('unchanged');
      expect(
        await reasonOf(
          canonical.correctRecord({
            authority: editor,
            value: await correctionOf(ids.r1, { citationNumber: 9 }),
          }),
        ),
      ).toBe('citation-kept');
      expect(
        await reasonOf(
          canonical.correctRecord({
            authority: editor,
            value: await correctionOf(ids.r1, { bookId: ids.bookA2, chapterId: null }),
          }),
        ),
      ).toBe('structure-mismatch');
      expect(
        await reasonOf(
          canonical.correctRecord({
            authority: expired,
            value: await correctionOf(ids.r1, { text: `${TEXT_1} x` }),
          }),
        ),
      ).toBe('denied');
      expect((await persistence.record(ids.r1))?.version).toBe(1);
      expect(await count(db.admin, 'HadithRevision', `[hadithId] = ${n(ids.r1)}`)).toBe(
        1,
      );
      // The runtime principal cannot correct a record by hand, either.
      expect(
        await sqlNumber(
          app.query(`UPDATE [dbo].[Hadith] SET [text] = N'x' WHERE [id] = ${n(ids.r1)}`),
        ),
      ).toBe(229);
      expect((await persistence.record(ids.r1))?.text).toBe(TEXT_1);
    });
  });

  /* ======================================================================
   * Layered works — administration, through the Hadith service
   * ==================================================================== */

  describe('layered works', () => {
    it('administers a Translation under its version, requiring a registered source to publish', async () => {
      const created = await hadith.createTranslation(administrator, {
        hadithId: ids.r1,
        value: {
          languageCode: 'en',
          text: TRANSLATION_1,
          attribution: 'NON_HADITH_FIXTURE attribution',
          sourceSystemId: null,
          contributors: [{ personId: translator, role: 'translator' }],
        },
      });
      ids.translation = created.id;
      expect(created).toMatchObject({ state: 'draft', version: 1, text: TRANSLATION_1 });
      expect(created.contributors).toEqual([
        { personId: translator, role: 'translator', position: 0 },
      ]);

      expect(
        await reasonOf(
          hadith.setTranslationState(administrator, {
            id: created.id,
            expectedVersion: 1,
            state: 'published',
          }),
        ),
      ).toBe('source-required');
      // ...and the adapter refuses the same on its own.
      expect(
        await reasonOf(
          persistence.setTranslationState({
            actorId: administrator.accountId,
            id: created.id,
            expectedVersion: 1,
            state: 'published',
          }),
        ),
      ).toBe('source-required');

      const sourced = await hadith.updateTranslation(administrator, {
        id: created.id,
        expectedVersion: 1,
        value: {
          languageCode: 'en',
          text: TRANSLATION_1,
          attribution: 'NON_HADITH_FIXTURE attribution',
          sourceSystemId: fixtureA,
          contributors: [{ personId: translator, role: 'translator' }],
        },
      });
      expect(sourced.version).toBe(2);
      expect(
        await reasonOf(
          hadith.updateTranslation(administrator, {
            id: created.id,
            expectedVersion: 1,
            value: {
              languageCode: 'en',
              text: `${TRANSLATION_1} stale`,
              attribution: null,
              sourceSystemId: fixtureA,
              contributors: [],
            },
          }),
        ),
      ).toBe('conflict');
      const published = await hadith.setTranslationState(administrator, {
        id: created.id,
        expectedVersion: 2,
        state: 'published',
      });
      expect(published).toMatchObject({
        state: 'published',
        version: 3,
        text: TRANSLATION_1,
      });
      expect(published.publishedAt).toBeInstanceOf(Date);

      // A translation of a record whose citation is conflicted: published, and
      // shown nowhere while its parent is not public.
      const elsewhere = await hadith.createTranslation(administrator, {
        hadithId: ids.rNfc,
        value: {
          languageCode: 'ur',
          text: sentinel('TRANSLATION', 2),
          attribution: null,
          sourceSystemId: fixtureA,
          contributors: [],
        },
      });
      ids.conflictedTranslation = elsewhere.id;
      await hadith.setTranslationState(administrator, {
        id: elsewhere.id,
        expectedVersion: 1,
        state: 'published',
      });

      // Without `hadith.administer` nothing is written.
      const readOnly = { accountId: await accountWith(db.admin, ['hadith.read']) };
      expect(
        await reasonOf(
          hadith.setTranslationState(readOnly, {
            id: created.id,
            expectedVersion: 3,
            state: 'archived',
          }),
        ),
      ).toBe('denied');
      expect((await persistence.translation(created.id))?.version).toBe(3);
    });

    it('administers a Commentary, publishing only with a source and an entry', async () => {
      const work = await hadith.createCommentary(administrator, {
        slug: SLUG.commentary,
        name: 'NON_HADITH_FIXTURE commentary',
        description: null,
        attribution: null,
        languageCode: 'ur',
        sourceSystemId: fixtureA,
        contributors: [{ personId: translator, role: 'author' }],
      });
      ids.commentary = work.id;
      expect(
        await reasonOf(
          hadith.setCommentaryState(administrator, {
            id: work.id,
            expectedVersion: 1,
            state: 'published',
          }),
        ),
      ).toBe('text-required');
      // The database's own trigger refuses the same, past the service.
      expect(
        await reasonOf(
          persistence.setCommentaryState({
            actorId: administrator.accountId,
            id: work.id,
            expectedVersion: 1,
            state: 'published',
          }),
        ),
      ).toBe('text-required');

      let current = await hadith.saveCommentaryEntry(administrator, {
        id: work.id,
        expectedVersion: 1,
        value: { hadithId: ids.r1, text: `${sentinel('COMMENTARY', 1)} ${BEH_FATHA}` },
      });
      current = await hadith.saveCommentaryEntry(administrator, {
        id: work.id,
        expectedVersion: current.version,
        value: { hadithId: ids.rNfc, text: sentinel('COMMENTARY', 2) },
      });
      expect(current.entryCount).toBe(2);
      current = await hadith.setCommentaryState(administrator, {
        id: work.id,
        expectedVersion: current.version,
        state: 'published',
      });
      expect(current.state).toBe('published');

      const unsourced = await hadith.createCommentary(administrator, {
        slug: 'fixture-commentary-b',
        name: 'NON_HADITH_FIXTURE commentary unsourced',
        description: null,
        attribution: null,
        languageCode: 'en',
        sourceSystemId: null,
        contributors: [],
      });
      const withEntry = await hadith.saveCommentaryEntry(administrator, {
        id: unsourced.id,
        expectedVersion: 1,
        value: { hadithId: ids.r1, text: sentinel('COMMENTARY', 3) },
      });
      expect(
        await reasonOf(
          hadith.setCommentaryState(administrator, {
            id: unsourced.id,
            expectedVersion: withEntry.version,
            state: 'published',
          }),
        ),
      ).toBe('source-required');
      expect(
        await reasonOf(
          hadith.createCommentary(administrator, {
            slug: SLUG.commentary,
            name: 'NON_HADITH_FIXTURE duplicate',
            description: null,
            attribution: null,
            languageCode: 'en',
            sourceSystemId: null,
            contributors: [],
          }),
        ),
      ).toBe('duplicate-slug');
    });

    it('administers Sciences study material: a source, then text, then publication', async () => {
      const science = await hadith.createScience(administrator, {
        slug: SLUG.science,
        position: 1,
        attribution: null,
        sourceSystemId: null,
        texts: [],
      });
      ids.science = science.id;
      expect(
        await reasonOf(
          hadith.setScienceState(administrator, {
            id: science.id,
            expectedVersion: 1,
            state: 'published',
          }),
        ),
      ).toBe('source-required');
      const sourced = await hadith.updateScience(administrator, {
        id: science.id,
        expectedVersion: 1,
        value: {
          slug: SLUG.science,
          position: 1,
          attribution: null,
          sourceSystemId: fixtureA,
          texts: [],
        },
      });
      expect(
        await reasonOf(
          hadith.setScienceState(administrator, {
            id: science.id,
            expectedVersion: sourced.version,
            state: 'published',
          }),
        ),
      ).toBe('text-required');
      expect(
        await reasonOf(
          persistence.setScienceState({
            actorId: administrator.accountId,
            id: science.id,
            expectedVersion: sourced.version,
            state: 'published',
          }),
        ),
      ).toBe('text-required');
      const written = await hadith.updateScience(administrator, {
        id: science.id,
        expectedVersion: sourced.version,
        value: {
          slug: SLUG.science,
          position: 1,
          attribution: null,
          sourceSystemId: fixtureA,
          texts: [
            {
              languageCode: 'en',
              title: 'NON_HADITH_FIXTURE science',
              body: `${sentinel('SCIENCE', 1)}  ${BEH_KASRA}`,
            },
          ],
        },
      });
      const published = await hadith.setScienceState(administrator, {
        id: science.id,
        expectedVersion: written.version,
        state: 'published',
      });
      expect(published.state).toBe('published');
      expect(published.texts[0]?.body).toBe(`${sentinel('SCIENCE', 1)}  ${BEH_KASRA}`);
    });

    it('assigns Topics by typed foreign keys and saves display names under their own version', async () => {
      const owed = await intents(db.admin, ids.citationA1);
      await hadith.addRecordTopic(administrator, { hadithId: ids.r1, topicId });
      expect(
        await reasonOf(
          hadith.addRecordTopic(administrator, { hadithId: ids.r1, topicId }),
        ),
      ).toBe('unchanged');
      expect(
        await reasonOf(
          hadith.addRecordTopic(administrator, {
            hadithId: ids.r1,
            topicId: randomUUID(),
          }),
        ),
      ).toBe('invalid');
      // A topic change owes the record's citation a re-projection.
      expect(await intents(db.admin, ids.citationA1)).toBe(owed + 1);

      await hadith.saveCollectionNames(administrator, {
        id: ids.collectionA,
        expectedVersion: 1,
        names: [
          { locale: 'en', name: 'NON_HADITH_FIXTURE collection A', description: null },
          { locale: 'ar', name: `NON_HADITH_FIXTURE ${NEUTRAL}`, description: null },
        ],
      });
      expect(
        await reasonOf(
          hadith.saveCollectionNames(administrator, {
            id: ids.collectionA,
            expectedVersion: 1,
            names: [],
          }),
        ),
      ).toBe('conflict');
      expect((await persistence.collection(ids.collectionA))?.namesVersion).toBe(2);
    });

    it('holds a record to its Topic ceiling under concurrent additions, as the runtime principal', async () => {
      // A record of its own, never mapped, so no public proof sees its Topics.
      const capped = (
        await canonical.createRecord({
          authority: editor,
          value: record({
            editionId: ids.editionB1,
            sourceReference: sentinel('REFERENCE', 50),
            citationNumber: 50,
            bookId: ids.bookB1,
          }),
        })
      ).id;
      const topics: string[] = [];
      for (let index = 0; index < HADITH_LIMITS.topicsPerRecord + 3; index += 1)
        topics.push(
          await topic(db.admin, `non-hadith-fixture-cap-${randomUUID().slice(0, 8)}`),
        );
      // One below the ceiling, one at a time — through the row lock the
      // runtime principal takes with no grant beyond SELECT on `Hadith`.
      for (const id of topics.slice(0, HADITH_LIMITS.topicsPerRecord - 1))
        await hadith.addRecordTopic(administrator, { hadithId: capped, topicId: id });
      expect(await count(db.admin, 'HadithTopic', `[hadithId] = ${n(capped)}`)).toBe(
        HADITH_LIMITS.topicsPerRecord - 1,
      );

      // Four distinct Topics race for the one remaining place: exactly one wins.
      const outcomes = await Promise.allSettled(
        topics
          .slice(HADITH_LIMITS.topicsPerRecord - 1)
          .map((id) =>
            hadith.addRecordTopic(administrator, { hadithId: capped, topicId: id }),
          ),
      );
      expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(
        1,
      );
      expect(
        outcomes
          .filter(
            (outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected',
          )
          .map((outcome) => (outcome.reason as { reason?: string }).reason),
      ).toEqual(['invalid', 'invalid', 'invalid']);
      expect(await count(db.admin, 'HadithTopic', `[hadithId] = ${n(capped)}`)).toBe(
        HADITH_LIMITS.topicsPerRecord,
      );
      expect(
        await count(
          db.admin,
          'AuditLog',
          `[action] = N'hadith.record.topic-added' AND [targetId] = ${n(capped)}`,
        ),
      ).toBe(HADITH_LIMITS.topicsPerRecord);
      // At the ceiling, a later addition is refused too.
      expect(
        await reasonOf(
          hadith.addRecordTopic(administrator, { hadithId: capped, topicId }),
        ),
      ).toBe('invalid');
    });
  });

  /* ======================================================================
   * The public reader
   * ==================================================================== */

  describe('the public reader', () => {
    it('answers nothing at all before activation, whatever is mapped and published', async () => {
      expect(await reader.availability()).toEqual({ active: false });
      expect(await reader.collections()).toEqual([]);
      expect(await reader.collection(SLUG.a)).toBeNull();
      expect(await reader.books(ids.collectionA)).toEqual([]);
      expect(await reader.book(ids.collectionA, SLUG.bookA1)).toBeNull();
      expect(await reader.chapters(ids.bookA1)).toEqual([]);
      expect(await reader.chapter(ids.bookA1, SLUG.chapterA1)).toBeNull();
      expect((await reader.bookCitations(ids.bookA1, 0)).items).toEqual([]);
      expect((await reader.chapterCitations(ids.chapterA1, 0)).items).toEqual([]);
      expect(await reader.citation(SLUG.a, 1)).toBeNull();
      expect((await reader.browse(0)).total).toBe(0);
      expect((await reader.topicCitations(topicId, 0)).items).toEqual([]);
      expect(await reader.commentaries()).toEqual([]);
      expect(await reader.sciences()).toEqual([]);
      expect(await reader.science(SLUG.science)).toBeNull();
      expect(await reader.citationSitemap(0, 100)).toEqual([]);
      expect(await reader.searchCitation(ids.citationA1)).toBeNull();
      expect(await reader.searchCitationScopes(null, 100)).toEqual([]);
      expect(await reader.publicCitationTargets([ids.citationA1])).toEqual([]);
      expect(await reader.searchCitationRecords([ids.citationA1])).toEqual([]);
    });

    it('refuses an empty activation and mixed authorities — operator acts the runtime cannot perform', async () => {
      // Nothing mapped in collection C yet.
      expect(await sqlNumber(activate(db.admin, ids.collectionC, 'fixture'))).toBe(51206);
      expect(
        await sqlNumber(
          app.query(
            `INSERT INTO [dbo].[HadithActivation] ([collectionId],[authority],[authorisedBy]) VALUES (${n(ids.collectionA)}, N'fixture', N'x')`,
          ),
        ),
      ).toBe(229);
      await activate(db.admin, ids.collectionA, 'fixture');
      await activate(db.admin, ids.collectionB, 'fixture');
      expect(
        await sqlNumber(
          db.admin.query(
            `UPDATE [dbo].[HadithActivation] SET [authorisedBy] = N'x' WHERE [collectionId] = ${n(ids.collectionA)}`,
          ),
        ),
      ).toBe(51206);
    });

    it('in fixture mode, shows exactly the public citations, their structure and their public layers', async () => {
      expect(await reader.availability()).toEqual({ active: true, mode: 'fixture' });

      const collections = await reader.collections();
      expect(collections.map((collection) => collection.slug)).toEqual([SLUG.a, SLUG.b]);
      expect(collections[0]?.names.map((name) => name.locale)).toEqual(['ar', 'en']);
      expect(collections[0]?.attributions).toEqual([EDITION_A1]);
      expect(await reader.collection(SLUG.c)).toBeNull();

      const citation = await reader.citation(SLUG.a, 1);
      expect(citation).not.toBeNull();
      expect(citation?.text).toBe(TEXT_1);
      expect(citation?.chain).toBe(CHAIN_1);
      expect(citation?.sourceReference).toBe(SHARED_REFERENCE);
      expect(citation?.gradings).toEqual(
        GRADINGS_1.map((grading, position) => ({ position, ...grading })),
      );
      expect(citation?.attribution.editionCode).toBe('NON_HADITH_FIXTURE_EDITION_A1');
      expect(citation?.book.slug).toBe(SLUG.bookA1);
      expect(citation?.chapter?.slug).toBe(SLUG.chapterA1);
      expect(citation?.translations.map((t) => [t.id, t.text])).toEqual([
        [ids.translation, TRANSLATION_1],
      ]);
      expect(citation?.commentary.map((entry) => entry.slug)).toEqual([SLUG.commentary]);
      expect(citation?.topicIds).toEqual([topicId]);

      // Unmapped, conflicted and never-mapped numbers are absent alike.
      for (const number of [2, 3, 7, 8])
        expect(await reader.citation(SLUG.a, number)).toBeNull();
      // The same number elsewhere is that collection's own record.
      expect((await reader.citation(SLUG.b, 1))?.text).toBe(
        `${sentinel('TEXT', 3)} ${NEUTRAL}`,
      );

      expect((await reader.books(ids.collectionA)).map((book) => book.slug)).toEqual([
        SLUG.bookA1,
      ]);
      // A book is its edition's: the public book names the edition it belongs to.
      expect((await reader.book(ids.collectionA, SLUG.bookA1))?.edition).toEqual(
        EDITION_A1,
      );
      expect(citation?.book.edition).toEqual(EDITION_A1);
      expect(await reader.book(ids.collectionA, SLUG.bookA2)).toBeNull();
      expect((await reader.chapters(ids.bookA1)).map((chapter) => chapter.slug)).toEqual([
        SLUG.chapterA1,
      ]);
      expect((await reader.chapter(ids.bookA1, SLUG.chapterA1))?.slug).toBe(
        SLUG.chapterA1,
      );
      expect((await reader.chapterCitations(ids.chapterA1, 0)).items).toEqual([
        {
          collectionSlug: SLUG.a,
          number: 1,
          sourceReference: SHARED_REFERENCE,
          text: TEXT_1,
          textLanguage: 'ar',
        },
      ]);
      expect((await reader.bookCitations(ids.bookA1, 0)).items).toEqual([]);
      expect(
        (await reader.browse(0)).items.map(
          (item) => `${item.collectionSlug}:${item.number}`,
        ),
      ).toEqual([`${SLUG.a}:1`, `${SLUG.b}:1`]);
      expect(
        (await reader.topicCitations(topicId, 0)).items.map((item) => item.number),
      ).toEqual([1]);

      // The commentary counts only the entry beside a PUBLIC citation.
      expect(
        (await reader.commentaries()).map((work) => [work.slug, work.entryCount]),
      ).toEqual([[SLUG.commentary, 1]]);
      expect((await reader.sciences()).map((science) => science.slug)).toEqual([
        SLUG.science,
      ]);
      expect((await reader.science(SLUG.science))?.texts[0]?.body).toBe(
        `${sentinel('SCIENCE', 1)}  ${BEH_KASRA}`,
      );

      // A fixture section is never listed in a sitemap.
      expect(await reader.citationSitemap(0, 100)).toEqual([]);

      // Search: the projection, the batch read and the visibility resolver.
      const projected = await reader.searchCitation(ids.citationA1);
      expect(projected).toMatchObject({
        citationId: ids.citationA1,
        collectionSlug: SLUG.a,
        number: 1,
        text: TEXT_1,
        textLanguage: 'ar',
        translations: [{ languageCode: 'en', text: TRANSLATION_1 }],
        topicIds: [topicId],
      });
      expect(projected?.stamp).toMatch(/^[0-9a-f]{64}$/u);
      expect(JSON.stringify(projected)).not.toContain(sentinel('CHAIN', 1));
      expect(JSON.stringify(projected)).not.toContain(sentinel('GRADING', 1));
      expect(JSON.stringify(projected)).not.toContain(sentinel('COMMENTARY', 1));
      const records = await reader.searchCitationRecords([
        ids.citationA1,
        randomUUID(),
        ids.citationA1,
      ]);
      expect(records).toEqual([projected]);
      const scopes = await reader.searchCitationScopes(null, 100);
      expect(scopes.map((scope) => scope.id).sort()).toEqual(
        [ids.citationA1, ids.citationB1].sort(),
      );
      expect(scopes.find((scope) => scope.id === ids.citationA1)?.stamp).toBe(
        projected?.stamp,
      );
      expect(await reader.publicCitationTargets([ids.citationA1, randomUUID()])).toEqual([
        { citationId: ids.citationA1, collectionSlug: SLUG.a, number: 1 },
      ]);

      // No public output carries the conflicted record's translation.
      const everything = JSON.stringify([
        await reader.browse(0),
        await reader.citation(SLUG.a, 1),
        await reader.searchCitationRecords([ids.citationA1, ids.citationB1]),
      ]);
      expect(everything).not.toContain(sentinel('TRANSLATION', 2));
      expect(everything).not.toContain(sentinel('COMMENTARY', 2));
    });

    it('in fixture mode, never shows an approved-source record or layer, and names each book’s own edition', async () => {
      const setCitation = (
        number: number,
        hadithId: string,
        expectedVersion: number,
        state: 'mapped' | 'withdrawn' = 'mapped',
      ) =>
        canonical.setCitation({
          authority: editor,
          value: {
            collectionId: ids.collectionA,
            number,
            hadithId,
            state,
            expectedVersion,
            evidence: sentinel('EVIDENCE', 7),
            reason: expectedVersion === 0 ? null : 'NON_HADITH_FIXTURE citation review',
          },
        });

      // ---- an APPROVED edition of the fixture collection A ----------------
      const editionApproved = await registerEdition(db.admin, {
        collectionId: ids.collectionA,
        sourceSystemId: approvedSource,
        code: 'NON_HADITH_FIXTURE_EDITION_A_APPROVED',
      });
      const bookApproved = (
        await canonical.createBook({
          authority: editor,
          value: {
            editionId: editionApproved,
            slug: 'fixture-book-approved',
            reference: sentinel('REFERENCE', 1),
            position: 1,
            title: null,
            titleLanguage: null,
          },
        })
      ).id;
      const approvedRecord = (
        await canonical.createRecord({
          authority: editor,
          value: record({
            editionId: editionApproved,
            sourceReference: sentinel('REFERENCE', 40),
            citationNumber: 40,
            bookId: bookApproved,
            text: `${sentinel('TEXT', 40)} ${NEUTRAL}`,
          }),
        })
      ).id;
      await verify(approvedRecord);

      // The database refuses to map it (51208): the fixture banner would call
      // approved text non-authoritative proof text.
      expect(await reasonOf(setCitation(40, approvedRecord, 0))).toBe(
        'fixture-over-approved',
      );
      expect(await citationIdOf(db.admin, ids.collectionA, 40)).toBeNull();

      // THE READ RULE ON ITS OWN: the owner forces the forbidden state on this
      // disposable database, past the trigger, and the reader still hides it.
      const forced = randomUUID();
      await db.admin.query(
        'ALTER TABLE [dbo].[HadithCitation] DISABLE TRIGGER [HadithCitationIntegrity];',
      );
      try {
        await db.admin.query(
          `INSERT INTO [dbo].[HadithCitation] ([collectionId],[number],[id],[hadithId],[state],[version])
           VALUES (${n(ids.collectionA)}, 40, ${n(forced)}, ${n(approvedRecord)}, N'mapped', 1);`,
        );
      } finally {
        await db.admin.query(
          'ALTER TABLE [dbo].[HadithCitation] ENABLE TRIGGER [HadithCitationIntegrity];',
        );
      }
      const [trigger] = await db.admin.query<{ disabled: boolean | number }>(
        `SELECT [is_disabled] AS disabled FROM sys.triggers WHERE [name] = N'HadithCitationIntegrity';`,
      );
      expect(Number(trigger?.disabled)).toBe(0);

      // ---- approved layers beside a PUBLIC fixture citation ---------------
      const approvedTranslation = await hadith.createTranslation(administrator, {
        hadithId: ids.r1,
        value: {
          languageCode: 'ur',
          text: sentinel('TRANSLATION', 40),
          attribution: null,
          sourceSystemId: approvedSource,
          contributors: [],
        },
      });
      const translationShown = await hadith.setTranslationState(administrator, {
        id: approvedTranslation.id,
        expectedVersion: 1,
        state: 'published',
      });
      const approvedCommentary = await hadith.createCommentary(administrator, {
        slug: 'fixture-commentary-d',
        name: 'NON_HADITH_FIXTURE approved commentary in fixture mode',
        description: null,
        attribution: null,
        languageCode: 'en',
        sourceSystemId: approvedSource,
        contributors: [],
      });
      const commentaryEntry = await hadith.saveCommentaryEntry(administrator, {
        id: approvedCommentary.id,
        expectedVersion: 1,
        value: { hadithId: ids.r1, text: sentinel('COMMENTARY', 40) },
      });
      const commentaryShown = await hadith.setCommentaryState(administrator, {
        id: approvedCommentary.id,
        expectedVersion: commentaryEntry.version,
        state: 'published',
      });
      const approvedScience = await hadith.createScience(administrator, {
        slug: 'fixture-science-d',
        position: 3,
        attribution: null,
        sourceSystemId: approvedSource,
        texts: [
          {
            languageCode: 'en',
            title: 'NON_HADITH_FIXTURE science D',
            body: sentinel('SCIENCE', 40),
          },
        ],
      });
      const scienceShown = await hadith.setScienceState(administrator, {
        id: approvedScience.id,
        expectedVersion: 1,
        state: 'published',
      });

      // ---- a second edition's book, made public beside the first ----------
      const secondEdition = (
        await canonical.createRecord({
          authority: editor,
          value: record({
            editionId: ids.editionA2,
            sourceReference: sentinel('REFERENCE', 41),
            citationNumber: 41,
            bookId: ids.bookA2,
            text: `${sentinel('TEXT', 41)} ${NEUTRAL}`,
          }),
        })
      ).id;
      await verify(secondEdition);
      const citation41 = await setCitation(41, secondEdition, 0);

      // ---- what the fixture section shows ---------------------------------
      expect(await reader.availability()).toEqual({ active: true, mode: 'fixture' });
      expect(await reader.citation(SLUG.a, 40)).toBeNull();
      expect(await reader.searchCitation(forced)).toBeNull();
      expect(await reader.searchCitationRecords([forced])).toEqual([]);
      expect(await reader.publicCitationTargets([forced])).toEqual([]);
      expect(
        (await reader.searchCitationScopes(null, 100)).map((scope) => scope.id),
      ).not.toContain(forced);
      expect(
        (await reader.browse(0)).items.map(
          (item) => `${item.collectionSlug}:${item.number}`,
        ),
      ).toEqual([`${SLUG.a}:1`, `${SLUG.a}:41`, `${SLUG.b}:1`]);
      expect(await reader.citationSitemap(0, 100)).toEqual([]);

      // Two editions' books, both public, both carrying one source reference:
      // the edition each names is what tells them apart. The approved
      // edition's book and attribution appear nowhere.
      const books = await reader.books(ids.collectionA);
      expect(books.map((book) => [book.slug, book.reference, book.edition])).toEqual([
        [SLUG.bookA1, sentinel('REFERENCE', 1), EDITION_A1],
        [SLUG.bookA2, sentinel('REFERENCE', 1), EDITION_A2],
      ]);
      expect((await reader.book(ids.collectionA, SLUG.bookA2))?.edition).toEqual(
        EDITION_A2,
      );
      expect(await reader.book(ids.collectionA, 'fixture-book-approved')).toBeNull();
      expect((await reader.citation(SLUG.a, 41))?.book.edition).toEqual(EDITION_A2);
      expect((await reader.citation(SLUG.a, 1))?.book.edition).toEqual(EDITION_A1);
      expect((await reader.collection(SLUG.a))?.attributions).toEqual([
        EDITION_A1,
        EDITION_A2,
      ]);

      // The public citation's approved layers are hidden; its fixture ones stay.
      const shown = await reader.citation(SLUG.a, 1);
      expect(shown?.translations.map((t) => t.text)).toEqual([TRANSLATION_1]);
      expect(shown?.commentary.map((work) => work.slug)).toEqual([SLUG.commentary]);
      expect((await reader.commentaries()).map((work) => work.slug)).toEqual([
        SLUG.commentary,
      ]);
      expect((await reader.sciences()).map((science) => science.slug)).toEqual([
        SLUG.science,
      ]);
      expect(await reader.science('fixture-science-d')).toBeNull();
      expect((await reader.searchCitation(ids.citationA1))?.translations).toEqual([
        { languageCode: 'en', text: TRANSLATION_1 },
      ]);
      const everything = JSON.stringify([
        await reader.collections(),
        books,
        await reader.browse(0),
        shown,
        await reader.citation(SLUG.a, 41),
        await reader.commentaries(),
        await reader.sciences(),
        await reader.searchCitationRecords([ids.citationA1, citation41.id, forced]),
      ]);
      for (const hidden of [
        sentinel('TEXT', 40),
        sentinel('TRANSLATION', 40),
        sentinel('COMMENTARY', 40),
        sentinel('SCIENCE', 40),
        'NON_HADITH_FIXTURE_EDITION_A_APPROVED',
        'NON_HADITH_FIXTURE_SOURCE_APPROVED',
      ])
        expect(everything, hidden).not.toContain(hidden);

      // ---- restore the section the later proofs expect --------------------
      await setCitation(41, secondEdition, 1, 'withdrawn');
      await setCitation(40, approvedRecord, 1, 'withdrawn');
      await hadith.setTranslationState(administrator, {
        id: approvedTranslation.id,
        expectedVersion: translationShown.version,
        state: 'archived',
      });
      await hadith.setCommentaryState(administrator, {
        id: approvedCommentary.id,
        expectedVersion: commentaryShown.version,
        state: 'archived',
      });
      await hadith.setScienceState(administrator, {
        id: approvedScience.id,
        expectedVersion: scienceShown.version,
        state: 'archived',
      });
      expect((await reader.books(ids.collectionA)).map((book) => book.slug)).toEqual([
        SLUG.bookA1,
      ]);
    });

    it('keeps the record public when its translation is withdrawn, and owes its citation a re-projection', async () => {
      const owed = await intents(db.admin, ids.citationA1);
      const before = (await reader.searchCitation(ids.citationA1))?.stamp;
      const archived = await hadith.setTranslationState(administrator, {
        id: ids.translation,
        expectedVersion: 3,
        state: 'archived',
      });
      expect(await intents(db.admin, ids.citationA1)).toBe(owed + 1);
      const citation = await reader.citation(SLUG.a, 1);
      expect(citation?.text).toBe(TEXT_1);
      expect(citation?.translations).toEqual([]);
      expect((await reader.searchCitation(ids.citationA1))?.stamp).not.toBe(before);

      const republished = await hadith.setTranslationState(administrator, {
        id: ids.translation,
        expectedVersion: archived.version,
        state: 'published',
      });
      expect(republished.publishedAt?.getTime()).toBe(archived.publishedAt?.getTime());
      expect((await reader.citation(SLUG.a, 1))?.translations).toHaveLength(1);
    });

    it('archives a commentary and a science out of public view, owing the commentary’s citations a re-projection', async () => {
      const owed = await intents(db.admin, ids.citationA1);
      const commentary = (await persistence.commentary(ids.commentary))!;
      const archived = await hadith.setCommentaryState(administrator, {
        id: ids.commentary,
        expectedVersion: commentary.version,
        state: 'archived',
      });
      expect(await intents(db.admin, ids.citationA1)).toBe(owed + 1);
      expect(await reader.commentaries()).toEqual([]);
      expect((await reader.citation(SLUG.a, 1))?.commentary).toEqual([]);
      // The record itself is untouched.
      expect((await reader.citation(SLUG.a, 1))?.text).toBe(TEXT_1);
      await hadith.setCommentaryState(administrator, {
        id: ids.commentary,
        expectedVersion: archived.version,
        state: 'published',
      });
      expect((await reader.commentaries()).map((work) => work.slug)).toEqual([
        SLUG.commentary,
      ]);

      const science = (await persistence.science(ids.science))!;
      const shelved = await hadith.setScienceState(administrator, {
        id: ids.science,
        expectedVersion: science.version,
        state: 'archived',
      });
      expect(await reader.sciences()).toEqual([]);
      expect(await reader.science(SLUG.science)).toBeNull();
      await hadith.setScienceState(administrator, {
        id: ids.science,
        expectedVersion: shelved.version,
        state: 'published',
      });
      expect((await reader.science(SLUG.science))?.slug).toBe(SLUG.science);
    });

    it('hides a corrected record until its new version is verified; two concurrent corrections, one wins', async () => {
      const base = await correctionOf(ids.rB, {});
      const outcomes = await Promise.allSettled([
        canonical.correctRecord({
          authority: editor,
          value: { ...base, text: `${sentinel('TEXT', 4)} ${NEUTRAL}` },
        }),
        canonical.correctRecord({
          authority: editor,
          value: { ...base, text: `${sentinel('TEXT', 5)} ${NEUTRAL}` },
        }),
      ]);
      const fulfilled = outcomes.filter((outcome) => outcome.status === 'fulfilled');
      const rejected = outcomes.filter(
        (outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected',
      );
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0]!.reason as { reason?: string }).reason).toBe('conflict');

      const corrected = await persistence.record(ids.rB);
      expect(corrected?.version).toBe(2);
      expect(corrected?.verified).toBe(false);
      expect(corrected?.revisions.map((revision) => revision.version)).toEqual([2, 1]);
      expect(await count(db.admin, 'HadithRevision', `[hadithId] = ${n(ids.rB)}`)).toBe(
        2,
      );
      // A correction owes its citation a re-projection.
      expect(await intents(db.admin, ids.citationB1)).toBeGreaterThanOrEqual(2);

      // The version-1 verification never covers the version-2 text.
      expect(await reader.citation(SLUG.b, 1)).toBeNull();
      expect(await reader.searchCitation(ids.citationB1)).toBeNull();
      expect(await reader.publicCitationTargets([ids.citationB1])).toEqual([]);

      await verify(ids.rB);
      expect((await reader.citation(SLUG.b, 1))?.text).toBe(corrected?.text);

      const audit = await db.admin.query<{ beforeState: string; afterState: string }>(
        `SELECT [beforeState],[afterState] FROM [dbo].[AuditLog] WHERE [action] = N'hadith.record.corrected' AND [targetId] = ${n(ids.rB)}`,
      );
      expect(audit).toHaveLength(1);
      expect(audit[0]!.afterState).toContain('"version":"2"');
    });

    it('withdraws a citation, hiding its layers, and re-maps it to another verified candidate', async () => {
      const remap = (
        hadithId: string,
        expectedVersion: number,
        state: 'mapped' | 'withdrawn',
      ) =>
        canonical.setCitation({
          authority: editor,
          value: {
            collectionId: ids.collectionA,
            number: 1,
            hadithId,
            state,
            expectedVersion,
            evidence: sentinel('EVIDENCE', 5),
            reason: 'NON_HADITH_FIXTURE citation review',
          },
        });

      const owed = await intents(db.admin, ids.citationA1);
      const withdrawn = await remap(ids.r1, 1, 'withdrawn');
      expect(withdrawn).toEqual({ id: ids.citationA1, version: 2 });
      expect(await intents(db.admin, ids.citationA1)).toBe(owed + 1);
      expect(await reader.citation(SLUG.a, 1)).toBeNull();
      expect(await reader.commentaries()).toEqual([]);
      expect((await reader.topicCitations(topicId, 0)).items).toEqual([]);
      expect(await reader.searchCitation(ids.citationA1)).toBeNull();
      expect(await reader.books(ids.collectionA)).toEqual([]);
      expect((await reader.collections()).map((collection) => collection.slug)).toEqual([
        SLUG.b,
      ]);

      // Re-mapped to the other edition's verified candidate.
      expect(await reasonOf(remap(ids.r2, 2, 'mapped'))).toBe('not-verified');
      await verify(ids.r2);
      const remapped = await remap(ids.r2, 2, 'mapped');
      expect(remapped).toEqual({ id: ids.citationA1, version: 3 });
      const citation = await reader.citation(SLUG.a, 1);
      expect(citation?.attribution.editionCode).toBe('NON_HADITH_FIXTURE_EDITION_A2');
      expect(citation?.book.slug).toBe(SLUG.bookA2);
      expect(citation?.chapter).toBeNull();
      // The layers were the other record's: none follows the citation.
      expect(citation?.translations).toEqual([]);
      expect(citation?.commentary).toEqual([]);
      expect(
        (await reader.bookCitations(ids.bookA2, 0)).items.map((i) => i.number),
      ).toEqual([1]);

      // The mapped record keeps its citation number.
      expect(
        await reasonOf(
          canonical.correctRecord({
            authority: editor,
            value: await correctionOf(ids.r2, { citationNumber: 8 }),
          }),
        ),
      ).toBe('citation-kept');

      const revisions = await count(
        db.admin,
        'HadithCitationRevision',
        `[collectionId] = ${n(ids.collectionA)} AND [number] = 1`,
      );
      expect(revisions).toBe(3);
    });

    it('withholds a mapped citation the moment conflict evidence stands against it', async () => {
      const owed = await intents(db.admin, ids.citationA1);
      const late = await canonical.createRecord({
        authority: editor,
        value: record({
          editionId: ids.editionA1,
          sourceReference: sentinel('REFERENCE', 21),
          citationNumber: 1,
          bookId: ids.bookA1,
          text: `${sentinel('TEXT', 21)} ${NEUTRAL}`,
        }),
      });
      expect(late.conflicts).toBeGreaterThanOrEqual(1);
      // A new candidate owes the citation it names a re-projection.
      expect(await intents(db.admin, ids.citationA1)).toBe(owed + 1);

      const [still] = await db.admin.query<{ state: string }>(
        `SELECT [state] FROM [dbo].[HadithCitation] WHERE [id] = ${n(ids.citationA1)};`,
      );
      expect(still?.state).toBe('mapped');
      expect(await reader.citation(SLUG.a, 1)).toBeNull();
      expect(await reader.publicCitationTargets([ids.citationA1])).toEqual([]);
      expect(await reader.searchCitationRecords([ids.citationA1])).toEqual([]);
      expect((await reader.browse(0)).items.map((item) => item.collectionSlug)).toEqual([
        SLUG.b,
      ]);
      expect(
        await reasonOf(
          canonical.setCitation({
            authority: editor,
            value: {
              collectionId: ids.collectionA,
              number: 1,
              hadithId: ids.r1,
              state: 'mapped',
              expectedVersion: 3,
              evidence: sentinel('EVIDENCE', 5),
              reason: 'NON_HADITH_FIXTURE citation review',
            },
          }),
        ),
      ).toBe('citation-conflicted');
    });

    it('beside an APPROVED section, shows only approved sources and lists the sitemap', async () => {
      const map = (
        number: number,
        hadithId: string,
        expectedVersion: number,
        state: 'mapped' | 'withdrawn' = 'mapped',
      ) =>
        canonical.setCitation({
          authority: editor,
          value: {
            collectionId: ids.collectionC,
            number,
            hadithId,
            state,
            expectedVersion,
            evidence: sentinel('EVIDENCE', 6),
            reason: expectedVersion === 0 ? null : 'NON_HADITH_FIXTURE citation review',
          },
        });

      ids.rC = (
        await canonical.createRecord({
          authority: editor,
          value: record({
            editionId: ids.editionC,
            sourceReference: SHARED_REFERENCE,
            citationNumber: 1,
            bookId: ids.bookC,
            text: `${sentinel('TEXT', 30)} ${NEUTRAL}`,
          }),
        })
      ).id;
      ids.rCFixture = (
        await canonical.createRecord({
          authority: editor,
          value: record({
            editionId: ids.editionCFixture,
            sourceReference: SHARED_REFERENCE,
            citationNumber: 2,
            bookId: ids.bookCFixture,
            text: `${sentinel('TEXT', 31)} ${NEUTRAL}`,
          }),
        })
      ).id;
      await verify(ids.rC);
      await verify(ids.rCFixture);
      const c1 = await map(1, ids.rC, 0);
      // While collection C is not approved, a fixture record may be mapped.
      await map(2, ids.rCFixture, 0);

      for (const [sourceSystemId, text] of [
        [approvedSource, sentinel('TRANSLATION', 30)],
        [fixtureA, sentinel('TRANSLATION', 31)],
      ] as const) {
        const created = await hadith.createTranslation(administrator, {
          hadithId: ids.rC,
          value: {
            languageCode: 'en',
            text,
            attribution: null,
            sourceSystemId,
            contributors: [],
          },
        });
        await hadith.setTranslationState(administrator, {
          id: created.id,
          expectedVersion: 1,
          state: 'published',
        });
      }
      const approvedCommentary = await hadith.createCommentary(administrator, {
        slug: SLUG.commentaryApproved,
        name: 'NON_HADITH_FIXTURE approved commentary',
        description: null,
        attribution: null,
        languageCode: 'en',
        sourceSystemId: approvedSource,
        contributors: [],
      });
      const entry = await hadith.saveCommentaryEntry(administrator, {
        id: approvedCommentary.id,
        expectedVersion: 1,
        value: { hadithId: ids.rC, text: sentinel('COMMENTARY', 30) },
      });
      await hadith.setCommentaryState(administrator, {
        id: approvedCommentary.id,
        expectedVersion: entry.version,
        state: 'published',
      });
      const fixtureCommentary = await persistence.commentary(ids.commentary);
      await hadith.saveCommentaryEntry(administrator, {
        id: ids.commentary,
        expectedVersion: fixtureCommentary!.version,
        value: { hadithId: ids.rC, text: sentinel('COMMENTARY', 31) },
      });
      const approvedScience = await hadith.createScience(administrator, {
        slug: SLUG.scienceApproved,
        position: 2,
        attribution: null,
        sourceSystemId: approvedSource,
        texts: [
          {
            languageCode: 'en',
            title: 'NON_HADITH_FIXTURE science C',
            body: sentinel('SCIENCE', 30),
          },
        ],
      });
      await hadith.setScienceState(administrator, {
        id: approvedScience.id,
        expectedVersion: 1,
        state: 'published',
      });

      // Every activation shares one authority...
      expect(await sqlNumber(activate(db.admin, ids.collectionC, 'approved'))).toBe(
        51206,
      );
      await deactivateAll(db.admin);
      // ...and an approved collection holds no mapped fixture record.
      expect(await sqlNumber(activate(db.admin, ids.collectionC, 'approved'))).toBe(
        51205,
      );
      expect(await sqlNumber(activate(db.admin, ids.collectionB, 'approved'))).toBe(
        51205,
      );
      expect(await count(db.admin, 'HadithActivation')).toBe(0);
      await map(2, ids.rCFixture, 1, 'withdrawn');
      await activate(db.admin, ids.collectionC, 'approved');
      // Once approved, no fixture record can be mapped into it.
      expect(await reasonOf(map(2, ids.rCFixture, 2))).toBe('fixture-over-approved');

      expect(await reader.availability()).toEqual({ active: true, mode: 'approved' });
      expect((await reader.collections()).map((collection) => collection.slug)).toEqual([
        SLUG.c,
      ]);
      expect(await reader.citation(SLUG.b, 1)).toBeNull();
      expect(await reader.citation(SLUG.c, 2)).toBeNull();
      const citation = await reader.citation(SLUG.c, 1);
      expect(citation?.translations.map((t) => t.text)).toEqual([
        sentinel('TRANSLATION', 30),
      ]);
      expect(citation?.commentary.map((work) => work.slug)).toEqual([
        SLUG.commentaryApproved,
      ]);
      expect((await reader.commentaries()).map((work) => work.slug)).toEqual([
        SLUG.commentaryApproved,
      ]);
      expect((await reader.sciences()).map((science) => science.slug)).toEqual([
        SLUG.scienceApproved,
      ]);
      expect(await reader.science(SLUG.science)).toBeNull();
      expect(
        (await reader.searchCitationRecords([c1.id]))[0]?.translations.map((t) => t.text),
      ).toEqual([sentinel('TRANSLATION', 30)]);

      const sitemap = await reader.citationSitemap(0, 100);
      expect(sitemap.map((entry) => `${entry.collectionSlug}:${entry.number}`)).toEqual([
        `${SLUG.c}:1`,
      ]);
      expect(sitemap[0]?.lastModified).toBeInstanceOf(Date);
    });
  });

  /* ======================================================================
   * What administration can and cannot reach; audit
   * ==================================================================== */

  describe('administration and audit', () => {
    it('offers hadith.administer no canonical write at all', () => {
      for (const operation of [
        'createCollection',
        'createBook',
        'createChapter',
        'createRecord',
        'correctRecord',
        'verifyRecord',
        'setCitation',
      ]) {
        expect(operation in hadith, operation).toBe(false);
        expect(operation in persistence, operation).toBe(false);
      }
    });

    it('audits canonical and layered operations', async () => {
      for (const action of [
        'hadith.collection.created',
        'hadith.book.created',
        'hadith.chapter.created',
        'hadith.record.created',
        'hadith.record.corrected',
        'hadith.record.verified',
        'hadith.citation.set',
        'hadith.translation.created',
        'hadith.translation.updated',
        'hadith.translation.state-changed',
        'hadith.commentary.created',
        'hadith.commentary.entry-saved',
        'hadith.commentary.state-changed',
        'hadith.science.created',
        'hadith.science.updated',
        'hadith.science.state-changed',
        'hadith.collection.names-saved',
      ])
        expect(
          await count(db.admin, 'AuditLog', `[action] = ${n(action)}`),
          action,
        ).toBeGreaterThan(0);
      // Canonical entries name the step-up grant that authorised them; layered
      // ones the administrative permission.
      expect(
        await count(
          db.admin,
          'AuditLog',
          `[action] IN (N'hadith.record.created', N'hadith.record.corrected', N'hadith.record.verified', N'hadith.citation.set') AND [authorisingSource] <> ${n(`step-up:${editor.stepUpGrantId}`)}`,
        ),
      ).toBe(0);
      // One for the first record, the ceiling's worth for the capped one; every
      // one authorised by the administrative permission.
      expect(
        await count(
          db.admin,
          'AuditLog',
          "[action] = N'hadith.record.topic-added' AND [authorisingSource] = N'hadith.administer'",
        ),
      ).toBe(1 + HADITH_LIMITS.topicsPerRecord);
      expect(
        await count(
          db.admin,
          'AuditLog',
          "[action] = N'hadith.record.topic-added' AND [authorisingSource] <> N'hadith.administer'",
        ),
      ).toBe(0);
    });

    it('never writes Hadith text, chain, grading or layered text into the audit log', async () => {
      const leaked = await count(
        db.admin,
        'AuditLog',
        `[action] LIKE N'hadith.%' AND (CHARINDEX(N'NON_HADITH_FIXTURE', CONCAT([beforeState], [afterState])) > 0 OR CHARINDEX(${n(NEUTRAL)}, CONCAT([beforeState], [afterState])) > 0)`,
      );
      expect(leaked).toBe(0);
      expect(
        await count(db.admin, 'AuditLog', "[action] LIKE N'hadith.%'"),
      ).toBeGreaterThan(30);
    });
  });
});
