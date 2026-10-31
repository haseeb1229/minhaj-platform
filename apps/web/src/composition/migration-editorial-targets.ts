import 'server-only';

import {
  newsPathOf,
  pagePath,
  type ArticleDetail,
  type EditorialActor,
  type EditorialReferencesPort,
  type PageDetail,
} from '@minhaj/contracts/editorial';
import type { LibraryReferencesPort } from '@minhaj/contracts/library';
import type {
  MigrationActor,
  MigrationContentKind,
  MigrationPublicationTargetPort,
  PublishableAsset,
  StagedBlock,
  StagedEditorialPayload,
  StagedInline,
  StagedPagePayload,
  StagedPayload,
  TargetPublication,
} from '@minhaj/contracts/migration';

import { editorialFailure, type EditorialService } from '../contexts/editorial/index.ts';
import {
  ADOPTION_PAGES,
  askerOf,
  clearedImage,
  STILL_JPEG_PNG,
  publishing,
  refusal,
  withdrawalRefusal,
  withdrawing,
} from './migration-target-support.ts';

/**
 * The Editorial publication targets — `editorial.news` (a NewsArticle) and
 * `editorial.article` (an Article) — Layer 4 (Phase 30; MIGRATION_STRATEGY.md
 * §4.12, §7).
 *
 * THROUGH EDITORIAL'S PUBLIC SERVICE AND ITS OWN WORKFLOW, NEVER AROUND IT. A
 * migrated record is CREATED (`content.author`) and SUBMITTED for review —
 * exactly what an author may do — and the result is stage `in-review`.
 * Editorial refuses self-approval, so the record becomes public only when a
 * DIFFERENT person holding `content.review` approves it and one holding
 * `content.publish` publishes it, by Editorial's own decision. This target never
 * approves, schedules or publishes anything.
 *
 * THE BODY IS EDITORIAL'S OWN DOCUMENT FORMAT, BUILT AS DATA. Each staged
 * block becomes the editor's node — paragraph, heading 2–4, blockquote,
 * bullet/ordered list of items — and each run a text node with its bold,
 * italic and link marks; a line break inside a run is a hard break. The
 * document is built as an object and serialised once, so no markup string is
 * ever assembled, and Editorial's own renderer validates and sanitises it. A
 * link is exactly the already-rewritten href the payload carries.
 *
 * SOURCE TRUTH, NOTHING SMUGGLED (Phase 30-R). A dated family's source date
 * (`publishedOn`) is Editorial's `sourcePublishedOn` — the record's
 * reader-facing chronology, never replaced by the migration or approval date.
 * A lead image is used only as the PUBLIC copy of a rights-cleared acquisition
 * of exactly its URL, with the source's own alt text. No contributor, Centre
 * or SEO text is invented; the excerpt is the source's, possibly empty.
 *
 * FOUR FAMILIES: `editorial.news` (a NewsArticle), `editorial.article` (an
 * Article), `editorial.press-release` (a PressRelease) and `editorial.page` —
 * an organisational Page bound to the ONE reserved shell route its payload
 * names, whose slug is always `page`; Editorial validates the binding.
 *
 * REFRESH (Phase 30-R) is an author's revision through Editorial's own
 * workflow, then a submission: the record is in review again until a
 * different person approves and publishes it.
 *
 * ADOPTION ONLY ON RESUME, ONLY FOR AN EXACT MATCH. A resumed entry meeting a
 * taken slug pages Editorial's administrative directory (most recently changed
 * first, `ADOPTION_PAGES` pages at most) and adopts only a record carrying
 * exactly this payload's slug, language, title, excerpt and document: one still
 * IN REVIEW as it is, or one still the untouched draft its creation left
 * (version 1) by submitting it. A draft a reviewer rejected, a published or
 * archived record, or another record's words is refused for a person. A fresh
 * entry meeting an existing record is refused `target-exists`.
 *
 * WITHDRAWAL IS EDITORIAL'S `archive` AT THE RECORDED VERSION — the one
 * workflow action that takes a draft or in-review record out of the workflow
 * (`reject` would only return it to draft). Editorial requires `content.publish`
 * for it; a publisher without it is refused `denied`, and rollback leaves the
 * record for a person. A record moved since (approved, edited, rejected) is
 * refused `conflict` by Editorial's own version check.
 *
 * WHO HOLDS IT: an Article somebody saved or read is held (Personalisation's
 * `articleHeld`); nothing personal can name a NewsArticle, so it never is.
 *
 * NODE-RUNNABLE: packages and explicit `.ts` paths only — never the `@/` alias.
 */

/** The Editorial operations the targets use, and nothing else of Editorial. */
export type EditorialOperations = Pick<
  EditorialService,
  'create' | 'revise' | 'transition' | 'directory' | 'detail'
>;

/** Personalisation's one-bit answer about an Article. */
export interface ArticleHoldings {
  articleHeld(articleId: string): Promise<boolean>;
}

type EditorialFamily =
  'editorial.news' | 'editorial.article' | 'editorial.press-release' | 'editorial.page';

type EditorialPayload = StagedEditorialPayload | StagedPagePayload;

/** Each migration kind's Editorial aggregate and whether it carries a source date. */
const FAMILIES = {
  'editorial.news': { aggregate: 'news-article', dated: true },
  'editorial.article': { aggregate: 'article', dated: true },
  'editorial.press-release': { aggregate: 'press-release', dated: true },
  'editorial.page': { aggregate: 'page', dated: false },
} as const satisfies Record<
  EditorialFamily,
  { readonly aggregate: string; readonly dated: boolean }
>;

/** The locale-free canonical path of a record Editorial holds. */
function pathOf(family: EditorialFamily, record: ArticleDetail): string {
  if (family === 'editorial.news') return newsPathOf('news-article', record.slug);
  if (family === 'editorial.press-release')
    return newsPathOf('press-release', record.slug);
  if (family === 'editorial.page')
    return pagePath((record as PageDetail).routeBinding, record.slug);
  return `/library/articles/${record.slug}`;
}

/** Editorial's administrative directory page size. */
const DIRECTORY_PAGE = 25;

const ask = askerOf(editorialFailure);
const asEditorial = (actor: MigrationActor): EditorialActor => ({
  accountId: actor.accountId,
});

/* ===========================================================================
 * The document
 * ========================================================================= */

interface DocumentNode {
  readonly type: string;
  readonly text?: string;
  readonly attrs?: { readonly level: number };
  readonly marks?: readonly {
    readonly type: string;
    readonly attrs?: { readonly href: string };
  }[];
  readonly content?: readonly DocumentNode[];
}

/** One run's words as text nodes and hard breaks, with its marks. */
function inlineNodes(content: readonly StagedInline[]): DocumentNode[] {
  const nodes: DocumentNode[] = [];
  for (const run of content) {
    const marks = [
      ...(run.bold ? [{ type: 'bold' }] : []),
      ...(run.italic ? [{ type: 'italic' }] : []),
      ...(run.href === undefined ? [] : [{ type: 'link', attrs: { href: run.href } }]),
    ];
    run.text.split('\n').forEach((part, index) => {
      if (index > 0) nodes.push({ type: 'hardBreak' });
      if (part !== '')
        nodes.push({ type: 'text', text: part, ...(marks.length > 0 ? { marks } : {}) });
    });
  }
  return nodes;
}

/** A textblock of `type`, with its content only when it has any. */
function textblock(
  type: 'paragraph' | 'heading',
  content: readonly StagedInline[],
  attrs?: { readonly level: number },
): DocumentNode {
  const inline = inlineNodes(content);
  return {
    type,
    ...(attrs === undefined ? {} : { attrs }),
    ...(inline.length > 0 ? { content: inline } : {}),
  };
}

function blockNode(block: StagedBlock): DocumentNode {
  if (block.type === 'heading')
    return textblock('heading', block.content, { level: block.level });
  if (block.type === 'quote')
    return { type: 'blockquote', content: [textblock('paragraph', block.content)] };
  if (block.type === 'list')
    return {
      type: block.ordered ? 'orderedList' : 'bulletList',
      content: block.items.map((item) => ({
        type: 'listItem',
        content: [textblock('paragraph', item)],
      })),
    };
  return textblock('paragraph', block.content);
}

/** The staged body as Editorial's document JSON. */
export function editorialDocument(body: readonly StagedBlock[]): string {
  return JSON.stringify({ type: 'doc', content: body.map(blockNode) });
}

/** A JSON value with object keys sorted, so two documents compare by content. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, entry]) => [key, canonical(entry)]),
    );
  return value;
}

function sameDocument(held: string, staged: string): boolean {
  try {
    return (
      JSON.stringify(canonical(JSON.parse(held))) ===
      JSON.stringify(canonical(JSON.parse(staged)))
    );
  } catch {
    return false;
  }
}

/* ===========================================================================
 * The record as Editorial's input
 * ========================================================================= */

/** What a payload asks of its record: words, document, lead image and date. */
interface Wanted {
  readonly slug: string;
  readonly languageCode: string;
  readonly title: string;
  readonly excerpt: string;
  readonly document: string;
  readonly lead: ReturnType<typeof clearedImage>;
  /** `undefined` for a Page, which has no source date. */
  readonly sourcePublishedOn: string | null | undefined;
}

function wantedOf(
  family: EditorialFamily,
  payload: EditorialPayload,
  assets: readonly PublishableAsset[],
): Wanted {
  return {
    // A shell-bound Page's slug is always `page`; its binding is its address.
    slug: payload.kind === 'editorial.page' ? 'page' : payload.slug,
    languageCode: payload.languageCode,
    title: payload.title,
    excerpt: payload.excerpt,
    document: editorialDocument(payload.body),
    // Only a rights-cleared acquisition's public copy, never a remote URL.
    lead: clearedImage(payload.leadImage, assets, STILL_JPEG_PNG),
    sourcePublishedOn:
      FAMILIES[family].dated && payload.kind !== 'editorial.page'
        ? payload.publishedOn
        : undefined,
  };
}

/** The translation the payload's language carries. */
function translationOf(wanted: Wanted) {
  return {
    languageCode: wanted.languageCode,
    title: wanted.title,
    excerpt: wanted.excerpt,
    seoTitle: '',
    seoDescription: '',
    document: wanted.document,
    leadAlt: wanted.lead?.alt ?? '',
  };
}

function leadOf(wanted: Wanted) {
  return wanted.lead === null
    ? null
    : {
        assetId: wanted.lead.assetId,
        width: wanted.lead.width,
        height: wanted.lead.height,
        credit: wanted.lead.credit,
      };
}

/** A new record's content input for its aggregate. */
function contentInput(
  family: EditorialFamily,
  wanted: Wanted,
  topicIds: readonly string[],
) {
  const content = {
    slug: wanted.slug,
    primaryLanguage: wanted.languageCode,
    translations: [translationOf(wanted)],
    topicIds: [...topicIds],
    contributors: [],
    leadImage: leadOf(wanted),
    ...(wanted.sourcePublishedOn === undefined
      ? {}
      : { sourcePublishedOn: wanted.sourcePublishedOn }),
  };
  // A NewsArticle may name a Centre; a migrated one names none.
  return family === 'editorial.news' ? { ...content, centreId: null } : content;
}

/**
 * A REFRESH's content input over the record Editorial holds: the payload's
 * words, document, lead image and source date in the payload's language —
 * and everything a person may have curated since (other translations, topics,
 * contributors, a Centre, SEO words) exactly as the current revision holds it.
 */
function refreshInput(record: ArticleDetail, wanted: Wanted) {
  const current = record.revision;
  const held = current.translations.find(
    (translation) => translation.languageCode === wanted.languageCode,
  );
  const translations = [
    ...current.translations
      .filter((translation) => translation.languageCode !== wanted.languageCode)
      .map((translation) => ({
        languageCode: translation.languageCode,
        title: translation.title,
        excerpt: translation.excerpt,
        seoTitle: translation.seoTitle,
        seoDescription: translation.seoDescription,
        document: translation.document,
        leadAlt: translation.leadAlt ?? '',
      })),
    {
      ...translationOf(wanted),
      seoTitle: held?.seoTitle ?? '',
      seoDescription: held?.seoDescription ?? '',
    },
  ];
  return {
    slug: record.slug,
    primaryLanguage: current.primaryLanguage,
    translations,
    topicIds: [...current.topicIds],
    contributors: current.contributors.map((entry) => ({
      personId: entry.personId,
      role: entry.role,
    })),
    leadImage: leadOf(wanted) ?? current.leadImage ?? null,
    ...(wanted.sourcePublishedOn === undefined
      ? {}
      : { sourcePublishedOn: wanted.sourcePublishedOn }),
    ...(current.centreId === undefined ? {} : { centreId: current.centreId }),
  };
}

/** Whether the record Editorial holds already carries exactly what is wanted. */
function sameRecord(record: ArticleDetail, wanted: Wanted, alone: boolean): boolean {
  const { revision } = record;
  const translation = revision.translations.find(
    (entry) => entry.languageCode === wanted.languageCode,
  );
  const lead = wanted.lead;
  return (
    record.slug === wanted.slug &&
    translation !== undefined &&
    (!alone ||
      (revision.translations.length === 1 &&
        revision.primaryLanguage === wanted.languageCode)) &&
    translation.title === wanted.title.trim() &&
    translation.excerpt === wanted.excerpt.trim() &&
    sameDocument(translation.document, wanted.document) &&
    (lead === null ||
      (revision.leadImage?.assetId === lead.assetId &&
        (translation.leadAlt ?? '') === lead.alt.trim())) &&
    (wanted.sourcePublishedOn === undefined ||
      (revision.sourcePublishedOn ?? null) === wanted.sourcePublishedOn)
  );
}

/* ===========================================================================
 * The targets
 * ========================================================================= */

/** A publication target for one Editorial family over Editorial's operations. */
export function editorialTargetOver(deps: {
  readonly kind: EditorialFamily;
  readonly editorial: EditorialOperations;
  readonly holdings: ArticleHoldings;
}): MigrationPublicationTargetPort {
  const { editorial, kind: family } = deps;
  const { aggregate } = FAMILIES[family];
  const supports = (kind: MigrationContentKind) => kind === family;
  const ownPayload = (payload: StagedPayload): payload is EditorialPayload =>
    payload.kind === family;

  function stageOf(
    record: ArticleDetail,
    stage: 'in-review' | 'public',
  ): TargetPublication {
    return {
      status: 'published',
      target: { kind: family, id: record.id },
      stage,
      version: record.version,
      canonicalPath: pathOf(family, record),
    };
  }

  /** Submits a draft for review at its version — an author's act, nothing more. */
  async function submit(
    actor: EditorialActor,
    record: ArticleDetail,
  ): Promise<TargetPublication> {
    const submitted = await ask(() =>
      editorial.transition(actor, aggregate, {
        id: record.id,
        expectedVersion: record.version,
        action: 'submit',
        scheduledAt: null,
        timezone: null,
      }),
    );
    return submitted.ok
      ? stageOf(submitted.value, 'in-review')
      : refusal(submitted.reason);
  }

  /** The record this payload names among a directory page's items, if any. */
  async function matchIn(
    actor: EditorialActor,
    items: readonly { readonly id: string; readonly slug: string }[],
    payload: EditorialPayload,
    wanted: Wanted,
  ): Promise<ArticleDetail | 'refused' | null> {
    for (const item of items) {
      if (item.slug !== wanted.slug) continue;
      const found = await ask(() => editorial.detail(actor, aggregate, item.id));
      if (!found.ok) return 'refused';
      // Every shell-bound Page's slug is `page`: its binding says which one.
      if (
        payload.kind === 'editorial.page' &&
        (found.value as PageDetail).routeBinding !== payload.binding
      )
        continue;
      return found.value;
    }
    return null;
  }

  /** The record an interrupted publication made, when it is exactly this payload's. */
  async function adopt(
    actor: EditorialActor,
    payload: EditorialPayload,
    wanted: Wanted,
  ): Promise<TargetPublication> {
    for (let page = 0; page < ADOPTION_PAGES; page += 1) {
      const listing = await ask(() =>
        editorial.directory(actor, aggregate, page * DIRECTORY_PAGE, null),
      );
      if (!listing.ok) return refusal(listing.reason);
      const record = await matchIn(actor, listing.value.items, payload, wanted);
      if (record === 'refused') return refusal('target-conflict');
      if (record !== null) {
        if (!sameRecord(record, wanted, true)) return refusal('target-conflict');
        if (record.state === 'in-review') return stageOf(record, 'in-review');
        // Only the untouched draft its creation left: never one a reviewer
        // sent back, which a person must resubmit.
        if (
          record.state === 'draft' &&
          record.version === 1 &&
          record.currentRevision === 1 &&
          record.approvedRevision === null
        )
          return submit(actor, record);
        return refusal('target-not-in-review');
      }
      if (!listing.value.more) break;
    }
    return refusal('target-conflict');
  }

  return {
    supports,

    async publish({ kind, payload, topicIds, assets, actor, resumed }) {
      if (!supports(kind) || !ownPayload(payload)) return refusal('unsupported-kind');
      const editorialActor = asEditorial(actor);
      const wanted = wantedOf(family, payload, assets);
      return publishing(async () => {
        const input = contentInput(family, wanted, topicIds);
        const created = await ask(() =>
          payload.kind === 'editorial.page'
            ? editorial.create(editorialActor, aggregate, input, payload.binding)
            : editorial.create(editorialActor, aggregate, input),
        );
        if (created.ok) return submit(editorialActor, created.value);
        if (created.reason !== 'duplicate-slug') return refusal(created.reason);
        // Adoption is for an interrupted publication of THIS entry only.
        return resumed
          ? adopt(editorialActor, payload, wanted)
          : refusal('target-exists');
      });
    },

    /**
     * Phase 30-R. A newer revision of the same legacy record, as an AUTHOR's
     * edit through Editorial's own workflow: revised, then submitted — so it is
     * `in-review` until a different person approves and publishes it (an edited
     * published record leaves public view until then, Editorial's own rule). A
     * record already carrying exactly the wanted words, image and date is
     * answered as it stands.
     */
    async refresh({ kind, target, payload, assets, actor }) {
      if (!supports(kind) || !ownPayload(payload) || target.kind !== kind)
        return refusal('unsupported-kind');
      const editorialActor = asEditorial(actor);
      const wanted = wantedOf(family, payload, assets);
      return publishing(async () => {
        const found = await ask(() =>
          editorial.detail(editorialActor, aggregate, target.id),
        );
        if (!found.ok) return refusal(found.reason);
        const record = found.value;
        if (record.state === 'archived') return refusal('target-archived');
        if (sameRecord(record, wanted, false)) {
          if (record.state === 'published') return stageOf(record, 'public');
          if (record.state === 'in-review') return stageOf(record, 'in-review');
        }
        // Editorial's own rule: a scheduled record is first cancelled by a person.
        if (record.state === 'scheduled') return refusal('target-scheduled');
        const revised = await ask(() =>
          editorial.revise(
            editorialActor,
            aggregate,
            record.id,
            record.version,
            refreshInput(record, wanted),
          ),
        );
        if (!revised.ok) return refusal(revised.reason);
        return submit(editorialActor, revised.value);
      });
    },

    async inspect({ target, actor }) {
      if (!supports(target.kind)) return null;
      let record: ArticleDetail;
      try {
        record = await editorial.detail(asEditorial(actor), aggregate, target.id);
      } catch (error) {
        if (editorialFailure(error) === 'not-found')
          return { exists: false, version: 0, referencedByPeople: false };
        throw error;
      }
      return {
        exists: true,
        version: record.version,
        // Only an Article can be saved or read by a person.
        referencedByPeople:
          family === 'editorial.article'
            ? await deps.holdings.articleHeld(record.id)
            : false,
      };
    },

    async withdraw({ target, expectedVersion, actor }) {
      if (!supports(target.kind)) return withdrawalRefusal('unsupported-kind');
      return withdrawing(async () => {
        const archived = await ask(() =>
          editorial.transition(asEditorial(actor), aggregate, {
            id: target.id,
            expectedVersion,
            action: 'archive',
            scheduledAt: null,
            timezone: null,
          }),
        );
        if (!archived.ok) return withdrawalRefusal(archived.reason);
        return { status: 'withdrawn', version: archived.value.version };
      });
    },
  };
}

/**
 * Editorial's reference questions for a MIGRATED record, answered by the same
 * owner references Media and Library use: contributors are People's, topics
 * and content languages Taxonomy's. A migrated record names no Centre, no
 * Gallery and no Collection member, so those questions are answered `false` —
 * should one ever be asked, the record is refused rather than linked. A lead
 * image is Storage's answer (Phase 30-R): a servable still image.
 */
export function migrationEditorialReferences(
  owner: LibraryReferencesPort,
  /** Storage's servable-still-image question, and nothing else of Storage. */
  storage: () => Promise<{
    servableImages(assetIds: readonly string[]): Promise<ReadonlySet<string>>;
  }>,
): EditorialReferencesPort {
  return {
    async usableImage(assetId) {
      return (await (await storage()).servableImages([assetId])).has(assetId);
    },
    validContributors: (ids) => owner.validPeople(ids),
    validTopics: (ids) => owner.validTopics(ids),
    async validLanguages(codes) {
      const answers = await Promise.all(codes.map((code) => owner.validLanguage(code)));
      return answers.every(Boolean);
    },
    selectableCentre: async () => false,
    selectableGallery: async () => false,
    selectableMembers: async () => false,
  };
}
