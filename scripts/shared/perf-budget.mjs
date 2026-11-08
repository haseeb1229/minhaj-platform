/**
 * The pure half of the performance budget (`scripts/perf-budget.mjs`).
 *
 * Everything that decides something — which addresses are measured, against
 * which origin, with which credential, how a layout-shift trace becomes a CLS
 * score, and whether a measurement passes — lives here as plain functions over
 * plain values, so `tests/config/perf-budget.test.ts` proves it without a
 * browser, a network or a deployment. The CLI only drives Chromium and feeds
 * these functions what it observed.
 *
 * Rebaseline R2 budget (R2 plan §6; DELIVERY_PLAN.md, the R2 record): a cold
 * load on a throttled phone reaches its Largest Contentful Paint within
 * 2.5 seconds and shifts its layout by no more than 0.1 — the "good"
 * thresholds of Core Web Vitals.
 */

/** The default budget: Core Web Vitals' "good" thresholds. */
export const DEFAULT_BUDGET = Object.freeze({ lcpMs: 2500, cls: 0.1 });

/**
 * The network and CPU a measurement runs under: Lighthouse's mobile "Slow 4G"
 * as Chrome DevTools applies it — 150 ms RTT and 1.6 Mbps down / 750 kbps up,
 * adjusted by Lighthouse's own DevTools multipliers (latency × 3.75,
 * download × 0.9) — on a CPU slowed four times. CDP takes throughput in BYTES
 * per second and latency in milliseconds.
 */
export const SLOW_4G = Object.freeze({
  latencyMs: 562.5,
  downloadBytesPerSecond: (1474.56 * 1024) / 8,
  uploadBytesPerSecond: (675 * 1024) / 8,
  cpuSlowdown: 4,
});

/** The emulated phone: Lighthouse's mobile device (Moto G Power). */
export const MOBILE_DEVICE = Object.freeze({
  viewport: { width: 412, height: 823 },
  deviceScaleFactor: 1.75,
  isMobile: true,
  hasTouch: true,
});

/** The addresses measured when none are named: home, a list and a landing. */
export const DEFAULT_PATHS = Object.freeze(['/', '/library/books', '/news', '/watch']);

/**
 * The base address, refused unless it is a bare http(s) origin.
 *
 * A credential in the URL is refused outright rather than stripped: it would be
 * echoed by error messages and history, and the supported way to supply one is
 * a netrc file that is read and never printed.
 */
export function parseBaseUrl(raw) {
  if (typeof raw !== 'string' || raw.trim() === '')
    throw new Error('A base URL is required (--base-url or PERF_BASE_URL).');
  let url;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error('The base URL is not a valid absolute URL.');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:')
    throw new Error('The base URL must use http or https.');
  if (url.username !== '' || url.password !== '')
    throw new Error(
      'The base URL must not carry a credential; supply one with --netrc-file instead.',
    );
  if (
    (url.pathname !== '/' && url.pathname !== '') ||
    url.search !== '' ||
    url.hash !== ''
  )
    throw new Error(
      'The base URL must be an origin only, with no path, query or fragment.',
    );
  return url.origin;
}

/**
 * The addresses to measure, from a comma- or newline-separated list.
 *
 * Each entry is a PATH on the base origin (`/`, `/library`, `/ur/news?x=1`);
 * an absolute URL is refused, so a list can never point the credential at a
 * different host. Blank entries and `#` comment lines are ignored, duplicates
 * collapse, and an empty result is an error rather than a vacuous pass.
 */
export function parseUrlList(text) {
  const entries = String(text ?? '')
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '' && !entry.startsWith('#'));

  const paths = [];
  for (const entry of entries) {
    if (!entry.startsWith('/') || entry.startsWith('//'))
      throw new Error(`Not a path on the base origin: ${JSON.stringify(entry)}`);
    if (/\s/.test(entry))
      throw new Error(`A path may not contain whitespace: ${JSON.stringify(entry)}`);
    if (!paths.includes(entry)) paths.push(entry);
  }
  if (paths.length === 0) throw new Error('The address list is empty.');
  return paths;
}

/** The absolute address of `path` on `origin`, refused if it would leave it. */
export function resolveTarget(origin, path) {
  const target = new URL(path, origin);
  if (target.origin !== origin)
    throw new Error(`${JSON.stringify(path)} leaves the base origin.`);
  return target.href;
}

/**
 * The login and password a netrc file holds for `host`, or null.
 *
 * The subset curl and the staging probes use: `machine <host> login <user>
 * password <secret>` entries and an optional `default` entry, tokens separated
 * by any whitespace; `account` and `macdef` are skipped. A named machine wins
 * over `default`. The values are returned to the caller and never logged here.
 */
export function parseNetrc(text, host) {
  const tokens = String(text ?? '')
    .split(/\s+/)
    .filter((token) => token !== '');

  const entries = [];
  let current = null;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === 'machine') {
      current = { machine: tokens[index + 1] ?? '', login: null, password: null };
      entries.push(current);
      index += 1;
    } else if (token === 'default') {
      current = { machine: null, login: null, password: null };
      entries.push(current);
    } else if (token === 'macdef') {
      // A macro runs to the end of the file in this subset; nothing after it is read.
      break;
    } else if (current !== null && (token === 'login' || token === 'password')) {
      current[token] = tokens[index + 1] ?? null;
      index += 1;
    } else if (token === 'account') {
      index += 1;
    }
  }

  const complete = (entry) => entry.login !== null && entry.password !== null;
  const named = entries.find((entry) => entry.machine === host && complete(entry));
  const fallback = entries.find((entry) => entry.machine === null && complete(entry));
  const chosen = named ?? fallback;
  return chosen === undefined
    ? null
    : { username: chosen.login, password: chosen.password };
}

/**
 * Cumulative Layout Shift from `layout-shift` entries, as Core Web Vitals
 * defines it: shifts caused by recent input are excluded, the rest are grouped
 * into session windows (a gap under 1 s, a window at most 5 s long), and the
 * score is the largest window's sum.
 */
export function cumulativeLayoutShift(entries) {
  let largest = 0;
  let windowSum = 0;
  let windowStart = -Infinity;
  let previous = -Infinity;

  const shifts = [...entries]
    .filter((entry) => entry.hadRecentInput !== true)
    .sort((a, b) => a.startTime - b.startTime);

  for (const { startTime, value } of shifts) {
    if (startTime - previous < 1000 && startTime - windowStart < 5000) {
      windowSum += value;
    } else {
      windowSum = value;
      windowStart = startTime;
    }
    previous = startTime;
    largest = Math.max(largest, windowSum);
  }
  return largest;
}

/** The median of a non-empty list of numbers. */
export function median(values) {
  if (values.length === 0) throw new Error('No values to take a median of.');
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * The verdict for one address from its runs.
 *
 * Each run is `{ status, lcpMs, cls, transferBytes, requests }`, where `lcpMs`
 * is null when the page reported no Largest Contentful Paint. The address is
 * judged on the MEDIAN of its runs, so one noisy run neither passes nor fails
 * it alone. It fails closed: a non-200 document, or a run with no LCP, is a
 * failure with its reason, never a pass for want of a number.
 */
export function evaluateBudget(path, runs, budget = DEFAULT_BUDGET) {
  if (runs.length === 0) throw new Error(`No runs were recorded for ${path}.`);

  const reasons = [];
  const statuses = [...new Set(runs.map((run) => run.status))];
  if (statuses.includes(0)) reasons.push('the page did not load');
  if (statuses.some((status) => status !== 200 && status !== 0))
    reasons.push(`document status ${statuses.join('/')}, not 200`);

  const missingLcp = runs.some((run) => run.lcpMs === null);
  if (missingLcp) reasons.push('no Largest Contentful Paint was reported');

  const lcpMs = missingLcp ? null : median(runs.map((run) => run.lcpMs));
  const cls = median(runs.map((run) => run.cls));
  const transferBytes = median(runs.map((run) => run.transferBytes));
  const requests = median(runs.map((run) => run.requests));

  if (lcpMs !== null && lcpMs > budget.lcpMs)
    reasons.push(`LCP ${Math.round(lcpMs)} ms exceeds ${budget.lcpMs} ms`);
  if (cls > budget.cls) reasons.push(`CLS ${cls.toFixed(3)} exceeds ${budget.cls}`);

  return {
    path,
    status: statuses.join('/'),
    lcpMs,
    cls,
    transferBytes,
    requests,
    runs: runs.length,
    pass: reasons.length === 0,
    reasons,
  };
}

/** The verdicts as a fixed-width table, one row per address. */
export function formatTable(verdicts) {
  const header = ['Path', 'Status', 'LCP ms', 'CLS', 'KB', 'Requests', 'Verdict'];
  const rows = verdicts.map((verdict) => [
    verdict.path,
    verdict.status,
    verdict.lcpMs === null ? '—' : String(Math.round(verdict.lcpMs)),
    verdict.cls.toFixed(3),
    (verdict.transferBytes / 1024).toFixed(1),
    String(Math.round(verdict.requests)),
    verdict.pass ? 'pass' : `FAIL: ${verdict.reasons.join('; ')}`,
  ]);
  const widths = header.map((title, column) =>
    Math.max(title.length, ...rows.map((row) => row[column].length)),
  );
  const line = (cells) =>
    cells
      .map((cell, column) => cell.padEnd(widths[column]))
      .join('  ')
      .trimEnd();
  return [
    line(header),
    line(widths.map((width) => '-'.repeat(width))),
    ...rows.map(line),
  ].join('\n');
}

/**
 * The run's options from its arguments and environment.
 *
 * Flags win over environment variables. Numbers are validated rather than
 * coerced, so a typo cannot silently become a budget of `NaN` that every page
 * passes.
 */
export function parseOptions(argv, env = {}) {
  const flags = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith('--')) throw new Error(`Unexpected argument: ${argument}`);
    const equals = argument.indexOf('=');
    if (equals !== -1) {
      flags.set(argument.slice(2, equals), argument.slice(equals + 1));
    } else {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--'))
        throw new Error(`${argument} needs a value.`);
      flags.set(argument.slice(2), value);
      index += 1;
    }
  }

  const known = [
    'base-url',
    'urls',
    'urls-file',
    'netrc-file',
    'lcp-budget',
    'cls-budget',
    'runs',
  ];
  for (const name of flags.keys())
    if (!known.includes(name)) throw new Error(`Unknown option --${name}.`);

  const pick = (flag, variable) => flags.get(flag) ?? env[variable];

  const positive = (raw, name, fallback, integer) => {
    if (raw === undefined || raw === '') return fallback;
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0 || (integer && !Number.isInteger(value)))
      throw new Error(`${name} must be a positive ${integer ? 'integer' : 'number'}.`);
    return value;
  };

  const runs = positive(pick('runs', 'PERF_RUNS'), '--runs', 1, true);
  if (runs > 10) throw new Error('--runs must be at most 10.');

  return {
    baseUrl: parseBaseUrl(pick('base-url', 'PERF_BASE_URL')),
    urls: pick('urls', 'PERF_URLS') ?? null,
    urlsFile: pick('urls-file', 'PERF_URLS_FILE') ?? null,
    netrcFile: pick('netrc-file', 'PERF_NETRC_FILE') ?? null,
    budget: {
      lcpMs: positive(
        pick('lcp-budget', 'PERF_LCP_BUDGET_MS'),
        '--lcp-budget',
        DEFAULT_BUDGET.lcpMs,
        false,
      ),
      cls: positive(
        pick('cls-budget', 'PERF_CLS_BUDGET'),
        '--cls-budget',
        DEFAULT_BUDGET.cls,
        false,
      ),
    },
    runs,
  };
}

/**
 * Removes any `user:password@` from text before it is printed, so an error
 * message that echoes an address can never carry a credential to the console.
 */
export function redactCredentials(text) {
  return String(text).replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^/\s@]*@/gi, '$1[redacted]@');
}
