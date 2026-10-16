import 'server-only';

import type { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import type { LiveLearningAuthority } from '@minhaj/contracts/learning';
import type { PublicTeacherEntry } from '@minhaj/contracts/people';

import { TextLink } from '@/components/ui';
import { classTimeIso, formatClassTime, teacherProfileHref } from './presentation';

/**
 * The parts the public live-learning surfaces share (Phase 23).
 *
 * SESSION-FREE BY CONSTRUCTION: nothing here takes an actor, and every name is
 * one People's PUBLIC reader produced. A teacher this platform cannot name
 * publicly is "Teacher", in words, with no link — never an identifier.
 *
 * THE FIXTURE BANNER COMES FIRST. While live learning is activated by
 * engineering fixture, every public page says so visibly, so a test state is
 * never mistaken for the organisation's timetable (the Fatwa precedent).
 *
 * LOGICAL PROPERTIES ONLY (`check:rtl`).
 */

export type LiveTranslator = Awaited<ReturnType<typeof getTranslations<'learnLive'>>>;

/** The fixture banner when, and only when, the activation is fixture. */
export function LiveFixtureNotice({
  mode,
  text,
}: {
  readonly mode: LiveLearningAuthority | null;
  readonly text: string;
}) {
  if (mode !== 'fixture') return null;
  return (
    <p
      role="note"
      className="rounded-[var(--radius-panel)] border-2 border-[color:var(--color-warning)] bg-[color:var(--color-warning-surface)] px-4 py-3 font-semibold text-[color:var(--color-warning)]"
    >
      {text}
    </p>
  );
}

/**
 * One instant of a class, in the CLASS'S zone with the zone named, as a
 * `<time>` whose machine value states the same local time with its offset.
 */
export function ClassTime({
  instant,
  local,
  timeZone,
  locale,
  date = true,
}: {
  readonly instant: Date;
  readonly local: string;
  readonly timeZone: string;
  readonly locale: Locale;
  readonly date?: boolean;
}) {
  const words = formatClassTime(instant, timeZone, locale, { date });
  return (
    <time dateTime={classTimeIso(local, instant)}>
      {words ?? `${local.replace('T', ' ')} ${timeZone}`}
    </time>
  );
}

/** A teacher's public name as a link to their profile, or the plain word. */
export function TeacherName({
  profile,
  locale,
  fallback,
}: {
  readonly profile: PublicTeacherEntry | undefined;
  readonly locale: Locale;
  readonly fallback: string;
}) {
  if (profile === undefined) return <span>{fallback}</span>;
  return (
    <TextLink href={teacherProfileHref(locale, profile.slug)}>
      <span lang={profile.nameLocale} dir="auto" className="wrap-anywhere">
        {profile.name}
      </span>
    </TextLink>
  );
}
