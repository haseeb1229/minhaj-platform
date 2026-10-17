import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  FALLBACK_LOCALE,
  directionOf,
  endonymOf,
  isSupportedLocale,
} from '../../apps/web/src/config/locale.ts';
import { localeSchema } from '../../packages/contracts/src/env/shared.ts';
import { repoRoot } from '../architecture/architecture-harness.ts';

/**
 * Locale properties and the FIXED final fallback (ROUTE_MAP.md §1.1, §1.2).
 *
 * WHAT CHANGED IN PHASE 3A, AND WHY THESE TESTS CHANGED WITH IT
 * -------------------------------------------------------------
 * This file used to test `resolveDefaultLocale`, which read
 * `NEXT_PUBLIC_DEFAULT_LOCALE` and decided the single locale the Phase 0B
 * skeleton rendered. Those assertions were correct for a skeleton with no
 * locale routing. They describe something that no longer exists, and keeping
 * them would mean asserting that the final fallback is CONFIGURABLE — which is
 * exactly what ROUTE_MAP.md §1.1 says it is not.
 *
 * The property they protected has not been dropped; it has been strengthened.
 * The old test proved an invalid configured locale could not silently become
 * English. The tests below prove something stricter: no configuration can move
 * the final fallback at all, and an unsupported locale is not merely
 * substituted but REJECTED — by the function the render tree calls on every
 * request. `tests/config/locale-routing.integration.test.ts` proves that
 * rejection end to end, over real HTTP.
 */

/** Source with comments removed, so prose about a defect is not the defect. */
async function codeOf(file: string): Promise<string> {
  const source = await readFile(path.join(repoRoot, file), 'utf8');

  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('the final no-preference fallback is fixed, not configured', () => {
  it('is `en`, as ROUTE_MAP.md §1.1 requires', () => {
    expect(FALLBACK_LOCALE).toBe('en');
  });

  it('is itself a supported locale', () => {
    expect(isSupportedLocale(FALLBACK_LOCALE)).toBe(true);
  });

  it('reads no environment variable to decide it', async () => {
    // The regression this replaces: a deployment file setting
    // `DEFAULT_LOCALE=ur` would have sent every visitor with no preference to
    // Urdu, contradicting the accepted routing contract from outside the
    // repository entirely. Asserted against the SOURCE, because the defect is
    // the existence of the reading rather than any value it returns.
    expect(await codeOf('apps/web/src/config/locale.ts')).not.toMatch(/process\.env/);
  });

  it('is not reintroduced through the tracked environment example', async () => {
    // `.env.example` is the file a developer copies, so a stale entry there is
    // how a retired variable comes back with someone believing it still works.
    const example = await readFile(path.join(repoRoot, '.env.example'), 'utf8');

    expect(example).not.toMatch(/^\s*DEFAULT_LOCALE=/m);
    expect(example).not.toMatch(/^\s*NEXT_PUBLIC_DEFAULT_LOCALE=/m);
  });
});

describe('direction is derived from the locale', () => {
  it('maps each supported locale to its accepted direction', () => {
    // ROUTE_MAP.md §1.2. A wrong direction is a visibly broken page rather
    // than a cosmetic defect, which is why it is a table and not a heuristic.
    expect(directionOf('en')).toBe('ltr');
    expect(directionOf('ur')).toBe('rtl');
    expect(directionOf('ar')).toBe('rtl');
  });

  it('answers for every supported locale, with no gaps', () => {
    // Driven from the locale schema, so a locale added later must be given a
    // direction here rather than silently inheriting one.
    for (const locale of localeSchema.options) {
      expect(['ltr', 'rtl']).toContain(directionOf(locale));
    }
  });
});

describe('every locale has a name in its own script', () => {
  it('names each supported locale', () => {
    expect(endonymOf('en')).toBe('English');
    expect(endonymOf('ur')).toBe('اردو');
    expect(endonymOf('ar')).toBe('العربية');
  });

  it('has a non-empty endonym for every supported locale', () => {
    for (const locale of localeSchema.options) {
      expect(endonymOf(locale).trim().length).toBeGreaterThan(0);
    }
  });

  it('writes the RTL locales in their own scripts, not transliterated', () => {
    // Why these are not translated messages: the option exists FOR a reader
    // who cannot read the Latin script, and "Urdu" is useless to them.
    // Asserted by script range, so an edit to `Urdu` fails here.
    expect(endonymOf('ur')).toMatch(/\p{Script=Arabic}/u);
    expect(endonymOf('ar')).toMatch(/\p{Script=Arabic}/u);
  });
});

describe('locale validation fails closed', () => {
  it('accepts every supported locale', () => {
    for (const locale of localeSchema.options) {
      expect(isSupportedLocale(locale)).toBe(true);
    }
  });

  it.each(['de', 'en-GB', 'EN', 'Ur', '', ' en', 'en ', 'zz', '../en', 'en/../de'])(
    'rejects %j',
    (candidate) => {
      // `[locale]` is effectively a catch-all, so this function is what stands
      // between an arbitrary path segment and a page rendering as though that
      // segment named a supported language.
      expect(isSupportedLocale(candidate)).toBe(false);
    },
  );

  it('is exactly the accepted locale set, with nothing added', () => {
    expect([...localeSchema.options]).toEqual(['en', 'ur', 'ar']);
  });
});

describe('the render and routing tree stays statically renderable', () => {
  /**
   * ARCHITECTURE.md §8: the anonymous public tree must stay cacheable.
   *
   * Reading configuration or a request-time API during render would force
   * every route dynamic — the regression the previous revision of this file
   * guarded `app/layout.tsx` and `app/page.tsx` against. Those files no longer
   * exist. The protection follows the code to the locale-prefixed tree that
   * replaced them, and now covers the routing layer as well.
   */
  const renderTree = [
    'apps/web/src/config/locale.ts',
    'apps/web/src/config/route-locale.ts',
    'apps/web/src/i18n/routing.ts',
    'apps/web/src/i18n/request.ts',
    'apps/web/src/i18n/navigation.ts',
    'apps/web/src/i18n/query.ts',
    'apps/web/src/app/[locale]/layout.tsx',

    // Phase 4 moved the home page into the `(public)` route group and added
    // the public shell around it. The group contributes no path segment, so
    // the URL is unchanged — but every one of these files renders on the
    // anonymous public path and must stay statically renderable, which is
    // exactly what this guard is for.
    'apps/web/src/app/[locale]/(public)/layout.tsx',
    'apps/web/src/app/[locale]/(public)/page.tsx',

    'apps/web/src/components/editorial/editor-island.tsx',
    'apps/web/src/components/editorial/editor.tsx',
    'apps/web/src/components/editorial/public-content.tsx',
    'apps/web/src/components/editorial/news.tsx',
    'apps/web/src/components/editorial/presentation.ts',
    // Phase 14: the Event pages and their pure presentation rules.
    'apps/web/src/components/editorial/events.tsx',
    'apps/web/src/components/editorial/event-presentation.ts',
    // Phase 15: the public Collection pages and their pure presentation rules.
    'apps/web/src/components/editorial/collections.tsx',
    'apps/web/src/components/editorial/collection-presentation.ts',
    // Phase 15: the editor's ordered Collection member list island.
    'apps/web/src/components/editorial/collection-members-island.tsx',
    // Phase 8. The Library components render on the anonymous public path;
    // the ROUTES that use them are dynamic for data, never these modules.
    'apps/web/src/components/library/facet-browse.tsx',
    'apps/web/src/components/library/presentation.ts',
    'apps/web/src/components/library/reader-controls.tsx',
    'apps/web/src/components/library/reader.tsx',
    // Phase 9. The scholarly and periodical surfaces and their pure
    // presentation decisions, on the same anonymous public path.
    'apps/web/src/components/library/scholarly.tsx',
    'apps/web/src/components/library/scholarly-presentation.ts',
    // Phase 17. A pure highlighter the dynamic search route renders with; the
    // module itself reads no request state.
    'apps/web/src/components/search/highlight.ts',
    // Phase 18. The shared highlighted-text renderer and the pure Quran-result
    // labels, used by the unified and the Quran search pages.
    'apps/web/src/components/search/highlighted.tsx',
    'apps/web/src/components/search/quran-hit.ts',
    // Phase 18. The one batched current-text read both search pages share; a
    // request-time owner read, never reached from a static render.
    'apps/web/src/components/search/quran-hit-text.ts',
    // Phase 18. The public Quran surfaces, their pure presentation decisions,
    // their request-cached reads and the recitation player island. The ROUTES
    // that use them are dynamic for data, never these modules.
    'apps/web/src/components/quran/landing.tsx',
    'apps/web/src/components/quran/parts.tsx',
    'apps/web/src/components/quran/presentation.ts',
    'apps/web/src/components/quran/read.ts',
    'apps/web/src/components/quran/reader.tsx',
    'apps/web/src/components/quran/recitation-player.tsx',
    'apps/web/src/components/quran/recitations.tsx',
    'apps/web/src/components/quran/related.tsx',
    'apps/web/src/components/quran/search.tsx',
    'apps/web/src/components/quran/topics.tsx',
    'apps/web/src/components/quran/works.tsx',
    // Phase 19. The public Hadith surfaces, their pure presentation decisions
    // and their request-cached reads, and the one batched current-text read
    // and pure labels the search pages use for Hadith results. The ROUTES that
    // use them are dynamic for data, never these modules.
    'apps/web/src/components/hadith/citation.tsx',
    'apps/web/src/components/hadith/commentary.tsx',
    'apps/web/src/components/hadith/landing.tsx',
    'apps/web/src/components/hadith/parts.tsx',
    'apps/web/src/components/hadith/presentation.ts',
    'apps/web/src/components/hadith/read.ts',
    'apps/web/src/components/hadith/related.tsx',
    'apps/web/src/components/hadith/sciences.tsx',
    'apps/web/src/components/hadith/search.tsx',
    'apps/web/src/components/hadith/structure.tsx',
    'apps/web/src/components/hadith/topics.tsx',
    'apps/web/src/components/search/hadith-hit.ts',
    'apps/web/src/components/search/hadith-hit-text.ts',
    // Phase 20. The public Fatwa surfaces, their pure presentation decisions
    // and request-cached reads, and the batched current-revision read and pure
    // labels the search pages use for Fatwa results. The ROUTES that use them
    // are dynamic for data, never these modules.
    'apps/web/src/components/fatwa/categories.tsx',
    'apps/web/src/components/fatwa/detail.tsx',
    'apps/web/src/components/fatwa/history.tsx',
    'apps/web/src/components/fatwa/how-it-works.tsx',
    'apps/web/src/components/fatwa/landing.tsx',
    'apps/web/src/components/fatwa/list.tsx',
    'apps/web/src/components/fatwa/parts.tsx',
    'apps/web/src/components/fatwa/presentation.ts',
    'apps/web/src/components/fatwa/read.ts',
    'apps/web/src/components/fatwa/search.tsx',
    'apps/web/src/components/fatwa/topics.tsx',
    'apps/web/src/components/search/fatwa-hit.ts',
    'apps/web/src/components/search/fatwa-hit-text.ts',
    // Phase 22. The public Learn surfaces, their pure presentation decisions
    // and request-cached reads. The ROUTES that use them are dynamic for data,
    // never these modules.
    'apps/web/src/components/learning/catalogue.tsx',
    'apps/web/src/components/learning/course.tsx',
    'apps/web/src/components/learning/landing.tsx',
    'apps/web/src/components/learning/parts.tsx',
    'apps/web/src/components/learning/paths.tsx',
    'apps/web/src/components/learning/presentation.ts',
    'apps/web/src/components/learning/read.ts',
    // Phase 22. The Course page's private island (session-free by
    // construction: it reads a learner's state only through `/api/my/learning/*`
    // after hydration), and the My Learning parts, which read the session only
    // through the guarded `/my` entry points that call them.
    'apps/web/src/components/learning-island/learning-controls.tsx',
    'apps/web/src/components/learning-island/learning-island.tsx',
    'apps/web/src/components/learning-island/requests.ts',
    'apps/web/src/components/my-learning/action-support.ts',
    'apps/web/src/components/my-learning/nav.ts',
    'apps/web/src/components/my-learning/parts.tsx',
    'apps/web/src/components/my-learning/presentation.ts',
    'apps/web/src/components/my-learning/read.ts',
    // Phase 23. The public live schedule and teacher directory with their pure
    // presentation decisions; and the My Classes and teacher-area parts, which
    // read the session only through the guarded `/my` and `/teacher` entry
    // points that call them. The ROUTES are dynamic for data, never these
    // modules.
    'apps/web/src/components/live-learning/directory.tsx',
    'apps/web/src/components/live-learning/parts.tsx',
    'apps/web/src/components/live-learning/presentation.ts',
    'apps/web/src/components/live-learning/schedule.tsx',
    'apps/web/src/components/my-classes/parts.tsx',
    'apps/web/src/components/teacher/action-support.ts',
    'apps/web/src/components/teacher/attendance-marks.tsx',
    'apps/web/src/components/teacher/course-frame.tsx',
    'apps/web/src/components/teacher/names.ts',
    'apps/web/src/components/teacher/nav.ts',
    'apps/web/src/components/teacher/parts.tsx',
    'apps/web/src/components/teacher/presentation.ts',
    'apps/web/src/components/teacher/read.ts',
    'apps/web/src/components/teacher/report-table.tsx',
    'apps/web/src/components/teacher/schedule-form.tsx',
    'apps/web/src/components/teacher/session-card.tsx',
    'apps/web/src/components/teacher/student-list.tsx',
    // Phase 24. Messaging's shared parts. The conversation screen and its
    // reads are reached only from the guarded `/my`, `/teacher` and
    // `/admin/messaging` pages, which resolve the session first; the client
    // islands (composer, catch-up, mark-read) read nothing at render and talk
    // to `/api/messaging/*` or a Server Action only after hydration. Phase 25's
    // realtime island opens its socket only after mount, and the shared thread
    // markup reads nothing at all.
    'apps/web/src/components/messaging/action-support.ts',
    'apps/web/src/components/messaging/catch-up.client.tsx',
    'apps/web/src/components/messaging/composer.client.tsx',
    'apps/web/src/components/messaging/conversation.tsx',
    'apps/web/src/components/messaging/live-context.ts',
    'apps/web/src/components/messaging/live-merge.ts',
    'apps/web/src/components/messaging/live.client.tsx',
    'apps/web/src/components/messaging/mark-read.client.tsx',
    'apps/web/src/components/messaging/parts.tsx',
    'apps/web/src/components/messaging/presentation.ts',
    'apps/web/src/components/messaging/read.ts',
    'apps/web/src/components/messaging/requests.client.ts',
    'apps/web/src/components/messaging/thread.tsx',
    // Phase 21. The private island public content pages place (session-free
    // by construction: it reads personal state only through `/api/my/*`
    // after hydration), and the My Minhaj Personalisation parts, which read
    // the session only through the guarded `/my` entry points that call them.
    'apps/web/src/components/personal-island/personal-controls.tsx',
    'apps/web/src/components/personal-island/personal-island.tsx',
    'apps/web/src/components/personal-island/requests.ts',
    'apps/web/src/components/personal/action-support.ts',
    'apps/web/src/components/personal/nav.ts',
    'apps/web/src/components/personal/parts.tsx',
    'apps/web/src/components/personal/presentation.ts',
    'apps/web/src/components/personal/read.ts',
    // Phase 10. The Watch surfaces, their pure presentation decisions and the
    // privacy-gated player island, on the same anonymous public path.
    'apps/web/src/components/media/audio-player.tsx',
    'apps/web/src/components/media/listen.tsx',
    'apps/web/src/components/media/parts.tsx',
    // Phase 12. The photograph surfaces and their viewer island.
    'apps/web/src/components/media/photo-viewer.tsx',
    'apps/web/src/components/media/photos.tsx',
    'apps/web/src/components/media/player.tsx',
    'apps/web/src/components/media/presentation.ts',
    'apps/web/src/components/media/watch.tsx',
    // Phase 16. The Global Network directory, a Centre's pages and their pure
    // presentation decisions, on the same anonymous public path.
    'apps/web/src/components/global/centre.tsx',
    'apps/web/src/components/global/directory.tsx',
    'apps/web/src/components/global/presentation.ts',
    'apps/web/src/components/locale-switcher.tsx',
    'apps/web/src/components/locale-switcher-links.tsx',
    'apps/web/src/components/ui/index.tsx',
    'apps/web/src/components/shell/site-header.tsx',
    'apps/web/src/components/shell/site-footer.tsx',
    'apps/web/src/components/shell/explore-panel.tsx',
    'apps/web/src/components/shell/publication-status.tsx',
    'apps/web/src/components/shell/disclosure-menu.tsx',
    'apps/web/src/components/shell/mobile-nav.tsx',
  ];

  it.each(renderTree)('%s does not force dynamic rendering', async (file) => {
    const forceDynamicExport =
      /export\s+const\s+dynamic\s*(:[^=]+)?=\s*['"]force-dynamic['"]/;

    expect(await codeOf(file)).not.toMatch(forceDynamicExport);
  });

  it.each(renderTree)('%s reads no request-time server API', async (file) => {
    // `headers()` or `cookies()` anywhere in this tree would opt every locale
    // route out of static generation. The locale arrives as a route parameter
    // precisely so that neither is needed; resolving a locale FROM a cookie or
    // an `Accept-Language` header is the proxy's job, and the proxy is not a
    // render path.
    const code = await codeOf(file);

    expect(code).not.toMatch(/from\s+['"]next\/headers['"]/);
    expect(code).not.toMatch(/\bcookies\s*\(\s*\)/);
    expect(code).not.toMatch(/\bheaders\s*\(\s*\)/);
  });

  it('covers every file in the localisation and component tree', async () => {
    // A file added to either directory later must be listed above, or the two
    // guards quietly stop covering the code they exist for.
    //
    // RECURSIVE. The walk used to read one level, so the first component
    // SUBDIRECTORY to appear — `components/ui/` did — would have been recorded
    // as a single unlisted entry, and every file inside it would have escaped
    // both guards while the list still looked complete.
    const found: string[] = [];

    const walk = async (directory: string): Promise<void> => {
      for (const entry of await readdir(path.join(repoRoot, directory), {
        withFileTypes: true,
      })) {
        const relative = `${directory}/${entry.name}`;
        if (entry.isDirectory()) await walk(relative);
        else found.push(relative);
      }
    };

    for (const directory of ['apps/web/src/i18n', 'apps/web/src/components']) {
      await walk(directory);
    }

    expect(found.length).toBeGreaterThan(0);

    for (const file of found) {
      expect(renderTree, `${file} must be covered by the static-render guard`).toContain(
        file,
      );
    }
  });

  it('declares exactly one routing entry point, on the Next 16 convention', async () => {
    // Next fails the build when both `middleware.ts` and `proxy.ts` exist, so
    // this cannot regress silently — but it can regress into the WRONG one of
    // the two, and a routing file nobody notices is how a second, divergent
    // locale implementation begins.
    const { existsSync } = await import('node:fs');

    for (const location of ['apps/web/src', 'apps/web']) {
      expect(existsSync(path.join(repoRoot, location, 'middleware.ts'))).toBe(false);
    }

    expect(existsSync(path.join(repoRoot, 'apps/web/src/proxy.ts'))).toBe(true);
  });

  it('keeps no unprefixed public application tree beside the locale one', async () => {
    // ROUTE_MAP.md §1.1: the locale segment is ALWAYS present for PAGES. A
    // surviving `app/layout.tsx` and `app/page.tsx` would make `/` answer
    // directly and reintroduce exactly the duplicate-URL problem the contract
    // removes.
    //
    // THE ACCEPTED NON-LOCALE ROUTES, and only those. ROUTE_MAP.md §10 rule 6
    // names the complete set: `robots.txt`, the sitemaps, `/api/*`, `/rss/*`,
    // the health probes and `/assets/{id}`. Each is machine-readable and
    // unprefixed BY CONTRACT — a locale prefix on `/robots.txt` would simply be
    // wrong, and a redirect on a provider callback path is a silent integration
    // failure. The proxy's matcher excludes exactly these for the same reason.
    //
    // `assets` joined the set in Phase 7. It serves stored BYTES, which have no
    // interface locale: three localised URLs for one object would give the same
    // bytes three cache entries and three canonical addresses. It is a route
    // handler behind a default-deny authorisation decision and returns a file
    // or a 404 — never markup.
    //
    // None of them is a page. The assertion below this one proves that
    // separately, by looking for anything that renders.
    const entries = await readdir(path.join(repoRoot, 'apps/web/src/app'));

    expect([...entries].sort()).toEqual([
      '[locale]',
      'api',
      'assets',
      'robots.ts',
      'sitemap.xml',
      'sitemaps',
    ]);
  });

  it('exposes no page outside the locale segment', async () => {
    // The stronger form of the rule above: whatever lives beside `[locale]`
    // must not RENDER anything. A `page.tsx` under `api/` would be an
    // unprefixed public page wearing a non-locale path.
    const outside: string[] = [];

    const walk = async (directory: string): Promise<void> => {
      for (const entry of await readdir(path.join(repoRoot, directory), {
        withFileTypes: true,
      })) {
        if (entry.name === '[locale]') continue;

        const relative = `${directory}/${entry.name}`;
        if (entry.isDirectory()) await walk(relative);
        else if (/^(page|layout|template|default)\.(tsx|jsx)$/.test(entry.name)) {
          outside.push(relative);
        }
      }
    };

    await walk('apps/web/src/app');

    expect(outside).toEqual([]);
  });
});
