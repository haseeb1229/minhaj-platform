import 'server-only';

import { randomUUID } from 'node:crypto';

import type { Locale } from '@minhaj/contracts';
import type {
  PeopleActorInput,
  PeoplePersistencePort,
  PeopleReaderPort,
  PersonDetail,
  PersonLabel,
  PersonStatus,
  PersonView,
  ProfileDetail,
  ProfileFacetView,
  ProfileKind,
  ProfileRecordView,
  ProfileStatus,
  ProfileTranslationView,
  PublicPersonProfile,
} from '@minhaj/contracts/people';
import {
  MAX_NAME_VARIANTS_PER_LOCALE,
  MAX_PROFILE_LANGUAGES,
  PROFILE_KINDS,
  normaliseNameVariant,
} from '@minhaj/contracts/people';
import type { Prisma } from '@prisma/client';

import { auditRow } from '../../audit-row.ts';
import { getDatabaseClient } from '../../client.ts';
import { peopleRefusalOf } from './refusals.ts';

/**
 * People & Contributors' persistence — the Person aggregate, its per-interface-
 * locale translations, its name variants, and the FOUR distinct profile
 * aggregates.
 *
 * Semantic owner: `people-contributors`, declared in this package's manifest
 * under `minhaj.persistenceAdapters`. Physically here because it needs the
 * private Prisma client; owned by the context, which is the only place its
 * rules may change (ARCHITECTURE.md §4.1, §6.3 rule 14).
 *
 * WHAT IT DECIDES: nothing about WHO may act. The permission is settled before
 * any of these operations is reachable, which is why each mutation takes an
 * actor IDENTIFIER for the audit row rather than anything it could authorise
 * with. Nothing in this module reads a `RoleAssignment`, and nothing in it
 * writes one.
 *
 * WHAT IT DOES ENFORCE, and must: the invariants that are properties of the
 * DATA. A slug is unique; an account links to at most one Person; each Person
 * holds at most one profile of each kind; a translation exists once per locale.
 * Those are checked here as well as in the context because this module is the
 * only writer, and an invariant enforced only by its caller is an invariant one
 * new caller removes.
 *
 * WHAT IT DOES NOT ENFORCE, deliberately: the primary-locale translation and
 * the name-variant bound. Neither can be decided by reading rows another
 * transaction is in the middle of changing, so both live in triggers. This
 * module recognises the refusals and names them; it does not re-implement them.
 *
 * WHY IT NEVER TOUCHES THE `User` TABLE AS BUSINESS LOGIC. People's one
 * permitted dependency is Identity & Access, and it is consumed through
 * Identity's public service at Layer 4 — not by joining to Identity's tables
 * from here. The `Person.userId` foreign key exists so a FORGED identifier is
 * refused by the database, which is integrity rather than a cross-context read;
 * no query below selects a column of `User`, and no shape this file returns
 * carries an address, a display name or an account status.
 */

/** How many rows a bounded listing may return in one page. */
const MAX_PAGE = 100;

/**
 * How many Person URLs one sitemap read may return.
 *
 * Generous, and still a ceiling. ROUTE_MAP.md §9.4 requires large segments to
 * split numerically; that split belongs to the phase whose corpus first needs
 * it, and until then the honest engineering statement is that this read has a
 * known bound rather than none.
 */
const MAX_SITEMAP_ENTRIES = 5_000;

function boundedLimit(limit: number): number {
  if (!Number.isFinite(limit) || limit < 1) return 1;
  return Math.min(Math.trunc(limit), MAX_PAGE);
}

function boundedOffset(offset: number): number {
  if (!Number.isFinite(offset) || offset < 0) return 0;
  return Math.trunc(offset);
}

/**
 * Raised when a People operation is refused by a DATA invariant.
 *
 * Distinct from an authorisation denial, which never reaches this module: by
 * the time one of these is thrown the caller was permitted to try, and what
 * stopped them is what the data is allowed to be.
 */
export class PeopleDataError extends Error {
  readonly reason:
    | 'person-not-found'
    | 'duplicate-slug'
    | 'profile-not-found'
    | 'profile-exists'
    | 'profile-has-no-detail'
    | 'account-already-linked'
    | 'person-already-linked'
    | 'account-not-found'
    | 'variant-not-found'
    | 'duplicate-variant'
    | 'variant-limit'
    | 'primary-translation-required'
    | 'too-many-languages';

  constructor(reason: PeopleDataError['reason'], message: string) {
    super(message);
    this.name = 'PeopleDataError';
    this.reason = reason;
  }
}

/**
 * Maps a SQL Server error raised by a People trigger onto a named refusal.
 *
 * The recognition itself lives in `./refusals.ts`, which walks the error GRAPH
 * because Prisma and the driver put the server's number in different places
 * depending on how the statement was issued.
 */
function triggerRefusal(error: unknown): PeopleDataError | null {
  switch (peopleRefusalOf(error)) {
    case 'primary-translation-required':
      return new PeopleDataError(
        'primary-translation-required',
        'A Person must keep the translation for its primary locale.',
      );
    case 'name-variant-limit':
      return new PeopleDataError(
        'variant-limit',
        `A Person may hold at most ${MAX_NAME_VARIANTS_PER_LOCALE} name variants per locale.`,
      );
    case 'duplicate-slug':
      return new PeopleDataError(
        'duplicate-slug',
        'A contributor with this slug already exists.',
      );
    case 'duplicate-variant':
      return new PeopleDataError(
        'duplicate-variant',
        'That name variant is already recorded for this language.',
      );
    default:
      return null;
  }
}

/** Re-raises anything that is not a recognised data refusal, unchanged. */
function rethrow(error: unknown): never {
  if (error instanceof PeopleDataError) throw error;
  const refusal = triggerRefusal(error);
  if (refusal !== null) throw refusal;
  throw error;
}

/**
 * Turns a unique-constraint violation into a named refusal, and leaves every
 * other error alone.
 *
 * P2002 is Prisma's unique-constraint code. Catching it is what turns "the
 * database said no" into "that slug is already in use" — and doing it here
 * rather than reading first is what makes the check race-safe: two concurrent
 * creates of the same slug produce one row and one clear refusal.
 */
function refuseDuplicate(error: unknown, refusal: PeopleDataError): never {
  if ((error as { code?: string }).code === 'P2002') throw refusal;
  rethrow(error);
}

/* ===========================================================================
 * Row shapes
 * ========================================================================= */

/**
 * A Person row as the queries below select it.
 *
 * Stated STRUCTURALLY rather than as `Prisma.PersonGetPayload<…>`. The helper
 * type is accurate and it names `Prisma`, which would put the client's own
 * namespace on a module the encapsulation boundary re-exports — and a boundary
 * that names raw capability cannot be shown to be narrow (ARCHITECTURE.md §6.3
 * rule 13).
 */
interface ProfileChildRow {
  readonly id: string;
  readonly status: string;
  readonly translations?: readonly {
    readonly locale: string;
    readonly qualifications?: string | null;
    readonly expertise?: string | null;
    readonly biography?: string | null;
    readonly subjects?: string | null;
  }[];
  readonly languages?: readonly { readonly languageCode: string }[];
}

interface PersonRow {
  readonly id: string;
  readonly slug: string;
  readonly userId: string | null;
  readonly primaryLocale: string;
  readonly status: string;
  readonly updatedAt: Date;
  readonly translations: readonly {
    readonly locale: string;
    readonly name: string;
    readonly biography: string | null;
  }[];
  readonly nameVariants: readonly {
    readonly id: string;
    readonly locale: string;
    readonly value: string;
  }[];
  readonly authorProfile: ProfileChildRow | null;
  readonly speakerProfile: ProfileChildRow | null;
  readonly scholarProfile: ProfileChildRow | null;
  readonly teacherProfile: ProfileChildRow | null;
}

const PERSON_INCLUDE = {
  translations: {
    select: { locale: true, name: true, biography: true },
    orderBy: { locale: 'asc' },
  },
  nameVariants: {
    select: { id: true, locale: true, value: true },
    orderBy: [{ locale: 'asc' }, { value: 'asc' }],
  },
  authorProfile: { select: { id: true, status: true } },
  speakerProfile: { select: { id: true, status: true } },
  scholarProfile: {
    select: {
      id: true,
      status: true,
      translations: {
        select: { locale: true, qualifications: true, expertise: true },
        orderBy: { locale: 'asc' },
      },
      languages: { select: { languageCode: true }, orderBy: { languageCode: 'asc' } },
    },
  },
  teacherProfile: {
    select: {
      id: true,
      status: true,
      translations: {
        select: { locale: true, biography: true, subjects: true },
        orderBy: { locale: 'asc' },
      },
      languages: { select: { languageCode: true }, orderBy: { languageCode: 'asc' } },
    },
  },
  // `satisfies` RATHER THAN `as const`, and the difference is not stylistic.
  // `as const` makes the nested `orderBy` arrays READONLY, which Prisma's
  // generated argument types reject — so the include silently failed to apply
  // and every read fell back to the bare model shape. `satisfies` keeps the
  // literal narrowing the query builder needs while leaving the arrays mutable,
  // and it checks the shape here rather than at four call sites.
  //
  // It names `Prisma`, which this module may do and its public entry may not:
  // the type is used to VALIDATE an argument, and nothing it describes is
  // exported across the encapsulation boundary (ARCHITECTURE.md §6.3 rule 13).
} satisfies Prisma.PersonInclude;

/* ===========================================================================
 * Projections
 * ========================================================================= */

/**
 * Resolves one Person's label for one interface locale.
 *
 * REQUESTED LOCALE, THEN THE PERSON'S PRIMARY LOCALE, and the result says which
 * it used — because ROUTE_MAP.md §9.3 requires a VISIBLE notice when content is
 * shown in a language other than the one asked for, and a projection that hid
 * the difference would make that notice impossible to render honestly.
 *
 * THE PRIMARY LOCALE RATHER THAN ENGLISH. A Topic falls back to `en` because a
 * Topic is a label the interface renders. A Person's biography is CONTENT, much
 * of it Urdu-original or Arabic-original, and falling back to English would
 * show an empty page for a person whose record is complete in Urdu.
 *
 * WHY THE FALLBACK IS RELIABLE, stated precisely rather than generously. Two
 * mechanisms hold it up and neither covers the other's half:
 *
 *   - `createPerson` writes the Person and its primary-locale translation in
 *     ONE transaction, so no path this application has produces a Person
 *     without one — not even briefly, and not after a crash;
 *   - `PeoplePersonPrimaryName` refuses any delete or update that would REMOVE
 *     it, so no later writer — including one that never touches this adapter —
 *     can take it away.
 *
 * What neither can enforce is a direct INSERT that creates a Person and stops
 * there: the translation is a separate row, so an AFTER INSERT trigger on
 * `Person` would have to fire before it could exist. The last two branches are
 * for exactly that case, and showing a stable identifier is more honest than
 * showing an empty heading.
 */
function labelFor(row: PersonRow, locale: Locale): PersonLabel {
  const requested = row.translations.find((entry) => entry.locale === locale);
  if (requested !== undefined) {
    return {
      name: requested.name,
      biography: requested.biography,
      resolvedLocale: locale,
      fallback: false,
    };
  }

  const primary =
    row.translations.find((entry) => entry.locale === row.primaryLocale) ??
    row.translations[0];

  return {
    name: primary?.name ?? row.slug,
    biography: primary?.biography ?? null,
    resolvedLocale: (primary?.locale ?? row.primaryLocale) as Locale,
    fallback: true,
  };
}

/** The profile kinds that exist for a Person, in the canonical order. */
function kindsOf(row: PersonRow): readonly ProfileKind[] {
  return PROFILE_KINDS.filter((kind) => profileRowOf(row, kind) !== null);
}

/**
 * One kind's row, by an explicit branch per kind.
 *
 * A LOOKUP TABLE WOULD HAVE BEEN SHORTER and would have required the four rows
 * to share a type — which is the merge DOMAIN_MODEL.md §5.2 prohibits, arrived
 * at through TypeScript rather than through SQL. Four named branches keep the
 * four aggregates four things, and the compiler checks the switch is total.
 */
function profileRowOf(row: PersonRow, kind: ProfileKind): ProfileChildRow | null {
  switch (kind) {
    case 'author':
      return row.authorProfile;
    case 'speaker':
      return row.speakerProfile;
    case 'scholar':
      return row.scholarProfile;
    case 'teacher':
      return row.teacherProfile;
  }
}

/** One profile's stored prose, for the administrative editor. */
function profileTranslations(
  profile: ProfileChildRow | null,
): readonly ProfileTranslationView[] {
  return (profile?.translations ?? []).map((entry) => ({
    locale: entry.locale as Locale,
    qualifications: entry.qualifications ?? null,
    expertise: entry.expertise ?? null,
    biography: entry.biography ?? null,
    subjects: entry.subjects ?? null,
  }));
}

/**
 * One profile's localised prose, resolved for the reader's locale.
 *
 * SAME FALLBACK HONESTY AS `labelFor`, and for the same reason: a scholar's
 * qualifications shown in Arabic inside an English page must SAY that they are.
 * A field with no value in any locale is omitted entirely rather than rendered
 * as an empty row, because an empty qualification is a claim nobody made.
 */
function profileDetails(
  profile: ProfileChildRow,
  locale: Locale,
  primaryLocale: string,
): readonly ProfileDetail[] {
  const requested = profile.translations?.find((entry) => entry.locale === locale);
  const fallbackRow =
    profile.translations?.find((entry) => entry.locale === primaryLocale) ??
    profile.translations?.[0];

  const source = requested ?? fallbackRow;
  if (source === undefined) return [];

  const resolvedLocale = source.locale as Locale;
  const fallback = requested === undefined;

  const fields: readonly { field: ProfileDetail['field']; value: string | null }[] = [
    { field: 'qualifications', value: source.qualifications ?? null },
    { field: 'expertise', value: source.expertise ?? null },
    { field: 'biography', value: source.biography ?? null },
    { field: 'subjects', value: source.subjects ?? null },
  ];

  return fields
    .filter((entry): entry is { field: ProfileDetail['field']; value: string } =>
      typeof entry.value === 'string' ? entry.value.length > 0 : false,
    )
    .map((entry) => ({
      field: entry.field,
      value: entry.value,
      resolvedLocale,
      fallback,
    }));
}

function toPersonView(row: PersonRow, locale: Locale): PersonView {
  return {
    id: row.id,
    slug: row.slug,
    status: row.status as PersonStatus,
    primaryLocale: row.primaryLocale as Locale,
    label: labelFor(row, locale),
    translatedLocales: row.translations.map((entry) => entry.locale as Locale),
    // A BOOLEAN, NEVER THE IDENTIFIER. `PersonView` is what every listing
    // carries, and a listing is the shape most likely to be handed somewhere it
    // should not go.
    linked: row.userId !== null,
    profileKinds: kindsOf(row),
    updatedAt: row.updatedAt,
  };
}

function toPersonDetail(row: PersonRow, locale: Locale): PersonDetail {
  const profiles: readonly ProfileRecordView[] = PROFILE_KINDS.map((kind) => {
    const profile = profileRowOf(row, kind);
    return {
      kind,
      // NULL RATHER THAN ABSENT for a kind the Person does not hold, so the
      // editor can offer "add this facet" beside the ones that exist and cannot
      // confuse "no profile" with "a profile that failed to load".
      id: profile?.id ?? null,
      status: (profile?.status ?? null) as ProfileStatus | null,
      translations: profileTranslations(profile),
      languages: (profile?.languages ?? []).map((entry) => entry.languageCode),
    };
  });

  return {
    ...toPersonView(row, locale),
    translations: row.translations.map((entry) => ({
      locale: entry.locale as Locale,
      name: entry.name,
      biography: entry.biography,
    })),
    nameVariants: row.nameVariants.map((entry) => ({
      id: entry.id,
      locale: entry.locale as Locale,
      value: entry.value,
    })),
    profiles,
    linkedAccountId: row.userId,
  };
}

/**
 * The PUBLIC shape, and the one place it is built.
 *
 * ONE FUNCTION, so "what a visitor may see" is a single readable list rather
 * than a decision each page makes again. Nothing here reads `row.userId`, so
 * the account identifier cannot reach a public response by being on an object
 * somebody forgot to strip — it is never put there in the first place.
 *
 * ONLY ACTIVE FACETS. A draft facet has not been finished and an archived one
 * has been withdrawn; both are excluded here rather than by the page, so a new
 * public surface cannot render a withdrawn teacher facet by neglecting to check
 * one field.
 */
function toPublicProfile(row: PersonRow, locale: Locale): PublicPersonProfile {
  const facets: readonly ProfileFacetView[] = PROFILE_KINDS.flatMap((kind) => {
    const profile = profileRowOf(row, kind);
    if (profile === null || profile.status !== 'active') return [];

    return [
      {
        kind,
        status: profile.status as ProfileStatus,
        details: profileDetails(profile, locale, row.primaryLocale),
        languages: (profile.languages ?? []).map((entry) => entry.languageCode),
      },
    ];
  });

  return {
    slug: row.slug,
    label: labelFor(row, locale),
    // Variants for the locale being read, then the primary locale's — an Urdu
    // reader is shown the Urdu spellings of a name, and an English reader the
    // English ones, rather than every spelling the record holds.
    nameVariants: row.nameVariants
      .filter((entry) => entry.locale === locale || entry.locale === row.primaryLocale)
      .map((entry) => entry.value),
    facets,
    contentLocales: row.translations.map((entry) => entry.locale as Locale),
    primaryLocale: row.primaryLocale as Locale,
    updatedAt: row.updatedAt,
  };
}

/* ===========================================================================
 * The reader
 * ========================================================================= */

export function createPeopleReader(): PeopleReaderPort {
  const prisma = getDatabaseClient();

  /**
   * The `where` clause that selects one profile kind, by explicit branch.
   *
   * Each is an EXISTS over that kind's own table, which its unique index on
   * `personId` serves directly.
   */
  function kindFilter(kind: ProfileKind): Prisma.PersonWhereInput {
    switch (kind) {
      case 'author':
        return { authorProfile: { isNot: null } };
      case 'speaker':
        return { speakerProfile: { isNot: null } };
      case 'scholar':
        return { scholarProfile: { isNot: null } };
      case 'teacher':
        return { teacherProfile: { isNot: null } };
    }
  }

  return {
    async listPeople({ query, status, profileKind, locale, limit, offset }) {
      const cap = boundedLimit(limit);
      const skip = boundedOffset(offset);

      const rows = await prisma.person.findMany({
        where: {
          ...(status === null ? {} : { status }),
          ...(profileKind === null ? {} : kindFilter(profileKind)),
          // PREFIX SEARCH ON INDEXED COLUMNS. A `contains` search would be a
          // leading wildcard, which no index can seek, so a contributor table
          // of any size would become a scan on every keystroke. `Person.slug`
          // is unique and `PersonTranslation.name` carries its own index.
          ...(query === null
            ? {}
            : {
                OR: [
                  { slug: { startsWith: query } },
                  { translations: { some: { name: { startsWith: query } } } },
                ],
              }),
        },
        include: PERSON_INCLUDE,
        // SLUG, WHICH IS UNIQUE — so the order is TOTAL and a page boundary can
        // neither repeat a row nor skip one. A name would have been friendlier
        // and is not unique, not indexed for ordering, and different in every
        // locale.
        orderBy: { slug: 'asc' },
        // One more than asked for, so `more` is a fact rather than a second
        // count query over a table that grows.
        take: cap + 1,
        skip,
      });

      return {
        items: rows.slice(0, cap).map((row) => toPersonView(row, locale)),
        more: rows.length > cap,
      };
    },

    async findPerson({ personId, locale }) {
      const row = await prisma.person.findUnique({
        where: { id: personId },
        include: PERSON_INCLUDE,
      });
      if (row === null) return null;
      return toPersonDetail(row, locale);
    },

    async findPublicProfile({ slug, locale }) {
      // THE VISIBILITY PREDICATE IS IN THE QUERY. A draft or archived Person is
      // not returned at all, rather than returned and filtered afterwards: a
      // rule applied after the read is a rule the next caller can forget
      // (SECURITY_BASELINE.md §3.4 rule 3).
      const row = await prisma.person.findFirst({
        where: { slug, status: 'published' },
        include: PERSON_INCLUDE,
      });
      if (row === null) return null;
      return toPublicProfile(row, locale);
    },

    async publicPersonExists(slug) {
      // THE CHEAPEST TRUE ANSWER. The author aliases need to know whether to
      // redirect or to 404 and will not render anything, so loading a whole
      // profile to answer it would be work thrown away on every alias hit.
      const row = await prisma.person.findFirst({
        where: { slug, status: 'published' },
        select: { id: true },
      });
      return row !== null;
    },

    async listSitemapEntries(limit, offset) {
      const cap =
        Number.isFinite(limit) && limit > 0
          ? Math.min(Math.trunc(limit), MAX_SITEMAP_ENTRIES)
          : MAX_SITEMAP_ENTRIES;

      const rows = await prisma.person.findMany({
        where: { status: 'published' },
        select: {
          slug: true,
          updatedAt: true,
          translations: { select: { locale: true }, orderBy: { locale: 'asc' } },
        },
        orderBy: { slug: 'asc' },
        take: cap,
        skip: boundedOffset(offset),
      });

      return rows.map((row) => ({
        slug: row.slug,
        // ONLY THE LOCALES A TRANSLATION GENUINELY EXISTS IN. A sitemap that
        // listed a locale the Person falls back in would advertise a URL that
        // is not a language version of anything (ROUTE_MAP.md §9.2, §9.4).
        contentLocales: row.translations.map((entry) => entry.locale as Locale),
        // GENUINE CONTENT MODIFICATION, never build time — which is why every
        // mutation below touches `Person.updatedAt`, including the ones that
        // write a child row.
        updatedAt: row.updatedAt,
      }));
    },
  };
}

/* ===========================================================================
 * The write side
 * ========================================================================= */

export function createPeoplePersistence(): PeoplePersistencePort {
  const prisma = getDatabaseClient();

  async function requirePerson(
    tx: Prisma.TransactionClient,
    personId: string,
  ): Promise<{ id: string; slug: string; status: string; userId: string | null }> {
    const row = await tx.person.findUnique({
      where: { id: personId },
      select: { id: true, slug: true, status: true, userId: true },
    });
    if (row === null) {
      throw new PeopleDataError('person-not-found', 'The contributor no longer exists.');
    }
    return row;
  }

  async function recordAudit(
    tx: Prisma.TransactionClient,
    actor: PeopleActorInput,
    input: {
      readonly targetType: string;
      readonly targetId: string;
      readonly before?: Readonly<Record<string, string>>;
      readonly after?: Readonly<Record<string, string>>;
    },
  ): Promise<void> {
    await tx.auditLog.create({
      data: auditRow({
        action: actor.auditAction,
        actorType: actor.actorType,
        actorId: actor.actorId,
        targetType: input.targetType,
        targetId: input.targetId,
        before: input.before,
        after: input.after,
        // The PERMISSION the actor used — the honest answer to "what authorised
        // this", and the one thing an investigation needs that the action name
        // does not already say.
        authorisingSource: actor.authorisingSource,
      }),
    });
  }

  /**
   * Moves `Person.updatedAt`, whatever was actually written.
   *
   * CALLED BY EVERY MUTATION, including the ones that change a child row. The
   * public profile renders the Person, its translations, its variants and its
   * facets as ONE page, and `lastmod` must reflect genuine modification of that
   * page (ROUTE_MAP.md §9.4). A timestamp that moved only when the Person row
   * itself changed would tell a crawler that a profile rewritten in Urdu this
   * morning was last touched a year ago.
   *
   * The value is computed in Node rather than by `SYSUTCDATETIME()` so that
   * every row a single transaction touches carries the SAME instant.
   */
  async function touch(
    tx: Prisma.TransactionClient,
    personId: string,
    at: Date,
  ): Promise<void> {
    await tx.person.update({ where: { id: personId }, data: { updatedAt: at } });
  }

  async function detailOf(
    tx: Prisma.TransactionClient,
    personId: string,
    locale: Locale,
  ): Promise<PersonDetail> {
    const row = await tx.person.findUnique({
      where: { id: personId },
      include: PERSON_INCLUDE,
    });
    if (row === null) {
      throw new PeopleDataError('person-not-found', 'The contributor no longer exists.');
    }
    return toPersonDetail(row, locale);
  }

  /**
   * Reads one profile's id and status, by an explicit branch per kind.
   *
   * Four branches rather than a delegate chosen by a string, for the reason the
   * projection above gives: a lookup table would require the four rows to share
   * a type, which is the merge §5.2 prohibits arrived at through TypeScript.
   */
  async function findProfile(
    tx: Prisma.TransactionClient,
    personId: string,
    kind: ProfileKind,
  ): Promise<{ id: string; status: string } | null> {
    const select = { id: true, status: true } as const;
    switch (kind) {
      case 'author':
        return tx.authorProfile.findUnique({ where: { personId }, select });
      case 'speaker':
        return tx.speakerProfile.findUnique({ where: { personId }, select });
      case 'scholar':
        return tx.scholarProfile.findUnique({ where: { personId }, select });
      case 'teacher':
        return tx.teacherProfile.findUnique({ where: { personId }, select });
    }
  }

  async function requireProfile(
    tx: Prisma.TransactionClient,
    personId: string,
    kind: ProfileKind,
  ): Promise<{ id: string; status: string }> {
    const profile = await findProfile(tx, personId, kind);
    if (profile === null) {
      throw new PeopleDataError(
        'profile-not-found',
        `This contributor has no ${kind} profile.`,
      );
    }
    return profile;
  }

  /** The Person a profile row belongs to, used by the detail read after a write. */
  const LOCALE_FOR_WRITE_RESULT: Locale = 'en';

  return {
    /* ---- Person -------------------------------------------------------- */

    async createPerson(input) {
      try {
        return await prisma.$transaction(async (tx) => {
          const now = new Date();
          const personId = randomUUID();

          // THE ONLY RUNTIME CREATION PATH. Direct Person INSERT is denied to
          // the application principal; this narrow procedure creates the
          // parent and its primary translation atomically, so no direct SQL
          // caller can commit the parent-only state.
          await tx.$executeRaw`
            EXEC [dbo].[PeopleCreatePerson]
              @id = ${personId},
              @slug = ${input.slug},
              @primaryLocale = ${input.primaryLocale},
              @name = ${input.name},
              @biography = ${input.biography},
              @at = ${now}
          `;

          await recordAudit(tx, input, {
            targetType: 'person',
            targetId: personId,
            // THE SLUG AND THE LOCALE, AND NOT THE NAME OR THE BIOGRAPHY. The
            // audit record says what happened and to which record; it is not a
            // second copy of a contributor's personal details under different
            // retention (SECURITY_BASELINE.md §13.4, §19.1).
            after: {
              slug: input.slug,
              primaryLocale: input.primaryLocale,
              status: 'draft',
            },
          });

          return detailOf(tx, personId, input.primaryLocale);
        });
      } catch (error) {
        refuseDuplicate(
          error,
          new PeopleDataError(
            'duplicate-slug',
            `A contributor with the slug '${input.slug}' already exists.`,
          ),
        );
      }
    },

    async setPersonTranslation(input) {
      try {
        return await prisma.$transaction(async (tx) => {
          await requirePerson(tx, input.personId);
          const now = new Date();

          // UPSERT ON THE COMPOSITE KEY, which is what makes it race-safe: two
          // editors saving the Urdu name at once produce one row, and neither
          // had to read first to find out.
          await tx.personTranslation.upsert({
            where: {
              personId_locale: { personId: input.personId, locale: input.locale },
            },
            create: {
              personId: input.personId,
              locale: input.locale,
              name: input.name,
              biography: input.biography,
              createdAt: now,
              updatedAt: now,
            },
            update: {
              name: input.name,
              biography: input.biography,
              updatedAt: now,
            },
          });

          await touch(tx, input.personId, now);

          await recordAudit(tx, input, {
            targetType: 'person',
            targetId: input.personId,
            // WHICH LOCALE AND WHETHER A BIOGRAPHY IS NOW PRESENT. Never the
            // name and never the biography text: an audit payload carrying
            // either would be a copy of a real person's details in a table with
            // different access rules and a different retention period.
            after: {
              locale: input.locale,
              biography: input.biography === null ? 'absent' : 'present',
            },
          });

          return detailOf(tx, input.personId, input.locale);
        });
      } catch (error) {
        rethrow(error);
      }
    },

    async removePersonTranslation(input) {
      try {
        return await prisma.$transaction(async (tx) => {
          const person = await tx.person.findUnique({
            where: { id: input.personId },
            select: { id: true, primaryLocale: true },
          });
          if (person === null) {
            throw new PeopleDataError(
              'person-not-found',
              'The contributor no longer exists.',
            );
          }

          // CHECKED HERE AND ENFORCED BY THE TRIGGER, and the duplication is
          // deliberate. This branch produces a message an administrator can act
          // on; the trigger is what holds when a writer that never runs this
          // code removes the row.
          if (person.primaryLocale === input.locale) {
            throw new PeopleDataError(
              'primary-translation-required',
              'A contributor must keep the translation for their primary language.',
            );
          }

          const now = new Date();

          await tx.personTranslation.deleteMany({
            where: { personId: input.personId, locale: input.locale },
          });

          await touch(tx, input.personId, now);

          await recordAudit(tx, input, {
            targetType: 'person',
            targetId: input.personId,
            before: { locale: input.locale, translation: 'present' },
            after: { locale: input.locale, translation: 'absent' },
          });

          return detailOf(tx, input.personId, person.primaryLocale as Locale);
        });
      } catch (error) {
        rethrow(error);
      }
    },

    async setPersonStatus(input) {
      try {
        return await prisma.$transaction(async (tx) => {
          const person = await requirePerson(tx, input.personId);
          const now = new Date();

          await tx.person.update({
            where: { id: input.personId },
            data: { status: input.status, updatedAt: now },
          });

          await recordAudit(tx, input, {
            targetType: 'person',
            targetId: input.personId,
            before: { status: person.status },
            after: { status: input.status },
          });

          return detailOf(tx, input.personId, LOCALE_FOR_WRITE_RESULT);
        });
      } catch (error) {
        rethrow(error);
      }
    },

    /* ---- Name variants -------------------------------------------------- */

    async addNameVariant(input) {
      try {
        return await prisma.$transaction(async (tx) => {
          await requirePerson(tx, input.personId);
          const now = new Date();
          const variantId = randomUUID();

          // THE ONLY RUNTIME INSERT PATH. It acquires the per-Person/locale
          // lock before it reads the count or inserts, closing the two-writer
          // race at the eighth slot. Direct table INSERT is denied to the
          // application principal.
          await tx.$executeRaw`
            EXEC [dbo].[PeopleAddNameVariant]
              @id = ${variantId},
              @personId = ${input.personId},
              @locale = ${input.locale},
              @value = ${input.value},
              @normalised = ${normaliseNameVariant(input.value)},
              @at = ${now}
          `;

          await touch(tx, input.personId, now);

          await recordAudit(tx, input, {
            targetType: 'person',
            targetId: input.personId,
            after: { locale: input.locale, nameVariant: 'added' },
          });

          return detailOf(tx, input.personId, input.locale);
        });
      } catch (error) {
        if (error instanceof PeopleDataError) throw error;
        const refusal = triggerRefusal(error);
        if (refusal !== null) throw refusal;
        refuseDuplicate(
          error,
          new PeopleDataError(
            'duplicate-variant',
            'That name variant is already recorded for this language.',
          ),
        );
      }
    },

    async removeNameVariant(input) {
      try {
        return await prisma.$transaction(async (tx) => {
          const variant = await tx.personNameVariant.findUnique({
            where: { id: input.variantId },
            select: { id: true, personId: true, locale: true },
          });

          // SCOPED TO THE PERSON NAMED BY THE CALLER. A variant identifier
          // arrives from a form and is a user-controlled value; matching it
          // against the Person as well is what stops one submission removing a
          // row belonging to a different contributor.
          if (variant === null || variant.personId !== input.personId) {
            throw new PeopleDataError(
              'variant-not-found',
              'That name variant does not belong to this contributor.',
            );
          }

          const now = new Date();

          await tx.personNameVariant.delete({ where: { id: variant.id } });
          await touch(tx, input.personId, now);

          await recordAudit(tx, input, {
            targetType: 'person',
            targetId: input.personId,
            before: { locale: variant.locale, nameVariant: 'present' },
            after: { locale: variant.locale, nameVariant: 'removed' },
          });

          return detailOf(tx, input.personId, variant.locale as Locale);
        });
      } catch (error) {
        rethrow(error);
      }
    },

    /* ---- The optional account link -------------------------------------- */

    async linkAccount(input) {
      try {
        return await prisma.$transaction(async (tx) => {
          const person = await requirePerson(tx, input.personId);

          // AN EXISTING LINK IS NOT SILENTLY REPLACED. Re-pointing a
          // contributor record at a different account is a different act from
          // linking an unlinked one, and doing it by accident would detach an
          // account from its contributor without anybody asking to.
          if (person.userId !== null && person.userId !== input.accountId) {
            throw new PeopleDataError(
              'person-already-linked',
              'This contributor is already linked to an account. Unlink it first.',
            );
          }

          const now = new Date();

          // THE FOREIGN KEY VALIDATES THE ACCOUNT, not a lookup performed here.
          // The identifier arrives from a form; a forged one is refused by the
          // database, which is a check no caller can skip. NOTHING IS READ FROM
          // `User` — not the address, not the display name — because People
          // stores an opaque identifier and reaches Identity semantics only
          // through Identity's own service at Layer 4.
          await tx.person.update({
            where: { id: input.personId },
            data: { userId: input.accountId, updatedAt: now },
          });

          await recordAudit(tx, input, {
            targetType: 'person',
            targetId: input.personId,
            before: { accountLink: 'absent' },
            // THE STATE, NOT THE ACCOUNT IDENTIFIER. An audit row that named
            // the account would put the association between a public
            // contributor and a private account into a table with different
            // retention — the same association closure exists to release.
            after: { accountLink: 'present' },
          });

          return detailOf(tx, input.personId, LOCALE_FOR_WRITE_RESULT);
        });
      } catch (error) {
        if (error instanceof PeopleDataError) throw error;

        // P2003 is a foreign-key violation: the submitted account does not
        // exist. P2002 is the unique index: it is already linked to a different
        // contributor, which is the race the index exists to decide.
        if ((error as { code?: string }).code === 'P2003') {
          throw new PeopleDataError('account-not-found', 'That account does not exist.');
        }
        refuseDuplicate(
          error,
          new PeopleDataError(
            'account-already-linked',
            'That account is already linked to a different contributor.',
          ),
        );
      }
    },

    async unlinkAccount(input) {
      try {
        return await prisma.$transaction(async (tx) => {
          const person = await requirePerson(tx, input.personId);
          const now = new Date();

          // IDEMPOTENT. Unlinking an unlinked contributor succeeds and writes
          // no audit row, because nothing happened — an audit trail that
          // recorded non-events would make the real ones harder to find.
          if (person.userId === null) {
            return detailOf(tx, input.personId, LOCALE_FOR_WRITE_RESULT);
          }

          await tx.person.update({
            where: { id: input.personId },
            data: { userId: null, updatedAt: now },
          });

          await recordAudit(tx, input, {
            targetType: 'person',
            targetId: input.personId,
            before: { accountLink: 'present' },
            after: { accountLink: 'absent' },
          });

          return detailOf(tx, input.personId, LOCALE_FOR_WRITE_RESULT);
        });
      } catch (error) {
        rethrow(error);
      }
    },

    async releaseAccountLink(input) {
      try {
        return await prisma.$transaction(async (tx) => {
          // KEYED BY ACCOUNT, because the caller coordinating a closure knows
          // an account identifier and must not have to discover whether a
          // contributor record exists in order to ask.
          const person = await tx.person.findFirst({
            where: { userId: input.accountId },
            select: { id: true },
          });

          // IDEMPOTENT, and this is the branch that makes it so: a closure that
          // already released its link, or an account that never had one,
          // returns `false` rather than failing. The reconciliation that runs
          // after an interrupted closure depends on being able to ask twice.
          if (person === null) return false;

          const now = new Date();

          // THE PERSON SURVIVES, AND ONLY THE LINK IS RELEASED. A Person is a
          // PUBLIC contributor record with its own lifecycle; an account
          // closing is not a decision to withdraw somebody's authorship
          // (DOMAIN_MODEL.md §5.1). What is disposed of is the private
          // ASSOCIATION. The settled product default releases the operational
          // account link; any future historical association requires its own
          // accepted retention/provenance mechanism (DOMAIN_MODEL.md §5.4).
          await tx.person.update({
            where: { id: person.id },
            data: { userId: null, updatedAt: now },
          });

          await recordAudit(tx, input, {
            targetType: 'person',
            targetId: person.id,
            before: { accountLink: 'present' },
            after: { accountLink: 'released' },
          });

          return true;
        });
      } catch (error) {
        rethrow(error);
      }
    },

    async linkedAccountIds(limit, offset) {
      const cap = boundedLimit(limit);

      const rows = await prisma.person.findMany({
        where: { userId: { not: null } },
        select: { userId: true },
        orderBy: { slug: 'asc' },
        take: cap,
        skip: boundedOffset(offset),
      });

      return rows
        .map((row) => row.userId)
        .filter((value): value is string => value !== null);
    },

    /* ---- Profiles -------------------------------------------------------- */

    async createProfile(input) {
      try {
        return await prisma.$transaction(async (tx) => {
          await requirePerson(tx, input.personId);

          if ((await findProfile(tx, input.personId, input.kind)) !== null) {
            throw new PeopleDataError(
              'profile-exists',
              `This contributor already has a ${input.kind} profile.`,
            );
          }

          const now = new Date();
          // CREATED AS A DRAFT. A facet is described before it is shown, and a
          // facet that appeared publicly the moment it was created would make
          // "only active facets render" a matter of remembering to set a field.
          const data = {
            personId: input.personId,
            status: 'draft',
            createdAt: now,
            updatedAt: now,
          } as const;

          // FOUR BRANCHES, FOUR TABLES. The switch is total and the compiler
          // checks it; a delegate selected by a string would have required the
          // four aggregates to share a type.
          switch (input.kind) {
            case 'author':
              await tx.authorProfile.create({ data });
              break;
            case 'speaker':
              await tx.speakerProfile.create({ data });
              break;
            case 'scholar':
              await tx.scholarProfile.create({ data });
              break;
            case 'teacher':
              await tx.teacherProfile.create({ data });
              break;
          }

          await touch(tx, input.personId, now);

          // NOTHING ELSE HAPPENS HERE, and that is the phase's central security
          // claim. No `RoleAssignment` is written, no permission is granted, no
          // capability is stored. "Creating a Teacher profile confers no
          // teaching privilege" (DOMAIN_MODEL.md §4.5), and the reason it is
          // true is that there is no code here that could make it false.
          await recordAudit(tx, input, {
            targetType: 'person',
            targetId: input.personId,
            after: { profile: input.kind, status: 'draft' },
          });

          return detailOf(tx, input.personId, LOCALE_FOR_WRITE_RESULT);
        });
      } catch (error) {
        if (error instanceof PeopleDataError) throw error;
        refuseDuplicate(
          error,
          new PeopleDataError(
            'profile-exists',
            `This contributor already has a ${input.kind} profile.`,
          ),
        );
      }
    },

    async setProfileStatus(input) {
      try {
        return await prisma.$transaction(async (tx) => {
          await requirePerson(tx, input.personId);
          const profile = await requireProfile(tx, input.personId, input.kind);
          const now = new Date();

          const where = { id: profile.id };
          const data = { status: input.status, updatedAt: now };

          switch (input.kind) {
            case 'author':
              await tx.authorProfile.update({ where, data });
              break;
            case 'speaker':
              await tx.speakerProfile.update({ where, data });
              break;
            case 'scholar':
              await tx.scholarProfile.update({ where, data });
              break;
            case 'teacher':
              await tx.teacherProfile.update({ where, data });
              break;
          }

          await touch(tx, input.personId, now);

          await recordAudit(tx, input, {
            targetType: 'person',
            targetId: input.personId,
            before: { profile: input.kind, status: profile.status },
            after: { profile: input.kind, status: input.status },
          });

          return detailOf(tx, input.personId, LOCALE_FOR_WRITE_RESULT);
        });
      } catch (error) {
        rethrow(error);
      }
    },

    async setProfileTranslation(input) {
      try {
        return await prisma.$transaction(async (tx) => {
          await requirePerson(tx, input.personId);
          const profile = await requireProfile(tx, input.personId, input.kind);
          const now = new Date();

          // AUTHOR AND SPEAKER HAVE NO PROSE, AND SAY SO. DOMAIN_MODEL.md §5.2
          // names no field for either, so neither has a translation table.
          // Accepting the call silently would leave an administrator believing
          // they had saved something.
          if (input.kind === 'author' || input.kind === 'speaker') {
            throw new PeopleDataError(
              'profile-has-no-detail',
              `A ${input.kind} profile has no descriptive fields of its own.`,
            );
          }

          if (input.kind === 'scholar') {
            await tx.scholarProfileTranslation.upsert({
              where: {
                scholarProfileId_locale: {
                  scholarProfileId: profile.id,
                  locale: input.locale,
                },
              },
              create: {
                scholarProfileId: profile.id,
                locale: input.locale,
                qualifications: input.qualifications,
                expertise: input.expertise,
                createdAt: now,
                updatedAt: now,
              },
              update: {
                qualifications: input.qualifications,
                expertise: input.expertise,
                updatedAt: now,
              },
            });
          } else {
            await tx.teacherProfileTranslation.upsert({
              where: {
                teacherProfileId_locale: {
                  teacherProfileId: profile.id,
                  locale: input.locale,
                },
              },
              create: {
                teacherProfileId: profile.id,
                locale: input.locale,
                biography: input.biography,
                subjects: input.subjects,
                createdAt: now,
                updatedAt: now,
              },
              update: {
                biography: input.biography,
                subjects: input.subjects,
                updatedAt: now,
              },
            });
          }

          await touch(tx, input.personId, now);

          await recordAudit(tx, input, {
            targetType: 'person',
            targetId: input.personId,
            // WHICH FACET AND WHICH LOCALE. Never the qualifications text: a
            // person's claimed credentials are exactly the kind of personal
            // content §13.4 keeps out of the audit record.
            after: { profile: input.kind, locale: input.locale, detail: 'saved' },
          });

          return detailOf(tx, input.personId, input.locale);
        });
      } catch (error) {
        rethrow(error);
      }
    },

    async setProfileLanguages(input) {
      try {
        return await prisma.$transaction(async (tx) => {
          await requirePerson(tx, input.personId);
          const profile = await requireProfile(tx, input.personId, input.kind);

          if (input.kind === 'author' || input.kind === 'speaker') {
            throw new PeopleDataError(
              'profile-has-no-detail',
              `A ${input.kind} profile does not list content languages.`,
            );
          }

          // DE-DUPLICATED AND BOUNDED BEFORE THE WRITE. The composite primary
          // key would refuse a duplicate anyway; rejecting the whole submission
          // because it named Urdu twice would be a worse answer than accepting
          // the set the administrator plainly meant.
          const languages = [...new Set(input.languages)];
          if (languages.length > MAX_PROFILE_LANGUAGES) {
            throw new PeopleDataError(
              'too-many-languages',
              `A profile may list at most ${MAX_PROFILE_LANGUAGES} languages.`,
            );
          }

          const now = new Date();

          // WRITTEN AS A WHOLE SET, because that is what it is: a language is
          // listed or it is not, and there is no third state for a
          // composite-key membership row to be moved into. Delete-then-insert
          // inside one transaction is atomic from every other reader's point of
          // view, so no request ever observes the empty intermediate state.
          if (input.kind === 'scholar') {
            await tx.scholarProfileLanguage.deleteMany({
              where: { scholarProfileId: profile.id },
            });
            if (languages.length > 0) {
              await tx.scholarProfileLanguage.createMany({
                data: languages.map((languageCode) => ({
                  scholarProfileId: profile.id,
                  languageCode,
                })),
              });
            }
            await tx.scholarProfile.update({
              where: { id: profile.id },
              data: { updatedAt: now },
            });
          } else {
            await tx.teacherProfileLanguage.deleteMany({
              where: { teacherProfileId: profile.id },
            });
            if (languages.length > 0) {
              await tx.teacherProfileLanguage.createMany({
                data: languages.map((languageCode) => ({
                  teacherProfileId: profile.id,
                  languageCode,
                })),
              });
            }
            await tx.teacherProfile.update({
              where: { id: profile.id },
              data: { updatedAt: now },
            });
          }

          await touch(tx, input.personId, now);

          await recordAudit(tx, input, {
            targetType: 'person',
            targetId: input.personId,
            // A COUNT, NOT THE LIST. Which languages a teacher works in is
            // public on their profile; the audit record needs to show that the
            // set changed, not to hold a second copy of it.
            after: { profile: input.kind, languages: String(languages.length) },
          });

          return detailOf(tx, input.personId, LOCALE_FOR_WRITE_RESULT);
        });
      } catch (error) {
        rethrow(error);
      }
    },
  };
}
