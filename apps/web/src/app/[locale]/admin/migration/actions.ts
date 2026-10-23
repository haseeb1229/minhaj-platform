'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { localeSchema, type Locale } from '@minhaj/contracts';

import { textarea, whole } from '@/components/personal/action-support';
import {
  requirePermittedAction,
  requirePrivilegedActor,
} from '@/composition/authorization';
import { appLogger } from '@/composition/logging';
import { migrationRuntime } from '@/composition/migration';
import { migrationFailure } from '@/contexts/migration-provenance';
import type { FormActionState } from '../../(identity)/form-state';

/**
 * The Migration administrative mutations (DELIVERY_PLAN.md Phase 29): fixture
 * sources, cancelling a run, review, duplicates, topic and legacy mappings,
 * errors and disappearances, asset rights, raw-evidence disposal, manifests
 * and promotions.
 *
 * EVERY ONE IS A CLASS-A SERVER ACTION, carrying the framework's Origin
 * protection and unreachable by GET, and each RE-RESOLVES THE SESSION AND
 * RE-CHECKS ITS KEY here — the page that rendered the form decided only
 * whether to show it (SECURITY_BASELINE.md §3.4 rule 2) — and the service
 * checks the key again, live.
 *
 * TWO GATES, CHOSEN BY CONSEQUENCE. Everything that prepares, reviews or
 * corrects migration state re-checks `migration.administer` through
 * `requirePermittedAction`. Publishing a manifest, rolling one back and
 * approving a promotion put content into — or take it out of — the live
 * platform, so they go through `requirePrivilegedActor` with
 * `migration.publish` (externally gated, bundled into no role), a complete
 * second-factor posture and a live step-up for exactly
 * `migration-publication`; the service re-verifies that actor and the
 * database trigger checks a third time.
 *
 * UNDER AN EXPECTED VERSION. Every act on an existing row carries the version
 * the operator was shown, so a stale page meets a visible conflict, never a
 * silent second act.
 *
 * NO MASS ASSIGNMENT. Each action reads the fields its form names, by name,
 * and hands them to the service, whose strict schemas decide what they mean.
 * Nothing typed is echoed or logged; an outage is logged as `{ operation }`.
 */

const DONE: FormActionState = { status: 'success' };
const UNCONFIRMED: FormActionState = { status: 'error', failure: 'confirm-required' };

function localeOf(form: FormData): Locale {
  const parsed = localeSchema.safeParse(form.get('locale'));
  return parsed.success ? parsed.data : 'en';
}

/** One text field, as typed; the service validates its shape. Absent is empty. */
function field(form: FormData, name: string): string {
  const raw = form.get(name);
  return typeof raw === 'string' ? raw : '';
}

/** An optional text field: blank is `null`, never an empty value the schema must guess at. */
function optional(form: FormData, name: string): string | null {
  const value = field(form, name).trim();
  return value === '' ? null : value;
}

/** The refusal the service named, or `unavailable` — logged by operation name alone. */
function rejected(error: unknown, operation: string): FormActionState {
  const failure = migrationFailure(error);
  if (failure === 'unavailable')
    appLogger().error({ operation }, 'Migration action failed.');
  return { status: 'error', failure };
}

/** The locale, then the live `migration.administer` check: who acts, or the refusal. */
async function administer(
  form: FormData,
): Promise<
  | { readonly locale: Locale; readonly accountId: string }
  | { readonly refused: FormActionState }
> {
  const locale = localeOf(form);
  const permitted = await requirePermittedAction(locale, 'migration.administer');
  if (permitted.state === 'denied')
    return { refused: { status: 'error', failure: permitted.reason } };
  return { locale, accountId: permitted.session.account.id };
}

/** The privileged publisher gate: `migration.publish` + `migration-publication`. */
async function publisher(form: FormData) {
  const locale = localeOf(form);
  const gate = await requirePrivilegedActor(
    locale,
    'migration.publish',
    'migration-publication',
  );
  return { locale, gate };
}

function refreshed(locale: Locale): void {
  revalidatePath(`/${locale}/admin/migration`, 'layout');
}

/** The version-checked identity every act on an existing row carries. */
function versioned(form: FormData) {
  return { id: field(form, 'id'), expectedVersion: whole(form, 'version') };
}

/** The source policy, as six whole numbers; the strict schema bounds each. */
function policyOf(form: FormData) {
  return {
    minIntervalMs: whole(form, 'minIntervalMs'),
    maxConcurrency: whole(form, 'maxConcurrency'),
    maxAttempts: whole(form, 'maxAttempts'),
    timeoutMs: whole(form, 'timeoutMs'),
    maxBodyBytes: whole(form, 'maxBodyBytes'),
    maxRedirects: whole(form, 'maxRedirects'),
  };
}

/* ===========================================================================
 * Sources — `migration.administer`
 * ========================================================================= */

/**
 * Registers a FIXTURE source. The form has no authority field: the kind is not
 * the operator's to choose, and the service refuses a request that names one.
 */
export async function createSourceAction(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  const actor = await administer(form);
  if ('refused' in actor) return actor.refused;
  const accessMethod = field(form, 'accessMethod');
  try {
    await migrationRuntime().sources.createFixture(
      { accountId: actor.accountId },
      {
        key: field(form, 'key'),
        name: field(form, 'name'),
        contentKind: 'media.video',
        accessMethod,
        baseUrl: accessMethod === 'export' ? null : optional(form, 'baseUrl'),
        hosts: (textarea(form, 'hosts') ?? '')
          .split('\n')
          .map((host) => host.trim())
          .filter((host) => host !== ''),
        defaultLanguageCode: optional(form, 'defaultLanguageCode'),
        policy: policyOf(form),
        licensingEvidence: textarea(form, 'licensingEvidence') ?? '',
        policyNotes: textarea(form, 'policyNotes') ?? '',
      },
    );
  } catch (error) {
    return rejected(error, 'migration-source-create');
  }
  refreshed(actor.locale);
  return DONE;
}

/** Changes what may change on a source — never its key, kind, access or hosts. */
export async function updateSourceAction(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  const actor = await administer(form);
  if ('refused' in actor) return actor.refused;
  try {
    await migrationRuntime().sources.update(
      { accountId: actor.accountId },
      {
        ...versioned(form),
        name: field(form, 'name'),
        state: field(form, 'state'),
        defaultLanguageCode: optional(form, 'defaultLanguageCode'),
        policy: policyOf(form),
        licensingEvidence: textarea(form, 'licensingEvidence') ?? '',
        policyNotes: textarea(form, 'policyNotes') ?? '',
      },
    );
  } catch (error) {
    return rejected(error, 'migration-source-update');
  }
  refreshed(actor.locale);
  return DONE;
}

/* ===========================================================================
 * Runs — `migration.administer`
 * ========================================================================= */

/** Cancels an open run at the version the operator saw, after a confirmation. */
export async function cancelRunAction(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  if (form.get('confirm') !== 'on') return UNCONFIRMED;
  const actor = await administer(form);
  if ('refused' in actor) return actor.refused;
  const { id, expectedVersion } = versioned(form);
  try {
    await migrationRuntime().pipeline.cancel(
      { accountId: actor.accountId },
      { runId: id, expectedVersion },
    );
  } catch (error) {
    return rejected(error, 'migration-run-cancel');
  }
  refreshed(actor.locale);
  return DONE;
}

/* ===========================================================================
 * Decisions — `migration.administer`
 * ========================================================================= */

/** approve | reject | withdraw-approval of one staged revision. */
export async function reviewAction(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  const actor = await administer(form);
  if ('refused' in actor) return actor.refused;
  const { id, expectedVersion } = versioned(form);
  try {
    await migrationRuntime().decisions.review(
      { accountId: actor.accountId },
      {
        stagedRecordId: id,
        expectedVersion,
        decision: field(form, 'decision'),
        note: textarea(form, 'note') ?? '',
      },
    );
  } catch (error) {
    return rejected(error, 'migration-review');
  }
  refreshed(actor.locale);
  return DONE;
}

/** merge | distinct | reopen one duplicate candidate. */
export async function duplicateAction(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  const actor = await administer(form);
  if ('refused' in actor) return actor.refused;
  const { id, expectedVersion } = versioned(form);
  try {
    await migrationRuntime().decisions.duplicate(
      { accountId: actor.accountId },
      {
        candidateId: id,
        expectedVersion,
        decision: field(form, 'decision'),
        note: textarea(form, 'note') ?? '',
      },
    );
  } catch (error) {
    return rejected(error, 'migration-duplicate');
  }
  refreshed(actor.locale);
  return DONE;
}

/** confirm (to a Topic Taxonomy names) | exclude | reopen one category mapping. */
export async function topicMappingAction(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  const actor = await administer(form);
  if ('refused' in actor) return actor.refused;
  const { id, expectedVersion } = versioned(form);
  const decision = field(form, 'decision');
  try {
    await migrationRuntime().decisions.topicMapping(
      { accountId: actor.accountId },
      {
        mappingId: id,
        expectedVersion,
        decision,
        topicId: decision === 'confirm' ? optional(form, 'topicId') : null,
      },
    );
  } catch (error) {
    return rejected(error, 'migration-topic-mapping');
  }
  refreshed(actor.locale);
  return DONE;
}

/** Disables or re-enables one legacy mapping (and so its redirect). */
export async function legacyMappingAction(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  const actor = await administer(form);
  if ('refused' in actor) return actor.refused;
  const { id, expectedVersion } = versioned(form);
  try {
    await migrationRuntime().decisions.legacyMapping(
      { accountId: actor.accountId },
      { mappingId: id, expectedVersion, state: field(form, 'state') },
    );
  } catch (error) {
    return rejected(error, 'migration-legacy-mapping');
  }
  refreshed(actor.locale);
  return DONE;
}

/** retry (a retry-eligible error only) | dismiss one error. */
export async function errorAction(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  const actor = await administer(form);
  if ('refused' in actor) return actor.refused;
  const { id, expectedVersion } = versioned(form);
  try {
    await migrationRuntime().decisions.error(
      { accountId: actor.accountId },
      { errorId: id, expectedVersion, decision: field(form, 'decision') },
    );
  } catch (error) {
    return rejected(error, 'migration-error-decision');
  }
  refreshed(actor.locale);
  return DONE;
}

/** Classifies a MISSING record. Deletes and unpublishes nothing. */
export async function disappearanceAction(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  const actor = await administer(form);
  if ('refused' in actor) return actor.refused;
  const { id, expectedVersion } = versioned(form);
  try {
    await migrationRuntime().decisions.disappearance(
      { accountId: actor.accountId },
      {
        recordId: id,
        expectedVersion,
        classification: field(form, 'classification'),
        note: textarea(form, 'note') ?? '',
      },
    );
  } catch (error) {
    return rejected(error, 'migration-disappearance');
  }
  refreshed(actor.locale);
  return DONE;
}

/**
 * The rights of ONE acquisition. Never another acquisition's, whatever its
 * bytes: identical bytes acquired from another address are another decision.
 */
export async function rightsAction(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  const actor = await administer(form);
  if ('refused' in actor) return actor.refused;
  const { id, expectedVersion } = versioned(form);
  try {
    await migrationRuntime().decisions.rights(
      { accountId: actor.accountId },
      {
        provenanceId: id,
        expectedVersion,
        licence: field(form, 'licence'),
        visibility: field(form, 'visibility'),
        licenceEvidence: textarea(form, 'licenceEvidence') ?? '',
        rightsHolder: field(form, 'rightsHolder'),
      },
    );
  } catch (error) {
    return rejected(error, 'migration-rights');
  }
  refreshed(actor.locale);
  return DONE;
}

/* ===========================================================================
 * Raw evidence — `migration.administer`
 * ========================================================================= */

/**
 * Disposes of one snapshot's BODY, for a stated reason, after an explicit
 * confirmation. Its metadata and checksum remain; the act is audited.
 */
export async function disposeSnapshotAction(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  if (form.get('confirm') !== 'on') return UNCONFIRMED;
  const actor = await administer(form);
  if ('refused' in actor) return actor.refused;
  try {
    await migrationRuntime().raw.dispose(
      { accountId: actor.accountId },
      { snapshotId: field(form, 'snapshotId'), reason: textarea(form, 'reason') ?? '' },
    );
  } catch (error) {
    return rejected(error, 'migration-snapshot-dispose');
  }
  refreshed(actor.locale);
  return DONE;
}

/* ===========================================================================
 * Manifests — prepared under `migration.administer`, published under
 * `migration.publish` with a live `migration-publication` step-up
 * ========================================================================= */

/** A draft manifest over approved revisions of one completed, balanced run. */
export async function createManifestAction(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  const actor = await administer(form);
  if ('refused' in actor) return actor.refused;
  let id: string;
  try {
    ({ id } = await migrationRuntime().publication.createManifest(
      { accountId: actor.accountId },
      {
        runId: field(form, 'runId'),
        stagedRecordIds: form
          .getAll('stagedRecordId')
          .filter((value): value is string => typeof value === 'string'),
      },
    ));
  } catch (error) {
    return rejected(error, 'migration-manifest-create');
  }
  refreshed(actor.locale);
  // Outside the try: `redirect` signals by throwing, and that is not a failure.
  redirect(`/${actor.locale}/admin/migration/manifests/${encodeURIComponent(id)}`);
}

/** Discards a draft manifest; nothing was published from it. */
export async function discardManifestAction(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  if (form.get('confirm') !== 'on') return UNCONFIRMED;
  const actor = await administer(form);
  if ('refused' in actor) return actor.refused;
  const { id, expectedVersion } = versioned(form);
  try {
    await migrationRuntime().publication.discard(
      { accountId: actor.accountId },
      { manifestId: id, expectedVersion },
    );
  } catch (error) {
    return rejected(error, 'migration-manifest-discard');
  }
  refreshed(actor.locale);
  return DONE;
}

/**
 * Publishes — or resumes publishing — a manifest through its target's own
 * public interface. What the run did is said in words: finished, finished
 * with entries the target refused, or stopped because the target did not
 * answer (resumable; nothing was assumed).
 */
export async function publishManifestAction(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  if (form.get('confirm') !== 'on') return UNCONFIRMED;
  const { locale, gate } = await publisher(form);
  if (gate.state === 'denied') return { status: 'error', failure: gate.reason };
  const { id, expectedVersion } = versioned(form);
  let summary: { readonly refused: number; readonly stopped: string | null };
  try {
    summary = await migrationRuntime().publication.publish(gate.actor, {
      manifestId: id,
      expectedVersion,
    });
  } catch (error) {
    return rejected(error, 'migration-manifest-publish');
  }
  refreshed(locale);
  if (summary.stopped !== null) return { status: 'error', failure: 'target-unavailable' };
  return summary.refused > 0 ? { status: 'error', failure: 'entries-refused' } : DONE;
}

/** Rolls back — or resumes rolling back — a published manifest, for a stated reason. */
export async function rollbackManifestAction(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  if (form.get('confirm') !== 'on') return UNCONFIRMED;
  const { locale, gate } = await publisher(form);
  if (gate.state === 'denied') return { status: 'error', failure: gate.reason };
  const { id, expectedVersion } = versioned(form);
  let summary: { readonly refused: number; readonly stopped: string | null };
  try {
    summary = await migrationRuntime().publication.rollback(gate.actor, {
      manifestId: id,
      expectedVersion,
      reason: textarea(form, 'reason') ?? '',
    });
  } catch (error) {
    return rejected(error, 'migration-manifest-rollback');
  }
  refreshed(locale);
  if (summary.stopped !== null) return { status: 'error', failure: 'target-unavailable' };
  return summary.refused > 0 ? { status: 'error', failure: 'entries-left' } : DONE;
}

/* ===========================================================================
 * Promotions — created and withdrawn under `migration.administer`, approved
 * under `migration.publish`; carried by the CLI, never from here
 * ========================================================================= */

/** A draft promotion over published entries of one manifest. */
export async function createPromotionAction(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  const actor = await administer(form);
  if ('refused' in actor) return actor.refused;
  try {
    await migrationRuntime().promotion.create(
      { accountId: actor.accountId },
      {
        manifestEntryIds: form
          .getAll('manifestEntryId')
          .filter((value): value is string => typeof value === 'string'),
      },
    );
  } catch (error) {
    return rejected(error, 'migration-promotion-create');
  }
  refreshed(actor.locale);
  return DONE;
}

/** draft → approved, as a verified publisher. */
export async function approvePromotionAction(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  if (form.get('confirm') !== 'on') return UNCONFIRMED;
  const { locale, gate } = await publisher(form);
  if (gate.state === 'denied') return { status: 'error', failure: gate.reason };
  const { id, expectedVersion } = versioned(form);
  try {
    await migrationRuntime().promotion.approve(gate.actor, {
      promotionId: id,
      expectedVersion,
    });
  } catch (error) {
    return rejected(error, 'migration-promotion-approve');
  }
  refreshed(locale);
  return DONE;
}

/** Withdraws a promotion (or its approval) until it completes. */
export async function withdrawPromotionAction(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  const actor = await administer(form);
  if ('refused' in actor) return actor.refused;
  const { id, expectedVersion } = versioned(form);
  try {
    await migrationRuntime().promotion.withdraw(
      { accountId: actor.accountId },
      { promotionId: id, expectedVersion },
    );
  } catch (error) {
    return rejected(error, 'migration-promotion-withdraw');
  }
  refreshed(actor.locale);
  return DONE;
}
