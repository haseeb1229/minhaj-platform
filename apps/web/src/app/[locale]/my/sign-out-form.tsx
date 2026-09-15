import { Button } from '@/components/ui';
import { signOutAction } from '../(identity)/actions';

/**
 * Sign out.
 *
 * A POST form bound to a Server Action — never a link, and never a GET route.
 * A GET that mutates session state can be triggered by any image tag or link
 * prefetch, which is why `/signout` does not exist (ROUTE_MAP.md §2.4).
 */
export function SignOutForm({
  locale,
  label,
}: {
  readonly locale: string;
  readonly label: string;
}) {
  return (
    <form action={signOutAction}>
      <input type="hidden" name="locale" value={locale} />
      <Button tone="secondary">{label}</Button>
    </form>
  );
}
