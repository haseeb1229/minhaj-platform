import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { repoRoot } from '../architecture/architecture-harness.ts';

/**
 * N5 — the image and the checks must agree about what an image is for.
 *
 * Review #3 found one stage copying `tests/` into the RUNNING image while
 * `.env.example` — an input three of those tests read — never entered the
 * context. Three tests failed inside the image for reasons that said nothing
 * about the code, and the runtime carried fixtures it never used.
 *
 * The design chosen is stage separation, which is the production-quality
 * answer rather than the expedient one:
 *
 *   test — the full repository, tests included, with every input they need
 *   dev  — the development runtime: application source, no tests, no fixtures
 *
 * A lean runtime is the goal; making the test suite pass by bloating the thing
 * that serves traffic would have been the wrong trade.
 *
 * These assertions read the real Dockerfile. They cannot substitute for
 * building it — that runs in the validation pipeline — but they hold the
 * structural decision in place, and they run everywhere, including where no
 * Docker daemon exists.
 */

const dockerfilePath = path.join(repoRoot, 'docker', 'web.Dockerfile');

/** The body of one build stage, from its FROM line to the next. */
async function stage(name: string): Promise<string> {
  const source = await readFile(dockerfilePath, 'utf8');
  const lines = source.split('\n');

  const start = lines.findIndex((line) =>
    new RegExp(`^FROM\\s+\\S+\\s+AS\\s+${name}\\s*$`, 'i').test(line.trim()),
  );

  expect(start, `the Dockerfile must declare a '${name}' stage`).toBeGreaterThan(-1);

  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^FROM\s/i.test(line.trim()));

  return (end === -1 ? rest : rest.slice(0, end)).join('\n');
}

describe('N5 — the test stage has complete inputs', () => {
  it('copies the test suite', async () => {
    const test = await stage('test');

    expect(test).toMatch(/^COPY tests /m);
  });

  it('copies `.env.example`, which the environment tests read', async () => {
    // The exact defect. `tests/config/env-example.test.ts` reads this file to
    // assert it stays VALUELESS (SECURITY_BASELINE.md §18.1). Without it, the
    // suite failed inside the image for a packaging reason.
    const test = await stage('test');

    expect(test).toMatch(/^COPY \.env\.example /m);
  });

  it('copies the vitest configuration the suite runs under', async () => {
    const test = await stage('test');

    expect(test).toContain('vitest.config.ts');
  });

  it('copies the Playwright configuration the cleanup regression reads', async () => {
    const test = await stage('test');

    expect(test).toContain('playwright.config.ts');
  });

  /**
   * The same defect as `.env.example`, one round later.
   * `tests/config/ci-credentials.test.ts` READS the workflow to assert the CI
   * contract, so the file is a test input. Without it the suite failed inside
   * the image with ENOENT — a packaging problem wearing a test failure's
   * clothes.
   */
  it('copies the CI workflow, which the CI regression suite reads', async () => {
    const test = await stage('test');

    expect(test).toMatch(/^COPY \.github\/workflows\/ci\.yml /m);
  });

  it('defaults to verifying rather than serving', async () => {
    const test = await stage('test');

    expect(test).toContain('verify');
  });

  it('generates the Prisma client after copying the schema', async () => {
    const test = await stage('test');

    expect(test).toContain(
      'prisma generate --schema packages/database/prisma/schema.prisma',
    );
  });
});

describe('N5 — the runtime stage stays lean', () => {
  it('does not copy the test suite', async () => {
    // A runtime image should contain what it runs. Fixtures in a running image
    // are dead weight at best, and confusion about what the image is at worst.
    const dev = await stage('dev');

    expect(dev).not.toMatch(/^COPY tests /m);
  });

  it('does not copy test fixtures or `.env.example`', async () => {
    const dev = await stage('dev');

    expect(dev).not.toContain('fixtures');
    expect(dev).not.toContain('.env.example');
  });

  /**
   * CI metadata is an input to the verification suite, not to the running
   * application. The test stage carries the workflow; the runtime image has
   * no reason to know how the project is built.
   */
  it('does not copy the CI workflow', async () => {
    const dev = await stage('dev');

    expect(dev).not.toContain('.github');
  });

  it('still copies the application and package source it must run', async () => {
    const dev = await stage('dev');

    expect(dev).toMatch(/^COPY apps /m);
    expect(dev).toMatch(/^COPY packages /m);
  });

  it('generates the Prisma client needed by the runtime', async () => {
    const dev = await stage('dev');

    expect(dev).toContain(
      'prisma generate --schema packages/database/prisma/schema.prisma',
    );
  });

  it('starts through the fail-fast wrapper', async () => {
    // The container must exit non-zero on bad configuration rather than come
    // up and serve 500s, which would pass a port health check
    // (SECURITY_BASELINE.md §18.1).
    const dev = await stage('dev');

    expect(dev).toContain('npm');
    expect(dev).toContain('dev');
    expect(dev).toContain('--hostname');
  });
});

describe('N5 — compose builds the runtime stage, not the test stage', () => {
  it('names the dev target explicitly', async () => {
    // Without an explicit target, a multi-stage build produces the LAST stage.
    // Naming it means the served image cannot silently change because a stage
    // was appended.
    const compose = await readFile(path.join(repoRoot, 'docker', 'compose.yaml'), 'utf8');

    expect(compose).toMatch(/target:\s*dev/);
  });
});

describe('N5 — no image layer may carry a real environment file', () => {
  it('excludes `.env` and re-includes only the valueless example', async () => {
    const dockerignore = await readFile(path.join(repoRoot, '.dockerignore'), 'utf8');
    const lines = dockerignore
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('#'));

    expect(lines).toContain('.env');
    expect(lines).toContain('.env.*');

    // `.env` and `.env.*` are matched relative to the context ROOT, so on
    // their own they exclude `/.env` and nothing deeper. `COPY docker ./docker`
    // consequently carried `docker/.env` — the real `sa` and application
    // passwords — into the test image. These are the patterns that make the
    // rule hold at any depth, and they must not be removed.
    expect(lines).toContain('**/.env');
    expect(lines).toContain('**/.env.*');

    // Docker applies the LAST matching pattern, so the re-include must come
    // after the exclusions or `.env.example` never reaches the test stage.
    expect(lines.indexOf('!.env.example')).toBeGreaterThan(lines.indexOf('.env.*'));
  });

  it('keeps certificates and keys out of every layer', async () => {
    const dockerignore = await readFile(path.join(repoRoot, '.dockerignore'), 'utf8');

    for (const pattern of ['*.pem', '*.key', '*.pfx', '*.crt']) {
      expect(dockerignore, `${pattern} must be excluded`).toContain(pattern);
    }
  });

  /**
   * `.github/` stays excluded as a directory; exactly one file is re-included,
   * because exactly one file is a test input. Docker cannot descend into an
   * excluded directory, so both parents are re-included before the file — and
   * the exceptions are exact paths rather than globs, so nothing else under
   * `.github/` can arrive with it.
   */
  /**
   * `.github` admits exactly one file, and the POLICY must fail closed for
   * files that do not exist yet.
   *
   * Asserted by EVALUATING the patterns against candidate paths rather than by
   * comparing the pattern list to an expected list. A literal comparison is
   * what let the first attempt through: `.github/` followed by `!.github/`
   * reads as narrow, and each line is individually defensible, but a negation
   * on a DIRECTORY re-admits everything beneath it — a sentinel file and a
   * second workflow both reached the build context. Only asking "what would
   * this path do?" catches that.
   */
  describe('`.github` admits exactly one file', () => {
    /**
     * Docker's rule, reduced to what these patterns exercise: the LAST
     * matching pattern decides, and a path whose parent directory is excluded
     * cannot be re-included by a later pattern naming the child.
     */
    function isIncluded(patterns: readonly string[], candidate: string): boolean {
      const decide = (subject: string): boolean | undefined => {
        let included: boolean | undefined;

        for (const raw of patterns) {
          const negated = raw.startsWith('!');
          const pattern = (negated ? raw.slice(1) : raw).replace(/\/$/, '');

          const expression = new RegExp(
            `^${pattern
              .replaceAll(/[.+^${}()|[\]\\]/g, '\\$&')
              .replaceAll('**', ' ')
              .replaceAll('*', '[^/]*')
              .replaceAll(' ', '.*')}$`,
          );

          if (expression.test(subject)) included = negated;
        }

        return included;
      };

      // Walk the path root-first: a directory excluded on the way down is
      // never descended into, whatever a later pattern says about its
      // children. This is the semantic the broad `!.github/` violated.
      const segments = candidate.split('/');
      let inherited: boolean | undefined;

      for (let index = 0; index < segments.length; index += 1) {
        const ancestor = segments.slice(0, index + 1).join('/');
        const verdict = decide(ancestor);

        if (verdict !== undefined) inherited = verdict;
        // An excluded ancestor blocks everything below it.
        if (inherited === false && index < segments.length - 1) return false;
      }

      return inherited !== false;
    }

    async function patterns(): Promise<string[]> {
      const dockerignore = await readFile(path.join(repoRoot, '.dockerignore'), 'utf8');
      return dockerignore
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '' && !line.startsWith('#'));
    }

    it('admits the CI workflow the suite reads', async () => {
      expect(isIncluded(await patterns(), '.github/workflows/ci.yml')).toBe(true);
    });

    // Phase 28: the staging suite reads the protected deploy workflow, so it
    // is admitted by its exact name — and a generic `deploy.yml` still is not.
    it('admits the staging deploy workflow the staging suite reads', async () => {
      expect(isIncluded(await patterns(), '.github/workflows/staging-deploy.yml')).toBe(
        true,
      );
      expect(isIncluded(await patterns(), '.github/workflows/deploy.yml')).toBe(false);
    });

    it.each([
      ['unrelated top-level content', '.github/UNRELATED_SENTINEL'],
      ['a CODEOWNERS file', '.github/CODEOWNERS'],
      ['an issue template', '.github/ISSUE_TEMPLATE/bug.md'],
      ['a composite action', '.github/actions/setup/action.yml'],
      ['a second workflow', '.github/workflows/UNRELATED_WORKFLOW.yml'],
      ['a future deploy workflow', '.github/workflows/deploy.yml'],
    ])('excludes %s', async (_label, candidate) => {
      expect(isIncluded(await patterns(), candidate)).toBe(false);
    });

    /**
     * The evaluator must be able to FAIL. Run against the broad policy that
     * shipped first, it has to report the sentinel as admitted — otherwise a
     * green result above would prove only that the check is inert.
     */
    it('detects the broad policy this replaced', () => {
      const broad = ['.github/', '!.github/', '!.github/workflows/ci.yml'];

      expect(isIncluded(broad, '.github/workflows/ci.yml')).toBe(true);
      expect(isIncluded(broad, '.github/UNRELATED_SENTINEL')).toBe(true);
    });

    /** No blanket negation may re-admit a whole `.github` subtree. */
    it('carries no directory-wide `.github` negation', async () => {
      const lines = await patterns();
      const negations = lines.filter((line) => line.startsWith('!.github'));

      expect(negations).toContain('!.github/workflows/ci.yml');
      expect(negations).toContain('!.github/workflows/staging-deploy.yml');
      expect(negations).not.toContain('!.github/');
      expect(negations).not.toContain('!.github/**');
      // `!.github/workflows/` is permitted: it only makes the directory
      // traversable, and `.github/workflows/*` immediately re-excludes its
      // contents. Any other negation would widen the contract.
      for (const negation of negations) {
        expect([
          '!.github/workflows/',
          '!.github/workflows/ci.yml',
          '!.github/workflows/staging-deploy.yml',
        ]).toContain(negation);
      }
    });
  });

  it('proves `.env.example` genuinely carries no values', async () => {
    // The reason the test stage needs the file at all, asserted here too so the
    // packaging decision and the security rule are visibly connected.
    const example = await readFile(path.join(repoRoot, '.env.example'), 'utf8');

    for (const line of example.split('\n')) {
      const trimmed = line.trim();
      if (trimmed === '' || trimmed.startsWith('#')) continue;

      expect(trimmed, `'${trimmed}' must have no value`).toMatch(/^[A-Z0-9_]+=$/);
    }
  });
});

/* ===========================================================================
 * Phase 25 — the realtime image and the NGINX WebSocket seam
 * ========================================================================= */

/** A file's directives with its `#` comment lines removed. */
async function directives(...segments: string[]): Promise<string> {
  const source = await readFile(path.join(repoRoot, ...segments), 'utf8');
  return source
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith('#'))
    .join('\n');
}

/** The body of one stage of a named Dockerfile, comments removed. */
async function stageOf(file: string, name: string): Promise<string> {
  const lines = (await directives('docker', file)).split('\n');
  const start = lines.findIndex((line) =>
    new RegExp(`^FROM\\s+\\S+\\s+AS\\s+${name}\\s*$`, 'i').test(line.trim()),
  );
  expect(start, `${file} must declare a '${name}' stage`).toBeGreaterThan(-1);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^FROM\s/i.test(line.trim()));
  return (end === -1 ? rest : rest.slice(0, end)).join('\n');
}

/** Every workspace manifest on disk, as `<dir>/<name>/package.json`. */
async function workspaceManifests(): Promise<string[]> {
  const found: string[] = [];
  for (const parent of ['apps', 'packages']) {
    for (const entry of await readdir(path.join(repoRoot, parent))) {
      const manifest = path.join(repoRoot, parent, entry, 'package.json');
      if ((await stat(manifest).catch(() => null))?.isFile() === true)
        found.push(`${parent}/${entry}/package.json`);
    }
  }
  return found.sort();
}

describe('Phase 25 — every dependency install sees every workspace', () => {
  it.each([
    ['web.Dockerfile', 'deps'],
    ['realtime.Dockerfile', 'build'],
    ['realtime.Dockerfile', 'runtime'],
    ['web.Dockerfile', 'runtime'],
    ['ops.Dockerfile', 'ops'],
  ])('%s %s copies each workspace manifest before `npm ci`', async (file, name) => {
    const body = await stageOf(file, name);
    // A command-scoped `NODE_ENV=…` prefix is still the install.
    const install = body.search(/^RUN (?:NODE_ENV=\S+ )?npm ci/m);
    expect(install).toBeGreaterThan(-1);
    const before = body.slice(0, install);
    const manifests = await workspaceManifests();
    expect(manifests).toContain('apps/realtime/package.json');
    for (const manifest of manifests)
      expect(before, `${file} ${name} must copy ${manifest}`).toContain(
        `COPY ${manifest} `,
      );
  });
});

describe('Phase 25 — the realtime runtime image carries only what it runs', () => {
  it('uses the same exact Node image as the web image', async () => {
    const web = await directives('docker', 'web.Dockerfile');
    const realtime = await directives('docker', 'realtime.Dockerfile');
    const base = /^FROM (node:24\.22\.1-\S+)/m.exec(web)?.[1];
    expect(base).toBe('node:24.22.1-bookworm-slim');
    const images = [...realtime.matchAll(/^FROM (\S+)/gm)].map((match) => match[1]);
    expect(images).toEqual([base, base]);
  });

  it('installs production dependencies only and takes the generated client from the build stage', async () => {
    const build = await stageOf('realtime.Dockerfile', 'build');
    const runtime = await stageOf('realtime.Dockerfile', 'runtime');
    expect(build).toContain(
      'prisma generate --schema packages/database/prisma/schema.prisma',
    );
    expect(runtime).toMatch(/^RUN npm ci --omit=dev/m);
    expect(runtime).toContain('COPY --from=build /app/node_modules/.prisma');
  });

  it('carries no tests, fixtures, environment files, scripts, docs, CI or lifecycle tooling', async () => {
    const runtime = await stageOf('realtime.Dockerfile', 'runtime');
    for (const forbidden of [
      'tests',
      'fixtures',
      'scripts',
      'docs',
      '.github',
      'migrations',
      'packages/database/sql',
      'playwright',
      'COPY apps ',
      'COPY packages ',
      'apps/web/src/app',
      'apps/web/src/contexts',
    ])
      expect(runtime, `the realtime runtime must not carry ${forbidden}`).not.toContain(
        forbidden,
      );
    // No environment file is named by any COPY (the HEALTHCHECK reads `process.env`).
    expect(runtime).not.toMatch(/^COPY .*.env/m);
  });

  it('copies the transport and the four composition modules the process imports', async () => {
    const runtime = await stageOf('realtime.Dockerfile', 'runtime');
    expect(runtime).toContain('COPY apps/realtime/src ./apps/realtime/src');
    for (const module of [
      'realtime-main.ts',
      'realtime.ts',
      'identity-mechanics.ts',
      'messaging-wiring.ts',
    ])
      expect(runtime).toContain(`apps/web/src/composition/${module}`);
  });

  it('runs unprivileged, directly under Node, from the composition entry', async () => {
    const runtime = await stageOf('realtime.Dockerfile', 'runtime');
    expect(runtime).toMatch(/^USER node$/m);
    expect(runtime).toContain(
      'CMD ["node", "--conditions=react-server", "apps/web/src/composition/realtime-main.ts"]',
    );
    expect(runtime).toMatch(/^ENV NODE_ENV=production$/m);
  });
});

describe('Phase 25 — the NGINX seam sets, never forwards, what a client could forge', () => {
  const template = () =>
    directives('docker', 'nginx', 'templates', 'default.conf.template');

  /** One `location` block, braces balanced. */
  async function location(prefix: string): Promise<string> {
    const source = await template();
    const start = source.indexOf(`location ${prefix} {`);
    expect(start, `the template must route ${prefix}`).toBeGreaterThan(-1);
    let depth = 0;
    for (let index = source.indexOf('{', start); index < source.length; index += 1) {
      if (source[index] === '{') depth += 1;
      if (source[index] === '}') depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
    throw new Error(`unterminated location ${prefix}`);
  }

  it('upgrades `/socket.io/` to the realtime upstream over HTTP/1.1, unbuffered', async () => {
    const socket = await location('/socket.io/');
    expect(socket).toContain('proxy_pass http://minhaj_realtime;');
    expect(socket).toContain('proxy_http_version 1.1;');
    expect(socket).toContain('proxy_set_header Upgrade $http_upgrade;');
    expect(socket).toContain('proxy_set_header Connection $connection_upgrade;');
    expect(socket).toContain('proxy_buffering off;');
    expect(socket).toContain('proxy_cache off;');
    expect(socket).toMatch(/proxy_read_timeout \d+s;/);
    expect(socket).toMatch(/proxy_send_timeout \d+s;/);
    expect(await template()).toMatch(/map \$http_upgrade \$connection_upgrade/);
  });

  it('sends everything else to the web upstream', async () => {
    expect(await location('/')).toContain('proxy_pass http://minhaj_web;');
  });

  it.each(['/socket.io/', '/'])(
    'overwrites every forwarding header on %s',
    async (prefix) => {
      const block = await location(prefix);
      expect(block).toContain('proxy_set_header X-Forwarded-For $remote_addr;');
      expect(block).toContain('proxy_set_header X-Real-IP $remote_addr;');
      expect(block).toContain('proxy_set_header X-Forwarded-Proto $scheme;');
      expect(block).toContain('proxy_set_header X-Forwarded-Host "";');
      expect(block).toContain('proxy_set_header Forwarded "";');
      expect(block).toContain('proxy_set_header Host $http_host;');
      // The client's own header is never appended to or passed on.
      expect(block).not.toContain('$proxy_add_x_forwarded_for');
      expect(block).not.toContain('$http_x_forwarded_for');
    },
  );

  it('answers only for the configured host and refuses any other', async () => {
    const source = await template();
    expect(source).toContain('server_name ${MINHAJ_PUBLIC_HOST};');
    expect(source).toMatch(
      /listen 8080 default_server;\s*server_name _;[^}]*return 421;/,
    );
  });

  it('logs no query string, header or cookie', async () => {
    const source = await template();
    const format = /log_format minhaj_access ([^;]+);/.exec(source)?.[1] ?? '';
    expect(format).toContain('$uri');
    for (const leaky of ['$request ', '$args', '$query_string', '$http_', '$cookie_'])
      expect(format).not.toContain(leaky);
  });
});

describe('Phase 25 — compose adds realtime and the proxy behind a profile', () => {
  /** One top-level service's block. */
  async function service(name: string): Promise<string> {
    const compose = await directives('docker', 'compose.yaml');
    const lines = compose.split('\n');
    const start = lines.indexOf(`  ${name}:`);
    expect(start, `compose must declare ${name}`).toBeGreaterThan(-1);
    const rest = lines.slice(start + 1);
    const end = rest.findIndex((line) => /^ {2}\S|^\S/.test(line));
    return (end === -1 ? rest : rest.slice(0, end)).join('\n');
  }

  it.each(['realtime', 'proxy'])('keeps %s out of the default stack', async (name) => {
    expect(await service(name)).toContain('profiles: [realtime]');
  });

  it.each(['sqlserver', 'clamav', 'web'])(
    'leaves %s in the default stack',
    async (name) => {
      expect(await service(name)).not.toContain('profiles:');
    },
  );

  it('builds realtime from its own Dockerfile and pins the proxy by digest', async () => {
    expect(await service('realtime')).toContain('dockerfile: docker/realtime.Dockerfile');
    expect(await service('proxy')).toContain(
      'image: nginx:1.30.6-alpine@sha256:970364228b1e4f932abc22d321932816782cca8a20b85a77552a7cfe9acfb3b5',
    );
  });

  it('keeps the persistent volumes exactly as they were', async () => {
    const compose = await directives('docker', 'compose.yaml');
    expect(compose).toContain('name: minhaj-platform-sqlserver-data');
    expect(compose).toContain('name: minhaj-platform-storage-data');
  });
});

/* ===========================================================================
 * Phase 28 — the production web runtime and the operations image
 * ========================================================================= */

/** The exact CMD line of a stage, or `undefined`. */
function cmdOf(body: string): string | undefined {
  return /^CMD (.+)$/m.exec(body)?.[1];
}

describe('Phase 28 — the test stage carries the staging suite input', () => {
  it('copies the staging deploy workflow beside the CI workflow', async () => {
    const test = await stage('test');
    expect(test).toMatch(/^COPY \.github\/workflows\/staging-deploy\.yml /m);
  });
});

describe('Phase 28 — the web build stage is bound to one declared origin', () => {
  it('takes the origin and indexing posture as build arguments, indexing off by default', async () => {
    const build = await stageOf('web.Dockerfile', 'build');
    expect(build).toMatch(/^ARG AUTH_BASE_URL$/m);
    expect(build).toMatch(/^ARG PUBLIC_INDEXING_ENABLED=false$/m);
  });

  it('refuses an empty origin before it builds anything', async () => {
    const build = await stageOf('web.Dockerfile', 'build');
    const guard = build.search(/^RUN if \[ -z "\$AUTH_BASE_URL" \]; then/m);
    expect(guard).toBeGreaterThan(-1);
    expect(build.slice(guard)).toMatch(/exit 1/);
    // The guard runs before the build, so an unset origin costs nothing.
    expect(guard).toBeLessThan(build.search(/npm run build/));
  });

  it('accepts no secret as a build argument', async () => {
    const source = await directives('docker', 'web.Dockerfile');
    const args = [...source.matchAll(/^ARG (\w+)/gm)].map((match) => match[1]);
    // The public origin is declared twice — once to build for it, once to label
    // the runtime image with it — and is the only value besides the posture.
    expect([...new Set(args)].sort()).toEqual([
      'AUTH_BASE_URL',
      'PUBLIC_INDEXING_ENABLED',
    ]);
  });

  it('builds for production and ships no build cache', async () => {
    const build = await stageOf('web.Dockerfile', 'build');
    expect(build).toContain(
      'prisma generate --schema packages/database/prisma/schema.prisma',
    );
    expect(build).toMatch(/^ENV NODE_ENV=production$/m);
    expect(build).toContain('npm run build --workspace @minhaj/web');
    expect(build).toContain('rm -rf apps/web/.next/cache');
    // The build reads source, never the suite or its inputs.
    for (const forbidden of ['COPY tests', 'fixtures', '.github', '.env', 'docs'])
      expect(build, `the build stage must not copy ${forbidden}`).not.toContain(
        forbidden,
      );
  });
});

describe('Phase 28 — the production web runtime carries only what it runs', () => {
  it('uses the same exact Node image, and every web stage derives from it', async () => {
    const web = await directives('docker', 'web.Dockerfile');
    const images = [...web.matchAll(/^FROM (\S+) AS (\w+)$/gm)].map(
      ([, image, name]) => `${name}:${image}`,
    );
    expect(images).toEqual([
      'deps:node:24.22.1-bookworm-slim',
      'test:deps',
      'dev:deps',
      'build:deps',
      'runtime:node:24.22.1-bookworm-slim',
    ]);
  });

  it('installs production dependencies only and takes the generated client from the build stage', async () => {
    const runtime = await stageOf('web.Dockerfile', 'runtime');
    expect(runtime).toMatch(/^RUN npm ci --omit=dev && npm cache clean --force$/m);
    expect(runtime).toContain('COPY --from=build /app/node_modules/.prisma');
    expect(runtime).toMatch(
      /^COPY --from=build --chown=node:node \/app\/apps\/web\/\.next /m,
    );
    // The runtime itself never generates, builds or installs development tools.
    expect(runtime).not.toContain('prisma generate');
    expect(runtime).not.toContain('npm run build');
  });

  it('copies the start wrapper, its validator, the config and the one package source they load', async () => {
    const runtime = await stageOf('web.Dockerfile', 'runtime');
    expect(runtime).toContain('apps/web/scripts/start.mjs');
    expect(runtime).toContain('apps/web/scripts/validate-env.mjs');
    expect(runtime).toContain('COPY apps/web/next.config.ts ');
    expect(runtime).toContain('COPY packages/contracts/src ./packages/contracts/src');
    const sources = [...runtime.matchAll(/^COPY (packages\/\S+)/gm)].map(
      (match) => match[1],
    );
    expect(sources.filter((source) => !source.endsWith('/package.json'))).toEqual([
      'packages/contracts/src',
    ]);
  });

  it('carries no tests, fixtures, environment files, docs, CI or lifecycle tooling', async () => {
    const runtime = await stageOf('web.Dockerfile', 'runtime');
    for (const forbidden of [
      'tests',
      'fixtures',
      'docs',
      '.github',
      'migrations',
      'packages/database/scripts',
      'packages/database/sql',
      'packages/database/prisma',
      'playwright',
      'COPY apps ',
      'COPY packages ',
      'COPY scripts',
      'apps/web/src',
    ])
      expect(runtime, `the web runtime must not carry ${forbidden}`).not.toContain(
        forbidden,
      );
    expect(runtime).not.toMatch(/^COPY .*\.env/m);
  });

  it('runs unprivileged, in production, through the fail-fast wrapper directly under Node', async () => {
    const runtime = await stageOf('web.Dockerfile', 'runtime');
    expect(runtime).toMatch(/^ENV NODE_ENV=production$/m);
    expect(runtime).toMatch(/^USER node$/m);
    expect(runtime).toMatch(/^EXPOSE 3000$/m);
    // Exactly the wrapper: not npm (which would swallow SIGTERM), not `next`
    // (which would skip validation), and never the development server.
    expect(cmdOf(runtime)).toBe('["node", "apps/web/scripts/start.mjs"]');
    expect(runtime).not.toMatch(/next dev|--dev|npm run dev|"dev"/);
  });

  it('declares a health check that asks the server for a prerendered page', async () => {
    const runtime = await stageOf('web.Dockerfile', 'runtime');
    expect(runtime).toMatch(/^HEALTHCHECK /m);
    expect(runtime).toContain('/robots.txt');
  });

  /**
   * The wrapper resolves Next from `<app>/../../node_modules`, so the runtime's
   * layout must put `apps/web` two levels below the directory `npm ci` ran in.
   */
  it('keeps the layout the wrapper resolves Next from', async () => {
    const runtime = await stageOf('web.Dockerfile', 'runtime');
    expect(runtime).toMatch(/^WORKDIR \/app$/m);
    const wrapper = await readFile(
      path.join(repoRoot, 'apps', 'web', 'scripts', 'start.mjs'),
      'utf8',
    );
    expect(wrapper).toMatch(
      /path\.join\(\s*appRoot,\s*'\.\.',\s*'\.\.',\s*'node_modules',\s*'next',/,
    );
  });
});

describe('Phase 28 — the operations image is a tool, never a service', () => {
  it('uses the same exact Node image as the web image', async () => {
    const ops = await directives('docker', 'ops.Dockerfile');
    expect([...ops.matchAll(/^FROM (\S+)/gm)].map((match) => match[1])).toEqual([
      'node:24.22.1-bookworm-slim',
    ]);
  });

  it('carries the Prisma CLI, the schema with its migrations, and the generated client', async () => {
    const ops = await stageOf('ops.Dockerfile', 'ops');
    // The full install is scoped to its one command; the image then runs in
    // production posture.
    expect(ops).toMatch(/^RUN NODE_ENV=development npm ci /m);
    expect(ops).toMatch(/^ENV NODE_ENV=production$/m);
    expect(ops).toContain('COPY packages/database/prisma ./packages/database/prisma');
    expect(ops).toContain('COPY packages/database/prisma.config.ts ');
    expect(ops).toContain('COPY packages/database/scripts ');
    expect(ops).toContain(
      'prisma generate --schema packages/database/prisma/schema.prisma',
    );
  });

  it('carries the staging deploy bundle under /opt/minhaj-staging', async () => {
    const ops = await stageOf('ops.Dockerfile', 'ops');
    expect(ops).toContain(
      'COPY docker/staging/compose.yaml /opt/minhaj-staging/compose.yaml',
    );
    expect(ops).toContain('COPY docker/staging/bin /opt/minhaj-staging/bin');
    expect(ops).toContain('COPY docker/staging/systemd /opt/minhaj-staging/systemd');
    expect(ops).toContain('COPY docker/nginx/staging /opt/minhaj-staging/nginx');
    expect(ops).toContain(
      'COPY docker/sqlserver/Dockerfile /opt/minhaj-staging/sqlserver/Dockerfile',
    );
  });

  it('names no script to run, so nothing — a migration least of all — runs on start', async () => {
    const ops = await stageOf('ops.Dockerfile', 'ops');
    expect(ops).toContain('ENTRYPOINT ["node", "--conditions=react-server"]');
    expect(ops).not.toMatch(/^CMD /m);
    expect(ops).not.toMatch(/^ENTRYPOINT .*(\.ts|\.mjs|migrate|prisma)/m);
    expect(ops).not.toMatch(/^HEALTHCHECK /m);
    expect(ops).not.toMatch(/^EXPOSE /m);
  });

  it('carries the migration tooling and exactly the node-runnable composition graph it loads', async () => {
    const ops = await stageOf('ops.Dockerfile', 'ops');
    expect(ops).toContain('COPY scripts/migration ./scripts/migration');
    expect(ops).toContain('COPY packages/server-core/src ./packages/server-core/src');
    for (const module of [
      'migration-runner.ts',
      'migration-wiring.ts',
      'migration-targets.ts',
      'migration-target-router.ts',
      'migration-target-support.ts',
      'migration-library-targets.ts',
      'migration-editorial-targets.ts',
    ])
      expect(ops).toContain(`apps/web/src/composition/${module}`);
    // Every module the tooling reaches inside the web workspace is copied, and
    // nothing of the web application beyond them: no page, route or component,
    // and no composition root that the bundler alone can load.
    const reached = new Set<string>();
    const queue = [
      'scripts/migration/run-fixture.ts',
      'scripts/migration/promote.ts',
      'scripts/migration/staging-fixture-proof.ts',
    ];
    while (queue.length > 0) {
      const file = queue.pop()!;
      if (reached.has(file)) continue;
      reached.add(file);
      const source = await readFile(path.join(repoRoot, file), 'utf8');
      for (const [, specifier] of source.matchAll(/from '(\.{1,2}\/[^']+\.ts)'/gu)) {
        const target = path.posix.normalize(
          path.posix.join(path.posix.dirname(file), specifier!),
        );
        if (target.startsWith('apps/web/src/') || target.startsWith('scripts/migration/'))
          queue.push(target);
      }
    }
    const copied = [...ops.matchAll(/(apps\/web\/src\/[a-z/.-]+)/gu)].map(
      (match) => match[1]!,
    );
    for (const file of reached)
      if (file.startsWith('apps/web/src/'))
        expect(
          copied.some((entry) => file === entry || file.startsWith(`${entry}/`)),
          `${file} is loaded by the migration tooling but not copied`,
        ).toBe(true);
    for (const entry of copied)
      expect(entry, 'the operations image copies only what the tooling loads').toMatch(
        /^apps\/web\/src\/(?:composition\/migration-(?:runner|wiring|targets|target-router|target-support|library-targets|editorial-targets|global-targets|people-targets)\.ts|composition\/storage\.ts|contexts\/[a-z-]+|composition\/)$/u,
      );
    expect(ops).not.toMatch(/apps\/web\/src\/(?:app|components|i18n|config)\b/u);
  });

  it('runs unprivileged and carries no tests, fixtures, environment files or CI', async () => {
    const ops = await stageOf('ops.Dockerfile', 'ops');
    expect(ops).toMatch(/^USER node$/m);
    for (const forbidden of [
      'tests',
      'fixtures',
      '.github',
      'docs/',
      'COPY apps ',
      'COPY packages ',
    ])
      expect(ops, `the operations image must not carry ${forbidden}`).not.toContain(
        forbidden,
      );
    expect(ops).not.toMatch(/^COPY .*\.env/m);
  });
});
