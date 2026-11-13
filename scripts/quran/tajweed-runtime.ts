import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  QURAN_PAGE,
  QURAN_SURAH_MAX,
  type TajweedOverlayRecord,
} from '@minhaj/contracts/quran';

import {
  composeQuranReferenceRunner,
  type QuranReferenceRunner,
} from '../../apps/web/src/composition/quran-reference-runner.ts';
import { approvedTarget, CommandError, required, runCommand } from '../migration/cli.ts';
import {
  planTajweedOverlay,
  readTajweedAnnotations,
  readTajweedBaseText,
  TajweedSourceRefusal,
  type TajweedPlan,
} from './tajweed-overlay.ts';

/**
 * THE RUNTIME HALF of Quran Part 9's tajweed import (owner decision,
 * OPEN_DECISIONS.md §1.2 item 4) — run ONLY as a child of the owner-side
 * command (`packages/database/src/lifecycle/quran-tajweed.ts`), as the RUNTIME
 * principal, whose `DATABASE_URL` is the only database setting it holds. It
 * registers no source: the owner did, and hands its identifier in. Every
 * write is Quran's administrative service under the operator's live
 * `quran.read` and `quran.administer`, exactly as the application does.
 *
 *   tajweed --operator <id> --source <sourceId> --annotations <json>
 *           --text <txt> --sha256 <hex> --text-sha256 <hex>
 *     Re-checks both files' digests, reads them (`./tajweed-overlay.ts`: the
 *     annotation file whole, the 2017 base text whole, every span inside its
 *     Ayah of that text — or nothing is changed), reads the canonical ayat
 *     through Quran's service, re-aligns every Ayah (unchanged, re-mapped, or
 *     skipped whole), then creates the draft overlay (or finds the one this
 *     import made) and records each aligned Ayah with the SHA-256 of the text
 *     it was aligned to, one Surah per transaction. An Ayah already recorded
 *     with the same digest and span count is kept; one recorded otherwise is
 *     left alone and counted (`differs`) — never edited. Publication is an
 *     editor's act on the admin screen.
 *
 * The final stdout line is one JSON object of identifiers and counts: no text,
 * no URL, no credential.
 */

const USAGE =
  'tajweed-runtime tajweed --operator <id> --source <id> --annotations <json> ' +
  '--text <txt> --sha256 <hex> --text-sha256 <hex>';

const SOURCE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const ACCOUNT_ID = /^[A-Za-z0-9_-]{8,36}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;

/** The one overlay this import makes, and what it says of itself. */
export const TAJWEED_OVERLAY = Object.freeze({
  slug: 'quran-tajweed',
  name: 'Colour-coded tajweed (quran-tajweed)',
  description:
    'Tajweed rule colours over the unchanged Tanzil Uthmani 1.1 text, for Hafs an Asim. Not yet reviewed by a qari.',
  attribution:
    'Tajweed annotations: quran-tajweed by Collin Fair (CC BY 4.0), re-aligned to Tanzil Uthmani v1.1. Quran text: Tanzil Project (tanzil.net), CC BY 3.0.',
});

function identifier(flag: string, shape: RegExp): string {
  const value = required(flag, USAGE);
  if (!shape.test(value))
    throw new CommandError(`${flag} is not an identifier of the expected shape`);
  return value;
}

/** A Quran refusal as its reason code — a category, never content. */
async function quran<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (error) {
    const candidate = error as { name?: unknown; reason?: unknown } | null;
    if (candidate?.name === 'QuranRefusal' && typeof candidate.reason === 'string')
      throw new CommandError(`quran refusal: ${candidate.reason}`);
    throw error;
  }
}

/**
 * The digest a recorded Ayah carries: SHA-256 of the stored text's UTF-16LE
 * bytes — exactly what SQL Server's `HASHBYTES('SHA2_256', …)` computes over
 * the NVARCHAR column, so the database can compare it with the text itself.
 */
export function ayahTextDigest(text: string): string {
  return createHash('sha256').update(Buffer.from(text, 'utf16le')).digest('hex');
}

/** A file's bytes, refused unless they are the digest the owner confirmed. */
async function pinned(file: string, sha256: string): Promise<Uint8Array> {
  const bytes = await readFile(file);
  if (createHash('sha256').update(bytes).digest('hex') !== sha256)
    throw new CommandError('a tajweed file is not the one recorded; nothing was changed');
  return bytes;
}

/** Strict UTF-8, or a refusal: a file that is not text changes nothing. */
function utf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new CommandError('a tajweed file is not UTF-8 text; nothing was changed');
  }
}

/** Every canonical Ayah, in canonical order, through Quran's service. */
async function canonicalAyat(
  runner: QuranReferenceRunner,
  actor: { readonly accountId: string },
): Promise<{ surah: number; ayah: number; text: string }[]> {
  const surahs = await quran(runner.quran.surahs(actor));
  if (surahs.length !== QURAN_SURAH_MAX)
    throw new CommandError('the canonical corpus is not 114 Surahs; nothing was changed');
  const ayat: { surah: number; ayah: number; text: string }[] = [];
  for (const surah of surahs)
    for (let offset = 0; offset < surah.ayahCount; offset += QURAN_PAGE) {
      const page = await quran(runner.quran.surahAyat(actor, surah.number, offset));
      for (const item of page.items)
        ayat.push({ surah: surah.number, ayah: item.ayah, text: item.text });
    }
  return ayat;
}

/** The overlay this import made, or a new draft — never another one's slug. */
async function overlayFor(
  runner: QuranReferenceRunner,
  actor: { readonly accountId: string },
  source: string,
): Promise<{
  readonly overlay: TajweedOverlayRecord;
  readonly state: 'created' | 'kept';
}> {
  const held = await quran(
    runner.quran.tajweedOverlayBySlug(actor, TAJWEED_OVERLAY.slug),
  );
  if (held !== null) {
    if (held.sourceId !== source || held.attribution !== TAJWEED_OVERLAY.attribution)
      throw new CommandError(
        'an overlay of this slug names another source or credit; nothing was changed',
      );
    return { overlay: held, state: 'kept' };
  }
  const overlay = await quran(
    runner.quran.createTajweedOverlay(actor, {
      value: { ...TAJWEED_OVERLAY, sourceId: source },
    }),
  );
  return { overlay, state: 'created' };
}

export async function importTajweed(
  runner: QuranReferenceRunner,
  input: {
    readonly operator: string;
    readonly source: string;
    readonly annotations: string;
    readonly text: string;
    readonly sha256: string;
    readonly textSha256: string;
  },
): Promise<Record<string, unknown>> {
  const actor = { accountId: input.operator };
  for (const permission of ['quran.read', 'quran.administer'])
    if (!(await runner.permits(input.operator, permission)))
      throw new CommandError(`the operator does not hold ${permission}`);

  const ayat = await canonicalAyat(runner, actor);
  let plan: TajweedPlan;
  let annotated: number;
  try {
    const annotations = readTajweedAnnotations(
      JSON.parse(utf8(await pinned(input.annotations, input.sha256))) as unknown,
    );
    const baseText = readTajweedBaseText(
      utf8(await pinned(input.text, input.textSha256)),
    );
    annotated = annotations.size;
    plan = planTajweedOverlay({
      annotations,
      baseText,
      canonical: ayat,
    });
  } catch (error) {
    if (error instanceof TajweedSourceRefusal)
      throw new CommandError(`${error.message}; nothing was changed`);
    if (error instanceof SyntaxError)
      throw new CommandError('the annotation file is not JSON; nothing was changed');
    throw error;
  }
  const canonical = new Map(
    ayat.map((entry) => [`${String(entry.surah)}:${String(entry.ayah)}`, entry.text]),
  );

  const { overlay: created, state } = await overlayFor(runner, actor, input.source);
  let overlay = created;
  const report = { recorded: 0, kept: 0, differs: 0 };
  const bySurah = new Map<number, TajweedPlan['ayat'][number][]>();
  for (const entry of plan.ayat)
    bySurah.set(entry.surah, [...(bySurah.get(entry.surah) ?? []), entry]);
  for (const [surah, entries] of bySurah) {
    const held = new Map(
      (await quran(runner.quran.tajweedAyat(actor, overlay.id, surah))).map((row) => [
        row.ayah,
        row,
      ]),
    );
    const fresh = [];
    for (const entry of entries) {
      const text = canonical.get(`${String(surah)}:${String(entry.ayah)}`);
      if (text === undefined)
        throw new CommandError('the canonical corpus changed mid-import');
      const textSha256 = ayahTextDigest(text);
      const recorded = held.get(entry.ayah);
      if (recorded === undefined)
        fresh.push({ ayah: entry.ayah, textSha256, spans: [...entry.spans] });
      else if (
        recorded.textSha256 === textSha256 &&
        recorded.spans === entry.spans.length
      )
        report.kept += 1;
      else report.differs += 1;
    }
    if (fresh.length === 0) continue;
    const saved = await quran(
      runner.quran.saveTajweedAyat(actor, {
        id: overlay.id,
        expectedVersion: overlay.version,
        surah,
        ayat: fresh,
      }),
    );
    report.recorded += saved.recorded;
    report.kept += saved.kept;
    overlay = saved.overlay;
  }
  return {
    mode: 'tajweed',
    overlayId: overlay.id,
    overlay: state,
    overlayState: overlay.state,
    annotated,
    canonical: canonical.size,
    aligned: plan.ayat.length,
    unchanged: plan.unchanged,
    remapped: plan.remapped,
    spans: plan.spans,
    skipped: plan.skipped,
    ...report,
  };
}

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(import.meta.filename)
) {
  await runCommand('quran:tajweed-runtime', async () => {
    const [mode] = process.argv.slice(2);
    if (mode !== 'tajweed') throw new CommandError(`usage: ${USAGE}`);
    approvedTarget(process.env['DATABASE_URL']);
    return importTajweed(composeQuranReferenceRunner(), {
      operator: identifier('--operator', ACCOUNT_ID),
      source: identifier('--source', SOURCE_ID),
      annotations: required('--annotations', USAGE),
      text: required('--text', USAGE),
      sha256: identifier('--sha256', SHA256),
      textSha256: identifier('--text-sha256', SHA256),
    });
  });
}
