/**
 * Layer-0 storage ports (SECURITY_BASELINE.md §10.1, ARCHITECTURE.md §6.1).
 *
 * Storage is platform infrastructure, NOT a bounded context. It holds bytes
 * and the technical facts about those bytes, and it knows nothing about what
 * the bytes mean. There is no book here, no avatar, no recitation and no
 * message attachment: a business context owns its own typed relation to an
 * asset, and the foundation never learns the name of that relation.
 *
 * WHY THERE IS NO OWNER FIELD. An `Asset` carries no `UserId`, no `PersonId`
 * and no generic owner target. A `targetType + targetId` pair here would be
 * the polymorphic shortcut DOMAIN_MODEL.md refuses, and it would quietly make
 * storage depend on every context that later stores something.
 *
 * WHY THERE IS NO IDENTITY DEPENDENCY. Storage is required by Phase 28 and by
 * domains that are not Identity-gated, so depending on Identity would spread
 * Phase 2's external email gate into staging for no architectural reason
 * (DELIVERY_PLAN.md Phase 7). What this layer delivers is the MECHANISM —
 * default-deny — and each Identity-aware consumer supplies the policy.
 *
 * Browser-safe: types only.
 */

/* ===========================================================================
 * Custody lifecycle
 * ========================================================================= */

/**
 * Where an asset is in its custody lifecycle.
 *
 * These are TECHNICAL states, not editorial or business ones. Nothing here
 * says published, approved or visible; those words belong to the contexts
 * that later reference an asset.
 *
 * Only `clean` is servable, and only `clean` is reachable by a scanner result
 * that matched the exact stored bytes. Every other state — including the one
 * a crash leaves behind — withholds the file.
 */
export type AssetState =
  /** Bytes are still arriving. No durable file is claimed to exist yet. */
  | 'uploading'
  /** Durable bytes exist and the scanner has not cleared them. */
  | 'quarantined'
  /** The scanner cleared these exact bytes, identified by checksum. */
  | 'clean'
  /** Validation or the scanner refused the content. Terminal. */
  | 'rejected'
  /** The lifecycle broke. Bytes may be absent, partial or unverifiable. */
  | 'failed';

/** Why an asset was refused, in terms the foundation can honestly report. */
export type AssetRejection =
  | 'declared-type-not-allowed'
  | 'detected-type-not-allowed'
  | 'declared-type-mismatch'
  | 'too-large'
  | 'empty'
  | 'unreadable'
  | 'infected'
  | 'unscannable';

/**
 * The technical record of one stored object.
 *
 * Deliberately small. Rights, licence, provenance, visibility and entitlement
 * are NOT here — each belongs to a later owning phase, and inventing a column
 * for one now would be speculative schema the owning phase has to undo.
 */
export interface AssetRecord {
  readonly id: string;
  /** Server-generated, opaque. Never derived from caller input. */
  readonly storageKey: string;
  /** The type the BYTES are, as sniffed. Never the declared or client value. */
  readonly mediaType: string;
  readonly byteSize: number;
  /** SHA-256 over the exact stored bytes, lowercase hex. */
  readonly checksum: string;
  readonly state: AssetState;
  readonly rejection: AssetRejection | null;
  /**
   * The original filename, kept for display only and bounded.
   *
   * It has NO influence on the storage key or on any path. It exists so a
   * later consumer can show a human a recognisable name, and for nothing else.
   */
  readonly displayName: string | null;
  readonly scanAttempts: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/* ===========================================================================
 * Upload policy — supplied by the caller, floored by the foundation
 * ========================================================================= */

/**
 * The technical policy for ONE upload.
 *
 * Phase 7 cannot know a future domain's rules, so the caller states what it
 * will accept. A consumer may be STRICTER than the foundation. A consumer may
 * not switch off quarantine, sniffing, scanning, generated keys or root
 * containment — none of those is expressible here, which is the point.
 */
export interface UploadPolicy {
  /** Detected media types this caller accepts. Empty accepts nothing. */
  readonly allowedMediaTypes: readonly string[];
  /** Caller ceiling in bytes. The foundation's own ceiling still applies. */
  readonly maxBytes: number;
  /**
   * What the client SAID the type was, when the caller has it.
   *
   * Used only to refuse a mismatch against the sniffed type. It never grants
   * acceptance on its own — a declared type that matches nothing real is
   * still refused by the sniff.
   */
  readonly declaredMediaType?: string | null;
  /** Original filename for display. Bounded and sanitised before storage. */
  readonly displayName?: string | null;
}

/* ===========================================================================
 * Malware scanning (SECURITY_BASELINE.md §10.1 rule 4)
 * ========================================================================= */

/**
 * What a scan concluded, mapped away from any provider's wire format.
 *
 * `unavailable` is DISTINCT from `unscannable`: the first means the scanner
 * could not be reached and the answer is unknown, the second means the
 * scanner read the file and could not decide. Both withhold the file, and
 * keeping them apart is what lets retry apply to one and not the other.
 */
export type ScanOutcome =
  | { readonly status: 'clean' }
  | { readonly status: 'infected'; readonly signature: string | null }
  | { readonly status: 'unscannable' }
  | { readonly status: 'unavailable' };

/**
 * A malware scanner.
 *
 * The port takes a path the FOUNDATION generated and owns. It is never handed
 * a caller-supplied path, so it cannot be turned into an arbitrary-file
 * reader.
 */
export interface MalwareScannerPort {
  scan(absolutePath: string): Promise<ScanOutcome>;
}

/* ===========================================================================
 * Serving authorisation — the mechanism, not the policy
 * ========================================================================= */

/**
 * What a serving decision may look at.
 *
 * Technical facts only. There is no session, no user and no role here: an
 * Identity-aware consumer closes over whatever it needs when it builds its
 * own port, and the foundation never sees it.
 */
export interface AssetAccessRequest {
  readonly assetId: string;
  readonly mediaType: string;
  readonly byteSize: number;
  readonly checksum: string;
}

/**
 * The injected allow/deny decision.
 *
 * DEFAULT DENY IS NOT THIS PORT'S JOB TO REMEMBER — the serving route treats
 * anything that is not an explicit `allow` as a denial, including a throw, a
 * timeout and a malformed answer. A consumer that forgets to return something
 * fails closed.
 */
export interface AssetAuthorizationPort {
  decide(request: AssetAccessRequest): Promise<'allow' | 'deny'>;
}

/* ===========================================================================
 * Persistence and the service surface
 * ========================================================================= */

/** Metadata persistence for assets. File BYTES never travel through this. */
export interface AssetPersistencePort {
  begin(input: {
    readonly id: string;
    readonly storageKey: string;
    readonly displayName: string | null;
  }): Promise<void>;
  quarantine(input: {
    readonly id: string;
    readonly mediaType: string;
    readonly byteSize: number;
    readonly checksum: string;
  }): Promise<void>;
  /** Clearance names the checksum it cleared, so stale bytes cannot inherit it. */
  clear(input: { readonly id: string; readonly checksum: string }): Promise<boolean>;
  reject(input: {
    readonly id: string;
    readonly rejection: AssetRejection;
  }): Promise<void>;
  fail(id: string): Promise<void>;
  countScanAttempt(id: string): Promise<number>;
  find(id: string): Promise<AssetRecord | null>;
  /** Bounded sweep of records a crash left mid-lifecycle. */
  staleBefore(cutoff: Date, limit: number): Promise<readonly AssetRecord[]>;
  remove(id: string): Promise<void>;
}

/** What a successful `store` reports back. */
export interface StoredAsset {
  readonly id: string;
  readonly state: AssetState;
  readonly mediaType: string;
  readonly byteSize: number;
  readonly checksum: string;
  readonly rejection: AssetRejection | null;
}

/**
 * The narrow semantic storage service.
 *
 * It deliberately exposes no filesystem path, no storage root, no file
 * descriptor, no Prisma handle, no transaction and no delete-any-path. A
 * caller can put bytes in and, with an explicit allow, get bytes out.
 */
export interface StorageServicePort {
  store(bytes: AsyncIterable<Uint8Array>, policy: UploadPolicy): Promise<StoredAsset>;
  /**
   * Resolves a readable stream ONLY for a clean asset with an explicit allow.
   *
   * Returns `null` for every other case — denied, missing, quarantined,
   * rejected, failed, or present in metadata but absent or corrupt on disk.
   * One `null` for all of them so a caller cannot probe custody state.
   */
  open(
    assetId: string,
    authorization: AssetAuthorizationPort,
  ): Promise<AssetStream | null>;
  /** Bounded, idempotent reconciliation of Storage-owned resources only. */
  reconcile(now: Date, limit: number): Promise<number>;
}

/** A resolved, authorised asset ready to be served. */
export interface AssetStream {
  readonly mediaType: string;
  readonly byteSize: number;
  readonly checksum: string;
  readonly displayName: string | null;
  readonly body: AsyncIterable<Uint8Array>;
  /**
   * The inclusive byte range `[start, end]` of the SAME authorised bytes
   * (Phase 11, for seeking in a player).
   *
   * NOT A SECOND DOOR. It exists only on a stream `open` already resolved — clean
   * custody, bytes present, an explicit allow — so a range request is decided
   * exactly as a whole-file request is, before a byte is read. It streams the
   * range from disk and never reads the rest of the file. An invalid range
   * (negative, reversed, or past the end) throws rather than being clamped: the
   * HTTP layer decides what an unsatisfiable request means, not this port.
   *
   * Like `body`, it is lazy: nothing is opened until it is iterated.
   */
  range(start: number, end: number): AsyncIterable<Uint8Array>;
}
