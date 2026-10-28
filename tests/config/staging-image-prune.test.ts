import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * `prune_unreferenced_images` (docker/staging/bin/lib.sh), run for real in bash
 * against a fake `docker` that lists images and records every removal.
 *
 * Each staging deploy pulls about 6 GB of new digests and nothing removed the
 * old ones, so the VM's root disk reached 97% during Phase 30. The function
 * must keep exactly what the current and previous releases reference, remove
 * only this platform's other release images, and remove NOTHING when it cannot
 * read what to keep.
 */

const bash =
  process.platform === 'win32' && existsSync('C:\\Program Files\\Git\\bin\\bash.exe')
    ? 'C:\\Program Files\\Git\\bin\\bash.exe'
    : 'bash';
/** A path as bash sees it: `C:\x` becomes `/c/x` on Windows, so it can sit in PATH. */
const bashPath = (p: string): string =>
  p
    .replaceAll('\\', '/')
    .replace(/^([A-Za-z]):\//u, (_, drive: string) => `/${drive.toLowerCase()}/`);
const lib = bashPath(path.resolve('docker/staging/bin/lib.sh'));

const REGISTRY = 'crminhajstgcin.azurecr.io';
const digest = (n: number): string => `sha256:${n.toString(16).padStart(64, '0')}`;
const ref = (name: string, n: number): string =>
  `${REGISTRY}/minhaj/${name}@${digest(n)}`;
const releaseEnv = (web: number, realtime: number, ops: number): string =>
  [
    `MINHAJ_RELEASE_SHA=${'a'.repeat(40)}`,
    `MINHAJ_WEB_IMAGE=${ref('web', web)}`,
    `MINHAJ_REALTIME_IMAGE=${ref('realtime', realtime)}`,
    `MINHAJ_OPS_IMAGE=${ref('ops', ops)}`,
    '',
  ].join('\n');

let root: string;

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), 'minhaj-image-prune-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function run(releases: Record<string, string>, images: readonly string[]) {
  for (const [name, env] of Object.entries(releases)) {
    mkdirSync(path.join(root, 'releases', name), { recursive: true });
    writeFileSync(path.join(root, 'releases', name, 'release.env'), env);
  }
  const bin = path.join(root, 'bin');
  mkdirSync(bin);
  writeFileSync(
    path.join(root, 'images.txt'),
    images.map((line) => `${line}\n`).join(''),
  );
  writeFileSync(path.join(root, 'removed.txt'), '');
  const unix = bashPath(root);
  writeFileSync(
    path.join(bin, 'docker'),
    [
      '#!/usr/bin/env bash',
      `if [ "$1" = images ]; then cat '${unix}/images.txt'; exit 0; fi`,
      `if [ "$1" = image ] && [ "$2" = rm ]; then`,
      `  [ "$3" = in-use ] && exit 1`,
      `  printf '%s\\n' "$3" >> '${unix}/removed.txt'; exit 0`,
      'fi',
      'exit 2',
      '',
    ].join('\n'),
    { mode: 0o755 },
  );
  const result = spawnSync(
    bash,
    [
      '-c',
      `source '${lib}' && PATH='${unix}/bin':"$PATH" prune_unreferenced_images '${unix}/releases'`,
    ],
    { encoding: 'utf8' },
  );
  const removed = readFileSync(path.join(root, 'removed.txt'), 'utf8')
    .split('\n')
    .filter(Boolean);
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, removed };
}

describe('prune_unreferenced_images', () => {
  it('keeps the current and previous releases and removes only other platform release images', () => {
    const { status, removed, stderr } = run(
      { current: releaseEnv(1, 2, 3), previous: releaseEnv(4, 5, 6) },
      [
        `${REGISTRY}/minhaj/web@${digest(1)} keep-current-web`,
        `${REGISTRY}/minhaj/realtime@${digest(2)} keep-current-realtime`,
        `${REGISTRY}/minhaj/ops@${digest(3)} keep-current-ops`,
        `${REGISTRY}/minhaj/web@${digest(4)} keep-previous-web`,
        `${REGISTRY}/minhaj/realtime@${digest(5)} keep-previous-realtime`,
        `${REGISTRY}/minhaj/ops@${digest(6)} keep-previous-ops`,
        `${REGISTRY}/minhaj/web@${digest(7)} old-web`,
        `${REGISTRY}/minhaj/realtime@${digest(8)} old-realtime`,
        `${REGISTRY}/minhaj/ops@${digest(9)} old-ops`,
        `minhaj-platform-sqlserver-fts@${digest(10)} sqlserver`,
        `nginx@${digest(11)} nginx`,
        `clamav/clamav@${digest(12)} clamav`,
        `certbot/certbot@${digest(13)} certbot`,
        `${REGISTRY}/other/web@${digest(14)} unrelated-repository`,
      ],
    );
    expect(stderr).toBe('');
    expect(status).toBe(0);
    expect(removed.sort()).toEqual(['old-ops', 'old-realtime', 'old-web']);
  });

  it('never forces removal of an image a container still uses', () => {
    const { status, removed } = run(
      { current: releaseEnv(1, 2, 3), previous: releaseEnv(4, 5, 6) },
      [
        `${REGISTRY}/minhaj/ops@${digest(7)} in-use`,
        `${REGISTRY}/minhaj/web@${digest(8)} old-web`,
      ],
    );
    expect(status).toBe(0);
    expect(removed).toEqual(['old-web']);
  });

  it('removes nothing when it cannot read what to keep', () => {
    const { status, removed, stdout } = run({}, [
      `${REGISTRY}/minhaj/web@${digest(7)} old-web`,
      `${REGISTRY}/minhaj/ops@${digest(9)} old-ops`,
    ]);
    expect(status).toBe(0);
    expect(removed).toEqual([]);
    expect(stdout).toMatch(/image prune skipped/u);
  });

  it('keeps the only release on a first deploy, with no previous', () => {
    const { removed } = run({ current: releaseEnv(1, 2, 3) }, [
      `${REGISTRY}/minhaj/web@${digest(1)} keep-current-web`,
      `${REGISTRY}/minhaj/web@${digest(7)} old-web`,
    ]);
    expect(removed).toEqual(['old-web']);
  });

  it('runs after every successful deploy, beside the release-directory prune', () => {
    const deploy = readFileSync('docker/staging/bin/deploy.sh', 'utf8');
    expect(deploy).toMatch(/prune_old_releases\n\s+prune_unreferenced_images\n/u);
  });
});
