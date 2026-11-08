/**
 * What the migration command-line entries share: argument reading and the
 * output contract — progress on stderr, and ONE JSON object as the final
 * stdout line, `ok: true` with the command's summary or `ok: false` with a
 * refusal code. A refusal exits 1.
 *
 * NOTHING SECRET IS PRINTED. A Migration refusal is printed as its reason code
 * only; a `CommandError` (a message this tooling wrote) as that message; any
 * other failure as `failed`, with the first line of its message on stderr for
 * the operator. No payload, body, header value or URL with credentials is
 * ever part of a summary.
 */

/** The value after `flag`, or `undefined` when the flag is absent or bare. */
export function argument(
  flag: string,
  argv: readonly string[] = process.argv.slice(2),
): string | undefined {
  const index = argv.indexOf(flag);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  return value === undefined || value.startsWith('--') ? undefined : value;
}

/** A required argument, or a usage refusal. */
export function required(flag: string, usage: string): string {
  const value = argument(flag);
  if (value === undefined || value.trim() === '') throw new UsageError(usage);
  return value;
}

/** An optional positive integer argument. */
export function positiveInteger(flag: string, usage: string): number | null {
  const value = argument(flag);
  if (value === undefined) return null;
  if (!/^[1-9][0-9]{0,6}$/.test(value)) throw new UsageError(usage);
  return Number(value);
}

/** A failure whose message this tooling wrote itself, so it is safe to print. */
export class CommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CommandError';
  }
}

export class UsageError extends CommandError {
  constructor(usage: string) {
    super(`usage: ${usage}`);
    this.name = 'UsageError';
  }
}

const DISPOSABLE = /^MinhajPhase1Test_[0-9a-f]{32}$/;

/**
 * The database `DATABASE_URL` names, positively: `MinhajStaging` on the
 * internal staging SQL service, or a disposable database on loopback. A tool
 * started as a child of an owner-side command (the migration proof, the Quran
 * reference tool) calls this first: the owner-side command proved the same
 * target with the real staging or local guard before starting it, and this is
 * an independent second check.
 */
export function approvedTarget(url: string | undefined): 'staging' | 'disposable' {
  if (url === undefined || !url.startsWith('sqlserver://'))
    throw new CommandError('DATABASE_URL is not a SQL Server URL; refusing.');
  const [authority = '', ...tokens] = url.slice('sqlserver://'.length).split(';');
  const [host = '', port = '1433'] = authority.split(':');
  const databases = tokens
    .map((token) => /^\s*database\s*=(.*)$/i.exec(token)?.[1]?.trim())
    .filter((value): value is string => value !== undefined);
  if (databases.length !== 1)
    throw new CommandError('DATABASE_URL names no single database; refusing.');
  const database = databases[0] ?? '';
  if (database === 'MinhajStaging' && host === 'sqlserver' && port === '1433')
    return 'staging';
  if (DISPOSABLE.test(database) && (host === 'localhost' || host === '127.0.0.1'))
    return 'disposable';
  throw new CommandError(
    'DATABASE_URL is neither MinhajStaging on the staging SQL host nor a disposable ' +
      'database on loopback; refusing.',
  );
}

/** A Migration refusal's code, recognised by shape — the CLIs import no context. */
function refusalOf(error: unknown): string | null {
  const candidate = error as { name?: unknown; reason?: unknown } | null;
  return candidate?.name === 'MigrationRefusal' && typeof candidate.reason === 'string'
    ? candidate.reason
    : null;
}

function write(stream: NodeJS.WriteStream, text: string): Promise<void> {
  return new Promise((resolve) => stream.write(text, () => resolve()));
}

/**
 * Runs one command and exits: the database client and the scanner keep
 * sockets open, and a finished command must not linger on them.
 */
export async function runCommand(
  name: string,
  body: () => Promise<Record<string, unknown>>,
): Promise<never> {
  let code = 0;
  let line: Record<string, unknown>;
  try {
    line = { command: name, ok: true, ...(await body()) };
  } catch (error) {
    code = 1;
    const refusal = refusalOf(error);
    if (refusal !== null) {
      line = { command: name, ok: false, refusal };
    } else {
      const message = error instanceof Error ? error.message : String(error);
      await write(process.stderr, `${name} failed: ${message.split('\n')[0] ?? ''}\n`);
      line = {
        command: name,
        ok: false,
        error: error instanceof CommandError ? message : 'failed',
      };
    }
  }
  await write(process.stdout, `${JSON.stringify(line)}\n`);
  process.exit(code);
}
