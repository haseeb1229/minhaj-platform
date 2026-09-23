import { randomUUID } from 'node:crypto';

import type { SearchIndexPort } from '../../packages/contracts/src/search/index.ts';
import type { SqlSession } from '../../packages/database/src/lifecycle/sql-connection.ts';
import { createProofAccount } from '../people/harness.ts';

/**
 * The Search foundation, wired to REAL adapters over a disposable database.
 *
 * NOTHING ON THE PERSISTENCE SIDE IS SUBSTITUTED. The owners are the real
 * Taxonomy, People, Editorial and Library adapters and services; the index is
 * the real SQL Server Full-Text adapter; and the owners are wired to the Search
 * service by the SAME `searchWiring` Layer-4 composition uses — so a projection
 * is found because an owner genuinely committed it, through its own mutation,
 * with its own indexing intent in its own transaction.
 *
 * DYNAMIC IMPORTS, for the reason every live harness gives: the database client
 * binds to `DATABASE_URL` at first use, and the shared harness repoints that
 * variable at the disposable database.
 *
 * EVERYTHING IS SYNTHETIC. The Arabic and Urdu fixtures are ordinary prose about
 * libraries and reading rooms — never Quran, Hadith or any religious text — and
 * every title says it is a fixture.
 */

export async function buildSearchHarness(admin: SqlSession) {
  const database = await import('../../packages/database/src/index.ts');
  const { createAuthorizationReader } =
    await import('../../packages/database/src/adapters/identity-access/index.ts');
  const { createAuthorizationService } =
    await import('../../packages/server-core/src/authorization/index.ts');
  const { createEditorialService } =
    await import('../../apps/web/src/contexts/editorial/index.ts');
  const { createLibraryService } =
    await import('../../apps/web/src/contexts/library/index.ts');
  const { searchWiring } =
    await import('../../apps/web/src/composition/search-wiring.ts');
  const { createSearchService } = await import('../../packages/search/src/index.ts');

  const readers = {
    taxonomy: database.createTaxonomyReader(),
    people: database.createPeopleReader(),
    editorial: database.createEditorialPublicReader(),
    library: database.createLibraryPublicReader(),
  };
  const wiring = searchWiring(readers);
  const authorization = createAuthorizationService({
    reader: createAuthorizationReader(),
  });
  const authority = {
    permits: (id: string, key: string) => authorization.hasPermission(id, key),
  };

  const reported: string[] = [];

  const realIndex = database.createSearchIndex();

  /**
   * The index the service uses, with ONE controllable fault: a failure injected
   * into the engine write, AFTER the owner's publication has committed. It is
   * the real adapter in every other respect.
   */
  let failWrites = 0;
  const index: SearchIndexPort = {
    ...realIndex,
    async apply(claim, projection) {
      if (failWrites > 0) {
        failWrites -= 1;
        throw new Error('synthetic injected index write failure');
      }
      return realIndex.apply(claim, projection);
    },
  };

  const search = createSearchService({
    index,
    sources: wiring.sources,
    targets: wiring.targets,
    resolveTopic: wiring.resolveTopic,
    report: (operation) => reported.push(operation),
  });

  const taxonomyStore = database.createTaxonomyPersistence();
  const peopleStore = database.createPeoplePersistence();

  const editorial = createEditorialService({
    persistence: database.createEditorialPersistence(),
    authority,
    reportFailure: (operation) => reported.push(operation),
    references: {
      validTopics: async (ids) =>
        (await readers.taxonomy.topicReferences(ids, 'en')).length === ids.length,
      validContributors: async (ids) =>
        (await readers.people.contributorReferences([...new Set(ids)], 'en')).length ===
        new Set(ids).size,
      validLanguages: async (codes) => {
        const languages = await readers.taxonomy.listLanguages({ includeRetired: false });
        return codes.every((code) =>
          languages.some((language) => language.code === code),
        );
      },
    },
  });

  const library = createLibraryService({
    persistence: database.createLibraryPersistence(),
    authority,
    references: {
      validPeople: async () => true,
      validTopics: async (ids) =>
        ids.length === 0 ||
        (await readers.taxonomy.topicReferences(ids, 'en')).length === ids.length,
      validLanguage: async (code) =>
        (await readers.taxonomy.listLanguages({ includeRetired: false })).some(
          (language) => language.code === code,
        ),
    },
  });

  /** A synthetic account holding exactly `keys`. */
  async function account(keys: readonly string[]): Promise<{ accountId: string }> {
    const id = await createProofAccount(admin);
    const role = randomUUID();
    await admin.query(
      `INSERT INTO [Role] ([id],[key],[name],[description],[system]) VALUES (N'${role}',N'proof-${role}',N'Synthetic search role',N'Test fixture',0); INSERT INTO [RoleAssignment] ([userId],[roleId]) VALUES (N'${id}',N'${role}');`,
    );
    for (const key of keys) {
      await admin.query(
        `INSERT INTO [RolePermission] ([roleId],[permissionKey]) VALUES (N'${role}',N'${key}');`,
      );
    }
    return { accountId: id };
  }

  /**
   * Waits until SQL Server has made every accepted row searchable.
   *
   * NOT A RETRY-TO-GREEN. Full-text population is asynchronous by definition
   * (ARCHITECTURE.md §8.5); this waits on the engine's OWN report that nothing
   * is pending and the catalogue is idle, with a hard ceiling, and fails if the
   * engine never gets there. It never re-runs an assertion.
   */
  async function engineSettled(): Promise<void> {
    const deadline = Date.now() + 60_000;
    for (;;) {
      const [row] = await admin.query<{ pending: number; populate: number }>(
        `SELECT CAST(OBJECTPROPERTYEX(OBJECT_ID(N'[dbo].[SearchDocument]'), 'TableFulltextPendingChanges') AS INT) AS pending,
                CAST(FULLTEXTCATALOGPROPERTY(N'SearchCatalog', 'PopulateStatus') AS INT) AS populate;`,
      );
      if (row !== undefined && Number(row.pending) === 0 && Number(row.populate) === 0)
        return;
      if (Date.now() > deadline) {
        throw new Error('Full-text population did not settle within its ceiling.');
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  /** Drains all due indexing work, then waits for the engine. */
  async function indexNow(): Promise<void> {
    for (let pass = 0; pass < 20; pass += 1) {
      const summary = await search.processDue({ budgetMs: 20_000 });
      const status = await realIndex.status({ failureLimit: 1 });
      if (
        status.pending === 0 ||
        summary.relayed + summary.current + summary.superseded === 0
      ) {
        break;
      }
    }
    await engineSettled();
  }

  return {
    readers,
    wiring,
    search,
    index: realIndex,
    editorial,
    library,
    taxonomyStore,
    peopleStore,
    account,
    indexNow,
    engineSettled,
    reported,
    failNextWrites(count: number) {
      failWrites = count;
    },
  };
}

export type SearchHarness = Awaited<ReturnType<typeof buildSearchHarness>>;
