import 'server-only';

import type {
  CollectionMember,
  CollectionMemberKind,
  CollectionMemberTarget,
} from '@minhaj/contracts/editorial';

import {
  referencesOf,
  resolveMembersThrough,
  type CollectionMemberOwners,
  type ResolvedMembers,
} from './collection-member-owners';

import { editorialReadRuntime } from './editorial-read';
import { libraryReadRuntime } from './library-read';
import { mediaReadRuntime } from './media-read';

/**
 * A Collection's members, resolved by their OWNERS — Layer 4, and session-free
 * (DOMAIN_MODEL.md §3.3).
 *
 * A Collection names its members by typed identifier. What each is called and
 * where it lives is its owner's answer NOW: Editorial's published predicate for
 * Articles and the four News families, Library's public predicate for Works
 * (Editorial → Library) and Media's for Videos (Editorial → Media). A member its
 * owner does not publish now is simply absent from the answer, so no title,
 * excerpt or address of a draft, archived or withdrawn record can ever reach a
 * Collection page.
 *
 * BATCHED BY OWNER, NEVER PER MEMBER. The members are grouped by type and each
 * owner is asked once — Editorial's own types in one bounded read per type — so
 * a hundred-member Collection costs at most seven bounded reads, run together.
 *
 * ONE OWNER FAILING DEGRADES ONLY ITS OWN MEMBERS. Each owner's read is caught
 * separately and its member types reported as unavailable; nothing is
 * invented, mutated or revealed, and the other owners' members still resolve.
 *
 * IT REACHES THE PUBLIC READ RUNTIMES ONLY, so no anonymous page importing it
 * acquires a session, the identity service or the authentication library
 * (ARCHITECTURE.md §8.1).
 */

/** The owners' public read runtimes this process holds. */
const owners: CollectionMemberOwners = {
  memberTargets: (members) => editorialReadRuntime().memberTargets(members),
  workReferences: (ids) => libraryReadRuntime().workReferences(ids),
  videoReferences: (ids) => mediaReadRuntime().videoReferences(ids),
};

export type { ResolvedMembers };

/**
 * Every currently public member among these, by its owner. With `strict`, an
 * owner that cannot be asked is an error rather than a degraded group — the
 * form a WRITE needs, where "could not ask" must never read as "may not".
 */
export function resolveCollectionMembers(
  members: readonly CollectionMember[],
  options: { readonly strict?: boolean } = {},
): Promise<ResolvedMembers> {
  return resolveMembersThrough(owners, members, options);
}

/**
 * Up to a bounded handful of public records of every member type an editor may
 * add, narrowed by `query`, each type from its owner. Invoked only after the
 * editor's permission check; public records only, so nothing private is offered.
 */
export async function collectionMemberChoices(query: string): Promise<
  readonly {
    readonly kind: CollectionMemberKind;
    readonly target: CollectionMemberTarget;
  }[]
> {
  const text = query.trim() === '' ? null : query;
  const editorialKinds = [
    'article',
    'news-article',
    'press-release',
    'statement',
    'media-coverage',
  ] as const;
  const [editorial, works, videos] = await Promise.all([
    Promise.all(
      editorialKinds.map(async (kind) =>
        (await editorialReadRuntime().memberChoices(kind, text)).map((target) => ({
          kind,
          target,
        })),
      ),
    ),
    libraryReadRuntime().workChoices(text),
    mediaReadRuntime().videoChoices(text),
  ]);
  return [
    ...editorial.flat(),
    ...referencesOf('work', works).map(([, target]) => ({
      kind: 'work' as const,
      target,
    })),
    ...referencesOf('video', videos).map(([, target]) => ({
      kind: 'video' as const,
      target,
    })),
  ];
}
