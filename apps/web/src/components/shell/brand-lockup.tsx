import logo from '@/shell/brand/mqi-logo.png';
import { ORGANISATION_NAME } from '@/shell/product';

/**
 * THE BRAND LOCKUP — the organisation's CURRENT official logo and wordmark,
 * exactly as minhaj.org publishes it (Phase 30-R; OPEN_DECISIONS.md §6.4).
 *
 * PROVISIONAL, PRE-ADOPTION, OWNER-AUTHORISED. The file is the official PNG
 * with only its editing metadata removed — never redrawn, recoloured, cropped
 * or re-proportioned — and it stands here as brand EVIDENCE for the review
 * build. The organisation's accepted brand pack (variants, palette, typefaces,
 * guidelines) remains open, and supplying it later replaces this file.
 *
 * ONE ACCESSIBLE NAME. The picture IS the organisation's name, so its `alt` is
 * that name; the link around it adds only its destination for assistive
 * technology. Its intrinsic size is given, so it never shifts the row, and its
 * height is set per breakpoint with the width following the official ratio.
 */
export function BrandLockup({ placement }: { readonly placement: 'header' | 'footer' }) {
  return (
    <img
      src={logo.src}
      width={logo.width}
      height={logo.height}
      alt={ORGANISATION_NAME}
      decoding="async"
      {...(placement === 'header'
        ? { fetchPriority: 'high' as const }
        : { loading: 'lazy' as const })}
      className={
        placement === 'header'
          ? 'block h-7 w-auto max-w-full min-[22rem]:h-8 sm:h-10 lg:h-11'
          : 'block h-8 w-auto max-w-full sm:h-10'
      }
    />
  );
}
