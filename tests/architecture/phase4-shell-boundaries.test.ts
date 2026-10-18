import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { repoRoot } from './architecture-harness.ts';

/**
 * PHASE 4 — the boundaries the public shell must hold.
 *
 * THE CENTRAL ONE IS THE CACHE BOUNDARY. "The anonymous public render tree must
 * never read session-derived state" (ARCHITECTURE.md §8.1,
 * SECURITY_BASELINE.md §17) is not a property a page can be spot-checked for:
 * one `await session()` three components deep, added a year from now to put a
 * name in the header, turns one cached document into somebody else's. So the
 * proof is over the whole reachable import graph rather than over the files a
 * reviewer thought to open, and a new public route inherits it automatically.
 *
 * These are SOURCE proofs. The rendered-output half — that a request carrying a
 * session cookie and one carrying none produce identical public HTML — lives in
 * the browser suite, because that is the only place it can honestly be made.
 */

const APP_SRC = path.join(repoRoot, 'apps', 'web', 'src');
const PUBLIC_GROUP = path.join(APP_SRC, 'app', '[locale]', '(public)');

/**
 * THE PUBLIC GROUP HOLDS TWO KINDS OF ROUTE SINCE PHASE 5, and the properties
 * each must satisfy are not the same. Both are stated below; neither is
 * relaxed.
 *
 * PRERENDERED SHELL ROUTES are Phase 4's. Their content is CODE — the route
 * registry, the message catalogues — so they are built at build time, and
 * ARCHITECTURE.md §8.3.1 governs them by name: "A page in the anonymous public
 * tree is prerendered at build time, which constrains its configuration as well
 * as its data … The build runs in CI and on developer machines that hold no
 * production credential." They reach no database, no server environment schema,
 * no session and no request-scoped API, and none of them is dynamic.
 *
 * CONTENT ROUTES are Phase 5's first, and every later content phase's. Their
 * content is DATA an administrator changes, which DELIVERY_PLAN.md requires of
 * the canonical `/people/{slug}` profile. They CANNOT be prerendered — a static
 * copy would keep serving a withdrawn contributor, and "unpublished, staged or
 * draft content is never publicly reachable at all" (ROUTE_MAP.md §9.5) is not
 * a claim a stale page can honour.
 *
 * WHAT DOES NOT CHANGE FOR EITHER is §8.1 itself: "the anonymous public render
 * tree must never read session-derived state". A contributor record is
 * published editorial content, not "any per-user record", so reading one is not
 * what that rule forbids — and the content routes are still proven, below, to
 * reach no session, no identity service and no authentication library at all.
 *
 * The split is declared rather than inferred, so a new route joins one list
 * deliberately. A file under the public group that is in NEITHER list fails the
 * first test in each block, which is what stops the distinction being used to
 * quietly exempt something.
 */
const CONTENT_ROUTE_FILES = [
  'apps/web/src/app/[locale]/(public)/contact/page.tsx',
  'apps/web/src/app/[locale]/(public)/feedback/page.tsx',
  'apps/web/src/app/[locale]/(public)/help/page.tsx',
  'apps/web/src/app/[locale]/(public)/help/[slug]/page.tsx',
  'apps/web/src/app/[locale]/(public)/volunteer/page.tsx',
  'apps/web/src/app/[locale]/(public)/library/articles/page.tsx',
  'apps/web/src/app/[locale]/(public)/library/articles/[slug]/page.tsx',
  'apps/web/src/app/[locale]/(public)/legal/[document]/page.tsx',
  'apps/web/src/app/[locale]/(public)/explore/[section]/page.tsx',
  'apps/web/src/app/[locale]/(public)/explore/[section]/[page]/page.tsx',
  'apps/web/src/app/[locale]/(public)/correspondence-form.tsx',
  'apps/web/src/app/[locale]/(public)/people-alias.ts',
  'apps/web/src/app/[locale]/(public)/people/[slug]/page.tsx',
  'apps/web/src/app/[locale]/(public)/authors/[slug]/route.ts',
  'apps/web/src/app/[locale]/(public)/library/authors/[slug]/route.ts',
  // Phase 8. Every Library surface that reads Works, Editions, facets or sale
  // points is data an administrator changes. The Library LANDING page reads no
  // data at all and stays in the prerendered graph, deliberately absent here.
  'apps/web/src/app/[locale]/(public)/library/books/page.tsx',
  'apps/web/src/app/[locale]/(public)/library/books/[slug]/page.tsx',
  'apps/web/src/app/[locale]/(public)/library/authors/page.tsx',
  'apps/web/src/app/[locale]/(public)/library/topics/page.tsx',
  'apps/web/src/app/[locale]/(public)/library/languages/page.tsx',
  'apps/web/src/app/[locale]/(public)/library/downloads/page.tsx',
  'apps/web/src/app/[locale]/(public)/library/sale-points/page.tsx',
  'apps/web/src/app/[locale]/(public)/library/resources/page.tsx',
  // Phase 17. Search results and the topic hub read published, mutable data
  // through public readers — and the search page consumes rate-limit budget —
  // so none of them can be prerendered. Each is proven below to reach no
  // session, no identity service and no authentication library.
  'apps/web/src/app/[locale]/(public)/search/page.tsx',
  'apps/web/src/app/[locale]/(public)/topics/page.tsx',
  'apps/web/src/app/[locale]/(public)/topics/[slug]/page.tsx',
  // Phase 9. The scholarly and periodical listings, records, Magazines and their
  // issues are published data an administrator changes; each is proven below to
  // reach no session, no identity service and no authentication library.
  'apps/web/src/app/[locale]/(public)/library/research/page.tsx',
  'apps/web/src/app/[locale]/(public)/library/research/[slug]/page.tsx',
  'apps/web/src/app/[locale]/(public)/library/research-papers/page.tsx',
  'apps/web/src/app/[locale]/(public)/library/research-papers/[slug]/page.tsx',
  'apps/web/src/app/[locale]/(public)/library/publications/page.tsx',
  'apps/web/src/app/[locale]/(public)/library/publications/[slug]/page.tsx',
  'apps/web/src/app/[locale]/(public)/library/encyclopedias/page.tsx',
  'apps/web/src/app/[locale]/(public)/library/encyclopedias/[slug]/page.tsx',
  'apps/web/src/app/[locale]/(public)/library/magazines/page.tsx',
  'apps/web/src/app/[locale]/(public)/library/magazines/[slug]/page.tsx',
  'apps/web/src/app/[locale]/(public)/library/magazines/[slug]/issues/[issueSlug]/page.tsx',
  // Phase 10. Every Watch surface reads Videos, Series and Playlists an
  // administrator publishes and withdraws, so none can be prerendered; each is
  // proven below to reach no session, no identity service and no authentication
  // library. The speaker alias shares People's alias behaviour.
  'apps/web/src/app/[locale]/(public)/watch/page.tsx',
  'apps/web/src/app/[locale]/(public)/watch/[view]/page.tsx',
  'apps/web/src/app/[locale]/(public)/watch/videos/page.tsx',
  'apps/web/src/app/[locale]/(public)/watch/videos/[slug]/page.tsx',
  'apps/web/src/app/[locale]/(public)/watch/series-routes.tsx',
  'apps/web/src/app/[locale]/(public)/watch/series/page.tsx',
  'apps/web/src/app/[locale]/(public)/watch/series/[slug]/page.tsx',
  'apps/web/src/app/[locale]/(public)/watch/programs/page.tsx',
  'apps/web/src/app/[locale]/(public)/watch/programs/[slug]/page.tsx',
  'apps/web/src/app/[locale]/(public)/watch/playlists/page.tsx',
  'apps/web/src/app/[locale]/(public)/watch/playlists/[slug]/page.tsx',
  'apps/web/src/app/[locale]/(public)/watch/speakers/page.tsx',
  'apps/web/src/app/[locale]/(public)/watch/speakers/[slug]/route.ts',
  'apps/web/src/app/[locale]/(public)/watch/topics/[slug]/page.tsx',
  // Phase 11. Every Listen surface reads AudioTracks and AudioSeries an
  // administrator publishes and withdraws, and a track's page asks Storage
  // whether its file can be served now — so none can be prerendered, and each
  // is proven below to reach no session, no identity service, no logger and no
  // authentication library.
  'apps/web/src/app/[locale]/(public)/listen/page.tsx',
  'apps/web/src/app/[locale]/(public)/listen/lectures/page.tsx',
  'apps/web/src/app/[locale]/(public)/listen/lectures/[slug]/page.tsx',
  'apps/web/src/app/[locale]/(public)/listen/series/page.tsx',
  'apps/web/src/app/[locale]/(public)/listen/series/[slug]/page.tsx',
  // Phase 12. Every photograph surface reads Photos and Galleries an
  // administrator publishes and withdraws, and asks Storage whether each image
  // can be served now — so none can be prerendered, and each is proven below to
  // reach no session, no identity service, no logger and no authentication
  // library.
  'apps/web/src/app/[locale]/(public)/media/photos/page.tsx',
  'apps/web/src/app/[locale]/(public)/media/galleries/page.tsx',
  'apps/web/src/app/[locale]/(public)/media/galleries/[slug]/page.tsx',
  'apps/web/src/app/[locale]/(public)/media/archive/page.tsx',
  // Phase 13. Every News surface reads records an editor publishes and
  // withdraws, so none can be prerendered; each is proven below to reach no
  // session, no identity service, no logger and no authentication library.
  'apps/web/src/app/[locale]/(public)/news/page.tsx',
  'apps/web/src/app/[locale]/(public)/news/news-routes.tsx',
  'apps/web/src/app/[locale]/(public)/news/[slug]/page.tsx',
  'apps/web/src/app/[locale]/(public)/news/archive/page.tsx',
  'apps/web/src/app/[locale]/(public)/news/press-releases/page.tsx',
  'apps/web/src/app/[locale]/(public)/news/press-releases/[slug]/page.tsx',
  'apps/web/src/app/[locale]/(public)/news/statements/page.tsx',
  'apps/web/src/app/[locale]/(public)/news/statements/[slug]/page.tsx',
  'apps/web/src/app/[locale]/(public)/news/media-coverage/page.tsx',
  'apps/web/src/app/[locale]/(public)/news/media-coverage/[slug]/page.tsx',
  // Phase 16. Every Global Network surface reads directory records an operator
  // publishes and withdraws — and a Centre page composes Editorial's News — so
  // none can be prerendered; each is proven below to reach no session, no
  // identity service, no logger and no authentication library.
  'apps/web/src/app/[locale]/(public)/global/page.tsx',
  'apps/web/src/app/[locale]/(public)/global/find-a-centre/page.tsx',
  'apps/web/src/app/[locale]/(public)/global/countries/page.tsx',
  'apps/web/src/app/[locale]/(public)/global/countries/[country]/page.tsx',
  'apps/web/src/app/[locale]/(public)/global/countries/[country]/regions/[region]/page.tsx',
  'apps/web/src/app/[locale]/(public)/global/countries/[country]/cities/[city]/page.tsx',
  'apps/web/src/app/[locale]/(public)/global/centres/page.tsx',
  'apps/web/src/app/[locale]/(public)/global/centres/[slug]/page.tsx',
  'apps/web/src/app/[locale]/(public)/global/centres/[slug]/news/page.tsx',
  'apps/web/src/app/[locale]/(public)/global/centres/[slug]/contact/page.tsx',
  'apps/web/src/app/[locale]/(public)/global/pakistan/page.tsx',
  // Phase 14. Every Event surface reads records an editor publishes and
  // withdraws, and what is "upcoming" is decided by the server's clock on each
  // request — and each composes Global's Centres and Media's Galleries through
  // their PUBLIC readers — so none can be prerendered; each is proven below to
  // reach no session, no identity service, no logger and no authentication
  // library.
  'apps/web/src/app/[locale]/(public)/events/page.tsx',
  'apps/web/src/app/[locale]/(public)/events/[slug]/page.tsx',
  'apps/web/src/app/[locale]/(public)/events/[slug]/gallery/page.tsx',
  'apps/web/src/app/[locale]/(public)/global/centres/[slug]/events/page.tsx',
  // Phase 15. Every Collection surface reads records an editor publishes and
  // withdraws, and resolves each member through its OWNER's public reader —
  // Editorial's, Library's and Media's — at request time, so none can be
  // prerendered; each is proven below to reach no session, no identity
  // service, no logger and no authentication library.
  'apps/web/src/app/[locale]/(public)/collections/page.tsx',
  'apps/web/src/app/[locale]/(public)/collections/[slug]/page.tsx',
  // Phase 18. Every Quran surface reads whether a corpus is active, and what is
  // public beside it, through Quran's PUBLIC reader — and the related views
  // compose Library's and Media's public readers — so none can be prerendered;
  // each is proven below to reach no session, no identity service, no logger
  // and no authentication library. `/listen/recitations` is the Listen
  // projection of the same Quran-owned catalogue.
  'apps/web/src/app/[locale]/(public)/quran/page.tsx',
  'apps/web/src/app/[locale]/(public)/quran/read/page.tsx',
  'apps/web/src/app/[locale]/(public)/quran/surah/page.tsx',
  'apps/web/src/app/[locale]/(public)/quran/surah/[surahNumber]/page.tsx',
  'apps/web/src/app/[locale]/(public)/quran/surah/[surahNumber]/[ayahNumber]/page.tsx',
  'apps/web/src/app/[locale]/(public)/quran/juz/page.tsx',
  'apps/web/src/app/[locale]/(public)/quran/juz/[juzNumber]/page.tsx',
  'apps/web/src/app/[locale]/(public)/quran/search/page.tsx',
  'apps/web/src/app/[locale]/(public)/quran/translations/page.tsx',
  'apps/web/src/app/[locale]/(public)/quran/translations/[slug]/page.tsx',
  'apps/web/src/app/[locale]/(public)/quran/tafsir/page.tsx',
  'apps/web/src/app/[locale]/(public)/quran/tafsir/[slug]/page.tsx',
  'apps/web/src/app/[locale]/(public)/quran/transliteration/page.tsx',
  'apps/web/src/app/[locale]/(public)/quran/tajweed/page.tsx',
  'apps/web/src/app/[locale]/(public)/quran/tajweed/[rule]/page.tsx',
  'apps/web/src/app/[locale]/(public)/quran/recitations/page.tsx',
  'apps/web/src/app/[locale]/(public)/quran/recitations/[reciter]/page.tsx',
  'apps/web/src/app/[locale]/(public)/quran/topics/[slug]/page.tsx',
  'apps/web/src/app/[locale]/(public)/quran/books/page.tsx',
  'apps/web/src/app/[locale]/(public)/quran/videos/page.tsx',
  'apps/web/src/app/[locale]/(public)/quran/research/page.tsx',
  // Phase 22: the Quran related view of Learning's published Courses on the
  // `quran` Topic, composed from Learning's PUBLIC root.
  'apps/web/src/app/[locale]/(public)/quran/courses/page.tsx',
  'apps/web/src/app/[locale]/(public)/listen/recitations/page.tsx',
  // Phase 19. Every Hadith surface reads whether a collection is activated, and
  // what is public in it, through Hadith's PUBLIC reader — and the related views
  // compose Library's and Media's public readers — so none can be prerendered;
  // each is proven below to reach no session, no identity service, no logger
  // and no authentication library.
  'apps/web/src/app/[locale]/(public)/hadith/page.tsx',
  'apps/web/src/app/[locale]/(public)/hadith/introduction/page.tsx',
  'apps/web/src/app/[locale]/(public)/hadith/collections/page.tsx',
  'apps/web/src/app/[locale]/(public)/hadith/collections/[slug]/page.tsx',
  'apps/web/src/app/[locale]/(public)/hadith/collections/[slug]/books/page.tsx',
  'apps/web/src/app/[locale]/(public)/hadith/collections/[slug]/books/[bookSlug]/page.tsx',
  'apps/web/src/app/[locale]/(public)/hadith/collections/[slug]/books/[bookSlug]/chapters/[chapterSlug]/page.tsx',
  'apps/web/src/app/[locale]/(public)/hadith/[collectionSlug]/[hadithNumber]/page.tsx',
  'apps/web/src/app/[locale]/(public)/hadith/browse/page.tsx',
  'apps/web/src/app/[locale]/(public)/hadith/search/page.tsx',
  'apps/web/src/app/[locale]/(public)/hadith/topics/[slug]/page.tsx',
  'apps/web/src/app/[locale]/(public)/hadith/sciences/page.tsx',
  'apps/web/src/app/[locale]/(public)/hadith/sciences/[slug]/page.tsx',
  'apps/web/src/app/[locale]/(public)/hadith/commentary/page.tsx',
  'apps/web/src/app/[locale]/(public)/hadith/books/page.tsx',
  'apps/web/src/app/[locale]/(public)/hadith/videos/page.tsx',
  'apps/web/src/app/[locale]/(public)/hadith/research/page.tsx',
  // Phase 22: the Hadith related view of Learning's published Courses.
  'apps/web/src/app/[locale]/(public)/hadith/courses/page.tsx',
  // Phase 20. Every Fatwa surface reads whether the service is activated, and
  // which rulings are public now, through Fatwa's PUBLIC reader, so none can be
  // prerendered; each is proven below to reach no session, no identity
  // service, no logger and no authentication library. `/fatwa/ask` reads
  // nothing at all — it redirects every visitor into the authenticated tree —
  // and the read beacon is the client island that posts one read count after
  // render through the action declared below.
  'apps/web/src/app/[locale]/(public)/fatwa/page.tsx',
  'apps/web/src/app/[locale]/(public)/fatwa/search/page.tsx',
  'apps/web/src/app/[locale]/(public)/fatwa/categories/page.tsx',
  'apps/web/src/app/[locale]/(public)/fatwa/categories/[slug]/page.tsx',
  'apps/web/src/app/[locale]/(public)/fatwa/topics/[slug]/page.tsx',
  'apps/web/src/app/[locale]/(public)/fatwa/[slug]/page.tsx',
  'apps/web/src/app/[locale]/(public)/fatwa/how-it-works/page.tsx',
  'apps/web/src/app/[locale]/(public)/fatwa/ask/page.tsx',
  'apps/web/src/app/[locale]/(public)/fatwa/read-beacon.tsx',
  // Phase 21 — the newsletter. The subscribe page is a form; the two emailed
  // link pages GET only whether a link is still usable, through the
  // session-free, secret-free `newsletter-read` root, and POST through the
  // action declared below.
  'apps/web/src/app/[locale]/(public)/newsletter/page.tsx',
  'apps/web/src/app/[locale]/(public)/newsletter/confirm/page.tsx',
  'apps/web/src/app/[locale]/(public)/newsletter/unsubscribe/page.tsx',
  // Phase 22 — Learn. Every surface reads Courses and LearningPaths an operator
  // publishes and withdraws through Learning's PUBLIC root, so none can be
  // prerendered; each is proven below to reach no session, no identity
  // service, no logger and no authentication library. A Course page places
  // the private island, which reads the visitor's own state through
  // `/api/my/learning/*` after hydration.
  'apps/web/src/app/[locale]/(public)/learn/page.tsx',
  'apps/web/src/app/[locale]/(public)/learn/courses/page.tsx',
  'apps/web/src/app/[locale]/(public)/learn/courses/[slug]/page.tsx',
  'apps/web/src/app/[locale]/(public)/learn/paths/page.tsx',
  'apps/web/src/app/[locale]/(public)/learn/paths/[slug]/page.tsx',
  'apps/web/src/app/[locale]/(public)/learn/trial/page.tsx',
  // Phase 23 — live classes. The public schedule and the teacher directory read
  // sessions and teaching scopes an operator schedules, scopes and closes, so
  // neither can be prerendered; each is proven below to reach no session, no
  // identity service, no logger and no authentication library. The teacher
  // alias shares People's alias behaviour, as the author and speaker aliases do.
  'apps/web/src/app/[locale]/(public)/learn/live/page.tsx',
  'apps/web/src/app/[locale]/(public)/learn/teachers/page.tsx',
  'apps/web/src/app/[locale]/(public)/learn/teachers/[slug]/route.ts',
  // Phase 26 — Membership. The page lists the types an operator publishes and
  // archives, through Membership's PUBLIC root, so it cannot be prerendered; it
  // is proven below to reach no session, no identity service, no logger and no
  // authentication library. Applying happens under `/my`, never here.
  'apps/web/src/app/[locale]/(public)/membership/page.tsx',
];

const PUBLIC_ACTION_FILES = [
  'apps/web/src/app/[locale]/(public)/correspondence-actions.ts',
  // Phase 20 — the Fatwa read count: a POST after render, rate limited by the
  // network address, which is why it (and only it) reads a request header.
  'apps/web/src/app/[locale]/(public)/fatwa/read-actions.ts',
  // Phase 21 — newsletter subscribe, confirm and unsubscribe. Anonymous: it
  // reads no session; it reaches the shared mail infrastructure to enqueue
  // and dispatch the confirmation, which is why it is not the Phase-6 graph.
  'apps/web/src/app/[locale]/(public)/newsletter/actions.ts',
];

/** Is this file one of the declared data-backed content routes? */
function isContentRoute(file: string): boolean {
  return CONTENT_ROUTE_FILES.includes(relative(file));
}

/* ===========================================================================
 * A small module-graph walker
 * ========================================================================= */

/** Every file beneath a directory. */
async function filesUnder(directory: string): Promise<string[]> {
  const found: string[] = [];

  async function visit(current: string): Promise<void> {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const child = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(child);
      else found.push(child);
    }
  }

  await visit(directory);
  return found;
}

/**
 * Static and dynamic import specifiers in a source file.
 *
 * COMMENTS ARE STRIPPED FIRST. These files discuss the modules they must not
 * import — that prose is the most useful documentation in them — and matching
 * raw text would report every explanation as an import.
 *
 * `from '…'` covers static imports, type imports and re-exports in whatever
 * shape a multi-line import clause takes; the other three cover a side-effect
 * import, a dynamic one, and `require`.
 */
function specifiersIn(source: string): string[] {
  const body = code(source);
  const found: string[] = [];

  for (const pattern of [
    /\bfrom\s*['"]([^'"]+)['"]/g,
    /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g,
    /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
  ]) {
    for (const match of body.matchAll(pattern)) {
      const specifier = match[1];
      if (specifier !== undefined) found.push(specifier);
    }
  }

  return found;
}

/** Resolves an in-app specifier to a file, or `null` for anything external. */
async function resolveInApp(from: string, specifier: string): Promise<string | null> {
  const base = specifier.startsWith('@/')
    ? path.join(APP_SRC, specifier.slice('@/'.length))
    : specifier === '@minhaj/contracts/env/prerender'
      ? path.join(repoRoot, 'packages', 'contracts', 'src', 'env', 'prerender.ts')
      : specifier.startsWith('.')
        ? path.resolve(path.dirname(from), specifier)
        : null;

  if (base === null) return null;

  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, 'index.ts'),
    path.join(base, 'index.tsx'),
  ]) {
    try {
      if ((await stat(candidate)).isFile()) return candidate;
    } catch {
      // Not this candidate. A specifier that resolves to nothing at all is
      // reported by the typecheck, which runs before this suite in `verify`.
    }
  }

  return null;
}

interface Graph {
  /** Every in-app module reachable from the entry points. */
  readonly modules: Map<string, string>;
  /** Every external package specifier any reachable module imports. */
  readonly packages: Set<string>;
}

/** Walks the reachable graph from a set of entry files. */
async function reachableFrom(entries: readonly string[]): Promise<Graph> {
  const modules = new Map<string, string>();
  const packages = new Set<string>();
  const queue = [...entries];

  while (queue.length > 0) {
    const current = queue.pop();
    if (current === undefined || modules.has(current)) continue;

    const source = await readFile(current, 'utf8');
    modules.set(current, source);

    for (const specifier of specifiersIn(source)) {
      const resolved = await resolveInApp(current, specifier);

      if (resolved === null) packages.add(specifier);
      else if (
        !modules.has(resolved) &&
        !PUBLIC_ACTION_FILES.includes(relative(resolved))
      )
        queue.push(resolved);
    }
  }

  return { modules, packages };
}

/** Repo-relative, forward-slashed, for readable assertion messages. */
function relative(file: string): string {
  return path.relative(repoRoot, file).split(path.sep).join('/');
}

/** Source with comments removed — the prose here names what it prohibits. */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
}

let cachedPrerendered: Graph | null = null;
let cachedContent: Graph | null = null;

/**
 * The graph reachable from the PRERENDERED shell routes.
 *
 * The content routes are excluded at the ENTRY POINTS rather than filtered from
 * the result, because the property being proven is reachability: a module the
 * shell can reach is a module the shell might one day call.
 */
async function publicGraph(): Promise<Graph> {
  const entries = (await filesUnder(PUBLIC_GROUP)).filter(
    (file) => !isContentRoute(file) && !PUBLIC_ACTION_FILES.includes(relative(file)),
  );
  cachedPrerendered ??= await reachableFrom(entries);
  return cachedPrerendered;
}

/** The graph reachable from the declared data-backed content routes. */
async function contentGraph(): Promise<Graph> {
  const entries = (await filesUnder(PUBLIC_GROUP)).filter(isContentRoute);
  cachedContent ??= await reachableFrom(entries);
  return cachedContent;
}

/* ===========================================================================
 * The cache boundary
 * ========================================================================= */

describe('the anonymous public tree reads no session-derived state', () => {
  it('reaches a real graph, so nothing below passes vacuously', async () => {
    const { modules } = await publicGraph();

    // The layout, the home shell, the Explore routes, the legal routes, the
    // sitemap, the error surfaces, and everything they pull in.
    expect(modules.size).toBeGreaterThan(10);
    expect([...modules.keys()].map(relative)).toContain(
      'apps/web/src/components/shell/site-header.tsx',
    );
  });

  it('imports no identity, session or authorisation module anywhere in the graph', async () => {
    // Named by MODULE rather than by symbol: the rule is that the capability
    // is not reachable at all. A helper that wrapped `requireOwnSession` under
    // a friendlier name would still import it, and would still be caught here.
    const forbidden = [
      '@/composition/identity',
      '@/composition/authorization',
      '@/composition/request',
      '@/composition/dispatch',
      '@/contexts/identity-access',
      '@/config/server-env',
      '@minhaj/contracts/env/server',
    ];

    const { modules } = await publicGraph();

    for (const [file, source] of modules) {
      for (const specifier of specifiersIn(source)) {
        expect(
          forbidden.some(
            (entry) => specifier === entry || specifier.startsWith(`${entry}/`),
          ),
          `${relative(file)} imports ${specifier}`,
        ).toBe(false);
      }
    }
  });

  it('reaches only the narrow non-secret prerender environment module', async () => {
    // Walk through aliases, wrappers, relative imports and the guarded package
    // subpath. A source-only name check would miss a wrapper that imported the
    // full server entry on the public tree's behalf.
    const { modules } = await publicGraph();
    const reached = [...modules.keys()].map(relative);

    expect(reached).toContain('packages/contracts/src/env/prerender.ts');
    expect(reached).toContain('packages/contracts/src/env/prerender-build.ts');
    expect(reached).not.toContain('packages/contracts/src/env/server.ts');
    expect(reached).not.toContain('packages/contracts/src/env/server-schema.ts');
    expect(reached).not.toContain('apps/web/src/config/server-env.ts');

    const prerenderSource = code(
      [
        modules.get(
          path.join(repoRoot, 'packages', 'contracts', 'src', 'env', 'prerender.ts'),
        ) ?? '',
        modules.get(
          path.join(
            repoRoot,
            'packages',
            'contracts',
            'src',
            'env',
            'prerender-build.ts',
          ),
        ) ?? '',
      ].join('\n'),
    );

    for (const secret of [
      'AUTH_SECRETS',
      'DATABASE_URL',
      'EMAIL_DIGEST_KEY',
      'NEWSLETTER_TOKEN_KEY',
      'RATE_LIMIT_DIGEST_KEY',
      'RESEND_API_KEY',
    ]) {
      expect(prerenderSource, secret).not.toContain(secret);
    }
  });

  it('imports no request-scoped framework API, so the tree stays static', async () => {
    // `cookies()` and `headers()` are how a session would be read, and they
    // are also what opts a route out of static rendering. One import defeats
    // the caching boundary and opens the door to reading a session in the same
    // move (ARCHITECTURE.md §8.1).
    const forbidden = ['next/headers', 'next/cookies', 'better-auth'];

    const { packages, modules } = await publicGraph();

    for (const specifier of packages) {
      expect(
        forbidden.some(
          (entry) => specifier === entry || specifier.startsWith(`${entry}/`),
        ),
        `the public graph imports ${specifier}`,
      ).toBe(false);
    }

    // And no database or shared-server capability either: a public page has no
    // business holding one, and Model A would not permit it in any case.
    for (const specifier of packages) {
      expect(specifier.startsWith('@minhaj/database'), specifier).toBe(false);
      expect(specifier.startsWith('@minhaj/server-core'), specifier).toBe(false);
      expect(specifier.startsWith('@prisma/'), specifier).toBe(false);
    }

    expect(modules.size).toBeGreaterThan(0);
  });

  it('marks no public route dynamic, and revalidates none of them per request', async () => {
    // `force-dynamic` on a public route would mean rendering it per visitor,
    // which is both the performance cost and the precondition for a leak. The
    // private surfaces use it deliberately and correctly; none of them is in
    // this group.
    const { modules } = await publicGraph();

    for (const [file, source] of modules) {
      if (!file.startsWith(PUBLIC_GROUP)) continue;

      expect(code(source), relative(file)).not.toContain('force-dynamic');
    }
  });

  it('keeps the private surfaces OUT of the public group entirely', async () => {
    // The split is what stops a public header from being wrapped around a
    // private page — and, more importantly, stops a private page's session
    // handling from being pulled into a layout the public tree shares.
    for (const area of ['admin', 'my', '(identity)']) {
      const inside = path.join(PUBLIC_GROUP, area);

      await expect(stat(inside)).rejects.toThrow();
    }
  });

  it('leaves the private surfaces private and unindexed', async () => {
    // A Phase-2 regression this phase could plausibly cause: moving routes
    // into a group and losing the directives that were on them.
    for (const file of [
      'apps/web/src/app/[locale]/admin/layout.tsx',
      'apps/web/src/app/[locale]/my/page.tsx',
      'apps/web/src/app/[locale]/admin/system/navigation/page.tsx',
    ]) {
      const source = await readFile(path.join(repoRoot, file), 'utf8');

      expect(source, file).toContain('force-dynamic');
      expect(source, file).toContain('robots');
      expect(source, file).toContain('index: false');
    }
  });
});

/* ===========================================================================
 * Client JavaScript
 * ========================================================================= */

describe('the public shell is server-rendered, with narrow client islands', () => {
  it('declares `use client` in exactly the files that genuinely need it', async () => {
    // A `'use client'` on a layout or a page would take the whole subtree with
    // it. The islands are the two navigation controls, whose open/closed state
    // genuinely lives in the browser, and the error boundary, which React
    // requires to be a Client Component.
    const { modules } = await publicGraph();

    const clientModules = [...modules]
      .filter(([, source]) => /^\s*['"]use client['"]/m.test(source))
      .map(([file]) => relative(file))
      .sort();

    expect(clientModules).toEqual([
      'apps/web/src/app/[locale]/(public)/error.tsx',
      'apps/web/src/components/locale-switcher-links.tsx',
      'apps/web/src/components/shell/disclosure-menu.tsx',
      'apps/web/src/components/shell/mobile-nav.tsx',
    ]);
  });

  it('renders nothing the error boundary was handed', async () => {
    // THE SECURITY HALF OF THE ERROR SURFACE, and the half worth proving
    // mechanically. Next.js redacts a server error's message in production,
    // but a boundary that printed whatever it was given would disclose
    // everything the day something threw on the CLIENT instead — where nothing
    // is redacted. So it prints none of it: no message, no digest, no stack,
    // no cause, and it does not even accept the `error` prop.
    //
    // A live render is not asserted here. Triggering a real failure would mean
    // shipping a route that throws, which is a test-only production bypass;
    // the catalogue tests prove the three strings exist and are translated,
    // and this proves what the component may do with them.
    const source = code(
      await readFile(
        path.join(repoRoot, 'apps/web/src/app/[locale]/(public)/error.tsx'),
        'utf8',
      ),
    );

    for (const disclosure of [
      'error.message',
      'error.stack',
      'error.digest',
      'error.cause',
      'error.name',
      'JSON.stringify',
      'String(error)',
    ]) {
      expect(source, disclosure).not.toContain(disclosure);
    }

    // It takes `reset` and nothing else, so there is no `error` in scope to
    // render by accident.
    expect(source).toContain('reset');
    expect(source).not.toMatch(/\berror\s*[,}:]/);
  });

  it('requests no external font, script or stylesheet', async () => {
    // ARCHITECTURE.md §13.8 and the brand gate together: no third-party font
    // request, no unlicensed bundled face, and nothing loaded from an origin
    // the CSP does not allow anyway.
    const { modules } = await publicGraph();

    for (const [file, source] of modules) {
      // The traversed contracts module validates the localhost application
      // origin; it does not request a font, script or stylesheet. This check is
      // about render code that could create an external browser request.
      if (!file.startsWith(APP_SRC)) continue;

      expect(code(source), relative(file)).not.toMatch(/https?:\/\/(?!127\.0\.0\.1)/);
      expect(code(source), relative(file)).not.toContain('next/font');
    }
  });

  it('requests no external font, script or stylesheet from a CONTENT route', async () => {
    // THE SAME CLAIM FOR THE DATA-BACKED ROUTES, with one documented exception
    // and a stricter check beside it.
    //
    // `https://schema.org` appears in the contributor profile as the `@context`
    // of a JSON-LD document. It is a VOCABULARY IDENTIFIER inside an
    // `application/ld+json` block — a string a consumer matches against, never
    // a URL a browser fetches — so it creates no external request and no
    // privacy exposure, which is what this rule exists to prevent
    // (ARCHITECTURE.md §4.7.1).
    //
    // `https://doi.org/` (Phase 9) is the DOI resolver, used ONLY as the target
    // of an outbound hyperlink beside a citation. A link is fetched when a
    // visitor chooses to follow it, never when the page renders — so it, too,
    // creates no request and no exposure on its own.
    //
    // Allowing exact strings rather than loosening the pattern is the point:
    // every OTHER external origin is still refused, and the assertion below
    // additionally forbids the attributes that would actually fetch one — which
    // the original blanket regex never checked for directly.
    //
    // PHASE 10 — THE ONE FILE THAT MAY SET A FRAME SOURCE. The privacy-gated
    // player (`components/media/player.tsx`) renders an `<iframe src=…>` — but
    // only in the state a visitor's own click creates, and the address comes
    // from `providerEmbedUrl` in `@minhaj/contracts/media`, never a literal.
    // Its exception is `src=` and nothing else, and the test below pins what
    // that `src` may be. Provider URL literals live in the contracts module,
    // outside this app tree, so the external-origin rule still holds here.
    //
    // PHASE 11 — THE ONE FILE THAT MAY SET A MEDIA SOURCE. The audio player
    // (`components/media/audio-player.tsx`) renders `<audio src=…>`, and that
    // source is a FIRST-PARTY path it derives from the track and asset
    // identifiers — the platform's own authorised byte route, never another
    // origin — pinned by the test below.
    //
    // PHASE 12 — THE TWO FILES THAT MAY SHOW AN IMAGE. The photograph surfaces
    // (`components/media/photos.tsx`) and their viewer
    // (`components/media/photo-viewer.tsx`) render `<img src=…>`, and every
    // source is the platform's OWN two-allow photo route, derived from the Photo
    // and asset identifiers — never another origin, never a literal. They are
    // excepted from `<img` and `src=` and nothing else, pinned below.
    const PLAYER = 'apps/web/src/components/media/player.tsx';
    const AUDIO_PLAYER = 'apps/web/src/components/media/audio-player.tsx';
    const PHOTOS = 'apps/web/src/components/media/photos.tsx';
    const VIEWER = 'apps/web/src/components/media/photo-viewer.tsx';
    // PHASE 18 — THE QURAN RECITATION PLAYER, for the audio player's reason: a
    // native `<audio src=…>` whose source is the FIRST-PARTY recitation byte
    // route it derives from the recitation, segment and asset identifiers —
    // pinned by its own test below.
    const RECITATION_PLAYER = 'apps/web/src/components/quran/recitation-player.tsx';
    const { modules } = await contentGraph();

    for (const expected of [PLAYER, AUDIO_PLAYER, PHOTOS, VIEWER, RECITATION_PLAYER]) {
      expect([...modules.keys()].map(relative)).toContain(expected);
    }

    for (const [file, source] of modules) {
      if (!file.startsWith(APP_SRC)) continue;

      const body = code(source)
        .replaceAll('https://schema.org', '')
        .replaceAll('https://doi.org/', '');

      expect(body, relative(file)).not.toMatch(/https?:\/\/(?!127\.0\.0\.1)/);
      expect(body, relative(file)).not.toContain('next/font');

      for (const fetching of ['<link', '<img', 'src=', 'srcSet', '@import']) {
        if (
          fetching === 'src=' &&
          [PLAYER, AUDIO_PLAYER, RECITATION_PLAYER].includes(relative(file))
        )
          continue;
        if (
          (fetching === 'src=' || fetching === '<img') &&
          [PHOTOS, VIEWER].includes(relative(file))
        )
          continue;
        expect(code(source), `${relative(file)} ${fetching}`).not.toContain(fetching);
      }
    }
  });

  it('shows ONLY first-party photo routes as images, and moves nothing on its own', async () => {
    const photos = code(
      await readFile(
        path.join(repoRoot, 'apps/web/src/components/media/photos.tsx'),
        'utf8',
      ),
    );
    const viewer = code(
      await readFile(
        path.join(repoRoot, 'apps/web/src/components/media/photo-viewer.tsx'),
        'utf8',
      ),
    );

    // Every image source on the surfaces is the two-allow photo route, and the
    // viewer shows exactly the source the server handed it — which the
    // surfaces build from the same route.
    const sources = photos.match(/src=\{[^}]*\}/g) ?? [];
    expect(sources.length).toBeGreaterThan(0);
    for (const source of sources) {
      expect(source).toMatch(/^src=\{photoAssetPath\(photo\.id, photo\.assetId\)\}$/);
    }
    expect(photos).toContain('src: photoAssetPath(photo.id, photo.assetId)');
    expect(viewer.match(/src=/g) ?? []).toEqual(['src=']);
    expect(viewer).toContain('src={photo.src}');

    // No slideshow, no timer, no storage, no markup injection, no other origin.
    for (const forbidden of [
      'setInterval',
      'setTimeout',
      'autoplay',
      'autoPlay',
      'localStorage',
      'sessionStorage',
      'document.cookie',
      'dangerouslySetInnerHTML',
      'srcSet',
      'next/image',
    ]) {
      expect(viewer, forbidden).not.toContain(forbidden);
      expect(photos, forbidden).not.toContain(forbidden);
    }
    // The browser's own modal dialog, opened modally.
    expect(viewer).toContain('showModal()');
  });

  it('lets the audio player play ONLY its own first-party byte route, never on its own', async () => {
    const source = code(
      await readFile(
        path.join(repoRoot, 'apps/web/src/components/media/audio-player.tsx'),
        'utf8',
      ),
    );

    // Exactly one media source, derived from the two first-party byte routes.
    expect(source.match(/src=/g) ?? []).toHaveLength(1);
    expect(source).toContain('src={source}');
    expect(source).toMatch(
      /mode === 'public'\s*\?\s*audioAssetPath\(trackId, assetId\)\s*:\s*audioPreviewPath\(trackId, assetId\)/,
    );
    // Nothing is fetched until the listener presses play, and nothing plays
    // on its own.
    expect(source).toContain('preload="none"');
    for (const forbidden of [
      'autoplay',
      'autoPlay',
      '.play(',
      '<img',
      '<script',
      'download',
      'localStorage',
      'sessionStorage',
      'document.cookie',
      'dangerouslySetInnerHTML',
    ]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });

  it('lets the recitation player play ONLY its own first-party byte route, never on its own', async () => {
    const source = code(
      await readFile(
        path.join(repoRoot, 'apps/web/src/components/quran/recitation-player.tsx'),
        'utf8',
      ),
    );

    // Exactly one media source, derived from the first-party recitation route.
    expect(source.match(/src=/g) ?? []).toHaveLength(1);
    expect(source).toContain(
      'src={recitationAssetPath({ recitationId, segmentId, assetId })}',
    );
    // Nothing is fetched until the listener presses play, nothing plays on its
    // own, and nothing offers a copy to keep.
    expect(source).toContain('preload="none"');
    for (const forbidden of [
      'autoplay',
      'autoPlay',
      '.play(',
      '<img',
      '<script',
      'download',
      'localStorage',
      'sessionStorage',
      'document.cookie',
      'dangerouslySetInnerHTML',
    ]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });

  it('lets the player frame ONLY the derived privacy-enhanced address, after a click', async () => {
    const source = code(
      await readFile(
        path.join(repoRoot, 'apps/web/src/components/media/player.tsx'),
        'utf8',
      ),
    );

    // Exactly one frame source, and it is the contract's derivation.
    expect(source.match(/src=/g) ?? []).toHaveLength(1);
    expect(source).toContain('src={providerEmbedUrl(provider, providerVideoId)}');
    // The frame exists only in the state the visitor's click sets.
    expect(source).toMatch(/\{loaded \? \(/);
    expect(source).toContain('onClick={() => setLoaded(true)}');
    // No autoplay, no remote image, no script, no stored consent state.
    for (const forbidden of [
      'autoplay',
      '<img',
      '<script',
      'localStorage',
      'sessionStorage',
      'document.cookie',
      'dangerouslySetInnerHTML',
    ]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });
});

/* ===========================================================================
 * Data-backed public content routes
 * ========================================================================= */

describe('a public CONTENT route reads data, and still reads no session', () => {
  it('reaches a real graph, so nothing below passes vacuously', async () => {
    const { modules } = await contentGraph();

    expect(modules.size).toBeGreaterThan(3);
    expect([...modules.keys()].map(relative)).toContain(
      'apps/web/src/composition/people-read.ts',
    );
  });

  it('every declared content route exists', async () => {
    // The list is an allowance, so a stale entry would be an allowance for
    // nothing — and, worse, would hide the day a route was deleted.
    for (const file of CONTENT_ROUTE_FILES) {
      await expect(stat(path.join(repoRoot, file))).resolves.toBeDefined();
    }
  });

  it('imports no identity, session or authorisation module anywhere in the graph', async () => {
    // THE RULE THAT DOES NOT BEND. §8.1 forbids the anonymous public tree from
    // reading session-derived state, and the strongest form of that guarantee
    // is a graph in which the capability is not present to be misused.
    //
    // `@/composition/people` is on this list beside the Identity modules, and
    // that is the Phase-5 addition worth understanding: the FULL People runtime
    // wires Identity in for the capability projection and the closure
    // coordinator, so reaching it would pull the session service and the
    // authentication library into a public document by one import. The public
    // routes use `@/composition/people-read`, which takes no Identity port at
    // all.
    const forbidden = [
      '@/composition/identity',
      '@/composition/authorization',
      '@/composition/request',
      '@/composition/dispatch',
      '@/composition/people',
      // Phase 8, for People's reason: the ADMINISTRATIVE Library runtime wires
      // Identity in for its live permission checks. Public Library routes use
      // `@/composition/library-read`, which reaches no Identity at all.
      '@/composition/library',
      // Phase 16, for the same reason: the ADMINISTRATIVE Global runtime wires
      // Identity in. Public Global routes use `@/composition/global-read`.
      '@/composition/global',
      // Phase 14, for the same reason: the ADMINISTRATIVE Editorial and Media
      // runtimes wire Identity in. Public Event routes compose
      // `@/composition/editorial-read` and `@/composition/media-read`.
      '@/composition/editorial',
      '@/composition/media',
      // Phase 18, for the same reason: the ADMINISTRATIVE Quran runtime wires
      // Identity in. Public Quran routes use `@/composition/quran-read`.
      '@/composition/quran',
      // Phase 19, for the same reason: the ADMINISTRATIVE Hadith runtime wires
      // Identity in. Public Hadith routes use `@/composition/hadith-read`.
      '@/composition/hadith',
      // Phase 20, for the same reason: the AUTHENTICATED Fatwa runtime wires
      // Identity in. Public Fatwa routes use `@/composition/fatwa-read`.
      '@/composition/fatwa',
      // Phase 21: the AUTHENTICATED Personalisation runtime wires Identity in
      // and holds every person's saved state. No public route reaches it: a
      // content page's private island reads through `/api/my/*` after
      // hydration, and the newsletter link pages use `newsletter-read`.
      '@/composition/personalisation',
      '@/composition/personal-targets',
      // Phase 22: the AUTHENTICATED Learning runtime wires Identity in and
      // holds every learner's enrolments, progress and trial requests. Public
      // Learn routes use `@/composition/learning-read`.
      '@/composition/learning',
      // Phase 26: the AUTHENTICATED Membership runtime wires Identity in and
      // holds every applicant's applications and Memberships. The public
      // Membership page uses `@/composition/membership-read`.
      '@/composition/membership',
      '@/contexts/identity-access',
      '@/config/server-env',
      '@minhaj/contracts/env/server',
    ];

    const { modules } = await contentGraph();

    for (const [file, source] of modules) {
      for (const specifier of specifiersIn(source)) {
        expect(
          forbidden.some((entry) => specifier === entry),
          `${relative(file)} imports ${specifier}`,
        ).toBe(false);
      }
    }
  });

  it('imports no request-scoped framework API and no authentication library', async () => {
    // `cookies()` and `headers()` are how a session would be read. A content
    // route is dynamic for a different reason — its data changes — and being
    // dynamic must not become a licence to read a request's identity.
    const forbidden = ['next/headers', 'next/cookies', 'better-auth'];

    const { packages, modules } = await contentGraph();

    for (const specifier of packages) {
      expect(
        forbidden.some(
          (entry) => specifier === entry || specifier.startsWith(`${entry}/`),
        ),
        `the content graph imports ${specifier}`,
      ).toBe(false);
    }

    // `@prisma/*` and `@minhaj/server-core` stay out as well: Model A confines
    // raw database capability to `packages/database`, and a public page holds
    // an interface rather than a client (ARCHITECTURE.md §3.1.1).
    for (const specifier of packages) {
      expect(specifier.startsWith('@minhaj/server-core'), specifier).toBe(false);
      expect(specifier.startsWith('@prisma/'), specifier).toBe(false);
    }

    expect(modules.size).toBeGreaterThan(0);
  });

  it('marks every content route dynamic, so none of them is ever prerendered', async () => {
    // THE INVERSE OF THE SHELL RULE, and it is a requirement rather than an
    // exemption. A prerendered contributor profile would keep serving a
    // withdrawn record, and enumerating these routes at build time would put a
    // database connection on the build critical path — which §8.3.1 forbids,
    // because the build "runs in CI and on developer machines that hold no
    // production credential".
    for (const file of CONTENT_ROUTE_FILES) {
      const source = await readFile(path.join(repoRoot, file), 'utf8');
      // The shared alias implementation is not a route segment of its own, so
      // it carries no segment configuration; every actual route does.
      if (
        !source.includes('export default') &&
        !source.includes('export async function GET')
      ) {
        continue;
      }

      expect(code(source), file).toContain("dynamic = 'force-dynamic'");
    }
  });

  it('makes the two author aliases 301s that are never indexable', async () => {
    // ROUTE_MAP.md §9.1 rule 3 names the STATUS CODE, and §2.3 classifies a
    // legacy alias as not indexable. Both are asserted on the shared
    // implementation, because both aliases are one function.
    //
    // 301 AND NOT 308. `permanentRedirect()` in a page would emit 308, which is
    // a permanent redirect that every crawler treats as one — and is still not
    // the code the accepted contract names. A route handler sets it exactly,
    // which is why an alias is a handler rather than a page.
    const shared = await readFile(
      path.join(repoRoot, 'apps/web/src/app/[locale]/(public)/people-alias.ts'),
      'utf8',
    );

    expect(code(shared)).toContain('status: 301');
    expect(code(shared)).toContain("'x-robots-tag': 'noindex'");
    // A redirect carries no document, so there is no `<meta robots>` to set and
    // `permanentRedirect` must not be what emits it.
    expect(code(shared)).not.toContain('permanentRedirect');

    // And each route is a handler that delegates, with no render of its own —
    // Phase 23's teacher alias included, which is the same shared function.
    for (const file of [
      'apps/web/src/app/[locale]/(public)/authors/[slug]/route.ts',
      'apps/web/src/app/[locale]/(public)/library/authors/[slug]/route.ts',
      'apps/web/src/app/[locale]/(public)/learn/teachers/[slug]/route.ts',
    ]) {
      const source = code(await readFile(path.join(repoRoot, file), 'utf8'));

      expect(source, file).toContain('contributorAlias(params)');
      expect(source, file).not.toContain('export default');
    }
  });

  it('gives the public read service no mutation and no account data', async () => {
    // WHAT A PUBLIC PAGE IS HANDED DECIDES WHAT IT CAN DO. The read service has
    // three methods, all reads; none returns a draft record or the linked
    // account identifier, and none of the administrative reads is on it.
    const source = code(
      await readFile(
        path.join(
          repoRoot,
          'apps/web/src/contexts/people-contributors/application/people-service.ts',
        ),
        'utf8',
      ),
    );

    const readService = source.slice(
      source.indexOf('export function createPeopleReadService'),
      source.indexOf('export type PeopleReadService'),
    );

    expect(readService.length).toBeGreaterThan(0);

    for (const forbidden of [
      'createPerson',
      'setStatus',
      'linkAccount',
      'unlinkAccount',
      'releaseAccountLink',
      'createProfile',
      'capabilitiesFor',
      'listPeople',
      'findPerson',
      'linkedAccountId',
      'accounts.',
    ]) {
      expect(readService, forbidden).not.toContain(forbidden);
    }
  });
});

/* ===========================================================================
 * No Page aggregate, no hidden CMS
 * ========================================================================= */

describe('Phase 4 introduces no editorial content model', () => {
  it('keeps Page in its single Phase-6 owner and adds no shell CMS models', async () => {
    // The hard boundary of the phase: Page arrives exactly once, in Phase 6.
    const schema = await readFile(
      path.join(repoRoot, 'packages', 'database', 'prisma', 'schema.prisma'),
      'utf8',
    );

    expect(schema.match(/\bmodel\s+Page\s*\{/g)).toHaveLength(1);
    expect(schema.match(/\bmodel\s+Article\s*\{/g)).toHaveLength(1);
    for (const model of [
      'Navigation',
      'NavigationItem',
      'Menu',
      'MenuItem',
      'Footer',
      'SiteSettings',
      'OrganisationProfile',
      'LegalDocument',
      'SEOPage',
      'Sitemap',
      'DesignToken',
    ]) {
      expect(schema, model).not.toMatch(new RegExp(`\\bmodel\\s+${model}\\b`));
    }
  });

  it('creates no table in the Phase-4 migration', async () => {
    const migration = await readFile(
      path.join(
        repoRoot,
        'packages/database/prisma/migrations',
        '20260918000000_phase4_navigation_permission',
        'migration.sql',
      ),
      'utf8',
    );

    expect(migration).not.toMatch(/CREATE\s+TABLE/i);
    expect(migration).not.toMatch(/CREATE\s+PROCEDURE/i);
    expect(migration).not.toMatch(/CREATE\s+TRIGGER/i);
    expect(migration).toContain("N'navigation.read'");
  });

  it('seeds no `navigation.administer`, because no mutation exists to authorise', async () => {
    const migration = await readFile(
      path.join(
        repoRoot,
        'packages/database/prisma/migrations',
        '20260918000000_phase4_navigation_permission',
        'migration.sql',
      ),
      'utf8',
    );

    // Comments stripped: the migration EXPLAINS why no write key exists, and
    // the explanation must not be the thing that fails the test.
    expect(migration.replace(/^\s*--.*$/gm, '')).not.toContain('navigation.administer');
  });

  it('pairs the forward migration with a reviewed rollback', async () => {
    const rollback = await readFile(
      path.join(
        repoRoot,
        'packages/database/sql/rollback',
        '20260918000000_phase4_navigation_permission.rollback.sql',
      ),
      'utf8',
    );

    // A privilege change is reversed the same way it was made: the bundle
    // narrows, and the sessions and step-up grants issued under the wider
    // bundle go with it (SECURITY_BASELINE.md §8.1).
    expect(rollback).toContain('DELETE FROM [dbo].[StepUpGrant]');
    expect(rollback).toContain('DELETE FROM [dbo].[Session]');
    expect(rollback).toContain("N'navigation.read'");
  });

  it('keeps the navigation status surface read-only', async () => {
    // No form, no Server Action, no submit control. The registry is code; a
    // Save button here would be a mutation contract nobody accepted.
    const page = code(
      await readFile(
        path.join(repoRoot, 'apps/web/src/app/[locale]/admin/system/navigation/page.tsx'),
        'utf8',
      ),
    );

    expect(page).not.toContain('<form');
    expect(page).not.toContain('use server');
    expect(page).not.toContain('<button');
    expect(page).not.toContain('action=');

    // And it is gated by the key, server-side, like every other admin route.
    expect(page).toContain("'navigation.read'");
    expect(page).toContain('requireAdminPage');
  });
});

/* ===========================================================================
 * Shell configuration carries no content
 * ========================================================================= */

describe('shell configuration is labels and routes, never content', () => {
  it('stores no prose in the registry or the allowlists', async () => {
    // The boundary is drawn by SUBSTANCE, not by storage mechanism
    // (DELIVERY_PLAN.md, Phase 4). A long string literal in these files would
    // be organisational or legal body content living in "configuration",
    // whatever it was named. Message KEYS are short; bodies are not.
    for (const file of [
      'apps/web/src/shell/registry.ts',
      'apps/web/src/shell/explore.ts',
    ]) {
      const source = code(await readFile(path.join(repoRoot, file), 'utf8'));

      for (const line of source.split('\n')) {
        for (const match of line.matchAll(/'([^']{60,})'/g)) {
          expect.fail(`${file} holds a long literal: ${match[1]?.slice(0, 80)}`);
        }
      }
    }
  });

  it('renders a publication-status state on every reserved route', async () => {
    for (const file of [
      'apps/web/src/app/[locale]/(public)/explore/[section]/page.tsx',
      'apps/web/src/app/[locale]/(public)/explore/[section]/[page]/page.tsx',
      'apps/web/src/app/[locale]/(public)/legal/[document]/page.tsx',
    ]) {
      const source = await readFile(path.join(repoRoot, file), 'utf8');

      expect(source, file).toContain('<PublicationStatus');
    }
  });

  it('refuses an unknown slug rather than rendering a titled empty page', async () => {
    for (const file of [
      'apps/web/src/app/[locale]/(public)/explore/[section]/page.tsx',
      'apps/web/src/app/[locale]/(public)/explore/[section]/[page]/page.tsx',
      'apps/web/src/app/[locale]/(public)/legal/[document]/page.tsx',
    ]) {
      const source = code(await readFile(path.join(repoRoot, file), 'utf8'));

      // Both halves: the router refuses an unlisted parameter, and the
      // component refuses it again rather than trusting the router.
      expect(source, file).toContain('export const dynamicParams = false');
      expect(source, file).toContain('notFound()');
    }
  });
});

/* ===========================================================================
 * Security headers
 * ========================================================================= */

describe('the base security headers', () => {
  it('sets the policy in one place, for every response', async () => {
    const config = await readFile(
      path.join(repoRoot, 'apps', 'web', 'next.config.ts'),
      'utf8',
    );

    for (const header of [
      'Content-Security-Policy',
      'X-Content-Type-Options',
      'Referrer-Policy',
      'X-Frame-Options',
      'Permissions-Policy',
      'Cross-Origin-Opener-Policy',
    ]) {
      expect(config, header).toContain(header);
    }

    expect(config).toContain("source: '/:path*'");
  });

  it('permits no eval, and pre-allows no third-party origin', async () => {
    const config = code(
      await readFile(path.join(repoRoot, 'apps', 'web', 'next.config.ts'), 'utf8'),
    );

    expect(config).not.toContain('unsafe-eval');

    // Analytics and font CDNs arrive with the phases that own them — not
    // pre-emptively. Media providers arrived with Phase 10, and they are NOT
    // written here as literals: the two frame origins come from the one
    // contract the player derives its frame address from, and they widen the
    // `frame-src` of exactly the two player routes, never the base policy.
    expect(config).toContain(
      "import { PROVIDER_EMBED_ORIGINS, VIDEO_PROVIDERS } from '@minhaj/contracts/media';",
    );
    expect(config).toContain('"frame-src \'none\'"');
    expect(config).toContain("'/:locale(en|ur|ar)/watch/videos/:slug'");
    expect(config).toContain("'/:locale(en|ur|ar)/admin/media/videos/:id'");
    expect(config.match(/'\/:locale\(en\|ur\|ar\)\//g) ?? []).toHaveLength(2);
    expect(config).toContain('autoplay=()');
    for (const origin of [
      'youtube',
      'vimeo',
      'googleapis',
      'gstatic',
      'google-analytics',
      'googletagmanager',
    ]) {
      expect(config, origin).not.toContain(origin);
    }
  });

  it('locks down the directives that do not depend on inline script', async () => {
    const config = await readFile(
      path.join(repoRoot, 'apps', 'web', 'next.config.ts'),
      'utf8',
    );

    for (const directive of [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      // Strict, and proved to hold by the browser suite rather than assumed.
      "style-src 'self'",
    ]) {
      expect(config, directive).toContain(directive);
    }

    // Exactly ONE `'unsafe-inline'` IN THE POLICY ITSELF, and it is the script
    // one the caching boundary forces. A second would mean the style directive
    // had been quietly relaxed. Comments are stripped first: the file explains
    // at length why the one allowance exists and why the other does not, and
    // the explanation must not be what the count measures.
    expect(code(config).match(/'unsafe-inline'/g) ?? []).toHaveLength(1);
  });
});

describe('Phase 21 private island and newsletter action', () => {
  it('walks the island into the content graph and keeps it client-only', async () => {
    const { modules } = await contentGraph();
    const files = [...modules.keys()].map(relative);
    for (const island of [
      'apps/web/src/components/personal-island/personal-island.tsx',
      'apps/web/src/components/personal-island/requests.ts',
    ])
      expect(files).toContain(island);
    const island = code(
      await readFile(
        path.join(APP_SRC, 'components/personal-island/personal-island.tsx'),
        'utf8',
      ),
    );
    expect(island.trimStart()).toMatch(/^['"]use client['"]/);
  });

  it('reads no session in the anonymous newsletter action', async () => {
    const file = path.join(
      repoRoot,
      'apps/web/src/app/[locale]/(public)/newsletter/actions.ts',
    );
    const raw = await readFile(file, 'utf8');
    const source = code(raw);
    expect(source.trimStart()).toMatch(/^['"]use server['"]/);
    for (const call of [
      'requireOwnSession',
      'requireActiveSession',
      'session.resolve',
      'cookies(',
    ])
      expect(source, call).not.toContain(call);
    for (const specifier of specifiersIn(raw))
      expect(
        ['@/composition/authorization', '@/composition/request', 'next/headers'].includes(
          specifier,
        ),
        specifier,
      ).toBe(false);
    expect(specifiersIn(raw)).toContain('@/composition/request-address');
  });
});

describe('Phase 6 anonymous Server Action boundary', () => {
  it('keeps the submission graph session-free while allowing the anonymous limiter address', async () => {
    const entry = path.join(repoRoot, PUBLIC_ACTION_FILES[0]!);
    expect(code(await readFile(entry, 'utf8')).trimStart()).toMatch(
      /^['"]use server['"]/,
    );
    const graph = await reachableFrom([entry]);
    expect([...graph.modules.keys()].map(relative)).toContain(
      'apps/web/src/composition/request-address.ts',
    );
    for (const [file, source] of graph.modules)
      for (const specifier of specifiersIn(source)) {
        expect(
          [
            '@/composition/identity',
            '@/composition/authorization',
            '@/composition/request',
            '@/contexts/identity-access',
            'better-auth',
          ].some(
            (forbidden) =>
              specifier === forbidden || specifier.startsWith(forbidden + '/'),
          ),
          relative(file),
        ).toBe(false);
      }
    const address = code(
      await readFile(path.join(APP_SRC, 'composition/request-address.ts'), 'utf8'),
    );
    expect(address).not.toContain('cookies');
  });
});
