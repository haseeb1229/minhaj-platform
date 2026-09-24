'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { localeSchema } from '@minhaj/contracts';
import { parseDuration, PHOTO_LIMITS } from '@minhaj/contracts/media';

import { requirePermittedAction } from '@/composition/authorization';
import { appLogger } from '@/composition/logging';
import { mediaRuntime } from '@/composition/media';
import { indexAfterResponse } from '@/composition/search';
import { mediaFailure } from '@/contexts/media';
import type { FormActionState } from '../../(identity)/form-state';
import { MEDIA_FORM_ROWS } from './rows';

/**
 * The Media administrative mutations (ROUTE_MAP.md §7).
 *
 * EVERY ONE RE-CHECKS AUTHORISATION SERVER-SIDE, against the principal's CURRENT
 * permission set: the page that rendered the form decided whether to show it,
 * which is navigation, not a security boundary (SECURITY_BASELINE.md §3.4
 * rule 2). `requirePermittedAction`, not a step-up: cataloguing a video is not a
 * privileged operation, and nothing reachable here can grant anything.
 *
 * NO MASS ASSIGNMENT. Each action names the fields it reads; the domain's schemas
 * are strict, so anything else is refused. A submitted `version` is an EXPECTED
 * version — compared, never trusted.
 *
 * NO IFRAME, NO EMBED ADDRESS. The Video form takes a provider and what the
 * operator typed as its identifier or watch address; the domain reduces that to
 * `provider + providerVideoId` or refuses it. No field can smuggle markup or a
 * frame source into a page.
 *
 * FAILURES ARE LABELLED, NEVER ECHOED. `mediaFailure` maps a thrown value onto a
 * fixed vocabulary; an unrecognised failure is logged as an operation name and
 * nothing else (SECURITY_BASELINE.md §19.2).
 *
 * PHASE 11 — NO FILE TRAVELS THROUGH AN ACTION. A track's metadata and
 * lifecycle are saved here; its audio file is uploaded through the dedicated
 * streaming route (`/api/admin/media/audio/{id}/asset`), because the Server
 * Action body cap is global and is not raised.
 *
 * PHASE 12 — THE SAME FOR PHOTOGRAPHS. A Photo's words, credit, date and
 * lifecycle are saved here, and an empty draft is created here for each file
 * the batch uploader sends; the image itself goes to
 * `/api/admin/media/photos/{id}/asset`. A Gallery's membership changes one
 * named change at a time, never as a list the browser supplies.
 */

function rejected(error: unknown, operation: string): FormActionState {
  const failure = mediaFailure(error);
  if (failure === 'unavailable')
    appLogger().error({ operation }, 'Media mutation failed.');
  return { status: 'error', failure };
}

/** One form value, trimmed, or `null` when absent or empty. */
function value(form: FormData, field: string): string | null {
  const raw = form.get(field);
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed;
}

/** One optional integer form value. A non-numeric entry is a refusal, not a zero. */
function integer(form: FormData, field: string): number | null {
  const raw = value(form, field);
  if (raw === null) return null;
  const parsed = Number(raw);
  return Number.isInteger(parsed) ? parsed : Number.NaN;
}

/** A fixed ceiling of repeated rows, never a count the form supplies. */
function rows(count: number, build: (index: number) => string | null): string[] {
  return Array.from({ length: count }, (_, index) => build(index)).filter(
    (entry): entry is string => entry !== null,
  );
}

/** The labels an operator enabled — an unchecked language is absent, not empty. */
function labels(form: FormData) {
  return localeSchema.options
    .filter((language) => form.get(`${language}-enabled`) === 'on')
    .map((language) => ({
      locale: language,
      title: form.get(`${language}-title`),
      description: form.get(`${language}-description`) ?? '',
    }));
}

async function authorise(form: FormData) {
  const locale = localeSchema.parse(form.get('locale'));
  const permitted = await requirePermittedAction(locale, 'media.administer');
  return { locale, permitted };
}

export async function saveVideo(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  let destination: string;

  try {
    const { locale, permitted } = await authorise(form);
    if (permitted.state === 'denied') return { status: 'error', failure: 'denied' };

    const id = value(form, 'id');
    const saved = await mediaRuntime().media.saveVideo(
      { accountId: permitted.session.account.id },
      id,
      id === null ? null : integer(form, 'version'),
      {
        slug: form.get('slug'),
        primaryLocale: form.get('primaryLocale'),
        state: form.get('state'),
        isFeatured: form.get('featured') === 'on',
        provider: form.get('provider'),
        providerReference: form.get('providerReference') ?? '',
        availability: form.get('availability'),
        format: value(form, 'format'),
        languageCode: form.get('languageCode'),
        labels: labels(form),
        durationSeconds: parseDuration(value(form, 'duration') ?? ''),
        publishedOn: value(form, 'publishedOn'),
        thumbnailUrl: value(form, 'thumbnailUrl'),
        captions: form.get('captions') === 'on',
        transcript: value(form, 'transcript'),
        seriesId: value(form, 'seriesId'),
        seriesPosition: integer(form, 'seriesPosition'),
        speakerIds: rows(MEDIA_FORM_ROWS.speakers, (index) =>
          value(form, `speaker-${String(index)}`),
        ),
        topicIds: rows(MEDIA_FORM_ROWS.topics, (index) =>
          value(form, `topic-${String(index)}`),
        ),
      },
    );

    destination = `/${locale}/admin/media/videos/${saved.id}`;
    revalidatePath(`/${locale}/admin/media`, 'layout');
    // Durable intent is already committed; this only indexes it sooner.
    indexAfterResponse();
  } catch (error) {
    return rejected(error, 'media-save-video');
  }

  redirect(destination);
}

export async function saveSeries(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  let destination: string;

  try {
    const { locale, permitted } = await authorise(form);
    if (permitted.state === 'denied') return { status: 'error', failure: 'denied' };

    const id = value(form, 'id');
    const saved = await mediaRuntime().media.saveSeries(
      { accountId: permitted.session.account.id },
      id,
      id === null ? null : integer(form, 'version'),
      {
        slug: form.get('slug'),
        kind: form.get('kind'),
        primaryLocale: form.get('primaryLocale'),
        state: form.get('state'),
        labels: labels(form),
      },
    );

    destination = `/${locale}/admin/media/series/${saved.id}`;
    revalidatePath(`/${locale}/admin/media`, 'layout');
  } catch (error) {
    return rejected(error, 'media-save-series');
  }

  redirect(destination);
}

export async function savePlaylist(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  let destination: string;

  try {
    const { locale, permitted } = await authorise(form);
    if (permitted.state === 'denied') return { status: 'error', failure: 'denied' };

    const id = value(form, 'id');
    const saved = await mediaRuntime().media.savePlaylist(
      { accountId: permitted.session.account.id },
      id,
      id === null ? null : integer(form, 'version'),
      {
        slug: form.get('slug'),
        primaryLocale: form.get('primaryLocale'),
        state: form.get('state'),
        labels: labels(form),
      },
    );

    destination = `/${locale}/admin/media/playlists/${saved.id}`;
    revalidatePath(`/${locale}/admin/media`, 'layout');
  } catch (error) {
    return rejected(error, 'media-save-playlist');
  }

  redirect(destination);
}

export async function saveAudioTrack(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  let destination: string;

  try {
    const { locale, permitted } = await authorise(form);
    if (permitted.state === 'denied') return { status: 'error', failure: 'denied' };

    const id = value(form, 'id');
    const saved = await mediaRuntime().media.saveAudioTrack(
      { accountId: permitted.session.account.id },
      id,
      id === null ? null : integer(form, 'version'),
      {
        slug: form.get('slug'),
        primaryLocale: form.get('primaryLocale'),
        state: form.get('state'),
        languageCode: form.get('languageCode'),
        labels: labels(form),
        durationSeconds: parseDuration(value(form, 'duration') ?? ''),
        recordedOn: value(form, 'recordedOn'),
        transcript: value(form, 'transcript'),
        seriesId: value(form, 'seriesId'),
        seriesPosition: integer(form, 'seriesPosition'),
        speakerIds: rows(MEDIA_FORM_ROWS.speakers, (index) =>
          value(form, `speaker-${String(index)}`),
        ),
        topicIds: rows(MEDIA_FORM_ROWS.topics, (index) =>
          value(form, `topic-${String(index)}`),
        ),
      },
    );

    destination = `/${locale}/admin/media/audio/${saved.id}`;
    revalidatePath(`/${locale}/admin/media`, 'layout');
    // Durable intent is already committed; this only indexes it sooner.
    indexAfterResponse();
  } catch (error) {
    return rejected(error, 'media-save-audio-track');
  }

  redirect(destination);
}

export async function saveAudioSeries(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  let destination: string;

  try {
    const { locale, permitted } = await authorise(form);
    if (permitted.state === 'denied') return { status: 'error', failure: 'denied' };

    const id = value(form, 'id');
    const saved = await mediaRuntime().media.saveAudioSeries(
      { accountId: permitted.session.account.id },
      id,
      id === null ? null : integer(form, 'version'),
      {
        slug: form.get('slug'),
        primaryLocale: form.get('primaryLocale'),
        state: form.get('state'),
        labels: labels(form),
      },
    );

    destination = `/${locale}/admin/media/audio/series/${saved.id}`;
    revalidatePath(`/${locale}/admin/media`, 'layout');
  } catch (error) {
    return rejected(error, 'media-save-audio-series');
  }

  redirect(destination);
}

/**
 * One named change to a Playlist's order — add, remove, or move one Video one
 * place — against the version the operator was looking at.
 */
export async function changePlaylist(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  let destination: string;

  try {
    const { locale, permitted } = await authorise(form);
    if (permitted.state === 'denied') return { status: 'error', failure: 'denied' };

    const playlistId = String(form.get('playlistId') ?? '');
    const op = form.get('op');
    await mediaRuntime().media.changePlaylist(
      { accountId: permitted.session.account.id },
      playlistId,
      integer(form, 'version') ?? Number.NaN,
      op === 'move'
        ? { op, videoId: form.get('videoId'), direction: form.get('direction') }
        : { op, videoId: form.get('videoId') },
    );

    destination = `/${locale}/admin/media/playlists/${encodeURIComponent(playlistId)}`;
    revalidatePath(`/${locale}/admin/media`, 'layout');
  } catch (error) {
    return rejected(error, 'media-change-playlist');
  }

  redirect(destination);
}

/* ===========================================================================
 * Phase 12 — Photo and Gallery
 * ========================================================================= */

/** A Photo's labels: each enabled locale's alternative text and caption. */
function photoLabels(form: FormData) {
  return localeSchema.options
    .filter((language) => form.get(`${language}-enabled`) === 'on')
    .map((language) => ({
      locale: language,
      altText: value(form, `${language}-altText`),
      caption: value(form, `${language}-caption`),
    }));
}

/**
 * The date a photograph was taken, as precisely as the operator states it. An
 * empty year is an honest "unknown"; a month or day without what precedes it is
 * refused by the schema rather than dropped.
 */
function takenDate(form: FormData) {
  const year = integer(form, 'takenYear');
  const month = integer(form, 'takenMonth');
  const day = integer(form, 'takenDay');
  if (year === null && month === null && day === null) return null;
  return { year, month, day };
}

export async function savePhoto(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  let destination: string;

  try {
    const { locale, permitted } = await authorise(form);
    if (permitted.state === 'denied') return { status: 'error', failure: 'denied' };

    const id = value(form, 'id');
    const saved = await mediaRuntime().media.savePhoto(
      { accountId: permitted.session.account.id },
      id,
      id === null ? null : integer(form, 'version'),
      {
        primaryLocale: form.get('primaryLocale'),
        state: form.get('state'),
        labels: photoLabels(form),
        credit: value(form, 'credit'),
        taken: takenDate(form),
      },
    );

    destination = `/${locale}/admin/media/photos/${saved.id}`;
    revalidatePath(`/${locale}/admin/media`, 'layout');
  } catch (error) {
    return rejected(error, 'media-save-photo');
  }

  redirect(destination);
}

/**
 * An empty DRAFT Photo for one file the batch uploader is about to send — so
 * the file has a record, and a version, to be attached to. It has no words and
 * no image yet, and a draft is never public.
 */
export async function createPhotoDraft(
  locale: string,
): Promise<
  | { readonly status: 'success'; readonly id: string; readonly version: number }
  | { readonly status: 'error'; readonly failure: string }
> {
  try {
    const language = localeSchema.parse(locale);
    const permitted = await requirePermittedAction(language, 'media.administer');
    if (permitted.state === 'denied') return { status: 'error', failure: 'denied' };

    const saved = await mediaRuntime().media.savePhoto(
      { accountId: permitted.session.account.id },
      null,
      null,
      { primaryLocale: language, state: 'draft', labels: [], credit: null, taken: null },
    );
    return { status: 'success', id: saved.id, version: saved.version };
  } catch (error) {
    return {
      status: 'error',
      failure: rejected(error, 'media-create-photo').failure ?? 'unknown',
    };
  }
}

export async function saveGallery(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  let destination: string;

  try {
    const { locale, permitted } = await authorise(form);
    if (permitted.state === 'denied') return { status: 'error', failure: 'denied' };

    const id = value(form, 'id');
    const saved = await mediaRuntime().media.saveGallery(
      { accountId: permitted.session.account.id },
      id,
      id === null ? null : integer(form, 'version'),
      {
        slug: form.get('slug'),
        primaryLocale: form.get('primaryLocale'),
        state: form.get('state'),
        labels: labels(form),
      },
    );

    destination = `/${locale}/admin/media/galleries/${saved.id}`;
    revalidatePath(`/${locale}/admin/media`, 'layout');
  } catch (error) {
    return rejected(error, 'media-save-gallery');
  }

  redirect(destination);
}

/**
 * One named change to a Gallery's membership — add the chosen Photos (at most
 * one page of them), remove one, or move one — against the version the
 * operator was looking at.
 */
export async function changeGallery(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  let destination: string;

  try {
    const { locale, permitted } = await authorise(form);
    if (permitted.state === 'denied') return { status: 'error', failure: 'denied' };

    const galleryId = String(form.get('galleryId') ?? '');
    const op = form.get('op');
    await mediaRuntime().media.changeGallery(
      { accountId: permitted.session.account.id },
      galleryId,
      integer(form, 'version') ?? Number.NaN,
      op === 'add'
        ? {
            op,
            // A fixed ceiling read from the form, never a count it supplies:
            // the schema refuses more than one page.
            photoIds: form
              .getAll('photoId')
              .slice(0, PHOTO_LIMITS.galleryAdd + 1)
              .map(String),
          }
        : op === 'move'
          ? { op, photoId: form.get('photoId'), direction: form.get('direction') }
          : { op, photoId: form.get('photoId') },
    );

    destination = `/${locale}/admin/media/galleries/${encodeURIComponent(galleryId)}`;
    revalidatePath(`/${locale}/admin/media`, 'layout');
  } catch (error) {
    return rejected(error, 'media-change-gallery');
  }

  redirect(destination);
}
