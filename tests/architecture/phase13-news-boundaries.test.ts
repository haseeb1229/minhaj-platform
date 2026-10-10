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
  it('models each family with its own tables and no image, Event or engagement field — and a Centre only on the NewsArticle revision', async () => {
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
          expect(field, `${family}${suffix}.${field}`).not.toMatch(
            /image|asset|photo|gallery|event|centre|center|collection|newsletter|featured|popular|views?\b|kind|type|target/iu,
          );
        }
      }
    expect(modelBody(schema, 'NewsArticleRevision')).toMatch(/^\s*centreId String\?/mu);
    for (const absent of [
      'News',
      'NewsItem',
      'EditorialContent',
      'ContentRevision',
      'Event',
      'NewsletterSubscriber',
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
  it('delivers the News route families and no sort, Event, newsletter or feed route', async () => {
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
    for (const absent of ['latest', 'popular', 'featured'])
      expect(await exists(`${base}/${absent}`), absent).toBe(false);
    for (const absent of [
      'apps/web/src/app/[locale]/(public)/newsletter',
      'apps/web/src/app/[locale]/(public)/events',
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
      keys.filter((key) => /^(news|press|statement|mediaCoverage)/u.test(key)),
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
  it('emits no image, logo or publisher in structured data and embeds no third-party content', async () => {
    const source = uncommented(await read('apps/web/src/components/editorial/news.tsx'));
    expect(source).not.toMatch(/['"](image|logo|publisher|thumbnailUrl)['"]\s*:/u);
    expect(source).not.toMatch(/\bimage\s*:/u);
    expect(source).not.toMatch(/<img\b|<iframe\b|next\/image/u);
    // The coverage source is a described outbound link, never an embed.
    expect(source).toMatch(/rel="external noopener noreferrer"/u);
  });
});
