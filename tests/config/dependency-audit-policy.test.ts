import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { repoRoot } from '../architecture/architecture-harness.ts';
// @ts-expect-error — the enforcement scripts are plain ESM, deliberately not
// part of a TypeScript project. The test consumes them exactly as the gate does.
import {
  auditExceptions,
  evaluateAuditReport,
  evaluateExceptionChain,
  findAzureIdentityExposure,
} from '../../scripts/shared/dependency-audit-policy.mjs';
// @ts-expect-error — plain ESM, as above.
import { discoverWorkspaces } from '../../scripts/shared/workspaces.mjs';

/**
 * The dependency-audit gate (SECURITY_BASELINE.md §18.3).
 *
 * Every Critical and every High finding fails, except one reviewed advisory
 * (GHSA-xcx6-jx8p-x3h5 on @azure/msal-node), and that exception fails the
 * moment it is stale, its dependency chain moves, or One Minhaj starts using
 * the code it covers. Every case is a SYNTHETIC audit report, lockfile or
 * source file passed to the engine; nothing here runs npm or reaches the
 * network. The CLI runs the real audit in CI.
 */

type Json = Record<string, unknown>;

const MSAL_ADVISORY = {
  source: 1243111,
  name: '@azure/msal-node',
  dependency: '@azure/msal-node',
  title:
    'MSAL Node authorization code flow may disclose parameters to an attacker-controlled endpoint',
  url: 'https://github.com/advisories/GHSA-xcx6-jx8p-x3h5',
  severity: 'high',
  range: '>=5.0.0-beta.0 <7.1.0',
};

/** The shape `npm audit --json` reports for the reviewed chain today. */
function baseReport(): Json & { vulnerabilities: Record<string, Json> } {
  return {
    auditReportVersion: 2,
    vulnerabilities: {
      '@azure/identity': {
        name: '@azure/identity',
        severity: 'high',
        isDirect: false,
        via: ['@azure/msal-node'],
        effects: [],
        range: '>=4.13.1',
        nodes: ['node_modules/@azure/identity'],
      },
      '@azure/msal-node': {
        name: '@azure/msal-node',
        severity: 'high',
        isDirect: false,
        via: [{ ...MSAL_ADVISORY }],
        effects: ['@azure/identity'],
        range: '5.0.0-beta.0 - 7.0.2',
        nodes: ['node_modules/@azure/msal-node'],
      },
    },
    metadata: { vulnerabilities: { high: 2, critical: 0, total: 2 } },
  };
}

function finding(name: string, severity: string, via: unknown[]): Json {
  return {
    name,
    severity,
    isDirect: false,
    via,
    effects: [],
    nodes: [`node_modules/${name}`],
  };
}

function advisory(name: string, severity: string, ghsa: string): Json {
  return {
    name,
    dependency: name,
    title: 'synthetic advisory',
    url: `https://github.com/advisories/${ghsa}`,
    severity,
    range: '<9.9.9',
  };
}

function failuresFor(mutate?: (report: ReturnType<typeof baseReport>) => void): string[] {
  const report = baseReport();
  mutate?.(report);
  return evaluateAuditReport(report).failures as string[];
}

/** The reviewed chain as the committed lockfile records it. */
function baseLock(): { packages: Record<string, Json> } {
  return {
    packages: {
      '': {},
      'packages/database': { dependencies: { mssql: '12.7.0' } },
      'node_modules/@prisma/adapter-mssql': {
        version: '7.10.0',
        dependencies: { mssql: '^12.7.0' },
      },
      'node_modules/mssql': {
        version: '12.7.0',
        dependencies: { tedious: '^19.2.2 || ^20.0.0' },
      },
      'node_modules/tedious': {
        version: '20.3.6',
        dependencies: { '@azure/identity': '^4.13.1' },
      },
      'node_modules/@azure/identity': {
        version: '4.13.2',
        dependencies: { '@azure/msal-node': '^5.1.5' },
      },
      'node_modules/@azure/msal-node': { version: '5.6.0' },
    },
  };
}

function baseManifests(): { directory: string; manifest: Json }[] {
  return [
    { directory: '', manifest: { name: 'minhaj-platform' } },
    { directory: 'packages/database', manifest: { dependencies: { mssql: '12.7.0' } } },
  ];
}

function chainFailuresFor(
  mutate?: (
    lock: ReturnType<typeof baseLock>,
    manifests: ReturnType<typeof baseManifests>,
  ) => void,
): string[] {
  const lock = baseLock();
  const manifests = baseManifests();
  mutate?.(lock, manifests);
  return evaluateExceptionChain({ lock, manifests }) as string[];
}

describe('the reviewed exception is exact', () => {
  it('records one advisory, on one package, with its affected range', () => {
    expect(auditExceptions).toHaveLength(1);
    expect(auditExceptions[0]).toMatchObject({
      advisory: 'GHSA-xcx6-jx8p-x3h5',
      package: '@azure/msal-node',
      severity: 'high',
      affectedRange: '>=5.0.0-beta.0 <7.1.0',
      carriers: ['@azure/identity'],
    });
  });

  it('passes the report npm produces for the reviewed chain today', () => {
    const result = evaluateAuditReport(baseReport());
    expect(result.failures).toEqual([]);
    expect(result.excepted).toEqual(['GHSA-xcx6-jx8p-x3h5']);
  });
});

describe('every Critical and every other High fails', () => {
  it('fails a Critical finding on any package', () => {
    const failures = failuresFor((report) => {
      report.vulnerabilities['next'] = finding('next', 'critical', [
        advisory('next', 'critical', 'GHSA-aaaa-bbbb-cccc'),
      ]);
    });
    expect(failures.join('\n')).toMatch(/next: critical advisory GHSA-aaaa-bbbb-cccc/);
  });

  it('fails a Critical advisory even on the excepted package', () => {
    const failures = failuresFor((report) => {
      report.vulnerabilities['@azure/msal-node']!['severity'] = 'critical';
      (report.vulnerabilities['@azure/msal-node']!['via'] as unknown[]).push(
        advisory('@azure/msal-node', 'critical', 'GHSA-cccc-dddd-ffff'),
      );
    });
    expect(failures.join('\n')).toMatch(/@azure\/msal-node: critical advisory/);
  });

  it('fails a High finding on any other package', () => {
    const failures = failuresFor((report) => {
      report.vulnerabilities['zod'] = finding('zod', 'high', [
        advisory('zod', 'high', 'GHSA-mrhx-c7xc-m3w5'),
      ]);
    });
    expect(failures.join('\n')).toMatch(/zod: high advisory GHSA-mrhx-c7xc-m3w5/);
  });

  it('fails a second High advisory on the excepted package', () => {
    const failures = failuresFor((report) => {
      (report.vulnerabilities['@azure/msal-node']!['via'] as unknown[]).push(
        advisory('@azure/msal-node', 'high', 'GHSA-gggg-hhhh-jjjj'),
      );
    });
    expect(failures.join('\n')).toMatch(/GHSA-gggg-hhhh-jjjj/);
  });

  it('matches the advisory, not the package name alone', () => {
    const failures = failuresFor((report) => {
      report.vulnerabilities['@azure/msal-node']!['via'] = [
        advisory('@azure/msal-node', 'high', 'GHSA-mmmm-pppp-qqqq'),
      ];
    });
    expect(failures.join('\n')).toMatch(/GHSA-mmmm-pppp-qqqq/);
    expect(failures.join('\n')).toMatch(/stale exception/);
  });

  it('fails when the advisory widens its affected range', () => {
    const failures = failuresFor((report) => {
      report.vulnerabilities['@azure/msal-node']!['via'] = [
        { ...MSAL_ADVISORY, range: '>=5.0.0-beta.0 <7.2.0' },
      ];
    });
    expect(failures.join('\n')).toMatch(
      /@azure\/msal-node: high advisory GHSA-xcx6-jx8p-x3h5/,
    );
  });

  it('fails a package that becomes High through the excepted one but is not its reviewed carrier', () => {
    const failures = failuresFor((report) => {
      report.vulnerabilities['tedious'] = finding('tedious', 'high', [
        '@azure/msal-node',
      ]);
    });
    expect(failures.join('\n')).toMatch(/tedious: high through @azure\/msal-node/);
  });

  it('fails the carrier when it is High for any other reason', () => {
    const failures = failuresFor((report) => {
      report.vulnerabilities['@azure/identity']!['via'] = [
        '@azure/msal-node',
        '@azure/core-rest-pipeline',
      ];
    });
    expect(failures.join('\n')).toMatch(/@azure\/identity: high through/);
  });

  it('does not fail below the High threshold, as --audit-level=high did not', () => {
    const result = evaluateAuditReport(
      (() => {
        const report = baseReport();
        report.vulnerabilities['fast-uri'] = finding('fast-uri', 'moderate', [
          advisory('fast-uri', 'moderate', 'GHSA-w74x-v6f9-j3xg'),
        ]);
        return report;
      })(),
    );
    expect(result.failures).toEqual([]);
    expect(result.findings).toContainEqual({
      package: 'fast-uri',
      severity: 'moderate',
      disposition: 'reported (below the high threshold)',
    });
  });
});

describe('the exception cannot go stale', () => {
  it('fails when the advisory is no longer reported', () => {
    const failures = failuresFor((report) => {
      report.vulnerabilities = {};
      report['metadata'] = { vulnerabilities: { total: 0 } };
    });
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(/stale exception: GHSA-xcx6-jx8p-x3h5/);
  });
});

describe('unusable audit output fails closed', () => {
  it.each([
    ['not an object', null],
    ['an npm error', { error: { code: 'ENOTFOUND', summary: 'request failed' } }],
    ['a different report version', { auditReportVersion: 1, advisories: {} }],
    ['no vulnerability data', { auditReportVersion: 2 }],
  ])('fails on %s', (_label, report) => {
    expect((evaluateAuditReport(report).failures as string[]).length).toBeGreaterThan(0);
  });

  it('fails on an unknown severity', () => {
    const failures = failuresFor((report) => {
      report.vulnerabilities['left-pad'] = finding('left-pad', 'severe', [
        advisory('left-pad', 'severe', 'GHSA-rrrr-vvvv-wwww'),
      ]);
    });
    expect(failures.join('\n')).toMatch(/left-pad: unreadable audit entry/);
  });
});

describe('the reviewed dependency chain is proved from the lockfile', () => {
  it('accepts the reviewed chain', () => {
    expect(chainFailuresFor()).toEqual([]);
  });

  it('fails when the excepted package moves', () => {
    expect(
      chainFailuresFor((lock) => {
        lock.packages['node_modules/@azure/msal-node'] = { version: '6.0.0' };
      }).join('\n'),
    ).toMatch(/@azure\/msal-node is 6\.0\.0, reviewed at 5\.6\.0/);
  });

  it('fails when any link in the chain moves', () => {
    expect(
      chainFailuresFor((lock) => {
        lock.packages['node_modules/@azure/identity']!['version'] = '4.14.0';
      }).join('\n'),
    ).toMatch(/@azure\/identity is 4\.14\.0/);
  });

  it('fails on a second, nested copy of the excepted package', () => {
    expect(
      chainFailuresFor((lock) => {
        lock.packages['node_modules/other/node_modules/@azure/msal-node'] = {
          version: '5.6.0',
        };
      }).join('\n'),
    ).toMatch(/expected one hoisted @azure\/msal-node/);
  });

  it('fails when another package starts depending on the excepted one', () => {
    expect(
      chainFailuresFor((lock) => {
        lock.packages['node_modules/some-sdk'] = {
          version: '1.0.0',
          dependencies: { '@azure/msal-node': '^5.0.0' },
        };
      }).join('\n'),
    ).toMatch(/@azure\/msal-node is depended on by .*some-sdk/);
  });

  it('fails when a link stops depending on the next', () => {
    expect(
      chainFailuresFor((lock) => {
        lock.packages['node_modules/tedious']!['dependencies'] = {};
      }).join('\n'),
    ).toMatch(/tedious no longer depends on @azure\/identity/);
  });

  it('fails when the owning workspace changes its SQL Server driver pin', () => {
    expect(
      chainFailuresFor((_lock, manifests) => {
        manifests[1]!.manifest = { dependencies: { mssql: '^12.7.0' } };
      }).join('\n'),
    ).toMatch(/declares mssql as '\^12\.7\.0'/);
  });

  it.each(['@azure/msal-node', '@azure/identity', '@azure/msal-common'])(
    'fails when a manifest declares %s directly',
    (name) => {
      expect(
        chainFailuresFor((_lock, manifests) => {
          manifests.push({
            directory: 'apps/web',
            manifest: { dependencies: { [name]: '7.1.1' } },
          });
        }).join('\n'),
      ).toMatch(new RegExp(`apps/web declares ${name.replace('/', '\\/')} directly`));
    },
  );
});

describe('the exception fails the moment One Minhaj uses what it covers', () => {
  it.each([
    [
      "import { DefaultAzureCredential } from '@azure/identity';",
      /imports Azure Identity/,
    ],
    ['const msal = require("@azure/msal-node");', /imports Azure Identity/],
    ["await import('@azure/identity/dist/esm');", /imports Azure Identity/],
    [
      'DATABASE_URL=sqlserver://db:1433;database=X;authentication=ActiveDirectoryDefault',
      /Azure AD authentication/,
    ],
    [
      "authentication: { type: 'azure-active-directory-default' }",
      /Azure AD authentication/,
    ],
  ])('fails on %s', (line, reason) => {
    const failures = findAzureIdentityExposure([
      { path: 'apps/web/src/example.ts', text: `// ok\n${line}\n` },
    ]) as string[];
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(/^apps\/web\/src\/example\.ts:2 /);
    expect(failures[0]).toMatch(reason);
  });

  it('does not fail on SQL logins or unrelated Azure resources', () => {
    expect(
      findAzureIdentityExposure([
        {
          path: 'docker/staging/bin/bootstrap-host.sh',
          text:
            'DATABASE_URL=sqlserver://sqlserver:1433;database=MinhajStaging;user=minhaj_app;password={$p};encrypt=true\n' +
            'az acr login --name crminhajstgcin # Azure Container Registry\n',
        },
      ]),
    ).toEqual([]);
  });
});

describe('the REAL repository', () => {
  it('keeps the excepted package on exactly the reviewed chain', () => {
    const lock = JSON.parse(
      readFileSync(path.join(repoRoot, 'package-lock.json'), 'utf8'),
    );
    const root = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
    const manifests = [
      { directory: '', manifest: root },
      ...(discoverWorkspaces(repoRoot) as { directory: string; manifest: Json }[]).map(
        (workspace) => ({
          directory: path.relative(repoRoot, workspace.directory).replaceAll('\\', '/'),
          manifest: workspace.manifest,
        }),
      ),
    ];

    expect(evaluateExceptionChain({ lock, manifests })).toEqual([]);
  });
});
