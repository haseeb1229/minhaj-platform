import 'server-only';

import type { z } from 'zod';

import { requireOwnSession } from '@/composition/authorization';
import { appLogger } from '@/composition/logging';
import { isSameOriginMutation } from '@/composition/same-origin';
import {
  personalFailure,
  type PersonalActor,
} from '@/contexts/personalisation-notifications';

/**
 * The transport every `/api/my/*` handler shares (ROUTE_MAP.md §8 "Personal")
 * — how a request is admitted, who it acts as, how its body is read and how a
 * refusal is answered.
 *
 * THESE HANDLERS SERVE THE PRIVATE ISLAND OF A PUBLIC PAGE. The page itself is
 * rendered identically for everybody and never reads a session
 * (ARCHITECTURE.md §8.1); the island asks these handlers after hydration, and
 * every answer here is private, `no-store` and unindexed (§8.3).
 *
 * ONE IMPLEMENTATION, so no handler can drift on the order of its checks:
 *
 *   1. a POST is a Class-A browser mutation — configured origin, Fetch
 *      Metadata and the `x-minhaj-intent: personal` header, checked BEFORE the
 *      session is consulted (SECURITY_BASELINE.md §7.1 rule 6);
 *   2. the actor is the resolved session's account and nothing else — no body
 *      field, query value or header names an account;
 *   3. a body is JSON, declared as such, bounded before and while it is read,
 *      and parsed by a strict schema; the owning service validates it again;
 *   4. an answer is a fixed vocabulary. Input, note text, targets and error
 *      text are never echoed and never logged — an outage is logged by
 *      operation name only.
 */

/** The custom header every personal POST carries. No HTML form can set it. */
const INTENT = { header: 'x-minhaj-intent', value: 'personal' } as const;

/** No personal request needs more: a 2,000-character note is well inside it. */
const BODY_MAX_BYTES = 8 * 1024;

/** Private, never stored by any cache, never indexed. */
export const PRIVATE_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex',
});

/** A JSON answer with the private headers. */
export function answer(status: number, body: Record<string, unknown>): Response {
  return Response.json(body, { status, headers: PRIVATE_HEADERS });
}

/** An empty success. */
export function noContent(): Response {
  return new Response(null, { status: 204, headers: PRIVATE_HEADERS });
}

/** Each refusal's HTTP status; the body always carries the category. */
const STATUS: Readonly<Record<string, number>> = {
  invalid: 400,
  'no-session': 401,
  denied: 403,
  'not-found': 404,
  conflict: 409,
  'invalid-state': 409,
  limit: 409,
  'too-large': 413,
  unsupported: 415,
  'rate-limited': 429,
  unavailable: 503,
};

/** A refusal — a category, never a stack, a key or the request's own input. */
export function failed(failure: string): Response {
  const status = STATUS[failure];
  return status === undefined
    ? answer(503, { ok: false, failure: 'unavailable' })
    : answer(status, { ok: false, failure });
}

/**
 * The signed-in account this request acts as, `null` when there is no active
 * session. Resolved through Identity's session chokepoint, so a suspended,
 * closed or revoked session is `null` exactly like none at all. An outage
 * throws; the caller answers `unavailable`.
 */
async function sessionActor(): Promise<PersonalActor | null> {
  const active = await requireOwnSession('en');
  return active === null ? null : { accountId: active.session.account.id };
}

/**
 * A private READ's admission: Fetch Metadata, where the browser sends it, must
 * not name another site. A cross-site page cannot read these answers anyway —
 * no CORS is ever approved — but it could otherwise make the browser spend the
 * person's export budget by embedding the address.
 */
export function isPrivateRead(request: Request): boolean {
  const site = request.headers.get('sec-fetch-site');
  return site === null || site === 'same-origin' || site === 'none';
}

/** The actor of a private read, or the answer to give instead. */
export async function readActor(
  operation: string,
): Promise<{ readonly actor: PersonalActor | null } | { readonly refused: Response }> {
  try {
    return { actor: await sessionActor() };
  } catch {
    appLogger().error({ operation }, 'Personal session resolution failed.');
    return { refused: failed('unavailable') };
  }
}

/** The request body as JSON, bounded; never more than the cap is gathered. */
async function boundedJson(
  request: Request,
): Promise<{ readonly value: unknown } | { readonly failure: string }> {
  const type = request.headers.get('content-type') ?? '';
  if (type.split(';')[0]?.trim().toLowerCase() !== 'application/json')
    return { failure: 'unsupported' };

  const declared = request.headers.get('content-length');
  if (declared !== null) {
    const length = Number(declared);
    if (!Number.isSafeInteger(length) || length < 0) return { failure: 'invalid' };
    if (length > BODY_MAX_BYTES) return { failure: 'too-large' };
  }
  if (request.body === null) return { failure: 'invalid' };

  // MEASURED AS IT ARRIVES. A body without a length, or one longer than it
  // declared, is refused at the cap rather than gathered first.
  const reader = request.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > BODY_MAX_BYTES) {
        await reader.cancel();
        return { failure: 'too-large' };
      }
      parts.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }

  try {
    return { value: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) };
  } catch {
    return { failure: 'invalid' };
  }
}

/**
 * One personal POST, start to finish. `work` runs only for an admitted,
 * signed-in request whose body the schema accepted, and answers for itself; a
 * refusal it throws is mapped to its category here.
 *
 * `quiet` is for a record that is never worth a visible failure — a history
 * entry: after admission, any refusal is logged by operation name and answered
 * as success with no content.
 */
export async function personalMutation<T>(
  request: Request,
  options: {
    readonly operation: string;
    readonly schema: z.ZodType<T>;
    readonly quiet?: boolean;
  },
  work: (actor: PersonalActor, value: T) => Promise<Response>,
): Promise<Response> {
  if (!isSameOriginMutation(request, INTENT)) return failed('denied');

  let actor: PersonalActor | null;
  try {
    actor = await sessionActor();
  } catch {
    appLogger().error(
      { operation: options.operation },
      'Personal session resolution failed.',
    );
    return failed('unavailable');
  }
  if (actor === null) return failed('no-session');

  const body = await boundedJson(request);
  if ('failure' in body) return failed(body.failure);
  const parsed = options.schema.safeParse(body.value);
  if (!parsed.success) return failed('invalid');

  try {
    return await work(actor, parsed.data);
  } catch (error) {
    const failure = personalFailure(error);
    if (options.quiet) {
      appLogger().warn({ operation: options.operation }, 'Personal record was not kept.');
      return noContent();
    }
    if (failure === 'unavailable')
      appLogger().error({ operation: options.operation }, 'Personal mutation failed.');
    return failed(failure);
  }
}
