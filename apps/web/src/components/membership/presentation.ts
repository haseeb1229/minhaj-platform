import type { Locale } from '@minhaj/contracts';
import {
  membershipIdSchema,
  type ApplicationStatus,
  type MembershipStatus,
  type MembershipTypeLabel,
  type MembershipTypeState,
  type PublicMembershipType,
  type WithdrawalSource,
} from '@minhaj/contracts/membership';

import { pickLabel } from '@/components/my-learning/presentation';

/**
 * Presentation decisions for every Membership surface — PURE and free of React
 * (DELIVERY_PLAN.md Phase 26).
 *
 * Which words a type renders in, which tone a status badge takes, which
 * addresses the surfaces link between, and what a query string or a
 * post-action notice is allowed to say. Each has ONE implementation, so the
 * public page, My Membership and the administration read them the same way.
 *
 * A TYPE'S WORDS ARE THE OPERATOR'S, IN A LANGUAGE. The reader's interface
 * locale first, then the type's primary locale, then whatever it has —
 * presentation, never translation — and the resolved locale travels with the
 * words so the element is marked with the language it is actually in.
 *
 * AN UNKNOWN FILTER NEVER BROADENS. A type a URL names that does not parse is
 * reported as INVALID rather than quietly dropped, so a listing shows an
 * explained empty result instead of every type's rows.
 */

export type Query = Record<string, string | string[] | undefined>;

/** One parameter as one string; a repeated parameter is its first value. */
function single(query: Query, name: string): string | null {
  const value = query[name];
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === 'string' ? first : null;
}

/* ===========================================================================
 * Addresses
 * ========================================================================= */

/** The public explanation and catalogue. */
export function membershipPath(locale: Locale): string {
  return `/${locale}/membership`;
}

/** The signed-in person's own applications and Memberships. */
export function myMembershipPath(locale: Locale): string {
  return `/${locale}/my/membership`;
}

/** The administration's types-and-members screen. */
export function adminMembershipPath(locale: Locale): string {
  return `/${locale}/admin/membership`;
}

/** An address with its query, in a fixed order, omitting what is unset. */
export function withQuery(
  base: string,
  params: Readonly<Record<string, string | null | undefined>>,
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params))
    if (value !== null && value !== undefined && value !== '') search.set(key, value);
  const encoded = search.toString();
  return encoded === '' ? base : `${base}?${encoded}`;
}

/* ===========================================================================
 * Words
 * ========================================================================= */

/** The words a type renders: interface locale, else primary locale, else any. */
export function typeLabel(
  type: Pick<PublicMembershipType, 'labels' | 'primaryLocale'>,
  locale: Locale,
): MembershipTypeLabel | null {
  return pickLabel(type.labels, locale, type.primaryLocale);
}

/** A type's title as plain text, for an accessible name that must carry it. */
export function typeTitleText(
  type: Pick<PublicMembershipType, 'labels' | 'primaryLocale'> | undefined,
  locale: Locale,
): string {
  return type === undefined ? '' : (typeLabel(type, locale)?.title ?? '');
}

/* ===========================================================================
 * Status tones — the badge's words carry the meaning; a tone only repeats it
 * ========================================================================= */

export type Tone = 'neutral' | 'positive' | 'caution';

export function applicationTone(status: ApplicationStatus): Tone {
  if (status === 'approved') return 'positive';
  if (status === 'submitted' || status === 'under_review') return 'caution';
  return 'neutral';
}

export function membershipTone(status: MembershipStatus): Tone {
  return status === 'active' ? 'positive' : 'neutral';
}

export function typeStateTone(state: MembershipTypeState): Tone {
  return state === 'published' ? 'positive' : 'neutral';
}

/** The message key of an application status — `under_review` is not a key spelling. */
export function applicationStatusKey(
  status: ApplicationStatus,
): 'submitted' | 'underReview' | 'approved' | 'rejected' | 'withdrawn' {
  return status === 'under_review' ? 'underReview' : status;
}

/** The message key of a withdrawal source. */
export function withdrawalSourceKey(
  source: WithdrawalSource,
): 'applicant' | 'accountClosure' {
  return source === 'account-closure' ? 'accountClosure' : 'applicant';
}

/* ===========================================================================
 * Query strings
 * ========================================================================= */

/** One of a fixed set of choices, or the fallback — never a value outside the set. */
export function readChoice<T extends string>(
  query: Query,
  name: string,
  choices: readonly T[],
  fallback: T,
): T {
  const raw = single(query, name);
  return choices.find((choice) => choice === raw) ?? fallback;
}

/** A type filter: absent, a well-formed identifier, or malformed — kept distinct. */
export type TypeFilter =
  | { readonly state: 'none' }
  | { readonly state: 'value'; readonly value: string }
  | { readonly state: 'invalid' };

export function readTypeFilter(query: Query, name = 'type'): TypeFilter {
  const raw = single(query, name);
  if (raw === null || raw === '') return { state: 'none' };
  return membershipIdSchema.safeParse(raw).success
    ? { state: 'value', value: raw }
    : { state: 'invalid' };
}

/**
 * What My Membership may say after an act redirects back to it. A fixed set of
 * words chosen by key, never a message carried in the address.
 */
export const DONE_NOTICES = ['submitted', 'existing', 'withdrawn', 'closed'] as const;
export type DoneNotice = (typeof DONE_NOTICES)[number];

export function readDoneNotice(query: Query): DoneNotice | null {
  const raw = single(query, 'done');
  return DONE_NOTICES.find((notice) => notice === raw) ?? null;
}
