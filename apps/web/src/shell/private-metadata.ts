import type { Metadata } from 'next';

import { PRODUCT_NAME } from '@/shell/product';

/**
 * THE PRIVATE AREAS' TITLE PATTERN (Rebaseline R1).
 *
 * Every page beneath My Minhaj, Teaching and Administration is titled with its
 * area — "My Minhaj · One Minhaj" — instead of the bare product name, and a page
 * that names itself reads "Saved · My Minhaj · One Minhaj". Private surfaces are
 * never indexed: each area's layout passes its own `robots`, so the noindex is
 * visible at the surface. The layout supplies the translated area name.
 */
export function privateAreaMetadata(area: string, base: Metadata): Metadata {
  return {
    ...base,
    title: {
      absolute: `${area} · ${PRODUCT_NAME}`,
      template: `%s · ${area} · ${PRODUCT_NAME}`,
    },
  };
}
