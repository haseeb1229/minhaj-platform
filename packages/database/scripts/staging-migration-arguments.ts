import 'server-only';

import { ACCOUNT_ID } from './operator-arguments.ts';

/**
 * Argument shapes for `staging-migration-run` (Phase 30).
 *
 * Every value is checked against a strict shape BEFORE it reaches the child
 * tool, so nothing an operator typed is ever interpreted as more than a key, an
 * account identifier, a reference, a date or a number. The child is then given
 * arguments rebuilt from validated values only.
 *
 * The operator is named by the same internal account identifier every other
 * operator command takes (`ACCOUNT_ID`): Better Auth's own identifiers and
 * UUIDs both fit it, an email address never does.
 */

const KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const REFERENCE = /^[A-Za-z0-9][A-Za-z0-9 ._:/#()-]{2,399}$/;
const DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const COUNT = /^[1-9][0-9]{0,5}$/;
const ITEMS = /^[A-Za-z0-9._-]{1,80}(?:,[A-Za-z0-9._-]{1,80}){0,199}$/;

export type MigrationRunMode = 'register' | 'run';

type Shape = Readonly<Record<string, RegExp>>;

const MODES: Readonly<
  Record<
    MigrationRunMode,
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
      '--operator': ACCOUNT_ID,
      '--authorisation-reference': REFERENCE,
      '--authorised-on': DATE,
    },
    optional: {},
    flags: ['--activate'],
  },
  run: {
    required: {
      '--source': KEY,
      '--operator': ACCOUNT_ID,
      '--pages': COUNT,
      '--limit': COUNT,
    },
    optional: { '--items': ITEMS, '--max-items': COUNT },
    // Phase 30-R: re-read retained evidence instead of fetching pages.
    flags: ['--replay'],
  },
};

export function isMigrationRunMode(value: string | undefined): value is MigrationRunMode {
  return value === 'register' || value === 'run';
}

/** The child's arguments, rebuilt from validated values only. */
export function toolArguments(mode: MigrationRunMode, argv: readonly string[]): string[] {
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
