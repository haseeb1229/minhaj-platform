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
  type FatwaDispositionPort,
  type FatwaOwnerPort,
  type FatwaPublicationAuthority,
  type FatwaPublicReaderPort,
  type FatwaReadTallyPort,
  type FatwaStaffReaderPort,
  type FatwaWorkflowPort,
  type RevisionDraftValue,
} from '../../packages/contracts/src/fatwa/index.ts';
import { PLATFORM_ADMINISTRATOR_PERMISSIONS } from '../../packages/contracts/src/identity/index.ts';
import {
  createProofDatabase,
  databaseConfigured,
  type DisposableDatabase,
} from '../identity/harness.ts';
import { createProofAccount } from '../people/harness.ts';
import {
  accesses,
  accountWithRole,
  activate,
  closeAccount,
  count,
  grantFor,
  intents,
  n,
  revoke,
  sentinel,
  sessionFor,
  topic,
} from './fixture-sql.ts';

/**
 * Phase 20 — the Fatwa adapters over a REAL SQL Server, running as the REAL
 * least-privilege RUNTIME principal.
 *
 * WHAT ONLY THE DATABASE CAN PROVE: that the runtime principal writes no
 * question, ruling, revision or publication except through the procedures;
 * that every procedure re-checks the actor's LIVE permission — and, to publish
 * or withdraw, a live `fatwa-publication` grant bound to that account's
 * session — whatever the application already decided; that every staff read
 * is scoped IN SQL to what the actor's stage may see now; that a private
 * question's text is read only by the detail reads, each of which records ONE
 * audited access in the same transaction and never the text; that history is
 * kept across corrections and withdrawal; that popularity counts only public
 * rulings over the trailing window with a total order; and that disposal erases
 * the private text while the public ruling stays.
 *
 * TWO CONNECTIONS, TWO ROLES. The owner/migration session writes what only an
 * operator or Identity may write — the activation, accounts, roles, grants,
 * topics, closure and revocation — and inspects. EVERYTHING the application
 * does goes through the adapters, whose Prisma client is bound to the
 * provisioned RUNTIME principal.
 *
 * NOTHING HERE IS A RULING OR A REAL QUESTION (see `./fixture-sql.ts`).
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

/** The private question's sentinel prefix — never in a list, a public read or an audit row. */
const PRIVATE_TEXT = 'NON_FATWA_FIXTURE_QUESTION';

interface Holder {
  readonly accountId: string;
  readonly roleId: string;
}

live('Phase 20 Fatwa against real SQL Server, as the runtime principal', () => {
  let db: DisposableDatabase;
  /** The runtime principal on the disposable database, for direct denial proofs. */
  let app: SqlSession;
  let reader: FatwaPublicReaderPort;
  let owner: FatwaOwnerPort;
  let workflow: FatwaWorkflowPort;
  let staff: FatwaStaffReaderPort;
  let tally: FatwaReadTallyPort;
  let disposition: FatwaDispositionPort;
  let holders: {
    holders(
      permission: string,
      limit: number,
    ): Promise<readonly { accountId: string; name: string }[]>;
  };

  /* ---- people ------------------------------------------------------------ */

  let receiver: string;
  let answerer: string;
  let otherAnswerer: string;
  let revocable: Holder;
  let author: string;
  let adminLike: string;
  let askerA: string;
  let askerB: string;
  /** A `fatwa.answer` holder who also asks: never assignable to their own question. */
  let askingAnswerer: string;

  let publisher: FatwaPublicationAuthority;
  let authorAuthority: FatwaPublicationAuthority;
  let adminLikeAuthority: FatwaPublicationAuthority;
  let receiverAuthority: FatwaPublicationAuthority;

  /* ---- taxonomy and categories ------------------------------------------- */

  const topics = { t1: '', t2: '', t3: '', t4: '' };
  const categories = { a: randomUUID(), b: randomUUID() };

  /* ---- what the proofs build --------------------------------------------- */

  const q = { one: '', two: '', three: '', four: '', six: '', seven: '' };
  const f = { one: randomUUID(), four: randomUUID(), five: '', six: '', seven: '' };
  const r = {
    one: randomUUID(),
    two: randomUUID(),
    three: randomUUID(),
    four: randomUUID(),
  };
  const SLUG = { one: 'fixture-ruling-one', four: 'fixture-ruling-four' };

  async function ask(asker: string, index: number): Promise<string> {
    const id = randomUUID();
    await owner.submit({
      id,
      askerId: asker,
      value: { body: sentinel('QUESTION', index) },
    });
    return id;
  }

  async function versionOf(
    table: 'FatwaQuestion' | 'Fatwa',
    id: string,
  ): Promise<number> {
    const [row] = await db.admin.query<{ version: number }>(
      `SELECT [version] FROM [dbo].[${table}] WHERE [id] = ${n(id)};`,
    );
    if (row === undefined) throw new Error(`fixture ${table} missing`);
    return Number(row.version);
  }

  function draft(
    over: Pick<RevisionDraftValue, 'questionId' | 'expectedVersion' | 'slug'> &
      Partial<RevisionDraftValue>,
    index = 1,
  ): RevisionDraftValue {
    return {
      title: sentinel('TITLE', index),
      publicQuestion: sentinel('PUBLIC_QUESTION', index),
      ruling: sentinel('RULING', index),
      language: 'en',
      categoryId: categories.a,
      topicIds: [],
      correctionReason: null,
      ...over,
    };
  }

  /** The whole path from a question to a public ruling, by the proper hands. */
  async function publishRuling(input: {
    readonly index: number;
    readonly slug: string;
    readonly categoryId: string;
    readonly topicIds: readonly string[];
  }): Promise<{ questionId: string; fatwaId: string }> {
    const questionId = await ask(askerB, input.index);
    await workflow.triage({
      actorId: receiver,
      value: { id: questionId, expectedVersion: 1, categoryId: input.categoryId },
    });
    await workflow.assign({
      actorId: receiver,
      value: { id: questionId, expectedVersion: 2, assigneeId: answerer },
    });
    const fatwaId = randomUUID();
    const revisionId = randomUUID();
    await workflow.saveDraft({
      actorId: answerer,
      fatwaId,
      revisionId,
      value: draft(
        {
          questionId,
          expectedVersion: 0,
          slug: input.slug,
          categoryId: input.categoryId,
          topicIds: [...input.topicIds],
        },
        input.index,
      ),
    });
    await workflow.submitForReview({
      actorId: answerer,
      value: { fatwaId, expectedVersion: 2, revisionId },
    });
    await workflow.publish({
      authority: publisher,
      publicationId: randomUUID(),
      value: { fatwaId, expectedVersion: 3, revisionId },
    });
    return { questionId, fatwaId };
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
    reader = database.createFatwaPublicReader();
    owner = database.createFatwaOwner();
    workflow = database.createFatwaWorkflow();
    staff = database.createFatwaStaffReader();
    tally = database.createFatwaReadTally();
    disposition = database.createFatwaDisposition();
    holders = database.createPermissionHolderReader();

    receiver = (await accountWithRole(db.admin, ['question.receive'])).accountId;
    answerer = (await accountWithRole(db.admin, ['fatwa.answer'])).accountId;
    otherAnswerer = (await accountWithRole(db.admin, ['fatwa.answer'])).accountId;
    revocable = await accountWithRole(db.admin, ['fatwa.answer']);
    askingAnswerer = (await accountWithRole(db.admin, ['fatwa.answer'])).accountId;
    author = (await accountWithRole(db.admin, ['fatwa.answer', 'fatwa.publish']))
      .accountId;
    // Every key the protected administrator bundle carries — none of the three
    // externally gated Fatwa keys among them.
    adminLike = (await accountWithRole(db.admin, PLATFORM_ADMINISTRATOR_PERMISSIONS))
      .accountId;
    askerA = await createProofAccount(db.admin);
    askerB = await createProofAccount(db.admin);

    const authorityOf = async (actorId: string): Promise<FatwaPublicationAuthority> => {
      const sessionId = await sessionFor(db.admin, actorId);
      return {
        actorId,
        sessionId,
        stepUpGrantId: await grantFor(db.admin, actorId, sessionId, 'fatwa-publication'),
      };
    };
    publisher = await authorityOf(
      (await accountWithRole(db.admin, ['fatwa.publish'])).accountId,
    );
    authorAuthority = await authorityOf(author);
    adminLikeAuthority = await authorityOf(adminLike);
    receiverAuthority = await authorityOf(receiver);

    topics.t1 = await topic(db.admin, 'fixture-fatwa-topic-one');
    topics.t2 = await topic(db.admin, 'fixture-fatwa-topic-two');
    topics.t3 = await topic(db.admin, 'fixture-fatwa-topic-three');
    topics.t4 = await topic(db.admin, 'fixture-fatwa-topic-four');
  }, 240_000);

  afterAll(async () => {
    await app?.close();
    await db?.close();
  });

  /* ======================================================================
   * The runtime principal's own reach
   * ==================================================================== */

  describe('the runtime principal writes the workflow only through the procedures', () => {
    it.each(['Fatwa', 'FatwaQuestion', 'FatwaRevision', 'FatwaPublication'])(
      'refuses INSERT into %s',
      async (table) => {
        expect(
          await sqlNumber(
            app.query(
              `INSERT INTO [dbo].[${table}] SELECT * FROM [dbo].[${table}] WHERE 1 = 0`,
            ),
          ),
        ).toBe(229);
      },
    );

    it.each([
      ['Fatwa', '[slug] = [slug]'],
      ['FatwaQuestion', '[body] = [body]'],
      ['FatwaRevision', '[ruling] = [ruling]'],
      ['FatwaPublication', '[sequence] = [sequence]'],
    ])('refuses UPDATE of %s (%s)', async (table, assignment) => {
      expect(
        await sqlNumber(
          app.query(`UPDATE [dbo].[${table}] SET ${assignment} WHERE 1 = 0`),
        ),
      ).toBe(229);
    });

    it('cannot call the internal authority check the procedures use', async () => {
      expect(
        await sqlNumber(
          app.query(
            `EXEC [dbo].[FatwaAssertPermission] @actorId = ${n(receiver)}, @permission = N'question.receive'`,
          ),
        ),
      ).toBe(229);
    });
  });

  /* ======================================================================
   * Activation
   * ==================================================================== */

  describe('without an activation', () => {
    it('accepts no question and shows nothing', async () => {
      expect(await reasonOf(ask(askerA, 90))).toBe('inactive');
      expect(await count(db.admin, 'FatwaQuestion')).toBe(0);
      expect(await reader.availability()).toEqual({ active: false });
      expect(await reader.categories()).toEqual([]);
      expect(
        await reader.browse({
          sort: 'latest',
          categoryId: null,
          topicId: null,
          offset: 0,
        }),
      ).toEqual({ items: [], total: 0, offset: 0 });
    });
  });

  describe('with a fixture activation', () => {
    it('reports the fixture mode', async () => {
      await activate(db.admin, 'fixture');
      expect(await reader.availability()).toEqual({ active: true, mode: 'fixture' });
    });

    it('offers no fixture ruling to a crawler', async () => {
      expect(await reader.sitemap(0, 100)).toEqual([]);
    });
  });

  /* ======================================================================
   * Categories
   * ==================================================================== */

  describe('categories', () => {
    it('are created under fatwa.publish only, audited without their names', async () => {
      expect(
        await reasonOf(
          workflow.createCategory({
            actorId: receiver,
            id: randomUUID(),
            value: {
              slug: 'fixture-category-refused',
              topicId: topics.t1,
              position: 9,
              names: [{ locale: 'en', name: sentinel('CATEGORY', 9) }],
            },
          }),
        ),
      ).toBe('denied');
      await workflow.createCategory({
        actorId: publisher.actorId,
        id: categories.a,
        value: {
          slug: 'fixture-category-a',
          topicId: topics.t1,
          position: 1,
          names: [
            { locale: 'en', name: sentinel('CATEGORY', 1) },
            { locale: 'ur', name: sentinel('CATEGORY', 2) },
          ],
        },
      });
      await workflow.createCategory({
        actorId: publisher.actorId,
        id: categories.b,
        value: {
          slug: 'fixture-category-b',
          topicId: topics.t2,
          position: 2,
          names: [{ locale: 'en', name: sentinel('CATEGORY', 3) }],
        },
      });
      expect(
        await reasonOf(
          workflow.createCategory({
            actorId: publisher.actorId,
            id: randomUUID(),
            value: {
              slug: 'fixture-category-a',
              topicId: topics.t1,
              position: 3,
              names: [{ locale: 'en', name: sentinel('CATEGORY', 4) }],
            },
          }),
        ),
      ).toBe('duplicate-slug');
      expect(
        await count(db.admin, 'AuditLog', `[action] = N'fatwa.category.created'`),
      ).toBe(2);
      expect(
        (await staff.categories(receiver)).map((category) => [
          category.slug,
          category.names,
        ]),
      ).toEqual([
        [
          'fixture-category-a',
          [
            { locale: 'en', name: sentinel('CATEGORY', 1) },
            { locale: 'ur', name: sentinel('CATEGORY', 2) },
          ],
        ],
        ['fixture-category-b', [{ locale: 'en', name: sentinel('CATEGORY', 3) }]],
      ]);
      // An account holding none of the three keys reads no category.
      expect(await staff.categories(adminLike)).toEqual([]);
    });
  });

  /* ======================================================================
   * The asker
   * ==================================================================== */

  describe('the asker', () => {
    it('submits, and reads only their own questions', async () => {
      q.one = await ask(askerA, 1);
      q.two = await ask(askerB, 2);
      q.three = await ask(askingAnswerer, 3);
      expect(await owner.question(askerB, q.one)).toBeNull();
      const own = await owner.question(askerA, q.one);
      expect(own).toMatchObject({
        id: q.one,
        status: 'received',
        body: sentinel('QUESTION', 1),
        answerSlug: null,
      });
      const page = await owner.questions(askerA, 0);
      expect(page.total).toBe(1);
      expect(page.items.map((item) => item.id)).toEqual([q.one]);
      expect(Object.keys(page.items[0] ?? {})).not.toContain('body');
      expect(JSON.stringify(page)).not.toContain(PRIVATE_TEXT);
    });
  });

  /* ======================================================================
   * Intake
   * ==================================================================== */

  describe('intake under question.receive', () => {
    it('lists without the text, and only for a current holder', async () => {
      const page = await staff.intake(receiver, 0);
      expect(page.items.map((item) => item.id).sort()).toEqual(
        [q.one, q.two, q.three].sort(),
      );
      expect(page.items.every((item) => !('body' in item))).toBe(true);
      expect(JSON.stringify(page)).not.toContain(PRIVATE_TEXT);
      expect((await staff.intake(answerer, 0)).total).toBe(0);
      expect((await staff.intake(adminLike, 0)).total).toBe(0);
    });

    it('reads one question as an audited access, and records nothing when it reads nothing', async () => {
      expect(await staff.intakeQuestion(answerer, q.one)).toBeNull();
      expect(await accesses(db.admin, q.one, 'intake')).toBe(0);
      const detail = await staff.intakeQuestion(receiver, q.one);
      expect(detail).toMatchObject({
        id: q.one,
        stage: 'submitted',
        body: sentinel('QUESTION', 1),
      });
      expect(await accesses(db.admin, q.one, 'intake')).toBe(1);
      const [row] = await db.admin.query<{ actorId: string; authorisingSource: string }>(
        `SELECT [actorId],[authorisingSource] FROM [dbo].[AuditLog] WHERE [action] = N'fatwa.question.accessed' AND [targetId] = ${n(q.one)};`,
      );
      expect(row).toEqual({ actorId: receiver, authorisingSource: 'question.receive' });
    });

    it('triages under the expected version only, and only for a holder', async () => {
      expect(
        await reasonOf(
          workflow.triage({
            actorId: answerer,
            value: { id: q.one, expectedVersion: 1, categoryId: categories.a },
          }),
        ),
      ).toBe('denied');
      expect(
        await reasonOf(
          workflow.triage({
            actorId: adminLike,
            value: { id: q.one, expectedVersion: 1, categoryId: categories.a },
          }),
        ),
      ).toBe('denied');
      await workflow.triage({
        actorId: receiver,
        value: { id: q.one, expectedVersion: 1, categoryId: categories.a },
      });
      expect(
        await reasonOf(
          workflow.triage({
            actorId: receiver,
            value: { id: q.one, expectedVersion: 1, categoryId: categories.b },
          }),
        ),
      ).toBe('conflict');
      expect(
        await reasonOf(
          workflow.triage({
            actorId: receiver,
            value: { id: randomUUID(), expectedVersion: 1, categoryId: categories.a },
          }),
        ),
      ).toBe('not-found');
    });

    it('lets exactly one of two simultaneous triages with the same version win', async () => {
      const outcomes = await Promise.all([
        reasonOf(
          workflow.triage({
            actorId: receiver,
            value: { id: q.two, expectedVersion: 1, categoryId: categories.a },
          }),
        ),
        reasonOf(
          workflow.triage({
            actorId: receiver,
            value: { id: q.two, expectedVersion: 1, categoryId: categories.b },
          }),
        ),
      ]);
      expect(outcomes.sort()).toEqual(['accepted', 'conflict']);
      expect(await versionOf('FatwaQuestion', q.two)).toBe(2);
    });

    it('assigns only to a live fatwa.answer holder who is not the asker', async () => {
      await workflow.triage({
        actorId: receiver,
        value: { id: q.three, expectedVersion: 1, categoryId: categories.a },
      });
      expect(
        await reasonOf(
          workflow.assign({
            actorId: receiver,
            value: { id: q.three, expectedVersion: 2, assigneeId: askingAnswerer },
          }),
        ),
      ).toBe('invalid-assignee');
      expect(
        await reasonOf(
          workflow.assign({
            actorId: receiver,
            value: { id: q.one, expectedVersion: 2, assigneeId: askerB },
          }),
        ),
      ).toBe('invalid-assignee');
      expect(
        await reasonOf(
          workflow.assign({
            actorId: answerer,
            value: { id: q.one, expectedVersion: 2, assigneeId: answerer },
          }),
        ),
      ).toBe('denied');
      await workflow.assign({
        actorId: receiver,
        value: { id: q.one, expectedVersion: 2, assigneeId: answerer },
      });
      expect(
        await reasonOf(
          workflow.assign({
            actorId: receiver,
            value: { id: q.one, expectedVersion: 2, assigneeId: otherAnswerer },
          }),
        ),
      ).toBe('conflict');
    });

    it('offers current fatwa.answer holders by name, as Identity answers', async () => {
      const choices = await holders.holders('fatwa.answer', 200);
      const ids = choices.map((choice) => choice.accountId);
      for (const id of [
        answerer,
        otherAnswerer,
        revocable.accountId,
        askingAnswerer,
        author,
      ])
        expect(ids).toContain(id);
      expect(ids).not.toContain(receiver);
      expect(ids).not.toContain(adminLike);
    });

    it('declines a question in intake, and refuses an illegal or stale decline', async () => {
      await workflow.decline({
        actorId: receiver,
        value: { id: q.two, expectedVersion: 2 },
      });
      expect(
        await reasonOf(
          workflow.decline({
            actorId: receiver,
            value: { id: q.two, expectedVersion: 3 },
          }),
        ),
      ).toBe('invalid-state');
      expect(
        await reasonOf(
          workflow.decline({
            actorId: receiver,
            value: { id: q.two, expectedVersion: 2 },
          }),
        ),
      ).toBe('conflict');
      expect(await owner.question(askerB, q.two)).toMatchObject({ status: 'declined' });
    });

    it('refuses an archived category', async () => {
      await workflow.updateCategory({
        actorId: publisher.actorId,
        value: {
          id: categories.b,
          expectedVersion: 1,
          topicId: topics.t2,
          position: 2,
          status: 'archived',
          names: [{ locale: 'en', name: sentinel('CATEGORY', 3) }],
        },
      });
      expect(
        await reasonOf(
          workflow.triage({
            actorId: receiver,
            value: { id: q.three, expectedVersion: 2, categoryId: categories.b },
          }),
        ),
      ).toBe('invalid-category');
      await workflow.updateCategory({
        actorId: publisher.actorId,
        value: {
          id: categories.b,
          expectedVersion: 2,
          topicId: topics.t2,
          position: 2,
          status: 'active',
          names: [{ locale: 'en', name: sentinel('CATEGORY', 3) }],
        },
      });
    });
  });

  /* ======================================================================
   * Drafting
   * ==================================================================== */

  describe('drafting under fatwa.answer, by the assignee only', () => {
    it('lists the assigned question in the assignment view, scoped to question.receive, without its text', async () => {
      const page = await staff.assignment(receiver, 0);
      expect(page.items.map((item) => item.id)).toContain(q.one);
      expect(page.items.every((item) => item.assigneeId !== null)).toBe(true);
      expect(JSON.stringify(page)).not.toContain(PRIVATE_TEXT);
      expect((await staff.assignment(answerer, 0)).total).toBe(0);
      expect((await staff.assignment(adminLike, 0)).total).toBe(0);
    });

    it('gives an unassigned answerer nothing and refuses their draft', async () => {
      expect(await staff.assignedQuestion(otherAnswerer, q.one)).toBeNull();
      expect((await staff.assigned(otherAnswerer, 0)).total).toBe(0);
      expect(
        await reasonOf(
          workflow.saveDraft({
            actorId: otherAnswerer,
            fatwaId: f.one,
            revisionId: r.one,
            value: draft({ questionId: q.one, expectedVersion: 0, slug: SLUG.one }),
          }),
        ),
      ).toBe('denied');
      expect(await accesses(db.admin, q.one, 'assigned')).toBe(0);
    });

    it('lets the assignee read the question as an audited access and save a first draft', async () => {
      const page = await staff.assigned(answerer, 0);
      expect(page.items.map((item) => item.id)).toEqual([q.one]);
      expect(JSON.stringify(page)).not.toContain(PRIVATE_TEXT);
      expect(await staff.assignedQuestion(answerer, q.one)).toMatchObject({
        stage: 'assigned',
        body: sentinel('QUESTION', 1),
      });
      expect(await accesses(db.admin, q.one, 'assigned')).toBe(1);

      // A first draft states no correction reason.
      expect(
        await reasonOf(
          workflow.saveDraft({
            actorId: answerer,
            fatwaId: f.one,
            revisionId: r.one,
            value: draft({
              questionId: q.one,
              expectedVersion: 0,
              slug: SLUG.one,
              correctionReason: sentinel('REASON', 9),
            }),
          }),
        ),
      ).toBe('correction-reason');
      await workflow.saveDraft({
        actorId: answerer,
        fatwaId: f.one,
        revisionId: r.one,
        value: draft({
          questionId: q.one,
          expectedVersion: 0,
          slug: SLUG.one,
          topicIds: [topics.t3],
        }),
      });
      expect(await versionOf('Fatwa', f.one)).toBe(2);
      const record = await staff.assignedFatwa(answerer, q.one);
      expect(record).toMatchObject({
        id: f.one,
        reviewState: 'drafting',
        pendingRevisionId: r.one,
      });
      expect(record?.revisions.map((revision) => revision.topicIds)).toEqual([
        [topics.t3],
      ]);
      expect(await staff.assignedFatwa(otherAnswerer, q.one)).toBeNull();
      // Nothing is public, and the asker is told only "in progress".
      expect(await reader.fatwa(SLUG.one)).toBeNull();
      expect(await owner.question(askerA, q.one)).toMatchObject({
        status: 'in_progress',
      });
    });
  });

  /* ======================================================================
   * Review
   * ==================================================================== */

  describe('review under fatwa.publish', () => {
    it('shows the publisher the question only while the ruling is under review', async () => {
      expect(await staff.reviewQuestion(publisher.actorId, f.one)).toBeNull();
      expect((await staff.reviewQueue(publisher.actorId, 0)).total).toBe(0);
      await workflow.submitForReview({
        actorId: answerer,
        value: { fatwaId: f.one, expectedVersion: 2, revisionId: r.one },
      });
      const queue = await staff.reviewQueue(publisher.actorId, 0);
      expect(queue.items.map((item) => [item.id, item.title])).toEqual([
        [f.one, sentinel('TITLE', 1)],
      ]);
      expect((await staff.reviewQueue(answerer, 0)).total).toBe(0);
      expect(await staff.reviewFatwa(publisher.actorId, f.one)).toMatchObject({
        reviewState: 'in_review',
      });
      expect(await staff.reviewQuestion(answerer, f.one)).toBeNull();
      expect(await staff.reviewQuestion(publisher.actorId, f.one)).toMatchObject({
        id: q.one,
        stage: 'in_review',
        body: sentinel('QUESTION', 1),
      });
      expect(await accesses(db.admin, q.one, 'review')).toBe(1);

      await workflow.returnForRevision({
        actorId: publisher.actorId,
        value: {
          fatwaId: f.one,
          expectedVersion: 3,
          revisionId: r.one,
          note: sentinel('NOTE', 1),
        },
      });
      expect(await staff.reviewQuestion(publisher.actorId, f.one)).toBeNull();
      expect(await accesses(db.admin, q.one, 'review')).toBe(1);
      const record = await staff.assignedFatwa(answerer, q.one);
      expect(record?.notes.map((note) => [note.decision, note.note])).toEqual([
        ['returned', sentinel('NOTE', 1)],
      ]);

      await workflow.saveDraft({
        actorId: answerer,
        fatwaId: f.one,
        revisionId: r.two,
        value: draft(
          {
            questionId: q.one,
            expectedVersion: 4,
            slug: SLUG.one,
            topicIds: [topics.t3],
          },
          2,
        ),
      });
      await workflow.submitForReview({
        actorId: answerer,
        value: { fatwaId: f.one, expectedVersion: 5, revisionId: r.two },
      });
    });

    it('refuses publication without fatwa.publish and a live fatwa-publication grant of this session', async () => {
      const value = { fatwaId: f.one, expectedVersion: 6, revisionId: r.two };
      const otherSession = await sessionFor(db.admin, publisher.actorId);
      const revokedPublisher = await accountWithRole(db.admin, ['fatwa.publish']);
      const revokedSession = await sessionFor(db.admin, revokedPublisher.accountId);
      const revokedAuthority = {
        actorId: revokedPublisher.accountId,
        sessionId: revokedSession,
        stepUpGrantId: await grantFor(
          db.admin,
          revokedPublisher.accountId,
          revokedSession,
          'fatwa-publication',
        ),
      };
      await revoke(db.admin, revokedPublisher);
      const refused: readonly FatwaPublicationAuthority[] = [
        {
          ...publisher,
          stepUpGrantId: await grantFor(
            db.admin,
            publisher.actorId,
            publisher.sessionId,
            'hadith-canonical-edit',
          ),
        },
        {
          ...publisher,
          stepUpGrantId: await grantFor(
            db.admin,
            publisher.actorId,
            publisher.sessionId,
            'fatwa-publication',
            -5,
          ),
        },
        {
          ...publisher,
          stepUpGrantId: await grantFor(
            db.admin,
            publisher.actorId,
            otherSession,
            'fatwa-publication',
          ),
        },
        revokedAuthority,
        receiverAuthority,
        adminLikeAuthority,
      ];
      for (const authority of refused)
        expect(
          await reasonOf(
            workflow.publish({ authority, publicationId: randomUUID(), value }),
          ),
        ).toBe('step-up-required');
      expect(await versionOf('Fatwa', f.one)).toBe(6);
      expect(await count(db.admin, 'FatwaPublication')).toBe(0);
    });

    it('never lets the author of a revision publish it', async () => {
      q.four = await ask(askerB, 4);
      await workflow.triage({
        actorId: receiver,
        value: { id: q.four, expectedVersion: 1, categoryId: categories.a },
      });
      await workflow.assign({
        actorId: receiver,
        value: { id: q.four, expectedVersion: 2, assigneeId: author },
      });
      await workflow.saveDraft({
        actorId: author,
        fatwaId: f.four,
        revisionId: r.four,
        value: draft({ questionId: q.four, expectedVersion: 0, slug: SLUG.four }, 4),
      });
      await workflow.submitForReview({
        actorId: author,
        value: { fatwaId: f.four, expectedVersion: 2, revisionId: r.four },
      });
      expect(
        await reasonOf(
          workflow.publish({
            authority: authorAuthority,
            publicationId: randomUUID(),
            value: { fatwaId: f.four, expectedVersion: 3, revisionId: r.four },
          }),
        ),
      ).toBe('self-publication');
    });

    it('publishes under a proper authority, answers the question and owes Search a pass', async () => {
      const before = await intents(db.admin, f.one);
      await workflow.publish({
        authority: publisher,
        publicationId: randomUUID(),
        value: { fatwaId: f.one, expectedVersion: 6, revisionId: r.two },
      });
      expect(await intents(db.admin, f.one)).toBe(before + 1);
      const ruling = await reader.fatwa(SLUG.one);
      expect(ruling).toMatchObject({
        id: f.one,
        categoryId: categories.a,
        topicIds: [topics.t1, topics.t3].sort(),
        current: {
          sequence: 1,
          revisionId: r.two,
          title: sentinel('TITLE', 2),
          correctionReason: null,
        },
        previous: [],
        answeredByPersonId: null,
        publishedByPersonId: null,
      });
      expect(JSON.stringify(ruling)).not.toContain(PRIVATE_TEXT);
      expect(JSON.stringify(ruling)).not.toContain('NON_FATWA_FIXTURE_NOTE');
      expect(await reader.publicId(SLUG.one)).toBe(f.one);
      expect(await owner.question(askerA, q.one)).toMatchObject({
        status: 'answered',
        answerSlug: SLUG.one,
      });

      // The question has left intake and review; the assignee keeps it for corrections.
      expect(await staff.intakeQuestion(receiver, q.one)).toBeNull();
      expect(
        (await staff.intake(receiver, 0)).items.map((item) => item.id),
      ).not.toContain(q.one);
      expect(await staff.reviewQuestion(publisher.actorId, f.one)).toBeNull();
      expect(await accesses(db.admin, q.one, 'intake')).toBe(1);
      expect(await accesses(db.admin, q.one, 'review')).toBe(1);
      expect(await staff.assignedQuestion(answerer, q.one)).toMatchObject({
        stage: 'published',
      });
      expect(await accesses(db.admin, q.one, 'assigned')).toBe(2);

      const published = await staff.published(publisher.actorId, 0);
      expect(published.items.map((item) => [item.id, item.title])).toEqual([
        [f.one, sentinel('TITLE', 2)],
      ]);
      expect((await staff.published(answerer, 0)).total).toBe(0);
      expect(await staff.publishedFatwa(publisher.actorId, f.one)).toMatchObject({
        publishedRevisionId: r.two,
      });
      // Phase 21: the first publication names the asker to tell — and only them.
      expect(await workflow.askerOf({ fatwaId: f.one })).toEqual({
        accountId: askerA,
        questionId: q.one,
      });
    });

    it('publishes a correction as a new revision, keeping the slug and the public history', async () => {
      const version = await versionOf('Fatwa', f.one);
      expect(
        await reasonOf(
          workflow.saveDraft({
            actorId: answerer,
            fatwaId: f.one,
            revisionId: r.three,
            value: draft(
              { questionId: q.one, expectedVersion: version, slug: SLUG.one },
              3,
            ),
          }),
        ),
      ).toBe('correction-reason');
      expect(
        await reasonOf(
          workflow.saveDraft({
            actorId: answerer,
            fatwaId: f.one,
            revisionId: r.three,
            value: draft(
              {
                questionId: q.one,
                expectedVersion: version,
                slug: 'fixture-ruling-moved',
                correctionReason: sentinel('REASON', 1),
              },
              3,
            ),
          }),
        ),
      ).toBe('slug-frozen');
      await workflow.saveDraft({
        actorId: answerer,
        fatwaId: f.one,
        revisionId: r.three,
        value: draft(
          {
            questionId: q.one,
            expectedVersion: version,
            slug: SLUG.one,
            topicIds: [topics.t3],
            correctionReason: sentinel('REASON', 1),
          },
          3,
        ),
      });
      // While the correction is drafted, the public page still shows the published revision.
      expect((await reader.fatwa(SLUG.one))?.current.revisionId).toBe(r.two);
      await workflow.submitForReview({
        actorId: answerer,
        value: { fatwaId: f.one, expectedVersion: version + 1, revisionId: r.three },
      });
      await workflow.publish({
        authority: publisher,
        publicationId: randomUUID(),
        value: { fatwaId: f.one, expectedVersion: version + 2, revisionId: r.three },
      });
      const ruling = await reader.fatwa(SLUG.one);
      expect(ruling?.current).toMatchObject({
        sequence: 2,
        revisionId: r.three,
        correctionReason: sentinel('REASON', 1),
      });
      expect(ruling?.previous.map((entry) => [entry.sequence, entry.revisionId])).toEqual(
        [[1, r.two]],
      );
      const page = await reader.browse({
        sort: 'latest',
        categoryId: null,
        topicId: null,
        offset: 0,
      });
      expect(page.items.find((item) => item.id === f.one)?.correctedAt).toBeInstanceOf(
        Date,
      );
      // A correction answers nobody to tell: the question was answered once.
      expect(await workflow.askerOf({ fatwaId: f.one })).toBeNull();
    });
  });

  /* ======================================================================
   * Withdrawal
   * ==================================================================== */

  describe('withdrawal', () => {
    it('hides a ruling from every public read, with the same authority as publication', async () => {
      await workflow.publish({
        authority: publisher,
        publicationId: randomUUID(),
        value: { fatwaId: f.four, expectedVersion: 3, revisionId: r.four },
      });
      expect(
        (await reader.publicTargets([f.one, f.four])).map((t) => t.fatwaId).sort(),
      ).toEqual([f.one, f.four].sort());
      expect(
        await reasonOf(
          workflow.withdraw({
            authority: receiverAuthority,
            value: { fatwaId: f.four, expectedVersion: 4, reason: sentinel('REASON', 4) },
          }),
        ),
      ).toBe('step-up-required');
      await workflow.withdraw({
        authority: publisher,
        value: { fatwaId: f.four, expectedVersion: 4, reason: sentinel('REASON', 4) },
      });
      expect(await reader.fatwa(SLUG.four)).toBeNull();
      expect(await reader.publicId(SLUG.four)).toBeNull();
      expect(await reader.searchRecord(f.four)).toBeNull();
      expect((await reader.publicTargets([f.one, f.four])).map((t) => t.fatwaId)).toEqual(
        [f.one],
      );
      // The staff history keeps it, withdrawn.
      expect(await staff.publishedFatwa(publisher.actorId, f.four)).toMatchObject({
        withdrawnAt: expect.any(Date),
      });
    });
  });

  /* ======================================================================
   * Public browsing, popularity and topics
   * ==================================================================== */

  describe('public browsing', () => {
    it('counts reads only for public rulings', async () => {
      await tally.record(f.one);
      await tally.record(f.one);
      await tally.record(f.four);
      await tally.record(randomUUID());
      expect(await count(db.admin, 'FatwaReadTally', `[fatwaId] = ${n(f.one)}`)).toBe(1);
      const [row] = await db.admin.query<{ reads: number }>(
        `SELECT [reads] FROM [dbo].[FatwaReadTally] WHERE [fatwaId] = ${n(f.one)};`,
      );
      expect(Number(row?.reads)).toBe(2);
      expect(await count(db.admin, 'FatwaReadTally', `[fatwaId] = ${n(f.four)}`)).toBe(0);
    });

    it('orders popular by the trailing window, then newest, then id', async () => {
      f.five = (
        await publishRuling({
          index: 5,
          slug: 'fixture-ruling-five',
          categoryId: categories.b,
          topicIds: [],
        })
      ).fatwaId;
      f.six = (
        await publishRuling({
          index: 6,
          slug: 'fixture-ruling-six',
          categoryId: categories.a,
          topicIds: [topics.t2],
        })
      ).fatwaId;
      f.seven = (
        await publishRuling({
          index: 7,
          slug: 'fixture-ruling-seven',
          categoryId: categories.b,
          topicIds: [],
        })
      ).fatwaId;
      // Outside the window: forty and thirty days ago. Inside: twenty-nine.
      await db.admin.query(`
        INSERT INTO [dbo].[FatwaReadTally] ([fatwaId],[day],[reads]) VALUES
          (${n(f.five)}, DATEADD(day, -40, CAST(SYSUTCDATETIME() AS DATE)), 100),
          (${n(f.six)}, DATEADD(day, -30, CAST(SYSUTCDATETIME() AS DATE)), 50),
          (${n(f.six)}, DATEADD(day, -29, CAST(SYSUTCDATETIME() AS DATE)), 1);
      `);
      const popular = await reader.browse({
        sort: 'popular',
        categoryId: null,
        topicId: null,
        offset: 0,
      });
      // f.one: 2 reads; f.six: 1; f.seven and f.five: none — newest first.
      expect(popular.items.map((item) => item.id)).toEqual([
        f.one,
        f.six,
        f.seven,
        f.five,
      ]);
      expect(popular.total).toBe(4);
      const latest = await reader.browse({
        sort: 'latest',
        categoryId: null,
        topicId: null,
        offset: 0,
      });
      expect(latest.items.map((item) => item.id)).toEqual([
        f.seven,
        f.six,
        f.five,
        f.one,
      ]);
      expect(JSON.stringify(latest)).not.toContain(PRIVATE_TEXT);
      // Offsets are clamped, never trusted.
      expect(
        (
          await reader.browse({
            sort: 'latest',
            categoryId: null,
            topicId: null,
            offset: -5,
          })
        ).offset,
      ).toBe(0);
      expect(
        (
          await reader.browse({
            sort: 'latest',
            categoryId: null,
            topicId: null,
            offset: 10_000_000,
          })
        ).offset,
      ).toBe(10_000);
    });

    it('puts a ruling on a topic by its category OR its current revision', async () => {
      const on = async (topicId: string) =>
        (
          await reader.browse({ sort: 'latest', categoryId: null, topicId, offset: 0 })
        ).items
          .map((item) => item.id)
          .sort();
      expect(await on(topics.t1)).toEqual([f.one, f.six].sort());
      expect(await on(topics.t2)).toEqual([f.five, f.six, f.seven].sort());
      expect(await on(topics.t3)).toEqual([f.one]);
      const inB = await reader.browse({
        sort: 'latest',
        categoryId: categories.b,
        topicId: null,
        offset: 0,
      });
      expect(inB.items.map((item) => item.id)).toEqual([f.seven, f.five]);
      expect(
        (await reader.categories()).map((category) => [
          category.slug,
          category.publicCount,
        ]),
      ).toEqual([
        ['fixture-category-a', 2],
        ['fixture-category-b', 2],
      ]);
      expect((await reader.category('fixture-category-b'))?.publicCount).toBe(2);
    });
  });

  /* ======================================================================
   * Search
   * ==================================================================== */

  describe('search', () => {
    it('projects only the current public revision, never the question', async () => {
      const record = await reader.searchRecord(f.one);
      expect(record).toMatchObject({
        fatwaId: f.one,
        slug: SLUG.one,
        title: sentinel('TITLE', 3),
        publicQuestion: sentinel('PUBLIC_QUESTION', 3),
        ruling: sentinel('RULING', 3),
        language: 'en',
        topicIds: [topics.t1, topics.t3].sort(),
      });
      expect(record?.stamp).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(record)).not.toContain(PRIVATE_TEXT);
      const records = await reader.searchRecords([f.one, f.four, f.five]);
      expect(records.map((entry) => entry.fatwaId).sort()).toEqual(
        [f.one, f.five].sort(),
      );
    });

    it('enumerates scopes ascending after an exclusive cursor', async () => {
      const all = await reader.searchScopes(null, 500);
      const ids = all.map((scope) => scope.id);
      expect(ids).toEqual([f.one, f.five, f.six, f.seven].sort());
      const first = ids[0] ?? '';
      expect((await reader.searchScopes(first, 500)).map((scope) => scope.id)).toEqual(
        ids.slice(1),
      );
      expect(await reader.searchScopes(null, 1)).toHaveLength(1);
    });

    it('bounds its batches', async () => {
      const many = Array.from({ length: 200 }, () => randomUUID());
      expect(
        (await reader.publicTargets([...many, f.one])).map((t) => t.fatwaId),
      ).toEqual([f.one]);
      await expect(
        reader.publicTargets(Array.from({ length: 501 }, () => randomUUID())),
      ).rejects.toThrow();
      await expect(
        reader.searchRecords(Array.from({ length: 101 }, () => randomUUID())),
      ).rejects.toThrow();
    });

    it('re-indexes every public ruling of a category whose topic changes, audited without names', async () => {
      const [before] = (await reader.searchScopes(null, 500)).filter(
        (s) => s.id === f.one,
      );
      const intentsOne = await intents(db.admin, f.one);
      const intentsSix = await intents(db.admin, f.six);
      const intentsFive = await intents(db.admin, f.five);
      await workflow.updateCategory({
        actorId: publisher.actorId,
        value: {
          id: categories.a,
          expectedVersion: 1,
          topicId: topics.t4,
          position: 1,
          status: 'active',
          names: [{ locale: 'en', name: sentinel('CATEGORY', 5) }],
        },
      });
      expect(await intents(db.admin, f.one)).toBe(intentsOne + 1);
      expect(await intents(db.admin, f.six)).toBe(intentsSix + 1);
      expect(await intents(db.admin, f.five)).toBe(intentsFive);
      const [after] = (await reader.searchScopes(null, 500)).filter(
        (s) => s.id === f.one,
      );
      expect(after?.stamp).not.toBe(before?.stamp);
      expect((await reader.searchRecord(f.one))?.topicIds).toEqual(
        [topics.t3, topics.t4].sort(),
      );
      expect(
        await reasonOf(
          workflow.updateCategory({
            actorId: publisher.actorId,
            value: {
              id: categories.a,
              expectedVersion: 1,
              topicId: topics.t1,
              position: 1,
              status: 'active',
              names: [{ locale: 'en', name: sentinel('CATEGORY', 6) }],
            },
          }),
        ),
      ).toBe('conflict');
      expect(
        await reasonOf(
          workflow.updateCategory({
            actorId: answerer,
            value: {
              id: categories.a,
              expectedVersion: 2,
              topicId: topics.t1,
              position: 1,
              status: 'active',
              names: [{ locale: 'en', name: sentinel('CATEGORY', 6) }],
            },
          }),
        ),
      ).toBe('denied');
      expect(
        (await staff.categories(answerer)).find(
          (category) => category.id === categories.a,
        ),
      ).toMatchObject({
        version: 2,
        names: [{ locale: 'en', name: sentinel('CATEGORY', 5) }],
      });
    });
  });

  /* ======================================================================
   * Live authority after the fact
   * ==================================================================== */

  describe('live authority', () => {
    it('gives a revoked answerer nothing, and never assigns to them again', async () => {
      q.six = await ask(askerB, 61);
      await workflow.triage({
        actorId: receiver,
        value: { id: q.six, expectedVersion: 1, categoryId: categories.a },
      });
      await workflow.assign({
        actorId: receiver,
        value: { id: q.six, expectedVersion: 2, assigneeId: revocable.accountId },
      });
      expect(await staff.assignedQuestion(revocable.accountId, q.six)).not.toBeNull();
      await revoke(db.admin, revocable);
      expect(await staff.assignedQuestion(revocable.accountId, q.six)).toBeNull();
      expect((await staff.assigned(revocable.accountId, 0)).total).toBe(0);
      expect(
        await reasonOf(
          workflow.saveDraft({
            actorId: revocable.accountId,
            fatwaId: randomUUID(),
            revisionId: randomUUID(),
            value: draft({
              questionId: q.six,
              expectedVersion: 0,
              slug: 'fixture-ruling-revoked',
            }),
          }),
        ),
      ).toBe('denied');
      expect(
        (await holders.holders('fatwa.answer', 200)).map((choice) => choice.accountId),
      ).not.toContain(revocable.accountId);
      q.seven = await ask(askerB, 71);
      await workflow.triage({
        actorId: receiver,
        value: { id: q.seven, expectedVersion: 1, categoryId: categories.a },
      });
      expect(
        await reasonOf(
          workflow.assign({
            actorId: receiver,
            value: { id: q.seven, expectedVersion: 2, assigneeId: revocable.accountId },
          }),
        ),
      ).toBe('invalid-assignee');
    });

    it('gives a former assignee nothing once the question is reassigned', async () => {
      await workflow.assign({
        actorId: receiver,
        value: { id: q.seven, expectedVersion: 2, assigneeId: answerer },
      });
      await workflow.assign({
        actorId: receiver,
        value: { id: q.seven, expectedVersion: 3, assigneeId: otherAnswerer },
      });
      expect(await staff.assignedQuestion(answerer, q.seven)).toBeNull();
      expect(await staff.assignedFatwa(answerer, q.seven)).toBeNull();
      expect(
        await reasonOf(
          workflow.saveDraft({
            actorId: answerer,
            fatwaId: randomUUID(),
            revisionId: randomUUID(),
            value: draft({
              questionId: q.seven,
              expectedVersion: 0,
              slug: 'fixture-ruling-former',
            }),
          }),
        ),
      ).toBe('denied');
      expect(await staff.assignedQuestion(otherAnswerer, q.seven)).not.toBeNull();
    });

    it('grants the administrator bundle nothing in Fatwa', async () => {
      expect(
        await reasonOf(
          workflow.saveDraft({
            actorId: adminLike,
            fatwaId: randomUUID(),
            revisionId: randomUUID(),
            value: draft({
              questionId: q.seven,
              expectedVersion: 0,
              slug: 'fixture-ruling-admin',
            }),
          }),
        ),
      ).toBe('denied');
      expect(
        await reasonOf(
          workflow.publish({
            authority: adminLikeAuthority,
            publicationId: randomUUID(),
            value: {
              fatwaId: f.one,
              expectedVersion: await versionOf('Fatwa', f.one),
              revisionId: r.three,
            },
          }),
        ),
      ).toBe('step-up-required');
      expect((await staff.assigned(adminLike, 0)).total).toBe(0);
      expect((await staff.reviewQueue(adminLike, 0)).total).toBe(0);
      expect((await staff.published(adminLike, 0)).total).toBe(0);
      expect(await staff.publishedFatwa(adminLike, f.one)).toBeNull();
    });
  });

  /* ======================================================================
   * Account closure
   * ==================================================================== */

  describe('disposition', () => {
    it('refuses an active account, and erases a closed one while the ruling stays public', async () => {
      expect(await reasonOf(disposition.disposeAccount(askerB))).toBe('denied');
      await closeAccount(db.admin, askerA);
      expect(await disposition.disposeAccount(askerA)).toBe(1);
      expect(await disposition.disposeAccount(askerA)).toBe(0);
      expect(await owner.question(askerA, q.one)).toMatchObject({
        status: 'answered',
        body: null,
      });
      expect(await staff.assignedQuestion(answerer, q.one)).toBeNull();
      expect((await reader.fatwa(SLUG.one))?.current.revisionId).toBe(r.three);
      expect(await disposition.disposeClosedAccounts(10)).toBe(0);
    });
  });

  /* ======================================================================
   * What the audit trail never holds
   * ==================================================================== */

  describe('the audit trail', () => {
    it('records every body-returning read exactly once and never holds fixture text', async () => {
      // intake 1, assigned 2 (draft, after publication), review 1.
      expect(
        await count(
          db.admin,
          'AuditLog',
          `[action] = N'fatwa.question.accessed' AND [targetId] = ${n(q.one)}`,
        ),
      ).toBe(4);
      expect(
        await count(
          db.admin,
          'AuditLog',
          `CHARINDEX(N'NON_FATWA_FIXTURE', ISNULL([beforeState], N'') + ISNULL([afterState], N'') + ISNULL([authorisingSource], N'')) > 0`,
        ),
      ).toBe(0);
    });
  });
});
