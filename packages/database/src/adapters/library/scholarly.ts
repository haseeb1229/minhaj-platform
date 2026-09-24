import 'server-only';

import { randomUUID } from 'node:crypto';

import type { Prisma } from '@prisma/client';

import type { Locale } from '@minhaj/contracts';
import type { ContributionRole } from '@minhaj/contracts/people';
import {
  readerDocumentSchema,
  SCHOLARLY_LIMITS,
  SCHOLARLY_PAGE,
  type LibraryPersistencePort,
  type LibraryPublicReaderPort,
  type MagazineIssueRecord,
  type MagazineRecord,
  type ResearchRecord,
  type ScholarlyKind,
  type ScholarlyLabel,
  type ScholarlyListing,
  type ScholarlyListingPage,
  type ScholarlyRecord,
  type ScholarlyValue,
} from '@minhaj/contracts/library';

import { auditRow } from '../../audit-row.ts';
import { getDatabaseClient } from '../../client.ts';
import { requestSearchIndexing, requestSearchIndexingMany } from '../../search-intent.ts';

/**
 * The Library's Phase-9 persistence: Research, ResearchPaper, Publication,
 * Magazine, MagazineIssue and Encyclopedia (DOMAIN_MODEL.md §10.2).
 *
 * SIX TABLES, ONE IMPLEMENTATION OF EACH OPERATION. The aggregates are distinct —
 * each has its own table, slug namespace and typed relation sets — but the
 * operations on them are the same operations: save under an expected version,
 * replace the relation sets, reserve the slug, audit, and commit search intent.
 * Writing each of those six times would be six places for "a stale save is a
 * conflict" to stop being true. So each aggregate is described ONCE, by the
 * delegates of its own tables, and every operation below is written once over
 * that description.
 *
 * THE DESCRIPTION IS PRIVATE. Nothing here is exported except the two factories,
 * and each is typed by the Library's own port — so no delegate, no transaction
 * handle and no client leaves this module (ARCHITECTURE.md §4.1, §6.3 rule 13).
 * The delegates are addressed through a deliberately narrow structural shape:
 * the queries are checked against the real schema by the live SQL proofs, which
 * exercise every aggregate through every operation.
 */

type Client = Prisma.TransactionClient;

interface LabelRow {
  readonly locale: string;
  readonly title: string;
  readonly summary: string;
}

/** The widest row any family's reads produce. Each family fills its own fields. */
interface Row {
  readonly id: string;
  readonly slug: string;
  readonly primaryLocale: string;
  readonly state: string;
  readonly version: number;
  readonly updatedAt: Date;
  readonly languageCode?: string;
  readonly publicationYear?: number | null;
  readonly publishedOn?: Date | null;
  readonly institutionalContext?: string | null;
  readonly abstract?: string | null;
  readonly venue?: string | null;
  readonly doi?: string | null;
  readonly publisher?: string | null;
  readonly document?: string | null;
  readonly magazineId?: string;
  readonly volume?: number | null;
  readonly issueNumber?: number | null;
  readonly magazine?: {
    readonly slug: string;
    readonly primaryLocale?: string;
    readonly version?: number;
    readonly updatedAt?: Date;
    readonly labels?: readonly LabelRow[];
  };
  readonly labels?: readonly LabelRow[];
  readonly contributors?: readonly { readonly personId: string; readonly role: string }[];
  readonly topics?: readonly { readonly topicId: string }[];
  readonly citations?: readonly {
    readonly text: string;
    readonly url: string | null;
    readonly doi: string | null;
  }[];
}

interface RecordDelegate {
  findMany(args: object): Promise<Row[]>;
  findFirst(args: object): Promise<Row | null>;
  create(args: object): Promise<unknown>;
  updateMany(args: object): Promise<{ count: number }>;
}

interface SetDelegate {
  deleteMany(args: object): Promise<unknown>;
  createMany(args: object): Promise<unknown>;
}

interface SlugDelegate {
  findFirst(args: object): Promise<Record<string, { readonly slug: string }> | null>;
}

interface Delegates {
  readonly record: RecordDelegate;
  readonly label: SetDelegate;
  readonly contributor: SetDelegate;
  readonly topic: SetDelegate;
  readonly citation: SetDelegate | null;
  readonly slug: SlugDelegate;
}

interface Family {
  readonly kind: ScholarlyKind;
  /** The foreign-key column every relation set of this aggregate carries. */
  readonly fk: string;
  /** The relation from a slug-history row back to its record. */
  readonly owner: string;
  /** Has a content language, date facts and a readable document. */
  readonly dated: boolean;
  /** Has ordered citations, an abstract and an institutional context. */
  readonly cited: boolean;
  readonly delegates: (client: Client) => Delegates;
}

/** The narrow view of a generated delegate. See the module comment. */
const narrow = <T>(delegate: unknown): T => delegate as T;

const FAMILIES: Readonly<Record<ScholarlyKind, Family>> = {
  research: {
    kind: 'research',
    fk: 'researchId',
    owner: 'research',
    dated: true,
    cited: true,
    delegates: (c) => ({
      record: narrow(c.research),
      label: narrow(c.researchLabel),
      contributor: narrow(c.researchContributor),
      topic: narrow(c.researchTopic),
      citation: narrow(c.researchCitation),
      slug: narrow(c.researchSlugHistory),
    }),
  },
  'research-paper': {
    kind: 'research-paper',
    fk: 'researchPaperId',
    owner: 'researchPaper',
    dated: true,
    cited: true,
    delegates: (c) => ({
      record: narrow(c.researchPaper),
      label: narrow(c.researchPaperLabel),
      contributor: narrow(c.researchPaperContributor),
      topic: narrow(c.researchPaperTopic),
      citation: narrow(c.researchPaperCitation),
      slug: narrow(c.researchPaperSlugHistory),
    }),
  },
  publication: {
    kind: 'publication',
    fk: 'publicationId',
    owner: 'publication',
    dated: true,
    cited: false,
    delegates: (c) => ({
      record: narrow(c.publication),
      label: narrow(c.publicationLabel),
      contributor: narrow(c.publicationContributor),
      topic: narrow(c.publicationTopic),
      citation: null,
      slug: narrow(c.publicationSlugHistory),
    }),
  },
  magazine: {
    kind: 'magazine',
    fk: 'magazineId',
    owner: 'magazine',
    dated: false,
    cited: false,
    delegates: (c) => ({
      record: narrow(c.magazine),
      label: narrow(c.magazineLabel),
      contributor: narrow(c.magazineContributor),
      topic: narrow(c.magazineTopic),
      citation: null,
      slug: narrow(c.magazineSlugHistory),
    }),
  },
  'magazine-issue': {
    kind: 'magazine-issue',
    fk: 'magazineIssueId',
    owner: 'magazineIssue',
    dated: true,
    cited: false,
    delegates: (c) => ({
      record: narrow(c.magazineIssue),
      label: narrow(c.magazineIssueLabel),
      contributor: narrow(c.magazineIssueContributor),
      topic: narrow(c.magazineIssueTopic),
      citation: null,
      slug: narrow(c.magazineIssueSlugHistory),
    }),
  },
  encyclopedia: {
    kind: 'encyclopedia',
    fk: 'encyclopediaId',
    owner: 'encyclopedia',
    dated: true,
    cited: false,
    delegates: (c) => ({
      record: narrow(c.encyclopedia),
      label: narrow(c.encyclopediaLabel),
      contributor: narrow(c.encyclopediaContributor),
      topic: narrow(c.encyclopediaTopic),
      citation: null,
      slug: narrow(c.encyclopediaSlugHistory),
    }),
  },
};

/* ===========================================================================
 * Refusals
 * ========================================================================= */

class ScholarlyDataError extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

/** The one unique index whose violation is not about a slug. */
const ISSUE_NUMBER_KEY = 'MagazineIssue_magazineId_volume_issueNumber_key';

/**
 * Structured database refusals, and ONLY those, become domain answers.
 *
 * A duplicate (volume, number) within a Magazine is its own answer: telling an
 * operator their SLUG is taken when it is the issue number that collides would
 * send them to fix the wrong field. Everything unrecognised — a serialisation
 * failure, a lost connection — is rethrown and reported as unavailable, never as
 * a rule that was not evaluated (DOMAIN_MODEL.md §19.8).
 */
function refuse(error: unknown): never {
  if (error instanceof ScholarlyDataError) throw error;
  const known = error as { code?: string; meta?: unknown; message?: string } | null;
  const code = known?.code;
  if (code === 'P2002') {
    const detail = `${JSON.stringify(known?.meta ?? {})} ${known?.message ?? ''}`;
    throw new ScholarlyDataError(
      detail.includes(ISSUE_NUMBER_KEY) ? 'duplicate-number' : 'duplicate-slug',
    );
  }
  if (code === 'P2025') throw new ScholarlyDataError('conflict');
  if (code === 'P2003' || code === 'P2004') throw new ScholarlyDataError('invalid');
  throw error;
}

/* ===========================================================================
 * Query fragments
 * ========================================================================= */

const LABELS = { orderBy: { locale: 'asc' } } as const;

function detailInclude(family: Family): object {
  return {
    labels: LABELS,
    contributors: {
      orderBy: [{ position: 'asc' }, { personId: 'asc' }, { role: 'asc' }],
    },
    topics: { orderBy: { topicId: 'asc' } },
    ...(family.cited ? { citations: { orderBy: { position: 'asc' } } } : {}),
    ...(family.kind === 'magazine-issue'
      ? {
          magazine: {
            select: { slug: true, primaryLocale: true, version: true, labels: LABELS },
          },
        }
      : {}),
  };
}

/** What a listing row needs: never the document, the abstract or the citations. */
function listingSelect(family: Family): object {
  return {
    id: true,
    slug: true,
    primaryLocale: true,
    state: true,
    version: true,
    updatedAt: true,
    labels: LABELS,
    ...(family.dated
      ? { languageCode: true, publicationYear: true, publishedOn: true }
      : {}),
    ...(family.kind === 'magazine-issue'
      ? { volume: true, issueNumber: true, magazine: { select: { slug: true } } }
      : {}),
  };
}

/**
 * THE PUBLIC PREDICATE, in one place per aggregate. Published — and for an
 * issue, published within a published Magazine. Every public read composes it.
 */
function publicWhere(family: Family): object {
  return family.kind === 'magazine-issue'
    ? { state: 'published', magazine: { state: 'published' } }
    : { state: 'published' };
}

/**
 * A periodical's own order: newest first by year, date, volume and number, with
 * the slug — unique within the Magazine — as the total tie-breaker. SQL Server
 * sorts NULL lowest, so a descending order puts an undated issue last.
 */
const ISSUE_ORDER = [
  { publicationYear: 'desc' },
  { publishedOn: 'desc' },
  { volume: 'desc' },
  { issueNumber: 'desc' },
  { slug: 'asc' },
  { id: 'asc' },
] as const;

function publicOrder(family: Family): readonly object[] {
  return family.dated
    ? [{ publicationYear: 'desc' }, { slug: 'asc' }, { id: 'asc' }]
    : [{ slug: 'asc' }, { id: 'asc' }];
}

const boundedOffset = (value: number) =>
  Math.max(0, Math.min(10_000_000, Math.trunc(value) || 0));

const bounded = (value: number, max: number) =>
  Math.min(max, Math.max(1, Math.trunc(value) || 1));

/** A batch of identifiers a caller may ask about at once. */
const TARGET_BATCH = 500;

/**
 * A version no row can hold (`CHECK ([version] > 0)`). An edit that somehow
 * arrived without an expected version conflicts rather than overwriting.
 */
const UNMATCHABLE_VERSION = 0;

/* ===========================================================================
 * Mapping
 * ========================================================================= */

/** A SQL `date` read back as the `YYYY-MM-DD` it is — never shifted by a zone. */
function isoDate(value: Date | null | undefined): string | null {
  return value === null || value === undefined ? null : value.toISOString().slice(0, 10);
}

function utcDate(value: string | null): Date | null {
  return value === null ? null : new Date(`${value}T00:00:00.000Z`);
}

function labelsOf(rows: readonly LabelRow[] | undefined): ScholarlyLabel[] {
  return (rows ?? []).map((label) => ({
    locale: label.locale as Locale,
    title: label.title,
    summary: label.summary,
  }));
}

/**
 * The mappers below are what the factories RETURN, so each states its contract
 * explicitly and takes only structural inputs — a kind and a `Row` — never the
 * private delegate description (ARCHITECTURE.md §4.1, §6.3 rule 13).
 */
function common(row: Row): Omit<MagazineRecord, 'kind'> {
  return {
    id: row.id,
    slug: row.slug,
    primaryLocale: row.primaryLocale as Locale,
    state: row.state as ScholarlyRecord['state'],
    labels: labelsOf(row.labels),
    contributors: (row.contributors ?? []).map((entry) => ({
      personId: entry.personId,
      role: entry.role as ContributionRole,
    })),
    topicIds: (row.topics ?? []).map((entry) => entry.topicId),
    version: row.version,
    updatedAt: row.updatedAt,
  };
}

function dated(
  row: Row,
): Pick<ResearchRecord, 'languageCode' | 'publicationYear' | 'publishedOn' | 'document'> {
  if (row.languageCode === undefined) {
    throw new Error('A dated Library record was read without its content language.');
  }
  return {
    languageCode: row.languageCode,
    publicationYear: row.publicationYear ?? null,
    publishedOn: isoDate(row.publishedOn),
    document:
      row.document === null || row.document === undefined
        ? null
        : readerDocumentSchema.parse(JSON.parse(row.document)),
  };
}

function cited(
  row: Row,
): Pick<ResearchRecord, 'institutionalContext' | 'abstract' | 'citations'> {
  return {
    institutionalContext: row.institutionalContext ?? null,
    abstract: row.abstract ?? null,
    citations: (row.citations ?? []).map((entry) => ({
      text: entry.text,
      url: entry.url,
      doi: entry.doi,
    })),
  };
}

function toRecord(kind: ScholarlyKind, row: Row): ScholarlyRecord {
  switch (kind) {
    case 'research':
      return { kind: 'research', ...common(row), ...dated(row), ...cited(row) };
    case 'research-paper':
      return {
        kind: 'research-paper',
        ...common(row),
        ...dated(row),
        ...cited(row),
        venue: row.venue ?? null,
        doi: row.doi ?? null,
      };
    case 'publication':
      return {
        kind: 'publication',
        ...common(row),
        ...dated(row),
        publisher: row.publisher ?? null,
      };
    case 'encyclopedia':
      return {
        kind: 'encyclopedia',
        ...common(row),
        ...dated(row),
        publisher: row.publisher ?? null,
      };
    case 'magazine':
      return { kind: 'magazine', ...common(row) };
    case 'magazine-issue':
      return toIssue(row);
  }
}

function toIssue(row: Row): MagazineIssueRecord {
  if (row.magazineId === undefined || row.magazine === undefined) {
    throw new Error('An issue was read without its Magazine.');
  }
  return {
    kind: 'magazine-issue',
    ...common(row),
    ...dated(row),
    magazineId: row.magazineId,
    magazine: {
      slug: row.magazine.slug,
      primaryLocale: (row.magazine.primaryLocale ?? 'en') as Locale,
      labels: labelsOf(row.magazine.labels),
    },
    volume: row.volume ?? null,
    issueNumber: row.issueNumber ?? null,
  };
}

function toListing(kind: ScholarlyKind, row: Row): ScholarlyListing {
  return {
    kind,
    id: row.id,
    slug: row.slug,
    primaryLocale: row.primaryLocale as Locale,
    state: row.state as ScholarlyListing['state'],
    labels: labelsOf(row.labels),
    languageCode: row.languageCode ?? null,
    publicationYear: row.publicationYear ?? null,
    publishedOn: isoDate(row.publishedOn),
    issue:
      kind === 'magazine-issue' && row.magazine !== undefined
        ? {
            magazineSlug: row.magazine.slug,
            volume: row.volume ?? null,
            issueNumber: row.issueNumber ?? null,
          }
        : null,
    version: row.version,
    updatedAt: row.updatedAt,
  };
}

function pageOf(kind: ScholarlyKind, rows: readonly Row[]): ScholarlyListingPage {
  return {
    items: rows.slice(0, SCHOLARLY_PAGE).map((row) => toListing(kind, row)),
    hasMore: rows.length > SCHOLARLY_PAGE,
  };
}

/**
 * The search stamp. An issue's projection reads its Magazine's labels and
 * visibility, so a Magazine's version is part of every issue's stamp — a
 * Magazine change is then never mistaken for "nothing changed" by
 * reconciliation.
 */
function stampOf(kind: ScholarlyKind, row: Row): string {
  return kind === 'magazine-issue'
    ? `${String(row.version)}.${String(row.magazine?.version ?? 0)}`
    : String(row.version);
}

/**
 * The record's own words, for matching. PLAIN TEXT: the abstract, the
 * institutional context, where it appeared, who published it, and the readable
 * document's headings and paragraphs. Citations are deliberately NOT here — a
 * paper that cites a work is not about it.
 */
function searchText(row: Row): string[] {
  const document =
    row.document === null || row.document === undefined
      ? []
      : readerDocumentSchema
          .parse(JSON.parse(row.document))
          .sections.flatMap((section) => [section.title, ...section.paragraphs]);
  return [
    row.abstract,
    row.institutionalContext,
    row.venue,
    row.publisher,
    ...document,
  ].filter((part): part is string => typeof part === 'string' && part !== '');
}

/* ===========================================================================
 * Writing
 * ========================================================================= */

/** The aggregate's own columns for one validated input. */
function columns(save: ScholarlyValue): Record<string, unknown> {
  const base = {
    slug: save.value.slug,
    primaryLocale: save.value.primaryLocale,
    state: save.value.state,
    updatedAt: new Date(),
  };
  if (save.kind === 'magazine') return base;

  const value = save.value;
  const facts = {
    ...base,
    languageCode: value.languageCode,
    publicationYear: value.publicationYear,
    publishedOn: utcDate(value.publishedOn),
    document: value.document === null ? null : JSON.stringify(value.document),
  };

  switch (save.kind) {
    case 'research':
      return {
        ...facts,
        institutionalContext: save.value.institutionalContext,
        abstract: save.value.abstract,
      };
    case 'research-paper':
      return {
        ...facts,
        institutionalContext: save.value.institutionalContext,
        abstract: save.value.abstract,
        venue: save.value.venue,
        doi: save.value.doi,
      };
    case 'publication':
    case 'encyclopedia':
      return { ...facts, publisher: save.value.publisher };
    case 'magazine-issue':
      return {
        ...facts,
        magazineId: save.value.magazineId,
        volume: save.value.volume,
        issueNumber: save.value.issueNumber,
      };
  }
}

/** Replaces every relation set wholesale, in the caller's transaction. */
async function replaceSets(
  family: Family,
  delegates: Delegates,
  id: string,
  save: ScholarlyValue,
): Promise<void> {
  const owner = { [family.fk]: id };
  const { labels, contributors, topicIds } = save.value;

  await delegates.label.deleteMany({ where: owner });
  await delegates.label.createMany({
    data: labels.map((label) => ({ ...owner, ...label })),
  });

  await delegates.contributor.deleteMany({ where: owner });
  if (contributors.length > 0)
    await delegates.contributor.createMany({
      data: contributors.map((entry, position) => ({ ...owner, ...entry, position })),
    });

  await delegates.topic.deleteMany({ where: owner });
  if (topicIds.length > 0)
    await delegates.topic.createMany({
      data: topicIds.map((topicId) => ({ ...owner, topicId })),
    });

  if (
    delegates.citation !== null &&
    (save.kind === 'research' || save.kind === 'research-paper')
  ) {
    await delegates.citation.deleteMany({ where: owner });
    if (save.value.citations.length > 0)
      await delegates.citation.createMany({
        data: save.value.citations.map((entry, position) => ({
          ...owner,
          position,
          ...entry,
        })),
      });
  }
}

/**
 * An issue's writes serialise at its Magazine BEFORE they write anything
 * (DOMAIN_MODEL.md §19.8): the per-Magazine issue bound is a cross-record
 * invariant, and a Magazine's own save must see every issue it has to re-index.
 */
async function claimMagazine(tx: Client, magazineId: string, creating: boolean) {
  const held = await tx.$queryRaw<{ id: string }[]>`
    SELECT [id] FROM [dbo].[Magazine] WITH (UPDLOCK, HOLDLOCK) WHERE [id] = ${magazineId};`;
  if (held.length !== 1) throw new ScholarlyDataError('invalid');
  if (
    creating &&
    (await tx.magazineIssue.count({ where: { magazineId } })) >=
      SCHOLARLY_LIMITS.issuesPerMagazine
  )
    throw new ScholarlyDataError('limit');
}

/* ===========================================================================
 * The factories
 * ========================================================================= */

export type ScholarlyPersistence = Pick<
  LibraryPersistencePort,
  'scholarlyRecords' | 'scholarlyRecordById' | 'saveScholarly'
>;

export type ScholarlyPublicReader = Pick<
  LibraryPublicReaderPort,
  | 'scholarlyList'
  | 'scholarlyRecord'
  | 'scholarlyCanonicalSlug'
  | 'magazineIssues'
  | 'magazineIssue'
  | 'magazineIssueCanonical'
  | 'magazineIssueNeighbours'
  | 'scholarlySitemap'
  | 'scholarlySearchRecord'
  | 'scholarlySearchList'
  | 'scholarlyTargets'
>;

export function createScholarlyPersistence(): ScholarlyPersistence {
  const db = getDatabaseClient();

  return {
    async scholarlyRecords(kind, query) {
      const family = FAMILIES[kind];
      const byMagazine = kind === 'magazine-issue' && query.magazineId !== null;
      const rows = await family.delegates(db).record.findMany({
        where: {
          ...(query.state === null ? {} : { state: query.state }),
          ...(byMagazine ? { magazineId: query.magazineId } : {}),
        },
        select: listingSelect(family),
        // An operator's directory is most useful most-recently-changed first;
        // a Magazine's issues are listed in the periodical's own order.
        orderBy: byMagazine ? ISSUE_ORDER : [{ updatedAt: 'desc' }, { id: 'asc' }],
        skip: boundedOffset(query.offset),
        take: SCHOLARLY_PAGE + 1,
      });
      return pageOf(kind, rows);
    },

    async scholarlyRecordById(kind, id) {
      const family = FAMILIES[kind];
      const row = await family.delegates(db).record.findFirst({
        where: { id },
        include: detailInclude(family),
      });
      return row === null ? null : toRecord(kind, row);
    },

    async saveScholarly({ actorId, id, expectedVersion, save }) {
      const { kind, value } = save;
      const family = FAMILIES[kind];

      try {
        return await db.$transaction(async (tx) => {
          const delegates = family.delegates(tx);
          const recordId = id ?? randomUUID();

          if (save.kind === 'magazine-issue')
            await claimMagazine(tx, save.value.magazineId, id === null);

          const previous =
            id === null
              ? null
              : await delegates.record.findFirst({
                  where: { id },
                  select: {
                    id: true,
                    slug: true,
                    state: true,
                    version: true,
                    ...(save.kind === 'magazine-issue' ? { magazineId: true } : {}),
                  },
                });
          if (id !== null && (previous === null || previous.version !== expectedVersion))
            throw new ScholarlyDataError('conflict');
          // An issue belongs to exactly one Magazine. The database refuses a move
          // too (its slug reservations' composite foreign key); refusing it here
          // first gives the operator the right answer.
          if (
            save.kind === 'magazine-issue' &&
            previous !== null &&
            previous.magazineId !== save.value.magazineId
          )
            throw new ScholarlyDataError('invalid');

          const data = columns(save);
          if (id !== null) {
            const changed = await delegates.record.updateMany({
              where: { id, version: expectedVersion ?? UNMATCHABLE_VERSION },
              data: { ...data, version: { increment: 1 } },
            });
            if (changed.count !== 1) throw new ScholarlyDataError('conflict');
          } else {
            // The slug trigger reserves the new slug in this same transaction.
            await delegates.record.create({ data: { ...data, id: recordId } });
          }

          await replaceSets(family, delegates, recordId, save);

          const row = await delegates.record.findFirst({
            where: { id: recordId },
            include: detailInclude(family),
          });
          if (row === null) throw new ScholarlyDataError('conflict');

          // DURABLE SEARCH INTENT, committed with the change (ARCHITECTURE.md
          // §8.5). A Magazine's change reaches every issue's title, address and
          // visibility, so each issue is owed a re-projection too.
          await requestSearchIndexing(tx, kind, recordId);
          if (save.kind === 'magazine') {
            const issues = await tx.magazineIssue.findMany({
              where: { magazineId: recordId },
              select: { id: true },
              orderBy: { id: 'asc' },
            });
            await requestSearchIndexingMany(
              tx,
              'magazine-issue',
              issues.map((issue) => issue.id),
            );
          }

          // Identifiers, states and counts — never a title, an abstract, a
          // citation or a document (SECURITY_BASELINE.md §13.4).
          await tx.auditLog.create({
            data: auditRow({
              actorType: 'user',
              actorId,
              action: `library.${kind}.${previous === null ? 'created' : 'updated'}`,
              targetType: kind,
              targetId: recordId,
              ...(previous === null
                ? {}
                : {
                    before: { version: String(previous.version), state: previous.state },
                  }),
              after: {
                version: String(row.version),
                state: row.state,
                slugChanged: String(previous !== null && previous.slug !== value.slug),
                contributors: String(value.contributors.length),
                topics: String(value.topicIds.length),
                ...(save.kind === 'research' || save.kind === 'research-paper'
                  ? { citations: String(save.value.citations.length) }
                  : {}),
                ...(save.kind === 'magazine-issue'
                  ? { magazineId: save.value.magazineId }
                  : {}),
              },
              authorisingSource: 'library.administer',
            }),
          });

          return toRecord(kind, row);
        });
      } catch (error) {
        refuse(error);
      }
    },
  };
}

export function createScholarlyPublicReader(): ScholarlyPublicReader {
  const db = getDatabaseClient();
  const issues = FAMILIES['magazine-issue'];

  return {
    async scholarlyList(kind, query) {
      const family = FAMILIES[kind];
      const years =
        query.from === null && query.to === null
          ? {}
          : {
              publicationYear: {
                ...(query.from === null ? {} : { gte: query.from }),
                ...(query.to === null ? {} : { lte: query.to }),
              },
            };
      const rows = await family.delegates(db).record.findMany({
        where: {
          // The filters NARROW the public predicate; none of them can widen it.
          ...publicWhere(family),
          ...(family.dated && query.language !== null
            ? { languageCode: query.language }
            : {}),
          ...(family.dated ? years : {}),
          ...(query.topic === null ? {} : { topics: { some: { topicId: query.topic } } }),
        },
        select: listingSelect(family),
        orderBy: publicOrder(family),
        skip: boundedOffset(query.offset),
        take: SCHOLARLY_PAGE + 1,
      });
      return pageOf(kind, rows);
    },

    async scholarlyRecord(kind, slug) {
      const family = FAMILIES[kind];
      const row = await family.delegates(db).record.findFirst({
        where: { slug, ...publicWhere(family) },
        include: detailInclude(family),
      });
      return row === null ? null : toRecord(kind, row);
    },

    async scholarlyCanonicalSlug(kind, slug) {
      const family = FAMILIES[kind];
      const row = await family.delegates(db).slug.findFirst({
        where: { slug, [family.owner]: publicWhere(family) },
        select: { [family.owner]: { select: { slug: true } } },
      });
      return row?.[family.owner]?.slug ?? null;
    },

    async magazineIssues(magazineId, offset) {
      const rows = await issues.delegates(db).record.findMany({
        where: { magazineId, ...publicWhere(issues) },
        select: listingSelect(issues),
        orderBy: ISSUE_ORDER,
        skip: boundedOffset(offset),
        take: SCHOLARLY_PAGE + 1,
      });
      return pageOf('magazine-issue', rows);
    },

    async magazineIssue(magazineSlug, issueSlug) {
      const row = await issues.delegates(db).record.findFirst({
        where: {
          slug: issueSlug,
          state: 'published',
          magazine: { slug: magazineSlug, state: 'published' },
        },
        include: detailInclude(issues),
      });
      return row === null ? null : toIssue(row);
    },

    /**
     * BOTH HALVES RESOLVED TO THEIR CURRENT VALUES before anything redirects, so a
     * former Magazine slug with a former issue slug is ONE hop to the current
     * address — never Magazine first and issue second (ROUTE_MAP.md §9.7).
     */
    async magazineIssueCanonical(magazineSlug, issueSlug) {
      const magazine = await db.magazineSlugHistory.findFirst({
        where: { slug: magazineSlug, magazine: { state: 'published' } },
        select: { magazine: { select: { id: true, slug: true } } },
      });
      if (magazine === null) return null;
      const issue = await db.magazineIssueSlugHistory.findFirst({
        where: {
          magazineId: magazine.magazine.id,
          slug: issueSlug,
          magazineIssue: { state: 'published' },
        },
        select: { magazineIssue: { select: { slug: true } } },
      });
      return issue === null
        ? null
        : { magazineSlug: magazine.magazine.slug, issueSlug: issue.magazineIssue.slug };
    },

    /**
     * UNAMBIGUOUS ONLY. Adjacency is by (volume, number), which the filtered unique
     * index makes a total order among the issues that have both — so an issue
     * without a printed number has no neighbours rather than guessed ones.
     */
    async magazineIssueNeighbours(issueId) {
      const current = await db.magazineIssue.findFirst({
        where: { id: issueId, state: 'published', magazine: { state: 'published' } },
        select: { magazineId: true, volume: true, issueNumber: true },
      });
      if (current === null || current.volume === null || current.issueNumber === null)
        return { previous: null, next: null };

      const { magazineId, volume, issueNumber } = current;
      const around = async (direction: 'previous' | 'next') => {
        const before = direction === 'previous';
        const row = await issues.delegates(db).record.findFirst({
          where: {
            magazineId,
            ...publicWhere(issues),
            volume: { not: null },
            issueNumber: { not: null },
            OR: before
              ? [{ volume: { lt: volume } }, { volume, issueNumber: { lt: issueNumber } }]
              : [
                  { volume: { gt: volume } },
                  { volume, issueNumber: { gt: issueNumber } },
                ],
          },
          orderBy: before
            ? [{ volume: 'desc' }, { issueNumber: 'desc' }]
            : [{ volume: 'asc' }, { issueNumber: 'asc' }],
          select: listingSelect(issues),
        });
        return row === null ? null : toListing('magazine-issue', row);
      };

      const [previous, next] = await Promise.all([around('previous'), around('next')]);
      return { previous, next };
    },

    async scholarlySitemap(kind, offset, limit) {
      const family = FAMILIES[kind];
      const rows = await family.delegates(db).record.findMany({
        where: publicWhere(family),
        orderBy: [{ slug: 'asc' }, { id: 'asc' }],
        skip: boundedOffset(offset),
        take: bounded(limit, 5000),
        select: {
          id: true,
          slug: true,
          updatedAt: true,
          labels: { select: { locale: true }, orderBy: { locale: 'asc' } },
          ...(kind === 'magazine-issue'
            ? { magazine: { select: { slug: true, updatedAt: true } } }
            : {}),
        },
      });
      return rows.map((row) => ({
        slug: row.slug,
        magazineSlug: row.magazine?.slug ?? null,
        locales: (row.labels ?? []).map((label) => label.locale),
        // An issue page renders its Magazine's title, so either changing is a
        // genuine modification of the issue page.
        updatedAt:
          row.magazine?.updatedAt !== undefined && row.magazine.updatedAt > row.updatedAt
            ? row.magazine.updatedAt
            : row.updatedAt,
      }));
    },

    async scholarlySearchRecord(kind, id) {
      const family = FAMILIES[kind];
      const row = await family.delegates(db).record.findFirst({
        where: { id, ...publicWhere(family) },
        include: detailInclude(family),
      });
      if (row === null) return null;
      return {
        kind,
        id: row.id,
        stamp: stampOf(kind, row),
        primaryLocale: row.primaryLocale as Locale,
        labels: labelsOf(row.labels),
        languageCode: row.languageCode ?? null,
        publicationYear: row.publicationYear ?? null,
        topicIds: (row.topics ?? []).map((entry) => entry.topicId),
        text: searchText(row),
        parentLabels: labelsOf(row.magazine?.labels),
      };
    },

    async scholarlySearchList(kind, { after, limit }) {
      const family = FAMILIES[kind];
      const rows = await family.delegates(db).record.findMany({
        where: {
          ...publicWhere(family),
          ...(after === null ? {} : { id: { gt: after } }),
        },
        select: {
          id: true,
          version: true,
          ...(kind === 'magazine-issue'
            ? { magazine: { select: { version: true } } }
            : {}),
        },
        orderBy: { id: 'asc' },
        take: bounded(limit, 500),
      });
      return rows.map((row) => ({ id: row.id, stamp: stampOf(kind, row) }));
    },

    async scholarlyTargets(kind, ids) {
      if (ids.length === 0) return [];
      if (ids.length > TARGET_BATCH)
        throw new Error('Library search batch exceeds its bound.');
      const family = FAMILIES[kind];
      const rows = await family.delegates(db).record.findMany({
        where: { id: { in: [...ids] }, ...publicWhere(family) },
        select: {
          id: true,
          slug: true,
          ...(kind === 'magazine-issue' ? { magazine: { select: { slug: true } } } : {}),
        },
        orderBy: { id: 'asc' },
      });
      return rows.map((row) => ({
        id: row.id,
        slug: row.slug,
        magazineSlug: row.magazine?.slug ?? null,
      }));
    },
  };
}
