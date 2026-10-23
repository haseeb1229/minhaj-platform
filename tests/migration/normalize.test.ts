import { describe, expect, it } from 'vitest';

import {
  MIGRATION_SANITIZE_OPTIONS,
  REDACTED,
  anchorHrefs,
  detectPersonalData,
  foldTitle,
  normalizeText,
  normalizeTitle,
  plainText,
  sanitizeFragment,
  slugFor,
} from '../../apps/web/src/contexts/migration-provenance/domain/normalize.ts';

/** Nothing executable, embeddable, styleable or submittable survives. */
function assertInert(html: string): void {
  expect(html).not.toMatch(
    /<\s*(script|style|iframe|object|embed|form|svg|math|noscript|template|meta|link|textarea|select|option|img|input|button|animate|set|base)\b/i,
  );
  expect(html).not.toMatch(/\son[a-z]+\s*=/i);
  expect(html).not.toMatch(/javascript:|vbscript:|data:/i);
  expect(html).not.toMatch(/\sstyle\s*=|\ssrc\s*=|\starget\s*=/i);
  const tags = [...html.matchAll(/<\/?([a-z0-9]+)/gi)].map((match) =>
    match[1]!.toLowerCase(),
  );
  for (const tag of tags)
    expect(['p', 'br', 'strong', 'em', 'ul', 'ol', 'li', 'blockquote', 'a']).toContain(
      tag,
    );
}

describe('the sanitiser allowlist', () => {
  it('is exactly the brief decision', () => {
    expect(MIGRATION_SANITIZE_OPTIONS.allowedTags).toEqual([
      'p',
      'br',
      'strong',
      'em',
      'ul',
      'ol',
      'li',
      'blockquote',
      'a',
    ]);
    expect(MIGRATION_SANITIZE_OPTIONS.allowedAttributes).toEqual({ a: ['href', 'rel'] });
    expect(MIGRATION_SANITIZE_OPTIONS.allowedSchemes).toEqual(['http', 'https']);
    expect(MIGRATION_SANITIZE_OPTIONS.allowProtocolRelative).toBe(false);
    expect(MIGRATION_SANITIZE_OPTIONS.disallowedTagsMode).toBe('discard');
    for (const region of [
      'script',
      'style',
      'iframe',
      'object',
      'embed',
      'form',
      'svg',
      'math',
      'noscript',
      'template',
      'meta',
      'link',
      'textarea',
      'select',
      'option',
    ])
      expect(MIGRATION_SANITIZE_OPTIONS.nonTextTags).toContain(region);
  });
});

describe('sanitizeFragment on hostile synthetic markup', () => {
  const hostile: [string, string][] = [
    ['script', '<p>a<script>alert(1)</script>b</p>'],
    [
      'event handlers',
      '<p onclick="alert(1)" onmouseover=x>a</p><img src=x onerror=alert(1)>',
    ],
    [
      'javascript: URL',
      '<a href="javascript:alert(1)">x</a><a href="JaVaScRiPt:alert(1)">y</a><a href="java&#x09;script:alert(1)">z</a>',
    ],
    ['data: URL', '<a href="data:text/html,<script>alert(1)</script>">x</a>'],
    ['vbscript: URL', '<a href="vbscript:msgbox(1)">x</a>'],
    [
      'meta refresh',
      '<meta http-equiv="refresh" content="0;url=javascript:alert(1)"><p>m</p>',
    ],
    [
      'SVG/SMIL',
      '<svg><a href="https://x.example/"><animate attributeName="href" to="javascript:alert(1)"/><text>t</text></a></svg>',
    ],
    [
      'object/embed/form',
      '<object data="x.swf"><embed src="x.swf"></object><form action="https://evil.example/"><input name=q><button>go</button></form>',
    ],
    [
      'iframe',
      '<iframe src="https://evil.example/"><p>fallback</p></iframe><iframe srcdoc="<script>alert(1)</script>">',
    ],
    ['noscript', '<noscript><p>hidden<img src=x onerror=alert(1)></p></noscript>'],
    [
      'style region',
      '<style>body{background:url(javascript:alert(1))}</style><p style="color:red">s</p>',
    ],
    [
      'template and textarea',
      '<template><script>alert(1)</script></template><textarea></textarea><img src=x onerror=alert(1)></textarea>',
    ],
    ['protocol-relative', '<a href="//evil.example/">p</a>'],
    ['mutation trick', '<math><mtext><table><mglyph><style><img src=x onerror=alert(1)>'],
  ];

  it.each(hostile)('renders %s inert', (_name, html) => {
    assertInert(sanitizeFragment(html));
  });

  it('discards region contents entirely', () => {
    expect(sanitizeFragment('<noscript><p>no</p></noscript>ok')).toBe('ok');
    expect(
      sanitizeFragment(
        '<style>p{}</style><script>x</script><template><p>t</p></template>u',
      ),
    ).toBe('u');
    expect(sanitizeFragment('<svg><a href="https://x.example/">in</a></svg>t')).toBe('t');
  });

  it('keeps structure, emphasis and safe links, forcing rel', () => {
    expect(
      sanitizeFragment(
        '<p><b>B</b> <i>I</i> <a href="https://x.example/a" target="_blank">l</a></p>',
      ),
    ).toBe(
      '<p><strong>B</strong> <em>I</em> <a href="https://x.example/a" rel="noopener noreferrer">l</a></p>',
    );
  });

  it('keeps the words of a refused link and drops its href', () => {
    expect(sanitizeFragment('<a href="javascript:alert(1)">words</a>')).toBe(
      '<a rel="noopener noreferrer">words</a>',
    );
  });

  it('preserves Arabic and Urdu bytes exactly — no normalisation form is applied', () => {
    // Decomposed forms and presentation forms must survive byte for byte.
    const arabic = 'بِسْمِ ٱللَّٰهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ ﷽ ﻻ';
    const urdu = 'منہاج القرآن کی ویڈیو — اردو ۱۲۳';
    for (const text of [arabic, urdu]) {
      const out = sanitizeFragment(`<p>${text}</p>`);
      expect(out).toBe(`<p>${text}</p>`);
      expect(
        Buffer.from(plainText(`<p>${text}</p>`), 'utf8').equals(
          Buffer.from(text, 'utf8'),
        ),
      ).toBe(true);
    }
    expect(normalizeTitle(`  ${arabic}  `)).toBe(arabic);
  });

  it('collects anchor hrefs in document order', () => {
    expect(
      anchorHrefs('<a href="/a">1</a><p><a href="https://b.example/">2</a></p><a>3</a>'),
    ).toEqual(['/a', 'https://b.example/']);
  });
});

describe('text normalisation', () => {
  it('removes C0 controls, keeps tab and newline, and converts CRLF', () => {
    expect(normalizeText('a\u0000b\u0007c\td\r\ne\rf\u001f')).toBe('abc\td\ne\nf');
  });

  it('trims titles and collapses ASCII whitespace only', () => {
    expect(normalizeTitle('  A\n\t B  ')).toBe('A B');
    expect(normalizeTitle('A B')).toBe('A B');
  });

  it('derives plain text with paragraph and line breaks', () => {
    expect(
      plainText(
        '<p>One &amp; <strong>two</strong></p><p>three<br>four</p><ul><li>x</li><li>y</li></ul>',
      ),
    ).toBe('One & two\n\nthree\nfour\n\nx\n\ny');
    expect(plainText('<p>&lt;script&gt;</p>')).toBe('<script>');
  });

  it('folds titles for comparison only', () => {
    expect(foldTitle('The Lecture: Part 1!')).toBe(foldTitle('the lecture part 1'));
    expect(foldTitle('Ｆｕｌｌ')).toBe('full');
  });
});

describe('slugs', () => {
  it('derives an ASCII slug from the legacy identifier first, then the title', () => {
    expect(
      slugFor({ legacyIdentifier: 'Video_123', title: 'Ignored', fallbackSeed: 'k' }),
    ).toBe('video-123');
    expect(
      slugFor({
        legacyIdentifier: null,
        title: 'Café Lecture — Part 2',
        fallbackSeed: 'k',
      }),
    ).toBe('cafe-lecture-part-2');
  });

  it('falls back to a deterministic short digest when no ASCII remains', () => {
    const one = slugFor({ legacyIdentifier: null, title: 'خطاب', fallbackSeed: 'k' });
    expect(one).toMatch(/^video-[0-9a-f]{12}$/);
    expect(slugFor({ legacyIdentifier: null, title: 'خطاب', fallbackSeed: 'k' })).toBe(
      one,
    );
    expect(
      slugFor({ legacyIdentifier: null, title: 'خطاب دوم', fallbackSeed: 'k' }),
    ).not.toBe(one);
  });

  it('bounds the slug', () => {
    expect(
      slugFor({ legacyIdentifier: null, title: 'word '.repeat(80), fallbackSeed: 'k' })
        .length,
    ).toBeLessThanOrEqual(120);
  });
});

describe('incidental personal data', () => {
  it('flags and redacts email addresses and phone numbers', () => {
    const found = detectPersonalData(
      'Contact ali.raza@example.org or +92 300 1234567 / (042) 111-222-333.',
    );
    expect(found.flagged).toBe(true);
    expect(found.redacted).not.toMatch(/example\.org|1234567|111-222/);
    expect(found.redacted.split(REDACTED).length - 1).toBe(3);
  });

  it('flags Urdu-digit phone numbers', () => {
    expect(detectPersonalData('رابطہ ۰۳۰۰۱۲۳۴۵۶۷').flagged).toBe(true);
  });

  it('leaves ordinary numbers, dates and URLs alone', () => {
    for (const text of [
      'Recorded 2019-03-15 in 12 parts',
      'Year 1440 AH, 30 minutes',
      'https://vimeo.com/123456789',
      'id=123456789',
      'Lecture 12345678',
    ])
      expect(detectPersonalData(text)).toEqual({ flagged: false, redacted: text });
  });

  it('redacts inside sanitised markup when asked', () => {
    expect(sanitizeFragment('<p>mail me@example.com</p>', { redact: true })).toBe(
      `<p>mail ${REDACTED}</p>`,
    );
  });
});
