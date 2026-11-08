import type { ReactNode } from 'react';

import type { WorkRecord } from '@minhaj/contracts/library';

import { Cover, Icon, SectionHeader } from '@/components/ui';
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
 * Every other way into the Library, as a directory of named links with one
 * line each — words, not a wall of identical cards.
 */
export function LibraryDirectory({
  groups,
}: {
  readonly groups: readonly {
    readonly id: string;
    readonly heading: string;
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
