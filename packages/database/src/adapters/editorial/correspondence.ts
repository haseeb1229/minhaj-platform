import 'server-only';
import { randomUUID } from 'node:crypto';
import type {
  CorrespondencePersistencePort,
  CorrespondenceState,
  ContactInquiryView,
  FeedbackView,
} from '@minhaj/contracts/editorial';
import { getDatabaseClient } from '../../client.ts';
import { auditRow } from '../../audit-row.ts';
const nextStates: Record<CorrespondenceState, readonly CorrespondenceState[]> = {
  submitted: ['triaged', 'spam'],
  triaged: ['in-progress', 'closed', 'spam'],
  'in-progress': ['resolved', 'closed', 'spam'],
  resolved: ['closed', 'triaged'],
  closed: ['triaged'],
  spam: ['triaged', 'closed'],
};
export function createCorrespondencePersistence(): CorrespondencePersistencePort {
  return {
    async submitContact(input) {
      await getDatabaseClient().contactInquiry.create({
        data: {
          ...input,
          id: randomUUID(),
          state: 'submitted',
          version: 1,
          note: '',
          updatedAt: new Date(),
        },
      });
    },
    async contacts(offset, state) {
      const rows = await getDatabaseClient().contactInquiry.findMany({
        where: { ...(state ? { state } : {}), retainUntil: { gt: new Date() } },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: Math.max(0, Math.min(10000000, Math.trunc(offset) || 0)),
        take: 26,
      });
      return {
        items: rows.slice(0, 25).map((row) => ({
          ...row,
          state: row.state as CorrespondenceState,
        })) as ContactInquiryView[],
        more: rows.length > 25,
      };
    },
    async triageContact(input) {
      return getDatabaseClient().$transaction(async (tx) => {
        const row = await tx.contactInquiry.findUnique({ where: { id: input.id } });
        if (
          !row ||
          row.version !== input.expectedVersion ||
          row.retainUntil <= new Date()
        )
          throw Object.assign(new Error('conflict'), { reason: 'conflict' });
        if (
          row.state !== input.state &&
          !nextStates[row.state as CorrespondenceState].includes(input.state)
        )
          throw Object.assign(new Error('invalid-state'), { reason: 'invalid-state' });
        const changed = await tx.contactInquiry.updateMany({
          where: {
            id: input.id,
            version: input.expectedVersion,
            retainUntil: { gt: new Date() },
          },
          data: {
            state: input.state,
            note: input.note,
            version: { increment: 1 },
            updatedAt: new Date(),
          },
        });
        if (changed.count !== 1)
          throw Object.assign(new Error('conflict'), { reason: 'conflict' });
        await tx.auditLog.create({
          data: auditRow({
            actorType: 'user',
            actorId: input.actorId,
            action: 'editorial.contact.triaged',
            targetType: 'contact',
            targetId: input.id,
            authorisingSource: 'correspondence.administer',
            before: { state: row.state },
            after: { state: input.state },
          }),
        });
        return {
          ...(await tx.contactInquiry.findUniqueOrThrow({ where: { id: input.id } })),
          state: input.state,
        } as ContactInquiryView;
      });
    },
    async submitFeedback(input) {
      await getDatabaseClient().feedback.create({
        data: {
          ...input,
          id: randomUUID(),
          state: 'submitted',
          version: 1,
          note: '',
          updatedAt: new Date(),
        },
      });
    },
    async feedback(offset, state) {
      const rows = await getDatabaseClient().feedback.findMany({
        where: { ...(state ? { state } : {}), retainUntil: { gt: new Date() } },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: Math.max(0, Math.min(10000000, Math.trunc(offset) || 0)),
        take: 26,
      });
      return {
        items: rows.slice(0, 25).map((row) => ({
          ...row,
          state: row.state as CorrespondenceState,
        })) as FeedbackView[],
        more: rows.length > 25,
      };
    },
    async triageFeedback(input) {
      return getDatabaseClient().$transaction(async (tx) => {
        const row = await tx.feedback.findUnique({ where: { id: input.id } });
        if (
          !row ||
          row.version !== input.expectedVersion ||
          row.retainUntil <= new Date()
        )
          throw Object.assign(new Error('conflict'), { reason: 'conflict' });
        if (
          row.state !== input.state &&
          !nextStates[row.state as CorrespondenceState].includes(input.state)
        )
          throw Object.assign(new Error('invalid-state'), { reason: 'invalid-state' });
        const changed = await tx.feedback.updateMany({
          where: {
            id: input.id,
            version: input.expectedVersion,
            retainUntil: { gt: new Date() },
          },
          data: {
            state: input.state,
            note: input.note,
            version: { increment: 1 },
            updatedAt: new Date(),
          },
        });
        if (changed.count !== 1)
          throw Object.assign(new Error('conflict'), { reason: 'conflict' });
        await tx.auditLog.create({
          data: auditRow({
            actorType: 'user',
            actorId: input.actorId,
            action: 'editorial.feedback.triaged',
            targetType: 'feedback',
            targetId: input.id,
            authorisingSource: 'correspondence.administer',
            before: { state: row.state },
            after: { state: input.state },
          }),
        });
        return {
          ...(await tx.feedback.findUniqueOrThrow({ where: { id: input.id } })),
          state: input.state,
        } as FeedbackView;
      });
    },
    async purgeExpired(now, limit) {
      const cap = Math.max(1, Math.min(50, Math.trunc(limit) || 1));
      return getDatabaseClient().$transaction(async (tx) => {
        let count = 0;
        {
          const rows = await tx.contactInquiry.findMany({
            where: { retainUntil: { lte: now } },
            select: { id: true },
            orderBy: [{ retainUntil: 'asc' }, { id: 'asc' }],
            take: cap,
          });
          for (const row of rows) {
            const deleted = await tx.contactInquiry.deleteMany({
              where: { id: row.id, retainUntil: { lte: now } },
            });
            if (deleted.count) {
              count++;
              await tx.auditLog.create({
                data: auditRow({
                  actorType: 'system',
                  actorId: null,
                  action: 'editorial.contact.retention-purged',
                  targetType: 'contact',
                  targetId: row.id,
                  authorisingSource: 'stored-retention-deadline',
                }),
              });
            }
          }
        }
        {
          const rows = await tx.feedback.findMany({
            where: { retainUntil: { lte: now } },
            select: { id: true },
            orderBy: [{ retainUntil: 'asc' }, { id: 'asc' }],
            take: cap,
          });
          for (const row of rows) {
            const deleted = await tx.feedback.deleteMany({
              where: { id: row.id, retainUntil: { lte: now } },
            });
            if (deleted.count) {
              count++;
              await tx.auditLog.create({
                data: auditRow({
                  actorType: 'system',
                  actorId: null,
                  action: 'editorial.feedback.retention-purged',
                  targetType: 'feedback',
                  targetId: row.id,
                  authorisingSource: 'stored-retention-deadline',
                }),
              });
            }
          }
        }
        return count;
      });
    },
  };
}
