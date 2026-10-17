import 'server-only';

/**
 * A database refusal in Messaging's own vocabulary — the ONE value this
 * adapter's public entry exports besides its factory. It is thrown only where
 * the port has no outcome of its own for what happened (a rule the adapter's
 * questions did not ask first, met at the migration's floor); everything the
 * port CAN say is said as an outcome. Nothing here carries a body, a filename,
 * a token or a person.
 *
 * ITS OWN MODULE, deliberately: the entry re-exports it, and an entry must not
 * reach a module holding raw database capability (ARCHITECTURE.md §4.1, §6.3
 * rule 13). The adapter's query fragments live beside the Prisma value they
 * are built from, in `./shared.ts`, which the entry never names.
 */
export class MessagingDataError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(reason);
    this.reason = reason;
    this.name = 'MessagingDataError';
  }
}
