import type { ReactNode } from 'react';

import { RecitationHost } from '@/components/quran/recitation-host';
import { requireLocale } from '@/config/route-locale';

/**
 * THE QURAN SECTION'S LAYOUT (Quran Part 5) — every `/quran/**` page, and the
 * recitation player that outlives them.
 *
 * A layout is kept across client navigations beneath it, so the dock it mounts
 * keeps playing while the reader moves from a Surah to a Juz, an Ayah or the
 * search page; leaving the Quran section ends it. The pages themselves are
 * unchanged — the dock is beside them, not around them — and without
 * JavaScript nothing here renders but the pages.
 *
 * PUBLIC DATA ONLY, the same for every visitor: the public recitation
 * catalogue, never the visitor (ARCHITECTURE.md §8.1).
 */
export const dynamic = 'force-dynamic';

export default async function QuranLayout({
  children,
  params,
}: {
  readonly children: ReactNode;
  readonly params: Promise<{ readonly locale: string }>;
}) {
  const locale = await requireLocale(params);
  return (
    <>
      {children}
      <RecitationHost locale={locale} />
    </>
  );
}
