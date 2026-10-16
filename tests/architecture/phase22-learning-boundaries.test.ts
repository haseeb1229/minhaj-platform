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
 *   - Phase 22 reaching into Phase 23's slice: its OWN migration creating a
 *     ClassSession, Availability, Attendance or Booking table, its own tables
 *     carrying a meeting provider or address, a slot or a booking column, or
 *     its migration seeding `teaching.perform` "for later" — Phase 23 delivers
 *     each of those as Learning's second slice, asserted by its own boundary
 *     file;
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

  it('carries no class, availability, attendance, booking or meeting COLUMN of its own', async () => {
    // Phase 23 delivers the ClassSession, Availability, Attendance and Booking
    // models, and Prisma requires the Phase-22 Course and trial request to
    // carry back-reference RELATION fields to them. Those are not columns: the
    // scalar fields of every Phase-22 table are still free of any meeting,
    // scheduling, slot or booking state, and the Phase-22 migration itself
    // creates none of those tables.
    const schema = await read(SCHEMA);
    expect(schema).not.toMatch(/model PathEnrolment\b/u);
    for (const table of OWN_TABLES) {
      const scalars = model(schema, table)
        .split('\n')
        .filter((line) =>
          /^\s+\w+\s+(?:String|Int|DateTime|Boolean|BigInt|Decimal|Float)\b/u.test(line),
        )
        .join('\n');
      expect(scalars, table).not.toMatch(
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

  it('catalogues exactly two catalogue keys, both ordinary — Phase 23 adds the two class keys', () => {
    expect(catalogue.filter((key) => key.startsWith('learning.')).sort()).toEqual([
      'learning.administer',
      'learning.classes.administer',
      'learning.classes.read',
      'learning.read',
    ]);
    const bundled: readonly string[] = PLATFORM_ADMINISTRATOR_PERMISSIONS;
    expect(bundled).toContain('learning.read');
    expect(bundled).toContain('learning.administer');
    expect(EXTERNALLY_GATED_PERMISSIONS as readonly string[]).not.toContain(
      'learning.read',
    );
    expect(EXTERNALLY_GATED_PERMISSIONS as readonly string[]).not.toContain(
      'learning.administer',
    );
  });

  it('seeds no teaching authority and no workflow key nobody asked for', async () => {
    // `teaching.perform` is Phase 23's to catalogue — externally gated, which
    // its own boundary file proves; this migration must still seed neither it
    // nor an editorial workflow for the catalogue.
    for (const absent of ['learning.publish', 'learning.author', 'learning.review'])
      expect(catalogue, absent).not.toContain(absent);
    const migration = sql(await read(MIGRATION));
    expect(migration).not.toMatch(
      /teaching\.|learning\.(?:publish|author|review|classes)/u,
    );
  });
});

describe('the context depends on its contracts alone', () => {
  it('imports no other context, no database, no framework', async () => {
    const files = await sources(CONTEXT);
    expect(files.length).toBeGreaterThan(4);
    // The one reach into the contracts root: the shared `Locale` TYPE, imported
    // type-only (erased at build) exactly as Personalisation's newsletter mail,
    // Taxonomy and People do. Any other name from the root barrel still fails.
    for (const file of files)
      for (const specifier of imports(
        (await read(file)).replace(
          /^import type \{ Locale \} from '@minhaj\/contracts';$/gmu,
          '',
        ),
      ))
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
    // The shared locale grammar and, since Phase 23, the platform's own time
    // grammar (a zone, a wall-clock pair, a fold) are the only reach outside.
    for (const file of await sources(CONTRACT))
      for (const specifier of imports(await read(file)))
        expect(
          specifier === 'zod' ||
            specifier.startsWith('./') ||
            specifier === '../env/shared.ts' ||
            specifier === '../platform/time.ts',
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
    // `/learn/live`, `/learn/teachers`, the teacher area, My Classes, My
    // Teachers and the classes administration left this list when Phase 23
    // delivered them; its own boundary file guards them now.
    for (const absent of [
      `${LEARN}/training`,
      `${LEARN}/resources`,
      `${APP}/teacher/messages`,
      `${APP}/(public)/quran/teachers`,
      `${APP}/(public)/hadith/scholars`,
    ])
      expect(await exists(absent), absent).toBe(false);
    // There is still no `/my/progress` landing: the register names none.
    expect(await walk(`${APP}/my`)).not.toContain(`${APP}/my/progress/page.tsx`);
  });

  it('offers no trial confirmation from the catalogue surfaces, and none through the catalogue service', async () => {
    // Confirming a request is Phase 23's, offered on the trial-request list and
    // the classes administration. The Phase-22 catalogue, path and enrolment
    // surfaces still only list and count, and wherever confirmation IS offered
    // it goes through the classes service, never the catalogue's.
    const TRIAL_WRITE =
      /\b(?:confirm|schedule|assign|book)\w*Trial|\bconfirmTrial|requestTrial|withdrawTrial/u;
    const admin = `${APP}/admin/learning`;
    const catalogueSurfaces = (await sources(admin)).filter(
      (file) =>
        [`${admin}/courses/`, `${admin}/paths/`, `${admin}/enrolments/`].some((dir) =>
          file.startsWith(dir),
        ) ||
        file === `${admin}/course-surfaces.tsx` ||
        file === `${admin}/path-surfaces.tsx`,
    );
    expect(catalogueSurfaces.length).toBeGreaterThan(2);
    for (const file of catalogueSurfaces)
      expect(code(await read(file)), file).not.toMatch(TRIAL_WRITE);
    for (const file of await sources(admin)) {
      const source = code(await read(file));
      for (const call of source.matchAll(/(\.\w+)?\.confirmTrial\(/gu))
        expect(call[1], `${file} confirms a trial outside the classes service`).toBe(
          '.classes',
        );
    }
  });
});
