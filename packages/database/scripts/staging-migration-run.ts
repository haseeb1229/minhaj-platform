import 'server-only';

import {
  MIGRATION_TOOL_ENTRIES,
  runMigrationTool,
} from '../src/lifecycle/migration-proof-operator.ts';
import { STAGING_DATABASE } from '../src/lifecycle/staging-target.ts';
import {
  openVerifiedMaster,
  runStagingCommand,
  runtimeConnection,
  startStagingCommand,
} from './staging-bootstrap.ts';

/**
 * `staging-migration-run` — registers or runs ONE authorised migration source
 * on the staging database (Phase 30). `docker/staging/bin/migration-run.sh`
 * runs it in the exact-SHA operations image, in the `ingest` service: the one
 * operator container with an outbound network, used for nothing else.
 *
 *   register --source <key> --operator <accountId>
 *            --authorisation-reference <reference> --authorised-on <YYYY-MM-DD> [--activate]
 *   run      --source <key> --operator <accountId> --pages <n> --limit <n>
 *            [--items <a,b,…>] [--max-items <n>]
 *
 * TWO STEPS, ONE PRINCIPAL FOR THE WORK:
 *
 *   1. the whole staging guard — declared environment and instance, internal
 *      host and port, `MinhajStaging`, distinct principals, TLS posture, the
 *      SQL container's machine name and the database's fingerprint;
 *   2. the tool in a child process as the RUNTIME principal, exactly as the
 *      application runs it: the operator's `migration.administer` is read
 *      live, the source's written authorisation is required, and fetching
 *      goes only through the safe boundary bound to the source's own hosts.
 *
 * Every argument is checked against a strict shape here before it reaches the
 * child, so nothing an operator typed is ever interpreted as more than a key,
 * an identifier, a date or a number. The final stdout line is one JSON object;
 * nothing printed is a URL, a password or content.
 */

const KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const REFERENCE = /^[A-Za-z0-9][A-Za-z0-9 ._:/#()-]{2,399}$/;
const DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const COUNT = /^[1-9][0-9]{0,5}$/;
const ITEMS = /^[A-Za-z0-9._-]{1,80}(?:,[A-Za-z0-9._-]{1,80}){0,199}$/;

type Shape = Readonly<Record<string, RegExp>>;

const MODES: Readonly<
  Record<
    keyof typeof MIGRATION_TOOL_ENTRIES,
    {
      readonly required: Shape;
      readonly optional: Shape;
      readonly flags: readonly string[];
    }
  >
> = {
  register: {
    required: {
      '--source': KEY,
      '--operator': UUID,
      '--authorisation-reference': REFERENCE,
      '--authorised-on': DATE,
    },
    optional: {},
    flags: ['--activate'],
  },
  run: {
    required: { '--source': KEY, '--operator': UUID, '--pages': COUNT, '--limit': COUNT },
    optional: { '--items': ITEMS, '--max-items': COUNT },
    flags: [],
  },
};

/** The child's arguments, rebuilt from validated values only. */
function toolArguments(
  mode: keyof typeof MIGRATION_TOOL_ENTRIES,
  argv: readonly string[],
): string[] {
  const shape = MODES[mode];
  const out: string[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index] ?? '';
    if (seen.has(flag)) throw new Error(`${flag} is given twice.`);
    seen.add(flag);
    if (shape.flags.includes(flag)) {
      out.push(flag);
      continue;
    }
    const pattern = shape.required[flag] ?? shape.optional[flag];
    if (pattern === undefined) throw new Error(`${flag} is not an argument of ${mode}.`);
    const value = argv[index + 1];
    if (value === undefined || !pattern.test(value))
      throw new Error(`${flag} has a malformed value.`);
    out.push(flag, value);
    index += 1;
  }
  for (const flag of Object.keys(shape.required))
    if (!seen.has(flag)) throw new Error(`${flag} is required for ${mode}.`);
  return out;
}

await runStagingCommand('staging:migration:run', async () => {
  const [mode, ...rest] = process.argv.slice(2);
  if (mode !== 'register' && mode !== 'run')
    throw new Error('usage: staging-migration-run register|run --source <key> …');
  const args = toolArguments(mode, rest);

  const command = startStagingCommand();
  const { master } = await openVerifiedMaster(command, { requireFingerprint: true });
  await master.close();

  const result = await runMigrationTool({
    runtime: runtimeConnection(command, STAGING_DATABASE, 'live'),
    entry: MIGRATION_TOOL_ENTRIES[mode],
    args,
    environment: command.values,
    label: `migration ${mode}`,
  });
  return {
    environmentId: command.environmentId,
    database: STAGING_DATABASE,
    mode,
    result,
  };
});
