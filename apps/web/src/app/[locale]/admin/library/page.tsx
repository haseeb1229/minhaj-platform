import { enterArea } from '../area-root';

/** `/{locale}/admin/library`: the area's first surface the reader may open (`../area-root`). */
export const dynamic = 'force-dynamic';

export default function LibraryAdminRoot({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}) {
  return enterArea(params, 'library');
}
