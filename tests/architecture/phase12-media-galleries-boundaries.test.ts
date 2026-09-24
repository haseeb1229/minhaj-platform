import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { repoRoot } from './architecture-harness.ts';

/**
 * Phase 12 boundaries — photographs and galleries, with no Event, no download,
 * no Photo page, no search kind, and two independent allows before a byte of an
 * image leaves the disk.
 *
 * THE FAILURES THIS FILE EXISTS TO PREVENT, each of which would pass every
 * behavioural test on the day it was introduced:
 *
 *   - a forward reference to Event, Centre or Collection creeping into the
 *     photograph schema or code before those phases own the association;
 *   - a Photo detail page, a download route or a Search kind arriving "for
 *     symmetry" without the decision that would justify it;
 *   - the public image route acquiring a session, or confirming a cached copy
 *     (`304`) BEFORE both owners have allowed — which would let a withdrawn
 *     image keep being shown;
 *   - the image upload losing a Class-A check, buffering a whole file, or the
 *     global Server Action cap being raised instead;
 *   - an image optimiser, image-processing library, lightbox or carousel
 *     framework, or remote image host arriving without a decision.
 */

const read = (relative: string) => readFile(path.join(repoRoot, relative), 'utf8');

/** Source with comments and string literals removed, so prose cannot match. */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//gu, ' ')
    .replace(/(^|[^:])\/\/.*$/gmu, '$1 ')
    .replace(/'(?:[^'\\\n]|\\.)*'/gu, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/gu, '""')
    .replace(/`(?:[^`\\]|\\.)*`/gu, '``');
}

/** Source with comments removed but literals kept. */
function uncommented(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//gu, ' ').replace(/(^|[^:])\/\/.*$/gmu, '$1 ');
}

async function walk(directory: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(path.join(repoRoot, directory), {
    withFileTypes: true,
  })) {
    const relative = `${directory}/${entry.name}`;
    if (entry.isDirectory()) found.push(relative, ...(await walk(relative)));
    else found.push(relative);
  }
  return found;
}

const PUBLIC_BYTES = 'apps/web/src/app/assets/media/photos/[photoId]/[assetId]/route.ts';
const PREVIEW_BYTES =
  'apps/web/src/app/assets/media/previews/photos/[photoId]/[assetId]/route.ts';
const SERVE = 'apps/web/src/app/assets/media/serve.ts';
const UPLOAD = 'apps/web/src/app/api/admin/media/photos/[photoId]/asset/route.ts';
const MIGRATION =
  'packages/database/prisma/migrations/20260927000000_phase12_media_galleries/migration.sql';

/** The body of one Prisma model. */
function modelBody(schema: string, model: string): string {
  return new RegExp(`model ${model} \\{[\\s\\S]*?\\n\\}`, 'u').exec(schema)?.[0] ?? '';
}

describe('no forward reference to Event, Centre or Collection exists', () => {
  it('gives Photo, Gallery and GalleryItem no such field, no type and no Photo slug', async () => {
    const schema = await read('packages/database/prisma/schema.prisma');
    for (const model of [
      'Photo',
      'PhotoLabel',
      'Gallery',
      'GalleryLabel',
      'GalleryItem',
    ]) {
      const body = modelBody(schema, model);
      expect(body, model).not.toBe('');
      const fields = body
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => /^[a-z]\w*\s/u.test(line))
        .map((line) => `${line.split(/\s+/u)[0] ?? ''} ${line.split(/\s+/u)[1] ?? ''}`);
      for (const field of fields) {
        expect(field, `${model}.${field}`).not.toMatch(
          /event|centre|center|collection|person|topic|kind|target|news/iu,
        );
      }
    }
    expect(modelBody(schema, 'Photo')).not.toMatch(/\bslug\b/u);
    // No Event, gallery join or photograph aggregate beyond the three.
    for (const absent of [
      'Event',
      'EventGallery',
      'GalleryEvent',
      'Album',
      'MediaItem',
      'Image',
    ]) {
      expect(schema, absent).not.toMatch(new RegExp(`^model ${absent} \\{`, 'mu'));
    }
  });

  it('keeps the migration free of any Event, Centre or Collection reference', async () => {
    const sql = (await read(MIGRATION))
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n');
    expect(sql).not.toMatch(/event|centre|center|collection/iu);
    // And it widens no search vocabulary: photographs are not a Search kind.
    expect(sql).not.toMatch(/Search/u);
  });

  it('keeps Media’s photograph code free of any Event, News or Global dependency', async () => {
    const files = [
      ...(await walk('apps/web/src/contexts/media')),
      'packages/contracts/src/media/photo.ts',
      'packages/database/src/adapters/media/photo.ts',
      'apps/web/src/components/media/photos.tsx',
      'apps/web/src/app/[locale]/admin/media/photo-surfaces.tsx',
    ].filter((file) => /\.tsx?$/u.test(file));
    for (const file of files) {
      const source = code(await read(file));
      expect(source, file).not.toMatch(
        /\bevent(Id|s)?\b|\bEvent\b|centreId|collectionId/u,
      );
      expect(uncommented(await read(file)), file).not.toMatch(
        /contexts\/(events|news|global)|contracts\/(events|news|global)/u,
      );
    }
  });
});

describe('only the promised routes exist', () => {
  it('delivers the four public surfaces — no Photo page, no downloads, no event gallery', async () => {
    const media = await walk('apps/web/src/app/[locale]/(public)/media');
    expect(media.filter((entry) => entry.endsWith('page.tsx')).sort()).toEqual([
      'apps/web/src/app/[locale]/(public)/media/archive/page.tsx',
      'apps/web/src/app/[locale]/(public)/media/galleries/[slug]/page.tsx',
      'apps/web/src/app/[locale]/(public)/media/galleries/page.tsx',
      'apps/web/src/app/[locale]/(public)/media/photos/page.tsx',
    ]);
    expect(media.some((entry) => /download/iu.test(entry))).toBe(false);
    const events = await walk('apps/web/src/app/[locale]/(public)').then((entries) =>
      entries.filter((entry) => entry.includes('/events')),
    );
    expect(events).toEqual([]);
  });

  it('delivers the two administrative surfaces and no asset file manager', async () => {
    const admin = await walk('apps/web/src/app/[locale]/admin/media');
    for (const expected of [
      'apps/web/src/app/[locale]/admin/media/photos/page.tsx',
      'apps/web/src/app/[locale]/admin/media/photos/[id]/page.tsx',
      'apps/web/src/app/[locale]/admin/media/galleries/page.tsx',
      'apps/web/src/app/[locale]/admin/media/galleries/[id]/page.tsx',
    ]) {
      expect(admin).toContain(expected);
    }
    expect(admin.some((entry) => entry.includes('/assets'))).toBe(false);
  });

  it('adds no Search kind for photographs or galleries', async () => {
    const values = code(await read('packages/contracts/src/search/values.ts'));
    const literals = await read('packages/contracts/src/search/values.ts');
    expect(literals).not.toMatch(/'photo'|'gallery'|'galleries'|'photos'/u);
    expect(values.length).toBeGreaterThan(0);
    const wiring = uncommented(await read('apps/web/src/composition/search-wiring.ts'));
    expect(wiring).not.toMatch(/photo|galler/iu);
  });
});

describe('an image needs BOTH owners, and the public path holds no session', () => {
  it('builds the public image route on an Identity-free composition', async () => {
    for (const file of [
      PUBLIC_BYTES,
      SERVE,
      'apps/web/src/composition/media-assets.ts',
    ]) {
      const source = uncommented(await read(file));
      for (const forbidden of [
        '@/composition/identity',
        '@/composition/authorization',
        '@/composition/request',
        "@/composition/media'",
        'next/headers',
        'cookies',
        'better-auth',
      ]) {
        expect(source, `${file} reaches ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('re-checks a live permission on the preview route', async () => {
    const preview = uncommented(await read(PREVIEW_BYTES));
    expect(preview).toContain("requirePermittedAction('en', 'media.administer')");
    expect(preview).toContain('mediaPreviewPhotoPolicy');
    expect(preview).toContain('preview: true');
  });

  it('confirms a cached copy only AFTER Storage and Media have released the image', async () => {
    const serve = code(await read(SERVE));
    const start = serve.indexOf('export async function servePhoto(');
    const photo = serve.slice(start);
    const opened = photo.indexOf('storage.open(');
    const compared = photo.indexOf('ifNoneMatch');
    const notModified = photo.indexOf('status: 304');
    expect(start).toBeGreaterThan(-1);
    expect(opened).toBeGreaterThan(-1);
    expect(
      photo.indexOf('if (asset === null) return refuseMediaBytes()'),
    ).toBeGreaterThan(opened);
    expect(photo.lastIndexOf('request.ifNoneMatch')).toBeGreaterThan(opened);
    expect(compared).toBeGreaterThan(-1);
    expect(notModified).toBeGreaterThan(opened);
    // Never shared-cached, never a download, never buffered.
    const literal = uncommented(await read(SERVE));
    expect(literal).toContain("'private, no-cache'");
    expect(literal).toContain("'private, no-store'");
    for (const forbidden of [
      'arrayBuffer',
      'Buffer.concat',
      'readFile',
      'attachment',
      'public, max-age',
    ]) {
      expect(literal, forbidden).not.toContain(forbidden);
    }
  });

  it('reads no query parameter in either image route', async () => {
    for (const file of [PUBLIC_BYTES, PREVIEW_BYTES]) {
      const source = uncommented(await read(file));
      expect(source, file).not.toMatch(/searchParams|nextUrl|new URL\(/u);
    }
  });
});

describe('the photograph upload is a Class-A route, and changes nothing else', () => {
  it('accepts POST and nothing else', async () => {
    const source = uncommented(await read(UPLOAD));
    expect(source).toMatch(/export\s+async\s+function\s+POST\b/u);
    for (const verb of ['GET', 'PUT', 'PATCH', 'DELETE']) {
      expect(source, verb).not.toMatch(
        new RegExp(`export\\s+(async\\s+)?function\\s+${verb}\\b`),
      );
    }
  });

  it('checks origin and intent, then the session, then the size, then the budget — before a byte', async () => {
    const source = code(await read(UPLOAD));
    const origin = source.indexOf('isSameOriginMutation(');
    const session = source.indexOf('requirePermittedAction(');
    const length = source.indexOf('length > PHOTO_UPLOAD_MAX_BYTES');
    const limit = source.indexOf('consumePhotoUpload(');
    const stored = source.indexOf('uploadPhoto(');
    expect(origin).toBeGreaterThan(-1);
    expect(session).toBeGreaterThan(origin);
    expect(length).toBeGreaterThan(session);
    expect(limit).toBeGreaterThan(length);
    expect(stored).toBeGreaterThan(limit);
    for (const buffering of [
      'arrayBuffer(',
      'formData(',
      '.blob(',
      '.text(',
      'request.json(',
    ]) {
      expect(source, buffering).not.toContain(buffering);
      expect(
        code(await read('apps/web/src/app/api/admin/media/upload-transport.ts')),
      ).not.toContain(buffering);
    }
    expect(uncommented(await read(UPLOAD))).toContain("'media-photo-upload'");
  });

  it('sends an IMAGE policy — Storage validates and strips every photograph', async () => {
    const upload = uncommented(
      await read('apps/web/src/contexts/media/application/photo-upload.ts'),
    );
    expect(upload).toContain('image: PHOTO_IMAGE_LIMITS');
    expect(upload).toContain('allowedMediaTypes: [...PHOTO_MEDIA_TYPES]');
    const contract = uncommented(await read('packages/contracts/src/media/photo.ts'));
    expect(contract).toMatch(
      /PHOTO_MEDIA_TYPES = Object\.freeze\(\['image\/jpeg', 'image\/png'\] as const\)/u,
    );
    expect(contract).not.toContain('image/svg');
  });

  it('raises no global cap and allows no remote image host or optimiser', async () => {
    const config = uncommented(await read('apps/web/next.config.ts'));
    expect(config).not.toContain('bodySizeLimit');
    expect(config).not.toContain('serverActions');
    expect(config).not.toContain('remotePatterns');
    expect(config).not.toMatch(/images\s*:/u);
    expect(config).toContain(`"img-src 'self' data:"`);

    const files = (await walk('apps/web/src')).filter((file) => /\.tsx?$/u.test(file));
    for (const file of files) {
      expect(uncommented(await read(file)), file).not.toContain('next/image');
    }
  });

  it('adds no image-processing, EXIF, lightbox or carousel dependency', async () => {
    for (const manifest of [
      'package.json',
      'apps/web/package.json',
      'packages/storage/package.json',
      'packages/contracts/package.json',
      'packages/database/package.json',
    ]) {
      const source = await read(manifest);
      for (const forbidden of [
        'sharp',
        'jimp',
        'image-size',
        'exif',
        'exifr',
        'piexifjs',
        'probe-image-size',
        'lightbox',
        'photoswipe',
        'swiper',
        'react-image-gallery',
        'yet-another-react-lightbox',
        'multer',
        'busboy',
        '@aws-sdk',
      ]) {
        expect(source, `${manifest} depends on ${forbidden}`).not.toContain(
          `"${forbidden}`,
        );
      }
    }
  });
});
