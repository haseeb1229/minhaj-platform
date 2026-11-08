/**
 * THE TIME-ZONE LIST FOR THE ACCOUNT SETTINGS (R2, audit F37) — PURE and free
 * of imports, so the settings page's client island can filter it without
 * pulling anything else into the browser.
 */

export interface TimeZoneChoice {
  /** The IANA identifier — the value the settings form submits. */
  readonly id: string;
  /** The identifier's first segment ("Asia"), or "UTC". */
  readonly region: string;
  /** The place, readable: "Asia/Karachi" → "Karachi", "America/Argentina/Salta" → "Argentina / Salta". */
  readonly place: string;
  /** The offset from UTC at `now`: "GMT+05:00", or "GMT". */
  readonly offset: string;
}

/**
 * The choices a search narrows the list to: every word of the query must
 * appear in the identifier, the place or the offset, ignoring case, spaces
 * and underscores. `keep` (the selected zone) is never filtered out, so the
 * form never silently submits a different zone than the one shown.
 */
export function filterTimeZones(
  choices: readonly TimeZoneChoice[],
  query: string,
  keep: string | null,
): readonly TimeZoneChoice[] {
  const fold = (value: string) => value.toLowerCase().replaceAll('_', ' ');
  const words = fold(query)
    .split(/[\s/]+/u)
    .filter(Boolean);
  if (words.length === 0) return choices;
  return choices.filter((choice) => {
    if (choice.id === keep) return true;
    const haystack = fold(`${choice.id} ${choice.place} ${choice.offset}`);
    return words.every((word) => haystack.includes(word));
  });
}

/** Whether the runtime knows `value` as a time zone — the account settings' own test. */
export function isTimeZone(value: string): boolean {
  if (value === '') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** The offset of `timeZone` from UTC at `now`, as the runtime writes it. */
export function utcOffset(timeZone: string, now: Date): string {
  const part = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'longOffset',
  })
    .formatToParts(now)
    .find((entry) => entry.type === 'timeZoneName');
  return part?.value ?? 'GMT';
}

/**
 * Every IANA zone this runtime knows, grouped by region and sorted by place —
 * the same table the account settings validate against, so every offered
 * value is one the server accepts. `current` is kept even if the runtime's
 * list does not name it (an alias), so saving the form never changes a zone
 * the person did not touch.
 */
export function timeZoneChoices(
  now: Date,
  current: string | null,
): readonly TimeZoneChoice[] {
  const ids = new Set<string>(Intl.supportedValuesOf('timeZone'));
  ids.add('UTC');
  if (current !== null && isTimeZone(current)) ids.add(current);
  return [...ids]
    .map((id): TimeZoneChoice => {
      const [region = id, ...rest] = id.split('/');
      return {
        id,
        region: rest.length === 0 ? 'UTC' : region,
        place: (rest.length === 0 ? id : rest.join(' / ')).replaceAll('_', ' '),
        offset: utcOffset(id, now),
      };
    })
    .sort(
      (a, b) =>
        a.region.localeCompare(b.region, 'en') || a.place.localeCompare(b.place, 'en'),
    );
}
