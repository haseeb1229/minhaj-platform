import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { repoRoot } from '../architecture/architecture-harness.ts';
import ar from '../../apps/web/messages/ar.json';
import en from '../../apps/web/messages/en.json';
import ur from '../../apps/web/messages/ur.json';

/**
 * R2, audit F15 — every administrative page names itself.
 *
 * The admin layout's title template ("%s · Administration · One Minhaj") is
 * only worth anything if each page hands it a name of its own, and a page's
 * name must never cost its noindex: the helper both pages and this test rely
 * on returns the two together.
 *
 * `getTranslations` is replaced by a plain lookup in the real catalogues — a
 * page title is a plain message — so what is proved is the message each page
 * names, in each locale. A key that is missing, or names a group rather than a
 * message, throws, as the real translator's strict mode would.
 */
const CATALOGUES: Record<string, unknown> = { en, ur, ar };

function messageAt(locale: string, dotted: string): string {
  const message = dotted
    .split('.')
    .reduce<unknown>(
      (node, part) =>
        typeof node === 'object' && node !== null
          ? (node as Record<string, unknown>)[part]
          : undefined,
      CATALOGUES[locale],
    );
  if (typeof message !== 'string') throw new Error(`No ${locale} message ${dotted}`);
  return message;
}

vi.mock('next-intl/server', () => ({
  getTranslations: ({
    locale,
    namespace,
  }: {
    readonly locale: string;
    readonly namespace: string;
  }) => Promise.resolve((key: string) => messageAt(locale, `${namespace}.${key}`)),
}));

// `notFound()` throws in Next as here; the stand-in only spares the runner
// React's client entry, which the framework's navigation module pulls in.
const NOT_FOUND = new Error('NEXT_NOT_FOUND');
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw NOT_FOUND;
  },
}));

const { adminPageMetadata } =
  await import('../../apps/web/src/app/[locale]/admin/metadata.ts');

const params = (locale: string) => Promise.resolve({ locale });

describe('adminPageMetadata', () => {
  it('names the page from its own heading message, in each interface locale', async () => {
    const generate = adminPageMetadata('admin', 'users.title');

    await expect(generate({ params: params('en') })).resolves.toEqual({
      title: en.admin.users.title,
      robots: { index: false, follow: false },
    });
    await expect(generate({ params: params('ur') })).resolves.toMatchObject({
      title: ur.admin.users.title,
    });
    await expect(generate({ params: params('ar') })).resolves.toMatchObject({
      title: ar.admin.users.title,
    });
  });

  it('reads a nested namespace, and a record page’s kind name', async () => {
    await expect(
      adminPageMetadata('admin.global', 'surface.centres')({ params: params('en') }),
    ).resolves.toMatchObject({ title: 'Centres' });
    await expect(
      adminPageMetadata('admin', 'titles.hadith.book')({ params: params('ar') }),
    ).resolves.toMatchObject({ title: ar.admin.titles.hadith.book });
  });

  it('keeps every page unindexed, whatever it is called', async () => {
    const metadata = await adminPageMetadata(
      'quranAdmin',
      'surface.surahs',
    )({ params: params('ur') });

    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(metadata.title).toBe(ur.quranAdmin.surface.surahs);
  });

  it('refuses a locale the platform does not serve, rather than naming the page', async () => {
    await expect(
      adminPageMetadata('admin', 'users.title')({ params: params('fr') }),
    ).rejects.toBe(NOT_FOUND);
  });
});

describe('every administrative page names itself', () => {
  /**
   * Pages that render no document of their own: each only redirects to the
   * area's first page the reader may open, so there is no tab to name. The
   * dashboard (`admin/page.tsx`) is the area itself, and the layout's absolute
   * title already names it.
   */
  const REDIRECT_ONLY = new Set([
    'fatwa/page.tsx',
    'learning/page.tsx',
    'messaging/page.tsx',
    // R2: every other area root sends the reader on (`admin/area-root.ts`).
    'communications/page.tsx',
    'editorial/page.tsx',
    'global/page.tsx',
    'hadith/page.tsx',
    'identity/page.tsx',
    'library/page.tsx',
    'media/page.tsx',
    'people/page.tsx',
    'quran/page.tsx',
    'system/page.tsx',
    'taxonomy/page.tsx',
  ]);

  it('gives each page a title of its own', async () => {
    const admin = path.join(repoRoot, 'apps/web/src/app/[locale]/admin');
    const entries = await readdir(admin, { recursive: true });
    const pages = entries
      .map((entry) => entry.replaceAll('\\', '/'))
      .filter((entry) => entry.endsWith('page.tsx') && entry !== 'page.tsx');

    expect(pages.length).toBeGreaterThan(140);

    const untitled: string[] = [];
    for (const page of pages) {
      if (REDIRECT_ONLY.has(page)) continue;
      const source = await readFile(path.join(admin, page), 'utf8');
      if (!/\bgenerateMetadata\b/.test(source)) untitled.push(page);
    }
    expect(untitled).toEqual([]);
  });

  it('names each page with a plain message present in every interface locale', async () => {
    const admin = path.join(repoRoot, 'apps/web/src/app/[locale]/admin');
    const entries = await readdir(admin, { recursive: true });
    const named: { page: string; dotted: string }[] = [];
    for (const entry of entries) {
      if (!entry.endsWith('page.tsx')) continue;
      const source = await readFile(path.join(admin, entry), 'utf8');
      const call = /adminPageMetadata\(\s*'([^']+)',\s*'([^']+)',?\s*\)/u.exec(source);
      if (call !== null) named.push({ page: entry, dotted: `${call[1]}.${call[2]}` });
    }

    expect(named.length).toBeGreaterThan(140);
    for (const { page, dotted } of named) {
      for (const locale of ['en', 'ur', 'ar']) {
        const title = messageAt(locale, dotted);
        expect(title.trim(), `${page} (${locale})`).not.toBe('');
        // A title takes no arguments: there is no record read to fill one.
        expect(title, `${page} (${locale})`).not.toMatch(/[{}]/u);
      }
    }
  });
});
