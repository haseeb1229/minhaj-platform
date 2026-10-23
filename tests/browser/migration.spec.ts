import { createHash, randomUUID } from 'node:crypto';

import type { Browser, BrowserContext, Page } from '@playwright/test';

import type { SqlSession } from '../../packages/database/src/lifecycle/sql-connection.ts';
import {
  copy,
  expectHeadingsInOrder,
  expectLabelledControls,
  expectVisibleFocus,
  mainHeading,
  overflowOf,
  tabTo,
  type UiLocale,
} from './messaging-pages';
import {
  accountIdFor,
  baseUrl,
  enrolSecondFactorInBrowser,
  expect,
  grantRole,
  privilegedSession,
  registerAndSignIn,
  test,
} from './support';

/**
 * Phase 29 — the Migration administration in a real browser, against the
 * production build and the run's disposable database.
 *
 * WHAT ONLY A BROWSER CAN PROVE: that a signed-out visitor is sent to sign in
 * and the private routes refuse; that an account without `migration.read` meets
 * a 404 on every page and route; that a reader sees sources, runs and staging
 * and is offered no act; that a staged record whose payload and raw evidence
 * carry hostile markup is shown as INERT, escaped text — no injected element in
 * the DOM, no dialog, no script; that the raw download carries exactly the
 * headers that keep a browser from interpreting it; that an approval at a
 * stale version is refused; that publishing without a live
 * `migration-publication` step-up is refused and the step-up is offered; that
 * the area is `noindex` and in no sitemap; that it reads right-to-left in
 * Urdu and Arabic, reflows at 320 pixels and keeps a visible keyboard focus.
 *
 * ONE SERIAL FILE. The approval proofs change a staged revision's review, and
 * the later proofs read that state.
 *
 * WHO WRITES WHAT. Identity's accounts and roles go through the UI and the
 * suite's grant fixture. The Migration rows — a fixture source, one completed
 * and balanced run, records, raw snapshots, staged revisions, a topic mapping,
 * errors, a duplicate pair and a draft manifest — are written OWNER-SIDE, as
 * an operator's pipeline run would leave them, because the pipeline itself
 * runs from the command line and never from a browser. Every decision after
 * that is made through the pages.
 *
 * EVERYTHING IS SYNTHETIC: every word carries the `FIXTURE_MIGRATION_UI`
 * sentinel and every host is `*.fixture.invalid`, which never resolves.
 */

// NO RETRY. The review decisions outlive an attempt, so a retry would meet them
// and prove nothing about the first one.
test.describe.configure({ mode: 'serial', retries: 0 });

let sql: SqlSession;
const contexts: BrowserContext[] = [];

const run = randomUUID().replaceAll('-', '').slice(0, 10);
const SENTINEL = 'FIXTURE_MIGRATION_UI';
const HOST = `ui-${run}.fixture.invalid`;

const ids = {
  source: randomUUID(),
  run: randomUUID(),
  hostileRecord: randomUUID(),
  approvedRecord: randomUUID(),
  missingRecord: randomUUID(),
  hostileSnapshot: randomUUID(),
  approvedSnapshot: randomUUID(),
  hostileStaged: randomUUID(),
  approvedStaged: randomUUID(),
  hostileItem: randomUUID(),
  approvedItem: randomUUID(),
  topicMapping: randomUUID(),
  retryableError: randomUUID(),
  accessError: randomUUID(),
  duplicate: randomUUID(),
  manifest: randomUUID(),
  entry: randomUUID(),
  asset: randomUUID(),
  acquisitionA: randomUUID(),
  acquisitionB: randomUUID(),
} as const;

const TEXT = {
  sourceKey: `fixture-ui-${run}`,
  sourceName: `${SENTINEL} source ${run}`,
  hostileTitle: `${SENTINEL} <img src=x onerror=alert(1)> ${run}`,
  approvedTitle: `${SENTINEL} approved ${run}`,
  category: `${SENTINEL} category ${run}`,
} as const;

/**
 * Markup that would run, load or navigate if it were ever rendered as HTML:
 * a script, an event handler, an injected element and a `javascript:` link.
 * Each sets a marker the proofs look for — and must never find.
 */
const HOSTILE_DESCRIPTION =
  `<script>window.__migrationPwned=true;alert('script')</script>` +
  `<img id="injected-payload" src="x" onerror="window.__migrationPwned=true;alert('img')">` +
  `<a id="injected-link" href="javascript:alert('link')">${SENTINEL} link</a>`;

const HOSTILE_BODY = Buffer.from(
  `<!doctype html><html><body><h1 id="injected-snapshot">${SENTINEL} ${run}</h1>` +
    `<script>window.__migrationPwned=true;alert('raw')</script>` +
    `<img id="injected-raw" src="x" onerror="alert('raw-img')">` +
    `<iframe id="injected-frame" src="https://${HOST}/"></iframe></body></html>`,
  'utf8',
);
/** One small file's bytes, stored once and acquired twice. Never served. */
const ASSET_BYTES = Buffer.from(`${SENTINEL} asset ${run}`, 'utf8');
const ASSET_KEY = `${run.slice(0, 2)}/${run.slice(2, 4)}/migration-ui-${run}`;
const APPROVED_BODY = Buffer.from(
  `<html><body>${SENTINEL} approved ${run}</body></html>`,
);

/** A SQL Server Unicode literal. Values are this file's own constants. */
const n = (value: string) => `N'${value.replaceAll("'", "''")}'`;
const sha256 = (value: string | Buffer) =>
  createHash('sha256').update(value).digest('hex');
const hex = (value: Buffer) => `0x${value.toString('hex')}`;

function payloadOf(slug: string, title: string, descriptionHtml: string): string {
  return JSON.stringify({
    kind: 'media.video',
    slug,
    primaryLocale: 'en',
    languageCode: 'en',
    provider: 'youtube',
    providerVideoId: `FIXTURE${run}`,
    labels: [{ locale: 'en', title, description: `${SENTINEL} description ${run}` }],
    descriptionHtml,
    publishedOn: null,
    durationSeconds: null,
    legacyIdentifier: null,
  });
}

const PROVENANCE = `N'fixture-ui', N'1', N'fixture-ui-parser', N'1', N'1', N'local'`;

/* ===========================================================================
 * Seeding — what a completed, balanced fixture run leaves behind
 * ========================================================================= */

async function seedMigration(operatorId: string): Promise<void> {
  const hostilePayload = payloadOf(
    `fixture-ui-hostile-${run}`,
    TEXT.hostileTitle,
    HOSTILE_DESCRIPTION,
  );
  const approvedPayload = payloadOf(
    `fixture-ui-approved-${run}`,
    TEXT.approvedTitle,
    `<p>${SENTINEL} approved ${run}</p>`,
  );
  const url = (path: string) => n(`http://${HOST}/${path}`);
  const record = (id: string, path: string, status: string, observed: string) =>
    `INSERT INTO [dbo].[MigrationRecord] ([id],[sourceId],[externalKey],[originalUrl],[contentKind],[status],[observed],[firstObservedRunId],[lastObservedRunId],[createdAt],[updatedAt])
       VALUES (N'${id}', N'${ids.source}', ${url(path)}, ${url(path)}, N'media.video', N'${status}', N'${observed}', N'${ids.run}', N'${ids.run}', SYSUTCDATETIME(), SYSUTCDATETIME());`;
  const snapshot = (id: string, recordId: string, path: string, body: Buffer) =>
    `INSERT INTO [dbo].[MigrationRawSnapshot] ([id],[sourceId],[recordId],[runId],[requestedUrl],[finalUrl],[httpStatus],[contentType],[body],[byteSize],[checksum],[fetchedAt],[fetcherKey],[fetcherVersion],[personalData])
       VALUES (N'${id}', N'${ids.source}', N'${recordId}', N'${ids.run}', ${url(path)}, ${url(path)}, 200, N'text/html; charset=utf-8', ${hex(body)}, ${String(body.byteLength)}, N'${sha256(body)}', SYSUTCDATETIME(), N'fixture-ui', N'1', N'none');`;
  const staged = (
    id: string,
    recordId: string,
    snapshotId: string,
    title: string,
    payload: string,
    body: Buffer,
  ) =>
    `INSERT INTO [dbo].[MigrationStagedRecord] ([id],[recordId],[snapshotId],[runId],[revision],[contentKind],[title],[titleKey],[languageCode],[payload],[payloadChecksum],[adapterKey],[adapterVersion],[parserKey],[parserVersion],[normalizerVersion],[codeRevision],[inputChecksum],[producedAt],[validation],[personalData])
       VALUES (N'${id}', N'${recordId}', N'${snapshotId}', N'${ids.run}', 1, N'media.video', ${n(title)}, ${n(title.toLowerCase())}, N'en', ${n(payload)}, N'${sha256(payload)}', ${PROVENANCE}, N'${sha256(body)}', SYSUTCDATETIME(), N'valid', N'none');`;
  const item = (
    id: string,
    recordId: string,
    position: number,
    snapshotId: string,
    stagedId: string,
  ) =>
    `INSERT INTO [dbo].[MigrationRunItem] ([id],[runId],[recordId],[position],[outcome],[fetched],[parsed],[attempts],[snapshotId],[stagedRecordId],[updatedAt])
       VALUES (N'${id}', N'${ids.run}', N'${recordId}', ${String(position)}, N'staged', 1, 1, 1, N'${snapshotId}', N'${stagedId}', SYSUTCDATETIME());`;

  const acquisition = (id: string, file: string) =>
    `INSERT INTO [dbo].[MigrationAssetProvenance] ([id],[sourceId],[recordId],[runId],[originalUrl],[originalUrlDigest],[assetId],[checksum],[byteSize],[mediaType],[licence],[acquiredAt])
       VALUES (N'${id}', N'${ids.source}', N'${ids.hostileRecord}', N'${ids.run}', ${url(file)}, N'${sha256(`http://${HOST}/${file}`)}', N'${ids.asset}', N'${sha256(ASSET_BYTES)}', ${String(ASSET_BYTES.byteLength)}, N'image/png', N'unknown', SYSUTCDATETIME());`;

  const counts = {
    discovered: 2,
    pending: 0,
    fetched: 2,
    parsed: 2,
    staged: 2,
    unchanged: 0,
    rejected: 0,
    errored: 0,
    excluded: 0,
    inconsistent: 0,
    reviewPending: 1,
    approved: 1,
    reviewRejected: 0,
    superseded: 0,
    published: 0,
    mapped: 0,
    merged: 0,
  };
  const detail = JSON.stringify({
    balanced: true,
    discrepancies: [],
    omitted: 0,
    counts,
  });

  const steps = [
    `INSERT INTO [dbo].[MigrationSource] ([id],[key],[name],[authorityKind],[accessMethod],[contentKind],[baseUrl],[defaultLanguageCode],[minIntervalMs],[maxConcurrency],[maxAttempts],[timeoutMs],[maxBodyBytes],[maxRedirects],[state],[createdAt],[createdByUserId],[updatedAt],[updatedByUserId])
       VALUES (N'${ids.source}', ${n(TEXT.sourceKey)}, ${n(TEXT.sourceName)}, N'fixture', N'http', N'media.video', ${n(`http://${HOST}/`)}, N'en', 1000, 1, 3, 10000, 1048576, 2, N'active', SYSUTCDATETIME(), N'${operatorId}', SYSUTCDATETIME(), N'${operatorId}');`,
    `INSERT INTO [dbo].[MigrationSourceHost] ([sourceId],[host]) VALUES (N'${ids.source}', ${n(HOST)});`,
    `INSERT INTO [dbo].[MigrationRun] ([id],[sourceId],[operatorUserId],[state],[adapterKey],[adapterVersion],[parserKey],[parserVersion],[normalizerVersion],[codeRevision],[discoveryComplete],[startedAt])
       VALUES (N'${ids.run}', N'${ids.source}', N'${operatorId}', N'open', ${PROVENANCE}, 1, SYSUTCDATETIME());`,
    record(ids.hostileRecord, `videos/hostile-${run}`, 'staged', 'present'),
    record(ids.approvedRecord, `videos/approved-${run}`, 'approved', 'present'),
    record(ids.missingRecord, `videos/missing-${run}`, 'errored', 'missing'),
    snapshot(
      ids.hostileSnapshot,
      ids.hostileRecord,
      `videos/hostile-${run}`,
      HOSTILE_BODY,
    ),
    snapshot(
      ids.approvedSnapshot,
      ids.approvedRecord,
      `videos/approved-${run}`,
      APPROVED_BODY,
    ),
    staged(
      ids.hostileStaged,
      ids.hostileRecord,
      ids.hostileSnapshot,
      TEXT.hostileTitle,
      hostilePayload,
      HOSTILE_BODY,
    ),
    staged(
      ids.approvedStaged,
      ids.approvedRecord,
      ids.approvedSnapshot,
      TEXT.approvedTitle,
      approvedPayload,
      APPROVED_BODY,
    ),
    // The second revision was approved by a person, one version later.
    `UPDATE [dbo].[MigrationStagedRecord] SET [review]=N'approved', [reviewedByUserId]=N'${operatorId}', [reviewedAt]=SYSUTCDATETIME(), [version]=2 WHERE [id]=N'${ids.approvedStaged}';`,
    item(ids.hostileItem, ids.hostileRecord, 0, ids.hostileSnapshot, ids.hostileStaged),
    item(
      ids.approvedItem,
      ids.approvedRecord,
      1,
      ids.approvedSnapshot,
      ids.approvedStaged,
    ),
    `UPDATE [dbo].[MigrationRecord] SET [latestSnapshotId]=N'${ids.hostileSnapshot}', [currentStagedRecordId]=N'${ids.hostileStaged}', [version]=2 WHERE [id]=N'${ids.hostileRecord}';`,
    `UPDATE [dbo].[MigrationRecord] SET [latestSnapshotId]=N'${ids.approvedSnapshot}', [currentStagedRecordId]=N'${ids.approvedStaged}', [version]=2 WHERE [id]=N'${ids.approvedRecord}';`,
    `INSERT INTO [dbo].[MigrationTopicMapping] ([id],[sourceId],[categoryKey],[label],[state]) VALUES (N'${ids.topicMapping}', N'${ids.source}', ${n(`fixture-category-${run}`)}, ${n(TEXT.category)}, N'unmapped');`,
    `INSERT INTO [dbo].[MigrationStagedCategory] ([stagedRecordId],[topicMappingId]) VALUES (N'${ids.hostileStaged}', N'${ids.topicMapping}');`,
    `INSERT INTO [dbo].[MigrationStagedLink] ([stagedRecordId],[position],[href],[disposition]) VALUES (N'${ids.hostileStaged}', 0, ${url(`videos/unmapped-${run}`)}, N'unresolved');`,
    `INSERT INTO [dbo].[MigrationError] ([id],[sourceId],[runId],[recordId],[stage],[classification],[retryEligible],[httpStatus],[attempt],[detail],[occurredAt])
       VALUES (N'${ids.retryableError}', N'${ids.source}', N'${ids.run}', N'${ids.missingRecord}', N'fetch', N'server-error', 1, 503, 1, ${n(`${SENTINEL} server error ${run}`)}, SYSUTCDATETIME());`,
    `INSERT INTO [dbo].[MigrationError] ([id],[sourceId],[runId],[recordId],[stage],[classification],[retryEligible],[httpStatus],[attempt],[detail],[occurredAt])
       VALUES (N'${ids.accessError}', N'${ids.source}', N'${ids.run}', N'${ids.missingRecord}', N'fetch', N'access-denied', 0, 403, 1, ${n(`${SENTINEL} access denied ${run}`)}, SYSUTCDATETIME());`,
    // Two records in two languages: related, never duplicates.
    `INSERT INTO [dbo].[MigrationDuplicateCandidate] ([id],[recordId],[otherRecordId],[signal],[score],[crossLanguage],[state],[createdAt])
       VALUES (N'${ids.duplicate}', N'${ids.hostileRecord}', N'${ids.approvedRecord}', N'title-similarity', 90, 1, N'open', SYSUTCDATETIME());`,
    `INSERT INTO [dbo].[MigrationPublishManifest] ([id],[sourceId],[runId],[state],[createdByUserId],[createdAt]) VALUES (N'${ids.manifest}', N'${ids.source}', N'${ids.run}', N'draft', N'${operatorId}', SYSUTCDATETIME());`,
    `INSERT INTO [dbo].[MigrationManifestEntry] ([id],[manifestId],[position],[stagedRecordId],[recordId]) VALUES (N'${ids.entry}', N'${ids.manifest}', 0, N'${ids.approvedStaged}', N'${ids.approvedRecord}');`,
    // ONE stored file, acquired twice from two addresses: two acquisitions,
    // each with its own rights, both undecided.
    `INSERT INTO [dbo].[Asset] ([id],[storageKey],[mediaType],[byteSize],[checksum],[state],[updatedAt]) VALUES (N'${ids.asset}', N'${ASSET_KEY}', N'image/png', ${String(ASSET_BYTES.byteLength)}, N'${sha256(ASSET_BYTES)}', N'clean', SYSUTCDATETIME());`,
    acquisition(ids.acquisitionA, `images/first-${run}.png`),
    acquisition(ids.acquisitionB, `images/second-${run}.png`),
    // Finally the run completes, balanced, exactly once.
    `UPDATE [dbo].[MigrationRun] SET [state]=N'completed', [endedAt]=SYSUTCDATETIME(), [reconciliation]=N'balanced', [reconciledAt]=SYSUTCDATETIME(), [reconciliationDetail]=${n(detail)}, [version]=2 WHERE [id]=N'${ids.run}';`,
  ];
  await sql.query(
    `BEGIN TRY BEGIN TRAN;\n${steps.join('\n')}\nCOMMIT TRAN; END TRY BEGIN CATCH IF @@TRANCOUNT > 0 ROLLBACK TRAN; THROW; END CATCH;`,
  );
}

async function scalar(statement: string): Promise<string> {
  const [row] = await sql.query<{ value: string | number }>(statement);
  return String(row?.value ?? '');
}

/* ===========================================================================
 * Accounts and page helpers
 * ========================================================================= */

interface Actor {
  readonly page: Page;
  readonly id: string;
}

/** A fresh signed-in account on its own context and client address. */
async function account(browser: Browser, index: number, prefix: string): Promise<Actor> {
  const context = await browser.newContext({
    baseURL: baseUrl(),
    extraHTTPHeaders: { 'x-forwarded-for': `100.64.229.${String(index)}` },
  });
  contexts.push(context);
  const page = await context.newPage();
  const { email } = await registerAndSignIn(page, prefix);
  return { page, id: await accountIdFor(sql, email) };
}

const path = (rest = '', locale: UiLocale = 'en') => `/${locale}/admin/migration${rest}`;
const stagedPath = (locale: UiLocale = 'en') =>
  path(`/staging/${ids.hostileStaged}`, locale);
const snapshotRoute = `/api/admin/migration/snapshots/${ids.hostileSnapshot}`;
const runRoute = `/api/admin/migration/runs/${ids.run}`;

/** Every surface of the area, and the two private routes. */
const PAGES = [
  path(),
  path('/sources'),
  path('/runs'),
  path(`/runs/${ids.run}`),
  path('/staging'),
  stagedPath(),
  path('/duplicates'),
  path('/url-mapping'),
  path('/errors'),
  path('/manifests'),
  path(`/manifests/${ids.manifest}`),
  path('/reconciliation'),
] as const;

/** Nothing hostile reached the DOM as markup, and no script it carried ran. */
async function expectInert(page: Page, where: string): Promise<void> {
  for (const selector of [
    '#injected-payload',
    '#injected-link',
    '#injected-snapshot',
    '#injected-raw',
    '#injected-frame',
    'main img',
    'main iframe',
    'main script',
    'a[href^="javascript:" i]',
  ])
    await expect(page.locator(selector), `${where} ${selector}`).toHaveCount(0);
  expect(
    await page.evaluate(
      () => (globalThis as { __migrationPwned?: unknown }).__migrationPwned,
    ),
    where,
  ).toBeUndefined();
}

/* ===========================================================================
 * Fixture
 * ========================================================================= */

let stranger: Actor;
let reader: Actor;
let operator: Actor;
let publisher: Actor;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(900_000);
  sql = await privilegedSession();

  stranger = await account(browser, 1, 'migration-stranger');
  await grantRole(sql, stranger.id, ['taxonomy.read'], `${SENTINEL} another area`);
  reader = await account(browser, 2, 'migration-reader');
  await grantRole(sql, reader.id, ['migration.read'], `${SENTINEL} reading`);
  operator = await account(browser, 3, 'migration-operator');
  await grantRole(
    sql,
    operator.id,
    ['migration.read', 'migration.administer'],
    `${SENTINEL} administration`,
  );
  publisher = await account(browser, 4, 'migration-publisher');
  await grantRole(
    sql,
    publisher.id,
    ['migration.read', 'migration.publish'],
    `${SENTINEL} publication`,
  );
  // Publication is privileged: a complete second-factor posture, through the UI.
  await enrolSecondFactorInBrowser(publisher.page);

  await seedMigration(operator.id);
});

test.afterAll(async () => {
  for (const context of contexts) await context.close().catch(() => undefined);
  await sql?.close();
});

/* ===========================================================================
 * 1. Who reaches the area
 * ========================================================================= */

test.describe('Migration administration access', () => {
  test('a signed-out visitor is sent to sign in, and the private routes refuse', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    for (const target of [path('/sources'), stagedPath()]) {
      await page.goto(target);
      await expect(page, target).toHaveURL(/\/en\/signin\?returnTo=/u);
    }
    for (const route of [snapshotRoute, runRoute]) {
      const response = await page.request.get(route, { maxRedirects: 0 });
      expect(response.status(), route).toBe(404);
      expect(await response.body(), route).toHaveLength(0);
    }
  });

  test('an account without migration.read meets a 404 everywhere', async () => {
    test.setTimeout(300_000);
    const page = stranger.page;
    expect((await page.goto('/en/admin'))?.status()).toBe(200);
    await expect(
      page.getByRole('link', { name: copy('admin.nav.migration'), exact: true }),
    ).toHaveCount(0);
    for (const target of PAGES) {
      const response = await page.goto(target);
      expect(response?.status(), target).toBe(404);
      await expect(page.locator('body'), target).not.toContainText(SENTINEL);
    }
    for (const route of [snapshotRoute, runRoute]) {
      const response = await page.request.get(route);
      expect(response.status(), route).toBe(404);
      expect(await response.body(), route).toHaveLength(0);
    }
  });

  test('migration.read sees sources, runs and staging, and is offered no act', async () => {
    test.setTimeout(300_000);
    const page = reader.page;
    const main = page.getByRole('main');

    // The administrative navigation offers the area to a holder of the key.
    await page.goto(path());
    await expect(
      page
        .getByRole('navigation', { name: copy('admin.title'), exact: true })
        .getByRole('link', { name: copy('admin.nav.migration'), exact: true }),
    ).toBeVisible();

    for (const target of PAGES) {
      const response = await page.goto(target);
      expect(response?.status(), target).toBe(200);
      await expect(mainHeading(page), target).toBeVisible();
      // A reader is offered no act anywhere: every form is a GET filter.
      await expect(page.locator('main form:not([method="get"])'), target).toHaveCount(0);
    }

    await page.goto(path('/sources'));
    await expect(main).toContainText(TEXT.sourceKey);
    await expect(main).toContainText(copy('adminMigration.authority.fixture'));
    await page.goto(path('/runs'));
    await expect(main).toContainText(TEXT.sourceKey);
    await expect(main).toContainText(copy('adminMigration.reconciliationState.balanced'));
    await page.goto(path('/staging'));
    await expect(main).toContainText(TEXT.hostileTitle);
    await expect(main).toContainText(TEXT.approvedTitle);
    // A list row never carries a body.
    await expect(main).not.toContainText('__migrationPwned');

    // Raw evidence needs migration.administer: neither preview nor download.
    await page.goto(`${stagedPath()}?preview=1`);
    await expect(main).toContainText(copy('adminMigration.snapshot.administerOnly'));
    await expect(page.getByTestId('snapshot-preview')).toHaveCount(0);
    expect((await page.request.get(snapshotRoute)).status()).toBe(404);

    // The run status is JSON, private and uncached, with identifiers and numbers only.
    const status = await page.request.get(runRoute);
    expect(status.status()).toBe(200);
    expect(status.headers()['cache-control']).toBe('private, no-store');
    expect(status.headers()['content-type']).toContain('application/json');
    const body = (await status.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      id: ids.run,
      sourceKey: TEXT.sourceKey,
      state: 'completed',
      reconciliation: 'balanced',
      counts: { staged: 2, pending: 0 },
    });
    expect(JSON.stringify(body)).not.toContain(SENTINEL);
  });
});

/* ===========================================================================
 * 2. Legacy content is inert
 * ========================================================================= */

test.describe('a hostile staged record', () => {
  test('is shown as escaped text — no injected element, no script, no dialog', async () => {
    test.setTimeout(300_000);
    const page = operator.page;
    const dialogs: string[] = [];
    page.on('dialog', (dialog) => {
      dialogs.push(dialog.message());
      void dialog.dismiss();
    });

    const response = await page.goto(stagedPath());
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('main')).toContainText(
      copy('adminMigration.staged.inert'),
    );
    // The title, as text.
    await expect(page.getByRole('main')).toContainText(TEXT.hostileTitle);
    // The payload, as text: the markup is READABLE, and nothing of it is live.
    const payload = page.getByTestId('staged-payload');
    await expect(payload).toContainText('<script>window.__migrationPwned=true');
    await expect(payload).toContainText('onerror=');
    await expect(payload).toContainText('javascript:alert');
    await expectInert(page, 'staged record');

    // The audited raw preview, on request: escaped text, never a page.
    await page
      .getByRole('link', {
        name: copy('adminMigration.snapshot.showPreview'),
        exact: true,
      })
      .click();
    await page.waitForURL(/\?preview=1$/u);
    const preview = page.getByTestId('snapshot-preview');
    await expect(preview).toContainText(
      `<h1 id="injected-snapshot">${SENTINEL} ${run}</h1>`,
    );
    await expect(preview).toContainText(
      "<script>window.__migrationPwned=true;alert('raw')",
    );
    await expect(preview).toContainText('<iframe id="injected-frame"');
    await expectInert(page, 'raw preview');
    // The legacy address is text, never a link to a legacy host.
    await expect(page.locator(`a[href*="${HOST}"]`)).toHaveCount(0);
    expect(dialogs).toEqual([]);

    // Reading the evidence was recorded.
    expect(
      Number(
        await scalar(
          `SELECT COUNT(*) AS [value] FROM [dbo].[AuditLog] WHERE [action]=N'migration.snapshot.read' AND [targetId]=N'${ids.hostileSnapshot}' AND [actorId]=N'${operator.id}';`,
        ),
      ),
    ).toBeGreaterThanOrEqual(1);
  });

  test('downloads only as an attachment with exactly the inert headers', async () => {
    test.setTimeout(240_000);
    const response = await operator.page.request.get(snapshotRoute);
    expect(response.status()).toBe(200);
    const headers = response.headers();
    expect(headers['content-type']).toBe('application/octet-stream');
    expect(headers['content-disposition']).toBe(
      `attachment; filename="snapshot-${ids.hostileSnapshot}.bin"`,
    );
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['content-security-policy']).toBe("sandbox; default-src 'none'");
    expect(headers['cache-control']).toBe('private, no-store');
    expect(Buffer.from(await response.body()).equals(HOSTILE_BODY)).toBe(true);

    // A malformed or unknown snapshot is the same empty 404.
    for (const route of [
      '/api/admin/migration/snapshots/not-an-id',
      `/api/admin/migration/snapshots/${randomUUID()}`,
    ]) {
      const refused = await operator.page.request.get(route);
      expect(refused.status(), route).toBe(404);
      expect(await refused.body(), route).toHaveLength(0);
    }
    // A cross-site embed is refused before anything is read.
    const crossSite = await operator.page.request.get(snapshotRoute, {
      headers: { 'sec-fetch-site': 'cross-site' },
    });
    expect(crossSite.status()).toBe(404);
  });
});

/* ===========================================================================
 * 3. Decisions
 * ========================================================================= */

test.describe('Migration decisions', () => {
  test('an approval at a stale version is refused as a conflict', async () => {
    test.setTimeout(300_000);
    const first = operator.page;
    const second = await first.context().newPage();
    await first.goto(stagedPath());
    await second.goto(stagedPath());

    const approve = (page: Page) =>
      page.getByRole('button', {
        name: copy('adminMigration.review.approve'),
        exact: true,
      });

    await approve(first).click();
    // The page re-renders at the new state: approved, and only a withdrawal offered.
    await expect(
      first.getByRole('button', {
        name: copy('adminMigration.review.withdraw-approval'),
        exact: true,
      }),
    ).toBeVisible({ timeout: 60_000 });
    await expect(first.getByRole('main').locator('header')).toContainText(
      copy('adminMigration.reviewState.approved'),
    );

    // The second tab still shows version 1.
    await approve(second).click();
    await expect(
      second
        .getByRole('main')
        .getByRole('alert')
        .filter({
          hasText: copy('adminMigration.failure.conflict'),
        }),
    ).toBeVisible({ timeout: 60_000 });
    await second.close();

    expect(
      await scalar(
        `SELECT CONCAT([review], N':', [version]) AS [value] FROM [dbo].[MigrationStagedRecord] WHERE [id]=N'${ids.hostileStaged}';`,
      ),
    ).toBe('approved:2');
  });

  test('a cross-language pair is related, never merged', async () => {
    test.setTimeout(240_000);
    const page = operator.page;
    await page.goto(path('/duplicates'));
    const main = page.getByRole('main');
    await expect(main).toContainText(copy('adminMigration.duplicates.crossLanguage'));
    await expect(
      main.getByRole('button', {
        name: copy('adminMigration.duplicates.merge'),
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(
      main.getByRole('button', {
        name: copy('adminMigration.duplicates.distinct'),
        exact: true,
      }),
    ).toBeVisible();
  });

  test('an access failure offers no retry, and absence is said to be no deletion', async () => {
    test.setTimeout(240_000);
    const page = operator.page;
    await page.goto(path('/errors'));
    const main = page.getByRole('main');
    await expect(main).toContainText(copy('adminMigration.missing.absenceIsNotDeletion'));
    await expect(main).toContainText(`${SENTINEL} access denied ${run}`);
    // One retry button: the server error's. The access failure has none.
    await expect(
      main.getByRole('button', {
        name: copy('adminMigration.errors.retry'),
        exact: true,
      }),
    ).toHaveCount(1);
  });

  test('publishing without a live step-up is refused, and the step-up is offered', async () => {
    test.setTimeout(300_000);
    const page = publisher.page;
    await page.goto(path(`/manifests/${ids.manifest}`));
    const main = page.getByRole('main');
    // The remedy is on the same screen.
    await expect(
      main.getByRole('heading', { name: copy('admin.stepUp.title'), exact: true }),
    ).toBeVisible();
    await expect(main).toContainText(copy('admin.stepUp.migrationPublication'));

    await main
      .getByLabel(copy('adminMigration.publication.publish.confirm'), { exact: true })
      .check();
    await main
      .getByRole('button', {
        name: copy('adminMigration.publication.publish.submit'),
        exact: true,
      })
      .click();
    await expect(
      main
        .getByRole('alert')
        .filter({ hasText: copy('adminMigration.failure.stepUpRequired') }),
    ).toBeVisible({ timeout: 60_000 });

    expect(
      await scalar(
        `SELECT CONCAT([state], N':', [version]) AS [value] FROM [dbo].[MigrationPublishManifest] WHERE [id]=N'${ids.manifest}';`,
      ),
    ).toBe('draft:1');
    // An operator without migration.publish is not offered publication at all.
    await operator.page.goto(path(`/manifests/${ids.manifest}`));
    await expect(operator.page.getByRole('main')).toContainText(
      copy('adminMigration.publication.publisherOnly'),
    );
    await expect(
      operator.page.getByRole('button', {
        name: copy('adminMigration.publication.publish.submit'),
        exact: true,
      }),
    ).toHaveCount(0);
  });

  test('two acquisitions of the same bytes keep independent rights', async () => {
    test.setTimeout(300_000);
    const page = operator.page;
    await page.goto(stagedPath());
    const first = page.getByTestId(`asset-${ids.acquisitionA}`);
    const second = page.getByTestId(`asset-${ids.acquisitionB}`);
    const checksum = sha256(ASSET_BYTES);
    for (const panel of [first, second]) {
      await expect(panel).toContainText(checksum);
      await expect(panel).toContainText(copy('adminMigration.licence.unknown'));
      await expect(panel).toContainText(copy('adminMigration.visibility.restricted'));
      await expect(panel).toContainText(
        copy('adminMigration.assets.thisAcquisitionOnly'),
      );
    }
    const licence = (panel: typeof first) =>
      panel.getByLabel(copy('adminMigration.assets.licence'), { exact: true });
    const visibility = (panel: typeof first) =>
      panel.getByLabel(copy('adminMigration.assets.visibility'), { exact: true });
    const publicOption = (panel: typeof first) =>
      visibility(panel).locator('option[value="public-eligible"]');

    // Public eligibility is offered only for owned or licensed material.
    await licence(second).selectOption('third-party');
    await expect(publicOption(second)).toBeDisabled();

    await licence(first).selectOption('organisation-owned');
    await expect(publicOption(first)).toBeEnabled();
    await visibility(first).selectOption('public-eligible');
    await first
      .getByLabel(copy('adminMigration.assets.rightsHolder'), { exact: true })
      .fill(`${SENTINEL} holder ${run}`);
    await first
      .getByRole('button', { name: copy('adminMigration.assets.submit'), exact: true })
      .click();
    await expect(
      first.getByRole('status').filter({ hasText: copy('adminMigration.assets.done') }),
    ).toBeVisible({ timeout: 60_000 });

    await page.reload();
    await expect(first).toContainText(copy('adminMigration.licence.organisation-owned'));
    await expect(first).toContainText(copy('adminMigration.visibility.public-eligible'));
    await expect(first).toContainText(`${SENTINEL} holder ${run}`);
    // The other acquisition of identical bytes is untouched.
    await expect(second).toContainText(copy('adminMigration.licence.unknown'));
    await expect(second).toContainText(copy('adminMigration.visibility.restricted'));

    const rights = (id: string) =>
      scalar(
        `SELECT CONCAT([licence], N':', [visibility], N':', [version]) AS [value] FROM [dbo].[MigrationAssetProvenance] WHERE [id]=N'${id}';`,
      );
    expect(await rights(ids.acquisitionA)).toBe('organisation-owned:public-eligible:2');
    expect(await rights(ids.acquisitionB)).toBe('unknown:restricted:1');
  });

  test('disposing of a raw body needs a reason and a confirmation, and keeps its metadata', async () => {
    test.setTimeout(300_000);
    const page = operator.page;
    const target = path(`/staging/${ids.approvedStaged}`);
    const route = `/api/admin/migration/snapshots/${ids.approvedSnapshot}`;
    expect((await page.request.get(route)).status()).toBe(200);
    await page.goto(target);
    const main = page.getByRole('main');
    const submit = main.getByRole('button', {
      name: copy('adminMigration.dispose.submit'),
      exact: true,
    });
    const reason = main.getByLabel(copy('adminMigration.dispose.reason'), {
      exact: true,
    });
    const confirm = main.getByLabel(copy('adminMigration.dispose.confirm'), {
      exact: true,
    });
    await expect(main).toContainText(copy('adminMigration.dispose.help'));

    // No confirmation: refused before anything is read.
    await reason.fill(`${SENTINEL} disposal ${run}`);
    await submit.click();
    await expect(
      main
        .getByRole('alert')
        .filter({ hasText: copy('adminMigration.failure.confirmRequired') }),
    ).toBeVisible({ timeout: 60_000 });

    // No reason: refused by the service.
    await reason.fill('');
    await confirm.check();
    await submit.click();
    await expect(
      main.getByRole('alert').filter({ hasText: copy('adminMigration.failure.invalid') }),
    ).toBeVisible({ timeout: 60_000 });
    expect(
      await scalar(
        `SELECT CASE WHEN [body] IS NULL THEN N'gone' ELSE N'held' END AS [value] FROM [dbo].[MigrationRawSnapshot] WHERE [id]=N'${ids.approvedSnapshot}';`,
      ),
    ).toBe('held');

    await reason.fill(`${SENTINEL} disposal ${run}`);
    await confirm.check();
    await submit.click();
    // The page re-renders at the new state: disposed, metadata kept, no form.
    await expect(main).toContainText(copy('adminMigration.snapshot.disposedHelp'), {
      timeout: 60_000,
    });
    await expect(submit).toHaveCount(0);
    await expect(main).toContainText(sha256(APPROVED_BODY));
    await expect(main).toContainText(copy('adminMigration.snapshot.disposed'));
    await expect(
      main.getByRole('link', {
        name: copy('adminMigration.snapshot.download'),
        exact: true,
      }),
    ).toHaveCount(0);

    // The preview and the download both say the body is gone.
    await page.goto(`${target}?preview=1`);
    await expect(page.getByTestId('snapshot-preview-disposed')).toHaveText(
      copy('adminMigration.snapshot.previewDisposed'),
    );
    await expect(page.getByTestId('snapshot-preview')).toHaveCount(0);
    const download = await page.request.get(route);
    expect(download.status()).toBe(404);
    expect(await download.body()).toHaveLength(0);

    expect(
      await scalar(
        `SELECT CONCAT(CASE WHEN [body] IS NULL THEN N'gone' ELSE N'held' END, N':', [checksum], N':', [byteSize]) AS [value] FROM [dbo].[MigrationRawSnapshot] WHERE [id]=N'${ids.approvedSnapshot}';`,
      ),
    ).toBe(`gone:${sha256(APPROVED_BODY)}:${String(APPROVED_BODY.byteLength)}`);
    expect(
      Number(
        await scalar(
          `SELECT COUNT(*) AS [value] FROM [dbo].[AuditLog] WHERE [action]=N'migration.snapshot.disposed' AND [targetId]=N'${ids.approvedSnapshot}' AND [actorId]=N'${operator.id}';`,
        ),
      ),
    ).toBe(1);
  });
});

/* ===========================================================================
 * 4. Presentation
 * ========================================================================= */

test.describe('Migration presentation', () => {
  test('is noindex and in no sitemap', async ({ request }) => {
    test.setTimeout(240_000);
    const page = reader.page;
    for (const target of [path(), path('/staging'), stagedPath()]) {
      await page.goto(target);
      await expect(page.locator('meta[name="robots"]').first(), target).toHaveAttribute(
        'content',
        /noindex/u,
      );
      await expect(page.locator('meta[name="robots"]').first(), target).toHaveAttribute(
        'content',
        /nofollow/u,
      );
    }
    const sitemap = await request.get('/sitemap.xml', { maxRedirects: 0 });
    if (sitemap.status() === 200)
      expect(await sitemap.text()).not.toContain('/admin/migration');
    else expect(sitemap.status()).toBe(404);
  });

  test('reads right-to-left in Urdu and Arabic and labels every control', async () => {
    test.setTimeout(300_000);
    for (const [page, target] of [
      [reader.page, path('/staging', 'ur')],
      [reader.page, path('/runs', 'ar')],
      [operator.page, stagedPath('ur')],
      [operator.page, stagedPath('ar')],
      [operator.page, path('/errors', 'ar')],
    ] as const) {
      const response = await page.goto(target);
      expect(response?.status(), target).toBe(200);
      await expect(page.locator('html'), target).toHaveAttribute('dir', 'rtl');
      await expect(page.locator('html'), target).toHaveAttribute(
        'lang',
        target.split('/')[1] ?? '',
      );
      await expect(mainHeading(page), target).toBeVisible();
      await expectHeadingsInOrder(page, target);
      await expectLabelledControls(page, target);
    }
    await operator.page.goto(stagedPath('ur'));
    await expect(operator.page.getByRole('main')).toContainText(
      copy('adminMigration.staged.inert', {}, 'ur'),
    );
    await expectInert(operator.page, 'ur staged record');

    for (const target of [path('/sources'), path('/manifests'), stagedPath()]) {
      await operator.page.goto(target);
      await expectHeadingsInOrder(operator.page, target);
      await expectLabelledControls(operator.page, target);
    }
  });

  test('reflows at 320px and keeps a visible keyboard focus', async () => {
    test.setTimeout(300_000);
    const page = operator.page;
    for (const target of [
      stagedPath(),
      stagedPath('ar'),
      path('/sources'),
      path('/url-mapping'),
    ]) {
      await page.setViewportSize({ width: 320, height: 800 });
      const response = await page.goto(target);
      expect(response?.status(), target).toBe(200);
      await expect(mainHeading(page), target).toBeVisible();
      expect(await overflowOf(page), `320px ${target}`).toBeLessThanOrEqual(0);
    }

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(stagedPath());
    // The area's own navigation first, then the escaped payload box, by Tab alone.
    const staging = page
      .getByRole('navigation', { name: copy('adminMigration.title'), exact: true })
      .getByRole('link', { name: copy('adminMigration.surface.staging'), exact: true });
    await tabTo(page, staging);
    await expectVisibleFocus(staging, 'the staging link');
    const payload = page.getByTestId('staged-payload');
    await tabTo(page, payload);
    await expectVisibleFocus(payload, 'the payload box');
    const note = page
      .getByLabel(copy('adminMigration.review.note'), { exact: true })
      .first();
    if ((await note.count()) > 0) {
      await tabTo(page, note);
      await expectVisibleFocus(note, 'the review note');
    }
  });
});
