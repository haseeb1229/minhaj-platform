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

/**
 * The shared harness for Phase-2 live suites.
 *
 * Each suite gets its OWN disposable `MinhajPhase1Test_<uuid>` database,
 * created and dropped by itself. It never touches `MinhajPlatform`, the system
 * databases, or the unrelated host SQLEXPRESS instance
 * (SECURITY_BASELINE.md §18.2).
 *
 * WHY A SHARED FILE RATHER THAN A COPY PER SUITE. The disposable-database
 * lifecycle is the part of this that must not be got wrong twice: the target
 * assertion, the disposable naming, the drop in `afterAll`. Duplicating it per
 * suite is how one copy quietly loses its `assertApprovedLocalTarget` call.
 *
 * MODULE ISOLATION. `getDatabaseClient()` is a process-wide singleton bound to
 * `DATABASE_URL` at first use, and Vitest isolates modules per test FILE — so
 * repointing that variable here affects this file and nothing else. Every
 * adapter is therefore imported DYNAMICALLY, after the repoint.
 */

/**
 * Is a live database configured for this run?
 *
 * `false` only when the local database configuration genuinely cannot exist —
 * no local environment file, no migration credentials. That is the one case
 * where skipping is honest; a suite that skipped because a container happened
 * to be down would report green for proofs nobody ran.
 */
export const databaseConfigured = (() => {
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

export interface DisposableDatabase {
  readonly name: string;
  /** A privileged session ON the disposable database, for direct inspection. */
  readonly admin: SqlSession;
  readonly url: string;
  close(): Promise<void>;
}

/**
 * Creates a disposable database, deploys the real migrations into it, and
 * points `DATABASE_URL` at it.
 *
 * The migrations are deployed by the REAL Prisma CLI over the normal encrypted
 * configuration, so what is proved against is what a deployment produces —
 * not a schema this test drew by hand.
 */
export async function createProofDatabase(): Promise<DisposableDatabase> {
  const migrationUrl = getDatabaseMigrationUrl();
  const connection = assertApprovedLocalTarget(
    migrationUrl,
    localTargetPolicy(process.env, 'source', 'migration'),
  );

  const name = newDisposableDatabaseName();
  const url = migrationUrl.replace(`database=${connection.database}`, `database=${name}`);

  // POSITIVELY PROVED before anything is created, and again for the disposable
  // target. Absence of a blocklist match is not proof of a safe target.
  assertApprovedLocalTarget(
    url,
    localTargetPolicy(process.env, 'disposable', 'migration'),
  );

  const master = await openMasterSession(connection);
  await createDisposableDatabase(master, name);

  const admin = await openSession(withDatabase(connection, name));
  await deployMigrations(url);

  process.env.DATABASE_URL = url;

  return {
    name,
    admin,
    url,
    async close() {
      await admin.close();
      await dropDisposableDatabase(master, name);
      await master.close();
    },
  };
}

/** A synthetic sentinel. Never a real credential (SECURITY_BASELINE.md §18.1). */
export const PROOF_PASSWORD = 'stage-b-proof-passphrase-4471';
export const PROOF_NEW_PASSWORD = 'stage-b-proof-replacement-8823';

let sequence = 0;

/**
 * A fresh address per call.
 *
 * `.invalid` is reserved by RFC 2606 and can never resolve, so a proof address
 * cannot accidentally become a real recipient.
 */
export function freshEmail(prefix = 'stage-b'): string {
  sequence += 1;
  return `${prefix}-${sequence}-${Date.now()}@proof.invalid`;
}

/** Synthetic keys for the digest and secret configuration a suite needs. */
export const PROOF_SECRETS = {
  authSecrets: [{ version: 1, value: 'stage-b-proof-secret-value-000000000000000' }],
  digestKey: 'stage-b-proof-digest-key-0000',
  digestKeyVersion: 1,
} as const;

/* ===========================================================================
 * A capturing email provider — TEST ONLY
 * ========================================================================= */

export interface CapturedMessage {
  readonly to: string;
  readonly subject: string;
  readonly html: string;
  readonly text: string;
  readonly idempotencyKey: string;
}

export interface CapturingProvider {
  readonly providerName: string;
  readonly available: boolean;
  send(message: CapturedMessage): Promise<
    | { outcome: 'accepted'; providerMessageId: string }
    | {
        outcome: 'rejected';
        failureClass: 'transient' | 'permanent';
        failureCode: string;
      }
  >;
  /** Every message this process was asked to send, in order. */
  readonly sent: CapturedMessage[];
  /** The action URL of the most recent message, or `null`. */
  lastLink(): string | null;
  /** The action URL of the most recent message to one address. */
  lastLinkTo(recipient: string): string | null;
  /**
   * Make the next `n` sends TO ONE RECIPIENT fail in the given way.
   *
   * Targeted rather than global. Every suite shares one database and one
   * dispatcher, and a tick claims every delivery that is due — so a global
   * "fail the next send" lands on whichever message happened to be claimed
   * first, which is a different one from run to run. That is a test that fails
   * intermittently for a reason unrelated to what it asserts.
   */
  failNextTo(
    recipient: string,
    count: number,
    failure: { class: 'transient' | 'permanent'; code: string },
  ): void;
  /** Every message sent to one address, in order. */
  messagesTo(recipient: string): CapturedMessage[];
  reset(): void;
}

/**
 * An in-memory provider that CAPTURES what would have been sent.
 *
 * Permitted by the Phase-2 contract, and only under its conditions: ephemeral,
 * test-only, never persisted to SQL, never written to normal logs, destroyed
 * with the process. Production architecture keeps bearer tokens in Better
 * Auth's `Verification` record and nowhere else, and NOTHING here changes that
 * — a production outbox holding rendered links, created to make browser tests
 * convenient, is exactly the second durable bearer store the architecture
 * exists to prevent.
 *
 * What it makes testable is the whole point: that the link in the message is
 * the link that works, that a delivery RETRY carries the SAME one, and that a
 * provider failure degrades delivery rather than correctness.
 */
export function capturingProvider(): CapturingProvider {
  const sent: CapturedMessage[] = [];
  const failures = new Map<
    string,
    { remaining: number; class: 'transient' | 'permanent'; code: string }
  >();
  let counter = 0;

  function linkIn(message: CapturedMessage | undefined): string | null {
    if (message === undefined) return null;

    // Read from the PLAIN TEXT part. The HTML part carries the same URL twice
    // — once in the href and once as visible text for clients that do not
    // render buttons — and picking it out of markup would be brittle.
    const match = /https?:\/\/\S+/.exec(message.text);
    return match?.[0] ?? null;
  }

  return {
    providerName: 'capturing',
    available: true,
    sent,

    async send(message) {
      sent.push(message);

      const planned = failures.get(message.to);

      if (planned !== undefined && planned.remaining > 0) {
        planned.remaining -= 1;
        if (planned.remaining === 0) failures.delete(message.to);

        return {
          outcome: 'rejected' as const,
          failureClass: planned.class,
          failureCode: planned.code,
        };
      }

      counter += 1;
      return { outcome: 'accepted', providerMessageId: `capture-${counter}` };
    },

    lastLink() {
      return linkIn(sent.at(-1));
    },

    lastLinkTo(recipient: string) {
      return linkIn([...sent].reverse().find((message) => message.to === recipient));
    },

    failNextTo(recipient, count, failure) {
      failures.set(recipient, {
        remaining: count,
        class: failure.class,
        code: failure.code,
      });
    },

    messagesTo(recipient) {
      return sent.filter((message) => message.to === recipient);
    },

    reset() {
      sent.length = 0;
      failures.clear();
      counter = 0;
    },
  };
}

/** Pulls the `token` and `email` query values out of a captured link. */
export function linkParameters(link: string): {
  readonly email: string;
  readonly token: string;
  readonly pathname: string;
} {
  const url = new URL(link);

  return {
    email: url.searchParams.get('email') ?? '',
    token: url.searchParams.get('token') ?? '',
    pathname: url.pathname,
  };
}
