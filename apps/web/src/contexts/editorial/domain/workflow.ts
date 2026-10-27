import type {
  ArticleDetail,
  EditorialState,
  EventScheduleRefusal,
  WorkflowAction,
} from '@minhaj/contracts/editorial';

export type EditorialRefusalReason =
  | 'invalid'
  | 'denied'
  | 'conflict'
  | 'not-found'
  | 'duplicate-slug'
  | 'invalid-state'
  | 'self-approval'
  | 'approval-required'
  | 'unavailable'
  | EventScheduleRefusal;

/**
 * A declared field rather than a constructor parameter property: this module
 * is loaded by the migration tooling under plain Node, whose type stripping
 * cannot run parameter properties.
 */
export class EditorialRefusal extends Error {
  readonly reason: EditorialRefusalReason;

  constructor(reason: EditorialRefusalReason) {
    super(reason);
    this.reason = reason;
  }
}

export function workflowPermission(action: WorkflowAction): string {
  if (action === 'submit') return 'content.author';
  if (action === 'approve' || action === 'reject') return 'content.review';
  return 'content.publish';
}

export function assertTransition(
  record: ArticleDetail,
  action: WorkflowAction,
  actorId: string,
): EditorialState {
  if (action === 'archive' && record.state !== 'archived') return 'archived';
  if (action === 'submit' && record.state === 'draft') return 'in-review';
  if ((action === 'approve' || action === 'reject') && record.state === 'in-review') {
    if (
      action === 'approve' &&
      (record.creatorId === actorId || record.revision.editorId === actorId)
    ) {
      throw new EditorialRefusal('self-approval');
    }
    return action === 'reject' ? 'draft' : 'in-review';
  }
  if (action === 'cancel' && record.state === 'scheduled') return 'in-review';
  if (
    (action === 'publish' || action === 'schedule') &&
    ['in-review', 'scheduled'].includes(record.state)
  ) {
    if (
      record.approvedRevision !== record.currentRevision ||
      record.approvedById === null
    ) {
      throw new EditorialRefusal('approval-required');
    }
    return action === 'publish' ? 'published' : 'scheduled';
  }
  throw new EditorialRefusal('invalid-state');
}
