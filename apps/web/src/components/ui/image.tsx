import { derivativeSources } from './image-derivatives';
import { firstPartyImagePath, imageSrcSet, type ImageSource } from './image-source';

export type { ImageSource } from './image-source';

/**
 * RESPONSIVE IMAGES (R2) — one box, one picture, no layout shift.
 *
 * THE BOX OWNS THE SHAPE. A fixed aspect ratio is reserved before a byte
 * arrives and the picture fills it edge to edge (`width: 100%`, `object-fit`),
 * so a card never shows a strip of picture narrower than the card (audit F11)
 * and a grid of mixed originals reads as one grid.
 *
 * FIRST-PARTY ONLY. Every address, and every derivative, must be an
 * `/assets/…` route of the owning context (`./image-source`); anything else
 * renders no image at all. A public picture route's WebP derivatives are
 * offered automatically when its `width` is known (`./image-derivatives`).
 *
 * LAZY BY DEFAULT; `priority` for the one picture above the fold (eager, high
 * fetch priority). Never a CSS background, never an inline style — the
 * Content-Security-Policy refuses inline styles, and an `<img>` keeps its
 * alternative text.
 *
 * Usage:
 *   <Poster path={videoPosterPath(id, assetId)} alt="" sizes="(min-width: 64rem) 25vw, 50vw" />
 *   <Cover path={editionCoverPath(id, assetId)} alt="" shape="book" />
 */

const ASPECTS = {
  '16/9': 'aspect-[16/9]',
  '21/9': 'aspect-[21/9]',
  '3/2': 'aspect-[3/2]',
  '2/3': 'aspect-[2/3]',
  '3/4': 'aspect-[3/4]',
  '4/5': 'aspect-[4/5]',
  '1/1': 'aspect-square',
} as const;

const RADII = {
  none: '',
  control: 'rounded-control',
  panel: 'rounded-panel',
  full: 'rounded-full',
} as const;

export interface ResponsiveImageProps {
  /** The first-party address of the image (or its largest rendition). */
  readonly path: string;
  /** Empty for a decorative picture beside a title that already names it. */
  readonly alt: string;
  readonly aspect: keyof typeof ASPECTS;
  /** The original's pixel size, when known: a hint for the browser's decoder. */
  readonly width?: number;
  readonly height?: number;
  /** How wide the box renders, for choosing among `srcSet` derivatives. */
  readonly sizes?: string;
  /** Optional derivatives, each a first-party address and its pixel width. */
  readonly derivatives?: readonly ImageSource[];
  /** The one above-the-fold picture: eager, high priority. */
  readonly priority?: boolean;
  /** `cover` crops to the box; `contain` shows the whole picture (a book jacket). */
  readonly fit?: 'cover' | 'contain';
  readonly radius?: keyof typeof RADII;
  /** The language of the alternative text, when it is content. */
  readonly lang?: string;
  readonly className?: string;
}

export function ResponsiveImage({
  path: requested,
  alt,
  aspect,
  width,
  height,
  sizes,
  derivatives,
  priority = false,
  fit = 'cover',
  radius = 'control',
  lang,
  className = '',
}: ResponsiveImageProps) {
  const path = firstPartyImagePath(requested);
  if (path === null) return null;
  // A public picture's WebP derivatives come with it, from its own address
  // and recorded width (`./image-derivatives`), unless a caller names others.
  const set = imageSrcSet(derivatives ?? derivativeSources(path, width));

  return (
    <span
      className={`relative block w-full overflow-hidden bg-surface-sunken ${ASPECTS[aspect]} ${RADII[radius]} ${className}`}
    >
      <img
        src={path}
        alt={alt}
        {...(alt !== '' && lang !== undefined ? { lang } : {})}
        {...(width === undefined || height === undefined ? {} : { width, height })}
        {...(set === undefined ? {} : { srcSet: set, sizes: sizes ?? '100vw' })}
        loading={priority ? 'eager' : 'lazy'}
        {...(priority ? { fetchPriority: 'high' as const } : {})}
        decoding="async"
        className={`absolute inset-0 size-full ${fit === 'cover' ? 'object-cover' : 'object-contain'}`}
      />
    </span>
  );
}

type Framed = Omit<ResponsiveImageProps, 'aspect'>;

/** A video's poster: 16:9, cropped to fill. */
export function Poster(props: Framed) {
  return <ResponsiveImage {...props} aspect="16/9" />;
}

/**
 * A publication's cover: 2:3 for a book, 3:4 for a magazine issue. Shown whole
 * (`contain`) by default — a jacket is never cropped into a different book.
 */
export function Cover({
  shape = 'book',
  fit = 'contain',
  ...props
}: Framed & { readonly shape?: 'book' | 'magazine' }) {
  return (
    <ResponsiveImage {...props} fit={fit} aspect={shape === 'book' ? '2/3' : '3/4'} />
  );
}

/** A person's portrait: square (and round, for an avatar) or 4:5. */
export function Portrait({
  shape = 'square',
  ...props
}: Framed & { readonly shape?: 'square' | 'round' | 'tall' }) {
  return (
    <ResponsiveImage
      {...props}
      aspect={shape === 'tall' ? '4/5' : '1/1'}
      {...(shape === 'round' ? { radius: 'full' as const } : {})}
    />
  );
}
