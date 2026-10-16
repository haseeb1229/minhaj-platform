import 'server-only';

/**
 * A database refusal in Learning's own vocabulary — the ONE value this
 * adapter's public entry exports besides its factories. The service maps
 * `reason` onto its refusal list; nothing here carries a title, a lesson or a
 * learner.
 *
 * ITS OWN MODULE, deliberately: the entry re-exports it, and an entry must not
 * reach a module holding raw database capability (ARCHITECTURE.md §4.1, §6.3
 * rule 13). The adapter's query fragments live beside the Prisma value they
 * are built from, in `./shared.ts`, which the entry never names.
 */
export class LearningDataError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'LearningDataError';
  }
}
