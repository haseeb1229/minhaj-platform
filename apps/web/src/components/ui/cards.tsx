import type { ReactNode } from 'react';

import { descriptionDirection } from '@/config/locale';

import { MetaRow } from './composition';
import { ResponsiveImage, type ResponsiveImageProps } from './image';
import { Badge, LanguageBadge } from './indicators';

/**
 * CONTENT CARDS (R2) — the family-specific anatomy that replaces the generic
 * bordered card: an image-led media card, an editorial card in three weights,
 * and a list row.
 *
 * ONE LINK PER CARD. The title holds the only anchor and the `card-link` rule
 * stretches it over the whole card (`globals.css`), so the card is one pointer
 * target and one well-named link in the accessibility tree. Nothing else in a
 * card may be interactive; badges and metadata are text.
 *
 * CONTENT LANGUAGE IS MARKED. `lang`/`dir` describe the TITLE and DESCRIPTION,
 * which are content and may be in another language than the page; badges and
 * metadata are interface text. Pass `language` when the content language
 * differs from the interface language and the card says so in words.
 *
 * A RECORD WITHOUT A PICTURE is rendered text-first — never a grey box or a
 * stock image standing in for one.
 */

/** The picture a card shows: a first-party address and its known size. */
export interface CardImage {
  /** The owning context's first-party image route. */
  readonly path: string;
  /** Empty (the default) because the card's title already names the record. */
  readonly alt?: string;
  readonly width?: number;
  readonly height?: number;
  readonly derivatives?: ResponsiveImageProps['derivatives'];
}

interface CardText {
  readonly href: string;
  readonly title: ReactNode;
  readonly description?: ReactNode;
  /** Interface-language metadata: a date, a duration, a count. */
  readonly meta?: readonly ReactNode[];
  /** What kind of record this is, in words ("Video", "Magazine"). */
  readonly type?: ReactNode;
  /** The content language, when it is not the interface language. */
  readonly language?: {
    readonly label: string;
    readonly code: string;
    readonly ownName?: boolean;
  };
  /** `p` where the card sits outside the page's heading outline (a menu panel). */
  readonly headingLevel?: 'h2' | 'h3' | 'h4' | 'p';
  readonly lang?: string;
  readonly dir?: 'ltr' | 'rtl';
  readonly as?: 'li' | 'div' | 'article';
}

function contentProps(lang?: string, dir?: 'ltr' | 'rtl') {
  return {
    ...(lang === undefined ? {} : { lang }),
    ...(dir === undefined ? {} : { dir }),
  };
}

function Badges({
  type,
  language,
}: {
  readonly type?: ReactNode;
  readonly language?: CardText['language'] | undefined;
}) {
  if (type === undefined && language === undefined) return null;
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {type === undefined ? null : <Badge>{type}</Badge>}
      {language === undefined ? null : <LanguageBadge {...language} />}
    </span>
  );
}

const TITLE_LINK =
  'card-link text-foreground no-underline decoration-accent-rule decoration-1 underline-offset-4 group-hover:underline active:text-action';

const MEDIA_ASPECTS = {
  poster: '16/9',
  wide: '3/2',
  book: '2/3',
  magazine: '3/4',
  square: '1/1',
  portrait: '4/5',
} as const;

/**
 * AN IMAGE-LED CARD for a video, a book, a magazine issue, a collection or a
 * person: the picture fills the card's full width at a fixed ratio, then the
 * title, then one line of metadata. The type badge sits on the picture; a
 * corner `overlay` (a running time) sits at its inline end.
 */
export function MediaCard({
  href,
  title,
  description,
  meta,
  type,
  language,
  headingLevel = 'h3',
  lang,
  dir,
  as: Element = 'li',
  image,
  aspect = 'poster',
  sizes,
  priority = false,
  overlay,
  fit,
}: CardText & {
  readonly image?: CardImage | null;
  readonly aspect?: keyof typeof MEDIA_ASPECTS;
  /** How wide the card renders, for choosing a derivative. */
  readonly sizes?: string;
  readonly priority?: boolean;
  /** A short fact drawn on the picture's corner, such as a running time. */
  readonly overlay?: ReactNode;
  /** Overrides the picture's fit: `contain` shows a cover whole inside a wide box. */
  readonly fit?: 'cover' | 'contain';
}) {
  const Heading = headingLevel;
  const content = contentProps(lang, dir);
  const pictured = image !== undefined && image !== null;
  const shown = fit ?? (aspect === 'book' || aspect === 'magazine' ? 'contain' : 'cover');

  return (
    <Element className="group card-surface relative flex min-w-0 flex-col gap-3 rounded-panel">
      {pictured ? (
        <span className="relative block">
          <ResponsiveImage
            path={image.path}
            alt={image.alt ?? ''}
            aspect={MEDIA_ASPECTS[aspect]}
            fit={shown}
            radius="panel"
            priority={priority}
            {...(image.width === undefined ? {} : { width: image.width })}
            {...(image.height === undefined ? {} : { height: image.height })}
            {...(image.derivatives === undefined
              ? {}
              : { derivatives: image.derivatives })}
            {...(sizes === undefined ? {} : { sizes })}
            {...(lang === undefined ? {} : { lang })}
            className="transition-[filter] duration-[var(--duration-medium)] ease-[var(--ease-standard)] group-hover:brightness-95"
          />
          {type === undefined ? null : (
            <span className="absolute start-2 top-2">
              <Badge tone="neutral">{type}</Badge>
            </span>
          )}
          {overlay === undefined ? null : (
            <span className="absolute end-2 bottom-2 rounded-control bg-ink/85 px-1.5 py-0.5 text-caption font-semibold text-ink-foreground tabular-nums">
              {overlay}
            </span>
          )}
        </span>
      ) : null}

      <div
        className={`flex min-w-0 flex-col gap-1.5 ${pictured ? '' : 'border-t-2 border-accent-rule pt-3'}`}
      >
        {pictured ? (
          language === undefined ? null : (
            <Badges language={language} />
          )
        ) : (
          <Badges type={type} language={language} />
        )}
        <Heading
          className="text-subheading font-semibold text-balance wrap-anywhere"
          {...content}
        >
          <a href={href} className={TITLE_LINK}>
            {title}
          </a>
        </Heading>
        {description === undefined || description === '' ? null : (
          <span
            className="line-clamp-2 text-sm wrap-anywhere text-foreground-muted"
            {...content}
            {...(dir === undefined ? {} : { dir: descriptionDirection(dir) })}
          >
            {description}
          </span>
        )}
        {meta === undefined ? null : <MetaRow items={meta} />}
      </div>
    </Element>
  );
}

/**
 * AN EDITORIAL CARD for news, articles and press.
 *
 *   `lead`      the one story a section opens with: a wide picture, the title
 *               in the display face, a three-line standfirst.
 *   `secondary` the stories beside it: picture at the inline start, words
 *               beside it (stacked on a phone).
 *   `compact`   a text-only entry under a hairline, for a dense list.
 */
export function EditorialCard({
  variant = 'secondary',
  href,
  title,
  description,
  meta,
  type,
  language,
  headingLevel = 'h3',
  lang,
  dir,
  as: Element = 'li',
  image,
  sizes,
  priority = false,
}: CardText & {
  readonly variant?: 'lead' | 'secondary' | 'compact';
  readonly image?: CardImage | null;
  readonly sizes?: string;
  readonly priority?: boolean;
}) {
  const Heading = headingLevel;
  const content = contentProps(lang, dir);
  const pictured = variant !== 'compact' && image !== undefined && image !== null;
  const lead = variant === 'lead';

  const picture = pictured ? (
    <ResponsiveImage
      path={image.path}
      alt={image.alt ?? ''}
      aspect={lead ? '16/9' : '3/2'}
      radius="panel"
      priority={priority}
      {...(image.width === undefined ? {} : { width: image.width })}
      {...(image.height === undefined ? {} : { height: image.height })}
      {...(image.derivatives === undefined ? {} : { derivatives: image.derivatives })}
      {...(sizes === undefined ? {} : { sizes })}
      {...(lang === undefined ? {} : { lang })}
      className="transition-[filter] duration-[var(--duration-medium)] ease-[var(--ease-standard)] group-hover:brightness-95"
    />
  ) : null;

  const words = (
    <div className="flex min-w-0 flex-col gap-2">
      <Badges type={type} language={language} />
      <Heading
        className={`font-semibold text-balance wrap-anywhere ${lead ? 'text-heading' : 'text-subheading'}`}
        {...content}
      >
        <a href={href} className={TITLE_LINK}>
          {title}
        </a>
      </Heading>
      {description === undefined || description === '' || variant === 'compact' ? null : (
        <span
          className={`wrap-anywhere text-foreground-muted ${lead ? 'line-clamp-3 text-lede' : 'line-clamp-2 text-sm'}`}
          {...content}
          {...(dir === undefined ? {} : { dir: descriptionDirection(dir) })}
        >
          {description}
        </span>
      )}
      {meta === undefined ? null : <MetaRow items={meta} />}
    </div>
  );

  if (variant === 'compact')
    return (
      <Element className="group card-surface relative flex min-w-0 flex-col border-t border-border pt-3">
        {words}
      </Element>
    );

  return (
    <Element
      className={`group card-surface relative grid min-w-0 gap-4 rounded-panel ${
        lead || !pictured
          ? 'grid-cols-1'
          : 'grid-cols-1 min-[30rem]:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] min-[30rem]:items-start'
      }`}
    >
      {picture}
      {words}
    </Element>
  );
}

/**
 * ONE ROW OF A LIST: an optional small picture at the inline start, the title
 * (the row's one link), a line of description, metadata, and an optional
 * non-interactive `trailing` fact at the inline end (a badge, a count).
 */
export function ListRow({
  href,
  title,
  description,
  meta,
  type,
  language,
  headingLevel = 'h3',
  lang,
  dir,
  as: Element = 'li',
  image,
  aspect = 'wide',
  trailing,
}: CardText & {
  readonly image?: CardImage | null;
  readonly aspect?: 'wide' | 'book' | 'square';
  /** Text only: anything interactive would sit under the row's stretched link. */
  readonly trailing?: ReactNode;
}) {
  const Heading = headingLevel;
  const content = contentProps(lang, dir);
  const pictured = image !== undefined && image !== null;

  return (
    <Element className="group card-surface relative flex min-w-0 items-start gap-4 border-b border-border py-4">
      {pictured ? (
        <span
          className={`shrink-0 ${aspect === 'wide' ? 'w-24 sm:w-32' : 'w-16 sm:w-20'}`}
        >
          <ResponsiveImage
            path={image.path}
            alt={image.alt ?? ''}
            aspect={aspect === 'wide' ? '3/2' : aspect === 'book' ? '2/3' : '1/1'}
            fit={aspect === 'book' ? 'contain' : 'cover'}
            {...(image.width === undefined ? {} : { width: image.width })}
            {...(image.height === undefined ? {} : { height: image.height })}
            {...(image.derivatives === undefined
              ? {}
              : { derivatives: image.derivatives })}
            sizes="8rem"
          />
        </span>
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <Badges type={type} language={language} />
        <Heading
          className="text-base font-semibold text-balance wrap-anywhere"
          {...content}
        >
          <a href={href} className={TITLE_LINK}>
            {title}
          </a>
        </Heading>
        {description === undefined || description === '' ? null : (
          <span
            className="line-clamp-2 text-sm wrap-anywhere text-foreground-muted"
            {...content}
            {...(dir === undefined ? {} : { dir: descriptionDirection(dir) })}
          >
            {description}
          </span>
        )}
        {meta === undefined ? null : <MetaRow items={meta} />}
      </div>
      {trailing === undefined ? null : (
        <span className="shrink-0 self-center">{trailing}</span>
      )}
    </Element>
  );
}
