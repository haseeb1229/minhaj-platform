import type { ReactNode } from 'react';

import type { WorkRecord } from '@minhaj/contracts/library';

import { Cover, Icon, SectionHeader, Stat } from '@/components/ui';
import { Shelf } from '@/components/ui/shelf';

import { editionCoverPath } from './cover';

/**
 * The Library landing's parts (R2): a titled shelf, the hero's stack of real
 * covers, and the quiet directory of every other way into the Library.
 * Presentation only — the page reads the data.
 */

/** One shelf of the landing: its heading, the way to the whole set, the covers. */
export function LibraryShelf({
  id,
  heading,
  action,
  previousLabel,
  nextLabel,
  children,
}: {
  readonly id: string;
  readonly heading: string;
  readonly action: { readonly href: string; readonly text: string };
  readonly previousLabel: string;
  readonly nextLabel: string;
  readonly children: ReactNode;
}) {
  return (
    <section aria-labelledby={id}>
      <Shelf
        label={heading}
        size="cover"
        previousLabel={previousLabel}
        nextLabel={nextLabel}
        header={<SectionHeader id={id} heading={heading} action={action} />}
      >
        {children}
      </Shelf>
    </section>
  );
}

/**
 * THE HERO'S COVERS: the three newest books that have one, set side by side
 * and stepped, as books stand on a display table. Decorative — the shelf below
 * names and links every one of them — so they carry no alternative text and
 * are hidden from assistive technology. Fewer than three covers: none at all.
 */
export function CoverStack({ works }: { readonly works: readonly WorkRecord[] }) {
  const covered = works.filter((work) => work.cover !== null).slice(0, 3);
  if (covered.length < 3) return null;
  return (
    <div aria-hidden="true" className="grid grid-cols-3 items-end gap-3 sm:gap-5">
      {covered.map((work, index) => {
        const cover = work.cover;
        if (cover === null) return null;
        return (
          <div
            key={work.id}
            className={`rounded-control bg-surface-raised p-1.5 shadow-raised ${
              index === 1 ? 'mb-6 sm:mb-10' : ''
            }`}
          >
            <Cover
              path={editionCoverPath(cover.editionId, cover.assetId)}
              width={cover.width}
              height={cover.height}
              alt=""
              priority
              sizes="(min-width: 64rem) 10rem, 30vw"
            />
          </div>
        );
      })}
    </div>
  );
}

/**
 * LIBRARY PART 1 — THE LIBRARY AT A GLANCE: the whole Library's figures, each
 * the very count its listing opens with, linked to the view it counts.
 * Rendered only when something is published; a figure of zero is not shown.
 */
export function LibraryFigures({
  id,
  heading,
  stats,
}: {
  readonly id: string;
  readonly heading: string;
  readonly stats: readonly {
    readonly value: number | string;
    readonly label: string;
    readonly href?: string;
  }[];
}) {
  if (stats.length === 0) return null;
  return (
    <section
      aria-labelledby={id}
      className="flex flex-col gap-4 rounded-panel border border-accent-rule bg-accent-surface p-5 sm:p-6"
    >
      <h2
        id={id}
        className="text-caption font-semibold tracking-[var(--tracking-eyebrow)] text-accent uppercase"
      >
        {heading}
      </h2>
      <div className="flex flex-wrap gap-x-10 gap-y-5">
        {stats.map((stat) => (
          <Stat
            key={stat.label}
            value={stat.value}
            label={stat.label}
            {...(stat.href === undefined ? {} : { href: stat.href })}
          />
        ))}
      </div>
    </section>
  );
}

/**
 * LIBRARY PART 1 — THE WAYS IN: the Library's own facets (by Topic, by
 * content language, by author), each a set of chips with the number of books
 * choosing it would show, and the kinds of resource the Library holds. A way
 * in with nothing behind it is absent.
 */
export function BrowseWays({
  id,
  heading,
  intro,
  ways,
}: {
  readonly id: string;
  readonly heading: string;
  readonly intro: string;
  readonly ways: readonly {
    readonly key: string;
    readonly heading: string;
    readonly chips: readonly {
      readonly href: string;
      readonly text: string;
      readonly count?: number;
      readonly lang?: string;
    }[];
    readonly all: { readonly href: string; readonly text: string } | null;
  }[];
}) {
  const shown = ways.filter((way) => way.chips.length > 0);
  if (shown.length === 0) return null;
  return (
    <section aria-labelledby={id} className="flex flex-col gap-6">
      <SectionHeader id={id} heading={heading} intro={intro} />
      <div className="grid grid-cols-1 gap-x-8 gap-y-8 md:grid-cols-2">
        {shown.map((way) => (
          <section
            key={way.key}
            aria-labelledby={`${id}-${way.key}`}
            className="flex min-w-0 flex-col gap-3 rounded-panel border border-border bg-surface-raised p-5"
          >
            <h3 id={`${id}-${way.key}`} className="text-subheading font-semibold">
              {way.heading}
            </h3>
            <ul className="flex list-none flex-wrap gap-2 p-0">
              {way.chips.map((chip) => (
                <li key={chip.href} className="min-w-0">
                  <a
                    href={chip.href}
                    className="inline-flex min-h-11 max-w-full items-center gap-2 rounded-full border border-border bg-surface px-4 text-sm no-underline transition-colors duration-[var(--duration-fast)] hover:border-accent hover:bg-accent-surface active:bg-accent-rule"
                  >
                    <span
                      className="min-w-0 wrap-anywhere"
                      {...(chip.lang === undefined ? {} : { lang: chip.lang })}
                    >
                      {chip.text}
                    </span>
                    {chip.count === undefined ? null : (
                      <span className="text-caption text-foreground-muted tabular-nums">
                        {chip.count}
                      </span>
                    )}
                  </a>
                </li>
              ))}
            </ul>
            {way.all === null ? null : (
              <a
                href={way.all.href}
                className="inline-flex min-h-11 w-fit items-center gap-1.5 text-sm font-semibold text-action underline-offset-4 hover:underline"
              >
                {way.all.text}
                <Icon name="arrow-end" size={16} />
              </a>
            )}
          </section>
        ))}
      </div>
    </section>
  );
}

/**
 * LIBRARY PART 1 — THE SUBJECTS' BOOK HUBS, cross-linked: the Quran's and
 * Hadith's own Books listings, each a large named link with one line saying
 * what it gathers.
 */
export function SubjectHubs({
  id,
  heading,
  intro,
  hubs,
}: {
  readonly id: string;
  readonly heading: string;
  readonly intro: string;
  readonly hubs: readonly {
    readonly href: string;
    readonly title: string;
    readonly body: string;
  }[];
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-5">
      <SectionHeader id={id} heading={heading} intro={intro} />
      <ul className="grid list-none grid-cols-1 gap-4 p-0 md:grid-cols-2">
        {hubs.map((hub) => (
          <li
            key={hub.href}
            className="card-surface relative flex min-w-0 items-start gap-4 rounded-panel border border-border bg-surface-raised p-5 hover:border-accent"
          >
            <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-accent-surface text-accent">
              <Icon name="book" size={20} />
            </span>
            <span className="flex min-w-0 flex-col gap-1">
              <a
                href={hub.href}
                className="card-link inline-flex min-h-11 items-center font-serif text-subheading font-semibold text-foreground no-underline decoration-accent-rule underline-offset-4 hover:underline"
              >
                {hub.title}
              </a>
              <span className="text-sm text-foreground-muted">{hub.body}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Every other way into the Library, as a directory of named links with one
 * line each — words, not a wall of identical cards. A group may carry one
 * line of its own, under its heading, saying what it gathers.
 */
export function LibraryDirectory({
  groups,
}: {
  readonly groups: readonly {
    readonly id: string;
    readonly heading: string;
    readonly intro?: string;
    readonly links: readonly {
      readonly href: string;
      readonly title: string;
      readonly description: string;
    }[];
  }[];
}) {
  return (
    <div className="grid grid-cols-1 gap-x-10 gap-y-10 md:grid-cols-2 xl:grid-cols-4">
      {groups.map((group) => (
        <section
          key={group.id}
          aria-labelledby={group.id}
          className="flex flex-col gap-3"
        >
          <h3
            id={group.id}
            className="border-b border-border pb-2 text-subheading font-semibold"
          >
            {group.heading}
          </h3>
          {group.intro === undefined ? null : (
            <p className="text-sm text-foreground-muted">{group.intro}</p>
          )}
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {group.links.map((link) => (
              <li key={link.href} className="flex items-start gap-3 py-1.5">
                <Icon name="arrow-end" size={16} className="mt-3 text-accent" />
                <span className="flex flex-col">
                  {/* The link is named by the title alone; the line under it describes. */}
                  <a
                    href={link.href}
                    className="inline-flex min-h-11 items-center font-semibold text-foreground no-underline decoration-accent-rule underline-offset-4 hover:text-action hover:underline"
                  >
                    {link.title}
                  </a>
                  <span className="text-sm text-foreground-muted">
                    {link.description}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
