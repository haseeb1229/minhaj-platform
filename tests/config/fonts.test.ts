import { createHash } from 'node:crypto';
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
 * no face of unclear licence is shipped. The one Quran face (R2, the staging
 * reference preview) is SIL's own Scheherazade New file, applied to Quran text
 * alone.
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

  it('ships no face of unclear licence, and no Quran face but SIL’s Scheherazade New', async () => {
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

  it('ships the Quran face as SIL released it, with its reserved names in the licence', async () => {
    // R2 (the staging reference preview): Scheherazade New 4.500, SIL Global's
    // own `web/ScheherazadeNew-Regular.woff2`, byte for byte. A different file
    // is a different (or modified) font and needs its own licence review.
    const directory = path.join(FONTS_DIR, 'scheherazade-new');
    const face = await readFile(path.join(directory, 'ScheherazadeNew-Regular.woff2'));
    expect(createHash('sha256').update(face).digest('hex')).toBe(
      'fd12c322cd8a0033d5c30b0a9fc0432e1d51288cd065f3f04a85a7974f1de3b7',
    );
    const licence = await readFile(path.join(directory, 'OFL.txt'), 'utf8');
    expect(licence).toContain('Reserved Font Names "Scheherazade" and "SIL"');
  });

  it('sets the Quran face on Quran text alone, never on interface Arabic', async () => {
    const module = await readFile(path.join(repoRoot, FONTS_MODULE), 'utf8');
    expect(module).toContain("variable: '--font-face-quran'");
    const css = await readFile(path.join(SRC, 'styles/globals.css'), 'utf8');
    // Defined once as a role, and applied by exactly one rule: Quran text
    // (`.quran-text`) and — R2, the reader redesign — what a Quran page sets
    // beside it in the same face (`.quran-name`: a Surah's Arabic name and the
    // presentational ayah-end mark). Never a bare `[lang|='ar']` selector.
    const uses = [...css.matchAll(/var\(--font-quran\)/g)];
    expect(uses).toHaveLength(1);
    const rule = css.slice(css.lastIndexOf('}', uses[0]!.index) + 1, uses[0]!.index);
    expect(rule.trim()).toMatch(
      /^(?:\/\*[\s\S]*?\*\/\s*)?\[lang\|='ar'\]:is\(\.quran-text, \.quran-name\) \{\s*font-family:$/,
    );
    expect(css).not.toMatch(/var\(--font-face-quran\)[\s\S]*var\(--font-face-quran\)/);

    // Applied in markup only where Quran text is rendered, and always with
    // `translate="no"` so a page translator leaves scripture alone.
    const appliers: string[] = [];
    for (const file of await filesUnder(SRC)) {
      if (!/\.tsx$/.test(file)) continue;
      const source = await readFile(file, 'utf8');
      if (!source.includes('quran-text')) continue;
      appliers.push(relative(file));
      expect(source, relative(file)).toMatch(/translate[=:]\s*['"{]*no/);
    }
    expect(appliers.sort()).toEqual([
      'apps/web/src/app/[locale]/(public)/search/page.tsx',
      // Quran Part 1: the reading-mode sheet shows the Ayah it was opened on.
      'apps/web/src/components/quran/reader-controls.tsx',
      'apps/web/src/components/quran/reader.tsx',
      'apps/web/src/components/quran/scripture.tsx',
      'apps/web/src/components/quran/search.tsx',
    ]);

    // The Quran face's other use stays on Quran pages: names and marks only.
    const named: string[] = [];
    for (const file of await filesUnder(SRC)) {
      if (!/\.tsx$/.test(file)) continue;
      if ((await readFile(file, 'utf8')).includes('quran-name'))
        named.push(relative(file));
    }
    expect(named.sort()).toEqual([
      // Quran Part 3: each Juz card's opening words and Arabic Surah names.
      'apps/web/src/components/quran/juz-index-island.tsx',
      'apps/web/src/components/quran/reader.tsx',
      'apps/web/src/components/quran/scripture.tsx',
      // Quran Part 2: each Surah index row's Arabic name.
      'apps/web/src/components/quran/surah-index-island.tsx',
    ]);
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
    expect(preloadOf('scheherazade-new')).toBe('false');
  });
});
