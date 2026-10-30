import type {
  AssetLicence,
  AssetVisibility,
  DisappearanceClass,
  DuplicateSignal,
  DuplicateState,
  ErrorClassification,
  ErrorResolution,
  ErrorStage,
  ItemOutcome,
  LegacyMappingState,
  LinkDisposition,
  ManifestEntryMode,
  ManifestEntryState,
  ManifestState,
  MigrationContentKind,
  MigrationPublishableKind,
  PersonalDataState,
  PromotionDestination,
  PromotionState,
  ReconciliationState,
  RecordObservation,
  RecordStatus,
  ReviewState,
  RunState,
  SourceAccessMethod,
  SourceAuthorityKind,
  SourcePolicy,
  SourceState,
  TopicMappingState,
  ValidationIssue,
  ValidationState,
} from './values.ts';
import type { ParsedRecord, StagedPayload } from './payloads.ts';

/**
 * The ports the Migration & Provenance context depends on (DOMAIN_MODEL.md
 * §16). Persistence is implemented by Migration's own adapter hosted in
 * `packages/database`; the source adapters and the safe fetch boundary come
 * from `scripts/migration/`; the publication targets, Identity's answers,
 * Taxonomy's answers and Storage are composed at Layer 4.
 *
 * THE DATABASE IS THE AUTHORITY FOR EVERY INVARIANT IT CAN HOLD. Append-only
 * evidence, forward-only review and manifest states, one open run per source,
 * one active mapping per legacy address, one live manifest entry per staged
 * revision, and publication authority are enforced by keys, CHECKs and
 * triggers; the service checks first only to answer helpfully.
 *
 * EVERY OPERATOR ACT commits its audit row IN THE SAME TRANSACTION as the
 * change it describes — never a raw body, never a payload, only identifiers
 * and states (SECURITY_BASELINE.md §13.4).
 */

/**
 * WHAT A PUBLICATION MADE, by the kind's TYPED identity. Persistence keeps it
 * in that kind's own nullable foreign-key column (the SavedItem pattern) —
 * never a `targetType` / `targetId` pair — so `kind` here only says which
 * typed column `id` belongs in.
 */
export interface MigrationTargetRef {
  readonly kind: MigrationPublishableKind;
  readonly id: string;
}

/**
 * How far into its owning domain a publication carried a record. `public`: the
 * domain published it. `in-review`: the domain's own workflow requires a
 * second person (Editorial refuses self-approval), so the record was delivered
 * into that review and becomes public only by the domain's own decision.
 */
export const TARGET_STAGES = Object.freeze(['public', 'in-review'] as const);
export type TargetStage = (typeof TARGET_STAGES)[number];

/** An operator, identified by account only. Authority is asked live. */
export interface MigrationActor {
  readonly accountId: string;
}

/* ===========================================================================
 * Records the ports return
 * ========================================================================= */

export interface SourceRecord {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly authorityKind: SourceAuthorityKind;
  readonly accessMethod: SourceAccessMethod;
  readonly contentKind: MigrationContentKind;
  readonly baseUrl: string | null;
  /** The PAGE hosts: discovery, items and links. */
  readonly hosts: readonly string[];
  /**
   * Phase 30-R. The exact first-party ASSET hosts: reached only to acquire an
   * image the source's own pages name, never for discovery, items or links.
   */
  readonly assetHosts: readonly string[];
  readonly authorisationReference: string | null;
  readonly authorisedOn: string | null;
  readonly licensingEvidence: string | null;
  readonly policyNotes: string | null;
  readonly defaultLanguageCode: string | null;
  readonly policy: SourcePolicy;
  readonly state: SourceState;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** Which code produced what — recorded on the run and on every staged revision. */
export interface TransformProvenance {
  readonly adapterKey: string;
  readonly adapterVersion: string;
  readonly parserKey: string;
  readonly parserVersion: string;
  readonly normalizerVersion: string;
  /** The deployed commit (`MINHAJ_RELEASE_SHA`) or `local`, never empty. */
  readonly codeRevision: string;
}

export interface RunRecord {
  readonly id: string;
  readonly sourceId: string;
  readonly sourceKey: string;
  readonly operatorUserId: string;
  readonly state: RunState;
  readonly provenance: TransformProvenance;
  readonly discoveryCursor: string | null;
  readonly discoveryComplete: boolean;
  readonly leaseExpiresAt: Date | null;
  readonly startedAt: Date;
  readonly endedAt: Date | null;
  readonly reconciliation: ReconciliationState;
  readonly reconciledAt: Date | null;
  readonly version: number;
}

/**
 * Everything reconciliation counts for ONE run, in one bounded aggregate read
 * (MIGRATION_STRATEGY.md §6.1). The context decides whether it balances.
 */
export interface RunCounts {
  /** Items in the run — every record the run discovered. */
  readonly discovered: number;
  readonly pending: number;
  /** Items whose evidence was obtained (a snapshot, or an unchanged checksum). */
  readonly fetched: number;
  readonly parsed: number;
  readonly staged: number;
  readonly unchanged: number;
  readonly rejected: number;
  readonly errored: number;
  readonly excluded: number;
  /** Items whose outcome claims evidence the row does not carry. */
  readonly inconsistent: number;
  /** Of this run's staged revisions, by review. */
  readonly reviewPending: number;
  readonly approved: number;
  readonly reviewRejected: number;
  readonly superseded: number;
  /** Manifest entries of this run's revisions now published. */
  readonly published: number;
  /** Published entries with at least one legacy mapping (active or disabled). */
  readonly mapped: number;
  /** Records collapsed or merged into another record during this run. */
  readonly merged: number;
}

export interface DiscoveredItem {
  /** The canonical external key within the source (`canonicalSourceUrl`). */
  readonly externalKey: string;
  readonly originalUrl: string | null;
  readonly legacyIdentifier: string | null;
}

/** One item a run still has to process, with what is known of its record. */
export interface PendingItem {
  readonly itemId: string;
  readonly recordId: string;
  readonly externalKey: string;
  readonly originalUrl: string | null;
  readonly legacyIdentifier: string | null;
  readonly attempts: number;
  /** The record's newest snapshot — re-used, never duplicated, after a crash. */
  readonly latestSnapshot: { readonly id: string; readonly checksum: string } | null;
  /** The revision now current, and the snapshot checksum it was made from. */
  readonly currentStaged: {
    readonly id: string;
    readonly revision: number;
    readonly inputChecksum: string;
    /** Which code made it: the same bytes read by newer code are a new revision. */
    readonly parserVersion: string;
    readonly normalizerVersion: string;
  } | null;
}

export interface ErrorInput {
  readonly sourceId: string;
  readonly runId: string;
  readonly recordId: string | null;
  readonly stage: ErrorStage;
  readonly classification: ErrorClassification;
  readonly retryEligible: boolean;
  readonly httpStatus: number | null;
  readonly attempt: number;
  /** Safe operator text: never a body, header value, credential or payload. */
  readonly detail: string | null;
  readonly occurredAt: Date;
}

export interface SnapshotInput {
  readonly sourceId: string;
  readonly runId: string;
  readonly itemId: string;
  readonly recordId: string;
  readonly requestedUrl: string;
  readonly finalUrl: string;
  readonly httpStatus: number | null;
  readonly contentType: string | null;
  /** Allowlisted provenance headers only, as a JSON object string. */
  readonly headers: string | null;
  readonly body: Uint8Array;
  /** Lowercase hex SHA-256 of `body` — the database re-derives and compares. */
  readonly checksum: string;
  readonly fetchedAt: Date;
  readonly fetcherKey: string;
  readonly fetcherVersion: string;
  readonly personalData: PersonalDataState;
}

export interface StagedLinkInput {
  readonly position: number;
  readonly href: string;
  readonly disposition: LinkDisposition;
  readonly rewrittenTo: string | null;
  readonly legacyMappingId: string | null;
}

export interface DuplicateInput {
  readonly otherRecordId: string;
  readonly signal: DuplicateSignal;
  readonly score: number | null;
  readonly crossLanguage: boolean;
  /** True only for a hard identity: the record is collapsed into the other. */
  readonly collapse: boolean;
}

export interface StageInput {
  readonly sourceId: string;
  readonly runId: string;
  readonly itemId: string;
  readonly recordId: string;
  readonly snapshotId: string;
  readonly contentKind: MigrationContentKind;
  readonly title: string;
  readonly titleKey: string;
  readonly dedupeKey: string | null;
  readonly languageCode: string | null;
  /** The sanitised, normalised payload as JSON. */
  readonly payload: string;
  readonly payloadChecksum: string;
  readonly provenance: TransformProvenance;
  readonly inputChecksum: string;
  readonly producedAt: Date;
  readonly validation: ValidationState;
  readonly issues: readonly ValidationIssue[];
  readonly personalData: PersonalDataState;
  readonly categories: readonly { readonly key: string; readonly label: string }[];
  readonly links: readonly StagedLinkInput[];
  readonly duplicates: readonly DuplicateInput[];
  /** `rejected` when validation failed — its error is recorded with it. */
  readonly outcome: 'staged' | 'rejected';
  readonly error: ErrorInput | null;
}

export interface AssetAcquisitionInput {
  readonly sourceId: string;
  readonly recordId: string | null;
  readonly runId: string;
  readonly originalUrl: string;
  readonly originalUrlDigest: string;
  readonly assetId: string;
  readonly checksum: string;
  readonly byteSize: number;
  readonly mediaType: string;
  readonly licence: AssetLicence;
  readonly licenceEvidence: string | null;
  readonly rightsHolder: string | null;
  readonly acquiredAt: Date;
  /**
   * Phase 30-R. For a still image: the metadata-stripped public copy Storage
   * made of these bytes, its own checksum and measured box. Null for anything
   * else, or when Storage refused the image.
   */
  readonly publicCopy: PublicImageCopy | null;
}

/** Phase 30-R. The public copy of an acquired image. */
export interface PublicImageCopy {
  readonly assetId: string;
  readonly checksum: string;
  readonly width: number;
  readonly height: number;
}

/* ===========================================================================
 * Pipeline persistence — what a run reads and writes, checkpoint by checkpoint
 * ========================================================================= */

export interface MigrationPipelinePort {
  /**
   * Opens the source's run, or RESUMES its one open run when that run's lease
   * has lapsed or is held by `leaseToken`. Refuses (`run-busy`) while another
   * holder's lease is live. A new run is audited `migration.run.started`, a
   * resumed one `migration.run.resumed`.
   */
  openRun(input: {
    readonly sourceId: string;
    readonly operatorUserId: string;
    readonly provenance: TransformProvenance;
    readonly runId: string;
    readonly leaseToken: string;
    readonly leaseUntil: Date;
    readonly now: Date;
  }): Promise<{ readonly run: RunRecord; readonly resumed: boolean }>;

  /** Extends the lease; false when the lease is no longer this holder's. */
  renewLease(runId: string, leaseToken: string, leaseUntil: Date): Promise<boolean>;

  /**
   * ONE DISCOVERY CHECKPOINT, atomically: every item is upserted as a record
   * of the source (present again, its disappearance cleared) and given a run
   * item at the next positions unless the run already has it; the cursor and
   * completeness advance with them. Re-running a checkpoint is a no-op.
   */
  recordDiscovery(input: {
    readonly runId: string;
    readonly leaseToken: string;
    readonly items: readonly DiscoveredItem[];
    readonly nextCursor: string | null;
    readonly complete: boolean;
    readonly now: Date;
  }): Promise<void>;

  /** Pending items due now, in position order, bounded. */
  pendingItems(runId: string, limit: number, now: Date): Promise<readonly PendingItem[]>;

  /** A transient failure: count the attempt and wait until `nextAttemptAt`. */
  scheduleRetry(itemId: string, attempts: number, nextAttemptAt: Date): Promise<void>;

  /**
   * Stores immutable evidence and marks the item fetched. When the record's
   * newest snapshot already carries `checksum` (a crash between storing and
   * staging), that snapshot is re-used and nothing is written twice.
   */
  storeSnapshot(
    input: SnapshotInput,
  ): Promise<{ readonly snapshotId: string; readonly reused: boolean }>;

  /** The source returned exactly what the current revision was made from. */
  markUnchanged(itemId: string, now: Date): Promise<void>;

  /** The adapter says this item is out of scope for its kind. */
  markExcluded(itemId: string, now: Date): Promise<void>;

  /**
   * ONE STAGING CHECKPOINT, atomically: the record's earlier pending or
   * approved revision is superseded; the new revision (next revision number),
   * its categories (unknown ones created `unmapped`), links and duplicate
   * candidates are written; a hard-identity duplicate collapses the record;
   * the item's outcome and the record's status move with them.
   */
  stage(
    input: StageInput,
  ): Promise<{ readonly stagedRecordId: string; readonly revision: number }>;

  /**
   * A classified failure. With `itemId`, the item becomes `errored` and names
   * the error. Without, the error is the run's (a discovery failure).
   */
  recordError(
    input: ErrorInput & { readonly itemId: string | null },
  ): Promise<{ readonly errorId: string }>;

  /** Active legacy mappings of the source, by legacy URL digest. */
  activeMappings(
    sourceId: string,
    legacyUrlDigests: readonly string[],
  ): Promise<
    ReadonlyMap<string, { readonly id: string; readonly canonicalPath: string }>
  >;

  /** Other records whose CURRENT revision carries this hard identity. */
  dedupeMatches(
    dedupeKey: string,
    excludingRecordId: string,
  ): Promise<
    readonly { readonly recordId: string; readonly languageCode: string | null }[]
  >;

  /** Other records whose CURRENT revision of this kind folds to the same title. */
  titleMatches(
    contentKind: MigrationContentKind,
    titleKey: string,
    excludingRecordId: string,
    limit: number,
  ): Promise<
    readonly { readonly recordId: string; readonly languageCode: string | null }[]
  >;

  /**
   * An earlier acquisition's stored asset with exactly these bytes, if any,
   * with the public copy that acquisition recorded (Phase 30-R).
   */
  assetByChecksum(checksum: string): Promise<{
    readonly assetId: string;
    readonly publicCopy: PublicImageCopy | null;
  } | null>;

  /**
   * Phase 30-R. Whether this source already holds an acquisition of exactly
   * this canonical URL — so a replayed or repeated run never fetches the same
   * image twice. The earlier acquisition keeps its own rights decision.
   */
  acquiredUrl(sourceId: string, originalUrlDigest: string): Promise<boolean>;

  /**
   * Phase 30-R. One page of a REPLAY's discovery: the records this source
   * already holds, oldest first, as the items a fresh discovery would have
   * named; `next` is an opaque cursor, null after the last page.
   */
  replayItems(
    sourceId: string,
    cursor: string | null,
    limit: number,
  ): Promise<{
    readonly kind: 'page';
    readonly items: readonly DiscoveredItem[];
    readonly next: string | null;
  }>;

  /**
   * Phase 30-R. A retained raw snapshot's exchange, exactly as stored — or
   * null when its body was disposed of. Read only by a replay.
   */
  retainedSnapshot(snapshotId: string): Promise<{
    readonly requestedUrl: string;
    readonly finalUrl: string;
    readonly httpStatus: number | null;
    readonly contentType: string | null;
    readonly headers: Readonly<Record<string, string>>;
    readonly body: Uint8Array;
  } | null>;

  /** One acquisition's provenance; idempotent on (source, URL, checksum). */
  recordAcquisition(
    input: AssetAcquisitionInput,
  ): Promise<{ readonly provenanceId: string; readonly created: boolean }>;

  reconciliationCounts(runId: string): Promise<RunCounts>;

  /**
   * Completes the run with its reconciliation verdict. Records of the source
   * this COMPLETE discovery did not see become `missing` — an observation,
   * never a deletion. Audited `migration.run.completed`.
   */
  completeRun(input: {
    readonly runId: string;
    readonly leaseToken: string;
    readonly reconciliation: Exclude<ReconciliationState, 'pending'>;
    readonly detail: string;
    readonly now: Date;
  }): Promise<{ readonly missing: number }>;

  /** An operator cancels an open run. Audited. */
  cancelRun(input: {
    readonly runId: string;
    readonly expectedVersion: number;
    readonly actorId: string;
    readonly now: Date;
  }): Promise<void>;
}

/* ===========================================================================
 * Sources
 * ========================================================================= */

export interface MigrationSourcePort {
  /** Creates a FIXTURE source with its hosts. Audited `migration.source.created`. */
  createFixtureSource(input: {
    readonly id: string;
    readonly key: string;
    readonly name: string;
    readonly accessMethod: SourceAccessMethod;
    readonly contentKind: MigrationContentKind;
    readonly baseUrl: string | null;
    readonly hosts: readonly string[];
    readonly defaultLanguageCode: string | null;
    readonly policy: SourcePolicy;
    readonly licensingEvidence: string | null;
    readonly policyNotes: string | null;
    readonly actorId: string;
    readonly now: Date;
  }): Promise<SourceRecord>;

  /**
   * Creates an AUTHORISED source, INACTIVE, with its hosts and its written
   * authorisation reference and date. Audited `migration.source.registered`.
   */
  createAuthorisedSource(input: {
    readonly id: string;
    readonly key: string;
    readonly name: string;
    readonly contentKind: MigrationContentKind;
    readonly baseUrl: string;
    readonly hosts: readonly string[];
    readonly assetHosts: readonly string[];
    readonly defaultLanguageCode: string | null;
    readonly policy: SourcePolicy;
    readonly authorisationReference: string;
    readonly authorisedOn: string;
    readonly licensingEvidence: string | null;
    readonly policyNotes: string | null;
    readonly actorId: string;
    readonly now: Date;
  }): Promise<SourceRecord>;

  /**
   * Phase 30-R. Appends one ASSET host to an AUTHORISED source at its expected
   * version — a host is never changed or removed. Audited
   * `migration.source.asset-host-added` with the evidence the operator gave.
   */
  addAssetHost(input: {
    readonly sourceId: string;
    readonly expectedVersion: number;
    readonly host: string;
    readonly evidence: string;
    readonly actorId: string;
    readonly now: Date;
  }): Promise<SourceRecord>;

  /** Changes what may change, at the expected version. Audited. */
  updateSource(input: {
    readonly id: string;
    readonly expectedVersion: number;
    readonly name: string;
    readonly state: SourceState;
    readonly defaultLanguageCode: string | null;
    readonly policy: SourcePolicy;
    readonly licensingEvidence: string | null;
    readonly policyNotes: string | null;
    readonly actorId: string;
    readonly now: Date;
  }): Promise<SourceRecord>;

  source(id: string): Promise<SourceRecord | null>;
  sourceByKey(key: string): Promise<SourceRecord | null>;
}

/* ===========================================================================
 * Decisions — every one at an expected version, every one audited
 * ========================================================================= */

export interface MigrationDecisionPort {
  /** approve | reject | withdraw an approval. The record's status follows. */
  review(input: {
    readonly stagedRecordId: string;
    readonly expectedVersion: number;
    readonly review: Extract<ReviewState, 'approved' | 'rejected' | 'pending'>;
    readonly note: string | null;
    readonly actorId: string;
    readonly now: Date;
  }): Promise<void>;

  /** merge | distinct | reopen. A merge is reversible; its URLs are kept. */
  decideDuplicate(input: {
    readonly candidateId: string;
    readonly expectedVersion: number;
    readonly state: Extract<DuplicateState, 'merged' | 'distinct' | 'open'>;
    readonly note: string | null;
    readonly actorId: string;
    readonly now: Date;
  }): Promise<void>;

  decideTopicMapping(input: {
    readonly mappingId: string;
    readonly expectedVersion: number;
    readonly state: TopicMappingState;
    readonly topicId: string | null;
    readonly actorId: string;
    readonly now: Date;
  }): Promise<void>;

  /**
   * retry | dismiss. A retry of an error whose run is still open returns its
   * item to `pending`; a closed run's record is fetched again by the next run.
   */
  decideError(input: {
    readonly errorId: string;
    readonly expectedVersion: number;
    readonly resolution: Extract<ErrorResolution, 'retry-requested' | 'dismissed'>;
    readonly actorId: string;
    readonly now: Date;
  }): Promise<void>;

  /** Classifies a MISSING record. Deletes and unpublishes nothing. */
  classifyDisappearance(input: {
    readonly recordId: string;
    readonly expectedVersion: number;
    readonly classification: DisappearanceClass;
    readonly note: string | null;
    readonly actorId: string;
    readonly now: Date;
  }): Promise<void>;

  /** One acquisition's rights. Never another acquisition's, whatever its bytes. */
  decideRights(input: {
    readonly provenanceId: string;
    readonly expectedVersion: number;
    readonly licence: AssetLicence;
    readonly visibility: AssetVisibility;
    readonly licenceEvidence: string | null;
    readonly rightsHolder: string | null;
    readonly actorId: string;
    readonly now: Date;
  }): Promise<void>;

  /** Disables or re-enables one legacy mapping. */
  decideLegacyMapping(input: {
    readonly mappingId: string;
    readonly expectedVersion: number;
    readonly state: LegacyMappingState;
    readonly actorId: string;
    readonly now: Date;
  }): Promise<void>;
}

/* ===========================================================================
 * Raw evidence — read and disposal, both audited, both bounded
 * ========================================================================= */

export interface RawSnapshotBody {
  readonly id: string;
  readonly contentType: string | null;
  readonly byteSize: number;
  readonly checksum: string;
  readonly personalData: PersonalDataState;
  /** Null when the body was disposed of. */
  readonly body: Uint8Array | null;
}

export interface MigrationRawPort {
  /**
   * Reads at most `maxBytes` of one body and commits the audit row
   * `migration.snapshot.read` in the same transaction — the read is
   * accountable whether or not the caller then shows it.
   */
  readSnapshot(input: {
    readonly snapshotId: string;
    readonly maxBytes: number;
    readonly purpose: 'preview' | 'download';
    readonly actorId: string;
    readonly now: Date;
  }): Promise<RawSnapshotBody | null>;

  /** Removes the body only; metadata and checksum remain. Audited. */
  disposeSnapshot(input: {
    readonly snapshotId: string;
    readonly reason: string;
    readonly actorId: string;
    readonly now: Date;
  }): Promise<void>;
}

/* ===========================================================================
 * Publication — manifests and their reversal
 * ========================================================================= */

export interface ManifestRecord {
  readonly id: string;
  readonly sourceId: string;
  readonly runId: string;
  readonly state: ManifestState;
  readonly createdByUserId: string;
  readonly createdAt: Date;
  readonly publishedByUserId: string | null;
  readonly publishedAt: Date | null;
  readonly rollbackByUserId: string | null;
  readonly rollbackReason: string | null;
  readonly rolledBackAt: Date | null;
  readonly version: number;
}

export interface ManifestEntryRecord {
  readonly id: string;
  readonly manifestId: string;
  readonly position: number;
  readonly stagedRecordId: string;
  readonly recordId: string;
  readonly state: ManifestEntryState;
  /**
   * Phase 30-R. `create` makes the record in its domain; `refresh` carries a
   * newer approved revision into the record an earlier manifest made. Fixed
   * when the entry is created: a refresh is an entry whose record already had
   * an ACTIVE legacy mapping then.
   */
  readonly mode: ManifestEntryMode;
  readonly target: MigrationTargetRef | null;
  readonly targetStage: TargetStage | null;
  readonly targetVersion: number | null;
  readonly canonicalPath: string | null;
  readonly refusal: string | null;
  readonly publishedAt: Date | null;
  readonly rolledBackAt: Date | null;
  readonly version: number;
}

/** What an entry needs to be published: its staged revision, as approved. */
export interface PublishableEntry {
  readonly entry: ManifestEntryRecord;
  readonly contentKind: MigrationContentKind;
  readonly review: ReviewState;
  readonly validation: ValidationState;
  readonly payload: string;
  /** Topics from the CURRENT confirmed mappings of its categories. */
  readonly topicIds: readonly string[];
  /** Its record's legacy URL and every URL of records merged into it. */
  readonly legacyUrls: readonly { readonly recordId: string; readonly url: string }[];
  /**
   * The record's acquired assets a PERSON decided `public-eligible` — the only
   * acquisitions a publisher may hand a target — by canonical source URL.
   */
  readonly assets: readonly PublishableAsset[];
}

export interface PublishableAsset {
  readonly originalUrl: string;
  readonly assetId: string;
  readonly mediaType: string;
  readonly checksum: string;
  /** Phase 30-R: the metadata-stripped public copy of an image, the only bytes a domain may show. */
  readonly publicCopy: PublicImageCopy | null;
}

export interface MigrationPublicationPort {
  /** A draft over approved revisions of one completed, balanced run. Audited. */
  createManifest(input: {
    readonly id: string;
    readonly runId: string;
    readonly stagedRecordIds: readonly string[];
    readonly actorId: string;
    readonly now: Date;
  }): Promise<ManifestRecord>;

  manifest(id: string): Promise<{
    readonly manifest: ManifestRecord;
    readonly entries: readonly ManifestEntryRecord[];
  } | null>;

  discardManifest(input: {
    readonly manifestId: string;
    readonly expectedVersion: number;
    readonly actorId: string;
    readonly now: Date;
  }): Promise<void>;

  /** draft -> publishing. The database re-checks publication authority. Audited. */
  beginPublication(input: {
    readonly manifestId: string;
    readonly expectedVersion: number;
    readonly actorId: string;
    readonly now: Date;
  }): Promise<ManifestRecord>;

  /** The next entries still to publish, in position order, bounded. */
  publishable(manifestId: string, limit: number): Promise<readonly PublishableEntry[]>;

  /** Marks the entry in flight, so a crash is resumed by adoption, not repetition. */
  claimEntry(entryId: string, expectedVersion: number): Promise<ManifestEntryRecord>;

  /**
   * What the target made, once: the entry becomes published, one ACTIVE legacy
   * mapping per legacy URL is created, and the records become `published`.
   */
  recordPublished(input: {
    readonly entryId: string;
    readonly expectedVersion: number;
    readonly target: MigrationTargetRef;
    readonly targetStage: TargetStage;
    readonly targetVersion: number;
    readonly canonicalPath: string;
    readonly legacyUrls: readonly {
      readonly recordId: string;
      readonly url: string;
      readonly digest: string;
    }[];
    readonly actorId: string;
    readonly now: Date;
  }): Promise<void>;

  /**
   * What an ACTIVE legacy mapping of any source names for this legacy URL
   * digest, or null — how one record's reference to another resolves: only
   * once the other is published, never by a guess.
   */
  resolveLegacyTarget(legacyUrlDigest: string): Promise<MigrationTargetRef | null>;

  /** The target refused, or the approval was withdrawn. */
  recordRefused(input: {
    readonly entryId: string;
    readonly expectedVersion: number;
    readonly refusal: string;
    readonly now: Date;
  }): Promise<void>;

  /** publishing -> published, once no entry is pending or in flight. Audited. */
  completePublication(input: {
    readonly manifestId: string;
    readonly now: Date;
  }): Promise<ManifestRecord>;

  /** published -> rolling-back. The database re-checks authority. Audited. */
  beginRollback(input: {
    readonly manifestId: string;
    readonly expectedVersion: number;
    readonly reason: string;
    readonly actorId: string;
    readonly now: Date;
  }): Promise<ManifestRecord>;

  /** Entries still published (or escalated) in a rolling-back manifest. */
  reversible(manifestId: string, limit: number): Promise<readonly ManifestEntryRecord[]>;

  /** Withdrawn by the target: mappings disabled, records back to approved. */
  recordRolledBack(input: {
    readonly entryId: string;
    readonly expectedVersion: number;
    readonly actorId: string;
    readonly now: Date;
  }): Promise<void>;

  /** Not safe to reverse automatically — left for a person. */
  recordRollbackRefused(input: {
    readonly entryId: string;
    readonly expectedVersion: number;
    readonly now: Date;
  }): Promise<void>;

  /** rolling-back -> rolled-back once nothing remains to reverse. Audited. */
  completeRollback(input: {
    readonly manifestId: string;
    readonly now: Date;
  }): Promise<ManifestRecord>;
}

/* ===========================================================================
 * Promotion — the reviewed corpus set, never environment state
 * ========================================================================= */

export interface PromotionRecord {
  readonly id: string;
  readonly state: PromotionState;
  readonly destination: PromotionDestination;
  readonly createdByUserId: string;
  readonly createdAt: Date;
  readonly approvedByUserId: string | null;
  readonly approvedAt: Date | null;
  readonly withdrawnAt: Date | null;
  readonly completedAt: Date | null;
  readonly entryCount: number;
  readonly promotedCount: number;
  readonly version: number;
}

/**
 * One promoted item, as the destination receives it: content, provenance,
 * mappings and checksums — and BY CONSTRUCTION no account, credential, session
 * or configuration (MIGRATION_STRATEGY.md §10.1.1).
 */
export interface PromotionItem {
  readonly promotionEntryId: string;
  readonly manifestEntryId: string;
  readonly contentKind: MigrationContentKind;
  readonly payload: string;
  readonly payloadChecksum: string;
  readonly inputChecksum: string;
  readonly provenance: TransformProvenance;
  readonly sourceKey: string;
  readonly externalKey: string;
  readonly canonicalPath: string;
  readonly legacyUrls: readonly string[];
  readonly reviewedAt: string;
  readonly publishedAt: string;
}

export interface MigrationPromotionPort {
  createPromotion(input: {
    readonly id: string;
    readonly manifestEntryIds: readonly string[];
    readonly actorId: string;
    readonly now: Date;
  }): Promise<PromotionRecord>;

  promotion(id: string): Promise<PromotionRecord | null>;

  /** draft -> approved. The database re-checks authority. Audited. */
  approve(input: {
    readonly promotionId: string;
    readonly expectedVersion: number;
    readonly actorId: string;
    readonly now: Date;
  }): Promise<PromotionRecord>;

  /** Withdraws an approval until the promotion completes. Audited. */
  withdraw(input: {
    readonly promotionId: string;
    readonly expectedVersion: number;
    readonly actorId: string;
    readonly now: Date;
  }): Promise<PromotionRecord>;

  /** approved -> promoting (or stays promoting on resume). */
  beginPromoting(input: {
    readonly promotionId: string;
    readonly now: Date;
  }): Promise<PromotionRecord>;

  /** The next entries the destination does not yet have, in order, bounded. */
  pendingItems(promotionId: string, limit: number): Promise<readonly PromotionItem[]>;

  recordPromoted(input: {
    readonly promotionEntryId: string;
    readonly destinationRef: string;
    readonly now: Date;
  }): Promise<void>;

  /** promoting -> promoted once nothing is pending. Audited. */
  complete(input: {
    readonly promotionId: string;
    readonly actorId: string;
    readonly now: Date;
  }): Promise<PromotionRecord>;
}

/* ===========================================================================
 * Operator reads — bounded, deterministic, raw bodies never included
 * ========================================================================= */

export interface RunListRow {
  readonly id: string;
  readonly sourceKey: string;
  readonly state: RunState;
  readonly reconciliation: ReconciliationState;
  readonly startedAt: Date;
  readonly endedAt: Date | null;
  readonly items: number;
}

export interface RunItemRow {
  readonly itemId: string;
  readonly recordId: string;
  readonly position: number;
  readonly externalKey: string;
  readonly outcome: ItemOutcome;
  readonly attempts: number;
  readonly snapshotId: string | null;
  readonly stagedRecordId: string | null;
  readonly errorId: string | null;
}

export interface StagedRow {
  readonly id: string;
  readonly recordId: string;
  readonly runId: string;
  readonly revision: number;
  readonly contentKind: MigrationContentKind;
  readonly title: string;
  readonly languageCode: string | null;
  readonly validation: ValidationState;
  readonly personalData: PersonalDataState;
  readonly review: ReviewState;
  readonly producedAt: Date;
  readonly version: number;
}

export interface StagedDetail extends StagedRow {
  readonly sourceId: string;
  readonly externalKey: string;
  readonly originalUrl: string | null;
  readonly recordStatus: RecordStatus;
  readonly payload: string;
  readonly payloadChecksum: string;
  readonly provenance: TransformProvenance;
  readonly inputChecksum: string;
  readonly snapshotId: string;
  readonly issues: readonly ValidationIssue[];
  readonly reviewNote: string | null;
  readonly reviewedAt: Date | null;
  readonly categories: readonly {
    readonly mappingId: string;
    readonly categoryKey: string;
    readonly label: string;
    readonly state: TopicMappingState;
    readonly topicId: string | null;
  }[];
  readonly links: readonly StagedLinkInput[];
}

export interface DuplicateRow {
  readonly id: string;
  readonly recordId: string;
  readonly recordTitle: string | null;
  readonly otherRecordId: string;
  readonly otherTitle: string | null;
  readonly signal: DuplicateSignal;
  readonly score: number | null;
  readonly crossLanguage: boolean;
  readonly state: DuplicateState;
  readonly createdAt: Date;
  readonly version: number;
}

export interface TopicMappingRow {
  readonly id: string;
  readonly sourceKey: string;
  readonly categoryKey: string;
  readonly label: string;
  readonly state: TopicMappingState;
  readonly topicId: string | null;
  readonly suggestedTopicId: string | null;
  readonly stagedCount: number;
  readonly version: number;
}

export interface LegacyMappingRow {
  readonly id: string;
  readonly sourceKey: string;
  readonly legacyUrl: string;
  readonly canonicalPath: string;
  readonly state: LegacyMappingState;
  readonly manifestId: string | null;
  readonly createdAt: Date;
  readonly version: number;
}

export interface UnresolvedLinkRow {
  readonly stagedRecordId: string;
  readonly title: string;
  readonly href: string;
}

export interface ErrorRow {
  readonly id: string;
  readonly runId: string;
  readonly recordId: string | null;
  readonly stage: ErrorStage;
  readonly classification: ErrorClassification;
  readonly retryEligible: boolean;
  readonly httpStatus: number | null;
  readonly attempt: number;
  readonly detail: string | null;
  readonly occurredAt: Date;
  readonly resolution: ErrorResolution;
  readonly version: number;
}

export interface MissingRecordRow {
  readonly id: string;
  readonly sourceKey: string;
  readonly externalKey: string;
  readonly status: RecordStatus;
  readonly observed: RecordObservation;
  readonly disappearance: DisappearanceClass | null;
  readonly lastObservedRunId: string;
  readonly version: number;
}

export interface AssetProvenanceRow {
  readonly id: string;
  readonly recordId: string | null;
  /** Phase 30-R: the run that acquired it. */
  readonly runId: string;
  readonly originalUrl: string;
  readonly assetId: string;
  readonly checksum: string;
  readonly byteSize: number;
  readonly mediaType: string;
  readonly licence: AssetLicence;
  /** Phase 30-R: the rights evidence recorded — the source's own, or a person's. */
  readonly licenceEvidence: string | null;
  readonly visibility: AssetVisibility;
  readonly rightsHolder: string | null;
  /** Phase 30-R: the measured box of the metadata-stripped public copy, if one was made. */
  readonly publicCopy: { readonly width: number; readonly height: number } | null;
  readonly version: number;
}

export interface SnapshotMeta {
  readonly id: string;
  readonly recordId: string;
  readonly runId: string;
  readonly requestedUrl: string;
  readonly finalUrl: string;
  readonly httpStatus: number | null;
  readonly contentType: string | null;
  readonly byteSize: number;
  readonly checksum: string;
  readonly fetchedAt: Date;
  readonly personalData: PersonalDataState;
  readonly disposedAt: Date | null;
}

/* One bounded page per list: concrete types, so an adapter surface names no
 * unconcretised generic (the Model-A surface gate verifies each exactly). */
export interface SourcePage {
  readonly rows: readonly SourceRecord[];
  readonly total: number;
  readonly offset: number;
}
export interface RunListPage {
  readonly rows: readonly RunListRow[];
  readonly total: number;
  readonly offset: number;
}
export interface RunItemPage {
  readonly rows: readonly RunItemRow[];
  readonly total: number;
  readonly offset: number;
}
export interface StagedPage {
  readonly rows: readonly StagedRow[];
  readonly total: number;
  readonly offset: number;
}
export interface DuplicatePage {
  readonly rows: readonly DuplicateRow[];
  readonly total: number;
  readonly offset: number;
}
export interface TopicMappingPage {
  readonly rows: readonly TopicMappingRow[];
  readonly total: number;
  readonly offset: number;
}
export interface LegacyMappingPage {
  readonly rows: readonly LegacyMappingRow[];
  readonly total: number;
  readonly offset: number;
}
export interface UnresolvedLinkPage {
  readonly rows: readonly UnresolvedLinkRow[];
  readonly total: number;
  readonly offset: number;
}
export interface ErrorPage {
  readonly rows: readonly ErrorRow[];
  readonly total: number;
  readonly offset: number;
}
export interface MissingRecordPage {
  readonly rows: readonly MissingRecordRow[];
  readonly total: number;
  readonly offset: number;
}
export interface ManifestPage {
  readonly rows: readonly ManifestRecord[];
  readonly total: number;
  readonly offset: number;
}
export interface PromotionPage {
  readonly rows: readonly PromotionRecord[];
  readonly total: number;
  readonly offset: number;
}
export interface PromotionEntryPage {
  readonly rows: readonly PromotionEntryRow[];
  readonly total: number;
  readonly offset: number;
}
export interface AssetPage {
  readonly rows: readonly AssetProvenanceRow[];
  readonly total: number;
  readonly offset: number;
}
export interface ReconciliationPage {
  readonly rows: readonly ReconciliationRow[];
  readonly total: number;
  readonly offset: number;
}

export interface PromotionEntryRow {
  readonly id: string;
  readonly manifestEntryId: string;
  readonly position: number;
  readonly state: 'pending' | 'promoted';
}

export interface ReconciliationRow extends RunRecord {
  readonly detail: string | null;
}

export interface MigrationReadPort {
  sources(offset: number, limit: number): Promise<SourcePage>;
  runs(query: {
    readonly sourceId: string | null;
    readonly offset: number;
    readonly limit: number;
  }): Promise<RunListPage>;
  run(id: string): Promise<RunRecord | null>;
  runItems(query: {
    readonly runId: string;
    readonly outcome: ItemOutcome | null;
    readonly offset: number;
    readonly limit: number;
  }): Promise<RunItemPage>;
  staged(query: {
    readonly review: ReviewState | null;
    readonly runId: string | null;
    /** Only revisions no live manifest entry holds (Phase 30-R). */
    readonly unmanifested: boolean;
    readonly offset: number;
    readonly limit: number;
  }): Promise<StagedPage>;
  stagedDetail(id: string): Promise<StagedDetail | null>;
  snapshot(id: string): Promise<SnapshotMeta | null>;
  duplicates(query: {
    readonly state: DuplicateState | null;
    readonly offset: number;
    readonly limit: number;
  }): Promise<DuplicatePage>;
  topicMappings(query: {
    readonly state: TopicMappingState | null;
    readonly offset: number;
    readonly limit: number;
  }): Promise<TopicMappingPage>;
  legacyMappings(query: {
    readonly state: LegacyMappingState | null;
    readonly offset: number;
    readonly limit: number;
  }): Promise<LegacyMappingPage>;
  unresolvedLinks(query: {
    readonly offset: number;
    readonly limit: number;
  }): Promise<UnresolvedLinkPage>;
  errors(query: {
    readonly resolution: ErrorResolution | null;
    readonly runId: string | null;
    readonly offset: number;
    readonly limit: number;
  }): Promise<ErrorPage>;
  missingRecords(query: {
    readonly offset: number;
    readonly limit: number;
  }): Promise<MissingRecordPage>;
  manifests(query: {
    readonly state: ManifestState | null;
    readonly offset: number;
    readonly limit: number;
  }): Promise<ManifestPage>;
  promotions(query: {
    readonly offset: number;
    readonly limit: number;
  }): Promise<PromotionPage>;
  promotionEntries(query: {
    readonly promotionId: string;
    readonly offset: number;
    readonly limit: number;
  }): Promise<PromotionEntryPage>;
  /**
   * Acquisitions, newest first — or, narrowed to one RUN (Phase 30-R), in
   * acquisition order, so a reviewer pages through a run the way it ran.
   */
  assets(query: {
    readonly recordId: string | null;
    readonly runId?: string | null;
    readonly visibility?: AssetVisibility | null;
    readonly offset: number;
    readonly limit: number;
  }): Promise<AssetPage>;
  /** Completed runs with their stored reconciliation, newest first. */
  reconciliations(query: {
    readonly offset: number;
    readonly limit: number;
  }): Promise<ReconciliationPage>;
}

/* ===========================================================================
 * Ports composed at Layer 4 and in scripts/migration
 * ========================================================================= */

/** Identity's live answer, and the re-verification of a privileged actor. */
export interface MigrationAuthorityPort {
  permits(accountId: string, permission: string): Promise<boolean>;
  /**
   * Re-verifies, at the service boundary, an actor minted by Identity's
   * privileged-action gate for `migration.publish` + `migration-publication`.
   * The value is opaque to Migration.
   */
  verifyPublisher(actor: unknown): Promise<string | null>;
}

/** Taxonomy's answer: which of these Topic ids exist now. */
export interface MigrationTopicPort {
  existingTopics(topicIds: readonly string[]): Promise<ReadonlySet<string>>;
}

/** What a publication target said. A refusal is authoritative. */
export type TargetPublication =
  | {
      readonly status: 'published';
      readonly target: MigrationTargetRef;
      readonly stage: TargetStage;
      readonly version: number;
      readonly canonicalPath: string;
    }
  | { readonly status: 'refused'; readonly reason: string }
  | { readonly status: 'unavailable' };

export type TargetWithdrawal =
  | { readonly status: 'withdrawn'; readonly version: number }
  | { readonly status: 'refused'; readonly reason: string }
  | { readonly status: 'unavailable' };

/** What a target says about a record migration published, now. */
export interface TargetInspection {
  readonly exists: boolean;
  readonly version: number;
  /** A person holds it — saved, annotated or watched (MIGRATION_STRATEGY.md §7.2). */
  readonly referencedByPeople: boolean;
}

/**
 * THE TARGET'S OWN PUBLIC INTERFACE, as Layer 4 composes it.
 *
 * Migration never writes a target's tables: it hands the target its payload
 * and the target applies every one of its own rules, authority included. A
 * publish is IDEMPOTENT for one entry — a resumed publication adopts what an
 * interrupted one already made rather than creating it twice.
 */
export interface MigrationPublicationTargetPort {
  supports(kind: MigrationContentKind): boolean;
  publish(input: {
    readonly kind: MigrationPublishableKind;
    readonly payload: StagedPayload;
    readonly topicIds: readonly string[];
    /** Rights-cleared acquisitions of this record, by canonical source URL. */
    readonly assets: readonly PublishableAsset[];
    /** Another migrated record's target, by its legacy URL — null until it is published. */
    readonly resolve: (legacyUrl: string) => Promise<MigrationTargetRef | null>;
    readonly actor: MigrationActor;
    /**
     * True only when this entry was already in flight — an interrupted
     * publication being resumed. Only then may the target ADOPT a record that
     * already matches; a fresh entry meeting an existing record is refused
     * (`target-exists`) for a person, never silently claimed as published.
     */
    readonly resumed: boolean;
  }): Promise<TargetPublication>;
  /**
   * Phase 30-R. Carries a NEWER approved revision of an already-published
   * legacy record into the record an earlier manifest made, through the
   * domain's own update at its current version — applying every one of the
   * domain's rules again. Idempotent: a record already holding exactly this
   * payload answers `published` unchanged. Editorial's own workflow returns
   * an edited record to review, so a refresh there is `in-review` until a
   * different person approves and publishes it.
   */
  refresh(input: {
    readonly kind: MigrationPublishableKind;
    readonly target: MigrationTargetRef;
    readonly payload: StagedPayload;
    readonly topicIds: readonly string[];
    readonly assets: readonly PublishableAsset[];
    readonly resolve: (legacyUrl: string) => Promise<MigrationTargetRef | null>;
    readonly actor: MigrationActor;
  }): Promise<TargetPublication>;
  /** Asked as the publisher: the target's own read authority applies. */
  inspect(input: {
    readonly target: MigrationTargetRef;
    readonly actor: MigrationActor;
  }): Promise<TargetInspection | null>;
  withdraw(input: {
    readonly target: MigrationTargetRef;
    readonly expectedVersion: number;
    readonly actor: MigrationActor;
  }): Promise<TargetWithdrawal>;
}

/** Storage, narrowed to what acquisition needs. Bytes stay quarantined until scanned. */
export interface MigrationAssetStoragePort {
  store(input: {
    readonly bytes: Uint8Array;
    readonly declaredMediaType: string | null;
    readonly displayName: string | null;
  }): Promise<
    | {
        readonly status: 'stored';
        readonly assetId: string;
        readonly mediaType: string;
        readonly byteSize: number;
        readonly checksum: string;
        readonly clean: boolean;
      }
    | { readonly status: 'rejected'; readonly reason: string }
  >;
  /**
   * Phase 30-R. The PUBLIC copy of an acquired still image: the same bytes
   * through Storage's image pipeline — structurally validated, bounded, every
   * hidden metadata segment removed — then quarantined and scanned like any
   * other asset. Its checksum differs from the evidence's by design.
   */
  storePublicImage(input: {
    readonly bytes: Uint8Array;
    readonly displayName: string | null;
  }): Promise<
    | {
        readonly status: 'stored';
        readonly assetId: string;
        readonly checksum: string;
        readonly width: number;
        readonly height: number;
      }
    | { readonly status: 'rejected'; readonly reason: string }
  >;
}

/** Where an approved promotion is carried. Idempotent per promotion entry. */
export interface MigrationPromotionDestinationPort {
  readonly destination: PromotionDestination;
  put(item: PromotionItem): Promise<{ readonly destinationRef: string }>;
}

/* ===========================================================================
 * Source access — implemented by scripts/migration, never by the context
 * ========================================================================= */

/** One HTTP exchange's result, after the SSRF policy and caps were applied. */
export type FetchOutcome =
  | {
      readonly kind: 'response';
      readonly status: number;
      readonly requestedUrl: string;
      readonly finalUrl: string;
      readonly contentType: string | null;
      /** Allowlisted response headers only. */
      readonly headers: Readonly<Record<string, string>>;
      readonly body: Uint8Array;
      readonly retryAfter: string | null;
    }
  | {
      readonly kind: 'refused';
      readonly classification: Extract<
        ErrorClassification,
        | 'redirect-refused'
        | 'address-refused'
        | 'scope-refused'
        | 'too-large'
        | 'unsupported-type'
      >;
      readonly requestedUrl: string;
      readonly detail: string;
    }
  | {
      readonly kind: 'failure';
      readonly classification: Extract<ErrorClassification, 'network' | 'timeout'>;
      readonly requestedUrl: string;
      readonly detail: string;
    };

/** The safe fetch boundary for one source's scope. One attempt per call. */
export interface MigrationFetchPort {
  readonly fetcherKey: string;
  readonly fetcherVersion: string;
  fetch(url: string): Promise<FetchOutcome>;
}

/** What an adapter obtained for one item: bytes as the source gave them. */
export type RetrievedEvidence =
  | {
      readonly kind: 'evidence';
      readonly requestedUrl: string;
      readonly finalUrl: string;
      readonly httpStatus: number | null;
      readonly contentType: string | null;
      readonly headers: Readonly<Record<string, string>>;
      readonly body: Uint8Array;
    }
  | { readonly kind: 'outcome'; readonly outcome: FetchOutcome };

export type ParseResult =
  | { readonly kind: 'parsed'; readonly record: ParsedRecord }
  | { readonly kind: 'excluded'; readonly reason: string }
  | { readonly kind: 'failed'; readonly detail: string };

/**
 * A SOURCE ADAPTER (MIGRATION_STRATEGY.md §3.2): source-specific knowledge in
 * exactly one place. It discovers, retrieves and parses; it persists nothing,
 * decides nothing about review, and never reaches the database.
 */
export interface MigrationSourceAdapter {
  readonly adapterKey: string;
  readonly adapterVersion: string;
  readonly parserKey: string;
  readonly parserVersion: string;
  readonly contentKind: MigrationContentKind;
  readonly accessMethod: SourceAccessMethod;
  /** One bounded page of discovery from `cursor` (null: the beginning). */
  discover(
    cursor: string | null,
    fetcher: MigrationFetchPort,
  ): Promise<
    | {
        readonly kind: 'page';
        readonly items: readonly DiscoveredItem[];
        readonly next: string | null;
      }
    | { readonly kind: 'outcome'; readonly outcome: FetchOutcome }
  >;
  retrieve(item: PendingItem, fetcher: MigrationFetchPort): Promise<RetrievedEvidence>;
  parse(evidence: {
    readonly body: Uint8Array;
    readonly contentType: string | null;
    readonly finalUrl: string;
  }): ParseResult;
}
