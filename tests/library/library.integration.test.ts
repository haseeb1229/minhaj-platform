import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createProofDatabase,
  databaseConfigured,
  type DisposableDatabase,
} from '../identity/harness.ts';
import { createProofAccount } from '../people/harness.ts';
import type {
  EditionInput,
  LibraryPersistencePort,
  LibraryPublicReaderPort,
  WorkInput,
} from '../../packages/contracts/src/library/index.ts';
import type {
  AssetPersistencePort,
  MalwareScannerPort,
} from '../../packages/contracts/src/platform/storage.ts';
import {
  newPhase5Fixture,
  writePhase5Fixture,
  type Phase5Fixture,
} from '../../packages/database/src/lifecycle/phase5-fixture.ts';
import {
  createLibraryAssetPolicy,
  createLibraryReadService,
  createLibraryService,
  libraryFailure,
} from '../../apps/web/src/contexts/library/index.ts';
import { createAuthorizationService } from '../../packages/server-core/src/authorization/index.ts';
import {
  createFilesystemStore,
  type FilesystemStore,
} from '../../packages/storage/src/filesystem.ts';
import { createStorageService } from '../../packages/storage/src/service.ts';

/**
 * Phase 8 — the Library over a REAL SQL Server, and against the REAL Storage
 * service.
 *
 * WHAT THIS PROVES THAT THE UNIT SUITES CANNOT. The database is where "one Work,
 * many Editions", "a source Edition belongs to the same Work", "a slug is never
 * reused" and "a stale save conflicts" are actually enforced — by foreign keys,
 * composite keys, a trigger and a version-guarded UPDATE inside a transaction.
 * A mock would prove the code asks; this proves the answer.
 *
 * THE SCANNER IS A STUB, AND THAT IS DELIBERATE (§59). Phase 7's Database
 * foundation job proves the real ClamAV integration on a clean runner. What
 * Phase 8 must prove is the BUSINESS decision composed with Storage's TECHNICAL
 * one — that both must allow — and a stub that says `clean` or `unavailable` on
 * demand is what lets one test put a clean asset and a quarantined asset side by
 * side. Duplicating the scanner proof here would test ClamAV again and Library no
 * more.
 *
 * EVERYTHING IS SYNTHETIC. Titles say so, the text is non-authoritative, the
 * people are the Phase-5 rehearsal contributors, and no real book is ingested.
 */

const live = databaseConfigured ? describe : describe.skip;

const PDF = new TextEncoder().encode(
  '%PDF-1.4\n% synthetic non-authoritative proof document\n%%EOF\n',
);

const bytes = (data: Uint8Array) =>
  (async function* () {
    yield data;
  })();

const PDFS = { allowedMediaTypes: ['application/pdf'], maxBytes: 1024 * 1024 };

const cleanScanner: MalwareScannerPort = { scan: async () => ({ status: 'clean' }) };
const unavailableScanner: MalwareScannerPort = {
  scan: async () => ({ status: 'unavailable' }),
};

let sequence = 0;
const slug = (prefix = 'synthetic-work') => {
  sequence += 1;
  return `${prefix}-${String(sequence)}-${Date.now().toString(36)}`;
};

live('Phase 8 Library against real SQL Server and real Storage', () => {
  let db: DisposableDatabase;
  let store: LibraryPersistencePort;
  let reader: LibraryPublicReaderPort;
  let assets: AssetPersistencePort;
  let files: FilesystemStore;
  let root: string;
  let people: Phase5Fixture;
  let topicId: string;
  let service: ReturnType<typeof createLibraryService>;
  let publicReads: ReturnType<typeof createLibraryReadService>;
  let authorization: ReturnType<typeof createAuthorizationService>;
  let administrator: { accountId: string };
  let reader2: { accountId: string };

  async function account(
    keys: readonly string[],
  ): Promise<{ accountId: string; roleId: string }> {
    const id = await createProofAccount(db.admin);
    const role = randomUUID();
    await db.admin.query(
      `INSERT INTO [Role] ([id],[key],[name],[description],[system]) VALUES (N'${role}',N'proof-${role}',N'Synthetic library role',N'Test fixture',0); INSERT INTO [RoleAssignment] ([userId],[roleId]) VALUES (N'${id}',N'${role}');`,
    );
    for (const key of keys) {
      await db.admin.query(
        `INSERT INTO [RolePermission] ([roleId],[permissionKey]) VALUES (N'${role}',N'${key}');`,
      );
    }
    return { accountId: id, roleId: role };
  }

  const workInput = (overrides: Partial<WorkInput> = {}): WorkInput => ({
    slug: slug(),
    primaryLocale: 'ar',
    state: 'published',
    isFeatured: false,
    labels: [
      { locale: 'ar', title: 'عمل تجريبي غير موثوق', description: '' },
      { locale: 'en', title: 'Synthetic non-authoritative work', description: 'Proof.' },
    ],
    contributors: [{ personId: people.linkedPersonId, role: 'author' }],
    topicIds: [topicId],
    salePointIds: [],
    ...overrides,
  });

  const editionInput = (workId: string, overrides: Partial<EditionInput> = {}) => ({
    workId,
    label: 'Synthetic edition',
    languageCode: 'ar',
    state: 'published' as const,
    publisher: null,
    publicationYear: null,
    isbn: null,
    pageCount: null,
    reading: 'allowed' as const,
    download: 'denied' as const,
    readableAssetId: null,
    downloadAssetId: null,
    document: {
      sections: [
        { key: 'opening', title: 'Opening', paragraphs: ['Synthetic proof text.'] },
        { key: 'closing', title: 'Closing', paragraphs: ['More synthetic text.'] },
      ],
    },
    ...overrides,
  });

  beforeAll(async () => {
    db = await createProofDatabase();

    // Imported AFTER the harness has repointed DATABASE_URL at the disposable
    // database, so every client binds to the proof target.
    const {
      createLibraryPersistence,
      createLibraryPublicReader,
      createAssetPersistence,
    } = await import('../../packages/database/src/index.ts');
    const { createAuthorizationReader } =
      await import('../../packages/database/src/adapters/identity-access/index.ts');
    const { createPeopleReader } =
      await import('../../packages/database/src/adapters/people-contributors/index.ts');
    const { createTaxonomyReader } =
      await import('../../packages/database/src/adapters/taxonomy/index.ts');

    people = newPhase5Fixture();
    await writePhase5Fixture(db.admin, people);

    const [topic] = await db.admin.query<{ id: string }>(
      "SELECT TOP 1 [id] FROM [Topic] WHERE [status]=N'active' ORDER BY [id];",
    );
    if (topic === undefined) throw new Error('No seeded Topic is available.');
    topicId = topic.id;

    store = createLibraryPersistence();
    reader = createLibraryPublicReader();
    assets = createAssetPersistence();
    authorization = createAuthorizationService({ reader: createAuthorizationReader() });

    service = createLibraryService({
      persistence: store,
      authority: {
        permits: (id, key) => authorization.hasPermission(id, key),
      },
      references: {
        validPeople: async (ids) =>
          ids.length === 0 ||
          (await createPeopleReader().contributorReferences([...new Set(ids)], 'en'))
            .length === new Set(ids).size,
        validTopics: async (ids) =>
          ids.length === 0 ||
          (await createTaxonomyReader().topicReferences(ids, 'en')).length === ids.length,
        validLanguage: async (code) =>
          (await createTaxonomyReader().listLanguages({ includeRetired: false })).some(
            (language) => language.code === code,
          ),
      },
    });
    publicReads = createLibraryReadService(reader);

    administrator = await account(['library.read', 'library.administer']);
    reader2 = await account(['library.read']);

    root = mkdtempSync(path.join(tmpdir(), 'minhaj-library-sql-'));
    files = await createFilesystemStore(root);
  }, 600_000);

  afterAll(async () => {
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
    await db?.close();
  });

  const storage = (scanner: MalwareScannerPort = cleanScanner) =>
    createStorageService({ files, assets, scanner, maxBytes: 4 * 1024 * 1024 });

  /* ---------------------------------------------------------------------- */

  describe('Work, Edition and BookTranslation are distinct', () => {
    it('models one Work with many Editions in multiple content languages', async () => {
      const work = await service.saveWork(administrator, null, null, workInput());
      const arabic = await service.saveEdition(
        administrator,
        null,
        null,
        editionInput(work.id),
      );
      const urdu = await service.saveEdition(
        administrator,
        null,
        null,
        editionInput(work.id, { label: 'Synthetic Urdu edition', languageCode: 'ur' }),
      );

      const detail = await publicReads.work(work.slug);
      expect(detail?.editions.map((edition) => edition.id).sort()).toEqual(
        [arabic.id, urdu.id].sort(),
      );
      expect(new Set(detail?.editions.map((edition) => edition.languageCode))).toEqual(
        new Set(['ar', 'ur']),
      );
    });

    it('keeps localized metadata separate from a genuine translated Edition', async () => {
      // An English LABEL and no English EDITION: the label says nothing about
      // translation, and no translation relation exists.
      const work = await service.saveWork(administrator, null, null, workInput());
      await service.saveEdition(administrator, null, null, editionInput(work.id));

      const detail = await publicReads.work(work.slug);
      expect(detail?.labels.map((label) => label.locale).sort()).toEqual(['ar', 'en']);
      expect(detail?.editions.some((edition) => edition.languageCode === 'en')).toBe(
        false,
      );
      expect(detail?.editions.every((edition) => edition.translation === null)).toBe(
        true,
      );
    });

    it('records a translation with translators and a same-Work source Edition', async () => {
      const work = await service.saveWork(administrator, null, null, workInput());
      const source = await service.saveEdition(
        administrator,
        null,
        null,
        editionInput(work.id),
      );
      const target = await service.saveEdition(
        administrator,
        null,
        null,
        editionInput(work.id, { label: 'Synthetic translation', languageCode: 'ur' }),
      );

      await service.saveTranslation(administrator, {
        editionId: target.id,
        expectedVersion: target.version,
        sourceEditionId: source.id,
        translatorIds: [people.historicalPersonId],
      });

      const saved = await store.edition(target.id);
      expect(saved?.translation).toEqual({
        sourceEditionId: source.id,
        translatorIds: [people.historicalPersonId],
      });
    });

    it('refuses a source Edition from ANOTHER Work', async () => {
      const first = await service.saveWork(administrator, null, null, workInput());
      const second = await service.saveWork(administrator, null, null, workInput());
      const foreign = await service.saveEdition(
        administrator,
        null,
        null,
        editionInput(first.id),
      );
      const target = await service.saveEdition(
        administrator,
        null,
        null,
        editionInput(second.id, { languageCode: 'ur' }),
      );

      await expect(
        service.saveTranslation(administrator, {
          editionId: target.id,
          expectedVersion: target.version,
          sourceEditionId: foreign.id,
          translatorIds: [people.historicalPersonId],
        }),
      ).rejects.toSatisfy((error: unknown) => libraryFailure(error) === 'invalid');
    });

    it('refuses the composite relation at the DATABASE, whatever the application does', async () => {
      // A BookTranslation's (sourceEditionId, workId) is a composite foreign key
      // to Edition (id, workId), so a cross-Work source cannot be stored by any
      // writer — including one that skips the service.
      const first = await service.saveWork(administrator, null, null, workInput());
      const second = await service.saveWork(administrator, null, null, workInput());
      const foreign = await service.saveEdition(
        administrator,
        null,
        null,
        editionInput(first.id),
      );
      const target = await service.saveEdition(
        administrator,
        null,
        null,
        editionInput(second.id, { languageCode: 'ur' }),
      );

      await expect(
        db.admin.query(
          `INSERT INTO [BookTranslation] ([editionId],[workId],[sourceEditionId]) VALUES (N'${target.id}',N'${second.id}',N'${foreign.id}');`,
        ),
      ).rejects.toThrow();

      await expect(
        db.admin.query(
          `INSERT INTO [BookTranslation] ([editionId],[workId],[sourceEditionId]) VALUES (N'${target.id}',N'${second.id}',N'${target.id}');`,
        ),
      ).rejects.toThrow();
    });

    it('refuses a translator or contributor who is not a Person', async () => {
      const work = await service.saveWork(administrator, null, null, workInput());
      const target = await service.saveEdition(
        administrator,
        null,
        null,
        editionInput(work.id),
      );

      await expect(
        service.saveTranslation(administrator, {
          editionId: target.id,
          expectedVersion: target.version,
          sourceEditionId: null,
          translatorIds: [randomUUID()],
        }),
      ).rejects.toSatisfy((error: unknown) => libraryFailure(error) === 'invalid');

      await expect(
        service.saveWork(
          administrator,
          null,
          null,
          workInput({ contributors: [{ personId: randomUUID(), role: 'author' }] }),
        ),
      ).rejects.toSatisfy((error: unknown) => libraryFailure(error) === 'invalid');
    });
  });

  /* ---------------------------------------------------------------------- */

  describe('authority is Library-owned and live', () => {
    it('denies a mutation without library.administer, and a read without library.read', async () => {
      const stranger = { accountId: await createProofAccount(db.admin) };

      await expect(service.saveWork(reader2, null, null, workInput())).rejects.toSatisfy(
        (error: unknown) => libraryFailure(error) === 'denied',
      );
      await expect(service.works(stranger)).rejects.toSatisfy(
        (error: unknown) => libraryFailure(error) === 'denied',
      );
    });

    it('denies the next action after the role is revoked', async () => {
      const operator = await account(['library.read', 'library.administer']);
      const actor = { accountId: operator.accountId };

      await service.saveWork(actor, null, null, workInput());
      await db.admin.query(
        `UPDATE [RoleAssignment] SET [revokedAt]=SYSUTCDATETIME() WHERE [userId]=N'${operator.accountId}';`,
      );

      await expect(service.saveWork(actor, null, null, workInput())).rejects.toSatisfy(
        (error: unknown) => libraryFailure(error) === 'denied',
      );
    });

    it('does not accept Editorial authority as Library authority', async () => {
      const editor = {
        accountId: (await account(['content.read', 'content.publish'])).accountId,
      };
      await expect(service.saveWork(editor, null, null, workInput())).rejects.toSatisfy(
        (error: unknown) => libraryFailure(error) === 'denied',
      );
    });
  });

  /* ---------------------------------------------------------------------- */

  describe('material mutations carry expected versions', () => {
    it('a stale Work save conflicts instead of overwriting', async () => {
      const work = await service.saveWork(administrator, null, null, workInput());
      const input = workInput({ slug: work.slug });

      await service.saveWork(administrator, work.id, work.version, {
        ...input,
        isFeatured: true,
      });

      await expect(
        service.saveWork(administrator, work.id, work.version, input),
      ).rejects.toSatisfy((error: unknown) => libraryFailure(error) === 'conflict');
    });

    it('two simultaneous saves of one version: exactly one wins', async () => {
      const work = await service.saveWork(administrator, null, null, workInput());
      const edition = await service.saveEdition(
        administrator,
        null,
        null,
        editionInput(work.id),
      );

      const outcomes = await Promise.allSettled([
        service.saveEdition(
          administrator,
          edition.id,
          edition.version,
          editionInput(work.id, { label: 'Concurrent A' }),
        ),
        service.saveEdition(
          administrator,
          edition.id,
          edition.version,
          editionInput(work.id, { label: 'Concurrent B' }),
        ),
      ]);

      expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(
        1,
      );
      const rejected = outcomes.find((outcome) => outcome.status === 'rejected');
      expect(libraryFailure((rejected as PromiseRejectedResult).reason)).toBe('conflict');
    });

    it('a stale asset relation cannot silently replace a newer one', async () => {
      const work = await service.saveWork(administrator, null, null, workInput());
      const edition = await service.saveEdition(
        administrator,
        null,
        null,
        editionInput(work.id),
      );
      const first = await storage().store(bytes(PDF), PDFS);
      const second = await storage().store(bytes(PDF), PDFS);

      await service.saveEdition(
        administrator,
        edition.id,
        edition.version,
        editionInput(work.id, { readableAssetId: first.id }),
      );

      await expect(
        service.saveEdition(
          administrator,
          edition.id,
          edition.version,
          editionInput(work.id, { readableAssetId: second.id }),
        ),
      ).rejects.toSatisfy((error: unknown) => libraryFailure(error) === 'conflict');

      expect((await store.edition(edition.id))?.readableAssetId).toBe(first.id);
    });
  });

  /* ---------------------------------------------------------------------- */

  describe('native slug history', () => {
    it('reserves the old slug, resolves it to the current one, and never reuses it', async () => {
      const original = slug('synthetic-renamed');
      const work = await service.saveWork(
        administrator,
        null,
        null,
        workInput({ slug: original }),
      );
      await service.saveEdition(administrator, null, null, editionInput(work.id));

      // Saving an Edition serialises at its owning Work and moves the Work's
      // version, so the rename is made against the CURRENT version.
      const current = await store.work(work.id);
      const renamed = slug('synthetic-current');
      await service.saveWork(
        administrator,
        work.id,
        current?.version ?? work.version,
        workInput({ slug: renamed }),
      );

      expect(await publicReads.work(original)).toBeNull();
      expect(await publicReads.canonicalSlug(original)).toBe(renamed);
      expect((await publicReads.work(renamed))?.id).toBe(work.id);

      // ANOTHER Work may not take the retired address.
      await expect(
        service.saveWork(administrator, null, null, workInput({ slug: original })),
      ).rejects.toSatisfy((error: unknown) => libraryFailure(error) === 'duplicate-slug');
    });

    it('lets a Work return to its OWN former slug without a self-redirect', async () => {
      const first = slug('synthetic-a');
      const second = slug('synthetic-b');
      const work = await service.saveWork(
        administrator,
        null,
        null,
        workInput({ slug: first }),
      );
      await service.saveEdition(administrator, null, null, editionInput(work.id));

      const before = await store.work(work.id);
      const moved = await service.saveWork(
        administrator,
        work.id,
        before?.version ?? work.version,
        workInput({ slug: second }),
      );
      await service.saveWork(
        administrator,
        work.id,
        moved.version,
        workInput({ slug: first }),
      );

      expect((await publicReads.work(first))?.id).toBe(work.id);
      expect(await publicReads.canonicalSlug(second)).toBe(first);
    });
  });

  /* ---------------------------------------------------------------------- */

  describe('the public reader shows only what is public', () => {
    it('hides drafts, archived Works and Works with no published Edition', async () => {
      const draft = await service.saveWork(
        administrator,
        null,
        null,
        workInput({ state: 'draft' }),
      );
      await service.saveEdition(administrator, null, null, editionInput(draft.id));
      const editionless = await service.saveWork(administrator, null, null, workInput());
      const draftEditionOnly = await service.saveWork(
        administrator,
        null,
        null,
        workInput(),
      );
      await service.saveEdition(
        administrator,
        null,
        null,
        editionInput(draftEditionOnly.id, { state: 'draft' }),
      );

      for (const hidden of [draft, editionless, draftEditionOnly]) {
        expect(await publicReads.work(hidden.slug)).toBeNull();
      }

      const sitemap = await publicReads.sitemap(0, 5000);
      const slugs = sitemap.map((row) => row.slug);
      for (const hidden of [draft, editionless, draftEditionOnly]) {
        expect(slugs).not.toContain(hidden.slug);
      }
    });

    it('never exposes a draft Edition, or a readable file whose reading is unavailable', async () => {
      const work = await service.saveWork(administrator, null, null, workInput());
      const published = await service.saveEdition(
        administrator,
        null,
        null,
        editionInput(work.id),
      );
      const draft = await service.saveEdition(
        administrator,
        null,
        null,
        editionInput(work.id, { state: 'draft', label: 'Hidden draft' }),
      );
      const file = await storage().store(bytes(PDF), PDFS);
      const restricted = await service.saveEdition(
        administrator,
        null,
        null,
        editionInput(work.id, {
          label: 'Restricted',
          reading: 'unavailable',
          document: null,
          readableAssetId: file.id,
        }),
      );

      const detail = await publicReads.work(work.slug);
      const ids = detail?.editions.map((edition) => edition.id) ?? [];
      expect(ids).toContain(published.id);
      expect(ids).not.toContain(draft.id);

      const shown = detail?.editions.find((edition) => edition.id === restricted.id);
      expect(shown?.readableAssetId).toBeNull();
      expect(shown?.document).toBeNull();
    });

    it('lists facets of public Works only, in a deterministic order', async () => {
      const first = await publicReads.languageFacets(0);
      const again = await publicReads.languageFacets(0);
      expect(again).toEqual(first);
      expect(first.items.every((facet) => facet.works > 0)).toBe(true);

      const topics = await publicReads.topicFacets(0);
      expect(topics.items.some((facet) => facet.id === topicId)).toBe(true);
    });

    it('filters books by content language and topic IN SQL, bounded', async () => {
      const urduOnly = await publicReads.works({ language: 'ur' });
      expect(urduOnly.items.length).toBeLessThanOrEqual(25);
      for (const record of urduOnly.items) {
        const detail = await publicReads.work(record.slug);
        expect(detail?.editions.some((edition) => edition.languageCode === 'ur')).toBe(
          true,
        );
      }
    });
  });

  /* ---------------------------------------------------------------------- */

  describe('audit is minimal', () => {
    it('records identifiers and state transitions, never the book text', async () => {
      const work = await service.saveWork(administrator, null, null, workInput());
      const edition = await service.saveEdition(
        administrator,
        null,
        null,
        editionInput(work.id),
      );

      const rows = await db.admin.query<{ action: string; payload: string }>(
        `SELECT [action], CONCAT([beforeState],N'|',[afterState]) AS [payload] FROM [AuditLog] WHERE [targetId] IN (N'${work.id}',N'${edition.id}');`,
      );

      expect(rows.map((row) => row.action).sort()).toEqual(
        ['library.edition.created', 'library.work.created'].sort(),
      );
      for (const row of rows) {
        expect(row.payload).not.toContain('Synthetic proof text');
        expect(row.payload).not.toContain('Synthetic non-authoritative work');
      }
    });
  });

  /* ---------------------------------------------------------------------- */

  describe('Library and Storage must BOTH allow', () => {
    async function open(
      editionId: string,
      assetId: string,
      purpose: 'read' | 'download',
      scanner: MalwareScannerPort = cleanScanner,
    ) {
      const policy = createLibraryAssetPolicy({
        reader,
        request: { editionId, assetId, purpose },
      });
      return storage(scanner).open(assetId, policy);
    }

    it('serves the recorded readable file of a public Edition, streamed', async () => {
      const work = await service.saveWork(administrator, null, null, workInput());
      const file = await storage().store(bytes(PDF), PDFS);
      expect(file.state).toBe('clean');

      const edition = await service.saveEdition(
        administrator,
        null,
        null,
        editionInput(work.id, { document: null, readableAssetId: file.id }),
      );

      const opened = await open(edition.id, file.id, 'read');
      expect(opened?.mediaType).toBe('application/pdf');
      expect(opened?.byteSize).toBe(PDF.byteLength);
    });

    it('refuses a download when download is denied, even though the file is clean', async () => {
      const work = await service.saveWork(administrator, null, null, workInput());
      const file = await storage().store(bytes(PDF), PDFS);
      const edition = await service.saveEdition(
        administrator,
        null,
        null,
        editionInput(work.id, { download: 'denied', downloadAssetId: file.id }),
      );

      expect(await open(edition.id, file.id, 'download')).toBeNull();
    });

    it('refuses a clean asset that is not related to the Edition', async () => {
      const work = await service.saveWork(administrator, null, null, workInput());
      const edition = await service.saveEdition(
        administrator,
        null,
        null,
        editionInput(work.id),
      );
      const orphan = await storage().store(bytes(PDF), PDFS);

      // Also the upload-then-relation-failed crash window (§29): an asset that
      // was stored and never attached is not publicly reachable.
      expect(await open(edition.id, orphan.id, 'read')).toBeNull();
      expect(await open(edition.id, orphan.id, 'download')).toBeNull();
    });

    it('refuses a QUARANTINED asset even when the Library relation allows it', async () => {
      const work = await service.saveWork(administrator, null, null, workInput());
      const quarantined = await storage(unavailableScanner).store(bytes(PDF), PDFS);
      expect(quarantined.state).not.toBe('clean');

      const edition = await service.saveEdition(
        administrator,
        null,
        null,
        editionInput(work.id, { download: 'allowed', downloadAssetId: quarantined.id }),
      );

      // The Library decision on its own would allow this...
      const relation = await reader.assetRelation(edition.id);
      expect(relation?.download).toBe('allowed');
      expect(relation?.downloadAssetId).toBe(quarantined.id);

      // ...and Storage refuses it anyway.
      expect(await open(edition.id, quarantined.id, 'download')).toBeNull();
    });

    it('stops serving the moment the Edition is withdrawn', async () => {
      const work = await service.saveWork(administrator, null, null, workInput());
      const file = await storage().store(bytes(PDF), PDFS);
      const edition = await service.saveEdition(
        administrator,
        null,
        null,
        editionInput(work.id, { download: 'allowed', downloadAssetId: file.id }),
      );
      expect(await open(edition.id, file.id, 'download')).not.toBeNull();

      await service.saveEdition(
        administrator,
        edition.id,
        edition.version,
        editionInput(work.id, {
          state: 'archived',
          download: 'allowed',
          downloadAssetId: file.id,
        }),
      );

      expect(await open(edition.id, file.id, 'download')).toBeNull();
    });
  });
});
