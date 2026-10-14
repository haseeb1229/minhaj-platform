import {
  learningIdSchema,
  type CourseLabel,
  type CourseSearchRecord,
  type LearningPublicReaderPort,
  type PathSearchRecord,
} from '@minhaj/contracts/learning';
import {
  SEARCH_BODY_MAX_LENGTH,
  SEARCH_SUMMARY_MAX_LENGTH,
  SEARCH_TITLE_MAX_LENGTH,
  type SearchDocumentSource,
  type SearchScopeSource,
  type SearchTargetResolver,
} from '@minhaj/contracts/search';

/**
 * Learning's search projections (DELIVERY_PLAN.md Phase 22): one scope per
 * public Course and one per public LearningPath.
 *
 * ONE DOCUMENT PER LABELLED LOCALE, each tokenised in its own language and
 * carrying the Course's genuine CONTENT language, so an Urdu summary of an
 * English course never makes the course Urdu.
 *
 * THE PUBLIC SYLLABUS, AND ONLY THAT. A Course document carries its title,
 * summary, description and its module and lesson titles and summaries in that
 * locale — exactly what the public Course page shows. A lesson's BODY is an
 * enrolled learner's and is never indexed; neither is a teacher's name (a person
 * is found as a Person result), an Enrolment, Progress or a trial request.
 *
 * VISIBILITY IS DECIDED AT QUERY TIME. A stale document of a Course that has
 * since been returned to draft or archived is withheld by the target resolver,
 * which asks the owner's live public predicate — so nothing stale resurrects it.
 */

/** Cut by code point so no character is ever halved; nothing is added. */
function clip(value: string, max: number): string {
  const points = [...value];
  return points.length <= max ? value : points.slice(0, max).join('');
}

function courseDocuments(record: CourseSearchRecord): SearchDocumentSource[] {
  return record.labels.map((label: CourseLabel) => {
    const syllabus = record.outline.flatMap((module) => {
      const own = module.labels.find((entry) => entry.locale === label.locale);
      const lessons = module.lessons.flatMap((lesson) => {
        const words = lesson.labels.find((entry) => entry.locale === label.locale);
        return words === undefined ? [] : [words.title, words.summary];
      });
      return own === undefined ? lessons : [own.title, own.summary, ...lessons];
    });
    return {
      kind: 'course',
      resourceId: record.id,
      textLanguage: label.locale,
      contentLanguage: record.languageCode,
      title: clip(label.title, SEARCH_TITLE_MAX_LENGTH),
      summary: clip(label.summary, SEARCH_SUMMARY_MAX_LENGTH),
      body: clip(
        [label.description, ...syllabus].filter((part) => part !== '').join('\n'),
        SEARCH_BODY_MAX_LENGTH,
      ),
      year: null,
      topicIds: [...record.topicIds],
    };
  });
}

function pathDocuments(record: PathSearchRecord): SearchDocumentSource[] {
  return record.labels.map((label) => ({
    kind: 'learning-path',
    resourceId: record.id,
    textLanguage: label.locale,
    contentLanguage: null,
    title: clip(label.title, SEARCH_TITLE_MAX_LENGTH),
    summary: clip(label.summary, SEARCH_SUMMARY_MAX_LENGTH),
    body: clip(label.description, SEARCH_BODY_MAX_LENGTH),
    year: null,
    topicIds: [],
  }));
}

export const coursePath = (slug: string): string =>
  `/learn/courses/${encodeURIComponent(slug)}`;

export const learningPathPath = (slug: string): string =>
  `/learn/paths/${encodeURIComponent(slug)}`;

/** A cursor must be an identifier the owner issued; anything else is refused. */
function cursor(after: string | null): string | null {
  if (after === null) return null;
  if (!learningIdSchema.safeParse(after).success)
    throw new Error('A Learning search cursor must be an identifier.');
  return after;
}

const valid = (ids: readonly string[]): string[] =>
  ids.filter((id) => learningIdSchema.safeParse(id).success);

export function createLearningSearchProjection(reader: LearningPublicReaderPort): {
  readonly course: {
    readonly source: SearchScopeSource;
    readonly target: SearchTargetResolver;
  };
  readonly path: {
    readonly source: SearchScopeSource;
    readonly target: SearchTargetResolver;
  };
} {
  return {
    course: {
      source: {
        async project(id) {
          if (!learningIdSchema.safeParse(id).success) return null;
          const record = await reader.searchCourse(id);
          return record === null
            ? null
            : { stamp: record.stamp, documents: courseDocuments(record) };
        },
        list: ({ after, limit }) => reader.searchCourses({ after: cursor(after), limit }),
      },
      async target(ids) {
        const rows = await reader.publicCourseTargets(valid(ids));
        return new Map(rows.map((row) => [row.id, coursePath(row.slug)]));
      },
    },
    path: {
      source: {
        async project(id) {
          if (!learningIdSchema.safeParse(id).success) return null;
          const record = await reader.searchPath(id);
          return record === null
            ? null
            : { stamp: record.stamp, documents: pathDocuments(record) };
        },
        list: ({ after, limit }) => reader.searchPaths({ after: cursor(after), limit }),
      },
      async target(ids) {
        const rows = await reader.publicPathTargets(valid(ids));
        return new Map(rows.map((row) => [row.id, learningPathPath(row.slug)]));
      },
    },
  };
}
