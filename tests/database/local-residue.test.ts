import { describe, expect, it } from 'vitest';

import { newRestoreDatabaseName } from '../../packages/database/src/lifecycle/backup.ts';
import { newDisposableDatabaseName } from '../../packages/database/src/lifecycle/disposable-database.ts';
import {
  cleanUpLocalResidue,
  planLocalResidue,
  residueKindOf,
  residueVerdict,
} from '../../packages/database/src/lifecycle/local-residue.ts';
import type { SqlSession } from '../../packages/database/src/lifecycle/sql-connection.ts';

/**
 * `db:residue:cleanup` — removal of interrupted runs' disposable databases.
 *
 * The classifier is the whole of the blast radius, so it is pinned against the
 * generators' own output and against every near miss worth naming. The drop
 * path is driven through the `SqlSession` seam with a fake server, because the
 * cases that matter — a DROP that "succeeds" and leaves the database, an
 * inspection that does not answer — are ones a live server will not produce to
 * order.
 */

const HEX = '0123456789abcdef0123456789abcdef';
const RESTORE = `MinhajPhase1Restore_${HEX}`;
const TEST = `MinhajPhase1Test_${HEX}`;

describe('residueKindOf — exact generated names only', () => {
  it('accepts what the generators produce', () => {
    for (let index = 0; index < 20; index += 1) {
      expect(residueKindOf(newRestoreDatabaseName())).toBe('restore');
      expect(residueKindOf(newDisposableDatabaseName())).toBe('test');
    }
    expect(residueKindOf(RESTORE)).toBe('restore');
    expect(residueKindOf(TEST)).toBe('test');
  });

  it.each([
    'MinhajPlatform',
    'MinhajStaging',
    `MinhajStagingRestore_${HEX}`,
    'master',
    'model',
    'msdb',
    'tempdb',
    '',
    'MinhajPhase1Restore_',
    'MinhajPhase1Test_',
  ])('refuses the protected or unknown name %j', (name) => {
    expect(residueKindOf(name)).toBeNull();
  });

  it.each([
    // Case variants of the prefix and of the hex.
    `minhajphase1restore_${HEX}`,
    `MINHAJPHASE1TEST_${HEX}`,
    `MinhajPhase1Restore_${HEX.toUpperCase()}`,
    `MinhajPhase1Test_0123456789ABCDEF0123456789abcdef`,
    // Wrong hex length, non-hex, a UUID's dashes.
    `MinhajPhase1Restore_${HEX.slice(1)}`,
    `MinhajPhase1Test_${HEX}0`,
    `MinhajPhase1Test_${HEX.slice(1)}g`,
    'MinhajPhase1Test_01234567-89ab-cdef-0123-456789abcdef',
    // Extra prefix or suffix.
    `x${RESTORE}`,
    `${TEST}x`,
    `${TEST}_copy`,
    `dbo.${TEST}`,
    `[${TEST}]`,
    // Whitespace, including a trailing newline a `$` might forgive.
    ` ${RESTORE}`,
    `${RESTORE} `,
    `${TEST}\n`,
    `${TEST}\t`,
    // SQL metacharacters.
    `${TEST}]; DROP DATABASE [MinhajPlatform`,
    `${RESTORE}'`,
    `${RESTORE};`,
    `${TEST}--`,
    // Other generators' namespaces.
    `MinhajPhase1Restore${HEX}`,
    `MinhajPhase2Test_${HEX}`,
  ])('refuses the near miss %j', (name) => {
    expect(residueKindOf(name)).toBeNull();
  });
});

describe('residueVerdict', () => {
  it('drops only an ONLINE database with no session', () => {
    expect(
      residueVerdict({ name: TEST, kind: 'test', state: 'ONLINE', sessions: 0 }),
    ).toBe('drop');
    expect(
      residueVerdict({ name: TEST, kind: 'test', state: 'ONLINE', sessions: 1 }),
    ).toBe('refused-sessions');
    for (const state of ['RESTORING', 'RECOVERY_PENDING', 'SUSPECT', 'OFFLINE']) {
      expect(residueVerdict({ name: RESTORE, kind: 'restore', state, sessions: 0 })).toBe(
        'refused-state',
      );
    }
  });
});

interface Database {
  name: string;
  state: string;
  sessions: number;
}

interface FakeServerOptions {
  databases: Database[];
  /** Names whose DROP returns without error but leaves the database. */
  dropLeaves?: string[];
  /** `HAS_PERMS_BY_NAME` answer when present (even as `undefined`); else 1. */
  visible?: unknown;
  /** Answers the DB_ID presence probe for a name; overrides the default. */
  presence?: (name: string) => unknown[];
  /** Returns a different session count on the pre-drop re-inspection. */
  sessionsOnRecheck?: Record<string, number>;
  /** The full inventory query throws. */
  inventoryFails?: boolean;
}

interface FakeServer extends SqlSession {
  readonly statements: string[];
  readonly dropped: () => string[];
}

const quoted = (statement: string): string | undefined =>
  /N'([^']*)'/.exec(statement)?.[1];

/** A `master` session over an in-memory server, recording every statement. */
function fakeServer(options: FakeServerOptions): FakeServer {
  const databases = new Map(
    options.databases.map((database) => [database.name, database]),
  );
  const statements: string[] = [];
  const dropped: string[] = [];

  return {
    statements,
    dropped: () => dropped,

    async query<Row>(statement: string): Promise<Row[]> {
      statements.push(statement);

      if (statement.includes('HAS_PERMS_BY_NAME')) {
        return [{ visible: 'visible' in options ? options.visible : 1 }] as Row[];
      }

      if (statement.includes('DROP DATABASE')) {
        const name = quoted(statement) ?? '';
        dropped.push(name);
        if (!(options.dropLeaves ?? []).includes(name)) databases.delete(name);
        return [] as Row[];
      }

      if (statement.includes('DB_ID')) {
        const name = quoted(statement) ?? '';
        if (options.presence !== undefined) return options.presence(name) as Row[];
        return [{ present: databases.has(name) ? 1 : 0 }] as Row[];
      }

      if (statement.includes('sys.databases')) {
        const name = quoted(statement);
        if (name === undefined) {
          if (options.inventoryFails === true) throw new Error('inventory unavailable');
          return [...databases.values()] as Row[];
        }
        const database = databases.get(name);
        if (database === undefined) return [] as Row[];
        const sessions = options.sessionsOnRecheck?.[name] ?? database.sessions;
        return [{ ...database, sessions }] as Row[];
      }

      throw new Error(`unexpected statement: ${statement}`);
    },

    async runScript(): Promise<void> {
      throw new Error('runScript is not part of the residue path');
    },

    async execute(): Promise<void> {
      throw new Error('execute is not part of the residue path');
    },

    async close(): Promise<void> {
      // Nothing to release.
    },
  };
}

const online = (name: string, sessions = 0): Database => ({
  name,
  state: 'ONLINE',
  sessions,
});

const PROTECTED = [
  'master',
  'model',
  'msdb',
  'tempdb',
  'MinhajPlatform',
  'MinhajStaging',
  `MinhajStagingRestore_${HEX}`,
  `${TEST}x`,
];

describe('planLocalResidue', () => {
  it('lists only residue, and touches nothing', async () => {
    const restore = newRestoreDatabaseName();
    const server = fakeServer({
      databases: [
        ...PROTECTED.map((name) => online(name)),
        online(restore),
        online(TEST, 2),
      ],
    });

    const plan = await planLocalResidue(server);

    expect(plan.map((candidate) => candidate.name).sort()).toEqual(
      [restore, TEST].sort(),
    );
    expect(server.dropped()).toEqual([]);
    expect(server.statements.some((statement) => /DROP|ALTER/.test(statement))).toBe(
      false,
    );
  });

  it('fails when sessions of other principals are invisible', async () => {
    for (const visible of [0, null, undefined, '1']) {
      const server = fakeServer({ databases: [online(TEST)], visible });
      await expect(planLocalResidue(server)).rejects.toThrow(/VIEW SERVER STATE/);
      expect(server.dropped()).toEqual([]);
    }
  });

  it('fails on a malformed inventory row rather than reading it as empty', async () => {
    const server = fakeServer({
      databases: [{ name: TEST, state: 'ONLINE', sessions: null as unknown as number }],
    });
    await expect(planLocalResidue(server)).rejects.toThrow(/malformed row/);
  });
});

describe('cleanUpLocalResidue', () => {
  it('drops each kind through its guarded helper and proves absence', async () => {
    const restore = newRestoreDatabaseName();
    const test = newDisposableDatabaseName();
    const server = fakeServer({
      databases: [
        ...PROTECTED.map((name) => online(name)),
        online(restore),
        online(test),
      ],
    });

    const results = await cleanUpLocalResidue(server);

    expect(results).toEqual(
      expect.arrayContaining([
        {
          name: restore,
          kind: 'restore',
          outcome: 'dropped',
          detail: 'absent, DB_ID is NULL',
        },
        { name: test, kind: 'test', outcome: 'dropped', detail: 'absent, DB_ID is NULL' },
      ]),
    );
    expect(results).toHaveLength(2);
    expect(server.dropped().sort()).toEqual([restore, test].sort());
  });

  it('refuses a database with a session, and still drops the others', async () => {
    const busy = newRestoreDatabaseName();
    const idle = newDisposableDatabaseName();
    const server = fakeServer({ databases: [online(busy, 1), online(idle)] });

    const results = await cleanUpLocalResidue(server);

    expect(results.find((result) => result.name === busy)?.outcome).toBe(
      'refused-sessions',
    );
    expect(results.find((result) => result.name === idle)?.outcome).toBe('dropped');
    expect(server.dropped()).toEqual([idle]);
  });

  it('refuses a database that gained a session after the plan', async () => {
    const server = fakeServer({
      databases: [online(TEST)],
      sessionsOnRecheck: { [TEST]: 3 },
    });

    const [result] = await cleanUpLocalResidue(server);

    expect(result?.outcome).toBe('refused-sessions');
    expect(server.dropped()).toEqual([]);
  });

  it('refuses a database that is not ONLINE', async () => {
    const server = fakeServer({
      databases: [{ name: RESTORE, state: 'RESTORING', sessions: 0 }],
    });

    const [result] = await cleanUpLocalResidue(server);

    expect(result).toEqual({
      name: RESTORE,
      kind: 'restore',
      outcome: 'refused-state',
      detail: 'state RESTORING',
    });
    expect(server.dropped()).toEqual([]);
  });

  it.each([
    ['restore', RESTORE],
    ['test', TEST],
  ])(
    'reports a %s database whose DROP succeeded but DB_ID still answers as not-proven-absent',
    async (kind, name) => {
      const server = fakeServer({ databases: [online(name)], dropLeaves: [name] });

      const [result] = await cleanUpLocalResidue(server);

      expect(result?.kind).toBe(kind);
      expect(result?.outcome).toBe('not-proven-absent');
      expect(server.dropped()).toEqual([name]);
    },
  );

  it.each([
    ['no row', []],
    ['a NULL', [{ present: null }]],
    ['a value that is neither 0 nor 1', [{ present: 2 }]],
    ['two rows', [{ present: 0 }, { present: 0 }]],
  ])('treats an absence probe returning %s as a failure', async (_label, rows) => {
    const server = fakeServer({ databases: [online(RESTORE)], presence: () => rows });

    const [result] = await cleanUpLocalResidue(server);

    expect(result?.outcome).toBe('failed');
    expect(result?.detail).toMatch(/absence could not be established/);
  });

  it('fails the whole run when the inventory cannot be read', async () => {
    const server = fakeServer({ databases: [online(TEST)], inventoryFails: true });

    await expect(cleanUpLocalResidue(server)).rejects.toThrow(/inventory unavailable/);
    expect(server.dropped()).toEqual([]);
  });

  it('reports nothing to do on a server holding no residue', async () => {
    const server = fakeServer({ databases: PROTECTED.map((name) => online(name)) });

    expect(await cleanUpLocalResidue(server)).toEqual([]);
    expect(server.dropped()).toEqual([]);
  });
});
