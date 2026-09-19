/**
 * People & Contributors — THE public interface.
 *
 * This file is the only path into the context. Everything under `application/`
 * and `domain/` is internal, and a cross-context or Layer-4 import that reaches
 * past this file fails the architecture gate (ARCHITECTURE.md §6.3 rule 4).
 *
 * WHAT IS DELIBERATELY ABSENT. No Prisma, no persistence adapter, no
 * transaction handle, no SQL. The context depends on the Layer-0 ports declared
 * in `@minhaj/contracts/people` and is handed their implementations by Layer 4;
 * it never names one.
 *
 * ITS ONE DEPENDENCY, AND HOW IT IS SHAPED. DOMAIN_MODEL.md §3.1 permits
 * exactly one edge out of this context — "Identity & Access *(to link a Person
 * to an optional User)*" — and it arrives as `ContributorAccountPort`: two
 * read-only operations, neither of which can grant, revoke, enrol, elevate, list
 * accounts or reveal an address. People stores an opaque account identifier and
 * asks two questions about it. It does not import the Identity context, it does
 * not query an Identity table, and it holds no notion of what an account IS.
 *
 * WHAT IS ABSENT AND MATTERS MOST. Any operation that grants authority.
 *
 *   - there is no `approveTeacher`, no `grant`, no `setCapability`;
 *   - no method here writes a `RoleAssignment` or a `Permission`;
 *   - the four capability projections are READ through Identity and are never
 *     stored, never derived from a profile, and never cached.
 *
 * DOMAIN_MODEL.md §4.5 is the rule those absences implement: "A profile alone
 * grants nothing. Creating a Teacher profile confers no teaching privilege;
 * teacher approval must create an auditable RoleAssignment." Approval is
 * therefore an Identity operation, on Identity's privileged path —
 * `permissions.grant`, a complete second-factor posture, a purpose-bound step-up
 * grant, the self-elevation prohibition and its audit record — and this file
 * offers no route to it, because a second grant path is two places for authority
 * to be decided and one of them will be wrong.
 *
 * ALSO ABSENT: any operation that relates a contributor to a WORK.
 * DOMAIN_MODEL.md §5.3 puts that relationship row in the context that owns the
 * TARGET, and no such context has shipped. The integration rule a later owner
 * follows is:
 *
 *   1. create your own junction table at your owning phase, with a real foreign
 *      key to `Person` (or to the profile aggregate you mean) and a real foreign
 *      key to your own target;
 *   2. carry one of `CONTRIBUTION_ROLES` as the capacity of the contribution;
 *   3. own its adapter in your own directory and its lifecycle in your own
 *      context — People never writes another context's rows;
 *   4. read contributors through `PeopleService`, which is this file.
 *
 * Offering a generic `addContribution(targetType, targetId)` here would be the
 * polymorphic reference §6.2 prohibits, wearing a service's clothes.
 */

export {
  createPeopleReadService,
  createPeopleService,
} from './application/people-service.ts';

export type {
  PeopleActor,
  PeopleReadService,
  PeopleError,
  PeopleFailure,
  PeopleResult,
  PeopleService,
  PeopleServiceDependencies,
} from './application/people-service.ts';

export { addableProfileKinds, missingTranslations } from './domain/person.ts';
