import { leadImagePath, type PublicLeadImage } from '@minhaj/contracts/editorial';

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
  return (
    <img
      src={leadImagePath(image)}
      alt={alt}
      {...(alt === '' ? {} : { lang })}
      width={image.width}
      height={image.height}
      loading={priority ? 'eager' : 'lazy'}
      {...(priority ? { fetchPriority: 'high' as const } : {})}
      decoding="async"
      className={`aspect-[16/9] w-full bg-[color:var(--color-surface-sunken)] object-cover ${className}`}
    />
  );
}

/**
 * A record page's hero: the whole image at its own proportions, loaded first
 * because it is the page's largest picture, with its credit as a caption.
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
  return (
    <figure className="flex max-w-4xl flex-col gap-2">
      <img
        src={leadImagePath(image)}
        alt={alt}
        {...(alt === '' ? {} : { lang })}
        width={image.width}
        height={image.height}
        loading="eager"
        fetchPriority="high"
        decoding="async"
        style={{ aspectRatio: `${String(image.width)} / ${String(image.height)}` }}
        className="h-auto max-h-[36rem] w-full rounded-[var(--radius-panel)] bg-[color:var(--color-surface-sunken)] object-contain"
      />
      {caption === null ? null : (
        <figcaption
          className="text-caption text-[color:var(--color-foreground-muted)]"
          dir="auto"
        >
          {caption}
        </figcaption>
      )}
    </figure>
  );
}
