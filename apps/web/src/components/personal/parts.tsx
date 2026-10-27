import 'server-only';

import type { ReactNode } from 'react';
import type { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import type { PersonalTargetKind } from '@minhaj/contracts/personalisation';

import type { ResolvedTarget } from '@/composition/personal-targets';
import { StatusBadge, TextLink } from '@/components/ui';
import { WorkspaceLinks, WorkspacePage } from '@/components/workspace/parts';
import { displayTimeZone } from './presentation';

/**
 * The parts every My Minhaj Personalisation page shares (Phase 21).
 *
 * A TITLE IS THE OWNER'S ANSWER. Nothing here holds a title: each target is
 * resolved by its owner at render time (`resolvePersonalTargets`), and one its
 * owner no longer shows anybody reads "no longer available" — never a stale
 * title, never a dangling link. One whose owner could not be asked just now
 * says exactly that, which is a different statement (DOMAIN_MODEL.md §14.3).
 *
 * The title carries the language it is written in, so a Urdu book title on an
 * English page is announced and shaped as Urdu.
 *
 * LOGICAL PROPERTIES ONLY (`check:rtl`), so the same markup is right in English,
 * Urdu and Arabic.
 */

export type PersonalTranslator = Awaited<ReturnType<typeof getTranslations<'personal'>>>;

/** An instant, in the interface locale and the account's own time zone. */
export function PersonalTime({
  value,
  locale,
  timeZone,
}: {
  readonly value: string;
  readonly locale: Locale;
  readonly timeZone: string | null;
}) {
  const instant = new Date(value);
  return (
    <time dateTime={instant.toISOString()}>
      {new Intl.DateTimeFormat(locale, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZone: displayTimeZone(timeZone),
        timeZoneName: 'short',
      }).format(instant)}
    </time>
  );
}

/** A target's resolved title as a link, or the honest word for why there is none. */
export function TargetTitle({
  resolved,
  t,
}: {
  readonly resolved: ResolvedTarget | undefined;
  readonly t: PersonalTranslator;
}) {
  if (resolved?.status === 'available')
    return (
      <TextLink href={resolved.href}>
        <span lang={resolved.titleLanguage} dir="auto" className="wrap-anywhere">
          {resolved.title}
        </span>
      </TextLink>
    );
  return (
    <span className="text-[color:var(--color-foreground-muted)]">
      {resolved?.status === 'unknown' ? t('target.unknown') : t('target.unavailable')}
    </span>
  );
}

/** What kind of thing a target is — in words, never by colour or icon alone. */
export function KindBadge({
  kind,
  t,
}: {
  readonly kind: PersonalTargetKind;
  readonly t: PersonalTranslator;
}) {
  return <StatusBadge tone="neutral">{t(`kinds.${kind}`)}</StatusBadge>;
}

/**
 * The heading and introduction of a My Minhaj page, inside the area's
 * workspace frame, bounded to a reading measure.
 */
export function PersonalFrame({
  title,
  description,
  back,
  children,
}: {
  readonly title: ReactNode;
  readonly description?: ReactNode;
  /** Where the page sits: links up and across, below the content. */
  readonly back: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <WorkspacePage
      title={title}
      measure="reading"
      {...(description === undefined ? {} : { description })}
    >
      {children}
      {back}
    </WorkspacePage>
  );
}

/** A labelled group of links to neighbouring pages, each a 44-pixel target. */
export function PersonalLinks({
  label,
  links,
}: {
  readonly label: string;
  readonly links: readonly { readonly href: string; readonly text: string }[];
}) {
  return (
    <nav aria-label={label}>
      <WorkspaceLinks links={links} />
    </nav>
  );
}

/**
 * The words for every refusal a Personalisation action can return. Each is a
 * category, never content; `overrides` gives one form its own wording.
 */
export function refusalMessages(
  t: PersonalTranslator,
  overrides: Readonly<Record<string, string>> = {},
): Readonly<Record<string, string>> {
  return {
    conflict: t('failure.conflict'),
    invalid: t('failure.invalid'),
    'invalid-state': t('failure.invalid'),
    limit: t('failure.limit'),
    'rate-limited': t('failure.rateLimited'),
    'not-found': t('failure.notFound'),
    'confirm-required': t('failure.confirmRequired'),
    'no-session': t('failure.noSession'),
    denied: t('failure.noSession'),
    unavailable: t('failure.unavailable'),
    unknown: t('failure.unavailable'),
    ...overrides,
  };
}

/** The explicit confirmation a destructive action requires. */
export function ConfirmField({
  id,
  label,
}: {
  readonly id: string;
  readonly label: string;
}) {
  return (
    <div className="flex items-start gap-2 text-sm">
      <input id={id} type="checkbox" name="confirm" required className="mt-1" />
      <label htmlFor={id}>{label}</label>
    </div>
  );
}
