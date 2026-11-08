import { ScholarlyDirectory } from '../scholarly';
import { adminPageMetadata } from '../../metadata';

/**
 * `/{locale}/admin/library/encyclopedias` — the Encyclopedia directory and its create form
 * (ROUTE_MAP.md §7). `library.read` opens it; the action re-checks
 * `library.administer`. Private, `noindex` and `no-store` through the layouts.
 */
export const generateMetadata = adminPageMetadata('library', 'admin.encyclopedias');
export const dynamic = 'force-dynamic';

export default function EncyclopediaDirectory(props: {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <ScholarlyDirectory kind="encyclopedia" {...props} />;
}
