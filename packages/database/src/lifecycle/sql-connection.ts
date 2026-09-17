import 'server-only';

import sql from 'mssql';

/**
 * Direct SQL Server access for database LIFECYCLE work — migration apply,
 * rollback, principal provisioning and the permission proofs.
 *
 * Prisma is the sole APPLICATION data path (ARCHITECTURE.md §4.3). It is the
 * wrong instrument here: this code runs batch DDL, connects as principals that
 * hold no rights on the Prisma schema, and must observe raw driver errors
 * rather than translated ones — a denied UPDATE has to surface as SQL Server
 * error 229, not as a Prisma abstraction over it.
 *
 * `mssql` is the driver `@prisma/adapter-mssql` already builds on, so this
 * introduces no new database driver into the stack.
 */

/** A `sqlserver://host:port;key=value;...` URL as used by the Prisma adapter. */
export interface SqlServerConnection {
  server: string;
  port: number;
  database: string;
  user: string;
  password: string;
  encrypt: boolean;
  trustServerCertificate: boolean;
}

/**
 * Raised when a connection URL cannot be parsed.
 *
 * It carries the offending COMPONENT NAME and nothing else. Earlier revisions
 * embedded a redacted copy of the URL, which meant the safety of every thrown
 * error depended on a regex matching every SQL Server connection-string
 * grammar — and it did not: a braced password (`password={a;b}`) was truncated
 * at the inner `;`, leaking its suffix, and the `pwd=` alias was not matched at
 * all. Reproducing a secret-bearing URL correctly is the wrong problem to
 * solve; the fix is to never put the URL in the message
 * (SECURITY_BASELINE.md §18.1).
 *
 * `variable` names the configuration key the caller should inspect, so the
 * error stays actionable without echoing a value.
 */
export class SqlConnectionUrlError extends Error {
  readonly component: string;

  constructor(component: string, reason: string) {
    super(`Invalid SQL Server connection URL: ${reason} (component: ${component}).`);
    this.name = 'SqlConnectionUrlError';
    this.component = component;
  }
}

function requireToken(tokens: Map<string, string>, key: string): string {
  const value = tokens.get(key);
  if (value === undefined || value === '') {
    throw new SqlConnectionUrlError(key, `missing the '${key}' component`);
  }
  return value;
}

/**
 * Splits the token section of a connection URL on `;`, honouring `{...}`
 * quoting.
 *
 * SQL Server allows a value to be brace-quoted precisely so it may contain the
 * `;` separator, so a plain `split(';')` cuts such a value in half — which is
 * how the password suffix escaped redaction before.
 */
function splitTokens(section: string): string[] {
  const parts: string[] = [];
  let current = '';
  let braced = false;

  for (const character of section) {
    if (character === '{') braced = true;
    else if (character === '}') braced = false;

    if (character === ';' && !braced) {
      parts.push(current);
      current = '';
      continue;
    }
    current += character;
  }
  parts.push(current);

  return parts;
}

/** Strips one layer of `{...}` quoting from a value. */
function unquote(value: string): string {
  return value.startsWith('{') && value.endsWith('}') && value.length >= 2
    ? value.slice(1, -1)
    : value;
}

export function parseSqlServerUrl(url: string): SqlServerConnection {
  if (!url.startsWith('sqlserver://')) {
    throw new SqlConnectionUrlError('scheme', "expected the 'sqlserver://' scheme");
  }

  const [authority, ...rest] = splitTokens(url.slice('sqlserver://'.length));
  const tokens = new Map<string, string>();
  for (const part of rest) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    tokens.set(
      part.slice(0, separator).trim().toLowerCase(),
      unquote(part.slice(separator + 1)),
    );
  }

  const authorityParts = (authority ?? '').split(':');
  const [server, port] = authorityParts;
  if (server === undefined || server === '') {
    throw new SqlConnectionUrlError('host', 'missing a host');
  }
  if (authorityParts.length > 2) {
    throw new SqlConnectionUrlError('host', 'the authority has more than one colon');
  }
  // `Number.parseInt` stops at the first non-digit, so `14330x` would otherwise
  // parse as the approved port and pass a guard comparing numbers.
  if (port !== undefined && !/^\d{1,5}$/.test(port)) {
    throw new SqlConnectionUrlError('port', 'the port is not a decimal number');
  }

  return {
    server,
    port: port === undefined ? 1433 : Number.parseInt(port, 10),
    database: requireToken(tokens, 'database'),
    user: requireToken(tokens, 'user'),
    // `pwd` is the documented alias for `password`; both must be recognised, or
    // a URL using the alias parses with an empty password and the value travels
    // wherever the URL does.
    password: tokens.has('pwd')
      ? requireToken(tokens, 'pwd')
      : requireToken(tokens, 'password'),
    encrypt: tokens.get('encrypt') !== 'false',
    trustServerCertificate: tokens.get('trustservercertificate') === 'true',
  };
}

/** Overrides the target database, for connecting to `master` or a test database. */
export function withDatabase(
  connection: SqlServerConnection,
  database: string,
): SqlServerConnection {
  return { ...connection, database };
}

export interface SqlSession {
  /** Runs one batch and returns its rows. */
  query: <Row>(statement: string) => Promise<Row[]>;
  /** Runs a multi-statement script, splitting on `GO` batch separators. */
  runScript: (script: string) => Promise<void>;
  /**
   * Calls a stored procedure with BOUND parameters.
   *
   * The only parameterised path in this module, and it exists because the
   * host-only operator commands are the one place lifecycle tooling accepts
   * values a human typed — a target account id and a ticket reference. Those
   * must reach the procedure as parameters rather than as text spliced into a
   * batch; the rest of this module runs fixed, reviewed statements
   * (SECURITY_BASELINE.md §9.1).
   */
  execute: (
    procedure: string,
    parameters: Readonly<Record<string, string>>,
  ) => Promise<void>;
  close: () => Promise<void>;
}

export async function openSession(connection: SqlServerConnection): Promise<SqlSession> {
  const pool = await new sql.ConnectionPool({
    server: connection.server,
    port: connection.port,
    database: connection.database,
    user: connection.user,
    password: connection.password,
    options: {
      encrypt: connection.encrypt,
      trustServerCertificate: connection.trustServerCertificate,
    },
    pool: { max: 2, min: 0, idleTimeoutMillis: 5_000 },
  }).connect();

  return {
    async query<Row>(statement: string): Promise<Row[]> {
      const result = await pool.request().query<Row>(statement);
      return result.recordset ?? [];
    },

    async runScript(script: string): Promise<void> {
      // SQL Server rejects `GO` as a statement — it is a client-side batch
      // separator, so scripts carrying one must be sent batch by batch.
      const batches = script
        .split(/^\s*GO\s*$/gim)
        .map((batch) => batch.trim())
        .filter((batch) => batch.length > 0);

      for (const batch of batches) {
        await pool.request().batch(batch);
      }
    },

    async execute(
      procedure: string,
      parameters: Readonly<Record<string, string>>,
    ): Promise<void> {
      // The NAME is not a parameter and cannot be one, so it is constrained to
      // a plain identifier. Every call site passes a constant from
      // `OPERATOR_PROCEDURES`; this refuses anything else reaching it.
      if (!/^[A-Za-z][A-Za-z0-9_]{0,127}$/.test(procedure)) {
        throw new Error(`Invalid procedure name '${procedure}'.`);
      }

      const request = pool.request();
      for (const [name, value] of Object.entries(parameters)) {
        request.input(name, sql.NVarChar, value);
      }

      await request.execute(`[dbo].[${procedure}]`);
    },

    async close(): Promise<void> {
      await pool.close();
    },
  };
}
