import type { ReactNode } from 'react';

import type { Locale } from '@minhaj/contracts';

/**
 * WHERE A TOPIC HUB STANDS (Hadith Part 1). The Books, Videos, Research and
 * Courses hubs are shared by the subjects that have them — the Quran and
 * Hadith — and each subject gives a hub only what is its own: the column and
 * trail it stands in (its frame, with its notices), its Topic, its title, the
 * hub's element identifiers and the words of its pager. Everything else — the
 * reads, the address rules, the layout — is the hub's, the same for every
 * subject.
 */

/** A way onward: an address and the words that name it. */
export interface HubLink {
  readonly href: string;
  readonly text: string;
}

export interface HubDomain {
  /** The subject's key (`quran`, `hadith`): the hub's element identifiers start with it. */
  readonly key: string;
  readonly locale: Locale;
  /** The subject's Taxonomy Topic, resolved at Layer 4 — or null when it is absent. */
  readonly topicId: string | null;
  /** The hub's title, as the subject's menu names it ("Books on Hadith"). */
  readonly title: string;
  /** The subject's page frame — its column, trail and notices — around the hub. */
  readonly frame: (children: ReactNode) => ReactNode;
  /** The pager's words, in the subject's own voice. */
  readonly previous: string;
  readonly next: string;
}
