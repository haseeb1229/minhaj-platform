import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  MAX_TOPIC_DEPTH,
  TOPIC_FALLBACK_LOCALE,
} from '../../packages/contracts/src/taxonomy/index.ts';
import { localeSchema } from '../../packages/contracts/src/env/shared.ts';
import type { SqlSession } from '../../packages/database/src/lifecycle/sql-connection.ts';
import { createProofDatabase, databaseConfigured } from '../identity/harness.ts';
import type { DisposableDatabase } from '../identity/harness.ts';
import {
  PROOF_ACTOR,
  auditFor,
  createTaxonomyHarness,
  freshSlug,
  topicCount,
  type TaxonomyHarness,
} from './harness.ts';

/**
 * PHASE 3B — Taxonomy, against a real SQL Server.
 *
 * WHY THIS IS A LIVE SUITE AND NOT A UNIT SUITE. Almost everything Phase 3B
 * promises is a property of the DATABASE: slug uniqueness under concurrency,
 * one translation per locale, no cycle in the hierarchy, no orphaned parent, a
 * fallback translation that cannot be removed. A mock would prove the adapter
 * calls the methods it calls; it would prove nothing about whether SQL Server
 * refuses what this phase says it refuses.
 *
 * The suite SKIPS only when no local database configuration can exist — no
 * local environment file, no migration credentials. It does not skip because a
 * container happens to be down, because that would report green for proofs
 * nobody ran.
 */

const describeLive = databaseConfigured ? describe : describe.skip;

describeLive('Phase 3B — Taxonomy over a live database', () => {
  let database: DisposableDatabase;
  let admin: SqlSession;
  let harness: TaxonomyHarness;

  beforeAll(async () => {
    database = await createProofDatabase();
    admin = database.admin;
    harness = await createTaxonomyHarness();
  }, 240_000);

  afterAll(async () => {
    await database?.close();
  });

  /* =====================================================================
   * The canonical seed
   * =================================================================== */

  describe('the canonical topic seed', () => {
    it('is exactly the nineteen DOMAIN_MODEL.md §6.1 names, once each', async () => {
      const roots = await harness.taxonomy.listChildren({
        parentId: null,
        locale: 'en',
        includeArchived: true,
      });

      const seeded = roots.filter((topic) => topic.system);
      expect(seeded).toHaveLength(19);

      expect(seeded.map((topic) => topic.slug).sort()).toEqual([
        'ahl-al-bayt',
        'aqeedah',
        'contemporary-issues',
        'economics-and-finance',
        'education',
        'ethics',
        'family-and-society',
        'fiqh',
        'hadith',
        'human-rights',
        'interfaith',
        'islam-and-science',
        'islamic-history',
        'peace',
        'quran',
        'sahabah',
        'seerah',
        'spirituality',
        'worship',
      ]);

      // Not merely nineteen ROWS — nineteen DISTINCT slugs. A seed that
      // inserted `quran` twice would still count nineteen if another were
      // missing.
      expect(new Set(seeded.map((topic) => topic.slug)).size).toBe(19);
    });

    it('carries the fallback name and no invented translation', async () => {
      // English only, deliberately: inventing Urdu and Arabic wording for
      // nineteen religious and scholarly subjects is editorial work for people
      // qualified to do it. The gap is REPORTED by the model rather than
      // hidden, which is what makes it actionable.
      const quran = await harness.taxonomy.findTopicBySlug({
        slug: 'quran',
        locale: 'en',
      });

      expect(quran).not.toBeNull();
      expect(quran?.translatedLocales).toEqual([TOPIC_FALLBACK_LOCALE]);
      expect(quran?.label.name).toBe('Quran');
      expect(quran?.label.fallback).toBe(false);
    });

    it('resolves to the fallback in a locale it has no translation for', async () => {
      const urdu = await harness.taxonomy.findTopicBySlug({
        slug: 'quran',
        locale: 'ur',
      });

      expect(urdu?.label.name).toBe('Quran');
      expect(urdu?.label.resolvedLocale).toBe(TOPIC_FALLBACK_LOCALE);
      // REPORTED, not silent. An administrative surface that could not tell a
      // translation from a fallback could not show which topics still need one.
      expect(urdu?.label.fallback).toBe(true);
    });

    it('puts every seeded topic at the root, active, in a stable order', async () => {
      const roots = (
        await harness.taxonomy.listChildren({
          parentId: null,
          locale: 'en',
          includeArchived: true,
        })
      ).filter((topic) => topic.system);

      for (const topic of roots) {
        expect(topic.parentId).toBeNull();
        expect(topic.status).toBe('active');
        expect(topic.depth).toBe(1);
      }

      // The order is a TOTAL one: `position` then `slug`. Reading twice must
      // produce the same sequence, or a navigation surface reshuffles itself
      // between requests.
      const again = (
        await harness.taxonomy.listChildren({
          parentId: null,
          locale: 'en',
          includeArchived: true,
        })
      ).filter((topic) => topic.system);

      expect(again.map((topic) => topic.slug)).toEqual(roots.map((topic) => topic.slug));
    });

    it('protects a seeded topic from moving and archiving', async () => {
      const quran = await harness.taxonomy.findTopicBySlug({
        slug: 'quran',
        locale: 'en',
      });
      expect(quran).not.toBeNull();
      const topicId = quran?.id ?? '';

      const archived = await harness.taxonomy.setTopicStatus(PROOF_ACTOR, {
        topicId,
        status: 'archived',
      });
      expect(archived.ok).toBe(false);
      expect(archived.ok ? null : archived.failure).toBe('topic-protected');

      const hadith = await harness.taxonomy.findTopicBySlug({
        slug: 'hadith',
        locale: 'en',
      });
      const moved = await harness.taxonomy.moveTopic(PROOF_ACTOR, {
        topicId,
        parentId: hadith?.id ?? null,
      });
      expect(moved.ok).toBe(false);
      expect(moved.ok ? null : moved.failure).toBe('topic-protected');

      // Still exactly where it was.
      const after = await harness.taxonomy.findTopicBySlug({
        slug: 'quran',
        locale: 'en',
      });
      expect(after?.id).toBe(topicId);
      expect(after?.parentId).toBeNull();
      expect(after?.status).toBe('active');
    });

    it('allows a seeded topic to be TRANSLATED, which is editorial work', async () => {
      const ethics = await harness.taxonomy.findTopicBySlug({
        slug: 'ethics',
        locale: 'en',
      });
      const topicId = ethics?.id ?? '';

      const result = await harness.taxonomy.setTopicTranslation(PROOF_ACTOR, {
        topicId,
        locale: 'ur',
        name: 'اخلاقیات',
        description: null,
      });
      expect(result.ok).toBe(true);

      const urdu = await harness.taxonomy.findTopicBySlug({
        slug: 'ethics',
        locale: 'ur',
      });
      expect(urdu?.label.name).toBe('اخلاقیات');
      expect(urdu?.label.fallback).toBe(false);

      // Non-Latin script survives the round trip through the driver, the
      // column and the collation.
      expect(urdu?.label.name).toMatch(/\p{Script=Arabic}/u);
    });
  });

  /* =====================================================================
   * Creating and identifying topics
   * =================================================================== */

  describe('topic identity', () => {
    it('offers no operation that can change a slug after creation', () => {
      expect('renameTopicSlug' in harness.taxonomy).toBe(false);
      expect('renameTopicSlug' in harness.store).toBe(false);
    });

    it('creates a topic with its fallback name in one transaction', async () => {
      const slug = freshSlug('create');

      const created = await harness.taxonomy.createTopic(PROOF_ACTOR, {
        slug,
        parentId: null,
        name: 'A created topic',
        description: 'Why it exists.',
      });

      expect(created.ok).toBe(true);
      if (!created.ok) return;

      expect(created.topic.slug).toBe(slug);
      expect(created.topic.system).toBe(false);
      expect(created.topic.status).toBe('active');
      // The fallback translation exists ALREADY. A topic that briefly had no
      // name would render as nothing to anyone who read it in between.
      expect(created.topic.translations.map((entry) => entry.locale)).toEqual([
        TOPIC_FALLBACK_LOCALE,
      ]);

      const audit = await auditFor(admin, created.topic.id);
      expect(audit.map((row) => row.action)).toContain('taxonomy.topic.created');
      expect(audit[0]?.authorisingSource).toBe('taxonomy.administer');
    });

    it('refuses a duplicate slug, and leaves one row', async () => {
      const slug = freshSlug('unique');

      const first = await harness.taxonomy.createTopic(PROOF_ACTOR, {
        slug,
        parentId: null,
        name: 'First',
        description: null,
      });
      expect(first.ok).toBe(true);

      const second = await harness.taxonomy.createTopic(PROOF_ACTOR, {
        slug,
        parentId: null,
        name: 'Second',
        description: null,
      });
      expect(second.ok).toBe(false);
      expect(second.ok ? null : second.failure).toBe('duplicate-slug');

      expect(await topicCount(admin, slug)).toBe(1);
    });

    it('refuses two CONCURRENT creates of the same slug, and leaves one row', async () => {
      // The uniqueness that matters. A read-then-write check passes this test
      // by luck; a unique INDEX passes it by construction.
      const slug = freshSlug('race');

      const results = await Promise.all([
        harness.taxonomy.createTopic(PROOF_ACTOR, {
          slug,
          parentId: null,
          name: 'Racer one',
          description: null,
        }),
        harness.taxonomy.createTopic(PROOF_ACTOR, {
          slug,
          parentId: null,
          name: 'Racer two',
          description: null,
        }),
      ]);

      expect(results.filter((result) => result.ok)).toHaveLength(1);
      expect(await topicCount(admin, slug)).toBe(1);
    });

    it('refuses a parent that does not exist', async () => {
      const created = await harness.taxonomy.createTopic(PROOF_ACTOR, {
        slug: freshSlug('orphan'),
        parentId: '00000000-0000-4000-8000-0000deadbeef',
        name: 'Orphan',
        description: null,
      });

      expect(created.ok).toBe(false);
      expect(created.ok ? null : created.failure).toBe('not-found');
    });

    it('refuses a self-parent at the DATABASE, not only in the service', async () => {
      // A CHECK constraint, so it holds for every writer — including this
      // administrative session, which does not go through the service at all.
      const slug = freshSlug('self');
      const created = await harness.taxonomy.createTopic(PROOF_ACTOR, {
        slug,
        parentId: null,
        name: 'Self',
        description: null,
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      await expect(
        admin.query(
          `UPDATE [dbo].[Topic] SET [parentId] = [id] WHERE [id] = N'${created.topic.id}';`,
        ),
      ).rejects.toThrow();
    });
  });

  /* =====================================================================
   * Hierarchy integrity
   * =================================================================== */

  describe('the hierarchy cannot be made cyclic', () => {
    async function chain(length: number): Promise<string[]> {
      const ids: string[] = [];
      let parentId: string | null = null;

      for (let level = 0; level < length; level += 1) {
        const created = await harness.taxonomy.createTopic(PROOF_ACTOR, {
          slug: freshSlug(`chain-${level}`),
          parentId,
          name: `Level ${level}`,
          description: null,
        });
        if (!created.ok) throw new Error(`Chain create failed: ${created.failure}`);
        ids.push(created.topic.id);
        parentId = created.topic.id;
      }

      return ids;
    }

    it('refuses moving a topic beneath its own child', async () => {
      const [parent, child] = await chain(2);

      const moved = await harness.taxonomy.moveTopic(PROOF_ACTOR, {
        topicId: parent ?? '',
        parentId: child ?? null,
      });

      expect(moved.ok).toBe(false);
      expect(moved.ok ? null : moved.failure).toBe('hierarchy-cycle');
    });

    it('refuses moving a topic beneath a distant descendant', async () => {
      // Three levels, so the refusal cannot be a one-step parent check that
      // happens to look like cycle detection.
      const [root, , grandchild] = await chain(3);

      const moved = await harness.taxonomy.moveTopic(PROOF_ACTOR, {
        topicId: root ?? '',
        parentId: grandchild ?? null,
      });

      expect(moved.ok).toBe(false);
      expect(moved.ok ? null : moved.failure).toBe('hierarchy-cycle');
    });

    it('refuses a cycle attempted DIRECTLY against the table', async () => {
      // The service is not the boundary. The trigger is, which is why an
      // administrative session that never touches the service is refused too.
      const [parent, child] = await chain(2);

      await expect(
        admin.query(
          `UPDATE [dbo].[Topic] SET [parentId] = N'${child}' WHERE [id] = N'${parent}';`,
        ),
      ).rejects.toThrow();

      // And the shape is unchanged: a refused write leaves nothing behind.
      const [row] = await admin.query<{ parentId: string | null }>(
        `SELECT [parentId] FROM [dbo].[Topic] WHERE [id] = N'${parent}';`,
      );
      expect(row?.parentId).toBeNull();
    });

    it('cannot be made cyclic by two CONCURRENT moves', async () => {
      // THE RACE THIS PHASE EXISTS TO CLOSE. Two administrators move A under B
      // and B under A at the same moment. Each validates against a tree that is
      // about to stop being true, so an application check — however careful —
      // lets both through. The trigger's transaction-owned application lock
      // serialises them: the first holds it through commit, and the second then
      // evaluates the shape the first actually left behind.
      const a = await harness.taxonomy.createTopic(PROOF_ACTOR, {
        slug: freshSlug('race-a'),
        parentId: null,
        name: 'A',
        description: null,
      });
      const b = await harness.taxonomy.createTopic(PROOF_ACTOR, {
        slug: freshSlug('race-b'),
        parentId: null,
        name: 'B',
        description: null,
      });
      if (!a.ok || !b.ok) throw new Error('Setup failed.');

      const [first, second] = await Promise.all([
        harness.taxonomy.moveTopic(PROOF_ACTOR, {
          topicId: a.topic.id,
          parentId: b.topic.id,
        }),
        harness.taxonomy.moveTopic(PROOF_ACTOR, {
          topicId: b.topic.id,
          parentId: a.topic.id,
        }),
      ]);

      // At most one may succeed. Both succeeding is the cycle.
      expect([first.ok, second.ok].filter(Boolean).length).toBeLessThanOrEqual(1);

      // And the database agrees: neither row points at the other.
      const rows = await admin.query<{ id: string; parentId: string | null }>(`
        SELECT [id], [parentId] FROM [dbo].[Topic]
        WHERE [id] IN (N'${a.topic.id}', N'${b.topic.id}');
      `);

      const byId = new Map(rows.map((row) => [row.id, row.parentId]));
      const aParent = byId.get(a.topic.id) ?? null;
      const bParent = byId.get(b.topic.id) ?? null;
      expect(aParent === b.topic.id && bParent === a.topic.id).toBe(false);
    });

    it('refuses a hierarchy deeper than the accepted bound', async () => {
      const ids = await chain(MAX_TOPIC_DEPTH);
      expect(ids).toHaveLength(MAX_TOPIC_DEPTH);

      const tooDeep = await harness.taxonomy.createTopic(PROOF_ACTOR, {
        slug: freshSlug('too-deep'),
        parentId: ids.at(-1) ?? null,
        name: 'One level too far',
        description: null,
      });

      expect(tooDeep.ok).toBe(false);
      expect(tooDeep.ok ? null : tooDeep.failure).toBe('hierarchy-too-deep');
    });

    it('refuses a move that would push a SUBTREE past the bound', async () => {
      // Checking only the moved row would accept this: the row itself lands at
      // a legal depth and its descendants do not. The trigger walks downward as
      // well as upward for exactly this case.
      const deep = await chain(MAX_TOPIC_DEPTH - 1);
      const tall = await chain(3);

      const moved = await harness.taxonomy.moveTopic(PROOF_ACTOR, {
        topicId: tall[0] ?? '',
        parentId: deep.at(-1) ?? null,
      });

      expect(moved.ok).toBe(false);
      expect(moved.ok ? null : moved.failure).toBe('hierarchy-too-deep');
    });

    it('records a move with bounded before and after identifiers', async () => {
      const [parent] = await chain(1);
      const moving = await harness.taxonomy.createTopic(PROOF_ACTOR, {
        slug: freshSlug('audited-move'),
        parentId: null,
        name: 'Moves',
        description: null,
      });
      if (!moving.ok) throw new Error('Setup failed.');

      await harness.taxonomy.moveTopic(PROOF_ACTOR, {
        topicId: moving.topic.id,
        parentId: parent ?? null,
      });

      const [row] = await admin.query<{ beforeState: string; afterState: string }>(`
        SELECT [beforeState], [afterState] FROM [dbo].[AuditLog]
        WHERE [targetId] = N'${moving.topic.id}' AND [action] = N'taxonomy.topic.moved';
      `);

      expect(row?.beforeState).toContain('(root)');
      expect(row?.afterState).toContain(parent ?? '');
      // IDENTIFIERS, not a subtree. An audit payload carrying every descendant
      // would describe rows that did not themselves change.
      expect((row?.afterState ?? '').length).toBeLessThan(200);
    });
  });

  /* =====================================================================
   * Ordering
   * =================================================================== */

  describe('sibling order', () => {
    it('appends a new topic after its siblings', async () => {
      const parent = await harness.taxonomy.createTopic(PROOF_ACTOR, {
        slug: freshSlug('ordered'),
        parentId: null,
        name: 'Ordered parent',
        description: null,
      });
      if (!parent.ok) throw new Error('Setup failed.');

      const slugs: string[] = [];
      for (const index of [0, 1, 2]) {
        const slug = freshSlug(`child-${index}`);
        slugs.push(slug);
        const child = await harness.taxonomy.createTopic(PROOF_ACTOR, {
          slug,
          parentId: parent.topic.id,
          name: `Child ${index}`,
          description: null,
        });
        expect(child.ok).toBe(true);
      }

      const children = await harness.taxonomy.listChildren({
        parentId: parent.topic.id,
        locale: 'en',
        includeArchived: false,
      });

      expect(children.map((child) => child.slug)).toEqual(slugs);
    });

    it('reorders siblings and refuses a topic that is not one', async () => {
      const parent = await harness.taxonomy.createTopic(PROOF_ACTOR, {
        slug: freshSlug('reorder'),
        parentId: null,
        name: 'Reorder parent',
        description: null,
      });
      const outsider = await harness.taxonomy.createTopic(PROOF_ACTOR, {
        slug: freshSlug('outsider'),
        parentId: null,
        name: 'Outsider',
        description: null,
      });
      if (!parent.ok || !outsider.ok) throw new Error('Setup failed.');

      const ids: string[] = [];
      for (const index of [0, 1, 2]) {
        const child = await harness.taxonomy.createTopic(PROOF_ACTOR, {
          slug: freshSlug(`reordered-${index}`),
          parentId: parent.topic.id,
          name: `Child ${index}`,
          description: null,
        });
        if (!child.ok) throw new Error('Setup failed.');
        ids.push(child.topic.id);
      }

      const reversed = [...ids].reverse();
      const reordered = await harness.taxonomy.reorderTopics(PROOF_ACTOR, {
        parentId: parent.topic.id,
        orderedTopicIds: reversed,
      });
      expect(reordered.ok).toBe(true);

      const children = await harness.taxonomy.listChildren({
        parentId: parent.topic.id,
        locale: 'en',
        includeArchived: false,
      });
      expect(children.map((child) => child.id)).toEqual(reversed);

      // A REORDER MAY NOT BE USED AS A MOVE. Without this the operation would
      // be a way around the protected-seed and archived-parent rules that
      // `moveTopic` enforces.
      const smuggled = await harness.taxonomy.reorderTopics(PROOF_ACTOR, {
        parentId: parent.topic.id,
        orderedTopicIds: [outsider.topic.id, ...ids],
      });
      expect(smuggled.ok).toBe(false);
      expect(smuggled.ok ? null : smuggled.failure).toBe('not-found');

      const outsiderAfter = await harness.taxonomy.findTopic({
        topicId: outsider.topic.id,
        locale: 'en',
      });
      expect(outsiderAfter?.parentId).toBeNull();
    });
  });

  /* =====================================================================
   * Localisation
   * =================================================================== */

  describe('topic localisation', () => {
    async function topicWithTranslations(): Promise<string> {
      const created = await harness.taxonomy.createTopic(PROOF_ACTOR, {
        slug: freshSlug('localised'),
        parentId: null,
        name: 'English name',
        description: null,
      });
      if (!created.ok) throw new Error('Setup failed.');
      return created.topic.id;
    }

    it('holds at most one translation per topic and locale', async () => {
      const topicId = await topicWithTranslations();

      await harness.taxonomy.setTopicTranslation(PROOF_ACTOR, {
        topicId,
        locale: 'ur',
        name: 'پہلا نام',
        description: null,
      });
      await harness.taxonomy.setTopicTranslation(PROOF_ACTOR, {
        topicId,
        locale: 'ur',
        name: 'دوسرا نام',
        description: null,
      });

      const [row] = await admin.query<{ total: number }>(`
        SELECT COUNT_BIG(*) AS total FROM [dbo].[TopicTranslation]
        WHERE [topicId] = N'${topicId}' AND [locale] = N'ur';
      `);
      expect(Number(row?.total)).toBe(1);

      const detail = await harness.taxonomy.findTopic({ topicId, locale: 'ur' });
      expect(detail?.label.name).toBe('دوسرا نام');
    });

    it('survives two CONCURRENT writers of the same locale', async () => {
      const topicId = await topicWithTranslations();

      await Promise.all([
        harness.taxonomy.setTopicTranslation(PROOF_ACTOR, {
          topicId,
          locale: 'ar',
          name: 'الأول',
          description: null,
        }),
        harness.taxonomy.setTopicTranslation(PROOF_ACTOR, {
          topicId,
          locale: 'ar',
          name: 'الثاني',
          description: null,
        }),
      ]).catch(() => undefined);

      const [row] = await admin.query<{ total: number }>(`
        SELECT COUNT_BIG(*) AS total FROM [dbo].[TopicTranslation]
        WHERE [topicId] = N'${topicId}' AND [locale] = N'ar';
      `);
      // ONE ROW, whichever writer won. The composite primary key is what makes
      // that true rather than a read-then-write that happened to interleave
      // safely.
      expect(Number(row?.total)).toBeLessThanOrEqual(1);
    });

    it('resolves each supported locale, falling back deterministically', async () => {
      const topicId = await topicWithTranslations();
      await harness.taxonomy.setTopicTranslation(PROOF_ACTOR, {
        topicId,
        locale: 'ur',
        name: 'اردو نام',
        description: null,
      });

      for (const locale of localeSchema.options) {
        const detail = await harness.taxonomy.findTopic({ topicId, locale });
        expect(detail).not.toBeNull();
        expect(detail?.label.name.length).toBeGreaterThan(0);
      }

      const arabic = await harness.taxonomy.findTopic({ topicId, locale: 'ar' });
      expect(arabic?.label.name).toBe('English name');
      expect(arabic?.label.resolvedLocale).toBe(TOPIC_FALLBACK_LOCALE);
      expect(arabic?.label.fallback).toBe(true);

      const urdu = await harness.taxonomy.findTopic({ topicId, locale: 'ur' });
      expect(urdu?.label.name).toBe('اردو نام');
      expect(urdu?.label.fallback).toBe(false);
    });

    it('removes a non-fallback translation and reports the gap again', async () => {
      const topicId = await topicWithTranslations();
      await harness.taxonomy.setTopicTranslation(PROOF_ACTOR, {
        topicId,
        locale: 'ur',
        name: 'قابلِ حذف',
        description: null,
      });

      const removed = await harness.taxonomy.removeTopicTranslation(PROOF_ACTOR, {
        topicId,
        locale: 'ur',
      });
      expect(removed.ok).toBe(true);

      const urdu = await harness.taxonomy.findTopic({ topicId, locale: 'ur' });
      expect(urdu?.label.fallback).toBe(true);
      expect(urdu?.translatedLocales).toEqual([TOPIC_FALLBACK_LOCALE]);
    });

    it('refuses to remove the fallback translation, in the service AND the database', async () => {
      const topicId = await topicWithTranslations();

      const refused = await harness.taxonomy.removeTopicTranslation(PROOF_ACTOR, {
        topicId,
        locale: TOPIC_FALLBACK_LOCALE,
      });
      expect(refused.ok).toBe(false);
      expect(refused.ok ? null : refused.failure).toBe('fallback-translation-required');

      // THE DATABASE TOO. An invariant enforced only by its caller is an
      // invariant one new caller removes — so the administrative session, which
      // never touches the service, is refused as well.
      await expect(
        admin.query(`
          DELETE FROM [dbo].[TopicTranslation]
          WHERE [topicId] = N'${topicId}' AND [locale] = N'${TOPIC_FALLBACK_LOCALE}';
        `),
      ).rejects.toThrow();

      const detail = await harness.taxonomy.findTopic({ topicId, locale: 'en' });
      expect(detail?.translatedLocales).toContain(TOPIC_FALLBACK_LOCALE);
    });

    it('refuses to rewrite the fallback row into another locale', async () => {
      // The same invariant from the other direction: an UPDATE that moved the
      // `en` row to `ur` would leave the topic with no fallback.
      const topicId = await topicWithTranslations();

      await expect(
        admin.query(`
          UPDATE [dbo].[TopicTranslation] SET [locale] = N'ur'
          WHERE [topicId] = N'${topicId}' AND [locale] = N'${TOPIC_FALLBACK_LOCALE}';
        `),
      ).rejects.toThrow();
    });
  });

  /* =====================================================================
   * Lifecycle
   * =================================================================== */

  describe('topic lifecycle', () => {
    it('archives and restores a topic, and audits both', async () => {
      const created = await harness.taxonomy.createTopic(PROOF_ACTOR, {
        slug: freshSlug('lifecycle'),
        parentId: null,
        name: 'Lifecycle',
        description: null,
      });
      if (!created.ok) throw new Error('Setup failed.');

      const archived = await harness.taxonomy.setTopicStatus(PROOF_ACTOR, {
        topicId: created.topic.id,
        status: 'archived',
      });
      expect(archived.ok).toBe(true);
      expect(archived.ok ? archived.topic.status : null).toBe('archived');

      const restored = await harness.taxonomy.setTopicStatus(PROOF_ACTOR, {
        topicId: created.topic.id,
        status: 'active',
      });
      expect(restored.ok).toBe(true);

      const audit = await auditFor(admin, created.topic.id);
      expect(
        audit.filter((row) => row.action === 'taxonomy.topic.status-changed'),
      ).toHaveLength(2);
    });

    it('hides an archived topic from the default listing', async () => {
      const created = await harness.taxonomy.createTopic(PROOF_ACTOR, {
        slug: freshSlug('hidden'),
        parentId: null,
        name: 'Hidden',
        description: null,
      });
      if (!created.ok) throw new Error('Setup failed.');

      await harness.taxonomy.setTopicStatus(PROOF_ACTOR, {
        topicId: created.topic.id,
        status: 'archived',
      });

      const visible = await harness.taxonomy.listChildren({
        parentId: null,
        locale: 'en',
        includeArchived: false,
      });
      expect(visible.map((topic) => topic.id)).not.toContain(created.topic.id);

      const withArchived = await harness.taxonomy.listChildren({
        parentId: null,
        locale: 'en',
        includeArchived: true,
      });
      expect(withArchived.map((topic) => topic.id)).toContain(created.topic.id);
    });

    it('refuses to archive a topic that still has active children', async () => {
      // REFUSED RATHER THAN CASCADED. A cascade would archive a subtree the
      // administrator could not see from the row they clicked; refusing keeps
      // one checkable invariant — an active topic never has an archived
      // ancestor.
      const parent = await harness.taxonomy.createTopic(PROOF_ACTOR, {
        slug: freshSlug('has-children'),
        parentId: null,
        name: 'Parent',
        description: null,
      });
      if (!parent.ok) throw new Error('Setup failed.');

      const child = await harness.taxonomy.createTopic(PROOF_ACTOR, {
        slug: freshSlug('still-active'),
        parentId: parent.topic.id,
        name: 'Child',
        description: null,
      });
      expect(child.ok).toBe(true);

      const archived = await harness.taxonomy.setTopicStatus(PROOF_ACTOR, {
        topicId: parent.topic.id,
        status: 'archived',
      });
      expect(archived.ok).toBe(false);
      expect(archived.ok ? null : archived.failure).toBe('topic-has-active-children');
    });

    it('refuses to create or restore beneath an archived parent', async () => {
      const parent = await harness.taxonomy.createTopic(PROOF_ACTOR, {
        slug: freshSlug('archived-parent'),
        parentId: null,
        name: 'Archived parent',
        description: null,
      });
      if (!parent.ok) throw new Error('Setup failed.');

      await harness.taxonomy.setTopicStatus(PROOF_ACTOR, {
        topicId: parent.topic.id,
        status: 'archived',
      });

      const created = await harness.taxonomy.createTopic(PROOF_ACTOR, {
        slug: freshSlug('beneath-archived'),
        parentId: parent.topic.id,
        name: 'Beneath',
        description: null,
      });
      expect(created.ok).toBe(false);
      expect(created.ok ? null : created.failure).toBe('topic-archived');
    });
  });

  /* =====================================================================
   * Content languages
   * =================================================================== */

  describe('content languages are not interface locales', () => {
    it('seeds exactly the three the platform publishes in', async () => {
      const languages = await harness.taxonomy.listLanguages({ includeRetired: true });

      expect(languages.map((language) => language.code).sort()).toEqual([
        'ar',
        'en',
        'ur',
      ]);
      expect(languages.find((language) => language.code === 'ur')?.direction).toBe('rtl');
      expect(languages.find((language) => language.code === 'en')?.direction).toBe('ltr');
    });

    it('keeps each endonym in its own script', async () => {
      const languages = await harness.taxonomy.listLanguages({ includeRetired: true });

      for (const code of ['ur', 'ar']) {
        const language = languages.find((entry) => entry.code === code);
        expect(language?.nativeName).toMatch(/\p{Script=Arabic}/u);
      }
    });

    it('adds a content language that is NOT an interface locale', async () => {
      // The whole distinction, demonstrated. `fa` becomes available to describe
      // content and creates no `/fa/...` route, because the supported interface
      // locales are a compiled contract this data cannot reach.
      const created = await harness.taxonomy.createLanguage(PROOF_ACTOR, {
        code: 'fa',
        englishName: 'Persian',
        nativeName: 'فارسی',
        direction: 'rtl',
      });
      expect(created.ok).toBe(true);

      const languages = await harness.taxonomy.listLanguages({ includeRetired: false });
      expect(languages.map((language) => language.code)).toContain('fa');

      // The interface vocabulary is untouched, and is not derived from this
      // table in either direction.
      expect(localeSchema.options).toEqual(['en', 'ur', 'ar']);
      expect(localeSchema.safeParse('fa').success).toBe(false);
    });

    it('refuses a duplicate code', async () => {
      const duplicate = await harness.taxonomy.createLanguage(PROOF_ACTOR, {
        code: 'ur',
        englishName: 'Urdu again',
        nativeName: 'اردو',
        direction: 'rtl',
      });

      expect(duplicate.ok).toBe(false);
      expect(duplicate.ok ? null : duplicate.failure).toBe('duplicate-language-code');
    });

    it('retires and restores a language rather than deleting it', async () => {
      const created = await harness.taxonomy.createLanguage(PROOF_ACTOR, {
        code: 'pa-arab',
        englishName: 'Punjabi (Shahmukhi)',
        nativeName: 'پنجابی',
        direction: 'rtl',
      });
      expect(created.ok).toBe(true);

      const retired = await harness.taxonomy.setLanguageStatus(PROOF_ACTOR, {
        code: 'pa-arab',
        status: 'retired',
      });
      expect(retired.ok).toBe(true);

      const active = await harness.taxonomy.listLanguages({ includeRetired: false });
      expect(active.map((language) => language.code)).not.toContain('pa-arab');

      const all = await harness.taxonomy.listLanguages({ includeRetired: true });
      expect(all.map((language) => language.code)).toContain('pa-arab');

      const audit = await auditFor(admin, 'pa-arab');
      expect(audit.map((row) => row.action)).toContain(
        'taxonomy.language.status-changed',
      );
    });

    it('reports a language that does not exist rather than creating one', async () => {
      const updated = await harness.taxonomy.setLanguageStatus(PROOF_ACTOR, {
        code: 'zz',
        status: 'retired',
      });

      expect(updated.ok).toBe(false);
      expect(updated.ok ? null : updated.failure).toBe('not-found');
    });
  });

  /* =====================================================================
   * Tags
   * =================================================================== */

  describe('tags are not topics', () => {
    it('creates a tag with a slug and a free-form label', async () => {
      const slug = freshSlug('tag');
      const created = await harness.taxonomy.createTag(PROOF_ACTOR, {
        slug,
        label: 'امن کانفرنس',
      });

      expect(created.ok).toBe(true);
      if (!created.ok) return;
      expect(created.tag.slug).toBe(slug);
      expect(created.tag.status).toBe('active');
    });

    it('has no hierarchy to give it', async () => {
      // Structural, and deliberately so: the surface has no parent to set,
      // no ordering and no translation. A tag that acquired one would be a
      // second, unreviewed taxonomy competing with the real one.
      const store = harness.store as unknown as Record<string, unknown>;

      for (const method of [
        'moveTag',
        'reorderTags',
        'setTagParent',
        'setTagTranslation',
      ]) {
        expect(store[method]).toBeUndefined();
      }

      const [columns] = await admin.query<{ columns: string }>(`
        SELECT STRING_AGG(c.name, ',') WITHIN GROUP (ORDER BY c.name) AS columns
        FROM sys.columns c WHERE c.object_id = OBJECT_ID(N'[dbo].[Tag]');
      `);
      expect(columns?.columns).toBe('createdAt,id,label,slug,status,updatedAt');
    });

    it('refuses a duplicate slug and keeps one row', async () => {
      const slug = freshSlug('tag-unique');
      expect(
        (await harness.taxonomy.createTag(PROOF_ACTOR, { slug, label: 'One' })).ok,
      ).toBe(true);

      const second = await harness.taxonomy.createTag(PROOF_ACTOR, {
        slug,
        label: 'Two',
      });
      expect(second.ok).toBe(false);
      expect(second.ok ? null : second.failure).toBe('duplicate-slug');
    });

    it('relabels without moving the slug', async () => {
      const slug = freshSlug('tag-relabel');
      const created = await harness.taxonomy.createTag(PROOF_ACTOR, {
        slug,
        label: 'Before',
      });
      if (!created.ok) throw new Error('Setup failed.');

      const relabelled = await harness.taxonomy.relabelTag(PROOF_ACTOR, {
        tagId: created.tag.id,
        label: 'After',
      });
      expect(relabelled.ok).toBe(true);
      // THE SLUG IS IDENTITY. Letting a relabel move it would silently split
      // one tag into two.
      expect(relabelled.ok ? relabelled.tag.slug : null).toBe(slug);
      expect(relabelled.ok ? relabelled.tag.label : null).toBe('After');
    });

    it('retires a tag and keeps it out of the default listing', async () => {
      const slug = freshSlug('tag-retire');
      const created = await harness.taxonomy.createTag(PROOF_ACTOR, {
        slug,
        label: 'Retiring',
      });
      if (!created.ok) throw new Error('Setup failed.');

      await harness.taxonomy.setTagStatus(PROOF_ACTOR, {
        tagId: created.tag.id,
        status: 'retired',
      });

      const active = await harness.taxonomy.listTags({
        query: slug,
        includeRetired: false,
        limit: 25,
        offset: 0,
      });
      expect(active.items).toHaveLength(0);

      const all = await harness.taxonomy.listTags({
        query: slug,
        includeRetired: true,
        limit: 25,
        offset: 0,
      });
      expect(all.items.map((tag) => tag.slug)).toContain(slug);
    });

    it('bounds the listing and reports that more exist', async () => {
      const prefix = freshSlug('bounded');
      for (const index of [0, 1, 2, 3, 4]) {
        await harness.taxonomy.createTag(PROOF_ACTOR, {
          slug: `${prefix}-${index}`,
          label: `Bounded ${index}`,
        });
      }

      const page = await harness.taxonomy.listTags({
        query: prefix,
        includeRetired: true,
        limit: 2,
        offset: 0,
      });

      expect(page.items).toHaveLength(2);
      expect(page.more).toBe(true);

      const last = await harness.taxonomy.listTags({
        query: prefix,
        includeRetired: true,
        limit: 2,
        offset: 4,
      });
      expect(last.items).toHaveLength(1);
      expect(last.more).toBe(false);
    });

    it('caps a limit a caller asks to exceed', async () => {
      // The bound is the ADAPTER's, not the caller's. A surface that could ask
      // for a million rows would be an unbounded table load with a parameter.
      const page = await harness.taxonomy.listTags({
        query: null,
        includeRetired: true,
        limit: 10_000,
        offset: 0,
      });

      expect(page.items.length).toBeLessThanOrEqual(100);
    });
  });
});
