import type {
  ArticleDetail,
  EditorialState,
  WorkflowAction,
} from '@minhaj/contracts/editorial';

export class EditorialRefusal extends Error {
  constructor(
    readonly reason:
      | 'invalid'
      | 'denied'
      | 'conflict'
      | 'not-found'
      | 'duplicate-slug'
      | 'invalid-state'
      | 'self-approval'
      | 'approval-required'
      | 'unavailable',
  ) {
    super(reason);
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
