/**
 * THE READER'S OWN TIME ZONE, asked of the BROWSER after hydration and never
 * sent anywhere — shared by Learn Part 2's live schedule
 * (`components/live-learning/schedule-days.tsx`) and News & Events Part 2's
 * Event times (`components/editorial/event-reader-time.tsx`), so both read the
 * zone and name a calendar day by ONE rule.
 *
 * The server cannot know a reader's zone and reads no session, so a page is
 * the same document for everybody; these helpers only ever add to it in the
 * browser, after it has hydrated.
 */

/** `YYYY-MM-DD` of an instant in a zone, or `null` when the zone cannot be formatted. */
export function dayIn(instant: number, zone: string): string | null {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(instant);
    const part = (type: string) => parts.find((entry) => entry.type === type)?.value;
    const [year, month, day] = [part('year'), part('month'), part('day')];
    return year === undefined || month === undefined || day === undefined
      ? null
      : `${year}-${month}-${day}`;
  } catch {
    return null;
  }
}

/** The browser's zone, as `useSyncExternalStore` reads it: a stable string. */
export function readerZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** Nothing to subscribe to: a zone does not change while a page is open. */
export const noSubscription = () => () => undefined;
