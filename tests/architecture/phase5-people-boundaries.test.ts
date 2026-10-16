import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { contextAllowlist } from '../../packages/config/eslint/contexts.js';
import {
  CONTRIBUTION_ROLES,
  MAX_NAME_VARIANTS_PER_LOCALE,
  PROFILE_KINDS,
} from '../../packages/contracts/src/people/index.ts';
import {
  CONTRIBUTOR_CAPABILITY_SOURCES,
  EXTERNALLY_GATED_PERMISSIONS,
  PERMISSION_CATALOGUE,
  PLATFORM_ADMINISTRATOR_PERMISSIONS,
} from '../../packages/contracts/src/identity/index.ts';
import { repoRoot } from './architecture-harness.ts';

/**
 * PHASE 5 — the boundaries People & Contributors must hold.
 *
 * THE AUTHORITATIVE DEPENDENCY GATE IS `scripts/check-architecture.mjs`, which
 * resolves every import specifier to a real file and runs as its own process.
 * This suite does not restate it. What it proves is the set of claims specific
 * to this phase that a dependency graph cannot express:
 *
 *   - six models stayed six, in the schema and in the code;
 *   - a profile grants nothing, and there is no code that could make it;
 *   - the capability projections are Identity's, derived live, never stored;
 *   - the contribution-role vocabulary exists without a relationship to hang on;
 *   - the bound in the contract and the bound in the trigger are the same
 *     number.
 *
 * SOURCE PROOFS. The behavioural halves live in `tests/people/` against a real
 * database and in the browser suite against a running application; these are
 * the claims that are properties of the code rather than of a run.
 */

const APP_SRC = path.join(repoRoot, 'apps', 'web', 'src');
const CONTEXT_DIR = path.join(APP_SRC, 'contexts', 'people-contributors');
const ADAPTER_DIR = path.join(
  repoRoot,
  'packages',
  'database',
  'src',
  'adapters',
  'people-contributors',
);
/** Source with comments removed — the prose here names what it prohibits. */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
}

async function filesUnder(directory: string): Promise<string[]> {
  const found: string[] = [];

  async function visit(current: string): Promise<void> {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const child = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(child);
      else found.push(child);
    }
  }

  await visit(directory);
  return found;
}

async function sourcesUnder(directory: string): Promise<[string, string][]> {
  const files = await filesUnder(directory);
  return Promise.all(
    files.map(async (file) => [
      path.relative(repoRoot, file).split(path.sep).join('/'),
      await readFile(file, 'utf8'),
    ]),
  );
}

/**
 * SQL with its comments removed.
 *
 * THE SAME REASON `code()` EXISTS FOR TYPESCRIPT. The migration explains at
 * length which shapes it must not create — "no table here for a `targetType` +
 * `targetId` pair" — and matching raw text would report that explanation as the
 * very violation it documents.
 */
function sql(source: string): string {
  return source.replace(/--.*$/gm, '');
}

async function sourceOf(relativePath: string): Promise<string> {
  return readFile(path.join(repoRoot, relativePath), 'utf8');
}

/* ===========================================================================
 * The context's dependencies
 * ========================================================================= */

describe('People depends on Layer 0 and Identity, and on nothing else', () => {
  it('has exactly the allowlist row DOMAIN_MODEL.md §3.1 gives it', () => {
    // A transcription check, not an interpretation. §3.1: "People &
    // Contributors | Layer 0; Identity & Access *(to link a Person to an
    // optional User)*".
    expect(contextAllowlist['people-contributors']).toEqual(['identity-access']);
  });

  it('imports no other bounded context, Taxonomy included', async () => {
    // TAXONOMY IS THE TEMPTING ONE, which is why it is named. A scholar's
    // expertise and a teacher's subjects look like topics, and a content
    // language looks like `Language` — and every one of those would be the edge
    // the allowlist excludes. People validates a language code with its own
    // schema and stores subjects as localised prose for exactly this reason.
    const forbidden = [
      'taxonomy',
      'editorial',
      'quran',
      'hadith',
      'library',
      'media',
      'fatwa',
      'learning',
      'personalisation-notifications',
      'messaging',
      'global-network',
      'membership',
      'donations',
      'migration-provenance',
    ];

    for (const [file, source] of await sourcesUnder(CONTEXT_DIR)) {
      const body = code(source);

      for (const slug of forbidden) {
        expect(body, `${file} reaches contexts/${slug}`).not.toContain(
          `contexts/${slug}`,
        );
      }

      // The Layer-0 CONTRACT subpath for Taxonomy is refused as well. It is
      // browser-safe types, so the analyser would permit it — and importing it
      // would still be People reading Taxonomy's vocabulary, which is the edge
      // in a form the package boundary does not catch.
      expect(body, `${file} imports the Taxonomy contract`).not.toContain(
        '@minhaj/contracts/taxonomy',
      );
    }
  });

  it('reaches no infrastructure: no Prisma, no database package, no server-core', async () => {
    for (const [file, source] of await sourcesUnder(CONTEXT_DIR)) {
      const body = code(source);

      for (const forbidden of [
        '@minhaj/database',
        '@minhaj/server-core',
        '@prisma/client',
        'mssql',
        'better-auth',
      ]) {
        expect(body, `${file} imports ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('reaches Identity through a narrow port rather than the Identity context', async () => {
    // THE EDGE IS PERMITTED AND IS STILL NOT TAKEN DIRECTLY. Importing
    // `@/contexts/identity-access` would hand People Identity's whole public
    // interface — sign-in, closure, privileged administration — in order to use
    // two read operations. `ContributorAccountPort` is those two operations,
    // and Layer 4 implements it (DOMAIN_MODEL.md §3.3).
    for (const [file, source] of await sourcesUnder(CONTEXT_DIR)) {
      expect(code(source), `${file} imports the Identity context`).not.toContain(
        'contexts/identity-access',
      );
    }

    const service = await sourceOf(
      'apps/web/src/contexts/people-contributors/application/people-service.ts',
    );
    expect(service).toContain('ContributorAccountPort');
  });

  it('keeps its adapter private to the database package', async () => {
    // The adapter is reachable only through the package's single entry, which
    // re-exports two factories and one error class. Publishing the directory
    // would make it a package entry that reaches Prisma — raw capability on a
    // public API (ARCHITECTURE.md §4.1).
    const manifest = JSON.parse(await sourceOf('packages/database/package.json')) as {
      exports: Record<string, unknown>;
    };

    expect(Object.keys(manifest.exports)).toEqual(['.']);

    const entry = await sourceOf(
      'packages/database/src/adapters/people-contributors/index.ts',
    );
    expect(entry).toContain('createPeopleReader');
    expect(entry).toContain('createPeoplePersistence');
    expect(entry).not.toContain('getDatabaseClient');
    expect(entry).not.toContain('PrismaClient');
  });

  it('exposes no Prisma type across the adapter boundary', async () => {
    // `Prisma` is named INSIDE the adapter — it needs a transaction client type
    // and an include shape — and must not be on what the boundary re-exports.
    const entry = await sourceOf(
      'packages/database/src/adapters/people-contributors/index.ts',
    );

    expect(code(entry)).not.toContain('Prisma');
  });
});

/* ===========================================================================
 * Six distinct models
 * ========================================================================= */

describe('Person, User and the four profiles stay six distinct models', () => {
  it('declares four separate profile models, each with its own Person key', async () => {
    const schema = await sourceOf('packages/database/prisma/schema.prisma');

    for (const model of [
      'AuthorProfile',
      'SpeakerProfile',
      'ScholarProfile',
      'TeacherProfile',
    ]) {
      expect(schema, model).toMatch(new RegExp(`^model ${model} \\{`, 'm'));
    }

    // Four `personId String @unique`, one per profile model. Fewer would mean
    // one Person could hold two of a kind; a shared table would mean one.
    const uniquePersonKeys = [...schema.matchAll(/personId\s+String\s+@unique/g)];
    expect(uniquePersonKeys).toHaveLength(4);
  });

  it('declares no discriminated profile model under any name', async () => {
    const schema = await sourceOf('packages/database/prisma/schema.prisma');
    const models = [...schema.matchAll(/^model\s+(\w+)/gm)].map((match) => match[1]);

    for (const merged of [
      'Profile',
      'ContributorProfile',
      'PersonProfile',
      'Contributor',
    ]) {
      expect(models, `${merged} would be the merge §5.2 prohibits`).not.toContain(merged);
    }
  });

  it('gives Person no boolean that duplicates a facet', async () => {
    // `isAuthor` beside an `AuthorProfile` row would be two sources of truth
    // for one fact, and the boolean is the one that would be wrong.
    const schema = await sourceOf('packages/database/prisma/schema.prisma');
    const person = schema.slice(
      schema.indexOf('model Person {'),
      schema.indexOf('model PersonTranslation {'),
    );

    expect(person.length).toBeGreaterThan(0);
    for (const kind of PROFILE_KINDS) {
      const flag = `is${kind[0]?.toUpperCase() ?? ''}${kind.slice(1)}`;
      expect(person, flag).not.toContain(flag);
    }
    expect(person).not.toMatch(/\bBoolean\b/);
  });

  it('names all four kinds in the contract, in one place', () => {
    expect([...PROFILE_KINDS]).toEqual(['author', 'speaker', 'scholar', 'teacher']);
  });
});

/* ===========================================================================
 * A profile grants nothing
 * ========================================================================= */

describe('nothing in People can grant, store or fabricate a capability', () => {
  it('stores no capability column anywhere in the People schema', async () => {
    // COMMENTS STRIPPED FIRST. The schema explains at length that `canTeach`
    // and its three siblings are projections which must never be stored, and
    // matching raw text would report that explanation as the violation.
    const schema = code(await sourceOf('packages/database/prisma/schema.prisma'));
    // The People models only — Person and its profiles, up to the Editorial
    // models that follow them. A later domain's own image relation (Phase 12's
    // GalleryItem names its Photo) is not a People field.
    const start = schema.indexOf('model Person {');
    const end = schema.indexOf('model Article {');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const people = schema.slice(start, end);
    expect(people).toContain('model TeacherProfileLanguage {');

    expect(people.length).toBeGreaterThan(0);
    for (const capability of Object.keys(CONTRIBUTOR_CAPABILITY_SOURCES)) {
      expect(people, capability).not.toContain(capability);
    }
  });

  it('writes no RoleAssignment and no Permission from the People context', async () => {
    for (const [file, source] of await sourcesUnder(CONTEXT_DIR)) {
      const body = code(source);

      for (const forbidden of ['RoleAssignment', 'roleAssignment', 'permissions.grant']) {
        expect(body, `${file} names ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('writes no RoleAssignment from the People adapter', async () => {
    // The adapter is the only writer People has, and it holds a real
    // transaction client — so this is where a grant could actually be made.
    for (const [file, source] of await sourcesUnder(ADAPTER_DIR)) {
      const body = code(source);

      for (const forbidden of [
        'roleAssignment',
        'rolePermission',
        'permission.',
        'stepUpGrant',
      ]) {
        expect(body, `${file} names ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('offers no grant control on the People admin surface', async () => {
    const actions = code(
      await sourceOf('apps/web/src/app/[locale]/admin/people/actions.ts'),
    );

    for (const forbidden of [
      'grantRole',
      'revokeRole',
      'permissions.grant',
      'requirePrivilegedActor',
      'PrivilegedActor',
      'StepUpPurpose',
    ]) {
      expect(actions, forbidden).not.toContain(forbidden);
    }
  });

  it('gates EVERY People Server Action on people.administer, and refuses on denial', async () => {
    // PER ACTION, not once for the file. A single `requirePermittedAction`
    // somewhere in the module would satisfy a substring check while a new
    // action beside it went ungated — and the ungated one is always the one
    // nobody tested. This is the shape the Phase-2 suite established for the
    // Identity actions, applied to this phase's.
    //
    // It is also what makes "an operator holding only `people.read` cannot
    // mutate" a property of the code: the gate re-resolves the session and
    // re-reads the permission set live on every submit, whatever the page that
    // rendered the form decided minutes earlier (SECURITY_BASELINE.md §3.4
    // rule 2).
    const source = code(
      await sourceOf('apps/web/src/app/[locale]/admin/people/actions.ts'),
    );

    const exported = [...source.matchAll(/export async function (\w+)\(/g)].map(
      (match) => match[1] ?? '',
    );
    expect(exported.length).toBeGreaterThan(8);

    for (const name of exported) {
      const start = source.indexOf(`export async function ${name}(`);
      const next = exported
        .map((other) => source.indexOf(`export async function ${other}(`))
        .filter((index) => index > start);
      const body = source.slice(start, next.length > 0 ? Math.min(...next) : undefined);

      // The single gate helper, which is the only producer of a `PeopleActor`.
      expect(body, `${name} must resolve the actor through the gate`).toContain(
        'peopleActor(locale)',
      );
      // And it must ACT on the refusal rather than merely computing it.
      expect(body, `${name} must refuse on a denial`).toMatch(
        /if \(!gate\.ok\) return failed\(gate\.failure\)/,
      );
      // And validate its input at the trust boundary before doing anything.
      expect(body, `${name} must validate its input`).toContain('safeParse');
    }

    // The helper itself asks for the administer permission, and no other.
    expect(source).toContain("requirePermittedAction(locale, 'people.administer')");
  });

  it('keeps each capability source with its owner, and the Fatwa ones externally gated', () => {
    // THE SHORTCUT NOT TAKEN. Seeding one of these early would have made a
    // projection test trivial. Each arrives with its owner: `content.review`
    // with Editorial (Phase 6); `question.receive` and `fatwa.publish` with
    // Fatwa (Phase 20), catalogued but EXTERNALLY GATED — bundled into no role,
    // because OPEN_DECISIONS.md §6.3 reserves who receives them to the
    // organisation; `teaching.perform` arrived with Phase 23's teacher slice —
    // Phase 22 shipped Learning's catalogue keys and deliberately not it — and
    // is EXTERNALLY GATED in the same way: catalogued, bundled into no role.
    const catalogue: readonly string[] = PERMISSION_CATALOGUE.map((entry) => entry.key);
    const gated: readonly string[] = EXTERNALLY_GATED_PERMISSIONS;
    const bundled: readonly string[] = PLATFORM_ADMINISTRATOR_PERMISSIONS;

    for (const source of Object.values(CONTRIBUTOR_CAPABILITY_SOURCES)) {
      if (source === 'content.review') {
        expect(catalogue).toContain(source);
        expect(bundled).toContain(source);
      } else {
        expect(catalogue, source).toContain(source);
        expect(gated, `${source} is the organisation's to grant`).toContain(source);
        expect(bundled, `${source} is bundled into no role`).not.toContain(source);
      }
    }
  });

  it('seeds neither capability permission in the Phase-5 migration', async () => {
    const migration = await sourceOf(
      'packages/database/prisma/migrations/20260919000000_phase5_people_contributors/migration.sql',
    );

    // The two keys it DOES seed, and nothing else in the `INSERT` statement.
    expect(migration).toContain("N'people.read'");
    expect(migration).toContain("N'people.administer'");

    const inserts = migration.slice(
      migration.indexOf('INSERT INTO [dbo].[Permission]'),
      migration.indexOf('EXTENDING THE PROTECTED PLATFORM ADMINISTRATOR BUNDLE'),
    );
    expect(inserts.length).toBeGreaterThan(0);

    for (const source of Object.values(CONTRIBUTOR_CAPABILITY_SOURCES)) {
      expect(inserts, source).not.toContain(source);
    }
  });

  it('pays for its privilege change the way every other phase does', async () => {
    // SECURITY_BASELINE.md §8.1: a change to what an account may do revokes the
    // holders' sessions and step-up grants in the SAME transaction.
    const migration = await sourceOf(
      'packages/database/prisma/migrations/20260919000000_phase5_people_contributors/migration.sql',
    );

    expect(migration).toContain('DELETE FROM [dbo].[StepUpGrant]');
    expect(migration).toContain('DELETE FROM [dbo].[Session]');
    expect(migration).toContain("N'people.permissions.provisioned'");
  });
});

/* ===========================================================================
 * Contribution roles — a vocabulary, not a relationship
 * ========================================================================= */

describe('the contribution-role vocabulary has nothing to hang on', () => {
  it('is exactly the seven capacities DOMAIN_MODEL.md §5.3 names', () => {
    expect([...CONTRIBUTION_ROLES]).toEqual([
      'author',
      'translator',
      'editor',
      'compiler',
      'narrator',
      'reciter',
      'speaker',
    ]);
  });

  it('creates no contribution table and no polymorphic target', async () => {
    const migration = sql(
      await sourceOf(
        'packages/database/prisma/migrations/20260919000000_phase5_people_contributors/migration.sql',
      ),
    );

    expect(migration.length).toBeGreaterThan(0);

    // ASSERTED AGAINST THE TABLES THIS MIGRATION CREATES, not against the whole
    // file, and the distinction is a real one rather than a convenience.
    //
    // `AuditLog` carries `targetType` and `targetId`, and legitimately: it is
    // Phase-1 evidence whose target may be any record in the platform,
    // including ones whose tables no longer exist. DOMAIN_MODEL.md §6.2
    // prohibits the pair as a RELATIONAL reference — a junction pretending to
    // have a foreign key — and the audit record is explicitly the other case
    // (SECURITY_BASELINE.md §13). This migration writes one audit row, so the
    // strings appear; what must not appear is a CREATE TABLE declaring them.
    const created = [...migration.matchAll(/CREATE TABLE\s+\[dbo\]\.\[(\w+)\]([^;]*)/g)];
    expect(created.length).toBe(11);

    for (const [, table, body] of created) {
      for (const forbidden of ['targetType', 'targetId']) {
        expect(body ?? '', `${table ?? ''} declares ${forbidden}`).not.toContain(
          forbidden,
        );
      }
    }

    // And no table of a prohibited NAME was created either, because a
    // prohibited design renamed is still the prohibited design.
    const names = created.map(([, table]) => table);
    for (const forbidden of [
      'Contribution',
      'ContributorTarget',
      'ContributionTarget',
      'PersonContribution',
      'Profile',
    ]) {
      expect(names, forbidden).not.toContain(forbidden);
    }
  });

  it('declares no shape a generic contribution could be built on', async () => {
    const contract = code(await sourceOf('packages/contracts/src/people/values.ts'));
    const ports = code(await sourceOf('packages/contracts/src/people/ports.ts'));

    for (const forbidden of ['targetType', 'targetId', 'ContributorReference']) {
      expect(contract, forbidden).not.toContain(forbidden);
      expect(ports, forbidden).not.toContain(forbidden);
    }
  });

  it('creates no schema belonging to a later phase', async () => {
    const migration = await sourceOf(
      'packages/database/prisma/migrations/20260919000000_phase5_people_contributors/migration.sql',
    );

    // Storage arrives at Phase 7, Search at Phase 17, Editorial at Phase 6.
    for (const forbidden of [
      'StorageObject',
      'Asset',
      'SearchIndex',
      'SearchDocument',
      'Article',
      'Page',
    ]) {
      expect(migration, forbidden).not.toContain(`[dbo].[${forbidden}]`);
    }
  });

  it('introduces no image, asset or external URL field', async () => {
    const schema = await sourceOf('packages/database/prisma/schema.prisma');
    // The People models only — Person and its profiles, up to the Editorial
    // models that follow them. A later domain's own image relation (Phase 12's
    // GalleryItem names its Photo) is not a People field.
    const start = schema.indexOf('model Person {');
    const end = schema.indexOf('model Article {');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const people = schema.slice(start, end);
    expect(people).toContain('model TeacherProfileLanguage {');

    for (const forbidden of ['image', 'avatar', 'photo', 'portrait', 'imageUrl']) {
      expect(people, forbidden).not.toMatch(new RegExp(`^\\s+${forbidden}\\b`, 'mi'));
    }
  });
});

/* ===========================================================================
 * The two numbers that must agree
 * ========================================================================= */

describe('the contract and the database agree on the bounds they share', () => {
  it('states the same name-variant bound in the contract and the trigger', async () => {
    // The contract documents it and the trigger enforces it. Two numbers that
    // drifted apart would mean an interface promising a limit the database does
    // not apply, or refusing one it does — the same arrangement the Phase-3B
    // depth bound uses.
    const migration = await sourceOf(
      'packages/database/prisma/migrations/20260919000000_phase5_people_contributors/migration.sql',
    );

    expect(migration).toContain(`HAVING COUNT_BIG(*) > ${MAX_NAME_VARIANTS_PER_LOCALE}`);
    expect(migration).toContain(
      `at most ${MAX_NAME_VARIANTS_PER_LOCALE} name variants per locale`,
    );
  });

  it('gives the two People triggers refusal numbers no other phase uses', async () => {
    // A collision would make one context report another's invariant, because
    // each adapter translates the number into its own failure vocabulary.
    const migrationDirectory = path.join(
      repoRoot,
      'packages',
      'database',
      'prisma',
      'migrations',
    );

    const numbers = new Map<string, string[]>();
    for (const entry of await readdir(migrationDirectory)) {
      const file = path.join(migrationDirectory, entry, 'migration.sql');
      try {
        if (!(await stat(file)).isFile()) continue;
      } catch {
        continue;
      }

      const source = await readFile(file, 'utf8');
      for (const match of source.matchAll(/THROW\s+(\d{5})/g)) {
        const thrown = match[1] ?? '';
        numbers.set(thrown, [...(numbers.get(thrown) ?? []), entry]);
      }
    }

    for (const [thrown, migrations] of numbers) {
      expect(
        new Set(migrations).size,
        `${thrown} is thrown by ${migrations.join(', ')}`,
      ).toBe(1);
    }

    expect(numbers.get('51040')).toBeDefined();
    expect(numbers.get('51041')).toBeDefined();
  });

  it('recognises those numbers, and only those, as People refusals', async () => {
    // COMMENTS STRIPPED: the module explains that its numbers are allocated
    // ABOVE Phase 3B's block, and naming that block in prose is not recognising
    // it in code.
    const refusals = code(
      await sourceOf('packages/database/src/adapters/people-contributors/refusals.ts'),
    );

    expect(refusals).toContain('51040');
    expect(refusals).toContain('51041');
    // Phase 3B's block must not be recognised here, or a taxonomy refusal would
    // surface as a People one.
    for (const taxonomy of ['51030', '51031', '51032', '51033']) {
      expect(refusals, taxonomy).not.toContain(taxonomy);
    }
  });
});

/* ===========================================================================
 * No account data on a public shape
 * ========================================================================= */

describe('no public shape carries account data', () => {
  it('keeps the linked account identifier off every public type', async () => {
    const values = await sourceOf('packages/contracts/src/people/values.ts');

    const publicShape = values.slice(
      values.indexOf('export interface PublicPersonProfile'),
      values.indexOf('export interface ProfileTranslationView'),
    );
    expect(publicShape.length).toBeGreaterThan(0);

    for (const forbidden of ['linkedAccountId', 'userId', 'email', 'accountId']) {
      expect(publicShape, forbidden).not.toContain(forbidden);
    }
  });

  it('carries only a boolean on the listing shape', async () => {
    const values = await sourceOf('packages/contracts/src/people/values.ts');

    const listing = values.slice(
      values.indexOf('export interface PersonView'),
      values.indexOf('export interface ProfileDetail'),
    );
    expect(listing).toContain('readonly linked: boolean;');
    expect(listing).not.toContain('linkedAccountId');
  });

  it('never selects an account column in the People adapter', async () => {
    // People stores an opaque identifier and asks Identity's own service about
    // it. A join into `User` here would be a cross-context read wearing a query
    // builder's clothes.
    for (const [file, source] of await sourcesUnder(ADAPTER_DIR)) {
      const body = code(source);

      for (const forbidden of ['prisma.user', 'tx.user', 'user: {', '.user.findUnique']) {
        expect(body, `${file} reads the User table (${forbidden})`).not.toContain(
          forbidden,
        );
      }
    }
  });
});
