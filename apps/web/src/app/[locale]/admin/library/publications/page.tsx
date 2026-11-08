import { ScholarlyDirectory } from '../scholarly';
import { adminPageMetadata } from '../../metadata';

/**
 * `/{locale}/admin/library/publications` — the Publication directory and its create form
 * (ROUTE_MAP.md §7). `library.read` opens it; the action re-checks
 * `library.administer`. Private, `noindex` and `no-store` through the layouts.
 */
export const generateMetadata = adminPageMetadata('library', 'admin.publications');
export const dynamic = 'force-dynamic';

export default function PublicationDirectory(props: {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <ScholarlyDirectory kind="publication" {...props} />;
}
