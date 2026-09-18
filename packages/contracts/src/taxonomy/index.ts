/**
 * `@minhaj/contracts/taxonomy` — the Taxonomy contract surface.
 *
 * Layer 0, and browser-safe: types, Zod schemas and two constants. It reaches
 * no infrastructure and holds no policy, so an admin form that pulls a slug
 * schema from here gets a slug schema and nothing else.
 *
 * The PORTS it declares are implemented by a private adapter inside
 * `packages/database` and consumed by the Taxonomy context inside
 * `apps/web/src/contexts/taxonomy`. Neither imports the other; both import this
 * (ARCHITECTURE.md §3.1.1).
 *
 * WHAT IS DELIBERATELY ABSENT. Any shape describing a topic ASSIGNMENT to a
 * content record. DOMAIN_MODEL.md §6.2 requires typed junctions with real
 * foreign keys at both ends, owned by the context that owns the target — and
 * no such context has shipped. A generic assignment type declared here would
 * be the polymorphic reference the same section prohibits, dressed as a
 * contract. `TopicAssignmentStatus` reports whether the DATABASE already
 * enforces complete typed relationships; it does not expose physical schema or
 * offer a way to create one.
 */

export {
  MAX_TOPIC_DEPTH,
  TOPIC_FALLBACK_LOCALE,
  languageCodeSchema,
  languageDirectionSchema,
  languageEnglishNameSchema,
  languageNativeNameSchema,
  languageStatusSchema,
  tagLabelSchema,
  tagSlugSchema,
  tagStatusSchema,
  topicDescriptionSchema,
  topicLocaleSchema,
  topicNameSchema,
  topicSlugSchema,
  topicStatusSchema,
} from './values.ts';

export type {
  LanguageDirection,
  LanguageStatus,
  LanguageView,
  TagPage,
  TagStatus,
  TagView,
  TopicAssignmentStatus,
  TopicDetail,
  TopicLabel,
  TopicStatus,
  TopicTranslationView,
  TopicView,
} from './values.ts';

export type {
  CreateTopicInput,
  TaxonomyActorInput,
  TaxonomyPersistencePort,
  TaxonomyReaderPort,
  TopicTreeQuery,
} from './ports.ts';
