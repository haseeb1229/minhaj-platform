import 'server-only';

import type { MessagingPersistencePort } from '@minhaj/contracts/messaging';

import { attachmentPart } from './attachments.ts';
import { conversationPart } from './conversations.ts';
import { dispositionPart } from './disposition.ts';
import { messagePart } from './messages.ts';
import { moderationPart } from './moderation.ts';

/**
 * Messaging's persistence port, assembled from its halves. Each half is one
 * concern of the same context — conversations and blocks, messages,
 * attachments, support and moderation, export and disposition — over the
 * same private client, which each takes for itself; none is reachable on its own.
 */
export function createMessagingPersistence(): MessagingPersistencePort {
  return {
    ...conversationPart(),
    ...messagePart(),
    ...attachmentPart(),
    ...moderationPart(),
    ...dispositionPart(),
  };
}
