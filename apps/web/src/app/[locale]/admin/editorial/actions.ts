'use server';
import { revalidatePath } from 'next/cache';

import { indexAfterResponse } from '@/composition/search';
import { redirect } from 'next/navigation';
import { localeSchema, localizedPath } from '@minhaj/contracts';
import {
  COLLECTION_LIMITS,
  EVENT_LIMITS,
  editorialKindSchema,
  correspondenceKindSchema,
  hasSourceDate,
  memberOfToken,
} from '@minhaj/contracts/editorial';
import { requirePermittedAction } from '@/composition/authorization';
import { editorialRuntime } from '@/composition/editorial';
import { editorialFailure } from '@/contexts/editorial';
import { appLogger } from '@/composition/logging';
import type { FormActionState } from '../../(identity)/form-state';
import { EDITORIAL_SEGMENTS } from './segments';

function rejected(error: unknown): FormActionState {
  const failure = editorialFailure(error);
  if (failure === 'unavailable')
    appLogger().error({ operation: 'editorial-mutation' }, 'Editorial mutation failed.');
  return { status: 'error', failure };
}
/**
 * A Collection's members as posted: `member-0`, `member-1`, … in order, each a
 * `kind:id` token. Nothing posted is ever dropped. A token naming no member is
 * sent on as it came, and a member field outside `member-0`…`member-99` adds an
 * entry no member can be, so the strict content contract refuses the whole
 * save rather than storing a list the editor did not submit.
 */
function postedMembers(form: FormData): unknown[] {
  const fields = [...form.keys()].filter((name) => name.startsWith('member-'));
  const members = Array.from({ length: COLLECTION_LIMITS.members }, (_, index) =>
    form.getAll(`member-${index}`),
  )
    .flat()
    .map((token) =>
      typeof token === 'string' ? (memberOfToken(token) ?? token) : token,
    );
  return members.length === fields.length ? members : [...members, null];
}
export async function saveEditorial(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  let destination: string;
  try {
    const locale = localeSchema.parse(form.get('locale'));
    const kind = editorialKindSchema.parse(form.get('kind'));
    const permitted = await requirePermittedAction(locale, 'content.author');
    if (permitted.state === 'denied') return { status: 'error', failure: 'denied' };
    const actor = { accountId: permitted.session.account.id };
    const contributors = Array.from({ length: 12 }, (_, index) => ({
      personId: form.get(`person-${index}`),
      role: form.get(`role-${index}`),
    })).filter((entry) => entry.personId);
    // Only the fields this kind owns are sent: an issuer only for a Statement
    // and a coverage source only for MediaCoverage. The content schema of each
    // kind is strict, so anything else would be refused, never stored.
    const optional = (name: string) => {
      const value = String(form.get(name) ?? '').trim();
      return value === '' ? null : value;
    };
    const content = {
      slug: form.get('slug'),
      primaryLanguage: form.get('primaryLanguage'),
      topicIds: Array.from({ length: 12 }, (_, index) =>
        String(form.get('topic-' + index) ?? '').trim(),
      ).filter(Boolean),
      contributors,
      translations: localeSchema.options
        .filter((language) => form.get(`${language}-enabled`) === 'on')
        .map((languageCode) => ({
          languageCode,
          title: form.get(`${languageCode}-title`),
          excerpt: form.get(`${languageCode}-excerpt`),
          ...(kind === 'statement' ? { issuer: form.get(`${languageCode}-issuer`) } : {}),
          seoTitle: form.get(`${languageCode}-seoTitle`),
          seoDescription: form.get(`${languageCode}-seoDescription`),
          document: form.get(`${languageCode}-document`),
        })),
      ...(kind === 'media-coverage'
        ? {
            coverage: {
              outlet: form.get('coverage-outlet'),
              sourceUrl: optional('coverage-sourceUrl'),
              sourceDate: optional('coverage-sourceDate'),
            },
          }
        : {}),
      // Phase 30-R: an Article's, NewsArticle's or PressRelease's ORIGINAL
      // source date — empty clears it. The lead image is never sent, so the
      // service keeps the one the current revision carries.
      ...(hasSourceDate(kind)
        ? { sourcePublishedOn: optional('sourcePublishedOn') }
        : {}),
      // A NewsArticle's optional Centre (Phase 16); no other kind sends the key.
      ...(kind === 'news-article' ? { centreId: optional('centreId') } : {}),
      // An Event's Centre, schedule and Galleries (Phase 14). Local times are
      // sent as the editor typed them; the server resolves them in the zone.
      ...(kind === 'event'
        ? {
            centreId: optional('centreId'),
            schedule: {
              timezone: form.get('eventTimezone'),
              occurrences: Array.from(
                { length: EVENT_LIMITS.occurrences },
                (_, index) => ({
                  start: optional(`occurrence-${index}-start`),
                  startFold: optional(`occurrence-${index}-startFold`),
                  end: optional(`occurrence-${index}-end`),
                  endFold: optional(`occurrence-${index}-endFold`),
                }),
              ).filter((entry) => entry.start !== null || entry.end !== null),
            },
            galleryIds: Array.from({ length: EVENT_LIMITS.galleries }, (_, index) =>
              optional(`gallery-${index}`),
            ).filter((id) => id !== null),
          }
        : {}),
      // A Collection's ordered members (Phase 15); no other kind sends the key.
      ...(kind === 'collection' ? { members: postedMembers(form) } : {}),
    };
    const id = String(form.get('id') ?? '');
    const saved = id
      ? await editorialRuntime().editorial.revise(
          actor,
          kind,
          id,
          Number(form.get('version')),
          content,
        )
      : await editorialRuntime().editorial.create(
          actor,
          kind,
          content,
          kind === 'page' ? String(form.get('routeBinding')) : null,
        );
    destination = localizedPath(
      locale,
      `/admin/editorial/${EDITORIAL_SEGMENTS[kind]}/${saved.id}`,
    );
    revalidatePath(localizedPath(locale, '/admin/editorial'), 'layout');
    indexAfterResponse();
  } catch (error) {
    return rejected(error);
  }
  redirect(destination);
}
export async function transitionEditorial(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  try {
    const locale = localeSchema.parse(form.get('locale'));
    const kind = editorialKindSchema.parse(form.get('kind'));
    const action = String(form.get('action'));
    const permission =
      action === 'submit'
        ? 'content.author'
        : ['approve', 'reject'].includes(action)
          ? 'content.review'
          : 'content.publish';
    const permitted = await requirePermittedAction(locale, permission);
    if (permitted.state === 'denied') return { status: 'error', failure: 'denied' };
    await editorialRuntime().editorial.transition(
      { accountId: permitted.session.account.id },
      kind,
      {
        id: form.get('id'),
        expectedVersion: Number(form.get('version')),
        action,
        scheduledAt: form.get('scheduledAt') || null,
        timezone: form.get('timezone') || null,
      },
    );
    revalidatePath(localizedPath(locale, '/admin/editorial'), 'layout');
    indexAfterResponse();
    return { status: 'success' };
  } catch (error) {
    return rejected(error);
  }
}
/**
 * What a second administrator's selection came to: how many records were
 * approved and published, and each one left with the reason word that says
 * why. Identifiers and reason words only — never a title.
 */
export interface EditorialBatchState extends FormActionState {
  readonly decided?: number;
  readonly refused?: readonly { readonly id: string; readonly reason: string }[];
}

/**
 * R2. APPROVE AND PUBLISH a selection of one kind's in-review records from one
 * queue page, each at the version shown (`version-<id>`), after an explicit
 * confirmation. A Class-A Server Action: the session is re-resolved and BOTH
 * `content.review` and `content.publish` re-checked live here; the service
 * checks both again and runs every record through the single-record workflow,
 * so each approval and each publication is refused (self-approval, a stale
 * version, a record no longer in review) and audited on its own.
 */
export async function approveAndPublishSelected(
  _state: EditorialBatchState,
  form: FormData,
): Promise<EditorialBatchState> {
  const locale = localeSchema.safeParse(form.get('locale'));
  if (!locale.success) return { status: 'error', failure: 'invalid' };
  const ids = form
    .getAll('id')
    .filter((value): value is string => typeof value === 'string');
  if (ids.length === 0) return { status: 'error', failure: 'none-selected' };
  if (form.get('confirm') !== 'on')
    return { status: 'error', failure: 'confirm-required' };
  const permitted = await requirePermittedAction(locale.data, 'content.review');
  if (permitted.state === 'denied' || !permitted.authorization.can('content.publish'))
    return { status: 'error', failure: 'denied' };
  let outcome: Awaited<
    ReturnType<ReturnType<typeof editorialRuntime>['editorial']['approveAndPublishMany']>
  >;
  try {
    outcome = await editorialRuntime().editorial.approveAndPublishMany(
      { accountId: permitted.session.account.id },
      {
        kind: form.get('kind'),
        items: ids.map((id) => ({
          id,
          expectedVersion: Number(form.get(`version-${id}`)),
        })),
      },
    );
  } catch (error) {
    const state = rejected(error);
    if (state.failure !== 'unavailable') return state;
    // An outage stops the batch part-way: what was done before it stands.
    revalidatePath(localizedPath(locale.data, '/admin/editorial'), 'layout');
    indexAfterResponse();
    return { status: 'error', failure: 'batch-interrupted' };
  }
  revalidatePath(localizedPath(locale.data, '/admin/editorial'), 'layout');
  indexAfterResponse();
  return outcome.refused.length === 0
    ? { status: 'success', decided: outcome.decided, refused: [] }
    : {
        status: 'error',
        failure: 'items-refused',
        decided: outcome.decided,
        refused: outcome.refused,
      };
}

export async function triageCorrespondence(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  try {
    const locale = localeSchema.parse(form.get('locale'));
    const kind = correspondenceKindSchema.parse(form.get('kind'));
    const permitted = await requirePermittedAction(locale, 'correspondence.administer');
    if (permitted.state === 'denied') return { status: 'error', failure: 'denied' };
    await editorialRuntime().correspondence.triage(
      { accountId: permitted.session.account.id },
      kind,
      {
        id: form.get('id'),
        expectedVersion: Number(form.get('version')),
        state: form.get('state'),
        note: form.get('note'),
      },
    );
    revalidatePath(localizedPath(locale, '/admin/editorial/correspondence'));
    return { status: 'success' };
  } catch (error) {
    return rejected(error);
  }
}
