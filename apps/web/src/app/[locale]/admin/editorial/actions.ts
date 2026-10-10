'use server';
import { revalidatePath } from 'next/cache';

import { indexAfterResponse } from '@/composition/search';
import { redirect } from 'next/navigation';
import { localeSchema } from '@minhaj/contracts';
import {
  editorialKindSchema,
  correspondenceKindSchema,
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
      // A NewsArticle's optional Centre (Phase 16); no other kind sends the key.
      ...(kind === 'news-article' ? { centreId: optional('centreId') } : {}),
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
    destination = `/${locale}/admin/editorial/${EDITORIAL_SEGMENTS[kind]}/${saved.id}`;
    revalidatePath(`/${locale}/admin/editorial`, 'layout');
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
    revalidatePath(`/${locale}/admin/editorial`, 'layout');
    indexAfterResponse();
    return { status: 'success' };
  } catch (error) {
    return rejected(error);
  }
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
    revalidatePath(`/${locale}/admin/editorial/correspondence`);
    return { status: 'success' };
  } catch (error) {
    return rejected(error);
  }
}
