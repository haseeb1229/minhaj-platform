import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  PERMISSION_CATALOGUE,
  STEP_UP_PURPOSES,
} from '../../packages/contracts/src/identity/index.ts';
import { repoRoot } from './architecture-harness.ts';

/**
 * Phase 19 boundaries — the Hadith context, its sourced records, and the
 * owners that must never reach it.
 *
 * THE FAILURES THIS FILE EXISTS TO PREVENT, each of which would pass every
 * behavioural test on the day it was introduced:
 *
 *   - a second write path to a sourced fact — a Prisma `hadith.update`, a raw
 *     `UPDATE [Hadith]`, a persistence method that writes a record, a grading
 *     or a citation — appearing beside the procedures that re-check authority
 *     in SQL;
 *   - Hadith content (a collection, a record, a grading) arriving in a
 *     migration or a seed, so a deployment with no registered source still
 *     holds a corpus;
 *   - a Narrator aggregate, route or People link appearing, so a chain stops
 *     being the source's own text and becomes the platform's inference;
 *   - the Quran, Media, Library, Editorial, Fatwa or Learning learning about
 *     Hadith, or Hadith about them;
 *   - sourced text reaching the Tiptap editor, a download, or a generator;
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
  'packages/database/prisma/migrations/20261003000000_phase19_hadith/migration.sql';
const ADAPTER = 'packages/database/src/adapters/hadith';
const CONTEXT = 'apps/web/src/contexts/hadith';
const PUBLIC = 'apps/web/src/app/[locale]/(public)/hadith';
const ADMIN = 'apps/web/src/app/[locale]/admin/hadith';
const SCHEMA = 'packages/database/prisma/schema.prisma';

/** The procedures the runtime may execute — the one canonical write path. */
const CANONICAL_PROCEDURES = [
  'HadithCreateCollection',
  'HadithCreateBook',
  'HadithCreateChapter',
  'HadithWriteRecord',
  'HadithVerifyRecord',
  'HadithSetCitation',
] as const;

/** Called only from inside those procedures; the runtime may not execute them. */
const INTERNAL_PROCEDURES = [
  'HadithAssertCanonicalAuthority',
  'HadithDetectConflicts',
] as const;

/** Sourced or operator-registered tables with no runtime write at all. */
const SEALED_TABLES = [
  'HadithSourceSystem',
  'HadithEdition',
  'HadithActivation',
  'Hadith',
  'HadithRevision',
  'HadithGrading',
  'HadithVerification',
  'HadithCitation',
  'HadithCitationRevision',
  'HadithConflict',
] as const;

/**
 * Canonical structure. The runtime may advance only the display-name version
 * column of these — the grant confines that, column by column — and may never
 * insert or delete a row.
 */
const STRUCTURE_TABLES = ['HadithCollection', 'HadithBook', 'HadithChapter'] as const;

const delegate = (table: string) => `${table[0]!.toLowerCase()}${table.slice(1)}`;

/** A procedure's body as the migration creates it. */
function procedure(migration: string, name: string): string | undefined {
  return new RegExp(
    `CREATE PROCEDURE \\[dbo\\]\\.\\[${name}\\]([\\s\\S]*?)\\nEND;`,
    'u',
  ).exec(migration)?.[1];
}

/** Every `model Name { … }` block of the schema whose name matches. */
function models(schema: string, name: RegExp): Map<string, string> {
  const found = new Map<string, string>();
  for (const match of schema.matchAll(/^model (\w+) \{([\s\S]*?)\n\}/gmu))
    if (name.test(match[1]!)) found.set(match[1]!, match[2]!);
  return found;
}

/** A schema block without its `///` documentation and `//` comments. */
const undocumented = (block: string) => block.replace(/\/\/.*$/gmu, '');

describe('sourced Hadith facts have exactly one write path', () => {
  it('writes canonical and source tables only through the authority-checking procedures', async () => {
    const files = await sources(ADAPTER);
    expect(files.length).toBeGreaterThan(0);
    const all = (await Promise.all(files.map(read))).map(uncommented).join('\n');

    // No Prisma delegate write to a sealed model at all.
    const sealed = SEALED_TABLES.map(delegate).join('|');
    expect(all).not.toMatch(
      new RegExp(
        `\\.(?:${sealed})\\s*\\.\\s*(?:create|createMany|update|updateMany|upsert|delete|deleteMany)\\b`,
        'u',
      ),
    );
    // No Prisma row creation or deletion on canonical structure.
    const structure = STRUCTURE_TABLES.map(delegate).join('|');
    expect(all).not.toMatch(
      new RegExp(
        `\\.(?:${structure})\\s*\\.\\s*(?:create|createMany|upsert|delete|deleteMany)\\b`,
        'u',
      ),
    );
    // No raw DML against either.
    expect(all).not.toMatch(
      new RegExp(
        `(?:INSERT\\s+INTO|UPDATE|DELETE\\s+FROM|MERGE(?:\\s+INTO)?)\\s+(?:\\[dbo\\]\\.)?\\[?(?:${SEALED_TABLES.join('|')})\\]?\\s`,
        'iu',
      ),
    );
    expect(all).not.toMatch(
      new RegExp(
        `(?:INSERT\\s+INTO|DELETE\\s+FROM|MERGE(?:\\s+INTO)?)\\s+(?:\\[dbo\\]\\.)?\\[?(?:${STRUCTURE_TABLES.join('|')})\\]?\\s`,
        'iu',
      ),
    );
    // The procedures are the path, and the internal ones are never called.
    for (const name of CANONICAL_PROCEDURES)
      expect(all, name).toMatch(new RegExp(name, 'u'));
    for (const name of INTERNAL_PROCEDURES)
      expect(all, name).not.toMatch(new RegExp(name, 'u'));
  });

  it('gives the ordinary persistence port no method that writes a sourced fact', async () => {
    const ports = code(await read('packages/contracts/src/hadith/ports.ts'));
    const persistence = /interface HadithPersistencePort \{([\s\S]*?)\n\}/u.exec(
      ports,
    )?.[1];
    expect(persistence).toBeDefined();
    const methods = [...(persistence ?? '').matchAll(/^\s{2}(\w+)\(/gmu)].map(
      (m) => m[1]!,
    );
    expect(methods.length).toBeGreaterThan(0);
    for (const method of methods) {
      expect(method, method).not.toMatch(
        /^(?:save|update|set|create|correct|add|remove|delete)(?:Collection|Book|Chapter|Record|Hadith|Citation|Grading|Chain|Edition|SourceSystem|Activation|Verification|Conflict)s?$/u,
      );
      expect(method, method).not.toMatch(
        /^(?:activate|verify|correct|map|withdraw|register|resolve|accept)/iu,
      );
    }

    // The public reader writes nothing.
    const reader = /interface HadithPublicReaderPort \{([\s\S]*?)\n\}/u.exec(ports)?.[1];
    expect(reader).toBeDefined();
    for (const [, method] of (reader ?? '').matchAll(/^\s{2}(\w+)\(/gmu))
      expect(method, method).not.toMatch(
        /^(?:create|update|set|save|add|remove|delete)/u,
      );
  });

  it('grants the runtime principal no write on sealed tables and no internal procedure', async () => {
    const grants = await read(
      'packages/database/sql/permissions/grant-application-principal.sql',
    );
    const lineOf = (name: string, kind: 'U' | 'P') =>
      grants
        .split('\n')
        .find((entry) => entry.includes(`OBJECT_ID(N'[dbo].[${name}]',N'${kind}')`));

    for (const table of SEALED_TABLES) {
      const line = lineOf(table, 'U');
      expect(line, table).toBeDefined();
      expect(line, table).toMatch(
        new RegExp(`GRANT SELECT ON OBJECT::\\[dbo\\]\\.\\[${table}\\] TO`, 'u'),
      );
      expect(line, table).toMatch(/DENY INSERT, UPDATE, DELETE, ALTER/u);
      expect(line, table).not.toMatch(/GRANT (?:SELECT, )?(?:INSERT|UPDATE|DELETE)/u);
    }
    for (const table of STRUCTURE_TABLES) {
      const line = lineOf(table, 'U');
      expect(line, table).toBeDefined();
      expect(line, table).toMatch(
        new RegExp(
          `GRANT UPDATE ON OBJECT::\\[dbo\\]\\.\\[${table}\\] \\(\\[namesVersion\\], \\[updatedAt\\]\\) TO`,
          'u',
        ),
      );
      expect(line, table).toMatch(/DENY INSERT, DELETE, ALTER/u);
      expect(line, table).toMatch(/DENY UPDATE ON OBJECT::[^;]*\[slug\]/u);
    }
    for (const name of CANONICAL_PROCEDURES)
      expect(lineOf(name, 'P'), name).toMatch(
        new RegExp(`GRANT EXECUTE ON OBJECT::\\[dbo\\]\\.\\[${name}\\] TO`, 'u'),
      );
    for (const name of INTERNAL_PROCEDURES)
      expect(grants, name).toMatch(
        new RegExp(`DENY EXECUTE ON OBJECT::\\[dbo\\]\\.\\[${name}\\] TO`, 'u'),
      );
  });

  it('re-checks permission and a purpose-bound step-up grant inside the database', async () => {
    const migration = await read(MIGRATION);
    const assert =
      /CREATE PROCEDURE \[dbo\]\.\[HadithAssertCanonicalAuthority\]([\s\S]*?)END;/u.exec(
        migration,
      )?.[1];
    expect(assert).toBeDefined();
    expect(assert).toMatch(/hadith\.editCanonical/u);
    expect(assert).toMatch(/hadith-canonical-edit/u);
    expect(assert).not.toMatch(/quran/iu);
    expect(assert).toMatch(/revokedAt IS NULL/u);
    expect(assert).toMatch(/deactivatedAt IS NULL/u);
    expect(assert).toMatch(/expiresAt > SYSUTCDATETIME\(\)/u);

    for (const name of CANONICAL_PROCEDURES) {
      const body = procedure(migration, name);
      expect(body, name).toBeDefined();
      expect(body, name).toMatch(/EXEC \[dbo\]\.\[HadithAssertCanonicalAuthority\]/u);
    }
  });

  it('compares text by its bytes, never through a folding collation', async () => {
    const migration = await read(MIGRATION);
    for (const name of ['HadithWriteRecord', 'HadithDetectConflicts'])
      expect(procedure(migration, name), name).toMatch(/VARBINARY/u);
    for (const name of [...CANONICAL_PROCEDURES, ...INTERNAL_PROCEDURES]) {
      const body = procedure(migration, name) ?? '';
      expect(body.length, name).toBeGreaterThan(0);
      // A collation inside a procedure may only make a comparison STRICTER: a
      // binary collation, never one that folds case, accent, width or kana.
      for (const [, collation] of body.matchAll(/COLLATE\s+(\w+)/gu))
        expect(collation, name).toMatch(/_BIN2$/u);
    }
  });
});

describe('no Hadith content exists in the repository', () => {
  it('seeds no source, structure, record, grading or activation in the migration', async () => {
    const migration = await read(MIGRATION);
    // Procedure and trigger bodies are created through sp_executesql and write
    // only at run time, under a verified authority; outside them nothing is
    // inserted into a Hadith table at all.
    const outside = migration.replace(/EXEC sp_executesql N'[\s\S]*?';\n/gu, '');
    expect(outside).not.toMatch(/INSERT INTO \[dbo\]\.\[Hadith\w*\]/u);
    expect(outside).toMatch(/INSERT INTO \[dbo\]\.\[Permission\]/u);
  });

  it('carries no corpus constant in the contract, the context or the adapter', async () => {
    const files = [
      ...(await sources('packages/contracts/src/hadith')),
      ...(await sources(CONTEXT)),
      ...(await sources(ADAPTER)),
    ];
    for (const file of files) {
      const source = code(await read(file));
      // A long list of numbers would be a corpus fact written from memory.
      expect(source.match(/\b\d{1,6}\s*,/gu)?.length ?? 0, file).toBeLessThan(40);
    }
  });
});

describe('a chain is source text: there is no narrator anywhere', () => {
  it('models no Narrator and no narrator field on any Hadith model', async () => {
    const schema = await read(SCHEMA);
    expect(schema).not.toMatch(/^model \w*Narrator\w* \{/mu);
    const hadith = models(schema, /^Hadith/u);
    expect(hadith.size).toBeGreaterThan(0);
    for (const [name, block] of hadith)
      expect(undocumented(block), name).not.toMatch(/narrat/iu);
  });

  it('links no sourced Hadith model to People — only layered contributors are credited', async () => {
    const schema = await read(SCHEMA);
    const linked = [...models(schema, /^Hadith/u)]
      .filter(([, block]) => /\bPerson\b/u.test(undocumented(block)))
      .map(([name]) => name)
      .sort();
    expect(linked).toEqual([
      'HadithCommentaryContributor',
      'HadithTranslationContributor',
    ]);
    const person = models(schema, /^Person$/u).get('Person') ?? '';
    expect(person.length).toBeGreaterThan(0);
    expect(undocumented(person)).not.toMatch(
      /\bHadith(?!TranslationContributor|CommentaryContributor)\w*\[\]/u,
    );
  });

  it('routes nothing to a narrator', async () => {
    const files = await walk('apps/web/src/app');
    expect(files.filter((file) => /narrat/iu.test(file))).toEqual([]);
  });
});

describe('Hadith is its own context and nobody else authors it', () => {
  it('imports no Quran, Media, Library, Editorial, Fatwa or Learning context or contract', async () => {
    const files = [
      ...(await sources(CONTEXT)),
      ...(await sources('packages/contracts/src/hadith')),
      'apps/web/src/composition/hadith.ts',
      'apps/web/src/composition/hadith-read.ts',
    ];
    expect(files.length).toBeGreaterThan(4);
    for (const file of files) {
      expect(uncommented(await read(file)), file).not.toMatch(
        /contexts\/(?:quran|media|library|editorial|fatwa|learning)\b|contracts\/(?:src\/)?(?:quran|media|library|editorial|fatwa|learning)\b|\.\.\/(?:quran|media|library|editorial)\//u,
      );
    }
  });

  it('is imported by no other context', async () => {
    const contexts = (
      await readdir(path.join(repoRoot, 'apps/web/src/contexts'), { withFileTypes: true })
    )
      .filter((entry) => entry.isDirectory() && entry.name !== 'hadith')
      .map((entry) => entry.name);
    expect(contexts).toContain('quran');
    for (const context of contexts)
      for (const file of await sources(`apps/web/src/contexts/${context}`))
        expect(uncommented(await read(file)), file).not.toMatch(
          /contexts\/hadith|@minhaj\/contracts\/hadith|contracts\/src\/hadith/u,
        );
  });

  it('keeps the Quran contract free of Hadith', async () => {
    for (const file of await sources('packages/contracts/src/quran'))
      expect(uncommented(await read(file)), file).not.toMatch(/hadith/iu);
  });
});

describe('sourced text is never edited like ordinary content', () => {
  it('reaches no rich-text editor, generator or download from Hadith administration', async () => {
    const files = await sources(ADMIN);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const source = uncommented(await read(file));
      expect(source, file).not.toMatch(/@tiptap|editorial\/editor|RichText/u);
      expect(source, file).not.toMatch(/openai|anthropic|@ai-sdk|generateText/iu);
      expect(source, file).not.toMatch(/\bdownload\b=/u);
    }
  });

  it('indexes no chain, grading or commentary for search', async () => {
    const projection = code(await read(`${CONTEXT}/application/search-projection.ts`));
    expect(projection).not.toMatch(
      /\b(?:chain|grading|grader|commentar\w*|conflict\w*)\b/iu,
    );
  });
});

describe('the public Hadith reader holds no session', () => {
  it('reads no session, cookie, authorisation or administrative root in the public tree', async () => {
    const files = [
      ...(await sources(PUBLIC)),
      ...(await sources('apps/web/src/components/hadith')),
      'apps/web/src/composition/hadith-read.ts',
    ];
    expect(files.length).toBeGreaterThan(2);
    for (const file of files) {
      const source = uncommented(await read(file));
      expect(source, file).not.toMatch(
        /composition\/(?:identity|authorization)\b|cookies\(|headers\(\)\.get\('cookie'\)|server-core\/session|composition\/hadith['"]/u,
      );
    }
  });
});

describe('the vocabulary is exactly what the documents name', () => {
  it('mints three Hadith keys and nothing per record, collection or work', () => {
    expect(
      PERMISSION_CATALOGUE.map((entry) => entry.key)
        .filter((key) => key.startsWith('hadith.'))
        .sort(),
    ).toEqual(['hadith.administer', 'hadith.editCanonical', 'hadith.read']);
  });

  it('adds one step-up purpose, for canonical Hadith edits alone', () => {
    // Phase 20 appends Fatwa publication's own purpose after it; no Hadith
    // purpose was added beside it.
    expect([...STEP_UP_PURPOSES]).toEqual([
      'privilege-administration',
      'account-administration',
      'second-factor',
      'quran-canonical-edit',
      'hadith-canonical-edit',
      'fatwa-publication',
    ]);
    expect(STEP_UP_PURPOSES.filter((purpose) => purpose.startsWith('hadith-'))).toEqual([
      'hadith-canonical-edit',
    ]);
  });
});
