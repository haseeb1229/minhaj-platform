import 'server-only';

import {
  DEMO_TOOL_ENTRY,
  runMigrationTool,
} from '../src/lifecycle/migration-proof-operator.ts';
import {
  assertDemoPosture,
  DEMO_COURSE_SLUGS,
  DEMO_ROLE_KEY,
  DemoRefusal,
  ensureActivations,
  ensurePersonas,
  inspectDemo,
  livePersonas,
  liveStepUpSession,
  parseDemoCredentials,
} from '../src/lifecycle/staging-demo.ts';
import { STAGING_DATABASE } from '../src/lifecycle/staging-target.ts';
import { ACCOUNT_ID } from './operator-arguments.ts';
import {
  argumentValue,
  openAdminSession,
  openVerifiedMaster,
  runStagingCommand,
  runtimeConnection,
  startStagingCommand,
} from './staging-bootstrap.ts';

/**
 * `staging-demo` — the staging demonstration data (Rebaseline R2; owner
 * decision 2026-11-06, OPEN_DECISIONS.md §4.2). `docker/staging/bin/demo.sh`
 * runs it in the exact-SHA operations image.
 *
 *   seed    --operator <accountId> [--session <sessionId>]   (credentials on stdin)
 *   status
 *   reset   --operator <accountId>
 *
 * REFUSED FIRST, BEFORE ANY CONNECTION: anything but the staging deployment
 * with an explicitly non-indexable build (`assertDemoPosture`). Then the whole
 * staging guard — declared environment and instance, internal host and port,
 * `MinhajStaging`, distinct principals, TLS posture, the SQL container's
 * machine name and the database's fingerprint.
 *
 * SEED, in two halves:
 *   1. as the OWNER: the three synthetic personas (passwords from the
 *      operator's root-only file on standard input — never an argument, never
 *      printed) and the `fixture` activations the demo needs, each only when
 *      absent;
 *   2. as the RUNTIME principal, in a child process: everything else, through
 *      the services, under the operator's live authority — and, only when the
 *      demo teaching role or its grant is missing, the operator's live
 *      `privilege-administration` step-up (found here, re-verified there).
 *
 * RESET closes the personas as Identity does and runs every context's
 * closed-account disposition, then archives the demo catalogue (runtime child).
 * Activations are immutable and stay; the next seed makes new personas.
 *
 * The final stdout line is one JSON object of identifiers, states and counts.
 */

const USAGE =
  'staging-demo seed --operator <accountId> [--session <sessionId>] (credentials on stdin) | status | reset --operator <accountId>';

function account(flag: string): string {
  const value = argumentValue(flag);
  if (value === undefined || !ACCOUNT_ID.test(value))
    throw new DemoRefusal(
      `${flag} must be an internal account identifier (usage: ${USAGE}).`,
    );
  return value;
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY)
    throw new DemoRefusal(
      'The demo credentials are read from standard input, not a terminal.',
    );
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

await runStagingCommand('staging:demo', async () => {
  const [mode] = process.argv.slice(2);
  if (mode !== 'seed' && mode !== 'status' && mode !== 'reset')
    throw new DemoRefusal(`usage: ${USAGE}`);
  assertDemoPosture(process.env);

  const operator = mode === 'status' ? null : account('--operator');
  // Read and check the credentials BEFORE any connection opens.
  const passwords = mode === 'seed' ? parseDemoCredentials(await readStdin()) : null;

  const command = startStagingCommand();
  const { master } = await openVerifiedMaster(command, { requireFingerprint: true });
  await master.close();
  const owner = await openAdminSession(command, STAGING_DATABASE, 'live');
  try {
    const inspect = () =>
      inspectDemo(owner, {
        roleKey: DEMO_ROLE_KEY,
        courseSlugs: DEMO_COURSE_SLUGS,
      });
    if (mode === 'status')
      return { environmentId: command.environmentId, mode, status: await inspect() };

    const runtime = runtimeConnection(command, STAGING_DATABASE, 'live');
    if (mode === 'reset') {
      const live = await livePersonas(owner);
      if (live.student === null || live.teacher === null || live.member === null)
        throw new DemoRefusal(
          'No complete live demo generation to reset; nothing was changed.',
        );
      const result = await runMigrationTool({
        runtime,
        entry: DEMO_TOOL_ENTRY,
        args: [
          'reset',
          '--operator',
          operator ?? '',
          '--student',
          live.student,
          '--teacher',
          live.teacher,
          '--member',
          live.member,
        ],
        environment: command.values,
        label: 'staging demo reset',
      });
      return {
        environmentId: command.environmentId,
        mode,
        result,
        status: await inspect(),
      };
    }

    if (passwords === null || operator === null) throw new DemoRefusal(`usage: ${USAGE}`);
    const personas = await ensurePersonas(owner, passwords);
    const activations = await ensureActivations(owner, operator);
    const before = await inspect();
    const needsGrant =
      before.teachingRole === 'absent' || before.teachingGrant === 'absent';
    const session = needsGrant
      ? argumentValue('--session') === undefined
        ? await liveStepUpSession(owner, operator, 'privilege-administration')
        : account('--session')
      : null;
    const host = command.values['MINHAJ_PUBLIC_HOST'];
    if (host === undefined || !/^[a-z0-9.-]+$/u.test(host))
      throw new DemoRefusal('MINHAJ_PUBLIC_HOST is not the staging public host.');

    const result = await runMigrationTool({
      runtime,
      entry: DEMO_TOOL_ENTRY,
      args: [
        'seed',
        '--operator',
        operator,
        '--student',
        personas.student.accountId,
        '--teacher',
        personas.teacher.accountId,
        '--member',
        personas.member.accountId,
        '--base-url',
        `https://${host}`,
        '--donations',
        activations.donations === 'other-scope' ? 'no' : 'yes',
        ...(session === null ? [] : ['--session', session]),
      ],
      environment: command.values,
      label: 'staging demo seed',
    });
    return {
      environmentId: command.environmentId,
      database: STAGING_DATABASE,
      mode,
      personas: Object.fromEntries(
        Object.entries(personas).map(([key, outcome]) => [key, outcome]),
      ),
      activations,
      result,
      status: await inspect(),
    };
  } finally {
    await owner.close();
  }
});
