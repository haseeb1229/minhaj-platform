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
import { COLLECTION_MEMBER_KINDS } from '../../packages/contracts/src/editorial/collection.ts';
import { editorialKindSchema } from '../../packages/contracts/src/editorial/values.ts';
import { PERMISSION_CATALOGUE } from '../../packages/contracts/src/identity/permissions.ts';
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
 * Phase 15 boundaries — Collection as an Editorial aggregate, its typed,
 * ordered members owned by Editorial, Library and Media, and the one new
 * same-level edge that membership required: Editorial → Library
 * (DOMAIN_MODEL.md §3.2). Editorial → Media is reused for Video members.
 *
 * THE FAILURES THIS FILE EXISTS TO PREVENT, each of which would pass every
 * behavioural test on the day it was introduced:
 *
 *   - Library reading Editorial — the edge runs Editorial → Library only;
 *   - Editorial's own context code importing Library or Media at all, instead
 *     of Layer 4 composing the owners' public reads;
 *   - the Collection adapter reading a Work, Edition, Video or asset table
 *     directly, or Library or Media persistence reading a Collection table;
 *   - a generic polymorphic `targetType + targetId` member, a member type no
 *     prerequisite delivered, or the future PrivateCollection arriving early;
 *   - Collections quietly becoming searchable — Phase 15 carries no Search
 *     Foundation in its dependency path;
 *   - a `collection.*` permission minted beside the shared `content.*` keys;
 *   - the anonymous Collection pages acquiring a session by importing an
 *     ADMINISTRATIVE composition root that wires Identity in.
 *
 * The edge proofs drive BOTH gates — the authoritative resolving analyser over
 * fixture workspaces, and the shipped ESLint boundary configuration — because a
 * second gate that disagreed would invite the exception §6.3 rule 12 forbids.
 */

const read = (relative: string) => readFile(path.join(repoRoot, relative), 'utf8');

async function exists(relative: string): Promise<boolean> {
  try {
    await stat(path.join(repoRoot, relative));
    return true;
  } catch {
    return false;
  }
}

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

/** The body of one Prisma model. */
function modelBody(schema: string, model: string): string {
  return new RegExp(`model ${model} \\{[\\s\\S]*?\\n\\}`, 'u').exec(schema)?.[0] ?? '';
}

/** `name Type` for every field line of one model. */
function fieldsOf(schema: string, model: string): string[] {
  return modelBody(schema, model)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^[a-z]\w*\s/u.test(line))
    .map((line) => `${line.split(/\s+/u)[0] ?? ''} ${line.split(/\s+/u)[1] ?? ''}`);
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
const LIBRARY = `${APP_SRC}/contexts/library`;
const MEDIA = `${APP_SRC}/contexts/media`;
const COMPOSITION = `${APP_SRC}/composition`;
const COLLECTION_ADAPTER = 'packages/database/src/adapters/editorial/collection.ts';
const MIGRATION =
  'packages/database/prisma/migrations/20261001000000_phase15_collections/migration.sql';

describe('the allowlist records Editorial → Library, one way only', () => {
  it('lists the edge beside the earlier Editorial edges', () => {
    expect(permittedSameLevelEdges).toContainEqual({ from: 'editorial', to: 'library' });
    expect(permittedSameLevelEdges).toContainEqual({ from: 'editorial', to: 'media' });
    expect(permittedSameLevelEdges).toContainEqual({
      from: 'editorial',
      to: 'global-network',
    });
    expect(contextAllowlist.editorial).toContain('library');
    expect(contextAllowlist.editorial).toContain('media');
  });

  it('keeps editorial off the library row', () => {
    expect(contextAllowlist.library).not.toContain('editorial');
    expect(contextAllowlist.library).toEqual([
      'identity-access',
      'people-contributors',
      'taxonomy',
    ]);
  });

  it('reaches Editorial from Library by no path, and closes no cycle anywhere', () => {
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
    expect(contextSlugs).toContain('library');
    expect(reachable('library')).not.toContain('editorial');
    expect(reachable('media')).not.toContain('editorial');
    expect(reachable('editorial')).toContain('library');
    for (const slug of contextSlugs) expect(reachable(slug), slug).not.toContain(slug);
  });
});

describe('the analyser enforces the edge against real fixtures', () => {
  it('accepts editorial -> library as import, re-export and dynamic import of the public entry', async () => {
    const source = await read(
      `${ALLOWED}/apps/app/src/contexts/editorial/allowed-library-forms.ts`,
    );
    // The fixture must really exercise all three forms, or "accepted" is vacuous.
    expect(specifiersIn(source).filter((s) => s === '@/contexts/library')).toHaveLength(
      3,
    );
    expect(await violationsFor(ALLOWED, 'editorial/allowed-library-forms.ts')).toEqual(
      [],
    );
    // And the whole allowed workspace stays clean with the new fixture in it.
    expect(await violationsFor(ALLOWED, '')).toEqual([]);
  });

  it('rejects editorial reaching Library internals through a relative path', async () => {
    const violations = await violationsFor(
      BYPASS,
      'editorial/library-internal-bypass.ts',
    );
    expect(violations.map((violation) => violation.rule)).toContain(
      'context-internal-import',
    );
  });

  it('rejects library -> editorial even as a dynamic import', async () => {
    const violations = await violationsFor(BYPASS, 'library/work-to-editorial-bypass.ts');
    expect(violations.map((violation) => violation.rule)).toContain(
      'forbidden-context-dependency',
    );
    expect(violations.map((violation) => violation.message).join('\n')).toContain(
      "'library' may not depend on 'editorial'",
    );
  });

  it('still rejects a deep relative traversal into a context Editorial may not reach', async () => {
    const violations = await violationsFor(BYPASS, 'editorial/deep-relative-bypass.ts');
    expect(violations.map((violation) => violation.message).join('\n')).toContain(
      "'editorial' may not depend on 'quran'",
    );
  });
});

describe('ESLint agrees with the analyser on the new edge', () => {
  it('permits Editorial the public entry of Library', async () => {
    for (const specifier of [
      '@/contexts/library',
      '@/contexts/library/index',
      '../library/index',
    ])
      expect(
        await lintImport(`${EDITORIAL}/collection-service.ts`, specifier),
        specifier,
      ).toEqual([]);
  });

  const rejected: readonly (readonly [string, string])[] = [
    [`${EDITORIAL}/collection-service.ts`, '@/contexts/library/application/read-service'],
    [`${EDITORIAL}/collection-service.ts`, '../library/application/read-service'],
    [`${LIBRARY}/work-service.ts`, '@/contexts/editorial'],
    [`${LIBRARY}/work-service.ts`, '../editorial'],
    [`${LIBRARY}/work-service.ts`, '@/contexts/editorial/application/public-service'],
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
      ...(await walk(LIBRARY)),
      ...(await walk(MEDIA)),
      `${COMPOSITION}/editorial.ts`,
      `${COMPOSITION}/collection-members.ts`,
      `${COMPOSITION}/library-read.ts`,
      `${COMPOSITION}/media-read.ts`,
      ...(await walk('packages/database/src/adapters/editorial')),
      ...(await walk('packages/database/src/adapters/library')),
      ...(await walk('packages/database/src/adapters/media')),
      'packages/contracts/src/editorial/collection.ts',
      'packages/config/eslint/contexts.js',
    ];
    expect(files).toContain(COLLECTION_ADAPTER);
    for (const file of files)
      expect(await read(file), file).not.toMatch(
        /eslint-disable|@ts-ignore|@ts-nocheck/u,
      );
  });
});

describe('Editorial’s own code imports nothing of Library, Media or Global Network', () => {
  it('reaches none of them from the Editorial web context, in any import form', async () => {
    const files = (await walk(EDITORIAL)).filter((file) => /\.tsx?$/u.test(file));
    expect(files.length).toBeGreaterThan(5);
    for (const file of files)
      for (const specifier of specifiersIn(await read(file))) {
        const resolved = (await resolveInApp(file, specifier)) ?? specifier;
        expect(resolved, `${file} imports ${specifier}`).not.toMatch(
          /contexts\/(library|media|global-network)(\/|$)|composition\/|contracts\/(library|media|global)/u,
        );
      }
  });

  it('exports the Work reference reads from Library’s public entry, which imports no Editorial', async () => {
    const entry = uncommented(await read(`${LIBRARY}/index.ts`));
    expect(entry).toMatch(/createLibraryReadService/u);
    const service = uncommented(await read(`${LIBRARY}/application/read-service.ts`));
    expect(service).toMatch(/\bworkReferences\(/u);
    expect(service).toMatch(/\bworkChoices\(/u);
    const files = await walk(LIBRARY);
    expect(files.length).toBeGreaterThan(3);
    for (const file of files) {
      for (const specifier of specifiersIn(await read(file)))
        expect(specifier, `${file} imports ${specifier}`).not.toMatch(/editorial/u);
      expect(uncommented(await read(file)), file).not.toMatch(/\bcollection/iu);
    }
  });

  it('keeps Media’s code free of any Editorial or Collection dependency', async () => {
    for (const file of await walk(MEDIA)) {
      for (const specifier of specifiersIn(await read(file)))
        expect(specifier, `${file} imports ${specifier}`).not.toMatch(/editorial/u);
      expect(uncommented(await read(file)), file).not.toMatch(/\bcollection/iu);
    }
  });

  it('wires the edge only at Layer 4, through each owner’s public read root', async () => {
    const members = specifiersIn(await read(`${COMPOSITION}/collection-members.ts`));
    expect(members).toEqual(
      expect.arrayContaining(['./editorial-read', './library-read', './media-read']),
    );
    for (const specifier of members)
      expect(specifier, specifier).not.toMatch(
        /^\.\/(editorial|library|media|identity|authorization|request)$|@\/contexts\/|@minhaj\/database/u,
      );
    for (const [root, entry] of [
      ['library-read.ts', '@/contexts/library'],
      ['media-read.ts', '@/contexts/media'],
    ] as const) {
      const specifiers = specifiersIn(await read(`${COMPOSITION}/${root}`));
      expect(specifiers, root).toContain(entry);
      expect(
        specifiers.filter((s) => s.startsWith(`${entry}/`)),
        root,
      ).toEqual([]);
    }
    // The administrative Editorial root asks the members' owners through the
    // resolver, never through a Library or Media runtime of its own.
    const editorial = specifiersIn(await read(`${COMPOSITION}/editorial.ts`));
    expect(editorial).toContain('./collection-members');
    expect(editorial).not.toContain('./library');
    expect(editorial).not.toContain('./library-read');
  });
});

describe('Collection is one Editorial aggregate and nothing else', () => {
  it('delivers exactly the seven Collection tables, and no private, generic or per-type collection', async () => {
    const schema = await read('packages/database/prisma/schema.prisma');
    const all = [...schema.matchAll(/^model (\w*Collection\w*) \{/gmu)].map(
      ([, name]) => name,
    );
    // A Hadith collection is a different thing that shares the word: the
    // source compilation a narration belongs to (Phase 19), owned by Hadith
    // and never an Editorial grouping. Exactly its two tables, named apart.
    expect(all.filter((name) => name?.startsWith('Hadith')).sort()).toEqual([
      'HadithCollection',
      'HadithCollectionName',
    ]);
    // A PRIVATE collection is Personalisation's (Phase 21): a person's own
    // list over their saved items — distinct from an editorial Collection
    // (DOMAIN_MODEL.md §18), with exactly its two tables, named apart.
    expect(all.filter((name) => name?.startsWith('Private')).sort()).toEqual([
      'PrivateCollection',
      'PrivateCollectionItem',
    ]);
    const models = all
      .filter((name) => !name?.startsWith('Hadith') && !name?.startsWith('Private'))
      .sort();
    expect(models).toEqual(
      [
        'Collection',
        'CollectionContributor',
        'CollectionItem',
        'CollectionRevision',
        'CollectionRevisionTranslation',
        'CollectionSlugHistory',
        'CollectionTopic',
      ].sort(),
    );
    for (const absent of [
      'CollectionEvent',
      'CollectionGallery',
      'CollectionPage',
      'CollectionPhoto',
      'CollectionMember',
      'CollectionTarget',
      'CollectionWork',
      'CollectionVideo',
      'LibraryCollection',
      'MediaCollection',
    ])
      expect(schema, absent).not.toMatch(new RegExp(`^model ${absent} \\{`, 'mu'));
    // No Collection table carries a polymorphic pair, a privacy flag or an owner.
    for (const model of models)
      for (const field of fieldsOf(schema, model ?? ''))
        expect(field, `${model ?? ''}.${field}`).not.toMatch(
          /^(targetType|targetId|targetKind|memberType|memberKind|kind|type|isPrivate|private|visibility|ownerAccountId|userId|accountId)\s/u,
        );
  });

  it('gives CollectionItem its place and exactly one typed column per member type', async () => {
    const schema = await read('packages/database/prisma/schema.prisma');
    const scalars = fieldsOf(schema, 'CollectionItem').filter((field) =>
      /\s(String\??|Int\??)$/u.test(field),
    );
    expect(scalars.sort()).toEqual(
      [
        'ownerId String',
        'revisionNumber Int',
        'position Int',
        'articleId String?',
        'newsArticleId String?',
        'pressReleaseId String?',
        'statementId String?',
        'mediaCoverageId String?',
        'workId String?',
        'videoId String?',
      ].sort(),
    );
    // One column per contract member type, and none for any other.
    const camel = (kind: string) =>
      kind.replace(/-([a-z])/gu, (_, letter: string) => letter.toUpperCase());
    expect(
      scalars
        .map((field) => field.split(' ')[0] ?? '')
        .filter((name) => name.endsWith('Id') && name !== 'ownerId')
        .sort(),
    ).toEqual(COLLECTION_MEMBER_KINDS.map((kind) => `${camel(kind)}Id`).sort());
    expect(modelBody(schema, 'CollectionItem')).toMatch(
      /@@id\(\[ownerId,revisionNumber,position\]\)/u,
    );
    expect(modelBody(schema, 'CollectionItem')).not.toMatch(/onDelete:\s*Cascade/u);

    // The database states the same: exactly one member per place, a bounded
    // position, and no record twice in one revision.
    // SQL comments removed, so the prose explaining an absence cannot match.
    const sql = (await read(MIGRATION))
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n');
    expect(sql).toMatch(/CollectionItem_one_member_ck/u);
    expect(sql).toMatch(/CollectionItem_position_ck/u);
    for (const column of [
      'article',
      'newsArticle',
      'pressRelease',
      'statement',
      'mediaCoverage',
      'work',
      'video',
    ])
      expect(sql, column).toMatch(new RegExp(`CollectionItem_${column}_key`, 'u'));
    expect(sql).not.toMatch(/ON DELETE CASCADE|ON UPDATE CASCADE|targetType/iu);
  });

  it('mints no collection.* permission beside the shared content.* keys', () => {
    expect(editorialKindSchema.options).toContain('collection');
    const keys = PERMISSION_CATALOGUE.map((entry) => entry.key);
    expect(keys.some((key) => /^collections?\./u.test(key))).toBe(false);
    for (const key of ['content.read', 'content.author'])
      expect(
        PERMISSION_CATALOGUE.find((entry) => entry.key === key)?.description,
        key,
      ).toMatch(/media coverage, event and collection drafts/u);
  });
});

describe('Collection persistence names other owners and never reads them', () => {
  /** Library's and Media's delegates and relations, as Prisma names them. */
  const OTHER_OWNERS =
    'work|workLabel|workTopic|workContributor|edition|bookTranslation|salePoint|video|videoLabel|videoTopic|videoSpeaker|series|playlist|playlistItem|asset|gallery|photo';

  it('uses no Library or Media delegate, relation include or table in raw SQL', async () => {
    const source = uncommented(await read(COLLECTION_ADAPTER));
    // `tx.work.findMany(...)`, `db().video.count(...)`.
    expect(source).not.toMatch(new RegExp(`\\.(${OTHER_OWNERS})\\s*\\.`, 'u'));
    // `include: { work: true }`, `select: { video: { … } }`.
    expect(source).not.toMatch(
      new RegExp(`\\b(${OTHER_OWNERS})\\s*:\\s*(true|\\{)`, 'u'),
    );
    // `FROM [dbo].[Work]`, `JOIN [Video]`.
    expect(source).not.toMatch(
      /\[(Work|WorkLabel|Edition|BookTranslation|Video|VideoLabel|Series|Playlist|Asset|Gallery|Photo)\]/u,
    );
    // Its own members ARE read: only Editorial's own record tables.
    expect(source).toMatch(/c\.article\b/u);
    expect(source).toMatch(/workId/u);
    expect(source).toMatch(/videoId/u);
    expect(source).toMatch(/\.collection\s*\./u);
  });

  it('imports no other adapter and requests no search indexing', async () => {
    const source = await read(COLLECTION_ADAPTER);
    expect(uncommented(source)).not.toMatch(
      /requestSearchIndexing|SearchIndex|search-intent/u,
    );
    for (const specifier of specifiersIn(source))
      expect(specifier, specifier).not.toMatch(
        /search|adapters\/(library|media)|^\.\.\/(library|media|search)\b|contracts\/(library|media|search)/u,
      );
  });

  it('is never read back by Library or Media persistence, nor by any other Editorial adapter', async () => {
    const files = [
      ...(await walk('packages/database/src/adapters/library')),
      ...(await walk('packages/database/src/adapters/media')),
    ];
    expect(files.length).toBeGreaterThan(2);
    for (const file of files)
      expect(uncommented(await read(file)), file).not.toMatch(
        /collectionItems|\.collection\w*\s*\.|\[Collection\w*\]|collection/iu,
      );
    // The back-relations `<member>.collectionItems` are Prisma's view of a
    // Collection-owned column: no adapter at all follows them.
    for (const file of await walk('packages/database/src/adapters'))
      expect(uncommented(await read(file)), file).not.toMatch(/collectionItems/u);
    // Only the Collection adapter (and the module that assembles the ports)
    // names a Collection delegate.
    for (const file of await walk('packages/database/src/adapters/editorial'))
      if (file !== COLLECTION_ADAPTER)
        expect(uncommented(await read(file)), file).not.toMatch(
          /\.collection(Revision|Item|SlugHistory|Topic|Contributor)?\s*\./u,
        );
  });
});

describe('Collections are not searchable in Phase 15', () => {
  it('adds no Collection search kind or scope, while Collection is an Editorial kind', () => {
    expect(editorialKindSchema.options).toContain('collection');
    expect(SEARCH_KINDS.length).toBeGreaterThan(0);
    for (const kind of [
      ...SEARCH_KINDS,
      ...SEARCH_SCOPE_KINDS,
      ...Object.keys(SCOPE_OF_KIND),
    ])
      expect(kind, kind).not.toMatch(/collection/iu);
  });

  it('wires no Collection source into Search', async () => {
    const wiring = uncommented(await read(`${COMPOSITION}/search-wiring.ts`));
    expect(wiring.length).toBeGreaterThan(0);
    expect(wiring).not.toMatch(/collection/iu);
    for (const file of await walk('packages/contracts/src/search'))
      expect(uncommented(await read(file)), file).not.toMatch(/collection/iu);
    for (const file of await walk('packages/search/src'))
      expect(uncommented(await read(file)), file).not.toMatch(/collection/iu);
  });
});

describe('the public Collection read path holds no session', () => {
  const PAGES = [
    `${APP_SRC}/app/[locale]/(public)/collections/page.tsx`,
    `${APP_SRC}/app/[locale]/(public)/collections/[slug]/page.tsx`,
  ];
  const ENTRIES = [
    `${APP_SRC}/components/editorial/collections.tsx`,
    `${COMPOSITION}/collection-members.ts`,
    `${COMPOSITION}/editorial-read.ts`,
    `${COMPOSITION}/library-read.ts`,
    `${COMPOSITION}/media-read.ts`,
    `${APP_SRC}/seo/collections-sitemap.ts`,
    ...PAGES,
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

  it('delivers the two public routes and no /library/collections or sort route', async () => {
    for (const page of PAGES) expect(await exists(page), page).toBe(true);
    for (const absent of ['latest', 'popular', 'featured'])
      expect(
        await exists(`${APP_SRC}/app/[locale]/(public)/collections/${absent}`),
        absent,
      ).toBe(false);
    expect(await exists(`${APP_SRC}/app/[locale]/(public)/library/collections`)).toBe(
      false,
    );
  });

  it('composes the PUBLIC readers and reaches no administrative root, identity or session', async () => {
    const { modules, packages } = await reachable();
    // Non-vacuous: the walk really crosses into each owner's public reader.
    for (const entry of ENTRIES) expect(modules).toContain(entry);
    expect(modules).toContain(`${APP_SRC}/contexts/editorial/index.ts`);
    expect(modules).toContain(`${APP_SRC}/contexts/library/index.ts`);
    expect(modules).toContain(`${APP_SRC}/contexts/media/index.ts`);
    expect(modules.size).toBeGreaterThan(20);
    expect(specifiersIn(await read(ENTRIES[0] ?? ''))).toEqual(
      expect.arrayContaining([
        '@/composition/collection-members',
        '@/composition/editorial-read',
      ]),
    );
    for (const forbidden of [
      `${COMPOSITION}/identity.ts`,
      `${COMPOSITION}/authorization.ts`,
      `${COMPOSITION}/request.ts`,
      `${COMPOSITION}/editorial.ts`,
      `${COMPOSITION}/library.ts`,
      `${COMPOSITION}/media.ts`,
      `${COMPOSITION}/global.ts`,
      `${APP_SRC}/config/server-env.ts`,
    ])
      expect(modules, forbidden).not.toContain(forbidden);
    for (const module of modules)
      expect(module, module).not.toMatch(/contexts\/identity-access|\/admin\//u);
    for (const specifier of packages)
      expect(specifier, specifier).not.toMatch(
        /^(next\/headers|next\/cookies|better-auth|@prisma\/|@minhaj\/server-core)/u,
      );
  });
});
