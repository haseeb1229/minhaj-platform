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

/** The allowlist, exactly: structure, headings h2–h4, quotation, emphasis and links. */
const ALLOWED = [
  'p',
  'br',
  'strong',
  'em',
  'ul',
  'ol',
  'li',
  'blockquote',
  'a',
  'h2',
  'h3',
  'h4',
];

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
  for (const tag of tags) expect(ALLOWED).toContain(tag);
}

describe('the sanitiser allowlist', () => {
  it('is exactly the brief decision, with section headings h2–h4 admitted', () => {
    expect(MIGRATION_SANITIZE_OPTIONS.allowedTags).toEqual(ALLOWED);
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

  it('re-levels headings into h2–h4 and never drops their words', () => {
    expect(
      sanitizeFragment(
        '<h1 id="x">One</h1><h2>Two</h2><h3>Three</h3><h4>Four</h4><h5>Five</h5><h6 style="c">Six</h6>',
      ),
    ).toBe(
      '<h2>One</h2><h2>Two</h2><h3>Three</h3><h4>Four</h4><h4>Five</h4><h4>Six</h4>',
    );
    expect(plainText('<h1>Title</h1><p>Body</p><h6>End</h6>')).toBe(
      'Title\n\nBody\n\nEnd',
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

describe('images that label a link (Phase 30-RV)', () => {
  const REL = 'rel="noopener noreferrer"';

  it('keeps an image-only link’s words: the image’s alt, as text, where it stood', () => {
    const html = sanitizeFragment(
      '<a href="https://get.app.example/" target="_blank"><div><br><img src="https://minhaj.net/app.png" alt=" Synthetic App "></a>',
    );
    expect(html).toBe(
      `<a href="https://get.app.example/" ${REL}><br />Synthetic App</a>`,
    );
    assertInert(html);
    expect(
      plainText('<p><a href="/apps/one"><img src="/one.png" alt="App One"></a></p>'),
    ).toBe('App One');
    expect(anchorHrefs('<a href="/apps/one"><img alt="App One"></a>')).toEqual([
      '/apps/one',
    ]);
  });

  it('goes on keeping the words after the image, inside and outside the link', () => {
    expect(
      sanitizeFragment('<p><a href="/p"><img alt="Icon"> Read <b>more</b></a> after</p>'),
    ).toBe(`<p><a href="/p" ${REL}>Icon Read <strong>more</strong></a> after</p>`);
    expect(sanitizeFragment('<a href="/p"><img alt="Icon"><span>words</span></a>x')).toBe(
      `<a href="/p" ${REL}>Iconwords</a>x`,
    );
  });

  it('contributes nothing for an image in a link to a picture, outside a link, or without alt', () => {
    for (const href of [
      'https://minhaj.net/large.jpg',
      '/images/large.JPEG?size=2',
      'large.png#zoom',
      'https://x.example/a.gif',
      'https://x.example/a.webp',
      'https://x.example/a.bmp',
      'https://x.example/a.svg',
    ])
      expect(sanitizeFragment(`<a href="${href}"><img alt="Zoom"></a>`)).not.toContain(
        'Zoom',
      );
    expect(sanitizeFragment('<p><img src="/a.png" alt="Alone"></p>')).toBe('<p></p>');
    expect(sanitizeFragment('<a href="/p">x</a><img alt="After">')).toBe(
      `<a href="/p" ${REL}>x</a>`,
    );
    expect(sanitizeFragment('<a name="n"><img alt="Named"></a>')).toBe(`<a ${REL}></a>`);
    for (const img of ['<img src="/a.png">', '<img alt="">', '<img alt="  ">'])
      expect(sanitizeFragment(`<a href="/p">${img}</a>`)).toBe(
        `<a href="/p" ${REL}></a>`,
      );
  });

  it('writes the alt as escaped text, and redacts it like any other text', () => {
    expect(sanitizeFragment('<a href="/p"><img alt="A &amp; <b>B</b>"></a>')).toBe(
      `<a href="/p" ${REL}>A &amp; &lt;b&gt;B&lt;/b&gt;</a>`,
    );
    const contact =
      '<a href="/contact"><img alt="Write to me@example.com or +92 300 1234567"></a>';
    expect(sanitizeFragment(contact)).toContain('me@example.com');
    expect(sanitizeFragment(contact, { redact: true })).toBe(
      `<a href="/contact" ${REL}>Write to ${REDACTED} or ${REDACTED}</a>`,
    );
  });

  it('leaves no trace of the element the words are written in', () => {
    expect(
      sanitizeFragment(
        '<migration-image-words class="x" onclick="y">kept</migration-image-words>',
      ),
    ).toBe('kept');
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

  it('names the kind in a digest slug, and only there', () => {
    for (const prefix of ['book', 'magazine', 'issue', 'news', 'article', 'fatwa'])
      expect(
        slugFor({ legacyIdentifier: null, title: 'خطاب', fallbackSeed: 'k', prefix }),
      ).toMatch(new RegExp(`^${prefix}-[0-9a-f]{12}$`));
    expect(
      slugFor({
        legacyIdentifier: null,
        title: 'Plain Title',
        fallbackSeed: 'k',
        prefix: 'book',
      }),
    ).toBe('plain-title');
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
