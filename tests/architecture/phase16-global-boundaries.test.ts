import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { PERMISSION_CATALOGUE } from '../../packages/contracts/src/identity/permissions.ts';
import { repoRoot } from './architecture-harness.ts';

/**
 * Phase 16 boundaries — the Global Network as its own context, centre-scoped
 * News as the existing Editorial model, and nothing the phase does not own.
 *
 * THE FAILURES THIS FILE EXISTS TO PREVENT, each of which would pass every
 * behavioural test on the day it was introduced:
 *
 *   - Global reading Editorial, or Editorial's persistence querying Global's
 *     tables — the edge runs Editorial → Global only, and composition is Layer 4;
 *   - a per-centre News system, or a Centre on a News family other than
 *     NewsArticle;
 *   - an Event, a schedule, a map, a geocoder or a Global search kind arriving
 *     ahead of the phase that owns it;
 *   - a per-level permission minted for symmetry beside the two Global keys;
 *   - the Media permission descriptions drifting again from what the migration
 *     recorded;
 *   - a Centre contact page that sends anything.
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

const MIGRATION =
  'packages/database/prisma/migrations/20260929000000_phase16_global_network/migration.sql';

describe('Global Network owns its directory and reads nothing of Editorial', () => {
  it('imports no Editorial code from its context, contract or adapter', async () => {
    const files = [
      ...(await walk('apps/web/src/contexts/global-network')),
      ...(await walk('packages/contracts/src/global')),
      ...(await walk('packages/database/src/adapters/global-network')),
    ];
    expect(files.length).toBeGreaterThan(5);
    for (const file of files)
      expect(uncommented(await read(file)), file).not.toMatch(
        /contexts\/editorial|contracts\/editorial|adapters\/editorial|composition\/editorial/u,
      );
  });

  it('keeps Global persistence on Global tables, and Editorial persistence off them', async () => {
    for (const file of await walk('packages/database/src/adapters/global-network'))
      expect(uncommented(await read(file)), file).not.toMatch(
        /\.(newsArticle|newsArticleRevision|pressRelease|statement|mediaCoverage|article)\b/u,
      );
    for (const file of await walk('packages/database/src/adapters/editorial'))
      expect(uncommented(await read(file)), file).not.toMatch(
        /\.(centre|country|region|city|centreLabel|centreContact)\.(find|count|create|update|delete)/u,
      );
  });

  it('creates no geography context beside it', async () => {
    for (const name of [
      'geography',
      'location',
      'locations',
      'directory',
      'centres',
      'map',
    ])
      expect(await exists(`apps/web/src/contexts/${name}`), name).toBe(false);
  });
});

describe('centre-scoped News is the existing NewsArticle, and only it', () => {
  it('puts the one Centre reference on the NewsArticle revision', async () => {
    const schema = await read('packages/database/prisma/schema.prisma');
    const models = [...schema.matchAll(/^model (\w+) \{([\s\S]*?)\n\}/gmu)];
    const withCentre = models
      .filter(([, , body]) => /^\s*centreId\s/mu.test(body ?? ''))
      .map(([, name]) => name);
    expect(withCentre.sort()).toEqual(
      [
        'CentreContact',
        'CentreLabel',
        'CentreServiceCity',
        'CentreSlugHistory',
        'NewsArticleRevision',
      ].sort(),
    );
    for (const absent of [
      'CentreNews',
      'LocalNews',
      'CentreArticle',
      'GlobalNews',
      'NewsArticleCentre',
    ])
      expect(schema, absent).not.toMatch(new RegExp(`^model ${absent} \\{`, 'mu'));
  });

  it('migrates every existing revision to no Centre and cascades nothing into News', async () => {
    const sql = await read(MIGRATION);
    expect(sql).toMatch(
      /ALTER TABLE \[dbo\]\.\[NewsArticleRevision\] ADD \[centreId\] NVARCHAR\(36\) NULL;/u,
    );
    expect(sql).not.toMatch(/UPDATE \[dbo\]\.\[NewsArticleRevision\]/u);
    expect(sql).not.toMatch(/ON DELETE CASCADE|ON UPDATE CASCADE/u);
    expect(sql).not.toMatch(/\[(PressRelease|Statement|MediaCoverage)Revision\] ADD/u);
  });
});

describe('nothing the phase does not own', () => {
  it('creates no Event, schedule, map, geocoder or search vocabulary', async () => {
    const schema = await read('packages/database/prisma/schema.prisma');
    for (const absent of ['Event', 'EventSchedule', 'CentreEvent', 'GeocodeCache'])
      expect(schema, absent).not.toMatch(new RegExp(`^model ${absent} \\{`, 'mu'));
    const sql = uncommented(await read(MIGRATION))
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n');
    expect(sql).not.toMatch(/Search(Document|IndexRequest|IndexScope)|\[Event|geocod/iu);
    const search = await read('packages/contracts/src/search/values.ts');
    expect(search).not.toMatch(/'centre'|'country'|'region'|'city'/u);
  });

  it('adds no map, geocoding or location dependency to any workspace', async () => {
    for (const manifest of [
      'package.json',
      'apps/web/package.json',
      'packages/contracts/package.json',
      'packages/database/package.json',
    ]) {
      const body = await read(manifest);
      expect(body, manifest).not.toMatch(
        /leaflet|mapbox|maplibre|@googlemaps|google-maps|geocod|openlayers|@turf\//iu,
      );
    }
  });

  it('delivers the reserved Global routes and no Centre Events route', async () => {
    const base = 'apps/web/src/app/[locale]/(public)/global';
    for (const route of [
      'page.tsx',
      'find-a-centre/page.tsx',
      'countries/page.tsx',
      'countries/[country]/page.tsx',
      'countries/[country]/regions/[region]/page.tsx',
      'countries/[country]/cities/[city]/page.tsx',
      'centres/page.tsx',
      'centres/[slug]/page.tsx',
      'centres/[slug]/news/page.tsx',
      'centres/[slug]/contact/page.tsx',
      'pakistan/page.tsx',
    ])
      expect(await exists(`${base}/${route}`), route).toBe(true);
    for (const absent of ['centres/[slug]/events', 'regions', 'cities', 'events'])
      expect(await exists(`${base}/${absent}`), absent).toBe(false);
    for (const file of await walk('apps/web/src/components/global'))
      expect(uncommented(await read(file)), file).not.toMatch(/\/events\b/u);
  });

  it('keeps the Centre contact page display-only', async () => {
    const source = uncommented(await read('apps/web/src/components/global/centre.tsx'));
    expect(source).not.toMatch(/<form\b|action=|'use server'|ActionForm/u);
    expect(source).toMatch(/rel="external noopener noreferrer"/u);
    expect(source).not.toMatch(/<iframe\b|<img\b|next\/image/u);
  });
});

describe('authority stays in two Global keys', () => {
  it('mints global.read and global.administer and nothing per level', () => {
    const keys = PERMISSION_CATALOGUE.map((entry) => entry.key);
    expect(keys.filter((key) => key.startsWith('global.')).sort()).toEqual([
      'global.administer',
      'global.read',
    ]);
    expect(
      keys.filter((key) =>
        /^(country|region|city|centre|location|directory)\./u.test(key),
      ),
    ).toEqual([]);
  });

  it('describes the Media keys exactly as the Phase-12 migration recorded them', async () => {
    const sql = await read(
      'packages/database/prisma/migrations/20260927000000_phase12_media_galleries/migration.sql',
    );
    for (const key of ['media.read', 'media.administer']) {
      const recorded = new RegExp(
        `SET \\[description\\] = N'([^']+)'\\s*WHERE \\[key\\] = N'${key.replace('.', '\\.')}'`,
        'u',
      ).exec(sql)?.[1];
      expect(recorded, key).toBeDefined();
      expect(PERMISSION_CATALOGUE.find((entry) => entry.key === key)?.description).toBe(
        recorded,
      );
    }
  });
});
