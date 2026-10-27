import 'server-only';

import {
  MIGRATION_CONTENT_KINDS,
  isPublishableKind,
  type MigrationContentKind,
  type MigrationPublicationTargetPort,
} from '@minhaj/contracts/migration';

/**
 * ONE PUBLISHER PER PUBLISHABLE KIND — the Layer-4 router (Phase 30;
 * MIGRATION_STRATEGY.md §2.2, §4.12).
 *
 * Each per-kind target speaks to exactly one owning domain through that
 * domain's public service. The router is FAIL-CLOSED by construction:
 *
 *   - a REVIEW-ONLY kind (Fatwa, Quran) is supported by nothing, whatever a
 *     target claims — religious material is never published by migration;
 *   - a kind no target supports is unsupported (`no-target`);
 *   - a kind TWO targets claim is a wiring defect, refused at composition,
 *     never resolved by picking one;
 *   - a call for an unsupported kind is refused before any target is asked.
 *
 * NODE-RUNNABLE: shared by the web process and the migration CLIs, so it
 * names packages and explicit `.ts` paths only — never the `@/` alias.
 */
export function routeMigrationTargets(
  targets: readonly MigrationPublicationTargetPort[],
): MigrationPublicationTargetPort {
  const owner = new Map<MigrationContentKind, MigrationPublicationTargetPort>();
  for (const kind of MIGRATION_CONTENT_KINDS) {
    const claiming = targets.filter((target) => target.supports(kind));
    if (claiming.length > 1)
      throw new Error(`Migration publication wiring: ${kind} has more than one target.`);
    const [only] = claiming;
    if (only !== undefined && isPublishableKind(kind)) owner.set(kind, only);
  }

  return {
    supports: (kind) => owner.has(kind),

    async publish(input) {
      const target = owner.get(input.kind);
      if (target === undefined || input.payload.kind !== input.kind)
        return { status: 'refused', reason: 'unsupported-kind' };
      return target.publish(input);
    },

    async inspect(input) {
      const target = owner.get(input.target.kind);
      return target === undefined ? null : target.inspect(input);
    },

    async withdraw(input) {
      const target = owner.get(input.target.kind);
      if (target === undefined) return { status: 'refused', reason: 'unsupported-kind' };
      return target.withdraw(input);
    },
  };
}
