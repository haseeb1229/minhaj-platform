import type { ReactNode } from 'react';

import type { CardImage } from './cards';
import { ResponsiveImage } from './image';
import { Container } from './layout';

/**
 * THE OPENING OF A PAGE FAMILY (R2): the page's ONE `h1`, a lede, actions,
 * and — when the family has one — a real picture from the corpus.
 *
 *   `plain`  words only, on the page surface: a listing or a utility page.
 *   `split`  words at the inline start, the picture (or an `aside`) at the
 *            inline end from a laptop up; stacked below on a phone.
 *   `banner` the picture full width, the words on a raised panel that
 *            overlaps its lower edge: a landing that opens with one image.
 *
 * `tone="ink"` sets the band on the deep ink surface (the home portal). The
 * picture is always the above-the-fold image, so it loads eagerly. A family
 * without a real picture uses `plain` — never a stock image.
 */
export function Hero({
  variant = 'plain',
  tone = 'plain',
  title,
  lede,
  actions,
  image,
  aside,
  children,
  lang,
  dir,
}: {
  readonly variant?: 'plain' | 'split' | 'banner';
  readonly tone?: 'plain' | 'ink';
  readonly title: ReactNode;
  readonly lede?: ReactNode;
  /** Links, usually one primary and at most one secondary. */
  readonly actions?: ReactNode;
  /** The picture (`split`, `banner`). */
  readonly image?: CardImage | null;
  /** Something other than a picture at the inline end (`split` only). */
  readonly aside?: ReactNode;
  /** Anything that belongs in the band below the actions, such as a search. */
  readonly children?: ReactNode;
  /** The title's language and direction, when it is content. */
  readonly lang?: string;
  readonly dir?: 'ltr' | 'rtl';
}) {
  const ink = tone === 'ink';
  const pictured = image !== undefined && image !== null;
  const content = {
    ...(lang === undefined ? {} : { lang }),
    ...(dir === undefined ? {} : { dir }),
  };

  const words = (
    <div className="flex max-w-3xl min-w-0 flex-col gap-5">
      <h1
        className={`font-semibold tracking-[var(--tracking-display)] text-balance wrap-anywhere ${
          ink || variant !== 'plain' ? 'text-display' : 'text-title'
        }`}
        {...content}
      >
        {title}
      </h1>
      {lede === undefined ? null : (
        <p
          className={`text-lede max-w-[var(--measure-prose)] ${ink ? 'text-ink-muted' : 'text-foreground-muted'}`}
        >
          {lede}
        </p>
      )}
      {actions === undefined ? null : (
        <div className="flex flex-wrap items-center gap-3 pt-1">{actions}</div>
      )}
      {children}
    </div>
  );

  const picture = (aspect: '16/9' | '3/2') =>
    pictured ? (
      <ResponsiveImage
        path={image.path}
        alt={image.alt ?? ''}
        aspect={aspect}
        // A banner widens to 21:9 from a tablet up — one image, one request.
        {...(variant === 'banner' ? { className: 'md:aspect-[21/9]' } : {})}
        radius={variant === 'banner' ? 'none' : 'panel'}
        priority
        sizes={variant === 'banner' ? '100vw' : '(min-width: 64rem) 45vw, 100vw'}
        {...(image.width === undefined ? {} : { width: image.width })}
        {...(image.height === undefined ? {} : { height: image.height })}
        {...(image.derivatives === undefined ? {} : { derivatives: image.derivatives })}
      />
    ) : null;

  const band = ink
    ? 'surface-ink border-b-4 border-ink-accent'
    : 'border-b border-border';

  if (variant === 'banner')
    return (
      <div className={band}>
        {pictured ? (
          <div className="mx-auto w-full max-w-[96rem]">{picture('16/9')}</div>
        ) : null}
        <Container>
          <div
            className={`pb-[var(--space-section)] ${pictured ? '' : 'pt-[var(--space-section)]'}`}
          >
            {pictured ? (
              <div
                className={`relative -mt-12 rounded-panel p-6 shadow-raised sm:-mt-20 sm:p-8 md:max-w-3xl ${ink ? 'bg-ink-raised' : 'bg-surface-raised'}`}
              >
                {words}
              </div>
            ) : (
              words
            )}
          </div>
        </Container>
      </div>
    );

  if (variant === 'split')
    return (
      <div className={band}>
        <Container>
          <div className="grid grid-cols-1 items-center gap-x-12 gap-y-8 py-[var(--space-section)] lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
            {words}
            {pictured ? (
              picture('3/2')
            ) : aside === undefined ? null : (
              <div className="min-w-0">{aside}</div>
            )}
          </div>
        </Container>
      </div>
    );

  return (
    <div className={band}>
      <Container>
        <div className="py-[var(--space-section)]">{words}</div>
      </Container>
    </div>
  );
}
