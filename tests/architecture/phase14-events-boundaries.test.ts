import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';

import { contextBoundaryConfigs } from '../../packages/config/eslint/boundaries.js';
import {
  contextAllowlist,
  contextSlugs,
  permittedSameLevelEdges,
} from '../../packages/config/eslint/contexts.js';
import { editorialKindSchema } from '../../packages/contracts/src/editorial/values.ts';
import {
  SCOPE_OF_KIND,
  SEARCH_KINDS,
  SEARCH_SCOPE_KINDS,
} from '../../packages/contracts/src/search/values.ts';
import {
  repoRoot,
  validateFixtureWorkspace,
  type ArchitectureViolation,
} from './architecture-harness.ts';

/**
 * Phase 14 boundaries — Event as an Editorial aggregate, its typed association
 * to Media-owned Galleries, and the one new same-level edge that association
 * required: Editorial → Media (DOMAIN_MODEL.md §3.2).
 *
 * THE FAILURES THIS FILE EXISTS TO PREVENT, each of which would pass every
 * behavioural test on the day it was introduced:
 *
 *   - Media reading Editorial — the edge runs Editorial → Media only, exactly
 *     as Phase 16's runs Editorial → Global Network only;
 *   - Editorial reaching past Media's public interface into its internals;
 *   - Event persistence reading a Gallery, a Photo or a Centre table directly
 *     instead of naming them by typed identity and letting Layer 4 compose the
 *     owner's public reader;
 *   - Events quietly becoming searchable — Phase 14 carries no Search
 *     Foundation in its dependency path;
 *   - the anonymous Event pages acquiring a session by importing an
 *     ADMINISTRATIVE composition root that wires Identity in.
 *
 * The edge proofs drive BOTH gates — the authoritative resolving analyser over
 * fixture workspaces, and the shipped ESLint boundary configuration — because a
 * second gate that disagreed would invite the exception §6.3 rule 12 forbids.
 */

const read = (relative: string) => readFile(path.join(repoRoot, relative), 'utf8');

async function walk(directory: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(path.join(repoRoot, directory), {
    withFileTypes: true,
  })) {
    const relative = `${directory}/${entry.name}`;
    if (entry.isDirectory()) found.push(...(await walk(relative)));
    else found.push(relative);
  }
  return found;
}

/** Source with comments removed, so prose explaining an absence cannot match. */
function uncommented(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//gu, ' ').replace(/(^|[^:])\/\/.*$/gmu, '$1 ');
}

/** Every static, side-effect, dynamic and `require` specifier in a source. */
function specifiersIn(source: string): string[] {
  const body = uncommented(source);
  const found: string[] = [];
  for (const pattern of [
    /\bfrom\s*['"]([^'"]+)['"]/gu,
    /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/gu,
    /\bimport\(\s*['"]([^'"]+)['"]\s*\)/gu,
    /\brequire\(\s*['"]([^'"]+)['"]\s*\)/gu,
  ])
    for (const match of body.matchAll(pattern))
      if (match[1] !== undefined) found.push(match[1]);
  return found;
}

const APP_SRC = 'apps/web/src';

/** Resolves an in-app specifier to a repo-relative file, or `null` if external. */
async function resolveInApp(from: string, specifier: string): Promise<string | null> {
  const base = specifier.startsWith('@/')
    ? `${APP_SRC}/${specifier.slice(2)}`
    : specifier.startsWith('.')
      ? path.posix.join(path.posix.dirname(from), specifier)
      : null;
  if (base === null) return null;
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
  ]) {
    try {
      if ((await stat(path.join(repoRoot, candidate))).isFile()) return candidate;
    } catch {
      // Not this candidate.
    }
  }
  return null;
}

const ALLOWED = 'tests/fixtures/allowed';
const BYPASS = 'tests/fixtures/bypass';

let allowedRun: Promise<ArchitectureViolation[]> | null = null;
let bypassRun: Promise<ArchitectureViolation[]> | null = null;

/** Violations the real analyser reports for one file of a fixture workspace. */
async function violationsFor(
  root: typeof ALLOWED | typeof BYPASS,
  suffix: string,
): Promise<ArchitectureViolation[]> {
  const run =
    root === ALLOWED
      ? (allowedRun ??= validateFixtureWorkspace(ALLOWED))
      : (bypassRun ??= validateFixtureWorkspace(BYPASS));
  return (await run).filter((violation) =>
    violation.file.split(path.sep).join('/').endsWith(suffix),
  );
}

/**
 * Lints one import as the shipped ESLint boundary configuration sees it from a
 * production file path — the path selects the per-context block, so this is
 * the real configuration rather than a reconstruction of it.
 */
async function lintImport(filePath: string, specifier: string): Promise<string[]> {
  const eslint = new ESLint({
    overrideConfigFile: true,
    overrideConfig: [
      {
        languageOptions: {
          parser: tseslint.parser,
          ecmaVersion: 2023,
          sourceType: 'module',
        },
      },
      ...contextBoundaryConfigs({ appRoot: APP_SRC }),
    ],
  });
  const [result] = await eslint.lintText(
    `import x from '${specifier}';\nexport default x;\n`,
    { filePath },
  );
  return (result?.messages ?? []).map((message) => message.message);
}

const EDITORIAL = `${APP_SRC}/contexts/editorial`;
const MEDIA = `${APP_SRC}/contexts/media`;
const GLOBAL = `${APP_SRC}/contexts/global-network`;
const EVENT_ADAPTER = 'packages/database/src/adapters/editorial/event.ts';

describe('the allowlist records Editorial → Media, one way only', () => {
  it('lists the edge beside Messaging → Learning and Editorial → Global Network', () => {
    expect(permittedSameLevelEdges).toContainEqual({ from: 'editorial', to: 'media' });
    expect(permittedSameLevelEdges).toContainEqual({
      from: 'editorial',
      to: 'global-network',
    });
    expect(contextAllowlist.editorial).toContain('media');
    expect(contextAllowlist.editorial).toContain('global-network');
  });

  it('keeps editorial off the media and global-network rows', () => {
    expect(contextAllowlist.media).not.toContain('editorial');
    expect(contextAllowlist['global-network']).not.toContain('editorial');
  });

  it('reaches Editorial from neither Media nor Global Network by any path', () => {
    // Stronger than the row check: no TRANSITIVE route back exists, so the new
    // edge closes no cycle through a third context.
    const reachable = (from: string): Set<string> => {
      const seen = new Set<string>();
      const queue = [from];
      while (queue.length > 0) {
        const next = queue.pop() ?? '';
        for (const target of contextAllowlist[next] ?? [])
          if (!seen.has(target)) {
            seen.add(target);
            queue.push(target);
          }
      }
      return seen;
    };
    expect(contextSlugs).toContain('media');
    expect(reachable('media')).not.toContain('editorial');
    expect(reachable('global-network')).not.toContain('editorial');
    expect(reachable('editorial')).toContain('media');
    for (const slug of contextSlugs) expect(reachable(slug), slug).not.toContain(slug);
  });
});

describe('the analyser enforces the edge against real fixtures', () => {
  it('accepts editorial -> media as import, re-export and dynamic import of the public entry', async () => {
    const source = await read(
      `${ALLOWED}/apps/app/src/contexts/editorial/allowed-media-forms.ts`,
    );
    // The fixture must really exercise all three forms, or "accepted" is vacuous.
    expect(specifiersIn(source).filter((s) => s === '@/contexts/media')).toHaveLength(3);
    expect(await violationsFor(ALLOWED, 'editorial/allowed-media-forms.ts')).toEqual([]);
  });

  it('still accepts the Phase-16 editorial -> global-network forms in the same workspace', async () => {
    expect(await violationsFor(ALLOWED, 'editorial/allowed-forms.ts')).toEqual([]);
    expect(await violationsFor(ALLOWED, '')).toEqual([]);
  });

  it('rejects editorial reaching Media internals through a relative path', async () => {
    const violations = await violationsFor(BYPASS, 'editorial/media-internal-bypass.ts');
    expect(violations.map((violation) => violation.rule)).toContain(
      'context-internal-import',
    );
  });

  it('rejects media -> editorial even as a dynamic import', async () => {
    const violations = await violationsFor(
      BYPASS,
      'media/gallery-to-editorial-bypass.ts',
    );
    expect(violations.map((violation) => violation.rule)).toContain(
      'forbidden-context-dependency',
    );
    expect(violations.map((violation) => violation.message).join('\n')).toContain(
      "'media' may not depend on 'editorial'",
    );
  });

  it('still rejects global-network -> editorial', async () => {
    const violations = await violationsFor(
      BYPASS,
      'global-network/reverse-editorial-bypass.ts',
    );
    expect(violations.map((violation) => violation.message).join('\n')).toContain(
      "'global-network' may not depend on 'editorial'",
    );
  });
});

describe('ESLint agrees with the analyser on the new edge', () => {
  it('permits Editorial the public entries of Media and Global Network', async () => {
    for (const specifier of [
      '@/contexts/media',
      '@/contexts/media/index',
      '../media/index',
      '@/contexts/global-network',
    ])
      expect(
        await lintImport(`${EDITORIAL}/event-service.ts`, specifier),
        specifier,
      ).toEqual([]);
  });

  const rejected: readonly (readonly [string, string])[] = [
    [`${EDITORIAL}/event-service.ts`, '@/contexts/media/application/read-service'],
    [`${EDITORIAL}/event-service.ts`, '../media/application/read-service'],
    [`${MEDIA}/gallery-service.ts`, '@/contexts/editorial'],
    [`${MEDIA}/gallery-service.ts`, '../editorial'],
    [`${GLOBAL}/centre-service.ts`, '@/contexts/editorial'],
  ];

  for (const [file, specifier] of rejected)
    it(`rejects '${specifier}' from ${file.slice(APP_SRC.length + 1)}`, async () => {
      const messages = await lintImport(file, specifier);
      expect(messages.length).toBeGreaterThan(0);
      expect(messages.join('\n')).toContain('Architecture:');
    });

  it('needs no ESLint disable anywhere the edge is used', async () => {
    const files = [
      ...(await walk(EDITORIAL)),
      ...(await walk(MEDIA)),
      `${APP_SRC}/composition/editorial.ts`,
      `${APP_SRC}/composition/media.ts`,
      ...(await walk('packages/database/src/adapters/editorial')),
    ];
    expect(files).toContain(EVENT_ADAPTER);
    for (const file of files)
      expect(await read(file), file).not.toMatch(
        /eslint-disable|@ts-ignore|@ts-nocheck/u,
      );
  });
});

describe('Editorial’s own code imports nothing of Media or Global Network', () => {
  it('reaches neither context from the Editorial web context, in any import form', async () => {
    const files = (await walk(EDITORIAL)).filter((file) => /\.tsx?$/u.test(file));
    expect(files.length).toBeGreaterThan(5);
    for (const file of files)
      for (const specifier of specifiersIn(await read(file))) {
        const resolved = (await resolveInApp(file, specifier)) ?? specifier;
        expect(resolved, `${file} imports ${specifier}`).not.toMatch(
          /contexts\/(media|global-network)(\/|$)|composition\/(media|global)/u,
        );
      }
  });

  it('exports the Gallery reference interface from Media’s public entry, which imports no Editorial', async () => {
    const entry = uncommented(await read(`${MEDIA}/index.ts`));
    expect(entry).toMatch(/createGalleryReferences/u);
    for (const file of await walk(MEDIA))
      for (const specifier of specifiersIn(await read(file)))
        expect(specifier, `${file} imports ${specifier}`).not.toMatch(
          /editorial|global/u,
        );
  });

  it('wires the edge only at Layer 4, through Media’s public interface', async () => {
    const composition = await read(`${APP_SRC}/composition/editorial.ts`);
    expect(specifiersIn(composition)).toContain('./media');
    const media = specifiersIn(await read(`${APP_SRC}/composition/media.ts`));
    expect(media).toContain('@/contexts/media');
    expect(media.filter((s) => s.startsWith('@/contexts/media/'))).toEqual([]);
  });
});

describe('Event is one Editorial aggregate and nothing else', () => {
  it('delivers exactly the eight Event tables, and no Event join owned elsewhere', async () => {
    const schema = await read('packages/database/prisma/schema.prisma');
    const eventModels = [...schema.matchAll(/^model (Event\w*) \{/gmu)]
      .map(([, name]) => name)
      .sort();
    expect(eventModels).toEqual(
      [
        'Event',
        'EventContributor',
        'EventGallery',
        'EventRevision',
        'EventRevisionTranslation',
        'EventSchedule',
        'EventSlugHistory',
        'EventTopic',
      ].sort(),
    );
    // Still forbidden: a Photo-level association, a Media- or Global-owned
    // join, or a second location table beside the revision's ONE Centre.
    for (const absent of [
      'EventPhoto',
      'GalleryEvent',
      'CentreEvent',
      'EventCentre',
      'EventLocation',
      'EventVenue',
      'MediaEvent',
    ])
      expect(schema, absent).not.toMatch(new RegExp(`^model ${absent} \\{`, 'mu'));
  });
});

describe('Event persistence names other owners and never reads them', () => {
  const OTHER_OWNERS =
    'gallery|galleryLabel|galleryItem|photo|photoLabel|asset|centre|centreLabel|centreContact|centreServiceCity|centreSlugHistory|country|countryLabel|region|regionLabel|city|cityLabel';

  it('uses no Media or Global Network delegate, relation include or table in raw SQL', async () => {
    const files = await walk('packages/database/src/adapters/editorial');
    expect(files).toContain(EVENT_ADAPTER);
    for (const file of files) {
      const source = uncommented(await read(file));
      // `tx.gallery.findMany(...)`, `db().centre.count(...)`.
      expect(source, file).not.toMatch(new RegExp(`\\.(${OTHER_OWNERS})\\s*\\.`, 'u'));
      // `include: { gallery: true }`, `select: { centre: { … } }` — checked on
      // the Event adapter, where no other key of those names exists (News uses
      // `centre: true` as a code-owned family flag, not a relation).
      if (file === EVENT_ADAPTER)
        expect(source, file).not.toMatch(
          new RegExp(`\\b(${OTHER_OWNERS})\\s*:\\s*(true|\\{)`, 'u'),
        );
      // `FROM [dbo].[Gallery]`, `JOIN [Centre]`.
      expect(source, file).not.toMatch(
        /\[(Gallery|GalleryLabel|GalleryItem|Photo|PhotoLabel|Asset|Centre|CentreLabel|CentreContact|CentreServiceCity|CentreSlugHistory|Country|CountryLabel|Region|RegionLabel|City|CityLabel)\]/u,
      );
    }
  });

  it('stores the associations by typed identity on its own tables', async () => {
    const source = uncommented(await read(EVENT_ADAPTER));
    expect(source).toMatch(/galleryId/u);
    expect(source).toMatch(/centreId/u);
    expect(source).toMatch(/\.event\s*\./u);
    expect(source).toMatch(/\[dbo\]\.\[EventSchedule\]/u);
  });

  it('is never read back by Media or Global Network persistence', async () => {
    // The reverse of the edge at the table level: `Gallery.eventAssociations`
    // and `Centre.eventRevisions` are Prisma back-relations of Editorial-owned
    // rows, and neither owner's adapter follows them.
    const files = [
      ...(await walk('packages/database/src/adapters/media')),
      ...(await walk('packages/database/src/adapters/global-network')),
    ];
    expect(files.length).toBeGreaterThan(2);
    for (const file of files)
      expect(uncommented(await read(file)), file).not.toMatch(
        /eventAssociations|eventRevisions|\.event(Revision|Gallery|Schedule)?\s*\.|\[Event(Revision|Gallery|Schedule)?\]/u,
      );
  });

  it('imports no other adapter and requests no search indexing', async () => {
    const source = await read(EVENT_ADAPTER);
    expect(uncommented(source)).not.toMatch(/requestSearchIndexing|SearchIndex/u);
    for (const specifier of specifiersIn(source))
      expect(specifier, specifier).not.toMatch(
        /search|adapters\/(media|global-network)|^\.\.\/(media|global-network|search)\b|contracts\/(media|global|search)/u,
      );
  });
});

describe('Events are not searchable in Phase 14', () => {
  it('adds no Event search kind or scope, while Event is an Editorial kind', () => {
    expect(editorialKindSchema.options).toContain('event');
    expect(editorialKindSchema.options).toHaveLength(7);
    expect(SEARCH_KINDS.length).toBeGreaterThan(0);
    for (const kind of [
      ...SEARCH_KINDS,
      ...SEARCH_SCOPE_KINDS,
      ...Object.keys(SCOPE_OF_KIND),
    ])
      expect(kind, kind).not.toMatch(/event/iu);
  });

  it('wires no Event source into Search', async () => {
    const wiring = uncommented(await read(`${APP_SRC}/composition/search-wiring.ts`));
    expect(wiring.length).toBeGreaterThan(0);
    expect(wiring).not.toMatch(/event/iu);
    for (const file of await walk('packages/contracts/src/search'))
      expect((await read(file)).replace(/\/\*[\s\S]*?\*\//gu, ' '), file).not.toMatch(
        /'event'|"event"/u,
      );
  });
});

describe('the public Event read path holds no session', () => {
  const ENTRIES = [
    `${APP_SRC}/components/editorial/events.tsx`,
    `${APP_SRC}/composition/editorial-read.ts`,
    `${APP_SRC}/composition/global-read.ts`,
    `${APP_SRC}/composition/media-read.ts`,
  ];

  /** Every in-app module reachable from the entries, and every package specifier. */
  async function reachable(): Promise<{ modules: Set<string>; packages: Set<string> }> {
    const modules = new Set<string>();
    const packages = new Set<string>();
    const queue = [...ENTRIES];
    while (queue.length > 0) {
      const current = queue.pop();
      if (current === undefined || modules.has(current)) continue;
      modules.add(current);
      for (const specifier of specifiersIn(await read(current))) {
        const resolved = await resolveInApp(current, specifier);
        if (resolved === null) packages.add(specifier);
        else if (!modules.has(resolved)) queue.push(resolved);
      }
    }
    return { modules, packages };
  }

  it('composes the three PUBLIC readers and reaches no administrative root, identity or session', async () => {
    const { modules, packages } = await reachable();
    // Non-vacuous: the walk really crosses into each owner's public reader.
    for (const entry of ENTRIES) expect(modules).toContain(entry);
    expect(modules).toContain(`${APP_SRC}/components/media/photos.tsx`);
    expect(modules).toContain(`${APP_SRC}/contexts/media/index.ts`);
    expect(modules).toContain(`${APP_SRC}/contexts/editorial/index.ts`);
    expect(modules.size).toBeGreaterThan(20);
    expect(specifiersIn(await read(ENTRIES[0] ?? ''))).toEqual(
      expect.arrayContaining([
        '@/composition/editorial-read',
        '@/composition/global-read',
        '@/composition/media-read',
      ]),
    );
    for (const forbidden of [
      `${APP_SRC}/composition/identity.ts`,
      `${APP_SRC}/composition/authorization.ts`,
      `${APP_SRC}/composition/request.ts`,
      `${APP_SRC}/composition/editorial.ts`,
      `${APP_SRC}/composition/media.ts`,
      `${APP_SRC}/composition/global.ts`,
      `${APP_SRC}/config/server-env.ts`,
    ])
      expect(modules, forbidden).not.toContain(forbidden);
    for (const module of modules)
      expect(module, module).not.toMatch(/contexts\/identity-access/u);
    for (const specifier of packages)
      expect(specifier, specifier).not.toMatch(
        /^(next\/headers|next\/cookies|better-auth|@prisma\/|@minhaj\/server-core)/u,
      );
  });
});
