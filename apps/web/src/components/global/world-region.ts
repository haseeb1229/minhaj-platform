/**
 * WHERE IN THE WORLD A COUNTRY IS (R2) — the directory's grouping for its
 * Countries grid, derived from the ISO 3166-1 code every public Country already
 * carries. Nothing is stored and nothing is asked of the organisation: the
 * grouping is the World Bank's long-standing seven-region classification,
 * applied to the code, so a page can say "Europe & Central Asia" truthfully.
 *
 * A code this table does not place is `other` — shown, never dropped.
 */

export const WORLD_REGIONS = [
  'south-asia',
  'middle-east-north-africa',
  'europe-central-asia',
  'north-america',
  'latin-america-caribbean',
  'sub-saharan-africa',
  'east-asia-pacific',
  'other',
] as const;

export type WorldRegion = (typeof WORLD_REGIONS)[number];

const MEMBERS: Readonly<Record<Exclude<WorldRegion, 'other'>, string>> = {
  'south-asia': 'AF BD BT IN LK MV NP PK',
  'middle-east-north-africa':
    'AE BH DJ DZ EG IL IQ IR JO KW LB LY MA MT OM PS QA SA SY TN YE',
  'europe-central-asia':
    'AD AL AM AT AX AZ BA BE BG BY CH CY CZ DE DK EE ES FI FO FR GB GE GG GI GL GR HR HU IE IM IS IT JE KG KZ LI LT LU LV MC MD ME MK NL NO PL PT RO RS RU SE SI SK SM TJ TM TR UA UZ VA XK',
  'north-america': 'BM CA US',
  'latin-america-caribbean':
    'AG AR AW BB BO BR BS BZ CL CO CR CU CW DM DO EC GD GT GY HN HT JM KN KY LC MF MX NI PA PE PR PY SR SV SX TC TT UY VC VE VG VI',
  'sub-saharan-africa':
    'AO BF BI BJ BW CD CF CG CI CM CV ER ET GA GH GM GN GQ GW KE KM LR LS MG ML MR MU MW MZ NA NE NG RW SC SD SL SN SO SS ST SZ TD TG TZ UG ZA ZM ZW',
  'east-asia-pacific':
    'AS AU BN CN FJ FM GU HK ID JP KH KI KP KR LA MH MM MN MO MP MY NC NR NZ PF PG PH PW SB SG TH TL TO TV TW VN VU WS',
};

const BY_CODE: ReadonlyMap<string, WorldRegion> = new Map(
  (Object.entries(MEMBERS) as [Exclude<WorldRegion, 'other'>, string][]).flatMap(
    ([region, codes]) => codes.split(' ').map((code) => [code, region] as const),
  ),
);

/** The world region of an ISO 3166-1 alpha-2 code, case-insensitively. */
export function worldRegionOf(code: string): WorldRegion {
  return BY_CODE.get(code.trim().toUpperCase()) ?? 'other';
}

/**
 * Countries grouped by world region, in the fixed region order and keeping
 * each group in the order given. Empty regions are left out.
 */
export function groupByWorldRegion<T extends { readonly code: string }>(
  countries: readonly T[],
): readonly { readonly region: WorldRegion; readonly countries: readonly T[] }[] {
  const groups = new Map<WorldRegion, T[]>();
  for (const country of countries) {
    const region = worldRegionOf(country.code);
    const group = groups.get(region);
    if (group === undefined) groups.set(region, [country]);
    else group.push(country);
  }
  return WORLD_REGIONS.flatMap((region) => {
    const members = groups.get(region);
    return members === undefined ? [] : [{ region, countries: members }];
  });
}
