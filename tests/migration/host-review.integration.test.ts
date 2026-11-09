import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { EditorialContent } from '../../packages/contracts/src/editorial/index.ts';
import {
  getApplicationPrincipalCredentials,
  getDatabaseRuntimeUrl,
} from '../../packages/database/src/config.ts';
import { provisionApplicationPrincipal } from '../../packages/database/src/lifecycle/application-principal.ts';
import {
  assertApprovedLocalTarget,
  localTargetPolicy,
} from '../../packages/database/src/lifecycle/local-target.ts';
import {
  HOST_STEP_UP_TOOL_ENTRY,
  MIGRATION_REVIEW_TOOL_ENTRY,
  runMigrationTool,
} from '../../packages/database/src/lifecycle/migration-proof-operator.ts';
import {
  openSession,
  parseSqlServerUrl,
  type SqlServerConnection,
} from '../../packages/database/src/lifecycle/sql-connection.ts';
import { liveStepUpSessionIds } from '../../packages/database/src/lifecycle/staging-step-up.ts';
import { R2_ATTESTATION } from '../../scripts/review/policy.ts';
import { repoRoot } from '../architecture/architecture-harness.ts';
import { accountWith, count, n, sessionFor } from '../quran/fixture-sql.ts';
import {
  createProofDatabase,
  databaseConfigured,
  type DisposableDatabase,
} from '../identity/harness.ts';

/**
 * The staging HOST REVIEW (Rebaseline R2; OWNER-DECISION-2026-11-09-STAGING-
 * HOST-STEP-UP) against a REAL SQL Server: the review tool, as the
 * least-privilege RUNTIME principal in a child process exactly as the staging
 * command starts it, performs a completed run's acts through the SAME
 * services the admin screens call — and every rule holds: a set that moved
 * (or was never shown) is refused, a confirmation above the service's ceiling
 * is refused, a picture decision the standing rule does not admit is refused
 * before any service is asked, publication without a live
 * `migration-publication` step-up is refused, the Editorial author cannot
 * approve their own records and an approver without `content.publish` cannot
 * act, and nothing runs outside a declared non-indexable staging deployment.
 *
 * The run is the synthetic legacy export (no network); the Editorial records
 * are synthetic. No credential anywhere.
 */

const live = databaseConfigured ? describe : describe.skip;

const STAGING = {
  MINHAJ_DEPLOYMENT_ENVIRONMENT: 'staging',
  PUBLIC_INDEXING_ENABLED: 'false',
} as const;
const RUN_FIXTURE = path.join('scripts', 'migration', 'run-fixture.ts');
const ZERO = '0'.repeat(64);

const document = JSON.stringify({
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Synthetic host review proof. Non-authoritative.' },
      ],
    },
  ],
});
const content = (): EditorialContent => ({
  slug: `host-review-${randomUUID()}`,
  primaryLanguage: 'en',
  translations: [
    {
      languageCode: 'en',
      title: 'Synthetic host review proof',
      excerpt: 'Non-authoritative test fixture',
      seoTitle: '',
      seoDescription: '',
      document,
    },
  ],
  topicIds: [],
  contributors: [],
});

/** The environment a tool child may inherit beyond the runtime URL. */
function baseEnvironment(): Record<string, string> {
  const keep: Record<string, string> = {};
  for (const key of [
    'PATH',
    'Path',
    'SystemRoot',
    'TEMP',
    'TMP',
    'HOME',
    'USERPROFILE',
  ]) {
    const value = process.env[key];
    if (value !== undefined) keep[key] = value;
  }
  return keep;
}

/** Runs the fixture CLI to its end; resolves its final JSON line. */
function runFixture(environment: Record<string, string>, args: readonly string[]) {
  const child = spawn(
    process.execPath,
    ['--conditions=react-server', RUN_FIXTURE, ...args],
    { cwd: repoRoot, env: environment, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let output = '';
  child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')));
  child.stderr.resume();
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', () =>
      resolve(
        JSON.parse(output.trimEnd().split('\n').at(-1) ?? '{}') as Record<
          string,
          unknown
        >,
      ),
    );
  });
}

/** The second-factor posture a privileged gate requires. */
async function completePosture(db: DisposableDatabase, accountId: string): Promise<void> {
  await db.admin.query(`
    UPDATE [dbo].[User] SET [twoFactorEnabled] = 1, [emailVerified] = 1 WHERE [id] = ${n(accountId)};
    INSERT INTO [dbo].[TwoFactor] ([secret],[backupCodes],[userId],[verified])
      VALUES (N'not-a-real-secret-host-review', N'not-real-codes-host-review', ${n(accountId)}, 1);
    INSERT INTO [dbo].[PrivilegedSecurityPosture] ([userId],[secondFactorVerifiedAt],[recoveryCodesIssuedAt],[recoveryCodesConfirmedAt])
      VALUES (${n(accountId)}, SYSUTCDATETIME(), SYSUTCDATETIME(), SYSUTCDATETIME());
  `);
}

live('staging host review against real SQL Server', () => {
  let db: DisposableDatabase;
  let runtime: SqlServerConnection;
  let runtimeUrl: string;
  let operator: string;
  let session: string;
  let approver: string;
  let reviewerOnly: string;
  let runId: string;
  let manifestId: string;
  let articles: string[];
  /** Entries the Media target refused at publication: approved, and in no live manifest again. */
  let targetRefused: number;

  function review(
    args: readonly string[],
    environment: Record<string, string | undefined> = { ...process.env, ...STAGING },
  ) {
    return runMigrationTool({
      runtime,
      entry: MIGRATION_REVIEW_TOOL_ENTRY,
      args,
      environment,
      label: 'host review',
    });
  }

  async function refusal(
    args: readonly string[],
    environment?: Record<string, string | undefined>,
  ): Promise<string> {
    try {
      await review(args, environment);
    } catch (error) {
      return (error as Error).message;
    }
    throw new Error('expected a refusal');
  }

  const approved = () =>
    count(
      db.admin,
      'MigrationStagedRecord',
      `[runId] = ${n(runId)} AND [review] = N'approved'`,
    );
  const articleStates = async () =>
    (
      await db.admin.query<{ state: string; approvedById: string | null }>(
        `SELECT [state], [approvedById] FROM [dbo].[Article] WHERE [id] IN (${articles.map(n).join(', ')}) ORDER BY [id];`,
      )
    ).map((row) => `${row.state}:${row.approvedById ?? '-'}`);

  beforeAll(async () => {
    const runtimeSource = getDatabaseRuntimeUrl();
    db = await createProofDatabase();
    const target = parseSqlServerUrl(runtimeSource);
    runtimeUrl = runtimeSource.replace(
      `database=${target.database}`,
      `database=${db.name}`,
    );
    if (runtimeUrl === runtimeSource)
      throw new Error(
        'The runtime URL could not be repointed at the disposable database.',
      );
    runtime = assertApprovedLocalTarget(
      runtimeUrl,
      localTargetPolicy(process.env, 'disposable', 'runtime'),
    );
    const principal = getApplicationPrincipalCredentials();
    await provisionApplicationPrincipal(
      db.admin,
      principal.DATABASE_APP_LOGIN,
      principal.DATABASE_APP_PASSWORD,
    );
    await (await openSession(runtime)).close();

    // The first administrator: migration's keys, Media's (the publication
    // target's own authority), and Editorial's — so it is also the AUTHOR the
    // two-person rule must stop from approving its own records.
    operator = await accountWith(db.admin, [
      'migration.read',
      'migration.administer',
      'migration.publish',
      'media.read',
      'media.administer',
      'content.read',
      'content.author',
      'content.review',
      'content.publish',
    ]);
    await completePosture(db, operator);
    session = await sessionFor(db.admin, operator);
    approver = await accountWith(db.admin, [
      'content.read',
      'content.review',
      'content.publish',
    ]);
    reviewerOnly = await accountWith(db.admin, ['content.read', 'content.review']);

    // Everything set up in THIS process runs as the runtime principal too.
    process.env['DATABASE_URL'] = runtimeUrl;
    const { composeMigrationRunner } =
      await import('../../apps/web/src/composition/migration-runner.ts');
    const key = `host-review-${randomUUID().slice(0, 8)}`;
    await composeMigrationRunner().sources.createFixture(
      { accountId: operator },
      {
        key,
        name: 'FIXTURE host review export',
        contentKind: 'media.video',
        accessMethod: 'export',
        baseUrl: null,
        hosts: [],
        defaultLanguageCode: null,
        policy: {
          minIntervalMs: 0,
          maxConcurrency: 1,
          maxAttempts: 3,
          timeoutMs: 5000,
          maxBodyBytes: 1024 * 1024,
          maxRedirects: 2,
        },
        licensingEvidence: null,
        policyNotes: null,
      },
    );
    const run = await runFixture({ ...baseEnvironment(), DATABASE_URL: runtimeUrl }, [
      '--source',
      key,
      '--operator',
      operator,
    ]);
    expect(run).toMatchObject({ ok: true, state: 'completed', balanced: true });
    runId = String(run['runId']);

    // Two Editorial records the operator wrote and submitted for review.
    const adapters =
      await import('../../packages/database/src/adapters/editorial/index.ts');
    const { createAuthorizationReader } =
      await import('../../packages/database/src/adapters/identity-access/index.ts');
    const { createAuthorizationService } =
      await import('../../packages/server-core/src/authorization/index.ts');
    const { createEditorialService } =
      await import('../../apps/web/src/contexts/editorial/index.ts');
    const authorization = createAuthorizationService({
      reader: createAuthorizationReader(),
    });
    const editorial = createEditorialService({
      persistence: adapters.createEditorialPersistence(),
      authority: { permits: (id, key) => authorization.hasPermission(id, key) },
      reportFailure: () => undefined,
      references: {
        validTopics: async (ids) => ids.length === 0,
        validContributors: async (ids) => ids.length === 0,
        validLanguages: async (codes) => codes.every((code) => code === 'en'),
        selectableCentre: async () => false,
        selectableGallery: async () => false,
        selectableMembers: async () => false,
        usableImage: async () => false,
      },
    });
    articles = [];
    for (let index = 0; index < 2; index += 1) {
      const created = await editorial.create(
        { accountId: operator },
        'article',
        content(),
        null,
      );
      await editorial.transition({ accountId: operator }, 'article', {
        id: created.id,
        expectedVersion: created.version,
        action: 'submit',
        scheduledAt: null,
        timezone: null,
      });
      articles.push(created.id);
    }
    articles.sort();
  }, 900_000);

  afterAll(async () => {
    await db?.close();
  }, 120_000);

  it('runs nowhere but a declared non-indexable staging deployment', async () => {
    const args = ['status', '--operator', operator, '--run', runId];
    const { MINHAJ_DEPLOYMENT_ENVIRONMENT: _declared, ...undeclared } = process.env;
    expect(
      await refusal(args, { ...undeclared, PUBLIC_INDEXING_ENABLED: 'false' }),
    ).toMatch(/staging deployment/u);
    expect(
      await refusal(args, {
        ...process.env,
        MINHAJ_DEPLOYMENT_ENVIRONMENT: 'staging',
        PUBLIC_INDEXING_ENABLED: 'true',
      }),
    ).toMatch(/PUBLIC_INDEXING_ENABLED=false/u);
    expect(
      await refusal(args, {
        ...process.env,
        MINHAJ_DEPLOYMENT_ENVIRONMENT: 'production',
        PUBLIC_INDEXING_ENABLED: 'false',
      }),
    ).toMatch(/staging deployment/u);
    expect(await approved()).toBe(0);
  }, 300_000);

  it('approves exactly the confirmed set, and refuses a set that moved or exceeds the ceiling', async () => {
    const preview = await review(['approve-run', '--run', runId, '--operator', operator]);
    const shown = preview['confirmation'] as { count: number; fingerprint: string };
    expect(shown.count).toBeGreaterThan(0);
    expect(shown.fingerprint).toMatch(/^[0-9a-f]{64}$/u);

    const act = (count: string, fingerprint: string) => [
      'approve-run',
      '--run',
      runId,
      '--operator',
      operator,
      '--confirm-count',
      count,
      '--confirm-fingerprint',
      fingerprint,
    ];
    // A set never shown, a set of another size, and one above the service's
    // 10,000-candidate ceiling: refused, nothing decided.
    expect(await refusal(act(String(shown.count), ZERO))).toMatch(/conflict/u);
    expect(await refusal(act(String(shown.count + 1), shown.fingerprint))).toMatch(
      /conflict/u,
    );
    expect(await refusal(act('10001', shown.fingerprint))).toMatch(/invalid/u);
    expect(await approved()).toBe(0);

    const result = await review(act(String(shown.count), shown.fingerprint));
    expect(result).toMatchObject({
      ok: true,
      act: 'approve-run',
      remaining: 0,
      refused: [],
    });
    expect(result['decided']).toBe(shown.count);
    expect(await approved()).toBe(shown.count);
    // Each approval is the single review's own audited act, in the operator's name.
    expect(
      await count(
        db.admin,
        'AuditLog',
        `[actorId] = ${n(operator)} AND [action] LIKE N'migration.%review%'`,
      ),
    ).toBeGreaterThanOrEqual(shown.count);
    // The same confirmation again names a set that no longer exists.
    expect(await refusal(act(String(shown.count), shown.fingerprint))).toMatch(
      /conflict/u,
    );
  }, 600_000);

  it('refuses a picture decision the standing rule does not admit, before any service decides', async () => {
    const base = ['rights', '--run', runId, '--operator', operator];
    const decision = (host: string, evidence: string) => [
      ...base.slice(0, 3),
      '--host',
      host,
      ...base.slice(3),
      '--licence',
      'organisation-owned',
      '--evidence',
      evidence,
      '--rights-holder',
      'Minhaj-ul-Quran International',
      '--confirm-count',
      '1',
      '--confirm-fingerprint',
      ZERO,
    ];
    expect(
      await refusal(
        decision('media.fixture.invalid', `Fixture evidence; ${R2_ATTESTATION}`),
      ),
    ).toMatch(/stay restricted/u);
    expect(
      await refusal(decision('www.minhaj.net', 'The page states its own copyright.')),
    ).toMatch(new RegExp(R2_ATTESTATION, 'u'));
    // Admitted by the rule, the decision reaches Migration's own service,
    // which refuses a host the run's source does not register.
    expect(
      await refusal(
        decision('www.minhaj.net', `The page's own notice; ${R2_ATTESTATION}`),
      ),
    ).toMatch(/invalid/u);
    expect(
      await count(db.admin, 'MigrationAssetProvenance', `[visibility] <> N'restricted'`),
    ).toBe(0);
  }, 300_000);

  it('drafts a manifest over exactly the confirmed set', async () => {
    const preview = await review(['manifest', '--run', runId, '--operator', operator]);
    const shown = preview['confirmation'] as { count: number; fingerprint: string };
    expect(shown.count).toBe(await approved());
    const act = (fingerprint: string) => [
      'manifest',
      '--run',
      runId,
      '--operator',
      operator,
      '--confirm-count',
      String(shown.count),
      '--confirm-fingerprint',
      fingerprint,
    ];
    expect(await refusal(act(ZERO))).toMatch(/conflict/u);
    expect(await count(db.admin, 'MigrationPublishManifest')).toBe(0);

    const created = await review(act(shown.fingerprint));
    expect(created).toMatchObject({
      ok: true,
      act: 'manifest',
      state: 'draft',
      version: 1,
    });
    expect(created['entries']).toBe(Math.min(shown.count, 100));
    manifestId = String(created['manifestId']);
  }, 300_000);

  it('publishes only under a live migration-publication step-up on the named session', async () => {
    const preview = await review([
      'publish',
      '--manifest',
      manifestId,
      '--operator',
      operator,
    ]);
    expect(preview).toMatchObject({ state: 'draft', version: 1, runId });
    const act = [
      'publish',
      '--manifest',
      manifestId,
      '--operator',
      operator,
      '--confirm-version',
      '1',
      '--session',
      session,
    ];

    // No grant: the gate mints no publisher, and nothing moves.
    expect(await refusal(act)).toMatch(/does not hold migration\.publish/u);
    expect(
      await liveStepUpSessionIds(db.admin, operator, 'migration-publication'),
    ).toEqual([]);
    expect(
      await count(
        db.admin,
        'MigrationPublishManifest',
        `[id] = ${n(manifestId)} AND [state] = N'draft'`,
      ),
    ).toBe(1);

    // The host-issued grant — the real tool — bound to the live session.
    const grant = await runMigrationTool({
      runtime,
      entry: HOST_STEP_UP_TOOL_ENTRY,
      args: [
        'grant',
        '--account',
        operator,
        '--purpose',
        'migration-publication',
        '--minutes',
        '5',
      ],
      environment: { ...process.env, ...STAGING },
      label: 'host step-up',
    });
    expect(grant['sessionId']).toBe(session);
    expect(
      await liveStepUpSessionIds(db.admin, operator, 'migration-publication'),
    ).toEqual([session]);

    // A version never shown is a conflict.
    expect(await refusal(act.map((value) => (value === '1' ? '2' : value)))).toMatch(
      /conflict/u,
    );

    const result = await review(act);
    expect(result).toMatchObject({
      ok: true,
      act: 'publish',
      state: 'published',
      stopped: null,
    });
    const published = Number(result['published']);
    expect(published).toBeGreaterThanOrEqual(1);
    targetRefused = Number(result['refused']);
    expect(published + targetRefused).toBe(Math.min(await approved(), 100));
    expect(await count(db.admin, 'Video', `[state] = N'published'`)).toBe(published);
    expect(
      await count(
        db.admin,
        'MigrationPublishManifest',
        `[id] = ${n(manifestId)} AND [publishedByUserId] = ${n(operator)}`,
      ),
    ).toBe(1);
  }, 600_000);

  it('approves and publishes a confirmed Editorial queue page only as a second administrator', async () => {
    const preview = (who: string) =>
      review(['editorial', '--kind', 'article', '--approver', who]);
    const shown = (await preview(approver))['confirmation'] as {
      count: number;
      fingerprint: string;
    };
    expect(shown.count).toBe(2);
    const act = (who: string, fingerprint = shown.fingerprint) => [
      'editorial',
      '--kind',
      'article',
      '--approver',
      who,
      '--confirm-count',
      String(shown.count),
      '--confirm-fingerprint',
      fingerprint,
    ];
    const inReview = articles.map(() => 'in-review:-');
    expect(await articleStates()).toEqual(inReview);

    // A page never shown.
    expect(await refusal(act(approver, ZERO))).toMatch(/conflict/u);
    // An approver without content.publish: the service refuses before anything.
    expect(await refusal(act(reviewerOnly))).toMatch(/editorial refusal: denied/u);
    // The author: every record refused as self-approval, none approved.
    const self = await review(act(operator));
    expect(self).toMatchObject({ ok: true, decided: 0 });
    expect(
      (self['refused'] as { id: string; reason: string }[])
        .map((entry) => `${entry.id}:${entry.reason}`)
        .sort(),
    ).toEqual(articles.map((id) => `${id}:self-approval`));
    expect(await articleStates()).toEqual(inReview);

    const searchBefore = await count(
      db.admin,
      'SearchIndexRequest',
      `[scopeId] IN (${articles.map(n).join(', ')})`,
    );
    const result = await review(act(approver));
    expect(result).toMatchObject({ ok: true, act: 'editorial', decided: 2, refused: [] });
    expect(await articleStates()).toEqual(articles.map(() => `published:${approver}`));
    // Each publication recorded its search request with it, for the web
    // service's own sweep to index.
    expect(
      await count(
        db.admin,
        'SearchIndexRequest',
        `[scopeId] IN (${articles.map(n).join(', ')})`,
      ),
    ).toBeGreaterThan(searchBefore);
    // One audited transition per approval and per publication.
    expect(
      await count(
        db.admin,
        'AuditLog',
        `[actorId] = ${n(approver)} AND [targetId] IN (${articles.map(n).join(', ')})`,
      ),
    ).toBeGreaterThanOrEqual(4);
  }, 600_000);

  it('reports what awaits each act, as counts and identifiers only', async () => {
    const status = await review(['status', '--operator', operator, '--run', runId]);
    expect(status).toMatchObject({
      ok: true,
      act: 'status',
      run: {
        id: runId,
        state: 'completed',
        reconciliation: 'balanced',
        actsAdmitted: true,
      },
      manifest: { candidates: targetRefused, next: targetRefused },
      publish: [],
      rights: [],
    });
    expect((status['approve'] as { candidates: number }).candidates).toBe(0);
    expect(
      (status['editorial'] as Record<string, { firstPage: number }>)['article'],
    ).toEqual({
      firstPage: 0,
      more: false,
    });
    expect(JSON.stringify(status)).not.toMatch(/FIXTURE Export|Synthetic host review/u);

    // Without migration.read the read itself is refused.
    expect(await refusal(['status', '--operator', approver, '--run', runId])).toMatch(
      /denied/u,
    );
  }, 300_000);
});
