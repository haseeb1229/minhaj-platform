import 'server-only';

/**
 * A database refusal in Migration & Provenance's own vocabulary — the ONE
 * value this adapter's public entry exports besides its factories. The
 * service maps `reason` onto its refusal list; nothing here carries a body, a
 * payload, a URL, a header or an account.
 *
 * ITS OWN MODULE, deliberately: the entry re-exports it, and an entry must not
 * reach a module holding raw database capability (ARCHITECTURE.md §4.1, §6.3
 * rule 13). The adapter's query fragments live beside the Prisma value they
 * are built from, in `./shared.ts`, which the entry never names.
 *
 * Reasons: `not-found`, `conflict` (a stale expected version, or a key a
 * concurrent writer took), `duplicate` (a source key already registered),
 * `invalid`, `invalid-state`, `denied` (publication authority not held now),
 * `host-refused` (a fixture source naming a host outside `*.fixture.invalid`),
 * `real-source-not-authorised`, `run-busy`, `lease-lost`, `run-unreconciled`
 * and `unavailable`.
 */
export class MigrationDataError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(reason);
    this.reason = reason;
    this.name = 'MigrationDataError';
  }
}
