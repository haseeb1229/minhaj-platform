import { IssueEditor } from '../../../../scholarly';

/**
 * `/{locale}/admin/library/magazines/{id}/issues/{issueId}` — editing one issue
 * beneath its Magazine. An issue addressed under another Magazine is a 404.
 */
export const dynamic = 'force-dynamic';

export default function MagazineIssueEditor(props: {
  readonly params: Promise<{
    readonly locale: string;
    readonly id: string;
    readonly issueId: string;
  }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <IssueEditor {...props} />;
}
