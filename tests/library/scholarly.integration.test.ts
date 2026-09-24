import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createProofDatabase,
  databaseConfigured,
  type DisposableDatabase,
} from '../identity/harness.ts';
import { createProofAccount } from '../people/harness.ts';
import {
  newPhase5Fixture,
  writePhase5Fixture,
  type Phase5Fixture,
} from '../../packages/database/src/lifecycle/phase5-fixture.ts';
import {
  createLibraryReadService,
  createLibraryService,
  libraryFailure,
} from '../../apps/web/src/contexts/library/index.ts';
import { createAuthorizationService } from '../../packages/server-core/src/authorization/index.ts';

/**
 * Phase 9 — Research, ResearchPaper, Publication, Magazine, MagazineIssue and
 * Encyclopedia over a REAL SQL Server, through the real Library service.
 *
 * WHAT ONLY THE DATABASE CAN PROVE: that six aggregates are six tables; that a
 * slug is reserved for ever by a trigger no writer can skip; that an issue's
 * slug and numbers are unique WITHIN its Magazine and it can never leave it;
 * that a stale save conflicts inside the writing transaction; and that the
 * audit and the search intent commit with the change they describe.
 *
 * EVERYTHING IS SYNTHETIC — titles, text, citations and people.
 */

const live = databaseConfigured ? describe : describe.skip;

/** What a read carries that an input never does. */
const READ_ONLY = new Set(['id', 'kind', 'version', 'updatedAt', 'magazine']);

let sequence = 0;
const slug = (prefix = 'scholarly') => {
  sequence += 1;
  return `${prefix}-${String(sequence)}-${Date.now().toString(36)}`;
};

live('Phase 9 Library aggregates against real SQL Server', () => {
  let db: DisposableDatabase;
  let people: Phase5Fixture;
  let topicId: string;
  let service: ReturnType<typeof createLibraryService>;
  let reads: ReturnType<typeof createLibraryReadService>;
  let librarian: { accountId: string };
  let reader: { accountId: string };
  let outsider: { accountId: string };

  async function account(keys: readonly string[]): Promise<{ accountId: string }> {
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
    return { accountId: id };
  }

  const described = (overrides: Record<string, unknown> = {}) => ({
    slug: slug(),
    primaryLocale: 'en',
    state: 'published',
    labels: [{ locale: 'en', title: 'Synthetic non-authoritative record', summary: '' }],
    contributors: [{ personId: people.linkedPersonId, role: 'author' }],
    topicIds: [topicId],
    ...overrides,
  });
  const dated = (overrides: Record<string, unknown> = {}) =>
    described({
      languageCode: 'en',
      publicationYear: null,
      publishedOn: null,
      document: null,
      ...overrides,
    });
  const researchInput = (overrides: Record<string, unknown> = {}) =>
    dated({ institutionalContext: null, abstract: null, citations: [], ...overrides });
  const paperInput = (overrides: Record<string, unknown> = {}) =>
    researchInput({ venue: null, doi: null, ...overrides });
  const issueInput = (magazineId: string, overrides: Record<string, unknown> = {}) =>
    dated({ magazineId, volume: null, issueNumber: null, ...overrides });

  /** A record read back as the input that saves it unchanged. */
  const editable = (record: object): Record<string, unknown> =>
    Object.fromEntries(Object.entries(record).filter(([key]) => !READ_ONLY.has(key)));

  const refusal = async (promise: Promise<unknown>) => {
    try {
      await promise;
    } catch (error) {
      return libraryFailure(error);
    }
    return 'accepted';
  };

  beforeAll(async () => {
    db = await createProofDatabase();

    const { createLibraryPersistence, createLibraryPublicReader } =
      await import('../../packages/database/src/index.ts');
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

    const authorization = createAuthorizationService({
      reader: createAuthorizationReader(),
    });
    service = createLibraryService({
      persistence: createLibraryPersistence(),
      authority: { permits: (id, key) => authorization.hasPermission(id, key) },
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
    reads = createLibraryReadService(createLibraryPublicReader());

    librarian = await account(['library.read', 'library.administer']);
    reader = await account(['library.read']);
    outsider = await account([]);
  }, 600_000);

  afterAll(async () => {
    await db?.close();
  });

  describe('six distinct aggregates', () => {
    it('stores each kind in its own table, never one content table', async () => {
      const research = await service.saveScholarly(
        librarian,
        'research',
        null,
        null,
        researchInput(),
      );
      const paper = await service.saveScholarly(
        librarian,
        'research-paper',
        null,
        null,
        paperInput(),
      );
      const [rows] = await db.admin.query<{
        research: number;
        paper: number;
        crossed: number;
      }>(
        `SELECT (SELECT COUNT(*) FROM [dbo].[Research] WHERE [id]=N'${research.id}') AS research,
                (SELECT COUNT(*) FROM [dbo].[ResearchPaper] WHERE [id]=N'${paper.id}') AS paper,
                (SELECT COUNT(*) FROM [dbo].[ResearchPaper] WHERE [id]=N'${research.id}') AS crossed;`,
      );
      expect([
        Number(rows?.research),
        Number(rows?.paper),
        Number(rows?.crossed),
      ]).toEqual([1, 1, 0]);
      // A research record read as a paper is simply not a paper.
      expect(
        await service.scholarlyRecord(librarian, 'research-paper', research.id),
      ).toBeNull();
    });

    it('refuses a contributor, topic, language or Magazine its owner does not know', async () => {
      const unknown = randomUUID();
      expect(
        await refusal(
          service.saveScholarly(
            librarian,
            'research',
            null,
            null,
            researchInput({ contributors: [{ personId: unknown, role: 'author' }] }),
          ),
        ),
      ).toBe('invalid');
      expect(
        await refusal(
          service.saveScholarly(
            librarian,
            'publication',
            null,
            null,
            dated({ publisher: null, topicIds: [unknown] }),
          ),
        ),
      ).toBe('invalid');
      expect(
        await refusal(
          service.saveScholarly(
            librarian,
            'encyclopedia',
            null,
            null,
            dated({ publisher: null, languageCode: 'xx' }),
          ),
        ),
      ).toBe('invalid');
      expect(
        await refusal(
          service.saveScholarly(
            librarian,
            'magazine-issue',
            null,
            null,
            issueInput(unknown),
          ),
        ),
      ).toBe('invalid');
    });
  });

  describe('lifecycle and public visibility', () => {
    it('shows only published records, and an issue only within a published Magazine', async () => {
      const draft = await service.saveScholarly(
        librarian,
        'publication',
        null,
        null,
        dated({ publisher: null, state: 'draft' }),
      );
      const archived = await service.saveScholarly(
        librarian,
        'publication',
        null,
        null,
        dated({ publisher: null, state: 'archived' }),
      );
      const shown = await service.saveScholarly(
        librarian,
        'publication',
        null,
        null,
        dated({ publisher: 'Synthetic Press' }),
      );
      expect(await reads.scholarlyRecord('publication', draft.slug)).toBeNull();
      expect(await reads.scholarlyRecord('publication', archived.slug)).toBeNull();
      expect((await reads.scholarlyRecord('publication', shown.slug))?.id).toBe(shown.id);

      const magazine = await service.saveScholarly(
        librarian,
        'magazine',
        null,
        null,
        described({ state: 'draft' }),
      );
      const issue = await service.saveScholarly(
        librarian,
        'magazine-issue',
        null,
        null,
        issueInput(magazine.id),
      );
      // The issue is published; its Magazine is not — so it is not public.
      expect(await reads.magazineIssue(magazine.slug, issue.slug)).toBeNull();
      const listed = await reads.scholarlyList('magazine-issue', {});
      expect(listed.items.some((row) => row.id === issue.id)).toBe(false);

      const published = await service.saveScholarly(
        librarian,
        'magazine',
        magazine.id,
        magazine.version,
        { ...editable(magazine), state: 'published' },
      );
      expect((await reads.magazineIssue(published.slug, issue.slug))?.id).toBe(issue.id);
    });

    it('keeps a Magazine with no published issue public, with an honest empty list', async () => {
      const magazine = await service.saveScholarly(
        librarian,
        'magazine',
        null,
        null,
        described(),
      );
      expect((await reads.scholarlyRecord('magazine', magazine.slug))?.id).toBe(
        magazine.id,
      );
      expect(await reads.magazineIssues(magazine.id)).toEqual({
        items: [],
        hasMore: false,
      });
    });
  });

  describe('native slug history', () => {
    it('reserves every former slug, resolves it directly, and never lets another record reuse it', async () => {
      const first = slug('history');
      const research = await service.saveScholarly(
        librarian,
        'research',
        null,
        null,
        researchInput({ slug: first }),
      );
      const second = slug('history');
      const renamed = await service.saveScholarly(
        librarian,
        'research',
        research.id,
        research.version,
        { ...editable(research), slug: second },
      );
      const third = slug('history');
      await service.saveScholarly(librarian, 'research', research.id, renamed.version, {
        ...editable(renamed),
        slug: third,
      });

      // DIRECT: the oldest slug resolves to the CURRENT one, not to the next.
      expect(await reads.scholarlyCanonicalSlug('research', first)).toBe(third);
      expect(await reads.scholarlyCanonicalSlug('research', second)).toBe(third);

      // Another record — even of the same kind — can take none of them.
      for (const taken of [first, second, third]) {
        expect(
          await refusal(
            service.saveScholarly(
              librarian,
              'research',
              null,
              null,
              researchInput({ slug: taken }),
            ),
          ),
        ).toBe('duplicate-slug');
      }
      // A different aggregate has its own namespace and its own address.
      await service.saveScholarly(
        librarian,
        'encyclopedia',
        null,
        null,
        dated({ publisher: null, slug: first }),
      );
    });

    it('lets a record return to its own former slug — that is not reuse', async () => {
      const original = slug('return');
      const paper = await service.saveScholarly(
        librarian,
        'research-paper',
        null,
        null,
        paperInput({ slug: original }),
      );
      const away = await service.saveScholarly(
        librarian,
        'research-paper',
        paper.id,
        paper.version,
        { ...editable(paper), slug: slug('away') },
      );
      const back = await service.saveScholarly(
        librarian,
        'research-paper',
        paper.id,
        away.version,
        { ...editable(away), slug: original },
      );
      expect(back.slug).toBe(original);
      expect(await reads.scholarlyCanonicalSlug('research-paper', original)).toBe(
        original,
      );
    });

    it('resolves an old Magazine slug with an old issue slug to the current address in ONE step', async () => {
      const magazine = await service.saveScholarly(
        librarian,
        'magazine',
        null,
        null,
        described({ slug: slug('monthly') }),
      );
      const issue = await service.saveScholarly(
        librarian,
        'magazine-issue',
        null,
        null,
        issueInput(magazine.id, { slug: 'spring' }),
      );
      const renamedMagazine = await service.saveScholarly(
        librarian,
        'magazine',
        magazine.id,
        magazine.version,
        { ...editable(magazine), slug: slug('monthly-renamed') },
      );
      await service.saveScholarly(librarian, 'magazine-issue', issue.id, issue.version, {
        ...editable(issue),
        slug: 'spring-renamed',
      });

      const current = { magazineSlug: renamedMagazine.slug, issueSlug: 'spring-renamed' };
      expect(await reads.magazineIssueCanonical(magazine.slug, 'spring')).toEqual(
        current,
      );
      expect(await reads.magazineIssueCanonical(renamedMagazine.slug, 'spring')).toEqual(
        current,
      );
      expect(await reads.magazineIssueCanonical(magazine.slug, 'spring-renamed')).toEqual(
        current,
      );
    });
  });

  describe('the issue hierarchy', () => {
    it('keeps slugs and (volume, number) unique WITHIN a Magazine, and only there', async () => {
      const one = await service.saveScholarly(
        librarian,
        'magazine',
        null,
        null,
        described(),
      );
      const two = await service.saveScholarly(
        librarian,
        'magazine',
        null,
        null,
        described(),
      );
      await service.saveScholarly(
        librarian,
        'magazine-issue',
        null,
        null,
        issueInput(one.id, { slug: 'winter', volume: 2, issueNumber: 1 }),
      );

      expect(
        await refusal(
          service.saveScholarly(
            librarian,
            'magazine-issue',
            null,
            null,
            issueInput(one.id, { slug: 'winter' }),
          ),
        ),
      ).toBe('duplicate-slug');
      expect(
        await refusal(
          service.saveScholarly(
            librarian,
            'magazine-issue',
            null,
            null,
            issueInput(one.id, { slug: 'winter-again', volume: 2, issueNumber: 1 }),
          ),
        ),
      ).toBe('duplicate-number');
      // Two issues with no printed numbers are not duplicates of each other.
      for (const name of ['undated-a', 'undated-b']) {
        await service.saveScholarly(
          librarian,
          'magazine-issue',
          null,
          null,
          issueInput(one.id, { slug: name }),
        );
      }
      // Another periodical has its own namespace and its own numbering.
      await service.saveScholarly(
        librarian,
        'magazine-issue',
        null,
        null,
        issueInput(two.id, { slug: 'winter', volume: 2, issueNumber: 1 }),
      );
    });

    it('never moves an issue to another Magazine', async () => {
      const one = await service.saveScholarly(
        librarian,
        'magazine',
        null,
        null,
        described(),
      );
      const two = await service.saveScholarly(
        librarian,
        'magazine',
        null,
        null,
        described(),
      );
      const issue = await service.saveScholarly(
        librarian,
        'magazine-issue',
        null,
        null,
        issueInput(one.id),
      );
      expect(
        await refusal(
          service.saveScholarly(librarian, 'magazine-issue', issue.id, issue.version, {
            ...editable(issue),
            magazineId: two.id,
          }),
        ),
      ).toBe('invalid');
    });

    it('orders issues deterministically and links neighbours only where unambiguous', async () => {
      const magazine = await service.saveScholarly(
        librarian,
        'magazine',
        null,
        null,
        described(),
      );
      const make = (
        name: string,
        volume: number | null,
        issueNumber: number | null,
        year: number | null,
      ) =>
        service.saveScholarly(
          librarian,
          'magazine-issue',
          null,
          null,
          issueInput(magazine.id, {
            slug: name,
            volume,
            issueNumber,
            publicationYear: year,
          }),
        );
      const v1n1 = await make('v1-n1', 1, 1, 2020);
      const v1n2 = await make('v1-n2', 1, 2, 2020);
      const v2n1 = await make('v2-n1', 2, 1, 2021);
      const loose = await make('unnumbered', null, null, null);

      const page = await reads.magazineIssues(magazine.id);
      // Newest first by year, then by number; the undated issue last.
      expect(page.items.map((row) => row.slug)).toEqual([
        'v2-n1',
        'v1-n2',
        'v1-n1',
        'unnumbered',
      ]);

      const middle = await reads.magazineIssueNeighbours(v1n2.id);
      expect([middle.previous?.id, middle.next?.id]).toEqual([v1n1.id, v2n1.id]);
      expect(await reads.magazineIssueNeighbours(loose.id)).toEqual({
        previous: null,
        next: null,
      });
    });

    it('bounds the issues of one Magazine', async () => {
      const magazine = await service.saveScholarly(
        librarian,
        'magazine',
        null,
        null,
        described(),
      );
      await db.admin.query(`
        INSERT INTO [dbo].[MagazineIssue] ([id],[magazineId],[slug],[primaryLocale],[languageCode],[state],[version],[updatedAt])
        SELECT CONVERT(NVARCHAR(36), NEWID()), N'${magazine.id}', CONCAT(N'bulk-', n), N'en', N'en', N'draft', 1, SYSUTCDATETIME()
        FROM (SELECT TOP (500) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS n FROM sys.all_objects a CROSS JOIN sys.all_objects b) numbers;
      `);
      expect(
        await refusal(
          service.saveScholarly(
            librarian,
            'magazine-issue',
            null,
            null,
            issueInput(magazine.id, { slug: 'one-too-many' }),
          ),
        ),
      ).toBe('limit');
    });
  });

  describe('concurrency, authority and audit', () => {
    it('refuses a stale ResearchPaper save rather than overwriting the newer one', async () => {
      const paper = await service.saveScholarly(
        librarian,
        'research-paper',
        null,
        null,
        paperInput(),
      );
      const newer = await service.saveScholarly(
        librarian,
        'research-paper',
        paper.id,
        paper.version,
        { ...editable(paper), venue: 'Synthetic venue A' },
      );
      expect(
        await refusal(
          service.saveScholarly(librarian, 'research-paper', paper.id, paper.version, {
            ...editable(paper),
            venue: 'Synthetic venue B',
          }),
        ),
      ).toBe('conflict');
      const kept = await service.scholarlyRecord(librarian, 'research-paper', paper.id);
      expect(kept?.version).toBe(newer.version);
      expect(kept?.venue).toBe('Synthetic venue A');
    });

    it('refuses a stale MagazineIssue save, including a stale publish', async () => {
      const magazine = await service.saveScholarly(
        librarian,
        'magazine',
        null,
        null,
        described(),
      );
      const issue = await service.saveScholarly(
        librarian,
        'magazine-issue',
        null,
        null,
        issueInput(magazine.id, { state: 'draft' }),
      );
      await service.saveScholarly(librarian, 'magazine-issue', issue.id, issue.version, {
        ...editable(issue),
        volume: 7,
      });
      expect(
        await refusal(
          service.saveScholarly(librarian, 'magazine-issue', issue.id, issue.version, {
            ...editable(issue),
            state: 'published',
          }),
        ),
      ).toBe('conflict');
      const kept = await service.scholarlyRecord(librarian, 'magazine-issue', issue.id);
      expect([kept?.state, kept?.volume]).toEqual(['draft', 7]);
    });

    it('denies writing without library.administer and reading without library.read', async () => {
      expect(
        await refusal(
          service.saveScholarly(reader, 'research', null, null, researchInput()),
        ),
      ).toBe('denied');
      expect(await refusal(service.scholarlyRecords(outsider, 'research'))).toBe(
        'denied',
      );
      // A contributor credit grants nothing: the credited person's account holds
      // no Library permission.
      expect(
        await refusal(
          service.saveScholarly(
            { accountId: people.accountId },
            'research',
            null,
            null,
            researchInput(),
          ),
        ),
      ).toBe('denied');
    });

    it('audits identifiers, states and counts — never text', async () => {
      const abstract = 'SYNTHETIC-ABSTRACT-MUST-NOT-BE-AUDITED';
      const research = await service.saveScholarly(
        librarian,
        'research',
        null,
        null,
        researchInput({
          abstract,
          citations: [{ text: 'SYNTHETIC-CITATION', url: null, doi: null }],
        }),
      );
      await service.saveScholarly(librarian, 'research', research.id, research.version, {
        ...editable(research),
        state: 'archived',
      });
      const audits = await db.admin.query<{
        action: string;
        beforeState: string | null;
        afterState: string;
        authorisingSource: string;
      }>(
        `SELECT [action],[beforeState],[afterState],[authorisingSource] FROM [dbo].[AuditLog]
         WHERE [targetType]=N'research' AND [targetId]=N'${research.id}' ORDER BY [occurredAt],[id];`,
      );
      expect(audits.map((row) => row.action)).toEqual([
        'library.research.created',
        'library.research.updated',
      ]);
      expect(JSON.parse(audits[1]?.beforeState ?? '{}')).toMatchObject({
        state: 'published',
      });
      expect(JSON.parse(audits[1]?.afterState ?? '{}')).toMatchObject({
        state: 'archived',
        citations: '1',
      });
      const everything = JSON.stringify(audits);
      expect(everything).not.toContain(abstract);
      expect(everything).not.toContain('SYNTHETIC-CITATION');
      expect(audits.every((row) => row.authorisingSource === 'library.administer')).toBe(
        true,
      );
    });
  });

  describe('public listings', () => {
    it('filters by content language, topic and year, in bounded pages', async () => {
      const marker = slug('filter');
      await service.saveScholarly(
        librarian,
        'encyclopedia',
        null,
        null,
        dated({
          publisher: null,
          slug: `${marker}-ur`,
          languageCode: 'ur',
          publicationYear: 1990,
        }),
      );
      await service.saveScholarly(
        librarian,
        'encyclopedia',
        null,
        null,
        dated({
          publisher: null,
          slug: `${marker}-en`,
          publicationYear: 2010,
          topicIds: [],
        }),
      );
      const slugs = async (query: Record<string, unknown>) =>
        (await reads.scholarlyList('encyclopedia', query)).items
          .map((row) => row.slug)
          .filter((value) => value.startsWith(marker));

      expect(await slugs({ language: 'ur' })).toEqual([`${marker}-ur`]);
      expect(await slugs({ topic: topicId })).toEqual([`${marker}-ur`]);
      expect(await slugs({ from: 2000 })).toEqual([`${marker}-en`]);
      expect(await slugs({ from: 1980, to: 1995 })).toEqual([`${marker}-ur`]);
    });

    it('never pages past its bound', async () => {
      const page = await reads.scholarlyList('research', {});
      expect(page.items.length).toBeLessThanOrEqual(25);
      // Refused at the trust boundary, before any query is built.
      expect(() => reads.scholarlyList('research', { offset: 25_001 })).toThrow();
    });
  });
});
