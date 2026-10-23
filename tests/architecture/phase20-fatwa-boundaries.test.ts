import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  EXTERNALLY_GATED_PERMISSIONS,
  PERMISSION_CATALOGUE,
  PLATFORM_ADMINISTRATOR_PERMISSIONS,
  STEP_UP_PURPOSES,
} from '../../packages/contracts/src/identity/index.ts';
import { repoRoot } from './architecture-harness.ts';

/**
 * Phase 20 boundaries — the Fatwa context, its single publication operation,
 * the privacy of questions, and the absence of any AI ruling path.
 *
 * THE FAILURES THIS FILE EXISTS TO PREVENT, each of which would pass every
 * behavioural test on the day it was introduced:
 *
 *   - a second way to publish — a Prisma `fatwa.update`, a raw `UPDATE [Fatwa]`,
 *     an importer, a bulk path — appearing beside the one procedure that
 *     re-checks `fatwa.publish`, the `fatwa-publication` step-up, activation and
 *     author/publisher separation in SQL;
 *   - the Platform Administrator silently becoming a triage officer, answerer or
 *     Fatwa publisher because a Fatwa key joined the protected bundle;
 *   - a question, a ruling or an activation arriving in a migration or seed;
 *   - a private question reaching the public reader, Search or the public tree's
 *     session-free module graph;
 *   - a language model, generator or "suggest a ruling" helper appearing
 *     anywhere a ruling is written, reviewed or published;
 *   - Editorial, Quran, Hadith or Learning learning about Fatwa, or Fatwa about
 *     them;
 *   - `/fatwa/latest` or `/fatwa/popular` becoming paths.
 */

const read = (relative: string) => readFile(path.join(repoRoot, relative), 'utf8');

/** Source with comments and string literals removed, so prose cannot match. */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//gu, ' ')
    .replace(/(^|[^:])\/\/.*$/gmu, '$1 ')
    .replace(/'(?:[^'\\\n]|\\.)*'/gu, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/gu, '""')
    .replace(/`(?:[^`\\]|\\.)*`/gu, '``');
}

/** Source with comments removed but literals kept. */
function uncommented(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//gu, ' ').replace(/(^|[^:])\/\/.*$/gmu, '$1 ');
}

async function walk(directory: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(path.join(repoRoot, directory), {
    withFileTypes: true,
  })) {
    const relative = `${directory}/${entry.name}`;
    if (entry.isDirectory()) found.push(...(await walk(relative)));
    else found.push(relative);
  }
  return found;
}

const sources = async (directory: string) =>
  (await walk(directory)).filter((file) => /\.(?:ts|tsx)$/u.test(file));

const MIGRATION =
  'packages/database/prisma/migrations/20261004000000_phase20_fatwa/migration.sql';
const ADAPTER = 'packages/database/src/adapters/fatwa';
const CONTEXT = 'apps/web/src/contexts/fatwa';
const CONTRACT = 'packages/contracts/src/fatwa';
const PUBLIC = 'apps/web/src/app/[locale]/(public)/fatwa';
const ADMIN = 'apps/web/src/app/[locale]/admin/fatwa';
const MY = 'apps/web/src/app/[locale]/my/questions';
const COMPONENTS = 'apps/web/src/components/fatwa';

/** The procedures the runtime may execute — the one workflow write path. */
const WORKFLOW_PROCEDURES = [
  'FatwaSubmitQuestion',
  'FatwaTriageQuestion',
  'FatwaAssignQuestion',
  'FatwaDeclineQuestion',
  'FatwaSaveDraft',
  'FatwaSubmitForReview',
  'FatwaReturnForRevision',
  'FatwaPublishRevision',
  'FatwaWithdraw',
  'FatwaDisposeQuestions',
  'FatwaRecordRead',
] as const;

/** Called only from inside those procedures; the runtime may not execute them. */
const INTERNAL_PROCEDURES = [
  'FatwaAssertPermission',
  'FatwaAssertPublicationAuthority',
] as const;

/** Tables with no runtime write at all. */
const SEALED_TABLES = [
  'FatwaActivation',
  'FatwaQuestion',
  'Fatwa',
  'FatwaRevision',
  'FatwaRevisionTopic',
  'FatwaPublication',
  'FatwaReviewDecision',
  'FatwaReadTally',
] as const;

const delegate = (table: string) => `${table[0]!.toLowerCase()}${table.slice(1)}`;

/**
 * The migration with every `sp_executesql` body removed. A body is one SQL
 * string literal, so it ends at the first quote that is not doubled.
 */
const outsideProcedures = (migration: string) =>
  migration.replace(/EXEC sp_executesql N'(?:[^']|'')*';\n/gu, '');

/** A procedure's body as the migration creates it. */
function procedure(migration: string, name: string): string | undefined {
  return new RegExp(
    `CREATE PROCEDURE \\[dbo\\]\\.\\[${name}\\]([\\s\\S]*?)\\nEND;`,
    'u',
  ).exec(migration)?.[1];
}

describe('the externally gated keys are nobody’s by default', () => {
  it('catalogues exactly three Fatwa keys, each named by the accepted documents', () => {
    expect(
      PERMISSION_CATALOGUE.map((entry) => entry.key)
        .filter((key) => key.startsWith('fatwa.') || key.startsWith('question.'))
        .sort(),
    ).toEqual(['fatwa.answer', 'fatwa.publish', 'question.receive']);
  });

  it('keeps every Fatwa key out of the protected Platform Administrator bundle', () => {
    // The three Fatwa keys are gated; since Phase 23 `teaching.perform` is the
    // fourth, since Phase 24 the two Messaging keys are the fifth and sixth,
    // since Phase 27 the refund authority is the seventh, since Phase 29
    // migration publication is the eighth, and no gated key is ever bundled.
    const gated: readonly string[] = EXTERNALLY_GATED_PERMISSIONS;
    for (const key of ['fatwa.answer', 'fatwa.publish', 'question.receive'])
      expect(gated, key).toContain(key);
    expect([...gated].sort()).toEqual([
      'donations.refund',
      'fatwa.answer',
      'fatwa.publish',
      'messaging.moderate',
      'messaging.support',
      'migration.publish',
      'question.receive',
      'teaching.perform',
    ]);
    for (const key of EXTERNALLY_GATED_PERMISSIONS)
      expect(PLATFORM_ADMINISTRATOR_PERMISSIONS, key).not.toContain(key);
    expect(PLATFORM_ADMINISTRATOR_PERMISSIONS).toContain('permissions.grant');
  });

  it('bundles, grants and invalidates nothing in the migration', async () => {
    const migration = await read(MIGRATION);
    const outside = outsideProcedures(migration);
    expect(outside).toMatch(/INSERT INTO \[dbo\]\.\[Permission\]/u);
    expect(outside).not.toMatch(/INSERT INTO \[dbo\]\.\[RolePermission\]/u);
    expect(outside).not.toMatch(/INSERT INTO \[dbo\]\.\[RoleAssignment\]/u);
    expect(outside).not.toMatch(/INSERT INTO \[dbo\]\.\[Role\]/u);
    expect(outside).not.toMatch(/DELETE FROM \[dbo\]\.\[(?:Session|StepUpGrant)\]/u);
  });

  it('adds one step-up purpose, for Fatwa publication alone', () => {
    // Phase 27 appends a donation refund's own purpose after it and Phase 29
    // migration publication's; no Fatwa purpose was added beside it.
    expect([...STEP_UP_PURPOSES]).toEqual([
      'privilege-administration',
      'account-administration',
      'second-factor',
      'quran-canonical-edit',
      'hadith-canonical-edit',
      'fatwa-publication',
      'donation-refund',
      'migration-publication',
    ]);
  });
});

describe('questions and rulings have exactly one write path', () => {
  it('writes workflow tables only through the authority-checking procedures', async () => {
    const files = await sources(ADAPTER);
    expect(files.length).toBeGreaterThan(0);
    const all = (await Promise.all(files.map(read))).map(uncommented).join('\n');

    const sealed = SEALED_TABLES.map(delegate).join('|');
    expect(all).not.toMatch(
      new RegExp(
        `\\.(?:${sealed})\\s*\\.\\s*(?:create|createMany|update|updateMany|upsert|delete|deleteMany)\\b`,
        'u',
      ),
    );
    expect(all).not.toMatch(
      new RegExp(
        `(?:INSERT\\s+INTO|UPDATE|DELETE\\s+FROM|MERGE(?:\\s+INTO)?)\\s+(?:\\[dbo\\]\\.)?\\[?(?:${SEALED_TABLES.join('|')})\\]?\\s`,
        'iu',
      ),
    );
    for (const name of WORKFLOW_PROCEDURES)
      expect(all, name).toMatch(new RegExp(name, 'u'));
    for (const name of INTERNAL_PROCEDURES)
      expect(all, name).not.toMatch(new RegExp(name, 'u'));
  });

  it('reaches the publication procedure from exactly one runtime module and nowhere else', async () => {
    // Runtime code only: the populated-recovery fixture under `lifecycle/` runs
    // the same procedure as the database owner to build disposable proof state.
    const everywhere = [
      ...(await sources('apps/web/src')),
      ...(await sources('packages/database/src')).filter(
        (file) => !file.startsWith('packages/database/src/lifecycle/'),
      ),
      ...(await sources('packages/server-core/src')),
      ...(await sources('packages/search/src')),
    ];
    const callers: string[] = [];
    for (const file of everywhere)
      if (/FatwaPublishRevision/u.test(uncommented(await read(file)))) callers.push(file);
    expect(callers).toHaveLength(1);
    expect(callers[0]).toMatch(new RegExp(`^${ADAPTER}/`, 'u'));
  });

  it('grants the runtime principal no write on sealed tables and no internal procedure', async () => {
    const grants = await read(
      'packages/database/sql/permissions/grant-application-principal.sql',
    );
    const lineOf = (name: string, kind: 'U' | 'P') =>
      grants
        .split('\n')
        .find((entry) => entry.includes(`OBJECT_ID(N'[dbo].[${name}]',N'${kind}')`));
    for (const table of SEALED_TABLES) {
      const line = lineOf(table, 'U');
      expect(line, table).toBeDefined();
      expect(line, table).toMatch(
        new RegExp(`GRANT SELECT ON OBJECT::\\[dbo\\]\\.\\[${table}\\] TO`, 'u'),
      );
      expect(line, table).toMatch(/DENY INSERT, UPDATE, DELETE, ALTER/u);
    }
    for (const name of WORKFLOW_PROCEDURES)
      expect(lineOf(name, 'P'), name).toMatch(
        new RegExp(`GRANT EXECUTE ON OBJECT::\\[dbo\\]\\.\\[${name}\\] TO`, 'u'),
      );
    for (const name of INTERNAL_PROCEDURES)
      expect(grants, name).toMatch(
        new RegExp(`DENY EXECUTE ON OBJECT::\\[dbo\\]\\.\\[${name}\\] TO`, 'u'),
      );
    const category = lineOf('FatwaCategory', 'U');
    expect(category).toMatch(/DENY UPDATE ON OBJECT::[^;]*\[slug\]/u);
    expect(category).toMatch(/DENY DELETE, ALTER/u);
  });

  it('re-checks each stage’s own key, live, inside the database', async () => {
    const migration = await read(MIGRATION);
    const assert = procedure(migration, 'FatwaAssertPermission');
    expect(assert).toMatch(/revokedAt IS NULL/u);
    expect(assert).toMatch(/deactivatedAt IS NULL/u);
    expect(assert).toMatch(/status = N''active''/u);

    const stage: Record<string, string> = {
      FatwaTriageQuestion: 'question.receive',
      FatwaAssignQuestion: 'question.receive',
      FatwaDeclineQuestion: 'question.receive',
      FatwaSaveDraft: 'fatwa.answer',
      FatwaSubmitForReview: 'fatwa.answer',
      FatwaReturnForRevision: 'fatwa.publish',
    };
    for (const [name, key] of Object.entries(stage)) {
      const body = procedure(migration, name);
      expect(body, name).toBeDefined();
      expect(body, name).toContain(
        `EXEC [dbo].[FatwaAssertPermission] @actorId, N''${key}''`,
      );
    }
    // A draft is written only by the account the question is assigned to now.
    expect(procedure(migration, 'FatwaSaveDraft')).toMatch(/@assigneeId <> @actorId/u);
    expect(procedure(migration, 'FatwaSubmitForReview')).toMatch(
      /assigneeId = @actorId/u,
    );
  });

  it('publishes only under fatwa.publish, the fatwa-publication grant, activation and separation', async () => {
    const migration = await read(MIGRATION);
    const authority = procedure(migration, 'FatwaAssertPublicationAuthority');
    expect(authority).toMatch(/fatwa\.publish/u);
    expect(authority).toMatch(/fatwa-publication/u);
    expect(authority).not.toMatch(/quran|hadith|privilege-administration/iu);
    expect(authority).toMatch(/g\.expiresAt > SYSUTCDATETIME\(\)/u);
    expect(authority).toMatch(/s\.expiresAt > SYSUTCDATETIME\(\)/u);

    for (const name of ['FatwaPublishRevision', 'FatwaWithdraw'])
      expect(procedure(migration, name), name).toMatch(
        /EXEC \[dbo\]\.\[FatwaAssertPublicationAuthority\] @actorId, @sessionId, @stepUpGrantId/u,
      );
    const publish = procedure(migration, 'FatwaPublishRevision') ?? '';
    expect(publish).toMatch(/FROM \[dbo\]\.\[FatwaActivation\]/u);
    expect(publish).toMatch(/@authorId = @actorId THROW 51243/u);
    expect(publish).toMatch(/@askerId = @actorId THROW 51243/u);
    expect(publish).toMatch(/@pending <> @revisionId/u);
    expect(publish).toMatch(/@version <> @expectedVersion/u);
    expect(publish).toMatch(/INSERT INTO \[dbo\]\.\[SearchIndexRequest\]/u);
    expect(publish).toMatch(/INSERT INTO \[dbo\]\.\[AuditLog\]/u);
    // The one place a ruling becomes public.
    const setters = [...migration.matchAll(/publishedRevisionId = @revisionId/gu)];
    expect(setters).toHaveLength(1);
  });

  it('keeps history immutable and the published address fixed', async () => {
    const migration = await read(MIGRATION);
    for (const table of [
      'FatwaRevision',
      'FatwaRevisionTopic',
      'FatwaPublication',
      'FatwaReviewDecision',
    ])
      expect(migration, table).toMatch(
        new RegExp(
          `CREATE TRIGGER \\[dbo\\]\\.\\[${table}Immutable\\] ON \\[dbo\\]\\.\\[${table}\\] AFTER UPDATE, DELETE`,
          'u',
        ),
      );
    expect(migration).toMatch(/CREATE TRIGGER \[dbo\]\.\[FatwaActivationImmutable\]/u);
    expect(migration).toMatch(/A published Fatwa keeps its address/u);
    expect(migration).not.toMatch(/ON DELETE CASCADE/u);
  });
});

describe('no Fatwa content or authority exists in the repository', () => {
  it('seeds no question, ruling, category or activation in the migration', async () => {
    const migration = await read(MIGRATION);
    const outside = outsideProcedures(migration);
    expect(outside).not.toMatch(/INSERT INTO \[dbo\]\.\[Fatwa\w*\]/u);
  });

  it('writes no real ruling into any source file', async () => {
    const files = [
      ...(await sources(CONTRACT)),
      ...(await sources(CONTEXT)),
      ...(await sources(ADAPTER)),
    ];
    for (const file of files)
      expect(code(await read(file)), file).not.toMatch(
        /\b(?:halal|haram|makruh|mustahabb|wajib)\b/iu,
      );
  });
});

describe('no AI system can issue, draft, generate or publish a Fatwa', () => {
  it('depends on no language-model or generation library anywhere in the workspace', async () => {
    const manifests = [
      'package.json',
      ...(await readdir(path.join(repoRoot, 'packages'))).map(
        (name) => `packages/${name}/package.json`,
      ),
      'apps/web/package.json',
    ];
    for (const manifest of manifests) {
      const text = await read(manifest);
      expect(text, manifest).not.toMatch(
        /"(?:openai|@anthropic-ai\/[\w-]+|@ai-sdk\/[\w-]+|ai|langchain|@langchain\/[\w-]+|@google\/generative-ai|cohere-ai|ollama|llamaindex)"/u,
      );
    }
  });

  it('has no generation, suggestion or rewriting path in any Fatwa module', async () => {
    const files = [
      ...(await sources(CONTRACT)),
      ...(await sources(CONTEXT)),
      ...(await sources(ADAPTER)),
      ...(await sources(ADMIN)),
      ...(await sources(PUBLIC)),
      ...(await sources(MY)),
      ...(await sources(COMPONENTS)),
      'apps/web/src/composition/fatwa.ts',
      'apps/web/src/composition/fatwa-read.ts',
      'apps/web/src/composition/fatwa-read-count.ts',
    ];
    expect(files.length).toBeGreaterThan(10);
    for (const file of files) {
      const source = code(await read(file));
      expect(source, file).not.toMatch(
        // `generateMetadata` is the framework's metadata hook, not text generation.
        /\b(?!generateMetadata\b)(?:generate|suggest|rewrite|summari[sz]e|anonymi[sz]e|redact|complete|infer)\w*\s*\(/iu,
      );
      expect(uncommented(await read(file)), file).not.toMatch(
        /openai|anthropic|@ai-sdk|langchain|\bllm\b|chat\/completions|\/v1\/messages/iu,
      );
      expect(uncommented(await read(file)), file).not.toMatch(
        /@tiptap|editorial\/editor|RichText/u,
      );
    }
  });

  it('routes nothing to an assistant under Fatwa', async () => {
    const routes = [...(await walk(PUBLIC)), ...(await walk(ADMIN)), ...(await walk(MY))];
    expect(
      routes.filter((file) => /assistant|\bai\b|generate|suggest/iu.test(file)),
    ).toEqual([]);
  });
});

describe('a private question never reaches public surfaces', () => {
  it('gives the public reader no method that returns a question or a staff record', async () => {
    const ports = code(await read(`${CONTRACT}/ports.ts`));
    const reader =
      /interface FatwaPublicReaderPort \{([\s\S]*?)\n\}/u.exec(ports)?.[1] ?? '';
    expect(reader.length).toBeGreaterThan(0);
    expect(reader).not.toMatch(/StaffQuestion|OwnQuestion|FatwaRecord\b|FatwaQuestion/u);
    for (const [, method] of reader.matchAll(/^\s{2}(\w+)\(/gmu))
      expect(method, method).not.toMatch(
        /^(?:create|update|set|save|add|remove|delete|publish)/u,
      );
  });

  it('projects only public fields for Search', async () => {
    const values = code(await read(`${CONTRACT}/values.ts`));
    const record =
      /interface FatwaSearchRecord \{([\s\S]*?)\n\}/u.exec(values)?.[1] ?? '';
    const fields = [...record.matchAll(/readonly (\w+)\??\s*:/gu)]
      .map((m) => m[1])
      .sort();
    expect(fields).toEqual(
      [
        'fatwaId',
        'language',
        'publicQuestion',
        'publishedAt',
        'ruling',
        'slug',
        'stamp',
        'title',
        'topicIds',
      ].sort(),
    );
    const projection = code(await read(`${CONTEXT}/application/search-projection.ts`));
    expect(projection).not.toMatch(
      /\b(?:asker\w*|assignee\w*|note|draft\w*|pending\w*|staff\w*)\b/iu,
    );
  });

  it('keeps the public Fatwa tree free of sessions, cookies and the workflow root', async () => {
    const files = [
      ...(await sources(PUBLIC)),
      ...(await sources(COMPONENTS)),
      'apps/web/src/composition/fatwa-read.ts',
    ];
    expect(files.length).toBeGreaterThan(3);
    for (const file of files) {
      const source = uncommented(await read(file));
      expect(source, file).not.toMatch(
        /composition\/(?:identity|authorization)\b|cookies\(|headers\(\)\.get\('cookie'\)|server-core\/session|composition\/fatwa['"]/u,
      );
    }
  });

  it('logs identifiers only from the workflow', async () => {
    const service = code(await read(`${CONTEXT}/application/workflow-service.ts`));
    const detail =
      /interface FatwaWorkflowLogDetail \{([\s\S]*?)\n\}/u.exec(service)?.[1] ?? '';
    const fields = [...detail.matchAll(/readonly (\w+)\??\s*:/gu)]
      .map((m) => m[1])
      .sort();
    expect(fields).toEqual(['actorId', 'fatwaId', 'operation', 'outcome', 'revisionId']);
  });
});

describe('Fatwa is its own context and the routes are the route map’s', () => {
  it('imports no Editorial, Quran, Hadith, Library, Media or Learning context or contract', async () => {
    const files = [
      ...(await sources(CONTEXT)),
      ...(await sources(CONTRACT)),
      'apps/web/src/composition/fatwa.ts',
      'apps/web/src/composition/fatwa-read.ts',
    ];
    for (const file of files)
      expect(uncommented(await read(file)), file).not.toMatch(
        /contexts\/(?:editorial|quran|hadith|library|media|learning)\b|contracts\/(?:src\/)?(?:editorial|quran|hadith|library|media|learning)\b/u,
      );
  });

  it('is imported by no other context', async () => {
    const contexts = (
      await readdir(path.join(repoRoot, 'apps/web/src/contexts'), { withFileTypes: true })
    )
      .filter((entry) => entry.isDirectory() && entry.name !== 'fatwa')
      .map((entry) => entry.name);
    expect(contexts).toContain('editorial');
    for (const context of contexts)
      for (const file of await sources(`apps/web/src/contexts/${context}`))
        expect(uncommented(await read(file)), file).not.toMatch(
          /contexts\/fatwa|@minhaj\/contracts\/fatwa|contracts\/src\/fatwa/u,
        );
  });

  it('never makes latest or popular a path, and My Questions is Fatwa’s', async () => {
    const routes = await walk('apps/web/src/app');
    expect(routes.filter((file) => /\/fatwa\/(?:latest|popular)\b/u.test(file))).toEqual(
      [],
    );
    for (const page of ['page.tsx', 'ask/page.tsx', '[id]/page.tsx'])
      expect(routes, page).toContain(`${MY}/${page}`);
  });
});
