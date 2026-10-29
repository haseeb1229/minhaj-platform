/**
 * `@minhaj/contracts/people` — the People & Contributors contract surface.
 *
 * Layer 0, and browser-safe: types, Zod schemas, two pure functions and three
 * frozen vocabularies. It reaches no infrastructure and holds no policy, so an
 * admin form pulling a slug schema from here gets a slug schema and nothing
 * else.
 *
 * The PORTS it declares are implemented by a private adapter inside
 * `packages/database` and consumed by the People context inside
 * `apps/web/src/contexts/people-contributors`. Neither imports the other; both
 * import this (ARCHITECTURE.md §3.1.1).
 *
 * WHAT IS DELIBERATELY ABSENT, and each absence is a rule rather than an
 * oversight:
 *
 *   - ANY SHAPE FOR A CONTRIBUTION ROW. DOMAIN_MODEL.md §5.3 puts the
 *     relationship in the context that owns the target, and §6.2 prohibits the
 *     `targetType` + `targetId` pair a generic one would need.
 *     `CONTRIBUTION_ROLES` is the stable vocabulary those future junctions
 *     carry, and there is nothing here to hang one on.
 *
 *   - ANY CAPABILITY BOOLEAN. `canTeach` and its three siblings are Identity's
 *     projections of Identity's grants; they live in
 *     `@minhaj/contracts/identity` and are consumed through
 *     `ContributorAccountPort`. A profile grants nothing (§4.5), and the way to
 *     keep that true is to give People no shape that could store the opposite.
 *
 *   - ANY ACCOUNT FIELD. No email, no display name, no account status. The
 *     optional link is an opaque identifier that appears on the administrative
 *     detail shape and on no public one.
 *
 *   - ANY IMAGE, ASSET OR UPLOAD. Storage arrives at Phase 7 and profile media
 *     with the phase that owns it; a URL field added now would be an
 *     authoritative external reference nobody reviewed (DELIVERY_PLAN.md).
 *
 *   - ANY TAXONOMY TYPE. People's allowlist row is "Layer 0; Identity &
 *     Access", so this contract neither imports nor re-exports anything
 *     Taxonomy owns — including its language-code schema, which is duplicated
 *     deliberately rather than shared across an edge that does not exist.
 */

export {
  CONTRIBUTION_ROLES,
  MAX_NAME_VARIANTS_PER_LOCALE,
  MAX_PROFILE_LANGUAGES,
  PROFILE_KINDS,
  contributorLanguageCodeSchema,
  normaliseNameVariant,
  personBiographySchema,
  personLocaleSchema,
  personNameSchema,
  personCardExcerpt,
  personNameVariantSchema,
  personPortraitSchema,
  PERSON_CARD_EXCERPT,
  personSlugSchema,
  personStatusSchema,
  profileStatusSchema,
  scholarExpertiseSchema,
  scholarQualificationsSchema,
  teacherBiographySchema,
  teacherSubjectsSchema,
} from './values.ts';

export type {
  ContributionRole,
  PersonDetail,
  PersonLabel,
  PersonNameVariantView,
  PersonPage,
  PersonPortrait,
  PersonSitemapEntry,
  PersonStatus,
  PersonTranslationView,
  PersonView,
  ProfileDetail,
  ProfileFacetView,
  ProfileKind,
  ProfileRecordView,
  ProfileStatus,
  ProfileTextField,
  ProfileTranslationView,
  PublicPersonCard,
  PublicPersonCardPage,
  PublicPersonProfile,
  PublicTeacherEntry,
} from './values.ts';

export type {
  ContributorAccountPort,
  CreatePersonInput,
  PeopleActorInput,
  PeoplePersistencePort,
  PeopleReaderPort,
  PersonQuery,
} from './ports.ts';
