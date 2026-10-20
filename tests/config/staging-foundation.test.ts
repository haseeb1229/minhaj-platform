import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { repoRoot } from '../architecture/architecture-harness.ts';

/**
 * Phase 28 — the staging foundation's security properties, held in place.
 *
 * The staging environment is proven for real against the Azure host (the
 * deploy workflow's edge verification and `docker/staging/bin/deploy.sh`'s
 * smoke) and its edge configuration is exercised end to end by
 * `scripts/staging-edge-proof.sh`. Those proofs show the CURRENT files work.
 * These assertions stop a later edit from quietly removing a property those
 * proofs only happen to observe: a route left outside the environment gate, a
 * second published port, a tag instead of a digest, a secret in a workflow, a
 * deploy that starts migrating.
 *
 * They read the real files and run everywhere, with no Docker daemon.
 */

const read = (...segments: string[]) =>
  readFile(path.join(repoRoot, ...segments), 'utf8');

/** Lines with full-line comments removed, so absence checks see only code. */
const code = (text: string, comment = '#') =>
  text
    .split('\n')
    .filter((line) => !line.trimStart().startsWith(comment))
    .join('\n');

/** The body of a brace-delimited block that starts at `opener`. */
function block(text: string, opener: string, from = 0): string {
  const start = text.indexOf(opener, from);
  expect(start, `block "${opener}" not found`).toBeGreaterThanOrEqual(0);
  let depth = 0;
  for (let index = text.indexOf('{', start); index < text.length; index += 1) {
    if (text[index] === '{') depth += 1;
    if (text[index] === '}') depth -= 1;
    if (depth === 0) return text.slice(start, index + 1);
  }
  throw new Error(`block "${opener}" is not closed`);
}

/** A two-space-indented compose service, up to the next service or section. */
function service(compose: string, name: string): string {
  const match = new RegExp(
    `^  ${name}:\\n([\\s\\S]*?)(?=^  [a-z-]+:\\n|^[a-z]+:)`,
    'm',
  ).exec(compose);
  expect(match, `service ${name} not found`).not.toBeNull();
  return match![1]!;
}

const SEAM_NGINX =
  'nginx:1.30.6-alpine@sha256:970364228b1e4f932abc22d321932816782cca8a20b85a77552a7cfe9acfb3b5';

describe('Phase 28 — the staging edge (NGINX template)', () => {
  const load = async () =>
    code(await read('docker', 'nginx', 'staging', 'default.conf.template'));

  it('lives outside the local seam templates, which every seam consumer renders', async () => {
    const seamTemplates = await readdir(
      path.join(repoRoot, 'docker', 'nginx', 'templates'),
    );
    expect(seamTemplates).toEqual(['default.conf.template']);
  });

  it('puts the whole approved-host server behind the environment gate', async () => {
    const template = await load();
    const server = block(template, 'server {', template.indexOf('listen 443 ssl;') - 40);
    expect(server).toContain('server_name ${MINHAJ_PUBLIC_HOST};');
    expect(server).toMatch(/^\s*auth_basic "One Minhaj staging";$/m);
    expect(server).toContain('auth_basic_user_file /etc/nginx/edge-auth/htpasswd;');
    // Exactly one exemption, and it is the robots file.
    expect(server.match(/auth_basic off;/g)).toHaveLength(1);
    expect(block(server, 'location = /robots.txt {')).toContain('auth_basic off;');
  });

  it('answers with `return` only where no credential is required', async () => {
    // `return` runs before auth_basic is consulted, so a `return` inside a
    // gated location would answer unauthenticated callers.
    const template = await load();
    const server = block(template, 'server {', template.indexOf('listen 443 ssl;') - 40);
    const gated = server.replace(block(server, 'location = /robots.txt {'), '');
    expect(gated).not.toMatch(/\breturn\b/);
  });

  it('marks EVERY response non-indexable, on both listeners, whatever the status', async () => {
    const template = await load();
    const headers = template.match(
      /add_header X-Robots-Tag "noindex, nofollow, noarchive" always;/g,
    );
    // Port 80, the catch-all TLS server and the approved host.
    expect(headers).toHaveLength(3);
    // A location with its own add_header would drop the server-level one.
    for (const opener of ['location /socket.io/ {', 'location / {']) {
      const location = block(template, opener, template.indexOf('listen 443 ssl;'));
      expect(location).not.toContain('add_header');
    }
    expect(
      block(template, 'location / {', template.indexOf('listen 443 ssl;')),
    ).toContain('proxy_hide_header X-Robots-Tag;');
  });

  it('serves a robots file that disallows everything and advertises no sitemap', async () => {
    const robots = block(await load(), 'location = /robots.txt {');
    expect(robots).toContain('return 200 "User-agent: *\\nDisallow: /\\n";');
    expect(robots.toLowerCase()).not.toContain('sitemap');
  });

  it('never forwards the environment credential, and keeps the seam forwarding rules', async () => {
    const template = await load();
    const tls = template.indexOf('listen 443 ssl;');
    for (const opener of ['location /socket.io/ {', 'location / {']) {
      const location = block(template, opener, tls);
      expect(location).toContain('proxy_set_header Authorization "";');
      expect(location).toContain('proxy_set_header X-Forwarded-For $remote_addr;');
      expect(location).toContain('proxy_set_header X-Forwarded-Host "";');
      expect(location).toContain('proxy_set_header Forwarded "";');
      expect(location).toContain('proxy_set_header Host $http_host;');
    }
    expect(template).not.toMatch(/\$proxy_add_x_forwarded_for|\$http_x_forwarded_for/);
  });

  it('uses port 80 only for the ACME challenge and a fixed-host redirect', async () => {
    const template = await load();
    const plain = block(
      template,
      'server {',
      template.indexOf('listen 80 default_server;') - 20,
    );
    expect(plain).toContain('location ^~ /.well-known/acme-challenge/ {');
    expect(plain).toContain('return 301 https://${MINHAJ_PUBLIC_HOST}$request_uri;');
    expect(plain).not.toContain('proxy_pass');
    expect(plain).not.toMatch(/\$host\b|\$http_host/);
  });

  it('refuses every other TLS host name and speaks only TLS 1.2 and 1.3', async () => {
    const template = await load();
    expect(template).toMatch(
      /listen 443 ssl default_server;\s*server_name _;\s*ssl_reject_handshake on;/,
    );
    expect(template).toContain('ssl_protocols TLSv1.2 TLSv1.3;');
    // A foreign Host on an approved handshake is answered, never proxied.
    const catchAll = block(
      template,
      'server {',
      template.indexOf('listen 443 ssl default_server;') - 20,
    );
    expect(catchAll).toContain('return 421;');
    expect(catchAll).not.toContain('proxy_pass');
  });

  it('bounds how fast anyone can guess the environment credential', async () => {
    const template = await load();
    expect(template).toMatch(
      /limit_req_zone \$binary_remote_addr zone=minhaj_edge:\d+m rate=\d+r\/s;/,
    );
    const server = block(template, 'server {', template.indexOf('listen 443 ssl;') - 40);
    expect(server).toMatch(/^\s*limit_req zone=minhaj_edge burst=\d+ nodelay;$/m);
  });
});

describe('Phase 28 — the staging stack (compose)', () => {
  const load = async () => code(await read('docker', 'staging', 'compose.yaml'));

  it('publishes the proxy and nothing else', async () => {
    const compose = await load();
    expect(compose.match(/^\s+ports:/gm)).toHaveLength(1);
    expect(service(compose, 'proxy')).toMatch(/ports:\n\s+- '80:80'\n\s+- '443:443'\n/);
    for (const name of ['web', 'realtime', 'sqlserver', 'clamav', 'ops', 'certbot']) {
      expect(service(compose, name)).not.toContain('ports:');
    }
  });

  it('runs application images only by digest, from the release pin — never built, never tagged', async () => {
    const compose = await load();
    expect(service(compose, 'web')).toContain('image: ${MINHAJ_WEB_IMAGE:?');
    expect(service(compose, 'realtime')).toContain('image: ${MINHAJ_REALTIME_IMAGE:?');
    expect(service(compose, 'ops')).toContain('image: ${MINHAJ_OPS_IMAGE:?');
    for (const name of ['web', 'realtime', 'ops']) {
      expect(service(compose, name)).not.toContain('build:');
    }
    expect(compose).not.toMatch(/:latest\b/);
    expect(service(compose, 'proxy')).toContain(`image: ${SEAM_NGINX}`);
    expect(service(compose, 'clamav')).toMatch(
      /image: clamav\/clamav:1\.5\.2@sha256:[0-9a-f]{64}\n/,
    );
    expect(service(compose, 'certbot')).toMatch(
      /image: certbot\/certbot:v\d+\.\d+\.\d+@sha256:[0-9a-f]{64}\n/,
    );
  });

  it('is production-shaped: no source mount, production mode, non-indexable build posture', async () => {
    const compose = await load();
    expect(compose).not.toMatch(/- \.\.?:\/app/);
    expect(service(compose, 'web')).toContain('NODE_ENV: production');
    expect(service(compose, 'realtime')).toContain('NODE_ENV: production');
    expect(service(compose, 'web')).toContain("PUBLIC_INDEXING_ENABLED: 'false'");
    expect(service(compose, 'web')).toContain(
      'AUTH_BASE_URL: https://${MINHAJ_PUBLIC_HOST}',
    );
  });

  it('keeps SQL Server, the scanner and operator commands on an internal network', async () => {
    const compose = await load();
    expect(compose).toMatch(/^ {2}backend:\n\s+internal: true$/m);
    expect(service(compose, 'sqlserver')).toMatch(/networks: \[backend\]/);
    expect(service(compose, 'sqlserver')).toContain('hostname: minhaj-staging-sql');
    expect(service(compose, 'ops')).toMatch(/networks: \[backend\]/);
    expect(service(compose, 'ops')).toContain('profiles: [ops]');
    expect(service(compose, 'certbot')).toContain('profiles: [acme]');
  });

  it('never shows the scanner the authoritative storage', async () => {
    const clamav = service(await load(), 'clamav');
    expect(clamav).not.toContain('/srv/minhaj/storage');
    expect(clamav).not.toContain('/var/lib/minhaj');
  });

  it('carries no secret and starts nothing that migrates', async () => {
    const compose = await load();
    expect(compose).not.toMatch(/PASSWORD:\s*\S/);
    expect(compose).not.toMatch(/(?:SECRET|KEY)S?:\s*['"]?[A-Za-z0-9+/=_-]{12,}/);
    expect(compose).not.toMatch(/migrate|staging-reset|staging-seed|command:/);
    expect(service(compose, 'sqlserver')).toContain('/etc/minhaj/secrets/sqlserver.env');
  });

  it('never rebuilds SQL Server on up, and keeps its password out of argv', async () => {
    const sqlserver = service(await load(), 'sqlserver');
    expect(sqlserver).toContain('pull_policy: never');
    expect(sqlserver).toContain('SQLCMDPASSWORD="$${MSSQL_SA_PASSWORD}"');
    expect(sqlserver).not.toMatch(/ -P /);
  });
});

describe('Phase 28 — the staging deploy workflow', () => {
  const load = async () => read('.github', 'workflows', 'staging-deploy.yml');

  it('runs only from a deliberate deploy tag — never a branch push, PR or pull_request_target', async () => {
    const workflow = code(await load());
    const triggers = /^on:\n([\s\S]*?)^\S/m.exec(workflow)![1]!;
    expect(triggers.match(/^ {2}[a-z_]+:$/gm)).toEqual(['  push:']);
    expect(triggers.match(/^ {4}[a-z_-]+:$/gm)).toEqual(['    tags:']);
    expect(triggers).toContain("- 'staging/deploy/*'");
    expect(triggers).toContain("- 'staging/migrate-and-deploy/*'");
    expect(triggers).not.toMatch(/branches/);
    expect(workflow).not.toContain('pull_request');
  });

  it('starts with no permissions and grants id-token only to jobs in the staging environment', async () => {
    const workflow = code(await load());
    expect(workflow).toMatch(/^permissions: \{\}$/m);
    const jobs = workflow.split(/^ {2}(?=[a-z-]+:\n {4}name:)/m).slice(1);
    expect(jobs.length).toBe(4);
    for (const job of jobs) {
      if (job.includes('id-token: write')) expect(job).toContain('environment: staging');
      expect(job).not.toMatch(
        /(?:contents|packages|actions|checks|deployments):\s*write/,
      );
    }
  });

  it('pins every action to a full commit SHA', async () => {
    const uses = [...code(await load()).matchAll(/uses:\s*(\S+)/g)].map(
      (match) => match[1]!,
    );
    expect(uses.length).toBeGreaterThan(0);
    for (const reference of uses)
      expect(reference).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/);
  });

  it('reads no repository secret and holds no long-lived credential', async () => {
    const workflow = await load();
    expect(workflow).not.toMatch(/secrets\./);
    expect(workflow).not.toMatch(/client-secret|creds:|password:/i);
    expect(workflow).not.toMatch(/StrictHostKeyChecking|ssh-private-key|\bssh\s/);
    expect(workflow).not.toContain('set -x');
  });

  it('deploys one exact, CI-green commit, serialised, by digest', async () => {
    const workflow = code(await load());
    expect(workflow).toContain("grep -Eqx '[0-9a-f]{40}'");
    // The tagged commit must be the head of a reviewed phase branch.
    expect(workflow).toContain('select(.name | startswith("feature/phase-"))');
    expect(workflow).toContain('is not the head of any feature/phase-* branch');
    // Downstream jobs build and deploy exactly the gate's commit.
    expect(workflow).not.toContain('inputs.');
    expect(workflow).toContain('ref: ${{ needs.gate.outputs.sha }}');
    for (const job of [
      'Verify',
      'Container image',
      'Database foundation',
      'Dependency audit',
      'Browser flows',
    ]) {
      expect(workflow).toContain(`'${job}'`);
    }
    expect(workflow).toMatch(
      /concurrency:\n\s+group: staging-deploy\n\s+cancel-in-progress: false/,
    );
    expect(workflow).toContain('-t "$REGISTRY/minhaj/$name:$REQUESTED"');
    expect(workflow).not.toMatch(/:latest\b/);
    expect(workflow).toContain('--scripts @docker/staging/bin/fetch-release.sh');
  });
});

describe('Phase 28 — the staging host scripts', () => {
  const binDir = path.join(repoRoot, 'docker', 'staging', 'bin');
  const scripts = async () => {
    const names = (await readdir(binDir)).filter((name) => name.endsWith('.sh'));
    return Promise.all(
      names.map(async (name) => ({
        name,
        text: await readFile(path.join(binDir, name), 'utf8'),
      })),
    );
  };

  it('fail closed: strict mode everywhere, tracing nowhere', async () => {
    for (const { name, text } of await scripts()) {
      expect(
        text.includes('set -euo pipefail') || text.includes('/lib.sh"'),
        `${name} must run strict or source lib.sh`,
      ).toBe(true);
      expect(code(text), name).not.toMatch(/set -[a-z]*x/);
      expect(text, name).not.toContain('StrictHostKeyChecking');
    }
  });

  it('never deploy and migrate in one step unless the operator asked', async () => {
    const deploy = code(await readFile(path.join(binDir, 'deploy.sh'), 'utf8'));
    expect(deploy).not.toMatch(
      /migrate|staging-reset|staging-seed|staging-create|staging-provision/,
    );
    const fetch = code(await readFile(path.join(binDir, 'fetch-release.sh'), 'utf8'));
    expect(fetch).toMatch(
      /if \[ "\$mode" = migrate-and-deploy \]; then\n\s+bash "\$target\/bin\/migrate\.sh" "\$sha"\nfi/,
    );
  });

  it('pull application images only by digest', async () => {
    const fetch = code(await readFile(path.join(binDir, 'fetch-release.sh'), 'utf8'));
    expect(fetch).toContain('[[ "$digest" =~ ^sha256:[0-9a-f]{64}$ ]]');
    expect(fetch).toContain('grep -qxF "$ref"');
  });

  it('reset requires the exact environment-bound confirmation and a fresh backup first', async () => {
    const reset = code(await readFile(path.join(binDir, 'reset.sh'), 'utf8'));
    expect(reset).toContain(
      '[ "$confirmation" = "reset MinhajStaging $MINHAJ_STAGING_ENVIRONMENT_ID" ]',
    );
    const backupAt = reset.indexOf('backup.sh');
    const resetAt = reset.indexOf('ops staging-reset');
    const wipeAt = reset.indexOf('find "$storage" -mindepth 1 -delete');
    expect(backupAt).toBeGreaterThan(0);
    expect(resetAt).toBeGreaterThan(backupAt);
    expect(wipeAt).toBeGreaterThan(resetAt);
  });

  it('proves the host with independent signals before any mutation', async () => {
    const lib = code(await readFile(path.join(binDir, 'lib.sh'), 'utf8'));
    expect(lib).toContain('[ "${MINHAJ_DEPLOYMENT_ENVIRONMENT:-}" = staging ]');
    expect(lib).toContain('[ "${resource_id,,}" = "${MINHAJ_AZURE_VM_RESOURCE_ID,,}" ]');
    expect(lib).toContain('[ "$environment_tag" = staging ]');
    expect(lib).toContain('[ "$marker" = "$MINHAJ_STAGING_ENVIRONMENT_ID" ]');
    for (const name of [
      'deploy.sh',
      'migrate.sh',
      'backup.sh',
      'restore-proof.sh',
      'reset.sh',
      'seed.sh',
      'tls.sh',
    ]) {
      expect(await readFile(path.join(binDir, name), 'utf8'), name).toContain(
        'staging_preflight',
      );
    }
  });

  it('restore into isolation only, from the off-host copy, and clean up', async () => {
    const restore = code(await readFile(path.join(binDir, 'restore-proof.sh'), 'utf8'));
    expect(restore).toContain('blob_get "$prefix/manifest.json"');
    expect(restore).toContain('die "the restore root is the live root"');
    expect(restore).toContain('trap cleanup EXIT');
    expect(restore).toContain('ops_json staging-restore-proof --backup "$sql_file"');
    // Proven with the release whose migrations match the backed-up schema.
    expect(restore).toContain('export MINHAJ_OPS_RELEASE="$set_release"');
  });

  it('keep reset evidence on the server and never leave the site down after a refusal', async () => {
    const backup = code(await readFile(path.join(binDir, 'backup.sh'), 'utf8'));
    expect(backup).toContain('cp --preserve=mode,ownership "$sql_dir/$sql_file"');
    expect(backup).not.toMatch(/\bmv "\$sql_dir/);
    const reset = code(await readFile(path.join(binDir, 'reset.sh'), 'utf8'));
    const trapAt = reset.indexOf('trap restart_application EXIT');
    expect(trapAt).toBeGreaterThan(reset.indexOf('stop web realtime'));
    expect(reset.indexOf('ops staging-reset')).toBeGreaterThan(trapAt);
    const migrate = code(await readFile(path.join(binDir, 'migrate.sh'), 'utf8'));
    expect(migrate).toContain("jq -er '.databaseExists'");
  });

  it('bind the web image to the origin it was built for', async () => {
    const dockerfile = await read('docker', 'web.Dockerfile');
    const runtime = dockerfile.slice(dockerfile.indexOf('AS runtime'));
    expect(runtime).toContain('LABEL org.minhaj.public-origin=$AUTH_BASE_URL');
    const deploy = code(await readFile(path.join(binDir, 'deploy.sh'), 'utf8'));
    expect(deploy).toContain('"org.minhaj.public-origin"');
    expect(deploy).toContain('[ "$built_for" = "https://$MINHAJ_PUBLIC_HOST" ]');
  });

  it('keep containers away from the VM identity and off the OS disk', async () => {
    const guard = await read(
      'docker',
      'staging',
      'systemd',
      'minhaj-staging-imds-guard.service',
    );
    expect(guard).toContain('Before=docker.service');
    expect(guard).toContain(
      '-d 169.254.169.254/32 -m comment --comment minhaj-imds-guard -j DROP',
    );
    expect(
      await read('docker', 'staging', 'systemd', 'docker-requires-minhaj-disk.conf'),
    ).toContain('RequiresMountsFor=/srv/minhaj');
    const deploy = code(await readFile(path.join(binDir, 'deploy.sh'), 'utf8'));
    expect(deploy).toContain('assert_imds_guard');
  });
});
