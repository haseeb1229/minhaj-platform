import 'server-only';
import { z } from 'zod';
import {
  EVENT_SCHEDULE_REFUSALS,
  editorialContentSchemaFor,
  eventScheduleRefusalOf,
  editorialIdSchema,
  editorialKindSchema,
  editorialStateSchema,
  isNewsKind,
  workflowCommandSchema,
  validPageBinding,
  type ArticleDetail,
  type EditorialActor,
  type EditorialAuthorityPort,
  type EditorialDirectory,
  type EditorialEdit,
  type EditorialQuery,
  type EditorialReferencesPort,
  type EditorialPersistencePort,
  type EditorialKind,
  type EditorialScheduleCandidate,
  type EditorialTransition,
  type EditorialWrite,
  type EventScheduleRefusal,
  type RevisionDirectory,
  type SafeEditorialContent,
  type CollectionMember,
} from '@minhaj/contracts/editorial';
import {
  assertTransition,
  EditorialRefusal,
  workflowPermission,
} from '../domain/workflow.ts';
import { renderEditorialDocument } from './rich-text.ts';

/** The persistence operations of ONE aggregate, whatever its tables. */
interface KindOperations {
  detail(id: string): Promise<ArticleDetail | null>;
  directory(query: EditorialQuery): Promise<EditorialDirectory>;
  revisions(id: string, offset: number): Promise<RevisionDirectory>;
  revise(input: EditorialEdit): Promise<ArticleDetail>;
  transition(input: EditorialTransition): Promise<ArticleDetail>;
  due(now: Date, limit: number): Promise<readonly EditorialScheduleCandidate[]>;
  fail(
    id: string,
    expectedVersion: number,
    reason: 'authority-revoked' | 'execution-failed',
  ): Promise<void>;
}

/**
 * At most this many due records of EACH kind are executed per sweep: eight
 * kinds, so a sweep's total work stays bounded at 200 and the remainder is
 * caught up by the next one.
 */
const DUE_PER_KIND = 25;

/** References a re-save may keep although their owner would no longer offer them. */
interface Kept {
  readonly centreId: string | null;
  readonly galleryIds: readonly string[];
  readonly members: readonly CollectionMember[];
}
const NOTHING_KEPT: Kept = Object.freeze({ centreId: null, galleryIds: [], members: [] });

export function createEditorialService(dependencies: {
  persistence: EditorialPersistencePort;
  authority: EditorialAuthorityPort;
  references: EditorialReferencesPort;
  reportFailure: (operation: string) => void;
  now?: () => Date;
}) {
  const { persistence: store, authority, references } = dependencies;
  const now = dependencies.now ?? (() => new Date());

  /** One table of dispatch, so no branch can route a kind to another's tables. */
  function operations(kind: EditorialKind): KindOperations {
    if (kind === 'article')
      return {
        detail: (id) => store.article(id),
        directory: (query) => store.articles(query),
        revisions: (id, offset) => store.articleRevisions(id, offset),
        revise: (input) => store.reviseArticle(input),
        transition: (input) => store.transitionArticle(input),
        due: (at, limit) => store.dueArticles(at, limit),
        fail: (id, version, reason) => store.failArticleSchedule(id, version, reason),
      };
    if (kind === 'page')
      return {
        detail: (id) => store.page(id),
        directory: (query) => store.pages(query),
        revisions: (id, offset) => store.pageRevisions(id, offset),
        revise: (input) => store.revisePage(input),
        transition: (input) => store.transitionPage(input),
        due: (at, limit) => store.duePages(at, limit),
        fail: (id, version, reason) => store.failPageSchedule(id, version, reason),
      };
    if (kind === 'collection')
      return {
        detail: (id) => store.collection(id),
        directory: (query) => store.collectionDirectory(query),
        revisions: (id, offset) => store.collectionRevisions(id, offset),
        revise: (input) => store.reviseCollection(input),
        transition: (input) => store.transitionCollection(input),
        due: (at, limit) => store.dueCollections(at, limit),
        fail: (id, version, reason) => store.failCollectionSchedule(id, version, reason),
      };
    if (kind === 'event')
      return {
        detail: (id) => store.event(id),
        directory: (query) => store.eventDirectory(query),
        revisions: (id, offset) => store.eventRevisions(id, offset),
        revise: (input) => store.reviseEvent(input),
        transition: (input) => store.transitionEvent(input),
        due: (at, limit) => store.dueEvents(at, limit),
        fail: (id, version, reason) => store.failEventSchedule(id, version, reason),
      };
    if (!isNewsKind(kind)) throw new EditorialRefusal('invalid');
    return {
      detail: (id) => store.news(kind, id),
      directory: (query) => store.newsDirectory(kind, query),
      revisions: (id, offset) => store.newsRevisions(kind, id, offset),
      revise: (input) => store.reviseNews(kind, input),
      transition: (input) => store.transitionNews(kind, input),
      due: (at, limit) => store.dueNews(kind, at, limit),
      fail: (id, version, reason) => store.failNewsSchedule(kind, id, version, reason),
    };
  }

  async function requirePermission(actor: EditorialActor, permission: string) {
    if (!actor?.accountId || !(await authority.permits(actor.accountId, permission)))
      throw new EditorialRefusal('denied');
  }
  /**
   * One aggregate's content, parsed and with every reference asked of its owner.
   *
   * A NewsArticle's or an Event's Centre (Phases 16 and 14) must be one Global
   * would offer an editor NOW — it exists and is not archived — unless it is the
   * Centre the current revision already names (`kept.centreId`): re-saving an
   * article about a Centre that has since closed keeps that true attribution
   * rather than forcing an editor to erase it. An Event's Galleries follow the
   * same rule against Media (Phase 14): a newly associated Gallery must be one
   * Media would offer now; one the current revision already associates is kept.
   *
   * A Collection's members follow it too (Phase 15), each asked of its OWNER in
   * one grouped read: a newly added member must be public now — Editorial's own
   * published Article or News record, Library's public Work, Media's published
   * Video — so an author never learns of, or links, another owner's draft. A
   * member the current revision already holds is kept, whatever its owner
   * says of it now, so withdrawing one target never forces an editor to erase
   * a Collection's history to change its words.
   *
   * A SCHEDULE THAT CANNOT BE STORED SAYS WHY. A local time a daylight-saving
   * change skips or repeats, an end not after its start, or one occurrence
   * written twice is refused with that reason, never as a generic one.
   */
  async function contentOf(
    kind: EditorialKind,
    value: unknown,
    kept: Kept = NOTHING_KEPT,
  ): Promise<SafeEditorialContent> {
    const result = editorialContentSchemaFor(kind).safeParse(value);
    if (!result.success) {
      const refusal = kind === 'event' ? eventScheduleRefusalOf(result.error) : null;
      throw new EditorialRefusal(
        refusal === null ? 'invalid' : (refusal as EventScheduleRefusal),
      );
    }
    const content = result.data;
    const centreId = content.centreId ?? null;
    const newGalleries = (content.galleryIds ?? []).filter(
      (id) => !kept.galleryIds.includes(id),
    );
    const keptMembers = new Set(kept.members.map((m) => `${m.kind}:${m.id}`));
    const newMembers = (content.members ?? []).filter(
      (m) => !keptMembers.has(`${m.kind}:${m.id}`),
    );
    const valid = await Promise.all([
      references.validTopics(content.topicIds),
      references.validContributors(content.contributors.map((entry) => entry.personId)),
      references.validLanguages(content.translations.map((entry) => entry.languageCode)),
      centreId === null || centreId === kept.centreId
        ? Promise.resolve(true)
        : references.selectableCentre(centreId),
      ...newGalleries.map((id) => references.selectableGallery(id)),
      newMembers.length === 0
        ? Promise.resolve(true)
        : references.selectableMembers(newMembers),
    ]);
    if (valid.some((value) => !value)) throw new EditorialRefusal('invalid');
    return {
      ...content,
      translations: content.translations.map((entry) => ({
        ...entry,
        ...renderEditorialDocument(entry.document),
      })),
    };
  }
  /** What the current revision already names, which a re-save may keep. */
  async function keptOf(kind: EditorialKind, id: string): Promise<Kept> {
    if (kind === 'collection') {
      const record = await store.collection(id);
      return { ...NOTHING_KEPT, members: record?.revision.members ?? [] };
    }
    if (kind !== 'news-article' && kind !== 'event') return NOTHING_KEPT;
    const record = kind === 'event' ? await store.event(id) : await store.news(kind, id);
    return {
      centreId: record?.revision.centreId ?? null,
      galleryIds: record?.revision.galleryIds ?? [],
      members: [],
    };
  }
  async function detail(kind: EditorialKind, id: string) {
    const record = await operations(kind).detail(id);
    if (!record) throw new EditorialRefusal('not-found');
    return record;
  }
  const service = {
    async directory(
      actor: EditorialActor,
      kind: EditorialKind,
      offset = 0,
      state: unknown = null,
    ) {
      await requirePermission(actor, 'content.read');
      const query = {
        offset: z.number().int().min(0).max(10_000_000).parse(offset),
        limit: 25,
        state: editorialStateSchema.nullable().parse(state),
      };
      return operations(editorialKindSchema.parse(kind)).directory(query);
    },
    async detail(actor: EditorialActor, kind: EditorialKind, id: string) {
      await requirePermission(actor, 'content.read');
      return detail(editorialKindSchema.parse(kind), editorialIdSchema.parse(id));
    },
    async revisions(actor: EditorialActor, kind: EditorialKind, id: string, offset = 0) {
      await requirePermission(actor, 'content.read');
      editorialIdSchema.parse(id);
      z.number().int().min(0).max(10_000_000).parse(offset);
      return operations(editorialKindSchema.parse(kind)).revisions(id, offset);
    },
    async create(
      actor: EditorialActor,
      kind: EditorialKind,
      value: unknown,
      routeBinding: string | null = null,
    ) {
      await requirePermission(actor, 'content.author');
      editorialKindSchema.parse(kind);
      const content = await contentOf(kind, value);
      const input: EditorialWrite = { actorId: actor.accountId, content };
      if (kind === 'page') {
        if (routeBinding === null || !validPageBinding(routeBinding, content.slug))
          throw new EditorialRefusal('invalid');
        return store.createPage({ ...input, routeBinding });
      }
      if (routeBinding !== null) throw new EditorialRefusal('invalid');
      if (kind === 'article') return store.createArticle(input);
      if (kind === 'event') return store.createEvent(input);
      if (kind === 'collection') return store.createCollection(input);
      if (!isNewsKind(kind)) throw new EditorialRefusal('invalid');
      return store.createNews(kind, input);
    },
    async revise(
      actor: EditorialActor,
      kind: EditorialKind,
      id: string,
      expectedVersion: number,
      value: unknown,
    ) {
      await requirePermission(actor, 'content.author');
      editorialKindSchema.parse(kind);
      editorialIdSchema.parse(id);
      z.number().int().positive().parse(expectedVersion);
      const content = await contentOf(kind, value, await keptOf(kind, id));
      if (kind === 'page') {
        const page = await store.page(id);
        if (!page || !validPageBinding(page.routeBinding, content.slug))
          throw new EditorialRefusal('invalid');
      }
      return operations(kind).revise({
        actorId: actor.accountId,
        id,
        expectedVersion,
        content,
      });
    },
    async transition(
      actor: EditorialActor,
      kind: EditorialKind,
      value: unknown,
      scheduledExecution = false,
    ) {
      const parsed = workflowCommandSchema.safeParse(value);
      if (!parsed.success) throw new EditorialRefusal('invalid');
      const command = parsed.data;
      editorialKindSchema.parse(kind);
      await requirePermission(actor, workflowPermission(command.action));
      const record = await detail(kind, command.id);
      if (record.version !== command.expectedVersion)
        throw new EditorialRefusal('conflict');
      assertTransition(record, command.action, actor.accountId);
      if (command.action === 'schedule') {
        if (
          !command.scheduledAt ||
          !command.timezone ||
          new Date(command.scheduledAt) <= now()
        )
          throw new EditorialRefusal('invalid');
        try {
          new Intl.DateTimeFormat('en', { timeZone: command.timezone }).format();
        } catch {
          throw new EditorialRefusal('invalid');
        }
      }
      if (command.action === 'publish' || command.action === 'schedule') {
        if (
          !record.approvedById ||
          !(await authority.permits(record.approvedById, 'content.review'))
        )
          throw new EditorialRefusal('approval-required');
      }
      return operations(kind).transition({
        ...command,
        actorId: actor.accountId,
        now: now(),
        scheduledExecution,
      });
    },
    async runDue() {
      const at = now();
      let published = 0;
      for (const kind of editorialKindSchema.options) {
        const records = await operations(kind).due(at, DUE_PER_KIND);
        for (const record of records) {
          try {
            if (
              !record.scheduledById ||
              !record.approvedById ||
              !(await authority.permits(record.scheduledById, 'content.publish')) ||
              !(await authority.permits(record.approvedById, 'content.review'))
            ) {
              await operations(kind).fail(record.id, record.version, 'authority-revoked');
              continue;
            }
            await service.transition(
              { accountId: record.scheduledById },
              kind,
              {
                id: record.id,
                expectedVersion: record.version,
                action: 'publish',
                scheduledAt: null,
                timezone: null,
              },
              true,
            );
            published += 1;
          } catch (error) {
            const reason = editorialFailure(error);
            // A competing edit/cancel/runner already advanced the expected version.
            if (reason === 'conflict') continue;
            dependencies.reportFailure('scheduled-publication');
            await operations(kind).fail(record.id, record.version, 'execution-failed');
          }
        }
      }
      return published;
    },
  };
  return service;
}
export function editorialFailure(error: unknown): string {
  if (error instanceof z.ZodError) return 'invalid';
  const reason = (error as { reason?: unknown } | null)?.reason;
  return typeof reason === 'string' &&
    [
      ...EVENT_SCHEDULE_REFUSALS,
      'invalid',
      'denied',
      'conflict',
      'not-found',
      'duplicate-slug',
      'invalid-state',
      'self-approval',
      'approval-required',
    ].includes(reason)
    ? reason
    : 'unavailable';
}
export type EditorialService = ReturnType<typeof createEditorialService>;
