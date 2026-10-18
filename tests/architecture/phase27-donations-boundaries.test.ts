import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  DEVELOPMENT_DEFAULTS,
  serverEnvSchema,
} from '../../packages/contracts/src/env/server-schema.ts';
import {
  EXTERNALLY_GATED_PERMISSIONS,
  PERMISSION_CATALOGUE,
  PLATFORM_ADMINISTRATOR_PERMISSIONS,
  STEP_UP_PURPOSES,
} from '../../packages/contracts/src/identity/index.ts';
import { SEARCH_KINDS } from '../../packages/contracts/src/search/index.ts';
import { repoRoot } from './architecture-harness.ts';

/**
 * Phase 27 boundaries — Donations.
 *
 * THE FAILURES THIS FILE EXISTS TO PREVENT, each of which would pass every
 * behavioural test on the day it was introduced:
 *
 *   - the provider reached AROUND its port: a `fetch`, an SDK or the provider's
 *     API host anywhere but the one adapter, so a second, unverified path to
 *     money exists;
 *   - a database or mail capability above the adapter, or a log line from the
 *     context or the adapter that could one day carry a token or a reference;
 *   - a payment CREDENTIAL arriving: a card, security-code, expiry, bank or
 *     billing column or field — checkout is provider-hosted and stays so;
 *   - ecommerce or religious-tax claims creeping in: a recurring plan, a
 *     subscription, Gift Aid, a tax receipt or zakat wording;
 *   - Donations growing an edge: to Membership (either direction) or to any
 *     feature context other than Identity's answers through Layer 4;
 *   - giving becoming discoverable as content: a Search kind, a sitemap
 *     segment, Product/Offer structured data;
 *   - the anonymous giving page reaching the donor runtime, a cookie or a
 *     header; the webhook re-serialising its body or answering a GET;
 *   - a secret: in a `NEXT_PUBLIC_` name, a schema default, or a committed
 *     key or signing-secret value;
 *   - the refund key bundled, a fourth key, a step-up purpose used anywhere
 *     but the refund, or a role, assignment or activation seeded by migration.
 */

const read = (relative: string) => readFile(path.join(repoRoot, relative), 'utf8');

/** Source with comments removed, string literals kept, so prose cannot match. */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//gu, ' ')
    .replace(/(^|[^:'"`\\])\/\/.*$/gmu, '$1 ');
}

/** SQL with `--` comments removed. */
const sql = (source: string) => source.replace(/--.*$/gmu, ' ');

async function exists(relative: string): Promise<boolean> {
  try {
    await stat(path.join(repoRoot, relative));
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

const CODE = /\.(?:ts|tsx|mts|mjs|js|cjs)$/u;
const sources = async (directory: string) =>
  (await walk(directory)).filter((file) => CODE.test(file));

/** Every import specifier, static or dynamic. */
function imports(source: string): string[] {
  const body = withoutComments(source);
  return [
    ...body.matchAll(/(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]/gu),
    ...body.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/gu),
    ...body.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gmu),
    ...body.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/gu),
  ].map((match) => match[1]!);
}

const MIGRATION =
  'packages/database/prisma/migrations/20261010000000_phase27_donations/migration.sql';
const SCHEMA = 'packages/database/prisma/schema.prisma';
const CONTEXT = 'apps/web/src/contexts/donations';
const CONTRACTS = 'packages/contracts/src/donations';
const ADAPTERS = 'packages/database/src/adapters/donations';
const STRIPE = 'packages/database/src/adapters/donations-stripe';
const COMPOSITION = [
  'apps/web/src/composition/donations.ts',
  'apps/web/src/composition/donations-read.ts',
  'apps/web/src/composition/donations-provider.ts',
  'apps/web/src/composition/donations-sweep.ts',
  'apps/web/src/composition/donations-webhook-admission.ts',
  'apps/web/src/composition/donation-status-cookie.ts',
];
const APP = 'apps/web/src/app';
const PUBLIC_PAGE = `${APP}/[locale]/(public)/donate/page.tsx`;
const PUBLIC_ACTION = `${APP}/[locale]/(public)/donate/actions.ts`;
const WEBHOOK = `${APP}/api/webhooks/stripe/route.ts`;
const SURFACES = [
  `${APP}/[locale]/(public)/donate`,
  `${APP}/[locale]/(donation)`,
  `${APP}/[locale]/my/donations`,
  `${APP}/[locale]/admin/donations`,
  `${APP}/api/admin/donations`,
  `${APP}/api/my/export/donations`,
  `${APP}/api/webhooks/stripe`,
];
const COMPONENTS = 'apps/web/src/components/donations';

/** Donations' own tables — exactly these eight. */
const OWN_TABLES = [
  'Donation',
  'DonationActivation',
  'DonationCampaign',
  'DonationCampaignCurrency',
  'DonationCampaignTranslation',
  'DonationCommunicationIntent',
  'DonationProviderEvent',
  'DonationRefund',
];

/** Every Donations source file: context, contracts, both adapters, composition, routes, components. */
async function donationsCode(): Promise<string[]> {
  return [
    ...(await sources(CONTEXT)),
    ...(await sources(CONTRACTS)),
    ...(await sources(ADAPTERS)),
    ...(await sources(STRIPE)),
    ...(await sources(COMPONENTS)),
    ...(await Promise.all(SURFACES.map(sources))).flat(),
    ...COMPOSITION,
  ];
}

function model(schema: string, name: string): string {
  const start = schema.indexOf(`model ${name} {`);
  expect(start, name).toBeGreaterThanOrEqual(0);
  return schema
    .slice(start, schema.indexOf('\n}', start))
    .split('\n')
    .filter((line) => !line.trim().startsWith('///') && !line.trim().startsWith('//'))
    .join('\n');
}

/** Field names of a Prisma model body. */
const fields = (body: string) =>
  [...body.matchAll(/^\s+([A-Za-z][A-Za-z0-9]*)\s+[A-Z]/gmu)].map((match) => match[1]!);

/** Column names declared in the migration's CREATE TABLE statements. */
function migrationColumns(migration: string): string[] {
  return [...migration.matchAll(/CREATE TABLE[\s\S]*?\n\);/gu)].flatMap((table) =>
    [...table[0].matchAll(/^\s+\[([A-Za-z0-9]+)\]\s+[A-Z]/gmu)].map((match) => match[1]!),
  );
}

/** A payment credential or billing identity — never stored, never typed, never named. */
const CREDENTIAL_WORD =
  /^(?:cards?|card_?number|cardholder\w*|pan|cvc2?|cvv2?|security_?code|expiry|expiry_?(?:month|year|date)|exp_?(?:month|year)|iban|bic|swift|account_?number|sort_?code|routing_?number|billing\w*|wallet\w*)$/iu;
/** The same inside a camelCase name: `donorCardNumber`, `payerIban`, `cardExpiry`. */
const CREDENTIAL_PART =
  /[a-z](?:Card|Iban|Cvc|Cvv|Billing|Wallet)(?:[A-Z]\w*)?$|^(?:card|iban|cvc|cvv|billing|wallet|expiry)[A-Z]/u;
const isCredential = (name: string) =>
  CREDENTIAL_WORD.test(name) || CREDENTIAL_PART.test(name);

/** Ecommerce and religious-tax wording a donation never uses. */
const FORBIDDEN_TERMS =
  /\b(?:recurring|recurrence|subscri\w*|monthly|gift\s*aid|tax[\s-]?(?:receipt|deductible|deduction|relief|exempt\w*)|zakat|zakah|cart|invoice|shipping)\b/iu;
/** The same in Urdu and Arabic copy: zakat and tax. */
const FORBIDDEN_TERMS_RTL = /زكاة|زکوٰۃ|زکات|زکوة|ضريب|ٹیکس|ٹیکس/u;

/* ===========================================================================
 * The context and its dependency edges
 * ========================================================================= */

describe('Donations depends only on Layer 0 and Identity’s answers', () => {
  it('imports nothing into the context but server-only, node:crypto, zod, the contracts and its own modules', async () => {
    const files = await sources(CONTEXT);
    expect(files.length).toBeGreaterThan(8);
    for (const file of files)
      for (const specifier of imports(await read(file)))
        expect(
          specifier === 'server-only' ||
            specifier === 'node:crypto' ||
            specifier === 'zod' ||
            specifier === '@minhaj/contracts' ||
            specifier === '@minhaj/contracts/donations' ||
            specifier === '@minhaj/contracts/platform' ||
            /^\.{1,2}\/[a-z/-]+\.ts$/u.test(specifier),
          `${file} imports ${specifier}`,
        ).toBe(true);
  });

  it('reaches no other feature context from the context, its contracts, its adapters or its composition', async () => {
    const files = [
      ...(await sources(CONTEXT)),
      ...(await sources(CONTRACTS)),
      ...(await sources(ADAPTERS)),
      ...(await sources(STRIPE)),
      ...COMPOSITION,
    ];
    for (const file of files)
      for (const specifier of imports(await read(file))) {
        // Contracts: Donations' own, the platform's shared ports and the env shapes.
        if (specifier.startsWith('@minhaj/contracts/'))
          expect(specifier, `${file} imports ${specifier}`).toMatch(
            /^@minhaj\/contracts\/(?:donations|platform)$/u,
          );
        // Contexts: only Donations itself.
        if (specifier.startsWith('@/contexts/'))
          expect(specifier, `${file} imports ${specifier}`).toBe('@/contexts/donations');
        // Composition: Identity's root is the one other root, and only the
        // donor runtime reaches it (for live permission, closure and address answers).
        const composition = /^(?:@\/composition\/|\.\/)([a-z-]+)$/u.exec(specifier);
        if (composition !== null && file.startsWith('apps/web/src/composition/'))
          expect(
            [
              'donations',
              'donations-provider',
              'failure-label',
              'logging',
              'request-address',
              ...(file.endsWith('/donations.ts') ? ['identity'] : []),
            ],
            `${file} imports ${specifier}`,
          ).toContain(composition[1]);
        expect(specifier, `${file} imports ${specifier}`).not.toMatch(
          /membership|messaging|learning|fatwa|editorial|library|media|quran|hadith|network|personalisation|people|taxonomy/u,
        );
      }
    // The contracts of Donations stand alone, beside the shared locale shape and
    // the shared Layer-0 text rules.
    for (const file of await sources(CONTRACTS))
      for (const specifier of imports(await read(file)))
        expect(
          specifier === 'zod' ||
            /^\.\/[a-z-]+\.ts$/u.test(specifier) ||
            specifier === '../env/shared.ts' ||
            specifier === '../exact-text.ts',
          `${file} imports ${specifier}`,
        ).toBe(true);
  });

  it('keeps Membership and Donations apart, in both directions', async () => {
    for (const directory of (
      await readdir(path.join(repoRoot, 'apps/web/src/contexts'), { withFileTypes: true })
    )
      .filter((entry) => entry.isDirectory() && entry.name !== 'donations')
      .map((entry) => `apps/web/src/contexts/${entry.name}`))
      for (const file of await sources(directory))
        for (const specifier of imports(await read(file)))
          expect(specifier, `${file} imports ${specifier}`).not.toMatch(
            /donation|payment|stripe/iu,
          );
    const membership = [
      ...(await sources('apps/web/src/contexts/membership')),
      ...(await sources('packages/contracts/src/membership')),
      ...(await sources('packages/database/src/adapters/membership')),
      'apps/web/src/composition/membership.ts',
      'apps/web/src/composition/membership-read.ts',
    ];
    expect(membership.length).toBeGreaterThan(10);
    for (const file of membership) {
      const source = withoutComments(await read(file));
      expect(source, file).not.toMatch(/donation|stripe|PaymentProvider/iu);
      for (const specifier of imports(source))
        expect(specifier, `${file} imports ${specifier}`).not.toMatch(
          /donation|payment|stripe|checkout/iu,
        );
    }
    // Phase 26's own guard still names the Donations direction it protects.
    const guard = await read('tests/architecture/phase26-membership-boundaries.test.ts');
    expect(guard).toMatch(/donations\?/u);
    expect(guard).toContain("it('is depended on by no other context'");
  });
});

/* ===========================================================================
 * The provider, only through its port; capabilities only where they belong
 * ========================================================================= */

describe('the provider is reached only through PaymentProviderPort', () => {
  it('calls fetch from the Stripe adapter alone', async () => {
    const files = await donationsCode();
    expect(files.length).toBeGreaterThan(40);
    for (const file of files) {
      if (file.startsWith(`${STRIPE}/`)) continue;
      const source = withoutComments(await read(file));
      expect(source, file).not.toMatch(
        /\bfetch\s*\(|\bXMLHttpRequest\b|node:https?\b|undici/u,
      );
    }
    // The adapter's one exchange is the one place a request leaves.
    const http = withoutComments(await read(`${STRIPE}/http.ts`));
    expect(http).toMatch(/\?\?\s*fetch\b/u);
    for (const file of await sources(STRIPE))
      if (file !== `${STRIPE}/http.ts`)
        expect(withoutComments(await read(file)), file).not.toMatch(/\bfetch\s*\(/u);
  });

  it('names the provider’s API host only in the adapter’s validator and the provider composition', async () => {
    const allowed = new Set([
      `${STRIPE}/config.ts`,
      'apps/web/src/composition/donations-provider.ts',
    ]);
    const scanned = [
      ...(await sources('apps/web/src')),
      ...(await sources('packages')),
      ...(await sources('scripts')),
      'apps/web/next.config.ts',
    ];
    expect(scanned.length).toBeGreaterThan(200);
    for (const file of scanned) {
      if (allowed.has(file)) continue;
      expect(withoutComments(await read(file)), file).not.toContain('api.stripe.com');
    }
    // The adapter carries no SDK and holds no database capability.
    for (const file of await sources(STRIPE))
      for (const specifier of imports(await read(file)))
        expect(specifier, `${file} imports ${specifier}`).not.toMatch(
          /^stripe$|@stripe\/|@prisma|\/client\.ts$|audit-row|\.\.\/donations\//u,
        );
  });

  it('holds no database, mail or logging capability above the adapter', async () => {
    const above = [
      ...(await sources(CONTEXT)),
      ...(await sources(CONTRACTS)),
      ...(await sources(COMPONENTS)),
      ...(await Promise.all(SURFACES.map(sources))).flat(),
      ...COMPOSITION,
    ];
    for (const file of above) {
      const source = withoutComments(await read(file));
      expect(source, file).not.toMatch(/@prisma|PrismaClient|\$queryRaw|\$executeRaw/u);
      for (const specifier of imports(source))
        expect(specifier, `${file} imports ${specifier}`).not.toMatch(
          /@prisma|^mssql$|^tedious$|packages\/database\/src|adapters\//u,
        );
    }
    for (const file of [
      ...(await sources(CONTEXT)),
      ...(await sources(ADAPTERS)),
      ...(await sources(STRIPE)),
      ...COMPOSITION,
    ])
      expect(withoutComments(await read(file)), file).not.toMatch(
        /\bresend\b|\.send\s*\(|EmailProvider|createEmailProvider|nodemailer/iu,
      );
    for (const directory of [CONTEXT, ADAPTERS, STRIPE])
      for (const file of await sources(directory))
        expect(withoutComments(await read(file)), file).not.toMatch(
          /\bconsole\.|appLogger|\blogger\b|from\s+'pino'/u,
        );
  });

  it('keeps the persistence adapter on its own tables and the audit log', async () => {
    const files = await sources(ADAPTERS);
    expect(files.length).toBeGreaterThan(8);
    for (const file of files) {
      const source = withoutComments(await read(file));
      expect(source, file).not.toMatch(
        /\[dbo\]\.\[(?!Donation\w*\]|AuditLog\])[A-Za-z]+\]/u,
      );
      expect(source, file).not.toMatch(
        /\b(?:tx|db|client|prisma)\.(?!donation\w*\b|auditLog\b|\$)[a-z]\w*\./u,
      );
      for (const specifier of imports(source))
        expect(specifier, `${file} imports ${specifier}`).not.toMatch(
          /^\.\.\/(?!\.\.)|adapters\/(?!donations)/u,
        );
    }
  });
});

/* ===========================================================================
 * No payment credential, no ecommerce, no religious-tax claim
 * ========================================================================= */

describe('no payment credential and no ecommerce or tax concept exists', () => {
  it('declares exactly eight tables, none holding a credential, a payload or a generic reference', async () => {
    const migration = sql(await read(MIGRATION));
    const tables = [...migration.matchAll(/CREATE TABLE \[dbo\]\.\[([A-Za-z]+)\]/gu)]
      .map((match) => match[1])
      .sort();
    expect(tables).toEqual(OWN_TABLES);

    const columns = migrationColumns(migration);
    expect(columns.length).toBeGreaterThan(60);
    for (const column of columns) {
      expect(isCredential(column), column).toBe(false);
      expect(column).not.toMatch(
        /^(?:targetType|targetId|subjectType|subjectId|ownerType|entityType)$/u,
      );
      // The event record keeps a digest of the payload, never the payload.
      expect(column).not.toMatch(
        /^(?:payload|body|rawBody|signature|token|statusToken|checkoutUrl|url|email|name)$/iu,
      );
    }

    const schema = await read(SCHEMA);
    for (const name of OWN_TABLES) {
      const body = model(schema, name);
      for (const field of fields(body)) {
        expect(isCredential(field), `${name}.${field}`).toBe(false);
        expect(field, `${name}.${field}`).not.toMatch(
          /^(?:targetType|targetId|payload|rawBody|signature|statusToken|checkoutUrl)$/u,
        );
      }
    }
  });

  it('names no credential field and no ecommerce or tax concept in the contracts, context or adapters', async () => {
    const files = [
      ...(await sources(CONTRACTS)),
      ...(await sources(CONTEXT)),
      ...(await sources(ADAPTERS)),
      ...(await sources(STRIPE)),
      ...(await sources(COMPONENTS)),
      ...(await Promise.all(SURFACES.map(sources))).flat(),
      ...COMPOSITION,
    ];
    for (const file of files) {
      const source = withoutComments(await read(file));
      // Object keys, properties and declarations — never a credential.
      for (const identifier of [
        ...source.matchAll(/\b([A-Za-z_$][\w$]*)\s*[?]?\s*:/gu),
        ...source.matchAll(/\.([A-Za-z_$][\w$]*)\b/gu),
        ...source.matchAll(
          /\b(?:const|let|var|function|interface|type)\s+([A-Za-z_$][\w$]*)/gu,
        ),
      ].map((match) => match[1]!))
        expect(isCredential(identifier), `${file}: ${identifier}`).toBe(false);
      expect(source, file).not.toMatch(FORBIDDEN_TERMS);
      expect(source, file).not.toMatch(FORBIDDEN_TERMS_RTL);
    }
    // No hosted-field or card-element integration was smuggled in either.
    for (const file of files)
      expect(withoutComments(await read(file)), file).not.toMatch(
        /js\.stripe\.com|elements\.create|PaymentElement|CardElement|autocomplete=["']cc-|autoComplete=["']cc-/u,
      );
  });

  it('writes no recurring, subscription, Gift Aid, tax-receipt or zakat wording into donation copy or mail', async () => {
    const strings = (value: unknown): string[] =>
      typeof value === 'string'
        ? [value]
        : value !== null && typeof value === 'object'
          ? Object.values(value).flatMap(strings)
          : [];
    for (const locale of ['en', 'ur', 'ar'] as const) {
      const messages = JSON.parse(
        await read(`apps/web/messages/${locale}.json`),
      ) as Record<string, unknown>;
      const namespaces = Object.keys(messages).filter((key) => /donation/iu.test(key));
      expect(namespaces.sort(), locale).toEqual([
        'adminDonations',
        'donations',
        'myDonations',
      ]);
      for (const namespace of namespaces)
        for (const text of strings(messages[namespace])) {
          expect(text, `${locale}.${namespace}: ${text}`).not.toMatch(FORBIDDEN_TERMS);
          expect(text, `${locale}.${namespace}: ${text}`).not.toMatch(
            FORBIDDEN_TERMS_RTL,
          );
        }
    }
    const mail = withoutComments(await read(`${CONTEXT}/application/donations-mail.ts`));
    expect(mail.length).toBeGreaterThan(2000);
    expect(mail).not.toMatch(FORBIDDEN_TERMS);
    expect(mail).not.toMatch(FORBIDDEN_TERMS_RTL);
    expect(mail).not.toMatch(/\breceipt\b/iu);
  });
});

/* ===========================================================================
 * Not content: no Search kind, no sitemap segment, no product markup
 * ========================================================================= */

describe('giving is a page, never discoverable content', () => {
  it('adds no Search kind and no sitemap segment beyond the static registry entry', async () => {
    for (const kind of SEARCH_KINDS)
      expect(kind).not.toMatch(/donat|campaign|payment|refund|checkout/u);
    const seo = await sources('apps/web/src/seo');
    expect(seo.length).toBeGreaterThan(5);
    for (const file of [
      ...seo,
      ...(await sources('packages/database/src/adapters/search')),
      `${APP}/robots.ts`,
    ])
      if (await exists(file))
        expect(withoutComments(await read(file)), file).not.toMatch(/donat/iu);
    // Exactly one registry entry, the public page; its return and status pages are not routes there.
    const registry = withoutComments(await read('apps/web/src/shell/registry.ts'));
    expect(registry.match(/path:\s*'\/donate[^']*'/gu)).toEqual(["path: '/donate'"]);
  });

  it('marks up no Product, Offer or price in any giving page', async () => {
    const files = [
      ...(await sources(COMPONENTS)),
      ...(await Promise.all(SURFACES.map(sources))).flat(),
    ];
    for (const file of files)
      expect(withoutComments(await read(file)), file).not.toMatch(
        /application\/ld\+json|['"]@type['"]|\bProduct\b|\bOffer\b|priceCurrency|schema\.org/u,
      );
  });
});

/* ===========================================================================
 * The anonymous page, the webhook, and secrets
 * ========================================================================= */

const APP_SRC = path.join(repoRoot, 'apps', 'web', 'src');

async function resolveInApp(from: string, specifier: string): Promise<string | null> {
  const base = specifier.startsWith('@/')
    ? path.join(APP_SRC, specifier.slice(2))
    : specifier.startsWith('.')
      ? path.resolve(path.dirname(from), specifier)
      : null;
  if (base === null) return null;
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, 'index.ts'),
    path.join(base, 'index.tsx'),
  ]) {
    try {
      if ((await stat(candidate)).isFile()) return candidate;
    } catch {
      // Not this candidate.
    }
  }
  return null;
}

const relativeOf = (file: string) =>
  path.relative(repoRoot, file).split(path.sep).join('/');

/**
 * Every in-app module the giving page RENDERS. A `'use server'` module is a
 * boundary: the page holds only a reference to its action, which runs in its
 * own request; that action is proven separately below.
 */
async function renderGraph(entry: string): Promise<{
  readonly modules: Map<string, string>;
  readonly external: Set<string>;
  readonly actions: Set<string>;
}> {
  const modules = new Map<string, string>();
  const external = new Set<string>();
  const actions = new Set<string>();
  const queue = [path.join(repoRoot, entry)];
  while (queue.length > 0) {
    const current = queue.pop()!;
    if (modules.has(current)) continue;
    const source = await readFile(current, 'utf8');
    if (
      current !== path.join(repoRoot, entry) &&
      /^\s*['"]use server['"]/u.test(source)
    ) {
      actions.add(relativeOf(current));
      continue;
    }
    modules.set(current, source);
    for (const specifier of imports(source)) {
      const resolved = await resolveInApp(current, specifier);
      if (resolved === null) external.add(specifier);
      else queue.push(resolved);
    }
  }
  return { modules, external, actions };
}

describe('the anonymous giving page and the webhook', () => {
  it('renders /donate from the public read root alone: no donor runtime, session, cookie or header', async () => {
    const graph = await renderGraph(PUBLIC_PAGE);
    const reached = [...graph.modules.keys()].map(relativeOf);
    expect(reached).toContain('apps/web/src/composition/donations-read.ts');
    for (const forbidden of [
      'apps/web/src/composition/donations.ts',
      'apps/web/src/composition/donations-provider.ts',
      'apps/web/src/composition/donation-status-cookie.ts',
      'apps/web/src/composition/identity.ts',
      'apps/web/src/composition/authorization.ts',
      'apps/web/src/composition/request.ts',
    ])
      expect(reached, forbidden).not.toContain(forbidden);
    for (const specifier of graph.external)
      expect(specifier).not.toMatch(/^next\/headers$|^next\/cookies$|better-auth/u);
    for (const [file, source] of graph.modules)
      expect(withoutComments(source), relativeOf(file)).not.toMatch(
        /\bcookies\s*\(|\bheaders\s*\(\s*\)|requireActiveSession|requireOwnSession|personalGate/u,
      );
    // The only action it can submit to is the anonymous start, a separate request.
    expect([...graph.actions]).toEqual([PUBLIC_ACTION]);

    const root = withoutComments(
      await read('apps/web/src/composition/donations-read.ts'),
    );
    for (const specifier of imports(root))
      expect(specifier, specifier).not.toMatch(
        /identity|authorization|session|next\/headers|server-env|donations-provider/u,
      );
    // The public root reads the non-secret scope and nothing else.
    expect(root).not.toMatch(/SECRET|serverEnv\s*\(/u);
  });

  it('accepts only POST at the webhook and never re-serialises the body it verifies', async () => {
    const source = withoutComments(await read(WEBHOOK));
    expect(source).toMatch(/export async function POST\s*\(/u);
    expect(source).not.toMatch(
      /export\s+(?:async\s+)?function\s+(?:GET|HEAD|PUT|PATCH|DELETE|OPTIONS)\b|export\s+const\s+(?:GET|HEAD|PUT|PATCH|DELETE|OPTIONS)\b|export\s*\{[^}]*\b(?:GET|HEAD|PUT|PATCH|DELETE|OPTIONS)\b/u,
    );
    expect(source).not.toMatch(/\.(?:json|text|formData|arrayBuffer|blob)\s*\(/u);
    expect(source).not.toMatch(/JSON\.(?:parse|stringify)/u);
    expect(source).toMatch(/runtime\s*=\s*'nodejs'/u);
    expect(source).toContain("request.headers.get('stripe-signature')");
    expect(source).toContain('receiveWebhook(');
  });

  it('never names a donations secret in a NEXT_PUBLIC_ variable and never defaults one', async () => {
    const scanned = [
      ...(await sources('apps/web/src')),
      ...(await sources('packages')),
      'apps/web/next.config.ts',
      '.env.example',
      '.github/workflows/ci.yml',
    ];
    for (const file of scanned)
      expect(await read(file), file).not.toMatch(
        /NEXT_PUBLIC_\w*(?:DONAT|STRIPE|PAYMENT)/u,
      );

    const donationKeys = Object.keys(serverEnvSchema.shape).filter((key) =>
      key.startsWith('DONATIONS_'),
    );
    expect(donationKeys.sort()).toEqual([
      'DONATIONS_FIXTURE_PROVIDER_ORIGIN',
      'DONATIONS_PROVIDER',
      'DONATIONS_PROVIDER_ACCOUNT',
      'DONATIONS_PROVIDER_ENVIRONMENT',
      'DONATIONS_STRIPE_SECRET_KEY',
      'DONATIONS_STRIPE_WEBHOOK_SECRET',
    ]);
    const shape = serverEnvSchema.shape as Record<
      string,
      { safeParse(value: unknown): { success: boolean; data?: unknown } }
    >;
    for (const key of donationKeys) {
      // Absent stays absent: no value is ever invented for a payment setting.
      const parsed = shape[key]!.safeParse(undefined);
      expect(parsed.success, key).toBe(true);
      expect(parsed.data, key).toBeUndefined();
      expect(DEVELOPMENT_DEFAULTS as readonly string[], key).not.toContain(key);
    }
    // .env.example names the variables and carries no value for any of them.
    const example = await read('.env.example');
    for (const key of donationKeys) {
      const line = example.split('\n').find((entry) => entry.startsWith(`${key}=`));
      expect(line, key).toBe(`${key}=`);
    }
  });

  it('commits no provider key or signing secret value outside synthetic test sentinels', async () => {
    const LIVE_OR_TEST_KEY = /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{6,}/gu;
    const SIGNING_SECRET = /\bwhsec_[A-Za-z0-9_+/=]{6,}/gu;
    const committed = [
      ...(await sources('apps/web/src')),
      ...(await sources('packages')),
      ...(await sources('scripts')),
      'apps/web/next.config.ts',
      '.env.example',
      '.github/workflows/ci.yml',
    ];
    for (const file of committed) {
      const source = await read(file);
      expect(source.match(LIVE_OR_TEST_KEY) ?? [], file).toEqual([]);
      for (const secret of source.match(SIGNING_SECRET) ?? [])
        expect(secret, file).toMatch(/^whsec_fixture/u);
    }
    // Tests use unmistakable synthetic values only.
    for (const file of await sources('tests')) {
      const source = await read(file);
      for (const key of source.match(LIVE_OR_TEST_KEY) ?? [])
        expect(key, file).toMatch(/Synthetic/u);
      if (file.startsWith('tests/donations/'))
        for (const secret of source.match(SIGNING_SECRET) ?? [])
          expect(secret, file).toMatch(/^whsec_(?:fixture|Synthetic)/u);
    }
  });
});

/* ===========================================================================
 * Three keys, one gated, one step-up purpose; nothing seeded for anyone
 * ========================================================================= */

describe('Donations adds exactly three keys and one step-up purpose', () => {
  it('catalogues read, administer and refund; bundles the first two; gates refund alone', () => {
    const catalogued = PERMISSION_CATALOGUE.map((entry) => entry.key);
    const gated: readonly string[] = EXTERNALLY_GATED_PERMISSIONS;
    const bundled: readonly string[] = PLATFORM_ADMINISTRATOR_PERMISSIONS;
    expect(catalogued.filter((key) => key.startsWith('donations.')).sort()).toEqual([
      'donations.administer',
      'donations.read',
      'donations.refund',
    ]);
    for (const key of ['donations.read', 'donations.administer']) {
      expect(gated, key).not.toContain(key);
      expect(bundled, key).toContain(key);
    }
    expect(gated).toContain('donations.refund');
    expect(bundled).not.toContain('donations.refund');
    expect(STEP_UP_PURPOSES).toContain('donation-refund');
    expect(
      STEP_UP_PURPOSES.filter((purpose) => /donat|payment|refund/u.test(purpose)),
    ).toEqual(['donation-refund']);
  });

  it('uses the donation-refund step-up for the refund action and its prompt only', async () => {
    const users: string[] = [];
    for (const file of await sources('apps/web/src'))
      if (
        withoutComments(await read(file)).includes("'donation-refund'") ||
        withoutComments(await read(file)).includes('"donation-refund"')
      )
        users.push(file);
    expect(users.sort()).toEqual([
      `${APP}/[locale]/admin/donations/actions.ts`,
      `${APP}/[locale]/admin/donations/shared.tsx`,
    ]);
    const actions = withoutComments(
      await read(`${APP}/[locale]/admin/donations/actions.ts`),
    );
    expect(actions.match(/'donation-refund'/gu)).toHaveLength(1);
    expect(actions).toMatch(
      /refundDonationAction[\s\S]*?requirePrivilegedActor\(\s*locale,\s*'donations\.refund',\s*'donation-refund',?\s*\)/u,
    );
    // No other act asks for the refund key.
    expect(actions.match(/'donations\.refund'/gu)).toHaveLength(1);
    const prompt = withoutComments(
      await read(`${APP}/[locale]/admin/donations/shared.tsx`),
    );
    expect(prompt.match(/purpose="donation-refund"/gu)).toHaveLength(1);
  });

  it('seeds the three keys and bundles two, and seeds no role, assignment or activation', async () => {
    const migration = sql(await read(MIGRATION));
    expect(migration).not.toMatch(
      /INSERT INTO \[dbo\]\.\[(?:Role|RoleAssignment|DonationActivation|StepUpGrant|Session)\]/u,
    );
    const insert =
      /INSERT INTO \[dbo\]\.\[Permission\][\s\S]*?;/u.exec(migration)?.[0] ?? '';
    const seeded = [...insert.matchAll(/\(N'([a-z]+\.[a-zA-Z.]+)',\s*N'/gu)].map(
      (match) => match[1],
    );
    expect(seeded.sort()).toEqual([
      'donations.administer',
      'donations.read',
      'donations.refund',
    ]);
    const bundling = [
      ...migration.matchAll(/INSERT INTO \[dbo\]\.\[RolePermission\][\s\S]*?;/gu),
    ].map((match) => match[0]);
    expect(bundling.length).toBeGreaterThan(0);
    for (const statement of bundling) {
      expect(statement).not.toContain('donations.refund');
      expect(statement).toContain("N'donations.read', N'donations.administer'");
    }
    // The refund key appears only where it is catalogued and where the
    // refund trigger re-checks it.
    expect(migration.match(/N'{1,2}donations\.refund'{1,2}/gu)).toHaveLength(2);
  });
});
