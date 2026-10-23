import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { canonicalSourceUrl } from '../../packages/contracts/src/migration/index.ts';
import {
  classifyLink,
  internalDigests,
  legacyUrlDigest,
  rewriteHref,
  stageLinks,
  type LinkScope,
} from '../../apps/web/src/contexts/migration-provenance/domain/links.ts';
import { sanitizeFragment } from '../../apps/web/src/contexts/migration-provenance/domain/normalize.ts';

const scope: LinkScope = {
  baseUrl: 'https://videos.fixture.invalid/videos/7?lang=en',
  hosts: ['videos.fixture.invalid', 'www.videos.fixture.invalid'],
};
const sha = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
const MAPPED = 'https://videos.fixture.invalid/videos/12?b=2&a=1';
const mappings = new Map([
  [
    sha(canonicalSourceUrl(new URL(MAPPED))),
    { id: 'mapping-1', canonicalPath: '/watch/videos/lecture-12' },
  ],
]);

describe('classifyLink', () => {
  it('treats source hosts as internal, resolving relative hrefs against the final URL', () => {
    expect(classifyLink('/videos/3', scope)).toMatchObject({
      kind: 'internal',
      url: 'https://videos.fixture.invalid/videos/3',
    });
    expect(classifyLink('../about', scope)).toMatchObject({
      kind: 'internal',
      url: 'https://videos.fixture.invalid/about',
    });
    expect(
      classifyLink('https://WWW.Videos.Fixture.Invalid/x#frag', scope),
    ).toMatchObject({ kind: 'internal', url: 'https://www.videos.fixture.invalid/x' });
  });

  it('treats other hosts as external, unchanged', () => {
    expect(classifyLink('https://example.org/page?q=1', scope)).toEqual({
      kind: 'external',
      href: 'https://example.org/page?q=1',
      url: 'https://example.org/page?q=1',
    });
  });

  it('judges protocol-relative, backslash and encoded tricks by the host a browser would use', () => {
    expect(classifyLink('//evil.example/x', scope).kind).toBe('external');
    expect(classifyLink('/\\evil.example/x', scope).kind).toBe('external');
    expect(classifyLink('https:\\\\evil.example\\x', scope).kind).toBe('external');
    expect(classifyLink('https://videos.fixture.invalid.evil.example/', scope).kind).toBe(
      'external',
    );
    expect(classifyLink('https://videos.fixture.invalid@evil.example/', scope).kind).toBe(
      'dropped',
    );
    expect(classifyLink('%2F%2Fevil.example/x', scope)).toMatchObject({
      kind: 'internal',
    });
    expect(classifyLink('https://videos.fixture.invalid:8443/x', scope).kind).toBe(
      'external',
    );
  });

  it('drops every non-http(s) scheme, however disguised', () => {
    for (const href of [
      'javascript:alert(1)',
      ' JAVASCRIPT:alert(1)',
      'java\tscript:alert(1)',
      'java\nscript:alert(1)',
      'data:text/html,x',
      'vbscript:x',
      'file:///etc/passwd',
      'mailto:a@example.org',
      'ftp://videos.fixture.invalid/x',
      'http://[::1',
    ])
      expect(classifyLink(href, scope).kind).toBe('dropped');
  });

  it('resolves an empty href to the record itself, as a browser does', () => {
    expect(classifyLink('', scope)).toMatchObject({
      kind: 'internal',
      url: 'https://videos.fixture.invalid/videos/7?lang=en',
    });
  });
});

describe('stageLinks and rewriteHref', () => {
  const hrefs = [
    '/videos/12?a=1&b=2',
    '/videos/99',
    'https://example.org/',
    'javascript:alert(1)',
    '/videos/12?a=1&b=2',
  ];

  it('rewrites mapped, leaves unmapped as legacy URLs, keeps external, drops unsafe — once each, in order', () => {
    expect(stageLinks(hrefs, scope, mappings)).toEqual([
      {
        position: 0,
        href: canonicalSourceUrl(new URL(MAPPED)),
        disposition: 'rewritten',
        rewrittenTo: '/watch/videos/lecture-12',
        legacyMappingId: 'mapping-1',
      },
      {
        position: 1,
        href: 'https://videos.fixture.invalid/videos/99',
        disposition: 'unresolved',
        rewrittenTo: null,
        legacyMappingId: null,
      },
      {
        position: 2,
        href: 'https://example.org/',
        disposition: 'external',
        rewrittenTo: null,
        legacyMappingId: null,
      },
      {
        position: 3,
        href: 'javascript:alert(1)',
        disposition: 'dropped',
        rewrittenTo: null,
        legacyMappingId: null,
      },
    ]);
  });

  it('is deterministic', () => {
    expect(stageLinks(hrefs, scope, mappings)).toEqual(
      stageLinks(hrefs, scope, mappings),
    );
    expect(internalDigests(hrefs, scope)).toEqual(
      internalDigests([...hrefs].reverse(), scope),
    );
  });

  it('never fabricates a target for an unmapped link', () => {
    expect(rewriteHref('/videos/99', scope, mappings)).toBe(
      'https://videos.fixture.invalid/videos/99',
    );
    expect(rewriteHref('/videos/12?b=2&a=1', scope, mappings)).toBe(
      '/watch/videos/lecture-12',
    );
    expect(rewriteHref('javascript:alert(1)', scope, mappings)).toBeNull();
  });

  it('ignores a mapping whose path is not a single-slash site path', () => {
    const bad = new Map([
      [
        sha(canonicalSourceUrl(new URL(MAPPED))),
        { id: 'm', canonicalPath: '//evil.example/x' },
      ],
    ]);
    expect(rewriteHref(MAPPED, scope, bad)).toBe(canonicalSourceUrl(new URL(MAPPED)));
    expect(stageLinks([MAPPED], scope, bad)[0]?.disposition).toBe('unresolved');
  });

  it('rewrites the sanitised description accordingly', () => {
    const html = sanitizeFragment(
      '<p><a href="/videos/12?a=1&amp;b=2">mapped</a> <a href="/videos/99">unmapped</a> <a href="//evil.example/">ext</a> <a href="javascript:alert(1)">bad</a></p>',
      { rewrite: (href) => rewriteHref(href, scope, mappings) },
    );
    expect(html).toBe(
      '<p><a href="/watch/videos/lecture-12" rel="noopener noreferrer">mapped</a> ' +
        '<a href="https://videos.fixture.invalid/videos/99" rel="noopener noreferrer">unmapped</a> ' +
        '<a href="https://evil.example/" rel="noopener noreferrer">ext</a> ' +
        '<a rel="noopener noreferrer">bad</a></p>',
    );
  });

  it('bounds the number of link rows', () => {
    const many = Array.from({ length: 300 }, (_, n) => `/videos/${n}`);
    expect(stageLinks(many, scope, new Map())).toHaveLength(200);
  });
});

describe('legacyUrlDigest', () => {
  it('is the SHA-256 of the canonical URL, so query order does not matter', () => {
    expect(legacyUrlDigest('https://videos.fixture.invalid/videos/12?b=2&a=1')).toBe(
      legacyUrlDigest('https://videos.fixture.invalid/videos/12?a=1&b=2#x'),
    );
    expect(legacyUrlDigest(MAPPED)).toMatch(/^[0-9a-f]{64}$/);
  });
});
