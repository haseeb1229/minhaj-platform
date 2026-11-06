import 'server-only';

import { NEWS_KINDS } from '@minhaj/contracts/editorial';
import { connection } from 'next/server';
import { cache } from 'react';

import { donationsReadRuntime } from '@/composition/donations-read';
import { editorialReadRuntime } from '@/composition/editorial-read';
import { fatwaReadRuntime } from '@/composition/fatwa-read';
import { globalReadRuntime } from '@/composition/global-read';
import { hadithReadRuntime } from '@/composition/hadith-read';
import { learningReadRuntime } from '@/composition/learning-read';
import { libraryReadRuntime } from '@/composition/library-read';
import { mediaReadRuntime } from '@/composition/media-read';
import { peopleReadRuntime } from '@/composition/people-read';
import { quranReadRuntime } from '@/composition/quran-read';
import {
  UNKNOWN_PRESENCE,
  type PresenceSignal,
  type PresenceSnapshot,
} from '@/shell/presence';

/**
 * THE EVIDENCE BEHIND THE PRESENTATION POLICY (`@/shell/presence`, R1).
 *
 * Each signal is answered by the OWNING context's own public read — a
 * one-row sitemap read, an activation read, or the public Donations page read —
 * through the same composition roots the public pages use. Nothing here reads a
 * session, a cookie or a header: it is public, anonymous state, so the shell
 * that consumes it stays session-free (ARCHITECTURE.md §8.1).
 *
 * FAIL CLOSED, PER SIGNAL. A read that throws contributes no evidence, so its
 * destination is simply not advertised; the page itself still renders. It is
 * deliberately NOT logged here: the anonymous public graph reaches no logger
 * and no server environment (tests/architecture/phase4-shell-boundaries), and
 * the owning page that reads the same data reports its own failure. With no
 * database at all (a build, a database-less proof server) every signal is
 * absent and the shell promotes only what needs no evidence.
 *
 * BOUNDED COST. The snapshot is computed at most once per request (`cache`)
 * and reused across requests for `TTL_MS`, so promoting a newly published area
 * can lag by at most that long — a presentation delay, never an access change:
 * every route answers by its own reads on every request.
 */
const TTL_MS = 30_000;

let memo: { readonly at: number; readonly value: PresenceSnapshot } | null = null;

type Probe = () => Promise<boolean>;

const PROBES: Readonly<Record<PresenceSignal, Probe>> = {
  quran: async () => {
    const availability = await quranReadRuntime().reader.availability();
    return availability.active && availability.mode === 'approved';
  },
  hadith: async () => {
    const availability = await hadithReadRuntime().reader.availability();
    return availability.active && availability.mode === 'approved';
  },
  library: async () => {
    const [works, magazines, articles] = await Promise.all([
      libraryReadRuntime().sitemap(0, 1),
      libraryReadRuntime().scholarlySitemap('magazine', 0, 1),
      editorialReadRuntime().articleSitemap(0, 1),
    ]);
    return works.length + magazines.length + articles.length > 0;
  },
  watch: async () => (await mediaReadRuntime().sitemap('video', 0, 1)).length > 0,
  listen: async () => (await mediaReadRuntime().audioSitemap('track', 0, 1)).length > 0,
  learn: async () => (await learningReadRuntime().sitemap('course', 0, 1)).length > 0,
  fatwa: async () => {
    const reader = fatwaReadRuntime().reader;
    const availability = await reader.availability();
    if (!availability.active || availability.mode !== 'approved') return false;
    return (await reader.sitemap(0, 1)).length > 0;
  },
  news: async () => {
    const reads = editorialReadRuntime();
    const found = await Promise.all(
      NEWS_KINDS.map((kind) => reads.newsSitemap(kind, 0, 1)),
    );
    return found.some((rows) => rows.length > 0);
  },
  events: () => editorialReadRuntime().hasPublishedEvents(),
  collections: async () =>
    (await editorialReadRuntime().collectionSitemap(0, 1)).length > 0,
  people: async () => (await peopleReadRuntime().people.sitemapEntries(1, 0)).length > 0,
  presence: async () => (await globalReadRuntime().countries(0)).items.length > 0,
  centres: async () => (await globalReadRuntime().centreSitemap(0, 1)).length > 0,
  help: async () => (await editorialReadRuntime().helpPages(0)).length > 0,
  giving: async () => {
    const page = await donationsReadRuntime().page.page();
    return page.availability.available && page.campaigns.length > 0;
  },
};

async function compute(): Promise<PresenceSnapshot> {
  const signals = new Set<PresenceSignal>();
  const entries = Object.entries(PROBES) as [PresenceSignal, Probe][];
  const [, pages] = await Promise.all([
    Promise.all(
      entries.map(async ([signal, probe]) => {
        try {
          if (await probe()) signals.add(signal);
        } catch {
          // No evidence: the destination is simply not promoted.
        }
      }),
    ),
    editorialReadRuntime()
      .pageSitemap(0, 500)
      .then(
        (rows): ReadonlySet<string> =>
          new Set(
            rows.flatMap((row) => (row.routeBinding === null ? [] : [row.routeBinding])),
          ),
      )
      .catch(() => UNKNOWN_PRESENCE.publishedPages),
  ]);
  return Object.freeze({ signals, publishedPages: pages });
}

/** The presence snapshot for this request (at most `TTL_MS` old). */
export const readPresence = cache(async (): Promise<PresenceSnapshot> => {
  // Request-time by construction: a page whose shell reads presence renders per
  // request, so nothing is queried — or baked into a prerender — at build time.
  await connection();
  const now = Date.now();
  if (memo !== null && now - memo.at < TTL_MS) return memo.value;
  const value = await compute();
  memo = { at: now, value };
  return value;
});
