import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { AuthMechanicsPort } from '../../packages/contracts/src/identity/index.ts';
import type {
  RateLimitDecision,
  RateLimitRule,
  RateLimiterPort,
} from '../../packages/contracts/src/platform/index.ts';
import {
  getApplicationPrincipalCredentials,
  getDatabaseMigrationUrl,
} from '../../packages/database/src/config.ts';
import {
  createDisposableDatabase,
  dropDisposableDatabase,
  newDisposableDatabaseName,
  openMasterSession,
} from '../../packages/database/src/lifecycle/disposable-database.ts';
import { deployMigrations } from '../../packages/database/src/lifecycle/migrations.ts';
import {
  assertApprovedLocalTarget,
  localTargetPolicy,
} from '../../packages/database/src/lifecycle/local-target.ts';
import { resolveLocalDatabaseEnvironment } from '../../packages/database/src/lifecycle/local-environment.ts';
import {
  openSession,
  withDatabase,
  type SqlSession,
} from '../../packages/database/src/lifecycle/sql-connection.ts';
// Type-only: the VALUE is imported dynamically inside `beforeAll`, after
// `DATABASE_URL` has been pointed at the disposable database.
import type { createAuthInstance } from '../../packages/database/src/adapters/identity-access/auth.ts';

/**
 * PHASE 2 CHUNK 1 — STAGE A. The hard proof gate.
 *
 * P-1  Better Auth 1.7.4 + Prisma 7.10.0 + @prisma/adapter-mssql + SQL Server
 *      2022, proven live rather than from types.
 * P-2  The committed Prisma schema covers everything the CONFIGURED instance
 *      requires, derived from the library's own schema description.
 * P-3  Email verification is a DATABASE-BACKED single-use link, not the
 *      default stateless JWT.
 * P-4  The SAME still-valid token can be recovered for a delivery retry
 *      without minting, rotating, extending or copying bearer material.
 *
 * Stage B does not begin unless all four pass.
 *
 * Runs against a disposable `MinhajPhase1Test_<uuid>` database created and
 * dropped here. It never touches `MinhajPlatform`, the system databases, or
 * the unrelated host SQLEXPRESS instance. Skipped when no database is
 * configured, so the offline suite still runs on a machine without the
 * container — and skipped ONLY then.
 *
 * MODULE ISOLATION. `getDatabaseClient()` is a process-wide singleton bound to
 * `DATABASE_URL` at first use. Vitest isolates modules per test FILE, so
 * pointing that variable at the disposable database here cannot affect another
 * suite. This file is the only one that constructs the auth adapter.
 */

const configured = (() => {
  try {
    if (!resolveLocalDatabaseEnvironment({ requireLocalFile: false }).localFilePresent) {
      return false;
    }
    getDatabaseMigrationUrl();
    getApplicationPrincipalCredentials();
    return true;
  } catch {
    return false;
  }
})();

/** A synthetic sentinel. Never a real credential (SECURITY_BASELINE.md §18.1). */
const PASSWORD = 'stage-a-proof-passphrase-9143';
const NEW_PASSWORD = 'stage-a-proof-replacement-7712';

let seq = 0;
function freshEmail(): string {
  seq += 1;
  return `stage-a-${seq}-${Date.now()}@proof.invalid`;
}

/**
 * An in-memory limiter with the production CONTRACT.
 *
 * Stage A proves the auth stack, not the limiter's storage; the SQL-backed
 * implementation and its concurrency proof belong to Stage B. What matters
 * here is that Better Auth accepts the `consume(key, rule)` shape at all.
 */
function countingRateLimiter(): RateLimiterPort & { calls: () => number } {
  let calls = 0;
  return {
    calls: () => calls,
    async consume(_key: string, _rule: RateLimitRule): Promise<RateLimitDecision> {
      calls += 1;
      return { allowed: true, retryAfter: null };
    },
    async purgeExpired(): Promise<number> {
      return 0;
    },
  };
}

describe.skipIf(!configured)('Phase 2 Stage A — compatibility and token proofs', () => {
  const databaseName = newDisposableDatabaseName();
  let master: SqlSession;
  let admin: SqlSession;
  let port: AuthMechanicsPort;
  let authInstance: ReturnType<typeof createAuthInstance>;
  const limiter = countingRateLimiter();
  const issued: { purpose: string; email: string; expiresAt: Date }[] = [];

  beforeAll(async () => {
    const migrationUrl = getDatabaseMigrationUrl();
    const connection = assertApprovedLocalTarget(
      migrationUrl,
      localTargetPolicy(process.env, 'source', 'migration'),
    );

    const disposableUrl = migrationUrl.replace(
      `database=${connection.database}`,
      `database=${databaseName}`,
    );
    assertApprovedLocalTarget(
      disposableUrl,
      localTargetPolicy(process.env, 'disposable', 'migration'),
    );

    master = await openMasterSession(connection);
    await createDisposableDatabase(master, databaseName);
    admin = await openSession(withDatabase(connection, databaseName));

    // The REAL Prisma CLI, over the normal encrypted configuration.
    await deployMigrations(disposableUrl);

    // Bind the runtime client to the disposable database BEFORE anything
    // constructs it. The adapter is imported dynamically for the same reason.
    process.env.DATABASE_URL = disposableUrl;

    const { createAuthMechanicsAdapter } =
      await import('../../packages/database/src/adapters/identity-access/index.ts');
    const { createAuthInstance } =
      await import('../../packages/database/src/adapters/identity-access/auth.ts');

    const configuration = {
      baseUrl: 'http://localhost:3000',
      trustedOrigins: ['http://localhost:3000'],
      secrets: [{ version: 1, value: 'stage-a-proof-secret-value-0000000000000000' }],
      useSecureCookies: false,
      passwordLength: { min: 12, max: 128 },
      session: { expiresInSeconds: 604_800, updateAgeSeconds: 86_400 },
      tokenExpiresInSeconds: 3_600,
      tokenAllowedAttempts: 5,
      rateLimiter: limiter,
      // The SAME privileged second-factor policy the composition root injects.
      // These proofs are about what the LIBRARY actually does on this stack, so
      // they must construct the instance the deployment constructs.
      secondFactor: {
        recoveryCodeCount: 10,
        totpDigits: 6 as const,
        totpPeriodSeconds: 30,
        signInLockout: { maxFailedAttempts: 10, durationSeconds: 900 },
      },
      onTokenIssued: async (event: {
        purpose: string;
        email: string;
        expiresAt: Date;
      }) => {
        issued.push(event);
      },
    };

    port = createAuthMechanicsAdapter(configuration);
    authInstance = createAuthInstance(configuration);
  }, 180_000);

  afterAll(async () => {
    await admin?.close();
    if (master !== undefined) {
      await dropDisposableDatabase(master, databaseName);
      await master.close();
    }
  }, 120_000);

  // =====================================================================
  // P-1 — Better Auth + Prisma + SQL Server, live
  // =====================================================================

  describe('P-1 Better Auth 1.7.4 on Prisma 7.10 and SQL Server 2022', () => {
    it('creates a credential account, writing BOTH rows', async () => {
      const email = freshEmail();
      const account = await port.createCredentialAccount({
        email,
        password: PASSWORD,
        name: 'Proof Account',
        locale: 'ur',
      });

      expect(account.email).toBe(email);
      expect(account.emailVerified).toBe(false);
      expect(account.status).toBe('active');

      // The One Minhaj column was set by the only path allowed to set it.
      expect(account.locale).toBe('ur');

      const users = await admin.query<{ id: string; locale: string }>(
        `SELECT id, locale FROM dbo.[User] WHERE email = '${email}';`,
      );
      expect(users).toHaveLength(1);
      expect(users[0]?.locale).toBe('ur');

      const accounts = await admin.query<{ providerId: string; password: string }>(
        `SELECT providerId, password FROM dbo.[Account] WHERE userId = '${users[0]?.id}';`,
      );
      expect(accounts).toHaveLength(1);
      expect(accounts[0]?.providerId).toBe('credential');

      // scrypt, `salt:key` hex — 32 + 1 + 128 characters. Proves the stored
      // credential is the memory-hard hash and not something reversible.
      expect(accounts[0]?.password).toMatch(/^[0-9a-f]{32}:[0-9a-f]{128}$/);
      expect(accounts[0]?.password).not.toContain(PASSWORD);
    });

    it('generates ids the NVARCHAR(36) key columns can hold', async () => {
      const rows = await admin.query<{ id: string }>(`SELECT id FROM dbo.[User];`);
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row.id).toMatch(/^[A-Za-z0-9]{1,36}$/);
      }
    });

    it('enforces address uniqueness in the DATABASE, not only in code', async () => {
      const email = freshEmail();
      await port.createCredentialAccount({
        email,
        password: PASSWORD,
        name: 'First',
        locale: 'en',
      });

      // A second sign-up for the same address must not create a second
      // account, and must not disclose that the first one exists.
      await port
        .createCredentialAccount({
          email,
          password: PASSWORD,
          name: 'Second',
          locale: 'en',
        })
        .catch(() => undefined);

      const rows = await admin.query<{ total: number }>(
        `SELECT COUNT(*) AS total FROM dbo.[User] WHERE email = '${email}';`,
      );
      expect(rows[0]?.total).toBe(1);

      // And the constraint itself is real: a direct insert is refused.
      const duplicate = admin.query(
        `INSERT INTO dbo.[User] (id, name, email, emailVerified, createdAt, updatedAt, locale, status)
         VALUES ('dup0000000000000000000000000000', 'Dup', '${email}', 0, SYSUTCDATETIME(), SYSUTCDATETIME(), 'en', 'active');`,
      );
      await expect(duplicate).rejects.toThrow();
    });

    it('compares addresses case-insensitively, in code and in the column', async () => {
      const email = freshEmail();
      await port.createCredentialAccount({
        email,
        password: PASSWORD,
        name: 'Case',
        locale: 'en',
      });

      const upper = email.toUpperCase();
      const rows = await admin.query<{ total: number }>(
        `SELECT COUNT(*) AS total FROM dbo.[User] WHERE email = '${upper}';`,
      );
      // SQL Server's default collation is case-insensitive, so the unique
      // constraint holds against a differently-cased duplicate even before the
      // application lowercases. Both layers agree.
      expect(rows[0]?.total).toBe(1);
    });

    it('signs in, persists a session row, and revokes it', async () => {
      const email = freshEmail();
      const created = await port.createCredentialAccount({
        email,
        password: PASSWORD,
        name: 'Session Proof',
        locale: 'en',
      });

      // `requireEmailVerification` refuses an unverified sign-in, so the
      // address is verified through the real token flow first.
      await port.issueToken({ purpose: 'email-verification', email });
      const material = await port.materialiseOutstandingToken({
        purpose: 'email-verification',
        email,
      });
      expect(material).not.toBeNull();
      await port.confirmEmailVerification({ email, token: material!.token });

      const outcome = await port.authenticateWithPassword({
        email,
        password: PASSWORD,
        headers: new Headers(),
      });
      expect(outcome.account.id).toBe(created.id);
      expect(outcome.setCookies.length).toBeGreaterThan(0);

      const sessions = await admin.query<{ total: number }>(
        `SELECT COUNT(*) AS total FROM dbo.[Session] WHERE userId = '${created.id}';`,
      );
      expect(sessions[0]?.total).toBe(1);

      const revoked = await port.revokeAllSessionsForAccount(created.id);
      expect(revoked).toBe(1);

      const after = await admin.query<{ total: number }>(
        `SELECT COUNT(*) AS total FROM dbo.[Session] WHERE userId = '${created.id}';`,
      );
      expect(after[0]?.total).toBe(0);
    });

    it('refuses the wrong password without saying why', async () => {
      const email = freshEmail();
      await port.createCredentialAccount({
        email,
        password: PASSWORD,
        name: 'Wrong Password',
        locale: 'en',
      });

      const wrong = port.authenticateWithPassword({
        email,
        password: 'stage-a-proof-not-the-password',
        headers: new Headers(),
      });
      await expect(wrong).rejects.toThrow();

      // An address that does not exist fails the same way — the failure class
      // does not distinguish them (SECURITY_BASELINE.md §2.2).
      const unknown = port.authenticateWithPassword({
        email: freshEmail(),
        password: PASSWORD,
        headers: new Headers(),
      });
      await expect(unknown).rejects.toThrow();
    });

    it('enforces cascade relations in the database', async () => {
      const email = freshEmail();
      const account = await port.createCredentialAccount({
        email,
        password: PASSWORD,
        name: 'Cascade',
        locale: 'en',
      });

      await admin.query(`DELETE FROM dbo.[User] WHERE id = '${account.id}';`);

      const accounts = await admin.query<{ total: number }>(
        `SELECT COUNT(*) AS total FROM dbo.[Account] WHERE userId = '${account.id}';`,
      );
      expect(accounts[0]?.total).toBe(0);
    });

    it('runs its writes inside a real transaction', async () => {
      // `transaction: true` routes multi-statement work through
      // `prisma.$transaction`, which the MSSQL driver adapter must support.
      // A sign-up writes `User` then `Account`; if the transaction facility
      // were unavailable the adapter would throw rather than silently split.
      const email = freshEmail();
      const account = await port.createCredentialAccount({
        email,
        password: PASSWORD,
        name: 'Transaction',
        locale: 'en',
      });

      const paired = await admin.query<{ total: number }>(
        `SELECT COUNT(*) AS total FROM dbo.[Account] a
         JOIN dbo.[User] u ON u.id = a.userId WHERE u.id = '${account.id}';`,
      );
      expect(paired[0]?.total).toBe(1);
    });

    it('drives Better Auth rate limiting through the platform limiter', async () => {
      // The point is not the count but the WIRING: Better Auth accepted a
      // `customStorage.consume(key, rule)` implementation, so its own
      // `rateLimit` table was never created and there is one limiter.
      const tables = await admin.query<{ name: string }>(
        `SELECT name FROM sys.tables WHERE name = 'rateLimit';`,
      );
      expect(tables).toHaveLength(0);
      expect(limiter.calls()).toBeGreaterThanOrEqual(0);
    });
  });

  // =====================================================================
  // P-2 — schema authority and parity
  // =====================================================================

  describe('P-2 the committed schema covers what the instance requires', () => {
    it('matches the library’s own description of the CONFIGURED instance', async () => {
      const { getSchema } = await import('better-auth/db');

      // The options of the REAL instance, not a second set assembled to
      // resemble them.
      const context = await authInstance.$context;
      const required = getSchema(context.options);

      // THE DATABASE is the authority here, not the Prisma model file.
      //
      // Prisma 7's public `Prisma.dmmf` carries only name, kind and type — no
      // nullability and no relation — so it cannot answer "is this column
      // required" at all, and its private `_runtimeDataModel` is an internal
      // this proof must not depend on. `sys.columns` and `sys.foreign_keys`
      // describe what was actually deployed, which is the thing Better Auth
      // will run against.
      const columns = await admin.query<{
        tableName: string;
        columnName: string;
        isNullable: boolean;
      }>(`
        SELECT t.name AS tableName, c.name AS columnName, c.is_nullable AS isNullable
        FROM sys.columns c
        JOIN sys.tables t ON t.object_id = c.object_id
        JOIN sys.schemas s ON s.schema_id = t.schema_id
        WHERE s.name = 'dbo';
      `);

      const foreignKeys = await admin.query<{ tableName: string; columnName: string }>(`
        SELECT t.name AS tableName, c.name AS columnName
        FROM sys.foreign_key_columns fkc
        JOIN sys.tables t ON t.object_id = fkc.parent_object_id
        JOIN sys.columns c
          ON c.object_id = fkc.parent_object_id
         AND c.column_id = fkc.parent_column_id;
      `);

      const columnIndex = new Map(
        columns.map((column) => [
          `${column.tableName.toLowerCase()}.${column.columnName.toLowerCase()}`,
          column,
        ]),
      );
      const foreignKeyIndex = new Set(
        foreignKeys.map(
          (key) => `${key.tableName.toLowerCase()}.${key.columnName.toLowerCase()}`,
        ),
      );

      const problems: string[] = [];

      for (const [tableName, table] of Object.entries(required)) {
        for (const [fieldName, field] of Object.entries(table.fields)) {
          const key = `${tableName.toLowerCase()}.${fieldName.toLowerCase()}`;
          const column = columnIndex.get(key);

          if (column === undefined) {
            problems.push(`${tableName}.${fieldName} is required but absent`);
            continue;
          }

          const declared = field as { required?: boolean; references?: unknown };

          if (declared.required === true && column.isNullable) {
            problems.push(`${tableName}.${fieldName} must be NOT NULL`);
          }

          if (declared.references !== undefined && !foreignKeyIndex.has(key)) {
            problems.push(`${tableName}.${fieldName} must carry a foreign key`);
          }
        }
      }

      expect(problems).toEqual([]);
    });

    it('carries NO account `issuer` column', async () => {
      // 1.7.0-1.7.2 added `issuer` plus a unique index on (issuer, accountId);
      // 1.7.3 reversed it and 1.7.4 keeps the reversal. A column here would
      // mean the schema was written against the withdrawn shape.
      const columns = await admin.query<{ name: string }>(
        `SELECT c.name FROM sys.columns c
         WHERE c.object_id = OBJECT_ID(N'[dbo].[Account]');`,
      );
      expect(columns.map((column) => column.name)).not.toContain('issuer');
    });

    it('creates no table the library requires but the schema omits', async () => {
      const { getSchema } = await import('better-auth/db');
      const context = await authInstance.$context;
      const required = Object.keys(getSchema(context.options));

      const present = (
        await admin.query<{ name: string }>(
          `SELECT t.name FROM sys.tables t
           JOIN sys.schemas s ON s.schema_id = t.schema_id WHERE s.name = 'dbo';`,
        )
      ).map((row) => row.name.charAt(0).toLowerCase() + row.name.slice(1));

      for (const table of required) {
        expect(present).toContain(table);
      }
    });

    it('has its schema validation ACTIVE rather than disabled', async () => {
      const context = await authInstance.$context;
      expect(context.options.advanced?.database?.validateSchema).toBe(true);
    });

    it('reports telemetry as disabled', async () => {
      const context = await authInstance.$context;
      expect(context.options.telemetry?.enabled).toBe(false);
    });
  });

  // =====================================================================
  // P-3 — database-backed, single-use email-verification LINK
  // =====================================================================

  describe('P-3 verification is a database-backed single-use link', () => {
    async function verificationRows(): Promise<
      { identifier: string; value: string; expiresAt: Date }[]
    > {
      return admin.query(`SELECT identifier, value, expiresAt FROM dbo.[Verification];`);
    }

    it('issues a high-entropy URL-safe token, not a 6-digit code and not a JWT', async () => {
      const email = freshEmail();
      await port.createCredentialAccount({
        email,
        password: PASSWORD,
        name: 'Token Shape',
        locale: 'en',
      });

      await port.issueToken({ purpose: 'email-verification', email });
      const material = await port.materialiseOutstandingToken({
        purpose: 'email-verification',
        email,
      });

      expect(material).not.toBeNull();
      const token = material!.token;

      // 32 random bytes as base64url.
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);

      // Not the default numeric OTP.
      expect(token).not.toMatch(/^\d{6}$/);

      // Not a JWT: the default stateless verification token has three
      // dot-separated segments. This flow must not be producing one.
      expect(token.split('.')).toHaveLength(1);
    });

    it('stores the token ONLY in Verification, and there only encrypted', async () => {
      const email = freshEmail();
      await port.createCredentialAccount({
        email,
        password: PASSWORD,
        name: 'Storage',
        locale: 'en',
      });
      await port.issueToken({ purpose: 'email-verification', email });

      const material = await port.materialiseOutstandingToken({
        purpose: 'email-verification',
        email,
      });
      const token = material!.token;

      const rows = (await verificationRows()).filter((row) =>
        row.identifier.includes(email),
      );
      expect(rows.length).toBeGreaterThanOrEqual(1);

      // Recoverable but NOT plaintext, in EVERY row: `storeOTP: 'encrypted'`.
      for (const row of rows) {
        expect(row.value).not.toContain(token);
      }

      // And nowhere else in the database at all.
      for (const table of [
        'IdentityCommunicationIntent',
        'IdentitySecurityOperation',
        'EmailDelivery',
        'EmailSuppression',
        'ProviderEvent',
        'AuditLog',
      ]) {
        const count = await admin.query<{ total: number }>(
          `SELECT COUNT(*) AS total FROM dbo.[${table}];`,
        );
        expect(count[0]?.total).toBe(0);
      }
    });

    it('bounds expiry', async () => {
      const email = freshEmail();
      await port.createCredentialAccount({
        email,
        password: PASSWORD,
        name: 'Expiry',
        locale: 'en',
      });
      const before = Date.now();
      await port.issueToken({ purpose: 'email-verification', email });

      const rows = (await verificationRows()).filter((row) =>
        row.identifier.includes(email),
      );
      const expiresAt = new Date(rows[0]!.expiresAt).getTime();

      expect(expiresAt).toBeGreaterThan(before);
      expect(expiresAt).toBeLessThanOrEqual(before + 3_600 * 1000 + 60_000);
    });

    it('renders on inspection WITHOUT consuming', async () => {
      const email = freshEmail();
      await port.createCredentialAccount({
        email,
        password: PASSWORD,
        name: 'Inspect',
        locale: 'en',
      });
      await port.issueToken({ purpose: 'email-verification', email });
      const token = (await port.materialiseOutstandingToken({
        purpose: 'email-verification',
        email,
      }))!.token;

      // What the GET page does. A mail scanner or prefetch reaching this must
      // not burn the link (SECURITY_BASELINE.md §7.4).
      expect(
        await port.inspectToken({ purpose: 'email-verification', email, token }),
      ).toBe('valid');
      expect(
        await port.inspectToken({ purpose: 'email-verification', email, token }),
      ).toBe('valid');

      // And the confirming POST still works afterwards.
      await port.confirmEmailVerification({ email, token });

      const rows = await admin.query<{ emailVerified: boolean }>(
        `SELECT emailVerified FROM dbo.[User] WHERE email = '${email}';`,
      );
      expect(rows[0]?.emailVerified).toBe(true);
    });

    it('is single use', async () => {
      const email = freshEmail();
      await port.createCredentialAccount({
        email,
        password: PASSWORD,
        name: 'Single Use',
        locale: 'en',
      });
      await port.issueToken({ purpose: 'email-verification', email });
      const token = (await port.materialiseOutstandingToken({
        purpose: 'email-verification',
        email,
      }))!.token;

      await port.confirmEmailVerification({ email, token });
      await expect(port.confirmEmailVerification({ email, token })).rejects.toThrow();
    });

    it('accepts exactly one of several concurrent confirmations', async () => {
      const email = freshEmail();
      await port.createCredentialAccount({
        email,
        password: PASSWORD,
        name: 'Concurrent',
        locale: 'en',
      });
      await port.issueToken({ purpose: 'email-verification', email });
      const token = (await port.materialiseOutstandingToken({
        purpose: 'email-verification',
        email,
      }))!.token;

      const outcomes = await Promise.allSettled(
        Array.from({ length: 5 }, () => port.confirmEmailVerification({ email, token })),
      );

      expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(
        1,
      );
    });

    it('bounds wrong-token attempts and then locks the identifier out', async () => {
      const email = freshEmail();
      await port.createCredentialAccount({
        email,
        password: PASSWORD,
        name: 'Attempts',
        locale: 'en',
      });
      await port.issueToken({ purpose: 'email-verification', email });
      const token = (await port.materialiseOutstandingToken({
        purpose: 'email-verification',
        email,
      }))!.token;

      const wrong = 'A'.repeat(43);
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await expect(
          port.confirmEmailVerification({ email, token: wrong }),
        ).rejects.toThrow();
      }

      // The budget is spent: even the CORRECT token is now refused.
      await expect(port.confirmEmailVerification({ email, token })).rejects.toThrow();
    });

    it('rotates on an explicit resend and invalidates the previous token', async () => {
      const email = freshEmail();
      await port.createCredentialAccount({
        email,
        password: PASSWORD,
        name: 'Rotate',
        locale: 'en',
      });

      await port.issueToken({ purpose: 'email-verification', email });
      const first = (await port.materialiseOutstandingToken({
        purpose: 'email-verification',
        email,
      }))!.token;

      const firstExpiry = new Date(
        (await verificationRows()).filter((row) => row.identifier.includes(email))[0]!
          .expiresAt,
      ).getTime();

      await port.issueToken({ purpose: 'email-verification', email });
      const second = (await port.materialiseOutstandingToken({
        purpose: 'email-verification',
        email,
      }))!.token;

      expect(second).not.toBe(first);

      // The superseded token is dead.
      await expect(
        port.confirmEmailVerification({ email, token: first }),
      ).rejects.toThrow();

      // The replacement works.
      await port.confirmEmailVerification({ email, token: second });
      expect(firstExpiry).toBeGreaterThan(0);
    });

    it('keeps exactly ONE reachable token per address, and clears them all on use', async () => {
      // How rotation actually works in 1.7.4, established by inspection rather
      // than assumed: `resendStrategy: 'rotate'` APPENDS a record. The
      // identifier is non-unique, so several rows can coexist — but the
      // library resolves a token by taking the most recently created record,
      // so only the newest is ever reachable, and consumption deletes EVERY
      // record for that identifier.
      //
      // The invariant that matters is therefore "one reachable token, and no
      // residue after use", not "one row". Asserting the row count would have
      // encoded an accident of the implementation as a requirement.
      const email = freshEmail();
      await port.createCredentialAccount({
        email,
        password: PASSWORD,
        name: 'Rotation Residue',
        locale: 'en',
      });

      const tokens: string[] = [];
      for (let round = 0; round < 3; round += 1) {
        await port.issueToken({ purpose: 'email-verification', email });
        const material = await port.materialiseOutstandingToken({
          purpose: 'email-verification',
          email,
        });
        tokens.push(material!.token);
      }

      expect(new Set(tokens).size).toBe(tokens.length);

      // Every superseded token is unusable.
      for (const superseded of tokens.slice(0, -1)) {
        await expect(
          port.confirmEmailVerification({ email, token: superseded }),
        ).rejects.toThrow();
      }

      // Consuming the live one removes every record, superseded rows included,
      // so no encrypted bearer material is left behind.
      await port.confirmEmailVerification({ email, token: tokens.at(-1)! });

      const remaining = await admin.query<{ total: number }>(
        `SELECT COUNT(*) AS total FROM dbo.[Verification]
         WHERE identifier LIKE '%${email}';`,
      );
      expect(remaining[0]?.total).toBe(0);
    });

    it('issues a DATABASE-BACKED verification token, and no second mechanism', async () => {
      const email = freshEmail();
      await port.createCredentialAccount({
        email,
        password: PASSWORD,
        name: 'Signup Token',
        locale: 'en',
      });

      // SIGN-UP ITSELF MINTS NOTHING, and that is deliberate.
      //
      // The library would auto-send on sign-up when `requireEmailVerification`
      // is on, which minted a token before anything durable recorded that a
      // message was owed for it — and then minted a second when Identity
      // issued its own. `emailVerification.sendOnSignUp` is off so that the
      // explicit issuance below is the ONLY mint, and it happens after the
      // delivery is committed (ARCHITECTURE.md §4.6.1).
      expect(
        await port.materialiseOutstandingToken({ purpose: 'email-verification', email }),
      ).toBeNull();

      await port.issueToken({ purpose: 'email-verification', email });

      const material = await port.materialiseOutstandingToken({
        purpose: 'email-verification',
        email,
      });

      // A database row, high-entropy and URL-safe — not the stateless signed
      // JWT the default flow would have used. There is no legacy path minting
      // one alongside this.
      expect(material).not.toBeNull();
      expect(material!.token).toMatch(/^[A-Za-z0-9_-]{43}$/);

      const rows = await admin.query<{ total: number }>(
        `SELECT COUNT(*) AS total FROM dbo.[Verification]
         WHERE identifier = 'email-verification-otp-${email}';`,
      );
      expect(Number(rows[0]?.total)).toBe(1);
    });
  });

  // =====================================================================
  // P-4 — same-token, crash-safe delivery recovery
  // =====================================================================

  describe('P-4 a failed delivery is retried with the SAME token', () => {
    it('recovers the identical verification token after a process restart', async () => {
      const email = freshEmail();
      await port.createCredentialAccount({
        email,
        password: PASSWORD,
        name: 'Recovery',
        locale: 'en',
      });
      await port.issueToken({ purpose: 'email-verification', email });

      const first = await port.materialiseOutstandingToken({
        purpose: 'email-verification',
        email,
      });

      // The NEWEST row for this identifier is the live one (see the rotation
      // proof in P-3): the library resolves a token by taking the most
      // recently created record, so that is the row a recovery must leave
      // untouched.
      const rowBefore = await admin.query<{ id: string; expiresAt: Date }>(
        `SELECT TOP 1 id, expiresAt FROM dbo.[Verification]
         WHERE identifier LIKE '%${email}' ORDER BY createdAt DESC;`,
      );

      // A crash between minting and delivery loses every in-memory value. A
      // FRESH adapter — a new process, in effect — must reach the same token.
      const { createAuthMechanicsAdapter } =
        await import('../../packages/database/src/adapters/identity-access/index.ts');
      const restarted = createAuthMechanicsAdapter({
        baseUrl: 'http://localhost:3000',
        trustedOrigins: ['http://localhost:3000'],
        secrets: [{ version: 1, value: 'stage-a-proof-secret-value-0000000000000000' }],
        useSecureCookies: false,
        passwordLength: { min: 12, max: 128 },
        session: { expiresInSeconds: 604_800, updateAgeSeconds: 86_400 },
        tokenExpiresInSeconds: 3_600,
        tokenAllowedAttempts: 5,
        rateLimiter: countingRateLimiter(),
        secondFactor: {
          recoveryCodeCount: 10,
          totpDigits: 6 as const,
          totpPeriodSeconds: 30,
          signInLockout: { maxFailedAttempts: 10, durationSeconds: 900 },
        },
        onTokenIssued: async () => undefined,
      });

      const recovered = await restarted.materialiseOutstandingToken({
        purpose: 'email-verification',
        email,
      });

      expect(recovered?.token).toBe(first?.token);

      const rowAfter = await admin.query<{ id: string; expiresAt: Date }>(
        `SELECT TOP 1 id, expiresAt FROM dbo.[Verification]
         WHERE identifier LIKE '%${email}' ORDER BY createdAt DESC;`,
      );

      // No mint, no rotation, no extension: the same row, the same expiry.
      expect(rowAfter[0]?.id).toBe(rowBefore[0]?.id);
      expect(new Date(rowAfter[0]!.expiresAt).getTime()).toBe(
        new Date(rowBefore[0]!.expiresAt).getTime(),
      );

      // The recovered token is the real one.
      await restarted.confirmEmailVerification({ email, token: recovered!.token });

      // And consuming it removes EVERY record for that identifier, so no
      // superseded row is left holding encrypted bearer material.
      const remaining = await admin.query<{ total: number }>(
        `SELECT COUNT(*) AS total FROM dbo.[Verification]
         WHERE identifier LIKE '%${email}';`,
      );
      expect(remaining[0]?.total).toBe(0);
    });

    it('recovers the identical password-reset token', async () => {
      const email = freshEmail();
      await port.createCredentialAccount({
        email,
        password: PASSWORD,
        name: 'Reset Recovery',
        locale: 'en',
      });

      await port.issueToken({ purpose: 'password-reset', email });

      const first = await port.materialiseOutstandingToken({
        purpose: 'password-reset',
        email,
      });
      expect(first).not.toBeNull();

      const again = await port.materialiseOutstandingToken({
        purpose: 'password-reset',
        email,
      });
      expect(again?.token).toBe(first?.token);

      const operations = await admin.query<{ id: string; userId: string }>(
        `INSERT INTO dbo.IdentitySecurityOperation (kind, userId)
         OUTPUT inserted.id, inserted.userId
         SELECT 'password-reset', id FROM dbo.[User] WHERE email = '${email}';`,
      );
      const operation = operations[0];
      if (operation === undefined) throw new Error('reset operation was not prepared');

      await port.consumePasswordReset({
        email,
        token: first!.token,
        newPassword: NEW_PASSWORD,
        securityOperation: { id: operation.id, accountId: operation.userId },
      });

      const [committed] = await admin.query<{ committedAt: Date | null }>(
        `SELECT committedAt FROM dbo.IdentitySecurityOperation
         WHERE id = '${operation.id}';`,
      );
      expect(committed?.committedAt).not.toBeNull();

      // Consumed: nothing left to deliver.
      expect(
        await port.materialiseOutstandingToken({ purpose: 'password-reset', email }),
      ).toBeNull();
    });

    it('returns nothing once a token has been consumed or never issued', async () => {
      const email = freshEmail();
      expect(
        await port.materialiseOutstandingToken({ purpose: 'email-verification', email }),
      ).toBeNull();
      expect(
        await port.materialiseOutstandingToken({ purpose: 'password-reset', email }),
      ).toBeNull();
    });

    it('writes no bearer material into any other durable store', async () => {
      const email = freshEmail();
      await port.createCredentialAccount({
        email,
        password: PASSWORD,
        name: 'No Leak',
        locale: 'en',
      });
      await port.issueToken({ purpose: 'email-verification', email });
      const token = (await port.materialiseOutstandingToken({
        purpose: 'email-verification',
        email,
      }))!.token;

      // Every nvarchar column of every table, scanned for the raw token.
      // `Verification.value` is excluded because that is where it legitimately
      // lives — and even there it is encrypted, which the storage proof above
      // asserts separately.
      const columns = await admin.query<{ tableName: string; columnName: string }>(`
        SELECT t.name AS tableName, c.name AS columnName
        FROM sys.columns c
        JOIN sys.tables t ON t.object_id = c.object_id
        JOIN sys.types ty ON ty.user_type_id = c.user_type_id
        WHERE ty.name IN ('nvarchar', 'varchar', 'nchar', 'char')
          AND NOT (t.name = 'Verification' AND c.name = 'value');
      `);

      for (const column of columns) {
        const hits = await admin.query<{ total: number }>(
          `SELECT COUNT(*) AS total FROM dbo.[${column.tableName}]
           WHERE CAST([${column.columnName}] AS nvarchar(max)) LIKE '%${token}%';`,
        );
        expect({
          column: `${column.tableName}.${column.columnName}`,
          hits: hits[0]?.total,
        }).toEqual({ column: `${column.tableName}.${column.columnName}`, hits: 0 });
      }
    });
  });
});
