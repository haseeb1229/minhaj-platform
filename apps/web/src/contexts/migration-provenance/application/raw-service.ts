import 'server-only';

import {
  MIGRATION_LIMITS,
  migrationIdSchema,
  snapshotDisposalSchema,
  type MigrationActor,
  type MigrationAuthorityPort,
  type MigrationRawPort,
  type PersonalDataState,
} from '@minhaj/contracts/migration';

import { MigrationRefusal } from '../domain/refusal.ts';
import { ADMINISTER, createGate, guarded } from './shared.ts';

/** What the escaped-text preview shows. The CALLER renders `text` as text, never as HTML. */
export interface RawPreview {
  readonly snapshotId: string;
  readonly contentType: string | null;
  readonly byteSize: number;
  readonly checksum: string;
  readonly personalData: PersonalDataState;
  /** The body was disposed of: metadata and checksum remain, the bytes do not. */
  readonly disposed: boolean;
  /** At most `MIGRATION_LIMITS.rawPreviewBytes` of the body decoded as UTF-8 (invalid bytes → U+FFFD). */
  readonly text: string;
  readonly truncated: boolean;
}

/**
 * The exact headers of a raw download (brief decision 6): bytes the browser
 * is told not to interpret, sniff, script or cache.
 */
export function rawDownloadHeaders(
  snapshotId: string,
  byteSize: number,
): Readonly<Record<string, string>> {
  return Object.freeze({
    'Content-Type': 'application/octet-stream',
    'Content-Disposition': `attachment; filename="snapshot-${snapshotId}.bin"`,
    'Content-Length': String(byteSize),
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "sandbox; default-src 'none'",
    'Cache-Control': 'private, no-store',
  });
}

export interface RawDownload {
  readonly bytes: Uint8Array;
  readonly headers: Readonly<Record<string, string>>;
}

/**
 * RAW EVIDENCE renders INERTLY (SECURITY_BASELINE.md §10.3): an escaped-text
 * preview or an attachment download, never live HTML. Every read is audited
 * by the adapter in the same transaction as the read itself.
 *
 * Dependencies (ports only):
 *  - `raw`       — `MigrationRawPort`;
 *  - `authority` — `MigrationAuthorityPort`;
 *  - `clock`     — injectable for tests.
 */
export function createMigrationRawService(deps: {
  readonly raw: MigrationRawPort;
  readonly authority: MigrationAuthorityPort;
  readonly clock?: () => Date;
}) {
  const now = deps.clock ?? (() => new Date());
  const gate = createGate(deps.authority);

  return {
    async preview(actor: MigrationActor, snapshotId: unknown): Promise<RawPreview> {
      const actorId = await gate.holds(actor, ADMINISTER);
      const id = migrationIdSchema.safeParse(snapshotId);
      if (!id.success) throw new MigrationRefusal('invalid');
      const limit = MIGRATION_LIMITS.rawPreviewBytes;
      const body = await guarded(
        deps.raw.readSnapshot({
          snapshotId: id.data,
          maxBytes: limit,
          purpose: 'preview',
          actorId,
          now: now(),
        }),
      );
      if (body === null) throw new MigrationRefusal('not-found');
      const bytes = body.body === null ? null : body.body.subarray(0, limit);
      return {
        snapshotId: body.id,
        contentType: body.contentType,
        byteSize: body.byteSize,
        checksum: body.checksum,
        personalData: body.personalData,
        disposed: body.body === null,
        text:
          bytes === null ? '' : new TextDecoder('utf-8', { fatal: false }).decode(bytes),
        truncated: body.byteSize > limit,
      };
    },

    async download(actor: MigrationActor, snapshotId: unknown): Promise<RawDownload> {
      const actorId = await gate.holds(actor, ADMINISTER);
      const id = migrationIdSchema.safeParse(snapshotId);
      if (!id.success) throw new MigrationRefusal('invalid');
      const body = await guarded(
        deps.raw.readSnapshot({
          snapshotId: id.data,
          maxBytes: MIGRATION_LIMITS.maxBodyBytes,
          purpose: 'download',
          actorId,
          now: now(),
        }),
      );
      if (body === null) throw new MigrationRefusal('not-found');
      if (body.body === null) throw new MigrationRefusal('invalid-state');
      return {
        bytes: body.body,
        headers: rawDownloadHeaders(body.id, body.body.byteLength),
      };
    },

    /** Removes the body only, for a stated reason; metadata and checksum remain. */
    async dispose(actor: MigrationActor, input: unknown): Promise<void> {
      const { actorId, value } = await gate.authorised(
        actor,
        ADMINISTER,
        snapshotDisposalSchema,
        input,
      );
      await guarded(deps.raw.disposeSnapshot({ ...value, actorId, now: now() }));
    },
  };
}

export type MigrationRawService = ReturnType<typeof createMigrationRawService>;
