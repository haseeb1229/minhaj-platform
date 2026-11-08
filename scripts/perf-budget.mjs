#!/usr/bin/env node
/**
 * The performance budget, measured against a DEPLOYED build.
 *
 *   npm run perf:budget -- --base-url https://staging.example.org \
 *     [--urls "/,/library/books,/news"] [--urls-file paths.txt] \
 *     [--netrc-file ~/.minhaj-staging.netrc] [--lcp-budget 2500] \
 *     [--cls-budget 0.1] [--runs 3]
 *
 * (Each flag has an environment twin: PERF_BASE_URL, PERF_URLS,
 * PERF_URLS_FILE, PERF_NETRC_FILE, PERF_LCP_BUDGET_MS, PERF_CLS_BUDGET,
 * PERF_RUNS.)
 *
 * Every run of every address is COLD: a new browser context (an empty cache
 * and no cookies), the cache disabled through CDP besides, Lighthouse's mobile
 * "Slow 4G" network and a four-times-slower CPU, on Lighthouse's emulated
 * phone. It records the Largest Contentful Paint, the Cumulative Layout Shift
 * and the bytes transferred, prints a table, and exits 1 when any address
 * misses its budget — judged on the median of its runs — and 2 when the run
 * itself could not be set up.
 *
 * WHY NOT IN CI. The number that matters is the deployed one — the production
 * build behind the real front door, its compression and its cache headers, on
 * the staging host — and a CI runner measuring a local server proves a
 * different thing. It is run by a person against staging (DELIVERY_PLAN.md,
 * the Rebaseline R2 record).
 *
 * CREDENTIALS. Staging sits behind the edge's Basic Auth. A credential is
 * accepted ONLY from a netrc file, is sent only to the base origin, and is
 * never printed: a credential in the base URL is refused, no response header
 * (a redirect's `Location` included) is ever printed, and every error message
 * passes through `redactCredentials` before it reaches the console.
 */

import { readFileSync } from 'node:fs';

import { chromium } from '@playwright/test';

import {
  cumulativeLayoutShift,
  DEFAULT_PATHS,
  evaluateBudget,
  formatTable,
  MOBILE_DEVICE,
  parseNetrc,
  parseOptions,
  parseUrlList,
  redactCredentials,
  resolveTarget,
  SLOW_4G,
} from './shared/perf-budget.mjs';

/** How long a page may take to load at all under throttling. */
const NAVIGATION_TIMEOUT_MS = 120_000;

/** How long the network must stay quiet after `load` before the page is read. */
const SETTLE_TIMEOUT_MS = 30_000;

/** How long layout shifts are still watched for once the network is quiet. */
const SHIFT_WATCH_MS = 3_000;

/**
 * Collects the page's own LCP and layout-shift entries as they happen.
 * Installed before any document script runs; `buffered` catches anything
 * reported before the observer was registered.
 */
function observePerformance() {
  const recorded = { lcp: null, shifts: [] };
  Object.defineProperty(globalThis, '__minhajPerf', { value: recorded });
  new globalThis.PerformanceObserver((list) => {
    for (const entry of list.getEntries())
      recorded.lcp = entry.renderTime || entry.loadTime || entry.startTime;
  }).observe({ type: 'largest-contentful-paint', buffered: true });
  new globalThis.PerformanceObserver((list) => {
    for (const entry of list.getEntries())
      recorded.shifts.push({
        startTime: entry.startTime,
        value: entry.value,
        hadRecentInput: entry.hadRecentInput,
      });
  }).observe({ type: 'layout-shift', buffered: true });
}

/** One cold, throttled load of `target`. */
async function measure(browser, origin, target, credential) {
  const context = await browser.newContext({
    ...MOBILE_DEVICE,
    ...(credential === null
      ? {}
      : { httpCredentials: { ...credential, origin, send: 'always' } }),
  });
  try {
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: SLOW_4G.latencyMs,
      downloadThroughput: SLOW_4G.downloadBytesPerSecond,
      uploadThroughput: SLOW_4G.uploadBytesPerSecond,
    });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: SLOW_4G.cpuSlowdown });

    let transferBytes = 0;
    let requests = 0;
    cdp.on('Network.loadingFinished', (event) => {
      transferBytes += event.encodedDataLength;
      requests += 1;
    });

    await page.addInitScript(observePerformance);
    const response = await page.goto(target, {
      waitUntil: 'load',
      timeout: NAVIGATION_TIMEOUT_MS,
    });
    await page
      .waitForLoadState('networkidle', { timeout: SETTLE_TIMEOUT_MS })
      .catch(() => {
        // A page that keeps a connection open never goes idle; what it painted
        // by now is what it painted.
      });
    // Hydration, late fonts and deferred islands can still move the layout
    // after the network falls quiet; a short watch afterwards counts them.
    await page.waitForTimeout(SHIFT_WATCH_MS);

    // LCP stops at the first input or when the page is hidden; reading it here,
    // before either, takes the final candidate.
    const recorded = await page.evaluate(() => globalThis.__minhajPerf);

    return {
      status: response?.status() ?? 0,
      lcpMs: recorded.lcp,
      cls: cumulativeLayoutShift(recorded.shifts),
      transferBytes,
      requests,
    };
  } finally {
    await context.close();
  }
}

async function main() {
  const options = parseOptions(process.argv.slice(2), process.env);

  const listText =
    options.urls ??
    (options.urlsFile === null ? null : readFileSync(options.urlsFile, 'utf8'));
  const paths = listText === null ? [...DEFAULT_PATHS] : parseUrlList(listText);
  const targets = paths.map((path) => ({
    path,
    href: resolveTarget(options.baseUrl, path),
  }));

  let credential = null;
  if (options.netrcFile !== null) {
    credential = parseNetrc(
      readFileSync(options.netrcFile, 'utf8'),
      new URL(options.baseUrl).hostname,
    );
    if (credential === null)
      throw new Error('The netrc file holds no login and password for the base host.');
  }

  console.log(
    `Measuring ${targets.length} address(es) × ${options.runs} cold run(s) on ${options.baseUrl}` +
      ` — Slow 4G, CPU ×${SLOW_4G.cpuSlowdown}; budget LCP ≤ ${options.budget.lcpMs} ms, CLS ≤ ${options.budget.cls}` +
      (credential === null ? '' : '; Basic Auth from the netrc file'),
  );

  const browser = await chromium.launch();
  const verdicts = [];
  try {
    for (const { path, href } of targets) {
      const runs = [];
      for (let run = 0; run < options.runs; run += 1) {
        try {
          runs.push(await measure(browser, options.baseUrl, href, credential));
        } catch (error) {
          // A load that never completes is a missed budget for THIS address,
          // not a reason to abandon the others.
          const message = error instanceof Error ? error.message : String(error);
          console.error(`${path}: ${redactCredentials(message.split('\n')[0])}`);
          runs.push({ status: 0, lcpMs: null, cls: 0, transferBytes: 0, requests: 0 });
        }
      }
      verdicts.push(evaluateBudget(path, runs, options.budget));
    }
  } finally {
    await browser.close();
  }

  console.log(formatTable(verdicts));
  const failed = verdicts.filter((verdict) => !verdict.pass).length;
  console.log(
    failed === 0
      ? 'Every address is within budget.'
      : `${failed} of ${verdicts.length} address(es) missed the budget.`,
  );
  return failed === 0 ? 0 : 1;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `perf:budget could not run: ${redactCredentials(message.split('\n')[0])}`,
    );
    process.exitCode = 2;
  },
);
