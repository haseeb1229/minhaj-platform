import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import {
  EditorialCard,
  ListRow,
  MediaCard,
} from '../../apps/web/src/components/ui/cards.tsx';
import {
  Cover,
  Poster,
  ResponsiveImage,
} from '../../apps/web/src/components/ui/image.tsx';
import {
  firstPartyImagePath,
  imageSrcSet,
} from '../../apps/web/src/components/ui/image-source.ts';
import {
  rovingIndex,
  scrollEdges,
  scrollStep,
  trapFocusIndex,
} from '../../apps/web/src/components/ui/interaction.ts';
import { Pager, pagerWindow } from '../../apps/web/src/components/ui/pager.tsx';

/**
 * R2 — THE SHARED UI PRIMITIVES' BEHAVIOUR.
 *
 * The keyboard, focus and scroll decisions of the client islands (Tabs, the
 * mega-navigation, Dialog/Sheet, Shelf) are pure functions, proven here for
 * both reading directions. The server primitives are rendered by calling them
 * — they hold no hooks — and their output tree is inspected: an image only
 * from a first-party route, one link per card, a pager that marks the current
 * page and never links a page that does not exist.
 */

/** Resolves function components (none of these use hooks) into host elements. */
function expand(node: ReactNode): ReactNode {
  if (Array.isArray(node)) return node.map(expand);
  if (!isValidElement(node)) return node;
  const element = node as ReactElement<Record<string, unknown>>;
  if (typeof element.type === 'function')
    return expand((element.type as (props: unknown) => ReactNode)(element.props));
  const children = element.props.children as ReactNode;
  return { ...element, props: { ...element.props, children: expand(children) } };
}

/** Every host element of a given tag in an expanded tree. */
function all(node: ReactNode, tag: string): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap((child: ReactNode) => all(child, tag));
  if (!isValidElement(node)) return [];
  const element = node as ReactElement<Record<string, unknown>>;
  const own = element.type === tag ? [element] : [];
  return [...own, ...all(element.props.children as ReactNode, tag)];
}

describe('roving focus', () => {
  it('moves along the row as the visitor sees it, mirrored in RTL', () => {
    expect(rovingIndex('ArrowRight', 0, 4, 'ltr')).toBe(1);
    expect(rovingIndex('ArrowLeft', 0, 4, 'ltr')).toBe(3);
    expect(rovingIndex('ArrowLeft', 0, 4, 'rtl')).toBe(1);
    expect(rovingIndex('ArrowRight', 0, 4, 'rtl')).toBe(3);
  });

  it('wraps at both ends and jumps with Home and End', () => {
    expect(rovingIndex('ArrowRight', 3, 4, 'ltr')).toBe(0);
    expect(rovingIndex('Home', 2, 4, 'rtl')).toBe(0);
    expect(rovingIndex('End', 0, 4, 'ltr')).toBe(3);
  });

  it('leaves every other key, and an empty row, alone', () => {
    expect(rovingIndex('ArrowDown', 1, 4, 'ltr')).toBeNull();
    expect(rovingIndex('Enter', 1, 4, 'ltr')).toBeNull();
    expect(rovingIndex('ArrowRight', 0, 0, 'ltr')).toBeNull();
  });
});

describe('the dialog focus trap', () => {
  it('wraps Tab from the last element and Shift+Tab from the first', () => {
    expect(trapFocusIndex(4, 5, false)).toBe(0);
    expect(trapFocusIndex(0, 5, true)).toBe(4);
  });

  it('lets focus move normally inside', () => {
    expect(trapFocusIndex(2, 5, false)).toBeNull();
    expect(trapFocusIndex(2, 5, true)).toBeNull();
  });

  it('brings focus that escaped back in, at the end it entered from', () => {
    expect(trapFocusIndex(-1, 5, false)).toBe(0);
    expect(trapFocusIndex(-1, 5, true)).toBe(4);
    expect(trapFocusIndex(-1, 0, false)).toBeNull();
  });
});

describe('the shelf', () => {
  it('knows its ends in a left-to-right scroller', () => {
    expect(scrollEdges({ scrollLeft: 0, scrollWidth: 1000, clientWidth: 400 })).toEqual({
      atStart: true,
      atEnd: false,
    });
    expect(scrollEdges({ scrollLeft: 600, scrollWidth: 1000, clientWidth: 400 })).toEqual(
      {
        atStart: false,
        atEnd: true,
      },
    );
  });

  it('knows its ends in a right-to-left scroller, where scrollLeft is negative', () => {
    expect(
      scrollEdges({ scrollLeft: -300, scrollWidth: 1000, clientWidth: 400 }),
    ).toEqual({
      atStart: false,
      atEnd: false,
    });
    expect(
      scrollEdges({ scrollLeft: -599.5, scrollWidth: 1000, clientWidth: 400 }).atEnd,
    ).toBe(true);
  });

  it('is at both ends when everything fits, so no buttons are offered', () => {
    expect(scrollEdges({ scrollLeft: 0, scrollWidth: 400, clientWidth: 400 })).toEqual({
      atStart: true,
      atEnd: true,
    });
  });

  it('steps most of a view, towards the reading direction', () => {
    expect(scrollStep('next', 400, 'ltr')).toBe(340);
    expect(scrollStep('previous', 400, 'ltr')).toBe(-340);
    expect(scrollStep('next', 400, 'rtl')).toBe(-340);
    expect(scrollStep('previous', 400, 'rtl')).toBe(340);
  });
});

describe('image addresses', () => {
  it('accepts the owning contexts’ first-party asset routes', () => {
    for (const path of [
      '/assets/media/posters/0b8f/9c1d',
      '/assets/library/covers/editions/a%20b/c',
      '/assets/editorial/news/abc/def',
    ])
      expect(firstPartyImagePath(path), path).toBe(path);
  });

  it('refuses everything that would step around the route’s own check', () => {
    for (const path of [
      'https://example.com/a.jpg',
      '//example.com/a.jpg',
      'data:image/png;base64,AAAA',
      'javascript:alert(1)',
      '/assets/../api/secret',
      '/assets/media/%2e%2e/x',
      '/assets/media/a%2Fb',
      '/assets/media/a%5Cb',
      '/assets/media/a b',
      '/assets/media/a,b 2w',
      '/assets/',
      '/public/a.jpg',
      '',
    ])
      expect(firstPartyImagePath(path), path).toBeNull();
  });

  it('builds a srcset of first-party derivatives only, narrowest first, each width once', () => {
    expect(
      imageSrcSet([
        { src: '/assets/x/960', width: 960 },
        { src: 'https://cdn.example/320', width: 320 },
        { src: '/assets/x/320', width: 320 },
        { src: '/assets/x/320b', width: 320 },
        { src: '/assets/x/0', width: 0 },
        { src: '/assets/x/1.5', width: 1.5 },
      ]),
    ).toBe('/assets/x/320 320w, /assets/x/960 960w');
    expect(imageSrcSet([{ src: 'https://cdn.example/a', width: 640 }])).toBeUndefined();
    expect(imageSrcSet(undefined)).toBeUndefined();
  });

  it('renders no image at all for a refused source', () => {
    expect(
      ResponsiveImage({ path: 'https://example.com/a.jpg', alt: '', aspect: '16/9' }),
    ).toBeNull();
    expect(all(expand(Poster({ path: '//example.com/a.jpg', alt: '' })), 'img')).toEqual(
      [],
    );
  });

  it('fills a fixed box edge to edge, lazily unless it is the priority image', () => {
    const [lazy] = all(
      expand(ResponsiveImage({ path: '/assets/a/b', alt: '', aspect: '16/9' })),
      'img',
    );
    expect(lazy?.props.loading).toBe('lazy');
    expect(String(lazy?.props.className)).toContain('size-full');
    expect(String(lazy?.props.className)).toContain('object-cover');
    expect(lazy?.props.srcSet).toBeUndefined();

    const [eager] = all(
      expand(
        ResponsiveImage({
          path: '/assets/a/b',
          alt: 'A caption',
          aspect: '16/9',
          priority: true,
          derivatives: [{ src: '/assets/a/b-640', width: 640 }],
          sizes: '50vw',
        }),
      ),
      'img',
    );
    expect(eager?.props.loading).toBe('eager');
    expect(eager?.props.fetchPriority).toBe('high');
    expect(eager?.props.srcSet).toBe('/assets/a/b-640 640w');
    expect(eager?.props.sizes).toBe('50vw');
  });

  it('shows a cover whole rather than cropping it', () => {
    const [img] = all(expand(Cover({ path: '/assets/c/d', alt: '' })), 'img');
    expect(String(img?.props.className)).toContain('object-contain');
  });
});

describe('cards', () => {
  const href = '/watch/videos/example';

  it('hold exactly one link, named by the title', () => {
    for (const card of [
      MediaCard({
        href,
        title: 'A title',
        type: 'Video',
        language: { label: 'Urdu', code: 'ur' },
        meta: ['12 May 2026'],
        image: { path: '/assets/media/posters/a/b' },
      }),
      MediaCard({ href, title: 'No picture', meta: ['x'] }),
      EditorialCard({ variant: 'lead', href, title: 'Lead', description: 'Standfirst' }),
      EditorialCard({ variant: 'compact', href, title: 'Compact' }),
      ListRow({ href, title: 'Row', trailing: '3', image: { path: '/assets/a/b' } }),
    ]) {
      const links = all(expand(card), 'a');
      expect(links).toHaveLength(1);
      expect(links[0]?.props.href).toBe(href);
      expect(links[0]?.props.children).not.toBeUndefined();
    }
  });

  it('show no picture box when the record has no picture', () => {
    expect(all(expand(MediaCard({ href, title: 'T', image: null })), 'img')).toEqual([]);
    expect(all(expand(EditorialCard({ href, title: 'T' })), 'img')).toEqual([]);
  });

  it('mark the title’s own language and direction when it is content', () => {
    const [heading] = all(
      expand(MediaCard({ href, title: 'عنوان', lang: 'ur', dir: 'rtl' })),
      'h3',
    );
    expect(heading?.props.lang).toBe('ur');
    expect(heading?.props.dir).toBe('rtl');
  });
});

describe('the pager', () => {
  it('shows every page up to seven, otherwise the ends and the neighbours', () => {
    expect(pagerWindow(3, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(pagerWindow(1, 10)).toEqual([1, 2, 3, 4, 5, 'gap', 10]);
    expect(pagerWindow(5, 10)).toEqual([1, 'gap', 4, 5, 6, 'gap', 10]);
    expect(pagerWindow(10, 10)).toEqual([1, 'gap', 6, 7, 8, 9, 10]);
    // An out-of-range request is clamped, never a page that does not exist.
    expect(pagerWindow(99, 3)).toEqual([1, 2, 3]);
    expect(pagerWindow(1, 0)).toEqual([]);
  });

  const labels = { label: 'Pages', previousLabel: 'Previous', nextLabel: 'Next' };

  it('renders nothing for a single page', () => {
    expect(Pager({ ...labels, previous: null, next: null })).toBeNull();
  });

  it('links only the pages that exist, and marks the current one without linking it', () => {
    const tree = expand(
      Pager({
        ...labels,
        previous: '?page=4',
        next: '?page=6',
        pages: {
          current: 5,
          total: 10,
          href: (page) => `?page=${String(page)}`,
          label: (page) => `Page ${String(page)}`,
        },
      }),
    );
    const hrefs = all(tree, 'a').map((link) => link.props.href);
    expect(hrefs).toEqual([
      '?page=4',
      '?page=1',
      '?page=4',
      '?page=6',
      '?page=10',
      '?page=6',
    ]);
    const current = all(tree, 'span').filter(
      (span) => span.props['aria-current'] === 'page',
    );
    expect(current).toHaveLength(1);
    expect(current[0]?.props['aria-label']).toBe('Page 5');
  });
});
