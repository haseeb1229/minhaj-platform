import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const workflow = readFileSync(
  path.join(repoRoot, '.github', 'workflows', 'ci.yml'),
  'utf8',
);

const bash =
  process.platform === 'win32' && existsSync('C:\\Program Files\\Git\\bin\\bash.exe')
    ? 'C:\\Program Files\\Git\\bin\\bash.exe'
    : 'bash';

/**
 * F9 — the CI residue gate may not convert a failed inspection into "clean".
 *
 * The defect: the backup-artifact scan ended
 *
 *   LEFTOVER_BAKS=$(docker exec ... find ... 2>/dev/null || true)
 *
 * so a `docker exec` that could not reach the container, a `find` that errored,
 * and a directory that genuinely held no artifact all produced the same empty
 * string — and the empty string was the passing condition. The job then
 * reported "No Chunk 3 backup artifacts remain" on the strength of an
 * inspection that never ran.
 *
 * Two things are proven here. The workflow TEXT no longer swallows an
 * evaluation failure, and the committed classification BLOCK actually behaves
 * as claimed when it is run — which is checked by extracting that block and
 * executing it, rather than by reading it.
 */

/** The `run:` body of a named workflow step. */
function stepBody(name: string): string {
  const escaped = name.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(
    `- name: ${escaped}\\n([\\s\\S]*?)(?=\\n      - name: |\\n  [a-z-]+:\\n)`,
  ).exec(workflow);
  return match?.[1] ?? '';
}

const residueStep = stepBody('Verify no disposable resources survive');

/** The committed classification block, dedented so a shell can run it. */
const classification = (() => {
  const start = residueStep.indexOf('# >>> residue-classification');
  const end = residueStep.indexOf('# <<< residue-classification');
  const block = residueStep.slice(start, end);

  return block
    .split('\n')
    .map((line) => line.replace(/^ {10}/, ''))
    .join('\n');
})();

/**
 * Runs the extracted block with the two probe results supplied.
 *
 * The results arrive through the ENVIRONMENT rather than as shell literals, so
 * a multi-line probe result stays multi-line. Embedding them would need quoting
 * rules of its own, and the test would then be exercising those.
 */
function classify(
  dbScan: string,
  backupScan: string,
): { status: number; output: string } {
  const result = spawnSync(bash, ['-c', `set -eu\n${classification}`], {
    encoding: 'utf8',
    env: { ...process.env, DB_SCAN: dbScan, BACKUP_SCAN: backupScan },
  });

  return {
    status: result.status ?? -1,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
  };
}

const CLEAN_DB = 'DB_SCAN_COMPLETE';
const CLEAN_BACKUP = 'BACKUP_SCAN_COMPLETE';

describe('F9 — the residue step gathers evidence without swallowing failures', () => {
  it('is present and runs even when an earlier step failed', () => {
    expect(residueStep).not.toBe('');
    expect(residueStep).toContain('if: always()');
  });

  it('no longer discards the artifact scan’s exit status', () => {
    // The exact construct that made "find failed" indistinguishable from
    // "find found nothing": stderr thrown away and the exit status forced to 0.
    expect(residueStep).not.toContain('2>/dev/null');

    // No `find` invocation may have its exit status forced to success.
    const findLines = residueStep
      .split('\n')
      .filter((line) => /(^|\s)find\s/.test(line) || line.includes('-regex'));
    expect(findLines.length).toBeGreaterThan(0);
    for (const line of findLines) {
      expect(line).not.toContain('|| true');
    }
  });

  it('puts no `|| true` on a command that produces evidence', () => {
    for (const line of residueStep.split('\n')) {
      if (!line.includes('|| true')) continue;
      // Prose explaining the rule is not a command subject to it.
      if (line.trimStart().startsWith('#')) continue;

      // The only tolerated use is filtering a marker out of a result already
      // gathered and already validated. Never on docker, sqlcmd or find.
      expect(
        line,
        `only filters over already captured evidence may swallow no-match: ${line}`,
      ).toMatch(/grep -F(?:x|vx)c? /);
      expect(line).not.toMatch(/docker|sqlcmd|find /);
    }
  });

  it('requires an explicit completion marker from each probe', () => {
    expect(residueStep).toContain("SELECT 'DB_SCAN_COMPLETE'");
    expect(residueStep).toContain('echo BACKUP_SCAN_COMPLETE');
    expect(residueStep).toContain('echo BACKUP_DIRECTORY_ABSENT');
  });

  it('fails the shell on any unhandled command failure', () => {
    expect(residueStep).toContain('set -eu');
    expect(residueStep).toMatch(/sh -c '\s*set -eu/);
  });

  it('extracted a classification block to prove behaviourally', () => {
    expect(classification).toContain('RESIDUE=0');
    expect(classification).toContain('exit "$RESIDUE"');
  });
});

describe('F9 — the committed classification behaves as claimed', () => {
  it('passes when both inspections succeed and find nothing', () => {
    const { status, output } = classify(CLEAN_DB, CLEAN_BACKUP);

    expect(status, output).toBe(0);
    expect(output).toContain('No disposable test or restore databases remain');
    expect(output).toContain('No Chunk 3 backup artifacts remain');
  });

  it('passes when the backup directory was never created', () => {
    const { status, output } = classify(CLEAN_DB, 'BACKUP_DIRECTORY_ABSENT');

    expect(status, output).toBe(0);
    expect(output).toContain('no Chunk 3 artifact was ever written');
  });

  it('fails when a disposable database survived', () => {
    const { status, output } = classify(
      `MinhajPhase1Test_${'a'.repeat(32)}\n${CLEAN_DB}`,
      CLEAN_BACKUP,
    );

    expect(status).toBe(1);
    expect(output).toContain('Disposable databases survived the run');
  });

  it('fails when a restore database survived', () => {
    const { status, output } = classify(
      `MinhajPhase1Restore_${'a'.repeat(32)}\n${CLEAN_DB}`,
      CLEAN_BACKUP,
    );

    expect(status).toBe(1);
    expect(output).toContain('Disposable databases survived the run');
  });

  it('does not let marker-like text in a database name spoof completion', () => {
    const { status, output } = classify('MinhajPhase1DB_SCAN_COMPLETE', CLEAN_BACKUP);

    expect(status).toBe(1);
    expect(output).toContain('produced no conclusive result');
  });

  it('rejects duplicate or ambiguous completion markers', () => {
    expect(classify(`${CLEAN_DB}\n${CLEAN_DB}`, CLEAN_BACKUP).status).toBe(1);
    expect(classify(CLEAN_DB, `${CLEAN_BACKUP}\nBACKUP_DIRECTORY_ABSENT`).status).toBe(1);
  });

  it('fails when a backup artifact survived', () => {
    const { status, output } = classify(
      CLEAN_DB,
      `/var/opt/mssql/backup/minhaj-phase1-${'a'.repeat(32)}.bak\n${CLEAN_BACKUP}`,
    );

    expect(status).toBe(1);
    expect(output).toContain('Chunk 3 backup artifacts survived the run');
  });

  /**
   * The heart of F9. A failed `docker exec` or `find` yields empty output, and
   * empty output used to be the passing condition.
   */
  it.each([
    ['both inspections produced nothing', '', ''],
    ['the database inspection produced nothing', '', CLEAN_BACKUP],
    ['the artifact inspection produced nothing', CLEAN_DB, ''],
    [
      'the artifact inspection was cut short',
      CLEAN_DB,
      '/var/opt/mssql/backup/minhaj-phase1-aaaa.bak',
    ],
    [
      'an inspection returned an error message',
      'Error: connection refused',
      CLEAN_BACKUP,
    ],
    [
      'the artifact inspection returned an error message',
      CLEAN_DB,
      'find: cannot read directory',
    ],
  ])('fails when %s', (_label, dbScan, backupScan) => {
    const { status, output } = classify(dbScan, backupScan);

    expect(status, output).toBe(1);
    expect(output).toContain('produced no conclusive result');
    // And the inspection that could not answer never claims a clean result of
    // its own. The other probe may legitimately have reported its own.
    const inconclusive = output.includes('backup-artifact inspection')
      ? 'No Chunk 3 backup artifacts remain'
      : 'No disposable test or restore databases remain';
    expect(output).not.toContain(inconclusive);
  });
});
