import type {
  SearchFailureCategory,
  SearchIndexStatus,
  SearchKind,
  SearchScopeKind,
  SearchScopeListing,
  SearchScopeProjection,
  SearchScopeRef,
} from './values.ts';

/**
 * The ports around the Search foundation.
 *
 * TWO DIRECTIONS, and they never meet:
 *
 *   - `SearchIndexPort` is the ENGINE side. It is implemented by the SQL Server
 *     adapter inside `packages/database` and is the only thing that knows the
 *     index is a full-text catalogue. The service above it hands it terms, never
 *     grammar, and receives rows, never SQL.
 *
 *   - `SearchScopeSource` and `SearchTargetResolver` are the OWNER side. They are
 *     implemented by the owning contexts over their own public reads and are
 *     handed to Search by Layer-4 composition. Search never reads an owner's
 *     tables; an owner never reads Search's (ARCHITECTURE.md §6.3 rule 5).
 *
 * NO REPOSITORY, NO TRANSACTION, NO CALLBACK. Each method is one named act with
 * its own bounds (ARCHITECTURE.md §3.1.2).
 */

/* ===========================================================================
 * Engine side
 * ========================================================================= */

/**
 * One document, normalised by the Search service for the engine.
 *
 * `matchText` is the folded, bounded text the engine tokenises; `checksum`
 * identifies the whole normalised document so an unchanged projection is not
 * rewritten — every rewrite is full-text population work.
 */
export interface IndexDocument {
  readonly kind: SearchKind;
  readonly resourceId: string;
  readonly textLanguage: string;
  readonly contentLanguage: string | null;
  readonly title: string;
  readonly summary: string;
  readonly matchText: string;
  readonly year: number | null;
  readonly topicIds: readonly string[];
  readonly checksum: string;
}

/** A leased unit of work. Only the holder of `leaseToken` may settle it. */
export interface SearchClaim {
  readonly kind: SearchScopeKind;
  readonly id: string;
  /** The request generation this claim observed. */
  readonly generation: number;
  readonly attempts: number;
  readonly leaseToken: string;
}

/** How a settled claim ended. */
export type SearchSettlement =
  /** The projection is current. */
  | 'current'
  /** A newer request arrived while this one ran; the scope stays pending. */
  | 'superseded'
  /** The failure is recorded and the scope will be retried automatically. */
  | 'retrying'
  /** Automatic retry is exhausted; an operator must retry it. */
  | 'failed'
  /** The lease had already expired and another worker owns the scope. */
  | 'lost';

/**
 * A query, already normalised and bounded by the Search service.
 *
 * `terms` are folded words made only of letters, marks and digits. The adapter
 * builds its engine grammar from them and from nothing else a visitor typed.
 */
export interface IndexQuery {
  readonly terms: readonly string[];
  readonly kinds: readonly SearchKind[] | null;
  readonly topicId: string | null;
  readonly contentLanguage: string | null;
  readonly fromYear: number | null;
  readonly toYear: number | null;
  /**
   * The interface locale. When one resource matches in several languages, the
   * variant written in the reader's own interface language is preferred as its
   * single result — a presentation preference that hides nothing.
   */
  readonly preferredLanguage: string;
  readonly offset: number;
  readonly limit: number;
}

export interface IndexRow {
  readonly kind: SearchKind;
  readonly resourceId: string;
  readonly textLanguage: string;
  readonly contentLanguage: string | null;
  readonly title: string;
  readonly summary: string;
  readonly year: number | null;
}

export interface IndexQueryResult {
  /** Distinct matching resources, never more than the ranking ceiling. */
  readonly total: number;
  readonly rows: readonly IndexRow[];
}

/** What reconciliation needs to know about one scope's derived state. */
export interface IndexedScopeState {
  readonly documents: number;
  readonly stamp: string | null;
  readonly settled: boolean;
}

export interface SearchIndexPort {
  /**
   * Records that scopes need re-projection. Append-only and idempotent in
   * effect: asking twice re-projects once more, never incorrectly.
   */
  request(scopes: readonly SearchScopeRef[]): Promise<void>;

  /**
   * Folds recorded requests into per-scope work, bounded. Returns how many
   * requests were consumed.
   */
  relay(limit: number): Promise<number>;

  /** Leases due work, oldest first, bounded. */
  claim(input: {
    readonly limit: number;
    readonly leaseSeconds: number;
  }): Promise<readonly SearchClaim[]>;

  /**
   * Replaces a scope's documents with exactly `documents` — an empty list
   * removes the scope from the index — and settles the claim.
   */
  apply(
    claim: SearchClaim,
    projection: {
      readonly stamp: string | null;
      readonly documents: readonly IndexDocument[];
    },
  ): Promise<SearchSettlement>;

  /** Records a categorised failure against a claim, with bounded retry. */
  fail(
    claim: SearchClaim,
    input: {
      readonly category: SearchFailureCategory;
      readonly maxAttempts: number;
      readonly retryAfterSeconds: number;
    },
  ): Promise<SearchSettlement>;

  /** Ranks, filters and pages one query. */
  query(query: IndexQuery): Promise<IndexQueryResult>;

  /** The derived state of a bounded batch of scopes, keyed by id. */
  scopeStates(
    kind: SearchScopeKind,
    ids: readonly string[],
  ): Promise<ReadonlyMap<string, IndexedScopeState>>;

  /**
   * Scopes of one kind that currently hold documents, in the engine's own
   * stable order after `after`. For finding documents whose owner no longer
   * publishes them.
   */
  indexedScopes(input: {
    readonly kind: SearchScopeKind;
    readonly after: string | null;
    readonly limit: number;
  }): Promise<readonly string[]>;

  /** Puts every exhausted scope back on the schedule. Returns how many. */
  retryFailed(): Promise<number>;

  status(input: { readonly failureLimit: number }): Promise<SearchIndexStatus>;
}

/* ===========================================================================
 * Owner side
 * ========================================================================= */

/**
 * One owner's projection of one scope kind.
 *
 * Implemented by the OWNING context over its own public read, never by Search.
 * The visibility rule that decides what `project` returns is the owner's, and
 * it is the same rule the owner's public pages use.
 */
export interface SearchScopeSource {
  /** The scope's current public projection, or `null` when it is not public. */
  project(id: string): Promise<SearchScopeProjection | null>;

  /**
   * Currently-public scopes of this kind in the owner's stable order after
   * `after`, bounded. The authoritative inventory a rebuild restores.
   */
  list(input: {
    readonly after: string | null;
    readonly limit: number;
  }): Promise<readonly SearchScopeListing[]>;
}

/**
 * The CURRENT public address of each id that is public right now.
 *
 * The stale-index rule's enforcement point (ARCHITECTURE.md §8.5): an id absent
 * from the answer is not public, whatever the index still says, and its
 * indexed payload is never returned. One call per kind per result page — never
 * one per result.
 */
export type SearchTargetResolver = (
  ids: readonly string[],
) => Promise<ReadonlyMap<string, string>>;
