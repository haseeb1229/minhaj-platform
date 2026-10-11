import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { repoRoot } from './architecture-harness.ts';

/**
 * Phase 11 boundaries — non-Quran audio, two independent allows, and one large
 * browser upload that changes nothing else's size.
 *
 * THE FAILURES THIS FILE EXISTS TO PREVENT, each of which would pass every
 * behavioural test on the day it was introduced:
 *
 *   - audio quietly becoming a second place to author a Quran recitation;
 *   - the public byte route acquiring a session, so a listener's identity could
 *     vary what is served;
 *   - a Range header being read BEFORE authorisation, so a slice of a draft
 *     became a way around the decision;
 *   - the upload route losing one of its Class-A checks, buffering a whole file,
 *     or somebody raising the global Server Action body cap instead;
 *   - a download, a player library or a widened media policy arriving without a
 *     decision.
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

const PUBLIC_BYTES = 'apps/web/src/app/assets/media/audio/[trackId]/[assetId]/route.ts';
const PREVIEW_BYTES =
  'apps/web/src/app/assets/media/previews/audio/[trackId]/[assetId]/route.ts';
const SERVE = 'apps/web/src/app/assets/media/serve.ts';
const UPLOAD = 'apps/web/src/app/api/admin/media/audio/[trackId]/asset/route.ts';

describe('audio can never become a second Quran recitation authoring path', () => {
  it('gives AudioTrack and AudioSeries no field that could describe a recitation', async () => {
    const schema = await read('packages/database/prisma/schema.prisma');
    for (const model of ['AudioTrack', 'AudioSeries']) {
      const body = new RegExp(`model ${model} \\{[\\s\\S]*?\\n\\}`, 'u').exec(
        schema,
      )?.[0];
      expect(body, model).toBeDefined();
      const fields = (body ?? '')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => /^[a-z]\w*\s/u.test(line))
        .map((line) => line.split(/\s+/u)[0] ?? '');
      for (const field of fields) {
        expect(field, `${model}.${field}`).not.toMatch(
          /surah|ayah|juz|recit|quran|kind/iu,
        );
      }
    }
    // No Recitation model exists before Quran ships it.
    expect(schema).not.toMatch(/^model Recitation/mu);
  });

  it('keeps Media free of any Quran dependency', async () => {
    const files = (await walk('apps/web/src/contexts/media')).filter((file) =>
      file.endsWith('.ts'),
    );
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      expect(uncommented(await read(file)), file).not.toMatch(
        /contexts\/quran|contracts\/quran/u,
      );
    }
  });

  it('fills /listen/recitations only from Quran, never from an AudioTrack', async () => {
    // Phase 11 delivered no recitation catalogue; Phase 18 delivered it as a
    // Layer-4 projection of Quran's PUBLIC reader (DOMAIN_MODEL.md §8.1). The
    // route is the only Listen page that names a recitation, and it reaches no
    // Media composition, context or contract — so an AudioTrack can never fill it.
    const listen = await walk('apps/web/src/app/[locale]/(public)/listen');
    expect(listen.filter((entry) => entry.endsWith('page.tsx')).sort()).toEqual([
      'apps/web/src/app/[locale]/(public)/listen/lectures/[slug]/page.tsx',
      'apps/web/src/app/[locale]/(public)/listen/lectures/page.tsx',
      'apps/web/src/app/[locale]/(public)/listen/page.tsx',
      'apps/web/src/app/[locale]/(public)/listen/recitations/page.tsx',
      'apps/web/src/app/[locale]/(public)/listen/series/[slug]/page.tsx',
      'apps/web/src/app/[locale]/(public)/listen/series/page.tsx',
    ]);

    const recitations = uncommented(
      await read('apps/web/src/app/[locale]/(public)/listen/recitations/page.tsx'),
    );
    expect(recitations).toMatch(/composition\/quran-read/u);
    expect(recitations).not.toMatch(
      /composition\/media|contexts\/media|contracts\/media|components\/media\/listen/u,
    );
  });
});

describe('a track’s bytes need BOTH owners, and the public path holds no session', () => {
  it('builds the public byte route on an Identity-free composition', async () => {
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

  it('re-checks a live permission on the preview route, and nowhere else serves drafts', async () => {
    const preview = uncommented(await read(PREVIEW_BYTES));
    expect(preview).toContain("requirePermittedAction('en', 'media.administer')");
    expect(preview).toContain('mediaPreviewAudioPolicy');

    const policy = uncommented(
      await read('apps/web/src/contexts/media/application/asset-policy.ts'),
    );
    // The public decision allows on publication alone; only the preview branch
    // consults an authority, and it asks for `media.administer`.
    expect(policy).toContain("relation.state === 'published'");
    expect(policy).toContain("'media.administer'");
  });

  it('decides the Range only AFTER Storage and Media have released the asset', async () => {
    const serve = code(await read(SERVE));
    const opened = serve.indexOf('storage.open(');
    const ranged = serve.indexOf('parseByteRange(');
    expect(opened).toBeGreaterThan(-1);
    expect(ranged).toBeGreaterThan(opened);
    // The body is streamed, never buffered, and never offered as a download.
    for (const forbidden of ['arrayBuffer', 'Buffer.concat', 'readFile', 'attachment']) {
      expect(uncommented(await read(SERVE)), forbidden).not.toContain(forbidden);
    }
  });

  it('offers no download purpose at all', async () => {
    const routes = await walk('apps/web/src/app/assets/media');
    expect(routes.some((entry) => /download/iu.test(entry))).toBe(false);
  });
});

describe('the one large browser upload is a Class-A route, and changes nothing else', () => {
  it('accepts POST and nothing else', async () => {
    const source = uncommented(await read(UPLOAD));
    expect(source).toMatch(/export\s+async\s+function\s+POST\b/u);
    for (const verb of ['GET', 'PUT', 'PATCH', 'DELETE']) {
      expect(source, verb).not.toMatch(
        new RegExp(`export\\s+(async\\s+)?function\\s+${verb}\\b`),
      );
    }
  });

  it('checks origin and intent, then the session, then the size — before reading a byte', async () => {
    const source = code(await read(UPLOAD));
    const origin = source.indexOf('isSameOriginMutation(');
    const session = source.indexOf('requirePermittedAction(');
    const length = source.indexOf('length > AUDIO_UPLOAD_MAX_BYTES');
    const limit = source.indexOf('consumeMediaUpload(');
    const stored = source.indexOf('uploadAudio(');
    expect(origin).toBeGreaterThan(-1);
    expect(session).toBeGreaterThan(origin);
    expect(length).toBeGreaterThan(session);
    expect(limit).toBeGreaterThan(length);
    expect(stored).toBeGreaterThan(limit);
    // The body is streamed straight into Storage, never materialised.
    for (const buffering of [
      'arrayBuffer(',
      'formData(',
      '.blob(',
      '.text(',
      'request.json(',
    ]) {
      expect(source, buffering).not.toContain(buffering);
    }
  });

  it('compares Origin to the configured origin, and honours Fetch Metadata', async () => {
    const guard = uncommented(await read('apps/web/src/composition/same-origin.ts'));
    expect(guard).toContain("request.method !== 'POST'");
    expect(guard).toContain('origin === null || origin !== applicationOrigin()');
    expect(guard).toContain("site !== null && site !== 'same-origin'");
    expect(guard).toContain('request.headers.get(intent.header) === intent.value');
  });

  it('does not raise the global Server Action body cap', async () => {
    const config = uncommented(await read('apps/web/next.config.ts'));
    expect(config).not.toContain('bodySizeLimit');
    expect(config).not.toContain('serverActions');
  });

  it('widens no Content-Security-Policy for audio', async () => {
    const config = uncommented(await read('apps/web/next.config.ts'));
    // First-party bytes need nothing beyond `default-src 'self'`.
    expect(config).not.toContain('media-src');
    expect(config).not.toContain('/listen');
  });

  it('adds no player, waveform, transcoder or media-framework dependency', async () => {
    const manifests = [
      'package.json',
      'apps/web/package.json',
      'packages/storage/package.json',
      'packages/contracts/package.json',
    ];
    for (const manifest of manifests) {
      const source = await read(manifest);
      for (const forbidden of [
        'howler',
        'wavesurfer',
        'plyr',
        'video.js',
        'ffmpeg',
        'fluent-ffmpeg',
        'music-metadata',
        'busboy',
        'formidable',
        'multer',
        '@aws-sdk',
      ]) {
        expect(source, `${manifest} depends on ${forbidden}`).not.toContain(
          `"${forbidden}`,
        );
      }
    }
    await expect(stat(path.join(repoRoot, UPLOAD))).resolves.toBeDefined();
  });
});
