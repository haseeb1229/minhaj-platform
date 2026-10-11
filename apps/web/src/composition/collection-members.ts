import 'server-only';

import {
  isEditorialMemberKind,
  memberToken,
  type CollectionMember,
  type CollectionMemberKind,
  type CollectionMemberTarget,
} from '@minhaj/contracts/editorial';

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

export interface ResolvedMembers {
  /** The public targets, keyed `kind:id`. */
  readonly targets: ReadonlyMap<string, CollectionMemberTarget>;
  /** Member types whose owner could not be asked just now. */
  readonly unavailable: ReadonlySet<CollectionMemberKind>;
}

function referencesOf(
  kind: 'work' | 'video',
  rows: readonly {
    readonly id: string;
    readonly slug: string;
    readonly labels: readonly { readonly locale: string; readonly title: string }[];
  }[],
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
 * owner that cannot be asked is an error rather than a degraded group — the
 * form a WRITE needs, where "could not ask" must never read as "may not".
 */
export async function resolveCollectionMembers(
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
          ...(await editorialReadRuntime().memberTargets(editorial)),
        ]),
    works.length === 0
      ? Promise.resolve([])
      : guarded(['work'], async () =>
          referencesOf('work', await libraryReadRuntime().workReferences(works)),
        ),
    videos.length === 0
      ? Promise.resolve([])
      : guarded(['video'], async () =>
          referencesOf('video', await mediaReadRuntime().videoReferences(videos)),
        ),
  ]);
  return { targets: new Map(found.flat()), unavailable };
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
