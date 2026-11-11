import { createHash } from 'node:crypto';

import { MEDIA_PAGE } from '@minhaj/contracts/media';

import {
  composeTafsirPassagesRunner,
  type TafsirPassagesRunner,
} from '../../apps/web/src/composition/tafsir-passages-runner.ts';
import {
  approvedTarget,
  argument,
  CommandError,
  required,
  runCommand,
} from '../migration/cli.ts';
import {
  planFingerprint,
  planPassages,
  type SurahNameInput,
  type TitledOwner,
} from './title-passages.ts';

/**
 * THE RUNTIME HALF of the tafsir-passages operator command (Quran Part 8) —
 * run ONLY as a child of `staging-tafsir-passages`
 * (`docker/staging/bin/tafsir-passages.sh`), as the RUNTIME principal, whose
 * `DATABASE_URL` is the only database setting it holds:
 *
 *   propose --operator <accountId>
 *     Reads every Library Work and Media Video (`library.read`, `media.read`)
 *     and the Surahs' canonical names (`quran.read`), reads each PUBLISHED
 *     record's titles by the strict rule in `./title-passages.ts`, and prints
 *     the plan's counts, its size and its fingerprint. Changes nothing.
 *
 *   apply --operator <accountId> --confirm-count <n> --confirm-fingerprint <hex>
 *     Builds the plan again and refuses, changing nothing, unless its size and
 *     fingerprint are exactly the ones confirmed; then applies each record's
 *     passages through its OWNER's service (`library.administer`,
 *     `media.administer`) under the version the plan read, which records an
 *     audit entry naming this command as the passages' origin and never
 *     overwrites a record that carries a passage. A record changed since is
 *     counted as a conflict and left alone.
 *
 * The final stdout line is one JSON object of counts: never a title.
 */

const USAGE =
  'tafsir-passages-runtime propose --operator <id> | ' +
  'apply --operator <id> --confirm-count <n> --confirm-fingerprint <hex>';

/** An internal account identifier (the operator commands' shape). */
const ACCOUNT_ID = /^[A-Za-z0-9_-]{8,36}$/u;
const FINGERPRINT = /^[0-9a-f]{64}$/u;
const WHOLE = /^(0|[1-9][0-9]{0,6})$/u;
/** Library's administrative directory page. */
const WORK_PAGE = 25;

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

async function surahNames(runner: TafsirPassagesRunner): Promise<SurahNameInput[]> {
  const surahs = await runner.surahs();
  if (surahs.length === 0)
    throw new CommandError(
      'no Quran corpus is accepted, so no Surah has a name; nothing was read',
    );
  return surahs.map((surah) => ({
    number: surah.number,
    ayahCount: surah.ayahCount,
    names: Object.values(surah.names).filter(
      (name): name is string => typeof name === 'string' && name !== '',
    ),
  }));
}

/** Every Work and Video, as the titles and versions the plan reads. */
async function owners(runner: TafsirPassagesRunner): Promise<TitledOwner[]> {
  const found: TitledOwner[] = [];
  for (let offset = 0; ; offset += WORK_PAGE) {
    const page = await runner.works(offset);
    for (const work of page.items)
      found.push({
        kind: 'work',
        id: work.id,
        version: work.version,
        published: work.state === 'published',
        titles: work.labels.map((label) => label.title),
        hasPassages: false,
      });
    if (!page.hasMore) break;
  }
  for (let offset = 0; ; offset += MEDIA_PAGE) {
    const page = await runner.videos(offset);
    for (const video of page.items)
      found.push({
        kind: 'video',
        id: video.id,
        version: video.version,
        published: video.state === 'published',
        titles: video.labels.map((label) => label.title),
        hasPassages: false,
      });
    if (!page.hasMore) break;
  }
  return found;
}

/**
 * Whether a record a title names already carries a passage — read only for the
 * few records the titles name, through the owner's own detail read.
 */
async function withCarriedPassages(
  runner: TafsirPassagesRunner,
  all: readonly TitledOwner[],
  surahs: readonly SurahNameInput[],
): Promise<TitledOwner[]> {
  const named = new Set(
    planPassages(all, surahs).planned.map((entry) => `${entry.kind}:${entry.id}`),
  );
  const result: TitledOwner[] = [];
  for (const owner of all) {
    if (!named.has(`${owner.kind}:${owner.id}`)) {
      result.push(owner);
      continue;
    }
    const carried =
      owner.kind === 'work'
        ? ((await runner.work(owner.id))?.quranPassages.length ?? 0)
        : ((await runner.video(owner.id))?.quranPassages.length ?? 0);
    result.push({ ...owner, hasPassages: carried > 0 });
  }
  return result;
}

await runCommand('tafsir-passages', async () => {
  const target = approvedTarget(process.env['DATABASE_URL']);
  const [mode] = process.argv.slice(2);
  if (mode !== 'propose' && mode !== 'apply') throw new CommandError(`usage: ${USAGE}`);
  const operator = required('--operator', USAGE);
  if (!ACCOUNT_ID.test(operator))
    throw new CommandError('--operator must be an internal account identifier');

  let confirmed: { count: number; fingerprint: string } | null = null;
  if (mode === 'apply') {
    const count = required('--confirm-count', USAGE);
    const fingerprint = required('--confirm-fingerprint', USAGE);
    if (!WHOLE.test(count) || !FINGERPRINT.test(fingerprint))
      throw new CommandError(
        '--confirm-count and --confirm-fingerprint are not of the expected shape',
      );
    confirmed = { count: Number(count), fingerprint };
  } else if (
    argument('--confirm-count') !== undefined ||
    argument('--confirm-fingerprint') !== undefined
  )
    throw new CommandError('propose takes no confirmation; use apply');

  const runner = composeTafsirPassagesRunner(operator);
  const surahs = await surahNames(runner);
  const read = await withCarriedPassages(runner, await owners(runner), surahs);
  const plan = planPassages(read, surahs);
  const { count, fingerprint } = planFingerprint(plan.planned, sha256);

  if (confirmed === null)
    return { target, mode, ...plan.counts, count, fingerprint, applied: 0 };

  if (confirmed.count !== count || confirmed.fingerprint !== fingerprint)
    throw new CommandError(
      'the plan is not the one confirmed (records or titles changed since the preview); nothing was applied — run propose again',
    );

  let applied = 0;
  let conflicts = 0;
  for (const entry of plan.planned) {
    try {
      if (entry.kind === 'work')
        await runner.applyWork(entry.id, entry.version, entry.passages);
      else
        await runner.applyVideo(
          entry.id,
          entry.version,
          entry.passages.map((passage) => ({ ...passage, startSeconds: null })),
        );
      applied += 1;
    } catch (error) {
      const reason = (error as { reason?: unknown } | null)?.reason;
      if (reason === 'conflict') conflicts += 1;
      else throw error;
    }
  }
  return { target, mode, ...plan.counts, count, fingerprint, applied, conflicts };
});
