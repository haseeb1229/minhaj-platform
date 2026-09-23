import { createHash } from 'node:crypto';

import type { RateLimitRule } from '@minhaj/contracts/platform';
import {
  SCOPE_OF_KIND,
  SEARCH_DOCUMENTS_PER_SCOPE,
  SEARCH_PAGE_SIZE,
  SEARCH_RESULT_CEILING,
  SEARCH_SCOPE_KINDS,
  SEARCH_STAMP_MAX_LENGTH,
  searchDocumentSourceSchema,
  type IndexDocument,
  type SearchClaim,
  type SearchFailureCategory,
  type SearchHit,
  type SearchIndexPort,
  type SearchIndexStatus,
  type SearchKind,
  type SearchResultPage,
  type SearchScopeKind,
  type SearchScopeSource,
  type SearchSettlement,
  type SearchTargetResolver,
} from '@minhaj/contracts/search';

import { parseSearchParams, type SearchFormState, type SearchIssue } from './request.ts';
import { displaySummary, displayTitle, matchingText } from './text.ts';

/**
 * THE SearchService — Layer 0, engine-independent (ARCHITECTURE.md §4.3).
 *
 * It knows three things and nothing else: how to turn a visitor's words into
 * safe terms, how to keep a derived projection current from its owners, and how
 * to refuse to show a result its owner no longer publishes. It knows no engine
 * (that is `SearchIndexPort`), no owner's tables (those are behind
 * `SearchScopeSource`) and no route (paths come from the owners' resolvers).
 *
 * IT OWNS NO BUSINESS RULE. Whether a Work, an Article or a Person is public is
 * decided by its owner, in the owner's code, twice: once when it projects a
 * scope, and again — at the moment of every search — when it resolves the ids
 * a result page is about to show.
 */

/* ===========================================================================
 * Tuning — every number bounded, every one stated
 * ========================================================================= */

/**
 * Public search, per client address: thirty queries a minute.
 *
 * SEARCH'S POLICY, APPLIED AT THE REQUEST BOUNDARY. The limit is enforced by
 * the application's request proxy through the RateLimiter abstraction, before
 * the results page renders — so the page itself never reads a request header or
 * a secret, which a public content route must not (ARCHITECTURE.md §4.5, §8.1).
 */
export const SEARCH_RATE_RULE: RateLimitRule = { window: 60, max: 30 };

/** A claim is held this long; comfortably longer than one scope takes. */
const LEASE_SECONDS = 60;

/** Requests folded into scope state per relay. */
const RELAY_BATCH = 200;

/** Scopes leased per claim. */
const CLAIM_BATCH = 25;

/** Automatic attempts before a scope waits for an operator. */
const SEARCH_MAX_ATTEMPTS = 6;

/** Retry backoff: 30 s, 1 min, 2 min, 4 min, 8 min — capped at one hour. */
function backoffSeconds(attempts: number): number {
  return Math.min(3600, 30 * 2 ** Math.max(0, attempts - 1));
}

/**
 * Enumeration page for rebuild and reconciliation.
 *
 * A REQUEST, NOT A PROMISE. An owner may cap a page below this, so enumeration
 * ends only on an EMPTY page — never on a short one, which would silently end a
 * rebuild at whatever bound the owner happens to apply.
 */
const ENUMERATION_PAGE = 200;

/* ===========================================================================
 * The shape of an answer
 * ========================================================================= */

export interface SearchTopic {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
}

export type SearchOutcome =
  /** Nothing typed yet. No database was touched and no budget was spent. */
  | { readonly state: 'initial'; readonly form: SearchFormState }
  | {
      readonly state: 'invalid';
      readonly form: SearchFormState;
      readonly issues: readonly SearchIssue[];
    }
  /** The index or an owner could not answer. Never shown as "no results". */
  | { readonly state: 'unavailable'; readonly form: SearchFormState }
  | {
      readonly state: 'results';
      readonly form: SearchFormState;
      readonly topic: SearchTopic | null;
      readonly results: SearchResultPage;
    };

export interface ProcessSummary {
  readonly relayed: number;
  readonly current: number;
  readonly superseded: number;
  readonly retrying: number;
  readonly failed: number;
  readonly lost: number;
}

export interface ReconcileSummary {
  /** Public scopes the index holds nothing for. */
  readonly missing: number;
  /** Public scopes whose indexed stamp no longer matches their owner's. */
  readonly stale: number;
  /** Indexed scopes whose owner no longer publishes them. */
  readonly orphaned: number;
  /** Exhausted scopes put back on the schedule. */
  readonly retried: number;
}

export interface SearchServiceDependencies {
  readonly index: SearchIndexPort;
  /** One owner projection per scope kind, supplied by Layer-4 composition. */
  readonly sources: Readonly<Record<SearchScopeKind, SearchScopeSource>>;
  /** One owner visibility resolver per result kind. */
  readonly targets: Readonly<Record<SearchKind, SearchTargetResolver>>;
  /** Taxonomy's public topic resolution, for the topic filter. */
  readonly resolveTopic: (slug: string, locale: string) => Promise<SearchTopic | null>;
  /**
   * Reports a failure the service handled. Never given query text: the
   * operation name and the error are all an operator needs.
   */
  readonly report: (operation: string, error: unknown) => void;
  readonly clock?: () => number;
}

/* ===========================================================================
 * The service
 * ========================================================================= */

class ProjectionRejected extends Error {}

export function createSearchService(dependencies: SearchServiceDependencies) {
  const { index, sources, targets } = dependencies;
  const clock = dependencies.clock ?? (() => Date.now());

  /**
   * An owner's projection, validated and normalised for the engine.
   *
   * THE OWNER IS TRUSTED FOR MEANING, NOT FOR SHAPE. Its documents are checked
   * against the contract — kinds, bounds, one scope — before anything is
   * written, so a defect in one owner's projection is a recorded
   * `invalid-projection` failure rather than a malformed index.
   */
  function normalise(
    claim: SearchClaim,
    projection: { stamp: string; documents: readonly unknown[] },
  ): { stamp: string; documents: IndexDocument[] } {
    if (
      projection.stamp.length > SEARCH_STAMP_MAX_LENGTH ||
      projection.documents.length > SEARCH_DOCUMENTS_PER_SCOPE
    ) {
      throw new ProjectionRejected('projection bound exceeded');
    }

    const seen = new Set<string>();
    const documents = projection.documents.map((raw) => {
      const parsed = searchDocumentSourceSchema.safeParse(raw);
      if (!parsed.success) throw new ProjectionRejected('document outside the contract');
      const doc = parsed.data;

      // A document belongs to exactly one scope, and a resource that IS a
      // scope (a Topic, a Person, an Article, a Page, a Work) is only ever its
      // own scope's document.
      if (SCOPE_OF_KIND[doc.kind] !== claim.kind) {
        throw new ProjectionRejected('document outside its scope');
      }
      if (doc.kind === claim.kind && doc.resourceId !== claim.id) {
        throw new ProjectionRejected('document names another resource');
      }

      const key = `${doc.kind}\u0000${doc.resourceId}\u0000${doc.textLanguage}`;
      if (seen.has(key)) throw new ProjectionRejected('duplicate document');
      seen.add(key);

      const title = displayTitle(doc.title);
      const summary = displaySummary(doc.summary);
      const matchText = matchingText({ title, summary, body: doc.body });
      const topicIds = [...new Set(doc.topicIds)].sort();
      const textLanguage = doc.textLanguage.toLowerCase();
      const contentLanguage = doc.contentLanguage?.toLowerCase() ?? null;

      const checksum = createHash('sha256')
        .update(
          JSON.stringify([
            doc.kind,
            doc.resourceId,
            textLanguage,
            contentLanguage,
            title,
            summary,
            matchText,
            doc.year,
            topicIds,
          ]),
        )
        .digest('hex');

      return {
        kind: doc.kind,
        resourceId: doc.resourceId,
        textLanguage,
        contentLanguage,
        title,
        summary,
        matchText,
        year: doc.year,
        topicIds,
        checksum,
      };
    });

    return { stamp: projection.stamp, documents };
  }

  async function failClaim(
    claim: SearchClaim,
    category: SearchFailureCategory,
    error: unknown,
  ): Promise<SearchSettlement> {
    dependencies.report(`search.index.${category}`, error);
    return index.fail(claim, {
      category,
      maxAttempts: SEARCH_MAX_ATTEMPTS,
      retryAfterSeconds: backoffSeconds(claim.attempts),
    });
  }

  /**
   * Brings one scope up to date with its owner's CURRENT public state.
   *
   * THREE FAILURE CATEGORIES, and each is recorded against the scope rather
   * than swallowed: the owner could not answer, the owner answered outside the
   * contract, or the answer could not be written. The authoritative record is
   * untouched by any of them — publication already committed, and search is
   * derived work (ARCHITECTURE.md §8.5).
   */
  async function settle(claim: SearchClaim): Promise<SearchSettlement> {
    let projection: { stamp: string; documents: IndexDocument[] } | null;
    try {
      const answer = await sources[claim.kind].project(claim.id);
      projection = answer === null ? null : normalise(claim, answer);
    } catch (error) {
      return failClaim(
        claim,
        error instanceof ProjectionRejected ? 'invalid-projection' : 'source-unavailable',
        error,
      );
    }

    try {
      return await index.apply(
        claim,
        projection === null
          ? { stamp: null, documents: [] }
          : { stamp: projection.stamp, documents: projection.documents },
      );
    } catch (error) {
      return failClaim(claim, 'index-write-failed', error);
    }
  }

  /**
   * One pass over visible page rows: which are STILL public, and where they
   * live NOW.
   *
   * THE STALE-INDEX RULE (ARCHITECTURE.md §8.5): "a stale index may omit
   * something; it may never disclose something". The index's belief that a row
   * is public is never consulted. Each owner is asked once per kind present on
   * the page — never once per row — and a row its owner does not return is
   * withheld, whatever the index still holds for it.
   */
  async function currentTargets(
    rows: readonly { kind: SearchKind; resourceId: string }[],
  ): Promise<ReadonlyMap<SearchKind, ReadonlyMap<string, string>>> {
    const byKind = new Map<SearchKind, string[]>();
    for (const row of rows) {
      const ids = byKind.get(row.kind) ?? [];
      ids.push(row.resourceId);
      byKind.set(row.kind, ids);
    }

    const answers = await Promise.all(
      [...byKind.entries()].map(
        async ([kind, ids]) => [kind, await targets[kind]([...new Set(ids)])] as const,
      ),
    );
    return new Map(answers);
  }

  return {
    /**
     * Runs one public search.
     *
     * NEVER THROWS FOR A VISITOR. Every outcome is a state the page can render
     * honestly: nothing typed, something to correct, a temporary fault, or
     * results. (Too many searches is decided before this runs, at the request
     * boundary — see `SEARCH_RATE_RULE`.) A fault is `unavailable` and is reported —
     * it is never disguised as an empty result, which would tell the visitor
     * something false about the corpus.
     *
     * AN UNDERFILLED PAGE IS HONEST, NOT REFILLED. Rows withheld by the
     * visibility recheck are dropped and the page is shown short; there is no
     * loop reaching for more, because each reach would repeat the full-text
     * query and a stale-heavy index would turn one search into many.
     */
    async search(
      raw: Readonly<Record<string, string | readonly string[] | undefined>>,
      context: { readonly locale: string },
    ): Promise<SearchOutcome> {
      const parsed = parseSearchParams(raw);
      if (parsed.state === 'empty') return { state: 'initial', form: parsed.form };
      if (parsed.state === 'invalid') {
        return { state: 'invalid', form: parsed.form, issues: parsed.issues };
      }

      const { form, search } = parsed;

      try {
        const topic =
          search.topicSlug === null
            ? null
            : await dependencies.resolveTopic(search.topicSlug, context.locale);
        if (search.topicSlug !== null && topic === null) {
          return { state: 'invalid', form, issues: ['topic'] };
        }

        const found = await index.query({
          terms: search.terms,
          kinds: search.kind === null ? null : [search.kind],
          topicId: topic?.id ?? null,
          contentLanguage: search.contentLanguage,
          fromYear: search.fromYear,
          toYear: search.toYear,
          preferredLanguage: context.locale,
          offset: (search.page - 1) * SEARCH_PAGE_SIZE,
          limit: SEARCH_PAGE_SIZE,
        });

        const current = await currentTargets(found.rows);

        const hits: SearchHit[] = found.rows.flatMap((row) => {
          const href = current.get(row.kind)?.get(row.resourceId);
          return href === undefined ? [] : [{ ...row, href }];
        });

        const total = Math.min(found.total, SEARCH_RESULT_CEILING);

        return {
          state: 'results',
          form,
          topic,
          results: {
            hits,
            total,
            capped: found.total >= SEARCH_RESULT_CEILING,
            page: search.page,
            pageCount: Math.max(1, Math.ceil(total / SEARCH_PAGE_SIZE)),
            withheld: found.rows.length - hits.length,
          },
        };
      } catch (error) {
        dependencies.report('search.query', error);
        return { state: 'unavailable', form };
      }
    },

    /**
     * One bounded indexing tick: relay requests, lease due scopes, settle them.
     *
     * BOUNDED BY TIME, not by whether work remains, so a large rebuild is
     * worked through across many ticks rather than by one that never returns.
     * Safe to run concurrently with another tick: every scope is leased.
     */
    async processDue(
      options: { readonly budgetMs?: number } = {},
    ): Promise<ProcessSummary> {
      const budget = Math.max(100, Math.min(60_000, options.budgetMs ?? 5_000));
      const started = clock();
      const summary = {
        relayed: 0,
        current: 0,
        superseded: 0,
        retrying: 0,
        failed: 0,
        lost: 0,
      };

      while (clock() - started < budget) {
        summary.relayed += await index.relay(RELAY_BATCH);

        const claims = await index.claim({
          limit: CLAIM_BATCH,
          leaseSeconds: LEASE_SECONDS,
        });
        if (claims.length === 0) break;

        for (const claim of claims) {
          summary[await settle(claim)] += 1;
        }
      }

      return summary;
    },

    /**
     * Re-projects every scope from its owner's authoritative public inventory.
     *
     * REQUESTS, THEN LETS THE INDEXER WORK. Two enumerations per kind, both
     * paged and both in a stable order: every scope the OWNER publishes (so a
     * missing or empty index is restored), and every scope the INDEX holds (so
     * a document whose owner no longer publishes it is removed). Idempotent —
     * running it twice requests twice and projects the same answer — and safe
     * to interrupt: a rebuild that stops halfway is resumed by running it again.
     *
     * The projection is never read back as a source. It is derived, and a
     * rebuild that consulted it would preserve whatever was wrong with it.
     */
    async rebuild(): Promise<{ readonly requested: number }> {
      let requested = 0;

      for (const kind of SEARCH_SCOPE_KINDS) {
        let after: string | null = null;
        for (;;) {
          const page = await sources[kind].list({ after, limit: ENUMERATION_PAGE });
          if (page.length === 0) break;
          await index.request(page.map((entry) => ({ kind, id: entry.id })));
          requested += page.length;
          after = page[page.length - 1]?.id ?? null;
        }

        let indexedAfter: string | null = null;
        for (;;) {
          const ids = await index.indexedScopes({
            kind,
            after: indexedAfter,
            limit: ENUMERATION_PAGE,
          });
          if (ids.length === 0) break;
          await index.request(ids.map((id) => ({ kind, id })));
          requested += ids.length;
          indexedAfter = ids[ids.length - 1] ?? null;
        }
      }

      return { requested };
    },

    /**
     * Finds and requests only what is WRONG: missing, stale and orphaned
     * scopes, plus exhausted failures. Cheaper than a rebuild and bounded the
     * same way, and it reports what it found so an operator can see whether the
     * index had drifted at all.
     */
    async reconcile(): Promise<ReconcileSummary> {
      let missing = 0;
      let stale = 0;
      let orphaned = 0;

      for (const kind of SEARCH_SCOPE_KINDS) {
        let after: string | null = null;
        for (;;) {
          const page = await sources[kind].list({ after, limit: ENUMERATION_PAGE });
          if (page.length === 0) break;

          const states = await index.scopeStates(
            kind,
            page.map((entry) => entry.id),
          );
          const repair: string[] = [];
          for (const entry of page) {
            const state = states.get(entry.id);
            if (state === undefined || state.documents === 0) {
              missing += 1;
              repair.push(entry.id);
            } else if (state.settled && state.stamp !== entry.stamp) {
              stale += 1;
              repair.push(entry.id);
            }
          }
          await index.request(repair.map((id) => ({ kind, id })));

          after = page[page.length - 1]?.id ?? null;
        }

        // The resolver for a scope's own kind answers "which of these does the
        // owner publish now" — the same question the stale-index rule asks.
        const resolve = targets[kind];
        let indexedAfter: string | null = null;
        for (;;) {
          const ids = await index.indexedScopes({
            kind,
            after: indexedAfter,
            limit: ENUMERATION_PAGE,
          });
          if (ids.length === 0) break;

          const published = await resolve(ids);
          const gone = ids.filter((id) => !published.has(id));
          orphaned += gone.length;
          await index.request(gone.map((id) => ({ kind, id })));

          indexedAfter = ids[ids.length - 1] ?? null;
        }
      }

      const retried = await index.retryFailed();
      return { missing, stale, orphaned, retried };
    },

    retryFailed(): Promise<number> {
      return index.retryFailed();
    },

    status(): Promise<SearchIndexStatus> {
      return index.status({ failureLimit: 20 });
    },
  };
}

export type SearchService = ReturnType<typeof createSearchService>;
