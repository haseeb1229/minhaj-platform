import type { PersonPortrait } from '@minhaj/contracts/people';

import { Icon, Portrait } from '@/components/ui';
import { derivativeSrcSet } from '@/components/ui/image-derivatives';

/**
 * A contributor's portrait (Phase 30-R).
 *
 * THE ADDRESS NAMES THE PERSON AND THE ASSET, and People's own route serves it
 * only while that Person is published and that asset is still their portrait —
 * never a remote URL and never an avatar service. Replacing the portrait
 * changes the address.
 */
export function portraitPath(personId: string, assetId: string): string {
  return `/assets/people/portraits/${encodeURIComponent(personId)}/${encodeURIComponent(assetId)}`;
}

/**
 * The image itself: its measured box is reserved before a byte arrives, so the
 * page never shifts; `object-cover` crops to the frame's aspect ratio without
 * distorting the face. The name is the alternative text — the image says who
 * this is, nothing more — and the credit, when the source states one, is the
 * caption beneath it.
 */
export function PersonPortraitFigure({
  personId,
  portrait,
  name,
  nameLocale,
  creditLabel,
  priority = false,
  className = '',
}: {
  readonly personId: string;
  readonly portrait: PersonPortrait;
  readonly name: string;
  readonly nameLocale: string;
  /** The localised word introducing a credit, e.g. "Photo". */
  readonly creditLabel: string;
  /** Eager, high-priority loading for a profile's hero; lazy everywhere else. */
  readonly priority?: boolean;
  readonly className?: string;
}) {
  const path = portraitPath(personId, portrait.assetId);
  const srcSet = derivativeSrcSet(path, portrait.width);
  return (
    <figure className={`m-0 flex flex-col gap-2 ${className}`}>
      <img
        src={path}
        // A profile's portrait column: never wider than 20rem.
        {...(srcSet === undefined
          ? {}
          : { srcSet, sizes: '(min-width: 48rem) 20rem, 100vw' })}
        width={portrait.width}
        height={portrait.height}
        alt={name}
        lang={nameLocale}
        loading={priority ? 'eager' : 'lazy'}
        decoding="async"
        {...(priority ? { fetchPriority: 'high' as const } : {})}
        className="aspect-[3/4] h-auto w-full rounded-panel bg-surface-sunken object-cover object-top"
      />
      {portrait.credit === null ? null : (
        <figcaption className="text-caption text-foreground-muted" dir="auto">
          {creditLabel}: {portrait.credit}
        </figcaption>
      )}
    </figure>
  );
}

/**
 * A person's mark in a directory (Library Part 2; shared with Watch Part 2's
 * speakers): their published portrait, round, or — without one — a tile with
 * the initial they are indexed under (a person icon when the name starts with
 * no letter). DECORATIVE: the name beside it says who this is, so the mark is
 * hidden from assistive technology and its portrait has empty alternative text.
 */
export function PersonMark({
  personId,
  portrait,
  letter,
  size = 'medium',
  own,
}: {
  readonly personId: string;
  readonly portrait: PersonPortrait | null;
  /** The initial the name is indexed under, or `#`. */
  readonly letter: string;
  readonly size?: 'small' | 'medium';
  /** The name's own `lang`/`dir`, so an initial is drawn in its script. */
  readonly own: { readonly lang?: string; readonly dir: 'ltr' | 'rtl' | 'auto' };
}) {
  const box = size === 'small' ? 'size-11' : 'size-16';
  return (
    <span aria-hidden="true" className={`block shrink-0 ${box}`}>
      {portrait === null ? (
        <span
          className={`flex ${box} items-center justify-center rounded-full border border-accent-rule bg-accent-surface font-serif font-semibold text-accent ${size === 'small' ? 'text-subheading' : 'text-heading'}`}
          {...own}
        >
          {letter === '#' ? (
            <Icon name="user" size={size === 'small' ? 20 : 24} />
          ) : (
            letter
          )}
        </span>
      ) : (
        <Portrait
          shape="round"
          path={portraitPath(personId, portrait.assetId)}
          width={portrait.width}
          height={portrait.height}
          sizes={size === 'small' ? '2.75rem' : '4rem'}
          alt=""
        />
      )}
    </span>
  );
}
