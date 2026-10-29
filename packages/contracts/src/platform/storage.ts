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
  | 'unscannable'
  /**
   * Phase 12. A still image whose header declares more pixels, or a longer
   * side, than the upload's image policy permits — the decompression-bomb
   * guard. Distinct from `too-large`, which is about bytes.
   */
  | 'dimensions-too-large'
  /**
   * Phase 24. Its holder released it with the release token it stored the
   * bytes under (`StorageServicePort.release`). The bytes are being removed and
   * the record follows them; nothing serves it in the meantime.
   */
  | 'released';

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
  /**
   * Phase 12. Present when the caller accepts STILL IMAGES ONLY: the upload
   * must then be a structurally whole JPEG or PNG within these bounds, and what
   * is stored is that image with its hidden metadata removed (EXIF, XMP, IPTC,
   * comments, embedded thumbnails and trailing data), its pixels untouched.
   * Every allowed media type must be one the foundation can validate this way.
   */
  readonly image?: ImageLimits;
  /**
   * Phase 24. A secret the CALLER generated and recorded in its own row
   * BEFORE storing — 64 lowercase hex characters (256 random bits).
   *
   * Storage keeps only its SHA-256, so the asset can later be released by
   * whoever holds the token and by nobody else (`release`). An upload without
   * one can never be released through this foundation, which is the posture
   * of every asset stored before Phase 24.
   */
  readonly releaseToken?: string;
}

/** The release-token grammar: 64 lowercase hex characters. */
export const RELEASE_TOKEN_PATTERN = /^[0-9a-f]{64}$/;

/**
 * Bounds on a still image's DECLARED size, checked from its header before the
 * image data is read — so a small file that asks a decoder for an enormous
 * canvas is refused on arrival.
 */
export interface ImageLimits {
  /** Width × height. */
  readonly maxPixels: number;
  /** The longer side. */
  readonly maxEdge: number;
}

/** A still image's size as it is DISPLAYED, orientation applied. */
export interface ImageDimensions {
  readonly width: number;
  readonly height: number;
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
    /** Phase 24. SHA-256 of the caller's release token, or `null`. */
    readonly releaseDigest?: string | null;
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
  /**
   * Phase 12. The records of whichever of `ids` exist, in no particular order —
   * ONE bounded read for a page of assets rather than one per asset.
   */
  findMany(ids: readonly string[]): Promise<readonly AssetRecord[]>;
  /** Bounded sweep of records a crash left mid-lifecycle. */
  staleBefore(cutoff: Date, limit: number): Promise<readonly AssetRecord[]>;
  remove(id: string): Promise<void>;
  /**
   * Phase 24. Withdraws the asset recorded under this release digest from
   * service — `rejected` / `released`, whatever its state — and returns what
   * is needed to remove its bytes, or `null` when no asset carries the digest.
   * Repeatable: a release interrupted after this step finds the record again.
   */
  beginRelease(releaseDigest: string): Promise<{
    readonly id: string;
    readonly storageKey: string;
  } | null>;
  /**
   * Phase 24. Deletes a released record. `false` when a consumer's foreign key
   * still names it: the record then stays `released` and is never served.
   */
  removeReleased(id: string): Promise<boolean>;
}

/** What a successful `store` reports back. */
export interface StoredAsset {
  readonly id: string;
  readonly state: AssetState;
  readonly mediaType: string;
  readonly byteSize: number;
  readonly checksum: string;
  readonly rejection: AssetRejection | null;
  /** Phase 12. The displayed dimensions of a stored still image. */
  readonly image?: ImageDimensions;
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
  /**
   * Phase 12. Which of `assetIds` could be served RIGHT NOW on TECHNICAL grounds
   * alone — clean custody and bytes present — in one bounded pass.
   *
   * IT SERVES NOTHING AND DECIDES NOTHING ABOUT VISIBILITY. A consumer asks it
   * only about assets its OWN authorised records already name, so that a page of
   * images can offer a picture only where fetching it can work, instead of a
   * broken image box. The byte route still makes both decisions per request.
   * Bounded: a question naming more than one hundred identifiers is refused.
   */
  servable(assetIds: readonly string[]): Promise<ReadonlySet<string>>;
  /**
   * Phase 30-R. Which of `assetIds` are servable STILL IMAGES — exactly
   * `servable`, narrowed to the two raster types Storage admits through its
   * image pipeline (JPEG, PNG). A domain asks it before it records an asset
   * as a record's lead image, portrait, cover or poster, so a PDF or a
   * quarantined file can never become one. Same bound, same non-decision about
   * visibility.
   */
  servableImages(assetIds: readonly string[]): Promise<ReadonlySet<string>>;
  /** Bounded, idempotent reconciliation of Storage-owned resources only. */
  reconcile(now: Date, limit: number): Promise<number>;
  /**
   * Phase 24. Releases the asset stored under `releaseToken`: it stops being
   * servable at once, its bytes are removed, then its record.
   *
   * OPERATION-BOUND, NEVER BY IDENTIFIER. The caller proves custody with the
   * secret it generated before storing; an asset id alone releases nothing, so
   * one consumer can never release another consumer's asset, and an asset
   * stored without a token can never be released here at all.
   *
   * Idempotent and resumable: `absent` when nothing carries the token (never
   * stored, or already released), `referenced` when a consumer's foreign key
   * still names the record — whose bytes are then gone and which is never
   * served again, and which the caller must stop referencing first.
   */
  release(releaseToken: string): Promise<'released' | 'absent' | 'referenced'>;
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
