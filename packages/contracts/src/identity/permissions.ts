/**
 * THE platform permission vocabulary, as the delivered phases have built it.
 *
 * Permissions are the SOLE enforcement path (SECURITY_BASELINE.md §3.1,
 * DOMAIN_MODEL.md §4.4). There is no role-name check, no profile flag and no
 * capability boolean anywhere that decides authority — a `can(user, key)` over
 * this vocabulary is the only question the platform asks.
 *
 * LAYER 0 AND BROWSER-SAFE. Keys and descriptions, no policy and no reach. The
 * interface needs the keys to label a catalogue page; the enforcement that
 * gives them meaning lives in the authorization service.
 *
 * MIGRATION-SEEDED AND RUNTIME-IMMUTABLE. The catalogue below is the source
 * this repository ships; each phase's migration seeds exactly ITS OWN rows, the
 * runtime principal holds SELECT and nothing else on the table, and a test
 * proves the union of the migrations equals this list. A permission that could
 * be created at runtime would be a permission nobody reviewed.
 *
 * APPENDED ONLY BY AN OWNING PHASE. Phase 2 seeded the Identity and system
 * surfaces' vocabulary; Phase 3B appended Taxonomy's two keys with the
 * migration that delivered those surfaces; Phase 4 appended the one read key
 * its navigation status surface needs. `quran.editCanonical`,
 * `fatwa.publish`, `teaching.perform` and the rest are named by
 * DOMAIN_MODEL.md §4.4 as INDICATIVE examples of the shape; they belong to
 * contexts that do not exist yet. Seeding one now would fix another owner's
 * vocabulary before that owner can have an opinion about it, and would leave
 * grantable authority over nothing (DELIVERY_PLAN.md).
 *
 * EXTENDING IT IS A PRIVILEGE CHANGE. The protected Platform Administrator
 * bundle below is the whole catalogue, so appending a key widens what a live
 * administrator may do. The owning phase's migration therefore performs the
 * same invalidation an ordinary bundle change performs — it revokes the
 * holders' sessions and step-up grants in the transaction that extends the
 * bundle (SECURITY_BASELINE.md §8.1).
 */

/**
 * The authority required to change what an account is permitted to do.
 *
 * NAMED BY THE SECURITY BASELINE ITSELF (§3.4 rule 6): "`permissions.grant` is
 * required to change permissions, is never self-applicable, requires step-up
 * reauthentication, and is audited." The key is therefore not this
 * implementation's to choose, and it is not renamed for tidiness.
 */
export const PERMISSION_GRANT = 'permissions.grant';

/** One entry of the immutable catalogue. */
export interface PermissionDefinition {
  /** Stable code. The enforcement vocabulary; never a display string. */
  readonly key: string;
  /** Human-readable, for the read-only catalogue surface. */
  readonly description: string;
}

/**
 * The complete catalogue, in phase order, derived from the administrative
 * surfaces ROUTE_MAP.md §7 assigns to each delivered phase and from the
 * privileged operations SECURITY_BASELINE.md §8.1 lists.
 *
 * READ AND ADMINISTER ARE SEPARATE KEYS, deliberately. Seeing that an account
 * is suspended and suspending one are different authorities, and collapsing
 * them would mean every operator who may look must also be able to act
 * (§4, separation of duties).
 */
export const PERMISSION_CATALOGUE: readonly PermissionDefinition[] = Object.freeze([
  Object.freeze({
    key: 'users.read',
    description: 'View Identity accounts and their status.',
  }),
  Object.freeze({
    key: 'users.administer',
    description: 'Change an account status: disable, suspend or reactivate.',
  }),
  Object.freeze({
    key: 'roles.read',
    description: 'View roles and the permissions bundled into them.',
  }),
  Object.freeze({
    key: 'roles.administer',
    description: 'Create, rename and deactivate custom roles.',
  }),
  Object.freeze({
    key: 'permissions.read',
    description: 'View the permission catalogue.',
  }),
  Object.freeze({
    key: PERMISSION_GRANT,
    description:
      'Change what a role permits and which accounts hold it. Never self-applicable.',
  }),
  Object.freeze({
    key: 'assignments.read',
    description: 'View role assignments and their grant history.',
  }),
  Object.freeze({
    key: 'security.read',
    description: 'View privileged second-factor posture and bootstrap status.',
  }),
  Object.freeze({ key: 'audit.read', description: 'Read the audit record.' }),
  Object.freeze({
    key: 'integrations.read',
    description: 'View outbound email provider configuration and status.',
  }),
  Object.freeze({
    key: 'delivery.read',
    description: 'View pending, failed and suppressed outbound mail.',
  }),
  Object.freeze({
    key: 'delivery.operate',
    description: 'Reschedule or abandon a stuck outbound delivery.',
  }),

  /* ---- Phase 3B — Taxonomy ------------------------------------------- */
  //
  // APPENDED BY THE OWNING PHASE, which is the rule this catalogue is meant to
  // demonstrate rather than merely state. Phase 2 seeded its own vocabulary and
  // stopped; Taxonomy adds exactly the two keys its administrative surfaces
  // need, at the phase that delivers them, and the Phase-3B migration is what
  // puts them in the database. `quran.*`, `fatwa.*`, `learning.*` and the rest
  // still belong to contexts that do not exist.
  //
  // READ AND ADMINISTER, for the same reason the Identity pairs are split:
  // seeing the canonical subject taxonomy and changing it are different
  // authorities, and an editor who must consult topics should not thereby be
  // able to re-parent them (§4, separation of duties).
  //
  // TWO KEYS, NOT FOUR. Topics, content languages and tags are one
  // administrative concern with one owner, and `taxonomy.topics.administer`
  // beside `taxonomy.tags.administer` would be grantable authority nobody asked
  // to separate. A later phase may split them if a real role needs it.
  Object.freeze({
    key: 'taxonomy.read',
    description: 'View canonical topics, content languages and tags.',
  }),
  Object.freeze({
    key: 'taxonomy.administer',
    description:
      'Create and change canonical topics, their translations, content languages and tags.',
  }),

  /* ---- Phase 4 — Public shell ----------------------------------------- */
  //
  // ONE KEY, AND READ ONLY.
  //
  // ROUTE_MAP.md §7 promises `/{locale}/admin/system/navigation` at Phase 4,
  // and every admin route is gated by a permission key rather than by a role
  // name. No existing key means this: `taxonomy.read` is the canonical subject
  // taxonomy, and stretching it to cover the public shell's navigation status
  // would make one grant confer two unrelated authorities.
  //
  // THERE IS DELIBERATELY NO `navigation.administer`. The surface has no
  // mutation to authorise — the shell route registry is code, reviewed as code,
  // and no accepted contract promises an editing screen. A write key added for
  // symmetry would be grantable authority over nothing, and a permission that
  // authorises nothing is a permission nobody can reason about. It arrives with
  // a mutation contract, if one is ever accepted.
  Object.freeze({
    key: 'navigation.read',
    description: 'View the effective public shell navigation and its availability.',
  }),

  /* ---- Phase 5 — People & Contributors -------------------------------- */
  //
  // READ AND ADMINISTER, for the reason every other pair here is split: seeing
  // the contributor directory and changing it are different authorities, and an
  // operator who must look up an author should not thereby be able to publish a
  // contributor record (§4, separation of duties).
  //
  // TWO KEYS, NOT FIVE. ROUTE_MAP.md §7 gives People five administrative routes
  // — persons, authors, speakers, scholars, teachers — and it would have been
  // easy to mint a key apiece. They are five VIEWS of one administrative
  // concern with one owner, and `people.authors.administer` beside
  // `people.teachers.administer` would be grantable authority nobody asked to
  // separate. A later phase may split them if a real role needs it.
  //
  // WHAT IS DELIBERATELY STILL ABSENT, and is most tempting at exactly this
  // phase: `teaching.perform`, `question.receive`, `content.review` and
  // `fatwa.publish`. Phase 5 consumes the capability projections those four
  // codes feed (DOMAIN_MODEL.md §4.5, `./capabilities.ts`), so seeding one
  // would have made a projection test trivial to write. They belong to
  // Learning, Fatwa and Editorial, which have not shipped, and OPEN_DECISIONS.md
  // §6.3 separately reserves who receives them to the organisation. A Phase-5
  // database correctly projects all four as false.
  Object.freeze({
    key: 'people.read',
    description: 'View contributor records and their profiles.',
  }),
  Object.freeze({
    key: 'people.administer',
    description: 'Create, edit, link and archive contributor records and their profiles.',
  }),
  Object.freeze({
    key: 'content.read',
    description: 'Read private Article and Page drafts and revisions.',
  }),
  Object.freeze({
    key: 'content.author',
    description: 'Create and revise Article and Page drafts and submit them for review.',
  }),
  Object.freeze({
    key: 'content.review',
    description: 'Approve or return an independently authored editorial revision.',
  }),
  Object.freeze({
    key: 'content.publish',
    description: 'Publish, schedule, cancel and archive reviewed editorial content.',
  }),
  Object.freeze({
    key: 'correspondence.read',
    description: 'Read private ContactInquiry and Feedback submissions.',
  }),
  Object.freeze({
    key: 'correspondence.administer',
    description: 'Triage private correspondence and dispose of expired submissions.',
  }),

  /* ---- Phase 8 — Library ----------------------------------------------- */
  //
  // TWO KEYS, AND NEITHER OF THEM IS `content.*`.
  //
  // It would have been easy to reuse Editorial's vocabulary: both manage
  // published material, and `content.publish` already exists. They are DIFFERENT
  // AUTHORITIES over different aggregates with different owners — a person
  // trusted to publish an Article has not thereby been trusted to change which
  // edition of a book the platform offers for download, and an operator
  // maintaining the book catalogue should not acquire the editorial workflow.
  // One key covering both would be a grant nobody could reason about (§4).
  //
  // TWO, NOT FOUR. Library has no independent review step and no scheduling:
  // ROUTE_MAP.md §7 gives it four administrative routes — works, editions,
  // translations, sale-points — which are four VIEWS of one concern with one
  // owner, and Phase 8 delivers no workflow that separates authoring from
  // publishing. So there is no `library.author`, no `library.review` and no
  // `library.publish`; minting them for symmetry with Editorial would be
  // grantable authority over transitions that do not exist. They arrive with a
  // workflow contract, if one is ever accepted.
  //
  // TWO, NOT ONE PER ENTITY EITHER. `library.works.administer` beside
  // `library.editions.administer` would separate authority nobody asked to
  // separate — an Edition without its Work is not an administrable thing.
  //
  // `library.administer` IS ALSO WHAT AUTHORISES A PRIVATE ASSET PREVIEW, and
  // that is deliberate rather than convenient: previewing a file already attached
  // to an Edition the holder may already edit is the same authority as editing
  // it. The relation is still checked, so the permission never becomes a
  // general-purpose file reader (SECURITY_BASELINE.md §10.1).
  //
  // WHAT IS DELIBERATELY ABSENT, and is most tempting at this phase:
  // `research.*`, `publication.*` and `search.*`. Phases 9 and 17 own those
  // surfaces, and seeding a key now would fix another phase's vocabulary and
  // leave grantable authority over nothing.
  Object.freeze({
    key: 'library.read',
    description: 'View Library works, editions, translations and sale points.',
  }),
  Object.freeze({
    key: 'library.administer',
    description:
      'Create, edit, link and archive Library works, editions, translations and sale points.',
  }),

  /* ---- Phase 17 — Search foundation ------------------------------------ */
  //
  // TWO KEYS, READ AND OPERATE, for the reason every pair here is split — and
  // exactly the shape `delivery.read` and `delivery.operate` already have for
  // the other derived-work surface. Seeing indexing lag and failures and
  // changing what the indexer does next are different authorities.
  //
  // NEITHER CONFERS AUTHORITY OVER ANY CONTENT. Retrying, rebuilding and
  // reconciling only re-project what the owners ALREADY publish; nothing reached
  // through these keys can publish, withdraw or change a record. That is why no
  // content owner's key is reused for them, and why there is no `search.*` key
  // for anything a visitor does: public search needs no permission at all.
  Object.freeze({
    key: 'search.read',
    description: 'View search indexing lag and failures.',
  }),
  Object.freeze({
    key: 'search.operate',
    description:
      'Retry failed search indexing, and rebuild or reconcile the search index.',
  }),
]);

/** Every catalogue key, as a union. Mistyping one is a compile error. */
export type PermissionKey = (typeof PERMISSION_CATALOGUE)[number]['key'];

const PERMISSION_KEYS: ReadonlySet<string> = new Set(
  PERMISSION_CATALOGUE.map((entry) => entry.key),
);

/** Is this string a permission this phase defines? */
export function isPermissionKey(value: string): value is PermissionKey {
  return PERMISSION_KEYS.has(value);
}

/* ===========================================================================
 * Roles
 * ========================================================================= */

/**
 * THE protected system role, and the only one.
 *
 * SECURITY_BASELINE.md §8.3 names the initial privileged operator; nothing in
 * the accepted documents names a second protected role, and inventing a
 * hierarchy to look complete would create privileged rows nobody asked for.
 * Narrower operator roles are created at runtime as CUSTOM roles, which is
 * what the custom-role lifecycle exists for.
 */
export const PLATFORM_ADMINISTRATOR_ROLE = 'platform-administrator';

/**
 * The protected bundle.
 *
 * Migration-controlled foundation data rather than an ordinary editable row:
 * the role has to exist before the one-time bootstrap can assign it, and a
 * runtime path that could re-bundle or deactivate it would be a path to
 * removing the platform's only administrator (SECURITY_BASELINE.md §8).
 */
export const PLATFORM_ADMINISTRATOR_PERMISSIONS: readonly PermissionKey[] = Object.freeze(
  PERMISSION_CATALOGUE.map((entry) => entry.key),
);

/* ===========================================================================
 * Step-up
 * ========================================================================= */

/**
 * What a step-up grant authorises.
 *
 * SCOPED, because a universal elevation token is exactly what
 * SECURITY_BASELINE.md §8 forbids: re-proving a credential to change one's own
 * second factor must not silently also authorise granting somebody else the
 * administrator role.
 *
 * Three classes, matching the three kinds of consequence this phase actually
 * has. A fourth invented now would be a scope with no operation behind it.
 */
export const STEP_UP_PURPOSES = Object.freeze([
  /** Role lifecycle, permission bundles, assignment grant and revoke. */
  'privilege-administration',
  /** Account status administration performed on somebody else's account. */
  'account-administration',
  /** Second-factor and recovery-code administration of one's own account. */
  'second-factor',
] as const);

export type StepUpPurpose = (typeof STEP_UP_PURPOSES)[number];

/**
 * How long a step-up grant lives.
 *
 * Short on purpose. It is "this person proved themselves a moment ago", not a
 * session: an elevation that outlived the operation would be a second, weaker
 * session sitting beside the real one.
 */
export const STEP_UP_LIFETIME_SECONDS = 300;
