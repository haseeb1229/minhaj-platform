import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  AssetAuthorizationPort,
  AssetStream,
  StorageServicePort,
} from '../../packages/contracts/src/platform/storage.ts';

const requested: string[] = [];
vi.mock('@/composition/storage-derivatives', () => ({
  requestDerivation: (assetId: string) => {
    requested.push(assetId);
  },
}));

const { serveDerivative, DERIVATIVE_CACHE_CONTROL } =
  await import('../../apps/web/src/app/assets/derivative.ts');
const { derivativeSources, derivativeWidthOf, publicImage } =
  await import('../../apps/web/src/components/ui/image-derivatives.ts');
const { ResponsiveImage } = await import('../../apps/web/src/components/ui/image.tsx');

/**
 * Rebaseline R2 — serving and emitting a public picture's WebP derivatives.
 *
 * The cache class is the security claim here: `public, max-age=31536000,
 * immutable` only on a derivative both owners would serve now, and the same
 * `404`, `private, no-store` for every refusal — so withdrawal is the address
 * disappearing and the route refusing it, never a stale shared copy.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SOURCE = '/assets/editorial/news-article/rec-1/asset-1';
const allow: AssetAuthorizationPort = { decide: () => Promise.resolve('allow') };

function storageAnswering(answer: AssetStream | 'not-derived' | null) {
  const calls: { assetId: string; width: number }[] = [];
  const storage = {
    openDerivative: async (assetId: string, width: number) => {
      calls.push({ assetId, width });
      return answer;
    },
  } as unknown as StorageServicePort;
  return { storage, calls };
}

const stream: AssetStream = {
  mediaType: 'image/webp',
  byteSize: 3,
  checksum: 'c'.repeat(64),
  displayName: null,
  body: (async function* () {
    yield new Uint8Array([1, 2, 3]);
  })(),
  range: () => {
    throw new Error('never ranged');
  },
};

const request = (segment: string, headers: Record<string, string> = {}) =>
  new Request(`https://example.test${SOURCE}/${segment}`, { headers });

function expectRefusal(response: Response) {
  expect(response.status).toBe(404);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
}

describe('serving a derivative', () => {
  beforeEach(() => {
    requested.length = 0;
  });

  it('serves a cleared derivative as public, immutable, content-addressed bytes', async () => {
    const { storage, calls } = storageAnswering(stream);
    const response = await serveDerivative(
      storage,
      request('640w.webp'),
      'asset-1',
      '640w.webp',
      allow,
    );
    expect(calls).toEqual([{ assetId: 'asset-1', width: 640 }]);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe(
      'public, max-age=31536000, immutable',
    );
    expect(DERIVATIVE_CACHE_CONTROL).toBe('public, max-age=31536000, immutable');
    expect(response.headers.get('content-type')).toBe('image/webp');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('cross-origin-resource-policy')).toBe('same-origin');
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    expect(response.headers.get('etag')).toBe(`"${'c'.repeat(64)}"`);
    expect(response.headers.get('content-length')).toBe('3');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3]),
    );
  });

  it('confirms an unchanged copy only after both owners allowed', async () => {
    const { storage } = storageAnswering(stream);
    const response = await serveDerivative(
      storage,
      request('640w.webp', { 'if-none-match': `"${'c'.repeat(64)}"` }),
      'asset-1',
      '640w.webp',
      allow,
    );
    expect(response.status).toBe(304);

    const refused = storageAnswering(null);
    expectRefusal(
      await serveDerivative(
        refused.storage,
        request('640w.webp', { 'if-none-match': `"${'c'.repeat(64)}"` }),
        'asset-1',
        '640w.webp',
        allow,
      ),
    );
  });

  it('refuses a withdrawn, restricted or unknown source with one uncached 404', async () => {
    const { storage } = storageAnswering(null);
    const response = await serveDerivative(
      storage,
      request('640w.webp'),
      'asset-1',
      '640w.webp',
      allow,
    );
    expectRefusal(response);
    expect(response.headers.get('cache-control')).not.toContain('public');
    expect(requested).toEqual([]);
  });

  it('refuses a malformed or unrendered width without asking Storage', async () => {
    for (const segment of [
      '641w.webp',
      '0640w.webp',
      '640w.png',
      '640.webp',
      '640w.webp.js',
      '2880w.webp',
      '..',
    ]) {
      const { storage, calls } = storageAnswering(stream);
      expectRefusal(
        await serveDerivative(storage, request('x'), 'asset-1', segment, allow),
      );
      expect(calls).toEqual([]);
    }
  });

  it('sends a width not rendered yet to the picture itself, uncached, and asks for it', async () => {
    const { storage } = storageAnswering('not-derived');
    const response = await serveDerivative(
      storage,
      request('960w.webp'),
      'asset-1',
      '960w.webp',
      allow,
    );
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(SOURCE);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(requested).toEqual(['asset-1']);
  });
});

describe('emitting derivatives', () => {
  it('offers each width no wider than the picture, then the picture itself', () => {
    expect(derivativeSources(SOURCE, 1000)).toEqual([
      { src: `${SOURCE}/320w.webp`, width: 320 },
      { src: `${SOURCE}/640w.webp`, width: 640 },
      { src: `${SOURCE}/960w.webp`, width: 960 },
      { src: SOURCE, width: 1000 },
    ]);
    // A picture as wide as a derivative, or wider than the widest, needs no original.
    expect(derivativeSources(SOURCE, 960)?.at(-1)).toEqual({
      src: `${SOURCE}/960w.webp`,
      width: 960,
    });
    expect(derivativeSources(SOURCE, 4000)?.map((source) => source.width)).toEqual([
      320, 640, 960, 1440,
    ]);
  });

  it('offers nothing it cannot honestly serve', () => {
    expect(derivativeSources(SOURCE, 200)).toBeUndefined();
    expect(derivativeSources(SOURCE, null)).toBeUndefined();
    expect(derivativeSources(SOURCE, undefined)).toBeUndefined();
    for (const address of [
      '/assets/editorial/previews/news-article/rec-1/asset-1',
      '/assets/media/audio/track-1/asset-1',
      '/assets/library/editions/ed-1/readable/asset-1',
      '/assets/messaging/attachments/att-1',
      '/assets/1',
      'https://evil.example/assets/editorial/a/b/c',
      `${SOURCE}/640w.webp`,
    ])
      expect(derivativeSources(address, 2000), address).toBeUndefined();
    expect(publicImage('/assets/media/audio/t/a', 2000)).toEqual({
      path: '/assets/media/audio/t/a',
    });
  });

  it('every picture route it emits for has a derivative route beside it', () => {
    const app = path.join(repoRoot, 'apps', 'web', 'src', 'app');
    const pictures = [
      ['assets/editorial/[family]/[recordId]/[assetId]', '/assets/editorial/a/b/c'],
      [
        'assets/library/covers/editions/[editionId]/[assetId]',
        '/assets/library/covers/editions/a/b',
      ],
      [
        'assets/library/covers/issues/[issueId]/[assetId]',
        '/assets/library/covers/issues/a/b',
      ],
      ['assets/media/photos/[photoId]/[assetId]', '/assets/media/photos/a/b'],
      ['assets/media/posters/[videoId]/[assetId]', '/assets/media/posters/a/b'],
      ['assets/people/portraits/[personId]/[assetId]', '/assets/people/portraits/a/b'],
    ] as const;
    for (const [route, example] of pictures) {
      const picture = readFileSync(path.join(app, route, 'route.ts'), 'utf8');
      const derivative = path.join(app, route, '[derivative]', 'route.ts');
      expect(existsSync(derivative), route).toBe(true);
      const source = readFileSync(derivative, 'utf8');
      // The SAME policy factory the picture route builds, and no session.
      const policy = /import \{ (\w+Policy) \} from '(@\/composition\/[\w-]+)'/.exec(
        picture,
      );
      expect(policy, route).not.toBeNull();
      expect(source).toContain(
        `import { ${policy?.[1] ?? ''} } from '${policy?.[2] ?? ''}'`,
      );
      const imports = source.split('\n').filter((line) => line.startsWith('import '));
      expect(imports).toHaveLength(3);
      expect(imports.join('\n')).not.toMatch(/identity|session|next\/headers/i);
      expect(derivativeSources(example, 2000)).toBeDefined();
    }
    expect(derivativeWidthOf('1440w.webp')).toBe(1440);
  });

  it('a public picture primitive carries its srcset automatically', () => {
    const img = (element: unknown): { props: Record<string, unknown> } | undefined => {
      const node = element as { type?: unknown; props?: { children?: unknown } } | null;
      if (node === null || typeof node !== 'object') return undefined;
      if (node.type === 'img') return node as { props: Record<string, unknown> };
      return img(node.props?.children);
    };
    const pictured = img(
      ResponsiveImage({ path: SOURCE, alt: '', aspect: '16/9', width: 700, height: 400 }),
    );
    expect(pictured?.props.srcSet).toBe(
      `${SOURCE}/320w.webp 320w, ${SOURCE}/640w.webp 640w, ${SOURCE} 700w`,
    );
    expect(pictured?.props.src).toBe(SOURCE);
    const unmeasured = img(ResponsiveImage({ path: SOURCE, alt: '', aspect: '16/9' }));
    expect(unmeasured?.props.srcSet).toBeUndefined();
  });
});
