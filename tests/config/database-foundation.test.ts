import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { repoRoot } from '../architecture/architecture-harness.ts';

const databaseRoot = path.join(repoRoot, 'packages', 'database');

describe('Phase 1 Chunk 1 database foundation', () => {
  it('locks the exact stable Prisma 7.10.0 stack', async () => {
    const manifest = JSON.parse(
      await readFile(path.join(databaseRoot, 'package.json'), 'utf8'),
    ) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };

    expect(manifest.devDependencies.prisma).toBe('7.10.0');
    expect(manifest.dependencies['@prisma/client']).toBe('7.10.0');
    expect(manifest.dependencies['@prisma/adapter-mssql']).toBe('7.10.0');
  });

  it('marks every reachable database implementation entry as server-only', async () => {
    for (const entry of ['src/index.ts', 'src/client.ts', 'src/config.ts']) {
      const source = await readFile(path.join(databaseRoot, entry), 'utf8');
      expect(source, `${entry} must carry the server-only marker`).toMatch(
        /import\s+['"]server-only['"]/,
      );
    }
  });

  it('routes the package browser condition only to the failing target', async () => {
    const manifest = JSON.parse(
      await readFile(path.join(databaseRoot, 'package.json'), 'utf8'),
    ) as { exports: Record<string, Record<string, string>> };

    expect(manifest.exports['.']?.browser).toBe('./src/client-import-error.ts');
    await expect(
      import('../../packages/database/src/client-import-error.ts'),
    ).rejects.toThrow(/server-only/);
  });

  it('declares exactly the delivered models, and no later-phase domain', async () => {
    const schema = await readFile(
      path.join(databaseRoot, 'prisma', 'schema.prisma'),
      'utf8',
    );
    const prismaEntries = await readdir(path.join(databaseRoot, 'prisma'));

    // The schema is EXHAUSTIVE, so a model arriving without its owning phase
    // fails here rather than being noticed later. `AuditLog` is the Phase 1
    // audit foundation (SECURITY_BASELINE.md §13); then Phase 2 Chunk 1 —
    // Identity & Access, plus the Layer-0 concerns that phase first genuinely
    // needs (ARCHITECTURE.md §4.5, §4.6.1); then Phase 2 Chunk 2 —
    // authorisation, step-up and the privileged second factor; then Phase 3B —
    // the canonical taxonomy and the content-language reference data.
    const models = [...schema.matchAll(/^\s*model\s+(\w+)/gm)].map((match) => match[1]);
    expect(models).toEqual([
      'AuditLog',
      'User',
      'Session',
      'Account',
      'Verification',
      'IdentityCommunicationIntent',
      'IdentitySecurityOperation',
      'EmailDelivery',
      'EmailSuppression',
      'ProviderEvent',
      'RateLimitCounter',
      // Phase 2 Chunk 2.
      'Permission',
      'Role',
      'RolePermission',
      'RoleAssignment',
      'StepUpGrant',
      'TwoFactor',
      'PrivilegedSecurityPosture',
      'IdentityBootstrap',
      // Phase 3B — Taxonomy.
      'Topic',
      'TopicTranslation',
      'Language',
      'Tag',
      // Phase 5 — People & Contributors. FOUR PROFILE AGGREGATES, and the count
      // is part of the claim: DOMAIN_MODEL.md §5.2 requires Person, User and
      // the four profiles to stay six distinct models, so a migration that
      // delivered one `Profile` table with a `type` column would satisfy
      // "People shipped" and fail here.
      'Person',
      'PersonTranslation',
      'PersonNameVariant',
      'AuthorProfile',
      'SpeakerProfile',
      'ScholarProfile',
      'ScholarProfileTranslation',
      'ScholarProfileLanguage',
      'TeacherProfile',
      'TeacherProfileTranslation',
      'TeacherProfileLanguage',
      'Article',
      'ArticleRevision',
      'ArticleRevisionTranslation',
      'ArticleTopic',
      'ArticleContributor',
      'ArticleSlugHistory',
      'Page',
      'PageRevision',
      'PageRevisionTranslation',
      'PageTopic',
      'PageContributor',
      'PageSlugHistory',
      'ContactInquiry',
      'Feedback',
    ]);

    // Asserted against declared MODELS, not raw text: the schema comments name
    // the deferred domains in order to explain why they are absent, and a
    // substring match would read that explanation as the very violation it
    // documents.
    //
    // The authorisation models left this list when Chunk 2 delivered the
    // enforcement that gives them meaning. Everything remaining belongs to a
    // later phase entirely.
    for (const domain of [
      'NewsArticle',
      'Event',
      'Collection',
      'Quran',
      'Hadith',
      'Book',
    ]) {
      expect(models, `${domain} arrives with its owning slice`).not.toContain(domain);
    }

    // The two shapes Phase 5 must NOT have produced, asserted by name beside
    // the deferred domains above. A single `Profile` table would be §5.2's
    // merge; a generic `Contribution` would be §6.2's polymorphic pair one
    // boundary along, with a real foreign key to the contributor and a type
    // string for the work.
    for (const merged of ['Profile', 'ContributorProfile', 'Contribution']) {
      expect(models, `${merged} is a shape the model prohibits`).not.toContain(merged);
    }

    expect(prismaEntries).toContain('migrations');
  });

  it('keeps database secrets out of the public contracts root', async () => {
    const publicContracts = await readFile(
      path.join(repoRoot, 'packages', 'contracts', 'src', 'index.ts'),
      'utf8',
    );

    expect(publicContracts).not.toContain('DATABASE_URL');
    expect(publicContracts).not.toContain('DATABASE_MIGRATION_URL');
  });

  it('defines the official SQL Server 2022 Developer service without a password', async () => {
    const compose = await readFile(path.join(repoRoot, 'docker', 'compose.yaml'), 'utf8');

    expect(compose).toContain('mcr.microsoft.com/mssql/server:2022-latest');
    expect(compose).toMatch(/MSSQL_PID:\s*Developer/);
    expect(compose).toContain('14330}:1433');
    expect(compose).toContain('${MSSQL_SA_PASSWORD:');
    const passwordLine = compose
      .split('\n')
      .find((line) => line.trim().startsWith('MSSQL_SA_PASSWORD:'));
    expect(passwordLine?.trim()).toMatch(/^MSSQL_SA_PASSWORD:\s*\$\{/);
  });
});
