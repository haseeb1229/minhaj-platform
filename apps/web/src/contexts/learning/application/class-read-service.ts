import { z } from 'zod';

import {
  TEACHER_AVAILABILITY_FILTERS,
  type ClassPublicReaderPort,
  type LearningActivationPort,
  type LiveLearningAuthority,
  type OperationalTeacher,
  type PublicSessionPage,
} from '@minhaj/contracts/learning';

/**
 * The PUBLIC live-learning reads — `/learn/live` and `/learn/teachers`
 * (ROUTE_MAP.md §3.5; DELIVERY_PLAN.md Phase 23).
 *
 * NO ACTOR, NO SESSION, and nothing private can leave: the reader returns an
 * upcoming session's Course and its teacher's ACCOUNT identifier (which Layer
 * 4 resolves to People's public profile and never prints), its times and its
 * zone — never a participant, a Booking, an Attendance mark, a window or a
 * meeting address (SECURITY_BASELINE.md §11, §17).
 *
 * ACTIVATION-AWARE AND HONEST. While no activation is in force both reads
 * answer `mode: null` and empty lists, so the pages render an honest
 * unavailable state rather than an empty schedule that reads as "no classes
 * this week". A `fixture` activation is reported as such, so a page can say
 * it is a test state and keep itself out of indexing.
 */

const browseOffset = z.number().int().min(0).max(25_000);

export interface PublicLiveSchedule {
  readonly mode: LiveLearningAuthority | null;
  readonly page: PublicSessionPage;
}

export interface PublicTeacherDirectory {
  readonly mode: LiveLearningAuthority | null;
  readonly teachers: readonly OperationalTeacher[];
}

export function createClassReadService(deps: {
  readonly reader: ClassPublicReaderPort;
  readonly activation: LearningActivationPort;
  readonly clock?: () => Date;
}) {
  const now = deps.clock ?? (() => new Date());

  return {
    async liveSchedule(offset = 0): Promise<PublicLiveSchedule> {
      const mode = await deps.activation.activeMode();
      if (mode === null) return { mode, page: { items: [], hasMore: false } };
      return {
        mode,
        page: await deps.reader.upcomingSessions(now(), browseOffset.parse(offset)),
      };
    },

    /**
     * Every operational teacher: a current scope on a published live Course,
     * with those Courses and whether a future window is open. Layer 4 then
     * keeps only the accounts Identity reports live for `teaching.perform` and
     * People reports with a published TeacherProfile, and applies the filters.
     */
    async teachers(): Promise<PublicTeacherDirectory> {
      const mode = await deps.activation.activeMode();
      if (mode === null) return { mode, teachers: [] };
      return { mode, teachers: await deps.reader.operationalTeachers(now()) };
    },
  };
}

export type ClassReadService = ReturnType<typeof createClassReadService>;

/**
 * THE AVAILABILITY FILTER VOCABULARY of `/learn/teachers?availability=`: the
 * one word `available` — at least one future, open, unbooked window. No
 * accepted document defines another value, and an unknown one never broadens
 * the listing: it is reported invalid and the page explains an empty result.
 */
export function readAvailabilityFilter(
  raw: string | null,
):
  | { readonly state: 'none' }
  | { readonly state: 'value'; readonly value: 'available' }
  | { readonly state: 'invalid' } {
  if (raw === null || raw === '') return { state: 'none' };
  return (TEACHER_AVAILABILITY_FILTERS as readonly string[]).includes(raw)
    ? { state: 'value', value: 'available' }
    : { state: 'invalid' };
}
