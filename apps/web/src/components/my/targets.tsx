import 'server-only';

import type { ReactNode } from 'react';

import type { PersonalTargetKind } from '@minhaj/contracts/personalisation';

import { leadCardImage } from '@/components/editorial/lead-image';
import { MetaRow } from '@/components/ui/composition';
import { Icon, type IconName } from '@/components/ui/icon';
import { ResponsiveImage } from '@/components/ui/image';
import { MediaCard } from '@/components/ui/cards';
import type { ResolvedTarget } from '@/composition/personal-targets';

/**
 * A SAVED OR READ THING, SHOWN AS WHAT IT IS (R2) — the owner's title, the
 * owner's own picture where it publishes one, and what kind of thing it is in
 * words.
 *
 * THE TITLE IS THE OWNER'S ANSWER, asked now (`resolvePersonalTargets`). A
 * target its owner no longer shows anybody is listed without a link and says
 * so; one whose owner could not be asked says that instead — never a stale
 * title, never a dangling link (DOMAIN_MODEL.md §14.3).
 *
 * A record without a picture is set as text with its kind's icon — never a
 * grey box or a stock image standing in for one.
 */

const KIND_ICONS: Readonly<Record<PersonalTargetKind, IconName>> = {
  article: 'news',
  work: 'book',
  video: 'video',
  ayah: 'bookmark',
  hadith: 'bookmark',
};

/** The words for a target the page cannot link to. */
export interface TargetWords {
  readonly kind: (kind: PersonalTargetKind) => string;
  readonly unavailable: string;
  readonly unknown: string;
}

function missingText(resolved: ResolvedTarget | undefined, words: TargetWords): string {
  return resolved?.status === 'unknown' ? words.unknown : words.unavailable;
}

/**
 * One card of a shelf on the home page: image-led when the owner publishes a
 * picture, text-first otherwise. An unavailable target is a quiet card with no
 * link.
 */
export function TargetCard({
  kind,
  resolved,
  meta,
  words,
}: {
  readonly kind: PersonalTargetKind;
  readonly resolved: ResolvedTarget | undefined;
  readonly meta?: readonly ReactNode[];
  readonly words: TargetWords;
}) {
  if (resolved?.status !== 'available')
    return (
      <li className="flex min-w-0 flex-col gap-1.5 border-t-2 border-border pt-3">
        <span className="text-caption font-semibold text-foreground-muted">
          {words.kind(kind)}
        </span>
        <p className="text-sm text-foreground-muted">{missingText(resolved, words)}</p>
        {meta === undefined ? null : <MetaRow items={meta} />}
      </li>
    );
  return (
    <MediaCard
      href={resolved.href}
      title={resolved.title}
      lang={resolved.titleLanguage}
      type={words.kind(kind)}
      image={resolved.image === null ? null : leadCardImage(resolved.image, '')}
      aspect="wide"
      sizes="(min-width: 64rem) 20rem, 17rem"
      {...(meta === undefined ? {} : { meta })}
    />
  );
}

/**
 * One row of a My Minhaj list: a small picture or the kind's icon, the title
 * (its own link), a line of metadata, anything the row holds (a note's text),
 * and the row's own actions at its inline end. The actions are real forms
 * beside the link, never under a stretched one.
 */
export function TargetItem({
  kind,
  resolved,
  meta,
  words,
  children,
  actions,
}: {
  readonly kind: PersonalTargetKind;
  readonly resolved: ResolvedTarget | undefined;
  readonly meta?: readonly ReactNode[];
  readonly words: TargetWords;
  readonly children?: ReactNode;
  readonly actions?: ReactNode;
}) {
  const image =
    resolved?.status === 'available' && resolved.image !== null ? resolved.image : null;
  return (
    <li className="flex min-w-0 flex-col gap-3 border-b border-border py-4 sm:flex-row sm:items-start">
      <div className="flex min-w-0 flex-1 items-start gap-4">
        {image === null ? (
          <span
            aria-hidden="true"
            className="flex size-12 shrink-0 items-center justify-center rounded-control bg-accent-surface text-accent"
          >
            <Icon name={KIND_ICONS[kind]} size={20} />
          </span>
        ) : (
          <span className="w-20 shrink-0 sm:w-28">
            <ResponsiveImage
              path={leadCardImage(image, '').path}
              width={image.width}
              height={image.height}
              alt=""
              aspect="3/2"
              radius="control"
              sizes="7rem"
            />
          </span>
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-caption font-semibold text-accent">
            {words.kind(kind)}
          </span>
          {resolved?.status === 'available' ? (
            <a
              href={resolved.href}
              lang={resolved.titleLanguage}
              dir="auto"
              className="w-fit max-w-full font-semibold text-balance wrap-anywhere text-foreground underline decoration-accent-rule underline-offset-4 hover:decoration-action active:text-action"
            >
              {resolved.title}
            </a>
          ) : (
            <span className="text-foreground-muted">{missingText(resolved, words)}</span>
          )}
          {meta === undefined ? null : <MetaRow items={meta} />}
          {children}
        </div>
      </div>
      {actions === undefined ? null : (
        <div className="flex shrink-0 flex-wrap items-start gap-2 ps-16 sm:ps-0">
          {actions}
        </div>
      )}
    </li>
  );
}
