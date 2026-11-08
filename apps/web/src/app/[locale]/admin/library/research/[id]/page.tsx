import { ScholarlyEditor } from '../../scholarly';
import { adminPageMetadata } from '../../../metadata';

/**
 * `/{locale}/admin/library/research/{id}` — editing one research work, under the
 * version the form was rendered from, so a stale save is a conflict.
 */
export const generateMetadata = adminPageMetadata('admin', 'titles.library.research');
export const dynamic = 'force-dynamic';

export default function ResearchEditor(props: {
  readonly params: Promise<{ readonly locale: string; readonly id: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <ScholarlyEditor kind="research" {...props} />;
}
