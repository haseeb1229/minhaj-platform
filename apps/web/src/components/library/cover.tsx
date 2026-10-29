import type { ReactNode } from 'react';

import type { LibraryCover } from '@minhaj/contracts/library';

/**
 * Library covers (Phase 30-R) — an Edition's or a magazine issue's own image.
 *
 * THE ADDRESS NAMES THE RECORD AND THE ASSET, and Library's route serves it
 * only while that record is public and that asset is still its cover. Never a
 * remote URL. Replacing a cover changes the address.
 */
export function editionCoverPath(editionId: string, assetId: string): string {
  return `/assets/library/covers/editions/${encodeURIComponent(editionId)}/${encodeURIComponent(assetId)}`;
}

export function issueCoverPath(issueId: string, assetId: string): string {
  return `/assets/library/covers/issues/${encodeURIComponent(issueId)}/${encodeURIComponent(assetId)}`;
}

/**
 * The cover itself. Its measured box is reserved before a byte arrives, so the
 * page never shifts, and `object-contain` on a calm surface shows the whole
 * cover — a book jacket is never cropped into a different book. DECORATIVE in
 * a card, whose title already names the work (an empty `alt`, so a screen
 * reader does not read the title twice); described on a detail page.
 */
export function CoverImage({
  path,
  cover,
  alt,
  priority = false,
  className = '',
}: {
  readonly path: string;
  readonly cover: LibraryCover;
  /** Empty in a card that names the record already. */
  readonly alt: string;
  /** Eager, high-priority loading for a detail page's hero; lazy elsewhere. */
  readonly priority?: boolean;
  readonly className?: string;
}) {
  return (
    <img
      src={path}
      width={cover.width}
      height={cover.height}
      alt={alt}
      loading={priority ? 'eager' : 'lazy'}
      decoding="async"
      {...(priority ? { fetchPriority: 'high' as const } : {})}
      className={`block h-auto w-full rounded-[var(--radius-control)] border border-[color:var(--color-border)] bg-[color:var(--color-surface-sunken)] object-contain shadow-[var(--shadow-panel)] ${className}`}
    />
  );
}

/**
 * A card that is ONE link, with a cover at its start.
 *
 * The same whole-card-link contract as `LinkCard`: the heading holds the only
 * anchor and the `card-link` rule stretches it over the card. The cover sits
 * at the inline START (left in English, right in Urdu and Arabic, by logical
 * layout) beside the words, so a page of books reads as a shelf. A record
 * WITHOUT a cover is rendered by the caller's text-first card — never by an
 * empty grey box standing in for a picture.
 */
export function CoverCard({
  href,
  title,
  description,
  meta,
  cover,
  headingLevel = 'h2',
  lang,
  dir,
}: {
  readonly href: string;
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly meta?: ReactNode;
  readonly cover: ReactNode;
  readonly headingLevel?: 'h2' | 'h3';
  readonly lang?: string;
  readonly dir?: 'ltr' | 'rtl';
}) {
  const Heading = headingLevel;
  const content = {
    ...(lang === undefined ? {} : { lang }),
    ...(dir === undefined ? {} : { dir }),
  };

  return (
    <li className="card-surface relative flex h-full min-w-0 gap-4 rounded-[var(--radius-panel)] border border-[color:var(--color-border)] bg-[color:var(--color-surface-raised)] p-4 shadow-[var(--shadow-panel)] transition-[border-color,box-shadow] duration-[var(--duration-fast)] hover:border-[color:var(--color-border-strong)] hover:shadow-[var(--shadow-raised)]">
      <div className="w-24 shrink-0 sm:w-28">{cover}</div>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <Heading className="text-subheading font-semibold wrap-anywhere" {...content}>
          <a
            href={href}
            className="card-link text-[color:var(--color-foreground)] no-underline decoration-[color:var(--color-accent-rule)] underline-offset-4 hover:underline active:text-[color:var(--color-action)]"
          >
            {title}
          </a>
        </Heading>
        {description === undefined || description === '' ? null : (
          <p
            className="line-clamp-4 text-sm wrap-anywhere text-[color:var(--color-foreground-muted)]"
            {...content}
          >
            {description}
          </p>
        )}
        {meta === undefined ? null : <div className="mt-auto pt-1">{meta}</div>}
      </div>
    </li>
  );
}

/**
 * Phase 30-R. A SHELF TILE: the cover ABOVE the title, as a shelf of books or a
 * rack of magazines reads at a glance — one link over the whole tile, the
 * title clamped to two lines whatever its script. A record without a cover is
 * a text-first tile with the same footprint: its title on a calm panel, never
 * a grey picture standing in for a cover.
 */
export function CoverTile({
  href,
  title,
  meta,
  cover,
  lang,
  dir,
}: {
  readonly href: string;
  readonly title: ReactNode;
  readonly meta?: ReactNode;
  /** The `CoverImage`, or null for a text-first tile. */
  readonly cover: ReactNode | null;
  readonly lang?: string;
  readonly dir?: 'ltr' | 'rtl';
}) {
  const content = {
    ...(lang === undefined ? {} : { lang }),
    ...(dir === undefined ? {} : { dir }),
  };
  return (
    <li className="card-surface relative flex min-w-0 flex-col gap-2">
      {cover === null ? (
        <div
          aria-hidden="true"
          className="flex aspect-[2/3] items-end rounded-[var(--radius-control)] border border-[color:var(--color-border)] bg-[color:var(--color-surface-sunken)] p-3"
        >
          <span
            className="line-clamp-5 text-sm font-semibold wrap-anywhere text-[color:var(--color-foreground-muted)]"
            {...content}
          >
            {title}
          </span>
        </div>
      ) : (
        <div className="flex aspect-[2/3] items-end justify-center">{cover}</div>
      )}
      <h3 className="text-sm leading-snug font-semibold wrap-anywhere" {...content}>
        <a
          href={href}
          className="card-link line-clamp-2 text-[color:var(--color-foreground)] no-underline decoration-[color:var(--color-accent-rule)] underline-offset-4 hover:underline active:text-[color:var(--color-action)]"
        >
          {title}
        </a>
      </h3>
      {meta === undefined ? null : (
        <p className="text-caption text-[color:var(--color-foreground-muted)]">{meta}</p>
      )}
    </li>
  );
}
