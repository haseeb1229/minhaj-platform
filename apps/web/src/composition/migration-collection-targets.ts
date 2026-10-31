import 'server-only';

import {
  collectionPathOf,
  type ArticleDetail,
  type CollectionMember,
  type CollectionMemberKind,
  type EditorialActor,
} from '@minhaj/contracts/editorial';
import type {
  MigrationActor,
  MigrationContentKind,
  MigrationPublicationTargetPort,
  MigrationPublishableKind,
  MigrationTargetRef,
  StagedCollectionPayload,
  StagedPayload,
  TargetPublication,
} from '@minhaj/contracts/migration';

import { editorialFailure } from '../contexts/editorial/index.ts';
import type { EditorialOperations } from './migration-editorial-targets.ts';
import {
  ADOPTION_PAGES,
  askerOf,
  publishing,
  refusal,
  withdrawalRefusal,
  withdrawing,
} from './migration-target-support.ts';

/**
 * The `editorial.collection` publication target — Layer 4 (Phase 30-RD;
 * MIGRATION_STRATEGY.md §17).
 *
 * A SOURCE'S OWN CURATED ARCHIVE, AS AN EDITORIAL COLLECTION, THROUGH
 * EDITORIAL'S PUBLIC SERVICE AND ITS OWN WORKFLOW. The Collection is CREATED
 * (`content.author`) and SUBMITTED for review; Editorial refuses
 * self-approval, so it becomes public only when a different person approves
 * and publishes it.
 *
 * MEMBERS ONLY THROUGH MIGRATION'S OWN MAPPINGS, NEVER A GUESS. Each member's
 * legacy URL resolves through an ACTIVE legacy mapping (`resolve`) to the
 * exact typed record migration published — never a title match — and only a
 * type a Collection may hold (Article, News article, Press release, Work,
 * Video) is a member. One member without a mapping, or of another type,
 * refuses the whole Collection: an archive is published exactly or not at
 * all. Editorial then asks each member's OWNER whether it is public now — the
 * same question a curator's Collection meets — so a draft, archived or
 * review-only record can never become a member.
 *
 * SOURCE WORDS ONLY. The title and the description are the source's; the
 * description is the Collection's standfirst, and its introduction is left
 * empty rather than written for it. No image, contributor or topic is
 * invented; topics are only those a person confirmed for the source.
 *
 * REFRESH is an author's revision through Editorial's workflow — the
 * source's words and member list in its order, everything a person curated
 * otherwise kept — then a submission, so it is in review again until a
 * different person approves and publishes it. Withdrawal is Editorial's
 * `archive` at the recorded version.
 *
 * NODE-RUNNABLE: packages and explicit `.ts` paths only — never the `@/` alias.
 */

/** The migrated kinds a Collection may hold, and what Editorial calls each. */
const MEMBER_KINDS: Partial<Record<MigrationPublishableKind, CollectionMemberKind>> =
  Object.freeze({
    'editorial.article': 'article',
    'editorial.news': 'news-article',
    'editorial.press-release': 'press-release',
    'library.work': 'work',
    'media.video': 'video',
  });

/** Editorial's administrative directory page size. */
const DIRECTORY_PAGE = 25;

/** An introduction left empty: one empty paragraph, the smallest valid document. */
const EMPTY_DOCUMENT = JSON.stringify({ type: 'doc', content: [{ type: 'paragraph' }] });

const ask = askerOf(editorialFailure);
const asEditorial = (actor: MigrationActor): EditorialActor => ({
  accountId: actor.accountId,
});

type Resolve = (legacyUrl: string) => Promise<MigrationTargetRef | null>;

/** Every member as Editorial's typed reference, in the source's order — or why not. */
async function membersOf(
  payload: StagedCollectionPayload,
  resolve: Resolve,
): Promise<{ readonly members: CollectionMember[] } | { readonly refused: string }> {
  const members: CollectionMember[] = [];
  for (const member of payload.members) {
    const target = await resolve(member.legacyUrl);
    if (target === null) return { refused: 'member-unmapped' };
    const kind = MEMBER_KINDS[target.kind];
    if (kind === undefined) return { refused: 'member-kind-refused' };
    members.push({ kind, id: target.id });
  }
  return { members };
}

function sameMembers(
  held: readonly CollectionMember[] | undefined,
  wanted: readonly CollectionMember[],
): boolean {
  return (
    held !== undefined &&
    held.length === wanted.length &&
    held.every(
      (member, index) =>
        member.kind === wanted[index]?.kind && member.id === wanted[index]?.id,
    )
  );
}

/** Whether the Collection Editorial holds already says exactly what is wanted. */
function sameCollection(
  record: ArticleDetail,
  payload: StagedCollectionPayload,
  members: readonly CollectionMember[],
  alone: boolean,
): boolean {
  const { revision } = record;
  const translation = revision.translations.find(
    (entry) => entry.languageCode === payload.languageCode,
  );
  return (
    translation !== undefined &&
    (!alone ||
      (record.slug === payload.slug &&
        revision.translations.length === 1 &&
        revision.primaryLanguage === payload.languageCode)) &&
    translation.title === payload.title.trim() &&
    translation.excerpt === payload.excerpt.trim() &&
    sameMembers(revision.members, members)
  );
}

export function editorialCollectionTargetOver(deps: {
  readonly editorial: EditorialOperations;
}): MigrationPublicationTargetPort {
  const { editorial } = deps;
  const supports = (kind: MigrationContentKind) => kind === 'editorial.collection';
  const ownPayload = (payload: StagedPayload): payload is StagedCollectionPayload =>
    payload.kind === 'editorial.collection';

  function stageOf(
    record: ArticleDetail,
    stage: 'in-review' | 'public',
  ): TargetPublication {
    return {
      status: 'published',
      target: { kind: 'editorial.collection', id: record.id },
      stage,
      version: record.version,
      canonicalPath: collectionPathOf(record.slug),
    };
  }

  async function submit(
    actor: EditorialActor,
    record: ArticleDetail,
  ): Promise<TargetPublication> {
    const submitted = await ask(() =>
      editorial.transition(actor, 'collection', {
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

  /** The Collection an interrupted publication made, when it is exactly this payload's. */
  async function adopt(
    actor: EditorialActor,
    payload: StagedCollectionPayload,
    members: readonly CollectionMember[],
  ): Promise<TargetPublication> {
    for (let page = 0; page < ADOPTION_PAGES; page += 1) {
      const listing = await ask(() =>
        editorial.directory(actor, 'collection', page * DIRECTORY_PAGE, null),
      );
      if (!listing.ok) return refusal(listing.reason);
      const item = listing.value.items.find((entry) => entry.slug === payload.slug);
      if (item !== undefined) {
        const found = await ask(() => editorial.detail(actor, 'collection', item.id));
        if (!found.ok) return refusal('target-conflict');
        const record = found.value;
        if (!sameCollection(record, payload, members, true))
          return refusal('target-conflict');
        if (record.state === 'in-review') return stageOf(record, 'in-review');
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

    async publish({ kind, payload, topicIds, resolve, actor, resumed }) {
      if (!supports(kind) || !ownPayload(payload)) return refusal('unsupported-kind');
      const editorialActor = asEditorial(actor);
      return publishing(async () => {
        const resolved = await membersOf(payload, resolve);
        if ('refused' in resolved) return refusal(resolved.refused);
        const created = await ask(() =>
          editorial.create(editorialActor, 'collection', {
            slug: payload.slug,
            primaryLanguage: payload.languageCode,
            translations: [
              {
                languageCode: payload.languageCode,
                title: payload.title,
                excerpt: payload.excerpt,
                seoTitle: '',
                seoDescription: '',
                document: EMPTY_DOCUMENT,
              },
            ],
            topicIds: [...topicIds],
            contributors: [],
            members: resolved.members,
          }),
        );
        if (created.ok) return submit(editorialActor, created.value);
        if (created.reason !== 'duplicate-slug') return refusal(created.reason);
        return resumed
          ? adopt(editorialActor, payload, resolved.members)
          : refusal('target-exists');
      });
    },

    async refresh({ kind, target, payload, resolve, actor }) {
      if (!supports(kind) || !ownPayload(payload) || target.kind !== kind)
        return refusal('unsupported-kind');
      const editorialActor = asEditorial(actor);
      return publishing(async () => {
        const resolved = await membersOf(payload, resolve);
        if ('refused' in resolved) return refusal(resolved.refused);
        const found = await ask(() =>
          editorial.detail(editorialActor, 'collection', target.id),
        );
        if (!found.ok) return refusal(found.reason);
        const record = found.value;
        if (record.state === 'archived') return refusal('target-archived');
        if (sameCollection(record, payload, resolved.members, false)) {
          if (record.state === 'published') return stageOf(record, 'public');
          if (record.state === 'in-review') return stageOf(record, 'in-review');
        }
        if (record.state === 'scheduled') return refusal('target-scheduled');
        const current = record.revision;
        const held = current.translations.find(
          (entry) => entry.languageCode === payload.languageCode,
        );
        const revised = await ask(() =>
          editorial.revise(editorialActor, 'collection', record.id, record.version, {
            slug: record.slug,
            primaryLanguage: current.primaryLanguage,
            translations: [
              ...current.translations
                .filter((entry) => entry.languageCode !== payload.languageCode)
                .map((entry) => ({
                  languageCode: entry.languageCode,
                  title: entry.title,
                  excerpt: entry.excerpt,
                  seoTitle: entry.seoTitle,
                  seoDescription: entry.seoDescription,
                  document: entry.document,
                })),
              {
                languageCode: payload.languageCode,
                title: payload.title,
                excerpt: payload.excerpt,
                seoTitle: held?.seoTitle ?? '',
                seoDescription: held?.seoDescription ?? '',
                document: held?.document ?? EMPTY_DOCUMENT,
              },
            ],
            topicIds: [...current.topicIds],
            contributors: current.contributors.map((entry) => ({
              personId: entry.personId,
              role: entry.role,
            })),
            members: resolved.members,
          }),
        );
        if (!revised.ok) return refusal(revised.reason);
        return submit(editorialActor, revised.value);
      });
    },

    async inspect({ target, actor }) {
      if (!supports(target.kind)) return null;
      let record: ArticleDetail;
      try {
        record = await editorial.detail(asEditorial(actor), 'collection', target.id);
      } catch (error) {
        if (editorialFailure(error) === 'not-found')
          return { exists: false, version: 0, referencedByPeople: false };
        throw error;
      }
      // Nothing personal names a Collection.
      return { exists: true, version: record.version, referencedByPeople: false };
    },

    async withdraw({ target, expectedVersion, actor }) {
      if (!supports(target.kind)) return withdrawalRefusal('unsupported-kind');
      return withdrawing(async () => {
        const archived = await ask(() =>
          editorial.transition(asEditorial(actor), 'collection', {
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
