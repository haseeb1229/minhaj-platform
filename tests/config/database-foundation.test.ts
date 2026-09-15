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
    // audit foundation (SECURITY_BASELINE.md §13); the rest are Phase 2
    // Chunk 1 — Identity & Access, plus the Layer-0 concerns that phase first
    // genuinely needs (ARCHITECTURE.md §4.5, §4.6.1).
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
    ]);

    // Asserted against declared MODELS, not raw text: the schema comments name
    // the deferred domains in order to explain why they are absent, and a
    // substring match would read that explanation as the very violation it
    // documents.
    // `Role`, `Permission`, `RolePermission`, `RoleAssignment`, `StepUpGrant`,
    // `IdentityBootstrap` and `TwoFactor` belong to Phase 2 CHUNK 2 —
    // authorisation and privileged security — and must not appear until that
    // chunk delivers the enforcement that gives them meaning. The rest belong
    // to later phases entirely.
    for (const domain of [
      'Role',
      'Permission',
      'RolePermission',
      'RoleAssignment',
      'StepUpGrant',
      'IdentityBootstrap',
      'TwoFactor',
      'Article',
      'Page',
      'Quran',
      'Hadith',
      'Book',
    ]) {
      expect(models, `${domain} arrives with its owning slice`).not.toContain(domain);
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
