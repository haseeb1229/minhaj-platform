import 'server-only';

import type { FatwaAsker } from '@minhaj/contracts/fatwa';
import type { NotificationKind } from '@minhaj/contracts/personalisation';

import { identityRuntime } from './identity';
import { appLogger } from './logging';
import { personalisationRuntime } from './personalisation';

/**
 * Tells an asker, in-app, that their question was answered or declined —
 * Layer 4 composing Fatwa's committed decision with Personalisation's
 * notification (DOMAIN_MODEL.md §14.1; ARCHITECTURE.md §4.6.1).
 *
 * WHAT IT SAYS. A translatable kind and a link to the asker's OWN question
 * page; never the question, the ruling, a name or a category. The asker's own
 * `/my/questions/{id}` page is where anything more is read, under their session.
 *
 * DERIVED, NOT ATOMIC. Fatwa's decision has already committed; this runs after
 * it. The idempotency key makes a retry — or a later correction of the same
 * ruling — one notification at most, and a failure is logged by operation name
 * and never turns the committed decision into a reported error. The asker's
 * question page shows the status regardless.
 */
export async function notifyAsker(
  asker: FatwaAsker | null,
  kind: Extract<NotificationKind, 'question-answered' | 'question-declined'>,
): Promise<void> {
  if (asker === null) return;
  try {
    // A closed account is owed nothing, and its records are being disposed of.
    const closed = await identityRuntime().administration.closedAccounts([
      asker.accountId,
    ]);
    if (closed.includes(asker.accountId)) return;
    await personalisationRuntime().notifications.produce({
      accountId: asker.accountId,
      kind,
      destination: `/my/questions/${asker.questionId}`,
      idempotencyKey: `fatwa:${kind}:${asker.questionId}`,
    });
  } catch {
    appLogger().warn({ operation: 'fatwa-notification' }, 'Asker notification failed.');
  }
}
