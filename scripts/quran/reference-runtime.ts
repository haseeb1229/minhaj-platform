import { readFile } from 'node:fs/promises';

import { z } from 'zod';

import { localeSchema } from '@minhaj/contracts';
import type { ResolvedSession } from '@minhaj/contracts/identity';
import {
  parseStagedPayload,
  type StagedDetail,
  type StagedQuranTranslationPayload,
} from '@minhaj/contracts/migration';
import {
  QURAN_LIMITS,
  QURAN_SURAH_MAX,
  type CandidateAyah,
  type TranslationNote,
  type TranslationRecord,
  type TranslationTextChange,
} from '@minhaj/contracts/quran';

import {
  composeQuranReferenceRunner,
  type QuranReferenceRunner,
} from '../../apps/web/src/composition/quran-reference-runner.ts';
import { approvedTarget, CommandError, required, runCommand } from '../migration/cli.ts';
import {
  TRANSLATION_WORKS,
  editionFits,
  translationAttribution,
  type TranslationWork,
} from './translation-works.ts';

/**
 * THE RUNTIME HALF of Rebaseline R2's Quran reference preview — run ONLY as a
 * child of the owner-side command (`packages/database/src/lifecycle/
 * quran-reference.ts`), as the RUNTIME principal, whose `DATABASE_URL` is the
 * only database setting it holds. It cannot register a source or activate a
 * corpus; it reaches canonical text only through Quran's canonical service and
 * layered text only through Quran's administrative service, exactly as the
 * application does.
 *
 *   accept        --operator <accountId> --session <sessionId>
 *                 --source <sourceId> --candidate <json file>
 *     Mints the operator's privileged actor through Identity's gate
 *     (`quran.editCanonical` + a live `quran-canonical-edit` step-up on that
 *     session) and accepts the corpus: the service verifies the candidate code
 *     point for code point against the registered source, and the procedure
 *     compares it byte for byte again and copies the REGISTERED text.
 *
 *   translations  --operator <accountId> --sources <key>=<sourceId>,…
 *     Reads the staged revisions (`migration.read`) of each declared
 *     translation work's own migration source (`./translation-works.ts`:
 *     Irfan-ul-Quran in Urdu and English, and QuranEnc's external reference
 *     translations) and saves each Surah's text, exactly as staged, into that
 *     Translation work (`quran.read` + `quran.administer`), then publishes the
 *     work. `--sources` names every declared work's provenance source, which
 *     the owner side registered. A work is created only once a usable revision
 *     exists. Only a CURRENT revision — the latest of its record, valid, not
 *     rejected or superseded, never one whose personal-data detector redacted
 *     it, of the work's language and (QuranEnc) of its own edition key — is
 *     used, and only when it covers every Ayah of its Surah. Anything else is
 *     SKIPPED AND REPORTED, never repaired. A QuranEnc work's attribution names
 *     the version of the ONE edition its usable revisions carry — updated when
 *     a re-run staged a new edition; revisions of two editions leave the work
 *     exactly as it is (`version: "mixed"`) until the source is run again.
 *     Since Quran Part 6 a revision's translator's notes (parser version 3)
 *     are saved WITH its texts, each Ayah's notes exactly as staged and in
 *     order, through the same save — whose service ties every note to a mark
 *     of its text and refuses one it cannot (`notes-untied`, the Surah
 *     skipped). A revision staged before notes were read (`notes: null`)
 *     changes texts only and leaves the notes held untouched. A re-run whose
 *     texts and notes are already held reports the Surah unchanged.
 *
 *   names         --operator <accountId> --names <json file>
 *     (Quran Part 2) Saves each Surah's English display name and its meaning —
 *     the Tanzil metadata's `tname` and `ename`, verbatim, already verified by
 *     the owner side against the digest the corpus was registered with —
 *     through Quran's administrative service (`quran.read` +
 *     `quran.administer`, exactly as `/admin/quran/surahs`). Every Arabic name
 *     must be the accepted corpus's own before any name is saved; a name an
 *     operator recorded is KEPT, never replaced; the other locales' names are
 *     carried over untouched. A re-run reports every Surah unchanged.
 *
 * The final stdout line is one JSON object of identifiers and counts: no text.
 */

const USAGE =
  'reference-runtime accept --operator <id> --session <id> --source <id> --candidate <file> | ' +
  'translations --operator <id> --sources <key>=<id>,… | ' +
  'names --operator <id> --names <file>';

/** A source this tooling registered: a generated UUID. */
const SOURCE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** An internal account or session identifier (the operator commands' shape). */
const ACCOUNT_ID = /^[A-Za-z0-9_-]{8,36}$/;

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

/* ===========================================================================
 * accept
 * ========================================================================= */

async function accept(runner: QuranReferenceRunner): Promise<Record<string, unknown>> {
  const operator = identifier('--operator', ACCOUNT_ID);
  const sessionId = identifier('--session', ACCOUNT_ID);
  const sourceId = identifier('--source', SOURCE_ID);
  const candidate = JSON.parse(
    await readFile(required('--candidate', USAGE), 'utf8'),
  ) as CandidateAyah[];

  // The gate reads the account's id and status and re-reads every authority
  // fact LIVE — the permission, the second-factor posture and a step-up grant
  // bound to THIS session — so nothing below is trusted from this object. The
  // database procedure re-checks the account, the session and the grant again.
  const now = new Date();
  const session: ResolvedSession = {
    sessionId,
    sessionCreatedAt: now,
    sessionExpiresAt: now,
    account: {
      id: operator,
      email: '',
      emailVerified: true,
      name: '',
      locale: 'en',
      timezone: null,
      status: 'active',
      accountSetupCompletedAt: null,
      createdAt: now,
    },
  };
  const actor = await runner.requireCanonicalActor(session);
  if (actor === null)
    throw new CommandError(
      'the operator does not hold quran.editCanonical with a live quran-canonical-edit step-up on that session',
    );

  const outcome = await quran(
    runner.canonical.acceptCorpus(actor, { sourceId, candidate }),
  );
  if (!outcome.ok)
    throw new CommandError(
      `the candidate did not verify against the source (run ${outcome.runId}, ` +
        `${outcome.report.mismatchCount} mismatches)`,
    );
  return { mode: 'accept', sourceId, runId: outcome.runId, ayat: outcome.ayat };
}

/* ===========================================================================
 * translations
 * ========================================================================= */

/** Why a Surah was not saved — a category, never content. */
type Skip =
  | 'no-current-revision'
  | 'not-valid'
  | 'not-reviewable'
  | 'personal-data-redacted'
  | 'unreadable-payload'
  | 'wrong-language'
  | 'other-edition'
  | 'incomplete'
  | 'notes-untied'
  | 'refused';

interface Report {
  saved: number;
  unchanged: number;
  /** Translator's notes written with the saved Surahs (Quran Part 6) — a count. */
  notes: number;
  skipped: { surah: number; reason: Skip }[];
  /**
   * The version of the edition the usable revisions carry (QuranEnc), which
   * the work's attribution names — or `mixed`, when they disagree and the
   * work is left exactly as it is until its source is run again.
   */
  version: string | null;
  published: boolean;
  workId: string | null;
}

/** `--sources <key>=<id>,…`: every declared work's provenance source, once. */
function provenanceSources(): ReadonlyMap<string, string> {
  const given = new Map<string, string>();
  for (const pair of required('--sources', USAGE).split(',')) {
    const [key = '', id = '', ...rest] = pair.split('=');
    if (
      rest.length > 0 ||
      !TRANSLATION_WORKS.some((work) => work.source === key) ||
      !SOURCE_ID.test(id) ||
      given.has(key)
    )
      throw new CommandError('--sources names a work this import does not declare');
    given.set(key, id);
  }
  if (given.size !== TRANSLATION_WORKS.length)
    throw new CommandError('--sources must name every declared translation work');
  return given;
}

/** Every staged revision of the named sources, the CURRENT one of each record only. */
async function currentRevisions(
  runner: QuranReferenceRunner,
  actor: { readonly accountId: string },
  sourceIds: ReadonlyMap<string, string>,
): Promise<Map<string, Map<number, StagedDetail>>> {
  const latest = new Map<string, { id: string; revision: number }>();
  for (let offset = 0; ;) {
    const page = await runner.migration.read.staged(actor, { offset });
    for (const row of page.rows) {
      if (row.contentKind !== 'quran.translation') continue;
      const held = latest.get(row.recordId);
      if (held === undefined || row.revision > held.revision)
        latest.set(row.recordId, { id: row.id, revision: row.revision });
    }
    offset += page.rows.length;
    if (page.rows.length === 0 || offset >= page.total) break;
  }

  const bySurah = new Map<string, Map<number, StagedDetail>>();
  for (const { id } of latest.values()) {
    const detail = await runner.migration.read.stagedDetail(actor, id);
    if (detail === null) continue;
    const source = sourceIds.get(detail.sourceId);
    if (source === undefined) continue;
    const payload = parseStagedPayload('quran.translation', detail.payload);
    // An unreadable payload names no Surah; it is counted against none.
    if (payload?.kind !== 'quran.translation') continue;
    const held = bySurah.get(source) ?? new Map<number, StagedDetail>();
    held.set(payload.surah, detail);
    bySurah.set(source, held);
  }
  return bySurah;
}

/** This current revision's payload, or why it may not be used. */
function usable(
  detail: StagedDetail,
  work: TranslationWork,
): StagedQuranTranslationPayload | Skip {
  if (detail.validation !== 'valid') return 'not-valid';
  if (detail.review !== 'pending' && detail.review !== 'approved')
    return 'not-reviewable';
  if (detail.recordStatus !== 'staged' && detail.recordStatus !== 'approved')
    return 'not-reviewable';
  if (detail.personalData === 'flagged') return 'personal-data-redacted';
  const payload = parseStagedPayload('quran.translation', detail.payload);
  if (payload?.kind !== 'quran.translation') return 'unreadable-payload';
  if (payload.languageCode !== work.language) return 'wrong-language';
  if (!editionFits(work, payload.edition)) return 'other-edition';
  return payload;
}

/** The declared work, by slug: kept when it names this source, created otherwise. */
async function findOrCreateWork(
  runner: QuranReferenceRunner,
  actor: { readonly accountId: string },
  work: TranslationWork,
  sourceId: string,
  attribution: string,
): Promise<TranslationRecord> {
  for (let offset = 0; ;) {
    const page = await quran(runner.quran.translations(actor, offset));
    const found = page.items.find((item) => item.slug === work.slug);
    if (found !== undefined) {
      if (found.sourceId !== sourceId)
        throw new CommandError(
          `the work '${work.slug}' names another source; nothing was changed`,
        );
      return found;
    }
    offset += page.items.length;
    if (page.items.length === 0 || offset >= page.total) break;
  }
  return quran(
    runner.quran.createTranslation(actor, {
      value: {
        slug: work.slug,
        name: work.name,
        description: work.description,
        attribution,
        languageCode: work.language,
        sourceId,
        contributors: [],
      },
    }),
  );
}

/** Whether two lists of one Ayah's notes are the same notes, in the same order. */
function sameNotes(
  held: readonly Pick<TranslationNote, 'marker' | 'text'>[],
  staged: readonly Pick<TranslationNote, 'marker' | 'text'>[],
): boolean {
  return (
    held.length === staged.length &&
    held.every(
      (note, index) =>
        note.marker === staged[index]?.marker && note.text === staged[index]?.text,
    )
  );
}

/**
 * What one Surah's save must change: every Ayah whose staged text differs
 * from the text held — and, when the revision read notes, every Ayah whose
 * notes differ, carrying ALL its staged notes in order (an Ayah with none
 * carries `[]`, which removes notes held). A revision that read no notes
 * (`null`) names none, so the notes held are kept.
 */
function translationChanges(
  ayat: readonly { readonly ayah: number; readonly text: string }[],
  notes:
    | readonly { readonly ayah: number; readonly marker: string; readonly text: string }[]
    | null,
  current: readonly {
    readonly ayah: number;
    readonly text: string;
    readonly notes: readonly TranslationNote[];
  }[],
): TranslationTextChange[] {
  const held = new Map(current.map((entry) => [entry.ayah, entry]));
  const staged = new Map<number, { marker: string; text: string }[]>();
  for (const note of notes ?? []) {
    const list = staged.get(note.ayah) ?? [];
    list.push({ marker: note.marker, text: note.text });
    staged.set(note.ayah, list);
  }
  return ayat.flatMap((entry) => {
    const before = held.get(entry.ayah);
    const textChanged = before?.text !== entry.text;
    if (notes === null)
      return textChanged ? [{ ayah: entry.ayah, text: entry.text }] : [];
    const own = staged.get(entry.ayah) ?? [];
    return textChanged || !sameNotes(before?.notes ?? [], own)
      ? [{ ayah: entry.ayah, text: entry.text, notes: own }]
      : [];
  });
}

/**
 * One declared work: created only once a usable revision exists, its
 * attribution kept true to the edition of its staged text, every usable
 * Surah saved exactly as staged, and published once it has text.
 */
async function importWork(
  runner: QuranReferenceRunner,
  actor: { readonly accountId: string },
  input: {
    readonly work: TranslationWork;
    readonly sourceId: string;
    readonly surahs: readonly { readonly number: number; readonly ayahCount: number }[];
    readonly staged: ReadonlyMap<number, StagedDetail>;
  },
): Promise<Report> {
  const { work, sourceId, surahs, staged } = input;
  const report: Report = {
    saved: 0,
    unchanged: 0,
    notes: 0,
    skipped: [],
    version: null,
    published: false,
    workId: null,
  };

  const payloads = new Map<number, StagedQuranTranslationPayload>();
  for (const surah of surahs) {
    const detail = staged.get(surah.number);
    const read = detail === undefined ? 'no-current-revision' : usable(detail, work);
    if (typeof read === 'string')
      report.skipped.push({ surah: surah.number, reason: read });
    else payloads.set(surah.number, read);
  }
  // ONE edition across the usable revisions, which the attribution names; a
  // work whose revisions disagree (a source part-way through a re-run) is left
  // exactly as it is.
  const editions = new Set(
    [...payloads.values()].map((payload) => JSON.stringify(payload.edition)),
  );
  if (editions.size > 1) {
    report.version = 'mixed';
    return report;
  }
  const [first] = payloads.values();
  if (first === undefined) return report;
  report.version = first.edition?.version ?? null;
  const attribution = translationAttribution(work, first.edition);

  let record = await findOrCreateWork(runner, actor, work, sourceId, attribution);
  report.workId = record.id;
  // A new edition: the attribution names the version its text now is.
  if (record.attribution !== attribution)
    record = await quran(
      runner.quran.updateTranslation(actor, {
        id: record.id,
        expectedVersion: record.version,
        value: {
          slug: record.slug,
          name: record.name,
          description: record.description,
          attribution,
          languageCode: record.languageCode,
          sourceId: record.sourceId,
          // A Translation's contributors hold its own roles only (the schema's).
          contributors: record.contributors.flatMap(({ personId, role }) =>
            role === 'translator' || role === 'editor' ? [{ personId, role }] : [],
          ),
        },
      }),
    );

  for (const surah of surahs) {
    const payload = payloads.get(surah.number);
    if (payload === undefined) continue;
    const ayat = [...payload.ayat].sort((a, b) => a.ayah - b.ayah);
    if (
      ayat.length !== surah.ayahCount ||
      ayat.some((entry, index) => entry.ayah !== index + 1)
    ) {
      report.skipped.push({ surah: surah.number, reason: 'incomplete' });
      continue;
    }

    const current = await quran(
      runner.quran.translationTexts(actor, record.id, surah.number),
    );
    const changes = translationChanges(ayat, payload.notes, current);
    if (changes.length === 0) {
      report.unchanged += 1;
      continue;
    }
    try {
      record = await runner.quran.saveTranslationTexts(actor, {
        id: record.id,
        expectedVersion: record.version,
        surah: surah.number,
        changes,
      });
      report.saved += 1;
      report.notes += changes.reduce(
        (sum, change) => sum + (change.notes?.length ?? 0),
        0,
      );
    } catch (error) {
      const refusal = error as { name?: unknown; reason?: unknown } | null;
      if (refusal?.name !== 'QuranRefusal') throw error;
      report.skipped.push({
        surah: surah.number,
        reason: refusal.reason === 'note-untied' ? 'notes-untied' : 'refused',
      });
    }
  }
  report.skipped.sort((a, b) => a.surah - b.surah);

  if (record.state !== 'published' && record.textCount > 0) {
    record = await quran(
      runner.quran.setTranslationState(actor, {
        id: record.id,
        expectedVersion: record.version,
        state: 'published',
      }),
    );
  }
  report.published = record.state === 'published';
  return report;
}

async function translations(
  runner: QuranReferenceRunner,
): Promise<Record<string, unknown>> {
  const operator = identifier('--operator', ACCOUNT_ID);
  const provenance = provenanceSources();
  const actor = { accountId: operator };

  // The staged revisions' OWN sources, by key — never inferred from a payload.
  const migrationSources = new Map<string, string>();
  for (const work of TRANSLATION_WORKS) {
    const source = await runner.migration.sources.sourceByKey(actor, work.source);
    if (source !== null) migrationSources.set(source.id, work.source);
  }

  const surahs = await quran(runner.quran.surahs(actor));
  const revisions = await currentRevisions(runner, actor, migrationSources);
  const works: Record<string, Report> = {};
  for (const work of TRANSLATION_WORKS)
    works[work.source] = await importWork(runner, actor, {
      work,
      sourceId: provenance.get(work.source) ?? '',
      surahs,
      staged: revisions.get(work.source) ?? new Map<number, StagedDetail>(),
    });
  return { mode: 'translations', works };
}

/* ===========================================================================
 * names (Quran Part 2)
 * ========================================================================= */

/**
 * The owner side's file: the metadata's own values, already verified against
 * the digest the corpus was registered with. Parsed again here, strictly — a
 * child trusts no file it is handed.
 */
const namesFileSchema = z
  .array(
    z.strictObject({
      number: z.number().int().min(1).max(QURAN_SURAH_MAX),
      nameArabic: z.string().min(1).max(QURAN_LIMITS.surahName),
      transliteration: z.string().min(1).max(QURAN_LIMITS.surahName),
      meaning: z.string().min(1).max(QURAN_LIMITS.surahName),
    }),
  )
  .length(QURAN_SURAH_MAX);

/** Why a Surah's English name was not written — a category, never content. */
type NameSkip = 'operator-name' | 'refused';

async function names(runner: QuranReferenceRunner): Promise<Record<string, unknown>> {
  const operator = identifier('--operator', ACCOUNT_ID);
  const parsed = namesFileSchema.safeParse(
    JSON.parse(await readFile(required('--names', USAGE), 'utf8')),
  );
  if (!parsed.success)
    throw new CommandError('the names file is not 114 Surahs of names');
  const actor = { accountId: operator };

  // EVERY Arabic name must be the corpus's own before ANY name is saved: a
  // metadata file that disagrees with the accepted corpus changes nothing.
  const surahs = await quran(runner.quran.surahs(actor));
  const wanted = new Map(parsed.data.map((entry) => [entry.number, entry]));
  if (
    surahs.length !== wanted.size ||
    surahs.some((surah) => wanted.get(surah.number)?.nameArabic !== surah.nameArabic)
  )
    throw new CommandError(
      'the metadata does not name the accepted corpus’s Surahs; nothing was changed',
    );

  const report = {
    saved: 0,
    unchanged: 0,
    kept: [] as { surah: number; reason: NameSkip }[],
  };
  for (const surah of surahs) {
    const entry = wanted.get(surah.number);
    if (entry === undefined) continue;
    const name = surah.names.en;
    const meaning = surah.meanings.en;
    if (name === entry.transliteration && meaning === entry.meaning) {
      report.unchanged += 1;
      continue;
    }
    // A name an operator recorded is theirs: it is never replaced from a file.
    if (name !== undefined) {
      report.kept.push({ surah: surah.number, reason: 'operator-name' });
      continue;
    }
    const others = localeSchema.options
      .filter((locale) => locale !== 'en')
      .flatMap((locale) => {
        const other = surah.names[locale];
        return other === undefined
          ? []
          : [{ locale, name: other, meaning: surah.meanings[locale] ?? null }];
      });
    try {
      await runner.quran.saveSurahNames(actor, {
        expectedVersion: surah.namesVersion,
        value: {
          surah: surah.number,
          names: [
            { locale: 'en', name: entry.transliteration, meaning: entry.meaning },
            ...others,
          ],
        },
      });
      report.saved += 1;
    } catch (error) {
      const refusal = error as { name?: unknown; reason?: unknown } | null;
      if (refusal?.name !== 'QuranRefusal') throw error;
      // Without the authority nothing can be saved: stop, rather than report
      // 114 refusals. Any other refusal (a concurrent edit) is this Surah's.
      if (refusal.reason === 'denied')
        throw new CommandError('the operator does not hold quran.administer');
      report.kept.push({ surah: surah.number, reason: 'refused' });
    }
  }
  return { mode: 'names', ...report };
}

await runCommand('quran:reference-runtime', async () => {
  const [mode] = process.argv.slice(2);
  approvedTarget(process.env['DATABASE_URL']);
  const runner = composeQuranReferenceRunner();
  if (mode === 'accept') return accept(runner);
  if (mode === 'translations') return translations(runner);
  if (mode === 'names') return names(runner);
  throw new CommandError(`usage: ${USAGE}`);
});
