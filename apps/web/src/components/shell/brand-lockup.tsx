import logo from '@/shell/brand/mqi-logo.png';
import { ORGANISATION_NAME } from '@/shell/product';

/**
 * THE ORGANISATION'S MARK — the current official Minhaj-ul-Quran International
 * logo, exactly as minhaj.org publishes it (owner-authorised pre-adoption brand
 * evidence, OPEN_DECISIONS.md §6.4).
 *
 * UNMODIFIED AND SECONDARY (Rebaseline R1). It is never redrawn, recoloured or
 * cropped, and it no longer leads the header: the product is identified by the
 * One Minhaj wordmark, and this mark appears once, in the footer, beside the
 * statement that the platform is independently developed and not an official
 * service of the organisation. It sits on its own light tile because it was
 * drawn for a light background.
 */
export function OrganisationMark() {
  return (
    <img
      src={logo.src}
      width={logo.width}
      height={logo.height}
      alt={ORGANISATION_NAME}
      decoding="async"
      loading="lazy"
      className="block h-8 w-auto max-w-full"
    />
  );
}
