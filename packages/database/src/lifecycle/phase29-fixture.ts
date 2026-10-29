import 'server-only';

import { randomUUID } from 'node:crypto';
import { deepStrictEqual } from 'node:assert';

import { sha256, syntheticStorageKey } from './phase11-fixture.ts';
import type { SqlSession } from './sql-connection.ts';

/**
 * POPULATED PHASE-29 STATE for the recovery rehearsals.
 *
 * WHAT THE RECOVERY FIXTURE PROVES THAT A SCHEMA CHECK DOES NOT. That where
 * migrated content came from came back EXACTLY — every raw snapshot still
 * holding the very bytes its SHA-256 names (or, once disposed of, still naming
 * the checksum of the bytes it held), every staged revision still carrying the
 * checksum of the snapshot it was produced from, every legacy address still
 * redirecting to the one canonical address it was mapped to, and every
 * publication and promotion still attributed to the authority that made it:
 *
 *   - one FIXTURE source with two `*.fixture.invalid` hosts and no
 *     authorisation evidence;
 *   - one COMPLETED, BALANCED run with three items — two staged, one errored;
 *   - three records: one PUBLISHED, one STAGED, and one MISSING after a
 *     complete discovery and classified `withdrawn` by a person;
 *   - three raw snapshots: two holding real bytes whose checksum is their
 *     SHA-256, and one whose body was DISPOSED of with who, when and why;
 *   - three staged revisions: a SUPERSEDED first revision, the APPROVED second
 *     revision that was published, and a PENDING revision of the other record;
 *   - one legacy category confirmed onto a Taxonomy Topic, and links of all
 *     four dispositions — one rewritten through the legacy mapping;
 *   - one dismissed not-found error, and one open title-similarity duplicate
 *     candidate;
 *   - ONE stored Asset acquired TWICE under two different licences — owned and
 *     released, third-party and restricted;
 *   - one PUBLISHED manifest whose one entry made a Media Video, an ACTIVE
 *     legacy mapping from the record's legacy address to the Video's canonical
 *     path, and one PROMOTED promotion of that entry;
 *   - a synthetic publication authority (a role holding `migration.publish`,
 *     its assignment, a live session and a live `migration-publication`
 *     step-up) — which the publication and approval triggers demand of the
 *     rows written here.
 *
 * NOTHING HERE IS ANYBODY'S CONTENT. Every name, title, label and note is a
 * `NON_MIGRATION_FIXTURE_…` sentinel, every address is under
 * `*.fixture.invalid` or `@migration-proof.invalid`, and the raw bytes are a
 * sentinel paragraph. Rows are written directly by the owner — the recovery
 * databases are disposable and created by the run that writes them — and the
 * adapter's own write paths are proved by `db:test:permissions` and the
 * integration suites.
 */

const TEXT = {
  operator: 'NON_MIGRATION_FIXTURE_ACCOUNT operator',
  publisher: 'NON_MIGRATION_FIXTURE_ACCOUNT publisher',
  source: 'NON_MIGRATION_FIXTURE_SOURCE legacy video archive',
  title: 'NON_MIGRATION_FIXTURE_TITLE recovered lecture',
  urdu: 'NON_MIGRATION_FIXTURE_TITLE بحالی کا آزمائشی عنوان',
  note: 'NON_MIGRATION_FIXTURE_NOTE',
} as const;

/** The snapshot's raw bytes: a sentinel paragraph, never fetched from anywhere. */
const RAW = (stem: string): Buffer =>
  Buffer.from(`<p>NON_MIGRATION_FIXTURE_RAW recovered lecture ${stem}</p>`, 'utf8');

/** The acquired asset's bytes: a sentinel, never a real image. */
const ASSET = (stem: string): Buffer =>
  Buffer.from(`NON_MIGRATION_FIXTURE_ASSET ${stem}`, 'utf8');

export interface Phase29Fixture {
  readonly runId: string;
  readonly operatorId: string;
  readonly publisherId: string;
  readonly roleId: string;
  readonly sessionId: string;
  readonly grantId: string;
  readonly videoId: string;
  readonly assetId: string;
  readonly sourceId: string;
  readonly importRunId: string;
  readonly recordId: string;
  readonly missingId: string;
  readonly twinId: string;
  readonly heldSnapshotId: string;
  readonly twinSnapshotId: string;
  readonly disposedSnapshotId: string;
  readonly supersededId: string;
  readonly approvedId: string;
  readonly pendingId: string;
  readonly recordItemId: string;
  readonly missingItemId: string;
  readonly twinItemId: string;
  readonly errorId: string;
  readonly mappingId: string;
  readonly duplicateId: string;
  readonly ownedAcquisitionId: string;
  readonly thirdPartyAcquisitionId: string;
  readonly manifestId: string;
  readonly entryId: string;
  readonly legacyMappingId: string;
  readonly promotionId: string;
  readonly promotionEntryId: string;
}

export function newPhase29Fixture(): Phase29Fixture {
  return {
    runId: randomUUID().replaceAll('-', ''),
    operatorId: randomUUID(),
    publisherId: randomUUID(),
    roleId: randomUUID(),
    sessionId: randomUUID(),
    grantId: randomUUID(),
    videoId: randomUUID(),
    assetId: randomUUID(),
    sourceId: randomUUID(),
    importRunId: randomUUID(),
    recordId: randomUUID(),
    missingId: randomUUID(),
    twinId: randomUUID(),
    heldSnapshotId: randomUUID(),
    twinSnapshotId: randomUUID(),
    disposedSnapshotId: randomUUID(),
    supersededId: randomUUID(),
    approvedId: randomUUID(),
    pendingId: randomUUID(),
    recordItemId: randomUUID(),
    missingItemId: randomUUID(),
    twinItemId: randomUUID(),
    errorId: randomUUID(),
    mappingId: randomUUID(),
    duplicateId: randomUUID(),
    ownedAcquisitionId: randomUUID(),
    thirdPartyAcquisitionId: randomUUID(),
    manifestId: randomUUID(),
    entryId: randomUUID(),
    legacyMappingId: randomUUID(),
    promotionId: randomUUID(),
    promotionEntryId: randomUUID(),
  };
}

/** Rejects anything that is not this module's own generated shape. */
function assertSafe(fixture: Phase29Fixture, topicId?: string): void {
  if (!/^[0-9a-f]{32}$/.test(fixture.runId))
    throw new Error('Phase-29 fixture runId does not match the expected pattern.');
  for (const [name, value] of Object.entries(fixture)) {
    if (name === 'runId') continue;
    if (!/^[0-9a-f-]{36}$/.test(value))
      throw new Error(`Phase-29 fixture field '${name}' is not a generated identifier.`);
  }
  if (topicId !== undefined && !/^[a-z0-9-]{1,36}$/i.test(topicId))
    throw new Error('Invalid synthetic Phase-29 fixture Topic reference.');
}

const AT = '2026-10-11T06:00:00';
const FETCHED = '2026-10-11T06:05:00';
const REVIEWED = '2026-10-11T06:30:00';
const PUBLISHED = '2026-10-11T07:00:00';
const ENDED = '2026-10-11T08:00:00';

/** The fixture's own addresses, every one under `*.fixture.invalid`. */
function addresses(stem: string): {
  readonly host: string;
  readonly mediaHost: string;
  readonly base: string;
  readonly page: string;
  readonly missingPage: string;
  readonly twinPage: string;
  readonly ownedAsset: string;
  readonly copiedAsset: string;
  readonly slug: string;
  readonly path: string;
} {
  const host = `legacy-${stem}.fixture.invalid`;
  const mediaHost = `media-${stem}.fixture.invalid`;
  const slug = `phase29-recovered-${stem}`;
  return {
    host,
    mediaHost,
    base: `https://${host}/`,
    page: `https://${host}/videos/lecture-${stem}`,
    missingPage: `https://${host}/videos/withdrawn-${stem}`,
    twinPage: `https://${host}/videos/lecture-copy-${stem}`,
    ownedAsset: `https://${mediaHost}/images/lecture-${stem}.png`,
    copiedAsset: `https://${mediaHost}/mirror/lecture-${stem}.png`,
    slug,
    path: `/watch/videos/${slug}`,
  };
}

/**
 * Writes the populated Phase-29 state into the SOURCE database, before backup,
 * with the MIGRATION principal, so the real composite keys, CHECKs and triggers
 * are exercised: the source a fixture with fixture hosts; every record, item,
 * snapshot, error and acquisition inside its own source; every revision
 * produced pending at version one from a snapshot whose checksum it carries and
 * reviewed forward one version at a time; the snapshot disposed of only by
 * clearing its body; the manifest published and the promotion approved only
 * because their actor holds `migration.publish` with a live
 * `migration-publication` step-up; the run completed and reconciled last.
 */
export async function writePhase29Fixture(
  sql: SqlSession,
  fixture: Phase29Fixture,
  references: { readonly topicId: string },
): Promise<void> {
  assertSafe(fixture, references.topicId);
  const f = fixture;
  const stem = f.runId.slice(0, 16);
  const a = addresses(stem);
  const raw = RAW(stem);
  const rawHex = `0x${raw.toString('hex')}`;
  const rawChecksum = sha256(raw);
  const assetBytes = ASSET(stem);
  const assetChecksum = sha256(assetBytes);
  const account = (id: string, label: string, name: string): string =>
    `(N'${id}', N'${name}', N'${label}-${stem}@migration-proof.invalid', 0, '${AT}', '${AT}', N'en', N'active', 0)`;
  const provenance = `N'fixture-video', N'1', N'fixture-video-parser', N'1', N'1', N'recovery-${stem}'`;
  const payload = (title: string, revision: number): string =>
    JSON.stringify({
      title,
      provider: 'youtube',
      providerVideoId: `p29${stem.slice(0, 8)}`,
      revision,
    });
  const firstPayload = payload(TEXT.title, 1);
  const secondPayload = payload(TEXT.title, 2);
  const twinPayload = payload(TEXT.urdu, 1);

  // ---- accounts, the publication authority, and the targets' own rows -----------------
  await sql.query(`
    INSERT INTO [dbo].[User] ([id],[name],[email],[emailVerified],[createdAt],[updatedAt],[locale],[status],[twoFactorEnabled]) VALUES
      ${account(f.operatorId, 'operator', TEXT.operator)},
      ${account(f.publisherId, 'publisher', TEXT.publisher)};
    INSERT INTO [dbo].[Role] ([id],[key],[name],[description],[system])
      VALUES (N'${f.roleId}', N'recovery-migration-publish-${stem}', N'NON_MIGRATION_FIXTURE publication role', N'Holds migration.publish for the recovery proof only.', 0);
    INSERT INTO [dbo].[RolePermission] ([roleId],[permissionKey]) VALUES (N'${f.roleId}', N'migration.publish');
    INSERT INTO [dbo].[RoleAssignment] ([userId],[roleId]) VALUES (N'${f.publisherId}', N'${f.roleId}');
    INSERT INTO [dbo].[Session] ([id],[token],[userId],[expiresAt],[createdAt],[updatedAt])
      VALUES (N'${f.sessionId}', N'recovery-migration-${f.sessionId}', N'${f.publisherId}', DATEADD(day,1,SYSUTCDATETIME()), SYSUTCDATETIME(), SYSUTCDATETIME());
    INSERT INTO [dbo].[StepUpGrant] ([id],[userId],[sessionId],[purpose],[expiresAt])
      VALUES (N'${f.grantId}', N'${f.publisherId}', N'${f.sessionId}', N'migration-publication', DATEADD(hour,2,SYSUTCDATETIME()));
    INSERT INTO [dbo].[Video] ([id],[slug],[primaryLocale],[state],[isFeatured],[provider],[providerVideoId],[availability],[format],[languageCode],[durationSeconds],[publishedOn],[captions],[transcript],[seriesId],[seriesPosition],[version],[updatedAt])
      VALUES (N'${f.videoId}', N'${a.slug}', N'en', N'published', 0, N'youtube', 'p29${stem.slice(0, 8)}', N'available', N'lecture', N'en', 1800, '2019-04-05', 0, NULL, NULL, NULL, 1, SYSUTCDATETIME());
    INSERT INTO [dbo].[VideoLabel] ([videoId],[locale],[title],[description])
      VALUES (N'${f.videoId}', N'en', N'${TEXT.title}', N'');
    INSERT INTO [dbo].[Asset] ([id],[storageKey],[mediaType],[byteSize],[checksum],[state],[displayName],[updatedAt])
      VALUES (N'${f.assetId}', N'${syntheticStorageKey()}', N'image/png', ${String(assetBytes.byteLength)}, N'${assetChecksum}', N'clean', N'non-migration-fixture.png', SYSUTCDATETIME());
  `);

  // ---- the fixture source, its run, its records and their raw evidence ------------------
  await sql.query(`
    INSERT INTO [dbo].[MigrationSource] ([id],[key],[name],[authorityKind],[accessMethod],[contentKind],[baseUrl],[licensingEvidence],[policyNotes],[defaultLanguageCode],[minIntervalMs],[maxConcurrency],[maxAttempts],[timeoutMs],[maxBodyBytes],[maxRedirects],[state],[createdAt],[createdByUserId],[updatedAt],[updatedByUserId])
      VALUES (N'${f.sourceId}', N'recovery-${stem}', N'${TEXT.source}', N'fixture', N'http', N'media.video', N'${a.base}', NULL, N'${TEXT.note} policy', N'en', 1000, 1, 3, 10000, 1048576, 2, N'active', '${AT}', N'${f.operatorId}', '${AT}', N'${f.operatorId}');
    INSERT INTO [dbo].[MigrationSourceHost] ([sourceId],[host]) VALUES
      (N'${f.sourceId}', N'${a.host}'),
      (N'${f.sourceId}', N'${a.mediaHost}');
    INSERT INTO [dbo].[MigrationRun] ([id],[sourceId],[operatorUserId],[state],[adapterKey],[adapterVersion],[parserKey],[parserVersion],[normalizerVersion],[codeRevision],[startedAt])
      VALUES (N'${f.importRunId}', N'${f.sourceId}', N'${f.operatorId}', N'open', ${provenance}, '${AT}');
    INSERT INTO [dbo].[MigrationRecord] ([id],[sourceId],[externalKey],[originalUrl],[legacyIdentifier],[contentKind],[status],[firstObservedRunId],[lastObservedRunId],[createdAt],[updatedAt]) VALUES
      (N'${f.recordId}', N'${f.sourceId}', N'lecture-${stem}', N'${a.page}', N'legacy-1001', N'media.video', N'discovered', N'${f.importRunId}', N'${f.importRunId}', '${AT}', '${AT}'),
      (N'${f.missingId}', N'${f.sourceId}', N'withdrawn-${stem}', N'${a.missingPage}', N'legacy-1002', N'media.video', N'discovered', N'${f.importRunId}', N'${f.importRunId}', '${AT}', '${AT}'),
      (N'${f.twinId}', N'${f.sourceId}', N'lecture-copy-${stem}', N'${a.twinPage}', N'legacy-1003', N'media.video', N'discovered', N'${f.importRunId}', N'${f.importRunId}', '${AT}', '${AT}');
    INSERT INTO [dbo].[MigrationRawSnapshot] ([id],[sourceId],[recordId],[runId],[requestedUrl],[finalUrl],[httpStatus],[contentType],[headers],[body],[byteSize],[checksum],[fetchedAt],[fetcherKey],[fetcherVersion],[personalData]) VALUES
      (N'${f.heldSnapshotId}', N'${f.sourceId}', N'${f.recordId}', N'${f.importRunId}', N'${a.page}', N'${a.page}', 200, N'text/html; charset=utf-8', N'{"content-type":"text/html; charset=utf-8"}', ${rawHex}, ${String(raw.byteLength)}, '${rawChecksum}', '${FETCHED}', N'fixture-fetch', N'1', N'none'),
      (N'${f.twinSnapshotId}', N'${f.sourceId}', N'${f.twinId}', N'${f.importRunId}', N'${a.twinPage}', N'${a.twinPage}', 200, N'text/html; charset=utf-8', N'{"content-type":"text/html; charset=utf-8"}', ${rawHex}, ${String(raw.byteLength)}, '${rawChecksum}', '${FETCHED}', N'fixture-fetch', N'1', N'none'),
      (N'${f.disposedSnapshotId}', N'${f.sourceId}', N'${f.missingId}', N'${f.importRunId}', N'${a.missingPage}', N'${a.missingPage}', 200, N'text/html; charset=utf-8', N'{"content-type":"text/html; charset=utf-8"}', ${rawHex}, ${String(raw.byteLength)}, '${rawChecksum}', '${FETCHED}', N'fixture-fetch', N'1', N'flagged');
  `);

  // ---- staged revisions, reviewed forward; the error; the items ---------------------------
  const staged = (
    id: string,
    recordId: string,
    snapshotId: string,
    revision: number,
    title: string,
    content: string,
    language: string,
  ): string =>
    `(N'${id}', N'${recordId}', N'${snapshotId}', N'${f.importRunId}', ${String(revision)}, N'media.video', N'${title}', N'non migration fixture title recovered lecture', N'youtube:p29${stem.slice(0, 8)}', N'${language}', N'${content}', '${sha256(Buffer.from(content, 'utf8'))}', ${provenance}, '${rawChecksum}', '${FETCHED}', N'valid', NULL, N'none')`;
  await sql.query(`
    INSERT INTO [dbo].[MigrationStagedRecord] ([id],[recordId],[snapshotId],[runId],[revision],[contentKind],[title],[titleKey],[dedupeKey],[languageCode],[payload],[payloadChecksum],[adapterKey],[adapterVersion],[parserKey],[parserVersion],[normalizerVersion],[codeRevision],[inputChecksum],[producedAt],[validation],[issues],[personalData]) VALUES
      ${staged(f.supersededId, f.recordId, f.heldSnapshotId, 1, TEXT.title, firstPayload, 'en')},
      ${staged(f.approvedId, f.recordId, f.heldSnapshotId, 2, TEXT.title, secondPayload, 'en')},
      ${staged(f.pendingId, f.twinId, f.twinSnapshotId, 1, TEXT.urdu, twinPayload, 'ur')};
    UPDATE [dbo].[MigrationStagedRecord] SET [review]=N'superseded', [version]=2 WHERE [id]=N'${f.supersededId}';
    UPDATE [dbo].[MigrationStagedRecord] SET [review]=N'approved', [reviewedByUserId]=N'${f.operatorId}', [reviewedAt]='${REVIEWED}', [reviewNote]=N'${TEXT.note} review', [version]=2 WHERE [id]=N'${f.approvedId}';
    INSERT INTO [dbo].[MigrationError] ([id],[sourceId],[runId],[recordId],[stage],[classification],[retryEligible],[httpStatus],[attempt],[detail],[occurredAt])
      VALUES (N'${f.errorId}', N'${f.sourceId}', N'${f.importRunId}', N'${f.missingId}', N'fetch', N'not-found', 0, 404, 1, N'${TEXT.note} not found', '${FETCHED}');
    UPDATE [dbo].[MigrationError] SET [resolution]=N'dismissed', [resolvedByUserId]=N'${f.operatorId}', [resolvedAt]='${REVIEWED}', [version]=2 WHERE [id]=N'${f.errorId}';
    INSERT INTO [dbo].[MigrationRunItem] ([id],[runId],[recordId],[position],[updatedAt]) VALUES
      (N'${f.recordItemId}', N'${f.importRunId}', N'${f.recordId}', 0, '${AT}'),
      (N'${f.missingItemId}', N'${f.importRunId}', N'${f.missingId}', 1, '${AT}'),
      (N'${f.twinItemId}', N'${f.importRunId}', N'${f.twinId}', 2, '${AT}');
    UPDATE [dbo].[MigrationRunItem] SET [outcome]=N'staged', [fetched]=1, [parsed]=1, [attempts]=1, [snapshotId]=N'${f.heldSnapshotId}', [stagedRecordId]=N'${f.approvedId}', [updatedAt]='${FETCHED}' WHERE [id]=N'${f.recordItemId}';
    UPDATE [dbo].[MigrationRunItem] SET [outcome]=N'errored', [attempts]=1, [errorId]=N'${f.errorId}', [updatedAt]='${FETCHED}' WHERE [id]=N'${f.missingItemId}';
    UPDATE [dbo].[MigrationRunItem] SET [outcome]=N'staged', [fetched]=1, [parsed]=1, [attempts]=1, [snapshotId]=N'${f.twinSnapshotId}', [stagedRecordId]=N'${f.pendingId}', [updatedAt]='${FETCHED}' WHERE [id]=N'${f.twinItemId}';
    UPDATE [dbo].[MigrationRawSnapshot] SET [body]=NULL, [disposedAt]='${REVIEWED}', [disposedByUserId]=N'${f.operatorId}', [disposalReason]=N'${TEXT.note} personal data disposed' WHERE [id]=N'${f.disposedSnapshotId}';
    UPDATE [dbo].[MigrationRecord] SET [status]=N'staged', [latestSnapshotId]=N'${f.twinSnapshotId}', [currentStagedRecordId]=N'${f.pendingId}', [version]=2, [updatedAt]='${FETCHED}' WHERE [id]=N'${f.twinId}';
    UPDATE [dbo].[MigrationRecord] SET [status]=N'errored', [latestSnapshotId]=N'${f.disposedSnapshotId}', [observed]=N'missing', [disappearance]=N'withdrawn', [disappearanceNote]=N'${TEXT.note} withdrawn', [classifiedByUserId]=N'${f.operatorId}', [classifiedAt]='${REVIEWED}', [version]=2, [updatedAt]='${REVIEWED}' WHERE [id]=N'${f.missingId}';
  `);

  // ---- decisions: the topic mapping, the duplicate pair, the two acquisitions ------------
  await sql.query(`
    INSERT INTO [dbo].[MigrationTopicMapping] ([id],[sourceId],[categoryKey],[label])
      VALUES (N'${f.mappingId}', N'${f.sourceId}', N'lectures', N'${TEXT.note} lectures');
    UPDATE [dbo].[MigrationTopicMapping] SET [state]=N'confirmed', [topicId]=N'${references.topicId}', [decidedByUserId]=N'${f.operatorId}', [decidedAt]='${REVIEWED}', [version]=2 WHERE [id]=N'${f.mappingId}';
    INSERT INTO [dbo].[MigrationStagedCategory] ([stagedRecordId],[topicMappingId]) VALUES (N'${f.approvedId}', N'${f.mappingId}');
    INSERT INTO [dbo].[MigrationDuplicateCandidate] ([id],[recordId],[otherRecordId],[signal],[score],[crossLanguage],[state],[createdAt])
      VALUES (N'${f.duplicateId}', N'${f.twinId}', N'${f.recordId}', N'title-similarity', 88, 1, N'open', '${FETCHED}');
    INSERT INTO [dbo].[MigrationAssetProvenance] ([id],[sourceId],[recordId],[runId],[originalUrl],[originalUrlDigest],[assetId],[checksum],[byteSize],[mediaType],[licence],[licenceEvidence],[rightsHolder],[acquiredAt]) VALUES
      (N'${f.ownedAcquisitionId}', N'${f.sourceId}', N'${f.recordId}', N'${f.importRunId}', N'${a.ownedAsset}', '${sha256(Buffer.from(a.ownedAsset, 'utf8'))}', N'${f.assetId}', '${assetChecksum}', ${String(assetBytes.byteLength)}, N'image/png', N'unknown', NULL, NULL, '${FETCHED}'),
      (N'${f.thirdPartyAcquisitionId}', N'${f.sourceId}', N'${f.twinId}', N'${f.importRunId}', N'${a.copiedAsset}', '${sha256(Buffer.from(a.copiedAsset, 'utf8'))}', N'${f.assetId}', '${assetChecksum}', ${String(assetBytes.byteLength)}, N'image/png', N'third-party', N'${TEXT.note} licence evidence', N'${TEXT.note} rights holder', '${FETCHED}');
    UPDATE [dbo].[MigrationAssetProvenance] SET [licence]=N'organisation-owned', [licenceEvidence]=N'${TEXT.note} ownership evidence', [visibility]=N'public-eligible', [decidedByUserId]=N'${f.operatorId}', [decidedAt]='${REVIEWED}', [version]=2 WHERE [id]=N'${f.ownedAcquisitionId}';
  `);

  // ---- publication, the legacy mapping, the links and the promotion -----------------------
  await sql.query(`
    INSERT INTO [dbo].[MigrationPublishManifest] ([id],[sourceId],[runId],[state],[createdByUserId],[createdAt])
      VALUES (N'${f.manifestId}', N'${f.sourceId}', N'${f.importRunId}', N'draft', N'${f.operatorId}', '${REVIEWED}');
    INSERT INTO [dbo].[MigrationManifestEntry] ([id],[manifestId],[position],[stagedRecordId],[recordId])
      VALUES (N'${f.entryId}', N'${f.manifestId}', 0, N'${f.approvedId}', N'${f.recordId}');
    UPDATE [dbo].[MigrationPublishManifest] SET [state]=N'publishing', [publishedByUserId]=N'${f.publisherId}', [publishStartedAt]='${PUBLISHED}', [version]=2 WHERE [id]=N'${f.manifestId}';
    UPDATE [dbo].[MigrationManifestEntry] SET [state]=N'publishing', [version]=2 WHERE [id]=N'${f.entryId}';
    UPDATE [dbo].[MigrationManifestEntry] SET [state]=N'published', [videoId]=N'${f.videoId}', [targetStage]=N'public', [targetVersion]=1, [canonicalPath]=N'${a.path}', [publishedAt]='${PUBLISHED}', [version]=3 WHERE [id]=N'${f.entryId}';
    UPDATE [dbo].[MigrationPublishManifest] SET [state]=N'published', [publishedAt]='${PUBLISHED}', [version]=3 WHERE [id]=N'${f.manifestId}';
    UPDATE [dbo].[MigrationRecord] SET [status]=N'published', [latestSnapshotId]=N'${f.heldSnapshotId}', [currentStagedRecordId]=N'${f.approvedId}', [version]=2, [updatedAt]='${PUBLISHED}' WHERE [id]=N'${f.recordId}';
    INSERT INTO [dbo].[MigrationLegacyMapping] ([id],[sourceId],[recordId],[legacyUrl],[legacyUrlDigest],[videoId],[canonicalPath],[state],[manifestEntryId],[createdAt],[createdByUserId])
      VALUES (N'${f.legacyMappingId}', N'${f.sourceId}', N'${f.recordId}', N'${a.page}', '${sha256(Buffer.from(a.page, 'utf8'))}', N'${f.videoId}', N'${a.path}', N'active', N'${f.entryId}', '${PUBLISHED}', N'${f.publisherId}');
    INSERT INTO [dbo].[MigrationStagedLink] ([stagedRecordId],[position],[href],[disposition],[rewrittenTo],[legacyMappingId]) VALUES
      (N'${f.approvedId}', 0, N'${a.page}', N'rewritten', N'${a.path}', N'${f.legacyMappingId}'),
      (N'${f.approvedId}', 1, N'https://elsewhere-${stem}.fixture.invalid/reference', N'external', NULL, NULL),
      (N'${f.approvedId}', 2, N'/legacy/unknown-${stem}', N'unresolved', NULL, NULL),
      (N'${f.approvedId}', 3, N'javascript:void(0)', N'dropped', NULL, NULL);
    INSERT INTO [dbo].[MigrationPromotion] ([id],[state],[destination],[createdByUserId],[createdAt])
      VALUES (N'${f.promotionId}', N'draft', N'bundle', N'${f.operatorId}', '${PUBLISHED}');
    INSERT INTO [dbo].[MigrationPromotionEntry] ([id],[promotionId],[position],[manifestEntryId])
      VALUES (N'${f.promotionEntryId}', N'${f.promotionId}', 0, N'${f.entryId}');
    UPDATE [dbo].[MigrationPromotion] SET [state]=N'approved', [approvedByUserId]=N'${f.publisherId}', [approvedAt]='${PUBLISHED}', [version]=2 WHERE [id]=N'${f.promotionId}';
    UPDATE [dbo].[MigrationPromotion] SET [state]=N'promoting', [version]=3 WHERE [id]=N'${f.promotionId}';
    UPDATE [dbo].[MigrationPromotionEntry] SET [state]=N'promoted', [promotedAt]='${ENDED}', [destinationRef]=N'bundle/${f.promotionEntryId}.json' WHERE [id]=N'${f.promotionEntryId}';
    UPDATE [dbo].[MigrationPromotion] SET [state]=N'promoted', [completedAt]='${ENDED}', [version]=4 WHERE [id]=N'${f.promotionId}';
  `);

  // ---- the run completes, balanced, last: a finished run is never changed -----------------
  await sql.query(`
    UPDATE [dbo].[MigrationRun]
       SET [state]=N'completed', [discoveryComplete]=1, [endedAt]='${ENDED}', [reconciliation]=N'balanced',
           [reconciledAt]='${ENDED}', [reconciliationDetail]=N'{"discovered":3,"staged":2,"errored":1}', [version]=2
     WHERE [id]=N'${f.importRunId}';
  `);
}

/** Every authoritative Phase-29 row this fixture wrote, in a stable order. */
export async function capturePhase29Fixture(
  sql: SqlSession,
  fixture: Phase29Fixture,
): Promise<Readonly<Record<string, string>>> {
  assertSafe(fixture);
  const f = fixture;
  const accounts = `N'${f.operatorId}',N'${f.publisherId}'`;
  const source = `N'${f.sourceId}'`;
  const revisions = `N'${f.supersededId}',N'${f.approvedId}',N'${f.pendingId}'`;
  const rows: Record<string, string> = {};

  // Every BIGINT is read back as its exact decimal TEXT beside the row, and
  // every raw body as its hex, so a restore that changed a byte anywhere
  // differs here whatever a driver does on the way out.
  for (const [name, statement, expected] of [
    [
      'User',
      `SELECT * FROM [dbo].[User] WHERE [id] IN (${accounts}) ORDER BY [email]`,
      2,
    ],
    [
      'PublicationAuthority',
      `SELECT rp.[permissionKey], ra.[userId], ra.[revokedAt], r.[deactivatedAt]
         FROM [dbo].[Role] r JOIN [dbo].[RolePermission] rp ON rp.[roleId] = r.[id]
         JOIN [dbo].[RoleAssignment] ra ON ra.[roleId] = r.[id]
        WHERE r.[id] = N'${f.roleId}'`,
      1,
    ],
    [
      'Video',
      `SELECT [id],[slug],[state],[provider],[providerVideoId],[languageCode],[version] FROM [dbo].[Video] WHERE [id] = N'${f.videoId}'`,
      1,
    ],
    [
      'Asset',
      `SELECT [id],[storageKey],[mediaType],CONVERT(NVARCHAR(20),[byteSize]) AS [byteSizeText],[checksum],[state] FROM [dbo].[Asset] WHERE [id] = N'${f.assetId}'`,
      1,
    ],
    [
      'MigrationSource',
      `SELECT * FROM [dbo].[MigrationSource] WHERE [id] = ${source}`,
      1,
    ],
    [
      'MigrationSourceHost',
      `SELECT * FROM [dbo].[MigrationSourceHost] WHERE [sourceId] = ${source} ORDER BY [host]`,
      2,
    ],
    [
      'MigrationRun',
      `SELECT * FROM [dbo].[MigrationRun] WHERE [sourceId] = ${source}`,
      1,
    ],
    [
      'MigrationRecord',
      `SELECT * FROM [dbo].[MigrationRecord] WHERE [sourceId] = ${source} ORDER BY [externalKey]`,
      3,
    ],
    [
      'MigrationRunItem',
      `SELECT * FROM [dbo].[MigrationRunItem] WHERE [runId] = N'${f.importRunId}' ORDER BY [position]`,
      3,
    ],
    [
      'MigrationRawSnapshot',
      `SELECT *, CONVERT(VARCHAR(MAX), [body], 2) AS [bodyHex]
         FROM [dbo].[MigrationRawSnapshot] WHERE [sourceId] = ${source} ORDER BY [id]`,
      3,
    ],
    [
      'MigrationStagedRecord',
      `SELECT * FROM [dbo].[MigrationStagedRecord] WHERE [id] IN (${revisions}) ORDER BY [id]`,
      3,
    ],
    [
      'MigrationStagedCategory',
      `SELECT * FROM [dbo].[MigrationStagedCategory] WHERE [stagedRecordId] IN (${revisions})`,
      1,
    ],
    [
      'MigrationStagedLink',
      `SELECT * FROM [dbo].[MigrationStagedLink] WHERE [stagedRecordId] IN (${revisions}) ORDER BY [stagedRecordId], [position]`,
      4,
    ],
    [
      'MigrationTopicMapping',
      `SELECT * FROM [dbo].[MigrationTopicMapping] WHERE [sourceId] = ${source}`,
      1,
    ],
    [
      'MigrationError',
      `SELECT * FROM [dbo].[MigrationError] WHERE [sourceId] = ${source}`,
      1,
    ],
    [
      'MigrationDuplicateCandidate',
      `SELECT * FROM [dbo].[MigrationDuplicateCandidate] WHERE [id] = N'${f.duplicateId}'`,
      1,
    ],
    [
      'MigrationAssetProvenance',
      `SELECT *, CONVERT(NVARCHAR(20), [byteSize]) AS [byteSizeText]
         FROM [dbo].[MigrationAssetProvenance] WHERE [sourceId] = ${source} ORDER BY [id]`,
      2,
    ],
    [
      'MigrationLegacyMapping',
      `SELECT * FROM [dbo].[MigrationLegacyMapping] WHERE [sourceId] = ${source}`,
      1,
    ],
    [
      'MigrationPublishManifest',
      `SELECT * FROM [dbo].[MigrationPublishManifest] WHERE [sourceId] = ${source}`,
      1,
    ],
    [
      'MigrationManifestEntry',
      `SELECT * FROM [dbo].[MigrationManifestEntry] WHERE [manifestId] = N'${f.manifestId}'`,
      1,
    ],
    [
      'MigrationPromotion',
      `SELECT * FROM [dbo].[MigrationPromotion] WHERE [id] = N'${f.promotionId}'`,
      1,
    ],
    [
      'MigrationPromotionEntry',
      `SELECT * FROM [dbo].[MigrationPromotionEntry] WHERE [promotionId] = N'${f.promotionId}'`,
      1,
    ],
  ] as const) {
    const data = await sql.query(`${statement};`);
    if (data.length !== expected) {
      throw new Error(
        `Phase-29 recovery expected ${String(expected)} ${name} row(s), found ${String(data.length)}.`,
      );
    }
    rows[name] = JSON.stringify(data, (_key, value: unknown) =>
      typeof value === 'bigint' ? `${value.toString()}n` : value,
    );
  }

  return rows;
}

/** The Phase-29 tables whose constraints and triggers must return intact. */
const PHASE29_TABLES = [
  'MigrationSource',
  'MigrationSourceHost',
  'MigrationRun',
  'MigrationRecord',
  'MigrationRunItem',
  'MigrationRawSnapshot',
  'MigrationStagedRecord',
  'MigrationStagedCategory',
  'MigrationStagedLink',
  'MigrationTopicMapping',
  'MigrationError',
  'MigrationDuplicateCandidate',
  'MigrationAssetProvenance',
  'MigrationLegacyMapping',
  'MigrationPublishManifest',
  'MigrationManifestEntry',
  'MigrationPromotion',
  'MigrationPromotionEntry',
] as const;

/** Every Migration & Provenance trigger, exactly. */
const PHASE29_TRIGGERS = [
  'MigrationAssetProvenanceIntegrity',
  'MigrationDuplicateCandidateIntegrity',
  'MigrationErrorIntegrity',
  'MigrationLegacyMappingIntegrity',
  'MigrationManifestEntryIntegrity',
  'MigrationPromotionEntryIntegrity',
  'MigrationPromotionIntegrity',
  'MigrationPublishManifestIntegrity',
  'MigrationRawSnapshotIntegrity',
  'MigrationRecordIntegrity',
  'MigrationRunIntegrity',
  'MigrationRunItemIntegrity',
  'MigrationSourceHostIntegrity',
  'MigrationSourceIntegrity',
  'MigrationStagedCategoryIntegrity',
  'MigrationStagedLinkIntegrity',
  'MigrationStagedRecordIntegrity',
  'MigrationTopicMappingIntegrity',
]
  .sort()
  .join(',');

/**
 * The three filtered keys, exactly — compared as a set, because the server's
 * collation and JavaScript order an underscore differently.
 */
const PHASE29_FILTERED = [
  'MigrationLegacyMapping_active_key',
  'MigrationManifestEntry_live_key',
  'MigrationRun_open_key',
]
  .sort()
  .join(',');

/**
 * Verifies the restored Migration & Provenance state and returns one line of
 * what was proved.
 *
 * BEYOND ROW EQUALITY: every name, title, label and note is still an
 * unmistakable sentinel and every address still under `*.fixture.invalid`, the
 * Urdu title intact; the source is still a FIXTURE with no authorisation
 * evidence; RAW EVIDENCE — every held body still the bytes its checksum names,
 * the disposed one still bodiless with its checksum, who, when and why; every
 * revision still carrying its snapshot's checksum and its review where it was
 * left; the run still completed and balanced with its items' outcomes; the
 * missing record still classified and never deleted; the published entry, the
 * active legacy mapping and the rewritten link all still naming the SAME Video
 * and canonical path; the two acquisitions still sharing one Asset under their
 * own licences; the publication and the promotion still attributed to the
 * synthetic `migration.publish` holder; LEAST PRIVILEGE — the two ordinary keys
 * bundled and `migration.publish` held by the synthetic role alone; no
 * credential or target-pair column anywhere; and every Phase-29 CHECK, foreign
 * key, trigger and filtered key enabled and trusted, with no key cascading.
 */
export async function verifyRestoredPhase29(
  sql: SqlSession,
  fixture: Phase29Fixture,
  expected: Readonly<Record<string, string>>,
): Promise<string> {
  deepStrictEqual(
    await capturePhase29Fixture(sql, fixture),
    expected,
    'Phase-29 Migration & Provenance authoritative values changed during recovery.',
  );
  const f = fixture;
  const stem = f.runId.slice(0, 16);
  const a = addresses(stem);
  const accounts = `N'${f.operatorId}',N'${f.publisherId}'`;
  const source = `N'${f.sourceId}'`;

  const [labelled] = await sql.query<Record<string, number>>(`
    SELECT
      (SELECT COUNT(*) FROM [dbo].[User] WHERE [id] IN (${accounts})
         AND ([name] NOT LIKE N'NON[_]MIGRATION[_]FIXTURE[_]%' OR [email] NOT LIKE N'%@migration-proof.invalid')) AS [accounts],
      (SELECT COUNT(*) FROM [dbo].[MigrationSource] WHERE [id] = ${source}
         AND ([name] NOT LIKE N'NON[_]MIGRATION[_]FIXTURE[_]%' OR [authorityKind] <> N'fixture'
              OR [authorisationReference] IS NOT NULL OR [authorisedOn] IS NOT NULL
              OR [baseUrl] NOT LIKE N'https://%.fixture.invalid/')) AS [source],
      (SELECT COUNT(*) FROM [dbo].[MigrationSourceHost] WHERE [sourceId] = ${source}
         AND [host] NOT LIKE N'%_.fixture.invalid') AS [hosts],
      (SELECT COUNT(*) FROM [dbo].[MigrationRawSnapshot] WHERE [sourceId] = ${source}
         AND ([requestedUrl] NOT LIKE N'https://%.fixture.invalid/%' OR [finalUrl] NOT LIKE N'https://%.fixture.invalid/%')) AS [snapshots],
      (SELECT COUNT(*) FROM [dbo].[MigrationStagedRecord] s JOIN [dbo].[MigrationRecord] r ON r.[id] = s.[recordId]
        WHERE r.[sourceId] = ${source} AND [title] NOT LIKE N'NON[_]MIGRATION[_]FIXTURE[_]%') AS [titles],
      (SELECT COUNT(*) FROM [dbo].[MigrationStagedRecord] WHERE [id] = N'${f.pendingId}'
         AND [title] NOT LIKE N'%' + NCHAR(1576) + N'%') AS [script],
      (SELECT COUNT(*) FROM [dbo].[MigrationAssetProvenance] WHERE [sourceId] = ${source}
         AND [originalUrl] NOT LIKE N'https://%.fixture.invalid/%') AS [acquisitions],
      (SELECT COUNT(*) FROM [dbo].[MigrationLegacyMapping] WHERE [sourceId] = ${source}
         AND [legacyUrl] NOT LIKE N'https://%.fixture.invalid/%') AS [legacy];
  `);
  if (
    JSON.stringify(labelled) !==
    '{"accounts":0,"source":0,"hosts":0,"snapshots":0,"titles":0,"script":0,"acquisitions":0,"legacy":0}'
  ) {
    throw new Error(
      `Restored Phase-29 fixture is no longer unmistakably labelled: ${JSON.stringify(labelled)}.`,
    );
  }

  // Raw evidence, review, reconciliation, absence, publication and provenance —
  // through the same columns and predicates the adapter reads by.
  const [state] = await sql.query<Record<string, number | string | null>>(`
    SELECT
      (SELECT COUNT(*) FROM [dbo].[MigrationRawSnapshot] WHERE [sourceId] = ${source} AND [body] IS NOT NULL
          AND DATALENGTH([body]) = [byteSize]
          AND LOWER(CONVERT(CHAR(64), HASHBYTES('SHA2_256', [body]), 2)) = [checksum]) AS [heldIntact],
      (SELECT COUNT(*) FROM [dbo].[MigrationRawSnapshot] WHERE [id] = N'${f.disposedSnapshotId}' AND [body] IS NULL
          AND [disposedAt] IS NOT NULL AND [disposedByUserId] = N'${f.operatorId}' AND [disposalReason] IS NOT NULL
          AND [checksum] = (SELECT [checksum] FROM [dbo].[MigrationRawSnapshot] WHERE [id] = N'${f.heldSnapshotId}')) AS [disposedIntact],
      (SELECT COUNT(*) FROM [dbo].[MigrationStagedRecord] s
         JOIN [dbo].[MigrationRawSnapshot] n ON n.[id] = s.[snapshotId] AND n.[recordId] = s.[recordId]
        WHERE s.[id] IN (N'${f.supersededId}', N'${f.approvedId}', N'${f.pendingId}')
          AND s.[inputChecksum] = n.[checksum]) AS [provenance],
      (SELECT STRING_AGG(CONVERT(NVARCHAR(4), [revision]) + N':' + [review], N',') WITHIN GROUP (ORDER BY [recordId], [revision])
         FROM [dbo].[MigrationStagedRecord] WHERE [recordId] = N'${f.recordId}') AS [revisions],
      (SELECT [state] + N':' + [reconciliation] + N':' + CONVERT(NVARCHAR(1), [discoveryComplete])
         FROM [dbo].[MigrationRun] WHERE [id] = N'${f.importRunId}') AS [run],
      (SELECT STRING_AGG([outcome], N',') WITHIN GROUP (ORDER BY [position])
         FROM [dbo].[MigrationRunItem] WHERE [runId] = N'${f.importRunId}') AS [items],
      (SELECT STRING_AGG([status] + N':' + [observed] + N':' + ISNULL([disappearance], N'-'), N',')
                WITHIN GROUP (ORDER BY [legacyIdentifier])
         FROM [dbo].[MigrationRecord] WHERE [sourceId] = ${source}) AS [records],
      (SELECT COUNT(*) FROM [dbo].[MigrationManifestEntry] e
         JOIN [dbo].[MigrationPublishManifest] m ON m.[id] = e.[manifestId] AND m.[state] = N'published'
           AND m.[publishedByUserId] = N'${f.publisherId}'
         JOIN [dbo].[MigrationLegacyMapping] l ON l.[manifestEntryId] = e.[id] AND l.[state] = N'active'
           AND l.[videoId] = e.[videoId] AND l.[canonicalPath] = e.[canonicalPath]
         JOIN [dbo].[MigrationStagedLink] k ON k.[legacyMappingId] = l.[id] AND k.[rewrittenTo] = l.[canonicalPath]
         JOIN [dbo].[Video] v ON v.[id] = e.[videoId] AND N'/watch/videos/' + v.[slug] = e.[canonicalPath]
        WHERE e.[id] = N'${f.entryId}' AND e.[state] = N'published' AND l.[legacyUrl] = N'${a.page}') AS [published],
      (SELECT COUNT(*) FROM [dbo].[MigrationLegacyMapping] WHERE [sourceId] = ${source} AND [state] = N'active') AS [activeMappings],
      (SELECT STRING_AGG([disposition], N',') WITHIN GROUP (ORDER BY [disposition])
         FROM [dbo].[MigrationStagedLink] WHERE [stagedRecordId] = N'${f.approvedId}') AS [links],
      (SELECT STRING_AGG([licence] + N':' + [visibility], N',') WITHIN GROUP (ORDER BY [licence])
         FROM [dbo].[MigrationAssetProvenance] WHERE [assetId] = N'${f.assetId}') AS [acquisitions],
      (SELECT COUNT(*) FROM [dbo].[MigrationTopicMapping] m JOIN [dbo].[Topic] t ON t.[id] = m.[topicId]
        WHERE m.[id] = N'${f.mappingId}' AND m.[state] = N'confirmed') AS [mapped],
      (SELECT [state] + N':' + [signal] + N':' + CONVERT(NVARCHAR(1), [crossLanguage])
         FROM [dbo].[MigrationDuplicateCandidate] WHERE [id] = N'${f.duplicateId}') AS [duplicate],
      (SELECT [classification] + N':' + CONVERT(NVARCHAR(1), [retryEligible]) + N':' + [resolution]
         FROM [dbo].[MigrationError] WHERE [id] = N'${f.errorId}') AS [error],
      (SELECT p.[state] + N':' + e.[state] + N':' + CASE WHEN p.[approvedByUserId] = N'${f.publisherId}' THEN N'publisher' ELSE N'other' END
         FROM [dbo].[MigrationPromotion] p JOIN [dbo].[MigrationPromotionEntry] e ON e.[promotionId] = p.[id]
        WHERE p.[id] = N'${f.promotionId}') AS [promotion],
      (SELECT COUNT(*) FROM [dbo].[RolePermission] rp JOIN [dbo].[Role] o ON o.[id] = rp.[roleId]
        WHERE o.[key] = N'platform-administrator'
          AND rp.[permissionKey] IN (N'migration.read', N'migration.administer')) AS [bundled],
      (SELECT STRING_AGG(o.[key], N',') FROM [dbo].[RolePermission] rp JOIN [dbo].[Role] o ON o.[id] = rp.[roleId]
        WHERE rp.[permissionKey] = N'migration.publish') AS [publishHeldBy],
      (SELECT COUNT(*) FROM [dbo].[Permission] WHERE [key] LIKE N'migration.%') AS [catalogued];
  `);
  const expectedState = {
    heldIntact: 2,
    disposedIntact: 1,
    provenance: 3,
    revisions: '1:superseded,2:approved',
    run: 'completed:balanced:1',
    items: 'staged,errored,staged',
    records: 'published:present:-,errored:missing:withdrawn,staged:present:-',
    published: 1,
    activeMappings: 1,
    links: 'dropped,external,rewritten,unresolved',
    acquisitions: 'organisation-owned:public-eligible,third-party:restricted',
    mapped: 1,
    duplicate: 'open:title-similarity:1',
    error: 'not-found:0:dismissed',
    promotion: 'promoted:promoted:publisher',
    bundled: 2,
    publishHeldBy: `recovery-migration-publish-${stem}`,
    catalogued: 3,
  };
  if (JSON.stringify(state) !== JSON.stringify(expectedState)) {
    throw new Error(
      `Restored Phase-29 Migration & Provenance state is broken: ${JSON.stringify(state)}.`,
    );
  }

  // NO CREDENTIAL OR TARGET PAIR survived or arrived with the restore, no table
  // beyond the eighteen is a Migration record, and no fourth key exists.
  const tables = PHASE29_TABLES.map((table) => `OBJECT_ID(N'${table}')`).join(',');
  const [artifacts] = await sql.query<Record<string, number>>(`
    SELECT
      (SELECT COUNT(*) FROM sys.columns c
        WHERE c.[object_id] IN (${tables})
          AND (c.[name] LIKE N'%password%' OR c.[name] LIKE N'%secret%' OR c.[name] LIKE N'%cookie%'
               OR c.[name] LIKE N'%credential%' OR c.[name] LIKE N'%session%'
               OR (c.[name] LIKE N'%token%' AND c.[name] <> N'leaseToken')
               OR c.[name] IN (N'targetType', N'targetId'))) AS [columns],
      (SELECT COUNT(*) FROM sys.tables
        WHERE [name] LIKE N'Migration%' AND [name] NOT IN (${PHASE29_TABLES.map((table) => `N'${table}'`).join(',')})) AS [tables],
      (SELECT COUNT(*) FROM [dbo].[Permission]
        WHERE [key] LIKE N'migration.%'
          AND [key] NOT IN (N'migration.read', N'migration.administer', N'migration.publish')) AS [keys];
  `);
  if (JSON.stringify(artifacts) !== '{"columns":0,"tables":0,"keys":0}') {
    throw new Error(
      `Restored Phase-29 schema carries a credential, target pair or foreign artifact: ${JSON.stringify(artifacts)}.`,
    );
  }

  const broken = await sql.query<{ name: string }>(
    `SELECT [name] FROM sys.check_constraints
     WHERE parent_object_id IN (${tables}) AND (is_disabled=1 OR is_not_trusted=1)
     UNION ALL
     SELECT [name] FROM sys.foreign_keys
     WHERE parent_object_id IN (${tables})
       AND (is_disabled=1 OR is_not_trusted=1 OR delete_referential_action<>0 OR update_referential_action<>0)
     UNION ALL
     SELECT [name] FROM sys.triggers WHERE parent_id IN (${tables}) AND is_disabled=1;`,
  );
  if (broken.length > 0) {
    throw new Error(
      `Restored Phase-29 constraints or triggers are not intact: ${broken.map((row) => row.name).join(', ')}`,
    );
  }

  const [counts] = await sql.query<{
    checks: number;
    keys: number;
    triggers: string | null;
    filtered: string | null;
  }>(
    `SELECT
       (SELECT COUNT_BIG(*) FROM sys.check_constraints WHERE parent_object_id IN (${tables})) AS [checks],
       (SELECT COUNT_BIG(*) FROM sys.foreign_keys WHERE parent_object_id IN (${tables})) AS [keys],
       (SELECT STRING_AGG([name], N',') WITHIN GROUP (ORDER BY [name]) FROM sys.triggers
         WHERE parent_id IN (${tables})) AS [triggers],
       (SELECT STRING_AGG([name], N',') WITHIN GROUP (ORDER BY [name]) FROM sys.indexes
         WHERE [object_id] IN (${tables}) AND has_filter=1 AND is_unique=1) AS [filtered];`,
  );
  // 19 CHECKs (Phase 30-R adds a host's role and an acquisition's public
  // copy), 84 foreign keys none of which cascades (Phase 29's sixty-five,
  // Phase 30's ten typed target keys and Phase 30-R's eight more and the
  // public copy's Asset), the 18 triggers and the three filtered keys,
  // exactly as the migrations create them: a restore that silently lost one
  // would otherwise read as "none untrusted".
  if (
    Number(counts?.checks ?? 0) !== 19 ||
    Number(counts?.keys ?? 0) !== 84 ||
    (counts?.triggers ?? '').split(',').sort().join(',') !== PHASE29_TRIGGERS ||
    (counts?.filtered ?? '').split(',').sort().join(',') !== PHASE29_FILTERED
  ) {
    throw new Error(
      `Restored Phase-29 objects are incomplete: ${JSON.stringify(counts ?? null)}.`,
    );
  }

  return 'a fixture source with its *.fixture.invalid hosts and no authorisation evidence, a completed balanced run with its staged and errored items, a published, a staged and a missing-and-classified record, two raw snapshots still holding exactly the bytes their SHA-256 names and one disposed of with its checksum kept, superseded, approved and pending revisions each carrying its snapshot checksum, a confirmed Topic mapping and links of all four dispositions, one Asset acquired twice under two licences, the published entry, its active legacy mapping and the rewritten link naming the same Video and canonical path, a promoted promotion, publication and approval attributed to the synthetic migration.publish holder, both ordinary keys bundled and migration.publish held by the synthetic role alone, no credential or target-pair column, and every key, CHECK, trigger and filtered key trusted with no cascade';
}
