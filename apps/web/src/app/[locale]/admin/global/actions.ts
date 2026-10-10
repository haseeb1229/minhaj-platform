'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { localeSchema } from '@minhaj/contracts';

import { requirePermittedAction } from '@/composition/authorization';
import { globalRuntime } from '@/composition/global';
import { appLogger } from '@/composition/logging';
import { globalFailure } from '@/contexts/global-network';
import type { FormActionState } from '../../(identity)/form-state';

/**
 * The Global Network administrative mutations (ROUTE_MAP.md §7:
 * `/admin/global/{countries|regions|cities|centres}`).
 *
 * EVERY ONE RE-CHECKS AUTHORISATION SERVER-SIDE, against the principal's CURRENT
 * permission set: the page that rendered the form decided whether to show it,
 * which is navigation, not a security boundary (SECURITY_BASELINE.md §3.4
 * rule 2). `requirePermittedAction` with `global.administer`, as Media does: a
 * directory record grants nothing, so no step-up is asked.
 *
 * NO MASS ASSIGNMENT. Each action names the fields it reads; the domain's schemas
 * are strict, so anything else is refused. A submitted `version` is an EXPECTED
 * version — compared, never trusted. A Centre's contacts and the Cities it
 * serves change one NAMED change at a time, never as a list the browser supplies.
 *
 * FAILURES ARE LABELLED, NEVER ECHOED. `globalFailure` maps a thrown value onto a
 * fixed vocabulary; an unrecognised failure is logged as an operation name and
 * nothing else — never a contact value, an address or a coordinate
 * (SECURITY_BASELINE.md §19.2).
 */

function rejected(error: unknown, operation: string): FormActionState {
  const failure = globalFailure(error);
  if (failure === 'unavailable')
    appLogger().error({ operation }, 'Global Network mutation failed.');
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

/** A place's names: an empty row gives no name in that language. */
function placeLabels(form: FormData) {
  return localeSchema.options.flatMap((language) => {
    const name = value(form, `name-${language}`);
    return name === null ? [] : [{ locale: language, name }];
  });
}

/**
 * A Centre's words per language. A row with a description or an address but no
 * name is SENT, with an empty name, so the schema refuses it rather than the
 * words being silently dropped.
 */
function centreLabels(form: FormData) {
  return localeSchema.options.flatMap((language) => {
    const name = value(form, `name-${language}`);
    const description = value(form, `description-${language}`);
    const address = value(form, `address-${language}`);
    if (name === null && description === null && address === null) return [];
    return [{ locale: language, name: name ?? '', description, address }];
  });
}

/** Both coordinates or neither; one alone is passed on so the schema refuses it. */
function coordinates(form: FormData) {
  const latitude = value(form, 'latitude');
  const longitude = value(form, 'longitude');
  if (latitude === null && longitude === null) return null;
  return { latitude: latitude ?? '', longitude: longitude ?? '' };
}

async function authorise(form: FormData) {
  const locale = localeSchema.parse(form.get('locale'));
  const permitted = await requirePermittedAction(locale, 'global.administer');
  return { locale, permitted };
}

function settle(locale: string, path: string): string {
  revalidatePath(`/${locale}/admin/global`, 'layout');
  return `/${locale}/admin/global/${path}`;
}

export async function saveCountry(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  let destination: string;

  try {
    const { locale, permitted } = await authorise(form);
    if (permitted.state === 'denied') return { status: 'error', failure: 'denied' };

    const id = value(form, 'id');
    const saved = await globalRuntime().saveCountry(
      { accountId: permitted.session.account.id },
      id,
      id === null ? null : integer(form, 'version'),
      {
        code: form.get('code') ?? '',
        slug: form.get('slug'),
        primaryLocale: form.get('primaryLocale'),
        state: form.get('state'),
        labels: placeLabels(form),
      },
    );

    destination = settle(locale, `countries/${saved.id}`);
  } catch (error) {
    return rejected(error, 'global-save-country');
  }

  redirect(destination);
}

export async function saveRegion(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  let destination: string;

  try {
    const { locale, permitted } = await authorise(form);
    if (permitted.state === 'denied') return { status: 'error', failure: 'denied' };

    const id = value(form, 'id');
    const saved = await globalRuntime().saveRegion(
      { accountId: permitted.session.account.id },
      id,
      id === null ? null : integer(form, 'version'),
      {
        countryId: value(form, 'countryId'),
        slug: form.get('slug'),
        primaryLocale: form.get('primaryLocale'),
        state: form.get('state'),
        labels: placeLabels(form),
      },
    );

    destination = settle(locale, `regions/${saved.id}`);
  } catch (error) {
    return rejected(error, 'global-save-region');
  }

  redirect(destination);
}

export async function saveCity(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  let destination: string;

  try {
    const { locale, permitted } = await authorise(form);
    if (permitted.state === 'denied') return { status: 'error', failure: 'denied' };

    const id = value(form, 'id');
    const saved = await globalRuntime().saveCity(
      { accountId: permitted.session.account.id },
      id,
      id === null ? null : integer(form, 'version'),
      {
        countryId: value(form, 'countryId'),
        regionId: value(form, 'regionId'),
        slug: form.get('slug'),
        primaryLocale: form.get('primaryLocale'),
        state: form.get('state'),
        labels: placeLabels(form),
      },
    );

    destination = settle(locale, `cities/${saved.id}`);
  } catch (error) {
    return rejected(error, 'global-save-city');
  }

  redirect(destination);
}

export async function saveCentre(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  let destination: string;

  try {
    const { locale, permitted } = await authorise(form);
    if (permitted.state === 'denied') return { status: 'error', failure: 'denied' };

    const id = value(form, 'id');
    const saved = await globalRuntime().saveCentre(
      { accountId: permitted.session.account.id },
      id,
      id === null ? null : integer(form, 'version'),
      {
        countryId: value(form, 'countryId'),
        regionId: value(form, 'regionId'),
        cityId: value(form, 'cityId'),
        isVirtual: form.get('isVirtual') === 'on',
        coordinates: coordinates(form),
        slug: form.get('slug'),
        primaryLocale: form.get('primaryLocale'),
        state: form.get('state'),
        labels: centreLabels(form),
      },
    );

    destination = settle(locale, `centres/${saved.id}`);
  } catch (error) {
    return rejected(error, 'global-save-centre');
  }

  redirect(destination);
}

export async function changeCentreContacts(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  let destination: string;

  try {
    const { locale, permitted } = await authorise(form);
    if (permitted.state === 'denied') return { status: 'error', failure: 'denied' };

    const centreId = String(form.get('centreId') ?? '');
    const op = form.get('op');
    await globalRuntime().changeContacts(
      { accountId: permitted.session.account.id },
      centreId,
      integer(form, 'version') ?? Number.NaN,
      op === 'add'
        ? {
            op,
            contact: { channel: form.get('channel'), value: form.get('value') ?? '' },
          }
        : op === 'move'
          ? { op, position: integer(form, 'position'), direction: form.get('direction') }
          : { op, position: integer(form, 'position') },
    );

    destination = settle(locale, `centres/${encodeURIComponent(centreId)}`);
  } catch (error) {
    return rejected(error, 'global-change-contacts');
  }

  redirect(destination);
}

export async function changeCentreServedCities(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  let destination: string;

  try {
    const { locale, permitted } = await authorise(form);
    if (permitted.state === 'denied') return { status: 'error', failure: 'denied' };

    const centreId = String(form.get('centreId') ?? '');
    await globalRuntime().changeServedCities(
      { accountId: permitted.session.account.id },
      centreId,
      integer(form, 'version') ?? Number.NaN,
      { op: form.get('op'), cityId: form.get('cityId') },
    );

    destination = settle(locale, `centres/${encodeURIComponent(centreId)}`);
  } catch (error) {
    return rejected(error, 'global-change-served-cities');
  }

  redirect(destination);
}
