/**
 * The dependency-audit policy, and the engine that judges an `npm audit` report.
 *
 * WHY THIS EXISTS
 * ---------------
 * CI used to run `npm audit --audit-level=high`, which fails on any High or
 * Critical finding. That rule stands. This engine keeps it and adds exactly
 * one reviewed, fail-closed exception for a transitive finding that has no
 * supported upstream fix and no path into One Minhaj.
 *
 *   - Every Critical finding fails.
 *   - Every High finding fails, except the one advisory recorded in
 *     `auditExceptions`, and only on the exact package, version and
 *     dependency chain recorded there.
 *   - Moderate and lower findings do not fail. That matches the previous
 *     `--audit-level=high` threshold; it is not a new relaxation.
 *
 * The exception cannot outlive its reason. It FAILS the gate when:
 *
 *   - the advisory disappears from the report (stale: remove the exception);
 *   - the advisory's package, severity or affected range changes;
 *   - the locked dependency chain changes in any way: a version, a link, a
 *     second copy, or a new package depending on the excepted ones;
 *   - a manifest declares the excepted packages directly;
 *   - committed source starts importing Azure Identity or MSAL, or configures
 *     Azure AD authentication for SQL Server.
 *
 * Unusable input (an audit error, an unexpected report shape, an unknown
 * severity) is a failure, never a pass. Nothing here reaches the network: the
 * CLI (`scripts/verify-dependency-audit.mjs`) runs the real `npm audit` and
 * passes its JSON in.
 *
 * SECURITY_BASELINE.md §18.3.
 */

/**
 * The reviewed exceptions. Each one is a narrow, temporary acceptance of a
 * single advisory, recorded with the facts that make it acceptable.
 *
 * GHSA-xcx6-jx8p-x3h5 (High): MSAL Node's authorization-code flow
 * (`acquireTokenByCode`) can disclose parameters to an attacker-controlled
 * endpoint. Patched in @azure/msal-node 7.1.0.
 *
 *   - It arrives only through SQL Server's driver: mssql -> tedious ->
 *     @azure/identity -> @azure/msal-node, for Azure AD sign-in to SQL Server.
 *   - One Minhaj signs in to SQL Server with SQL logins. No source imports Azure
 *     Identity or MSAL, and no committed configuration enables Azure AD
 *     authentication.
 *   - Even with Azure AD enabled, tedious only builds client-secret, managed
 *     identity, username/password and default credentials, none of which runs
 *     the authorization-code flow.
 *   - No stable @azure/identity release depends on a patched MSAL (4.14.0
 *     declares ^6.0.0, still affected), and tedious 20.x requires
 *     @azure/identity ^4.13.1. Forcing MSAL 7 through an override would break
 *     the parent's declared range on a security-sensitive authentication path.
 *
 * REMOVE THIS EXCEPTION as soon as the owning chain resolves to
 * @azure/msal-node >= 7.1.0 through its own declared ranges. The gate tells
 * you when: the advisory leaves the report, or the chain changes.
 */
export const auditExceptions = Object.freeze([
  Object.freeze({
    advisory: 'GHSA-xcx6-jx8p-x3h5',
    package: '@azure/msal-node',
    severity: 'high',
    affectedRange: '>=5.0.0-beta.0 <7.1.0',
    // Packages npm reports as High ONLY because they depend on the excepted
    // package. Each must name exactly the excepted package as its cause.
    carriers: Object.freeze(['@azure/identity']),
    // The locked chain, top to bottom. Each package must be installed once, at
    // exactly this version, and depended on by nothing but the one above it
    // (the top of the chain is declared by `declaredBy` and may also be used
    // by other packages).
    chain: Object.freeze([
      Object.freeze({ name: 'mssql', version: '12.7.0' }),
      Object.freeze({ name: 'tedious', version: '20.3.6' }),
      Object.freeze({ name: '@azure/identity', version: '4.13.2' }),
      Object.freeze({ name: '@azure/msal-node', version: '5.6.0' }),
    ]),
    declaredBy: 'packages/database',
  }),
]);

const SEVERITIES = Object.freeze(['info', 'low', 'moderate', 'high', 'critical']);
const BLOCKING = Object.freeze(['high', 'critical']);

/** Packages no manifest may declare directly while an exception covers them. */
const FORBIDDEN_DIRECT_PREFIXES = Object.freeze(['@azure/identity', '@azure/msal-']);

/**
 * Source evidence that Azure Identity, MSAL or Azure AD SQL authentication is
 * in use. Matches imports and requires, and the authentication keywords that
 * tedious and the Prisma MSSQL adapter accept.
 */
const EXPOSURE_PATTERNS = Object.freeze([
  {
    reason: 'imports Azure Identity or MSAL',
    pattern: /['"`]@azure\/(?:identity|msal-[a-z-]+)(?:\/[^'"`]*)?['"`]/,
  },
  {
    reason: 'configures Azure AD authentication for SQL Server',
    pattern:
      /azure-active-directory-[a-z-]+|ActiveDirectory(?:Default|Password|Integrated|Interactive|ManagedIdentity|Msi\w*|ServicePrincipal|AccessToken)\b/i,
  },
]);

const dependencyFields = Object.freeze([
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
]);

function advisoryId(via) {
  const match = /\/(GHSA(?:-[0-9a-z]{4}){3})$/.exec(String(via?.url ?? ''));
  return match?.[1] ?? null;
}

function isExceptedAdvisory(exception, entryName, via) {
  return (
    entryName === exception.package &&
    via?.name === exception.package &&
    advisoryId(via) === exception.advisory &&
    via?.severity === exception.severity &&
    via?.range === exception.affectedRange
  );
}

/* ===========================================================================
 * The audit report.
 * ========================================================================= */

/**
 * Judges an `npm audit --json` report (audit report version 2).
 *
 * Returns `{ failures, findings, excepted }`: `failures` are human-readable
 * reasons the gate must fail, `findings` one row per reported package, and
 * `excepted` the advisories that passed only through a reviewed exception.
 */
export function evaluateAuditReport(report, exceptions = auditExceptions) {
  const failures = [];
  const findings = [];
  const excepted = new Set();

  if (report === null || typeof report !== 'object' || Array.isArray(report)) {
    return {
      failures: ['the audit report is not a JSON object'],
      findings,
      excepted: [],
    };
  }
  if (report.error !== undefined) {
    return {
      failures: [
        `npm audit reported an error: ${String(report.error?.code ?? 'unknown')}`,
      ],
      findings,
      excepted: [],
    };
  }
  if (report.auditReportVersion !== 2) {
    return {
      failures: [
        `unsupported audit report version ${String(report.auditReportVersion)}; expected 2`,
      ],
      findings,
      excepted: [],
    };
  }
  const vulnerabilities = report.vulnerabilities;
  if (
    vulnerabilities === null ||
    typeof vulnerabilities !== 'object' ||
    Array.isArray(vulnerabilities) ||
    typeof report.metadata?.vulnerabilities !== 'object'
  ) {
    return {
      failures: ['the audit report has no vulnerability data'],
      findings,
      excepted: [],
    };
  }

  const exceptionFor = (name) =>
    exceptions.find((exception) => exception.package === name);
  const carrierExceptionFor = (name) =>
    exceptions.find((exception) => exception.carriers.includes(name));

  for (const [name, entry] of Object.entries(vulnerabilities)) {
    const severity = entry?.severity;
    const via = Array.isArray(entry?.via) ? entry.via : null;

    if (!SEVERITIES.includes(severity) || via === null || via.length === 0) {
      failures.push(`${name}: unreadable audit entry (severity '${String(severity)}')`);
      findings.push({ package: name, severity: String(severity), disposition: 'FAIL' });
      continue;
    }

    const advisories = via.filter((item) => item !== null && typeof item === 'object');
    const causes = via.filter((item) => typeof item === 'string');
    const problems = [];

    for (const advisory of advisories) {
      if (!SEVERITIES.includes(advisory.severity)) {
        problems.push(`advisory ${String(advisory.url)} has unknown severity`);
        continue;
      }
      if (!BLOCKING.includes(advisory.severity)) continue;

      const exception = exceptionFor(name);
      if (
        advisory.severity === 'high' &&
        exception !== undefined &&
        isExceptedAdvisory(exception, name, advisory)
      ) {
        excepted.add(exception.advisory);
        continue;
      }
      problems.push(
        `${advisory.severity} advisory ${advisoryId(advisory) ?? String(advisory.url)} ` +
          `(${String(advisory.title ?? 'untitled')}, affected ${String(advisory.range)})`,
      );
    }

    if (BLOCKING.includes(severity)) {
      if (severity === 'critical') {
        problems.push('severity critical');
      } else if (causes.length > 0) {
        // High only because a dependency is High. Acceptable solely for a
        // recorded carrier whose one cause is its exception's package.
        const exception = carrierExceptionFor(name);
        const explained =
          exception !== undefined &&
          causes.length === 1 &&
          causes[0] === exception.package;
        if (!explained) {
          problems.push(
            `high through ${causes.join(', ')}, which no reviewed exception covers`,
          );
        }
      } else if (
        !advisories.some((advisory) => {
          const exception = exceptionFor(name);
          return exception !== undefined && isExceptedAdvisory(exception, name, advisory);
        })
      ) {
        problems.push('severity high with no excepted advisory');
      }
    }

    if (problems.length > 0) {
      for (const problem of problems) failures.push(`${name}: ${problem}`);
    }

    findings.push({
      package: name,
      severity,
      disposition:
        problems.length > 0
          ? 'FAIL'
          : BLOCKING.includes(severity)
            ? 'EXCEPTED (reviewed)'
            : 'reported (below the high threshold)',
    });
  }

  for (const exception of exceptions) {
    if (!excepted.has(exception.advisory)) {
      failures.push(
        `stale exception: ${exception.advisory} on ${exception.package} is no longer ` +
          'reported as recorded. Remove it from auditExceptions (and its documentation) ' +
          'rather than leaving an exception nothing needs.',
      );
    }
  }

  return { failures, findings, excepted: [...excepted] };
}

/* ===========================================================================
 * The locked dependency chain.
 * ========================================================================= */

function lockEntriesNamed(lock, name) {
  return Object.entries(lock.packages).filter(
    ([key]) => key === `node_modules/${name}` || key.endsWith(`/node_modules/${name}`),
  );
}

function dependentsOf(lock, name) {
  return Object.entries(lock.packages)
    .filter(([, entry]) =>
      dependencyFields.some((field) => entry?.[field]?.[name] !== undefined),
    )
    .map(([key]) => key);
}

/**
 * Proves the excepted package still sits in exactly the reviewed position.
 * `manifests` is every manifest a clean install reads: `[{ directory, manifest }]`
 * with the root as directory `''`.
 */
export function evaluateExceptionChain(
  { lock, manifests },
  exceptions = auditExceptions,
) {
  const failures = [];

  if (lock === null || typeof lock?.packages !== 'object') {
    return ['package-lock.json has no packages map'];
  }

  for (const { directory, manifest } of manifests) {
    for (const field of dependencyFields) {
      for (const name of Object.keys(manifest?.[field] ?? {})) {
        if (FORBIDDEN_DIRECT_PREFIXES.some((prefix) => name.startsWith(prefix))) {
          failures.push(
            `${directory || 'the root manifest'} declares ${name} directly; an audit ` +
              'exception covers it only as an unused transitive dependency',
          );
        }
      }
    }
  }

  for (const exception of exceptions) {
    const chain = exception.chain;

    for (const [index, link] of chain.entries()) {
      const copies = lockEntriesNamed(lock, link.name);
      const versions = copies.map(([key, entry]) => `${key}@${String(entry?.version)}`);

      if (copies.length !== 1 || copies[0][0] !== `node_modules/${link.name}`) {
        failures.push(
          `${exception.advisory}: expected one hoisted ${link.name}, found ` +
            `${versions.length === 0 ? 'none' : versions.join(', ')}; the reviewed chain changed`,
        );
        continue;
      }
      if (copies[0][1]?.version !== link.version) {
        failures.push(
          `${exception.advisory}: ${link.name} is ${String(copies[0][1]?.version)}, reviewed ` +
            `at ${link.version}; the reviewed chain changed`,
        );
      }

      const below = chain[index + 1];
      if (below !== undefined && copies[0][1]?.dependencies?.[below.name] === undefined) {
        failures.push(
          `${exception.advisory}: ${link.name} no longer depends on ${below.name}; ` +
            'the reviewed chain changed',
        );
      }

      if (index > 0) {
        const expected = `node_modules/${chain[index - 1].name}`;
        const dependents = dependentsOf(lock, link.name);
        if (dependents.length !== 1 || dependents[0] !== expected) {
          failures.push(
            `${exception.advisory}: ${link.name} is depended on by ` +
              `${dependents.join(', ') || 'nothing'}, reviewed as ${expected} only; ` +
              'the reviewed chain changed',
          );
        }
      }
    }

    const top = chain[0];
    const declaring = manifests.find(
      ({ directory }) => directory === exception.declaredBy,
    );
    const declared = dependencyFields
      .map((field) => declaring?.manifest?.[field]?.[top.name])
      .find((spec) => spec !== undefined);
    if (declared !== top.version) {
      failures.push(
        `${exception.advisory}: ${exception.declaredBy} declares ${top.name} as ` +
          `'${String(declared)}', reviewed as exactly ${top.version}`,
      );
    }
  }

  return failures;
}

/* ===========================================================================
 * Exposure in committed source.
 * ========================================================================= */

/**
 * Scans committed files for Azure Identity, MSAL or Azure AD SQL
 * authentication. `files` is `[{ path, text }]`; the CLI decides which files
 * are in scope. Returns one failure per matching line.
 */
export function findAzureIdentityExposure(files) {
  const failures = [];

  for (const { path, text } of files) {
    const lines = String(text).split(/\r?\n/);
    for (const [index, line] of lines.entries()) {
      for (const { reason, pattern } of EXPOSURE_PATTERNS) {
        if (pattern.test(line)) {
          failures.push(
            `${path}:${index + 1} ${reason}; the ${auditExceptions
              .map((exception) => exception.advisory)
              .join(', ')} exception assumes it is unused`,
          );
        }
      }
    }
  }

  return failures;
}
