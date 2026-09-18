'use server';

import { revalidatePath } from 'next/cache';

import { localeSchema } from '@minhaj/contracts';
import {
  languageCodeSchema,
  languageDirectionSchema,
  languageEnglishNameSchema,
  languageNativeNameSchema,
  languageStatusSchema,
  tagLabelSchema,
  tagSlugSchema,
  tagStatusSchema,
  topicDescriptionSchema,
  topicLocaleSchema,
  topicNameSchema,
  topicSlugSchema,
  topicStatusSchema,
} from '@minhaj/contracts/taxonomy';
import type { AuthorizationDenial } from '@minhaj/server-core/authorization';
import { z } from 'zod';

import { requirePermittedAction } from '@/composition/authorization';
import { taxonomyRuntime } from '@/composition/taxonomy';
import type { TaxonomyActor, TaxonomyFailure } from '@/contexts/taxonomy';

/**
 * THE taxonomy mutation surface.
 *
 * Every function here is a Class-A browser mutation (SECURITY_BASELINE.md
 * §7.1): a Server Action, carrying the framework's Origin and CSRF protections,
 * and unreachable by GET. There is no `/api/admin/taxonomy/*` route, because a
 * route would be a second path to these operations sitting outside these
 * wrappers.
 *
 * EVERY ONE RE-CHECKS AUTHORISATION INDEPENDENTLY. The page that rendered the
 * form checked `taxonomy.read` to decide what to show; that decision is
 * navigational and is not reused here. `requirePermittedAction` resolves the
 * session again and reads the permission set live, because the minutes between
 * a render and a submit are long enough for a role to be revoked (§3.4 rule 2).
 *
 * PERMISSION, AND NO STEP-UP. SECURITY_BASELINE.md §8.1 names the operations
 * that cost a step-up grant and a complete second-factor posture — privilege
 * grants, canonical Quran and Hadith edits, Fatwa publication, migration
 * publication, account administration, destructive bulk operations. Editing the
 * subject taxonomy is none of them, and §8.2 states the requirement is
 * "deliberately not universal". The alternative would have been a fourth
 * `StepUpPurpose`, and the Phase-2 contract closed that vocabulary at three
 * precisely so a scope could not be invented for an operation that does not
 * match one of the consequence classes it names.
 *
 * WHAT IS ABSENT, DELIBERATELY. Any action that assigns a topic to a content
 * record. No context owning such a target has shipped, and a generic
 * `assignTopic(targetType, targetId)` would be the polymorphic reference
 * DOMAIN_MODEL.md §6.2 prohibits (see `src/contexts/taxonomy/index.ts` for the
 * integration rule a later owner follows instead).
 */

/** Every way a taxonomy action can refuse. */
export type TaxonomyActionFailure =
  AuthorizationDenial | TaxonomyFailure | 'no-session' | 'invalid-input';

export interface TaxonomyActionState {
  readonly status: 'idle' | 'success' | 'error';
  readonly failure?: TaxonomyActionFailure;
}

const OK: TaxonomyActionState = { status: 'success' };

function invalid(): TaxonomyActionState {
  return { status: 'error', failure: 'invalid-input' };
}

function failed(failure: TaxonomyActionFailure): TaxonomyActionState {
  return { status: 'error', failure };
}

function localeFrom(form: FormData): string {
  const parsed = localeSchema.safeParse(form.get('locale'));
  return parsed.success ? parsed.data : 'en';
}

/**
 * Re-renders the administrative tree after a change it displays.
 *
 * Scoped to `/admin`: nothing outside it shows a topic yet — the public
 * `/topics` browser is a later phase — and revalidating the whole application
 * would throw away caches that have nothing to do with this.
 */
function refresh(locale: string): void {
  revalidatePath(`/${locale}/admin`, 'layout');
}

/**
 * Resolves the caller, or says why not.
 *
 * ONE PLACE, so no action can be written that forgets the gate. What it returns
 * is an audit attribution, not a capability: the authority was settled by
 * `requirePermittedAction` before this function returns, and `TaxonomyActor`
 * exists so the audit row can say who acted and under which permission.
 */
async function taxonomyActor(
  locale: string,
): Promise<
  | { readonly ok: true; readonly actor: TaxonomyActor }
  | { readonly ok: false; readonly failure: TaxonomyActionFailure }
> {
  const gate = await requirePermittedAction(locale, 'taxonomy.administer');
  if (gate.state === 'denied') return { ok: false, failure: gate.reason };

  return {
    ok: true,
    actor: {
      accountId: gate.session.account.id,
      permission: 'taxonomy.administer',
    },
  };
}

/* ===========================================================================
 * Topics
 * ========================================================================= */

/** A topic identifier, as a form carries it. */
const topicIdSchema = z.string().trim().min(1).max(36);

/**
 * `''` means "the root", because an HTML select cannot carry `null`.
 *
 * Normalised HERE, at the boundary, rather than letting every action repeat the
 * conversion — and rather than letting the string `''` reach a service that
 * would treat it as an identifier nothing matches.
 */
const parentIdSchema = z
  .string()
  .trim()
  .max(36)
  .transform((value) => (value === '' ? null : value));

const createTopicSchema = z.object({
  slug: topicSlugSchema,
  parentId: parentIdSchema,
  name: topicNameSchema,
  description: topicDescriptionSchema,
});

export async function createTopicAction(
  _previous: TaxonomyActionState,
  form: FormData,
): Promise<TaxonomyActionState> {
  const locale = localeFrom(form);
  const parsed = createTopicSchema.safeParse({
    slug: form.get('slug'),
    parentId: form.get('parentId') ?? '',
    name: form.get('name'),
    description: form.get('description') ?? '',
  });
  if (!parsed.success) return invalid();

  const gate = await taxonomyActor(locale);
  if (!gate.ok) return failed(gate.failure);

  const result = await taxonomyRuntime().taxonomy.createTopic(gate.actor, {
    slug: parsed.data.slug,
    parentId: parsed.data.parentId,
    name: parsed.data.name,
    // An empty description is ABSENT, not an empty string. A stored `''` is a
    // description that exists and says nothing, which no surface can
    // distinguish from one somebody meant to write.
    description: parsed.data.description === '' ? null : parsed.data.description,
  });
  if (!result.ok) return failed(result.failure);

  refresh(locale);
  return OK;
}

const translationSchema = z.object({
  topicId: topicIdSchema,
  // The CONTENT locale of the translation being written — which is an interface
  // locale, and is validated against the platform's locale vocabulary rather
  // than against the content-language catalogue. The two are separate concerns
  // (DOMAIN_MODEL.md §6.3, §18).
  translationLocale: topicLocaleSchema,
  name: topicNameSchema,
  description: topicDescriptionSchema,
});

export async function setTopicTranslationAction(
  _previous: TaxonomyActionState,
  form: FormData,
): Promise<TaxonomyActionState> {
  const locale = localeFrom(form);
  const parsed = translationSchema.safeParse({
    topicId: form.get('topicId'),
    translationLocale: form.get('translationLocale'),
    name: form.get('name'),
    description: form.get('description') ?? '',
  });
  if (!parsed.success) return invalid();

  const gate = await taxonomyActor(locale);
  if (!gate.ok) return failed(gate.failure);

  const result = await taxonomyRuntime().taxonomy.setTopicTranslation(gate.actor, {
    topicId: parsed.data.topicId,
    locale: parsed.data.translationLocale,
    name: parsed.data.name,
    description: parsed.data.description === '' ? null : parsed.data.description,
  });
  if (!result.ok) return failed(result.failure);

  refresh(locale);
  return OK;
}

const removeTranslationSchema = z.object({
  topicId: topicIdSchema,
  translationLocale: topicLocaleSchema,
});

export async function removeTopicTranslationAction(
  _previous: TaxonomyActionState,
  form: FormData,
): Promise<TaxonomyActionState> {
  const locale = localeFrom(form);
  const parsed = removeTranslationSchema.safeParse({
    topicId: form.get('topicId'),
    translationLocale: form.get('translationLocale'),
  });
  if (!parsed.success) return invalid();

  const gate = await taxonomyActor(locale);
  if (!gate.ok) return failed(gate.failure);

  const result = await taxonomyRuntime().taxonomy.removeTopicTranslation(gate.actor, {
    topicId: parsed.data.topicId,
    locale: parsed.data.translationLocale,
  });
  if (!result.ok) return failed(result.failure);

  refresh(locale);
  return OK;
}

const moveSchema = z.object({
  topicId: topicIdSchema,
  parentId: parentIdSchema,
});

/**
 * Re-parents a topic.
 *
 * The cycle refusal comes from the database, under a lock every hierarchy write
 * takes — so an administrator who tries to move a topic beneath its own
 * descendant is told so, and two administrators who try to do it to each other
 * at the same moment cannot both succeed.
 */
export async function moveTopicAction(
  _previous: TaxonomyActionState,
  form: FormData,
): Promise<TaxonomyActionState> {
  const locale = localeFrom(form);
  const parsed = moveSchema.safeParse({
    topicId: form.get('topicId'),
    parentId: form.get('parentId') ?? '',
  });
  if (!parsed.success) return invalid();

  const gate = await taxonomyActor(locale);
  if (!gate.ok) return failed(gate.failure);

  const result = await taxonomyRuntime().taxonomy.moveTopic(gate.actor, parsed.data);
  if (!result.ok) return failed(result.failure);

  refresh(locale);
  return OK;
}

const reorderSchema = z.object({
  parentId: parentIdSchema,
  // Bounded: an ordering longer than one administrative page is not an
  // ordering anybody submitted from this interface.
  orderedTopicIds: z.array(topicIdSchema).min(1).max(200),
});

export async function reorderTopicsAction(
  _previous: TaxonomyActionState,
  form: FormData,
): Promise<TaxonomyActionState> {
  const locale = localeFrom(form);
  const parsed = reorderSchema.safeParse({
    parentId: form.get('parentId') ?? '',
    orderedTopicIds: form.getAll('orderedTopicIds'),
  });
  if (!parsed.success) return invalid();

  const gate = await taxonomyActor(locale);
  if (!gate.ok) return failed(gate.failure);

  const result = await taxonomyRuntime().taxonomy.reorderTopics(gate.actor, parsed.data);
  if (!result.ok) return failed(result.failure);

  refresh(locale);
  return OK;
}

const topicStatusSchemaInput = z.object({
  topicId: topicIdSchema,
  status: topicStatusSchema,
});

export async function setTopicStatusAction(
  _previous: TaxonomyActionState,
  form: FormData,
): Promise<TaxonomyActionState> {
  const locale = localeFrom(form);
  const parsed = topicStatusSchemaInput.safeParse({
    topicId: form.get('topicId'),
    status: form.get('status'),
  });
  if (!parsed.success) return invalid();

  const gate = await taxonomyActor(locale);
  if (!gate.ok) return failed(gate.failure);

  const result = await taxonomyRuntime().taxonomy.setTopicStatus(gate.actor, parsed.data);
  if (!result.ok) return failed(result.failure);

  refresh(locale);
  return OK;
}

/* ===========================================================================
 * Content languages
 * ========================================================================= */

const languageSchema = z.object({
  code: languageCodeSchema,
  englishName: languageEnglishNameSchema,
  nativeName: languageNativeNameSchema,
  direction: languageDirectionSchema,
});

/**
 * Adds a CONTENT language.
 *
 * It does not add an interface locale, and there is deliberately no action
 * anywhere that does: the supported interface locales are a compiled contract
 * (ROUTE_MAP.md §1.2), not administrable data. A screen that could add `fa`
 * here and thereby create `/fa/...` routing with no message catalogue behind it
 * would be the conflation DOMAIN_MODEL.md §18 names, delivered as a feature.
 */
export async function createLanguageAction(
  _previous: TaxonomyActionState,
  form: FormData,
): Promise<TaxonomyActionState> {
  const locale = localeFrom(form);
  const parsed = languageSchema.safeParse({
    code: form.get('code'),
    englishName: form.get('englishName'),
    nativeName: form.get('nativeName'),
    direction: form.get('direction'),
  });
  if (!parsed.success) return invalid();

  const gate = await taxonomyActor(locale);
  if (!gate.ok) return failed(gate.failure);

  const result = await taxonomyRuntime().taxonomy.createLanguage(gate.actor, parsed.data);
  if (!result.ok) return failed(result.failure);

  refresh(locale);
  return OK;
}

export async function updateLanguageAction(
  _previous: TaxonomyActionState,
  form: FormData,
): Promise<TaxonomyActionState> {
  const locale = localeFrom(form);
  const parsed = languageSchema.safeParse({
    code: form.get('code'),
    englishName: form.get('englishName'),
    nativeName: form.get('nativeName'),
    direction: form.get('direction'),
  });
  if (!parsed.success) return invalid();

  const gate = await taxonomyActor(locale);
  if (!gate.ok) return failed(gate.failure);

  const result = await taxonomyRuntime().taxonomy.updateLanguage(gate.actor, parsed.data);
  if (!result.ok) return failed(result.failure);

  refresh(locale);
  return OK;
}

const languageStatusInput = z.object({
  code: languageCodeSchema,
  status: languageStatusSchema,
});

export async function setLanguageStatusAction(
  _previous: TaxonomyActionState,
  form: FormData,
): Promise<TaxonomyActionState> {
  const locale = localeFrom(form);
  const parsed = languageStatusInput.safeParse({
    code: form.get('code'),
    status: form.get('status'),
  });
  if (!parsed.success) return invalid();

  const gate = await taxonomyActor(locale);
  if (!gate.ok) return failed(gate.failure);

  const result = await taxonomyRuntime().taxonomy.setLanguageStatus(
    gate.actor,
    parsed.data,
  );
  if (!result.ok) return failed(result.failure);

  refresh(locale);
  return OK;
}

/* ===========================================================================
 * Tags
 * ========================================================================= */

const tagIdSchema = z.string().trim().min(1).max(36);

const createTagSchema = z.object({
  slug: tagSlugSchema,
  label: tagLabelSchema,
});

export async function createTagAction(
  _previous: TaxonomyActionState,
  form: FormData,
): Promise<TaxonomyActionState> {
  const locale = localeFrom(form);
  const parsed = createTagSchema.safeParse({
    slug: form.get('slug'),
    label: form.get('label'),
  });
  if (!parsed.success) return invalid();

  const gate = await taxonomyActor(locale);
  if (!gate.ok) return failed(gate.failure);

  const result = await taxonomyRuntime().taxonomy.createTag(gate.actor, parsed.data);
  if (!result.ok) return failed(result.failure);

  refresh(locale);
  return OK;
}

const relabelTagSchema = z.object({
  tagId: tagIdSchema,
  label: tagLabelSchema,
});

export async function relabelTagAction(
  _previous: TaxonomyActionState,
  form: FormData,
): Promise<TaxonomyActionState> {
  const locale = localeFrom(form);
  const parsed = relabelTagSchema.safeParse({
    tagId: form.get('tagId'),
    label: form.get('label'),
  });
  if (!parsed.success) return invalid();

  const gate = await taxonomyActor(locale);
  if (!gate.ok) return failed(gate.failure);

  const result = await taxonomyRuntime().taxonomy.relabelTag(gate.actor, parsed.data);
  if (!result.ok) return failed(result.failure);

  refresh(locale);
  return OK;
}

const tagStatusInput = z.object({
  tagId: tagIdSchema,
  status: tagStatusSchema,
});

export async function setTagStatusAction(
  _previous: TaxonomyActionState,
  form: FormData,
): Promise<TaxonomyActionState> {
  const locale = localeFrom(form);
  const parsed = tagStatusInput.safeParse({
    tagId: form.get('tagId'),
    status: form.get('status'),
  });
  if (!parsed.success) return invalid();

  const gate = await taxonomyActor(locale);
  if (!gate.ok) return failed(gate.failure);

  const result = await taxonomyRuntime().taxonomy.setTagStatus(gate.actor, parsed.data);
  if (!result.ok) return failed(result.failure);

  refresh(locale);
  return OK;
}
