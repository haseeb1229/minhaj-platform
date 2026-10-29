import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  prohibitedInContextPackages,
  providerSdkPackages,
} from '../../packages/config/eslint/contexts.js';
import {
  repoRoot,
  runTsc,
  validateFixtureWorkspace,
  type ArchitectureViolation,
} from './architecture-harness.ts';

/**
 * PHASE 2 — the boundaries this phase's code first makes reachable.
 *
 * Every rule below is asserted the same way the rest of the analyser suite
 * asserts its rules: with a fixture that COMPILES and is REJECTED. The
 * conjunction is the interesting claim — a fixture with a type error would
 * satisfy "the analyser reported something" while proving nothing about a
 * bypass, which is why `tsc` runs over the tree as well.
 */

const FIXTURE = 'tests/fixtures/phase2-boundaries';

function forFile(
  violations: readonly ArchitectureViolation[],
  filename: string,
): ArchitectureViolation[] {
  return violations.filter((violation) => violation.file.endsWith(filename));
}

describe('Phase 2 — a bounded context may not name a provider SDK', () => {
  it('rejects the mail SDK inside the context that actually sends mail', async () => {
    const violations = await validateFixtureWorkspace(FIXTURE);
    const found = forFile(violations, 'identity-access/provider-import.ts');

    const prohibited = found.find(
      (violation) => violation.rule === 'context-prohibited-package',
    );

    expect(prohibited, 'expected a context-prohibited-package violation').toBeDefined();
    expect(prohibited?.message).toContain("'identity-access' must not import 'resend'");
    expect(prohibited?.message).toContain('EmailProvider abstraction');
  });

  it('rejects it from a context that has nothing to do with Identity', async () => {
    // A rule that bound only the context which happens to send mail today
    // would be no rule at all: the point is that Learning's booking mail and
    // Membership's application mail go through the same abstraction.
    const violations = await validateFixtureWorkspace(FIXTURE);
    const found = forFile(violations, 'learning/provider-import.ts');

    expect(
      found.some((violation) => violation.rule === 'context-prohibited-package'),
    ).toBe(true);
  });

  it('rejects the authentication library inside a context', async () => {
    const violations = await validateFixtureWorkspace(FIXTURE);
    const found = forFile(violations, 'identity-access/library-import.ts');

    const prohibited = found.find(
      (violation) => violation.rule === 'context-prohibited-package',
    );

    expect(prohibited).toBeDefined();
    expect(prohibited?.message).toContain("must not import 'better-auth'");
  });

  it('names every provider SDK in the context prohibition table', () => {
    // The two tables are separate so each reason reads correctly, and this is
    // what keeps them from drifting apart: a provider added to one and
    // forgotten in the other would be prohibited nowhere.
    for (const name of Object.keys(providerSdkPackages)) {
      expect(prohibitedInContextPackages, name).toHaveProperty(name);
    }
  });
});

describe('Phase 2 — a Layer-0 adapter may reach no bounded context', () => {
  it('rejects the shared email concern depending on Identity', async () => {
    const violations = await validateFixtureWorkspace(FIXTURE);
    const found = forFile(violations, 'adapters/email/index.ts');

    const upward = found.find(
      (violation) => violation.rule === 'layer-zero-adapter-context-dependency',
    );

    expect(upward, 'expected a layer-zero-adapter-context-dependency').toBeDefined();
    expect(upward?.message).toContain("Layer 0 'email'");
    expect(upward?.message).toContain("depends on 'identity-access'");
    expect(upward?.message).toContain('DOMAIN_MODEL.md §1.1');
  });

  it('still permits a CONTEXT-owned adapter to reach its own context', async () => {
    // The rules are genuinely different, and this is what proves the Layer-0
    // one is not simply the context one applied twice. `identity-access` owns
    // its adapter and the adapter may call that context's public interface;
    // the Layer-0 concern owns nobody and may call nothing.
    const violations = await validateFixtureWorkspace(FIXTURE);
    const found = forFile(violations, 'adapters/identity-access/index.ts');

    expect(found).toEqual([]);
  });
});

describe('Phase 2 — the service host is not an infrastructure tunnel', () => {
  it('rejects server-core reaching the database package', async () => {
    const violations = await validateFixtureWorkspace(FIXTURE);
    const found = forFile(violations, 'server-core/src/index.ts');

    const tunnel = found.find(
      (violation) => violation.rule === 'service-host-prohibited-workspace',
    );

    expect(tunnel, 'expected a service-host-prohibited-workspace').toBeDefined();
    expect(tunnel?.message).toContain('must not depend on');
    expect(tunnel?.message).toContain('@minhaj/database');
  });
});

describe('Phase 2 — the fixture is rejected for architecture, not for syntax', () => {
  it('compiles cleanly', () => {
    // THE CONJUNCTION. A real build accepts this tree and the analyser refuses
    // it, so every violation above is an architectural finding rather than an
    // incidental type error in a fixture nobody could compile.
    const outcome = runTsc(`${FIXTURE}/apps/app/tsconfig.json`);

    expect(outcome.ok, outcome.output).toBe(true);
  });

  it('reports exactly the five violations it was built to provoke', async () => {
    const violations = await validateFixtureWorkspace(FIXTURE);

    // An exact count, so a fixture that started failing for a NEW reason is
    // noticed rather than absorbed into a `length > 0` assertion.
    expect(violations).toHaveLength(5);
  });
});

/* ===========================================================================
 * The real tree
 * ========================================================================= */

async function walk(directory: string, match: (name: string) => boolean) {
  const found: string[] = [];

  const visit = async (relative: string): Promise<void> => {
    for (const entry of await readdir(path.join(repoRoot, relative), {
      withFileTypes: true,
    })) {
      const child = `${relative}/${entry.name}`;
      if (entry.isDirectory()) await visit(child);
      else if (match(entry.name)) found.push(child);
    }
  };

  await visit(directory);
  return found;
}

async function sourceOf(relative: string): Promise<string> {
  return readFile(path.join(repoRoot, relative), 'utf8');
}

/**
 * The CODE, with comments removed.
 *
 * These files name the prohibited things constantly — in the prose explaining
 * why each one may not cross the boundary, which is the most valuable
 * documentation in the package. Scanning raw text would report every
 * explanation as a violation and, worse, would pressure the next author into
 * deleting the explanations to make the test pass.
 */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
}

describe('Phase 2 — what the delivered code does NOT contain', () => {
  it('exposes no generic transaction, repository or unit-of-work capability', async () => {
    const contracts = await walk('packages/contracts/src', (name) =>
      name.endsWith('.ts'),
    );

    // A generic transaction handle or repository on a public contract is the
    // laundering shape this phase exists without: `T` may be instantiated with
    // a client, a delegate or a transaction, so a surface built on one cannot
    // be SHOWN narrow (ARCHITECTURE.md §6.3 rule 13, §3.1.2).
    for (const file of contracts) {
      const source = code(await sourceOf(file));

      for (const forbidden of [
        'UnitOfWork',
        'GenericRepository',
        'TransactionHandle',
        'PrismaClient',
        '$transaction',
        'DBAdapter',
      ]) {
        expect(source, `${file} must not name ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('keeps every durable communication record TOKEN-FREE', async () => {
    // Better Auth's `Verification` is the SOLE durable home for bearer
    // material. The crash-ordering work added a durable intent and a bounded
    // recipient beside it, and the one thing neither may ever acquire is a
    // copy of the token — a second durable bearer store is the failure this
    // whole shape exists to prevent (ARCHITECTURE.md §4.6.1).
    const intent = code(await sourceOf('packages/contracts/src/identity/ports.ts'));
    const start = intent.indexOf('interface CommunicationIntentInput');
    expect(start).toBeGreaterThan(-1);
    const declaration = intent.slice(start, intent.indexOf('}', start));

    for (const forbidden of ['token', 'otp', 'secret', 'password', 'bearer']) {
      expect(
        declaration.toLowerCase(),
        `CommunicationIntentInput must not carry ${forbidden}`,
      ).not.toContain(forbidden);
    }

    // And the TABLE behind it, which is what would actually hold one.
    const schema = await sourceOf('packages/database/prisma/schema.prisma');
    const model = schema.slice(
      schema.indexOf('model IdentityCommunicationIntent'),
      schema.indexOf('model IdentitySecurityOperation'),
    );
    const columns = model
      .split(String.fromCharCode(10))
      .filter((line) => !line.trim().startsWith('///'))
      .join(' ')
      .toLowerCase();

    for (const forbidden of ['token', 'otp', 'secret', 'password']) {
      expect(
        columns,
        `IdentityCommunicationIntent must have no ${forbidden} column`,
      ).not.toContain(forbidden);
    }

    const operationModel = schema.slice(
      schema.indexOf('model IdentitySecurityOperation'),
      schema.indexOf('model EmailDelivery'),
    );
    const operationColumns = operationModel
      .split(String.fromCharCode(10))
      .filter((line) => !line.trim().startsWith('///'))
      .join(' ')
      .toLowerCase();
    for (const forbidden of [
      'token',
      'otp',
      'secret',
      'password',
      'hash',
      'email',
      'recipient',
    ]) {
      expect(
        operationColumns,
        `IdentitySecurityOperation must have no ${forbidden} column`,
      ).not.toContain(forbidden);
    }
  });

  it('gives provider-safety suppression no second write path', async () => {
    const ports = code(await sourceOf('packages/contracts/src/platform/ports.ts'));
    const start = ports.indexOf('interface EmailSuppressionPort');
    expect(start).toBeGreaterThan(-1);

    // Suppression is written ONCE, atomically with the provider event that
    // caused it. A standalone writer on this port would be a second path into
    // security-relevant state without that atomicity.
    //
    // The slice runs to the interface's OWN closing brace — a brace at the
    // start of a line — not to the first `}` in the text, which is the end of
    // an inline parameter type a few characters in. Slicing to that one would
    // have made this assertion pass over an interface declaring anything at
    // all after the first method.
    const end = ports.indexOf(String.fromCharCode(10) + '}', start);
    expect(end).toBeGreaterThan(start);

    const declaration = ports.slice(start, end);
    expect(declaration).toContain('isSuppressed');
    expect(declaration).not.toContain('suppress(');
  });

  it('introduces no queue, worker platform or event bus', async () => {
    // Durable rows plus bounded scheduled dispatch is the WHOLE mechanism
    // (ARCHITECTURE.md §4.6.1, §8.5). The crash-ordering and webhook work is
    // exactly the kind of change that invites one of these.
    const sources = [
      ...(await walk('packages/contracts/src', (name) => name.endsWith('.ts'))),
      ...(await walk('packages/database/src', (name) => name.endsWith('.ts'))),
      ...(await walk('packages/server-core/src', (name) => name.endsWith('.ts'))),
      ...(await walk('apps/web/src/composition', (name) => name.endsWith('.ts'))),
      ...(await walk('apps/web/src/contexts', (name) => name.endsWith('.ts'))),
    ];

    for (const file of sources) {
      const source = code(await sourceOf(file));

      for (const forbidden of [
        'EventBus',
        'JobQueue',
        'WorkerPool',
        'MessageBroker',
        'ioredis',
        'bullmq',
        'TransactionCoordinator',
      ]) {
        expect(source, `${file} must not name ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('publishes no Better Auth internal from the database package', async () => {
    const entry = code(await sourceOf('packages/database/src/index.ts'));

    // `auth`, `auth.api`, `auth.$context` and the internal adapter are each a
    // generic endpoint or CRUD surface over the auth tables, which is exactly
    // the repository this phase prohibits.
    for (const forbidden of [
      'internalAdapter',
      '$context',
      'auth.api',
      'betterAuth',
      'prismaAdapter',
      'getDatabaseClient',
    ]) {
      expect(entry, `the package entry must not export ${forbidden}`).not.toContain(
        forbidden,
      );
    }
  });

  it('keeps the auth instance private to its own adapter module', async () => {
    const adapter = code(
      await sourceOf('packages/database/src/adapters/identity-access/index.ts'),
    );

    // The instance is a module-local `const`. Exporting it — or a getter for
    // it — would hand out every endpoint the library defines, outside every
    // wrapper that applies rate limiting, audit and status enforcement.
    expect(adapter).toContain('const auth: AuthInstance = createAuthInstance');
    expect(adapter).not.toMatch(/export\s+(const|function)\s+auth\b/);
    expect(adapter).not.toMatch(/return\s+\{[^}]*\bauth\b\s*[,}]/);
  });

  it('contains no Google OAuth anywhere', async () => {
    // Phase 2G's, and absent until it works. A connected-account affordance
    // that does nothing is worse than none: it invites somebody to rely on it.
    const sources = [
      ...(await walk('apps/web/src', (name) => /\.tsx?$/.test(name))),
      ...(await walk('packages/database/src', (name) => name.endsWith('.ts'))),
      ...(await walk('packages/contracts/src', (name) => name.endsWith('.ts'))),
    ];

    for (const file of sources) {
      const source = code(await sourceOf(file));

      for (const forbidden of [
        'socialProviders',
        'GOOGLE_CLIENT_ID',
        'GOOGLE_CLIENT_SECRET',
        'accounts.google.com',
      ]) {
        expect(source, `${file} must not contain ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('seeds no permission vocabulary belonging to a later context', async () => {
    // Phase 2 owns Identity's permissions and nothing else. Seeding
    // `quran.*` or `learning.*` now would fix another context's vocabulary
    // before that context exists to have an opinion about it.
    const migrations = await walk('packages/database/prisma/migrations', (name) =>
      name.endsWith('.sql'),
    );

    expect(migrations.length).toBeGreaterThan(0);

    for (const file of migrations) {
      const source = (await sourceOf(file)).toLowerCase();

      // Quran left this list when Phase 18, its owning phase, seeded its keys,
      // and Hadith when Phase 19 seeded its own. Fatwa's keys may appear in
      // Phase 20's migration, which owns them, and in no other; Learning's in
      // Phase 22's and Phase 23's (its two class keys) alone. Teaching
      // authority is Phase 23's and seeded in its migration alone,
      // Membership's two keys are Phase 26's and seeded in its migration alone,
      // Donations' three keys are Phase 27's and seeded in its migration
      // alone, and Migration & Provenance's three keys are Phase 29's and seeded
      // in its migration alone.
      const fatwaOwner = file.includes('20261004000000_phase20_fatwa');
      const classesOwner = file.includes('20261007000000_phase23_teacher_live_classes');
      const learningOwner =
        file.includes('20261006000000_phase22_learning') || classesOwner;
      const membershipOwner = file.includes('20261009000000_phase26_membership');
      const donationsOwner = file.includes('20261010000000_phase27_donations');
      const migrationOwner = file.includes('20261011000000_phase29_migration_provenance');
      // Phase 30 names `fatwa.ruling` as a CONTENT KIND a migration source may
      // yield — Migration & Provenance's own vocabulary, never a permission
      // key — so that one literal, in that one migration, is set aside before
      // the scan. Any `fatwa.*` permission key it seeded would still fail.
      // Phase 30-R restates the same content-kind CHECKs, so the same literal is
      // set aside there too.
      const sourceAdaptersOwner =
        file.includes('20261027000000_phase30_source_adapters') ||
        file.includes('20261030000000_phase30r_review_completeness');
      const scanned = sourceAdaptersOwner
        ? source.replaceAll("'fatwa.ruling'", '')
        : source;
      for (const domain of [
        ...(fatwaOwner ? [] : ['fatwa.']),
        ...(learningOwner ? [] : ['learning.']),
        ...(classesOwner ? [] : ['teaching.']),
        ...(membershipOwner ? [] : ['membership.']),
        ...(donationsOwner ? [] : ['donations.']),
        ...(migrationOwner ? [] : ['migration.']),
      ]) {
        expect(scanned, `${file} must not seed ${domain}*`).not.toContain(`'${domain}`);
      }
    }
  });

  it('adds no foreign key to AuditLog', async () => {
    const schema = await sourceOf('packages/database/prisma/schema.prisma');

    const auditModel = schema.slice(
      schema.indexOf('model AuditLog'),
      schema.indexOf('}', schema.indexOf('model AuditLog')),
    );

    // Actor and target stay an identifier plus a type STRING. A foreign key
    // would either block a lawful purge or destroy the evidence the record
    // exists to preserve (SECURITY_BASELINE.md §13.3).
    expect(auditModel).not.toContain('@relation');
    expect(auditModel).not.toContain('User');
  });

  it('keeps `next/` out of every package beneath Layer 4', async () => {
    const beneath = [
      ...(await walk('packages/database/src', (name) => name.endsWith('.ts'))),
      ...(await walk('packages/server-core/src', (name) => name.endsWith('.ts'))),
      ...(await walk('packages/contracts/src', (name) => name.endsWith('.ts'))),
    ];

    // An adapter that imported a framework cookie API would be unusable by the
    // realtime process and untestable without a request. Cookies cross the
    // boundary as DATA and Layer 4 writes them.
    for (const file of beneath) {
      const source = code(await sourceOf(file));

      expect(source, `${file} must not import next`).not.toMatch(
        /from\s+['"]next(\/|['"])/,
      );
    }
  });
});
