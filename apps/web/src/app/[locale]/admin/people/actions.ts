'use server';

import { revalidatePath } from 'next/cache';

import { localeSchema } from '@minhaj/contracts';
import {
  MAX_PROFILE_LANGUAGES,
  PROFILE_KINDS,
  contributorLanguageCodeSchema,
  personBiographySchema,
  personLocaleSchema,
  personNameSchema,
  personNameVariantSchema,
  personSlugSchema,
  personStatusSchema,
  profileStatusSchema,
  scholarExpertiseSchema,
  scholarQualificationsSchema,
  teacherBiographySchema,
  teacherSubjectsSchema,
} from '@minhaj/contracts/people';
import type { AuthorizationDenial } from '@minhaj/server-core/authorization';
import { z } from 'zod';

import { requirePermittedAction } from '@/composition/authorization';
import { peopleRuntime } from '@/composition/people';
import type { PeopleActor, PeopleFailure } from '@/contexts/people-contributors';

/**
 * THE People mutation surface.
 *
 * Every function here is a Class-A browser mutation (SECURITY_BASELINE.md
 * §7.1): a Server Action, carrying the framework's Origin and CSRF protections,
 * and unreachable by GET. There is no `/api/admin/people/*` route, because a
 * route would be a second path to these operations sitting outside these
 * wrappers.
 *
 * EVERY ONE RE-CHECKS AUTHORISATION INDEPENDENTLY. The page that rendered the
 * form checked `people.read` to decide what to show; that decision is
 * navigational and is not reused here. `requirePermittedAction` resolves the
 * session again and reads the permission set live, because the minutes between
 * a render and a submit are long enough for a role to be revoked (§3.4 rule 2).
 *
 * PERMISSION, AND NO STEP-UP. SECURITY_BASELINE.md §8.1 names the operations
 * that cost a step-up grant and a complete second-factor posture — privilege
 * grants, canonical Quran and Hadith edits, Fatwa publication, migration
 * publication, account administration, destructive bulk operations.
 * Administering a contributor record is none of them, and §8.2 states the
 * requirement is "deliberately not universal". The alternative would have been
 * a fourth `StepUpPurpose`, and the Phase-2 contract closed that vocabulary at
 * three precisely so a scope could not be invented for an operation that
 * matches none of the consequence classes it names.
 *
 * WHAT IS ABSENT, AND IS THE POINT OF THE PHASE. Any action that grants
 * anything. There is no `approveTeacher`, no `grantTeaching`, no capability
 * toggle and no role control. DOMAIN_MODEL.md §4.5: "Creating a Teacher profile
 * confers no teaching privilege; teacher approval must create an auditable
 * RoleAssignment." That assignment is made on Identity's privileged path — at
 * `/admin/identity/assignments`, costing `permissions.grant`, a complete
 * second-factor posture and a purpose-bound step-up grant — and nothing in this
 * file can reach it.
 *
 * ALSO ABSENT: any account SEARCH. Linking takes an account identifier the
 * operator already has, and the only place to obtain one is the Identity
 * accounts surface, which costs `users.read`. An account picker here would make
 * `people.administer` a quiet grant of the account directory that permission
 * exists to guard (SECURITY_BASELINE.md §19.1).
 */

/** Every way a People action can refuse. */
export type PeopleActionFailure =
  AuthorizationDenial | PeopleFailure | 'no-session' | 'invalid-input';

export interface PeopleActionState {
  readonly status: 'idle' | 'success' | 'error';
  readonly failure?: PeopleActionFailure;
}

const OK: PeopleActionState = { status: 'success' };

function invalid(): PeopleActionState {
  return { status: 'error', failure: 'invalid-input' };
}

function failed(failure: PeopleActionFailure): PeopleActionState {
  return { status: 'error', failure };
}

function localeFrom(form: FormData): string {
  const parsed = localeSchema.safeParse(form.get('locale'));
  return parsed.success ? parsed.data : 'en';
}

/**
 * Re-renders the surfaces a change is visible on.
 *
 * BOTH TREES, because a contributor appears on two: the administrative
 * directories under `/admin`, and the public profile at `/people/{slug}`. A
 * change that published a contributor and refreshed only the admin view would
 * leave the public page showing the previous state until something else
 * happened to evict it — which is exactly the stale-visibility failure a public
 * cache must not have (ARCHITECTURE.md §8.3).
 */
function refresh(locale: string, slug?: string): void {
  revalidatePath(`/${locale}/admin`, 'layout');
  if (slug !== undefined) revalidatePath(`/${locale}/people/${slug}`);
}

/**
 * Resolves the caller, or says why not.
 *
 * ONE PLACE, so no action can be written that forgets the gate. What it returns
 * is an audit attribution, not a capability: the authority was settled by
 * `requirePermittedAction` before this function returns, and `PeopleActor`
 * exists so the audit row can say who acted and under which permission.
 */
async function peopleActor(
  locale: string,
): Promise<
  | { readonly ok: true; readonly actor: PeopleActor }
  | { readonly ok: false; readonly failure: PeopleActionFailure }
> {
  const gate = await requirePermittedAction(locale, 'people.administer');
  if (gate.state === 'denied') return { ok: false, failure: gate.reason };

  return {
    ok: true,
    actor: {
      accountId: gate.session.account.id,
      permission: 'people.administer',
    },
  };
}

/* ===========================================================================
 * Shared field schemas
 * ========================================================================= */

/** An internal identifier, as a form carries it. */
const idSchema = z.string().trim().min(1).max(36);

/**
 * `''` means absent, because an HTML textarea cannot carry `null`.
 *
 * Normalised HERE, at the boundary, rather than letting every action repeat the
 * conversion — and rather than letting the string `''` reach a service that
 * would store it as a biography that exists and says nothing.
 */
function absentIfEmpty(value: string): string | null {
  return value === '' ? null : value;
}

const profileKindSchema = z.enum(PROFILE_KINDS);

/* ===========================================================================
 * Person
 * ========================================================================= */

const createPersonSchema = z.object({
  slug: personSlugSchema,
  primaryLocale: personLocaleSchema,
  name: personNameSchema,
  biography: personBiographySchema,
});

export async function createPersonAction(
  _previous: PeopleActionState,
  form: FormData,
): Promise<PeopleActionState> {
  const locale = localeFrom(form);
  const parsed = createPersonSchema.safeParse({
    slug: form.get('slug'),
    primaryLocale: form.get('primaryLocale'),
    name: form.get('name'),
    biography: form.get('biography') ?? '',
  });
  if (!parsed.success) return invalid();

  const gate = await peopleActor(locale);
  if (!gate.ok) return failed(gate.failure);

  const result = await peopleRuntime().people.createPerson(gate.actor, {
    slug: parsed.data.slug,
    primaryLocale: parsed.data.primaryLocale,
    name: parsed.data.name,
    biography: absentIfEmpty(parsed.data.biography),
  });
  if (!result.ok) return failed(result.failure);

  refresh(locale, parsed.data.slug);
  return OK;
}

const setTranslationSchema = z.object({
  personId: idSchema,
  contentLocale: personLocaleSchema,
  name: personNameSchema,
  biography: personBiographySchema,
});

export async function setPersonTranslationAction(
  _previous: PeopleActionState,
  form: FormData,
): Promise<PeopleActionState> {
  const locale = localeFrom(form);
  const parsed = setTranslationSchema.safeParse({
    personId: form.get('personId'),
    contentLocale: form.get('contentLocale'),
    name: form.get('name'),
    biography: form.get('biography') ?? '',
  });
  if (!parsed.success) return invalid();

  const gate = await peopleActor(locale);
  if (!gate.ok) return failed(gate.failure);

  const result = await peopleRuntime().people.setTranslation(gate.actor, {
    personId: parsed.data.personId,
    locale: parsed.data.contentLocale,
    name: parsed.data.name,
    biography: absentIfEmpty(parsed.data.biography),
  });
  if (!result.ok) return failed(result.failure);

  refresh(locale, result.person.slug);
  return OK;
}

const removeTranslationSchema = z.object({
  personId: idSchema,
  contentLocale: personLocaleSchema,
});

export async function removePersonTranslationAction(
  _previous: PeopleActionState,
  form: FormData,
): Promise<PeopleActionState> {
  const locale = localeFrom(form);
  const parsed = removeTranslationSchema.safeParse({
    personId: form.get('personId'),
    contentLocale: form.get('contentLocale'),
  });
  if (!parsed.success) return invalid();

  const gate = await peopleActor(locale);
  if (!gate.ok) return failed(gate.failure);

  const result = await peopleRuntime().people.removeTranslation(gate.actor, {
    personId: parsed.data.personId,
    locale: parsed.data.contentLocale,
  });
  if (!result.ok) return failed(result.failure);

  refresh(locale, result.person.slug);
  return OK;
}

const setStatusSchema = z.object({
  personId: idSchema,
  status: personStatusSchema,
});

export async function setPersonStatusAction(
  _previous: PeopleActionState,
  form: FormData,
): Promise<PeopleActionState> {
  const locale = localeFrom(form);
  const parsed = setStatusSchema.safeParse({
    personId: form.get('personId'),
    status: form.get('status'),
  });
  if (!parsed.success) return invalid();

  const gate = await peopleActor(locale);
  if (!gate.ok) return failed(gate.failure);

  const result = await peopleRuntime().people.setStatus(gate.actor, parsed.data);
  if (!result.ok) return failed(result.failure);

  refresh(locale, result.person.slug);
  return OK;
}

/* ===========================================================================
 * Name variants
 * ========================================================================= */

const addVariantSchema = z.object({
  personId: idSchema,
  contentLocale: personLocaleSchema,
  value: personNameVariantSchema,
});

export async function addNameVariantAction(
  _previous: PeopleActionState,
  form: FormData,
): Promise<PeopleActionState> {
  const locale = localeFrom(form);
  const parsed = addVariantSchema.safeParse({
    personId: form.get('personId'),
    contentLocale: form.get('contentLocale'),
    value: form.get('value'),
  });
  if (!parsed.success) return invalid();

  const gate = await peopleActor(locale);
  if (!gate.ok) return failed(gate.failure);

  const result = await peopleRuntime().people.addNameVariant(gate.actor, {
    personId: parsed.data.personId,
    locale: parsed.data.contentLocale,
    value: parsed.data.value,
  });
  if (!result.ok) return failed(result.failure);

  refresh(locale, result.person.slug);
  return OK;
}

const removeVariantSchema = z.object({
  personId: idSchema,
  variantId: idSchema,
});

export async function removeNameVariantAction(
  _previous: PeopleActionState,
  form: FormData,
): Promise<PeopleActionState> {
  const locale = localeFrom(form);
  const parsed = removeVariantSchema.safeParse({
    personId: form.get('personId'),
    variantId: form.get('variantId'),
  });
  if (!parsed.success) return invalid();

  const gate = await peopleActor(locale);
  if (!gate.ok) return failed(gate.failure);

  const result = await peopleRuntime().people.removeNameVariant(gate.actor, parsed.data);
  if (!result.ok) return failed(result.failure);

  refresh(locale, result.person.slug);
  return OK;
}

/* ===========================================================================
 * The optional account link
 * ========================================================================= */

/**
 * The account identifier, as the link form carries it.
 *
 * VALIDATED FOR SHAPE AND RE-VALIDATED BY THE DATABASE. The bound matches the
 * `Person.userId` column, so an over-long value is refused before a query is
 * built; whether the account EXISTS is settled by the foreign key, which is a
 * check no caller can skip and no concurrent delete can race.
 */
const linkAccountSchema = z.object({
  personId: idSchema,
  accountId: z.string().trim().min(1).max(36),
});

export async function linkAccountAction(
  _previous: PeopleActionState,
  form: FormData,
): Promise<PeopleActionState> {
  const locale = localeFrom(form);
  const parsed = linkAccountSchema.safeParse({
    personId: form.get('personId'),
    accountId: form.get('accountId'),
  });
  if (!parsed.success) return invalid();

  const gate = await peopleActor(locale);
  if (!gate.ok) return failed(gate.failure);

  const result = await peopleRuntime().people.linkAccount(gate.actor, parsed.data);
  if (!result.ok) return failed(result.failure);

  refresh(locale, result.person.slug);
  return OK;
}

export async function unlinkAccountAction(
  _previous: PeopleActionState,
  form: FormData,
): Promise<PeopleActionState> {
  const locale = localeFrom(form);
  const parsed = z.object({ personId: idSchema }).safeParse({
    personId: form.get('personId'),
  });
  if (!parsed.success) return invalid();

  const gate = await peopleActor(locale);
  if (!gate.ok) return failed(gate.failure);

  const result = await peopleRuntime().people.unlinkAccount(gate.actor, parsed.data);
  if (!result.ok) return failed(result.failure);

  refresh(locale, result.person.slug);
  return OK;
}

/* ===========================================================================
 * Profiles
 * ========================================================================= */

const profileSchema = z.object({
  personId: idSchema,
  kind: profileKindSchema,
});

export async function createProfileAction(
  _previous: PeopleActionState,
  form: FormData,
): Promise<PeopleActionState> {
  const locale = localeFrom(form);
  const parsed = profileSchema.safeParse({
    personId: form.get('personId'),
    kind: form.get('kind'),
  });
  if (!parsed.success) return invalid();

  const gate = await peopleActor(locale);
  if (!gate.ok) return failed(gate.failure);

  // ADDS A FACET, AND GRANTS NOTHING. The service writes one row in one People
  // table; no `RoleAssignment` is created here or anywhere beneath this call.
  const result = await peopleRuntime().people.createProfile(gate.actor, parsed.data);
  if (!result.ok) return failed(result.failure);

  refresh(locale, result.person.slug);
  return OK;
}

const profileStatusSchemaInput = z.object({
  personId: idSchema,
  kind: profileKindSchema,
  status: profileStatusSchema,
});

export async function setProfileStatusAction(
  _previous: PeopleActionState,
  form: FormData,
): Promise<PeopleActionState> {
  const locale = localeFrom(form);
  const parsed = profileStatusSchemaInput.safeParse({
    personId: form.get('personId'),
    kind: form.get('kind'),
    status: form.get('status'),
  });
  if (!parsed.success) return invalid();

  const gate = await peopleActor(locale);
  if (!gate.ok) return failed(gate.failure);

  const result = await peopleRuntime().people.setProfileStatus(gate.actor, parsed.data);
  if (!result.ok) return failed(result.failure);

  refresh(locale, result.person.slug);
  return OK;
}

/**
 * The prose one profile carries, per locale.
 *
 * ALL FOUR FIELDS ARE ACCEPTED AND ONLY THE RELEVANT ONES ARE STORED. Which
 * fields a kind HAS is fixed by the schema — an AuthorProfile has no translation
 * table at all — so a stray value has nowhere to be written, and the service
 * refuses the call outright for the two kinds that carry none.
 */
const profileTranslationSchema = z.object({
  personId: idSchema,
  kind: profileKindSchema,
  contentLocale: personLocaleSchema,
  qualifications: scholarQualificationsSchema,
  expertise: scholarExpertiseSchema,
  biography: teacherBiographySchema,
  subjects: teacherSubjectsSchema,
});

export async function setProfileTranslationAction(
  _previous: PeopleActionState,
  form: FormData,
): Promise<PeopleActionState> {
  const locale = localeFrom(form);
  const parsed = profileTranslationSchema.safeParse({
    personId: form.get('personId'),
    kind: form.get('kind'),
    contentLocale: form.get('contentLocale'),
    qualifications: form.get('qualifications') ?? '',
    expertise: form.get('expertise') ?? '',
    biography: form.get('profileBiography') ?? '',
    subjects: form.get('subjects') ?? '',
  });
  if (!parsed.success) return invalid();

  const gate = await peopleActor(locale);
  if (!gate.ok) return failed(gate.failure);

  const result = await peopleRuntime().people.setProfileTranslation(gate.actor, {
    personId: parsed.data.personId,
    kind: parsed.data.kind,
    locale: parsed.data.contentLocale,
    qualifications: absentIfEmpty(parsed.data.qualifications),
    expertise: absentIfEmpty(parsed.data.expertise),
    biography: absentIfEmpty(parsed.data.biography),
    subjects: absentIfEmpty(parsed.data.subjects),
  });
  if (!result.ok) return failed(result.failure);

  refresh(locale, result.person.slug);
  return OK;
}

/**
 * The content languages one profile lists.
 *
 * ONE SPACE- OR COMMA-SEPARATED FIELD, parsed into a SET here. The alternative
 * was a repeating control, which a form without JavaScript cannot add rows to —
 * and these surfaces work without it (ARCHITECTURE.md §7).
 *
 * BOUNDED BEFORE VALIDATION, so a submission with ten thousand codes is
 * rejected by a length check rather than by running ten thousand regular
 * expressions.
 */
const profileLanguagesSchema = z.object({
  personId: idSchema,
  kind: profileKindSchema,
  languages: z
    .string()
    .trim()
    .max(400)
    .transform((value) => value.split(/[\s,]+/u).filter((entry) => entry !== ''))
    .pipe(z.array(contributorLanguageCodeSchema).max(MAX_PROFILE_LANGUAGES)),
});

export async function setProfileLanguagesAction(
  _previous: PeopleActionState,
  form: FormData,
): Promise<PeopleActionState> {
  const locale = localeFrom(form);
  const parsed = profileLanguagesSchema.safeParse({
    personId: form.get('personId'),
    kind: form.get('kind'),
    languages: form.get('languages') ?? '',
  });
  if (!parsed.success) return invalid();

  const gate = await peopleActor(locale);
  if (!gate.ok) return failed(gate.failure);

  const result = await peopleRuntime().people.setProfileLanguages(
    gate.actor,
    parsed.data,
  );
  if (!result.ok) return failed(result.failure);

  refresh(locale, result.person.slug);
  return OK;
}
