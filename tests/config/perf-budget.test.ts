import { describe, expect, it } from 'vitest';

// @ts-expect-error — the budget tool is plain ESM, deliberately not part of a
// TypeScript project. The test consumes it exactly as the CLI does.
import * as budget from '../../scripts/shared/perf-budget.mjs';

/**
 * The performance budget's decisions (Rebaseline R2; `scripts/perf-budget.mjs`).
 *
 * The CLI only drives Chromium against a deployed build; everything that
 * decides — which addresses, which origin, which credential, how a trace
 * becomes CLS, and the verdict — is proved here on synthetic values, with no
 * browser and no network.
 */

interface Run {
  status: number;
  lcpMs: number | null;
  cls: number;
  transferBytes: number;
  requests: number;
}

interface Verdict {
  path: string;
  status: string;
  lcpMs: number | null;
  cls: number;
  transferBytes: number;
  requests: number;
  runs: number;
  pass: boolean;
  reasons: string[];
}

const {
  cumulativeLayoutShift,
  DEFAULT_BUDGET,
  evaluateBudget,
  formatTable,
  median,
  parseBaseUrl,
  parseNetrc,
  parseOptions,
  parseUrlList,
  redactCredentials,
  resolveTarget,
  SLOW_4G,
} = budget as {
  cumulativeLayoutShift: (
    entries: { startTime: number; value: number; hadRecentInput?: boolean }[],
  ) => number;
  DEFAULT_BUDGET: { lcpMs: number; cls: number };
  evaluateBudget: (
    path: string,
    runs: Run[],
    limits?: { lcpMs: number; cls: number },
  ) => Verdict;
  formatTable: (verdicts: Verdict[]) => string;
  median: (values: number[]) => number;
  parseBaseUrl: (raw: unknown) => string;
  parseNetrc: (
    text: string,
    host: string,
  ) => { username: string; password: string } | null;
  parseOptions: (
    argv: string[],
    env?: Record<string, string | undefined>,
  ) => {
    baseUrl: string;
    urls: string | null;
    urlsFile: string | null;
    netrcFile: string | null;
    budget: { lcpMs: number; cls: number };
    runs: number;
  };
  parseUrlList: (text: string) => string[];
  redactCredentials: (text: string) => string;
  resolveTarget: (origin: string, path: string) => string;
  SLOW_4G: {
    latencyMs: number;
    downloadBytesPerSecond: number;
    uploadBytesPerSecond: number;
    cpuSlowdown: number;
  };
};

const ORIGIN = 'https://staging.example.test';
const good: Run = {
  status: 200,
  lcpMs: 1800,
  cls: 0.02,
  transferBytes: 400_000,
  requests: 30,
};

describe('the budget and the throttling profile', () => {
  it('defaults to the Core Web Vitals "good" thresholds', () => {
    expect(DEFAULT_BUDGET).toEqual({ lcpMs: 2500, cls: 0.1 });
  });

  it('throttles to Lighthouse mobile Slow 4G with a 4x CPU, in CDP units', () => {
    expect(SLOW_4G.latencyMs).toBe(562.5);
    expect(SLOW_4G.downloadBytesPerSecond).toBeCloseTo(188_743.68, 2);
    expect(SLOW_4G.uploadBytesPerSecond).toBe(86_400);
    expect(SLOW_4G.cpuSlowdown).toBe(4);
  });
});

describe('the base URL', () => {
  it('accepts a bare http(s) origin', () => {
    expect(parseBaseUrl('https://staging.example.test')).toBe(ORIGIN);
    expect(parseBaseUrl(' https://staging.example.test/ ')).toBe(ORIGIN);
    expect(parseBaseUrl('http://127.0.0.1:3100')).toBe('http://127.0.0.1:3100');
  });

  it.each([
    ['', /required/],
    [undefined, /required/],
    ['staging.example.test', /valid absolute URL/],
    ['ftp://staging.example.test', /http or https/],
    ['javascript:alert(1)', /http or https/],
    ['https://user:secret@staging.example.test', /must not carry a credential/],
    ['https://user@staging.example.test', /must not carry a credential/],
    ['https://staging.example.test/library', /origin only/],
    ['https://staging.example.test/?x=1', /origin only/],
  ])('refuses %j', (raw, message) => {
    expect(() => parseBaseUrl(raw)).toThrow(message);
  });

  it('never echoes the credential it refused', () => {
    expect(() =>
      parseBaseUrl('https://user:sentinel-secret-0001@staging.example.test'),
    ).toThrow(
      expect.objectContaining({
        message: expect.not.stringContaining('sentinel-secret-0001'),
      }),
    );
  });
});

describe('the address list', () => {
  it('reads comma- and newline-separated paths, skipping blanks and comments, once each', () => {
    expect(
      parseUrlList(
        '/, /library/books\n# a comment\n\n/news?sort=latest,/ur/news\r\n/library/books',
      ),
    ).toEqual(['/', '/library/books', '/news?sort=latest', '/ur/news']);
  });

  it.each([
    'https://elsewhere.example/',
    '//elsewhere.example/',
    'library',
    '/two words',
  ])('refuses %j, which is not a path on the base origin', (entry) => {
    expect(() => parseUrlList(entry)).toThrow();
  });

  it('refuses an empty list rather than passing vacuously', () => {
    expect(() => parseUrlList('')).toThrow(/empty/);
    expect(() => parseUrlList(' , \n# only a comment')).toThrow(/empty/);
  });

  it('resolves paths on the origin and refuses one that would leave it', () => {
    expect(resolveTarget(ORIGIN, '/ur/library?sort=title')).toBe(
      `${ORIGIN}/ur/library?sort=title`,
    );
    expect(() => resolveTarget(ORIGIN, '//elsewhere.example/x')).toThrow(
      /leaves the base origin/,
    );
  });
});

describe('the netrc credential', () => {
  const NETRC = [
    'machine other.example.test login someone password not-this-one',
    'machine staging.example.test',
    '  login reviewer',
    '  password sentinel-password-0001',
    'default login fallback password sentinel-default-0002',
  ].join('\n');

  it('takes the entry for the host, ahead of the default', () => {
    expect(parseNetrc(NETRC, 'staging.example.test')).toEqual({
      username: 'reviewer',
      password: 'sentinel-password-0001',
    });
  });

  it('falls back to the default entry, and to null when there is none', () => {
    expect(parseNetrc(NETRC, 'unknown.example.test')).toEqual({
      username: 'fallback',
      password: 'sentinel-default-0002',
    });
    expect(parseNetrc('machine a.test login x password y', 'b.test')).toBeNull();
  });

  it('ignores an incomplete entry and skips account values', () => {
    expect(parseNetrc('machine a.test login only', 'a.test')).toBeNull();
    expect(
      parseNetrc('machine a.test account acct login u password p', 'a.test'),
    ).toEqual({
      username: 'u',
      password: 'p',
    });
  });

  it('reads nothing after a macro definition', () => {
    expect(
      parseNetrc('macdef init\nmachine a.test login u password p', 'a.test'),
    ).toBeNull();
  });
});

describe('Cumulative Layout Shift', () => {
  it('is zero with no shifts', () => {
    expect(cumulativeLayoutShift([])).toBe(0);
  });

  it('excludes shifts that followed input', () => {
    expect(
      cumulativeLayoutShift([
        { startTime: 100, value: 0.3, hadRecentInput: true },
        { startTime: 200, value: 0.01, hadRecentInput: false },
      ]),
    ).toBeCloseTo(0.01);
  });

  it('takes the largest session window, not the sum of the whole page', () => {
    const score = cumulativeLayoutShift([
      { startTime: 100, value: 0.05 },
      { startTime: 600, value: 0.04 },
      // A gap of more than a second opens a new window.
      { startTime: 3000, value: 0.02 },
      { startTime: 3500, value: 0.02 },
    ]);
    expect(score).toBeCloseTo(0.09);
  });

  it('closes a window after five seconds even without a gap', () => {
    const shifts = Array.from({ length: 12 }, (_, index) => ({
      startTime: index * 900,
      value: 0.01,
    }));
    // 0, 900, …, 4500 fit in the first window (six shifts); 5400 starts another.
    expect(cumulativeLayoutShift(shifts)).toBeCloseTo(0.06);
  });

  it('orders entries by time before windowing', () => {
    expect(
      cumulativeLayoutShift([
        { startTime: 600, value: 0.04 },
        { startTime: 100, value: 0.05 },
      ]),
    ).toBeCloseTo(0.09);
  });
});

describe('the verdict', () => {
  it('takes the median of odd and even run counts', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(() => median([])).toThrow();
  });

  it('passes an address within budget', () => {
    const verdict = evaluateBudget('/', [good]);
    expect(verdict).toEqual(
      expect.objectContaining({
        path: '/',
        pass: true,
        reasons: [],
        lcpMs: 1800,
        runs: 1,
      }),
    );
  });

  it('passes at exactly the budget and fails just above it', () => {
    expect(evaluateBudget('/', [{ ...good, lcpMs: 2500, cls: 0.1 }]).pass).toBe(true);
    const over = evaluateBudget('/', [{ ...good, lcpMs: 2501, cls: 0.1001 }]);
    expect(over.pass).toBe(false);
    expect(over.reasons).toEqual([
      'LCP 2501 ms exceeds 2500 ms',
      'CLS 0.100 exceeds 0.1',
    ]);
  });

  it('judges the median, so one slow run alone neither fails nor passes an address', () => {
    const runs = [
      { ...good, lcpMs: 1900 },
      { ...good, lcpMs: 9000 },
      { ...good, lcpMs: 2100 },
    ];
    expect(evaluateBudget('/news', runs)).toEqual(
      expect.objectContaining({ pass: true, lcpMs: 2100, runs: 3 }),
    );
    const mostlySlow = [
      { ...good, lcpMs: 1000 },
      { ...good, lcpMs: 2600 },
      { ...good, lcpMs: 2700 },
    ];
    expect(evaluateBudget('/news', mostlySlow).pass).toBe(false);
  });

  it('honours a custom budget', () => {
    expect(evaluateBudget('/', [good], { lcpMs: 1500, cls: 0.1 }).pass).toBe(false);
  });

  it('fails closed on a document that was not a 200, even when it painted fast', () => {
    const verdict = evaluateBudget('/', [{ ...good, status: 401, lcpMs: 200 }]);
    expect(verdict.pass).toBe(false);
    expect(verdict.reasons).toContain('document status 401, not 200');
  });

  it('fails closed when no LCP was reported, rather than passing for want of a number', () => {
    const verdict = evaluateBudget('/', [good, { ...good, lcpMs: null }]);
    expect(verdict.pass).toBe(false);
    expect(verdict.lcpMs).toBeNull();
    expect(verdict.reasons).toContain('no Largest Contentful Paint was reported');
  });

  it('fails a page that did not load', () => {
    const verdict = evaluateBudget('/', [
      { status: 0, lcpMs: null, cls: 0, transferBytes: 0, requests: 0 },
    ]);
    expect(verdict.pass).toBe(false);
    expect(verdict.reasons).toContain('the page did not load');
  });

  it('refuses an address with no runs', () => {
    expect(() => evaluateBudget('/', [])).toThrow(/No runs/);
  });

  it('prints a table with one row per address and the reason for a failure', () => {
    const table = formatTable([
      evaluateBudget('/', [good]),
      evaluateBudget('/library/books', [{ ...good, lcpMs: 3100, transferBytes: 2048 }]),
    ]);
    const lines = table.split('\n');
    expect(lines).toHaveLength(4);
    expect(lines[0]).toMatch(/^Path\s+Status\s+LCP ms\s+CLS\s+KB\s+Requests\s+Verdict$/);
    expect(lines[2]).toMatch(/^\/\s+200\s+1800\s+0\.020\s+390\.6\s+30\s+pass$/);
    expect(lines[3]).toMatch(/FAIL: LCP 3100 ms exceeds 2500 ms$/);
    expect(lines[3]).toMatch(/\s2\.0\s/);
  });
});

describe('the options', () => {
  it('reads flags, in both spellings, ahead of the environment', () => {
    const options = parseOptions(
      ['--base-url', ORIGIN, '--urls=/,/news', '--runs', '3', '--lcp-budget', '2000'],
      { PERF_BASE_URL: 'https://ignored.example.test', PERF_CLS_BUDGET: '0.05' },
    );
    expect(options).toEqual({
      baseUrl: ORIGIN,
      urls: '/,/news',
      urlsFile: null,
      netrcFile: null,
      budget: { lcpMs: 2000, cls: 0.05 },
      runs: 3,
    });
  });

  it('falls back to the environment and the defaults', () => {
    expect(
      parseOptions([], { PERF_BASE_URL: ORIGIN, PERF_NETRC_FILE: '/home/me/.netrc' }),
    ).toEqual(
      expect.objectContaining({
        baseUrl: ORIGIN,
        netrcFile: '/home/me/.netrc',
        budget: DEFAULT_BUDGET,
        runs: 1,
      }),
    );
  });

  it.each([
    [['--base-url', ORIGIN, '--runs', '0'], /--runs/],
    [['--base-url', ORIGIN, '--runs', '1.5'], /--runs/],
    [['--base-url', ORIGIN, '--runs', '11'], /at most 10/],
    [['--base-url', ORIGIN, '--lcp-budget', 'fast'], /--lcp-budget/],
    [['--base-url', ORIGIN, '--cls-budget', '-1'], /--cls-budget/],
    [['--base-url', ORIGIN, '--verbose', 'yes'], /Unknown option/],
    [['--base-url'], /needs a value/],
    [[ORIGIN], /Unexpected argument/],
    [[], /base URL is required/],
  ])('refuses %j', (argv, message) => {
    expect(() => parseOptions(argv, {})).toThrow(message);
  });
});

describe('printing', () => {
  it('redacts a credential from any address in a message', () => {
    expect(
      redactCredentials(
        'net::ERR_FAILED at https://reviewer:sentinel-password-0001@staging.example.test/x',
      ),
    ).toBe('net::ERR_FAILED at https://[redacted]@staging.example.test/x');
  });

  it('leaves a message without a credential untouched', () => {
    expect(
      redactCredentials('Timeout 120000ms exceeded at https://staging.example.test/'),
    ).toBe('Timeout 120000ms exceeded at https://staging.example.test/');
  });
});
