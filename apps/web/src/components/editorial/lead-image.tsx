import { leadImagePath, type PublicLeadImage } from '@minhaj/contracts/editorial';

import type { CardImage } from '@/components/ui/cards';
import { derivativeSrcSet } from '@/components/ui/image-derivatives';

/** A card's picture: a full-width column on a phone, a third of a laptop's row. */
const CARD_SIZES = '(min-width: 64rem) 22rem, (min-width: 40rem) 50vw, 100vw';

/** A record page's hero: the reading column (`max-w-4xl`, 56rem) at most. */
const FIGURE_SIZES = '(min-width: 56rem) 56rem, 100vw';

/**
 * An Editorial record's LEAD IMAGE (Phase 30-R) — a first-party stored asset,
 * always through Editorial's own byte route, never a remote address.
 *
 * NO LAYOUT SHIFT. The measured box travels with the image, so the browser
 * reserves its space before a byte arrives. A card crops to one stable ratio;
 * a record page shows the whole picture at its own proportions.
 *
 * THE WORDS ARE THE SOURCE'S. The alternative text is the record's own, per
 * language; an EMPTY one makes the picture decorative (`alt=""`) rather than
 * inventing a description. A credit is shown only where one is recorded.
 *
 * A record WITHOUT an image renders none of this — never a grey box, a stock
 * picture or a placeholder.
 */

/**
 * A card's picture: cropped to 16:9 above the card's words, lazily loaded — or,
 * for the one featured story above the fold, loaded first (`priority`).
 */
export function LeadThumbnail({
  image,
  alt,
  lang,
  priority = false,
  className = '',
}: {
  readonly image: PublicLeadImage;
  readonly alt: string;
  readonly lang: string;
  readonly priority?: boolean;
  readonly className?: string;
}) {
  const path = leadImagePath(image);
  const srcSet = derivativeSrcSet(path, image.width);
  return (
    <img
      src={path}
      {...(srcSet === undefined ? {} : { srcSet, sizes: CARD_SIZES })}
      alt={alt}
      {...(alt === '' ? {} : { lang })}
      width={image.width}
      height={image.height}
      loading={priority ? 'eager' : 'lazy'}
      {...(priority ? { fetchPriority: 'high' as const } : {})}
      decoding="async"
      className={`aspect-[16/9] w-full bg-surface-sunken object-cover ${className}`}
    />
  );
}

/**
 * A record page's hero: the whole image at its own proportions — the measured
 * `width` and `height` reserve its box, so no inline style is needed (the CSP
 * refuses one) — loaded first because it is the page's largest picture, with
 * its credit as a caption.
 */
export function LeadFigure({
  image,
  alt,
  lang,
  caption,
}: {
  readonly image: PublicLeadImage;
  readonly alt: string;
  readonly lang: string;
  /** The credit line, already worded in the interface language, or null. */
  readonly caption: string | null;
}) {
  const path = leadImagePath(image);
  const srcSet = derivativeSrcSet(path, image.width);
  return (
    <figure className="flex max-w-4xl flex-col gap-2">
      <img
        src={path}
        {...(srcSet === undefined ? {} : { srcSet, sizes: FIGURE_SIZES })}
        alt={alt}
        {...(alt === '' ? {} : { lang })}
        width={image.width}
        height={image.height}
        loading="eager"
        fetchPriority="high"
        decoding="async"
        className="h-auto max-h-[36rem] w-full rounded-panel bg-surface-sunken object-contain"
      />
      {caption === null ? null : (
        <figcaption className="text-caption text-foreground-muted" dir="auto">
          {caption}
        </figcaption>
      )}
    </figure>
  );
}

/**
 * R2 — the same lead image as the shared cards take it (`EditorialCard`,
 * `ListRow`, `MediaCard`): Editorial's own first-party address and its measured
 * box, never a remote one. Each card crops it to its own ratio.
 */
export function leadCardImage(image: PublicLeadImage, alt: string): CardImage {
  return {
    path: leadImagePath(image),
    alt,
    width: image.width,
    height: image.height,
  };
}
