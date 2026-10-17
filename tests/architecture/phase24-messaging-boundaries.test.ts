import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  EXTERNALLY_GATED_PERMISSIONS,
  PERMISSION_CATALOGUE,
  PLATFORM_ADMINISTRATOR_PERMISSIONS,
} from '../../packages/contracts/src/identity/index.ts';
import { SEARCH_KINDS } from '../../packages/contracts/src/search/index.ts';
import { repoRoot } from './architecture-harness.ts';

/**
 * Phase 24 boundaries — Messaging.
 *
 * THE FAILURES THIS FILE EXISTS TO PREVENT, each of which would pass every
 * behavioural test on the day it was introduced:
 *
 *   - realtime arriving early: an `apps/realtime`, a Socket.IO or `ws`
 *     dependency, a WebSocket, an EventSource or a polling timer (Phase 25 is
 *     the transport; Phase 24 is non-realtime);
 *   - a conversation, message, report or attachment becoming DISCOVERABLE: a
 *     Search kind or projection for it, a sitemap entry, a public route;
 *   - the hosted service acquiring capability it must never hold — a database,
 *     a framework, a logger that could carry a body — or Learning's seam
 *     depending back on Messaging (the admitted edge is Messaging → Learning);
 *   - Messaging's adapter reading another context's tables instead of asking
 *     its owner, or a generic `targetType` reference standing in for a typed
 *     key;
 *   - the global Server Action body cap raised to fit an attachment, or the
 *     upload route reading a body before deciding who may send it, or
 *     buffering it whole;
 *   - a staff key bundled into the protected administrator role.
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

const SKIPPED = new Set(['node_modules', '.next', 'dist', 'generated', 'test-results']);

async function walk(directory: string): Promise<string[]> {
  if (!(await exists(directory))) return [];
  const found: string[] = [];
  for (const entry of await readdir(path.join(repoRoot, directory), {
    withFileTypes: true,
  })) {
    if (SKIPPED.has(entry.name)) continue;
    const relative = `${directory}/${entry.name}`;
    if (entry.isDirectory()) found.push(...(await walk(relative)));
    else found.push(relative);
  }
  return found;
}

const sources = async (directory: string) =>
  (await walk(directory)).filter((file) => /\.(?:ts|tsx|mts|mjs|js|cjs)$/u.test(file));

/** Every import specifier, static or dynamic. */
function imports(source: string): string[] {
  return [
    ...source.matchAll(/(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]/gu),
    ...source.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/gu),
    ...source.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gmu),
    ...source.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/gu),
  ].map((match) => match[1]!);
}

const MIGRATION =
  'packages/database/prisma/migrations/20261008000000_phase24_messaging/migration.sql';
const SCHEMA = 'packages/database/prisma/schema.prisma';
const SERVICE = 'packages/server-core/src/messaging';
const RELATIONSHIPS = 'packages/server-core/src/relationships';
const CONTRACTS = 'packages/contracts/src/messaging';
const ADAPTERS = 'packages/database/src/adapters/messaging';
const APP = 'apps/web/src/app';
const UPLOAD = `${APP}/api/messaging/conversations/[conversationId]/attachments/route.ts`;

/** Every surface a person, a teacher or staff reaches Messaging through. */
const SURFACES = [
  `${APP}/[locale]/my/messages`,
  `${APP}/[locale]/teacher/messages`,
  `${APP}/[locale]/admin/messaging`,
];
/** The Route Handlers that carry bytes and JSON for those surfaces. */
const ROUTES = [
  `${APP}/api/messaging`,
  `${APP}/assets/messaging`,
  `${APP}/api/my/export/messaging`,
];

/** Messaging's own models — every one, and their fields, comments removed. */
const OWN_MODELS = [
  'MessagingActivation',
  'Conversation',
  'ConversationParticipant',
  'Message',
  'MessageAttachment',
  'MessageReadState',
  'MessagingBlock',
  'MessagingReport',
  'MessagingModerationDecision',
];

function model(schema: string, name: string): string {
  const start = schema.indexOf(`model ${name} {`);
  expect(start, name).toBeGreaterThanOrEqual(0);
  return schema
    .slice(start, schema.indexOf('\n}', start))
    .split('\n')
    .filter((line) => !line.trim().startsWith('///') && !line.trim().startsWith('//'))
    .join('\n');
}

/* ===========================================================================
 * Non-realtime
 * ========================================================================= */

describe('Phase 24 Messaging stays transport-free; Phase 25 owns the socket', () => {
  // Phase 25 introduced the realtime transport. The socket libraries are
  // admitted exactly where they belong — the server in `apps/realtime`, the
  // client in the web workspace's Messaging client islands — and nowhere else;
  // the Phase-24 domain service itself still opens no socket (the realtime
  // boundary file guards the transport).
  const SOCKET_PACKAGE =
    /^(?:socket\.io(?:-client|-adapter)?|ws|engine\.io(?:-client)?|@socket\.io\/.*)$/u;
  const ADMITTED: Readonly<Record<string, string>> = {
    'apps/realtime/package.json': 'socket.io',
    'apps/web/package.json': 'socket.io-client',
  };

  it('declares a socket dependency only where Phase 25 admits it', async () => {
    const manifests = [
      'package.json',
      ...(await walk('apps')).filter((file) => file.endsWith('/package.json')),
      ...(await walk('packages')).filter((file) => file.endsWith('/package.json')),
    ];
    expect(manifests.length).toBeGreaterThan(3);
    for (const manifest of manifests) {
      const declared = JSON.parse(await read(manifest)) as Record<
        string,
        Record<string, string> | undefined
      >;
      const names = [
        'dependencies',
        'devDependencies',
        'optionalDependencies',
        'peerDependencies',
      ].flatMap((field) => Object.keys(declared[field] ?? {}));
      for (const name of names.filter((declared) => SOCKET_PACKAGE.test(declared)))
        expect(ADMITTED[manifest], `${manifest} declares ${name}`).toBe(name);
    }
  });

  it('imports a socket library only from the transport and the Messaging client islands', async () => {
    const files = [...(await sources('apps')), ...(await sources('packages'))];
    expect(files.length).toBeGreaterThan(100);
    for (const file of files)
      for (const specifier of imports(await read(file))) {
        if (
          !/^(?:socket\.io(?:-client)?|ws|engine\.io(?:-client)?)(?:\/|$)/u.test(
            specifier,
          )
        )
          continue;
        const admitted =
          (specifier === 'socket.io' && file.startsWith('apps/realtime/src/')) ||
          (specifier === 'socket.io-client' &&
            /^apps\/web\/src\/components\/messaging\/[^/]+\.client\.tsx?$/u.test(file));
        expect(admitted, `${file} imports ${specifier}`).toBe(true);
      }

    // No raw socket, event stream or polling timer drives a Messaging
    // surface or the domain service: live delivery is the Phase-25 transport's,
    // through socket.io-client in the client island, and durable catch-up is
    // read on request. The island itself is checked by its own boundary file.
    const messaging = [
      ...(await sources('apps/web/src/components/messaging')).filter(
        (file) => !/\.client\.tsx?$/u.test(file),
      ),
      ...(await Promise.all(SURFACES.map(sources))).flat(),
      ...(await Promise.all(ROUTES.map(sources))).flat(),
      ...(await sources(SERVICE)),
    ];
    expect(messaging.length).toBeGreaterThan(10);
    for (const file of messaging)
      expect(withoutComments(await read(file)), file).not.toMatch(
        /\bWebSocket\b|\bEventSource\b|\bsetInterval\s*\(|text\/event-stream/u,
      );
  });
});

/* ===========================================================================
 * Never discoverable
 * ========================================================================= */

describe('a conversation is never discoverable', () => {
  it('has no Search kind, and Search projects nothing of Messaging', async () => {
    for (const kind of SEARCH_KINDS)
      expect(kind).not.toMatch(
        /conversation|message|messaging|support|report|attachment|chat/u,
      );
    for (const file of [
      ...(await sources('packages/database/src/adapters/search')),
      ...(await sources('apps/web/src/composition')).filter((f) =>
        /\/search[^/]*\.ts$/u.test(f),
      ),
    ]) {
      const source = withoutComments(await read(file));
      expect(source, file).not.toMatch(
        /\[(?:Conversation|ConversationParticipant|Message|MessageAttachment|MessagingReport)\]|\.(?:conversation|message|messageAttachment|messagingReport)\./u,
      );
      for (const specifier of imports(source))
        expect(specifier, `${file} imports ${specifier}`).not.toMatch(/messaging/u);
    }
  });

  it('puts no Messaging address in a sitemap and no Messaging route among the public pages', async () => {
    const sitemapSources = [
      ...(await sources('apps/web/src/seo')),
      ...(await sources(`${APP}/sitemap.xml`)),
      ...(await sources(`${APP}/sitemaps`)),
      `${APP}/robots.ts`,
    ];
    expect(sitemapSources.length).toBeGreaterThan(3);
    for (const file of sitemapSources)
      expect(withoutComments(await read(file)), file).not.toMatch(
        /messag|conversation|\/teacher\b/iu,
      );

    for (const file of await walk(`${APP}/[locale]/(public)`))
      expect(file).not.toMatch(
        /\/(?:messages?|messaging|conversations?|chat|inbox)(?:\/|$)/iu,
      );
  });

  it('marks every Messaging page noindex, on the page or a layout above it', async () => {
    const pages = (await Promise.all(SURFACES.map(walk)))
      .flat()
      .filter((file) => file.endsWith('/page.tsx'));
    expect(pages.length).toBeGreaterThanOrEqual(5);
    for (const page of pages) {
      const candidates = [page];
      for (
        let directory = path.posix.dirname(page);
        directory.startsWith(`${APP}/[locale]/`);
        directory = path.posix.dirname(directory)
      )
        candidates.push(`${directory}/layout.tsx`);
      let declared = false;
      for (const candidate of candidates) {
        // A layout that does not exist simply declares nothing.
        const source = await read(candidate).catch(() => null);
        if (
          source !== null &&
          /robots:\s*\{[^}]*index:\s*false/u.test(withoutComments(source))
        )
          declared = true;
      }
      expect(declared, `${page} is noindex`).toBe(true);
    }
  });
});

/* ===========================================================================
 * The hosted service and the seam it rests on
 * ========================================================================= */

describe('the hosted service holds only narrow ports', () => {
  it('imports nothing but server-only, node:crypto, the contracts and its own modules', async () => {
    const files = await sources(SERVICE);
    expect(files.length).toBeGreaterThan(3);
    for (const file of files)
      for (const specifier of imports(await read(file)))
        expect(
          specifier === 'server-only' ||
            specifier === 'node:crypto' ||
            specifier.startsWith('@minhaj/contracts/') ||
            /^\.\/[a-z-]+\.ts$/u.test(specifier),
          `${file} imports ${specifier}`,
        ).toBe(true);
  });

  it('keeps Messaging’s contracts free of every other owner', async () => {
    const files = await sources(CONTRACTS);
    expect(files.length).toBeGreaterThan(1);
    for (const file of files)
      for (const specifier of imports(await read(file)))
        expect(
          specifier === 'zod' ||
            /^\.\/[a-z-]+\.ts$/u.test(specifier) ||
            /^\.\.\/platform\/[a-z-]+\.ts$/u.test(specifier),
          `${file} imports ${specifier}`,
        ).toBe(true);
  });

  it('never lets Learning depend back on Messaging', async () => {
    // DOMAIN_MODEL.md §3.2 admits Messaging → Learning and nothing in reverse.
    for (const directory of [
      'packages/contracts/src/learning',
      RELATIONSHIPS,
      'apps/web/src/contexts/learning',
      'packages/database/src/adapters/learning',
    ]) {
      const files = await sources(directory);
      expect(files.length, directory).toBeGreaterThan(0);
      for (const file of files) {
        const source = await read(file);
        for (const specifier of imports(source))
          expect(specifier, `${file} imports ${specifier}`).not.toMatch(/messaging/u);
        expect(withoutComments(source), file).not.toMatch(
          /\[(?:Conversation|ConversationParticipant|Message|MessageAttachment|MessagingBlock|MessagingReport)\]/u,
        );
      }
    }
  });
});

/* ===========================================================================
 * Messaging's adapter and schema
 * ========================================================================= */

describe('Messaging reads only its own tables, through typed keys', () => {
  it('never reads Learning’s, Identity’s, People’s or Storage’s tables from its adapter', async () => {
    const files = await sources(ADAPTERS);
    expect(files.length).toBeGreaterThan(3);
    for (const file of files) {
      const source = withoutComments(await read(file));
      expect(source, file).not.toMatch(
        /\[dbo\]\.\[(?:Enrolment|Course\w*|RoleAssignment|Role|RolePermission|User|Session|Person\w*|Asset|LiveLearningActivation|Booking|ClassSession)\]/u,
      );
      expect(source, file).not.toMatch(
        /\b(?:tx|db|client|prisma)\.(?:enrolment|course\w*|roleAssignment|role|rolePermission|user|session|person\w*|asset|liveLearningActivation|booking|classSession)\./u,
      );
      for (const specifier of imports(source))
        expect(specifier, `${file} imports ${specifier}`).not.toMatch(
          /^\.\.\/(?!\.\.)|adapters\/(?!messaging)/u,
        );
    }
  });

  it('names no generic target and no relationship copy in its migration or models', async () => {
    const migration = sql(await read(MIGRATION));
    for (const forbidden of [
      'targetType',
      'targetId',
      'relationshipType',
      'scopeType',
      'subjectType',
      'ownerType',
    ])
      expect(migration, forbidden).not.toMatch(new RegExp(`\\[${forbidden}\\]`, 'u'));
    const schema = await read(SCHEMA);
    for (const name of OWN_MODELS) {
      const body = model(schema, name);
      expect(body, name).not.toMatch(
        /\b(?:targetType|relationshipType|scopeType|email|phone|guardian|age|courseTitle|displayNameOf)\b/u,
      );
    }
  });
});

/* ===========================================================================
 * Upload transport
 * ========================================================================= */

describe('an attachment arrives by a streamed Route Handler, decided first', () => {
  it('leaves the global Server Action body cap where it is', async () => {
    const config = withoutComments(await read('apps/web/next.config.ts'));
    expect(config).not.toMatch(/bodySizeLimit|serverActions/u);
  });

  it('checks origin, then session, then length, before it stores — and never buffers', async () => {
    const source = withoutComments(await read(UPLOAD));
    const order = [
      source.indexOf('isSameOriginMutation('),
      source.indexOf('messagingActor('),
      source.indexOf("'content-length'"),
      source.indexOf('.uploadAttachment('),
    ];
    for (const position of order) expect(position).toBeGreaterThan(0);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(source).toMatch(/chunks\(request\.body\)/u);
    expect(source).not.toMatch(
      /request\.(?:arrayBuffer|blob|formData|text|json)\s*\(|Buffer\.concat|new Response\(request/u,
    );
    expect(source).toMatch(/export async function POST\b/u);
    expect(source).not.toMatch(/export async function (?:GET|PUT|PATCH|DELETE)\b/u);
  });
});

/* ===========================================================================
 * Nothing sensitive leaves sideways
 * ========================================================================= */

describe('no body, filename or token reaches a log', () => {
  it('logs nothing at all from the service or the adapter', async () => {
    for (const directory of [SERVICE, ADAPTERS])
      for (const file of await sources(directory)) {
        const source = withoutComments(await read(file));
        expect(source, file).not.toMatch(
          /\bconsole\.|appLogger|\blogger\b|from\s+'pino'/u,
        );
      }
  });

  it('logs only an operation name from every Messaging route', async () => {
    const files = (await Promise.all(ROUTES.map(sources))).flat();
    expect(files.length).toBeGreaterThan(5);
    let calls = 0;
    for (const file of files) {
      const source = withoutComments(await read(file));
      expect(source, file).not.toMatch(/\bconsole\./u);
      for (const match of source.matchAll(
        /appLogger\(\)\s*\.\s*(?:trace|debug|info|warn|error|fatal)\s*\(\s*([^)]*)\)/gu,
      )) {
        calls += 1;
        const argument = match[1] ?? '';
        expect(argument, `${file}: ${argument}`).toMatch(
          /^\{\s*operation(?::\s*'[a-z-]+')?\s*\}\s*,\s*'[^']*'\s*,?\s*$/u,
        );
      }
    }
    expect(calls).toBeGreaterThan(0);
  });
});

/* ===========================================================================
 * Two staff keys, both the organisation's
 * ========================================================================= */

describe('the two Messaging keys are externally gated', () => {
  it('catalogues both, gates both, and bundles neither into the administrator role', () => {
    const catalogued = PERMISSION_CATALOGUE.map((entry) => entry.key);
    const gated: readonly string[] = EXTERNALLY_GATED_PERMISSIONS;
    const bundled: readonly string[] = PLATFORM_ADMINISTRATOR_PERMISSIONS;
    for (const key of ['messaging.support', 'messaging.moderate']) {
      expect(catalogued, key).toContain(key);
      expect(gated, key).toContain(key);
      expect(bundled, key).not.toContain(key);
    }
    expect(catalogued.filter((key) => key.startsWith('messaging.')).sort()).toEqual([
      'messaging.moderate',
      'messaging.support',
    ]);
  });
});
