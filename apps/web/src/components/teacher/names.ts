import 'server-only';

import { identityRuntime } from '@/composition/identity';

/**
 * The display names of the learners a teacher's page lists — Identity's
 * narrow answer, by account identifier, for ACTIVE accounts only. Nothing else
 * about an account crosses here: no address, no status. An account Identity
 * does not name (closed, suspended) is simply absent, and the page writes
 * "Learner" in its place rather than guessing.
 */
export async function participantNames(
  accountIds: readonly string[],
): Promise<ReadonlyMap<string, string>> {
  const unique = [...new Set(accountIds)];
  if (unique.length === 0) return new Map();
  const entries = await identityRuntime().administration.participantNames(unique);
  return new Map(entries.map((entry) => [entry.accountId, entry.name]));
}
