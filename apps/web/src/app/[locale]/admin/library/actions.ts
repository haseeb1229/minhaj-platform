'use server';

import { revalidatePath } from 'next/cache';

import { indexAfterResponse } from '@/composition/search';
import { redirect } from 'next/navigation';

import { localeSchema } from '@minhaj/contracts';
import { parseReaderDocument } from '@minhaj/contracts/library';

import { requirePermittedAction } from '@/composition/authorization';
import { consumeLibraryUpload, libraryRuntime } from '@/composition/library';
import { appLogger } from '@/composition/logging';
import { storageRuntime } from '@/composition/storage';
import { libraryFailure } from '@/contexts/library';
import type { FormActionState } from '../../(identity)/form-state';

/**
 * The Library administrative mutations (ROUTE_MAP.md §7, and this phase's §17).
 *
 * EVERY ONE OF THEM RE-CHECKS AUTHORISATION SERVER-SIDE. The route that rendered
 * the form checked a permission to decide whether to show a screen; that is
 * navigational convenience, not a security boundary, and "every protected mutation
 * involving an authenticated principal re-checks authorisation independently"
 * (SECURITY_BASELINE.md §3.4 rule 2). The check here reads the principal's CURRENT
 * permission set, so a Library role revoked between render and submit refuses the
 * submit.
 *
 * `requirePermittedAction` RATHER THAN `requirePrivilegedActor`, deliberately.
 * Step-up reauthentication exists for operations that change what an account may DO
 * — privilege, account status, second factors. Cataloguing a book is not one of
 * them, and requiring a second factor and a step-up grant for every edition edit is
 * how people end up holding an elevation open all day (SECURITY_BASELINE.md §8.1).
 * Nothing here can reach a privileged operation: these actions receive no
 * `PrivilegedActor` and the Library service has no method that grants anything.
 *
 * NO MASS ASSIGNMENT. Each action names the fields it reads out of the form. A
 * `version` the caller supplies is an EXPECTED version — it is compared, never
 * trusted — and `id` is validated as an identifier before it reaches a query. The
 * authoritative validation is the Zod schema inside the domain service, and it is
 * `.strict()`: a field nobody named is a refusal rather than a silent write.
 *
 * FAILURES ARE LABELLED, NEVER ECHOED. `libraryFailure` maps a thrown value onto a
 * fixed vocabulary the interface has a message for. No provider message, no SQL
 * text, no constraint name and no stored content reaches the response
 * (SECURITY_BASELINE.md §19.2); an unrecognised failure is logged as an operation
 * name and nothing else.
 */

function rejected(error: unknown, operation: string): FormActionState {
  const failure = libraryFailure(error);
  if (failure === 'unavailable') {
    // The OPERATION, and nothing else. Not the record, not the input, not the
    // error's own message — any of which can carry stored content.
    appLogger().error({ operation }, 'Library mutation failed.');
  }
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
  // NaN reaches the domain schema and is refused there, which is the correct
  // outcome: silently coercing "nineteen" to 0 would store a publication year of
  // zero for a book somebody mistyped.
  return Number.isInteger(parsed) ? parsed : Number.NaN;
}

/**
 * How many repeated rows one form may carry.
 *
 * A FIXED CEILING rather than a count the form supplies, because a caller-supplied
 * row count is a caller-supplied loop bound. The domain schemas cap the resulting
 * arrays independently.
 */
const ROWS = 12;

function rows<T>(build: (index: number) => T | null): T[] {
  return Array.from({ length: ROWS }, (_, index) => build(index)).filter(
    (entry): entry is T => entry !== null,
  );
}

export async function saveWork(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  let destination: string;

  try {
    const locale = localeSchema.parse(form.get('locale'));
    const permitted = await requirePermittedAction(locale, 'library.administer');
    if (permitted.state === 'denied') return { status: 'error', failure: 'denied' };

    const id = value(form, 'id');
    const saved = await libraryRuntime().library.saveWork(
      { accountId: permitted.session.account.id },
      id,
      id === null ? null : integer(form, 'version'),
      {
        slug: form.get('slug'),
        primaryLocale: form.get('primaryLocale'),
        state: form.get('state'),
        isFeatured: form.get('featured') === 'on',
        // ONLY THE LOCALES THE OPERATOR ENABLED. An unchecked language is an
        // absent label, not an empty one — a description that exists and says
        // nothing is worse than one that does not exist, and the schema requires
        // the primary locale's label to be present.
        labels: localeSchema.options
          .filter((language) => form.get(`${language}-enabled`) === 'on')
          .map((language) => ({
            locale: language,
            title: form.get(`${language}-title`),
            description: form.get(`${language}-description`) ?? '',
          })),
        contributors: rows((index) => {
          const personId = value(form, `person-${String(index)}`);
          const role = value(form, `role-${String(index)}`);
          return personId === null || role === null ? null : { personId, role };
        }),
        topicIds: rows((index) => value(form, `topic-${String(index)}`)),
        salePointIds: rows((index) => value(form, `sale-${String(index)}`)),
      },
    );

    destination = `/${locale}/admin/library/works/${saved.id}`;
    revalidatePath(`/${locale}/admin/library`, 'layout');
    indexAfterResponse();
  } catch (error) {
    return rejected(error, 'library-save-work');
  }

  redirect(destination);
}

export async function saveEdition(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  let destination: string;

  try {
    const locale = localeSchema.parse(form.get('locale'));
    const permitted = await requirePermittedAction(locale, 'library.administer');
    if (permitted.state === 'denied') return { status: 'error', failure: 'denied' };

    const id = value(form, 'id');
    const saved = await libraryRuntime().library.saveEdition(
      { accountId: permitted.session.account.id },
      id,
      id === null ? null : integer(form, 'version'),
      editionInput(form),
    );

    destination = `/${locale}/admin/library/editions/${saved.id}`;
    revalidatePath(`/${locale}/admin/library`, 'layout');
    indexAfterResponse();
  } catch (error) {
    return rejected(error, 'library-save-edition');
  }

  redirect(destination);
}

/**
 * The Edition fields, read once so the save action and the upload action cannot
 * disagree about what an Edition is.
 *
 * THE DOCUMENT IS PARSED, NOT STORED AS TYPED. `parseReaderDocument` turns the
 * plain-text authoring format into titled sections with DERIVED keys, and returns
 * `null` for anything the schema will not accept. `null` is passed through as "no
 * document", which the availability CHECK constraint then refuses if reading is
 * supposed to be allowed and there is no other source — so a malformed document
 * cannot quietly make a readable Edition unreadable.
 */
function editionInput(form: FormData): Record<string, unknown> {
  const document = value(form, 'document');

  return {
    workId: form.get('workId'),
    label: form.get('label'),
    languageCode: form.get('languageCode'),
    state: form.get('state'),
    publisher: value(form, 'publisher'),
    publicationYear: integer(form, 'publicationYear'),
    isbn: value(form, 'isbn'),
    pageCount: integer(form, 'pageCount'),
    reading: form.get('reading'),
    download: form.get('download'),
    readableAssetId: value(form, 'readableAssetId'),
    downloadAssetId: value(form, 'downloadAssetId'),
    document: document === null ? null : parseReaderDocument(document),
  };
}

export async function saveTranslation(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  try {
    const locale = localeSchema.parse(form.get('locale'));
    const permitted = await requirePermittedAction(locale, 'library.administer');
    if (permitted.state === 'denied') return { status: 'error', failure: 'denied' };

    const actor = { accountId: permitted.session.account.id };
    const editionId = form.get('editionId');
    const expectedVersion = integer(form, 'version') ?? Number.NaN;

    if (form.get('action') === 'remove') {
      await libraryRuntime().library.removeTranslation(
        actor,
        String(editionId ?? ''),
        expectedVersion,
      );
    } else {
      await libraryRuntime().library.saveTranslation(actor, {
        editionId,
        expectedVersion,
        sourceEditionId: value(form, 'sourceEditionId'),
        translatorIds: rows((index) => value(form, `translator-${String(index)}`)),
      });
    }

    revalidatePath(`/${locale}/admin/library`, 'layout');
    indexAfterResponse();
    return { status: 'success' };
  } catch (error) {
    return rejected(error, 'library-save-translation');
  }
}

export async function saveSalePoint(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  try {
    const locale = localeSchema.parse(form.get('locale'));
    const permitted = await requirePermittedAction(locale, 'library.administer');
    if (permitted.state === 'denied') return { status: 'error', failure: 'denied' };

    const id = value(form, 'id');
    await libraryRuntime().library.saveSalePoint(
      { accountId: permitted.session.account.id },
      id,
      id === null ? null : integer(form, 'version'),
      {
        name: form.get('name'),
        address: form.get('address') ?? '',
        contact: form.get('contact') ?? '',
        url: value(form, 'url'),
        state: form.get('state'),
      },
    );

    revalidatePath(`/${locale}/admin/library/sale-points`);
    indexAfterResponse();
    return { status: 'success' };
  } catch (error) {
    return rejected(error, 'library-save-sale-point');
  }
}

/* ===========================================================================
 * Attaching a file to an Edition
 * ========================================================================= */

/**
 * The media types Library accepts for an edition file.
 *
 * ONE TYPE, because one is what this phase has a use for. The list is the CALLER's
 * ceiling; Storage sniffs the bytes and refuses anything whose real type is not on
 * it, so a PDF extension on a ZIP is rejected by the foundation rather than by a
 * check here (SECURITY_BASELINE.md §10.1). A consumer may be stricter than the
 * foundation and may not be laxer, and it cannot switch off quarantine, sniffing,
 * scanning, generated keys or root containment — none of those is expressible in an
 * `UploadPolicy`.
 */
const EDITION_MEDIA_TYPES = ['application/pdf'] as const;

/**
 * A ceiling for one edition file ATTACHED THROUGH THIS FORM — and it is set to what
 * the transport actually carries, not to what Storage could hold.
 *
 * A Server Action's request body is capped by the framework at 1 MB by default, and
 * that cap applies to EVERY Server Action in the application, including the
 * anonymous correspondence form. Raising it to admit a 50 MB book would enlarge the
 * request every public action must accept before it can refuse — a security-posture
 * change for the whole platform that this phase does not take on its own authority.
 *
 * So the bound is stated truthfully here and on the form: a file up to 1 MiB, less
 * the form's own fields. Storage itself streams and has no such limit
 * (`STORAGE_MAX_BYTES`), and large edition files are expected to arrive through the
 * authorised migration pipeline, which writes through `StorageService` directly and
 * never through a browser form (MIGRATION_STRATEGY.md; DELIVERY_PLAN.md Phase 30).
 */
const EDITION_MAX_BYTES = 1024 * 1024;

/**
 * Uploads a file and attaches it to an Edition — and is HONEST ABOUT NOT BEING
 * ATOMIC (§29).
 *
 * TWO SYSTEMS, TWO COMMITS. Storage writes bytes and an `Asset` row through its own
 * lifecycle; Library then writes a typed relation in SQL. Those are not one
 * transaction and this code does not pretend otherwise: there is no saga, no event
 * bus and no compensating-transaction framework here, because inventing one for a
 * single two-step operation would be a distributed-systems apparatus for an
 * administrative form.
 *
 * WHAT HAPPENS IN THE CRASH WINDOW. If the upload succeeds and the relation write
 * fails — a stale version, a concurrent edit, a lost connection — the Asset exists
 * and nothing references it. That is reported as a failure the operator can retry,
 * and the orphan is NOT PUBLICLY REACHABLE: the serving policy allows an asset only
 * when it IS the recorded readable or download asset of a published Edition, so an
 * unreferenced asset is refused by the same check that refuses an unrelated one. It
 * is a wasted file, not an exposure — and Storage's own bounded reconciliation owns
 * the disposal of Storage-owned resources.
 *
 * THE REVERSE WINDOW CANNOT HAPPEN. The relation is written only after the upload
 * has returned a clean asset identifier, so there is never a Library row pointing at
 * bytes that were never stored.
 *
 * THE EXPECTED VERSION IS STILL ENFORCED. Attaching a file is a material mutation of
 * an Edition, so it conflicts against a stale version exactly as an ordinary save
 * does (§40) — two operators attaching different files to one Edition do not both
 * win.
 */
export async function attachEditionAsset(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  try {
    const locale = localeSchema.parse(form.get('locale'));
    const permitted = await requirePermittedAction(locale, 'library.administer');
    if (permitted.state === 'denied') return { status: 'error', failure: 'denied' };

    const file = form.get('file');
    const slot = form.get('slot');
    if (!(file instanceof File) || file.size === 0) {
      return { status: 'error', failure: 'invalid' };
    }
    if (slot !== 'readableAssetId' && slot !== 'downloadAssetId') {
      return { status: 'error', failure: 'invalid' };
    }

    // "File upload" is a protected flow (SECURITY_BASELINE.md §15.2). Checked
    // BEFORE a single byte is written, so a refused request costs no storage and no
    // scan.
    if (!(await consumeLibraryUpload(permitted.session.account.id))) {
      return { status: 'error', failure: 'rate-limited' };
    }

    const storage = await storageRuntime();
    const stored = await storage.store(fileChunks(file), {
      allowedMediaTypes: [...EDITION_MEDIA_TYPES],
      maxBytes: EDITION_MAX_BYTES,
      // What the client SAID it is. Used only to refuse a mismatch against the
      // sniffed type; it never grants acceptance on its own.
      declaredMediaType: file.type === '' ? null : file.type,
      displayName: file.name === '' ? null : file.name,
    });

    // ONLY A CLEAN ASSET IS ATTACHED. A quarantined, rejected or failed upload is
    // not a file this Edition has, and recording a relation to one would make the
    // catalogue claim something the scanner has not cleared.
    //
    // ITS OWN FAILURE, because "check the fields" would be untrue: the fields were
    // fine and the scanner could not clear the bytes. The operator is told the file
    // was not attached — and nothing about the scanner's own result, which is
    // Storage's to record rather than this screen's to display.
    if (stored.state !== 'clean') return { status: 'error', failure: 'not-cleared' };

    const id = value(form, 'id');
    if (id === null) return { status: 'error', failure: 'invalid' };

    await libraryRuntime().library.saveEdition(
      { accountId: permitted.session.account.id },
      id,
      integer(form, 'version'),
      { ...editionInput(form), [slot]: stored.id },
    );

    revalidatePath(`/${locale}/admin/library/editions/${id}`);
    indexAfterResponse();
    return { status: 'success' };
  } catch (error) {
    return rejected(error, 'library-attach-edition-asset');
  }
}

/**
 * The uploaded file as a stream of chunks.
 *
 * STREAMED, NEVER BUFFERED. `await file.arrayBuffer()` would be one line and would
 * put a 64 MB edition into the server's heap per concurrent upload (§49).
 */
async function* fileChunks(file: File): AsyncIterable<Uint8Array> {
  const reader = file.stream().getReader();
  try {
    for (;;) {
      const { done, value: chunk } = await reader.read();
      if (done) return;
      if (chunk !== undefined) yield chunk;
    }
  } finally {
    reader.releaseLock();
  }
}
