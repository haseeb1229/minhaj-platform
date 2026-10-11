import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { repoRoot } from './architecture-harness.ts';
import {
  MAX_TOPIC_DEPTH,
  TOPIC_FALLBACK_LOCALE,
  languageCodeSchema,
  tagSlugSchema,
  topicSlugSchema,
} from '../../packages/contracts/src/taxonomy/index.ts';
import { localeSchema } from '../../packages/contracts/src/env/shared.ts';

/**
 * PHASE 3B — the boundaries Taxonomy must hold.
 *
 * The analyser suite proves the IMPORT graph and `db:migrate:test` proves the
 * live database. These prove the properties neither can see: that the
 * prohibited polymorphic assignment has not been introduced under any name,
 * that the interface-locale and content-language concerns did not quietly
 * merge, that the constants stated in two places agree, and that no
 * administrative route escaped the gate.
 *
 * Every assertion reads DELIVERED source. A fixture would prove the rule can be
 * stated; reading the real tree proves it currently holds.
 */

const MIGRATION =
  'packages/database/prisma/migrations/20260917000000_phase3b_taxonomy/migration.sql';
const ROLLBACK =
  'packages/database/sql/rollback/20260917000000_phase3b_taxonomy.rollback.sql';
const SCHEMA = 'packages/database/prisma/schema.prisma';
const TAXONOMY_ROUTES = 'apps/web/src/app/[locale]/admin/taxonomy';

async function sourceOf(relative: string): Promise<string> {
  return readFile(path.join(repoRoot, relative), 'utf8');
}

/**
 * The CODE, with comments removed.
 *
 * These files name the prohibited things constantly — in the prose explaining
 * why each one may not exist, which is the most valuable documentation here.
 * Scanning raw text would report every explanation as a violation and, worse,
 * would pressure the next author into deleting the explanations to make the
 * test pass.
 */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/\/.*$/gm, '')
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1')
    .replace(/^\s*--.*$/gm, '');
}

async function walk(
  directory: string,
  match: (name: string) => boolean,
): Promise<string[]> {
  const found: string[] = [];

  const visit = async (relative: string): Promise<void> => {
    for (const entry of await readdir(path.join(repoRoot, relative), {
      withFileTypes: true,
    })) {
      const child = `${relative}/${entry.name}`;
      if (entry.isDirectory()) await visit(child);
      else if (match(entry.name)) found.push(child);
    }
  };

  await visit(directory);
  return found;
}

/* ===========================================================================
 * The prohibition
 * ========================================================================= */

describe('Phase 3B — no polymorphic topic assignment exists', () => {
  it('declares no model carrying a targetType/targetId pair beside a Topic relation', async () => {
    // The shape DOMAIN_MODEL.md §6.2 prohibits: a pair used to NAVIGATE from
    // one business record to another. `AuditLog` legitimately carries the same
    // column names as historical evidence (§6.2.1) — it has no relation to
    // anything, which is precisely what makes it a different thing — so the
    // check is per model rather than per file.
    const schema = code(await sourceOf(SCHEMA));

    const models = [...schema.matchAll(/model\s+(\w+)\s*\{([\s\S]*?)\n\}/g)].map(
      (match) => ({ name: match[1] ?? '', body: match[2] ?? '' }),
    );
    expect(models.length).toBeGreaterThan(0);

    const offenders = models.filter(
      (model) =>
        /\btargetType\b/.test(model.body) &&
        /\btargetId\b/.test(model.body) &&
        /@relation\(/.test(model.body),
    );

    expect(offenders.map((model) => model.name)).toEqual([]);
  });

  it('creates no assignment table under any of the prohibited names', async () => {
    const migration = code(await sourceOf(MIGRATION));

    for (const name of [
      'TopicAssignment',
      'TaxonomyAssignment',
      'EntityTopic',
      'ContentTopic',
      'TopicTarget',
    ]) {
      expect(migration, `${name} must not be created`).not.toMatch(
        new RegExp(`CREATE TABLE\\s+\\[dbo\\]\\.\\[${name}\\]`, 'i'),
      );
    }
  });

  it('creates no table belonging to a context that has not shipped', async () => {
    // A junction needs a target, and a target table created here would be
    // premature business schema for an owner who has not arrived. The migration
    // creates exactly four tables, and they are Taxonomy's own.
    const migration = code(await sourceOf(MIGRATION));

    const created = [...migration.matchAll(/CREATE TABLE \[dbo\]\.\[(\w+)\]/g)]
      .map((match) => match[1])
      .sort();

    expect(created).toEqual(['Language', 'Tag', 'Topic', 'TopicTranslation']);
  });

  it('offers no service operation that assigns a topic to anything', async () => {
    // The contract half of the same rule. An `assignTopic(targetType, targetId)`
    // would be the prohibited reference wearing a service's clothes, and a
    // later owner reaching for one must find that it does not exist.
    const files = await walk('apps/web/src/contexts/taxonomy', (name) =>
      name.endsWith('.ts'),
    );
    files.push('packages/contracts/src/taxonomy/ports.ts');
    files.push('packages/contracts/src/taxonomy/values.ts');
    files.push('packages/database/src/adapters/taxonomy/persistence.ts');

    for (const file of files) {
      const source = code(await sourceOf(file));

      expect(source, `${file} must declare no assign operation`).not.toMatch(
        /\bassignTopic\b|\bassignTag\b|\bsetTopicsFor\b/,
      );
    }
  });

  it('names no targetType/targetId pair in the contract or the context', async () => {
    // The CONTRACT and the CONTEXT are where a relational reference would have
    // to be declared to be usable. The ADAPTER is excluded deliberately and is
    // checked separately below: it composes audit rows, and an audit record's
    // actor and target identifiers are historical evidence that
    // DOMAIN_MODEL.md §6.2.1 explicitly permits — "nothing joins from an audit
    // row into a domain table".
    const files = [
      ...(await walk('apps/web/src/contexts/taxonomy', (name) => name.endsWith('.ts'))),
      'packages/contracts/src/taxonomy/ports.ts',
      'packages/contracts/src/taxonomy/values.ts',
      'packages/contracts/src/taxonomy/index.ts',
    ];
    expect(files.length).toBeGreaterThan(3);

    for (const file of files) {
      const source = code(await sourceOf(file));

      expect(source, `${file} must name no targetType/targetId pair`).not.toMatch(
        /\btargetType\b|\btargetId\b/,
      );
    }
  });

  it('uses target identifiers only as audit evidence, never as a relation', async () => {
    // The adapter's `targetType` values are the audit vocabulary and nothing
    // else. Enumerated here so a new one cannot be introduced quietly — and so
    // "it is only audit" is a checked claim rather than an assurance.
    const adapter = code(
      await sourceOf('packages/database/src/adapters/taxonomy/persistence.ts'),
    );

    const targets = [...adapter.matchAll(/targetType: '([a-z-]+)'/g)]
      .map((match) => match[1])
      .filter((value, index, all) => all.indexOf(value) === index)
      .sort();

    expect(targets).toEqual(['language', 'tag', 'topic', 'topic-order']);

    // And they never reach a query. A `where` clause on a target pair would be
    // navigation, which is exactly what the prohibition is about.
    expect(adapter).not.toMatch(/where:\s*\{[^}]*targetType/);
  });

  it('reads the real foreign-key catalogue rather than a declared registry', async () => {
    // What makes the mapping surface honest: it reports what the DATABASE
    // enforces. A hard-coded list of "relationships we intend to have" would
    // report intentions as facts, and would keep reporting them after somebody
    // dropped the constraint.
    const adapter = await sourceOf(
      'packages/database/src/adapters/taxonomy/persistence.ts',
    );

    expect(adapter).toContain('sys.foreign_keys');
    expect(adapter).toContain("OBJECT_ID(N'[dbo].[Topic]')");
  });

  it('keeps physical mapping metadata behind a semantic product projection', async () => {
    const [contract, service, page] = await Promise.all([
      sourceOf('packages/contracts/src/taxonomy/values.ts'),
      sourceOf('apps/web/src/contexts/taxonomy/application/taxonomy-service.ts'),
      sourceOf('apps/web/src/app/[locale]/admin/taxonomy/mapping/page.tsx'),
    ]);

    expect(contract).toContain('interface TopicAssignmentStatus');
    expect(contract).not.toContain('interface TopicAssignmentRelationship');
    expect(service).toContain('assignmentStatus()');

    for (const source of [contract, service, page]) {
      expect(source).not.toMatch(/topicColumn|onTopicDelete|target\.column/);
    }
    expect(page).not.toMatch(/relationship\.table|<code>/);
  });
});

describe('Phase 3B — Topic slugs are stable identities', () => {
  it('exposes no service, port or action that can rename an existing slug', async () => {
    const sources = await Promise.all([
      sourceOf('packages/contracts/src/taxonomy/ports.ts'),
      sourceOf('apps/web/src/contexts/taxonomy/application/taxonomy-service.ts'),
      sourceOf('apps/web/src/app/[locale]/admin/taxonomy/actions.ts'),
    ]);

    for (const source of sources) {
      expect(source).not.toMatch(/renameTopicSlug|topicSlugChanged/);
    }
  });

  it('denies slug updates to the runtime principal while retaining Topic UPDATE', async () => {
    const grants = await sourceOf(
      'packages/database/sql/permissions/grant-application-principal.sql',
    );

    expect(grants).toContain('GRANT SELECT, INSERT, UPDATE ON OBJECT::[dbo].[Topic]');
    expect(grants).toMatch(/DENY UPDATE ON OBJECT::\[dbo\]\.\[Topic\]\s*\(\[slug\]\)/);
  });
});

/* ===========================================================================
 * Interface locale and content language stay apart
 * ========================================================================= */

describe('Phase 3B — content language is not the interface locale', () => {
  it('gives Language no relation to Topic or its translations', async () => {
    // DOMAIN_MODEL.md §18 names conflating them as a modelling error. A
    // relation from `TopicTranslation` to `Language` would make retiring a
    // content language change which topic names the interface can render.
    const schema = await sourceOf(SCHEMA);
    const language = /model Language \{([\s\S]*?)\n\}/.exec(schema)?.[1] ?? '';
    const translation = /model TopicTranslation \{([\s\S]*?)\n\}/.exec(schema)?.[1] ?? '';

    expect(language.length).toBeGreaterThan(0);
    expect(translation.length).toBeGreaterThan(0);

    expect(language).not.toMatch(/@relation\(/);
    expect(translation).not.toMatch(/Language/);
  });

  it('keys a topic translation by the platform locale vocabulary', async () => {
    // One definition of the interface locales, derived rather than redeclared.
    const values = await sourceOf('packages/contracts/src/taxonomy/values.ts');

    expect(values).toContain('export const topicLocaleSchema = localeSchema');
    expect(localeSchema.options).toEqual(['en', 'ur', 'ar']);
  });

  it('derives the content-language code from nothing the interface owns', async () => {
    const values = code(await sourceOf('packages/contracts/src/taxonomy/values.ts'));
    const languageCode =
      /export const languageCodeSchema = ([\s\S]*?);\n/.exec(values)?.[1] ?? '';

    expect(languageCode.length).toBeGreaterThan(0);
    expect(languageCode).not.toMatch(/localeSchema/);
  });

  it('offers no administrative path that changes the interface locale list', async () => {
    // Adding `fa` as a content language must not create `/fa/...` routing with
    // no catalogue behind it. The locale list is a compiled contract.
    const files = await walk(
      TAXONOMY_ROUTES,
      (name) => name.endsWith('.tsx') || name.endsWith('.ts'),
    );
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const source = code(await sourceOf(file));

      expect(source, `${file} must not write the routing configuration`).not.toMatch(
        /i18n\/routing|defineRouting|FALLBACK_LOCALE\s*=/,
      );
    }
  });
});

/* ===========================================================================
 * Constants stated twice must agree
 * ========================================================================= */

describe('Phase 3B — the constants the database and the contract share', () => {
  it('uses the same maximum hierarchy depth in the trigger and the contract', async () => {
    // The bound lives in the trigger because that is where it is enforced, and
    // in the contract because that is what the interface explains. Two numbers
    // that must agree are two numbers that can drift.
    const migration = await sourceOf(MIGRATION);
    const declared = /DECLARE @maxDepth int = (\d+);/.exec(migration)?.[1];

    expect(declared).toBeDefined();
    expect(Number(declared)).toBe(MAX_TOPIC_DEPTH);
  });

  it('uses the same fallback locale in the trigger and the contract', async () => {
    const migration = await sourceOf(MIGRATION);
    const trigger = /CREATE TRIGGER \[dbo\]\.\[TaxonomyTopicFallback\][\s\S]*?';/.exec(
      migration,
    )?.[0];

    expect(trigger).toBeDefined();
    expect(trigger).toContain(`tr.[locale] = N''${TOPIC_FALLBACK_LOCALE}''`);
  });

  it('seeds the fallback locale and no other, for the canonical topics', async () => {
    // The seed is English-only on purpose: inventing Urdu and Arabic wording
    // for nineteen religious and scholarly subjects is editorial work for
    // people qualified to do it. Asserted so the omission stays deliberate.
    const migration = await sourceOf(MIGRATION);
    const insert = /INSERT INTO \[dbo\]\.\[TopicTranslation\][\s\S]*?;/.exec(
      migration,
    )?.[0];

    expect(insert).toBeDefined();
    expect(insert).toContain(`N'${TOPIC_FALLBACK_LOCALE}'`);
    expect(insert).not.toMatch(/N'ur'|N'ar'/);
  });
});

/* ===========================================================================
 * The migration, the rollback and the privilege change
 * ========================================================================= */

describe('Phase 3B — the migration pays for the privilege change it makes', () => {
  it('revokes the holders sessions and step-up grants when it widens the bundle', async () => {
    // Extending the protected bundle widens what a live administrator may do,
    // which is a privilege change — and Phase 2 fixed what one costs
    // (SECURITY_BASELINE.md §8.1). Doing it in the migration is the only place
    // it CAN be done, because no runtime path re-bundles a protected role.
    const migration = code(await sourceOf(MIGRATION));

    expect(migration).toMatch(/INSERT INTO \[dbo\]\.\[RolePermission\]/);
    expect(migration).toMatch(/DELETE FROM \[dbo\]\.\[StepUpGrant\]/);
    expect(migration).toMatch(/DELETE FROM \[dbo\]\.\[Session\]/);
  });

  it('records the extension in the audit log, without a bundle snapshot', async () => {
    const migration = await sourceOf(MIGRATION);

    expect(migration).toContain("N'taxonomy.permissions.provisioned'");
    // WHICH keys were added, and nothing else. A payload carrying the whole
    // bundle would be a second copy of the privilege model in a table with
    // different retention (SECURITY_BASELINE.md §13.4).
    expect(migration).toContain('{"added":"');
  });

  it('pays for the same change in the opposite direction on rollback', async () => {
    const rollback = code(await sourceOf(ROLLBACK));

    expect(rollback).toMatch(/DELETE FROM \[dbo\]\.\[RolePermission\]/);
    expect(rollback).toMatch(/DELETE FROM \[dbo\]\.\[StepUpGrant\]/);
    expect(rollback).toMatch(/DELETE FROM \[dbo\]\.\[Session\]/);
  });

  it('edits no accepted migration', async () => {
    // Domain schema arrives with its owning phase, and a closed phase's
    // migration is not reopened to make a later one convenient.
    const phase1 = await sourceOf(
      'packages/database/prisma/migrations/20260908000000_phase1_database_foundation/migration.sql',
    );
    const phase2 = await sourceOf(
      'packages/database/prisma/migrations/20260916000000_phase2_authorization_privileged_security/migration.sql',
    );

    expect(phase1).not.toMatch(/Topic|Taxonomy|Tag\b/);
    expect(phase2).not.toMatch(/taxonomy\./);
  });

  it('gives the runtime principal no DELETE on any taxonomy aggregate', async () => {
    // The phase's central integrity claim: a later context's typed assignment
    // holds a real foreign key to a Topic, and a runtime that could delete the
    // row could orphan it. Enforced by the grant, not by an application check.
    const grants = await sourceOf(
      'packages/database/sql/permissions/grant-application-principal.sql',
    );

    for (const table of ['Topic', 'Language', 'Tag']) {
      expect(grants, `${table} must deny DELETE`).toMatch(
        new RegExp(`DENY DELETE, ALTER ON OBJECT::\\[dbo\\]\\.\\[${table}\\]`),
      );
    }

    // `TopicTranslation` is the one exception, and it is bounded: removing a
    // locale's name is a real administrative act, and the fallback row is still
    // protected by the trigger.
    expect(grants).toMatch(
      /GRANT SELECT, INSERT, UPDATE, DELETE ON OBJECT::\[dbo\]\.\[TopicTranslation\]/,
    );
  });
});

/* ===========================================================================
 * The administrative surfaces
 * ========================================================================= */

describe('Phase 3B — every taxonomy surface passes the gate', () => {
  it('guards every page with a server-side permission check', async () => {
    const pages = await walk(TAXONOMY_ROUTES, (name) => name === 'page.tsx');
    expect(pages.length).toBe(4);

    for (const page of pages) {
      const source = code(await sourceOf(page));

      expect(source, `${page} must check a permission server-side`).toContain(
        'requireAdminPage(',
      );
      expect(source, `${page} must require taxonomy.read`).toContain("'taxonomy.read'");
      expect(source, `${page} must be noindex`).toContain('robots: { index: false');
      expect(source, `${page} must not be cached`).toContain(
        "export const dynamic = 'force-dynamic'",
      );
    }
  });

  it('re-checks the permission in every mutation, at the action layer', async () => {
    const actions = code(await sourceOf(`${TAXONOMY_ROUTES}/actions.ts`));

    const exported = [...actions.matchAll(/export async function (\w+)\(/g)].map(
      (match) => match[1],
    );
    expect(exported.length).toBeGreaterThan(0);

    // ONE gate helper, called by every action. Counting the calls against the
    // number of exported actions is what makes a forgotten one a failure rather
    // than a review question.
    const gateCalls = [...actions.matchAll(/await taxonomyActor\(locale\)/g)].length;
    expect(gateCalls).toBe(exported.length);

    expect(actions).toContain("requirePermittedAction(locale, 'taxonomy.administer')");
  });

  it('exposes no API route for taxonomy administration', async () => {
    // A route would be a second path to these operations sitting outside the
    // Server Action wrappers, and outside the framework's CSRF protections.
    const apiRoutes = await walk('apps/web/src/app/api', (name) => name === 'route.ts');

    for (const route of apiRoutes) {
      expect(route).not.toContain('taxonomy');
    }
  });

  it('requires no step-up, and invents no new step-up purpose', async () => {
    // SECURITY_BASELINE.md §8.1 does not list taxonomy administration, and §8.2
    // says the requirement is "deliberately not universal". The vocabulary
    // names only operations §8.1 lists — Phase 2's three and Phase 18's
    // canonical Quran edit; one invented here would be a scope with no
    // operation behind it.
    const actions = code(await sourceOf(`${TAXONOMY_ROUTES}/actions.ts`));
    const permissions = await sourceOf('packages/contracts/src/identity/permissions.ts');

    expect(actions).not.toContain('requirePrivilegedActor');
    expect(actions).not.toContain('StepUpPurpose');

    const purposes =
      /export const STEP_UP_PURPOSES = Object\.freeze\(\[([\s\S]*?)\] as const\)/.exec(
        permissions,
      )?.[1];
    expect(purposes).toBeDefined();
    expect(
      [...(purposes ?? '').matchAll(/'([a-z-]+)'/g)].map((match) => match[1]),
    ).toEqual([
      'privilege-administration',
      'account-administration',
      'second-factor',
      'quran-canonical-edit',
    ]);
  });

  it('reaches no database capability from a route or an action', async () => {
    // Model A: Layer 4 composes, the context decides, the adapter writes. A
    // route that imported Prisma would be raw capability in the render tree.
    const files = await walk(
      TAXONOMY_ROUTES,
      (name) => name.endsWith('.ts') || name.endsWith('.tsx'),
    );

    for (const file of files) {
      const source = code(await sourceOf(file));

      expect(source, `${file} must not import Prisma`).not.toMatch(/@prisma\/client/);
      expect(source, `${file} must not import the database package`).not.toMatch(
        /from '@minhaj\/database'/,
      );
      expect(source, `${file} must not import mssql`).not.toMatch(/from 'mssql'/);
    }
  });
});

/* ===========================================================================
 * Localisation parity for the new surfaces
 * ========================================================================= */

describe('Phase 3B — the new interface strings exist in every locale', () => {
  it('declares the taxonomy namespace in all three catalogues', async () => {
    for (const locale of localeSchema.options) {
      const catalogue = JSON.parse(
        await sourceOf(`apps/web/messages/${locale}.json`),
      ) as { admin: { taxonomy?: Record<string, unknown>; nav: Record<string, string> } };

      expect(
        catalogue.admin.taxonomy,
        `${locale} must declare admin.taxonomy`,
      ).toBeDefined();
      expect(
        catalogue.admin.nav['taxonomy'],
        `${locale} must label the nav entry`,
      ).toBeTypeOf('string');
    }
  });

  it('writes the Urdu and Arabic taxonomy copy in their own scripts', async () => {
    // Key parity alone is satisfied by copying the English file. The prose has
    // to genuinely be in the language it claims.
    for (const locale of ['ur', 'ar']) {
      const catalogue = JSON.parse(
        await sourceOf(`apps/web/messages/${locale}.json`),
      ) as {
        admin: { taxonomy: { topics: { title: string }; tags: { notTopics: string } } };
      };

      expect(catalogue.admin.taxonomy.topics.title).toMatch(/\p{Script=Arabic}/u);
      expect(catalogue.admin.taxonomy.tags.notTopics).toMatch(/\p{Script=Arabic}/u);
    }
  });

  it('says the content-language distinction in every locale, not only English', async () => {
    // The distinction is the product on that screen. A notice that existed only
    // in English would leave the administrators most likely to be confused by a
    // screen labelled "languages" without it.
    for (const locale of localeSchema.options) {
      const catalogue = JSON.parse(
        await sourceOf(`apps/web/messages/${locale}.json`),
      ) as {
        admin: { taxonomy: { languages: { notInterfaceLocale: string } } };
      };

      expect(
        catalogue.admin.taxonomy.languages.notInterfaceLocale.length,
      ).toBeGreaterThan(40);
    }
  });
});

/* ===========================================================================
 * The validators at the trust boundary
 * ========================================================================= */

describe('Phase 3B — the schemas that validate administrative input', () => {
  it('accepts the identifier forms a content-language catalogue really holds', () => {
    // Including the BCP-47 PRIVATE-USE form. A validator that rejected
    // `qaa-x-...` would refuse a tag this repository's own recovery rehearsal
    // writes, which is a validator strict enough to be wrong.
    for (const code of [
      'en',
      'ur',
      'ar',
      'fa',
      'pa-arab',
      'zh-hans',
      'qaa-x-proof',
      'qaa-x-a1b2c3d4',
    ]) {
      expect(languageCodeSchema.safeParse(code).success, `${code} must parse`).toBe(true);
    }
  });

  it('canonicalises a language code rather than storing two spellings of one', () => {
    // The database compares codes by index. An application that accepted `UR`
    // and `ur` as different values would create two rows for one language.
    const parsed = languageCodeSchema.safeParse('  PA-Arab  ');

    expect(parsed.success).toBe(true);
    expect(parsed.success ? parsed.data : null).toBe('pa-arab');
  });

  it('refuses a language code that is not a language tag', () => {
    for (const code of [
      '',
      'e',
      'english language',
      'ur_PK',
      'ur/pk',
      "ur'; DROP TABLE Language;--",
      'x-only',
      'ur-',
      'a'.repeat(40),
    ]) {
      expect(
        languageCodeSchema.safeParse(code).success,
        `${JSON.stringify(code)} must be refused`,
      ).toBe(false);
    }
  });

  it('refuses a slug that could not safely appear in a URL', () => {
    // A slug is what `/topics/{slug}` will be built from, so the rule is narrow
    // on purpose: a permissive one would let two slugs a case-insensitive index
    // treats as one be accepted by the application as two.
    for (const schema of [topicSlugSchema, tagSlugSchema]) {
      for (const slug of [
        'Quran',
        'quran topic',
        'quran/hadith',
        'quran--hadith',
        '-quran',
        'quran-',
        'قرآن',
        'a',
        '',
      ]) {
        expect(
          schema.safeParse(slug).success,
          `${JSON.stringify(slug)} must be refused`,
        ).toBe(false);
      }

      for (const slug of [
        'quran',
        'ahl-al-bayt',
        'economics-and-finance',
        'topic-2024',
      ]) {
        expect(schema.safeParse(slug).success, `${slug} must parse`).toBe(true);
      }
    }
  });
});
