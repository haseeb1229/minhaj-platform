import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  PERMISSION_CATALOGUE,
  STEP_UP_PURPOSES,
} from '../../packages/contracts/src/identity/index.ts';
import { repoRoot } from './architecture-harness.ts';

/**
 * Phase 18 boundaries — the Quran context, its canonical text, and the owners
 * that must never reach it.
 *
 * THE FAILURES THIS FILE EXISTS TO PREVENT, each of which would pass every
 * behavioural test on the day it was introduced:
 *
 *   - a second write path to canonical Arabic — a Prisma `ayah.update`, a raw
 *     `UPDATE [Ayah]`, a persistence method that writes text — appearing beside
 *     the two procedures that re-check authority in SQL;
 *   - Quran content (a Surah, an Ayah, a name, a count) arriving in a migration
 *     or a seed, so a deployment that has no authoritative source still holds a
 *     corpus;
 *   - Media, Library or Editorial learning about Quran, or Quran about them, so
 *     a Recitation could be authored as an AudioTrack or scripture through a CMS;
 *   - canonical text reaching the Tiptap editor, a download, or a generator;
 *   - the public reader acquiring a session.
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
    if (entry.isDirectory()) found.push(...(await walk(relative)));
    else found.push(relative);
  }
  return found;
}

const sources = async (directory: string) =>
  (await walk(directory)).filter((file) => /\.(?:ts|tsx)$/u.test(file));

const MIGRATION =
  'packages/database/prisma/migrations/20261002000000_phase18_quran/migration.sql';
const ADAPTER = 'packages/database/src/adapters/quran';
const CONTEXT = 'apps/web/src/contexts/quran';
const PUBLIC = 'apps/web/src/app/[locale]/(public)/quran';
const ADMIN = 'apps/web/src/app/[locale]/admin/quran';

describe('canonical Arabic has exactly one write path', () => {
  it('writes canonical tables only through the two authority-checking procedures', async () => {
    const files = await sources(ADAPTER);
    expect(files.length).toBeGreaterThan(0);

    const all = (await Promise.all(files.map(read))).map(uncommented).join('\n');
    // No Prisma delegate write to a canonical, source or activation model. A
    // Surah is absent from this list only because its display-name version is
    // the one column the runtime may advance — the grant, not this test, is
    // what confines that update to it.
    expect(all).not.toMatch(
      /\.(?:ayah|juz|quranAyahRevision|quranVerificationRun|quranSource|quranSourceSurah|quranSourceAyah|quranActivation)\s*\.\s*(?:create|createMany|update|updateMany|upsert|delete|deleteMany)\b/u,
    );
    // No raw DML against them either.
    expect(all).not.toMatch(
      /(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|MERGE)\s+(?:\[dbo\]\.)?\[?(?:Ayah|Juz|QuranAyahRevision|QuranVerificationRun|QuranSource|QuranSourceSurah|QuranSourceAyah|QuranActivation)\]?\s/iu,
    );
    // The procedures are the path.
    expect(all).toMatch(/QuranAcceptCorpus/u);
    expect(all).toMatch(/QuranCorrectAyah/u);
  });

  it('gives the ordinary persistence port no method that writes canonical text', async () => {
    const ports = code(await read('packages/contracts/src/quran/ports.ts'));
    const persistence = /interface QuranPersistencePort \{([\s\S]*?)\n\}/u.exec(
      ports,
    )?.[1];
    expect(persistence).toBeDefined();
    const methods = [...(persistence ?? '').matchAll(/^\s{2}(\w+)\(/gmu)].map(
      (m) => m[1],
    );
    expect(methods.length).toBeGreaterThan(0);
    for (const method of methods) {
      expect(method, method).not.toMatch(
        /^(?:save|update|set|create|correct|accept).*Ayah(?!Topic)/u,
      );
      // Reads of the canonical position (`corpusStatus`) are expected; any
      // method that would accept, correct, activate or materialise is not.
      expect(method, method).not.toMatch(
        /^(?:accept|correct|activate|materiali[sz]e)(?!.*Preview$)/iu,
      );
    }
  });

  it('grants the runtime principal no write on canonical, source or activation tables', async () => {
    const grants = await read(
      'packages/database/sql/permissions/grant-application-principal.sql',
    );
    for (const table of [
      'QuranSource',
      'QuranSourceSurah',
      'QuranSourceAyah',
      'QuranActivation',
      'Juz',
      'Ayah',
      'QuranAyahRevision',
      'QuranVerificationRun',
    ]) {
      const line = grants
        .split('\n')
        .find((entry) => entry.includes(`OBJECT_ID(N'[dbo].[${table}]',N'U')`));
      expect(line, table).toBeDefined();
      expect(line, table).toMatch(
        new RegExp(`GRANT SELECT ON OBJECT::\\[dbo\\]\\.\\[${table}\\] TO`, 'u'),
      );
      expect(line, table).toMatch(/DENY INSERT, UPDATE, DELETE, ALTER/u);
    }
    expect(grants).toMatch(
      /DENY EXECUTE ON OBJECT::\[dbo\]\.\[QuranAssertCanonicalAuthority\]/u,
    );
  });

  it('re-checks permission and a purpose-bound step-up grant inside the database', async () => {
    const migration = await read(MIGRATION);
    const assert =
      /CREATE PROCEDURE \[dbo\]\.\[QuranAssertCanonicalAuthority\]([\s\S]*?)END;/u.exec(
        migration,
      )?.[1];
    expect(assert).toBeDefined();
    expect(assert).toMatch(/quran\.editCanonical/u);
    expect(assert).toMatch(/quran-canonical-edit/u);
    expect(assert).toMatch(/revokedAt IS NULL/u);
    expect(assert).toMatch(/deactivatedAt IS NULL/u);
    expect(assert).toMatch(/expiresAt > SYSUTCDATETIME\(\)/u);
    for (const procedure of ['QuranAcceptCorpus', 'QuranCorrectAyah']) {
      const body = new RegExp(
        `CREATE PROCEDURE \\[dbo\\]\\.\\[${procedure}\\]([\\s\\S]*?)\\nEND;`,
        'u',
      ).exec(migration)?.[1];
      expect(body, procedure).toBeDefined();
      expect(body, procedure).toMatch(/EXEC \[dbo\]\.\[QuranAssertCanonicalAuthority\]/u);
      // Exact comparison: bytes, never a collation.
      expect(body, procedure).toMatch(/VARBINARY/u);
      expect(body, procedure).not.toMatch(/COLLATE/u);
    }
  });
});

describe('no Quran content exists in the repository', () => {
  it('seeds no source, structure, text or activation in the migration', async () => {
    const migration = await read(MIGRATION);
    // Procedure bodies are created through sp_executesql and copy FROM a
    // registered source at run time; outside them nothing is inserted into a
    // Quran table at all.
    const outside = migration.replace(/EXEC sp_executesql N'[\s\S]*?';\n/gu, '');
    expect(outside).not.toMatch(
      /INSERT INTO \[dbo\]\.\[(?:Quran\w*|Surah\w*|Ayah|Juz)\]/u,
    );
    expect(outside).toMatch(/INSERT INTO \[dbo\]\.\[Permission\]/u);
  });

  it('carries no corpus constant: no Surah names table, no ayah-count list', async () => {
    const files = [
      ...(await sources('packages/contracts/src/quran')),
      ...(await sources(CONTEXT)),
      ...(await sources(ADAPTER)),
    ];
    for (const file of files) {
      const source = code(await read(file));
      // A list of 114 or 30 numbers would be a corpus fact written from memory.
      expect(source.match(/\b\d{1,3}\s*,/gu)?.length ?? 0, file).toBeLessThan(40);
    }
  });
});

describe('Quran is its own context and nobody else authors it', () => {
  it('imports no Media, Library, Editorial or Hadith context or contract', async () => {
    for (const file of await sources(CONTEXT)) {
      expect(uncommented(await read(file)), file).not.toMatch(
        /contexts\/(?:media|library|editorial|hadith|fatwa|learning)|contracts\/(?:media|library|editorial)|@minhaj\/contracts\/(?:media|library|editorial)/u,
      );
    }
  });

  it('is imported by no other context', async () => {
    for (const context of [
      'media',
      'library',
      'editorial',
      'people-contributors',
      'taxonomy',
      'global-network',
    ]) {
      for (const file of await sources(`apps/web/src/contexts/${context}`)) {
        expect(uncommented(await read(file)), file).not.toMatch(
          /contexts\/quran|@minhaj\/contracts\/quran|contracts\/src\/quran/u,
        );
      }
    }
  });

  it('keeps the recitation in Quran: Media has no recitation model or field', async () => {
    const schema = await read('packages/database/prisma/schema.prisma');
    expect(schema).toMatch(/^model QuranRecitation \{/mu);
    expect(schema).toMatch(/^model QuranRecitationSegment \{/mu);
    const audio = /model AudioTrack \{[\s\S]*?\n\}/u.exec(schema)?.[0] ?? '';
    expect(audio).not.toMatch(/recit|surah|ayah|quran/iu);
  });
});

describe('canonical text is never edited like ordinary content', () => {
  it('reaches no rich-text editor, generator or download from Quran administration', async () => {
    for (const file of await sources(ADMIN)) {
      const source = uncommented(await read(file));
      expect(source, file).not.toMatch(/@tiptap|editorial\/editor|RichText/u);
      expect(source, file).not.toMatch(/openai|anthropic|@ai-sdk|generateText/iu);
      expect(source, file).not.toMatch(/\bdownload\b=/u);
    }
  });

  it('serves recitation audio inline, never as a download', async () => {
    for (const file of await sources('apps/web/src/app/assets/quran')) {
      expect(uncommented(await read(file)), file).not.toMatch(/attachment/u);
    }
  });
});

describe('the public Quran reader holds no session', () => {
  it('reads no session, cookie or authorisation in the public tree', async () => {
    const files = [
      ...(await sources(PUBLIC)),
      ...(await sources('apps/web/src/components/quran')),
      'apps/web/src/app/[locale]/(public)/listen/recitations/page.tsx',
      'apps/web/src/composition/quran-read.ts',
    ];
    expect(files.length).toBeGreaterThan(2);
    for (const file of files) {
      const source = code(await read(file));
      expect(source, file).not.toMatch(
        /composition\/(?:identity|authorization)|cookies\(|headers\(\)\.get\('cookie'\)|server-core\/session/u,
      );
    }
  });
});

describe('the vocabulary is exactly what the documents name', () => {
  it('mints three Quran keys and nothing per work', () => {
    expect(
      PERMISSION_CATALOGUE.map((entry) => entry.key)
        .filter((key) => key.startsWith('quran.'))
        .sort(),
    ).toEqual(['quran.administer', 'quran.editCanonical', 'quran.read']);
  });

  it('adds one step-up purpose, for canonical Quran edits alone', () => {
    expect([...STEP_UP_PURPOSES]).toEqual([
      'privilege-administration',
      'account-administration',
      'second-factor',
      'quran-canonical-edit',
    ]);
  });
});
