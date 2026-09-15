import 'server-only';

import { AsyncLocalStorage } from 'node:async_hooks';

import type { Prisma, PrismaClient } from '@prisma/client';

export type SecurityMutationKind = 'password-reset' | 'password-change' | 'email-change';

interface SecurityMutationContext {
  readonly operationId: string;
  readonly accountId: string;
  readonly kind: SecurityMutationKind;
}

const mutationContext = new AsyncLocalStorage<SecurityMutationContext>();

/**
 * Carries only an opaque operation id through one private Better Auth call.
 * Passwords, hashes, tokens and addresses never enter this context or its row.
 */
export function withSecurityMutation<T>(
  context: SecurityMutationContext,
  operation: () => Promise<T>,
): Promise<T> {
  return mutationContext.run(context, operation);
}

function securityMutationError(): Error {
  return new Error('Identity security mutation was not backed by an active operation.');
}

function methodOrValue(target: object, property: PropertyKey): unknown {
  const value = Reflect.get(target, property, target);
  return typeof value === 'function' ? value.bind(target) : value;
}

/**
 * A private, narrow wrapper around the Prisma client handed to Better Auth.
 *
 * Better Auth 1.7.4 performs credential changes through `Account.update` and
 * verified address changes through `User.update`. This wrapper stamps the
 * exact prepared Identity operation in the same Prisma transaction as that
 * authoritative write. It exposes no client or transaction outside this
 * adapter and changes no unrelated Better Auth CRUD behavior.
 */
export function createReconciledAuthClient(prisma: PrismaClient): PrismaClient {
  const account = new Proxy(prisma.account, {
    get(target, property) {
      if (property === 'updateMany') {
        return async (args: Prisma.AccountUpdateManyArgs) => {
          const changesPassword = Object.prototype.hasOwnProperty.call(
            args.data,
            'password',
          );
          if (!changesPassword) return prisma.account.updateMany(args);

          const operation = mutationContext.getStore();
          if (operation?.kind !== 'password-reset') throw securityMutationError();

          return prisma.$transaction(async (tx) => {
            const stamped = await tx.identitySecurityOperation.updateMany({
              where: {
                id: operation.operationId,
                userId: operation.accountId,
                kind: 'password-reset',
                committedAt: null,
                cancelledAt: null,
              },
              data: { committedAt: new Date() },
            });
            if (stamped.count !== 1) throw securityMutationError();

            const updated = await tx.account.updateMany({
              ...args,
              where: {
                AND: [args.where ?? {}, { userId: operation.accountId }],
              },
            });
            if (updated.count !== 1) throw securityMutationError();
            return updated;
          });
        };
      }

      if (property !== 'update') return methodOrValue(target, property);

      return async (args: Prisma.AccountUpdateArgs) => {
        const changesPassword = Object.prototype.hasOwnProperty.call(
          args.data,
          'password',
        );
        if (!changesPassword) return prisma.account.update(args);

        const operation = mutationContext.getStore();
        if (
          operation === undefined ||
          (operation.kind !== 'password-reset' && operation.kind !== 'password-change')
        ) {
          throw securityMutationError();
        }

        return prisma.$transaction(async (tx) => {
          const stamped = await tx.identitySecurityOperation.updateMany({
            where: {
              id: operation.operationId,
              userId: operation.accountId,
              kind: operation.kind,
              committedAt: null,
              cancelledAt: null,
            },
            data: { committedAt: new Date() },
          });
          if (stamped.count !== 1) throw securityMutationError();

          const credential = await tx.account.findUnique({
            where: args.where,
            select: { userId: true },
          });
          if (credential?.userId !== operation.accountId) {
            throw securityMutationError();
          }

          return tx.account.update(args);
        });
      };
    },
  });

  const user = new Proxy(prisma.user, {
    get(target, property) {
      if (property !== 'update') return methodOrValue(target, property);

      return async (args: Prisma.UserUpdateArgs) => {
        const changesEmail = Object.prototype.hasOwnProperty.call(args.data, 'email');
        if (!changesEmail) return prisma.user.update(args);

        const operation = mutationContext.getStore();
        if (operation?.kind !== 'email-change') {
          const unchangedEmail = args.data.email;
          if (typeof unchangedEmail !== 'string') throw securityMutationError();

          // Better Auth's verification path writes the full user projection,
          // including the address it already has. Permit that only while the
          // address is still exactly equal; the extra predicate makes a
          // concurrent real change fail rather than silently reverting it.
          return prisma.$transaction(async (tx) => {
            const current = await tx.user.findUnique({
              where: args.where,
              select: { email: true },
            });
            if (current?.email !== unchangedEmail) throw securityMutationError();
            return tx.user.update({
              ...args,
              where: {
                ...args.where,
                email: unchangedEmail,
              } as Prisma.UserWhereUniqueInput,
            });
          });
        }

        return prisma.$transaction(async (tx) => {
          const stamped = await tx.identitySecurityOperation.updateMany({
            where: {
              id: operation.operationId,
              userId: operation.accountId,
              kind: operation.kind,
              committedAt: null,
              cancelledAt: null,
            },
            data: { committedAt: new Date() },
          });
          if (stamped.count !== 1) throw securityMutationError();

          const current = await tx.user.findUnique({
            where: args.where,
            select: { id: true, status: true },
          });
          if (current?.id !== operation.accountId || current.status !== 'active') {
            throw securityMutationError();
          }

          return tx.user.update(args);
        });
      };
    },
  });

  const session = new Proxy(prisma.session, {
    get(target, property) {
      if (property !== 'create') return methodOrValue(target, property);

      return async (args: Prisma.SessionCreateArgs) => {
        const operation = mutationContext.getStore();
        if (operation?.kind !== 'password-change') return prisma.session.create(args);

        const sessionId = args.data.id;
        const userId = args.data.userId;
        if (typeof sessionId !== 'string' || userId !== operation.accountId) {
          throw securityMutationError();
        }

        return prisma.$transaction(async (tx) => {
          const recorded = await tx.identitySecurityOperation.updateMany({
            where: {
              id: operation.operationId,
              userId: operation.accountId,
              kind: 'password-change',
              committedAt: { not: null },
              cancelledAt: null,
              completedAt: null,
            },
            data: { replacementSessionId: sessionId },
          });
          if (recorded.count !== 1) throw securityMutationError();

          const owner = await tx.user.findUnique({
            where: { id: operation.accountId },
            select: { status: true },
          });
          if (owner?.status !== 'active') throw securityMutationError();

          return tx.session.create(args);
        });
      };
    },
  });

  return new Proxy(prisma, {
    get(target, property) {
      if (property === 'account') return account;
      if (property === 'user') return user;
      if (property === 'session') return session;
      return methodOrValue(target, property);
    },
  }) as PrismaClient;
}
