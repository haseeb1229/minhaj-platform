import { answer, failed, isPrivateRead, readActor } from '../personal-transport';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * WHETHER THIS BROWSER IS SIGNED IN — and nothing else (Rebaseline R1).
 *
 * The public shell is one document for every visitor and reads no session
 * (ARCHITECTURE.md §8), so its account entry cannot know who is signed in.
 * This private read lets the header's account island say "Sign in" or
 * "My Minhaj" after the page has rendered, exactly as the save islands learn
 * their state through `/api/my/target-state`.
 *
 * DATA-MINIMAL BY CONSTRUCTION. The answer is one boolean: no name, no email,
 * no identifier, no role and no permission. It is `private, no-store`,
 * same-origin only (a cross-site read is refused before the session is
 * resolved), and a signed-out browser receives an ordinary `200
 * { signedIn: false }` rather than an error, so the answer reveals nothing a
 * visitor could not learn by opening `/my`.
 */
export async function GET(request: Request): Promise<Response> {
  if (!isPrivateRead(request)) return failed('denied');

  const resolved = await readActor('account-state');
  if ('refused' in resolved) return resolved.refused;
  return answer(200, { signedIn: resolved.actor !== null });
}
