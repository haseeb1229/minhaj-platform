/**
 * THE SHARED UI PRIMITIVES — the one component vocabulary of every surface.
 *
 * Every interactive component defines every state it can be in — default,
 * hover, focus-visible, disabled, pending, error — because "a state that is
 * undefined is a state that will be invented inconsistently later"
 * (ARCHITECTURE.md §13.4).
 *
 * SERVER COMPONENTS ONLY, in this barrel. Everything exported here is markup
 * and classes, so a page that imports it ships no JavaScript for it (§13.8).
 * The few primitives whose behaviour genuinely lives in the browser are client
 * islands and are imported from their OWN module, never from here — so a
 * prerendered page that uses a card does not pull a dialog into its graph:
 *
 *   `@/components/ui/dialog`  Dialog, Sheet (native `<dialog>`)
 *   `@/components/ui/tabs`    Tabs (ARIA tabs, roving focus)
 *   `@/components/ui/shelf`   Shelf (horizontal scroller with buttons)
 *
 * LOGICAL PROPERTIES ONLY. `ms-*`/`me-*`/`ps-*`/`pe-*`, never `ml-*`/`pl-*`.
 * The RTL checker fails the build on a physical property, which is what keeps
 * Urdu and Arabic correct rather than checked-once.
 */
export {
  AuthLayout,
  Breadcrumbs,
  Container,
  PageHeading,
  Panel,
  Prose,
  SectionHeading,
} from './layout';
export {
  ActionLink,
  CardGrid,
  LinkCard,
  MetaRow,
  PageHero,
  SectionHeader,
  TopicChips,
} from './composition';
export { Alert, EmptyState, Skeleton, type AlertTone } from './feedback';
export {
  Button,
  Field,
  FilterLink,
  Select,
  TextArea,
  TextInput,
  TextLink,
  type ButtonTone,
} from './forms';
export {
  DataCell,
  DataRow,
  DataTable,
  DetailRow,
  SessionList,
  SessionRow,
  StatusBadge,
} from './data';
export { Icon, type IconName } from './icon';
export {
  Cover,
  Portrait,
  Poster,
  ResponsiveImage,
  type ImageSource,
  type ResponsiveImageProps,
} from './image';
export { EditorialCard, ListRow, MediaCard } from './cards';
export { Badge, LanguageBadge, Stat } from './indicators';
export { Hero } from './hero';
export { LinkTabs } from './link-tabs';
export { Pager } from './pager';
