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
import type {
  CanonicalAuthority,
  CandidateAyah,
  QuranCanonicalPort,
  QuranPersistencePort,
  QuranPublicReaderPort,
  TranslationValue,
} from '../../packages/contracts/src/quran/index.ts';
import {
  createProofDatabase,
  databaseConfigured,
  type DisposableDatabase,
} from '../identity/harness.ts';
import {
  accountWith,
  asset,
  BEH_FATHA,
  BEH_KASRA,
  ARABIC_YEH,
  count,
  FARSI_YEH,
  fixtureAyat,
  grantFor,
  intents,
  n,
  NEUTRAL,
  person,
  registerSource,
  sessionFor,
  STRUCTURE,
  topic,
  type RegisteredSource,
} from './fixture-sql.ts';

/**
 * Phase 18 — the Quran adapter over a REAL SQL Server, running as the REAL
 * least-privilege RUNTIME principal.
 *
 * WHAT ONLY THE DATABASE CAN PROVE: that the runtime principal can write no
 * source, no activation and no canonical row except through the three
 * procedures; that those procedures re-verify the live `quran.editCanonical`
 * assignment and a purpose-bound, unexpired step-up grant; that a candidate
 * differing from the source by ONE code point, one space, one Juz or one
 * membership writes nothing; that history and evidence are immutable even to
 * the owner; that activation refuses an incomplete corpus and fixture text
 * beside approved authority; that a layered work is public only under the
 * public predicate; and that search intent commits with the change it owes.
 *
 * TWO CONNECTIONS, TWO ROLES. The owner/migration session registers what only
 * an operator may register — sources, activation, accounts, grants, People,
 * Topics, Assets. EVERYTHING the application does goes through the adapter,
 * whose Prisma client is bound to the provisioned RUNTIME principal.
 *
 * NOTHING HERE IS THE QURAN (see `./fixture-sql.ts`).
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

live('Phase 18 Quran adapter against real SQL Server, as the runtime principal', () => {
  let db: DisposableDatabase;
  /** The runtime principal on the disposable database, for direct denial proofs. */
  let app: SqlSession;
  let persistence: QuranPersistencePort;
  let reader: QuranPublicReaderPort;
  let canonical: QuranCanonicalPort;

  let primary: RegisteredSource;
  let corrections: RegisteredSource;
  let approved: RegisteredSource;
  let incomplete: RegisteredSource;

  let editor: CanonicalAuthority;
  let wrongPurpose: CanonicalAuthority;
  let expired: CanonicalAuthority;
  let unheld: CanonicalAuthority;
  let ungranted: CanonicalAuthority;

  let actorId: string;
  let reciter: string;
  let translator: string;
  let topicId: string;

  const candidateOf = (source: RegisteredSource): CandidateAyah[] =>
    source.ayat.map((entry) => ({ ...entry }));

  const nothingCanonical = async () => ({
    ayat: await count(db.admin, 'Ayah'),
    surahs: await count(db.admin, 'Surah'),
    juz: await count(db.admin, 'Juz'),
    revisions: await count(db.admin, 'QuranAyahRevision'),
    passed: await count(db.admin, 'QuranVerificationRun', "[outcome] = N'passed'"),
  });

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
    process.env.DATABASE_URL = runtimeUrl;

    const database = await import('../../packages/database/src/index.ts');
    persistence = database.createQuranPersistence();
    reader = database.createQuranPublicReader();
    canonical = database.createQuranCanonical();

    primary = await registerSource(db.admin, {
      code: 'non-quran-fixture-primary',
      authority: 'fixture',
      ayat: fixtureAyat('CANONICAL'),
    });
    corrections = await registerSource(db.admin, {
      code: 'non-quran-fixture-corrections',
      authority: 'fixture',
      ayat: fixtureAyat(
        'CORRECTED',
        STRUCTURE.filter((entry) => entry.surah === 1),
      ),
    });
    approved = await registerSource(db.admin, {
      code: 'non-quran-fixture-approved',
      authority: 'approved',
      ayat: fixtureAyat('APPROVED'),
    });
    // One Ayah more than the canonical corpus will hold.
    incomplete = await registerSource(db.admin, {
      code: 'non-quran-fixture-incomplete',
      authority: 'fixture',
      ayat: fixtureAyat('INCOMPLETE', [...STRUCTURE, { surah: 2, ayah: 5, juz: 2 }]),
    });

    const holder = await accountWith(db.admin, ['quran.editCanonical']);
    const session = await sessionFor(db.admin, holder);
    editor = {
      actorId: holder,
      sessionId: session,
      stepUpGrantId: await grantFor(db.admin, holder, session, 'quran-canonical-edit'),
    };
    wrongPurpose = {
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
        'quran-canonical-edit',
        -5,
      ),
    };
    ungranted = { ...editor, stepUpGrantId: randomUUID() };
    // A live, correctly purposed grant — but no `quran.editCanonical`.
    const administrator = await accountWith(db.admin, ['quran.read', 'quran.administer']);
    const administratorSession = await sessionFor(db.admin, administrator);
    unheld = {
      actorId: administrator,
      sessionId: administratorSession,
      stepUpGrantId: await grantFor(
        db.admin,
        administrator,
        administratorSession,
        'quran-canonical-edit',
      ),
    };

    actorId = administrator;
    reciter = await person(db.admin, `fixture-reciter-one-${randomUUID().slice(0, 8)}`);
    translator = await person(db.admin, `fixture-translator-${randomUUID().slice(0, 8)}`);
    topicId = await topic(
      db.admin,
      `non-quran-fixture-topic-${randomUUID().slice(0, 8)}`,
    );
  }, 240_000);

  afterAll(async () => {
    await app?.close();
    await db?.close();
  });

  /* ======================================================================
   * The runtime principal's posture
   * ==================================================================== */

  describe('the runtime principal cannot write sources, activation or canonical rows', () => {
    it.each([
      [
        'QuranSource',
        `INSERT INTO [dbo].[QuranSource] ([id],[code],[authority],[title],[version],[encoding]) VALUES (N'x',N'x',N'approved',N'x',N'1',N'utf-8')`,
      ],
      [
        'QuranSourceSurah',
        `INSERT INTO [dbo].[QuranSourceSurah] ([sourceId],[number],[ayahCount]) VALUES (N'x',1,1)`,
      ],
      [
        'QuranSourceAyah',
        `INSERT INTO [dbo].[QuranSourceAyah] ([sourceId],[surahNumber],[ayahNumber],[juzNumber],[text]) VALUES (N'x',1,1,1,N'x')`,
      ],
      [
        'QuranActivation',
        `INSERT INTO [dbo].[QuranActivation] ([id],[sourceId],[authorisedBy]) VALUES (1,N'x',N'x')`,
      ],
      ['Juz', `INSERT INTO [dbo].[Juz] ([number],[sourceId]) VALUES (1,N'x')`],
      [
        'Surah',
        `INSERT INTO [dbo].[Surah] ([number],[ayahCount],[sourceId]) VALUES (1,1,N'x')`,
      ],
      [
        'Ayah',
        `INSERT INTO [dbo].[Ayah] ([surahNumber],[ayahNumber],[juzNumber],[text],[sourceId],[version]) VALUES (1,1,1,N'x',N'x',1)`,
      ],
      [
        'QuranAyahRevision',
        `INSERT INTO [dbo].[QuranAyahRevision] ([surahNumber],[ayahNumber],[version],[text],[sourceId],[verificationRunId]) VALUES (1,1,1,N'x',N'x',N'x')`,
      ],
      [
        'QuranVerificationRun',
        `INSERT INTO [dbo].[QuranVerificationRun] ([id],[kind],[outcome],[sourceId],[checked],[mismatches]) VALUES (N'x',N'corpus-acceptance',N'passed',N'x',0,0)`,
      ],
    ])('refuses INSERT into %s', async (_table, statement) => {
      expect(await sqlNumber(app.query(statement))).toBe(229);
    });

    it.each([
      'QuranSource',
      'QuranSourceSurah',
      'QuranSourceAyah',
      'QuranActivation',
      'Juz',
      'Surah',
      'Ayah',
      'QuranAyahRevision',
      'QuranVerificationRun',
    ])('refuses DELETE from %s', async (table) => {
      expect(await sqlNumber(app.query(`DELETE FROM [dbo].[${table}] WHERE 1 = 0`))).toBe(
        229,
      );
    });

    it.each([
      ['QuranSource', '[title] = [title]'],
      ['QuranSourceAyah', '[text] = [text]'],
      ['QuranActivation', '[authorisedBy] = [authorisedBy]'],
      ['Juz', '[sourceId] = [sourceId]'],
      ['Ayah', '[text] = [text]'],
      ['QuranAyahRevision', '[text] = [text]'],
      ['QuranVerificationRun', '[checked] = [checked]'],
    ])('refuses UPDATE of %s', async (table, assignment) => {
      expect(
        await sqlNumber(
          app.query(`UPDATE [dbo].[${table}] SET ${assignment} WHERE 1 = 0`),
        ),
      ).toBe(229);
    });

    it('lets a Surah advance only its display-names version, never a canonical fact', async () => {
      for (const column of ['ayahCount', 'nameArabic', 'sourceId', 'revelation'])
        expect(
          await sqlNumber(
            app.query(`UPDATE [dbo].[Surah] SET [${column}] = [${column}] WHERE 1 = 0`),
          ),
        ).toBe(230);
      // The admitted columns pass the permission check.
      expect(
        await sqlNumber(
          app.query(
            `UPDATE [dbo].[Surah] SET [namesVersion] = [namesVersion] WHERE 1 = 0`,
          ),
        ),
      ).toBeNull();
    });

    it.each([
      'QuranTranslation',
      'QuranTransliteration',
      'QuranTafsir',
      'QuranRecitation',
      'QuranTajweedRule',
    ])('refuses UPDATE of a %s slug', async (table) => {
      expect(
        await sqlNumber(
          app.query(`UPDATE [dbo].[${table}] SET [slug] = [slug] WHERE 1 = 0`),
        ),
      ).toBe(230);
    });

    it('refuses activation of an empty corpus, even to the owner', async () => {
      expect(
        await sqlNumber(
          db.admin.query(
            `INSERT INTO [dbo].[QuranActivation] ([id],[sourceId],[authorisedBy]) VALUES (1, ${n(primary.id)}, N'fixture operator')`,
          ),
        ),
      ).toBe(51185);
      expect(await count(db.admin, 'QuranActivation')).toBe(0);
    });
  });

  /* ======================================================================
   * Corpus acceptance
   * ==================================================================== */

  describe('corpus acceptance', () => {
    it('refuses without a live quran.editCanonical assignment and purpose-bound, unexpired grant', async () => {
      for (const authority of [unheld, ungranted, wrongPurpose, expired])
        expect(
          await reasonOf(
            canonical.acceptCorpus({
              authority,
              sourceId: primary.id,
              candidate: candidateOf(primary),
            }),
          ),
        ).toBe('denied');
      expect(await nothingCanonical()).toEqual({
        ayat: 0,
        surahs: 0,
        juz: 0,
        revisions: 0,
        passed: 0,
      });
    });

    it('refuses a candidate differing by one code point, one space, one Juz or one membership, and writes nothing', async () => {
      const exact = candidateOf(primary);
      const edit = (index: number, change: (entry: CandidateAyah) => CandidateAyah) =>
        exact.map((entry, at) => (at === index ? change(entry) : entry));
      const variants: Record<string, CandidateAyah[]> = {
        'a different combining mark': edit(0, (entry) => ({
          ...entry,
          text: entry.text.replace(BEH_FATHA, BEH_KASRA),
        })),
        'Urdu/Farsi yeh for Arabic yeh': edit(1, (entry) => ({
          ...entry,
          text: entry.text.replace(ARABIC_YEH, FARSI_YEH),
        })),
        'an added trailing space': edit(3, (entry) => ({
          ...entry,
          text: `${entry.text} `,
        })),
        'an added leading space': edit(3, (entry) => ({
          ...entry,
          text: ` ${entry.text}`,
        })),
        'a removed inner space': edit(4, (entry) => ({
          ...entry,
          text: entry.text.replace(` ${NEUTRAL}`, NEUTRAL),
        })),
        'a wrong Juz': edit(5, (entry) => ({ ...entry, juz: 1 })),
        'a missing Ayah': exact.slice(0, -1),
        'a duplicated Ayah': [...exact.slice(0, -1), exact[5]!, exact[5]!],
        'an Ayah the source lacks': [...exact, { surah: 2, ayah: 5, juz: 2, text: 'x' }],
      };
      for (const [variant, candidate] of Object.entries(variants)) {
        expect(candidate, variant).not.toEqual(exact);
        expect(
          await reasonOf(
            canonical.acceptCorpus({
              authority: editor,
              sourceId: primary.id,
              candidate,
            }),
          ),
          variant,
        ).toBe('invalid');
      }
      expect(
        await reasonOf(
          canonical.acceptCorpus({
            authority: editor,
            sourceId: randomUUID(),
            candidate: exact,
          }),
        ),
      ).toBe('not-found');
      expect(await nothingCanonical()).toEqual({
        ayat: 0,
        surahs: 0,
        juz: 0,
        revisions: 0,
        passed: 0,
      });
    });

    it('records a failed verification as immutable, content-free evidence', async () => {
      const { runId } = await canonical.recordFailure({
        actorId: editor.actorId,
        kind: 'corpus-acceptance',
        sourceId: primary.id,
        checked: 7,
        mismatches: 1,
        first: { reason: 'text-mismatch', ref: { surah: 1, ayah: 1 }, offset: 4 },
      });
      const [run] = await db.admin.query<Record<string, unknown>>(
        `SELECT [outcome],[firstReason],[firstSurah],[firstAyah],[firstOffset] FROM [dbo].[QuranVerificationRun] WHERE [id] = ${n(runId)}`,
      );
      expect(run).toEqual({
        outcome: 'failed',
        firstReason: 'text-mismatch',
        firstSurah: 1,
        firstAyah: 1,
        firstOffset: 4,
      });
      // Immutable even to the owner.
      expect(
        await sqlNumber(
          db.admin.query(
            `UPDATE [dbo].[QuranVerificationRun] SET [checked] = 0 WHERE [id] = ${n(runId)}`,
          ),
        ),
      ).toBe(51183);
      expect(
        await sqlNumber(
          db.admin.query(
            `DELETE FROM [dbo].[QuranVerificationRun] WHERE [id] = ${n(runId)}`,
          ),
        ),
      ).toBe(51183);
    });

    it("accepts the exact candidate, copying the source's own text, and only once", async () => {
      const accepted = await canonical.acceptCorpus({
        authority: editor,
        sourceId: primary.id,
        candidate: candidateOf(primary),
      });
      expect(accepted.ayat).toBe(STRUCTURE.length);

      expect(await canonical.sourceCorpus(primary.id)).toEqual(candidateOf(primary));
      const page = await persistence.surahAyat(1, 0);
      expect(page.total).toBe(3);
      expect(page.items.map((entry) => entry.text)).toEqual(
        primary.ayat.filter((entry) => entry.surah === 1).map((entry) => entry.text),
      );
      expect(page.items.every((entry) => entry.version === 1)).toBe(true);
      expect(await count(db.admin, 'Juz')).toBe(2);
      expect(await count(db.admin, 'Surah')).toBe(2);
      expect(await count(db.admin, 'QuranAyahRevision', '[version] = 1')).toBe(7);

      const status = await persistence.corpusStatus();
      expect(status).toMatchObject({ surahs: 2, ayat: 7, juz: 2, activation: null });
      expect(status.sources.find((entry) => entry.id === primary.id)?.ayahCount).toBe(7);
      expect(status.recentRuns.find((run) => run.id === accepted.runId)?.outcome).toBe(
        'passed',
      );

      expect(
        await reasonOf(
          canonical.acceptCorpus({
            authority: editor,
            sourceId: approved.id,
            candidate: candidateOf(approved),
          }),
        ),
      ).toBe('corpus-exists');
      expect(await count(db.admin, 'Ayah')).toBe(7);
    });

    it('keeps history immutable, even to the owner', async () => {
      expect(
        await sqlNumber(
          db.admin.query(
            `UPDATE [dbo].[QuranAyahRevision] SET [reason] = N'x' WHERE [version] = 1`,
          ),
        ),
      ).toBe(51183);
      expect(
        await sqlNumber(
          db.admin.query(`DELETE FROM [dbo].[QuranAyahRevision] WHERE [version] = 1`),
        ),
      ).toBe(51183);
      expect(await sqlNumber(app.query(`UPDATE [dbo].[Ayah] SET [text] = [text]`))).toBe(
        229,
      );
    });
  });

  /* ======================================================================
   * Canonical correction
   * ==================================================================== */

  describe('canonical correction', () => {
    const ref = { surah: 1, ayah: 2 };
    const correctedText = () =>
      corrections.ayat.find((entry) => entry.surah === 1 && entry.ayah === 2)!.text;

    it('refuses without authority, a stale version, an unreviewed text, a missing Ayah or no change', async () => {
      const base = {
        ref,
        expectedVersion: 1,
        sourceId: corrections.id,
        reviewedText: correctedText(),
        reason: 'Fixture correction proof',
      };
      expect(
        await reasonOf(canonical.correctAyah({ ...base, authority: wrongPurpose })),
      ).toBe('denied');
      expect(
        await reasonOf(
          canonical.correctAyah({ ...base, authority: editor, expectedVersion: 2 }),
        ),
      ).toBe('conflict');
      expect(
        await reasonOf(
          canonical.correctAyah({
            ...base,
            authority: editor,
            reviewedText: correctedText().replace(ARABIC_YEH, FARSI_YEH),
          }),
        ),
      ).toBe('invalid');
      expect(
        await reasonOf(
          canonical.correctAyah({
            ...base,
            authority: editor,
            ref: { surah: 1, ayah: 99 },
          }),
        ),
      ).toBe('not-found');
      expect(
        await reasonOf(
          canonical.correctAyah({
            ...base,
            authority: editor,
            sourceId: primary.id,
            reviewedText: primary.ayat[1]!.text,
          }),
        ),
      ).toBe('unchanged');
      expect((await persistence.ayah(ref))?.version).toBe(1);
      expect(await intents(db.admin, '1:2')).toBe(0);
    });

    it('previews the difference, then appends a revision, bumps the version and audits without text', async () => {
      const preview = await persistence.correctionPreview(ref, corrections.id);
      expect(preview?.sourceText).toBe(correctedText());
      // `..._CANONICAL_...` against `..._CORRECTED_...`: the second letter.
      expect(preview?.firstDifference).toBe('NON_QURAN_FIXTURE_C'.length);

      const result = await canonical.correctAyah({
        authority: editor,
        ref,
        expectedVersion: 1,
        sourceId: corrections.id,
        reviewedText: correctedText(),
        reason: 'Fixture correction proof',
      });
      expect(result.version).toBe(2);

      const detail = await persistence.ayah(ref);
      expect(detail).toMatchObject({
        version: 2,
        text: correctedText(),
        sourceId: corrections.id,
      });
      expect(detail?.history.map((revision) => revision.version)).toEqual([2, 1]);
      expect(detail?.history[0]).toMatchObject({
        actorId: editor.actorId,
        reason: 'Fixture correction proof',
      });
      expect(await intents(db.admin, '1:2')).toBe(1);

      const audit = await db.admin.query<{ beforeState: string; afterState: string }>(
        `SELECT [beforeState],[afterState] FROM [dbo].[AuditLog] WHERE [action] = N'quran.ayah.corrected' AND [targetId] = N'1:2'`,
      );
      expect(audit).toHaveLength(1);
      expect(audit[0]!.afterState).toContain(result.runId);
      expect(`${audit[0]!.beforeState}${audit[0]!.afterState}`).not.toContain(
        'NON_QURAN',
      );
    });

    it('never lets a fixture source displace approved text', async () => {
      const approvedText = approved.ayat.find((e) => e.surah === 1 && e.ayah === 3)!.text;
      await canonical.correctAyah({
        authority: editor,
        ref: { surah: 1, ayah: 3 },
        expectedVersion: 1,
        sourceId: approved.id,
        reviewedText: approvedText,
        reason: 'Fixture approved correction',
      });
      expect(
        await reasonOf(
          canonical.correctAyah({
            authority: editor,
            ref: { surah: 1, ayah: 3 },
            expectedVersion: 2,
            sourceId: corrections.id,
            reviewedText: corrections.ayat[2]!.text,
            reason: 'Fixture over approved',
          }),
        ),
      ).toBe('fixture-over-approved');
      expect((await persistence.ayah({ surah: 1, ayah: 3 }))?.text).toBe(approvedText);
    });
  });

  /* ======================================================================
   * Layered works — administration
   * ==================================================================== */

  let fixtureTranslation: { id: string; slug: string };
  let approvedTranslation: { id: string; slug: string };
  let recitationId: string;
  let audioAsset: string;

  const translationValue = (
    slug: string,
    sourceId: string | null,
    languageCode = 'en',
  ): TranslationValue => ({
    slug,
    name: 'NON_QURAN_FIXTURE translation',
    description: null,
    attribution: 'Fixture attribution',
    languageCode,
    sourceId,
    contributors: [{ personId: translator, role: 'translator' }],
  });

  describe('layered works', () => {
    it('administers a Translation under its version, storing text exactly as given', async () => {
      const slug = `non-quran-fixture-translation-${randomUUID().slice(0, 8)}`;
      const created = await persistence.createTranslation({
        actorId,
        value: translationValue(slug, primary.id),
      });
      expect(created).toMatchObject({ state: 'draft', version: 1, textCount: 0 });
      expect(created.contributors).toEqual([
        { personId: translator, role: 'translator', position: 0 },
      ]);
      expect(
        await reasonOf(
          persistence.createTranslation({ actorId, value: translationValue(slug, null) }),
        ),
      ).toBe('duplicate-slug');
      expect(
        await reasonOf(
          persistence.setTranslationState({
            actorId,
            id: created.id,
            expectedVersion: 1,
            state: 'published',
          }),
        ),
      ).toBe('text-required');

      // Marks, inner double spaces, a line break, a supplementary character:
      // all kept exactly.
      const exact = `NON_QURAN_FIXTURE translation  1:1\n${BEH_FATHA} \u{1D400} ${FARSI_YEH}`;
      const saved = await persistence.saveTranslationTexts({
        actorId,
        id: created.id,
        expectedVersion: 1,
        surah: 1,
        changes: [
          { ayah: 1, text: exact },
          { ayah: 2, text: 'NON_QURAN_FIXTURE translation 1:2' },
          { ayah: 3, text: 'NON_QURAN_FIXTURE translation 1:3' },
        ],
      });
      expect(saved).toMatchObject({ version: 2, textCount: 3 });
      expect((await persistence.translationTexts(created.id, 1))[0]).toEqual({
        ayah: 1,
        text: exact,
      });

      // A stale save, and a save naming an Ayah the corpus lacks, change
      // nothing and owe nothing.
      expect(
        await reasonOf(
          persistence.saveTranslationTexts({
            actorId,
            id: created.id,
            expectedVersion: 1,
            surah: 1,
            changes: [{ ayah: 1, text: 'stale' }],
          }),
        ),
      ).toBe('conflict');
      expect(
        await reasonOf(
          persistence.saveTranslationTexts({
            actorId,
            id: created.id,
            expectedVersion: 2,
            surah: 1,
            changes: [
              { ayah: 1, text: 'NON_QURAN_FIXTURE replaced' },
              { ayah: 999, text: 'NON_QURAN_FIXTURE beyond the corpus' },
            ],
          }),
        ),
      ).toBe('invalid');
      expect((await persistence.translation(created.id))?.version).toBe(2);
      expect((await persistence.translationTexts(created.id, 1))[0]?.text).toBe(exact);
      expect(await intents(db.admin, '1:1')).toBe(0);

      // Publication owes a re-projection of every Ayah the work carries, in
      // the same transaction.
      const scopes = ['1:1', '1:2', '1:3'];
      const owed = await Promise.all(scopes.map((scope) => intents(db.admin, scope)));
      const published = await persistence.setTranslationState({
        actorId,
        id: created.id,
        expectedVersion: 2,
        state: 'published',
      });
      expect(published.state).toBe('published');
      expect(published.publishedAt).toBeInstanceOf(Date);
      expect(await Promise.all(scopes.map((scope) => intents(db.admin, scope)))).toEqual(
        owed.map((total) => total + 1),
      );

      expect(
        await reasonOf(
          persistence.updateTranslation({
            actorId,
            id: created.id,
            expectedVersion: 3,
            value: translationValue(`${slug}-renamed`, primary.id),
          }),
        ),
      ).toBe('invalid');
      expect(
        await reasonOf(
          persistence.updateTranslation({
            actorId,
            id: created.id,
            expectedVersion: 3,
            value: translationValue(slug, null),
          }),
        ),
      ).toBe('source-required');
      expect(
        await reasonOf(
          persistence.saveTranslationTexts({
            actorId,
            id: created.id,
            expectedVersion: 3,
            surah: 1,
            changes: [
              { ayah: 1, text: null },
              { ayah: 2, text: null },
              { ayah: 3, text: null },
            ],
          }),
        ),
      ).toBe('text-required');

      const audited = await db.admin.query<{ action: string; afterState: string | null }>(
        `SELECT [action],[afterState] FROM [dbo].[AuditLog] WHERE [targetId] = ${n(created.id)} ORDER BY [occurredAt]`,
      );
      expect(audited.map((row) => row.action)).toEqual([
        'quran.translation.created',
        'quran.translation.texts-saved',
        'quran.translation.state-changed',
      ]);
      fixtureTranslation = { id: created.id, slug };
    });

    it('refuses publication without a registered source', async () => {
      const sourceless = await persistence.createTranslation({
        actorId,
        value: translationValue(
          `non-quran-fixture-sourceless-${randomUUID().slice(0, 8)}`,
          null,
        ),
      });
      await persistence.saveTranslationTexts({
        actorId,
        id: sourceless.id,
        expectedVersion: 1,
        surah: 1,
        changes: [{ ayah: 1, text: 'NON_QURAN_FIXTURE sourceless' }],
      });
      expect(
        await reasonOf(
          persistence.setTranslationState({
            actorId,
            id: sourceless.id,
            expectedVersion: 2,
            state: 'published',
          }),
        ),
      ).toBe('source-required');
    });

    it('publishes an approved-source Translation and a Transliteration', async () => {
      const slug = `non-quran-fixture-approved-${randomUUID().slice(0, 8)}`;
      const created = await persistence.createTranslation({
        actorId,
        value: translationValue(slug, approved.id, 'ur'),
      });
      await persistence.saveTranslationTexts({
        actorId,
        id: created.id,
        expectedVersion: 1,
        surah: 1,
        changes: [{ ayah: 1, text: 'NON_QURAN_FIXTURE approved translation 1:1' }],
      });
      await persistence.setTranslationState({
        actorId,
        id: created.id,
        expectedVersion: 2,
        state: 'published',
      });
      approvedTranslation = { id: created.id, slug };

      const transliteration = await persistence.createTransliteration({
        actorId,
        value: {
          slug: `non-quran-fixture-transliteration-${randomUUID().slice(0, 8)}`,
          name: 'NON_QURAN_FIXTURE transliteration',
          description: null,
          attribution: null,
          languageCode: 'en',
          sourceId: primary.id,
          scheme: 'Fixture scheme',
        },
      });
      await persistence.saveTransliterationTexts({
        actorId,
        id: transliteration.id,
        expectedVersion: 1,
        surah: 1,
        changes: [{ ayah: 1, text: 'NON_QURAN_FIXTURE transliteration 1:1' }],
      });
      const published = await persistence.setTransliterationState({
        actorId,
        id: transliteration.id,
        expectedVersion: 2,
        state: 'published',
      });
      expect(published).toMatchObject({
        state: 'published',
        textCount: 1,
        scheme: 'Fixture scheme',
      });
    });

    it('refuses overlapping Tafsir entries and a published Tafsir without text', async () => {
      const value = {
        slug: `non-quran-fixture-tafsir-${randomUUID().slice(0, 8)}`,
        name: 'NON_QURAN_FIXTURE tafsir',
        description: null,
        attribution: null,
        languageCode: 'en',
        sourceId: primary.id,
        contributors: [{ personId: translator, role: 'author' as const }],
      };
      const tafsir = await persistence.createTafsir({ actorId, value });
      expect(
        await reasonOf(
          persistence.setTafsirState({
            actorId,
            id: tafsir.id,
            expectedVersion: 1,
            state: 'published',
          }),
        ),
      ).toBe('text-required');
      const entry = (startAyah: number, endAyah: number) => ({
        surah: 1,
        startAyah,
        endAyah,
        text: `NON_QURAN_FIXTURE tafsir ${startAyah}-${endAyah}`,
      });
      await persistence.saveTafsirEntry({
        actorId,
        id: tafsir.id,
        expectedVersion: 1,
        entryId: null,
        value: entry(1, 2),
      });
      expect(
        await reasonOf(
          persistence.saveTafsirEntry({
            actorId,
            id: tafsir.id,
            expectedVersion: 2,
            entryId: null,
            value: entry(2, 3),
          }),
        ),
      ).toBe('overlap');
      const saved = await persistence.saveTafsirEntry({
        actorId,
        id: tafsir.id,
        expectedVersion: 2,
        entryId: null,
        value: entry(3, 3),
      });
      expect(saved.textCount).toBe(2);
      expect(
        (await persistence.tafsirEntries(tafsir.id, 1)).map((e) => [
          e.startAyah,
          e.endAyah,
        ]),
      ).toEqual([
        [1, 2],
        [3, 3],
      ]);
      expect(
        (
          await persistence.setTafsirState({
            actorId,
            id: tafsir.id,
            expectedVersion: 3,
            state: 'published',
          })
        ).state,
      ).toBe('published');
    });

    it('administers a Recitation: overlap, audio, the version lock and a never-cascading asset', async () => {
      const created = await persistence.createRecitation({
        actorId,
        value: {
          slug: `non-quran-fixture-recitation-${randomUUID().slice(0, 8)}`,
          name: 'NON_QURAN_FIXTURE recitation by Fixture Reciter One',
          reciterId: reciter,
          style: null,
          attribution: null,
          sourceId: primary.id,
        },
      });
      const withSegment = await persistence.addRecitationSegment({
        actorId,
        id: created.id,
        expectedVersion: 1,
        value: { surah: 1, startAyah: 1, endAyah: 2 },
      });
      expect(
        await reasonOf(
          persistence.addRecitationSegment({
            actorId,
            id: created.id,
            expectedVersion: 2,
            value: { surah: 1, startAyah: 2, endAyah: 3 },
          }),
        ),
      ).toBe('overlap');
      const second = await persistence.addRecitationSegment({
        actorId,
        id: created.id,
        expectedVersion: 2,
        value: { surah: 1, startAyah: 3, endAyah: 3 },
      });
      expect(
        await reasonOf(
          persistence.setRecitationState({
            actorId,
            id: created.id,
            expectedVersion: 3,
            state: 'published',
          }),
        ),
      ).toBe('audio-required');

      const segmentId = withSegment.segments[0]!.id;
      const otherSegment = second.segments.find((s) => s.id !== segmentId)!.id;
      audioAsset = await asset(db.admin);
      expect(
        await reasonOf(
          persistence.attachSegmentAsset({
            actorId,
            id: created.id,
            expectedVersion: 2,
            segmentId,
            assetId: audioAsset,
          }),
        ),
      ).toBe('conflict');
      expect(
        await reasonOf(
          persistence.attachSegmentAsset({
            actorId,
            id: created.id,
            expectedVersion: 3,
            segmentId,
            assetId: randomUUID(),
          }),
        ),
      ).toBe('invalid');
      const attached = await persistence.attachSegmentAsset({
        actorId,
        id: created.id,
        expectedVersion: 3,
        segmentId,
        assetId: audioAsset,
      });
      expect(attached.version).toBe(4);
      expect(attached.segments.find((s) => s.id === segmentId)?.assetId).toBe(audioAsset);
      expect(await persistence.segmentAssetForPreview(created.id, segmentId)).toBe(
        audioAsset,
      );
      // One Asset serves one segment.
      expect(
        await reasonOf(
          persistence.attachSegmentAsset({
            actorId,
            id: created.id,
            expectedVersion: 4,
            segmentId: otherSegment,
            assetId: audioAsset,
          }),
        ),
      ).toBe('conflict');

      const published = await persistence.setRecitationState({
        actorId,
        id: created.id,
        expectedVersion: 4,
        state: 'published',
      });
      expect(published.state).toBe('published');
      expect(
        await reasonOf(
          persistence.removeRecitationSegment({
            actorId,
            id: created.id,
            expectedVersion: 5,
            segmentId,
          }),
        ),
      ).toBe('audio-required');
      await persistence.removeRecitationSegment({
        actorId,
        id: created.id,
        expectedVersion: 5,
        segmentId: otherSegment,
      });
      expect(await count(db.admin, 'Asset', `[id] = ${n(audioAsset)}`)).toBe(1);
      recitationId = created.id;
    });

    it('administers Tajweed guidance, replacing a published rule’s texts without a gap', async () => {
      const value = {
        slug: `non-quran-fixture-tajweed-${randomUUID().slice(0, 8)}`,
        position: 0,
        attribution: null,
        sourceId: primary.id,
        texts: [
          { languageCode: 'en', title: 'Fixture rule', body: 'NON_QURAN_FIXTURE rule' },
        ],
      };
      const created = await persistence.createTajweedRule({ actorId, value });
      await persistence.setTajweedRuleState({
        actorId,
        id: created.id,
        expectedVersion: 1,
        state: 'published',
      });
      const updated = await persistence.updateTajweedRule({
        actorId,
        id: created.id,
        expectedVersion: 2,
        value: {
          ...value,
          texts: [
            { languageCode: 'ur', title: 'Fixture rule', body: 'NON_QURAN_FIXTURE rule' },
          ],
        },
      });
      expect(updated.texts.map((text) => text.languageCode)).toEqual(['ur']);
      expect(updated.state).toBe('published');
    });

    it('assigns Topics by typed foreign keys, with search intent', async () => {
      const ref = { surah: 2, ayah: 1 };
      await persistence.addAyahTopic({ actorId, ref, topicId });
      expect(await intents(db.admin, '2:1')).toBe(1);
      expect((await persistence.ayah(ref))?.topicIds).toEqual([topicId]);
      expect(await reasonOf(persistence.addAyahTopic({ actorId, ref, topicId }))).toBe(
        'unchanged',
      );
      expect(
        await reasonOf(
          persistence.addAyahTopic({ actorId, ref: { surah: 2, ayah: 99 }, topicId }),
        ),
      ).toBe('invalid');
      expect(
        await reasonOf(persistence.addAyahTopic({ actorId, ref, topicId: randomUUID() })),
      ).toBe('invalid');
      await persistence.removeAyahTopic({ actorId, ref, topicId });
      expect(await reasonOf(persistence.removeAyahTopic({ actorId, ref, topicId }))).toBe(
        'not-found',
      );
      await persistence.addAyahTopic({ actorId, ref, topicId });
      expect(await intents(db.admin, '2:1')).toBe(3);
    });

    it('saves Surah display names under their own version', async () => {
      const saved = await persistence.saveSurahNames({
        actorId,
        expectedVersion: 1,
        value: { surah: 1, names: [{ locale: 'en', name: 'Fixture Surah One' }] },
      });
      expect(saved).toMatchObject({
        namesVersion: 2,
        names: { en: 'Fixture Surah One' },
      });
      expect(
        await reasonOf(
          persistence.saveSurahNames({
            actorId,
            expectedVersion: 1,
            value: { surah: 1, names: [] },
          }),
        ),
      ).toBe('conflict');
    });
  });

  /* ======================================================================
   * Activation and the public predicate
   * ==================================================================== */

  describe('the public reader', () => {
    it('answers nothing at all before activation, whatever is published', async () => {
      expect(await reader.availability()).toEqual({ active: false });
      expect(await reader.surahs()).toEqual([]);
      expect(await reader.surah(1)).toBeNull();
      expect(await reader.ayat(1, 1, 3)).toEqual([]);
      expect(await reader.ayah({ surah: 1, ayah: 1 })).toBeNull();
      expect(await reader.juzList()).toEqual([]);
      expect((await reader.juzAyat(1, 0)).items).toEqual([]);
      expect(await reader.translations()).toEqual([]);
      expect(await reader.translation(fixtureTranslation.slug)).toBeNull();
      expect(await reader.translationTexts(fixtureTranslation.id, 1, 1, 3)).toEqual([]);
      expect(await reader.transliterations()).toEqual([]);
      expect(await reader.tafsirs()).toEqual([]);
      expect(await reader.recitations()).toEqual([]);
      expect(await reader.recitationSegments(recitationId, null)).toEqual([]);
      expect(await reader.tajweedRules()).toEqual([]);
      expect((await reader.topicAyat(topicId, 0)).items).toEqual([]);
      expect(await reader.ayahSitemapCount()).toBe(0);
      expect(await reader.searchAyah({ surah: 1, ayah: 1 })).toBeNull();
      expect(await reader.searchAyahRecords([{ surah: 1, ayah: 1 }])).toEqual([]);
      expect(await reader.searchAyahScopes(null, 100)).toEqual([]);
      expect(await reader.publicAyahTargets([{ surah: 1, ayah: 1 }])).toEqual([]);
      const segment = (await persistence.recitation(recitationId))!.segments[0]!;
      expect(await reader.segmentAsset(recitationId, segment.id)).toMatchObject({
        publiclyVisible: false,
        assetId: audioAsset,
      });
    });

    it('refuses activation of an incomplete corpus and of fixture text beside approved authority', async () => {
      for (const source of [incomplete, approved])
        expect(
          await sqlNumber(
            db.admin.query(
              `INSERT INTO [dbo].[QuranActivation] ([id],[sourceId],[authorisedBy]) VALUES (1, ${n(source.id)}, N'fixture operator')`,
            ),
          ),
        ).toBe(51185);
    });

    it('in fixture mode, reads the corpus in bounded batches and every publicly sourced work', async () => {
      await db.admin.query(
        `INSERT INTO [dbo].[QuranActivation] ([id],[sourceId],[authorisedBy]) VALUES (1, ${n(primary.id)}, N'fixture operator')`,
      );
      expect(await reader.availability()).toEqual({ active: true, mode: 'fixture' });
      const surahs = await reader.surahs();
      expect(surahs.map((s) => [s.number, s.ayahCount])).toEqual([
        [1, 3],
        [2, 4],
      ]);
      expect(surahs[0]?.names).toEqual({ en: 'Fixture Surah One' });
      expect((await reader.ayat(1, 1, 999)).map((a) => a.ayah)).toEqual([1, 2, 3]);
      expect((await reader.ayah({ surah: 1, ayah: 1 }))?.text).toBe(
        primary.ayat[0]!.text,
      );
      expect(await reader.juzList()).toEqual([
        {
          number: 1,
          start: { surah: 1, ayah: 1 },
          end: { surah: 2, ayah: 2 },
          ayahCount: 5,
        },
        {
          number: 2,
          start: { surah: 2, ayah: 3 },
          end: { surah: 2, ayah: 4 },
          ayahCount: 2,
        },
      ]);
      expect(await reader.juz(2)).toMatchObject({ ayahCount: 2 });
      expect(
        (await reader.juzAyat(2, 0)).items.map((a) => `${a.surah}:${a.ayah}`),
      ).toEqual(['2:3', '2:4']);

      const slugs = (await reader.translations()).map((work) => work.slug);
      expect(slugs).toContain(fixtureTranslation.slug);
      expect(slugs).toContain(approvedTranslation.slug);
      expect(slugs).toHaveLength(2);
      expect(
        (await reader.translationTexts(fixtureTranslation.id, 1, 2, 3)).map(
          (t) => t.ayah,
        ),
      ).toEqual([2, 3]);
      expect(await reader.transliterations()).toHaveLength(1);
      expect(
        (await reader.tafsirEntries((await reader.tafsirs())[0]!.id, 1, 2, 2)).map(
          (entry) => entry.startAyah,
        ),
      ).toEqual([1]);
      expect((await reader.recitations()).map((r) => r.id)).toEqual([recitationId]);
      expect((await reader.recitationsByReciter(reciter)).map((r) => r.id)).toEqual([
        recitationId,
      ]);
      const segments = await reader.recitationSegments(recitationId, 1);
      expect(segments).toEqual([
        expect.objectContaining({ startAyah: 1, endAyah: 2, assetId: audioAsset }),
      ]);
      expect(await reader.segmentAsset(recitationId, segments[0]!.id)).toEqual({
        recitationState: 'published',
        publiclyVisible: true,
        assetId: audioAsset,
      });
      expect((await reader.tajweedRules())[0]?.texts[0]?.languageCode).toBe('ur');
      expect((await reader.topicAyat(topicId, 0)).items).toEqual([
        { surah: 2, ayah: 1, text: primary.ayat[3]!.text },
      ]);

      // A fixture corpus is never listed in a sitemap.
      expect(await reader.ayahSitemap(0, 100)).toEqual([]);
      expect(await reader.ayahSitemapCount()).toBe(0);
    });

    it('projects an Ayah for Search with a stamp the batched read reproduces and a change moves', async () => {
      const projection = await reader.searchAyah({ surah: 1, ayah: 1 });
      expect(projection?.text).toBe(primary.ayat[0]!.text);
      expect(projection?.stamp).toMatch(/^[0-9a-f]{64}$/u);
      // Every public layer, in deterministic work-slug order.
      const slugs = projection?.layers.map((layer) => layer.slug) ?? [];
      expect(slugs).toEqual([...slugs].sort());
      expect(slugs).toContain(fixtureTranslation.slug);
      expect(slugs).toContain(approvedTranslation.slug);
      expect(projection?.layers.map((layer) => layer.kind).sort()).toEqual([
        'translation',
        'translation',
        'transliteration',
      ]);

      // The batched current records are the same records, for the public
      // citations only, once each, in canonical order — and bounded.
      const records = await reader.searchAyahRecords([
        { surah: 2, ayah: 4 },
        { surah: 1, ayah: 99 },
        { surah: 1, ayah: 1 },
        { surah: 2, ayah: 4 },
      ]);
      expect(records.map((record) => `${record.surah}:${record.ayah}`)).toEqual([
        '1:1',
        '2:4',
      ]);
      expect(records[0]).toEqual(projection);
      expect(records[1]).toEqual(await reader.searchAyah({ surah: 2, ayah: 4 }));
      await expect(
        reader.searchAyahRecords(
          Array.from({ length: 101 }, (_, index) => ({ surah: 1, ayah: index + 1 })),
        ),
      ).rejects.toThrow();

      const scopes = await reader.searchAyahScopes(null, 500);
      expect(scopes.map((scope) => `${scope.ref.surah}:${scope.ref.ayah}`)).toEqual(
        STRUCTURE.map((entry) => `${entry.surah}:${entry.ayah}`),
      );
      expect(scopes[0]?.stamp).toBe(projection?.stamp);
      expect(
        (await reader.searchAyahScopes({ surah: 1, ayah: 3 }, 2)).map(
          (scope) => `${scope.ref.surah}:${scope.ref.ayah}`,
        ),
      ).toEqual(['2:1', '2:2']);
      expect(
        await reader.publicAyahTargets([
          { surah: 2, ayah: 4 },
          { surah: 1, ayah: 99 },
          { surah: 1, ayah: 1 },
        ]),
      ).toEqual([
        { surah: 1, ayah: 1 },
        { surah: 2, ayah: 4 },
      ]);

      const before = await count(db.admin, 'SearchIndexRequest', "[scopeId] = N'1:1'");
      await persistence.saveTranslationTexts({
        actorId,
        id: fixtureTranslation.id,
        expectedVersion: 3,
        surah: 1,
        changes: [{ ayah: 1, text: 'NON_QURAN_FIXTURE translation 1:1 revised' }],
      });
      expect(await count(db.admin, 'SearchIndexRequest', "[scopeId] = N'1:1'")).toBe(
        before + 1,
      );
      expect((await reader.searchAyah({ surah: 1, ayah: 1 }))?.stamp).not.toBe(
        projection?.stamp,
      );
    });

    it('beside an APPROVED corpus, shows only approved-source works and lists the sitemap', async () => {
      // Every Ayah onto the approved source, then the operator re-activates.
      for (const entry of approved.ayat) {
        const current = await persistence.ayah({ surah: entry.surah, ayah: entry.ayah });
        if (current?.sourceId === approved.id) continue;
        await canonical.correctAyah({
          authority: editor,
          ref: { surah: entry.surah, ayah: entry.ayah },
          expectedVersion: current!.version,
          sourceId: approved.id,
          reviewedText: entry.text,
          reason: 'Fixture approved correction',
        });
      }
      await db.admin.query(`DELETE FROM [dbo].[QuranActivation]`);
      await db.admin.query(
        `INSERT INTO [dbo].[QuranActivation] ([id],[sourceId],[authorisedBy]) VALUES (1, ${n(approved.id)}, N'fixture operator')`,
      );

      expect(await reader.availability()).toEqual({ active: true, mode: 'approved' });
      expect((await reader.translations()).map((work) => work.slug)).toEqual([
        approvedTranslation.slug,
      ]);
      expect(await reader.translation(fixtureTranslation.slug)).toBeNull();
      expect(await reader.translationTexts(fixtureTranslation.id, 1, 1, 3)).toEqual([]);
      expect(await reader.transliterations()).toEqual([]);
      expect(await reader.recitations()).toEqual([]);
      const segment = (await persistence.recitation(recitationId))!.segments[0]!;
      expect((await reader.segmentAsset(recitationId, segment.id))?.publiclyVisible).toBe(
        false,
      );
      expect(
        (await reader.searchAyah({ surah: 1, ayah: 1 }))?.layers.map(
          (layer) => layer.slug,
        ),
      ).toEqual([approvedTranslation.slug]);
      // The batched current-records read applies the same approved-mode rule.
      expect(
        (await reader.searchAyahRecords([{ surah: 1, ayah: 1 }]))[0]?.layers.map(
          (layer) => layer.slug,
        ),
      ).toEqual([approvedTranslation.slug]);

      expect(await reader.ayahSitemapCount()).toBe(7);
      expect(
        (await reader.ayahSitemap(5, 100)).map((row) => `${row.surah}:${row.ayah}`),
      ).toEqual(['2:3', '2:4']);
    });
  });

  it('never writes religious text into the audit log', async () => {
    const leaked = await count(
      db.admin,
      'AuditLog',
      `CHARINDEX(N'NON_QURAN_FIXTURE', CONCAT([beforeState], [afterState])) > 0 OR CHARINDEX(${n(NEUTRAL)}, CONCAT([beforeState], [afterState])) > 0`,
    );
    expect(leaked).toBe(0);
  });
});
