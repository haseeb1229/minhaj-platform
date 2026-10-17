import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  EXTERNALLY_GATED_PERMISSIONS,
  PERMISSION_CATALOGUE,
  PLATFORM_ADMINISTRATOR_PERMISSIONS,
} from '../../packages/contracts/src/identity/index.ts';
import { repoRoot } from './architecture-harness.ts';

/**
 * Phase 23 boundaries — Learning: teacher experience & live classes.
 *
 * THE FAILURES THIS FILE EXISTS TO PREVENT, each of which would pass every
 * behavioural test on the day it was introduced:
 *
 *   - a scope, session, booking or intent that names its target by a
 *     `scopeType`/`targetType`/`sourceType` pair rather than a typed key, or a
 *     session that can sit on a scope of ANOTHER Course because the key does
 *     not carry the Course;
 *   - a cascade that erases a Booking, a mark or an intent under its session,
 *     or a scope under its assignment;
 *   - a policy nobody decided arriving as a column: a grade, a note, an age, a
 *     guardian, a consent, a vetting flag, a recording, a calendar, an OAuth
 *     token (OPEN_DECISIONS.md §2.1, §5.3, §6.3 stay open);
 *   - `teaching.perform` bundled into the protected role, or the two class
 *     keys gated as if teaching were theirs;
 *   - the context importing Identity, People, Personalisation, the database or
 *     the framework;
 *   - V1 reaching for what is not V1's: a realtime app, a Messaging model, a
 *     teacher messages route, or a Google Calendar/Meet API or OAuth
 *     integration where a manually supplied meeting address was decided.
 */

const read = (relative: string) => readFile(path.join(repoRoot, relative), 'utf8');

/** Source with comments removed, string literals kept, so prose cannot match. */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//gu, ' ')
    .replace(/(^|[^:'"`])\/\/.*$/gmu, '$1 ');
}

/** SQL with `--` comments removed. */
const sql = (source: string) => source.replace(/--.*$/gmu, ' ');

async function exists(relative: string): Promise<boolean> {
  try {
    await readdir(path.join(repoRoot, relative));
    return true;
  } catch {
    return false;
  }
}

async function walk(directory: string): Promise<string[]> {
  if (!(await exists(directory))) return [];
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

/** Every import specifier, static or dynamic. */
function imports(source: string): string[] {
  return [
    ...source.matchAll(/(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]/gu),
    ...source.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/gu),
    ...source.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gmu),
  ].map((match) => match[1]!);
}

const MIGRATION =
  'packages/database/prisma/migrations/20261007000000_phase23_teacher_live_classes/migration.sql';
const SCHEMA = 'packages/database/prisma/schema.prisma';
const CONTEXT = 'apps/web/src/contexts/learning';
const ADAPTERS = 'packages/database/src/adapters/learning';

/** Phase 23's own tables — every one, in the migration's order, and nothing else. */
const OWN_TABLES = [
  'LiveLearningActivation',
  'CourseTeachingAssignment',
  'Availability',
  'ClassSession',
  'Booking',
  'Attendance',
  'ClassCommunicationIntent',
];

/** The body of one `model X { … }` in the Prisma schema, its comments removed. */
function model(schema: string, name: string): string {
  const start = schema.indexOf(`model ${name} {`);
  expect(start, name).toBeGreaterThanOrEqual(0);
  return schema
    .slice(start, schema.indexOf('\n}', start))
    .split('\n')
    .filter((line) => !line.trim().startsWith('///'))
    .join('\n');
}

/** The scalar field names of a model body — columns, never relations. */
function columns(body: string): string[] {
  return body
    .split('\n')
    .map((line) =>
      /^\s+(\w+)\s+(?:String|Int|DateTime|Boolean|BigInt|Decimal|Float)\b/u.exec(line),
    )
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => match[1]!);
}

describe('Phase 23 builds live classes on typed keys — and nothing polymorphic or cascading', () => {
  it('creates exactly its own seven tables', async () => {
    const migration = sql(await read(MIGRATION));
    const created = [...migration.matchAll(/CREATE TABLE \[dbo\]\.\[(\w+)\]/gu)].map(
      (match) => match[1],
    );
    expect(created).toEqual(OWN_TABLES);
  });

  it('names every target by a typed key, never by a type-and-identifier pair', async () => {
    const schema = await read(SCHEMA);
    for (const table of OWN_TABLES) {
      const body = model(schema, table);
      expect(body, table).not.toMatch(
        /scopeType|targetType|sourceType|entityType|targetId/u,
      );
    }
    // The table definitions alone: the provisioning row's `targetType` is the
    // AuditLog's own accepted historical-attribution column, not a Phase-23 one.
    const definitions = [
      ...sql(await read(MIGRATION)).matchAll(
        /CREATE TABLE \[dbo\]\.\[\w+\] \(([\s\S]*?)\n\);/gu,
      ),
    ].map((match) => match[1]!);
    expect(definitions).toHaveLength(OWN_TABLES.length);
    for (const definition of definitions)
      expect(definition).not.toMatch(/scopeType|targetType|sourceType|entityType/u);
  });

  it('reaches a session’s scope by a composite key that carries the Course', async () => {
    const schema = await read(SCHEMA);
    expect(model(schema, 'ClassSession')).toMatch(
      /scope\s+CourseTeachingAssignment\s+@relation\(fields:\s*\[scopeId,\s*courseId\],\s*references:\s*\[id,\s*courseId\]/u,
    );
    const migration = sql(await read(MIGRATION));
    expect(migration).toMatch(
      /\[ClassSession_scope_fkey\] FOREIGN KEY \(\[scopeId\], \[courseId\]\) REFERENCES \[dbo\]\.\[CourseTeachingAssignment\]\(\[id\],\[courseId\]\)/u,
    );
  });

  it('names Identity’s RoleAssignment by its real key, and copies nothing of it', async () => {
    const schema = await read(SCHEMA);
    const scope = model(schema, 'CourseTeachingAssignment');
    expect(scope).toMatch(
      /roleAssignment\s+RoleAssignment\s+@relation\(fields:\s*\[roleAssignmentId\],\s*references:\s*\[id\]/u,
    );
    expect(columns(scope)).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/role(?:Key|Name)|permission/iu)]),
    );
  });

  it('cascades nothing', async () => {
    const migration = sql(await read(MIGRATION));
    expect(migration).not.toMatch(/CASCADE|SET NULL/iu);
    const schema = await read(SCHEMA);
    for (const table of OWN_TABLES)
      expect(model(schema, table), table).not.toMatch(/onDelete:\s*(?:Cascade|SetNull)/u);
  });

  it('invents no policy as a column: no grade, note, age, guardian, consent, vetting, recording, calendar, OAuth or token', async () => {
    const schema = await read(SCHEMA);
    for (const table of OWN_TABLES)
      for (const column of columns(model(schema, table)))
        expect(column, `${table}.${column}`).not.toMatch(
          /grade|note|age|guardian|consent|vetting|recording|calendar|oauth|token|credential|email|phone|retention|adult/iu,
        );
  });

  it('holds the meeting address in ClassSession alone, and no session reaches a recording', async () => {
    const schema = await read(SCHEMA);
    const homes = [...schema.matchAll(/^\s*model\s+(\w+)\s*\{[\s\S]*?\n\}/gmu)]
      .filter((match) => /\bmeetingUrl\b/u.test(match[0]))
      .map((match) => match[1]);
    expect(homes).toEqual(['ClassSession']);
  });
});

describe('teaching is the organisation’s to grant; class administration is the operator’s', () => {
  const catalogue: readonly string[] = PERMISSION_CATALOGUE.map((entry) => entry.key);
  const gated: readonly string[] = EXTERNALLY_GATED_PERMISSIONS;
  const bundled: readonly string[] = PLATFORM_ADMINISTRATOR_PERMISSIONS;

  it('catalogues teaching.perform as externally gated and bundles it into no role', () => {
    expect(catalogue).toContain('teaching.perform');
    expect(gated).toContain('teaching.perform');
    expect(bundled).not.toContain('teaching.perform');
  });

  it('bundles the two class keys as ordinary operator keys', () => {
    for (const key of ['learning.classes.read', 'learning.classes.administer']) {
      expect(catalogue, key).toContain(key);
      expect(bundled, key).toContain(key);
      expect(gated, key).not.toContain(key);
    }
  });

  it('catalogues no attendance, meeting, booking or availability key of its own', () => {
    expect(
      catalogue.filter((key) =>
        /^(?:attendance|meeting|booking|availability|session)\./u.test(key),
      ),
    ).toEqual([]);
  });

  it('seeds the three keys and extends the bundle by exactly the two class keys in the migration', async () => {
    const migration = sql(await read(MIGRATION));
    for (const key of [
      'teaching.perform',
      'learning.classes.read',
      'learning.classes.administer',
    ])
      expect(migration).toContain(`N'${key}'`);
    // The bundle extension names the two class keys and never the teaching key.
    const extension = migration.slice(
      migration.indexOf('@classesAdminRoleId IS NOT NULL'),
    );
    expect(extension).toContain(
      "N'learning.classes.read', N'learning.classes.administer'",
    );
    expect(extension).not.toContain('teaching.perform');
  });
});

describe('the context depends on its contracts alone', () => {
  it('imports no Identity, People or Personalisation context, no database, no framework', async () => {
    const files = await sources(CONTEXT);
    expect(files.length).toBeGreaterThan(4);
    // The one reach into the contracts root: the shared `Locale` TYPE, imported
    // type-only (erased at build) as Personalisation's newsletter mail does.
    for (const file of files)
      for (const specifier of imports(
        (await read(file)).replace(
          /^import type \{ Locale \} from '@minhaj\/contracts';$/gmu,
          '',
        ),
      )) {
        expect(specifier, `${file} imports ${specifier}`).not.toMatch(
          /identity|people|personalisation|@prisma|mssql|^next(?:\/|$)|@minhaj\/database/u,
        );
        expect(
          specifier.startsWith('./') ||
            specifier.startsWith('../') ||
            [
              'zod',
              'server-only',
              '@minhaj/contracts/learning',
              '@minhaj/contracts/platform',
              '@minhaj/contracts/search',
            ].includes(specifier),
          `${file} imports ${specifier}`,
        ).toBe(true);
      }
  });
});

describe('V1 is manual Google Meet over service mail — no realtime, no Google API', () => {
  it('Learning carries no message model of its own', async () => {
    // Phase 24 delivered Messaging — its `Conversation` and `Message` models
    // and the teacher's messages route — as its OWN context, and Phase 25 its
    // realtime transport; their boundary files guard them. What stays true
    // here: no thread or chat model was ever folded into Learning's classes.
    const schema = await read(SCHEMA);
    for (const name of ['MessageThread', 'ChatMessage', 'ClassMessage', 'SessionChat'])
      expect(schema, name).not.toMatch(new RegExp(`^\\s*model ${name}\\b`, 'mu'));
  });

  it('names no Google API, Calendar or OAuth client anywhere in Learning', async () => {
    for (const directory of [CONTEXT, ADAPTERS])
      for (const file of await sources(directory))
        expect(withoutComments(await read(file)), file).not.toMatch(
          /googleapis|calendar\.v3|oauth2|calendar\.google\.com|apis\.google\.com/iu,
        );
    expect(sql(await read(MIGRATION))).not.toMatch(/googleapis|calendar|oauth/iu);
  });
});
