import { describe, expect, it } from 'vitest';

import type { FetchOutcome, MigrationFetchPort } from '@minhaj/contracts/migration';

import {
  ROBOTS_PRODUCT_TOKEN,
  parseRobots,
  readRobots,
} from '../../../scripts/migration/robots.ts';

/**
 * robots.txt FOR AN AUTHORISED SOURCE (MIGRATION_STRATEGY.md §4.1, RFC 9309).
 *
 * Our product token's group, else `*`; the longest matching rule wins and
 * Allow wins a tie; `*` and `$` patterns; a missing file allows everything
 * and any other failure to read it disallows everything. No network: every
 * read goes through a scripted fetcher.
 */

const ORIGIN = 'https://www.example.org';
const at = (path: string) => `${ORIGIN}${path}`;

describe('parseRobots: group selection', () => {
  it('applies our product token’s group over *', () => {
    const policy = parseRobots(
      [
        'User-agent: *',
        'Disallow: /',
        '',
        'User-agent: OneMinhajMigration',
        'Disallow: /private/',
      ].join('\n'),
    );
    expect(policy.allows(at('/news/1'))).toBe(true);
    expect(policy.allows(at('/private/x'))).toBe(false);
  });

  it('matches our token case-insensitively, inside a group of several agents', () => {
    const policy = parseRobots(
      [
        'User-agent: Googlebot',
        'User-agent: ONEMINHAJMIGRATION',
        'Disallow: /x',
        '',
        'User-agent: *',
        'Disallow: /',
      ].join('\r\n'),
    );
    expect(ROBOTS_PRODUCT_TOKEN).toBe('oneminhajmigration');
    expect(policy.allows(at('/x/1'))).toBe(false);
    expect(policy.allows(at('/y'))).toBe(true);
  });

  it('falls back to * when no group names us, and ignores other agents’ groups', () => {
    const policy = parseRobots(
      [
        'User-agent: Googlebot',
        'Disallow: /',
        '',
        'User-agent: *',
        'Disallow: /admin',
      ].join('\n'),
    );
    expect(policy.allows(at('/'))).toBe(true);
    expect(policy.allows(at('/admin/users'))).toBe(false);
    // Only another agent's group: everything is allowed for us.
    expect(parseRobots('User-agent: Googlebot\nDisallow: /').allows(at('/a'))).toBe(true);
  });

  it('merges every group that names us', () => {
    const policy = parseRobots(
      [
        'User-agent: oneminhajmigration',
        'Disallow: /a',
        'User-agent: *',
        'Disallow: /',
        'User-agent: oneminhajmigration',
        'Disallow: /b',
      ].join('\n'),
    );
    expect(policy.allows(at('/a'))).toBe(false);
    expect(policy.allows(at('/b'))).toBe(false);
    expect(policy.allows(at('/c'))).toBe(true);
  });

  it('ignores comments, unknown fields and rules before any group', () => {
    const policy = parseRobots(
      [
        'Disallow: /orphan',
        '# a comment',
        'Sitemap: https://www.example.org/sitemap.xml',
        'User-agent: * # everyone',
        'Crawl-delay: 10',
        'Disallow: /tmp # temporary',
      ].join('\n'),
    );
    expect(policy.allows(at('/orphan'))).toBe(true);
    expect(policy.allows(at('/tmp/x'))).toBe(false);
  });
});

describe('parseRobots: rule matching', () => {
  it('lets the longest matching rule win', () => {
    const policy = parseRobots(
      'User-agent: *\nDisallow: /a\nAllow: /a/b\nDisallow: /a/b/c',
    );
    expect(policy.allows(at('/a/x'))).toBe(false);
    expect(policy.allows(at('/a/b/x'))).toBe(true);
    expect(policy.allows(at('/a/b/c/d'))).toBe(false);
    expect(policy.allows(at('/b'))).toBe(true);
  });

  it('lets Allow win a tie, whatever the order', () => {
    for (const text of [
      'User-agent: *\nDisallow: /page\nAllow: /page',
      'User-agent: *\nAllow: /page\nDisallow: /page',
    ])
      expect(parseRobots(text).allows(at('/page'))).toBe(true);
  });

  it('honours * wildcards and the $ end anchor', () => {
    const policy = parseRobots(
      'User-agent: *\nDisallow: /*.pdf$\nDisallow: /*/print/\nAllow: /docs/*.pdf$',
    );
    expect(policy.allows(at('/files/a.pdf'))).toBe(false);
    expect(policy.allows(at('/files/a.pdf?download=1'))).toBe(true);
    expect(policy.allows(at('/files/a.pdfx'))).toBe(true);
    expect(policy.allows(at('/docs/a.pdf'))).toBe(true);
    expect(policy.allows(at('/news/print/1'))).toBe(false);
    expect(policy.allows(at('/print/1'))).toBe(true);
  });

  it('matches the query as part of the path', () => {
    const policy = parseRobots('User-agent: *\nDisallow: /search\nDisallow: /*?sort=');
    expect(policy.allows(at('/search?q=1'))).toBe(false);
    expect(policy.allows(at('/list?sort=asc'))).toBe(false);
    expect(policy.allows(at('/list?page=2'))).toBe(true);
  });

  it('treats other pattern characters literally', () => {
    const policy = parseRobots('User-agent: *\nDisallow: /a+b.(c)');
    expect(policy.allows(at('/a+b.(c)/x'))).toBe(false);
    expect(policy.allows(at('/aab.(c)'))).toBe(true);
    expect(policy.allows(at('/a+bx(c)'))).toBe(true);
  });

  it('reads an empty Disallow as allowing everything', () => {
    expect(parseRobots('User-agent: *\nDisallow:').allows(at('/anything'))).toBe(true);
    expect(parseRobots('User-agent: *\nDisallow:\nDisallow: /x').allows(at('/x'))).toBe(
      false,
    );
  });

  it('allows everything for an empty file, and nothing for an unreadable URL', () => {
    const policy = parseRobots('');
    expect(policy.allows(at('/'))).toBe(true);
    const strict = parseRobots('User-agent: *\nDisallow: /x');
    expect(strict.allows('not a url')).toBe(false);
  });
});

/* ===========================================================================
 * readRobots
 * ========================================================================= */

function fetcherAnswering(outcome: (url: string) => FetchOutcome) {
  const requests: string[] = [];
  const fetcher: MigrationFetchPort = {
    fetcherKey: 'scripted',
    fetcherVersion: '1',
    async fetch(url) {
      requests.push(url);
      return outcome(url);
    },
  };
  return { fetcher, requests };
}

const response = (url: string, status: number, body = ''): FetchOutcome => ({
  kind: 'response',
  status,
  requestedUrl: url,
  finalUrl: url,
  contentType: 'text/plain',
  headers: {},
  body: new TextEncoder().encode(body),
  retryAfter: null,
});

describe('readRobots', () => {
  it('reads the origin’s own /robots.txt through the source’s fetcher', async () => {
    const { fetcher, requests } = fetcherAnswering((url) =>
      response(url, 200, 'User-agent: *\nDisallow: /private'),
    );
    const { policy, outcome } = await readRobots(fetcher, `${ORIGIN}/news/item?x=1`);
    expect(requests).toEqual([`${ORIGIN}/robots.txt`]);
    expect(outcome.kind).toBe('response');
    expect(policy.allows(at('/news'))).toBe(true);
    expect(policy.allows(at('/private/1'))).toBe(false);
  });

  it.each([400, 401, 403, 404, 410, 429, 451])(
    'allows everything when the file is unavailable (%i)',
    async (status) => {
      const { fetcher } = fetcherAnswering((url) =>
        response(url, status, 'User-agent: *\nDisallow: /'),
      );
      expect((await readRobots(fetcher, ORIGIN)).policy.allows(at('/anything'))).toBe(
        true,
      );
    },
  );

  it.each([500, 502, 503, 301, 302, 204, 206])(
    'disallows everything when the file is unreachable (%i)',
    async (status) => {
      const { fetcher } = fetcherAnswering((url) => response(url, status));
      expect((await readRobots(fetcher, ORIGIN)).policy.allows(at('/'))).toBe(false);
    },
  );

  it('disallows everything on a refusal or a network failure — unknown is not permission', async () => {
    const outcomes: FetchOutcome[] = [
      {
        kind: 'refused',
        classification: 'address-refused',
        requestedUrl: `${ORIGIN}/robots.txt`,
        detail: 'address-private',
      },
      {
        kind: 'refused',
        classification: 'too-large',
        requestedUrl: `${ORIGIN}/robots.txt`,
        detail: 'body-exceeds-cap',
      },
      {
        kind: 'failure',
        classification: 'network',
        requestedUrl: `${ORIGIN}/robots.txt`,
        detail: 'x',
      },
      {
        kind: 'failure',
        classification: 'timeout',
        requestedUrl: `${ORIGIN}/robots.txt`,
        detail: 'x',
      },
    ];
    for (const answer of outcomes) {
      const { fetcher } = fetcherAnswering(() => answer);
      const read = await readRobots(fetcher, ORIGIN);
      expect(read.outcome).toBe(answer);
      expect(read.policy.allows(at('/'))).toBe(false);
    }
  });

  it('decodes invalid UTF-8 without failing open', async () => {
    const bytes = new Uint8Array([
      ...new TextEncoder().encode('User-agent: *\nDisallow: /a\n# '),
      0xff,
      0xfe,
      ...new TextEncoder().encode('\nDisallow: /b'),
    ]);
    const { fetcher } = fetcherAnswering((url) => ({
      ...response(url, 200),
      body: bytes,
    }));
    const { policy } = await readRobots(fetcher, ORIGIN);
    expect(policy.allows(at('/a'))).toBe(false);
    expect(policy.allows(at('/b'))).toBe(false);
    expect(policy.allows(at('/c'))).toBe(true);
  });
});

describe('regressions fixed in Phase 30 review', () => {
  const url = (path: string) => new URL(path, ORIGIN).toString();

  it('compares a non-ASCII rule with the percent-encoded path it names (RFC 9309 §2.2.2)', () => {
    const policy = parseRobots('User-agent: *\nDisallow: /اردو/\n');
    expect(policy.allows(url('/اردو/x'))).toBe(false);
    expect(policy.allows(url('/%D8%A7%D8%B1%D8%AF%D9%88/x'))).toBe(false);
    expect(policy.allows(url('/%d8%a7%d8%b1%d8%af%d9%88/x'))).toBe(false);
    expect(policy.allows(url('/english/x'))).toBe(true);
  });

  it('treats only an exact product token as our group — never a prefix or an empty line', () => {
    const prefix = parseRobots('User-agent: o\nAllow: /\n\nUser-agent: *\nDisallow: /\n');
    expect(prefix.allows(url('/a'))).toBe(false);
    const empty = parseRobots('User-agent:\nAllow: /\n\nUser-agent: *\nDisallow: /\n');
    expect(empty.allows(url('/a'))).toBe(false);
    const ours = parseRobots(
      `User-agent: ${ROBOTS_PRODUCT_TOKEN}/1.30\nAllow: /\n\nUser-agent: *\nDisallow: /\n`,
    );
    expect(ours.allows(url('/a'))).toBe(true);
  });
});
