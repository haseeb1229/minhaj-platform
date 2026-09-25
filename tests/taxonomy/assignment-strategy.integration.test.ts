import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { SqlSession } from '../../packages/database/src/lifecycle/sql-connection.ts';
import { createProofDatabase, databaseConfigured } from '../identity/harness.ts';
import type { DisposableDatabase } from '../identity/harness.ts';
import {
  PROOF_ACTOR,
  createTaxonomyHarness,
  freshSlug,
  type TaxonomyHarness,
} from './harness.ts';

/**
 * PHASE 3B — THE TYPED TOPIC-ASSIGNMENT STRATEGY.
 *
 * WHAT THIS SUITE IS FOR. DOMAIN_MODEL.md §6.2 prohibits a generic
 * `targetType + targetId` reference and requires a TYPED junction with a real
 * foreign key to `Topic` and a real foreign key to its single target, owned by
 * the context that owns that target. No such context has shipped, so Phase 3B
 * delivers the RULE rather than a junction.
 *
 * A rule nobody exercises is a paragraph. This suite exercises it, and does so
 * without creating any premature schema: it builds a synthetic target table and
 * a typed junction INSIDE THE DISPOSABLE DATABASE THIS SUITE CREATES AND DROPS,
 * proves the integrity the rule promises, and leaves nothing behind rather than
 * adding a persistent table merely to satisfy a test.
 *
 * The synthetic target is NOT a future context's table and is not named like
 * one. Calling it `Article` would be premature business schema wearing a test's
 * clothes, and the next person to read the migration history would have to work
 * out why it was there.
 */

const describeLive = databaseConfigured ? describe : describe.skip;

/** Unmistakably a rehearsal, and unmistakably not a domain any phase owns. */
const TARGET_TABLE = 'ProofTargetRecord';
const JUNCTION_TABLE = 'ProofTargetRecordTopic';

describeLive('Phase 3B — typed topic assignment, proven on a disposable junction', () => {
  let database: DisposableDatabase;
  let admin: SqlSession;
  let harness: TaxonomyHarness;

  beforeAll(async () => {
    database = await createProofDatabase();
    admin = database.admin;
    harness = await createTaxonomyHarness();
  }, 240_000);

  afterAll(async () => {
    // The tables die with the disposable database, and are dropped explicitly
    // first so a failure here is reported rather than hidden by the drop.
    try {
      await admin.query(`DROP TABLE IF EXISTS [dbo].[${JUNCTION_TABLE}];`);
      await admin.query(`DROP TABLE IF EXISTS [dbo].[${TARGET_TABLE}];`);
    } finally {
      await database?.close();
    }
  });

  /* =====================================================================
   * The negative half: what must not exist
   * =================================================================== */

  describe('the prohibited design is absent', () => {
    it('has no table joining Topic through a target type and identifier', async () => {
      // The SHAPE, not the name. A prohibited design renamed is still the
      // prohibited design, so this asks the catalogue for any table that both
      // references `Topic` and carries the pair.
      const rows = await admin.query<{ name: string }>(`
        SELECT t.name
        FROM sys.tables t
        WHERE EXISTS (
            SELECT 1 FROM sys.columns c
            WHERE c.object_id = t.object_id AND c.name IN (N'targetType', N'targetId')
        )
          AND EXISTS (
            SELECT 1 FROM sys.foreign_keys fk
            WHERE fk.parent_object_id = t.object_id
              AND fk.referenced_object_id = OBJECT_ID(N'[dbo].[Topic]')
        );
      `);

      expect(rows.map((row) => row.name)).toEqual([]);
    });

    it('keeps the audit log free of any relation, which is why it may keep the pair', async () => {
      // `AuditLog` carries `targetType` and `targetId` and is explicitly OUTSIDE
      // the prohibition (§6.2.1): they are historical evidence, not navigation.
      // What makes that true is that nothing joins from an audit row into a
      // domain table — asserted, rather than asserted about.
      const rows = await admin.query<{ total: number }>(`
        SELECT COUNT_BIG(*) AS total FROM sys.foreign_keys
        WHERE parent_object_id = OBJECT_ID(N'[dbo].[AuditLog]');
      `);

      expect(Number(rows[0]?.total)).toBe(0);
    });

    it('reports exactly the delivered typed assignment relationships: six Editorial, seven Library, two Media', async () => {
      // The honest answer, and the one the administrative surface shows. It is
      // read from the foreign-key catalogue, so it cannot say "none" while one
      // exists, or "one" while somebody merely intended it.
      const status = await harness.taxonomy.assignmentStatus();
      expect(status).toEqual({
        // ArticleTopic and PageTopic (Phase 6), WorkTopic (Phase 8), one
        // junction per Phase-9 aggregate — Research, ResearchPaper, Publication,
        // Magazine, MagazineIssue and Encyclopedia — and Media's VideoTopic
        // (Phase 10) and AudioTrackTopic (Phase 11) — and one per Phase-13 News
        // family: NewsArticleTopic, PressReleaseTopic, StatementTopic and
        // MediaCoverageTopic.
        enforcedRelationships: 15,
        incompleteRelationships: 0,
      });
    });
  });

  /* =====================================================================
   * The positive half: what the rule produces when an owner follows it
   * =================================================================== */

  describe('a later owner following the rule gets enforceable integrity', () => {
    let topicId: string;
    let otherTopicId: string;
    let targetId: string;

    beforeAll(async () => {
      const topic = await harness.taxonomy.createTopic(PROOF_ACTOR, {
        slug: freshSlug('assignable'),
        parentId: null,
        name: 'Assignable topic',
        description: null,
      });
      const other = await harness.taxonomy.createTopic(PROOF_ACTOR, {
        slug: freshSlug('assignable-other'),
        parentId: null,
        name: 'Another assignable topic',
        description: null,
      });
      if (!topic.ok || !other.ok) throw new Error('Setup failed.');

      topicId = topic.topic.id;
      otherTopicId = other.topic.id;
      targetId = '11111111-1111-4111-8111-111111111111';

      // A synthetic target owned by nobody, standing in for whatever a later
      // context brings — an article, an ayah, a ruling, a course.
      await admin.query(`
        CREATE TABLE [dbo].[${TARGET_TABLE}] (
          [id] NVARCHAR(36) NOT NULL,
          [title] NVARCHAR(200) NOT NULL,
          CONSTRAINT [${TARGET_TABLE}_pkey] PRIMARY KEY CLUSTERED ([id])
        );
      `);

      // THE JUNCTION THE RULE DESCRIBES: real foreign key to `Topic`, real
      // foreign key to the target, composite primary key so an assignment is a
      // SET membership and a duplicate is impossible under concurrency.
      //
      // CASCADE on the TARGET edge and NO ACTION on the TOPIC edge, which is
      // the policy the owner chooses and Taxonomy does not: deleting a record
      // takes its classifications with it, and a topic is never deleted at all.
      await admin.query(`
        CREATE TABLE [dbo].[${JUNCTION_TABLE}] (
          [recordId] NVARCHAR(36) NOT NULL,
          [topicId] NVARCHAR(36) NOT NULL,
          CONSTRAINT [${JUNCTION_TABLE}_pkey] PRIMARY KEY CLUSTERED ([recordId],[topicId]),
          CONSTRAINT [${JUNCTION_TABLE}_recordId_fkey] FOREIGN KEY ([recordId])
            REFERENCES [dbo].[${TARGET_TABLE}]([id]) ON DELETE CASCADE,
          CONSTRAINT [${JUNCTION_TABLE}_topicId_fkey] FOREIGN KEY ([topicId])
            REFERENCES [dbo].[Topic]([id]) ON DELETE NO ACTION
        );
      `);

      await admin.query(`
        INSERT INTO [dbo].[${TARGET_TABLE}] ([id], [title])
        VALUES (N'${targetId}', N'A record that can be classified');
      `);
      await admin.query(`
        INSERT INTO [dbo].[${JUNCTION_TABLE}] ([recordId], [topicId])
        VALUES (N'${targetId}', N'${topicId}'), (N'${targetId}', N'${otherTopicId}');
      `);
    }, 120_000);

    it('refuses an assignment naming a topic that does not exist', async () => {
      // The half a polymorphic pair cannot enforce at all.
      await expect(
        admin.query(`
          INSERT INTO [dbo].[${JUNCTION_TABLE}] ([recordId], [topicId])
          VALUES (N'${targetId}', N'00000000-0000-4000-8000-0000deadbeef');
        `),
      ).rejects.toThrow();
    });

    it('refuses an assignment naming a target that does not exist', async () => {
      await expect(
        admin.query(`
          INSERT INTO [dbo].[${JUNCTION_TABLE}] ([recordId], [topicId])
          VALUES (N'00000000-0000-4000-8000-0000deadbeef', N'${topicId}');
        `),
      ).rejects.toThrow();
    });

    it('refuses a duplicate assignment, by the composite key', async () => {
      await expect(
        admin.query(`
          INSERT INTO [dbo].[${JUNCTION_TABLE}] ([recordId], [topicId])
          VALUES (N'${targetId}', N'${topicId}');
        `),
      ).rejects.toThrow();
    });

    it('surfaces a semantic status for the relationship the DATABASE enforces', async () => {
      // The product surface says what is true without publishing another
      // context's table, column or constraint names. The adapter derives this
      // status from the foreign-key catalogue rather than a declared registry.
      expect(await harness.taxonomy.assignmentStatus()).toEqual({
        enforcedRelationships: 16,
        incompleteRelationships: 0,
      });
    });

    it('DELETING A TARGET CANNOT ORPHAN ITS TOPIC ASSIGNMENT', async () => {
      // The canonical Phase-3B test (DELIVERY_PLAN.md, Phase 3B). With a
      // polymorphic pair the assignment rows would simply remain, pointing at a
      // record that no longer exists. With a real foreign key the database
      // removes them in the same statement.
      const doomedId = '22222222-2222-4222-8222-222222222222';

      await admin.query(`
        INSERT INTO [dbo].[${TARGET_TABLE}] ([id], [title])
        VALUES (N'${doomedId}', N'About to be deleted');
      `);
      await admin.query(`
        INSERT INTO [dbo].[${JUNCTION_TABLE}] ([recordId], [topicId])
        VALUES (N'${doomedId}', N'${topicId}');
      `);

      const [before] = await admin.query<{ total: number }>(
        `SELECT COUNT_BIG(*) AS total FROM [dbo].[${JUNCTION_TABLE}] WHERE [recordId] = N'${doomedId}';`,
      );
      expect(Number(before?.total)).toBe(1);

      await admin.query(
        `DELETE FROM [dbo].[${TARGET_TABLE}] WHERE [id] = N'${doomedId}';`,
      );

      const [after] = await admin.query<{ total: number }>(
        `SELECT COUNT_BIG(*) AS total FROM [dbo].[${JUNCTION_TABLE}] WHERE [recordId] = N'${doomedId}';`,
      );
      expect(Number(after?.total)).toBe(0);

      // NO DANGLING ROW ANYWHERE. Stated over the whole junction rather than
      // only the row just deleted, so a cascade that removed the wrong rows
      // would also fail.
      const dangling = await admin.query<{ total: number }>(`
        SELECT COUNT_BIG(*) AS total FROM [dbo].[${JUNCTION_TABLE}] j
        WHERE NOT EXISTS (
          SELECT 1 FROM [dbo].[${TARGET_TABLE}] t WHERE t.[id] = j.[recordId]
        );
      `);
      expect(Number(dangling[0]?.total)).toBe(0);
    });

    it('refuses to delete a TOPIC that an assignment still names', async () => {
      // The other direction, and the reason `Topic` carries no runtime DELETE
      // at all. Even with administrative authority the constraint refuses,
      // because the owner chose NO ACTION on the topic edge — so a
      // classification can never be left naming a topic that is gone.
      await expect(
        admin.query(`DELETE FROM [dbo].[Topic] WHERE [id] = N'${topicId}';`),
      ).rejects.toThrow();

      const [row] = await admin.query<{ total: number }>(
        `SELECT COUNT_BIG(*) AS total FROM [dbo].[Topic] WHERE [id] = N'${topicId}';`,
      );
      expect(Number(row?.total)).toBe(1);
    });

    it('lets Taxonomy archive a topic that assignments name, without breaking them', async () => {
      // What replaces deletion. The classification survives, the topic stops
      // being offered, and nothing is left pointing at nothing — which is the
      // whole reason archive is the lifecycle.
      const archived = await harness.taxonomy.setTopicStatus(PROOF_ACTOR, {
        topicId: otherTopicId,
        status: 'archived',
      });
      expect(archived.ok).toBe(true);

      const [row] = await admin.query<{ total: number }>(
        `SELECT COUNT_BIG(*) AS total FROM [dbo].[${JUNCTION_TABLE}] WHERE [topicId] = N'${otherTopicId}';`,
      );
      expect(Number(row?.total)).toBe(1);
    });

    it('REPORTS a junction typed on the topic side only, rather than accepting it', async () => {
      // THE DEFECT THIS SURFACE EXISTS TO NOTICE. A junction with a real
      // foreign key to `Topic` and a bare identifier for its target is a
      // HALF-TYPED assignment: real integrity on one side, a dangling
      // reference on the other. It is the shape somebody reaches for when the
      // target's own table is inconvenient, and it is what the mapping page
      // marks in error rather than listing as a relationship.
      //
      // Built and dropped inside this suite's own disposable database, so the
      // proof costs no schema anywhere else.
      const halfTyped = 'ProofHalfTypedTopic';

      await admin.query(`
        CREATE TABLE [dbo].[${halfTyped}] (
          [recordId] NVARCHAR(36) NOT NULL,
          [topicId] NVARCHAR(36) NOT NULL,
          CONSTRAINT [${halfTyped}_pkey] PRIMARY KEY CLUSTERED ([recordId],[topicId]),
          CONSTRAINT [${halfTyped}_topicId_fkey] FOREIGN KEY ([topicId])
            REFERENCES [dbo].[Topic]([id]) ON DELETE NO ACTION
        );
      `);

      try {
        // The surface reports the defect semantically without exposing either
        // the half-typed table or the sound owner's physical schema.
        expect(await harness.taxonomy.assignmentStatus()).toEqual({
          enforcedRelationships: 17,
          incompleteRelationships: 1,
        });
      } finally {
        await admin.query(`DROP TABLE IF EXISTS [dbo].[${halfTyped}];`);
      }
    });

    it('offers Taxonomy no way to write the junction it just reported', async () => {
      // OWNERSHIP, not merely absence. The junction belongs to the context that
      // owns the target; Taxonomy reports that it exists and has no operation
      // that could insert, update or delete a row in it.
      const store = harness.store as unknown as Record<string, unknown>;

      for (const method of [
        'assignTopic',
        'unassignTopic',
        'setTopicsFor',
        'createAssignment',
      ]) {
        expect(store[method]).toBeUndefined();
      }

      const status = await harness.taxonomy.assignmentStatus();
      expect(status.enforcedRelationships).toBeGreaterThan(0);
      expect(Object.values(status).every((value) => typeof value === 'number')).toBe(
        true,
      );
    });
  });
});
