import { readFile } from 'node:fs/promises';

import { z } from 'zod';

import { localeSchema } from '@minhaj/contracts';
import type { ResolvedSession } from '@minhaj/contracts/identity';
import { parseStagedPayload, type StagedDetail } from '@minhaj/contracts/migration';
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
 *   translations  --operator <accountId> --source-ur <sourceId> --source-en <sourceId>
 *     Reads the staged Irfan-ul-Quran revisions (`migration.read`) and saves
 *     each Surah's text, exactly as staged, into one Translation work per
 *     language (`quran.read` + `quran.administer`), then publishes the work.
 *     Only a CURRENT revision — the latest of its record, valid, not rejected
 *     or superseded, never one whose personal-data detector redacted it — of
 *     the two Irfan-ul-Quran sources is used, and only when it covers every
 *     Ayah of its Surah. Anything else is SKIPPED AND REPORTED, never repaired.
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
  'translations --operator <id> --source-ur <id> --source-en <id> | ' +
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

/** The two staged Irfan-ul-Quran sources and the work each becomes. */
const LANGUAGES = Object.freeze({
  ur: {
    migrationSource: 'irfan-ul-quran-ur',
    slug: 'irfan-ul-quran-ur',
    name: 'عرفان القرآن',
  },
  en: {
    migrationSource: 'irfan-ul-quran-en',
    slug: 'irfan-ul-quran-en',
    name: 'Irfan-ul-Quran',
  },
} as const);
type Language = keyof typeof LANGUAGES;

const ATTRIBUTION =
  'Irfan-ul-Quran — translation by Shaykh-ul-Islam Dr Muhammad Tahir-ul-Qadri. © Minhaj-ul-Quran International. Source: irfan-ul-quran.com';

/** Why a Surah was not saved — a category, never content. */
type Skip =
  | 'no-current-revision'
  | 'not-valid'
  | 'not-reviewable'
  | 'personal-data-redacted'
  | 'unreadable-payload'
  | 'wrong-language'
  | 'incomplete'
  | 'notes-untied'
  | 'refused';

interface Report {
  saved: number;
  unchanged: number;
  /** Translator's notes written with the saved Surahs (Quran Part 6) — a count. */
  notes: number;
  skipped: { surah: number; reason: Skip }[];
  published: boolean;
  workId: string | null;
}

/** Every staged revision of the two sources, the CURRENT one of each record only. */
async function currentRevisions(
  runner: QuranReferenceRunner,
  actor: { readonly accountId: string },
  sourceIds: ReadonlyMap<string, Language>,
): Promise<Map<Language, Map<number, StagedDetail>>> {
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

  const bySurah = new Map<Language, Map<number, StagedDetail>>([
    ['ur', new Map()],
    ['en', new Map()],
  ]);
  for (const { id } of latest.values()) {
    const detail = await runner.migration.read.stagedDetail(actor, id);
    if (detail === null) continue;
    const language = sourceIds.get(detail.sourceId);
    if (language === undefined) continue;
    const payload = parseStagedPayload('quran.translation', detail.payload);
    const surah = payload?.kind === 'quran.translation' ? payload.surah : null;
    if (surah === null) {
      // An unreadable payload names no Surah; it is counted against none.
      continue;
    }
    bySurah.get(language)?.set(surah, detail);
  }
  return bySurah;
}

/** Why this current revision may not be used, or null when it may. */
function unusable(detail: StagedDetail, language: Language): Skip | null {
  if (detail.validation !== 'valid') return 'not-valid';
  if (detail.review !== 'pending' && detail.review !== 'approved')
    return 'not-reviewable';
  if (detail.recordStatus !== 'staged' && detail.recordStatus !== 'approved')
    return 'not-reviewable';
  if (detail.personalData === 'flagged') return 'personal-data-redacted';
  const payload = parseStagedPayload('quran.translation', detail.payload);
  if (payload?.kind !== 'quran.translation') return 'unreadable-payload';
  if (payload.languageCode !== language) return 'wrong-language';
  return null;
}

async function findOrCreateWork(
  runner: QuranReferenceRunner,
  actor: { readonly accountId: string },
  language: Language,
  sourceId: string,
): Promise<TranslationRecord> {
  const { slug, name } = LANGUAGES[language];
  for (let offset = 0; ;) {
    const page = await quran(runner.quran.translations(actor, offset));
    const found = page.items.find((work) => work.slug === slug);
    if (found !== undefined) {
      if (found.sourceId !== sourceId)
        throw new CommandError(
          `the work '${slug}' names another source; nothing was changed`,
        );
      return found;
    }
    offset += page.items.length;
    if (page.items.length === 0 || offset >= page.total) break;
  }
  return quran(
    runner.quran.createTranslation(actor, {
      value: {
        slug,
        name,
        description: null,
        attribution: ATTRIBUTION,
        languageCode: language,
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

async function translations(
  runner: QuranReferenceRunner,
): Promise<Record<string, unknown>> {
  const operator = identifier('--operator', ACCOUNT_ID);
  const sources: Record<Language, string> = {
    ur: identifier('--source-ur', SOURCE_ID),
    en: identifier('--source-en', SOURCE_ID),
  };
  const actor = { accountId: operator };

  // The staged revisions' OWN sources, by key — never inferred from a payload.
  const migrationSources = new Map<string, Language>();
  for (const language of Object.keys(LANGUAGES) as Language[]) {
    const source = await runner.migration.sources.sourceByKey(
      actor,
      LANGUAGES[language].migrationSource,
    );
    if (source !== null) migrationSources.set(source.id, language);
  }

  const surahs = await quran(runner.quran.surahs(actor));
  const revisions = await currentRevisions(runner, actor, migrationSources);
  const reports: Record<Language, Report> = {
    ur: { saved: 0, unchanged: 0, notes: 0, skipped: [], published: false, workId: null },
    en: { saved: 0, unchanged: 0, notes: 0, skipped: [], published: false, workId: null },
  };

  for (const language of Object.keys(LANGUAGES) as Language[]) {
    const report = reports[language];
    let work = await findOrCreateWork(runner, actor, language, sources[language]);
    report.workId = work.id;

    for (const surah of surahs) {
      const detail = revisions.get(language)?.get(surah.number);
      if (detail === undefined) {
        report.skipped.push({ surah: surah.number, reason: 'no-current-revision' });
        continue;
      }
      const reason = unusable(detail, language);
      if (reason !== null) {
        report.skipped.push({ surah: surah.number, reason });
        continue;
      }
      const payload = parseStagedPayload('quran.translation', detail.payload);
      if (payload?.kind !== 'quran.translation') continue;
      const ayat = [...payload.ayat].sort((a, b) => a.ayah - b.ayah);
      if (
        ayat.length !== surah.ayahCount ||
        ayat.some((entry, index) => entry.ayah !== index + 1)
      ) {
        report.skipped.push({ surah: surah.number, reason: 'incomplete' });
        continue;
      }

      const current = await quran(
        runner.quran.translationTexts(actor, work.id, surah.number),
      );
      const changes = translationChanges(ayat, payload.notes, current);
      if (changes.length === 0) {
        report.unchanged += 1;
        continue;
      }
      try {
        work = await runner.quran.saveTranslationTexts(actor, {
          id: work.id,
          expectedVersion: work.version,
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

    if (work.state !== 'published' && work.textCount > 0) {
      work = await quran(
        runner.quran.setTranslationState(actor, {
          id: work.id,
          expectedVersion: work.version,
          state: 'published',
        }),
      );
    }
    report.published = work.state === 'published';
  }

  return { mode: 'translations', ur: reports.ur, en: reports.en };
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
