import 'server-only';

import { createPermissionHolderReader } from '@minhaj/database';
import type { Locale } from '@minhaj/contracts';
import type {
  CourseListing,
  LiveLearningAuthority,
  OperationalTeacher,
} from '@minhaj/contracts/learning';
import type { PublicTeacherEntry } from '@minhaj/contracts/people';

import type { PublicLiveSchedule } from '@/contexts/learning';

import { liveClassesReadRuntime } from './learning-read';
import { peopleReadRuntime } from './people-read';
import { taxonomyRuntime } from './taxonomy';

/**
 * Find-a-Teacher — the Layer-4 composition behind `/learn/teachers`
 * (ROUTE_MAP.md §3.5; DELIVERY_PLAN.md Phase 23).
 *
 * A LISTED TEACHER IS CURRENT ON EVERY AXIS AT ONCE, and three owners each
 * answer their own question in one bounded call:
 *
 *   - Learning: accounts holding a CURRENT typed scope on a published live
 *     Course, with those Courses and whether a future window is open — and
 *     only while live learning is activated;
 *   - Identity: which of those accounts hold a LIVE `teaching.perform`
 *     assignment NOW, through Identity's own holder reader (the Phase-20
 *     precedent) — no session, no authentication library, no permission read
 *     for the visitor, because the visitor has none;
 *   - People: which are linked to a PUBLISHED Person with an ACTIVE
 *     TeacherProfile, and that profile's public name, address, subjects and
 *     languages.
 *
 * The intersection is the directory. A Course's public `CourseTeacher`
 * attribution is NOT consulted: attribution is the catalogue's statement and
 * stays visible on the Course; this is operational status, and the two are
 * different facts (DOMAIN_MODEL.md §13.2).
 *
 * WHAT NEVER LEAVES. The account identifier is the join key and is dropped
 * from the result; no window, schedule, participant or meeting address is
 * read at all.
 *
 * FILTERS NARROW, NEVER WIDEN. `subject` is a canonical Topic slug — a
 * teacher matches when a Course they currently teach is filed under it
 * (Learning's `topicIds` on the operational teacher, since Learn Part 2);
 * `language` a content-language code — a Course they teach is taught in it,
 * or their profile lists it; `availability=available` — at least one future
 * open, unbooked window. An unknown value is reported invalid and the page
 * explains an empty result (the Phase-22 catalogue precedent). Since Learn
 * Part 2 each filter's options are counted over the teachers the directory
 * could list, each count leaving its own filter out.
 */

export interface PublicTeacherListing {
  readonly profile: PublicTeacherEntry;
  readonly courses: readonly CourseListing[];
  readonly available: boolean;
}

/** One facet value and how many listed teachers choosing it would show. */
export interface TeacherFacet {
  readonly value: string;
  readonly teachers: number;
}

/**
 * The directory's aggregates — over the teachers it could list, each facet
 * leaving its OWN filter out, so every option says how many teachers choosing
 * it would show (Learn Part 2):
 *
 *   `listed`     every teacher the directory lists, unfiltered;
 *   `subjects`   Topic → teachers, a Topic their current Courses are filed under;
 *   `languages`  content language → teachers, taught in or listed on the profile;
 *   `available`  teachers with an open time;
 *   `courses`    the distinct live Courses the listed teachers teach.
 */
export interface TeacherDirectoryFacets {
  readonly listed: number;
  readonly subjects: readonly TeacherFacet[];
  readonly languages: readonly TeacherFacet[];
  readonly available: number;
  readonly courses: number;
}

export interface TeacherDirectoryResult {
  readonly mode: LiveLearningAuthority | null;
  readonly teachers: readonly PublicTeacherListing[];
  /** A filter named something no owner knows. */
  readonly invalid: boolean;
  readonly facets: TeacherDirectoryFacets;
  /** The subject the address names, as Taxonomy resolved it. */
  readonly subject: { readonly id: string; readonly slug: string } | null;
}

const NO_FACETS: TeacherDirectoryFacets = Object.freeze({
  listed: 0,
  subjects: [],
  languages: [],
  available: 0,
  courses: 0,
});

let holders: ReturnType<typeof createPermissionHolderReader> | null = null;

/** A teacher as the directory weighs them: their listing and the Topics they teach under. */
interface Candidate {
  readonly listing: PublicTeacherListing;
  readonly topicIds: readonly string[];
}

function teachesIn(candidate: Candidate, language: string): boolean {
  return (
    candidate.listing.courses.some((course) => course.languageCode === language) ||
    candidate.listing.profile.languages.includes(language)
  );
}

/** Value → how many candidates hold it, most first, then by value. */
function facetOf(
  candidates: readonly Candidate[],
  valuesOf: (candidate: Candidate) => readonly string[],
): readonly TeacherFacet[] {
  const counts = new Map<string, number>();
  for (const candidate of candidates)
    for (const value of new Set(valuesOf(candidate)))
      counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts]
    .map(([value, teachers]) => ({ value, teachers }))
    .sort((a, b) => b.teachers - a.teachers || a.value.localeCompare(b.value));
}

export async function teacherDirectory(
  locale: Locale,
  filters: {
    readonly subject: string | null;
    readonly language: string | null;
    readonly availability: 'available' | null;
  },
): Promise<TeacherDirectoryResult> {
  const empty = (
    mode: LiveLearningAuthority | null,
    invalid: boolean,
    subject: TeacherDirectoryResult['subject'] = null,
  ): TeacherDirectoryResult => ({
    mode,
    teachers: [],
    invalid,
    facets: NO_FACETS,
    subject,
  });
  const { mode, teachers } = await liveClassesReadRuntime().teachers();
  if (mode === null) return empty(mode, false);

  // Taxonomy: the subject, if any, is an ACTIVE Topic the owner knows, and the
  // language a content language it knows — asked first, so an unknown value
  // is answered as such even while nobody is teaching.
  let subject: TeacherDirectoryResult['subject'] = null;
  if (filters.subject !== null) {
    const topic = await taxonomyRuntime().taxonomy.findTopicBySlug({
      slug: filters.subject,
      locale,
    });
    if (topic === null || topic.status !== 'active') return empty(mode, true);
    subject = { id: topic.id, slug: topic.slug };
  }
  if (filters.language !== null) {
    const known = await taxonomyRuntime().taxonomy.listLanguages({
      includeRetired: true,
    });
    if (!known.some((entry) => entry.code === filters.language)) return empty(mode, true);
  }
  if (teachers.length === 0) return empty(mode, false, subject);

  // Identity: live holders of the key, NOW. A bounded picker read, like
  // Fatwa's answerers; it decides nothing, and the directory is presentation.
  const live = new Set(
    (
      await (holders ??= createPermissionHolderReader()).holders('teaching.perform', 200)
    ).map((holder) => holder.accountId),
  );
  const operational: OperationalTeacher[] = teachers.filter((teacher) =>
    live.has(teacher.accountId),
  );
  if (operational.length === 0) return empty(mode, false, subject);

  // People: published TeacherProfiles, with their public words.
  const profiles = new Map(
    (
      await peopleReadRuntime().people.publicTeachers(
        operational.map((teacher) => teacher.accountId),
        locale,
      )
    ).map((entry) => [entry.accountId, entry]),
  );

  // The account identifier is the join key, and it stops here.
  const candidates: Candidate[] = operational.flatMap((teacher) => {
    const profile = profiles.get(teacher.accountId);
    return profile === undefined
      ? []
      : [
          {
            listing: { profile, courses: teacher.courses, available: teacher.available },
            topicIds: teacher.topicIds,
          },
        ];
  });
  candidates.sort((a, b) => a.listing.profile.slug.localeCompare(b.listing.profile.slug));

  const keeps = {
    subject: (candidate: Candidate) =>
      subject === null || candidate.topicIds.includes(subject.id),
    language: (candidate: Candidate) =>
      filters.language === null || teachesIn(candidate, filters.language),
    availability: (candidate: Candidate) =>
      filters.availability === null || candidate.listing.available,
  } as const;
  const keys = Object.keys(keeps) as (keyof typeof keeps)[];
  const without = (left: keyof typeof keeps | null) =>
    candidates.filter((candidate) =>
      keys.every((key) => key === left || keeps[key](candidate)),
    );

  return {
    mode,
    teachers: without(null).map((candidate) => candidate.listing),
    invalid: false,
    subject,
    facets: {
      listed: candidates.length,
      subjects: facetOf(without('subject'), (candidate) => candidate.topicIds),
      languages: facetOf(without('language'), (candidate) => [
        ...candidate.listing.courses.map((course) => course.languageCode),
        ...candidate.listing.profile.languages,
      ]),
      available: without('availability').filter(
        (candidate) => candidate.listing.available,
      ).length,
      courses: new Set(
        candidates.flatMap((candidate) =>
          candidate.listing.courses.map((course) => course.id),
        ),
      ).size,
    },
  };
}

/**
 * The public profiles of the teachers named by account — for the public live
 * schedule and a learner's My Teachers. An account with no published
 * TeacherProfile is simply absent; the caller says "teacher" without a name.
 */
export async function teacherProfilesFor(
  accountIds: readonly string[],
  locale: Locale,
): Promise<ReadonlyMap<string, PublicTeacherEntry>> {
  const unique = [...new Set(accountIds)];
  if (unique.length === 0) return new Map();
  const entries = await peopleReadRuntime().people.publicTeachers(unique, locale);
  return new Map(entries.map((entry) => [entry.accountId, entry]));
}

/**
 * THE PUBLIC SCHEDULE, NARROWED AT LAYER 4 (Learn Part 2) — `/learn/live`.
 *
 * The address names a teacher by their PUBLIC People slug; Learning narrows by
 * the teacher's ACCOUNT. The two meet here, and only here: the schedule is read
 * once without the teacher filter — its teacher facet is exactly the accounts
 * teaching a matching class, each resolved by People to a public profile — and
 * the slug is matched among THOSE profiles, so no account is looked up from an
 * address and none leaves this module except as the key of the profile map. A
 * slug that matches none of them lists nothing (`teacher: 'unmatched'`), and
 * the page decides whether it names a real Person at all.
 */
export interface PublicScheduleResult extends PublicLiveSchedule {
  /** The public profiles of every teacher the page or its facet names, by account. */
  readonly profiles: ReadonlyMap<string, PublicTeacherEntry>;
  /** The teacher the address named: none, one teaching a matching class, or neither. */
  readonly teacher: 'none' | 'matched' | 'unmatched';
}

export async function publicSchedule(
  locale: Locale,
  view: {
    readonly courseId: string | null;
    readonly teacherSlug: string | null;
    readonly language: string | null;
    readonly offset: number;
  },
): Promise<PublicScheduleResult> {
  const reads = liveClassesReadRuntime();
  const base = { course: view.courseId, language: view.language };
  const profilesOf = (schedule: PublicLiveSchedule) =>
    teacherProfilesFor(
      [
        ...schedule.page.items.map((session) => session.teacherAccountId),
        ...schedule.facets.teachers.map((facet) => facet.accountId),
      ],
      locale,
    );

  if (view.teacherSlug === null) {
    const schedule = await reads.liveSchedule({ ...base, offset: view.offset });
    return { ...schedule, profiles: await profilesOf(schedule), teacher: 'none' };
  }

  const across = await reads.liveSchedule({ ...base, offset: 0 });
  const acrossProfiles = await profilesOf(across);
  const named = [...acrossProfiles.values()].find(
    (profile) => profile.slug === view.teacherSlug,
  );
  if (named === undefined)
    return {
      mode: across.mode,
      page: { items: [], hasMore: false },
      facets: { ...across.facets, matching: 0 },
      profiles: acrossProfiles,
      teacher: 'unmatched',
    };
  const schedule = await reads.liveSchedule({
    ...base,
    teacher: named.accountId,
    offset: view.offset,
  });
  return {
    ...schedule,
    // The teacher facet leaves its own filter out: it is the one already read.
    facets: { ...schedule.facets, teachers: across.facets.teachers },
    profiles: new Map([...acrossProfiles, ...(await profilesOf(schedule))]),
    teacher: 'matched',
  };
}
