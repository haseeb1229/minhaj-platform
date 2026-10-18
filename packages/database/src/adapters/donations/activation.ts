import 'server-only';

import type {
  DonationActivationAuthority,
  DonationActivationReaderPort,
} from '@minhaj/contracts/donations';

import { getDatabaseClient } from '../../client.ts';
import { refuse, scopeOf } from './shared.ts';

/**
 * The owner's fail-closed activation, read-only. The runtime holds SELECT and
 * nothing else on it; the row is written by the owner, is immutable (51342),
 * and its absence means no donation can begin. Whether the row PERMITS a
 * scope is the contract's `activationPermits`, asked by the caller — and
 * re-asked by the admission trigger beneath every donation insert.
 *
 * Who authorised it and their evidence are the owner's record; nothing of
 * them is returned.
 */
export function createDonationActivationReader(): DonationActivationReaderPort {
  const db = getDatabaseClient();

  return {
    async activation() {
      try {
        const row = await db.donationActivation.findFirst({
          where: { id: 1 },
          select: {
            provider: true,
            environment: true,
            accountKey: true,
            authority: true,
            activatedAt: true,
          },
        });
        if (row === null) return null;
        return {
          ...scopeOf(row),
          authority: row.authority as DonationActivationAuthority,
          activatedAt: row.activatedAt,
        };
      } catch (error) {
        refuse(error);
      }
    },
  };
}
