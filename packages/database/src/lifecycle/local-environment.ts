import 'server-only';

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { packageRoot } from './migrations.ts';
import type { SqlServerConnection } from './sql-connection.ts';

/**
 * The ONE configuration bootstrap for LOCAL Phase 1 database-lifecycle tooling.
 *
 * ## Why there is exactly one
 *
 * `docker/.env` used to be read by TWO parsers at once. Node's
 * `--env-file-if-exists` on every `db:*` script applied dotenv rules — under
 * which an unquoted `#` starts a comment — while this module split each line at
 * the first `=`. A generated CI password containing `#` was therefore truncated
 * mid-URL by one parser and kept whole by the other, silently discarding the
 * `encrypt=true;trustServerCertificate=true` that followed and producing P1011
 * against the container's self-signed certificate.
 *
 * Node's flag also has the WRONG precedence for this repository: it fills only
 * variables that are not already set, so a `DATABASE_MIGRATION_URL` left in one
 * terminal outranked the file. Two shells then ran the same repository command
 * against different databases.
 *
 * The flag is gone from `package.json`. This module is now the only thing that
 * reads DATABASE configuration out of `docker/.env`, it is AUTHORITATIVE over
 * the shell for local lifecycle tooling, and it hands callers an explicit
 * resolved environment object rather than relying on the order in which modules
 * happen to mutate `process.env`.
 *
 * One other consumer of the file remains and cannot be removed: Docker Compose
 * reads it for `${MSSQL_SA_PASSWORD}` interpolation in `docker/compose.yaml`,
 * by its own rules. That is a different variable for a different purpose, and
 * it is why `tests/config/ci-credentials.test.ts` still keeps the generated
 * credentials clear of characters the two readers would disagree about.
 *
 * ## Trust context
 *
 * This is LOCAL DOCKER configuration and nothing else. Deployed environments
 * have no `docker/.env` and must never be made to want one: their configuration
 * arrives as externally supplied environment variables and is validated by
 * `src/config.ts`, which reads whatever record it is given and knows nothing
 * about this file.
 */

const repoRoot = path.resolve(packageRoot, '..', '..');

/** The single local configuration file, named relative to the repository root. */
export const LOCAL_ENVIRONMENT_FILE = 'docker/.env';

export const localEnvironmentPath = path.join(repoRoot, 'docker', '.env');

/**
 * Database-sensitive values whose LOCAL authority is `docker/.env`.
 *
 * When that file exists, omission is meaningful: it means "not configured".
 * Ambient values for these keys must therefore be removed before the file is
 * applied, or a partial file becomes an overlay on stale shell state. Other
 * process variables (PATH, CI, NODE_OPTIONS, and so on) remain untouched.
 */
export const LOCAL_DATABASE_CONFIGURATION_KEYS = [
  'MINHAJ_SQLSERVER_PORT',
  'DATABASE_URL',
  'DATABASE_MIGRATION_URL',
  'DATABASE_APP_LOGIN',
  'DATABASE_APP_PASSWORD',
] as const;

/**
 * Raised when local configuration cannot be resolved unambiguously.
 *
 * Carries the file, the line number and the KEY at fault — never a value, so a
 * malformed password line cannot reach a log through the error that rejected it
 * (SECURITY_BASELINE.md §18.1).
 */
export class LocalEnvironmentError extends Error {
  readonly file: string;

  constructor(reason: string) {
    super(`${LOCAL_ENVIRONMENT_FILE}: ${reason}`);
    this.name = 'LocalEnvironmentError';
    this.file = LOCAL_ENVIRONMENT_FILE;
  }
}

/**
 * The supported grammar for `docker/.env`.
 *
 * Deliberately NARROWER than dotenv. Quoting, escapes and interpolation are the
 * parts implementations disagree about, so this format has none of them and
 * rejects anything that looks like them rather than guessing:
 *
 *   - a blank line, or a line whose first non-blank character is `#`, is ignored;
 *   - every other line must be `KEY=VALUE`, `KEY` matching `[A-Za-z_][A-Za-z0-9_]*`,
 *     with optional spaces or tabs around the key;
 *   - VALUE is the EXACT remainder of the line. `#`, `;`, `=`, `$`, `%`, `&`,
 *     `!`, `\` and embedded quotes are ordinary characters and survive
 *     unchanged — this file is not a shell and nothing here expands;
 *   - a value that STARTS with `"` or `'` is rejected: whether the quotes are
 *     data or syntax is exactly the ambiguity this grammar refuses to have;
 *   - a value with leading or trailing spaces or tabs is rejected, because a
 *     stray edit and an intentional space are indistinguishable and one of them
 *     silently corrupts a credential;
 *   - a control character in a value is rejected;
 *   - a repeated key is rejected. "Last wins" and "first wins" are both
 *     defensible, which is the problem.
 */
const KEY_VALUE_LINE = /^[ \t]*([A-Za-z_][A-Za-z0-9_]*)[ \t]*=(.*)$/;

/**
 * Whether a value contains a control character.
 *
 * Written as a code-point scan rather than a regular expression because a
 * regex literal holding control characters is itself unreadable, and the
 * repository lints against one.
 */
function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

export function parseLocalEnvironmentFile(content: string): Record<string, string> {
  // `readFileSync(..., 'utf8')` substitutes U+FFFD for undecodable bytes rather
  // than throwing, so a file in some other encoding would parse into mangled
  // values. Caught here instead of surfacing as a login failure later.
  if (content.includes('\uFFFD')) {
    throw new LocalEnvironmentError(
      'is not valid UTF-8; re-save it as UTF-8 without a byte-order mark',
    );
  }

  const values: Record<string, string> = {};
  const lines = content.split('\n');

  for (const [index, rawLine] of lines.entries()) {
    const lineNumber = index + 1;
    // Tolerate CRLF: the separator is stripped, never treated as value data.
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;

    if (line.trim() === '') continue;
    if (line.trimStart().startsWith('#')) continue;

    const match = KEY_VALUE_LINE.exec(line);
    if (match === null) {
      throw new LocalEnvironmentError(
        `line ${lineNumber} is not a comment and not KEY=VALUE with a ` +
          `[A-Za-z_][A-Za-z0-9_]* key`,
      );
    }

    const key = match[1] ?? '';
    const value = match[2] ?? '';

    if (key in values) {
      throw new LocalEnvironmentError(
        `line ${lineNumber} repeats the key '${key}'; a repeated key has no ` +
          `unambiguous value`,
      );
    }
    if (value.startsWith('"') || value.startsWith("'")) {
      throw new LocalEnvironmentError(
        `line ${lineNumber} ('${key}') starts with a quote; this format has no ` +
          `quoting, so write the value literally`,
      );
    }
    if (/^[ \t]/.test(value) || /[ \t]$/.test(value)) {
      throw new LocalEnvironmentError(
        `line ${lineNumber} ('${key}') has leading or trailing whitespace in its ` +
          `value; write the value with no surrounding spaces or tabs`,
      );
    }
    if (hasControlCharacter(value)) {
      throw new LocalEnvironmentError(
        `line ${lineNumber} ('${key}') contains a control character`,
      );
    }

    values[key] = value;
  }

  return values;
}

/** Whether the local file was found, and its contents if it was. */
interface LocalFileRead {
  present: boolean;
  content: string;
}

/**
 * Reads `docker/.env`, distinguishing "not there" from "there and unreadable".
 *
 * The previous revision caught every `readFileSync` failure and treated it as
 * absence, so a file the process could not open — wrong permissions, a
 * directory of that name, a failing disk — silently demoted the run to whatever
 * the shell happened to carry. Only `ENOENT` means absent; everything else is a
 * configuration failure and throws.
 */
function readLocalEnvironmentFile(filePath: string): LocalFileRead {
  try {
    return { present: true, content: readFileSync(filePath, 'utf8') };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;

    if (code === 'ENOENT') return { present: false, content: '' };

    if (code === 'EISDIR') {
      throw new LocalEnvironmentError('is a directory, not a configuration file');
    }
    if (code === 'EACCES' || code === 'EPERM') {
      throw new LocalEnvironmentError(
        'exists but cannot be read (permission denied); refusing to fall back to ' +
          'the shell environment',
      );
    }
    throw new LocalEnvironmentError(
      `exists but could not be read (${code ?? 'unknown error'}); refusing to fall ` +
        `back to the shell environment`,
    );
  }
}

/** Where a resolved value came from, for diagnostics that never show values. */
export type ConfigurationSource = 'docker/.env' | 'process environment';

export interface ResolvedLocalEnvironment {
  /**
   * The configuration to USE: the process environment with `docker/.env`
   * applied over it. Passed explicitly to every consumer, so no part of the
   * resolution depends on import order or on a module's side effects.
   */
  values: Record<string, string | undefined>;
  /** Only the keys the local file supplied. */
  fileValues: Record<string, string>;
  /** Where each key the file supplied came from. */
  sources: Record<string, ConfigurationSource>;
  /** Keys where the shell disagreed with `docker/.env` and the file won. */
  overridden: string[];
  localFilePresent: boolean;
}

export interface ResolveLocalEnvironmentOptions {
  /**
   * `true` for commands that connect to, mutate or drop the local database.
   *
   * Absence of the file must not silently promote the shell to the authority
   * that decides which database a destructive command touches, so those
   * commands fail closed rather than proceeding on ambient configuration.
   *
   * `false` only for offline tooling that never opens a connection.
   */
  requireLocalFile: boolean;
  /** The ambient environment to resolve against. Defaults to `process.env`. */
  processEnvironment?: NodeJS.ProcessEnv;
  /**
   * The file to read. Defaults to `docker/.env` and is overridden ONLY by the
   * tests that prove the unreadable-file, directory and malformed-file
   * behaviour, which cannot be exercised against the repository's own file
   * without mutating the working tree. No command passes it.
   */
  filePath?: string;
}

/**
 * Resolves local lifecycle configuration and returns it EXPLICITLY.
 *
 * `docker/.env` is authoritative: a value it supplies replaces whatever the
 * shell carried. Nothing is mutated — the caller receives the resolved record
 * and hands it to `src/config.ts` and to any child process.
 */
export function resolveLocalDatabaseEnvironment(
  options: ResolveLocalEnvironmentOptions,
): ResolvedLocalEnvironment {
  const ambient = options.processEnvironment ?? process.env;
  const { present, content } = readLocalEnvironmentFile(
    options.filePath ?? localEnvironmentPath,
  );

  if (!present && options.requireLocalFile) {
    throw new LocalEnvironmentError(
      'is required by this command and does not exist. Local database lifecycle ' +
        'commands take their target from this file, never from ambient shell ' +
        'variables; copy the entries from .env.example and fill them in',
    );
  }

  const fileValues = present ? parseLocalEnvironmentFile(content) : {};
  const values: Record<string, string | undefined> = { ...ambient };
  if (present) {
    for (const key of LOCAL_DATABASE_CONFIGURATION_KEYS) {
      Reflect.deleteProperty(values, key);
    }
  }
  const sources: Record<string, ConfigurationSource> = {};
  const overridden: string[] = [];

  for (const [key, value] of Object.entries(fileValues)) {
    const existing = ambient[key];
    if (existing !== undefined && existing !== value) overridden.push(key);

    values[key] = value;
    sources[key] = 'docker/.env';
  }

  return { values, fileValues, sources, overridden, localFilePresent: present };
}

/**
 * Applies a resolved environment to `process.env`.
 *
 * Needed only where a consumer cannot be handed the record — the Prisma client
 * reads `process.env` through `src/config.ts`, and the Vitest setup file has to
 * configure the whole run. Everything else passes `values` explicitly, because
 * a resolved object is evidence and an import-order side effect is not.
 */
export function applyResolvedEnvironment(
  resolved: ResolvedLocalEnvironment,
  target: NodeJS.ProcessEnv = process.env,
): void {
  // Synchronise protected keys as a set. In particular, remove an ambient key
  // which an existing authoritative file omitted instead of leaving the stale
  // value behind for a later import-time consumer.
  if (resolved.localFilePresent) {
    for (const key of LOCAL_DATABASE_CONFIGURATION_KEYS) {
      Reflect.deleteProperty(target, key);
    }
  }
  for (const [key, value] of Object.entries(resolved.fileValues)) {
    target[key] = value;
  }
}

/**
 * Resolves local configuration AND applies it to a process environment.
 *
 * The Vitest setup file and the connectivity check use this; the lifecycle
 * commands do not, because they take the resolved record directly.
 */
export function loadLocalDatabaseEnvironment(
  target: NodeJS.ProcessEnv = process.env,
  options: Partial<ResolveLocalEnvironmentOptions> = {},
): ResolvedLocalEnvironment {
  const resolved = resolveLocalDatabaseEnvironment({
    requireLocalFile: options.requireLocalFile ?? false,
    processEnvironment: options.processEnvironment ?? target,
  });

  applyResolvedEnvironment(resolved, target);
  return resolved;
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
