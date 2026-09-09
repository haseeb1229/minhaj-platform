import 'server-only';

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { packageRoot } from './migrations.ts';
import { parseSqlServerUrl, type SqlServerConnection } from './sql-connection.ts';

/**
 * The single source of truth for LOCAL Phase 1 database-lifecycle tooling.
 *
 * Node's `--env-file-if-exists` only fills variables that are NOT already set:
 * a `DATABASE_MIGRATION_URL` left in the caller's shell silently outranks
 * `docker/.env`. Two terminals then run the same repository command against
 * different databases with different TLS settings — which is exactly how one
 * session saw the lifecycle pass while another saw Prisma fail with P1011.
 *
 * For local lifecycle tooling `docker/.env` is therefore AUTHORITATIVE: it is
 * read here and applied over whatever the shell happened to carry, and the
 * resolved values are handed explicitly to every child process.
 *
 * This applies ONLY to the local Docker/Phase 1 lifecycle commands. Nothing
 * here runs in the application: deployed environments have no `docker/.env`,
 * and their configuration continues to arrive as externally supplied
 * environment variables through `src/config.ts`.
 */

const repoRoot = path.resolve(packageRoot, '..', '..');
const localEnvPath = path.join(repoRoot, 'docker', '.env');

/** Where a resolved value came from, for diagnostics that never show values. */
export type ConfigurationSource = 'docker/.env' | 'process environment';

export interface LocalDatabaseEnvironment {
  values: Record<string, string>;
  /** Keys the local file supplied, and whether they displaced a shell value. */
  sources: Record<string, ConfigurationSource>;
  /** Keys where the shell disagreed with `docker/.env` and the file won. */
  overridden: string[];
  localFilePresent: boolean;
}

function parseEnvFile(content: string): Record<string, string> {
  const values: Record<string, string> = {};

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;

    const separator = trimmed.indexOf('=');
    if (separator === -1) continue;

    values[trimmed.slice(0, separator).trim()] = trimmed.slice(separator + 1);
  }

  return values;
}

/**
 * Reads `docker/.env` and applies it over `process.env`.
 *
 * Returns which keys the file supplied and which shell values it displaced, so
 * a command can report the contamination it corrected without printing values.
 */
export function loadLocalDatabaseEnvironment(
  target: NodeJS.ProcessEnv = process.env,
): LocalDatabaseEnvironment {
  let content: string;
  let localFilePresent = true;
  try {
    content = readFileSync(localEnvPath, 'utf8');
  } catch {
    // No local file: a machine without the container, or a deployed context.
    // The shell's own configuration is then the only source, unchanged.
    content = '';
    localFilePresent = false;
  }

  const fileValues = parseEnvFile(content);
  const sources: Record<string, ConfigurationSource> = {};
  const overridden: string[] = [];

  for (const [key, value] of Object.entries(fileValues)) {
    const existing = target[key];
    if (existing !== undefined && existing !== value) overridden.push(key);

    target[key] = value;
    sources[key] = 'docker/.env';
  }

  return { values: fileValues, sources, overridden, localFilePresent };
}

/** Safe, printable metadata about a connection — never the password or URL. */
export interface ConnectionMetadata {
  source: ConfigurationSource;
  host: string;
  port: number;
  database: string;
  user: string;
  encrypt: boolean;
  trustServerCertificate: boolean;
}

export function describeConnection(
  connection: SqlServerConnection,
  source: ConfigurationSource,
): ConnectionMetadata {
  return {
    source,
    host: connection.server,
    port: connection.port,
    database: connection.database,
    user: connection.user,
    encrypt: connection.encrypt,
    trustServerCertificate: connection.trustServerCertificate,
  };
}

export function formatConnectionMetadata(metadata: ConnectionMetadata): string {
  return (
    `source=${metadata.source} host=${metadata.host}:${metadata.port} ` +
    `database=${metadata.database} user=${metadata.user} ` +
    `encrypt=${metadata.encrypt} trustServerCertificate=${metadata.trustServerCertificate}`
  );
}

/**
 * Validates the SAFE properties a local migration connection must hold before
 * any Prisma CLI child is launched. Fails closed, and names only components.
 */
export function assertLocalMigrationConnection(url: string): SqlServerConnection {
  // Throws SqlConnectionUrlError, which never echoes the URL.
  const connection = parseSqlServerUrl(url);

  if (!connection.encrypt) {
    throw new Error(
      'Local migration configuration must set encrypt=true; refusing to run unencrypted.',
    );
  }
  if (!connection.trustServerCertificate) {
    // The local Developer container serves a self-signed certificate, so Prisma
    // fails with P1011 without this. Caught here rather than as an opaque CLI
    // error several steps later.
    throw new Error(
      'Local migration configuration must set trustServerCertificate=true for the ' +
        'self-signed local SQL Server 2022 Developer container; without it the ' +
        'Prisma CLI fails with P1011.',
    );
  }
  if (connection.user === '') {
    throw new Error('Local migration configuration must name a migration principal.');
  }

  return connection;
}
