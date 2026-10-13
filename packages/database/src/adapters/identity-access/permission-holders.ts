import 'server-only';

import { getDatabaseClient } from '../../client.ts';

/**
 * Who holds one permission NOW, by human name — Identity's answer to "whom may
 * this be assigned to?".
 *
 * It exists so a workflow that hands work to a CURRENT holder of a key (Fatwa
 * triage assigning a question to a `fatwa.answer` holder) can offer real
 * choices by name, without that context reading Identity's tables itself. It
 * DECIDES nothing: the assigning procedure re-checks the chosen account's live
 * assignment in SQL, so a stale list can never make an assignment legal.
 *
 * LIVE, like every authority read: an unrevoked assignment of an active role
 * carrying the key, held by an active account. Ordered by name, then id, so
 * the list is total and repeatable; bounded, because it is a picker.
 */

/** The most holders one answer lists. */
const MAX_HOLDERS = 200;

export interface PermissionHolder {
  readonly accountId: string;
  readonly name: string;
}

export interface PermissionHolderReader {
  holders(permission: string, limit: number): Promise<readonly PermissionHolder[]>;
}

export function createPermissionHolderReader(): PermissionHolderReader {
  const prisma = getDatabaseClient();

  return {
    async holders(permission, limit) {
      const take = Math.min(MAX_HOLDERS, Math.max(1, Math.trunc(limit) || 1));
      const rows = await prisma.user.findMany({
        where: {
          status: 'active',
          roleAssignments: {
            some: {
              revokedAt: null,
              role: {
                deactivatedAt: null,
                permissions: { some: { permissionKey: permission } },
              },
            },
          },
        },
        select: { id: true, name: true },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        take,
      });
      return rows.map((row) => ({ accountId: row.id, name: row.name }));
    },
  };
}
