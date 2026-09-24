import { ScholarlyDirectory } from '../scholarly';

/**
 * `/{locale}/admin/library/research` — the Research directory and its create form
 * (ROUTE_MAP.md §7). `library.read` opens it; the action re-checks
 * `library.administer`. Private, `noindex` and `no-store` through the layouts.
 */
export const dynamic = 'force-dynamic';

export default function ResearchDirectory(props: {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <ScholarlyDirectory kind="research" {...props} />;
}
