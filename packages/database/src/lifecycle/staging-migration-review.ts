import 'server-only';

import { assertDeclaredStagingPosture } from './staging-step-up.ts';

/**
 * The OWNER-SIDE checks of the staging host review (Rebaseline R2;
 * OWNER-DECISION-2026-11-09-STAGING-HOST-STEP-UP, OPEN_DECISIONS.md §4.2;
 * MIGRATION_STRATEGY.md §19.2), made BEFORE any connection opens.
 *
 * The command (`scripts/staging-migration-review.ts`, run by
 * `docker/staging/bin/migration-review.sh`) then runs the whole staging guard
 * and starts the review tool (`scripts/review/review-runtime.ts`) as the
 * RUNTIME principal. That tool reads the arguments again, applies the host
 * command's own picture rule before any service is asked, and acts only
 * through the services the admin screens call — whose permission checks,
 * confirmations, limits and audits are the only ones that decide. Nothing
 * here is the only refusal.
 *
 * STRICT. An unknown act, an unknown or repeated flag, a value of the wrong
 * shape, a half confirmation or a flag another act takes is a refusal. No
 * flag has a default that decides anything: a licence, evidence and rights
 * holder are stated, or there is no picture decision.
 */

export const MIGRATION_REVIEW_USAGE =
  'staging-migration-review status --operator <id> (--run <runId> | --source <key>) | ' +
  'approve-run --run <runId> --operator <id> [--note <text>] [--confirm-count <n> --confirm-fingerprint <hex>] | ' +
  'rights --run <runId> --host <host> --operator <id> [--licence organisation-owned|licensed --evidence <text> --rights-holder <text> [--decide-non-first-party-host <host>]] [--confirm-count <n> --confirm-fingerprint <hex>] | ' +
  'manifest --run <runId> --operator <id> [--confirm-count <n> --confirm-fingerprint <hex>] | ' +
  'publish --manifest <manifestId> --operator <id> [--confirm-version <n> [--session <sessionId>]] | ' +
  'editorial --kind <kind> --approver <id> [--confirm-count <n> --confirm-fingerprint <hex>]';

/** A refusal whose message names no value — safe to print as the command's error. */
export class MigrationReviewCommandRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MigrationReviewCommandRefusal';
  }
}

/** Refuses unless the process declares exactly staging and a non-indexable build. */
export function assertMigrationReviewPosture(
  values: Record<string, string | undefined>,
): void {
  assertDeclaredStagingPosture(
    values,
    'The host review',
    (message) => new MigrationReviewCommandRefusal(message),
  );
}

const ACCOUNT_ID = /^[A-Za-z0-9_-]{8,36}$/u;
const MIGRATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
/** The value shapes each flag admits. Free text is bounded and single-line. */
const SHAPES: Readonly<Record<string, RegExp>> = Object.freeze({
  '--operator': ACCOUNT_ID,
  '--approver': ACCOUNT_ID,
  '--session': ACCOUNT_ID,
  '--run': MIGRATION_ID,
  '--manifest': MIGRATION_ID,
  '--source': /^[a-z0-9]+(?:-[a-z0-9]+)*$/u,
  '--host': /^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/u,
  '--decide-non-first-party-host': /^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/u,
  '--kind': /^[a-z]+(?:-[a-z]+)*$/u,
  '--licence': /^(?:organisation-owned|licensed)$/u,
  '--confirm-count': /^[1-9][0-9]{0,4}$/u,
  '--confirm-version': /^[1-9][0-9]{0,9}$/u,
  '--confirm-fingerprint': /^[0-9a-f]{64}$/u,
  '--note': /^[^\p{Cc}]{1,500}$/u,
  '--evidence': /^[^\p{Cc}]{10,1000}$/u,
  '--rights-holder': /^[^\p{Cc}]{1,200}$/u,
});

const CONFIRM = ['--confirm-count', '--confirm-fingerprint'] as const;

/** Each act's flags: those it requires, then those it may take. */
const ACTS = Object.freeze({
  status: { required: ['--operator'], optional: ['--run', '--source'] },
  'approve-run': { required: ['--run', '--operator'], optional: ['--note', ...CONFIRM] },
  rights: {
    required: ['--run', '--host', '--operator'],
    optional: [
      '--licence',
      '--evidence',
      '--rights-holder',
      '--decide-non-first-party-host',
      ...CONFIRM,
    ],
  },
  manifest: { required: ['--run', '--operator'], optional: [...CONFIRM] },
  publish: {
    required: ['--manifest', '--operator'],
    optional: ['--confirm-version', '--session'],
  },
  editorial: { required: ['--kind', '--approver'], optional: [...CONFIRM] },
} as const satisfies Record<
  string,
  { readonly required: readonly string[]; readonly optional: readonly string[] }
>);

export type MigrationReviewAct = keyof typeof ACTS;

export interface MigrationReviewArguments {
  readonly act: MigrationReviewAct;
  /** The tool's arguments: the act, then every flag given, in a fixed order. */
  readonly toolArguments: readonly string[];
  /**
   * A confirmed publication with no `--session`: the command finds the ONE
   * live session holding the operator's `migration-publication` step-up.
   */
  readonly publisherSessionFor: string | null;
}

function refuse(message: string): never {
  throw new MigrationReviewCommandRefusal(message);
}

function isAct(value: string | undefined): value is MigrationReviewAct {
  return value !== undefined && Object.hasOwn(ACTS, value);
}

/** Reads one act's arguments strictly; see the module comment. */
export function parseMigrationReviewArguments(
  argv: readonly string[],
): MigrationReviewArguments {
  const [act, ...rest] = argv;
  if (!isAct(act)) refuse(`usage: ${MIGRATION_REVIEW_USAGE}`);
  const { required, optional } = ACTS[act];
  const admitted: readonly string[] = [...required, ...optional];

  const seen = new Map<string, string>();
  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index] ?? '';
    const value = rest[index + 1];
    if (!admitted.includes(flag) || seen.has(flag))
      refuse(
        `${act} does not take ${flag.startsWith('--') ? flag : 'that argument'} (usage: ${MIGRATION_REVIEW_USAGE})`,
      );
    if (value === undefined || value.startsWith('--'))
      refuse(`${flag} needs a value (usage: ${MIGRATION_REVIEW_USAGE})`);
    const shape = SHAPES[flag];
    if (shape === undefined || !shape.test(value) || value.trim() !== value)
      refuse(`${flag} is not a value of the expected shape.`);
    seen.set(flag, value);
  }
  for (const flag of required)
    if (!seen.has(flag))
      refuse(`${act} needs ${flag} (usage: ${MIGRATION_REVIEW_USAGE})`);

  if (seen.has('--confirm-count') !== seen.has('--confirm-fingerprint'))
    refuse('--confirm-count and --confirm-fingerprint go together.');
  if (act === 'status' && seen.has('--run') === seen.has('--source'))
    refuse('status takes exactly one of --run and --source.');
  if (act === 'publish' && seen.has('--session') && !seen.has('--confirm-version'))
    refuse('--session goes with --confirm-version.');
  if (act === 'rights') {
    const stated = ['--licence', '--evidence', '--rights-holder'].filter((flag) =>
      seen.has(flag),
    ).length;
    if (stated !== 0 && stated !== 3)
      refuse('--licence, --evidence and --rights-holder go together.');
    if (seen.has('--confirm-count') && stated !== 3)
      refuse(
        'A picture decision states --licence, --evidence and --rights-holder explicitly.',
      );
    if (seen.has('--decide-non-first-party-host') && stated !== 3)
      refuse('--decide-non-first-party-host goes with a decision.');
  }

  const toolArguments: string[] = [act];
  for (const flag of admitted) {
    const value = seen.get(flag);
    if (value !== undefined) toolArguments.push(flag, value);
  }
  const publisherSessionFor =
    act === 'publish' && seen.has('--confirm-version') && !seen.has('--session')
      ? (seen.get('--operator') ?? null)
      : null;
  return { act, toolArguments, publisherSessionFor };
}
