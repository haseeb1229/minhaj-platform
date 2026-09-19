import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { repoRoot } from '../architecture/architecture-harness.ts';

/**
 * F14 — which refs CI actually validates.
 *
 * The workflow covered `push: [main]` and `pull_request: [main]` and nothing
 * else, so a governed branch received NO remote validation. Pushing
 * `feature/pre-phase-2-baseline-hardening` triggered no run at all, which left
 * two bad options: open a pull request for work not ready for review, or merge
 * to `main` to discover whether merging to `main` was safe.
 *
 * These assertions read the committed workflow and reason about its STRUCTURE.
 * A grep would answer "does the string `feature/**` appear", which is not the
 * question — the question is whether a branch named `feature/x` matches the
 * push trigger, whether the required jobs still exist, and whether a path
 * filter could let a source change bypass validation. Those need the parsed
 * shape, so the file is parsed.
 *
 * `tests/config/ci-credentials.test.ts` covers the ORDERING and credential
 * safety of the steps inside those jobs; this covers what causes them to run.
 */

const workflowPath = path.join(repoRoot, '.github', 'workflows', 'ci.yml');
const source = readFileSync(workflowPath, 'utf8');

/* ---------------------------------------------------------------------------
 * A block-structure reader for the YAML subset this workflow uses.
 *
 * Deliberately NOT a general YAML parser, and deliberately not a new
 * dependency: adding a library to check the dependency-governed CI policy would
 * be its own architecture decision. It reads mappings, block sequences and
 * inline flow sequences, which is exactly what the file contains — and it
 * THROWS on anything it does not understand, so an unparseable workflow fails
 * the suite instead of quietly yielding an empty object that every assertion
 * below would then pass against.
 * ------------------------------------------------------------------------ */

type Node = string | Node[] | Record<string, Node>;

function parseBlock(
  lines: { indent: number; text: string }[],
  start: number,
  end: number,
): Node {
  const first = lines[start];
  if (first === undefined) return {};

  const indent = first.indent;

  // A block sequence.
  if (first.text.startsWith('- ')) {
    const items: Node[] = [];

    for (let index = start; index < end; index += 1) {
      const line = lines[index]!;
      if (line.indent !== indent) continue;
      if (!line.text.startsWith('- ')) {
        throw new Error(`unsupported workflow structure at '${line.text}'`);
      }

      let next = index + 1;
      while (next < end && lines[next]!.indent > indent) next += 1;

      const inline = line.text.slice(2).trim();
      const children = lines.slice(index + 1, next);

      // `- name: Check out` carries its first mapping entry ON the dash line,
      // with the rest of the entry indented beneath it. Dropping the inline
      // half — which an earlier revision did — silently produced steps with no
      // `name`, and every assertion about step names then compared undefined
      // against undefined.
      if (inline.includes(':') && !inline.startsWith('-')) {
        const merged = [{ indent: indent + 2, text: inline }, ...children];
        items.push(parseBlock(merged, 0, merged.length));
      } else if (children.length > 0) {
        items.push(parseBlock(lines, index + 1, next));
      } else {
        items.push(unquote(inline));
      }
    }

    return items;
  }

  // A mapping.
  const mapping: Record<string, Node> = {};

  for (let index = start; index < end; index += 1) {
    const line = lines[index]!;
    if (line.indent !== indent) continue;

    const separator = line.text.indexOf(':');
    if (separator === -1) {
      throw new Error(`unsupported workflow structure at '${line.text}'`);
    }

    const key = unquote(line.text.slice(0, separator).trim());
    const inline = line.text.slice(separator + 1).trim();

    let next = index + 1;
    while (next < end && lines[next]!.indent > indent) next += 1;

    if (inline !== '') {
      mapping[key] = inline.startsWith('[')
        ? inline
            .slice(1, inline.lastIndexOf(']'))
            .split(',')
            .map((item) => unquote(item.trim()))
            .filter((item) => item !== '')
        : unquote(inline);
      // A `key: value |` block scalar's body is skipped by the indent walk.
      index = next - 1;
      continue;
    }

    mapping[key] = next > index + 1 ? parseBlock(lines, index + 1, next) : '';
    index = next - 1;
  }

  return mapping;
}

function unquote(value: string): string {
  const trimmed = value.trim();

  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length > 1) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length > 1)
  ) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

function parseWorkflow(text: string): Record<string, Node> {
  const lines: { indent: number; text: string }[] = [];
  let inBlockScalar = false;
  let blockScalarIndent = 0;

  for (const raw of text.split('\n')) {
    const withoutTabs = raw.replace(/\t/g, '  ');
    const indent = withoutTabs.length - withoutTabs.trimStart().length;
    const trimmed = withoutTabs.trim();

    // A `run: |` body is arbitrary shell, not structure. Skip it wholesale
    // rather than pretending to parse it.
    if (inBlockScalar) {
      if (trimmed !== '' && indent <= blockScalarIndent) inBlockScalar = false;
      else continue;
    }

    if (trimmed === '' || trimmed.startsWith('#')) continue;

    lines.push({ indent, text: trimmed });

    if (/:\s*[|>][-+]?\s*$/.test(trimmed)) {
      inBlockScalar = true;
      blockScalarIndent = indent;
    }
  }

  const parsed = parseBlock(lines, 0, lines.length);

  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('the workflow did not parse as a mapping');
  }

  return parsed;
}

const workflow = parseWorkflow(source);

/** The workflow with comment lines removed, for whole-file prohibitions. */
const withoutComments = source
  .split(/\r?\n/)
  .filter((line) => !line.trim().startsWith('#'))
  .join('\n');

/**
 * `on` is the one key YAML 1.1 turns into a boolean. Both spellings are
 * accepted here so the test describes the file rather than one reader's quirk.
 */
function triggers(): Record<string, Node> {
  const value = (workflow['on'] ?? workflow['true']) as Record<string, Node> | undefined;

  if (value === undefined || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('the workflow declares no `on:` triggers');
  }

  return value;
}

/** The branch patterns of one trigger, however they are written. */
function branchPatterns(trigger: string): string[] {
  const node = triggers()[trigger];

  if (node === undefined || typeof node !== 'object' || Array.isArray(node)) {
    throw new Error(`the workflow declares no '${trigger}' trigger`);
  }

  const branches = node['branches'];

  if (!Array.isArray(branches)) {
    throw new Error(`the '${trigger}' trigger declares no branch list`);
  }

  return branches.map(String);
}

/**
 * Placeholder standing in for `**` while `*` is being translated.
 *
 * Written as an ESCAPE rather than a literal NUL byte. A raw NUL makes Git
 * classify the whole file as binary, so `git diff` reduces every change to
 * `Bin <old> -> <new> bytes` — on a file whose entire job is asserting the CI
 * policy, which is precisely the file a reviewer must be able to read. The
 * escape is the same character to the runtime and leaves the file text.
 */
const SENTINEL = '\u0000';

/** GitHub's branch-filter globbing, reduced to what these patterns use. */
function matchesBranch(patterns: readonly string[], branch: string): boolean {
  return patterns.some((pattern) => {
    const expression = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replaceAll('**', SENTINEL)
      .replaceAll('*', '[^/]*')
      .replaceAll(SENTINEL, '.*');

    return new RegExp(`^${expression}$`).test(branch);
  });
}

describe('F14.1 — the parser is real, and fails closed', () => {
  it('parses the committed workflow into a structure', () => {
    expect(Object.keys(workflow)).toContain('jobs');
    expect(Object.keys(workflow).some((key) => key === 'on' || key === 'true')).toBe(
      true,
    );
  });

  it('throws on a workflow it cannot understand rather than returning nothing', () => {
    // A parser that degraded to `{}` would make every assertion below vacuous:
    // no triggers found, no jobs found, nothing to disagree with.
    expect(() => parseWorkflow('name: CI\nthis line is not a mapping\n')).toThrow();
    expect(() => parseWorkflow('jobs:\n  - first\n  not a sequence item\n')).toThrow();
  });
});

describe('F14.2 — which pushes trigger CI', () => {
  it('validates pushes to main', () => {
    expect(matchesBranch(branchPatterns('push'), 'main')).toBe(true);
  });

  it('validates a push to THIS hardening branch', () => {
    // The exact branch that received no CI at all before this change.
    expect(
      matchesBranch(branchPatterns('push'), 'feature/pre-phase-2-baseline-hardening'),
    ).toBe(true);
  });

  it.each([
    'feature/phase-1-database-foundation',
    'feature/phase-2-identity',
    'feature/some/deeply/nested/topic',
  ])('validates a push to the governed branch %s', (branch) => {
    expect(matchesBranch(branchPatterns('push'), branch)).toBe(true);
  });

  it.each(['fix/phase-2-maintenance-pre-phase-6', 'fix/security/hardening'])(
    'validates a push to the governed maintenance branch %s',
    (branch) => {
      expect(matchesBranch(branchPatterns('push'), branch)).toBe(true);
    },
  );

  it('keeps the governed namespaces exact and does not become a catch-all', () => {
    expect(branchPatterns('push')).toEqual(['main', 'feature/**', 'fix/**']);

    // Narrow namespaces are the decision, not an accident. `'**'` would spend
    // runner time on scratch branches and prove nothing extra.
    for (const branch of ['scratch', 'wip/experiment', 'dependabot/npm_and_yarn/x']) {
      expect(matchesBranch(branchPatterns('push'), branch), branch).toBe(false);
    }
  });
});

describe('F14.3 — which pull requests trigger CI', () => {
  it('validates pull requests targeting main', () => {
    expect(matchesBranch(branchPatterns('pull_request'), 'main')).toBe(true);
  });

  it('keeps the existing pull-request contract intact', () => {
    // PR #1 targets `main` and must keep receiving exactly the validation it
    // already had. Nothing about it needed to change to fix the push gap.
    expect(branchPatterns('pull_request')).toEqual(['main']);
  });

  it('uses `pull_request`, never `pull_request_target`', () => {
    // `pull_request_target` runs in the base repository's context WITH access
    // to secrets, against code from the fork. This workflow needs no secret, so
    // it has no reason to take that risk (SECURITY_BASELINE.md §18.1).
    expect(Object.keys(triggers())).not.toContain('pull_request_target');
    // Compared against the STRUCTURE, and against the file with comments
    // stripped — the workflow's own commentary explains why it does not use
    // the trigger, and a raw substring search would fail on that explanation.
    expect(withoutComments).not.toContain('pull_request_target');
  });
});

describe('F14.4 — cancellation preserves each validation context', () => {
  it('groups concurrency by event and full ref', () => {
    const concurrency = workflow['concurrency'] as Record<string, Node>;

    expect(typeof concurrency).toBe('object');
    expect(String(concurrency['group'])).toContain('github.event_name');
    expect(String(concurrency['group'])).toContain('github.ref');
  });

  it('never lets a push cancel a pull-request merge-ref run', () => {
    const group = String((workflow['concurrency'] as Record<string, Node>)['group']);

    const resolve = (eventName: string, ref: string) =>
      group
        .replaceAll('${{ github.workflow }}', 'CI')
        .replaceAll('${{ github.event_name }}', eventName)
        .replaceAll('${{ github.ref }}', ref);

    expect(resolve('push', 'refs/heads/feature/a')).not.toBe(
      resolve('pull_request', 'refs/pull/1/merge'),
    );
    expect(resolve('push', 'refs/heads/feature/a')).not.toBe(
      resolve('push', 'refs/heads/feature/b'),
    );
    // Pull requests from two forks can have the same `head_ref`; their PR refs
    // are nevertheless distinct, so neither contributor cancels the other.
    expect(resolve('pull_request', 'refs/pull/1/merge')).not.toBe(
      resolve('pull_request', 'refs/pull/2/merge'),
    );
  });

  it('still cancels superseded runs', () => {
    expect(
      String((workflow['concurrency'] as Record<string, Node>)['cancel-in-progress']),
    ).toBe('true');
  });
});

describe('F14.5 — permissions stay least-privileged', () => {
  it('grants read-only contents and nothing else', () => {
    expect(workflow['permissions']).toEqual({ contents: 'read' });
  });

  it('declares no repository secret anywhere', () => {
    // Ephemeral credentials are generated per run by the database job; nothing
    // reads a stored secret, so nothing can print one.
    expect(withoutComments).not.toMatch(/\$\{\{\s*secrets\./);
  });

  it('uses no `write` permission and no environment', () => {
    expect(withoutComments).not.toMatch(
      /^\s*(?:contents|packages|id-token|pull-requests):\s*write/m,
    );
    expect(withoutComments).not.toMatch(/^\s*environment:/m);
  });
});

describe('F14.6 — no path filter can let a source change bypass CI', () => {
  it('declares no `paths` or `paths-ignore` filter on any trigger', () => {
    for (const [name, node] of Object.entries(triggers())) {
      if (typeof node !== 'object' || Array.isArray(node)) continue;

      expect(Object.keys(node), `${name} must carry no path filter`).not.toContain(
        'paths',
      );
      expect(Object.keys(node), `${name} must carry no path filter`).not.toContain(
        'paths-ignore',
      );
    }
  });

  it('gates no job behind a conditional that could skip validation', () => {
    const jobs = workflow['jobs'] as Record<string, Record<string, Node>>;

    for (const [name, job] of Object.entries(jobs)) {
      expect(Object.keys(job), `${name} must run unconditionally`).not.toContain('if');
    }
  });
});

describe('F14.7 — every existing job is preserved', () => {
  const jobs = workflow['jobs'] as Record<string, Record<string, Node>>;

  it.each([
    ['verify', 'Verify'],
    ['container', 'Container image'],
    ['database', 'Database foundation'],
    ['browser', 'Browser flows'],
    ['audit', 'Dependency audit'],
  ])('still declares the %s job', (id, displayName) => {
    expect(Object.keys(jobs)).toContain(id);
    expect(jobs[id]!['name']).toBe(displayName);
  });

  it('declares no job beyond the accepted roster', () => {
    // Widening the triggers must not smuggle in a new job — a deployment or a
    // publish step — that now runs on every feature branch.
    //
    // `browser` joined the roster in Phase 2, where browser coverage is first
    // genuinely needed. It runs as its own job rather than inside `verify`
    // because the container image `verify` builds is deliberately browserless,
    // and adding Chromium to it would change what production contains.
    expect(Object.keys(jobs).sort()).toEqual([
      'audit',
      'browser',
      'container',
      'database',
      'verify',
    ]);
  });

  it('runs the browser suite against a PRODUCTION build, and requires it', () => {
    const steps = (jobs['browser']!['steps'] ?? []) as Record<string, Node>[];
    const names = steps.map((step) => String(step['name']));

    for (const required of [
      'Start SQL Server 2022 Developer',
      'Install Chromium',
      'Build',
      'Browser flows',
    ]) {
      expect(names, `the browser job must run '${required}'`).toContain(required);
    }

    // Nothing here is advisory. A job whose failure does not fail the run is a
    // job that stops being maintained.
    expect(Object.keys(jobs['browser']!)).not.toContain('continue-on-error');

    for (const step of steps) {
      expect(
        Object.keys(step),
        `${String(step['name'])} must not swallow its own failure`,
      ).not.toContain('continue-on-error');
    }
  });

  it('uploads browser artifacts only when the suite FAILED', () => {
    const steps = (jobs['browser']!['steps'] ?? []) as Record<string, Node>[];
    const upload = steps.find((step) => String(step['name']).includes('Upload'));

    expect(upload).toBeDefined();

    // A Playwright trace of an authentication flow contains session cookies,
    // so a passing run uploads nothing at all (SECURITY_BASELINE.md §19.2).
    expect(String(upload?.['if'])).toBe('failure()');
  });

  it('keeps the Verify job’s validation steps, including the new context gate', () => {
    const steps = (jobs['verify']!['steps'] ?? []) as Record<string, Node>[];
    const names = steps.map((step) => String(step['name']));

    for (const required of [
      'Verify locked stack versions',
      'Verify the Docker build-context secret policy',
      'Generate the Prisma client',
      'Check formatting',
      'Type check',
      'Lint',
      'Architecture validation',
      'RTL validation',
      'Tests',
      'Server-only boundary build proof',
      'Production build',
    ]) {
      expect(names, `${required} must remain in the Verify job`).toContain(required);
    }
  });

  it('keeps the container, database and audit jobs doing their real work', () => {
    const bodyOf = (id: string) =>
      ((jobs[id]!['steps'] ?? []) as Record<string, Node>[])
        .map((step) => `${String(step['name'])} ${String(step['run'] ?? '')}`)
        .join('\n');

    expect(bodyOf('container')).toContain('Build and run the test stage');
    expect(bodyOf('container')).toContain('Validate the compose stack');
    expect(bodyOf('database')).toContain('Recovery proof (real backup and restore)');
    // RETARGETED, not relaxed. The step used to be named for Phase 2 alone and
    // now covers Phase 3B as well, so the assertion names the COMMAND — which
    // is what actually runs the proof — plus the part of the label that says
    // what kind of proof it is. A future phase widening it again changes the
    // name and not this line; a future phase DELETING it still fails here.
    expect(bodyOf('database')).toContain('Populated recovery proof');
    expect(bodyOf('database')).toContain('npm run db:recovery:populated');
    expect(bodyOf('database')).toContain('Least-privilege permission proof');
    expect(bodyOf('audit')).toContain('npm audit --audit-level=high');
  });

  it('runs every job on the locked Node runtime', () => {
    expect(String((workflow['env'] as Record<string, Node>)['NODE_VERSION'])).toBe(
      '24.20.0',
    );
  });
});
