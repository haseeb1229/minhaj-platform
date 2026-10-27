import { describe, expect, it } from 'vitest';

import {
  stagedBodySchema,
  type StagedBlock,
  type StagedInline,
} from '../../packages/contracts/src/migration/index.ts';
import { REDACTED } from '../../apps/web/src/contexts/migration-provenance/domain/normalize.ts';
import {
  blocksFrom,
  blocksText,
} from '../../apps/web/src/contexts/migration-provenance/domain/rich-text.ts';

/**
 * SANITISED MARKUP → STAGED BLOCKS (MIGRATION_STRATEGY.md §4.6).
 *
 * The sanitiser's allowlist re-expressed as data: every word kept exactly,
 * whitespace collapsed by HTML's own rule, nothing executable carried, and
 * nested structure flattened rather than discarded.
 */

const para = (...content: StagedInline[]): StagedBlock => ({
  type: 'paragraph',
  content,
});
const text = (value: string): StagedInline => ({ text: value });

describe('blocksFrom', () => {
  it('returns no blocks for empty or whitespace-only input', () => {
    for (const html of ['', '   ', '\n\t', '<p> </p>', '<p></p><ul></ul>', '<br>'])
      expect(blocksFrom(html)).toEqual([]);
  });

  it('makes one paragraph per <p>, and a paragraph of loose text', () => {
    expect(blocksFrom('<p>One</p><p>Two</p>')).toEqual([
      para(text('One')),
      para(text('Two')),
    ]);
    expect(blocksFrom('loose words')).toEqual([para(text('loose words'))]);
  });

  it('keeps headings, re-levelling h1 to 2 and h5/h6 to 4', () => {
    expect(
      blocksFrom('<h1>A</h1><h2>B</h2><h3>C</h3><h4>D</h4><h5>E</h5><h6>F</h6>'),
    ).toEqual([
      { type: 'heading', level: 2, content: [text('A')] },
      { type: 'heading', level: 2, content: [text('B')] },
      { type: 'heading', level: 3, content: [text('C')] },
      { type: 'heading', level: 4, content: [text('D')] },
      { type: 'heading', level: 4, content: [text('E')] },
      { type: 'heading', level: 4, content: [text('F')] },
    ]);
  });

  it('keeps ordered and unordered lists, one run list per item', () => {
    expect(blocksFrom('<ul><li>a</li> <li>b</li></ul><ol><li>c</li></ol>')).toEqual([
      { type: 'list', ordered: false, items: [[text('a')], [text('b')]] },
      { type: 'list', ordered: true, items: [[text('c')]] },
    ]);
  });

  it('flattens a nested list into the outer list, never dropping its words', () => {
    expect(
      blocksFrom('<ul><li>a<ol><li>b</li><li>c</li></ol></li><li>d</li></ul>'),
    ).toEqual([
      {
        type: 'list',
        ordered: false,
        items: [[text('a')], [text('b')], [text('c')], [text('d')]],
      },
    ]);
  });

  it('keeps a quotation, a paragraph inside it starting a new quotation block', () => {
    expect(blocksFrom('<blockquote>Said</blockquote>')).toEqual([
      { type: 'quote', content: [text('Said')] },
    ]);
    expect(blocksFrom('<blockquote><p>q1</p><p>q2</p></blockquote><p>after</p>')).toEqual(
      [
        { type: 'quote', content: [text('q1')] },
        { type: 'quote', content: [text('q2')] },
        para(text('after')),
      ],
    );
  });

  it('turns <br> into a newline inside its run', () => {
    expect(blocksFrom('<p>line one<br>line two<br/></p>')).toEqual([
      para(text('line one\nline two')),
    ]);
  });

  it('carries bold, italic and links as marks, merging runs that agree', () => {
    expect(
      blocksFrom(
        '<p>x <b>bold <i>both</i></b> <strong>more</strong> <a href="https://e.example/a">link <em>it</em></a></p>',
      ),
    ).toEqual([
      para(
        text('x '),
        { text: 'bold ', bold: true },
        { text: 'both', bold: true, italic: true },
        text(' '),
        { text: 'more', bold: true },
        text(' '),
        { text: 'link ', href: 'https://e.example/a' },
        { text: 'it', italic: true, href: 'https://e.example/a' },
      ),
    ]);
  });

  it('keeps the words of a refused link without its href', () => {
    expect(blocksFrom('<p><a href="javascript:alert(1)">words</a></p>')).toEqual([
      para(text('words')),
    ]);
  });

  it('applies the link rewrite to every href', () => {
    const seen: string[] = [];
    const blocks = blocksFrom(
      '<p><a href="/old/1">one</a> <a href="/old/2">two</a></p>',
      {
        rewrite: (href) => {
          seen.push(href);
          return href === '/old/1' ? '/watch/videos/one' : null;
        },
      },
    );
    expect(seen).toEqual(['/old/1', '/old/2']);
    expect(blocks).toEqual([
      para({ text: 'one', href: '/watch/videos/one' }, text(' two')),
    ]);
  });

  it('collapses runs of ASCII whitespace and trims each block, keeping other spaces', () => {
    expect(blocksFrom('<p>  a \n\t  b   </p>')).toEqual([para(text('a b'))]);
    // A no-break space is a letter of the text, not layout.
    expect(blocksFrom('<p>a  b</p>')).toEqual([para(text('a  b'))]);
  });

  it('decodes entities exactly once', () => {
    expect(blocksFrom('<p>&amp; &lt;x&gt; &quot;q&quot; &#1605; &amp;lt;</p>')).toEqual([
      para(text('& <x> "q" م &lt;')),
    ]);
  });

  it('drops script, style and iframe with their contents', () => {
    expect(
      blocksFrom(
        '<p>a<script>evil()</script>b</p><style>p{}</style><iframe src="https://x.example/"><p>inner</p></iframe><p>c</p>',
      ),
    ).toEqual([para(text('ab')), para(text('c'))]);
  });

  it('redacts incidental personal data only when asked', () => {
    const html = '<p>Write to me@example.com or call +92 300 1234567</p>';
    expect(blocksText(blocksFrom(html))).toContain('me@example.com');
    const redacted = blocksText(blocksFrom(html, { redact: true }));
    expect(redacted).not.toMatch(/example\.com|1234567/);
    expect(redacted.split(REDACTED).length - 1).toBe(2);
  });

  it('preserves Arabic and Urdu text byte for byte', () => {
    const urdu = 'منہاج القرآن — ۱۲۳';
    const arabic = 'بِسْمِ ٱللَّٰهِ ٱلرَّحْمَٰنِ';
    expect(blocksFrom(`<p>${urdu}</p><h3>${arabic}</h3>`)).toEqual([
      para(text(urdu)),
      { type: 'heading', level: 3, content: [text(arabic)] },
    ]);
  });

  it('always produces blocks the strict body schema accepts', () => {
    for (const html of [
      '<p>One</p>',
      '<h1>T</h1><ul><li>a<ul><li>b</li></ul></li></ul><blockquote><p>q</p></blockquote>',
      '<p><a href="/x">l</a><br><strong>b</strong></p>',
      '<div><span>wrapped</span></div><table><tr><td>cell</td></tr></table>',
    ]) {
      const blocks = blocksFrom(html);
      expect(stagedBodySchema.safeParse(blocks).success).toBe(true);
    }
  });
});

describe('blocksText', () => {
  it('reads blocks as a reader would: one paragraph per block or list item', () => {
    expect(
      blocksText(
        blocksFrom(
          '<h2>Head</h2><p>Para <b>bold</b></p><ul><li>a</li><li>b</li></ul><blockquote>q</blockquote>',
        ),
      ),
    ).toBe('Head\n\nPara bold\n\na\n\nb\n\nq');
    expect(blocksText([])).toBe('');
  });
});

describe('long legacy runs (Phase 30 review regression)', () => {
  it('keeps a paragraph longer than 20 000 characters whole and schema-valid', () => {
    const words = 'لفظ '.repeat(6000).trim();
    const blocks = blocksFrom(`<p>${words}</p>`);
    expect(blocks).toHaveLength(1);
    expect(blocksText(blocks)).toBe(words);
    expect(stagedBodySchema.safeParse(blocks).success).toBe(true);
  });
});
