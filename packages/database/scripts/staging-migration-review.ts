import 'server-only';

import {
  MIGRATION_REVIEW_TOOL_ENTRY,
  runMigrationTool,
} from '../src/lifecycle/migration-proof-operator.ts';
import { openSession } from '../src/lifecycle/sql-connection.ts';
import {
  assertMigrationReviewPosture,
  MigrationReviewCommandRefusal,
  parseMigrationReviewArguments,
} from '../src/lifecycle/staging-migration-review.ts';
import { liveStepUpSessionIds } from '../src/lifecycle/staging-step-up.ts';
import { STAGING_DATABASE } from '../src/lifecycle/staging-target.ts';
import {
  openVerifiedMaster,
  runStagingCommand,
  runtimeConnection,
  startStagingCommand,
} from './staging-bootstrap.ts';

/**
 * `staging-migration-review` — the staging HOST REVIEW (Rebaseline R2;
 * OWNER-DECISION-2026-11-09-STAGING-HOST-STEP-UP; MIGRATION_STRATEGY.md
 * §19.2). `docker/staging/bin/migration-review.sh` runs it in the exact-SHA
 * operations image.
 *
 *   status       --operator <id> (--run <runId> | --source <key>)
 *   approve-run  --run <runId> --operator <id> [--note <text>] [--confirm-count <n> --confirm-fingerprint <hex>]
 *   rights       --run <runId> --host <host> --operator <id>
 *                [--licence <l> --evidence <text> --rights-holder <text> [--decide-non-first-party-host <host>]]
 *                [--confirm-count <n> --confirm-fingerprint <hex>]
 *   manifest     --run <runId> --operator <id> [--confirm-count <n> --confirm-fingerprint <hex>]
 *   publish      --manifest <id> --operator <id> [--confirm-version <n> [--session <id>]]
 *   editorial    --kind <kind> --approver <id> [--confirm-count <n> --confirm-fingerprint <hex>]
 *
 * Every act without its confirmation is a PREVIEW that prints the exact set
 * (size and fingerprint, or a manifest's version) the confirmed act will take;
 * the confirmed act runs only over that set.
 *
 * REFUSED FIRST, BEFORE ANY CONNECTION: arguments of the wrong shape and
 * anything but the staging deployment with an explicitly non-indexable build.
 * Then the whole staging guard — declared environment and instance, internal
 * host and port, `MinhajStaging`, distinct principals, TLS posture, the SQL
 * container's machine name and the database's fingerprint.
 *
 * Then the review tool, as the RUNTIME principal in a child process, through
 * the SAME services the admin screens call. A confirmed publication needs the
 * operator's live `migration-publication` step-up (`step-up.sh grant`); when
 * no `--session` is named, the ONE live session holding it is read here as
 * the runtime principal — a read, never a grant — and the tool's gate checks
 * it again. The owner principal is never opened: nothing here needs schema
 * authority.
 *
 * The final stdout line is one JSON object of identifiers, counts and reason
 * codes — never a title, a payload, a token or a password.
 */

await runStagingCommand('staging:migration:review', async () => {
  const args = parseMigrationReviewArguments(process.argv.slice(2));
  assertMigrationReviewPosture(process.env);

  const command = startStagingCommand();
  const { master } = await openVerifiedMaster(command, { requireFingerprint: true });
  await master.close();
  const runtime = runtimeConnection(command, STAGING_DATABASE, 'live');

  let toolArguments = args.toolArguments;
  if (args.publisherSessionFor !== null) {
    const sql = await openSession(runtime);
    let sessions: readonly string[];
    try {
      sessions = await liveStepUpSessionIds(
        sql,
        args.publisherSessionFor,
        'migration-publication',
      );
    } finally {
      await sql.close();
    }
    const [only] = sessions;
    if (only === undefined || sessions.length !== 1)
      throw new MigrationReviewCommandRefusal(
        sessions.length === 0
          ? 'The operator holds no live migration-publication step-up; issue one with step-up.sh grant first.'
          : 'The operator holds live migration-publication step-ups on several sessions; name one with --session.',
      );
    toolArguments = [...toolArguments, '--session', only];
  }

  const result = await runMigrationTool({
    runtime,
    entry: MIGRATION_REVIEW_TOOL_ENTRY,
    args: toolArguments,
    environment: command.values,
    label: 'host review',
  });
  return {
    environmentId: command.environmentId,
    database: STAGING_DATABASE,
    act: args.act,
    result,
  };
});
