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

  /**
   * Phase 25. The run also owns a realtime process — which a spec may have
   * restarted from its own worker, beyond any process tree Playwright stops —
   * and an NGINX container. Both the server's own cleanup and the runner's
   * teardown stop them through the shared, positively identifying helpers (a
   * marked process, a generated container name), never a raw kill or a
   * wildcard removal, and before the database is dropped.
   */
  it('stops the realtime process and removes the proxy through the guarded helpers', async () => {
    const teardown = await readFile(
      path.join(repoRoot, 'tests', 'browser', 'global-teardown.ts'),
      'utf8',
    );
    const server = await readFile(
      path.join(repoRoot, 'scripts', 'browser-server.mjs'),
      'utf8',
    );

    for (const source of [teardown, server]) {
      expect(source).toContain('stopOwnRealtime');
      expect(source).toContain('removeFrontDoor');
      expect(source).toContain('recordedRealtimePid');
      expect(source).not.toMatch(/docker['",\s]+(?:rm|kill|stop)\b/);
    }
    expect(teardown.indexOf('await stopRunProcesses(')).toBeLessThan(
      teardown.indexOf('await dropDisposableDatabase('),
    );
    expect(server.indexOf('await removeFrontDoor(proxyContainer)')).toBeLessThan(
      server.indexOf('await dropDisposableDatabase('),
    );
  });
});
