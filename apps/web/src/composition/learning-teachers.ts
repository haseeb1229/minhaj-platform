import 'server-only';

import { createPermissionHolderReader } from '@minhaj/database';
import type { Locale } from '@minhaj/contracts';
import type {
  CourseListing,
  LiveLearningAuthority,
  OperationalTeacher,
} from '@minhaj/contracts/learning';
import type { PublicTeacherEntry } from '@minhaj/contracts/people';

import { learningReadRuntime, liveClassesReadRuntime } from './learning-read';
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
 * teacher matches when a Course they currently teach is filed under it;
 * `language` a content-language code — a Course they teach is taught in it,
 * or their profile lists it; `availability=available` — at least one future
 * open, unbooked window. An unknown value is reported invalid and the page
 * explains an empty result (the Phase-22 catalogue precedent).
 */

export interface PublicTeacherListing {
  readonly profile: PublicTeacherEntry;
  readonly courses: readonly CourseListing[];
  readonly available: boolean;
}

export interface TeacherDirectoryResult {
  readonly mode: LiveLearningAuthority | null;
  readonly teachers: readonly PublicTeacherListing[];
  /** A filter named something no owner knows. */
  readonly invalid: boolean;
}

/** The most Course pages consulted to answer a topic filter. */
const TOPIC_PAGES = 5;

let holders: ReturnType<typeof createPermissionHolderReader> | null = null;

/** Published live Courses filed under one Topic, bounded. */
async function courseIdsUnderTopic(topicId: string): Promise<ReadonlySet<string>> {
  const found = new Set<string>();
  const reads = learningReadRuntime();
  for (let page = 0; page < TOPIC_PAGES; page += 1) {
    const result = await reads.courses({
      topic: topicId,
      format: 'live',
      offset: page * 24,
    });
    for (const course of result.items) found.add(course.id);
    if (!result.hasMore) break;
  }
  return found;
}

export async function teacherDirectory(
  locale: Locale,
  filters: {
    readonly subject: string | null;
    readonly language: string | null;
    readonly availability: 'available' | null;
  },
): Promise<TeacherDirectoryResult> {
  const { mode, teachers } = await liveClassesReadRuntime().teachers();
  if (mode === null || teachers.length === 0)
    return { mode, teachers: [], invalid: false };

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
  if (operational.length === 0) return { mode, teachers: [], invalid: false };

  // People: published TeacherProfiles, with their public words.
  const profiles = new Map(
    (
      await peopleReadRuntime().people.publicTeachers(
        operational.map((teacher) => teacher.accountId),
        locale,
      )
    ).map((entry) => [entry.accountId, entry]),
  );

  // Taxonomy: the subject, if any, is a Topic the owner knows.
  let subjectCourses: ReadonlySet<string> | null = null;
  if (filters.subject !== null) {
    const topic = await taxonomyRuntime().taxonomy.findTopicBySlug({
      slug: filters.subject,
      locale,
    });
    if (topic === null || topic.status !== 'active')
      return { mode, teachers: [], invalid: true };
    subjectCourses = await courseIdsUnderTopic(topic.id);
  }
  if (filters.language !== null) {
    const known = await taxonomyRuntime().taxonomy.listLanguages({
      includeRetired: true,
    });
    if (!known.some((entry) => entry.code === filters.language))
      return { mode, teachers: [], invalid: true };
  }

  const listed: PublicTeacherListing[] = [];
  for (const teacher of operational) {
    const profile = profiles.get(teacher.accountId);
    if (profile === undefined) continue;
    if (
      subjectCourses !== null &&
      !teacher.courses.some((course) => subjectCourses.has(course.id))
    )
      continue;
    if (
      filters.language !== null &&
      !teacher.courses.some((course) => course.languageCode === filters.language) &&
      !profile.languages.includes(filters.language)
    )
      continue;
    if (filters.availability === 'available' && !teacher.available) continue;
    listed.push({ profile, courses: teacher.courses, available: teacher.available });
  }
  listed.sort((a, b) => a.profile.slug.localeCompare(b.profile.slug));
  return { mode, teachers: listed, invalid: false };
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
