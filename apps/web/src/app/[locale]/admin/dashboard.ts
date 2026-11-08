import 'server-only';

import { editorialKindSchema } from '@minhaj/contracts/editorial';
import type { PermissionKey } from '@minhaj/contracts/identity';

import { appLogger } from '@/composition/logging';
import { donationsRuntime } from '@/composition/donations';
import { editorialRuntime } from '@/composition/editorial';
import { fatwaRuntime } from '@/composition/fatwa';
import { learningRuntime } from '@/composition/learning';
import { membershipRuntime } from '@/composition/membership';
import { messagingRuntime } from '@/composition/messaging';
import { migrationRuntime } from '@/composition/migration';

/**
 * THE ADMINISTRATION DASHBOARD'S QUEUES (R2, audit F28) — how much work is
 * waiting, per area, for the areas the viewer can act in.
 *
 * EACH COUNT IS ITS OWNER'S. Every number comes from the owning context's own
 * public service — an existing bounded listing's total, or a count method the
 * context added for exactly this (Membership's open applications, Donations'
 * attention flags) — so the dashboard holds no database capability and reads
 * nothing another context's service would not hand an operator anyway. Each
 * service re-checks the viewer's key live; the permission listed here only
 * decides whether to ASK, so nobody sees a card for a queue they cannot open.
 *
 * NOTHING HERE IS AN AUDITED ACCESS. Reads that name people are audited by
 * their owners when listed; the dashboard asks only for numbers, never for
 * the rows, so opening the dashboard does not write an access record per
 * queue. (Messaging's and Fatwa's queue listings are unaudited summaries, and
 * only their counts are kept.)
 *
 * A FAILED READ IS SAID, NOT HIDDEN. One area being unavailable leaves its card
 * reading "unavailable" while the others still count.
 */

export const QUEUE_KEYS = [
  'editorialReview',
  'migrationStaged',
  'migrationManifests',
  'membershipApplications',
  'messagingReports',
  'messagingSupport',
  'donationsAttention',
  'fatwaIntake',
  'fatwaReview',
  'learningTrials',
] as const;

export type QueueKey = (typeof QUEUE_KEYS)[number];

/** A count, and whether more exist than the read counted. */
export interface QueueCount {
  readonly count: number;
  readonly more: boolean;
}

interface QueueSource {
  readonly key: QueueKey;
  readonly permission: PermissionKey;
  /** The queue's own page, below `/{locale}/admin/`, already filtered. */
  readonly path: string;
  readonly load: (actor: { readonly accountId: string }) => Promise<QueueCount>;
}

const exact = (count: number): QueueCount => ({ count, more: false });

const SOURCES: readonly QueueSource[] = [
  {
    key: 'editorialReview',
    permission: 'content.review',
    path: 'editorial/queue',
    // One bounded page per kind; a full page with more behind it reads "25+".
    load: async (actor) => {
      const pages = await Promise.all(
        editorialKindSchema.options.map((kind) =>
          editorialRuntime().editorial.directory(actor, kind, 0, 'in-review'),
        ),
      );
      return {
        count: pages.reduce((sum, page) => sum + page.items.length, 0),
        more: pages.some((page) => page.more),
      };
    },
  },
  {
    key: 'migrationStaged',
    permission: 'migration.read',
    path: 'migration/staging?review=pending',
    load: async (actor) =>
      exact((await migrationRuntime().read.staged(actor, { review: 'pending' })).total),
  },
  {
    key: 'migrationManifests',
    permission: 'migration.read',
    path: 'migration/manifests?state=draft',
    load: async (actor) =>
      exact((await migrationRuntime().read.manifests(actor, { state: 'draft' })).total),
  },
  {
    key: 'membershipApplications',
    permission: 'membership.read',
    path: 'membership/applications',
    load: async (actor) =>
      exact(await membershipRuntime().admin.openApplicationCount(actor)),
  },
  {
    key: 'messagingReports',
    permission: 'messaging.moderate',
    path: 'messaging/reports',
    load: async (actor) => {
      const page = await messagingRuntime().service.reports(actor, {
        state: 'open',
        cursor: null,
      });
      return { count: page.reports.length, more: page.next !== null };
    },
  },
  {
    key: 'messagingSupport',
    permission: 'messaging.support',
    path: 'messaging/support',
    load: async (actor) => {
      const page = await messagingRuntime().service.supportQueue(actor, {
        state: 'open',
        cursor: null,
      });
      return { count: page.items.length, more: page.next !== null };
    },
  },
  {
    key: 'donationsAttention',
    permission: 'donations.read',
    path: 'donations?attention=1',
    load: async (actor) => exact(await donationsRuntime().admin.attentionCount(actor)),
  },
  {
    key: 'fatwaIntake',
    permission: 'question.receive',
    path: 'fatwa/questions',
    load: async (actor) => exact((await fatwaRuntime().workflow.intake(actor, 0)).total),
  },
  {
    key: 'fatwaReview',
    permission: 'fatwa.publish',
    path: 'fatwa/review',
    load: async (actor) =>
      exact((await fatwaRuntime().workflow.reviewQueue(actor, 0)).total),
  },
  {
    key: 'learningTrials',
    permission: 'learning.read',
    path: 'learning/trials',
    load: async (actor) => {
      const page = await learningRuntime().learning.trialSummary(actor, 0);
      return {
        count: page.items.reduce((sum, item) => sum + item.requests, 0),
        more: page.hasMore,
      };
    },
  },
];

export interface QueueCard {
  readonly key: QueueKey;
  readonly path: string;
  /** `null` when the owning service could not answer. */
  readonly count: QueueCount | null;
}

/** The queues `held` opens, in the list's order, each counted by its owner. */
export async function dashboardQueues(
  actor: { readonly accountId: string },
  held: ReadonlySet<string>,
): Promise<readonly QueueCard[]> {
  return Promise.all(
    SOURCES.filter((source) => held.has(source.permission)).map(async (source) => {
      try {
        return { key: source.key, path: source.path, count: await source.load(actor) };
      } catch {
        appLogger().warn({ queue: source.key }, 'Dashboard queue count failed.');
        return { key: source.key, path: source.path, count: null };
      }
    }),
  );
}
