import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * REBASELINE R1 — THE SHIPPED TYPEFACES.
 *
 * The owner approved self-hosted OPEN-LICENCE faces (2026-11-06). That approval
 * is narrow, and this test holds it there: exactly one module declares fonts,
 * only through `next/font/local`; nothing fetches a face from Google or any other
 * origin; every shipped file sits beside the SIL Open Font License 1.1 text; and
 * no face of unclear licence, nor a Quran face before an approved corpus, is
 * shipped.
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = path.join(repoRoot, 'apps/web/src');
const FONTS_MODULE = 'apps/web/src/styles/fonts.ts';
const FONTS_DIR = path.join(SRC, 'styles/fonts');

async function filesUnder(directory: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const child = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...(await filesUnder(child)));
    else found.push(child);
  }
  return found;
}

const relative = (file: string) =>
  path.relative(repoRoot, file).split(path.sep).join('/');

describe('the shipped typefaces', () => {
  it('are declared in exactly one module, through next/font/local only', async () => {
    const importers: string[] = [];
    for (const file of await filesUnder(SRC)) {
      if (!/\.(ts|tsx|css)$/.test(file)) continue;
      const source = await readFile(file, 'utf8');
      expect(source, relative(file)).not.toContain('next/font/google');
      expect(source, relative(file)).not.toMatch(/fonts\.googleapis|fonts\.gstatic/);
      if (/from ['"]next\/font\//.test(source)) importers.push(relative(file));
    }
    expect(importers).toEqual([FONTS_MODULE]);
    const module = await readFile(path.join(repoRoot, FONTS_MODULE), 'utf8');
    expect(module).toContain("import localFont from 'next/font/local';");
  });

  it('reference only files that exist, each beside its OFL licence text', async () => {
    const module = await readFile(path.join(repoRoot, FONTS_MODULE), 'utf8');
    const referenced = [...module.matchAll(/'\.\/(fonts\/[^']+\.woff2)'/g)].map(
      (m) => m[1]!,
    );
    expect(referenced.length).toBeGreaterThanOrEqual(5);

    for (const file of referenced) {
      const absolute = path.join(SRC, 'styles', file);
      expect((await stat(absolute)).size, file).toBeGreaterThan(1000);
      const licence = await readFile(
        path.join(path.dirname(absolute), 'OFL.txt'),
        'utf8',
      );
      expect(licence, file).toContain('SIL OPEN FONT LICENSE Version 1.1');
    }

    // Nothing shipped that the module does not declare.
    const shipped = (await filesUnder(FONTS_DIR))
      .filter((file) => file.endsWith('.woff2'))
      .map((file) =>
        path.relative(path.join(SRC, 'styles'), file).split(path.sep).join('/'),
      );
    expect(shipped.sort()).toEqual([...referenced].sort());
  });

  it('ships no face of unclear licence and no Quran face before an approved corpus', async () => {
    const names = (await filesUnder(FONTS_DIR)).map((file) =>
      relative(file).toLowerCase(),
    );
    for (const forbidden of ['jameel', 'noori', 'kfgqpc', 'uthman', 'quran', 'amiri']) {
      expect(
        names.some((name) => name.includes(forbidden)),
        forbidden,
      ).toBe(false);
    }
  });

  it('preloads only the Latin faces, so an English page never downloads an Arabic-script face it does not show', async () => {
    const module = await readFile(path.join(repoRoot, FONTS_MODULE), 'utf8');
    const blocks = module.split('localFont(').slice(1);
    const preloadOf = (needle: string) =>
      /preload:\s*(true|false)/.exec(
        blocks.find((block) => block.includes(needle)) ?? '',
      )?.[1];
    expect(preloadOf('newsreader')).toBe('true');
    expect(preloadOf('instrument-sans')).toBe('true');
    expect(preloadOf('gulzar')).toBe('false');
    expect(preloadOf('noto-naskh-arabic')).toBe('false');
  });
});
