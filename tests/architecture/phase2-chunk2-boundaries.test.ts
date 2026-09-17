import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { repoRoot } from './architecture-harness.ts';

/**
 * PHASE 2 CHUNK 2 — the boundaries authorisation first makes reachable.
 *
 * The analyser suite proves the IMPORT graph. These prove the properties an
 * import graph cannot see: that a privileged Server Action cannot act without
 * passing the gate, that the bootstrap has no web path, that the protected role
 * is defended at more than one layer, and that no generic capability was
 * introduced to make any of it convenient.
 *
 * Every assertion below reads DELIVERED source. A fixture would prove the rule
 * can be stated; reading the real tree proves it currently holds.
 */

async function walk(
  directory: string,
  match: (name: string) => boolean,
): Promise<string[]> {
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
 * documentation here. Scanning raw text would report every explanation as a
 * violation and, worse, would pressure the next author into deleting the
 * explanations to make the test pass.
 */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
}

/** Every exported Server Action in one `'use server'` module. */
function serverActions(source: string): { name: string; body: string }[] {
  const actions: { name: string; body: string }[] = [];
  const pattern = /export async function (\w+)\s*\(/g;

  let match = pattern.exec(source);
  while (match !== null) {
    const name = match[1] ?? '';
    const start = source.indexOf('{', match.index + match[0].length - 1);

    // Balanced-brace scan. A regex to the next `export` would swallow a nested
    // function and miss the one after it.
    let depth = 0;
    let end = start;
    for (; end < source.length; end += 1) {
      if (source[end] === '{') depth += 1;
      else if (source[end] === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
    }

    actions.push({ name, body: source.slice(start, end + 1) });
    match = pattern.exec(source);
  }

  return actions;
}

describe('Phase 2 Chunk 2 — no privileged action bypasses the gate', () => {
  it('routes every administrative mutation through an authorisation gate', async () => {
    // SECURITY_BASELINE.md §3.4 rule 2: "every protected mutation involving an
    // authenticated principal re-checks authorisation independently". A Server
    // Action that skipped this would be a hole a reader could not see, because
    // the page around it looks protected.
    const source = code(await sourceOf('apps/web/src/app/[locale]/admin/actions.ts'));
    const actions = serverActions(source);

    expect(actions.length).toBeGreaterThan(5);

    for (const action of actions) {
      // `grantStepUpAction` is the one self-service action here: proving who
      // you are needs a session and credentials, never a permission, and it
      // produces no `PrivilegedActor`.
      const gate =
        action.name === 'grantStepUpAction'
          ? 'requireOwnSession'
          : /requirePrivilegedActor|requirePermittedAction/;

      expect(action.body, `${action.name} must pass an authorisation gate`).toMatch(gate);

      // And it must ACT on the refusal rather than merely computing it.
      expect(action.body, `${action.name} must refuse on a denial`).toMatch(
        /state === 'denied'|=== null/,
      );
    }
  });

  it('mints and re-verifies PrivilegedActor values at runtime in one place', async () => {
    // The shape makes correct use ergonomic, but TypeScript values are
    // forgeable at runtime. One service therefore both mints exact object
    // instances and re-verifies their live permission, posture and grant at
    // the sensitive application-service boundary.
    const sources = [
      ...(await walk('apps/web/src', (name) => /\.tsx?$/.test(name))),
      ...(await walk('packages/database/src', (name) => name.endsWith('.ts'))),
    ];

    const producers = [];
    for (const file of sources) {
      if (code(await sourceOf(file)).includes(`authorisation: 'verified'`)) {
        producers.push(file);
      }
    }

    expect(producers).toEqual([]);

    const host = code(await sourceOf('packages/server-core/src/authorization/index.ts'));
    expect(host).toContain('new WeakSet<object>()');
    expect(host).toContain('Object.freeze');
    expect(host).toContain('issuedActors.add(actor)');
    expect(host).toContain('issuedActors.has(actor)');
    expect(host).toContain('reader.effectivePermissions(actor.accountId)');
    expect(host).toContain('reader.privilegedPosture(actor.accountId)');
    expect(host).toContain('reader.findStepUpGrant');
    expect(host).toContain(`authorisation: 'verified'`);

    const administration = code(
      await sourceOf(
        'apps/web/src/contexts/identity-access/application/authorization-service.ts',
      ),
    );
    expect(administration).toContain('verifyActor({');
    expect(administration).toContain('actorIsCurrent');
    expect(administration).toContain('roles.administer');
    expect(administration).toContain('permissions.grant');
    expect(administration).toContain('privilege-administration');
  });

  it('never decides authorisation in a Client Component', async () => {
    // Client-side checks are presentation only (§3.4 rule 1). A `'use client'`
    // module that imported the authorisation service would be a decision made
    // where the person can change the answer.
    const files = await walk('apps/web/src', (name) => /\.tsx?$/.test(name));

    for (const file of files) {
      const source = await sourceOf(file);
      if (!/^['"]use client['"]/m.test(source)) continue;

      for (const forbidden of [
        '@minhaj/server-core/authorization',
        '@minhaj/database',
        '@/composition/authorization',
        '@/composition/identity',
      ]) {
        expect(code(source), `${file} must not import ${forbidden}`).not.toContain(
          forbidden,
        );
      }
    }
  });
});

describe('Phase 2 Chunk 2 — the bootstrap has no web path', () => {
  it('names the operator procedures nowhere in the application', async () => {
    // The database DENIES the runtime principal EXECUTE on both, so an action
    // that tried would be refused anyway. This is the other half: there is no
    // code that tries, which is what stops the refusal being discovered by an
    // operator reading a stack trace (SECURITY_BASELINE.md §8.3).
    // The RUNTIME surface only. `packages/database/src/lifecycle/` is
    // administrative tooling, "classified separately from runtime persistence
    // adapters" (ARCHITECTURE.md §4.1) — it is where the operator commands
    // legitimately name what they execute, and it is published nowhere.
    const application = [
      ...(await walk('apps/web/src', (name) => /\.tsx?$/.test(name))),
      ...(await walk('packages/server-core/src', (name) => name.endsWith('.ts'))),
      ...(await walk('packages/contracts/src', (name) => name.endsWith('.ts'))),
      ...(await walk('packages/database/src/adapters', (name) => name.endsWith('.ts'))),
    ];

    for (const file of application) {
      const source = code(await sourceOf(file));

      for (const procedure of [
        'IdentityBootstrapPlatformAdministrator',
        'IdentityRecoverPrivilegedSecondFactor',
      ]) {
        expect(source, `${file} must not name ${procedure}`).not.toContain(procedure);
      }
    }
  });

  it('keeps the operator commands out of the runtime surface', async () => {
    // They live under `packages/database/scripts/`, which the package publishes
    // nothing from: administrative tooling is classified separately from
    // runtime persistence adapters (ARCHITECTURE.md §4.1).
    const entry = code(await sourceOf('packages/database/src/index.ts'));

    expect(entry).not.toContain('scripts/');
    expect(entry).not.toContain('operator');
    expect(entry).not.toContain('bootstrap');
  });

  it('exposes bootstrap state as a READ and nothing else', async () => {
    const port = code(await sourceOf('packages/contracts/src/identity/authorization.ts'));

    expect(port).toContain('readBootstrapStatus');
    for (const forbidden of [
      'performBootstrap',
      'createBootstrap',
      'runBootstrap',
      'recoverSecondFactor',
      'resetSecondFactorFor',
    ]) {
      expect(port, `the port must not offer ${forbidden}`).not.toContain(forbidden);
    }
  });
});

describe('Phase 2 Chunk 2 — the protected role is defended more than once', () => {
  it('refuses protected-role mutation in the persistence adapter', async () => {
    // The adapter is the only writer, and an invariant enforced only by its
    // caller is an invariant one new caller removes.
    const adapter = code(
      await sourceOf('packages/database/src/adapters/identity-access/authorization.ts'),
    );

    // Each of the three mutating role operations checks it.
    const protectedChecks = adapter.match(/role-protected/g) ?? [];
    expect(protectedChecks.length).toBeGreaterThanOrEqual(3);

    // `system` is never settable from an INPUT. The only creation passes the
    // literal `false`, and no update writes the column at all — so there is no
    // runtime path by which an ordinary role becomes a protected one.
    const creation = adapter.slice(adapter.indexOf('tx.role.create'));
    expect(creation.slice(0, 400)).toContain('system: false');

    for (const update of adapter.split('tx.role.update').slice(1)) {
      expect(update.slice(0, 300), 'no update writes `system`').not.toContain('system:');
    }
  });

  it('refuses it again in the context service', async () => {
    const service = code(
      await sourceOf(
        'apps/web/src/contexts/identity-access/application/authorization-service.ts',
      ),
    );

    expect(service).toContain('isProtectedRoleKey');
  });

  it('gives the runtime principal no DELETE on privilege history', async () => {
    const grants = await sourceOf(
      'packages/database/sql/permissions/grant-application-principal.sql',
    );

    // History is retained: a revoked assignment is marked, never removed, and
    // the database refuses the alternative (SECURITY_BASELINE.md §13.3).
    expect(grants).toMatch(/DENY DELETE, ALTER ON OBJECT::\[dbo\]\.\[RoleAssignment\]/);
    expect(grants).toMatch(/DENY DELETE, ALTER ON OBJECT::\[dbo\]\.\[Role\]/);

    // The catalogue is immutable at runtime.
    expect(grants).toMatch(
      /DENY INSERT, UPDATE, DELETE, ALTER ON OBJECT::\[dbo\]\.\[Permission\]/,
    );

    // And the runtime may not execute either operator procedure.
    expect(grants).toContain(
      'DENY EXECUTE ON OBJECT::[dbo].[IdentityBootstrapPlatformAdministrator]',
    );
    expect(grants).toContain(
      'DENY EXECUTE ON OBJECT::[dbo].[IdentityRecoverPrivilegedSecondFactor]',
    );
  });
});

describe('Phase 2 Chunk 2 — what the delivered code does NOT contain', () => {
  it('adds no generic transaction, repository or unit-of-work capability', async () => {
    const sources = [
      ...(await walk('packages/contracts/src', (name) => name.endsWith('.ts'))),
      ...(await walk('packages/server-core/src', (name) => name.endsWith('.ts'))),
      ...(await walk('apps/web/src/contexts', (name) => name.endsWith('.ts'))),
    ];

    for (const file of sources) {
      const source = code(await sourceOf(file));

      for (const forbidden of [
        'UnitOfWork',
        'GenericRepository',
        'TransactionHandle',
        'PrismaClient',
        '$transaction',
        'DBAdapter',
        'EventBus',
        'JobQueue',
        'WorkerPool',
        'ioredis',
      ]) {
        expect(source, `${file} must not name ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('gives RoleAssignment no polymorphic scope', async () => {
    // DOMAIN_MODEL.md §4.4 permits a FUTURE scope; §6.2 prohibits the
    // polymorphic shape. Neither Centre nor Course exists, so the correct
    // amount of scope to model now is none — a `scopeType + scopeId` added in
    // anticipation is exactly the prohibited reference (CLAUDE.md §11).
    const schema = await sourceOf('packages/database/prisma/schema.prisma');
    const model = schema.slice(
      schema.indexOf('model RoleAssignment'),
      schema.indexOf('model StepUpGrant'),
    );

    const columns = model
      .split('\n')
      .filter((line) => !line.trim().startsWith('///'))
      .join(' ');

    for (const forbidden of ['scopeType', 'scopeId', 'targetType', 'scopeKind']) {
      expect(columns, `RoleAssignment must not carry ${forbidden}`).not.toContain(
        forbidden,
      );
    }
  });

  it('seeds no future-domain permission vocabulary', async () => {
    const migrations = await walk('packages/database/prisma/migrations', (name) =>
      name.endsWith('.sql'),
    );

    expect(migrations.length).toBeGreaterThan(0);

    for (const file of migrations) {
      const source = (await sourceOf(file)).toLowerCase();

      for (const domain of [
        'quran.',
        'hadith.',
        'fatwa.',
        'learning.',
        'membership.',
        'donations.',
        'teaching.',
        'content.',
        'question.',
      ]) {
        expect(source, `${file} must not seed ${domain}*`).not.toContain(`n'${domain}`);
      }
    }
  });

  it('keeps the TOTP secret and the recovery codes out of every surface', async () => {
    // No operation anywhere returns the stored secret or lists existing codes.
    // The enrolment URI is returned ONCE, by one method, and regeneration is
    // the only way to see a set again (SECURITY_BASELINE.md §8.2).
    const ports = code(await sourceOf('packages/contracts/src/identity/ports.ts'));

    for (const forbidden of [
      'viewBackupCodes',
      'readRecoveryCodes',
      'listRecoveryCodes',
      'getSecondFactorSecret',
      'readTotpSecret',
    ]) {
      expect(ports, `the port must not offer ${forbidden}`).not.toContain(forbidden);
    }

    const adapter = code(
      await sourceOf('packages/database/src/adapters/identity-access/index.ts'),
    );
    expect(adapter).not.toContain('viewBackupCodes');
  });

  it('introduces no Google OAuth', async () => {
    // Phase 2G's, and absent until it works.
    const sources = [
      ...(await walk('apps/web/src', (name) => /\.tsx?$/.test(name))),
      ...(await walk('packages/database/src', (name) => name.endsWith('.ts'))),
      ...(await walk('packages/contracts/src', (name) => name.endsWith('.ts'))),
      ...(await walk('packages/server-core/src', (name) => name.endsWith('.ts'))),
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

  it('keeps `next/` out of every package beneath Layer 4', async () => {
    const beneath = [
      ...(await walk('packages/database/src', (name) => name.endsWith('.ts'))),
      ...(await walk('packages/server-core/src', (name) => name.endsWith('.ts'))),
      ...(await walk('packages/contracts/src', (name) => name.endsWith('.ts'))),
    ];

    for (const file of beneath) {
      const source = code(await sourceOf(file));

      expect(source, `${file} must not import next`).not.toMatch(
        /from\s+['"]next(\/|['"])/,
      );
    }
  });
});

describe('Phase 2 Chunk 2 — the permission catalogue is one definition', () => {
  it('seeds exactly the keys the contract declares', async () => {
    // Two copies of a security vocabulary is two things to keep in step, and
    // the one that drifts is the one nobody reads. The migration and the
    // contract are compared directly.
    const contract = await sourceOf('packages/contracts/src/identity/permissions.ts');
    const migration = await sourceOf(
      'packages/database/prisma/migrations/' +
        '20260916000000_phase2_authorization_privileged_security/migration.sql',
    );

    // `permissions.grant` is declared through its named constant, because
    // SECURITY_BASELINE.md §3.4 rule 6 names the key and the constant is what
    // stops a call site spelling it differently. Both forms count.
    const grant = /export const PERMISSION_GRANT = '([a-z.]+)'/.exec(contract)?.[1];
    expect(grant).toBeDefined();

    const declared = [
      ...[...contract.matchAll(/key: '([a-z.]+)'/g)]
        .map((match) => match[1])
        .filter((key): key is string => key !== undefined),
      grant as string,
    ].sort();

    const seeded = [...migration.matchAll(/\(N'([a-z.]+)',\s+N'/g)]
      .map((match) => match[1])
      .filter((key): key is string => key !== undefined)
      .sort();

    expect(declared.length).toBeGreaterThan(0);
    expect(seeded).toEqual(declared);
  });

  it('names `permissions.grant` exactly as the security baseline does', async () => {
    // SECURITY_BASELINE.md §3.4 rule 6 names the key. It is not this
    // implementation's to rename.
    const contract = await sourceOf('packages/contracts/src/identity/permissions.ts');
    expect(contract).toContain(`export const PERMISSION_GRANT = 'permissions.grant'`);

    const baseline = await sourceOf('docs/SECURITY_BASELINE.md');
    expect(baseline).toContain('`permissions.grant`');
  });
});
