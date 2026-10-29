import 'server-only';

import {
  SCHOLARLY_LIMITS,
  SCHOLARLY_PAGE,
  editionInputSchema,
  readerDocumentSchema,
  uniqueSectionKey,
  type EditionRecord,
  type LibraryActor,
  type LibraryState,
  type MagazineIssueRecord,
  type MagazineRecord,
  type ReaderDocument,
  type WorkRecord,
} from '@minhaj/contracts/library';
import type {
  MigrationActor,
  MigrationContentKind,
  MigrationPublicationTargetPort,
  PublishableAsset,
  StagedBlock,
  StagedInline,
  StagedMagazineIssuePayload,
  StagedMagazinePayload,
  StagedWorkPayload,
  TargetPublication,
} from '@minhaj/contracts/migration';

import { libraryFailure, type createLibraryService } from '../contexts/library/index.ts';
import {
  ADOPTION_PAGES,
  askerOf,
  clearedImage,
  publishing,
  refusal,
  sameLabels,
  withdrawalRefusal,
  withdrawing,
} from './migration-target-support.ts';

/**
 * The Library publication targets — `library.work`, `library.magazine` and
 * `library.magazine-issue` — Layer 4 (Phase 30; MIGRATION_STRATEGY.md §4.12,
 * §7).
 *
 * THROUGH LIBRARY'S PUBLIC SERVICE, NEVER ITS TABLES. Every record is saved by
 * `createLibraryService(...)` exactly as an operator's is: Library's strict
 * schemas parse it, Library asks People and Taxonomy about its references,
 * Library's authority (`library.administer`, read live) decides, and Library
 * writes its own audit rows, slug history and search intents. A refusal from
 * Library is final; only a thrown outage is `unavailable`. No contributor is
 * ever named (People are not migrated in Stage 1A) and nothing is featured.
 *
 * A WORK IS NEVER HALF-MADE IN PUBLIC. A Work and its one Edition are two
 * saves, so the Work is created as a DRAFT, its Edition is created published,
 * and only then is the Work published at its current version (the Edition's
 * save moves the Work's version). The Edition input is first checked against
 * Library's own schema, so a value Library would refuse — an ISBN whose check
 * digit fails, say — is refused before anything is created.
 *
 * ASSETS: an Edition reads or downloads a file only when the payload names it
 * AND a person cleared that exact acquisition as a PDF (`PublishableAsset`, by
 * canonical source URL). Otherwise reading is `unavailable` and download
 * `denied` — never a file guessed at.
 *
 * ADOPTION ONLY ON RESUME, ONLY FOR AN EXACT MATCH. A resumed entry meeting a
 * taken slug finds the record through Library's own administrative read and
 * adopts — and finishes — it only when it carries exactly this payload's
 * address and words (and, for a Work, at most the one Edition of this
 * payload's label and language). A fresh entry meeting an existing record is
 * refused `target-exists` for a person; nothing is overwritten.
 *
 * WITHDRAWAL IS AN ARCHIVE AT THE RECORDED VERSION with every other value as
 * Library holds it; a record edited since is refused `conflict`. A Work held by
 * a person (Personalisation's `workHeld`) is reported held; nothing personal
 * can name a Magazine or a MagazineIssue, so neither is ever held.
 *
 * NODE-RUNNABLE: packages and explicit `.ts` paths only — never the `@/` alias.
 */

type LibraryService = ReturnType<typeof createLibraryService>;

/** The Library operations the Work target uses, and nothing else of Library. */
export type LibraryWorkOperations = Pick<
  LibraryService,
  'saveWork' | 'saveEdition' | 'work' | 'workBySlug'
>;

/** The Library operations the Magazine and issue targets use. */
export type LibraryScholarlyOperations = Pick<
  LibraryService,
  'saveScholarly' | 'scholarlyRecord' | 'scholarlyRecords'
>;

/** Personalisation's one-bit answer about a Work. */
export interface WorkHoldings {
  workHeld(workId: string): Promise<boolean>;
}

const ask = askerOf(libraryFailure);
const asLibrary = (actor: MigrationActor): LibraryActor => ({
  accountId: actor.accountId,
});
const NOT_HELD = false;

/** Locale-free canonical paths; routing adds the locale prefix. */
const workPath = (slug: string) => `/library/books/${slug}`;
const magazinePath = (slug: string) => `/library/magazines/${slug}`;
const issuePath = (magazineSlug: string, slug: string) =>
  `/library/magazines/${magazineSlug}/issues/${slug}`;

/** Staged labels in the shape `sameLabels` compares. */
const stagedLabels = (labels: StagedWorkPayload['labels']) =>
  labels.map((label) => ({
    locale: label.locale,
    title: label.title,
    text: label.description,
  }));

/* ===========================================================================
 * library.work
 * ========================================================================= */

/** A syntactically valid Work id, used only to check an Edition before its Work exists. */
const PROBE_WORK_ID = '00000000-0000-4000-8000-000000000000';

/** The cleared PDF acquisition of exactly this source URL, if any. */
function clearedPdf(
  assets: readonly PublishableAsset[],
  url: string | null,
): PublishableAsset | null {
  if (url === null) return null;
  return (
    assets.find(
      (asset) => asset.originalUrl === url && asset.mediaType === 'application/pdf',
    ) ?? null
  );
}

/** The staged Work as Library's own `workInputSchema` input, as a draft. */
function workInput(payload: StagedWorkPayload, topicIds: readonly string[]) {
  return {
    slug: payload.slug,
    primaryLocale: payload.primaryLocale,
    state: 'draft',
    isFeatured: false,
    labels: payload.labels.map((label) => ({
      locale: label.locale,
      title: label.title,
      description: label.description,
    })),
    contributors: [],
    topicIds: [...topicIds],
    salePointIds: [],
  };
}

/** A Work exactly as Library holds it, as input, in the lifecycle state given. */
function heldWorkInput(work: WorkRecord, state: LibraryState) {
  return {
    slug: work.slug,
    primaryLocale: work.primaryLocale,
    state,
    isFeatured: work.isFeatured,
    labels: work.labels.map((label) => ({
      locale: label.locale,
      title: label.title,
      description: label.description,
    })),
    contributors: work.contributors.map((entry) => ({
      personId: entry.personId,
      role: entry.role,
    })),
    topicIds: [...work.topicIds],
    salePointIds: [...work.salePointIds],
  };
}

/** The staged Edition as Library's own `editionInputSchema` input, published. */
function editionInput(
  payload: StagedWorkPayload,
  assets: readonly PublishableAsset[],
  workId: string,
) {
  const readable = clearedPdf(assets, payload.edition.readableAssetUrl);
  const download = clearedPdf(assets, payload.edition.downloadAssetUrl);
  return {
    workId,
    label: payload.edition.label,
    languageCode: payload.languageCode,
    state: 'published',
    publisher: payload.edition.publisher,
    publicationYear: payload.edition.publicationYear,
    isbn: payload.edition.isbn,
    pageCount: payload.edition.pageCount,
    reading: readable === null ? 'unavailable' : 'allowed',
    download: download === null ? 'denied' : 'allowed',
    readableAssetId: readable?.assetId ?? null,
    downloadAssetId: download?.assetId ?? null,
    document: null,
    cover: coverOf(payload.edition.cover, assets),
  };
}

/**
 * Phase 30-R. A cover as Library records it: the public copy of the
 * rights-cleared acquisition of exactly the staged image's URL, or null.
 */
function coverOf(
  image: StagedWorkPayload['edition']['cover'],
  assets: readonly PublishableAsset[],
) {
  const cleared = clearedImage(image, assets);
  return cleared === null
    ? null
    : { assetId: cleared.assetId, width: cleared.width, height: cleared.height };
}

/** An Edition exactly as Library holds it, as input — every field it carries. */
function heldEditionInput(edition: EditionRecord) {
  return {
    workId: edition.workId,
    label: edition.label,
    languageCode: edition.languageCode,
    state: edition.state,
    publisher: edition.publisher,
    publicationYear: edition.publicationYear,
    isbn: edition.isbn,
    pageCount: edition.pageCount,
    reading: edition.reading,
    download: edition.download,
    readableAssetId: edition.readableAssetId,
    downloadAssetId: edition.downloadAssetId,
    document: edition.document,
  };
}

/** The Edition input for a Work, once that Work's id is known. */
type EditionOf = (workId: string) => ReturnType<typeof editionInput>;

function workPublished(work: WorkRecord): TargetPublication {
  return {
    status: 'published',
    target: { kind: 'library.work', id: work.id },
    stage: 'public',
    version: work.version,
    canonicalPath: workPath(work.slug),
  };
}

/** The `library.work` target over Library's operations and Personalisation's answer. */
export function libraryWorkTargetOver(deps: {
  readonly library: LibraryWorkOperations;
  readonly holdings: WorkHoldings;
}): MigrationPublicationTargetPort {
  const { library } = deps;
  const supports = (kind: MigrationContentKind) => kind === 'library.work';

  /**
   * Finishes a Work: its Edition when it has none yet, then publication at
   * the Work's CURRENT version. A Work already published is done.
   */
  async function complete(
    actor: LibraryActor,
    workId: string,
    edition: EditionOf | null,
  ): Promise<TargetPublication> {
    if (edition !== null) {
      const made = await ask(() =>
        library.saveEdition(actor, null, null, edition(workId)),
      );
      if (!made.ok) return refusal(made.reason);
    }
    const read = await ask(() => library.work(actor, workId));
    if (!read.ok) return refusal(read.reason);
    const work = read.value;
    if (work === null) return refusal('not-found');
    if (work.state === 'published') return workPublished(work);
    if (work.state !== 'draft') return refusal('target-not-published');
    const saved = await ask(() =>
      library.saveWork(actor, work.id, work.version, heldWorkInput(work, 'published')),
    );
    return saved.ok ? workPublished(saved.value) : refusal(saved.reason);
  }

  /** The Work an interrupted publication made, when it is exactly this payload's. */
  async function adopt(
    actor: LibraryActor,
    payload: StagedWorkPayload,
    edition: EditionOf,
  ): Promise<TargetPublication> {
    const found = await ask(() => library.workBySlug(actor, payload.slug));
    if (!found.ok) return refusal(found.reason);
    const work = found.value;
    // A former slug of another Work, or another Work's words: not ours.
    if (
      work === null ||
      work.primaryLocale !== payload.primaryLocale ||
      !sameLabels(
        work.labels.map((label) => ({ ...label, text: label.description })),
        stagedLabels(payload.labels),
      )
    )
      return refusal('target-conflict');
    if (work.state === 'archived') return refusal('target-not-published');
    const [made, ...more] = work.editions;
    if (more.length > 0) return refusal('target-conflict');
    if (made === undefined)
      // Interrupted before its Edition: only ever a draft.
      return work.state === 'draft'
        ? complete(actor, work.id, edition)
        : refusal('target-conflict');
    if (!sameEdition(made, payload)) return refusal('target-conflict');
    return complete(actor, work.id, null);
  }

  return {
    supports,

    async publish({ kind, payload, topicIds, assets, actor, resumed }) {
      if (!supports(kind) || payload.kind !== 'library.work')
        return refusal('unsupported-kind');
      const libraryActor = asLibrary(actor);
      const edition: EditionOf = (workId) => editionInput(payload, assets, workId);
      // Library's own Edition rule, asked before the Work exists, so a refusal
      // never leaves a draft Work behind.
      if (!editionInputSchema.safeParse(edition(PROBE_WORK_ID)).success)
        return refusal('invalid');
      return publishing(async () => {
        const created = await ask(() =>
          library.saveWork(libraryActor, null, null, workInput(payload, topicIds)),
        );
        if (created.ok) return complete(libraryActor, created.value.id, edition);
        if (created.reason !== 'duplicate-slug') return refusal(created.reason);
        // Adoption is for an interrupted publication of THIS entry only.
        return resumed ? adopt(libraryActor, payload, edition) : refusal('target-exists');
      });
    },

    /**
     * Phase 30-R. A newer revision of the same book page: its cover, once
     * rights-cleared, recorded on the Work's ONE Edition with every other value
     * as Library holds it. A Work a person has curated into several Editions is
     * left for a person.
     */
    async refresh({ kind, target, payload, assets, actor }) {
      if (!supports(kind) || payload.kind !== 'library.work' || target.kind !== kind)
        return refusal('unsupported-kind');
      const libraryActor = asLibrary(actor);
      return publishing(async () => {
        const read = await ask(() => library.work(libraryActor, target.id));
        if (!read.ok) return refusal(read.reason);
        const work = read.value;
        if (work === null) return refusal('not-found');
        if (work.state !== 'published') return refusal('target-not-published');
        const [made, ...more] = work.editions;
        if (made === undefined || more.length > 0) return refusal('target-curated');
        const cover = coverOf(payload.edition.cover, assets);
        if (cover === null || made.cover?.assetId === cover.assetId)
          return workPublished(work);
        const saved = await ask(() =>
          library.saveEdition(libraryActor, made.id, made.version, {
            ...heldEditionInput(made),
            cover,
          }),
        );
        if (!saved.ok) return refusal(saved.reason);
        return workPublished(work);
      });
    },

    async inspect({ target, actor }) {
      if (!supports(target.kind)) return null;
      const work = await library.work(asLibrary(actor), target.id);
      if (work === null) return { exists: false, version: 0, referencedByPeople: false };
      return {
        exists: true,
        version: work.version,
        referencedByPeople: await deps.holdings.workHeld(work.id),
      };
    },

    async withdraw({ target, expectedVersion, actor }) {
      if (!supports(target.kind)) return withdrawalRefusal('unsupported-kind');
      const libraryActor = asLibrary(actor);
      return withdrawing(async () => {
        const found = await ask(() => library.work(libraryActor, target.id));
        if (!found.ok) return withdrawalRefusal(found.reason);
        const work = found.value;
        if (work === null) return withdrawalRefusal('not-found');
        if (work.version !== expectedVersion) return withdrawalRefusal('conflict');
        // Archiving the Work takes its Editions out of public view with it.
        const archived = await ask(() =>
          library.saveWork(
            libraryActor,
            work.id,
            expectedVersion,
            heldWorkInput(work, 'archived'),
          ),
        );
        if (!archived.ok) return withdrawalRefusal(archived.reason);
        return { status: 'withdrawn', version: archived.value.version };
      });
    },
  };
}

/** The one Edition this payload describes, published, as Library holds it. */
function sameEdition(edition: EditionRecord, payload: StagedWorkPayload): boolean {
  return (
    edition.state === 'published' &&
    edition.label === payload.edition.label.trim() &&
    edition.languageCode === payload.languageCode
  );
}

/* ===========================================================================
 * library.magazine
 * ========================================================================= */

/** Staged labels as Library's scholarly labels: the description is the summary. */
function scholarlyLabels(labels: StagedMagazinePayload['labels']) {
  return labels.map((label) => ({
    locale: label.locale,
    title: label.title,
    summary: label.description,
  }));
}

/** A held scholarly record's labels in the shape `sameLabels` compares. */
const heldLabels = (record: MagazineRecord | MagazineIssueRecord) =>
  record.labels.map((label) => ({
    locale: label.locale,
    title: label.title,
    text: label.summary,
  }));

/** What every scholarly record holds and must keep when only its state moves. */
function heldDescribed(
  record: MagazineRecord | MagazineIssueRecord,
  state: LibraryState,
) {
  return {
    slug: record.slug,
    primaryLocale: record.primaryLocale,
    state,
    labels: record.labels.map((label) => ({
      locale: label.locale,
      title: label.title,
      summary: label.summary,
    })),
    contributors: record.contributors.map((entry) => ({
      personId: entry.personId,
      role: entry.role,
    })),
    topicIds: [...record.topicIds],
  };
}

function magazinePublished(record: { id: string; slug: string; version: number }) {
  return {
    status: 'published',
    target: { kind: 'library.magazine', id: record.id },
    stage: 'public',
    version: record.version,
    canonicalPath: magazinePath(record.slug),
  } satisfies TargetPublication;
}

/**
 * The record of `kind` with exactly this slug in Library's administrative
 * directory — most recently changed first, so an interrupted publication's
 * record is on the first page — searched for at most `ADOPTION_PAGES` pages.
 */
async function findBySlug<K extends 'magazine' | 'magazine-issue'>(
  library: LibraryScholarlyOperations,
  actor: LibraryActor,
  kind: K,
  slug: string,
  magazineId: string | null,
) {
  for (let page = 0; page < ADOPTION_PAGES; page += 1) {
    const listing = await ask(() =>
      library.scholarlyRecords(actor, kind, {
        offset: page * SCHOLARLY_PAGE,
        state: null,
        magazineId,
      }),
    );
    if (!listing.ok) return listing;
    const match = listing.value.items.find((item) => item.slug === slug);
    if (match !== undefined)
      return ask(() => library.scholarlyRecord(actor, kind, match.id));
    if (!listing.value.hasMore) break;
  }
  return { ok: true as const, value: null };
}

/** The `library.magazine` target over Library's operations. */
export function libraryMagazineTargetOver(deps: {
  readonly library: LibraryScholarlyOperations;
}): MigrationPublicationTargetPort {
  const { library } = deps;
  const supports = (kind: MigrationContentKind) => kind === 'library.magazine';

  async function adopt(
    actor: LibraryActor,
    payload: StagedMagazinePayload,
  ): Promise<TargetPublication> {
    const found = await findBySlug(library, actor, 'magazine', payload.slug, null);
    if (!found.ok) return refusal(found.reason);
    const record = found.value;
    if (
      record === null ||
      record.slug !== payload.slug ||
      record.primaryLocale !== payload.primaryLocale ||
      !sameLabels(heldLabels(record), stagedLabels(payload.labels))
    )
      return refusal('target-conflict');
    if (record.state !== 'published') return refusal('target-not-published');
    return magazinePublished(record);
  }

  return {
    supports,

    /**
     * Phase 30-R. A magazine's payload carries nothing a refresh changes (its
     * covers are its issues'), so a published Magazine is answered as it is.
     */
    async refresh({ kind, target, payload, actor }) {
      if (!supports(kind) || payload.kind !== 'library.magazine' || target.kind !== kind)
        return refusal('unsupported-kind');
      return publishing(async () => {
        const read = await ask(() =>
          library.scholarlyRecord(asLibrary(actor), 'magazine', target.id),
        );
        if (!read.ok) return refusal(read.reason);
        const record = read.value;
        if (record === null) return refusal('not-found');
        if (record.state !== 'published') return refusal('target-not-published');
        return magazinePublished(record);
      });
    },

    async publish({ kind, payload, topicIds, actor, resumed }) {
      if (!supports(kind) || payload.kind !== 'library.magazine')
        return refusal('unsupported-kind');
      const libraryActor = asLibrary(actor);
      return publishing(async () => {
        const saved = await ask(() =>
          library.saveScholarly(libraryActor, 'magazine', null, null, {
            slug: payload.slug,
            primaryLocale: payload.primaryLocale,
            state: 'published',
            labels: scholarlyLabels(payload.labels),
            contributors: [],
            topicIds: [...topicIds],
          }),
        );
        if (saved.ok) return magazinePublished(saved.value);
        if (saved.reason !== 'duplicate-slug') return refusal(saved.reason);
        return resumed ? adopt(libraryActor, payload) : refusal('target-exists');
      });
    },

    async inspect({ target, actor }) {
      if (!supports(target.kind)) return null;
      const record = await library.scholarlyRecord(
        asLibrary(actor),
        'magazine',
        target.id,
      );
      if (record === null)
        return { exists: false, version: 0, referencedByPeople: false };
      // No personal table can name a Magazine.
      return { exists: true, version: record.version, referencedByPeople: NOT_HELD };
    },

    async withdraw({ target, expectedVersion, actor }) {
      if (!supports(target.kind)) return withdrawalRefusal('unsupported-kind');
      const libraryActor = asLibrary(actor);
      return withdrawing(async () => {
        const found = await ask(() =>
          library.scholarlyRecord(libraryActor, 'magazine', target.id),
        );
        if (!found.ok) return withdrawalRefusal(found.reason);
        const record = found.value;
        if (record === null) return withdrawalRefusal('not-found');
        if (record.version !== expectedVersion) return withdrawalRefusal('conflict');
        const archived = await ask(() =>
          library.saveScholarly(
            libraryActor,
            'magazine',
            record.id,
            expectedVersion,
            heldDescribed(record, 'archived'),
          ),
        );
        if (!archived.ok) return withdrawalRefusal(archived.reason);
        return { status: 'withdrawn', version: archived.value.version };
      });
    },
  };
}

/* ===========================================================================
 * library.magazine-issue
 * ========================================================================= */

/** ASCII, Arabic-Indic and Extended Arabic-Indic digits — a printed number. */
const PRINTED_NUMBER = /^[0-9٠-٩۰-۹]+$/u;

/**
 * A staged volume or issue number as Library's positive integer: `null` when
 * the source states none, the number when the source printed one in digits of
 * any of the corpus's scripts, and `undefined` when the source's words are not
 * a number Library can hold ("Special issue", "XII") — which is refused rather
 * than dropped or guessed.
 */
export function printedNumber(value: string | null): number | null | undefined {
  if (value === null) return null;
  const text = value.trim();
  if (!PRINTED_NUMBER.test(text)) return undefined;
  const digits = [...text]
    .map((character) => {
      const code = character.codePointAt(0) ?? 0;
      if (code >= 0x0660 && code <= 0x0669) return String(code - 0x0660);
      if (code >= 0x06f0 && code <= 0x06f9) return String(code - 0x06f0);
      return character;
    })
    .join('');
  const number = Number(digits);
  return Number.isSafeInteger(number) &&
    number >= 1 &&
    number <= SCHOLARLY_LIMITS.issueNumber
    ? number
    : undefined;
}

/** A run's words, exactly. A hard line break stays a line break in the text. */
const words = (content: readonly StagedInline[]) =>
  content.map((run) => run.text).join('');

/**
 * A staged rich body as Library's plain `ReaderDocument` — `null` when there is
 * no body or nothing in it to read, and `undefined` when its words cannot be
 * held within Library's bounds (a title over 240 characters, a paragraph over
 * 8,000, more than 100 paragraphs in a section or 200 sections), which is
 * refused rather than truncated.
 *
 * NO WORD IS INVENTED, AND NONE IS ALTERED. Each heading opens a section titled
 * with that heading's own words (a line break inside it becomes a space, since
 * a title is one line). Paragraphs, quotations and each list item become
 * paragraphs with their words exactly; emphasis and links do not exist in a
 * ReaderDocument and are not represented, and no list marker or number is
 * added. Keys are derived by Library's own rule (`uniqueSectionKey`).
 *
 * TWO CHOICES THE DOMAIN FORCES, the least inventive available:
 *
 *   - Words BEFORE the first heading (or a body with no heading at all, as an
 *     issue's table of contents usually is) need a section, and a section needs
 *     a title. They are given the issue's OWN title — its primary-locale label,
 *     the source's words for this very document — rather than a made-up
 *     "Introduction", and rather than being dropped.
 *   - A heading with nothing beneath it before the next heading cannot be a
 *     section (Library requires at least one paragraph), and is left out, as
 *     Library's own authoring format leaves such a heading out.
 */
export function readerDocumentOf(
  body: readonly StagedBlock[] | null,
  ownTitle: string,
): ReaderDocument | null | undefined {
  if (body === null) return null;
  const sections: { key: string; title: string; paragraphs: string[] }[] = [];
  const used = new Set<string>();
  let current: { title: string; paragraphs: string[] } | null = null;

  const close = (open: { title: string; paragraphs: string[] } | null) => {
    if (open !== null && open.paragraphs.length > 0)
      sections.push({
        key: uniqueSectionKey(open.title, sections.length, used),
        title: open.title,
        paragraphs: open.paragraphs,
      });
  };
  const add = (text: string) => {
    const paragraph = text.trim();
    if (paragraph === '') return;
    current ??= { title: ownTitle.trim(), paragraphs: [] };
    current.paragraphs.push(paragraph);
  };

  for (const block of body) {
    if (block.type === 'heading') {
      const title = words(block.content)
        .replace(/\s*\n\s*/gu, ' ')
        .trim();
      if (title === '') continue;
      close(current);
      current = { title, paragraphs: [] };
    } else if (block.type === 'list') for (const item of block.items) add(words(item));
    else add(words(block.content));
  }
  close(current);

  if (sections.length === 0) return null;
  const parsed = readerDocumentSchema.safeParse({ sections });
  return parsed.success ? parsed.data : undefined;
}

function issuePublished(
  record: { id: string; slug: string; version: number },
  magazineSlug: string,
) {
  return {
    status: 'published',
    target: { kind: 'library.magazine-issue', id: record.id },
    stage: 'public',
    version: record.version,
    canonicalPath: issuePath(magazineSlug, record.slug),
  } satisfies TargetPublication;
}

/** The `library.magazine-issue` target over Library's operations. */
export function libraryMagazineIssueTargetOver(deps: {
  readonly library: LibraryScholarlyOperations;
}): MigrationPublicationTargetPort {
  const { library } = deps;
  const supports = (kind: MigrationContentKind) => kind === 'library.magazine-issue';

  async function adopt(
    actor: LibraryActor,
    payload: StagedMagazineIssuePayload,
    magazine: MagazineRecord,
    numbers: { readonly volume: number | null; readonly issueNumber: number | null },
  ): Promise<TargetPublication> {
    const found = await findBySlug(
      library,
      actor,
      'magazine-issue',
      payload.slug,
      magazine.id,
    );
    if (!found.ok) return refusal(found.reason);
    const record = found.value;
    // Taken by another issue's slug or number, or not this payload's words.
    if (
      record === null ||
      record.slug !== payload.slug ||
      record.magazineId !== magazine.id ||
      record.primaryLocale !== payload.primaryLocale ||
      record.languageCode !== payload.languageCode ||
      record.publishedOn !== payload.publishedOn ||
      record.volume !== numbers.volume ||
      record.issueNumber !== numbers.issueNumber ||
      !sameLabels(heldLabels(record), stagedLabels(payload.labels))
    )
      return refusal('target-conflict');
    if (record.state !== 'published') return refusal('target-not-published');
    return issuePublished(record, magazine.slug);
  }

  return {
    supports,

    async publish({ kind, payload, topicIds, assets, resolve, actor, resumed }) {
      if (!supports(kind) || payload.kind !== 'library.magazine-issue')
        return refusal('unsupported-kind');
      const libraryActor = asLibrary(actor);
      const volume = printedNumber(payload.volume);
      const issueNumber = printedNumber(payload.issueNumber);
      if (volume === undefined || issueNumber === undefined)
        return refusal('issue-number-unmappable');
      const primary =
        payload.labels.find((label) => label.locale === payload.primaryLocale) ??
        payload.labels[0];
      const document = readerDocumentOf(payload.body, primary?.title ?? '');
      if (document === undefined) return refusal('document-out-of-bounds');

      return publishing(async () => {
        // The Magazine must be one migration already published, and public now.
        const reference = await resolve(payload.magazine.legacyUrl);
        if (reference === null || reference.kind !== 'library.magazine')
          return refusal('reference-unpublished');
        const read = await ask(() =>
          library.scholarlyRecord(libraryActor, 'magazine', reference.id),
        );
        if (!read.ok) return refusal(read.reason);
        const magazine = read.value;
        if (magazine === null || magazine.state !== 'published')
          return refusal('reference-unpublished');

        const saved = await ask(() =>
          library.saveScholarly(libraryActor, 'magazine-issue', null, null, {
            slug: payload.slug,
            primaryLocale: payload.primaryLocale,
            state: 'published',
            labels: scholarlyLabels(payload.labels),
            contributors: [],
            topicIds: [...topicIds],
            languageCode: payload.languageCode,
            // A stated date supplies its own year (Library's rule); none is guessed.
            publicationYear: null,
            publishedOn: payload.publishedOn,
            magazineId: magazine.id,
            volume,
            issueNumber,
            document,
            cover: coverOf(payload.cover, assets),
          }),
        );
        // The path names the Magazine's CURRENT slug, as Library just read it.
        if (saved.ok) return issuePublished(saved.value, magazine.slug);
        if (saved.reason !== 'duplicate-slug' && saved.reason !== 'duplicate-number')
          return refusal(saved.reason);
        return resumed
          ? adopt(libraryActor, payload, magazine, { volume, issueNumber })
          : refusal('target-exists');
      });
    },

    /**
     * Phase 30-R. A newer revision of the same issue page: its cover, once
     * rights-cleared, with every other value exactly as Library holds it.
     */
    async refresh({ kind, target, payload, assets, actor }) {
      if (
        !supports(kind) ||
        payload.kind !== 'library.magazine-issue' ||
        target.kind !== kind
      )
        return refusal('unsupported-kind');
      const libraryActor = asLibrary(actor);
      return publishing(async () => {
        const read = await ask(() =>
          library.scholarlyRecord(libraryActor, 'magazine-issue', target.id),
        );
        if (!read.ok) return refusal(read.reason);
        const record = read.value;
        if (record === null) return refusal('not-found');
        if (record.state !== 'published') return refusal('target-not-published');
        const cover = coverOf(payload.cover, assets);
        if (cover === null || record.cover?.assetId === cover.assetId)
          return issuePublished(record, record.magazine.slug);
        const saved = await ask(() =>
          library.saveScholarly(
            libraryActor,
            'magazine-issue',
            record.id,
            record.version,
            {
              ...heldDescribed(record, 'published'),
              languageCode: record.languageCode,
              publicationYear: record.publicationYear,
              publishedOn: record.publishedOn,
              magazineId: record.magazineId,
              volume: record.volume,
              issueNumber: record.issueNumber,
              document: record.document,
              cover,
            },
          ),
        );
        if (!saved.ok) return refusal(saved.reason);
        return issuePublished(saved.value, record.magazine.slug);
      });
    },

    async inspect({ target, actor }) {
      if (!supports(target.kind)) return null;
      const record = await library.scholarlyRecord(
        asLibrary(actor),
        'magazine-issue',
        target.id,
      );
      if (record === null)
        return { exists: false, version: 0, referencedByPeople: false };
      // No personal table can name a MagazineIssue.
      return { exists: true, version: record.version, referencedByPeople: NOT_HELD };
    },

    async withdraw({ target, expectedVersion, actor }) {
      if (!supports(target.kind)) return withdrawalRefusal('unsupported-kind');
      const libraryActor = asLibrary(actor);
      return withdrawing(async () => {
        const found = await ask(() =>
          library.scholarlyRecord(libraryActor, 'magazine-issue', target.id),
        );
        if (!found.ok) return withdrawalRefusal(found.reason);
        const record = found.value;
        if (record === null) return withdrawalRefusal('not-found');
        if (record.version !== expectedVersion) return withdrawalRefusal('conflict');
        const archived = await ask(() =>
          library.saveScholarly(
            libraryActor,
            'magazine-issue',
            record.id,
            expectedVersion,
            {
              ...heldDescribed(record, 'archived'),
              languageCode: record.languageCode,
              publicationYear: record.publicationYear,
              publishedOn: record.publishedOn,
              magazineId: record.magazineId,
              volume: record.volume,
              issueNumber: record.issueNumber,
              document: record.document,
            },
          ),
        );
        if (!archived.ok) return withdrawalRefusal(archived.reason);
        return { status: 'withdrawn', version: archived.value.version };
      });
    },
  };
}
