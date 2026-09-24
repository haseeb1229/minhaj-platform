import { ScholarlyEditor } from '../../scholarly';

/**
 * `/{locale}/admin/library/magazines/{id}` — editing one magazine — and its issues —, under the
 * version the form was rendered from, so a stale save is a conflict.
 */
export const dynamic = 'force-dynamic';

export default function MagazineEditor(props: {
  readonly params: Promise<{ readonly locale: string; readonly id: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <ScholarlyEditor kind="magazine" {...props} />;
}
