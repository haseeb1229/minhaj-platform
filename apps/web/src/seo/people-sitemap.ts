import { editorialSitemapPartitions, mergePagePartitions } from './editorial-sitemap';
import { librarySitemapPartitions } from './library-sitemap';
import { newsSitemapPartitions } from './news-sitemap';
import { eventSitemapPartitions } from './events-sitemap';
import { collectionSitemapPartitions } from './collections-sitemap';
import { centreSitemapPartitions } from './centres-sitemap';
import {
  audioSitemapPartitions,
  gallerySitemapPartitions,
  mediaSitemapPartitions,
} from './media-sitemap';
import { scholarlySitemapPartitions } from './scholarly-sitemap';
import { topicsSitemapPartitions } from './topics-sitemap';
import { quranSitemapPartitions } from './quran-sitemap';
import { hadithSitemapPartitions } from './hadith-sitemap';
import { fatwaSitemapPartitions } from './fatwa-sitemap';
import { learningSitemapPartitions } from './learning-sitemap';
import 'server-only';

import { localeSchema } from '@minhaj/contracts';
import type { PersonSitemapEntry } from '@minhaj/contracts/people';

import { peopleReadRuntime } from '@/composition/people-read';
import { absoluteUrl } from '@/config/origin';
import { publicIndexingEnabled } from '@/config/indexing';
import { partitionPath, sitemapPartitions, type SitemapPartition } from './sitemap';

/**
 * The CONTENT half of the sitemap — Phase 5's `people` segment.
 *
 * A SEPARATE MODULE FROM `./sitemap.ts`, AND THE SEPARATION IS A BUILD
 * BOUNDARY. That module is imported by `robots.txt`, which is generated with
 * the artifact; this one reaches the database and is imported only by the two
 * sitemap ROUTE HANDLERS, both of which are `force-dynamic`. So nothing
 * prerendered at build time can reach a database through either, which is what
 * ARCHITECTURE.md §8.3.1 requires of a build that "runs in CI and on developer
 * machines that hold no production credential".
 *
 * IT REACHES THE PUBLIC READ RUNTIME, NOT THE FULL ONE. `@/composition/people`
 * wires Identity in for the administrative surface; importing it here would put
 * the session service and the authentication library into the graph of a public
 * document. `@/composition/people-read` is three read methods over People's own
 * reader, and nothing else.
 */

/**
 * The segment Phase 5 owns.
 *
 * `people` is ROUTE_MAP.md §9.4's own name for it, which is why it is not
 * `contributors`.
 */
const PEOPLE_SEGMENT = 'people';

/**
 * How many contributor rows one child partition may cover.
 *
 * A ceiling rather than a guess: §9.4 requires large segments to split
 * numerically, and that split belongs to the phase whose corpus first needs it.
 * Reads continue until exhaustion and locale URL sets are split at this bound;
 * it is never a total-corpus ceiling.
 */
const PEOPLE_PARTITION_LIMIT = 5_000;

/**
 * A deliberately smaller database page. Prisma's SQL Server relation loading
 * parameterises parent identifiers, so a 5,000-row read can exceed SQL
 * Server's 2,100-parameter statement limit even though the XML partition is
 * valid. Paging and XML partitioning are separate bounds.
 */
const PEOPLE_READ_BATCH = 1_000;

/**
 * The contributor partitions, read per request.
 *
 * ONE PARTITION PER LOCALE, AND A CONTRIBUTOR APPEARS ONLY IN THE LOCALES THEY
 * GENUINELY EXIST IN. A record written in Urdu with no English version
 * contributes a `ur` URL and no `en` one — "untranslated content is never listed
 * as an alternate", and a sitemap entry for a URL that merely falls back is the
 * same false signal in a different file (§9.2, §9.4).
 *
 * DRAFT AND ARCHIVED RECORDS ARE ABSENT, because the reader returns only
 * published ones. Neither is filtered here, so a change to what "public" means
 * cannot be missed by this module.
 *
 * NO ALIAS EVER APPEARS. `/authors/{slug}` and `/library/authors/{slug}` are
 * redirect sources, and "only canonical, indexable URLs appear … never filtered
 * views, `noindex` pages, authenticated routes or redirect sources" (§9.4).
 * Nothing here builds one: the only path this function constructs is the
 * canonical `/people/{slug}`.
 */
export async function peopleSitemapPartitions(): Promise<readonly SitemapPartition[]> {
  // FAIL CLOSED FIRST, and before any query. While indexing is disabled there
  // is nothing to advertise, so there is nothing to read either.
  if (!publicIndexingEnabled()) return [];

  const entries: PersonSitemapEntry[] = [];
  let offset = 0;

  while (true) {
    const batch = await peopleReadRuntime().people.sitemapEntries(
      PEOPLE_READ_BATCH,
      offset,
    );
    entries.push(...batch);
    if (batch.length < PEOPLE_READ_BATCH) break;
    offset += batch.length;
  }

  if (entries.length === 0) return [];

  const partitions: SitemapPartition[] = [];

  for (const locale of localeSchema.options) {
    const urls = entries
      .filter((entry) => entry.contentLocales.includes(locale))
      .map((entry) => ({
        loc: absoluteUrl(`/${locale}/people/${entry.slug}`),
        // GENUINE CONTENT MODIFICATION. `Person.updatedAt` is moved by every
        // mutation that changes what the profile page renders, including the
        // ones that write a child row — so this is the date the page actually
        // changed rather than the date this file was deployed.
        lastmod: entry.updatedAt.toISOString(),
      }));

    // Empty partitions are dropped. Large locale segments split numerically,
    // preserving the accepted first filename and adding -2, -3, ... only when
    // the specification-sized bound is crossed.
    for (let start = 0; start < urls.length; start += PEOPLE_PARTITION_LIMIT) {
      const part = start / PEOPLE_PARTITION_LIMIT + 1;
      partitions.push({
        segment: PEOPLE_SEGMENT,
        locale,
        ...(part === 1 ? {} : { part }),
        urls: urls.slice(start, start + PEOPLE_PARTITION_LIMIT),
      });
    }
  }

  return partitions;
}

/**
 * Every partition the index advertises — build-bound and content together.
 *
 * ASYNC, so its caller is a route handler rather than a build artifact.
 */
export async function allSitemapPartitions(): Promise<readonly SitemapPartition[]> {
  return mergePagePartitions([
    ...sitemapPartitions(),
    ...(await peopleSitemapPartitions()),
    ...(await editorialSitemapPartitions()),
    // Phase 8's `books` segment. It merges through the same function for the
    // de-duplication and the 5,000-URL split, not because it shares a segment
    // name with anything — `books` is its own (ROUTE_MAP.md §9.4).
    ...(await librarySitemapPartitions()),
    // Phase 17's `topics` segment: the canonical topic hubs.
    ...(await topicsSitemapPartitions()),
    // Phase 9's `research` and `publications` segments, split at 5,000 URLs by
    // the same merge.
    ...(await scholarlySitemapPartitions()),
    // Phase 10's `videos` segment: Videos, Series and programmes at their one
    // family, and Playlists.
    ...(await mediaSitemapPartitions()),
    // Phase 11's `audio` segment: AudioTracks and AudioSeries at their one
    // canonical address.
    ...(await audioSitemapPartitions()),
    // Phase 12's `galleries` segment: published Galleries that hold a public
    // photograph. A Photo has no page, so it has no URL here.
    ...(await gallerySitemapPartitions()),
    // Phase 13's `news` segment: the published records of all four News
    // families at their canonical detail addresses.
    ...(await newsSitemapPartitions()),
    // Phase 14's `events` segment: published Events at their canonical address.
    ...(await eventSitemapPartitions()),
    // Phase 15's `collections` segment: published Collections at their
    // canonical address. Their members are listed in their owners' segments.
    ...(await collectionSitemapPartitions()),
    // Phase 16's `centres` segment: public Centres at their canonical address.
    ...(await centreSitemapPartitions()),
    // Phase 18's `quran` segment: canonical Ayah citations, and only while an
    // APPROVED corpus is active — a fixture corpus is never advertised.
    ...(await quranSitemapPartitions()),
    // Phase 19's `hadith` segment: canonical citations, and only while an
    // APPROVED activation stands — fixture activation is never advertised.
    ...(await hadithSitemapPartitions()),
    // Phase 20's `fatwa` segment: published rulings at their canonical address,
    // each in its own content language only, and only while an APPROVED
    // activation stands — fixture activation is never advertised.
    ...(await fatwaSitemapPartitions()),
    // Phase 22's `courses` and `learning-paths` segments: published Courses
    // and LearningPaths at their current canonical address, each in the
    // locales it genuinely has words in.
    ...(await learningSitemapPartitions()),
  ]);
}

/**
 * Finds ANY partition a request names, or `null`.
 *
 * The filename is matched against the partitions that actually EXIST rather
 * than parsed into a segment and a locale, so no request can name a partition
 * into being — `/sitemaps/quran-en.xml` is a 404 today because no Quran
 * partition is produced, not because a parser rejected the string, and
 * `/sitemaps/../../etc.xml` is a 404 because it matches nothing. Nothing
 * reaches a filesystem or a template from this segment.
 *
 * THE BUILD-BOUND HALF IS TRIED FIRST, so a request for a shell partition costs
 * no database read at all.
 */
export async function findSitemapPartition(
  filename: string,
): Promise<SitemapPartition | null> {
  return (
    (await allSitemapPartitions()).find(
      (partition) => partitionPath(partition) === '/sitemaps/' + filename,
    ) ?? null
  );
}
