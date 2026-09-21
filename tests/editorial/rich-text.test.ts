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
});
