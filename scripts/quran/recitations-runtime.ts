import { open, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import path from 'node:path';

import type { Locale } from '@minhaj/contracts';
import type { FetchOutcome, MigrationFetchPort } from '@minhaj/contracts/migration';
import {
  QURAN_SURAH_MAX,
  type RecitationDetail,
  type RecitationRecord,
  type SurahRecord,
} from '@minhaj/contracts/quran';

import {
  composeQuranReferenceRunner,
  type QuranReferenceRunner,
} from '../../apps/web/src/composition/quran-reference-runner.ts';
import { approvedTarget, CommandError, required, runCommand } from '../migration/cli.ts';
import {
  AUTHORISED_USER_AGENT,
  createSafeDownloader,
  createSafeFetcher,
  systemResolver,
  type Connector,
  type Resolver,
} from '../migration/safe-fetch.ts';
import {
  CURATED_READS,
  MP3QURAN_API_HOST,
  MP3QURAN_ENDPOINTS,
  attributionOf,
  planRead,
  readMoshafs,
  readSurahTiming,
  readTimedReads,
  type PlannedRead,
  type ReadSkip,
  type TimingSkip,
} from './mp3quran.ts';
import { memberBytes, verifyMember, zipMembers, type ZipMember } from './zip-archive.ts';

/**
 * THE RUNTIME HALF of Quran Part 5's recitation imports (owner decisions
 * 2026-11-09, OPEN_DECISIONS.md §1.2) — run ONLY as a child of the owner-side
 * command (`packages/database/src/lifecycle/quran-recitations.ts`), as the
 * RUNTIME principal, whose `DATABASE_URL` is the only database setting it
 * holds. It registers no source: the owner did, and hands its identifier in.
 * Every write is Quran's administrative service (`quran.read` +
 * `quran.administer`), Quran's segment upload into Storage, or People's
 * administrative service (`people.administer`) — each re-reading the
 * operator's permission live, exactly as the application does.
 *
 *   mp3quran        --operator <id> --source <sourceId>
 *     For each curated, Ayah-timed Hafs read (`./mp3quran.ts`): the reciter as
 *     a People Person (mp3quran's English and Arabic names, verbatim; no
 *     biography or portrait), a STREAMED recitation of its allowlisted CDN
 *     folder, and one segment per Surah with the timing of every Ayah — a
 *     Surah whose timing does not cover the corpus's ayat exactly once,
 *     monotonically, is skipped and reported, never adjusted. Fetched through
 *     the safe fetch boundary bound to the API's one host, one request at a
 *     time, at least a second apart. Resumable and idempotent: what exists is
 *     kept, only what is missing is added, then the recitation is published.
 *
 *   irfan-download  --dir <directory>
 *     Downloads the owner-attested Irfan-ul-Quran Urdu narration archive
 *     ONCE through the safe download boundary (minhaj.net only), refusing any
 *     size but the attested one, and reports its SHA-256. A complete file
 *     already in the directory is kept, not fetched again.
 *
 *   irfan-urdu      --operator <id> --source <sourceId> --zip <file> --sha256 <hex>
 *     Re-checks the archive's digest, reads its 114 members (`NNN. Name.mp3`,
 *     one per Surah), verifies each member's size and CRC-32, and stores each
 *     into Storage through Quran's own segment upload (sniffed, bounded,
 *     scanned, recorded only when clean) as one first-party segment per whole
 *     Surah, untimed. The narrator, Tasleem Ahmed Sabri, is a People Person
 *     with no invented biography. The audio is never altered.
 *
 * The final stdout line is one JSON object of identifiers and counts: no text,
 * no URL, no credential.
 */

const USAGE =
  'recitations-runtime mp3quran --operator <id> --source <id> | ' +
  'irfan-download --dir <directory> | ' +
  'irfan-urdu --operator <id> --source <id> --zip <file> --sha256 <hex>';

const SOURCE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACCOUNT_ID = /^[A-Za-z0-9_-]{8,36}$/;
const SHA256 = /^[0-9a-f]{64}$/;

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

function refusalOf(error: unknown): string | null {
  const candidate = error as { name?: unknown; reason?: unknown } | null;
  return candidate?.name === 'QuranRefusal' && typeof candidate.reason === 'string'
    ? candidate.reason
    : null;
}

/** The live permissions every write below needs, asked before anything is fetched. */
async function requireAuthority(
  runner: QuranReferenceRunner,
  operator: string,
  people: boolean,
): Promise<void> {
  const needed = [
    'quran.read',
    'quran.administer',
    ...(people ? ['people.administer'] : []),
  ];
  for (const permission of needed)
    if (!(await runner.permits(operator, permission)))
      throw new CommandError(`the operator does not hold ${permission}`);
}

/** The accepted corpus's Surahs — 114, or the import has nothing to hang on. */
async function corpusSurahs(
  runner: QuranReferenceRunner,
  actor: { readonly accountId: string },
): Promise<ReadonlyMap<number, SurahRecord>> {
  const surahs = await quran(runner.quran.surahs(actor));
  if (surahs.length !== QURAN_SURAH_MAX)
    throw new CommandError('the canonical corpus is not 114 Surahs; nothing was changed');
  return new Map(surahs.map((surah) => [surah.number, surah]));
}

/* ===========================================================================
 * People — the reciter as a Person, never more than the source says
 * ========================================================================= */

interface ReciterNames {
  readonly slug: string;
  readonly primaryLocale: Locale;
  /** The names to record, by locale; the primary locale's is required. */
  readonly names: Readonly<Partial<Record<Locale, string>>>;
}

type PersonOutcome =
  | { readonly id: string; readonly state: 'created' | 'kept' }
  | { readonly skip: 'person-slug-taken' | 'person-refused' };

/**
 * The Person a reciter is, by slug: kept when one exists whose primary name is
 * exactly the source's (a re-run), created and published otherwise. A Person of
 * that slug with ANOTHER name is someone else, and is left alone.
 */
async function ensurePerson(
  runner: QuranReferenceRunner,
  operator: string,
  reciter: ReciterNames,
): Promise<PersonOutcome> {
  const actor = { accountId: operator, permission: 'people.administer' };
  const primary = reciter.names[reciter.primaryLocale];
  if (primary === undefined) return { skip: 'person-refused' };
  const page = await runner.people.listPeople({
    query: reciter.slug,
    status: null,
    profileKind: null,
    locale: reciter.primaryLocale,
    offset: 0,
  });
  const existing = page.items.find((item) => item.slug === reciter.slug);
  if (existing !== undefined) {
    const detail = await runner.people.findPerson({
      personId: existing.id,
      locale: reciter.primaryLocale,
    });
    const recorded = detail?.translations.find(
      (entry) => entry.locale === reciter.primaryLocale,
    )?.name;
    if (detail === null || recorded !== primary) return { skip: 'person-slug-taken' };
    if (detail.status !== 'published') {
      const published = await runner.people.setStatus(actor, {
        personId: detail.id,
        status: 'published',
      });
      if (!published.ok) return { skip: 'person-refused' };
    }
    return { id: detail.id, state: 'kept' };
  }

  const created = await runner.people.createPerson(actor, {
    slug: reciter.slug,
    primaryLocale: reciter.primaryLocale,
    name: primary,
    biography: null,
  });
  if (!created.ok) return { skip: 'person-refused' };
  for (const [locale, text] of Object.entries(reciter.names) as [Locale, string][]) {
    if (locale === reciter.primaryLocale) continue;
    const translated = await runner.people.setTranslation(actor, {
      personId: created.person.id,
      locale,
      name: text,
      biography: null,
    });
    if (!translated.ok) return { skip: 'person-refused' };
  }
  const published = await runner.people.setStatus(actor, {
    personId: created.person.id,
    status: 'published',
  });
  if (!published.ok) return { skip: 'person-refused' };
  return { id: created.person.id, state: 'created' };
}

/** Every recitation, by slug — the administrative list, page by page. */
async function recitationBySlug(
  runner: QuranReferenceRunner,
  actor: { readonly accountId: string },
  slug: string,
): Promise<RecitationRecord | null> {
  for (let offset = 0; ;) {
    const page = await quran(runner.quran.recitations(actor, offset));
    const found = page.items.find((item) => item.slug === slug);
    if (found !== undefined) return found;
    offset += page.items.length;
    if (page.items.length === 0 || offset >= page.total) return null;
  }
}

/** Publishes a draft recitation that now has audio; reports whether it is published. */
async function publishIfReady(
  runner: QuranReferenceRunner,
  actor: { readonly accountId: string },
  detail: RecitationDetail,
): Promise<boolean> {
  if (detail.state === 'published') return true;
  const audible =
    detail.stream === null
      ? detail.segments.some((segment) => segment.assetId !== null)
      : detail.segments.length > 0;
  if (!audible) return false;
  const published = await quran(
    runner.quran.setRecitationState(actor, {
      id: detail.id,
      expectedVersion: detail.version,
      state: 'published',
    }),
  );
  return published.state === 'published';
}

/* ===========================================================================
 * mp3quran
 * ========================================================================= */

/** At least this long between two requests to the API — one request at a time. */
const POLITE_INTERVAL_MS = 1000;
const ATTEMPTS = 3;

/**
 * GET JSON through the boundary, politely: one request at a time, at least a
 * second apart, a transient failure (network, timeout, 429, 5xx) retried twice
 * with a growing pause. Anything else is the API's answer, given back as-is.
 */
export function politeJson(
  fetcher: MigrationFetchPort,
  sleep: (ms: number) => Promise<void> = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms)),
) {
  let last = 0;
  return async function get(url: string): Promise<unknown> {
    let outcome: FetchOutcome | null = null;
    for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
      const wait = last + POLITE_INTERVAL_MS * attempt - Date.now();
      if (wait > 0) await sleep(wait);
      last = Date.now();
      outcome = await fetcher.fetch(url);
      if (outcome.kind === 'refused') break;
      if (outcome.kind === 'response' && outcome.status !== 429 && outcome.status < 500)
        break;
    }
    if (outcome === null || outcome.kind !== 'response')
      throw new CommandError(
        `the mp3quran API could not be read (${outcome === null ? 'none' : `${outcome.kind}: ${outcome.detail}`})`,
      );
    if (outcome.status !== 200)
      throw new CommandError(`the mp3quran API answered ${String(outcome.status)}`);
    try {
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(outcome.body));
    } catch {
      throw new CommandError('the mp3quran API answered something other than JSON');
    }
  };
}

/** The API's fetcher: its ONE host, public addresses only, the honest User-Agent. */
export function mp3quranFetcher(
  options: { readonly resolver?: Resolver; readonly connector?: Connector } = {},
): MigrationFetchPort {
  return createSafeFetcher({
    hosts: [MP3QURAN_API_HOST],
    policy: {
      minIntervalMs: POLITE_INTERVAL_MS,
      maxConcurrency: 1,
      maxAttempts: ATTEMPTS,
      timeoutMs: 30_000,
      maxBodyBytes: 8 * 1024 * 1024,
      maxRedirects: 0,
    },
    resolver: options.resolver ?? systemResolver,
    ...(options.connector === undefined ? {} : { connector: options.connector }),
    userAgent: AUTHORISED_USER_AGENT,
  });
}

interface ReadReport {
  read: number;
  recitation: string | null;
  skip: ReadSkip | 'person-slug-taken' | 'person-refused' | 'other-recitation' | null;
  person: 'created' | 'kept' | null;
  created: boolean;
  added: number;
  kept: number;
  skipped: { surah: number; reason: TimingSkip | 'refused' }[];
  published: boolean;
}

export async function importMp3Quran(
  runner: QuranReferenceRunner,
  input: {
    readonly operator: string;
    readonly source: string;
    readonly get: (url: string) => Promise<unknown>;
  },
): Promise<Record<string, unknown>> {
  const { operator, source, get } = input;
  const actor = { accountId: operator };
  await requireAuthority(runner, operator, true);
  const surahs = await corpusSurahs(runner, actor);

  const timed = readTimedReads(await get(MP3QURAN_ENDPOINTS.timedReads));
  const english = readMoshafs(await get(MP3QURAN_ENDPOINTS.reciters('eng')));
  const arabic = readMoshafs(await get(MP3QURAN_ENDPOINTS.reciters('ar')));

  const reports: ReadReport[] = [];
  for (const curated of CURATED_READS) {
    const report: ReadReport = {
      read: curated.read,
      recitation: null,
      skip: null,
      person: null,
      created: false,
      added: 0,
      kept: 0,
      skipped: [],
      published: false,
    };
    reports.push(report);
    const plan = planRead(curated, timed, english, arabic);
    if ('skip' in plan) {
      report.skip = plan.skip;
      continue;
    }
    report.recitation = plan.recitationSlug;
    const person = await ensurePerson(runner, operator, {
      slug: plan.personSlug,
      // mp3quran's Arabic name is the reciter's own; an Urdu or English
      // interface without its own name shows it, as Arabic.
      primaryLocale: 'ar',
      names: { ar: plan.nameArabic, en: plan.nameEnglish },
    });
    if ('skip' in person) {
      report.skip = person.skip;
      continue;
    }
    report.person = person.state;
    const found = await streamedRecitation(runner, actor, plan, person.id, source);
    if (found === null) {
      report.skip = 'other-recitation';
      continue;
    }
    let detail: RecitationDetail = found;
    report.created = detail.version === 1 && detail.segments.length === 0;
    const held = new Set(detail.segments.map((segment) => segment.surah));
    for (let surah = 1; surah <= QURAN_SURAH_MAX; surah += 1) {
      if (held.has(surah)) {
        report.kept += 1;
        continue;
      }
      const ayahCount = surahs.get(surah)?.ayahCount ?? 0;
      const timing = readSurahTiming(
        await get(MP3QURAN_ENDPOINTS.timing(curated.read, surah)),
        ayahCount,
      );
      if ('skip' in timing) {
        report.skipped.push({ surah, reason: timing.skip });
        continue;
      }
      try {
        detail = await runner.quran.addRecitationSegment(actor, {
          id: detail.id,
          expectedVersion: detail.version,
          value: {
            surah,
            startAyah: 1,
            endAyah: ayahCount,
            timings: [...timing.timings],
          },
        });
        report.added += 1;
      } catch (error) {
        const reason = refusalOf(error);
        if (reason === null) throw error;
        if (reason === 'denied')
          throw new CommandError('the operator does not hold quran.administer');
        report.skipped.push({ surah, reason: 'refused' });
        const refreshed: RecitationDetail | null = await quran(
          runner.quran.recitation(actor, detail.id),
        );
        if (refreshed === null)
          throw new CommandError('the recitation vanished mid-import');
        detail = refreshed;
      }
    }
    report.published = await publishIfReady(runner, actor, detail);
  }
  return {
    mode: 'mp3quran',
    reads: reports.length,
    published: reports.filter((report) => report.published).length,
    segmentsAdded: reports.reduce((total, report) => total + report.added, 0),
    reports,
  };
}

/** The read's streamed recitation: kept if it is exactly this one, created otherwise. */
async function streamedRecitation(
  runner: QuranReferenceRunner,
  actor: { readonly accountId: string },
  plan: PlannedRead,
  personId: string,
  source: string,
): Promise<RecitationDetail | null> {
  const existing = await recitationBySlug(runner, actor, plan.recitationSlug);
  if (existing !== null) {
    if (
      existing.stream?.path !== plan.stream.path ||
      existing.sourceId !== source ||
      existing.reciterId !== personId
    )
      return null;
    return quran(runner.quran.recitation(actor, existing.id));
  }
  return quran(
    runner.quran.createStreamedRecitation(actor, {
      value: {
        slug: plan.recitationSlug,
        name: `${plan.nameEnglish} — ${plan.moshaf}`,
        reciterId: personId,
        style: plan.style,
        attribution: attributionOf(plan),
        sourceId: source,
        languageCode: 'ar',
      },
      stream: plan.stream,
    }),
  );
}

/* ===========================================================================
 * Irfan-ul-Quran Urdu narration
 * ========================================================================= */

/** The owner-attested archive: its one address, and its exact published size. */
export const IRFAN_NARRATION = Object.freeze({
  url: 'https://minhaj.net/downloads/iQuran/Quran_mp3.zip',
  host: 'minhaj.net',
  bytes: 687_598_353,
  file: 'Quran_mp3.zip',
  slug: 'irfan-ul-quran-urdu-narration',
  name: 'Irfan-ul-Quran, Urdu narration',
  attribution: 'Irfan-ul-Quran, Urdu narration — Minhaj-ul-Quran International',
  narrator: { slug: 'tasleem-ahmed-sabri', name: 'Tasleem Ahmed Sabri' },
});

async function sha256Of(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file, { highWaterMark: 1024 * 1024 }))
    hash.update(chunk as Buffer);
  return hash.digest('hex');
}

export async function downloadIrfanNarration(input: {
  readonly directory: string;
  readonly resolver?: Resolver;
  readonly connector?: Connector;
  readonly url?: string;
  readonly host?: string;
  readonly bytes?: number;
}): Promise<Record<string, unknown>> {
  const bytes = input.bytes ?? IRFAN_NARRATION.bytes;
  const file = path.join(input.directory, IRFAN_NARRATION.file);
  const held = await stat(file).catch(() => null);
  let downloaded = false;
  if (held === null || held.size !== bytes) {
    const downloader = createSafeDownloader({
      hosts: [input.host ?? IRFAN_NARRATION.host],
      resolver: input.resolver ?? systemResolver,
      ...(input.connector === undefined ? {} : { connector: input.connector }),
      userAgent: AUTHORISED_USER_AGENT,
      timeoutMs: 2 * 60 * 60 * 1000,
      maxRedirects: 0,
      maxBytes: bytes,
    });
    const outcome = await downloader.download(input.url ?? IRFAN_NARRATION.url, file);
    if (outcome.kind !== 'downloaded')
      throw new CommandError(
        `the archive could not be downloaded (${outcome.kind}${'detail' in outcome ? `: ${outcome.detail}` : 'status' in outcome ? ` ${String(outcome.status)}` : ''})`,
      );
    if (outcome.bytes !== bytes)
      throw new CommandError('the archive is not the attested size; it is not used');
    downloaded = true;
  }
  return { mode: 'irfan-download', bytes, sha256: await sha256Of(file), downloaded };
}

/** `NNN. Name.mp3` → Surah NNN, or null. */
export function surahOfMember(member: Pick<ZipMember, 'name'>): number | null {
  const match = /^(\d{3})\. [^/\\]+\.mp3$/.exec(member.name);
  if (match === null) return null;
  const surah = Number(match[1]);
  return surah >= 1 && surah <= QURAN_SURAH_MAX ? surah : null;
}

/** The archive's members as exactly one per Surah, or a refusal. */
export function membersBySurah(
  members: readonly ZipMember[],
): ReadonlyMap<number, ZipMember> {
  const bySurah = new Map<number, ZipMember>();
  for (const member of members) {
    if (member.name.endsWith('/')) continue;
    const surah = surahOfMember(member);
    if (surah === null || bySurah.has(surah))
      throw new CommandError('the archive is not one MP3 per Surah; nothing was changed');
    bySurah.set(surah, member);
  }
  if (bySurah.size !== QURAN_SURAH_MAX)
    throw new CommandError(
      'the archive does not hold all 114 Surahs; nothing was changed',
    );
  return bySurah;
}

export async function importIrfanNarration(
  runner: QuranReferenceRunner,
  input: {
    readonly operator: string;
    readonly source: string;
    readonly zip: string;
    readonly sha256: string;
  },
): Promise<Record<string, unknown>> {
  const actor = { accountId: input.operator };
  await requireAuthority(runner, input.operator, true);
  if ((await sha256Of(input.zip)) !== input.sha256)
    throw new CommandError('the archive is not the one recorded; nothing was changed');
  const surahs = await corpusSurahs(runner, actor);

  const handle = await open(input.zip, 'r');
  try {
    const members = membersBySurah(await zipMembers(handle));
    const person = await ensurePerson(runner, input.operator, {
      slug: IRFAN_NARRATION.narrator.slug,
      primaryLocale: 'en',
      names: { en: IRFAN_NARRATION.narrator.name },
    });
    if ('skip' in person) throw new CommandError(`the narrator: ${person.skip}`);

    let detail: RecitationDetail;
    const existing = await recitationBySlug(runner, actor, IRFAN_NARRATION.slug);
    if (existing === null) {
      detail = await quran(
        runner.quran.createRecitation(actor, {
          value: {
            slug: IRFAN_NARRATION.slug,
            name: IRFAN_NARRATION.name,
            reciterId: person.id,
            style: null,
            attribution: IRFAN_NARRATION.attribution,
            sourceId: input.source,
            languageCode: 'ur',
          },
        }),
      );
    } else {
      if (
        existing.stream !== null ||
        existing.sourceId !== input.source ||
        existing.reciterId !== person.id
      )
        throw new CommandError(
          'another recitation holds the narration’s slug; nothing was changed',
        );
      const held = await quran(runner.quran.recitation(actor, existing.id));
      if (held === null) throw new CommandError('the recitation vanished mid-import');
      detail = held;
    }

    const report = {
      stored: 0,
      kept: 0,
      skipped: [] as { surah: number; reason: string }[],
    };
    for (let surah = 1; surah <= QURAN_SURAH_MAX; surah += 1) {
      const member = members.get(surah);
      const ayahCount = surahs.get(surah)?.ayahCount ?? 0;
      if (member === undefined || ayahCount === 0) continue;
      let segment = detail.segments.find((entry) => entry.surah === surah);
      if (segment?.assetId !== null && segment !== undefined) {
        report.kept += 1;
        continue;
      }
      if (segment === undefined) {
        detail = await quran(
          runner.quran.addRecitationSegment(actor, {
            id: detail.id,
            expectedVersion: detail.version,
            value: { surah, startAyah: 1, endAyah: ayahCount },
          }),
        );
        segment = detail.segments.find((entry) => entry.surah === surah);
        if (segment === undefined) throw new CommandError('the new segment vanished');
      }
      // The member is read through once to prove its size and CRC-32 BEFORE a
      // byte reaches Storage, then streamed into it exactly as it is.
      await verifyMember(handle, input.zip, member);
      try {
        detail = await runner.upload.uploadSegmentAudio(
          actor,
          detail.id,
          segment.id,
          detail.version,
          memberBytes(handle, input.zip, member),
          { declaredMediaType: 'audio/mpeg', displayName: member.name },
        );
        report.stored += 1;
      } catch (error) {
        const reason = refusalOf(error);
        if (reason === null) throw error;
        if (reason === 'denied')
          throw new CommandError('the operator does not hold quran.administer');
        report.skipped.push({ surah, reason });
        const refreshed = await quran(runner.quran.recitation(actor, detail.id));
        if (refreshed === null)
          throw new CommandError('the recitation vanished mid-import');
        detail = refreshed;
      }
    }
    const published = await publishIfReady(runner, actor, detail);
    return {
      mode: 'irfan-urdu',
      recitationId: detail.id,
      person: person.state,
      ...report,
      published,
    };
  } finally {
    await handle.close();
  }
}

/* ===========================================================================
 * Entry
 * ========================================================================= */

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(import.meta.filename)
) {
  await runCommand('quran:recitations-runtime', async () => {
    const [mode] = process.argv.slice(2);
    if (mode === 'irfan-download')
      return downloadIrfanNarration({ directory: required('--dir', USAGE) });
    approvedTarget(process.env['DATABASE_URL']);
    const runner = composeQuranReferenceRunner();
    if (mode === 'mp3quran')
      return importMp3Quran(runner, {
        operator: identifier('--operator', ACCOUNT_ID),
        source: identifier('--source', SOURCE_ID),
        get: politeJson(mp3quranFetcher()),
      });
    if (mode === 'irfan-urdu')
      return importIrfanNarration(runner, {
        operator: identifier('--operator', ACCOUNT_ID),
        source: identifier('--source', SOURCE_ID),
        zip: required('--zip', USAGE),
        sha256: identifier('--sha256', SHA256),
      });
    throw new CommandError(`usage: ${USAGE}`);
  });
}
