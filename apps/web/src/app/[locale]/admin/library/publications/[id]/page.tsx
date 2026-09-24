import { ScholarlyEditor } from '../../scholarly';

/**
 * `/{locale}/admin/library/publications/{id}` — editing one publication, under the
 * version the form was rendered from, so a stale save is a conflict.
 */
export const dynamic = 'force-dynamic';

export default function PublicationEditor(props: {
  readonly params: Promise<{ readonly locale: string; readonly id: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <ScholarlyEditor kind="publication" {...props} />;
}
