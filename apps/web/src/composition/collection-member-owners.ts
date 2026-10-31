import 'server-only';

import {
  isEditorialMemberKind,
  memberToken,
  type CollectionMember,
  type CollectionMemberKind,
  type CollectionMemberTarget,
} from '@minhaj/contracts/editorial';

/**
 * WHO ANSWERS FOR A COLLECTION'S MEMBERS, and how their answers are combined —
 * Layer 4, session-free (DOMAIN_MODEL.md §3.3).
 *
 * Each member type's OWNER says whether it publishes the record now and what
 * it is called: Editorial's published predicate for Articles and the four
 * News families, Library's public predicate for Works (Editorial → Library)
 * and Media's for Videos (Editorial → Media). A member its owner does not
 * publish now is simply absent from the answer.
 *
 * BATCHED BY OWNER, NEVER PER MEMBER, and ONE OWNER FAILING DEGRADES ONLY ITS
 * OWN MEMBERS — unless the answer is for a WRITE (`strict`), where "could not
 * ask" must never read as "may not".
 *
 * NODE-RUNNABLE (Phase 30-RD): the public pages hand it the owners' public
 * read runtimes (`./collection-members.ts`), and migration's Collection target
 * hands it the same public read services, built over the owners' own public
 * readers — so a migrated Collection meets exactly the rule a curator's does.
 * Packages and explicit `.ts` paths only — never the `@/` alias.
 */

/** The owners' public reads, and nothing else of them. */
export interface CollectionMemberOwners {
  memberTargets(
    members: readonly CollectionMember[],
  ): Promise<ReadonlyMap<string, CollectionMemberTarget>>;
  workReferences(ids: readonly string[]): Promise<readonly ReferenceRow[]>;
  videoReferences(ids: readonly string[]): Promise<readonly ReferenceRow[]>;
}

interface ReferenceRow {
  readonly id: string;
  readonly slug: string;
  readonly labels: readonly { readonly locale: string; readonly title: string }[];
}

export interface ResolvedMembers {
  /** The public targets, keyed `kind:id`. */
  readonly targets: ReadonlyMap<string, CollectionMemberTarget>;
  /** Member types whose owner could not be asked just now. */
  readonly unavailable: ReadonlySet<CollectionMemberKind>;
}

export function referencesOf(
  kind: 'work' | 'video',
  rows: readonly ReferenceRow[],
): [string, CollectionMemberTarget][] {
  return rows.map((row) => [
    memberToken({ kind, id: row.id }),
    {
      id: row.id,
      slug: row.slug,
      titles: row.labels.map((label) => ({
        languageCode: label.locale,
        title: label.title,
      })),
    },
  ]);
}

/**
 * Every currently public member among these, by its owner. With `strict`, an
 * owner that cannot be asked is an error rather than a degraded group.
 */
export async function resolveMembersThrough(
  owners: CollectionMemberOwners,
  members: readonly CollectionMember[],
  options: { readonly strict?: boolean } = {},
): Promise<ResolvedMembers> {
  const editorial = members.filter((m) => isEditorialMemberKind(m.kind));
  const works = [...new Set(members.filter((m) => m.kind === 'work').map((m) => m.id))];
  const videos = [...new Set(members.filter((m) => m.kind === 'video').map((m) => m.id))];
  const unavailable = new Set<CollectionMemberKind>();
  const guarded = async (
    kinds: readonly CollectionMemberKind[],
    read: () => Promise<[string, CollectionMemberTarget][]>,
  ): Promise<[string, CollectionMemberTarget][]> => {
    try {
      return await read();
    } catch (error) {
      if (options.strict) throw error;
      // A public route reaches no logger (it would pull the server environment
      // into an anonymous page); the owner's own read path observes it.
      for (const kind of kinds) unavailable.add(kind);
      return [];
    }
  };
  const found = await Promise.all([
    editorial.length === 0
      ? Promise.resolve([])
      : guarded([...new Set(editorial.map((m) => m.kind))], async () => [
          ...(await owners.memberTargets(editorial)),
        ]),
    works.length === 0
      ? Promise.resolve([])
      : guarded(['work'], async () =>
          referencesOf('work', await owners.workReferences(works)),
        ),
    videos.length === 0
      ? Promise.resolve([])
      : guarded(['video'], async () =>
          referencesOf('video', await owners.videoReferences(videos)),
        ),
  ]);
  return { targets: new Map(found.flat()), unavailable };
}

/** Whether EVERY member is public now, asked strictly — the question a write asks. */
export async function allMembersPublic(
  owners: CollectionMemberOwners,
  members: readonly CollectionMember[],
): Promise<boolean> {
  const { targets } = await resolveMembersThrough(owners, members, { strict: true });
  return members.every((member) => targets.has(memberToken(member)));
}
