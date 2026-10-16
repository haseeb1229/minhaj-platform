import type { Locale } from '@minhaj/contracts';
import type { ContributorCapabilities } from '@minhaj/contracts/identity';
import { NO_CONTRIBUTOR_CAPABILITIES } from '@minhaj/contracts/identity';
import type {
  ContributorAccountPort,
  PeoplePersistencePort,
  PeopleReaderPort,
  PersonDetail,
  PersonPage,
  PersonSitemapEntry,
  PersonStatus,
  ProfileKind,
  ProfileStatus,
  PublicPersonProfile,
  PublicTeacherEntry,
} from '@minhaj/contracts/people';

/**
 * People & Contributors — THE application service.
 *
 * WHAT IT IS. The policy for the platform's contributor identity: what a Person
 * record may be, what a change is called in the audit record, what a listing is
 * allowed to be, and what happens to the optional account link when the account
 * behind it closes.
 *
 * WHAT IT IS NOT. It is not an authorisation check. Whether the caller may
 * perform any of these is settled BEFORE they are reachable, at the Layer-4
 * gate, and the `PeopleActor` below is audit attribution rather than a
 * capability — see its own note.
 *
 * WHAT IT ALSO IS NOT, AND THIS IS THE ONE THAT MATTERS. It is not a second way
 * to grant anything. There is no method here that writes a `RoleAssignment`, no
 * method that seeds a `Permission`, and no method that stores a capability.
 * DOMAIN_MODEL.md §4.5: "A profile alone grants nothing. Creating a Teacher
 * profile confers no teaching privilege; teacher approval must create an
 * auditable RoleAssignment." Approval therefore happens on Identity's existing
 * privileged path — `permissions.grant`, a complete second-factor posture and a
 * purpose-bound step-up — and nothing in this file can reach it.
 *
 * WHY THERE IS NO STEP-UP HERE. SECURITY_BASELINE.md §8.1 names the operations
 * that cost a step-up grant: permission and role grants, canonical Quran and
 * Hadith edits, Fatwa publication, migration publication, account
 * administration and destructive bulk operations. Administering a contributor
 * record is none of them, and §8.2 says the requirement is "deliberately not
 * universal". Inventing a fourth `StepUpPurpose` for it would be a scope with no
 * operation behind it in a vocabulary Phase 2 deliberately closed at three.
 * What every mutation DOES cost is `people.administer`, re-checked at the action
 * layer on every submit (SECURITY_BASELINE.md §3.4 rule 2).
 *
 * Layer 1: Layer-0 interfaces only, never infrastructure. Its one permitted
 * context dependency — Identity & Access, to link a Person to an optional User —
 * arrives as the narrow `ContributorAccountPort`, implemented at Layer 4 over
 * Identity's own public services (DOMAIN_MODEL.md §3.1).
 */

export type PeopleFailure =
  /** The contributor, profile or name variant named does not exist. */
  | 'not-found'
  | 'duplicate-slug'
  /** That account is already linked to a different contributor. */
  | 'account-already-linked'
  /** This contributor already holds an account link. Unlink it first. */
  | 'person-already-linked'
  /** The submitted account does not exist. */
  | 'account-not-found'
  /** The contributor already holds a profile of that kind. */
  | 'profile-exists'
  /** Author and Speaker profiles carry no descriptive fields of their own. */
  | 'profile-has-no-detail'
  | 'duplicate-variant'
  /** The per-locale name-variant bound would be exceeded. */
  | 'variant-limit'
  /** A contributor keeps the translation for their primary language. */
  | 'primary-translation-required'
  | 'too-many-languages'
  | 'unavailable';

export interface PeopleError {
  readonly ok: false;
  readonly failure: PeopleFailure;
}

export type PeopleResult<T> = ({ readonly ok: true } & T) | PeopleError;

function fail(failure: PeopleFailure): PeopleError {
  return { ok: false, failure };
}

/** Maps a data-invariant refusal from the adapter onto a failure class. */
function classify(error: unknown): PeopleFailure {
  const reason = (error as { reason?: unknown } | null)?.reason;

  switch (reason) {
    case 'person-not-found':
    case 'profile-not-found':
    case 'variant-not-found':
      return 'not-found';
    case 'duplicate-slug':
      return 'duplicate-slug';
    case 'account-already-linked':
      return 'account-already-linked';
    case 'person-already-linked':
      return 'person-already-linked';
    case 'account-not-found':
      return 'account-not-found';
    case 'profile-exists':
      return 'profile-exists';
    case 'profile-has-no-detail':
      return 'profile-has-no-detail';
    case 'duplicate-variant':
      return 'duplicate-variant';
    case 'variant-limit':
      return 'variant-limit';
    case 'primary-translation-required':
      return 'primary-translation-required';
    case 'too-many-languages':
      return 'too-many-languages';
    default:
      return 'unavailable';
  }
}

/**
 * Who performed a People change, for the audit record.
 *
 * DELIBERATELY NOT A `PrivilegedActor`. That type is a capability: the
 * authorisation service mints it only after permission, privileged posture and
 * a purpose-bound step-up grant have all been verified, and the sensitive
 * services re-verify the exact instance because a structural value can be
 * forged. None of that applies here, and pretending it did would be worse than
 * useless — it would suggest a proof this phase does not perform.
 *
 * What actually guards these operations is the Layer-4 gate: every Server
 * Action calls `requirePermittedAction(locale, 'people.administer')`, which
 * re-resolves the session, re-reads the permission set live and refuses before
 * the service is reached. This value is what the audit row needs afterwards —
 * who did it, and under which permission — and nothing else.
 */
export interface PeopleActor {
  readonly accountId: string;
  /** The permission the Layer-4 gate verified. Recorded as the authorising source. */
  readonly permission: string;
}

/**
 * The audited action names this context owns.
 *
 * The context owns the VOCABULARY; the adapter composes the payload inside the
 * transaction, which is the only place the before and after state is known.
 *
 * `person.link-released` is deliberately a DIFFERENT action from
 * `person.unlinked`. Both remove the same column's value, and an investigation
 * needs to tell an operator detaching an account from the automatic disposal
 * that follows a closure the person asked for.
 */
const AUDIT = {
  personCreated: 'people.person.created',
  personTranslated: 'people.person.translated',
  personTranslationRemoved: 'people.person.translation-removed',
  personStatusChanged: 'people.person.status-changed',
  nameVariantAdded: 'people.person.name-variant-added',
  nameVariantRemoved: 'people.person.name-variant-removed',
  accountLinked: 'people.person.account-linked',
  accountUnlinked: 'people.person.account-unlinked',
  accountLinkReleased: 'people.person.account-link-released',
  profileCreated: 'people.profile.created',
  profileStatusChanged: 'people.profile.status-changed',
  profileTranslated: 'people.profile.translated',
  profileLanguagesChanged: 'people.profile.languages-changed',
} as const;

/**
 * What a closure-driven link release records as its authorising source.
 *
 * NOT A PERMISSION, because none was used. The person closed their own account;
 * no operator acted and no `people.administer` grant was consulted. Writing a
 * permission key here would claim an authorisation that did not happen, which
 * is the one thing an audit record must not do.
 */
const CLOSURE_SOURCE = 'account-closure';

/** How many contributors one administrative page shows. */
const PERSON_PAGE = 25;

/**
 * How many links one reconciliation pass examines.
 *
 * BOUNDED, and the bound is the whole design. This is a repair for an
 * interrupted disposal, not a background job: it runs on the closure path,
 * costs two bounded reads, and repairs what it finds. A pass that tried to scan
 * every link would be a batch job wearing a function's clothes, and a batch job
 * needs a scheduler this phase does not own.
 */
const RECONCILE_BATCH = 50;

/**
 * THE PUBLIC READ SURFACE, and the whole of what a visitor's page may reach.
 *
 * SEPARATE FROM THE FULL SERVICE ON PURPOSE, and the separation does real work
 * rather than tidying. The contributor profile at `/{locale}/people/{slug}` is
 * an anonymous public page; what it is handed decides what it can possibly do,
 * and three things are absent here that are present on the full service:
 *
 *   - NO MUTATION. A public page cannot publish, archive, link or edit
 *     anything, because no method that does exists on the object it holds.
 *   - NO ADMINISTRATIVE READ. `listPeople` and `findPerson` return drafts and
 *     the linked account identifier; neither is reachable from a public route.
 *   - NO IDENTITY DEPENDENCY AT ALL. This service takes no
 *     `ContributorAccountPort`, so the public render graph never reaches
 *     Identity, the session service or the authentication library — not by
 *     calling them, and not by importing them (ARCHITECTURE.md §8.1).
 *
 * That last one is the point. §8.1 forbids the anonymous public tree from
 * reading session-derived state, and the strongest form of that guarantee is
 * one where the capability is not present in the module graph to be misused.
 */
export function createPeopleReadService({
  reader,
}: {
  readonly reader: PeopleReaderPort;
}) {
  return {
    contributorReferences(ids: readonly string[], locale: Locale) {
      return reader.contributorReferences(ids, locale);
    },
    /**
     * One contributor as the PUBLIC profile page renders them, or `null`.
     *
     * READS NO SESSION AND TAKES NO ACTOR. The public profile is usable signed
     * out (PRODUCT_SCOPE.md), and the shape of this method is what makes that
     * structural rather than a promise: there is no parameter a viewer's
     * identity could arrive through, so no response it produces can vary with
     * one.
     */
    async publicProfile(input: {
      readonly slug: string;
      readonly locale: Locale;
    }): Promise<PublicPersonProfile | null> {
      return reader.findPublicProfile(input);
    },

    /**
     * Whether a slug names a genuinely public contributor.
     *
     * What the two author aliases ask before redirecting. A 301 to a URL that
     * then 404s is a redirect chain ending in nothing, and ROUTE_MAP.md §9.1
     * rule 3 makes the aliases redirects to a CANONICAL URL — which an absent
     * or unpublished contributor does not have.
     */
    async publicPersonExists(slug: string): Promise<boolean> {
      return reader.publicPersonExists(slug);
    },

    /** Every publicly indexable contributor URL, bounded, for the sitemap. */
    async sitemapEntries(
      limit: number,
      offset = 0,
    ): Promise<readonly PersonSitemapEntry[]> {
      return reader.listSitemapEntries(limit, offset);
    },

    /**
     * Phase 23 — the public teacher facts of the accounts named, for the
     * Find-a-Teacher directory and My Teachers. A profile grants nothing:
     * whether any of them may TEACH is Identity's and Learning's to say.
     */
    async publicTeachers(
      accountIds: readonly string[],
      locale: Locale,
    ): Promise<readonly PublicTeacherEntry[]> {
      if (accountIds.length === 0) return [];
      return reader.publicTeachers([...new Set(accountIds)], locale);
    },
  };
}

export type PeopleReadService = ReturnType<typeof createPeopleReadService>;

export interface PeopleServiceDependencies {
  readonly reader: PeopleReaderPort;
  readonly people: PeoplePersistencePort;
  /** Identity's narrow projection. The ONE dependency edge this context has. */
  readonly accounts: ContributorAccountPort;
}

export function createPeopleService({
  reader,
  people,
  accounts,
}: PeopleServiceDependencies) {
  function actorInput(actor: PeopleActor, auditAction: string) {
    return {
      actorId: actor.accountId,
      actorType: 'user' as const,
      authorisingSource: actor.permission,
      auditAction,
    };
  }

  /** Releases one account link with the canonical closure audit posture. */
  function releaseForClosure(accountId: string): Promise<boolean> {
    return people.releaseAccountLink({
      accountId,
      // SYSTEM DISPOSITION, not a retained copy of the association this
      // operation removes. Identity separately audits the person's closure.
      actorId: null,
      actorType: 'system',
      authorisingSource: CLOSURE_SOURCE,
      auditAction: AUDIT.accountLinkReleased,
    });
  }

  /** Identity's narrow answer about one opaque identifier; no account data crosses. */
  async function accountIsClosed(accountId: string): Promise<boolean> {
    return (await accounts.closedAccounts([accountId])).includes(accountId);
  }

  return {
    // THE PUBLIC READS, UNCHANGED AND NOT RESTATED. Composing rather than
    // copying is what stops the administrative surface and the public page
    // answering "is this contributor public?" two different ways.
    ...createPeopleReadService({ reader }),

    /* ---- Reading --------------------------------------------------------- */

    /** One bounded, deterministically ordered page of the contributor directory. */
    async listPeople(input: {
      readonly query: string | null;
      readonly status: PersonStatus | null;
      readonly profileKind: ProfileKind | null;
      readonly locale: Locale;
      readonly offset: number;
    }): Promise<PersonPage> {
      return reader.listPeople({ ...input, limit: PERSON_PAGE });
    },

    async findPerson(input: {
      readonly personId: string;
      readonly locale: Locale;
    }): Promise<PersonDetail | null> {
      return reader.findPerson(input);
    },

    /* ---- Capability projections — Identity's authority, read-only -------- */

    /**
     * The four named capabilities for a contributor's linked account.
     *
     * `null` MEANS NO ACCOUNT, AND ANSWERS WITHOUT ASKING. A Person with no
     * User is the ordinary case — a historical author, a contributor entered by
     * an administrator — and querying Identity about an account that does not
     * exist would be a round trip with one possible answer.
     *
     * EVERYTHING ELSE IS IDENTITY'S ANSWER, UNMODIFIED. This method performs no
     * logic of its own: it does not consult the Person's profiles, it does not
     * cache, and it cannot widen the result. That is what keeps §4.5's rule true
     * — a profile grants nothing, because the only input to this is a grant.
     *
     * IN A PHASE-5 DATABASE ALL FOUR ARE FALSE, and that is correct rather than
     * a gap. The permissions they derive from belong to Learning, Fatwa and
     * Editorial, none of which has shipped, so none of them is grantable yet.
     * When an owning phase seeds its key, this reports it with no change here.
     */
    async capabilitiesFor(accountId: string | null): Promise<ContributorCapabilities> {
      if (accountId === null) return NO_CONTRIBUTOR_CAPABILITIES;
      return accounts.capabilities(accountId);
    },

    /* ---- Person lifecycle ------------------------------------------------ */

    async createPerson(
      actor: PeopleActor,
      input: {
        readonly slug: string;
        readonly primaryLocale: Locale;
        readonly name: string;
        readonly biography: string | null;
      },
    ): Promise<PeopleResult<{ person: PersonDetail }>> {
      try {
        const person = await people.createPerson({
          ...input,
          ...actorInput(actor, AUDIT.personCreated),
        });
        return { ok: true, person };
      } catch (error) {
        return fail(classify(error));
      }
    },

    async setTranslation(
      actor: PeopleActor,
      input: {
        readonly personId: string;
        readonly locale: Locale;
        readonly name: string;
        readonly biography: string | null;
      },
    ): Promise<PeopleResult<{ person: PersonDetail }>> {
      try {
        const person = await people.setPersonTranslation({
          ...input,
          ...actorInput(actor, AUDIT.personTranslated),
        });
        return { ok: true, person };
      } catch (error) {
        return fail(classify(error));
      }
    },

    async removeTranslation(
      actor: PeopleActor,
      input: { readonly personId: string; readonly locale: Locale },
    ): Promise<PeopleResult<{ person: PersonDetail }>> {
      try {
        const person = await people.removePersonTranslation({
          ...input,
          ...actorInput(actor, AUDIT.personTranslationRemoved),
        });
        return { ok: true, person };
      } catch (error) {
        return fail(classify(error));
      }
    },

    /**
     * Publishes, unpublishes or archives a contributor record.
     *
     * NO SEPARATE APPROVAL STEP, DELIBERATELY. Phase 6 owns the shared editorial
     * workflow with its review queue and its separation of duties
     * (DOMAIN_MODEL.md §7.2); building a second one here would leave two
     * workflows that have to agree, and the one nobody uses is the one that
     * drifts. What this phase owns is the three-state lifecycle that keeps an
     * unfinished record off every public surface.
     */
    async setStatus(
      actor: PeopleActor,
      input: { readonly personId: string; readonly status: PersonStatus },
    ): Promise<PeopleResult<{ person: PersonDetail }>> {
      try {
        const person = await people.setPersonStatus({
          ...input,
          ...actorInput(actor, AUDIT.personStatusChanged),
        });
        return { ok: true, person };
      } catch (error) {
        return fail(classify(error));
      }
    },

    /* ---- Name variants --------------------------------------------------- */

    async addNameVariant(
      actor: PeopleActor,
      input: {
        readonly personId: string;
        readonly locale: Locale;
        readonly value: string;
      },
    ): Promise<PeopleResult<{ person: PersonDetail }>> {
      try {
        const person = await people.addNameVariant({
          ...input,
          ...actorInput(actor, AUDIT.nameVariantAdded),
        });
        return { ok: true, person };
      } catch (error) {
        return fail(classify(error));
      }
    },

    async removeNameVariant(
      actor: PeopleActor,
      input: { readonly personId: string; readonly variantId: string },
    ): Promise<PeopleResult<{ person: PersonDetail }>> {
      try {
        const person = await people.removeNameVariant({
          ...input,
          ...actorInput(actor, AUDIT.nameVariantRemoved),
        });
        return { ok: true, person };
      } catch (error) {
        return fail(classify(error));
      }
    },

    /* ---- The optional account link --------------------------------------- */

    /**
     * Links a contributor record to an account.
     *
     * THE ACCOUNT IS RE-VALIDATED BY THE DATABASE. The identifier arrives from a
     * form and is a user-controlled value; the foreign key is what refuses a
     * forged one, and the unique index is what decides the race when two
     * operators try to attach the same account to two different contributors.
     * Neither is an application check somebody could skip.
     *
     * IDENTITY IS ASKED BEFORE AND AFTER THE WRITE whether the opaque account is
     * closed. The first check refuses an old identifier; the second closes the
     * race where account closure commits after that answer but before this
     * context commits its link. If Identity cannot provide the second answer,
     * the just-created link is compensated away rather than retained on an
     * unverifiable account. A process stop in the remaining inter-transaction
     * window leaves the link itself as the durable reconciliation marker, which
     * the closure repair path already consumes.
     *
     * NOTHING IS COPIED FROM THE ACCOUNT. Not the address, not the display name.
     * A contributor's public name is editorial content entered here; an
     * account's name is whatever somebody typed at sign-up, and treating the
     * second as the first would put unreviewed personal data on a public page.
     *
     * LINKING GRANTS NOTHING. It changes one nullable column. What the person
     * may DO is still whatever Identity's assignments say — which is why the
     * capability projection is a read of those assignments and not of this.
     */
    async linkAccount(
      actor: PeopleActor,
      input: { readonly personId: string; readonly accountId: string },
    ): Promise<PeopleResult<{ person: PersonDetail }>> {
      try {
        if (await accountIsClosed(input.accountId)) {
          return fail('account-not-found');
        }

        const person = await people.linkAccount({
          ...input,
          ...actorInput(actor, AUDIT.accountLinked),
        });

        let closedAfterLink: boolean;
        try {
          closedAfterLink = await accountIsClosed(input.accountId);
        } catch (error) {
          // FAIL CLOSED. The account may still be active, but retaining a new
          // association after Identity could not confirm that would make an
          // infrastructure failure choose the privacy posture. Reverse the
          // just-created act under the same operator attribution instead.
          await people.unlinkAccount({
            personId: input.personId,
            ...actorInput(actor, AUDIT.accountUnlinked),
          });
          throw error;
        }

        if (closedAfterLink) {
          await releaseForClosure(input.accountId);
          return fail('account-not-found');
        }

        return { ok: true, person };
      } catch (error) {
        return fail(classify(error));
      }
    },

    async unlinkAccount(
      actor: PeopleActor,
      input: { readonly personId: string },
    ): Promise<PeopleResult<{ person: PersonDetail }>> {
      try {
        const person = await people.unlinkAccount({
          ...input,
          ...actorInput(actor, AUDIT.accountUnlinked),
        });
        return { ok: true, person };
      } catch (error) {
        return fail(classify(error));
      }
    },

    /* ---- Account closure — People's own disposition ----------------------- */

    /**
     * Releases the link this context holds for a CLOSED account.
     *
     * THE DISPOSITION PHASE 5 OWES, and the reasoning behind the choice, stated
     * once and here.
     *
     * SECURITY_BASELINE.md §19.1: "Every semantic data owner owns the
     * disposition of its own data." Identity owns account closure and performs
     * it in its own transaction; People then disposes of what People holds. Two
     * dispositions were available and they are not equivalent:
     *
     *   RETAIN the live association as private history. Rejected by the settled
     *   product rule. `Person.userId` is an operational account-linkage
     *   mechanism, not contributor provenance; after closure it has no current
     *   sign-in or authorisation purpose. If a future adopted policy needs a
     *   historical association, that requires its own explicitly reviewed
     *   retention/provenance design rather than keeping this live link.
     *
     *   RELEASE the association, keep the public record. Chosen. A Person is a
     *   PUBLIC contributor record with its own lifecycle; somebody closing their
     *   account is not a decision to withdraw their authorship, and destroying
     *   the Person would break attributions later content domains will carry. So
     *   the public record follows ITS OWN lifecycle — unchanged by closure — and
     *   the private pointer is disposed of.
     *
     * WHAT THIS MEANS AFTERWARDS, in the order it matters: the contributor page
     * renders exactly as before; the capability projection reports all four
     * capabilities false, because there is no account to project from; a later
     * re-registration with the same address is a NEW `User` id and is not
     * relinked to anything, because nothing links by email or name and nothing
     * here runs on sign-up.
     *
     * IDEMPOTENT, so the reconciliation below can ask twice.
     */
    async releaseAccountLink(input: {
      readonly accountId: string;
    }): Promise<PeopleResult<{ released: boolean }>> {
      try {
        const released = await releaseForClosure(input.accountId);
        return { ok: true, released };
      } catch (error) {
        return fail(classify(error));
      }
    },

    /**
     * Repairs links left behind by an INTERRUPTED closure.
     *
     * WHY IT IS NEEDED AT ALL. The two halves of a closure are two owners' own
     * transactions, because a single transaction spanning both would need a
     * transaction handle to cross a context boundary — which is the capability
     * laundering ARCHITECTURE.md §3.1.2.1 prohibits, and which that section
     * resolves by requiring the coordination to be "idempotent and resumable"
     * instead. Resumable means something has to resume it, and this is that.
     *
     * WHAT IT IS NOT. Not a workflow engine, not a queue, not a scheduler, not a
     * generic cross-context purge. Two bounded reads and an idempotent write per
     * stranded link: People lists the account identifiers it already holds,
     * Identity says which of them are closed, and People releases those. No
     * cross-context transaction exists anywhere in it, and no table but People's
     * own is written.
     *
     * WHERE IT RUNS. Synchronously on the closure path, after the direct release
     * for the account being closed. A closure that completes normally still
     * sweeps bounded pages for older interrupted work; a closure interrupted
     * last week is therefore repaired by the next one. The durable retry marker
     * is the link itself, and no completion is reported if the sweep fails.
     *
     * Returns how many links it released, so a caller logs work done rather than
     * an assumption.
     */
    async reconcileClosedAccountLinks(): Promise<number> {
      let released = 0;
      let offset = 0;

      // EVERY QUERY IS BOUNDED, BUT THE SWEEP IS COMPLETE. Examining only the
      // first batch forever would starve a stranded closed link whenever 50
      // open links sorted before it.
      while (true) {
        const linked = await people.linkedAccountIds(RECONCILE_BATCH, offset);
        if (linked.length === 0) break;

        const closed = await accounts.closedAccounts(linked);
        const closedSet = new Set(closed);

        for (const accountId of closed) {
          const done = await releaseForClosure(accountId);
          if (done) released += 1;
        }

        // Released rows disappear from the ordered result. Advance only past
        // the rows retained, or the shift would skip the next batch.
        offset += linked.filter((accountId) => !closedSet.has(accountId)).length;
      }

      return released;
    },

    /* ---- Profiles --------------------------------------------------------- */

    /**
     * Adds one profile facet to a contributor.
     *
     * CREATING A PROFILE GRANTS NOTHING. This is the method most likely to be
     * misread as an approval, so it is worth saying plainly: adding a
     * TeacherProfile writes one row in one People table. It creates no
     * `RoleAssignment`, seeds no permission and stores no capability, and
     * `canTeach` stays false until somebody with `permissions.grant` — under a
     * complete second-factor posture and a purpose-bound step-up — grants
     * `teaching.perform` on Identity's own path (DOMAIN_MODEL.md §4.5).
     */
    async createProfile(
      actor: PeopleActor,
      input: { readonly personId: string; readonly kind: ProfileKind },
    ): Promise<PeopleResult<{ person: PersonDetail }>> {
      try {
        const person = await people.createProfile({
          ...input,
          ...actorInput(actor, AUDIT.profileCreated),
        });
        return { ok: true, person };
      } catch (error) {
        return fail(classify(error));
      }
    },

    async setProfileStatus(
      actor: PeopleActor,
      input: {
        readonly personId: string;
        readonly kind: ProfileKind;
        readonly status: ProfileStatus;
      },
    ): Promise<PeopleResult<{ person: PersonDetail }>> {
      try {
        const person = await people.setProfileStatus({
          ...input,
          ...actorInput(actor, AUDIT.profileStatusChanged),
        });
        return { ok: true, person };
      } catch (error) {
        return fail(classify(error));
      }
    },

    async setProfileTranslation(
      actor: PeopleActor,
      input: {
        readonly personId: string;
        readonly kind: ProfileKind;
        readonly locale: Locale;
        readonly qualifications: string | null;
        readonly expertise: string | null;
        readonly biography: string | null;
        readonly subjects: string | null;
      },
    ): Promise<PeopleResult<{ person: PersonDetail }>> {
      try {
        const person = await people.setProfileTranslation({
          ...input,
          ...actorInput(actor, AUDIT.profileTranslated),
        });
        return { ok: true, person };
      } catch (error) {
        return fail(classify(error));
      }
    },

    async setProfileLanguages(
      actor: PeopleActor,
      input: {
        readonly personId: string;
        readonly kind: ProfileKind;
        readonly languages: readonly string[];
      },
    ): Promise<PeopleResult<{ person: PersonDetail }>> {
      try {
        const person = await people.setProfileLanguages({
          ...input,
          ...actorInput(actor, AUDIT.profileLanguagesChanged),
        });
        return { ok: true, person };
      } catch (error) {
        return fail(classify(error));
      }
    },
  };
}

export type PeopleService = ReturnType<typeof createPeopleService>;
