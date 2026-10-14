import 'server-only';

import { Prisma } from '@prisma/client';

import type { Locale } from '@minhaj/contracts';
import {
  NEWSLETTER_NOTICE_VERSION,
  NEWSLETTER_PURPOSE,
  maskEmail,
  type NewsletterAdminEntry,
  type NewsletterConsentEvent,
  type NewsletterConsentSource,
  type NewsletterPort,
  type NewsletterState,
} from '@minhaj/contracts/personalisation';

import { auditRow } from '../../audit-row.ts';
import { getDatabaseClient } from '../../client.ts';
import {
  PAGE,
  PersonalDataError,
  bounded,
  boundedOffset,
  iso,
  isUniqueViolation,
  maybeIso,
  refuse,
  type Client,
} from './shared.ts';

/**
 * The newsletter subscription — consent from an ADDRESS, not an account
 * (DOMAIN_MODEL.md §14.5). Nothing here reads or names a `User`.
 *
 * ONE ROW PER ADDRESS, keyed by its digest, so two concurrent submissions of
 * the same address serialise on that row and produce one subscriber.
 *
 * HASHES, NEVER TOKENS. Every link lookup is by the SHA-256 of what arrived;
 * the token itself is never stored, logged or returned.
 *
 * EVERY CHANGE LEAVES CONSENT EVIDENCE in the same transaction: purpose,
 * notice version, source, locale and instant (SECURITY_BASELINE.md §19.1).
 */

const EXPIRY_MAX = 200;

async function evidence(
  tx: Client,
  subscriberId: string,
  event: NewsletterConsentEvent,
  source: NewsletterConsentSource,
  locale: Locale | null,
  at: Date,
) {
  await tx.$executeRaw`
    INSERT INTO [dbo].[NewsletterConsentEvent]
      ([id], [subscriberId], [event], [purpose], [noticeVersion], [source], [locale], [occurredAt])
    VALUES
      (CONVERT(NVARCHAR(36), NEWID()), ${subscriberId}, ${event}, ${NEWSLETTER_PURPOSE},
       ${NEWSLETTER_NOTICE_VERSION}, ${source}, ${locale}, ${at})`;
}

interface SubscriberRow {
  readonly id: string;
  readonly state: NewsletterState;
  readonly generation: number;
  readonly version: number;
}

export function createNewsletter(): NewsletterPort {
  const db = getDatabaseClient();

  async function submitOnce(input: Parameters<NewsletterPort['submit']>[0]) {
    return db.$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<SubscriberRow[]>`
        SELECT [id], [state], [generation], [version]
        FROM [dbo].[NewsletterSubscriber] WITH (UPDLOCK, HOLDLOCK)
        WHERE [emailDigest] = ${input.emailDigest}`;

      // A confirmed subscription stays exactly as it is, and a suppressed one
      // cannot be revived by anybody typing the address in again.
      if (row !== undefined && (row.state === 'confirmed' || row.state === 'suppressed'))
        return { outcome: 'unchanged' as const };

      const id = row?.id ?? input.subscriberId;
      const generation = row === undefined ? 1 : Number(row.generation) + 1;
      const issue = input.issue(id, generation);

      if (row === undefined) {
        await tx.$executeRaw`
          INSERT INTO [dbo].[NewsletterSubscriber]
            ([id], [emailDigest], [digestKeyVersion], [email], [state], [locale], [generation],
             [confirmTokenHash], [confirmSalt], [confirmExpiresAt],
             [unsubscribeTokenHash], [unsubscribeSalt], [tokenKeyVersion],
             [submittedAt], [confirmedAt], [endedAt], [version], [updatedAt])
          VALUES
            (${id}, ${input.emailDigest}, ${input.digestKeyVersion}, ${input.email}, N'pending',
             ${input.locale}, 1, ${issue.confirmHash}, ${issue.confirmSalt}, ${issue.expiresAt},
             ${issue.unsubscribeHash}, ${issue.unsubscribeSalt}, ${issue.tokenKeyVersion},
             ${input.at}, NULL, NULL, 1, ${input.at})`;
      } else {
        // Pending, unsubscribed or lapsed: a NEW pair of links, so every link
        // issued before is dead, and the address must be confirmed again.
        await tx.$executeRaw`
          UPDATE [dbo].[NewsletterSubscriber]
          SET [email] = ${input.email}, [state] = N'pending', [locale] = ${input.locale},
              [generation] = ${generation},
              [confirmTokenHash] = ${issue.confirmHash}, [confirmSalt] = ${issue.confirmSalt},
              [confirmExpiresAt] = ${issue.expiresAt},
              [unsubscribeTokenHash] = ${issue.unsubscribeHash}, [unsubscribeSalt] = ${issue.unsubscribeSalt},
              [tokenKeyVersion] = ${issue.tokenKeyVersion},
              [submittedAt] = ${input.at}, [confirmedAt] = NULL, [endedAt] = NULL,
              [version] = ${Number(row.version) + 1}, [updatedAt] = ${input.at}
          WHERE [id] = ${id}`;
      }
      await evidence(tx, id, 'submitted', 'newsletter-page', input.locale, input.at);
      return { outcome: 'issued' as const, subscriberId: id, generation };
    });
  }

  return {
    async submit(input) {
      try {
        try {
          return await submitOnce(input);
        } catch (error) {
          // Two first submissions of one address: the loser re-reads the row
          // the winner created and answers from it.
          if (!isUniqueViolation(error)) throw error;
          return await submitOnce(input);
        }
      } catch (error) {
        refuse(error);
      }
    },

    async deliverySource(subscriberId, generation) {
      try {
        const [row] = await db.$queryRaw<
          {
            id: string;
            email: string;
            locale: string;
            confirmSalt: string;
            unsubscribeSalt: string;
            tokenKeyVersion: number;
            confirmExpiresAt: Date;
          }[]
        >`
          SELECT [id], [email], [locale], [confirmSalt], [unsubscribeSalt], [tokenKeyVersion], [confirmExpiresAt]
          FROM [dbo].[NewsletterSubscriber]
          WHERE [id] = ${subscriberId} AND [generation] = ${generation} AND [state] = N'pending'
            AND [confirmExpiresAt] > SYSUTCDATETIME()`;
        if (row === undefined) return null;
        return {
          subscriberId: row.id,
          email: row.email,
          locale: row.locale as Locale,
          confirmSalt: row.confirmSalt,
          unsubscribeSalt: row.unsubscribeSalt,
          tokenKeyVersion: Number(row.tokenKeyVersion),
          expiresAt: row.confirmExpiresAt,
        };
      } catch (error) {
        refuse(error);
      }
    },

    async linkIsCurrent(purpose, tokenHash, at) {
      try {
        const rows =
          purpose === 'confirm'
            ? await db.$queryRaw<{ one: number }[]>`
                SELECT 1 AS [one] FROM [dbo].[NewsletterSubscriber]
                WHERE [confirmTokenHash] = ${tokenHash} AND [state] = N'pending' AND [confirmExpiresAt] > ${at}`
            : await db.$queryRaw<{ one: number }[]>`
                SELECT 1 AS [one] FROM [dbo].[NewsletterSubscriber]
                WHERE [unsubscribeTokenHash] = ${tokenHash}
                  AND [state] IN (N'pending', N'confirmed', N'unsubscribed')`;
        return rows.length > 0;
      } catch (error) {
        refuse(error);
      }
    },

    async confirmationAddress(tokenHash, at) {
      try {
        const [row] = await db.$queryRaw<{ email: string }[]>`
          SELECT [email] FROM [dbo].[NewsletterSubscriber]
          WHERE [confirmTokenHash] = ${tokenHash} AND [state] = N'pending' AND [confirmExpiresAt] > ${at}`;
        return row?.email ?? null;
      } catch (error) {
        refuse(error);
      }
    },

    async confirm(tokenHash, at) {
      try {
        return await db.$transaction(async (tx) => {
          // The predicate IS the check: a replayed, expired or rotated link
          // matches nothing, and two confirmations of one link cannot both
          // match, because the first clears the hash the second looks for.
          const confirmed = await tx.$queryRaw<{ id: string; locale: string }[]>`
            UPDATE [dbo].[NewsletterSubscriber]
            SET [state] = N'confirmed', [confirmTokenHash] = NULL, [confirmSalt] = NULL,
                [confirmExpiresAt] = NULL, [confirmedAt] = ${at},
                [version] = [version] + 1, [updatedAt] = ${at}
            OUTPUT inserted.[id], inserted.[locale]
            WHERE [confirmTokenHash] = ${tokenHash} AND [state] = N'pending' AND [confirmExpiresAt] > ${at}`;
          const row = confirmed[0];
          if (row === undefined) return false;
          await evidence(tx, row.id, 'confirmed', 'email-link', row.locale as Locale, at);
          return true;
        });
      } catch (error) {
        refuse(error);
      }
    },

    async unsubscribe(tokenHash, at) {
      try {
        return await db.$transaction(async (tx) => {
          const [row] = await tx.$queryRaw<
            { id: string; state: NewsletterState; locale: string }[]
          >`
            SELECT [id], [state], [locale] FROM [dbo].[NewsletterSubscriber] WITH (UPDLOCK, HOLDLOCK)
            WHERE [unsubscribeTokenHash] = ${tokenHash}`;
          if (row === undefined) return false;
          // Already unsubscribed by this very link: the answer is the same and
          // nothing changes.
          if (row.state === 'unsubscribed') return true;
          if (row.state !== 'pending' && row.state !== 'confirmed') return false;
          // The address goes: an unsubscribed record keeps only its digest, and
          // the hash this link carries, so a second click answers the same.
          await tx.$executeRaw`
            UPDATE [dbo].[NewsletterSubscriber]
            SET [state] = N'unsubscribed', [email] = NULL,
                [confirmTokenHash] = NULL, [confirmSalt] = NULL, [confirmExpiresAt] = NULL,
                [unsubscribeSalt] = NULL, [tokenKeyVersion] = NULL,
                [endedAt] = ${at}, [version] = [version] + 1, [updatedAt] = ${at}
            WHERE [id] = ${row.id}`;
          await evidence(
            tx,
            row.id,
            'unsubscribed',
            'email-link',
            row.locale as Locale,
            at,
          );
          return true;
        });
      } catch (error) {
        refuse(error);
      }
    },

    async expireLapsed(at, limit) {
      try {
        return await db.$transaction(async (tx) => {
          const lapsed = await tx.$queryRaw<{ id: string }[]>`
            UPDATE TOP (${bounded(limit, EXPIRY_MAX)}) [dbo].[NewsletterSubscriber]
            SET [state] = N'expired', [email] = NULL,
                [confirmTokenHash] = NULL, [confirmSalt] = NULL, [confirmExpiresAt] = NULL,
                [unsubscribeTokenHash] = NULL, [unsubscribeSalt] = NULL, [tokenKeyVersion] = NULL,
                [endedAt] = ${at}, [version] = [version] + 1, [updatedAt] = ${at}
            OUTPUT inserted.[id]
            WHERE [state] = N'pending' AND [confirmExpiresAt] <= ${at}`;
          for (const row of lapsed)
            await evidence(tx, row.id, 'expired', 'system', null, at);
          return lapsed.length;
        });
      } catch (error) {
        refuse(error);
      }
    },

    async counts() {
      try {
        const rows = await db.$queryRaw<{ state: NewsletterState; total: number }[]>`
          SELECT [state], COUNT(*) AS [total] FROM [dbo].[NewsletterSubscriber] GROUP BY [state]`;
        const of = (state: NewsletterState) =>
          Number(rows.find((row) => row.state === state)?.total ?? 0);
        return {
          pending: of('pending'),
          confirmed: of('confirmed'),
          unsubscribed: of('unsubscribed'),
          expired: of('expired'),
          suppressed: of('suppressed'),
        };
      } catch (error) {
        refuse(error);
      }
    },

    async list(state, offset) {
      try {
        const skip = boundedOffset(offset);
        const filter =
          state === null ? Prisma.sql`1 = 1` : Prisma.sql`[state] = ${state}`;
        const [counted, rows] = await Promise.all([
          db.$queryRaw<{ total: number }[]>`
            SELECT COUNT(*) AS [total] FROM [dbo].[NewsletterSubscriber] WHERE ${filter}`,
          db.$queryRaw<
            {
              id: string;
              email: string | null;
              state: NewsletterState;
              locale: string;
              submittedAt: Date;
              confirmedAt: Date | null;
              endedAt: Date | null;
              version: number;
            }[]
          >`
            SELECT [id], [email], [state], [locale], [submittedAt], [confirmedAt], [endedAt], [version]
            FROM [dbo].[NewsletterSubscriber]
            WHERE ${filter}
            ORDER BY [submittedAt] DESC, [id]
            OFFSET ${skip} ROWS FETCH NEXT ${PAGE} ROWS ONLY`,
        ]);
        return {
          // The address never leaves this adapter in full: an operator sees
          // its first character and its domain.
          items: rows.map((row): NewsletterAdminEntry => ({
            id: row.id,
            maskedEmail: row.email === null ? null : maskEmail(row.email),
            state: row.state,
            locale: row.locale as Locale,
            submittedAt: iso(row.submittedAt),
            confirmedAt: maybeIso(row.confirmedAt),
            endedAt: maybeIso(row.endedAt),
            version: Number(row.version),
          })),
          total: Number(counted[0]?.total ?? 0),
          offset: skip,
        };
      } catch (error) {
        refuse(error);
      }
    },

    async suppress(actorId, value, at) {
      try {
        await db.$transaction(async (tx) => {
          const changed = await tx.$queryRaw<{ id: string; previous: NewsletterState }[]>`
            UPDATE [dbo].[NewsletterSubscriber]
            SET [state] = N'suppressed', [email] = NULL,
                [confirmTokenHash] = NULL, [confirmSalt] = NULL, [confirmExpiresAt] = NULL,
                [unsubscribeTokenHash] = NULL, [unsubscribeSalt] = NULL, [tokenKeyVersion] = NULL,
                [endedAt] = ${at}, [version] = [version] + 1, [updatedAt] = ${at}
            OUTPUT inserted.[id], deleted.[state] AS [previous]
            WHERE [id] = ${value.subscriberId} AND [version] = ${value.expectedVersion}
              AND [state] <> N'suppressed'`;
          const row = changed[0];
          if (row === undefined) await explainMiss(tx, value.subscriberId, 'suppressed');
          else {
            await evidence(tx, row.id, 'suppressed', 'operator', null, at);
            await tx.auditLog.create({
              data: auditRow({
                actorType: 'user',
                actorId,
                action: 'newsletter.subscriber.suppressed',
                targetType: 'newsletter-subscriber',
                targetId: row.id,
                before: { state: row.previous },
                after: { state: 'suppressed' },
                authorisingSource: 'newsletter.operate',
              }),
            });
          }
        });
      } catch (error) {
        refuse(error);
      }
    },

    async reinstate(actorId, value, at) {
      try {
        await db.$transaction(async (tx) => {
          // Back to `unsubscribed`, never to `confirmed`: lifting a suppression
          // grants nothing, and the address must opt in afresh to receive mail.
          const changed = await tx.$queryRaw<{ id: string }[]>`
            UPDATE [dbo].[NewsletterSubscriber]
            SET [state] = N'unsubscribed', [version] = [version] + 1, [updatedAt] = ${at}
            OUTPUT inserted.[id]
            WHERE [id] = ${value.subscriberId} AND [version] = ${value.expectedVersion}
              AND [state] = N'suppressed'`;
          const row = changed[0];
          if (row === undefined)
            await explainMiss(tx, value.subscriberId, 'not-suppressed');
          else {
            await evidence(tx, row.id, 'reinstated', 'operator', null, at);
            await tx.auditLog.create({
              data: auditRow({
                actorType: 'user',
                actorId,
                action: 'newsletter.subscriber.reinstated',
                targetType: 'newsletter-subscriber',
                targetId: row.id,
                before: { state: 'suppressed' },
                after: { state: 'unsubscribed' },
                authorisingSource: 'newsletter.operate',
              }),
            });
          }
        });
      } catch (error) {
        refuse(error);
      }
    },
  };
}

/** Why an operator's change matched nothing: missing, stale, or the wrong state. */
async function explainMiss(
  tx: Client,
  subscriberId: string,
  wrongState: 'suppressed' | 'not-suppressed',
): Promise<never> {
  const [row] = await tx.$queryRaw<{ state: NewsletterState }[]>`
    SELECT [state] FROM [dbo].[NewsletterSubscriber] WHERE [id] = ${subscriberId}`;
  if (row === undefined) throw new PersonalDataError('not-found');
  const suppressed = row.state === 'suppressed';
  if ((wrongState === 'suppressed') === suppressed)
    throw new PersonalDataError('invalid-state');
  throw new PersonalDataError('conflict');
}
