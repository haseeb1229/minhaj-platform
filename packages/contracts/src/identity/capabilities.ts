/**
 * CAPABILITY PROJECTIONS — Identity & Access's, and nobody else's.
 *
 * DOMAIN_MODEL.md §4.5 names four labels — `canTeach`, `canReceiveQuestions`,
 * `canReviewContent`, `canIssueFatwa` — and settles what they are in one
 * sentence: "named projections derived from explicit permission grants or
 * approved role assignments … read-only conveniences for presentation and
 * query", which "are never independently stored booleans, and never an
 * enforcement path".
 *
 * WHY THEY LIVE HERE RATHER THAN IN THE PEOPLE CONTRACT. The authority they
 * describe is Identity's. A projection declared beside the Person aggregate
 * would read as a property of a contributor record, and the very first mistake
 * §4.5 exists to prevent is "a profile flag and a permission [as] two gates that
 * could disagree". Putting the mapping where the permissions are means People
 * consumes a result it cannot compute, cannot widen and cannot cache.
 *
 * THE FOUR SOURCE CODES ARE NOT GRANTABLE YET, AND THAT IS CORRECT.
 * `PERMISSION_CATALOGUE` in `./permissions.ts` deliberately does not contain
 * `teaching.perform`, `question.receive`, `content.review` or `fatwa.publish`:
 * they belong to Learning, Fatwa and Editorial, which have not shipped, and
 * seeding one early would fix another owner's vocabulary and leave grantable
 * authority over nothing. OPEN_DECISIONS.md §6.3 separately leaves WHO receives
 * them to an activation gate this project has not been given.
 *
 * So the codes below are typed as `string`, NOT as `PermissionKey`. That is the
 * whole reason this module has no cast in it: `effectivePermissions` already
 * returns `readonly string[]`, so the comparison is string-to-string and no
 * `as PermissionKey`, no `as unknown as`, and no `as any` is needed anywhere to
 * express "a permission a later phase will define".
 *
 * WHAT HAPPENS WHEN THE OWNING PHASE ARRIVES. It appends its key to the
 * catalogue, its migration seeds the row, and an assignment starts granting it.
 * `projectContributorCapabilities` then reports `true` with no change to this
 * file, no change to the People schema and no change to any projection call
 * site — which is the test that this mapping was written in the right place.
 */

/**
 * Each projection, and the permission code it is derived from.
 *
 * TRANSCRIBED FROM DOMAIN_MODEL.md §4.5's own table, including the one asymmetry
 * in it: `canIssueFatwa` derives from `fatwa.publish` rather than from
 * `fatwa.answer`. Both codes are named by §6.3 as grants the organisation will
 * eventually make, and they are different authorities — drafting an answer is
 * not publishing a ruling. The table says `fatwa.publish`, so that is what this
 * says, and the difference is not smoothed over.
 */
export const CONTRIBUTOR_CAPABILITY_SOURCES = Object.freeze({
  canTeach: 'teaching.perform',
  canReceiveQuestions: 'question.receive',
  canReviewContent: 'content.review',
  canIssueFatwa: 'fatwa.publish',
} as const);

/** The projection names, so a surface can iterate them without listing four. */
export type ContributorCapability = keyof typeof CONTRIBUTOR_CAPABILITY_SOURCES;

/**
 * What one account may do, as the four named projections.
 *
 * ALL FOUR ARE ALWAYS PRESENT, and always `false` when unproven. A partial
 * shape — a set of the capabilities that happen to be held — would make the
 * absence of a key and the absence of a grant indistinguishable at a call site,
 * and "we did not look" would render identically to "no".
 */
export type ContributorCapabilities = Readonly<Record<ContributorCapability, boolean>>;

/**
 * Every projection false.
 *
 * THE ANSWER FOR A PERSON WITH NO ACCOUNT, and the default this module is built
 * around: a Person who has never signed in is the ordinary case — a historical
 * author, a contributor who was entered by an administrator — and asking
 * Identity about an account that does not exist would be a query with one
 * possible answer.
 *
 * Frozen, and returned rather than reconstructed, so no caller can mutate the
 * shared default into something that grants.
 */
export const NO_CONTRIBUTOR_CAPABILITIES: ContributorCapabilities = Object.freeze({
  canTeach: false,
  canReceiveQuestions: false,
  canReviewContent: false,
  canIssueFatwa: false,
});

/**
 * Projects the four labels from the permissions an account CURRENTLY holds.
 *
 * A PURE FUNCTION OVER A LIVE READ, which is the only shape that satisfies §4.5
 * and SECURITY_BASELINE.md §3.4 rule 5 together. It stores nothing, caches
 * nothing and decides nothing: the caller supplies the result of
 * `effectivePermissions`, which is computed live from current assignments,
 * active roles, the current bundle and an active account — so a revoked
 * assignment stops projecting on the next request rather than the next sign-in.
 *
 * FAIL-CLOSED BY CONSTRUCTION. There is no branch here that can produce `true`
 * without the exact code being present in `held`. A disabled, suspended or
 * closed account yields an empty permission set upstream, so every projection
 * is false without this function needing to know what an account status is.
 *
 * IT IS NOT AN ENFORCEMENT PATH. Nothing in this repository authorises an
 * action by reading one of these booleans; authority is `can(user, key)` over
 * the catalogue, checked at the Layer-4 gate. These exist so a profile page can
 * say what a person is approved to do without inventing its own answer.
 */
export function projectContributorCapabilities(
  held: readonly string[],
): ContributorCapabilities {
  const permissions = new Set(held);

  return Object.freeze({
    canTeach: permissions.has(CONTRIBUTOR_CAPABILITY_SOURCES.canTeach),
    canReceiveQuestions: permissions.has(
      CONTRIBUTOR_CAPABILITY_SOURCES.canReceiveQuestions,
    ),
    canReviewContent: permissions.has(CONTRIBUTOR_CAPABILITY_SOURCES.canReviewContent),
    canIssueFatwa: permissions.has(CONTRIBUTOR_CAPABILITY_SOURCES.canIssueFatwa),
  });
}
