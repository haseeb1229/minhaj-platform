import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  EXTERNALLY_GATED_PERMISSIONS,
  PERMISSION_CATALOGUE,
  PLATFORM_ADMINISTRATOR_PERMISSIONS,
} from '../../packages/contracts/src/identity/index.ts';
import {
  NOTIFICATION_CHANNELS,
  PERSONAL_TARGET_KINDS,
} from '../../packages/contracts/src/personalisation/index.ts';
import { repoRoot } from './architecture-harness.ts';

/**
 * Phase 21 boundaries — Personalisation & Notifications: a person's own
 * continuity, typed references to other owners' content, and a newsletter that
 * is consent from an address rather than a property of an account.
 *
 * THE FAILURES THIS FILE EXISTS TO PREVENT, each of which would pass every
 * behavioural test on the day it was introduced:
 *
 *   - the context importing a content context, or the database, to "just look
 *     up the title" — content is resolved at Layer 4 by its owner's reader;
 *   - a generic `targetType + targetId` reference, or a `purge(type, id)`,
 *     replacing the typed foreign keys and typed releases;
 *   - Learning's courses, Messaging's conversations or a socket transport
 *     arriving early inside Personalisation;
 *   - a public page, or the hydrated island, reaching the authenticated
 *     Personalisation root and with it a session — or a public-read root for
 *     private data appearing at all;
 *   - a staff key that browses anybody's saved items, notes or history;
 *   - the newsletter growing a link to `User`, a raw token column, or a path
 *     into anybody's private records;
 *   - a tracking or analytics library turning private continuity into
 *     behavioural profiling.
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

const MIGRATION =
  'packages/database/prisma/migrations/20261005000000_phase21_personalisation_notifications/migration.sql';
const SCHEMA = 'packages/database/prisma/schema.prisma';
const ADAPTER = 'packages/database/src/adapters/personalisation-notifications';
const CONTEXT = 'apps/web/src/contexts/personalisation-notifications';
const CONTRACT = 'packages/contracts/src/personalisation';
const APP = 'apps/web/src/app';
const PUBLIC = 'apps/web/src/app/[locale]/(public)';
const MY = 'apps/web/src/app/[locale]/my';
const QUESTIONS = 'apps/web/src/app/[locale]/my/questions';
const COMPOSITION = 'apps/web/src/composition';
const ROOT = `${COMPOSITION}/personalisation.ts`;
const COMPOSED = [
  ROOT,
  `${COMPOSITION}/personal-targets.ts`,
  `${COMPOSITION}/newsletter-read.ts`,
  `${COMPOSITION}/fatwa-notifications.ts`,
  `${COMPOSITION}/personal-data-sweep.ts`,
];

/** The context's own tables — every one, and nothing else. */
const OWN_TABLES = [
  'PersonalisationProfile',
  'PersonalisationInterest',
  'PersonalisationGoal',
  'SavedItem',
  'Bookmark',
  'Note',
  'PrivateCollection',
  'PrivateCollectionItem',
  'ReadingHistory',
  'WatchHistory',
  'QuranReadingProgress',
  'NotificationPreference',
  'Notification',
  'NewsletterSubscriber',
  'NewsletterConsentEvent',
] as const;

/** The other owners' rows a typed reference may point at — and only point at. */
const FOREIGN_KEY_TARGETS = [
  'User',
  'Article',
  'Work',
  'Video',
  'Ayah',
  'HadithCitation',
];

/** The private records no newsletter path and no staff key may reach. */
const PRIVATE_TABLES = [
  'SavedItem',
  'Bookmark',
  'Note',
  'PrivateCollection',
  'PrivateCollectionItem',
  'ReadingHistory',
  'WatchHistory',
  'QuranReadingProgress',
  'Notification',
];

/** Every Phase 21 source file that exists, for the vocabulary scans. */
async function phaseFiles(): Promise<string[]> {
  const directories = [
    CONTRACT,
    CONTEXT,
    ADAPTER,
    `${MY}/saved`,
    `${MY}/history`,
    `${MY}/progress`,
    `${MY}/notifications`,
    `${MY}/settings/interests`,
    `${MY}/settings/notifications`,
    `${MY}/settings/privacy`,
    `${PUBLIC}/newsletter`,
    'apps/web/src/app/[locale]/admin/communications/newsletter',
    `${APP}/api/my`,
    'apps/web/src/components/personal',
    'apps/web/src/components/personal-island',
  ];
  const files = [...COMPOSED];
  for (const directory of directories)
    if (await exists(directory)) files.push(...(await sources(directory)));
  // Phase 22's course progress sits beside the Quran position under
  // `/my/progress`, but it is LEARNING'S page, read through Learning's own
  // runtime, so it is not one of this phase's files.
  return files.filter((file) => !file.startsWith(`${MY}/progress/courses/`));
}

/** The body of one `model X { … }` in the Prisma schema, its comments removed. */
function model(schema: string, name: string): string {
  const body = new RegExp(`\\nmodel ${name} \\{([\\s\\S]*?)\\n\\}`, 'u').exec(
    schema,
  )?.[1];
  if (body === undefined) throw new Error(`model ${name} missing`);
  return body.replace(/\/\/.*$/gmu, ' ');
}

/** The column list of one `CREATE TABLE [dbo].[X]` in the migration. */
function table(migration: string, name: string): string {
  const body = new RegExp(
    `CREATE TABLE \\[dbo\\]\\.\\[${name}\\] \\(([\\s\\S]*?)\\n\\);`,
    'u',
  ).exec(migration)?.[1];
  if (body === undefined) throw new Error(`table ${name} missing`);
  return body;
}

/* ===========================================================================
 * The context and its dependencies
 * ========================================================================= */

describe('Personalisation depends on Layer 0 and Identity alone', () => {
  it('imports only contracts, its own files and Identity — no content context, no database', async () => {
    const files = await sources(CONTEXT);
    expect(files.length).toBeGreaterThan(8);
    for (const file of files) {
      const specifiers = [
        ...uncommented(await read(file)).matchAll(/(?:from|import)\s+['"]([^'"]+)['"]/gu),
      ].map((match) => match[1]!);
      for (const specifier of specifiers)
        expect(specifier, file).toMatch(
          /^(?:\.{1,2}\/|server-only$|zod$|node:crypto$|@minhaj\/contracts(?:\/(?:personalisation|platform|identity))?$|@\/contexts\/identity-access$)/u,
        );
    }
  });

  it('is imported by no other context', async () => {
    const contexts = (
      await readdir(path.join(repoRoot, 'apps/web/src/contexts'), { withFileTypes: true })
    )
      .filter(
        (entry) => entry.isDirectory() && entry.name !== 'personalisation-notifications',
      )
      .map((entry) => entry.name);
    expect(contexts).toContain('fatwa');
    for (const context of contexts)
      for (const file of await sources(`apps/web/src/contexts/${context}`))
        expect(uncommented(await read(file)), file).not.toMatch(
          /contexts\/personalisation-notifications|@minhaj\/contracts\/personalisation|contracts\/src\/personalisation/u,
        );
  });

  it('keeps the contract free of any content context’s contract', async () => {
    for (const file of await sources(CONTRACT))
      expect(uncommented(await read(file)), file).not.toMatch(
        /from\s+['"]\.\.\/(?:editorial|library|media|quran|hadith|fatwa|people|taxonomy|search)\b/u,
      );
  });
});

/* ===========================================================================
 * Typed references — no generic target, no generic purge
 * ========================================================================= */

describe('a saved target is a typed foreign key, never a type and an id', () => {
  it('has no targetType or targetId in the schema, the migration’s tables or the contract', async () => {
    const schema = await read(SCHEMA);
    const migration = sql(await read(MIGRATION));
    for (const name of OWN_TABLES) {
      expect(model(schema, name), name).not.toMatch(
        /target(?:Type|Id|Kind)|\btype\b|entityType/iu,
      );
      expect(table(migration, name), name).not.toMatch(
        /target(?:Type|Id|Kind)|\[type\]|\[entityType\]/iu,
      );
    }
    for (const file of await sources(CONTRACT))
      expect(code(await read(file)), file).not.toMatch(/\btarget(?:Type|Id)\b/u);
    // The audit row's own `targetType`/`targetId` are historical audit
    // identifiers, an accepted separate case; no SQL here names such a column.
    for (const file of [...(await sources(ADAPTER)), ...(await sources(CONTEXT))])
      expect(uncommented(await read(file)), file).not.toMatch(/\[target(?:Type|Id)\]/u);
  });

  it('gives every saveable kind its own typed foreign key, and exactly one is set', async () => {
    const migration = sql(await read(MIGRATION));
    expect([...PERSONAL_TARGET_KINDS].sort()).toEqual([
      'article',
      'ayah',
      'hadith',
      'video',
      'work',
    ]);
    for (const [column, target] of [
      ['articleId', 'Article'],
      ['workId', 'Work'],
      ['videoId', 'Video'],
      ['hadithCitationId', 'HadithCitation'],
    ])
      expect(migration).toContain(
        `[SavedItem_${column}_fkey] FOREIGN KEY ([${column}]) REFERENCES [dbo].[${target}]([id])`,
      );
    expect(migration).toContain(
      'FOREIGN KEY ([surahNumber], [ayahNumber]) REFERENCES [dbo].[Ayah]([surahNumber],[ayahNumber])',
    );
    expect(migration).toMatch(/\[SavedItem_one_target_ck\] CHECK \(/u);
    expect(migration).toMatch(/\[ReadingHistory_one_target_ck\] CHECK \(/u);
    // Nothing cascades FROM content or from an account.
    for (const target of FOREIGN_KEY_TARGETS)
      for (const [, clause] of migration.matchAll(
        new RegExp(
          `REFERENCES \\[dbo\\]\\.\\[${target}\\]\\([^)]*\\) (ON DELETE \\w+(?: \\w+)?)`,
          'gu',
        ),
      ))
        expect(clause, target).toBe('ON DELETE NO ACTION');
  });

  it('releases a purged target only through one typed operation per family', async () => {
    const ports = code(await read(`${CONTRACT}/ports.ts`));
    const purge = /interface PersonalPurgePort \{([\s\S]*?)\n\}/u.exec(ports)?.[1] ?? '';
    const methods = [...purge.matchAll(/^\s{2}(\w+)\(/gmu)]
      .map((match) => match[1])
      .sort();
    expect(methods).toEqual([
      'releaseArticle',
      'releaseAyah',
      'releaseHadith',
      'releaseVideo',
      'releaseWork',
    ]);
    const files = [
      ...(await sources(CONTRACT)),
      ...(await sources(CONTEXT)),
      ...(await sources(ADAPTER)),
      ...COMPOSED,
    ];
    for (const file of files)
      expect(code(await read(file)), file).not.toMatch(
        /\b(?:purge|release|dispose)\w*\s*\(\s*(?:type|kind|targetType)\b|\b(?:purge|release)\w*\([^)]*:\s*PersonalTargetKind\b/u,
      );
  });
});

/* ===========================================================================
 * Scope — what Phase 21 is not
 * ========================================================================= */

describe('Phase 21 builds no Learning, Messaging or realtime surface', () => {
  it('names no course, lesson, path, conversation, message thread or socket in any Phase 21 file', async () => {
    const files = await phaseFiles();
    expect(files.length).toBeGreaterThan(20);
    for (const file of files) {
      expect(code(await read(file)), file).not.toMatch(
        /\b(?:Course|Lesson|LearningPath|Conversation|WebSocket|SocketIO|Teacher|Classroom)\w*/u,
      );
      expect(uncommented(await read(file)), file).not.toMatch(
        /socket\.io|['"]ws['"]|\/my\/(?:learning|classes|teachers|messages)\b/u,
      );
    }
    const migration = sql(await read(MIGRATION));
    expect(migration).not.toMatch(
      /CREATE TABLE \[dbo\]\.\[(?:Course|Lesson|LearningPath|Conversation|Message)\w*\]/u,
    );
  });

  it('adds no history or progress landing, and leaves course progress Learning’s', async () => {
    const routes = await walk(APP);
    // Phase 22 delivers `/my/progress/courses` — through Learning, never
    // through Personalisation.
    expect(routes.filter((file) => file.includes('/my/progress/courses'))).toEqual([
      `${MY}/progress/courses/page.tsx`,
    ]);
    const courses = uncommented(await read(`${MY}/progress/courses/page.tsx`));
    expect(courses).toMatch(/composition\/learning['"]/u);
    expect(courses).not.toMatch(
      /composition\/personalisation['"]|contexts\/personalisation-notifications/u,
    );
    expect(routes).not.toContain(`${MY}/progress/page.tsx`);
    expect(routes).not.toContain(`${MY}/history/page.tsx`);
  });

  it('leaves My Questions Fatwa’s', async () => {
    const files = await sources(QUESTIONS);
    for (const page of ['page.tsx', 'ask/page.tsx', '[id]/page.tsx'])
      expect(files).toContain(`${QUESTIONS}/${page}`);
    const imports = await Promise.all(
      files.map(async (file) => uncommented(await read(file))),
    );
    expect(imports.some((source) => /composition\/fatwa['"]/u.test(source))).toBe(true);
    for (const [index, source] of imports.entries())
      expect(source, files[index]).not.toMatch(
        /composition\/personalisation['"]|contexts\/personalisation-notifications/u,
      );
  });

  it('offers in-app notifications only — no notification can touch Identity’s mail', async () => {
    expect([...NOTIFICATION_CHANNELS]).toEqual(['in-app']);
    const dispatch = uncommented(await read(`${COMPOSITION}/dispatch.ts`));
    expect(dispatch).toMatch(/delivery\.purpose === 'newsletter\.confirmation'/u);
    expect(dispatch).toMatch(/scope: newsletter \? 'marketing' : 'transactional'/u);
  });
});

/* ===========================================================================
 * Private data stays private
 * ========================================================================= */

describe('no public surface reaches anybody’s private records', () => {
  it('has no public-read composition root for Personalisation', async () => {
    const roots = (await readdir(path.join(repoRoot, COMPOSITION))).filter((name) =>
      /personal(?:isation)?-read|saved-read|history-read|notification-read/u.test(name),
    );
    expect(roots).toEqual([]);
  });

  it('imports the authenticated root only from private surfaces and the newsletter’s Server Actions', async () => {
    const importers: string[] = [];
    for (const file of await sources('apps/web/src')) {
      const source = uncommented(await read(file));
      const direct = /['"]@\/composition\/personalisation['"]/u.test(source);
      const sibling =
        file.startsWith(`${COMPOSITION}/`) &&
        /from\s+['"]\.\/personalisation['"]/u.test(source);
      if (direct || sibling) importers.push(file);
    }
    expect(importers.length).toBeGreaterThan(5);
    const allowed = [
      /^apps\/web\/src\/app\/\[locale\]\/my\/(?!questions\/)/u,
      /^apps\/web\/src\/app\/api\/my\//u,
      /^apps\/web\/src\/app\/\[locale\]\/admin\/communications\/newsletter\//u,
      /^apps\/web\/src\/app\/\[locale\]\/\(identity\)\/actions\.ts$/u,
      /^apps\/web\/src\/app\/\[locale\]\/\(public\)\/newsletter\/actions\.ts$/u,
      /^apps\/web\/src\/composition\/[\w-]+\.ts$/u,
    ];
    for (const file of importers) {
      expect(
        allowed.some((pattern) => pattern.test(file)),
        `${file} imports the authenticated Personalisation root`,
      ).toBe(true);
      const source = await read(file);
      expect(source, file).not.toMatch(/^\s*['"]use client['"]/u);
      if (file.includes('/(public)/'))
        expect(source.trimStart().startsWith("'use server';"), file).toBe(true);
    }
  });

  it('keeps the public island and every client module away from server roots', async () => {
    for (const file of await sources('apps/web/src')) {
      const source = await read(file);
      if (!/^\s*['"]use client['"]/u.test(source)) continue;
      expect(uncommented(source), file).not.toMatch(
        /@\/composition\/|@\/contexts\/|@minhaj\/database|server-core/u,
      );
    }
    if (await exists('apps/web/src/components/personal-island'))
      for (const file of await sources('apps/web/src/components/personal-island'))
        expect(uncommented(await read(file)), file).not.toMatch(
          /@\/composition\/(?!.*-read['"])|@\/contexts\/|@minhaj\/database|next\/headers|cookies\(/u,
        );
  });

  it('renders the emailed newsletter links from the session-free read root only', async () => {
    for (const page of ['confirm/page.tsx', 'unsubscribe/page.tsx']) {
      const file = `${PUBLIC}/newsletter/${page}`;
      const source = uncommented(await read(file));
      expect(source, file).toMatch(/@\/composition\/newsletter-read['"]/u);
      expect(source, file).not.toMatch(
        /@\/composition\/(?:personalisation|identity|authorization|request)\b|next\/headers|cookies\(/u,
      );
    }
    const reader = uncommented(await read(`${COMPOSITION}/newsletter-read.ts`));
    expect(reader).not.toMatch(
      /server-env|serverEnv|composition\/identity|session|cookies/u,
    );
  });
});

describe('no staff key browses a person’s own records', () => {
  it('catalogues the two newsletter keys and no personalisation key', () => {
    const keys = PERMISSION_CATALOGUE.map((entry) => entry.key);
    expect(keys.filter((key) => key.startsWith('newsletter.')).sort()).toEqual([
      'newsletter.operate',
      'newsletter.read',
    ]);
    expect(
      keys.filter((key) =>
        /^(?:personalisation|personal|saved|history|notification)/u.test(key),
      ),
    ).toEqual([]);
    for (const key of ['newsletter.read', 'newsletter.operate']) {
      expect(PLATFORM_ADMINISTRATOR_PERMISSIONS).toContain(key);
      expect(EXTERNALLY_GATED_PERMISSIONS).not.toContain(key);
    }
  });

  it('grants nothing but the newsletter keys in the migration', async () => {
    const migration = sql(await read(MIGRATION));
    const catalogue =
      /INSERT INTO \[dbo\]\.\[Permission\][\s\S]*?\) AS v\(\[key\]/u.exec(
        migration,
      )?.[0] ?? '';
    const inserted = [...catalogue.matchAll(/\(N'([a-z]+\.[A-Za-z]+)', N'/gu)]
      .map((m) => m[1])
      .sort();
    expect(inserted).toEqual(['newsletter.operate', 'newsletter.read']);
    // The bundle extension names exactly those two keys, every time.
    const lists = [...migration.matchAll(/\[key\] IN \(([^)]*)\)/gu)].map((m) => m[1]);
    expect(lists.length).toBeGreaterThan(0);
    for (const list of lists)
      expect(list).toBe("N'newsletter.read', N'newsletter.operate'");
    expect(migration).not.toMatch(/personalisation\.(?:read|administer)/u);
  });

  it('keeps every newsletter permission check away from the private tables', async () => {
    const files = [...(await sources(CONTEXT)), ...(await sources(ADAPTER)), ...COMPOSED];
    const privateTable = new RegExp(`\\[(?:${PRIVATE_TABLES.join('|')})\\]`, 'u');
    for (const file of files) {
      const source = uncommented(await read(file));
      const checksNewsletter =
        /newsletter\.(?:read|operate)|NEWSLETTER_PERMISSIONS/u.test(source);
      if (!checksNewsletter) continue;
      expect(source, file).not.toMatch(privateTable);
      expect(source, file).not.toMatch(
        /PersonalSavedPort|PersonalHistoryPort|PersonalExportPort|PersonalNotificationPort|createPersonal(?:Saved|History|Export|Notifications)\b/u,
      );
    }
    const newsletter = uncommented(await read(`${ADAPTER}/newsletter.ts`));
    expect(newsletter).not.toMatch(privateTable);
    expect(newsletter).not.toMatch(/\[User\]|\buser\./u);
  });
});

/* ===========================================================================
 * The adapter reaches only its own tables
 * ========================================================================= */

describe('the adapter reads and writes only Personalisation’s tables', () => {
  it('names no other context’s table in its SQL and uses no other delegate', async () => {
    const files = await sources(ADAPTER);
    expect(files.length).toBeGreaterThan(6);
    for (const file of files) {
      const source = uncommented(await read(file));
      for (const [, name] of source.matchAll(/\[dbo\]\.\[(\w+)\]/gu))
        expect(OWN_TABLES as readonly string[], `${file} names [${name}]`).toContain(
          name,
        );
      for (const [, name] of source.matchAll(
        /`\[dbo\]\.\[\$\{table\}\]`|Prisma\.raw\(`\[dbo\]\.\[(\w+)\]`\)/gu,
      ))
        if (name !== undefined)
          expect(OWN_TABLES as readonly string[], file).toContain(name);
      // The one Prisma delegate it may touch is the shared audit log, to record
      // an operator's newsletter change in the same transaction.
      const delegates = new Set(
        [...source.matchAll(/\b(?:db|tx|prisma)\.([A-Za-z]\w*)\.\w+\(/gu)].map(
          (m) => m[1],
        ),
      );
      for (const delegate of delegates) expect(delegate, file).toBe('auditLog');
      expect(source, file).not.toMatch(/\$queryRawUnsafe|\$executeRawUnsafe/u);
    }
    // Every table name the purge release interpolates is one of its own.
    const disposition = uncommented(await read(`${ADAPTER}/disposition.ts`));
    for (const [, name] of disposition.matchAll(/table: '(\w+)'/gu))
      expect(OWN_TABLES as readonly string[]).toContain(name);
  });

  it('names another owner’s table in the migration only as a foreign-key target', async () => {
    const migration = sql(await read(MIGRATION));
    // The protected-bundle extension is Identity's established convention and
    // is checked by the bundle tests; everything before it is this context's.
    const own = migration.slice(0, migration.indexOf('INSERT INTO [dbo].[Permission]'));
    expect(own.length).toBeGreaterThan(1_000);
    for (const match of own.matchAll(/(\S+\s+)?\[dbo\]\.\[(\w+)\]/gu)) {
      const name = match[2]!;
      if ((OWN_TABLES as readonly string[]).includes(name)) continue;
      // The context's own trigger, created ON one of its own tables.
      if (match[1]?.trim() === 'TRIGGER' && /^Newsletter\w+Immutable$/u.test(name))
        continue;
      expect(FOREIGN_KEY_TARGETS, name).toContain(name);
      expect(match[1]?.trim(), name).toBe('REFERENCES');
    }
  });
});

/* ===========================================================================
 * The newsletter is not an account
 * ========================================================================= */

describe('a newsletter subscriber is an address, never an account', () => {
  it('has no user column and no relation to User', async () => {
    const schema = await read(SCHEMA);
    const subscriber = model(schema, 'NewsletterSubscriber');
    expect(subscriber).not.toMatch(/userId|accountId|\bUser\b/u);
    expect(model(schema, 'NewsletterConsentEvent')).not.toMatch(
      /userId|accountId|\bUser\b/u,
    );
    expect(model(schema, 'User')).not.toMatch(/Newsletter/u);
    const migration = sql(await read(MIGRATION));
    expect(table(migration, 'NewsletterSubscriber')).not.toMatch(/userId|accountId/u);
    expect(migration).not.toMatch(/NewsletterSubscriber\w*\] FOREIGN KEY[^;]*\[User\]/u);
  });

  it('stores no raw token: every token column is a hash, a salt or a key version', async () => {
    const migration = sql(await read(MIGRATION));
    for (const name of OWN_TABLES)
      for (const [, column] of table(migration, name).matchAll(/\[(\w*[Tt]oken\w*)\]/gu))
        expect(
          ['confirmTokenHash', 'unsubscribeTokenHash', 'tokenKeyVersion'],
          `${name}.${column}`,
        ).toContain(column);
    const adapter = uncommented(await read(`${ADAPTER}/newsletter.ts`));
    expect(adapter).not.toMatch(/\[(?:confirm|unsubscribe)?[Tt]oken\]/u);
    const ports = code(await read(`${CONTRACT}/ports.ts`));
    const issue = /interface NewsletterIssue \{([\s\S]*?)\n\}/u.exec(ports)?.[1] ?? '';
    expect(issue.length).toBeGreaterThan(0);
    expect(issue).not.toMatch(/\btoken\b|Token\s*:/u);
  });

  it('is never subscribed to by Identity: registration names no newsletter', async () => {
    const files = [
      ...(await sources('apps/web/src/contexts/identity-access')),
      ...(await sources('packages/database/src/adapters/identity-access')),
      `${COMPOSITION}/identity.ts`,
    ];
    expect(files.length).toBeGreaterThan(10);
    for (const file of files)
      expect(uncommented(await read(file)), file).not.toMatch(
        /newsletter|NewsletterSubscriber|createNewsletter/iu,
      );
  });
});

/* ===========================================================================
 * No profiling, no tracking, nothing personal in a log
 * ========================================================================= */

describe('private continuity is not analytics', () => {
  it('depends on no AI or analytics library anywhere in the workspace', async () => {
    const manifests = [
      'package.json',
      ...(await readdir(path.join(repoRoot, 'packages'))).map(
        (name) => `packages/${name}/package.json`,
      ),
      'apps/web/package.json',
    ];
    for (const manifest of manifests) {
      const text = await read(manifest);
      expect(text, manifest).not.toMatch(
        /"(?:openai|@anthropic-ai\/[\w-]+|@ai-sdk\/[\w-]+|ai|langchain|@langchain\/[\w-]+|@google\/generative-ai|cohere-ai|ollama|llamaindex|analytics-node|@segment\/[\w-]+|mixpanel[\w-]*|amplitude[\w-]*|@amplitude\/[\w-]+|posthog[\w-]*|@vercel\/analytics|react-ga\d?|@hotjar\/[\w-]+|@fullstory\/[\w-]+|heap-api)"/u,
      );
    }
  });

  it('calls no tracker and infers nothing from reading in any Phase 21 file', async () => {
    for (const file of await phaseFiles()) {
      const source = uncommented(await read(file));
      expect(source, file).not.toMatch(
        /\bgtag\(|dataLayer|navigator\.sendBeacon|fingerprint/u,
      );
      expect(code(source), file).not.toMatch(
        /\b(?:recommend|infer|profile[A-Z]\w*|segment|score)\w*\s*\(/u,
      );
    }
  });

  it('logs no personal content: the context has no logger, and Layer 4 logs operation names only', async () => {
    for (const file of await sources(CONTEXT))
      expect(code(await read(file)), file).not.toMatch(
        /\bconsole\.|\blogger\b|\blog\s*\(|appLogger/u,
      );
    for (const file of await phaseFiles()) {
      const source = uncommented(await read(file));
      expect(source, file).not.toMatch(/\bconsole\.(?:log|info|warn|error|debug)\(/u);
      // The first argument is an object with ONE key, `operation`: a literal
      // name, a template over a name, or a variable holding one.
      const calls = [
        ...source.matchAll(/appLogger\(\)\.\w+\(\s*(\{(?:[^{}]|\$\{\w+\})*\})/gu),
      ].map((match) => match[1]!);
      for (const detail of calls)
        expect(detail, file).toMatch(
          /^\{\s*operation(?::\s*(?:'[\w.-]+'|`[\w.-]*(?:\$\{\w+\}[\w.-]*)*`|[A-Za-z_]\w*(?:\.\w+)*))?\s*,?\s*\}$/u,
        );
      if (/appLogger\(\)\.\w+\(/u.test(source))
        expect(calls.length, file).toBe(source.match(/appLogger\(\)\.\w+\(/gu)!.length);
    }
  });
});
