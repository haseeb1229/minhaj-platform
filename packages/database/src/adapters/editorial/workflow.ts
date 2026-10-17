import 'server-only';

import type { EditorialTransition } from '@minhaj/contracts/editorial';

/**
 * The editorial workflow's persistence rules, written ONCE for every aggregate
 * the workflow governs — Article, Page and the four News families.
 *
 * PURE. Nothing here holds a client, a delegate or a transaction: each function
 * turns a locked row and a command into the update that row may receive, or
 * refuses. The callers own their tables; the rules are shared, so "a stale
 * approval cannot publish" is one statement rather than six that agree today.
 */

export class EditorialDataError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(reason);
    this.reason = reason;
  }
}

export const limitOf = (n: number, max = 50) =>
  Math.max(1, Math.min(max, Math.trunc(n) || 1));
export const offsetOf = (n: number) =>
  Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.trunc(n) || 0));

/** Maps a database refusal onto the workflow's vocabulary; anything else rethrows. */
export function refuse(error: unknown): never {
  const code = (error as { code?: string })?.code;
  if (code === 'P2002') throw new EditorialDataError('duplicate-slug');
  if (code === 'P2034' || code === 'P2025') throw new EditorialDataError('conflict');
  if (code === 'P2003' || code === 'P2004') throw new EditorialDataError('invalid');
  throw error;
}

/** What every workflow-governed record carries, as the rules read it. */
export interface WorkflowRow {
  readonly state: string;
  readonly currentRevision: number | null;
  readonly creatorId: string;
  readonly approvedRevision: number | null;
  readonly approvedById: string | null;
  readonly scheduledRevision: number | null;
  readonly scheduledById: string | null;
  readonly scheduledAt: Date | null;
  readonly scheduleStatus: string | null;
  readonly publishedAt: Date | null;
  readonly current: { readonly editorId: string } | null;
}

export interface WorkflowUpdate {
  updatedAt: Date;
  state?: string;
  approvedRevision?: number | null;
  approvedById?: string | null;
  scheduleStatus?: string | null;
  publishedAt?: Date;
  scheduledAt?: Date;
  scheduledTimezone?: string;
  scheduledById?: string;
  scheduledRevision?: number | null;
}

/**
 * The update one workflow command makes to a row locked at its expected
 * version, or a refusal: approval of the exact current revision by someone
 * other than its creator or editor; publication and scheduling only of an
 * approved current revision; a scheduled execution only of the pending,
 * due schedule bound to that same revision and scheduler.
 */
export function transitionUpdate(
  row: WorkflowRow,
  input: EditorialTransition,
): WorkflowUpdate {
  const action = input.action;
  const data: WorkflowUpdate = { updatedAt: input.now };
  if (action === 'submit' && row.state === 'draft') data.state = 'in-review';
  else if ((action === 'approve' || action === 'reject') && row.state === 'in-review') {
    if (action === 'approve') {
      if (row.creatorId === input.actorId || row.current?.editorId === input.actorId)
        throw new EditorialDataError('self-approval');
      data.approvedRevision = row.currentRevision;
      data.approvedById = input.actorId;
    } else {
      data.state = 'draft';
      data.approvedRevision = null;
      data.approvedById = null;
    }
  } else if (action === 'archive' && row.state !== 'archived') {
    data.state = 'archived';
    data.scheduleStatus = row.scheduledAt ? 'cancelled' : null;
  } else if (action === 'cancel' && row.state === 'scheduled') {
    data.state = 'in-review';
    data.scheduleStatus = 'cancelled';
  } else if (
    (action === 'publish' || action === 'schedule') &&
    ['in-review', 'scheduled'].includes(row.state)
  ) {
    if (
      row.approvedRevision === null ||
      row.approvedRevision !== row.currentRevision ||
      !row.approvedById
    )
      throw new EditorialDataError('approval-required');
    if (
      input.scheduledExecution &&
      (row.state !== 'scheduled' ||
        row.scheduleStatus !== 'pending' ||
        row.scheduledRevision !== row.currentRevision ||
        !row.scheduledAt ||
        row.scheduledAt > input.now ||
        row.scheduledById !== input.actorId)
    )
      throw new EditorialDataError('conflict');
    if (action === 'publish') {
      data.state = 'published';
      data.publishedAt = row.publishedAt ?? input.now;
      data.scheduleStatus = row.scheduledAt ? 'completed' : null;
    } else {
      if (
        !input.scheduledAt ||
        !input.timezone ||
        new Date(input.scheduledAt) <= input.now
      )
        throw new EditorialDataError('invalid');
      data.state = 'scheduled';
      data.scheduledAt = new Date(input.scheduledAt);
      data.scheduledTimezone = input.timezone;
      data.scheduledById = input.actorId;
      data.scheduledRevision = row.currentRevision;
      data.scheduleStatus = 'pending';
    }
  } else throw new EditorialDataError('invalid-state');
  return data;
}

/**
 * What saving a new revision does to the workflow: back to draft, the published
 * representation withdrawn, approval cleared, and any schedule cancelled — so
 * newly edited content can never ride an old approval into publication.
 */
export function revisionReset(row: Pick<WorkflowRow, 'scheduledAt'>) {
  return {
    state: 'draft',
    approvedRevision: null,
    approvedById: null,
    scheduledRevision: null,
    scheduledAt: null,
    scheduledTimezone: null,
    scheduledById: null,
    scheduleStatus: row.scheduledAt ? 'cancelled' : null,
    updatedAt: new Date(),
  };
}

/** The live permission an audited workflow action was authorised by. */
export function authorisingSource(action: string, actorId: string | null): string {
  if (actorId === null) return 'editorial-scheduler';
  if (['approve', 'reject'].includes(action)) return 'content.review';
  if (['publish', 'schedule', 'cancel', 'archive'].includes(action))
    return 'content.publish';
  return 'content.author';
}
