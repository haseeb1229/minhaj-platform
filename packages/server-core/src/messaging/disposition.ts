import 'server-only';

import {
  MESSAGING_LIMITS,
  type DisposalCandidate,
  type MessagingAccountPort,
  type MessagingAttachmentStoragePort,
  type MessagingDispositionProgress,
  type MessagingPersistencePort,
  type PendingRelease,
} from '@minhaj/contracts/messaging';

import { chunks, IDENTITY_BATCH } from './access.ts';

/**
 * Messaging's part of account closure, and the release of bytes it stored
 * (SECURITY_BASELINE.md §19.1; DOMAIN_MODEL.md §15.6).
 *
 * IDENTITY OWNS CLOSURE. Messaging asks only which accounts are closed and
 * then withdraws and disposes of its OWN rows. The caller has already proved
 * the account closed; nothing here can be turned on a living person.
 *
 * TWO STAGES, BECAUSE A CONVERSATION HAS TWO PEOPLE. Withdrawal ends the
 * closed account's live state at once — its open conversations close as
 * `account-closed`, its participation ends, its read state, blocks and unsent
 * uploads go. The conversation ITSELF is disposed only when every other person
 * in it is closed too and no report names it: until then it is the other
 * person's history (the terminal rule), and a reported one is evidence.
 *
 * BYTES LEAVE BEFORE ROWS. An attachment row is moved to `releasing` in
 * Messaging's own transaction, Storage releases the asset under the token
 * the row carries, and only then is the row forgotten. A crash anywhere leaves
 * a `releasing` row that the next run finds and finishes; Storage's release
 * is idempotent, so finishing twice is harmless.
 *
 * BOUNDED AND HONEST. Every loop has a budget; when one runs out, or a step
 * cannot progress, the result says `complete: false` and the next run resumes.
 * `removed` counts rows withdrawn, attachments released and conversations
 * removed — the work done, not a promise about what is left.
 */

const WITHDRAW_BATCH = 200;
const WITHDRAW_ROUNDS = 20;
/** Candidate pages per account per run (each `MESSAGING_LIMITS.dispositionBatch`). */
const CANDIDATE_PAGES = 10;
const DISPOSING_PAGE = 25;
const DISPOSING_PAGES = 4;
const STEP_BATCH = 200;
const STEP_ROUNDS = 20;
const RELEASE_BATCH = 25;
const RELEASE_ROUNDS = 4;
const SWEEP_PAGE = 100;
const SWEEP_PAGES = 10;
const HOUR = 3_600_000;

interface Progress {
  readonly removed: number;
  readonly complete: boolean;
}

export function createDisposition(deps: {
  readonly persistence: MessagingPersistencePort;
  readonly accounts: MessagingAccountPort;
  readonly storage: MessagingAttachmentStoragePort;
  readonly now: () => Date;
}) {
  const store = deps.persistence;

  /** Releases each asset, then forgets its row. `referenced` rows stay. */
  async function releaseEach(
    releases: readonly PendingRelease[],
  ): Promise<{ readonly released: number; readonly referenced: number }> {
    let released = 0;
    let referenced = 0;
    for (const release of releases) {
      const outcome = await deps.storage.release(release.releaseToken);
      if (outcome === 'referenced') {
        referenced += 1;
        continue;
      }
      await store.forgetAttachment(release.attachmentId);
      released += 1;
    }
    return { released, referenced };
  }

  /** Drains `releasing` rows (after moving stale unsent uploads there), bounded. */
  async function releaseRounds(input: {
    readonly conversationId: string | null;
    readonly staleBefore: Date;
  }): Promise<Progress> {
    let removed = 0;
    for (let round = 0; round < RELEASE_ROUNDS; round += 1) {
      const queue = await store.releaseQueue({ ...input, limit: RELEASE_BATCH });
      if (queue.length === 0) return { removed, complete: true };
      const outcome = await releaseEach(queue);
      removed += outcome.released;
      // A row Storage cannot release yet comes back on every read: stop
      // rather than spin on it, and say the work is not finished.
      if (outcome.referenced > 0) return { removed, complete: false };
      if (queue.length < RELEASE_BATCH) return { removed, complete: true };
    }
    return { removed, complete: false };
  }

  const staleUploads = () =>
    new Date(deps.now().getTime() - MESSAGING_LIMITS.unattachedUploadHours * HOUR);

  /** Stage one for ONE closed account: withdraw it, then mark what may go. */
  async function withdrawAndMark(accountId: string): Promise<Progress> {
    let removed = 0;
    let withdrawn = false;
    for (let round = 0; round < WITHDRAW_ROUNDS; round += 1) {
      const changed = await store.withdrawAccount(accountId, WITHDRAW_BATCH);
      removed += changed;
      if (changed === 0) {
        withdrawn = true;
        break;
      }
    }
    // Disposal decisions read participation; never make them mid-withdrawal.
    if (!withdrawn) return { removed, complete: false };

    // Keyset by conversation id: a retained conversation (evidence, or a
    // living other person) is passed over once, never re-read, so an account
    // with many of them is still walked to its end.
    let after: string | null = null;
    for (let page = 0; page < CANDIDATE_PAGES; page += 1) {
      const candidates: readonly DisposalCandidate[] = await store.disposalCandidates(
        accountId,
        after,
        MESSAGING_LIMITS.dispositionBatch,
      );
      if (candidates.length === 0) return { removed, complete: true };
      const open = candidates.filter((candidate) => !candidate.evidence);
      const asked = [...new Set(open.flatMap((candidate) => candidate.otherAccountIds))];
      const closed = new Set<string>();
      for (const batch of chunks(asked, IDENTITY_BATCH)) {
        for (const id of await deps.accounts.closedAccounts(batch)) closed.add(id);
      }
      const disposable = open.filter((candidate) =>
        candidate.otherAccountIds.every((id) => closed.has(id)),
      );
      for (const candidate of disposable)
        await store.beginDisposal(candidate.conversationId);
      if (candidates.length < MESSAGING_LIMITS.dispositionBatch)
        return { removed, complete: true };
      after = candidates[candidates.length - 1]?.conversationId ?? null;
    }
    // The page budget ran out with a full page last: more may remain.
    return { removed, complete: false };
  }

  /** One marked conversation, step by step, releasing its bytes when it asks. */
  async function disposeConversation(conversationId: string): Promise<Progress> {
    let removed = 0;
    for (let round = 0; round < STEP_ROUNDS; round += 1) {
      const step = await store.disposeStep(conversationId, STEP_BATCH);
      if (step === 'removed') return { removed: removed + 1, complete: true };
      if (step === 'awaiting-release') {
        const released = await releaseRounds({ conversationId, staleBefore: deps.now() });
        removed += released.removed;
        if (!released.complete || released.removed === 0)
          return { removed, complete: false };
      }
    }
    return { removed, complete: false };
  }

  /** Stage two: every conversation marked for disposal, bounded. */
  async function drain(): Promise<Progress> {
    const attempted = new Set<string>();
    let removed = 0;
    let complete = true;
    for (let page = 0; page < DISPOSING_PAGES; page += 1) {
      const marked = await store.disposing(DISPOSING_PAGE);
      if (marked.length === 0) return { removed, complete };
      const fresh = marked.filter((id) => !attempted.has(id));
      // Only conversations this run already could not finish: stop here.
      if (fresh.length === 0) return { removed, complete: false };
      for (const conversationId of fresh) {
        attempted.add(conversationId);
        const progress = await disposeConversation(conversationId);
        removed += progress.removed;
        if (!progress.complete) complete = false;
      }
      if (marked.length < DISPOSING_PAGE) return { removed, complete };
    }
    return { removed, complete: false };
  }

  const combine = (...parts: readonly Progress[]): MessagingDispositionProgress => ({
    removed: parts.reduce((total, part) => total + part.removed, 0),
    complete: parts.every((part) => part.complete),
  });

  return {
    /** The caller has proved `accountId` closed. */
    async disposeClosedAccount(accountId: string): Promise<MessagingDispositionProgress> {
      const marked = await withdrawAndMark(accountId);
      const drained = await drain();
      const released = await releaseRounds({
        conversationId: null,
        staleBefore: staleUploads(),
      });
      return combine(marked, drained, released);
    },

    async reconcile(): Promise<MessagingDispositionProgress> {
      const parts: Progress[] = [];
      let after: string | null = null;
      let exhausted = false;
      for (let page = 0; page < SWEEP_PAGES; page += 1) {
        const owners: readonly string[] = await store.accountsWithData(after, SWEEP_PAGE);
        if (owners.length === 0) {
          exhausted = true;
          break;
        }
        for (const batch of chunks(owners, IDENTITY_BATCH)) {
          for (const accountId of await deps.accounts.closedAccounts(batch)) {
            parts.push(await withdrawAndMark(accountId));
          }
        }
        after = owners[owners.length - 1] ?? null;
        if (owners.length < SWEEP_PAGE) {
          exhausted = true;
          break;
        }
      }
      parts.push({ removed: 0, complete: exhausted });
      parts.push(await drain());
      parts.push(
        await releaseRounds({ conversationId: null, staleBefore: staleUploads() }),
      );
      return combine(...parts);
    },

    async sweep(): Promise<number> {
      return (await releaseRounds({ conversationId: null, staleBefore: staleUploads() }))
        .removed;
    },
  };
}
