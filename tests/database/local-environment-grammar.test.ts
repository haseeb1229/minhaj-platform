import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  applyResolvedEnvironment,
  LocalEnvironmentError,
  parseLocalEnvironmentFile,
  resolveLocalDatabaseEnvironment,
} from '../../packages/database/src/lifecycle/local-environment.ts';
import { repoRoot } from '../architecture/architecture-harness.ts';

/**
 * F4 — one deterministic local configuration path.
 *
 * Two properties are proven here, and they are separate:
 *
 *   1. the GRAMMAR is unambiguous. One parser, one interpretation, every
 *      unsupported form refused rather than guessed at.
 *   2. an unreadable expected file NEVER silently degrades to "use whatever the
 *      shell has". That degradation is what let a command aimed at the local
 *      container run against an arbitrary target.
 *
 * No test here prints a value it feeds in as a password. The markers are
 * synthetic and distinctive so a leak would be unmistakable, and the assertions
 * check for their ABSENCE from error text.
 */

/**
 * A synthetic password carrying every character the review named.
 *
 * `=` `#` `;` `!` `$` `%` `&` `'` `"` a space, and a backslash. `#` is the one
 * that actually broke a run: dotenv treats it as a comment, which is why this
 * repository's grammar is not dotenv.
 */
const AWKWARD_VALUE = String.raw`Pw=1#2;3!4$5%6&7'8"9 ten\eleven`;

let fixtureDirectory: string;

function fixture(name: string, content: string): string {
  const file = path.join(fixtureDirectory, name);
  writeFileSync(file, content, 'utf8');
  return file;
}

beforeAll(() => {
  fixtureDirectory = mkdtempSync(path.join(tmpdir(), 'minhaj-local-env-'));
});

afterAll(() => {
  rmSync(fixtureDirectory, { recursive: true, force: true });
});

describe('F4 — the local env grammar accepts exactly what it documents', () => {
  it('parses a well-formed file', () => {
    const values = parseLocalEnvironmentFile(
      [
        '# a comment',
        '   # an indented comment',
        '',
        'MINHAJ_SQLSERVER_PORT=14330',
        '  DATABASE_APP_LOGIN =minhaj_app',
        'DATABASE_URL=sqlserver://localhost:14330;database=MinhajPlatform;user=u;password=p;encrypt=true',
      ].join('\n'),
    );

    expect(values).toEqual({
      MINHAJ_SQLSERVER_PORT: '14330',
      DATABASE_APP_LOGIN: 'minhaj_app',
      DATABASE_URL:
        'sqlserver://localhost:14330;database=MinhajPlatform;user=u;password=p;encrypt=true',
    });
  });

  it('carries every awkward character through unchanged', () => {
    // The whole point of owning the grammar: `#`, `;`, `=`, `$`, `%`, `&`, `!`,
    // quotes and a backslash are DATA. Nothing expands, nothing comments, and
    // nothing is unescaped.
    const values = parseLocalEnvironmentFile(`DATABASE_APP_PASSWORD=${AWKWARD_VALUE}\n`);

    expect(values['DATABASE_APP_PASSWORD']).toBe(AWKWARD_VALUE);
  });

  it('keeps a URL whole when the password contains a #', () => {
    // The exact P1011 regression: dotenv truncates here and drops the TLS
    // settings that follow. This grammar does not.
    const url =
      'sqlserver://localhost:14330;database=MinhajPlatform;user=sa;' +
      'password=Ci123#1aZ;encrypt=true;trustServerCertificate=true';

    const values = parseLocalEnvironmentFile(`DATABASE_MIGRATION_URL=${url}\n`);

    expect(values['DATABASE_MIGRATION_URL']).toBe(url);
    expect(values['DATABASE_MIGRATION_URL']).toContain('trustServerCertificate=true');
  });

  it('treats a # after the first = as data, not as a comment', () => {
    const values = parseLocalEnvironmentFile('KEY=a#b\n');
    expect(values['KEY']).toBe('a#b');
  });

  it('tolerates CRLF without letting the CR reach a value', () => {
    const values = parseLocalEnvironmentFile('KEY=value\r\nOTHER=second\r\n');
    expect(values).toEqual({ KEY: 'value', OTHER: 'second' });
  });

  it('splits only at the FIRST equals sign', () => {
    const values = parseLocalEnvironmentFile('KEY=a=b=c\n');
    expect(values['KEY']).toBe('a=b=c');
  });
});

describe('F4 — the grammar refuses every ambiguous form', () => {
  it.each([
    ['a line that is neither a comment nor an assignment', 'NOT_AN_ASSIGNMENT\n'],
    ['a key that is not an identifier', 'not-a-key=value\n'],
    ['a key starting with a digit', '1KEY=value\n'],
    ['an empty key', '=value\n'],
    ['a duplicated key', 'KEY=one\nKEY=two\n'],
    ['a double-quoted value', 'KEY="value"\n'],
    ['a single-quoted value', "KEY='value'\n"],
    ['a value with leading whitespace', 'KEY= value\n'],
    ['a value with trailing whitespace', 'KEY=value \n'],
    ['a value with a trailing tab', 'KEY=value\t\n'],
    ['a control character in a value', 'KEY=va\u0007lue\n'],
    ['undecodable bytes', 'KEY=va\uFFFDlue\n'],
  ])('rejects %s', (_label, content) => {
    expect(() => parseLocalEnvironmentFile(content)).toThrow(LocalEnvironmentError);
  });

  it('names the file, the line and the key without echoing the value', () => {
    let thrown: unknown;
    try {
      parseLocalEnvironmentFile(`DATABASE_APP_PASSWORD="${AWKWARD_VALUE}"\n`);
    } catch (error) {
      thrown = error;
    }

    const rendered = `${String(thrown)}\n${(thrown as Error).stack ?? ''}`;

    expect(rendered).toContain('docker/.env');
    expect(rendered).toContain('line 1');
    expect(rendered).toContain('DATABASE_APP_PASSWORD');
    // The diagnostic is actionable without reproducing the secret.
    expect(rendered).not.toContain(AWKWARD_VALUE);
  });

  it('rejects a duplicate key rather than picking a winner', () => {
    // "Last wins" and "first wins" are both defensible; that is the problem.
    expect(() =>
      parseLocalEnvironmentFile('DATABASE_URL=one\nDATABASE_URL=two\n'),
    ).toThrow(/repeats the key 'DATABASE_URL'/);
  });
});

describe('F4 — an unreadable expected file never falls back to the shell', () => {
  it('fails closed when a destructive command finds no local file', () => {
    const missing = path.join(fixtureDirectory, 'does-not-exist.env');

    expect(() =>
      resolveLocalDatabaseEnvironment({
        requireLocalFile: true,
        filePath: missing,
        processEnvironment: { DATABASE_MIGRATION_URL: 'sqlserver://elsewhere' },
      }),
    ).toThrow(/is required by this command and does not exist/);
  });

  it('allows absence only for offline tooling', () => {
    const missing = path.join(fixtureDirectory, 'does-not-exist.env');

    const resolved = resolveLocalDatabaseEnvironment({
      requireLocalFile: false,
      filePath: missing,
      processEnvironment: { SOME_KEY: 'supplied-externally' },
    });

    expect(resolved.localFilePresent).toBe(false);
    // A deployed or offline context keeps its externally supplied configuration.
    expect(resolved.values['SOME_KEY']).toBe('supplied-externally');
  });

  it('fails when the path is a directory rather than a file', () => {
    const directory = path.join(fixtureDirectory, 'env-as-directory');
    mkdirSync(directory, { recursive: true });

    expect(() =>
      resolveLocalDatabaseEnvironment({
        requireLocalFile: false,
        filePath: directory,
        processEnvironment: {},
      }),
    ).toThrow(/is a directory, not a configuration file/);
  });

  it('fails on a malformed file rather than resolving part of it', () => {
    const file = fixture('malformed.env', 'DATABASE_URL=fine\nBROKEN LINE\n');

    expect(() =>
      resolveLocalDatabaseEnvironment({
        requireLocalFile: true,
        filePath: file,
        processEnvironment: {},
      }),
    ).toThrow(/line 2/);
  });

  it('does not adopt a stale shell value for a key the file supplies', () => {
    const file = fixture('authoritative.env', 'DATABASE_MIGRATION_URL=from-the-file\n');

    const resolved = resolveLocalDatabaseEnvironment({
      requireLocalFile: true,
      filePath: file,
      processEnvironment: { DATABASE_MIGRATION_URL: 'stale-shell-value' },
    });

    expect(resolved.values['DATABASE_MIGRATION_URL']).toBe('from-the-file');
    expect(resolved.overridden).toContain('DATABASE_MIGRATION_URL');
    expect(resolved.sources['DATABASE_MIGRATION_URL']).toBe('docker/.env');
  });

  it('leaves keys the file does not mention alone', () => {
    const file = fixture('partial.env', 'DATABASE_URL=from-the-file\n');

    const resolved = resolveLocalDatabaseEnvironment({
      requireLocalFile: true,
      filePath: file,
      processEnvironment: { PATH: '/usr/bin', UNRELATED: 'kept' },
    });

    expect(resolved.values['PATH']).toBe('/usr/bin');
    expect(resolved.values['UNRELATED']).toBe('kept');
    expect(resolved.overridden).toEqual([]);
  });

  it('does not fill omitted protected database keys from a stale shell', () => {
    const file = fixture('partial-protected.env', 'DATABASE_URL=from-the-file\n');

    const resolved = resolveLocalDatabaseEnvironment({
      requireLocalFile: true,
      filePath: file,
      processEnvironment: {
        DATABASE_MIGRATION_URL: 'sqlserver://stale-shell.invalid',
        DATABASE_APP_LOGIN: 'stale_shell_login',
        DATABASE_APP_PASSWORD: 'stale-shell-password',
        MINHAJ_SQLSERVER_PORT: '15555',
        PATH: '/usr/bin',
      },
    });

    expect(resolved.values['DATABASE_MIGRATION_URL']).toBeUndefined();
    expect(resolved.values['DATABASE_APP_LOGIN']).toBeUndefined();
    expect(resolved.values['DATABASE_APP_PASSWORD']).toBeUndefined();
    expect(resolved.values['MINHAJ_SQLSERVER_PORT']).toBeUndefined();
    expect(resolved.values['PATH']).toBe('/usr/bin');
  });

  it('removes omitted protected keys when applying to an import-time consumer', () => {
    const file = fixture('partial-applied.env', 'DATABASE_URL=from-the-file\n');
    const target: NodeJS.ProcessEnv = {
      DATABASE_MIGRATION_URL: 'sqlserver://stale-shell.invalid',
      UNRELATED: 'kept',
    };
    const resolved = resolveLocalDatabaseEnvironment({
      requireLocalFile: true,
      filePath: file,
      processEnvironment: target,
    });

    applyResolvedEnvironment(resolved, target);

    expect(target['DATABASE_URL']).toBe('from-the-file');
    expect(target['DATABASE_MIGRATION_URL']).toBeUndefined();
    expect(target['UNRELATED']).toBe('kept');
  });

  it('mutates nothing it was not asked to mutate', () => {
    const file = fixture('no-side-effect.env', 'DATABASE_URL=from-the-file\n');
    const ambient: NodeJS.ProcessEnv = { DATABASE_URL: 'stale-shell-value' };

    resolveLocalDatabaseEnvironment({
      requireLocalFile: true,
      filePath: file,
      processEnvironment: ambient,
    });

    // Resolution returns a record; it does not reach back into the caller's
    // environment. Determinism here is data flow, not import ordering.
    expect(ambient['DATABASE_URL']).toBe('stale-shell-value');
  });
});

/**
 * `chmod` is a no-op for the owner on Windows, so the permission case can only
 * be proven where the platform actually enforces it. Skipped rather than
 * weakened: a test that passed by not testing anything would be worse than one
 * that says where it ran.
 */
describe.skipIf(process.platform === 'win32')(
  'F4 — a file that exists but cannot be read',
  () => {
    it('fails rather than falling back to the shell environment', () => {
      const file = fixture('unreadable.env', 'DATABASE_URL=from-the-file\n');
      chmodSync(file, 0o000);

      try {
        expect(() =>
          resolveLocalDatabaseEnvironment({
            requireLocalFile: false,
            filePath: file,
            processEnvironment: { DATABASE_URL: 'stale-shell-value' },
          }),
        ).toThrow(/cannot be read \(permission denied\)/);
      } finally {
        chmodSync(file, 0o600);
      }
    });
  },
);

describe('F4 — exactly one reader of docker/.env', () => {
  const manifest = JSON.parse(
    readFileSync(path.join(repoRoot, 'package.json'), 'utf8'),
  ) as { scripts: Record<string, string> };

  const databaseScripts = Object.entries(manifest.scripts).filter(([name]) =>
    name.startsWith('db:'),
  );

  it('finds the database commands', () => {
    expect(databaseScripts.length).toBeGreaterThan(0);
  });

  it.each(databaseScripts)('%s does not add a second parser', (_name, command) => {
    // Node's `--env-file` family applies dotenv rules to a file this repository
    // parses by its own, narrower grammar, and fills only variables that are
    // NOT already set — the wrong rules AND the wrong precedence. Every `db:*`
    // command resolves through `resolveLocalDatabaseEnvironment` instead.
    expect(command).not.toContain('--env-file');
  });

  it('routes every database command through a repository script', () => {
    for (const [, command] of databaseScripts) {
      expect(command).toContain('packages/database/scripts/');
    }
  });
});
