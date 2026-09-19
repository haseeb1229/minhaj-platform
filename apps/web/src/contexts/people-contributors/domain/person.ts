import type { Locale } from '@minhaj/contracts';
import type { PersonDetail, PersonView, ProfileKind } from '@minhaj/contracts/people';
import { PROFILE_KINDS } from '@minhaj/contracts/people';

/**
 * People's pure domain rules.
 *
 * Layer 1, and deliberately tiny — for the same reason Taxonomy's is. Almost
 * everything a contributor record must guarantee is a property of the DATA
 * rather than of a calculation: slug uniqueness, one translation per locale, one
 * account per Person, one profile of each kind per Person, a translation in the
 * primary locale that cannot be removed. Every one of those is enforced by the
 * database, where a concurrent writer cannot step around it.
 *
 * What is left here is the reasoning the interface and the application service
 * genuinely share, and nothing has been invented to make the folder look
 * substantial.
 *
 * No infrastructure, no framework, no persistence: these are functions over
 * values (DOMAIN_MODEL.md §3.1).
 */

/**
 * Which interface locales a Person has NOT been translated into.
 *
 * WHY THE GAP MUST BE VISIBLE. A contributor record is frequently entered in
 * one language and translated later, or never — a historical author may exist
 * only in Urdu, and inventing English wording for a real person's biography is
 * exactly what nobody should do (OPEN_DECISIONS.md §6.3). An administrative
 * surface that silently rendered the primary-locale fallback everywhere would
 * turn a known, deliberate omission into one nobody notices.
 *
 * It is also what the public route depends on being true: a locale listed here
 * is a locale that must NOT appear in `hreflang`, because a URL that merely
 * falls back is not a language version (ROUTE_MAP.md §9.2).
 *
 * Returned in the order the platform declares its locales, so a coverage
 * indicator reads the same way on every row.
 */
export function missingTranslations(
  person: Pick<PersonView, 'translatedLocales'>,
  supported: readonly Locale[],
): readonly Locale[] {
  const present = new Set(person.translatedLocales);
  return supported.filter((locale) => !present.has(locale));
}

/**
 * The profile facets this Person does not yet hold.
 *
 * WHAT THE ADMINISTRATIVE EDITOR OFFERS TO ADD. `PersonDetail.profiles` carries
 * an entry for all four kinds — with a null id for the ones that do not exist —
 * so that the editor can tell "no scholar profile" from "a scholar profile that
 * failed to load". This turns that into the list of kinds an operator may
 * create, in the canonical order, so the four buttons never appear in a
 * different order on a different screen.
 *
 * ADDING A FACET IS NOT A GRANT. Every one of these creates a row in one People
 * table and changes no `RoleAssignment` (DOMAIN_MODEL.md §4.5).
 */
export function addableProfileKinds(
  detail: Pick<PersonDetail, 'profiles'>,
): readonly ProfileKind[] {
  const present = new Set(
    detail.profiles
      .filter((profile) => profile.id !== null)
      .map((profile) => profile.kind),
  );
  return PROFILE_KINDS.filter((kind) => !present.has(kind));
}
