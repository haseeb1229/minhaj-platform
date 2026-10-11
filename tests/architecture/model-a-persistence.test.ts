import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  persistenceAdapterPolicy,
  rawDatabaseCapabilityReason,
} from '../../packages/config/eslint/contexts.js';
import {
  repoRoot,
  validateFixtureWorkspace,
  type ArchitectureViolation,
} from './architecture-harness.ts';

/**
 * F1 — Model A: encapsulated persistence through context-owned services.
 *
 * ARCHITECTURE.md §3.1.1 turns on one distinction, and the whole of this file
 * exists to prove the source gate makes it rather than approximating it:
 *
 *   "Access to an encapsulated service that internally persists is not
 *    possession of a raw database capability."
 *
 * Two failures are equally serious, and the two fixture trees below are the two
 * halves of the proof:
 *
 *   - `model-a/` is the ARCHITECTURE the documents describe. It must produce
 *     ZERO violations. A gate that rejected it would be enforcing the inverse
 *     of the approved design, and "stricter" is not a defence for a rule that
 *     bans the thing it is meant to protect.
 *
 *   - `raw-capability/` is every way the distinction can be cheated. Each file
 *     asserts its SPECIFIC expected rule, because "a violation occurred" would
 *     also be satisfied by a typo in the fixture.
 */

function forFile(
  violations: readonly ArchitectureViolation[],
  suffix: string,
): ArchitectureViolation[] {
  return violations.filter((violation) => violation.file.endsWith(suffix));
}

function rulesFor(
  violations: readonly ArchitectureViolation[],
  suffix: string,
): string[] {
  return forFile(violations, suffix).map((violation) => violation.rule);
}

const MODEL_A = 'tests/fixtures/model-a';
const RAW = 'tests/fixtures/raw-capability';

describe('F1 positive — the approved persistence architecture passes', () => {
  it('reports nothing at all for the Model A fixture', async () => {
    // The whole tree: a context owning its port, a service that persists
    // through it, an adapter physically inside the database package and
    // semantically owned by the context, Layer 4 wiring the two, a service host
    // exporting the context's service, and a realtime process calling it.
    const violations = await validateFixtureWorkspace(MODEL_A);

    expect(violations).toEqual([]);
  });

  it('accepts Layer 4 wiring a context service to its context-owned adapter', async () => {
    const violations = await validateFixtureWorkspace(MODEL_A);

    expect(forFile(violations, 'app/compose.ts')).toEqual([]);
  });

  it('accepts a server-core-hosted service reaching its context public interface', async () => {
    const violations = await validateFixtureWorkspace(MODEL_A);

    expect(forFile(violations, 'server-core/src/index.ts')).toEqual([]);
  });

  it('accepts realtime calling the hosted service without holding the database', async () => {
    // The case the previous gate could not express. `apps/realtime` reaches a
    // service whose implementation persists — and the rule must not reject it
    // "merely because database infrastructure exists farther downstream".
    const violations = await validateFixtureWorkspace(MODEL_A);

    expect(forFile(violations, 'realtime/src/gateway.ts')).toEqual([]);
  });

  it('accepts an adapter depending on the context that OWNS it', async () => {
    // Without declared ownership this is `layer-zero-upward-dependency`: a
    // platform package depending upward on a bounded context. Ownership is what
    // makes it what it actually is — a context's own persistence, implemented
    // somewhere else (ARCHITECTURE.md §6.3 rule 14).
    const violations = await validateFixtureWorkspace(MODEL_A);

    expect(forFile(violations, 'adapters/messaging/index.ts')).toEqual([]);
    expect(forFile(violations, 'adapters/messaging/message-store.ts')).toEqual([]);
  });

  it('lets the database package publish an adapter without depending upward', async () => {
    const violations = await validateFixtureWorkspace(MODEL_A);

    expect(rulesFor(violations, 'model-a/packages/database/src/index.ts')).not.toContain(
      'layer-zero-upward-dependency',
    );
  });
});

describe('F1 — a bounded context never acquires database capability', () => {
  it('rejects a context importing the database package', async () => {
    const violations = await validateFixtureWorkspace(RAW);

    expect(rulesFor(violations, 'messaging/direct-database.ts')).toContain(
      'context-prohibited-package',
    );
  });

  it('rejects a context importing Prisma', async () => {
    const violations = await validateFixtureWorkspace(RAW);

    expect(rulesFor(violations, 'messaging/direct-prisma.ts')).toContain(
      'context-prohibited-package',
    );
  });

  it('rejects a context importing the MSSQL driver', async () => {
    const violations = await validateFixtureWorkspace(RAW);

    expect(rulesFor(violations, 'messaging/direct-mssql.ts')).toContain(
      'context-concrete-infrastructure',
    );
  });

  it("rejects a non-owner obtaining another context's adapter entry", async () => {
    const violations = await validateFixtureWorkspace(RAW);

    expect(rulesFor(violations, 'quran/steals-messaging-adapter.ts')).toContain(
      'context-prohibited-package',
    );
  });

  it('rejects an adapter laundered to a context through a neutral wrapper', async () => {
    const violations = await validateFixtureWorkspace(RAW);

    expect(rulesFor(violations, 'messaging/via-adapter-wrapper.ts')).toContain(
      'context-laundered-workspace',
    );
  });
});

describe('F1 — Layer 4 never HOLDS raw database capability', () => {
  it('rejects a neutral wrapper that re-exports the private client', async () => {
    const violations = await validateFixtureWorkspace(RAW);
    const found = forFile(violations, 'shared/raw-wrapper.ts').find(
      (violation) => violation.rule === 'composition-raw-database-capability',
    );

    expect(found, 'a wrapper is not a boundary').toBeDefined();
    expect(found?.message).toContain('@prisma/client');
  });

  it('rejects composition reaching that wrapper', async () => {
    const violations = await validateFixtureWorkspace(RAW);

    expect(rulesFor(violations, 'app/via-wrapper.ts')).toContain(
      'composition-raw-database-capability',
    );
  });

  it('rejects re-exported raw capability, and reaching it through a barrel', async () => {
    const violations = await validateFixtureWorkspace(RAW);

    expect(rulesFor(violations, 'shared/reexports-prisma.ts')).toContain(
      'composition-raw-database-capability',
    );
    expect(rulesFor(violations, 'app/via-reexport.ts')).toContain(
      'composition-raw-database-capability',
    );
  });

  it('rejects reaching PAST an adapter entry into its internals', async () => {
    // The encapsulation boundary is the adapter's public entry, not its
    // directory. Reaching into the internals reaches past the encapsulation.
    const violations = await validateFixtureWorkspace(RAW);

    expect(rulesFor(violations, 'app/past-the-adapter.ts')).toContain(
      'composition-raw-database-capability',
    );
  });

  it('PERMITS composition wiring the same adapter through its narrow entry', async () => {
    // The control that keeps the rule honest, in the middle of the tree full of
    // violations. Prisma is two hops beyond this import and the file holds none
    // of it.
    const violations = await validateFixtureWorkspace(RAW);

    expect(forFile(violations, 'app/wires-adapter.ts')).toEqual([]);
  });
});

describe('F1 — apps/realtime never acquires raw database capability', () => {
  it('rejects importing a persistence adapter directly, by RELATIVE path', async () => {
    // No prohibited package NAME appears in the specifier. Classification is by
    // resolved workspace, so the spelling changes nothing — and the direct
    // relative form was previously reported by neither the direct check (wrong
    // name) nor the transitive one (which skips direct reaches).
    const violations = await validateFixtureWorkspace(RAW);
    const found = forFile(violations, 'realtime/src/direct-adapter.ts');

    expect(found.map((violation) => violation.rule)).toContain(
      'realtime-database-access',
    );
  });

  it('rejects receiving the raw client through a wrapper package', async () => {
    const violations = await validateFixtureWorkspace(RAW);
    const rules = rulesFor(violations, 'realtime/src/via-raw-wrapper.ts');

    expect(rules).toContain('realtime-laundered-database-access');
    expect(rules).toContain('realtime-raw-database-capability');
  });

  it('rejects the MSSQL driver, which the package deny list does not name', async () => {
    // `realtimeProhibitedPackages` names the database package, `@prisma/client`
    // and `prisma`. The driver beneath Prisma is the same capability one layer
    // down, and ARCHITECTURE.md §3.1.2 lists "an MSSQL driver" separately for
    // exactly this reason.
    const violations = await validateFixtureWorkspace(RAW);

    expect(rulesFor(violations, 'realtime/src/direct-mssql.ts')).toContain(
      'realtime-raw-database-capability',
    );
  });

  it('rejects an adapter reached through a neutral wrapper before the boundary stop', async () => {
    const violations = await validateFixtureWorkspace(RAW);

    expect(rulesFor(violations, 'realtime/src/via-adapter-wrapper.ts')).toContain(
      'realtime-laundered-database-access',
    );
  });
});

describe('F1 — an adapter boundary must be shown to be narrow', () => {
  it('rejects an adapter entry re-exporting the raw client', async () => {
    const violations = await validateFixtureWorkspace(RAW);
    const found = forFile(violations, 'adapters/leaky/index.ts').find(
      (violation) => violation.rule === 'persistence-adapter-exposes-raw-capability',
    );

    expect(found, 'being declared an adapter is not what makes a boundary').toBeDefined();
  });

  it('rejects a wrapper that merely renames the capability, by failing closed', async () => {
    // `export function repository() { return getDatabaseClient(); }` — the
    // return type is inferred, so no syntactic analysis can see what it hands
    // back. An encapsulation boundary states its contract or it is not one.
    const violations = await validateFixtureWorkspace(RAW);

    expect(rulesFor(violations, 'adapters/renamed/index.ts')).toContain(
      'persistence-adapter-unverifiable-surface',
    );
  });

  it('rejects an adapter whose declared return type IS the client', async () => {
    const violations = await validateFixtureWorkspace(RAW);

    expect(rulesFor(violations, 'adapters/typed/index.ts')).toContain(
      'persistence-adapter-exposes-raw-capability',
    );
  });

  it.each([
    ['unknown', 'adapters/broad-unknown/index.ts'],
    ['any', 'adapters/broad-any/index.ts'],
    ['an unconcretised generic', 'adapters/broad-generic/index.ts'],
    ['a nested broadly typed field', 'adapters/broad-object/index.ts'],
    ['a local erasing alias', 'adapters/broad-alias/index.ts'],
    ['an imported erasing alias', 'adapters/imported-alias/index.ts'],
  ])('rejects a raw client hidden behind %s', async (_description, fixture) => {
    const violations = await validateFixtureWorkspace(RAW);

    expect(rulesFor(violations, fixture)).toContain(
      'persistence-adapter-unverifiable-surface',
    );
  });

  it.each([
    ['a star export', 'adapters/star/index.ts'],
    ['a namespace export', 'adapters/namespace/index.ts'],
    ['a renamed export', 'adapters/renamed-export/index.ts'],
    ['a nested re-export', 'adapters/nested-reexport/index.ts'],
  ])('rejects raw capability exposed through %s', async (_description, fixture) => {
    const violations = await validateFixtureWorkspace(RAW);

    expect(rulesFor(violations, fixture)).toContain(
      'persistence-adapter-exposes-raw-capability',
    );
  });

  it('rejects a raw client returned under an apparently narrow structural type', async () => {
    const violations = await validateFixtureWorkspace(RAW);

    expect(rulesFor(violations, 'adapters/narrow-launder/index.ts')).toContain(
      'persistence-adapter-exposes-raw-capability',
    );
  });
});

describe('F1 — adapter ownership is explicit and fails closed', () => {
  it("rejects one context's adapter reading another context's adapter", async () => {
    const violations = await validateFixtureWorkspace(RAW);
    const found = forFile(violations, 'adapters/borrower/index.ts').find(
      (violation) => violation.rule === 'persistence-adapter-cross-adapter-dependency',
    );

    expect(found).toBeDefined();
    expect(found?.message).toContain('shortcut');
  });

  it('rejects an adapter reaching a context that does not own it', async () => {
    const violations = await validateFixtureWorkspace(RAW);

    expect(rulesFor(violations, 'adapters/trespasser/index.ts')).toContain(
      'persistence-adapter-cross-context-dependency',
    );
  });

  it('rejects source under the adapter root that no declaration owns', async () => {
    const violations = await validateFixtureWorkspace(RAW);
    const found = forFile(violations, 'adapters/orphan/index.ts').find(
      (violation) => violation.rule === 'undeclared-persistence-adapter',
    );

    expect(found, 'an adapter nobody owns must not pass silently').toBeDefined();
  });

  it('rejects a declared owner that is not one of the 16 bounded contexts', async () => {
    const violations = await validateFixtureWorkspace(RAW);

    expect(rulesFor(violations, 'adapters/unowned/index.ts')).toContain(
      'persistence-adapter-unknown-owner',
    );
  });

  it('reads ownership from the manifest and rejects a malformed declaration', () => {
    expect(persistenceAdapterPolicy({})).toBeNull();
    expect(
      persistenceAdapterPolicy({ minhaj: { persistenceAdapters: {} } })?.malformed,
    ).toBeTruthy();

    // A bounded-context slug normalises to an explicit kind, so a Layer-0
    // owner and a context owner are distinguishable downstream rather than
    // both being bare strings the caller has to guess about.
    expect(
      persistenceAdapterPolicy({
        minhaj: { persistenceAdapters: { root: 'src/adapters', owners: { a: 'quran' } } },
      }),
    ).toMatchObject({
      root: 'src/adapters',
      owners: { a: { kind: 'context', slug: 'quran' } },
      malformed: null,
    });
  });

  it('accepts a Layer-0 concern as an owner, and only an enumerated one', () => {
    // Infrastructure owns persistent state — delivery metadata, rate-limit
    // windows, audit rows — and DOMAIN_MODEL.md §1.1 is explicit that it is
    // NOT a bounded context. Without this the state could not be declared at
    // all, and it would have to be filed under whichever context needed it
    // first (ARCHITECTURE.md §4.6.1).
    expect(
      persistenceAdapterPolicy({
        minhaj: {
          persistenceAdapters: {
            root: 'src/adapters',
            owners: { email: { kind: 'layer0', concern: 'email' } },
          },
        },
      })?.owners,
    ).toMatchObject({ email: { kind: 'layer0', concern: 'email' } });

    // `database` is where adapters live and cannot own one within itself, and
    // `logging` owns no relational state. An owner outside the enumerated set
    // is unowned.
    //
    // `storage` LEFT this list in Phase 7, when the storage foundation gained
    // the Asset table, and `search` left it in Phase 17, when the search
    // foundation gained its derived projection and durable indexing intent.
    // Both are enumerated in `layerZeroPersistentConcerns`. The others stay: a
    // concern joins that set when a phase gives it state, never in advance.
    for (const concern of ['database', 'logging', 'invented']) {
      expect(
        persistenceAdapterPolicy({
          minhaj: {
            persistenceAdapters: {
              root: 'src/adapters',
              owners: { x: { kind: 'layer0', concern } },
            },
          },
        })?.owners['x'],
      ).toBeNull();
    }

    // And a shape this policy does not recognise is never guessed at.
    for (const declared of [{ kind: 'context', slug: 'quran' }, 42, [], null, {}]) {
      expect(
        persistenceAdapterPolicy({
          minhaj: {
            persistenceAdapters: { root: 'src/adapters', owners: { x: declared } },
          },
        })?.owners['x'],
      ).toBeNull();
    }
  });

  it('keeps ONE unreadable owner from disabling every other adapter', () => {
    // A single bad entry must not be treated as a malformed DECLARATION.
    // Malformed disables every adapter in the workspace, and an adapter that
    // stops being a recognised boundary stops stopping the capability walk —
    // so one typo would leak raw capability through every OTHER adapter in
    // the package.
    const policy = persistenceAdapterPolicy({
      minhaj: {
        persistenceAdapters: {
          root: 'src/adapters',
          owners: { good: 'quran', bad: 'not-a-bounded-context' },
        },
      },
    });

    expect(policy?.malformed).toBeNull();
    expect(policy?.owners['good']).toMatchObject({ kind: 'context', slug: 'quran' });
    expect(policy?.owners['bad']).toBeNull();
  });
});

describe('F1 — a package public API never hands out raw capability', () => {
  it('rejects a database package whose entry point re-exports the client', async () => {
    // The exact defect corrected in production `packages/database`: raw client
    // construction stayed inside the package, and the constructed client left
    // through the front door.
    const violations = await validateFixtureWorkspace(RAW);
    const found = forFile(violations, 'raw-capability/packages/database/src/index.ts');

    expect(found.map((violation) => violation.rule)).toContain(
      'public-surface-raw-database-capability',
    );
  });

  it('rejects a neutral shared package exposing the same thing', async () => {
    const violations = await validateFixtureWorkspace(RAW);

    expect(rulesFor(violations, 'wrapper/src/index.ts')).toContain(
      'public-surface-raw-database-capability',
    );
  });

  it('rejects a Layer 0 package every context consumes importing Prisma', async () => {
    const violations = await validateFixtureWorkspace(RAW);

    expect(
      rulesFor(violations, 'raw-capability/packages/contracts/src/index.ts'),
    ).toContain('layer-zero-raw-database-capability');
  });

  it('rejects the service host holding capability, or bypassing a context front door', async () => {
    const violations = await validateFixtureWorkspace(RAW);

    expect(
      rulesFor(violations, 'raw-capability/packages/server-core/src/index.ts'),
    ).toContain('service-host-raw-database-capability');
    expect(rulesFor(violations, 'server-core/src/reaches-internals.ts')).toContain(
      'service-host-context-internal-import',
    );
  });

  it('rejects server-core obtaining an adapter directly or through a neutral wrapper', async () => {
    const violations = await validateFixtureWorkspace(RAW);

    expect(rulesFor(violations, 'server-core/src/direct-adapter.ts')).toContain(
      'service-host-prohibited-workspace',
    );
    expect(rulesFor(violations, 'server-core/src/via-adapter-wrapper.ts')).toContain(
      'service-host-prohibited-workspace',
    );
  });
});

describe('F1 — the production database package publishes no raw capability', () => {
  it('exports no client, delegate, transaction handle or raw-query facility', async () => {
    // Read as TEXT rather than imported, because the assertion is about the
    // package's PUBLIC SURFACE — what a consumer can name — not about what a
    // module happens to evaluate to under the test runner's conditions.
    const source = await readFile(
      path.join(repoRoot, 'packages', 'database', 'src', 'index.ts'),
      'utf8',
    );

    for (const forbidden of ['getDatabaseClient', 'DatabaseClient', 'PrismaClient']) {
      expect(
        source
          .split('\n')
          .filter((line) => !line.trim().startsWith('*'))
          .join('\n'),
        `'${forbidden}' must not be part of the public runtime surface`,
      ).not.toContain(`export { ${forbidden}`);
    }

    expect(source).toContain("import 'server-only'");
  });

  it('still constructs the client privately, for adapters and admin tooling', async () => {
    // Narrowing the public API must not have deleted the capability. Phase 1
    // migration, provisioning, backup, restore and recovery tooling reaches it
    // by package-INTERNAL relative import, which §4.1 classifies separately
    // from runtime persistence adapters.
    const client = await readFile(
      path.join(repoRoot, 'packages', 'database', 'src', 'client.ts'),
      'utf8',
    );

    expect(client).toContain('export function getDatabaseClient');

    const connection = await readFile(
      path.join(repoRoot, 'packages', 'database', 'src', 'test-connection.ts'),
      'utf8',
    );

    expect(connection).toContain("from './client.ts'");
  });

  it('declares every adapter it hosts, and each with a readable owner', async () => {
    const manifest = JSON.parse(
      await readFile(path.join(repoRoot, 'packages', 'database', 'package.json'), 'utf8'),
    ) as Record<string, unknown>;

    const policy = persistenceAdapterPolicy(manifest);

    expect(policy?.root).toBe('src/adapters');
    expect(policy?.malformed).toBeNull();

    // Phase 2 Chunk 1 brought the first adapters, Phase 3B added Taxonomy's and
    // Phase 5 added People & Contributors'. Identity & Access, Taxonomy and
    // People & Contributors are bounded CONTEXTS; email, rate limiting and
    // auditing are Layer-0 platform CONCERNS, which own persistent state without
    // being contexts (DOMAIN_MODEL.md §1.1, ARCHITECTURE.md §4.6.1).
    //
    // EXACT, not a superset. A new adapter directory appearing here without a
    // declaration is the state the manifest exists to make impossible, and an
    // assertion that merely checked the known entries were present would not
    // notice one.
    expect(policy?.owners).toEqual({
      'identity-access': { kind: 'context', slug: 'identity-access' },
      'people-contributors': { kind: 'context', slug: 'people-contributors' },
      taxonomy: { kind: 'context', slug: 'taxonomy' },
      editorial: { kind: 'context', slug: 'editorial' },
      // Phase 8. Library is a bounded CONTEXT, and its adapter is physically
      // hosted here without that transferring any ownership (ARCHITECTURE.md §4.1).
      library: { kind: 'context', slug: 'library' },
      // Phase 10. Media is a bounded CONTEXT (#8); its adapter is hosted here
      // and owned there.
      media: { kind: 'context', slug: 'media' },
      // Phase 16. Global Network is a bounded CONTEXT (#13); its adapter is
      // hosted here and owned there.
      'global-network': { kind: 'context', slug: 'global-network' },
      // Phase 18. Quran is a bounded CONTEXT (#5); its adapter is hosted here
      // and owned there, and holds no write to canonical text but the two
      // authority-checking procedures.
      quran: { kind: 'context', slug: 'quran' },
      email: { kind: 'layer0', concern: 'email' },
      'rate-limiting': { kind: 'layer0', concern: 'rate-limiting' },
      auditing: { kind: 'layer0', concern: 'auditing' },
      storage: { kind: 'layer0', concern: 'storage' },
      // Phase 17. Search's DERIVED projection and indexing intent: Layer-0
      // state, not a bounded context and not any owner's business data.
      search: { kind: 'layer0', concern: 'search' },
    });

    // Every declared owner is readable. An entry normalising to `null` would
    // be an adapter nobody owns, which is the state the declaration exists to
    // make impossible.
    for (const [directory, owner] of Object.entries(policy?.owners ?? {})) {
      expect(owner, `${directory} has a readable owner`).not.toBeNull();
    }
  });
});

describe('F1 — the capability list names what the documents name', () => {
  it('covers Prisma, its driver adapter and the MSSQL driver stack', () => {
    for (const name of [
      '@prisma/client',
      '@prisma/adapter-mssql',
      '@prisma/anything-new',
      'prisma',
      'mssql',
      'tedious',
    ]) {
      expect(
        rawDatabaseCapabilityReason(name),
        `${name} is raw capability`,
      ).not.toBeNull();
    }
  });

  it('does not sweep in ordinary packages', () => {
    for (const name of ['zod', 'pino', '@minhaj/contracts', 'next', 'react']) {
      expect(rawDatabaseCapabilityReason(name)).toBeNull();
    }
  });

  it('leaves the database PACKAGE off the capability list deliberately', () => {
    // `@minhaj/database` is where capability is constructed and confined. The
    // capability itself is the Prisma/MSSQL surface below it, and it is that
    // surface — not the package name — that must not escape. Naming the package
    // here would ban the adapters the architecture requires.
    expect(rawDatabaseCapabilityReason('@minhaj/database')).toBeNull();
  });
});
