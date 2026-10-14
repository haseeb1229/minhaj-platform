import { personalTargetSchema } from '@minhaj/contracts/personalisation';

import { appLogger } from '@/composition/logging';
import { personalisationRuntime } from '@/composition/personalisation';
import { personalFailure } from '@/contexts/personalisation-notifications';
import { answer, failed, isPrivateRead, readActor } from '../personal-transport';

/**
 * `GET /api/my/target-state?kind=…&id=…` (or `kind=ayah&surah=…&ayah=…`) —
 * the person's own state for ONE public target, read by the private island
 * after the shared public page has rendered (ARCHITECTURE.md §8.2).
 *
 * READ-ONLY. It changes nothing, so it is a GET; it is still private,
 * `no-store` and unindexed, and a cross-site embed is refused.
 *
 * SIGNED OUT IS AN ANSWER, NOT AN ERROR: `{ signedIn: false }`, never a
 * redirect, so the island can offer "sign in to save" and the page never
 * breaks. Signed in, the state is the session account's and nobody else's.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const KEYS: Readonly<Record<string, readonly string[]>> = {
  ayah: ['kind', 'surah', 'ayah'],
  article: ['kind', 'id'],
  work: ['kind', 'id'],
  video: ['kind', 'id'],
  hadith: ['kind', 'id'],
};

/** A canonical positive integer as written in an address, or `null`. */
function count(value: string): number | null {
  return /^[1-9][0-9]{0,2}$/.test(value) ? Number(value) : null;
}

/**
 * The target the query names, or `null`. Exactly the keys its kind uses, each
 * once — a repeated or unexpected parameter is not a target.
 */
function targetOf(query: URLSearchParams): unknown {
  const kind = query.get('kind');
  const keys = kind === null ? undefined : KEYS[kind];
  if (keys === undefined) return null;

  const present = [...query.keys()];
  if (present.length !== keys.length || !keys.every((key) => present.includes(key)))
    return null;

  if (kind === 'ayah') {
    const surah = count(query.get('surah') ?? '');
    const ayah = count(query.get('ayah') ?? '');
    return surah === null || ayah === null ? null : { kind, surah, ayah };
  }
  return { kind, id: query.get('id') };
}

export async function GET(request: Request): Promise<Response> {
  if (!isPrivateRead(request)) return failed('denied');

  const target = personalTargetSchema.safeParse(
    targetOf(new URL(request.url).searchParams),
  );
  if (!target.success) return failed('invalid');

  const resolved = await readActor('personal-target-state');
  if ('refused' in resolved) return resolved.refused;
  if (resolved.actor === null) return answer(200, { signedIn: false });

  try {
    const state = await personalisationRuntime().settings.targetState(
      resolved.actor,
      target.data,
    );
    return answer(200, { signedIn: true, state });
  } catch (error) {
    const failure = personalFailure(error);
    if (failure === 'unavailable')
      appLogger().error(
        { operation: 'personal-target-state' },
        'Personal state read failed.',
      );
    return failed(failure);
  }
}
