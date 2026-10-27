import 'server-only';

import {
  newsPathOf,
  type ArticleDetail,
  type EditorialActor,
  type EditorialReferencesPort,
} from '@minhaj/contracts/editorial';
import type { LibraryReferencesPort } from '@minhaj/contracts/library';
import type {
  MigrationActor,
  MigrationContentKind,
  MigrationPublicationTargetPort,
  StagedBlock,
  StagedEditorialPayload,
  StagedInline,
  TargetPublication,
} from '@minhaj/contracts/migration';

import { editorialFailure, type EditorialService } from '../contexts/editorial/index.ts';
import {
  ADOPTION_PAGES,
  askerOf,
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
 * NOTHING IS SMUGGLED. Editorial has no field for the source's original
 * publication date, so `publishedOn` stays migration provenance (shown to
 * reviewers) and goes nowhere here. No contributor, Centre or SEO text is
 * invented; the excerpt is the source's, possibly empty, as Editorial allows.
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
  'create' | 'transition' | 'directory' | 'detail'
>;

/** Personalisation's one-bit answer about an Article. */
export interface ArticleHoldings {
  articleHeld(articleId: string): Promise<boolean>;
}

type EditorialFamily = 'editorial.news' | 'editorial.article';

/** Each migration kind's Editorial aggregate and locale-free canonical path. */
const FAMILIES = {
  'editorial.news': {
    aggregate: 'news-article',
    path: (slug: string) => newsPathOf('news-article', slug),
  },
  'editorial.article': {
    aggregate: 'article',
    path: (slug: string) => `/library/articles/${slug}`,
  },
} as const satisfies Record<EditorialFamily, unknown>;

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
 * The targets
 * ========================================================================= */

/** The staged record as Editorial's own content input for its aggregate. */
function contentInput(
  family: EditorialFamily,
  payload: StagedEditorialPayload,
  topicIds: readonly string[],
  document: string,
) {
  const content = {
    slug: payload.slug,
    primaryLanguage: payload.languageCode,
    translations: [
      {
        languageCode: payload.languageCode,
        title: payload.title,
        excerpt: payload.excerpt,
        seoTitle: '',
        seoDescription: '',
        document,
      },
    ],
    topicIds: [...topicIds],
    contributors: [],
  };
  // A NewsArticle may name a Centre; a migrated one names none.
  return family === 'editorial.news' ? { ...content, centreId: null } : content;
}

/** Whether a record Editorial holds is exactly this payload's. */
function sameRecord(
  record: ArticleDetail,
  payload: StagedEditorialPayload,
  document: string,
): boolean {
  const { revision } = record;
  const [translation, ...more] = revision.translations;
  return (
    record.slug === payload.slug &&
    revision.primaryLanguage === payload.languageCode &&
    translation !== undefined &&
    more.length === 0 &&
    translation.languageCode === payload.languageCode &&
    translation.title === payload.title.trim() &&
    translation.excerpt === payload.excerpt.trim() &&
    sameDocument(translation.document, document)
  );
}

/** A publication target for one Editorial family over Editorial's operations. */
export function editorialTargetOver(deps: {
  readonly kind: EditorialFamily;
  readonly editorial: EditorialOperations;
  readonly holdings: ArticleHoldings;
}): MigrationPublicationTargetPort {
  const { editorial, kind: family } = deps;
  const { aggregate, path } = FAMILIES[family];
  const supports = (kind: MigrationContentKind) => kind === family;

  function inReview(record: ArticleDetail): TargetPublication {
    return {
      status: 'published',
      target: { kind: family, id: record.id },
      stage: 'in-review',
      version: record.version,
      canonicalPath: path(record.slug),
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
    return submitted.ok ? inReview(submitted.value) : refusal(submitted.reason);
  }

  /** The record an interrupted publication made, when it is exactly this payload's. */
  async function adopt(
    actor: EditorialActor,
    payload: StagedEditorialPayload,
    document: string,
  ): Promise<TargetPublication> {
    for (let page = 0; page < ADOPTION_PAGES; page += 1) {
      const listing = await ask(() =>
        editorial.directory(actor, aggregate, page * DIRECTORY_PAGE, null),
      );
      if (!listing.ok) return refusal(listing.reason);
      const match = listing.value.items.find((item) => item.slug === payload.slug);
      if (match !== undefined) {
        const found = await ask(() => editorial.detail(actor, aggregate, match.id));
        if (!found.ok) return refusal(found.reason);
        const record = found.value;
        if (!sameRecord(record, payload, document)) return refusal('target-conflict');
        if (record.state === 'in-review') return inReview(record);
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

    async publish({ kind, payload, topicIds, actor, resumed }) {
      if (!supports(kind) || payload.kind !== family) return refusal('unsupported-kind');
      const editorialActor = asEditorial(actor);
      const document = editorialDocument(payload.body);
      return publishing(async () => {
        const created = await ask(() =>
          editorial.create(
            editorialActor,
            aggregate,
            contentInput(family, payload, topicIds, document),
          ),
        );
        if (created.ok) return submit(editorialActor, created.value);
        if (created.reason !== 'duplicate-slug') return refusal(created.reason);
        // Adoption is for an interrupted publication of THIS entry only.
        return resumed
          ? adopt(editorialActor, payload, document)
          : refusal('target-exists');
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
        // Nothing personal can name a NewsArticle.
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
 * should one ever be asked, the record is refused rather than linked.
 */
export function migrationEditorialReferences(
  owner: LibraryReferencesPort,
): EditorialReferencesPort {
  return {
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
