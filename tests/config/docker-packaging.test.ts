import { readFile } from 'node:fs/promises';
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
      expect(negations).not.toContain('!.github/');
      expect(negations).not.toContain('!.github/**');
      // `!.github/workflows/` is permitted: it only makes the directory
      // traversable, and `.github/workflows/*` immediately re-excludes its
      // contents. Any other negation would widen the contract.
      for (const negation of negations) {
        expect(['!.github/workflows/', '!.github/workflows/ci.yml']).toContain(negation);
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
