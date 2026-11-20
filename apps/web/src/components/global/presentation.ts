import type { Locale } from '@minhaj/contracts';
import {
  labelFor,
  type CentreLabel,
  type CentrePlace,
  type PlaceLabel,
} from '@minhaj/contracts/global';

/**
 * The presentation rules every Global Network page shares — one implementation,
 * so a place name, a page link and a finder address read the same everywhere.
 */

/**
 * The name a page renders and the language it is ACTUALLY in, so the markup can
 * say so (WCAG 3.1.2). A missing translation stays missing: the record's own
 * primary-language name is shown, marked as such, never a fabricated one.
 */
export function placeName(
  record: { readonly labels: readonly PlaceLabel[]; readonly primaryLocale: Locale },
  locale: Locale,
): { readonly text: string; readonly locale: Locale } {
  const label = labelFor(record, locale);
  return label === null
    ? { text: '', locale: record.primaryLocale }
    : { text: label.name, locale: label.locale };
}

/** A Centre's words in the reader's locale, by the same rule. */
export function centreWords(
  record: { readonly labels: readonly CentreLabel[]; readonly primaryLocale: Locale },
  locale: Locale,
): CentreLabel | null {
  return labelFor(record, locale);
}

/** The interface locales a record's names genuinely exist in. */
export function placeLocales(record: {
  readonly labels: readonly { readonly locale: Locale }[];
}): Locale[] {
  return record.labels.map((label) => label.locale);
}

/**
 * GLOBAL NETWORK (R2) — the identifiers of the Centres among `rows` a place
 * holds, by the listing's own rule (`tallyCentrePlaces`): a Region, a Centre in
 * it, in one of its Cities or serving one of its Cities; a City, a Centre in it
 * or serving it. `physical` keeps only those physically THERE — never one
 * merely serving it, never a virtual Centre — the Events filters' rule.
 */
export function centresAt(
  rows: readonly CentrePlace[],
  place: { readonly regionId?: string; readonly cityId?: string },
  physical = false,
): string[] {
  return rows
    .filter((row) => {
      if (physical) {
        if (row.isVirtual) return false;
        if (place.cityId !== undefined) return row.cityId === place.cityId;
        if (place.regionId !== undefined) return row.regionId === place.regionId;
        return true;
      }
      if (place.cityId !== undefined)
        return (
          row.cityId === place.cityId ||
          row.served.some((served) => served.cityId === place.cityId)
        );
      if (place.regionId !== undefined)
        return (
          row.regionId === place.regionId ||
          row.served.some((served) => served.regionId === place.regionId)
        );
      return true;
    })
    .map((row) => row.id);
}
