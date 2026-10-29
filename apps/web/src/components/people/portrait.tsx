import type { PersonPortrait } from '@minhaj/contracts/people';

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
  return (
    <figure className={`m-0 flex flex-col gap-2 ${className}`}>
      <img
        src={portraitPath(personId, portrait.assetId)}
        width={portrait.width}
        height={portrait.height}
        alt={name}
        lang={nameLocale}
        loading={priority ? 'eager' : 'lazy'}
        decoding="async"
        {...(priority ? { fetchPriority: 'high' as const } : {})}
        className="aspect-[3/4] h-auto w-full rounded-[var(--radius-panel)] bg-[color:var(--color-surface-sunken)] object-cover object-top"
      />
      {portrait.credit === null ? null : (
        <figcaption
          className="text-caption text-[color:var(--color-foreground-muted)]"
          dir="auto"
        >
          {creditLabel}: {portrait.credit}
        </figcaption>
      )}
    </figure>
  );
}
