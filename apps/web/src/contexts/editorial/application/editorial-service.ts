import 'server-only';
import { z } from 'zod';
import {
  editorialContentSchema,
  editorialIdSchema,
  editorialKindSchema,
  editorialStateSchema,
  workflowCommandSchema,
  validPageBinding,
  type EditorialActor,
  type EditorialAuthorityPort,
  type EditorialReferencesPort,
  type EditorialPersistencePort,
  type EditorialKind,
  type SafeEditorialContent,
} from '@minhaj/contracts/editorial';
import {
  assertTransition,
  EditorialRefusal,
  workflowPermission,
} from '../domain/workflow.ts';
import { renderEditorialDocument } from './rich-text.ts';

export function createEditorialService(dependencies: {
  persistence: EditorialPersistencePort;
  authority: EditorialAuthorityPort;
  references: EditorialReferencesPort;
  reportFailure: (operation: string) => void;
  now?: () => Date;
}) {
  const { persistence: store, authority, references } = dependencies;
  const now = dependencies.now ?? (() => new Date());
  async function requirePermission(actor: EditorialActor, permission: string) {
    if (!actor?.accountId || !(await authority.permits(actor.accountId, permission)))
      throw new EditorialRefusal('denied');
  }
  async function contentOf(value: unknown): Promise<SafeEditorialContent> {
    const result = editorialContentSchema.safeParse(value);
    if (!result.success) throw new EditorialRefusal('invalid');
    const content = result.data;
    const valid = await Promise.all([
      references.validTopics(content.topicIds),
      references.validContributors(content.contributors.map((entry) => entry.personId)),
      references.validLanguages(content.translations.map((entry) => entry.languageCode)),
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
  async function detail(kind: EditorialKind, id: string) {
    const record = await (kind === 'article' ? store.article(id) : store.page(id));
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
      return editorialKindSchema.parse(kind) === 'article'
        ? store.articles(query)
        : store.pages(query);
    },
    async detail(actor: EditorialActor, kind: EditorialKind, id: string) {
      await requirePermission(actor, 'content.read');
      return detail(editorialKindSchema.parse(kind), editorialIdSchema.parse(id));
    },
    async revisions(actor: EditorialActor, kind: EditorialKind, id: string, offset = 0) {
      await requirePermission(actor, 'content.read');
      editorialIdSchema.parse(id);
      z.number().int().min(0).max(10_000_000).parse(offset);
      return editorialKindSchema.parse(kind) === 'article'
        ? store.articleRevisions(id, offset)
        : store.pageRevisions(id, offset);
    },
    async create(
      actor: EditorialActor,
      kind: EditorialKind,
      value: unknown,
      routeBinding: string | null = null,
    ) {
      await requirePermission(actor, 'content.author');
      editorialKindSchema.parse(kind);
      const content = await contentOf(value);
      if (kind === 'page') {
        if (routeBinding === null || !validPageBinding(routeBinding, content.slug))
          throw new EditorialRefusal('invalid');
        return store.createPage({ actorId: actor.accountId, content, routeBinding });
      }
      return store.createArticle({ actorId: actor.accountId, content });
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
      const content = await contentOf(value);
      if (kind === 'page') {
        const page = await store.page(id);
        if (!page || !validPageBinding(page.routeBinding, content.slug))
          throw new EditorialRefusal('invalid');
        return store.revisePage({
          actorId: actor.accountId,
          id,
          expectedVersion,
          content,
        });
      }
      return store.reviseArticle({
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
      const input = {
        ...command,
        actorId: actor.accountId,
        now: now(),
        scheduledExecution,
      };
      return kind === 'article'
        ? store.transitionArticle(input)
        : store.transitionPage(input);
    },
    async runDue() {
      const at = now();
      const groups = [
        { kind: 'article' as const, records: await store.dueArticles(at, 25) },
        { kind: 'page' as const, records: await store.duePages(at, 25) },
      ];
      let published = 0;
      for (const { kind, records } of groups)
        for (const record of records) {
          try {
            if (
              !record.scheduledById ||
              !record.approvedById ||
              !(await authority.permits(record.scheduledById, 'content.publish')) ||
              !(await authority.permits(record.approvedById, 'content.review'))
            ) {
              if (kind === 'article')
                await store.failArticleSchedule(
                  record.id,
                  record.version,
                  'authority-revoked',
                );
              else
                await store.failPageSchedule(
                  record.id,
                  record.version,
                  'authority-revoked',
                );
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
            if (kind === 'article')
              await store.failArticleSchedule(
                record.id,
                record.version,
                'execution-failed',
              );
            else
              await store.failPageSchedule(record.id, record.version, 'execution-failed');
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
