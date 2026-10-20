import 'server-only';

import { createHash } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';

import type { MalwareScannerPort } from '@minhaj/contracts/platform';
import {
  archiveOrExecutable,
  detectMediaType,
  isBeneath,
  isValidStorageKey,
  type FilesystemStore,
} from '@minhaj/storage';

import type { SqlSession } from './sql-connection.ts';

/**
 * The ONE staging seed fixture, and the storage half of the combined staging
 * recovery proof.
 *
 * ## What the seed is, and what it is not
 *
 * A single stored asset that exists so the restore proof has something real to
 * recover on BOTH sides of the database/filesystem boundary: an `Asset` row in
 * the database backup, and the bytes it describes in the storage copy. It is
 * unmistakably synthetic — the only words in it are the sentence below — and
 * it is not religious content, not editorial content, and carries no personal
 * data. Staging content arrives later through the approved migration pipeline
 * (MIGRATION_STRATEGY.md), never through a seed.
 *
 * ## Why the bytes are a PDF
 *
 * `Asset.mediaType` is "the type the BYTES are, as sniffed — never the
 * declared value", and the storage foundation's sniffer recognises a closed set
 * of formats that does not include plain text. A text file would therefore
 * need a media type the sniffer cannot produce, which is a lie the serving path
 * might later trust. So the sentence is wrapped in the smallest well-formed
 * PDF, which the real sniffer identifies as `application/pdf`; the seed checks
 * that at run time rather than asserting it.
 *
 * ## How the row reaches `clean`
 *
 * Through the SAME custody steps the StorageService takes, in the same order,
 * with the same crash-safety: a row in `uploading`, then the bytes written by
 * the storage package's own filesystem store (which measures size and SHA-256
 * as it writes), then `quarantined` with those measurements, then a REAL
 * ClamAV `INSTREAM` scan through the storage package's own scanner adapter,
 * and only on a clean verdict the `quarantined -> clean` update — with the
 * checksum in its WHERE clause, so clearance names the exact bytes scanned.
 *
 * The StorageService itself is not called because it generates a random key
 * and id per call, and a fixture that must be the same on every run, and
 * removable by name, needs a FIXED key. The steps are its steps; only the key
 * is fixed, and it still has the exact generated-key shape `ab/cd/<32 hex>`.
 *
 * If the scanner is unavailable the row stays `quarantined` (unservable) and
 * the command fails; a later run resumes from there. Nothing is ever marked
 * clean without a clean verdict.
 */

/** The only words the fixture contains. ASCII, so the PDF is byte-exact. */
export const STAGING_SEED_TEXT =
  'One Minhaj staging synthetic recovery fixture - not content. Safe to delete.';

/** Fixed, and in the exact generated-key shape `ab/cd/<32 hex>`. */
export const STAGING_SEED_STORAGE_KEY = '5e/ed/5eed0000000000000000000000002800';

/** Fixed asset id: a UUID v4 shape, recognisably the seed. */
export const STAGING_SEED_ASSET_ID = '5eed0000-0000-4000-8000-000000002800';

export const STAGING_SEED_DISPLAY_NAME = 'staging-synthetic-recovery-fixture.pdf';

export const STAGING_SEED_MEDIA_TYPE = 'application/pdf';

/**
 * The smallest well-formed single-page PDF showing `text`, with an exact
 * cross-reference table. Deterministic: the same text gives the same bytes on
 * every machine, every run.
 */
function minimalPdf(text: string): Uint8Array {
  if (!/^[\x20-\x7e]*$/.test(text) || /[()\\]/.test(text)) {
    throw new Error('The fixture text must be printable ASCII without PDF delimiters.');
  }

  const content = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET\n`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R ' +
      '/Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}endstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];

  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const xref = body.length;
  body +=
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('') +
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

  return new TextEncoder().encode(body);
}

/** The fixture's exact bytes. */
export const STAGING_SEED_BYTES: Uint8Array = minimalPdf(STAGING_SEED_TEXT);

export const STAGING_SEED_BYTE_SIZE = STAGING_SEED_BYTES.byteLength;

export const STAGING_SEED_CHECKSUM = createHash('sha256')
  .update(STAGING_SEED_BYTES)
  .digest('hex');

/** The fixture's `Asset` row as found, or `null`. */
interface FixtureRow {
  id: string;
  storageKey: string;
  mediaType: string | null;
  byteSize: number | string | null;
  checksum: string | null;
  state: string;
  rejection: string | null;
  displayName: string | null;
}

async function fixtureRows(live: SqlSession): Promise<FixtureRow[]> {
  return live.query<FixtureRow>(`
    SELECT [id], [storageKey], [mediaType], [byteSize], [checksum], [state],
           [rejection], [displayName]
    FROM [dbo].[Asset]
    WHERE [id] = N'${STAGING_SEED_ASSET_ID}' OR [storageKey] = N'${STAGING_SEED_STORAGE_KEY}';
  `);
}

/** Whether a found row is exactly the fixture, measured, in `state`. */
function isFixture(row: FixtureRow, state: string): boolean {
  return (
    row.id.toLowerCase() === STAGING_SEED_ASSET_ID &&
    row.storageKey === STAGING_SEED_STORAGE_KEY &&
    row.mediaType === STAGING_SEED_MEDIA_TYPE &&
    Number(row.byteSize) === STAGING_SEED_BYTE_SIZE &&
    row.checksum === STAGING_SEED_CHECKSUM &&
    row.state === state &&
    row.rejection === null &&
    row.displayName === STAGING_SEED_DISPLAY_NAME
  );
}

async function* once(bytes: Uint8Array): AsyncGenerator<Uint8Array> {
  yield bytes;
}

export interface SeedOutcome {
  /** `false` when the fixture was already present, clean and intact. */
  changed: boolean;
  steps: string[];
}

/**
 * Seeds the fixture idempotently. Running it again on a seeded database
 * changes nothing: no write, no scan, no UPDATE.
 *
 * Anything else that occupies the fixture's id or key — a row with different
 * values, a rejected or failed row, bytes that are not the fixture's — is a
 * refusal, never an overwrite: `--remove` clears the fixture deliberately.
 */
export async function seedStagingFixture(
  live: SqlSession,
  files: FilesystemStore,
  scanner: MalwareScannerPort,
): Promise<SeedOutcome> {
  assertFixtureIntegrity();
  const steps: string[] = [];
  const expected = { byteSize: STAGING_SEED_BYTE_SIZE, checksum: STAGING_SEED_CHECKSUM };

  const rows = await fixtureRows(live);
  if (rows.length > 1) {
    throw new Error(
      'The fixture id and storage key are held by different Asset rows; refusing to ' +
        'seed over them. Inspect the Asset table.',
    );
  }
  const [row] = rows;

  if (row !== undefined && isFixture(row, 'clean')) {
    if (await files.verify(STAGING_SEED_STORAGE_KEY, expected)) {
      return { changed: false, steps: ['fixture already present, clean and intact'] };
    }
    throw new Error(
      'The fixture row is clean but its bytes are missing or differ under STORAGE_ROOT. ' +
        'Run staging:db:seed --remove, then seed again.',
    );
  }

  if (row !== undefined && !isFixture(row, 'quarantined')) {
    throw new Error(
      `An Asset row occupies the fixture's id or storage key in state '${row.state}' ` +
        `with values that are not the fixture's; refusing to overwrite it. ` +
        `Run staging:db:seed --remove if it is a damaged fixture.`,
    );
  }

  if (row === undefined) {
    // Bytes without a row are either a fixture interrupted before its row was
    // written — which are exactly the expected bytes — or something foreign.
    if (await files.exists(STAGING_SEED_STORAGE_KEY)) {
      if (!(await files.verify(STAGING_SEED_STORAGE_KEY, expected))) {
        throw new Error(
          'Bytes that are not the fixture occupy its storage key; refusing to overwrite them.',
        );
      }
    }

    await live.query(`
      INSERT INTO [dbo].[Asset] ([id], [storageKey], [displayName], [state], [updatedAt])
      VALUES (N'${STAGING_SEED_ASSET_ID}', N'${STAGING_SEED_STORAGE_KEY}',
              N'${STAGING_SEED_DISPLAY_NAME}', N'uploading', SYSUTCDATETIME());
    `);
    steps.push('asset row written: uploading');

    if (!(await files.exists(STAGING_SEED_STORAGE_KEY))) {
      const written = await files.write(
        STAGING_SEED_STORAGE_KEY,
        once(STAGING_SEED_BYTES),
        STAGING_SEED_BYTE_SIZE,
      );
      if (
        written.byteSize !== STAGING_SEED_BYTE_SIZE ||
        written.checksum !== STAGING_SEED_CHECKSUM
      ) {
        throw new Error('The stored fixture bytes do not measure as the fixture.');
      }
      steps.push(`bytes written: ${written.byteSize} bytes, sha256 ${written.checksum}`);
    } else {
      steps.push('bytes already present and verified');
    }

    await live.query(`
      UPDATE [dbo].[Asset]
      SET [mediaType] = N'${STAGING_SEED_MEDIA_TYPE}',
          [byteSize] = ${String(STAGING_SEED_BYTE_SIZE)},
          [checksum] = N'${STAGING_SEED_CHECKSUM}',
          [state] = N'quarantined', [updatedAt] = SYSUTCDATETIME()
      WHERE [id] = N'${STAGING_SEED_ASSET_ID}' AND [state] = N'uploading';
    `);
    steps.push('asset row: quarantined with measured size and checksum');
  } else {
    // A quarantined fixture: a previous run's scan did not clear it.
    if (!(await files.verify(STAGING_SEED_STORAGE_KEY, expected))) {
      throw new Error(
        'The quarantined fixture row has no matching bytes under STORAGE_ROOT. ' +
          'Run staging:db:seed --remove, then seed again.',
      );
    }
    steps.push('resuming a quarantined fixture');
  }

  const outcome = await scanner.scan(files.pathOf(STAGING_SEED_STORAGE_KEY));
  if (outcome.status !== 'clean') {
    // Fail closed: the row stays quarantined and is never served.
    throw new Error(
      `The malware scanner answered '${outcome.status}' for the fixture, so it stays ` +
        `quarantined. Check CLAMAV_HOST/CLAMAV_PORT and run staging:db:seed again.`,
    );
  }
  steps.push('ClamAV INSTREAM scan: clean');

  const cleared = await live.query<{ id: string }>(`
    UPDATE [dbo].[Asset]
    SET [state] = N'clean', [updatedAt] = SYSUTCDATETIME()
    OUTPUT INSERTED.[id] AS [id]
    WHERE [id] = N'${STAGING_SEED_ASSET_ID}' AND [state] = N'quarantined'
      AND [checksum] = N'${STAGING_SEED_CHECKSUM}';
  `);
  if (cleared.length !== 1) {
    throw new Error('The fixture could not be cleared: its row changed during the scan.');
  }
  steps.push('asset row: clean (cleared against the scanned checksum)');

  return { changed: true, steps };
}

export interface RemoveOutcome {
  rowDeleted: boolean;
  bytesRemoved: boolean;
}

/**
 * Removes exactly the fixture — its row by id AND key, then its bytes by the
 * fixed key — and proves both are gone. Idempotent.
 */
export async function removeStagingFixture(
  live: SqlSession,
  files: FilesystemStore,
): Promise<RemoveOutcome> {
  const deleted = await live.query<{ id: string }>(`
    DELETE FROM [dbo].[Asset]
    OUTPUT DELETED.[id] AS [id]
    WHERE [id] = N'${STAGING_SEED_ASSET_ID}' AND [storageKey] = N'${STAGING_SEED_STORAGE_KEY}';
  `);

  const bytesPresent = await files.exists(STAGING_SEED_STORAGE_KEY);
  if (bytesPresent) await files.remove(STAGING_SEED_STORAGE_KEY);

  if ((await fixtureRows(live)).length !== 0) {
    throw new Error(
      'An Asset row still occupies the fixture id or key after removal; it is not the ' +
        'fixture and was left alone. Inspect the Asset table.',
    );
  }
  if (await files.exists(STAGING_SEED_STORAGE_KEY)) {
    throw new Error('The fixture bytes still exist after removal.');
  }

  return { rowDeleted: deleted.length === 1, bytesRemoved: bytesPresent };
}

/** Proves the fixture's constants still describe a PDF the real sniffer admits. */
export function assertFixtureIntegrity(): void {
  const detected = detectMediaType(STAGING_SEED_BYTES.subarray(0, 4096));
  if (detected !== STAGING_SEED_MEDIA_TYPE || archiveOrExecutable(detected)) {
    throw new Error('The fixture bytes no longer sniff as application/pdf.');
  }
  if (!isValidStorageKey(STAGING_SEED_STORAGE_KEY)) {
    throw new Error('The fixture storage key is not in the generated-key shape.');
  }
}

/** Verifies the restored database still holds the fixture row, clean and exact. */
export async function verifyRestoredFixture(restored: SqlSession): Promise<void> {
  const rows = await fixtureRows(restored);
  const [row] = rows;
  if (rows.length !== 1 || row === undefined || !isFixture(row, 'clean')) {
    throw new Error(
      'The restored database does not contain the staging seed fixture as a clean, ' +
        'exactly-measured Asset row. Was staging:db:seed run before the backup?',
    );
  }
}

/* ---------------------------------------------------------------------------
 * Storage half of the combined recovery proof
 * ------------------------------------------------------------------------- */

/**
 * Proves the restored storage copy is ISOLATED from the live storage root.
 *
 * The restore proof only reads under the restore root, but a restore root that
 * IS the live root — by spelling, by symlink, or by nesting either way — would
 * make "the restored bytes are intact" a statement about live data, proving
 * nothing about the copy. So: both absolute, the restore root must already
 * exist (the host populated it; absence is not inferred to be fine), and the
 * two resolved paths must be neither equal nor nested.
 */
export async function assertIsolatedRestoreRoot(
  liveRoot: string | undefined,
  restoreRoot: string | undefined,
): Promise<{ live: string; restore: string }> {
  if (liveRoot === undefined || !path.isAbsolute(liveRoot)) {
    throw new Error('STORAGE_ROOT must be set to an absolute path.');
  }
  if (restoreRoot === undefined || !path.isAbsolute(restoreRoot)) {
    throw new Error('MINHAJ_RESTORE_STORAGE_ROOT must be set to an absolute path.');
  }

  const isolated = (a: string, b: string): boolean =>
    path.resolve(a) !== path.resolve(b) && !isBeneath(a, b) && !isBeneath(b, a);

  if (!isolated(liveRoot, restoreRoot)) {
    throw new Error(
      'MINHAJ_RESTORE_STORAGE_ROOT is, contains or is inside STORAGE_ROOT; the restore ' +
        'proof must read an isolated copy, never the live storage.',
    );
  }

  let restoreInformation;
  try {
    restoreInformation = await stat(restoreRoot);
  } catch {
    throw new Error(
      'MINHAJ_RESTORE_STORAGE_ROOT does not exist; restore the storage copy there first.',
    );
  }
  if (!restoreInformation.isDirectory()) {
    throw new Error('MINHAJ_RESTORE_STORAGE_ROOT is not a directory.');
  }

  const realRestore = await realpath(restoreRoot);
  // The live root may legitimately not exist inside this container; compare
  // its real path when it does, its resolved spelling when it does not.
  let realLive: string;
  try {
    realLive = await realpath(liveRoot);
  } catch {
    realLive = path.resolve(liveRoot);
  }

  if (!isolated(realLive, realRestore)) {
    throw new Error(
      'MINHAJ_RESTORE_STORAGE_ROOT resolves to, into or around STORAGE_ROOT through a ' +
        'link; the restore proof must read an isolated copy.',
    );
  }

  return { live: realLive, restore: realRestore };
}

export interface StorageRecoveryReport {
  /** Rows in a durable state — bytes measured and promised. */
  durableAssets: number;
  verified: number;
  failures: { assetId: string; reason: string }[];
}

/**
 * For EVERY restored `Asset` row whose state promises bytes, the bytes under
 * the restored storage root exist and match the row's size and SHA-256.
 *
 * Durable states are `quarantined` and `clean`: both were written only after
 * the bytes were measured. `uploading` promises no file, and `rejected` and
 * `failed` have had theirs removed or never had them. Verification reuses the
 * storage package's own `verify`, which re-reads and re-hashes every byte and
 * refuses a path that escapes the root through a link.
 */
export async function verifyRestoredStorage(
  restored: SqlSession,
  files: FilesystemStore,
): Promise<StorageRecoveryReport> {
  const rows = await restored.query<{
    id: string;
    storageKey: string;
    byteSize: number | string | null;
    checksum: string | null;
  }>(`
    SELECT [id], [storageKey], [byteSize], [checksum]
    FROM [dbo].[Asset]
    WHERE [state] IN (N'quarantined', N'clean')
    ORDER BY [id];
  `);

  const failures: { assetId: string; reason: string }[] = [];
  let verified = 0;

  for (const row of rows) {
    const byteSize = Number(row.byteSize);
    if (
      row.byteSize === null ||
      !Number.isSafeInteger(byteSize) ||
      row.checksum === null
    ) {
      failures.push({ assetId: row.id, reason: 'durable row is not measured' });
      continue;
    }
    if (!isValidStorageKey(row.storageKey)) {
      failures.push({ assetId: row.id, reason: 'storage key is not a generated key' });
      continue;
    }
    if (await files.verify(row.storageKey, { byteSize, checksum: row.checksum })) {
      verified += 1;
    } else {
      failures.push({
        assetId: row.id,
        reason: 'bytes missing, or size/sha256 differ from the restored row',
      });
    }
  }

  return { durableAssets: rows.length, verified, failures };
}
