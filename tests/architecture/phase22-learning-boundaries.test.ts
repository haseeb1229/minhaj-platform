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
 * Phase 22 boundaries — Learning: courses & paths.
 *
 * THE FAILURES THIS FILE EXISTS TO PREVENT, each of which would pass every
 * behavioural test on the day it was introduced:
 *
 *   - Phase 23 arriving early: a ClassSession, Availability, Attendance or
 *     Booking table, a meeting provider or address, a teacher area, My Classes
 *     or My Teachers, or `teaching.perform` seeded "for later";
 *   - a placeholder relation to a Video, Work, Asset or Centre because the
 *     allowlist would permit one (DELIVERY_PLAN.md Phase 22: no Video or Centre
 *     foreign key exists in this phase's schema);
 *   - a PathEnrolment, Certificate, Assessment, price or entitlement nobody's
 *     contract defines;
 *   - the context importing another context, the database or the framework;
 *   - a public Learn page reaching the authenticated Learning root and with it
 *     a session;
 *   - Quran or Hadith learning about Learning, when the related Course views are
 *     Layer-4 compositions.
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
  'packages/database/prisma/migrations/20261006000000_phase22_learning/migration.sql';
const SCHEMA = 'packages/database/prisma/schema.prisma';
const CONTEXT = 'apps/web/src/contexts/learning';
const CONTRACT = 'packages/contracts/src/learning';
const APP = 'apps/web/src/app/[locale]';
const LEARN = `${APP}/(public)/learn`;

/** Learning's own tables — every one, and nothing else. */
const OWN_TABLES = [
  'Course',
  'CourseLabel',
  'CourseSlugHistory',
  'CourseTopic',
  'CourseTeacher',
  'CourseModule',
  'CourseModuleLabel',
  'Lesson',
  'LessonLabel',
  'LearningPath',
  'LearningPathLabel',
  'LearningPathSlugHistory',
  'LearningPathCourse',
  'Enrolment',
  'LessonProgress',
  'TrialClassRequest',
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

describe('Phase 22 builds the catalogue and a person’s own study — and no Phase 23', () => {
  it('creates exactly its own tables', async () => {
    const migration = sql(await read(MIGRATION));
    const created = [...migration.matchAll(/CREATE TABLE \[dbo\]\.\[(\w+)\]/gu)].map(
      (match) => match[1],
    );
    expect(created).toEqual(OWN_TABLES);
  });

  it('has no class, availability, attendance, booking or meeting anywhere in its schema', async () => {
    const schema = await read(SCHEMA);
    for (const name of [
      'ClassSession',
      'Availability',
      'Attendance',
      'Booking',
      'PathEnrolment',
    ])
      expect(schema, name).not.toMatch(new RegExp(`model ${name}\\b`, 'u'));
    for (const table of OWN_TABLES) {
      const body = model(schema, table);
      expect(body, table).not.toMatch(
        /meeting|provider|scheduled|slot|confirmed|teacherAccount|assigned|booking|attendance|price|amount|currency|certificate|grade|score/iu,
      );
    }
    expect(sql(await read(MIGRATION))).not.toMatch(
      /meeting|booking|ClassSession|Availability|Attendance|certificate/iu,
    );
  });

  it('holds no Video, Work, Asset, Centre or other content relation — and no polymorphic one', async () => {
    const schema = await read(SCHEMA);
    for (const table of OWN_TABLES) {
      const body = model(schema, table);
      expect(body, table).not.toMatch(
        /\b(?:Video|Work|Edition|Asset|Centre|City|Region|Country|AudioTrack|Gallery|Article)\b/u,
      );
      expect(body, table).not.toMatch(
        /targetType|targetId|scopeType|scopeId|entityType/u,
      );
    }
    // Teachers are People's Person, topics Taxonomy's Topic, the content
    // language Taxonomy's Language — by typed foreign key, nothing copied.
    expect(model(schema, 'CourseTeacher')).toMatch(/person\s+Person\s+@relation/u);
    expect(model(schema, 'CourseTopic')).toMatch(/topic\s+Topic\s+@relation/u);
    expect(model(schema, 'Course')).toMatch(/language\s+Language\s+@relation/u);
  });

  it('cascades nothing', async () => {
    const migration = sql(await read(MIGRATION));
    expect(migration).not.toMatch(/ON DELETE CASCADE|ON UPDATE CASCADE|SET NULL/u);
    const schema = await read(SCHEMA);
    for (const table of OWN_TABLES)
      expect(model(schema, table), table).not.toMatch(/onDelete:\s*(?:Cascade|SetNull)/u);
  });

  it('stores no copy of an account’s name, address or contact on a learner record', async () => {
    const schema = await read(SCHEMA);
    for (const table of ['Enrolment', 'LessonProgress', 'TrialClassRequest'])
      expect(model(schema, table), table).not.toMatch(
        /email|phone|name\b|address|age|birth|guardian|note|message|preferred/iu,
      );
  });
});

describe('Learning’s authority is the catalogue’s, and never teaching', () => {
  const catalogue: readonly string[] = PERMISSION_CATALOGUE.map((entry) => entry.key);

  it('catalogues exactly two Learning keys, both ordinary', () => {
    expect(catalogue.filter((key) => key.startsWith('learning.')).sort()).toEqual([
      'learning.administer',
      'learning.read',
    ]);
    const bundled: readonly string[] = PLATFORM_ADMINISTRATOR_PERMISSIONS;
    expect(bundled).toContain('learning.read');
    expect(bundled).toContain('learning.administer');
    expect(EXTERNALLY_GATED_PERMISSIONS as readonly string[]).not.toContain(
      'learning.read',
    );
  });

  it('seeds no teaching authority and no workflow key nobody asked for', async () => {
    for (const absent of [
      'teaching.perform',
      'learning.publish',
      'learning.author',
      'learning.review',
    ])
      expect(catalogue, absent).not.toContain(absent);
    const migration = sql(await read(MIGRATION));
    expect(migration).not.toMatch(/teaching\.|learning\.(?:publish|author|review)/u);
  });
});

describe('the context depends on its contracts alone', () => {
  it('imports no other context, no database, no framework', async () => {
    const files = await sources(CONTEXT);
    expect(files.length).toBeGreaterThan(4);
    for (const file of files)
      for (const specifier of imports(await read(file)))
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
  });

  it('keeps the contracts free of every other owner', async () => {
    for (const file of await sources(CONTRACT))
      for (const specifier of imports(await read(file)))
        expect(
          specifier === 'zod' ||
            specifier.startsWith('./') ||
            specifier === '../env/shared.ts',
          `${file} imports ${specifier}`,
        ).toBe(true);
  });

  it('is named by Quran and Hadith nowhere — the related Course views are Layer 4', async () => {
    for (const owner of ['quran', 'hadith'])
      for (const file of await sources(`apps/web/src/contexts/${owner}`))
        expect(code(await read(file)), file).not.toMatch(/learning/iu);
  });
});

describe('the public Learn tree reads no session', () => {
  it('reaches only the public Learning root', async () => {
    const files = await sources(LEARN);
    expect(files.length).toBeGreaterThanOrEqual(6);
    for (const file of files) {
      const found = imports(await read(file));
      for (const forbidden of [
        '@/composition/learning',
        '@/composition/identity',
        '@/composition/authorization',
        'next/headers',
        'next/cookies',
      ])
        expect(found, `${file} imports ${forbidden}`).not.toContain(forbidden);
    }
  });
});

describe('the routes Phase 22 delivers, and the ones it does not', () => {
  it('delivers the Learn catalogue, My Learning, course progress and the Learning administration', async () => {
    for (const route of [
      `${LEARN}/page.tsx`,
      `${LEARN}/courses/page.tsx`,
      `${LEARN}/courses/[slug]/page.tsx`,
      `${LEARN}/paths/page.tsx`,
      `${LEARN}/paths/[slug]/page.tsx`,
      `${LEARN}/trial/page.tsx`,
      `${APP}/my/learning/page.tsx`,
      `${APP}/my/learning/courses/[slug]/page.tsx`,
      `${APP}/my/learning/paths/[slug]/page.tsx`,
      `${APP}/my/progress/courses/page.tsx`,
      `${APP}/admin/learning/courses/page.tsx`,
      `${APP}/admin/learning/paths/page.tsx`,
      `${APP}/admin/learning/enrolments/page.tsx`,
      `${APP}/admin/learning/trials/page.tsx`,
    ])
      expect(await read(route), route).toBeTruthy();
  });

  it('leaves every Phase 23 and undefined surface absent', async () => {
    for (const absent of [
      `${LEARN}/live`,
      `${LEARN}/teachers`,
      `${LEARN}/training`,
      `${LEARN}/resources`,
      `${APP}/teacher`,
      `${APP}/my/classes`,
      `${APP}/my/teachers`,
      `${APP}/admin/learning/classes`,
      `${APP}/(public)/quran/teachers`,
      `${APP}/(public)/hadith/scholars`,
    ])
      expect(await exists(absent), absent).toBe(false);
    // There is still no `/my/progress` landing: the register names none.
    expect(await walk(`${APP}/my`)).not.toContain(`${APP}/my/progress/page.tsx`);
  });

  it('offers staff no way to confirm, schedule or assign a trial request', async () => {
    const files = await sources(`${APP}/admin/learning`);
    for (const file of files)
      expect(code(await read(file)), file).not.toMatch(
        /\b(?:confirm|schedule|assign|book)\w*Trial|\bconfirmTrial|requestTrial|withdrawTrial/u,
      );
  });
});
