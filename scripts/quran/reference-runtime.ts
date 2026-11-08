import { readFile } from 'node:fs/promises';

import type { ResolvedSession } from '@minhaj/contracts/identity';
import { parseStagedPayload, type StagedDetail } from '@minhaj/contracts/migration';
import type { CandidateAyah, TranslationRecord } from '@minhaj/contracts/quran';

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
 *
 * The final stdout line is one JSON object of identifiers and counts: no text.
 */

const USAGE =
  'reference-runtime accept --operator <id> --session <id> --source <id> --candidate <file> | ' +
  'translations --operator <id> --source-ur <id> --source-en <id>';

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
  | 'refused';

interface Report {
  saved: number;
  unchanged: number;
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
    ur: { saved: 0, unchanged: 0, skipped: [], published: false, workId: null },
    en: { saved: 0, unchanged: 0, skipped: [], published: false, workId: null },
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
      const held = new Map(current.map((entry) => [entry.ayah, entry.text]));
      const changes = ayat
        .filter((entry) => held.get(entry.ayah) !== entry.text)
        .map((entry) => ({ ayah: entry.ayah, text: entry.text }));
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
      } catch (error) {
        if ((error as { name?: unknown } | null)?.name !== 'QuranRefusal') throw error;
        report.skipped.push({ surah: surah.number, reason: 'refused' });
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

await runCommand('quran:reference-runtime', async () => {
  const [mode] = process.argv.slice(2);
  approvedTarget(process.env['DATABASE_URL']);
  const runner = composeQuranReferenceRunner();
  if (mode === 'accept') return accept(runner);
  if (mode === 'translations') return translations(runner);
  throw new CommandError(`usage: ${USAGE}`);
});
