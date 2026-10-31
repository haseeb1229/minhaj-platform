import 'server-only';

import { openMasterSession } from '../src/lifecycle/disposable-database.ts';
import {
  cleanUpLocalResidue,
  planLocalResidue,
  residueVerdict,
} from '../src/lifecycle/local-residue.ts';
import { startLocalCommand } from './local-bootstrap.ts';

/**
 * `npm run db:residue:cleanup [-- --dry-run]` — removes the disposable
 * `MinhajPhase1Restore_<32 hex>` and `MinhajPhase1Test_<32 hex>` databases an
 * interrupted local run left on the approved LOCAL SQL Server.
 *
 * Nothing else is ever a candidate, a database with a connected session or
 * not ONLINE is refused, and every drop is followed by a `DB_ID` proof of
 * absence. `--dry-run` lists what would happen and changes nothing.
 *
 * Prints database names and status only. Exits non-zero on any refusal or
 * failure — including in a dry run, whose job is to say whether the real run
 * would be clean.
 */

const USAGE = 'Usage: npm run db:residue:cleanup [-- --dry-run]';

const args = process.argv.slice(2);
if (args.some((arg) => arg !== '--dry-run')) {
  process.stderr.write(`${USAGE}\n`);
  process.exit(2);
}
const dryRun = args.includes('--dry-run');

// Resolves docker/.env as the sole authority and proves the approved local
// target — loopback host, the configured local port, MinhajPlatform, the
// migration principal — before any session is opened.
const command = startLocalCommand('source');
const master = await openMasterSession(command.connection);

function line(name: string, kind: string, status: string): void {
  process.stdout.write(`  ${name.padEnd(52)} ${kind.padEnd(8)} ${status}\n`);
}

let clean = true;
try {
  process.stdout.write(`Local residue cleanup${dryRun ? ' (dry run)' : ''}\n`);

  if (dryRun) {
    const candidates = await planLocalResidue(master);
    for (const candidate of candidates) {
      const verdict = residueVerdict(candidate);
      if (verdict !== 'drop') clean = false;
      line(
        candidate.name,
        candidate.kind,
        `${candidate.state}, ${candidate.sessions} session(s): ` +
          (verdict === 'drop' ? 'would drop' : verdict),
      );
    }
    process.stdout.write(`${candidates.length} residue database(s) found\n`);
  } else {
    const results = await cleanUpLocalResidue(master);
    for (const result of results) {
      if (result.outcome !== 'dropped') clean = false;
      line(result.name, result.kind, `${result.outcome}: ${result.detail}`);
    }
    const dropped = results.filter((result) => result.outcome === 'dropped').length;
    process.stdout.write(`${dropped} of ${results.length} residue database(s) dropped\n`);
  }
} catch (error) {
  clean = false;
  process.stdout.write(
    `FAILED: ${(error instanceof Error ? error.message : String(error)).split('\n')[0]}\n`,
  );
} finally {
  await master.close();
}

process.exitCode = clean ? 0 : 1;
