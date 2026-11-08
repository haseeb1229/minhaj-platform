import type { Locale } from '@minhaj/contracts';
import type { EventSummary, EventWhen } from '@minhaj/contracts/editorial';
import { getTranslations } from 'next-intl/server';

import { EventGrid } from '@/components/editorial/events';
import { pathFor, requireRoute } from '@/shell/registry';

import { HomeSection } from './section';

/**
 * EVENTS (restored from the pre-R2 portal): the soonest upcoming Events; when
 * none is upcoming, the most recent past ones instead — headed and labelled as
 * past, never presented as upcoming. Editorial's own first page, in its own
 * order, through the grid the Events listing uses. Nothing renders when
 * neither exists.
 */
export async function EventsModule({
  locale,
  when,
  items,
}: {
  readonly locale: Locale;
  readonly when: EventWhen;
  readonly items: readonly EventSummary[];
}) {
  if (items.length === 0) return null;
  const [t, events] = await Promise.all([
    getTranslations({ locale, namespace: 'shell' }),
    getTranslations({ locale, namespace: 'events' }),
  ]);
  const heading = events(`when.${when}`);

  return (
    <HomeSection
      id="home-events"
      header={{
        heading,
        action: {
          href: pathFor(locale, requireRoute('events')),
          text: t('home.links.allEvents'),
        },
      }}
    >
      <EventGrid
        locale={locale}
        items={items}
        when={when}
        label={heading}
        headingLevel="h3"
      />
    </HomeSection>
  );
}
