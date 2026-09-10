import 'server-only';

import { resolveLocalDatabaseEnvironment } from '../src/lifecycle/local-environment.ts';
import { runPrismaCli } from '../src/lifecycle/migrations.ts';

/**
 * `npm run db:generate` / `npm run db:validate` — the OFFLINE Prisma commands.
 *
 * Both read `prisma/schema.prisma` and open no connection. They are here only
 * so that `docker/.env` keeps exactly ONE reader.
 *
 * The `db:*` scripts used to carry `--env-file-if-exists=docker/.env`, which
 * applied Node's dotenv rules to a file this repository parses by its own,
 * narrower grammar — two parsers, one file, and a password containing `#`
 * resolved differently under each. Routing these two commands through the
 * repository loader removes the flag from `package.json` entirely.
 *
 * ## Why the local file is OPTIONAL here, unlike everywhere else
 *
 * These commands never connect, so an absent local file cannot cause them to
 * touch the wrong database — the risk that makes `docker/.env` mandatory for
 * every other `db:*` command. `prisma.config.ts` still resolves
 * `env('DATABASE_MIGRATION_URL')` when the config LOADS, before Prisma knows
 * which command was asked for, so a caller with no local file must supply that
 * variable itself: CI does exactly that for `db:generate`, with an obviously
 * synthetic, unreachable target. If it is missing, Prisma fails with its own
 * message naming the variable, which is the correct fail-closed outcome.
 */

const [command, ...rest] = process.argv.slice(2);

// A fixed allowlist: this wrapper exists for the two offline commands, and must
// not become a general-purpose way to run arbitrary Prisma subcommands with
// local configuration applied.
const OFFLINE_COMMANDS = ['generate', 'validate'];

if (command === undefined || !OFFLINE_COMMANDS.includes(command)) {
  throw new Error(
    `Usage: prisma-cli.ts <${OFFLINE_COMMANDS.join('|')}>. ` +
      `Commands that connect to a database have their own scripts, which ` +
      `require docker/.env and prove their target first.`,
  );
}

const environment = resolveLocalDatabaseEnvironment({ requireLocalFile: false });

const result = await runPrismaCli([command, ...rest], {
  baseEnvironment: environment.values,
  streamOutput: true,
});

process.stdout.write(`\n\`${result.command}\` completed.\n`);
