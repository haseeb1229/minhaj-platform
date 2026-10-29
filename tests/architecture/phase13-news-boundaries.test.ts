import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  NEWS_KINDS,
  NEWS_RESERVED_SLUGS,
  NEWS_SEGMENTS,
} from '../../packages/contracts/src/editorial/news.ts';
import { PERMISSION_CATALOGUE } from '../../packages/contracts/src/identity/permissions.ts';
import { repoRoot } from './architecture-harness.ts';

/**
 * Phase 13 boundaries — News inside Editorial, four aggregates, no image, no
 * Event, Centre or newsletter, and no route that is really a sort.
 *
 * THE FAILURES THIS FILE EXISTS TO PREVENT, each of which would pass every
 * behavioural test on the day it was introduced:
 *
 *   - a News bounded context, or one generic content table with a type column,
 *     arriving in place of four Editorial aggregates;
 *   - a lead image, an Asset or Photo relation, or a remote image address —
 *     a Storage or Media dependency Phase 13 does not have;
 *   - an Event, Collection or newsletter relation arriving before the phase
 *     that owns it — and, since Phase 16, a Centre reference anywhere but the
 *     ONE typed `centreId` on the NewsArticle revision;
 *   - `/news/latest`, `/news/popular` or `/news/featured` as paths, or a
 *     `/newsletter` or `/rss` route nothing delivers;
 *   - a `news.*` permission minted for symmetry beside the `content.*` keys;
 *   - a NewsArticle slug able to claim a static `/news` sibling.
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

/** The body of one Prisma model. */
function modelBody(schema: string, model: string): string {
  return new RegExp(`model ${model} \\{[\\s\\S]*?\\n\\}`, 'u').exec(schema)?.[0] ?? '';
}

const FAMILIES = ['NewsArticle', 'PressRelease', 'Statement', 'MediaCoverage'];
const SUFFIXES = [
  '',
  'Revision',
  'RevisionTranslation',
  'Topic',
  'Contributor',
  'SlugHistory',
];
const MIGRATION =
  'packages/database/prisma/migrations/20260928000000_phase13_news/migration.sql';

describe('four Editorial aggregates, and nothing generic', () => {
  it('models each family with its own tables and no Event or engagement field — a Centre only on the NewsArticle revision, and ONE typed lead image only on the NewsArticle and PressRelease revisions', async () => {
    const schema = await read('packages/database/prisma/schema.prisma');
    for (const family of FAMILIES)
      for (const suffix of SUFFIXES) {
        const body = modelBody(schema, family + suffix);
        expect(body, family + suffix).not.toBe('');
        const fields = body
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => /^[a-z]\w*\s/u.test(line))
          .map((line) => `${line.split(/\s+/u)[0] ?? ''} ${line.split(/\s+/u)[1] ?? ''}`);
        for (const field of fields) {
          // Phase 16: the ONE Centre reference is the NewsArticle revision's
          // typed `centreId` and its relation (DOMAIN_MODEL.md §17.1).
          if (
            family + suffix === 'NewsArticleRevision' &&
            /^(centreId String\?|centre Centre\?)$/u.test(field)
          )
            continue;
          // Phase 15: the ONE Collection field is Prisma's back-relation of the
          // Collection-owned typed member column (`CollectionItem.<family>Id`)
          // on the family's root record — no column on any News table, and
          // News code reads none of it.
          if (suffix === '' && field === 'collectionItems CollectionItem[]') continue;
          // Phase 30-R (an owner decision superseding the Phase-13 "no image"
          // rule): a NewsArticle or PressRelease revision may name ONE lead
          // image — a typed key to an application-owned Asset with its box and
          // credit — and its translations the image's alt text. No remote
          // address, no gallery, no image table; Statement and MediaCoverage
          // carry none (DOMAIN_MODEL.md §7.1).
          if (
            (family === 'NewsArticle' || family === 'PressRelease') &&
            ((suffix === 'Revision' &&
              /^(leadAssetId String\?|leadWidth Int\?|leadHeight Int\?|leadCredit String\?|leadAsset Asset\?)$/u.test(
                field,
              )) ||
              (suffix === 'RevisionTranslation' && field === 'leadAlt String'))
          )
            continue;
          expect(field, `${family}${suffix}.${field}`).not.toMatch(
            /image|asset|photo|gallery|event|centre|center|collection|newsletter|featured|popular|views?\b|kind|type|target/iu,
          );
        }
      }
    expect(modelBody(schema, 'NewsArticleRevision')).toMatch(/^\s*centreId String\?/mu);
    // The lead image is ONE typed key per revision, and nowhere else.
    for (const family of ['NewsArticle', 'PressRelease'])
      expect(modelBody(schema, `${family}Revision`)).toMatch(
        /^\s*leadAssetId String\? @db\.NVarChar\(36\)$/mu,
      );
    for (const family of ['Statement', 'MediaCoverage'])
      for (const suffix of SUFFIXES)
        expect(modelBody(schema, family + suffix), family + suffix).not.toMatch(
          /\blead/u,
        );
    for (const absent of [
      'News',
      'NewsItem',
      'EditorialContent',
      'ContentRevision',
      // `Event` is absent from this list since Phase 14 delivered it as its OWN
      // Editorial aggregate; no News family gains an Event field (above).
      'NewsEvent',
      // `NewsletterSubscriber` is absent from this list since Phase 21 delivered
      // it in Personalisation & Notifications; no News family references it.
    ])
      expect(schema, absent).not.toMatch(new RegExp(`^model ${absent} \\{`, 'mu'));
  });

  it('keeps the migration free of any image, Event, Centre, Collection or newsletter reference', async () => {
    const sql = (await read(MIGRATION))
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n');
    expect(sql).not.toMatch(
      /\[Asset\]|\[Photo\]|\[Gallery\]|event|centre|collection|newsletter/iu,
    );
  });

  it('adds no bounded context and no Storage or Media dependency to Editorial', async () => {
    expect(await exists('apps/web/src/contexts/news')).toBe(false);
    const files = [
      ...(await walk('apps/web/src/contexts/editorial')),
      'packages/database/src/adapters/editorial/news.ts',
      'packages/contracts/src/editorial/news.ts',
    ];
    for (const file of files) {
      const source = uncommented(await read(file));
      expect(source, file).not.toMatch(
        /@minhaj\/storage|contracts\/media|contexts\/media|adapters\/media|composition\/media/u,
      );
    }
  });
});

describe('routes: path views that are curated, queries that are not', () => {
  it('delivers the News route families and no sort, News-scoped Event, newsletter or feed route', async () => {
    const base = 'apps/web/src/app/[locale]/(public)/news';
    for (const route of [
      'page.tsx',
      '[slug]/page.tsx',
      'archive/page.tsx',
      'press-releases/page.tsx',
      'press-releases/[slug]/page.tsx',
      'statements/page.tsx',
      'statements/[slug]/page.tsx',
      'media-coverage/page.tsx',
      'media-coverage/[slug]/page.tsx',
    ])
      expect(await exists(`${base}/${route}`), route).toBe(true);
    // `/events` is Phase 14's own top-level route family, never under `/news`.
    for (const absent of ['latest', 'popular', 'featured', 'events'])
      expect(await exists(`${base}/${absent}`), absent).toBe(false);
    // `/newsletter` is Personalisation's since Phase 21, never under `/news`.
    for (const absent of [
      'apps/web/src/app/rss',
      'apps/web/src/app/[locale]/(public)/media/downloads',
    ])
      expect(await exists(absent), absent).toBe(false);
  });

  it('reserves every static /news sibling from the NewsArticle slug namespace', async () => {
    const siblings = (
      await readdir(path.join(repoRoot, 'apps/web/src/app/[locale]/(public)/news'), {
        withFileTypes: true,
      })
    )
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('['))
      .map((entry) => entry.name)
      .sort();
    expect([...NEWS_RESERVED_SLUGS].sort()).toEqual(siblings);
    expect(
      Object.values(NEWS_SEGMENTS)
        .filter((segment): segment is string => segment !== null)
        .every((segment) => (NEWS_RESERVED_SLUGS as readonly string[]).includes(segment)),
    ).toBe(true);
    const sql = await read(MIGRATION);
    for (const reserved of NEWS_RESERVED_SLUGS)
      expect(sql).toMatch(
        new RegExp(`NewsArticleSlugHistory_slug_ck.*N'${reserved}'`, 'u'),
      );
  });
});

describe('authority stays in the Editorial keys', () => {
  it('mints no news, press, statement or coverage permission', () => {
    const keys = PERMISSION_CATALOGUE.map((entry) => entry.key);
    expect(
      // `newsletter.*` (Phase 21) is Personalisation's, not a News family's.
      keys.filter((key) => /^(news|press|statement|mediaCoverage)\./u.test(key)),
    ).toEqual([]);
    for (const key of [
      'content.read',
      'content.author',
      'content.review',
      'content.publish',
    ])
      expect(keys).toContain(key);
  });

  it('routes all four families through the one editorial workflow', async () => {
    const service = uncommented(
      await read('apps/web/src/contexts/editorial/application/editorial-service.ts'),
    );
    // One transition and one scheduler for every kind; no News-specific copy.
    expect(service.match(/async transition\(/gu)?.length).toBe(1);
    expect(service.match(/async runDue\(/gu)?.length).toBe(1);
    expect(NEWS_KINDS).toHaveLength(4);
  });
});

describe('the public News tree claims nothing it does not have', () => {
  it('claims no logo or publisher, embeds no third-party content, and pictures only its own first-party lead image', async () => {
    const source = uncommented(await read('apps/web/src/components/editorial/news.tsx'));
    expect(source).not.toMatch(/['"](image|logo|publisher|thumbnailUrl)['"]\s*:/u);
    expect(source).not.toMatch(/\bimage\s*:/u);
    // A picture appears only through the lead-image components — never a raw
    // tag, an embed or a third-party image component.
    expect(source).not.toMatch(/<img\b|<iframe\b|next\/image/u);
    // The coverage source is a described outbound link, never an embed.
    expect(source).toMatch(/rel="external noopener noreferrer"/u);

    // Phase 30-R: structured data names an image only as Editorial's OWN byte
    // route for the record's own lead image — never a remote address, a logo
    // or a publisher.
    const presentation = uncommented(
      await read('apps/web/src/components/editorial/presentation.ts'),
    );
    expect(presentation).not.toMatch(/\b(logo|publisher|thumbnailUrl)\s*:/u);
    const images = presentation.match(/\bimage\s*:[^\n]*/gu) ?? [];
    expect(images.length).toBeGreaterThan(0);
    for (const image of images)
      expect(image).toMatch(
        /^image\s*:\s*absoluteUrl\(leadImagePath\(record\.leadImage\)\)/u,
      );

    // The lead-image components draw ONLY Editorial's own route.
    const lead = uncommented(
      await read('apps/web/src/components/editorial/lead-image.tsx'),
    );
    const sources = lead.match(/\bsrc=\{[^}]*\}/gu) ?? [];
    expect(sources).toEqual(['src={leadImagePath(image)}', 'src={leadImagePath(image)}']);
    expect(lead).not.toMatch(/https?:\/\/|next\/image|<iframe\b/u);
  });
});
