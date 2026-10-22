import { describe, it, expect } from 'vitest';
import {
  renderEditorialDocument,
  safeEditorialLink,
  sanitizeEditorialHtml,
} from '../../apps/web/src/contexts/editorial/application/rich-text.ts';
const document = (text: string, marks?: unknown[]) =>
  JSON.stringify({
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text, ...(marks ? { marks } : {}) }],
      },
    ],
  });
describe('Editorial structured rich text', () => {
  it('renders text and formatting on the server without a DOM', () => {
    const result = renderEditorialDocument(
      document('Synthetic <script>alert(1)</script>', [{ type: 'bold' }]),
    );
    expect(result.html).toContain('<strong>Synthetic &lt;script&gt;');
    expect(result.html).not.toContain('<script>');
    expect(JSON.parse(result.document).type).toBe('doc');
  });
  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'data:text/html,x',
    'vbscript:msgbox(1)',
    '//evil.invalid/x',
    'https://user:password@example.invalid',
    '/\\evil.invalid',
    'https://example.invalid/ white',
    ' javaScript:alert(1)',
  ])('rejects unsafe link %s', (href) => {
    expect(safeEditorialLink(href)).toBe(false);
    expect(() =>
      renderEditorialDocument(document('link', [{ type: 'link', attrs: { href } }])),
    ).toThrow('invalid');
  });
  it.each(['https://example.invalid/path?q=1', 'http://example.invalid', '/en/help'])(
    'allows bounded web link %s',
    (href) => {
      expect(
        renderEditorialDocument(document('link', [{ type: 'link', attrs: { href } }]))
          .html,
      ).toContain('rel="noopener noreferrer"');
    },
  );
  it.each(['image', 'iframe', 'video', 'script', 'codeBlock', 'horizontalRule'])(
    'rejects unsupported node %s',
    (type) => {
      expect(() =>
        renderEditorialDocument(JSON.stringify({ type: 'doc', content: [{ type }] })),
      ).toThrow('invalid');
    },
  );
  it('rejects malformed JSON, unknown attrs, invalid nesting, and excessive depth/size', () => {
    for (const source of [
      '<p>raw html</p>',
      '{',
      JSON.stringify({
        type: 'doc',
        content: [{ type: 'paragraph', attrs: { onclick: 'bad' } }],
      }),
      JSON.stringify({
        type: 'doc',
        content: [{ type: 'text', text: 'invalid nesting' }],
      }),
      ' '.repeat(200001),
    ])
      expect(() => renderEditorialDocument(source)).toThrow('invalid');
    let node: unknown = { type: 'paragraph' };
    for (let index = 0; index < 14; index++)
      node = { type: 'blockquote', content: [node] };
    expect(() =>
      renderEditorialDocument(JSON.stringify({ type: 'doc', content: [node] })),
    ).toThrow('invalid');
  });
  it('independently strips active markup and unsafe attributes from server HTML', () => {
    const html = sanitizeEditorialHtml(
      '<p onclick="bad()" style="color:red">ok<script>bad()</script><img src=x onerror=bad()><svg onload=bad()></svg><a href="javascript:bad()" target="_blank">bad</a><iframe src="https://example.invalid"></iframe></p>',
    );
    expect(html).toContain('ok');
    for (const unsafe of [
      'onclick',
      'style=',
      '<script',
      '<img',
      '<svg',
      '<iframe',
      'javascript:',
      'target=',
    ])
      expect(html).not.toContain(unsafe);
  });

  // The sanitize-html advisory classes published in October 2026 (fixed in
  // 2.18.1): an SVG/SMIL animation rewriting a link to `javascript:`, a
  // `<meta http-equiv=refresh>` carrying a `javascript:`/`data:` URL, and a
  // discard region (`script`, `noscript`) ending early on an implied close.
  // The editorial allowlist admits none of these elements, so whatever the
  // library version, the output must stay inert: no scriptable element, no
  // unsafe scheme, and any surviving link re-validated and `noopener`.
  it.each([
    [
      'SMIL animation rewriting a link',
      '<p>a<svg xmlns:x="http://www.w3.org/1999/xlink"><a x:href="#"><animate attributeName="x:href" values="javascript:alert(1)"/><set attributeName="href" to="javascript:alert(1)"/><text>t</text></a></svg>b</p>',
    ],
    [
      'namespace-prefixed SVG link',
      '<p><svg><svg:a xmlns:svg="http://www.w3.org/2000/svg" href="javascript:alert(1)">z</svg:a></svg></p>',
    ],
    [
      'meta refresh to javascript:',
      '<meta http-equiv="refresh" content="0;url=javascript:alert(1)"><p>m</p>',
    ],
    [
      'meta refresh to data:',
      '<meta http-equiv="refresh" content="0; URL=data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=="><p>m</p>',
    ],
    [
      'discard region closed early by an implied close',
      '<noscript><p>one<p>two</noscript><script><p>x</script><style><p>y</style><p>after</p>',
    ],
    [
      'link inside a discard region',
      '<p>x<noscript><a href="javascript:alert(1)">l</a><a href="https://example.invalid" target="_blank">k</a></noscript>y</p>',
    ],
  ])('keeps the %s inert', (_name, payload) => {
    const html = sanitizeEditorialHtml(payload);
    for (const unsafe of [
      '<svg',
      '<animate',
      '<set',
      '<meta',
      'http-equiv',
      '<noscript',
      '<script',
      '<style',
      'javascript:',
      'data:',
      'target=',
    ])
      expect(html).not.toContain(unsafe);
    for (const [, href] of html.matchAll(/href="([^"]*)"/g))
      expect(safeEditorialLink(href!)).toBeTruthy();
    for (const anchor of html.match(/<a\b[^>]*>/g) ?? [])
      expect(anchor).toContain('rel="noopener noreferrer"');
  });
});
