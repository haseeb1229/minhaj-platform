'use server';

import { redirect } from 'next/navigation';

import {
  DONE,
  INVALID,
  UNCONFIRMED,
  personalGate,
  refreshMy,
  rejected,
  textarea,
  whole,
} from '@/components/personal/action-support';
import { decodeTarget } from '@/components/personal/presentation';
import { personalisationRuntime } from '@/composition/personalisation';
import type { FormActionState } from '../../(identity)/form-state';

/**
 * Saved items — bookmarks, notes and private collections — as the person
 * manages them from `/my/saved` (ROUTE_MAP.md §5.1; Phase 21).
 *
 * EVERY ONE IS A CLASS-A BROWSER MUTATION (SECURITY_BASELINE.md §7.1) — a
 * Server Action, under the framework's Origin checks and unreachable by GET.
 * Each resolves the session itself and acts as that account only; the service
 * and the adapter put the account in every predicate, so an id that belongs to
 * somebody else answers exactly as one that does not exist.
 *
 * NO MASS ASSIGNMENT. Each action names the fields it reads and hands them to
 * the service, which parses them with the contract's strict schemas. A
 * submitted `version` is an EXPECTED version — compared, never trusted.
 *
 * A NOTE IS NEVER ECHOED, LOGGED OR PUT IN A URL. A refusal is a category key,
 * and the text stays in the person's own form.
 */

/** Removes one bookmark. Idempotent: an already-removed one changes nothing. */
export async function unbookmarkAction(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  const gate = await personalGate(form);
  if ('refused' in gate) return gate.refused;
  const target = decodeTarget(form.get('target'));
  if (target === null) return INVALID;
  try {
    await personalisationRuntime().saved.unbookmark(gate.actor, target);
  } catch (error) {
    return rejected(error, 'personal-unbookmark');
  }
  refreshMy(gate.locale);
  return DONE;
}

/** Saves an edit to a note, under the version the person read. */
export async function writeNoteAction(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  const gate = await personalGate(form);
  if ('refused' in gate) return gate.refused;
  const target = decodeTarget(form.get('target'));
  if (target === null) return INVALID;
  try {
    await personalisationRuntime().saved.writeNote(gate.actor, {
      target,
      body: textarea(form, 'body'),
      expectedVersion: whole(form, 'version'),
    });
  } catch (error) {
    return rejected(error, 'personal-note-write');
  }
  refreshMy(gate.locale);
  return DONE;
}

/** Deletes a note, under the version the person read. */
export async function removeNoteAction(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  const gate = await personalGate(form);
  if ('refused' in gate) return gate.refused;
  const target = decodeTarget(form.get('target'));
  if (target === null) return INVALID;
  try {
    await personalisationRuntime().saved.removeNote(gate.actor, {
      target,
      expectedVersion: whole(form, 'version'),
    });
  } catch (error) {
    return rejected(error, 'personal-note-remove');
  }
  refreshMy(gate.locale);
  return DONE;
}

/** A collection's optional description: an EMPTY field is none. */
function description(form: FormData): string | null {
  const text = textarea(form, 'description');
  return text === null || text.trim() === '' ? null : text;
}

/** Creates a private collection and opens it. */
export async function createCollectionAction(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  const gate = await personalGate(form);
  if ('refused' in gate) return gate.refused;
  let id: string;
  try {
    ({ id } = await personalisationRuntime().saved.createCollection(gate.actor, {
      title: form.get('title'),
      description: description(form),
    }));
  } catch (error) {
    return rejected(error, 'personal-collection-create');
  }
  refreshMy(gate.locale);
  // Outside the try: `redirect` signals by throwing, and that is not a failure.
  redirect(`/${gate.locale}/my/saved/collections/${encodeURIComponent(id)}`);
}

/** Renames or re-describes a collection, under the version the person read. */
export async function updateCollectionAction(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  const gate = await personalGate(form);
  if ('refused' in gate) return gate.refused;
  try {
    await personalisationRuntime().saved.updateCollection(gate.actor, {
      collectionId: form.get('collectionId'),
      title: form.get('title'),
      description: description(form),
      expectedVersion: whole(form, 'version'),
    });
  } catch (error) {
    return rejected(error, 'personal-collection-update');
  }
  refreshMy(gate.locale);
  return DONE;
}

/**
 * Deletes a collection — the list, never the saved targets' bookmarks or notes —
 * after an explicit confirmation, and returns to the list.
 */
export async function removeCollectionAction(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  if (form.get('confirm') !== 'on') return UNCONFIRMED;
  const gate = await personalGate(form);
  if ('refused' in gate) return gate.refused;
  try {
    await personalisationRuntime().saved.removeCollection(gate.actor, {
      collectionId: form.get('collectionId'),
      expectedVersion: whole(form, 'version'),
    });
  } catch (error) {
    return rejected(error, 'personal-collection-remove');
  }
  refreshMy(gate.locale);
  redirect(`/${gate.locale}/my/saved/collections`);
}

/**
 * Puts a collection's members in a new order: the WHOLE order, as the page
 * that offered the move computed it, under the version that page read. A
 * stale page is a conflict, never a silent reshuffle.
 */
export async function reorderCollectionAction(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  const gate = await personalGate(form);
  if ('refused' in gate) return gate.refused;
  try {
    await personalisationRuntime().saved.reorderCollection(gate.actor, {
      collectionId: form.get('collectionId'),
      savedItemIds: form.getAll('item'),
      expectedVersion: whole(form, 'version'),
    });
  } catch (error) {
    return rejected(error, 'personal-collection-reorder');
  }
  refreshMy(gate.locale);
  return DONE;
}

/** Takes one target out of a collection; its bookmark or note, if any, stays. */
export async function removeFromCollectionAction(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  const gate = await personalGate(form);
  if ('refused' in gate) return gate.refused;
  const target = decodeTarget(form.get('target'));
  if (target === null) return INVALID;
  try {
    await personalisationRuntime().saved.removeFromCollection(gate.actor, {
      collectionId: form.get('collectionId'),
      target,
      expectedVersion: whole(form, 'version'),
    });
  } catch (error) {
    return rejected(error, 'personal-collection-member-remove');
  }
  refreshMy(gate.locale);
  return DONE;
}
