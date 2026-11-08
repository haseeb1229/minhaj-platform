import { enterArea } from '../area-root';

/** `/{locale}/admin/quran`: the area's first surface the reader may open (`../area-root`). */
export const dynamic = 'force-dynamic';

export default function QuranAdminRoot({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}) {
  return enterArea(params, 'quran');
}
