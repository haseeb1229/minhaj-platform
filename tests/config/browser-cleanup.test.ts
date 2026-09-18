import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { repoRoot } from '../architecture/architecture-harness.ts';

describe('the browser harness owns conclusive disposable-database cleanup', () => {
  it('registers runner-level teardown as well as server signal cleanup', async () => {
    const config = await readFile(path.join(repoRoot, 'playwright.config.ts'), 'utf8');
    const server = await readFile(
      path.join(repoRoot, 'scripts', 'browser-server.mjs'),
      'utf8',
    );

    expect(config).toContain("globalTeardown: './tests/browser/global-teardown.ts'");
    expect(server).toContain("process.on('SIGTERM'");
    expect(server).toContain("process.on('SIGINT'");
  });

  it('uses the shared positive-name guard and performs no raw drop', async () => {
    const teardown = await readFile(
      path.join(repoRoot, 'tests', 'browser', 'global-teardown.ts'),
      'utf8',
    );

    expect(teardown).toContain('dropDisposableDatabase');
    expect(teardown).toContain('assertApprovedLocalTarget');
    expect(teardown).not.toMatch(/DROP\s+DATABASE/i);
  });
});
