import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  EXTERNALLY_GATED_PERMISSIONS,
  PERMISSION_CATALOGUE,
  PLATFORM_ADMINISTRATOR_PERMISSIONS,
  STEP_UP_PURPOSES,
} from '../../packages/contracts/src/identity/index.ts';
import { SEARCH_KINDS } from '../../packages/contracts/src/search/index.ts';
import { repoRoot } from './architecture-harness.ts';

/**
 * Phase 26 boundaries — Membership.
 *
 * THE FAILURES THIS FILE EXISTS TO PREVENT, each of which would pass every
 * behavioural test on the day it was introduced:
 *
 *   - a payment arriving inside Membership: a Donations or payment-provider
 *     import, or an amount, currency, fee, dues, price, invoice, receipt,
 *     checkout, refund or payment column, field or identifier — Membership has
 *     NO payment code path (DOMAIN_MODEL.md §17.2), and Donations must not
 *     reach back into it either;
 *   - the applicant being COPIED: a name, address, phone, age, guardian,
 *     identity-document, free-text or upload column beside the account
 *     reference — the account already is the applicant;
 *   - a meaningless relation manufactured from a permitted edge: a Person
 *     created for every member, or a Centre, Country, Region or City
 *     "affiliation" the accepted contract never names;
 *   - Membership's adapter reading another context's tables, or a generic
 *     `targetType` reference standing in for a typed key;
 *   - Membership becoming DISCOVERABLE: a Search kind or projection, a dynamic
 *     sitemap segment, an applicant in any public surface;
 *   - the public page reaching a session, or the service sending mail itself;
 *   - a third key, a gated key or a step-up purpose minted for symmetry.
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
  'packages/database/prisma/migrations/20261009000000_phase26_membership/migration.sql';
const SCHEMA = 'packages/database/prisma/schema.prisma';
const CONTEXT = 'apps/web/src/contexts/membership';
const CONTRACTS = 'packages/contracts/src/membership';
const ADAPTERS = 'packages/database/src/adapters/membership';
const COMPOSITION = [
  'apps/web/src/composition/membership.ts',
  'apps/web/src/composition/membership-read.ts',
];
const APP = 'apps/web/src/app';
const PUBLIC_PAGE = `${APP}/[locale]/(public)/membership/page.tsx`;
/** Every private surface an applicant, member or operator reaches Membership through. */
const SURFACES = [`${APP}/[locale]/my/membership`, `${APP}/[locale]/admin/membership`];
const EXPORT_ROUTE = `${APP}/api/my/export/membership/route.ts`;
const COMPONENTS = 'apps/web/src/components/membership';

/** Membership's own models — every one. */
const OWN_MODELS = [
  'MembershipType',
  'MembershipTypeTranslation',
  'MembershipApplication',
  'Membership',
  'MembershipCommunicationIntent',
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

/** The words of payment. `$transaction` (a database transaction) is not one of them. */
const PAYMENT =
  /\b(?:amount|currency|fees?|dues|price|pricing|invoice|receipt|checkout|refund\w*|payments?|paymentProvider\w*|PaymentProvider|payable|billing|donations?|donor|donate)\b/iu;

/** Copies of the applicant, or a questionnaire the accepted contract never asked for. */
const APPLICANT_COPY =
  /\b(?:email|name|firstName|lastName|phone|address|birth\w*|dateOfBirth|age|guardian\w*|gender|nationalId|cnic|passport|occupation|maritalStatus|income|biography|notes?|photo\w*|document\w*|upload\w*|answers?|questionnaire)\b/u;

/** A relation the accepted Membership contract does not name. */
const UNNAMED_RELATION =
  /\b(?:personId|person|centreId|centre|centerId|countryId|regionId|cityId)\b/u;

async function membershipCode(): Promise<string[]> {
  return [
    ...(await sources(CONTEXT)),
    ...(await sources(CONTRACTS)),
    ...(await sources(ADAPTERS)),
    ...(await sources(COMPONENTS)),
    ...(await Promise.all(SURFACES.map(sources))).flat(),
    ...COMPOSITION,
    PUBLIC_PAGE,
    EXPORT_ROUTE,
  ];
}

/* ===========================================================================
 * No payment — in either direction
 * ========================================================================= */

describe('Membership has no payment code path', () => {
  it('names no payment, donation or provider concept in any Membership source', async () => {
    const files = await membershipCode();
    expect(files.length).toBeGreaterThan(15);
    for (const file of files) {
      const source = withoutComments(await read(file));
      expect(source, file).not.toMatch(PAYMENT);
      for (const specifier of imports(source))
        expect(specifier, `${file} imports ${specifier}`).not.toMatch(
          /donation|payment|billing|stripe|paypal|checkout/iu,
        );
    }
  });

  it('adds no payment column, table or state to the database', async () => {
    const migration = sql(await read(MIGRATION));
    expect(migration).not.toMatch(PAYMENT);
    expect(migration).not.toMatch(
      /\[(?:Donation\w*|Payment\w*|Invoice\w*|Receipt\w*)\]/u,
    );
    const schema = await read(SCHEMA);
    for (const name of OWN_MODELS) expect(model(schema, name), name).not.toMatch(PAYMENT);
  });

  it('writes no fee, payment or donation wording into Membership copy', async () => {
    const english = JSON.parse(await read('apps/web/messages/en.json')) as Record<
      string,
      unknown
    >;
    const strings = (value: unknown): string[] =>
      typeof value === 'string'
        ? [value]
        : value !== null && typeof value === 'object'
          ? Object.values(value).flatMap(strings)
          : [];
    for (const namespace of ['membership', 'myMembership', 'adminMembership']) {
      expect(english[namespace], namespace).toBeDefined();
      for (const text of strings(english[namespace]))
        expect(text, `${namespace}: ${text}`).not.toMatch(
          /\b(?:fees?|dues|pay|paid|payment|price|donat\w*|invoice|receipt|subscription|charge)\b/iu,
        );
    }
  });

  it('is depended on by no other context', async () => {
    // Donations (Phase 27) has no edge to Membership: a future fee would be a
    // separate, explicit decision rather than an import.
    for (const directory of (
      await readdir(path.join(repoRoot, 'apps/web/src/contexts'), { withFileTypes: true })
    )
      .filter((entry) => entry.isDirectory() && entry.name !== 'membership')
      .map((entry) => `apps/web/src/contexts/${entry.name}`))
      for (const file of await sources(directory))
        for (const specifier of imports(await read(file)))
          expect(specifier, `${file} imports ${specifier}`).not.toMatch(/membership/u);
  });
});

/* ===========================================================================
 * The applicant is the account — nothing copied, nothing invented
 * ========================================================================= */

describe('an application holds the account and nothing copied from it', () => {
  it('stores no contact, profile, questionnaire, upload or invented relation', async () => {
    const schema = await read(SCHEMA);
    for (const name of OWN_MODELS) {
      const body = model(schema, name);
      expect(body, name).not.toMatch(APPLICANT_COPY);
      expect(body, name).not.toMatch(UNNAMED_RELATION);
      expect(body, name).not.toMatch(
        /\b(?:targetType|targetId|subjectType|ownerType)\b/u,
      );
    }
    const columns = [
      ...sql(await read(MIGRATION)).matchAll(/^\s+\[([A-Za-z]+)\]\s+[A-Z]/gmu),
    ].map((match) => match[1]!);
    expect(columns.length).toBeGreaterThan(30);
    for (const column of columns) {
      expect(column).not.toMatch(APPLICANT_COPY);
      expect(column).not.toMatch(UNNAMED_RELATION);
      expect(column).not.toMatch(/^(?:targetType|targetId|subjectType|ownerType)$/u);
    }
  });

  it('creates no Person and names no Centre, Country, Region or City', async () => {
    for (const file of await sources(ADAPTERS)) {
      const source = withoutComments(await read(file));
      expect(source, file).not.toMatch(
        /\[dbo\]\.\[(?:Person\w*|Centre\w*|Country|Region|City)\]|\.(?:person\w*|centre\w*|country|region|city)\./u,
      );
    }
    for (const file of await sources(CONTEXT))
      for (const specifier of imports(await read(file)))
        expect(specifier, `${file} imports ${specifier}`).not.toMatch(/people|global/u);
  });
});

/* ===========================================================================
 * The context, its contracts and its adapter
 * ========================================================================= */

describe('Membership holds only narrow ports and its own tables', () => {
  it('imports nothing into the context but server-only, node:crypto, zod, the contracts and its own modules', async () => {
    const files = await sources(CONTEXT);
    expect(files.length).toBeGreaterThan(4);
    for (const file of files)
      for (const specifier of imports(await read(file)))
        expect(
          specifier === 'server-only' ||
            specifier === 'node:crypto' ||
            specifier === 'zod' ||
            specifier === '@minhaj/contracts' ||
            specifier.startsWith('@minhaj/contracts/') ||
            /^\.{1,2}\/[a-z/-]+\.ts$/u.test(specifier),
          `${file} imports ${specifier}`,
        ).toBe(true);
  });

  it('keeps Membership’s contracts free of every other owner', async () => {
    const files = await sources(CONTRACTS);
    expect(files.length).toBeGreaterThan(1);
    for (const file of files)
      for (const specifier of imports(await read(file)))
        expect(
          specifier === 'zod' ||
            /^\.\/[a-z-]+\.ts$/u.test(specifier) ||
            /^\.\.\/env\/shared\.ts$/u.test(specifier),
          `${file} imports ${specifier}`,
        ).toBe(true);
  });

  it('never reads another context’s tables from its adapter', async () => {
    const files = await sources(ADAPTERS);
    expect(files.length).toBeGreaterThan(3);
    for (const file of files) {
      const source = withoutComments(await read(file));
      expect(source, file).not.toMatch(
        /\[dbo\]\.\[(?!Membership\w*\]|AuditLog\])[A-Za-z]+\]/u,
      );
      expect(source, file).not.toMatch(
        /\b(?:tx|db|client|prisma)\.(?!membership\w*\b|auditLog\b|\$)[a-z]\w*\./u,
      );
      for (const specifier of imports(source))
        expect(specifier, `${file} imports ${specifier}`).not.toMatch(
          /^\.\.\/(?!\.\.)|adapters\/(?!membership)/u,
        );
    }
  });

  it('never sends mail itself: the shared dispatcher relays its durable intent', async () => {
    for (const file of [
      ...(await sources(CONTEXT)),
      ...(await sources(ADAPTERS)),
      ...COMPOSITION,
    ]) {
      const source = withoutComments(await read(file));
      expect(source, file).not.toMatch(
        /\bresend\b|\.send\s*\(|EmailProvider|createEmailProvider/iu,
      );
    }
    const dispatch = withoutComments(await read('apps/web/src/composition/dispatch.ts'));
    expect(dispatch).toMatch(/isMembershipDeliveryPurpose\(/u);
    expect(dispatch).toMatch(
      /membershipRuntime\(\)\.communication\.relayPendingIntents\(/u,
    );
  });

  it('logs nothing at all from the context or the adapter', async () => {
    for (const directory of [CONTEXT, ADAPTERS])
      for (const file of await sources(directory))
        expect(withoutComments(await read(file)), file).not.toMatch(
          /\bconsole\.|appLogger|\blogger\b|from\s+'pino'/u,
        );
  });
});

/* ===========================================================================
 * Public, but never personal; private, and never discoverable
 * ========================================================================= */

describe('the public page reads no session and nothing private is discoverable', () => {
  it('composes the public page from the public read root alone', async () => {
    const source = withoutComments(await read(PUBLIC_PAGE));
    const specifiers = imports(source);
    expect(specifiers).toContain('@/composition/membership-read');
    for (const specifier of specifiers)
      expect(specifier, specifier).not.toMatch(
        /^@\/composition\/(?:membership|identity|authorization|request)$|next\/headers|\/guard$/u,
      );
    expect(source).not.toMatch(
      /\bcookies\s*\(|\bheaders\s*\(|requireActiveSession|requireOwnSession/u,
    );
    const root = withoutComments(
      await read('apps/web/src/composition/membership-read.ts'),
    );
    for (const specifier of imports(root))
      expect(specifier, specifier).not.toMatch(
        /identity|authorization|session|next\/headers/u,
      );
  });

  it('has no Search kind and puts no Membership address in a sitemap', async () => {
    for (const kind of SEARCH_KINDS) expect(kind).not.toMatch(/member|applica/u);
    for (const file of [
      ...(await sources('packages/database/src/adapters/search')),
      ...(await sources('apps/web/src/seo')),
      `${APP}/robots.ts`,
    ])
      expect(withoutComments(await read(file)), file).not.toMatch(/membership/iu);
  });

  it('marks every private Membership page noindex, on the page or a layout above it', async () => {
    const pages = (await Promise.all(SURFACES.map(walk)))
      .flat()
      .filter((file) => file.endsWith('/page.tsx'));
    expect(pages.length).toBeGreaterThanOrEqual(4);
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

  it('offers no per-type public route', async () => {
    const files = await walk(`${APP}/[locale]/(public)/membership`);
    expect(files).toEqual([PUBLIC_PAGE]);
  });
});

/* ===========================================================================
 * Two ordinary keys, and nothing minted for symmetry
 * ========================================================================= */

describe('Membership adds exactly two ordinary keys', () => {
  it('catalogues and bundles both, gates neither, and adds no step-up purpose', () => {
    const catalogued = PERMISSION_CATALOGUE.map((entry) => entry.key);
    const gated: readonly string[] = EXTERNALLY_GATED_PERMISSIONS;
    const bundled: readonly string[] = PLATFORM_ADMINISTRATOR_PERMISSIONS;
    expect(catalogued.filter((key) => key.startsWith('membership.')).sort()).toEqual([
      'membership.administer',
      'membership.read',
    ]);
    for (const key of ['membership.read', 'membership.administer']) {
      expect(gated, key).not.toContain(key);
      expect(bundled, key).toContain(key);
    }
    for (const purpose of STEP_UP_PURPOSES) expect(purpose).not.toMatch(/member/u);
  });

  it('seeds no role, assignment or other owner’s key in its migration', async () => {
    const migration = sql(await read(MIGRATION));
    expect(migration).not.toMatch(/INSERT INTO \[dbo\]\.\[(?:Role|RoleAssignment)\]/u);
    const insert =
      /INSERT INTO \[dbo\]\.\[Permission\][\s\S]*?;/u.exec(migration)?.[0] ?? '';
    const seeded = [...insert.matchAll(/\(N'([a-z]+\.[a-zA-Z.]+)',\s*N'/gu)].map(
      (match) => match[1],
    );
    expect(seeded.sort()).toEqual(['membership.administer', 'membership.read']);
  });
});
