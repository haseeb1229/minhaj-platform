import 'server-only';

import {
  PERSONAL_LIMITS,
  personalAccountIdSchema,
  type PersonalTarget,
} from '@minhaj/contracts/personalisation';
import type { RateLimitRule, RateLimiterPort } from '@minhaj/contracts/platform';

import { PersonalRefusal } from '../domain/refusal.ts';

/**
 * The account a request acts as — taken from the resolved session at Layer 4,
 * never from anything the request itself names.
 */
export interface PersonalActor {
  readonly accountId: string;
}

/**
 * Whether a target is public NOW, asked of its owner at Layer 4.
 *
 * A save or a history record is accepted only for a target its owner would
 * show to anybody — so a guessed identifier of a draft or withdrawn record is
 * refused exactly like one that does not exist, and the answer never tells a
 * caller which it was. Removing what is already held is never gated by it.
 */
export interface PublicTargetPort {
  available(target: PersonalTarget): Promise<boolean>;
}

/** A purpose-scoped, digested limiter key, built at Layer 4. */
export type LimitKey = (purpose: string, subject: string) => string;

/** Every owner write — save, note, collection, setting — per account. */
export const WRITE_RULE: RateLimitRule = Object.freeze({ window: 3_600, max: 600 });

export function actorOk(actor: PersonalActor): boolean {
  return personalAccountIdSchema.safeParse(actor.accountId).success;
}

export function requireActor(actor: PersonalActor): void {
  if (!actorOk(actor)) throw new PersonalRefusal('denied');
}

export function safeOffset(value: number): number {
  return Number.isInteger(value) && value >= 0 && value <= PERSONAL_LIMITS.offsetMax
    ? value
    : 0;
}

export async function spend(
  limiter: RateLimiterPort,
  key: string,
  rule: RateLimitRule,
): Promise<void> {
  const decision = await limiter.consume(key, rule);
  if (!decision.allowed) throw new PersonalRefusal('rate-limited');
}
