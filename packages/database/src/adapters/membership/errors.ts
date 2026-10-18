import 'server-only';

/**
 * A database refusal in Membership's own vocabulary — the ONE value this
 * adapter's public entry exports besides its factories. The service maps
 * `reason` onto its refusal list; nothing here carries a type's words, an
 * applicant or an address.
 *
 * ITS OWN MODULE, deliberately: the entry re-exports it, and an entry must not
 * reach a module holding raw database capability (ARCHITECTURE.md §4.1, §6.3
 * rule 13). The adapter's query fragments live beside the Prisma value they
 * are built from, in `./shared.ts`, which the entry never names.
 */
export class MembershipDataError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(reason);
    this.reason = reason;
    this.name = 'MembershipDataError';
  }
}
