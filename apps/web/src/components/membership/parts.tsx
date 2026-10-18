import 'server-only';

import type { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import type {
  ApplicationStatus,
  ClosureSource,
  MembershipStatus,
  MembershipTypeState,
  PublicMembershipType,
  WithdrawalSource,
} from '@minhaj/contracts/membership';

import { paragraphs } from '@/components/my-learning/presentation';
import { displayTimeZone } from '@/components/personal/presentation';
import { Alert, StatusBadge } from '@/components/ui';
import { directionOf, endonymOf } from '@/config/locale';
import {
  applicationStatusKey,
  applicationTone,
  membershipTone,
  typeLabel,
  typeStateTone,
  withdrawalSourceKey,
} from './presentation';

/**
 * The parts every Membership surface shares (DELIVERY_PLAN.md Phase 26) — the
 * public page, My Membership and the administration.
 *
 * SERVER COMPONENTS, SESSION-FREE BY CONSTRUCTION. Nothing here reads a
 * request, a session or a composition root; each part renders what its caller
 * already read, so the anonymous public page may use them as freely as the
 * private ones.
 *
 * STATE IS WORDS. "Under review", "Approved", "Closed" are text in a badge; a
 * tone only repeats what the word says, never carries it alone
 * (SECURITY_BASELINE.md §16.1).
 *
 * A TYPE'S WORDS CARRY THEIR LANGUAGE. A type described only in Urdu, read on
 * an English page, is marked `lang="ur"` and shaped right-to-left, with an
 * honest notice that it has not been translated — never a silent mix. The
 * words are operator-authored PLAIN TEXT and render as text nodes only.
 *
 * LOGICAL PROPERTIES ONLY (`check:rtl`). Operator text may hold a long
 * unbroken token, so it may break anywhere rather than widen a phone screen.
 */

export type MembershipTranslator = Awaited<
  ReturnType<typeof getTranslations<'membership'>>
>;

export function ApplicationStatusBadge({
  status,
  t,
}: {
  readonly status: ApplicationStatus;
  readonly t: MembershipTranslator;
}) {
  return (
    <StatusBadge tone={applicationTone(status)}>
      {t(`status.application.${applicationStatusKey(status)}`)}
    </StatusBadge>
  );
}

export function MembershipStatusBadge({
  status,
  t,
}: {
  readonly status: MembershipStatus;
  readonly t: MembershipTranslator;
}) {
  return (
    <StatusBadge tone={membershipTone(status)}>
      {t(`status.membership.${status}`)}
    </StatusBadge>
  );
}

export function TypeStateBadge({
  state,
  t,
}: {
  readonly state: MembershipTypeState;
  readonly t: MembershipTranslator;
}) {
  return <StatusBadge tone={typeStateTone(state)}>{t(`typeState.${state}`)}</StatusBadge>;
}

/** Who withdrew an application, in words. */
export function withdrawalText(
  source: WithdrawalSource,
  t: MembershipTranslator,
): string {
  return t(`withdrawalSource.${withdrawalSourceKey(source)}`);
}

/** Who closed a Membership, in words. */
export function closureText(source: ClosureSource, t: MembershipTranslator): string {
  return t(`closureSource.${source}`);
}

/**
 * A type's title in the reader's locale where it has one, in its own
 * language. A type the record names but the reader cannot resolve reads as
 * the honest fallback words, never an identifier.
 */
export function TypeTitle({
  type,
  locale,
  t,
}: {
  readonly type: Pick<PublicMembershipType, 'labels' | 'primaryLocale'> | undefined;
  readonly locale: Locale;
  readonly t: MembershipTranslator;
}) {
  const label = type === undefined ? null : typeLabel(type, locale);
  if (label === null)
    return (
      <span className="text-[color:var(--color-foreground-muted)]">
        {t('typeUnavailable')}
      </span>
    );
  return (
    <span lang={label.locale} dir={directionOf(label.locale)} className="wrap-anywhere">
      {label.title}
    </span>
  );
}

/** An instant, in the interface locale and the reader's own time zone, zone named. */
export function MembershipTime({
  value,
  locale,
  timeZone,
}: {
  readonly value: Date;
  readonly locale: Locale;
  readonly timeZone: string | null;
}) {
  return (
    <time dateTime={value.toISOString()}>
      {new Intl.DateTimeFormat(locale, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZone: displayTimeZone(timeZone),
        timeZoneName: 'short',
      }).format(value)}
    </time>
  );
}

/**
 * A type's full words — the not-translated notice when they are not in the
 * reader's locale, then title, summary, description and any joining guidance,
 * all marked with the language they are in.
 */
export function TypeWords({
  type,
  locale,
  t,
  headingLevel,
  headingId,
  full = true,
}: {
  readonly type: Pick<PublicMembershipType, 'labels' | 'primaryLocale'>;
  readonly locale: Locale;
  readonly t: MembershipTranslator;
  readonly headingLevel: 'h2' | 'h3';
  readonly headingId?: string;
  /** The description and guidance as well as the title and summary. */
  readonly full?: boolean;
}) {
  const label = typeLabel(type, locale);
  if (label === null) return null;
  const direction = directionOf(label.locale);
  const Heading = headingLevel;
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {label.locale === locale ? null : (
        <Alert tone="info">
          {t('types.fallback', { language: endonymOf(label.locale) })}
        </Alert>
      )}
      <div className="flex min-w-0 flex-col gap-3" lang={label.locale} dir={direction}>
        <Heading id={headingId} className="text-lg font-semibold wrap-anywhere">
          {label.title}
        </Heading>
        <p className="wrap-anywhere text-[color:var(--color-foreground-muted)]">
          {label.summary}
        </p>
        {full
          ? paragraphs(label.description).map((paragraph, index) => (
              <p key={index} className="text-sm wrap-anywhere whitespace-pre-line">
                {paragraph}
              </p>
            ))
          : null}
      </div>
      {full && label.guidance !== null ? (
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-sm font-medium">{t('types.guidance')}</p>
          <p
            className="text-sm wrap-anywhere whitespace-pre-line"
            lang={label.locale}
            dir={direction}
          >
            {label.guidance}
          </p>
        </div>
      ) : null}
    </div>
  );
}
